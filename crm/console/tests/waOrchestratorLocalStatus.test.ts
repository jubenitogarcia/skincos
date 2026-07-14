import { describe, expect, it, vi, type Mock } from 'vitest'

vi.mock('../functions/_lib/crmAuth', () => ({ isLocalDevAuthBypassEnabled: vi.fn() }))
vi.mock('../functions/_lib/proxy', () => ({
  copySetCookieHeaders: vi.fn(),
  proxyRequestBody: vi.fn(),
  sanitizeProxyRequestHeaders: vi.fn(),
}))

import { onRequest } from '../functions/api/wa-orchestrator/[[path]].ts'
import { isLocalDevAuthBypassEnabled } from '../functions/_lib/crmAuth'

describe('WhatsApp Orchestrator local status', () => {
  it('returns an empty healthy status for localhost bypass without basic auth', async () => {
    ;(isLocalDevAuthBypassEnabled as Mock).mockReturnValue(true)

    const response = await onRequest({
      request: new Request('http://localhost:8791/api/wa-orchestrator/status'),
      env: { LOCAL_AUTH_BYPASS: 'true' },
    })

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual(expect.objectContaining({
      success: true,
      provider: 'evolution',
      channels: [],
      localStub: true,
    }))
  })

  it('keeps the local event stream healthy without an orchestrator credential', async () => {
    ;(isLocalDevAuthBypassEnabled as Mock).mockReturnValue(true)

    const response = await onRequest({
      request: new Request('http://localhost:8791/api/wa-orchestrator/events'),
      env: { LOCAL_AUTH_BYPASS: 'true' },
    })

    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toContain('text/event-stream')
    await expect(response.text()).resolves.toContain('localStub')
  })
})
