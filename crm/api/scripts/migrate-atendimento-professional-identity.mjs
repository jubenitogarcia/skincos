#!/usr/bin/env node
import { createPgPool } from '../server/harmonia/store/pg.js'
import { isLocalMirrorDestination } from '../server/atendimento/mirror.js'
import {
    applyProfessionalIdentityMigration,
    rollbackProfessionalIdentityMigration,
} from '../server/atendimento/professionalIdentityMigration.js'

const args = new Set(process.argv.slice(2))
const databaseUrl = String(process.env.DATABASE_URL || '').trim()

if (!args.has('--apply') && !args.has('--rollback')) throw new Error('Use --apply ou --rollback.')
if (!databaseUrl || !isLocalMirrorDestination(databaseUrl)) throw new Error('DATABASE_URL deve apontar exclusivamente para skincos_crm_local.')

const pool = createPgPool(databaseUrl)
try {
    const result = args.has('--rollback')
        ? await rollbackProfessionalIdentityMigration({ pool, databaseUrl })
        : await applyProfessionalIdentityMigration({ pool, databaseUrl })
    console.log(JSON.stringify(result, null, 2))
} finally {
    await pool.end()
}
