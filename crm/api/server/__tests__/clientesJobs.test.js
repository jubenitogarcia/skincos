import assert from 'node:assert/strict'
import test from 'node:test'

import {
    CLIENTES_CONTINUOUS_JOB_IDS,
    createClientesContinuousJobs,
    runClientesSourceRefresh,
    runOptOutIngestion,
    runQualityRefresh,
} from '../workers/clientesJobs.js'

const LOCAL_DATABASE_URL = 'postgresql://skincos@/skincos_crm_local?host=/var/run/postgresql'

function fakePool() {
    const lockClient = {
        query: async () => ({ rows: [{ acquired: true }] }),
        release: () => {},
    }
    return {
        query: async (sql) => {
            if (sql.includes('current_database')) return { rows: [{ database_name: 'skincos_crm_local', current_user: 'skincos' }] }
            return { rows: [{ opted_out_contacts: 4, latest_opt_out_at: '2026-08-06T10:00:00.000Z' }] }
        },
        connect: async () => lockClient,
    }
}

test('Clientes continuous job catalog keeps opt-outs, source and quality separate', () => {
    const jobs = createClientesContinuousJobs({
        pool: fakePool(),
        databaseUrl: LOCAL_DATABASE_URL,
        env: {
            CRM_CLIENTES_SOURCE_REFRESH_TARGET: 'production',
            CRM_CLIENTES_SOURCE_REFRESH_ACTION: 'dry-run',
        },
    })
    assert.deepEqual(jobs.map((job) => job.id), Object.values(CLIENTES_CONTINUOUS_JOB_IDS))
    assert.ok(jobs.every((job) => job.intervalMs > 0))
})

test('opt-out ingestion stores aggregate consent state without contact payloads', async () => {
    const result = await runOptOutIngestion({ pool: fakePool() })
    assert.deepEqual(result, {
        imported: 4,
        latestOptOutAt: '2026-08-06T10:00:00.000Z',
        source: 'harmonia.contacts',
        executionKey: null,
    })
})

test('continuous job catalog propagates the persisted execution key to each job', async () => {
    const received = []
    const jobs = createClientesContinuousJobs({
        pool: fakePool(),
        databaseUrl: LOCAL_DATABASE_URL,
        env: { CRM_CLIENTES_SOURCE_REFRESH_TARGET: 'production' },
        optOutRunner: async (context) => { received.push(['opt-out', context.executionKey]) },
        sourceRunner: async (context) => { received.push(['source', context.executionKey]) },
        qualityRunner: async (context) => { received.push(['quality', context.executionKey]) },
    })

    await Promise.all(jobs.map((job) => job.run({ executionKey: 'clientes.test:2026-08-07T00:00:00.000Z' })))
    assert.deepEqual(received, [
        ['opt-out', 'clientes.test:2026-08-07T00:00:00.000Z'],
        ['source', 'clientes.test:2026-08-07T00:00:00.000Z'],
        ['quality', 'clientes.test:2026-08-07T00:00:00.000Z'],
    ])
})

test('source refresh is target-bound, locked and idempotent at the adapter boundary', async () => {
    let imported = 0
    const result = await runClientesSourceRefresh({
        pool: fakePool(),
        databaseUrl: LOCAL_DATABASE_URL,
        env: {
            CRM_CLIENTES_SOURCE_REFRESH_TARGET: 'production',
            CRM_CLIENTES_SOURCE_REFRESH_ACTION: 'dry-run',
        },
        importer: async () => {
            imported += 1
            return { dryRun: true, records: 2, inserted: 0, updated: 0, skipped: 2, tabs: ['Novo Hamburgo'] }
        },
        storeFactory: () => ({}),
    })
    assert.equal(imported, 1)
    assert.equal(result.target, 'production')
    assert.equal(result.dryRun, true)
    assert.equal(result.records, 2)
})

test('quality refresh uses an explicit global admin actor', async () => {
    let actor
    const result = await runQualityRefresh({
        pool: fakePool(),
        databaseUrl: LOCAL_DATABASE_URL,
        env: { CRM_CLIENTES_SOURCE_REFRESH_TARGET: 'production' },
        qualityStoreFactory: () => ({
            refresh: async (value) => {
                actor = value
                return { refreshed: 3, findings: [{ findingKey: 'one' }], sourceFreshness: { ageHours: 1 } }
            },
        }),
    })
    assert.equal(actor.role, 'ADMIN')
    assert.equal(actor.isGlobalAdmin, true)
    assert.equal(result.refreshed, 3)
    assert.equal(result.findings, 1)
})
