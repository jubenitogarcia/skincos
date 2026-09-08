import test from 'node:test'
import assert from 'node:assert/strict'

import {
  ATENDIMENTO_CRM_PROJECTION_DELTA_SOURCE,
  ATENDIMENTO_CRM_PROJECTION_DELTA_BATCH_VERSION,
  assertAtendimentoProjectionDeltaBatch,
  assertAtendimentoProjectionDeltaSource,
  createAtendimentoProjectionDeltaBatch,
  digestAtendimentoProjectionDeltaBatch,
  readAtendimentoProjectionDeltaPage,
} from '../src/atendimentoProjectionDeltaExporter.mjs'

const HMAC_KEY = `delta-test-${'x'.repeat(40)}`
const TARGET = { environment: 'staging', release: 'a'.repeat(40), artifactDigest: `sha256:${'b'.repeat(64)}` }
const IDENTITY_A = '11111111-1111-4111-8111-111111111111'
const IDENTITY_B = '22222222-2222-4222-8222-222222222222'
const EVENT_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const EVENT_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'

function row(eventOrder, eventId, identityId, revision, operation, occurredAt = '2026-09-08T12:00:00.000000Z') {
  return { event_order: eventOrder, event_id: eventId, identity_id: identityId, unit_slug: 'jardins', revision, operation, occurred_at: occurredAt }
}

test('attests an outbox-only source descriptor and rejects writes or OFFSET', () => {
  const source = assertAtendimentoProjectionDeltaSource(ATENDIMENTO_CRM_PROJECTION_DELTA_SOURCE)
  assert.equal(source.contract, 'atendimento/crm-core/projection-delta-source/v1')
  assert.match(source.firstPageSql, /crm_atendimento\.crm_core_projection_outbox/i)
  assert.throws(() => assertAtendimentoProjectionDeltaSource({ ...ATENDIMENTO_CRM_PROJECTION_DELTA_SOURCE, firstPageSql: 'select * from x offset 1' }), /SOURCE_INVALID/)
  assert.throws(() => assertAtendimentoProjectionDeltaSource({ ...ATENDIMENTO_CRM_PROJECTION_DELTA_SOURCE, nextPageSql: 'delete from crm_atendimento.crm_core_projection_outbox' }), /SOURCE_INVALID/)
})

test('creates deterministic opaque upsert and revoke events with exact Core v2 operations', () => {
  const first = createAtendimentoProjectionDeltaBatch({
    rows: [row(1, EVENT_A, IDENTITY_A, 1, 'upsert'), row(2, EVENT_B, IDENTITY_A, 2, 'revoke', '2026-09-08T12:01:00.000000Z')],
    fromExclusive: 0,
    toInclusive: 2,
    hmacKey: HMAC_KEY,
    keyId: 'crm-staging-atendimento-delta-v1',
    target: TARGET,
  })
  const second = createAtendimentoProjectionDeltaBatch({
    rows: [row(1, EVENT_A, IDENTITY_A, 1, 'upsert'), row(2, EVENT_B, IDENTITY_A, 2, 'revoke', '2026-09-08T12:01:00.000000Z')],
    fromExclusive: 0,
    toInclusive: 2,
    hmacKey: HMAC_KEY,
    keyId: 'crm-staging-atendimento-delta-v1',
    target: TARGET,
  })
  assert.equal(first.contract, ATENDIMENTO_CRM_PROJECTION_DELTA_BATCH_VERSION)
  assert.equal(first.events[0].operation, 'upsert')
  assert.equal(first.events[1].operation, 'revoke')
  assert.deepEqual(first, second)
  assert.equal(digestAtendimentoProjectionDeltaBatch(first), digestAtendimentoProjectionDeltaBatch(second))
  const serialized = JSON.stringify(first)
  assert.doesNotMatch(serialized, /11111111|22222222|aaaaaaaa-aaaa|email|phone|name|payload/i)
})

test('accepts sparse outbox order caused by a rolled-back writer transaction', () => {
  const batch = createAtendimentoProjectionDeltaBatch({ rows: [row(1, EVENT_A, IDENTITY_A, 1, 'upsert'), row(3, EVENT_B, IDENTITY_A, 2, 'revoke')], fromExclusive: 0, toInclusive: 3, hmacKey: HMAC_KEY, keyId: 'crm-staging-atendimento-delta-v1', target: TARGET })
  assert.equal(batch.sourceDelta.rowCount, 2)
  assert.equal(batch.sourceDelta.toInclusive - batch.sourceDelta.fromExclusive, 3)
})

test('rejects a forged batch whose declared row count does not match its events', () => {
  const batch = createAtendimentoProjectionDeltaBatch({
    rows: [row(1, EVENT_A, IDENTITY_A, 1, 'upsert')],
    fromExclusive: 0,
    toInclusive: 1,
    hmacKey: HMAC_KEY,
    keyId: 'crm-staging-atendimento-delta-v1',
    target: TARGET,
  })
  const forged = {
    ...batch,
    sourceDelta: { ...batch.sourceDelta, rowCount: 2 },
  }
  assert.throws(() => assertAtendimentoProjectionDeltaBatch(forged), /BATCH_INVALID/)
})

test('preserves sparse source ordering while reading a page', async () => {
  const client = { async query(sql) {
    if (/event_order <= \$1/i.test(sql)) return { rows: [row(1, EVENT_A, IDENTITY_A, 1, 'upsert'), row(3, EVENT_B, IDENTITY_A, 2, 'revoke')] }
    return { rows: [] }
  } }
  const rows = await readAtendimentoProjectionDeltaPage(client, { source: ATENDIMENTO_CRM_PROJECTION_DELTA_SOURCE, fromExclusive: 0, toInclusive: 3, limit: 2 })
  assert.deepEqual(rows.map((entry) => entry.eventOrder), [1, 3])
})

test('rejects a source page that regresses event order', async () => {
  const client = { async query() {
    return { rows: [row(3, EVENT_B, IDENTITY_A, 2, 'revoke'), row(1, EVENT_A, IDENTITY_A, 1, 'upsert')] }
  } }
  await assert.rejects(() => readAtendimentoProjectionDeltaPage(client, { source: ATENDIMENTO_CRM_PROJECTION_DELTA_SOURCE, fromExclusive: 0, toInclusive: 3, limit: 2 }), /SOURCE_GAP/)
})

test('allows explicit multi-unit rows while retaining one projection reference per unit', () => {
  const batch = createAtendimentoProjectionDeltaBatch({
    rows: [
      { ...row(1, EVENT_A, IDENTITY_A, 1, 'upsert'), unit_slug: 'jardins' },
      { ...row(2, EVENT_B, IDENTITY_A, 1, 'upsert'), unit_slug: 'pinheiros' },
      { ...row(3, 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', IDENTITY_B, 1, 'upsert'), unit_slug: 'jardins' },
    ],
    fromExclusive: 0,
    toInclusive: 3,
    hmacKey: HMAC_KEY,
    keyId: 'crm-staging-atendimento-delta-v1',
    target: TARGET,
  })
  assert.equal(new Set(batch.events.map((event) => event.unitScope.unitSlug)).size, 2)
})
