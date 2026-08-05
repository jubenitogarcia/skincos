import assert from 'node:assert/strict'
import test from 'node:test'

import { loadHarmoniaConfig, normalizeWorkerMode } from '../config.js'
import {
    hasHumanConfirmation,
    startHarmoniaWorker,
} from '../worker.js'

function withEnv(values, fn) {
    const previous = {}
    for (const [key, value] of Object.entries(values)) {
        previous[key] = process.env[key]
        if (value == null) delete process.env[key]
        else process.env[key] = value
    }
    try {
        return fn()
    } finally {
        for (const [key, value] of Object.entries(previous)) {
            if (value == null) delete process.env[key]
            else process.env[key] = value
        }
    }
}

test('worker mode normalization is explicit and fail-closed', () => {
    assert.equal(normalizeWorkerMode('observe'), 'observe')
    assert.equal(normalizeWorkerMode('human-confirmed'), 'assisted')
    assert.equal(normalizeWorkerMode('garbage'), 'disabled')
    assert.equal(normalizeWorkerMode('garbage', 'observe'), 'observe')
})

test('legacy HARMONIA_WORKER flag only enables read-only observe mode', () => {
    withEnv({
        CRM_CONTINUOUS_WORKERS_MODE: null,
        HARMONIA_WORKER_MODE: null,
        HARMONIA_WORKER: '1',
        HARMONIA_AUTO_EXECUTE: '1',
    }, () => {
        const config = loadHarmoniaConfig({ varDir: '/tmp/skincos-test' })
        assert.equal(config.workerMode, 'observe')
        assert.equal(config.outboundMode, 'blocked')
        assert.equal(config.autoExecute, false)
        assert.equal(config.autoExecuteRequested, true)
    })
})

test('human confirmation requires status, approver, timestamp and idempotency key', () => {
    assert.equal(hasHumanConfirmation(null), false)
    assert.equal(hasHumanConfirmation({ humanConfirmation: { status: 'confirmed' } }), false)
    assert.equal(hasHumanConfirmation({
        humanConfirmation: {
            status: 'confirmed',
            approvedBy: 'operator@example.test',
            approvedAt: '2026-08-05T12:00:00.000Z',
            idempotencyKey: 'task-1-send-1',
        },
    }), true)
})

test('observe mode reads queue stats without claiming or invoking messaging', async () => {
    const previousDatabaseUrl = process.env.DATABASE_URL
    process.env.DATABASE_URL = 'postgres://test.invalid/crm'
    let claims = 0
    let stats = 0
    let providers = 0
    const store = {
        withTransaction: async (fn) => fn({}),
        claimTasks: () => { claims += 1; return [] },
        getTaskStats: () => { stats += 1; return { byStatus: { pending: 2 }, byType: {}, oldestPendingAt: null, oldestProcessingAt: null } },
    }
    const worker = startHarmoniaWorker({
        varDir: '/tmp/skincos-test',
        mode: 'observe',
        intervalMs: 60_000,
        storeFactory: () => store,
        providerFactory: () => { providers += 1; return {} },
    })
    await new Promise((resolve) => setImmediate(resolve))
    const status = worker.getStatus()
    await worker.stop()

    assert.equal(claims, 0)
    assert.equal(providers, 0)
    assert.ok(stats >= 1)
    assert.equal(status.ready, true)
    assert.deepEqual(status.queue.byStatus, { pending: 2 })
    if (previousDatabaseUrl == null) delete process.env.DATABASE_URL
    else process.env.DATABASE_URL = previousDatabaseUrl
})

test('assisted mode blocks outbound tasks without confirmation', async () => {
    const previousDatabaseUrl = process.env.DATABASE_URL
    process.env.DATABASE_URL = 'postgres://test.invalid/crm'
    let sends = 0
    const store = {
        withTransaction: async (fn) => fn({}),
        getConversationWithContact: () => null,
        getTaskStats: () => ({ byStatus: {}, byType: {}, oldestPendingAt: null, oldestProcessingAt: null }),
    }
    const worker = startHarmoniaWorker({
        varDir: '/tmp/skincos-test',
        mode: 'assisted',
        intervalMs: 60_000,
        storeFactory: () => store,
        providerFactory: () => ({ sendMessage: async () => { sends += 1 } }),
    })
    await assert.rejects(
        worker.processTask({ type: 'SEND_MESSAGE', payload: { to: '5511999999999', text: 'Oi' } }),
        (error) => error.code === 'HUMAN_CONFIRMATION_REQUIRED',
    )
    assert.equal(sends, 0)
    await worker.stop()
    if (previousDatabaseUrl == null) delete process.env.DATABASE_URL
    else process.env.DATABASE_URL = previousDatabaseUrl
})
