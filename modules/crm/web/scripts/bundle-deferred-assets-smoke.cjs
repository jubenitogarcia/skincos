/* eslint-disable no-console */
const fs = require('fs')
const os = require('os')
const path = require('path')
const { chromium } = require('playwright')

const appUrl = process.env.CRM_URL || 'http://127.0.0.1:8791/'
const reportPath = process.env.CRM_BUNDLE_SMOKE_REPORT_FILE || path.join(os.tmpdir(), 'skincos-crm-bundle', 'deferred-assets-smoke.json')
const modules = ['atendimento', 'conversa', 'insumos', 'meta-ads']
const specializedChunk = /(?:ponto-tensorflow|ponto-face-api|@tensorflow|@vladmandic\/face-api)/i

async function main() {
  fs.mkdirSync(path.dirname(reportPath), { recursive: true })
  const browser = await chromium.launch({ headless: true })
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } })
  const page = await context.newPage()
  const report = []
  let activeModule = ''
  const requests = new Map()

  page.on('request', (request) => {
    if (!specializedChunk.test(request.url())) return
    if (!requests.has(activeModule)) requests.set(activeModule, [])
    requests.get(activeModule).push(request.url())
  })

  try {
    for (const moduleKey of modules) {
      activeModule = moduleKey
      requests.set(moduleKey, [])
      await page.goto(new URL(`/?module=${moduleKey}`, appUrl).toString(), { waitUntil: 'domcontentloaded', timeout: 90_000 })
      await page.locator(`[data-module-nav="true"][data-module-key="${moduleKey}"][data-module-active="true"]`).waitFor({ state: 'visible', timeout: 30_000 })
      report.push({ module: moduleKey, specializedRequests: requests.get(moduleKey) })
    }
  } finally {
    await browser.close()
  }

  const failures = report.filter((item) => item.specializedRequests.length)
  const payload = { ok: failures.length === 0, appUrl, modules: report, failures }
  fs.writeFileSync(reportPath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8')
  console.log(JSON.stringify({ ...payload, reportPath }, null, 2))
  if (failures.length) process.exitCode = 1
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
