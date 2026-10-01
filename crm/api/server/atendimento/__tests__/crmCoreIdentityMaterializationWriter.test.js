import assert from 'node:assert/strict'
import { readFile, readdir } from 'node:fs/promises'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

import {
    ATENDIMENTO_CRM_CORE_IDENTITY_MATERIALIZATION_MIGRATION_ID,
    ATENDIMENTO_CRM_CORE_IDENTITY_PREREQUISITE_RELATIONS,
    ATENDIMENTO_CRM_CORE_IDENTITY_RELATIONS,
    ATENDIMENTO_CRM_CORE_IDENTITY_SCHEMA_COLUMN_CONTRACT,
} from '../crmCoreIdentityMaterializationMigration.js'
import {
    __testables,
    materializeAtendimentoCrmCoreIdentityLinks,
} from '../crmCoreIdentityMaterializationWriter.js'

const LOCAL_SOCKET_URL = 'postgresql:///skincos_crm_local?host=/var/run/postgresql'
const STAGING_WRITER_URL = 'postgresql://crm_core_identity_materializer:test-only-password@127.0.0.1:5432/skincos_staging?sslmode=require&uselibpqcompat=true'
const RUN_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const CLIENT_A = '11111111-1111-4111-8111-111111111111'
const CLIENT_B = '22222222-2222-4222-8222-222222222222'
const ATTENDANCE_A = '33333333-3333-4333-8333-333333333333'
const IDENTITY_A = '44444444-4444-4444-8444-444444444444'
const DIGEST_A = `sha256:${'a'.repeat(64)}`
const DIGEST_B = `sha256:${'b'.repeat(64)}`

function link({
    attendanceId = ATTENDANCE_A,
    canonicalClientId = CLIENT_A,
    status = 'confirmed',
    method = 'reviewed_reconciliation',
    evidenceDigest = DIGEST_A,
    sourceRevision = 1,
} = {}) {
    return { attendanceId, canonicalClientId, status, method, evidenceDigest, sourceRevision }
}

function readyColumnRows() {
    return Object.entries(ATENDIMENTO_CRM_CORE_IDENTITY_SCHEMA_COLUMN_CONTRACT)
        .flatMap(([relation, columns]) => Object.entries(columns)
            .map(([column_name, udt_name]) => ({ relation, column_name, udt_name })))
}

function readyConstraintRows() {
    return [
        {
            constraint_name: 'crm_core_identities_id_canonical_client_key',
            constraint_definition: 'UNIQUE (id, canonical_client_id)',
        },
        {
            constraint_name: 'crm_core_identity_members_identity_source_fk',
            constraint_definition: 'FOREIGN KEY (identity_id, source_id) REFERENCES crm_atendimento.crm_core_identities(id, canonical_client_id) ON DELETE RESTRICT',
        },
    ]
}

function writerFixture({
    persistedLinks = [],
    existingRun = null,
    databaseName = 'skincos_crm_local',
    databaseUser = 'admin',
    sessionUser = databaseUser,
    migrationActive = true,
    memberWriteFailure = false,
} = {}) {
    const calls = []
    let released = false
    const client = {
        async query(sql, params = []) {
            calls.push({ sql: String(sql), params })
            if (/current_database\(\)/i.test(sql)) {
                return { rows: [{ database_name: databaseName, database_user: databaseUser, session_user: sessionUser, read_only: 'off' }] }
            }
            if (/select current_user as current_user, session_user as session_user/i.test(sql)) {
                return { rows: [{ current_user: databaseUser, session_user: sessionUser }] }
            }
            if (/select to_regclass\(\$1\)/i.test(sql)) {
                return {
                    rows: [Object.fromEntries(params.map((relation, index) => [
                        `relation_${index}`,
                        [...ATENDIMENTO_CRM_CORE_IDENTITY_PREREQUISITE_RELATIONS, ...ATENDIMENTO_CRM_CORE_IDENTITY_RELATIONS, 'crm_atendimento.schema_migrations'].includes(relation)
                            ? relation
                            : null,
                    ]))],
                }
            }
            if (/from crm_atendimento\.schema_migrations/i.test(sql)) {
                return {
                    rows: migrationActive
                        ? [{ id: ATENDIMENTO_CRM_CORE_IDENTITY_MATERIALIZATION_MIGRATION_ID, rolled_back_at: null }]
                        : [],
                }
            }
            if (/from information_schema\.columns/i.test(sql)) return { rows: readyColumnRows() }
            if (/from pg_constraint/i.test(sql)) return { rows: readyConstraintRows() }
            if (/from crm_atendimento\.crm_core_identity_materialization_runs/i.test(sql)) {
                return { rows: existingRun ? [existingRun] : [] }
            }
            if (/from crm_atendimento\.crm_core_attendance_client_links/i.test(sql)) return { rows: persistedLinks }
            if (/insert into crm_atendimento\.crm_core_identity_clients/i.test(sql)) return { rows: [], rowCount: 1 }
            if (/insert into crm_atendimento\.crm_core_attendance_client_links/i.test(sql)) {
                return { rows: [{ attendance_id: params[0] }], rowCount: 1 }
            }
            if (/insert into crm_atendimento\.crm_core_identities/i.test(sql)) {
                return { rows: [{ identity_id: IDENTITY_A, canonical_client_id: params[0] }], rowCount: 1 }
            }
            if (/insert into crm_atendimento\.crm_core_identity_members/i.test(sql)) {
                if (memberWriteFailure) throw new Error('insert or update violates foreign key constraint crm_core_identity_members_identity_source_fk')
                return { rows: [{ identity_id: params[0], source_id: params[2] }], rowCount: 1 }
            }
            if (/insert into crm_atendimento\.crm_core_identity_materialization_runs/i.test(sql)) {
                return { rows: [{ run_id: params[0] }], rowCount: 1 }
            }
            return { rows: [], rowCount: 0 }
        },
        release() { released = true },
    }
    return { calls, pool: { connect: async () => client }, released: () => released }
}

async function runtimeWriterReferences(root) {
    const entries = await readdir(root, { withFileTypes: true })
    const references = []
    for (const entry of entries) {
        const entryUrl = new URL(`${entry.name}${entry.isDirectory() ? '/' : ''}`, root)
        if (entry.isDirectory()) {
            if (entry.name !== '__tests__') references.push(...await runtimeWriterReferences(entryUrl))
            continue
        }
        if (!/\.(?:[cm]?js)$/i.test(entry.name) || entry.name === 'crmCoreIdentityMaterializationWriter.js') continue
        const source = await readFile(entryUrl, 'utf8')
        if (/\b(?:materializeAtendimentoCrmCoreIdentityLinks|crmCoreIdentityMaterializationWriter)\b/.test(source)) {
            references.push(fileURLToPath(entryUrl))
        }
    }
    return references
}

test('materializes an explicit UUID-only source snapshot under the graph lock and appends an opaque ledger receipt', async () => {
    const fixture = writerFixture()
    const report = await materializeAtendimentoCrmCoreIdentityLinks({
        pool: fixture.pool,
        databaseUrl: LOCAL_SOCKET_URL,
        runId: RUN_A,
        links: [link()],
    })
    assert.equal(report.applied, true)
    assert.equal(report.idempotent, false)
    assert.equal(report.confirmedLinkCount, 1)
    assert.equal(report.identityCount, 1)
    assert.match(report.inputDigest, /^sha256:[a-f0-9]{64}$/)
    assert.match(report.outputDigest, /^sha256:[a-f0-9]{64}$/)
    assert.equal(fixture.released(), true)
    const source = fixture.calls.map(({ sql }) => sql).join('\n')
    assert.match(source, /begin isolation level repeatable read/i)
    assert.match(source, /pg_advisory_xact_lock/i)
    assert.match(source, /from crm_atendimento\.crm_core_attendance_client_links[\s\S]*for update/i)
    assert.match(source, /insert into crm_atendimento\.crm_core_identity_materialization_runs/i)
    assert.doesNotMatch(source, /\b(?:client_name|canonical_name|crm_caixa|caixa_customer|grant\s+|create\s+role)\b/i)
})

test('replays an existing matching ledger run without rewriting source links or identity state', async () => {
    const request = __testables.normalizeWriterInput({ runId: RUN_A, links: [link()] })
    const fixture = writerFixture({
        existingRun: {
            run_id: RUN_A,
            writer_contract: 'atendimento/crm-core/identity-materialization-writer/v1',
            policy_version: 'atendimento/crm-core/identity-materialization/v2',
            input_digest: __testables.inputDigest(request.links),
            output_digest: `sha256:${'c'.repeat(64)}`,
            status: 'applied',
            confirmed_link_count: 1,
            identity_count: 1,
        },
    })
    const report = await materializeAtendimentoCrmCoreIdentityLinks({
        pool: fixture.pool,
        databaseUrl: LOCAL_SOCKET_URL,
        runId: RUN_A,
        links: [link()],
    })
    assert.equal(report.idempotent, true)
    const source = fixture.calls.map(({ sql }) => sql).join('\n')
    assert.doesNotMatch(source, /insert into crm_atendimento\.crm_core_attendance_client_links/i)
    assert.doesNotMatch(source, /insert into crm_atendimento\.crm_core_identity_members/i)
})

test('requires the separately provisioned staging writer principal and exact staging destination', async () => {
    const fixture = writerFixture({
        databaseName: 'skincos_staging',
        databaseUser: 'crm_core_identity_materializer',
    })
    const report = await materializeAtendimentoCrmCoreIdentityLinks({
        pool: fixture.pool,
        databaseUrl: STAGING_WRITER_URL,
        target: 'staging',
        runId: RUN_A,
        links: [link()],
    })
    assert.equal(report.applied, true)

    const wrongPrincipal = writerFixture({ databaseName: 'skincos_staging' })
    await assert.rejects(() => materializeAtendimentoCrmCoreIdentityLinks({
        pool: wrongPrincipal.pool,
        databaseUrl: STAGING_WRITER_URL,
        target: 'staging',
        runId: RUN_A,
        links: [link()],
    }), /WRITER_DESTINATION_UNSAFE/)
    assert.doesNotMatch(wrongPrincipal.calls.map(({ sql }) => sql).join('\n'), /insert into crm_atendimento\.crm_core_identity_materialization_runs/i)
})

test('rejects a persisted confirmed reassignment before it writes a link or ledger row', async () => {
    const fixture = writerFixture({ persistedLinks: [link()] })
    await assert.rejects(() => materializeAtendimentoCrmCoreIdentityLinks({
        pool: fixture.pool,
        databaseUrl: LOCAL_SOCKET_URL,
        runId: RUN_A,
        links: [link({ canonicalClientId: CLIENT_B, evidenceDigest: DIGEST_B, sourceRevision: 2 })],
    }), /REASSIGNMENT_REVIEW_REQUIRED/)
    const source = fixture.calls.map(({ sql }) => sql).join('\n')
    assert.doesNotMatch(source, /insert into crm_atendimento\.crm_core_attendance_client_links/i)
    assert.doesNotMatch(source, /insert into crm_atendimento\.crm_core_identity_materialization_runs/i)
    assert.match(source, /rollback/i)
})

test('rejects stale persisted revisions before it writes a link or ledger row', async () => {
    const fixture = writerFixture({ persistedLinks: [link({ sourceRevision: 2 })] })
    await assert.rejects(() => materializeAtendimentoCrmCoreIdentityLinks({
        pool: fixture.pool,
        databaseUrl: LOCAL_SOCKET_URL,
        runId: RUN_A,
        links: [link({ sourceRevision: 1 })],
    }), /STALE_SOURCE_REVISION/)
    const source = fixture.calls.map(({ sql }) => sql).join('\n')
    assert.doesNotMatch(source, /insert into crm_atendimento\.crm_core_attendance_client_links/i)
    assert.doesNotMatch(source, /insert into crm_atendimento\.crm_core_identity_materialization_runs/i)
    assert.match(source, /rollback/i)
})

test('rejects stale non-confirmed persisted revisions before it writes a link or ledger row', async () => {
    const fixture = writerFixture({ persistedLinks: [link({ status: 'unresolved', sourceRevision: 2 })] })
    await assert.rejects(() => materializeAtendimentoCrmCoreIdentityLinks({
        pool: fixture.pool,
        databaseUrl: LOCAL_SOCKET_URL,
        runId: RUN_A,
        links: [link({ sourceRevision: 1 })],
    }), /STALE_SOURCE_REVISION/)
    const source = fixture.calls.map(({ sql }) => sql).join('\n')
    assert.doesNotMatch(source, /insert into crm_atendimento\.crm_core_attendance_client_links/i)
    assert.doesNotMatch(source, /insert into crm_atendimento\.crm_core_identity_materialization_runs/i)
    assert.match(source, /rollback/i)
})

test('refuses an inactive or rolled-back migration receipt before it writes source state', async () => {
    const fixture = writerFixture({ migrationActive: false })
    await assert.rejects(() => materializeAtendimentoCrmCoreIdentityLinks({
        pool: fixture.pool,
        databaseUrl: LOCAL_SOCKET_URL,
        runId: RUN_A,
        links: [link()],
    }), /RUNTIME_RECEIPT_MISSING/)
    const source = fixture.calls.map(({ sql }) => sql).join('\n')
    assert.doesNotMatch(source, /insert into crm_atendimento\.crm_core_attendance_client_links/i)
    assert.doesNotMatch(source, /insert into crm_atendimento\.crm_core_identity_materialization_runs/i)
    assert.match(source, /rollback/i)
})

test('fails closed when the database refuses a member whose identity/client pair violates the composite FK', async () => {
    const fixture = writerFixture({ memberWriteFailure: true })
    await assert.rejects(() => materializeAtendimentoCrmCoreIdentityLinks({
        pool: fixture.pool,
        databaseUrl: LOCAL_SOCKET_URL,
        runId: RUN_A,
        links: [link()],
    }), /foreign key constraint crm_core_identity_members_identity_source_fk/)
    const source = fixture.calls.map(({ sql }) => sql).join('\n')
    assert.match(source, /insert into crm_atendimento\.crm_core_identity_members/i)
    assert.doesNotMatch(source, /insert into crm_atendimento\.crm_core_identity_materialization_runs/i)
    assert.match(source, /rollback/i)
})

test('rejects names, non-UUID run ids, and empty automatic snapshots at the API boundary', async () => {
    const fixture = writerFixture()
    await assert.rejects(() => materializeAtendimentoCrmCoreIdentityLinks({
        pool: fixture.pool,
        databaseUrl: LOCAL_SOCKET_URL,
        runId: RUN_A,
        links: [{ ...link(), clientName: 'not-accepted' }],
    }), /LINK_SHAPE_INVALID/)
    await assert.rejects(() => materializeAtendimentoCrmCoreIdentityLinks({
        pool: fixture.pool,
        databaseUrl: LOCAL_SOCKET_URL,
        runId: 'not-a-uuid',
        links: [link()],
    }), /WRITER_RUN_ID_REQUIRED/)
    await assert.rejects(() => materializeAtendimentoCrmCoreIdentityLinks({
        pool: fixture.pool,
        databaseUrl: LOCAL_SOCKET_URL,
        runId: RUN_A,
        links: [],
    }), /WRITER_LINKS_REQUIRED/)
    await assert.rejects(() => materializeAtendimentoCrmCoreIdentityLinks({
        pool: fixture.pool,
        databaseUrl: LOCAL_SOCKET_URL,
        target: 'production',
        runId: RUN_A,
        links: [link()],
    }), /WRITER_DESTINATION_UNSAFE/)
    assert.throws(() => __testables.normalizeWriterInput({ runId: RUN_A, links: [link()], clientName: 'not-accepted' }), /WRITER_INPUT_INVALID/)
})

test('writer remains an opt-in API with no CLI, scheduler, route, or environment-driven caller', async () => {
    const source = await readFile(fileURLToPath(new URL('../crmCoreIdentityMaterializationWriter.js', import.meta.url)), 'utf8')
    assert.doesNotMatch(source, /\b(?:process\.argv|setInterval|setTimeout|cron)\b|\bmain\s*\(/i)
    assert.doesNotMatch(source, /\b(?:fetch\s*\(|child_process|DATABASE_URL|listen\s*\()\b/i)
    const serverRoot = new URL('../../', import.meta.url)
    assert.deepEqual(await runtimeWriterReferences(serverRoot), [])
})
