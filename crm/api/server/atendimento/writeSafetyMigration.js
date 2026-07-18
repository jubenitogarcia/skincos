import { ATTENDANCE_VALUE_FORMULA_VERSION } from './domain.js'
import { isLocalMirrorDestination } from './mirror.js'

export const ATTENDANCE_LEGACY_VALUE_FORMULA_VERSION = 'attendance-value/legacy-imported-v0'
export const ATTENDANCE_WRITE_SAFETY_MIGRATION_ID = '20260718_atendimento_write_safety_v1'

const CONSTRAINTS = [
    {
        name: 'crm_atendimento_attendances_revision_valid',
        expression: 'check (revision >= 1)',
    },
    {
        name: 'crm_atendimento_attendances_value_formula_version_valid',
        expression: "check (value_formula_version is not null and btrim(value_formula_version) <> '')",
    },
]

const ONLINE_INDEXES = [
    {
        name: 'crm_atendimento_attendances_idempotency_idx',
        sql: `create unique index concurrently if not exists crm_atendimento_attendances_idempotency_idx
              on crm_atendimento.attendances(created_by, idempotency_key)
              where idempotency_key is not null and created_by is not null`,
    },
    {
        name: 'crm_atendimento_attendances_unit_period_created_idx',
        sql: `create index concurrently if not exists crm_atendimento_attendances_unit_period_created_idx
              on crm_atendimento.attendances(unit_id, service_date desc, created_at desc)
              where deleted_at is null`,
    },
    {
        name: 'crm_atendimento_attendances_unit_injector_period_idx',
        sql: `create index concurrently if not exists crm_atendimento_attendances_unit_injector_period_idx
              on crm_atendimento.attendances(unit_id, injector_id, service_date desc)
              where deleted_at is null and injector_id is not null`,
    },
    {
        name: 'crm_atendimento_attendances_unit_consultant_period_idx',
        sql: `create index concurrently if not exists crm_atendimento_attendances_unit_consultant_period_idx
              on crm_atendimento.attendances(unit_id, consultant_id, service_date desc)
              where deleted_at is null and consultant_id is not null`,
    },
    {
        name: 'crm_atendimento_attendances_active_period_idx',
        sql: `create index concurrently if not exists crm_atendimento_attendances_active_period_idx
              on crm_atendimento.attendances(service_date desc)
              where deleted_at is null`,
    },
    {
        name: 'crm_atendimento_audit_events_attendance_created_idx',
        sql: `create index concurrently if not exists crm_atendimento_audit_events_attendance_created_idx
              on crm_atendimento.audit_events(attendance_id, created_at desc)
              where attendance_id is not null`,
    },
]

export function attendanceWriteSafetyMigrationPlan() {
    return {
        id: ATTENDANCE_WRITE_SAFETY_MIGRATION_ID,
        legacyFormulaVersion: ATTENDANCE_LEGACY_VALUE_FORMULA_VERSION,
        currentFormulaVersion: ATTENDANCE_VALUE_FORMULA_VERSION,
        constraints: CONSTRAINTS.map((constraint) => ({ ...constraint })),
        indexes: ONLINE_INDEXES.map((index) => ({ ...index })),
    }
}

function migrationError(code, message = code) {
    const error = new Error(message)
    error.code = code
    return error
}

async function queryWithGuardrails(client, sql, params = []) {
    return client.query(sql, params)
}

async function setMigrationGuardrails(client) {
    await queryWithGuardrails(client, `set lock_timeout = '3s'`)
    await queryWithGuardrails(client, `set statement_timeout = '60s'`)
}

async function ensureMigrationRegistry(client) {
    await queryWithGuardrails(client, `create schema if not exists crm_atendimento`)
    await queryWithGuardrails(client, `create table if not exists crm_atendimento.schema_migrations (
        id text primary key,
        applied_at timestamptz not null default now(),
        rolled_back_at timestamptz,
        details jsonb not null default '{}'::jsonb
    )`)
}

async function getMigrationRecord(client) {
    const result = await queryWithGuardrails(client, `select id, applied_at, rolled_back_at, details
        from crm_atendimento.schema_migrations where id = $1`, [ATTENDANCE_WRITE_SAFETY_MIGRATION_ID])
    return result.rows[0] || null
}

async function ensureColumn(client, definition) {
    await queryWithGuardrails(client, `alter table crm_atendimento.attendances add column if not exists ${definition}`)
}

async function ensureAuditColumn(client, definition) {
    await queryWithGuardrails(client, `alter table crm_atendimento.audit_events add column if not exists ${definition}`)
}

async function batchUpdate(client, sql, params = [], batchSize = 500) {
    let affected = 0
    for (;;) {
        const result = await queryWithGuardrails(client, sql, [...params, batchSize])
        const count = Number(result.rowCount || 0)
        affected += count
        if (count < batchSize) return affected
    }
}

async function ensureConstraint(client, constraint) {
    const existing = await queryWithGuardrails(client, `select convalidated
        from pg_constraint where conname = $1 and conrelid = 'crm_atendimento.attendances'::regclass`, [constraint.name])
    if (!existing.rows[0]) {
        await queryWithGuardrails(client, `alter table crm_atendimento.attendances
            add constraint ${constraint.name} ${constraint.expression} not valid`)
    }
    const validated = existing.rows[0]?.convalidated
    if (!validated) {
        await queryWithGuardrails(client, `alter table crm_atendimento.attendances validate constraint ${constraint.name}`)
    }
}

async function assertLocalDestination(client, databaseUrl) {
    if (!isLocalMirrorDestination(databaseUrl)) {
        throw migrationError('ATENDIMENTO_MIGRATION_DESTINATION_UNSAFE', 'A migration só pode operar no banco local skincos_crm_local.')
    }
    const identity = await queryWithGuardrails(client, `select current_database() as database_name,
        current_setting('transaction_read_only') as transaction_read_only`)
    const row = identity.rows[0] || {}
    if (row.database_name !== 'skincos_crm_local' || String(row.transaction_read_only).toLowerCase() === 'on') {
        throw migrationError('ATENDIMENTO_MIGRATION_DESTINATION_UNSAFE', 'O destino precisa ser o banco local gravável skincos_crm_local.')
    }
    return { database: row.database_name }
}

async function assertNoIdempotencyDuplicates(client) {
    const result = await queryWithGuardrails(client, `select created_by, idempotency_key, count(*)::int as count
        from crm_atendimento.attendances
        where idempotency_key is not null and created_by is not null
        group by created_by, idempotency_key
        having count(*) > 1
        limit 1`)
    if (result.rows[0]) {
        throw migrationError('ATENDIMENTO_MIGRATION_IDEMPOTENCY_DUPLICATES', 'Foram encontradas chaves de idempotência duplicadas; nenhum índice foi criado.')
    }
}

async function createOnlineIndexes(client, report) {
    await assertNoIdempotencyDuplicates(client)
    for (const index of ONLINE_INDEXES) {
        await queryWithGuardrails(client, index.sql)
        report.indexes.push(index.name)
    }
}

export async function applyAtendimentoWriteSafetyMigration({ pool, databaseUrl, batchSize = 500 }) {
    if (!pool) throw migrationError('ATENDIMENTO_MIGRATION_POOL_REQUIRED')
    const client = await pool.connect()
    const report = {
        id: ATTENDANCE_WRITE_SAFETY_MIGRATION_ID,
        database: '',
        alreadyRecorded: false,
        legacyFormulaRows: 0,
        revisionRows: 0,
        timestampRows: 0,
        indexes: [],
        constraints: [],
    }
    try {
        await setMigrationGuardrails(client)
        await queryWithGuardrails(client, `select pg_advisory_lock(hashtext($1))`, [ATTENDANCE_WRITE_SAFETY_MIGRATION_ID])
        const identity = await assertLocalDestination(client, databaseUrl)
        report.database = identity.database
        await ensureMigrationRegistry(client)
        const existing = await getMigrationRecord(client)
        report.alreadyRecorded = !!existing && !existing.rolled_back_at
        const startedAt = (await queryWithGuardrails(client, `select clock_timestamp() as started_at`)).rows[0]?.started_at

        await ensureColumn(client, 'value_formula_version text')
        await ensureColumn(client, 'revision integer')
        await ensureColumn(client, 'idempotency_key text')
        await ensureColumn(client, 'created_by text')
        await ensureColumn(client, 'updated_by text')
        await ensureColumn(client, 'created_at timestamptz')
        await ensureColumn(client, 'updated_at timestamptz')
        await ensureColumn(client, 'deleted_at timestamptz')
        await ensureAuditColumn(client, 'actor jsonb')
        await ensureAuditColumn(client, 'attendance_id uuid')
        await ensureAuditColumn(client, "payload jsonb not null default '{}'::jsonb")
        await ensureAuditColumn(client, 'created_at timestamptz not null default now()')
        await queryWithGuardrails(client, `alter table crm_atendimento.attendances
            alter column revision set default 1,
            alter column value_formula_version set default '${ATTENDANCE_VALUE_FORMULA_VERSION}'`)

        if (!existing) {
            report.legacyFormulaRows = await batchUpdate(client, `with batch as (
                select ctid from crm_atendimento.attendances
                where (created_at is null or created_at < $1::timestamptz)
                  and (value_formula_version is null or value_formula_version = $2)
                limit $4
            ) update crm_atendimento.attendances a
              set value_formula_version = $3
             from batch where a.ctid = batch.ctid`, [startedAt, ATTENDANCE_VALUE_FORMULA_VERSION, ATTENDANCE_LEGACY_VALUE_FORMULA_VERSION], batchSize)
        }
        report.revisionRows = await batchUpdate(client, `with batch as (
            select ctid from crm_atendimento.attendances where revision is null limit $1
        ) update crm_atendimento.attendances a set revision = 1
          from batch where a.ctid = batch.ctid`, [], batchSize)
        report.timestampRows = await batchUpdate(client, `with batch as (
            select ctid from crm_atendimento.attendances
            where created_at is null or updated_at is null
            limit $1
        ) update crm_atendimento.attendances a
          set created_at = coalesce(a.created_at, a.updated_at, now()),
              updated_at = coalesce(a.updated_at, a.created_at, now())
          from batch where a.ctid = batch.ctid`, [], batchSize)
        for (const constraint of CONSTRAINTS) {
            await ensureConstraint(client, constraint)
            report.constraints.push(constraint.name)
        }
        await createOnlineIndexes(client, report)
        if (!report.alreadyRecorded) {
            await queryWithGuardrails(client, `insert into crm_atendimento.schema_migrations(id, applied_at, rolled_back_at, details)
                values ($1, now(), null, $2::jsonb)
                on conflict(id) do update set applied_at = excluded.applied_at, rolled_back_at = null, details = excluded.details`, [
                ATTENDANCE_WRITE_SAFETY_MIGRATION_ID,
                JSON.stringify({
                    legacyFormulaRows: report.legacyFormulaRows,
                    revisionRows: report.revisionRows,
                    timestampRows: report.timestampRows,
                    indexes: report.indexes,
                }),
            ])
        }
        return report
    } finally {
        try { await queryWithGuardrails(client, `select pg_advisory_unlock(hashtext($1))`, [ATTENDANCE_WRITE_SAFETY_MIGRATION_ID]) } catch { /* connection may already be unavailable */ }
        client.release()
    }
}

export async function rollbackAtendimentoWriteSafetyMigration({ pool, databaseUrl }) {
    if (!pool) throw migrationError('ATENDIMENTO_MIGRATION_POOL_REQUIRED')
    const client = await pool.connect()
    try {
        await setMigrationGuardrails(client)
        await queryWithGuardrails(client, `select pg_advisory_lock(hashtext($1))`, [ATTENDANCE_WRITE_SAFETY_MIGRATION_ID])
        await assertLocalDestination(client, databaseUrl)
        await ensureMigrationRegistry(client)
        for (const index of [...ONLINE_INDEXES].reverse()) {
            await queryWithGuardrails(client, `drop index concurrently if exists crm_atendimento.${index.name}`)
        }
        for (const constraint of [...CONSTRAINTS].reverse()) {
            await queryWithGuardrails(client, `alter table crm_atendimento.attendances drop constraint if exists ${constraint.name}`)
        }
        await queryWithGuardrails(client, `insert into crm_atendimento.schema_migrations(id, applied_at, rolled_back_at, details)
            values ($1, now(), now(), '{"rollback":"non-destructive"}'::jsonb)
            on conflict(id) do update set rolled_back_at = now()`, [ATTENDANCE_WRITE_SAFETY_MIGRATION_ID])
        return { id: ATTENDANCE_WRITE_SAFETY_MIGRATION_ID, rolledBack: true, destructive: false }
    } finally {
        try { await queryWithGuardrails(client, `select pg_advisory_unlock(hashtext($1))`, [ATTENDANCE_WRITE_SAFETY_MIGRATION_ID]) } catch { /* ignore */ }
        client.release()
    }
}
