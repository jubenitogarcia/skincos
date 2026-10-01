import assert from 'node:assert/strict'
import test from 'node:test'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'

import {
    ATENDIMENTO_CRM_CORE_IDENTITY_MATERIALIZATION_MIGRATION_ID,
    ATENDIMENTO_CRM_CORE_IDENTITY_PREREQUISITE_RELATIONS,
    ATENDIMENTO_CRM_CORE_ISOLATED_IDENTITY_PROJECTION_SOURCE_RELATIONS,
    ATENDIMENTO_CRM_CORE_IDENTITY_RELATIONS,
    ATENDIMENTO_CRM_CORE_IDENTITY_RECONCILIATION_POLICY,
    ATENDIMENTO_CRM_CORE_IDENTITY_SCHEMA_COLUMN_CONTRACT,
    ATENDIMENTO_CRM_CORE_IDENTITY_SCHEMA_CONSTRAINT_CONTRACT,
    assertAtendimentoCrmCoreIdentityMaterializationRuntimePreflight,
    applyAtendimentoCrmCoreIdentityMaterializationMigration,
    atendimentoCrmCoreIdentityComponentKey,
    atendimentoCrmCoreIdentityMaterializationMigrationPlan,
    evaluateAtendimentoCrmCoreIdentityMaterializationPreflight,
    reconcileAtendimentoCrmCoreIdentityLinks,
} from '../crmCoreIdentityMaterializationMigration.js'

const LOCAL_SOCKET_URL = 'postgresql:///skincos_crm_local?host=/var/run/postgresql'
const CLIENT_A = '11111111-1111-4111-8111-111111111111'
const CLIENT_B = '22222222-2222-4222-8222-222222222222'
const ATTENDANCE_A = '33333333-3333-4333-8333-333333333333'
const ATTENDANCE_B = '44444444-4444-4444-8444-444444444444'
const DIGEST_A = `sha256:${'a'.repeat(64)}`
const DIGEST_B = `sha256:${'b'.repeat(64)}`

function link({ attendanceId = ATTENDANCE_A, canonicalClientId = CLIENT_A, status = 'confirmed', method = 'reviewed_reconciliation', evidenceDigest = DIGEST_A, sourceRevision = 1 } = {}) {
    return { attendanceId, canonicalClientId, status, method, evidenceDigest, sourceRevision }
}

function readyRelations({ schema = false, registry = false } = {}) {
    return Object.fromEntries([
        ...ATENDIMENTO_CRM_CORE_IDENTITY_PREREQUISITE_RELATIONS,
        ...ATENDIMENTO_CRM_CORE_IDENTITY_RELATIONS,
        'crm_atendimento.schema_migrations',
    ].map((relation) => [
        relation,
        ATENDIMENTO_CRM_CORE_IDENTITY_PREREQUISITE_RELATIONS.includes(relation)
            ? true
            : relation === 'crm_atendimento.schema_migrations'
                ? registry
                : schema,
    ]))
}

function readyColumnTypes() {
    return Object.fromEntries(Object.entries(ATENDIMENTO_CRM_CORE_IDENTITY_SCHEMA_COLUMN_CONTRACT)
        .map(([relation, columns]) => [relation, { ...columns }]))
}

function readyConstraintDefinitions() {
    return {
        crm_core_identities_id_canonical_client_key: 'UNIQUE (id, canonical_client_id)',
        crm_core_identity_members_identity_source_fk: 'FOREIGN KEY (identity_id, source_id) REFERENCES crm_atendimento.crm_core_identities(id, canonical_client_id) ON DELETE RESTRICT',
    }
}

test('defines a schema-only Atendimento identity foundation with an exact exporter allowlist', () => {
    const plan = atendimentoCrmCoreIdentityMaterializationMigrationPlan()
    assert.equal(plan.id, ATENDIMENTO_CRM_CORE_IDENTITY_MATERIALIZATION_MIGRATION_ID)
    assert.deepEqual(plan.projectionSourceRelationAllowlist, ATENDIMENTO_CRM_CORE_ISOLATED_IDENTITY_PROJECTION_SOURCE_RELATIONS)
    assert.match(plan.policy, /names never derive UUIDs/i)
    assert.match(plan.dataMutation, /no customer or attendance row is read/i)
    assert.match(plan.runtimeAccess, /No runtime roles or grants/i)
    assert.match(plan.rollback, /Non-destructive/i)
    assert.equal(ATENDIMENTO_CRM_CORE_IDENTITY_RECONCILIATION_POLICY.uuidFromNameAllowed, false)
    assert.equal(ATENDIMENTO_CRM_CORE_IDENTITY_RECONCILIATION_POLICY.nameBasedAutomaticLinkAllowed, false)
    assert.deepEqual(ATENDIMENTO_CRM_CORE_IDENTITY_RECONCILIATION_POLICY.approvedLinkMethods, [
        'operator_attested',
        'stable_source_reference',
        'reviewed_reconciliation',
    ])
})

test('uses only stable explicit UUID links and yields an order-independent component projection', () => {
    const input = [
        link({ attendanceId: ATTENDANCE_B, canonicalClientId: CLIENT_B, evidenceDigest: DIGEST_B, sourceRevision: 2 }),
        link(),
    ]
    const first = reconcileAtendimentoCrmCoreIdentityLinks({ links: input })
    const replay = reconcileAtendimentoCrmCoreIdentityLinks({ links: [...input].reverse() })
    assert.deepEqual(first, replay)
    assert.deepEqual(first.identityComponents, [
        {
            componentKey: `attendance-client:${CLIENT_A}`,
            sourceType: 'attendance_client',
            sourceId: CLIENT_A,
            attendanceIds: [ATTENDANCE_A],
        },
        {
            componentKey: `attendance-client:${CLIENT_B}`,
            sourceType: 'attendance_client',
            sourceId: CLIENT_B,
            attendanceIds: [ATTENDANCE_B],
        },
    ])
    assert.equal(atendimentoCrmCoreIdentityComponentKey(CLIENT_A.toUpperCase()), `attendance-client:${CLIENT_A}`)
})

test('keeps unresolved rows excluded and refuses ambiguity, name-shaped input, and automatic reassignment', () => {
    const unresolved = reconcileAtendimentoCrmCoreIdentityLinks({
        links: [link({ status: 'unresolved' })],
    })
    assert.deepEqual(unresolved.identityComponents, [])
    assert.deepEqual(unresolved.excludedAttendanceIds, [ATTENDANCE_A])

    assert.throws(() => reconcileAtendimentoCrmCoreIdentityLinks({
        links: [link(), link({ canonicalClientId: CLIENT_B, evidenceDigest: DIGEST_B })],
    }), /AMBIGUOUS_LINK/)
    assert.throws(() => reconcileAtendimentoCrmCoreIdentityLinks({ links: [{ ...link(), clientName: 'must-not-be-accepted' }] }), /LINK_SHAPE_INVALID/)
    assert.throws(() => reconcileAtendimentoCrmCoreIdentityLinks({ links: [link({ method: 'name_heuristic' })] }), /LINK_METHOD_INVALID/)
    assert.throws(() => reconcileAtendimentoCrmCoreIdentityLinks({
        links: [link({ canonicalClientId: CLIENT_B, evidenceDigest: DIGEST_B })],
        persistedLinks: [link()],
    }), /REASSIGNMENT_REVIEW_REQUIRED/)
    assert.throws(() => reconcileAtendimentoCrmCoreIdentityLinks({
        links: [link({ sourceRevision: 1 })],
        persistedLinks: [link({ sourceRevision: 2 })],
    }), /STALE_SOURCE_REVISION/)
    assert.throws(() => reconcileAtendimentoCrmCoreIdentityLinks({
        links: [link({ sourceRevision: 1 })],
        persistedLinks: [link({ status: 'unresolved', sourceRevision: 2 })],
    }), /STALE_SOURCE_REVISION/)
    assert.throws(() => reconcileAtendimentoCrmCoreIdentityLinks({
        links: [link({ evidenceDigest: DIGEST_B })],
        persistedLinks: [link()],
    }), /SAME_REVISION_RECONCILIATION_REVIEW_REQUIRED/)
})

test('preflight isolates legacy registry state, blocks unregistered collisions, and verifies the composite FK', () => {
    const absent = evaluateAtendimentoCrmCoreIdentityMaterializationPreflight({
        relationPresence: readyRelations({ schema: false, registry: true }),
        registryRows: [],
    })
    assert.equal(absent.applyEligible, true)
    assert.equal(absent.runtimeReady, false)

    const collision = evaluateAtendimentoCrmCoreIdentityMaterializationPreflight({
        relationPresence: readyRelations({ schema: true, registry: true }),
        registryRows: [],
    })
    assert.equal(collision.relationCollision, true)
    assert.equal(collision.applyEligible, false)

    const legacy = evaluateAtendimentoCrmCoreIdentityMaterializationPreflight({
        relationPresence: readyRelations({ schema: false, registry: true }),
        registryRows: [{ id: '20260805_client_identity_materialization_schema_v1', rolled_back_at: null }],
    })
    assert.equal(legacy.legacyMigrationActive, true)
    assert.equal(legacy.applyEligible, true)

    const reusedReceipt = evaluateAtendimentoCrmCoreIdentityMaterializationPreflight({
        relationPresence: readyRelations({ schema: false, registry: true }),
        registryRows: [{ id: ATENDIMENTO_CRM_CORE_IDENTITY_MATERIALIZATION_MIGRATION_ID, rolled_back_at: null }],
    })
    assert.equal(reusedReceipt.migrationReceiptCollision, true)
    assert.equal(reusedReceipt.applyEligible, false)

    const active = evaluateAtendimentoCrmCoreIdentityMaterializationPreflight({
        relationPresence: readyRelations({ schema: true, registry: true }),
        registryRows: [{ id: ATENDIMENTO_CRM_CORE_IDENTITY_MATERIALIZATION_MIGRATION_ID, rolled_back_at: null }],
        columnTypes: readyColumnTypes(),
        constraintDefinitions: readyConstraintDefinitions(),
    })
    assert.equal(active.runtimeReady, true)

    const inactiveReceipt = evaluateAtendimentoCrmCoreIdentityMaterializationPreflight({
        relationPresence: readyRelations({ schema: true, registry: true }),
        registryRows: [{ id: ATENDIMENTO_CRM_CORE_IDENTITY_MATERIALIZATION_MIGRATION_ID, rolled_back_at: '2026-09-10T00:00:00.000Z' }],
        columnTypes: readyColumnTypes(),
        constraintDefinitions: readyConstraintDefinitions(),
    })
    assert.equal(inactiveReceipt.schemaReady, true)
    assert.equal(inactiveReceipt.currentMigrationActive, false)
    assert.throws(() => assertAtendimentoCrmCoreIdentityMaterializationRuntimePreflight(inactiveReceipt), /RUNTIME_RECEIPT_MISSING/)

    const incompatibleShape = evaluateAtendimentoCrmCoreIdentityMaterializationPreflight({
        relationPresence: readyRelations({ schema: true, registry: true }),
        registryRows: [{ id: ATENDIMENTO_CRM_CORE_IDENTITY_MATERIALIZATION_MIGRATION_ID, rolled_back_at: null }],
        columnTypes: {
            ...readyColumnTypes(),
            'crm_atendimento.crm_core_identity_members': {
                ...readyColumnTypes()['crm_atendimento.crm_core_identity_members'],
                source_id: 'text',
            },
        },
        constraintDefinitions: readyConstraintDefinitions(),
    })
    assert.equal(incompatibleShape.runtimeReady, false)
    assert.equal(incompatibleShape.applyEligible, false)
    assert.equal(incompatibleShape.schemaContractReady, false)
    assert.deepEqual(incompatibleShape.schemaContractMissingOrMismatchedColumns, [
        'crm_atendimento.crm_core_identity_members.source_id',
    ])

    const missingCompositeFk = evaluateAtendimentoCrmCoreIdentityMaterializationPreflight({
        relationPresence: readyRelations({ schema: true, registry: true }),
        registryRows: [{ id: ATENDIMENTO_CRM_CORE_IDENTITY_MATERIALIZATION_MIGRATION_ID, rolled_back_at: null }],
        columnTypes: readyColumnTypes(),
        constraintDefinitions: {
            ...readyConstraintDefinitions(),
            crm_core_identity_members_identity_source_fk: 'FOREIGN KEY (identity_id) REFERENCES crm_atendimento.crm_core_identities(id)',
        },
    })
    assert.equal(missingCompositeFk.runtimeReady, false)
    assert.deepEqual(missingCompositeFk.schemaContractMissingOrMismatchedConstraints, [
        'crm_core_identity_members_identity_source_fk',
    ])
})

test('applies only guarded schema DDL before recording the migration', async () => {
    const calls = []
    let schema = false
    let registry = false
    let migrationReceiptActive = false
    let released = false
    const client = {
        async query(sql, params = []) {
            calls.push({ sql, params })
            if (/current_database\(\)/i.test(sql)) {
                return { rows: [{ database_name: 'skincos_crm_local', database_user: 'admin', session_user: 'admin', read_only: 'off' }] }
            }
            if (/create table if not exists crm_atendimento\.schema_migrations/i.test(sql)) registry = true
            if (/create table if not exists crm_atendimento\.crm_core_identity_materialization_runs/i.test(sql)) schema = true
            if (/select to_regclass\(\$1\)/i.test(sql)) {
                return {
                    rows: [Object.fromEntries(params.map((relation, index) => [
                        `relation_${index}`,
                        ATENDIMENTO_CRM_CORE_IDENTITY_PREREQUISITE_RELATIONS.includes(relation)
                            ? relation
                            : relation === 'crm_atendimento.schema_migrations'
                                ? (registry ? relation : null)
                                : (schema ? relation : null),
                    ]))],
                }
            }
            if (/from crm_atendimento\.schema_migrations/i.test(sql)) {
                return {
                    rows: migrationReceiptActive
                        ? [{ id: ATENDIMENTO_CRM_CORE_IDENTITY_MATERIALIZATION_MIGRATION_ID, rolled_back_at: null }]
                        : [],
                }
            }
            if (/insert into crm_atendimento\.schema_migrations/i.test(sql)) migrationReceiptActive = true
            if (/from information_schema\.columns/i.test(sql)) {
                return {
                    rows: schema
                        ? Object.entries(ATENDIMENTO_CRM_CORE_IDENTITY_SCHEMA_COLUMN_CONTRACT)
                            .flatMap(([relation, columns]) => Object.entries(columns)
                                .map(([column_name, udt_name]) => ({ relation, column_name, udt_name })))
                        : [],
                }
            }
            if (/from pg_constraint/i.test(sql)) {
                return {
                    rows: Object.entries(readyConstraintDefinitions()).map(([constraint_name, constraint_definition]) => ({
                        constraint_name,
                        constraint_definition,
                    })),
                }
            }
            return { rows: [], rowCount: 0 }
        },
        release() { released = true },
    }
    const report = await applyAtendimentoCrmCoreIdentityMaterializationMigration({
        pool: { connect: async () => client },
        databaseUrl: LOCAL_SOCKET_URL,
    })
    assert.equal(report.applied, true)
    assert.equal(released, true)
    const source = calls.map(({ sql }) => String(sql)).join('\n')
    assert.match(source, /begin/i)
    assert.match(source, /pg_advisory_xact_lock/i)
    assert.match(source, /create table if not exists crm_atendimento\.crm_core_identity_clients/i)
    assert.match(source, /create table if not exists crm_atendimento\.crm_core_attendance_client_links/i)
    assert.match(source, /create table if not exists crm_atendimento\.crm_core_identity_members/i)
    assert.match(source, /foreign key \(identity_id, source_id\)[\s\S]*crm_core_identities\(id, canonical_client_id\)/i)
    assert.match(source, /insert into crm_atendimento\.schema_migrations/i)
    assert.match(source, /commit/i)
})

test('migration source and SQL companion contain neither broad-domain references nor name-derived identity shortcuts', async () => {
    const modulePath = fileURLToPath(new URL('../crmCoreIdentityMaterializationMigration.js', import.meta.url))
    const sqlPath = fileURLToPath(new URL('../migrations/20260910_atendimento_crm_core_identity_materialization_v1.up.sql', import.meta.url))
    for (const source of await Promise.all([readFile(modulePath, 'utf8'), readFile(sqlPath, 'utf8')])) {
        assert.doesNotMatch(source, /\b(?:crm_caixa|caixa_customer)\b/i)
        assert.doesNotMatch(source, /\b(?:create\s+role|grant\s+)\b/i)
        assert.doesNotMatch(source, /\b(?:client_name|uuid_generate_v5|uuid_v5|md5)\b/i)
        assert.doesNotMatch(source, /identityReviewWorkflow/i)
        assert.doesNotMatch(source, /crm_atendimento\.(?:canonical_clients|attendance_client_links|global_client_identities|global_client_identity_members)\b/i)
    }
    assert.deepEqual(Object.keys(ATENDIMENTO_CRM_CORE_IDENTITY_SCHEMA_CONSTRAINT_CONTRACT), [
        'crm_core_identities_id_canonical_client_key',
        'crm_core_identity_members_identity_source_fk',
    ])
})
