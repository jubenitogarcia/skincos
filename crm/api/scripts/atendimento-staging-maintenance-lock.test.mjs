import assert from 'node:assert/strict'
import test from 'node:test'

import {
    acquireAtendimentoStagingMutationLock,
    assertAtendimentoStagingMigratorConnectionLimit,
    ATENDIMENTO_STAGING_MIGRATOR_CONNECTION_LIMIT,
    ATENDIMENTO_STAGING_MIGRATION_POOL_MAX,
    ATENDIMENTO_STAGING_MUTATION_LOCK_KEY,
    ATENDIMENTO_STAGING_QUALITY_REFRESH_POOL_MAX,
    HARMONIA_STAGING_MIGRATION_POOL_MAX,
    releaseAtendimentoStagingMutationLock,
} from './atendimento-staging-maintenance-lock.mjs'

test('staging mutation gate uses the compatible full-run lock and exact three-session role budget', async () => {
    const calls = []
    const client = {
        async query(sql, values) {
            calls.push({ sql, values })
            if (sql.includes('pg_try_advisory_lock')) return { rows: [{ acquired: true }] }
            if (sql.includes('rolconnlimit')) return { rows: [{ valid: true }] }
            if (sql.includes('pg_advisory_unlock')) return { rows: [{ unlocked: true }] }
            throw new Error(`unexpected query: ${sql}`)
        },
    }

    await acquireAtendimentoStagingMutationLock(client, 'TEST_LOCK_UNAVAILABLE')
    await assertAtendimentoStagingMigratorConnectionLimit(client)
    await releaseAtendimentoStagingMutationLock(client)

    assert.equal(ATENDIMENTO_STAGING_MUTATION_LOCK_KEY, 'skincos:atendimento:staging:migrations:v1')
    assert.equal(ATENDIMENTO_STAGING_MIGRATOR_CONNECTION_LIMIT, 3)
    assert.equal(ATENDIMENTO_STAGING_MIGRATION_POOL_MAX, 2)
    assert.equal(ATENDIMENTO_STAGING_QUALITY_REFRESH_POOL_MAX, 2)
    assert.equal(HARMONIA_STAGING_MIGRATION_POOL_MAX, 1)
    assert.deepEqual(calls[0].values, [ATENDIMENTO_STAGING_MUTATION_LOCK_KEY])
    assert.deepEqual(calls[1].values, [ATENDIMENTO_STAGING_MIGRATOR_CONNECTION_LIMIT])
    assert.deepEqual(calls[2].values, [ATENDIMENTO_STAGING_MUTATION_LOCK_KEY])
})

test('staging mutation gate and connection contract fail closed', async () => {
    await assert.rejects(
        acquireAtendimentoStagingMutationLock({
            async query() { return { rows: [{ acquired: false }] } },
        }, 'TEST_LOCK_UNAVAILABLE'),
        /TEST_LOCK_UNAVAILABLE/,
    )
    await assert.rejects(
        assertAtendimentoStagingMigratorConnectionLimit({
            async query() { return { rows: [{ valid: false }] } },
        }),
        /ATENDIMENTO_STAGING_MIGRATOR_CONNECTION_LIMIT_INVALID/,
    )
})
