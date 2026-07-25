import { createHmac, timingSafeEqual } from 'crypto'
import express from 'express'
import { createAtendimentoStore, canAccessAtendimento } from './store.js'
import { importAtendimentoFromGoogleSheet, importGerenciaFromGoogleSheet, readGerenciaChartIds } from './importer.js'

const json = (res, status, body, headers = {}) => {
    res.status(status)
    res.set('cache-control', 'no-store')
    Object.entries(headers).forEach(([key, value]) => res.set(key, value))
    return res.json(body)
}

function b64UrlDecode(input) {
    const raw = String(input || '').replace(/-/g, '+').replace(/_/g, '/')
    const pad = raw.length % 4 ? '='.repeat(4 - (raw.length % 4)) : ''
    return Buffer.from(raw + pad, 'base64').toString('utf8')
}

function b64UrlEncode(buffer) {
    return Buffer.from(buffer).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '')
}

function safeEqual(left, right) {
    try {
        const a = Buffer.from(String(left || ''))
        const b = Buffer.from(String(right || ''))
        if (a.length !== b.length) return false
        return timingSafeEqual(a, b)
    } catch {
        return false
    }
}

function verifyMetaAdsOfferContextToken(req, expectedToken) {
    const authorization = String(req?.headers?.authorization || '')
    const token = authorization.startsWith('Bearer ') ? authorization.slice(7).trim() : ''
    return !!expectedToken && safeEqual(token, expectedToken)
}

function normalizeRole(value) {
    const raw = String(value || '').trim().toUpperCase()
    if (raw === 'ADMIN') return 'GESTOR'
    if (raw === 'OPERADOR') return 'INJETOR'
    return raw
}

function parseActorHeader(req) {
    const encoded = String(req.headers['x-crm-user'] || '').trim()
    if (!encoded) return null
    try {
        const actor = JSON.parse(b64UrlDecode(encoded))
        if (!actor || typeof actor !== 'object') return null
        return {
            id: String(actor.id || actor.username || actor.email || '').trim(),
            username: actor.username ? String(actor.username) : undefined,
            email: actor.email ? String(actor.email) : undefined,
            name: actor.name ? String(actor.name) : undefined,
            role: normalizeRole(actor.role),
            allowedUnits: Array.isArray(actor.allowedUnits) ? actor.allowedUnits.map(String).filter(Boolean) : undefined,
            allowedModules: Array.isArray(actor.allowedModules) ? actor.allowedModules.map(String).filter(Boolean) : undefined,
        }
    } catch {
        return null
    }
}

async function verifySignedActor(req, actorKey) {
    const actor = parseActorHeader(req)
    if (!actor) return null
    // An unsigned actor is only valid for the explicit, loopback-only local
    // development runtime.  Accepting this header elsewhere would let any
    // caller choose their own role, module and allowed-unit scope.
    if (!actorKey) {
        const localBypass = String(process.env.CRM_LOCAL_NO_AUTH || process.env.NO_AUTH || '').trim().toLowerCase() === 'true'
        return localBypass && isLocalRequest(req) ? actor : null
    }
    const ts = String(req.headers['x-crm-ts'] || '').trim()
    const sig = String(req.headers['x-crm-signature'] || '').trim()
    const encoded = String(req.headers['x-crm-user'] || '').trim()
    const tsNum = Number(ts)
    if (!ts || !sig || !Number.isFinite(tsNum)) return null
    if (Math.abs(Date.now() - tsNum) > 5 * 60 * 1000) return null
    const expected = b64UrlEncode(createHmac('sha256', actorKey).update(`${ts}.${encoded}`).digest())
    if (!safeEqual(sig, expected)) return null
    return actor
}

function devSessionActor(req, getDevSession) {
    if (!getDevSession) return null
    const session = getDevSession(req)
    const user = session?.user || null
    if (!user) return null
    return {
        id: String(user.username || user.email || '').trim(),
        username: user.username ? String(user.username) : undefined,
        email: user.email ? String(user.email) : undefined,
        name: user.displayName ? String(user.displayName) : undefined,
        role: normalizeRole(user.role),
        allowedUnits: Array.isArray(user.allowedUnits) ? user.allowedUnits.map(String).filter(Boolean) : undefined,
        allowedModules: Array.isArray(user.allowedModules) ? user.allowedModules.map(String).filter(Boolean) : undefined,
    }
}

function isAdmin(actor) {
    const role = normalizeRole(actor?.role)
    return role === 'GESTOR' || role === 'GERENTE'
}

function isCommercialManager(actor) {
    return normalizeRole(actor?.role) === 'GESTOR'
}

function isLocalRequest(req) {
    // Host is caller-controlled. Only the peer address may authorize the
    // unsigned local-development actor or the local mirror diagnostics.
    const remote = String(req.socket?.remoteAddress || req.connection?.remoteAddress || '').trim().toLowerCase()
    return remote === '127.0.0.1' || remote === '::1' || remote === '::ffff:127.0.0.1'
}

function errorPayload(error) {
    const message = String(error?.message || error || 'ERROR')
    const status = Number(error?.statusCode || error?.status || 500)
    const clientError = Number.isInteger(status) && status >= 400 && status < 500
    return {
        status,
        body: {
        ok: false,
        error: clientError ? message : 'INTERNAL_ERROR',
        hint: clientError && message === 'DATABASE_URL_not_configured'
            ? 'Configure DATABASE_URL no crm-api antes de usar o módulo de Acompanhamento de Atendimento.'
            : undefined,
        },
    }
}

function errorResponse(res, error) {
    const response = errorPayload(error)
    return json(res, response.status, response.body)
}

export function createAtendimentoRouter(options = {}) {
    const store = options.store || createAtendimentoStore({ databaseUrl: options.databaseUrl })
    const actorKey = String(
        options.actorHmacKey ||
        process.env.ATENDIMENTO_ACTOR_HMAC_KEY ||
        process.env.ESCALA_ACTOR_HMAC_KEY ||
        process.env.CRM_ESCALA_HMAC_KEY ||
        '',
    ).trim()
    const metaAdsOfferContextToken = String(
        options.metaAdsOfferContextToken || process.env.META_ADS_OFFER_CONTEXT_TOKEN || '',
    ).trim()
    const getDevSession = options.getDevSession || null
    const expressRouter = options.routerFactory ? options.routerFactory() : express.Router()

    expressRouter.use(async (req, res, next) => {
        try {
            if (req.path === '/internal/meta-ads/offer-context') {
                if (!metaAdsOfferContextToken) {
                    return json(res, 503, { ok: false, error: 'META_ADS_OFFER_CONTEXT_TOKEN_NOT_CONFIGURED' })
                }
                if (!verifyMetaAdsOfferContextToken(req, metaAdsOfferContextToken)) return json(res, 401, { ok: false, error: 'UNAUTHORIZED' })
                req.atendimentoActor = { id: 'meta-ads-publish', role: 'SERVICE' }
                req.metaAdsOfferContext = true
                return next()
            }
            if (!actorKey && String(process.env.NODE_ENV || '').toLowerCase() === 'production') {
                return json(res, 503, { ok: false, error: 'ACTOR_KEY_NOT_CONFIGURED' })
            }
            let actor = await verifySignedActor(req, actorKey)
            if (!actor) actor = devSessionActor(req, getDevSession)
            if (!actor) return json(res, 401, { ok: false, error: 'UNAUTHORIZED' })
            if (!canAccessAtendimento(actor, req.path, req.method)) return json(res, 403, { ok: false, error: 'FORBIDDEN' })
            req.atendimentoActor = actor
            next()
        } catch (error) {
            return errorResponse(res, error)
        }
    })

    expressRouter.get('/health', async (_req, res) => {
        try {
            const health = await store.health()
            return json(res, 200, { ok: true, ...health })
        } catch (error) {
            return errorResponse(res, error)
        }
    })

    expressRouter.get('/local-mirror/status', async (req, res) => {
        if (!isLocalRequest(req)) return json(res, 404, { ok: false, error: 'NOT_FOUND' })
        try {
            return json(res, 200, { ok: true, ...(await store.localMirrorStatus()) })
        } catch (error) {
            return errorResponse(res, error)
        }
    })

    expressRouter.get('/doctor-conversion/config', async (_req, res) => {
        try {
            return json(res, 200, { ok: true, ...(await store.doctorConversionConfig()) })
        } catch (error) {
            return errorResponse(res, error)
        }
    })

    expressRouter.put('/doctor-conversion/config', async (req, res) => {
        try {
            if (!isAdmin(req.atendimentoActor)) return json(res, 403, { ok: false, error: 'FORBIDDEN' })
            return json(res, 200, { ok: true, ...(await store.updateDoctorConversionConfig(req.body || {}, req.atendimentoActor)) })
        } catch (error) {
            return errorResponse(res, error)
        }
    })

    expressRouter.get('/doctor-conversion/result', async (req, res) => {
        try {
            return json(res, 200, { ok: true, ...(await store.doctorConversionResult(req.query || {}, req.atendimentoActor)) })
        } catch (error) {
            return errorResponse(res, error)
        }
    })

    expressRouter.get('/doctor-conversion/history', async (req, res) => {
        try {
            return json(res, 200, { ok: true, ...(await store.doctorConversionHistory(req.query || {}, req.atendimentoActor)) })
        } catch (error) {
            return errorResponse(res, error)
        }
    })

    expressRouter.post('/doctor-conversion/optimize', async (req, res) => {
        try {
            return json(res, 200, { ok: true, ...(await store.optimizeDoctorConversion(req.body || {}, req.atendimentoActor)) })
        } catch (error) {
            return errorResponse(res, error)
        }
    })

    expressRouter.post('/doctor-conversion/recompute', async (req, res) => {
        try {
            if (!isAdmin(req.atendimentoActor)) return json(res, 403, { ok: false, error: 'FORBIDDEN' })
            return json(res, 200, { ok: true, ...(await store.recomputeDoctorConversions(req.body || {}, req.atendimentoActor)) })
        } catch (error) {
            return errorResponse(res, error)
        }
    })

    expressRouter.get('/references', async (req, res) => {
        try {
            return json(res, 200, { ok: true, ...(await store.references(req.atendimentoActor)) })
        } catch (error) {
            return errorResponse(res, error)
        }
    })

    expressRouter.get('/commercial/overview', async (req, res) => {
        try {
            if (!isCommercialManager(req.atendimentoActor)) return json(res, 403, { ok: false, error: 'FORBIDDEN' })
            return json(res, 200, { ok: true, ...(await store.commercialOverview(req.query || {}, req.atendimentoActor)) })
        } catch (error) {
            return errorResponse(res, error)
        }
    })

    expressRouter.get('/commercial/review', async (req, res) => {
        try {
            if (!isCommercialManager(req.atendimentoActor)) return json(res, 403, { ok: false, error: 'FORBIDDEN' })
            return json(res, 200, { ok: true, ...(await store.identityReviewQueue(req.query || {}, req.atendimentoActor)) })
        } catch (error) {
            return errorResponse(res, error)
        }
    })

    expressRouter.get('/commercial/profiles/:identityId', async (req, res) => {
        try {
            if (!isCommercialManager(req.atendimentoActor)) return json(res, 403, { ok: false, error: 'FORBIDDEN' })
            return json(res, 200, { ok: true, ...(await store.commercialProfile(String(req.params.identityId || ''), req.query || {}, req.atendimentoActor)) })
        } catch (error) {
            return errorResponse(res, error)
        }
    })

    expressRouter.get('/commercial/policy', async (req, res) => {
        try {
            if (!isCommercialManager(req.atendimentoActor)) return json(res, 403, { ok: false, error: 'FORBIDDEN' })
            return json(res, 200, { ok: true, ...(await store.commercialPolicy(req.atendimentoActor)) })
        } catch (error) {
            return errorResponse(res, error)
        }
    })

    expressRouter.put('/commercial/policy', async (req, res) => {
        try {
            if (!isCommercialManager(req.atendimentoActor)) return json(res, 403, { ok: false, error: 'FORBIDDEN' })
            return json(res, 200, { ok: true, ...(await store.updateCommercialPolicy(req.body || {}, req.atendimentoActor)) })
        } catch (error) {
            return errorResponse(res, error)
        }
    })

    expressRouter.get('/commercial/cadences', async (req, res) => {
        try {
            if (!isCommercialManager(req.atendimentoActor)) return json(res, 403, { ok: false, error: 'FORBIDDEN' })
            return json(res, 200, { ok: true, ...(await store.commercialCadences(req.atendimentoActor)) })
        } catch (error) {
            return errorResponse(res, error)
        }
    })

    expressRouter.put('/commercial/cadences', async (req, res) => {
        try {
            if (!isCommercialManager(req.atendimentoActor)) return json(res, 403, { ok: false, error: 'FORBIDDEN' })
            return json(res, 200, { ok: true, ...(await store.upsertCommercialCadence(req.body || {}, req.atendimentoActor)) })
        } catch (error) {
            return errorResponse(res, error)
        }
    })

    expressRouter.post('/commercial/actions', async (req, res) => {
        try {
            if (!isCommercialManager(req.atendimentoActor)) return json(res, 403, { ok: false, error: 'FORBIDDEN' })
            return json(res, 200, { ok: true, ...(await store.createCommercialAction(req.body || {}, req.atendimentoActor)) })
        } catch (error) {
            return errorResponse(res, error)
        }
    })

    expressRouter.patch('/commercial/actions/:id', async (req, res) => {
        try {
            if (!isCommercialManager(req.atendimentoActor)) return json(res, 403, { ok: false, error: 'FORBIDDEN' })
            return json(res, 200, { ok: true, ...(await store.updateCommercialAction(String(req.params.id || ''), req.body || {}, req.atendimentoActor)) })
        } catch (error) {
            return errorResponse(res, error)
        }
    })

    expressRouter.get('/clients', async (req, res) => {
        try {
            return json(res, 200, { ok: true, ...(await store.clients(req.query || {}, req.atendimentoActor)) })
        } catch (error) {
            return errorResponse(res, error)
        }
    })

    expressRouter.get('/overview', async (req, res) => {
        try {
            return json(res, 200, { ok: true, ...(await store.overview(req.query || {}, req.atendimentoActor)) })
        } catch (error) {
            return errorResponse(res, error)
        }
    })

    expressRouter.get('/attendances', async (req, res) => {
        try {
            return json(res, 200, { ok: true, ...(await store.listAttendances(req.query || {}, req.atendimentoActor)) })
        } catch (error) {
            return errorResponse(res, error)
        }
    })

    expressRouter.get('/doctor-suggestion', async (req, res) => {
        try {
            return json(res, 200, { ok: true, ...(await store.doctorSuggestion(req.query || {}, req.atendimentoActor)) })
        } catch (error) {
            return errorResponse(res, error)
        }
    })

    expressRouter.get('/reports/preview', async (req, res) => {
        try {
            return json(res, 200, { ok: true, ...(await store.reportPreview(req.query || {}, req.atendimentoActor)) })
        } catch (error) {
            return errorResponse(res, error)
        }
    })

    expressRouter.get('/management/catalog', async (req, res) => {
        try {
            return json(res, 200, { ok: true, ...(await store.managementCatalog(req.atendimentoActor)) })
        } catch (error) {
            return errorResponse(res, error)
        }
    })

    expressRouter.get('/offers', async (req, res) => {
        try {
            return json(res, 200, { ok: true, ...(await store.commercialOffers(req.query || {}, req.atendimentoActor)) })
        } catch (error) {
            return errorResponse(res, error)
        }
    })

    expressRouter.put('/offers', async (req, res) => {
        try {
            if (!isAdmin(req.atendimentoActor)) return json(res, 403, { ok: false, error: 'FORBIDDEN' })
            return json(res, 200, { ok: true, ...(await store.upsertCommercialOffer(req.body || {}, req.atendimentoActor)) })
        } catch (error) {
            return errorResponse(res, error)
        }
    })

    expressRouter.get('/internal/meta-ads/offer-context', async (req, res) => {
        try {
            if (!req.metaAdsOfferContext) return json(res, 401, { ok: false, error: 'UNAUTHORIZED' })
            return json(res, 200, { ok: true, ...(await store.metaAdsOfferContext(req.query || {})) })
        } catch (error) {
            return errorResponse(res, error)
        }
    })

    expressRouter.get('/management/commercial', async (req, res) => {
        try {
            return json(res, 200, { ok: true, ...(await store.managementCommercial(req.query || {}, req.atendimentoActor)) })
        } catch (error) {
            return errorResponse(res, error)
        }
    })

    expressRouter.get('/management/conversion-report', async (req, res) => {
        try {
            return json(res, 200, { ok: true, ...(await store.managementConversionReport(req.query || {}, req.atendimentoActor)) })
        } catch (error) {
            return errorResponse(res, error)
        }
    })

    expressRouter.post('/management/color-scores', async (req, res) => {
        try {
            return json(res, 200, { ok: true, ...(await store.managementColorScores(req.body || {}, req.atendimentoActor)) })
        } catch (error) {
            return errorResponse(res, error)
        }
    })

    expressRouter.get('/management/charts', async (req, res) => {
        try {
            if (!isAdmin(req.atendimentoActor)) return json(res, 403, { ok: false, error: 'FORBIDDEN' })
            const result = await readGerenciaChartIds({
                spreadsheetId: req.query?.spreadsheetId,
                tab: req.query?.tab,
            })
            return json(res, 200, { ok: true, ...result })
        } catch (error) {
            return errorResponse(res, error)
        }
    })

    expressRouter.get('/management/finance', async (req, res) => {
        try {
            return json(res, 200, { ok: true, ...(await store.managementFinance(req.atendimentoActor)) })
        } catch (error) {
            return errorResponse(res, error)
        }
    })

    expressRouter.get('/management/finance/monthly-goals', async (req, res) => {
        try {
            return json(res, 200, { ok: true, ...(await store.managementMonthlyGoals(req.query || {}, req.atendimentoActor)) })
        } catch (error) {
            return errorResponse(res, error)
        }
    })

    expressRouter.get('/management/finance/goal-tables', async (req, res) => {
        try {
            return json(res, 200, { ok: true, ...(await store.managementGoalTables(req.query || {}, req.atendimentoActor)) })
        } catch (error) {
            return errorResponse(res, error)
        }
    })

    expressRouter.post('/management/finance/monthly-goals', async (req, res) => {
        try {
            if (!isAdmin(req.atendimentoActor)) return json(res, 403, { ok: false, error: 'FORBIDDEN' })
            return json(res, 200, { ok: true, ...(await store.upsertMonthlyGoal(req.body || {}, req.atendimentoActor)) })
        } catch (error) {
            return errorResponse(res, error)
        }
    })

    expressRouter.get('/management/inventory', async (req, res) => {
        try {
            return json(res, 200, { ok: true, ...(await store.managementInventory(req.atendimentoActor)) })
        } catch (error) {
            return errorResponse(res, error)
        }
    })

    expressRouter.get('/management/people', async (req, res) => {
        try {
            return json(res, 200, { ok: true, ...(await store.managementPeople(req.atendimentoActor)) })
        } catch (error) {
            return errorResponse(res, error)
        }
    })

    expressRouter.get('/management/feeds/insumos', async (req, res) => {
        try {
            return json(res, 200, { ok: true, ...(await store.managementInsumosFeed(req.atendimentoActor)) })
        } catch (error) {
            return errorResponse(res, error)
        }
    })

    expressRouter.get('/management/feeds/escala', async (req, res) => {
        try {
            return json(res, 200, { ok: true, ...(await store.managementEscalaFeed(req.atendimentoActor)) })
        } catch (error) {
            return errorResponse(res, error)
        }
    })

    expressRouter.get('/management/raw-tabs', async (req, res) => {
        try {
            return json(res, 200, { ok: true, ...(await store.managementRawTabs(req.query || {}, req.atendimentoActor)) })
        } catch (error) {
            return errorResponse(res, error)
        }
    })

    expressRouter.post('/attendances', async (req, res) => {
        try {
            const data = await store.createAttendance({
                ...(req.body || {}),
                idempotencyKey: String(req.headers['idempotency-key'] || '').trim() || undefined,
            }, req.atendimentoActor)
            return json(res, 200, { ok: true, data })
        } catch (error) {
            return errorResponse(res, error)
        }
    })

    expressRouter.patch('/attendances/:id', async (req, res) => {
        try {
            const data = await store.updateAttendance(String(req.params.id || ''), req.body || {}, req.atendimentoActor)
            return json(res, 200, { ok: true, data })
        } catch (error) {
            return errorResponse(res, error)
        }
    })

    expressRouter.delete('/attendances/:id', async (req, res) => {
        try {
            const data = await store.deleteAttendance(String(req.params.id || ''), req.body || {}, req.atendimentoActor)
            return json(res, 200, { ok: true, ...data })
        } catch (error) {
            return errorResponse(res, error)
        }
    })

    expressRouter.post('/admin/import/google-sheet', async (req, res) => {
        try {
            if (!isAdmin(req.atendimentoActor)) return json(res, 403, { ok: false, error: 'FORBIDDEN' })
            const dryRun = req.body?.dryRun !== false
            const result = await importAtendimentoFromGoogleSheet(store, {
                actor: req.atendimentoActor,
                dryRun,
                config: {
                    spreadsheetId: req.body?.spreadsheetId,
                },
            })
            return json(res, 200, { ok: true, ...result })
        } catch (error) {
            return errorResponse(res, error)
        }
    })

    expressRouter.post('/admin/import/google-sheet/gerencia', async (req, res) => {
        try {
            if (!isAdmin(req.atendimentoActor)) return json(res, 403, { ok: false, error: 'FORBIDDEN' })
            const dryRun = req.body?.dryRun !== false
            const result = await importGerenciaFromGoogleSheet(store, {
                actor: req.atendimentoActor,
                dryRun,
                config: {
                    spreadsheetId: req.body?.spreadsheetId,
                },
            })
            return json(res, 200, { ok: true, ...result })
        } catch (error) {
            return errorResponse(res, error)
        }
    })

    return expressRouter
}

export const __testables = {
    errorPayload,
    isLocalRequest,
    safeEqual,
    verifyMetaAdsOfferContextToken,
    verifySignedActor,
}
