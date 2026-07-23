import express from 'express'
import { createHarmoniaRouter } from '../server/harmonia/routes.js'
import { createAtendimentoRouter } from '../server/atendimento/routes.js'
import { createCaixaRouter } from '../server/caixa/routes.js'
import { readModuleAvailability } from './module-availability.js'

const domain = String(process.env.CRM_DOMAIN || '').trim().toLowerCase()
const port = Number(process.env.CRM_DOMAIN_PORT || 8100)
const app = express(); app.use(express.json({ limit: '2mb' }))
const routes = {
    harmonia: () => createHarmoniaRouter({ varDir: process.env.CRM_VAR_DIR }),
    atendimento: () => createAtendimentoRouter(),
    caixa: () => createCaixaRouter(),
}
if (!routes[domain]) throw new Error('CRM_DOMAIN must be harmonia, atendimento or caixa')
app.get('/health', async (_req, res) => res.json({ ok: true, domain, availability: await readModuleAvailability(domain) }))
app.get('/readiness', async (_req, res) => {
    const availability = await readModuleAvailability(domain)
    res.status(availability.state === 'active' ? 200 : 503).json({ ok: availability.state === 'active', unit: `crm-${domain}`, version: String(process.env.APP_VERSION || process.env.GITHUB_SHA || 'unknown'), environment: String(process.env.NODE_ENV || 'unknown'), readiness: availability.state, dependencies: { postgres: { state: process.env.DATABASE_URL ? 'configured' : 'not-configured', required: true } }, availability })
})
app.use(async (_req, res, next) => {
    const availability = await readModuleAvailability(domain)
    if (availability.state === 'active') return next()
    return res.status(availability.state === 'disabled' ? 423 : 503).json({ ok: false, error: availability.state === 'disabled' ? 'MODULE_DISABLED' : 'MODULE_MAINTENANCE', module: domain, availability })
})
app.use('/', routes[domain]())
app.listen(port, '127.0.0.1', () => console.log(JSON.stringify({ level: 'info', module: `crm-${domain}`, event: 'listening', port })))
