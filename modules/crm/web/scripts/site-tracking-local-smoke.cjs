/* eslint-disable no-console */
const fs = require('fs')
const path = require('path')
const { chromium } = require('playwright')

const REPO_ROOT = path.resolve(__dirname, '..', '..')
const ARTIFACT_DIR = path.join(REPO_ROOT, 'output', 'playwright')
fs.mkdirSync(ARTIFACT_DIR, { recursive: true })

const SCENARIO = process.env.META_ADS_LOCAL_SCENARIO || 'connected-ready'
const HEADED = process.env.HEADED === '1' || process.env.HEADED === 'true'
const FULL_ASSETS = process.env.SMOKE_FULL_ASSETS === '1' || process.env.FULL_ASSETS === '1'
const FULL_PAGE = process.env.SMOKE_FULL_PAGE === '1' || process.env.FULL_PAGE === '1'
const TIMEOUT_MS = Math.max(5000, parseInt(String(process.env.TIMEOUT_MS || ''), 10) || 60000)
const URL =
  process.env.CRM_URL ||
  `http://127.0.0.1:8791/?module=site-tracking&metaAdsLocalScenario=${encodeURIComponent(SCENARIO)}`

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
  const screenshotPath = path.join(ARTIFACT_DIR, `site-tracking-local-${SCENARIO}-${stamp}.png`)
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
      viewport: { width: 1440, height: 900 },
      ignoreHTTPSErrors: true,
    })
    if (!HEADED && !FULL_ASSETS) {
      await context.route('**/*', async (route) => {
        const type = route.request().resourceType()
        if (type === 'image' || type === 'media' || type === 'font') return route.abort()
        return route.continue()
      })
    }
    const page = await context.newPage()

    await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: TIMEOUT_MS })
    await expectVisible(page.getByText('Site EF').or(page.getByText('Acompanhamento do site')), 'Site EF module')
    await expectVisible(page.getByRole('combobox'), 'site selector')
    await expectVisible(page.getByText('URLs personalizadas'), 'custom URLs section')
    await expectVisible(page.getByText('Funil do site'), 'site funnel section')

    await page.screenshot({ path: screenshotPath, fullPage: FULL_PAGE })
    console.log(`[site-tracking-local-smoke] OK: ${URL}`)
  } finally {
    if (context) await context.close().catch(() => {})
    if (browser) await browser.close().catch(() => {})
  }
}

main().catch((err) => {
  console.error('[site-tracking-local-smoke] FAIL:', err?.message || err)
  process.exitCode = 1
})
