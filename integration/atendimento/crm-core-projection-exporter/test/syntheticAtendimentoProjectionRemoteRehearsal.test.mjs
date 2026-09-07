import assert from 'node:assert/strict'
import test from 'node:test'

import {
  ATENDIMENTO_CRM_BACKFILL_HTTP_PATH,
} from '../src/atendimentoProjectionBackfillHttpTransport.mjs'
import {
  ATENDIMENTO_SYNTHETIC_REMOTE_REHEARSAL_INTENT,
  createSyntheticAtendimentoProjectionRemoteRehearsal,
} from '../src/syntheticAtendimentoProjectionRemoteRehearsal.mjs'

const TARGET = Object.freeze({
  environment: 'staging',
  release: 'a'.repeat(40),
  artifactDigest: `sha256:${'b'.repeat(64)}`,
})
const SOURCE_UUID = '123e4567-e89b-42d3-a456-426614174001'
const ENDPOINT = `https://crm-core-staging.example.test${ATENDIMENTO_CRM_BACKFILL_HTTP_PATH}`

function remoteRehearsal() {
  return createSyntheticAtendimentoProjectionRemoteRehearsal({ target: TARGET, endpoint: ENDPOINT })
}

function acceptedThenIdempotentFetch(calls) {
  return async (url, init) => {
    calls.push({ url, init, body: JSON.parse(init.body) })
    const input = calls.at(-1).body
    return {
      status: 200,
      async json() {
        return {
          ok: true,
          contractVersion: 'crm-core/projection-backfill-receipt/v1',
          status: calls.length === 1 ? 'accepted' : 'idempotent',
          batchId: input.batch.batchId,
          eventCount: input.batch.events.length,
          target: input.batch.target,
          requestId: init.headers['x-request-id'],
        }
      },
    }
  }
}

test('prepares one public finite allowlist without a source UUID, HMAC, or private Ed25519 material', () => {
  const rehearsal = remoteRehearsal()
  const { activation } = rehearsal
  const publicKeys = JSON.parse(activation.publicKeysJson)
  const allowedDigests = JSON.parse(activation.batchDigestsJson)
  const serialized = JSON.stringify(activation)

  assert.equal(activation.environment, 'staging')
  assert.match(activation.keyId, /^crm-staging-atendimento-backfill-/)
  assert.equal(allowedDigests.length, 1)
  assert.equal(allowedDigests[0], activation.batch.batchDigest)
  assert.notEqual(activation.batch.batchId, 'backfill:atendimento:fixture-batch-0001')
  assert.deepEqual(Object.keys(publicKeys), [activation.keyId])
  assert.deepEqual(Object.keys(publicKeys[activation.keyId]).sort(), ['crv', 'kty', 'x'])
  assert.equal(publicKeys[activation.keyId].d, undefined)
  assert.doesNotMatch(serialized, new RegExp(SOURCE_UUID, 'i'))
  assert.doesNotMatch(serialized, /hmac|privateKey|"d"\s*:/i)
})

test('delivers the real paginated producer packet twice and requires a D1-style digest reconciliation', async () => {
  const rehearsal = remoteRehearsal()
  const calls = []
  const reconcileCalls = []
  const receipt = await rehearsal.rehearse({
    intent: ATENDIMENTO_SYNTHETIC_REMOTE_REHEARSAL_INTENT,
    fetch: acceptedThenIdempotentFetch(calls),
    async reconcile(expected) {
      reconcileCalls.push(expected)
      return {
        batchId: expected.batchId,
        target: expected.target,
        eventCount: expected.eventCount,
        eventsDigest: expected.eventsDigest,
        cursorDigest: expected.cursorDigest,
        eventIds: expected.eventIds,
      }
    },
  })

  assert.equal(calls.length, 2)
  assert.equal(calls.every((call) => call.url === ENDPOINT), true)
  assert.equal(calls.every((call) => call.init.method === 'POST'), true)
  assert.equal(calls.every((call) => call.init.credentials === 'omit'), true)
  assert.equal(calls.every((call) => call.init.redirect === 'error'), true)
  assert.equal(calls.every((call) => Object.keys(call.init.headers).sort().join(',') === 'content-type,x-request-id'), true)
  assert.equal(calls.every((call) => call.body.batch.batchId === receipt.batchId), true)
  assert.equal(calls.every((call) => call.body.delivery.batchDigest === receipt.batchDigest), true)
  assert.equal(calls.every((call) => !JSON.stringify(call.body).includes(SOURCE_UUID)), true)
  assert.equal(calls[0].body.batch.events.length, 1)
  assert.equal(reconcileCalls.length, 1)
  assert.equal(reconcileCalls[0].batchId, receipt.batchId)
  assert.equal(reconcileCalls[0].batchDigest, receipt.batchDigest)
  assert.deepEqual(receipt, {
    contractVersion: 'atendimento/crm-core/synthetic-remote-backfill-rehearsal-receipt/v1',
    status: 'reconciled',
    target: TARGET,
    batchId: receipt.batchId,
    batchDigest: receipt.batchDigest,
    accepted: 'accepted',
    retry: 'idempotent',
    reconciliation: {
      batchId: receipt.batchId,
      target: TARGET,
      eventCount: 1,
      eventsDigest: reconcileCalls[0].eventsDigest,
      cursorDigest: reconcileCalls[0].cursorDigest,
    },
  })
  assert.doesNotMatch(JSON.stringify(receipt), new RegExp(SOURCE_UUID, 'i'))
})

test('refuses a mismatched D1 reconciliation after delivery', async () => {
  const rehearsal = remoteRehearsal()
  const calls = []
  await assert.rejects(() => rehearsal.rehearse({
    intent: ATENDIMENTO_SYNTHETIC_REMOTE_REHEARSAL_INTENT,
    fetch: acceptedThenIdempotentFetch(calls),
    async reconcile(expected) {
      return {
        batchId: expected.batchId,
        target: expected.target,
        eventCount: expected.eventCount,
        eventsDigest: expected.eventsDigest,
        cursorDigest: `sha256:${'f'.repeat(64)}`,
        eventIds: expected.eventIds,
      }
    },
  }), /ATENDIMENTO_CRM_SYNTHETIC_REMOTE_REHEARSAL_RECONCILIATION_INVALID/)
  assert.equal(calls.length, 2)
})

test('is inert without explicit delivery intent and refuses production before reading the endpoint', async () => {
  const rehearsal = remoteRehearsal()
  let fetchRead = false
  await assert.rejects(() => rehearsal.rehearse({
    intent: 'not-authorized',
    get fetch() { fetchRead = true; throw new Error('must not read fetch') },
    get reconcile() { fetchRead = true; throw new Error('must not read reconciler') },
  }), /ATENDIMENTO_CRM_SYNTHETIC_REMOTE_REHEARSAL_INTENT_REQUIRED/)
  assert.equal(fetchRead, false)

  let endpointRead = false
  assert.throws(() => createSyntheticAtendimentoProjectionRemoteRehearsal({
    get target() { return { ...TARGET, environment: 'production' } },
    get endpoint() { endpointRead = true; throw new Error('must not read endpoint') },
  }), /ATENDIMENTO_CRM_SYNTHETIC_REMOTE_REHEARSAL_STAGING_ONLY/)
  assert.equal(endpointRead, false)
})
