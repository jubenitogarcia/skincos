import path from 'node:path'

import { createPgPool } from '../harmonia/store/pg.js'
import { startHarmoniaWorker } from '../harmonia/worker.js'
import { createClientesContinuousJobs } from './clientesJobs.js'
import { createContinuousJobRunner } from './jobRunner.js'
import { createWorkerHealthServer } from './healthServer.js'

const TRUE_VALUES = new Set(['1', 'true', 'yes', 'on'])

function isTruthy(value) {
    return TRUE_VALUES.has(String(value || '').trim().toLowerCase())
}

function safeStatus(source, fallback) {
    try {
        const value = typeof source === 'function' ? source() : source
        return value && typeof value === 'object' ? value : fallback
    } catch {
        return fallback
    }
}

function isoNow() {
    return new Date().toISOString()
}

function maxTimestamp(...values) {
    return values.filter(Boolean).sort().at(-1) || null
}

function queueLagMs(queue) {
    const candidates = [queue?.oldestPendingAt, queue?.oldestProcessingAt]
        .map((value) => value ? Date.parse(value) : NaN)
        .filter(Number.isFinite)
    if (!candidates.length) return null
    return Math.max(0, Date.now() - Math.min(...candidates))
}

/**
 * Composition root for the dedicated CRM jobs process. The HTTP server does
 * not import this module, which is the architectural boundary that prevents a
 * request-serving process from accidentally starting continuous work.
 */
export function createContinuousWorkerService({
    env = process.env,
    varDir,
    harmoniaFactory = startHarmoniaWorker,
    poolFactory = createPgPool,
    jobsFactory = createClientesContinuousJobs,
    runnerFactory = createContinuousJobRunner,
    healthFactory = createWorkerHealthServer,
} = {}) {
    const enabled = isTruthy(env.CRM_CONTINUOUS_WORKERS_ENABLED)
    const requestedMode = String(env.CRM_CONTINUOUS_WORKERS_MODE || env.HARMONIA_WORKER_MODE || '').trim()
    const assistedConfirmed = isTruthy(env.CRM_CONTINUOUS_WORKERS_ASSISTED_CONFIRMED)
    const mode = !enabled ? 'disabled' : requestedMode || 'observe'
    const effectiveMode = mode.toLowerCase() === 'assisted' && !assistedConfirmed ? 'observe' : mode
    const jobsEnabled = enabled && isTruthy(env.CRM_CONTINUOUS_JOBS_ENABLED)
    const databaseUrl = String(env.DATABASE_URL || '').trim() || null
    const runtimeVarDir = varDir || env.VAR_DIR || path.join(process.cwd(), 'var')
    const statePath = String(env.CRM_CONTINUOUS_JOBS_STATE_PATH || path.join(runtimeVarDir, 'continuous-jobs-state.json')).trim()

    const harmonia = harmoniaFactory({ varDir: runtimeVarDir, mode: effectiveMode, defaultMode: 'observe' })
    const jobsPool = jobsEnabled && databaseUrl ? poolFactory(databaseUrl) : null
    const jobs = jobsEnabled ? jobsFactory({ pool: jobsPool, databaseUrl, env }) : []
    const runner = runnerFactory({
        jobs,
        enabled: jobsEnabled,
        statePath,
        retryBaseMs: Number(env.CRM_CONTINUOUS_JOBS_RETRY_BASE_SECONDS || 30) * 1000,
        retryMaxMs: Number(env.CRM_CONTINUOUS_JOBS_RETRY_MAX_SECONDS || 900) * 1000,
        maxAttempts: Number(env.CRM_CONTINUOUS_JOBS_MAX_ATTEMPTS || 5),
    })

    let health
    let running = false
    let stopping = false
    let startedAt = null
    let stoppedAt = null

    function getStatus() {
        const harmoniaStatus = safeStatus(harmonia?.getStatus, { ready: false, running: false, database: { configured: Boolean(databaseUrl), reachable: false }, queue: null })
        const jobsStatus = safeStatus(runner?.getStatus, { ready: false, running: false, jobs: {}, metrics: {}, statePersistence: { ready: false } })
        const databaseConfigured = Boolean(databaseUrl)
        const databaseReachable = harmoniaStatus.database?.reachable === true
        const queueReady = harmoniaStatus.ready === true && databaseReachable
        const jobsReady = !jobsEnabled || jobsStatus.ready === true
        const ready = running && !stopping && databaseConfigured && databaseReachable && queueReady && jobsReady
        return {
            service: 'crm-continuous-workers',
            mode: effectiveMode,
            running,
            ready,
            startedAt,
            stoppedAt,
            dependencies: {
                database: { configured: databaseConfigured, reachable: databaseReachable },
                queues: { harmonia: queueReady, lagMs: queueLagMs(harmoniaStatus.queue) },
                jobs: { enabled: jobsEnabled, ready: jobsReady },
                statePersistence: jobsStatus.statePersistence || { configured: Boolean(statePath), ready: false },
            },
            harmonia: harmoniaStatus,
            jobs: jobsStatus,
            metrics: {
                lastExecutionAt: maxTimestamp(harmoniaStatus.lastSuccessAt, jobsStatus.metrics?.lastExecutionAt),
                lastDurationMs: jobsStatus.metrics?.lastDurationMs ?? harmoniaStatus.lastDurationMs ?? null,
                lagMs: jobsStatus.metrics?.lagMs ?? queueLagMs(harmoniaStatus.queue),
                errors: Number(harmoniaStatus.errorCount || 0) + Number(jobsStatus.metrics?.errors || 0),
                retries: Number(harmoniaStatus.retryCount || 0) + Number(jobsStatus.metrics?.retries || 0),
            },
        }
    }

    health = healthFactory({
        getStatus,
        host: env.CRM_CONTINUOUS_WORKER_HOST || '127.0.0.1',
        port: Number.parseInt(env.CRM_CONTINUOUS_WORKER_PORT || '8102', 10),
    })

    async function start() {
        if (running) return { address: health.server?.address?.() || null, status: getStatus() }
        startedAt = isoNow()
        stoppedAt = null
        // Bind the operational boundary before the first database attempt. A
        // controlled database outage must leave /health available.
        const address = await health.listen()
        running = true
        try {
            await runner.start()
        } catch (error) {
            running = false
            await Promise.allSettled([
                health.close(),
                typeof harmonia?.stop === 'function' ? harmonia.stop() : Promise.resolve(),
                jobsPool && typeof jobsPool.end === 'function' ? jobsPool.end() : Promise.resolve(),
            ])
            throw error
        }
        return { address, status: getStatus() }
    }

    async function stop() {
        if (stopping) return
        stopping = true
        try {
            if (typeof runner?.stop === 'function') await runner.stop()
            if (typeof harmonia?.stop === 'function') await harmonia.stop()
            if (jobsPool && typeof jobsPool.end === 'function') await jobsPool.end()
            await health.close()
        } finally {
            running = false
            stoppedAt = isoNow()
            stopping = false
        }
    }

    return {
        start,
        stop,
        getStatus,
        address: () => health.server?.address?.() || null,
        components: { harmonia, runner, health },
    }
}

export const __testables = {
    isTruthy,
    queueLagMs,
}
