import express from 'express'
import { createClinicalApprovalStore } from './clinicalApprovalStore.js'

const json = (res, status, body) => {
    res.status(status)
    res.set('cache-control', 'no-store')
    return res.json(body)
}

function readOnlyRuntime() {
    return String(process.env.CRM_ATENDIMENTO_READ_ONLY || '').trim().toLowerCase() === 'true'
}

function domainEnabled() {
    return String(process.env.CLINICAL_APPROVAL_ENABLED || '').trim().toLowerCase() === 'true'
}

function errorStatus(error) {
    const status = Number(error?.statusCode || error?.status || 500)
    return Number.isInteger(status) && status >= 400 && status < 600 ? status : 500
}

function errorResponse(res, error) {
    const status = errorStatus(error)
    return json(res, status, { ok: false, error: status >= 500 ? 'INTERNAL_ERROR' : String(error?.message || 'ERROR') })
}

function idempotency(req) {
    return String(req.headers?.['idempotency-key'] || req.body?.idempotencyKey || '').trim()
}

export function createClinicalApprovalRouter(options = {}) {
    const router = options.routerFactory ? options.routerFactory() : express.Router()
    const store = options.store || createClinicalApprovalStore({ pool: options.pool, databaseUrl: options.databaseUrl })
    const getActor = options.getActor || (async (req) => req.clinicalActor || null)

    router.get('/health', async (_req, res) => {
        try { return json(res, 200, { ...(await store.health()), enabled: domainEnabled() }) } catch { return json(res, 200, { ok: true, ready: false, enabled: domainEnabled(), domain: 'clinical-approval', writesEnabled: false, pii: false }) }
    })
    async function actorFor(req) {
        const actor = await getActor(req)
        if (!actor) throw Object.assign(new Error('UNAUTHORIZED'), { statusCode: 401 })
        req.clinicalActor = actor
        return actor
    }

    async function protectedRoute(req, res, operation) {
        try {
            const actor = await actorFor(req)
            return await operation(actor)
        } catch (error) { return errorResponse(res, error) }
    }

    // Readiness is an operational dependency signal, not a public liveness
    // endpoint. Keep it behind the same signed/session actor boundary as the
    // approval workspace while retaining a public, PII-free health endpoint.
    router.get('/readiness', (req, res) => protectedRoute(req, res, async () => {
        try {
            const readiness = await store.readiness()
            return json(res, readiness.ready ? 200 : 503, readiness)
        } catch { return json(res, 503, { ok: false, ready: false, domain: 'clinical-approval' }) }
    }))

    router.get('/approvals', (req, res) => protectedRoute(req, res, (actor) => store.listRules(req.query || {}, actor).then((data) => json(res, 200, { ok: true, ...data }))))
    router.get('/approvals/:id', (req, res) => protectedRoute(req, res, (actor) => store.getRule(String(req.params.id || ''), actor).then((data) => json(res, 200, { ok: true, ...data }))))

    const mutate = (handler) => (req, res) => protectedRoute(req, res, async (actor) => {
        if (readOnlyRuntime()) return json(res, 405, { ok: false, error: 'CLINICAL_APPROVAL_READ_ONLY' })
        if (!domainEnabled()) return json(res, 503, { ok: false, error: 'CLINICAL_APPROVAL_DISABLED' })
        return json(res, 200, { ok: true, ...(await handler(req, actor, idempotency(req))) })
    })

    router.post('/approvals/drafts', mutate((req, actor, key) => store.createDraft(req.body || {}, actor, key)))
    router.post('/approvals/:id/submit', mutate((req, actor, key) => store.submit(String(req.params.id || ''), req.body || {}, actor, key)))
    router.post('/approvals/:id/approve', mutate((req, actor, key) => store.approve(String(req.params.id || ''), req.body || {}, actor, key)))
    router.post('/approvals/:id/reject', mutate((req, actor, key) => store.reject(String(req.params.id || ''), req.body || {}, actor, key)))
    router.post('/approvals/:id/disable', mutate((req, actor, key) => store.disable(String(req.params.id || ''), req.body || {}, actor, key)))
    router.post('/approvals/expire', mutate((req, actor, key) => store.expireDue(actor, key)))

    return router
}

export const clinicalApprovalRouteContract = Object.freeze({
    basePath: '/api/clinical',
    public: ['/health'],
    readiness: ['/readiness'],
    readinessAuth: 'signed-actor-or-session',
    protected: ['/approvals', '/approvals/:id'],
    mutations: ['POST /approvals/drafts', 'POST /approvals/:id/submit', 'POST /approvals/:id/approve', 'POST /approvals/:id/reject', 'POST /approvals/:id/disable', 'POST /approvals/expire'],
    messaging: false,
    recommendationAutomation: false,
})
