import { createPgPool } from '../server/harmonia/store/pg.js'
import {
    applyCommercialAssistedCommunicationMigration,
    parseCommercialAssistedCommunicationMigrationAction,
    rollbackCommercialAssistedCommunicationMigration,
} from '../server/atendimento/commercialAssistedCommunicationMigration.js'

const action = parseCommercialAssistedCommunicationMigrationAction(process.argv.slice(2))
const databaseUrl = String(process.env.DATABASE_URL || '').trim()
const target = String(process.env.ATENDIMENTO_MIGRATION_TARGET || 'local').trim().toLowerCase()
if (!databaseUrl) throw new Error('COMMERCIAL_ASSISTED_COMMUNICATION_MIGRATION_DATABASE_URL_REQUIRED')
if (!['local', 'staging'].includes(target)) throw new Error('COMMERCIAL_ASSISTED_COMMUNICATION_MIGRATION_TARGET_INVALID')

const pool = createPgPool(databaseUrl)
try {
    const report = action === 'apply'
        ? await applyCommercialAssistedCommunicationMigration({ pool, databaseUrl, target })
        : await rollbackCommercialAssistedCommunicationMigration({ pool, databaseUrl, target })
    console.log(JSON.stringify(report))
} finally {
    await pool.end()
}
