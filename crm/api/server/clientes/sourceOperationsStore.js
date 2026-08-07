import { createPgPool } from '../harmonia/store/pg.js'
import { CLIENTES_SOURCE_CATALOG } from './sourceCatalog.js'
import { compareWatermarks, sourceFreshnessState } from './sourceOperations.js'
import { CLIENTES_SOURCE_OPERATIONS_MIGRATION_ID } from './sourceOperationsMigration.js'

const SOURCE_LOCK_NAMESPACE = 'crm_atendimento.clientes_source_operations'
const QUALITY_ACTOR = 'clientes-source-operations'
const SOURCE_ID = /^[a-z][a-z0-9_.-]{2,120}$/
const EXECUTION_KEY = /^[A-Za-z0-9._:-]{1,240}$/
const HASH = /^sha256:[a-f0-9]{64}$/
// A watermark is either an opaque hash or an ISO-8601 instant.  Accept `Z`
// explicitly: it is the canonical serialization emitted by JavaScript Dates.
const WATERMARK = /^(sha256:[a-f0-9]{64}|[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9:.+Z-]{8,32})$/
const BACKUP_REFERENCE = /^[A-Za-z0-9._:-]{1,240}$/
const ERROR_CODE = /^[A-Z][A-Z0-9_]{1,80}$/
const SOURCE_STATUS = new Set(['reading', 'applying', 'complete', 'partial', 'incomplete', 'invalid', 'unavailable', 'dead', 'skipped'])
const TERMINAL_EXECUTION_STATUSES = new Set(['complete', 'skipped', 'incomplete', 'invalid', 'unavailable', 'dead'])
const MAX_COUNT = 2_147_483_647

function operationError(code, retryable = false, statusCode = 409) {
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

function nullableCount(value) {
    if (value === undefined || value === null || value === '') return null
    const parsed = Number(value)
    return Number.isInteger(parsed) && parsed >= 0 && parsed <= MAX_COUNT ? parsed : null
}

function safeText(value, maximum = 160) {
    const text = String(value || '').trim()
    return text && text.length <= maximum && !/[\u0000-\u001f\u007f]/.test(text) ? text : null
}

function safeWatermark(value) {
    const text = safeText(value, 160)
    if (!text || !WATERMARK.test(text)) return null
    if (HASH.test(text)) return text
    return Number.isFinite(Date.parse(text)) ? text : null
}

function safeHash(value) {
    const text = safeText(value, 80)
    return text && HASH.test(text) ? text : null
}

function safeIdentifier(value, maximum = 80) {
    const text = safeText(value, maximum)
    return text && /^[A-Za-z0-9_.-]+$/.test(text) ? text : null
}

function safeCode(value) {
    const text = String(value || '').trim().toUpperCase()
    return ERROR_CODE.test(text) ? text : 'SOURCE_OPERATION_FAILED'
}

function assertSourceId(value) {
    const sourceId = String(value || '').trim()
    if (!SOURCE_ID.test(sourceId)) throw operationError('SOURCE_ID_INVALID', false, 400)
    return sourceId
}

function assertExecutionKey(value) {
    const executionKey = String(value || '').trim()
    if (!EXECUTION_KEY.test(executionKey)) throw operationError('SOURCE_EXECUTION_KEY_INVALID', false, 400)
    return executionKey
}

function assertMode(value) {
    const mode = String(value || '').trim()
    if (mode !== 'dry-run' && mode !== 'apply') throw operationError('SOURCE_OPERATION_MODE_INVALID', false, 400)
    return mode
}

function assertStatus(value) {
    const status = String(value || '').trim().toLowerCase()
    if (!SOURCE_STATUS.has(status)) throw operationError('SOURCE_OPERATION_STATUS_INVALID', false, 400)
    return status
}

function assertBackup(backup) {
    const reference = String(backup?.reference || backup?.backupRef || '').trim()
    const manifestHash = String(backup?.manifestHash || '').trim()
    if (!BACKUP_REFERENCE.test(reference) || backup?.encrypted !== true || backup?.restorable !== true) {
        throw operationError('SOURCE_BACKUP_REQUIRED', false, 409)
    }
    if (!HASH.test(manifestHash)) throw operationError('SOURCE_BACKUP_MANIFEST_INVALID', false, 409)
    return { reference, manifestHash, encrypted: true, restorable: true }
}

function sourceMetadata(sourceId, observation = {}) {
    if (!observation || typeof observation !== 'object' || Array.isArray(observation)) {
        throw operationError('SOURCE_OBSERVATION_INVALID', false, 400)
    }
    if (observation.sourceId && String(observation.sourceId).trim() !== sourceId) {
        throw operationError('SOURCE_OBSERVATION_SOURCE_MISMATCH', false, 400)
    }
    const proof = observation.snapshotProof && typeof observation.snapshotProof === 'object' && !Array.isArray(observation.snapshotProof)
        ? observation.snapshotProof
        : {}
    const coverage = observation.coverage && typeof observation.coverage === 'object' && !Array.isArray(observation.coverage)
        ? observation.coverage
        : {}
    const checkpoint = observation.checkpoint && typeof observation.checkpoint === 'object' && !Array.isArray(observation.checkpoint)
        ? observation.checkpoint
        : {}
    const proofKind = ['aggregate_count', 'partition_count', 'postgres_relation', 'sheet_snapshot'].includes(String(proof.kind || '').trim())
        ? String(proof.kind).trim()
        : null
    const coverageSourceKind = safeIdentifier(coverage.sourceKind, 80)
    const coverageSchemaVersion = safeIdentifier(coverage.schemaVersion, 80)
    if ((coverage.sourceKind !== undefined && coverage.sourceKind !== null && !coverageSourceKind) ||
        (coverage.schemaVersion !== undefined && coverage.schemaVersion !== null && !coverageSchemaVersion)) {
        throw operationError('SOURCE_COVERAGE_METADATA_INVALID', false, 400)
    }
    const metadata = {
        watermark: safeWatermark(observation.watermark),
        fingerprint: safeHash(observation.fingerprint),
        snapshotComplete: observation.snapshotComplete === true,
        proofKind,
        proofExpectedRecords: nullableCount(proof.expectedRecords),
        proofObservedRecords: nullableCount(proof.observedRecords),
        proofExpectedPartitions: nullableCount(proof.expectedPartitions),
        proofObservedPartitions: nullableCount(proof.observedPartitions),
        proofScopeHash: safeHash(proof.scopeHash),
        recordsRead: boundedCount(observation.recordsRead),
        recordsApplied: boundedCount(observation.recordsApplied),
        recordsSkipped: boundedCount(observation.recordsSkipped),
        divergences: boundedCount(observation.divergences),
        coverageRecordsPresent: nullableCount(coverage.recordsPresent),
        coverageRecordsExpected: nullableCount(coverage.recordsExpected),
        coveragePartitionsPresent: nullableCount(coverage.partitionsPresent),
        coveragePartitionsExpected: nullableCount(coverage.partitionsExpected),
        coverageDivergences: nullableCount(coverage.divergences),
        coverageSourceKind,
        coverageSchemaVersion,
        checkpointNextWatermark: safeWatermark(checkpoint.nextWatermark),
        checkpointCursorHash: safeHash(checkpoint.cursorHash),
    }
    if (metadata.snapshotComplete && (!metadata.watermark || !metadata.fingerprint || !metadata.proofKind || !metadata.proofScopeHash ||
        metadata.proofExpectedRecords !== metadata.proofObservedRecords ||
        metadata.proofExpectedPartitions !== metadata.proofObservedPartitions ||
        metadata.proofObservedRecords !== metadata.recordsRead)) {
        throw operationError('SOURCE_SNAPSHOT_PROOF_INVALID', false, 424)
    }
    return metadata
}

function mapCheckpoint(row) {
    if (!row) return null
    const reconciliationRequired = row.reconciliation_required === true
    return {
        sourceId: row.source_id,
        status: row.last_status || 'missing',
        watermark: row.validated_watermark || null,
        fingerprint: row.validated_fingerprint || null,
        snapshotComplete: row.validated_snapshot_complete === true,
        validatedWatermark: row.validated_watermark || null,
        validatedFingerprint: row.validated_fingerprint || null,
        validatedSnapshotComplete: row.validated_snapshot_complete === true,
        validatedAt: row.validated_at || null,
        validatedProof: {
            kind: row.validated_proof_kind || null,
            expectedRecords: boundedCount(row.validated_proof_expected_records),
            observedRecords: boundedCount(row.validated_proof_observed_records),
            expectedPartitions: boundedCount(row.validated_proof_expected_partitions),
            observedPartitions: boundedCount(row.validated_proof_observed_partitions),
            scopeHash: row.validated_proof_scope_hash || null,
        },
        // Resume cursors only advance with a complete, accepted observation.
        // They are hashes/watermarks rather than provider tokens, so the
        // durable checkpoint cannot leak an external source cursor.
        resumeWatermark: row.resume_watermark || row.validated_watermark || null,
        resumeCursorHash: row.resume_cursor_hash || null,
        checkpoint: {
            nextWatermark: row.resume_watermark || row.validated_watermark || null,
            cursorHash: row.resume_cursor_hash || null,
        },
        appliedWatermark: row.applied_watermark || null,
        appliedFingerprint: row.applied_fingerprint || null,
        // A rollback invalidates the prior application for retry purposes even
        // though the immutable applied evidence remains available below.
        appliedSnapshotComplete: !reconciliationRequired && row.applied_snapshot_complete === true,
        appliedEvidenceSnapshotComplete: row.applied_snapshot_complete === true,
        appliedAt: row.applied_at || null,
        recordsRead: boundedCount(row.last_records_read),
        recordsApplied: boundedCount(row.last_records_applied),
        recordsSkipped: boundedCount(row.last_records_skipped),
        divergences: boundedCount(row.last_divergences),
        lastReadAt: row.last_read_at || null,
        lastAttemptAt: row.last_attempt_at || null,
        lastDurationMs: boundedCount(row.last_duration_ms),
        lastErrorCode: row.last_error_code || null,
        lastErrorRetryable: row.last_error_retryable === true,
        lastErrorAt: row.last_error_at || null,
        consecutiveFailures: boundedCount(row.consecutive_failures),
        retries: boundedCount(row.retry_count),
        nextRunAt: row.next_run_at || null,
        reconciliationRequired,
        rollbackAt: row.rollback_at || null,
    }
}

function mapRun(row) {
    if (!row) return null
    const status = row.status || 'reading'
    return {
        id: row.id,
        sourceId: row.source_id,
        executionKey: row.execution_key,
        mode: row.mode,
        status,
        attempt: boundedCount(row.attempt_count) || 1,
        completed: TERMINAL_EXECUTION_STATUSES.has(status),
        startedAt: row.started_at || null,
        readAt: row.read_at || null,
        applyingAt: row.applying_at || null,
        completedAt: row.completed_at || null,
        backupId: row.backup_id || null,
    }
}

function freshnessInput(checkpoint, now) {
    if (!checkpoint) return { state: 'missing', ageHours: null, healthy: false, severity: 'high' }
    const validAt = checkpoint.validatedAt
    const state = checkpoint.reconciliationRequired ? 'missing' : sourceFreshnessState(validAt, now)
    const timestamp = Date.parse(validAt || '')
    const ageHours = Number.isFinite(timestamp) ? Math.max(0, Math.floor((now.getTime() - timestamp) / 3_600_000)) : null
    const executionHealthy = ['complete', 'skipped'].includes(checkpoint.status) && !checkpoint.reconciliationRequired
    const healthy = state === 'healthy' && executionHealthy
    const severity = healthy
        ? 'low'
        : state === 'high' || state === 'missing' || ['dead', 'invalid'].includes(checkpoint.status)
            ? 'high'
            : 'medium'
    return { state, ageHours, healthy, severity }
}

function nextRetryAt(now, failures) {
    const exponent = Math.max(0, Math.min(5, Number(failures || 1) - 1))
    return new Date(now.getTime() + Math.min(900_000, 30_000 * Math.pow(2, exponent)))
}

function cadenceNextRun(source, now) {
    const cadence = Number(source?.cadenceMs)
    const interval = Number.isFinite(cadence) && cadence > 0 ? cadence : 900_000
    return new Date(now.getTime() + interval)
}

function findingTransition(existing, observedCount) {
    const previousStatus = existing?.status || null
    const previousCount = boundedCount(existing?.observed_count)
    const shouldReopen = observedCount > 0 && ['resolved', 'suppressed'].includes(previousStatus)
    const shouldResolve = observedCount === 0 && ['open', 'acknowledged', 'in_progress'].includes(previousStatus)
    const nextStatus = shouldReopen ? 'open' : shouldResolve ? 'resolved' : (previousStatus || (observedCount > 0 ? 'open' : 'resolved'))
    const shouldStartWindow = observedCount > 0 && (!existing || previousCount === 0 || shouldReopen)
    const eventType = shouldReopen
        ? 'reopened'
        : shouldResolve
            ? 'cleared'
            : !existing && observedCount > 0
                ? 'detected'
                : previousCount !== observedCount
                    ? (observedCount > 0 ? 'detected' : 'cleared')
                    : 'observed'
    return {
        nextStatus,
        shouldReopen,
        shouldResolve,
        shouldStartWindow,
        shouldRecord: !existing || shouldReopen || shouldResolve || previousCount !== observedCount,
        eventType,
    }
}

/**
 * The source lock is session-scoped intentionally. It protects a full source
 * read/backup/apply sequence while each persistence method below keeps its own
 * short transaction, so network I/O is never held inside a database transaction.
 */
export function createClientesSourceOperationsStore({
    pool,
    databaseUrl,
    catalog = CLIENTES_SOURCE_CATALOG,
    clock = () => new Date(),
} = {}) {
    const pgPool = pool || createPgPool(databaseUrl || process.env.DATABASE_URL)
    if (!pgPool) throw operationError('SOURCE_OPERATIONS_POOL_REQUIRED', false, 503)
    const sourceById = new Map((catalog || []).map((source) => [source.id, source]))

    async function withTransaction(connection, callback) {
        const client = connection || await pgPool.connect()
        let transactionOpen = false
        try {
            await client.query('begin')
            transactionOpen = true
            await client.query(`set local lock_timeout = '3s'`)
            await client.query(`set local statement_timeout = '30s'`)
            const result = await callback(client)
            await client.query('commit')
            transactionOpen = false
            return result
        } catch (error) {
            if (transactionOpen) {
                try { await client.query('rollback') } catch { /* preserve original failure */ }
            }
            throw error
        } finally {
            if (!connection) client.release()
        }
    }

    async function readCheckpoint(sourceId, connection = null, { forUpdate = false } = {}) {
        const db = connection || pgPool
        const result = await db.query(`select * from crm_atendimento.clientes_source_operation_checkpoints
            where source_id = $1${forUpdate ? ' for update' : ''}`, [sourceId])
        return result.rows[0] || null
    }

    async function loadRun(client, runId, sourceId, { forUpdate = false } = {}) {
        const result = await client.query(`select * from crm_atendimento.clientes_source_operation_runs
            where id = $1 and source_id = $2${forUpdate ? ' for update' : ''}`, [runId, sourceId])
        const row = result.rows[0] || null
        if (!row) throw operationError('SOURCE_OPERATION_RUN_NOT_FOUND', false, 404)
        return row
    }

    async function recordRunEvent(client, run, eventType, status = null, errorCode = null) {
        await client.query(`insert into crm_atendimento.clientes_source_operation_events(
                run_id, source_id, execution_key, event_type, status, attempt_count, error_code)
            values ($1,$2,$3,$4,$5,$6,$7)
            on conflict(run_id, event_type, attempt_count) do nothing`, [
            run.id,
            run.source_id,
            run.execution_key,
            eventType,
            status,
            boundedCount(run.attempt_count) || 1,
            errorCode,
        ])
    }

    async function writeReadingCheckpoint(client, { sourceId, run, metadata }) {
        await client.query(`insert into crm_atendimento.clientes_source_operation_checkpoints(
                source_id, last_run_id, last_status, last_attempt_at, last_read_at,
                last_records_read, last_records_applied, last_records_skipped, last_divergences, updated_at)
            values ($1,$2,'reading',now(),now(),$3,$4,$5,$6,now())
            on conflict(source_id) do update set
                last_run_id = excluded.last_run_id,
                last_status = excluded.last_status,
                last_attempt_at = excluded.last_attempt_at,
                last_read_at = excluded.last_read_at,
                last_records_read = excluded.last_records_read,
                last_records_applied = excluded.last_records_applied,
                last_records_skipped = excluded.last_records_skipped,
                last_divergences = excluded.last_divergences,
                updated_at = now()`, [
            sourceId,
            run.id,
            metadata.recordsRead,
            metadata.recordsApplied,
            metadata.recordsSkipped,
            metadata.divergences,
        ])
    }

    async function ensureBackup(client, { sourceId, run, backup }) {
        const safe = assertBackup(backup)
        const inserted = await client.query(`insert into crm_atendimento.clientes_source_operation_backups(
                source_id, run_id, backup_reference, manifest_hash, encrypted, restorable)
            values ($1,$2,$3,$4,true,true)
            on conflict(run_id) do nothing
            returning id, backup_reference, manifest_hash, encrypted, restorable`, [sourceId, run.id, safe.reference, safe.manifestHash])
        const result = inserted.rows[0]
            ? inserted
            : await client.query(`select id, backup_reference, manifest_hash, encrypted, restorable
                from crm_atendimento.clientes_source_operation_backups where run_id = $1`, [run.id])
        const row = result.rows[0]
        if (!row || row.backup_reference !== safe.reference || row.manifest_hash !== safe.manifestHash ||
            row.encrypted !== true || row.restorable !== true) {
            throw operationError('SOURCE_BACKUP_MANIFEST_CONFLICT', false, 409)
        }
        return row
    }

    async function completeCheckpoint(client, { sourceId, source, run, metadata, applied, skipped }) {
        const prior = await readCheckpoint(sourceId, client, { forUpdate: true })
        const previous = mapCheckpoint(prior)
        if (previous?.validatedWatermark && compareWatermarks(metadata.watermark, previous.validatedWatermark) < 0 &&
            metadata.fingerprint !== previous.validatedFingerprint) {
            throw operationError('SOURCE_SNAPSHOT_OLDER_THAN_CHECKPOINT', false, 409)
        }
        const nextRunAt = cadenceNextRun(source, clock())
        const status = skipped ? 'skipped' : 'complete'
        const accepted = metadata.snapshotComplete === true
        if (!accepted) throw operationError('SOURCE_SNAPSHOT_PROOF_INVALID', false, 424)
        // A connector cursor is itself sensitive source state.  Persist only
        // the validated watermark and an adapter-produced cursor hash; never
        // a provider cursor/token.  An incomplete or failed observation never
        // reaches this path, so it cannot advance resume state.
        const resumeWatermark = metadata.checkpointNextWatermark || metadata.watermark
        const resumeCursorHash = metadata.checkpointCursorHash || null
        const appliedNow = applied === true
        await client.query(`insert into crm_atendimento.clientes_source_operation_checkpoints(
                source_id, validated_watermark, validated_fingerprint, validated_snapshot_complete, validated_at,
                validated_proof_kind, validated_proof_expected_records, validated_proof_observed_records,
                validated_proof_expected_partitions, validated_proof_observed_partitions, validated_proof_scope_hash,
                validated_records_read, validated_divergences,
                resume_watermark, resume_cursor_hash, resume_updated_at,
                applied_watermark, applied_fingerprint, applied_snapshot_complete, applied_at, applied_records,
                last_run_id, last_status, last_attempt_at, last_read_at, last_duration_ms,
                last_records_read, last_records_applied, last_records_skipped, last_divergences,
                last_error_code, last_error_retryable, last_error_at, consecutive_failures, retry_count,
                next_run_at, reconciliation_required, updated_at)
            values ($1,$2,$3,true,now(),$4,$5,$6,$7,$8,$9,$10,$11,
                $12,$13,now(),
                case when $14 then $2 else null end, case when $14 then $3 else null end,
                $14, case when $14 then now() else null end, case when $14 then $15 else 0 end,
                $16,$17,now(),(select read_at from crm_atendimento.clientes_source_operation_runs where id=$16),
                (select duration_ms from crm_atendimento.clientes_source_operation_runs where id=$16),
                $10,$15,$18,$11,null,null,null,0,0,$19,false,now())
            on conflict(source_id) do update set
                validated_watermark = excluded.validated_watermark,
                validated_fingerprint = excluded.validated_fingerprint,
                validated_snapshot_complete = true,
                validated_at = excluded.validated_at,
                validated_proof_kind = excluded.validated_proof_kind,
                validated_proof_expected_records = excluded.validated_proof_expected_records,
                validated_proof_observed_records = excluded.validated_proof_observed_records,
                validated_proof_expected_partitions = excluded.validated_proof_expected_partitions,
                validated_proof_observed_partitions = excluded.validated_proof_observed_partitions,
                validated_proof_scope_hash = excluded.validated_proof_scope_hash,
                validated_records_read = excluded.validated_records_read,
                validated_divergences = excluded.validated_divergences,
                resume_watermark = excluded.resume_watermark,
                resume_cursor_hash = excluded.resume_cursor_hash,
                resume_updated_at = excluded.resume_updated_at,
                applied_watermark = case when $14 then excluded.applied_watermark else crm_atendimento.clientes_source_operation_checkpoints.applied_watermark end,
                applied_fingerprint = case when $14 then excluded.applied_fingerprint else crm_atendimento.clientes_source_operation_checkpoints.applied_fingerprint end,
                applied_snapshot_complete = case when $14 then true else crm_atendimento.clientes_source_operation_checkpoints.applied_snapshot_complete end,
                applied_at = case when $14 then excluded.applied_at else crm_atendimento.clientes_source_operation_checkpoints.applied_at end,
                applied_records = case when $14 then excluded.applied_records else crm_atendimento.clientes_source_operation_checkpoints.applied_records end,
                last_run_id = excluded.last_run_id,
                last_status = excluded.last_status,
                last_attempt_at = excluded.last_attempt_at,
                last_read_at = excluded.last_read_at,
                last_duration_ms = excluded.last_duration_ms,
                last_records_read = excluded.last_records_read,
                last_records_applied = excluded.last_records_applied,
                last_records_skipped = excluded.last_records_skipped,
                last_divergences = excluded.last_divergences,
                last_error_code = null,
                last_error_retryable = null,
                last_error_at = null,
                consecutive_failures = 0,
                next_run_at = excluded.next_run_at,
                reconciliation_required = case when $14 then false else crm_atendimento.clientes_source_operation_checkpoints.reconciliation_required end,
                updated_at = now()`, [
            sourceId,
            metadata.watermark,
            metadata.fingerprint,
            metadata.proofKind,
            metadata.proofExpectedRecords,
            metadata.proofObservedRecords,
            metadata.proofExpectedPartitions,
            metadata.proofObservedPartitions,
            metadata.proofScopeHash,
            metadata.recordsRead,
            metadata.divergences,
            resumeWatermark,
            resumeCursorHash,
            appliedNow,
            metadata.recordsApplied,
            run.id,
            status,
            metadata.recordsSkipped,
            nextRunAt,
        ])
    }

    async function upsertFailureCheckpoint(client, { sourceId, source, run, metadata, status, error, preserveApplying }) {
        const prior = await readCheckpoint(sourceId, client, { forUpdate: true })
        const failures = boundedCount(prior?.consecutive_failures) + 1
        const retryable = error?.retryable !== false
        const nextRunAt = status === 'dead' ? null
            : status === 'partial' ? nextRetryAt(clock(), failures)
                : cadenceNextRun(source, clock())
        const errorCode = safeCode(error?.code)
        await client.query(`insert into crm_atendimento.clientes_source_operation_checkpoints(
                source_id, last_run_id, last_status, last_attempt_at, last_read_at, last_duration_ms,
                last_records_read, last_records_applied, last_records_skipped, last_divergences,
                last_error_code, last_error_retryable, last_error_at, consecutive_failures, retry_count,
                next_run_at, reconciliation_required, updated_at)
            values ($1,$2,$3,now(),$4,$5,$6,$7,$8,$9,$10,$11,now(),1,
                case when $11 then 1 else 0 end,$12,$13,now())
            on conflict(source_id) do update set
                last_run_id = excluded.last_run_id,
                last_status = excluded.last_status,
                last_attempt_at = excluded.last_attempt_at,
                last_read_at = coalesce(excluded.last_read_at, crm_atendimento.clientes_source_operation_checkpoints.last_read_at),
                last_duration_ms = excluded.last_duration_ms,
                last_records_read = excluded.last_records_read,
                last_records_applied = excluded.last_records_applied,
                last_records_skipped = excluded.last_records_skipped,
                last_divergences = excluded.last_divergences,
                last_error_code = excluded.last_error_code,
                last_error_retryable = excluded.last_error_retryable,
                last_error_at = excluded.last_error_at,
                consecutive_failures = crm_atendimento.clientes_source_operation_checkpoints.consecutive_failures + 1,
                retry_count = crm_atendimento.clientes_source_operation_checkpoints.retry_count + case when $11 then 1 else 0 end,
                next_run_at = excluded.next_run_at,
                reconciliation_required = crm_atendimento.clientes_source_operation_checkpoints.reconciliation_required or $13,
                updated_at = now()`, [
            sourceId,
            run.id,
            preserveApplying ? 'partial' : status,
            run.read_at || null,
            boundedCount(run.duration_ms),
            metadata?.recordsRead || 0,
            metadata?.recordsApplied || 0,
            metadata?.recordsSkipped || 0,
            metadata?.divergences || 0,
            errorCode,
            retryable,
            nextRunAt,
            preserveApplying,
        ])
    }

    async function withSourceLock(sourceIdValue, callback) {
        const sourceId = assertSourceId(sourceIdValue)
        if (typeof callback !== 'function') throw operationError('SOURCE_LOCK_CALLBACK_REQUIRED', false, 500)
        const client = await pgPool.connect()
        let locked = false
        try {
            const result = await client.query(`select pg_try_advisory_lock(hashtext($1), hashtext($2)) as acquired`, [
                SOURCE_LOCK_NAMESPACE,
                sourceId,
            ])
            if (result.rows[0]?.acquired !== true) throw operationError('SOURCE_LOCK_BUSY', true, 409)
            locked = true
            return await callback(client)
        } finally {
            if (locked) {
                try {
                    await client.query(`select pg_advisory_unlock(hashtext($1), hashtext($2))`, [
                        SOURCE_LOCK_NAMESPACE,
                        sourceId,
                    ])
                } catch { /* connection cleanup releases the session lock */ }
            }
            client.release()
        }
    }

    async function getCheckpoint(sourceIdValue, connection = null) {
        const sourceId = assertSourceId(sourceIdValue)
        return mapCheckpoint(await readCheckpoint(sourceId, connection))
    }

    async function beginRun({ sourceId: sourceIdValue, executionKey: executionKeyValue, mode: modeValue, connection = null } = {}) {
        const sourceId = assertSourceId(sourceIdValue)
        const executionKey = assertExecutionKey(executionKeyValue)
        const mode = assertMode(modeValue)
        return withTransaction(connection, async (client) => {
            const inserted = await client.query(`insert into crm_atendimento.clientes_source_operation_runs(
                    source_id, execution_key, mode, status, attempt_count, started_at)
                values ($1,$2,$3,'reading',1,now())
                on conflict(source_id, execution_key, mode) do nothing
                returning *`, [sourceId, executionKey, mode])
            let run = inserted.rows[0] || null
            if (!run) {
                const currentResult = await client.query(`select * from crm_atendimento.clientes_source_operation_runs
                    where source_id=$1 and execution_key=$2 and mode=$3 for update`, [sourceId, executionKey, mode])
                const current = currentResult.rows[0]
                if (!current) throw operationError('SOURCE_OPERATION_RUN_CONFLICT', true, 409)
                if (TERMINAL_EXECUTION_STATUSES.has(current.status) || current.status === 'applying') return mapRun(current)
                const retried = await client.query(`update crm_atendimento.clientes_source_operation_runs set
                        status='reading', attempt_count=attempt_count+1, started_at=now(), read_at=null,
                        completed_at=null, error_code=null, error_retryable=null, duration_ms=0, updated_at=now()
                    where id=$1 returning *`, [current.id])
                run = retried.rows[0]
            }
            await recordRunEvent(client, run, 'started', 'reading')
            return mapRun(run)
        })
    }

    async function recordRead({ runId, sourceId: sourceIdValue, observation, connection = null } = {}) {
        const sourceId = assertSourceId(sourceIdValue)
        const metadata = sourceMetadata(sourceId, observation)
        return withTransaction(connection, async (client) => {
            const run = await loadRun(client, runId, sourceId, { forUpdate: true })
            if (TERMINAL_EXECUTION_STATUSES.has(run.status)) return mapRun(run)
            const updated = await client.query(`update crm_atendimento.clientes_source_operation_runs set
                    status='reading', read_at=now(), watermark=$2, fingerprint=$3, snapshot_complete=$4,
                    proof_kind=$5, proof_expected_records=$6, proof_observed_records=$7,
                    proof_expected_partitions=$8, proof_observed_partitions=$9, proof_scope_hash=$10,
                    records_read=$11, records_applied=$12, records_skipped=$13, divergences=$14,
                    coverage_records_present=$15, coverage_records_expected=$16,
                    coverage_partitions_present=$17, coverage_partitions_expected=$18,
                    coverage_divergences=$19, coverage_source_kind=$20, coverage_schema_version=$21,
                    checkpoint_next_watermark=$22, checkpoint_cursor_hash=$23, updated_at=now()
                where id=$1 returning *`, [
                run.id,
                metadata.watermark,
                metadata.fingerprint,
                metadata.snapshotComplete,
                metadata.proofKind,
                metadata.proofExpectedRecords,
                metadata.proofObservedRecords,
                metadata.proofExpectedPartitions,
                metadata.proofObservedPartitions,
                metadata.proofScopeHash,
                metadata.recordsRead,
                metadata.recordsApplied,
                metadata.recordsSkipped,
                metadata.divergences,
                metadata.coverageRecordsPresent,
                metadata.coverageRecordsExpected,
                metadata.coveragePartitionsPresent,
                metadata.coveragePartitionsExpected,
                metadata.coverageDivergences,
                metadata.coverageSourceKind,
                metadata.coverageSchemaVersion,
                metadata.checkpointNextWatermark,
                metadata.checkpointCursorHash,
            ])
            const persisted = updated.rows[0]
            await writeReadingCheckpoint(client, { sourceId, run: persisted, metadata })
            await recordRunEvent(client, persisted, 'read_recorded', 'reading')
            return mapRun(persisted)
        })
    }

    async function markApplying({ runId, sourceId: sourceIdValue, observation, backup, connection = null } = {}) {
        const sourceId = assertSourceId(sourceIdValue)
        const metadata = sourceMetadata(sourceId, observation)
        return withTransaction(connection, async (client) => {
            const run = await loadRun(client, runId, sourceId, { forUpdate: true })
            if (run.mode !== 'apply') throw operationError('SOURCE_OPERATION_APPLY_MODE_REQUIRED', false, 409)
            if (TERMINAL_EXECUTION_STATUSES.has(run.status)) return mapRun(run)
            if (!metadata.snapshotComplete) throw operationError('SOURCE_SNAPSHOT_PROOF_INVALID', false, 424)
            const storedBackup = await ensureBackup(client, { sourceId, run, backup })
            const updated = await client.query(`update crm_atendimento.clientes_source_operation_runs set
                    status='applying', applying_at=now(), backup_id=$2, watermark=$3, fingerprint=$4,
                    snapshot_complete=$5, proof_kind=$6, proof_expected_records=$7, proof_observed_records=$8,
                    proof_expected_partitions=$9, proof_observed_partitions=$10, proof_scope_hash=$11,
                    records_read=$12, records_applied=$13, records_skipped=$14, divergences=$15,
                    coverage_records_present=$16, coverage_records_expected=$17,
                    coverage_partitions_present=$18, coverage_partitions_expected=$19,
                    coverage_divergences=$20, coverage_source_kind=$21, coverage_schema_version=$22,
                    checkpoint_next_watermark=$23, checkpoint_cursor_hash=$24, updated_at=now()
                where id=$1 returning *`, [
                run.id,
                storedBackup.id,
                metadata.watermark,
                metadata.fingerprint,
                metadata.snapshotComplete,
                metadata.proofKind,
                metadata.proofExpectedRecords,
                metadata.proofObservedRecords,
                metadata.proofExpectedPartitions,
                metadata.proofObservedPartitions,
                metadata.proofScopeHash,
                metadata.recordsRead,
                metadata.recordsApplied,
                metadata.recordsSkipped,
                metadata.divergences,
                metadata.coverageRecordsPresent,
                metadata.coverageRecordsExpected,
                metadata.coveragePartitionsPresent,
                metadata.coveragePartitionsExpected,
                metadata.coverageDivergences,
                metadata.coverageSourceKind,
                metadata.coverageSchemaVersion,
                metadata.checkpointNextWatermark,
                metadata.checkpointCursorHash,
            ])
            const persisted = updated.rows[0]
            await client.query(`insert into crm_atendimento.clientes_source_operation_checkpoints(
                    source_id,last_run_id,last_status,last_attempt_at,last_read_at,next_run_at,reconciliation_required,updated_at)
                values($1,$2,'applying',now(),now(),null,true,now())
                on conflict(source_id) do update set
                    last_run_id=excluded.last_run_id,last_status=excluded.last_status,last_attempt_at=excluded.last_attempt_at,
                    last_read_at=excluded.last_read_at,next_run_at=null,reconciliation_required=true,updated_at=now()`, [sourceId, persisted.id])
            await recordRunEvent(client, persisted, 'applying', 'applying')
            return mapRun(persisted)
        })
    }

    async function completeRun({
        runId,
        sourceId: sourceIdValue,
        observation,
        mode: modeValue,
        applied = false,
        skipped = false,
        backup,
        connection = null,
    } = {}) {
        const sourceId = assertSourceId(sourceIdValue)
        const mode = assertMode(modeValue)
        const metadata = sourceMetadata(sourceId, observation)
        const source = sourceById.get(sourceId) || { id: sourceId, cadenceMs: 900_000 }
        return withTransaction(connection, async (client) => {
            const run = await loadRun(client, runId, sourceId, { forUpdate: true })
            if (run.mode !== mode) throw operationError('SOURCE_OPERATION_MODE_CONFLICT', false, 409)
            if (TERMINAL_EXECUTION_STATUSES.has(run.status)) return mapRun(run)
            let backupRow = null
            if (backup) backupRow = await ensureBackup(client, { sourceId, run, backup })
            const status = skipped === true ? 'skipped' : 'complete'
            const updated = await client.query(`update crm_atendimento.clientes_source_operation_runs set
                    status=$2, completed_at=now(), applying_at=case when $3 then coalesce(applying_at, now()) else applying_at end,
                    watermark=$4, fingerprint=$5, snapshot_complete=$6, proof_kind=$7,
                    proof_expected_records=$8, proof_observed_records=$9,
                    proof_expected_partitions=$10, proof_observed_partitions=$11, proof_scope_hash=$12,
                    records_read=$13, records_applied=$14, records_skipped=$15, divergences=$16,
                    coverage_records_present=$17, coverage_records_expected=$18,
                    coverage_partitions_present=$19, coverage_partitions_expected=$20,
                    coverage_divergences=$21, coverage_source_kind=$22, coverage_schema_version=$23,
                    checkpoint_next_watermark=$24, checkpoint_cursor_hash=$25,
                    backup_id=coalesce($26, backup_id), error_code=null, error_retryable=null,
                    duration_ms=greatest(0, floor(extract(epoch from now() - started_at) * 1000))::bigint,
                    updated_at=now()
                where id=$1 returning *`, [
                run.id,
                status,
                applied === true,
                metadata.watermark,
                metadata.fingerprint,
                metadata.snapshotComplete,
                metadata.proofKind,
                metadata.proofExpectedRecords,
                metadata.proofObservedRecords,
                metadata.proofExpectedPartitions,
                metadata.proofObservedPartitions,
                metadata.proofScopeHash,
                metadata.recordsRead,
                metadata.recordsApplied,
                metadata.recordsSkipped,
                metadata.divergences,
                metadata.coverageRecordsPresent,
                metadata.coverageRecordsExpected,
                metadata.coveragePartitionsPresent,
                metadata.coveragePartitionsExpected,
                metadata.coverageDivergences,
                metadata.coverageSourceKind,
                metadata.coverageSchemaVersion,
                metadata.checkpointNextWatermark,
                metadata.checkpointCursorHash,
                backupRow?.id || null,
            ])
            const persisted = updated.rows[0]
            await completeCheckpoint(client, { sourceId, source, run: persisted, metadata, applied: applied === true, skipped: skipped === true })
            await recordRunEvent(client, persisted, skipped === true ? 'skipped' : 'completed', status)
            return mapRun(persisted)
        })
    }

    async function failRun({
        runId,
        sourceId: sourceIdValue,
        status: statusValue,
        observation = null,
        error,
        connection = null,
    } = {}) {
        const sourceId = assertSourceId(sourceIdValue)
        const status = assertStatus(statusValue)
        const metadata = observation ? sourceMetadata(sourceId, observation) : null
        const source = sourceById.get(sourceId) || { id: sourceId, cadenceMs: 900_000 }
        return withTransaction(connection, async (client) => {
            const run = await loadRun(client, runId, sourceId, { forUpdate: true })
            if (TERMINAL_EXECUTION_STATUSES.has(run.status)) return mapRun(run)
            const preserveApplying = run.status === 'applying' && status === 'partial' && error?.retryable !== false
            const runStatus = preserveApplying ? 'applying' : status
            const code = safeCode(error?.code)
            const updated = await client.query(`update crm_atendimento.clientes_source_operation_runs set
                    status=$2, completed_at=case when $2='applying' then null else now() end,
                    watermark=coalesce($3,watermark), fingerprint=coalesce($4,fingerprint),
                    snapshot_complete=coalesce($5,snapshot_complete), proof_kind=coalesce($6,proof_kind),
                    proof_expected_records=coalesce($7,proof_expected_records), proof_observed_records=coalesce($8,proof_observed_records),
                    proof_expected_partitions=coalesce($9,proof_expected_partitions), proof_observed_partitions=coalesce($10,proof_observed_partitions),
                    proof_scope_hash=coalesce($11,proof_scope_hash), records_read=coalesce($12,records_read),
                    records_applied=coalesce($13,records_applied), records_skipped=coalesce($14,records_skipped),
                    divergences=coalesce($15,divergences), error_code=$16, error_retryable=$17,
                    duration_ms=greatest(0, floor(extract(epoch from now() - started_at) * 1000))::bigint, updated_at=now()
                where id=$1 returning *`, [
                run.id,
                runStatus,
                metadata?.watermark || null,
                metadata?.fingerprint || null,
                metadata ? metadata.snapshotComplete : null,
                metadata?.proofKind || null,
                metadata?.proofExpectedRecords ?? null,
                metadata?.proofObservedRecords ?? null,
                metadata?.proofExpectedPartitions ?? null,
                metadata?.proofObservedPartitions ?? null,
                metadata?.proofScopeHash || null,
                metadata?.recordsRead ?? null,
                metadata?.recordsApplied ?? null,
                metadata?.recordsSkipped ?? null,
                metadata?.divergences ?? null,
                code,
                error?.retryable !== false,
            ])
            const persisted = updated.rows[0]
            await upsertFailureCheckpoint(client, {
                sourceId,
                source,
                run: persisted,
                metadata,
                status,
                error,
                preserveApplying,
            })
            await recordRunEvent(client, persisted, 'failed', preserveApplying ? 'partial' : status, code)
            if (status === 'dead') {
                await client.query(`insert into crm_atendimento.clientes_source_operation_dead_letters(
                        source_id, run_id, error_code, attempt_count)
                    values ($1,$2,$3,$4)
                    on conflict(run_id) do nothing`, [sourceId, persisted.id, code, persisted.attempt_count])
                await recordRunEvent(client, persisted, 'dead_lettered', 'dead', code)
            }
            return mapRun(persisted)
        })
    }

    async function refreshFreshnessFindings({ sourceId: sourceIdValue, now = clock(), connection = null } = {}) {
        const sourceId = assertSourceId(sourceIdValue)
        const source = sourceById.get(sourceId) || { id: sourceId, required: true }
        const evaluatedAt = now instanceof Date && Number.isFinite(now.getTime()) ? now : clock()
        return withTransaction(connection, async (client) => {
            await client.query(`select pg_advisory_xact_lock(hashtext($1))`, [`commercial-data-quality:source:${sourceId}`])
            const checkpoint = mapCheckpoint(await readCheckpoint(sourceId, client, { forUpdate: true }))
            const freshness = freshnessInput(checkpoint, evaluatedAt)
            const observedCount = freshness.healthy ? 0 : 1
            const key = `source.freshness.${sourceId}`
            const metrics = JSON.stringify({
                ageHours: freshness.ageHours,
                recordsRead: checkpoint?.recordsRead || 0,
                recordsApplied: checkpoint?.recordsApplied || 0,
                divergences: checkpoint?.divergences || 0,
                retries: checkpoint?.retries || 0,
                snapshotComplete: checkpoint?.validatedSnapshotComplete === true,
                sourceStatus: checkpoint?.status || 'missing',
                freshness: freshness.state,
                reconciliationRequired: checkpoint?.reconciliationRequired === true,
                lastErrorCode: checkpoint?.lastErrorCode || null,
            })
            const existingResult = await client.query(`select * from crm_atendimento.commercial_data_quality_findings
                where finding_key=$1 for update`, [key])
            const existing = existingResult.rows[0] || null
            const transition = findingTransition(existing, observedCount)
            const slaDueAt = freshness.severity === 'high'
                ? evaluatedAt
                : new Date(evaluatedAt.getTime() + 4 * 3_600_000)
            let row
            if (!existing) {
                const created = await client.query(`insert into crm_atendimento.commercial_data_quality_findings(
                        finding_key,severity,status,owner,observed_count,metrics,sla_due_at,
                        first_detected_at,last_observed_at,last_evaluated_at,resolved_at,created_by,updated_by)
                    values($1,$2,$3,$4,$5,$6::jsonb,case when $5 > 0 then $7 else null end,
                        case when $5 > 0 then now() else null end,case when $5 > 0 then now() else null end,
                        now(),case when $5 = 0 then now() else null end,$4,$4)
                    returning *`, [key, freshness.severity, transition.nextStatus, QUALITY_ACTOR, observedCount, metrics, slaDueAt])
                row = created.rows[0]
            } else {
                const updated = await client.query(`update crm_atendimento.commercial_data_quality_findings set
                        severity=$2,status=$3,observed_count=$4,metrics=$5::jsonb,
                        sla_due_at=case when $6 then $7 else sla_due_at end,
                        first_detected_at=case when $6 then now() when $4 > 0 then coalesce(first_detected_at,now()) else first_detected_at end,
                        last_observed_at=case when $4 > 0 then now() else last_observed_at end,
                        last_evaluated_at=now(),acknowledged_at=case when $6 then null else acknowledged_at end,
                        resolved_at=case when $8 then now() when $6 then null else resolved_at end,
                        revision=case when $6 or $8 then revision+1 else revision end,
                        updated_by=$9,updated_at=now()
                    where id=$1 returning *`, [
                    existing.id,
                    freshness.severity,
                    transition.nextStatus,
                    observedCount,
                    metrics,
                    transition.shouldStartWindow,
                    slaDueAt,
                    transition.shouldResolve,
                    QUALITY_ACTOR,
                ])
                row = updated.rows[0]
            }
            if (transition.shouldRecord) {
                await client.query(`insert into crm_atendimento.commercial_data_quality_finding_events(
                        finding_id,event_type,previous_status,status,previous_owner,owner,observed_count,actor)
                    values($1,$2,$3,$4,$5,$6,$7,$8)`, [
                    row.id,
                    transition.eventType,
                    existing?.status || null,
                    row.status,
                    existing?.owner || null,
                    row.owner || null,
                    observedCount,
                    QUALITY_ACTOR,
                ])
            }
            return {
                sourceId,
                findingKey: key,
                status: row.status,
                severity: row.severity,
                observedCount,
                freshness: freshness.state,
            }
        })
    }

    async function getOperationalView({ now = clock() } = {}) {
        const evaluatedAt = now instanceof Date && Number.isFinite(now.getTime()) ? now : clock()
        const result = await pgPool.query(`select * from crm_atendimento.clientes_source_operation_checkpoints`)
        const checkpoints = new Map((result.rows || []).map((row) => [row.source_id, mapCheckpoint(row)]))
        return (catalog || []).map((source) => {
            const checkpoint = checkpoints.get(source.id) || null
            const freshness = freshnessInput(checkpoint, evaluatedAt)
            return {
                sourceId: source.id,
                domain: source.domain,
                label: source.label,
                required: source.required === true,
                requiredFor: Array.isArray(source.requiredFor) ? [...source.requiredFor] : [],
                status: checkpoint?.status || 'missing',
                freshness: freshness.state,
                lastExecution: checkpoint?.lastAttemptAt || null,
                lastRead: checkpoint?.lastReadAt || null,
                lastSuccess: checkpoint?.validatedAt || null,
                lastApplied: checkpoint?.appliedAt || null,
                nextExecution: checkpoint?.nextRunAt || null,
                recordsRead: checkpoint?.recordsRead || 0,
                recordsApplied: checkpoint?.recordsApplied || 0,
                divergences: checkpoint?.divergences || 0,
                snapshotComplete: checkpoint?.validatedSnapshotComplete === true,
                snapshotProof: checkpoint?.validatedProof || null,
                retries: checkpoint?.retries || 0,
                errors: checkpoint?.lastErrorCode ? 1 : 0,
                error: checkpoint?.lastErrorCode ? { code: checkpoint.lastErrorCode, retryable: checkpoint.lastErrorRetryable } : null,
                durationMs: checkpoint?.lastDurationMs || 0,
                reconciliationRequired: checkpoint?.reconciliationRequired === true,
            }
        })
    }

    async function recordRollback({ sourceId: sourceIdValue, backupReference, executionKey: executionKeyValue, connection = null } = {}) {
        const sourceId = assertSourceId(sourceIdValue)
        const reference = String(backupReference || '').trim()
        const executionKey = assertExecutionKey(executionKeyValue)
        if (!BACKUP_REFERENCE.test(reference)) throw operationError('SOURCE_ROLLBACK_REFERENCE_INVALID', false, 400)
        return withTransaction(connection, async (client) => {
            const backupResult = await client.query(`select id, run_id from crm_atendimento.clientes_source_operation_backups
                where source_id=$1 and backup_reference=$2`, [sourceId, reference])
            const backup = backupResult.rows[0]
            if (!backup) throw operationError('SOURCE_ROLLBACK_BACKUP_NOT_FOUND', false, 404)
            const inserted = await client.query(`insert into crm_atendimento.clientes_source_operation_rollbacks(
                    source_id,backup_id,execution_key)
                values($1,$2,$3)
                on conflict(source_id,execution_key) do nothing
                returning id`, [sourceId, backup.id, executionKey])
            const created = Boolean(inserted.rows[0]?.id)
            await client.query(`insert into crm_atendimento.clientes_source_operation_checkpoints(
                    source_id,last_status,last_attempt_at,last_error_code,last_error_retryable,last_error_at,
                    next_run_at,reconciliation_required,rollback_at,updated_at)
                values($1,'partial',now(),'SOURCE_ROLLBACK_APPLIED',false,now(),now(),true,now(),now())
                on conflict(source_id) do update set
                    last_status='partial',last_attempt_at=now(),last_error_code='SOURCE_ROLLBACK_APPLIED',
                    last_error_retryable=false,last_error_at=now(),next_run_at=now(),
                    reconciliation_required=true,rollback_at=now(),updated_at=now()`, [sourceId])
            if (created) {
                const run = await loadRun(client, backup.run_id, sourceId, { forUpdate: false })
                await recordRunEvent(client, run, 'rollback_recorded', 'partial', 'SOURCE_ROLLBACK_APPLIED')
            }
            return { sourceId, rolledBack: true, idempotent: !created }
        })
    }

    async function dependencyStatus() {
        const relations = [
            'crm_atendimento.clientes_source_operation_runs',
            'crm_atendimento.clientes_source_operation_checkpoints',
            'crm_atendimento.clientes_source_operation_backups',
            'crm_atendimento.clientes_source_operation_events',
            'crm_atendimento.clientes_source_operation_dead_letters',
            'crm_atendimento.clientes_source_operation_rollbacks',
            'crm_atendimento.commercial_data_quality_findings',
            'crm_atendimento.commercial_data_quality_finding_events',
        ]
        const fields = relations.map((relation, index) => `to_regclass('${relation}') is not null as relation_${index}`).join(', ')
        const result = await pgPool.query(`select current_database() as database, current_user as database_user,
            ${fields}, exists(select 1 from crm_atendimento.schema_migrations
                where id=$1 and rolled_back_at is null) as migration_ready`, [CLIENTES_SOURCE_OPERATIONS_MIGRATION_ID])
        const row = result.rows[0] || {}
        const missing = relations.filter((_relation, index) => row[`relation_${index}`] !== true)
        return {
            database: row.database || null,
            user: row.database_user || null,
            missing,
            ready: missing.length === 0 && row.migration_ready === true,
        }
    }

    return {
        withSourceLock,
        getCheckpoint,
        beginRun,
        recordRead,
        markApplying,
        completeRun,
        failRun,
        refreshFreshnessFindings,
        getOperationalView,
        recordRollback,
        dependencyStatus,
        pool: pgPool,
    }
}

export const __testables = {
    sourceMetadata,
    mapCheckpoint,
    freshnessInput,
    findingTransition,
    assertBackup,
}
