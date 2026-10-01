import { createHash, generateKeyPairSync, randomBytes, sign } from 'node:crypto'

import {
  assertAtendimentoProjectionExportTarget,
  createAtendimentoProjectionBackfillBatch,
  digestAtendimentoProjectionBackfillBatch,
} from './atendimentoProjectionExporter.mjs'
import {
  createAtendimentoProjectionBackfillDeliverySigner,
} from './atendimentoProjectionBackfillDelivery.mjs'
import {
  createAtendimentoProjectionBackfillHttpTransport,
} from './atendimentoProjectionBackfillHttpTransport.mjs'
import {
  ATENDIMENTO_CRM_PROJECTION_BACKFILL_RUN_INTENT,
  createPaginatedAtendimentoProjectionBackfillRunner,
} from './paginatedAtendimentoProjectionBackfillRunner.mjs'
import {
  ATENDIMENTO_SYNTHETIC_UNIT_SCOPED_PROJECTION_SOURCE,
  createSyntheticAtendimentoProjectionFixturePool,
} from './syntheticStagingPreparationRunner.mjs'

export const ATENDIMENTO_SYNTHETIC_REMOTE_REHEARSAL_VERSION = 'atendimento/crm-core/synthetic-remote-backfill-rehearsal/v2'
export const ATENDIMENTO_SYNTHETIC_REMOTE_REHEARSAL_INTENT = 'atendimento/crm-core/synthetic-remote-backfill-rehearsal-delivery/v2'

const SYNTHETIC_CAPTURED_AT = '2026-09-07T00:00:00.000Z'
const SYNTHETIC_SOURCE_ROW = Object.freeze({
  id: '123e4567-e89b-42d3-a456-426614174001',
  updated_at: SYNTHETIC_CAPTURED_AT,
  unit_slug: 'novo-hamburgo',
})
const DELIVERY_KEY_ID = 'crm-staging-atendimento-backfill-remote-rehearsal'
const SOURCE_KEY_ID = 'atendimento-synthetic-remote-rehearsal-v2'
const LEGACY_FIXTURE_BATCH_ID = 'backfill:atendimento:fixture-batch-0001'

function fail(code) {
  throw new Error(code)
}

function object(value, code) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail(code)
  return value
}

function exactKeys(value, keys, code) {
  if (Object.keys(value).length !== keys.length || keys.some((key) => !Object.hasOwn(value, key))) fail(code)
}

function sameTarget(left, right) {
  return left.environment === right.environment
    && left.release === right.release
    && left.artifactDigest === right.artifactDigest
}

function stagingTarget(value) {
  const target = assertAtendimentoProjectionExportTarget(value)
  if (target.environment !== 'staging') fail('ATENDIMENTO_CRM_SYNTHETIC_REMOTE_REHEARSAL_STAGING_ONLY')
  return target
}

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize)
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonicalize(value[key])]))
  }
  return value
}

function digest(value) {
  return `sha256:${createHash('sha256').update(JSON.stringify(canonicalize(value))).digest('hex')}`
}

function publicJwk(value) {
  const key = object(value, 'ATENDIMENTO_CRM_SYNTHETIC_REMOTE_REHEARSAL_PUBLIC_KEY_INVALID')
  exactKeys(key, ['crv', 'kty', 'x'], 'ATENDIMENTO_CRM_SYNTHETIC_REMOTE_REHEARSAL_PUBLIC_KEY_INVALID')
  if (key.kty !== 'OKP' || key.crv !== 'Ed25519' || typeof key.x !== 'string' || !key.x) {
    fail('ATENDIMENTO_CRM_SYNTHETIC_REMOTE_REHEARSAL_PUBLIC_KEY_INVALID')
  }
  return Object.freeze({ crv: key.crv, kty: key.kty, x: key.x })
}

function memoryCheckpointStore() {
  let current = null
  return Object.freeze({
    async read() { return current },
    async write(value) { current = value },
    async complete() { current = null },
  })
}

function expectedReconciliation(batch, batchDigest) {
  return Object.freeze({
    batchId: batch.batchId,
    batchDigest,
    target: Object.freeze({ ...batch.target }),
    eventCount: batch.events.length,
    eventsDigest: batch.integrity.eventsDigest,
    cursorDigest: batch.sourceSnapshot.cursorDigest,
    unitSlugs: batch.sourceSnapshot.unitSlugs,
    eventIds: Object.freeze(batch.events.map((event) => event.id)),
  })
}

function assertReconciliation(value, expected) {
  const reconciliation = object(value, 'ATENDIMENTO_CRM_SYNTHETIC_REMOTE_REHEARSAL_RECONCILIATION_INVALID')
  exactKeys(reconciliation, ['batchId', 'target', 'eventCount', 'eventsDigest', 'cursorDigest', 'unitSlugs', 'eventIds'], 'ATENDIMENTO_CRM_SYNTHETIC_REMOTE_REHEARSAL_RECONCILIATION_INVALID')
  const target = assertAtendimentoProjectionExportTarget(reconciliation.target)
  if (
    reconciliation.batchId !== expected.batchId
    || !sameTarget(target, expected.target)
    || reconciliation.eventCount !== expected.eventCount
    || reconciliation.eventsDigest !== expected.eventsDigest
    || reconciliation.cursorDigest !== expected.cursorDigest
    || !Array.isArray(reconciliation.unitSlugs)
    || JSON.stringify(reconciliation.unitSlugs) !== JSON.stringify(expected.unitSlugs)
    || !Array.isArray(reconciliation.eventIds)
    || reconciliation.eventIds.length !== expected.eventIds.length
    || reconciliation.eventIds.some((eventId, index) => eventId !== expected.eventIds[index])
  ) fail('ATENDIMENTO_CRM_SYNTHETIC_REMOTE_REHEARSAL_RECONCILIATION_INVALID')
  return Object.freeze({
    batchId: expected.batchId,
    target: Object.freeze({ ...expected.target }),
    eventCount: expected.eventCount,
    eventsDigest: expected.eventsDigest,
    cursorDigest: expected.cursorDigest,
    unitSlugs: Object.freeze([...expected.unitSlugs]),
  })
}

function assertRunSummary(value, status) {
  if (
    !value
    || value.status !== 'reconciled'
    || value.deliveredCount !== 1
    || value.batchCount !== 1
    || value.acceptedCount !== (status === 'accepted' ? 1 : 0)
    || value.idempotentCount !== (status === 'idempotent' ? 1 : 0)
  ) fail('ATENDIMENTO_CRM_SYNTHETIC_REMOTE_REHEARSAL_RECEIPT_INVALID')
}

/**
 * Prepares a single, finite, synthetic staging rehearsal. The source HMAC and
 * Ed25519 private key are generated in-memory and retained only by the closed
 * `rehearse` function. Calling this factory performs no network or deployment
 * action; it returns the public key and one approved canonical batch digest
 * that an external staging operator may configure only for this rehearsal.
 */
export function createSyntheticAtendimentoProjectionRemoteRehearsal(options = {}) {
  const input = object(options, 'ATENDIMENTO_CRM_SYNTHETIC_REMOTE_REHEARSAL_OPTIONS_INVALID')
  const target = stagingTarget(input.target)
  exactKeys(input, ['target', 'endpoint'], 'ATENDIMENTO_CRM_SYNTHETIC_REMOTE_REHEARSAL_OPTIONS_INVALID')

  // Reuse the strict transport constructor to validate the exact HTTPS route,
  // while its inert injected function ensures preparation never opens a network
  // connection.
  const endpoint = createAtendimentoProjectionBackfillHttpTransport({
    endpoint: input.endpoint,
    fetch: async () => fail('ATENDIMENTO_CRM_SYNTHETIC_REMOTE_REHEARSAL_NETWORK_NOT_PERMITTED'),
  }).endpoint

  let keyPair
  try {
    keyPair = generateKeyPairSync('ed25519')
  } catch {
    fail('ATENDIMENTO_CRM_SYNTHETIC_REMOTE_REHEARSAL_KEY_GENERATION_UNAVAILABLE')
  }
  const publicKey = publicJwk(keyPair.publicKey.export({ format: 'jwk' }))
  const hmacKey = randomBytes(48).toString('base64url')
  const batch = createAtendimentoProjectionBackfillBatch({
    rows: [SYNTHETIC_SOURCE_ROW],
    capturedAt: SYNTHETIC_CAPTURED_AT,
    hmacKey,
    keyId: SOURCE_KEY_ID,
    target,
  })
  if (batch.batchId === LEGACY_FIXTURE_BATCH_ID) fail('ATENDIMENTO_CRM_SYNTHETIC_REMOTE_REHEARSAL_BATCH_COLLISION')
  const batchDigest = digestAtendimentoProjectionBackfillBatch(batch)
  const signer = createAtendimentoProjectionBackfillDeliverySigner({
    target,
    keyId: DELIVERY_KEY_ID,
    sign: (inputToSign) => sign(null, inputToSign, keyPair.privateKey),
  })
  const expected = expectedReconciliation(batch, batchDigest)
  const publicKeysJson = JSON.stringify({ [DELIVERY_KEY_ID]: publicKey })
  const batchDigestsJson = JSON.stringify([batchDigest])
  const activation = Object.freeze({
    contractVersion: 'atendimento/crm-core/synthetic-remote-backfill-activation/v1',
    environment: 'staging',
    keyId: DELIVERY_KEY_ID,
    publicKeysJson,
    batchDigestsJson,
    configurationDigest: digest({ target, publicKey, batchDigest }),
    batch: Object.freeze({
      batchId: batch.batchId,
      batchDigest,
      eventCount: batch.events.length,
      capturedAt: batch.sourceSnapshot.capturedAt,
    }),
  })

  async function deliverOnce(fetchImpl) {
    const httpTransport = createAtendimentoProjectionBackfillHttpTransport({ endpoint, fetch: fetchImpl })
    const transport = Object.freeze({
      async deliver(value) {
        if (
          value?.batch?.batchId !== batch.batchId
          || value?.delivery?.batchDigest !== batchDigest
          || value?.batch?.integrity?.eventsDigest !== expected.eventsDigest
        ) fail('ATENDIMENTO_CRM_SYNTHETIC_REMOTE_REHEARSAL_PACKET_MISMATCH')
        return httpTransport.deliver(value)
      },
    })
    const runner = createPaginatedAtendimentoProjectionBackfillRunner({
      pool: createSyntheticAtendimentoProjectionFixturePool({
        capturedAt: SYNTHETIC_CAPTURED_AT,
        rows: [SYNTHETIC_SOURCE_ROW],
      }),
      source: ATENDIMENTO_SYNTHETIC_UNIT_SCOPED_PROJECTION_SOURCE,
      hmacKey,
      keyId: SOURCE_KEY_ID,
      target,
      signer,
      transport,
      checkpointStore: memoryCheckpointStore(),
      batchSize: 1,
      maxRows: 1,
    })
    return runner.run({ intent: ATENDIMENTO_CRM_PROJECTION_BACKFILL_RUN_INTENT })
  }

  return Object.freeze({
    version: ATENDIMENTO_SYNTHETIC_REMOTE_REHEARSAL_VERSION,
    activation,
    async rehearse(value = {}) {
      const input = object(value, 'ATENDIMENTO_CRM_SYNTHETIC_REMOTE_REHEARSAL_INPUT_INVALID')
      if (input.intent !== ATENDIMENTO_SYNTHETIC_REMOTE_REHEARSAL_INTENT) {
        fail('ATENDIMENTO_CRM_SYNTHETIC_REMOTE_REHEARSAL_INTENT_REQUIRED')
      }
      exactKeys(input, ['intent', 'fetch', 'reconcile'], 'ATENDIMENTO_CRM_SYNTHETIC_REMOTE_REHEARSAL_INPUT_INVALID')
      if (typeof input.fetch !== 'function') fail('ATENDIMENTO_CRM_SYNTHETIC_REMOTE_REHEARSAL_FETCH_REQUIRED')
      if (typeof input.reconcile !== 'function') fail('ATENDIMENTO_CRM_SYNTHETIC_REMOTE_REHEARSAL_RECONCILER_REQUIRED')

      const accepted = await deliverOnce(input.fetch)
      assertRunSummary(accepted, 'accepted')
      const idempotent = await deliverOnce(input.fetch)
      assertRunSummary(idempotent, 'idempotent')

      let reconciliation
      try {
        reconciliation = await input.reconcile(expected)
      } catch {
        fail('ATENDIMENTO_CRM_SYNTHETIC_REMOTE_REHEARSAL_RECONCILIATION_UNAVAILABLE')
      }
      const verified = assertReconciliation(reconciliation, expected)
      return Object.freeze({
        contractVersion: 'atendimento/crm-core/synthetic-remote-backfill-rehearsal-receipt/v2',
        status: 'reconciled',
        target: Object.freeze({ ...target }),
        batchId: batch.batchId,
        batchDigest,
        accepted: 'accepted',
        retry: 'idempotent',
        reconciliation: verified,
      })
    },
  })
}
