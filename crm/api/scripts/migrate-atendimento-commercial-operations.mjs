#!/usr/bin/env node
import { createPgPool } from '../server/harmonia/store/pg.js'
import { ATENDIMENTO_MIGRATION_TARGETS, isStrictAtendimentoMigrationDestination } from '../server/atendimento/migrationDestination.js'
import {
    applyCommercialOperationsMigration,
    commercialOperationsMigrationPlan,
    rollbackCommercialOperationsMigration,
} from '../server/atendimento/commercialOperationsMigration.js'

const args = new Set(process.argv.slice(2))
const target = String(process.env.ATENDIMENTO_MIGRATION_TARGET || 'local').trim().toLowerCase()
const databaseUrl = String(process.env.DATABASE_URL || '').trim()

if (args.has('--plan')) {
    if (args.size !== 1) throw new Error('Use --plan isoladamente.')
    console.log(JSON.stringify(commercialOperationsMigrationPlan(), null, 2))
    process.exit(0)
}
const apply = args.has('--apply')
const rollback = args.has('--rollback')
if (apply === rollback || args.size !== 1) throw new Error('Use exatamente --apply ou --rollback.')
if (![ATENDIMENTO_MIGRATION_TARGETS.LOCAL, ATENDIMENTO_MIGRATION_TARGETS.STAGING].includes(target)) throw new Error('ATENDIMENTO_MIGRATION_TARGET deve ser local ou staging.')
if (!databaseUrl || !isStrictAtendimentoMigrationDestination(databaseUrl, target)) throw new Error(`DATABASE_URL não corresponde ao destino ${target} estritamente permitido.`)

const pool = createPgPool(databaseUrl)
try {
    const result = apply
        ? await applyCommercialOperationsMigration({ pool, databaseUrl, target })
        : await rollbackCommercialOperationsMigration({ pool, databaseUrl, target })
    console.log(JSON.stringify(result, null, 2))
} finally { await pool.end() }
