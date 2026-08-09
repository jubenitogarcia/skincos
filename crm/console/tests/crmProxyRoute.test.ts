import { afterEach, describe, expect, it, vi } from 'vitest'
import { buildCrmTargetUrl, onRequest } from '../functions/api/crm/[[path]]'

function createContext(url: string, env: Record<string, unknown> = {}) {
  return {
    request: new Request(url, {
      headers: { accept: 'application/json', cookie: 'session=synthetic' },
    }),
    env,
  }
}

afterEach(() => vi.unstubAllGlobals())

describe('CRM API proxy mount', () => {
  it('mounts admin and team routes on the Core gateway Inventory binding', () => {
    expect(buildCrmTargetUrl('https://api-staging.skincos.com.br', '/admin/team', '?mode=config'))
      .toBe('https://api-staging.skincos.com.br/inventory/admin/team?mode=config')
  })

  it('preserves a configured origin base path and query string', () => {
    expect(buildCrmTargetUrl('https://api.example.test/base/', '/auth/me', '?status=active'))
      .toBe('https://api.example.test/base/inventory/auth/me?status=active')
  })

  it('uses the canonical mount when the Pages handler proxies a request', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response('{"success":true}', {
      status: 200,
      headers: { 'content-type': 'application/json' },
    }))
    vi.stubGlobal('fetch', fetchMock)

    const response = await onRequest(createContext(
      'https://crm-staging.skincos.com.br/api/crm/admin/team?mode=config',
      { INSUMOS_API_TARGET: 'https://api-staging.skincos.com.br' },
    ))

    expect(response.status).toBe(200)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect((fetchMock.mock.calls[0][0] as Request).url)
      .toBe('https://api-staging.skincos.com.br/inventory/admin/team?mode=config')
  })
})
