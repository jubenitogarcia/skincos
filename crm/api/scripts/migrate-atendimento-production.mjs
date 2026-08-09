#!/usr/bin/env node
/**
 * Controlled schema release for the dedicated production Clientes database.
 *
 * Production intentionally reuses the reviewed migration plan but never the
 * staging prerequisite-defer policy. Any missing relation, identity mismatch,
 * or migration error is terminal and leaves the runtime in maintenance.
 */
import { randomUUID } from 'node:crypto'
import { createPgPool } from '../server/harmonia/store/pg.js'
import {
    acquireAtendimentoStagingMutationLock,
    assertAtendimentoStagingMigratorConnectionLimit,
    ATENDIMENTO_STAGING_MIGRATION_POOL_MAX,
    releaseAtendimentoStagingMutationLock,
} from './atendimento-staging-maintenance-lock.mjs'
import {
    assertAtendimentoMigrationDestination,
    ATENDIMENTO_MIGRATION_TARGETS,
    isStrictAtendimentoMigrationDestination,
} from '../server/atendimento/migrationDestination.js'
import {
    ATENDIMENTO_STAGING_MIGRATIONS,
} from './migrate-atendimento-staging.mjs'
import {
    atendimentoCoreSchemaMigrationPlan,
    inspectAtendimentoCoreSchema,
} from '../server/atendimento/coreSchemaMigration.js'

export const ATENDIMENTO_PRODUCTION_MIGRATION_TARGET = ATENDIMENTO_MIGRATION_TARGETS.PRODUCTION
export const ATENDIMENTO_PRODUCTION_MIGRATIONS = ATENDIMENTO_STAGING_MIGRATIONS

function isReleaseSha(value) {
    return /^[0-9a-f]{40}$/.test(String(value || '').trim())
}

export function parseAtendimentoProductionMigrationInvocation(args = []) {
    const values = Array.isArray(args) ? args.map(String) : []
    if (values.length !== 3 || !['apply', 'rollback', 'dry-run'].includes(values[0]) || values[1] !== '--release-sha' || !isReleaseSha(values[2])) {
        throw new Error('Use exatamente apply|rollback|dry-run --release-sha <sha-40-minúsculo>.')
    }
    return { action: values[0], releaseSha: values[2] }
}

export async function runAtendimentoProductionMigration({
    databaseUrl,
    action,
    createPool = createPgPool,
    createRunId = randomUUID,
    migrations = ATENDIMENTO_PRODUCTION_MIGRATIONS,
    releaseSha,
    assertDestination = assertAtendimentoMigrationDestination,
} = {}) {
    const target = ATENDIMENTO_PRODUCTION_MIGRATION_TARGET
    const normalizedUrl = String(databaseUrl || '').trim()
    const normalizedReleaseSha = String(releaseSha || '').trim()
    if (!['apply', 'rollback', 'dry-run'].includes(String(action || ''))) {
        throw new Error('ATENDIMENTO_PRODUCTION_MIGRATION_ACTION_INVALID')
    }
    if (!normalizedUrl || !isStrictAtendimentoMigrationDestination(normalizedUrl, target)) {
        throw new Error('DATABASE_URL deve apontar exclusivamente para skincos_clientes_production via loopback TLS e o login migrator.')
    }
    if (!isReleaseSha(normalizedReleaseSha)) {
        throw new Error('ATENDIMENTO_PRODUCTION_MIGRATION_RELEASE_SHA_INVALID')
    }
    if (!Array.isArray(migrations) || migrations.some((migration) => !migration?.id || typeof migration.apply !== 'function' || typeof migration.rollback !== 'function')) {
        throw new Error('ATENDIMENTO_PRODUCTION_MIGRATION_PLAN_INVALID')
    }

    const pool = createPool(normalizedUrl, { max: ATENDIMENTO_STAGING_MIGRATION_POOL_MAX })
    if (!pool) throw new Error('Não foi possível criar o pool production.')
    const runId = createRunId()
    let lockClient = null
    let lockAcquired = false
    try {
        lockClient = await pool.connect()
        await acquireAtendimentoStagingMutationLock(lockClient, 'ATENDIMENTO_PRODUCTION_MIGRATION_LOCK_UNAVAILABLE')
        lockAcquired = true
        await assertAtendimentoStagingMigratorConnectionLimit(lockClient)

        const client = await pool.connect()
        let identity
        let registry = { rows: [] }
        let coreSchema
        try {
            await client.query('begin')
            identity = await assertDestination(client, normalizedUrl, target)
            const registryExists = await client.query(`select to_regclass('crm_atendimento.schema_migrations') as registry`)
            if (registryExists.rows[0]?.registry) {
                registry = await client.query(`select id, applied_at, rolled_back_at
                    from crm_atendimento.schema_migrations
                    order by id`)
            }
            coreSchema = await inspectAtendimentoCoreSchema(client)
            await client.query('commit')
        } catch (error) {
            try { await client.query('rollback') } catch { /* preserve original error */ }
            throw error
        } finally {
            client.release()
        }

        if (action === 'dry-run') {
            return {
                runId,
                action,
                target,
                identity,
                registryPresent: registry.rows.length > 0,
                coreSchema,
                coreSchemaPlan: atendimentoCoreSchemaMigrationPlan(),
                migrations: registry.rows,
                releaseSha: normalizedReleaseSha,
                deferred: [],
                commercialWritesEnabled: false,
            }
        }

        const ordered = action === 'rollback' ? [...migrations].reverse() : migrations
        const reports = []
        for (const migration of ordered) {
            const report = await migration[action]({ pool, databaseUrl: normalizedUrl, target })
            reports.push({ id: migration.id, report })
        }
        return {
            runId,
            action,
            target,
            releaseSha: normalizedReleaseSha,
            migrations: reports,
            deferred: [],
            commercialWritesEnabled: false,
        }
    } finally {
        if (lockClient) {
            if (lockAcquired) {
                try { await releaseAtendimentoStagingMutationLock(lockClient) } catch { /* pool close releases session lock */ }
            }
            lockClient.release()
        }
        await pool.end()
    }
}

const entrypoint = new URL(import.meta.url).pathname
if (process.argv[1] && process.argv[1].replaceAll('\\', '/') === entrypoint) {
    const { action, releaseSha } = parseAtendimentoProductionMigrationInvocation(process.argv.slice(2))
    const report = await runAtendimentoProductionMigration({
        databaseUrl: process.env.DATABASE_URL,
        action,
        releaseSha,
    })
    console.log(JSON.stringify(report, null, 2))
}
