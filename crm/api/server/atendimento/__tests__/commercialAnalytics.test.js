import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

import {
    COMMERCIAL_ANALYTICS_SAFETY_FLAGS,
    COMMERCIAL_ANALYTICS_DEFAULT_ATTRIBUTION_WINDOW,
    calculateExperimentLift,
    deterministicExperimentVariant,
    normalizeSegmentCriteria,
} from '../commercialAnalytics.js'
import { __testables, commercialAnalyticsReadiness } from '../commercialAnalyticsStore.js'

const actor = Object.freeze({
    subject: 'crm:gestor-analytics', id: 'legacy-ignored', role: 'GESTOR',
    allowedUnits: ['centro'], allowedUnitsDeclared: true,
})

function readinessRow() {
    return {
        mutations: true, definitions: true, versions: true, memberships: true, windows: true,
        experiments: true, assignments: true, events: true, migration_registry: true,
        migration_read: true, mutations_read: true, mutations_write: true, definitions_read: true, definitions_write: true,
        versions_read: true, versions_write: true, memberships_read: true, memberships_write: true, windows_read: true,
        windows_write: true, experiments_read: true, experiments_write: true, assignments_read: true, assignments_write: true,
        events_write: true, events_sequence_write: true, source_units_read: true, source_identity_members_read: true,
        source_attendance_links_read: true, source_attendances_read: true, source_sales_read: true, source_sale_items_read: true,
        source_actions_read: true, source_campaigns_read: true, source_campaign_members_read: true, source_permissions_read: true,
        source_checkpoints_read: true, source_quality_findings_read: true, source_quality_events_read: true,
        mutations_immutable: true, mutations_no_truncate: true, memberships_immutable: true, memberships_no_truncate: true,
        assignments_immutable: true, assignments_no_truncate: true, events_immutable: true, events_no_truncate: true,
    }
}

test('segment criteria accepts only the explicit snake_case analytics DSL', () => {
    assert.deepEqual(normalizeSegmentCriteria({
        minimum_visits: 3, requires_permission: true, identity_quality: 'confirmed_multi_source',
        procedure_ids: ['botox', 'laser'], sales_classifications: ['mapped'],
    }), {
        identity_quality: 'confirmed_multi_source', minimum_visits: 3, procedure_ids: ['botox', 'laser'],
        requires_permission: true, sales_classifications: ['mapped'],
    })
    assert.throws(() => normalizeSegmentCriteria({ minimumVisits: 3 }), { code: 'SEGMENT_CRITERIA_CAMEL_CASE_FORBIDDEN' })
    assert.throws(() => normalizeSegmentCriteria({ unknown_metric: 3 }), { code: 'SEGMENT_CRITERIA_KEY_NOT_ALLOWED' })
    assert.throws(() => normalizeSegmentCriteria({ customer_email: 'masked@example.test' }), { code: 'SEGMENT_CRITERIA_PII_ALIAS_FORBIDDEN' })
    assert.throws(() => normalizeSegmentCriteria({ minimum_visits: { value: 3 } }), { code: 'SEGMENT_CRITERIA_NESTED_VALUE_FORBIDDEN' })
    assert.throws(() => normalizeSegmentCriteria({ procedure_ids: ['phone_number'] }), { code: 'SEGMENT_CRITERIA_VALUE_INVALID' })
})

test('analytics safety flags and deterministic holdout assignment remain non-contacting', () => {
    assert.deepEqual(COMMERCIAL_ANALYTICS_SAFETY_FLAGS, {
        commercialContactWritesEnabled: false, messagesEnabled: false,
        autonomousMessagingEnabled: false, consentWritesEnabled: false,
    })
    assert.deepEqual(COMMERCIAL_ANALYTICS_DEFAULT_ATTRIBUTION_WINDOW, {
        responseDays: 7, scheduledDays: 14, attendedDays: 30, purchasedDays: 30, returnedDays: 60,
    })
    const input = {
        experimentId: '11111111-1111-4111-8111-111111111111',
        identityId: '22222222-2222-4222-8222-222222222222', controlGroupPercent: 25,
    }
    assert.equal(deterministicExperimentVariant(input), deterministicExperimentVariant(input))
    assert.match(deterministicExperimentVariant(input), /^(treatment|control)$/)
})

test('lift keeps observed, attributed and incremental calculations separate and warns below an adequate sample', () => {
    const insufficient = calculateExperimentLift([
        { variant: 'treatment', population: 10, conversions: 3, revenue: 300 },
        { variant: 'control', population: 10, conversions: 1, revenue: 100 },
    ])
    assert.equal(insufficient.warning, 'INSUFFICIENT_EXPERIMENT_SAMPLE')
    assert.equal(insufficient.confidenceInterval95, null)
    const adequate = calculateExperimentLift([
        { variant: 'treatment', population: 100, conversions: 30, revenue: 3000 },
        { variant: 'control', population: 100, conversions: 20, revenue: 1500 },
    ])
    assert.equal(adequate.adequateSample, true)
    assert.equal(adequate.observedLift, 0.1)
    assert.equal(adequate.incrementalConversions, 10)
    assert.equal(adequate.incrementalRevenue, 1500)
    assert.ok(adequate.confidenceInterval95)
})

test('analytics readiness requires the registry grant, append-only assignments and an applied migration', async () => {
    const readiness = await commercialAnalyticsReadiness({
        async query(sql) {
            if (sql.includes("to_regclass('crm_atendimento.commercial_analytics_mutations')")) return { rows: [readinessRow()] }
            if (sql.includes('from crm_atendimento.schema_migrations where id=$1')) return { rows: [{ id: '20260807_commercial_analytics_v2' }] }
            throw new Error(`unexpected sql: ${sql}`)
        },
    })
    assert.equal(readiness.ready, true)
    assert.equal(readiness.appendOnlyReady, true)
    assert.equal(readiness.grantsReady, true)
    assert.equal(readiness.safety.messagesEnabled, false)

    const incomplete = await commercialAnalyticsReadiness({
        async query(sql) {
            if (sql.includes("to_regclass('crm_atendimento.commercial_analytics_mutations')")) return { rows: [{ ...readinessRow(), migration_read: false, assignments_immutable: false }] }
            throw new Error(`unexpected sql: ${sql}`)
        },
    })
    assert.equal(incomplete.ready, false)
    assert.equal(incomplete.grantsReady, false)
    assert.equal(incomplete.appendOnlyReady, false)
})

test('idempotency locks before readiness or ledger reads and actor subject never falls back to email', async () => {
    assert.equal(__testables.actorPrincipal(actor), 'crm:gestor-analytics')
    assert.throws(() => __testables.actorPrincipal({ username: 'operator@example.test', email: 'operator@example.test' }), { code: 'ACTOR_IDENTITY_REQUIRED' })
    const before = process.env.ATENDIMENTO_ACTOR_HMAC_KEY
    process.env.ATENDIMENTO_ACTOR_HMAC_KEY = 'a'.repeat(32)
    const calls = []
    const client = {
        async query(sql, values = []) {
            calls.push({ sql, values })
            if (sql.includes('pg_advisory_xact_lock')) return { rows: [] }
            if (sql.includes("to_regclass('crm_atendimento.commercial_analytics_mutations')")) return { rows: [readinessRow()] }
            if (sql.includes('from crm_atendimento.schema_migrations where id=$1')) return { rows: [{ id: '20260807_commercial_analytics_v2' }] }
            if (sql.includes('from crm_atendimento.commercial_analytics_mutations')) return { rows: [] }
            if (sql.includes('insert into crm_atendimento.commercial_analytics_mutations')) return { rows: [] }
            throw new Error(`unexpected sql: ${sql}`)
        },
    }
    try {
        const result = await __testables.runAnalyticsMutation(client, {
            actor, operation: 'segment_create',
            payload: { idempotencyKey: 'segment:opaque-key-123', reason: 'Ajuste de segmento seguro', expectedRevision: 0 },
            fingerprintPayload: { key: 'safe_segment' }, options: { allowCreateRevision: true },
            execute: async () => ({ result: 'stored' }),
        })
        assert.equal(result.idempotent, false)
        assert.match(calls[0].sql, /pg_advisory_xact_lock/)
        assert.equal(calls.slice(1).some((call) => call.sql.includes('commercial_analytics_mutations') && call.sql.includes('from')), true)
        assert.equal(JSON.stringify(calls).includes('segment:opaque-key-123'), false)
        assert.equal(JSON.stringify(calls).includes('Ajuste de segmento seguro'), false)
    } finally {
        if (before === undefined) delete process.env.ATENDIMENTO_ACTOR_HMAC_KEY
        else process.env.ATENDIMENTO_ACTOR_HMAC_KEY = before
    }
})

test('analytics assignment uses the exact Operations crossover advisory-lock namespace', async () => {
    const calls = []
    await __testables.lockExperimentIdentity({ async query(sql, values) { calls.push({ sql, values }); return { rows: [] } } },
    '33333333-3333-4333-8333-333333333333', '22222222-2222-4222-8222-222222222222')
    assert.match(calls[0].sql, /pg_advisory_xact_lock/)
    assert.equal(calls[0].values[0], 'commercial-experiment-crossover:33333333-3333-4333-8333-333333333333:22222222-2222-4222-8222-222222222222')
})

test('attribution rejects a cross-unit funnel even for a global analytics manager', async () => {
    const attributionWindowId = '44444444-4444-4444-8444-444444444444'
    const db = {
        async query(sql) {
            if (sql.includes('from crm_atendimento.units unit')) {
                return { rows: [
                    { id: '55555555-5555-4555-8555-555555555555', slug: 'centro' },
                    { id: '66666666-6666-4666-8666-666666666666', slug: 'zona-sul' },
                ] }
            }
            if (sql.includes('from crm_atendimento.commercial_attribution_windows')) {
                return { rows: [{ id: attributionWindowId, unit_id: '55555555-5555-4555-8555-555555555555' }] }
            }
            throw new Error(`unexpected sql: ${sql}`)
        },
    }
    await assert.rejects(
        __testables.commercialFunnel(db, { attributionWindowId }, { subject: 'crm:global-analytics', role: 'ADMIN', isGlobalAdmin: true }),
        { code: 'COMMERCIAL_ANALYTICS_WINDOW_UNIT_SCOPE_REQUIRED' },
    )
})

test('experiment revenue query deduplicates a sale shared by duplicate source members', async () => {
    const source = await readFile(new URL('../commercialAnalyticsStore.js', import.meta.url), 'utf8')
    assert.match(source, /sales_rows as \(\s*select distinct assignment\.identity_id,sale\.id as sale_id/s)
    assert.match(source, /left join sales_rows on sales_rows\.identity_id=assignment\.identity_id/)
})

test('Operations retains the shared holdout guard in campaign create, action reassign and rebalance', async () => {
    const source = await readFile(new URL('../commercialOperationsStore.js', import.meta.url), 'utf8')
    assert.match(source, /commercial-experiment-crossover:\$\{unit\}:\$\{identityId\}/)
    for (const operation of ['createCampaign', 'reassignAction', 'applyRebalance']) {
        const start = source.indexOf(`async function ${operation}`)
        assert.notEqual(start, -1)
        const next = source.indexOf('\nasync function ', start + 1)
        const block = source.slice(start, next === -1 ? undefined : next)
        assert.match(block, /assertNoActiveExperimentHoldout/)
    }
})
