import { createHash } from 'node:crypto'

// This artifact is intentionally separate from the legacy identity-review
// workflow. It carries only explicitly reviewed UUID links and opaque digests;
// it does not discover, persist, or deliver any relationship.
export const ATENDIMENTO_CRM_CORE_IDENTITY_REVIEW_BATCH_CONTRACT = 'atendimento/crm-core/identity-review-batch/v1'

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const SHA256_PATTERN = /^sha256:[a-f0-9]{64}$/
const REVIEWER_KEY_ID_PATTERN = /^[A-Za-z0-9._-]{3,96}$/
const UTC_TIMESTAMP_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/

function fail(code) {
  throw new Error(`ATENDIMENTO_CRM_CORE_IDENTITY_REVIEW_BATCH_INVALID:${code}`)
}

function object(value, code) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail(code)
  return value
}

function exactKeys(value, keys, code) {
  const actual = Object.keys(value).sort()
  const expected = [...keys].sort()
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) fail(code)
}

function text(value, code) {
  const normalized = String(value || '').trim()
  if (!normalized) fail(code)
  return normalized
}

function uuid(value, code) {
  const normalized = text(value, code).toLowerCase()
  if (!UUID_PATTERN.test(normalized)) fail(code)
  return normalized
}

function digest(value, code) {
  const normalized = text(value, code).toLowerCase()
  if (!SHA256_PATTERN.test(normalized)) fail(code)
  return normalized
}

function positiveInteger(value, code) {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1) fail(code)
  return value
}

function reviewedAt(value) {
  const normalized = text(value, 'REVIEWED_AT_INVALID')
  if (!UTC_TIMESTAMP_PATTERN.test(normalized)) fail('REVIEWED_AT_INVALID')
  const parsed = new Date(normalized)
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString() !== normalized) fail('REVIEWED_AT_INVALID')
  return normalized
}

function review(value) {
  const candidate = object(value, 'REVIEW_INVALID')
  exactKeys(candidate, ['owner', 'decision', 'reviewerKeyId', 'reviewedAt'], 'REVIEW_SHAPE_INVALID')
  const owner = text(candidate.owner, 'REVIEW_INVALID')
  const decision = text(candidate.decision, 'REVIEW_INVALID')
  const reviewerKeyId = text(candidate.reviewerKeyId, 'REVIEWER_KEY_ID_INVALID')
  if (owner !== 'atendimento' || decision !== 'approved' || !REVIEWER_KEY_ID_PATTERN.test(reviewerKeyId)) {
    fail('REVIEW_INVALID')
  }
  return Object.freeze({
    owner,
    decision,
    reviewerKeyId,
    reviewedAt: reviewedAt(candidate.reviewedAt),
  })
}

function link(value) {
  const candidate = object(value, 'LINK_INVALID')
  exactKeys(candidate, ['attendanceId', 'canonicalClientId', 'status', 'method', 'evidenceDigest', 'sourceRevision'], 'LINK_SHAPE_INVALID')
  const status = text(candidate.status, 'LINK_STATUS_INVALID')
  const method = text(candidate.method, 'LINK_METHOD_INVALID')
  if (status !== 'confirmed') fail('LINK_STATUS_INVALID')
  if (method !== 'reviewed_reconciliation') fail('LINK_METHOD_INVALID')
  return Object.freeze({
    attendanceId: uuid(candidate.attendanceId, 'ATTENDANCE_ID_INVALID'),
    canonicalClientId: uuid(candidate.canonicalClientId, 'CANONICAL_CLIENT_ID_INVALID'),
    status,
    method,
    evidenceDigest: digest(candidate.evidenceDigest, 'EVIDENCE_DIGEST_INVALID'),
    sourceRevision: positiveInteger(candidate.sourceRevision, 'SOURCE_REVISION_INVALID'),
  })
}

function links(value) {
  if (!Array.isArray(value) || value.length === 0) fail('LINK_COLLECTION_INVALID')
  const normalized = value.map(link).sort((left, right) => (
    left.attendanceId.localeCompare(right.attendanceId)
    || left.canonicalClientId.localeCompare(right.canonicalClientId)
    || left.evidenceDigest.localeCompare(right.evidenceDigest)
    || left.sourceRevision - right.sourceRevision
  ))
  const attendanceIds = new Set()
  for (const entry of normalized) {
    if (attendanceIds.has(entry.attendanceId)) fail('DUPLICATE_ATTENDANCE_ID')
    attendanceIds.add(entry.attendanceId)
  }
  return Object.freeze(normalized)
}

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize)
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonicalize(value[key])]))
  }
  return value
}

function sha256(value) {
  return `sha256:${createHash('sha256').update(JSON.stringify(canonicalize(value))).digest('hex')}`
}

/**
 * Validates and normalizes a human-reviewed, UUID-only handoff. Validation is
 * source-only: it cannot prove the review, grant a role, or mutate runtime data.
 */
export function assertAtendimentoCrmCoreIdentityReviewBatch(value) {
  const candidate = object(value, 'BATCH_INVALID')
  exactKeys(candidate, ['contract', 'batchId', 'runId', 'review', 'links'], 'BATCH_SHAPE_INVALID')
  if (candidate.contract !== ATENDIMENTO_CRM_CORE_IDENTITY_REVIEW_BATCH_CONTRACT) fail('CONTRACT_INVALID')
  return Object.freeze({
    contract: ATENDIMENTO_CRM_CORE_IDENTITY_REVIEW_BATCH_CONTRACT,
    batchId: uuid(candidate.batchId, 'BATCH_ID_INVALID'),
    runId: uuid(candidate.runId, 'RUN_ID_INVALID'),
    review: review(candidate.review),
    links: links(candidate.links),
  })
}

/**
 * Produces a deterministic content fingerprint after normalization. The digest
 * is tamper evidence only; custody still has to verify the actual reviewer.
 */
export function digestAtendimentoCrmCoreIdentityReviewBatch(value) {
  return sha256(assertAtendimentoCrmCoreIdentityReviewBatch(value))
}

/**
 * Narrows a valid handoff to the exact, future opt-in writer input. It neither
 * imports nor invokes that writer, so no call can occur as a side effect.
 */
export function toAtendimentoCrmCoreIdentityMaterializationRequest(value) {
  const batch = assertAtendimentoCrmCoreIdentityReviewBatch(value)
  return Object.freeze({
    runId: batch.runId,
    links: batch.links,
  })
}
