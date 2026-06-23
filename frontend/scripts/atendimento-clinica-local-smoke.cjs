/* eslint-disable no-console */
const fs = require('fs')
const path = require('path')
const { chromium } = require('playwright')

const REPO_ROOT = path.resolve(__dirname, '..', '..')
const ARTIFACT_DIR = path.join(REPO_ROOT, 'output', 'playwright')
fs.mkdirSync(ARTIFACT_DIR, { recursive: true })

const URL = process.env.CRM_URL || 'http://127.0.0.1:5173/?module=atendimento-clinica'
const HEADED = process.env.HEADED === '1' || process.env.HEADED === 'true'
const FULL_ASSETS = process.env.SMOKE_FULL_ASSETS === '1' || process.env.SMOKE_FULL_ASSETS === 'true'
const FULL_PAGE = process.env.SMOKE_FULL_PAGE === '1' || process.env.SMOKE_FULL_PAGE === 'true'
const TIMEOUT_MS = Math.max(5_000, parseInt(String(process.env.TIMEOUT_MS || ''), 10) || 60_000)

function nowStamp() {
  const d = new Date()
  const pad = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`
}

async function expectVisible(locator, label) {
  try {
    await locator.first().waitFor({ state: 'visible', timeout: TIMEOUT_MS })
  } catch {
    throw new Error(`Expected visible: ${label}`)
  }
}

async function main() {
  const stamp = nowStamp()
  const screenshotPath = path.join(ARTIFACT_DIR, `atendimento-clinica-local-${stamp}.png`)
  let browser = null
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
    const context = await browser.newContext({
      viewport: { width: 1440, height: 900 },
      ignoreHTTPSErrors: true,
    })
    if (!HEADED && !FULL_ASSETS) {
      await context.route('**/*', (route) => {
        const type = route.request().resourceType()
        if (type === 'image' || type === 'media' || type === 'font') return route.abort()
        return route.continue()
      })
    }
    const page = await context.newPage()

    const consoleErrors = []
    page.on('console', (msg) => {
      const text = msg.text()
      if (!FULL_ASSETS && /Failed to load resource: net::ERR_FAILED/.test(text)) return
      if (msg.type() === 'error') consoleErrors.push(text)
    })

    await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: TIMEOUT_MS })
    await expectVisible(page.getByRole('heading', { name: 'Atend. Clínica' }), 'Atend. Clínica heading')
    await expectVisible(page.getByTestId('atendimento-table'), 'Atendimentos table')
    await expectVisible(page.getByTestId('atendimento-charts-panel'), 'Atendimento charts panel')
    await expectVisible(page.getByTestId('atendimento-new').or(page.getByText('Novo atendimento')), 'new attendance action')

    const globalError = await page.getByText(/DATABASE_URL_not_configured|ATENDIMENTO_CLINICA_API_TARGET|UPSTREAM_UNREACHABLE/).first().isVisible().catch(() => false)
    if (globalError) {
      throw new Error('Atend. Clínica abriu, mas a API local não está configurada para carregar dados. Configure DATABASE_URL e revise o target local.')
    }

    await page.screenshot({ path: screenshotPath, fullPage: FULL_PAGE })
    await context.close()
    await browser.close()
    browser = null

    if (consoleErrors.length) {
      console.log('[atendimento-clinica-local-smoke] Console errors (first 5):')
      for (const error of consoleErrors.slice(0, 5)) console.log('  -', error)
    }

    console.log(`[atendimento-clinica-local-smoke] OK: ${URL}`)
  } finally {
    if (browser) await browser.close().catch(() => {})
  }
}

main().catch((err) => {
  console.error('[atendimento-clinica-local-smoke] FAIL:', err?.message || err)
  process.exitCode = 1
})
