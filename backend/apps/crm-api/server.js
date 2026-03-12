import express from 'express'
import cors from 'cors'
import { randomUUID, createHmac, timingSafeEqual, randomBytes, createHash, createCipheriv, createDecipheriv } from 'crypto'
import nodeUtil from 'node:util'
import { promises as fs } from 'fs'
import fsSync from 'fs'
import os from 'os'
import path from 'path'
import { fileURLToPath } from 'url'
import { spawn, spawnSync } from 'child_process'

// http-proxy still calls util._extend on some Node versions. Patch before loading the middleware.
if (typeof nodeUtil._extend === 'function' && nodeUtil._extend !== Object.assign) {
    nodeUtil._extend = Object.assign
}
const { createProxyMiddleware } = await import('http-proxy-middleware')

let devAuthSessionResolver = null
let devAuthEnabled = false

// WhatsApp Orchestrator (backend-only)
import { whatsappOrchestrator } from './services/whatsappOrchestrator.js'
import { evolutionOrchestrator } from './services/evolutionOrchestrator.js'
import { waMessageMetaStore } from './services/waMessageMetaStore.js'

// Ponto (reconhecimento facial + batidas)
import { registerPontoRoutes } from './server/pontoRoutes.js'

// Harmonia (atendimento de leads via WhatsApp - Decision API)
import { createHarmoniaRouter } from './server/harmonia/routes.js'
import { startHarmoniaWorker } from './server/harmonia/worker.js'

// Axios for facade requests to Unified System
import axios from 'axios'

// Base directory resolution (compatível com ESM)
const __dirname = path.dirname(fileURLToPath(import.meta.url))
// server.js lives in: <repo>/backend/apps/crm-api/server.js
// so repo root is 3 levels up from __dirname (<repo>/backend/apps/crm-api -> <repo>).
const REPO_ROOT = path.resolve(__dirname, '..', '..', '..')
const BACKEND_ROOT = path.join(REPO_ROOT, 'backend')
function resolveCrmUiDir() {
    const env = String(process.env.CRM_UI_DIR || '').trim()
    const candidates = []

    if (env) {
        const abs = path.resolve(env)
        if (path.basename(abs) === 'dist') {
            candidates.push(abs)
        } else {
            // If env points to the frontend root, prefer the built output.
            candidates.push(path.join(abs, 'dist'))
            candidates.push(abs)
        }
    }

    // Prefer built UI if present (prevents browsers trying to import /main.tsx in production).
    candidates.push(path.join(REPO_ROOT, 'frontend', 'dist'))

    // Fallback for dev environments (Vite dev server uses frontend/ index.html).
    candidates.push(path.join(REPO_ROOT, 'frontend'))

    for (const dir of candidates) {
        try {
            if (fsSync.existsSync(path.join(dir, 'index.html'))) return dir
        } catch { /* ignore */ }
    }

    return path.join(REPO_ROOT, 'frontend')
}

const CRM_UI_DIR = resolveCrmUiDir()
const VAR_DIR = process.env.VAR_DIR || path.join(BACKEND_ROOT, 'var')
const CORE_STATE_DIR = path.join(VAR_DIR, 'core')
const WA_LOCAL_RECOVERY_ENABLED = String(
    process.env.WA_LOCAL_RECOVERY_ENABLED || (process.platform === 'darwin' ? 'true' : 'false')
).toLowerCase() === 'true'
const WA_LOCAL_RECOVERY_SCRIPT = String(
    process.env.WA_LOCAL_RECOVERY_SCRIPT || path.join(REPO_ROOT, 'scripts', 'ensure-whatsapp-stack.sh')
).trim()
const WA_LOCAL_RECOVERY_TIMEOUT_MS = Math.max(
    15_000,
    Number.parseInt(String(process.env.WA_LOCAL_RECOVERY_TIMEOUT_MS || '90000'), 10) || 90_000
)
const WA_LOCAL_RECOVERY_SYNC_REMOTE = String(process.env.WA_LOCAL_RECOVERY_SYNC_REMOTE || 'origin').trim() || 'origin'
const WA_LOCAL_RECOVERY_SYNC_BRANCH = String(process.env.WA_LOCAL_RECOVERY_SYNC_BRANCH || 'main').trim() || 'main'
const WA_LOCAL_RECOVERY_SYNC_TIMEOUT_MS = Math.max(
    15_000,
    Number.parseInt(String(process.env.WA_LOCAL_RECOVERY_SYNC_TIMEOUT_MS || '120000'), 10) || 120_000
)
const WA_LOCAL_RECOVERY_SYNC_ALLOW_AUTOSTASH = String(
    process.env.WA_LOCAL_RECOVERY_SYNC_ALLOW_AUTOSTASH || 'false'
).toLowerCase() === 'true'
const LOCAL_EVOLUTION_LAUNCHD_LABEL = String(
    process.env.LOCAL_EVOLUTION_LAUNCHD_LABEL || 'com.skincos.evolution-api'
).trim()
const WA_BOOTSTRAP_SYNC_ENABLED = String(process.env.WA_BOOTSTRAP_SYNC_ENABLED || 'true').toLowerCase() !== 'false'
const WA_BOOTSTRAP_SYNC_AUTO_ON_CONNECTED = String(process.env.WA_BOOTSTRAP_SYNC_AUTO_ON_CONNECTED || 'true').toLowerCase() !== 'false'
const WA_BOOTSTRAP_CONTACT_PAGE_SIZE = Math.min(500, Math.max(25, Number.parseInt(String(process.env.WA_BOOTSTRAP_CONTACT_PAGE_SIZE || '200'), 10) || 200))
const WA_BOOTSTRAP_MAX_CONTACT_PAGES = Math.min(2000, Math.max(1, Number.parseInt(String(process.env.WA_BOOTSTRAP_MAX_CONTACT_PAGES || '80'), 10) || 80))
const WA_BOOTSTRAP_CHAT_PAGE_SIZE = Math.min(500, Math.max(25, Number.parseInt(String(process.env.WA_BOOTSTRAP_CHAT_PAGE_SIZE || '150'), 10) || 150))
const WA_BOOTSTRAP_MESSAGE_PAGE_SIZE = Math.min(250, Math.max(25, Number.parseInt(String(process.env.WA_BOOTSTRAP_MESSAGE_PAGE_SIZE || '100'), 10) || 100))
const WA_BOOTSTRAP_MAX_CHAT_PAGES = Math.min(2000, Math.max(1, Number.parseInt(String(process.env.WA_BOOTSTRAP_MAX_CHAT_PAGES || '60'), 10) || 60))
const WA_BOOTSTRAP_MAX_MESSAGE_PAGES_PER_CHAT = Math.min(2000, Math.max(1, Number.parseInt(String(process.env.WA_BOOTSTRAP_MAX_MESSAGE_PAGES_PER_CHAT || '80'), 10) || 80))
const WA_BOOTSTRAP_AUTO_COOLDOWN_MS = Math.max(30_000, Number.parseInt(String(process.env.WA_BOOTSTRAP_AUTO_COOLDOWN_MS || '300000'), 10) || 300_000)

try { await fs.mkdir(CORE_STATE_DIR, { recursive: true }) } catch { /* ignore */ }

const app = express()

const LOG_LEVEL = String(process.env.CRM_LOG_LEVEL || (process.env.NODE_ENV === 'development' ? 'warn' : 'info')).toLowerCase()
const LOG_LEVEL_RANK = { silent: 0, error: 1, warn: 2, info: 3, debug: 4 }
const shouldLog = (level) => {
    const current = LOG_LEVEL_RANK[String(level || 'info').toLowerCase()] ?? 3
    const min = LOG_LEVEL_RANK[LOG_LEVEL] ?? 3
    return current <= min
}

function isLoopbackIp(ipRaw) {
    const ip = String(ipRaw || '').trim().toLowerCase()
    if (!ip) return false
    if (ip === '::1') return true
    if (ip === '127.0.0.1') return true
    if (ip.startsWith('127.')) return true
    if (ip === '::ffff:127.0.0.1') return true
    if (ip.startsWith('::ffff:127.')) return true
    return false
}

function truncateText(value, max = 3000) {
    const text = String(value || '')
    if (text.length <= max) return text
    return `${text.slice(0, max)}\n...[truncated]`
}

function normalizeBoolean(value, defaultValue = false) {
    if (value === undefined || value === null) return Boolean(defaultValue)
    const normalized = String(value).trim().toLowerCase()
    if (!normalized) return Boolean(defaultValue)
    if (['1', 'true', 'yes', 'on'].includes(normalized)) return true
    if (['0', 'false', 'no', 'off'].includes(normalized)) return false
    return Boolean(defaultValue)
}

function parseRecoverySyncSha(value) {
    const text = String(value || '').trim()
    if (!text) return { sha: '', invalid: false }
    if (!/^[0-9a-f]{7,40}$/i.test(text)) return { sha: '', invalid: true }
    return { sha: text.toLowerCase(), invalid: false }
}

function isStepSuccessful(step) {
    if (!step) return false
    if (step.timedOut) return false
    if (typeof step.code === 'number' && step.code !== 0) return false
    return true
}

async function runLocalRecoveryRepoSync({ sha = '', autoStash = true } = {}) {
    const repoDir = REPO_ROOT
    const remote = WA_LOCAL_RECOVERY_SYNC_REMOTE
    const branch = WA_LOCAL_RECOVERY_SYNC_BRANCH
    const timeoutMs = WA_LOCAL_RECOVERY_SYNC_TIMEOUT_MS
    const steps = []

    const pushStep = async (name, command, args, stepTimeoutMs = timeoutMs) => {
        const step = await runCommandWithTimeout(command, args, { timeoutMs: stepTimeoutMs })
        steps.push({ name, ...step })
        return step
    }

    const insideRepo = await pushStep('repo-check', 'git', ['-C', repoDir, 'rev-parse', '--is-inside-work-tree'], 12_000)
    if (!isStepSuccessful(insideRepo)) {
        return { success: false, error: 'RECOVERY_SYNC_REPO_INVALID', steps }
    }

    const statusStep = await pushStep('status', 'git', ['-C', repoDir, 'status', '--porcelain'], 15_000)
    if (!isStepSuccessful(statusStep)) {
        return { success: false, error: 'RECOVERY_SYNC_STATUS_FAILED', steps }
    }

    const repoDirty = String(statusStep.stdout || '').trim().length > 0
    if (repoDirty) {
        if (!autoStash) {
            return { success: false, error: 'RECOVERY_SYNC_REPO_DIRTY', repoDirty, steps }
        }
        const stashLabel = `wa-recovery-autostash-${new Date().toISOString()}`
        const stashStep = await pushStep('stash', 'git', ['-C', repoDir, 'stash', 'push', '--include-untracked', '--message', stashLabel], 45_000)
        if (!isStepSuccessful(stashStep)) {
            return { success: false, error: 'RECOVERY_SYNC_STASH_FAILED', repoDirty, steps }
        }
    }

    const fetchStep = await pushStep('fetch', 'git', ['-C', repoDir, 'fetch', remote, '--prune'], timeoutMs)
    if (!isStepSuccessful(fetchStep)) {
        return { success: false, error: 'RECOVERY_SYNC_FETCH_FAILED', repoDirty, steps }
    }

    let checkoutStep = await pushStep('checkout', 'git', ['-C', repoDir, 'checkout', branch], 30_000)
    if (!isStepSuccessful(checkoutStep)) {
        checkoutStep = await pushStep('checkout-create', 'git', ['-C', repoDir, 'checkout', '-B', branch, `${remote}/${branch}`], 30_000)
        if (!isStepSuccessful(checkoutStep)) {
            return { success: false, error: 'RECOVERY_SYNC_CHECKOUT_FAILED', repoDirty, steps }
        }
    }

    let targetRef = `${remote}/${branch}`
    if (sha) {
        const verifyShaStep = await pushStep('verify-sha', 'git', ['-C', repoDir, 'cat-file', '-e', `${sha}^{commit}`], 15_000)
        if (!isStepSuccessful(verifyShaStep)) {
            return { success: false, error: 'RECOVERY_SYNC_SHA_NOT_FOUND', repoDirty, steps }
        }
        const verifyOnBranchStep = await pushStep(
            'verify-sha-on-branch',
            'git',
            ['-C', repoDir, 'merge-base', '--is-ancestor', sha, `${remote}/${branch}`],
            15_000
        )
        if (!isStepSuccessful(verifyOnBranchStep)) {
            return { success: false, error: 'RECOVERY_SYNC_SHA_NOT_IN_TARGET_BRANCH', repoDirty, steps }
        }
        targetRef = sha
    }

    const resetStep = await pushStep('reset', 'git', ['-C', repoDir, 'reset', '--hard', targetRef], timeoutMs)
    if (!isStepSuccessful(resetStep)) {
        return { success: false, error: 'RECOVERY_SYNC_RESET_FAILED', repoDirty, steps }
    }

    const headStep = await pushStep('head', 'git', ['-C', repoDir, 'rev-parse', 'HEAD'], 10_000)
    const appliedSha = isStepSuccessful(headStep) ? String(headStep.stdout || '').trim() : ''
    return {
        success: true,
        repoDirty,
        targetRef,
        appliedSha,
        steps
    }
}

function runCommandWithTimeout(command, args = [], options = {}) {
    const timeoutMs = Math.max(1000, Number(options.timeoutMs || 30_000))
    const cwd = options.cwd || REPO_ROOT
    const env = options.env || process.env
    return new Promise((resolve) => {
        let stdout = ''
        let stderr = ''
        let timedOut = false
        let settled = false
        let exitCode = null
        let exitSignal = null
        const child = spawn(command, args, {
            cwd,
            env,
            stdio: ['ignore', 'pipe', 'pipe']
        })

        const finalize = () => {
            if (settled) return
            settled = true
            clearTimeout(timer)
            resolve({
                command,
                args,
                cwd,
                code: typeof exitCode === 'number' ? exitCode : (timedOut ? 124 : null),
                signal: exitSignal || null,
                timedOut,
                stdout: truncateText(stdout),
                stderr: truncateText(stderr)
            })
        }

        child.stdout.on('data', (chunk) => {
            stdout += String(chunk || '')
        })
        child.stderr.on('data', (chunk) => {
            stderr += String(chunk || '')
        })
        child.on('error', (error) => {
            stderr += `${error?.message || String(error)}\n`
            exitCode = 1
            finalize()
        })
        child.on('close', (code, signal) => {
            exitCode = code
            exitSignal = signal
            finalize()
        })

        const timer = setTimeout(() => {
            if (settled) return
            timedOut = true
            try {
                child.kill('SIGTERM')
            } catch { /* ignore */ }
            setTimeout(() => {
                if (settled) return
                try {
                    child.kill('SIGKILL')
                } catch { /* ignore */ }
            }, 1000).unref?.()
        }, timeoutMs)
        timer.unref?.()
    })
}

// -------------------------------------------------------------
// Gateway hardening (Unit Monitor LAN gateway behind a tunnel)
// -------------------------------------------------------------
const IS_GATEWAY_MODE = String(process.env.SKINCOS_GATEWAY || '') === '1'

// Correlation id for diagnostics across Pages -> Gateway -> child processes.
app.use((req, res, next) => {
    const incoming = String(req.headers['x-request-id'] || '').trim()
    const requestId = incoming || randomUUID()
    req.requestId = requestId
    res.setHeader('x-request-id', requestId)
    next()
})

app.use((req, res, next) => {
    const startedAt = Date.now()
    res.on('finish', () => {
        const status = res.statusCode || 200
        const level = status >= 500 ? 'error' : status >= 400 ? 'warn' : 'info'
        const payload = {
            level,
            request_id: req.requestId || 'unknown',
            method: req.method,
            path: req.originalUrl || req.path || '/',
            status,
            duration_ms: Date.now() - startedAt,
            ip: req.ip,
        }
        if (shouldLog(level)) {
            console.log(JSON.stringify(payload))
        }
    })
    next()
})

// In gateway mode, fail closed: only expose health + Unit Monitor routes.
app.use((req, res, next) => {
    if (!IS_GATEWAY_MODE) return next()
    if (req.method === 'OPTIONS') return res.sendStatus(200)
    const p = req.path || '/'
    if (p === '/health' || p.startsWith('/api/unit-monitor')) return next()
    return res.status(404).json({ ok: false, error: 'Not found' })
})

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
    allowedHeaders: ['Content-Type', 'Authorization', 'Cache-Control', 'X-Requested-With', 'Accept', 'X-CSRF-Token', 'X-Tenant-Key', 'X-User-Role', 'X-CRM-Role', 'X-Role'],
    exposedHeaders: ['Content-Length', 'X-Total-Count'],
    optionsSuccessStatus: 200 // Legacy browser support
}))

// Handle preflight OPTIONS requests early to prevent middleware conflicts
app.use((req, res, next) => {
    if (req.method === 'OPTIONS') {
        res.header('Access-Control-Allow-Origin', req.headers.origin || '*')
        res.header('Access-Control-Allow-Methods', 'GET,POST,PUT,DELETE,OPTIONS,PATCH')
        res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization, Cache-Control, X-Requested-With, Accept, X-CSRF-Token, X-Tenant-Key, X-User-Role, X-CRM-Role, X-Role')
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
app.use(express.json({
    limit: '10mb',
    verify: (req, _res, buf) => {
        req.rawBody = buf
    },
}))
app.use(express.urlencoded({ extended: true, limit: '10mb' }))

// -------------------------------------------------------------
// Dev-only Auth stub (for local testing without Cloudflare Pages Functions)
// Frontend expects `/api/auth/*` endpoints (normally served by Pages Functions).
// When running locally with `NO_AUTH=true`, provide a minimal cookie-based session.
// -------------------------------------------------------------
const NODE_ENV_NAME = String(process.env.NODE_ENV || '').toLowerCase()
const isTruthyEnv = (value) => {
    const raw = String(value ?? '').trim().toLowerCase()
    return raw === '1' || raw === 'true' || raw === 'yes' || raw === 'on'
}
const NO_AUTH_ENABLED = isTruthyEnv(process.env.NO_AUTH)
const DEV_AUTH_ENABLED = NODE_ENV_NAME !== 'production' && NO_AUTH_ENABLED
let devAuthRequireAdmin = null
if (DEV_AUTH_ENABLED) {
    const DEV_AUTH_COOKIE = 'skincos_dev_session'
    const DEV_AUTH_SECRET = String(process.env.DEV_SESSION_SECRET || process.env.SESSION_SECRET || 'dev-only-session-secret')
    // Must be a valid email per Ponto actor validation (requires a dot in domain).
    const DEV_AUTH_EMAIL = String(process.env.DEV_AUTH_EMAIL || 'dev@local.test').trim() || 'dev@local.test'
    const DEV_AUTH_ROLE = String(process.env.DEV_AUTH_ROLE || 'admin').trim() || 'admin'
    const DEV_AUTH_ALLOWED_UNITS = String(process.env.DEV_AUTH_ALLOWED_UNITS || '').trim()
    const DEV_AUTH_ALLOWED_MODULES = String(process.env.DEV_AUTH_ALLOWED_MODULES || 'ponto').trim()
    const DEV_AUTH_AUTO = String(process.env.DEV_AUTH_AUTO || 'true').toLowerCase() !== 'false'

    const base64urlEncode = (input) => Buffer.from(input).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '')
    const base64urlDecode = (input) => {
        const raw = String(input || '').replace(/-/g, '+').replace(/_/g, '/')
        const pad = raw.length % 4 ? '='.repeat(4 - (raw.length % 4)) : ''
        return Buffer.from(raw + pad, 'base64').toString('utf8')
    }
    const sign = (payloadB64) => createHmac('sha256', DEV_AUTH_SECRET).update(payloadB64).digest('hex')
    const timingSafeEqHex = (a, b) => {
        try {
            const aa = Buffer.from(String(a || ''), 'hex')
            const bb = Buffer.from(String(b || ''), 'hex')
            if (aa.length !== bb.length) return false
            return timingSafeEqual(aa, bb)
        } catch {
            return false
        }
    }
    const parseCookies = (cookieHeader) => {
        const out = {}
        const raw = String(cookieHeader || '')
        if (!raw) return out
        raw.split(';').forEach((part) => {
            const idx = part.indexOf('=')
            if (idx < 0) return
            const k = part.slice(0, idx).trim()
            const v = part.slice(idx + 1).trim()
            if (!k) return
            out[k] = v
        })
        return out
    }
    const buildUser = ({ email, role }) => {
        const safeEmail = String(email || '').trim() || DEV_AUTH_EMAIL
        const username = safeEmail.includes('@') ? safeEmail.split('@')[0] : safeEmail
        const allowedUnits = DEV_AUTH_ALLOWED_UNITS
            ? DEV_AUTH_ALLOWED_UNITS.split(',').map(s => s.trim()).filter(Boolean)
            : undefined
        const allowedModules = DEV_AUTH_ALLOWED_MODULES
            ? DEV_AUTH_ALLOWED_MODULES.split(',').map(s => s.trim()).filter(Boolean)
            : undefined
        return {
            email: safeEmail,
            username,
            displayName: username,
            role: String(role || DEV_AUTH_ROLE || 'admin'),
            allowedUnits,
            allowedModules,
            createdAt: new Date().toISOString(),
        }
    }
    const DEV_AUTH_CSRF_DEFAULT = 'dev-csrf'
    const newCsrf = () => randomBytes(12).toString('hex')

    const encodeSession = ({ user, csrfToken }) => {
        const payload = JSON.stringify({ v: 1, user, csrfToken: csrfToken || DEV_AUTH_CSRF_DEFAULT })
        const payloadB64 = base64urlEncode(payload)
        const sig = sign(payloadB64)
        return `${payloadB64}.${sig}`
    }
    const decodeSession = (value) => {
        const raw = String(value || '').trim()
        if (!raw) return null
        const [payloadB64, sig] = raw.split('.', 2)
        if (!payloadB64 || !sig) return null
        const expected = sign(payloadB64)
        if (!timingSafeEqHex(sig, expected)) return null
        try {
            const json = JSON.parse(base64urlDecode(payloadB64))
            const user = json?.user || null
            const csrfToken = typeof json?.csrfToken === 'string' ? json.csrfToken : DEV_AUTH_CSRF_DEFAULT
            if (!user || !user.email) return null
            return { user, csrfToken }
        } catch {
            return null
        }
    }
    const setDevCookie = (res, sessionValue) => {
        const cookie = `${DEV_AUTH_COOKIE}=${sessionValue}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${60 * 60 * 24 * 7}`
        res.setHeader('Set-Cookie', cookie)
    }
    const clearDevCookie = (res) => {
        const cookie = `${DEV_AUTH_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`
        res.setHeader('Set-Cookie', cookie)
    }

    const getSessionFromReq = (req) => {
        const cookies = parseCookies(req.headers?.cookie)
        const current = cookies[DEV_AUTH_COOKIE]
        return decodeSession(current)
    }
    devAuthSessionResolver = getSessionFromReq
    devAuthEnabled = true

    app.get('/api/auth/me', (req, res) => {
        res.setHeader('Cache-Control', 'no-store')
        const existing = getSessionFromReq(req)
        if (existing?.user) return res.json({ ok: true, user: existing.user, csrfToken: existing.csrfToken || DEV_AUTH_CSRF_DEFAULT })
        if (!DEV_AUTH_AUTO) return res.status(401).json({ ok: false, error: 'UNAUTHORIZED' })
        const user = buildUser({ email: DEV_AUTH_EMAIL, role: DEV_AUTH_ROLE })
        const csrfToken = newCsrf()
        setDevCookie(res, encodeSession({ user, csrfToken }))
        return res.json({ ok: true, user, csrfToken })
    })

    app.post('/api/auth/login', (req, res) => {
        res.setHeader('Cache-Control', 'no-store')
        const body = req.body && typeof req.body === 'object' ? req.body : {}
        const email = String(body.email || '').trim() || DEV_AUTH_EMAIL
        const password = String(body.password || '')
        if (!email || !password) return res.status(400).json({ ok: false, error: 'EMAIL_PASSWORD_REQUIRED' })
        const user = buildUser({ email, role: DEV_AUTH_ROLE })
        const csrfToken = newCsrf()
        setDevCookie(res, encodeSession({ user, csrfToken }))
        return res.json({ ok: true, user, csrfToken })
    })

    app.post('/api/auth/register', (req, res) => {
        res.setHeader('Cache-Control', 'no-store')
        const body = req.body && typeof req.body === 'object' ? req.body : {}
        const email = String(body.email || '').trim() || DEV_AUTH_EMAIL
        const name = String(body.name || '').trim()
        const password = String(body.password || '')
        if (!email || !password || !name) return res.status(400).json({ ok: false, error: 'NAME_EMAIL_PASSWORD_REQUIRED' })
        const user = buildUser({ email, role: DEV_AUTH_ROLE })
        user.displayName = name
        const csrfToken = newCsrf()
        setDevCookie(res, encodeSession({ user, csrfToken }))
        return res.json({ ok: true, user, csrfToken })
    })

    app.post('/api/auth/refresh', (req, res) => {
        res.setHeader('Cache-Control', 'no-store')
        const existing = getSessionFromReq(req)
        if (!existing?.user) return res.status(401).json({ ok: false, error: 'UNAUTHORIZED' })
        const csrfToken = newCsrf()
        setDevCookie(res, encodeSession({ user: existing.user, csrfToken }))
        return res.json({ ok: true, user: existing.user, csrfToken })
    })

    app.post('/api/auth/logout', (_req, res) => {
        res.setHeader('Cache-Control', 'no-store')
        clearDevCookie(res)
        return res.json({ ok: true })
    })

    app.get('/api/insumos/health', (_req, res) => {
        res.setHeader('Cache-Control', 'no-store')
        const units = DEV_AUTH_ALLOWED_UNITS
            ? DEV_AUTH_ALLOWED_UNITS.split(',').map(s => s.trim()).filter(Boolean)
            : ['local']
        return res.json({ ok: true, unidades: units, source: 'local-dev' })
    })
}

// -------------------------------------------------------------
// Visual Theme (branding/palettes) - file-based persistence
// -------------------------------------------------------------
const VISUAL_THEME_FILE = process.env.CRM_VISUAL_THEME_FILE || path.join(CORE_STATE_DIR, 'visual_theme.v1.json')
let visualThemeState = { themes: {} }
let saveVisualThemeTimer = null

const ROLE_ALIASES = new Map([
    ['ADMIN', 'GESTOR'],
    ['OPERADOR', 'INJETOR'],
])

const normalizeRole = (value) => {
    const raw = String(value || '').trim().toUpperCase()
    if (!raw) return ''
    return ROLE_ALIASES.get(raw) || raw
}

const normalizeCrmUser = (user) => {
    if (!user || typeof user !== 'object') return user
    const role = normalizeRole(user.role)
    if (!role || role === user.role) return user
    return { ...user, role }
}

const ADMIN_ROLES = new Set(['GESTOR', 'GERENTE'])

function resolveTenantKey(req) {
    const header = String(req.headers['x-tenant-key'] || req.headers['x-tenant'] || '').trim()
    let key = header || String(req.headers['x-forwarded-host'] || req.headers['host'] || '').trim().toLowerCase()
    if (key.includes(',')) key = key.split(',')[0].trim()
    key = key.replace(/^https?:\/\//, '')
    if (key.includes('/')) key = key.split('/')[0].trim()
    if (key.includes(':')) key = key.split(':')[0].trim()
    key = key.replace(/[^a-z0-9._-]/g, '-')
    if (!key) key = 'default'
    return key
}

function resolveRoleFromReq(req) {
    const header = req.headers['x-user-role'] || req.headers['x-crm-role'] || req.headers['x-role']
    let role = header ? String(header) : ''
    if (!role && req.user?.role) role = String(req.user.role)
    return normalizeRole(role)
}

function requireVisualThemeAdmin(req, res) {
    if (devAuthRequireAdmin) return devAuthRequireAdmin(req, res)
    const role = resolveRoleFromReq(req)
    if (!role) {
        res.status(401).json({ ok: false, error: 'UNAUTHORIZED', code: 'UNAUTHORIZED' })
        return null
    }
    if (!ADMIN_ROLES.has(role)) {
        res.status(403).json({ ok: false, error: 'FORBIDDEN', code: 'FORBIDDEN' })
        return null
    }
    return { user: { role } }
}

async function loadVisualThemeState() {
    try {
        const raw = await fs.readFile(VISUAL_THEME_FILE, 'utf-8')
        const json = JSON.parse(raw)
        if (json && typeof json === 'object') {
            const themes = json.themes && typeof json.themes === 'object' ? json.themes : {}
            visualThemeState = { themes }
        }
    } catch { /* ignore */ }
}

async function persistVisualThemeNow() {
    try {
        await fs.writeFile(VISUAL_THEME_FILE, JSON.stringify(visualThemeState, null, 2))
    } catch (e) {
        console.error('[VISUAL_THEME] Persist failed', e)
    }
}

function schedulePersistVisualTheme() {
    if (saveVisualThemeTimer) clearTimeout(saveVisualThemeTimer)
    saveVisualThemeTimer = setTimeout(() => { persistVisualThemeNow() }, 500).unref()
}

await loadVisualThemeState()

app.get('/api/visual-theme', (req, res) => {
    res.setHeader('cache-control', 'no-store')
    const tenantKey = resolveTenantKey(req)
    const entry = visualThemeState.themes && typeof visualThemeState.themes === 'object'
        ? visualThemeState.themes[tenantKey]
        : null
    return res.json({
        ok: true,
        tenantKey,
        data: entry?.config || null,
        meta: entry ? { updatedAt: entry.updatedAt || null, updatedBy: entry.updatedBy || null } : null
    })
})

app.put('/api/visual-theme', async (req, res) => {
    const session = requireVisualThemeAdmin(req, res)
    if (!session) return
    const tenantKey = resolveTenantKey(req)
    const body = req.body && typeof req.body === 'object' ? req.body : {}
    const config = body?.config && typeof body.config === 'object' ? body.config : body
    if (!config || typeof config !== 'object') {
        return res.status(400).json({ ok: false, error: 'CONFIG_REQUIRED', code: 'CONFIG_REQUIRED' })
    }
    if (!visualThemeState.themes || typeof visualThemeState.themes !== 'object') {
        visualThemeState.themes = {}
    }
    visualThemeState.themes[tenantKey] = {
        config,
        updatedAt: new Date().toISOString(),
        updatedBy: session?.user?.username || session?.user?.email || session?.user?.role || 'system'
    }
    schedulePersistVisualTheme()
    return res.json({ ok: true, tenantKey, data: visualThemeState.themes[tenantKey] })
})

// -------------------------------------------------------------
// Ponto (registro de ponto com identificação facial)
// Persistência em arquivo (backend/var/core/ponto_store.v1.json)
// -------------------------------------------------------------
try {
    registerPontoRoutes(app, { coreStateDir: CORE_STATE_DIR })
    console.log('✅ Ponto routes registered')
} catch (e) {
    console.warn('⚠️  Ponto routes failed to register:', e?.message || String(e))
}

// -------------------------------------------------------------
// Harmonia (Decision API for n8n executor)
// -------------------------------------------------------------
try {
    app.use('/api/harmonia', createHarmoniaRouter({ varDir: VAR_DIR }))
    console.log('✅ Harmonia routes registered')
} catch (e) {
    console.warn('⚠️  Harmonia routes failed to register:', e?.message || String(e))
}

try {
    startHarmoniaWorker({ varDir: VAR_DIR })
    console.log('✅ Harmonia worker initialized')
} catch (e) {
    console.warn('⚠️  Harmonia worker failed to start:', e?.message || String(e))
}

// -------------------------------------------------------------
// Placeholder images (used by UI mock data)
// GET /api/placeholder/:w/:h?text=...&bg=111827&fg=93c5fd
// Returns SVG (lightweight, cacheable, no deps)
// -------------------------------------------------------------
function sanitizeColor(input, fallback) {
    const raw = typeof input === 'string' ? input.trim() : ''
    if (!raw) return fallback
    const hex = raw.startsWith('#') ? raw.slice(1) : raw
    if (!/^[0-9a-fA-F]{3}([0-9a-fA-F]{3})?$/.test(hex)) return fallback
    return `#${hex.toLowerCase()}`
}
function escapeXml(input) {
    return String(input || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&apos;')
}
app.get('/api/placeholder/:w/:h', (req, res) => {
    const wRaw = Number.parseInt(String(req.params.w || ''), 10)
    const hRaw = Number.parseInt(String(req.params.h || ''), 10)
    const w = Number.isFinite(wRaw) ? Math.max(1, Math.min(2048, wRaw)) : 400
    const h = Number.isFinite(hRaw) ? Math.max(1, Math.min(2048, hRaw)) : 400

    const bg = sanitizeColor(req.query.bg, '#111827')
    const fg = sanitizeColor(req.query.fg, '#93c5fd')
    const text =
        typeof req.query.text === 'string' && req.query.text.trim()
            ? req.query.text.trim().slice(0, 80)
            : `${w}×${h}`

    res.status(200)
    res.setHeader('content-type', 'image/svg+xml; charset=utf-8')
    res.setHeader('cache-control', 'public, max-age=86400, immutable')
    res.end(
        `<?xml version="1.0" encoding="UTF-8"?>` +
        `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" role="img" aria-label="${escapeXml(text)}">` +
        `<rect width="100%" height="100%" fill="${bg}"/>` +
        `<g fill="${fg}" font-family="ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace" font-size="${Math.max(12, Math.min(28, Math.floor(Math.min(w, h) / 10)))}">` +
        `<text x="50%" y="50%" dominant-baseline="middle" text-anchor="middle">${escapeXml(text)}</text>` +
        `</g>` +
        `</svg>`
    )
})

// -------------------------------------------------------------
// Instagram Module proxy (same-origin for CRM UI)
// -------------------------------------------------------------
const INSTAGRAM_MODULE_TARGET = process.env.INSTAGRAM_MODULE_TARGET || 'http://localhost:3103'
app.use('/api/instagram-module', createProxyMiddleware({
    target: INSTAGRAM_MODULE_TARGET,
    changeOrigin: true,
    ws: false,
    logLevel: 'silent',
    pathRewrite: { '^/api/instagram-module': '' }
}))

// -------------------------------------------------------------
// Meta Ads proxy (same-origin for CRM UI)
// -------------------------------------------------------------
const META_ADS_API_TARGET = process.env.META_ADS_API_TARGET || 'http://localhost:4000'
const CRM_PROXY_SECRET = String(process.env.CRM_PROXY_SECRET || process.env.DEV_SESSION_SECRET || '').trim()
const CRM_AUTH_TARGET = String(process.env.AUTH_API_TARGET || process.env.INSUMOS_API_TARGET || 'https://api.skincos.com.br').trim()
const CRM_AUTH_PREFIX = (() => {
    const raw = String(process.env.AUTH_PATH_PREFIX || '/api/auth').trim()
    const prefix = raw.startsWith('/') ? raw : `/${raw}`
    return prefix.replace(/\/$/, '') || '/api/auth'
})()
const CRM_AUTH_CANDIDATES = Array.from(new Set([CRM_AUTH_PREFIX, '/auth', '/api/auth']))

function base64urlEncode(value) {
    return Buffer.from(String(value || '')).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '')
}

async function fetchCrmUserFromAuth(req) {
    try {
        const cookie = req.headers?.cookie
        if (!cookie) return null
        const headers = { accept: 'application/json', cookie }
        for (const prefix of CRM_AUTH_CANDIDATES) {
            const url = new URL(CRM_AUTH_TARGET)
            url.pathname = `${prefix}/me`
            const res = await fetch(url.toString(), { method: 'GET', headers, redirect: 'manual' }).catch(() => null)
            if (!res) continue
            if (res.status === 404 || res.status === 405) continue
            if (!res.ok) return null
            const data = await res.json().catch(() => null)
            const raw = data?.user || data?.usuario || data || null
            if (!raw) return null
            return {
                id: raw.id || raw.username || raw.email,
                username: raw.username,
                displayName: raw.displayName || raw.name || raw.username || raw.email,
                name: raw.name,
                email: raw.email,
                role: normalizeRole(raw.role),
                allowedUnits: raw.allowedUnits,
                allowedModules: raw.allowedModules,
            }
        }
        return null
    } catch {
        return null
    }
}

async function resolveCrmUser(req) {
    if (devAuthEnabled && typeof devAuthSessionResolver === 'function') {
        const session = devAuthSessionResolver(req)
        if (session?.user) return normalizeCrmUser(session.user)
    }
    const user = await fetchCrmUserFromAuth(req)
    return normalizeCrmUser(user)
}

app.use('/api/meta-ads', async (req, res, next) => {
    req.crmUser = await resolveCrmUser(req)
    const hasBearer = String(req.headers?.authorization || '').toLowerCase().startsWith('bearer ')
    if (!req.crmUser && !hasBearer) {
        return res.status(401).json({ ok: false, error: 'UNAUTHORIZED', hint: 'Faça login no CRM para continuar.' })
    }
    return next()
})

app.use('/api/meta-ads', createProxyMiddleware({
    target: META_ADS_API_TARGET,
    changeOrigin: true,
    ws: false,
    logLevel: 'silent',
    pathRewrite: { '^/api/meta-ads': '' },
    onProxyReq: (proxyReq, req) => {
        const user = req.crmUser
        if (!user) return
        const payload = base64urlEncode(JSON.stringify(user))
        proxyReq.setHeader('x-crm-user', payload)
        if (CRM_PROXY_SECRET) {
            const sig = createHmac('sha256', CRM_PROXY_SECRET).update(payload).digest('hex')
            proxyReq.setHeader('x-crm-signature', sig)
        }
    }
}))

// -------------------------------------------------------------
// Insumos API proxy (same-origin for CRM UI)
// -------------------------------------------------------------
// Cloudflare target (default production). Override for local testing.
const isLocalEnv = String(process.env.NODE_ENV || '').toLowerCase() !== 'production'
const INSUMOS_API_TARGET = process.env.INSUMOS_API_TARGET || (isLocalEnv ? 'http://127.0.0.1:8787' : 'https://api.skincos.com.br')
const LOCAL_INSUMOS_AUTH_STUB = isLocalEnv && NO_AUTH_ENABLED
const FORCE_LOCAL_INSUMOS_AUTH_STUB = String(process.env.LOCAL_INSUMOS_AUTH_STUB_FORCE || '').trim() === '1'

function isLocalSafeMode() {
    // In local/dev, default to read-only for upstream production APIs unless explicitly allowed.
    const allow = String(process.env.LOCAL_ALLOW_UPSTREAM_MUTATIONS || '').trim() === '1'
    if (allow) return false
    const override = String(process.env.LOCAL_SAFE_MODE || '').trim()
    if (override === '0') return false
    const envName = String(process.env.NODE_ENV || '').toLowerCase()
    const isLocal = envName !== 'production'
    if (!isLocal) return false
    return true
}

function isProductionUpstream(target) {
    const raw = String(target || '').trim().toLowerCase()
    return raw === 'https://api.skincos.com.br' || raw.endsWith('.skincos.com.br')
}

function blockUpstreamMutationsIfNeeded(targetOrigin) {
    const safe = isLocalSafeMode()
    const prod = isProductionUpstream(targetOrigin)
    return (req, res, next) => {
        if (!safe || !prod) return next()
        const m = String(req.method || '').toUpperCase()
        if (m === 'GET' || m === 'HEAD' || m === 'OPTIONS') return next()
        return res.status(403).json({
            ok: false,
            error: 'LOCAL_READONLY',
            hint: 'Modo local seguro: mutações upstream desabilitadas. Para permitir, rode com LOCAL_ALLOW_UPSTREAM_MUTATIONS=1.'
        })
    }
}

app.get('/api/insumos/_proxy-status', (_req, res) => {
    const safe = isLocalSafeMode()
    const prod = isProductionUpstream(INSUMOS_API_TARGET)
    res.status(200).set('cache-control', 'no-store').json({
        ok: true,
        localDirect: true,
        target: INSUMOS_API_TARGET,
        isProductionTarget: prod,
        localSafeMode: safe,
        mutationsBlocked: safe && prod
    })
})

async function fetchUpstreamInsumosAuthMe(req) {
    try {
        const targetUrl = new URL('/insumos/auth/me', INSUMOS_API_TARGET)
        const headers = new Headers({ accept: 'application/json' })
        const forwardHeader = (name) => {
            const value = req.headers?.[name]
            if (typeof value === 'string' && value.trim()) headers.set(name, value)
        }
        forwardHeader('cookie')
        forwardHeader('authorization')
        forwardHeader('user-agent')
        forwardHeader('x-csrf-token')

        const upstream = await fetch(targetUrl, { method: 'GET', headers })
        const text = await upstream.text()
        let json = null
        try {
            json = text ? JSON.parse(text) : null
        } catch {
            json = null
        }
        return { ok: upstream.ok, status: upstream.status, json }
    } catch {
        return null
    }
}

if (LOCAL_INSUMOS_AUTH_STUB) {
    app.get('/api/insumos/auth/me', async (req, res) => {
        const upstream = await fetchUpstreamInsumosAuthMe(req)
        if (upstream?.ok && upstream?.json) {
            return res.status(200).set('cache-control', 'no-store').json(upstream.json)
        }
        if (!FORCE_LOCAL_INSUMOS_AUTH_STUB) {
            return res.status(200).set('cache-control', 'no-store').json({
                success: false,
                user: null,
                csrfToken: null,
                source: 'local-dev:no-insumos-session'
            })
        }

        const user = await resolveCrmUser(req).catch(() => null)
        return res.status(200).set('cache-control', 'no-store').json({
            success: true,
            user: {
                username: user?.username || user?.email || 'local-admin',
                role: normalizeRole(user?.role || 'GESTOR'),
                allowedUnits: Array.isArray(user?.allowedUnits) ? user.allowedUnits : ['novo-hamburgo']
            },
            csrfToken: 'local-dev'
        })
    })
}

app.use('/api/insumos', blockUpstreamMutationsIfNeeded(INSUMOS_API_TARGET))
app.use('/api/insumos', createProxyMiddleware({
    target: INSUMOS_API_TARGET,
    changeOrigin: true,
    ws: false,
    logLevel: 'silent',
    pathRewrite: { '^/api/insumos': '/insumos' }
}))

// -------------------------------------------------------------
// CRM API endpoints (prod: Pages Function /api/crm/*)
// Local: provide minimal admin stubs so the CRM can be exercised without
// touching production / requiring Pages emulation.
// -------------------------------------------------------------
if (DEV_AUTH_ENABLED) {
    const LOCAL_CRM_STORE_FILE = process.env.LOCAL_CRM_STORE_FILE || path.join(CORE_STATE_DIR, 'local_crm_store.v1.json')

    const base64urlDecode = (input) => {
        const raw = String(input || '').replace(/-/g, '+').replace(/_/g, '/')
        const pad = raw.length % 4 ? '='.repeat(4 - (raw.length % 4)) : ''
        return Buffer.from(raw + pad, 'base64').toString('utf8')
    }
    const parseCookies = (cookieHeader) => {
        const out = {}
        const raw = String(cookieHeader || '')
        if (!raw) return out
        raw.split(';').forEach((part) => {
            const idx = part.indexOf('=')
            if (idx < 0) return
            const k = part.slice(0, idx).trim()
            const v = part.slice(idx + 1).trim()
            if (!k) return
            out[k] = v
        })
        return out
    }
    const timingSafeEqHex = (a, b) => {
        try {
            const aa = Buffer.from(String(a || ''), 'hex')
            const bb = Buffer.from(String(b || ''), 'hex')
            if (aa.length !== bb.length) return false
            return timingSafeEqual(aa, bb)
        } catch {
            return false
        }
    }

    const getDevSession = (req) => {
        try {
            const cookies = parseCookies(req.headers?.cookie)
            const raw = String(cookies['skincos_dev_session'] || '').trim()
            if (!raw) return null
            const [payloadB64, sig] = raw.split('.', 2)
            if (!payloadB64 || !sig) return null
            const secret = String(process.env.DEV_SESSION_SECRET || process.env.SESSION_SECRET || 'dev-only-session-secret')
            const expected = createHmac('sha256', secret).update(payloadB64).digest('hex')
            if (!timingSafeEqHex(sig, expected)) return null
            const json = JSON.parse(base64urlDecode(payloadB64))
            const user = json?.user || null
            if (!user || !user.email) return null
            const csrfToken = typeof json?.csrfToken === 'string' ? json.csrfToken : 'dev-csrf'
            return { user, csrfToken }
        } catch {
            return null
        }
    }

    const requireDevAdmin = (req, res) => {
        const session = getDevSession(req)
        const role = normalizeRole(session?.user?.role)
        const ok = role === 'GESTOR' || role === 'GERENTE'
        if (!ok) {
            res.status(401).json({ ok: false, success: false, error: 'UNAUTHORIZED', code: 'UNAUTHORIZED' })
            return null
        }
        const token = String(req.headers['x-csrf-token'] || '').trim()
        if (!token || token !== String(session?.csrfToken || '')) {
            res.status(403).json({ ok: false, success: false, error: 'CSRF_INVALID', code: 'CSRF_INVALID' })
            return null
        }
        return session
    }
    devAuthRequireAdmin = requireDevAdmin

    const normalizeCrmStore = (store) => {
        const usersIn = Array.isArray(store?.users) ? store.users : []
        const invitesIn = Array.isArray(store?.invites) ? store.invites : []
        let changed = false
        const users = usersIn.map((user) => {
            if (!user || typeof user !== 'object') return user
            const role = normalizeRole(user.role)
            if (role && role !== user.role) changed = true
            return { ...user, role: role || user.role }
        })
        const invites = invitesIn.map((invite) => {
            if (!invite || typeof invite !== 'object') return invite
            const role = normalizeRole(invite.role)
            if (role && role !== invite.role) changed = true
            return { ...invite, role: role || invite.role }
        })
        return { store: { users, invites }, changed }
    }

    const loadLocalCrmStore = async () => {
        try {
            const raw = await fs.readFile(LOCAL_CRM_STORE_FILE, 'utf8')
            const json = raw ? JSON.parse(raw) : {}
            const normalized = normalizeCrmStore({
                users: Array.isArray(json?.users) ? json.users : [],
                invites: Array.isArray(json?.invites) ? json.invites : [],
            })
            if (normalized.changed) {
                await fs.writeFile(LOCAL_CRM_STORE_FILE, JSON.stringify(normalized.store, null, 2), 'utf8')
            }
            return normalized.store
        } catch {
            return { users: [], invites: [] }
        }
    }
    const saveLocalCrmStore = async (store) => {
        try {
            await fs.writeFile(LOCAL_CRM_STORE_FILE, JSON.stringify(store, null, 2), 'utf8')
        } catch {
            // ignore
        }
    }

    app.get('/api/crm/admin/users', async (_req, res) => {
        const store = await loadLocalCrmStore()
        res.status(200).set('cache-control', 'no-store').json({ success: true, data: store.users })
    })
    app.post('/api/crm/admin/users', async (req, res) => {
        const session = requireDevAdmin(req, res)
        if (!session) return
        const store = await loadLocalCrmStore()
        const body = req.body && typeof req.body === 'object' ? req.body : {}
        const username = String(body.username || '').trim()
        if (!username) return res.status(400).json({ success: false, error: 'USERNAME_REQUIRED', code: 'USERNAME_REQUIRED' })
        const exists = store.users.find((u) => String(u?.username || '').toLowerCase() === username.toLowerCase())
        if (exists) return res.status(409).json({ success: false, error: 'USERNAME_TAKEN', code: 'USERNAME_TAKEN' })
        const user = {
            username,
            email: String(body.email || '').trim() || null,
            displayName: String(body.displayName || body.name || username).trim(),
            role: normalizeRole(body.role || 'INJETOR'),
            allowedUnits: Array.isArray(body.allowedUnits) ? body.allowedUnits.map((x) => String(x)).filter(Boolean) : [],
            allowedModules: Array.isArray(body.allowedModules) ? body.allowedModules.map((x) => String(x)).filter(Boolean) : [],
            ativo: body.ativo !== false,
            password: typeof body.password === 'string' ? body.password : null,
            note: typeof body.note === 'string' ? body.note : null,
            createdBy: session?.user?.username || session?.user?.email || 'dev',
            createdAt: new Date().toISOString(),
        }
        store.users.push(user)
        await saveLocalCrmStore(store)
        res.status(200).set('cache-control', 'no-store').json({ success: true, data: user })
    })
    app.put('/api/crm/admin/users/:username', async (req, res) => {
        const session = requireDevAdmin(req, res)
        if (!session) return
        const store = await loadLocalCrmStore()
        const username = String(req.params.username || '').trim()
        const idx = store.users.findIndex((u) => String(u?.username || '').toLowerCase() === username.toLowerCase())
        if (idx < 0) return res.status(404).json({ success: false, error: 'NOT_FOUND', code: 'NOT_FOUND' })
        const body = req.body && typeof req.body === 'object' ? req.body : {}
        const cur = store.users[idx]
        const next = {
            ...cur,
            email: body.email !== undefined ? (String(body.email || '').trim() || null) : cur.email,
            displayName: body.displayName !== undefined ? String(body.displayName || '').trim() : cur.displayName,
            role: body.role !== undefined ? normalizeRole(body.role) : cur.role,
            allowedUnits: body.allowedUnits !== undefined ? (Array.isArray(body.allowedUnits) ? body.allowedUnits.map((x) => String(x)).filter(Boolean) : []) : cur.allowedUnits,
            allowedModules: body.allowedModules !== undefined ? (Array.isArray(body.allowedModules) ? body.allowedModules.map((x) => String(x)).filter(Boolean) : []) : cur.allowedModules,
            ativo: body.ativo !== undefined ? Boolean(body.ativo) : cur.ativo,
            note: body.note !== undefined ? (typeof body.note === 'string' ? body.note : null) : cur.note,
            updatedBy: session?.user?.username || session?.user?.email || 'dev',
            updatedAt: new Date().toISOString(),
        }
        store.users[idx] = next
        await saveLocalCrmStore(store)
        res.status(200).set('cache-control', 'no-store').json({ success: true, data: next })
    })
    app.post('/api/crm/admin/users/:username/reset-password', async (req, res) => {
        const session = requireDevAdmin(req, res)
        if (!session) return
        const store = await loadLocalCrmStore()
        const username = String(req.params.username || '').trim()
        const idx = store.users.findIndex((u) => String(u?.username || '').toLowerCase() === username.toLowerCase())
        if (idx < 0) return res.status(404).json({ success: false, error: 'NOT_FOUND', code: 'NOT_FOUND' })
        const body = req.body && typeof req.body === 'object' ? req.body : {}
        const newPassword = typeof body.newPassword === 'string' ? body.newPassword : ''
        if (!newPassword) return res.status(400).json({ success: false, error: 'PASSWORD_REQUIRED', code: 'PASSWORD_REQUIRED' })
        store.users[idx] = { ...store.users[idx], password: newPassword, updatedBy: session?.user?.username || 'dev', updatedAt: new Date().toISOString() }
        await saveLocalCrmStore(store)
        res.status(200).set('cache-control', 'no-store').json({ success: true })
    })

    app.get('/api/crm/admin/invites', async (_req, res) => {
        const store = await loadLocalCrmStore()
        res.status(200).set('cache-control', 'no-store').json({ success: true, data: store.invites })
    })
    app.post('/api/crm/admin/invites', async (req, res) => {
        const session = requireDevAdmin(req, res)
        if (!session) return
        const store = await loadLocalCrmStore()
        const body = req.body && typeof req.body === 'object' ? req.body : {}
        const token = randomBytes(18).toString('hex')
        const tokenHint = token.slice(0, 4) + '…' + token.slice(-4)
        const maxUses = Math.max(1, Math.min(50, Number.parseInt(String(body.maxUses || '1'), 10) || 1))
        const expiresInDays = Math.max(1, Math.min(365, Number.parseInt(String(body.expiresInDays || body.expiresIn || '30'), 10) || 30))
        const expiresAt = new Date(Date.now() + expiresInDays * 24 * 60 * 60 * 1000).toISOString()
        const invite = {
            id: randomBytes(8).toString('hex'),
            tokenHint,
            role: normalizeRole(body.role || 'INJETOR'),
            allowedUnits: Array.isArray(body.allowedUnits) ? body.allowedUnits.map((x) => String(x)).filter(Boolean) : [],
            allowedModules: Array.isArray(body.allowedModules) ? body.allowedModules.map((x) => String(x)).filter(Boolean) : [],
            maxUses,
            usesCount: 0,
            expiresAt,
            revoked: false,
            note: typeof body.note === 'string' ? body.note : null,
            createdBy: session?.user?.username || session?.user?.email || 'dev',
            createdAt: new Date().toISOString(),
        }
        store.invites.unshift(invite)
        await saveLocalCrmStore(store)
        res.status(200).set('cache-control', 'no-store').json({ success: true, data: invite, token })
    })

    app.all(/^\/api\/crm\/.+/, (_req, res) => {
        res.status(503).set('cache-control', 'no-store').json({
            ok: false,
            success: false,
            error: 'LOCAL_CRM_STUB',
            hint: 'Em modo local (NO_AUTH=true), apenas /api/crm/admin/* está disponível.'
        })
    })
} else {
    // In production this is a Pages Function. Locally, allow proxying for convenience.
    app.use('/api/crm', blockUpstreamMutationsIfNeeded(INSUMOS_API_TARGET))
    app.use('/api/crm', createProxyMiddleware({
        target: INSUMOS_API_TARGET,
        changeOrigin: true,
        ws: false,
        logLevel: 'silent',
        pathRewrite: { '^/api/crm': '' }
    }))
}

// -------------------------------------------------------------
// Local stubs for Pages-only APIs (social/instagram/share)
// Keeps the SPA stable in local mode without requiring wrangler pages dev.
// -------------------------------------------------------------
const LOCAL_STUB_PAGES_APIS =
    (String(process.env.NODE_ENV || '').toLowerCase() === 'development') ||
    NO_AUTH_ENABLED

if (LOCAL_STUB_PAGES_APIS) {
    // Instagram integration (Pages Functions in prod).
    app.get('/api/instagram/status', (_req, res) => {
        res.status(200).set('cache-control', 'no-store').json({ ok: true, connected: false, localStub: true })
    })
    app.get('/api/instagram/metrics', (_req, res) => {
        res.status(200).set('cache-control', 'no-store').json({ ok: true, connected: false, metrics: null, localStub: true })
    })
    app.get('/api/instagram/media', (_req, res) => {
        res.status(200).set('cache-control', 'no-store').json({ ok: true, data: [], localStub: true })
    })
    app.get('/api/instagram/stories', (_req, res) => {
        res.status(200).set('cache-control', 'no-store').json({ ok: true, data: [], localStub: true })
    })
    app.get('/api/instagram/comments', (_req, res) => {
        res.status(200).set('cache-control', 'no-store').json({ ok: true, data: [], localStub: true })
    })
    app.all(/^\/api\/instagram\/.+/, (_req, res) => {
        res.status(503).set('cache-control', 'no-store').json({
            ok: false,
            error: 'LOCAL_PAGES_REQUIRED',
            hint: 'Este endpoint é Pages Function em produção. Para testar localmente, use o modo Pages (wrangler pages dev).'
        })
    })

    // Social Studio (Pages Functions in prod).
    app.get('/api/social/setup/status', (_req, res) => {
        res.status(200).set('cache-control', 'no-store').json({
            ok: true,
            localStub: true,
            r2: { bucketConfigured: false, effectiveKeyPrefix: null },
            encryption: { required: false, configured: false },
            admin: { isAdmin: true, role: 'LOCAL' },
            socialDefaults: { defaultUnitsFromEnv: [] }
        })
    })
    app.all(/^\/api\/social\/.+/, (_req, res) => {
        res.status(503).set('cache-control', 'no-store').json({
            ok: false,
            error: 'LOCAL_PAGES_REQUIRED',
            hint: 'Social Studio roda via Pages Functions (R2/Queues). Para testar localmente, use o modo Pages (wrangler pages dev).'
        })
    })

    // Share upload (Pages Function in prod).
    app.post('/api/share/upload', (_req, res) => {
        res.status(503).set('cache-control', 'no-store').json({
            success: false,
            error: 'LOCAL_PAGES_REQUIRED',
            hint: 'Upload usa R2 em Pages Functions. Para testar localmente, use o modo Pages (wrangler pages dev).'
        })
    })
}

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
    express.static(CRM_UI_DIR, {
        index: false,
        setHeaders(res, filePath) {
            const normalized = String(filePath || '').replaceAll('\\', '/')
            if (normalized.endsWith('/index.html')) {
                res.setHeader('Cache-Control', 'no-store')
                return
            }
            if (normalized.includes('/assets/')) {
                res.setHeader('Cache-Control', 'public, max-age=31536000, immutable')
            }
        }
    })(req, res, next)
})

// -------------------------------------------------------------
// Basic Auth (optional) - set CRM_BASIC_AUTH="user:pass" to enable
// Supports EventSource via query param ?auth=BASE64(user:pass)
// -------------------------------------------------------------
const BASIC_AUTH = process.env.CRM_BASIC_AUTH || ''
const LOCAL_NO_AUTH_ENABLED = isTruthyEnv(process.env.CRM_LOCAL_NO_AUTH)
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

    // Allow local dev without auth (default enabled)
    const host = String(req.hostname || '').toLowerCase()
    const isLocalHost = host === 'localhost' || host === '127.0.0.1'
    if (isLocalHost && LOCAL_NO_AUTH_ENABLED) return next()

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
    } catch (e) {
        console.warn('[UNIT_MONITOR] Load failed', e?.message || String(e))
    }
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
await waMessageMetaStore.init()
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

// Optional at-rest encryption for unit_monitor.json (recommended for gateway deployments).
// If not set, state is stored as plain JSON.
const UNIT_MONITOR_STATE_KEY = String(process.env.CRM_UNIT_MONITOR_STATE_KEY || process.env.CRM_UNIT_MONITOR_PROXY_TOKEN || '').trim()

function deriveAes256Key(secret) {
    return createHash('sha256').update(String(secret || ''), 'utf8').digest()
}

function encryptUnitMonitorStateJson(secret, plaintext) {
    const key = deriveAes256Key(secret)
    const iv = randomBytes(12) // AES-GCM recommended nonce size
    const cipher = createCipheriv('aes-256-gcm', key, iv)
    const ct = Buffer.concat([cipher.update(String(plaintext || ''), 'utf8'), cipher.final()])
    const tag = cipher.getAuthTag()
    return {
        v: 1,
        enc: 'aes-256-gcm',
        iv: iv.toString('base64url'),
        tag: tag.toString('base64url'),
        data: ct.toString('base64url'),
    }
}

function decryptUnitMonitorStateJson(secret, payload) {
    const key = deriveAes256Key(secret)
    const iv = Buffer.from(String(payload?.iv || ''), 'base64url')
    const tag = Buffer.from(String(payload?.tag || ''), 'base64url')
    const data = Buffer.from(String(payload?.data || ''), 'base64url')
    const decipher = createDecipheriv('aes-256-gcm', key, iv)
    decipher.setAuthTag(tag)
    const pt = Buffer.concat([decipher.update(data), decipher.final()])
    return pt.toString('utf8')
}

// Unit Monitor streaming (RTSP -> HLS) via MediaMTX (mediamtx)
const MEDIAMTX_BIN = process.env.CRM_UNIT_MONITOR_MEDIAMTX_BIN || 'mediamtx'
const MEDIAMTX_CONFIG_FILE = process.env.CRM_UNIT_MONITOR_MEDIAMTX_CONFIG ||
    path.join(CORE_STATE_DIR, 'unit_monitor_mediamtx.yml')
const MEDIAMTX_LOG_FILE = process.env.CRM_UNIT_MONITOR_MEDIAMTX_LOG ||
    path.join(VAR_DIR, 'logs', 'crm', 'unit_monitor_mediamtx.out')
const MEDIAMTX_HLS_TARGET = process.env.CRM_UNIT_MONITOR_MEDIAMTX_HLS_TARGET || 'http://127.0.0.1:8888'
const MEDIAMTX_WEBRTC_TARGET = process.env.CRM_UNIT_MONITOR_MEDIAMTX_WEBRTC_TARGET || 'http://127.0.0.1:8889'
const MEDIAMTX_HLS_SEGMENT_DURATION = process.env.CRM_UNIT_MONITOR_HLS_SEGMENT_DURATION || '1s'
const MEDIAMTX_HLS_SEGMENT_COUNT = Math.max(2, Math.min(20, Number(process.env.CRM_UNIT_MONITOR_HLS_SEGMENT_COUNT || 3) || 3))
const MEDIAMTX_HLS_VARIANT = process.env.CRM_UNIT_MONITOR_HLS_VARIANT || 'fmp4'
const MEDIAMTX_SOURCE_ON_DEMAND_START_TIMEOUT = process.env.CRM_UNIT_MONITOR_SOURCE_ON_DEMAND_START_TIMEOUT || '30s'
const MEDIAMTX_SOURCE_ON_DEMAND_CLOSE_AFTER = process.env.CRM_UNIT_MONITOR_SOURCE_ON_DEMAND_CLOSE_AFTER || '5m'
const MEDIAMTX_WEBRTC_ADDITIONAL_HOSTS = String(process.env.CRM_UNIT_MONITOR_WEBRTC_ADDITIONAL_HOSTS || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
const MEDIAMTX_PID_FILE = process.env.CRM_UNIT_MONITOR_MEDIAMTX_PID_FILE ||
    path.join(CORE_STATE_DIR, 'unit_monitor_mediamtx.pid')

// Unit Monitor server-side recording (RTSP -> segmented MP4) via ffmpeg
const UNIT_MONITOR_RECORDINGS_DIR = process.env.CRM_UNIT_MONITOR_RECORDINGS_DIR ||
    path.join(VAR_DIR, 'recordings', 'unit-monitor')
const FFMPEG_BIN = process.env.CRM_UNIT_MONITOR_FFMPEG_BIN || process.env.FFMPEG_BIN || 'ffmpeg'
const FFPROBE_BIN = process.env.CRM_UNIT_MONITOR_FFPROBE_BIN || process.env.FFPROBE_BIN || 'ffprobe'
const UNIT_MONITOR_MIN_FREE_GB = Math.max(0, Math.min(10_000, Number(process.env.CRM_UNIT_MONITOR_MIN_FREE_GB || 20) || 20))
const UNIT_MONITOR_MIN_FREE_BYTES = Math.floor(UNIT_MONITOR_MIN_FREE_GB * 1024 * 1024 * 1024)
const UNIT_MONITOR_MAX_RECORDERS = Math.max(0, Math.min(10_000, Number(process.env.CRM_UNIT_MONITOR_MAX_RECORDERS || 16) || 16))

const UNIT_MONITOR_ICE_SERVERS = (() => {
    try {
        const raw = String(process.env.CRM_UNIT_MONITOR_ICE_SERVERS_JSON || '').trim()
        if (!raw) return []
        const data = JSON.parse(raw)
        const arr = Array.isArray(data) ? data : (Array.isArray(data?.iceServers) ? data.iceServers : [])
        return arr
            .map((s) => {
                if (!s || typeof s !== 'object') return null
                const urls = s.urls
                if (typeof urls === 'string' && urls.trim()) return { ...s, urls: urls.trim() }
                if (Array.isArray(urls) && urls.filter(Boolean).length) return { ...s, urls: urls.filter(Boolean) }
                return null
            })
            .filter(Boolean)
    } catch {
        return []
    }
})()

function redactRtspSecrets(text) {
    const s = String(text || '')
    return s.replace(/rtsp:\/\/([^:/?#\s]+):([^@/\s]+)@/g, 'rtsp://$1:***@')
}

function maskRtspUrl(rtspUrl) {
    const u = String(rtspUrl || '').trim()
    if (!u) return u
    try {
        const parsed = new URL(u)
        if (parsed.password) parsed.password = '***'
        return parsed.toString()
    } catch {
        return redactRtspSecrets(u)
    }
}

async function spawnCapture(bin, args, { timeoutMs = 15000, maxStdoutBytes = 256_000, maxStderrBytes = 256_000 } = {}) {
    return await new Promise((resolve) => {
        let stdout = ''
        let stderr = ''
        let timedOut = false

        const proc = spawn(bin, args, { stdio: ['ignore', 'pipe', 'pipe'] })
        const killTimer = setTimeout(() => {
            timedOut = true
            try { proc.kill('SIGKILL') } catch { /* ignore */ }
        }, timeoutMs)

        proc.stdout.on('data', (chunk) => {
            if (stdout.length >= maxStdoutBytes) return
            stdout += chunk.toString('utf-8')
            if (stdout.length > maxStdoutBytes) stdout = stdout.slice(0, maxStdoutBytes)
        })
        proc.stderr.on('data', (chunk) => {
            if (stderr.length >= maxStderrBytes) return
            stderr += chunk.toString('utf-8')
            if (stderr.length > maxStderrBytes) stderr = stderr.slice(0, maxStderrBytes)
        })

        proc.on('close', (code, signal) => {
            clearTimeout(killTimer)
            resolve({ code, signal, stdout, stderr, timedOut })
        })
    })
}

async function readFileTail(filePath, maxBytes = 64 * 1024) {
    try {
        const st = await fs.stat(filePath)
        if (!st.isFile()) return null
        const start = Math.max(0, st.size - maxBytes)
        const fh = await fs.open(filePath, 'r')
        try {
            const buf = Buffer.alloc(st.size - start)
            await fh.read(buf, 0, buf.length, start)
            return buf.toString('utf-8')
        } finally {
            await fh.close().catch(() => { })
        }
    } catch {
        return null
    }
}

async function dfInfo(targetPath) {
    try {
        const { code, stdout } = await spawnCapture('df', ['-k', targetPath], { timeoutMs: 3000 })
        if (code !== 0) return null
        const lines = String(stdout || '').trim().split('\n')
        if (lines.length < 2) return { raw: stdout }
        const cols = lines[lines.length - 1].trim().split(/\s+/)
        // df output: Filesystem 1024-blocks Used Available Capacity iused ifree %iused Mounted on
        return {
            raw: stdout,
            availableKb: Number(cols[3]) || null,
            usedKb: Number(cols[2]) || null,
            totalKb: Number(cols[1]) || null,
            capacity: cols[4] || null,
            mount: cols[cols.length - 1] || null
        }
    } catch {
        return null
    }
}

let mediamtxProc = null
let mediamtxProcFds = { out: null, err: null }
let mediamtxRuntime = { running: false, pid: null, startedAt: null, lastError: null, configPath: MEDIAMTX_CONFIG_FILE }

let unitMonitorRecorders = new Map() // key -> { proc, pid, unit, cameraId, rtspUrl, outDir, logFile, startedAt, segmentSeconds, lastError }

function normalizeUnitKey(value) {
    const v = String(value || '').trim()
    if (!v) return ''
    return v.toLowerCase()
}

function safeKey(value) {
    return String(value || '')
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9_-]+/g, '_')
        .replace(/^_+|_+$/g, '')
        .slice(0, 80)
}

function yamlQuote(value) {
    const s = String(value ?? '')
    const escaped = s.replace(/\\/g, '\\\\').replace(/"/g, '\\"')
    return `"${escaped}"`
}

function buildRtspUrlFromParts({ host, port, username, password, streamPath }) {
    const h = String(host || '').trim()
    if (!h) return ''
    const p = Number(port || 554) || 554

    let sp = String(streamPath || '').trim()
    if (!sp) sp = 'stream1'
    if (!sp.startsWith('/')) sp = '/' + sp

    const u = String(username || '').trim()
    const pw = String(password || '').trim()
    const auth = u && pw ? `${encodeURIComponent(u)}:${encodeURIComponent(pw)}@` : ''
    return `rtsp://${auth}${h}:${p}${sp}`
}

function listUnitMonitorCameras() {
    const units = unitMonitorState.units && typeof unitMonitorState.units === 'object' ? unitMonitorState.units : {}
    const out = []
    for (const [unitKey, entry] of Object.entries(units)) {
        const unit = normalizeUnitKey(unitKey)
        const config = entry?.config && typeof entry.config === 'object' ? entry.config : {}
        const cameras = Array.isArray(config.cameras) ? config.cameras : []
        for (const cam of cameras) {
            const host = String(cam?.host || cam?.ip || '').trim()
            const port = Number(cam?.port || 554) || 554
            const username = String(cam?.username || '').trim()
            const password = String(cam?.password || '').trim()
            const streamPath = String(cam?.streamPath || cam?.path || cam?.stream || '').trim()

            let id = String(cam?.id || '').trim()
            if (!id && host) {
                const sp = streamPath || 'stream1'
                id = `cam_${safeKey(host)}_${safeKey(sp)}`
            }
            const name = String(cam?.name || '').trim()
            const rtspUrl = String(cam?.rtspUrl || '').trim() ||
                buildRtspUrlFromParts({ host, port, username, password, streamPath })
            const enabled = cam?.enabled !== false
            if (!unit || !id || !rtspUrl) continue
            out.push({ unit, id, name: name || id, rtspUrl, enabled })
        }
    }
    return out
}

function findUnitMonitorCamera(unit, cameraId) {
    const u = normalizeUnitKey(unit)
    const id = String(cameraId || '').trim()
    if (!u || !id) return null
    return listUnitMonitorCameras().find(c => c.unit === u && c.id === id) || null
}

function cameraToMediamtxPath(camera) {
    const u = safeKey(camera.unit || 'unit')
    const c = safeKey(camera.id || 'cam')
    return `u_${u}__c_${c}`
}

function getUnitMonitorRtspRecordingConfig(unit) {
    const u = normalizeUnitKey(unit)
    const entry = u ? (unitMonitorState.units || {})[u] : null
    const config = entry?.config && typeof entry.config === 'object' ? entry.config : {}
    const rec = config?.rtspRecording && typeof config.rtspRecording === 'object' ? config.rtspRecording : {}

    const segmentSeconds = Math.max(5, Math.min(60 * 60, Number(rec.segmentSeconds || 60) || 60))
    const retentionDays = Math.max(0, Math.min(3650, Number(rec.retentionDays || 7) || 7))
    return { segmentSeconds, retentionDays }
}

async function writeMediamtxConfig() {
    await fs.mkdir(path.dirname(MEDIAMTX_LOG_FILE), { recursive: true }).catch(() => { })
    const cameras = listUnitMonitorCameras().filter(c => c.enabled)
    if (cameras.length === 0) {
        const err = new Error('No enabled cameras configured')
        err.code = 'NO_CAMERAS'
        throw err
    }

    // Prefer broad compatibility over ultra-low latency (LL-HLS requires HTTPS).
    const lines = []
    lines.push('logLevel: info')
    lines.push('logDestinations: [stdout]')
    // We only need HLS output; disable servers we don't need to avoid port conflicts.
    lines.push('rtsp: no')
    lines.push('rtmp: no')
    lines.push('srt: no')
    lines.push('hls: yes')
    lines.push('hlsAddress: 127.0.0.1:8888')
    lines.push('hlsEncryption: no')
    lines.push("hlsAllowOrigins: ['*']")
    lines.push(`hlsVariant: ${yamlQuote(MEDIAMTX_HLS_VARIANT)}`)
    lines.push(`hlsSegmentCount: ${MEDIAMTX_HLS_SEGMENT_COUNT}`)
    lines.push(`hlsSegmentDuration: ${MEDIAMTX_HLS_SEGMENT_DURATION}`)
    lines.push('webrtc: yes')
    lines.push('webrtcAddress: 127.0.0.1:8889')
    lines.push('webrtcEncryption: no')
    lines.push("webrtcAllowOrigins: ['*']")
    if (MEDIAMTX_WEBRTC_ADDITIONAL_HOSTS.length) {
        lines.push(`webrtcAdditionalHosts: [${MEDIAMTX_WEBRTC_ADDITIONAL_HOSTS.map(yamlQuote).join(', ')}]`)
    }
    lines.push('paths:')
    for (const cam of cameras) {
        const p = cameraToMediamtxPath(cam)
        lines.push(`  ${p}:`)
        lines.push(`    source: ${yamlQuote(cam.rtspUrl)}`)
        lines.push('    rtspTransport: tcp')
        lines.push('    sourceOnDemand: yes')
        lines.push(`    sourceOnDemandStartTimeout: ${MEDIAMTX_SOURCE_ON_DEMAND_START_TIMEOUT}`)
        lines.push(`    sourceOnDemandCloseAfter: ${MEDIAMTX_SOURCE_ON_DEMAND_CLOSE_AFTER}`)
    }
    const config = lines.join('\n') + '\n'
    await fs.writeFile(MEDIAMTX_CONFIG_FILE, config)
    return { cameras, configPath: MEDIAMTX_CONFIG_FILE }
}

async function isPidRunning(pid) {
    const p = Number(pid || 0)
    if (!p) return false
    try {
        process.kill(p, 0)
        return true
    } catch {
        return false
    }
}

async function readMediamtxPidFile() {
    try {
        const raw = await fs.readFile(MEDIAMTX_PID_FILE, 'utf-8')
        const pid = Number(String(raw || '').trim())
        return Number.isFinite(pid) ? pid : null
    } catch {
        return null
    }
}

async function findMediamtxPidsFromProcessList() {
    // Best-effort: find any mediamtx process started with our config file.
    // This fixes the "backend restarted, child still running" scenario.
    try {
        const out = await new Promise((resolve) => {
            const chunks = []
            const p = spawn('ps', ['-axo', 'pid=,command='], { stdio: ['ignore', 'pipe', 'ignore'] })
            p.stdout.on('data', (d) => chunks.push(d))
            p.on('close', () => resolve(Buffer.concat(chunks).toString('utf-8')))
            p.on('error', () => resolve(''))
        })
        const pids = []
        for (const line of String(out || '').split('\n')) {
            const m = line.trim().match(/^(\d+)\s+(.*)$/)
            if (!m) continue
            const pid = Number(m[1])
            const cmd = m[2] || ''
            if (!pid || !cmd) continue
            if (!cmd.includes('mediamtx')) continue
            if (!cmd.includes(MEDIAMTX_CONFIG_FILE)) continue
            pids.push(pid)
        }
        return pids
    } catch {
        return []
    }
}

async function listMediamtxCandidatePids() {
    const candidates = new Set()
    const pidFromFile = await readMediamtxPidFile()
    if (pidFromFile) candidates.add(pidFromFile)
    for (const pid of await findMediamtxPidsFromProcessList()) candidates.add(pid)
    return Array.from(candidates).filter(Boolean)
}

async function writeMediamtxPidFile(pid) {
    try { await fs.writeFile(MEDIAMTX_PID_FILE, String(pid)) } catch { /* ignore */ }
}

async function clearMediamtxPidFile() {
    try { await fs.unlink(MEDIAMTX_PID_FILE) } catch { /* ignore */ }
}

async function waitForExit(proc, timeoutMs = 4000) {
    if (!proc) return { exited: true, code: null, signal: null }
    return await new Promise((resolve) => {
        let done = false
        const t = setTimeout(() => {
            if (done) return
            done = true
            resolve({ exited: false, code: null, signal: null })
        }, timeoutMs)
        proc.once('exit', (code, signal) => {
            if (done) return
            done = true
            clearTimeout(t)
            resolve({ exited: true, code, signal })
        })
    })
}

async function stopMediamtx() {
    const proc = mediamtxProc

    // If server restarted, we may have lost the child handle: try PID file.
    if (!proc) {
        const candidates = await listMediamtxCandidatePids()
        let stoppedAny = false
        for (const pid of candidates) {
            if (!await isPidRunning(pid)) continue
            stoppedAny = true
            try { process.kill(pid, 'SIGINT') } catch { /* ignore */ }
            for (let i = 0; i < 12; i++) {
                if (!await isPidRunning(pid)) break
                await new Promise(r => setTimeout(r, 250))
            }
            if (await isPidRunning(pid)) {
                try { process.kill(pid, 'SIGKILL') } catch { /* ignore */ }
            }
        }
        await clearMediamtxPidFile()
        mediamtxRuntime.running = false
        mediamtxRuntime.pid = null
        return { ok: true, stopped: stoppedAny, pids: candidates }
    }

    if (!proc) {
        mediamtxRuntime.running = false
        mediamtxRuntime.pid = null
        return { ok: true, stopped: false }
    }

    try { proc.kill('SIGINT') } catch { /* ignore */ }
    const res = await waitForExit(proc, 4000)
    if (!res.exited) {
        try { proc.kill('SIGKILL') } catch { /* ignore */ }
        await waitForExit(proc, 2000)
    }

    mediamtxProc = null
    mediamtxRuntime.running = false
    mediamtxRuntime.pid = null
    await clearMediamtxPidFile()

    if (mediamtxProcFds.out) { try { fsSync.closeSync(mediamtxProcFds.out) } catch { /* ignore */ } }
    if (mediamtxProcFds.err) { try { fsSync.closeSync(mediamtxProcFds.err) } catch { /* ignore */ } }
    mediamtxProcFds = { out: null, err: null }
    return { ok: true, stopped: true, forced: !res.exited }
}

async function startMediamtx() {
    await stopMediamtx()
    // Guard: ensure no leftover process is still holding ports.
    const leftovers = []
    for (const pid of await listMediamtxCandidatePids()) {
        if (await isPidRunning(pid)) leftovers.push(pid)
    }
    if (leftovers.length > 0) {
        const err = new Error(`MediaMTX still running (pids: ${leftovers.join(', ')})`)
        err.code = 'MEDIAMTX_STILL_RUNNING'
        throw err
    }
    const { cameras, configPath } = await writeMediamtxConfig()
    mediamtxRuntime.lastError = null
    mediamtxRuntime.configPath = configPath

    mediamtxProcFds.out = fsSync.openSync(MEDIAMTX_LOG_FILE, 'a')
    mediamtxProcFds.err = fsSync.openSync(MEDIAMTX_LOG_FILE, 'a')
    mediamtxProc = spawn(MEDIAMTX_BIN, [configPath], {
        stdio: ['ignore', mediamtxProcFds.out, mediamtxProcFds.err],
        env: process.env
    })
    mediamtxRuntime.running = true
    mediamtxRuntime.pid = mediamtxProc.pid
    mediamtxRuntime.startedAt = new Date().toISOString()
    await writeMediamtxPidFile(mediamtxRuntime.pid)

    mediamtxProc.on('exit', (code, signal) => {
        mediamtxRuntime.running = false
        mediamtxRuntime.pid = null
        mediamtxRuntime.lastError = code ? `Exited with code ${code}` : (signal ? `Exited with signal ${signal}` : null)
        mediamtxProc = null
        clearMediamtxPidFile().catch(() => { })
        if (mediamtxProcFds.out) { try { fsSync.closeSync(mediamtxProcFds.out) } catch { /* ignore */ } }
        if (mediamtxProcFds.err) { try { fsSync.closeSync(mediamtxProcFds.err) } catch { /* ignore */ } }
        mediamtxProcFds = { out: null, err: null }
    })

    return { ok: true, started: true, camerasEnabled: cameras.length, pid: mediamtxRuntime.pid }
}

function unitMonitorRecorderKey(unit, cameraId) {
    return `${normalizeUnitKey(unit)}:${String(cameraId || '').trim()}`
}

async function startUnitMonitorRecorder({ unit, cameraId, segmentSeconds }) {
    const u = normalizeUnitKey(unit)
    const id = String(cameraId || '').trim()
    if (!u || !id) {
        const err = new Error('Missing unit or cameraId')
        err.code = 'BAD_REQUEST'
        throw err
    }

    if (UNIT_MONITOR_MAX_RECORDERS > 0 && unitMonitorRecorders.size >= UNIT_MONITOR_MAX_RECORDERS) {
        const err = new Error(`Max recorders reached (${UNIT_MONITOR_MAX_RECORDERS})`)
        err.code = 'LIMIT_REACHED'
        throw err
    }

    const key = unitMonitorRecorderKey(u, id)
    if (unitMonitorRecorders.has(key)) {
        const err = new Error('Recorder already running')
        err.code = 'ALREADY_RUNNING'
        throw err
    }

    const cam = findUnitMonitorCamera(u, id)
    if (!cam) {
        const err = new Error('Camera not found in config')
        err.code = 'CAM_NOT_FOUND'
        throw err
    }

    const cfg = getUnitMonitorRtspRecordingConfig(u)
    const seg = Math.max(5, Math.min(60 * 60, Number(segmentSeconds || cfg.segmentSeconds) || cfg.segmentSeconds))

    const outDir = path.join(UNIT_MONITOR_RECORDINGS_DIR, safeKey(u), safeKey(id))
    await fs.mkdir(outDir, { recursive: true }).catch(() => { })

    const logDir = path.dirname(MEDIAMTX_LOG_FILE)
    await fs.mkdir(logDir, { recursive: true }).catch(() => { })
    const logFile = path.join(logDir, `unit_monitor_ffmpeg_${safeKey(u)}_${safeKey(id)}.out`)
    const fd = fsSync.openSync(logFile, 'a')

    const outputTemplate = path.join(outDir, '%Y%m%d_%H%M%S.mp4')
    const args = [
        '-hide_banner',
        '-loglevel', 'error',
        '-fflags', '+genpts',
        '-rtsp_transport', 'tcp',
        '-i', cam.rtspUrl,
        '-c', 'copy',
        '-f', 'segment',
        '-segment_time', String(seg),
        '-reset_timestamps', '1',
        '-strftime', '1',
        outputTemplate
    ]

    const proc = spawn(FFMPEG_BIN, args, { stdio: ['ignore', fd, fd], env: process.env })
    const startedAt = new Date().toISOString()
    const entry = {
        proc,
        pid: proc.pid,
        unit: u,
        cameraId: id,
        rtspUrl: cam.rtspUrl,
        outDir,
        logFile,
        startedAt,
        segmentSeconds: seg,
        lastError: null
    }
    unitMonitorRecorders.set(key, entry)

    proc.on('exit', (code, signal) => {
        const current = unitMonitorRecorders.get(key)
        if (current) {
            current.lastError = code ? `Exited with code ${code}` : (signal ? `Exited with signal ${signal}` : null)
        }
        unitMonitorRecorders.delete(key)
        try { fsSync.closeSync(fd) } catch { /* ignore */ }
    })

    return { ok: true, started: true, key, pid: proc.pid, startedAt, segmentSeconds: seg, outDir, logFile }
}

async function stopUnitMonitorRecorder({ unit, cameraId }) {
    const u = normalizeUnitKey(unit)
    const id = String(cameraId || '').trim()
    if (!u || !id) return { ok: true, stopped: false }
    const key = unitMonitorRecorderKey(u, id)
    const entry = unitMonitorRecorders.get(key)
    if (!entry) return { ok: true, stopped: false }
    try { entry.proc.kill('SIGINT') } catch { /* ignore */ }
    unitMonitorRecorders.delete(key)
    return { ok: true, stopped: true }
}

async function listUnitMonitorRecordingSegments({ unit, cameraId, limit = 500 }) {
    const u = normalizeUnitKey(unit)
    const id = String(cameraId || '').trim()
    if (!u || !id) return []
    const outDir = path.join(UNIT_MONITOR_RECORDINGS_DIR, safeKey(u), safeKey(id))
    let files = []
    try {
        files = await fs.readdir(outDir)
    } catch {
        return []
    }
    const mp4s = files.filter(f => f.endsWith('.mp4'))
    const entries = []
    for (const filename of mp4s) {
        const absPath = path.join(outDir, filename)
        try {
            const st = await fs.stat(absPath)
            if (!st.isFile()) continue
            const relPath = path.relative(UNIT_MONITOR_RECORDINGS_DIR, absPath)
            const fileId = encodeURIComponent(relPath)
            entries.push({
                unit: u,
                cameraId: id,
                filename,
                sizeBytes: st.size,
                createdAt: st.mtime.toISOString(),
                playbackUrl: `/api/unit-monitor/rtsp/recordings/file?file=${fileId}`,
                downloadUrl: `/api/unit-monitor/rtsp/recordings/file?file=${fileId}&download=1`
            })
        } catch { /* ignore */ }
    }
    entries.sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))
    return entries.slice(0, Math.max(1, Math.min(5000, Number(limit) || 500)))
}

async function cleanupUnitMonitorSegments() {
    const units = unitMonitorState.units && typeof unitMonitorState.units === 'object' ? unitMonitorState.units : {}
    const now = Date.now()
    for (const [unitKey, entry] of Object.entries(units)) {
        const unit = normalizeUnitKey(unitKey)
        if (!unit) continue
        const cfg = getUnitMonitorRtspRecordingConfig(unit)
        if (!cfg.retentionDays || cfg.retentionDays <= 0) continue
        const cutoffMs = now - cfg.retentionDays * 24 * 60 * 60 * 1000

        const config = entry?.config && typeof entry.config === 'object' ? entry.config : {}
        const cameras = Array.isArray(config.cameras) ? config.cameras : []
        for (const cam of cameras) {
            const id = String(cam?.id || '').trim()
            if (!id) continue
            const outDir = path.join(UNIT_MONITOR_RECORDINGS_DIR, safeKey(unit), safeKey(id))
            let files = []
            try { files = await fs.readdir(outDir) } catch { continue }
            for (const filename of files) {
                if (!filename.endsWith('.mp4')) continue
                const absPath = path.join(outDir, filename)
                try {
                    const st = await fs.stat(absPath)
                    if (!st.isFile()) continue
                    if (st.mtimeMs < cutoffMs) {
                        await fs.unlink(absPath).catch(() => { })
                    }
                } catch { /* ignore */ }
            }
        }
    }

    // Disk-pressure cleanup: if free space is below the configured threshold,
    // delete the oldest segments across all units/cameras until we recover space.
    try {
        if (!UNIT_MONITOR_MIN_FREE_BYTES || UNIT_MONITOR_MIN_FREE_BYTES <= 0) return
        const disk = await dfInfo(UNIT_MONITOR_RECORDINGS_DIR)
        const availBytes = disk?.availableKb ? Number(disk.availableKb) * 1024 : null
        if (!availBytes || availBytes >= UNIT_MONITOR_MIN_FREE_BYTES) return

        const candidates = []
        const unitsDirs = await fs.readdir(UNIT_MONITOR_RECORDINGS_DIR).catch(() => [])
        for (const unitDir of unitsDirs) {
            const unitPath = path.join(UNIT_MONITOR_RECORDINGS_DIR, unitDir)
            let cams = []
            try {
                const st = await fs.stat(unitPath)
                if (!st.isDirectory()) continue
                cams = await fs.readdir(unitPath)
            } catch {
                continue
            }
            for (const camDir of cams) {
                const camPath = path.join(unitPath, camDir)
                let files = []
                try {
                    const st = await fs.stat(camPath)
                    if (!st.isDirectory()) continue
                    files = await fs.readdir(camPath)
                } catch {
                    continue
                }
                for (const filename of files) {
                    if (!filename.endsWith('.mp4')) continue
                    const absPath = path.join(camPath, filename)
                    try {
                        const st = await fs.stat(absPath)
                        if (!st.isFile()) continue
                        candidates.push({ absPath, mtimeMs: st.mtimeMs, sizeBytes: st.size })
                    } catch { /* ignore */ }
                }
            }
        }

        candidates.sort((a, b) => a.mtimeMs - b.mtimeMs)
        let freed = 0
        let deleted = 0
        for (const c of candidates) {
            if (deleted >= 500) break
            try {
                await fs.unlink(c.absPath)
                freed += Number(c.sizeBytes || 0) || 0
                deleted += 1
            } catch { /* ignore */ }

            const nextAvail = availBytes + freed
            if (nextAvail >= UNIT_MONITOR_MIN_FREE_BYTES) break
        }
    } catch {
        // ignore
    }
}

setInterval(() => { cleanupUnitMonitorSegments().catch(() => { }) }, 60 * 60 * 1000).unref()

async function loadUnitMonitorState() {
    try {
        const raw = await fs.readFile(UNIT_MONITOR_FILE, 'utf-8')
        const outer = JSON.parse(raw)
        if (!outer || typeof outer !== 'object') return

        let json = outer
        if (outer.enc === 'aes-256-gcm') {
            if (!UNIT_MONITOR_STATE_KEY) {
                throw new Error('unit_monitor.json is encrypted but CRM_UNIT_MONITOR_STATE_KEY is not set')
            }
            const plaintext = decryptUnitMonitorStateJson(UNIT_MONITOR_STATE_KEY, outer)
            json = JSON.parse(plaintext)
        }

        if (json && typeof json === 'object') {
            const units = json.units && typeof json.units === 'object' ? json.units : {}
            const recordings = Array.isArray(json.recordings) ? json.recordings : []
            unitMonitorState = { units, recordings }
        }
    } catch { /* ignore */ }
}

async function persistUnitMonitorNow() {
    try {
        const plaintext = JSON.stringify(unitMonitorState, null, 2)
        if (UNIT_MONITOR_STATE_KEY) {
            const enc = encryptUnitMonitorStateJson(UNIT_MONITOR_STATE_KEY, plaintext)
            await fs.writeFile(UNIT_MONITOR_FILE, JSON.stringify(enc, null, 2))
        } else {
            await fs.writeFile(UNIT_MONITOR_FILE, plaintext)
        }
    } catch (e) {
        console.error('[UNIT_MONITOR] Persist failed', e)
    }
}

function schedulePersistUnitMonitor() {
    if (saveUnitMonitorTimer) clearTimeout(saveUnitMonitorTimer)
    saveUnitMonitorTimer = setTimeout(() => { persistUnitMonitorNow() }, 500).unref()
}

await loadUnitMonitorState()

function parseCsv(value) {
    return String(value || '')
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean)
}

function b64UrlToUtf8(b64url) {
    const s = String(b64url || '').trim()
    if (!s) return ''
    const padded = s.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(s.length / 4) * 4, '=')
    return Buffer.from(padded, 'base64').toString('utf-8')
}

function timingSafeEqualStr(a, b) {
    const aa = Buffer.from(String(a || ''), 'utf-8')
    const bb = Buffer.from(String(b || ''), 'utf-8')
    if (aa.length !== bb.length) return false
    return timingSafeEqual(aa, bb)
}

// Shared secret used by the Pages proxy to authenticate to the gateway.
const UNIT_MONITOR_PROXY_TOKEN = String(process.env.CRM_UNIT_MONITOR_PROXY_TOKEN || '').trim()

// Optional actor signing key. If not set, default to the proxy token (one-secret setup).
const UNIT_MONITOR_ACTOR_HMAC_KEY = String(process.env.CRM_UNIT_MONITOR_ACTOR_HMAC_KEY || UNIT_MONITOR_PROXY_TOKEN).trim()
const UNIT_MONITOR_ALLOWED_EMAILS = new Set(parseCsv(process.env.CRM_UNIT_MONITOR_ALLOWED_EMAILS).map((s) => s.toLowerCase()))
const UNIT_MONITOR_ALLOWED_DOMAINS = new Set(parseCsv(process.env.CRM_UNIT_MONITOR_ALLOWED_DOMAINS).map((s) => s.toLowerCase()))
const UNIT_MONITOR_ACTOR_SKEW_MS = Math.max(5_000, Math.min(60 * 60 * 1000, Number(process.env.CRM_UNIT_MONITOR_ACTOR_SKEW_MS || 5 * 60 * 1000) || 5 * 60 * 1000))
const UNIT_MONITOR_RATE_LIMIT_PER_MIN = Math.max(0, Math.min(100_000, Number(process.env.CRM_UNIT_MONITOR_RATE_LIMIT_PER_MIN || 120) || 120))
const unitMonitorRate = new Map() // key -> number[] timestamps (ms)

function allowUnitMonitorActor(actor) {
    if (UNIT_MONITOR_ALLOWED_EMAILS.size === 0 && UNIT_MONITOR_ALLOWED_DOMAINS.size === 0) return true
    const email = String(actor?.email || '').trim().toLowerCase()
    const domain = email.includes('@') ? (email.split('@').pop() || '') : ''
    if (email && UNIT_MONITOR_ALLOWED_EMAILS.has(email)) return true
    if (domain && UNIT_MONITOR_ALLOWED_DOMAINS.has(domain)) return true
    return false
}

function verifyUnitMonitorActor(req) {
    const actorB64 = String(req.headers['x-skincos-actor'] || '').trim()
    const tsRaw = String(req.headers['x-skincos-actor-ts'] || '').trim()
    const sig = String(req.headers['x-skincos-actor-sig'] || '').trim()

    if (!actorB64 || !tsRaw) return { ok: false, code: 'ACTOR_MISSING' }

    const ts = Number(tsRaw)
    if (!Number.isFinite(ts) || ts <= 0) return { ok: false, code: 'ACTOR_TS_INVALID' }
    if (Math.abs(Date.now() - ts) > UNIT_MONITOR_ACTOR_SKEW_MS) return { ok: false, code: 'ACTOR_TS_SKEW' }

    const actorJson = b64UrlToUtf8(actorB64)
    let actor = null
    try { actor = JSON.parse(actorJson) } catch { actor = null }
    if (!actor || typeof actor !== 'object') return { ok: false, code: 'ACTOR_INVALID' }

    // Signature is optional outside gateway mode, but required when a key is configured or in gateway mode.
    const sigRequired = IS_GATEWAY_MODE || !!UNIT_MONITOR_ACTOR_HMAC_KEY
    if (sigRequired) {
        if (!UNIT_MONITOR_ACTOR_HMAC_KEY) return { ok: false, code: 'ACTOR_KEY_MISSING' }
        if (!sig) return { ok: false, code: 'ACTOR_SIG_MISSING' }
        const expected = createHmac('sha256', UNIT_MONITOR_ACTOR_HMAC_KEY).update(`${tsRaw}.${actorB64}`).digest('base64url')
        if (!timingSafeEqualStr(sig, expected)) return { ok: false, code: 'ACTOR_SIG_INVALID' }
    }

    if (!allowUnitMonitorActor(actor)) return { ok: false, code: 'ACTOR_FORBIDDEN' }

    return { ok: true, actor }
}

function unitMonitorActorLabel(req) {
    const a = req?.skincosActor || null
    const email = a?.email ? String(a.email) : ''
    const id = a?.id ? String(a.id) : ''
    return email || id || 'unknown'
}

function logUnitMonitor(req, event, data = {}) {
    const rid = String(req?.requestId || '').trim() || 'no-request-id'
    const actor = unitMonitorActorLabel(req)
    try {
        console.log('[UNIT_MONITOR]', event, JSON.stringify({ requestId: rid, actor, ...(data || {}) }))
    } catch {
        console.log('[UNIT_MONITOR]', event, `{requestId:${rid}, actor:${actor}}`)
    }
}

function unitMonitorRateLimitKey(req) {
    const actorB64 = String(req.headers['x-skincos-actor'] || '').trim()
    if (!actorB64) return 'unknown'
    const actorJson = b64UrlToUtf8(actorB64)
    try {
        const a = JSON.parse(actorJson)
        return String(a?.id || a?.email || 'unknown')
    } catch {
        return 'unknown'
    }
}

function isSensitiveUnitMonitorRoute(req) {
    const method = String(req.method || '').toUpperCase()
    const p = String(req.path || '')
    if (method === 'PUT' && p === '/api/unit-monitor/state') return true
    if (method === 'POST' && p.startsWith('/api/unit-monitor/streaming/')) return true
    if (method === 'POST' && p === '/api/unit-monitor/rtsp/test') return true
    if (method === 'POST' && p.startsWith('/api/unit-monitor/rtsp/recorders/')) return true
    return false
}

// Diagnostic helper used by the CRM UI.
// In production, the Pages proxy intercepts this endpoint and returns proxy-level config.
// In local/dev (direct-to-backend), expose backend-level readiness flags.
app.get('/api/unit-monitor/_proxy-status', (_req, res) => {
    res.status(200).set('cache-control', 'no-store').json({
        ok: true,
        localDirect: true,
        gatewayMode: !!IS_GATEWAY_MODE,
        proxyTokenConfigured: !!UNIT_MONITOR_PROXY_TOKEN,
        actorKeyConfigured: !!UNIT_MONITOR_ACTOR_HMAC_KEY,
        allowedEmailsConfigured: UNIT_MONITOR_ALLOWED_EMAILS.size > 0,
        allowedDomainsConfigured: UNIT_MONITOR_ALLOWED_DOMAINS.size > 0,
        rateLimitPerMin: UNIT_MONITOR_RATE_LIMIT_PER_MIN || 0,
    })
})

// Optional hardening for public "gateway" deployments behind a simple shared secret.
// In gateway mode, the token is REQUIRED.
app.use('/api/unit-monitor', (req, res, next) => {
    const required = IS_GATEWAY_MODE || !!UNIT_MONITOR_PROXY_TOKEN
    if (!required) return next()
    if (!UNIT_MONITOR_PROXY_TOKEN) {
        return res.status(503).json({
            ok: false,
            error: 'GATEWAY_MISCONFIGURED',
            hint: 'Set CRM_UNIT_MONITOR_PROXY_TOKEN (shared secret) on the gateway.',
        })
    }
    const token = String(req.headers['x-unit-monitor-proxy-token'] || '')
    if (token && token === UNIT_MONITOR_PROXY_TOKEN) return next()
    return res.status(401).json({ ok: false, error: 'Unauthorized' })
})

// Actor identity + rate limiting (primarily for gateway mode).
app.use('/api/unit-monitor', (req, res, next) => {
    const hardeningEnabled =
        IS_GATEWAY_MODE ||
        !!UNIT_MONITOR_ACTOR_HMAC_KEY ||
        UNIT_MONITOR_ALLOWED_EMAILS.size > 0 ||
        UNIT_MONITOR_ALLOWED_DOMAINS.size > 0 ||
        UNIT_MONITOR_RATE_LIMIT_PER_MIN > 0

    if (!hardeningEnabled) return next()

    const verified = verifyUnitMonitorActor(req)
    if (!verified.ok) {
        return res.status(401).json({
            ok: false,
            error: 'UNAUTHORIZED',
            code: verified.code,
            hint: 'Missing/invalid actor headers. Requests must come from the CRM Pages proxy.',
        })
    }
    req.skincosActor = verified.actor

    if (UNIT_MONITOR_RATE_LIMIT_PER_MIN > 0 && isSensitiveUnitMonitorRoute(req)) {
        const key = unitMonitorRateLimitKey(req)
        const now = Date.now()
        const windowMs = 60 * 1000
        const list = unitMonitorRate.get(key) || []
        const pruned = list.filter((t) => now - t < windowMs)
        pruned.push(now)
        unitMonitorRate.set(key, pruned)
        if (pruned.length > UNIT_MONITOR_RATE_LIMIT_PER_MIN) {
            return res.status(429).json({ ok: false, error: 'RATE_LIMITED', hint: 'Too many requests. Try again soon.' })
        }
    }

    return next()
})

app.get('/api/unit-monitor/health', async (req, res) => {
    res.json({ ok: true, ts: new Date().toISOString() })
})

app.get('/api/unit-monitor/gateway/info', async (req, res) => {
    const bins = { ffmpeg: FFMPEG_BIN, ffprobe: FFPROBE_BIN, mediamtx: MEDIAMTX_BIN }
    const getVer = (cmd, args) => {
        try {
            const r = spawnSync(cmd, args, { encoding: 'utf-8' })
            const out = String(r.stdout || r.stderr || '').trim()
            return out.split('\n')[0]?.slice(0, 200) || null
        } catch {
            return null
        }
    }
    const ips = (() => {
        try {
            const nets = os.networkInterfaces()
            const out = []
            for (const name of Object.keys(nets || {})) {
                for (const n of nets[name] || []) {
                    if (!n || n.internal) continue
                    if (n.family === 'IPv4' || n.family === 4) out.push(String(n.address))
                }
            }
            return Array.from(new Set(out)).slice(0, 10)
        } catch {
            return []
        }
    })()
    res.json({
        ok: true,
        ts: new Date().toISOString(),
        uptimeSec: Math.floor(process.uptime()),
        gateway: {
            enabled: String(process.env.SKINCOS_GATEWAY || '') === '1',
            startedAt: process.env.SKINCOS_GATEWAY_STARTED_AT || null,
            version: process.env.SKINCOS_GATEWAY_VERSION || null
        },
        node: process.version,
        platform: { os: process.platform, arch: process.arch },
        pid: process.pid,
        ports: { crmApiPort: Number(process.env.CRM_API_PORT || process.env.PORT || 8099) || 8099 },
        host: {
            hostname: os.hostname(),
            ips
        },
        resources: {
            loadavg: os.loadavg ? os.loadavg() : null,
            memTotalBytes: os.totalmem(),
            memFreeBytes: os.freemem(),
            memRssBytes: process.memoryUsage().rss
        },
        auth: { proxyTokenRequired: !!UNIT_MONITOR_PROXY_TOKEN },
        bins: {
            ...bins,
            ffmpegVersion: getVer(FFMPEG_BIN, ['-version']),
            ffprobeVersion: getVer(FFPROBE_BIN, ['-version']),
            mediamtxVersion: getVer(MEDIAMTX_BIN, ['-version']),
        },
    })
})

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
    logUnitMonitor(req, 'state_saved', { unit })
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

// HLS proxy (same-origin for CRM UI)
app.use('/api/unit-monitor/hls', createProxyMiddleware({
    target: MEDIAMTX_HLS_TARGET,
    changeOrigin: true,
    ws: false,
    logLevel: 'silent',
    pathRewrite: { '^/api/unit-monitor/hls': '' },
    on: {
        proxyRes: (proxyRes, req, res) => {
            try {
                const u = String(req?.url || '')
                if (u.endsWith('.m3u8') || u.endsWith('.ts') || u.endsWith('.mp4')) {
                    const cc = 'no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0'
                    proxyRes.headers['cache-control'] = cc
                    res.setHeader('Cache-Control', cc)
                    res.setHeader('Pragma', 'no-cache')
                    res.setHeader('Expires', '0')
                }
            } catch { /* ignore */ }
        }
    }
}))

// WebRTC (WHEP) proxy (same-origin for CRM UI)
app.use('/api/unit-monitor/webrtc', createProxyMiddleware({
    target: MEDIAMTX_WEBRTC_TARGET,
    changeOrigin: true,
    ws: false,
    logLevel: 'silent',
    pathRewrite: { '^/api/unit-monitor/webrtc': '' }
}))

app.get('/api/unit-monitor/streaming/status', async (req, res) => {
    const cameras = listUnitMonitorCameras().filter(c => c.enabled)
    const streams = cameras.map((c) => {
        const pathKey = cameraToMediamtxPath(c)
        const hlsUrlDirect = `${MEDIAMTX_HLS_TARGET.replace(/\/$/, '')}/${pathKey}/index.m3u8`
        const hlsUrlProxy = `/api/unit-monitor/hls/${pathKey}/index.m3u8`
        const webrtcUrlDirect = `${MEDIAMTX_WEBRTC_TARGET.replace(/\/$/, '')}/${pathKey}/whep`
        const webrtcUrlProxy = `/api/unit-monitor/webrtc/${pathKey}/whep`
        return {
            unit: c.unit,
            cameraId: c.id,
            name: c.name,
            pathKey,
            hlsUrlDirect,
            hlsUrlProxy,
            webrtcUrlDirect,
            webrtcUrlProxy
        }
    })
    res.json({
        ok: true,
        running: !!mediamtxRuntime.running,
        pid: mediamtxRuntime.pid,
        startedAt: mediamtxRuntime.startedAt,
        lastError: mediamtxRuntime.lastError,
        configPath: mediamtxRuntime.configPath,
        hlsTarget: MEDIAMTX_HLS_TARGET,
        hlsProxyBase: '/api/unit-monitor/hls',
        webrtcTarget: MEDIAMTX_WEBRTC_TARGET,
        webrtcProxyBase: '/api/unit-monitor/webrtc',
        iceServers: UNIT_MONITOR_ICE_SERVERS,
        streams
    })
})

app.get('/api/unit-monitor/diagnostics', async (req, res) => {
    const mediamtxPidFromFile = await readMediamtxPidFile()
    const mediamtxPidRunning = mediamtxPidFromFile ? await isPidRunning(mediamtxPidFromFile) : false
    const mediamtxTailRaw = await readFileTail(MEDIAMTX_LOG_FILE, 96 * 1024)
    const mediamtxTail = mediamtxTailRaw ? redactRtspSecrets(mediamtxTailRaw) : mediamtxTailRaw
    const disk = await dfInfo(UNIT_MONITOR_RECORDINGS_DIR)

    const recorders = Array.from(unitMonitorRecorders.values()).map(r => ({
        unit: r.unit,
        cameraId: r.cameraId,
        pid: r.pid,
        startedAt: r.startedAt,
        segmentSeconds: r.segmentSeconds,
        outDir: r.outDir,
        logFile: r.logFile,
        lastError: r.lastError
    }))

    res.json({
        ok: true,
        ts: new Date().toISOString(),
        recordingsDir: UNIT_MONITOR_RECORDINGS_DIR,
        minFreeGb: UNIT_MONITOR_MIN_FREE_GB,
        disk,
        mediamtx: {
            runtime: mediamtxRuntime,
            pidFromFile: mediamtxPidFromFile,
            pidRunning: mediamtxPidRunning,
            logFile: MEDIAMTX_LOG_FILE,
            logTail: mediamtxTail
        },
        recorders
    })
})

app.post('/api/unit-monitor/rtsp/test', async (req, res) => {
    try {
        const body = req.body && typeof req.body === 'object' ? req.body : {}
        const inputRtspUrl = String(body.rtspUrl || '').trim()
        const rtspUrl = inputRtspUrl || buildRtspUrlFromParts({
            host: body.host || body.ip,
            port: body.port,
            username: body.username,
            password: body.password,
            streamPath: body.streamPath
        })

        if (!rtspUrl || !rtspUrl.startsWith('rtsp://')) {
            return res.status(400).json({ ok: false, error: 'rtspUrl inválida', maskedUrl: maskRtspUrl(rtspUrl) })
        }

        const timeoutMs = Math.max(5000, Math.min(30000, Number(body.timeoutMs || 15000) || 15000))
        const timeoutUs = String(Math.floor(timeoutMs * 1000))

        const args = [
            '-v', 'error',
            '-rtsp_transport', 'tcp',
            // ffprobe builds vary; prefer widely supported timeout flags.
            // -rw_timeout: IO timeout (microseconds)
            // -timeout: socket I/O timeout (microseconds)
            '-rw_timeout', timeoutUs,
            '-timeout', timeoutUs,
            '-print_format', 'json',
            '-show_format',
            '-show_streams',
            rtspUrl
        ]

        logUnitMonitor(req, 'rtsp_test', { maskedUrl: maskRtspUrl(rtspUrl), timeoutMs })
        const { code, signal, stdout, stderr, timedOut } = await spawnCapture(FFPROBE_BIN, args, { timeoutMs: timeoutMs + 2000 })
        if (timedOut) {
            return res.status(408).json({ ok: false, error: 'Timeout ao testar RTSP', maskedUrl: maskRtspUrl(rtspUrl) })
        }
        if (code !== 0) {
            const err = redactRtspSecrets(stderr || '') || `ffprobe failed (code=${code}${signal ? `, signal=${signal}` : ''})`
            return res.status(400).json({ ok: false, error: err.trim().slice(0, 5000), maskedUrl: maskRtspUrl(rtspUrl) })
        }

        let parsed = null
        try { parsed = JSON.parse(stdout) } catch { /* ignore */ }
        const streams = Array.isArray(parsed?.streams) ? parsed.streams : []

        const video = streams.find(s => s?.codec_type === 'video') || null
        const audio = streams.find(s => s?.codec_type === 'audio') || null
        const fpsRaw = String(video?.avg_frame_rate || video?.r_frame_rate || '')
        const fps = (() => {
            const m = fpsRaw.match(/^(\d+)\s*\/\s*(\d+)$/)
            if (!m) return null
            const a = Number(m[1])
            const b = Number(m[2])
            if (!a || !b) return null
            return Math.round((a / b) * 100) / 100
        })()

        res.json({
            ok: true,
            maskedUrl: maskRtspUrl(rtspUrl),
            video: video ? { codec: video.codec_name || null, width: video.width || null, height: video.height || null, fps } : null,
            audio: audio ? { codec: audio.codec_name || null, sampleRate: audio.sample_rate ? Number(audio.sample_rate) : null, channels: audio.channels || null } : null,
            format: parsed?.format || null
        })
    } catch (e) {
        res.status(500).json({ ok: false, error: e?.message || String(e) })
    }
})

app.post('/api/unit-monitor/streaming/start', async (req, res) => {
    try {
        logUnitMonitor(req, 'streaming_start')
        const result = await startMediamtx()
        res.json({ ok: true, ...result })
    } catch (e) {
        mediamtxRuntime.running = false
        mediamtxRuntime.pid = null
        mediamtxRuntime.lastError = e?.message || String(e)
        res.status(500).json({ ok: false, error: mediamtxRuntime.lastError })
    }
})

app.post('/api/unit-monitor/streaming/stop', async (req, res) => {
    logUnitMonitor(req, 'streaming_stop')
    const result = await stopMediamtx()
    res.json({ ok: true, ...result })
})

// RTSP recordings (server-side)
app.get('/api/unit-monitor/rtsp/recorders', async (req, res) => {
    const recorders = Array.from(unitMonitorRecorders.values()).map(r => ({
        unit: r.unit,
        cameraId: r.cameraId,
        pid: r.pid,
        startedAt: r.startedAt,
        segmentSeconds: r.segmentSeconds,
        outDir: r.outDir,
        logFile: r.logFile,
        lastError: r.lastError
    }))
    res.json({ ok: true, count: recorders.length, recorders })
})

app.post('/api/unit-monitor/rtsp/recorders/start', async (req, res) => {
    try {
        const unit = normalizeUnitKey(req.body?.unit || '')
        const cameraId = String(req.body?.cameraId || '').trim()
        const segmentSeconds = Number(req.body?.segmentSeconds || 0) || undefined
        logUnitMonitor(req, 'recorder_start', { unit, cameraId, segmentSeconds: segmentSeconds || null })
        const result = await startUnitMonitorRecorder({ unit, cameraId, segmentSeconds })
        res.json({ ok: true, ...result })
    } catch (e) {
        res.status(400).json({ ok: false, error: e?.message || String(e), code: e?.code || null })
    }
})

app.post('/api/unit-monitor/rtsp/recorders/stop', async (req, res) => {
    const unit = normalizeUnitKey(req.body?.unit || '')
    const cameraId = String(req.body?.cameraId || '').trim()
    logUnitMonitor(req, 'recorder_stop', { unit, cameraId })
    const result = await stopUnitMonitorRecorder({ unit, cameraId })
    res.json({ ok: true, ...result })
})

app.get('/api/unit-monitor/rtsp/recordings', async (req, res) => {
    const unit = normalizeUnitKey(req.query?.unit || '')
    const cameraId = String(req.query?.cameraId || '').trim()
    const limit = Number(req.query?.limit || 500) || 500
    const cfg = getUnitMonitorRtspRecordingConfig(unit)
    const segments = await listUnitMonitorRecordingSegments({ unit, cameraId, limit })
    res.json({ ok: true, unit, cameraId, config: cfg, segments })
})

app.get('/api/unit-monitor/rtsp/recordings/file', async (req, res) => {
    const file = String(req.query?.file || '')
    if (!file) return res.status(400).json({ ok: false, error: 'Missing file' })
    let rel = file
    try { rel = decodeURIComponent(file) } catch { /* ignore */ }
    if (rel.includes('\0')) return res.status(400).json({ ok: false, error: 'Invalid file' })
    const absPath = path.resolve(UNIT_MONITOR_RECORDINGS_DIR, rel)
    const base = path.resolve(UNIT_MONITOR_RECORDINGS_DIR)
    if (!absPath.startsWith(base + path.sep)) {
        return res.status(400).json({ ok: false, error: 'Invalid file path' })
    }
    try {
        const st = await fs.stat(absPath)
        if (!st.isFile()) return res.status(404).json({ ok: false, error: 'Not found' })
    } catch {
        return res.status(404).json({ ok: false, error: 'Not found' })
    }
    if (String(req.query?.download || '') === '1') {
        res.setHeader('Content-Disposition', `attachment; filename="${path.basename(absPath)}"`)
    }
    res.setHeader('Content-Type', 'video/mp4')
    res.sendFile(absPath)
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
            addMessage(conversationId, { direction: 'system', type: 'event', text: 'Injetor assumiu a conversa.' })
            break
        case 'release-control':
            conv.humanInControl = false
            result = { message: 'human released control' }
            addMessage(conversationId, { direction: 'system', type: 'event', text: 'Injetor liberou a conversa para IA.' })
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

const WA_ORCHESTRATOR_PROVIDER = String(process.env.WA_ORCHESTRATOR_PROVIDER || '').toLowerCase()
const USE_EVOLUTION_ORCHESTRATOR = WA_ORCHESTRATOR_PROVIDER === 'evolution'
const DEBUG_QR = String(process.env.WA_DEBUG_QR || '').toLowerCase() === 'true'
const WA_BOOTSTRAP_SYNC_FILE = process.env.WA_BOOTSTRAP_SYNC_FILE || path.join(CORE_STATE_DIR, 'wa_bootstrap_sync.v1.json')
const WA_CONTACT_DIRECTORY_FILE = process.env.WA_CONTACT_DIRECTORY_FILE || path.join(CORE_STATE_DIR, 'wa_contact_directory.v1.json')
const WA_CHANNEL_OWNERS_FILE = process.env.WA_CHANNEL_OWNERS_FILE || path.join(CORE_STATE_DIR, 'wa_channel_owners.v1.json')
const WA_CHANNEL_OWNER_ENFORCED = String(process.env.WA_CHANNEL_OWNER_ENFORCED || 'true').trim().toLowerCase() !== 'false'
let waBootstrapSyncState = { channels: {} }
let waContactDirectory = { channels: {} }
let waChannelOwnersState = { channels: {} }
let waBootstrapPersistTimer = null
let waContactDirectoryPersistTimer = null
let waChannelOwnersPersistTimer = null
const waBootstrapSyncTasks = new Map()

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
const CRM_UNIFIED_API_KEY = process.env.CRM_UNIFIED_API_KEY

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
const waEventClients = new Set()
const waWebhookMetrics = {
    total: 0,
    unauthorized: 0,
    errors: 0,
    lastAt: null,
    lastUnauthorizedAt: null,
    lastErrorAt: null
}
const waWebhookFailures = {
    count: 0,
    windowStart: 0,
    lastAlertAt: 0
}
const WA_WEBHOOK_FAILURE_WINDOW_MS = 30000
const WA_WEBHOOK_FAILURE_THRESHOLD = 5
const WA_WEBHOOK_ALERT_COOLDOWN_MS = 60000

function resolveCrmPublicUrl(req) {
    const envUrl = String(process.env.CRM_PUBLIC_URL || '').trim()
    if (envUrl) return envUrl.replace(/\/$/, '')
    const host = req.get('host')
    const proto = req.get('x-forwarded-proto') || req.protocol || 'http'
    return `${proto}://${host}`
}

function shouldAuthorizeWebhook(req) {
    const token = String(process.env.WA_ORCHESTRATOR_WEBHOOK_TOKEN || '').trim()
    if (!token) return true
    const header = String(req.get('x-webhook-token') || '')
    return header === token
}

function resolveWebhookHeaders() {
    const headers = {}
    const token = String(process.env.WA_ORCHESTRATOR_WEBHOOK_TOKEN || '').trim()
    if (token) {
        headers['x-webhook-token'] = token
    }
    const basic = String(process.env.CRM_BASIC_AUTH || '').trim()
    if (basic && basic.includes(':')) {
        headers['Authorization'] = `Basic ${Buffer.from(basic).toString('base64')}`
    }
    return headers
}

function resolveMessageActor(req) {
    const session = typeof devAuthSessionResolver === 'function' ? devAuthSessionResolver(req) : null
    if (req?.waActor?.key) return String(req.waActor.key)
    const user = req?.crmUser || session?.user || {}
    const email = String(user?.email || req.get('x-user-email') || '').trim().toLowerCase()
    const username = String(user?.username || req.get('x-user-name') || '').trim().toLowerCase()
    const role = String(user?.role || req.get('x-user-role') || '').trim().toLowerCase()
    if (email) return `email:${email}`
    if (username) return `user:${username}`
    if (role) return `role:${role}`
    return `ip:${String(req.ip || 'unknown')}`
}

function buildWaMediaProxyUrl(req, { channel, remoteJid, messageId }) {
    const params = new URLSearchParams({
        channel: String(channel),
        remoteJid: String(remoteJid || ''),
        messageId: String(messageId || '')
    })
    return `/api/wa-orchestrator/media?${params.toString()}`
}

function mediaBufferLooksDecoded(buffer, mimeType) {
    if (!Buffer.isBuffer(buffer) || !buffer.length) return false
    const mime = String(mimeType || '').toLowerCase()
    const startsWith = (...bytes) => bytes.every((value, index) => buffer[index] === value)
    const asciiAt = (offset, value) => buffer.subarray(offset, offset + value.length).toString('ascii') === value

    if (mime.includes('image/webp')) {
        return asciiAt(0, 'RIFF') && asciiAt(8, 'WEBP')
    }
    if (mime.includes('image/jpeg') || mime.includes('image/jpg')) {
        return startsWith(0xff, 0xd8, 0xff)
    }
    if (mime.includes('image/png')) {
        return startsWith(0x89, 0x50, 0x4e, 0x47)
    }
    if (mime.includes('image/gif')) {
        return asciiAt(0, 'GIF8')
    }
    if (mime.includes('audio/ogg')) {
        return asciiAt(0, 'OggS')
    }
    if (mime.includes('audio/mpeg') || mime.includes('audio/mp3')) {
        return asciiAt(0, 'ID3') || startsWith(0xff, 0xfb) || startsWith(0xff, 0xf3) || startsWith(0xff, 0xf2)
    }
    if (mime.includes('video/mp4') || mime.includes('audio/mp4')) {
        return asciiAt(4, 'ftyp')
    }
    if (mime.includes('application/pdf')) {
        return asciiAt(0, '%PDF')
    }
    return true
}

function recordWebhookSuccess() {
    waWebhookMetrics.total += 1
    waWebhookMetrics.lastAt = new Date().toISOString()
    if (waWebhookFailures.count > 0) {
        waWebhookFailures.count = 0
        waWebhookFailures.windowStart = 0
    }
}

function recordWebhookFailure(kind, req, error) {
    const now = Date.now()
    if (!waWebhookFailures.windowStart || now - waWebhookFailures.windowStart > WA_WEBHOOK_FAILURE_WINDOW_MS) {
        waWebhookFailures.windowStart = now
        waWebhookFailures.count = 0
    }
    waWebhookFailures.count += 1

    if (kind === 'unauthorized') {
        waWebhookMetrics.unauthorized += 1
        waWebhookMetrics.lastUnauthorizedAt = new Date().toISOString()
    } else {
        waWebhookMetrics.errors += 1
        waWebhookMetrics.lastErrorAt = new Date().toISOString()
    }

    const shouldAlert = waWebhookFailures.count >= WA_WEBHOOK_FAILURE_THRESHOLD
        && now - waWebhookFailures.lastAlertAt > WA_WEBHOOK_ALERT_COOLDOWN_MS

    if (shouldAlert) {
        waWebhookFailures.lastAlertAt = now
        console.error('[WA_ORCHESTRATOR] Webhook failures threshold reached', {
            alert: true,
            failures: waWebhookFailures.count,
            windowMs: WA_WEBHOOK_FAILURE_WINDOW_MS,
            kind,
            ip: req.ip,
            ua: req.get('user-agent'),
            error: error?.message
        })
    }
}

function resolveWaEventChannel(payload) {
    const rawChannel = Number.parseInt(String(payload?.channel ?? payload?.data?.channel ?? ''), 10)
    if (Number.isInteger(rawChannel) && rawChannel >= 1 && rawChannel <= 9) return rawChannel
    const parsed = parseEvolutionChannelFromInstanceName(payload?.instance || payload?.data?.instance)
    if (Number.isInteger(parsed) && parsed >= 1 && parsed <= 9) return parsed
    return null
}

function broadcastWaEvent(payload) {
    const data = `data: ${JSON.stringify(payload)}\n\n`
    const eventChannel = resolveWaEventChannel(payload)
    waEventClients.forEach((client) => {
        const target = client?.res || client
        const actorKey = String(client?.actorKey || '').trim()
        if (!target) {
            waEventClients.delete(client)
            return
        }
        if (eventChannel && WA_CHANNEL_OWNER_ENFORCED) {
            const owner = getWaChannelOwner(eventChannel)
            if (owner?.ownerKey && owner.ownerKey !== actorKey) {
                return
            }
        }
        try {
            target.write(data)
        } catch {
            try { target.end() } catch { /* ignore */ }
            waEventClients.delete(client)
        }
    })
}
function extractEvolutionMessageText(message) {
    if (!message) return ''
    if (typeof message === 'string') return message
    if (message.conversation) return message.conversation
    if (message.text) return message.text
    if (message.extendedTextMessage?.text) return message.extendedTextMessage.text
    if (message.imageMessage?.caption) return message.imageMessage.caption
    if (message.videoMessage?.caption) return message.videoMessage.caption
    if (message.documentMessage?.caption) return message.documentMessage.caption
    if (message.reactionMessage?.text) return message.reactionMessage.text
    if (message.call) return '[Ligação]'
    if (message.audioMessage) return '[Áudio]'
    if (message.stickerMessage) return '[Sticker]'
    return '[Mensagem]'
}

function extractEvolutionMessageMeta(message) {
    if (!message) {
        return {
            text: '',
            caption: undefined,
            mediaType: undefined,
            mediaUrl: undefined,
            mimeType: undefined,
            fileName: undefined,
            durationSec: undefined,
            sizeBytes: undefined
        }
    }
    if (typeof message === 'string') {
        return {
            text: message,
            caption: undefined,
            mediaType: undefined,
            mediaUrl: undefined,
            mimeType: undefined,
            fileName: undefined,
            durationSec: undefined,
            sizeBytes: undefined
        }
    }
    const resolveMediaUrl = (msg) => {
        const candidate = (
            msg?.mediaUrl ||
            msg?.url ||
            msg?.imageMessage?.url ||
            msg?.videoMessage?.url ||
            msg?.documentMessage?.url ||
            msg?.audioMessage?.url ||
            msg?.ptvMessage?.url ||
            msg?.stickerMessage?.url
        )
        const directPath = (
            msg?.directPath ||
            msg?.imageMessage?.directPath ||
            msg?.videoMessage?.directPath ||
            msg?.documentMessage?.directPath ||
            msg?.audioMessage?.directPath ||
            msg?.ptvMessage?.directPath ||
            msg?.stickerMessage?.directPath
        )
        const buildFromDirectPath = (value) => {
            const path = String(value || '').trim()
            if (!path) return undefined
            if (path.startsWith('http://') || path.startsWith('https://')) return path
            if (path.startsWith('/')) return `https://mmg.whatsapp.net${path}`
            return `https://mmg.whatsapp.net/${path}`
        }
        const rawCandidate = typeof candidate === 'string' ? candidate.trim() : ''
        const directUrl = buildFromDirectPath(directPath)
        if (rawCandidate && !rawCandidate.startsWith('https://web.whatsapp.net')) return rawCandidate
        if (directUrl) return directUrl
        return rawCandidate || undefined
    }
    const resolveMimeType = (msg) => {
        const candidate = (
            msg?.mimetype ||
            msg?.mimeType ||
            msg?.imageMessage?.mimetype ||
            msg?.videoMessage?.mimetype ||
            msg?.documentMessage?.mimetype ||
            msg?.audioMessage?.mimetype ||
            msg?.ptvMessage?.mimetype ||
            msg?.stickerMessage?.mimetype
        )
        return typeof candidate === 'string' ? candidate : undefined
    }
    const resolveFileName = (msg) => {
        const candidate = (
            msg?.fileName ||
            msg?.documentMessage?.fileName ||
            msg?.documentWithCaptionMessage?.fileName ||
            msg?.imageMessage?.fileName ||
            msg?.videoMessage?.fileName
        )
        return typeof candidate === 'string' ? candidate : undefined
    }
    const resolveDuration = (msg) => {
        const candidate = (
            msg?.duration ||
            msg?.durationSec ||
            msg?.audioMessage?.seconds ||
            msg?.audioMessage?.duration ||
            msg?.videoMessage?.seconds ||
            msg?.ptvMessage?.seconds
        )
        const num = Number(candidate)
        return Number.isFinite(num) && num > 0 ? num : undefined
    }
    const resolveSizeBytes = (msg) => {
        const candidate = (
            msg?.fileLength ||
            msg?.sizeBytes ||
            msg?.documentMessage?.fileLength ||
            msg?.audioMessage?.fileLength ||
            msg?.videoMessage?.fileLength ||
            msg?.imageMessage?.fileLength
        )
        const num = Number(candidate)
        return Number.isFinite(num) && num > 0 ? num : undefined
    }
    const fileName = resolveFileName(message)
    const durationSec = resolveDuration(message)
    const sizeBytes = resolveSizeBytes(message)
    const mediaUrl = resolveMediaUrl(message)
    const mimeType = resolveMimeType(message)
    if (message.conversation || message.text || message.extendedTextMessage?.text) {
        return {
            text: extractEvolutionMessageText(message),
            caption: undefined,
            mediaType: undefined,
            mediaUrl,
            mimeType,
            fileName,
            durationSec,
            sizeBytes
        }
    }
    if (message.imageMessage) {
        return { text: '', caption: message.imageMessage.caption, mediaType: 'image', mediaUrl, mimeType, fileName, durationSec, sizeBytes }
    }
    if (message.videoMessage) {
        return { text: '', caption: message.videoMessage.caption, mediaType: 'video', mediaUrl, mimeType, fileName, durationSec, sizeBytes }
    }
    if (message.documentMessage || message.documentWithCaptionMessage) {
        return {
            text: '',
            caption: message.documentMessage?.caption || message.documentWithCaptionMessage?.caption,
            mediaType: 'document',
            mediaUrl,
            mimeType,
            fileName,
            durationSec,
            sizeBytes
        }
    }
    if (message.audioMessage) {
        return { text: '', caption: undefined, mediaType: 'audio', mediaUrl, mimeType, fileName, durationSec, sizeBytes }
    }
    if (message.call) {
        return { text: '', caption: undefined, mediaType: 'call', mediaUrl: undefined, mimeType: undefined, fileName: undefined, durationSec: undefined, sizeBytes: undefined }
    }
    if (message.reactionMessage) {
        return { text: message.reactionMessage.text || '', caption: undefined, mediaType: 'reaction', mediaUrl: undefined, mimeType: undefined, fileName: undefined, durationSec: undefined, sizeBytes: undefined }
    }
    if (message.stickerMessage) {
        return { text: '', caption: undefined, mediaType: 'sticker', mediaUrl, mimeType, fileName, durationSec, sizeBytes }
    }
    if (message.ptvMessage) {
        return { text: '', caption: undefined, mediaType: 'ptv', mediaUrl, mimeType, fileName, durationSec, sizeBytes }
    }
    return { text: extractEvolutionMessageText(message), caption: undefined, mediaType: undefined, mediaUrl, mimeType, fileName, durationSec, sizeBytes }
}

function extractEvolutionReplyMeta(record) {
    const message = record?.message || {}
    const quoted = (
        message?.extendedTextMessage?.contextInfo?.quotedMessage ||
        message?.imageMessage?.contextInfo?.quotedMessage ||
        message?.videoMessage?.contextInfo?.quotedMessage ||
        message?.documentMessage?.contextInfo?.quotedMessage ||
        message?.audioMessage?.contextInfo?.quotedMessage ||
        message?.conversation?.contextInfo?.quotedMessage ||
        null
    )
    const quotedId = (
        message?.extendedTextMessage?.contextInfo?.stanzaId ||
        message?.imageMessage?.contextInfo?.stanzaId ||
        message?.videoMessage?.contextInfo?.stanzaId ||
        message?.documentMessage?.contextInfo?.stanzaId ||
        message?.audioMessage?.contextInfo?.stanzaId ||
        null
    )
    if (!quotedId) return null
    const preview = extractEvolutionMessageText(quoted)
    if (!preview) return null
    return {
        messageId: String(quotedId),
        textPreview: preview.length > 240 ? `${preview.slice(0, 239)}…` : preview
    }
}

function extractEvolutionReactionMeta(record) {
    const reactionMessage = record?.message?.reactionMessage
    const targetKey = reactionMessage?.key
    const targetMessageId = String(targetKey?.id || '').trim()
    const emoji = String(reactionMessage?.text || '').trim()
    if (!targetMessageId || !emoji) return null

    const senderJidPrimaryRaw = record?.key?.participant || record?.participant || record?.sender?.jid || ''
    const senderJidAltRaw = record?.key?.participantAlt || record?.participantAlt || record?.sender?.participantAlt || record?.key?.remoteJidAlt || ''
    const senderJidRaw = senderJidAltRaw || senderJidPrimaryRaw || record?.key?.remoteJid || ''
    const senderJid = normalizeWhatsAppJid(senderJidRaw)
    const senderLid = String(senderJidPrimaryRaw || '').includes('@lid') ? String(senderJidPrimaryRaw).trim() : ''
    const senderPhone = extractPhoneFromJid(senderJidAltRaw || senderJid || senderJidPrimaryRaw)
    const senderName = String(record?.pushName || record?.senderName || record?.sender?.pushName || '').trim()
    const actorKey = senderJid || senderLid || senderPhone || senderName || String(record?.id || record?.key?.id || '').trim()
    return {
        targetMessageId,
        emoji,
        actorKey,
        reactedByMe: Boolean(record?.key?.fromMe)
    }
}

function extractEvolutionMentionJids(message) {
    if (!message || typeof message !== 'object') return []
    const contexts = [
        message?.extendedTextMessage?.contextInfo,
        message?.imageMessage?.contextInfo,
        message?.videoMessage?.contextInfo,
        message?.documentMessage?.contextInfo,
        message?.audioMessage?.contextInfo,
        message?.ptvMessage?.contextInfo,
        message?.conversation?.contextInfo,
        message?.messageContextInfo
    ]
    const mentions = new Set()
    contexts.forEach((context) => {
        if (!context) return
        const mentioned = Array.isArray(context?.mentionedJid) ? context.mentionedJid : []
        mentioned.forEach((jid) => {
            const normalized = normalizeWhatsAppJid(jid)
            if (normalized) mentions.add(normalized)
        })
    })
    return Array.from(mentions)
}

function extractEvolutionMessageIdFromSendResult(result) {
    return (
        result?.key?.id ||
        result?.id ||
        result?.message?.key?.id ||
        result?.response?.key?.id ||
        result?.data?.key?.id ||
        null
    )
}

function normalizePlatform(raw) {
    const value = String(raw || '').toLowerCase()
    if (!value) return 'whatsapp'
    if (value.includes('instagram')) return 'instagram'
    if (value.includes('facebook') || value.includes('messenger')) return 'facebook'
    if (value.includes('whatsapp')) return 'whatsapp'
    return value
}

function extractPhoneFromJid(remoteJid) {
    if (!remoteJid) return ''
    const value = String(remoteJid).trim()
    if (!value) return ''
    if (value.includes('@g.us') || value.includes('@broadcast')) {
        return value.includes('@') ? value.split('@')[0] : value
    }
    const localPart = value.includes('@') ? value.split('@')[0] : value
    return localPart.split(':')[0].replace(/\D/g, '')
}

function parseWhatsAppJidIdentity(value) {
    const raw = String(value || '').trim()
    if (!raw) {
        return { raw: '', normalized: '', domain: '', local: '', localNoDevice: '', kind: 'unknown' }
    }
    if (!raw.includes('@')) {
        const digits = raw.replace(/\D/g, '')
        const normalized = digits ? `${digits}@s.whatsapp.net` : `${raw}@s.whatsapp.net`
        return {
            raw,
            normalized,
            domain: 's.whatsapp.net',
            local: digits || raw,
            localNoDevice: digits || raw,
            kind: 'direct'
        }
    }

    const [localRaw, domainRaw = ''] = raw.split('@')
    const domain = String(domainRaw || '').trim().toLowerCase()
    const local = String(localRaw || '').trim()
    const localNoDevice = (domain === 'lid' || domain === 's.whatsapp.net') ? local.split(':')[0] : local
    const normalized = `${localNoDevice}@${domain}`
    const kind =
        domain === 'g.us' || domain === 'broadcast'
            ? 'group'
            : domain === 'lid'
                ? 'lid'
                : domain === 's.whatsapp.net'
                    ? 'direct'
                    : 'other'

    return { raw, normalized, domain, local, localNoDevice, kind }
}

function normalizeWhatsAppJid(value) {
    return parseWhatsAppJidIdentity(value).normalized
}

function buildConversationIdentity(value) {
    const parsed = parseWhatsAppJidIdentity(value)
    const rawJid = parsed.raw
    const normalizedJid = parsed.normalized
    const phone = extractPhoneFromJid(rawJid || normalizedJid)
    const aliases = new Set()
    if (rawJid) aliases.add(rawJid.toLowerCase())
    if (normalizedJid) aliases.add(normalizedJid.toLowerCase())
    if (phone) {
        aliases.add(phone)
        if (parsed.kind === 'direct') aliases.add(`${phone}@s.whatsapp.net`)
    }
    return {
        rawJid,
        normalizedJid,
        phone,
        kind: parsed.kind,
        aliases: Array.from(aliases)
    }
}

function resolveConversationMergeKey(conversationId, fallbackPhone) {
    const identity = buildConversationIdentity(conversationId || fallbackPhone)
    if (identity.kind === 'group') {
        if (identity.rawJid) return `jid:${identity.rawJid.toLowerCase()}`
        if (identity.normalizedJid) return `jid:${identity.normalizedJid.toLowerCase()}`
        return ''
    }
    if (identity.kind === 'direct' && identity.phone && identity.phone.length >= 10) return `phone:${identity.phone}`
    if (identity.rawJid) return `jid:${identity.rawJid.toLowerCase()}`
    if (identity.normalizedJid) return `jid:${identity.normalizedJid.toLowerCase()}`
    return ''
}

function resolveChatConversationJid(chat) {
    const candidates = [
        chat?.remoteJid,
        chat?.id,
        chat?.chatId,
        chat?.jid,
        chat?.lastMessage?.key?.remoteJid,
        chat?.lastMessage?.key?.participant,
        chat?.lastMessage?.participant
    ]
    for (const candidate of candidates) {
        const normalized = normalizeWhatsAppJid(candidate)
        if (normalized) return normalized
    }
    return ''
}

function resolveChatConversationAltJid(chat) {
    const candidates = [
        chat?.remoteJidAlt,
        chat?.lastMessage?.key?.remoteJidAlt,
        chat?.lastMessage?.remoteJidAlt
    ]
    for (const candidate of candidates) {
        const normalized = normalizeWhatsAppJid(candidate)
        if (normalized) return normalized
    }
    return ''
}

async function loadWaBootstrapSyncState() {
    try {
        const raw = await fs.readFile(WA_BOOTSTRAP_SYNC_FILE, 'utf-8')
        const parsed = JSON.parse(raw)
        if (parsed && typeof parsed === 'object' && parsed.channels && typeof parsed.channels === 'object') {
            waBootstrapSyncState = parsed
        }
    } catch { /* ignore */ }
}

async function persistWaBootstrapSyncStateNow() {
    try {
        await fs.writeFile(WA_BOOTSTRAP_SYNC_FILE, JSON.stringify(waBootstrapSyncState, null, 2))
    } catch (error) {
        console.error('[WA_BOOTSTRAP_SYNC] Persist failed', error?.message || String(error))
    }
}

function schedulePersistWaBootstrapSyncState() {
    if (waBootstrapPersistTimer) clearTimeout(waBootstrapPersistTimer)
    waBootstrapPersistTimer = setTimeout(() => { void persistWaBootstrapSyncStateNow() }, 600).unref?.()
}

async function loadWaContactDirectory() {
    try {
        const raw = await fs.readFile(WA_CONTACT_DIRECTORY_FILE, 'utf-8')
        const parsed = JSON.parse(raw)
        if (parsed && typeof parsed === 'object' && parsed.channels && typeof parsed.channels === 'object') {
            waContactDirectory = parsed
        }
    } catch { /* ignore */ }
}

async function persistWaContactDirectoryNow() {
    try {
        await fs.writeFile(WA_CONTACT_DIRECTORY_FILE, JSON.stringify(waContactDirectory, null, 2))
    } catch (error) {
        console.error('[WA_CONTACT_DIRECTORY] Persist failed', error?.message || String(error))
    }
}

function schedulePersistWaContactDirectory() {
    if (waContactDirectoryPersistTimer) clearTimeout(waContactDirectoryPersistTimer)
    waContactDirectoryPersistTimer = setTimeout(() => { void persistWaContactDirectoryNow() }, 1000).unref?.()
}

async function loadWaChannelOwnersState() {
    try {
        const raw = await fs.readFile(WA_CHANNEL_OWNERS_FILE, 'utf-8')
        const parsed = JSON.parse(raw)
        if (parsed && typeof parsed === 'object' && parsed.channels && typeof parsed.channels === 'object') {
            waChannelOwnersState = parsed
        }
    } catch { /* ignore */ }
}

async function persistWaChannelOwnersNow() {
    try {
        await fs.writeFile(WA_CHANNEL_OWNERS_FILE, JSON.stringify(waChannelOwnersState, null, 2))
    } catch (error) {
        console.error('[WA_CHANNEL_OWNERS] Persist failed', error?.message || String(error))
    }
}

function schedulePersistWaChannelOwners() {
    if (waChannelOwnersPersistTimer) clearTimeout(waChannelOwnersPersistTimer)
    waChannelOwnersPersistTimer = setTimeout(() => { void persistWaChannelOwnersNow() }, 600).unref?.()
}

function resolveWaActorFromUser(user) {
    if (!user || typeof user !== 'object') return null
    const normalized = normalizeCrmUser(user)
    const id = String(normalized?.id || '').trim()
    const email = String(normalized?.email || '').trim().toLowerCase()
    const username = String(normalized?.username || '').trim().toLowerCase()
    const key = id ? `id:${id}` : email ? `email:${email}` : username ? `user:${username}` : ''
    if (!key) return null
    const displayName = String(
        normalized?.displayName ||
        normalized?.name ||
        normalized?.username ||
        normalized?.email ||
        normalized?.id ||
        ''
    ).trim() || key
    return {
        key,
        id: id || null,
        email: email || null,
        username: username || null,
        displayName
    }
}

function getWaChannelOwner(channel) {
    const key = String(channel)
    const owner = waChannelOwnersState?.channels?.[key]
    if (!owner || typeof owner !== 'object') return null
    const ownerKey = String(owner.ownerKey || '').trim()
    if (!ownerKey) return null
    return {
        ownerKey,
        displayName: String(owner.displayName || '').trim() || ownerKey,
        userId: String(owner.userId || '').trim() || null,
        email: String(owner.email || '').trim().toLowerCase() || null,
        username: String(owner.username || '').trim().toLowerCase() || null,
        connectedAt: String(owner.connectedAt || '').trim() || null,
        updatedAt: String(owner.updatedAt || '').trim() || null
    }
}

function setWaChannelOwner(channel, actor, { connectedAt = null } = {}) {
    if (!actor?.key) return null
    const key = String(channel)
    if (!waChannelOwnersState.channels || typeof waChannelOwnersState.channels !== 'object') {
        waChannelOwnersState.channels = {}
    }
    const nowIso = new Date().toISOString()
    const previous = waChannelOwnersState.channels[key] || {}
    const next = {
        ownerKey: actor.key,
        displayName: actor.displayName || previous.displayName || actor.key,
        userId: actor.id || null,
        email: actor.email || null,
        username: actor.username || null,
        connectedAt: connectedAt || previous.connectedAt || nowIso,
        updatedAt: nowIso
    }
    waChannelOwnersState.channels[key] = next
    schedulePersistWaChannelOwners()
    return next
}

function clearWaChannelOwner(channel, reason = '') {
    const key = String(channel)
    if (!waChannelOwnersState.channels || typeof waChannelOwnersState.channels !== 'object') return false
    if (!waChannelOwnersState.channels[key]) return false
    delete waChannelOwnersState.channels[key]
    schedulePersistWaChannelOwners()
    if (reason) {
        console.info('[WA_CHANNEL_OWNERS] Owner cleared', { channel, reason })
    }
    return true
}

function isWaChannelIdleStatus(status) {
    const value = String(status || '').trim().toLowerCase()
    return value === 'free' || value === 'available' || value === 'stopped' || value === 'disconnected' || value === 'idle'
}

function canWaActorAccessChannel(actor, channel) {
    if (!WA_CHANNEL_OWNER_ENFORCED) return true
    const owner = getWaChannelOwner(channel)
    if (!owner?.ownerKey) return true
    if (!actor?.key) return false
    return owner.ownerKey === actor.key
}

function scopeWaChannelsForActor(channels, actor) {
    const out = []
    for (const channelItem of Array.isArray(channels) ? channels : []) {
        const channel = Number(channelItem?.channel || 0)
        if (!Number.isInteger(channel) || channel < 1 || channel > 9) continue
        const statusLabel = String(channelItem?.status || '').toLowerCase()
        const owner = getWaChannelOwner(channel)

        if (owner?.ownerKey && isWaChannelIdleStatus(statusLabel)) {
            clearWaChannelOwner(channel, 'channel idle')
        }

        if (!owner?.ownerKey || !WA_CHANNEL_OWNER_ENFORCED) {
            out.push(channelItem)
            continue
        }
        if (actor?.key && owner.ownerKey === actor.key) {
            out.push(channelItem)
            continue
        }
    }
    return out
}

function ensureWaBootstrapChannelState(channel) {
    const key = String(channel)
    if (!waBootstrapSyncState.channels[key] || typeof waBootstrapSyncState.channels[key] !== 'object') {
        waBootstrapSyncState.channels[key] = {
            channel,
            running: false,
            startedAt: null,
            completedAt: null,
            failedAt: null,
            lastError: null,
            lastRunReason: null,
            sourceIdentity: null,
            lastAutoTriggerAt: null,
            progress: {
                phase: 'idle',
                contactsPages: 0,
                contactsCount: 0,
                chatPages: 0,
                chatsCount: 0,
                conversationsProcessed: 0,
                messagesCount: 0
            },
            stats: {
                contactsCount: 0,
                chatsCount: 0,
                conversationsProcessed: 0,
                messagesCount: 0,
                contactAliasCount: 0
            }
        }
    }
    return waBootstrapSyncState.channels[key]
}

function ensureWaContactDirectoryChannel(channel) {
    const key = String(channel)
    if (!waContactDirectory.channels[key] || typeof waContactDirectory.channels[key] !== 'object') {
        waContactDirectory.channels[key] = {
            updatedAt: null,
            entries: {}
        }
    }
    if (!waContactDirectory.channels[key].entries || typeof waContactDirectory.channels[key].entries !== 'object') {
        waContactDirectory.channels[key].entries = {}
    }
    return waContactDirectory.channels[key]
}

function markWaBootstrapStateInterrupted(channel, reason = 'Bootstrap sync interrupted by server restart.') {
    const state = ensureWaBootstrapChannelState(channel)
    if (!state.running) return state
    state.running = false
    state.failedAt = new Date().toISOString()
    state.lastError = reason
    state.progress = {
        ...(state.progress || {}),
        phase: 'interrupted'
    }
    schedulePersistWaBootstrapSyncState()
    return state
}

function isLikelyUnresolvedName(value) {
    const text = String(value || '').trim()
    if (!text) return true
    const digits = text.replace(/\D/g, '')
    if (digits.length >= 10 && digits.length >= text.length - 2) return true
    if (text.includes('@') && normalizeWhatsAppJid(text)) return true
    return false
}

function pickBetterDisplayName(currentValue, nextValue) {
    const current = String(currentValue || '').trim()
    const next = String(nextValue || '').trim()
    if (!next) return current
    if (!current) return next
    const currentIsPlaceholder = isLikelyUnresolvedName(current)
    const nextIsPlaceholder = isLikelyUnresolvedName(next)
    if (currentIsPlaceholder && !nextIsPlaceholder) return next
    if (!currentIsPlaceholder && nextIsPlaceholder) return current
    return next.length >= current.length ? next : current
}

function collectIdentityAliases(...values) {
    const aliases = new Set()
    for (const value of values) {
        const raw = String(value || '').trim()
        if (!raw) continue
        aliases.add(raw.toLowerCase())
        const identity = buildConversationIdentity(raw)
        for (const alias of identity.aliases || []) {
            aliases.add(String(alias || '').toLowerCase())
        }
    }
    return Array.from(aliases).filter(Boolean)
}

function resolveDirectoryEntryKey(payload = {}) {
    const remoteJid = normalizeWhatsAppJid(payload.remoteJid || '')
    const phone = extractPhoneFromJid(payload.phone || remoteJid || '')
    if (remoteJid) return `jid:${remoteJid.toLowerCase()}`
    if (phone) return `phone:${phone}`
    const fallback = String(payload.name || '').trim().toLowerCase()
    return fallback ? `name:${fallback}` : ''
}

function upsertWaContactDirectoryEntry(channel, payload = {}) {
    const bucket = ensureWaContactDirectoryChannel(channel)
    const aliases = collectIdentityAliases(
        ...(Array.isArray(payload.aliases) ? payload.aliases : []),
        payload.remoteJid,
        payload.phone
    )
    if (!aliases.length) return null

    const lookup = bucket.entries || {}
    let previous = null
    for (const alias of aliases) {
        const found = lookup[alias]
        if (found && typeof found === 'object') {
            previous = found
            break
        }
    }

    const nextEntry = {
        key: resolveDirectoryEntryKey(payload) || previous?.key || aliases[0],
        remoteJid: normalizeWhatsAppJid(payload.remoteJid || previous?.remoteJid || ''),
        phone: extractPhoneFromJid(payload.phone || previous?.phone || payload.remoteJid || previous?.remoteJid || ''),
        name: pickBetterDisplayName(previous?.name, payload.name),
        profilePicUrl: String(payload.profilePicUrl || previous?.profilePicUrl || '').trim() || null,
        aliases: Array.from(new Set([...(previous?.aliases || []), ...aliases])),
        source: String(payload.source || previous?.source || 'unknown'),
        updatedAt: new Date().toISOString()
    }

    const changed =
        !previous ||
        previous.name !== nextEntry.name ||
        previous.profilePicUrl !== nextEntry.profilePicUrl ||
        previous.remoteJid !== nextEntry.remoteJid ||
        previous.phone !== nextEntry.phone ||
        (previous.aliases || []).length !== nextEntry.aliases.length

    if (!changed) return previous

    for (const alias of nextEntry.aliases) {
        lookup[alias] = nextEntry
    }
    bucket.updatedAt = nextEntry.updatedAt
    schedulePersistWaContactDirectory()
    return nextEntry
}

function lookupWaContactDirectoryEntry(channel, candidates = []) {
    const key = String(channel)
    const bucket = waContactDirectory.channels[key]
    if (!bucket || !bucket.entries || typeof bucket.entries !== 'object') return null
    const aliases = collectIdentityAliases(...candidates)
    for (const alias of aliases) {
        const entry = bucket.entries[alias]
        if (entry && typeof entry === 'object') return entry
    }
    return null
}

function listFromEvolutionResponse(payload, preferredKeys = []) {
    if (Array.isArray(payload)) return payload
    if (!payload || typeof payload !== 'object') return []
    for (const key of preferredKeys) {
        const candidate = payload?.[key]
        if (Array.isArray(candidate)) return candidate
    }
    const genericKeys = ['data', 'items', 'records', 'contacts', 'chats', 'messages']
    for (const key of genericKeys) {
        const candidate = payload?.[key]
        if (Array.isArray(candidate)) return candidate
    }
    if (Array.isArray(payload?.messages?.records)) return payload.messages.records
    return []
}

function resolveChannelSourceIdentity(channelStatus, fallback = '') {
    const value = String(
        channelStatus?.metadata?.phoneNumber ||
        channelStatus?.metadata?.ownerJid ||
        channelStatus?.number ||
        channelStatus?.ownerJid ||
        channelStatus?.name ||
        fallback ||
        ''
    ).trim()
    return value || null
}

function parseEvolutionChannelFromInstanceName(instanceNameRaw) {
    const instanceName = String(instanceNameRaw || '').trim()
    if (!instanceName) return null
    const suffixMatch = instanceName.match(/(\d+)$/)
    if (!suffixMatch) return null
    const channel = Number.parseInt(suffixMatch[1], 10)
    if (!Number.isInteger(channel) || channel < 1 || channel > 9) return null
    return channel
}

function payloadSignalsConnectedState(payload = {}) {
    const states = [
        payload?.data?.state,
        payload?.data?.connection,
        payload?.data?.status,
        payload?.status,
        payload?.state
    ]
    return states.some((value) => {
        const normalized = String(value || '').trim().toLowerCase()
        return normalized === 'open' || normalized === 'connected'
    })
}

function maybeTriggerBootstrapFromWebhook(payload = {}) {
    if (!USE_EVOLUTION_ORCHESTRATOR || !WA_BOOTSTRAP_SYNC_ENABLED) return
    const channel = parseEvolutionChannelFromInstanceName(payload?.instance)
    if (!channel) return

    const eventName = String(payload?.event || '').trim().toLowerCase()
    const isConnectedSignal = eventName.includes('connection') && payloadSignalsConnectedState(payload)
    const isConversationActivity = eventName === 'messages.upsert' || eventName === 'chats.update'
    if (!isConnectedSignal && !isConversationActivity) return

    const state = ensureWaBootstrapChannelState(channel)
    if (state.running) return
    if (state.completedAt) return

    void triggerEvolutionBootstrapSync(channel, {
        force: true,
        reason: isConnectedSignal ? 'webhook-connected' : 'webhook-activity'
    })
}

function summarizeWaBootstrapSync(channel) {
    const key = String(channel)
    const state = ensureWaBootstrapChannelState(channel)
    const contactBucket = waContactDirectory.channels[key]
    const aliasCount = contactBucket?.entries ? Object.keys(contactBucket.entries).length : 0
    return {
        channel,
        running: Boolean(state.running),
        startedAt: state.startedAt || null,
        completedAt: state.completedAt || null,
        failedAt: state.failedAt || null,
        lastError: state.lastError || null,
        lastRunReason: state.lastRunReason || null,
        sourceIdentity: state.sourceIdentity || null,
        lastAutoTriggerAt: state.lastAutoTriggerAt || null,
        progress: state.progress || null,
        stats: {
            ...(state.stats || {}),
            contactAliasCount: aliasCount
        }
    }
}

async function runEvolutionBootstrapSync(channel, { force = false, reason = 'manual' } = {}) {
    if (!USE_EVOLUTION_ORCHESTRATOR) {
        throw new Error('Bootstrap sync is only available for Evolution provider.')
    }
    if (!WA_BOOTSTRAP_SYNC_ENABLED) {
        throw new Error('Bootstrap sync is disabled.')
    }
    const state = ensureWaBootstrapChannelState(channel)
    if (state.running) return summarizeWaBootstrapSync(channel)

    state.running = true
    state.startedAt = new Date().toISOString()
    state.lastRunReason = reason
    state.lastError = null
    state.failedAt = null
    state.progress = {
        phase: 'starting',
        contactsPages: 0,
        contactsCount: 0,
        chatPages: 0,
        chatsCount: 0,
        conversationsProcessed: 0,
        messagesCount: 0
    }
    schedulePersistWaBootstrapSyncState()

    try {
        const channelStatus = await evolutionOrchestrator.getChannelStatus(channel)
        const statusLabel = String(channelStatus?.status || '').toLowerCase()
        if (statusLabel !== 'connected' && statusLabel !== 'available') {
            throw new Error(`Channel ${channel} is not connected (status=${statusLabel || 'unknown'}).`)
        }

        const sourceIdentity = resolveChannelSourceIdentity(channelStatus?.instance, `channel-${channel}`)
        state.sourceIdentity = sourceIdentity
        state.progress.phase = 'contacts'
        schedulePersistWaBootstrapSyncState()

        let contactsCount = 0
        for (let page = 1; page <= WA_BOOTSTRAP_MAX_CONTACT_PAGES; page += 1) {
            const contactsPayload = await evolutionOrchestrator.fetchContacts(channel, {
                limit: WA_BOOTSTRAP_CONTACT_PAGE_SIZE,
                page
            })
            const contacts = listFromEvolutionResponse(contactsPayload, ['contacts', 'data', 'records'])
            state.progress.contactsPages = page
            state.progress.contactsCount += contacts.length
            schedulePersistWaBootstrapSyncState()
            if (!contacts.length) break
            for (const contact of contacts) {
                const identity = buildConversationIdentity(contact?.remoteJid || contact?.jid || contact?.id || '')
                upsertWaContactDirectoryEntry(channel, {
                    aliases: identity.aliases,
                    remoteJid: identity.rawJid || identity.normalizedJid,
                    phone: identity.phone || contact?.phone || contact?.number || '',
                    name: contact?.pushName || contact?.name || contact?.subject || '',
                    profilePicUrl: contact?.profilePicUrl || contact?.profilePictureUrl || contact?.imgUrl || contact?.avatarUrl || '',
                    source: 'bootstrap:contacts'
                })
            }
            contactsCount += contacts.length
            if (contacts.length < WA_BOOTSTRAP_CONTACT_PAGE_SIZE) break
        }

        state.progress.phase = 'chats'
        schedulePersistWaBootstrapSyncState()
        let chatsCount = 0
        let messagesCount = 0
        let conversationsProcessed = 0
        const knownChats = []
        for (let page = 1; page <= WA_BOOTSTRAP_MAX_CHAT_PAGES; page += 1) {
            const offset = (page - 1) * WA_BOOTSTRAP_CHAT_PAGE_SIZE
            const chatsPayload = await evolutionOrchestrator.fetchChats(channel, {
                limit: WA_BOOTSTRAP_CHAT_PAGE_SIZE,
                offset
            })
            const chats = listFromEvolutionResponse(chatsPayload, ['chats', 'data', 'records'])
            state.progress.chatPages = page
            state.progress.chatsCount += chats.length
            schedulePersistWaBootstrapSyncState()
            if (!chats.length) break
            knownChats.push(...chats)
            for (const chat of chats) {
                const identity = buildConversationIdentity(resolveChatConversationJid(chat))
                upsertWaContactDirectoryEntry(channel, {
                    aliases: identity.aliases,
                    remoteJid: identity.rawJid || identity.normalizedJid,
                    phone: identity.phone,
                    name: chat?.pushName || chat?.name || chat?.subject || '',
                    profilePicUrl: chat?.profilePicUrl || chat?.profilePictureUrl || chat?.avatarUrl || chat?.imgUrl || '',
                    source: 'bootstrap:chats'
                })
            }
            chatsCount += chats.length
            if (chats.length < WA_BOOTSTRAP_CHAT_PAGE_SIZE) break
        }

        state.progress.phase = 'messages'
        schedulePersistWaBootstrapSyncState()
        for (const chat of knownChats) {
            const remoteJid = resolveChatConversationJid(chat) || resolveChatConversationAltJid(chat)
            if (!remoteJid) continue
            conversationsProcessed += 1
            for (let page = 1; page <= WA_BOOTSTRAP_MAX_MESSAGE_PAGES_PER_CHAT; page += 1) {
                const messagesPayload = await evolutionOrchestrator.fetchMessages(channel, remoteJid, {
                    limit: WA_BOOTSTRAP_MESSAGE_PAGE_SIZE,
                    page
                })
                const records = listFromEvolutionResponse(messagesPayload, ['records'])
                if (!records.length) break
                messagesCount += records.length
                state.progress.messagesCount = messagesCount
                state.progress.conversationsProcessed = conversationsProcessed
                schedulePersistWaBootstrapSyncState()
                for (const record of records) {
                    const senderJidPrimaryRaw = record?.key?.participant || record?.participant || record?.sender?.jid || ''
                    const senderJidAltRaw = record?.key?.participantAlt || record?.participantAlt || record?.sender?.participantAlt || ''
                    const senderJidRaw = senderJidAltRaw || senderJidPrimaryRaw || record?.key?.remoteJid || ''
                    const senderJid = normalizeWhatsAppJid(senderJidRaw)
                    const senderPhone = extractPhoneFromJid(senderJidAltRaw || senderJid || senderJidPrimaryRaw)
                    const senderName =
                        record?.pushName ||
                        record?.senderName ||
                        record?.participantPushName ||
                        record?.sender?.pushName ||
                        record?.sender?.name ||
                        ''
                    const senderAvatarUrl =
                        record?.profilePicUrl ||
                        record?.sender?.profilePicUrl ||
                        record?.sender?.avatarUrl ||
                        record?.participantProfilePicUrl ||
                        ''
                    upsertWaContactDirectoryEntry(channel, {
                        aliases: collectIdentityAliases(senderJid, senderPhone),
                        remoteJid: senderJid,
                        phone: senderPhone,
                        name: senderName,
                        profilePicUrl: senderAvatarUrl,
                        source: 'bootstrap:messages'
                    })
                }
                if (records.length < WA_BOOTSTRAP_MESSAGE_PAGE_SIZE) break
            }
        }

        state.running = false
        state.completedAt = new Date().toISOString()
        state.progress.phase = 'completed'
        state.stats = {
            contactsCount,
            chatsCount,
            conversationsProcessed,
            messagesCount,
            contactAliasCount: Object.keys(ensureWaContactDirectoryChannel(channel).entries || {}).length
        }
        schedulePersistWaBootstrapSyncState()
        schedulePersistWaContactDirectory()
        await persistWaBootstrapSyncStateNow()
        await persistWaContactDirectoryNow()
    } catch (error) {
        state.running = false
        state.failedAt = new Date().toISOString()
        state.lastError = error?.message || String(error)
        state.progress = {
            ...(state.progress || {}),
            phase: 'failed'
        }
        schedulePersistWaBootstrapSyncState()
        await persistWaBootstrapSyncStateNow()
    }

    return summarizeWaBootstrapSync(channel)
}

function triggerEvolutionBootstrapSync(channel, options = {}) {
    const numericChannel = Number(channel)
    if (!Number.isInteger(numericChannel) || numericChannel < 1 || numericChannel > 9) {
        return null
    }
    if (!USE_EVOLUTION_ORCHESTRATOR || !WA_BOOTSTRAP_SYNC_ENABLED) return null
    const currentState = ensureWaBootstrapChannelState(numericChannel)
    if (currentState.running && !waBootstrapSyncTasks.has(numericChannel)) {
        markWaBootstrapStateInterrupted(
            numericChannel,
            'Bootstrap sync interrupted before completion. Retrying in current server session.'
        )
    }
    if (waBootstrapSyncTasks.has(numericChannel)) {
        return waBootstrapSyncTasks.get(numericChannel)
    }
    const task = Promise.resolve()
        .then(() => runEvolutionBootstrapSync(numericChannel, options))
        .catch((error) => {
            const state = ensureWaBootstrapChannelState(numericChannel)
            state.running = false
            state.failedAt = new Date().toISOString()
            state.lastError = error?.message || String(error)
            state.progress = {
                ...(state.progress || {}),
                phase: 'failed'
            }
            schedulePersistWaBootstrapSyncState()
            return summarizeWaBootstrapSync(numericChannel)
        })
        .finally(() => {
            waBootstrapSyncTasks.delete(numericChannel)
        })
    waBootstrapSyncTasks.set(numericChannel, task)
    return task
}

function maybeAutoBootstrapSync(status) {
    if (!USE_EVOLUTION_ORCHESTRATOR || !WA_BOOTSTRAP_SYNC_ENABLED || !WA_BOOTSTRAP_SYNC_AUTO_ON_CONNECTED) return
    const channels = Array.isArray(status?.channels) ? status.channels : []
    const now = Date.now()
    for (const channelStatus of channels) {
        const channel = Number(channelStatus?.channel || 0)
        if (!Number.isInteger(channel) || channel < 1 || channel > 9) continue
        if (String(channelStatus?.status || '').toLowerCase() !== 'connected') continue
        const state = ensureWaBootstrapChannelState(channel)
        if (state.running && !waBootstrapSyncTasks.has(channel)) {
            markWaBootstrapStateInterrupted(
                channel,
                'Bootstrap sync interrupted before completion. Retrying automatically.'
            )
        }
        if (state.running) continue
        const sourceIdentity = resolveChannelSourceIdentity(channelStatus, `channel-${channel}`)
        const isSourceChanged = Boolean(sourceIdentity && state.sourceIdentity && sourceIdentity !== state.sourceIdentity)
        const hasNeverCompleted = !state.completedAt
        const lastAutoAt = Date.parse(String(state.lastAutoTriggerAt || '')) || 0
        if (!hasNeverCompleted && !isSourceChanged) continue
        if (lastAutoAt && now - lastAutoAt < WA_BOOTSTRAP_AUTO_COOLDOWN_MS) continue
        state.lastAutoTriggerAt = new Date(now).toISOString()
        schedulePersistWaBootstrapSyncState()
        void triggerEvolutionBootstrapSync(channel, {
            force: isSourceChanged || hasNeverCompleted,
            reason: 'auto'
        })
    }
}

await loadWaBootstrapSyncState()
await loadWaContactDirectory()
await loadWaChannelOwnersState()
for (const [channel, state] of Object.entries(waBootstrapSyncState.channels || {})) {
    if (state?.running) {
        markWaBootstrapStateInterrupted(
            Number(channel),
            'Bootstrap sync interrupted by server restart. Retrying when channel is connected.'
        )
    }
}

function normalizeEvolutionTimestamp(value) {
    if (!value) return new Date().toISOString()
    const num = Number(value)
    if (!Number.isNaN(num)) {
        const ts = num > 1e12 ? num : num * 1000
        return new Date(ts).toISOString()
    }
    const parsed = Date.parse(String(value))
    if (!Number.isNaN(parsed)) return new Date(parsed).toISOString()
    return new Date().toISOString()
}

function waUnauthorizedResponse(res) {
    return res.status(401).json({
        success: false,
        error: 'UNAUTHORIZED',
        hint: 'Faça login no CRM para continuar.'
    })
}

function getWaActorFromReq(req) {
    if (req?.waActor?.key) return req.waActor
    const actor = resolveWaActorFromUser(req?.crmUser || null)
    if (actor?.key) req.waActor = actor
    return actor
}

function ensureWaChannelOwnership(req, res, channel) {
    if (!WA_CHANNEL_OWNER_ENFORCED) return true
    const actor = getWaActorFromReq(req)
    if (!actor?.key) {
        waUnauthorizedResponse(res)
        return false
    }
    const owner = getWaChannelOwner(channel)
    if (!owner?.ownerKey) return true
    if (owner.ownerKey === actor.key) return true
    res.status(403).json({
        success: false,
        error: 'CHANNEL_FORBIDDEN',
        channel,
        hint: 'Este canal do WhatsApp está vinculado a outro usuário do CRM.'
    })
    return false
}

function isWaOrchestratorPublicPath(pathname) {
    const path = String(pathname || '').trim().toLowerCase()
    return path === '/webhook' || path.startsWith('/webhook/') || path === '/local/recovery/restart' || path.startsWith('/local/recovery/restart/')
}

app.use('/api/wa-orchestrator', async (req, res, next) => {
    if (isWaOrchestratorPublicPath(req.path)) return next()
    req.crmUser = req.crmUser || await resolveCrmUser(req).catch(() => null)
    req.waActor = resolveWaActorFromUser(req.crmUser || null)
    if (WA_CHANNEL_OWNER_ENFORCED && !req.waActor?.key) {
        return waUnauthorizedResponse(res)
    }
    return next()
})

app.use('/api/wa-orchestrator/channels/:channel', (req, res, next) => {
    if (String(req.path || '').trim() === '/start') return next()
    const channel = Number.parseInt(String(req.params.channel || ''), 10)
    if (!Number.isInteger(channel) || channel < 1 || channel > 9) {
        return res.status(400).json({
            success: false,
            error: 'Invalid channel. Must be between 1 and 9.'
        })
    }
    if (!ensureWaChannelOwnership(req, res, channel)) return
    return next()
})

// Get orchestrator status and all channels - enhanced with detailed information
app.get('/api/wa-orchestrator/status', async (req, res) => {
    try {
        if (USE_EVOLUTION_ORCHESTRATOR) {
            const status = await evolutionOrchestrator.getStatus()
            maybeAutoBootstrapSync(status)
            const scopedChannels = scopeWaChannelsForActor(status.channels, req.waActor)
            const connectedInstances = scopedChannels.filter((item) => String(item?.status || '').toLowerCase() === 'connected').length
            const freeInstances = scopedChannels.filter((item) => String(item?.status || '').toLowerCase() === 'free').length
            const errorInstances = scopedChannels.filter((item) => String(item?.status || '').toLowerCase() === 'error').length
            const startingInstances = scopedChannels.filter((item) => {
                const value = String(item?.status || '').toLowerCase()
                return value === 'starting' || value === 'qr_pending'
            }).length
            const bootstrapSync = Object.fromEntries(
                scopedChannels.map((item) => [String(item.channel), summarizeWaBootstrapSync(item.channel)])
            )
            return res.json({
                success: true,
                provider: 'evolution',
                ...status,
                channels: scopedChannels,
                totalChannels: scopedChannels.length,
                availableChannels: freeInstances,
                freeInstances,
                connectedInstances,
                errorInstances,
                startingInstances,
                bootstrapSync,
                sseClients: waEventClients.size,
                webhookMetrics: waWebhookMetrics,
                availableChannelsList: scopedChannels.filter((c) => c.status === 'free').map((c) => c.channel),
                freeChannelsList: scopedChannels.filter((c) => c.status === 'free').map((c) => c.channel),
                recoverySuggestions: null,
                endpoints: {
                    channels: '/api/wa-orchestrator/channels',
                    startChannel: '/api/wa-orchestrator/channels/{channel}/start',
                    getChannelStatus: '/api/wa-orchestrator/channels/{channel}',
                    getChannelQR: '/api/wa-orchestrator/channels/{channel}/qr',
                    stopChannel: '/api/wa-orchestrator/channels/{channel}/stop',
                    restartChannel: '/api/wa-orchestrator/channels/{channel}/restart',
                    bootstrapSync: '/api/wa-orchestrator/channels/{channel}/bootstrap-sync',
                    restartLocalRecovery: '/api/wa-orchestrator/local/recovery/restart'
                }
            })
        }

        const status = whatsappOrchestrator.getStatus()
        const scopedChannels = scopeWaChannelsForActor(status.channels, req.waActor)
        const connectedInstances = scopedChannels.filter((item) => String(item?.status || '').toLowerCase() === 'connected').length
        const freeInstances = scopedChannels.filter((item) => String(item?.status || '').toLowerCase() === 'free').length
        const errorInstances = scopedChannels.filter((item) => String(item?.status || '').toLowerCase() === 'error').length
        const startingInstances = scopedChannels.filter((item) => {
            const value = String(item?.status || '').toLowerCase()
            return value === 'starting' || value === 'qr_pending'
        }).length
        const availableChannels = whatsappOrchestrator.getAvailableChannels()
        const freeChannels = whatsappOrchestrator.getFreeChannels()
        const recoverySuggestions = whatsappOrchestrator.getRecoverySuggestions()

        res.json({
            success: true,
            provider: 'legacy',
            ...status,
            channels: scopedChannels,
            totalChannels: scopedChannels.length,
            availableChannels: freeInstances,
            freeInstances,
            connectedInstances,
            errorInstances,
            startingInstances,
            sseClients: waEventClients.size,
            webhookMetrics: waWebhookMetrics,
            availableChannelsList: availableChannels.filter((channel) => canWaActorAccessChannel(req.waActor, channel)),
            freeChannelsList: freeChannels.filter((channel) => canWaActorAccessChannel(req.waActor, channel)),
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

app.post('/api/wa-orchestrator/local/recovery/restart', async (req, res) => {
    try {
        if (!WA_LOCAL_RECOVERY_ENABLED) {
            return res.status(403).json({
                success: false,
                error: 'LOCAL_RECOVERY_DISABLED'
            })
        }

        const requestIp = String(req.ip || '').trim()
        if (!isLoopbackIp(requestIp)) {
            return res.status(403).json({
                success: false,
                error: 'LOCAL_RECOVERY_FORBIDDEN_REMOTE_IP',
                ip: requestIp || null
            })
        }

        const mode = String(req.body?.mode || req.body?.scope || 'evolution').trim().toLowerCase()
        if (!['evolution', 'stack'].includes(mode)) {
            return res.status(400).json({
                success: false,
                error: 'INVALID_RECOVERY_MODE',
                allowed: ['evolution', 'stack']
            })
        }
        const syncRepo = mode === 'stack' && normalizeBoolean(req.body?.syncRepo, false)
        const requestedSyncAutoStash = normalizeBoolean(req.body?.syncAutoStash, false)
        const syncAutoStash = Boolean(syncRepo && requestedSyncAutoStash && WA_LOCAL_RECOVERY_SYNC_ALLOW_AUTOSTASH)
        const parsedSyncSha = parseRecoverySyncSha(req.body?.syncSha || req.body?.sha)
        if (syncRepo && parsedSyncSha.invalid) {
            return res.status(400).json({
                success: false,
                error: 'INVALID_RECOVERY_SYNC_SHA',
                hint: 'Provide a valid git commit SHA (7-40 hex chars).'
            })
        }

        const uid = Number(process.getuid?.() || os.userInfo().uid || 0)
        const launchdTarget = `gui/${uid}/${LOCAL_EVOLUTION_LAUNCHD_LABEL}`

        const steps = []
        let syncSummary = null
        let coreStep = null
        if (mode === 'stack') {
            if (syncRepo) {
                const syncResult = await runLocalRecoveryRepoSync({
                    sha: parsedSyncSha.sha,
                    autoStash: syncAutoStash
                })
                syncSummary = {
                    success: Boolean(syncResult.success),
                    repoDirty: Boolean(syncResult.repoDirty),
                    targetRef: syncResult.targetRef || null,
                    appliedSha: syncResult.appliedSha || null,
                    autoStashRequested: requestedSyncAutoStash,
                    autoStashApplied: syncAutoStash,
                    error: syncResult.error || null
                }
                for (const syncStep of Array.isArray(syncResult.steps) ? syncResult.steps : []) {
                    steps.push({ phase: 'repo-sync', ...syncStep })
                }
                if (!syncResult.success) {
                    return res.status(500).json({
                        success: false,
                        mode,
                        error: syncResult.error || 'RECOVERY_SYNC_FAILED',
                        sync: syncSummary,
                        steps
                    })
                }
            }
            const exists = fsSync.existsSync(WA_LOCAL_RECOVERY_SCRIPT)
            if (!exists) {
                return res.status(500).json({
                    success: false,
                    error: 'RECOVERY_SCRIPT_NOT_FOUND',
                    script: WA_LOCAL_RECOVERY_SCRIPT
                })
            }
            coreStep = await runCommandWithTimeout('bash', [WA_LOCAL_RECOVERY_SCRIPT], {
                cwd: path.join(REPO_ROOT, 'n8n'),
                timeoutMs: WA_LOCAL_RECOVERY_TIMEOUT_MS
            })
            steps.push({ phase: 'stack-restart', ...coreStep })
        } else {
            steps.push({ phase: 'evolution-restart', ...(await runCommandWithTimeout('launchctl', ['stop', launchdTarget], {
                timeoutMs: 8_000
            })) })
            coreStep = await runCommandWithTimeout('launchctl', ['kickstart', '-k', launchdTarget], {
                timeoutMs: 20_000
            })
            steps.push({ phase: 'evolution-restart', ...coreStep })
        }

        let status = null
        for (let attempt = 0; attempt < 12; attempt++) {
            try {
                status = await evolutionOrchestrator.runWithoutAutoRecovery(() => evolutionOrchestrator.getStatus())
            } catch {
                status = null
            }
            if (status?.providerOnline) break
            if (attempt < 11) {
                await new Promise((resolve) => setTimeout(resolve, 1000))
            }
        }

        const hasFailure = Boolean(
            coreStep?.timedOut ||
            (typeof coreStep?.code === 'number' && coreStep.code !== 0)
        )
        const responseStatus = hasFailure ? 500 : 200
        return res.status(responseStatus).json({
            success: !hasFailure,
            mode,
            sync: syncSummary,
            steps,
            status: status ? {
                providerOnline: Boolean(status.providerOnline),
                connectedInstances: Number(status.connectedInstances || 0),
                startingInstances: Number(status.startingInstances || 0),
                errorInstances: Number(status.errorInstances || 0),
                totalChannels: Number(status.totalChannels || 0)
            } : null
        })
    } catch (error) {
        return res.status(500).json({
            success: false,
            error: error?.message || 'LOCAL_RECOVERY_RESTART_FAILED'
        })
    }
})

app.get('/api/wa-orchestrator/channels/:channel/bootstrap-sync', async (req, res) => {
    const channel = Number.parseInt(String(req.params.channel || ''), 10)
    if (!Number.isInteger(channel) || channel < 1 || channel > 9) {
        return res.status(400).json({
            success: false,
            error: 'Invalid channel. Must be between 1 and 9.'
        })
    }
    return res.json({
        success: true,
        channel,
        state: summarizeWaBootstrapSync(channel)
    })
})

app.post('/api/wa-orchestrator/channels/:channel/bootstrap-sync', async (req, res) => {
    try {
        const channel = Number.parseInt(String(req.params.channel || ''), 10)
        if (!Number.isInteger(channel) || channel < 1 || channel > 9) {
            return res.status(400).json({
                success: false,
                error: 'Invalid channel. Must be between 1 and 9.'
            })
        }
        if (!USE_EVOLUTION_ORCHESTRATOR) {
            return res.status(400).json({
                success: false,
                error: 'Bootstrap sync is only available for Evolution provider.'
            })
        }
        if (!WA_BOOTSTRAP_SYNC_ENABLED) {
            return res.status(403).json({
                success: false,
                error: 'WA_BOOTSTRAP_SYNC_DISABLED'
            })
        }

        const force = Boolean(req.body?.force)
        const wait = Boolean(req.body?.wait)
        const reason = String(req.body?.reason || 'manual').trim().slice(0, 40) || 'manual'
        const task = triggerEvolutionBootstrapSync(channel, { force, reason })

        if (!task) {
            return res.status(500).json({
                success: false,
                error: 'Failed to trigger bootstrap sync.'
            })
        }

        if (wait) {
            const state = await task
            return res.json({
                success: true,
                channel,
                queued: false,
                state
            })
        }

        return res.status(202).json({
            success: true,
            channel,
            queued: true,
            state: summarizeWaBootstrapSync(channel)
        })
    } catch (error) {
        return res.status(500).json({
            success: false,
            error: error?.message || 'WA_BOOTSTRAP_SYNC_FAILED'
        })
    }
})

// SSE events for evolution updates
app.get('/api/wa-orchestrator/events', (req, res) => {
    const actor = getWaActorFromReq(req)
    if (WA_CHANNEL_OWNER_ENFORCED && !actor?.key) {
        return waUnauthorizedResponse(res)
    }
    res.setHeader('Content-Type', 'text/event-stream')
    res.setHeader('Cache-Control', 'no-cache')
    res.setHeader('Connection', 'keep-alive')
    res.flushHeaders?.()
    res.write(`data: ${JSON.stringify({ type: 'connected', ts: new Date().toISOString() })}\n\n`)
    const eventClient = { res, actorKey: String(actor?.key || '').trim() || null }
    waEventClients.add(eventClient)
    console.info('[WA_ORCHESTRATOR] SSE connected', { clients: waEventClients.size })

    const heartbeat = setInterval(() => {
        if (res.destroyed) {
            clearInterval(heartbeat)
            waEventClients.delete(eventClient)
            return
        }
        try {
            res.write(`data: ${JSON.stringify({ type: 'heartbeat', ts: new Date().toISOString() })}\n\n`)
        } catch {
            clearInterval(heartbeat)
            waEventClients.delete(eventClient)
        }
    }, 25000)

    req.on('close', () => {
        clearInterval(heartbeat)
        waEventClients.delete(eventClient)
        console.info('[WA_ORCHESTRATOR] SSE disconnected', { clients: waEventClients.size })
    })
})

// Evolution webhook receiver
app.post('/api/wa-orchestrator/webhook', (req, res) => {
    if (!shouldAuthorizeWebhook(req)) {
        console.warn('[WA_ORCHESTRATOR] Webhook unauthorized', {
            ip: req.ip,
            ua: req.get('user-agent')
        })
        recordWebhookFailure('unauthorized', req)
        return res.status(401).json({ success: false, error: 'Unauthorized' })
    }
    try {
        const payload = req.body || {}
        console.info('[WA_ORCHESTRATOR] Webhook event', {
            event: payload.event,
            instance: payload.instance
        })
        maybeTriggerBootstrapFromWebhook(payload)
        broadcastWaEvent(payload)
        recordWebhookSuccess()
        res.json({ success: true })
    } catch (error) {
        recordWebhookFailure('error', req, error)
        res.status(500).json({ success: false, error: error.message })
    }
})

// List conversations for a channel (normalized)
app.get('/api/wa-orchestrator/channels/:channel/conversations', async (req, res) => {
    try {
        const channel = parseInt(req.params.channel)
        if (isNaN(channel) || channel < 1 || channel > 9) {
            return res.status(400).json({ success: false, error: 'Invalid channel. Must be between 1 and 9.' })
        }
        const limit = Math.min(Math.max(parseInt(String(req.query.limit || '50'), 10) || 50, 1), 200)
        const offset = Math.max(parseInt(String(req.query.offset || '0'), 10) || 0, 0)

        if (USE_EVOLUTION_ORCHESTRATOR) {
            const data = await evolutionOrchestrator.fetchChats(channel, { limit, offset })
            const chats = Array.isArray(data) ? data : (data?.chats || data?.data || [])
            const mapped = chats.map((chat) => {
                upsertWaContactDirectoryEntry(channel, {
                    aliases: collectIdentityAliases(chat?.remoteJid, chat?.remoteJidAlt, chat?.id, chat?.chatId, chat?.jid),
                    remoteJid: resolveChatConversationJid(chat),
                    phone: extractPhoneFromJid(chat?.remoteJid || chat?.id || ''),
                    name: chat?.pushName || chat?.name || chat?.subject || '',
                    profilePicUrl: chat?.profilePicUrl || chat?.profilePictureUrl || chat?.avatarUrl || chat?.imgUrl || '',
                    source: 'fetch:chats'
                })
                const rawRemoteJid = resolveChatConversationJid(chat)
                const altRemoteJid = resolveChatConversationAltJid(chat)
                const rawIdentity = buildConversationIdentity(rawRemoteJid)
                const altIdentity = buildConversationIdentity(altRemoteJid)
                const preferredRemoteJid =
                    rawIdentity.kind === 'group'
                        ? rawRemoteJid
                        : (altIdentity.kind === 'direct' ? altRemoteJid : rawRemoteJid)
                const identity = buildConversationIdentity(preferredRemoteJid)
                const rawLastMessage = chat.lastMessage?.message || chat.lastMessage
                const lastMessageText = extractEvolutionMessageText(rawLastMessage)
                const lastMessageMeta = extractEvolutionMessageMeta(rawLastMessage)
                const lastMessageId = String(chat?.lastMessage?.id || chat?.lastMessage?.key?.id || '').trim()
                const updatedAt = normalizeEvolutionTimestamp(chat.updatedAt || chat.lastMessage?.messageTimestamp)
                const profilePic = chat.profilePicUrl || chat.profilePictureUrl || chat.avatarUrl || chat.avatar || chat.imgUrl || chat.pictureUrl || chat.photoUrl || null
                const mappedItem = {
                    conversationId: identity.rawJid || identity.normalizedJid,
                    rawJid: rawIdentity.rawJid || identity.rawJid || identity.normalizedJid,
                    normalizedJid: identity.normalizedJid || rawIdentity.normalizedJid || identity.rawJid,
                    name: chat.pushName || chat.name || chat.subject || preferredRemoteJid || rawRemoteJid,
                    phone:
                        identity.kind === 'group'
                            ? (identity.phone || rawIdentity.phone || extractPhoneFromJid(rawRemoteJid))
                            : (
                                (altIdentity.kind === 'direct' ? altIdentity.phone : '') ||
                                identity.phone ||
                                rawIdentity.phone ||
                                extractPhoneFromJid(preferredRemoteJid || rawRemoteJid)
                            ),
                    platform: 'whatsapp',
                    profilePic,
                    lastMessage: lastMessageText || 'Sem mensagens',
                    lastMessageType: String(lastMessageMeta?.mediaType || chat?.lastMessage?.messageType || chat?.lastMessage?.type || '').trim() || undefined,
                    lastMessageMediaType: lastMessageMeta?.mediaType || undefined,
                    lastMessageCaption: lastMessageMeta?.caption || undefined,
                    lastMessageMimeType: lastMessageMeta?.mimeType || undefined,
                    lastMessageFileName: lastMessageMeta?.fileName || undefined,
                    lastMessageMediaProxyUrl:
                        lastMessageMeta?.mediaType && lastMessageId
                            ? buildWaMediaProxyUrl(req, { channel, remoteJid: identity.rawJid || identity.normalizedJid, messageId: lastMessageId })
                            : undefined,
                    updatedAt,
                    unreadCount: chat.unreadCount ?? chat.unreadMessages ?? 0,
                    aliases: Array.from(new Set([...(rawIdentity.aliases || []), ...(identity.aliases || []), ...(altIdentity.aliases || [])]))
                }
                const directoryEntry = lookupWaContactDirectoryEntry(channel, [
                    mappedItem.conversationId,
                    mappedItem.rawJid,
                    mappedItem.normalizedJid,
                    mappedItem.phone,
                    ...(mappedItem.aliases || [])
                ])
                if (directoryEntry) {
                    mappedItem.name = pickBetterDisplayName(mappedItem.name, directoryEntry.name)
                    if (!mappedItem.profilePic && directoryEntry.profilePicUrl) {
                        mappedItem.profilePic = directoryEntry.profilePicUrl
                    }
                }
                return mappedItem
            }).filter((item) => item.conversationId)

            const dedupedMap = new Map()
            for (const item of mapped) {
                const key = resolveConversationMergeKey(item.conversationId, item.phone) || `fallback:${item.conversationId || item.phone || Math.random()}`
                const previous = dedupedMap.get(key)
                if (!previous) {
                    dedupedMap.set(key, {
                        ...item
                    })
                    continue
                }
                const prevUpdatedAt = Date.parse(previous.updatedAt || '') || 0
                const currentUpdatedAt = Date.parse(item.updatedAt || '') || 0
                const newest = currentUpdatedAt >= prevUpdatedAt ? item : previous
                const mergedAliases = Array.from(new Set([...(previous.aliases || []), ...(item.aliases || [])]))
                dedupedMap.set(key, {
                    ...previous,
                    ...newest,
                    conversationId: newest.conversationId || previous.conversationId,
                    rawJid: newest.rawJid || previous.rawJid,
                    normalizedJid: newest.normalizedJid || previous.normalizedJid,
                    phone: newest.phone || previous.phone,
                    aliases: mergedAliases,
                    unreadCount: Number(previous.unreadCount || 0) + Number(item.unreadCount || 0),
                    name: (
                        (newest.name && !/^\d{10,}$/.test(String(newest.name || ''))) ? newest.name : null
                    ) || (
                        (previous.name && !/^\d{10,}$/.test(String(previous.name || ''))) ? previous.name : null
                    ) || newest.name || previous.name
                })
            }

            const items = Array.from(dedupedMap.values())
                .sort((a, b) => (Date.parse(b.updatedAt || '') || 0) - (Date.parse(a.updatedAt || '') || 0))
            const hasMore = items.length >= limit
            return res.json({ success: true, items, meta: { limit, offset, hasMore } })
        }

        const items = conversations
            .filter(c => !c.archived)
            .map(c => ({
                conversationId: c.conversationId,
                name: c.name || c.conversationId,
                phone: extractPhoneFromJid(c.conversationId),
                platform: 'whatsapp',
                lastMessage: c.lastMessage || 'Sem mensagens',
                updatedAt: c.updatedAt || new Date().toISOString(),
                unreadCount: c.unreadCount || 0
            }))
        return res.json({ success: true, items, meta: { limit, offset, hasMore: false } })
    } catch (error) {
        res.status(500).json({ success: false, error: error.message })
    }
})

// List messages for a conversation on a channel (normalized)
app.get('/api/wa-orchestrator/channels/:channel/conversations/:remoteJid/messages', async (req, res) => {
    try {
        const channel = parseInt(req.params.channel)
        if (isNaN(channel) || channel < 1 || channel > 9) {
            return res.status(400).json({ success: false, error: 'Invalid channel. Must be between 1 and 9.' })
        }
        const { remoteJid } = req.params
        const normalizedRemoteJid = normalizeWhatsAppJid(remoteJid)
        const limit = Math.min(Math.max(parseInt(String(req.query.limit || '50'), 10) || 50, 1), 200)
        const page = Math.max(parseInt(String(req.query.page || '1'), 10) || 1, 1)
        const actor = resolveMessageActor(req)

        if (USE_EVOLUTION_ORCHESTRATOR) {
            const data = await evolutionOrchestrator.fetchMessages(channel, remoteJid, { limit, page })
            const records = data?.messages?.records || []
                const remoteReactionMap = new Map()
                const registerRemoteReaction = (reaction) => {
                    const targetMessageId = String(reaction?.targetMessageId || '').trim()
                    const emoji = String(reaction?.emoji || '').trim()
                    const actorKey = String(reaction?.actorKey || '').trim()
                    if (!targetMessageId || !emoji || !actorKey) return
                    if (!remoteReactionMap.has(targetMessageId)) remoteReactionMap.set(targetMessageId, {})
                    const bucket = remoteReactionMap.get(targetMessageId)
                    if (!bucket[emoji]) bucket[emoji] = { actors: new Set(), reactedByMe: false }
                    bucket[emoji].actors.add(actorKey)
                    bucket[emoji].reactedByMe = bucket[emoji].reactedByMe || Boolean(reaction?.reactedByMe)
                }
                const items = records.flatMap((record) => {
                    const reactionMeta = extractEvolutionReactionMeta(record)
                    if (reactionMeta) {
                        registerRemoteReaction(reactionMeta)
                        return []
                    }
                    const fromMe = !!record?.key?.fromMe
                    const jid = normalizeWhatsAppJid(record?.key?.remoteJid || remoteJid)
                    const isGroupConversation = String(normalizedRemoteJid || jid || '').includes('@g.us')
                    const senderJidPrimaryRaw = record?.key?.participant || record?.participant || record?.sender?.jid || ''
                    const senderJidAltRaw = record?.key?.participantAlt || record?.participantAlt || record?.sender?.participantAlt || ''
                    const senderJidRaw = senderJidAltRaw || senderJidPrimaryRaw
                    const senderJid = normalizeWhatsAppJid(senderJidRaw)
                    const senderLid = String(senderJidPrimaryRaw || '').includes('@lid') ? String(senderJidPrimaryRaw) : undefined
                    const senderPhone = extractPhoneFromJid(senderJidAltRaw || senderJid || senderJidPrimaryRaw)
                    const senderNameRaw =
                        record?.pushName ||
                        record?.senderName ||
                        record?.participantPushName ||
                        record?.sender?.pushName ||
                        record?.sender?.name ||
                        ''
                    const senderAvatarRaw =
                        record?.profilePicUrl ||
                        record?.sender?.profilePicUrl ||
                        record?.sender?.avatarUrl ||
                        record?.participantProfilePicUrl ||
                        ''
                    upsertWaContactDirectoryEntry(channel, {
                        aliases: collectIdentityAliases(senderJid, senderLid, senderPhone, senderJidPrimaryRaw, senderJidAltRaw),
                        remoteJid: senderJid,
                        phone: senderPhone,
                        name: senderNameRaw,
                        profilePicUrl: senderAvatarRaw,
                        source: 'fetch:messages'
                    })
                    const directoryEntry = lookupWaContactDirectoryEntry(channel, [
                        senderJid,
                        senderLid,
                        senderPhone,
                        senderJidPrimaryRaw,
                        senderJidAltRaw
                    ])
                    const senderName = fromMe
                        ? 'Você'
                        : (
                            pickBetterDisplayName(String(senderNameRaw || '').trim(), directoryEntry?.name) ||
                            senderPhone ||
                            senderJid ||
                            'Contato'
                        )
                    const senderAvatarUrl =
                        senderAvatarRaw ||
                        directoryEntry?.profilePicUrl ||
                        null
                    const meta = extractEvolutionMessageMeta(record?.message)
                    const replyTo = extractEvolutionReplyMeta(record)
                    const mentions = extractEvolutionMentionJids(record?.message)
                    const sourceMessageKeyId = String(record?.key?.id || '').trim()
                    return [{
                        id: record?.id || record?.key?.id || `m_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
                        sourceMessageKeyId,
                        conversationId: normalizedRemoteJid || jid,
                        direction: fromMe ? 'outbound' : 'inbound',
                        type: meta.mediaType || record?.messageType || record?.type || 'text',
                        text: meta.text || extractEvolutionMessageText(record?.message),
                        caption: meta.caption,
                        mediaType: meta.mediaType,
                        mediaUrl: meta.mediaUrl,
                        mimeType: meta.mimeType,
                        fileName: meta.fileName,
                        durationSec: meta.durationSec,
                        sizeBytes: meta.sizeBytes,
                        replyTo,
                        senderJid: fromMe ? (record?.key?.remoteJid || normalizedRemoteJid || jid) : (senderJid || record?.key?.remoteJid || normalizedRemoteJid || jid),
                        senderLid,
                        senderPhone,
                        senderName,
                        senderAvatarUrl,
                        mentions,
                        isGroupMessage: isGroupConversation,
                        createdAt: normalizeEvolutionTimestamp(record?.messageTimestamp || record?.timestamp)
                    }]
                })
            const sortedItems = items.sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime())
            sortedItems.forEach((item) => {
                if (item?.replyTo?.messageId && item?.id) {
                    waMessageMetaStore.setReply(channel, normalizedRemoteJid, item.id, item.replyTo)
                }
            })
            const decorated = waMessageMetaStore.decorateMessages(
                channel,
                normalizedRemoteJid,
                sortedItems,
                actor,
                ({ channel: ch, remoteJid: jid, messageId }) =>
                    buildWaMediaProxyUrl(req, { channel: ch, remoteJid: jid, messageId })
            )
            const mergedRemoteReactions = decorated.map((item) => {
                const messageKeys = Array.from(new Set([
                    String(item?.id || '').trim(),
                    String(item?.sourceMessageKeyId || '').trim()
                ].filter(Boolean)))
                const bucket = messageKeys.map((key) => remoteReactionMap.get(key)).find(Boolean)
                if (!bucket) return item
                const existing = new Map(
                    (Array.isArray(item?.reactions) ? item.reactions : []).map((reaction) => [
                        String(reaction?.emoji || '').trim(),
                        {
                            emoji: String(reaction?.emoji || '').trim(),
                            count: Number(reaction?.count || 0),
                            reactedByMe: Boolean(reaction?.reactedByMe)
                        }
                    ])
                )
                Object.entries(bucket).forEach(([emoji, reaction]) => {
                    const current = existing.get(emoji) || { emoji, count: 0, reactedByMe: false }
                    const overlapsCurrentActor = current.reactedByMe && Boolean(reaction.reactedByMe)
                    current.count = Math.max(
                        current.count,
                        reaction.actors.size,
                        current.count + reaction.actors.size - (overlapsCurrentActor ? 1 : 0)
                    )
                    current.reactedByMe = current.reactedByMe || Boolean(reaction.reactedByMe)
                    existing.set(emoji, current)
                })
                return {
                    ...item,
                    reactions: Array.from(existing.values()).filter((reaction) => reaction.count > 0)
                }
            })
            const meta = {
                total: data?.messages?.total,
                pages: data?.messages?.pages,
                page: data?.messages?.currentPage || page,
                limit
            }
            return res.json({ success: true, items: mergedRemoteReactions, meta })
        }

        ensureConv(remoteJid)
        const baseItems = messages[remoteJid] || []
        const decorated = waMessageMetaStore.decorateMessages(
            channel,
            normalizedRemoteJid,
            baseItems,
            actor,
            ({ channel: ch, remoteJid: jid, messageId }) =>
                buildWaMediaProxyUrl(req, { channel: ch, remoteJid: jid, messageId })
        )
        return res.json({ success: true, items: decorated, meta: { page: 1, limit, total: baseItems.length } })
    } catch (error) {
        res.status(500).json({ success: false, error: error.message })
    }
})

app.post('/api/wa-orchestrator/channels/:channel/conversations/:remoteJid/read', async (req, res) => {
    try {
        const channel = parseInt(req.params.channel, 10)
        if (isNaN(channel) || channel < 1 || channel > 9) {
            return res.status(400).json({ success: false, error: 'Invalid channel. Must be between 1 and 9.' })
        }
        if (!USE_EVOLUTION_ORCHESTRATOR) {
            return res.status(400).json({ success: false, error: 'Read sync is only available for Evolution provider.' })
        }
        const normalizedRemoteJid = normalizeWhatsAppJid(req.params.remoteJid)
        if (!normalizedRemoteJid) {
            return res.status(400).json({ success: false, error: 'remoteJid is required' })
        }

        const messageIds = Array.isArray(req.body?.messageIds) ? req.body.messageIds : []
        const providedReadMessages = Array.isArray(req.body?.readMessages) ? req.body.readMessages : []
        const onlyInbound = req.body?.onlyInbound !== false

        let readMessages = providedReadMessages
            .map((entry) => ({
                id: String(entry?.id || '').trim(),
                fromMe: Boolean(entry?.fromMe),
                remoteJid: normalizeWhatsAppJid(entry?.remoteJid || normalizedRemoteJid)
            }))
            .filter((entry) => entry.id && entry.remoteJid)

        if (!readMessages.length && messageIds.length) {
            readMessages = messageIds
                .map((id) => String(id || '').trim())
                .filter(Boolean)
                .map((id) => ({ id, fromMe: false, remoteJid: normalizedRemoteJid }))
        }

        if (!readMessages.length) {
            const data = await evolutionOrchestrator.fetchMessages(channel, normalizedRemoteJid, { limit: 80, page: 1 })
            const records = Array.isArray(data?.messages?.records) ? data.messages.records : []
            readMessages = records
                .map((record) => ({
                    id: String(record?.id || record?.key?.id || '').trim(),
                    fromMe: Boolean(record?.key?.fromMe),
                    remoteJid: normalizeWhatsAppJid(record?.key?.remoteJid || normalizedRemoteJid)
                }))
                .filter((entry) => entry.id && entry.remoteJid)
        }

        if (onlyInbound) {
            readMessages = readMessages.filter((entry) => !entry.fromMe)
        }

        if (!readMessages.length) {
            return res.json({
                success: true,
                skipped: true,
                reason: 'NO_MESSAGES_TO_MARK',
                conversationId: normalizedRemoteJid
            })
        }

        const result = await evolutionOrchestrator.markMessagesAsRead(channel, normalizedRemoteJid, readMessages)
        broadcastWaEvent({
            type: 'conversation_marked_read',
            channel,
            remoteJid: normalizedRemoteJid,
            readCount: readMessages.length
        })
        return res.json({
            success: true,
            conversationId: normalizedRemoteJid,
            readCount: readMessages.length,
            result
        })
    } catch (error) {
        return res.status(500).json({ success: false, error: error.message })
    }
})

// Send text message through orchestrator
app.post('/api/wa-orchestrator/channels/:channel/conversations/:remoteJid/send', async (req, res) => {
    try {
        const channel = parseInt(req.params.channel)
        if (isNaN(channel) || channel < 1 || channel > 9) {
            return res.status(400).json({ success: false, error: 'Invalid channel. Must be between 1 and 9.' })
        }
        const { remoteJid } = req.params
        const { text, replyToMessageId, replyToPreview } = req.body || {}
        if (!text || !String(text).trim()) {
            return res.status(400).json({ success: false, error: 'text is required' })
        }
        const normalizedRemoteJid = normalizeWhatsAppJid(remoteJid)
        const actor = resolveMessageActor(req)
        const replyMeta = replyToMessageId && replyToPreview
            ? {
                messageId: String(replyToMessageId),
                textPreview: String(replyToPreview).slice(0, 240),
                direction: 'inbound'
            }
            : null

        if (USE_EVOLUTION_ORCHESTRATOR) {
            const result = await evolutionOrchestrator.sendText(channel, remoteJid, text, {
                replyToMessageId: replyMeta?.messageId,
                replyToPreview: replyMeta?.textPreview
            })
            const sentMessageId = extractEvolutionMessageIdFromSendResult(result)
            if (sentMessageId && replyMeta) {
                waMessageMetaStore.setReply(channel, normalizedRemoteJid, sentMessageId, replyMeta)
            }
            const responsePayload = {
                success: true,
                result,
                ack: sentMessageId ? {
                    id: sentMessageId,
                    replyTo: replyMeta || undefined,
                    reactions: waMessageMetaStore.listReactions(channel, normalizedRemoteJid, sentMessageId, actor)
                } : undefined
            }
            if (sentMessageId && replyMeta) {
                broadcastWaEvent({
                    type: 'message_metadata_updated',
                    channel,
                    remoteJid: normalizedRemoteJid,
                    messageId: sentMessageId,
                    replyTo: replyMeta
                })
            }
            return res.json(responsePayload)
        }

        const record = addMessage(remoteJid, { direction: 'human', type: 'text', text })
        if (replyMeta) {
            waMessageMetaStore.setReply(channel, normalizedRemoteJid, record.id, replyMeta)
        }
        broadcastNewMessage(record)
        return res.json({
            success: true,
            message: {
                ...record,
                replyTo: replyMeta || undefined,
                reactions: waMessageMetaStore.listReactions(channel, normalizedRemoteJid, record.id, actor)
            }
        })
    } catch (error) {
        res.status(500).json({ success: false, error: error.message })
    }
})

app.post('/api/wa-orchestrator/channels/:channel/conversations/:remoteJid/messages/:messageId/reactions/toggle', async (req, res) => {
    try {
        const channel = parseInt(req.params.channel, 10)
        if (isNaN(channel) || channel < 1 || channel > 9) {
            return res.status(400).json({ success: false, error: 'Invalid channel. Must be between 1 and 9.' })
        }
        const remoteJid = normalizeWhatsAppJid(req.params.remoteJid)
        const messageId = String(req.params.messageId || '').trim()
        const emoji = String(req.body?.emoji || '').trim()
        if (!remoteJid || !messageId || !emoji) {
            return res.status(400).json({ success: false, error: 'channel, remoteJid, messageId and emoji are required' })
        }
        const actor = resolveMessageActor(req)
        const reactions = waMessageMetaStore.toggleReaction(channel, remoteJid, messageId, emoji, actor)
        const payload = {
            type: 'message_reaction_updated',
            channel,
            remoteJid,
            messageId,
            reactions
        }
        broadcastWaEvent(payload)
        return res.json({ success: true, reactions })
    } catch (error) {
        const message = error?.message || 'REACTION_TOGGLE_FAILED'
        const status = message === 'EMOJI_INVALID' || message === 'ACTOR_REQUIRED' ? 400 : 500
        return res.status(status).json({ success: false, error: message })
    }
})

app.post('/api/wa-orchestrator/channels/:channel/conversations/:remoteJid/messages/:messageId/flags/toggle', async (req, res) => {
    try {
        const channel = parseInt(req.params.channel, 10)
        if (isNaN(channel) || channel < 1 || channel > 9) {
            return res.status(400).json({ success: false, error: 'Invalid channel. Must be between 1 and 9.' })
        }
        const remoteJid = normalizeWhatsAppJid(req.params.remoteJid)
        const messageId = String(req.params.messageId || '').trim()
        const field = String(req.body?.field || '').trim().toLowerCase()
        if (!remoteJid || !messageId || !field) {
            return res.status(400).json({ success: false, error: 'channel, remoteJid, messageId and field are required' })
        }
        const flags = waMessageMetaStore.toggleFlag(channel, remoteJid, messageId, field)
        const payload = {
            type: 'message_metadata_updated',
            channel,
            remoteJid,
            messageId,
            ...flags
        }
        broadcastWaEvent(payload)
        return res.json({ success: true, flags })
    } catch (error) {
        const message = error?.message || 'MESSAGE_FLAG_TOGGLE_FAILED'
        const status = message === 'FLAG_INVALID' ? 400 : 500
        return res.status(status).json({ success: false, error: message })
    }
})

app.delete('/api/wa-orchestrator/channels/:channel/conversations/:remoteJid/messages/:messageId', async (req, res) => {
    try {
        const channel = parseInt(req.params.channel, 10)
        if (isNaN(channel) || channel < 1 || channel > 9) {
            return res.status(400).json({ success: false, error: 'Invalid channel. Must be between 1 and 9.' })
        }
        const remoteJid = normalizeWhatsAppJid(req.params.remoteJid)
        const messageId = String(req.params.messageId || '').trim()
        if (!remoteJid || !messageId) {
            return res.status(400).json({ success: false, error: 'channel, remoteJid and messageId are required' })
        }
        waMessageMetaStore.markDeleted(channel, remoteJid, messageId, true)
        broadcastWaEvent({
            type: 'message_deleted',
            channel,
            remoteJid,
            messageId
        })
        return res.json({ success: true, deleted: true })
    } catch (error) {
        return res.status(500).json({ success: false, error: error?.message || 'MESSAGE_DELETE_FAILED' })
    }
})

app.get('/api/wa-orchestrator/media', async (req, res) => {
    try {
        const channel = parseInt(String(req.query.channel || ''), 10)
        const remoteJid = normalizeWhatsAppJid(String(req.query.remoteJid || ''))
        const messageId = String(req.query.messageId || '').trim()
        if (isNaN(channel) || channel < 1 || channel > 9 || !remoteJid || !messageId) {
            return res.status(400).json({ success: false, error: 'channel, remoteJid and messageId are required' })
        }
        if (!ensureWaChannelOwnership(req, res, channel)) return

        let media = waMessageMetaStore.findMedia(channel, remoteJid, messageId)
        let matchedRecord = null

        const findMatchedRecord = async () => {
            if (!USE_EVOLUTION_ORCHESTRATOR) return null
            if (matchedRecord) return matchedRecord
            const pageLimit = 200
            let currentPage = 1
            const maxPages = 5
            while (!matchedRecord && currentPage <= maxPages) {
                const data = await evolutionOrchestrator.fetchMessages(channel, remoteJid, { limit: pageLimit, page: currentPage })
                const records = Array.isArray(data?.messages?.records) ? data.messages.records : []
                matchedRecord = records.find((entry) => {
                    const candidate = entry?.id || entry?.key?.id
                    return String(candidate || '') === messageId
                }) || null
                const totalPages = Number(data?.messages?.pages || 0)
                if (matchedRecord) break
                if (totalPages > 0 && currentPage >= totalPages) break
                currentPage += 1
            }
            if (matchedRecord) {
                const extracted = extractEvolutionMessageMeta(matchedRecord?.message)
                if (extracted?.mediaUrl) {
                    media = waMessageMetaStore.setMedia(channel, remoteJid, messageId, {
                        type: extracted.mediaType || 'unknown',
                        url: extracted.mediaUrl,
                        mimeType: extracted.mimeType,
                        fileName: extracted.fileName,
                        durationSec: extracted.durationSec,
                        sizeBytes: extracted.sizeBytes
                    }) || media
                }
            }
            return matchedRecord
        }

        const tryEvolutionFallback = async () => {
            if (!USE_EVOLUTION_ORCHESTRATOR) return null
            try {
                const record = await findMatchedRecord()
                if (!record?.key?.id) return null
                const payload = await evolutionOrchestrator.getBase64FromMediaMessage(channel, {
                    key: record.key,
                    message: record.message
                })
                const base64 = String(payload?.base64 || '').trim()
                if (!base64) return null
                const mimeType = String(payload?.mimetype || media?.mimeType || 'application/octet-stream')
                const fileName = String(payload?.fileName || media?.fileName || `media-${messageId}`).replace(/[^\w.\-]/g, '_')
                const buffer = Buffer.from(base64, 'base64')
                if (!buffer.length) return null
                return { buffer, mimeType, fileName }
            } catch (error) {
                if (shouldLog('warn')) {
                    console.warn('[WA_MEDIA] Evolution base64 fallback failed', {
                        channel,
                        remoteJid,
                        messageId,
                        error: error?.message || String(error)
                    })
                }
                return null
            }
        }

        let buffer = null
        let mimeType = ''
        let fileName = ''

        if (media?.url) {
            try {
                const controller = new AbortController()
                const timeoutId = setTimeout(() => controller.abort(), 12000)
                let upstream
                try {
                    upstream = await fetch(media.url, { signal: controller.signal })
                } finally {
                    clearTimeout(timeoutId)
                }
                if (upstream?.ok) {
                    mimeType = media.mimeType || upstream.headers.get('content-type') || 'application/octet-stream'
                    fileName = String(media.fileName || `media-${messageId}`).replace(/[^\w.\-]/g, '_')
                    buffer = Buffer.from(await upstream.arrayBuffer())
                    if (!mediaBufferLooksDecoded(buffer, mimeType)) {
                        if (shouldLog('warn')) {
                            console.warn('[WA_MEDIA] Upstream returned undecodable payload, trying evolution fallback', {
                                channel,
                                remoteJid,
                                messageId,
                                mimeType,
                                sourceUrl: media.url
                            })
                        }
                        buffer = null
                    }
                }
            } catch (error) {
                if (shouldLog('warn')) {
                    console.warn('[WA_MEDIA] Upstream fetch failed, trying evolution fallback', {
                        channel,
                        remoteJid,
                        messageId,
                        error: error?.message || String(error)
                    })
                }
            }
        }

        if (!buffer || !buffer.length) {
            const fallback = await tryEvolutionFallback()
            if (fallback) {
                buffer = fallback.buffer
                mimeType = fallback.mimeType
                fileName = fallback.fileName
            }
        }

        if (!buffer || !buffer.length) {
            return res.status(404).json({ success: false, error: 'MEDIA_NOT_FOUND' })
        }

        res.setHeader('Content-Type', mimeType)
        res.setHeader('Cache-Control', 'private, max-age=60')
        res.setHeader('Content-Disposition', `inline; filename="${fileName}"`)
        return res.status(200).send(buffer)
    } catch (error) {
        if (error?.name === 'AbortError') {
            return res.status(504).json({ success: false, error: 'MEDIA_TIMEOUT' })
        }
        if (shouldLog('error')) {
            console.error('[WA_MEDIA] Proxy failed', {
                error: error?.message || String(error)
            })
        }
        return res.status(500).json({ success: false, error: 'MEDIA_PROXY_FAILED' })
    }
})

// Configure webhook for evolution channel (manual sync)
app.post('/api/wa-orchestrator/channels/:channel/webhook', async (req, res) => {
    try {
        const channel = parseInt(req.params.channel)
        if (isNaN(channel) || channel < 1 || channel > 9) {
            return res.status(400).json({ success: false, error: 'Invalid channel. Must be between 1 and 9.' })
        }
        if (!USE_EVOLUTION_ORCHESTRATOR) {
            return res.status(400).json({ success: false, error: 'Webhook sync is only available for Evolution provider.' })
        }
        const webhookUrl = `${resolveCrmPublicUrl(req)}/api/wa-orchestrator/webhook`
        const webhookHeaders = resolveWebhookHeaders()
        const result = await evolutionOrchestrator.setWebhook(channel, webhookUrl, {
            events: ['MESSAGES_UPSERT', 'MESSAGES_UPDATE', 'CHATS_UPSERT', 'CHATS_UPDATE', 'CHATS_SET'],
            headers: webhookHeaders,
            byEvents: false
        })
        res.json({ success: true, result, webhookUrl })
    } catch (error) {
        res.status(500).json({ success: false, error: error.message })
    }
})

app.use('/api/wa-orchestrator/instances', (req, res, next) => {
    if (!WA_CHANNEL_OWNER_ENFORCED) return next()
    const path = String(req.path || '').trim()
    const isListRead = (req.method || 'GET').toUpperCase() === 'GET' && (path === '' || path === '/')
    if (isListRead) return next()
    return res.status(403).json({
        success: false,
        error: 'INSTANCES_ENDPOINT_DISABLED',
        hint: 'Use os endpoints /api/wa-orchestrator/channels/* com isolamento por usuário.'
    })
})

// List all instances
app.get('/api/wa-orchestrator/instances', async (req, res) => {
    try {
        if (USE_EVOLUTION_ORCHESTRATOR) {
            const status = await evolutionOrchestrator.getStatus()
            const scopedChannels = scopeWaChannelsForActor(status.channels, req.waActor)
            return res.json({ success: true, instances: scopedChannels })
        }
        const status = whatsappOrchestrator.getStatus()
        const scopedInstances = scopeWaChannelsForActor(status.instances, req.waActor)
        res.json({ success: true, instances: scopedInstances })
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
        if (USE_EVOLUTION_ORCHESTRATOR) {
            const status = await evolutionOrchestrator.getStatus()
            const scopedChannels = scopeWaChannelsForActor(status.channels, req.waActor)
            const free = scopedChannels.find((item) => String(item?.status || '').toLowerCase() === 'free')
            if (free) {
                return res.json({
                    success: true,
                    port: free.port || 3001,
                    channel: free.channel,
                    message: `Channel ${free.channel} is available`
                })
            }
            return res.status(409).json({
                success: false,
                error: 'No free ports available',
                status: {
                    totalChannels: scopedChannels.length,
                    availableChannels: scopedChannels.filter((item) => item.status === 'free').length,
                    freeInstances: scopedChannels.filter((item) => item.status === 'free').length,
                    connectedInstances: scopedChannels.filter((item) => item.status === 'connected').length,
                    errorInstances: scopedChannels.filter((item) => item.status === 'error').length
                }
            })
        }

        const status = whatsappOrchestrator.getStatus()
        const scopedChannels = scopeWaChannelsForActor(status.channels, req.waActor)
        const free = scopedChannels.find((item) => String(item?.status || '').toLowerCase() === 'free')
        if (free) {
            return res.json({
                success: true,
                port: free.port || 3001,
                channel: free.channel,
                message: `Channel ${free.channel} is available`
            })
        }
        return res.status(409).json({
            success: false,
            error: 'No free ports available',
            status: {
                totalChannels: scopedChannels.length,
                availableChannels: scopedChannels.filter((item) => item.status === 'free').length,
                freeInstances: scopedChannels.filter((item) => item.status === 'free').length,
                connectedInstances: scopedChannels.filter((item) => item.status === 'connected').length,
                errorInstances: scopedChannels.filter((item) => item.status === 'error').length
            }
        })
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
        const status = USE_EVOLUTION_ORCHESTRATOR ? await evolutionOrchestrator.getStatus() : whatsappOrchestrator.getStatus()
        if (USE_EVOLUTION_ORCHESTRATOR) {
            maybeAutoBootstrapSync(status)
        }
        const scopedChannels = scopeWaChannelsForActor(status.channels, req.waActor)
        const freeChannels = scopedChannels.filter((item) => String(item?.status || '').toLowerCase() === 'free').map((item) => item.channel)
        const connectedCount = scopedChannels.filter((item) => String(item?.status || '').toLowerCase() === 'connected').length
        const errorCount = scopedChannels.filter((item) => String(item?.status || '').toLowerCase() === 'error').length
        const startingCount = scopedChannels.filter((item) => {
            const current = String(item?.status || '').toLowerCase()
            return current === 'starting' || current === 'qr_pending'
        }).length
        res.json({
            success: true,
            channels: scopedChannels,
            bootstrapSync: USE_EVOLUTION_ORCHESTRATOR
                ? Object.fromEntries(scopedChannels.map((item) => [String(item.channel), summarizeWaBootstrapSync(item.channel)]))
                : null,
            summary: {
                totalChannels: scopedChannels.length,
                availableChannels: freeChannels.length,
                freeInstances: freeChannels.length,
                connectedInstances: connectedCount,
                errorInstances: errorCount,
                startingInstances: startingCount
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
        const { name } = req.body || {}
        const actor = getWaActorFromReq(req)

        // Validate channel range
        if (isNaN(channel) || channel < 1 || channel > 9) {
            return res.status(400).json({
                success: false,
                error: 'Invalid channel. Must be between 1 and 9.'
            })
        }

        const currentOwner = getWaChannelOwner(channel)
        if (WA_CHANNEL_OWNER_ENFORCED && currentOwner?.ownerKey && currentOwner.ownerKey !== actor?.key) {
            let statusLabel = ''
            try {
                if (USE_EVOLUTION_ORCHESTRATOR) {
                    const current = await evolutionOrchestrator.getChannelStatus(channel).catch(() => null)
                    statusLabel = String(current?.status || '').toLowerCase()
                } else {
                    const current = await whatsappOrchestrator.getInstanceStatus(portForChannel(channel)).catch(() => null)
                    statusLabel = String(current?.status || '').toLowerCase()
                }
            } catch { /* ignore */ }
            if (isWaChannelIdleStatus(statusLabel)) {
                clearWaChannelOwner(channel, 'channel idle before start')
            } else {
                return res.status(403).json({
                    success: false,
                    error: 'CHANNEL_FORBIDDEN',
                    channel,
                    hint: 'Este canal do WhatsApp está vinculado a outro usuário do CRM.'
                })
            }
        }

        if (USE_EVOLUTION_ORCHESTRATOR) {
            const result = await evolutionOrchestrator.startChannel(channel, name)
            setWaChannelOwner(channel, actor)
            if (DEBUG_QR) {
                const qrValue = typeof result?.qr === 'string' ? result.qr : ''
                console.log('[WA_QR_DEBUG] route:start_result', {
                    channel,
                    status: result?.instance?.status || null,
                    hasQr: !!qrValue,
                    qrType: qrValue.startsWith('data:image') ? 'image-data-url' : (qrValue ? 'raw-text' : null),
                    qrLength: qrValue.length
                })
            }
            let webhookWarning = null
            try {
                const webhookUrl = `${resolveCrmPublicUrl(req)}/api/wa-orchestrator/webhook`
                const webhookHeaders = resolveWebhookHeaders()
                await evolutionOrchestrator.setWebhook(channel, webhookUrl, {
                    events: ['MESSAGES_UPSERT', 'MESSAGES_UPDATE', 'CHATS_UPSERT', 'CHATS_UPDATE', 'CHATS_SET'],
                    headers: webhookHeaders,
                    byEvents: false
                })
            } catch (err) {
                webhookWarning = err?.message || 'Falha ao configurar webhook do Evolution.'
            }
            if (String(result?.instance?.status || '').toLowerCase() === 'connected') {
                void triggerEvolutionBootstrapSync(channel, { force: false, reason: 'channel-start' })
            }
            return res.json({
                success: true,
                instance: result.instance,
                qr: result.qr || null,
                channel: result.instance?.channel || channel,
                port: result.instance?.port || 3001,
                suggestions: null,
                webhookWarning
            })
        }

        const port = portForChannel(channel)
        const result = await whatsappOrchestrator.startInstance(port, { name })

        if (result.success) {
            setWaChannelOwner(channel, actor)
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

        if (USE_EVOLUTION_ORCHESTRATOR) {
            const result = await evolutionOrchestrator.getChannelStatus(channel)
            if (result.error) {
                return res.status(404).json({
                    success: false,
                    error: result.error,
                    channel
                })
            }
            return res.json({
                success: true,
                status: result.status,
                channel: result.channel || channel,
                port: result.port || 3001,
                instance: result.instance || null,
                bootstrapSync: summarizeWaBootstrapSync(channel),
                liveData: null,
                warning: null
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

        if (USE_EVOLUTION_ORCHESTRATOR) {
            const result = await evolutionOrchestrator.getChannelQR(channel)
            if (result?.qr) {
                return res.json({
                    success: true,
                    qr: result.qr,
                    status: result.status || 'qr_pending',
                    channel,
                    port: result.port || 3001,
                    cached: false,
                    generated: true,
                    message: null
                })
            }
            if (DEBUG_QR) {
                console.warn('[WA_QR_DEBUG] route:qr_not_available', {
                    channel,
                    status: result?.status || null,
                    hasQr: !!result?.qr
                })
            }
            return res.status(404).json({
                success: false,
                error: 'QR not available',
                channel,
                port: result?.port || 3001
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

        if (USE_EVOLUTION_ORCHESTRATOR) {
            await evolutionOrchestrator.stopChannel(channel)
            clearWaChannelOwner(channel, 'channel stopped')
            return sendResponse(200, {
                success: true,
                channel,
                port: 3001,
                message: 'Channel stopped successfully'
            })
        }

        const port = portForChannel(channel)
        const result = await whatsappOrchestrator.stopInstance(port)

        if (result.success) {
            clearWaChannelOwner(channel, 'channel stopped')
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

        if (USE_EVOLUTION_ORCHESTRATOR) {
            await evolutionOrchestrator.restartChannel(channel)
            setWaChannelOwner(channel, getWaActorFromReq(req))
            return sendResponse(200, {
                success: true,
                instance: null,
                channel,
                port: 3001,
                suggestions: null
            })
        }

        const port = portForChannel(channel)
        const result = await whatsappOrchestrator.restartInstance(port)

        if (result.success) {
            setWaChannelOwner(channel, getWaActorFromReq(req))
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

        if (USE_EVOLUTION_ORCHESTRATOR) {
            return res.status(501).json({
                success: false,
                error: 'Metadata updates are not supported for Evolution provider'
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
        if (USE_EVOLUTION_ORCHESTRATOR) {
            const status = await evolutionOrchestrator.getStatus()
            const scopedChannels = scopeWaChannelsForActor(status.channels, req.waActor)
            const free = scopedChannels.find((c) => c.status === 'free')
            if (free) {
                return res.json({
                    success: true,
                    channel: free.channel,
                    port: free.port || 3001,
                    message: `Channel ${free.channel} is available`
                })
            }
            return res.status(409).json({
                success: false,
                error: 'No available channels',
                status: {
                    totalChannels: scopedChannels.length,
                    availableChannels: scopedChannels.filter((c) => c.status === 'free').length,
                    freeInstances: scopedChannels.filter((c) => c.status === 'free').length,
                    connectedInstances: scopedChannels.filter((c) => c.status === 'connected').length,
                    errorInstances: scopedChannels.filter((c) => c.status === 'error').length
                }
            })
        }

        const channel = whatsappOrchestrator.getNextAvailableChannel()
        if (channel && canWaActorAccessChannel(req.waActor, channel)) {
            const port = portForChannel(channel)
            res.json({
                success: true,
                channel,
                port,
                message: `Channel ${channel} (port ${port}) is available`
            })
        } else {
            const status = whatsappOrchestrator.getStatus()
            const scopedChannels = scopeWaChannelsForActor(status.channels, req.waActor)
            res.status(409).json({
                success: false,
                error: 'No available channels',
                status: {
                    totalChannels: scopedChannels.length,
                    availableChannels: scopedChannels.filter((item) => item.status === 'free').length,
                    freeInstances: scopedChannels.filter((item) => item.status === 'free').length,
                    connectedInstances: scopedChannels.filter((item) => item.status === 'connected').length,
                    errorInstances: scopedChannels.filter((item) => item.status === 'error').length
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

    // Don't serve the SPA shell for paths that look like files (prevents HTML being served for JS chunks).
    if (path.extname(req.path || '')) {
        return res.status(404).end()
    }

    // For all other routes, serve the React app
    res.setHeader('Cache-Control', 'no-store')
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
