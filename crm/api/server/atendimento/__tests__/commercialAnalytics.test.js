import assert from 'node:assert/strict'
import test from 'node:test'

import {
    buildCommercialFunnel,
    buildExperimentAssignments,
    buildExperimentResult,
    buildQualityTimeSeries,
    buildSegmentDrift,
    buildSegmentMembershipSnapshot,
    commercialAnalyticsError,
    deterministicExperimentVariant,
    isWithinAttributionWindow,
    normalizeAnalyticsFilters,
    normalizeAttributionWindows,
    normalizeSegmentDefinition,
    sanitizeAnalyticsPayload,
} from '../commercialAnalytics.js'

const identityA = '11111111-1111-4111-8111-111111111111'
const identityB = '22222222-2222-4222-8222-222222222222'

test('analytics filters, windows and payloads remain bounded and PII-free', () => {
    assert.deepEqual(normalizeAttributionWindows({ version: 'v2', responseDays: 5 }).responseDays, 5)
    assert.throws(() => normalizeAttributionWindows({ responseDays: 731 }), { code: 'COMMERCIAL_ATTRIBUTION_WINDOW_INVALID' })
    assert.deepEqual(normalizeAnalyticsFilters({ from: '2026-08-01', to: '2026-08-31', dimensions: 'unit,campaign', attributionState: 'observed' }).dimensions, ['unit', 'campaign'])
    assert.throws(() => normalizeAnalyticsFilters({ unit: 'customer@example.com' }), { code: 'INVALID_ANALYTICS_FILTER' })
    assert.deepEqual(sanitizeAnalyticsPayload({ name: 'Ana', phoneRaw: '+5511999999999', metrics: { coverage_identity: 0.8 }, label: 'safe' }), { metrics: { coverage_identity: 0.8 }, label: 'safe' })
    assert.equal(isWithinAttributionWindow('2026-08-01', '2026-08-10', 'responded', { responseDays: 7 }), false)
})

test('quality analytics derives history, aging, SLA and coverage from aggregate records', () => {
    const result = buildQualityTimeSeries({
        asOf: '2026-08-10T00:00:00.000Z',
        findings: [{ findingKey: 'freshness.leads', status: 'open', observedCount: 3, owner: 'gestor.crm', firstDetectedAt: '2026-08-08T00:00:00.000Z', slaDueAt: '2026-08-09T00:00:00.000Z' }],
        findingEvents: [
            { findingKey: 'freshness.leads', eventType: 'detected', status: 'open', observedCount: 3, createdAt: '2026-08-08T00:00:00.000Z' },
            { findingKey: 'freshness.leads', eventType: 'reopened', status: 'open', observedCount: 3, createdAt: '2026-08-09T00:00:00.000Z' },
            { findingKey: 'freshness.leads', eventType: 'updated', status: 'acknowledged', observedCount: 3, createdAt: '2026-08-09T02:00:00.000Z' },
        ],
        metricSnapshots: [{ sourceKey: 'freshness.leads', recordedAt: '2026-08-10T00:00:00.000Z', metrics: { coverage_identity: 0.8, coverage_consent: 0.7 } }],
    })
    // Two ledger dates plus the current observation make the history
    // continuous even if a source has not emitted a finding event today.
    assert.equal(result.byFinding['freshness.leads'].length, 3)
    assert.equal(result.overdueSla, 1)
    assert.equal(result.ownerCoverage, 1)
    assert.equal(result.coverage.coverage_identity, 0.8)
    assert.equal(result.freshness.length, 1)
    assert.equal(result.reopenRate, 0.5)
})

test('funnel separates observed, attributed and treatment-incremental conversions', () => {
    const result = buildCommercialFunnel({
        eligibleIdentities: [{ identityId: identityA }, { identityId: identityB }],
        campaignMembers: [{ identityId: identityA, unitSlug: 'centro' }],
        assignments: [{ identityId: identityA, variant: 'treatment' }, { identityId: identityB, variant: 'control' }],
        actions: [{ id: 'action-a', identityId: identityA, unitSlug: 'centro', status: 'contacted', contactedAt: '2026-08-01T00:00:00.000Z', createdAt: '2026-08-01T00:00:00.000Z' }],
        events: [
            { identityId: identityA, type: 'responded', unitSlug: 'centro', occurredAt: '2026-08-05T00:00:00.000Z' },
            { identityId: identityA, type: 'purchased', unitSlug: 'centro', occurredAt: '2026-10-15T00:00:00.000Z' },
        ],
        windows: { responseDays: 7, saleDays: 60 },
    })
    assert.deepEqual(result.stages.eligible, { observed: 2, attributed: 2, incremental: 1 })
    assert.deepEqual(result.stages.responded, { observed: 1, attributed: 1, incremental: 1 })
    assert.deepEqual(result.stages.purchased, { observed: 1, attributed: 0, incremental: 0 })
})

test('experiments persist deterministic assignments, prevent crossover and warn on insufficient samples', () => {
    const variant = deterministicExperimentVariant(identityA, 'return-risk', 'aug-2026', 20)
    assert.equal(variant, deterministicExperimentVariant(identityA, 'return-risk', 'aug-2026', 20))
    const assignments = buildExperimentAssignments([{ identityId: identityA, unitSlug: 'centro' }], {
        experimentKey: 'return-risk', seed: 'aug-2026', controlPercent: 20,
        existingAssignments: [{ identityId: identityA, unitSlug: 'centro', variant: 'control', eligible: true }],
    })
    assert.equal(assignments[0].variant, 'control')
    assert.equal(assignments[0].preserved, true)
    assert.throws(() => buildExperimentAssignments([{ identityId: identityA, unitSlug: 'barra' }], {
        experimentKey: 'return-risk', seed: 'aug-2026', existingAssignments: [{ identityId: identityA, unitSlug: 'centro', variant: 'control' }],
    }), { code: 'COMMERCIAL_EXPERIMENT_SCOPE_CONFLICT' })
    const result = buildExperimentResult(assignments, [{ identityId: identityA, type: 'responded' }])
    assert.equal(result.warning, 'INSUFFICIENT_SAMPLE')
})

test('segment definitions are explicit and membership snapshots expose only aggregates and hash', () => {
    const definition = normalizeSegmentDefinition({ key: 'return-risk', version: 'v1', criteria: { daysSinceVisit: { gte: 90 } }, thresholds: { risk: 0.7 }, author: 'gestor.crm' })
    const first = buildSegmentMembershipSnapshot(definition, [{ identityId: identityA, bucket: 'high' }, { identityId: identityB, bucket: 'medium' }], { snapshotAt: '2026-08-01', unitSlug: 'centro' })
    const second = buildSegmentMembershipSnapshot(definition, [{ identityId: identityA, bucket: 'high' }], { snapshotAt: '2026-08-08', unitSlug: 'centro' })
    assert.equal(first.memberCount, 2)
    assert.match(first.membershipHash, /^[a-f0-9]{64}$/)
    assert.equal(Object.hasOwn(first, 'members'), false)
    const drift = buildSegmentDrift([first, second])
    assert.equal(drift.available, true)
    assert.equal(drift.population.current, 1)
    assert.throws(() => normalizeSegmentDefinition({ key: 'return-risk', version: 'v1', criteria: { email: 'customer@example.com' } }), commercialAnalyticsError('COMMERCIAL_SEGMENT_DEFINITION_INVALID'))
})
