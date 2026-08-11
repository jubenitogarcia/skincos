import test from 'node:test'
import assert from 'node:assert/strict'

import { __testables, createAtendimentoRouter } from '../routes.js'

function actorHeader(actor) {
    return Buffer.from(JSON.stringify(actor)).toString('base64url')
}

function captureAtendimentoRoutes(store, options = {}) {
    const routes = new Map()
    const router = {
        use(handler) {
            if (typeof handler === 'function' && handler.length >= 3) routes.middleware = handler
            return router
        },
        get(path, handler) { routes.set(`GET ${path}`, handler); return router },
        post(path, handler) { routes.set(`POST ${path}`, handler); return router },
        put(path, handler) { routes.set(`PUT ${path}`, handler); return router },
        patch(path, handler) { routes.set(`PATCH ${path}`, handler); return router },
        delete(path, handler) { routes.set(`DELETE ${path}`, handler); return router },
    }
    createAtendimentoRouter({ store, ...options, routerFactory: () => router })
    return routes
}

function captureResponse() {
    const state = { status: null, body: null, headers: {} }
    return {
        state,
        status(value) { state.status = value; return this },
        set(key, value) { state.headers[String(key).toLowerCase()] = value; return this },
        json(value) { state.body = value; return this },
    }
}

function clientError(message, statusCode) {
    const error = new Error(message)
    error.statusCode = statusCode
    return error
}

test('treats only the socket peer, never a forged Host header, as local', () => {
    assert.equal(__testables.isLocalRequest({ socket: { remoteAddress: '127.0.0.1' }, headers: { host: 'example.test' } }), true)
    assert.equal(__testables.isLocalRequest({ socket: { remoteAddress: '::ffff:127.0.0.1' }, headers: { host: 'example.test' } }), true)
    assert.equal(__testables.isLocalRequest({ socket: { remoteAddress: '10.0.0.50' }, headers: { host: 'localhost' } }), false)
})

test('accepts an unsigned actor only from an explicit loopback development runtime', async () => {
    const before = process.env.CRM_LOCAL_NO_AUTH
    process.env.CRM_LOCAL_NO_AUTH = 'true'
    const headers = { 'x-crm-user': actorHeader({ id: 'operator-1', role: 'INJETOR', allowedUnits: ['novo-hamburgo'] }) }
    try {
        assert.equal(await __testables.verifySignedActor({ headers, socket: { remoteAddress: '10.0.0.50' } }, ''), null)
        assert.equal((await __testables.verifySignedActor({ headers, socket: { remoteAddress: '127.0.0.1' } }, ''))?.id, 'operator-1')
    } finally {
        if (before === undefined) delete process.env.CRM_LOCAL_NO_AUTH
        else process.env.CRM_LOCAL_NO_AUTH = before
    }
})

test('redacts untrusted internal failures before returning them to a browser', () => {
    const error = new Error('connect ECONNREFUSED postgres.internal:5432 for Cynthia Cordova')
    const response = __testables.errorPayload(error)
    assert.equal(response.status, 500)
    assert.deepEqual(response.body, { ok: false, error: 'INTERNAL_ERROR', hint: undefined })
})

test('redacts credentials from local-only diagnostic output', () => {
    const diagnostic = __testables.redactLocalDiagnostic('postgresql://user:password@db.local/skincos?token=value')
    assert.match(diagnostic, /^postgresql:\/\/\[redacted\]@…\/skincos\?token=\[redacted\]$/)
    assert.doesNotMatch(diagnostic, /user|password|value/)
})

test('accepts only the dedicated bearer token for the Meta Ads offer context', () => {
    assert.equal(__testables.verifyMetaAdsOfferContextToken({ headers: { authorization: 'Bearer offer-context-secret' } }, 'offer-context-secret'), true)
    assert.equal(__testables.verifyMetaAdsOfferContextToken({ headers: { authorization: 'Bearer wrong' } }, 'offer-context-secret'), false)
    assert.equal(__testables.verifyMetaAdsOfferContextToken({ headers: { authorization: 'Basic offer-context-secret' } }, 'offer-context-secret'), false)
    assert.equal(__testables.verifyMetaAdsOfferContextToken({ headers: { authorization: 'Bearer offer-context-secret' } }, ''), false)
})

test('accepts the generic CRM commercial catalog bearer contract and preserves the Meta alias', () => {
    const request = { headers: { authorization: 'Bearer catalog-secret' } }
    assert.equal(__testables.verifyCommercialCatalogToken(request, 'catalog-secret'), true)
    assert.equal(__testables.verifyCommercialCatalogToken(request, 'wrong'), false)
    assert.equal(__testables.verifyMetaAdsOfferContextToken(request, 'catalog-secret'), true)
})

test('registers the read-only generic commercial catalog route', async () => {
    const calls = []
    const routes = captureAtendimentoRoutes({
        async commercialCatalog(query) {
            calls.push(query)
            return { schemaVersion: 'crm-commercial-catalog/v1', requestedUnits: ['barra-shopping-sul'], units: {} }
        },
    })
    const response = captureResponse()
    await routes.get('GET /internal/commercial/catalog')({
        commercialCatalog: true,
        query: { unit: 'barra-shopping-sul' },
    }, response)
    assert.equal(response.state.status, 200)
    assert.equal(response.state.body.ok, true)
    assert.deepEqual(calls, [{ unit: 'barra-shopping-sul' }])
})

test('authenticates the generic route in middleware and marks it as a service read', async () => {
    const routes = captureAtendimentoRoutes({ commercialCatalog: async () => ({}) }, { commercialCatalogToken: 'catalog-secret' })
    assert.equal(typeof routes.middleware, 'function')

    let nextCalled = false
    const validRequest = {
        path: '/internal/commercial/catalog',
        method: 'GET',
        headers: { authorization: 'Bearer catalog-secret' },
    }
    await routes.middleware(validRequest, captureResponse(), () => { nextCalled = true })
    assert.equal(nextCalled, true)
    assert.deepEqual(validRequest.atendimentoActor, { id: 'crm-commercial-catalog', role: 'SERVICE' })
    assert.equal(validRequest.commercialCatalog, true)

    const invalidResponse = captureResponse()
    await routes.middleware({
        path: '/internal/commercial/catalog',
        method: 'GET',
        headers: { authorization: 'Bearer wrong' },
    }, invalidResponse, () => {})
    assert.equal(invalidResponse.state.status, 401)
    assert.deepEqual(invalidResponse.state.body, { ok: false, error: 'UNAUTHORIZED' })
})

test('keeps Clientes routes exclusive to GESTOR, matching the CRM module policy', () => {
    assert.equal(__testables.isCommercialManager({ role: 'GESTOR' }), true)
    assert.equal(__testables.isCommercialManager({ role: 'GERENTE' }), false)
    assert.equal(__testables.isCommercialManager({ role: 'ADMIN' }), true)
    assert.equal(__testables.isCommercialManager({ role: 'INJETOR' }), false)
})

test('exposes the production read-only runtime flag only when explicitly enabled', () => {
    const before = process.env.CRM_ATENDIMENTO_READ_ONLY
    try {
        delete process.env.CRM_ATENDIMENTO_READ_ONLY
        assert.equal(__testables.atendimentoReadOnlyRuntime(), false)
        process.env.CRM_ATENDIMENTO_READ_ONLY = 'true'
        assert.equal(__testables.atendimentoReadOnlyRuntime(), true)
        process.env.CRM_ATENDIMENTO_READ_ONLY = 'TRUE'
        assert.equal(__testables.atendimentoReadOnlyRuntime(), true)
        process.env.CRM_ATENDIMENTO_READ_ONLY = '1'
        assert.equal(__testables.atendimentoReadOnlyRuntime(), false)
    } finally {
        if (before === undefined) delete process.env.CRM_ATENDIMENTO_READ_ONLY
        else process.env.CRM_ATENDIMENTO_READ_ONLY = before
    }
})

test('limits the isolated production surface to commercial Clientes routes when enabled', () => {
    const before = process.env.CRM_ATENDIMENTO_CLIENTES_ONLY
    try {
        delete process.env.CRM_ATENDIMENTO_CLIENTES_ONLY
        assert.equal(__testables.atendimentoClientesOnlyRuntime(), false)
        process.env.CRM_ATENDIMENTO_CLIENTES_ONLY = 'true'
        assert.equal(__testables.atendimentoClientesOnlyRuntime(), true)
        assert.equal(__testables.isClientesCommercialPath('/commercial/overview'), true)
        assert.equal(__testables.isClientesCommercialPath('/commercial/review'), true)
        assert.equal(__testables.isClientesCommercialPath('/attendances'), false)
        assert.equal(__testables.isClientesCommercialPath('/offers'), false)
    } finally {
        if (before === undefined) delete process.env.CRM_ATENDIMENTO_CLIENTES_ONLY
        else process.env.CRM_ATENDIMENTO_CLIENTES_ONLY = before
    }
})

test('blocks a commercial clinical-approval request before the cadence store write', async () => {
    let calls = 0
    const routes = captureAtendimentoRoutes({
        async upsertCommercialCadence() {
            calls += 1
            return { id: 'cadence-1' }
        },
    })
    const actor = { id: 'gestor-1', role: 'GESTOR', allowedModules: ['atendimento'] }

    const approval = captureResponse()
    await routes.get('PUT /commercial/cadences')({ atendimentoActor: actor, body: { procedureId: 'procedure-1', cadenceDays: 90, status: 'approved' } }, approval)
    assert.equal(approval.state.status, 403)
    assert.deepEqual(approval.state.body, { ok: false, error: 'CLINICAL_CADENCE_APPROVAL_REQUIRED' })
    assert.equal(calls, 0)

    const draft = captureResponse()
    await routes.get('PUT /commercial/cadences')({ atendimentoActor: actor, body: { procedureId: 'procedure-1', cadenceDays: 90, status: 'draft' } }, draft)
    assert.equal(draft.state.status, 200)
    assert.deepEqual(draft.state.body, { ok: true, id: 'cadence-1' })
    assert.equal(calls, 1)
})

test('forwards source-state review decisions and undo only for a GESTOR', async () => {
    const calls = []
    const semanticVersion = '35c54b6916b6b8191a17f8500ab103d8'
    const store = {
        async decideIdentityReview(payload, actor) {
            calls.push({ operation: 'decision', payload, actor })
            return { decision: { id: 'decision-1', state: 'confirmed', sourceVersion: semanticVersion } }
        },
        async undoIdentityReviewDecision(payload, actor) {
            calls.push({ operation: 'undo', payload, actor })
            return { decision: { id: 'decision-2', state: 'reversed', sourceVersion: '8af5f0ef4bd5fce3a63d653f7aef947e', reversesDecisionId: 'decision-1' } }
        },
    }
    const routes = captureAtendimentoRoutes(store)
    const actor = { id: 'gestor-1', role: 'GESTOR', allowedModules: ['atendimento'] }
    const decision = captureResponse()
    const decisionPayload = {
        sourceId: 'app-registration-42',
        targetId: '4bcf7ee4-0b5a-4277-a7d8-a93bfcb80b51',
        expectedVersion: semanticVersion,
        decision: 'confirmed',
        reason: 'Cadastro e histórico clínico confirmam a mesma pessoa.',
    }

    await routes.get('POST /commercial/review/:type/decision')({
        atendimentoActor: actor,
        params: { type: 'app_caixa' },
        body: decisionPayload,
    }, decision)

    assert.equal(decision.state.status, 200)
    assert.deepEqual(decision.state.body, {
        ok: true,
        decision: { id: 'decision-1', state: 'confirmed', sourceVersion: semanticVersion },
    })
    assert.deepEqual(calls[0], {
        operation: 'decision',
        payload: { ...decisionPayload, reviewType: 'app_caixa' },
        actor,
    })

    const undo = captureResponse()
    const undoPayload = {
        sourceId: decisionPayload.sourceId,
        targetId: decisionPayload.targetId,
        expectedVersion: semanticVersion,
        reason: 'Evidência de origem precisa ser reavaliada antes de manter a confirmação.',
    }
    await routes.get('POST /commercial/review/:type/undo')({
        atendimentoActor: actor,
        params: { type: 'app_caixa' },
        body: undoPayload,
    }, undo)

    assert.equal(undo.state.status, 200)
    assert.deepEqual(undo.state.body, {
        ok: true,
        decision: {
            id: 'decision-2', state: 'reversed', sourceVersion: '8af5f0ef4bd5fce3a63d653f7aef947e', reversesDecisionId: 'decision-1',
        },
    })
    assert.deepEqual(calls[1], {
        operation: 'undo',
        payload: { ...undoPayload, reviewType: 'app_caixa' },
        actor,
    })
})

test('blocks non-GESTOR identity review decisions before the store mutation boundary', async () => {
    const store = {
        async decideIdentityReview() { throw new Error('STORE_SHOULD_NOT_BE_CALLED') },
        async undoIdentityReviewDecision() { throw new Error('STORE_SHOULD_NOT_BE_CALLED') },
    }
    const routes = captureAtendimentoRoutes(store)
    const request = {
        atendimentoActor: { id: 'gerente-1', role: 'GERENTE', allowedModules: ['atendimento'] },
        params: { type: 'app_caixa' },
        body: {
            sourceId: 'app-registration-42',
            targetId: '4bcf7ee4-0b5a-4277-a7d8-a93bfcb80b51',
            expectedVersion: '35c54b6916b6b8191a17f8500ab103d8',
            reason: 'Tentativa bloqueada.',
        },
    }

    const decision = captureResponse()
    await routes.get('POST /commercial/review/:type/decision')(request, decision)
    assert.equal(decision.state.status, 403)
    assert.deepEqual(decision.state.body, { ok: false, error: 'FORBIDDEN' })

    const undo = captureResponse()
    await routes.get('POST /commercial/review/:type/undo')(request, undo)
    assert.equal(undo.state.status, 403)
    assert.deepEqual(undo.state.body, { ok: false, error: 'FORBIDDEN' })
})

test('maps review payload and source-state conflicts to their client-safe status codes', async () => {
    const routes = captureAtendimentoRoutes({
        async decideIdentityReview(payload) {
            if (!payload.expectedVersion) throw clientError('IDENTITY_REVIEW_VERSION_REQUIRED', 400)
            throw new Error('STORE_SHOULD_NOT_BE_CALLED')
        },
        async undoIdentityReviewDecision() {
            throw clientError('IDENTITY_REVIEW_CONFLICT', 409)
        },
    })
    const actor = { id: 'gestor-1', role: 'GESTOR', allowedModules: ['atendimento'] }
    const decision = captureResponse()
    await routes.get('POST /commercial/review/:type/decision')({
        atendimentoActor: actor,
        params: { type: 'app_caixa' },
        body: {
            sourceId: 'app-registration-42',
            targetId: '4bcf7ee4-0b5a-4277-a7d8-a93bfcb80b51',
            decision: 'confirmed',
            reason: 'Sem token de versão semântica.',
        },
    }, decision)
    assert.equal(decision.state.status, 400)
    assert.deepEqual(decision.state.body, { ok: false, error: 'IDENTITY_REVIEW_VERSION_REQUIRED', hint: undefined })

    const undo = captureResponse()
    await routes.get('POST /commercial/review/:type/undo')({
        atendimentoActor: actor,
        params: { type: 'app_caixa' },
        body: {
            sourceId: 'app-registration-42',
            targetId: '4bcf7ee4-0b5a-4277-a7d8-a93bfcb80b51',
            expectedVersion: '35c54b6916b6b8191a17f8500ab103d8',
            reason: 'A fonte mudou depois da decisão.',
        },
    }, undo)
    assert.equal(undo.state.status, 409)
    assert.deepEqual(undo.state.body, { ok: false, error: 'IDENTITY_REVIEW_CONFLICT', hint: undefined })
})

test('keeps cluster workspace, reveal and deterministic bulk routes inside the GESTOR boundary', async () => {
    const calls = []
    const store = {
        async identityClusterWorkspace(query, actor) {
            calls.push({ operation: 'workspace', query, actor })
            return { clusters: [], total: 0 }
        },
        async identityClusterDetail(clusterKey, query, actor) {
            calls.push({ operation: 'detail', clusterKey, query, actor })
            return { cluster: { clusterKey } }
        },
        async previewIdentityClusterBulk(payload, actor) {
            calls.push({ operation: 'preview', payload, actor })
            return { eligibleCount: 0 }
        },
        async applyIdentityClusterBulk(payload, actor) {
            calls.push({ operation: 'apply', payload, actor })
            return { appliedClusters: 1 }
        },
        async revealIdentityCluster(payload, actor) {
            calls.push({ operation: 'reveal', payload, actor })
            return { contacts: [] }
        },
    }
    const routes = captureAtendimentoRoutes(store)
    const actor = { id: 'gestor-1', role: 'GESTOR', allowedModules: ['atendimento'] }
    const workspace = captureResponse()
    await routes.get('GET /commercial/identity-clusters')({ atendimentoActor: actor, query: { stale: 'true' } }, workspace)
    assert.equal(workspace.state.status, 200)
    assert.deepEqual(calls[0], { operation: 'workspace', query: { stale: 'true' }, actor })

    const apply = captureResponse()
    await routes.get('POST /commercial/identity-clusters/bulk/apply')({
        atendimentoActor: actor,
        headers: { 'idempotency-key': 'cluster-apply-001' },
        body: { clusterKeys: ['a'.repeat(32)] },
    }, apply)
    assert.equal(apply.state.status, 200)
    assert.equal(calls[1].payload.idempotencyKey, 'cluster-apply-001')

    const blocked = captureResponse()
    await routes.get('POST /commercial/identity-clusters/bulk/apply')({
        atendimentoActor: { id: 'gerente-1', role: 'GERENTE', allowedModules: ['atendimento'] },
        headers: { 'idempotency-key': 'blocked' },
        body: {},
    }, blocked)
    assert.equal(blocked.state.status, 403)
    assert.deepEqual(blocked.state.body, { ok: false, error: 'FORBIDDEN' })
    assert.equal(calls.length, 2)
})

test('routes Commercial Operations through its injected store with a single opaque idempotency key', async () => {
    const calls = []
    const operations = {
        async readiness(actor) { calls.push(['readiness', actor.id]); return { ready: true, safety: { messagesEnabled: false } } },
        async wallet(query, actor) { calls.push(['wallet', query, actor.id]); return { actions: [], safety: { messagesEnabled: false } } },
        async createCampaign(payload, actor) { calls.push(['campaign', payload, actor.id]); return { campaign: { campaignId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' }, safety: { messagesEnabled: false } } },
    }
    const routes = captureAtendimentoRoutes({}, { commercialOperationsStore: operations })
    const actor = { id: 'gestor-1', role: 'GESTOR', allowedModules: ['atendimento'], allowedUnits: ['novo-hamburgo'], allowedUnitsDeclared: true }

    const readiness = captureResponse()
    await routes.get('GET /commercial/operations/readiness')({ atendimentoActor: actor }, readiness)
    assert.equal(readiness.state.status, 200)
    assert.equal(readiness.state.body.safety.messagesEnabled, false)

    const wallet = captureResponse()
    await routes.get('GET /commercial/operations/wallet')({ atendimentoActor: actor, query: { unit: 'novo-hamburgo' } }, wallet)
    assert.equal(wallet.state.status, 200)
    assert.deepEqual(calls[1], ['wallet', { unit: 'novo-hamburgo' }, 'gestor-1'])

    const campaign = captureResponse()
    await routes.get('POST /commercial/operations/campaigns')({
        atendimentoActor: actor,
        headers: { 'idempotency-key': 'campaign:opaque-key-1' },
        body: { idempotencyKey: 'campaign:opaque-key-1', reason: 'Coorte sintética aprovada.' },
    }, campaign)
    assert.equal(campaign.state.status, 200)
    assert.equal(calls[2][1].idempotencyKey, 'campaign:opaque-key-1')
    assert.equal(campaign.state.body.safety.messagesEnabled, false)

    const beforeForbidden = calls.length
    const forbidden = captureResponse()
    await routes.get('POST /commercial/operations/campaigns')({
        atendimentoActor: { ...actor, role: 'GERENTE' }, headers: {}, body: { idempotencyKey: 'campaign:opaque-key-2' },
    }, forbidden)
    assert.equal(forbidden.state.status, 403)
    assert.equal(calls.length, beforeForbidden)

    const mismatch = captureResponse()
    await routes.get('POST /commercial/operations/campaigns')({
        atendimentoActor: actor,
        headers: { 'idempotency-key': 'campaign:opaque-key-3' },
        body: { idempotencyKey: 'campaign:opaque-key-4' },
    }, mismatch)
    assert.equal(mismatch.state.status, 400)
    assert.equal(calls.length, beforeForbidden)
})

test('routes Commercial Analytics through its injected, non-contacting store and preserves RBAC/idempotency', async () => {
    const calls = []
    const analytics = {
        async readiness(actor) { calls.push(['readiness', actor.id]); return { ready: true, safety: { messagesEnabled: false, commercialContactWritesEnabled: false } } },
        async quality(query, actor) { calls.push(['quality', query, actor.id]); return { coverage: [], safety: { messagesEnabled: false } } },
        async funnel(query, actor) { calls.push(['funnel', query, actor.id]); return { observed: {}, safety: { messagesEnabled: false } } },
        async segments(query, actor) { calls.push(['segments', query, actor.id]); return { segments: [], safety: { messagesEnabled: false } } },
        async attributionWindows(query, actor) { calls.push(['windows', query, actor.id]); return { windows: [], safety: { messagesEnabled: false } } },
        async experiments(query, actor) { calls.push(['experiments', query, actor.id]); return { experiments: [], safety: { messagesEnabled: false } } },
        async experimentMetrics(id, actor) { calls.push(['metrics', id, actor.id]); return { safety: { messagesEnabled: false } } },
        async createSegment(payload, actor) { calls.push(['createSegment', payload, actor.id]); return { definitionId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', safety: { messagesEnabled: false, commercialContactWritesEnabled: false } } },
        async createSegmentVersion() { throw new Error('not used') },
        async snapshotSegment() { throw new Error('not used') },
        async upsertAttributionWindow() { throw new Error('not used') },
        async createExperiment() { throw new Error('not used') },
        async updateExperimentState() { throw new Error('not used') },
    }
    const routes = captureAtendimentoRoutes({}, { commercialAnalyticsStore: analytics })
    const actor = { id: 'gestor-analytics', role: 'GESTOR', allowedModules: ['atendimento'], allowedUnits: ['centro'], allowedUnitsDeclared: true }

    const readiness = captureResponse()
    await routes.get('GET /commercial/analytics/readiness')({ atendimentoActor: actor }, readiness)
    assert.equal(readiness.state.status, 200)
    assert.equal(readiness.state.body.safety.commercialContactWritesEnabled, false)

    const quality = captureResponse()
    await routes.get('GET /commercial/analytics/quality')({ atendimentoActor: actor, query: { unit: 'centro' } }, quality)
    assert.equal(quality.state.status, 200)
    assert.deepEqual(calls[1], ['quality', { unit: 'centro' }, 'gestor-analytics'])

    const create = captureResponse()
    await routes.get('POST /commercial/analytics/segments')({
        atendimentoActor: actor,
        headers: { 'idempotency-key': 'analytics:segment:001' },
        body: { idempotencyKey: 'analytics:segment:001', reason: 'Coorte analítica sintética' },
    }, create)
    assert.equal(create.state.status, 200)
    assert.equal(calls[2][0], 'createSegment')
    assert.equal(calls[2][1].idempotencyKey, 'analytics:segment:001')

    const beforeForbidden = calls.length
    const forbidden = captureResponse()
    await routes.get('GET /commercial/analytics/funnel')({ atendimentoActor: { ...actor, role: 'GERENTE' }, query: {} }, forbidden)
    assert.equal(forbidden.state.status, 403)
    assert.equal(calls.length, beforeForbidden)

    const mismatch = captureResponse()
    await routes.get('POST /commercial/analytics/segments')({
        atendimentoActor: actor, headers: { 'idempotency-key': 'analytics:segment:002' },
        body: { idempotencyKey: 'analytics:segment:003', reason: 'Coorte analítica sintética' },
    }, mismatch)
    assert.equal(mismatch.state.status, 400)
    assert.equal(calls.length, beforeForbidden)
    assert.equal([...routes.keys()].some((key) => /commercial\/analytics\/(?:send|message|dispatch|consent)/i.test(key)), false)
})


test('adapts only opaque signed subjects for the assisted ledger', () => {
  assert.equal(__testables.commercialAssistedActor({ id: 'gestor-assisted', role: 'GESTOR' }).actorSubject, 'gestor-assisted')
  assert.throws(() => __testables.commercialAssistedActor({ role: 'GESTOR', email: 'email-only' }), /ACTOR_IDENTITY_REQUIRED/)
})

test('routes assisted WhatsApp through its injected domain without publishing transport, raw reveal, or webhook ingress', async () => {
  const calls = []
  const safety = { providerSend: false, automationEnabled: false, bulkDispatchEnabled: false, commercialContactWritesEnabled: false, externalDispatch: false }
  const assisted = {
    async readiness(actor) { calls.push(['readiness', actor.actorSubject]); return { ready: true, safety } },
    async availableOffers(query, actor) { calls.push(['offers', query, actor.actorSubject]); return { offers: [], safety } },
    async listTemplates(query, actor) { calls.push(['templates', query, actor.actorSubject]); return { templates: [], safety } },
    async createTemplate(payload, actor) { calls.push(['createTemplate', payload, actor.actorSubject]); return { template: { templateId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' }, safety } },
    async preview(payload, actor) { calls.push(['preview', payload, actor.actorSubject]); return { eligible: false, providerSend: false, externalDispatch: false, safety } },
    async confirm(payload, actor) { calls.push(['confirm', payload, actor.actorSubject]); return { dispatchResult: 'not_dispatched', providerSend: false, externalDispatch: false, safety } },
    async issueHandoff(payload, actor) { calls.push(['handoff', payload, actor.actorSubject]); return { destinationMasked: '***-****', providerSend: false, externalDispatch: false, safety } },
    async emergencyControls(query, actor) { calls.push(['controls', query, actor.actorSubject]); return { controls: [], safety } },
    async setEmergencyControl(payload, actor) { calls.push(['setControl', payload, actor.actorSubject]); return { emergencyOff: true, providerSend: false, externalDispatch: false, safety } },
  }
  const routes = captureAtendimentoRoutes({}, { commercialAssistedCommunicationStore: assisted })
  const actor = { id: 'gestor-assisted', role: 'GESTOR', allowedModules: ['atendimento'], allowedUnits: ['centro'], allowedUnitsDeclared: true }
  const routeKey = (...parts) => parts.join('-')
  const templateKey = routeKey('assisted', 'template', '001')
  const confirmKey = routeKey('assisted', 'confirm', '001')
  const handoffKey = routeKey('assisted', 'handoff', '001')
  const stopKey = routeKey('assisted', 'stop', '001')
  const mismatchHeader = routeKey('assisted', 'confirm', '002')
  const mismatchBody = routeKey('assisted', 'confirm', '003')

  const readiness = captureResponse()
  await routes.get('GET /commercial/assisted-whatsapp/readiness')({ atendimentoActor: actor }, readiness)
  assert.equal(readiness.state.status, 200)
  assert.equal(readiness.state.body.safety.providerSend, false)

  const offers = captureResponse()
  await routes.get('GET /commercial/assisted-whatsapp/offers')({ atendimentoActor: actor, query: { actionId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' } }, offers)
  assert.equal(offers.state.status, 200)
  assert.deepEqual(calls[1], ['offers', { actionId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' }, 'gestor-assisted'])

  const template = captureResponse()
  await routes.get('POST /commercial/assisted-whatsapp/templates')({ atendimentoActor: actor, headers: { 'idempotency-key': templateKey }, body: { idempotencyKey: templateKey, unit: 'centro' } }, template)
  assert.equal(template.state.status, 200)
  assert.equal(calls[2][0], 'createTemplate')
  assert.equal(calls[2][1].idempotencyKey, templateKey)

  const preview = captureResponse()
  await routes.get('POST /commercial/assisted-whatsapp/preview')({ atendimentoActor: actor, headers: {}, body: { actionId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' } }, preview)
  assert.equal(preview.state.status, 200)
  assert.equal(calls[3][0], 'preview')

  const confirm = captureResponse()
  await routes.get('POST /commercial/assisted-whatsapp/confirm')({ atendimentoActor: actor, headers: { 'idempotency-key': confirmKey }, body: { idempotencyKey: confirmKey } }, confirm)
  assert.equal(confirm.state.status, 200)
  assert.equal(confirm.state.body.dispatchResult, 'not_dispatched')

  const handoff = captureResponse()
  await routes.get('POST /commercial/assisted-whatsapp/handoffs')({ atendimentoActor: actor, headers: { 'idempotency-key': handoffKey }, body: { idempotencyKey: handoffKey } }, handoff)
  assert.equal(handoff.state.status, 200)
  assert.equal(handoff.state.body.destinationMasked, '***-****')

  const controls = captureResponse()
  await routes.get('GET /commercial/assisted-whatsapp/emergency-controls')({ atendimentoActor: actor, query: { unit: 'centro' } }, controls)
  assert.equal(controls.state.status, 200)
  assert.deepEqual(calls[6], ['controls', { unit: 'centro' }, 'gestor-assisted'])

  const setControl = captureResponse()
  await routes.get('PUT /commercial/assisted-whatsapp/emergency-controls')({ atendimentoActor: actor, headers: { 'idempotency-key': stopKey }, body: { idempotencyKey: stopKey, unit: 'centro', emergencyOff: true, expectedRevision: 1, reason: 'Teste sint?tico.' } }, setControl)
  assert.equal(setControl.state.status, 200)
  assert.equal(calls[7][0], 'setControl')

  const beforeForbidden = calls.length
  const forbidden = captureResponse()
  await routes.get('GET /commercial/assisted-whatsapp/readiness')({ atendimentoActor: { ...actor, role: 'GERENTE' } }, forbidden)
  assert.equal(forbidden.state.status, 403)
  assert.equal(calls.length, beforeForbidden)

  const mismatch = captureResponse()
  await routes.get('POST /commercial/assisted-whatsapp/confirm')({ atendimentoActor: actor, headers: { 'idempotency-key': mismatchHeader }, body: { idempotencyKey: mismatchBody } }, mismatch)
  assert.equal(mismatch.state.status, 400)
  assert.equal(calls.length, beforeForbidden)

  assert.equal([...routes.keys()].some((key) => /assisted-whatsapp\/(?:send|message|dispatch|webhook|reveal)/i.test(key)), false)
})

test('maps an unavailable assisted migration to a read-only safe 503', async () => {
  const routes = captureAtendimentoRoutes({}, { commercialAssistedCommunicationStore: { async readiness() { return { ready: false, reason: 'MIGRATION_PENDING' } } } })
  const response = captureResponse()
  await routes.get('GET /commercial/assisted-whatsapp/readiness')({ atendimentoActor: { id: 'gestor-readiness', role: 'GESTOR' } }, response)
  assert.equal(response.state.status, 503)
  assert.deepEqual(response.state.body, { ok: false, ready: false, reason: 'MIGRATION_PENDING' })
})
