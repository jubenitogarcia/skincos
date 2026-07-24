/*
 * Controlled staging-only RBAC journey for Insumos.
 *
 * Credentials are generated per run and read from a runner-private file. This
 * script never accepts production origins, never writes inventory records, and
 * emits only a sanitised scenario report.
 */
const fs = require('fs')
const path = require('path')
const { chromium } = require('playwright')

const base = new URL(String(process.env.INSUMOS_STAGING_CRM_URL || ''))
if (base.protocol !== 'https:' || !base.hostname.endsWith('.skincos-staging.pages.dev')) {
  throw new Error('INSUMOS_STAGING_CRM_URL must be an immutable skincos-staging.pages.dev HTTPS origin.')
}
const fixturePath = String(process.env.INSUMOS_STAGING_FIXTURES_FILE || '')
const reportPath = String(process.env.INSUMOS_STAGING_REPORT_FILE || '')
if (!fixturePath || !reportPath) throw new Error('private fixture and sanitised report paths are required')
const fixture = JSON.parse(fs.readFileSync(fixturePath, 'utf8'))
if (fixture?.environment !== 'staging' || !Array.isArray(fixture?.scenarios)) throw new Error('staging fixture is invalid')

const canonical = ['novo-hamburgo', 'barra-shopping-sul']
const byId = (id) => fixture.scenarios.find((scenario) => scenario.id === id)
const requireScenario = (id) => {
  const scenario = byId(id)
  if (!scenario) throw new Error(`missing ${id} fixture`)
  return scenario
}
const scenarios = [
  { fixture: requireScenario('nh'), staleUnit: 'barra-shopping-sul', expectedUnit: 'novo-hamburgo', requestUnits: ['novo-hamburgo'] },
  { fixture: requireScenario('bss'), staleUnit: 'novo-hamburgo', expectedUnit: 'barra-shopping-sul', requestUnits: ['barra-shopping-sul'] },
  { fixture: requireScenario('both'), staleUnit: 'unidade-proibida', expectedUnit: 'novo-hamburgo', requestUnits: canonical, switchTo: 'barra-shopping-sul' },
  { fixture: requireScenario('empty'), staleUnit: 'novo-hamburgo', expectedUnit: '', requestUnits: [], noUnit: true },
  { fixture: requireScenario('admin'), staleUnit: 'unidade-proibida', expectedUnit: 'novo-hamburgo', requestUnits: canonical, admin: true },
  { fixture: requireScenario('alias'), staleUnit: 'barra-shopping-sul', expectedUnit: 'novo-hamburgo', requestUnits: ['novo-hamburgo'], alias: true },
]

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
const assert = (condition, message) => { if (!condition) throw new Error(message) }
// All callers pass only literal relative API paths defined in this file; the
// browser remains pinned to the validated immutable staging origin above.
// nosemgrep: playwright-evaluate-arg-injection -- fixed relative route set on validated staging origin
const api = async (page, pathname, init = {}) => page.evaluate(async ({ pathname, init }) => {
  const response = await fetch(pathname, { credentials: 'include', ...init })
  const text = await response.text()
  let json = null
  try { json = text ? JSON.parse(text) : null } catch {}
  return { status: response.status, ok: response.ok, json }
}, { pathname, init })

async function runScenario(browser, config) {
  const requests = { authMe: 0, insumosMe: 0, health: 0, data: 0 }
  const context = await browser.newContext({ viewport: { width: 1365, height: 860 } })
  await context.addInitScript((staleUnit) => {
    // addInitScript runs for every document, including reloads used to verify a
    // deliberate unit change. Seed the stale state only once per scenario.
    if (!localStorage.getItem('skincos.insumos.unidade.v1')) {
      localStorage.setItem('skincos.insumos.unidade.v1', staleUnit)
    }
    if (!localStorage.getItem('app.activeModule')) localStorage.setItem('app.activeModule', 'insumos')
  }, config.staleUnit)
  const page = await context.newPage()
  page.on('request', (request) => {
    const pathname = new URL(request.url()).pathname
    if (pathname === '/api/auth/me') requests.authMe += 1
    if (pathname === '/api/insumos/auth/me') requests.insumosMe += 1
    if (pathname === '/api/insumos/health') requests.health += 1
    if (pathname.startsWith('/api/insumos/') && !['/api/insumos/auth/me', '/api/insumos/health', '/api/insumos/_proxy-status'].includes(pathname)) requests.data += 1
  })
  try {
    // nosemgrep: playwright-goto-injection -- base is restricted to skincos-staging.pages.dev above
    await page.goto(base.toString(), { waitUntil: 'domcontentloaded', timeout: 60_000 })
    const login = await api(page, '/api/auth/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify({ email: config.fixture.email, password: config.fixture.password }),
    })
    assert(login.status === 200 && login.json?.success !== false, `${config.fixture.id}: login failed (${login.status})`)
    const me = await api(page, '/api/auth/me')
    assert(me.status === 200 && me.json?.user, `${config.fixture.id}: /auth/me failed (${me.status})`)
    assert(String(me.json.user.role || '').toUpperCase() === config.fixture.role, `${config.fixture.id}: role mismatch`)
    const insumosMe = await api(page, '/api/insumos/auth/me')
    assert(insumosMe.status === 200 && insumosMe.json?.user, `${config.fixture.id}: /insumos/auth/me failed (${insumosMe.status})`)
    const scopes = insumosMe.json.user.allowedUnits || []
    assert(JSON.stringify(scopes) === JSON.stringify(config.fixture.expectedUnits), `${config.fixture.id}: unexpected unit scopes`)
    if (config.alias) assert(JSON.stringify(scopes) === JSON.stringify(['novo-hamburgo']), 'alias did not normalize exclusively to Novo Hamburgo')

    // nosemgrep: playwright-goto-injection -- constant query on validated staging origin
    await page.goto(`${base.toString()}?insumos=1`, { waitUntil: 'domcontentloaded', timeout: 60_000 })
    const insumosButton = page.getByRole('button', { name: 'Insumos', exact: true }).first()
    await insumosButton.click({ timeout: 20_000 })
    if (config.noUnit) {
      await page.getByText(/ainda não possui uma unidade autorizada/i).waitFor({ state: 'visible', timeout: 20_000 })
      await sleep(1200)
      assert(requests.data === 0, 'empty scope issued Insumos data requests')
      const stored = await page.evaluate(() => localStorage.getItem('skincos.insumos.unidade.v1'))
      assert(stored === null, 'empty scope retained a unit in localStorage')
      return { id: config.fixture.id, result: 'denied-no-unit', scopes, requests }
    }

    await page.waitForFunction((expectedUnit) => localStorage.getItem('skincos.insumos.unidade.v1') === expectedUnit, config.expectedUnit, { timeout: 20_000 })
    for (const unit of config.requestUnits) {
      const baseQuery = `?unidade=${encodeURIComponent(unit)}`
      for (const route of [
        `/api/insumos/insumos${baseQuery}&pagina=1&limite=10`,
        `/api/insumos/movimentacoes${baseQuery}&pagina=1&limite=10`,
        `/api/insumos/analytics/overview${baseQuery}&lite=1`,
        `/api/insumos/analytics/insights${baseQuery}`,
      ]) {
        const response = await api(page, route)
        assert(response.status === 200, `${config.fixture.id}: ${route} returned ${response.status}`)
      }
    }

    if (config.fixture.id === 'nh') {
      const denied = await api(page, '/api/insumos/insumos?unidade=barra-shopping-sul&pagina=1&limite=1')
      assert(denied.status === 403 && denied.json?.code === 'RBAC_UNIT_DENIED', `unauthorized unit must return RBAC_UNIT_DENIED, got ${denied.status}/${denied.json?.code || ''}`)
    }
    if (config.switchTo) {
      // nosemgrep: playwright-evaluate-arg-injection -- switchTo is a canonical literal from scenarios above
      await page.evaluate((unit) => localStorage.setItem('skincos.insumos.unidade.v1', unit), config.switchTo)
      await page.reload({ waitUntil: 'domcontentloaded', timeout: 60_000 })
      await page.getByRole('button', { name: 'Insumos', exact: true }).first().click({ timeout: 20_000 })
      await page.waitForFunction((unit) => localStorage.getItem('skincos.insumos.unidade.v1') === unit, config.switchTo, { timeout: 20_000 })
    }
    await sleep(1500)
    assert(requests.authMe <= 4 && requests.insumosMe <= 4 && requests.health <= 4, `${config.fixture.id}: request storm detected`)
    return { id: config.fixture.id, result: 'authorized', scopes, requests, switched: Boolean(config.switchTo) }
  } finally {
    await context.close()
  }
}

async function main() {
  const browser = await chromium.launch({ headless: true, args: ['--disable-dev-shm-usage', '--disable-gpu'] })
  try {
    const healthContext = await browser.newContext()
    const healthPage = await healthContext.newPage()
    // nosemgrep: playwright-goto-injection -- base is restricted to skincos-staging.pages.dev above
    await healthPage.goto(base.toString(), { waitUntil: 'domcontentloaded', timeout: 60_000 })
    const pagesHealth = await api(healthPage, '/api/health')
    assert(pagesHealth.status === 200 && pagesHealth.json?.service === 'crm-pages', 'CRM Pages health failed')
    const inventoryHealth = await api(healthPage, '/api/insumos/health')
    assert(inventoryHealth.status === 200 && inventoryHealth.json?.service === 'insumos' && inventoryHealth.json?.ready === true, 'Inventory staging health/readiness failed')
    await healthContext.close()
    const results = []
    for (const scenario of scenarios) results.push(await runScenario(browser, scenario))
    const report = {
      schemaVersion: 1,
      environment: 'staging',
      origin: base.origin,
      at: new Date().toISOString(),
      pagesHealth: pagesHealth.status,
      inventoryHealth: inventoryHealth.status,
      scenarios: results,
      credentialsIncluded: false,
    }
    fs.mkdirSync(path.dirname(reportPath), { recursive: true })
    fs.writeFileSync(reportPath, JSON.stringify(report, null, 2))
    console.log(JSON.stringify({ environment: report.environment, origin: report.origin, scenarioResults: results.map(({ id, result }) => ({ id, result })), credentialsIncluded: false }))
  } finally {
    await browser.close()
  }
}

main().catch((error) => {
  console.error(`[insumos-staging-rbac-smoke] FAILED: ${String(error?.stack || error)}`)
  process.exitCode = 1
})
