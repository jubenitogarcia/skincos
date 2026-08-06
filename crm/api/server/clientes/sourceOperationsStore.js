import { compareWatermarks, freshnessState } from './sourceOperations.js'
import { CLIENTES_SOURCE_CATALOG } from './sourceCatalog.js'
import { withPgTransaction } from '../harmonia/store/pg.js'

const REQUIRED_TABLES = [
    'crm_atendimento.clientes_source_checkpoints',
    'crm_atendimento.clientes_source_runs',
    'crm_atendimento.clientes_source_dead_letters',
    'crm_atendimento.commercial_data_quality_findings',
    'crm_atendimento.commercial_data_quality_finding_events',
]

function rowToCheckpoint(row) {
    if (!row) return null
    return {
        sourceId: row.source_id,
        status: row.status,
        watermark: row.watermark,
        fingerprint: row.fingerprint,
        snapshotComplete: row.snapshot_complete === true,
        recordsRead: Number(row.records_read || 0),
        recordsApplied: Number(row.records_applied || 0),
        recordsSkipped: Number(row.records_skipped || 0),
        divergences: Number(row.divergences || 0),
        coverage: row.coverage || {},
        lastReadAt: row.last_read_at,
        lastAppliedAt: row.last_applied_at,
        lastDurationMs: Number(row.last_duration_ms || 0),
        lastErrorCode: row.last_error_code,
        lastErrorDetails: row.last_error_details || {},
        lastErrorAt: row.last_error_at,
        consecutiveFailures: Number(row.consecutive_failures || 0),
        retries: Number(row.retries || 0),
        nextRunAt: row.next_run_at,
        backupRef: row.backup_ref,
        checkpoint: row.checkpoint || {},
    }
}

function normalizeError(error) {
    const code = String(error?.code || '').trim().toUpperCase()
    return /^[A-Z][A-Z0-9_]{1,80}$/.test(code) ? code : 'SOURCE_RUN_FAILED'
}

function ageHours(value, now) {
    if (!value) return null
    const timestamp = new Date(value).getTime()
    if (!Number.isFinite(timestamp)) return null
    return Math.max(0, (now.getTime() - timestamp) / 3_600_000)
}

export function createClientesSourceOperationsStore({ pool, catalog = CLIENTES_SOURCE_CATALOG, clock = () => new Date() } = {}) {
    if (!pool) throw new Error('SOURCE_OPERATIONS_POOL_REQUIRED')

    const dbFor = (connection) => connection || pool

    async function withStoreTransaction(connection, fn) {
        if (!connection) return withPgTransaction(pool, fn)
        await connection.query('begin')
        try {
            const result = await fn(connection)
            await connection.query('commit')
            return result
        } catch (error) {
            try { await connection.query('rollback') } catch { /* preserve original error */ }
            throw error
        }
    }

    async function withSourceLock(sourceId, fn) {
        const client = await pool.connect()
        let locked = false
        try {
            const result = await client.query(`select pg_try_advisory_lock(hashtext($1)) as acquired`, [`clientes-source:${sourceId}`])
            if (result.rows[0]?.acquired !== true) {
                const error = new Error('SOURCE_LOCK_BUSY')
                error.code = 'SOURCE_LOCK_BUSY'
                error.retryable = true
                throw error
            }
            locked = true
            return await fn(client)
        } finally {
            if (locked) {
                try { await client.query(`select pg_advisory_unlock(hashtext($1))`, [`clientes-source:${sourceId}`]) } catch { /* connection close releases lock */ }
            }
            client.release()
        }
    }

    async function getCheckpoint(sourceId, connection = null) {
        const result = await dbFor(connection).query(`select * from crm_atendimento.clientes_source_checkpoints where source_id=$1`, [sourceId])
        return rowToCheckpoint(result.rows[0])
    }

    async function beginRun({ sourceId, scheduledAt, idempotencyKey, attempt, connection = null }) {
        const db = dbFor(connection)
        const result = await db.query(`insert into crm_atendimento.clientes_source_runs(
                source_id,status,scheduled_at,started_at,idempotency_key,attempt,retries)
            values($1,'running',$2,now(),$3,$4, greatest($4 - 1, 0))
            on conflict(idempotency_key) do nothing
            returning id, source_id, status, idempotency_key`, [sourceId, scheduledAt, idempotencyKey, attempt])
        if (result.rows[0]) return { ...result.rows[0], existing: false }
        const existing = await db.query(`select id, source_id, status, idempotency_key
            from crm_atendimento.clientes_source_runs where idempotency_key=$1`, [idempotencyKey])
        return existing.rows[0] ? { ...existing.rows[0], existing: true } : null
    }

    async function completeRun({ runId, sourceId, observation, mode, durationMs, lastReadAt, lastAppliedAt, nextRunAt, sameSnapshot, connection = null }) {
        const source = catalog.find((item) => item.id === sourceId)
        await withStoreTransaction(connection, async (client) => {
            await client.query(`update crm_atendimento.clientes_source_runs set
                status=$2, completed_at=now(), last_read_at=$3, last_applied_at=$4,
                watermark=$5, fingerprint=$6, snapshot_complete=$7,
                records_read=$8, records_applied=$9, records_skipped=$10,
                divergences=$11, coverage=$12::jsonb, checkpoint=$13::jsonb,
                backup_ref=$14, duration_ms=$15, error_code=null, error_message=null, error_details='{}'::jsonb,
                updated_at=now()
                where id=$1`, [
                runId,
                sameSnapshot ? 'skipped' : observation.status,
                lastReadAt || null,
                lastAppliedAt || null,
                observation.watermark,
                observation.fingerprint,
                observation.snapshotComplete,
                observation.recordsRead,
                observation.recordsApplied,
                observation.recordsSkipped,
                observation.divergences,
                JSON.stringify(observation.coverage || {}),
                JSON.stringify(observation.checkpoint || {}),
                observation.backupRef || null,
                durationMs,
            ])
            await client.query(`insert into crm_atendimento.clientes_source_checkpoints(
                    source_id,status,watermark,fingerprint,snapshot_complete,records_read,records_applied,
                    records_skipped,divergences,coverage,last_read_at,last_applied_at,last_duration_ms,
                    last_error_code,last_error_at,consecutive_failures,retries,next_run_at,backup_ref,checkpoint,updated_at)
                values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb,$11,$12,$13,null,null,0,0,$14,$15,$16::jsonb,now())
                on conflict(source_id) do update set
                    status=excluded.status, watermark=excluded.watermark, fingerprint=excluded.fingerprint,
                    snapshot_complete=excluded.snapshot_complete, records_read=excluded.records_read,
                    records_applied=excluded.records_applied, records_skipped=excluded.records_skipped,
                    divergences=excluded.divergences, coverage=excluded.coverage,
                    last_read_at=excluded.last_read_at,
                    last_applied_at=coalesce(excluded.last_applied_at, crm_atendimento.clientes_source_checkpoints.last_applied_at),
                    last_duration_ms=excluded.last_duration_ms, last_error_code=null, last_error_at=null, last_error_details='{}'::jsonb,
                    consecutive_failures=0, retries=crm_atendimento.clientes_source_checkpoints.retries,
                    next_run_at=excluded.next_run_at, backup_ref=coalesce(excluded.backup_ref, crm_atendimento.clientes_source_checkpoints.backup_ref),
                    checkpoint=excluded.checkpoint, updated_at=now()`, [
                sourceId,
                sameSnapshot ? 'skipped' : observation.status,
                observation.watermark,
                observation.fingerprint,
                observation.snapshotComplete,
                observation.recordsRead,
                observation.recordsApplied,
                observation.recordsSkipped,
                observation.divergences,
                JSON.stringify(observation.coverage || {}),
                lastReadAt || null,
                lastAppliedAt || null,
                durationMs,
                nextRunAt || new Date(clock().getTime() + Number(source?.cadenceMs || 900_000)).toISOString(),
                observation.backupRef || null,
                JSON.stringify(observation.checkpoint || {}),
            ])
        })
    }

    async function failRun({ runId, sourceId, observation = {}, error, durationMs, retryAt, deadLetter = false, failureStatus = null, preserveCheckpoint = false, connection = null }) {
        const code = normalizeError(error)
        const status = failureStatus || (deadLetter ? 'dead' : 'partial')
        const errorDetails = JSON.stringify({ retryable: error?.retryable !== false, status, deadLetter: deadLetter === true })
        await withStoreTransaction(connection, async (client) => {
            await client.query(`update crm_atendimento.clientes_source_runs set
                status=$2, completed_at=now(), last_read_at=$3, watermark=$4, fingerprint=$5,
                snapshot_complete=$6, records_read=$7, records_applied=$8, records_skipped=$9,
                divergences=$10, coverage=$11::jsonb, checkpoint=$12::jsonb,
                duration_ms=$13, backup_ref=$14, error_code=$15, error_message=null, error_details=$16::jsonb, updated_at=now()
                where id=$1`, [
                runId,
                status,
                observation.observedAt || null,
                observation.watermark || null,
                observation.fingerprint || null,
                observation.snapshotComplete === true,
                Number(observation.recordsRead || 0),
                Number(observation.recordsApplied || 0),
                Number(observation.recordsSkipped || 0),
                Number(observation.divergences || 0),
                JSON.stringify(observation.coverage || {}),
                JSON.stringify(observation.checkpoint || {}),
                durationMs,
                observation.backupRef || null,
                code,
                errorDetails,
            ])
            await client.query(`insert into crm_atendimento.clientes_source_checkpoints(
                    source_id,status,watermark,fingerprint,snapshot_complete,records_read,records_applied,
                    records_skipped,divergences,coverage,last_read_at,last_error_code,last_error_at,last_error_details,
                    consecutive_failures,retries,next_run_at,backup_ref,checkpoint,updated_at)
                values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb,$11,$12,now(),$13::jsonb,1,1,$14,$15,$16::jsonb,now())
                on conflict(source_id) do update set
                    status=excluded.status, watermark=case when $17::boolean then crm_atendimento.clientes_source_checkpoints.watermark else coalesce(excluded.watermark, crm_atendimento.clientes_source_checkpoints.watermark) end,
                    fingerprint=case when $17::boolean then crm_atendimento.clientes_source_checkpoints.fingerprint else coalesce(excluded.fingerprint, crm_atendimento.clientes_source_checkpoints.fingerprint) end,
                    snapshot_complete=excluded.snapshot_complete, records_read=excluded.records_read,
                    records_applied=excluded.records_applied, records_skipped=excluded.records_skipped,
                    divergences=excluded.divergences, coverage=excluded.coverage, last_read_at=excluded.last_read_at,
                    last_error_code=excluded.last_error_code, last_error_at=now(), last_error_details=excluded.last_error_details,
                    consecutive_failures=crm_atendimento.clientes_source_checkpoints.consecutive_failures + 1,
                    retries=crm_atendimento.clientes_source_checkpoints.retries + 1,
                    next_run_at=excluded.next_run_at, backup_ref=coalesce(excluded.backup_ref, crm_atendimento.clientes_source_checkpoints.backup_ref), checkpoint=excluded.checkpoint, updated_at=now()`, [
                sourceId,
                status,
                observation.watermark || null,
                observation.fingerprint || null,
                observation.snapshotComplete === true,
                Number(observation.recordsRead || 0),
                Number(observation.recordsApplied || 0),
                Number(observation.recordsSkipped || 0),
                Number(observation.divergences || 0),
                JSON.stringify(observation.coverage || {}),
                observation.observedAt || null,
                code,
                errorDetails,
                retryAt || null,
                observation.backupRef || null,
                JSON.stringify(observation.checkpoint || {}),
                preserveCheckpoint,
            ])
            if (deadLetter) {
                await client.query(`insert into crm_atendimento.clientes_source_dead_letters(source_id,run_id,error_code,attempts,details)
                    values($1,$2,$3,coalesce((select attempt from crm_atendimento.clientes_source_runs where id=$2),1),$4::jsonb)`, [sourceId, runId, code, JSON.stringify({ status: 'dead' })])
            }
        })
    }

    async function compareSourceOrder(sourceId, watermark, connection = null) {
        const checkpoint = await getCheckpoint(sourceId, connection)
        if (!checkpoint?.watermark) return 1
        return compareWatermarks(watermark, checkpoint.watermark)
    }

    async function refreshFindings({ now = clock(), sourceId = null, connection = null } = {}) {
        const db = dbFor(connection)
        const checkpoints = sourceId
            ? [await getCheckpoint(sourceId, connection)]
            : await Promise.all(catalog.map((source) => getCheckpoint(source.id, connection)))
        for (const checkpoint of checkpoints.filter(Boolean)) {
            const state = freshnessState(checkpoint.lastAppliedAt, now)
            const key = `source.freshness.${checkpoint.sourceId}`
            const age = ageHours(checkpoint.lastAppliedAt, now)
            const severity = state === 'healthy' ? 'low' : state === 'preventive' ? 'medium' : 'high'
            const status = state === 'healthy' ? 'resolved' : 'open'
            const metrics = {
                ageHours: age,
                lastReadAt: checkpoint.lastReadAt || null,
                lastAppliedAt: checkpoint.lastAppliedAt || null,
                recordsRead: checkpoint.recordsRead,
                recordsApplied: checkpoint.recordsApplied,
                retries: checkpoint.retries,
                snapshotComplete: checkpoint.snapshotComplete,
                sourceStatus: checkpoint.status,
                lastErrorCode: checkpoint.lastErrorCode || null,
                lastErrorDetails: checkpoint.lastErrorDetails || {},
            }
            const existing = await db.query(`select id,status,owner,revision from crm_atendimento.commercial_data_quality_findings where finding_key=$1`, [key])
            const previous = existing.rows[0]
            const result = await db.query(`insert into crm_atendimento.commercial_data_quality_findings(
                    finding_key,severity,status,owner,observed_count,metrics,sla_due_at,first_detected_at,
                    last_observed_at,last_evaluated_at,resolved_at,revision,created_by,updated_by,updated_at)
                values($1,$2,$3,'clientes-source-operations',1,$4::jsonb,now()+interval '24 hours',
                    case when $3='resolved' then null else now() end,
                    now(),now(),case when $3='resolved' then now() else null end,1,
                    'clientes-source-operations','clientes-source-operations',now())
                on conflict(finding_key) do update set
                    severity=excluded.severity,status=excluded.status,owner=excluded.owner,
                    observed_count=excluded.observed_count,metrics=excluded.metrics,
                    last_observed_at=excluded.last_observed_at,last_evaluated_at=excluded.last_evaluated_at,
                    resolved_at=excluded.resolved_at,
                    first_detected_at=case when excluded.status='resolved' then crm_atendimento.commercial_data_quality_findings.first_detected_at else coalesce(crm_atendimento.commercial_data_quality_findings.first_detected_at,now()) end,
                    revision=crm_atendimento.commercial_data_quality_findings.revision+1,
                    updated_by=excluded.updated_by,updated_at=now()
                returning id,status,revision`, [key, severity, status, JSON.stringify(metrics)])
            const current = result.rows[0]
            if (!previous || previous.status !== current.status) {
                const eventType = state === 'healthy' ? 'cleared' : previous?.status === 'resolved' ? 'reopened' : 'detected'
                await db.query(`insert into crm_atendimento.commercial_data_quality_finding_events(
                        finding_id,event_type,previous_status,status,observed_count,actor)
                    values($1,$2,$3,$4,1,'clientes-source-operations')`, [current.id, eventType, previous?.status || null, current.status])
            }
        }
        return { refreshed: checkpoints.filter(Boolean).length }
    }

    async function getOperationalView({ now = clock() } = {}) {
        const result = await pool.query(`select * from crm_atendimento.clientes_source_checkpoints`)
        const byId = new Map(result.rows.map((row) => [row.source_id, rowToCheckpoint(row)]))
        return catalog.map((source) => {
            const checkpoint = byId.get(source.id)
            const freshness = freshnessState(checkpoint?.lastAppliedAt, now)
            return {
                sourceId: source.id,
                domain: source.domain,
                label: source.label,
                freshness,
                lastExecution: checkpoint?.lastReadAt || null,
                lastSuccess: checkpoint?.status === 'complete' || checkpoint?.status === 'skipped' ? checkpoint.lastAppliedAt : null,
                nextExecution: checkpoint?.nextRunAt || null,
                recordsRead: checkpoint?.recordsRead || 0,
                recordsApplied: checkpoint?.recordsApplied || 0,
                divergences: checkpoint?.divergences || 0,
                snapshotComplete: checkpoint?.snapshotComplete === true,
                errors: checkpoint?.lastErrorCode ? 1 : 0,
                error: checkpoint?.lastErrorCode ? { code: checkpoint.lastErrorCode, ...(checkpoint.lastErrorDetails || {}) } : null,
                retries: checkpoint?.retries || 0,
                status: checkpoint?.status || 'missing',
                durationMs: checkpoint?.lastDurationMs || 0,
                watermark: checkpoint?.watermark || null,
                fingerprint: checkpoint?.fingerprint || null,
            }
        })
    }

    async function dependencyStatus() {
        const result = await pool.query(`select current_database() as database, current_user as user,
            ${REQUIRED_TABLES.map((table, index) => `to_regclass('${table}') is not null as dependency_${index}`).join(', ')}`)
        const row = result.rows[0] || {}
        const missing = REQUIRED_TABLES.filter((_table, index) => row[`dependency_${index}`] !== true)
        return { database: row.database || null, user: row.user || null, missing, ready: missing.length === 0 }
    }

    async function markRollback({ sourceId, backupRef, connection = null }) {
        await dbFor(connection).query(`update crm_atendimento.clientes_source_checkpoints
            set status='partial', last_error_code='ROLLBACK_APPLIED', last_error_details='{"retryable":false,"rollback":true}'::jsonb, backup_ref=$2, updated_at=now()
            where source_id=$1`, [sourceId, backupRef || null])
    }

    return {
        withSourceLock,
        getCheckpoint,
        beginRun,
        completeRun,
        failRun,
        compareSourceOrder,
        refreshFindings,
        getOperationalView,
        dependencyStatus,
        markRollback,
        pool,
    }
}
