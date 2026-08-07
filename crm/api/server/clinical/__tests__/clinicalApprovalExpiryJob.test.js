import assert from 'node:assert/strict'
import test from 'node:test'

import {
    CLINICAL_APPROVAL_EXPIRY_JOB_ID,
    clinicalApprovalExpiryActor,
    clinicalApprovalExpiryIdempotencyKey,
    createClinicalApprovalExpiryJob,
    normalizeClinicalApprovalExpiryExecutionKey,
    normalizeClinicalApprovalExpiryTarget,
    runClinicalApprovalExpiry,
} from '../clinicalApprovalExpiryJob.js'

const executionKey = 'clientes.clinical_approval_expiry:2026-08-07T12:00:00.000Z'

test('clinical expiry job is disabled by default and does not construct a store', async () => {
    let constructed = 0
    const result = await runClinicalApprovalExpiry({
        env: {},
        executionKey,
        storeFactory: () => {
            constructed += 1
            throw new Error('must not construct')
        },
    })
    assert.deepEqual(result, {
        ok: true,
        ready: true,
        enabled: false,
        target: null,
        skipped: 'job_disabled',
        expired: 0,
    })
    assert.equal(constructed, 0)
})

test('clinical expiry job fails closed outside local or staging before database access', async () => {
    let constructed = 0
    await assert.rejects(
        () => runClinicalApprovalExpiry({
            env: {
                CLINICAL_APPROVAL_EXPIRY_JOB_ENABLED: 'true',
                CLINICAL_APPROVAL_EXPIRY_TARGET: 'production',
                CLINICAL_APPROVAL_ENABLED: 'true',
            },
            executionKey,
            storeFactory: () => { constructed += 1; return {} },
        }),
        (error) => error.code === 'CLINICAL_APPROVAL_EXPIRY_TARGET_INVALID' && error.retryable === false,
    )
    assert.equal(constructed, 0)
})

test('clinical expiry job fails closed in a read-only runtime', async () => {
    await assert.rejects(
        () => runClinicalApprovalExpiry({
            env: {
                CLINICAL_APPROVAL_EXPIRY_JOB_ENABLED: 'true',
                CLINICAL_APPROVAL_EXPIRY_TARGET: 'staging',
                CLINICAL_APPROVAL_ENABLED: 'true',
                CRM_ATENDIMENTO_READ_ONLY: 'true',
            },
            executionKey,
            storeFactory: () => ({ expireDue: async () => ({ expired: 1 }) }),
        }),
        (error) => error.code === 'CLINICAL_APPROVAL_EXPIRY_READ_ONLY' && error.retryable === false,
    )
})

test('a disabled clinical domain is observed without creating a mutation store', async () => {
    let constructed = 0
    const result = await runClinicalApprovalExpiry({
        env: {
            CLINICAL_APPROVAL_EXPIRY_JOB_ENABLED: 'true',
            CLINICAL_APPROVAL_EXPIRY_TARGET: 'local',
        },
        executionKey,
        storeFactory: () => { constructed += 1; return {} },
    })
    assert.deepEqual(result, {
        ok: true,
        ready: true,
        enabled: false,
        target: 'local',
        skipped: 'clinical_domain_disabled',
        expired: 0,
    })
    assert.equal(constructed, 0)
})

test('clinical expiry materialization carries a deterministic opaque key and aggregate result only', async () => {
    const calls = []
    const env = {
        CLINICAL_APPROVAL_EXPIRY_JOB_ENABLED: 'true',
        CLINICAL_APPROVAL_EXPIRY_TARGET: 'staging',
        CLINICAL_APPROVAL_ENABLED: 'true',
    }
    const result = await runClinicalApprovalExpiry({
        env,
        executionKey,
        storeFactory: () => ({
            async expireDue(actor, idempotencyKey) {
                calls.push({ actor, idempotencyKey })
                return { expired: 3, idempotent: false, privateRows: ['must-not-escape'] }
            },
        }),
    })
    assert.deepEqual(result, {
        ok: true,
        ready: true,
        enabled: true,
        target: 'staging',
        expired: 3,
        idempotent: false,
    })
    assert.deepEqual(calls[0].actor, clinicalApprovalExpiryActor('staging'))
    assert.equal(calls[0].idempotencyKey, clinicalApprovalExpiryIdempotencyKey({ target: 'staging', executionKey }))
    assert.equal(calls[0].idempotencyKey.includes(executionKey), false)
    assert.equal(JSON.stringify(result).includes('privateRows'), false)
})

test('clinical expiry job descriptor is independent, bounded and forwards only the scheduler key', async () => {
    const received = []
    const env = { CRM_CONTINUOUS_JOB_CLINICAL_EXPIRY_INTERVAL_SECONDS: '30' }
    const job = createClinicalApprovalExpiryJob({
        env,
        runner: async (context) => { received.push(context); return { ok: true } },
    })
    assert.equal(job.id, CLINICAL_APPROVAL_EXPIRY_JOB_ID)
    assert.equal(job.required, false)
    assert.equal(job.intervalMs, 900_000)
    await job.run({ executionKey })
    assert.deepEqual(received, [{ pool: undefined, databaseUrl: undefined, env, executionKey }])
})

test('clinical expiry target and scheduler key reject arbitrary values', () => {
    assert.equal(normalizeClinicalApprovalExpiryTarget('LOCAL'), 'local')
    assert.equal(normalizeClinicalApprovalExpiryExecutionKey(executionKey), executionKey)
    assert.throws(() => normalizeClinicalApprovalExpiryTarget('production'), (error) => error.code === 'CLINICAL_APPROVAL_EXPIRY_TARGET_INVALID')
    assert.throws(() => normalizeClinicalApprovalExpiryExecutionKey('customer@example.com'), (error) => error.code === 'CLINICAL_APPROVAL_EXPIRY_EXECUTION_KEY_INVALID')
})
