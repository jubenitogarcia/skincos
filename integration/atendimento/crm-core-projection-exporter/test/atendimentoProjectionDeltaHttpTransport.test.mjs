import test from 'node:test'
import assert from 'node:assert/strict'

import {
  createAtendimentoProjectionDeltaBatch,
  digestAtendimentoProjectionDeltaBatch,
} from '../src/atendimentoProjectionDeltaExporter.mjs'
import {
  createAtendimentoProjectionDeltaDeliverySigner,
} from '../src/atendimentoProjectionDeltaDelivery.mjs'
import {
  createAtendimentoProjectionDeltaHttpTransport,
} from '../src/atendimentoProjectionDeltaHttpTransport.mjs'

const TARGET = { environment: 'staging', release: 'a'.repeat(40), artifactDigest: `sha256:${'b'.repeat(64)}` }
const KEY = `delta-http-test-${'x'.repeat(40)}`
const ROW = {
  event_order: 1,
  event_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  identity_id: '11111111-1111-4111-8111-111111111111',
  unit_slug: 'jardins',
  revision: 1,
  operation: 'upsert',
  occurred_at: '2026-09-08T12:00:00.000000Z',
}

async function signedInput() {
  const batch = createAtendimentoProjectionDeltaBatch({
    rows: [ROW],
    fromExclusive: 0,
    toInclusive: 1,
    hmacKey: KEY,
    keyId: 'crm-staging-atendimento-delta-v1',
    target: TARGET,
  })
  const signer = createAtendimentoProjectionDeltaDeliverySigner({
    target: TARGET,
    keyId: 'crm-staging-atendimento-delta-v1',
    sign: async () => Buffer.alloc(64, 9),
  })
  return { batch, delivery: await signer.signBatch(batch) }
}

test('posts only the signed opaque batch and validates the receipt binding', async () => {
  const { batch, delivery } = await signedInput()
  const requestId = 'crm-atendimento-delta-1000000'
  let request
  const transport = createAtendimentoProjectionDeltaHttpTransport({
    endpoint: 'https://crm-core-staging.skincos.com.br/crm/_internal/delta/atendimento',
    fetch: async (url, options) => {
      request = { url, options }
      return {
        status: 200,
        async json() {
          return {
            ok: true,
            contractVersion: 'crm-core/projection-delta-receipt/v1',
            status: 'accepted',
            batchId: batch.batchId,
            eventCount: batch.events.length,
            target: TARGET,
            requestId,
            fromExclusive: 0,
            toInclusive: 1,
          }
        },
      }
    },
  })
  const receipt = await transport.deliver({ batch, delivery, requestId })
  assert.equal(receipt.status, 'accepted')
  assert.equal(request.url, 'https://crm-core-staging.skincos.com.br/crm/_internal/delta/atendimento')
  assert.equal(request.options.method, 'POST')
  assert.equal(request.options.credentials, 'omit')
  assert.equal(request.options.redirect, 'error')
  assert.equal(request.options.headers.authorization, undefined)
  assert.equal(request.options.headers.origin, undefined)
  const body = JSON.parse(request.options.body)
  assert.equal(body.batch.batchId, batch.batchId)
  assert.equal(body.delivery.batchDigest, digestAtendimentoProjectionDeltaBatch(batch))
})

test('enforces an actual deadline even if an injected fetch ignores AbortSignal', async () => {
  const { batch, delivery } = await signedInput()
  const transport = createAtendimentoProjectionDeltaHttpTransport({
    endpoint: 'https://crm-core-staging.skincos.com.br/crm/_internal/delta/atendimento',
    timeoutMs: 10,
    fetch: async () => new Promise(() => {}),
  })
  await assert.rejects(
    () => transport.deliver({ batch, delivery, requestId: 'crm-atendimento-delta-000001' }),
    /ATENDIMENTO_CRM_PROJECTION_DELTA_TIMEOUT/,
  )
})

test('enforces the same deadline while the response body is stalled', async () => {
  const { batch, delivery } = await signedInput()
  let aborted = false
  const transport = createAtendimentoProjectionDeltaHttpTransport({
    endpoint: 'https://crm-core-staging.skincos.com.br/crm/_internal/delta/atendimento',
    timeoutMs: 10,
    fetch: async (_url, options) => {
      options.signal.addEventListener('abort', () => { aborted = true }, { once: true })
      return { status: 200, json: async () => new Promise(() => {}) }
    },
  })
  await assert.rejects(
    () => transport.deliver({ batch, delivery, requestId: 'crm-atendimento-delta-000001' }),
    /ATENDIMENTO_CRM_PROJECTION_DELTA_TIMEOUT/,
  )
  assert.equal(aborted, true)
})

test('rejects non-HTTPS or non-private route endpoints before fetch', () => {
  assert.throws(() => createAtendimentoProjectionDeltaHttpTransport({ endpoint: 'http://crm-core.example/crm/_internal/delta/atendimento', fetch() {} }), /ENDPOINT_INVALID/)
  assert.throws(() => createAtendimentoProjectionDeltaHttpTransport({ endpoint: 'https://crm-core.example/crm/delta/atendimento', fetch() {} }), /ENDPOINT_INVALID/)
  assert.throws(() => createAtendimentoProjectionDeltaHttpTransport({ endpoint: 'https://user:password@crm-core.example/crm/_internal/delta/atendimento', fetch() {} }), /ENDPOINT_INVALID/)
})
