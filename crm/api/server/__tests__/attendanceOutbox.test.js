import assert from 'node:assert/strict'
import test from 'node:test'
import { claimAttendanceSignalDelivery, deliverAttendanceSignal, eventKeyForCommercialAction, nextDelivery, reconcileAttendanceSignals, replayAttendanceSignalDeadLetter } from '../events/attendanceOutbox.js'

function fakePool({ inboxRows = [{ event_id: 'event-1' }] } = {}) {
    const calls = []
    const client = { query: async (sql) => { calls.push(sql); if (/insert into harmonia.event_inbox/i.test(sql)) return { rows: inboxRows }; return { rows: [] } }, release: () => {} }
    return { calls, connect: async () => client, query: async (sql) => { calls.push(sql); return { rows: [{ id: 'row-1' }], rowCount: 1 } } }
}

const delivery = { delivery_id: 'delivery-1', event_id: 'event-1', event_type: 'atendimento.commercial-action.created.v1', event_version: 1, attempts: 1, payload: { actionId: 'action-1', identityId: 'identity-1', actionType: 'contact', segmentKey: 'new' } }

test('outbox event key prevents duplicate commercial action publication', () => {
    assert.equal(eventKeyForCommercialAction('action-1'), eventKeyForCommercialAction('action-1'))
    assert.throws(() => eventKeyForCommercialAction(''), /EVENT_AGGREGATE_ID_REQUIRED/)
})

test('delayed retry and dead letter follow bounded exponential policy', () => {
    const retry = nextDelivery({ attempts: 1, now: new Date('2026-01-01T00:00:00Z'), baseDelaySeconds: 5 })
    assert.equal(retry.status, 'retrying')
    assert.equal(retry.availableAt, '2026-01-01T00:00:05.000Z')
    assert.equal(nextDelivery({ attempts: 3, maxAttempts: 3 }).status, 'dead_letter')
})

test('an expired consumer lease becomes eligible for recovery', async () => {
    const pool = fakePool()
    await claimAttendanceSignalDelivery(pool, { limit: 1 })
    const claim = pool.calls.find((sql) => /with candidate/i.test(sql))
    assert.match(claim, /lease_until < now\(\)/i)
    assert.match(claim, /interval '60 seconds'/i)
})

test('consumer retries, dead-letters, replays and remains idempotent', async () => {
    const retryPool = fakePool()
    const retry = await deliverAttendanceSignal(retryPool, delivery, { handler: async () => { throw new Error('consumer down') }, maxAttempts: 3, now: new Date('2026-01-01T00:00:00Z') })
    assert.equal(retry.status, 'retrying')
    assert.equal(retryPool.calls.some((sql) => /set status=\$2/i.test(sql)), true)
    const dlq = await deliverAttendanceSignal(fakePool(), { ...delivery, attempts: 3 }, { handler: async () => { throw new Error('consumer down') }, maxAttempts: 3 })
    assert.equal(dlq.status, 'dead_letter')

    let handled = 0
    const first = await deliverAttendanceSignal(fakePool(), delivery, { handler: async () => { handled += 1 } })
    const duplicate = await deliverAttendanceSignal(fakePool({ inboxRows: [] }), delivery, { handler: async () => { handled += 1 } })
    assert.equal(first.status, 'delivered')
    assert.equal(duplicate.status, 'delivered')
    assert.equal(handled, 1)

    const adminPool = fakePool()
    assert.equal(await replayAttendanceSignalDeadLetter(adminPool, 'event-1'), true)
    assert.deepEqual(await reconcileAttendanceSignals(adminPool), { repairedDeliveries: 2 })
})
