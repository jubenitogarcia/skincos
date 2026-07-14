import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest'

vi.mock('../functions/_lib/crmAuth', () => ({
  requireCrmUser: vi.fn(),
  isLocalDevAuthBypassEnabled: vi.fn(),
}))

vi.mock('../functions/_lib/r2', () => ({
  getShareBucket: vi.fn(),
}))

vi.mock('../functions/_lib/instagramStore', () => ({
  readConnectionDecrypted: vi.fn(),
}))

vi.mock('../functions/_lib/instagramGraph', () => ({
  graphGet: vi.fn(),
}))

vi.mock('../functions/_lib/integrationsEncryption', () => ({
  getIntegrationsEncryptionSecret: vi.fn(),
  integrationsEncryptionSecretRequired: vi.fn(() => false),
  isMissingIntegrationsEncryptionSecretError: vi.fn(() => false),
}))

import { onRequestGet } from '../functions/api/instagram/status'
import { requireCrmUser, isLocalDevAuthBypassEnabled } from '../functions/_lib/crmAuth'
import { getShareBucket } from '../functions/_lib/r2'

function createContext(url: string, env: Record<string, unknown> = {}) {
  return {
    request: new Request(url, {
      headers: {
        accept: 'application/json',
      },
    }),
    env,
  }
}

describe('Instagram status local contract', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    ;(requireCrmUser as Mock).mockResolvedValue({ id: 'dev-local', role: 'GESTOR' })
  })

  it('returns a healthy local stub when localhost bypass is active and SHARE_BUCKET is absent', async () => {
    ;(isLocalDevAuthBypassEnabled as Mock).mockReturnValue(true)
    ;(getShareBucket as Mock).mockReturnValue(null)

    const response = await onRequestGet(
      createContext('http://localhost:8791/api/instagram/status', {
        LOCAL_AUTH_BYPASS: 'true',
      }),
    )

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual(
      expect.objectContaining({
        ok: true,
        connected: false,
        localStub: true,
        reason: 'SHARE_BUCKET_NOT_CONFIGURED',
      }),
    )
  })

  it('keeps the production-style failure when not in localhost dev bypass', async () => {
    ;(isLocalDevAuthBypassEnabled as Mock).mockReturnValue(false)
    ;(getShareBucket as Mock).mockReturnValue(null)

    const response = await onRequestGet(
      createContext('https://crm.skincos.com.br/api/instagram/status'),
    )

    expect(response.status).toBe(503)
    await expect(response.json()).resolves.toEqual(
      expect.objectContaining({
        ok: false,
        error: 'SHARE_BUCKET not configured',
      }),
    )
  })
})
