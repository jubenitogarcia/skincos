import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest'

vi.mock('../functions/_lib/insumosAuth', () => ({ getInsumosUser: vi.fn() }))
import { getInsumosUser } from '../functions/_lib/insumosAuth'
import { onRequest } from '../functions/api/ponto/[[path]]'

function context(path: string, init: RequestInit = {}, withCsrf = true) {
  const method = String(init.method || 'GET').toUpperCase()
  const headers = new Headers(init.headers)
  if (withCsrf && !['GET', 'HEAD', 'OPTIONS'].includes(method)) {
    headers.set('cookie', 'session=test-session; csrfToken=test-csrf')
    headers.set('x-csrf-token', 'test-csrf')
  }
  return { request: new Request(`https://crm.skincos.com.br${path}`, { ...init, headers }), env: { PONTO_API_TARGET: 'https://api.skincos.com.br', PONTO_ACTOR_HMAC_KEY: 'proxy-test-key' } }
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
    expect(actor).toMatchObject({ role: 'MANAGER', allowedUnits: ['UNIT_A'] })
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
    await onRequest(context('/api/ponto/health', { headers: { cookie: 'session=secret', 'x-custom-secret': 'secret' } }))
    const upstream = fetchMock.mock.calls[0][0] as Request
    expect(upstream.headers.get('cookie')).toBeNull(); expect(upstream.headers.get('x-custom-secret')).toBeNull()
  })

  it('signs Cloudflare-observed network context only for explicit device routes', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ ok: true }), { headers: { 'content-type': 'application/json' } }))
    vi.stubGlobal('fetch', fetchMock)
    const ctx = context('/api/ponto/device/context', { headers: { authorization: 'Device terminal-token', 'cf-connecting-ip': '203.0.113.10' } })
    ;(ctx.env as any).PONTO_NETWORK_CONTEXT_KEY = 'network-test-key'
    await onRequest(ctx)
    const upstream = fetchMock.mock.calls[0][0] as Request
    expect(upstream.headers.get('authorization')).toBe('Device terminal-token')
    expect(upstream.headers.get('x-skincos-network-ip')).toBe('203.0.113.10')
    expect(upstream.headers.get('x-skincos-network-sig')).toBeTruthy()
    expect(upstream.headers.get('cookie')).toBeNull()
  })
})
