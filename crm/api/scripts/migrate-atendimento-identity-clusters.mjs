#!/usr/bin/env node
import { createPgPool } from '../server/harmonia/store/pg.js'
import { isStrictLocalMirrorDestination } from '../server/atendimento/mirror.js'
import {
    applyIdentityClusterWorkspaceMigration,
    rollbackIdentityClusterWorkspaceMigration,
} from '../server/atendimento/identityClusterWorkspaceMigration.js'

const action = process.argv.slice(2)
if (action.length !== 1 || !['--apply', '--rollback'].includes(action[0])) {
    throw new Error('Use exatamente uma ação: --apply ou --rollback.')
}

const databaseUrl = String(process.env.DATABASE_URL || '').trim()
if (!databaseUrl || !isStrictLocalMirrorDestination(databaseUrl)) {
    throw new Error('DATABASE_URL deve apontar exclusivamente para o socket local admin de skincos_crm_local.')
}

const pool = createPgPool(databaseUrl)
try {
    const result = action[0] === '--apply'
        ? await applyIdentityClusterWorkspaceMigration({ pool, databaseUrl })
        : await rollbackIdentityClusterWorkspaceMigration({ pool, databaseUrl })
    console.log(JSON.stringify(result, null, 2))
} finally {
    await pool.end()
}
