#!/usr/bin/env node
import { createPgPool, withPgTransaction } from '../server/harmonia/store/pg.js'
import { isLocalMirrorDestination } from '../server/atendimento/mirror.js'
import { migrateAtendimento } from '../server/atendimento/store.js'
import {
    applyAtendimentoWriteSafetyMigration,
    rollbackAtendimentoWriteSafetyMigration,
} from '../server/atendimento/writeSafetyMigration.js'

const args = new Set(process.argv.slice(2))
const databaseUrl = String(process.env.DATABASE_URL || '').trim()

if (!args.has('--apply') && !args.has('--rollback')) {
    throw new Error('Use --apply para executar ou --rollback para reverter apenas índices e constraints.')
}
if (!databaseUrl || !isLocalMirrorDestination(databaseUrl)) {
    throw new Error('DATABASE_URL deve apontar exclusivamente para o banco local skincos_crm_local.')
}

const pool = createPgPool(databaseUrl)
if (!pool) throw new Error('DATABASE_URL não configurada.')

try {
    if (args.has('--rollback')) {
        console.log(JSON.stringify(await rollbackAtendimentoWriteSafetyMigration({ pool, databaseUrl }), null, 2))
    } else {
        await withPgTransaction(pool, migrateAtendimento)
        console.log(JSON.stringify(await applyAtendimentoWriteSafetyMigration({ pool, databaseUrl }), null, 2))
    }
} finally {
    await pool.end()
}
