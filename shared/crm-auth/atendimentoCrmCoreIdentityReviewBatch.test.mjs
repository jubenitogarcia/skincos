import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

import {
  ATENDIMENTO_CRM_CORE_IDENTITY_REVIEW_BATCH_CONTRACT,
  assertAtendimentoCrmCoreIdentityReviewBatch,
  digestAtendimentoCrmCoreIdentityReviewBatch,
  toAtendimentoCrmCoreIdentityMaterializationRequest,
} from './atendimentoCrmCoreIdentityReviewBatch.js'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const fixturePath = path.join(root, 'docs/extraction/atendimento-crm-core-identity-review-batch.synthetic.json')
const modulePath = path.join(root, 'shared/crm-auth/atendimentoCrmCoreIdentityReviewBatch.js')

function fixture() {
  return JSON.parse(readFileSync(fixturePath, 'utf8'))
}

test('accepts a synthetic reviewed UUID-only batch and normalizes it deterministically', () => {
  const batch = assertAtendimentoCrmCoreIdentityReviewBatch(fixture())
  assert.equal(batch.contract, ATENDIMENTO_CRM_CORE_IDENTITY_REVIEW_BATCH_CONTRACT)
  assert.equal(batch.review.owner, 'atendimento')
  assert.equal(batch.review.decision, 'approved')
  assert.equal(batch.links.length, 2)
  assert.equal(batch.links[0].attendanceId, '20000000-0000-4000-8000-000000000001')
  assert.equal(batch.links[0].canonicalClientId, '30000000-0000-4000-8000-000000000001')
  assert.equal(Object.isFrozen(batch), true)
  assert.equal(Object.isFrozen(batch.links), true)
  assert.equal(Object.isFrozen(batch.links[0]), true)
})

test('digest is stable across equivalent link ordering and text casing', () => {
  const ordered = fixture()
  const reordered = fixture()
  reordered.links.reverse()
  reordered.links[0].attendanceId = reordered.links[0].attendanceId.toUpperCase()
  reordered.links[0].evidenceDigest = reordered.links[0].evidenceDigest.toUpperCase()
  assert.equal(
    digestAtendimentoCrmCoreIdentityReviewBatch(ordered),
    digestAtendimentoCrmCoreIdentityReviewBatch(reordered),
  )
})

test('narrows a valid batch to the exact future writer request without invoking a writer', () => {
  const batch = fixture()
  const request = toAtendimentoCrmCoreIdentityMaterializationRequest(batch)
  assert.deepEqual(Object.keys(request).sort(), ['links', 'runId'])
  assert.equal(request.runId, '10000000-0000-4000-8000-000000000002')
  assert.equal(request.links.length, 2)
  assert.deepEqual(request.links[0], assertAtendimentoCrmCoreIdentityReviewBatch(batch).links[0])
})

test('rejects names, aliases, free text, duplicate attendance ids, and non-reviewed link states', () => {
  const withName = fixture()
  withName.links[0].clientName = 'not-permitted'
  assert.throws(() => assertAtendimentoCrmCoreIdentityReviewBatch(withName), /LINK_SHAPE_INVALID/)

  const withEmailReviewer = fixture()
  withEmailReviewer.review.reviewerKeyId = 'reviewer@example.com'
  assert.throws(() => assertAtendimentoCrmCoreIdentityReviewBatch(withEmailReviewer), /REVIEW_INVALID/)

  const duplicate = fixture()
  duplicate.links[1].attendanceId = duplicate.links[0].attendanceId
  assert.throws(() => assertAtendimentoCrmCoreIdentityReviewBatch(duplicate), /DUPLICATE_ATTENDANCE_ID/)

  const rejected = fixture()
  rejected.links[0].status = 'rejected'
  assert.throws(() => assertAtendimentoCrmCoreIdentityReviewBatch(rejected), /LINK_STATUS_INVALID/)

  const automatic = fixture()
  automatic.links[0].method = 'stable_source_reference'
  assert.throws(() => assertAtendimentoCrmCoreIdentityReviewBatch(automatic), /LINK_METHOD_INVALID/)
})

test('rejects malformed identifiers, evidence, revisions, and timestamps', () => {
  const invalidAttendanceId = fixture()
  invalidAttendanceId.links[0].attendanceId = 'name-derived'
  assert.throws(() => assertAtendimentoCrmCoreIdentityReviewBatch(invalidAttendanceId), /ATTENDANCE_ID_INVALID/)

  const invalidDigest = fixture()
  invalidDigest.links[0].evidenceDigest = 'evidence text is forbidden'
  assert.throws(() => assertAtendimentoCrmCoreIdentityReviewBatch(invalidDigest), /EVIDENCE_DIGEST_INVALID/)

  const invalidRevision = fixture()
  invalidRevision.links[0].sourceRevision = '1'
  assert.throws(() => assertAtendimentoCrmCoreIdentityReviewBatch(invalidRevision), /SOURCE_REVISION_INVALID/)

  const invalidTimestamp = fixture()
  invalidTimestamp.review.reviewedAt = '2026-09-15T12:00:00Z'
  assert.throws(() => assertAtendimentoCrmCoreIdentityReviewBatch(invalidTimestamp), /REVIEWED_AT_INVALID/)
})

test('shared validator has no database, network, filesystem, environment, or writer import', () => {
  const source = readFileSync(modulePath, 'utf8')
  assert.match(source, /node:crypto/)
  assert.doesNotMatch(source, /node:(?:fs|net|http|https|child_process|process|pg)/)
  assert.doesNotMatch(source, /process\.env|\bfetch\s*\(|materializeAtendimentoCrmCoreIdentityLinks/)
})
