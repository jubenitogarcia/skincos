/* eslint-disable no-console */
const fs = require('fs')
const path = require('path')
const { chromium } = require('playwright')

const url = process.env.CRM_URL || 'http://127.0.0.1:8791/?module=finance'
const scenario = process.env.FINANCE_SCENARIO || 'both'
const artifactDir = process.env.SMOKE_ARTIFACT_DIR || path.join(process.env.CRM_OPERATOR_RUNTIME_ROOT || '/tmp', 'finance-local-smoke')
const reportFile = path.join(artifactDir, `finance-${scenario}-smoke.json`)
const shotFile = path.join(artifactDir, `finance-${scenario}-smoke.png`)
fs.mkdirSync(artifactDir, { recursive: true })

const expectedScopes = { nh: ['Novo Hamburgo'], bss: ['BarraShoppingSul'], both: ['Novo Hamburgo', 'BarraShoppingSul'] }

async function main() {
  const browser = await chromium.launch({ headless: true, args: ['--disable-gpu', '--disable-dev-shm-usage'] })
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } })
  const page = await context.newPage()
  const consoleErrors = []
  const apiErrors = []
  page.on('console', (message) => { if (message.type() === 'error') consoleErrors.push(message.text()) })
  page.on('response', async (response) => {
    if (response.url().includes('/api/finance') && response.status() >= 500) apiErrors.push(`${response.status()} ${response.url()}`)
  })
  try {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 90_000 })
    await page.locator('[data-module-nav="true"]').first().waitFor({ state: 'visible', timeout: 30_000 })
    const financeNav = page.locator('[data-module-nav="true"][data-module-key="finance"]')
    const visible = await financeNav.isVisible().catch(() => false)
    const bootstrap = await page.evaluate(async () => {
      const response = await fetch('/api/finance/bootstrap', { credentials: 'include' })
      return { status: response.status, body: await response.json() }
    })
    if (scenario === 'disabled') {
      if (bootstrap.status !== 200 || bootstrap.body.moduleEnabled !== false || visible) throw new Error('Flag desligada não bloqueou a navegação Financeiro.')
    } else if (scenario === 'no-module') {
      if (bootstrap.status !== 403 || visible) throw new Error('Usuário sem módulo finance não foi bloqueado.')
    } else if (scenario === 'no-grant') {
      if (bootstrap.status !== 200 || bootstrap.body.canAccess !== false || visible) throw new Error('Usuário sem grant não foi bloqueado.')
    } else {
      if (bootstrap.status !== 200 || bootstrap.body.canAccess !== true || !visible) throw new Error('Usuário autorizado não recebeu a aba Financeiro.')
      await financeNav.click()
      await page.getByRole('heading', { name: 'Financeiro' }).waitFor({ state: 'visible', timeout: 30_000 })
      const grants = bootstrap.body.grants || []
      const labels = grants.map((grant) => grant.label)
      if (JSON.stringify(labels) !== JSON.stringify(expectedScopes[scenario])) throw new Error(`Grants divergentes: ${JSON.stringify(labels)}`)
      if (grants.some((grant) => grant.kind === 'personal')) throw new Error('Contexto pessoal foi exposto no bootstrap local.')
    }
    if (consoleErrors.length || apiErrors.length) throw new Error(`Erros de runtime: ${JSON.stringify({ consoleErrors, apiErrors })}`)
    await page.screenshot({ path: shotFile, fullPage: false })
    fs.writeFileSync(reportFile, `${JSON.stringify({ ok: true, url, scenario, bootstrap, screenshot: shotFile }, null, 2)}\n`)
    console.log(`[finance-local-smoke] OK (${scenario}): ${url}`)
  } catch (error) {
    await page.screenshot({ path: shotFile, fullPage: false }).catch(() => {})
    fs.writeFileSync(reportFile, `${JSON.stringify({ ok: false, url, scenario, error: String(error?.message || error), consoleErrors, apiErrors, screenshot: shotFile }, null, 2)}\n`)
    throw error
  } finally {
    await context.close().catch(() => {})
    await browser.close().catch(() => {})
  }
}

main().catch((error) => { console.error('[finance-local-smoke] FAIL:', error?.message || error); process.exitCode = 1 })
