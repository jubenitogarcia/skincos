import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

import {
  ATENDIMENTO_PROJECTION_EXPORT_IDENTITY_SQL,
  ATENDIMENTO_PROJECTION_EXPORT_SNAPSHOT_SQL,
  preflightAtendimentoProjectionSource,
} from '../src/atendimentoProjectionExporter.mjs'
import {
  ATENDIMENTO_SYNTHETIC_STAGING_PREPARATION_INTENT,
  ATENDIMENTO_SYNTHETIC_UNIT_SCOPED_PROJECTION_SOURCE,
  createSyntheticAtendimentoProjectionFixturePool,
  createSyntheticAtendimentoProjectionReceiptReceiver,
  prepareSyntheticAtendimentoProjectionStaging,
  readSyntheticAtendimentoProjectionReceipts,
} from '../src/syntheticStagingPreparationRunner.mjs'

const HMAC_KEY = 'synthetic-atendimento-staging-preparation-key-at-least-32-bytes'
const TARGET = Object.freeze({
  environment: 'staging',
  release: 'a'.repeat(40),
  artifactDigest: `sha256:${'b'.repeat(64)}`,
})
const PRODUCTION_TARGET = Object.freeze({ ...TARGET, environment: 'production' })
const SOURCE_ID = '123e4567-e89b-42d3-a456-426614174000'
const CAPTURED_AT = '2026-09-07T00:00:00.000Z'

function sourceRow(index = 0, unit_slug = 'novo-hamburgo') {
  const suffix = index.toString(16).padStart(12, '0')
  return { id: `123e4567-e89b-42d3-a456-${suffix}`, updated_at: CAPTURED_AT, unit_slug }
}

function syntheticFixturePool(rows = [sourceRow()]) {
  return createSyntheticAtendimentoProjectionFixturePool({ capturedAt: CAPTURED_AT, rows })
}

function fakeClient({
  rows = [{ id: SOURCE_ID, updated_at: CAPTURED_AT, unit_slug: 'novo-hamburgo' }],
  rowCount = rows.length,
} = {}) {
  const calls = []
  return {
    calls,
    client: {
      async query(sql, params = []) {
        calls.push({ sql, params })
        if (sql === ATENDIMENTO_PROJECTION_EXPORT_IDENTITY_SQL) return { rows: [{
          database_name: 'skincos_clientes_production',
          current_user: 'crm_core_projection_exporter',
          session_user: 'crm_core_projection_exporter',
          transaction_read_only: 'on',
        }] }
        if (sql === ATENDIMENTO_PROJECTION_EXPORT_SNAPSHOT_SQL) return { rows: [{ captured_at: CAPTURED_AT }] }
        if (sql === ATENDIMENTO_SYNTHETIC_UNIT_SCOPED_PROJECTION_SOURCE.countSql) return { rows: [{ row_count: rowCount }] }
        if (sql === ATENDIMENTO_SYNTHETIC_UNIT_SCOPED_PROJECTION_SOURCE.rowsSql) return { rows }
        throw new Error('unexpected query')
      },
    },
  }
}

function input(overrides = {}) {
  return {
    syntheticIntent: ATENDIMENTO_SYNTHETIC_STAGING_PREPARATION_INTENT,
    target: TARGET,
    fixturePool: syntheticFixturePool(),
    hmacKey: HMAC_KEY,
    keyId: 'atendimento-projection-key-v2',
    receiver: createSyntheticAtendimentoProjectionReceiptReceiver(),
    ...overrides,
  }
}

test('exports a reusable preflight only for an explicit unit-scoped owner source', async () => {
  const fixture = fakeClient({ rowCount: 1 })
  const result = await preflightAtendimentoProjectionSource(fixture.client, {
    maxRows: 20,
    source: ATENDIMENTO_SYNTHETIC_UNIT_SCOPED_PROJECTION_SOURCE,
  })

  assert.deepEqual(result, {
    identity: {
      database: 'skincos_clientes_production',
      currentUser: 'crm_core_projection_exporter',
      sessionUser: 'crm_core_projection_exporter',
      readOnly: 'on',
    },
    capturedAt: CAPTURED_AT,
    rowCount: 1,
    source: ATENDIMENTO_SYNTHETIC_UNIT_SCOPED_PROJECTION_SOURCE,
  })
  assert.equal(fixture.calls.some((call) => call.sql === ATENDIMENTO_SYNTHETIC_UNIT_SCOPED_PROJECTION_SOURCE.rowsSql), false)
})

test('prepares only a synthetic unit-scoped staging batch and returns a receipt without events, HMAC material, or UUIDs', async () => {
  const receiver = createSyntheticAtendimentoProjectionReceiptReceiver()
  const receipt = await prepareSyntheticAtendimentoProjectionStaging(input({ receiver }))
  const serialized = JSON.stringify(receipt)

  assert.deepEqual(Object.keys(receipt).sort(), ['batchId', 'count', 'digest', 'release'])
  assert.match(receipt.batchId, /^backfill:atendimento:[A-Za-z0-9_-]+$/)
  assert.equal(receipt.count, 1)
  assert.equal(receipt.release, TARGET.release)
  assert.equal(receipt.digest, TARGET.artifactDigest)
  assert.deepEqual(readSyntheticAtendimentoProjectionReceipts(receiver), [receipt])
  assert.doesNotMatch(serialized, new RegExp(SOURCE_ID, 'i'))
  assert.doesNotMatch(serialized, /event|hmac|synthetic-atendimento/i)
})

test('permits a synthetic multi-unit identity while retaining separate opaque events', async () => {
  const receiver = createSyntheticAtendimentoProjectionReceiptReceiver()
  const rows = [
    sourceRow(0, 'barra-shopping-sul'),
    sourceRow(0, 'novo-hamburgo'),
  ]
  const receipt = await prepareSyntheticAtendimentoProjectionStaging(input({
    fixturePool: syntheticFixturePool(rows),
    receiver,
    maxRows: 2,
  }))

  assert.equal(receipt.count, 2)
  assert.deepEqual(readSyntheticAtendimentoProjectionReceipts(receiver), [receipt])
})

test('is disabled by default and does not request the fixture pool without explicit synthetic intent', async () => {
  let providerRead = false
  const disabledInput = {
    target: TARGET,
    get fixturePool() { providerRead = true; throw new Error('fixture pool must not be read') },
  }

  await assert.rejects(() => prepareSyntheticAtendimentoProjectionStaging(disabledInput), {
    message: 'ATENDIMENTO_CRM_SYNTHETIC_PREPARATION_INTENT_REQUIRED',
  })
  assert.equal(providerRead, false)
})

test('refuses a production target before reading any injected provider', async () => {
  let providerRead = false
  const productionInput = {
    get target() { return PRODUCTION_TARGET },
    get fixturePool() { providerRead = true; throw new Error('fixture pool must not be read') },
    get hmacKey() { providerRead = true; throw new Error('HMAC must not be read') },
    get receiver() { providerRead = true; throw new Error('receiver must not be read') },
  }

  await assert.rejects(() => prepareSyntheticAtendimentoProjectionStaging(productionInput), {
    message: 'ATENDIMENTO_CRM_SYNTHETIC_PREPARATION_PRODUCTION_FORBIDDEN',
  })
  assert.equal(providerRead, false)
})

test('enforces the 20-event batch ceiling before requesting the fixture pool', async () => {
  let providerRead = false
  const excessiveInput = {
    syntheticIntent: ATENDIMENTO_SYNTHETIC_STAGING_PREPARATION_INTENT,
    target: TARGET,
    maxRows: 21,
    get fixturePool() { providerRead = true; throw new Error('fixture pool must not be read') },
  }

  await assert.rejects(() => prepareSyntheticAtendimentoProjectionStaging(excessiveInput), {
    message: 'ATENDIMENTO_CRM_SYNTHETIC_PREPARATION_COUNT_INVALID',
  })
  assert.equal(providerRead, false)
})

test('does not create a receipt when the in-memory source preflight reports more than 20 rows', async () => {
  const rows = Array.from({ length: 21 }, (_, index) => sourceRow(index))
  const receiver = createSyntheticAtendimentoProjectionReceiptReceiver()

  await assert.rejects(() => prepareSyntheticAtendimentoProjectionStaging(input({
    fixturePool: syntheticFixturePool(rows),
    receiver,
  })), { message: 'ATENDIMENTO_CRM_PROJECTION_EXPORT_LIMIT_EXCEEDED' })
  assert.deepEqual(readSyntheticAtendimentoProjectionReceipts(receiver), [])
})

test('rejects a synthetic fixture row with no canonical unit slug', () => {
  assert.throws(() => createSyntheticAtendimentoProjectionFixturePool({
    capturedAt: CAPTURED_AT,
    rows: [{ id: SOURCE_ID, updated_at: CAPTURED_AT }],
  }), /ATENDIMENTO_CRM_SYNTHETIC_PREPARATION_FIXTURE_INVALID/)
})

test('rejects an arbitrary pool before it can connect, including one shaped like a database client', async () => {
  let connectRequested = false
  const forgedPool = {
    async connect() {
      connectRequested = true
      throw new Error('must never connect')
    },
  }

  await assert.rejects(() => prepareSyntheticAtendimentoProjectionStaging(input({ fixturePool: forgedPool })), {
    message: 'ATENDIMENTO_CRM_SYNTHETIC_PREPARATION_FIXTURE_POOL_REQUIRED',
  })
  assert.equal(connectRequested, false)
})

test('accepts no endpoint-shaped configuration or forged receiver and the runner source has no environment, network, disk, or database-client import', async () => {
  await assert.rejects(() => prepareSyntheticAtendimentoProjectionStaging(input({
    endpoint: 'https://example.test/receiver',
  })), { message: 'ATENDIMENTO_CRM_SYNTHETIC_PREPARATION_OPTIONS_INVALID' })

  await assert.rejects(() => prepareSyntheticAtendimentoProjectionStaging(input({
    receiver: { endpoint: 'https://example.test/receiver' },
  })), { message: 'ATENDIMENTO_CRM_SYNTHETIC_PREPARATION_RECEIVER_INVALID' })

  let pushRequested = false
  const forgedReceiver = []
  Object.defineProperty(forgedReceiver, 'push', {
    value() { pushRequested = true; throw new Error('must never run') },
  })
  await assert.rejects(() => prepareSyntheticAtendimentoProjectionStaging(input({ receiver: forgedReceiver })), {
    message: 'ATENDIMENTO_CRM_SYNTHETIC_PREPARATION_RECEIVER_INVALID',
  })
  assert.equal(pushRequested, false)

  const source = await readFile(new URL('../src/syntheticStagingPreparationRunner.mjs', import.meta.url), 'utf8')
  assert.doesNotMatch(source, /node:(?:fs|http|https|net|tls|child_process)/)
  assert.doesNotMatch(source, /\bfrom ['"]pg['"]|\brequire\(['"]pg['"]\)/)
  assert.doesNotMatch(source, /process\.env|\bfetch\s*\(/)
})
