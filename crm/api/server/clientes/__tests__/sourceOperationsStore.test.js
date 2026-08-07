import assert from 'node:assert/strict'
import test from 'node:test'

import {
    __testables,
    createClientesSourceOperationsStore,
} from '../sourceOperationsStore.js'

const HASH = 'sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'

function completeObservation() {
    return {
        sourceId: 'atendimento.local_mirror',
        watermark: '2026-08-07T15:00:00.000Z',
        fingerprint: HASH,
        snapshotComplete: true,
        recordsRead: 3,
        recordsApplied: 2,
        recordsSkipped: 1,
        divergences: 0,
        coverage: {
            recordsPresent: 3,
            recordsExpected: 3,
            partitionsPresent: 1,
            partitionsExpected: 1,
            divergences: 0,
            sourceKind: 'synthetic',
            schemaVersion: 'v1',
        },
        checkpoint: {
            nextWatermark: '2026-08-07T15:00:00.000Z',
            cursorHash: HASH,
        },
        snapshotProof: {
            kind: 'partition_count',
            expectedRecords: 3,
            observedRecords: 3,
            expectedPartitions: 1,
            observedPartitions: 1,
            scopeHash: HASH,
        },
    }
}

test('source operation metadata accepts only aggregate proof fields and never copies transient source rows', () => {
    const observation = {
        ...completeObservation(),
        snapshot: { rawCustomer: 'must-not-reach-ledger' },
    }
    const metadata = __testables.sourceMetadata('atendimento.local_mirror', observation)

    assert.equal(metadata.recordsRead, 3)
    assert.equal(metadata.proofScopeHash, HASH)
    assert.doesNotMatch(JSON.stringify(metadata), /must-not-reach-ledger/)
    assert.throws(() => __testables.sourceMetadata('atendimento.local_mirror', {
        ...completeObservation(),
        snapshotProof: { ...completeObservation().snapshotProof, observedRecords: 2 },
    }), { code: 'SOURCE_SNAPSHOT_PROOF_INVALID' })
    assert.throws(() => __testables.sourceMetadata('atendimento.local_mirror', {
        ...completeObservation(),
        coverage: { ...completeObservation().coverage, sourceKind: 'raw customer name' },
    }), { code: 'SOURCE_COVERAGE_METADATA_INVALID' })
    assert.throws(() => __testables.sourceMetadata('atendimento.local_mirror', {
        ...completeObservation(),
        watermark: '5511999999999',
    }), { code: 'SOURCE_SNAPSHOT_PROOF_INVALID' })
})

test('checkpoint maps validated and applied snapshots separately and forces a post-rollback apply', () => {
    const row = {
        source_id: 'atendimento.local_mirror',
        last_status: 'partial',
        validated_watermark: '2026-08-07T15:00:00.000Z',
        validated_fingerprint: HASH,
        validated_snapshot_complete: true,
        validated_at: '2026-08-07T15:00:00.000Z',
        validated_proof_kind: 'partition_count',
        validated_proof_expected_records: 3,
        validated_proof_observed_records: 3,
        validated_proof_expected_partitions: 1,
        validated_proof_observed_partitions: 1,
        validated_proof_scope_hash: HASH,
        resume_watermark: '2026-08-07T15:00:00.000Z',
        resume_cursor_hash: HASH,
        applied_watermark: '2026-08-07T15:00:00.000Z',
        applied_fingerprint: HASH,
        applied_snapshot_complete: true,
        applied_at: '2026-08-07T15:00:01.000Z',
        reconciliation_required: true,
    }
    const checkpoint = __testables.mapCheckpoint(row)

    assert.equal(checkpoint.validatedSnapshotComplete, true)
    assert.equal(checkpoint.appliedEvidenceSnapshotComplete, true)
    assert.equal(checkpoint.appliedSnapshotComplete, false)
    assert.equal(checkpoint.validatedFingerprint, HASH)
    assert.equal(checkpoint.appliedFingerprint, HASH)
    assert.equal(checkpoint.resumeWatermark, '2026-08-07T15:00:00.000Z')
    assert.equal(checkpoint.checkpoint.cursorHash, HASH)
})

test('freshness opens preventively at 20 hours, becomes high above 48 hours, and only clears when current state is healthy', () => {
    const now = new Date('2026-08-08T16:00:00.000Z')
    const preventive = __testables.freshnessInput({
        status: 'complete',
        validatedAt: '2026-08-07T20:00:00.000Z',
        reconciliationRequired: false,
    }, now)
    const high = __testables.freshnessInput({
        status: 'complete',
        validatedAt: '2026-08-06T15:59:59.000Z',
        reconciliationRequired: false,
    }, now)
    const unhealthyDespiteFreshRead = __testables.freshnessInput({
        status: 'partial',
        validatedAt: '2026-08-08T15:00:00.000Z',
        reconciliationRequired: true,
    }, now)

    assert.deepEqual({ state: preventive.state, healthy: preventive.healthy, severity: preventive.severity }, {
        state: 'preventive', healthy: false, severity: 'medium',
    })
    assert.deepEqual({ state: high.state, healthy: high.healthy, severity: high.severity }, {
        state: 'high', healthy: false, severity: 'high',
    })
    assert.equal(unhealthyDespiteFreshRead.healthy, false)
    assert.equal(__testables.findingTransition({ status: 'resolved', observed_count: 0 }, 1).nextStatus, 'open')
    assert.equal(__testables.findingTransition({ status: 'open', observed_count: 1 }, 0).nextStatus, 'resolved')
    assert.equal(__testables.findingTransition({ status: 'open', observed_count: 1 }, 1).nextStatus, 'open')
})

test('backup metadata requires an opaque reference, encryption, a restorable marker and a manifest hash', () => {
    assert.deepEqual(__testables.assertBackup({
        reference: 'backup.synthetic.001',
        manifestHash: HASH,
        encrypted: true,
        restorable: true,
    }), {
        reference: 'backup.synthetic.001',
        manifestHash: HASH,
        encrypted: true,
        restorable: true,
    })
    assert.throws(() => __testables.assertBackup({
        reference: '/unsafe/path.dump',
        manifestHash: HASH,
        encrypted: true,
        restorable: true,
    }), { code: 'SOURCE_BACKUP_REQUIRED' })
})

test('source lock stays on one PostgreSQL session and does not wrap a callback in a long transaction', async () => {
    const calls = []
    const client = {
        query: async (sql) => {
            calls.push(String(sql))
            if (/pg_try_advisory_lock/.test(sql)) return { rows: [{ acquired: true }] }
            return { rows: [] }
        },
        release: () => calls.push('release'),
    }
    const store = createClientesSourceOperationsStore({
        pool: { connect: async () => client },
        catalog: [],
    })

    const result = await store.withSourceLock('atendimento.local_mirror', async (connection) => {
        assert.equal(connection, client)
        return 'locked-work-complete'
    })

    assert.equal(result, 'locked-work-complete')
    assert.equal(calls.some((sql) => /^begin$/i.test(sql)), false)
    assert.equal(calls.some((sql) => /pg_try_advisory_lock/.test(sql)), true)
    assert.equal(calls.some((sql) => /pg_advisory_unlock/.test(sql)), true)
    assert.equal(calls.at(-1), 'release')
})

test('markApplying records an immutable encrypted backup before the run becomes applying', async () => {
    const calls = []
    const run = {
        id: '00000000-0000-4000-8000-000000000001',
        source_id: 'atendimento.local_mirror',
        execution_key: 'source.apply.one',
        mode: 'apply',
        status: 'reading',
        attempt_count: 1,
    }
    const client = {
        query: async (sql, params = []) => {
            calls.push({ sql: String(sql), params })
            if (/select \* from crm_atendimento\.clientes_source_operation_runs/.test(sql)) return { rows: [run] }
            if (/insert into crm_atendimento\.clientes_source_operation_backups/.test(sql)) {
                return {
                    rows: [{
                        id: '00000000-0000-4000-8000-000000000002',
                        backup_reference: 'backup.synthetic.001',
                        manifest_hash: HASH,
                        encrypted: true,
                        restorable: true,
                    }],
                }
            }
            if (/update crm_atendimento\.clientes_source_operation_runs/.test(sql)) {
                return { rows: [{ ...run, status: 'applying', backup_id: '00000000-0000-4000-8000-000000000002' }] }
            }
            return { rows: [] }
        },
        release: () => {},
    }
    const store = createClientesSourceOperationsStore({
        pool: { connect: async () => client },
        catalog: [{ id: 'atendimento.local_mirror', cadenceMs: 60_000 }],
    })

    const result = await store.markApplying({
        runId: run.id,
        sourceId: run.source_id,
        observation: completeObservation(),
        backup: { reference: 'backup.synthetic.001', manifestHash: HASH, encrypted: true, restorable: true },
    })

    const backupAt = calls.findIndex((call) => /insert into crm_atendimento\.clientes_source_operation_backups/.test(call.sql))
    const applyingAt = calls.findIndex((call) => /update crm_atendimento\.clientes_source_operation_runs/.test(call.sql))
    assert.equal(result.status, 'applying')
    assert.equal(backupAt >= 0 && backupAt < applyingAt, true)
    assert.equal(calls.some((call) => /rawCustomer|snapshot/.test(JSON.stringify(call.params))), false)
})
