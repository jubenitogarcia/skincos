import { afterEach, describe, expect, it, vi } from 'vitest'
import { getPontoUser, normalizePontoRole } from '../functions/_lib/pontoAuth'

afterEach(() => vi.unstubAllGlobals())

describe('Ponto auth boundary', () => {
  it('preserves ADMIN while normalizing the legacy aliases accepted by Ponto', () => {
    expect(normalizePontoRole('ADMIN')).toBe('ADMIN')
    expect(normalizePontoRole('RH')).toBe('SUPERVISOR')
    expect(normalizePontoRole('employee')).toBe('CONSULTOR')
  })

  it('uses only the auth-me envelope and forwards the session cookie', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ user: { id: 'user-1', username: 'ana', email: 'ana@example.test', role: 'ADMIN', allowedUnits: ['novo-hamburgo'] } }), { headers: { 'content-type': 'application/json' } }))
    vi.stubGlobal('fetch', fetchMock)
    const user = await getPontoUser({ request: new Request('https://ponto.example.test/api/ponto/me', { headers: { cookie: 'session=opaque' } }), env: { SKINCOS_DEPLOYMENT_ENV: 'production', AUTH_API_TARGET: 'https://api.skincos.com.br' } })
    expect(user).toMatchObject({ id: 'ana', role: 'ADMIN', allowedUnits: ['novo-hamburgo'] })
    expect(fetchMock).toHaveBeenCalledWith('https://api.skincos.com.br/insumos/auth/me', expect.objectContaining({ headers: expect.any(Headers) }))
    const headers = fetchMock.mock.calls[0][1].headers as Headers
    expect(headers.get('cookie')).toBe('session=opaque')
  })

  it('does not fall back to production when the runtime is unconfigured', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    const user = await getPontoUser({ request: new Request('https://ponto.example.test/api/ponto/me'), env: { SKINCOS_DEPLOYMENT_ENV: 'unconfigured' } })
    expect(user).toBeNull()
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
