import { loadHarmoniaConfig } from './config.js'
import { createHarmoniaStore } from './store/store.js'
import { createWhatsAppProvider } from './providers/whatsapp.js'
import { claimAttendanceSignalDelivery, deliverAttendanceSignal } from '../events/attendanceOutbox.js'

function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms))
}

function resolveChannelId(config, unitSlug) {
    const slug = String(unitSlug || '').trim().toLowerCase()
    if (slug === 'novo_hamburgo' && Number.isFinite(config?.wa?.channelNh)) return config.wa.channelNh
    if (slug === 'barra_shopping' && Number.isFinite(config?.wa?.channelBss)) return config.wa.channelBss
    return config?.wa?.channelDefault || 1
}

function resolveNotifyNumber(config, unit) {
    const slug = String(unit?.slug || '').trim()
    if (unit?.notify_remote_jid) return unit.notify_remote_jid
    if (config?.notifyMap && slug && config.notifyMap[slug]) return config.notifyMap[slug]
    if (config?.notifyMap && config.notifyMap.default) return config.notifyMap.default
    return null
}

async function getConversationContext(store, conversationId) {
    if (!conversationId) return null
    return store.withTransaction(async (tx) => store.getConversationWithContact(tx, conversationId))
}

function shouldSkipOutbound(context) {
    if (!context) return { skip: false }
    if (context.opted_out_at) return { skip: true, reason: 'opted_out' }
    const stage = String(context.stage || '').toLowerCase()
    if (stage === 'closed') return { skip: true, reason: 'closed' }
    return { skip: false }
}

function computeBackoffSeconds(attempt, config) {
    const base = Number(config?.tasksBackoffSeconds || 30)
    const cap = Number(config?.tasksBackoffMaxSeconds || 900)
    if (!Number.isFinite(base) || base <= 0) return 30
    const exponent = Math.max(0, Number(attempt || 1) - 1)
    const delay = base * Math.pow(2, exponent)
    return Math.min(delay, Number.isFinite(cap) && cap > 0 ? cap : delay)
}

async function processTask({ task, store, provider, config }) {
    const type = String(task?.type || '').trim().toUpperCase()
    const payload = task?.payload || {}
    const conversationId = task.conversation_id || task.conversationId || null
    const context = await getConversationContext(store, conversationId)

    if (type === 'SEND_MESSAGE') {
        const skip = shouldSkipOutbound(context)
        if (skip.skip) return { ok: true, skipped: true, reason: skip.reason }
        const number = payload?.to || payload?.number || payload?.phone
        const message = payload?.text || payload?.message
        const channelId = payload?.channelId || payload?.channel || resolveChannelId(config, payload?.unitSlug)
        await provider.sendMessage({ channelId, number, message })
        if (conversationId) {
            await store.withTransaction(async (tx) => store.updateConversation(tx, conversationId, {
                last_outbound_at: new Date().toISOString(),
            }))
        }
        return { ok: true }
    }

    if (type === 'FOLLOW_UP') {
        const skip = shouldSkipOutbound(context)
        if (skip.skip) return { ok: true, skipped: true, reason: skip.reason }
        const number = payload?.to || payload?.number || payload?.phone || payload?.phoneRaw
        const message = payload?.text || payload?.message
        const channelId = payload?.channelId || payload?.channel || resolveChannelId(config, payload?.unitSlug)
        await provider.sendMessage({ channelId, number, message })
        if (conversationId) {
            const patch = { last_outbound_at: new Date().toISOString() }
            if (String(context?.stage || '') === 'after_hours_wait') {
                patch.stage = 'awaiting_reply'
            }
            await store.withTransaction(async (tx) => store.updateConversation(tx, conversationId, patch))
        }
        return { ok: true }
    }

    if (type === 'NOTIFY_INTERNAL') {
        const unitSlug = payload?.unitSlug
        const unit = await store.withTransaction(async (tx) => store.getUnitBySlug(tx, unitSlug))
        const notifyNumber = resolveNotifyNumber(config, unit)
        if (!notifyNumber) throw new Error('notify_remote_jid not configured')
        const message = payload?.text || payload?.message
        const channelId = resolveChannelId(config, unitSlug)
        await provider.sendMessage({ channelId, number: notifyNumber, message })
        return { ok: true }
    }

    throw new Error(`unsupported task type: ${type}`)
}

export function startHarmoniaWorker({ varDir }) {
    const config = loadHarmoniaConfig({ varDir })
    if (!config.workerEnabled) return { stop: () => {} }
    if (!config.databaseUrl) {
        console.warn('⚠️  Harmonia worker disabled: DATABASE_URL not configured')
        return { stop: () => {} }
    }

    const store = createHarmoniaStore({ databaseUrl: config.databaseUrl })
    const provider = createWhatsAppProvider(config)

    let running = true
    let loopActive = false

    async function loop() {
        if (!running || loopActive) return
        loopActive = true
        try {
            const tasks = await store.withTransaction(async (tx) => {
                return store.claimTasks(tx, { limit: config.tasksClaimLimit, staleMinutes: config.tasksStaleMinutes })
            })

            for (const task of tasks) {
                try {
                    const result = await processTask({ task, store, provider, config })
                    if (result?.skipped) {
                        await store.withTransaction(async (tx) => store.completeTask(tx, {
                            taskId: task.id,
                            status: 'done',
                            error: `skipped:${result.reason || 'unknown'}`,
                        }))
                        continue
                    }
                    await store.withTransaction(async (tx) => store.completeTask(tx, { taskId: task.id, status: 'done' }))
                } catch (e) {
                    const attempts = Number(task?.attempts || 1)
                    const maxAttempts = Number(config?.tasksMaxAttempts || 5)
                    const error = e?.message || String(e)
                    if (Number.isFinite(maxAttempts) && attempts < maxAttempts) {
                        const delaySeconds = computeBackoffSeconds(attempts, config)
                        const retryAt = new Date(Date.now() + delaySeconds * 1000).toISOString()
                        await store.withTransaction(async (tx) => store.rescheduleTask(tx, {
                            taskId: task.id,
                            runAt: retryAt,
                            error,
                        }))
                        console.log(JSON.stringify({
                            level: 'warn',
                            module: 'harmonia_worker',
                            event: 'task_retry_scheduled',
                            task_id: task.id,
                            type: task.type,
                            attempts,
                            maxAttempts,
                            retry_at: retryAt,
                            error,
                        }))
                    } else {
                        await store.withTransaction(async (tx) => store.completeTask(tx, {
                            taskId: task.id,
                            status: 'failed',
                            error,
                        }))
                        console.log(JSON.stringify({
                            level: 'error',
                            module: 'harmonia_worker',
                            event: 'task_failed_final',
                            task_id: task.id,
                            type: task.type,
                            attempts,
                            maxAttempts,
                            error,
                        }))
                        if (config.tasksAlertNotify && String(task?.type || '').toUpperCase() !== 'NOTIFY_INTERNAL') {
                            const conversationId = task.conversation_id || task.conversationId || null
                            if (conversationId) {
                                const unitSlug = task?.payload?.unitSlug || config?.defaults?.unitSlug || 'unknown'
                                const text = `Harmonia: task falhou definitivamente. type=${task.type} attempts=${attempts} error=${error}`
                                await store.withTransaction(async (tx) => store.createTask(tx, {
                                    conversationId,
                                    type: 'NOTIFY_INTERNAL',
                                    runAt: new Date().toISOString(),
                                    payload: { unitSlug, text },
                                }))
                            }
                        }
                    }
                }
            }
            if (config.attendanceEventSignalsEnabled) {
                try {
                    const deliveries = await claimAttendanceSignalDelivery(store.pool, { limit: 10 })
                    for (const delivery of deliveries) await deliverAttendanceSignal(store.pool, delivery, { maxAttempts: 3 })
                } catch {
                    console.warn(JSON.stringify({ level: 'warn', domain: 'harmonia', event: 'attendance_signal_consumer_unavailable' }))
                }
            }
        } catch (e) {
            console.warn('⚠️  Harmonia worker loop error:', e?.message || String(e))
        } finally {
            loopActive = false
        }
    }

    const interval = setInterval(loop, 1500)
    loop()

    return {
        stop: () => {
            running = false
            clearInterval(interval)
        },
    }
}
