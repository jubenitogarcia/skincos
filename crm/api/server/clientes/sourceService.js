import { createPgPool } from '../harmonia/store/pg.js'
import { CLIENTES_SOURCE_CATALOG } from './sourceCatalog.js'
import { createClientesSourceAdapters } from './sourceAdapters.js'
import { createClientesSourceOperationsStore } from './sourceOperationsStore.js'
import { createClientesSourceRunner } from './sourceOperations.js'
import { createClientesSourceHealthServer } from './sourceHealthServer.js'
import { CLIENTES_SOURCE_JOB_CATALOG } from './sourceJobs.js'

const ALLOWED_TARGETS = new Set(['local', 'staging'])
const LOOPBACK_HOSTS = new Set(['127.0.0.1', '::1'])

function truthy(value) {
    return ['1', 'true', 'yes', 'on'].includes(String(value || '').trim().toLowerCase())
}

export function isClientesSourceRuntimeDestinationSafe(databaseUrl, target) {
    const raw = String(databaseUrl || '').trim()
    if (!raw || !ALLOWED_TARGETS.has(target)) return false
    try {
        const url = new URL(raw)
        const database = decodeURIComponent(url.pathname.replace(/^\//, ''))
        if (target === 'local') {
            const socket = url.searchParams.get('host') || ''
            return url.protocol === 'postgresql:' && database === 'skincos_crm_local' &&
                (!url.hostname || LOOPBACK_HOSTS.has(url.hostname) || socket.startsWith('/var/run/postgresql'))
        }
        const user = decodeURIComponent(url.username || '')
        return url.protocol === 'postgresql:' && database === 'skincos_staging' &&
            LOOPBACK_HOSTS.has(url.hostname) && ['skincos_staging_crm_app', 'skincos_staging_migrator_login'].includes(user) &&
            (url.searchParams.get('sslmode') || '') === 'require'
    } catch {
        return false
    }
}

function initialStatus({ target, mode, enabled, applyConfirmed, databaseUrl }) {
    return {
        service: 'crm-clientes-source-operations',
        target,
        mode,
        enabled,
        applyConfirmed,
        applyGuard: mode === 'apply' && !applyConfirmed ? 'dry_run_until_explicit_confirmation' : null,
        running: false,
        ready: false,
        startedAt: null,
        stoppedAt: null,
        lastError: null,
        database: { configured: Boolean(databaseUrl), reachable: false, missing: [] },
        queues: { type: 'database-backed', ready: false },
        dependencies: { ready: false, missing: [] },
        sources: { total: CLIENTES_SOURCE_CATALOG.length, running: 0 },
        jobs: {
            catalog: CLIENTES_SOURCE_JOB_CATALOG.map((job) => ({ id: job.id, type: job.type, sourceId: job.sourceId || null, cadenceMs: job.cadenceMs })),
            qualityRefresh: { lastRunAt: null, lastErrorAt: null },
        },
    }
}

export function createClientesSourceOperationsService({
    databaseUrl = process.env.DATABASE_URL,
    target = String(process.env.CLIENTES_SOURCE_OPERATIONS_TARGET || 'local').trim().toLowerCase(),
    host = process.env.CRM_CLIENTES_SOURCE_OPS_HOST || '127.0.0.1',
    port = Number.parseInt(process.env.CRM_CLIENTES_SOURCE_OPS_PORT || '8103', 10),
    enabled = truthy(process.env.CRM_CLIENTES_SOURCE_OPS_ENABLED),
    mode = String(process.env.CRM_CLIENTES_SOURCE_OPS_MODE || 'dry-run').trim().toLowerCase(),
    applyConfirmed = truthy(process.env.CRM_CLIENTES_SOURCE_APPLY_CONFIRMED),
    catalog = CLIENTES_SOURCE_CATALOG,
    pool: providedPool = null,
    store: providedStore = null,
    adapters: providedAdapters = null,
    runner: providedRunner = null,
    healthServer: providedHealthServer = null,
    readers = {},
    clock = () => new Date(),
} = {}) {
    if (!ALLOWED_TARGETS.has(target)) throw new Error('CLIENTES_SOURCE_OPERATIONS_TARGET_INVALID')
    if (!LOOPBACK_HOSTS.has(String(host))) throw new Error('CLIENTES_SOURCE_OPERATIONS_HOST_NOT_LOOPBACK')
    if (!['dry-run', 'apply'].includes(mode)) throw new Error('CLIENTES_SOURCE_OPERATIONS_MODE_INVALID')
    if (databaseUrl && !isClientesSourceRuntimeDestinationSafe(databaseUrl, target)) throw new Error('CLIENTES_SOURCE_OPERATIONS_DATABASE_TARGET_UNSAFE')

    const pool = providedPool || createPgPool(databaseUrl)
    const ownedPool = !providedPool && Boolean(pool)
    const store = providedStore || (pool ? createClientesSourceOperationsStore({ pool, catalog, clock }) : null)
    const adapters = providedAdapters || (pool ? createClientesSourceAdapters({ pool, databaseUrl, target, readers }) : {})
    const effectiveApply = mode === 'apply' && applyConfirmed === true
    const runner = providedRunner || (store ? createClientesSourceRunner({ catalog, adapters, store, clock, applyEnabled: effectiveApply, target }) : null)
    const status = initialStatus({ target, mode: effectiveApply ? 'apply' : 'dry-run', enabled, applyConfirmed, databaseUrl })
    const health = providedHealthServer || createClientesSourceHealthServer({
        host,
        port,
        clock,
        getHealth: () => ({
            status: 'ok',
            running: status.running,
            target: status.target,
            mode: status.mode,
            enabled: status.enabled,
            ready: status.ready,
        }),
        // Reconcile on every readiness probe so a controlled database outage is
        // reflected immediately instead of waiting for the periodic timer.
        getReadiness: async () => {
            if (running) await reconcile()
            return readiness()
        },
        getOperationalView: async () => {
            if (!store?.getOperationalView) throw new Error('SOURCE_STORE_UNAVAILABLE')
            return store.getOperationalView({ now: clock() })
        },
    })

    let running = false
    let reconcileTimer = null
    let qualityTimer = null
    let reconciling = null

    async function checkDependencies() {
        if (!store?.dependencyStatus) {
            status.database.reachable = false
            status.database.missing = ['source_store']
            status.dependencies = { ready: false, missing: ['source_store'] }
            status.queues = { type: 'database-backed', ready: false }
            return status.dependencies
        }
        try {
            const dependency = await store.dependencyStatus()
            status.database.reachable = dependency.ready === true
            status.database.missing = dependency.missing || []
            status.dependencies = { ready: dependency.ready === true, missing: dependency.missing || [] }
            status.queues = { type: 'database-backed', ready: dependency.ready === true }
            return status.dependencies
        } catch {
            status.database.reachable = false
            status.database.missing = ['database']
            status.dependencies = { ready: false, missing: ['database'] }
            status.queues = { type: 'database-backed', ready: false }
            return status.dependencies
        }
    }

    async function reconcile() {
        if (reconciling) return reconciling
        reconciling = (async () => {
            const dependencies = await checkDependencies()
            if (running && enabled && dependencies.ready && runner && !runner.isRunning()) {
                try { await runner.start({ runImmediately: true }) } catch (error) { status.lastError = 'SOURCE_RUNNER_START_FAILED' }
            }
            if (running && (!enabled || !dependencies.ready) && runner?.isRunning()) {
                try { await runner.stop() } catch { status.lastError = 'SOURCE_RUNNER_STOP_FAILED' }
            }
            status.ready = running && enabled && dependencies.ready && Boolean(runner?.isRunning())
            if (runner?.getActiveSources) status.sources.running = runner.getActiveSources().length
            return status.ready
        })()
        try { return await reconciling } finally { reconciling = null }
    }

    function readiness() {
        return {
            ready: status.ready,
            enabled: status.enabled,
            database: { configured: status.database.configured, reachable: status.database.reachable },
            queues: { ...status.queues },
            dependencies: { ...status.dependencies },
            mode: status.mode,
            target: status.target,
        }
    }

    return {
        async start() {
            if (running) return health.address?.()
            running = true
            status.running = true
            status.startedAt = clock().toISOString()
            await health.listen()
            await reconcile()
            reconcileTimer = setInterval(() => { void reconcile() }, 30_000)
            qualityTimer = setInterval(() => {
                if (!running || !enabled || !status.dependencies.ready || !store?.refreshFindings) return
                void store.refreshFindings({ now: clock() })
                    .then(() => { status.jobs.qualityRefresh.lastRunAt = clock().toISOString(); status.jobs.qualityRefresh.lastErrorAt = null })
                    .catch(() => { status.jobs.qualityRefresh.lastErrorAt = clock().toISOString() })
            }, 5 * 60 * 1000)
            return health.address?.()
        },
        async stop() {
            if (!running) return
            running = false
            if (reconcileTimer) clearInterval(reconcileTimer)
            reconcileTimer = null
            if (qualityTimer) clearInterval(qualityTimer)
            qualityTimer = null
            if (runner?.isRunning()) await runner.stop()
            await health.close()
            if (ownedPool) await pool.end()
            status.running = false
            status.ready = false
            status.stoppedAt = clock().toISOString()
        },
        async refresh() { return reconcile() },
        readiness,
        health: () => ({ ...status, database: { ...status.database }, queues: { ...status.queues }, dependencies: { ...status.dependencies }, sources: { ...status.sources }, jobs: { ...status.jobs, qualityRefresh: { ...status.jobs.qualityRefresh }, catalog: status.jobs.catalog.map((job) => ({ ...job })) } }),
        runner,
        store,
        pool,
        address: () => health.address?.(),
    }
}

export const __testables = { runtimeDestinationSafe: isClientesSourceRuntimeDestinationSafe, truthy }
