import { afterEach, describe, expect, it, vi, type Mock } from 'vitest'

vi.mock('../functions/_lib/crmAuth', () => ({ isLocalDevAuthBypassEnabled: vi.fn() }))
vi.mock('../functions/_lib/proxy', () => ({
  copySetCookieHeaders: vi.fn(),
  proxyRequestBody: vi.fn(() => undefined),
  sanitizeProxyRequestHeaders: vi.fn(() => new Headers()),
}))

import { onRequest } from '../functions/api/wa-orchestrator/[[path]].ts'
import { isLocalDevAuthBypassEnabled } from '../functions/_lib/crmAuth'

const originalFetch = globalThis.fetch

afterEach(() => {
  globalThis.fetch = originalFetch
  vi.clearAllMocks()
})

describe('WhatsApp Orchestrator local proxy', () => {
  it('returns an explicit configuration error instead of a healthy empty stub', async () => {
    ;(isLocalDevAuthBypassEnabled as Mock).mockReturnValue(true)

    const response = await onRequest({
      request: new Request('http://localhost:8791/api/wa-orchestrator/status'),
      env: { LOCAL_AUTH_BYPASS: 'true' },
    })

    expect(response.status).toBe(503)
    await expect(response.json()).resolves.toEqual(expect.objectContaining({
      success: false,
      localStub: true,
      code: 'WA_ORCHESTRATOR_API_TARGET_REQUIRED',
      reachability: 'not_configured',
    }))
  })

  it('never uses the Insumos target as a WhatsApp fallback', async () => {
    ;(isLocalDevAuthBypassEnabled as Mock).mockReturnValue(true)

    const response = await onRequest({
      request: new Request('http://localhost:8791/api/wa-orchestrator/_proxy-status'),
      env: {
        LOCAL_AUTH_BYPASS: 'true',
        INSUMOS_API_TARGET: 'http://127.0.0.1:8787',
      },
    })

    expect(response.status).toBe(503)
    await expect(response.json()).resolves.toEqual(expect.objectContaining({
      target: null,
      targetSource: null,
      reason: 'WA_ORCHESTRATOR_API_TARGET_REQUIRED',
    }))
  })

  it('proxies the status route only to the explicit WhatsApp target', async () => {
    ;(isLocalDevAuthBypassEnabled as Mock).mockReturnValue(true)
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ success: true, channels: [] }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    }))
    globalThis.fetch = fetchMock as typeof fetch

    const response = await onRequest({
      request: new Request('http://localhost:8791/api/wa-orchestrator/status'),
      env: {
        LOCAL_AUTH_BYPASS: 'true',
        WA_ORCHESTRATOR_API_TARGET: 'http://127.0.0.1:8110',
        INSUMOS_API_TARGET: 'http://127.0.0.1:8787',
      },
    })

    expect(response.status).toBe(200)
    expect((fetchMock.mock.calls[0]?.[0] as Request).url).toBe('http://127.0.0.1:8110/api/wa-orchestrator/status')
  })

  it('reports real mode and reachability without disclosing credentials', async () => {
    ;(isLocalDevAuthBypassEnabled as Mock).mockReturnValue(true)
    const fetchMock = vi.fn(async () => new Response('', { status: 200 }))
    globalThis.fetch = fetchMock as typeof fetch

    const response = await onRequest({
      request: new Request('http://localhost:8791/api/wa-orchestrator/_proxy-status'),
      env: {
        LOCAL_AUTH_BYPASS: 'true',
        WA_ORCHESTRATOR_API_TARGET: 'http://127.0.0.1:8110',
        WA_ORCHESTRATOR_BASIC_AUTH: 'private-user:private-password',
      },
    })

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual(expect.objectContaining({
      ok: true,
      mode: 'real',
      localStub: false,
      target: 'http://127.0.0.1:8110/',
      targetSource: 'WA_ORCHESTRATOR_API_TARGET',
      hasBasicAuth: true,
      reachability: 'reachable',
    }))
    expect(fetchMock).toHaveBeenCalledWith('http://127.0.0.1:8110/health', expect.anything())
  })
})
