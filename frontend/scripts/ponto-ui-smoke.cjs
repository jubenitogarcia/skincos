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

  const context = await chromium.launchPersistentContext(path.join(ARTIFACT_DIR, 'profile-crm'), {
    headless: !HEADED,
    viewport: { width: 1365, height: 900 },
  })
  const page = await context.newPage()

  await context.tracing.start({ screenshots: true, snapshots: true, sources: false })

  const consoleLines = []
  page.on('console', (msg) => consoleLines.push(`[${msg.type()}] ${msg.text()}`))
  page.on('pageerror', (err) => consoleLines.push(`[pageerror] ${String((err && err.stack) || err)}`))

  try {
    await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 60_000 })
    await page.waitForTimeout(1500)
    await page.screenshot({ path: shot('home'), fullPage: true })

    const authEmail = page.locator('#auth-email')
    const loggedInPontoLink = page.locator('text=Ponto').first()

    const authVisible = await authEmail.isVisible().catch(() => false)
    if (authVisible) {
      console.log('[ponto-ui-smoke] Not authenticated yet.')
      console.log('[ponto-ui-smoke] If running headed (HEADED=1), complete login in the opened window.')
      console.log(`[ponto-ui-smoke] Waiting up to ${Math.ceil(LOGIN_WAIT_MS / 1000)}s for login...`)
    }

    await page.waitForFunction(
      () => {
        const auth = document.querySelector('#auth-email')
        if (auth) return false
        return document.body && document.body.innerText && document.body.innerText.includes('Ponto')
      },
      null,
      { timeout: LOGIN_WAIT_MS }
    )
    await page.waitForTimeout(1500)
    await page.screenshot({ path: shot('after-auth'), fullPage: true })

    await loggedInPontoLink.click({ timeout: 30_000 })
    await page.waitForTimeout(2000)
    await page.screenshot({ path: shot('ponto-open'), fullPage: true })

    await page.locator('text=/Build:\\s*[a-f0-9]{7,}|Build:\\s*unknown/i').first().waitFor({ timeout: 30_000 })

    const diagButton = page.locator('button:has-text("Diagnóstico")').first()
    await diagButton.click({ timeout: 30_000 })
    await page.waitForTimeout(1500)
    await page.screenshot({ path: shot('diagnostics'), fullPage: true })

    await page.locator('text=GET /api/ponto/_proxy-status').first().waitFor({ timeout: 30_000 })
    await page.locator('text=GET /api/ponto/health').first().waitFor({ timeout: 30_000 })

    await page.keyboard.press('Escape')
    await page.waitForTimeout(500)

    await page.locator('button:has-text("Kiosk")').first().click({ timeout: 30_000 })
    await page.waitForTimeout(1500)
    await page.screenshot({ path: shot('kiosk'), fullPage: true })
    {
      const visible = await page.locator('text=Fallback por PIN').first().isVisible().catch(() => false)
      if (visible) throw new Error('Kiosk PIN fallback is visible by default (expected hidden).')
    }

    const adminTab = page.locator('button:has-text("Admin")').first()
    const hasAdminTab = await adminTab.isVisible().catch(() => false)
    if (hasAdminTab) {
      await adminTab.click({ timeout: 30_000 })
      await page.waitForTimeout(1500)
      await page.screenshot({ path: shot('admin'), fullPage: true })
      const tokenPromptVisible = await page.locator('text=/token.*admin/i').first().isVisible().catch(() => false)
      if (tokenPromptVisible) throw new Error('Admin tab still prompts for admin token (expected role-based).')
    }

    fs.writeFileSync(path.join(ARTIFACT_DIR, `ponto-ui-${stamp}-console.txt`), consoleLines.join('\n'))
    console.log('OK')
  } finally {
    await context.tracing.stop({ path: tracePath }).catch(() => {})
    await context.close().catch(() => {})
  }
}

main().catch((err) => {
  console.error('FAIL:', err && err.stack ? err.stack : err)
  process.exitCode = 1
})

