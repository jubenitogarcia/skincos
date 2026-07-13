import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { onRequest } from '../functions/api/insumos/[[path]].ts'

function createContext(url: string, env: Record<string, unknown> = {}) {
  return {
    request: new Request(url, {
      headers: {
        accept: 'application/json',
        cookie: 'session=old-host-cookie; csrfToken=old-host-csrf',
      },
    }),
    env,
  }
}

function getSetCookies(response: Response): string[] {
  const getSetCookie = (response.headers as any).getSetCookie?.bind?.(response.headers)
  if (typeof getSetCookie === 'function') return getSetCookie() as string[]
  const raw = response.headers.get('set-cookie')
  return raw ? [raw] : []
}

describe('Insumos proxy cookie contract', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('rewrites auth cookies to the shared skincos domain and clears legacy host-only variants', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ success: true, csrfToken: 'new-csrf' }), {
          status: 200,
          headers: {
            'content-type': 'application/json',
            'set-cookie': [
              'session=new-session; Path=/; HttpOnly; Secure; SameSite=None; Domain=api.skincos.com.br; Max-Age=604800',
              'csrfToken=new-csrf; Path=/; Secure; SameSite=None; Domain=api.skincos.com.br; Max-Age=604800',
            ].join(', '),
          },
        }),
      ),
    )

    const response = await onRequest(
      createContext('https://crm.skincos.com.br/api/insumos/auth/me', {
        INSUMOS_API_TARGET: 'https://api.skincos.com.br',
      }),
    )

    expect(response.status).toBe(200)
    const cookies = getSetCookies(response)
    expect(cookies).toEqual(
      expect.arrayContaining([
        expect.stringContaining('session=new-session'),
        expect.stringContaining('csrfToken=new-csrf'),
        expect.stringContaining('Domain=.skincos.com.br'),
        expect.stringContaining('session=deleted'),
        expect.stringContaining('csrfToken=deleted'),
      ]),
    )
  })

  it('preserves an upstream share history failure instead of masking it as an empty result', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ success: false, error: 'NOT_FOUND' }), {
          status: 404,
          headers: { 'content-type': 'application/json' },
        }),
      ),
    )

    const response = await onRequest(
      createContext('http://localhost:8791/api/insumos/share/history?limit=12', {
        INSUMOS_API_TARGET: 'http://127.0.0.1:8787',
      }),
    )

    expect(response.status).toBe(404)
    await expect(response.json()).resolves.toEqual({ success: false, error: 'NOT_FOUND' })
  })
})
