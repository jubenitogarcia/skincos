import test from 'node:test'
import assert from 'node:assert/strict'
import { clinicalApprovalMigrationPlan, clinicalApprovalMigrationStatements, parseClinicalApprovalMigrationAction } from '../clinicalApprovalMigration.js'
import { clinicalApprovalRouteContract, createClinicalApprovalRouter } from '../routes.js'
import { clinicalApprovalTestHelpers } from '../clinicalApprovalStore.js'

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
    const authorized = response()
    await routes.get('GET /approvals')({ query: {}, actor: { id: 'clinical-1', role: 'CLINICAL_APPROVER', allowedUnits: ['Novo Hamburgo'] } }, authorized)
    assert.equal(authorized.state.status, 200)
    assert.equal(authorized.state.body.total, 0)
    const before = process.env.CLINICAL_APPROVAL_ENABLED
    process.env.CLINICAL_APPROVAL_ENABLED = 'true'
    try {
        const decision = response()
        await routes.get('POST /approvals/:id/approve')({ params: { id: validProcedure }, body: { expectedRevision: 1 }, headers: { 'idempotency-key': 'clinical-approve-1' }, actor: { id: 'clinical-1', role: 'CLINICAL_APPROVER' } }, decision)
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
