import test from 'node:test'
import assert from 'node:assert/strict'
import { createHmac } from 'node:crypto'

import { __identityClusterWorkspaceTestables } from '../store.js'

const { applyIdentityClusterBulkTransaction, identityClusterExpectedVersions } = __identityClusterWorkspaceTestables

function digest(secret, purpose, actorId, value) {
    return createHmac('sha256', secret).update(`${purpose}:${actorId}:${JSON.stringify(value)}`).digest('hex')
}

test('replays a completed bulk operation from the opaque ledger before reading a changed graph', async () => {
    const previous = process.env.ATENDIMENTO_ACTOR_HMAC_KEY
    const secret = 'synthetic-cluster-ledger-key-which-is-long-enough'
    process.env.ATENDIMENTO_ACTOR_HMAC_KEY = secret
    const actor = { id: 'gestor-sintetico', role: 'GESTOR' }
    const clusterKey = 'a'.repeat(32)
    const expectedVersion = 'b'.repeat(64)
    const idempotencyKey = 'synthetic-requester@example.test'
    const reason = 'Revisão sintética aprovada'
    const requestFingerprint = digest(secret, 'bulk-request', actor.id, { clusterKey, expectedVersion, reason, idempotencyKey })
    const operationKey = digest(secret, 'bulk-operation', actor.id, { clusterKey, idempotencyKey })
    const calls = []
    const client = {
        async query(sql, params = []) {
            calls.push({ sql, params })
            if (/from crm_atendimento\.identity_cluster_review_operations/i.test(sql)) {
                assert.equal(params[0], operationKey)
                return { rows: [{ request_fingerprint: requestFingerprint, result: { membersMoved: 2, decisionState: 'confirmed' } }] }
            }
            throw new Error('GRAPH_MUST_NOT_BE_READ_FOR_IDEMPOTENT_REPLAY')
        },
    }
    try {
        const result = await applyIdentityClusterBulkTransaction(client, {
            clusterKeys: [clusterKey],
            expectedVersions: { [clusterKey]: expectedVersion },
            idempotencyKey,
            reason,
            confirmation: 'REVIEW_CLUSTER',
        }, actor)
        assert.deepEqual(result, {
            schemaVersion: 'crm-identity-cluster/v2',
            idempotent: true,
            appliedClusters: 1,
            membersMoved: 2,
            results: [{ clusterKey, idempotent: true, membersMoved: 2, decisionState: 'confirmed' }],
        })
        assert.equal(calls.length, 1)
        assert.doesNotMatch(JSON.stringify(calls), /synthetic-requester@example\.test|Revisão sintética aprovada/)
    } finally {
        if (previous === undefined) delete process.env.ATENDIMENTO_ACTOR_HMAC_KEY
        else process.env.ATENDIMENTO_ACTOR_HMAC_KEY = previous
    }
})

test('requires one canonical SHA-256 expected version per selected cluster', () => {
    const clusterKey = 'a'.repeat(32)
    const version = 'b'.repeat(64)
    assert.deepEqual(identityClusterExpectedVersions({ expectedVersions: { [clusterKey]: version } }, [clusterKey]), { [clusterKey]: version })
    assert.throws(
        () => identityClusterExpectedVersions({ expectedVersions: { [clusterKey]: version, ['c'.repeat(32)]: version } }, [clusterKey]),
        /IDENTITY_CLUSTER_EXPECTED_VERSIONS_REQUIRED/,
    )
    assert.throws(
        () => identityClusterExpectedVersions({ expectedVersions: { [clusterKey]: 'not-a-version' } }, [clusterKey]),
        /IDENTITY_CLUSTER_VERSION_REQUIRED/,
    )
})
