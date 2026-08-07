import assert from 'node:assert/strict'
import test from 'node:test'

import {
    COMMERCIAL_OUTCOME_CODES,
    actionQueueFlags,
    aggregateCommercialActionMetrics,
    campaignMemberState,
    computeAverageStageDurations,
    normalizeCampaignPayload,
    normalizeOperationMutation,
    projectCommercialTimelineEvent,
    stableControlGroup,
} from '../commercialOperations.js'

const identityA = '11111111-1111-4111-8111-111111111111'
const identityB = '22222222-2222-4222-8222-222222222222'

test('normalizes only structured operational outcomes and rejects PII-like idempotency keys', () => {
    assert.equal(COMMERCIAL_OUTCOME_CODES.includes('sale'), true)
    assert.deepEqual(normalizeOperationMutation({ idempotencyKey: 'action:opaque-key-1', reason: 'Atualização segura', outcomeCode: 'sale' }, { requireReason: true }), {
        idempotencyKey: 'action:opaque-key-1', expectedRevision: null, reason: 'Atualização segura', outcomeCode: 'sale',
    })
    assert.throws(() => normalizeOperationMutation({ idempotencyKey: 'operator@example.com' }), /INVALID_COMMERCIAL_IDEMPOTENCY_KEY/)
    assert.throws(() => normalizeOperationMutation({ idempotencyKey: 'action:1', reason: '5511999999999' }, { requireReason: true }), /COMMERCIAL_OPERATION_REASON_INVALID/)
})

test('freezes a campaign cohort with opaque filters and deterministic control assignment', () => {
    const campaign = normalizeCampaignPayload({
        name: 'Retorno seguro', segmentKey: 'return', segmentVersion: 'v1', unit: 'centro', owner: 'gestor.crm', reason: 'Coorte de teste segura',
        filters: { status: ['open'], actionFlag: 'overdue' }, identityIds: [identityA, identityB], cutoffAt: '2026-08-07T12:00:00.000Z',
        assignmentWindowStart: '2026-08-08T00:00:00.000Z', assignmentWindowEnd: '2026-08-15T00:00:00.000Z', controlGroupPercent: 20,
    })
    assert.equal(campaign.identityIds.length, 2)
    assert.equal(stableControlGroup({ campaignSeed: 'campaign:opaque', identityId: identityA, percentage: 20 }), stableControlGroup({ campaignSeed: 'campaign:opaque', identityId: identityA, percentage: 20 }))
    assert.equal(campaignMemberState({ eligible: false, sourceStale: true }), 'review')
    assert.throws(() => normalizeCampaignPayload({ ...campaign, filters: { owner: 'customer@example.com' } }), /COMMERCIAL_CAMPAIGN_FILTER_INVALID/)
})

test('classifies queues and computes team metrics without contact data', () => {
    const flags = actionQueueFlags({ status: 'contacted', dueDate: '2026-08-06', owner: 'gestor.crm' }, {
        today: '2026-08-07', actorIds: ['gestor.crm'], eligibility: { status: 'eligible', expiresAt: '2026-08-10T00:00:00.000Z' }, sourceStale: true,
    })
    assert.deepEqual(flags, ['assigned_to_me', 'overdue', 'awaiting_response', 'no_return', 'permission_expiring', 'source_stale'])
    const metrics = aggregateCommercialActionMetrics([
        { status: 'contacted', owner: 'gestor.crm', dueDate: '2026-08-06' },
        { status: 'won_sale', owner: 'gestor.crm', outcomeCode: 'sale' },
    ], { today: '2026-08-07' })
    assert.equal(metrics.totals.total, 2)
    assert.equal(metrics.totals.sale, 1)
    assert.equal(metrics.byOwner[0].owner, 'gestor.crm')
})

test('calculates stage durations and projects an allowlisted Customer 360 shape', () => {
    assert.deepEqual(computeAverageStageDurations([
        { actionId: 'a', status: 'open', occurredAt: '2026-08-01T00:00:00.000Z' },
        { actionId: 'a', status: 'responded', occurredAt: '2026-08-01T12:00:00.000Z' },
    ]), { open: { hours: 12, samples: 1 } })
    const event = projectCommercialTimelineEvent({
        event_id: 'event:1', event_type: 'campaign', created_at: '2026-08-01T00:00:00.000Z', source_label: 'CRM', unit_slug: 'centro',
        actor_label: 'customer@example.com', trace_id: '33333333-3333-4333-8333-333333333333', status: 'draft', context: { phone: '5511999999999' },
    })
    assert.equal(event.actor, null)
    assert.deepEqual(Object.keys(event).sort(), ['actor', 'campaignId', 'consentReview', 'correlationId', 'id', 'occurredAt', 'offerId', 'source', 'status', 'type', 'unit'])
})
