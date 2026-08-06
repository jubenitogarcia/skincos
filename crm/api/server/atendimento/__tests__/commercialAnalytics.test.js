import assert from 'node:assert/strict'
import test from 'node:test'
import {
    buildCommercialFunnel,
    buildExperimentAssignments,
    buildExperimentResult,
    buildQualityTimeSeries,
    buildSegmentDrift,
    deterministicExperimentVariant,
    isWithinAttributionWindow,
    normalizeAnalyticsFilters,
    sanitizeAnalyticsPayload,
} from '../commercialAnalytics.js'

const identityA = '11111111-1111-4111-8111-111111111111'
const identityB = '22222222-2222-4222-8222-222222222222'

test('normalizes bounded analytics filters and rejects an inverted period', () => {
    assert.deepEqual(normalizeAnalyticsFilters({ from: '2026-01-01', to: '2026-01-31', dimensions: 'unit,segment' }), {
        from: '2026-01-01', to: '2026-01-31', unit: null, units: [], campaign: null, segment: null, owner: null,
        channel: null, offer: null, policyVersion: null, findingKey: null, sourceKey: null, granularity: 'day',
        attributionState: 'attributed', dimensions: ['unit', 'segment'], limit: 90,
    })
    assert.throws(() => normalizeAnalyticsFilters({ from: '2026-02-01', to: '2026-01-01' }), /INVALID_ANALYTICS_PERIOD/)
})

test('quality history calculates timing, backlog aging and reopen rate from append-only events', () => {
    const finding = { id: 'finding-1', finding_key: 'source.local_mirror_stale', status: 'open', observed_count: 4, owner: 'ops', first_detected_at: '2026-01-01T00:00:00Z', sla_due_at: '2026-01-01T12:00:00Z' }
    const events = [
        { finding_id: 'finding-1', finding_key: finding.finding_key, event_type: 'detected', status: 'open', observed_count: 4, created_at: '2026-01-01T00:00:00Z' },
        { finding_id: 'finding-1', finding_key: finding.finding_key, event_type: 'status_changed', status: 'acknowledged', observed_count: 4, created_at: '2026-01-01T02:00:00Z' },
        { finding_id: 'finding-1', finding_key: finding.finding_key, event_type: 'status_changed', status: 'in_progress', observed_count: 4, created_at: '2026-01-01T04:00:00Z' },
        { finding_id: 'finding-1', finding_key: finding.finding_key, event_type: 'reopened', status: 'open', observed_count: 4, created_at: '2026-01-02T00:00:00Z' },
    ]
    const result = buildQualityTimeSeries({ findings: [finding], findingEvents: events, asOf: '2026-01-03T00:00:00Z' })
    assert.equal(result.backlogAging[0].ageHours, 48)
    assert.equal(result.timing.timeToRecognitionHours, 2)
    assert.equal(result.timing.timeToStartHours, 4)
    assert.equal(result.reopenRate, 0.5)
    assert.equal(result.overdueSla, 1)
})

test('funnel keeps observed and attributed conversions separate at explicit windows', () => {
    const result = buildCommercialFunnel({
        actions: [{ id: 'action-1', identity_id: identityA, segment_key: 'return_at_risk', status: 'contacted', contacted_at: '2026-01-01T00:00:00Z', created_at: '2026-01-01T00:00:00Z', unit_slug: 'novo-hamburgo' }],
        events: [
            { identity_id: identityA, action_id: 'action-1', event_type: 'responded', occurred_at: '2026-01-05T00:00:00Z', unit_slug: 'novo-hamburgo' },
            { identity_id: identityA, action_id: 'action-1', event_type: 'scheduled', occurred_at: '2026-02-01T00:00:00Z', unit_slug: 'novo-hamburgo' },
        ],
        eligibleIdentities: [{ identity_id: identityA }],
        windows: { responseDays: 7, appointmentDays: 14, attendanceDays: 30, saleDays: 30, returnDays: 60 },
    })
    assert.equal(result.stages.responded.observed, 1)
    assert.equal(result.stages.responded.attributed, 1)
    assert.equal(result.stages.scheduled.observed, 1)
    assert.equal(result.stages.scheduled.attributed, 0)
    assert.equal(isWithinAttributionWindow('2026-01-01T00:00:00Z', '2026-01-09T00:00:00Z', 'responded', { responseDays: 7 }), false)
})

test('experiment assignment is reproducible and result warns on insufficient sample', () => {
    assert.equal(deterministicExperimentVariant(identityA, 'reactivation', 'seed-2026', 50), deterministicExperimentVariant(identityA, 'reactivation', 'seed-2026', 50))
    const assignments = buildExperimentAssignments([{ identity_id: identityA }, { identity_id: identityB }, { identity_id: identityA }], { experimentKey: 'reactivation', seed: 'seed-2026', controlPercent: 50 })
    assert.equal(assignments.length, 2)
    const result = buildExperimentResult(assignments, [{ identity_id: identityA, event_type: 'purchased', revenue: 100 }])
    assert.equal(result.warning, 'INSUFFICIENT_SAMPLE')
    assert.equal(result.confidenceIntervalAdequate, false)
})

test('segment drift compares the last two snapshots and payload sanitization drops PII', () => {
    const drift = buildSegmentDrift([
        { snapshot_date: '2026-01-01', distribution: { included: 10, excluded: 90 } },
        { snapshot_date: '2026-02-01', distribution: { included: 20, excluded: 80 } },
    ])
    assert.equal(drift.available, true)
    assert.equal(drift.dimensions.find((item) => item.key === 'included').delta, 10)
    assert.deepEqual(sanitizeAnalyticsPayload({ phone: '5551', email: 'a@b', safe: 'ok', nested: { cpf: '1', value: 2 } }), { safe: 'ok', nested: { value: 2 } })
})
