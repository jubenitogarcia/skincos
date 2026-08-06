#!/usr/bin/env node
import { createPgPool } from '../server/harmonia/store/pg.js'
import { isStrictLocalMirrorDestination } from '../server/atendimento/mirror.js'
import {
    applyCommercialCanaryMigration,
    parseCommercialCanaryMigrationAction,
    rollbackCommercialCanaryMigration,
} from '../server/atendimento/commercialCanaryMigration.js'

const action = parseCommercialCanaryMigrationAction(process.argv.slice(2))
const databaseUrl = String(process.env.DATABASE_URL || '').trim()
if (!databaseUrl || !isStrictLocalMirrorDestination(databaseUrl)) {
    throw new Error('DATABASE_URL deve apontar exclusivamente para o socket local admin de skincos_crm_local.')
}
const pool = createPgPool(databaseUrl)
try {
    const result = action === 'rollback'
        ? await rollbackCommercialCanaryMigration({ pool, databaseUrl })
        : await applyCommercialCanaryMigration({ pool, databaseUrl })
    console.log(JSON.stringify(result, null, 2))
} finally {
    await pool.end()
}
