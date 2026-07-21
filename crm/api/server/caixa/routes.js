import { createHmac, timingSafeEqual } from 'node:crypto'
import express from 'express'
import { createCaixaStore } from './store.js'
import { readCaixaGoogleSheet } from './importer.js'

const json = (res, status, body) => res.status(status).set('cache-control', 'no-store').json(body)
const b64Decode = (value) => Buffer.from(`${String(value || '').replace(/-/g, '+').replace(/_/g, '/')}${'='.repeat((4 - String(value || '').length % 4) % 4)}`, 'base64').toString('utf8')
const b64Encode = (value) => Buffer.from(value).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '')
const isAdmin = (actor) => ['GESTOR', 'GERENTE'].includes(String(actor?.role || '').toUpperCase())

function actorFromHeader(req) {
    try { const actor = JSON.parse(b64Decode(req.headers['x-crm-user'])); return actor && typeof actor === 'object' ? actor : null } catch { return null }
}
function isLoopback(req) { return ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(String(req.socket?.remoteAddress || '').toLowerCase()) }
function safeEqual(left, right) { const a = Buffer.from(String(left || '')); const b = Buffer.from(String(right || '')); return a.length === b.length && timingSafeEqual(a, b) }
function verifyActor(req, actorKey, getDevSession) {
    const actor = actorFromHeader(req)
    if (actorKey && actor) {
        const ts = String(req.headers['x-crm-ts'] || ''); const encoded = String(req.headers['x-crm-user'] || '')
        const validTime = Number.isFinite(Number(ts)) && Math.abs(Date.now() - Number(ts)) <= 5 * 60_000
        const expected = b64Encode(createHmac('sha256', actorKey).update(`${ts}.${encoded}`).digest())
        if (validTime && safeEqual(req.headers['x-crm-signature'], expected)) return actor
    }
    const user = getDevSession?.(req)?.user
    if (user) return { id: user.username || user.email, username: user.username, email: user.email, name: user.displayName, role: user.role, allowedModules: user.allowedModules }
    if (!actorKey && String(process.env.CRM_LOCAL_NO_AUTH || process.env.NO_AUTH || '').toLowerCase() === 'true' && isLoopback(req)) return actor
    return null
}
function allowed(actor) { const modules = Array.isArray(actor?.allowedModules) ? actor.allowedModules.map(String) : []; return isAdmin(actor) || !modules.length || modules.includes('caixa') }

export function createCaixaRouter(options = {}) {
    const store = options.store || createCaixaStore({ databaseUrl: options.databaseUrl })
    const actorKey = String(options.actorHmacKey || process.env.CAIXA_ACTOR_HMAC_KEY || process.env.ATENDIMENTO_ACTOR_HMAC_KEY || process.env.ESCALA_ACTOR_HMAC_KEY || process.env.CRM_ESCALA_HMAC_KEY || '').trim()
    const router = express.Router()
    router.use((req, res, next) => {
        const actor = verifyActor(req, actorKey, options.getDevSession)
        if (!actor) return json(res, 401, { ok: false, error: 'UNAUTHORIZED' })
        if (!allowed(actor)) return json(res, 403, { ok: false, error: 'FORBIDDEN' })
        req.caixaActor = actor; next()
    })
    router.get('/health', async (_req, res) => { try { return json(res, 200, { ok: true, ...(await store.health()) }) } catch (error) { return json(res, error.statusCode || 500, { ok: false, error: error.statusCode ? error.message : 'INTERNAL_ERROR' }) } })
    router.get('/overview', async (req, res) => { try { return json(res, 200, { ok: true, ...(await store.overview(req.query || {})) }) } catch (error) { return json(res, error.statusCode || 500, { ok: false, error: error.statusCode ? error.message : 'INTERNAL_ERROR' }) } })
    router.post('/import/google-sheet', async (req, res) => {
        if (!isAdmin(req.caixaActor)) return json(res, 403, { ok: false, error: 'FORBIDDEN' })
        try {
            const dryRun = req.body?.dryRun !== false
            const sheet = await (options.readSheet || readCaixaGoogleSheet)({ spreadsheetId: req.body?.spreadsheetId })
            return json(res, 200, { ok: true, ...(await store.importRecords({ records: sheet.records, actor: req.caixaActor, dryRun, sourceSheetId: sheet.spreadsheetId })), spreadsheetId: sheet.spreadsheetId, tabs: sheet.tabs })
        } catch (error) { return json(res, error.statusCode || 500, { ok: false, error: error.statusCode ? error.message : 'INTERNAL_ERROR' }) }
    })
    return router
}
