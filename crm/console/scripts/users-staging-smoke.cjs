/*
 * One-shot staging-only smoke for the unified Users journey.
 * Credentials are read from a runner-private fixture and never printed.
 */
const fs = require('node:fs')
const { chromium } = require('playwright')

const baseUrl = String(process.env.USERS_STAGING_CRM_URL || '').replace(/\/$/, '')
if (!/^https:\/\/[a-z0-9-]+\.skincos-staging\.pages\.dev$/.test(baseUrl)) {
  throw new Error('USERS_STAGING_CRM_URL must be an immutable skincos-staging.pages.dev origin')
}
const fixturePath = String(process.env.USERS_STAGING_FIXTURE_FILE || '')
if (!fixturePath) throw new Error('USERS_STAGING_FIXTURE_FILE is required')
const fixture = JSON.parse(fs.readFileSync(fixturePath, 'utf8'))
if (fixture?.environment !== 'staging' || fixture?.role !== 'CONSULTOR' || !fixture?.adminEmail || !fixture?.adminPassword) {
  throw new Error('staging fixture is invalid')
}

const assert = (condition, message) => { if (!condition) throw new Error(message) }

async function main() {
  const browser = await chromium.launch({ headless: true, args: ['--disable-dev-shm-usage', '--disable-gpu'] })
  const context = await browser.newContext({ viewport: { width: 1365, height: 860 } })
  const page = await context.newPage()
  const api = async (pathname, init = {}) => page.evaluate(async ({ pathname, init }) => {
    const response = await fetch(pathname, { credentials: 'include', ...init })
    const text = await response.text()
    let json = null
    try { json = text ? JSON.parse(text) : null } catch {}
    return { status: response.status, json }
  }, { pathname, init })

  try {
    await page.goto(`${baseUrl}/`, { waitUntil: 'domcontentloaded', timeout: 60_000 })
    const login = await api('/api/auth/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify({ email: fixture.adminEmail, password: fixture.adminPassword }),
    })
    assert(login.status === 200 && login.json?.success !== false, `staging login failed (${login.status})`)

    const authMe = await api('/api/auth/me')
    assert(authMe.status === 200 && authMe.json?.user, `/api/auth/me failed (${authMe.status})`)
    assert(String(authMe.json.user.role || '').toUpperCase() === 'GESTOR', 'synthetic actor is not GESTOR')
    assert(JSON.stringify(authMe.json.user.allowedUnits || []) === JSON.stringify(['novo-hamburgo']), 'unit scope drifted')

    const config = await api('/api/crm/admin/team?mode=config')
    assert(config.status === 200 && config.json?.success === true && config.json?.data?.enabled === true, `/api/crm/admin/team?mode=config failed (${config.status})`)
    const roster = await api('/api/crm/admin/team?status=ALL&page=1&limit=50')
    assert(roster.status === 200 && roster.json?.success === true && Array.isArray(roster.json?.data), `/api/crm/admin/team list failed (${roster.status})`)
    assert(roster.json.data.some((row) => row.username === fixture.adminUsername), 'synthetic admin missing from roster')

    await page.goto(`${baseUrl}/?module=users`, { waitUntil: 'domcontentloaded', timeout: 60_000 })
    await page.getByRole('heading', { name: 'Usuários' }).waitFor({ state: 'visible', timeout: 20_000 })
    await page.getByRole('heading', { name: 'Equipe' }).waitFor({ state: 'visible', timeout: 20_000 })
    const visibleText = (await page.locator('body').innerText()).toLowerCase()
    assert(!visibleText.includes('route_not_found'), 'Users UI rendered route_not_found')
    assert(visibleText.includes('novo hamburgo'), 'Users UI did not render Novo Hamburgo')
    assert(visibleText.includes('synthetic ponto'), 'Users UI did not render the synthetic staging roster')

    console.log(JSON.stringify({
      ok: true,
      environment: 'staging',
      origin: baseUrl,
      authMe: authMe.status,
      teamConfig: config.status,
      teamList: roster.status,
      membersObserved: roster.json.data.length,
      routeNotFound: false,
      unitObserved: 'novo-hamburgo',
      credentialsIncluded: false,
    }))
  } finally {
    await context.close()
    await browser.close()
  }
}

main().catch((error) => {
  console.error(`[users-staging-smoke] FAILED: ${String(error?.stack || error)}`)
  process.exitCode = 1
})
