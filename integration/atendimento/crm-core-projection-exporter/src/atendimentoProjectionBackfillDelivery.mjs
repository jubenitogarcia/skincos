import { Buffer } from 'node:buffer'

import {
  assertAtendimentoProjectionBackfillBatch,
  assertAtendimentoProjectionExportTarget,
  digestAtendimentoProjectionBackfillBatch,
} from './atendimentoProjectionExporter.mjs'

export const ATENDIMENTO_CRM_PROJECTION_BACKFILL_DELIVERY_VERSION = 'skincos-crm/projection-backfill-delivery/v1'
export const ATENDIMENTO_CRM_PROJECTION_BACKFILL_DELIVERY_ALGORITHM = 'Ed25519'

const KEY_ID_PATTERN = /^[A-Za-z0-9._-]{3,96}$/
const SHA256_PATTERN = /^sha256:[a-f0-9]{64}$/
const SIGNATURE_PATTERN = /^[A-Za-z0-9_-]{80,512}$/

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

function text(value, code) {
  const normalized = String(value || '').trim()
  if (!normalized) fail(code)
  return normalized
}

function deliveryKeyId(value) {
  const normalized = text(value, 'ATENDIMENTO_CRM_BACKFILL_DELIVERY_KEY_ID_INVALID')
  if (!KEY_ID_PATTERN.test(normalized)) fail('ATENDIMENTO_CRM_BACKFILL_DELIVERY_KEY_ID_INVALID')
  return normalized
}

function batchDigest(value) {
  const normalized = text(value, 'ATENDIMENTO_CRM_BACKFILL_DELIVERY_BATCH_DIGEST_INVALID').toLowerCase()
  if (!SHA256_PATTERN.test(normalized)) fail('ATENDIMENTO_CRM_BACKFILL_DELIVERY_BATCH_DIGEST_INVALID')
  return normalized
}

function signature(value) {
  const normalized = text(value, 'ATENDIMENTO_CRM_BACKFILL_DELIVERY_SIGNATURE_INVALID')
  if (!SIGNATURE_PATTERN.test(normalized)) fail('ATENDIMENTO_CRM_BACKFILL_DELIVERY_SIGNATURE_INVALID')
  return normalized
}

function sameTarget(left, right) {
  return left.environment === right.environment
    && left.release === right.release
    && left.artifactDigest === right.artifactDigest
}

function encodeSignature(value) {
  if (value instanceof Uint8Array || Buffer.isBuffer(value)) return Buffer.from(value).toString('base64url')
  if (value instanceof ArrayBuffer) return Buffer.from(value).toString('base64url')
  return String(value || '').trim()
}

/**
 * Exact detached-signature input accepted by CRM Core. No private key is read
 * or retained here; production callers must inject a custody-backed signer.
 */
export function createAtendimentoProjectionBackfillDeliverySigningInput({
  keyId,
  batchDigest: suppliedBatchDigest,
  target,
} = {}) {
  const normalizedKeyId = deliveryKeyId(keyId)
  const normalizedBatchDigest = batchDigest(suppliedBatchDigest)
  const normalizedTarget = assertAtendimentoProjectionExportTarget(target)
  return [
    ATENDIMENTO_CRM_PROJECTION_BACKFILL_DELIVERY_VERSION,
    normalizedKeyId,
    ATENDIMENTO_CRM_PROJECTION_BACKFILL_DELIVERY_ALGORITHM,
    normalizedBatchDigest,
    normalizedTarget.environment,
    normalizedTarget.release,
    normalizedTarget.artifactDigest,
  ].join('\n')
}

export function assertAtendimentoProjectionBackfillDelivery(value) {
  const delivery = object(value, 'ATENDIMENTO_CRM_BACKFILL_DELIVERY_INVALID')
  exactKeys(delivery, ['contract', 'keyId', 'algorithm', 'batchDigest', 'signature'], 'ATENDIMENTO_CRM_BACKFILL_DELIVERY_INVALID')
  if (
    delivery.contract !== ATENDIMENTO_CRM_PROJECTION_BACKFILL_DELIVERY_VERSION
    || delivery.algorithm !== ATENDIMENTO_CRM_PROJECTION_BACKFILL_DELIVERY_ALGORITHM
  ) fail('ATENDIMENTO_CRM_BACKFILL_DELIVERY_INVALID')
  return Object.freeze({
    contract: ATENDIMENTO_CRM_PROJECTION_BACKFILL_DELIVERY_VERSION,
    keyId: deliveryKeyId(delivery.keyId),
    algorithm: ATENDIMENTO_CRM_PROJECTION_BACKFILL_DELIVERY_ALGORITHM,
    batchDigest: batchDigest(delivery.batchDigest),
    signature: signature(delivery.signature),
  })
}

/**
 * Returns a signer for one exact target artifact. The callback is the only
 * component allowed to touch a private key, so this module cannot load a key
 * from the repository, environment, command line or log output.
 */
export function createAtendimentoProjectionBackfillDeliverySigner({
  target,
  keyId,
  sign,
} = {}) {
  const configuredTarget = assertAtendimentoProjectionExportTarget(target)
  const configuredKeyId = deliveryKeyId(keyId)
  const requiredPrefix = `crm-${configuredTarget.environment}-atendimento-backfill-`
  if (!configuredKeyId.startsWith(requiredPrefix)) fail('ATENDIMENTO_CRM_BACKFILL_DELIVERY_KEY_ENVIRONMENT_MISMATCH')
  if (typeof sign !== 'function') fail('ATENDIMENTO_CRM_BACKFILL_DELIVERY_SIGNER_REQUIRED')

  return Object.freeze({
    version: 'atendimento/crm-core-projection-backfill-delivery-signer/v1',
    target: configuredTarget,
    keyId: configuredKeyId,
    async signBatch(value) {
      const batch = assertAtendimentoProjectionBackfillBatch(value)
      if (!sameTarget(batch.target, configuredTarget)) fail('ATENDIMENTO_CRM_BACKFILL_DELIVERY_TARGET_MISMATCH')
      const digest = digestAtendimentoProjectionBackfillBatch(batch)
      const signingInput = createAtendimentoProjectionBackfillDeliverySigningInput({
        keyId: configuredKeyId,
        batchDigest: digest,
        target: configuredTarget,
      })
      let rawSignature
      try {
        rawSignature = await sign(Buffer.from(signingInput, 'utf8'))
      } catch {
        fail('ATENDIMENTO_CRM_BACKFILL_DELIVERY_SIGNING_UNAVAILABLE')
      }
      return assertAtendimentoProjectionBackfillDelivery({
        contract: ATENDIMENTO_CRM_PROJECTION_BACKFILL_DELIVERY_VERSION,
        keyId: configuredKeyId,
        algorithm: ATENDIMENTO_CRM_PROJECTION_BACKFILL_DELIVERY_ALGORITHM,
        batchDigest: digest,
        signature: encodeSignature(rawSignature),
      })
    },
  })
}
