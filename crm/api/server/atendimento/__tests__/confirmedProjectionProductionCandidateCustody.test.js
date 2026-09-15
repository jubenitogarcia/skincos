import assert from 'node:assert/strict'
import { generateKeyPairSync, sign as signEvidence } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

import {
  ATENDIMENTO_CONFIRMED_PROJECTION_PRODUCTION_CANDIDATE_CUSTODY_EVIDENCE_CONTRACT,
  ATENDIMENTO_CONFIRMED_PROJECTION_PRODUCTION_CANDIDATE_CUSTODY_INTENT,
  canonicalAtendimentoConfirmedProjectionProductionCandidateCustodyEvidence,
  createAtendimentoConfirmedProjectionProductionCandidateCustodyVerifier,
  digestAtendimentoConfirmedProjectionProductionCandidateCustodyEvidence,
  __testables,
} from '../confirmedProjectionProductionCandidateCustody.js'
import {
  ATENDIMENTO_CONFIRMED_PROJECTION_BASELINE_V2_READBACK_CONTRACT,
  ATENDIMENTO_CONFIRMED_PROJECTION_BASELINE_V2_RECEIPT_CONTRACT,
  acceptAtendimentoConfirmedProjectionBaselineV2,
  createAtendimentoConfirmedProjectionBaselineV2Backfill,
  createAtendimentoConfirmedProjectionBaselineV2Batch,
  createAtendimentoConfirmedProjectionBaselineV2Prepared,
  createAtendimentoConfirmedProjectionBaselineV2Snapshot,
  createAtendimentoConfirmedProjectionBaselineV2Source,
  digestAtendimentoConfirmedProjectionBaselineV2,
  digestAtendimentoConfirmedProjectionBaselineV2Batch,
  markAtendimentoConfirmedProjectionBaselineV2Ready,
} from '../../../../../shared/crm-auth/atendimentoConfirmedProjectionBaselineV2.js'
import {
  digestAtendimentoConfirmedProjectionDeltaV2SourceProfile,
} from '../../../../../shared/crm-auth/atendimentoConfirmedProjectionDeltaV2.js'
import {
  ATENDIMENTO_CRM_CORE_IDENTITY_SOURCE_SEMANTICS_VERSION,
  ATENDIMENTO_CRM_CORE_ISOLATED_IDENTITY_PROJECTION_SOURCE_RELATIONS,
} from '../../../../../shared/crm-auth/atendimentoCrmCoreIdentityMaterializationPolicy.js'

const NOW = new Date('2026-09-15T12:00:00.000Z')
const KEY_ID = 'atendimento-production-custody-r1'
const SOURCE_SHA = 'a'.repeat(40)
const TARGET = Object.freeze({ environment: 'staging', release: 'b'.repeat(40), artifactDigest: `sha256:${'c'.repeat(64)}` })
const ROLLBACK_TARGET = Object.freeze({ environment: 'staging', release: 'd'.repeat(40), artifactDigest: `sha256:${'e'.repeat(64)}` })
const HMAC_KEY = `confirmed-production-candidate-test-${'x'.repeat(40)}`
const BASE64URL_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_'
const ROW = Object.freeze({
  identity_id: '22222222-2222-4222-8222-222222222222',
  unit_slug: 'jardins',
  observed_at: '2026-09-14T12:00:00.000000Z',
})

const { privateKey, publicKey } = generateKeyPairSync('ed25519')

function sha(char) {
  return `sha256:${char.repeat(64)}`
}

function readyBaseline() {
  const source = createAtendimentoConfirmedProjectionBaselineV2Source({
    owner: 'atendimento',
    scope: 'confirmed-unit-memberships/v5',
    baselineKeyId: 'crm-staging-atendimento-confirmed-baseline-v2-1',
    deltaKeyId: 'crm-staging-atendimento-confirmed-delta-v2-1',
    identityHmacKey: HMAC_KEY,
    unitAllowlist: ['jardins'],
  })
  const { snapshot } = createAtendimentoConfirmedProjectionBaselineV2Snapshot({ rows: [ROW], capturedAt: '2026-09-14T12:01:00.000Z', watermark: 0 })
  const packet = createAtendimentoConfirmedProjectionBaselineV2Batch({ rows: [ROW], capturedAt: snapshot.capturedAt, hmacKey: HMAC_KEY, keyId: source.baselineKeyId, target: TARGET })
  const backfill = createAtendimentoConfirmedProjectionBaselineV2Backfill({
    batches: [{
      batchId: packet.batchId,
      batchDigest: digestAtendimentoConfirmedProjectionBaselineV2Batch(packet),
      capturedAt: packet.sourceSnapshot.capturedAt,
      cursorDigest: packet.sourceSnapshot.cursorDigest,
      fromOrdinal: 1,
      toOrdinal: 1,
      rowCount: 1,
      unitSlugs: packet.sourceSnapshot.unitSlugs,
      eventCount: 1,
    }],
    rowCount: 1,
    unitSlugs: ['jardins'],
  })
  const prepared = createAtendimentoConfirmedProjectionBaselineV2Prepared({ target: TARGET, source, snapshot, backfill })
  const accepted = acceptAtendimentoConfirmedProjectionBaselineV2(prepared, [{
    contractVersion: ATENDIMENTO_CONFIRMED_PROJECTION_BASELINE_V2_RECEIPT_CONTRACT,
    status: 'accepted',
    batchId: packet.batchId,
    eventCount: 1,
    sourceProfileDigest: digestAtendimentoConfirmedProjectionDeltaV2SourceProfile(),
    target: TARGET,
  }])
  return markAtendimentoConfirmedProjectionBaselineV2Ready(accepted, {
    contract: ATENDIMENTO_CONFIRMED_PROJECTION_BASELINE_V2_READBACK_CONTRACT,
    status: 'verified',
    manifestDigest: accepted.backfill.manifestDigest,
    membershipDigest: accepted.snapshot.membershipDigest,
    watermark: 0,
    verifiedBatchCount: 1,
    verifiedEventCount: 1,
    sourceProfileDigest: digestAtendimentoConfirmedProjectionDeltaV2SourceProfile(),
    target: TARGET,
  })
}

function cursorDigest(baseline) {
  // The verifier derives this from public baseline digests only; no source row
  // or HMAC value enters the signed custody input.
  return __testables.sourceCursorDigest(baseline)
}

function custodySnapshot(baseline) {
  const { capturedAt, membershipDigest, rowCount, watermark } = baseline.snapshot
  return { capturedAt, membershipDigest, rowCount, watermark }
}

function signed(kind, payload, { issuedAt = '2026-09-15T11:59:00.000Z', expiresAt = '2026-09-15T12:05:00.000Z' } = {}) {
  const unsigned = {
    contract: ATENDIMENTO_CONFIRMED_PROJECTION_PRODUCTION_CANDIDATE_CUSTODY_EVIDENCE_CONTRACT,
    kind,
    issuer: 'atendimento-production-custody',
    issuedAt,
    expiresAt,
    payload,
  }
  return {
    ...unsigned,
    signature: {
      algorithm: 'Ed25519',
      keyId: KEY_ID,
      valueBase64url: signEvidence(null, Buffer.from(canonicalAtendimentoConfirmedProjectionProductionCandidateCustodyEvidence(unsigned), 'utf8'), privateKey).toString('base64url'),
    },
  }
}

function resign(evidence) {
  return signed(evidence.kind, evidence.payload, {
    issuedAt: evidence.issuedAt,
    expiresAt: evidence.expiresAt,
  })
}

function nonCanonicalBase64urlSpelling(value) {
  const last = BASE64URL_ALPHABET.indexOf(value.at(-1))
  assert.notEqual(last, -1)
  assert.equal(last & 0b1111, 0, 'fixture signature must start from a canonical base64url spelling')
  return `${value.slice(0, -1)}${BASE64URL_ALPHABET[(last & 0b110000) | 1]}`
}

function candidateInput() {
  const baseline = readyBaseline()
  const baselineDigest = digestAtendimentoConfirmedProjectionBaselineV2(baseline)
  const fixtureCursorDigest = cursorDigest(baseline)
  const source = signed('source-identity', {
    domain: 'atendimento-client-memberships',
    sourceSha: SOURCE_SHA,
    sourceEnvironment: 'production',
    database: 'skincos_clientes_production',
    principal: 'crm_core_projection_exporter',
    sessionPrincipal: 'crm_core_projection_exporter',
    transaction: 'repeatable-read-read-only',
    sourceContract: 'atendimento/crm-core/unit-scoped-projection-source/v1',
    sourceSemantics: ATENDIMENTO_CRM_CORE_IDENTITY_SOURCE_SEMANTICS_VERSION,
    sourceProfileDigest: baseline.sourceProfile.digest,
    sourceRelationAllowlist: [...ATENDIMENTO_CRM_CORE_ISOLATED_IDENTITY_PROJECTION_SOURCE_RELATIONS],
    snapshot: custodySnapshot(baseline),
    credentialsIncluded: false,
    piiIncluded: false,
    rawIdentifiersIncluded: false,
  })
  const sourceDigest = digestAtendimentoConfirmedProjectionProductionCandidateCustodyEvidence(source)
  const cursor = signed('cursor', {
    domain: 'atendimento-client-memberships',
    sourceSha: SOURCE_SHA,
    baselineDigest,
    sourceEvidenceDigest: sourceDigest,
    cursorDigest: fixtureCursorDigest,
    manifestDigest: baseline.backfill.manifestDigest,
    snapshot: custodySnapshot(baseline),
    credentialsIncluded: false,
    piiIncluded: false,
    rawIdentifiersIncluded: false,
  })
  const cursorEvidenceDigest = digestAtendimentoConfirmedProjectionProductionCandidateCustodyEvidence(cursor)
  const checkpoint = signed('checkpoint', {
    domain: 'atendimento-client-memberships',
    sourceSha: SOURCE_SHA,
    baselineDigest,
    sourceEvidenceDigest: sourceDigest,
    cursorEvidenceDigest,
    cursorDigest: fixtureCursorDigest,
    checkpointDigest: sha('1'),
    state: 'sealed',
    credentialsIncluded: false,
    piiIncluded: false,
    rawIdentifiersIncluded: false,
  })
  const checkpointEvidenceDigest = digestAtendimentoConfirmedProjectionProductionCandidateCustodyEvidence(checkpoint)
  const reconciliation = signed('reconciliation', {
    domain: 'atendimento-client-memberships',
    sourceSha: SOURCE_SHA,
    baselineDigest,
    sourceEvidenceDigest: sourceDigest,
    cursorEvidenceDigest,
    checkpointEvidenceDigest,
    cursorDigest: fixtureCursorDigest,
    checkpointDigest: sha('1'),
    readbackDigest: __testables.digestValue(baseline.readback),
    verifiedBatchCount: 1,
    verifiedEventCount: 1,
    coreTarget: TARGET,
    state: 'verified',
    credentialsIncluded: false,
    piiIncluded: false,
    rawIdentifiersIncluded: false,
  })
  const reconciliationEvidenceDigest = digestAtendimentoConfirmedProjectionProductionCandidateCustodyEvidence(reconciliation)
  const rollback = signed('rollback', {
    domain: 'atendimento-client-memberships',
    sourceSha: SOURCE_SHA,
    baselineDigest,
    sourceEvidenceDigest: sourceDigest,
    cursorEvidenceDigest,
    checkpointEvidenceDigest,
    reconciliationEvidenceDigest,
    cursorDigest: fixtureCursorDigest,
    checkpointDigest: sha('1'),
    readbackDigest: __testables.digestValue(baseline.readback),
    coreTarget: TARGET,
    rollbackTarget: ROLLBACK_TARGET,
    strategy: 'disable-ingestion-preserve-ledger',
    smokeDigest: sha('3'),
    state: 'verified',
    credentialsIncluded: false,
    piiIncluded: false,
    rawIdentifiersIncluded: false,
  })
  return {
    intent: ATENDIMENTO_CONFIRMED_PROJECTION_PRODUCTION_CANDIDATE_CUSTODY_INTENT,
    sourceSha: SOURCE_SHA,
    baseline,
    evidence: [source, cursor, checkpoint, reconciliation, rollback],
  }
}

function verifier() {
  return createAtendimentoConfirmedProjectionProductionCandidateCustodyVerifier({
    custodyKeyId: KEY_ID,
    custodyPublicKey: publicKey,
    now: NOW,
  })
}

test('has no source, network, environment, or mutation capability', async () => {
  const helperPath = fileURLToPath(new URL('../confirmedProjectionProductionCandidateCustody.js', import.meta.url))
  const source = await readFile(helperPath, 'utf8')
  assert.doesNotMatch(source, /node:(?:fs|net|http|https|child_process)/)
  assert.doesNotMatch(source, /process\.env|\.connect\(|\bfetch\s*\(/)
})

test('validates a signed, staging-reconciled production-source candidate while disabling every execution capability', () => {
  const input = candidateInput()
  const candidate = verifier().prepare(input)
  assert.equal(candidate.state, 'candidate-validated-no-execution')
  assert.equal(candidate.source.environment, 'production')
  assert.equal(candidate.target.environment, 'staging')
  assert.equal(candidate.execution.sourceReadAllowed, false)
  assert.equal(candidate.execution.deliveryAllowed, false)
  assert.equal(candidate.execution.productionMutationAllowed, false)
  assert.equal(candidate.execution.publicRouteMutationAllowed, false)
  assert.equal(candidate.execution.legacyPublisherMutationAllowed, false)
  assert.equal(candidate.privacy.piiIncluded, false)
  assert.match(candidate.candidateDigest, /^sha256:[a-f0-9]{64}$/)
  assert.equal(JSON.stringify(candidate).includes(ROW.identity_id), false)
})

test('rejects a non-Atendimento domain even when its evidence has a valid external signature', () => {
  const input = candidateInput()
  input.evidence[0] = resign({
    ...input.evidence[0],
    payload: { ...input.evidence[0].payload, domain: 'finance' },
  })
  assert.throws(() => verifier().prepare(input), /SOURCE_IDENTITY_EVIDENCE_INVALID/)
})

test('rejects PII claims, stale evidence, and a tampered detached signature before emitting a candidate', () => {
  const pii = candidateInput()
  pii.evidence[0] = resign({
    ...pii.evidence[0],
    payload: { ...pii.evidence[0].payload, piiIncluded: true },
  })
  assert.throws(() => verifier().prepare(pii), /SOURCE_IDENTITY_EVIDENCE_INVALID/)

  const stale = candidateInput()
  stale.evidence[0] = signed('source-identity', stale.evidence[0].payload, {
    issuedAt: '2026-09-15T11:00:00.000Z',
    expiresAt: '2026-09-15T11:10:00.000Z',
  })
  assert.throws(() => verifier().prepare(stale), /EVIDENCE_TIME_INVALID/)

  const tampered = candidateInput()
  tampered.evidence[0] = {
    ...tampered.evidence[0],
    signature: { ...tampered.evidence[0].signature, valueBase64url: 'A'.repeat(86) },
  }
  assert.throws(() => verifier().prepare(tampered), /EVIDENCE_SIGNATURE_INVALID/)
})

test('rejects a valid Ed25519 signature when its base64url spelling is noncanonical', () => {
  const input = candidateInput()
  const canonical = input.evidence[0].signature.valueBase64url
  const nonCanonical = nonCanonicalBase64urlSpelling(canonical)
  assert.notEqual(nonCanonical, canonical)
  assert.deepEqual(Buffer.from(nonCanonical, 'base64url'), Buffer.from(canonical, 'base64url'))
  input.evidence[0] = {
    ...input.evidence[0],
    signature: { ...input.evidence[0].signature, valueBase64url: nonCanonical },
  }
  assert.throws(() => verifier().prepare(input), /EVIDENCE_SIGNATURE_INVALID/)
})

test('requires the signed checkpoint, reconciliation and rollback chain to stay anchored to the same source snapshot', () => {
  const input = candidateInput()
  input.evidence[2] = resign({
    ...input.evidence[2],
    payload: { ...input.evidence[2].payload, checkpointDigest: sha('4') },
  })
  assert.throws(() => verifier().prepare(input), /RECONCILIATION_EVIDENCE_INVALID/)

  const noRollback = candidateInput()
  noRollback.evidence[4] = resign({
    ...noRollback.evidence[4],
    payload: { ...noRollback.evidence[4].payload, rollbackTarget: TARGET },
  })
  assert.throws(() => verifier().prepare(noRollback), /ROLLBACK_EVIDENCE_INVALID/)
})
