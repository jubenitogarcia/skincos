import pg from 'pg'
import { isStrictLocalMirrorDestination } from '../server/atendimento/mirror.js'
import {
    applyClientIdentityMaterializationMigration,
    rollbackClientIdentityMaterializationMigration,
} from '../server/atendimento/clientIdentityMaterializationMigration.js'

const args = new Set(process.argv.slice(2))
const databaseUrl = String(process.env.DATABASE_URL || '').trim()

if (!args.has('--apply') && !args.has('--rollback')) throw new Error('Use --apply ou --rollback.')
if (!databaseUrl || !isStrictLocalMirrorDestination(databaseUrl)) {
    throw new Error('DATABASE_URL deve apontar exclusivamente para o socket local admin de skincos_crm_local.')
}
if (args.has('--apply') && process.env.CLIENT_IDENTITY_MATERIALIZATION_MIGRATION_CONFIRM !== 'MIGRAR_SKINCOS_CRM_LOCAL') {
    throw new Error('CLIENT_IDENTITY_MATERIALIZATION_MIGRATION_CONFIRM=MIGRAR_SKINCOS_CRM_LOCAL é obrigatório para --apply.')
}

const pool = new pg.Pool({ connectionString: databaseUrl, max: 1, application_name: 'crm-client-identity-materialization-migration' })
try {
    const result = args.has('--rollback')
        ? await rollbackClientIdentityMaterializationMigration({ pool, databaseUrl })
        : await applyClientIdentityMaterializationMigration({ pool, databaseUrl })
    console.log(JSON.stringify(result, null, 2))
} finally {
    await pool.end()
}
