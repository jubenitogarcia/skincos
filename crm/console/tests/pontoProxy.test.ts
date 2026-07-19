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

  it('normalizes the CRM RH role to the Workforce HR contract', async () => {
    ;(getInsumosUser as Mock).mockResolvedValue({ id: 'rh-1', email: 'rh@example.test', role: 'RH', allowedUnits: ['UNIT_A'] })
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ ok: true, data: [] }), { headers: { 'content-type': 'application/json' } }))
    vi.stubGlobal('fetch', fetchMock)
    await onRequest(context('/api/ponto/employees'))
    const upstream = fetchMock.mock.calls[0][0] as Request
    const actor = JSON.parse(Buffer.from(String(upstream.headers.get('x-skincos-actor')), 'base64url').toString('utf8'))
    expect(actor.role).toBe('HR')
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
})
