import test from 'node:test'
import assert from 'node:assert/strict'
import {
    createClientesSourceRunner,
    fingerprintSource,
    freshnessState,
} from '../sourceOperations.js'

function fakeStore() {
    const checkpoints = new Map()
    const runs = new Map()
    const idempotency = new Map()
    const locks = new Set()
    const state = { applied: 0, backups: 0, failures: 0, deadLetters: 0, findings: 0, rolledBack: 0 }
    return {
        state,
        checkpoints,
        async withSourceLock(sourceId, fn) {
            if (locks.has(sourceId)) {
                const error = new Error('SOURCE_LOCK_BUSY'); error.code = 'SOURCE_LOCK_BUSY'; error.retryable = true; throw error
            }
            locks.add(sourceId)
            try { return await fn({}) } finally { locks.delete(sourceId) }
        },
        async getCheckpoint(sourceId) { return checkpoints.get(sourceId) || null },
        async beginRun({ sourceId, scheduledAt, idempotencyKey, attempt }) {
            if (idempotency.has(idempotencyKey)) return { ...idempotency.get(idempotencyKey), existing: true }
            const run = { id: `run-${runs.size + 1}`, sourceId, scheduledAt, idempotencyKey, attempt, status: 'running' }
            idempotency.set(idempotencyKey, run); runs.set(run.id, run); return { ...run, existing: false }
        },
        async compareSourceOrder(sourceId, watermark) {
            const previous = checkpoints.get(sourceId)?.watermark
            if (!previous) return 1
            return String(watermark) === String(previous) ? 0 : String(watermark) > String(previous) ? 1 : -1
        },
        async completeRun({ runId, sourceId, observation, lastReadAt, lastAppliedAt, sameSnapshot }) {
            runs.get(runId).status = sameSnapshot ? 'skipped' : observation.status
            checkpoints.set(sourceId, {
                sourceId,
                ...observation,
                status: sameSnapshot ? 'skipped' : observation.status,
                lastReadAt,
                lastAppliedAt: lastAppliedAt || checkpoints.get(sourceId)?.lastAppliedAt || null,
                consecutiveFailures: 0,
                retries: checkpoints.get(sourceId)?.retries || 0,
                nextRunAt: null,
            })
        },
        async failRun({ runId, sourceId, observation = {}, error, retryAt, deadLetter = false, failureStatus = null, preserveCheckpoint = false }) {
            state.failures += 1
            runs.get(runId).status = failureStatus || (deadLetter ? 'dead' : 'partial')
            const previous = checkpoints.get(sourceId) || {}
            checkpoints.set(sourceId, {
                sourceId,
                ...observation,
                status: failureStatus || (deadLetter ? 'dead' : 'partial'),
                watermark: preserveCheckpoint ? previous.watermark : (observation.watermark || previous.watermark),
                fingerprint: preserveCheckpoint ? previous.fingerprint : (observation.fingerprint || previous.fingerprint),
                lastReadAt: observation.observedAt || previous.lastReadAt || null,
                lastAppliedAt: previous.lastAppliedAt || null,
                consecutiveFailures: Number(previous.consecutiveFailures || 0) + 1,
                retries: Number(previous.retries || 0) + 1,
                nextRunAt: retryAt || null,
                lastErrorCode: error?.code,
            })
            if (deadLetter) state.deadLetters += 1
        },
        async refreshFindings() { state.findings += 1 },
        async markRollback() { state.rolledBack += 1 },
    }
}

const catalog = [{ id: 'source.test', domain: 'test', label: 'Synthetic source', cadenceMs: 60_000, snapshotRequired: true, sourceKind: 'google_sheet' }]

test('dry-run records a complete observation without backup or apply', async () => {
    const store = fakeStore(); let applied = 0; let backedUp = 0
    const runner = createClientesSourceRunner({ catalog, store, applyEnabled: false, adapters: { 'source.test': { async read() { return { snapshotComplete: true, watermark: '2026-08-06T10:00:00Z', recordsRead: 3, coverage: { rows: 3 } } }, async backup() { backedUp += 1 }, async apply() { applied += 1 } } } })
    const result = await runner.runSource('source.test', { scheduledAt: '2026-08-06T10:00:00Z' })
    assert.equal(result.status, 'complete'); assert.equal(result.recordsApplied, 0); assert.equal(applied, 0); assert.equal(backedUp, 0)
    assert.equal(store.state.findings, 1)
})

test('apply is backed up and repeated fingerprint is idempotent', async () => {
    const store = fakeStore(); let applied = 0; let backedUp = 0
    const fingerprint = fingerprintSource({ rows: 2 })
    const runner = createClientesSourceRunner({ catalog, store, applyEnabled: true, adapters: { 'source.test': { async read() { return { snapshotComplete: true, watermark: '2026-08-06T11:00:00Z', fingerprint, recordsRead: 2, snapshot: { rows: [1, 2] } } }, async backup() { backedUp += 1; return 'backup-1' }, async apply() { applied += 1; return { recordsApplied: 2 } } } } })
    const first = await runner.runSource('source.test', { mode: 'apply', scheduledAt: '2026-08-06T11:00:00Z' })
    const second = await runner.runSource('source.test', { mode: 'apply', scheduledAt: '2026-08-06T11:01:00Z' })
    assert.equal(first.recordsApplied, 2); assert.equal(second.idempotent, true); assert.equal(applied, 1); assert.equal(backedUp, 1)
})

test('incomplete snapshot is never applied', async () => {
    const store = fakeStore(); let applied = 0; let backedUp = 0
    const runner = createClientesSourceRunner({ catalog, store, applyEnabled: true, adapters: { 'source.test': { async read() { return { snapshotComplete: false, watermark: '2026-08-06T12:00:00Z', recordsRead: 0 } }, async backup() { backedUp += 1 }, async apply() { applied += 1 } } } })
    const result = await runner.runSource('source.test', { mode: 'apply' })
    assert.equal(result.status, 'incomplete'); assert.equal(applied, 0); assert.equal(backedUp, 0); assert.equal(store.checkpoints.get('source.test').status, 'incomplete')
})

test('older watermark is invalid and cannot replace the newer checkpoint', async () => {
    const store = fakeStore(); let read = 0
    const runner = createClientesSourceRunner({ catalog, store, adapters: { 'source.test': { async read() { read += 1; return { snapshotComplete: true, watermark: read === 1 ? '2026-08-06T13:00:00Z' : '2026-08-06T12:00:00Z', recordsRead: 1 } } } } })
    await runner.runSource('source.test', { scheduledAt: '2026-08-06T13:00:00Z' })
    const result = await runner.runSource('source.test', { scheduledAt: '2026-08-06T13:01:00Z' })
    assert.equal(result.status, 'invalid'); assert.equal(store.checkpoints.get('source.test').watermark, '2026-08-06T13:00:00Z')
})

test('retry reaches dead-letter after max attempts', async () => {
    const store = fakeStore(); const error = Object.assign(new Error('temporary'), { code: 'UPSTREAM_TIMEOUT', retryable: true })
    const runner = createClientesSourceRunner({ catalog, store, maxAttempts: 2, retryBaseMs: 1, adapters: { 'source.test': { async read() { throw error } } } })
    const first = await runner.runSource('source.test', { scheduledAt: '2026-08-06T14:00:00Z' })
    const second = await runner.runSource('source.test', { scheduledAt: '2026-08-06T14:01:00Z', force: true })
    assert.equal(first.status, 'partial'); assert.equal(second.status, 'dead'); assert.equal(store.state.deadLetters, 1)
})

test('same-process concurrency is skipped and rollback is serialized', async () => {
    const store = fakeStore(); let release; const gate = new Promise((resolve) => { release = resolve }); let rollback = 0
    const runner = createClientesSourceRunner({ catalog, store, adapters: { 'source.test': { async read() { await gate; return { snapshotComplete: true, watermark: '2026-08-06T15:00:00Z' } }, async rollback() { rollback += 1 } } } })
    const first = runner.runSource('source.test')
    const second = await runner.runSource('source.test')
    release(); await first
    const result = await runner.rollback('source.test', 'backup-1')
    assert.equal(second.reason, 'already_running'); assert.equal(result.rolledBack, true); assert.equal(rollback, 1)
})

test('freshness thresholds expose healthy, preventive, high and missing', () => {
    const now = new Date('2026-08-06T16:00:00Z')
    assert.equal(freshnessState(null, now), 'missing')
    assert.equal(freshnessState('2026-08-06T15:00:00Z', now), 'healthy')
    assert.equal(freshnessState('2026-08-05T15:00:00Z', now), 'preventive')
    assert.equal(freshnessState('2026-08-04T15:00:00Z', now), 'high')
})
