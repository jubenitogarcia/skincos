import http from 'node:http'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { timingSafeEqual } from 'node:crypto'
import express from 'express'
import { rateLimit } from 'express-rate-limit'
import { createAtendimentoStore } from './atendimento/store.js'
import { createAtendimentoRouter } from './atendimento/routes.js'
import { readIsolatedAtendimentoRuntimeControl } from './atendimento/isolatedRuntimeControl.js'
import { normalizeAtendimentoSurface } from './atendimento/surfaceProfile.js'
import { createPersistentReplayGuard } from './atendimento/replayProtection.js'
import { createReplayProtectedActorVerifier } from './atendimento/isolatedActorAuth.js'
import { installGracefulShutdown } from './gracefulShutdown.js'

const LOOPBACK_ADDRESSES = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1'])
const READ_METHODS = new Set(['GET', 'HEAD', 'OPTIONS'])
const INTERNAL_RATE_LIMIT_WINDOW_MS = 60_000
const INTERNAL_RATE_LIMIT_MAX_REQUESTS = 60

function safeEqual(left, right) {
    const a = Buffer.from(String(left || ''))
    const b = Buffer.from(String(right || ''))
    if (a.length !== b.length) return false
    try { return timingSafeEqual(a, b) } catch { return false }
}

function isLoopback(req) {
    return LOOPBACK_ADDRESSES.has(String(req?.socket?.remoteAddress || '').trim().toLowerCase())
}

function publicControl(control) {
    return {
        configured: control?.configured === true,
        ready: control?.ready === true,
        state: ['disabled', 'maintenance', 'active', 'canary'].includes(String(control?.state || ''))
            ? String(control.state)
            : 'disabled',
        releaseMatched: control?.releaseMatched === true,
        ...(control?.releaseMatched === true && /^[0-9a-f]{40}$/.test(String(control?.releaseSha || ''))
            ? { releaseSha: String(control.releaseSha) }
            : {}),
        ...(normalizeAtendimentoSurface(control?.surface) ? { surface: normalizeAtendimentoSurface(control.surface) } : {}),
        readOnly: control?.readOnly === true,
        syntheticOnly: control?.syntheticOnly === true,
    }
}

function requestId() {
    return globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(16).slice(2)}`
}

function publicFailure(res, status, error, headers = {}) {
    res.status(status).set('cache-control', 'no-store')
    for (const [key, value] of Object.entries(headers)) res.set(key, value)
    return res.json({ ok: false, error })
}

function safeReadControl(reader) {
    try {
        const control = reader()
        return control && typeof control === 'object'
            ? control
            : { configured: false, ready: false, state: 'disabled', releaseMatched: false }
    } catch {
        // Liveness must not depend on a control-file read succeeding.  The
        // protected routes and readiness remain fail-closed below.
        return { configured: false, ready: false, state: 'disabled', releaseMatched: false }
    }
}

function positivePort(value) {
    const port = Number(value)
    return Number.isInteger(port) && port >= 0 && port <= 65535 ? port : null
}

function safeRuntimeMetricSnapshot(metrics) {
    return {
        startedAt: metrics.startedAt,
        requests: metrics.requests,
        responses5xx: metrics.responses5xx,
        actorRejects: metrics.actorRejects,
        replayRejects: metrics.replayRejects,
        readinessChecks: metrics.readinessChecks,
        readinessFailures: metrics.readinessFailures,
    }
}

/**
 * Creates the process boundary used by crm-atendimento-*.service.  It never
 * imports server.js, Harmonia, WhatsApp, Ponto, Caixa, a worker, or a shell
 * launcher.  A missing control file, database or replay ledger removes only
 * readiness and protected data routes; liveness remains available.
 */
export function createIsolatedAtendimentoRuntime({
    environment = process.env,
    store = null,
    replayGuard = null,
    controlReader = null,
    logger = console,
    clock = () => Date.now(),
} = {}) {
    const env = environment || {}
    const runtimeReleaseSha = String(env.ATENDIMENTO_RUNTIME_RELEASE_SHA || '').trim().toLowerCase()
    const controlFile = String(env.CRM_MODULE_CONTROL_FILE || '').trim()
    const configuredSurface = String(env.CRM_ATENDIMENTO_SURFACE || '').trim()
    const legacyClientesOnly = String(env.CRM_ATENDIMENTO_CLIENTES_ONLY || '').trim().toLowerCase() === 'true'
    const runtimeSurface = normalizeAtendimentoSurface(configuredSurface)
        || (!configuredSurface && legacyClientesOnly ? 'clientes' : null)
    const readinessToken = String(env.ATENDIMENTO_READINESS_TOKEN || '').trim()
    const actorHmacKey = String(env.ATENDIMENTO_ACTOR_HMAC_KEY || '').trim()
    const appStore = store || createAtendimentoStore({
          databaseUrl: env.DATABASE_URL,
          schemaManaged: String(env.CRM_ATENDIMENTO_SCHEMA_MANAGED || '').trim().toLowerCase() === 'true',
          commercialSourceDeferred: String(env.CRM_ATENDIMENTO_COMMERCIAL_SOURCE_DEFERRED || '').trim().toLowerCase() === 'true',
          expectedDatabase: env.CRM_ATENDIMENTO_EXPECTED_DATABASE,
        expectedDatabaseUser: env.CRM_ATENDIMENTO_EXPECTED_DATABASE_USER,
    })
    const guard = replayGuard || createPersistentReplayGuard({
        statePath: String(env.ATENDIMENTO_REPLAY_STATE_FILE || '').trim(),
        clock,
    })
    const metrics = {
        startedAt: new Date(Number(clock())).toISOString(),
        requests: 0,
        responses5xx: 0,
        actorRejects: 0,
        replayRejects: 0,
        readinessChecks: 0,
        readinessFailures: 0,
    }
    const readControl = controlReader || (() => runtimeSurface
        ? readIsolatedAtendimentoRuntimeControl({
            filePath: controlFile,
            releaseSha: runtimeReleaseSha,
            expectedSurface: runtimeSurface,
        })
        : {
            configured: false,
            ready: false,
            state: 'disabled',
            releaseMatched: false,
            surface: null,
            reason: 'RUNTIME_SURFACE_INVALID',
        })
    const actorVerifier = actorHmacKey
        ? createReplayProtectedActorVerifier({
            actorHmacKey,
            replayGuard: guard,
            clock,
            onRejected: (reason) => {
                metrics.actorRejects += 1
                if (reason === 'replayed') metrics.replayRejects += 1
            },
        })
        : null

    const app = express()
    app.disable('x-powered-by')
    // Readiness and metrics are loopback-only and token-protected, but they
    // still authenticate a caller. Apply an independent, fixed limiter so a
    // compromised local sidecar cannot turn those dependency checks into a
    // tight resource-exhaustion loop. The value is deliberately not runtime
    // configurable through a unit, GitHub Environment, or shell variable.
    const limitInternal = rateLimit({
        windowMs: INTERNAL_RATE_LIMIT_WINDOW_MS,
        limit: INTERNAL_RATE_LIMIT_MAX_REQUESTS,
        standardHeaders: 'draft-8',
        legacyHeaders: false,
        message: { ok: false, error: 'RATE_LIMITED' },
    })
    app.use((req, res, next) => {
        const id = requestId()
        const startedAt = Number(clock())
        res.set('x-request-id', id)
        res.set('cache-control', 'no-store')
        res.on('finish', () => {
            metrics.requests += 1
            if (res.statusCode >= 500) metrics.responses5xx += 1
            try {
                logger?.log?.(JSON.stringify({
                    component: 'crm-atendimento-runtime',
                    event: 'request_completed',
                    method: String(req.method || 'GET').toUpperCase(),
                    // Do not include paths, raw query strings, peer addresses,
                    // actor fields, or headers in operational logs.  A path may
                    // itself contain an identity UUID or a future PII-bearing
                    // lookup value.
                    status: res.statusCode,
                    durationMs: Math.max(0, Number(clock()) - startedAt),
                }))
            } catch { /* observability never changes request behavior */ }
        })
        next()
    })

    const publicHealth = (_req, res) => {
        const control = safeReadControl(readControl)
        return res.status(200).json({
            ok: true,
            service: 'crm-atendimento-runtime',
            readOnlyRuntime: true,
            control: publicControl(control),
        })
    }
    app.get('/health', publicHealth)
    app.get('/api/atendimento/health', publicHealth)

    const internalAuthorized = (req) => {
        if (!isLoopback(req) || !readinessToken) return false
        return safeEqual(String(req.headers['x-atendimento-readiness-token'] || ''), readinessToken)
    }
    const checkInternal = (req, res) => {
        if (internalAuthorized(req)) return true
        publicFailure(res, 404, 'NOT_FOUND')
        return false
    }

    app.get('/internal/readiness', limitInternal, async (req, res) => {
        if (!checkInternal(req, res)) return
        metrics.readinessChecks += 1
        const control = safeReadControl(readControl)
        const replay = guard.getStatus?.() || { ready: false }
        if (!control.ready || control.releaseMatched !== true || replay.ready !== true) {
            metrics.readinessFailures += 1
            return publicFailure(res, 503, 'DEPENDENCY_UNAVAILABLE')
        }
        try {
            const readiness = await appStore.readiness()
            if (readiness?.ok !== true) {
                metrics.readinessFailures += 1
                return publicFailure(res, 503, 'DEPENDENCY_UNAVAILABLE')
            }
            return res.status(200).json({
                ok: true,
                databaseReachable: readiness.databaseReachable === true,
                databaseIdentity: readiness.databaseIdentity === true,
                schemaReady: readiness.schemaReady === true,
                commercialSourceDeferred: readiness.commercialSourceDeferred === true,
                sourceOperationsReady: readiness.sourceOperationsReady === true,
                clinicalApprovalReady: readiness.clinicalApprovalReady === true,
                transactionReadOnly: readiness.transactionReadOnly === true,
                migrationRegistryReadable: readiness.migrationRegistryReadable === true,
                persistentWritePrivilegesBlocked: readiness.persistentWritePrivilegesBlocked === true,
                persistentPiiReadPrivilegesBlocked: readiness.persistentPiiReadPrivilegesBlocked === true,
                replayProtectionReady: replay.ready === true,
            })
        } catch {
            metrics.readinessFailures += 1
            return publicFailure(res, 503, 'DEPENDENCY_UNAVAILABLE')
        }
    })

    app.get('/internal/metrics', limitInternal, (req, res) => {
        if (!checkInternal(req, res)) return
        return res.status(200).json({ ok: true, metrics: safeRuntimeMetricSnapshot(metrics) })
    })

    // This guard is intentionally before the reusable Atendimento router:
    // future routes cannot make a commercial write in this runtime simply by
    // missing a route-level read-only check.
    app.use('/api/atendimento', (req, res, next) => {
        const control = safeReadControl(readControl)
        const replay = guard.getStatus?.() || { ready: false }
        if (!control.ready || control.releaseMatched !== true || replay.ready !== true || !actorVerifier) {
            return publicFailure(res, 503, 'RUNTIME_NOT_READY')
        }
        if (!READ_METHODS.has(String(req.method || 'GET').toUpperCase())) {
            return publicFailure(res, 405, 'READ_ONLY_RUNTIME', { allow: 'GET, HEAD, OPTIONS' })
        }
        return next()
    })
    // The shared router's commercial reads still depend on source-system
    // phone/name data. This isolated runtime deliberately holds direct Caixa
    // and Harmonia reads, so block the whole mounted surface before it can
    // become a permission error or pressure a broad PII grant.
    app.use('/api/atendimento/commercial', (_req, res) => publicFailure(res, 503, 'COMMERCIAL_READS_DISABLED'))
    app.use('/api/atendimento', createAtendimentoRouter({
        store: appStore,
        actorHmacKey,
        verifySignedActor: actorVerifier || (() => null),
        surface: runtimeSurface,
    }))

    // No SPA fallback, generic health surface, or cross-module endpoint is
    // mounted in the isolated runtime.
    app.use((_req, res) => publicFailure(res, 404, 'NOT_FOUND'))

    return {
        app,
        store: appStore,
        replayGuard: guard,
        metrics,
        readControl,
        async start({ host = String(env.CRM_API_HOST || '127.0.0.1'), port = positivePort(env.CRM_API_PORT) } = {}) {
            if (!['127.0.0.1', '::1', 'localhost'].includes(host) || port === null) {
                throw new Error('ATENDIMENTO_RUNTIME_BIND_INVALID')
            }
            await guard.start?.()
            const server = http.createServer(app)
            await new Promise((resolve, reject) => {
                server.once('error', reject)
                server.listen(port, host, () => {
                    server.off('error', reject)
                    resolve()
                })
            })
            const address = server.address()
            try {
                logger?.log?.(JSON.stringify({
                    component: 'crm-atendimento-runtime',
                    event: 'listening',
                    host,
                    port: typeof address === 'object' && address ? address.port : port,
                    readOnly: true,
                }))
            } catch { /* no-op */ }
            return server
        },
    }
}

export async function startIsolatedAtendimentoRuntime(options = {}) {
    const runtime = createIsolatedAtendimentoRuntime(options)
    const server = await runtime.start()
    installGracefulShutdown({
        server,
        component: 'crm-atendimento-runtime',
        onClosed: async () => {
            await runtime.store?.close?.()
            await runtime.replayGuard?.close?.()
        },
    })
    return { ...runtime, server }
}

const thisFile = fileURLToPath(import.meta.url)
if (process.argv[1] && path.resolve(process.argv[1]) === thisFile) {
    startIsolatedAtendimentoRuntime().catch((error) => {
        // The message is intentionally a stable code only.  It must not leak a
        // connection string, control-file path, or secret into journald.
        console.error(JSON.stringify({ component: 'crm-atendimento-runtime', event: 'startup_failed', code: String(error?.code || 'STARTUP_FAILED') }))
        process.exitCode = 1
    })
}

export const __testables = { isLoopback, publicControl, positivePort, safeReadControl, safeRuntimeMetricSnapshot }
