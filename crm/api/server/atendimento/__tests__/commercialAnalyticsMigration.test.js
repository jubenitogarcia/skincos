import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

import {
    __testables,
    applyCommercialAnalyticsMigration,
    commercialAnalyticsMigrationPlan,
} from '../commercialAnalyticsMigration.js'
import { COMMERCIAL_ANALYTICS_MIGRATION_ID } from '../commercialAnalytics.js'

test('commercial analytics migration is additive, PII-rejecting and has only least-privilege runtime access', () => {
    const plan = commercialAnalyticsMigrationPlan()
    const sql = __testables.STATEMENTS.join('\n').toLowerCase()
    const grants = __testables.runtimeGrantStatements('staging').join('\n').toLowerCase()
    assert.equal(plan.id, COMMERCIAL_ANALYTICS_MIGRATION_ID)
    assert.match(plan.segmentPolicy, /snake_case/i)
    assert.match(plan.experimentPolicy, /commercial-experiment-crossover/i)
    assert.equal(plan.safety.messagesEnabled, false)
    assert.match(sql, /valid_commercial_segment_criteria/)
    assert.match(sql, /item\.key ~ '\[a-z\]'/)
    assert.match(sql, /email\|e_\?mail\|phone\|telefone/)
    assert.match(sql, /commercial_experiment_assignments/)
    assert.match(sql, /commercial_experiment_assignments_immutable/)
    assert.match(sql, /before update or delete/)
    assert.match(sql, /before truncate/)
    assert.ok(__testables.PREREQUISITE_RELATIONS.includes('crm_atendimento.global_client_identities'))
    assert.doesNotMatch(sql, /drop\s+table/)
    assert.doesNotMatch(sql, /on delete cascade/)
    assert.match(grants, /grant select on table crm_atendimento\.schema_migrations to skincos_staging_crm_app/)
    assert.match(grants, /grant select, insert on table crm_atendimento\.commercial_experiment_assignments/)
    assert.match(grants, /grant usage on schema crm_caixa to skincos_staging_crm_app/)
    assert.doesNotMatch(grants, /grant\s+(?:all privileges|delete|truncate)/)
})

test('commercial analytics migration refuses an unsafe destination before connecting', async () => {
    let connected = false
    await assert.rejects(() => applyCommercialAnalyticsMigration({
        pool: { connect: async () => { connected = true } },
        databaseUrl: 'postgresql://unsafe.example.invalid/skincos_crm_local', target: 'production',
    }), { code: 'COMMERCIAL_ANALYTICS_MIGRATION_DESTINATION_UNSAFE' })
    assert.equal(connected, false)
})

test('commercial analytics migration holds its advisory lock in an explicit transaction and rolls back failures', async () => {
    const source = await readFile(new URL('../commercialAnalyticsMigration.js', import.meta.url), 'utf8')
    for (const migration of ['applyCommercialAnalyticsMigration', 'rollbackCommercialAnalyticsMigration']) {
        const start = source.indexOf(`export async function ${migration}`)
        assert.notEqual(start, -1)
        const end = source.indexOf('\nexport ', start + 1)
        const block = source.slice(start, end === -1 ? undefined : end)
        assert.match(block, /await client\.query\('begin'\)/)
        assert.match(block, /set local lock_timeout/)
        assert.match(block, /pg_advisory_xact_lock/)
        assert.match(block, /await client\.query\('commit'\)/)
        assert.match(block, /await client\.query\('rollback'\)/)
    }
})
