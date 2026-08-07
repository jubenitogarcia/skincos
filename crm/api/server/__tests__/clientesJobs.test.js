import assert from 'node:assert/strict'
import test from 'node:test'

import {
    CLIENTES_CONTINUOUS_JOB_IDS,
    assertClientesSourceOperationsDatabaseIdentity,
    createClientesContinuousJobs,
    normalizeClientesSourceOperationsTarget,
    runClientesSourceOperations,
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

test('Clientes continuous job catalog keeps opt-outs, source, quality and clinical expiry separate', async () => {
    const jobs = createClientesContinuousJobs({
        pool: fakePool(),
        databaseUrl: LOCAL_DATABASE_URL,
        env: {
            CRM_CLIENTES_SOURCE_OPERATIONS_TARGET: 'local',
            CRM_CLIENTES_SOURCE_OPERATIONS_MODE: 'dry-run',
        },
    })
    assert.deepEqual(jobs.map((job) => job.id), Object.values(CLIENTES_CONTINUOUS_JOB_IDS))
    assert.ok(jobs.every((job) => job.intervalMs > 0))
    const expiry = jobs.find((job) => job.id === CLIENTES_CONTINUOUS_JOB_IDS.CLINICAL_APPROVAL_EXPIRY)
    assert.equal(expiry.required, false)
    assert.deepEqual(await expiry.run({ executionKey: 'clientes.test:2026-08-07T00:00:00.000Z' }), {
        ok: true,
        ready: true,
        enabled: false,
        target: null,
        skipped: 'job_disabled',
        expired: 0,
    })
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
        env: { CRM_CLIENTES_SOURCE_OPERATIONS_TARGET: 'local' },
        optOutRunner: async (context) => { received.push(['opt-out', context.executionKey]) },
        sourceRunner: async (context) => { received.push(['source', context.executionKey]) },
        qualityRunner: async (context) => { received.push(['quality', context.executionKey]) },
        clinicalExpiryJobFactory: ({ pool, databaseUrl, env }) => ({
            id: CLIENTES_CONTINUOUS_JOB_IDS.CLINICAL_APPROVAL_EXPIRY,
            intervalMs: 60_000,
            required: false,
            run: async (context) => {
                assert.equal(pool != null, true)
                assert.equal(databaseUrl, LOCAL_DATABASE_URL)
                assert.equal(env.CRM_CLIENTES_SOURCE_OPERATIONS_TARGET, 'local')
                received.push(['clinical-expiry', context.executionKey])
            },
        }),
    })

    await Promise.all(jobs.map((job) => job.run({ executionKey: 'clientes.test:2026-08-07T00:00:00.000Z' })))
    assert.deepEqual(received, [
        ['opt-out', 'clientes.test:2026-08-07T00:00:00.000Z'],
        ['source', 'clientes.test:2026-08-07T00:00:00.000Z'],
        ['quality', 'clientes.test:2026-08-07T00:00:00.000Z'],
        ['clinical-expiry', 'clientes.test:2026-08-07T00:00:00.000Z'],
    ])
})

test('source operations are target-bound, ledger-backed and expose only safe results', async () => {
    let received
    const result = await runClientesSourceOperations({
        pool: fakePool(),
        databaseUrl: LOCAL_DATABASE_URL,
        env: {
            CRM_CLIENTES_SOURCE_OPERATIONS_TARGET: 'local',
            CRM_CLIENTES_SOURCE_OPERATIONS_MODE: 'dry-run',
        },
        storeFactory: () => ({ store: true }),
        adaptersFactory: () => ({ adapter: true }),
        runnerFactory: (options) => ({
            async runDue(context) {
                received = { options, context }
                return {
                    ready: false,
                    unhealthyRequired: ['cadastro.app_registrations'],
                    results: [{ sourceId: 'cadastro.app_registrations', status: 'unavailable', error: { code: 'SOURCE_CONNECTOR_UNAVAILABLE' } }],
                }
            },
        }),
        executionKey: 'clientes.test:2026-08-07T00:00:00.000Z',
    })
    assert.equal(received.options.target, 'local')
    assert.equal(received.context.mode, 'dry-run')
    assert.equal(result.target, 'local')
    assert.equal(result.ready, false)
    assert.deepEqual(result.unhealthyRequired, ['cadastro.app_registrations'])
    assert.deepEqual(result.sources, [{
        sourceId: 'cadastro.app_registrations', status: 'unavailable', recordsRead: 0, recordsApplied: 0, errorCode: 'SOURCE_CONNECTOR_UNAVAILABLE',
    }])
})

test('quality refresh uses an explicit global admin actor', async () => {
    let actor
    const result = await runQualityRefresh({
        pool: fakePool(),
        databaseUrl: LOCAL_DATABASE_URL,
        env: { CRM_CLIENTES_SOURCE_OPERATIONS_TARGET: 'local' },
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

test('source operations reject production and require an explicit safe database identity', () => {
    assert.throws(() => normalizeClientesSourceOperationsTarget('production'), /CLIENTES_SOURCE_OPERATIONS_TARGET_INVALID/)
    assert.throws(
        () => assertClientesSourceOperationsDatabaseIdentity({ database_name: 'skincos_crm_local', current_user: 'postgres' }, 'local'),
        /CLIENTES_SOURCE_OPERATIONS_LOCAL_IDENTITY_UNSAFE/,
    )
    assert.deepEqual(
        assertClientesSourceOperationsDatabaseIdentity({ database_name: 'skincos_staging', current_user: 'skincos_staging_crm_app' }, 'staging'),
        { target: 'staging', database: 'skincos_staging', user: 'skincos_staging_crm_app' },
    )
})
