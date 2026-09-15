import assert from 'node:assert/strict'
import test from 'node:test'

import {
    ATENDIMENTO_CRM_CORE_IDENTITY_SCHEMA_STAGING_ENV_FILE,
    ATENDIMENTO_CRM_CORE_IDENTITY_SCHEMA_STAGING_LOCK_UNAVAILABLE,
    parseAtendimentoCrmCoreIdentitySchemaStagingInvocation,
    runAtendimentoCrmCoreIdentitySchemaStaging,
} from './run-atendimento-crm-core-identity-schema-staging.mjs'

const databaseUrl = 'postgresql://skincos_staging_migrator_login:synthetic@127.0.0.1:5432/skincos_staging?sslmode=require&uselibpqcompat=true'

function report({ active = false, present = active ? 5 : 0, absent = active ? 0 : 5, eligible = !active } = {}) {
    return {
        destination: { database: 'skincos_staging', user: 'skincos_staging_crm_owner', target: 'staging' },
        preflight: {
            prerequisitesReady: true,
            currentMigrationRecorded: active,
            currentMigrationActive: active,
            relationCollision: false,
            migrationReceiptCollision: false,
            schemaCompatible: true,
            schemaContractReady: active,
            applyEligible: eligible,
            schemaReady: active,
            runtimeReady: active,
            targetRelationsPresent: Array.from({ length: present }, (_, index) => `relation-${index}`),
            targetRelationsAbsent: Array.from({ length: absent }, (_, index) => `missing-${index}`),
        },
    }
}

function poolFixture() {
    const calls = []
    let ended = false
    let released = false
    return {
        calls,
        get ended() { return ended },
        get released() { return released },
        pool: {
            async connect() {
                return {
                    async query(sql, values) {
                        calls.push({ sql, values })
                        return { rows: [{ acquired: true, valid: true, unlocked: true }] }
                    },
                    release() { released = true },
                }
            },
            async end() { ended = true },
        },
    }
}

test('identity schema runner accepts only literal staging actions', () => {
    assert.deepEqual(parseAtendimentoCrmCoreIdentitySchemaStagingInvocation(['verify']), { action: 'verify' })
    assert.deepEqual(parseAtendimentoCrmCoreIdentitySchemaStagingInvocation(['apply']), { action: 'apply' })
    for (const args of [[], ['--apply'], ['verify', 'extra'], ['rollback'], ['apply', '--target', 'production']]) {
        assert.throws(() => parseAtendimentoCrmCoreIdentitySchemaStagingInvocation(args), /ACTION_INVALID/)
    }
})

test('identity schema runner rejects an unsafe destination before creating a pool', async () => {
    let created = false
    await assert.rejects(
        runAtendimentoCrmCoreIdentitySchemaStaging({
            action: 'verify',
            readEnvironment: async (file, options) => {
                assert.equal(file, ATENDIMENTO_CRM_CORE_IDENTITY_SCHEMA_STAGING_ENV_FILE)
                assert.deepEqual(options, { allowedKeys: ['DATABASE_URL'] })
                return { DATABASE_URL: 'postgresql://unsafe@remote.invalid/not-staging' }
            },
            createPool: () => {
                created = true
                throw new Error('must not create a pool')
            },
        }),
        /DESTINATION_UNSAFE/,
    )
    assert.equal(created, false)
})

test('verify holds the shared staging lock before observing the fixed schema', async () => {
    const fixture = poolFixture()
    const sequence = []
    const result = await runAtendimentoCrmCoreIdentitySchemaStaging({
        action: 'verify',
        readEnvironment: async () => ({ DATABASE_URL: databaseUrl }),
        createPool: (url, options) => {
            assert.equal(url, databaseUrl)
            assert.deepEqual(options, { max: 2 })
            return fixture.pool
        },
        acquireLock: async (_client, unavailableCode) => {
            sequence.push('lock')
            assert.equal(unavailableCode, ATENDIMENTO_CRM_CORE_IDENTITY_SCHEMA_STAGING_LOCK_UNAVAILABLE)
        },
        assertConnectionLimit: async () => sequence.push('connection-limit'),
        preflight: async () => {
            sequence.push('preflight')
            return report()
        },
        releaseLock: async () => sequence.push('release'),
    })
    assert.deepEqual(sequence, ['lock', 'connection-limit', 'preflight', 'release'])
    assert.equal(result.action, 'verify')
    assert.equal(result.schemaOnly, true)
    assert.equal(result.writerInvocation, false)
    assert.equal(result.backfillInvocation, false)
    assert.equal(result.deliveryInvocation, false)
    assert.equal(result.productionMutationAllowed, false)
    assert.equal(result.statementsApplied, 0)
    assert.equal(fixture.ended, true)
    assert.equal(fixture.released, true)
})

test('apply is first-time schema-only and verifies the immutable registry receipt afterwards', async () => {
    const fixture = poolFixture()
    let observations = 0
    let applied = 0
    const result = await runAtendimentoCrmCoreIdentitySchemaStaging({
        action: 'apply',
        readEnvironment: async () => ({ DATABASE_URL: databaseUrl }),
        createPool: () => fixture.pool,
        acquireLock: async () => {},
        assertConnectionLimit: async () => {},
        preflight: async () => {
            observations += 1
            return observations === 1 ? report() : report({ active: true })
        },
        applyMigration: async ({ target, databaseUrl: observedUrl }) => {
            applied += 1
            assert.equal(target, 'staging')
            assert.equal(observedUrl, databaseUrl)
            return { applied: true, statements: 16 }
        },
        releaseLock: async () => {},
    })
    assert.equal(applied, 1)
    assert.equal(observations, 2)
    assert.equal(result.action, 'apply')
    assert.equal(result.statementsApplied, 16)
    assert.equal(result.before.currentMigrationActive, false)
    assert.equal(result.after.currentMigrationActive, true)
    assert.equal(result.after.runtimeReady, true)
})

test('apply refuses an already-recorded or non-fresh identity schema before mutation', async () => {
    const fixture = poolFixture()
    let applied = false
    await assert.rejects(
        runAtendimentoCrmCoreIdentitySchemaStaging({
            action: 'apply',
            readEnvironment: async () => ({ DATABASE_URL: databaseUrl }),
            createPool: () => fixture.pool,
            acquireLock: async () => {},
            assertConnectionLimit: async () => {},
            preflight: async () => report({ active: true }),
            applyMigration: async () => { applied = true },
            releaseLock: async () => {},
        }),
        /ADMISSION_DENIED/,
    )
    assert.equal(applied, false)
    assert.equal(fixture.ended, true)
    assert.equal(fixture.released, true)
})
