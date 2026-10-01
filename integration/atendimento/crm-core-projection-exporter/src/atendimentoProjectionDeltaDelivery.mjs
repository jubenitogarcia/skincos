import { Buffer } from 'node:buffer'

import {
  assertAtendimentoProjectionDeltaBatch,
  assertAtendimentoProjectionExportTarget,
  digestAtendimentoProjectionDeltaBatch,
} from './atendimentoProjectionDeltaExporter.mjs'

export const ATENDIMENTO_CRM_PROJECTION_DELTA_DELIVERY_VERSION = 'skincos-crm/projection-delta-delivery/v1'
export const ATENDIMENTO_CRM_PROJECTION_DELTA_DELIVERY_ALGORITHM = 'Ed25519'

const KEY_ID_PATTERN = /^[A-Za-z0-9._-]{3,96}$/
const DIGEST_PATTERN = /^sha256:[a-f0-9]{64}$/
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
  const normalized = String(value ?? '').trim()
  if (!normalized) fail(code)
  return normalized
}

function keyId(value) {
  const normalized = text(value, 'ATENDIMENTO_CRM_PROJECTION_DELTA_DELIVERY_KEY_ID_INVALID')
  if (!KEY_ID_PATTERN.test(normalized)) fail('ATENDIMENTO_CRM_PROJECTION_DELTA_DELIVERY_KEY_ID_INVALID')
  return normalized
}

function digest(value) {
  const normalized = text(value, 'ATENDIMENTO_CRM_PROJECTION_DELTA_DELIVERY_BATCH_DIGEST_INVALID').toLowerCase()
  if (!DIGEST_PATTERN.test(normalized)) fail('ATENDIMENTO_CRM_PROJECTION_DELTA_DELIVERY_BATCH_DIGEST_INVALID')
  return normalized
}

function signature(value) {
  const normalized = text(value, 'ATENDIMENTO_CRM_PROJECTION_DELTA_DELIVERY_SIGNATURE_INVALID')
  if (!SIGNATURE_PATTERN.test(normalized)) fail('ATENDIMENTO_CRM_PROJECTION_DELTA_DELIVERY_SIGNATURE_INVALID')
  return normalized
}

function sameTarget(left, right) {
  return left.environment === right.environment && left.release === right.release && left.artifactDigest === right.artifactDigest
}

function encodeSignature(value) {
  if (value instanceof Uint8Array || Buffer.isBuffer(value)) return Buffer.from(value).toString('base64url')
  if (value instanceof ArrayBuffer) return Buffer.from(value).toString('base64url')
  return String(value ?? '').trim()
}

export function createAtendimentoProjectionDeltaSigningInput({ keyId: suppliedKeyId, batchDigest: suppliedDigest, target } = {}) {
  const normalizedKeyId = keyId(suppliedKeyId)
  const normalizedDigest = digest(suppliedDigest)
  const normalizedTarget = assertAtendimentoProjectionExportTarget(target)
  return [
    ATENDIMENTO_CRM_PROJECTION_DELTA_DELIVERY_VERSION,
    normalizedKeyId,
    ATENDIMENTO_CRM_PROJECTION_DELTA_DELIVERY_ALGORITHM,
    normalizedDigest,
    normalizedTarget.environment,
    normalizedTarget.release,
    normalizedTarget.artifactDigest,
  ].join('\n')
}

export function assertAtendimentoProjectionDeltaDelivery(value) {
  const delivery = object(value, 'ATENDIMENTO_CRM_PROJECTION_DELTA_DELIVERY_INVALID')
  exactKeys(delivery, ['contract', 'keyId', 'algorithm', 'batchDigest', 'signature'], 'ATENDIMENTO_CRM_PROJECTION_DELTA_DELIVERY_INVALID')
  if (delivery.contract !== ATENDIMENTO_CRM_PROJECTION_DELTA_DELIVERY_VERSION || delivery.algorithm !== ATENDIMENTO_CRM_PROJECTION_DELTA_DELIVERY_ALGORITHM) fail('ATENDIMENTO_CRM_PROJECTION_DELTA_DELIVERY_INVALID')
  return Object.freeze({ contract: delivery.contract, keyId: keyId(delivery.keyId), algorithm: delivery.algorithm, batchDigest: digest(delivery.batchDigest), signature: signature(delivery.signature) })
}

/**
 * Creates an operator-injected detached signer. Private keys are intentionally
 * unavailable to this package; custody is the callback's responsibility.
 */
export function createAtendimentoProjectionDeltaDeliverySigner({ target, keyId: suppliedKeyId, sign } = {}) {
  const configuredTarget = assertAtendimentoProjectionExportTarget(target)
  const configuredKeyId = keyId(suppliedKeyId)
  const expectedPrefix = `crm-${configuredTarget.environment}-atendimento-delta-`
  if (!configuredKeyId.startsWith(expectedPrefix)) fail('ATENDIMENTO_CRM_PROJECTION_DELTA_DELIVERY_KEY_ENVIRONMENT_MISMATCH')
  if (typeof sign !== 'function') fail('ATENDIMENTO_CRM_PROJECTION_DELTA_DELIVERY_SIGNER_REQUIRED')
  return Object.freeze({
    version: 'atendimento/crm-core/projection-delta-delivery-signer/v1',
    target: configuredTarget,
    keyId: configuredKeyId,
    async signBatch(value) {
      const batch = assertAtendimentoProjectionDeltaBatch(value)
      if (!sameTarget(batch.target, configuredTarget)) fail('ATENDIMENTO_CRM_PROJECTION_DELTA_DELIVERY_TARGET_MISMATCH')
      const batchDigest = digestAtendimentoProjectionDeltaBatch(batch)
      let rawSignature
      try {
        rawSignature = await sign(Buffer.from(createAtendimentoProjectionDeltaSigningInput({ keyId: configuredKeyId, batchDigest, target: configuredTarget }), 'utf8'))
      } catch {
        fail('ATENDIMENTO_CRM_PROJECTION_DELTA_DELIVERY_SIGNING_UNAVAILABLE')
      }
      return assertAtendimentoProjectionDeltaDelivery({
        contract: ATENDIMENTO_CRM_PROJECTION_DELTA_DELIVERY_VERSION,
        keyId: configuredKeyId,
        algorithm: ATENDIMENTO_CRM_PROJECTION_DELTA_DELIVERY_ALGORITHM,
        batchDigest,
        signature: encodeSignature(rawSignature),
      })
    },
  })
}

export const __testables = Object.freeze({ sameTarget, encodeSignature })
