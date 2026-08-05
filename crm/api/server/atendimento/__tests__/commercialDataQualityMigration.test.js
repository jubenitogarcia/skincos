import test from 'node:test'
import assert from 'node:assert/strict'

import {
    COMMERCIAL_DATA_QUALITY_INDEXES,
    COMMERCIAL_DATA_QUALITY_MIGRATION_ID,
    applyCommercialDataQualityMigration,
    commercialDataQualityMigrationPlan,
    parseCommercialDataQualityMigrationAction,
} from '../commercialDataQualityMigration.js'

const LOCAL_SOCKET_URL = 'postgresql:///skincos_crm_local?host=/var/run/postgresql'

function localMigrationClient({ indexValidity = () => true } = {}) {
    const calls = []
    let released = false
    const client = {
        async query(sql, params = []) {
            calls.push({ sql, params })
            if (/current_database\(\)/i.test(sql)) {
                return { rows: [{ database_name: 'skincos_crm_local', database_user: 'admin', read_only: 'off' }] }
            }
            if (/to_regclass\('crm_atendimento\.canonical_clients'\)/i.test(sql)) {
                return { rows: [{ relation_0: 'canonical_clients', relation_1: 'attendance_links', relation_2: 'attendances', relation_3: 'identities', relation_4: 'members', relation_5: 'merges', relation_6: 'caixa_links', relation_7: 'app_attendance', relation_8: 'app_caixa', relation_9: 'lead_app', relation_10: 'lead_caixa', relation_11: 'mirror', relation_12: 'imports', relation_13: 'actions', relation_14: 'permissions', relation_15: 'permission_events', relation_16: 'policy', relation_17: 'sale_items' }] }
            }
            if (/from pg_catalog\.pg_index/i.test(sql)) {
                const value = indexValidity({ indexName: params[0], calls })
                return { rows: value === null ? [] : [{ indisvalid: value }] }
            }
            return { rows: [], rowCount: 0 }
        },
        release() { released = true },
    }
    return { client, calls, get released() { return released } }
}

test('defines an aggregate-only, append-only commercial data quality queue', () => {
    const plan = commercialDataQualityMigrationPlan()

    assert.equal(plan.id, COMMERCIAL_DATA_QUALITY_MIGRATION_ID)
    assert.deepEqual(plan.adds, ['commercial_data_quality_findings', 'commercial_data_quality_finding_events'])
    assert.match(plan.queuePolicy, /aggregate counts/i)
    assert.match(plan.queuePolicy, /names, phones, email/i)
    assert.match(plan.auditPolicy, /optimistic revision/i)
    assert.match(plan.rollback, /non-destructive/i)
})

test('requires exactly one known data quality migration action', () => {
    assert.equal(parseCommercialDataQualityMigrationAction(['--apply']), 'apply')
    assert.equal(parseCommercialDataQualityMigrationAction(['--rollback']), 'rollback')
    for (const args of [[], ['--unknown'], ['--apply', '--rollback'], ['--apply', '--apply'], ['--apply', '--unknown']]) {
        assert.throws(
            () => parseCommercialDataQualityMigrationAction(args),
            (error) => error?.code === 'COMMERCIAL_DATA_QUALITY_MIGRATION_ACTION_INVALID',
        )
    }
})

test('creates the queue and immutable event ledger only after local prerequisite checks', async () => {
    const fixture = localMigrationClient()

    const report = await applyCommercialDataQualityMigration({
        pool: { connect: async () => fixture.client },
        databaseUrl: LOCAL_SOCKET_URL,
    })

    assert.equal(report.applied, true)
    assert.deepEqual(report.tables, ['commercial_data_quality_findings', 'commercial_data_quality_finding_events'])
    assert.deepEqual(report.repairedIndexes, [])
    assert.equal(fixture.released, true)
    const indexOf = (pattern) => fixture.calls.findIndex(({ sql }) => pattern.test(String(sql).replace(/\s+/g, ' ')))
    const findings = indexOf(/create table if not exists crm_atendimento\.commercial_data_quality_findings/i)
    const events = indexOf(/create table if not exists crm_atendimento\.commercial_data_quality_finding_events/i)
    const immutable = indexOf(/create trigger commercial_data_quality_finding_events_immutable before update or delete/i)
    const noTruncate = indexOf(/create trigger commercial_data_quality_finding_events_no_truncate before truncate/i)
    const registry = indexOf(/insert into crm_atendimento\.schema_migrations/i)

    assert.ok(findings >= 0)
    assert.ok(events > findings)
    assert.ok(immutable > events)
    assert.ok(noTruncate > immutable)
    assert.ok(registry > noTruncate)
    for (const index of COMMERCIAL_DATA_QUALITY_INDEXES) {
        assert.match(index.createSql, new RegExp(`create index concurrently if not exists ${index.name}\\s+on crm_atendimento\\.`, 'i'))
        assert.doesNotMatch(index.createSql, /if not exists crm_atendimento\./i)
    }
    assert.equal(fixture.calls.some(({ sql }) => /canonical_name|phone_raw|email|backup_path/i.test(sql)), false)
})

test('repairs a pre-existing invalid concurrent index before recording the migration', async () => {
    const target = COMMERCIAL_DATA_QUALITY_INDEXES[0]
    let targetChecks = 0
    const fixture = localMigrationClient({
        indexValidity: ({ indexName }) => {
            if (indexName !== target.qualifiedName) return true
            targetChecks += 1
            return targetChecks === 1 ? false : true
        },
    })

    const report = await applyCommercialDataQualityMigration({
        pool: { connect: async () => fixture.client },
        databaseUrl: LOCAL_SOCKET_URL,
    })

    assert.deepEqual(report.repairedIndexes, [target.name])
    assert.ok(fixture.calls.some(({ sql }) => new RegExp(`drop index concurrently if exists ${target.qualifiedName}`, 'i').test(String(sql).replace(/\s+/g, ' '))))
    assert.equal(targetChecks, 2)
})

test('fails explicitly when a concurrent index remains invalid after repair', async () => {
    const target = COMMERCIAL_DATA_QUALITY_INDEXES[0]
    const fixture = localMigrationClient({
        indexValidity: ({ indexName }) => indexName === target.qualifiedName ? false : true,
    })

    await assert.rejects(
        () => applyCommercialDataQualityMigration({
            pool: { connect: async () => fixture.client },
            databaseUrl: LOCAL_SOCKET_URL,
        }),
        (error) => error?.code === 'COMMERCIAL_DATA_QUALITY_MIGRATION_INDEX_INVALID' && error?.indexName === target.name,
    )
    assert.equal(fixture.released, true)
    assert.equal(fixture.calls.some(({ sql }) => /insert into crm_atendimento\.schema_migrations/i.test(sql)), false)
})

test('refuses a non-socket data quality migration before opening a connection', async () => {
    let connected = false
    await assert.rejects(
        () => applyCommercialDataQualityMigration({
            pool: { connect: async () => { connected = true } },
            databaseUrl: 'postgresql://admin@127.0.0.1:5432/skincos_crm_local',
        }),
        /COMMERCIAL_DATA_QUALITY_MIGRATION_DESTINATION_UNSAFE/,
    )
    assert.equal(connected, false)
})
