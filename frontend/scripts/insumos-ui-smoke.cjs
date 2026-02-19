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
const INSUMOS_ACTION = String(process.env.INSUMOS_ACTION || '').trim()
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
  page.on('response', async (res) => {
    const url = res.url()
    if (url.includes('/api/auth/me')) {
      const status = res.status()
      consoleLines.push(`[auth/me] status=${status}`)
    }
  })
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
  const targetUrl = INSUMOS_ACTION
    ? `${URL}${URL.includes('?') ? '&' : '?'}insumosAction=${encodeURIComponent(INSUMOS_ACTION)}`
    : URL
  await page.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: 60_000 })
    await page.waitForTimeout(1500)
    await maybeScreenshot('home')

    // Optional: authenticate to exercise Insumos fetches. We keep it best-effort.
    const auto = await tryAutoLogin()
    if (auto.attempted) {
      console.log(`[insumos-ui-smoke] AUTO_LOGIN attempted: ${auto.ok ? 'OK' : 'FAILED'}`)
      if (auto.ok) {
        try {
          const cookies = await context.cookies()
          consoleLines.push(`[cookies] ${cookies.map((c) => c.name).join(',')}`)
        } catch {}
        await page.reload({ waitUntil: 'domcontentloaded' }).catch(() => {})
        try {
          const authCheck = await page.evaluate(async () => {
            try {
              const res = await fetch('/api/auth/me', { credentials: 'include', headers: { accept: 'application/json' } })
              return { ok: res.ok, status: res.status }
            } catch (err) {
              return { ok: false, status: 0, error: String((err && err.message) || err) }
            }
          })
          consoleLines.push(`[auth/me check] ${JSON.stringify(authCheck)}`)
        } catch {}
      }
      await page.waitForTimeout(2500)
    }

    // Allow the app to settle and fetch initial module data.
    await page.waitForTimeout(WAIT_MS)

    const bodyText = String((await page.textContent('body').catch(() => '')) || '')
    const hasDemoBanner = /DADOS\\s+SIMULADOS|\\bDEMO\\b/i.test(bodyText)
    const hasNoAuthBanner = /NO_AUTH_MODE|Autentica[cç][aã]o\\s+desabilitada/i.test(bodyText)

    const selectionCheck = { attempted: false, selected: false }
    try {
      const insumosHeading = page.getByRole('heading', { name: /insumos/i }).first()
      await insumosHeading.isVisible({ timeout: 8000 }).catch(() => {})
      const searchInput = page.getByPlaceholder('ex: Rennova, preenchedor, 789...')
      const hasSearch = await searchInput.isVisible({ timeout: 2500 }).catch(() => false)
      if (!hasSearch) {
        const entryButton = page.getByRole('button', { name: /entrada/i }).first()
        if (await entryButton.isVisible({ timeout: 2500 }).catch(() => false)) {
          await entryButton.click()
          await page.waitForTimeout(1200)
        }
        if (!(await searchInput.isVisible({ timeout: 800 }).catch(() => false))) {
          await page.evaluate(() => {
            try {
              window.dispatchEvent(new CustomEvent('skincos:insumos:op', { detail: { op: 'ENTRADA' } }))
            } catch {}
          })
          await page.waitForTimeout(1200)
        }
        if (!(await searchInput.isVisible({ timeout: 800 }).catch(() => false))) {
          const modalHint = page.getByText('Preencha os dados para registrar a operação', { exact: false })
          await modalHint.isVisible({ timeout: 1200 }).catch(() => {})
        }
      }
      if (await searchInput.isVisible({ timeout: 2500 }).catch(() => false)) {
        let seed = null
        try {
          seed = await page.evaluate(async () => {
            try {
              const healthRes = await fetch('/api/insumos/health', { credentials: 'include' })
              const healthJson = await healthRes.json().catch(() => null)
              const unidades = Array.isArray(healthJson?.unidades) ? healthJson.unidades : []
              const unidade = unidades[0] || ''
              if (!unidade) return null
              const res = await fetch(`/api/insumos/insumos?unidade=${encodeURIComponent(unidade)}&pagina=1&limite=1`, { credentials: 'include' })
              const json = await res.json().catch(() => null)
              const item = Array.isArray(json?.data) ? json.data[0] : null
              if (!item) return null
              const codes = Array.isArray(item?.codigosBarras) ? item.codigosBarras : []
              return {
                produto: item?.produto || null,
                codigo: item?.codigoBarras || codes[0] || null,
              }
            } catch {
              return null
            }
          })
        } catch {}
        const querySeed = seed?.codigo || seed?.produto || 'a'
        await searchInput.fill(String(querySeed))
        await page.waitForTimeout(900)
        const listContainer = page.getByText('Selecione o produto para lançar a operação:', { exact: false }).locator('..')
        const firstOption = listContainer.locator('button').first()
        if (await firstOption.count()) {
          await firstOption.click()
          await page.waitForTimeout(900)
          selectionCheck.attempted = true
          selectionCheck.selected = await page.getByText('Selecionado', { exact: false }).isVisible().catch(() => false)
        }
      }
    } catch (err) {
      consoleLines.push(`[selection-check] ${String((err && err.message) || err)}`)
    }

    await maybeScreenshot('insumos')

    const result = {
      url: URL,
      at: new Date().toISOString(),
      waitMs: WAIT_MS,
      counts,
      hasDemoBanner,
      hasNoAuthBanner,
      selectionCheck,
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
    if (selectionCheck.attempted && !selectionCheck.selected) throw new Error('Selection card not visible after choosing an item.')
  } finally {
    await browser.close()
  }
}

main().catch((err) => {
  console.error(`[insumos-ui-smoke] FAILED: ${String((err && err.stack) || err)}`)
  process.exitCode = 1
})
