#!/usr/bin/env node
import { createPgPool } from '../server/harmonia/store/pg.js'
import {
    ATENDIMENTO_MIGRATION_TARGETS,
    isStrictAtendimentoMigrationDestination,
} from '../server/atendimento/migrationDestination.js'
import {
    applyIdentityClusterWorkspaceMigration,
    rollbackIdentityClusterWorkspaceMigration,
    identityClusterWorkspaceMigrationPlan,
} from '../server/atendimento/identityClusterWorkspaceMigration.js'

const args = new Set(process.argv.slice(2))
if (args.has('--plan')) {
    console.log(JSON.stringify(identityClusterWorkspaceMigrationPlan(), null, 2))
    process.exit(0)
}
const targetValue = [...args].find((arg) => arg.startsWith('--target='))?.slice('--target='.length)
    || String(process.env.ATENDIMENTO_MIGRATION_TARGET || '').trim().toLowerCase()
const target = targetValue === ATENDIMENTO_MIGRATION_TARGETS.STAGING
    ? ATENDIMENTO_MIGRATION_TARGETS.STAGING
    : targetValue === '' || targetValue === ATENDIMENTO_MIGRATION_TARGETS.LOCAL
        ? ATENDIMENTO_MIGRATION_TARGETS.LOCAL
        : null
const databaseUrl = String(process.env.DATABASE_URL || '').trim()
const actions = ['--apply', '--rollback'].filter((action) => args.has(action))
if (actions.length !== 1) throw new Error('Use exatamente uma ação: --apply ou --rollback.')
const unsupported = [...args].filter((arg) => arg !== '--apply' && arg !== '--rollback' && !arg.startsWith('--target='))
if (unsupported.length) throw new Error(`Argumento não permitido: ${unsupported[0]}`)
if (!target || !databaseUrl || !isStrictAtendimentoMigrationDestination(databaseUrl, target)) {
    throw new Error(target === ATENDIMENTO_MIGRATION_TARGETS.STAGING
        ? 'DATABASE_URL deve apontar exclusivamente para skincos_staging via loopback TLS e o login migrator.'
        : 'DATABASE_URL deve apontar exclusivamente para o socket local admin de skincos_crm_local.')
}
const pool = createPgPool(databaseUrl)
try {
    const result = args.has('--rollback')
        ? await rollbackIdentityClusterWorkspaceMigration({ pool, databaseUrl, target })
        : await applyIdentityClusterWorkspaceMigration({ pool, databaseUrl, target })
    console.log(JSON.stringify(result, null, 2))
} finally {
    await pool.end()
}
