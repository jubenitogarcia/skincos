import assert from 'node:assert/strict'
import test from 'node:test'

import { createCommercialAnalyticsStore, __testables } from '../commercialAnalyticsStore.js'

function compact(sql) { return String(sql).replace(/\s+/g, ' ').trim().toLowerCase() }

function createReadyPool() {
    const mutations = new Map()
    const metricRows = []
    let metricInserts = 0
    const pool = {
        async connect() { return client },
        async query(sql, params) { return query(sql, params) },
        state: { mutations, metricRows, get metricInserts() { return metricInserts } },
    }
    const client = { query, release() {} }
    async function query(sql, params = []) {
        const statement = compact(sql)
        if (statement.startsWith('select to_regclass')) {
            return { rows: [{ registry: 'crm_atendimento.schema_migrations', windows: 'windows', definitions: 'definitions', versions: 'versions', metrics: 'metrics', events: 'events', mutations: 'mutations', experiments: 'experiments', assignments: 'assignments' }] }
        }
        if (statement.includes('from crm_atendimento.schema_migrations')) return { rows: [{ id: '20260807_commercial_analytics_v2' }] }
        if (['begin', 'commit', 'rollback'].includes(statement) || statement.startsWith('set local') || statement.includes('pg_advisory_xact_lock')) return { rows: [] }
        if (statement.startsWith('select id::text,slug from crm_atendimento.units')) return { rows: [{ id: '10000000-0000-4000-8000-000000000001', slug: params[0] }] }
        if (statement.includes('from crm_atendimento.commercial_analytics_mutations')) {
            const key = params.slice(0, 3).join(':')
            const value = mutations.get(key)
            return { rows: value ? [value] : [] }
        }
        if (statement.includes('insert into crm_atendimento.commercial_analytics_metric_snapshots')) {
            metricInserts += 1
            const row = {
                source_key: params[0], finding_key: params[1], unit_id: params[2], bucket_date: params[3],
                metrics: JSON.parse(params[4]), created_at: '2026-08-07T00:00:00.000Z',
            }
            metricRows.push(row)
            return { rows: [row] }
        }
        if (statement.includes('insert into crm_atendimento.commercial_analytics_mutations')) {
            const key = params.slice(0, 3).join(':')
            mutations.set(key, { request_fingerprint: params[3], response: JSON.parse(params[4]) })
            return { rows: [] }
        }
        throw new Error(`unexpected SQL: ${statement}`)
    }
    return pool
}

test('analytics store keeps metric snapshots system-only, unit-scoped and idempotent', async () => {
    const pool = createReadyPool()
    const store = createCommercialAnalyticsStore({ pool, mutationHmacKey: 'a'.repeat(48), clock: () => new Date('2026-08-07T10:00:00.000Z') })
    const actor = { id: 'system:clientes-source-refresh', role: 'SYSTEM', system: true }
    const payload = {
        sourceKey: 'freshness.crm-source', unit: 'centro', bucketDate: '2026-08-07',
        metrics: { coverage_identity: 0.99, records_read: 120 }, idempotencyKey: 'source-refresh-20260807',
    }
    const first = await store.recordMetricSnapshot(payload, actor)
    const second = await store.recordMetricSnapshot(payload, actor)
    assert.deepEqual(second, first)
    assert.equal(pool.state.metricInserts, 1)
    assert.equal(pool.state.metricRows[0].unit_id, '10000000-0000-4000-8000-000000000001')
    assert.equal(JSON.stringify(first).includes('@'), false)
    await assert.rejects(
        () => store.recordMetricSnapshot(payload, { id: 'manager-1', role: 'GESTOR' }),
        { code: 'ANALYTICS_SYSTEM_WRITER_REQUIRED' },
    )
})

test('analytics store rejects PII-shaped metric and snapshot input before persistence', () => {
    assert.throws(
        () => __testables.normalizeSafeObject({ coverage_identity: 1, email: 'cliente@example.com' }, 'ANALYTICS_METRIC_PAYLOAD_INVALID'),
        { code: 'ANALYTICS_METRIC_PAYLOAD_INVALID' },
    )
    assert.throws(
        () => __testables.normalizeSafeObject({ coverage_identity: 1, operator_label: 'Ana' }, 'ANALYTICS_METRIC_PAYLOAD_INVALID'),
        { code: 'ANALYTICS_METRIC_PAYLOAD_INVALID' },
    )
    assert.throws(
        () => __testables.normalizeSnapshotMembers([{ identityId: '10000000-0000-4000-8000-000000000001', phone: '+55 51 99999-9999' }]),
        { code: 'ANALYTICS_SNAPSHOT_MEMBERS_INVALID' },
    )
    assert.throws(
        () => __testables.opaqueActorId({ email: 'manager@example.com' }),
        { code: 'ANALYTICS_ACTOR_ID_REQUIRED' },
    )
})
