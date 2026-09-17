import http from 'node:http'
import { timingSafeEqual } from 'node:crypto'
import express from 'express'
import pg from 'pg'
import { createCatalogStore, legacyMetaAdsOfferContext } from './src/catalog.mjs'

const LOOPBACK = '127.0.0.1'

function safeEqual(left, right) {
  const a = Buffer.from(String(left || ''))
  const b = Buffer.from(String(right || ''))
  return a.length > 0 && a.length === b.length && timingSafeEqual(a, b)
}

function bearer(req) {
  const value = String(req.headers.authorization || '')
  return value.startsWith('Bearer ') ? value.slice(7).trim() : ''
}

function errorResponse(res, error) {
  const status = Number(error?.statusCode || error?.status || 500)
  return res.status(status >= 400 && status < 500 ? status : 503).json({
    ok: false,
    error: status >= 400 && status < 500 ? String(error.message || 'REQUEST_INVALID') : 'DEPENDENCY_UNAVAILABLE',
  })
}

export function createCommercialCatalogApp({ store, token = '', logger = console } = {}) {
  if (!store || typeof store.commercialCatalog !== 'function') throw new TypeError('CATALOG_STORE_REQUIRED')
  const app = express()
  app.disable('x-powered-by')
  app.get('/health', (_req, res) => res.status(200).json({ ok: true, service: 'atendimento-commercial-catalog', readOnly: true }))
  app.get('/readiness', async (_req, res) => {
    try {
      const readiness = await store.readiness()
      return res.status(readiness.ok ? 200 : 503).json({ ok: readiness.ok, service: 'atendimento-commercial-catalog', readOnly: true })
    } catch (error) {
      logger?.warn?.(`commercial-catalog readiness failed: ${String(error?.message || error)}`)
      return res.status(503).json({ ok: false, error: 'DEPENDENCY_UNAVAILABLE' })
    }
  })
  const authorized = (req, res) => {
    if (!safeEqual(bearer(req), token)) {
      res.status(token ? 401 : 503).json({ ok: false, error: token ? 'UNAUTHORIZED' : 'CATALOG_TOKEN_NOT_CONFIGURED' })
      return false
    }
    return true
  }
  app.get('/api/atendimento/internal/commercial/catalog', async (req, res) => {
    if (!authorized(req, res)) return
    try { return res.status(200).json({ ok: true, ...(await store.commercialCatalog(req.query || {})) }) }
    catch (error) { return errorResponse(res, error) }
  })
  // Kept only while the inactive Meta Ads workflow is migrated to the generic
  // contract. It reads the same source and never writes or redirects cookies.
  app.get('/api/atendimento/internal/meta-ads/offer-context', async (req, res) => {
    if (!authorized(req, res)) return
    try {
      const catalog = await store.commercialCatalog(req.query || {})
      return res.status(200).json({ ok: true, ...legacyMetaAdsOfferContext(catalog) })
    } catch (error) { return errorResponse(res, error) }
  })
  return app
}

export function startCommercialCatalogServer({ environment = process.env } = {}) {
  const databaseUrl = String(environment.DATABASE_URL || '').trim()
  const token = String(environment.ATENDIMENTO_COMMERCIAL_CATALOG_TOKEN || environment.CRM_COMMERCIAL_CATALOG_TOKEN || '').trim()
  const pool = databaseUrl ? new pg.Pool({
    connectionString: databaseUrl,
    ssl: String(environment.NODE_ENV || '').toLowerCase() === 'production' ? { rejectUnauthorized: false } : undefined,
    max: 4,
  }) : null
  const store = pool ? createCatalogStore({ pool }) : null
  const app = store ? createCommercialCatalogApp({ store, token }) : express().get('/health', (_req, res) => res.status(200).json({ ok: true, service: 'atendimento-commercial-catalog', readOnly: true }))
  const port = Number(environment.ATENDIMENTO_COMMERCIAL_CATALOG_PORT || 8112)
  const host = String(environment.ATENDIMENTO_COMMERCIAL_CATALOG_HOST || LOOPBACK)
  const server = http.createServer(app)
  server.listen(port, host)
  return { server, pool, port, host }
}

if (process.argv[1] && process.argv[1].endsWith('server.mjs')) startCommercialCatalogServer()
