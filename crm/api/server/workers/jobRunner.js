import { promises as fs } from 'node:fs'
import path from 'node:path'

const SAFE_CODE = /^[A-Z][A-Z0-9_]{0,63}$/

function nowMs(clock) {
    const value = typeof clock === 'function' ? clock() : Date.now()
    return Number.isFinite(value) ? value : Date.now()
}

function iso(value) {
    return new Date(value).toISOString()
}

function positiveInteger(value, fallback, maximum = Number.MAX_SAFE_INTEGER) {
    const parsed = Number(value)
    if (!Number.isInteger(parsed) || parsed <= 0) return fallback
    return Math.min(parsed, maximum)
}

function safeErrorCode(error) {
    const code = String(error?.code || '').trim().toUpperCase()
    return SAFE_CODE.test(code) ? code : 'JOB_EXECUTION_FAILED'
}

function createJobState() {
    return {
        status: 'idle',
        attempts: 0,
        retries: 0,
        totalRuns: 0,
        totalErrors: 0,
        totalRetries: 0,
        lastAttemptCount: 0,
        lastExecutionKey: null,
        pendingExecutionKey: null,
        pendingScheduledAt: null,
        lastScheduledAt: null,
        lastStartedAt: null,
        lastFinishedAt: null,
        lastExecutionAt: null,
        lastSuccessAt: null,
        lastErrorAt: null,
        lastError: null,
        lastDurationMs: null,
        lastLagMs: null,
        readiness: null,
        nextRunAt: null,
        deadLetteredAt: null,
    }
}

function normalizeJob(job) {
    if (!job || typeof job !== 'object') throw new Error('CONTINUOUS_JOB_INVALID')
    const id = String(job.id || '').trim()
    if (!id || !/^[a-z0-9][a-z0-9._-]{1,95}$/i.test(id)) throw new Error('CONTINUOUS_JOB_ID_INVALID')
    if (typeof job.run !== 'function') throw new Error(`CONTINUOUS_JOB_RUNNER_MISSING:${id}`)
    return {
        id,
        intervalMs: positiveInteger(job.intervalMs, 60_000),
        run: job.run,
        required: job.required !== false,
    }
}

// Only a boolean readiness declaration is retained in the durable scheduler
// state. Job payloads may contain operational data and must never be copied
// into the checkpoint file.
function resultReadiness(result) {
    return typeof result?.ready === 'boolean' ? result.ready : null
}

function executionKey(jobId, scheduledAt) {
    return `${jobId}:${new Date(scheduledAt).toISOString()}`
}

function clone(value) {
    return JSON.parse(JSON.stringify(value))
}

function parsePersistedState(raw, jobs) {
    if (!raw || typeof raw !== 'object' || raw.version !== 1 || !raw.jobs || typeof raw.jobs !== 'object') return null
    const state = {
        version: 1,
        jobs: {},
        deadLetters: Array.isArray(raw.deadLetters) ? raw.deadLetters.slice(-100) : [],
        updatedAt: raw.updatedAt || null,
    }
    for (const job of jobs) {
        const source = raw.jobs[job.id]
        const target = createJobState()
        if (source && typeof source === 'object') {
            for (const key of Object.keys(target)) {
                if (source[key] !== undefined) target[key] = source[key]
            }
            if (!['idle', 'running', 'retrying', 'succeeded', 'dead'].includes(target.status)) target.status = 'idle'
            if (target.status === 'running' || target.status === 'retrying') target.status = 'idle'
            if (target.status === 'dead') target.nextRunAt = null
        }
        state.jobs[job.id] = target
    }
    return state
}

/**
 * Small durable scheduler for the CRM's independent continuous jobs.
 *
 * The state file is intentionally an operational checkpoint, not a source of
 * customer data. It provides idempotency keys, retry/dead-letter state and
 * aggregate metrics without allowing the runtime to execute a shell command.
 */
export function createContinuousJobRunner({
    jobs = [],
    statePath = null,
    enabled = true,
    clock = () => Date.now(),
    fsImpl = fs,
    retryBaseMs = 30_000,
    retryMaxMs = 900_000,
    maxAttempts = 5,
    startImmediately = true,
} = {}) {
    const normalizedJobs = jobs.map(normalizeJob)
    const jobById = new Map(normalizedJobs.map((job) => [job.id, job]))
    const retryBase = positiveInteger(retryBaseMs, 30_000)
    const retryMax = Math.max(retryBase, positiveInteger(retryMaxMs, 900_000))
    const attemptsLimit = positiveInteger(maxAttempts, 5, 100)
    const state = {
        version: 1,
        jobs: Object.fromEntries(normalizedJobs.map((job) => [job.id, createJobState()])),
        deadLetters: [],
        updatedAt: null,
    }
    const timers = new Map()
    const active = new Map()
    let loaded = false
    let running = false
    let stopping = false
    let startedAt = null
    let stoppedAt = null
    let persistenceReady = !statePath
    let persistenceError = null
    let persistChain = Promise.resolve()
    const stateLockPath = statePath ? `${statePath}.lock` : null
    let stateLockHandle = null
    let stateLockAcquired = false

    function markPersistenceUnavailable(code = 'STATE_PERSISTENCE_UNAVAILABLE') {
        persistenceReady = false
        persistenceError = code
    }

    function ownerProcessIsAlive(pid) {
        if (!Number.isInteger(pid) || pid <= 0) return true
        if (pid === process.pid) return true
        try {
            process.kill(pid, 0)
            return true
        } catch (error) {
            return error?.code !== 'ESRCH'
        }
    }

    async function acquireStateLock() {
        if (!stateLockPath) return true
        try {
            await fsImpl.mkdir(path.dirname(stateLockPath), { recursive: true })
        } catch (error) {
            markPersistenceUnavailable(safeErrorCode(error))
            return false
        }
        for (let attempt = 0; attempt < 2; attempt += 1) {
            try {
                const handle = await fsImpl.open(stateLockPath, 'wx', 0o640)
                await handle.writeFile(JSON.stringify({ version: 1, pid: process.pid, startedAt: iso(nowMs(clock)) }), 'utf8')
                stateLockHandle = handle
                stateLockAcquired = true
                return true
            } catch (error) {
                if (error?.code !== 'EEXIST') {
                    markPersistenceUnavailable(safeErrorCode(error))
                    return false
                }
                let existing = null
                try { existing = JSON.parse(await fsImpl.readFile(stateLockPath, 'utf8')) } catch { /* malformed locks fail closed */ }
                if (existing && ownerProcessIsAlive(Number(existing.pid))) {
                    markPersistenceUnavailable('STATE_LOCK_UNAVAILABLE')
                    return false
                }
                if (!existing || attempt > 0) {
                    markPersistenceUnavailable('STATE_LOCK_UNAVAILABLE')
                    return false
                }
                try { await fsImpl.unlink(stateLockPath) } catch {
                    markPersistenceUnavailable('STATE_LOCK_UNAVAILABLE')
                    return false
                }
            }
        }
        markPersistenceUnavailable('STATE_LOCK_UNAVAILABLE')
        return false
    }

    async function releaseStateLock() {
        const handle = stateLockHandle
        const acquired = stateLockAcquired
        stateLockHandle = null
        stateLockAcquired = false
        try { if (handle) await handle.close() } catch { /* preserve shutdown progress */ }
        if (acquired && stateLockPath) {
            try { await fsImpl.unlink(stateLockPath) } catch { /* a stopped worker must not fail solely on cleanup */ }
        }
    }

    async function loadState() {
        if (loaded) return
        loaded = true
        if (!statePath) return
        try {
            const raw = JSON.parse(await fsImpl.readFile(statePath, 'utf8'))
            const persisted = parsePersistedState(raw, normalizedJobs)
            if (persisted) {
                state.jobs = persisted.jobs
                state.deadLetters = persisted.deadLetters
                state.updatedAt = persisted.updatedAt
            }
            persistenceReady = true
            persistenceError = null
        } catch (error) {
            if (error?.code === 'ENOENT') {
                persistenceReady = true
                persistenceError = null
                return
            }
            markPersistenceUnavailable(safeErrorCode(error))
        }
    }

    async function persistNow() {
        if (!statePath) {
            persistenceReady = true
            persistenceError = null
            return
        }
        try {
            const directory = path.dirname(statePath)
            await fsImpl.mkdir(directory, { recursive: true })
            state.updatedAt = iso(nowMs(clock))
            const temporary = `${statePath}.${process.pid}.tmp`
            await fsImpl.writeFile(temporary, JSON.stringify(state, null, 2), { mode: 0o640 })
            await fsImpl.rename(temporary, statePath)
            persistenceReady = true
            persistenceError = null
        } catch (error) {
            markPersistenceUnavailable(safeErrorCode(error))
        }
    }

    function queuePersist() {
        persistChain = persistChain.then(() => persistNow(), () => persistNow())
        return persistChain
    }

    function schedule(jobId, delayMs, scheduledAtMs) {
        if (!running || stopping) return
        const currentTimer = timers.get(jobId)
        if (currentTimer) clearTimeout(currentTimer)
        const timer = setTimeout(() => {
            timers.delete(jobId)
            void execute(jobId, scheduledAtMs)
        }, Math.max(0, Number(delayMs) || 0))
        timers.set(jobId, timer)
    }

    function backoffMs(attempt) {
        const exponent = Math.max(0, Number(attempt || 1) - 1)
        return Math.min(retryMax, retryBase * Math.pow(2, exponent))
    }

    async function execute(jobId, scheduledAtMs = nowMs(clock)) {
        if (!running || stopping) return { skipped: 'stopped' }
        const job = jobById.get(jobId)
        if (!job) throw new Error(`CONTINUOUS_JOB_UNKNOWN:${jobId}`)
        const entry = state.jobs[jobId]
        const scheduled = Number(scheduledAtMs)
        const scheduledAt = Number.isFinite(scheduled) ? scheduled : nowMs(clock)
        const key = executionKey(jobId, scheduledAt)

        // A completed execution can still be flushing its checkpoint when a
        // caller repeats the same key.  Preserve idempotency in that narrow
        // window instead of reporting an in-flight result and inviting a
        // duplicate retry from a caller.
        if (entry.lastExecutionKey === key && entry.status === 'succeeded') {
            const next = nowMs(clock) + job.intervalMs
            schedule(jobId, job.intervalMs, next)
            return { skipped: 'idempotent', executionKey: key }
        }
        if (active.has(jobId)) return { skipped: 'in_flight' }

        const attempt = entry.pendingExecutionKey === key ? Number(entry.attempts || 0) + 1 : 1
        const started = nowMs(clock)
        entry.status = 'running'
        entry.attempts = attempt
        entry.pendingExecutionKey = key
        entry.pendingScheduledAt = iso(scheduledAt)
        entry.lastScheduledAt = iso(scheduledAt)
        entry.lastStartedAt = iso(started)
        entry.totalRuns += 1
        await queuePersist()
        if (!persistenceReady) {
            entry.status = 'idle'
            entry.lastErrorAt = iso(nowMs(clock))
            entry.lastError = 'STATE_PERSISTENCE_UNAVAILABLE'
            entry.nextRunAt = null
            return { ok: false, blocked: true, executionKey: key, error: 'STATE_PERSISTENCE_UNAVAILABLE' }
        }

        const promise = (async () => {
            try {
                const result = await job.run({
                    jobId,
                    executionKey: key,
                    scheduledAt: new Date(scheduledAt),
                    attempt,
                })
                const finished = nowMs(clock)
                entry.status = 'succeeded'
                entry.lastAttemptCount = attempt
                entry.attempts = 0
                entry.lastExecutionKey = key
                entry.pendingExecutionKey = null
                entry.pendingScheduledAt = null
                entry.lastFinishedAt = iso(finished)
                entry.lastExecutionAt = iso(finished)
                entry.lastSuccessAt = iso(finished)
                entry.lastErrorAt = null
                entry.lastError = null
                entry.readiness = resultReadiness(result)
                entry.lastDurationMs = Math.max(0, finished - started)
                entry.lastLagMs = Math.max(0, finished - scheduledAt)
                entry.nextRunAt = null
                await queuePersist()
                if (!persistenceReady) return { ok: false, blocked: true, executionKey: key, error: 'STATE_PERSISTENCE_UNAVAILABLE' }
                const next = Math.max(finished + job.intervalMs, scheduledAt + job.intervalMs)
                entry.nextRunAt = iso(next)
                await queuePersist()
                if (!persistenceReady) return { ok: false, blocked: true, executionKey: key, error: 'STATE_PERSISTENCE_UNAVAILABLE' }
                schedule(jobId, next - finished, next)
                return { ok: true, executionKey: key, result }
            } catch (error) {
                const finished = nowMs(clock)
                const code = safeErrorCode(error)
                entry.totalErrors += 1
                entry.lastAttemptCount = attempt
                entry.lastFinishedAt = iso(finished)
                entry.lastExecutionAt = iso(finished)
                entry.lastErrorAt = iso(finished)
                entry.lastError = code
                entry.lastDurationMs = Math.max(0, finished - started)
                entry.lastLagMs = Math.max(0, finished - scheduledAt)
                if (stopping) {
                    // Preserve the execution key and attempt count for a
                    // controlled restart instead of dead-lettering a job
                    // merely because SIGTERM arrived during a retryable
                    // failure.
                    entry.status = 'idle'
                    entry.nextRunAt = null
                    await queuePersist()
                    return { ok: false, deferred: true, executionKey: key, error: code }
                }
                if (error?.retryable !== false && attempt < attemptsLimit && !stopping) {
                    entry.status = 'retrying'
                    entry.retries += 1
                    entry.totalRetries += 1
                    entry.nextRunAt = iso(finished + backoffMs(attempt))
                    await queuePersist()
                    if (!persistenceReady) return { ok: false, blocked: true, executionKey: key, error: 'STATE_PERSISTENCE_UNAVAILABLE' }
                    schedule(jobId, backoffMs(attempt), scheduledAt)
                    return { ok: false, retrying: true, executionKey: key, error: code }
                }
                entry.status = 'dead'
                entry.attempts = 0
                entry.pendingExecutionKey = null
                entry.pendingScheduledAt = null
                entry.nextRunAt = null
                entry.deadLetteredAt = iso(finished)
                state.deadLetters.push({
                    jobId,
                    executionKey: key,
                    attempts: attempt,
                    error: code,
                    failedAt: iso(finished),
                })
                state.deadLetters = state.deadLetters.slice(-100)
                await queuePersist()
                return { ok: false, deadLettered: true, executionKey: key, error: code }
            } finally {
                active.delete(jobId)
            }
        })()
        active.set(jobId, promise)
        return promise
    }

    function metrics() {
        const entries = Object.values(state.jobs)
        const lastExecutionAt = entries
            .map((entry) => entry.lastExecutionAt)
            .filter(Boolean)
            .sort()
            .at(-1) || null
        return {
            totalRuns: entries.reduce((sum, entry) => sum + Number(entry.totalRuns || 0), 0),
            errors: entries.reduce((sum, entry) => sum + Number(entry.totalErrors || 0), 0),
            retries: entries.reduce((sum, entry) => sum + Number(entry.totalRetries || 0), 0),
            deadLetters: state.deadLetters.length,
            lastExecutionAt,
            lastDurationMs: entries.map((entry) => entry.lastDurationMs).filter(Number.isFinite).at(-1) ?? null,
            lagMs: entries.map((entry) => entry.lastLagMs).filter(Number.isFinite).at(-1) ?? null,
        }
    }

    function getStatus() {
        const jobStatuses = Object.fromEntries(normalizedJobs.map((job) => {
            const entry = state.jobs[job.id]
            return [job.id, { ...entry, intervalMs: job.intervalMs, required: job.required }]
        }))
        const requiredReady = normalizedJobs.filter((job) => job.required).every((job) => {
            const current = state.jobs[job.id]
            return current.status === 'succeeded' && current.readiness !== false
        })
        return {
            service: 'crm-continuous-job-runner',
            enabled: Boolean(enabled),
            running,
            ready: !enabled || (persistenceReady && requiredReady),
            startedAt,
            stoppedAt,
            jobs: clone(jobStatuses),
            metrics: metrics(),
            deadLetters: state.deadLetters.slice(-100),
            statePersistence: {
                configured: Boolean(statePath),
                ready: persistenceReady,
                error: persistenceError,
            },
        }
    }

    async function start() {
        if (running) return getStatus()
        if (!(await acquireStateLock())) return getStatus()
        await loadState()
        if (!persistenceReady) {
            await releaseStateLock()
            return getStatus()
        }
        stopping = false
        startedAt = iso(nowMs(clock))
        stoppedAt = null
        if (!enabled) {
            running = false
            await releaseStateLock()
            return getStatus()
        }
        running = true
        const scheduledJobs = []
        for (const job of normalizedJobs) {
            const entry = state.jobs[job.id]
            if (entry.status === 'dead') continue
            const pendingScheduledAt = entry.pendingScheduledAt ? Date.parse(entry.pendingScheduledAt) : NaN
            const resumingPending = Number.isFinite(pendingScheduledAt) && Boolean(entry.pendingExecutionKey)
            const delay = startImmediately || resumingPending ? 0 : job.intervalMs
            const scheduledAt = resumingPending ? pendingScheduledAt : nowMs(clock) + delay
            entry.status = 'idle'
            entry.nextRunAt = null
            scheduledJobs.push({ id: job.id, delay, scheduledAt })
        }
        await queuePersist()
        if (!persistenceReady) {
            running = false
            await releaseStateLock()
            return getStatus()
        }
        for (const job of scheduledJobs) schedule(job.id, job.delay, job.scheduledAt)
        return getStatus()
    }

    async function stop() {
        if (stopping) return
        stopping = true
        running = false
        for (const timer of timers.values()) clearTimeout(timer)
        timers.clear()
        await Promise.allSettled([...active.values()])
        await persistChain
        stoppedAt = iso(nowMs(clock))
        await queuePersist()
        await releaseStateLock()
    }

    async function runOnce(jobId, options = {}) {
        if (!running) {
            await start()
            if (!running) return { skipped: 'runner_not_ready' }
        }
        return execute(jobId, options.scheduledAt === undefined ? nowMs(clock) : options.scheduledAt)
    }

    async function resetJob(jobId) {
        if (!jobById.has(jobId)) throw new Error(`CONTINUOUS_JOB_UNKNOWN:${jobId}`)
        state.jobs[jobId] = createJobState()
        state.deadLetters = state.deadLetters.filter((item) => item.jobId !== jobId)
        await queuePersist()
        if (running) schedule(jobId, 0, nowMs(clock))
    }

    return {
        start,
        stop,
        runOnce,
        resetJob,
        getStatus,
        jobs: normalizedJobs.map(({ id, intervalMs, required }) => ({ id, intervalMs, required })),
    }
}

export const __testables = {
    backoffMs: (attempt, base = 30_000, cap = 900_000) => Math.min(cap, base * Math.pow(2, Math.max(0, Number(attempt || 1) - 1))),
    executionKey,
    safeErrorCode,
    resultReadiness,
}
