import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest'

vi.mock('../functions/_lib/crmAuth', () => ({
  requireCrmUser: vi.fn(),
  isLocalDevAuthBypassEnabled: vi.fn(),
}))

import { onRequest, __testables } from '../functions/api/escala/[[path]].ts'
import { requireCrmUser, isLocalDevAuthBypassEnabled } from '../functions/_lib/crmAuth'

function createContext(url: string, env: Record<string, unknown> = {}, init: RequestInit = {}) {
  return {
    request: new Request(url, {
      ...init,
      headers: {
        accept: 'application/json',
        'content-type': 'application/json',
        ...(init.headers || {}),
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

  it('treats placeholder HMAC values as missing and falls back to local mock in localhost', () => {
    ;(isLocalDevAuthBypassEnabled as Mock).mockReturnValue(true)

    const enabled = __testables.isLocalEscalaMockEnabled(
      createContext('http://localhost:8791/api/escala/overview'),
      'https://escala-api.skincos.com.br',
      '__CONFIGURE_REAL_ESCALA_HMAC_KEY__',
    )

    expect(enabled).toBe(true)
  })

  it('does not let an explicit false override disable the local fallback without a real HMAC key', () => {
    ;(isLocalDevAuthBypassEnabled as Mock).mockReturnValue(true)

    const enabled = __testables.isLocalEscalaMockEnabled(
      createContext('http://localhost:8791/api/escala/overview', {
        LOCAL_ESCALA_MOCK: 'false',
      }),
      'https://escala-api.skincos.com.br',
      '__CONFIGURE_REAL_ESCALA_HMAC_KEY__',
    )

    expect(enabled).toBe(true)
  })

  it('uses local mock mode to dry-run and commit Atendimento scale imports', async () => {
    ;(requireCrmUser as Mock).mockResolvedValue({
      id: 'gestor-1',
      username: 'gestor',
      email: 'gestor@local.test',
      displayName: 'Gestor Local',
      role: 'GESTOR',
      allowedUnits: ['Novo Hamburgo'],
    })
    ;(isLocalDevAuthBypassEnabled as Mock).mockReturnValue(true)

    const env = {
      LOCAL_ESCALA_MOCK: 'true',
      ESCALA_API_TARGET: '',
      ESCALA_ACTOR_HMAC_KEY: '',
    }
    const feed = {
      professionals: [{ name: 'Dra. Sincronizada Teste', role: 'Injetor', status: 'Ativo', units: ['Novo Hamburgo'] }],
      schedule: [{ date: '2026-06-03', unit: 'Novo Hamburgo', professional: 'Dra. Sincronizada Teste' }],
      closedDays: [{ date: '2026-06-04', unit: 'Novo Hamburgo', reason: 'Sem Atendimento' }],
    }

    const dryRunResponse = await onRequest(
      createContext('http://localhost:5173/api/escala/admin/import/atendimento', env, {
        method: 'POST',
        body: JSON.stringify({ feed, dryRun: true }),
      }),
    )

    expect(dryRunResponse.status).toBe(200)
    await expect(dryRunResponse.json()).resolves.toEqual(
      expect.objectContaining({
        ok: true,
        dryRun: true,
        summary: expect.objectContaining({
          professionals: expect.objectContaining({ toInsert: 1 }),
          schedule: expect.objectContaining({ toInsert: 1 }),
          closedDays: expect.objectContaining({ toInsert: 1 }),
        }),
      }),
    )

    const commitResponse = await onRequest(
      createContext('http://localhost:5173/api/escala/admin/import/atendimento', env, {
        method: 'POST',
        body: JSON.stringify({ feed, commit: true }),
      }),
    )

    expect(commitResponse.status).toBe(200)
    await expect(commitResponse.json()).resolves.toEqual(
      expect.objectContaining({
        ok: true,
        committed: true,
        summary: expect.objectContaining({
          professionals: expect.objectContaining({ toInsert: 1 }),
          schedule: expect.objectContaining({ toInsert: 1 }),
          closedDays: expect.objectContaining({ toInsert: 1 }),
        }),
      }),
    )

    const secondCommitResponse = await onRequest(
      createContext('http://localhost:5173/api/escala/admin/import/atendimento', env, {
        method: 'POST',
        body: JSON.stringify({ feed, commit: true }),
      }),
    )

    expect(secondCommitResponse.status).toBe(200)
    await expect(secondCommitResponse.json()).resolves.toEqual(
      expect.objectContaining({
        ok: true,
        summary: expect.objectContaining({
          professionals: expect.objectContaining({ toInsert: 0 }),
          schedule: expect.objectContaining({ toInsert: 0 }),
          closedDays: expect.objectContaining({ toInsert: 0 }),
        }),
      }),
    )
  })

  it('serves an empty prefill response in local mock mode', async () => {
    ;(requireCrmUser as Mock).mockResolvedValue({ id: 'gestor-1', role: 'GESTOR', allowedUnits: [] })
    ;(isLocalDevAuthBypassEnabled as Mock).mockReturnValue(true)

    const response = await onRequest(
      createContext('http://localhost:8791/api/escala/prefill?unit=novo-hamburgo&month=2026-07', {
        ESCALA_API_TARGET: 'https://escala-api.skincos.com.br',
        ESCALA_ACTOR_HMAC_KEY: '__CONFIGURE_REAL_ESCALA_HMAC_KEY__',
        LOCAL_ESCALA_MOCK: 'false',
      }),
    )

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual(expect.objectContaining({
      ok: true,
      suggestions: [],
      windowMonths: ['2026-07'],
      source: 'local-mock',
    }))
  })
})
