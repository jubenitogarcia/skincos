/*
 * Synthetic authenticated Ponto staging journey. Credentials and the PIN stay
 * in a runner-private fixture; the emitted report contains only booleans,
 * status codes and request-id presence.
 */
const fs = require('fs')
const path = require('path')

const validatedStagingOrigin = (value) => {
  let candidate
  try { candidate = new URL(String(value || '')) } catch { throw new Error('PONTO_STAGING_CRM_URL must be a valid immutable staging URL.') }
  if (candidate.protocol !== 'https:' || !candidate.hostname.endsWith('.skincos-staging.pages.dev') || candidate.port || candidate.username || candidate.password || candidate.pathname !== '/' || candidate.search || candidate.hash) {
    throw new Error('PONTO_STAGING_CRM_URL must be an immutable skincos-staging.pages.dev HTTPS origin.')
  }
  return candidate
}
const base = validatedStagingOrigin(process.env.PONTO_STAGING_CRM_URL)
const validatedApiPath = (value) => {
  const localOrigin = 'https://ponto-journey.invalid'
  const candidate = new URL(String(value), localOrigin)
  if (candidate.origin !== localOrigin || !candidate.pathname.startsWith('/api/')) throw new Error('Ponto journey accepts only relative API paths.')
  return `${candidate.pathname}${candidate.search}`
}
const fixturePath = String(process.env.PONTO_STAGING_FIXTURES_FILE || '')
const reportPath = String(process.env.PONTO_STAGING_REPORT_FILE || '')
if (!fixturePath || !reportPath) throw new Error('private fixture and sanitised report paths are required')
const fixture = JSON.parse(fs.readFileSync(fixturePath, 'utf8'))
if (fixture?.environment !== 'staging' || fixture?.role !== 'CONSULTOR' || JSON.stringify(fixture?.allowedModules) !== JSON.stringify(['atendimento', 'ponto'])) {
  throw new Error('Ponto staging fixture is invalid')
}
if (fixture.fixtureId && !/^[a-z][a-z0-9-]{0,31}$/.test(String(fixture.fixtureId))) {
  throw new Error('Ponto staging fixture label is invalid')
}
const fixtureKey = fixture.fixtureId ? `${fixture.runId}-${fixture.fixtureId}` : String(fixture.runId)

const assert = (condition, message) => { if (!condition) throw new Error(message) }
const safeReleaseMeta = (response) => ({
  pagesReleaseSha: String(response?.pagesReleaseSha || ''),
  pagesEnvironment: String(response?.pagesEnvironment || ''),
  gatewayReleaseSha: String(response?.gatewayReleaseSha || ''),
  gatewayEnvironment: String(response?.gatewayEnvironment || ''),
  gatewayVersionId: String(response?.gatewayVersionId || ''),
  timekeepingReleaseSha: String(response?.timekeepingReleaseSha || ''),
  timekeepingEnvironment: String(response?.timekeepingEnvironment || ''),
  timekeepingVersionId: String(response?.timekeepingVersionId || ''),
})
const safeRequestMeta = (response) => ({
  status: response.status,
  requestIdPresent: Boolean(response.requestId),
  cfRayPresent: Boolean(response.cfRay),
  release: safeReleaseMeta(response),
})
const responseFailure = (response) => {
  const meta = safeRequestMeta(response)
  return `${response.status}/${response.json?.error || ''}; release=${JSON.stringify(meta.release)}`
}
const recordCleanupRequest = (response) => {
  const requestId = String(response?.requestId || '')
  assert(/^[A-Za-z0-9._:-]{1,180}$/.test(requestId), 'mutation response omitted a safe cleanup request id')
  const requestIds = Array.from(new Set([...(fixture.teardownRequestIds || []), requestId]))
  fixture.teardownRequestIds = requestIds
  fs.writeFileSync(fixturePath, JSON.stringify(fixture), { mode: 0o600 })
}
const recordCleanupEvent = (eventId) => {
  const value = String(eventId || '')
  assert(/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value), 'mutation response omitted a safe cleanup event id')
  fixture.teardownEventIds = Array.from(new Set([...(fixture.teardownEventIds || []), value]))
  fs.writeFileSync(fixturePath, JSON.stringify(fixture), { mode: 0o600 })
}
// The browser stays on the validated staging origin and calls only literal,
// same-origin routes below.
const api = async (page, pathname, init = {}) => {
  const safePathname = validatedApiPath(pathname)
  // nosemgrep: javascript.playwright.security.audit.playwright-evaluate-arg-injection.playwright-evaluate-arg-injection -- safePathname is a validated relative API route.
  return page.evaluate(async ({ safePathname, init }) => {
    const response = await fetch(safePathname, { credentials: 'include', ...init })
    const text = await response.text()
    let json = null
    try { json = text ? JSON.parse(text) : null } catch {}
    return {
      status: response.status,
      ok: response.ok,
      json,
      requestId: String(response.headers.get('x-request-id') || ''),
      cfRay: String(response.headers.get('cf-ray') || ''),
      pagesReleaseSha: String(response.headers.get('x-skincos-pages-release-sha') || ''),
      pagesEnvironment: String(response.headers.get('x-skincos-pages-environment') || ''),
      gatewayReleaseSha: String(response.headers.get('x-skincos-gateway-release-sha') || ''),
      gatewayEnvironment: String(response.headers.get('x-skincos-gateway-environment') || ''),
      gatewayVersionId: String(response.headers.get('x-skincos-gateway-version-id') || ''),
      timekeepingReleaseSha: String(response.headers.get('x-skincos-timekeeping-release-sha') || ''),
      timekeepingEnvironment: String(response.headers.get('x-skincos-timekeeping-environment') || ''),
      timekeepingVersionId: String(response.headers.get('x-skincos-timekeeping-version-id') || ''),
    }
  }, { safePathname, init })
}

const csrfToken = async (page) => page.evaluate(() => {
  const value = document.cookie.split(';').map((part) => part.trim()).find((part) => part.startsWith('csrfToken='))
  return value ? decodeURIComponent(value.slice('csrfToken='.length)) : ''
})

async function post(page, pathname, body, idempotencyKey) {
  const csrf = await csrfToken(page)
  assert(csrf, 'CSRF cookie was not issued after authenticated login')
  return api(page, pathname, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      accept: 'application/json',
      'x-csrf-token': csrf,
      ...(idempotencyKey ? { 'idempotency-key': idempotencyKey } : {}),
    },
    body: JSON.stringify(body),
  })
}

async function main() {
  const { chromium } = require('playwright')
  const browser = await chromium.launch({ headless: true, args: ['--disable-dev-shm-usage', '--disable-gpu'] })
  const context = await browser.newContext({ baseURL: base.origin, viewport: { width: 1365, height: 860 } })
  const page = await context.newPage()
  const requests = []
  page.on('response', (response) => {
    const url = new URL(response.url())
    if (url.origin === base.origin && url.pathname.startsWith('/api/ponto/')) {
      requests.push({ path: url.pathname, status: response.status(), requestIdPresent: Boolean(response.headers()['x-request-id']), cfRayPresent: Boolean(response.headers()['cf-ray']) })
    }
  })
  try {
    await page.goto('/', { waitUntil: 'domcontentloaded', timeout: 60_000 })
    const login = await api(page, '/api/auth/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify({ email: fixture.email, password: fixture.password }),
    })
    assert(login.status === 200 && login.json?.success !== false && login.json?.ok !== false, `login failed (${login.status})`)
    const authMe = await api(page, '/api/auth/me')
    assert(authMe.status === 200 && authMe.json?.user, `/auth/me failed (${authMe.status})`)
    assert(String(authMe.json.user.role || '').toUpperCase() === 'CONSULTOR', 'authenticated role is not CONSULTOR')
    assert(JSON.stringify(authMe.json.user.allowedModules || []) === JSON.stringify(['atendimento', 'ponto']), 'CRM module scope drifted')

    // Reload only after the session is issued so the real application computes
    // its navigation from the authenticated identity.
    await page.goto('/?module=ponto', { waitUntil: 'domcontentloaded', timeout: 60_000 })
    const pontoButton = page.getByRole('button', { name: 'Ponto', exact: true }).first()
    await pontoButton.click({ timeout: 20_000 })
    await page.getByText('Meu ponto', { exact: true }).waitFor({ state: 'visible', timeout: 20_000 })
    const visibleModuleKeys = await page.locator('[data-module-nav="true"]:not([disabled])').evaluateAll((items) =>
      items.map((item) => String(item.getAttribute('data-module-key') || '').trim()).filter(Boolean).sort(),
    )
    assert(JSON.stringify(visibleModuleKeys) === JSON.stringify(['atendimento', 'ponto']), `visible CRM modules drifted (${visibleModuleKeys.join(',')})`)
    for (const label of ['Usuários', 'Insumos', 'Financeiro', 'Clientes', 'Escala']) {
      assert(await page.getByRole('button', { name: label, exact: true }).count() === 0, `unexpected administrative navigation: ${label}`)
    }

    const me = await api(page, '/api/ponto/me')
    assert(me.status === 200 && me.json?.linked === true, `/api/ponto/me did not link the synthetic identity (${me.status})`)
    assert(JSON.stringify(me.json.allowedUnits || []) === JSON.stringify([fixture.unitId]), 'Ponto unit scope drifted')
    assert(me.json?.suggestedNextMethod === 'PIN' && me.json?.hasFace === false, 'face/PIN release policy drifted')
    const profile = await api(page, '/api/ponto/me/profile')
    assert(profile.status === 200 && profile.json?.ok === true, `/api/ponto/me/profile failed (${profile.status})`)
    const presence = await api(page, `/api/ponto/me/presence?unit=${encodeURIComponent(fixture.unitId)}`)
    assert(presence.status === 200 && presence.json?.data?.presenceMode === 'FLEXIBLE', `synthetic presence policy unavailable (${presence.status})`)
    const before = await api(page, `/api/ponto/me/records?unit=${encodeURIComponent(fixture.unitId)}&limit=20`)
    assert(before.status === 200 && Array.isArray(before.json?.data) && before.json.data.length === 0, 'synthetic employee was not clean before punch')

    const invalidPin = await post(page, '/api/ponto/me/punch', { pin: '000000', unit: fixture.unitId }, `invalid-${fixtureKey}`)
    recordCleanupRequest(invalidPin)
    assert(invalidPin.status === 401 && invalidPin.json?.error === 'PIN_INVALID', `invalid PIN did not fail closed (${responseFailure(invalidPin)})`)
    const idempotencyKey = `synthetic-punch-${fixtureKey}`
    const occurredAt = new Date().toISOString()
    const punchBody = { pin: fixture.pin, unit: fixture.unitId, occurredAt, requestId: idempotencyKey }
    const punch = await post(page, '/api/ponto/me/punch', punchBody, idempotencyKey)
    recordCleanupRequest(punch)
    assert(punch.status === 201 && punch.json?.ok === true && punch.json?.data?.id, `PIN punch failed (${responseFailure(punch)})`)
    recordCleanupEvent(punch.json.data.id)
    const retry = await post(page, '/api/ponto/me/punch', punchBody, idempotencyKey)
    recordCleanupRequest(retry)
    assert(retry.status === 200 && retry.json?.idempotent === true && retry.json?.data?.id === punch.json.data.id, 'punch retry was not idempotent')
    const forbiddenUnit = await post(page, '/api/ponto/me/punch', { pin: fixture.pin, unit: fixture.forbiddenUnitId }, `forbidden-unit-${fixtureKey}`)
    recordCleanupRequest(forbiddenUnit)
    assert(forbiddenUnit.status === 403 && forbiddenUnit.json?.error === 'UNIT_FORBIDDEN', `cross-unit punch did not fail closed (${forbiddenUnit.status}/${forbiddenUnit.json?.error || ''})`)
    const after = await api(page, `/api/ponto/me/records?unit=${encodeURIComponent(fixture.unitId)}&limit=20`)
    assert(after.status === 200 && after.json?.data?.length === 1 && after.json.data[0]?.id === punch.json.data.id, 'idempotent punch created an unexpected ledger count')
    const correction = await post(page, '/api/ponto/corrections', { eventId: punch.json.data.id, proposedAtUtc: new Date(Date.now() + 60_000).toISOString(), reason: 'Synthetic staging correction' }, `correction-${fixtureKey}`)
    recordCleanupRequest(correction)
    assert(correction.status === 201 && correction.json?.data?.status === 'PENDING', `correction request failed (${correction.status}/${correction.json?.error || ''})`)
    const corrections = await api(page, '/api/ponto/corrections?status=PENDING')
    assert(corrections.status === 200 && corrections.json?.data?.some((entry) => entry.id === correction.json.data.id && entry.eventId === punch.json.data.id), 'self correction was not visible to CONSULTOR')
    const admin = await api(page, '/api/ponto/admin/employees')
    assert(admin.status === 403 && admin.json?.error === 'FORBIDDEN', `admin Ponto route did not remain server-forbidden (${admin.status}/${admin.json?.error || ''})`)

    // Exercise the deployed Identity candidate's real HMAC v2 create/status
    // boundary with a separate least-privileged synthetic GESTOR. A SUPERVISOR starts
    // PENDING_ACCESS, so this proves the saga without issuing an invite or
    // sending email. Teardown removes its operational rows and preserves both
    // audit ledgers.
    let identityOnboarding
    const adminContext = await browser.newContext({ baseURL: base.origin, viewport: { width: 1280, height: 720 } })
    const adminPage = await adminContext.newPage()
    try {
      await adminPage.goto('/', { waitUntil: 'domcontentloaded', timeout: 60_000 })
      const adminLogin = await api(adminPage, '/api/auth/login', {
        method: 'POST',
        headers: { 'content-type': 'application/json', accept: 'application/json' },
        body: JSON.stringify({ email: fixture.adminEmail, password: fixture.adminPassword }),
      })
      assert(adminLogin.status === 200, `synthetic GESTOR login failed (${adminLogin.status})`)
      const adminMe = await api(adminPage, '/api/auth/me')
      assert(adminMe.status === 200 && String(adminMe.json?.user?.role || '').toUpperCase() === 'GESTOR', 'synthetic onboarding actor is not GESTOR')
      assert(JSON.stringify(adminMe.json.user.allowedModules || []) === JSON.stringify(['insumos']), 'synthetic onboarding actor module grant drifted')
      assert(JSON.stringify(adminMe.json.user.allowedUnits || []) === JSON.stringify([fixture.unitId]), 'synthetic onboarding actor unit grant drifted')
      const onboarding = await post(adminPage, '/api/insumos/admin/onboarding', {
        fullName: 'Synthetic Ponto Supervisor',
        corporateEmail: fixture.onboardingCorporateEmail,
        personalEmail: fixture.onboardingPersonalEmail,
        mobilePhone: fixture.onboardingPhone,
        jobTitle: 'supervisor',
        department: fixture.onboardingDepartment,
        units: [fixture.unitId],
      }, `identity-onboarding-${fixtureKey}`)
      recordCleanupRequest(onboarding)
      assert(
        [200, 201].includes(onboarding.status)
          && onboarding.json?.success === true
          && onboarding.json?.data?.id === fixture.onboardingId
          && onboarding.json?.data?.accountStatus === 'PENDING_ACCESS'
          && onboarding.json?.data?.provisioningState === 'COMPLETED',
        `synthetic Identity onboarding failed (${onboarding.status}/${onboarding.json?.code || onboarding.json?.error || ''})`,
      )
      const deprovision = await post(
        adminPage,
        `/api/insumos/admin/onboarding/${encodeURIComponent(fixture.onboardingId)}/status`,
        { accountStatus: 'TERMINATED' },
        `identity-status-${fixtureKey}`,
      )
      recordCleanupRequest(deprovision)
      assert(
        deprovision.status === 200
          && deprovision.json?.success === true
          && deprovision.json?.data?.accountStatus === 'TERMINATED',
        `synthetic Identity status sync failed (${deprovision.status}/${deprovision.json?.code || deprovision.json?.error || ''})`,
      )
      const list = await api(adminPage, '/api/insumos/admin/onboarding')
      assert(
        list.status === 200
          && Array.isArray(list.json?.data)
          && list.json.data.some((entry) => entry.id === fixture.onboardingId && entry.accountStatus === 'TERMINATED'),
        'synthetic Identity onboarding ledger did not retain the synchronized terminal state',
      )
      identityOnboarding = {
        adminAuth: safeRequestMeta(adminMe),
        create: safeRequestMeta(onboarding),
        terminate: safeRequestMeta(deprovision),
        ledger: safeRequestMeta(list),
        hmacContract: 'v2',
        actorRole: 'GESTOR',
        actorModuleKeys: ['insumos'],
        actorUnitCount: 1,
        inviteIssued: false,
        auditPreserved: true,
      }
    } finally {
      await adminContext.close()
    }

    const report = {
      schemaVersion: 1,
      environment: 'staging',
      origin: base.origin,
      at: new Date().toISOString(),
      role: 'CONSULTOR',
      navigation: {
        atendimentoVisible: await page.getByRole('button', { name: 'Atendimento', exact: true }).count() === 1,
        pontoVisible: true,
        administrativeNavigationHidden: true,
        visibleModuleKeys,
      },
      journey: {
        auth: safeRequestMeta(authMe),
        me: safeRequestMeta(me),
        profile: safeRequestMeta(profile),
        presence: safeRequestMeta(presence),
        invalidPin: safeRequestMeta(invalidPin),
        punch: safeRequestMeta(punch),
        idempotentRetry: safeRequestMeta(retry),
        crossUnitDenied: safeRequestMeta(forbiddenUnit),
        correction: safeRequestMeta(correction),
        adminDenied: safeRequestMeta(admin),
      },
      identityOnboarding,
      pontoRequests: requests,
      credentialsIncluded: false,
      piiIncluded: false,
    }
    fs.mkdirSync(path.dirname(reportPath), { recursive: true })
    fs.writeFileSync(reportPath, JSON.stringify(report, null, 2))
    console.log(JSON.stringify({ environment: report.environment, role: report.role, navigation: report.navigation, requestCount: requests.length, credentialsIncluded: false, piiIncluded: false }))
  } finally {
    await context.close()
    await browser.close()
  }
}

main().catch((error) => {
  console.error(`[ponto-staging-journey] FAILED: ${String(error?.stack || error)}`)
  process.exitCode = 1
})
