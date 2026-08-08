#!/usr/bin/env node
// Controlled local-only migration runner. It intentionally accepts no shell
// expression, target override or arbitrary command: a deployment pipeline may
// pass only one allowlisted action and the database destination is verified by
// the migration module before it opens a usable session.
import { createPgPool } from '../server/harmonia/store/pg.js'
import {
    applyCommercialCanaryMigration,
    parseCommercialCanaryMigrationAction,
    rollbackCommercialCanaryMigration,
} from '../server/atendimento/commercialCanaryMigration.js'

const databaseUrl = String(process.env.DATABASE_URL || '').trim()
const action = parseCommercialCanaryMigrationAction(process.argv.slice(2))
if (!databaseUrl) throw new Error('DATABASE_URL é obrigatório para a migration local controlada.')

const pool = createPgPool(databaseUrl)
if (!pool) throw new Error('Não foi possível criar o pool local de Atendimento.')
try {
    const report = action === 'apply'
        ? await applyCommercialCanaryMigration({ pool, databaseUrl })
        : await rollbackCommercialCanaryMigration({ pool, databaseUrl })
    console.log(JSON.stringify({ action, ...report, commercialWritesEnabled: false, messagesSent: 0 }, null, 2))
} finally {
    await pool.end()
}
