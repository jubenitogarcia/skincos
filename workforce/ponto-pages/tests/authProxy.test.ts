import { afterEach, describe, expect, it, vi } from 'vitest'
import { onRequest } from '../functions/api/auth/[[path]]'

const request = (path: string) => new Request(`https://ponto.skincos.com.br${path}`, { headers: { cookie: 'session=opaque' } })

afterEach(() => vi.unstubAllGlobals())

describe('Ponto auth proxy', () => {
  it('fails closed when Phase 1 has no explicit environment target', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    const response = await onRequest({ request: request('/api/auth/me'), env: { SKINCOS_DEPLOYMENT_ENV: 'unconfigured' } })
    expect(response.status).toBe(503)
    expect(fetchMock).not.toHaveBeenCalled()
    await expect(response.json()).resolves.toMatchObject({ error: 'PONTO_AUTH_PROXY_UNCONFIGURED' })
  })

  it('uses the approved production target and rewrites cookies only to the shared domain', async () => {
    const upstreamHeaders = new Headers({ 'content-type': 'application/json' })
    upstreamHeaders.append('set-cookie', 'session=new-session; Path=/; HttpOnly; Secure; SameSite=None')
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ ok: true }), { headers: upstreamHeaders }))
    vi.stubGlobal('fetch', fetchMock)
    const response = await onRequest({
      request: request('/api/auth/me'),
      env: { SKINCOS_DEPLOYMENT_ENV: 'production', AUTH_API_TARGET: 'https://api.skincos.com.br' },
    })
    expect(response.status).toBe(200)
    const upstream = fetchMock.mock.calls[0][0] as Request
    expect(upstream.url).toBe('https://api.skincos.com.br/insumos/auth/me')
    expect(upstream.headers.get('cookie')).toBe('session=opaque')
    expect(response.headers.get('set-cookie')).toContain('Domain=.skincos.com.br')
  })
})
