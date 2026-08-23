import test from 'node:test'
import assert from 'node:assert/strict'
import {
    asRecoverableIdentityMaterializationError,
    configureIdentityMaterializationTimeouts,
    loadOptionalSupplementalLeadSources,
} from '../identityMaterializationRuntime.js'

test('configures bounded transaction timeouts for identity materializers', async () => {
    const queries = []
    await configureIdentityMaterializationTimeouts({
        async query(sql) { queries.push(sql); return { rows: [] } },
    })
    assert.deepEqual(queries, [
        "set local lock_timeout = '3s'",
        "set local statement_timeout = '60s'",
    ])
})

test('marks PostgreSQL lock and statement cancellations as retryable materialization outcomes', () => {
    const lock = asRecoverableIdentityMaterializationError(Object.assign(new Error('lock'), { code: '55P03' }))
    const statement = asRecoverableIdentityMaterializationError(Object.assign(new Error('statement'), { code: '57014' }))
    const original = Object.assign(new Error('other'), { code: '23505' })

    assert.deepEqual(
        { code: lock.code, retryable: lock.retryable, statusCode: lock.statusCode, retryAfterSeconds: lock.retryAfterSeconds },
        { code: 'IDENTITY_MATERIALIZATION_LOCK_TIMEOUT_RETRY', retryable: true, statusCode: 409, retryAfterSeconds: 3 },
    )
    assert.deepEqual(
        { code: statement.code, retryable: statement.retryable, statusCode: statement.statusCode, retryAfterSeconds: statement.retryAfterSeconds },
        { code: 'IDENTITY_MATERIALIZATION_STATEMENT_TIMEOUT_RETRY', retryable: true, statusCode: 409, retryAfterSeconds: 3 },
    )
    assert.equal(asRecoverableIdentityMaterializationError(original), original)
})

test('keeps registration-only materialization available when supplemental lead tables are absent', async () => {
    const queries = []
    const sources = await loadOptionalSupplementalLeadSources({
        async query(sql) {
            queries.push(sql)
            return { rows: [{ profiles: false, app_links: false, caixa_links: false }] }
        },
    })
    assert.deepEqual(sources, { availability: 'absent', profiles: [], appLinks: [], caixaLinks: [] })
    assert.equal(queries.length, 1)
})

test('rejects a partial supplemental lead schema instead of silently splitting confirmed components', async () => {
    await assert.rejects(
        loadOptionalSupplementalLeadSources({
            async query() { return { rows: [{ profiles: true, app_links: false, caixa_links: true }] } },
        }),
        (error) => error?.code === 'IDENTITY_MATERIALIZATION_SUPPLEMENTAL_LEAD_SCHEMA_INCOMPLETE',
    )
})

test('loads all supplemental lead sources only when their schema is complete', async () => {
    const queries = []
    const sources = await loadOptionalSupplementalLeadSources({
        async query(sql) {
            queries.push(sql)
            if (sql.includes('to_regclass')) return { rows: [{ profiles: true, app_links: true, caixa_links: true }] }
            if (sql.includes('supplemental_lead_profiles')) return { rows: [{ id: 'lead-1', name: 'Lead' }] }
            if (sql.includes('supplemental_lead_profile_app_links')) return { rows: [{ profileId: 'lead-1', registrationId: 'app-1', status: 'confirmed' }] }
            return { rows: [{ profileId: 'lead-1', caixaCustomerId: 'caixa-1', status: 'confirmed' }] }
        },
    })
    assert.deepEqual(sources, {
        availability: 'available',
        profiles: [{ id: 'lead-1', name: 'Lead' }],
        appLinks: [{ profileId: 'lead-1', registrationId: 'app-1', status: 'confirmed' }],
        caixaLinks: [{ profileId: 'lead-1', caixaCustomerId: 'caixa-1', status: 'confirmed' }],
    })
    assert.equal(queries.length, 4)
})
