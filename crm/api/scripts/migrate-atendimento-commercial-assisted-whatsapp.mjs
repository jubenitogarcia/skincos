#!/usr/bin/env node
import { createPgPool } from '../server/harmonia/store/pg.js'
import {
    applyCommercialAssistedMigration,
    commercialAssistedMigrationPlan,
    rollbackCommercialAssistedMigration,
} from '../server/atendimento/commercialAssistedCommunicationMigration.js'
import {
    assertAtendimentoMigrationDestination,
    ATENDIMENTO_MIGRATION_TARGETS,
    isStrictAtendimentoMigrationDestination,
} from '../server/atendimento/migrationDestination.js'

const ALLOWED_ACTIONS = new Set(['--dry-run', '--apply', '--rollback'])

function commandError(code) {
    const error = new Error(code)
    error.code = code
    return error
}

function parseTarget(args) {
    const values = args.filter((arg) => arg.startsWith('--target='))
    if (values.length > 1) throw commandError('COMMERCIAL_ASSISTED_TARGET_INVALID')
    const target = values[0] ? values[0].slice('--target='.length) : ATENDIMENTO_MIGRATION_TARGETS.LOCAL
    if (target === ATENDIMENTO_MIGRATION_TARGETS.STAGING) {
        throw commandError('COMMERCIAL_ASSISTED_STAGING_REQUIRES_CONTROLLED_RUNNER')
    }
    if (target === ATENDIMENTO_MIGRATION_TARGETS.LOCAL) return target
    throw commandError('COMMERCIAL_ASSISTED_TARGET_INVALID')
}

let pool = null

try {
    const args = process.argv.slice(2)
    const target = parseTarget(args)
    const actions = args.filter((arg) => ALLOWED_ACTIONS.has(arg))
    const targetArgs = args.filter((arg) => arg.startsWith('--target='))
    if (actions.length !== 1 || args.length !== actions.length + targetArgs.length) {
        throw commandError('COMMERCIAL_ASSISTED_MIGRATION_ACTION_INVALID')
    }
    const action = actions[0].slice(2)
    const databaseUrl = String(process.env.DATABASE_URL || '').trim()
    if (!databaseUrl || !isStrictAtendimentoMigrationDestination(databaseUrl, target)) {
        throw commandError('COMMERCIAL_ASSISTED_DESTINATION_UNSAFE')
    }
    pool = createPgPool(databaseUrl)
    if (!pool) throw commandError('COMMERCIAL_ASSISTED_POOL_REQUIRED')

    if (action === 'dry-run') {
        const client = await pool.connect()
        try {
            await client.query('begin')
            const identity = await assertAtendimentoMigrationDestination(client, databaseUrl, target)
            const registry = await client.query(`select to_regclass('crm_atendimento.schema_migrations') as registry`)
            await client.query('rollback')
            process.stdout.write(`${JSON.stringify({ ok: true, action, target, identity, registryPresent: Boolean(registry.rows[0]?.registry), plan: commercialAssistedMigrationPlan() })}\n`)
        } catch (error) {
            try { await client.query('rollback') } catch { /* preserve guarded failure */ }
            throw error
        } finally {
            client.release()
        }
    } else {
        const result = action === 'apply'
            ? await applyCommercialAssistedMigration({ pool, databaseUrl, target })
            : await rollbackCommercialAssistedMigration({ pool, databaseUrl, target })
        process.stdout.write(`${JSON.stringify({ ok: true, action, target, result, providerSend: false, externalDispatch: false, automationEnabled: false })}\n`)
    }
} catch (error) {
    const code = /^[A-Z][A-Z0-9_]{1,100}$/.test(String(error?.code || ''))
        ? error.code
        : 'COMMERCIAL_ASSISTED_MIGRATION_FAILED'
    process.stderr.write(`${JSON.stringify({ ok: false, code })}\n`)
    process.exitCode = 1
} finally {
    if (pool) await pool.end()
}
