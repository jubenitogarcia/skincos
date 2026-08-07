import test from 'node:test'
import assert from 'node:assert/strict'

import {
    canaryOpaqueIdentityHash,
    commercialCanaryApplyAllowed,
    createCommercialCanaryCandidateCodec,
    maskCanaryDisplayName,
    normalizeCanaryJustification,
    summarizeCommercialCanaryCandidates,
} from '../commercialCanaryDomain.js'

const secret = 'selector-test-secret-that-is-long-enough-to-be-safe-123456'
const identityId = '4bd4ef58-66a2-4e57-a818-fd482d241101'

test('candidate references are opaque, unit-bound and expire instead of exposing a UUID', () => {
    let now = 1_700_000_000_000
    const codec = createCommercialCanaryCandidateCodec(secret, { now: () => now, ttlMs: 1_000 })
    const reference = codec.encode({ identityId, unit: 'centro' })

    assert.equal(reference.includes(identityId), false)
    assert.deepEqual(codec.decode(reference), { identityId, unit: 'centro', issuedAt: now })
    now += 1_001
    assert.throws(() => codec.decode(reference), /COMMERCIAL_CANARY_CANDIDATE_EXPIRED/)
})

test('candidate references reject a truncated GCM authentication tag', () => {
    const codec = createCommercialCanaryCandidateCodec(secret)
    const reference = codec.encode({ identityId, unit: 'centro' })
    const bytes = Buffer.from(reference, 'base64url')
    const truncatedTag = Buffer.concat([bytes.subarray(0, 12), bytes.subarray(12, 27), bytes.subarray(28)])
    assert.throws(() => codec.decode(truncatedTag.toString('base64url')), /COMMERCIAL_CANARY_CANDIDATE_INVALID/)
})

test('masking and justification validation avoid PII in the operational surface', () => {
    const masked = maskCanaryDisplayName('Maria da Silva')
    assert.equal(masked.includes('Maria'), false)
    assert.match(masked, /M•+/)
    assert.equal(normalizeCanaryJustification('Validacao sintetica controlada pela equipe.'), 'Validacao sintetica controlada pela equipe.')
    assert.throws(() => normalizeCanaryJustification('Cliente maria@example.com foi escolhido.'), /COMMERCIAL_CANARY_JUSTIFICATION_INVALID/)
    assert.throws(() => normalizeCanaryJustification('Telefone 11987654321 foi escolhido.'), /COMMERCIAL_CANARY_JUSTIFICATION_INVALID/)
    assert.match(canaryOpaqueIdentityHash(secret, identityId), /^[a-f0-9]{64}$/)
})

test('a cohort is applicable only when every member is validated, healthy and eligible', () => {
    const healthy = {
        eligibility: 'eligible', permissionStatus: 'granted', phoneStatus: 'correlated', optOut: 'not_recorded',
        freshness: 'healthy', identityQuality: 'confirmed_multi_source', validationStatus: 'valid',
    }
    const summary = summarizeCommercialCanaryCandidates([healthy, healthy])
    assert.equal(summary.eligible, 2)
    assert.equal(summary.impact.commercialWritesEnabled, false)
    assert.equal(summary.impact.messagesSent, 0)
    assert.equal(commercialCanaryApplyAllowed(summary), true)

    const stale = summarizeCommercialCanaryCandidates([{ ...healthy, freshness: 'stale', eligibility: 'review_required' }])
    assert.equal(stale.staleSources, 1)
    assert.equal(commercialCanaryApplyAllowed(stale), false)
})
