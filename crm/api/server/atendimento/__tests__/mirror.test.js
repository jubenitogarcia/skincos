import test from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'

import { __testables, preflightAtendimentoMirror, syncAtendimentoMirror } from '../mirror.js'

const require = createRequire(import.meta.url)
const { parse: parsePgConnectionString } = require('pg-connection-string')

const MIRROR_TABLES = [
    'units',
    'professionals',
    'procedures',
    'procedure_price_codes',
    'attendances',
    'schedule_days',
    'import_batches',
    'raw_sheet_rows',
    'management_items',
    'inventory_items',
    'monthly_unit_goals',
    'monthly_unit_goal_levels',
    'goal_table_rows',
]

function createReadOnlyPool({ identity, tables = {}, range = {}, queries, events, label = '', extraQuery }) {
    return {
        async connect() {
            return {
                async query(sql) {
                    queries.push(sql)
                    if (events && label) events.push(`${label}:${String(sql).replace(/\s+/g, ' ').trim()}`)
                    const extra = extraQuery?.(sql)
                    if (extra) return extra
                    if (/^begin\b|^commit\b|^rollback\b/i.test(sql.trim())) return { rows: [], fields: [] }
                    if (/current_database\(\)/i.test(sql)) return { rows: [identity], fields: [] }
                    if (/has_table_privilege/i.test(sql)) {
                        return {
                            rows: [{ can_select: true, can_insert: false, can_update: false, can_delete: false }],
                            fields: [],
                        }
                    }
                    if (/min\(service_date\)/i.test(sql)) return { rows: [range], fields: [] }
                    const table = sql.match(/from crm_atendimento\."([a-z_]+)"/i)?.[1]
                    if (table) {
                        const rows = tables[table] || []
                        return {
                            rows,
                            fields: Object.keys(rows[0] || {}).map((name) => ({ name })),
                        }
                    }
                    throw new Error(`Unexpected query: ${sql}`)
                },
                release() {},
            }
        },
        async end() {},
    }
}

function sourceTables(clientName = 'Pessoa de teste') {
    return {
        attendances: [{
            id: 'attendance-1',
            client_name: clientName,
            service_date: '2026-08-02',
            updated_at: '2026-08-03T14:05:06.000Z',
        }],
    }
}

test('defaults mutable CRM state to the native Linux filesystem', () => {
    assert.equal(__testables.DEFAULT_CRM_RUNTIME_HOME, '/var/lib/skincos-runtime/crm')
    assert.doesNotMatch(__testables.DEFAULT_CRM_RUNTIME_HOME, /^\/mnt\//)
})

test('accepts only the local Atendimento mirror database as destination', () => {
    assert.equal(
        __testables.isLocalMirrorDestination('postgresql://skincos@/skincos_crm_local?host=/var/run/postgresql'),
        true,
    )
    assert.equal(
        __testables.isLocalMirrorDestination('postgresql://skincos@127.0.0.1:5432/skincos_crm_local'),
        true,
    )
    assert.equal(
        __testables.isLocalMirrorDestination('postgresql://skincos@db.example.test:5432/skincos_crm_local'),
        false,
    )
    assert.equal(
        __testables.isLocalMirrorDestination('postgresql://skincos@127.0.0.1:5432/skincos_crm'),
        false,
    )
    assert.equal(
        __testables.isStrictLocalMirrorDestination('postgresql:///skincos_crm_local?host=/var/run/postgresql'),
        true,
    )
    assert.equal(
        __testables.isStrictLocalMirrorDestination('postgresql://admin@127.0.0.1:5432/skincos_crm_local'),
        false,
    )
    const duplicateHost = 'postgresql:///skincos_crm_local?host=%2Fvar%2Frun%2Fpostgresql&host=db.example.test&port=5432'
    assert.equal(__testables.isStrictLocalMirrorDestination(duplicateHost), false)
    assert.equal(parsePgConnectionString(duplicateHost).host, 'db.example.test')
    assert.equal(
        __testables.isStrictLocalMirrorDestination('postgresql:///skincos_crm_local?host=%2Fvar%2Frun%2Fpostgresql&sslmode=disable'),
        false,
    )
})

test('builds a non-sensitive connection fingerprint for source and destination comparison', () => {
    const source = __testables.connectionFingerprint('postgresql://reader:secret@db.example.test:5432/production')
    const sameEndpointDifferentPassword = __testables.connectionFingerprint('postgresql://reader:other-secret@db.example.test:5432/production')
    const otherDatabase = __testables.connectionFingerprint('postgresql://reader:secret@db.example.test:5432/other')

    assert.equal(source, sameEndpointDifferentPassword)
    assert.notEqual(source, otherDatabase)
    assert.doesNotMatch(source, /secret/)
})

test('preflight reads source and destination only and returns sanitized freshness evidence', async () => {
    const destinationQueries = []
    const sourceQueries = []
    const destinationPool = createReadOnlyPool({
        identity: {
            database_name: 'skincos_crm_local',
            database_user: 'admin',
            server_address: '127.0.0.1',
            transaction_read_only: 'on',
        },
        queries: destinationQueries,
    })
    const sourcePool = createReadOnlyPool({
        identity: {
            database_name: 'crm_source',
            database_user: 'reader',
            server_address: '10.20.30.40',
            transaction_read_only: 'on',
        },
        tables: sourceTables(),
        range: {
            min_service_date: '2026-08-02',
            max_service_date: '2026-08-02',
        },
        queries: sourceQueries,
    })
    const createPool = (url) => url.includes('source.example.test') ? sourcePool : destinationPool

    const result = await preflightAtendimentoMirror({
        sourceUrl: 'postgresql://reader:secret@source.example.test:5432/crm_source',
        destinationUrl: 'postgresql://admin@127.0.0.1:5432/skincos_crm_local',
        createPool,
        observedAt: '2026-08-04T15:00:00.000Z',
    })

    assert.deepEqual(result.destination, { local: true, reachable: true })
    assert.equal(result.preflight, true)
    assert.equal(result.dryRun, true)
    assert.equal(result.attendances, 1)
    assert.equal(result.rowCounts.attendances, 1)
    assert.equal(result.sourceFreshness.observedAt, '2026-08-04T15:00:00.000Z')
    assert.equal(result.sourceFreshness.latestSourceUpdateAt, '2026-08-03T14:05:06.000Z')
    assert.match(result.sourceFingerprint, /^[a-f0-9]{16}$/)
    assert.doesNotMatch(JSON.stringify(result), /Pessoa de teste|source\.example\.test|reader|secret/)
    assert.ok(destinationQueries.some((query) => /^begin read only$/i.test(query.trim())))
    assert.ok(sourceQueries.some((query) => /^begin transaction isolation level repeatable read read only$/i.test(query.trim())))
    assert.equal(sourceQueries.filter((query) => /has_table_privilege/i.test(query)).length, MIRROR_TABLES.length)

    for (const query of [...destinationQueries, ...sourceQueries]) {
        assert.doesNotMatch(query, /create\s+table|insert\s+into|update\s+crm_|delete\s+from|truncate\s+table|alter\s+table|drop\s+schema/i)
    }
})

test('preflight source fingerprint changes without exposing source rows', async () => {
    const evidence = (clientName) => __testables.sourcePreflightEvidence({
        database_name: 'crm_source',
        database_user: 'reader',
        server_address: '10.20.30.40',
    }, {
        tables: Object.fromEntries(Object.entries(sourceTables(clientName)).map(([table, rows]) => [table, { rows }])),
        range: {
            min_service_date: '2026-08-02',
            max_service_date: '2026-08-02',
        },
    }, '2026-08-04T15:00:00.000Z')

    const initial = evidence('Pessoa de teste')
    const changed = evidence('Outra pessoa de teste')

    assert.notEqual(initial.sourceFingerprint, changed.sourceFingerprint)
    assert.doesNotMatch(JSON.stringify(changed), /Outra pessoa de teste|10\.20\.30\.40|reader/)
})

test('dry-run uses the same source snapshot fingerprint and freshness evidence as a preflight', async () => {
    const runDryRun = async (clientName) => {
        const sourcePool = createReadOnlyPool({
            identity: {
                database_name: 'crm_source',
                database_user: 'reader',
                server_address: '10.20.30.40',
                transaction_read_only: 'on',
            },
            tables: sourceTables(clientName),
            range: { min_service_date: '2026-08-02', max_service_date: '2026-08-02' },
            queries: [],
        })
        const destinationPool = createReadOnlyPool({
            identity: {
                database_name: 'skincos_crm_local',
                database_user: 'admin',
                server_address: '127.0.0.1',
                transaction_read_only: 'off',
            },
            queries: [],
        })
        return syncAtendimentoMirror({
            sourceUrl: 'postgresql://reader:secret@source.example.test:5432/crm_source',
            destinationUrl: 'postgresql://admin@127.0.0.1:5432/skincos_crm_local',
            dryRun: true,
            createPool: (url) => url.includes('source.example.test') ? sourcePool : destinationPool,
            observedAt: '2026-08-04T15:00:00.000Z',
        })
    }

    const first = await runDryRun('Pessoa de teste')
    const changed = await runDryRun('Outra pessoa de teste')

    assert.match(first.sourceFingerprint, /^[a-f0-9]{16}$/)
    assert.notEqual(first.sourceFingerprint, changed.sourceFingerprint)
    assert.equal(first.sourceFreshness.observedAt, '2026-08-04T15:00:00.000Z')
    assert.equal(first.sourceFreshness.latestSourceUpdateAt, '2026-08-03T14:05:06.000Z')
    assert.doesNotMatch(JSON.stringify(changed), /Outra pessoa de teste|10\.20\.30\.40|reader|secret/)
})

test('refuses a mutable mirror sync over TCP before opening either connection', async () => {
    let createPoolCalled = false
    await assert.rejects(
        () => syncAtendimentoMirror({
            sourceUrl: 'postgresql://reader:secret@source.example.test:5432/crm_source',
            destinationUrl: 'postgresql://admin@127.0.0.1:5432/skincos_crm_local',
            dryRun: false,
            createPool: () => {
                createPoolCalled = true
                throw new Error('connection should not be opened')
            },
        }),
        (error) => error?.code === 'MIRROR_DESTINATION_UNSAFE',
    )
    assert.equal(createPoolCalled, false)
})

test('acquires the mutable mirror lock before reading the source snapshot', async () => {
    const events = []
    const destinationPool = createReadOnlyPool({
        identity: {
            database_name: 'skincos_crm_local',
            database_user: 'admin',
            server_address: '',
            transaction_read_only: 'off',
        },
        queries: [],
        events,
        label: 'destination',
        extraQuery(sql) {
            if (/pg_try_advisory_lock/i.test(sql)) return { rows: [{ acquired: true }], fields: [] }
            if (/pg_advisory_unlock/i.test(sql)) return { rows: [], fields: [] }
            if (/from information_schema\.columns/i.test(sql)) {
                return { rows: ['id', 'client_name', 'service_date', 'updated_at'].map((column_name) => ({ column_name })), fields: [] }
            }
            if (/^create table|^truncate table|^insert into crm_atendimento\./i.test(sql.trim())) {
                return { rows: [], fields: [] }
            }
            return null
        },
    })
    const sourcePool = createReadOnlyPool({
        identity: {
            database_name: 'crm_source',
            database_user: 'reader',
            server_address: '10.20.30.40',
            transaction_read_only: 'on',
        },
        queries: [],
        events,
        label: 'source',
        tables: sourceTables(),
        range: { min_service_date: '2026-08-02', max_service_date: '2026-08-02' },
    })

    await syncAtendimentoMirror({
        sourceUrl: 'postgresql://reader:secret@source.example.test:5432/crm_source',
        destinationUrl: 'postgresql:///skincos_crm_local?host=/var/run/postgresql',
        dryRun: false,
        createPool: (url) => url.includes('source.example.test') ? sourcePool : destinationPool,
        migrateDestination: async () => {},
        backupDestination: async () => '/tmp/atendimento-mirror-checkpoint.dump',
    })

    const lockAt = events.findIndex((event) => /destination:select pg_try_advisory_lock/i.test(event))
    const sourceReadAt = events.findIndex((event) => /source:begin transaction isolation level repeatable read read only/i.test(event))
    assert.ok(lockAt >= 0)
    assert.ok(sourceReadAt >= 0)
    assert.ok(lockAt < sourceReadAt)
})
