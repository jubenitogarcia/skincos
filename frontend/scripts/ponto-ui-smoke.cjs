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
const LOGIN_WAIT_MS = Math.max(5_000, parseInt(String(process.env.LOGIN_WAIT_MS || ''), 10) || 10 * 60_000)
const TRACE = process.env.TRACE === '1' || process.env.TRACE === 'true'
const FULL_PAGE = process.env.FULL_PAGE === '1' || process.env.FULL_PAGE === 'true'
const CHANNEL = String(process.env.CHANNEL || '').trim()
const PERSISTENT = process.env.PERSISTENT === '1' || process.env.PERSISTENT === 'true'
const EXPECT_BUILD_SHA = String(process.env.EXPECT_BUILD_SHA || '').trim().toLowerCase()
const MUTATE_ADMIN = process.env.MUTATE_ADMIN === '1' || process.env.MUTATE_ADMIN === 'true'

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
  const launchOpts = {
    headless: !HEADED,
    ...(CHANNEL ? { channel: CHANNEL } : {}),
    args: [
      // Reduce background overhead and keep CI stable.
      '--disable-extensions',
      '--disable-backgrounding-occluded-windows',
      '--disable-renderer-backgrounding',
      '--disable-background-timer-throttling',
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
  const page = await context.newPage()

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
    await page.screenshot({ path: shot('home'), fullPage: FULL_PAGE })

    const loginMarker = page.locator('text=Acessar Plataforma').first()
    const isLogin = await loginMarker.isVisible().catch(() => false)
    if (isLogin) {
      console.log('[ponto-ui-smoke] Not authenticated yet.')
      console.log('[ponto-ui-smoke] If running headed (HEADED=1), complete login in the opened window.')
      console.log(`[ponto-ui-smoke] Waiting up to ${Math.ceil(LOGIN_WAIT_MS / 1000)}s for login...`)
    }

    if (isLogin) {
      await loginMarker.waitFor({ state: 'hidden', timeout: LOGIN_WAIT_MS })
    }
    // Persist auth for the next run without needing a persistent profile.
    await context.storageState({ path: storageStatePath }).catch(() => {})
    await page.waitForTimeout(1500)
    await page.screenshot({ path: shot('after-auth'), fullPage: FULL_PAGE })

    // Go directly to the Ponto module to avoid loading heavy default modules and to reduce flakiness in sidebar selectors.
    await page
      .evaluate(() => {
        try {
          localStorage.setItem('app.activeModule', 'ponto')
        } catch {}
      })
      .catch(() => {})
    await page.reload({ waitUntil: 'domcontentloaded', timeout: 60_000 })
    await page.waitForTimeout(1500)

    const buildBadge = page
      .locator('text=/Build:\\s*[a-f0-9]{7,}|Build:\\s*unknown|build:\\s*[a-f0-9]{7,}|build:\\s*unknown/i')
      .first()
    await buildBadge.waitFor({ timeout: 30_000 })
    if (EXPECT_BUILD_SHA) {
      const expectedShort = EXPECT_BUILD_SHA.slice(0, 7)
      const badgeText = String((await buildBadge.textContent().catch(() => '')) || '').toLowerCase()
      if (!badgeText.includes(expectedShort)) {
        throw new Error(`Build badge mismatch (expected ${expectedShort}). Got: ${badgeText || '(empty)'}`)
      }
    }
    await page.screenshot({ path: shot('ponto-open'), fullPage: FULL_PAGE })

    const diagButton = page.locator('button:has-text("Diagnóstico")').first()
    await diagButton.click({ timeout: 30_000 })
    await page.waitForTimeout(1500)
    await page.screenshot({ path: shot('diagnostics'), fullPage: FULL_PAGE })

    await page.locator('text=GET /api/ponto/_proxy-status').first().waitFor({ timeout: 30_000 })
    await page.locator('text=GET /api/ponto/health').first().waitFor({ timeout: 30_000 })

    await page.keyboard.press('Escape')
    await page.waitForTimeout(500)

    await page.locator('button:has-text("Kiosk")').first().click({ timeout: 30_000 })
    await page.waitForTimeout(1500)
    await page.screenshot({ path: shot('kiosk'), fullPage: FULL_PAGE })
    {
      // Avoid false positives: the module description contains "fallback por PIN" text even when the fallback card is closed.
      // The actual fallback UI uses CardTitle with data-slot="card-title".
      const visible = await page.locator('[data-slot="card-title"]', { hasText: 'Fallback por PIN' }).first().isVisible().catch(() => false)
      if (visible) throw new Error('Kiosk PIN fallback is visible by default (expected hidden).')
    }

    const adminTab = page.locator('button:has-text("Admin")').first()
    const hasAdminTab = await adminTab.isVisible().catch(() => false)
    if (hasAdminTab) {
      await adminTab.click({ timeout: 30_000 })
      await page.waitForTimeout(1500)
      await page.screenshot({ path: shot('admin'), fullPage: FULL_PAGE })
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
