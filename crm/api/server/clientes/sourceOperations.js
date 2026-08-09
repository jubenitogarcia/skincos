import { createHash } from 'node:crypto'

export const SOURCE_OPERATION_STATUSES = Object.freeze([
    'complete',
    'partial',
    'incomplete',
    'invalid',
    'failed',
    'dead',
    'skipped',
    'unavailable',
])

export const SOURCE_FRESHNESS_STATES = Object.freeze(['healthy', 'preventive', 'high', 'missing'])

const SOURCE_STATUS_SET = new Set(SOURCE_OPERATION_STATUSES)
const SAFE_CODE = /^[A-Z][A-Z0-9_]{1,80}$/
const SAFE_FINGERPRINT = /^sha256:[a-f0-9]{64}$/
const SAFE_WATERMARK = /^[A-Za-z0-9:._+-]{1,160}$/
const SAFE_EXECUTION_KEY = /^[A-Za-z0-9._:-]{1,240}$/
const SAFE_BACKUP_REF = /^[A-Za-z0-9._:-]{1,240}$/
const SAFE_PROOF_KINDS = new Set(['aggregate_count', 'partition_count', 'postgres_relation', 'sheet_snapshot'])
const MAX_COUNT = 2_147_483_647

function sourceError(code, retryable = true, statusCode = 409) {
    const error = new Error(code)
    error.code = code
    error.retryable = retryable
    error.statusCode = statusCode
    return error
}

function boundedCount(value) {
    const parsed = Number(value)
    return Number.isInteger(parsed) && parsed >= 0 && parsed <= MAX_COUNT ? parsed : 0
}

function safeTimestamp(value, fallback) {
    const text = String(value || '').trim()
    if (text && SAFE_WATERMARK.test(text)) return text
    return fallback
}

function safeString(value, maximum = 160) {
    const text = String(value || '').trim()
    return text && text.length <= maximum && !/[\u0000-\u001f\u007f]/.test(text) ? text : null
}

function canonicalize(value) {
    if (value instanceof Date) return value.toISOString()
    if (Array.isArray(value)) return value.map(canonicalize)
    if (value && typeof value === 'object') {
        return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonicalize(value[key])]))
    }
    return value
}

/**
 * Fingerprints only structural, already-sanitized metadata.  Raw records must
 * be fingerprinted by an adapter with its private HMAC key and are never
 * copied to operational state, metrics or logs.
 */
export function aggregateFingerprint(value) {
    return `sha256:${createHash('sha256').update(JSON.stringify(canonicalize(value))).digest('hex')}`
}

export function sourceExecutionKey(batchExecutionKey, sourceId, mode = 'dry-run') {
    const batch = String(batchExecutionKey || '').trim()
    const source = String(sourceId || '').trim()
    const operationMode = String(mode || '').trim()
    if (!SAFE_EXECUTION_KEY.test(batch) || !source || !['dry-run', 'apply'].includes(operationMode)) {
        throw sourceError('SOURCE_EXECUTION_KEY_INVALID', false, 400)
    }
    return `source:${aggregateFingerprint({ batch, source, mode: operationMode }).slice('sha256:'.length)}`
}

export function sanitizeSourceError(error) {
    const code = String(error?.code || '').trim().toUpperCase()
    return {
        code: SAFE_CODE.test(code) ? code : 'SOURCE_OPERATION_FAILED',
        retryable: error?.retryable !== false,
    }
}

function normalizeSnapshotProof(value, sourceId, recordsRead) {
    const source = value && typeof value === 'object' && !Array.isArray(value) ? value : {}
    const kind = String(source.kind || '').trim()
    const expectedRecords = boundedCount(source.expectedRecords)
    const observedRecords = boundedCount(source.observedRecords)
    const expectedPartitions = boundedCount(source.expectedPartitions)
    const observedPartitions = boundedCount(source.observedPartitions)
    const scopeHash = String(source.scopeHash || '').trim()
    const sourceMatches = !source.sourceId || String(source.sourceId).trim() === sourceId
    const complete = source.complete === true &&
        SAFE_PROOF_KINDS.has(kind) &&
        sourceMatches &&
        observedRecords === recordsRead &&
        expectedRecords === observedRecords &&
        expectedPartitions === observedPartitions &&
        SAFE_FINGERPRINT.test(scopeHash)
    return {
        kind: SAFE_PROOF_KINDS.has(kind) ? kind : 'aggregate_count',
        expectedRecords,
        observedRecords,
        expectedPartitions,
        observedPartitions,
        scopeHash: SAFE_FINGERPRINT.test(scopeHash) ? scopeHash : null,
        complete,
    }
}

function sanitizeCoverage(value = {}) {
    const source = value && typeof value === 'object' && !Array.isArray(value) ? value : {}
    const coverage = {}
    for (const key of ['recordsPresent', 'recordsExpected', 'partitionsPresent', 'partitionsExpected', 'divergences']) {
        if (source[key] !== undefined) coverage[key] = boundedCount(source[key])
    }
    for (const key of ['sourceKind', 'schemaVersion']) {
        const text = safeString(source[key], 80)
        if (text) coverage[key] = text
    }
    return coverage
}

function sanitizeCheckpoint(value = {}) {
    const source = value && typeof value === 'object' && !Array.isArray(value) ? value : {}
    const checkpoint = {}
    const nextWatermark = safeTimestamp(source.nextWatermark, null)
    if (nextWatermark) checkpoint.nextWatermark = nextWatermark
    const cursorHash = String(source.cursorHash || '').trim()
    if (SAFE_FINGERPRINT.test(cursorHash)) checkpoint.cursorHash = cursorHash
    return checkpoint
}

export function normalizeSourceObservation(source, raw = {}, observedAt = new Date().toISOString()) {
    if (!source?.id) throw sourceError('SOURCE_DEFINITION_INVALID', false, 500)
    const recordsRead = boundedCount(raw.recordsRead ?? raw.records)
    const recordsApplied = boundedCount(raw.recordsApplied ?? raw.applied)
    const recordsSkipped = boundedCount(raw.recordsSkipped ?? raw.skipped)
    const divergences = boundedCount(raw.divergences)
    const watermark = safeTimestamp(raw.watermark, observedAt)
    const proof = normalizeSnapshotProof(raw.snapshotProof, source.id, recordsRead)
    const providedFingerprint = String(raw.fingerprint || '').trim()
    const fingerprint = SAFE_FINGERPRINT.test(providedFingerprint)
        ? providedFingerprint
        : aggregateFingerprint({
            sourceId: source.id,
            watermark,
            recordsRead,
            divergences,
            proof,
            coverage: sanitizeCoverage(raw.coverage),
        })
    let status = String(raw.status || (proof.complete ? 'complete' : 'incomplete')).trim().toLowerCase()
    if (!SOURCE_STATUS_SET.has(status)) throw sourceError('SOURCE_STATUS_INVALID', false, 400)
    // Every source, including an aggregate derived from PostgreSQL, needs a
    // typed proof of completeness before its absence can be treated as a
    // residual.  An aggregate query is not inherently a complete snapshot.
    if (status === 'complete' && !proof.complete) status = 'incomplete'
    if (raw.configured === false) status = 'unavailable'
    const observation = {
        sourceId: source.id,
        status,
        configured: raw.configured !== false,
        snapshotComplete: proof.complete,
        snapshotProof: proof,
        watermark,
        fingerprint,
        recordsRead,
        recordsApplied,
        recordsSkipped,
        divergences,
        coverage: sanitizeCoverage(raw.coverage),
        checkpoint: sanitizeCheckpoint(raw.checkpoint),
        observedAt,
    }
    // The payload may contain customer data.  It remains available to the
    // in-process adapter for the immediate apply only, but cannot leak through
    // JSON logs, metrics, stores or ordinary object spreading.
    Object.defineProperty(observation, 'snapshot', { value: raw.snapshot, enumerable: false })
    return observation
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

function checkpointSnapshot(checkpoint, mode) {
    const prefix = mode === 'dry-run' ? 'validated' : 'applied'
    return {
        snapshotComplete: checkpoint?.[`${prefix}SnapshotComplete`] === true ||
            (mode === 'apply' && checkpoint?.snapshotComplete === true),
        fingerprint: checkpoint?.[`${prefix}Fingerprint`] ||
            (mode === 'apply' ? checkpoint?.fingerprint || null : null),
    }
}

function validatedWatermark(checkpoint) {
    return checkpoint?.validatedWatermark || checkpoint?.watermark || checkpoint?.appliedWatermark || null
}

export function isSameCompleteSnapshot(checkpoint, observation, { mode = 'apply' } = {}) {
    const snapshot = checkpointSnapshot(checkpoint, mode)
    return snapshot.snapshotComplete && observation.snapshotComplete === true &&
        snapshot.fingerprint === observation.fingerprint
}

export function sourceFreshnessState(lastHealthyAt, now = new Date(), {
    preventiveHours = 20,
    highHours = 48,
} = {}) {
    if (!lastHealthyAt) return 'missing'
    const observedAt = Date.parse(lastHealthyAt)
    if (!Number.isFinite(observedAt)) return 'missing'
    const ageHours = Math.max(0, (now.getTime() - observedAt) / 3_600_000)
    if (ageHours > highHours) return 'high'
    if (ageHours >= preventiveHours) return 'preventive'
    return 'healthy'
}

function assertSafeBackup(backup) {
    const reference = String(backup?.reference || backup?.backupRef || '').trim()
    if (!SAFE_BACKUP_REF.test(reference) || backup?.encrypted !== true || backup?.restorable !== true) {
        throw sourceError('SOURCE_BACKUP_REQUIRED', false, 409)
    }
    const manifestHash = String(backup?.manifestHash || '').trim()
    if (!SAFE_FINGERPRINT.test(manifestHash)) throw sourceError('SOURCE_BACKUP_MANIFEST_INVALID', false, 409)
    return { reference, manifestHash, encrypted: true, restorable: true }
}

function isHealthyResult(result) {
    return result?.status === 'complete' || result?.status === 'skipped'
}

/**
 * Runs one or more source operations under durable per-source locks.  The
 * caller supplies only allowlisted adapters; this runner never accepts a
 * command string or a connector URL from a job payload.
 */
export function createClientesSourceOperationsRunner({
    catalog = [],
    adapters = {},
    store,
    target = 'local',
    applyEnabled = false,
    applyConfirmed = false,
    clock = () => new Date(),
} = {}) {
    if (!store || typeof store.withSourceLock !== 'function') throw sourceError('SOURCE_OPERATIONS_STORE_REQUIRED', false, 500)
    if (!['local', 'staging', 'production'].includes(String(target))) throw sourceError('SOURCE_OPERATIONS_TARGET_UNSAFE', false, 400)
    const byId = new Map(catalog.map((source) => [source.id, source]))
    const active = new Set()

    async function evaluateFindings(sourceId, connection) {
        if (typeof store.refreshFreshnessFindings === 'function') await store.refreshFreshnessFindings({ sourceId, now: clock(), connection })
    }

    async function runSource(sourceId, {
        executionKey,
        mode = 'dry-run',
        force = false,
    } = {}) {
        const source = byId.get(String(sourceId || '').trim())
        if (!source) throw sourceError('SOURCE_UNKNOWN', false, 404)
        const adapter = adapters[source.id]
        if (!SAFE_EXECUTION_KEY.test(String(executionKey || ''))) throw sourceError('SOURCE_EXECUTION_KEY_INVALID', false, 400)
        if (!['dry-run', 'apply'].includes(mode)) throw sourceError('SOURCE_OPERATION_MODE_INVALID', false, 400)
        if (active.has(source.id)) return { sourceId: source.id, status: 'skipped', reason: 'in_flight' }
        active.add(source.id)
        try {
            return await store.withSourceLock(source.id, async (connection) => {
                const checkpoint = await store.getCheckpoint(source.id, connection)
                const run = await store.beginRun({ sourceId: source.id, executionKey, mode, connection })
                if (run?.completed === true) return { sourceId: source.id, status: 'skipped', idempotent: true, reason: 'execution_key' }
                if (!adapter || typeof adapter.read !== 'function') {
                    const error = sourceError('SOURCE_ADAPTER_MISSING', false, 503)
                    await store.failRun({ runId: run.id, sourceId: source.id, status: 'unavailable', error, connection })
                    await evaluateFindings(source.id, connection)
                    return { sourceId: source.id, status: 'unavailable', error: sanitizeSourceError(error) }
                }
                if (run?.status === 'applying') {
                    if (typeof adapter.reconcile !== 'function') {
                        const error = sourceError('SOURCE_APPLY_RECOVERY_REQUIRED', false, 409)
                        await store.failRun({ runId: run.id, sourceId: source.id, status: 'invalid', error, connection })
                        await evaluateFindings(source.id, connection)
                        return { sourceId: source.id, status: 'invalid', error: sanitizeSourceError(error) }
                    }
                    const recovered = await adapter.reconcile({ source, run, checkpoint, target, connection })
                    if (recovered?.applied !== true) {
                        const error = sourceError('SOURCE_APPLY_RECOVERY_REQUIRED', false, 409)
                        await store.failRun({ runId: run.id, sourceId: source.id, status: 'invalid', error, connection })
                        await evaluateFindings(source.id, connection)
                        return { sourceId: source.id, status: 'invalid', error: sanitizeSourceError(error) }
                    }
                    await store.completeRun({ runId: run.id, sourceId: source.id, observation: recovered.observation, mode: 'apply', applied: true, connection })
                    await evaluateFindings(source.id, connection)
                    return { sourceId: source.id, status: 'complete', recovered: true, idempotent: true }
                }

                const startedAt = clock()
                let observation = null
                try {
                    observation = normalizeSourceObservation(source, await adapter.read({ source, checkpoint, target, connection, now: startedAt }), startedAt.toISOString())
                    await store.recordRead({ runId: run.id, sourceId: source.id, observation, connection })
                    if (observation.status !== 'complete' || !observation.snapshotComplete) {
                        const status = observation.status === 'unavailable' ? 'unavailable' : 'incomplete'
                        const error = sourceError(status === 'unavailable' ? 'SOURCE_CONNECTOR_UNAVAILABLE' : 'SOURCE_SNAPSHOT_INCOMPLETE', false, 424)
                        await store.failRun({ runId: run.id, sourceId: source.id, status, observation, error, connection })
                        await evaluateFindings(source.id, connection)
                        return { sourceId: source.id, status, error: sanitizeSourceError(error) }
                    }
                    const newestValidatedWatermark = validatedWatermark(checkpoint)
                    if (newestValidatedWatermark && compareWatermarks(observation.watermark, newestValidatedWatermark) < 0 && !isSameCompleteSnapshot(checkpoint, observation, { mode })) {
                        const error = sourceError('SOURCE_SNAPSHOT_OLDER_THAN_CHECKPOINT', false, 409)
                        await store.failRun({ runId: run.id, sourceId: source.id, status: 'invalid', observation, error, connection })
                        await evaluateFindings(source.id, connection)
                        return { sourceId: source.id, status: 'invalid', error: sanitizeSourceError(error) }
                    }
                    // Force means "run now", never "reapply" or "accept an
                    // older snapshot".  This preserves idempotence after a
                    // retry and prevents an old reader from overwriting a new
                    // snapshot obtained by another process.
                    const sameSnapshot = isSameCompleteSnapshot(checkpoint, observation, { mode })
                    if (sameSnapshot) {
                        await store.completeRun({ runId: run.id, sourceId: source.id, observation, mode, applied: false, skipped: true, connection })
                        await evaluateFindings(source.id, connection)
                        return { sourceId: source.id, status: 'skipped', idempotent: true, recordsRead: observation.recordsRead, recordsApplied: 0 }
                    }
                    if (mode === 'dry-run') {
                        await store.completeRun({ runId: run.id, sourceId: source.id, observation, mode, applied: false, connection })
                        await evaluateFindings(source.id, connection)
                        return { sourceId: source.id, status: 'complete', dryRun: true, recordsRead: observation.recordsRead, recordsApplied: 0, snapshotComplete: true }
                    }
                    if (!applyEnabled || !applyConfirmed || typeof adapter.apply !== 'function' || typeof adapter.backup !== 'function') {
                        throw sourceError('SOURCE_APPLY_DISABLED', false, 403)
                    }
                    const backup = assertSafeBackup(await adapter.backup({ source, checkpoint, observation, target, executionKey, connection }))
                    await store.markApplying({ runId: run.id, sourceId: source.id, observation, backup, connection })
                    const applied = await adapter.apply({
                        source,
                        checkpoint,
                        observation,
                        target,
                        executionKey,
                        allowRetireMissing: false,
                        connection,
                    }) || {}
                    if (Number(applied.retiredRecords || applied.deletedRecords || 0) > 0) throw sourceError('SOURCE_RETIREMENT_FORBIDDEN', false, 409)
                    const finalObservation = {
                        ...observation,
                        recordsApplied: boundedCount(applied.recordsApplied ?? applied.applied ?? observation.recordsRead),
                    }
                    await store.completeRun({ runId: run.id, sourceId: source.id, observation: finalObservation, mode, applied: true, backup, connection })
                    await evaluateFindings(source.id, connection)
                    return { sourceId: source.id, status: 'complete', dryRun: false, recordsRead: finalObservation.recordsRead, recordsApplied: finalObservation.recordsApplied, snapshotComplete: true }
                } catch (error) {
                    const normalized = sanitizeSourceError(error)
                    await store.failRun({ runId: run.id, sourceId: source.id, status: normalized.retryable ? 'partial' : 'dead', observation, error, connection })
                    await evaluateFindings(source.id, connection)
                    const result = { sourceId: source.id, status: normalized.retryable ? 'partial' : 'dead', error: normalized }
                    if (normalized.retryable) {
                        error.sourceOperation = result
                        throw error
                    }
                    return result
                }
            })
        } catch (error) {
            if (error?.code === 'SOURCE_LOCK_BUSY') return { sourceId: source.id, status: 'skipped', reason: 'locked' }
            throw error
        } finally {
            active.delete(source.id)
        }
    }

    async function runDue({ executionKey, mode = 'dry-run', force = false } = {}) {
        const now = clock().getTime()
        const results = []
        const retryableFailures = []
        for (const source of catalog) {
            const checkpoint = await store.getCheckpoint(source.id)
            const nextRunAt = Date.parse(checkpoint?.nextRunAt || '')
            if (force || !Number.isFinite(nextRunAt) || nextRunAt <= now) {
                try {
                    results.push(await runSource(source.id, {
                        executionKey: sourceExecutionKey(executionKey, source.id, mode),
                        mode,
                        force,
                    }))
                } catch (error) {
                    const result = error?.sourceOperation || {
                        sourceId: source.id,
                        status: 'partial',
                        error: sanitizeSourceError(error),
                    }
                    results.push(result)
                    if (result.error?.retryable !== false) retryableFailures.push(result)
                }
            }
        }
        const operational = typeof store.getOperationalView === 'function'
            ? await store.getOperationalView({ now: clock() })
            : []
        const unhealthyRequired = operational.filter((item) => item.required && !['complete', 'skipped'].includes(item.status))
        const healthy = unhealthyRequired.length === 0
        if (retryableFailures.length) {
            const error = sourceError('SOURCE_OPERATION_RETRY_REQUIRED', true, 503)
            error.sourceOperations = retryableFailures.map(({ sourceId, error: sourceFailure }) => ({ sourceId, error: sourceFailure }))
            throw error
        }
        return { results, operational, healthy, ready: healthy, unhealthyRequired: unhealthyRequired.map((item) => item.sourceId) }
    }

    async function rollbackSource(sourceId, { backupReference, executionKey } = {}) {
        const source = byId.get(String(sourceId || '').trim())
        const adapter = adapters[source?.id]
        if (!source || !adapter || typeof adapter.rollback !== 'function') throw sourceError('SOURCE_ROLLBACK_UNAVAILABLE', false, 409)
        if (!SAFE_BACKUP_REF.test(String(backupReference || '')) || !SAFE_EXECUTION_KEY.test(String(executionKey || ''))) {
            throw sourceError('SOURCE_ROLLBACK_REQUEST_INVALID', false, 400)
        }
        return store.withSourceLock(source.id, async (connection) => {
            const result = await adapter.rollback({ source, backupReference, executionKey, target, connection })
            if (result?.rolledBack !== true) throw sourceError('SOURCE_ROLLBACK_FAILED', false, 409)
            await store.recordRollback({ sourceId: source.id, backupReference, executionKey, connection })
            await evaluateFindings(source.id, connection)
            return { sourceId: source.id, rolledBack: true }
        })
    }

    return { runSource, runDue, rollbackSource }
}

export const __testables = {
    boundedCount,
    normalizeSnapshotProof,
    sanitizeCoverage,
    sanitizeCheckpoint,
    assertSafeBackup,
    sourceError,
    isHealthyResult,
}
