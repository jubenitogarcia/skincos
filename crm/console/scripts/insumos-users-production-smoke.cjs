/**
 * Authenticated production smoke for the CRM Users/Equipe module.
 *
 * This check is intentionally read-only. It proves the login path, the
 * module rendering path, and the three public contracts that make the module
 * usable: config, readiness, and the paginated team list.
 *
 * Credentials are supplied only by the workflow environment. They are never
 * written to artifacts or included in error messages.
 */

const fs = require('fs')
const path = require('path')
const { chromium } = require('playwright')

const REPO_ROOT = path.resolve(__dirname, '..', '..')
const ARTIFACT_DIR = path.join(REPO_ROOT, 'output', 'playwright')
fs.mkdirSync(ARTIFACT_DIR, { recursive: true })

const CRM_URL = String(process.env.CRM_URL || 'https://crm.skincos.com.br').trim().replace(/\/$/, '')
const SMOKE_EMAIL = String(process.env.SMOKE_EMAIL || '').trim()
const SMOKE_PASSWORD = String(process.env.SMOKE_PASSWORD || '')
const NO_SCREENSHOTS = process.env.NO_SCREENSHOTS === '1' || process.env.NO_SCREENSHOTS === 'true'

function assert(condition, message) {
  if (!condition) throw new Error(message)
}

function stamp() {
  return new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z')
}

function safeJson(value) {
  try { return JSON.stringify(value) } catch { return '{}' }
}

async function main() {
  assert(SMOKE_EMAIL && SMOKE_PASSWORD, 'SMOKE_EMAIL and SMOKE_PASSWORD are required.')

  const runStamp = stamp()
  const artifactPath = path.join(ARTIFACT_DIR, `insumos-users-production-${runStamp}.json`)
  const screenshotPath = path.join(ARTIFACT_DIR, `insumos-users-production-${runStamp}.png`)
  const browser = await chromium.launch({
    headless: true,
    args: [
      '--disable-extensions',
      '--disable-backgrounding-occluded-windows',
      '--disable-renderer-backgrounding',
      '--disable-background-timer-throttling',
      '--disable-dev-shm-usage',
      '--disable-features=Translate,BackForwardCache',
      '--disable-gpu',
      '--mute-audio',
    ],
  })
  const context = await browser.newContext({ viewport: { width: 1365, height: 860 } })
  const page = await context.newPage()
  const consoleLines = []
  const pageErrors = []

  page.on('console', (message) => consoleLines.push(`[${message.type()}] ${message.text()}`))
  page.on('pageerror', (error) => pageErrors.push(String(error && error.message ? error.message : error)))

  await page.addInitScript(() => {
    try { localStorage.setItem('app.activeModule', 'users') } catch {}
  })

  async function apiJson(endpoint, options = {}) {
    return page.evaluate(async ({ endpoint, options }) => {
      try {
        const response = await fetch(endpoint, {
          credentials: 'include',
          headers: { accept: 'application/json', ...(options.headers || {}) },
          ...options,
        })
        const text = await response.text()
        let json = null
        try { json = text ? JSON.parse(text) : null } catch {}
        return { status: response.status, ok: response.ok, json }
      } catch {
        return { status: 0, ok: false, json: null }
      }
    }, { endpoint, options })
  }

  try {
    const moduleUrl = new URL(`${CRM_URL}/`)
    moduleUrl.searchParams.set('module', 'users')
    await page.goto(moduleUrl.toString(), { waitUntil: 'domcontentloaded', timeout: 60_000 })
    await page.waitForTimeout(1_500)

    const login = await page.evaluate(async ({ email, password }) => {
      try {
        const response = await fetch('/api/auth/login', {
          method: 'POST',
          headers: { 'content-type': 'application/json', accept: 'application/json' },
          credentials: 'include',
          body: JSON.stringify({ email, password }),
        })
        return { status: response.status, ok: response.ok }
      } catch {
        return { status: 0, ok: false }
      }
    }, { email: SMOKE_EMAIL, password: SMOKE_PASSWORD })
    assert(login.status === 200 && login.ok, `AUTH_LOGIN_FAILED:${login.status}`)

    await page.reload({ waitUntil: 'domcontentloaded', timeout: 60_000 })
    await page.waitForTimeout(3_000)

    const authMe = await apiJson('/api/auth/me')
    assert(authMe.status === 200 && authMe.ok, `AUTH_SESSION_FAILED:${authMe.status}`)

    const config = await apiJson('/api/crm/admin/team?mode=config')
    const readiness = await apiJson('/api/crm/admin/team?mode=readiness')
    const teamList = await apiJson('/api/crm/admin/team?status=ACTIVE&pagina=1&limite=20')

    const readinessData = readiness.json && readiness.json.data
    assert(config.status === 200 && config.ok && config.json?.success === true, `TEAM_CONFIG_FAILED:${config.status}`)
    assert(readiness.status === 200 && readiness.ok, `TEAM_READINESS_HTTP_FAILED:${readiness.status}`)
    assert(readiness.json?.success === true && readinessData?.ready === true, 'TEAM_READINESS_NOT_READY')
    assert(Array.isArray(readinessData?.missing) && readinessData.missing.length === 0, 'TEAM_READINESS_MISSING_REQUIREMENTS')
    assert(teamList.status === 200 && teamList.ok && teamList.json?.success === true, `TEAM_LIST_FAILED:${teamList.status}`)
    assert(Array.isArray(teamList.json?.data), 'TEAM_LIST_DATA_NOT_ARRAY')
    assert(teamList.json?.pagination && typeof teamList.json.pagination === 'object', 'TEAM_LIST_PAGINATION_MISSING')

    const bodyText = String((await page.textContent('body').catch(() => '')) || '')
    assert(/Usuários|Usuarios/i.test(bodyText), 'USERS_MODULE_HEADING_MISSING')
    assert(/Equipe/i.test(bodyText), 'TEAM_MODULE_HEADING_MISSING')
    assert(!/domain_service_degraded/i.test(bodyText), 'DOMAIN_SERVICE_DEGRADED_VISIBLE')
    assert(!/dados exibidos podem estar desatualizados/i.test(bodyText), 'STALE_DATA_ALERT_VISIBLE')

    if (!NO_SCREENSHOTS) await page.screenshot({ path: screenshotPath, fullPage: true })

    const result = {
      at: new Date().toISOString(),
      url: CRM_URL,
      module: 'users',
      readOnly: true,
      login: { status: login.status, ok: login.ok },
      authMe: { status: authMe.status, ok: authMe.ok },
      config: { status: config.status, ok: config.ok, success: config.json?.success === true },
      readiness: {
        status: readiness.status,
        ok: readiness.ok,
        success: readiness.json?.success === true,
        ready: readinessData?.ready === true,
        missingCount: Array.isArray(readinessData?.missing) ? readinessData.missing.length : null,
      },
      teamList: {
        status: teamList.status,
        ok: teamList.ok,
        success: teamList.json?.success === true,
        dataIsArray: Array.isArray(teamList.json?.data),
        count: Array.isArray(teamList.json?.data) ? teamList.json.data.length : null,
        paginationPresent: !!(teamList.json?.pagination && typeof teamList.json.pagination === 'object'),
      },
      ui: {
        usersHeading: /Usuários|Usuarios/i.test(bodyText),
        teamHeading: /Equipe/i.test(bodyText),
        degradedAlert: /domain_service_degraded/i.test(bodyText),
        staleDataAlert: /dados exibidos podem estar desatualizados/i.test(bodyText),
      },
      pageErrors: pageErrors.slice(0, 20),
      consoleTop: consoleLines.slice(0, 60),
    }
    fs.writeFileSync(artifactPath, `${safeJson(result)}\n`)
    console.log(`[insumos-users-production-smoke] PASS login=${login.status} config=${config.status} readiness=${readiness.status} list=${teamList.status} rows=${result.teamList.count}`)
  } finally {
    await context.close().catch(() => {})
    await browser.close().catch(() => {})
  }
}

main().catch((error) => {
  console.error(`[insumos-users-production-smoke] FAILED: ${String(error && error.message ? error.message : error)}`)
  process.exitCode = 1
})
