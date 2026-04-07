import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest'

vi.mock('../functions/_lib/crmAuth', () => ({
  requireCrmUser: vi.fn(),
  isLocalDevAuthBypassEnabled: vi.fn(),
}))

import { onRequest, __testables } from '../functions/api/escala/[[path]].ts'
import { requireCrmUser, isLocalDevAuthBypassEnabled } from '../functions/_lib/crmAuth'

function createContext(url: string, env: Record<string, unknown> = {}) {
  return {
    request: new Request(url, {
      headers: {
        accept: 'application/json',
        'content-type': 'application/json',
      },
    }),
    env,
  }
}

describe('Escala proxy contract', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('builds the upstream URL preserving nested base path and query string', () => {
    expect(
      __testables.buildEscalaTargetUrl(
        'https://escala-api.skincos.com.br/proxy-root',
        'https://crm.skincos.com.br/api/escala/schedule?unit=Novo%20Hamburgo&month=2026-04',
        '/schedule',
      ),
    ).toBe('https://escala-api.skincos.com.br/proxy-root/api/escala/schedule?unit=Novo%20Hamburgo&month=2026-04')
  })

  it('forwards signed actor headers to the worker', async () => {
    ;(requireCrmUser as Mock).mockResolvedValue({
      id: 'gestor-1',
      username: 'gestor',
      email: 'gestor@local.test',
      displayName: 'Gestor Local',
      role: 'GESTOR',
      allowedUnits: ['Novo Hamburgo'],
    })
    ;(isLocalDevAuthBypassEnabled as Mock).mockReturnValue(false)

    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ ok: true, data: [] }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    )
    vi.stubGlobal('fetch', fetchMock)

    const response = await onRequest(
      createContext('https://crm.skincos.com.br/api/escala/professionals?unit=Novo%20Hamburgo', {
        ESCALA_API_TARGET: 'https://escala-api.skincos.com.br',
        ESCALA_ACTOR_HMAC_KEY: 'test-secret',
      }),
    )

    expect(response.status).toBe(200)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const upstreamRequest = fetchMock.mock.calls[0][0] as Request
    expect(upstreamRequest.url).toBe('https://escala-api.skincos.com.br/api/escala/professionals?unit=Novo%20Hamburgo')
    expect(upstreamRequest.headers.get('x-crm-user')).toBeTruthy()
    expect(upstreamRequest.headers.get('x-crm-ts')).toMatch(/^\d+$/)
    expect(upstreamRequest.headers.get('x-crm-signature')).toBeTruthy()
    expect(upstreamRequest.headers.get('x-request-id')).toBeTruthy()
  })

  it('returns 502 when the worker is unreachable', async () => {
    ;(requireCrmUser as Mock).mockResolvedValue({
      id: 'gestor-1',
      role: 'GESTOR',
      allowedUnits: ['Novo Hamburgo'],
    })
    ;(isLocalDevAuthBypassEnabled as Mock).mockReturnValue(false)
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('socket hang up')))

    const response = await onRequest(
      createContext('https://crm.skincos.com.br/api/escala/overview', {
        ESCALA_API_TARGET: 'https://escala-api.skincos.com.br',
        ESCALA_ACTOR_HMAC_KEY: 'test-secret',
      }),
    )

    expect(response.status).toBe(502)
    await expect(response.json()).resolves.toEqual(
      expect.objectContaining({
        ok: false,
        error: 'UPSTREAM_UNREACHABLE',
      }),
    )
  })

  it('does not enable local mock mode outside localhost even if the env toggle is set', () => {
    ;(isLocalDevAuthBypassEnabled as Mock).mockReturnValue(false)

    const enabled = __testables.isLocalEscalaMockEnabled(
      createContext('https://crm.skincos.com.br/api/escala/overview', {
        LOCAL_ESCALA_MOCK: 'true',
      }),
      '',
      '',
    )

    expect(enabled).toBe(false)
  })
})
