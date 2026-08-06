import test from 'node:test'
import assert from 'node:assert/strict'
import {
    assertCanaryMutationPayload,
    candidateEligibility,
    hashIdentitySet,
    maskIdentityName,
    summarizeCommercialCanaryCandidates,
} from '../commercialCanaryDomain.js'

test('masks selector results without exposing the canonical name', () => {
    const masked = maskIdentityName('Ana Beatriz Synthetic')
    assert.equal(masked, 'A••a B•••••z S•••••c')
    assert.doesNotMatch(masked, /Ana|Beatriz|Synthetic/)
})

test('summarizes a canary preview with blocked, review, stale and expiry signals', () => {
    const candidates = [
        { identityId: 'a', validationStatus: 'explicit_approved', freshnessStatus: 'healthy', contactStatus: 'eligible', hasPhone: true, identityQuality: 'confirmed_multi_source', expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString() },
        { identityId: 'b', validationStatus: 'explicit_approved', freshnessStatus: 'stale', contactStatus: 'blocked', hasPhone: false, identityQuality: 'unresolved_single_source' },
        { identityId: 'c', validationStatus: 'not_validated', freshnessStatus: 'healthy', contactStatus: 'review', hasPhone: false, identityQuality: 'unresolved_single_source' },
    ]
    const summary = summarizeCommercialCanaryCandidates(candidates)
    assert.equal(summary.totalCohort, 3)
    assert.equal(summary.eligible, 1)
    assert.equal(summary.blocked, 1)
    assert.equal(summary.inReview, 1)
    assert.equal(summary.permissionsExpiring, 1)
    assert.equal(summary.phonesUncorrelated, 2)
    assert.equal(summary.staleSources, 1)
    assert.equal(summary.pendingIdentityDecisions, 2)
    assert.equal(summary.canApply, false)
    assert.equal(candidateEligibility(candidates[0]).status, 'eligible')
})

test('deduplication is stable and mutation payloads require explicit audit intent', () => {
    assert.equal(hashIdentitySet(['B', 'a', 'a']), hashIdentitySet(['a', 'B']))
    assert.throws(() => assertCanaryMutationPayload({ expectedPolicyVersion: 'a'.repeat(32), confirm: true, idempotencyKey: 'x' }), /JUSTIFICATION_REQUIRED/)
    assert.throws(() => assertCanaryMutationPayload({ justification: 'Motivo operacional válido', expectedPolicyVersion: 'a'.repeat(32), idempotencyKey: 'x' }), /CONFIRMATION_REQUIRED/)
    assert.deepEqual(assertCanaryMutationPayload({ justification: 'Motivo operacional válido', expectedPolicyVersion: 'a'.repeat(32), confirm: true, idempotencyKey: 'x' }), {
        justification: 'Motivo operacional válido', expectedPolicyVersion: 'a'.repeat(32), idempotencyKey: 'x',
    })
})
