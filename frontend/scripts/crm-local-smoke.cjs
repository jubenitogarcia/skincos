/* eslint-disable no-console */
/**
 * CRM Local Smoke — Playwright (headless).
 *
 * Goal: validate that the CRM can be exercised locally (Vite + crm-api) without
 * Cloudflare Pages Functions, while keeping production untouched.
 *
 * Expected local mode:
 * - Run CRM locally with NO_AUTH=true (dev auth stub)
 * - Vite proxies /api/* -> crm-api (8099)
 *
 * Artifacts: output/playwright/
 */

const fs = require('fs')
const path = require('path')
const { chromium } = require('playwright')

const REPO_ROOT = path.resolve(__dirname, '..', '..')
const ARTIFACT_DIR = path.join(REPO_ROOT, 'output', 'playwright')
fs.mkdirSync(ARTIFACT_DIR, { recursive: true })

const URL = process.env.CRM_URL || 'http://127.0.0.1:5173'
const HEADED = process.env.HEADED === '1' || process.env.HEADED === 'true'
const TIMEOUT_MS = Math.max(5_000, parseInt(String(process.env.TIMEOUT_MS || ''), 10) || 60_000)

function nowStamp() {
  const d = new Date()
  const pad = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`
}

async function expectVisible(locator, label) {
  try {
    await locator.first().waitFor({ state: 'visible', timeout: TIMEOUT_MS })
  } catch (e) {
    throw new Error(`Expected visible: ${label}`)
  }
}

async function main() {
  const stamp = nowStamp()
  const shot = (name) => path.join(ARTIFACT_DIR, `crm-local-${stamp}-${name}.png`)

  const browser = await chromium.launch({
    headless: !HEADED,
    args: [
      '--disable-extensions',
      '--disable-backgrounding-occluded-windows',
      '--disable-renderer-backgrounding',
      '--disable-background-timer-throttling',
      '--mute-audio',
      ...(HEADED ? [] : ['--disable-gpu']),
    ],
  })

  const context = await browser.newContext({
    viewport: { width: 1365, height: 860 },
    ignoreHTTPSErrors: true,
  })
  // Make the run deterministic and fast: start directly in the Ponto module.
  await context.addInitScript(() => {
    try { localStorage.setItem('app.activeModule', 'ponto') } catch { /* ignore */ }
  })
  const page = await context.newPage()

  const consoleErrors = []
  page.on('console', (msg) => {
    const t = msg.type()
    if (t === 'error') consoleErrors.push(msg.text())
  })

  await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: TIMEOUT_MS })

  // Ensure module rendered.
  await expectVisible(page.locator('h1, h2, [role="heading"]').filter({ hasText: 'Ponto' }), 'Ponto heading')

  // Build badge should be present (dev or sha).
  await expectVisible(page.locator('text=/Build:\\s*/'), 'Build badge')

  // Diagnostics should load without crashing (localDirect _proxy-status + health).
  await page.click('button:has-text("Diagnóstico")', { timeout: TIMEOUT_MS })
  await expectVisible(page.locator('text=GET /api/ponto/_proxy-status'), 'Diagnostics content (_proxy-status)')
  await expectVisible(page.locator('text=GET /api/ponto/health'), 'Diagnostics content (health)')
  // Look for "ok" somewhere (either payload preview or rendered JSON snippet).
  await expectVisible(page.locator('text=/\"ok\"\\s*:\\s*true/'), 'Diagnostics ok:true')
  await page.keyboard.press('Escape').catch(() => {})

  // Kiosk: PIN fallback must be hidden until triggered.
  await page.click('button[role="tab"]:has-text("Kiosk")', { timeout: TIMEOUT_MS })
  const pinFallback = page.getByText('Fallback por PIN', { exact: true })
  const kioskLoaded = page.locator('text=Configuração do Dispositivo')
  await expectVisible(kioskLoaded, 'Kiosk loaded')
  // The fallback panel is rendered only when devicePinOpen is true.
  // Ensure we don't fail on hidden/offscreen text occurrences.
  const pinCount = await pinFallback.count().catch(() => 0)
  const pinVisible = pinCount ? await pinFallback.first().isVisible().catch(() => false) : false
  if (pinCount) {
    const debug = await pinFallback.first().evaluate((el) => {
      const cs = window.getComputedStyle(el)
      const r = el.getBoundingClientRect()
      return {
        text: String(el.textContent || '').trim().slice(0, 120),
        display: cs.display,
        visibility: cs.visibility,
        opacity: cs.opacity,
        rect: { x: r.x, y: r.y, w: r.width, h: r.height },
      }
    }).catch(() => null)
    console.log('[crm-local-smoke] kiosk pinFallback debug:', { pinCount, pinVisible, debug })
  }
  if (pinVisible) {
    await page.screenshot({ path: shot('kiosk-pin-visible'), fullPage: true })
    throw new Error('Kiosk PIN fallback is visible by default (expected hidden).')
  }

  // Admin tab should be accessible for local dev admin session.
  await page.click('button[role="tab"]:has-text("Admin")', { timeout: TIMEOUT_MS })
  await expectVisible(page.locator('text=Admin logado'), 'Admin logged badge')
  // Must not ask for manual token.
  if ((await page.locator('text=/Admin token/i').count()) > 0) {
    await page.screenshot({ path: shot('admin-token-visible'), fullPage: true })
    throw new Error('Admin token input is visible (expected hidden for CRM admins).')
  }

  await page.screenshot({ path: shot('ok'), fullPage: true })

  if (consoleErrors.length) {
    console.log('[crm-local-smoke] Console errors (first 5):')
    for (const e of consoleErrors.slice(0, 5)) console.log('  -', e)
  }

  await context.close()
  await browser.close()

  console.log(`[crm-local-smoke] OK: ${URL}`)
}

main().catch((err) => {
  console.error('[crm-local-smoke] FAIL:', err?.message || err)
  process.exitCode = 1
})
