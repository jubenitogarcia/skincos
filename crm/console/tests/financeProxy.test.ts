import { afterEach, describe, expect, it, vi } from 'vitest'

import { onRequest } from '../functions/api/finance/[[path]].ts'

function createContext(url: string, env: Record<string, unknown> = {}) {
  return { request: new Request(url), env }
}

describe('Finance proxy staging boundary', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('fails closed instead of falling back to production in staging', async () => {
    const response = await onRequest(createContext('https://skincos-staging.pages.dev/api/finance/bootstrap', {
      SKINCOS_DEPLOYMENT_ENV: 'staging',
    }))

    expect(response.status).toBe(503)
    await expect(response.json()).resolves.toEqual({ ok: false, error: 'STAGING_FINANCE_TARGET_INVALID' })
  })

  it('forwards only to the isolated Finance gateway when staging is configured', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ ok: false, error: 'UNAUTHORIZED' }), {
      status: 401,
      headers: { 'content-type': 'application/json' },
    }))
    vi.stubGlobal('fetch', fetchMock)

    const response = await onRequest(createContext('https://skincos-staging.pages.dev/api/finance/bootstrap', {
      SKINCOS_DEPLOYMENT_ENV: 'staging',
      FINANCE_API_TARGET: 'https://api-staging.skincos.com.br',
    }))

    expect(response.status).toBe(401)
    expect(fetchMock).toHaveBeenCalledOnce()
    expect((fetchMock.mock.calls[0][0] as Request).url).toBe('https://api-staging.skincos.com.br/finance/bootstrap')
  })
})
