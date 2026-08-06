import test from 'node:test'
import assert from 'node:assert/strict'
import { createClientesSourceOperationsStore } from '../sourceOperationsStore.js'

test('source ledger operations stay on the PostgreSQL session holding the source lock', async () => {
    const calls = []
    const client = {
        async query(sql) {
            calls.push({ owner: 'locked-session', sql })
            if (sql.includes('pg_try_advisory_lock')) return { rows: [{ acquired: true }] }
            if (sql.includes('insert into crm_atendimento.clientes_source_runs')) return { rows: [{ id: 'run-1', source_id: 'source.test', status: 'running', idempotency_key: 'scheduled:test' }] }
            return { rows: [] }
        },
        release() { calls.push({ owner: 'locked-session', sql: 'release' }) },
    }
    const pool = {
        async connect() { return client },
        async query(sql) { calls.push({ owner: 'pool', sql }); throw new Error('unlocked pool query') },
    }
    const store = createClientesSourceOperationsStore({ pool, catalog: [] })
    const run = await store.withSourceLock('source.test', async (connection) => {
        assert.equal(connection, client)
        return store.beginRun({ sourceId: 'source.test', scheduledAt: '2026-08-06T00:00:00Z', idempotencyKey: 'scheduled:test', attempt: 1, connection })
    })
    assert.equal(run.id, 'run-1')
    assert.equal(calls.some((call) => call.owner === 'pool'), false)
})
