import { afterEach, describe, expect, it, vi } from 'vitest'
import { getCrmUser } from '../functions/_lib/crmAuth'

function context(env: Record<string, unknown> = {}) {
  return {
    request: new Request('https://crm.skincos.com.br/api/atendimento/conversations', {
      headers: { cookie: 'session=test-session; csrfToken=test-csrf' },
    }),
    env,
  }
}

describe('CRM auth adapter', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('resolves the session against the canonical auth backend instead of the CRM Pages origin', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      ok: true,
      user: {
        username: 'consultor-nh',
        displayName: 'Consultor NH',
        role: 'CONSULTOR',
        allowedUnits: ['Novo Hamburgo'],
        allowedModules: ['atendimento'],
      },
    }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    }))
    vi.stubGlobal('fetch', fetchMock)

    const user = await getCrmUser(context({
      INSUMOS_API_TARGET: 'https://api.skincos.com.br',
    }))

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('https://api.skincos.com.br/insumos/auth/me')
    expect((init as RequestInit).headers).toBeInstanceOf(Headers)
    expect(((init as RequestInit).headers as Headers).get('cookie')).toContain('session=test-session')
    expect(user).toMatchObject({
      id: 'consultor-nh',
      role: 'CONSULTOR',
      allowedUnits: ['Novo Hamburgo'],
      allowedModules: ['atendimento'],
    })
  })

  it('keeps explicit auth target and path overrides authoritative', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      user: { id: 'gestor-1', role: 'GESTOR' },
    }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    }))
    vi.stubGlobal('fetch', fetchMock)

    await getCrmUser(context({
      AUTH_API_TARGET: 'https://auth.internal.test',
      AUTH_PATH_PREFIX: '/custom/auth/',
      INSUMOS_API_TARGET: 'https://api.skincos.com.br',
    }))

    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(fetchMock.mock.calls[0][0]).toBe('https://auth.internal.test/custom/auth/me')
  })

  it('ignores an auth target that points back at the current CRM request origin', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      user: { id: 'gestor-1', role: 'GESTOR' },
    }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    }))
    vi.stubGlobal('fetch', fetchMock)

    const user = await getCrmUser(context({
      AUTH_API_TARGET: 'https://crm.skincos.com.br',
      INSUMOS_API_TARGET: 'https://api.skincos.com.br',
    }))

    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(fetchMock.mock.calls[0][0]).toBe('https://api.skincos.com.br/insumos/auth/me')
    expect(user).toMatchObject({ id: 'gestor-1', role: 'GESTOR' })
  })

  it('falls back to legacy auth mounts only when the canonical mount is absent', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(null, { status: 404 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        user: { id: 'legacy-user', role: 'CONSULTOR' },
      }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }))
    vi.stubGlobal('fetch', fetchMock)

    const user = await getCrmUser(context())

    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([
      'https://api.skincos.com.br/insumos/auth/me',
      'https://api.skincos.com.br/auth/me',
    ])
    expect(user?.id).toBe('legacy-user')
  })
})
