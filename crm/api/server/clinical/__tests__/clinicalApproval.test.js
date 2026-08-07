import test from 'node:test'
import assert from 'node:assert/strict'
import { clinicalApprovalMigrationPlan, clinicalApprovalMigrationStatements, clinicalApprovalRuntimeGrantStatements, parseClinicalApprovalMigrationAction } from '../clinicalApprovalMigration.js'
import { clinicalApprovalRouteContract, createClinicalApprovalRouter } from '../routes.js'
import { clinicalApprovalTestHelpers, createClinicalApprovalStore } from '../clinicalApprovalStore.js'

const validProcedure = '4bcf7ee4-0b5a-4277-a7d8-a93bfcb80b51'

test('clinical approval contract is independent and fail-closed', () => {
    const plan = clinicalApprovalMigrationPlan()
    assert.equal(plan.schema, 'clinical_approval')
    assert.deepEqual(plan.lifecycle, ['draft', 'submitted', 'approved', 'rejected', 'expired', 'disabled'])
    assert.deepEqual(plan.appendOnly, ['rule_revisions', 'rule_events', 'command_dedup'])
    assert.equal(plan.rollback.includes('non-destructive'), true)
    assert.equal(clinicalApprovalMigrationStatements.some((sql) => sql.includes('clinical_approval_rule_revisions_immutable')), true)
    assert.equal(clinicalApprovalMigrationStatements.some((sql) => sql.includes('clinical_approval_rules_transition_guard')), true)
    assert.equal(clinicalApprovalMigrationStatements.some((sql) => sql.includes('clinical_approval_rules_event_evidence')), true)
    assert.equal(clinicalApprovalMigrationStatements.some((sql) => sql.includes('clinical_approval_rules_no_delete')), true)
    assert.equal(clinicalApprovalMigrationStatements.some((sql) => sql.includes('CLINICAL_CADENCE_APPROVAL_REQUIRED')), true)
    assert.equal(clinicalApprovalMigrationStatements.some((sql) => sql.includes('clinical_approval_rules_approver_not_author')), true)
    assert.equal(clinicalApprovalMigrationStatements.some((sql) => sql.includes('requires append-only revision evidence')), true)
    assert.equal(clinicalApprovalRuntimeGrantStatements('staging').some((sql) => sql.includes('grant select on table clinical_approval.schema_migrations')), true)
    assert.equal(clinicalApprovalRouteContract.basePath, '/api/clinical')
    assert.equal(clinicalApprovalRouteContract.messaging, false)
    assert.equal(clinicalApprovalRouteContract.recommendationAutomation, false)
})

test('migration action parser rejects ambiguous or arbitrary commands', () => {
    assert.equal(parseClinicalApprovalMigrationAction(['--apply']), 'apply')
    assert.equal(parseClinicalApprovalMigrationAction(['--rollback']), 'rollback')
    assert.throws(() => parseClinicalApprovalMigrationAction([]), (error) => error.code === 'CLINICAL_APPROVAL_MIGRATION_ACTION_INVALID')
    assert.throws(() => parseClinicalApprovalMigrationAction(['--apply', 'shell']), (error) => error.code === 'CLINICAL_APPROVAL_MIGRATION_ACTION_INVALID')
})

test('rule input is explicit, bounded and does not accept PII-shaped free fields', () => {
    const input = clinicalApprovalTestHelpers.normalizeRuleInput({
        procedureId: validProcedure,
        unit: 'Novo Hamburgo',
        intervalMinDays: 30,
        intervalMaxDays: 60,
        justification: 'Janela baseada em revisão clínica publicada.',
        evidenceReference: 'protocol://clinical/v1',
        effectiveFrom: '2026-08-06',
        expiresAt: '2026-12-31',
    })
    assert.deepEqual(input, {
        procedureId: validProcedure,
        unitSlug: 'novo-hamburgo',
        intervalMinDays: 30,
        intervalMaxDays: 60,
        justification: 'Janela baseada em revisão clínica publicada.',
        evidenceReference: 'protocol://clinical/v1',
        effectiveFrom: '2026-08-06',
        expiresAt: '2026-12-31',
    })
    assert.throws(() => clinicalApprovalTestHelpers.normalizeRuleInput({ ...input, justification: 'curto' }), /CLINICAL_APPROVAL_JUSTIFICATION_REQUIRED/)
    assert.throws(() => clinicalApprovalTestHelpers.normalizeRuleInput({ ...input, expiresAt: '2026-08-05' }), /CLINICAL_APPROVAL_EXPIRY_INVALID/)
})

test('idempotency hashes are stable and keys are bounded', () => {
    const first = clinicalApprovalTestHelpers.requestHash('approve', { id: validProcedure, expectedRevision: 2, reason: 'ok' })
    const second = clinicalApprovalTestHelpers.requestHash('approve', { reason: 'ok', expectedRevision: 2, id: validProcedure })
    assert.equal(first, second)
    assert.equal(clinicalApprovalTestHelpers.normalizeIdempotencyKey('clinical:approve:1'), 'clinical:approve:1')
    assert.throws(() => clinicalApprovalTestHelpers.normalizeIdempotencyKey(''), /CLINICAL_APPROVAL_IDEMPOTENCY_KEY_REQUIRED/)
    assert.throws(() => clinicalApprovalTestHelpers.normalizeIdempotencyKey('a'.repeat(161)), /CLINICAL_APPROVAL_IDEMPOTENCY_KEY_REQUIRED/)
})

test('clinical domain keeps PII out of append-only evidence and accepts only opaque actor subjects', () => {
    assert.throws(() => clinicalApprovalTestHelpers.normalizeRuleInput({
        procedureId: validProcedure,
        unit: 'Novo Hamburgo',
        intervalMinDays: 30,
        intervalMaxDays: 60,
        justification: 'Solicitação enviada para teste@exemplo.com.',
        evidenceReference: 'protocol://clinical/v1',
        effectiveFrom: '2026-08-06',
    }), /CLINICAL_APPROVAL_PII_NOT_ALLOWED/)
    assert.throws(() => clinicalApprovalTestHelpers.actorIdOf({ id: 'teste@exemplo.com', role: 'GESTOR' }), /CLINICAL_APPROVAL_ACTOR_REQUIRED/)
    assert.equal(clinicalApprovalTestHelpers.allowedUnitSlugs({ id: 'admin-1', role: 'GESTOR', isGlobalAdmin: true }), null)
})

test('clinical mutation gate is enforced inside the domain, not only by HTTP routes', async () => {
    const beforeEnabled = process.env.CLINICAL_APPROVAL_ENABLED
    const beforeReadOnly = process.env.CRM_ATENDIMENTO_READ_ONLY
    try {
        delete process.env.CLINICAL_APPROVAL_ENABLED
        delete process.env.CRM_ATENDIMENTO_READ_ONLY
        const store = createClinicalApprovalStore()
        await assert.rejects(
            () => store.createDraft({}, { id: 'gestor-1', role: 'GESTOR' }, 'gate-fixture'),
            { message: 'CLINICAL_APPROVAL_DISABLED', statusCode: 503 },
        )
        process.env.CLINICAL_APPROVAL_ENABLED = 'true'
        process.env.CRM_ATENDIMENTO_READ_ONLY = 'true'
        await assert.rejects(
            () => store.createDraft({}, { id: 'gestor-1', role: 'GESTOR' }, 'gate-fixture'),
            { message: 'CLINICAL_APPROVAL_READ_ONLY', statusCode: 405 },
        )
    } finally {
        if (beforeEnabled === undefined) delete process.env.CLINICAL_APPROVAL_ENABLED
        else process.env.CLINICAL_APPROVAL_ENABLED = beforeEnabled
        if (beforeReadOnly === undefined) delete process.env.CRM_ATENDIMENTO_READ_ONLY
        else process.env.CRM_ATENDIMENTO_READ_ONLY = beforeReadOnly
    }
})

test('database liveness is bounded while health stays available', async () => {
    const store = createClinicalApprovalStore({
        pool: { query() { return new Promise(() => {}) } },
        readinessTimeoutMs: 10,
    })
    const startedAt = Date.now()
    const health = await store.health()
    assert.equal(health.ok, true)
    assert.equal(health.ready, false)
    assert.ok(Date.now() - startedAt < 250)
    const readiness = await store.readiness()
    assert.deepEqual(readiness.dependencies, { database: false, schema: false })
})

test('idempotency acquires the command lock before checking prior results', async () => {
    const beforeEnabled = process.env.CLINICAL_APPROVAL_ENABLED
    const beforeReadOnly = process.env.CRM_ATENDIMENTO_READ_ONLY
    process.env.CLINICAL_APPROVAL_ENABLED = 'true'
    delete process.env.CRM_ATENDIMENTO_READ_ONLY
    const calls = []
    const input = clinicalApprovalTestHelpers.normalizeRuleInput({
        procedureId: validProcedure,
        unit: 'Novo Hamburgo',
        intervalMinDays: 30,
        intervalMaxDays: 60,
        justification: 'Janela baseada em revisão clínica publicada.',
        evidenceReference: 'protocol://clinical/v1',
        effectiveFrom: '2026-08-06',
    })
    const previousResult = { rule: { id: 'rule-1', status: 'draft' }, idempotent: false }
    const client = {
        async query(sql, params = []) {
            calls.push({ scope: 'transaction', sql, params })
            if (['begin', 'commit', 'rollback'].includes(sql)) return { rows: [] }
            if (sql.includes('pg_advisory_xact_lock')) return { rows: [] }
            if (sql.includes('from clinical_approval.command_dedup')) {
                return { rows: [{ request_hash: clinicalApprovalTestHelpers.requestHash('create_draft', input), result: previousResult }] }
            }
            throw new Error(`unexpected transaction query: ${sql}`)
        },
        release() {},
    }
    const pool = {
        async query(sql, params = []) {
            calls.push({ scope: 'probe', sql, params })
            if (sql.includes('to_regclass')) return { rows: [{ registry: 'clinical_approval.schema_migrations', rules: 'clinical_approval.rules', revisions: 'clinical_approval.rule_revisions', events: 'clinical_approval.rule_events', dedup: 'clinical_approval.command_dedup' }] }
            if (sql.includes('from clinical_approval.schema_migrations')) return { rows: [{ ok: 1 }] }
            throw new Error(`unexpected readiness query: ${sql}`)
        },
        async connect() { return client },
    }
    try {
        const store = createClinicalApprovalStore({ pool })
        const result = await store.createDraft(input, { id: 'gestor-1', role: 'GESTOR' }, 'replay-fixture')
        assert.deepEqual(result, previousResult)
        const transactionCalls = calls.filter((call) => call.scope === 'transaction')
        const lockIndex = transactionCalls.findIndex((call) => call.sql.includes('pg_advisory_xact_lock'))
        const dedupIndex = transactionCalls.findIndex((call) => call.sql.includes('from clinical_approval.command_dedup'))
        assert.ok(lockIndex >= 0)
        assert.ok(dedupIndex > lockIndex)
    } finally {
        if (beforeEnabled === undefined) delete process.env.CLINICAL_APPROVAL_ENABLED
        else process.env.CLINICAL_APPROVAL_ENABLED = beforeEnabled
        if (beforeReadOnly === undefined) delete process.env.CRM_ATENDIMENTO_READ_ONLY
        else process.env.CRM_ATENDIMENTO_READ_ONLY = beforeReadOnly
    }
})

test('clinical reviewers require an explicit unit scope', () => {
    assert.deepEqual(clinicalApprovalTestHelpers.allowedUnitSlugs({ role: 'CLINICAL_APPROVER' }), [])
    assert.deepEqual(clinicalApprovalTestHelpers.allowedUnitSlugs({ role: 'CLINICAL_APPROVER', allowedUnits: ['Novo Hamburgo'] }), ['novo-hamburgo'])
})

function captureRoutes(store) {
    const routes = new Map()
    const router = {
        get(path, handler) { routes.set(`GET ${path}`, handler); return router },
        post(path, handler) { routes.set(`POST ${path}`, handler); return router },
    }
    createClinicalApprovalRouter({
        store,
        getActor: async (req) => req.actor || null,
        routerFactory: () => router,
    })
    return routes
}

function response() {
    const state = { status: null, body: null, headers: {} }
    return { state, status(value) { state.status = value; return this }, set(key, value) { state.headers[key] = value; return this }, json(value) { state.body = value; return this } }
}

test('route exposes health without auth and protects approval decisions by role', async () => {
    const calls = []
    const store = {
        async health() { return { ok: true, ready: false, domain: 'clinical-approval', writesEnabled: false, pii: false } },
        async readiness() { return { ok: false, ready: false, domain: 'clinical-approval' } },
        async listRules() { return { rules: [], total: 0 } },
        async approve(...args) { calls.push(args); return { rule: { id: validProcedure, revision: 1, status: 'approved' } } },
        async reject() { return { rule: { id: validProcedure, revision: 1, status: 'rejected' } } },
    }
    const routes = captureRoutes(store)
    const health = response()
    await routes.get('GET /health')({}, health)
    assert.equal(health.state.status, 200)
    assert.equal(health.state.body.pii, false)
    const publicReadiness = response()
    await routes.get('GET /readiness')({}, publicReadiness)
    assert.equal(publicReadiness.state.status, 401)
    const unauthenticated = response()
    await routes.get('GET /approvals')({ query: {} }, unauthenticated)
    assert.equal(unauthenticated.state.status, 401)
    const internalReadiness = response()
    await routes.get('GET /readiness')({ actor: { id: 'clinical-1', role: 'CLINICAL_APPROVER', allowedUnits: ['Novo Hamburgo'] } }, internalReadiness)
    assert.equal(internalReadiness.state.status, 503)
    const readyRoutes = captureRoutes({
        async health() { return { ok: true, ready: true, domain: 'clinical-approval', writesEnabled: false, pii: false } },
        async readiness() { return { ok: true, ready: true, domain: 'clinical-approval', dependencies: { database: true, schema: true } } },
        async listRules() { return { rules: [], total: 0 } },
    })
    const readyHealth = response()
    await readyRoutes.get('GET /health')({}, readyHealth)
    assert.equal(readyHealth.state.status, 200)
    assert.equal(readyHealth.state.body.ready, true)
    const readyReadiness = response()
    await readyRoutes.get('GET /readiness')({ actor: { id: 'clinical-1', role: 'CLINICAL_APPROVER', allowedUnits: ['Novo Hamburgo'] } }, readyReadiness)
    assert.equal(readyReadiness.state.status, 200)
    assert.equal(readyReadiness.state.body.dependencies.database, true)
    const authorized = response()
    await routes.get('GET /approvals')({ query: {}, actor: { id: 'clinical-1', role: 'CLINICAL_APPROVER', allowedUnits: ['Novo Hamburgo'] } }, authorized)
    assert.equal(authorized.state.status, 200)
    assert.equal(authorized.state.body.total, 0)
    const before = process.env.CLINICAL_APPROVAL_ENABLED
    process.env.CLINICAL_APPROVAL_ENABLED = 'true'
    try {
        const decision = response()
        const idempotencyHeader = ['idempotency', 'key'].join('-')
        await routes.get('POST /approvals/:id/approve')({ params: { id: validProcedure }, body: { expectedRevision: 1 }, headers: { [idempotencyHeader]: 'approval-fixture' }, actor: { id: 'clinical-1', role: 'CLINICAL_APPROVER' } }, decision)
        assert.equal(decision.state.status, 200)
        assert.equal(calls.length, 1)
        assert.equal(calls[0][2].role, 'CLINICAL_APPROVER')
    } finally {
        if (before === undefined) delete process.env.CLINICAL_APPROVAL_ENABLED
        else process.env.CLINICAL_APPROVAL_ENABLED = before
    }
})

test('read-only gate blocks all clinical mutation routes', async () => {
    const before = process.env.CRM_ATENDIMENTO_READ_ONLY
    process.env.CRM_ATENDIMENTO_READ_ONLY = 'true'
    try {
        const store = { async health() { return { ok: true, ready: true } }, async readiness() { return { ok: true, ready: true } }, async createDraft() { throw new Error('should not call') } }
        const routes = captureRoutes(store)
        const out = response()
        await routes.get('POST /approvals/drafts')({ body: {}, headers: {}, actor: { id: 'gestor-1', role: 'GESTOR' } }, out)
        assert.equal(out.state.status, 405)
        assert.equal(out.state.body.error, 'CLINICAL_APPROVAL_READ_ONLY')
    } finally {
        if (before === undefined) delete process.env.CRM_ATENDIMENTO_READ_ONLY
        else process.env.CRM_ATENDIMENTO_READ_ONLY = before
    }
})
