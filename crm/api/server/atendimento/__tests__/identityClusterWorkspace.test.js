import test from 'node:test'
import assert from 'node:assert/strict'

import {
    IDENTITY_CLUSTER_PRESENTATION_SCHEMA,
    assertIdentityClusterConfirmation,
    buildIdentityClusterBulkPreview,
    buildIdentityReviewClusterPresentation,
    explicitRevealFields,
    identityClusterSourceFreshness,
} from '../identityClusterWorkspace.js'

const members = [
    {
        sourceType: 'attendance_client',
        sourceId: 'attendance-a',
        identityId: 'identity-a',
        identityName: 'Ana Sintética',
        name: 'Ana Sintética',
        units: ['novo-hamburgo'],
        aliases: ['Ana S.'],
        updatedAt: '2026-08-07T10:00:00.000Z',
        sourceFreshness: 'current',
        sourceFingerprint: 'attendance-fp',
    },
    {
        sourceType: 'app_registration',
        sourceId: 'app-a',
        identityId: '',
        name: 'Ana Sintética',
        units: ['novo-hamburgo'],
        phoneKeys: ['5551999991111'],
        emailKeys: ['ana.synthetic@example.test'],
        updatedAt: '2026-08-07T10:00:00.000Z',
        sourceFreshness: 'current',
        sourceFingerprint: 'app-fp',
    },
    {
        sourceType: 'caixa_customer',
        sourceId: 'caixa-a',
        identityId: 'identity-b',
        identityName: 'Ana Caixa',
        name: 'Ana Sintética',
        units: ['novo-hamburgo'],
        phoneKeys: ['5551999991111'],
        updatedAt: '2026-08-07T10:00:00.000Z',
        sourceFreshness: 'current',
        sourceFingerprint: 'caixa-fp',
    },
]

const edges = [
    {
        reviewType: 'app_attendance',
        sourceType: 'app_registration',
        sourceId: 'app-a',
        targetType: 'attendance_client',
        targetId: 'attendance-a',
        status: 'suggested',
        confidence: 0.99,
        method: 'exact_phone',
        matchedFields: ['phone'],
        sharedUnits: ['novo-hamburgo'],
        candidateCount: 1,
        validatedMatch: true,
        sourceVersion: 'edge-one',
    },
    {
        reviewType: 'app_caixa',
        sourceType: 'app_registration',
        sourceId: 'app-a',
        targetType: 'caixa_customer',
        targetId: 'caixa-a',
        status: 'suggested',
        confidence: 0.98,
        method: 'exact_phone',
        matchedFields: ['phone'],
        sharedUnits: ['novo-hamburgo'],
        candidateCount: 1,
        validatedMatch: true,
        sourceVersion: 'edge-two',
    },
]

test('builds a transitive, explicit and masked cluster without technical identifiers', () => {
    const clusters = buildIdentityReviewClusterPresentation({ members, edges })
    assert.equal(clusters.length, 1)
    const cluster = clusters[0]
    assert.equal(cluster.schemaVersion, IDENTITY_CLUSTER_PRESENTATION_SCHEMA)
    assert.equal(cluster.summary.memberCount, 3)
    assert.equal(cluster.summary.identityCount, 2)
    assert.equal(cluster.bulkReview.eligible, true)
    assert.deepEqual(cluster.privacy, { contactsMasked: true, technicalIdsHidden: true, revealRequired: true })
    const serialized = JSON.stringify(cluster)
    assert.doesNotMatch(serialized, /5551999991111|ana.synthetic@example.test|identity-a|attendance-a/)
    assert.match(serialized, /55••••11/)
    assert.match(serialized, /a•••@e•••/)
    assert.equal(cluster.evidence.strong.every((entry) => Object.hasOwn(entry, 'summary') && !Object.hasOwn(entry, 'context')), true)
})

test('fails closed for unit scope, stale evidence, strong conflicts and prior decisions', () => {
    assert.equal(buildIdentityReviewClusterPresentation({ members, edges, unitScope: ['barra-shopping-sul'] }).length, 0)
    const stale = buildIdentityReviewClusterPresentation({ members: members.map((member, index) => index === 0 ? { ...member, sourceFreshness: 'stale' } : member), edges })[0]
    assert.equal(stale.bulkReview.eligible, false)
    assert.ok(stale.bulkReview.reasons.includes('source_stale_or_changed_after_decision'))
    const conflict = buildIdentityReviewClusterPresentation({ members: members.map((member, index) => index === 2 ? { ...member, phoneKeys: ['5551888882222'] } : member), edges })[0]
    assert.ok(conflict.bulkReview.reasons.includes('strong_conflict'))
    const decided = buildIdentityReviewClusterPresentation({
        members,
        edges,
        decisions: [{ reviewType: 'app_attendance', sourceId: 'app-a', targetId: 'attendance-a', decision: 'confirmed', sourceVersion: 'edge-one', createdAt: '2026-08-07T09:00:00.000Z' }],
    })[0]
    assert.ok(decided.bulkReview.reasons.includes('incompatible_prior_decision'))
})

test('uses durable complete source-operation checkpoints rather than member timestamps', () => {
    const now = new Date('2026-08-07T12:00:00.000Z')
    const checkpoint = {
        lastStatus: 'complete',
        validatedSnapshotComplete: true,
        reconciliationRequired: false,
        validatedAt: '2026-08-07T11:00:00.000Z',
    }
    const current = {
        'atendimento.local_mirror': checkpoint,
        'atendimento.google_sheet': checkpoint,
        'vendas.caixa_google_sheet': checkpoint,
        'cadastro.app_registrations': checkpoint,
        'leads.supplemental_google_sheet': checkpoint,
        'identity.global_graph': checkpoint,
    }
    assert.equal(identityClusterSourceFreshness('attendance_client', current, now), 'current')
    assert.equal(identityClusterSourceFreshness('attendance_client', { ...current, 'atendimento.google_sheet': undefined }, now), 'unknown')
    assert.equal(identityClusterSourceFreshness('caixa_customer', {
        ...current,
        'vendas.caixa_google_sheet': { ...checkpoint, validatedSnapshotComplete: false },
    }, now), 'stale')
    assert.equal(identityClusterSourceFreshness('app_registration', {
        ...current,
        'identity.global_graph': { ...checkpoint, validatedAt: '2026-08-05T11:00:00.000Z' },
    }, now), 'stale')
})

test('does not let a rejected proposal connect otherwise independent components', () => {
    const unrelatedLead = {
        sourceType: 'lead_profile',
        sourceId: 'lead-independent',
        identityId: '',
        name: 'Ana Lead Sintética',
        units: ['novo-hamburgo'],
        aliases: [],
        updatedAt: '2026-08-07T10:00:00.000Z',
        sourceFreshness: 'current',
        sourceFingerprint: 'lead-fp',
    }
    const rejected = {
        reviewType: 'lead_app',
        sourceType: 'lead_profile',
        sourceId: 'lead-independent',
        targetType: 'app_registration',
        targetId: 'app-a',
        status: 'rejected',
        confidence: 0.99,
        method: 'exact_email',
        matchedFields: ['email'],
        sharedUnits: ['novo-hamburgo'],
        candidateCount: 1,
        validatedMatch: true,
        sourceVersion: 'rejected-edge',
    }
    const clusters = buildIdentityReviewClusterPresentation({ members: [...members, unrelatedLead], edges: [...edges, rejected] })
    assert.equal(clusters.length, 2)
    assert.equal(clusters.some((cluster) => cluster.summary.memberCount === 4), false)
})

test('projects automatic-link history through its explicit presentation schema', () => {
    const cluster = buildIdentityReviewClusterPresentation({
        members,
        edges,
        automaticLinkHistory: [{
            reviewType: 'app_attendance',
            sourceType: 'app_registration',
            sourceId: 'app-a',
            targetType: 'attendance_client',
            targetId: 'attendance-a',
            transition: 'automatic_activated',
            resultingStatus: 'auto_confirmed',
            origin: 'operator@example.test',
            createdAt: '2026-08-07T10:05:00.000Z',
        }],
    })[0]
    assert.deepEqual(cluster.automaticLinks[0].history[0], {
        transition: 'automatic_activated',
        resultingStatus: 'auto_confirmed',
        recordedAt: '2026-08-07T10:05:00.000Z',
    })
    assert.doesNotMatch(JSON.stringify(cluster), /operator@example\.test/)
})

test('keeps preview and mutation/reveal confirmations explicit', () => {
    const cluster = buildIdentityReviewClusterPresentation({ members, edges })[0]
    const preview = buildIdentityClusterBulkPreview([cluster])
    assert.equal(preview.eligibleCount, 1)
    assert.equal(preview.clusters[0].version, cluster.version)
    assert.deepEqual(assertIdentityClusterConfirmation({ reason: 'Validação sintética', confirmation: 'REVIEW_CLUSTER', expectedVersion: cluster.version }), {
        reason: 'Validação sintética',
        expectedVersion: cluster.version,
    })
    assert.throws(() => assertIdentityClusterConfirmation({ reason: 'ok', confirmation: 'REVIEW_CLUSTER' }), /IDENTITY_CLUSTER_REASON_REQUIRED/)
    assert.throws(() => assertIdentityClusterConfirmation({ reason: 'Validação', confirmation: 'NO' }), /IDENTITY_CLUSTER_CONFIRMATION_REQUIRED/)
    assert.deepEqual(explicitRevealFields({ fields: ['phone', 'phone', 'email'] }), ['phone', 'email'])
    assert.throws(() => explicitRevealFields({ fields: ['cpf'] }), /IDENTITY_CLUSTER_REVEAL_FIELD_REQUIRED/)
})
