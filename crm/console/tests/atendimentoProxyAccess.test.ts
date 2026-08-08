import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest'

vi.mock('../functions/_lib/crmAuth', async () => {
  const actual = await vi.importActual<typeof import('../functions/_lib/crmAuth')>('../functions/_lib/crmAuth')
  return { ...actual, requireCrmUser: vi.fn() }
})

import { onRequest } from '../functions/api/atendimento/[[path]].ts'
import { requireCrmUser } from '../functions/_lib/crmAuth'

function createContext(url: string, env: Record<string, unknown>) {
  return { request: new Request(url, { headers: { accept: 'application/json' } }), env }
}

describe('Atendimento Clientes proxy access', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    vi.clearAllMocks()
  })
  afterEach(() => vi.unstubAllGlobals())

  it('rejects GERENTE from a Clientes route before opening the upstream request', async () => {
    ;(requireCrmUser as Mock).mockResolvedValue({ id: 'manager-1', role: 'GERENTE', allowedModules: ['atendimento'] })
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    const response = await onRequest(createContext(
      'https://crm.skincos.com.br/api/atendimento/commercial/overview',
      { ATENDIMENTO_API_TARGET: 'https://crm-api.skincos.com.br', ATENDIMENTO_ACTOR_HMAC_KEY: 'test-secret' },
    ))

    expect(response.status).toBe(403)
    await expect(response.json()).resolves.toEqual({ ok: false, error: 'FORBIDDEN' })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('forwards a GESTOR Clientes request to the configured upstream', async () => {
    ;(requireCrmUser as Mock).mockResolvedValue({ id: 'gestor-1', role: 'GESTOR', allowedModules: ['atendimento'] })
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    }))
    vi.stubGlobal('fetch', fetchMock)

    const response = await onRequest(createContext(
      'https://crm.skincos.com.br/api/atendimento/commercial/overview',
      { ATENDIMENTO_API_TARGET: 'https://crm-api.skincos.com.br', ATENDIMENTO_ACTOR_HMAC_KEY: 'test-secret' },
    ))

    expect(response.status).toBe(200)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const upstream = fetchMock.mock.calls[0][0] as Request
    expect(upstream.url).toBe('https://crm-api.skincos.com.br/api/atendimento/commercial/overview')
    expect(upstream.headers.get('x-crm-signature-version')).toBe('2')
    expect(upstream.headers.get('x-crm-nonce')).toMatch(/^[A-Za-z0-9_-]{16,128}$/)
    expect(upstream.headers.get('x-crm-signature')).toBeTruthy()
  })

  it('blocks a GESTOR identity review mutation at the edge before opening the upstream request', async () => {
    ;(requireCrmUser as Mock).mockResolvedValue({ id: 'gestor-1', role: 'GESTOR', allowedModules: ['atendimento'] })
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    const payload = {
      sourceId: 'app-registration-42',
      targetId: '4bcf7ee4-0b5a-4277-a7d8-a93bfcb80b51',
      expectedVersion: '35c54b6916b6b8191a17f8500ab103d8',
      decision: 'confirmed',
      reason: 'Cadastro e histórico clínico confirmam a mesma pessoa.',
    }

    const response = await onRequest({
      request: new Request('https://crm.skincos.com.br/api/atendimento/commercial/review/app_caixa/decision', {
        method: 'POST',
        headers: { accept: 'application/json', 'content-type': 'application/json' },
        body: JSON.stringify(payload),
      }),
      env: { ATENDIMENTO_API_TARGET: 'https://crm-api.skincos.com.br', ATENDIMENTO_ACTOR_HMAC_KEY: 'test-secret' },
    })

    expect(response.status).toBe(405)
    await expect(response.json()).resolves.toEqual({ ok: false, error: 'READ_ONLY_RUNTIME' })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('rejects GERENTE from an identity review decision before opening the upstream request', async () => {
    ;(requireCrmUser as Mock).mockResolvedValue({ id: 'manager-1', role: 'GERENTE', allowedModules: ['atendimento'] })
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    const response = await onRequest(createContext(
      'https://crm.skincos.com.br/api/atendimento/commercial/review/app_caixa/decision',
      { ATENDIMENTO_API_TARGET: 'https://crm-api.skincos.com.br', ATENDIMENTO_ACTOR_HMAC_KEY: 'test-secret' },
    ))

    expect(response.status).toBe(403)
    await expect(response.json()).resolves.toEqual({ ok: false, error: 'FORBIDDEN' })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('does not expose the token-gated internal surface through Pages', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    const response = await onRequest(createContext(
      'https://crm.skincos.com.br/api/atendimento/internal/readiness',
      { ATENDIMENTO_API_TARGET: 'https://crm-api.skincos.com.br', ATENDIMENTO_ACTOR_HMAC_KEY: 'test-secret' },
    ))

    expect(response.status).toBe(404)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('forwards only the PII-free public health path without minting an actor header', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ ok: true, readOnlyRuntime: true }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    }))
    vi.stubGlobal('fetch', fetchMock)

    const response = await onRequest(createContext(
      'https://crm.skincos.com.br/api/atendimento/health',
      { ATENDIMENTO_API_TARGET: 'https://crm-api.skincos.com.br' },
    ))

    expect(response.status).toBe(200)
    expect(requireCrmUser).not.toHaveBeenCalled()
    const upstream = fetchMock.mock.calls[0][0] as Request
    expect(upstream.url).toBe('https://crm-api.skincos.com.br/api/atendimento/health')
    expect(upstream.headers.has('x-crm-user')).toBe(false)
  })

  it('does not fall back to CRM_API_TARGET when the isolated target is absent', async () => {
    ;(requireCrmUser as Mock).mockResolvedValue({ id: 'gestor-1', role: 'GESTOR', allowedModules: ['atendimento'] })
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    const response = await onRequest(createContext(
      'https://crm.skincos.com.br/api/atendimento/commercial/overview',
      { CRM_API_TARGET: 'https://shared-crm.skincos.com.br', ATENDIMENTO_ACTOR_HMAC_KEY: 'test-secret' },
    ))

    expect(response.status).toBe(503)
    await expect(response.json()).resolves.toEqual({ ok: false, error: 'ATENDIMENTO_RUNTIME_UNAVAILABLE' })
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
