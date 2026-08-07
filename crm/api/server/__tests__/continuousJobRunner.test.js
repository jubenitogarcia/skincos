import assert from 'node:assert/strict'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'

import { createContinuousJobRunner } from '../workers/jobRunner.js'

async function waitFor(predicate, timeoutMs = 1000) {
    const deadline = Date.now() + timeoutMs
    while (Date.now() < deadline) {
        if (predicate()) return
        await new Promise((resolve) => setTimeout(resolve, 5))
    }
    assert.fail('condition was not observed before timeout')
}

test('continuous jobs are independent, idempotent and expose retry metrics', async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'skincos-jobs-'))
    const statePath = path.join(directory, 'jobs.json')
    let firstRuns = 0
    let secondRuns = 0
    const runner = createContinuousJobRunner({
        statePath,
        retryBaseMs: 1,
        retryMaxMs: 4,
        maxAttempts: 3,
        jobs: [
            {
                id: 'clientes.first',
                intervalMs: 60_000,
                run: async ({ attempt }) => {
                    firstRuns += 1
                    if (attempt < 3) {
                        const error = new Error('temporary dependency')
                        error.code = 'DEPENDENCY_TEMPORARY'
                        throw error
                    }
                    return { ok: true }
                },
            },
            {
                id: 'clientes.second',
                intervalMs: 60_000,
                run: async () => {
                    secondRuns += 1
                    return { ok: true }
                },
            },
        ],
    })

    await runner.start()
    await waitFor(() => runner.getStatus().jobs['clientes.first'].status === 'succeeded')
    await waitFor(() => runner.getStatus().jobs['clientes.second'].status === 'succeeded')

    const status = runner.getStatus()
    assert.equal(firstRuns, 3)
    assert.equal(secondRuns, 1)
    assert.equal(status.ready, true)
    assert.equal(status.metrics.retries, 2)
    assert.equal(status.jobs['clientes.first'].lastAttemptCount, 3)
    assert.ok(Number.isFinite(status.jobs['clientes.first'].lastDurationMs))
    assert.ok(Number.isFinite(status.jobs['clientes.first'].lastLagMs))
    assert.equal((await runner.runOnce('clientes.first', {
        scheduledAt: Date.parse(status.jobs['clientes.first'].lastScheduledAt),
    })).skipped, 'idempotent')
    await runner.stop()

    const persisted = JSON.parse(await fs.readFile(statePath, 'utf8'))
    assert.equal(persisted.version, 1)
    assert.equal(persisted.jobs['clientes.first'].lastAttemptCount, 3)
})

test('permanent failure is retained as a dead-letter state', async () => {
    const runner = createContinuousJobRunner({
        retryBaseMs: 1,
        retryMaxMs: 2,
        maxAttempts: 2,
        jobs: [{
            id: 'clientes.permanent',
            intervalMs: 60_000,
            run: async () => {
                const error = new Error('permanent')
                error.code = 'PERMANENT_FAILURE'
                throw error
            },
        }],
    })
    await runner.start()
    await waitFor(() => runner.getStatus().jobs['clientes.permanent'].status === 'dead')
    const status = runner.getStatus()
    assert.equal(status.ready, false)
    assert.equal(status.deadLetters.length, 1)
    assert.equal(status.deadLetters[0].error, 'PERMANENT_FAILURE')
    assert.equal(status.metrics.retries, 1)
    await runner.stop()
})

test('stop waits for an in-flight job before returning', async () => {
    let release
    let started
    const startedPromise = new Promise((resolve) => { started = resolve })
    const gate = new Promise((resolve) => { release = resolve })
    const runner = createContinuousJobRunner({
        jobs: [{
            id: 'clientes.inflight',
            intervalMs: 60_000,
            run: async () => {
                started()
                await gate
            },
        }],
    })
    await runner.start()
    await startedPromise
    let stopped = false
    const stopping = runner.stop().then(() => { stopped = true })
    await new Promise((resolve) => setTimeout(resolve, 10))
    assert.equal(stopped, false)
    release()
    await stopping
    assert.equal(stopped, true)
    assert.equal(runner.getStatus().running, false)
})

test('refuses to execute jobs when the durable checkpoint cannot be persisted', async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'skincos-jobs-checkpoint-'))
    const statePath = path.join(directory, 'jobs.json')
    let runs = 0
    const fsImpl = {
        ...fs,
        async writeFile() {
            const error = new Error('checkpoint unavailable')
            error.code = 'EACCES'
            throw error
        },
    }
    const runner = createContinuousJobRunner({
        statePath,
        fsImpl,
        jobs: [{ id: 'clientes.checkpoint', intervalMs: 60_000, run: async () => { runs += 1 } }],
    })
    await runner.start()
    const status = runner.getStatus()
    assert.equal(runs, 0)
    assert.equal(status.running, false)
    assert.equal(status.ready, false)
    assert.equal(status.statePersistence.ready, false)
    await runner.stop()
})

test('holds one durable checkpoint lock across concurrent worker processes', async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'skincos-jobs-lock-'))
    const statePath = path.join(directory, 'jobs.json')
    let runs = 0
    const job = { id: 'clientes.locked', intervalMs: 60_000, run: async () => { runs += 1 } }
    const first = createContinuousJobRunner({ statePath, startImmediately: false, jobs: [job] })
    const second = createContinuousJobRunner({ statePath, startImmediately: false, jobs: [job] })
    await first.start()
    await second.start()
    assert.equal(first.getStatus().running, true)
    assert.equal(second.getStatus().running, false)
    assert.equal(second.getStatus().statePersistence.error, 'STATE_LOCK_UNAVAILABLE')
    assert.equal(runs, 0)
    await first.stop()
    await second.stop()
})

test('a transient job failure during shutdown resumes instead of becoming a dead letter', async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'skincos-jobs-shutdown-'))
    const statePath = path.join(directory, 'jobs.json')
    let release
    let started
    const startedPromise = new Promise((resolve) => { started = resolve })
    const gate = new Promise((resolve) => { release = resolve })
    const runner = createContinuousJobRunner({
        statePath,
        retryBaseMs: 1,
        jobs: [{
            id: 'clientes.shutdown-retry',
            intervalMs: 60_000,
            run: async () => {
                started()
                await gate
                const error = new Error('transient dependency')
                error.code = 'DEPENDENCY_TEMPORARY'
                throw error
            },
        }],
    })
    await runner.start()
    await startedPromise
    const stopping = runner.stop()
    release()
    await stopping
    const deferred = runner.getStatus()
    assert.equal(deferred.jobs['clientes.shutdown-retry'].status, 'idle')
    assert.ok(deferred.jobs['clientes.shutdown-retry'].pendingExecutionKey)
    assert.equal(deferred.deadLetters.length, 0)

    let recoveredAttempt = 0
    const recovery = createContinuousJobRunner({
        statePath,
        jobs: [{
            id: 'clientes.shutdown-retry',
            intervalMs: 60_000,
            run: async ({ attempt }) => { recoveredAttempt = attempt },
        }],
    })
    await recovery.start()
    await waitFor(() => recovery.getStatus().jobs['clientes.shutdown-retry'].status === 'succeeded')
    assert.equal(recoveredAttempt, 2)
    await recovery.stop()
})
