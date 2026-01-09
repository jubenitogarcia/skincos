import express from 'express'
import cors from 'cors'
import { randomUUID } from 'crypto'
import { promises as fs } from 'fs'
import fsSync from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { spawn } from 'child_process'
import { createProxyMiddleware } from 'http-proxy-middleware'

// WhatsApp Orchestrator (backend-only)
import { whatsappOrchestrator } from './services/whatsappOrchestrator.js'

// Axios for facade requests to Unified System
import axios from 'axios'

// Base directory resolution (compatível com ESM)
const __dirname = path.dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = path.resolve(__dirname, '..', '..', '..')
const BACKEND_ROOT = path.join(REPO_ROOT, 'backend')
const CRM_UI_DIR = process.env.CRM_UI_DIR || path.join(REPO_ROOT, 'frontend')
const VAR_DIR = process.env.VAR_DIR || path.join(BACKEND_ROOT, 'var')
const CORE_STATE_DIR = path.join(VAR_DIR, 'core')

try { await fs.mkdir(CORE_STATE_DIR, { recursive: true }) } catch { /* ignore */ }

const app = express()

// -------------------------------------------------------------
// Capabilities catalog (core + capabilities)
// -------------------------------------------------------------
const CAPABILITIES_FILE = process.env.SKINCOS_CAPABILITIES_FILE ||
    path.join(BACKEND_ROOT, 'capabilities.json')

async function probeUrl(url, timeoutMs = 1200) {
    const started = Date.now()
    const ctrl = new AbortController()
    const t = setTimeout(() => ctrl.abort(), timeoutMs)
    try {
        const r = await fetch(url, { signal: ctrl.signal })
        return { ok: r.ok, status: r.status, ms: Date.now() - started, url }
    } catch (e) {
        return { ok: false, error: e?.message || String(e), ms: Date.now() - started, url }
    } finally {
        clearTimeout(t)
    }
}

async function probeFirstOk(urls, timeoutMs = 1200) {
    const results = []
    for (const u of urls.filter(Boolean)) {
        const res = await probeUrl(u, timeoutMs)
        results.push(res)
        if (res.ok) return { ok: true, primary: res, attempts: results }
    }
    return { ok: false, primary: results[0] || null, attempts: results }
}

app.get('/api/core/capabilities', async (req, res) => {
    try {
        const raw = await fs.readFile(CAPABILITIES_FILE, 'utf-8')
        const data = JSON.parse(raw)
        res.json({ ok: true, data })
    } catch (e) {
        res.status(404).json({ ok: false, error: 'Capabilities catalog not available', path: CAPABILITIES_FILE })
    }
})

app.get('/api/core/capabilities/:id', async (req, res) => {
    try {
        const raw = await fs.readFile(CAPABILITIES_FILE, 'utf-8')
        const data = JSON.parse(raw)
        const id = String(req.params.id || '')
        const found = (data?.capabilities || []).find(c => c && c.id === id) || (data?.core && data.core[id])
        if (!found) return res.status(404).json({ ok: false, error: 'Capability not found', id })
        res.json({ ok: true, data: found })
    } catch (e) {
        res.status(404).json({ ok: false, error: 'Capabilities catalog not available', path: CAPABILITIES_FILE })
    }
})

// -------------------------------------------------------------
// Platform status (ports/health) for UI (non-programmers friendly)
// -------------------------------------------------------------
app.get('/api/core/status', async (req, res) => {
    try {
        const raw = await fs.readFile(CAPABILITIES_FILE, 'utf-8')
        const catalog = JSON.parse(raw)
        const core = catalog?.core || {}
        const capabilities = catalog?.capabilities || []

        const out = {
            ok: true,
            ts: new Date().toISOString(),
            core: {},
            capabilities: {}
        }

        // Core checks (frontend + api ports)
        for (const k of Object.keys(core)) {
            const item = core[k]
            if (!item || typeof item !== 'object') continue
            const ports = item.ports || {}
            const checks = {}
            const open = {}
            const candidates = []

            const fe = ports.frontend
            const api = ports.api
            if (typeof fe === 'number') {
                open.frontend = `http://localhost:${fe}`
                candidates.push({ key: 'frontend', urls: [`http://localhost:${fe}/health`, `http://localhost:${fe}/api/health`] })
            }
            if (typeof api === 'number') {
                open.api = `http://localhost:${api}`
                candidates.push({ key: 'api', urls: [`http://localhost:${api}/api/health`, `http://localhost:${api}/health`] })
            }

            for (const c of candidates) {
                checks[c.key] = await probeFirstOk(c.urls, 1200)
            }

            const allOk = Object.values(checks).every((v) => v && v.ok)
            out.core[item.id || k] = {
                id: item.id || k,
                kind: item.kind || 'core',
                path: item.path,
                ports,
                open,
                ok: allOk,
                checks
            }
        }

        // Capability checks (single base/default port + health path)
        for (const cap of capabilities) {
            if (!cap || typeof cap !== 'object') continue
            const id = cap.id
            const ports = cap.ports || {}
            const health = cap.health || {}

            const basePort = typeof ports.base === 'number' ? ports.base : (typeof ports.default === 'number' ? ports.default : null)
            const openUrl = basePort ? `http://localhost:${basePort}` : null

            const healthCandidates = []
            if (openUrl && health.path) healthCandidates.push(openUrl + health.path)
            if (openUrl && health.alt) healthCandidates.push(openUrl + health.alt)
            if (openUrl && !health.path && !health.alt) {
                // Best-effort defaults
                healthCandidates.push(openUrl + '/health', openUrl + '/api/health', openUrl)
            }

            const probe = healthCandidates.length ? await probeFirstOk(healthCandidates, 1500) : { ok: false, primary: null, attempts: [] }

            out.capabilities[id] = {
                id,
                label: cap.label || id,
                kind: cap.kind,
                path: cap.path,
                ports,
                open: openUrl,
                health,
                ok: probe.ok,
                probe
            }
        }

        res.json(out)
    } catch (e) {
        res.status(500).json({ ok: false, error: e?.message || String(e) })
    }
})

// Critical: Enhanced CORS configuration to prevent API access issues
app.use(cors({
    origin: true, // Allow all origins in development
    credentials: true, // Essential for SSE/EventSource and auth cookies
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS', 'PATCH'],
    allowedHeaders: ['Content-Type', 'Authorization', 'Cache-Control', 'X-Requested-With', 'Accept'],
    exposedHeaders: ['Content-Length', 'X-Total-Count'],
    optionsSuccessStatus: 200 // Legacy browser support
}))

// Handle preflight OPTIONS requests early to prevent middleware conflicts
app.use((req, res, next) => {
    if (req.method === 'OPTIONS') {
        res.header('Access-Control-Allow-Origin', req.headers.origin || '*')
        res.header('Access-Control-Allow-Methods', 'GET,POST,PUT,DELETE,OPTIONS,PATCH')
        res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization, Cache-Control, X-Requested-With, Accept')
        res.header('Access-Control-Allow-Credentials', 'true')
        return res.sendStatus(200)
    }
    next()
})

// MIGRATION: Temporary 301 redirects for legacy port 3003 to port 3001
app.use((req, res, next) => {
    const userAgent = req.get('User-Agent') || ''
    const host = req.get('Host') || ''

    // Check if request is targeting legacy port 3003 references
    if (host.includes(':3003') || req.headers.referer?.includes(':3003')) {
        const newUrl = `${req.protocol}://${host.replace(':3003', ':3001')}${req.originalUrl}`
        console.log(`🔄 [MIGRATION] 301 Redirect: ${req.url} → port 3001`)
        return res.status(301).redirect(newUrl)
    }

    // Handle legacy WhatsApp API endpoints that might reference old port
    if (req.path.match(/\/api\/whatsapp\/.*/) && req.query.port === '3003') {
        const redirectPath = req.path.replace('/api/whatsapp/', '/whatsapp/channel-1/')
        console.log(`🔄 [MIGRATION] WhatsApp API redirect: ${req.path} → ${redirectPath}`)
        return res.status(301).redirect(redirectPath)
    }

    next()
})

// Enhanced body parser with larger limits and better error handling
app.use(express.json({ limit: '10mb' }))
app.use(express.urlencoded({ extended: true, limit: '10mb' }))

// JSON parse errors (express.json)
app.use((err, req, res, next) => {
    if (err && err instanceof SyntaxError && err.status === 400 && 'body' in err) {
        return res.status(400).json({ success: false, error: 'Invalid JSON payload' })
    }
    next(err)
})

// Smart static file serving - avoid conflicts with API routes
app.use((req, res, next) => {
    // Skip static middleware for API routes, health checks, and special paths
    if (req.path.startsWith('/api/') ||
        req.path.startsWith('/health') ||
        req.path.includes('events') ||
        req.path.startsWith('/auth/')) {
        return next()
    }
    express.static(CRM_UI_DIR)(req, res, next)
})

// -------------------------------------------------------------
// Basic Auth (optional) - set CRM_BASIC_AUTH="user:pass" to enable
// Supports EventSource via query param ?auth=BASE64(user:pass)
// -------------------------------------------------------------
const BASIC_AUTH = process.env.CRM_BASIC_AUTH || ''
let basicAuthUser = null, basicAuthPass = null
if (BASIC_AUTH && BASIC_AUTH.includes(':')) {
    const [u, p] = BASIC_AUTH.split(':'); basicAuthUser = u; basicAuthPass = p
}
function authOk(req) {
    if (!basicAuthUser) return true
    const h = req.headers['authorization']
    if (h && h.startsWith('Basic ')) {
        const dec = Buffer.from(h.slice(6), 'base64').toString()
        if (dec === BASIC_AUTH) return true
    }
    // allow query for SSE
    if (req.query && req.query.auth) {
        try { const dec = Buffer.from(String(req.query.auth), 'base64').toString(); if (dec === BASIC_AUTH) return true } catch { }
    }
    return false
}
// Enhanced auth middleware with intelligent API route handling
app.use((req, res, next) => {
    // Skip auth entirely if not configured
    if (!basicAuthUser) return next()

    // Always allow preflight OPTIONS and health checks
    if (req.method === 'OPTIONS' || req.path.startsWith('/health')) {
        return next()
    }

    // Special handling for SSE/EventSource endpoints - they need query-based auth
    if (req.path.includes('/events')) {
        if (req.query && req.query.auth) {
            try {
                const dec = Buffer.from(String(req.query.auth), 'base64').toString()
                if (dec === BASIC_AUTH) return next()
            } catch (e) {
                console.warn('[AUTH] Invalid query auth for SSE:', e.message)
            }
        }
        // For SSE without query auth, try normal auth
        if (authOk(req)) return next()
        // SSE endpoints get a different error format
        return res.status(401).json({
            success: false,
            error: 'Authentication required for event stream',
            hint: 'Add ?auth=BASE64(user:pass) to URL for EventSource'
        })
    }

    // Try normal authentication
    if (authOk(req)) return next()

    // Return appropriate error format based on request type
    if (req.path.startsWith('/api/')) {
        // JSON error for API endpoints (better for frontend error handling)
        return res.status(401).json({
            success: false,
            error: 'Authentication required',
            code: 'AUTH_REQUIRED'
        })
    } else {
        // WWW-Authenticate for browser requests (triggers basic auth dialog)
        res.setHeader('WWW-Authenticate', 'Basic realm="CRM"')
        return res.status(401).json({ success: false, error: 'auth required' })
    }
})

// =================================================================
// Jobs Runner (local) - start automations from the UI
// =================================================================
const JOBS_DIR = path.join(VAR_DIR, 'jobs')
try { await fs.mkdir(JOBS_DIR, { recursive: true }) } catch { /* ignore */ }

const jobs = new Map()

function normalizeJobName(name) {
    return String(name || '').trim().toLowerCase()
}

function validateEnum(value, allowed, label) {
    if (!allowed.includes(value)) {
        throw new Error(`${label} inválido: ${value}. Permitidos: ${allowed.join(', ')}`)
    }
    return value
}

function buildJobCommand(job, params = {}) {
    const name = normalizeJobName(job)
    if (name === 'sales-chart-messenger') {
        const mode = validateEnum(String(params.mode || 'diagnose'), ['run', 'test', 'diagnose'], 'mode')
        const period = validateEnum(String(params.period || 'morning'), ['morning', 'evening'], 'period')
        const cellSet = params.cell_set ? validateEnum(String(params.cell_set), ['bss', 'nh'], 'cell_set') : null
        const force = Boolean(params.force)

        if ((mode === 'run' || mode === 'test') && !cellSet) {
            throw new Error('cell_set é obrigatório para mode run/test (bss|nh)')
        }

        const args = ['-m', 'apps.automations.sales_chart_messenger', '--mode', mode, '--period', period]
        if (force) args.push('--force')
        if (cellSet) args.push(cellSet)

        return { cmd: 'python3', args }
    }

    if (name === 'scheduled-posting') {
        const mode = validateEnum(String(params.mode || 'diagnose'), ['run', 'test', 'diagnose'], 'mode')
        return { cmd: 'python3', args: ['-m', 'apps.automations.scheduled_posting', '--mode', mode] }
    }

    throw new Error(`Job desconhecido: ${job}`)
}

function startJob(job, params = {}) {
    const jobId = randomUUID()
    const startedAt = new Date().toISOString()
    const { cmd, args } = buildJobCommand(job, params)

    const logPath = path.join(JOBS_DIR, `${jobId}.log`)
    const meta = {
        id: jobId,
        job: normalizeJobName(job),
        params,
        status: 'running',
        startedAt,
        endedAt: null,
        exitCode: null,
        logPath
    }
    jobs.set(jobId, meta)

    const child = spawn(cmd, args, {
        cwd: BACKEND_ROOT,
        env: { ...process.env },
        stdio: ['ignore', 'pipe', 'pipe']
    })

    const out = fsSync.createWriteStream(logPath, { flags: 'a' })
    out.write(`=== JOB START ${startedAt} ===\n`)
    out.write(`job=${meta.job}\n`)
    out.write(`cmd=${cmd} ${args.join(' ')}\n\n`)

    child.stdout?.pipe(out)
    child.stderr?.pipe(out)

    child.on('close', (code) => {
        const endedAt = new Date().toISOString()
        out.write(`\n=== JOB END ${endedAt} (code=${code}) ===\n`)
        out.end()
        meta.status = 'done'
        meta.endedAt = endedAt
        meta.exitCode = code
        jobs.set(jobId, meta)
    })

    child.on('error', (err) => {
        const endedAt = new Date().toISOString()
        out.write(`\n=== JOB ERROR ${endedAt} ===\n${err?.message || err}\n`)
        out.end()
        meta.status = 'error'
        meta.endedAt = endedAt
        meta.exitCode = null
        jobs.set(jobId, meta)
    })

    return meta
}

function listJobs(limit = 50) {
    const arr = Array.from(jobs.values())
    arr.sort((a, b) => String(b.startedAt || '').localeCompare(String(a.startedAt || '')))
    return arr.slice(0, limit)
}

function readJobLogTail(jobId, lines = 200) {
    const meta = jobs.get(jobId)
    if (!meta) return null
    const p = meta.logPath
    try {
        const raw = fsSync.readFileSync(p, 'utf-8')
        const all = raw.split('\n')
        return all.slice(Math.max(0, all.length - lines)).join('\n')
    } catch {
        return ''
    }
}

app.post('/api/jobs/run', async (req, res) => {
    try {
        const job = req.body?.job
        const params = req.body?.params || {}
        const meta = startJob(job, params)
        res.json({ ok: true, job: meta })
    } catch (e) {
        res.status(400).json({ ok: false, error: e?.message || String(e) })
    }
})

app.get('/api/jobs', async (req, res) => {
    const limit = Math.max(1, Math.min(200, parseInt(String(req.query?.limit || '50'), 10) || 50))
    res.json({ ok: true, jobs: listJobs(limit) })
})

app.get('/api/jobs/:id', async (req, res) => {
    const id = String(req.params.id || '')
    const meta = jobs.get(id)
    if (!meta) return res.status(404).json({ ok: false, error: 'Job not found', id })
    res.json({ ok: true, job: meta })
})

app.get('/api/jobs/:id/log', async (req, res) => {
    const id = String(req.params.id || '')
    const meta = jobs.get(id)
    if (!meta) return res.status(404).json({ ok: false, error: 'Job not found', id })
    const lines = Math.max(10, Math.min(2000, parseInt(String(req.query?.lines || '200'), 10) || 200))
    const tail = readJobLogTail(id, lines)
    res.json({ ok: true, id, lines, logPath: meta.logPath, tail })
})

// Conversations (file-based persistence)
const CONVERSATIONS_FILE = process.env.CRM_CONVERSATIONS_FILE || path.join(CORE_STATE_DIR, 'conversations_store.json')
let conversations = [
    {
        conversationId: '1',
        status: 'active',
        participants: ['user1', 'bot'],
        lastMessage: 'Olá, como posso ajudar?',
        updatedAt: new Date().toISOString(),
        humanInControl: false,
        forwardedTo: null,
        archived: false,
        humanTyping: false,
        aiTyping: false
    },
    {
        conversationId: '2',
        status: 'pending',
        participants: ['user2', 'bot'],
        lastMessage: 'Preciso de um especialista.',
        updatedAt: new Date().toISOString(),
        humanInControl: false,
        forwardedTo: null,
        archived: false,
        humanTyping: false,
        aiTyping: false
    },
]
let saveConversationsTimer = null
async function loadConversations() {
    try {
        const raw = await fs.readFile(CONVERSATIONS_FILE, 'utf-8')
        const json = JSON.parse(raw)
        if (json && Array.isArray(json.conversations)) {
            conversations = json.conversations
        }
    } catch { /* ignore */ }
}
async function persistConversationsNow() {
    try { await fs.writeFile(CONVERSATIONS_FILE, JSON.stringify({ conversations }, null, 2)) } catch (e) { console.error('[CONVERSATIONS] Persist failed', e) }
}
function schedulePersistConversations() {
    if (saveConversationsTimer) clearTimeout(saveConversationsTimer)
    saveConversationsTimer = setTimeout(() => { persistConversationsNow() }, 500).unref()
}
await loadConversations()

// Replit Auth Integration (optional)
// Default OFF to reduce dependencies for internal usage. Enable with ENABLE_REPLIT_AUTH=1.
if (process.env.ENABLE_REPLIT_AUTH === '1') {
    try {
        const { registerAuthRoutes } = await import('./server/routes.js')
        await registerAuthRoutes(app)
        console.log('✅ Replit Auth configured successfully')
    } catch (error) {
        console.warn('⚠️  Replit Auth setup failed, continuing without auth:', error.message)
    }
} else {
    console.log('ℹ️  Replit Auth disabled (set ENABLE_REPLIT_AUTH=1 to enable)')
}

// In-memory message store: { conversationId: [{ id, conversationId, direction, type, text, mediaType, createdAt }] }
const messages = {}

// Persistence (messages)
const MESSAGES_FILE = process.env.CRM_MESSAGES_FILE || path.join(CORE_STATE_DIR, 'messages_store.json')
let saveMessagesTimer = null
async function loadMessages() {
    try {
        const raw = await fs.readFile(MESSAGES_FILE, 'utf-8')
        const json = JSON.parse(raw)
        if (json && typeof json === 'object' && json.messages) {
            for (const [k, arr] of Object.entries(json.messages)) {
                if (Array.isArray(arr)) messages[k] = arr
            }
            // Rehydrate conversation lastMessage / updatedAt
            for (const conv of conversations) {
                const list = messages[conv.conversationId]
                if (list && list.length) {
                    const last = list[list.length - 1]
                    conv.lastMessage = last.text || last.caption || last.type || conv.lastMessage
                    conv.updatedAt = last.createdAt
                }
            }
        }
    } catch { /* ignore */ }
}
async function persistMessagesNow() {
    try {
        await fs.writeFile(MESSAGES_FILE, JSON.stringify({ messages }, null, 2))
    } catch (e) { console.error('[MESSAGES] Persist failed', e) }
}
function schedulePersistMessages() {
    if (saveMessagesTimer) clearTimeout(saveMessagesTimer)
    saveMessagesTimer = setTimeout(() => { persistMessagesNow() }, 500).unref()
}
await loadMessages()
function ensureConv(convId) {
    if (!messages[convId]) messages[convId] = []
}
function addMessage(convId, msg) {
    ensureConv(convId)
    const record = { id: 'm_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8), conversationId: convId, createdAt: new Date().toISOString(), ...msg }
    messages[convId].push(record)
    // update conversation lastMessage / updatedAt
    const c = conversations.find(c => c.conversationId === convId)
    if (c) { c.lastMessage = msg.text || msg.caption || msg.type || 'mensagem'; c.updatedAt = record.createdAt; schedulePersistConversations(); broadcastConversationUpdate(c) }
    schedulePersistMessages()
    return record
}

// -------------------------------------------------------------
// Unit Monitor (smartcams) - lightweight persistence (file-based)
// Stores per-unit config (favorites + recording prefs) + recording metadata
// -------------------------------------------------------------
const UNIT_MONITOR_FILE = process.env.CRM_UNIT_MONITOR_FILE || path.join(CORE_STATE_DIR, 'unit_monitor.json')
let unitMonitorState = { units: {}, recordings: [] }
let saveUnitMonitorTimer = null

function normalizeUnitKey(value) {
    const v = String(value || '').trim()
    if (!v) return ''
    return v.toLowerCase()
}

async function loadUnitMonitorState() {
    try {
        const raw = await fs.readFile(UNIT_MONITOR_FILE, 'utf-8')
        const json = JSON.parse(raw)
        if (json && typeof json === 'object') {
            const units = json.units && typeof json.units === 'object' ? json.units : {}
            const recordings = Array.isArray(json.recordings) ? json.recordings : []
            unitMonitorState = { units, recordings }
        }
    } catch { /* ignore */ }
}

async function persistUnitMonitorNow() {
    try {
        await fs.writeFile(UNIT_MONITOR_FILE, JSON.stringify(unitMonitorState, null, 2))
    } catch (e) {
        console.error('[UNIT_MONITOR] Persist failed', e)
    }
}

function schedulePersistUnitMonitor() {
    if (saveUnitMonitorTimer) clearTimeout(saveUnitMonitorTimer)
    saveUnitMonitorTimer = setTimeout(() => { persistUnitMonitorNow() }, 500).unref()
}

await loadUnitMonitorState()

app.get('/api/unit-monitor/state', async (req, res) => {
    const unit = normalizeUnitKey(req.query?.unit || '')
    if (!unit) {
        return res.json({ ok: true, units: Object.keys(unitMonitorState.units || {}), state: unitMonitorState })
    }
    const entry = (unitMonitorState.units || {})[unit] || null
    return res.json({ ok: true, unit, ...entry })
})

app.put('/api/unit-monitor/state', async (req, res) => {
    const unit = normalizeUnitKey(req.query?.unit || req.body?.unit || '')
    if (!unit) return res.status(400).json({ ok: false, error: 'Missing unit' })
    const config = req.body?.config
    if (!config || typeof config !== 'object') return res.status(400).json({ ok: false, error: 'Missing config' })

    if (!unitMonitorState.units || typeof unitMonitorState.units !== 'object') unitMonitorState.units = {}
    unitMonitorState.units[unit] = {
        unit,
        updatedAt: new Date().toISOString(),
        config
    }
    schedulePersistUnitMonitor()
    res.json({ ok: true, unit, saved: true })
})

app.post('/api/unit-monitor/recordings', async (req, res) => {
    const unit = normalizeUnitKey(req.body?.unit || '')
    const filename = String(req.body?.filename || '').trim()
    if (!unit || !filename) return res.status(400).json({ ok: false, error: 'Missing unit or filename' })

    const entry = {
        id: 'rec_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8),
        unit,
        filename,
        createdAt: req.body?.createdAt || new Date().toISOString(),
        durationSeconds: Number(req.body?.durationSeconds || 0) || 0,
        sizeBytes: Number(req.body?.sizeBytes || 0) || 0,
        mimeType: req.body?.mimeType || null,
        savedPath: req.body?.savedPath || null
    }

    if (!Array.isArray(unitMonitorState.recordings)) unitMonitorState.recordings = []
    unitMonitorState.recordings.push(entry)
    if (unitMonitorState.recordings.length > 2000) {
        unitMonitorState.recordings = unitMonitorState.recordings.slice(-2000)
    }
    schedulePersistUnitMonitor()
    res.json({ ok: true, recording: entry })
})

app.get('/api/unit-monitor/recordings', async (req, res) => {
    const unit = normalizeUnitKey(req.query?.unit || '')
    const all = Array.isArray(unitMonitorState.recordings) ? unitMonitorState.recordings : []
    const filtered = unit ? all.filter(r => r.unit === unit) : all
    res.json({ ok: true, unit: unit || null, recordings: filtered })
})

// Persistent suppression store (conversationId -> resumeAt ISO)
const SUPPRESSION_FILE = process.env.CRM_SUPPRESSION_FILE || path.join(CORE_STATE_DIR, 'ai_suppression.json')
let aiSuppression = {}
let suppressionMetrics = { totalSuppressions: 0, totalResumes: 0 }
// In-memory diagnostics: last start attempts per instance
const lastStartDiag = {}

// Enhanced SSE client management with race condition prevention
const sseClients = new Set()
const convEventClients = new Set()

// Enhanced SSE broadcast with connection health checks and cleanup
function sseBroadcast(payload) {
    if (sseClients.size === 0) return

    const data = `data: ${JSON.stringify({ ...payload, timestamp: new Date().toISOString() })}\n\n`
    const deadClients = new Set()

    for (const res of sseClients) {
        try {
            if (res.destroyed || res.writableEnded) {
                deadClients.add(res)
                continue
            }
            res.write(data)
        } catch (error) {
            console.warn('[SSE] Client write failed, marking for cleanup:', error.message)
            deadClients.add(res)
        }
    }

    // Clean up dead clients to prevent memory leaks
    for (const deadClient of deadClients) {
        sseClients.delete(deadClient)
    }
}

// Enhanced conversation broadcast with robust error handling and client cleanup
function broadcastConversationUpdate(conv) {
    if (convEventClients.size === 0) return

    const payload = {
        type: 'conversation-update',
        conversation: conv,
        timestamp: new Date().toISOString()
    }
    const data = `data: ${JSON.stringify(payload)}\n\n`
    const deadClients = new Set()

    for (const res of convEventClients) {
        try {
            if (res.destroyed || res.writableEnded) {
                deadClients.add(res)
                continue
            }
            res.write(data)
        } catch (error) {
            console.warn('[CONV-SSE] Client write failed, marking for cleanup:', error.message)
            deadClients.add(res)
        }
    }

    // Clean up dead clients
    for (const deadClient of deadClients) {
        convEventClients.delete(deadClient)
    }
}

function broadcastNewMessage(message) {
    if (convEventClients.size === 0) return

    const payload = {
        type: 'message',
        message,
        timestamp: new Date().toISOString()
    }
    const data = `data: ${JSON.stringify(payload)}\n\n`
    const deadClients = new Set()

    for (const res of convEventClients) {
        try {
            if (res.destroyed || res.writableEnded) {
                deadClients.add(res)
                continue
            }
            res.write(data)
        } catch (error) {
            console.warn('[MSG-SSE] Client write failed, marking for cleanup:', error.message)
            deadClients.add(res)
        }
    }

    // Clean up dead clients
    for (const deadClient of deadClients) {
        convEventClients.delete(deadClient)
    }
}

async function loadSuppression() {
    try {
        const raw = await fs.readFile(SUPPRESSION_FILE, 'utf-8')
        const json = JSON.parse(raw)
        if (json && typeof json === 'object') aiSuppression = json
    } catch { /* ignore */ }
}
async function saveSuppression() {
    try {
        await fs.writeFile(SUPPRESSION_FILE, JSON.stringify({ aiSuppression, suppressionMetrics }, null, 2))
    } catch (e) { console.error('[SUPPRESSION] Failed to persist', e) }
}
await loadSuppression()

function purgeExpired() {
    const now = Date.now()
    let changed = false
    for (const [k, v] of Object.entries(aiSuppression)) {
        if (new Date(v).getTime() <= now) { delete aiSuppression[k]; changed = true }
    }
    if (changed) saveSuppression()
}
setInterval(purgeExpired, 5 * 60 * 1000).unref()

async function notifyAgentZeroSuppression(conversationId, resumeAt) {
    const target = process.env.AGENT_ZERO_SUPPRESSION_URL || ''
    if (!target) return
    try {
        await fetch(target, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ conversationId, resumeAt, action: 'suppress_24h' })
        })
    } catch (e) { console.warn('[INTERVENTION][notify] Failed to notify agent-zero', e) }
}
async function notifyAgentZeroResume(conversationId) {
    const target = process.env.AGENT_ZERO_SUPPRESSION_URL || ''
    if (!target) return
    try {
        await fetch(target, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ conversationId, action: 'resume' })
        })
    } catch (e) { console.warn('[INTERVENTION][notify] Failed to notify agent-zero (resume)', e) }
}

app.get('/api/conversations/:id/ai-status', (req, res) => {
    const { id } = req.params
    const resumeAt = aiSuppression[id]
    if (resumeAt && new Date(resumeAt) > new Date()) {
        return res.json({ suppressed: true, resumeAt })
    }
    return res.json({ suppressed: false })
})

// List all current suppressions (filtered expired)
app.get('/api/ai-suppression', (req, res) => {
    purgeExpired()
    res.json(aiSuppression)
})

// Metrics endpoint
app.get('/api/ai-suppression/metrics', (req, res) => {
    purgeExpired()
    res.json({ ...suppressionMetrics, activeSuppressions: Object.keys(aiSuppression).length })
})

// AI suggestions proxy to Agent Zero (fallback to local heuristics)
app.post('/api/conversations/:id/ai-suggestions', async (req, res) => {
    const { id } = req.params
    const { messages: context = [], n = 3 } = req.body || {}
    const AGZ_URL = process.env.AGENT_ZERO_SUGGEST_URL || process.env.AGENT_ZERO_COMPLETIONS_URL || ''

    // Local fallback generator
    function localSuggest(latestText) {
        const t = String(latestText || '').trim().toLowerCase()
        const base = [
            'Obrigado pela mensagem! Como posso ajudar?',
            'Posso te explicar as opções e prazos. Quer seguir?',
            'Você poderia me dar um pouco mais de contexto?'
        ]
        if (!t) return base.slice(0, n)
        if (t.includes('preço') || t.includes('valor')) return [
            'O valor depende do escopo/volume. Posso te enviar uma proposta personalizada?',
            'Temos faixas de preço diferentes — posso detalhar agora.',
            'Me diz seu objetivo principal para eu indicar o melhor plano.'
        ].slice(0, n)
        if (t.includes('prazo') || t.includes('quando')) return [
            'Consigo uma estimativa rápida: prefere esta semana ou próxima?',
            'O prazo padrão é 2–3 dias úteis; quer prioridade?',
            'Dependendo do escopo, posso entregar ainda amanhã.'
        ].slice(0, n)
        return base.slice(0, n)
    }

    // Try Agent Zero first if configured
    if (AGZ_URL) {
        try {
            const ctrl = new AbortController()
            const t = setTimeout(() => ctrl.abort(), 7000)
            const r = await fetch(AGZ_URL, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ conversationId: id, messages: context, n }),
                signal: ctrl.signal
            })
            clearTimeout(t)
            if (r.ok) {
                const js = await r.json().catch(() => ({}))
                const sugg = Array.isArray(js?.suggestions) ? js.suggestions : (js?.choices?.map?.(c => c.text)?.filter(Boolean) || [])
                if (sugg && sugg.length) return res.json({ suggestions: sugg.slice(0, n), source: 'agent-zero' })
            }
        } catch (e) {
            // fall through to local
        }
    }
    const latest = Array.isArray(context) && context.length ? (context[context.length - 1]?.text || '') : ''
    return res.json({ suggestions: localSuggest(latest), source: AGZ_URL ? 'fallback-local' : 'local' })
})

// Enhanced SSE stream for suppression events with race condition prevention
app.get('/api/ai-suppression/events', (req, res) => {
    // Comprehensive SSE headers to prevent caching and connection issues
    res.setHeader('Content-Type', 'text/event-stream; charset=utf-8')
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate')
    res.setHeader('Pragma', 'no-cache')
    res.setHeader('Expires', '0')
    res.setHeader('Connection', 'keep-alive')
    res.setHeader('Access-Control-Allow-Origin', req.headers.origin || '*')
    res.setHeader('Access-Control-Allow-Credentials', 'true')
    res.setHeader('X-Accel-Buffering', 'no') // Disable nginx buffering

    // Flush headers immediately
    res.flushHeaders?.()
    res.status(200)

    // Send initial connection confirmation
    try {
        res.write(`data: ${JSON.stringify({ type: 'connected', timestamp: new Date().toISOString() })}\n\n`)

        // Send initial snapshot with error handling
        const snapshot = { type: 'snapshot', suppressions: aiSuppression, timestamp: new Date().toISOString() }
        res.write(`data: ${JSON.stringify(snapshot)}\n\n`)
    } catch (error) {
        console.error('[SSE] Failed to send initial data:', error)
        return res.end()
    }

    // Add client to set with cleanup tracking
    sseClients.add(res)

    // Enhanced cleanup with multiple event handlers to prevent race conditions
    const cleanup = () => {
        sseClients.delete(res)
        try {
            if (!res.destroyed && !res.headersSent) {
                res.end()
            }
        } catch (e) {
            // Ignore cleanup errors
        }
    }

    req.on('close', cleanup)
    req.on('error', cleanup)
    res.on('close', cleanup)
    res.on('error', cleanup)

    // Heartbeat to detect disconnected clients and prevent loading loops
    const heartbeat = setInterval(() => {
        if (res.destroyed || !sseClients.has(res)) {
            clearInterval(heartbeat)
            return
        }
        try {
            res.write(`data: ${JSON.stringify({ type: 'heartbeat', timestamp: new Date().toISOString() })}\n\n`)
        } catch (e) {
            clearInterval(heartbeat)
            cleanup()
        }
    }, 30000) // 30 second heartbeat

    // Clear heartbeat on cleanup
    req.on('close', () => clearInterval(heartbeat))
})

app.get('/api/conversations', (req, res) => {
    const { includeArchived } = req.query
    let list = [...conversations]
    if (!includeArchived) list = list.filter(c => !c.archived)
    // Optionally sort by updatedAt desc
    res.json(list.sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()))
})

// Create a new conversation manually (for testing / manual start)
app.post('/api/conversations', (req, res) => {
    const { conversationId, participants = [], initialMessage } = req.body || {}
    if (!conversationId) return res.status(400).json({ success: false, error: 'conversationId required' })
    let existing = conversations.find(c => c.conversationId === conversationId)
    if (existing) return res.json({ success: true, conversation: existing, existed: true })
    const now = new Date().toISOString()
    const conv = { conversationId, status: 'active', participants, lastMessage: initialMessage || '(iniciada)', updatedAt: now, humanInControl: false, forwardedTo: null, archived: false, humanTyping: false, aiTyping: false }
    conversations.push(conv)
    schedulePersistConversations(); broadcastConversationUpdate(conv)
    if (initialMessage) {
        addMessage(conversationId, { direction: 'human', type: 'text', text: initialMessage })
    }
    res.json({ success: true, conversation: conv })
})

// Enhanced Conversation & messages SSE with comprehensive race condition prevention
app.get('/api/conversations/events', (req, res) => {
    // Comprehensive SSE headers to prevent caching and connection issues
    res.setHeader('Content-Type', 'text/event-stream; charset=utf-8')
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate')
    res.setHeader('Pragma', 'no-cache')
    res.setHeader('Expires', '0')
    res.setHeader('Connection', 'keep-alive')
    res.setHeader('Access-Control-Allow-Origin', req.headers.origin || '*')
    res.setHeader('Access-Control-Allow-Credentials', 'true')
    res.setHeader('X-Accel-Buffering', 'no') // Disable proxy buffering

    // Flush headers and set status immediately
    res.flushHeaders?.()
    res.status(200)

    // Send connection confirmation and initial snapshot with robust error handling
    try {
        // Connection confirmation
        res.write(`data: ${JSON.stringify({ type: 'connected', timestamp: new Date().toISOString() })}\n\n`)

        // Initial conversation snapshot
        const snapshot = {
            type: 'snapshot',
            conversations: conversations.filter(c => !c.archived), // Filter archived by default
            timestamp: new Date().toISOString()
        }
        res.write(`data: ${JSON.stringify(snapshot)}\n\n`)
    } catch (error) {
        console.error('[CONV-SSE] Failed to send initial data:', error)
        return res.end()
    }

    // Add client to tracking set
    convEventClients.add(res)

    // Enhanced cleanup function to prevent memory leaks and race conditions
    const cleanup = () => {
        convEventClients.delete(res)
        try {
            if (!res.destroyed && !res.headersSent) {
                res.end()
            }
        } catch (e) {
            // Ignore cleanup errors - connection likely already closed
        }
    }

    // Multiple event handlers for robust cleanup
    req.on('close', cleanup)
    req.on('error', cleanup)
    req.on('aborted', cleanup)
    res.on('close', cleanup)
    res.on('error', cleanup)
    res.on('finish', cleanup)

    // Heartbeat mechanism to detect stale connections and prevent loading loops
    const heartbeat = setInterval(() => {
        if (res.destroyed || !convEventClients.has(res)) {
            clearInterval(heartbeat)
            return
        }
        try {
            res.write(`data: ${JSON.stringify({
                type: 'heartbeat',
                timestamp: new Date().toISOString(),
                activeConnections: convEventClients.size
            })}\n\n`)
        } catch (e) {
            clearInterval(heartbeat)
            cleanup()
        }
    }, 25000) // 25 second heartbeat

    // Ensure heartbeat is cleared on all cleanup scenarios
    const originalCleanup = cleanup
    const enhancedCleanup = () => {
        clearInterval(heartbeat)
        originalCleanup()
    }

    req.on('close', enhancedCleanup)
    res.on('close', enhancedCleanup)
})

// List messages for a conversation
// Messages listing with pagination. Query params:
//  - limit (default 50)
//  - before (ISO timestamp) -> returns older than timestamp
//  - after (ISO timestamp)  -> returns newer than timestamp (not used by UI yet)
app.get('/api/conversations/:id/messages', (req, res) => {
    const { id } = req.params
    let { limit, before, after } = req.query
    ensureConv(id)
    let list = messages[id]
    let lim = parseInt(String(limit || '50'), 10)
    if (isNaN(lim) || lim <= 0 || lim > 200) lim = 50
    if (before) {
        const ts = new Date(String(before)).getTime()
        list = list.filter(m => new Date(m.createdAt).getTime() < ts)
        list = list.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
        const slice = list.slice(0, lim)
        const result = slice.sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime())
        const hasMore = messages[id].some(m => new Date(m.createdAt).getTime() < new Date(result[0]?.createdAt || 0).getTime())
        return res.json({ items: result, hasMore })
    }
    if (after) {
        const ts = new Date(String(after)).getTime()
        list = list.filter(m => new Date(m.createdAt).getTime() > ts)
        const result = list.sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime())
        return res.json({ items: result, hasMore: false })
    }
    // default: last N
    const ordered = [...list].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
    const slice = ordered.slice(0, lim).sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime())
    const hasMore = list.length > slice.length
    res.json({ items: slice, hasMore })
})

// Append a human / ai / system message (UI helper)
app.post('/api/conversations/:id/messages', (req, res) => {
    const { id } = req.params
    const { direction = 'human', type = 'text', text = '', mediaType, meta } = req.body || {}
    const record = addMessage(id, { direction, type, text, mediaType, meta })
    broadcastNewMessage(record)
    res.json({ success: true, message: record })
})

// Typing indicator
app.post('/api/conversations/:id/typing', (req, res) => {
    const { id } = req.params
    const { actor = 'human', typing = false } = req.body || {}
    const conv = conversations.find(c => c.conversationId === id)
    if (!conv) return res.status(404).json({ success: false, error: 'conversation not found' })
    if (actor === 'human') conv.humanTyping = !!typing
    if (actor === 'ai') conv.aiTyping = !!typing
    broadcastConversationUpdate(conv)
    res.json({ success: true })
})

app.post('/api/actions/:action', (req, res) => {
    const { action } = req.params
    const { conversationId, payload = {} } = req.body || {}
    if (!conversationId) return res.status(400).json({ success: false, error: 'conversationId required' })
    const conv = conversations.find(c => c.conversationId === conversationId)
    if (!conv) return res.status(404).json({ success: false, error: 'conversation not found' })

    let result = null
    const now = new Date().toISOString()
    switch (action) {
        case 'take-control':
            conv.humanInControl = true
            conv.status = 'active'
            result = { message: 'human took control' }
            addMessage(conversationId, { direction: 'system', type: 'event', text: 'Operador assumiu a conversa.' })
            break
        case 'release-control':
            conv.humanInControl = false
            result = { message: 'human released control' }
            addMessage(conversationId, { direction: 'system', type: 'event', text: 'Operador liberou a conversa para IA.' })
            break
        case 'correct-ai':
            {
                const correction = payload.correction || '(sem detalhe)'
                result = { correction }
                addMessage(conversationId, { direction: 'system', type: 'event', text: 'Correção aplicada à resposta da IA: ' + correction })
            }
            break
        case 'add-note':
            addMessage(conversationId, { direction: 'system', type: 'note', text: 'Nota adicionada.' })
            result = { added: true }
            break
        case 'mark-critical':
            conv.status = 'critical'
            result = { status: 'critical' }
            addMessage(conversationId, { direction: 'system', type: 'event', text: 'Conversa marcada como CRÍTICA.' })
            break
        case 'forward-specialist':
            conv.forwardedTo = payload.specialist || 'especialista'
            conv.status = 'pending'
            result = { forwardedTo: conv.forwardedTo }
            addMessage(conversationId, { direction: 'system', type: 'event', text: 'Encaminhada para especialista: ' + conv.forwardedTo })
            break
        case 'validate-ai':
            addMessage(conversationId, { direction: 'system', type: 'event', text: 'Resposta da IA validada por humano.' })
            result = { validated: true }
            break
        case 'archive-conversation':
            conv.archived = true
            result = { archived: true }
            addMessage(conversationId, { direction: 'system', type: 'event', text: 'Conversa arquivada.' })
            break
        case 'unarchive-conversation':
            conv.archived = false
            result = { archived: false }
            addMessage(conversationId, { direction: 'system', type: 'event', text: 'Conversa reaberta.' })
            break
        default:
            return res.status(400).json({ success: false, error: 'Unknown action' })
    }
    conv.updatedAt = now
    schedulePersistConversations(); broadcastConversationUpdate(conv)
    res.json({ success: true, action, conversationId, result })
})

app.post('/api/interventions', (req, res) => {
    const { conversationId, interventionType, details } = req.body
    // TODO: Integrate with real business logic/service
    res.json({ success: true, conversationId, interventionType, details })
})

// Human critical intervention: suppress AI for 24h
app.post('/api/conversations/:id/human-intervention', async (req, res) => {
    const { id } = req.params
    const until = new Date(Date.now() + 24 * 60 * 60 * 1000)
    aiSuppression[id] = until.toISOString()
    await saveSuppression()
    suppressionMetrics.totalSuppressions += 1
    console.log(JSON.stringify({ level: 'info', event: 'ai_suppressed', conversationId: id, resumeAt: aiSuppression[id] }))
    notifyAgentZeroSuppression(id, aiSuppression[id])
    sseBroadcast({ type: 'suppress', conversationId: id, resumeAt: aiSuppression[id] })
    addMessage(id, { direction: 'system', type: 'event', text: 'Intervenção humana: IA silenciada 24h.' })
    res.json({ success: true, conversationId: id, suppressedUntil: aiSuppression[id] })
})

// Manual resume before 24h
app.delete('/api/conversations/:id/human-intervention', async (req, res) => {
    const { id } = req.params
    const existed = !!aiSuppression[id]
    if (existed) {
        delete aiSuppression[id]
        await saveSuppression()
        notifyAgentZeroResume(id)
        suppressionMetrics.totalResumes += 1
        console.log(JSON.stringify({ level: 'info', event: 'ai_resume', conversationId: id }))
        sseBroadcast({ type: 'resume', conversationId: id })
        addMessage(id, { direction: 'system', type: 'event', text: 'Supressão finalizada: IA retomada.' })
    }
    res.json({ success: true, conversationId: id, removed: existed })
})

// -------------------------------------------------------------
// WhatsApp Orchestration - CHANNEL-BASED IMPLEMENTATION
// - Single channel (1) maps to official module port (3001)
// - Channel 1 = Port 3001 (official module)
// - No automatic instance creation - all instances are user-requested
// - Orchestrator manages lifecycle and provides channel-based API
// -------------------------------------------------------------
const CHANNELS_RANGE = Array.from({ length: 9 }, (_, i) => i + 1) // Channels 1-9
const PORTS_RANGE_GATEWAY = { min: 3001, max: 3001 } // Single official module port 3001

	// Persisted metadata for gateway instances (friendly names, last-contact, etc.)
	const WA_INSTANCES_META_FILE =
	    process.env.CRM_WA_INSTANCES_META ||
	    process.env.WA_INSTANCES_META_FILE ||
	    path.join(VAR_DIR, 'core', 'wa_instances_meta.json')
	// Workspace path for the legacy gateway scripts/assets (now lives under whatsapp/gateway/)
	const WA_GATEWAY_DIR = process.env.CRM_WA_GATEWAY_DIR ||
	    process.env.WA_GATEWAY_DIR ||
	    path.join(BACKEND_ROOT, 'apps', 'whatsapp', 'gateway')
	// Schema: { instances: { [inst:number]: { name?: string, createdAt?: string, lastContactName?: string, lastContactPhone?: string, lastContactAt?: string } } }
	let waInstancesMeta = { instances: {} }
async function loadWaInstancesMeta() {
    try {
        const raw = await fs.readFile(WA_INSTANCES_META_FILE, 'utf-8')
        const json = JSON.parse(raw)
        if (json && typeof json === 'object' && json.instances) waInstancesMeta = json
    } catch { /* ignore */ }
}
async function persistWaInstancesMeta() {
    try { await fs.writeFile(WA_INSTANCES_META_FILE, JSON.stringify(waInstancesMeta, null, 2)) } catch (e) { console.error('[WA_INSTANCES_META] Persist failed', e) }
}
await loadWaInstancesMeta()

async function fileExists(p) {
    try { await fs.access(p); return true } catch { return false }
}

async function readPid(inst) {
    const pidPath = path.join(WA_GATEWAY_DIR, `.local_instance_${inst}.pid`)
    if (!(await fileExists(pidPath))) return null
    try { const raw = await fs.readFile(pidPath, 'utf-8'); const n = parseInt(String(raw).trim(), 10); return isNaN(n) ? null : n } catch { return null }
}

function isPidAlive(pid) {
    try { process.kill(pid, 0); return true } catch { return false }
}

// Channel-to-port mapping utility (unified multi-channel system)
function portForChannel(channel) {
    // All channels now use the unified multi-channel system on port 3001
    // with REST routes /whatsapp/{account}/
    const channelNum = parseInt(channel, 10)
    if (isNaN(channelNum) || channelNum < 1 || channelNum > 9) {
        throw new Error(`Invalid channel: ${channel}. Must be between 1-9 for multi-channel system.`)
    }
    return 3001 // Unified multi-channel system port
}

function channelForPort(port) {
    // Port 3001 handles all channels via REST routes
    if (port !== 3001) {
        throw new Error(`Invalid port: ${port}. Must be 3001 for unified multi-channel system.`)
    }
    // Since all channels use the same port, we can't determine channel from port alone
    // Channel is determined by the REST route /whatsapp/{account}/
    return null // Channel determined by REST route, not port
}

// Legacy compatibility - remove port 3002 reservation
function portFor(inst) {
    // Single instance always uses official module port
    return 3001 // Instance 1 = 3001 (official module)
}

async function stopWaInstanceViaScript(inst) {
    return await new Promise((resolve) => {
        const child = spawn('./manage-instances.sh', ['stop', String(inst)], { cwd: WA_GATEWAY_DIR, stdio: ['ignore', 'pipe', 'pipe'], shell: true })
        let out = '', err = ''
        child.stdout.on('data', d => { out += d.toString() })
        child.stderr.on('data', d => { err += d.toString() })
        child.on('close', code => resolve({ code, out, err }))
    })
}

async function killPortPids(port) {
    try {
        const out = await new Promise((resolve) => {
            const child = spawn('lsof', ['-ti', `tcp:${port}`], { cwd: WA_GATEWAY_DIR, stdio: ['ignore', 'pipe', 'pipe'] })
            let data = ''
            child.stdout.on('data', d => { data += d.toString() })
            child.on('close', () => resolve(data))
        })
        const pids = String(out || '').split(/\s+/).map(s => parseInt(s, 10)).filter(n => Number.isFinite(n) && n > 0)
        let killed = 0
        for (const pid of pids) {
            try { if (pid !== process.pid) { process.kill(pid, 'SIGKILL'); killed++ } } catch { /* ignore */ }
        }
        return killed
    } catch { return 0 }
}

async function removePidFile(inst) {
    try { await fs.unlink(path.join(WA_GATEWAY_DIR, `.local_instance_${inst}.pid`)) } catch { /* ignore */ }
}


async function listWaInstances() {
    const list = []
    for (const inst of INSTANCES_RANGE) {
        let pid, alive, ready, status, message

        {
            // Regular whatsapp-gateway instances
            pid = await readPid(inst)
            alive = pid ? isPidAlive(pid) : false
            ready = false
            status = 'stopped'
            message = null

            if (alive) {
                const ctrl = new AbortController()
                const t = setTimeout(() => ctrl.abort(), 1200)
                try {
                    const r = await fetch(`http://localhost:${portFor(inst)}/status`, { signal: ctrl.signal })
                    if (r.ok) {
                        const js = await r.json()
                        ready = !!js.ready
                        status = js.status || (ready ? 'ready' : 'connecting')
                        message = js.message || null
                    } else {
                        status = 'unknown'
                    }
                } catch { status = 'unknown' } finally { clearTimeout(t) }
            }
        }

        const meta = (waInstancesMeta.instances && waInstancesMeta.instances[String(inst)]) || {}
        list.push({
            instance: inst,
            port: portFor(inst),
            pid,
            alive,
            ready,
            status,
            message,
            name: meta.name || (inst === 1 ? 'WhatsApp Official Module' : null),
            lastContactName: meta.lastContactName || null,
            lastContactPhone: meta.lastContactPhone || null,
            lastContactAt: meta.lastContactAt || null,
        })
    }
    return list
}

async function findNextAvailableInstance() {
    const list = await listWaInstances()
    const free = list.find(i => !i.alive)
    return free ? free.instance : null
}

async function startWaInstance(inst) {
    // Spawn: ./manage-instances.sh start <inst>
    return await new Promise((resolve) => {
        const child = spawn('./manage-instances.sh', ['start', String(inst)], {
            cwd: WA_GATEWAY_DIR,
            stdio: ['ignore', 'pipe', 'pipe'],
            shell: true
        })
        let out = '', err = ''
        child.stdout.on('data', (d) => { out += d.toString() })
        child.stderr.on('data', (d) => { err += d.toString() })
        child.on('close', (code) => {
            try {
                if (code !== 0) {
                    const logFile = path.join(WA_GATEWAY_DIR, `local_${inst}.out`)
                    const hdr = `\n=== [${new Date().toISOString()}] script start failed (inst ${inst}) ===\n`
                    fsSync.appendFileSync(logFile, hdr + (out ? `stdout:\n${out}\n` : '') + (err ? `stderr:\n${err}\n` : ''))
                }
            } catch { /* ignore */ }
            resolve({ code, out, err, phase: 'script' })
        })
    })
}

async function startWaInstanceWithFallback(inst) {
    const first = await startWaInstance(inst)
    if (first.code === 0) return first
    lastStartDiag[String(inst)] = { ts: new Date().toISOString(), ...first }
    // Ensure script is executable
    try { await fs.chmod(path.join(WA_GATEWAY_DIR, 'manage-instances.sh'), 0o755) } catch { /* ignore */ }
    // Retry via explicit bash invocation (permissions or shell quirks)
    const second = await new Promise((resolve) => {
        const child = spawn('bash', ['manage-instances.sh', 'start', String(inst)], {
            cwd: WA_GATEWAY_DIR,
            stdio: ['ignore', 'pipe', 'pipe']
        })
        let out = first.out || '', err = first.err || ''
        child.stdout.on('data', (d) => { out += d.toString() })
        child.stderr.on('data', (d) => { err += d.toString() })
        child.on('close', (code) => {
            try {
                if (code !== 0) {
                    const logFile = path.join(WA_GATEWAY_DIR, `local_${inst}.out`)
                    const hdr = `\n=== [${new Date().toISOString()}] bash start failed (inst ${inst}) ===\n`
                    fsSync.appendFileSync(logFile, hdr + (out ? `stdout:\n${out}\n` : '') + (err ? `stderr:\n${err}\n` : ''))
                }
            } catch { /* ignore */ }
            resolve({ code, out, err, phase: 'bash' })
        })
    })
    if (second.code === 0) return second
    lastStartDiag[String(inst)] = { ts: new Date().toISOString(), ...second }
    // Final fallback: start bot directly without script
    const direct = await startWaInstanceDirect(inst)
    lastStartDiag[String(inst)] = { ts: new Date().toISOString(), ...direct }
    return direct
}

async function waitGatewayReady(port, waitMs = 6000) {
    const started = Date.now()
    while ((Date.now() - started) < waitMs) {
        try {
            const ctrl = new AbortController()
            const t = setTimeout(() => ctrl.abort(), 800)
            const r = await fetch(`http://localhost:${port}/status`, { signal: ctrl.signal })
            clearTimeout(t)
            if (r.ok) { const js = await r.json(); if (js) return { ok: true, body: js } }
        } catch { /* retry */ }
        await new Promise(res => setTimeout(res, 500))
    }
    return { ok: false }
}

async function startWaInstanceDirect(inst) {
    try {
        const port = portFor(inst)
        const pidPath = path.join(WA_GATEWAY_DIR, `.local_instance_${inst}.pid`)
        const authPath = path.join(WA_GATEWAY_DIR, `.wwebjs_auth_local_${inst}`)
        const logFile = path.join(WA_GATEWAY_DIR, `local_${inst}.out`)
        const env = { ...process.env, PORT: String(port), ACCOUNT_ID: `local${inst}`, WWJS_AUTH_PATH: authPath }
        try { fsSync.appendFileSync(logFile, `\n=== [${new Date().toISOString()}] direct start attempt (inst ${inst}, port ${port}) ===\n`) } catch { /* ignore */ }
        const child = spawn(process.execPath, ['bot_com_api.js', '--authPath', authPath], {
            cwd: WA_GATEWAY_DIR,
            stdio: ['ignore', 'pipe', 'pipe'],
            detached: true,
            env
        })
        try {
            const outStream = fsSync.createWriteStream(logFile, { flags: 'a' })
            const errStream = fsSync.createWriteStream(logFile, { flags: 'a' })
            child.stdout?.pipe(outStream)
            child.stderr?.pipe(errStream)
        } catch (e) {
            // If piping fails, ignore; logs endpoint may be empty for direct spawn
        }
        child.unref()
        try { await fs.writeFile(pidPath, String(child.pid)) } catch { /* ignore */ }
        const ready = await waitGatewayReady(port, 7000)
        if (ready.ok) return { code: 0, out: 'direct start ok', err: '', phase: 'direct' }
        try { fsSync.appendFileSync(logFile, `direct start failed: gateway not ready on :${port}\n`) } catch { /* ignore */ }
        return { code: 1, out: '', err: 'direct start failed: gateway not ready', phase: 'direct' }
    } catch (e) {
        try {
            const logFile = path.join(WA_GATEWAY_DIR, `local_${inst}.out`)
            fsSync.appendFileSync(logFile, `direct start exception: ${e?.message || e}\n`)
        } catch { /* ignore */ }
        return { code: 1, out: '', err: `direct start exception: ${e?.message || e}`, phase: 'direct' }
    }
}

app.get('/api/wa/instances', async (req, res) => {
    try {
        const list = await listWaInstances()
        res.json({ success: true, instances: list })
    } catch (e) {
        res.status(500).json({ success: false, error: String(e?.message || e) })
    }
})

app.post('/api/wa/start', async (req, res) => {
    try {
        const tried = []

        // Basic guard: submodule must exist
        if (!(await fileExists(path.join(WA_GATEWAY_DIR, 'manage-instances.sh')))) {
            return res.status(500).json({ success: false, error: 'whatsapp gateway not available' })
        }

        for (const inst of INSTANCES_RANGE) {
            const pid = await readPid(inst)
            const alive = pid ? isPidAlive(pid) : false
            if (alive) { tried.push({ inst, status: 'busy' }); continue }
            let result = await startWaInstanceWithFallback(inst)
            if (result.code === 0) {
                const assigned = { instance: inst, port: portFor(inst), baseUrl: `http://localhost:${portFor(inst)}` }
                return res.json({ success: true, ...assigned, log: result.out })
            }
            // auto cleanup + one retry
            const port = portFor(inst)
            await stopWaInstanceViaScript(inst)
            const killed = await killPortPids(port)
            await removePidFile(inst)
            result = await startWaInstanceWithFallback(inst)
            if (result.code === 0) {
                const assigned = { instance: inst, port, baseUrl: `http://localhost:${port}` }
                return res.json({ success: true, ...assigned, log: result.out, recovered: true })
            }
            tried.push({ inst, status: 'failed', detail: (result.err || result.out || '').trim() })
            // try next instance on failure (e.g., port in use)
        }
        res.status(409).json({ success: false, error: 'no available instances started', tried })
    } catch (e) {
        res.status(500).json({ success: false, error: String(e?.message || e) })
    }
})

// Start a specific instance (1..9)
app.post('/api/wa/start/:instance', async (req, res) => {
    try {
        const inst = parseInt(String(req.params.instance), 10)
        if (!inst || inst < 1 || inst > 9) return res.status(400).json({ success: false, error: 'invalid instance (1..9)' })

        // Use the gateway management for all instances
        if (!(await fileExists(path.join(WA_GATEWAY_DIR, 'manage-instances.sh')))) {
            return res.status(500).json({ success: false, error: 'whatsapp gateway not available' })
        }

        const pid = await readPid(inst)
        const alive = pid ? isPidAlive(pid) : false
        if (alive) {
            const assigned = { instance: inst, port: portFor(inst), baseUrl: `http://localhost:${portFor(inst)}` }
            return res.json({ success: true, ...assigned, message: 'already running' })
        }
        let result = await startWaInstanceWithFallback(inst)
        if (result.code === 0) {
            const assigned = { instance: inst, port: portFor(inst), baseUrl: `http://localhost:${portFor(inst)}` }
            return res.json({ success: true, ...assigned, log: result.out })
        }
        // auto cleanup + retry once
        const port = portFor(inst)
        await stopWaInstanceViaScript(inst)
        const killed = await killPortPids(port)
        await removePidFile(inst)
        result = await startWaInstanceWithFallback(inst)
        if (result.code === 0) {
            const assigned = { instance: inst, port, baseUrl: `http://localhost:${port}` }
            return res.json({ success: true, ...assigned, log: result.out, recovered: true, cleaned: true, killedPids: killed })
        }
        const detail = (result.err || result.out || '').trim()
        return res.status(500).json({ success: false, error: 'failed to start instance', detail, cleaned: true, killedPids: killed })
    } catch (e) {
        res.status(500).json({ success: false, error: String(e?.message || e) })
    }
})

// Force clean (stop + kill processes on reserved port + remove pid file)
app.post('/api/wa/instances/:instance/force-clean', async (req, res) => {
    try {
        const inst = parseInt(String(req.params.instance), 10)
        if (!inst || inst < 1 || inst > 9) return res.status(400).json({ success: false, error: 'invalid instance (1..9)' })
        await stopWaInstanceViaScript(inst)
        const port = portFor(inst)
        const killed = await killPortPids(port)
        await removePidFile(inst)
        // Remove stored authentication so next start requires scanning QR again
        try {
            const authPath = path.join(WA_GATEWAY_DIR, `.wwebjs_auth_local_${inst}`)
            await fs.rm(authPath, { recursive: true, force: true })
        } catch { /* ignore */ }
        res.json({ success: true, instance: inst, port, killedPids: killed })
    } catch (e) {
        res.status(500).json({ success: false, error: String(e?.message || e) })
    }
})

// Logs tail endpoint for instances
app.get('/api/wa/instances/:instance/logs', async (req, res) => {
    try {
        const inst = parseInt(String(req.params.instance), 10)
        if (!inst || inst < 1 || inst > 9) return res.status(400).json({ success: false, error: 'invalid instance (1..9)' })
        const lines = Math.max(1, Math.min(2000, parseInt(String(req.query.lines || '400'), 10) || 400))
        const logFile = path.join(WA_GATEWAY_DIR, `local_${inst}.out`)
        let content = ''
        try { content = await fs.readFile(logFile, 'utf-8') } catch { /* ignore */ }
        const arr = content ? content.split(/\r?\n/) : []
        const tail = arr.slice(-lines).join('\n')
        res.setHeader('Content-Type', 'text/plain; charset=utf-8')
        if (tail && tail.trim()) { res.send(tail); return }
        const diag = lastStartDiag[String(inst)]
        if (diag) {
            const diagText = [
                `# Última tentativa de inicialização (instância ${inst})`,
                `timestamp: ${diag.ts || ''}`,
                `fase: ${diag.phase || 'desconhecida'}`,
                '',
                (diag.out ? `stdout:\n${diag.out}` : ''),
                (diag.err ? `stderr:\n${diag.err}` : '')
            ].filter(Boolean).join('\n')
            res.send(diagText)
            return
        }
        // As a last resort, auto-detect the most recent local_*.out and return its tail
        try {
            const files = await fs.readdir(WA_GATEWAY_DIR)
            const candidates = files.filter(f => /^local_\d+\.out$/.test(f))
            if (candidates.length) {
                let latest = { file: candidates[0], mtime: 0 }
                for (const f of candidates) {
                    try {
                        const st = await fs.stat(path.join(WA_GATEWAY_DIR, f))
                        const mt = st.mtimeMs || st.mtime?.getTime?.() || 0
                        if (mt > latest.mtime) latest = { file: f, mtime: mt }
                    } catch { /* ignore */ }
                }
                const altContent = await fs.readFile(path.join(WA_GATEWAY_DIR, latest.file), 'utf-8').catch(() => '')
                if (altContent) {
                    const arr2 = altContent.split(/\r?\n/)
                    const tail2 = arr2.slice(-lines).join('\n')
                    res.send(`# Logs mais recentes detectados automaticamente (${latest.file})\n` + tail2)
                    return
                }
            }
        } catch { /* ignore */ }
        res.send('')
    } catch (e) {
        res.status(500).json({ success: false, error: String(e?.message || e) })
    }
})

app.post('/api/wa/stop/:instance', async (req, res) => {
    try {
        const inst = parseInt(String(req.params.instance), 10)
        if (!inst || inst < 1 || inst > 9) return res.status(400).json({ success: false, error: 'invalid instance (1..9)' })
        if (!(await fileExists(path.join(WA_GATEWAY_DIR, 'manage-instances.sh')))) {
            return res.status(500).json({ success: false, error: 'whatsapp gateway not available' })
        }
        const result = await new Promise((resolve) => {
            const child = spawn('./manage-instances.sh', ['stop', String(inst)], { cwd: WA_GATEWAY_DIR, stdio: ['ignore', 'pipe', 'pipe'], shell: true })
            let out = '', err = ''
            child.stdout.on('data', d => { out += d.toString() })
            child.stderr.on('data', d => { err += d.toString() })
            child.on('close', code => resolve({ code, out, err }))
        })
        if (result.code !== 0) return res.status(500).json({ success: false, error: 'failed to stop instance', detail: result.err || result.out })
        res.json({ success: true, instance: inst, message: 'stopped' })
    } catch (e) {
        res.status(500).json({ success: false, error: String(e?.message || e) })
    }
})

// Set or update a friendly name for an instance
app.post('/api/wa/instances/:instance/name', async (req, res) => {
    try {
        const inst = parseInt(String(req.params.instance), 10)
        if (!inst || inst < 1 || inst > 9) return res.status(400).json({ success: false, error: 'invalid instance (1..9)' })
        const name = (req.body && typeof req.body.name === 'string') ? req.body.name.trim() : ''
        if (!name) return res.status(400).json({ success: false, error: 'name is required' })
        if (!waInstancesMeta.instances) waInstancesMeta.instances = {}
        const now = new Date().toISOString()
        waInstancesMeta.instances[String(inst)] = { ...(waInstancesMeta.instances[String(inst)] || {}), name, createdAt: (waInstancesMeta.instances[String(inst)]?.createdAt || now) }
        await persistWaInstancesMeta()
        res.json({ success: true, instance: inst, name })
    } catch (e) {
        res.status(500).json({ success: false, error: String(e?.message || e) })
    }
})

// Clear/remove the friendly name for an instance (revert to default display)
app.delete('/api/wa/instances/:instance/name', async (req, res) => {
    try {
        const inst = parseInt(String(req.params.instance), 10)
        if (!inst || inst < 1 || inst > 9) return res.status(400).json({ success: false, error: 'invalid instance (1..9)' })
        if (!waInstancesMeta.instances) waInstancesMeta.instances = {}
        const entry = waInstancesMeta.instances[String(inst)] || {}
        if (entry && 'name' in entry) {
            try { delete entry.name } catch { /* ignore */ }
            waInstancesMeta.instances[String(inst)] = entry
            await persistWaInstancesMeta()
        }
        res.json({ success: true, instance: inst, name: null })
    } catch (e) {
        res.status(500).json({ success: false, error: String(e?.message || e) })
    }
})

// Update arbitrary simple metadata for an instance (e.g., lastContactName/Phone/At)
app.post('/api/wa/instances/:instance/meta', async (req, res) => {
    try {
        const inst = parseInt(String(req.params.instance), 10)
        if (!inst || inst < 1 || inst > 9) return res.status(400).json({ success: false, error: 'invalid instance (1..9)' })
        const allowedKeys = ['lastContactName', 'lastContactPhone', 'lastContactAt']
        const body = (req.body && typeof req.body === 'object') ? req.body : {}
        if (!waInstancesMeta.instances) waInstancesMeta.instances = {}
        const existing = waInstancesMeta.instances[String(inst)] || {}
        for (const k of allowedKeys) {
            if (typeof body[k] === 'string') existing[k] = body[k]
        }
        waInstancesMeta.instances[String(inst)] = existing
        await persistWaInstancesMeta()
        res.json({ success: true, instance: inst, meta: existing })
    } catch (e) {
        res.status(500).json({ success: false, error: String(e?.message || e) })
    }
})

// -------------------------------------------------------------
// Email Templates CRUD (file-based persistence)
// -------------------------------------------------------------
const EMAIL_TEMPLATES_FILE = process.env.CRM_EMAIL_TEMPLATES_FILE || path.join(process.cwd(), 'email_templates.json')
let emailTemplates = []
let emailTemplatesLoaded = false
async function loadEmailTemplates() {
    if (emailTemplatesLoaded) return
    try {
        const raw = await fs.readFile(EMAIL_TEMPLATES_FILE, 'utf-8')
        const json = JSON.parse(raw)
        if (Array.isArray(json)) emailTemplates = json
    } catch { /* ignore */ }
    emailTemplatesLoaded = true
}
async function saveEmailTemplates() {
    try { await fs.writeFile(EMAIL_TEMPLATES_FILE, JSON.stringify(emailTemplates, null, 2)) } catch (e) { console.error('[EMAIL_TEMPLATES] Persist failed', e) }
}

function computeRates(t) {
    t.analytics.openRate = t.analytics.sent ? (t.analytics.opened / t.analytics.sent) * 100 : 0
    t.analytics.clickRate = t.analytics.sent ? (t.analytics.clicked / t.analytics.sent) * 100 : 0
}

app.get('/api/email/templates', async (req, res) => {
    await loadEmailTemplates()
    res.json(emailTemplates)
})

app.post('/api/email/templates', async (req, res) => {
    await loadEmailTemplates()
    const input = req.body || {}
    if (!input.name || !input.subject) return res.status(400).json({ success: false, error: 'name and subject required' })
    const now = new Date().toISOString()
    const record = {
        id: 'tpl_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6),
        name: input.name,
        subject: input.subject,
        category: input.category || 'general',
        type: input.type || 'html',
        content: {
            html: input.content?.html || '<p>(vazio)</p>',
            text: input.content?.text || ''
        },
        variables: Array.isArray(input.variables) ? input.variables : [],
        settings: input.settings || { fromName: 'CRM', fromEmail: 'noreply@example.com', trackOpens: true, trackClicks: true, enableUnsubscribe: true },
        design: input.design || { backgroundColor: '#ffffff', textColor: '#222222', linkColor: '#2563eb', buttonColor: '#2563eb', fontFamily: 'Inter, sans-serif', footerText: 'Enviado pelo CRM' },
        analytics: { sent: 0, opened: 0, clicked: 0, unsubscribed: 0, bounced: 0, openRate: 0, clickRate: 0 },
        isActive: input.isActive !== false,
        isDefault: false,
        tags: Array.isArray(input.tags) ? input.tags : [],
        createdAt: now,
        updatedAt: now
    }
    emailTemplates.push(record)
    await saveEmailTemplates()
    res.json({ success: true, template: record })
})

app.put('/api/email/templates/:id', async (req, res) => {
    await loadEmailTemplates()
    const { id } = req.params
    const idx = emailTemplates.findIndex(t => t.id === id)
    if (idx === -1) return res.status(404).json({ success: false, error: 'not found' })
    const now = new Date().toISOString()
    emailTemplates[idx] = { ...emailTemplates[idx], ...req.body, updatedAt: now }
    computeRates(emailTemplates[idx])
    await saveEmailTemplates()
    res.json({ success: true, template: emailTemplates[idx] })
})

app.delete('/api/email/templates/:id', async (req, res) => {
    await loadEmailTemplates()
    const { id } = req.params
    const before = emailTemplates.length
    emailTemplates = emailTemplates.filter(t => t.id !== id)
    if (before === emailTemplates.length) return res.status(404).json({ success: false, error: 'not found' })
    await saveEmailTemplates()
    res.json({ success: true, removed: id })
})

app.post('/api/email/templates/:id/duplicate', async (req, res) => {
    await loadEmailTemplates()
    const { id } = req.params
    const original = emailTemplates.find(t => t.id === id)
    if (!original) return res.status(404).json({ success: false, error: 'not found' })
    const now = new Date().toISOString()
    const copy = {
        ...original,
        id: 'tpl_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6),
        name: original.name + ' (Cópia)',
        isDefault: false,
        analytics: { sent: 0, opened: 0, clicked: 0, unsubscribed: 0, bounced: 0, openRate: 0, clickRate: 0 },
        createdAt: now,
        updatedAt: now
    }
    emailTemplates.push(copy)
    await saveEmailTemplates()
    res.json({ success: true, template: copy })
})

app.post('/api/email/templates/:id/send-test', async (req, res) => {
    await loadEmailTemplates()
    const { id } = req.params
    const t = emailTemplates.find(t => t.id === id)
    if (!t) return res.status(404).json({ success: false, error: 'not found' })
    // Simulate send increment
    t.analytics.sent += 1
    computeRates(t)
    t.updatedAt = new Date().toISOString()
    await saveEmailTemplates()
    res.json({ success: true, message: 'Teste enviado (simulado)', template: t })
})

// =================================================================
// UNIFIED SYSTEM FACADE ROUTES - Proxy WhatsAppPanel calls with X-API-Key
// =================================================================

const UNIFIED_SYSTEM_URL = 'http://localhost:3001'
const CRM_UNIFIED_API_KEY = process.env.CRM_UNIFIED_API_KEY || 'sk_prod_a7b8c9d0e1f2g3h4i5j6k7l8m9n0p1q2'

// Facade: GET /api/unified/status → Unified System /whatsapp/1/status (Legacy)
app.get('/api/unified/status', async (req, res) => {
    try {
        console.log(`[FACADE] Proxying legacy status request to Unified System`)

        const response = await axios.get(`${UNIFIED_SYSTEM_URL}/whatsapp/1/status`, {
            headers: {
                'X-API-Key': CRM_UNIFIED_API_KEY,
                'Content-Type': 'application/json'
            }
        })

        res.json(response.data)
    } catch (error) {
        console.error(`[FACADE] Error proxying legacy status:`, error.message)
        if (error.response) {
            res.status(error.response.status).json(error.response.data)
        } else {
            res.status(500).json({
                success: false,
                error: 'Failed to communicate with Unified System',
                details: error.message
            })
        }
    }
})

// Facade: GET /api/unified/qr → Unified System /whatsapp/1/qr (Legacy)
app.get('/api/unified/qr', async (req, res) => {
    try {
        console.log(`[FACADE] Proxying legacy QR request to Unified System`)

        const response = await axios.get(`${UNIFIED_SYSTEM_URL}/whatsapp/1/qr`, {
            headers: {
                'X-API-Key': CRM_UNIFIED_API_KEY,
                'Content-Type': 'application/json'
            }
        })

        res.json(response.data)
    } catch (error) {
        console.error(`[FACADE] Error proxying legacy QR:`, error.message)
        if (error.response) {
            res.status(error.response.status).json(error.response.data)
        } else {
            res.status(500).json({
                success: false,
                error: 'Failed to communicate with Unified System',
                details: error.message
            })
        }
    }
})

// Facade: GET /api/qr → Unified System /api/qr (Direct legacy support)
app.get('/api/qr', async (req, res) => {
    try {
        console.log(`[FACADE] Proxying direct QR request to Unified System`)

        const response = await axios.get(`${UNIFIED_SYSTEM_URL}/api/qr`, {
            headers: {
                'X-API-Key': CRM_UNIFIED_API_KEY,
                'Content-Type': 'application/json'
            }
        })

        res.json(response.data)
    } catch (error) {
        console.error(`[FACADE] Error proxying direct QR:`, error.message)
        if (error.response) {
            res.status(error.response.status).json(error.response.data)
        } else {
            res.status(500).json({
                success: false,
                error: 'Failed to communicate with Unified System',
                details: error.message
            })
        }
    }
})

// Facade: GET /api/unified/whatsapp/:channelId/status → Unified System
app.get('/api/unified/whatsapp/:channelId/status', async (req, res) => {
    try {
        const { channelId } = req.params
        console.log(`[FACADE] Proxying status request for channel ${channelId} to Unified System`)

        const response = await axios.get(`${UNIFIED_SYSTEM_URL}/whatsapp/${channelId}/status`, {
            headers: {
                'X-API-Key': CRM_UNIFIED_API_KEY,
                'Content-Type': 'application/json'
            }
        })

        res.json(response.data)
    } catch (error) {
        console.error(`[FACADE] Error proxying status for channel ${req.params.channelId}:`, error.message)
        if (error.response) {
            res.status(error.response.status).json(error.response.data)
        } else {
            res.status(500).json({
                success: false,
                error: 'Failed to communicate with Unified System',
                details: error.message
            })
        }
    }
})

// Facade: GET /api/unified/whatsapp/:channelId/qr → Unified System
app.get('/api/unified/whatsapp/:channelId/qr', async (req, res) => {
    try {
        const { channelId } = req.params
        console.log(`[FACADE] Proxying QR request for channel ${channelId} to Unified System`)

        const response = await axios.get(`${UNIFIED_SYSTEM_URL}/whatsapp/${channelId}/qr`, {
            headers: {
                'X-API-Key': CRM_UNIFIED_API_KEY,
                'Content-Type': 'application/json'
            }
        })

        res.json(response.data)
    } catch (error) {
        console.error(`[FACADE] Error proxying QR for channel ${req.params.channelId}:`, error.message)
        if (error.response) {
            res.status(error.response.status).json(error.response.data)
        } else {
            res.status(500).json({
                success: false,
                error: 'Failed to communicate with Unified System',
                details: error.message
            })
        }
    }
})

// 🆕 Facade: SSE Stream /api/unified/whatsapp/:channelId/qr/stream → Unified System
app.get('/api/unified/whatsapp/:channelId/qr/stream', (req, res) => {
    try {
        const { channelId } = req.params
        console.log(`[FACADE] Setting up SSE proxy for channel ${channelId} QR stream`)

        // Configure SSE headers
        res.writeHead(200, {
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-cache',
            'Connection': 'keep-alive',
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Headers': 'Cache-Control, Authorization, X-Requested-With',
        })

        // Create proxy to Unified System
        const proxyUrl = `${UNIFIED_SYSTEM_URL}/whatsapp/${channelId}/qr/stream`

        // Use axios with stream to proxy SSE
        const forwardHeaders = {
            'X-API-Key': CRM_UNIFIED_API_KEY,
            'Accept': 'text/event-stream',
            'Cache-Control': 'no-cache'
        }

        // 🔧 PRODUCTION HARDENING: Forward client auth headers for SSE
        if (req.headers.authorization) {
            forwardHeaders['Authorization'] = req.headers.authorization
        }
        if (req.headers.cookie) {
            forwardHeaders['Cookie'] = req.headers.cookie
        }

        const source = axios.get(proxyUrl, {
            headers: forwardHeaders,
            responseType: 'stream',
            timeout: 0 // No timeout for SSE
        })

        source.then(response => {
            // Pipe the SSE stream directly to client
            response.data.pipe(res)

            console.log(`📡 [FACADE] SSE proxy established for channel ${channelId}`)

            // Handle client disconnect
            req.on('close', () => {
                console.log(`🔌 [FACADE] SSE client disconnected from channel ${channelId} stream`)
                response.data.destroy()
            })

            req.on('error', (err) => {
                console.error(`❌ [FACADE] SSE client error for channel ${channelId}:`, err.message)
                response.data.destroy()
            })

        }).catch(error => {
            console.error(`[FACADE] Error setting up SSE proxy for channel ${channelId}:`, error.message)
            res.write(`event: error\ndata: ${JSON.stringify({ error: 'SSE proxy failed', details: error.message })}\n\n`)
            res.end()
        })

    } catch (error) {
        console.error(`[FACADE] Critical error in SSE proxy for channel ${req.params.channelId}:`, error.message)
        res.status(500).json({
            success: false,
            error: 'Failed to setup SSE proxy',
            details: error.message
        })
    }
})

// =================================================================
// WhatsApp Orchestrator API Endpoints (Official Module Port 3001)
// =================================================================

// Get orchestrator status and all channels - enhanced with detailed information
app.get('/api/wa-orchestrator/status', async (req, res) => {
    try {
        const status = whatsappOrchestrator.getStatus()
        const availableChannels = whatsappOrchestrator.getAvailableChannels()
        const freeChannels = whatsappOrchestrator.getFreeChannels()
        const recoverySuggestions = whatsappOrchestrator.getRecoverySuggestions()

        res.json({
            success: true,
            ...status,
            availableChannelsList: availableChannels,
            freeChannelsList: freeChannels,
            recoverySuggestions: recoverySuggestions,
            endpoints: {
                channels: '/api/wa-orchestrator/channels',
                startChannel: '/api/wa-orchestrator/channels/{channel}/start',
                getChannelStatus: '/api/wa-orchestrator/channels/{channel}',
                getChannelQR: '/api/wa-orchestrator/channels/{channel}/qr',
                stopChannel: '/api/wa-orchestrator/channels/{channel}/stop',
                restartChannel: '/api/wa-orchestrator/channels/{channel}/restart'
            }
        })
    } catch (error) {
        res.status(500).json({ success: false, error: error.message })
    }
})

// List all instances
app.get('/api/wa-orchestrator/instances', async (req, res) => {
    try {
        const status = whatsappOrchestrator.getStatus()
        res.json({ success: true, instances: status.instances })
    } catch (error) {
        res.status(500).json({ success: false, error: error.message })
    }
})

// Start a new instance (auto-select channel or specify channel/port)
app.post('/api/wa-orchestrator/instances/start', async (req, res) => {
    try {
        const { port, channel, name } = req.body
        const channelOrPort = channel || port // Accept both channel and port parameters
        const result = await whatsappOrchestrator.startInstance(channelOrPort, { name })

        if (result.success) {
            res.json({
                success: true,
                instance: result.instance,
                suggestions: result.suggestions || null
            })
        } else {
            res.status(400).json({
                success: false,
                error: result.error,
                suggestions: result.suggestions || null
            })
        }
    } catch (error) {
        res.status(500).json({ success: false, error: error.message })
    }
})

// Start instance on specific port (supports both port and channel parameters)
app.post('/api/wa-orchestrator/instances/:port/start', async (req, res) => {
    try {
        const port = parseInt(req.params.port)
        const { name } = req.body

        // Validate port range
        if (isNaN(port) || port !== 3001) {
            return res.status(400).json({
                success: false,
                error: 'Invalid port. Must be 3001 for the official WhatsApp module.'
            })
        }

        const result = await whatsappOrchestrator.startInstance(port, { name })

        if (result.success) {
            res.json({
                success: true,
                instance: result.instance,
                suggestions: result.suggestions || null
            })
        } else {
            res.status(400).json({
                success: false,
                error: result.error,
                suggestions: result.suggestions || null
            })
        }
    } catch (error) {
        res.status(500).json({ success: false, error: error.message })
    }
})

// Stop an instance (supports both port and channel)
app.post('/api/wa-orchestrator/instances/:port/stop', async (req, res) => {
    try {
        const port = parseInt(req.params.port)

        // Validate port range
        if (isNaN(port) || port !== 3001) {
            return res.status(400).json({
                success: false,
                error: 'Invalid port. Must be 3001 for the official WhatsApp module.'
            })
        }

        const result = await whatsappOrchestrator.stopInstance(port)

        if (result.success) {
            res.json({
                success: true,
                channel: result.channel,
                port: result.port,
                message: result.message || 'Instance stopped successfully'
            })
        } else {
            res.status(400).json({
                success: false,
                error: result.error,
                channel: result.channel || null,
                port: result.port || null
            })
        }
    } catch (error) {
        res.status(500).json({ success: false, error: error.message })
    }
})

// Restart an instance (supports both port and channel)
app.post('/api/wa-orchestrator/instances/:port/restart', async (req, res) => {
    try {
        const port = parseInt(req.params.port)

        // Validate port range
        if (isNaN(port) || port !== 3001) {
            return res.status(400).json({
                success: false,
                error: 'Invalid port. Must be 3001 for the official WhatsApp module.'
            })
        }

        const result = await whatsappOrchestrator.restartInstance(port)

        if (result.success) {
            res.json({
                success: true,
                instance: result.instance,
                channel: result.channel,
                port: result.port,
                suggestions: result.suggestions || null
            })
        } else {
            res.status(400).json({
                success: false,
                error: result.error,
                channel: result.channel || null,
                port: result.port || null
            })
        }
    } catch (error) {
        res.status(500).json({ success: false, error: error.message })
    }
})

// Get instance details and status (supports both port and channel)
app.get('/api/wa-orchestrator/instances/:port', async (req, res) => {
    try {
        const port = parseInt(req.params.port)

        // Validate port range
        if (isNaN(port) || port !== 3001) {
            return res.status(400).json({
                success: false,
                error: 'Invalid port. Must be 3001 for the official WhatsApp module.'
            })
        }

        const result = await whatsappOrchestrator.getInstanceStatus(port)

        if (result.error) {
            res.status(404).json({
                success: false,
                error: result.error,
                channel: result.channel || null,
                port: result.port || null
            })
        } else {
            res.json({
                success: true,
                status: result.status,
                channel: result.channel,
                port: result.port,
                instance: result.instance,
                liveData: result.liveData || null,
                warning: result.warning || null
            })
        }
    } catch (error) {
        res.status(500).json({ success: false, error: error.message })
    }
})

// Get QR code for an instance (supports both port and channel)
app.get('/api/wa-orchestrator/instances/:port/qr', async (req, res) => {
    try {
        const port = parseInt(req.params.port)

        // Validate port range
        if (isNaN(port) || port !== 3001) {
            return res.status(400).json({
                success: false,
                error: 'Invalid port. Must be 3001 for the official WhatsApp module.'
            })
        }

        const result = await whatsappOrchestrator.getInstanceQR(port)

        if (result.error) {
            res.status(404).json({
                success: false,
                error: result.error,
                channel: result.channel || null,
                port: result.port || null,
                suggestion: result.suggestion || null
            })
        } else {
            res.json({
                success: true,
                qr: result.qr,
                status: result.status,
                channel: result.channel,
                port: result.port,
                cached: result.cached || false,
                generated: result.generated || false,
                message: result.message || null
            })
        }
    } catch (error) {
        res.status(500).json({ success: false, error: error.message })
    }
})

// Update instance metadata (supports both port and channel)
app.put('/api/wa-orchestrator/instances/:port/metadata', async (req, res) => {
    try {
        const port = parseInt(req.params.port)
        const { metadata } = req.body

        // Validate port range
        if (isNaN(port) || port !== 3001) {
            return res.status(400).json({
                success: false,
                error: 'Invalid port. Must be 3001 for the official WhatsApp module.'
            })
        }

        if (!metadata || typeof metadata !== 'object') {
            return res.status(400).json({
                success: false,
                error: 'Metadata object required'
            })
        }

        const result = await whatsappOrchestrator.updateInstanceMetadata(port, metadata)

        if (result.success) {
            res.json({
                success: true,
                channel: result.channel,
                port: result.port
            })
        } else {
            res.status(404).json({
                success: false,
                error: result.error,
                suggestion: result.suggestion || null
            })
        }
    } catch (error) {
        res.status(500).json({ success: false, error: error.message })
    }
})

// Get a free port (for quick allocation) - enhanced with channel information
app.get('/api/wa-orchestrator/free-port', async (req, res) => {
    try {
        const port = whatsappOrchestrator.getFreePort()
        if (port) {
            const channel = channelForPort(port)
            res.json({
                success: true,
                port,
                channel,
                message: `Channel ${channel} (port ${port}) is available`
            })
        } else {
            const status = whatsappOrchestrator.getStatus()
            res.status(409).json({
                success: false,
                error: 'No free ports available',
                status: {
                    totalChannels: status.totalChannels,
                    availableChannels: status.availableChannels,
                    freeInstances: status.freeInstances,
                    connectedInstances: status.connectedInstances,
                    errorInstances: status.errorInstances
                }
            })
        }
    } catch (error) {
        res.status(500).json({ success: false, error: error.message })
    }
})

// =================================================================
// Channel-Based API Endpoints (Channel 1 → Port 3001)
// =================================================================

// Get all channels status
app.get('/api/wa-orchestrator/channels', async (req, res) => {
    try {
        const status = whatsappOrchestrator.getStatus()
        res.json({
            success: true,
            channels: status.channels,
            summary: {
                totalChannels: status.totalChannels,
                availableChannels: status.availableChannels,
                freeInstances: status.freeInstances,
                connectedInstances: status.connectedInstances,
                errorInstances: status.errorInstances,
                startingInstances: status.startingInstances
            }
        })
    } catch (error) {
        res.status(500).json({ success: false, error: error.message })
    }
})

// Start instance on specific channel
app.post('/api/wa-orchestrator/channels/:channel/start', async (req, res) => {
    try {
        const channel = parseInt(req.params.channel)
        const { name } = req.body

        // Validate channel range
        if (isNaN(channel) || channel < 1 || channel > 9) {
            return res.status(400).json({
                success: false,
                error: 'Invalid channel. Must be between 1 and 9.'
            })
        }

        const port = portForChannel(channel)
        const result = await whatsappOrchestrator.startInstance(port, { name })

        if (result.success) {
            res.json({
                success: true,
                instance: result.instance,
                channel: result.instance?.channel,
                port: result.instance?.port,
                suggestions: result.suggestions || null
            })
        } else {
            res.status(400).json({
                success: false,
                error: result.error,
                suggestions: result.suggestions || null
            })
        }
    } catch (error) {
        res.status(500).json({ success: false, error: error.message })
    }
})

// Get channel status
app.get('/api/wa-orchestrator/channels/:channel', async (req, res) => {
    try {
        const channel = parseInt(req.params.channel)

        // Validate channel range
        if (isNaN(channel) || channel < 1 || channel > 9) {
            return res.status(400).json({
                success: false,
                error: 'Invalid channel. Must be between 1 and 9.'
            })
        }

        const port = portForChannel(channel)
        const result = await whatsappOrchestrator.getInstanceStatus(port)

        if (result.error) {
            res.status(404).json({
                success: false,
                error: result.error,
                channel: result.channel || channel,
                port: result.port || null
            })
        } else {
            res.json({
                success: true,
                status: result.status,
                channel: result.channel || channel,
                port: result.port,
                instance: result.instance,
                liveData: result.liveData || null,
                warning: result.warning || null
            })
        }
    } catch (error) {
        res.status(500).json({ success: false, error: error.message })
    }
})

// Get QR code for channel
app.get('/api/wa-orchestrator/channels/:channel/qr', async (req, res) => {
    try {
        const channel = parseInt(req.params.channel)

        // Validate channel range
        if (isNaN(channel) || channel < 1 || channel > 9) {
            return res.status(400).json({
                success: false,
                error: 'Invalid channel. Must be between 1 and 9.'
            })
        }

        const port = portForChannel(channel)
        const result = await whatsappOrchestrator.getInstanceQR(port)

        if (result.error) {
            res.status(404).json({
                success: false,
                error: result.error,
                channel: result.channel || channel,
                port: result.port || null,
                suggestion: result.suggestion || null
            })
        } else {
            res.json({
                success: true,
                qr: result.qr,
                status: result.status,
                channel: result.channel || channel,
                port: result.port,
                cached: result.cached || false,
                generated: result.generated || false,
                message: result.message || null
            })
        }
    } catch (error) {
        res.status(500).json({ success: false, error: error.message })
    }
})

// Stop channel
app.post('/api/wa-orchestrator/channels/:channel/stop', async (req, res) => {
    // Prevent double response with response sent flag
    let responseSent = false

    const sendResponse = (statusCode, payload) => {
        if (!responseSent && !res.headersSent) {
            responseSent = true
            res.status(statusCode).json(payload)
        }
    }

    try {
        const channel = parseInt(req.params.channel)

        // Validate channel range
        if (isNaN(channel) || channel < 1 || channel > 9) {
            return sendResponse(400, {
                success: false,
                error: 'Invalid channel. Must be between 1 and 9.'
            })
        }

        const port = portForChannel(channel)
        const result = await whatsappOrchestrator.stopInstance(port)

        if (result.success) {
            sendResponse(200, {
                success: true,
                channel: result.channel || channel,
                port: result.port || port,
                message: result.message || 'Channel stopped successfully'
            })
        } else {
            sendResponse(400, {
                success: false,
                error: result.error,
                channel: result.channel || channel,
                port: result.port || port
            })
        }
    } catch (error) {
        console.error('[STOP ENDPOINT ERROR]', error)
        sendResponse(500, { success: false, error: error.message })
    }
})

// Restart channel
app.post('/api/wa-orchestrator/channels/:channel/restart', async (req, res) => {
    // Prevent double response with response sent flag
    let responseSent = false

    const sendResponse = (statusCode, payload) => {
        if (!responseSent && !res.headersSent) {
            responseSent = true
            res.status(statusCode).json(payload)
        }
    }

    try {
        const channel = parseInt(req.params.channel)

        // Validate channel range
        if (isNaN(channel) || channel < 1 || channel > 9) {
            return sendResponse(400, {
                success: false,
                error: 'Invalid channel. Must be between 1 and 9.'
            })
        }

        const port = portForChannel(channel)
        const result = await whatsappOrchestrator.restartInstance(port)

        if (result.success) {
            sendResponse(200, {
                success: true,
                instance: result.instance,
                channel: result.channel || channel,
                port: result.port || port,
                suggestions: result.suggestions || null
            })
        } else {
            sendResponse(400, {
                success: false,
                error: result.error,
                channel: result.channel || channel,
                port: result.port || port
            })
        }
    } catch (error) {
        console.error('[RESTART ENDPOINT ERROR]', error)
        sendResponse(500, { success: false, error: error.message })
    }
})

// Update channel metadata
app.put('/api/wa-orchestrator/channels/:channel/metadata', async (req, res) => {
    try {
        const channel = parseInt(req.params.channel)
        const { metadata } = req.body

        // Validate channel range
        if (isNaN(channel) || channel < 1 || channel > 9) {
            return res.status(400).json({
                success: false,
                error: 'Invalid channel. Must be between 1 and 9.'
            })
        }

        if (!metadata || typeof metadata !== 'object') {
            return res.status(400).json({
                success: false,
                error: 'Metadata object required'
            })
        }

        const port = portForChannel(channel)
        const result = await whatsappOrchestrator.updateInstanceMetadata(port, metadata)

        if (result.success) {
            res.json({
                success: true,
                channel: result.channel || channel,
                port: result.port
            })
        } else {
            res.status(404).json({
                success: false,
                error: result.error,
                suggestion: result.suggestion || null
            })
        }
    } catch (error) {
        res.status(500).json({ success: false, error: error.message })
    }
})

// Get next available channel
app.get('/api/wa-orchestrator/next-channel', async (req, res) => {
    try {
        const channel = whatsappOrchestrator.getNextAvailableChannel()
        if (channel) {
            const port = portForChannel(channel)
            res.json({
                success: true,
                channel,
                port,
                message: `Channel ${channel} (port ${port}) is available`
            })
        } else {
            const status = whatsappOrchestrator.getStatus()
            res.status(409).json({
                success: false,
                error: 'No available channels',
                status: {
                    totalChannels: status.totalChannels,
                    availableChannels: status.availableChannels,
                    freeInstances: status.freeInstances,
                    connectedInstances: status.connectedInstances,
                    errorInstances: status.errorInstances
                }
            })
        }
    } catch (error) {
        res.status(500).json({ success: false, error: error.message })
    }
})

// Health endpoint for microservice monitoring
app.get('/health', (req, res) => {
    res.status(200).json({
        ok: true,
        status: 'healthy',
        service: 'CRM Microservice',
        port: process.env.CRM_API_PORT || process.env.PORT || 8099,
        timestamp: new Date().toISOString()
    })
})

app.get('/api/health', (req, res) => {
    res.status(200).json({
        ok: true,
        status: 'healthy',
        service: 'CRM API',
        conversations: conversations.length,
        timestamp: new Date().toISOString()
    })
})

// =================================================================
// WhatsApp Channel Proxy Routes (Channel 1 → Port 3001)
// =================================================================

// Helper function to map channel to port (only channel 1 supported for official module)
const channelToPort = (channel) => channel === 1 ? 3001 : null

// Helper function to check if channel instance is running and ready
const isChannelRunning = async (channel) => {
    try {
        const status = whatsappOrchestrator.getStatus()

        // Ensure channels array exists
        if (!status || !Array.isArray(status.channels)) {
            console.warn(`[Proxy] Invalid status response for channel ${channel}:`, status)
            return false
        }

        const instance = status.channels.find(inst => inst.channel === channel)

        // Channel is ready if it has an instance with active server status
        const isReady = instance && (
            instance.status === 'connected' ||
            instance.status === 'qr_pending' ||
            instance.status === 'starting'
        )

        console.log(`[Proxy] Channel ${channel} check: status=${instance?.status}, ready=${isReady}`)
        return isReady
    } catch (error) {
        console.error(`[Proxy] Error checking channel ${channel}:`, error.message)
        return false
    }
}

// Dynamic proxy route for official WhatsApp module (channel 1 only)
for (let channel = 1; channel <= 1; channel++) {
    const port = channelToPort(channel) // Always 3001 for official module
    const channelRoute = `/canal${channel}` // Only /canal1 for official module

    // Create proxy middleware for each channel
    const channelProxy = createProxyMiddleware({
        target: `http://localhost:${port}`,
        changeOrigin: true,
        pathRewrite: {
            [`^/canal${channel}`]: '', // Remove /canal{N} prefix
        },
        onError: (err, req, res) => {
            console.error(`[Proxy Error] Canal ${channel} (Port ${port}):`, err.message)
            res.status(503).json({
                success: false,
                error: `Canal ${channel} não está disponível`,
                hint: `Certifique-se de que o canal ${channel} esteja conectado e funcionando`,
                redirect: '/'
            })
        },
        onProxyReq: (proxyReq, req, res) => {
            console.log(`[Proxy] Redirecting ${req.path} → localhost:${port}`)
        },
        onProxyRes: (proxyRes, req, res) => {
            // Add custom headers to identify the proxied channel
            proxyRes.headers['x-whatsapp-channel'] = channel.toString()
            proxyRes.headers['x-whatsapp-port'] = port.toString()
        },
        // Only proxy if channel is actually running
        router: async (req) => {
            const isRunning = await isChannelRunning(channel)
            if (!isRunning) {
                return null // This will trigger onError
            }
            return `http://localhost:${port}`
        }
    })

    // Register the proxy route
    app.use(channelRoute, async (req, res, next) => {
        // First check if channel is running
        const isRunning = await isChannelRunning(channel)

        if (!isRunning) {
            return res.status(503).json({
                success: false,
                error: `Canal ${channel} não está conectado`,
                hint: `Inicie o Canal ${channel} antes de tentar acessar seu dashboard`,
                channel: channel,
                port: port,
                redirect: '/'
            })
        }

        // If running, proceed with proxy
        channelProxy(req, res, next)
    })

    console.log(`📡 Proxy route registered: ${channelRoute} → localhost:${port}`)
}

// Serve the React app for all non-API/non-channel routes (MUST BE LAST)
app.use((req, res, next) => {
    // Skip if it's an API route, health check, or channel proxy route
    if (req.path.startsWith('/api/') ||
        req.path === '/health' ||
        req.path.startsWith('/canal')) {
        return next()
    }

    // For all other routes, serve the React app
    res.sendFile(path.join(CRM_UI_DIR, 'index.html'))
})

// CRM Backend API configuration - default port 8099 (separate from frontend on 5000)
const PORT = process.env.CRM_API_PORT || process.env.PORT || 8099
app.listen(PORT, '0.0.0.0', () => {
    console.log(`🚀 CRM Backend API running on http://0.0.0.0:${PORT}`)
    console.log(`📊 Health check: http://localhost:${PORT}/health`)
    console.log(`🎯 API endpoints: http://localhost:${PORT}/api/`)
    console.log(`⚙️  Mode: ${process.env.NODE_ENV || 'development'}`)
})
