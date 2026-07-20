/* eslint-disable no-console */
/**
 * Ponto UI smoke (production) — Playwright.
 *
 * Validates key UI invariants of the Ponto module:
 * - Build badge is present
 * - Diagnostics dialog loads (/api/ponto/_proxy-status + /api/ponto/health)
 * - Admin actions appear in the header for admin users
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
const FULL_ASSETS = process.env.SMOKE_FULL_ASSETS === '1' || process.env.FULL_ASSETS === '1'
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
const SMOKE_UNIT = String(process.env.SMOKE_UNIT || '').trim()
const CHECK_PIN_LOCKOUT = process.env.CHECK_PIN_LOCKOUT === '1' || process.env.CHECK_PIN_LOCKOUT === 'true'

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
      '--disable-dev-shm-usage',
      '--disable-features=Translate,BackForwardCache',
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
  if (!HEADED && !FULL_ASSETS) {
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
    if (!IS_CI) await context.storageState({ path: storageStatePath }).catch(() => {})
    await page.waitForTimeout(1500)
    await maybeScreenshot('after-auth')

    // The initScript already set app.activeModule, but if the app booted before it ran (rare), set it again.
    await page.evaluate(() => {
      try { localStorage.setItem('app.activeModule', 'ponto') } catch {}
    }).catch(() => {})
    await page.reload({ waitUntil: 'domcontentloaded', timeout: 60_000 })
    await page.waitForTimeout(1500)

    const moduleTitle = page.locator('header h1', { hasText: /Ponto/i }).first()
    const moduleVisible = await moduleTitle.isVisible().catch(() => false)
    if (!moduleVisible) {
      const fallbackTitle = await page.locator('header h1').first().textContent().catch(() => '')
      console.log(`[ponto-ui-smoke] Ponto module not available (current title: ${fallbackTitle || 'unknown'}). Skipping.`)
      return
    }

    const buildBadge = page
      .locator('text=/Build:\\s*[a-f0-9]{7,}|Build:\\s*(unknown|dev)|build:\\s*[a-f0-9]{7,}|build:\\s*(unknown|dev)/i')
      .first()
    if (EXPECT_BUILD_SHA) {
      const badgeCount = await buildBadge.count()
      if (badgeCount > 0) {
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
      } else {
        console.log('[ponto-ui-smoke] Build badge not present; skipping EXPECT_BUILD_SHA check.')
      }
    }
    await maybeScreenshot('ponto-open')

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

    const proxyMissing =
      diag.proxyStatus === 404 ||
      /Cannot\s+GET\s+\/api\/ponto\/_proxy-status/i.test(String(diag.proxyText || ''))

    if (!proxyMissing) {
      if (!diag.proxy || diag.proxy.ok !== true) {
        throw new Error(`Proxy status failed: HTTP ${diag.proxyStatus} body=${String(diag.proxyText || '').slice(0, 260)}`)
      }
      if (diag.proxy.localDirect) {
        // Local direct backend mode: no proxy-layer config to validate.
      } else {
        if (!diag.proxy.targetConfigured) throw new Error('Proxy status: targetConfigured=false')
        if (!diag.proxy.actorKeyConfigured) throw new Error('Proxy status: actorKeyConfigured=false')
      }
    } else {
      console.log('[ponto-ui-smoke] local mode: /api/ponto/_proxy-status not available (skipping proxy asserts).')
    }

    if (!diag.health || diag.health.ok !== true) {
      throw new Error(`Health failed: HTTP ${diag.healthStatus} body=${String(diag.healthText || '').slice(0, 260)}`)
    }
    if (!proxyMissing && (diag.health.service !== 'workforce-timekeeping' || diag.health.database !== true)) {
      throw new Error(`Health contract mismatch: ${String(diag.healthText || '').slice(0, 260)}`)
    }

    await page.keyboard.press('Escape')
    await page.waitForTimeout(500)

    const smokeContext = await page.evaluate(async ({ explicitUnit }) => {
      const out = { isAdmin: false, actorEmail: '', unit: '', allowedUnits: [] }
      if (explicitUnit) out.unit = explicitUnit
      try {
        const res = await fetch('/api/auth/me', { credentials: 'include' })
        const text = await res.text()
        let json = null
        try { json = text ? JSON.parse(text) : null } catch {}
        const role = String(json?.user?.role || '').toUpperCase()
        out.isAdmin = role === 'GESTOR' || role === 'GERENTE'
        out.actorEmail = json?.user?.email ? String(json.user.email) : ''
        const allowed = Array.isArray(json?.user?.allowedUnits)
          ? json.user.allowedUnits.map((u) => String(u || '').trim()).filter(Boolean)
          : []
        out.allowedUnits = allowed
        if (allowed.length) out.unit = allowed[0]
      } catch {}
      if (!out.unit) {
        try {
          const res = await fetch('/api/insumos/health', { credentials: 'include' })
          const text = await res.text()
          let json = null
          try { json = text ? JSON.parse(text) : null } catch {}
          const unidades = Array.isArray(json?.unidades) ? json.unidades : []
          const unit = String(unidades[0] || '').trim()
          if (unit) out.unit = unit
        } catch {}
      }
      return out
    }, { explicitUnit: SMOKE_UNIT })

    const mutateRequested = MUTATE_ADMIN || MUTATE_EMPLOYEE || MUTATE_PUNCH
    if (mutateRequested && !smokeContext.isAdmin) {
      throw new Error('Mutation requested, but the session is not admin. Ensure the smoke account is admin and /api/auth/me is available.')
    }

    if (smokeContext.isAdmin) {
      await maybeScreenshot('admin')
      const adminButtons = ['Cadastrar', 'Editar', 'Exportar', 'Gerenciar Dispositivo']
      for (const label of adminButtons) {
        const btn = page.locator(`button:has-text("${label}")`).first()
        await btn.waitFor({ state: 'visible', timeout: 20_000 }).catch(() => {
          throw new Error(`Admin action missing from header: ${label}`)
        })
      }

      if (MUTATE_ADMIN) {
        const created = await page.evaluate(async ({ unit }) => {
          const stamp = Date.now()
          const name = `Smoke Test ${stamp}`
          const code = `smoke-${stamp}`
          const loginEmail = `smoke+${stamp}@example.com`
          if (!unit) {
            throw new Error('unit missing for admin create (configure allowedUnits or insumos/health)')
          }
          const createRes = await fetch('/api/ponto/admin/employees', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify({ name, code, loginEmail, unit }),
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
        }, { unit: smokeContext.unit })
        console.log(`[ponto-ui-smoke] Admin create/list/delete OK (employeeId=${created.id})`)
      }

      if (MUTATE_EMPLOYEE) {
        if (!MUTATE_ADMIN) throw new Error('MUTATE_EMPLOYEE requires MUTATE_ADMIN (admin session + routes).')
        const out = await page.evaluate(async ({ doPunch, unitFallback, checkLockout }) => {
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

          const unitForCreate = unitFallback || ''
          if (!unitForCreate) {
            throw new Error('unit missing for admin create (configure allowedUnits or insumos/health)')
          }
          const createRes = await fetch('/api/ponto/admin/employees', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify({ name, code, loginEmail: actorEmail, unit: unitForCreate }),
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
          const allowedUnits = Array.isArray(me1?.allowedUnits) ? me1.allowedUnits.map((u) => String(u || '').trim()).filter(Boolean) : []
          const unit = allowedUnits[0] || ''

          let punch = null
          if (doPunch) {
            if (!unit) {
              throw new Error('employee unit not configured (allowedUnits empty)')
            }
            const punchRes = await fetch('/api/ponto/me/punch', {
              method: 'POST',
              headers: { 'content-type': 'application/json' },
              credentials: 'include',
              body: JSON.stringify({ pin, type: 'AUTO', unit, clientTime: new Date().toISOString() }),
            })
            const punchText = await punchRes.text()
            let punchJson = null
            try { punchJson = punchText ? JSON.parse(punchText) : null } catch {}
            if (!punchRes.ok || !punchJson?.ok) {
              throw new Error(`me punch failed: HTTP ${punchRes.status} body=${punchText.slice(0, 400)}`)
            }
            punch = punchJson?.data || null

            const recordsRes = await fetch(`/api/ponto/me/records?limit=5&unit=${encodeURIComponent(unit)}`, { credentials: 'include' })
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
              body: JSON.stringify({ pin, type: 'AUTO', unit, clientTime: new Date().toISOString() }),
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

            if (checkLockout) {
              const wrongPin = '0000'
              let locked = false
              for (let i = 0; i < 6; i++) {
                const res = await fetch('/api/ponto/me/punch', {
                  method: 'POST',
                  headers: { 'content-type': 'application/json' },
                  credentials: 'include',
                  body: JSON.stringify({ pin: wrongPin, type: 'AUTO', unit, clientTime: new Date().toISOString() }),
                })
                const text = await res.text()
                let json = null
                try { json = text ? JSON.parse(text) : null } catch {}
                if (res.status === 429 && json?.error === 'PIN_LOCKED') {
                  locked = true
                  break
                }
              }
              if (!locked) {
                throw new Error('PIN lockout not triggered after repeated failures')
              }
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
        }, { doPunch: MUTATE_PUNCH, unitFallback: smokeContext.unit, checkLockout: CHECK_PIN_LOCKOUT })
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
