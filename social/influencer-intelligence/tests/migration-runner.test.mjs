import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'

import {
    INFLUENCER_INTELLIGENCE_MIGRATION_IDS,
    INFLUENCER_INTELLIGENCE_STAGING_TARGET,
    assertInfluencerIntelligenceStagingDestination,
    parseInfluencerIntelligenceMigrationArgs,
    runInfluencerIntelligenceMigration,
    __testables,
} from '../../../scripts/staging/influencer-intelligence-migration.mjs'

const syntheticDatabaseUrl = 'postgresql://skincos_staging_migrator_login:synthetic@127.0.0.1:5432/skincos_staging?sslmode=require&uselibpqcompat=true&application_name=atendimento-migration'
const releaseSha = 'a'.repeat(40)

test('migration CLI is explicitly staging-only and binds apply to release/checkpoint', () => {
    assert.deepEqual(parseInfluencerIntelligenceMigrationArgs(['--dry-run', '--target', 'staging']), {
        action: 'dry-run', target: 'staging', releaseSha: null, checkpointPath: null,
    })
    assert.deepEqual(parseInfluencerIntelligenceMigrationArgs(['--apply', '--target', 'staging', '--release-sha', releaseSha, '--checkpoint', 'C:\\private\\checkpoint.json']), {
        action: 'apply', target: 'staging', releaseSha, checkpointPath: 'C:\\private\\checkpoint.json',
    })
    assert.throws(() => parseInfluencerIntelligenceMigrationArgs(['--apply', '--target', 'production', '--release-sha', releaseSha, '--checkpoint', 'C:\\private\\checkpoint.json']), /II_MIGRATION_ARGUMENT_INVALID/)
    assert.throws(() => parseInfluencerIntelligenceMigrationArgs(['--apply', '--target', 'staging']), /II_MIGRATION_APPLY_ARGUMENTS_INVALID/)
})

test('destination proof accepts only loopback TLS staging migrator and normalizes application identity', () => {
    const normalized = assertInfluencerIntelligenceStagingDestination(syntheticDatabaseUrl, 'staging')
    assert.match(normalized, /application_name=influencer-intelligence-migration/)
    assert.throws(() => assertInfluencerIntelligenceStagingDestination('postgresql://user:secret@remote.invalid/skincos_staging?sslmode=require&uselibpqcompat=true', 'staging'), /II_MIGRATION_DATABASE_DESTINATION_UNSAFE/)
    assert.throws(() => assertInfluencerIntelligenceStagingDestination(syntheticDatabaseUrl, 'production'), /II_MIGRATION_TARGET_NOT_SUPPORTED/)
})

test('migration SQL remains additive and runner-owned transaction controls are explicit', () => {
    const sql = "ALTER TABLE influencer_intelligence.example ADD COLUMN value text;\nON DELETE RESTRICT;"
    assert.doesNotThrow(() => __testables.assertAdditiveMigrationSql(sql, 'synthetic'))
    assert.throws(() => __testables.assertAdditiveMigrationSql('DROP TABLE influencer_intelligence.example;', 'synthetic'), /II_MIGRATION_NON_ADDITIVE_SQL/)
    const wrapped = 'BEGIN;\nCREATE TABLE influencer_intelligence.example (id text);\nCOMMIT;\n'
    assert.equal(__testables.migrationSqlWithoutTransactionControl(wrapped), '\nCREATE TABLE influencer_intelligence.example (id text);\n')
})

function createFakePool({ applied = false } = {}) {
    const queries = []
    const ledger = new Map(applied ? INFLUENCER_INTELLIGENCE_MIGRATION_IDS.map((id) => [id, { id, applied_at: '2026-08-11T00:00:00Z', rolled_back_at: null, details: { checksum: 'fixture' } }]) : [])
    let ownerRoleActive = false
    const client = {
        async query(sql, values = []) {
            queries.push({ sql: String(sql), values })
            const text = String(sql)
            if (text.includes('set local role')) { ownerRoleActive = true; return { rows: [] } }
            if (text === 'begin' || text === 'commit' || text === 'rollback' || text.includes('set local')) return { rows: [] }
            if (text.includes('pg_try_advisory_xact_lock')) return { rows: [{ acquired: true }] }
            if (text.includes('pg_has_role')) return { rows: [{ can_set_owner: true, migrator_connect: true, owner_connect: true, owner_create: true, owner_role_shape: true }] }
            if (text.includes('current_database()')) return { rows: [{ database_name: 'skincos_staging', effective_role: ownerRoleActive ? 'skincos_staging_crm_owner' : 'skincos_staging_migrator_login', session_user: 'skincos_staging_migrator_login', configured_role: ownerRoleActive ? 'skincos_staging_crm_owner' : 'none', application_name: 'influencer-intelligence-migration', transaction_read_only: 'off', lock_timeout: '3s', statement_timeout: '60s', idle_in_transaction_session_timeout: '90s' }] }
            if (text.includes('role_name')) return { rows: [{ role_name: values[0], role_present: false, schema_usage: false, schema_create: false, dml_privilege: false }] }
            if (text.includes('from pg_namespace')) return { rows: applied || ledger.size ? [{ schema_name: 'influencer_intelligence', schema_owner: 'skincos_staging_crm_owner' }] : [] }
            if (text.includes('from pg_class c')) return { rows: applied || ledger.size ? __testables.EXPECTED_RELATIONS.map((relname) => ({ relname, relkind: 'r' })) : [] }
            if (text.includes('from information_schema.columns')) return { rows: __testables.REQUIRED_COLUMNS.map(([table_name, column_name]) => ({ table_name, column_name })) }
            if (text.includes('from pg_trigger')) return { rows: __testables.APPEND_ONLY_RELATIONS.map((relname) => ({ relname, tgname: `${relname}_append_only` })) }
            if (text.includes('select to_regclass')) return { rows: [{ relation: applied || ledger.size ? 'influencer_intelligence.schema_migrations' : null }] }
            if (text.includes('select id, applied_at')) return { rows: [...ledger.values()] }
            if (text.includes('select count(*)')) return { rows: [{ count: 0 }] }
            if (text.includes('insert into "influencer_intelligence"."schema_migrations"')) {
                ledger.set(values[0], { id: values[0], applied_at: '2026-08-12T00:00:00Z', rolled_back_at: null, details: JSON.parse(values[1]) })
                return { rows: [] }
            }
            return { rows: [] }
        },
        release() {},
    }
    return {
        queries,
        createPool: async () => ({
            async connect() { return client },
            async end() {},
        }),
    }
}

test('dry-run proves identity, minimum grants, lock and timeout without migration or checkpoint writes', async () => {
    const fake = createFakePool()
    const report = await runInfluencerIntelligenceMigration({
        databaseUrl: syntheticDatabaseUrl,
        action: 'dry-run',
        target: 'staging',
        createPool: fake.createPool,
        now: () => '2026-08-12T00:00:00.000Z',
    })
    assert.equal(report.status, 'planned')
    assert.equal(report.identity.database, INFLUENCER_INTELLIGENCE_STAGING_TARGET.database)
    assert.equal(report.identity.sessionUser, INFLUENCER_INTELLIGENCE_STAGING_TARGET.sessionUser)
    assert.equal(report.identity.effectiveRole, INFLUENCER_INTELLIGENCE_STAGING_TARGET.ownerRole)
    assert.equal(report.roleProof.ownerCreate, true)
    assert.equal(report.observedTimeouts.lock_timeout, '3s')
    assert.equal(report.observedTimeouts.statement_timeout, '60s')
    assert.equal(report.observedTimeouts.idle_in_transaction_session_timeout, '90s')
    assert.ok(fake.queries.some(({ sql }) => sql.includes('lock_timeout')))
    assert.ok(fake.queries.some(({ sql }) => sql.includes('statement_timeout')))
    assert.ok(fake.queries.some(({ sql }) => sql.includes('pg_try_advisory_xact_lock')))
    const roleProofQuery = fake.queries.find(({ sql }) => sql.includes('pg_has_role'))?.sql || ''
    assert.match(roleProofQuery, /\$1::name/)
    const runtimePrivilegeQuery = fake.queries.find(({ sql }) => sql.includes('role_name'))?.sql || ''
    assert.match(runtimePrivilegeQuery, /\$1::name/)
    assert.match(runtimePrivilegeQuery, /pg_namespace/)
    assert.equal(fake.queries.filter(({ sql }) => sql.includes('insert into')).length, 0)
})

test('apply is atomic, idempotent by schema ledger, writes a private checkpoint and post-validates append-only scope', async () => {
    const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'ii-migration-runner-'))
    const checkpointPath = path.join(tempRoot, 'before.json')
    const fake = createFakePool()
    try {
        const report = await runInfluencerIntelligenceMigration({
            databaseUrl: syntheticDatabaseUrl,
            action: 'apply',
            target: 'staging',
            releaseSha,
            checkpointPath,
            createPool: fake.createPool,
            now: () => '2026-08-12T00:00:00.000Z',
        })
        assert.equal(report.status, 'applied')
        assert.equal(report.migrations.filter(({ status }) => status === 'applied').length, INFLUENCER_INTELLIGENCE_MIGRATION_IDS.length)
        assert.equal(report.postValidation.appendOnlyRelations, 8)
        assert.equal(report.postValidation.seededRows, 0)
        assert.equal(report.postValidation.runtimePrivileges.every(({ schemaUsage, schemaCreate, dml }) => !schemaUsage && !schemaCreate && !dml), true)
        assert.equal(report.checkpoint.sha256.length, 64)
        const checkpoint = JSON.parse(await fs.readFile(checkpointPath, 'utf8'))
        assert.equal(checkpoint.database, 'skincos_staging')
        assert.equal(checkpoint.effectiveRole, 'skincos_staging_crm_owner')
        assert.equal('databaseUrl' in checkpoint, false)
        assert.equal('password' in checkpoint, false)
        assert.ok(fake.queries.some(({ sql }) => sql === 'commit'))
    } finally {
        await fs.rm(tempRoot, { recursive: true, force: true })
    }
})

test('checkpoint paths inside the checkout are rejected before file creation', () => {
    assert.throws(() => __testables.checkpointPathOutsideRepository(path.join(__testables.ROOT, 'checkpoint.json')), /II_MIGRATION_CHECKPOINT_MUST_BE_PRIVATE/)
})

test('native staging wrapper is release-bound and keeps database custody out of argv', async () => {
    const wrapper = await fs.readFile(path.join(__testables.ROOT, 'scripts/runtime/run-influencer-intelligence-staging-migration.sh'), 'utf8')
    assert.match(wrapper, /\/opt\/skincos\/releases\/\$RELEASE_SHA\/source/)
    assert.match(wrapper, /mutate:influencer-intelligence:staging/)
    assert.match(wrapper, /\.skincos-global-coordination-influencer-intelligence\.json/)
    assert.match(wrapper, /--checkpoint \"\$checkpoint\"/)
    assert.match(wrapper, /scripts\/staging\/influencer-intelligence-migration\.mjs/)
    assert.match(wrapper, /COORDINATION_ENV_FILE='\/etc\/skincos\/global-coordination\/native-runtime\.env'/)
    assert.match(wrapper, /native-staging-migration-runner/)
    assert.match(wrapper, /unset GLOBAL_COORDINATION_MISSION_ID GLOBAL_COORDINATION_THREAD_ID GLOBAL_COORDINATION_ACTOR/)
    assert.doesNotMatch(wrapper, /DATABASE_URL|password|--database-url|--connection-string/)
    assert.match(wrapper, /CHECKPOINT_ROOT='\/var\/backups\/skincos\/influencer-intelligence\/staging'/)
})

test('runner reuses the canonical CRM staging migrator custody without duplicating a secret', () => {
    assert.equal(__testables.FIXED_ENV_FILE, '/etc/skincos/crm-atendimento-staging-migrator.env')
})
