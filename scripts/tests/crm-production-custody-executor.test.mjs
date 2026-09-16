import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'

import {
    ALLOWED_UNIT_SCOPES,
    APPLY_CONFIRMATION,
    PRODUCTION_DATABASE,
    PRODUCTION_WRITER_ROLE,
    assertExternalPath,
    executeCrmProductionCustody,
    parseCrmProductionCustodyArgs,
    summarizeReviewedBatch,
} from '../crm/crm-production-custody-executor.mjs'
import {
    ATENDIMENTO_CRM_CORE_IDENTITY_MATERIALIZATION_MIGRATION_ID,
    ATENDIMENTO_CRM_CORE_IDENTITY_PREREQUISITE_RELATIONS,
    ATENDIMENTO_CRM_CORE_IDENTITY_RELATIONS,
} from '../../shared/crm-auth/atendimentoCrmCoreIdentityMaterializationPolicy.js'

const ATENDIMENTO_CRM_CORE_IDENTITY_SCHEMA_COLUMN_CONTRACT = {
    'crm_atendimento.crm_core_identity_clients': { id: 'uuid', state: 'text', origin: 'text' },
    'crm_atendimento.crm_core_attendance_client_links': {
        attendance_id: 'uuid', canonical_client_id: 'uuid', status: 'text', method: 'text', evidence_digest: 'text', source_revision: 'int4',
    },
    'crm_atendimento.crm_core_identities': {
        id: 'uuid', canonical_client_id: 'uuid', component_key: 'text', state: 'text', policy_version: 'text',
    },
    'crm_atendimento.crm_core_identity_members': { identity_id: 'uuid', source_type: 'text', source_id: 'uuid' },
    'crm_atendimento.crm_core_identity_materialization_runs': {
        id: 'uuid', writer_contract: 'text', policy_version: 'text', input_digest: 'text', output_digest: 'text', status: 'text', confirmed_link_count: 'int4', identity_count: 'int4',
    },
}

const DATABASE_URL = `postgresql://${PRODUCTION_WRITER_ROLE}:test-only-password@127.0.0.1:5432/${PRODUCTION_DATABASE}?sslmode=require&uselibpqcompat=true`
const RUN_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const BATCH_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
const ATTENDANCE_ID = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'
const CLIENT_ID = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd'
const EVIDENCE_DIGEST = `sha256:${'a'.repeat(64)}`

function reviewedBatch(overrides = {}) {
    return {
        contract: 'atendimento/crm-core/identity-review-batch/v1',
        batchId: BATCH_ID,
        runId: RUN_ID,
        review: {
            owner: 'atendimento',
            decision: 'approved',
            reviewerKeyId: 'reviewer-key-1',
            reviewedAt: '2026-09-16T12:00:00.000Z',
        },
        links: [{
            attendanceId: ATTENDANCE_ID,
            canonicalClientId: CLIENT_ID,
            status: 'confirmed',
            method: 'reviewed_reconciliation',
            evidenceDigest: EVIDENCE_DIGEST,
            sourceRevision: 1,
        }],
        ...overrides,
    }
}

function readyRows() {
    return Object.entries(ATENDIMENTO_CRM_CORE_IDENTITY_SCHEMA_COLUMN_CONTRACT)
        .flatMap(([relation, columns]) => Object.entries(columns)
            .map(([column_name, udt_name]) => ({ relation, column_name, udt_name })))
}

function readyConstraints() {
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

function fakePool({ writable = false } = {}) {
    const calls = []
    const identityId = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee'
    let writeTransaction = false
    const client = {
        async query(sql, params = []) {
            const statement = String(sql)
            calls.push({ sql: statement, params })
            if (/^begin isolation level repeatable read/i.test(statement)) writeTransaction = true
            if (/^(?:commit|rollback)$/i.test(statement.trim())) writeTransaction = false
            if (/current_database\(\)/i.test(statement)) {
                return { rows: [{ database_name: PRODUCTION_DATABASE, database_user: PRODUCTION_WRITER_ROLE, session_user: PRODUCTION_WRITER_ROLE, read_only: writeTransaction && writable ? 'off' : 'on' }] }
            }
            if (/select current_user as current_user/i.test(statement)) {
                return { rows: [{ current_user: PRODUCTION_WRITER_ROLE, session_user: PRODUCTION_WRITER_ROLE }] }
            }
            if (/select to_regclass\(\$1\)/i.test(statement)) {
                return { rows: [Object.fromEntries(params.map((relation, index) => [`relation_${index}`, Boolean(relation)]))] }
            }
            if (/from crm_atendimento\.schema_migrations/i.test(statement)) {
                return { rows: [{ id: ATENDIMENTO_CRM_CORE_IDENTITY_MATERIALIZATION_MIGRATION_ID, rolled_back_at: null }] }
            }
            if (/from information_schema\.columns/i.test(statement)) return { rows: readyRows() }
            if (/from pg_constraint/i.test(statement)) return { rows: readyConstraints() }
            if (/select count\(\*\)/i.test(statement)) return { rows: [{ row_count: 0 }] }
            if (/from crm_atendimento\.crm_core_identity_materialization_runs/i.test(statement)) return { rows: [] }
            if (/from crm_atendimento\.crm_core_attendance_client_links/i.test(statement)) return { rows: [] }
            if (/insert into crm_atendimento\.crm_core_identity_clients/i.test(statement)) return { rows: [], rowCount: 1 }
            if (/insert into crm_atendimento\.crm_core_attendance_client_links/i.test(statement)) return { rows: [{ attendance_id: params[0] }], rowCount: 1 }
            if (/insert into crm_atendimento\.crm_core_identities/i.test(statement)) return { rows: [{ identity_id: identityId, canonical_client_id: params[0] }], rowCount: 1 }
            if (/insert into crm_atendimento\.crm_core_identity_members/i.test(statement)) return { rows: [{ identity_id: params[0], source_id: params[2] }], rowCount: 1 }
            if (/insert into crm_atendimento\.crm_core_identity_materialization_runs/i.test(statement)) return { rows: [{ run_id: params[0] }], rowCount: 1 }
            return { rows: [], rowCount: 0 }
        },
        release() {},
    }
    return { calls, pool: { connect: async () => client }, end: async () => {} }
}

function fakeRuntime({ materialize = false } = {}) {
    const relations = Object.fromEntries([
        ...ATENDIMENTO_CRM_CORE_IDENTITY_PREREQUISITE_RELATIONS,
        ...ATENDIMENTO_CRM_CORE_IDENTITY_RELATIONS,
        'crm_atendimento.schema_migrations',
    ].map((relation) => [relation, true]))
    return {
        inspectAtendimentoCrmCoreIdentityMaterializationPreflight: async () => ({
            prerequisitesReady: true,
            schemaContractReady: true,
            schemaReady: true,
            currentMigrationActive: true,
            legacyMigrationActive: true,
            relations,
        }),
        ...(materialize ? {
            materializeAtendimentoCrmCoreIdentityLinks: async () => ({
                inputDigest: `sha256:${'b'.repeat(64)}`,
                outputDigest: `sha256:${'c'.repeat(64)}`,
                confirmedLinkCount: 1,
                identityCount: 1,
                idempotent: false,
            }),
        } : {}),
    }
}

test('parses only the explicit production custody surface', () => {
    const parsed = parseCrmProductionCustodyArgs([
        '--mode', 'apply',
        '--target', 'production',
        '--unit', ALLOWED_UNIT_SCOPES[0],
        '--batch-file', 'C:\\external\\batch.json',
        '--checkpoint-file', 'C:\\external\\checkpoint.json',
        '--receipt-file', 'C:\\external\\receipt.json',
    ])
    assert.equal(parsed.mode, 'apply')
    assert.equal(parsed.target, 'production')
    assert.throws(() => parseCrmProductionCustodyArgs(['--mode', 'apply', '--target', 'staging']), /TARGET_INVALID/)
    assert.throws(() => parseCrmProductionCustodyArgs(['--mode', 'apply', '--target', 'production', '--unit', 'all', '--batch-file', 'x', '--checkpoint-file', 'y', '--receipt-file', 'z']), /UNIT_INVALID/)
})

test('creates a deterministic, privacy-preserving plan from the reviewed UUID batch', () => {
    const first = summarizeReviewedBatch(reviewedBatch(), ALLOWED_UNIT_SCOPES[0])
    const second = summarizeReviewedBatch(reviewedBatch(), ALLOWED_UNIT_SCOPES[0])
    assert.deepEqual(first, second)
    assert.equal(first.linkCount, 1)
    assert.equal(first.canonicalClientCount, 1)
    assert.match(first.batchDigest, /^sha256:[a-f0-9]{64}$/)
    assert.equal(first.privacy.piiIncluded, false)
    assert.equal('attendanceId' in first, false)
    assert.equal('canonicalClientId' in first, false)
})

test('rejects PII-shaped fields and custody files inside the source repository', async () => {
    assert.throws(() => summarizeReviewedBatch({ ...reviewedBatch(), clientName: 'never accepted' }, ALLOWED_UNIT_SCOPES[0]), /REVIEW_BATCH_INVALID|SENSITIVE/)
    const root = await mkdtemp(path.join(os.tmpdir(), 'crm-custody-root-'))
    try {
        assert.throws(() => assertExternalPath(path.join(root, 'batch.json'), root), /OUTSIDE_REPOSITORY/)
    } finally {
        await rm(root, { recursive: true, force: true })
    }
})

test('preflight reads the dedicated production database without issuing writes', async () => {
    const fixture = fakePool()
    const repositoryRoot = await mkdtemp(path.join(os.tmpdir(), 'crm-custody-repo-'))
    const report = await executeCrmProductionCustody({
        mode: 'preflight',
        target: 'production',
        databaseUrl: DATABASE_URL,
        pool: fixture.pool,
        repositoryRoot,
        runtime: fakeRuntime(),
    })
    assert.equal(report.state, 'preflight-read-only')
    assert.equal(report.mutationAllowed, false)
    assert.equal(report.preflight.destination.database, PRODUCTION_DATABASE)
    assert.equal(fixture.calls.some(({ sql }) => /\b(insert|update|delete|create|drop)\b/i.test(sql)), false)
    await rm(repositoryRoot, { recursive: true, force: true })
})

test('apply requires the explicit custody confirmation before touching production', async () => {
    const fixture = fakePool()
    const repositoryRoot = await mkdtemp(path.join(os.tmpdir(), 'crm-custody-repo-'))
    const externalRoot = await mkdtemp(path.join(os.tmpdir(), 'crm-custody-external-'))
    await assert.rejects(() => executeCrmProductionCustody({
        mode: 'apply',
        target: 'production',
        unit: ALLOWED_UNIT_SCOPES[0],
        batch: reviewedBatch(),
        databaseUrl: DATABASE_URL,
        pool: fixture.pool,
        repositoryRoot,
        checkpointFile: path.join(externalRoot, 'checkpoint.json'),
        receiptFile: path.join(externalRoot, 'receipt.json'),
        applyConfirmation: false,
        runtime: fakeRuntime(),
    }), /APPLY_CONFIRMATION_REQUIRED/)
    assert.equal(fixture.calls.some(({ sql }) => /\b(insert|update|delete)\b/i.test(sql)), false)
    assert.equal(APPLY_CONFIRMATION, 'CRM_PRODUCTION_CUSTODY_APPLY')
    await rm(repositoryRoot, { recursive: true, force: true })
    await rm(externalRoot, { recursive: true, force: true })
})

test('apply writes an external checkpoint and sanitized receipt after the transactional writer succeeds', async () => {
    const fixture = fakePool({ writable: true })
    const repositoryRoot = await mkdtemp(path.join(os.tmpdir(), 'crm-custody-repo-'))
    const externalRoot = await mkdtemp(path.join(os.tmpdir(), 'crm-custody-external-'))
    const checkpointFile = path.join(externalRoot, 'checkpoint.json')
    const receiptFile = path.join(externalRoot, 'receipt.json')
    try {
        const report = await executeCrmProductionCustody({
            mode: 'apply',
            target: 'production',
            unit: ALLOWED_UNIT_SCOPES[0],
            batch: reviewedBatch(),
            databaseUrl: DATABASE_URL,
            pool: fixture.pool,
            repositoryRoot,
            checkpointFile,
            receiptFile,
            applyConfirmation: true,
            runtime: fakeRuntime({ materialize: true }),
        })
        assert.equal(report.state, 'applied')
        assert.equal(report.writer.confirmedLinkCount, 1)
        assert.match(report.writer.inputDigest, /^sha256:[a-f0-9]{64}$/)
        assert.match(report.checkpointDigest, /^sha256:[a-f0-9]{64}$/)
        const checkpoint = JSON.parse(await readFile(checkpointFile, 'utf8'))
        const receipt = JSON.parse(await readFile(receiptFile, 'utf8'))
        assert.equal(checkpoint.state, 'before-apply')
        assert.equal(receipt.state, 'applied')
        assert.equal('attendanceId' in receipt, false)
        assert.equal('canonicalClientId' in receipt, false)
        assert.equal(receipt.privacy.piiIncluded, false)
    } finally {
        await rm(repositoryRoot, { recursive: true, force: true })
        await rm(externalRoot, { recursive: true, force: true })
    }
})
