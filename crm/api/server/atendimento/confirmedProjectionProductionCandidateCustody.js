import { createHash, verify as verifySignature } from 'node:crypto'

import {
  ATENDIMENTO_CONFIRMED_PROJECTION_BASELINE_V2_STATES,
  assertAtendimentoConfirmedProjectionBaselineV2,
  digestAtendimentoConfirmedProjectionBaselineV2,
} from '../../../../shared/crm-auth/atendimentoConfirmedProjectionBaselineV2.js'
import {
  ATENDIMENTO_CONFIRMED_PROJECTION_DELTA_V2_SCOPE,
} from '../../../../shared/crm-auth/atendimentoConfirmedProjectionDeltaV2.js'
import {
  ATENDIMENTO_CRM_CORE_IDENTITY_SOURCE_SEMANTICS_VERSION,
  ATENDIMENTO_CRM_CORE_ISOLATED_IDENTITY_PROJECTION_SOURCE_RELATIONS,
} from '../../../../shared/crm-auth/atendimentoCrmCoreIdentityMaterializationPolicy.js'

// This module is deliberately an evidence-only boundary. It does not accept a
// PostgreSQL pool, endpoint, credential, signer, transport, environment value,
// or filesystem capability. A root-owned integration may use its result as an
// admission input later, but this source code cannot read source rows, deliver
// a packet, mutate CRM Core, change a route, or retire a legacy publisher.
export const ATENDIMENTO_CONFIRMED_PROJECTION_PRODUCTION_CANDIDATE_CUSTODY_CONTRACT = 'atendimento/crm-core/confirmed-projection-production-candidate-custody/v1'
export const ATENDIMENTO_CONFIRMED_PROJECTION_PRODUCTION_CANDIDATE_CUSTODY_EVIDENCE_CONTRACT = 'atendimento/crm-core/confirmed-projection-production-candidate-custody-evidence/v1'
export const ATENDIMENTO_CONFIRMED_PROJECTION_PRODUCTION_CANDIDATE_CUSTODY_INTENT = 'atendimento/crm-core/prepare-confirmed-projection-production-candidate/v1'

const DOMAIN = 'atendimento-client-memberships'
const ISSUER = 'atendimento-production-custody'
const EVIDENCE_KINDS = Object.freeze([
  'source-identity',
  'cursor',
  'checkpoint',
  'reconciliation',
  'rollback',
])
const SHA256_PATTERN = /^sha256:[a-f0-9]{64}$/
const SHA_PATTERN = /^[0-9a-f]{40}$/
const KEY_ID_PATTERN = /^[a-z][a-z0-9-]{1,63}$/
const SIGNATURE_PATTERN = /^[A-Za-z0-9_-]{86}$/
const ISO_MILLIS_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/
const MAX_EVIDENCE_LIFETIME_MS = 15 * 60 * 1000

function fail(code) {
  throw new Error(`ATENDIMENTO_CONFIRMED_PROJECTION_PRODUCTION_CANDIDATE_CUSTODY_${code}`)
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

function sha(value, code) {
  const normalized = text(value, code).toLowerCase()
  if (!SHA_PATTERN.test(normalized)) fail(code)
  return normalized
}

function digest(value, code) {
  const normalized = text(value, code).toLowerCase()
  if (!SHA256_PATTERN.test(normalized)) fail(code)
  return normalized
}

function timestamp(value, code) {
  const normalized = value instanceof Date ? value.toISOString() : text(value, code)
  if (!ISO_MILLIS_PATTERN.test(normalized) || Number.isNaN(new Date(normalized).getTime()) || new Date(normalized).toISOString() !== normalized) {
    fail(code)
  }
  return normalized
}

function integer(value, code, { minimum = 0, maximum = Number.MAX_SAFE_INTEGER } = {}) {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) fail(code)
  return value
}

function canonicalJson(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`
}

function digestValue(value) {
  return `sha256:${createHash('sha256').update(canonicalJson(value)).digest('hex')}`
}

function sameArray(left, right) {
  return Array.isArray(left) && left.length === right.length && left.every((entry, index) => entry === right[index])
}

function privacy(value, code) {
  if (
    value.credentialsIncluded !== false
    || value.piiIncluded !== false
    || value.rawIdentifiersIncluded !== false
  ) fail(code)
}

function target(value, code) {
  const descriptor = object(value, code)
  exactKeys(descriptor, ['environment', 'release', 'artifactDigest'], code)
  const environment = text(descriptor.environment, code)
  const release = sha(descriptor.release, code)
  const artifactDigest = digest(descriptor.artifactDigest, code)
  if (environment !== 'staging') fail(code)
  return Object.freeze({ environment, release, artifactDigest })
}

function sameTarget(left, right) {
  return left.environment === right.environment
    && left.release === right.release
    && left.artifactDigest === right.artifactDigest
}

function snapshot(value, code) {
  const sourceSnapshot = object(value, code)
  exactKeys(sourceSnapshot, ['capturedAt', 'membershipDigest', 'rowCount', 'watermark'], code)
  return Object.freeze({
    capturedAt: timestamp(sourceSnapshot.capturedAt, code),
    membershipDigest: digest(sourceSnapshot.membershipDigest, code),
    rowCount: integer(sourceSnapshot.rowCount, code, { maximum: 10_000 }),
    watermark: integer(sourceSnapshot.watermark, code),
  })
}

function sameSnapshot(left, right) {
  return left.capturedAt === right.capturedAt
    && left.membershipDigest === right.membershipDigest
    && left.rowCount === right.rowCount
    && left.watermark === right.watermark
}

function normalizedEvidenceUnsigned(value) {
  const evidence = object(value, 'EVIDENCE_INVALID')
  exactKeys(evidence, ['contract', 'kind', 'issuer', 'issuedAt', 'expiresAt', 'payload'], 'EVIDENCE_INVALID')
  if (
    evidence.contract !== ATENDIMENTO_CONFIRMED_PROJECTION_PRODUCTION_CANDIDATE_CUSTODY_EVIDENCE_CONTRACT
    || !EVIDENCE_KINDS.includes(evidence.kind)
    || evidence.issuer !== ISSUER
  ) fail('EVIDENCE_INVALID')
  return Object.freeze({
    contract: ATENDIMENTO_CONFIRMED_PROJECTION_PRODUCTION_CANDIDATE_CUSTODY_EVIDENCE_CONTRACT,
    kind: evidence.kind,
    issuer: ISSUER,
    issuedAt: timestamp(evidence.issuedAt, 'EVIDENCE_INVALID'),
    expiresAt: timestamp(evidence.expiresAt, 'EVIDENCE_INVALID'),
    payload: object(evidence.payload, 'EVIDENCE_INVALID'),
  })
}

/**
 * Returns the exact UTF-8 string an external root-owned custody signer must
 * sign. Its input has no signature field and must contain only sanitized
 * metadata. No key material is accepted or retained by this module.
 */
export function canonicalAtendimentoConfirmedProjectionProductionCandidateCustodyEvidence(value) {
  return canonicalJson(normalizedEvidenceUnsigned(value))
}

export function digestAtendimentoConfirmedProjectionProductionCandidateCustodyEvidence(value) {
  const evidence = object(value, 'EVIDENCE_INVALID')
  exactKeys(evidence, ['contract', 'kind', 'issuer', 'issuedAt', 'expiresAt', 'payload', 'signature'], 'EVIDENCE_INVALID')
  return digestValue(evidence)
}

function sourceCursorDigest(baseline) {
  return digestValue({
    contract: 'atendimento/crm-core/confirmed-projection-cursor/v1',
    sourceProfileDigest: baseline.sourceProfile.digest,
    capturedAt: baseline.snapshot.capturedAt,
    membershipDigest: baseline.snapshot.membershipDigest,
    watermark: baseline.snapshot.watermark,
    manifestDigest: baseline.backfill.manifestDigest,
    cursors: baseline.backfill.batches.map((batch) => batch.cursorDigest),
  })
}

function baselineContext(value) {
  let baseline
  try {
    baseline = assertAtendimentoConfirmedProjectionBaselineV2(value)
  } catch {
    fail('BASELINE_INVALID')
  }
  if (
    baseline.state !== ATENDIMENTO_CONFIRMED_PROJECTION_BASELINE_V2_STATES.READY
    || baseline.target.environment !== 'staging'
    || baseline.source.owner !== 'atendimento'
    || baseline.source.scope !== ATENDIMENTO_CONFIRMED_PROJECTION_DELTA_V2_SCOPE
    || !baseline.readback
  ) fail('BASELINE_NOT_STAGING_READY')
  return Object.freeze({
    baseline,
    baselineDigest: digestAtendimentoConfirmedProjectionBaselineV2(baseline),
    cursorDigest: sourceCursorDigest(baseline),
    readbackDigest: digestValue(baseline.readback),
    snapshot: Object.freeze({
      capturedAt: baseline.snapshot.capturedAt,
      membershipDigest: baseline.snapshot.membershipDigest,
      rowCount: baseline.snapshot.rowCount,
      watermark: baseline.snapshot.watermark,
    }),
  })
}

function commonPayload(payload, { sourceSha, baselineDigest, code }) {
  if (payload.domain !== DOMAIN || sha(payload.sourceSha, code) !== sourceSha) fail(code)
  if (baselineDigest !== null && digest(payload.baselineDigest, code) !== baselineDigest) fail(code)
  privacy(payload, code)
}

function assertSourceIdentityEvidence(payload, context, sourceSha) {
  const code = 'SOURCE_IDENTITY_EVIDENCE_INVALID'
  exactKeys(payload, [
    'domain', 'sourceSha', 'sourceEnvironment', 'database', 'principal', 'sessionPrincipal', 'transaction',
    'sourceContract', 'sourceSemantics', 'sourceProfileDigest', 'sourceRelationAllowlist', 'snapshot',
    'credentialsIncluded', 'piiIncluded', 'rawIdentifiersIncluded',
  ], code)
  commonPayload(payload, { sourceSha, baselineDigest: null, code })
  if (
    payload.sourceEnvironment !== 'production'
    || payload.database !== 'skincos_clientes_production'
    || payload.principal !== 'crm_core_projection_exporter'
    || payload.sessionPrincipal !== 'crm_core_projection_exporter'
    || payload.transaction !== 'repeatable-read-read-only'
    || payload.sourceContract !== 'atendimento/crm-core/unit-scoped-projection-source/v1'
    || payload.sourceSemantics !== ATENDIMENTO_CRM_CORE_IDENTITY_SOURCE_SEMANTICS_VERSION
    || digest(payload.sourceProfileDigest, code) !== context.baseline.sourceProfile.digest
    || !sameArray(payload.sourceRelationAllowlist, ATENDIMENTO_CRM_CORE_ISOLATED_IDENTITY_PROJECTION_SOURCE_RELATIONS)
  ) fail(code)
  if (!sameSnapshot(snapshot(payload.snapshot, code), context.snapshot)) fail(code)
}

function assertCursorEvidence(payload, context, sourceSha, sourceEvidenceDigest) {
  const code = 'CURSOR_EVIDENCE_INVALID'
  exactKeys(payload, [
    'domain', 'sourceSha', 'baselineDigest', 'sourceEvidenceDigest', 'cursorDigest', 'manifestDigest', 'snapshot',
    'credentialsIncluded', 'piiIncluded', 'rawIdentifiersIncluded',
  ], code)
  commonPayload(payload, { sourceSha, baselineDigest: context.baselineDigest, code })
  if (
    digest(payload.sourceEvidenceDigest, code) !== sourceEvidenceDigest
    || digest(payload.cursorDigest, code) !== context.cursorDigest
    || digest(payload.manifestDigest, code) !== context.baseline.backfill.manifestDigest
    || !sameSnapshot(snapshot(payload.snapshot, code), context.snapshot)
  ) fail(code)
}

function assertCheckpointEvidence(payload, context, sourceSha, sourceEvidenceDigest, cursorEvidenceDigest) {
  const code = 'CHECKPOINT_EVIDENCE_INVALID'
  exactKeys(payload, [
    'domain', 'sourceSha', 'baselineDigest', 'sourceEvidenceDigest', 'cursorEvidenceDigest', 'cursorDigest', 'checkpointDigest', 'state',
    'credentialsIncluded', 'piiIncluded', 'rawIdentifiersIncluded',
  ], code)
  commonPayload(payload, { sourceSha, baselineDigest: context.baselineDigest, code })
  if (
    digest(payload.sourceEvidenceDigest, code) !== sourceEvidenceDigest
    || digest(payload.cursorEvidenceDigest, code) !== cursorEvidenceDigest
    || digest(payload.cursorDigest, code) !== context.cursorDigest
    || payload.state !== 'sealed'
  ) fail(code)
  return digest(payload.checkpointDigest, code)
}

function assertReconciliationEvidence(payload, context, sourceSha, sourceEvidenceDigest, cursorEvidenceDigest, checkpointEvidenceDigest, checkpointDigest) {
  const code = 'RECONCILIATION_EVIDENCE_INVALID'
  exactKeys(payload, [
    'domain', 'sourceSha', 'baselineDigest', 'sourceEvidenceDigest', 'cursorEvidenceDigest', 'checkpointEvidenceDigest', 'cursorDigest', 'checkpointDigest',
    'readbackDigest', 'verifiedBatchCount', 'verifiedEventCount', 'coreTarget', 'state',
    'credentialsIncluded', 'piiIncluded', 'rawIdentifiersIncluded',
  ], code)
  commonPayload(payload, { sourceSha, baselineDigest: context.baselineDigest, code })
  const coreTarget = target(payload.coreTarget, code)
  if (
    digest(payload.sourceEvidenceDigest, code) !== sourceEvidenceDigest
    || digest(payload.cursorEvidenceDigest, code) !== cursorEvidenceDigest
    || digest(payload.checkpointEvidenceDigest, code) !== checkpointEvidenceDigest
    || digest(payload.cursorDigest, code) !== context.cursorDigest
    || digest(payload.checkpointDigest, code) !== checkpointDigest
    || digest(payload.readbackDigest, code) !== context.readbackDigest
    || integer(payload.verifiedBatchCount, code, { maximum: 500 }) !== context.baseline.readback.verifiedBatchCount
    || integer(payload.verifiedEventCount, code, { maximum: 10_000 }) !== context.baseline.readback.verifiedEventCount
    || !sameTarget(coreTarget, context.baseline.target)
    || payload.state !== 'verified'
  ) fail(code)
}

function assertRollbackEvidence(payload, context, sourceSha, evidenceDigests, checkpointDigest) {
  const code = 'ROLLBACK_EVIDENCE_INVALID'
  exactKeys(payload, [
    'domain', 'sourceSha', 'baselineDigest', 'sourceEvidenceDigest', 'cursorEvidenceDigest', 'checkpointEvidenceDigest', 'reconciliationEvidenceDigest',
    'cursorDigest', 'checkpointDigest', 'readbackDigest', 'coreTarget', 'rollbackTarget', 'strategy', 'smokeDigest', 'state',
    'credentialsIncluded', 'piiIncluded', 'rawIdentifiersIncluded',
  ], code)
  commonPayload(payload, { sourceSha, baselineDigest: context.baselineDigest, code })
  const coreTarget = target(payload.coreTarget, code)
  const rollbackTarget = target(payload.rollbackTarget, code)
  const smokeDigest = digest(payload.smokeDigest, code)
  if (
    digest(payload.sourceEvidenceDigest, code) !== evidenceDigests.sourceIdentity
    || digest(payload.cursorEvidenceDigest, code) !== evidenceDigests.cursor
    || digest(payload.checkpointEvidenceDigest, code) !== evidenceDigests.checkpoint
    || digest(payload.reconciliationEvidenceDigest, code) !== evidenceDigests.reconciliation
    || digest(payload.cursorDigest, code) !== context.cursorDigest
    || digest(payload.checkpointDigest, code) !== checkpointDigest
    || digest(payload.readbackDigest, code) !== context.readbackDigest
    || !sameTarget(coreTarget, context.baseline.target)
    || sameTarget(rollbackTarget, coreTarget)
    || payload.strategy !== 'disable-ingestion-preserve-ledger'
    || payload.state !== 'verified'
  ) fail(code)
  return Object.freeze({ rollbackTarget, smokeDigest })
}

function signedEvidence(value, { kind, publicKey, keyId, now }) {
  const evidence = object(value, 'EVIDENCE_INVALID')
  exactKeys(evidence, ['contract', 'kind', 'issuer', 'issuedAt', 'expiresAt', 'payload', 'signature'], 'EVIDENCE_INVALID')
  const unsigned = normalizedEvidenceUnsigned({
    contract: evidence.contract,
    kind: evidence.kind,
    issuer: evidence.issuer,
    issuedAt: evidence.issuedAt,
    expiresAt: evidence.expiresAt,
    payload: evidence.payload,
  })
  if (unsigned.kind !== kind) fail('EVIDENCE_KIND_INVALID')
  const issuedAt = new Date(unsigned.issuedAt)
  const expiresAt = new Date(unsigned.expiresAt)
  if (
    expiresAt <= issuedAt
    || expiresAt.getTime() - issuedAt.getTime() > MAX_EVIDENCE_LIFETIME_MS
    || now < issuedAt
    || now >= expiresAt
  ) fail('EVIDENCE_TIME_INVALID')
  const signature = object(evidence.signature, 'EVIDENCE_SIGNATURE_INVALID')
  exactKeys(signature, ['algorithm', 'keyId', 'valueBase64url'], 'EVIDENCE_SIGNATURE_INVALID')
  if (
    signature.algorithm !== 'Ed25519'
    || signature.keyId !== keyId
    || typeof signature.valueBase64url !== 'string'
    || !SIGNATURE_PATTERN.test(signature.valueBase64url)
  ) fail('EVIDENCE_SIGNATURE_INVALID')
  const signatureBytes = Buffer.from(signature.valueBase64url, 'base64url')
  try {
    if (
      signatureBytes.length !== 64
      || signatureBytes.toString('base64url') !== signature.valueBase64url
      || !verifySignature(null, Buffer.from(canonicalAtendimentoConfirmedProjectionProductionCandidateCustodyEvidence(unsigned), 'utf8'), publicKey, signatureBytes)
    ) fail('EVIDENCE_SIGNATURE_INVALID')
  } finally {
    signatureBytes.fill(0)
  }
  return Object.freeze({
    ...unsigned,
    signature: Object.freeze({ algorithm: 'Ed25519', keyId, valueBase64url: signature.valueBase64url }),
  })
}

function candidateUnsigned({ sourceSha, context, source, checkpointDigest, evidenceDigests, rollback }) {
  return Object.freeze({
    contract: ATENDIMENTO_CONFIRMED_PROJECTION_PRODUCTION_CANDIDATE_CUSTODY_CONTRACT,
    state: 'candidate-validated-no-execution',
    intent: ATENDIMENTO_CONFIRMED_PROJECTION_PRODUCTION_CANDIDATE_CUSTODY_INTENT,
    domain: DOMAIN,
    sourceSha,
    source: Object.freeze({
      environment: 'production',
      database: source.database,
      principal: source.principal,
      sessionPrincipal: source.sessionPrincipal,
      transaction: source.transaction,
      contract: source.sourceContract,
      semantics: source.sourceSemantics,
      sourceProfileDigest: source.sourceProfileDigest,
      sourceRelationAllowlist: Object.freeze([...source.sourceRelationAllowlist]),
    }),
    target: context.baseline.target,
    snapshot: context.snapshot,
    custody: Object.freeze({
      baselineDigest: context.baselineDigest,
      cursorDigest: context.cursorDigest,
      checkpointDigest,
      readbackDigest: context.readbackDigest,
      sourceIdentityEvidenceDigest: evidenceDigests.sourceIdentity,
      cursorEvidenceDigest: evidenceDigests.cursor,
      checkpointEvidenceDigest: evidenceDigests.checkpoint,
      reconciliationEvidenceDigest: evidenceDigests.reconciliation,
      rollbackEvidenceDigest: evidenceDigests.rollback,
      rollbackTarget: rollback.rollbackTarget,
      rollbackSmokeDigest: rollback.smokeDigest,
    }),
    execution: Object.freeze({
      sourceReadAllowed: false,
      deliveryAllowed: false,
      productionMutationAllowed: false,
      publicRouteMutationAllowed: false,
      legacyPublisherMutationAllowed: false,
    }),
    privacy: Object.freeze({
      credentialsIncluded: false,
      piiIncluded: false,
      rawIdentifiersIncluded: false,
    }),
  })
}

/**
 * Validates a short-lived externally signed chain, then produces a
 * digest-addressable candidate with every execution capability explicitly
 * disabled. `custodyPublicKey` must be a key already pinned by a root-owned
 * caller; this factory intentionally accepts no JWK, environment value, or
 * file path supplied by the candidate itself.
 */
export function createAtendimentoConfirmedProjectionProductionCandidateCustodyVerifier({ custodyKeyId, custodyPublicKey, now } = {}) {
  const keyId = text(custodyKeyId, 'CUSTODY_KEY_ID_INVALID')
  if (!KEY_ID_PATTERN.test(keyId)) fail('CUSTODY_KEY_ID_INVALID')
  if (!custodyPublicKey || custodyPublicKey.asymmetricKeyType !== 'ed25519') fail('CUSTODY_PUBLIC_KEY_INVALID')
  const currentTime = new Date(timestamp(now, 'CUSTODY_NOW_INVALID'))

  return Object.freeze({
    version: 'atendimento/crm-core/confirmed-projection-production-candidate-custody-verifier/v1',
    prepare(value) {
      const input = object(value, 'INPUT_INVALID')
      exactKeys(input, ['intent', 'sourceSha', 'baseline', 'evidence'], 'INPUT_INVALID')
      if (input.intent !== ATENDIMENTO_CONFIRMED_PROJECTION_PRODUCTION_CANDIDATE_CUSTODY_INTENT) fail('INTENT_REQUIRED')
      const sourceSha = sha(input.sourceSha, 'SOURCE_SHA_INVALID')
      const context = baselineContext(input.baseline)
      if (!Array.isArray(input.evidence) || input.evidence.length !== EVIDENCE_KINDS.length) fail('EVIDENCE_SET_INVALID')

      const evidence = EVIDENCE_KINDS.map((kind, index) => signedEvidence(input.evidence[index], {
        kind,
        publicKey: custodyPublicKey,
        keyId,
        now: currentTime,
      }))
      const [sourceIdentity, cursor, checkpoint, reconciliation, rollback] = evidence
      const evidenceDigests = Object.freeze({
        sourceIdentity: digestAtendimentoConfirmedProjectionProductionCandidateCustodyEvidence(sourceIdentity),
        cursor: digestAtendimentoConfirmedProjectionProductionCandidateCustodyEvidence(cursor),
        checkpoint: digestAtendimentoConfirmedProjectionProductionCandidateCustodyEvidence(checkpoint),
        reconciliation: digestAtendimentoConfirmedProjectionProductionCandidateCustodyEvidence(reconciliation),
        rollback: digestAtendimentoConfirmedProjectionProductionCandidateCustodyEvidence(rollback),
      })

      assertSourceIdentityEvidence(sourceIdentity.payload, context, sourceSha)
      assertCursorEvidence(cursor.payload, context, sourceSha, evidenceDigests.sourceIdentity)
      const checkpointDigest = assertCheckpointEvidence(
        checkpoint.payload,
        context,
        sourceSha,
        evidenceDigests.sourceIdentity,
        evidenceDigests.cursor,
      )
      assertReconciliationEvidence(
        reconciliation.payload,
        context,
        sourceSha,
        evidenceDigests.sourceIdentity,
        evidenceDigests.cursor,
        evidenceDigests.checkpoint,
        checkpointDigest,
      )
      const rollbackProof = assertRollbackEvidence(rollback.payload, context, sourceSha, evidenceDigests, checkpointDigest)

      const unsigned = candidateUnsigned({
        sourceSha,
        context,
        source: sourceIdentity.payload,
        checkpointDigest,
        evidenceDigests,
        rollback: rollbackProof,
      })
      return Object.freeze({ ...unsigned, candidateDigest: digestValue(unsigned) })
    },
  })
}

export const __testables = Object.freeze({
  canonicalJson,
  digestValue,
  sourceCursorDigest,
})
