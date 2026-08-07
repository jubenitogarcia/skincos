#!/usr/bin/env node
import { createPgPool } from '../server/harmonia/store/pg.js'
import {
    applyCommercialOperationsMigration,
    commercialOperationsMigrationPlan,
    rollbackCommercialOperationsMigration,
} from '../server/atendimento/commercialOperationsMigration.js'
import {
    assertAtendimentoMigrationDestination,
    ATENDIMENTO_MIGRATION_TARGETS,
    isStrictAtendimentoMigrationDestination,
} from '../server/atendimento/migrationDestination.js'

function commandError(code) {
    const error = new Error(code)
    error.code = code
    return error
}

function parseTarget(args) {
    const values = args.filter((arg) => arg.startsWith('--target='))
    if (values.length > 1) throw commandError('COMMERCIAL_OPERATIONS_TARGET_INVALID')
    const value = values[0] ? values[0].slice('--target='.length) : ATENDIMENTO_MIGRATION_TARGETS.LOCAL
    if (value === ATENDIMENTO_MIGRATION_TARGETS.LOCAL || value === ATENDIMENTO_MIGRATION_TARGETS.STAGING) return value
    throw commandError('COMMERCIAL_OPERATIONS_TARGET_INVALID')
}

let pool = null

try {
    const args = process.argv.slice(2)
    const target = parseTarget(args)
    const actions = args.filter((arg) => ['--dry-run', '--apply', '--rollback'].includes(arg))
    if (actions.length !== 1 || args.length !== actions.length + args.filter((arg) => arg.startsWith('--target=')).length) {
        throw commandError('COMMERCIAL_OPERATIONS_MIGRATION_ACTION_INVALID')
    }
    const action = actions[0].slice(2)
    const databaseUrl = String(process.env.DATABASE_URL || '').trim()
    if (!databaseUrl || !isStrictAtendimentoMigrationDestination(databaseUrl, target)) {
        throw commandError('COMMERCIAL_OPERATIONS_DESTINATION_UNSAFE')
    }
    pool = createPgPool(databaseUrl)
    if (!pool) throw commandError('COMMERCIAL_OPERATIONS_POOL_REQUIRED')

    if (action === 'dry-run') {
        const client = await pool.connect()
        try {
            await client.query('begin')
            const identity = await assertAtendimentoMigrationDestination(client, databaseUrl, target)
            const registry = await client.query(`select to_regclass('crm_atendimento.schema_migrations') as registry`)
            await client.query('rollback')
            process.stdout.write(`${JSON.stringify({ ok: true, action, target, identity, registryPresent: Boolean(registry.rows[0]?.registry), plan: commercialOperationsMigrationPlan() })}\n`)
        } catch (error) {
            try { await client.query('rollback') } catch { /* preserve guarded failure */ }
            throw error
        } finally {
            client.release()
        }
    } else {
        const result = action === 'apply'
            ? await applyCommercialOperationsMigration({ pool, databaseUrl, target })
            : await rollbackCommercialOperationsMigration({ pool, databaseUrl, target })
        process.stdout.write(`${JSON.stringify({ ok: true, action, target, result, commercialContactWritesEnabled: false, messagingEnabled: false })}\n`)
    }
} catch (error) {
    const code = /^[A-Z][A-Z0-9_]{1,100}$/.test(String(error?.code || ''))
        ? error.code
        : 'COMMERCIAL_OPERATIONS_MIGRATION_FAILED'
    process.stderr.write(`${JSON.stringify({ ok: false, code })}\n`)
    process.exitCode = 1
} finally {
    if (pool) await pool.end()
}
