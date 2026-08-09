import { migrateAtendimento, atendimentoMigrationStatements } from './store.js'
import {
    assertAtendimentoMigrationDestination,
    ATENDIMENTO_MIGRATION_TARGETS,
    isStrictAtendimentoMigrationDestination,
} from './migrationDestination.js'

export const ATENDIMENTO_CORE_SCHEMA_MIGRATION_ID = '20260808_atendimento_core_schema_v1'

const CORE_SCHEMA_RELATIONS = Object.freeze([
    ...new Set(atendimentoMigrationStatements()
        .flatMap((statement) => [...statement.matchAll(/create table if not exists\s+(crm_atendimento\.[a-z0-9_]+)/gi)])
        .map((match) => match[1])),
])

function migrationError(code) {
    const error = new Error(code)
    error.code = code
    return error
}

async function ensureRegistry(client) {
    await client.query(`create schema if not exists crm_atendimento`)
    await client.query(`create table if not exists crm_atendimento.schema_migrations (
        id text primary key,
        applied_at timestamptz not null default now(),
        rolled_back_at timestamptz,
        details jsonb not null default '{}'::jsonb
    )`)
}

export async function inspectAtendimentoCoreSchema(client) {
    const result = await client.query(`
        select relation_name,
               to_regclass(relation_name) is not null as present
          from unnest($1::text[]) as requested(relation_name)
         order by relation_name
    `, [CORE_SCHEMA_RELATIONS])
    const relations = result.rows.map((row) => ({
        relation: String(row.relation_name),
        present: row.present === true,
    }))
    return {
        ready: relations.every((relation) => relation.present),
        relations,
        missing: relations.filter((relation) => !relation.present).map((relation) => relation.relation),
    }
}

async function assertDestination(client, databaseUrl, target) {
    if (!isStrictAtendimentoMigrationDestination(databaseUrl, target)) {
        throw migrationError('ATENDIMENTO_CORE_SCHEMA_DESTINATION_UNSAFE')
    }
    try {
        return await assertAtendimentoMigrationDestination(client, databaseUrl, target)
    } catch {
        throw migrationError('ATENDIMENTO_CORE_SCHEMA_DESTINATION_UNSAFE')
    }
}

export function atendimentoCoreSchemaMigrationPlan() {
    return {
        id: ATENDIMENTO_CORE_SCHEMA_MIGRATION_ID,
        source: 'crm_atendimento.store.migrateAtendimento',
        relationCount: CORE_SCHEMA_RELATIONS.length,
        relations: [...CORE_SCHEMA_RELATIONS],
        behavior: 'idempotent additive schema bootstrap; existing data and tables are preserved',
        rollback: 'non-destructive; schema and data are retained, registry state is marked rolled back',
        runtimeAccess: 'no runtime grants are changed here; feature migrations and the staging seal own access policy',
    }
}

export async function applyAtendimentoCoreSchemaMigration({
    pool,
    databaseUrl,
    target = ATENDIMENTO_MIGRATION_TARGETS.LOCAL,
} = {}) {
    if (!pool) throw migrationError('ATENDIMENTO_CORE_SCHEMA_POOL_REQUIRED')
    if (!isStrictAtendimentoMigrationDestination(databaseUrl, target)) {
        throw migrationError('ATENDIMENTO_CORE_SCHEMA_DESTINATION_UNSAFE')
    }
    const client = await pool.connect()
    let transactionOpen = false
    try {
        await client.query('begin')
        transactionOpen = true
        await client.query(`set local lock_timeout = '3s'`)
        await client.query(`set local statement_timeout = '120s'`)
        await client.query(`select pg_advisory_xact_lock(hashtext($1))`, [ATENDIMENTO_CORE_SCHEMA_MIGRATION_ID])
        const destination = await assertDestination(client, databaseUrl, target)
        await migrateAtendimento(client)
        const schema = await inspectAtendimentoCoreSchema(client)
        if (!schema.ready) throw migrationError('ATENDIMENTO_CORE_SCHEMA_INCOMPLETE')
        await ensureRegistry(client)
        const report = {
            ...atendimentoCoreSchemaMigrationPlan(),
            applied: true,
            target,
            database: destination.database,
            schema,
        }
        await client.query(`insert into crm_atendimento.schema_migrations(id, applied_at, rolled_back_at, details)
            values ($1, now(), null, $2::jsonb)
            on conflict(id) do update set applied_at = excluded.applied_at, rolled_back_at = null, details = excluded.details`, [
            ATENDIMENTO_CORE_SCHEMA_MIGRATION_ID,
            JSON.stringify(report),
        ])
        await client.query('commit')
        transactionOpen = false
        return report
    } catch (error) {
        if (transactionOpen) {
            try { await client.query('rollback') } catch { /* preserve original failure */ }
        }
        throw error
    } finally {
        client.release()
    }
}

export async function rollbackAtendimentoCoreSchemaMigration({
    pool,
    databaseUrl,
    target = ATENDIMENTO_MIGRATION_TARGETS.LOCAL,
} = {}) {
    if (!pool) throw migrationError('ATENDIMENTO_CORE_SCHEMA_POOL_REQUIRED')
    if (!isStrictAtendimentoMigrationDestination(databaseUrl, target)) {
        throw migrationError('ATENDIMENTO_CORE_SCHEMA_DESTINATION_UNSAFE')
    }
    const client = await pool.connect()
    let transactionOpen = false
    try {
        await client.query('begin')
        transactionOpen = true
        await client.query(`set local lock_timeout = '3s'`)
        await client.query(`select pg_advisory_xact_lock(hashtext($1))`, [ATENDIMENTO_CORE_SCHEMA_MIGRATION_ID])
        await assertDestination(client, databaseUrl, target)
        await ensureRegistry(client)
        await client.query(`insert into crm_atendimento.schema_migrations(id, applied_at, rolled_back_at, details)
            values ($1, now(), now(), '{"rollback":"non-destructive","schemaRetained":true}'::jsonb)
            on conflict(id) do update set rolled_back_at = now(), details = excluded.details`, [
            ATENDIMENTO_CORE_SCHEMA_MIGRATION_ID,
        ])
        await client.query('commit')
        transactionOpen = false
        return {
            id: ATENDIMENTO_CORE_SCHEMA_MIGRATION_ID,
            rolledBack: true,
            destructive: false,
            schemaRetained: true,
        }
    } catch (error) {
        if (transactionOpen) {
            try { await client.query('rollback') } catch { /* preserve original failure */ }
        }
        throw error
    } finally {
        client.release()
    }
}

export const __testables = Object.freeze({
    CORE_SCHEMA_RELATIONS,
})
