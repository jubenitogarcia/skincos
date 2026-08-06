import test from 'node:test'
import assert from 'node:assert/strict'
import {
    COMMERCIAL_CAMPAIGN_STATES,
    actionQueueFlags,
    aggregateCommercialActionMetrics,
    campaignMemberState,
    computeAverageStageDurations,
    normalizeCampaignPayload,
    normalizeOperationMutation,
    planWalletBalance,
    sanitizeTimelineEvent,
    stableOperationFingerprint,
} from '../commercialOperations.js'
import { commercialOperationsMigrationPlan, __testables as migrationTestables } from '../commercialOperationsMigration.js'

test('classifies the operational wallet without exposing contact data', () => {
    const flags = actionQueueFlags({ status: 'open', owner: 'Ana', dueDate: '2026-08-06' }, {
        today: '2026-08-06', actorIds: ['ana'], eligibility: { status: 'eligible', expiresAt: '2026-08-10' }, sourceStale: true, identityInReview: true,
    })
    assert.deepEqual(flags, ['assigned_to_me', 'due_today', 'permission_expiring', 'source_stale', 'identity_review'])
    assert.equal(flags.includes('ineligible'), false)
})

test('aggregates completion, response, scheduling, attendance, sale and return rates', () => {
    const metrics = aggregateCommercialActionMetrics([
        { id: 'a', status: 'closed' },
        { id: 'b', status: 'scheduled' },
        { id: 'c', status: 'won_sale', outcomeCode: 'attended' },
        { id: 'd', status: 'returned', owner: 'Ana' },
    ])
    assert.equal(metrics.totals.completed, 3)
    assert.equal(metrics.totals.attended, 1)
    assert.equal(metrics.totals.sale, 1)
    assert.equal(metrics.totals.returned, 1)
    assert.equal(metrics.totals.responded, 3)
    assert.equal(metrics.totals.completionRate, 75)
    assert.equal(metrics.byOwner.find((item) => item.owner === 'Ana')?.completed, 1)
})

test('does not count explicit no-response outcomes as customer responses', () => {
    const metrics = aggregateCommercialActionMetrics([
        { id: 'no-response', status: 'closed', outcomeCode: 'no_response' },
        { id: 'follow-up', status: 'open', outcomeCode: 'requested_follow_up' },
        { id: 'wrong-number', status: 'closed', outcomeCode: 'wrong_number' },
    ])
    assert.equal(metrics.totals.responded, 1)
    assert.equal(metrics.totals.completed, 2)
})

test('computes average stage duration from append-only events', () => {
    const durations = computeAverageStageDurations([
        { actionId: 'a', status: 'open', createdAt: '2026-08-06T08:00:00Z' },
        { actionId: 'a', status: 'contacted', createdAt: '2026-08-06T10:00:00Z' },
        { actionId: 'a', status: 'responded', createdAt: '2026-08-06T14:00:00Z' },
        { actionId: 'b', status: 'open', createdAt: '2026-08-06T09:00:00Z' },
        { actionId: 'b', status: 'contacted', createdAt: '2026-08-06T13:00:00Z' },
    ])
    assert.equal(durations.open.hours, 3)
    assert.equal(durations.contacted.hours, 4)
})

test('validates frozen campaign state, reason and bounded cohort', () => {
    const normalized = normalizeCampaignPayload({
        name: 'Retorno agosto', segmentKey: 'return_at_risk', segmentVersion: '2026-08-06', unit: 'novo-hamburgo', owner: 'Ana',
        filters: { priority: 'high' }, identityIds: ['11111111-1111-4111-8111-111111111111'], cutoffAt: '2026-08-06T00:00:00Z', assignmentWindowStart: '2026-08-06T00:00:00Z', assignmentWindowEnd: '2026-08-13T00:00:00Z', reason: 'Coorte sintética para operação assistida', state: 'draft',
    })
    assert.equal(normalized.state, 'draft')
    assert.throws(() => normalizeCampaignPayload({ ...normalized, state: 'sending' }), /INVALID_COMMERCIAL_CAMPAIGN_STATE/)
    assert.deepEqual([...COMMERCIAL_CAMPAIGN_STATES], ['draft', 'scheduled', 'active', 'paused', 'completed', 'cancelled'])
})

test('uses deterministic control groups, idempotency fingerprints and wallet moves', () => {
    assert.equal(campaignMemberState({ eligible: true, controlGroup: false, identityInReview: false, sourceStale: false }), 'eligible')
    assert.equal(campaignMemberState({ eligible: false, controlGroup: false, identityInReview: true, sourceStale: false }), 'review')
    assert.equal(stableOperationFingerprint({ b: { y: 2, x: 1 }, a: 1 }), stableOperationFingerprint({ a: 1, b: { x: 1, y: 2 } }))
    assert.throws(() => normalizeOperationMutation({ reason: 'ok' }), /COMMERCIAL_IDEMPOTENCY_KEY_REQUIRED/)
    const moves = planWalletBalance([{ id: 'a', owner: 'Ana', status: 'open', absentOwner: true }, { id: 'b', owner: 'Bia', status: 'open' }], { Ana: 2, Bia: 2 })
    assert.deepEqual(moves, [{ actionId: 'a', fromOwner: 'Ana', toOwner: 'Bia' }])
})

test('sanitizes Customer 360 events to an explicit, PII-free schema', () => {
    const event = sanitizeTimelineEvent({ event_id: 'action:1', event_type: 'action', occurred_on: '2026-08-06', title: 'Ação', detail: 'responded', unit_name: 'Novo Hamburgo', source_label: 'CRM', actor_label: 'gestor', trace_id: 'trace-1', phone: '5551999999999', email: 'a@example.com' })
    assert.deepEqual(event, { id: 'action:1', type: 'action', occurredOn: '2026-08-06', title: 'Ação', detail: 'responded', unitName: 'Novo Hamburgo', source: 'CRM', amount: null, status: 'confirmed', actor: 'gestor', correlationId: 'trace-1' })
    assert.equal('phone' in event, false)
    assert.equal('email' in event, false)
})

test('migration plan is additive and limits runtime sequence access', () => {
    const plan = commercialOperationsMigrationPlan()
    assert.ok(plan.adds.includes('commercial_campaigns'))
    assert.ok(plan.appendOnlyTables.includes('commercial_campaign_events'))
    assert.ok(migrationTestables.STATEMENTS.some((sql) => sql.includes('commercial_campaign_events_immutable')))
    assert.ok(migrationTestables.STATEMENTS.some((sql) => sql.includes('commercial_campaign_events_no_truncate')))
    assert.equal(migrationTestables.INDEXES.some((index) => index.sql.includes('all sequences')), false)
})
