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
  const financeResponses = []
  let recoveredFinanceRateLimits = 0
  page.on('console', (message) => { if (message.type() === 'error') consoleErrors.push(message.text()) })
  page.on('response', async (response) => {
    if (response.url().includes('/api/finance')) {
      financeResponses.push(`${response.status()} ${response.url()}`)
      if (response.status() >= 500) apiErrors.push(`${response.status()} ${response.url()}`)
    }
  })
  try {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 90_000 })
    await page.locator('[data-module-nav="true"]').first().waitFor({ state: 'visible', timeout: 30_000 })
    const financeNav = page.locator('[data-module-nav="true"][data-module-key="finance"]')
    const bootstrap = await page.evaluate(async () => {
      const response = await fetch('/api/finance/bootstrap', { credentials: 'include' })
      const auth = await fetch('/api/auth/me', { credentials: 'include' })
      return { status: response.status, body: await response.json(), authStatus: auth.status, authBody: await auth.json().catch(() => null) }
    })
    if (scenario === 'disabled') {
      // App asks the same bootstrap endpoint asynchronously before it removes
      // the entry.  Wait for the state transition instead of observing the
      // first paint, which can still contain the pre-bootstrap navigation.
      await financeNav.waitFor({ state: 'hidden', timeout: 30_000 })
      if (bootstrap.status !== 200 || bootstrap.body.moduleEnabled !== false || bootstrap.body.canAccess !== false) throw new Error(`Flag desligada não bloqueou a navegação Financeiro: ${JSON.stringify({ status: bootstrap.status, body: bootstrap.body })}`)
    } else if (scenario === 'no-module') {
      await financeNav.waitFor({ state: 'hidden', timeout: 30_000 })
      if (bootstrap.status !== 403) throw new Error('Usuário sem módulo finance não foi bloqueado.')
    } else if (scenario === 'no-grant') {
      await financeNav.waitFor({ state: 'hidden', timeout: 30_000 })
      if (bootstrap.status !== 200 || bootstrap.body.canAccess !== false) throw new Error('Usuário sem grant não foi bloqueado.')
    } else {
      if (bootstrap.status !== 200 || bootstrap.body.canAccess !== true || bootstrap.body.moduleEnabled !== true) {
        throw new Error(`Bootstrap Financeiro autorizado falhou: ${bootstrap.status}`)
      }
      await financeNav.waitFor({ state: 'visible', timeout: 30_000 })
      const visible = await financeNav.isVisible()
      if (bootstrap.status !== 200 || bootstrap.body.canAccess !== true || !visible) throw new Error('Usuário autorizado não recebeu a aba Financeiro.')
      await financeNav.click()
      await page.getByTestId('crm-header-layout').getByRole('heading', { name: 'Financeiro' }).waitFor({ state: 'visible', timeout: 30_000 })
      await page.getByRole('tab', { name: 'Visão geral' }).waitFor({ state: 'visible', timeout: 30_000 })
      await page.getByRole('tab', { name: 'Movimentações' }).click()
      await page.getByText(/Movimentações|Nenhuma movimentação/).first().waitFor({ state: 'visible', timeout: 30_000 })
      await page.getByRole('tab', { name: 'Títulos' }).click()
      await page.getByText('Títulos a pagar e receber').waitFor({ state: 'visible', timeout: 30_000 })
      await page.getByRole('tab', { name: 'Cadastros' }).click()
      await page.getByText('Contas financeiras').first().waitFor({ state: 'visible', timeout: 30_000 })
      const grants = bootstrap.body.grants || []
      const labels = grants.map((grant) => grant.label).sort()
      const expectedLabels = [...expectedScopes[scenario]].sort()
      if (JSON.stringify(labels) !== JSON.stringify(expectedLabels)) throw new Error(`Grants divergentes: ${JSON.stringify(labels)}`)
      if (grants.some((grant) => grant.kind === 'personal')) throw new Error('Contexto pessoal foi exposto no bootstrap local.')

      // The import smoke creates only ephemeral local domain records through
      // the same authenticated Pages proxy used by the UI.
      const seed = await page.evaluate(async (firstScopeId) => {
        const suffix = Date.now().toString(36)
        const post = async (path, body, key) => {
          const response = await fetch(`/api/finance${path}`, { method: 'POST', credentials: 'include', headers: { 'content-type': 'application/json', 'idempotency-key': key, 'x-csrf-token': 'finance-local-csrf' }, body: JSON.stringify(body) })
          const payload = await response.json(); if (!response.ok) throw new Error(`${path}: ${response.status} ${payload.message || payload.error}`); return payload
        }
        const account = await post(`/accounts?scopeId=${firstScopeId}`, { name: `Smoke Banco ${suffix}`, type: 'bank', currency: 'BRL' }, `smoke-account-${suffix}`)
        const income = await post(`/categories?scopeId=${firstScopeId}`, { name: `Smoke Receita ${suffix}`, direction: 'income' }, `smoke-income-${suffix}`)
        const expense = await post(`/categories?scopeId=${firstScopeId}`, { name: `Smoke Despesa ${suffix}`, direction: 'expense' }, `smoke-expense-${suffix}`)
        return { account: account.account.name, income: income.category.name, expense: expense.category.name }
      }, bootstrap.body.grants[0].scope_id)
      await page.getByRole('button', { name: 'Importar CSV' }).click()
      await page.locator('label').filter({ hasText: 'Origem do arquivo' }).getByRole('combobox').click()
      await page.getByRole('option', { name: 'MoneyWiz' }).click()
      const csvSuffix = Date.now().toString(36)
      const csv = `Date,Description,Amount,Account,Category,Payee,Tags,Memo,Status,Currency,Transfers,Transaction ID\n2026-07-01,Consulta São José,1250.50,Banco,Receitas,Paciente Smoke,clínica,UTF-8,cleared,BRL,,smoke-${csvSuffix}\n2026-07-01,Consulta São José,1250.50,Banco,Receitas,Paciente Smoke,clínica,UTF-8,cleared,BRL,,smoke-${csvSuffix}\n`
      await page.getByLabel('Arquivo CSV').setInputFiles({ name: 'extrato-br.csv', mimeType: 'text/csv', buffer: Buffer.from(csv, 'utf8') })
      await page.getByRole('button', { name: 'Criar lote' }).click()
      const analysisButton = page.getByRole('button', { name: 'Analisar e pré-visualizar' })
      const rateLimited = page.getByText('FINANCE_RATE_LIMITED')
      const firstStep = await Promise.race([
        analysisButton.waitFor({ state: 'visible', timeout: 30_000 }).then(() => 'ready'),
        rateLimited.waitFor({ state: 'visible', timeout: 30_000 }).then(() => 'rate-limited'),
      ])
      if (firstStep === 'rate-limited') {
        // The local D1/DO state is intentionally persisted between launcher
        // runs. Respect its real 60-second import window once, then retry the
        // idempotent staging action instead of disabling the production guard.
        await page.waitForTimeout(60_000)
        await page.getByRole('button', { name: 'Criar lote' }).click()
        recoveredFinanceRateLimits += 1
      }
      await analysisButton.waitFor({ state: 'visible', timeout: 30_000 })
      await analysisButton.click()
      await page.locator('label').filter({ hasText: 'Conta de destino' }).getByRole('combobox').click()
      await page.getByRole('option', { name: seed.account }).click()
      await page.locator('label').filter({ hasText: 'Categoria padrão de receita' }).getByRole('combobox').click()
      await page.getByRole('option', { name: seed.income }).click()
      await page.locator('label').filter({ hasText: 'Categoria padrão de despesa' }).getByRole('combobox').click()
      await page.getByRole('option', { name: seed.expense }).click()
      await page.getByRole('button', { name: 'Importar' }).first().click()
      await page.getByRole('button', { name: 'Ignorar' }).last().click()
      await page.getByRole('button', { name: 'Revisar confirmação' }).click()
      await page.getByRole('button', { name: 'Confirmar importação' }).click()
      await page.getByText('Resultado auditável').waitFor({ state: 'visible', timeout: 30_000 })
      await page.getByRole('button', { name: 'Desfazer por estorno auditável' }).click()
      const undoResult = page.getByText(/foram estornados por operação compensatória/)
      const undoStep = await Promise.race([
        undoResult.waitFor({ state: 'visible', timeout: 30_000 }).then(() => 'ready'),
        rateLimited.waitFor({ state: 'visible', timeout: 30_000 }).then(() => 'rate-limited'),
      ])
      if (undoStep === 'rate-limited') {
        await page.waitForTimeout(60_000)
        await page.getByRole('button', { name: 'Desfazer por estorno auditável' }).click()
        recoveredFinanceRateLimits += 1
      }
      await undoResult.waitFor({ state: 'visible', timeout: 30_000 })
    }
    let toleratedRateLimitWarnings = recoveredFinanceRateLimits
    const relevantConsoleErrors = consoleErrors.filter((message) => {
      if (toleratedRateLimitWarnings > 0 && /server responded with a status of 429/i.test(message)) { toleratedRateLimitWarnings -= 1; return false }
      // A user without the explicit module grant receives a deliberately
      // fail-closed bootstrap response. Browsers log that expected 403 as a
      // resource error even though the shell correctly hides the module.
      if (scenario === 'no-module' && /server responded with a status of 403/i.test(message)) return false
      return true
    })
    if (relevantConsoleErrors.length || apiErrors.length) throw new Error(`Erros de runtime: ${JSON.stringify({ consoleErrors: relevantConsoleErrors, apiErrors })}`)
    await page.screenshot({ path: shotFile, fullPage: false })
    fs.writeFileSync(reportFile, `${JSON.stringify({ ok: true, url, scenario, bootstrap, financeResponses, screenshot: shotFile }, null, 2)}\n`)
    console.log(`[finance-local-smoke] OK (${scenario}): ${url}`)
  } catch (error) {
    await page.screenshot({ path: shotFile, fullPage: false }).catch(() => {})
    fs.writeFileSync(reportFile, `${JSON.stringify({ ok: false, url, scenario, error: String(error?.message || error), consoleErrors, apiErrors, financeResponses, screenshot: shotFile }, null, 2)}\n`)
    throw error
  } finally {
    await context.close().catch(() => {})
    await browser.close().catch(() => {})
  }
}

main().catch((error) => { console.error('[finance-local-smoke] FAIL:', error?.message || error); process.exitCode = 1 })
