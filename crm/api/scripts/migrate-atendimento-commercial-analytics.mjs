#!/usr/bin/env node
import { createPgPool } from '../server/harmonia/store/pg.js'
import {
    applyCommercialAnalyticsMigration,
    commercialAnalyticsMigrationPlan,
    rollbackCommercialAnalyticsMigration,
} from '../server/atendimento/commercialAnalyticsMigration.js'
import {
    assertAtendimentoMigrationDestination,
    ATENDIMENTO_MIGRATION_TARGETS,
    isStrictAtendimentoMigrationDestination,
} from '../server/atendimento/migrationDestination.js'

function errorWithCode(code) { const error = new Error(code); error.code = code; return error }

function parseArguments(args) {
    const targets = args.filter((arg) => arg.startsWith('--target='))
    const actions = args.filter((arg) => ['--dry-run', '--apply', '--rollback'].includes(arg))
    if (targets.length > 1 || actions.length !== 1 || args.length !== targets.length + actions.length) throw errorWithCode('COMMERCIAL_ANALYTICS_MIGRATION_ACTION_INVALID')
    const targetValue = targets[0] ? targets[0].slice('--target='.length) : ATENDIMENTO_MIGRATION_TARGETS.LOCAL
    if (![ATENDIMENTO_MIGRATION_TARGETS.LOCAL, ATENDIMENTO_MIGRATION_TARGETS.STAGING].includes(targetValue)) throw errorWithCode('COMMERCIAL_ANALYTICS_TARGET_INVALID')
    return { target: targetValue, action: actions[0].slice(2) }
}

let pool = null
try {
    const { target, action } = parseArguments(process.argv.slice(2))
    const databaseUrl = String(process.env.DATABASE_URL || '').trim()
    if (!databaseUrl || !isStrictAtendimentoMigrationDestination(databaseUrl, target)) throw errorWithCode('COMMERCIAL_ANALYTICS_DESTINATION_UNSAFE')
    pool = createPgPool(databaseUrl)
    if (!pool) throw errorWithCode('COMMERCIAL_ANALYTICS_POOL_REQUIRED')
    if (action === 'dry-run') {
        const client = await pool.connect()
        try {
            await client.query('begin')
            const identity = await assertAtendimentoMigrationDestination(client, databaseUrl, target)
            const registry = await client.query(`select to_regclass('crm_atendimento.schema_migrations') as registry`)
            await client.query('rollback')
            process.stdout.write(`${JSON.stringify({ ok: true, action, target, identity, registryPresent: Boolean(registry.rows[0]?.registry), plan: commercialAnalyticsMigrationPlan() })}\n`)
        } catch (error) {
            try { await client.query('rollback') } catch { /* preserve guarded failure */ }
            throw error
        } finally { client.release() }
    } else {
        const result = action === 'apply'
            ? await applyCommercialAnalyticsMigration({ pool, databaseUrl, target })
            : await rollbackCommercialAnalyticsMigration({ pool, databaseUrl, target })
        process.stdout.write(`${JSON.stringify({ ok: true, action, target, result, commercialContactWritesEnabled: false, messagingEnabled: false })}\n`)
    }
} catch (error) {
    const code = /^[A-Z][A-Z0-9_]{1,100}$/.test(String(error?.code || '')) ? error.code : 'COMMERCIAL_ANALYTICS_MIGRATION_FAILED'
    process.stderr.write(`${JSON.stringify({ ok: false, code })}\n`)
    process.exitCode = 1
} finally {
    if (pool) await pool.end()
}
