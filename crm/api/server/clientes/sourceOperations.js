import { createHash } from 'node:crypto'

export const SOURCE_STATUSES = Object.freeze([
    'running',
    'complete',
    'partial',
    'incomplete',
    'invalid',
    'failed',
    'dead',
    'skipped',
])

export const SOURCE_FRESHNESS_STATES = Object.freeze(['healthy', 'preventive', 'high', 'missing'])

function canonicalize(value) {
    if (value instanceof Date) return value.toISOString()
    if (Array.isArray(value)) return value.map(canonicalize)
    if (value && typeof value === 'object') {
        return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonicalize(value[key])]))
    }
    return value
}

export function fingerprintSource(value) {
    return `sha256:${createHash('sha256').update(JSON.stringify(canonicalize(value))).digest('hex')}`
}

export function sourceIdempotencyKey(sourceId, fingerprint, watermark) {
    const payload = `${String(sourceId || '').trim()}|${String(fingerprint || '').trim()}|${String(watermark || '').trim()}`
    return `source:${createHash('sha256').update(payload).digest('hex')}`
}

function safeErrorCode(error) {
    const raw = String(error?.code || '').trim().toUpperCase()
    return /^[A-Z][A-Z0-9_]{1,80}$/.test(raw) ? raw : 'SOURCE_RUN_FAILED'
}

export function sanitizeSourceError(error) {
    return {
        code: safeErrorCode(error),
        retryable: error?.retryable !== false,
    }
}

export function compareWatermarks(left, right) {
    const a = String(left || '').trim()
    const b = String(right || '').trim()
    if (!a && !b) return 0
    if (!a) return -1
    if (!b) return 1
    const aDate = Date.parse(a)
    const bDate = Date.parse(b)
    if (Number.isFinite(aDate) && Number.isFinite(bDate)) return Math.sign(aDate - bDate)
    return a === b ? 0 : a > b ? 1 : -1
}

export function freshnessState(lastAppliedAt, now = new Date(), { warningHours = 24, highHours = 48 } = {}) {
    if (!lastAppliedAt) return 'missing'
    const observed = new Date(lastAppliedAt).getTime()
    if (!Number.isFinite(observed)) return 'missing'
    const ageHours = Math.max(0, Number(now.getTime() - observed) / 3_600_000)
    if (ageHours >= highHours) return 'high'
    if (ageHours >= warningHours) return 'preventive'
    return 'healthy'
}

function normalizeNonNegative(value) {
    const number = Number(value)
    return Number.isFinite(number) && number >= 0 ? Math.floor(number) : 0
}

const COVERAGE_NUMBER_KEYS = new Set([
    'records', 'recordsRead', 'recordsApplied', 'profiles', 'procedures', 'professionals',
    'rawRows', 'managementItems', 'inventory', 'identities', 'members', 'opted_out', 'blocked',
    'recordsPresent', 'rowsPresent', 'requiredTableRows',
])
const COVERAGE_STRING_KEYS = new Set([
    'kind', 'table', 'minServiceDate', 'maxServiceDate', 'lastUpdated', 'last_updated',
])
const COVERAGE_BOOLEAN_KEYS = new Set(['tabsComplete', 'snapshotComplete'])
const COVERAGE_ARRAY_KEYS = new Set(['tabs', 'requiredTabs', 'tabsPresent', 'missingTabs', 'tables', 'fields'])
const CHECKPOINT_NUMBER_KEYS = new Set(['page', 'offset', 'pagesRead', 'rowsRead', 'totalPages'])
const CHECKPOINT_STRING_KEYS = new Set(['nextWatermark', 'completedAt', 'sourceVersion'])

function sanitizeString(value, maxLength = 160) {
    const text = String(value || '').trim()
    return text.length > 0 && text.length <= maxLength ? text : null
}

function sanitizeCoverage(value, key = '') {
    if (value === null || value === undefined) return null
    if (typeof value === 'number') return Number.isFinite(value) && value >= 0 ? Math.floor(value) : null
    if (typeof value === 'boolean') return value
    if (typeof value === 'string') return sanitizeString(value)
    if (Array.isArray(value)) {
        if (!COVERAGE_ARRAY_KEYS.has(key)) return value.slice(0, 50).map((item) => sanitizeCoverage(item, key)).filter((item) => item !== null)
        return value.slice(0, 100).map((item) => sanitizeString(item, 120)).filter(Boolean)
    }
    if (typeof value !== 'object') return null
    const output = {}
    for (const [childKey, childValue] of Object.entries(value)) {
        if (key === 'tables' || key === 'rows') {
            const count = normalizeNonNegative(childValue)
            output[childKey.slice(0, 120)] = count
            continue
        }
        if (!COVERAGE_NUMBER_KEYS.has(childKey) && !COVERAGE_STRING_KEYS.has(childKey) && !COVERAGE_BOOLEAN_KEYS.has(childKey) && childKey !== 'proof' && childKey !== 'tables' && childKey !== 'rows') continue
        const sanitized = sanitizeCoverage(childValue, childKey)
        if (sanitized !== null) output[childKey] = sanitized
    }
    return output
}

function sanitizeCheckpoint(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
    const output = {}
    for (const [key, childValue] of Object.entries(value)) {
        if (CHECKPOINT_NUMBER_KEYS.has(key)) {
            const number = normalizeNonNegative(childValue)
            output[key] = number
        } else if (CHECKPOINT_STRING_KEYS.has(key)) {
            const text = sanitizeString(childValue)
            if (text) output[key] = text
        } else if (key === 'cursor' || key === 'resumeToken') {
            const text = sanitizeString(childValue, 4096)
            if (text) output[`${key}Hash`] = fingerprintSource(text)
        }
    }
    return output
}

export function normalizeSourceObservation(source, result = {}, observedAt = new Date().toISOString()) {
    const snapshotComplete = result.snapshotComplete === true
    const recordsRead = normalizeNonNegative(result.recordsRead ?? result.records)
    const recordsApplied = normalizeNonNegative(result.recordsApplied ?? result.applied)
    const recordsSkipped = normalizeNonNegative(result.recordsSkipped ?? result.skipped)
    const divergences = normalizeNonNegative(result.divergences)
    const watermark = String(result.watermark || '').trim() || observedAt
    const fingerprint = String(result.fingerprint || '').trim() || fingerprintSource({
        sourceId: source.id,
        watermark,
        recordsRead,
        coverage: result.coverage || {},
    })
    const status = String(result.status || (snapshotComplete ? 'complete' : 'incomplete')).trim().toLowerCase()
    if (!SOURCE_STATUSES.includes(status)) {
        const error = new Error('SOURCE_STATUS_INVALID')
        error.code = 'SOURCE_STATUS_INVALID'
        error.retryable = false
        throw error
    }
    return {
        status,
        snapshotComplete,
        watermark,
        fingerprint,
        recordsRead,
        recordsApplied,
        recordsSkipped,
        divergences,
        coverage: sanitizeCoverage(result.coverage || {}) || {},
        checkpoint: sanitizeCheckpoint(result.checkpoint),
        // The adapter snapshot stays in process memory only. It is deliberately
        // not persisted by the store (which receives aggregate metadata only),
        // but is needed by apply adapters after a successful read.
        snapshot: result.snapshot,
        snapshotProof: result.snapshotProof || result.coverage?.proof || null,
        observedAt,
        nextWatermark: String(result.nextWatermark || watermark),
        backupRef: result.backupRef || null,
    }
}

function sourceError(code, retryable = true) {
    const error = new Error(code)
    error.code = code
    error.retryable = retryable
    return error
}

export function createClientesSourceRunner({
    catalog,
    adapters,
    store,
    clock = () => new Date(),
    retryBaseMs = 1_000,
    retryMaxMs = 60_000,
    maxAttempts = 3,
    applyEnabled = false,
    target = 'local',
} = {}) {
    if (!store || typeof store.withSourceLock !== 'function') throw sourceError('SOURCE_STORE_REQUIRED', false)
    const active = new Map()
    const timers = new Map()
    let running = false

    const getSource = (sourceId) => catalog.find((item) => item.id === sourceId)
    const nowIso = () => clock().toISOString()
    const backoff = (attempt) => Math.min(retryMaxMs, retryBaseMs * (2 ** Math.max(0, attempt - 1)))

    async function runSource(sourceId, { mode = 'dry-run', scheduledAt = nowIso(), force = false } = {}) {
        const source = getSource(sourceId)
        if (!source) throw sourceError('SOURCE_UNKNOWN', false)
        const adapter = adapters?.[sourceId]
        if (!adapter || typeof adapter.read !== 'function') throw sourceError('SOURCE_ADAPTER_MISSING', false)
        if (active.has(sourceId)) return { sourceId, status: 'skipped', reason: 'already_running' }

        active.set(sourceId, true)
        try {
            return await store.withSourceLock(sourceId, async (connection) => {
                const checkpoint = await store.getCheckpoint(sourceId, connection)
                const dueAt = checkpoint?.nextRunAt ? new Date(checkpoint.nextRunAt).getTime() : 0
                if (!force && Number.isFinite(dueAt) && dueAt > clock().getTime()) {
                    return { sourceId, status: 'skipped', reason: 'backoff', nextRunAt: checkpoint.nextRunAt }
                }
                const attempt = Number(checkpoint?.consecutiveFailures || 0) + 1
                const run = await store.beginRun({
                    sourceId,
                    scheduledAt,
                    idempotencyKey: `scheduled:${sourceId}:${scheduledAt}`,
                    attempt,
                    connection,
                })
                if (!run?.id) throw sourceError('SOURCE_RUN_CREATE_FAILED')
                if (run?.existing && ['complete', 'skipped'].includes(String(run.status || '').toLowerCase())) {
                    return { sourceId, status: 'skipped', reason: 'idempotency_key', idempotent: true }
                }
                const startedAt = clock()
                let failureObservation = { observedAt: startedAt.toISOString() }
                let backupRef = null
                try {
                    const raw = await adapter.read({ source, checkpoint, target, now: startedAt })
                    const observation = normalizeSourceObservation(source, raw, startedAt.toISOString())
                    failureObservation = observation
                    if (source.snapshotRequired && (!observation.snapshotComplete || observation.status !== 'complete')) {
                        const status = observation.snapshotComplete ? 'partial' : 'incomplete'
                        const error = sourceError(observation.snapshotComplete ? 'SOURCE_SNAPSHOT_NOT_APPLICABLE' : 'SOURCE_SNAPSHOT_INCOMPLETE', false)
                        await store.failRun({ runId: run.id, sourceId, observation, error, durationMs: clock().getTime() - startedAt.getTime(), failureStatus: status, retryAt: new Date(clock().getTime() + source.cadenceMs).toISOString(), connection })
                        return { sourceId, status, error: sanitizeSourceError(error) }
                    }
                    const sourceOrder = await store.compareSourceOrder(sourceId, observation.watermark, connection)
                    if (sourceOrder < 0 && !force) {
                        const error = sourceError('SOURCE_SNAPSHOT_OLDER_THAN_CHECKPOINT', false)
                        await store.failRun({ runId: run.id, sourceId, observation, error, durationMs: clock().getTime() - startedAt.getTime(), failureStatus: 'invalid', preserveCheckpoint: true, retryAt: new Date(clock().getTime() + source.cadenceMs).toISOString(), connection })
                        return { sourceId, status: 'invalid', error: sanitizeSourceError(error) }
                    }
                    const sameSnapshot = !force && checkpoint?.fingerprint === observation.fingerprint && checkpoint?.watermark === observation.watermark && checkpoint?.status === 'complete'
                    let applied = false
                    let applyResult = {}
                    if (mode === 'apply' && !sameSnapshot) {
                        if (!applyEnabled) throw sourceError('SOURCE_APPLY_DISABLED', false)
                        if (typeof adapter.backup === 'function') backupRef = await adapter.backup({ source, target, checkpoint, observation })
                        if (typeof adapter.apply !== 'function') throw sourceError('SOURCE_APPLY_ADAPTER_MISSING', false)
                        applyResult = await adapter.apply({ source, target, checkpoint, observation, run, backupRef }) || {}
                        applied = true
                    }
                    const finalObservation = {
                        ...observation,
                        recordsApplied: applied ? normalizeNonNegative(applyResult.recordsApplied ?? applyResult.applied ?? observation.recordsRead) : 0,
                        backupRef: backupRef || observation.backupRef,
                        status: sameSnapshot ? 'skipped' : observation.status,
                    }
                    const durationMs = Math.max(0, clock().getTime() - startedAt.getTime())
                    await store.completeRun({
                        runId: run.id,
                        sourceId,
                        observation: finalObservation,
                        mode,
                        durationMs,
                        lastReadAt: observation.observedAt,
                        lastAppliedAt: (applied || source.sourceKind === 'postgresql_aggregate') ? observation.observedAt : null,
                        sameSnapshot,
                        connection,
                    })
                    await store.refreshFindings({ now: clock(), sourceId, connection })
                    return {
                        sourceId,
                        status: finalObservation.status,
                        dryRun: mode !== 'apply',
                        idempotent: sameSnapshot,
                        snapshotComplete: observation.snapshotComplete,
                        recordsRead: observation.recordsRead,
                        recordsApplied: finalObservation.recordsApplied,
                        fingerprint: observation.fingerprint,
                        watermark: observation.watermark,
                        durationMs,
                    }
                } catch (error) {
                    const durationMs = Math.max(0, clock().getTime() - startedAt.getTime())
                    const normalizedError = sanitizeSourceError(error)
                    const retryable = normalizedError.retryable && attempt < maxAttempts
                    await store.failRun({
                        runId: run.id,
                        sourceId,
                        observation: { ...failureObservation, backupRef },
                        error,
                        durationMs,
                        retryAt: retryable ? new Date(clock().getTime() + backoff(attempt)).toISOString() : null,
                        deadLetter: !retryable,
                        connection,
                    })
                    await store.refreshFindings({ now: clock(), sourceId, connection })
                    return {
                        sourceId,
                        status: retryable ? 'partial' : 'dead',
                        error: normalizedError,
                        retryAt: retryable ? new Date(clock().getTime() + backoff(attempt)).toISOString() : null,
                    }
                }
            }).catch((error) => {
                if (error?.code === 'SOURCE_LOCK_BUSY') {
                    return { sourceId, status: 'skipped', reason: 'lock_busy', retryable: true }
                }
                throw error
            })
        } finally {
            active.delete(sourceId)
        }
    }

    async function runDue() {
        const now = clock()
        const results = []
        for (const source of catalog) {
            const checkpoint = await store.getCheckpoint(source.id)
            const dueAt = checkpoint?.nextRunAt ? new Date(checkpoint.nextRunAt).getTime() : 0
            if (!dueAt || dueAt <= now.getTime()) {
                results.push(await runSource(source.id, { mode: applyEnabled ? 'apply' : 'dry-run', scheduledAt: now.toISOString() }))
            }
        }
        return results
    }

    function scheduleSource(source) {
        const timer = setInterval(() => { void runSource(source.id, { mode: applyEnabled ? 'apply' : 'dry-run' }) }, source.cadenceMs)
        timers.set(source.id, timer)
    }

    return {
        async start({ runImmediately = true } = {}) {
            if (running) return
            running = true
            for (const source of catalog) scheduleSource(source)
            if (runImmediately) await runDue()
        },
        async stop() {
            if (!running) return
            running = false
            for (const timer of timers.values()) clearInterval(timer)
            timers.clear()
            while (active.size) await new Promise((resolve) => setTimeout(resolve, 5))
        },
        runSource,
        runDue,
        async rollback(sourceId, backupRef) {
            const source = getSource(sourceId)
            const adapter = adapters?.[sourceId]
            if (!source || !adapter || typeof adapter.rollback !== 'function') throw sourceError('SOURCE_ROLLBACK_UNAVAILABLE', false)
            await store.withSourceLock(sourceId, async (connection) => {
                await adapter.rollback({ source, target, backupRef })
                await store.markRollback({ sourceId, backupRef, connection })
                await store.refreshFindings({ now: clock(), sourceId, connection })
            })
            return { sourceId, rolledBack: true, backupRef: backupRef || null }
        },
        isRunning: () => running,
        getActiveSources: () => [...active.keys()],
    }
}
