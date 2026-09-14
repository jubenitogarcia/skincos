#!/usr/bin/env node
/**
 * Controlled source-side lifecycle for the v5 confirmed-membership stream.
 * This is deliberately production-source-only and refuses to deliver packets:
 * the independent CRM Core receiver owns delivery verification and receipts.
 * Nothing here configures a route, deploys a Worker, or reads customer data.
 */
import { readFile } from 'node:fs/promises'

import { createPgPool } from '../server/harmonia/store/pg.js'
import {
  ATENDIMENTO_MIGRATION_TARGETS,
  isStrictAtendimentoMigrationDestination,
} from '../server/atendimento/migrationDestination.js'
import {
  acceptConfirmedProjectionDeltaV2Baseline,
  loadConfirmedProjectionDeltaV2BaselineCustody,
  markConfirmedProjectionDeltaV2Ready,
  prepareConfirmedProjectionDeltaV2Baseline,
  reconcileConfirmedProjectionDeltaV2,
} from '../server/atendimento/confirmedProjectionDeltaV2Migration.js'

const actions = ['--prepare', '--load', '--accept', '--ready', '--reconcile']
const supplied = process.argv.slice(2)
const selected = actions.filter((entry) => supplied.includes(entry))
const databaseUrl = String(process.env.DATABASE_URL || '').trim()

function usage() {
  throw new Error('Use exatamente uma ação: --prepare, --load, --accept, --ready ou --reconcile; inclua --controlled-production-source e --target=production.')
}

function inputPath(required) {
  const index = supplied.indexOf('--input')
  if (index < 0) {
    if (required) usage()
    return null
  }
  const value = supplied[index + 1]
  if (!value || value.startsWith('-')) usage()
  return value
}

async function input(required) {
  const path = inputPath(required)
  if (!path) return null
  try { return JSON.parse(await readFile(path, 'utf8')) }
  catch { throw new Error('ATENDIMENTO_CONFIRMED_PROJECTION_DELTA_V2_INPUT_INVALID') }
}

if (selected.length !== 1
  || !supplied.includes('--controlled-production-source')
  || !supplied.includes('--target=production')
  || supplied.some((entry, index) => !actions.includes(entry)
    && entry !== '--controlled-production-source'
    && entry !== '--target=production'
    && entry !== '--input'
    && supplied[index - 1] !== '--input')) usage()
if (!databaseUrl || !isStrictAtendimentoMigrationDestination(databaseUrl, ATENDIMENTO_MIGRATION_TARGETS.PRODUCTION)) {
  throw new Error('DATABASE_URL deve apontar exclusivamente para skincos_clientes_production via loopback TLS e login migrator.')
}

const action = selected[0]
const envelope = await input(action !== '--load' && action !== '--reconcile')
const pool = createPgPool(databaseUrl)
try {
  let result
  if (action === '--prepare') {
    const hmacKey = String(process.env.ATENDIMENTO_CONFIRMED_PROJECTION_BASELINE_HMAC_KEY || '').trim()
    if (!hmacKey) throw new Error('ATENDIMENTO_CONFIRMED_PROJECTION_DELTA_V2_HMAC_KEY_REQUIRED')
    result = await prepareConfirmedProjectionDeltaV2Baseline({
      pool,
      databaseUrl,
      target: ATENDIMENTO_MIGRATION_TARGETS.PRODUCTION,
      targetDescriptor: envelope?.targetDescriptor,
      source: envelope?.source,
      backfillHmacKey: hmacKey,
    })
  } else if (action === '--load') {
    result = await loadConfirmedProjectionDeltaV2BaselineCustody({ pool, databaseUrl, target: ATENDIMENTO_MIGRATION_TARGETS.PRODUCTION })
  } else if (action === '--accept') {
    result = await acceptConfirmedProjectionDeltaV2Baseline({
      pool,
      databaseUrl,
      target: ATENDIMENTO_MIGRATION_TARGETS.PRODUCTION,
      baseline: envelope?.baseline,
      receipt: envelope?.receipts,
    })
  } else if (action === '--ready') {
    result = await markConfirmedProjectionDeltaV2Ready({
      pool,
      databaseUrl,
      target: ATENDIMENTO_MIGRATION_TARGETS.PRODUCTION,
      baseline: envelope?.baseline,
      readback: envelope?.readback,
    })
  } else {
    result = await reconcileConfirmedProjectionDeltaV2({ pool, databaseUrl, target: ATENDIMENTO_MIGRATION_TARGETS.PRODUCTION })
  }
  process.stdout.write(`${JSON.stringify(result)}\n`)
} finally {
  await pool.end()
}
