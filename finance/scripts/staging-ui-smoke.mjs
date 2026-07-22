#!/usr/bin/env node
/**
 * Authenticated, deliberately staging-only CRM Finance smoke.
 *
 * Credentials are supplied by the operator at runtime and never persisted.
 * The script is read-only against Finance: operational mutations belong to
 * the separate controlled import/API smokes.
 */
import fs from 'node:fs'
import { createRequire } from 'node:module'
import os from 'node:os'
import path from 'node:path'
import process from 'node:process'

const require = createRequire(import.meta.url)
const { chromium } = require('../../crm/console/node_modules/playwright')

const stagingOrigin = 'https://skincos-staging.pages.dev'
const baseUrl = new URL(process.env.FINANCE_STAGING_UI_URL || `${stagingOrigin}/?module=finance`)
const username = String(process.env.FINANCE_STAGING_SMOKE_USERNAME || '').trim()
const password = String(process.env.FINANCE_STAGING_SMOKE_PASSWORD || '')
const artifactDir = process.env.FINANCE_SMOKE_ARTIFACT_DIR || path.join(os.tmpdir(), 'skincos-finance-staging-smoke')

if (process.env.FINANCE_STAGING_SMOKE_ACK !== '1') {
  throw new Error('Defina FINANCE_STAGING_SMOKE_ACK=1 para executar o smoke autenticado de staging.')
}
if (baseUrl.origin !== stagingOrigin) {
  throw new Error(`O smoke aceita apenas ${stagingOrigin}; origem recebida: ${baseUrl.origin}`)
}
if (!username || !password) {
  throw new Error('FINANCE_STAGING_SMOKE_USERNAME e FINANCE_STAGING_SMOKE_PASSWORD são obrigatórios.')
}

fs.mkdirSync(artifactDir, { recursive: true })
const screenshot = path.join(artifactDir, 'finance-staging-ui.png')
const report = path.join(artifactDir, 'finance-staging-ui.json')

function fail(message) {
  throw new Error(message)
}

const browser = await chromium.launch({ headless: true, args: ['--disable-gpu', '--disable-dev-shm-usage'] })
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } })
const page = await context.newPage()
const consoleErrors = []
const financeResponses = []
const serverErrors = []

page.on('console', (message) => {
  if (message.type() === 'error') consoleErrors.push(message.text())
})
page.on('response', (response) => {
  const target = new URL(response.url())
  const evidence = `${response.status()} ${target.pathname}`
  if (target.pathname.includes('/api/finance/')) financeResponses.push(evidence)
  if (response.status() >= 500) serverErrors.push(evidence)
})

let bootstrap = null
try {
  console.log('[finance-staging-ui] carregando CRM de staging')
  await page.goto(baseUrl.toString(), { waitUntil: 'domcontentloaded', timeout: 90_000 })
  await page.locator('#auth-email').fill(username)
  await page.locator('#auth-password').fill(password)
  await page.locator('form').getByRole('button', { name: 'Acessar CRM' }).click()
  await page.locator('[data-module-nav="true"]').first().waitFor({ state: 'visible', timeout: 45_000 })
  // The unauthenticated bootstrap request on the initial login screen is
  // expected. Only errors after the authenticated shell are meaningful here.
  consoleErrors.length = 0
  console.log('[finance-staging-ui] sessão CRM confirmada')

  bootstrap = await page.evaluate(async () => {
    const response = await fetch('/api/finance/bootstrap', { credentials: 'include' })
    return { status: response.status, body: await response.json() }
  })
  if (bootstrap.status !== 200 || bootstrap.body?.moduleEnabled !== true || bootstrap.body?.canAccess !== true) {
    fail(`Bootstrap Financeiro autorizado falhou: ${bootstrap.status}`)
  }
  const labels = (bootstrap.body?.grants || []).map((grant) => grant.label).sort()
  if (JSON.stringify(labels) !== JSON.stringify(['BarraShoppingSul', 'Novo Hamburgo'])) {
    fail(`Grants empresariais inesperados: ${JSON.stringify(labels)}`)
  }
  if ((bootstrap.body?.grants || []).some((grant) => grant.kind === 'personal')) {
    fail('O contexto pessoal foi exposto no bootstrap.')
  }

  const financeNav = page.locator('[data-module-nav="true"][data-module-key="finance"]')
  await financeNav.waitFor({ state: 'visible', timeout: 30_000 })
  await financeNav.click()
  await page.getByTestId('crm-header-layout').getByRole('heading', { name: 'Financeiro' }).waitFor({ state: 'visible', timeout: 30_000 })
  console.log('[finance-staging-ui] módulo Financeiro renderizado')
  await page.getByRole('tab', { name: 'Visão geral' }).waitFor({ state: 'visible', timeout: 30_000 })
  await page.getByRole('tab', { name: 'Visão geral' }).click()
  await page.getByText('Contas e saldos').waitFor({ state: 'visible', timeout: 30_000 })
  await page.locator('[data-finance-module] [role="combobox"]').first().click()
  await page.getByRole('option', { name: 'BarraShoppingSul' }).click()
  await page.getByText('Contas e saldos').waitFor({ state: 'visible', timeout: 30_000 })
  await page.getByRole('button', { name: 'Atualizar' }).waitFor({ state: 'visible', timeout: 30_000 })
  await page.waitForTimeout(250)
  await page.getByRole('tab', { name: 'Movimentações' }).click()
  await page.getByText(/Movimentações|Nenhuma movimentação/).first().waitFor({ state: 'visible', timeout: 30_000 })
  await page.getByRole('tab', { name: 'Cadastros' }).click()
  await page.getByText('Contas financeiras').first().waitFor({ state: 'visible', timeout: 30_000 })
  await page.screenshot({ path: screenshot, fullPage: false })
  if (financeResponses.some((response) => /^5\d\d\b/.test(response))) fail(`Erro de serviço Financeiro: ${JSON.stringify(financeResponses)}`)
  fs.writeFileSync(report, `${JSON.stringify({ ok: true, url: baseUrl.toString(), bootstrap, financeResponses, serverErrors, consoleErrors, screenshot }, null, 2)}\n`)
  console.log(JSON.stringify({ ok: true, url: baseUrl.toString(), grants: labels, financeResponses, serverErrors, screenshot }))
} catch (error) {
  await page.screenshot({ path: screenshot, fullPage: false }).catch(() => {})
  fs.writeFileSync(report, `${JSON.stringify({ ok: false, url: baseUrl.toString(), error: String(error?.message || error), bootstrap, consoleErrors, financeResponses, serverErrors, screenshot }, null, 2)}\n`)
  throw error
} finally {
  await context.close().catch(() => {})
  await browser.close().catch(() => {})
}
