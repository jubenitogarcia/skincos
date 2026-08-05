import test from 'node:test'
import assert from 'node:assert/strict'

import {
    chooseIdentitySurvivor,
    identityMaterializationFingerprint,
    normalizeIdentityReviewDecision,
    normalizeIdentityReviewUndo,
    reviewComponentKey,
} from '../identityReviewWorkflow.js'

test('normalizes a reviewed name-merge confirmation with an explicit survivor', () => {
    const decision = normalizeIdentityReviewDecision({
        reviewType: 'attendance_name_merge',
        sourceId: ' client-left ',
        targetId: 'client-right ',
        decision: ' CONFIRMED ',
        expectedVersion: ' version-1 ',
        reason: '  Caixa confirma   a mesma pessoa. ',
        survivorClientId: ' client-right ',
    })

    assert.deepEqual(decision, {
        reviewType: 'attendance_name_merge',
        sourceId: 'client-left',
        targetId: 'client-right',
        decision: 'confirmed',
        expectedVersion: 'version-1',
        reason: 'Caixa confirma a mesma pessoa.',
        survivorClientId: 'client-right',
    })
})

test('rejects malformed review decisions before any persistence boundary', () => {
    const valid = {
        reviewType: 'attendance_caixa',
        sourceId: 'attendance-client-1',
        targetId: 'caixa-customer-1',
        decision: 'confirmed',
        expectedVersion: 'version-1',
        reason: 'Correspondência confirmada.',
    }

    assert.throws(() => normalizeIdentityReviewDecision({ ...valid, reviewType: 'unknown' }), /INVALID_IDENTITY_REVIEW_TYPE/)
    assert.throws(() => normalizeIdentityReviewDecision({ ...valid, targetId: valid.sourceId }), /INVALID_IDENTITY_REVIEW_REFERENCE/)
    assert.throws(() => normalizeIdentityReviewDecision({ ...valid, decision: 'undo' }), /INVALID_IDENTITY_REVIEW_DECISION/)
    assert.throws(() => normalizeIdentityReviewDecision({ ...valid, expectedVersion: '' }), /IDENTITY_REVIEW_VERSION_REQUIRED/)
    assert.throws(() => normalizeIdentityReviewDecision({ ...valid, expectedVersion: 'v'.repeat(201) }), /IDENTITY_REVIEW_VERSION_REQUIRED/)
    assert.throws(() => normalizeIdentityReviewDecision({ ...valid, reason: 'ok' }), /IDENTITY_REVIEW_REASON_REQUIRED/)
})

test('requires a valid survivor only for confirmed Atendimento spelling merges', () => {
    const merge = {
        reviewType: 'attendance_name_merge',
        sourceId: 'client-left',
        targetId: 'client-right',
        decision: 'confirmed',
        expectedVersion: 'version-1',
        reason: 'Revisão humana confirmou o vínculo.',
    }

    assert.throws(() => normalizeIdentityReviewDecision(merge), /IDENTITY_REVIEW_SURVIVOR_REQUIRED/)
    assert.throws(() => normalizeIdentityReviewDecision({ ...merge, survivorClientId: 'other-client' }), /IDENTITY_REVIEW_SURVIVOR_REQUIRED/)
    assert.throws(() => normalizeIdentityReviewDecision({ ...merge, decision: 'rejected', survivorClientId: 'client-left' }), /IDENTITY_REVIEW_SURVIVOR_NOT_ALLOWED/)
    assert.throws(() => normalizeIdentityReviewDecision({
        ...merge,
        reviewType: 'attendance_caixa',
        survivorClientId: 'client-left',
    }), /IDENTITY_REVIEW_SURVIVOR_NOT_ALLOWED/)
})

test('normalizes undo with the same bounded version and reason safeguards', () => {
    const undo = normalizeIdentityReviewUndo({
        type: 'lead_app',
        sourceId: ' lead-1 ',
        targetId: ' app-1 ',
        expectedVersion: ' version-2 ',
        reason: ' Evidência corrigida após revisão. ',
    })

    assert.deepEqual(undo, {
        reviewType: 'lead_app',
        sourceId: 'lead-1',
        targetId: 'app-1',
        expectedVersion: 'version-2',
        reason: 'Evidência corrigida após revisão.',
    })
    assert.throws(() => normalizeIdentityReviewUndo({ ...undo, sourceId: undo.targetId }), /INVALID_IDENTITY_REVIEW_REFERENCE/)
    assert.throws(() => normalizeIdentityReviewUndo({ ...undo, reason: 'x' }), /IDENTITY_REVIEW_REASON_REQUIRED/)
})

test('builds deterministic materialization fingerprints without relying on object key order', () => {
    const first = identityMaterializationFingerprint({
        members: [{ sourceId: 'customer-1', sourceType: 'caixa_customer' }],
        reviewedAt: new Date('2026-08-05T12:00:00.000Z'),
        decision: 'confirmed',
    })
    const reordered = identityMaterializationFingerprint({
        decision: 'confirmed',
        reviewedAt: new Date('2026-08-05T12:00:00.000Z'),
        members: [{ sourceType: 'caixa_customer', sourceId: 'customer-1' }],
    })
    const changed = identityMaterializationFingerprint({
        decision: 'rejected',
        reviewedAt: new Date('2026-08-05T12:00:00.000Z'),
        members: [{ sourceType: 'caixa_customer', sourceId: 'customer-1' }],
    })

    assert.match(first, /^[a-f0-9]{64}$/)
    assert.equal(first, reordered)
    assert.notEqual(first, changed)
})

test('chooses an attendance-backed survivor, then oldest identity, then stable id', () => {
    assert.equal(chooseIdentitySurvivor([]), null)
    assert.equal(chooseIdentitySurvivor([
        { id: 'caixa-only', createdAt: '2025-01-01T00:00:00.000Z', members: [{ sourceType: 'caixa_customer' }] },
        { id: 'attendance-newer', createdAt: '2026-01-01T00:00:00.000Z', members: [{ sourceType: 'attendance_client' }] },
    ])?.id, 'attendance-newer')
    assert.equal(chooseIdentitySurvivor([
        { id: 'later', createdAt: '2026-01-02T00:00:00.000Z', members: [{ sourceType: 'attendance_client' }] },
        { id: 'earlier', createdAt: '2026-01-01T00:00:00.000Z', members: [{ sourceType: 'attendance_client' }] },
    ])?.id, 'earlier')
    assert.equal(chooseIdentitySurvivor([
        { id: 'z-id', createdAt: '2026-01-01T00:00:00.000Z', members: [] },
        { id: 'a-id', createdAt: '2026-01-01T00:00:00.000Z', members: [] },
    ])?.id, 'a-id')
})

test('sorts identity component membership into a stable key', () => {
    assert.equal(reviewComponentKey([
        { sourceType: 'caixa_customer', sourceId: 'customer-1' },
        { sourceType: 'attendance_client', sourceId: 'client-1' },
    ]), 'attendance_client:client-1|caixa_customer:customer-1')
})
