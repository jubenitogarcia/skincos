#!/usr/bin/env node
/**
 * Controlled schema-only entrypoint for the v5 confirmed-membership source.
 * It never prepares, exports, delivers or reconciles a baseline. Production
 * execution requires an explicit source flag and the strict loopback TLS
 * migrator URL. Staging is allowed only through its separate strict staging
 * destination; this entrypoint never prepares, exports, delivers or cuts over
 * a baseline.
 */
import { createPgPool } from '../server/harmonia/store/pg.js'
import {
  ATENDIMENTO_MIGRATION_TARGETS,
  isStrictAtendimentoMigrationDestination,
} from '../server/atendimento/migrationDestination.js'
import {
  applyConfirmedProjectionDeltaV2Migration,
  rollbackConfirmedProjectionDeltaV2Migration,
} from '../server/atendimento/confirmedProjectionDeltaV2Migration.js'

const args = new Set(process.argv.slice(2))
const databaseUrl = String(process.env.DATABASE_URL || '').trim()
const targetArgument = [...args].find((entry) => entry.startsWith('--target='))
const target = targetArgument ? targetArgument.slice('--target='.length) : ATENDIMENTO_MIGRATION_TARGETS.LOCAL
const actionCount = Number(args.has('--apply')) + Number(args.has('--rollback'))

if (actionCount !== 1 || [...args].some((entry) => !['--apply', '--rollback', '--controlled-production-source'].includes(entry) && !entry.startsWith('--target='))) {
  throw new Error('Use exatamente --apply ou --rollback, com --target=local, --target=staging ou --target=production.')
}
if (![ATENDIMENTO_MIGRATION_TARGETS.LOCAL, ATENDIMENTO_MIGRATION_TARGETS.STAGING, ATENDIMENTO_MIGRATION_TARGETS.PRODUCTION].includes(target)) {
  throw new Error('Use --target=local, --target=staging ou --target=production.')
}
if (target === ATENDIMENTO_MIGRATION_TARGETS.PRODUCTION && !args.has('--controlled-production-source')) {
  throw new Error('Production requer --controlled-production-source; este comando não executa backfill, entrega ou cutover.')
}
if (!databaseUrl || !isStrictAtendimentoMigrationDestination(databaseUrl, target)) {
  throw new Error(target === ATENDIMENTO_MIGRATION_TARGETS.PRODUCTION
    ? 'DATABASE_URL deve apontar exclusivamente para skincos_clientes_production via loopback TLS e login migrator.'
    : target === ATENDIMENTO_MIGRATION_TARGETS.STAGING
      ? 'DATABASE_URL deve apontar exclusivamente para skincos_staging via loopback TLS e login migrator.'
    : 'DATABASE_URL deve apontar exclusivamente para o socket local admin de skincos_crm_local.')
}

const pool = createPgPool(databaseUrl)
try {
  const result = args.has('--apply')
    ? await applyConfirmedProjectionDeltaV2Migration({ pool, databaseUrl, target })
    : await rollbackConfirmedProjectionDeltaV2Migration({ pool, databaseUrl, target })
  process.stdout.write(`${JSON.stringify(result)}\n`)
} finally {
  await pool.end()
}
