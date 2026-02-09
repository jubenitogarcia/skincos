/* eslint-disable no-console */
/**
 * Ponto UI smoke (production) — Playwright.
 *
 * Validates key UI invariants of the Ponto module:
 * - Build badge is present
 * - Diagnostics dialog loads (/api/ponto/_proxy-status + /api/ponto/health)
 * - Kiosk PIN fallback is hidden by default (only appears when triggered)
 * - Admin tab (when visible) does NOT ask for manual admin token
 *
 * Credentials:
 * This script intentionally does NOT handle credentials. If not authenticated:
 * - run with HEADED=1
 * - complete login manually in the opened browser window
 * - the script continues automatically
 *
 * Artifacts are written to: output/playwright/
 */

const fs = require('fs')
const path = require('path')

const REPO_ROOT = path.resolve(__dirname, '..', '..')
const ARTIFACT_DIR = path.join(REPO_ROOT, 'output', 'playwright')
fs.mkdirSync(ARTIFACT_DIR, { recursive: true })

const URL = process.env.CRM_URL || 'https://crm.skincos.com.br'
const HEADED = process.env.HEADED === '1' || process.env.HEADED === 'true'
const LOGIN_WAIT_MS = Math.max(
  5_000,
  parseInt(String(process.env.LOGIN_WAIT_MS || ''), 10) || (process.env.CI ? 120_000 : 10 * 60_000)
)
const TRACE = process.env.TRACE === '1' || process.env.TRACE === 'true'
const FULL_PAGE = process.env.FULL_PAGE === '1' || process.env.FULL_PAGE === 'true'
const NO_SCREENSHOTS = process.env.NO_SCREENSHOTS === '1' || process.env.NO_SCREENSHOTS === 'true'
const IS_CI = !!process.env.CI
const AUTO_LOGIN = process.env.AUTO_LOGIN === '1' || process.env.AUTO_LOGIN === 'true'
const SMOKE_EMAIL = String(process.env.SMOKE_EMAIL || '').trim()
const SMOKE_PASSWORD = String(process.env.SMOKE_PASSWORD || '').trim()
const CHANNEL = String(process.env.CHANNEL || '').trim()
const PERSISTENT = process.env.PERSISTENT === '1' || process.env.PERSISTENT === 'true'
const EXPECT_BUILD_SHA = String(process.env.EXPECT_BUILD_SHA || '').trim().toLowerCase()
const BUILD_BADGE_WAIT_MS = Math.max(
  5_000,
  parseInt(String(process.env.BUILD_BADGE_WAIT_MS || ''), 10) || (process.env.CI ? 90_000 : 30_000)
)
const MUTATE_ADMIN = process.env.MUTATE_ADMIN === '1' || process.env.MUTATE_ADMIN === 'true'
const MUTATE_EMPLOYEE = process.env.MUTATE_EMPLOYEE === '1' || process.env.MUTATE_EMPLOYEE === 'true'
const MUTATE_PUNCH = process.env.MUTATE_PUNCH === '1' || process.env.MUTATE_PUNCH === 'true'

const { chromium } = require('playwright')

function nowStamp() {
  const d = new Date()
  const pad = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`
}

async function main() {
  const stamp = nowStamp()
  const tracePath = path.join(ARTIFACT_DIR, `ponto-ui-trace-${stamp}.zip`)
  const shot = (name) => path.join(ARTIFACT_DIR, `ponto-ui-${stamp}-${name}.png`)
  const storageStatePath = path.join(ARTIFACT_DIR, 'storage-crm.json')

  const viewport = { width: 1365, height: 860 }
  const disableGpu = IS_CI || !HEADED
  const launchOpts = {
    headless: !HEADED,
    ...(CHANNEL ? { channel: CHANNEL } : {}),
    args: [
      // Reduce background overhead and keep CI stable.
      '--disable-extensions',
      '--disable-backgrounding-occluded-windows',
      '--disable-renderer-backgrounding',
      '--disable-background-timer-throttling',
      '--mute-audio',
      ...(disableGpu ? ['--disable-gpu'] : []),
    ],
  }

  let browser = null
  let context = null
  if (PERSISTENT) {
    // Persistent profile is handy for manual debugging, but can be noticeably slower.
    context = await chromium.launchPersistentContext(path.join(ARTIFACT_DIR, 'profile-crm'), {
      ...launchOpts,
      viewport,
    })
  } else {
    browser = await chromium.launch(launchOpts)
    context = await browser.newContext({
      viewport,
      ...(fs.existsSync(storageStatePath) ? { storageState: storageStatePath } : {}),
    })
  }

  // Speed up automation runs: UI text assertions don't need images/media/fonts.
  if (!HEADED) {
    await context.route('**/*', async (route) => {
      const type = route.request().resourceType()
      if (type === 'image' || type === 'media' || type === 'font') return route.abort()
      return route.continue()
    })
  }

  await context.addInitScript(() => {
    try {
      // Prefer going straight into the Ponto module to avoid heavy default dashboards.
      localStorage.setItem('app.activeModule', 'ponto')
    } catch {}
  })
  const page = await context.newPage()

  async function maybeScreenshot(name) {
    if (NO_SCREENSHOTS) return
    await page.screenshot({ path: shot(name), fullPage: FULL_PAGE })
  }

  async function tryAutoLogin() {
    if (!AUTO_LOGIN) return false
    if (!SMOKE_EMAIL || !SMOKE_PASSWORD) {
      throw new Error('AUTO_LOGIN is enabled but SMOKE_EMAIL/SMOKE_PASSWORD were not provided.')
    }

    // Prefer API login to avoid flakiness from hydration/handlers not attached yet in CI.
    // This also tends to be faster than driving the UI.
    const api = await page.evaluate(async ({ email, password }) => {
      try {
        const res = await fetch('/api/auth/login', {
          method: 'POST',
          headers: { 'content-type': 'application/json', accept: 'application/json' },
          credentials: 'include',
          body: JSON.stringify({ email, password }),
        })
        const text = await res.text()
        let json = null
        try { json = text ? JSON.parse(text) : null } catch { json = null }
        return { ok: res.ok, status: res.status, json, text: String(text || '').slice(0, 240) }
      } catch (e) {
        return { ok: false, status: 0, json: null, text: String(e && e.message ? e.message : e).slice(0, 240) }
      }
    }, { email: SMOKE_EMAIL, password: SMOKE_PASSWORD })

    if (api.ok) return true

    // Fallback: attempt UI login (useful if the API path changes).
    // Keep this as a best-effort; final auth state is verified via /api/auth/me.
    const emailInput = page.locator('input[type="email"], input[autocomplete="email"], input[placeholder*="@empresa" i]').first()
    const passInput = page.locator('input[type="password"], input[autocomplete="current-password"]').first()
    const submitButton = page.locator('button:has-text("Acessar Plataforma"), button:has-text("Entrar"), button:has-text("Acessar"), [role="button"]:has-text("Acessar Plataforma")').first()

    await emailInput.waitFor({ timeout: 30_000 })
    await emailInput.fill(SMOKE_EMAIL)
    await passInput.fill(SMOKE_PASSWORD)
    await submitButton.click({ timeout: 30_000 })

    // Expose the API failure as context (no credentials included).
    console.log(`[ponto-ui-smoke] API login failed: HTTP ${api.status}${api.text ? ` • ${api.text}` : ''}`)
    return true
  }

  async function authState() {
    return await page.evaluate(async () => {
      try {
        const res = await fetch('/api/auth/me', { credentials: 'include' })
        const text = await res.text()
        let json = null
        try { json = text ? JSON.parse(text) : null } catch { json = null }
        const username = json?.user?.username ? String(json.user.username) : ''
        return { ok: res.ok && !!username, status: res.status, username, text: String(text || '').slice(0, 240) }
      } catch (e) {
        return { ok: false, status: 0, username: '', text: String(e && e.message ? e.message : e).slice(0, 240) }
      }
    })
  }

  async function waitForAuthOrError(timeoutMs) {
    const start = Date.now()
    const alert = page.locator('[role="alert"]').first()

    while (Date.now() - start < timeoutMs) {
      const state = await authState()
      if (state.ok) return state

      const alertVisible = await alert.isVisible().catch(() => false)
      if (alertVisible) {
        const text = String((await alert.innerText().catch(() => '')) || '').trim()
        throw new Error(`Login failed: ${text || '(unknown error)'} • /api/auth/me HTTP ${state.status}`)
      }

      await page.waitForTimeout(1000)
    }

    const state = await authState()
    throw new Error(`Login timeout after ${Math.ceil(timeoutMs / 1000)}s • /api/auth/me HTTP ${state.status} ${state.text ? `• ${state.text}` : ''}`)
  }

  // Tracing is extremely useful when debugging failures, but it can slow down the browser significantly.
  // Keep it opt-in for routine smoke runs.
  if (TRACE) await context.tracing.start({ screenshots: true, snapshots: true, sources: false })

  const consoleLines = []
  page.on('console', (msg) => consoleLines.push(`[${msg.type()}] ${msg.text()}`))
  page.on('pageerror', (err) => consoleLines.push(`[pageerror] ${String((err && err.stack) || err)}`))

  try {
    await page.emulateMedia({ reducedMotion: 'reduce' })
    await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 60_000 })
    await page.waitForTimeout(1500)
    await page.addStyleTag({
      content: `
        *, *::before, *::after {
          animation-duration: 0.001s !important;
          animation-iteration-count: 1 !important;
          transition-duration: 0.001s !important;
          scroll-behavior: auto !important;
        }
      `,
    }).catch(() => {})
    await maybeScreenshot('home')

    // We use API auth state as source of truth; UI text is prone to false-positives.
    const preAuth = await authState()
    const isLogin = !preAuth.ok
    if (isLogin) {
      console.log('[ponto-ui-smoke] Not authenticated yet.')
      if (AUTO_LOGIN) console.log('[ponto-ui-smoke] AUTO_LOGIN enabled: attempting login.')
      else console.log('[ponto-ui-smoke] If running headed (HEADED=1), complete login in the opened window.')
      console.log(`[ponto-ui-smoke] Waiting up to ${Math.ceil(LOGIN_WAIT_MS / 1000)}s for login...`)
    }

    if (isLogin) {
      if (AUTO_LOGIN) {
        await tryAutoLogin()
      }
      await waitForAuthOrError(LOGIN_WAIT_MS)
    }
    // Persist auth for the next run without needing a persistent profile.
    await context.storageState({ path: storageStatePath }).catch(() => {})
    await page.waitForTimeout(1500)
    await maybeScreenshot('after-auth')

    // The initScript already set app.activeModule, but if the app booted before it ran (rare), set it again.
    await page.evaluate(() => {
      try { localStorage.setItem('app.activeModule', 'ponto') } catch {}
    }).catch(() => {})
    await page.reload({ waitUntil: 'domcontentloaded', timeout: 60_000 })
    await page.waitForTimeout(1500)

    const buildBadge = page
      .locator('text=/Build:\\s*[a-f0-9]{7,}|Build:\\s*unknown|build:\\s*[a-f0-9]{7,}|build:\\s*unknown/i')
      .first()
    await buildBadge.waitFor({ timeout: 30_000 })
    if (EXPECT_BUILD_SHA) {
      const expectedShort = EXPECT_BUILD_SHA.slice(0, 7)
      const start = Date.now()
      let lastText = ''
      let attempt = 0
      while (Date.now() - start < BUILD_BADGE_WAIT_MS) {
        attempt += 1
        const badgeText = String((await buildBadge.textContent().catch(() => '')) || '').toLowerCase()
        lastText = badgeText
        if (badgeText.includes(expectedShort)) break
        // Sometimes Pages env + new deployment propagation can lag a little.
        await page.waitForTimeout(3000)
        await page.reload({ waitUntil: 'domcontentloaded', timeout: 60_000 })
        await page.waitForTimeout(1200)
      }
      if (!lastText.includes(expectedShort)) {
        throw new Error(
          `Build badge mismatch after ${Math.ceil(BUILD_BADGE_WAIT_MS / 1000)}s (expected ${expectedShort}). Got: ${lastText || '(empty)'}`
        )
      }
    }
    await maybeScreenshot('ponto-open')

    const diagButton = page.locator('button:has-text("Diagnóstico")').first()
    await diagButton.click({ timeout: 30_000 })
    await page.waitForTimeout(1500)
    await maybeScreenshot('diagnostics')

    await page.locator('text=GET /api/ponto/_proxy-status').first().waitFor({ timeout: 30_000 })
    await page.locator('text=GET /api/ponto/health').first().waitFor({ timeout: 30_000 })

    const diag = await page.evaluate(async () => {
      const out = { proxy: null, health: null, proxyStatus: 0, healthStatus: 0, proxyText: '', healthText: '' }
      try {
        const res = await fetch('/api/ponto/_proxy-status', { credentials: 'include' })
        out.proxyStatus = res.status
        out.proxyText = await res.text()
        try { out.proxy = out.proxyText ? JSON.parse(out.proxyText) : null } catch { out.proxy = null }
      } catch (e) {
        out.proxyText = String(e && e.message ? e.message : e)
      }
      try {
        const res = await fetch('/api/ponto/health', { credentials: 'include' })
        out.healthStatus = res.status
        out.healthText = await res.text()
        try { out.health = out.healthText ? JSON.parse(out.healthText) : null } catch { out.health = null }
      } catch (e) {
        out.healthText = String(e && e.message ? e.message : e)
      }
      return out
    })

    if (!diag.proxy || diag.proxy.ok !== true) {
      throw new Error(`Proxy status failed: HTTP ${diag.proxyStatus} body=${String(diag.proxyText || '').slice(0, 260)}`)
    }
    if (!diag.proxy.effectiveTargetConfigured) throw new Error('Proxy status: effectiveTargetConfigured=false')
    if (!diag.proxy.targetConfigured) {
      // Not a hard failure: the proxy can fall back to INSUMOS_API_TARGET. We still require an effective target above.
      console.log('[ponto-ui-smoke] WARN: Proxy status: targetConfigured=false (PONTO_API_TARGET missing; using fallback target)')
    }
    if (!diag.proxy.proxyTokenConfigured) throw new Error('Proxy status: proxyTokenConfigured=false')
    if (!diag.proxy.actorKeyConfigured) throw new Error('Proxy status: actorKeyConfigured=false')
    if (!diag.proxy.adminTokenConfigured) throw new Error('Proxy status: adminTokenConfigured=false')

    if (!diag.health || diag.health.ok !== true) {
      throw new Error(`Health failed: HTTP ${diag.healthStatus} body=${String(diag.healthText || '').slice(0, 260)}`)
    }

    await page.keyboard.press('Escape')
    await page.waitForTimeout(500)

    await page.locator('button:has-text("Kiosk")').first().click({ timeout: 30_000 })
    await page.waitForTimeout(1500)
    await maybeScreenshot('kiosk')
    {
      // Avoid false positives: the module description contains "fallback por PIN" text even when the fallback card is closed.
      // The actual fallback UI uses CardTitle with data-slot="card-title".
      const visible = await page.locator('[data-slot="card-title"]', { hasText: 'Fallback por PIN' }).first().isVisible().catch(() => false)
      if (visible) throw new Error('Kiosk PIN fallback is visible by default (expected hidden).')
    }

    async function waitForAdminTab(timeoutMs) {
      const start = Date.now()
      const adminTab = page.locator('button:has-text("Admin")').first()
      while (Date.now() - start < timeoutMs) {
        const visible = await adminTab.isVisible().catch(() => false)
        if (visible) return adminTab
        await page.waitForTimeout(250)
      }
      return null
    }

    const mutateRequested = MUTATE_ADMIN || MUTATE_EMPLOYEE || MUTATE_PUNCH
    const adminTab = mutateRequested ? await waitForAdminTab(30_000) : page.locator('button:has-text("Admin")').first()
    const hasAdminTab = adminTab ? await adminTab.isVisible().catch(() => false) : false

    if (mutateRequested && !hasAdminTab) {
      throw new Error('Mutation requested, but Admin tab is not visible. Ensure the smoke account is an admin and that /api/auth/me loads in time.')
    }

    if (hasAdminTab) {
      await adminTab.click({ timeout: 30_000 })
      await page.waitForTimeout(1500)
      await maybeScreenshot('admin')
      // Avoid false positives: other tabs contain "token" strings (device token), and tab panels can remain in the DOM.
      // We only fail if there's an *actual* admin-token prompt (text or an input hinting admin token).
      const adminTokenTextVisible = await page
        .locator('text=/admin\\s*token|token\\s*(do|de)?\\s*admin/i')
        .first()
        .isVisible()
        .catch(() => false)
      const adminTokenInputVisible = await page
        .locator('input[placeholder*="admin" i], input[aria-label*="admin" i]')
        .first()
        .isVisible()
        .catch(() => false)
      if (adminTokenTextVisible || adminTokenInputVisible) {
        throw new Error('Admin tab still prompts for admin token (expected role-based).')
      }

      if (MUTATE_ADMIN) {
        const created = await page.evaluate(async () => {
          const stamp = Date.now()
          const name = `Smoke Test ${stamp}`
          const code = `smoke-${stamp}`
          const createRes = await fetch('/api/ponto/admin/employees', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify({ name, code }),
          })
          const createText = await createRes.text()
          let createJson = null
          try { createJson = createText ? JSON.parse(createText) : null } catch {}
          if (!createRes.ok || !createJson?.ok || !createJson?.data?.id) {
            throw new Error(`admin create failed: HTTP ${createRes.status} body=${createText.slice(0, 400)}`)
          }
          const id = String(createJson.data.id)

          const listRes = await fetch('/api/ponto/admin/employees', { credentials: 'include' })
          const listText = await listRes.text()
          let listJson = null
          try { listJson = listText ? JSON.parse(listText) : null } catch {}
          if (!listRes.ok || !listJson?.ok || !Array.isArray(listJson?.data)) {
            throw new Error(`admin list failed: HTTP ${listRes.status} body=${listText.slice(0, 400)}`)
          }
          const found = listJson.data.some((e) => String(e.id) === id)
          if (!found) throw new Error(`created employee not found in list (id=${id})`)

          const delRes = await fetch(`/api/ponto/admin/employees/${encodeURIComponent(id)}`, {
            method: 'DELETE',
            credentials: 'include',
          })
          const delText = await delRes.text()
          let delJson = null
          try { delJson = delText ? JSON.parse(delText) : null } catch {}
          if (!delRes.ok || !delJson?.ok) {
            throw new Error(`admin delete failed: HTTP ${delRes.status} body=${delText.slice(0, 400)}`)
          }

          return { id, name, code }
        })
        console.log(`[ponto-ui-smoke] Admin create/list/delete OK (employeeId=${created.id})`)
      }

      if (MUTATE_EMPLOYEE) {
        if (!MUTATE_ADMIN) throw new Error('MUTATE_EMPLOYEE requires MUTATE_ADMIN (admin session + routes).')
        const out = await page.evaluate(async ({ doPunch }) => {
          const me0Res = await fetch('/api/ponto/me', { credentials: 'include' })
          const me0Text = await me0Res.text()
          let me0 = null
          try { me0 = me0Text ? JSON.parse(me0Text) : null } catch {}
          if (!me0Res.ok || !me0?.ok || !me0?.actorEmail) {
            throw new Error(`me precheck failed: HTTP ${me0Res.status} body=${me0Text.slice(0, 400)}`)
          }
          const actorEmail = String(me0.actorEmail)

          const stamp = Date.now()
          const name = `Smoke Emp ${stamp}`
          const code = `emp-${stamp}`
          const pin = '1234'

          const createRes = await fetch('/api/ponto/admin/employees', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify({ name, code, loginEmail: actorEmail }),
          })
          const createText = await createRes.text()
          let createJson = null
          try { createJson = createText ? JSON.parse(createText) : null } catch {}
          if (!createRes.ok || !createJson?.ok || !createJson?.data?.id) {
            throw new Error(`employee create (linked) failed: HTTP ${createRes.status} body=${createText.slice(0, 400)}`)
          }
          const employeeId = String(createJson.data.id)

          const pinRes = await fetch(`/api/ponto/admin/employees/${encodeURIComponent(employeeId)}/pin`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify({ pin }),
          })
          const pinText = await pinRes.text()
          let pinJson = null
          try { pinJson = pinText ? JSON.parse(pinText) : null } catch {}
          if (!pinRes.ok || !pinJson?.ok) {
            throw new Error(`set pin failed: HTTP ${pinRes.status} body=${pinText.slice(0, 400)}`)
          }

          const me1Res = await fetch('/api/ponto/me', { credentials: 'include' })
          const me1Text = await me1Res.text()
          let me1 = null
          try { me1 = me1Text ? JSON.parse(me1Text) : null } catch {}
          if (!me1Res.ok || !me1?.ok || me1?.linked !== true) {
            throw new Error(`me linked failed: HTTP ${me1Res.status} body=${me1Text.slice(0, 400)}`)
          }
          if (String(me1?.employee?.id || '') !== employeeId) {
            throw new Error(`me employee mismatch: expected=${employeeId} got=${String(me1?.employee?.id || '')}`)
          }

          let punch = null
          if (doPunch) {
            const punchRes = await fetch('/api/ponto/me/punch', {
              method: 'POST',
              headers: { 'content-type': 'application/json' },
              credentials: 'include',
              body: JSON.stringify({ pin, type: 'AUTO', clientTime: new Date().toISOString() }),
            })
            const punchText = await punchRes.text()
            let punchJson = null
            try { punchJson = punchText ? JSON.parse(punchText) : null } catch {}
            if (!punchRes.ok || !punchJson?.ok) {
              throw new Error(`me punch failed: HTTP ${punchRes.status} body=${punchText.slice(0, 400)}`)
            }
            punch = punchJson?.data || null

            const recordsRes = await fetch('/api/ponto/me/records?limit=5', { credentials: 'include' })
            const recordsText = await recordsRes.text()
            let recordsJson = null
            try { recordsJson = recordsText ? JSON.parse(recordsText) : null } catch {}
            if (!recordsRes.ok || !recordsJson?.ok || !Array.isArray(recordsJson?.data)) {
              throw new Error(`me records failed: HTTP ${recordsRes.status} body=${recordsText.slice(0, 400)}`)
            }
            if (!recordsJson.data.some((r) => String(r.id || '') === String(punch?.id || ''))) {
              throw new Error(`me records missing punch (punchId=${String(punch?.id || '')})`)
            }

            const csvRes = await fetch('/api/ponto/admin/records.csv?limit=5', { credentials: 'include' })
            const csvText = await csvRes.text()
            const csvType = String(csvRes.headers.get('content-type') || '')
            if (!csvRes.ok || !csvType.includes('text/csv')) {
              throw new Error(`admin records csv failed: HTTP ${csvRes.status} type=${csvType} body=${csvText.slice(0, 200)}`)
            }
            if (!csvText.includes('id,employeeId')) {
              throw new Error('admin records csv missing header row')
            }
            if (punch?.id && !csvText.includes(String(punch.id))) {
              throw new Error(`admin records csv missing punch (punchId=${String(punch.id)})`)
            }

            const cooldownRes = await fetch('/api/ponto/me/punch', {
              method: 'POST',
              headers: { 'content-type': 'application/json' },
              credentials: 'include',
              body: JSON.stringify({ pin, type: 'AUTO', clientTime: new Date().toISOString() }),
            })
            const cooldownText = await cooldownRes.text()
            let cooldownJson = null
            try { cooldownJson = cooldownText ? JSON.parse(cooldownText) : null } catch {}
            if (cooldownRes.status === 409) {
              if (cooldownJson?.error !== 'COOLDOWN') {
                throw new Error(`cooldown mismatch: HTTP ${cooldownRes.status} body=${cooldownText.slice(0, 240)}`)
              }
            } else if (!cooldownRes.ok) {
              throw new Error(`cooldown check failed: HTTP ${cooldownRes.status} body=${cooldownText.slice(0, 240)}`)
            }

            // Verify audit chain is still consistent after a punch write.
            const auditRes = await fetch('/api/ponto/admin/audit/verify', { credentials: 'include' })
            const auditText = await auditRes.text()
            let auditJson = null
            try { auditJson = auditText ? JSON.parse(auditText) : null } catch {}
            if (!auditRes.ok || !auditJson?.ok) {
              throw new Error(`audit verify failed: HTTP ${auditRes.status} body=${auditText.slice(0, 400)}`)
            }

          }

          const delRes = await fetch(`/api/ponto/admin/employees/${encodeURIComponent(employeeId)}`, {
            method: 'DELETE',
            credentials: 'include',
          })
          const delText = await delRes.text()
          let delJson = null
          try { delJson = delText ? JSON.parse(delText) : null } catch {}
          if (!delRes.ok || !delJson?.ok) {
            throw new Error(`cleanup delete failed: HTTP ${delRes.status} body=${delText.slice(0, 400)}`)
          }

          return { actorEmail, employeeId, punch }
        }, { doPunch: MUTATE_PUNCH })
        // Do not print actorEmail (can leak PII in CI logs).
        console.log(`[ponto-ui-smoke] Employee link + PIN OK (employeeId=${out.employeeId})${out.punch ? ' + punch' : ''}`)
      }
    }

    fs.writeFileSync(path.join(ARTIFACT_DIR, `ponto-ui-${stamp}-console.txt`), consoleLines.join('\n'))
    console.log('OK')
  } finally {
    if (TRACE) await context.tracing.stop({ path: tracePath }).catch(() => {})
    await context.close().catch(() => {})
    if (browser) await browser.close().catch(() => {})
  }
}

main().catch((err) => {
  console.error('FAIL:', err && err.stack ? err.stack : err)
  process.exitCode = 1
})
