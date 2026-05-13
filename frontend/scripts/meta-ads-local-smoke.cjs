/* eslint-disable no-console */
const fs = require('fs')
const path = require('path')
const { chromium } = require('playwright')

const REPO_ROOT = path.resolve(__dirname, '..', '..')
const ARTIFACT_DIR = path.join(REPO_ROOT, 'output', 'playwright')
fs.mkdirSync(ARTIFACT_DIR, { recursive: true })

const SCENARIO = process.env.META_ADS_LOCAL_SCENARIO || 'connected-ready'
const HEADED = process.env.HEADED === '1' || process.env.HEADED === 'true'
const TIMEOUT_MS = Math.max(5000, parseInt(String(process.env.TIMEOUT_MS || ''), 10) || 60000)
const URL =
  process.env.CRM_URL ||
  `http://127.0.0.1:8791/?module=meta-ads&metaAdsLocalScenario=${encodeURIComponent(SCENARIO)}`

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
  const screenshotPath = path.join(ARTIFACT_DIR, `meta-ads-local-${SCENARIO}-${stamp}.png`)
  const browser = await chromium.launch({ headless: !HEADED })
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    ignoreHTTPSErrors: true,
  })
  const page = await context.newPage()

  await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: TIMEOUT_MS })
  await expectVisible(page.getByRole('heading', { name: 'Meta Ads' }), 'Meta Ads heading')

  if (SCENARIO === 'connected-ready') {
    await expectVisible(page.getByText('Conta Meta pronta para operar'), 'connected ready banner')
    await expectVisible(page.getByText('Conta ativa: Conta Principal'), 'selected account')
    await expectVisible(page.getByRole('tab', { name: 'Visão geral' }), 'overview tab')
    await page.getByRole('tab', { name: 'Inventário' }).click()
    await expectVisible(page.getByText('Campanha Primavera'), 'inventory campaign')
  } else if (SCENARIO === 'unauthorized') {
    await expectVisible(page.getByText('Faça login no CRM para continuar'), 'unauthorized message')
    await expectVisible(page.getByText('UNAUTHORIZED · HTTP 401'), 'unauthorized code')
  } else {
    await expectVisible(page.getByRole('button', { name: 'Conectar com Facebook' }), 'connect button')
  }

  await page.screenshot({ path: screenshotPath, fullPage: true })
  await context.close()
  await browser.close()
  console.log(`[meta-ads-local-smoke] OK: ${URL}`)
}

main().catch((err) => {
  console.error('[meta-ads-local-smoke] FAIL:', err?.message || err)
  process.exitCode = 1
})
