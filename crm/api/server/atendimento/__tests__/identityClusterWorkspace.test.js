import test from 'node:test'
import assert from 'node:assert/strict'

import {
    buildIdentityReviewClusterPresentation,
    buildIdentityClusterBulkPreview,
    classifyIdentityClusterBulkEligibility,
    maskEmail,
    maskPhone,
} from '../identityClusterWorkspace.js'

const members = [
    { sourceType: 'attendance_client', sourceId: 'a-1', identityId: 'identity-a', identityName: 'Ana Silva', name: 'Ana Silva', aliases: ['Ana S.'], units: ['novo-hamburgo'], updatedAt: '2026-08-01T00:00:00Z', sourceFreshness: 'current' },
    { sourceType: 'app_registration', sourceId: 'app-1', identityId: 'identity-b', identityName: 'Ana S.', name: 'Ana S.', phoneKeys: ['5511999998888'], emailKeys: ['ana@example.com'], units: ['novo-hamburgo'], updatedAt: '2026-08-01T00:00:00Z', sourceFreshness: 'current' },
    { sourceType: 'lead_profile', sourceId: 'lead-1', identityId: 'identity-c', identityName: 'Ana Silva', name: 'Ana Silva', phoneKeys: ['5511999998888'], units: ['novo-hamburgo'], updatedAt: '2026-08-01T00:00:00Z', sourceFreshness: 'current' },
    { sourceType: 'caixa_customer', sourceId: 'caixa-1', identityId: 'identity-d', identityName: 'Ana Silva', name: 'Ana Silva', phoneKeys: ['5511999998888'], units: ['novo-hamburgo'], updatedAt: '2026-08-01T00:00:00Z', sourceFreshness: 'current' },
]

test('groups transitive links into one cluster and exposes each source explicitly', () => {
    const clusters = buildIdentityReviewClusterPresentation({
        members,
        edges: [
            { reviewType: 'app_attendance', sourceType: 'app_registration', sourceId: 'app-1', targetType: 'attendance_client', targetId: 'a-1', status: 'suggested', method: 'exact_phone', confidence: 1, validatedMatch: true, candidateCount: 1, sourceVersion: 'v1' },
            { reviewType: 'lead_app', sourceType: 'lead_profile', sourceId: 'lead-1', targetType: 'app_registration', targetId: 'app-1', status: 'suggested', method: 'exact_email', confidence: 1, validatedMatch: true, candidateCount: 1, sourceVersion: 'v2' },
            { reviewType: 'app_caixa', sourceType: 'app_registration', sourceId: 'app-1', targetType: 'caixa_customer', targetId: 'caixa-1', status: 'suggested', method: 'exact_name_phone', confidence: 1, validatedMatch: true, candidateCount: 1, sourceVersion: 'v3' },
        ],
    })
    assert.equal(clusters.length, 1)
    assert.equal(clusters[0].summary.memberCount, 4)
    assert.deepEqual(clusters[0].membersBySource.map((entry) => entry.sourceLabel).sort(), ['Atendimento', 'Caixa', 'Cadastro do app', 'Leads e planilhas'].sort())
    assert.deepEqual(clusters[0].members.find((member) => member.source === 'attendance_client').aliases, ['Ana S.'])
    assert.equal(clusters[0].bulkReview.eligible, true)
    assert.deepEqual(clusters[0].impact.membersToMove.map((member) => member.sourceLabel).sort(), ['Caixa', 'Cadastro do app', 'Leads e planilhas'].sort())
    assert.equal(clusters[0].privacy.technicalIdsHidden, true)
    assert.equal('_members' in clusters[0], false)
    assert.equal('context' in clusters[0], false)
    assert.equal('evidence' in clusters[0], true)
    assert.equal(Object.keys(clusters[0]).some((key) => key.startsWith('_')), false)
})

test('masks contact values by default and keeps reveal out of the presentation schema', () => {
    assert.equal(maskPhone('5511999998888'), '55••••88')
    assert.equal(maskEmail('ana@example.com'), 'a•••@e•••')
    const [masked] = buildIdentityReviewClusterPresentation({ members: [{ ...members[1], identityId: 'identity-1' }], now: new Date('2026-08-01T00:00:00Z') })
    assert.deepEqual(masked.members[0].contact.phone, ['55••••88'])
    assert.deepEqual(masked.members[0].contact.email, ['a•••@e•••'])
    assert.equal(masked.members[0].contact.masked, true)
    assert.equal(JSON.stringify(masked).includes('5511999998888'), false)
})

test('marks a decision stale when a source member changed afterwards', () => {
    const [cluster] = buildIdentityReviewClusterPresentation({
        members: [
            { ...members[1], identityId: 'identity-1', updatedAt: '2026-08-06T00:00:00Z' },
            { ...members[3], identityId: 'identity-2', updatedAt: '2026-08-01T00:00:00Z' },
        ],
        edges: [{ reviewType: 'app_caixa', sourceType: 'app_registration', sourceId: 'app-1', targetType: 'caixa_customer', targetId: 'caixa-1', status: 'suggested', method: 'exact_phone', confidence: 1, validatedMatch: true, candidateCount: 1, sourceVersion: 'new' }],
        decisions: [{ reviewType: 'app_caixa', sourceId: 'app-1', targetId: 'caixa-1', decision: 'confirmed', sourceVersion: 'new', createdAt: '2026-08-02T00:00:00Z' }],
    })
    assert.equal(cluster.staleState, 'stale')
    assert.equal(cluster.decision.state, 'stale')
})

test('excludes a transitively cross-unit component from a narrower actor scope', () => {
    const clusters = buildIdentityReviewClusterPresentation({
        members: [
            { ...members[1], identityId: 'identity-1', units: ['novo-hamburgo'] },
            { ...members[3], identityId: 'identity-2', units: ['barra-shopping-sul'] },
        ],
        edges: [{ reviewType: 'app_caixa', sourceType: 'app_registration', sourceId: 'app-1', targetType: 'caixa_customer', targetId: 'caixa-1', status: 'suggested', method: 'exact_phone', confidence: 1, validatedMatch: true, candidateCount: 1 }],
        unitScope: ['novo-hamburgo'],
    })
    assert.equal(clusters.length, 0)
})

test('blocks bulk review when source freshness is unknown or stale', () => {
    const [cluster] = buildIdentityReviewClusterPresentation({
        members: [
            { ...members[1], identityId: 'identity-1', sourceFreshness: 'unknown' },
            { ...members[3], identityId: 'identity-2', sourceFreshness: 'current' },
        ],
        edges: [{ reviewType: 'app_caixa', sourceType: 'app_registration', sourceId: 'app-1', targetType: 'caixa_customer', targetId: 'caixa-1', status: 'suggested', method: 'exact_phone', confidence: 1, validatedMatch: true, candidateCount: 1 }],
    })
    assert.equal(cluster.staleState, 'stale')
    assert.equal(cluster.bulkReview.eligible, false)
    assert.ok(cluster.bulkReview.reasons.includes('source_stale_or_changed_after_decision'))
})

test('blocks bulk review for a strong contact conflict, prior decision or commercial history', () => {
    const result = classifyIdentityClusterBulkEligibility({
        members: [{ ...members[1], phoneKeys: ['5511999998888'] }, { ...members[2], phoneKeys: ['5511888887777'] }],
        edges: [{ status: 'suggested', method: 'exact_phone', validatedMatch: true, candidateCount: 1 }],
        conflicts: [{ field: 'phone', severity: 'strong' }],
        decisions: [{ decision: 'rejected' }],
        undoBlocked: true,
    })
    assert.equal(result.eligible, false)
    assert.ok(result.reasons.includes('strong_conflict'))
    assert.ok(result.reasons.includes('incompatible_prior_decision'))
    assert.ok(result.reasons.includes('commercial_or_consent_history'))
})

test('bulk preview reports eligible and blocked components without identifiers beyond opaque keys', () => {
    const preview = buildIdentityClusterBulkPreview([
        { clusterKey: 'opaque-a', version: 'v1', summary: { memberCount: 2 }, bulkReview: { eligible: true, reasons: [] } },
        { clusterKey: 'opaque-b', version: 'v2', summary: { memberCount: 2 }, bulkReview: { eligible: false, reasons: ['strong_conflict'] } },
    ])
    assert.deepEqual(preview, {
        schemaVersion: 'crm-identity-cluster/v1', clusterCount: 2, eligibleCount: 1, blockedCount: 1,
        memberCount: 4, eligibleMembers: 2, blockedReasons: ['strong_conflict'],
        clusters: [
            { clusterKey: 'opaque-a', version: 'v1', eligible: true, reasons: [] },
            { clusterKey: 'opaque-b', version: 'v2', eligible: false, reasons: ['strong_conflict'] },
        ],
    })
})
