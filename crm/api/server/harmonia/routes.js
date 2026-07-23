import express from 'express'
import { createHash, createHmac, timingSafeEqual } from 'crypto'

import { loadHarmoniaConfig } from './config.js'
import { createHarmoniaStore } from './store/store.js'
import { createGoogleSheetsProcedureProvider } from './providers/googleSheets.js'
import { classifyProcedureOpenAi } from './providers/openai.js'
import { decideHarmoniaActions } from './engine/decide.js'
import { redactSecrets } from './util/redact.js'

function onlyDigits(s) {
    return String(s || '').replace(/\D+/g, '')
}

function safeEqual(a, b) {
    const aa = Buffer.from(String(a || ''), 'utf8')
    const bb = Buffer.from(String(b || ''), 'utf8')
    if (aa.length !== bb.length) return false
    try {
        return timingSafeEqual(aa, bb)
    } catch {
        return false
    }
}

function getTokenFromReq(req, headerName, queryName) {
    const header = String(req.headers?.[headerName] || '').trim()
    if (header) return header
    const query = req.query?.[queryName]
    return String(query || '').trim()
}

function deriveUnitSlug(payload) {
    const explicit = String(payload?.unitSlug || '').trim().toLowerCase()
    if (explicit) return explicit

    const instance = String(payload?.instance || '').toLowerCase()
    if (instance.includes('novo hamburgo')) return 'novo_hamburgo'
    if (instance.includes('barra')) return 'barra_shopping'
    return null
}

function resolveUnitSlugFromChannel(config, channelId) {
    const key = String(channelId || '').trim()
    if (!key) return null
    const map = config?.channelMap && typeof config.channelMap === 'object' ? config.channelMap : null
    if (!map) return null
    const v = map[key] || map[String(key).toLowerCase()] || null
    return v ? String(v).trim().toLowerCase() : null
}

function workingHoursTextForUnitSlug(unitSlug) {
    const slug = String(unitSlug || '').trim().toLowerCase()
    if (slug === 'novo_hamburgo') {
        return '08:30 às 20:30 (seg-sex) e 09:00 às 20:00 (sáb)'
    }
    if (slug === 'barra_shopping') {
        return '10:00 às 22:00 (seg-sáb) e 11:15 às 20:45 (dom)'
    }
    return 'nosso horário de atendimento'
}

function getHourInTZ(isoString, tz) {
    try {
        const d = isoString ? new Date(isoString) : new Date()
        const parts = new Intl.DateTimeFormat('pt-BR', {
            timeZone: tz,
            hour: '2-digit',
            hour12: false,
        }).formatToParts(d)
        const hourPart = parts.find((p) => p.type === 'hour')
        return hourPart ? Number(hourPart.value) : null
    } catch {
        return null
    }
}

function resolveAttendant({ unitSlug, now, config, timezone }) {
    const tz = String(timezone || 'America/Sao_Paulo')
    const hour = getHourInTZ(now, tz)
    const isMorning = hour == null ? true : hour < 13
    const slug = String(unitSlug || '').trim().toLowerCase()

    const defaults = {
        novo_hamburgo: { morning: 'Evelin', afternoon: 'Cauane' },
        barra_shopping: { morning: 'Vitória', afternoon: 'Talessa' },
        default: { morning: 'Consultora', afternoon: 'Consultora' },
    }

    const cfg = config?.attendants && typeof config.attendants === 'object' ? config.attendants : null
    const selected = (cfg && (cfg[slug] || cfg.default)) || defaults[slug] || defaults.default
    const pick = isMorning ? selected?.morning : selected?.afternoon
    return String(pick || 'Consultora').trim()
}

function buildPayloadFromOfficialWebhook({ body, config, channelId }) {
    const message = body?.message || {}
    const from = String(message?.from || '').trim()
    const to = String(message?.to || '').trim()
    const text = String(message?.body || '').trim()
    const fromMe = Boolean(message?.fromMe)
    const timestamp = message?.timestamp ? Number(message.timestamp) : null

    const waJid = from || to || null
    const phoneRaw = onlyDigits(waJid)
    const mappedUnit = resolveUnitSlugFromChannel(config, channelId)
    const unitSlug = mappedUnit || config?.defaults?.unitSlug || 'novo_hamburgo'
    const instanceName = config?.defaults?.instanceName || 'WhatsApp Official'

    return {
        instance: instanceName,
        unitSlug,
        attendant: null,
        CTA: null,
        workingHours: null,
        processing: {
            should_process: Boolean(text) && !fromMe,
        },
        webhook_info: {
            event: body?.event || null,
            eventId: body?.eventId || null,
            timestamp: body?.timestamp || null,
            channelId: channelId || null,
        },
        message_info: {
            message_id: message?.id || null,
            chat_id: waJid,
            sender_name: null,
            text,
            fromMe,
            type: message?.type || null,
            timestamp,
        },
        message: {
            id: message?.id || null,
            text,
            type: message?.type || null,
            timestamp,
        },
        contact: {
            name: null,
            waJid,
            fromMe,
            phone: {
                raw: phoneRaw || null,
            },
        },
        origin: {
            isAd: false,
            leadSpeedClass: null,
        },
        campaign: { detectedTags: [] },
        ad: { title: null, body: null },
    }
}

function buildPayloadFromEvolutionWebhook({ body, config }) {
    const root = body && typeof body === 'object' ? body : {}
    const top = root.body && typeof root.body === 'object' ? root.body : root
    const data = top.data && typeof top.data === 'object' ? top.data : {}
    const ctx = data.contextInfo && typeof data.contextInfo === 'object' ? data.contextInfo : {}
    const ext = ctx.externalAdReply && typeof ctx.externalAdReply === 'object' ? ctx.externalAdReply : {}
    const key = data.key && typeof data.key === 'object' ? data.key : {}
    const msg = data.message && typeof data.message === 'object' ? data.message : {}

    const messageText =
        msg.conversation ||
        (msg.extendedTextMessage && msg.extendedTextMessage.text) ||
        ''

    let waJid = key.remoteJid || top.sender || root.sender || ''
    let waNumberRaw = null
    if (typeof waJid === 'string') {
        waNumberRaw = waJid.split('@')[0].replace(/[^0-9]/g, '')
    }

    let countryCode = null
    let ddd = null
    let localNumber = null
    let formatted = null

    if (waNumberRaw && waNumberRaw.startsWith('55') && waNumberRaw.length >= 4) {
        countryCode = '55'
        ddd = waNumberRaw.slice(2, 4)
        localNumber = waNumberRaw.slice(4)
        formatted = `+${countryCode} (${ddd}) ${localNumber}`
    } else if (waNumberRaw) {
        localNumber = waNumberRaw
        formatted = waNumberRaw
    }

    const instance = top.instance || root.instance || ''
    const unitSlug = deriveUnitSlug({ unitSlug: top.unitSlug, instance }) || config?.defaults?.unitSlug || null

    const conversionSource = ctx.conversionSource || null
    const entryPointSource = ctx.entryPointConversionSource || null
    const entryPointApp = ctx.entryPointConversionApp || ext.sourceApp || null

    const isAd =
        entryPointSource === 'ctwa_ad' ||
        String(conversionSource || '').toLowerCase().includes('ads')

    const delays = []
        .concat(typeof ctx.conversionDelaySeconds === 'number' ? [ctx.conversionDelaySeconds] : [])
        .concat(typeof ctx.entryPointConversionDelaySeconds === 'number' ? [ctx.entryPointConversionDelaySeconds] : [])

    let leadSpeedSeconds = delays.length ? Math.min(...delays) : null
    let leadSpeedClass = null
    if (leadSpeedSeconds != null) {
        if (leadSpeedSeconds <= 30) leadSpeedClass = 'hot'
        else if (leadSpeedSeconds <= 300) leadSpeedClass = 'warm'
        else leadSpeedClass = 'cold'
    }

    const knownTags = [
        { key: 'lavieen', label: 'Lavieen' },
        { key: 'clube lavieen', label: 'Clube Lavieen' },
        { key: 'sculptra', label: 'Sculptra' },
        { key: 'elleva', label: 'Elleva' },
        { key: 'diamond', label: 'Diamond' },
        { key: 'botox', label: 'Botox' },
        { key: 'preenchimento', label: 'Preenchimento' },
        { key: 'fio', label: 'Fios' },
        { key: 'black november', label: 'Black November' },
        { key: 'blackpreço', label: 'Black Preço' },
    ]

    const textForDetection = [
        messageText,
        ext.body || '',
        ext.title || '',
    ].join(' ').toLowerCase()

    const detectedTags = knownTags
        .filter((t) => textForDetection.includes(t.key))
        .map((t) => t.label)

    const shouldProcess = Boolean(messageText) && key.fromMe !== true

    return {
        event: top.event || root.event || null,
        instance,
        unitSlug,
        attendant: null,
        CTA: null,
        workingHours: null,
        processing: {
            should_process: shouldProcess,
        },
        webhook_info: {
            instance,
            sessionId: key.remoteJid || top.sender || null,
            date_time: top.date_time || root.date_time || null,
            destination: top.destination || null,
            apikey: top.apikey || null,
            server_url: top.server_url || null,
        },
        message_info: {
            chat_id: key.remoteJid || null,
            message_id: key.id || null,
            sender_name: data.pushName || null,
            text: messageText,
            fromMe: key.fromMe || false,
            type: data.messageType || null,
            timestamp: data.messageTimestamp || null,
        },
        contextInfo: ctx,
        message: {
            id: key.id || null,
            text: messageText,
            type: data.messageType || null,
            timestamp: data.messageTimestamp || null,
        },
        contact: {
            name: data.pushName || null,
            waJid: key.remoteJid || null,
            fromMe: key.fromMe || false,
            phone: {
                raw: waNumberRaw || null,
                countryCode,
                ddd,
                localNumber,
                formatted,
            },
        },
        origin: {
            isAd,
            conversionSource,
            entryPointSource,
            entryPointApp,
            conversionDelaySeconds: typeof ctx.conversionDelaySeconds === 'number' ? ctx.conversionDelaySeconds : null,
            entryPointConversionDelaySeconds: typeof ctx.entryPointConversionDelaySeconds === 'number'
                ? ctx.entryPointConversionDelaySeconds
                : null,
            leadSpeedSeconds,
            leadSpeedClass,
        },
        ad: {
            title: ext.title || null,
            body: ext.body || null,
            mediaType: typeof ext.mediaType !== 'undefined' ? ext.mediaType : null,
            thumbnailUrl: ext.thumbnailUrl || null,
            sourceType: ext.sourceType || null,
            sourceId: ext.sourceId || null,
            sourceUrl: ext.sourceUrl || null,
            sourceApp: ext.sourceApp || entryPointApp || null,
            clickId: ext.ctwaClid || ctx.ctwaClid || null,
            showAdAttribution: typeof ext.showAdAttribution !== 'undefined' ? ext.showAdAttribution : null,
            containsAutoReply: typeof ext.containsAutoReply !== 'undefined' ? ext.containsAutoReply : null,
        },
        campaign: { detectedTags },
        webhook: {
            dateTime: top.date_time || null,
            destination: top.destination || null,
            executionMode: root.executionMode || null,
        },
        meta: {
            status: data.status || null,
            source: data.source || null,
        },
    }
}

function sanitizeUnitSlug(v) {
    const input = String(v || '').trim().toLowerCase().slice(0, 240)
    if (!input) return null
    let slug = ''
    let pendingSeparator = false
    for (const char of input) {
        const allowed = (char >= 'a' && char <= 'z') || (char >= '0' && char <= '9') || char === '_'
        if (allowed) {
            if (pendingSeparator && slug && !slug.endsWith('_')) slug += '_'
            slug += char
            pendingSeparator = false
        } else {
            pendingSeparator = true
        }
        if (slug.length >= 80) break
    }
    while (slug.startsWith('_')) slug = slug.slice(1)
    while (slug.endsWith('_')) slug = slug.slice(0, -1)
    return slug || null
}

function verifyWebhookSignature(req, config) {
    const secret = config?.webhook?.secret
    if (!secret) return { ok: true, reason: 'no_secret' }
    const sig = String(req.headers['x-signature'] || '').trim()
    if (!sig) return { ok: false, error: 'missing_signature' }
    const raw = req.rawBody
    if (!raw || !raw.length) return { ok: false, error: 'missing_raw_body' }
    const expected = createHmac('sha256', secret).update(raw).digest('hex')
    const a = Buffer.from(expected)
    const b = Buffer.from(sig)
    if (a.length !== b.length) return { ok: false, error: 'signature_mismatch' }
    const ok = timingSafeEqual(a, b)
    return ok ? { ok: true } : { ok: false, error: 'signature_mismatch' }
}

function deriveProviderMessageId(envelope, payload) {
    const explicit =
        payload?.message_info?.message_id ||
        payload?.message?.id ||
        envelope?.event?.id ||
        null
    if (explicit) return String(explicit).trim()

    const phone = onlyDigits(payload?.contact?.phone?.raw || payload?.contact?.waJid || '')
    const ts = payload?.message_info?.timestamp || payload?.message?.timestamp || envelope?.receivedAt || ''
    const text = payload?.message?.text || payload?.message_info?.text || ''
    const h = createHash('sha256').update(JSON.stringify({ phone, ts, text })).digest('hex').slice(0, 32)
    return `derived:${h}`
}

function createProviders(config) {
    const sheets = createGoogleSheetsProcedureProvider(config)
    const openai = {
        async classify({ text }) {
            return classifyProcedureOpenAi({
                apiKey: config?.openai?.apiKey,
                model: config?.openai?.model,
                text,
            })
        },
    }
    return { sheets, openai }
}

function applyPayloadDefaults({ payload, unit, config, envelope, instanceName }) {
    const unitSlug = sanitizeUnitSlug(payload?.unitSlug || unit?.slug) || config?.defaults?.unitSlug || 'unknown'
    const instance = String(payload?.instance || '').trim() || unit?.name || instanceName || config?.defaults?.instanceName || ''
    const workingHours = payload?.workingHours || workingHoursTextForUnitSlug(unitSlug)
    const cta = payload?.CTA || config?.defaults?.cta || 'hoje'
    const attendant = payload?.attendant || resolveAttendant({
        unitSlug,
        now: envelope?.receivedAt || null,
        config,
        timezone: unit?.timezone || 'America/Sao_Paulo',
    })

    return {
        ...payload,
        unitSlug,
        instance,
        workingHours,
        CTA: cta,
        attendant,
    }
}

function auditLog(req, payload) {
    const requestId = req?.requestId || null
    const base = {
        level: 'info',
        module: 'harmonia',
        request_id: requestId,
        ts: new Date().toISOString(),
        ...payload,
    }
    console.log(JSON.stringify(base))
}

function normalizeStatus(value, fallback = 'sent') {
    const s = String(value || '').trim().toLowerCase()
    const allowed = new Set(['queued', 'sent', 'delivered', 'read', 'failed', 'error'])
    return allowed.has(s) ? s : fallback
}

function normalizeTaskStatus(value, fallback = 'done') {
    const s = String(value || '').trim().toLowerCase()
    const allowed = new Set(['done', 'failed', 'pending', 'processing'])
    return allowed.has(s) ? s : fallback
}

export function createHarmoniaRouter({ varDir }) {
    const config = loadHarmoniaConfig({ varDir })
    const store = createHarmoniaStore({ databaseUrl: config.databaseUrl })
    const providers = createProviders(config)

    const router = express.Router()

    function requireDebugToken(req, res, next) {
        const expected = config?.debugToken ? String(config.debugToken).trim() : ''
        if (!expected) return next()
        const provided = getTokenFromReq(req, 'x-harmonia-token', 'token')
        if (provided && safeEqual(provided, expected)) return next()
        return res.status(401).json({ ok: false, error: 'HARMONIA_DEBUG_TOKEN required' })
    }

    function requireExecToken(req, res, next) {
        const expected = config?.execToken ? String(config.execToken).trim() : ''
        if (!expected) return next()
        const provided = getTokenFromReq(req, 'x-harmonia-exec-token', 'exec_token')
        if (provided && safeEqual(provided, expected)) return next()
        return res.status(401).json({ ok: false, error: 'HARMONIA_EXEC_TOKEN required' })
    }

    function requireIngestToken(req, res, next) {
        const expected = config?.ingestToken ? String(config.ingestToken).trim() : ''
        if (!expected) return next()
        const provided = getTokenFromReq(req, 'x-harmonia-ingest-token', 'ingest_token')
        if (provided && safeEqual(provided, expected)) return next()
        return res.status(401).json({ ok: false, error: 'HARMONIA_INGEST_TOKEN required' })
    }

    router.get('/health', async (req, res) => {
        const dbOk = Boolean(config.databaseUrl)
        res.json({
            ok: true,
            harmonia: {
                dbConfigured: dbOk,
                debugTokenConfigured: Boolean(config?.debugToken),
                execTokenConfigured: Boolean(config?.execToken),
                ingestTokenConfigured: Boolean(config?.ingestToken),
                googleConfigured: Boolean(config?.google?.docId),
                openAiConfigured: Boolean(config?.openai?.apiKey),
                autoMigrate: Boolean(config.autoMigrate),
                storeRaw: Boolean(config.storeRaw),
            },
            ts: new Date().toISOString(),
        })
    })

    router.get('/units', requireDebugToken, async (req, res) => {
        if (!config.databaseUrl) return res.status(503).json({ ok: false, error: 'DATABASE_URL not configured' })
        try {
            const data = await store.withTransaction(async (tx) => store.listUnits(tx))
            res.json({ ok: true, data })
        } catch (e) {
            res.status(500).json({ ok: false, error: e?.message || String(e) })
        }
    })

    router.get('/units/:slug', requireDebugToken, async (req, res) => {
        if (!config.databaseUrl) return res.status(503).json({ ok: false, error: 'DATABASE_URL not configured' })
        try {
            const slug = sanitizeUnitSlug(req.params.slug)
            const data = await store.withTransaction(async (tx) => store.getUnitBySlug(tx, slug))
            if (!data) return res.status(404).json({ ok: false, error: 'unit not found', slug })
            res.json({ ok: true, data })
        } catch (e) {
            res.status(500).json({ ok: false, error: e?.message || String(e) })
        }
    })

    router.get('/conversations', requireDebugToken, async (req, res) => {
        if (!config.databaseUrl) return res.status(503).json({ ok: false, error: 'DATABASE_URL not configured' })
        const unitSlug = sanitizeUnitSlug(req.query?.unitSlug || req.query?.unit || req.query?.slug)
        const limit = Number(req.query?.limit || 30)
        const cursorTs = req.query?.cursorTs || req.query?.cursor_ts || null
        const cursorId = req.query?.cursorId || req.query?.cursor_id || null
        if (!unitSlug) return res.status(400).json({ ok: false, error: 'unitSlug is required' })
        const startedAt = Date.now()
        try {
            const items = await store.withTransaction(async (tx) => {
                return store.listConversationsByUnit(tx, { unitSlug, limit, cursorTs, cursorId })
            })

            const last = items.length ? items[items.length - 1] : null
            const nextCursor = last
                ? { cursorTs: last.last_activity_at || null, cursorId: last.id || null }
                : null

            auditLog(req, {
                event: 'conversations_list',
                unitSlug,
                limit: Number(limit || 30),
                cursor: Boolean(cursorTs || cursorId),
                count: items.length,
                duration_ms: Date.now() - startedAt,
            })
            res.json({ ok: true, data: { items, nextCursor } })
        } catch (e) {
            auditLog(req, {
                event: 'conversations_list_failed',
                unitSlug,
                error: e?.message || String(e),
                duration_ms: Date.now() - startedAt,
            })
            res.status(500).json({ ok: false, error: e?.message || String(e) })
        }
    })

    router.get('/conversations/find', requireDebugToken, async (req, res) => {
        if (!config.databaseUrl) return res.status(503).json({ ok: false, error: 'DATABASE_URL not configured' })
        const unitSlug = sanitizeUnitSlug(req.query?.unitSlug || req.query?.unit || req.query?.slug)
        const phoneRaw = onlyDigits(req.query?.phoneRaw || req.query?.phone || '')
        const limit = Number(req.query?.limit || 50)
        if (!unitSlug || !phoneRaw) {
            return res.status(400).json({ ok: false, error: 'unitSlug and phoneRaw are required' })
        }
        try {
            const data = await store.withTransaction(async (tx) => {
                const convo = await store.getConversationWithContactByUnitPhone(tx, { unitSlug, phoneRaw })
                if (!convo) return null
                const messages = await store.listMessagesByConversation(tx, { conversationId: convo.id, limit })
                return { conversation: convo, messages }
            })
            if (!data) return res.status(404).json({ ok: false, error: 'conversation not found' })
            res.json({ ok: true, data })
        } catch (e) {
            res.status(500).json({ ok: false, error: e?.message || String(e) })
        }
    })

    router.get('/conversations/:id', requireDebugToken, async (req, res) => {
        if (!config.databaseUrl) return res.status(503).json({ ok: false, error: 'DATABASE_URL not configured' })
        const id = String(req.params.id || '').trim()
        if (!id) return res.status(400).json({ ok: false, error: 'id is required' })
        try {
            const data = await store.withTransaction(async (tx) => store.getConversationWithContact(tx, id))
            if (!data) return res.status(404).json({ ok: false, error: 'conversation not found' })
            res.json({ ok: true, data })
        } catch (e) {
            res.status(500).json({ ok: false, error: e?.message || String(e) })
        }
    })

    router.get('/conversations/:id/messages', requireDebugToken, async (req, res) => {
        if (!config.databaseUrl) return res.status(503).json({ ok: false, error: 'DATABASE_URL not configured' })
        const id = String(req.params.id || '').trim()
        if (!id) return res.status(400).json({ ok: false, error: 'id is required' })
        const limit = Number(req.query?.limit || 50)
        const before = req.query?.before || req.query?.cursor || null
        try {
            const data = await store.withTransaction(async (tx) => {
                return store.listMessagesByConversation(tx, { conversationId: id, limit, before })
            })
            const hasMore = Array.isArray(data) && data.length >= Math.max(1, Math.min(200, Number(limit || 50)))
            res.json({ ok: true, data, meta: { limit, before: before || null, hasMore } })
        } catch (e) {
            res.status(500).json({ ok: false, error: e?.message || String(e) })
        }
    })

    router.post('/conversations/:id/patch', requireExecToken, async (req, res) => {
        if (!config.databaseUrl) return res.status(503).json({ ok: false, error: 'DATABASE_URL not configured' })
        const id = String(req.params.id || '').trim()
        if (!id) return res.status(400).json({ ok: false, error: 'id is required' })
        const patch = {
            stage: typeof req.body?.stage === 'string' ? req.body.stage.trim() : undefined,
            lead_speed_class: typeof req.body?.lead_speed_class === 'string' ? req.body.lead_speed_class.trim() : undefined,
            procedure_code: typeof req.body?.procedure_code === 'string' ? req.body.procedure_code.trim() : undefined,
            procedure_confidence: typeof req.body?.procedure_confidence === 'number' ? req.body.procedure_confidence : undefined,
        }
        if (!patch.stage && !patch.lead_speed_class && !patch.procedure_code && typeof patch.procedure_confidence === 'undefined') {
            return res.status(400).json({ ok: false, error: 'no valid patch fields provided' })
        }
        try {
            const data = await store.withTransaction(async (tx) => {
                return store.updateConversation(tx, id, patch)
            })
            if (!data) return res.status(404).json({ ok: false, error: 'conversation not found' })
            res.json({ ok: true, data })
        } catch (e) {
            res.status(500).json({ ok: false, error: e?.message || String(e) })
        }
    })

    router.post('/tasks/claim', requireExecToken, async (req, res) => {
        if (!config.databaseUrl) return res.status(503).json({ ok: false, error: 'DATABASE_URL not configured' })
        const limit = Number(req.body?.limit || config.tasksClaimLimit || 20)
        try {
            const tasks = await store.withTransaction(async (tx) => {
                return store.claimTasks(tx, { limit, staleMinutes: config.tasksStaleMinutes })
            })
            res.json({ ok: true, data: tasks })
        } catch (e) {
            res.status(500).json({ ok: false, error: e?.message || String(e) })
        }
    })

    router.post('/tasks/complete', requireExecToken, async (req, res) => {
        if (!config.databaseUrl) return res.status(503).json({ ok: false, error: 'DATABASE_URL not configured' })
        const taskId = String(req.body?.taskId || '').trim()
        if (!taskId) return res.status(400).json({ ok: false, error: 'taskId is required' })
        const status = normalizeTaskStatus(req.body?.status || 'done', 'done')
        const error = req.body?.error ? String(req.body.error) : null
        try {
            const row = await store.withTransaction(async (tx) => {
                return store.completeTask(tx, { taskId, status, error })
            })
            if (!row) return res.status(404).json({ ok: false, error: 'task not found' })
            res.json({ ok: true, data: row })
        } catch (e) {
            res.status(500).json({ ok: false, error: e?.message || String(e) })
        }
    })

    router.get('/tasks/stats', requireDebugToken, async (req, res) => {
        if (!config.databaseUrl) return res.status(503).json({ ok: false, error: 'DATABASE_URL not configured' })
        try {
            const data = await store.withTransaction(async (tx) => {
                return store.getTaskStats(tx)
            })
            res.json({ ok: true, data })
        } catch (e) {
            res.status(500).json({ ok: false, error: e?.message || String(e) })
        }
    })

    router.post('/maintenance/cleanup', requireDebugToken, async (req, res) => {
        if (!config.databaseUrl) return res.status(503).json({ ok: false, error: 'DATABASE_URL not configured' })
        const tasksDays = req.body?.tasksDays ?? req.query?.tasksDays
        const deliveryDays = req.body?.deliveryDays ?? req.query?.deliveryDays
        const messagesDays = req.body?.messagesDays ?? req.query?.messagesDays
        try {
            const data = await store.withTransaction(async (tx) => {
                return store.cleanupOldData(tx, { tasksDays, deliveryDays, messagesDays })
            })
            res.json({ ok: true, data })
        } catch (e) {
            res.status(500).json({ ok: false, error: e?.message || String(e) })
        }
    })

    async function handleIngest(req, res, overrideEnvelope = null) {
        if (!config.databaseUrl) return res.status(503).json({ ok: false, error: 'DATABASE_URL not configured' })

        const envelope = overrideEnvelope || (req.body && typeof req.body === 'object' ? req.body : {})
        let payload = envelope?.payload && typeof envelope.payload === 'object' ? envelope.payload : envelope

        if (!payload || typeof payload !== 'object') {
            return res.status(400).json({ ok: false, error: 'payload is required' })
        }

        const channelSlug = resolveUnitSlugFromChannel(config, payload?.webhook_info?.channelId || payload?.channelId)
        const unitSlug = sanitizeUnitSlug(channelSlug || deriveUnitSlug(payload)) || config?.defaults?.unitSlug || 'unknown'
        const instanceName = String(payload?.instance || '').trim() || config?.defaults?.instanceName || ''
        const phoneRaw = onlyDigits(payload?.contact?.phone?.raw || payload?.contact?.waJid || '')
        if (!phoneRaw) return res.status(400).json({ ok: false, error: 'contact.phone.raw (digits) is required' })

        const displayName = payload?.contact?.name || payload?.message_info?.sender_name || payload?.contact?.displayName || null
        const waJid = payload?.contact?.waJid || null
        const providerMessageId = deriveProviderMessageId(envelope, payload)

        auditLog(req, { event: 'ingest_received', unitSlug, phone: phoneRaw, provider_message_id: providerMessageId })

        try {
            const result = await store.withTransaction(async (tx) => {
                const lockKey = `${unitSlug}:${phoneRaw}`
                await store.lockForKey(tx, lockKey)

                const unit = await store.getOrCreateUnit(tx, unitSlug, instanceName)
                payload = applyPayloadDefaults({ payload, unit, config, envelope, instanceName })
                const contact = await store.upsertContact(tx, { phoneRaw, waJid, displayName })
                const conversation = await store.getOrCreateConversation(tx, {
                    unitId: unit.id,
                    contactId: contact.id,
                    leadSpeedClass: payload?.origin?.leadSpeedClass || null,
                })

                const inboundText = String(payload?.message?.text || payload?.message_info?.text || '').trim() || null

                const rawStored = config.storeRaw
                    ? redactSecrets({ envelope, payload })
                    : redactSecrets({
                        envelope: { source: envelope?.source || null, receivedAt: envelope?.receivedAt || null, event: envelope?.event || null },
                        payload: {
                            unitSlug: payload?.unitSlug || null,
                            instance: payload?.instance || null,
                            attendant: payload?.attendant || null,
                            CTA: payload?.CTA || null,
                            workingHours: payload?.workingHours || null,
                            contact: payload?.contact || null,
                            message: payload?.message || null,
                            message_info: payload?.message_info || null,
                            origin: payload?.origin || null,
                            campaign: payload?.campaign || null,
                            ad: payload?.ad || null,
                            webhook_info: payload?.webhook_info || null,
                        },
                    })

                const insertedInbound = await store.insertMessage(tx, {
                    conversationId: conversation.id,
                    direction: 'inbound',
                    providerMessageId,
                    text: inboundText,
                    raw: rawStored,
                })

                await store.updateConversation(tx, conversation.id, { last_inbound_at: new Date().toISOString() })

                if (!insertedInbound) {
                    return {
                        ok: true,
                        conversation: { id: conversation.id, unitSlug: unit.slug, stage: conversation.stage },
                        decision: { shouldProcess: true, reason: 'deduped', handoff: { needed: false, why: null } },
                        actions: [],
                    }
                }

                const outboundCount = await store.countOutbound(tx, conversation.id)

                const decisionOut = await decideHarmoniaActions({
                    envelope,
                    payload,
                    unit,
                    contact,
                    conversation,
                    outboundCount,
                    providers,
                    config,
                    now: envelope?.receivedAt || null,
                })

                if (decisionOut?.optOut) {
                    await store.markOptOut(tx, contact.id)
                }

                const tasks = Array.isArray(decisionOut?.tasks) ? decisionOut.tasks : []
                for (const t of tasks) {
                    await store.createTask(tx, {
                        conversationId: conversation.id,
                        type: String(t.type || ''),
                        runAt: String(t.runAt || ''),
                        payload: t.payload || null,
                    })
                }

                const actions = Array.isArray(decisionOut?.actions) ? decisionOut.actions : []
                let outboundIdx = 0
                for (const a of actions) {
                    if (a?.type !== 'send_message') continue
                    const plannedId = store.stablePlannedMessageId(providerMessageId, outboundIdx++, a.text || '')
                    await store.insertMessage(tx, {
                        conversationId: conversation.id,
                        direction: 'outbound',
                        providerMessageId: plannedId,
                        text: String(a.text || ''),
                        raw: redactSecrets({ planned: true, action: a }),
                    })
                }

                if (config.autoExecute) {
                    let runAt = Date.now()
                    for (const a of actions) {
                        if (a?.type === 'wait') {
                            const seconds = Number(a?.seconds || 0)
                            if (Number.isFinite(seconds) && seconds > 0) runAt += seconds * 1000
                            continue
                        }
                        if (a?.type === 'send_message') {
                            await store.createTask(tx, {
                                conversationId: conversation.id,
                                type: 'SEND_MESSAGE',
                                runAt: new Date(runAt).toISOString(),
                                payload: {
                                    unitSlug: unit.slug,
                                    to: a.to,
                                    text: a.text,
                                    channelId: a.channelId || null,
                                },
                            })
                        }
                        if (a?.type === 'notify_internal') {
                            await store.createTask(tx, {
                                conversationId: conversation.id,
                                type: 'NOTIFY_INTERNAL',
                                runAt: new Date(runAt).toISOString(),
                                payload: {
                                    unitSlug: a.unitSlug || unit.slug,
                                    text: a.text,
                                },
                            })
                        }
                    }
                }

                if (decisionOut?.conversationPatch) {
                    await store.updateConversation(tx, conversation.id, decisionOut.conversationPatch)
                }

                const updated = await tx.query('select * from harmonia.conversations where id=$1 limit 1', [conversation.id])
                const row = updated.rows?.[0] || conversation

                return {
                    ok: true,
                    conversation: { id: conversation.id, unitSlug: unit.slug, stage: row.stage },
                    decision: decisionOut?.decision || { shouldProcess: true, reason: null, handoff: { needed: false, why: null } },
                    actions,
                }
            })

            auditLog(req, {
                event: 'ingest_decided',
                conversation_id: result?.conversation?.id || null,
                unitSlug,
                stage: result?.conversation?.stage || null,
                reason: result?.decision?.reason || null,
                handoff_needed: Boolean(result?.decision?.handoff?.needed),
                action_types: Array.isArray(result?.actions) ? result.actions.map((a) => a.type) : [],
            })

            return res.json(result)
        } catch (e) {
            auditLog(req, { event: 'ingest_failed', unitSlug, error: e?.message || String(e) })
            return res.status(500).json({ ok: false, error: e?.message || String(e) })
        }
    }

    router.post('/webhook/official', async (req, res) => {
        const body = req.body && typeof req.body === 'object' ? req.body : {}
        if (body?.event !== 'message_received') return res.json({ ok: true })
        const signature = verifyWebhookSignature(req, config)
        if (!signature.ok) {
            return res.status(401).json({ ok: false, error: signature.error || 'invalid_signature' })
        }
        const channelId = body?.channelId || body?.channel_id || req.headers['x-channel-id'] || null
        const payload = buildPayloadFromOfficialWebhook({ body, config, channelId })
        const envelope = { source: 'official-webhook', receivedAt: new Date().toISOString(), event: { id: body?.eventId || null }, payload }
        return handleIngest(req, res, envelope)
    })

    router.post('/webhook/evolution', async (req, res) => {
        const body = req.body && typeof req.body === 'object' ? req.body : {}
        const payload = buildPayloadFromEvolutionWebhook({ body, config })
        const eventId =
            payload?.message_info?.message_id ||
            payload?.message?.id ||
            body?.eventId ||
            body?.body?.data?.key?.id ||
            null
        const envelope = { source: 'evolution-webhook', receivedAt: new Date().toISOString(), event: { id: eventId }, payload }
        return handleIngest(req, res, envelope)
    })

    router.post('/delivery', requireExecToken, async (req, res) => {
        if (!config.databaseUrl) return res.status(503).json({ ok: false, error: 'DATABASE_URL not configured' })

        const providerMessageId = String(req.body?.providerMessageId || req.body?.messageId || '').trim()
        if (!providerMessageId) return res.status(400).json({ ok: false, error: 'providerMessageId is required' })

        const unitSlug = sanitizeUnitSlug(
            req.body?.unitSlug || req.body?.unit || req.body?.instance || deriveUnitSlug(req.body || {})
        ) || 'unknown'
        const phoneRaw =
            onlyDigits(req.body?.phoneRaw || req.body?.phone || req.body?.contact?.phone?.raw || req.body?.contact?.phone || '')
        const status = normalizeStatus(req.body?.status || 'sent', 'sent')
        const error = req.body?.error ? String(req.body.error) : null

        try {
            const result = await store.withTransaction(async (tx) => {
                let conversation = null
                if (req.body?.conversationId) {
                    const r = await tx.query('select * from harmonia.conversations where id=$1 limit 1', [req.body.conversationId])
                    conversation = r.rows?.[0] || null
                } else if (phoneRaw) {
                    conversation = await store.findConversationByUnitPhone(tx, { unitSlug, phoneRaw })
                }

                if (!conversation) return null

                const raw = redactSecrets({ payload: req.body || null })
                await store.insertDeliveryEvent(tx, {
                    conversationId: conversation.id,
                    providerMessageId,
                    status,
                    error,
                    raw,
                })
                await store.updateConversation(tx, conversation.id, { last_outbound_at: new Date().toISOString() })
                return { conversationId: conversation.id }
            })

            if (!result) return res.status(404).json({ ok: false, error: 'conversation not found' })
            res.json({ ok: true })
        } catch (e) {
            res.status(500).json({ ok: false, error: e?.message || String(e) })
        }
    })

    router.post('/ingest', requireIngestToken, async (req, res) => {
        return handleIngest(req, res)
    })

    return router
}
