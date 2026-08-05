#!/usr/bin/env node
import { createPgPool } from '../server/harmonia/store/pg.js'
import { isStrictLocalMirrorDestination } from '../server/atendimento/mirror.js'
import {
    applyIdentityReviewWorkflowMigration,
    rollbackIdentityReviewWorkflowMigration,
} from '../server/atendimento/identityReviewMigration.js'

const args = new Set(process.argv.slice(2))
const databaseUrl = String(process.env.DATABASE_URL || '').trim()

if (!args.has('--apply') && !args.has('--rollback')) throw new Error('Use --apply ou --rollback.')
if (!databaseUrl || !isStrictLocalMirrorDestination(databaseUrl)) {
    throw new Error('DATABASE_URL deve apontar exclusivamente para o socket local admin de skincos_crm_local.')
}

const pool = createPgPool(databaseUrl)
try {
    const result = args.has('--rollback')
        ? await rollbackIdentityReviewWorkflowMigration({ pool, databaseUrl })
        : await applyIdentityReviewWorkflowMigration({ pool, databaseUrl })
    console.log(JSON.stringify(result, null, 2))
} finally {
    await pool.end()
}
