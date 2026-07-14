import { describe, expect, it, vi, type Mock } from 'vitest'

vi.mock('../functions/_lib/crmAuth', () => ({
  getLocalDevAuthUser: vi.fn(),
  isLocalDevAuthBypassEnabled: vi.fn(),
}))

vi.mock('../functions/_lib/proxy', () => ({
  copySetCookieHeaders: vi.fn(),
  proxyRequestBody: vi.fn(),
  sanitizeProxyRequestHeaders: vi.fn(),
}))

import { onRequest } from '../functions/api/insumos/[[path]].ts'
import { getLocalDevAuthUser, isLocalDevAuthBypassEnabled } from '../functions/_lib/crmAuth'

describe('Insumos local auth proxy', () => {
  it('uses the local CRM session for the Insumos auth preflight', async () => {
    ;(isLocalDevAuthBypassEnabled as Mock).mockReturnValue(true)
    ;(getLocalDevAuthUser as Mock).mockReturnValue({ id: 'dev', username: 'dev', role: 'GESTOR' })

    const response = await onRequest({
      request: new Request('http://localhost:8791/api/insumos/auth/me'),
      env: { LOCAL_AUTH_BYPASS: 'true' },
    })

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({
      success: true,
      user: { id: 'dev', username: 'dev', role: 'GESTOR' },
      csrfToken: 'local-dev-csrf',
    })
  })

  it('forwards an explicit local-only auth marker to the local Insumos Worker', async () => {
    ;(isLocalDevAuthBypassEnabled as Mock).mockReturnValue(true)
    const { sanitizeProxyRequestHeaders } = await import('../functions/_lib/proxy')
    ;(sanitizeProxyRequestHeaders as Mock).mockImplementation((headers: Headers) => new Headers(headers))
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ success: true }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    })))

    const response = await onRequest({
      request: new Request('http://localhost:8791/api/insumos/prefs'),
      env: { LOCAL_AUTH_BYPASS: 'true', INSUMOS_API_TARGET: 'http://127.0.0.1:8787' },
    })

    expect(response.status).toBe(200)
    const upstreamRequest = (fetch as Mock).mock.calls[0][0] as Request
    expect(upstreamRequest.headers.get('x-skincos-local-dev-auth')).toBe('1')
  })
})
