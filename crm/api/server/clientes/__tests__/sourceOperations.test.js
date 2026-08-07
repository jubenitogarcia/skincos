import assert from 'node:assert/strict'
import test from 'node:test'

import {
    CLIENTES_SOURCE_CATALOG,
    clientesSourceIds,
    requiredClientesSources,
} from '../sourceCatalog.js'
import {
    aggregateFingerprint,
    compareWatermarks,
    createClientesSourceOperationsRunner,
    normalizeSourceObservation,
    sourceExecutionKey,
    sourceFreshnessState,
} from '../sourceOperations.js'

const NOW = new Date('2026-08-07T15:00:00.000Z')
const SOURCE = Object.freeze({
    id: 'atendimento.local_mirror',
    required: true,
    kind: 'postgresql_snapshot',
    cadenceMs: 60_000,
})

function operationError(code, retryable = true) {
    const error = new Error(code)
    error.code = code
    error.retryable = retryable
    return error
}

function completeSnapshot({
    sourceId = SOURCE.id,
    sequence = 'one',
    watermark = '2026-08-07T14:00:00.000Z',
    recordsRead = 3,
    partitions = 1,
    snapshot = undefined,
} = {}) {
    return {
        status: 'complete',
        watermark,
        fingerprint: aggregateFingerprint({ sourceId, sequence }),
        recordsRead,
        coverage: {
            recordsPresent: recordsRead,
            recordsExpected: recordsRead,
            partitionsPresent: partitions,
            partitionsExpected: partitions,
            divergences: 0,
            sourceKind: 'synthetic',
        },
        snapshotProof: {
            complete: true,
            kind: 'partition_count',
            sourceId,
            expectedRecords: recordsRead,
            observedRecords: recordsRead,
            expectedPartitions: partitions,
            observedPartitions: partitions,
            scopeHash: aggregateFingerprint({ sourceId, sequence, scope: 'synthetic' }),
        },
        snapshot,
        checkpoint: {
            nextWatermark: watermark,
            cursorHash: aggregateFingerprint({ sourceId, sequence, cursor: 'synthetic' }),
        },
    }
}

function createMemoryStore(catalog = [SOURCE]) {
    const locks = new Set()
    const checkpoints = new Map()
    const runsByKey = new Map()
    const runsById = new Map()
    const events = []
    let counter = 0

    const runFor = (runId) => runsById.get(runId)
    const operationKey = (sourceId, executionKey, mode = 'dry-run') => `${sourceId}:${mode}:${executionKey}`
    const upsertRun = (run) => {
        runsById.set(run.id, run)
        runsByKey.set(operationKey(run.sourceId, run.executionKey, run.mode), run)
        return run
    }

    return {
        checkpoints,
        events,
        runsById,
        async withSourceLock(sourceId, callback) {
            if (locks.has(sourceId)) throw operationError('SOURCE_LOCK_BUSY', true)
            locks.add(sourceId)
            try {
                return await callback({ sourceId })
            } finally {
                locks.delete(sourceId)
            }
        },
        async getCheckpoint(sourceId) {
            return checkpoints.get(sourceId) || null
        },
        async beginRun({ sourceId, executionKey, mode }) {
            const existing = runsByKey.get(operationKey(sourceId, executionKey, mode))
            if (existing) return {
                ...existing,
                completed: existing.status === 'complete' || existing.status === 'skipped',
            }
            counter += 1
            return upsertRun({ id: `run-${counter}`, sourceId, executionKey, mode, status: 'reading' })
        },
        async recordRead({ runId, observation }) {
            const run = runFor(runId)
            run.observation = observation
            run.status = 'read'
            events.push({ kind: 'read', runId })
        },
        async markApplying({ runId, observation, backup }) {
            const run = runFor(runId)
            run.status = 'applying'
            run.observation = observation
            run.backup = backup
            events.push({ kind: 'applying', runId })
        },
        async completeRun({ runId, sourceId, observation, mode, applied, skipped, backup }) {
            const run = runFor(runId)
            run.status = 'complete'
            run.observation = observation
            run.mode = mode
            run.applied = applied === true
            run.skipped = skipped === true
            run.backup = backup || run.backup || null
            const checkpoint = checkpoints.get(sourceId) || { sourceId }
            if (mode === 'dry-run' || applied === true) {
                checkpoint.validatedFingerprint = observation.fingerprint
                checkpoint.validatedWatermark = observation.watermark
                checkpoint.validatedSnapshotComplete = observation.snapshotComplete
            }
            if (applied === true) {
                checkpoint.appliedFingerprint = observation.fingerprint
                checkpoint.appliedWatermark = observation.watermark
                checkpoint.appliedSnapshotComplete = observation.snapshotComplete
            }
            checkpoint.nextRunAt = '2099-01-01T00:00:00.000Z'
            checkpoints.set(sourceId, checkpoint)
            events.push({ kind: 'complete', runId })
        },
        async failRun({ runId, status, observation, error }) {
            const run = runFor(runId)
            run.status = status
            run.observation = observation || run.observation || null
            run.error = error?.code || null
            events.push({ kind: 'failed', runId, status, code: error?.code || null })
        },
        async refreshFreshnessFindings({ sourceId }) {
            events.push({ kind: 'freshness', sourceId })
        },
        async getOperationalView() {
            return catalog.map((source) => {
                const latest = [...runsById.values()].filter((run) => run.sourceId === source.id).at(-1)
                return { sourceId: source.id, required: source.required, status: latest?.status || 'missing' }
            })
        },
        async recordRollback({ sourceId, backupReference, executionKey }) {
            events.push({ kind: 'rollback', sourceId, backupReference, executionKey })
        },
        seedApplying(sourceId, executionKey, mode = 'apply') {
            counter += 1
            return upsertRun({ id: `run-${counter}`, sourceId, executionKey, mode, status: 'applying' })
        },
    }
}

function createRunner({ store = createMemoryStore(), adapters, applyEnabled = false, applyConfirmed = false, catalog = [SOURCE] } = {}) {
    return createClientesSourceOperationsRunner({
        store,
        catalog,
        adapters,
        target: 'local',
        applyEnabled,
        applyConfirmed,
        clock: () => NOW,
    })
}

test('maps every effective Clientes source without connector or customer identifiers', () => {
    assert.deepEqual(clientesSourceIds(), [
        'atendimento.local_mirror',
        'atendimento.google_sheet',
        'cadastro.gerencia_google_sheet',
        'vendas.caixa_google_sheet',
        'cadastro.app_registrations',
        'leads.supplemental_google_sheet',
        'consent.harmonia_opt_outs',
        'blocks.commercial_permissions',
        'identity.global_graph',
    ])
    assert.equal(requiredClientesSources().length, 8)
    assert.equal(CLIENTES_SOURCE_CATALOG.some((source) => /https?:|@/.test(JSON.stringify(source))), false)
})

test('requires a typed complete snapshot proof and keeps the transient payload out of serializable output', () => {
    const raw = completeSnapshot({ snapshot: { privateRecord: 'synthetic-private-record' } })
    const observation = normalizeSourceObservation(SOURCE, raw, NOW.toISOString())

    assert.equal(observation.status, 'complete')
    assert.equal(observation.snapshotComplete, true)
    assert.equal(observation.snapshot.privateRecord, 'synthetic-private-record')
    assert.doesNotMatch(JSON.stringify(observation), /synthetic-private-record/)

    const incomplete = normalizeSourceObservation(SOURCE, {
        ...raw,
        snapshotProof: { ...raw.snapshotProof, observedPartitions: 0 },
    }, NOW.toISOString())
    assert.equal(incomplete.status, 'incomplete')
    assert.equal(incomplete.snapshotComplete, false)
})

test('runs dry-run, records a valid checkpoint, and repeats idempotently despite a changed watermark', async () => {
    const store = createMemoryStore()
    let reads = 0
    const runner = createRunner({
        store,
        adapters: {
            [SOURCE.id]: {
                read: async () => {
                    reads += 1
                    return completeSnapshot({ watermark: reads === 1 ? '2026-08-07T14:00:00.000Z' : '2026-08-07T14:30:00.000Z' })
                },
            },
        },
    })

    const first = await runner.runSource(SOURCE.id, { executionKey: 'source.dry-run-one', mode: 'dry-run' })
    const repeated = await runner.runSource(SOURCE.id, { executionKey: 'source.dry-run-two', mode: 'dry-run', force: true })

    assert.equal(first.status, 'complete')
    assert.equal(first.dryRun, true)
    assert.equal(repeated.status, 'skipped')
    assert.equal(repeated.idempotent, true)
    assert.equal(reads, 2)
    assert.equal(store.events.filter((event) => event.kind === 'complete').length, 2)
})

test('allows a proven dry-run snapshot to be applied once, then idempotently skips the same apply', async () => {
    const store = createMemoryStore()
    let applied = 0
    const adapters = {
        [SOURCE.id]: {
            read: async () => completeSnapshot({ sequence: 'apply-after-dry-run' }),
            backup: async () => ({
                reference: 'backup.synthetic.apply-after-dry-run',
                encrypted: true,
                restorable: true,
                manifestHash: aggregateFingerprint({ backup: 'apply-after-dry-run' }),
            }),
            apply: async () => { applied += 1; return { recordsApplied: 3 } },
        },
    }
    const dryRunner = createRunner({ store, adapters })
    const applyRunner = createRunner({ store, adapters, applyEnabled: true, applyConfirmed: true })

    const dryRun = await dryRunner.runSource(SOURCE.id, { executionKey: 'source.dry-run-before-apply', mode: 'dry-run' })
    const apply = await applyRunner.runSource(SOURCE.id, { executionKey: 'source.apply-after-dry-run', mode: 'apply' })
    const repeatedApply = await applyRunner.runSource(SOURCE.id, { executionKey: 'source.apply-after-dry-run-repeat', mode: 'apply' })

    assert.equal(dryRun.status, 'complete')
    assert.equal(apply.status, 'complete')
    assert.equal(repeatedApply.status, 'skipped')
    assert.equal(applied, 1)
})

test('does not apply an incomplete snapshot and refreshes freshness findings', async () => {
    const store = createMemoryStore()
    let applied = 0
    const runner = createRunner({
        store,
        adapters: {
            [SOURCE.id]: {
                read: async () => ({
                    ...completeSnapshot(),
                    snapshotProof: { ...completeSnapshot().snapshotProof, expectedRecords: 4 },
                }),
                backup: async () => ({ reference: 'backup.synthetic', encrypted: true, restorable: true, manifestHash: aggregateFingerprint({ backup: 'one' }) }),
                apply: async () => { applied += 1 },
            },
        },
        applyEnabled: true,
        applyConfirmed: true,
    })

    const result = await runner.runSource(SOURCE.id, { executionKey: 'source.incomplete', mode: 'apply' })
    assert.equal(result.status, 'incomplete')
    assert.equal(result.error.code, 'SOURCE_SNAPSHOT_INCOMPLETE')
    assert.equal(applied, 0)
    assert.equal(store.events.some((event) => event.kind === 'freshness'), true)
})

test('requires an encrypted restorable backup, forbids retirement and resumes a transient apply failure safely', async () => {
    const store = createMemoryStore()
    let attempts = 0
    let receivedAllowRetireMissing
    const adapter = {
        read: async () => completeSnapshot({ sequence: 'resume' }),
        backup: async () => ({
            reference: 'backup.synthetic.resume',
            encrypted: true,
            restorable: true,
            manifestHash: aggregateFingerprint({ backup: 'resume' }),
        }),
        apply: async ({ allowRetireMissing }) => {
            attempts += 1
            receivedAllowRetireMissing = allowRetireMissing
            if (attempts === 1) throw operationError('SOURCE_APPLY_TRANSIENT', true)
            return { recordsApplied: 3, retiredRecords: 0 }
        },
    }
    const runner = createRunner({ store, adapters: { [SOURCE.id]: adapter }, applyEnabled: true, applyConfirmed: true })

    await assert.rejects(
        () => runner.runSource(SOURCE.id, { executionKey: 'source.resume', mode: 'apply' }),
        (error) => error?.sourceOperation?.status === 'partial' && error?.sourceOperation?.error?.code === 'SOURCE_APPLY_TRANSIENT',
    )
    const resumed = await runner.runSource(SOURCE.id, { executionKey: 'source.resume', mode: 'apply' })

    assert.equal(resumed.status, 'complete')
    assert.equal(resumed.recordsApplied, 3)
    assert.equal(attempts, 2)
    assert.equal(receivedAllowRetireMissing, false)
})

test('fails closed after a crash in applying state unless the adapter can reconcile it', async () => {
    const store = createMemoryStore()
    store.seedApplying(SOURCE.id, 'source.crash')
    let applied = 0
    const runner = createRunner({
        store,
        adapters: { [SOURCE.id]: { read: async () => completeSnapshot(), apply: async () => { applied += 1 } } },
        applyEnabled: true,
        applyConfirmed: true,
    })

    const result = await runner.runSource(SOURCE.id, { executionKey: 'source.crash', mode: 'apply' })
    assert.equal(result.status, 'invalid')
    assert.equal(result.error.code, 'SOURCE_APPLY_RECOVERY_REQUIRED')
    assert.equal(applied, 0)
})

test('propagates retryable source failures to the continuous scheduler after persisting their state', async () => {
    const store = createMemoryStore()
    const runner = createRunner({
        store,
        adapters: {
            [SOURCE.id]: {
                read: async () => { throw operationError('SOURCE_DEPENDENCY_TRANSIENT', true) },
            },
        },
    })

    await assert.rejects(
        () => runner.runDue({ executionKey: 'source.batch-retry', mode: 'dry-run', force: true }),
        (error) => error?.code === 'SOURCE_OPERATION_RETRY_REQUIRED' && error?.sourceOperations?.[0]?.sourceId === SOURCE.id,
    )
    assert.equal([...store.runsById.values()][0]?.status, 'partial')
})

test('serializes concurrent workers with a durable source lock and treats contention as a skip', async () => {
    const store = createMemoryStore()
    let releaseRead
    const readStarted = new Promise((resolve) => { releaseRead = resolve })
    let continueRead
    const readBarrier = new Promise((resolve) => { continueRead = resolve })
    const adapters = {
        [SOURCE.id]: {
            read: async () => {
                releaseRead()
                await readBarrier
                return completeSnapshot({ sequence: 'concurrent' })
            },
        },
    }
    const firstRunner = createRunner({ store, adapters })
    const secondRunner = createRunner({ store, adapters })

    const first = firstRunner.runSource(SOURCE.id, { executionKey: 'source.concurrent.one', mode: 'dry-run' })
    await readStarted
    const second = await secondRunner.runSource(SOURCE.id, { executionKey: 'source.concurrent.two', mode: 'dry-run' })
    continueRead()
    const firstResult = await first

    assert.equal(firstResult.status, 'complete')
    assert.deepEqual(second, { sourceId: SOURCE.id, status: 'skipped', reason: 'locked' })
})

test('rejects an older complete snapshot even when an operator forces an immediate run', async () => {
    const store = createMemoryStore()
    store.checkpoints.set(SOURCE.id, {
        sourceId: SOURCE.id,
        snapshotComplete: true,
        fingerprint: aggregateFingerprint({ sourceId: SOURCE.id, sequence: 'newer' }),
        watermark: '2026-08-07T14:30:00.000Z',
    })
    const runner = createRunner({
        store,
        adapters: { [SOURCE.id]: { read: async () => completeSnapshot({ sequence: 'older', watermark: '2026-08-07T14:00:00.000Z' }) } },
    })

    const result = await runner.runSource(SOURCE.id, { executionKey: 'source.older', mode: 'dry-run', force: true })
    assert.equal(result.status, 'invalid')
    assert.equal(result.error.code, 'SOURCE_SNAPSHOT_OLDER_THAN_CHECKPOINT')
})

test('records unavailable sources, exposes safe freshness thresholds, and only rolls back through the adapter', async () => {
    const store = createMemoryStore()
    const runner = createRunner({ store, adapters: {} })
    const unavailable = await runner.runSource(SOURCE.id, { executionKey: 'source.unavailable', mode: 'dry-run' })
    assert.equal(unavailable.status, 'unavailable')
    assert.equal(unavailable.error.code, 'SOURCE_ADAPTER_MISSING')

    let rollbackRequest
    const rollbackRunner = createRunner({
        store,
        adapters: {
            [SOURCE.id]: {
                read: async () => completeSnapshot(),
                rollback: async (request) => {
                    rollbackRequest = request
                    return { rolledBack: true }
                },
            },
        },
    })
    const rollback = await rollbackRunner.rollbackSource(SOURCE.id, {
        backupReference: 'backup.synthetic.rollback',
        executionKey: 'source.rollback',
    })

    assert.deepEqual(rollback, { sourceId: SOURCE.id, rolledBack: true })
    assert.equal(rollbackRequest.target, 'local')
    assert.equal(sourceFreshnessState('2026-08-06T19:00:00.000Z', NOW), 'preventive')
    assert.equal(sourceFreshnessState('2026-08-05T14:59:59.000Z', NOW), 'high')
    assert.equal(sourceFreshnessState(null, NOW), 'missing')
    assert.equal(compareWatermarks('2026-08-07T14:00:00.000Z', '2026-08-07T14:30:00.000Z'), -1)
    assert.match(sourceExecutionKey('source.batch', SOURCE.id), /^source:[a-f0-9]{64}$/)
})
