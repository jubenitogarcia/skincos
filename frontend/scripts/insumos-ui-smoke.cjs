/* eslint-disable no-console */
/**
 * Insumos UI smoke (production) — Playwright.
 *
 * Validates core invariants for Insumos:
 * - No DEMO / NO_AUTH banners are visible
 * - Request storms are not triggered on load (/api/auth/me and /api/insumos/health stay bounded)
 *
 * Credentials:
 * This script can run unauthenticated (it will still validate "no storm" + "no demo").
 * If you want deeper validation, enable AUTO_LOGIN and provide SMOKE_EMAIL/SMOKE_PASSWORD.
 *
 * Artifacts are written to: output/playwright/
 */

const fs = require('fs')
const path = require('path')
const { chromium } = require('playwright')

const REPO_ROOT = path.resolve(__dirname, '..', '..')
const ARTIFACT_DIR = path.join(REPO_ROOT, 'output', 'playwright')
fs.mkdirSync(ARTIFACT_DIR, { recursive: true })

const URL = process.env.CRM_URL || 'https://crm.skincos.com.br'
const HEADED = process.env.HEADED === '1' || process.env.HEADED === 'true'
const WAIT_MS = Math.max(5_000, parseInt(String(process.env.WAIT_MS || ''), 10) || 12_000)
const FULL_PAGE = process.env.FULL_PAGE === '1' || process.env.FULL_PAGE === 'true'
const NO_SCREENSHOTS = process.env.NO_SCREENSHOTS === '1' || process.env.NO_SCREENSHOTS === 'true'
const AUTO_LOGIN = process.env.AUTO_LOGIN === '1' || process.env.AUTO_LOGIN === 'true'
const SMOKE_EMAIL = String(process.env.SMOKE_EMAIL || '').trim()
const SMOKE_PASSWORD = String(process.env.SMOKE_PASSWORD || '').trim()

function nowStamp() {
  const d = new Date()
  const pad = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`
}

async function main() {
  const stamp = nowStamp()
  const jsonPath = path.join(ARTIFACT_DIR, `insumos-ui-${stamp}.json`)
  const shot = (name) => path.join(ARTIFACT_DIR, `insumos-ui-${stamp}-${name}.png`)

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
  const context = await browser.newContext({ viewport: { width: 1365, height: 860 } })

  // Speed up routine smoke runs: UI text assertions don't need images/media/fonts.
  if (!HEADED) {
    await context.route('**/*', async (route) => {
      const type = route.request().resourceType()
      if (type === 'image' || type === 'media' || type === 'font') return route.abort()
      return route.continue()
    })
  }

  await context.addInitScript(() => {
    try {
      // Prefer going straight into Insumos to avoid extra dashboards re-mounting modules.
      localStorage.setItem('app.activeModule', 'insumos')
    } catch {}
  })

  const page = await context.newPage()
  const counts = { authMe: 0, insumosHealth: 0, any: 0 }
  const samples = []

  page.on('request', (req) => {
    const url = req.url()
    counts.any++
    if (url.includes('/api/auth/me')) counts.authMe++
    if (url.includes('/api/insumos/health')) counts.insumosHealth++
    if (samples.length < 40 && (url.includes('/api/auth/me') || url.includes('/api/insumos/health') || url.includes('/api/health'))) {
      samples.push({ method: req.method(), url })
    }
  })

  const consoleLines = []
  page.on('console', (msg) => consoleLines.push(`[${msg.type()}] ${msg.text()}`))
  page.on('pageerror', (err) => consoleLines.push(`[pageerror] ${String((err && err.stack) || err)}`))

  async function maybeScreenshot(name) {
    if (NO_SCREENSHOTS) return
    await page.screenshot({ path: shot(name), fullPage: FULL_PAGE })
  }

  async function tryAutoLogin() {
    if (!AUTO_LOGIN) return { ok: false, attempted: false }
    if (!SMOKE_EMAIL || !SMOKE_PASSWORD) {
      throw new Error('AUTO_LOGIN is enabled but SMOKE_EMAIL/SMOKE_PASSWORD were not provided.')
    }

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

    return { ok: !!api.ok, attempted: true, api }
  }

  try {
    await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 60_000 })
    await page.waitForTimeout(1500)
    await maybeScreenshot('home')

    // Optional: authenticate to exercise Insumos fetches. We keep it best-effort.
    const auto = await tryAutoLogin()
    if (auto.attempted) {
      console.log(`[insumos-ui-smoke] AUTO_LOGIN attempted: ${auto.ok ? 'OK' : 'FAILED'}`)
      await page.waitForTimeout(2500)
    }

    // Allow the app to settle and fetch initial module data.
    await page.waitForTimeout(WAIT_MS)

    const bodyText = String((await page.textContent('body').catch(() => '')) || '')
    const hasDemoBanner = /DADOS\\s+SIMULADOS|\\bDEMO\\b/i.test(bodyText)
    const hasNoAuthBanner = /NO_AUTH_MODE|Autentica[cç][aã]o\\s+desabilitada/i.test(bodyText)

    await maybeScreenshot('insumos')

    const result = {
      url: URL,
      at: new Date().toISOString(),
      waitMs: WAIT_MS,
      counts,
      hasDemoBanner,
      hasNoAuthBanner,
      samples,
      consoleTop: consoleLines.slice(0, 80),
    }
    fs.writeFileSync(jsonPath, JSON.stringify(result, null, 2))
    console.log(JSON.stringify({ jsonPath, ...result }, null, 2))

    // Hard fail thresholds: these should never happen in a healthy build.
    if (hasDemoBanner) throw new Error('DEMO banner detected in UI.')
    if (hasNoAuthBanner) throw new Error('NO_AUTH banner detected in UI.')
    if (counts.authMe > 3) throw new Error(`Auth storm: /api/auth/me called ${counts.authMe} times.`)
    if (counts.insumosHealth > 3) throw new Error(`Health storm: /api/insumos/health called ${counts.insumosHealth} times.`)
  } finally {
    await browser.close()
  }
}

main().catch((err) => {
  console.error(`[insumos-ui-smoke] FAILED: ${String((err && err.stack) || err)}`)
  process.exitCode = 1
})

