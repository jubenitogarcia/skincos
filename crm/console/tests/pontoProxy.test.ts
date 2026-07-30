import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest'
import { createHash, createHmac } from 'node:crypto'

vi.mock('../functions/_lib/insumosAuth', () => ({ getInsumosUser: vi.fn() }))
import { getInsumosUser } from '../functions/_lib/insumosAuth'
import { onRequest } from '../functions/api/ponto/[[path]]'

const RELEASE_SHA = 'a'.repeat(40)
const CORE_VERSION_ID = '11111111-1111-4111-8111-111111111111'
const IDENTITY_VERSION_ID = '22222222-2222-4222-8222-222222222222'
const TIMEKEEPING_VERSION_ID = '33333333-3333-4333-8333-333333333333'
const RELEASE_PROBE_KEY = 'release-probe-test-key'
let releaseProbeCounter = 0

function context(path: string, init: RequestInit = {}, withCsrf = true) {
  const method = String(init.method || 'GET').toUpperCase()
  const headers = new Headers(init.headers)
  if (!headers.has('cf-connecting-ip')) headers.set('cf-connecting-ip', '203.0.113.10')
  if (withCsrf && !['GET', 'HEAD', 'OPTIONS'].includes(method)) {
    headers.set('cookie', 'session=test-session; csrfToken=test-csrf')
    headers.set('x-csrf-token', 'test-csrf')
  }
  const env: any = {
    PONTO_API_TARGET: 'https://api.skincos.com.br',
    PONTO_ACTOR_HMAC_KEY: 'proxy-test-key',
    PONTO_NETWORK_CONTEXT_KEY: 'network-test-key',
    PONTO_RELEASE_PROBE_HMAC_KEY: RELEASE_PROBE_KEY,
    PONTO_RELEASE_SHA: RELEASE_SHA,
    PONTO_ROLLOUT_STAGE: 'maintenance',
    SKINCOS_DEPLOYMENT_ENV: 'production',
  }
  env.PONTO_CORE = { fetch: (upstream: Request) => fetch(upstream) }
  env.PONTO_IDENTITY = { fetch: (upstream: Request) => fetch(upstream) }
  const usedProbeNonces = new Map<string, string>()
  env.MODULE_CONTROL = {
    get: async (key: string) => {
      if (key !== 'module-control:timekeeping') return usedProbeNonces.get(key) || null
      const identityRef = `v1:${createHmac('sha256', env.PONTO_ACTOR_HMAC_KEY)
        .update(`ponto-canary-identity/v1.${env.PONTO_RELEASE_SHA}.gestor-1`)
        .digest('base64url')}`
      const loginRef = `v1:${createHmac('sha256', env.PONTO_ACTOR_HMAC_KEY)
        .update(`ponto-canary-login/v1.${env.PONTO_RELEASE_SHA}.gestor@example.test`)
        .digest('base64url')}`
      const networkRef = `v1:${createHmac('sha256', env.PONTO_NETWORK_CONTEXT_KEY)
        .update(`ponto-network/v1.${env.PONTO_RELEASE_SHA}.203.0.113.10`)
        .digest('base64url')}`
      return {
        state: 'canary',
        schemaVersion: 2,
        rolloutStage: env.PONTO_ROLLOUT_STAGE,
        releaseSha: env.PONTO_RELEASE_SHA,
        pilotEmployeeRefs: [`v1:${'e'.repeat(43)}`],
        pilotIdentityRefs: [identityRef],
        pilotIdentityLoginRefs: [loginRef],
        pilotNetworkContexts: [networkRef],
        pilotUnits: ['UNIT_A'],
        percentage: 100,
        versions: {
          coreApi: { candidate: env.PONTO_CORE_VERSION_ID },
          identityWorkforce: { candidate: env.PONTO_IDENTITY_VERSION_ID },
          timekeeping: { candidate: TIMEKEEPING_VERSION_ID },
        },
        expiresAt: new Date(Date.now() + 60_000).toISOString(),
      }
    },
    put: async (key: string, value: string) => { usedProbeNonces.set(key, value) },
  }
  return {
    request: new Request(`https://crm.skincos.com.br${path}`, { ...init, headers }),
    env,
  }
}

async function signReleaseProbe(ctx: ReturnType<typeof context>, reuse?: { timestamp: string, nonce: string }) {
  const timestamp = reuse?.timestamp || String(Date.now())
  const nonce = reuse?.nonce || `release-probe-${String(++releaseProbeCounter).padStart(8, '0')}`
  const body = await ctx.request.clone().arrayBuffer()
  const bodyHash = createHash('sha256').update(Buffer.from(body)).digest('hex')
  const url = new URL(ctx.request.url)
  const message = `ponto-release-probe/v1.${timestamp}.${nonce}.${ctx.request.method}.${url.pathname}.${bodyHash}.${RELEASE_SHA}`
  const signature = createHmac('sha256', RELEASE_PROBE_KEY).update(message).digest('base64url')
  const headers = new Headers(ctx.request.headers)
  headers.set('x-skincos-release-probe-ts', timestamp)
  headers.set('x-skincos-release-probe-nonce', nonce)
  headers.set('x-skincos-release-probe-signature-version', '1')
  headers.set('x-skincos-release-probe-sig', signature)
  ctx.request = new Request(ctx.request, { headers })
  return { timestamp, nonce }
}

describe('Ponto CRM proxy', () => {
  beforeEach(() => { vi.restoreAllMocks(); (getInsumosUser as Mock).mockResolvedValue({ id: 'gestor-1', email: 'gestor@example.test', role: 'GESTOR', allowedUnits: ['UNIT_A'] }) })
  afterEach(() => vi.unstubAllGlobals())

  it('keeps health public and preserves query strings', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ ok: true }), { headers: { 'content-type': 'application/json' } }))
    vi.stubGlobal('fetch', fetchMock)
    const response = await onRequest(context('/api/ponto/health?probe=1'))
    expect(response.status).toBe(200); expect(getInsumosUser).not.toHaveBeenCalled()
    expect((fetchMock.mock.calls[0][0] as Request).url).toBe('https://api.skincos.com.br/api/ponto/health?probe=1')
    expect(response.headers.get('x-skincos-pages-release-sha')).toBe(RELEASE_SHA)
    expect(response.headers.get('x-skincos-pages-environment')).toBe('production')
  })

  it('signs canonical protected routes and strips browser cookies and authorization', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ ok: true, data: [] }), { headers: { 'content-type': 'application/json' } }))
    vi.stubGlobal('fetch', fetchMock)
    await onRequest(context('/api/ponto/employees?unitId=UNIT_A', { headers: { cookie: 'session=secret', authorization: 'Bearer browser-secret' } }))
    const upstream = fetchMock.mock.calls[0][0] as Request
    expect(upstream.headers.get('cookie')).toBeNull(); expect(upstream.headers.get('authorization')).toBeNull()
    expect(upstream.headers.get('x-skincos-actor')).toBeTruthy(); expect(upstream.headers.get('x-skincos-actor-sig')).toBeTruthy()
    expect(upstream.headers.get('x-skincos-signature-version')).toBe('2')
    const actor = JSON.parse(Buffer.from(String(upstream.headers.get('x-skincos-actor')), 'base64url').toString('utf8'))
    expect(actor).toMatchObject({ role: 'MANAGER', allowedUnits: ['UNIT_A'], releaseSha: RELEASE_SHA })
    expect(upstream.headers.get('x-skincos-network-context')).toMatch(/^v1:[A-Za-z0-9_-]{43}$/)
    expect(upstream.headers.get('x-skincos-network-signature-version')).toBe('2')
    expect(upstream.headers.get('cloudflare-workers-version-key')).toBe(upstream.headers.get('x-skincos-network-context'))
    expect(upstream.headers.get('x-skincos-network-ip')).toBeNull()
  })

  it('signs the release-bound network envelope exactly and generates the Core version override internally', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ ok: true })))
    vi.stubGlobal('fetch', fetchMock)
    const ctx = context('/api/ponto/corrections?unit=UNIT_A', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'cloudflare-workers-version-key': 'browser-selected',
        'cloudflare-workers-version-overrides': 'skincos-api="browser-selected"',
        'x-skincos-network-context': `v1:${'z'.repeat(43)}`,
        'x-skincos-network-sig': 'z'.repeat(43),
      },
      body: JSON.stringify({ eventId: 'evt-1' }),
    })
    ;(ctx.env as any).PONTO_CORE_VERSION_ID = CORE_VERSION_ID
    ;(ctx.env as any).PONTO_IDENTITY_VERSION_ID = IDENTITY_VERSION_ID
    ;(ctx.env as any).PONTO_ROLLOUT_STAGE = 'pilot'

    await onRequest(ctx)

    const upstream = fetchMock.mock.calls[0][0] as Request
    const actorB64 = String(upstream.headers.get('x-skincos-actor'))
    const nonce = String(upstream.headers.get('x-request-nonce'))
    const body = await upstream.clone().arrayBuffer()
    const bodyHash = await crypto.subtle.digest('SHA-256', body)
    const bodyHashHex = Buffer.from(bodyHash).toString('hex')
    const networkContext = String(upstream.headers.get('x-skincos-network-context'))
    const expectedContextDigest = createHmac('sha256', 'network-test-key')
      .update(`ponto-network/v1.${RELEASE_SHA}.203.0.113.10`)
      .digest('base64url')
    expect(networkContext).toBe(`v1:${expectedContextDigest}`)

    const expectedNetworkSignature = createHmac('sha256', 'network-test-key')
      .update([
        upstream.headers.get('x-skincos-network-ts'),
        actorB64,
        'POST',
        '/api/ponto/corrections?unit=UNIT_A',
        nonce,
        bodyHashHex,
        RELEASE_SHA,
        networkContext,
      ].join('.'))
      .digest('base64url')
    expect(upstream.headers.get('x-skincos-network-sig')).toBe(expectedNetworkSignature)
    expect(upstream.headers.get('cloudflare-workers-version-key')).toBe(networkContext)
    expect(upstream.headers.get('cloudflare-workers-version-overrides')).toBe(`skincos-ponto-core="${CORE_VERSION_ID}"`)
  })

  it('normalizes legacy RH and Auditor roles to the Workforce Supervisor contract', async () => {
    ;(getInsumosUser as Mock).mockResolvedValue({ id: 'rh-1', email: 'rh@example.test', role: 'RH', allowedUnits: ['UNIT_A'] })
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ ok: true, data: [] }), { headers: { 'content-type': 'application/json' } }))
    vi.stubGlobal('fetch', fetchMock)
    await onRequest(context('/api/ponto/admin/employees'))
    const upstream = fetchMock.mock.calls[0][0] as Request
    const actor = JSON.parse(Buffer.from(String(upstream.headers.get('x-skincos-actor')), 'base64url').toString('utf8'))
    expect(actor.role).toBe('SUPERVISOR')

    ;(getInsumosUser as Mock).mockResolvedValue({ id: 'audit-1', email: 'audit@example.test', role: 'AUDITOR', allowedUnits: ['UNIT_A'] })
    await onRequest(context('/api/ponto/employees'))
    const legacyAuditorUpstream = fetchMock.mock.calls[1][0] as Request
    const legacyAuditorActor = JSON.parse(Buffer.from(String(legacyAuditorUpstream.headers.get('x-skincos-actor')), 'base64url').toString('utf8'))
    expect(legacyAuditorActor.role).toBe('SUPERVISOR')
  })

  it('maps Consultor to a self-service Workforce actor', async () => {
    ;(getInsumosUser as Mock).mockResolvedValue({ id: 'consultor-1', email: 'consultor@example.test', role: 'CONSULTOR', allowedUnits: ['UNIT_A'] })
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ ok: true, data: [] }), { headers: { 'content-type': 'application/json' } }))
    vi.stubGlobal('fetch', fetchMock)
    await onRequest(context('/api/ponto/me/records'))
    const upstream = fetchMock.mock.calls[0][0] as Request
    const actor = JSON.parse(Buffer.from(String(upstream.headers.get('x-skincos-actor')), 'base64url').toString('utf8'))
    expect(actor.role).toBe('CONSULTOR')
  })

  it('blocks a Consultor from administrative routes before forwarding upstream', async () => {
    ;(getInsumosUser as Mock).mockResolvedValue({ id: 'consultor-1', email: 'consultor@example.test', role: 'CONSULTOR', allowedUnits: ['UNIT_A'] })
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    const response = await onRequest(context('/api/ponto/admin/employees'))

    expect(response.status).toBe(403)
    await expect(response.json()).resolves.toMatchObject({ ok: false, error: 'FORBIDDEN' })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('adds a unique replay nonce to protected mutations', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ ok: true }), { headers: { 'content-type': 'application/json' } }))
    vi.stubGlobal('fetch', fetchMock)
    await onRequest(context('/api/ponto/corrections', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ eventId: 'x' }) }))
    expect((fetchMock.mock.calls[0][0] as Request).headers.get('x-request-nonce')).toBeTruthy()
  })

  it('rejects cookie-authenticated mutations without the CSRF pair', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    const response = await onRequest(context('/api/ponto/corrections', { method: 'POST', headers: { origin: 'https://evil.example', 'content-type': 'application/json' }, body: '{}' }, false))
    expect(response.status).toBe(403)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('does not forward arbitrary sensitive headers on public routes', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ ok: true }), { headers: { 'content-type': 'application/json' } }))
    vi.stubGlobal('fetch', fetchMock)
    await onRequest(context('/api/ponto/health', {
      headers: {
        cookie: 'session=secret',
        'x-custom-secret': 'secret',
        'cloudflare-workers-version-key': 'browser-affinity',
        'cloudflare-workers-version-overrides': 'skincos-api="browser-version"',
        'x-skincos-gateway-release-sha': 'browser-release',
      },
    }))
    const upstream = fetchMock.mock.calls[0][0] as Request
    expect(upstream.headers.get('cookie')).toBeNull(); expect(upstream.headers.get('x-custom-secret')).toBeNull()
    expect(upstream.headers.get('cloudflare-workers-version-key')).toBeNull()
    expect(upstream.headers.get('cloudflare-workers-version-overrides')).toBeNull()
    expect(upstream.headers.get('x-skincos-gateway-release-sha')).toBeNull()
  })

  it('signs Cloudflare-observed network context only for explicit device routes', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ ok: true }), { headers: { 'content-type': 'application/json' } }))
    vi.stubGlobal('fetch', fetchMock)
    const ctx = context('/api/ponto/device/context', { headers: { authorization: 'Device terminal-token', 'cf-connecting-ip': '203.0.113.10' } })
    await onRequest(ctx)
    const upstream = fetchMock.mock.calls[0][0] as Request
    expect(upstream.headers.get('authorization')).toBe('Device terminal-token')
    expect(upstream.headers.get('x-skincos-network-ip')).toBe('203.0.113.10')
    expect(upstream.headers.get('x-skincos-network-sig')).toBeTruthy()
    expect(upstream.headers.get('cookie')).toBeNull()
  })

  it('fails closed instead of falling back to production when staging target configuration is absent or mismatched', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    const missing = context('/api/ponto/health')
    ;(missing.env as any).SKINCOS_DEPLOYMENT_ENV = 'staging'
    delete (missing.env as any).PONTO_API_TARGET

    const missingResponse = await onRequest(missing)
    expect(missingResponse.status).toBe(503)
    await expect(missingResponse.json()).resolves.toMatchObject({
      ok: false,
      error: 'PONTO_PROXY_CONFIG_INVALID',
      issues: expect.arrayContaining(['PONTO_API_TARGET_MISSING']),
    })

    const mismatched = context('/api/ponto/health')
    ;(mismatched.env as any).SKINCOS_DEPLOYMENT_ENV = 'staging'
    const mismatchedResponse = await onRequest(mismatched)
    expect(mismatchedResponse.status).toBe(503)
    await expect(mismatchedResponse.json()).resolves.toMatchObject({
      issues: expect.arrayContaining(['PONTO_API_TARGET_ENVIRONMENT_MISMATCH']),
    })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('accepts only the explicit staging target during the governed staging journey', async () => {
    vi.stubGlobal('fetch', vi.fn())
    const staging = context('/api/ponto/_proxy-status')
    Object.assign(staging.env, {
      SKINCOS_DEPLOYMENT_ENV: 'staging',
      PONTO_API_TARGET: 'https://api-staging.skincos.com.br',
      PONTO_ROLLOUT_STAGE: 'staging',
      PONTO_CORE_VERSION_ID: CORE_VERSION_ID,
      PONTO_IDENTITY_VERSION_ID: IDENTITY_VERSION_ID,
    })

    const response = await onRequest(staging)

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({ ok: true, ready: true })
  })

  it('keeps the public proxy probe minimal and fail-closed', async () => {
    vi.stubGlobal('fetch', vi.fn())
    const invalid = context('/api/ponto/_proxy-status')
    ;(invalid.env as any).PONTO_RELEASE_SHA = '__RELEASE_SHA__'

    const invalidResponse = await onRequest(invalid)
    expect(invalidResponse.status).toBe(503)
    await expect(invalidResponse.json()).resolves.toEqual({ ok: false, ready: false })

    const valid = context('/api/ponto/_proxy-status')
    ;(valid.env as any).PONTO_CORE_VERSION_ID = CORE_VERSION_ID
    ;(valid.env as any).PONTO_IDENTITY_VERSION_ID = IDENTITY_VERSION_ID
    ;(valid.env as any).PONTO_ROLLOUT_STAGE = 'pilot'
    const validResponse = await onRequest(valid)
    expect(validResponse.status).toBe(200)
    await expect(validResponse.json()).resolves.toEqual({ ok: true, ready: true })
  })

  it('reports detailed non-secret proxy posture only to an authenticated ADMIN', async () => {
    ;(getInsumosUser as Mock).mockResolvedValue({ id: 'admin-1', email: 'admin@example.test', role: 'ADMIN', allowedUnits: [] })
    vi.stubGlobal('fetch', vi.fn())
    const valid = context('/api/ponto/_proxy-status')
    ;(valid.env as any).PONTO_CORE_VERSION_ID = CORE_VERSION_ID
    ;(valid.env as any).PONTO_IDENTITY_VERSION_ID = IDENTITY_VERSION_ID
    ;(valid.env as any).PONTO_ROLLOUT_STAGE = 'pilot'

    const response = await onRequest(valid)

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({
      ok: true,
      environment: 'production',
      rolloutStage: 'pilot',
      releaseSha: RELEASE_SHA,
      targetConfigured: true,
      targetMatchesEnvironment: true,
      actorKeyConfigured: true,
      networkKeyConfigured: true,
      coreVersionOverrideConfigured: true,
      coreServiceConfigured: true,
    })
  })

  it('fails closed without the private Core service binding and never falls back to public fetch', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    const missing = context('/api/ponto/health')
    delete (missing.env as any).PONTO_CORE

    const response = await onRequest(missing)

    expect(response.status).toBe(503)
    await expect(response.json()).resolves.toMatchObject({
      error: 'PONTO_PROXY_CONFIG_INVALID',
      issues: expect.arrayContaining(['PONTO_CORE_SERVICE_BINDING_MISSING']),
    })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('routes only an exact server-authorized cohort to the private Core candidate', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ ok: true })))
    vi.stubGlobal('fetch', fetchMock)
    const allowed = context('/api/ponto/me/records')
    ;(allowed.env as any).PONTO_CORE_VERSION_ID = CORE_VERSION_ID
    ;(allowed.env as any).PONTO_IDENTITY_VERSION_ID = IDENTITY_VERSION_ID
    ;(allowed.env as any).PONTO_ROLLOUT_STAGE = 'pilot'

    expect((await onRequest(allowed)).status).toBe(200)
    expect((fetchMock.mock.calls[0][0] as Request).headers.get('cloudflare-workers-version-overrides'))
      .toBe(`skincos-ponto-core="${CORE_VERSION_ID}"`)

    const denied = context('/api/ponto/me/records')
    ;(denied.env as any).PONTO_CORE_VERSION_ID = CORE_VERSION_ID
    ;(denied.env as any).PONTO_IDENTITY_VERSION_ID = IDENTITY_VERSION_ID
    ;(denied.env as any).PONTO_ROLLOUT_STAGE = 'pilot'
    ;(denied.env as any).MODULE_CONTROL = {
      get: async () => ({
        state: 'canary',
        schemaVersion: 2,
        rolloutStage: 'pilot',
        releaseSha: RELEASE_SHA,
        pilotIdentityRefs: [`v1:${'x'.repeat(43)}`],
        pilotNetworkContexts: [`v1:${'n'.repeat(43)}`],
        pilotUnits: ['UNIT_A'],
        percentage: 100,
        versions: {
          coreApi: { candidate: CORE_VERSION_ID },
          identityWorkforce: { candidate: IDENTITY_VERSION_ID },
        },
        expiresAt: new Date(Date.now() + 60_000).toISOString(),
      }),
    }
    const deniedResponse = await onRequest(denied)
    expect(deniedResponse.status).toBe(403)
    await expect(deniedResponse.json()).resolves.toMatchObject({ error: 'PONTO_COHORT_NOT_AUTHORIZED' })
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('requires aligned employee, Identity, Identity-login, unit and network grants in Pages', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ ok: true })))
    vi.stubGlobal('fetch', fetchMock)
    const identityRef = `v1:${createHmac('sha256', 'proxy-test-key')
      .update(`ponto-canary-identity/v1.${RELEASE_SHA}.gestor-1`)
      .digest('base64url')}`
    const loginRef = `v1:${createHmac('sha256', 'proxy-test-key')
      .update(`ponto-canary-login/v1.${RELEASE_SHA}.gestor@example.test`)
      .digest('base64url')}`
    const networkRef = `v1:${createHmac('sha256', 'network-test-key')
      .update(`ponto-network/v1.${RELEASE_SHA}.203.0.113.10`)
      .digest('base64url')}`
    const controlled = (overrides: Record<string, unknown>) => ({
      state: 'canary',
      schemaVersion: 2,
      rolloutStage: 'pilot',
      releaseSha: RELEASE_SHA,
      pilotEmployeeRefs: [`v1:${'e'.repeat(43)}`],
      pilotIdentityRefs: [identityRef],
      pilotIdentityLoginRefs: [loginRef],
      pilotNetworkContexts: [networkRef],
      pilotUnits: ['UNIT_A'],
      percentage: 100,
      versions: {
        coreApi: { candidate: CORE_VERSION_ID },
        identityWorkforce: { candidate: IDENTITY_VERSION_ID },
      },
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
      ...overrides,
    })
    const requestFor = (control: any) => {
      const ctx = context('/api/ponto/me/records')
      Object.assign(ctx.env, {
        PONTO_CORE_VERSION_ID: CORE_VERSION_ID,
        PONTO_IDENTITY_VERSION_ID: IDENTITY_VERSION_ID,
        PONTO_ROLLOUT_STAGE: 'pilot',
        MODULE_CONTROL: { get: async () => control },
      })
      return ctx
    }

    const missingEmployee = await onRequest(requestFor(controlled({ pilotEmployeeRefs: undefined })))
    expect(missingEmployee.status).toBe(403)

    const mixedTuple = await onRequest(requestFor(controlled({
      pilotEmployeeRefs: [`v1:${'e'.repeat(43)}`, `v1:${'f'.repeat(43)}`],
      pilotIdentityRefs: [identityRef, `v1:${'i'.repeat(43)}`],
      pilotIdentityLoginRefs: [`v1:${'l'.repeat(43)}`, loginRef],
    })))
    expect(mixedTuple.status).toBe(403)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('routes staging only through the exact synthetic-only control and fails closed on drift', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ ok: true })))
    vi.stubGlobal('fetch', fetchMock)
    const stagingControl = (syntheticOnly: boolean) => ({
      state: 'active',
      schemaVersion: 2,
      rolloutStage: 'staging',
      releaseSha: RELEASE_SHA,
      syntheticOnly,
      versions: {
        coreApi: { candidate: CORE_VERSION_ID },
        identityWorkforce: { candidate: IDENTITY_VERSION_ID },
      },
    })
    const allowed = context('/api/ponto/me')
    Object.assign(allowed.env, {
      SKINCOS_DEPLOYMENT_ENV: 'staging',
      PONTO_API_TARGET: 'https://api-staging.skincos.com.br',
      PONTO_ROLLOUT_STAGE: 'staging',
      PONTO_CORE_VERSION_ID: CORE_VERSION_ID,
      PONTO_IDENTITY_VERSION_ID: IDENTITY_VERSION_ID,
      MODULE_CONTROL: { get: async () => stagingControl(true) },
    })

    expect((await onRequest(allowed)).status).toBe(200)
    expect((fetchMock.mock.calls[0][0] as Request).headers.get('cloudflare-workers-version-overrides'))
      .toBe(`skincos-ponto-core-staging="${CORE_VERSION_ID}"`)

    const denied = context('/api/ponto/me')
    Object.assign(denied.env, {
      SKINCOS_DEPLOYMENT_ENV: 'staging',
      PONTO_API_TARGET: 'https://api-staging.skincos.com.br',
      PONTO_ROLLOUT_STAGE: 'staging',
      PONTO_CORE_VERSION_ID: CORE_VERSION_ID,
      PONTO_IDENTITY_VERSION_ID: IDENTITY_VERSION_ID,
      MODULE_CONTROL: { get: async () => stagingControl(false) },
    })
    expect((await onRequest(denied)).status).toBe(403)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('proves candidate Identity auth, grants, session read and teardown only through the internal binding', async () => {
    const login = 'pilot@example.test'
    const password = 'synthetic-password-123'
    const loginRef = `v1:${createHmac('sha256', 'proxy-test-key')
      .update(`ponto-canary-login/v1.${RELEASE_SHA}.${login}`)
      .digest('base64url')}`
    const networkRef = `v1:${createHmac('sha256', 'network-test-key')
      .update(`ponto-network/v1.${RELEASE_SHA}.203.0.113.10`)
      .digest('base64url')}`
    const seen: Request[] = []
    const identityFetch = vi.fn(async (request: Request) => {
      seen.push(request)
      const path = new URL(request.url).pathname
      if (path === '/health/workforce-contract') {
        expect(request.headers.get('x-skincos-release-probe')).toBe('ponto-v1')
        return new Response(JSON.stringify({
          ok: true,
          ready: true,
          version: RELEASE_SHA,
          workerVersionId: IDENTITY_VERSION_ID,
          data: { contract: 'identity-workforce-hmac-v2', matched: true },
        }), { headers: { 'content-type': 'application/json' } })
      }
      if (path === '/auth/login') {
        const headers = new Headers({ 'content-type': 'application/json' })
        headers.append('set-cookie', 'session=candidate-session; Path=/; HttpOnly')
        headers.append('set-cookie', 'csrfToken=candidate-csrf; Path=/')
        return new Response(JSON.stringify({ success: true }), { headers })
      }
      if (path === '/auth/me') {
        return new Response(JSON.stringify({
          success: true,
          user: { role: 'CONSULTOR', allowedModules: ['ponto', 'atendimento'] },
        }), { headers: { 'content-type': 'application/json' } })
      }
      if (path === '/auth/sessions') {
        return new Response(JSON.stringify({
          success: true,
          sessions: [{ id: 'candidate-current-session', current: true }],
        }), { headers: { 'content-type': 'application/json' } })
      }
      if (path === '/auth/sessions/candidate-current-session/revoke') {
        expect(request.headers.get('x-csrf-token')).toBe('candidate-csrf')
        return new Response(JSON.stringify({ success: true }), { headers: { 'content-type': 'application/json' } })
      }
      return new Response('not found', { status: 404 })
    })
    const ctx = context('/api/ponto/_release-contract', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: login, password }),
    }, false)
    ;(ctx.env as any).PONTO_CORE_VERSION_ID = CORE_VERSION_ID
    ;(ctx.env as any).PONTO_IDENTITY_VERSION_ID = IDENTITY_VERSION_ID
    ;(ctx.env as any).PONTO_ROLLOUT_STAGE = 'pilot'
    ;(ctx.env as any).PONTO_IDENTITY = { fetch: identityFetch }
    const usedProbeNonces = new Map<string, string>()
    ;(ctx.env as any).MODULE_CONTROL = {
      get: async (key: string) => key === 'module-control:timekeeping' ? ({
        state: 'canary',
        schemaVersion: 2,
        rolloutStage: 'pilot',
        releaseSha: RELEASE_SHA,
        pilotEmployeeRefs: [`v1:${'e'.repeat(43)}`],
        pilotIdentityRefs: [`v1:${'i'.repeat(43)}`],
        pilotIdentityLoginRefs: [loginRef],
        pilotNetworkContexts: [networkRef],
        pilotUnits: ['UNIT_A'],
        percentage: 100,
        versions: {
          coreApi: { candidate: CORE_VERSION_ID },
          identityWorkforce: { candidate: IDENTITY_VERSION_ID },
          timekeeping: { candidate: TIMEKEEPING_VERSION_ID },
        },
        expiresAt: new Date(Date.now() + 60_000).toISOString(),
      }) : (usedProbeNonces.get(key) || null),
      put: async (key: string, value: string) => { usedProbeNonces.set(key, value) },
    }
    await signReleaseProbe(ctx)

    const response = await onRequest(ctx)

    expect(response.status).toBe(200)
    const report = await response.json()
    expect(report).toEqual({
      ok: true,
      ready: true,
      releaseSha: RELEASE_SHA,
      identityVersionId: IDENTITY_VERSION_ID,
      contract: 'identity-workforce-hmac-v2',
      roleClass: 'CONSULTOR',
      modules: ['atendimento', 'ponto'],
      sessionRead: true,
      sessionRevoked: true,
      credentialsIncluded: false,
      piiIncluded: false,
    })
    expect(seen).toHaveLength(5)
    for (const request of seen) {
      expect(request.headers.get('cloudflare-workers-version-overrides'))
        .toBe(`skincos-insumos="${IDENTITY_VERSION_ID}"`)
    }
    expect(JSON.stringify(report)).not.toContain(login)
    expect(JSON.stringify(report)).not.toContain(password)
  })

  it('requires a fresh one-time release-probe signature before accepting synthetic credentials', async () => {
    const unsigned = context('/api/ponto/_release-contract', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: 'pilot@example.test', password: 'synthetic-password-123' }),
    }, false)
    Object.assign(unsigned.env, {
      PONTO_CORE_VERSION_ID: CORE_VERSION_ID,
      PONTO_IDENTITY_VERSION_ID: IDENTITY_VERSION_ID,
      PONTO_ROLLOUT_STAGE: 'pilot',
    })
    const identityFetch = vi.fn().mockResolvedValue(new Response('{}', { status: 503 }))
    ;(unsigned.env as any).PONTO_IDENTITY = { fetch: identityFetch }

    const unsignedResponse = await onRequest(unsigned)
    expect(unsignedResponse.status).toBe(403)
    expect(identityFetch).not.toHaveBeenCalled()

    const signed = context('/api/ponto/_release-contract', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: 'gestor@example.test', password: 'synthetic-password-123' }),
    }, false)
    Object.assign(signed.env, {
      PONTO_CORE_VERSION_ID: CORE_VERSION_ID,
      PONTO_IDENTITY_VERSION_ID: IDENTITY_VERSION_ID,
      PONTO_ROLLOUT_STAGE: 'pilot',
      PONTO_IDENTITY: { fetch: identityFetch },
    })
    await signReleaseProbe(signed)
    const replayRequest = signed.request.clone()

    expect((await onRequest(signed)).status).toBe(503)
    signed.request = replayRequest as any
    const replay = await onRequest(signed)
    expect(replay.status).toBe(403)
    await expect(replay.json()).resolves.toMatchObject({ error: 'RELEASE_PROBE_NOT_AUTHORIZED' })
  })

  it('allows only a signed staging.invalid fixture under exact active synthetic staging control', async () => {
    const stagingControl = {
      state: 'active',
      schemaVersion: 2,
      rolloutStage: 'staging',
      releaseSha: RELEASE_SHA,
      syntheticOnly: true,
      versions: {
        coreApi: { candidate: CORE_VERSION_ID },
        identityWorkforce: { candidate: IDENTITY_VERSION_ID },
        timekeeping: { candidate: TIMEKEEPING_VERSION_ID },
      },
    }
    const build = async (email: string, identityFetch: any) => {
      const ctx = context('/api/ponto/_release-contract', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email, password: 'synthetic-password-123' }),
      }, false)
      const used = new Map<string, string>()
      Object.assign(ctx.env, {
        SKINCOS_DEPLOYMENT_ENV: 'staging',
        PONTO_API_TARGET: 'https://api-staging.skincos.com.br',
        PONTO_ROLLOUT_STAGE: 'staging',
        PONTO_CORE_VERSION_ID: CORE_VERSION_ID,
        PONTO_IDENTITY_VERSION_ID: IDENTITY_VERSION_ID,
        PONTO_IDENTITY: { fetch: identityFetch },
        MODULE_CONTROL: {
          get: async (key: string) => key === 'module-control:timekeeping'
            ? stagingControl
            : (used.get(key) || null),
          put: async (key: string, value: string) => { used.set(key, value) },
        },
      })
      await signReleaseProbe(ctx)
      return ctx
    }

    const approvedFetch = vi.fn().mockResolvedValue(new Response('{}', { status: 503 }))
    const approved = await onRequest(await build('journey-fixture@staging.invalid', approvedFetch))
    expect(approved.status).toBe(503)
    expect(approvedFetch).toHaveBeenCalledTimes(1)

    const externalFetch = vi.fn()
    const external = await onRequest(await build('journey-fixture@example.test', externalFetch))
    expect(external.status).toBe(403)
    expect(externalFetch).not.toHaveBeenCalled()
  })

  it('pins protected release readiness to the exact Core and Timekeeping candidate versions', async () => {
    const exact = context('/api/ponto/_release-readiness', {}, false)
    Object.assign(exact.env, {
      PONTO_CORE_VERSION_ID: CORE_VERSION_ID,
      PONTO_IDENTITY_VERSION_ID: IDENTITY_VERSION_ID,
      PONTO_ROLLOUT_STAGE: 'pilot',
      PONTO_CORE: {
        fetch: vi.fn(async (request: Request) => {
          expect(request.headers.get('cloudflare-workers-version-overrides'))
            .toBe(`skincos-ponto-core="${CORE_VERSION_ID}"`)
          return new Response(JSON.stringify({ ok: true, ready: true }), {
            headers: {
              'content-type': 'application/json',
              'x-skincos-gateway-release-sha': RELEASE_SHA,
              'x-skincos-gateway-version-id': CORE_VERSION_ID,
              'x-skincos-timekeeping-release-sha': RELEASE_SHA,
              'x-skincos-timekeeping-version-id': TIMEKEEPING_VERSION_ID,
            },
          })
        }),
      },
    })
    await signReleaseProbe(exact)
    const response = await onRequest(exact)
    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({
      ok: true,
      ready: true,
      releaseSha: RELEASE_SHA,
      coreVersionId: CORE_VERSION_ID,
      timekeepingVersionId: TIMEKEEPING_VERSION_ID,
    })

    const mismatch = context('/api/ponto/_release-readiness', {}, false)
    Object.assign(mismatch.env, {
      PONTO_CORE_VERSION_ID: CORE_VERSION_ID,
      PONTO_IDENTITY_VERSION_ID: IDENTITY_VERSION_ID,
      PONTO_ROLLOUT_STAGE: 'pilot',
      PONTO_CORE: {
        fetch: vi.fn().mockResolvedValue(new Response(JSON.stringify({ ok: true, ready: true }), {
          headers: {
            'content-type': 'application/json',
            'x-skincos-gateway-release-sha': RELEASE_SHA,
            'x-skincos-gateway-version-id': CORE_VERSION_ID,
            'x-skincos-timekeeping-release-sha': RELEASE_SHA,
            'x-skincos-timekeeping-version-id': '44444444-4444-4444-8444-444444444444',
          },
        })),
      },
    })
    await signReleaseProbe(mismatch)
    const mismatchResponse = await onRequest(mismatch)
    expect(mismatchResponse.status).toBe(503)
    await expect(mismatchResponse.json()).resolves.toMatchObject({ error: 'RELEASE_READINESS_VERSION_MISMATCH' })
  })

  it('requires the exact Core candidate for pilot and canary and forbids stale overrides afterward', async () => {
    ;(getInsumosUser as Mock).mockResolvedValue({ id: 'admin-1', email: 'admin@example.test', role: 'ADMIN', allowedUnits: [] })
    vi.stubGlobal('fetch', vi.fn())
    const pilotWithoutVersion = context('/api/ponto/_proxy-status')
    ;(pilotWithoutVersion.env as any).PONTO_ROLLOUT_STAGE = 'pilot'
    const pilotResponse = await onRequest(pilotWithoutVersion)
    expect(pilotResponse.status).toBe(503)
    await expect(pilotResponse.json()).resolves.toMatchObject({
      issues: expect.arrayContaining(['PONTO_CORE_VERSION_ID_REQUIRED_FOR_STAGING_PILOT_OR_CANARY']),
    })

    const canaryWithVersion = context('/api/ponto/_proxy-status')
    ;(canaryWithVersion.env as any).PONTO_ROLLOUT_STAGE = 'canary'
    ;(canaryWithVersion.env as any).PONTO_CORE_VERSION_ID = CORE_VERSION_ID
    ;(canaryWithVersion.env as any).PONTO_IDENTITY_VERSION_ID = IDENTITY_VERSION_ID
    const canaryResponse = await onRequest(canaryWithVersion)
    expect(canaryResponse.status).toBe(200)
    await expect(canaryResponse.json()).resolves.toMatchObject({
      ok: true,
      coreVersionOverrideConfigured: true,
    })

    const productionWithStaleVersion = context('/api/ponto/_proxy-status')
    ;(productionWithStaleVersion.env as any).PONTO_ROLLOUT_STAGE = 'production'
    ;(productionWithStaleVersion.env as any).PONTO_CORE_VERSION_ID = CORE_VERSION_ID
    ;(productionWithStaleVersion.env as any).PONTO_IDENTITY_VERSION_ID = IDENTITY_VERSION_ID
    const productionResponse = await onRequest(productionWithStaleVersion)
    expect(productionResponse.status).toBe(503)
    await expect(productionResponse.json()).resolves.toMatchObject({
      issues: expect.arrayContaining(['PONTO_CORE_VERSION_ID_FORBIDDEN_OUTSIDE_PILOT_OR_CANARY']),
    })
  })

  it('allows direct local Timekeeping only behind all explicit loopback and auth-bypass guards', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ ok: true })))
    vi.stubGlobal('fetch', fetchMock)
    const local = context('/api/ponto/me/records')
    local.request = new Request('http://127.0.0.1:8791/api/ponto/me/records', {
      headers: { 'cf-connecting-ip': '198.51.100.44' },
    })
    Object.assign(local.env, {
      LOCAL_AUTH_BYPASS: 'true',
      PONTO_ALLOW_LOCAL_DIRECT_TIMEKEEPING: 'true',
      PONTO_API_TARGET: 'http://127.0.0.1:8801',
      PONTO_ROLLOUT_STAGE: 'local',
      SKINCOS_DEPLOYMENT_ENV: 'local',
    })

    const response = await onRequest(local)

    expect(response.status).toBe(200)
    const upstream = fetchMock.mock.calls[0][0] as Request
    expect(upstream.url).toBe('http://127.0.0.1:8801/api/ponto/me/records')
    expect(upstream.headers.get('x-skincos-gateway-release-sha')).toBe(RELEASE_SHA)
    expect(upstream.headers.get('x-skincos-gateway-environment')).toBe('local')
    expect(upstream.headers.get('x-skincos-pages-environment')).toBe('local')
    const expectedContextDigest = createHmac('sha256', 'network-test-key')
      .update(`ponto-network/v1.${RELEASE_SHA}.127.0.0.1`)
      .digest('base64url')
    expect(upstream.headers.get('x-skincos-network-context')).toBe(`v1:${expectedContextDigest}`)
  })

  it('rejects local direct mode when the dedicated flag or loopback request boundary is absent', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    const missingFlag = context('/api/ponto/health')
    Object.assign(missingFlag.env, {
      LOCAL_AUTH_BYPASS: 'true',
      PONTO_API_TARGET: 'http://127.0.0.1:8801',
      PONTO_ROLLOUT_STAGE: 'local',
      SKINCOS_DEPLOYMENT_ENV: 'local',
    })
    const missingFlagResponse = await onRequest(missingFlag)
    expect(missingFlagResponse.status).toBe(503)
    await expect(missingFlagResponse.json()).resolves.toMatchObject({
      issues: expect.arrayContaining(['PONTO_LOCAL_DIRECT_FLAG_REQUIRED', 'PONTO_LOCAL_REQUEST_HOST_REQUIRED']),
    })

    const remoteRequest = context('/api/ponto/health')
    Object.assign(remoteRequest.env, {
      LOCAL_AUTH_BYPASS: 'true',
      PONTO_ALLOW_LOCAL_DIRECT_TIMEKEEPING: 'true',
      PONTO_API_TARGET: 'http://127.0.0.1:8801',
      PONTO_ROLLOUT_STAGE: 'local',
      SKINCOS_DEPLOYMENT_ENV: 'local',
    })
    const remoteResponse = await onRequest(remoteRequest)
    expect(remoteResponse.status).toBe(503)
    await expect(remoteResponse.json()).resolves.toMatchObject({
      issues: expect.arrayContaining(['PONTO_LOCAL_REQUEST_HOST_REQUIRED']),
    })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('returns structured JSON without stack details when Timekeeping is unavailable', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('connect ECONNREFUSED secret-upstream')))

    const response = await onRequest(context('/api/ponto/readiness'))

    expect(response.status).toBe(503)
    expect(response.headers.get('content-type')).toContain('application/json')
    expect(response.headers.get('x-request-id')).toBeTruthy()
    const body = await response.json()
    expect(body).toMatchObject({ ok: false, error: 'UPSTREAM_UNAVAILABLE' })
    expect(JSON.stringify(body)).not.toContain('ECONNREFUSED')
    expect(JSON.stringify(body)).not.toContain('secret-upstream')
  })
})
