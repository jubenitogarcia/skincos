/* eslint-disable no-console */
const fs = require('fs')
const path = require('path')
const { chromium } = require('playwright')

const REPO_ROOT = path.resolve(__dirname, '..', '..')
const ARTIFACT_DIR = process.env.SMOKE_ARTIFACT_DIR
  ? path.resolve(process.env.SMOKE_ARTIFACT_DIR)
  : path.join(REPO_ROOT, 'output', 'playwright')
const REPORT_FILE = process.env.CRM_SMOKE_REPORT_FILE
  ? path.resolve(process.env.CRM_SMOKE_REPORT_FILE)
  : path.join(ARTIFACT_DIR, 'crm-local-smoke-report.json')

fs.mkdirSync(ARTIFACT_DIR, { recursive: true })
fs.mkdirSync(path.dirname(REPORT_FILE), { recursive: true })

const APP_URL = process.env.CRM_URL || 'http://127.0.0.1:8791/'
const HEADED = process.env.HEADED === '1' || process.env.HEADED === 'true'
const FULL_ASSETS = process.env.SMOKE_FULL_ASSETS === '1' || process.env.FULL_ASSETS === '1'
const FULL_PAGE = process.env.SMOKE_FULL_PAGE === '1' || process.env.FULL_PAGE === '1'
const TIMEOUT_MS = Math.max(5_000, parseInt(String(process.env.TIMEOUT_MS || ''), 10) || 90_000)
const MODULE_READY_TIMEOUT_MS = Math.max(10_000, Math.min(TIMEOUT_MS, parseInt(String(process.env.CRM_LOCAL_MODULE_READY_TIMEOUT_MS || ''), 10) || 30_000))
const MODULE_SETTLE_MS = Math.max(900, parseInt(String(process.env.CRM_LOCAL_MODULE_SETTLE_MS || ''), 10) || 1_500)
const MAX_REQUESTS_PER_ENDPOINT = Math.max(3, parseInt(String(process.env.CRM_SMOKE_MAX_REQUESTS_PER_ENDPOINT || ''), 10) || 12)

function nowStamp() {
  const d = new Date()
  const pad = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`
}

function moduleRoute(key) {
  return `/?module=${encodeURIComponent(key)}`
}

function moduleUrl(key) {
  return new globalThis.URL(moduleRoute(key), APP_URL).toString()
}

function stripAnsi(value) {
  return String(value || '').replace(/\u001b\[[0-9;]*m/g, '')
}

function classifyFailure(details) {
  const haystack = [
    String(details.activationError || ''),
    ...(details.apiErrors || []).map((item) => `${item.status} ${item.url} ${item.body || ''}`),
    ...(details.consoleErrors || []),
    ...(details.pageErrors || []),
    ...(details.requestStorms || []).map((item) => `${item.endpoint} ${item.count}/${item.limit}`),
  ].join('\n')

  if ((details.requestStorms || []).length > 0) {
    return {
      diagnosis: 'O módulo disparou requisições repetidas ao mesmo endpoint durante a janela de estabilização.',
      recommendation: 'corrigir contrato',
    }
  }

  if (/SHARE_BUCKET|INTEGRATIONS_ENCRYPTION_SECRET_REQUIRED/i.test(haystack)) {
    return {
      diagnosis: 'Preflight local de Instagram/Social caiu no handler real sem bindings locais suficientes.',
      recommendation: 'corrigir contrato',
    }
  }
  if (/ACTOR_SIGNATURE_INVALID|ESCALA_ACTOR_HMAC_KEY|ATENDIMENTO_ACTOR_HMAC_KEY/i.test(haystack)) {
    return {
      diagnosis: 'Assinatura HMAC ou contrato do proxy local está desalinhado com o módulo exposto.',
      recommendation: 'corrigir contrato',
    }
  }
  if (/client password must be a string|DATABASE_URL|SCRAM-SERVER-FIRST-MESSAGE/i.test(haystack)) {
    return {
      diagnosis: 'O backend compartilhado do módulo depende de um DATABASE_URL incompatível com o Postgres local.',
      recommendation: 'corrigir contrato',
    }
  }
  if (/Timeout .*data-module-active|Expected visible: CRM module navigation|Target page, context or browser has been closed/i.test(haystack)) {
    return {
      diagnosis: 'O módulo ficou preso na navegação/renderização do shell local e não estabilizou dentro do timeout.',
      recommendation: 'bloquear modulo localmente',
    }
  }
  if (/(UNAUTHORIZED|FORBIDDEN|401|403)/i.test(haystack)) {
    return {
      diagnosis: 'O módulo exposto exige um fluxo de auth ou autorização que o shell local não está cumprindo.',
      recommendation: 'bloquear modulo localmente',
    }
  }
  return {
    diagnosis: 'O módulo exposto falhou no shell local por erro estrutural ainda não homologado.',
    recommendation: 'implementar',
  }
}

function buildReport(modules, extra) {
  const failingModules = modules.filter((item) => !item.ok)
  const requestStorms = modules.flatMap((item) =>
    (item.requestStorms || []).map((storm) => ({ module: item.key, ...storm })),
  )
  return {
    ok: failingModules.length === 0,
    timestamp: new Date().toISOString(),
    url: APP_URL,
    totalModules: modules.length,
    failingModules: failingModules.length,
    requestStorms,
    modules,
    ...extra,
  }
}

function writeReport(report) {
  fs.writeFileSync(REPORT_FILE, `${JSON.stringify(report, null, 2)}\n`, 'utf8')
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
  const finalShot = path.join(ARTIFACT_DIR, `crm-local-shell-${stamp}.png`)

  let browser = null
  let context = null
  let page = null
  let activeModule = 'bootstrap'
  const pendingResponseReads = []
  const responseMap = new Map()
  const requestCountMap = new Map()
  const consoleMap = new Map()
  const pageErrorMap = new Map()

  const pushModuleEntry = (map, moduleKey, value) => {
    if (!map.has(moduleKey)) map.set(moduleKey, [])
    map.get(moduleKey).push(value)
  }

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
        '--disable-background-networking',
        '--disable-component-update',
        '--disable-sync',
        '--no-first-run',
        '--mute-audio',
        ...(HEADED ? [] : ['--disable-gpu', '--use-angle=swiftshader']),
      ],
    })

    context = await browser.newContext({
      viewport: { width: 1440, height: 900 },
      ignoreHTTPSErrors: true,
    })

    page = await context.newPage()
    page.on('console', (msg) => {
      if (msg.type() !== 'error') return
      const text = stripAnsi(msg.text())
      if (!FULL_ASSETS && /Failed to load resource: net::ERR_FAILED/i.test(text)) return
      pushModuleEntry(consoleMap, activeModule, text)
    })
    page.on('pageerror', (error) => {
      pushModuleEntry(pageErrorMap, activeModule, stripAnsi(error?.message || String(error)))
    })
    page.on('response', (response) => {
      const url = response.url()
      if (!url.includes('/api/')) return
      if (response.status() < 400) return
      const moduleKey = activeModule
      pendingResponseReads.push(
        response
          .text()
          .catch(() => '')
          .then((body) => {
            pushModuleEntry(responseMap, moduleKey, {
              status: response.status(),
              statusText: response.statusText(),
              url,
              body: stripAnsi(body).slice(0, 400),
            })
          }),
      )
    })
    page.on('request', (request) => {
      const rawUrl = request.url()
      if (!rawUrl.includes('/api/')) return
      let endpoint = rawUrl
      try {
        endpoint = new globalThis.URL(rawUrl).pathname
      } catch {
        // Keep the raw URL when the browser reports a non-standard request URL.
      }
      if (!requestCountMap.has(activeModule)) requestCountMap.set(activeModule, new Map())
      const moduleCounts = requestCountMap.get(activeModule)
      moduleCounts.set(endpoint, (moduleCounts.get(endpoint) || 0) + 1)
    })

    await page.goto(APP_URL, { waitUntil: 'domcontentloaded', timeout: TIMEOUT_MS })
    await expectVisible(page.locator('[data-module-nav="true"]'), 'CRM module navigation')

    const fatalBootError = page.getByText(/Erro de Inicialização|This spark has encountered a runtime error|Dependência Crítica|Servidor Indisponível/)
    if (await fatalBootError.first().isVisible().catch(() => false)) {
      throw new Error('O CRM local entrou em tela fatal de boot/runtime antes da verificação dos módulos.')
    }

    let modules = await page.locator('[data-module-nav="true"]:not([disabled])').evaluateAll((items) =>
      items.map((item) => ({
        key: item.getAttribute('data-module-key') || '',
        label: item.getAttribute('data-module-label') || item.getAttribute('aria-label') || '',
      })),
    )
    modules = modules.filter((item) => item.key && item.label)

    const initialActive = await page.locator('[data-module-nav="true"][data-module-active="true"]').getAttribute('data-module-key').catch(() => null)
    if (initialActive) activeModule = initialActive
    await page.waitForTimeout(MODULE_SETTLE_MS)

    const results = []
    for (const moduleInfo of modules) {
      const { key, label } = moduleInfo
      activeModule = key
      let activationError = ''
      try {
        await page.evaluate((moduleKey) => {
          localStorage.setItem('app.activeModule', moduleKey)
        }, key)
        await page.goto(moduleUrl(key), { waitUntil: 'domcontentloaded', timeout: TIMEOUT_MS })
        await expectVisible(page.locator('[data-module-nav="true"]'), 'CRM module navigation')
        const moduleNav = page.locator(`[data-module-nav="true"][data-module-key="${key}"]`)
        await moduleNav.waitFor({
          state: 'visible',
          timeout: MODULE_READY_TIMEOUT_MS,
        })
        const activeModuleNav = page.locator(`[data-module-nav="true"][data-module-key="${key}"][data-module-active="true"]`)
        const becameActiveFromUrl = await activeModuleNav.isVisible({ timeout: Math.min(MODULE_READY_TIMEOUT_MS, 5_000) }).catch(() => false)
        if (!becameActiveFromUrl) {
          await moduleNav.evaluate((element) => element.click())
        }
        await activeModuleNav.waitFor({ state: 'visible', timeout: MODULE_READY_TIMEOUT_MS })
        await page.waitForTimeout(MODULE_SETTLE_MS)
      } catch (error) {
        activationError = stripAnsi(error?.message || String(error))
      }

      const runtimeScreenVisible = await page
        .getByText(/Erro de Inicialização|This spark has encountered a runtime error|Tempo Limite Excedido/)
        .first()
        .isVisible()
        .catch(() => false)

      await Promise.allSettled(pendingResponseReads.splice(0))
      const apiErrors = responseMap.get(key) || []
      const consoleErrors = consoleMap.get(key) || []
      const pageErrors = pageErrorMap.get(key) || []
      const requestCounts = Object.fromEntries(requestCountMap.get(key) || [])
      const requestStorms = Object.entries(requestCounts)
        .filter(([, count]) => count > MAX_REQUESTS_PER_ENDPOINT)
        .map(([endpoint, count]) => ({ endpoint, count, limit: MAX_REQUESTS_PER_ENDPOINT }))
      const ok = !activationError && !runtimeScreenVisible && apiErrors.length === 0 && consoleErrors.length === 0 && pageErrors.length === 0 && requestStorms.length === 0
      const classification = ok
        ? { diagnosis: 'Módulo validado sem erro estrutural aparente no shell local.', recommendation: 'corrigir contrato' }
        : classifyFailure({ activationError, apiErrors, consoleErrors, pageErrors, requestStorms })

      results.push({
        key,
        label,
        route: moduleRoute(key),
        ok,
        activationError,
        runtimeScreenVisible,
        apiErrors,
        consoleErrors: consoleErrors.slice(0, 5),
        pageErrors: pageErrors.slice(0, 5),
        requestCounts,
        requestStorms,
        diagnosis: classification.diagnosis,
        recommendation: classification.recommendation,
      })
    }

    await Promise.allSettled(pendingResponseReads)
    const report = buildReport(results, {
      artifactDir: ARTIFACT_DIR,
      reportFile: REPORT_FILE,
    })
    await page.screenshot({ path: finalShot, fullPage: FULL_PAGE })
    report.finalScreenshot = finalShot
    writeReport(report)

    if (!report.ok) {
      console.error(`[crm-local-smoke] FAIL: ${report.failingModules}/${report.totalModules} módulos falharam no shell local.`)
      for (const moduleResult of report.modules.filter((item) => !item.ok)) {
        const firstApi = moduleResult.apiErrors[0]
        const firstConsole = moduleResult.consoleErrors[0]
        const detail = firstApi
          ? `${firstApi.status} ${firstApi.url}`
          : (firstConsole || moduleResult.pageErrors[0] || (moduleResult.requestStorms[0]
            ? `${moduleResult.requestStorms[0].count}x ${moduleResult.requestStorms[0].endpoint}`
            : 'erro estrutural'))
        console.error(`  - ${moduleResult.label} (${moduleResult.key}): ${detail}`)
      }
      console.error(`[crm-local-smoke] Report: ${REPORT_FILE}`)
      process.exitCode = 1
      return
    }

    console.log(`[crm-local-smoke] OK: ${APP_URL}`)
    console.log(`[crm-local-smoke] Report: ${REPORT_FILE}`)
  } finally {
    if (context) await context.close().catch(() => {})
    if (browser) await browser.close().catch(() => {})
  }
}

main().catch((err) => {
  const report = {
    ...buildReport([], {
      artifactDir: ARTIFACT_DIR,
      reportFile: REPORT_FILE,
    }),
    ok: false,
    failingModules: 1,
    bootstrapError: stripAnsi(err?.message || String(err)),
  }
  writeReport(report)
  console.error('[crm-local-smoke] FAIL:', err?.message || err)
  console.error(`[crm-local-smoke] Report: ${REPORT_FILE}`)
  process.exitCode = 1
})
