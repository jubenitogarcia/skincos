#!/usr/bin/env node
import { randomUUID } from 'node:crypto'
import { createPgPool } from '../server/harmonia/store/pg.js'
import {
    applyClientesSourceOperationsMigration,
    rollbackClientesSourceOperationsMigration,
    parseClientesSourceOperationsMigrationAction,
} from '../server/atendimento/clientesSourceOperationsMigration.js'
import { assertAtendimentoMigrationDestination, ATENDIMENTO_MIGRATION_TARGETS, isStrictAtendimentoMigrationDestination } from '../server/atendimento/migrationDestination.js'

const target = String(process.env.CLIENTES_SOURCE_OPERATIONS_TARGET || ATENDIMENTO_MIGRATION_TARGETS.LOCAL).trim().toLowerCase()
const databaseUrl = String(process.env.DATABASE_URL || '').trim()
const action = parseClientesSourceOperationsMigrationAction(process.argv.slice(2))
if (!databaseUrl || !isStrictAtendimentoMigrationDestination(databaseUrl, target)) {
    throw new Error('DATABASE_URL deve apontar exclusivamente para o destino local ou staging autorizado.')
}

const pool = createPgPool(databaseUrl)
if (!pool) throw new Error('Não foi possível criar o pool do destino.')
const runId = randomUUID()
try {
    const client = await pool.connect()
    try {
        await client.query('begin')
        const identity = await assertAtendimentoMigrationDestination(client, databaseUrl, target)
        await client.query('commit')
        if (action === 'dry-run') {
            const registry = await client.query(`select to_regclass('crm_atendimento.schema_migrations') as registry`)
            const migrations = registry.rows[0]?.registry
                ? await client.query(`select id, applied_at, rolled_back_at from crm_atendimento.schema_migrations where id=$1`, ['20260806_clientes_source_operations_v1'])
                : { rows: [] }
            console.log(JSON.stringify({ runId, action, target, identity, registryPresent: Boolean(registry.rows[0]?.registry), migrations: migrations.rows }, null, 2))
        } else if (action === 'apply') {
            const report = await applyClientesSourceOperationsMigration({ pool, databaseUrl, target })
            console.log(JSON.stringify({ runId, action, target, identity, report }, null, 2))
        } else {
            const report = await rollbackClientesSourceOperationsMigration({ pool, databaseUrl, target })
            console.log(JSON.stringify({ runId, action, target, identity, report }, null, 2))
        }
    } catch (error) {
        try { await client.query('rollback') } catch { /* preserve original error */ }
        throw error
    } finally {
        client.release()
    }
} finally {
    await pool.end()
}
