import { loadHarmoniaConfig, normalizeWorkerMode } from './config.js'
import { createHarmoniaStore } from './store/store.js'
import { createWhatsAppProvider } from './providers/whatsapp.js'

const OUTBOUND_TASK_TYPES = new Set(['SEND_MESSAGE', 'FOLLOW_UP', 'NOTIFY_INTERNAL'])

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

function isValidTimestamp(value) {
    if (!value) return false
    const parsed = new Date(String(value))
    return !Number.isNaN(parsed.getTime())
}

export function isOutboundTaskType(type) {
    return OUTBOUND_TASK_TYPES.has(String(type || '').trim().toUpperCase())
}

/**
 * A task can only cross the messaging boundary after a backend-issued,
 * auditable human confirmation has been attached to its payload. This is
 * deliberately strict: malformed or legacy confirmation fields fail closed.
 */
export function hasHumanConfirmation(payload) {
    const confirmation = payload?.humanConfirmation || payload?.human_confirmation
    if (!confirmation || typeof confirmation !== 'object') return false
    if (String(confirmation.status || '').trim().toLowerCase() !== 'confirmed') return false
    if (!String(confirmation.approvedBy || confirmation.approved_by || '').trim()) return false
    if (!isValidTimestamp(confirmation.approvedAt || confirmation.approved_at)) return false
    if (!String(confirmation.idempotencyKey || confirmation.idempotency_key || '').trim()) return false
    return true
}

export function humanConfirmationError() {
    const error = new Error('human confirmation is required before outbound execution')
    error.code = 'HUMAN_CONFIRMATION_REQUIRED'
    return error
}

function getHumanConfirmation(payload) {
    return payload?.humanConfirmation || payload?.human_confirmation || null
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

    if (isOutboundTaskType(type)) {
        if (config.workerMode !== 'assisted' || config.outboundMode !== 'human_confirmed') {
            throw humanConfirmationError()
        }
        if (!hasHumanConfirmation(payload)) throw humanConfirmationError()
    }

    const context = await getConversationContext(store, conversationId)
    const confirmation = getHumanConfirmation(payload)
    const idempotencyKey = String(confirmation?.idempotencyKey || confirmation?.idempotency_key || '').trim() || null

    if (type === 'SEND_MESSAGE') {
        const skip = shouldSkipOutbound(context)
        if (skip.skip) return { ok: true, skipped: true, reason: skip.reason }
        const number = payload?.to || payload?.number || payload?.phone
        const message = payload?.text || payload?.message
        const channelId = payload?.channelId || payload?.channel || resolveChannelId(config, payload?.unitSlug)
        await provider.sendMessage({ channelId, number, message, idempotencyKey })
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
        await provider.sendMessage({ channelId, number, message, idempotencyKey })
        if (conversationId) {
            const patch = { last_outbound_at: new Date().toISOString() }
            if (String(context?.stage || '') === 'after_hours_wait') patch.stage = 'awaiting_reply'
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
        await provider.sendMessage({ channelId, number: notifyNumber, message, idempotencyKey })
        return { ok: true }
    }

    throw new Error(`unsupported task type: ${type}`)
}

function initialStatus(config) {
    return {
        service: 'crm-continuous-workers',
        mode: config.workerMode,
        outboundMode: config.outboundMode,
        running: false,
        ready: false,
        startedAt: null,
        stoppedAt: null,
        lastLoopAt: null,
        lastSuccessAt: null,
        lastErrorAt: null,
        lastError: null,
        loopCount: 0,
        errorCount: 0,
        database: {
            configured: Boolean(config.databaseUrl),
            reachable: false,
        },
        messaging: {
            required: config.workerMode === 'assisted',
            configured: Boolean(config.wa?.baseUrl),
        },
        queue: null,
    }
}

function copyStatus(status) {
    return {
        ...status,
        database: { ...status.database },
        messaging: { ...status.messaging },
        queue: status.queue ? {
            byStatus: { ...(status.queue.byStatus || {}) },
            byType: { ...(status.queue.byType || {}) },
            oldestPendingAt: status.queue.oldestPendingAt || null,
            oldestProcessingAt: status.queue.oldestProcessingAt || null,
        } : null,
    }
}

export function startHarmoniaWorker({
    varDir,
    mode,
    defaultMode = 'observe',
    storeFactory = createHarmoniaStore,
    providerFactory = createWhatsAppProvider,
    intervalMs = 1500,
} = {}) {
    const config = loadHarmoniaConfig({ varDir, workerMode: mode, defaultWorkerMode: defaultMode })
    const status = initialStatus(config)
    const store = config.databaseUrl ? storeFactory({ databaseUrl: config.databaseUrl }) : null
    const provider = config.workerMode === 'assisted' ? providerFactory(config) : null
    let running = true
    let loopActive = false
    let interval = null

    status.running = config.workerMode !== 'disabled'
    status.startedAt = new Date().toISOString()

    function recordError(error) {
        const rawCode = String(error?.code || '').trim().toUpperCase()
        const safeCode = /^[A-Z][A-Z0-9_]{0,63}$/.test(rawCode) ? rawCode : 'WORKER_LOOP_FAILED'
        status.lastErrorAt = new Date().toISOString()
        status.lastError = safeCode
        status.errorCount += 1
        status.ready = false
    }

    async function loop() {
        if (!running || loopActive || config.workerMode === 'disabled') return
        loopActive = true
        status.lastLoopAt = new Date().toISOString()
        status.loopCount += 1
        try {
            if (!store) throw new Error('DATABASE_URL not configured')

            if (config.workerMode === 'observe') {
                // Observe is intentionally read-only: no claim, cleanup, reset,
                // task completion or provider call is allowed in this mode.
                status.queue = await store.withTransaction(async (tx) => store.getTaskStats(tx))
            } else {
                const tasks = await store.withTransaction(async (tx) => {
                    return store.claimTasks(tx, {
                        limit: config.tasksClaimLimit,
                        staleMinutes: config.tasksStaleMinutes,
                    })
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
                    } catch (error) {
                        const attempts = Number(task?.attempts || 1)
                        const maxAttempts = Number(config?.tasksMaxAttempts || 5)
                        const message = error?.message || String(error)
                        if (Number.isFinite(maxAttempts) && attempts < maxAttempts) {
                            const delaySeconds = computeBackoffSeconds(attempts, config)
                            const retryAt = new Date(Date.now() + delaySeconds * 1000).toISOString()
                            await store.withTransaction(async (tx) => store.rescheduleTask(tx, {
                                taskId: task.id,
                                runAt: retryAt,
                                error: message,
                            }))
                        } else {
                            await store.withTransaction(async (tx) => store.completeTask(tx, {
                                taskId: task.id,
                                status: 'failed',
                                error: message,
                            }))
                            if (
                                config.tasksAlertNotify &&
                                error?.code !== 'HUMAN_CONFIRMATION_REQUIRED' &&
                                String(task?.type || '').toUpperCase() !== 'NOTIFY_INTERNAL'
                            ) {
                                const conversationId = task.conversation_id || task.conversationId || null
                                if (conversationId) {
                                    const unitSlug = task?.payload?.unitSlug || config?.defaults?.unitSlug || 'unknown'
                                    const text = `Harmonia: task falhou definitivamente. type=${task.type} attempts=${attempts} error=${message}`
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
                status.queue = await store.withTransaction(async (tx) => store.getTaskStats(tx))
            }

            status.database.reachable = true
            status.lastSuccessAt = new Date().toISOString()
            status.lastError = null
            status.ready = true
        } catch (error) {
            status.database.reachable = false
            recordError(error)
        } finally {
            loopActive = false
        }
    }

    if (config.workerMode !== 'disabled') {
        interval = setInterval(() => { void loop() }, Math.max(250, Number(intervalMs) || 1500))
        void loop()
    }

    return {
        stop: async () => {
            if (!running) return
            running = false
            if (interval) clearInterval(interval)
            status.running = false
            status.ready = false
            status.stoppedAt = new Date().toISOString()
            if (store?.pool && typeof store.pool.end === 'function') {
                await store.pool.end()
            }
        },
        getStatus: () => copyStatus(status),
        processTask: (task) => processTask({ task, store, provider, config }),
        config,
    }
}

export { normalizeWorkerMode }
