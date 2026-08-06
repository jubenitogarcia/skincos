import { createPgPool } from '../server/harmonia/store/pg.js'
import {
    applyCommercialAnalyticsMigration,
    parseCommercialAnalyticsMigrationAction,
    rollbackCommercialAnalyticsMigration,
} from '../server/atendimento/commercialAnalyticsMigration.js'
import { ATENDIMENTO_MIGRATION_TARGETS, isStrictAtendimentoMigrationDestination } from '../server/atendimento/migrationDestination.js'

const action = parseCommercialAnalyticsMigrationAction(process.argv.slice(2))
const databaseUrl = String(process.env.DATABASE_URL || '').trim()
const target = String(process.env.ATENDIMENTO_MIGRATION_TARGET || ATENDIMENTO_MIGRATION_TARGETS.LOCAL).trim()
if (!databaseUrl || !isStrictAtendimentoMigrationDestination(databaseUrl, target)) {
    throw new Error('COMMERCIAL_ANALYTICS_MIGRATION_DESTINATION_UNSAFE')
}
const pool = createPgPool(databaseUrl)
try {
    const report = action === 'apply'
        ? await applyCommercialAnalyticsMigration({ pool, databaseUrl, target })
        : await rollbackCommercialAnalyticsMigration({ pool, databaseUrl, target })
    console.log(JSON.stringify(report, null, 2))
} finally {
    await pool.end()
}
