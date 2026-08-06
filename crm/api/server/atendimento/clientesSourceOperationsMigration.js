import { promises as fs } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { assertAtendimentoMigrationDestination, ATENDIMENTO_MIGRATION_TARGETS, isStrictAtendimentoMigrationDestination } from './migrationDestination.js'

export const CLIENTES_SOURCE_OPERATIONS_MIGRATION_ID = '20260806_clientes_source_operations_v1'
export const CLIENTES_SOURCE_OPERATIONS_MIGRATION_ACTIONS = Object.freeze(['--apply', '--rollback', '--dry-run'])

const RUNTIME_ROLES = Object.freeze({
    [ATENDIMENTO_MIGRATION_TARGETS.LOCAL]: 'skincos',
    [ATENDIMENTO_MIGRATION_TARGETS.STAGING]: 'skincos_staging_crm_app',
})

const SQL_FILE = fileURLToPath(new URL('./migrations/20260806_clientes_source_operations_v1.up.sql', import.meta.url))
const PREREQUISITES = [
    'crm_atendimento.commercial_data_quality_findings',
    'crm_atendimento.commercial_data_quality_finding_events',
]

function migrationError(code, message = code) {
    const error = new Error(message)
    error.code = code
    return error
}

export function parseClientesSourceOperationsMigrationAction(args = []) {
    const values = Array.isArray(args) ? args.map((value) => String(value)) : []
    if (values.length !== 1 || !CLIENTES_SOURCE_OPERATIONS_MIGRATION_ACTIONS.includes(values[0])) {
        throw migrationError('CLIENTES_SOURCE_OPERATIONS_MIGRATION_ACTION_INVALID', 'Use exatamente uma ação: --dry-run, --apply ou --rollback.')
    }
    return values[0] === '--apply' ? 'apply' : values[0] === '--rollback' ? 'rollback' : 'dry-run'
}

export function clientesSourceOperationsMigrationPlan() {
    return {
        id: CLIENTES_SOURCE_OPERATIONS_MIGRATION_ID,
        tables: ['clientes_source_runs', 'clientes_source_checkpoints', 'clientes_source_dead_letters'],
        prerequisites: [...PREREQUISITES],
        runtimeAccess: 'O runtime recebe apenas SELECT/INSERT/UPDATE no ledger agregado e INSERT/SELECT no dead-letter; não recebe escrita comercial.',
        absencePolicy: 'Nenhuma linha de cliente é removida ou aposentada por ausência em uma leitura. Ausência só é contabilizada como divergência após prova de snapshot completo.',
        piiPolicy: 'Coverage, erros, métricas e dead-letters aceitam somente identificadores técnicos e contagens allowlisted; não armazenam PII nem payload bruto.',
        rollback: 'Não destrutivo: conserva checkpoints, execuções e evidência de falha; apenas marca a migração como revertida.',
    }
}

async function ensureRegistry(client) {
    await client.query(`create schema if not exists crm_atendimento`)
    await client.query(`create table if not exists crm_atendimento.schema_migrations (
        id text primary key, applied_at timestamptz not null default now(), rolled_back_at timestamptz,
        details jsonb not null default '{}'::jsonb
    )`)
}

async function assertPrerequisites(client) {
    const expressions = PREREQUISITES.map((relation, index) => `to_regclass('${relation}') is not null as dependency_${index}`).join(', ')
    const result = await client.query(`select ${expressions}`)
    const row = result.rows[0] || {}
    if (PREREQUISITES.some((_relation, index) => row[`dependency_${index}`] !== true)) {
        throw migrationError('CLIENTES_SOURCE_OPERATIONS_PREREQUISITES_MISSING')
    }
}

function runtimeGrantStatements(target) {
    const role = RUNTIME_ROLES[target]
    if (!role) throw migrationError('CLIENTES_SOURCE_OPERATIONS_RUNTIME_ROLE_UNKNOWN')
    return [
        `grant usage on schema crm_atendimento to ${role}`,
        `grant select, insert, update on table crm_atendimento.clientes_source_runs to ${role}`,
        `grant select, insert, update on table crm_atendimento.clientes_source_checkpoints to ${role}`,
        `grant select, insert on table crm_atendimento.clientes_source_dead_letters to ${role}`,
    ]
}

async function assertDestination(client, databaseUrl, target) {
    if (!isStrictAtendimentoMigrationDestination(databaseUrl, target)) throw migrationError('CLIENTES_SOURCE_OPERATIONS_DESTINATION_UNSAFE')
    try {
        await assertAtendimentoMigrationDestination(client, databaseUrl, target)
    } catch {
        throw migrationError('CLIENTES_SOURCE_OPERATIONS_DESTINATION_UNSAFE')
    }
}

export async function applyClientesSourceOperationsMigration({ pool, databaseUrl, target = ATENDIMENTO_MIGRATION_TARGETS.LOCAL } = {}) {
    if (!pool) throw migrationError('CLIENTES_SOURCE_OPERATIONS_POOL_REQUIRED')
    if (!isStrictAtendimentoMigrationDestination(databaseUrl, target)) throw migrationError('CLIENTES_SOURCE_OPERATIONS_DESTINATION_UNSAFE')
    const client = await pool.connect()
    const report = {
        id: CLIENTES_SOURCE_OPERATIONS_MIGRATION_ID,
        applied: false,
        tables: clientesSourceOperationsMigrationPlan().tables,
        runtimeRole: RUNTIME_ROLES[target],
        absencePolicy: 'no_automatic_retirement',
        piiFree: true,
    }
    try {
        await client.query(`set lock_timeout = '3s'`)
        await client.query(`set statement_timeout = '60s'`)
        await client.query(`select pg_advisory_lock(hashtext($1))`, [CLIENTES_SOURCE_OPERATIONS_MIGRATION_ID])
        await assertDestination(client, databaseUrl, target)
        await assertPrerequisites(client)
        await ensureRegistry(client)
        await client.query('begin')
        try {
            await client.query(await fs.readFile(SQL_FILE, 'utf8'))
            const grants = runtimeGrantStatements(target)
            for (const sql of grants) await client.query(sql)
            report.runtimeGrants = grants
            report.applied = true
            await client.query(`insert into crm_atendimento.schema_migrations(id, applied_at, rolled_back_at, details)
                values($1, now(), null, $2::jsonb)
                on conflict(id) do update set applied_at=excluded.applied_at, rolled_back_at=null, details=excluded.details`,
            [CLIENTES_SOURCE_OPERATIONS_MIGRATION_ID, JSON.stringify(report)])
            await client.query('commit')
        } catch (error) {
            try { await client.query('rollback') } catch { /* preserve original error */ }
            throw error
        }
        return report
    } finally {
        try { await client.query(`select pg_advisory_unlock(hashtext($1))`, [CLIENTES_SOURCE_OPERATIONS_MIGRATION_ID]) } catch { /* connection cleanup releases lock */ }
        client.release()
    }
}

export async function rollbackClientesSourceOperationsMigration({ pool, databaseUrl, target = ATENDIMENTO_MIGRATION_TARGETS.LOCAL } = {}) {
    if (!pool) throw migrationError('CLIENTES_SOURCE_OPERATIONS_POOL_REQUIRED')
    if (!isStrictAtendimentoMigrationDestination(databaseUrl, target)) throw migrationError('CLIENTES_SOURCE_OPERATIONS_DESTINATION_UNSAFE')
    const client = await pool.connect()
    try {
        await client.query(`set lock_timeout = '3s'`)
        await client.query(`select pg_advisory_lock(hashtext($1))`, [CLIENTES_SOURCE_OPERATIONS_MIGRATION_ID])
        await assertDestination(client, databaseUrl, target)
        await ensureRegistry(client)
        await client.query(`insert into crm_atendimento.schema_migrations(id, applied_at, rolled_back_at, details)
            values($1, now(), now(), '{"rollback":"non-destructive","evidenceRetained":true}'::jsonb)
            on conflict(id) do update set rolled_back_at=now(), details=excluded.details`, [CLIENTES_SOURCE_OPERATIONS_MIGRATION_ID])
        return { id: CLIENTES_SOURCE_OPERATIONS_MIGRATION_ID, rolledBack: true, destructive: false, evidenceRetained: true }
    } finally {
        try { await client.query(`select pg_advisory_unlock(hashtext($1))`, [CLIENTES_SOURCE_OPERATIONS_MIGRATION_ID]) } catch { /* connection cleanup releases lock */ }
        client.release()
    }
}
