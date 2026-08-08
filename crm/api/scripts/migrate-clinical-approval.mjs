#!/usr/bin/env node
import { createPgPool } from '../server/harmonia/store/pg.js'
import {
    applyClinicalApprovalMigration,
    rollbackClinicalApprovalMigration,
    parseClinicalApprovalMigrationAction,
} from '../server/clinical/clinicalApprovalMigration.js'
import {
    ATENDIMENTO_MIGRATION_TARGETS,
    isStrictAtendimentoMigrationDestination,
} from '../server/atendimento/migrationDestination.js'

const args = process.argv.slice(2)
const targetArg = args.find((arg) => arg.startsWith('--target='))
const targetValue = targetArg ? targetArg.slice('--target='.length) : 'local'
if (targetValue === ATENDIMENTO_MIGRATION_TARGETS.STAGING) {
    const error = new Error('CLINICAL_APPROVAL_STAGING_REQUIRES_CONTROLLED_RUNNER')
    error.code = 'CLINICAL_APPROVAL_STAGING_REQUIRES_CONTROLLED_RUNNER'
    throw error
}
const target = targetValue === 'local' ? ATENDIMENTO_MIGRATION_TARGETS.LOCAL : null
const databaseUrl = String(process.env.DATABASE_URL || '').trim()
const dryRun = args.includes('--dry-run')
if (dryRun && args.some((arg) => arg !== '--dry-run' && !arg.startsWith('--target='))) throw new Error('Argumentos incompatíveis.')
if (!dryRun && args.some((arg) => arg !== '--apply' && arg !== '--rollback' && !arg.startsWith('--target='))) throw new Error('Argumentos incompatíveis.')
const action = dryRun ? 'dry-run' : parseClinicalApprovalMigrationAction(args.filter((arg) => arg === '--apply' || arg === '--rollback'))
if (!target || !databaseUrl || !isStrictAtendimentoMigrationDestination(databaseUrl, target)) {
    throw new Error('DATABASE_URL deve apontar exclusivamente para o espelho local autorizado.')
}
if (target !== ATENDIMENTO_MIGRATION_TARGETS.LOCAL) throw new Error('Destino inválido.')

if (action === 'dry-run') {
    console.log(JSON.stringify({ action, target, migration: '20260806_clinical_cadence_approval_v1', destinationGuard: 'passed', writes: false }, null, 2))
    process.exit(0)
}

const pool = createPgPool(databaseUrl)
if (!pool) throw new Error('Pool PostgreSQL indisponível.')
try {
    const report = action === 'apply'
        ? await applyClinicalApprovalMigration({ pool, databaseUrl, target })
        : await rollbackClinicalApprovalMigration({ pool, databaseUrl, target })
    console.log(JSON.stringify({ action, target, ...report, commercialContactWritesEnabled: false, messagingEnabled: false }, null, 2))
} finally {
    await pool.end()
}
