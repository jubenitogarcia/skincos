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
const FULL_ASSETS = process.env.SMOKE_FULL_ASSETS === '1' || process.env.FULL_ASSETS === '1'
const FULL_PAGE = process.env.SMOKE_FULL_PAGE === '1' || process.env.FULL_PAGE === '1'
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

  let browser = null
  let context = null

  try {
    browser = await chromium.launch({
      headless: !HEADED,
      args: [
        '--disable-extensions',
        '--disable-backgrounding-occluded-windows',
        '--disable-renderer-backgrounding',
        '--disable-background-timer-throttling',
        '--disable-dev-shm-usage',
        '--disable-features=Translate,BackForwardCache',
        '--mute-audio',
        ...(HEADED ? [] : ['--disable-gpu']),
      ],
    })

    context = await browser.newContext({
      viewport: { width: 1365, height: 860 },
      ignoreHTTPSErrors: true,
    })
    if (!HEADED && !FULL_ASSETS) {
      await context.route('**/*', async (route) => {
        const type = route.request().resourceType()
        if (type === 'image' || type === 'media' || type === 'font') return route.abort()
        return route.continue()
      })
    }
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

    // Admin actions should be visible in the header (local dev admin session).
    const adminButtons = ['Cadastrar', 'Editar', 'Exportar', 'Gerenciar Dispositivo']
    for (const label of adminButtons) {
      await expectVisible(page.locator(`button:has-text("${label}")`), `Admin action visible: ${label}`)
    }

    await page.screenshot({ path: shot('ok'), fullPage: FULL_PAGE })

    if (consoleErrors.length) {
      console.log('[crm-local-smoke] Console errors (first 5):')
      for (const e of consoleErrors.slice(0, 5)) console.log('  -', e)
    }

    console.log(`[crm-local-smoke] OK: ${URL}`)
  } finally {
    if (context) await context.close().catch(() => {})
    if (browser) await browser.close().catch(() => {})
  }
}

main().catch((err) => {
  console.error('[crm-local-smoke] FAIL:', err?.message || err)
  process.exitCode = 1
})
