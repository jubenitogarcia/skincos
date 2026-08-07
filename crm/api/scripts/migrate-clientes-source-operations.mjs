#!/usr/bin/env node
import { createPgPool } from '../server/harmonia/store/pg.js'
import {
    applyClientesSourceOperationsMigration,
    clientesSourceOperationsMigrationPlan,
    rollbackClientesSourceOperationsMigration,
} from '../server/clientes/sourceOperationsMigration.js'
import {
    assertAtendimentoMigrationDestination,
    ATENDIMENTO_MIGRATION_TARGETS,
    isStrictAtendimentoMigrationDestination,
} from '../server/atendimento/migrationDestination.js'

let pool

try {
    const args = process.argv.slice(2)
    const selected = args.filter((arg) => ['--dry-run', '--apply', '--rollback'].includes(arg))
    if (selected.length !== 1 || args.length !== 1) throw Object.assign(new Error('CLIENTES_SOURCE_OPERATIONS_MIGRATION_ACTION_INVALID'), { code: 'CLIENTES_SOURCE_OPERATIONS_MIGRATION_ACTION_INVALID' })
    const action = selected[0].slice(2)
    const target = ATENDIMENTO_MIGRATION_TARGETS.LOCAL
    const databaseUrl = String(process.env.DATABASE_URL || '').trim()
    if (!databaseUrl || !isStrictAtendimentoMigrationDestination(databaseUrl, target)) {
        throw Object.assign(new Error('CLIENTES_SOURCE_OPERATIONS_DESTINATION_UNSAFE'), { code: 'CLIENTES_SOURCE_OPERATIONS_DESTINATION_UNSAFE' })
    }
    pool = createPgPool(databaseUrl)
    if (!pool) throw Object.assign(new Error('CLIENTES_SOURCE_OPERATIONS_POOL_REQUIRED'), { code: 'CLIENTES_SOURCE_OPERATIONS_POOL_REQUIRED' })
    if (action === 'dry-run') {
        const client = await pool.connect()
        try {
            await client.query('begin')
            const identity = await assertAtendimentoMigrationDestination(client, databaseUrl, target)
            const registry = await client.query(`select to_regclass('crm_atendimento.schema_migrations') as registry`)
            await client.query('rollback')
            process.stdout.write(`${JSON.stringify({ ok: true, action, target, identity, registryPresent: Boolean(registry.rows[0]?.registry), plan: clientesSourceOperationsMigrationPlan() })}\n`)
        } catch (error) {
            try { await client.query('rollback') } catch { /* preserve the guarded failure */ }
            throw error
        } finally {
            client.release()
        }
    } else {
        const result = action === 'apply'
            ? await applyClientesSourceOperationsMigration({ pool, databaseUrl, target })
            : await rollbackClientesSourceOperationsMigration({ pool, databaseUrl, target })
        process.stdout.write(`${JSON.stringify({ ok: true, action, target, result })}\n`)
    }
} catch (error) {
    const code = /^[A-Z][A-Z0-9_]{1,100}$/.test(String(error?.code || '')) ? error.code : 'CLIENTES_SOURCE_OPERATIONS_MIGRATION_FAILED'
    process.stderr.write(`${JSON.stringify({ ok: false, code })}\n`)
    process.exitCode = 1
} finally {
    if (pool) await pool.end()
}
