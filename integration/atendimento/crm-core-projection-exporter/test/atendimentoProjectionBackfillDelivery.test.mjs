import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import test from 'node:test'

import {
  createAtendimentoProjectionBackfillBatch,
} from '../src/atendimentoProjectionExporter.mjs'
import {
  createAtendimentoProjectionBackfillDeliverySigner,
  createAtendimentoProjectionBackfillDeliverySigningInput,
} from '../src/atendimentoProjectionBackfillDelivery.mjs'
import {
  ATENDIMENTO_CRM_BACKFILL_HTTP_PATH,
  createAtendimentoProjectionBackfillHttpTransport,
} from '../src/atendimentoProjectionBackfillHttpTransport.mjs'

const HMAC_KEY = 'synthetic-atendimento-projection-export-key-at-least-32-bytes'
const TARGET = Object.freeze({
  environment: 'staging',
  release: 'a'.repeat(40),
  artifactDigest: `sha256:${'b'.repeat(64)}`,
})
const SOURCE_ID = '123e4567-e89b-42d3-a456-426614174000'

function batch(rows = [{ id: SOURCE_ID, updated_at: '2026-09-07T00:00:00.000Z' }]) {
  return createAtendimentoProjectionBackfillBatch({
    rows,
    capturedAt: '2026-09-07T00:00:00.000Z',
    hmacKey: HMAC_KEY,
    keyId: 'atendimento-projection-key-v1',
    target: TARGET,
  })
}

function signerFor(target = TARGET) {
  const keys = crypto.generateKeyPairSync('ed25519')
  const signer = createAtendimentoProjectionBackfillDeliverySigner({
    target,
    keyId: `crm-${target.environment}-atendimento-backfill-v1`,
    sign: (input) => crypto.sign(null, input, keys.privateKey),
  })
  return { signer, publicKey: keys.publicKey }
}

test('signs the exact detached proof CRM Core verifies without retaining a private key', async () => {
  const currentBatch = batch()
  const { signer, publicKey } = signerFor()
  const delivery = await signer.signBatch(currentBatch)
  const signingInput = createAtendimentoProjectionBackfillDeliverySigningInput({
    keyId: delivery.keyId,
    batchDigest: delivery.batchDigest,
    target: TARGET,
  })

  assert.equal(delivery.contract, 'skincos-crm/projection-backfill-delivery/v1')
  assert.equal(delivery.algorithm, 'Ed25519')
  assert.match(delivery.keyId, /^crm-staging-atendimento-backfill-/)
  assert.equal(crypto.verify(null, Buffer.from(signingInput, 'utf8'), publicKey, Buffer.from(delivery.signature, 'base64url')), true)
  assert.doesNotMatch(JSON.stringify(delivery), /private|hmac|123e4567/i)
})

test('refuses a signing key that belongs to another environment before it can sign', () => {
  const keys = crypto.generateKeyPairSync('ed25519')
  assert.throws(() => createAtendimentoProjectionBackfillDeliverySigner({
    target: TARGET,
    keyId: 'crm-production-atendimento-backfill-v1',
    sign: (input) => crypto.sign(null, input, keys.privateKey),
  }), /ATENDIMENTO_CRM_BACKFILL_DELIVERY_KEY_ENVIRONMENT_MISMATCH/)
})

test('uses the CRM-scoped internal HTTPS route with no credential, cookie, origin, or authorization forwarding', async () => {
  const currentBatch = batch()
  const { signer } = signerFor()
  const delivery = await signer.signBatch(currentBatch)
  const calls = []
  const transport = createAtendimentoProjectionBackfillHttpTransport({
    endpoint: `https://crm-core-staging.example.test${ATENDIMENTO_CRM_BACKFILL_HTTP_PATH}`,
    fetch: async (url, init) => {
      calls.push({ url, init })
      return {
        status: 200,
        async json() {
          return {
            ok: true,
            contractVersion: 'crm-core/projection-backfill-receipt/v1',
            status: 'accepted',
            batchId: currentBatch.batchId,
            eventCount: currentBatch.events.length,
            target: TARGET,
            requestId: 'crm-atendimento-backfill-000001',
          }
        },
      }
    },
  })

  const receipt = await transport.deliver({
    batch: currentBatch,
    delivery,
    requestId: 'crm-atendimento-backfill-000001',
  })

  assert.equal(calls.length, 1)
  assert.equal(ATENDIMENTO_CRM_BACKFILL_HTTP_PATH, '/crm/_internal/backfill/atendimento')
  assert.equal(calls[0].url, `https://crm-core-staging.example.test${ATENDIMENTO_CRM_BACKFILL_HTTP_PATH}`)
  assert.equal(calls[0].init.method, 'POST')
  assert.equal(calls[0].init.credentials, 'omit')
  assert.equal(calls[0].init.redirect, 'error')
  assert.deepEqual(Object.keys(calls[0].init.headers).sort(), ['content-type', 'x-request-id'])
  assert.equal(JSON.stringify(calls[0].init.headers).match(/authorization|cookie|origin/i), null)
  assert.equal(receipt.status, 'accepted')
})

test('fails closed when the receiver response does not bind the batch and request id', async () => {
  const currentBatch = batch()
  const { signer } = signerFor()
  const delivery = await signer.signBatch(currentBatch)
  const transport = createAtendimentoProjectionBackfillHttpTransport({
    endpoint: `https://crm-core-staging.example.test${ATENDIMENTO_CRM_BACKFILL_HTTP_PATH}`,
    fetch: async () => ({
      status: 200,
      async json() {
        return {
          ok: true,
          contractVersion: 'crm-core/projection-backfill-receipt/v1',
          status: 'accepted',
          batchId: 'backfill:atendimento:wrong-batch',
          eventCount: currentBatch.events.length,
          target: TARGET,
          requestId: 'crm-atendimento-backfill-000001',
        }
      },
    }),
  })

  await assert.rejects(() => transport.deliver({
    batch: currentBatch,
    delivery,
    requestId: 'crm-atendimento-backfill-000001',
  }), /ATENDIMENTO_CRM_BACKFILL_TRANSPORT_RESPONSE_INVALID/)
})

test('bounds a stalled HTTP connection and aborts the injected request', async () => {
  const currentBatch = batch()
  const { signer } = signerFor()
  const delivery = await signer.signBatch(currentBatch)
  let signal
  const transport = createAtendimentoProjectionBackfillHttpTransport({
    endpoint: `https://crm-core-staging.example.test${ATENDIMENTO_CRM_BACKFILL_HTTP_PATH}`,
    timeoutMs: 1,
    fetch: (_url, init) => {
      signal = init.signal
      return new Promise(() => {})
    },
  })

  await assert.rejects(() => transport.deliver({
    batch: currentBatch,
    delivery,
    requestId: 'crm-atendimento-backfill-000001',
  }), /ATENDIMENTO_CRM_BACKFILL_TRANSPORT_UNAVAILABLE/)
  assert.equal(signal?.aborted, true)
})

test('bounds a stalled receipt body with the same abort deadline', async () => {
  const currentBatch = batch()
  const { signer } = signerFor()
  const delivery = await signer.signBatch(currentBatch)
  let signal
  const transport = createAtendimentoProjectionBackfillHttpTransport({
    endpoint: `https://crm-core-staging.example.test${ATENDIMENTO_CRM_BACKFILL_HTTP_PATH}`,
    timeoutMs: 1,
    fetch: async (_url, init) => {
      signal = init.signal
      return { status: 200, json: () => new Promise(() => {}) }
    },
  })

  await assert.rejects(() => transport.deliver({
    batch: currentBatch,
    delivery,
    requestId: 'crm-atendimento-backfill-000001',
  }), /ATENDIMENTO_CRM_BACKFILL_TRANSPORT_UNAVAILABLE/)
  assert.equal(signal?.aborted, true)
})

test('refuses the legacy or arbitrary route before it can invoke fetch', () => {
  for (const suppliedEndpoint of [
    'https://crm-core-staging.example.test/_internal/crm/backfill/atendimento',
    'https://crm-core-staging.example.test/crm/backfill',
  ]) {
    assert.throws(() => createAtendimentoProjectionBackfillHttpTransport({
      endpoint: suppliedEndpoint,
      fetch: async () => ({ status: 200, json: async () => ({}) }),
    }), /ATENDIMENTO_CRM_BACKFILL_TRANSPORT_ENDPOINT_INVALID/)
  }
})
