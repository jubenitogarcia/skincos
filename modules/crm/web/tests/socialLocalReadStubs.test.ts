import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest'

vi.mock('../functions/_lib/crmAuth', () => ({
  isLocalDevAuthBypassEnabled: vi.fn(),
  requireCrmUser: vi.fn(),
}))

vi.mock('../functions/_lib/socialAuth', () => ({
  requireSocialAdmin: vi.fn(),
}))

vi.mock('../functions/_lib/csrf', () => ({
  requireCsrfForMutations: vi.fn(() => null),
}))

vi.mock('../functions/_lib/r2', () => ({
  getShareBucket: vi.fn(),
  getJson: vi.fn(),
}))

vi.mock('../functions/_lib/socialQueue', () => ({ isPublished: vi.fn() }))
vi.mock('../functions/_lib/socialAccounts', () => ({ listSocialAccounts: vi.fn() }))

import { onRequestGet as listQueue } from '../functions/api/social/queue/list'
import { onRequestGet as listAccounts } from '../functions/api/social/admin/accounts'
import { isLocalDevAuthBypassEnabled, requireCrmUser } from '../functions/_lib/crmAuth'
import { requireSocialAdmin } from '../functions/_lib/socialAuth'
import { getShareBucket } from '../functions/_lib/r2'

const localContext = (url: string) => ({ request: new Request(url), env: { LOCAL_AUTH_BYPASS: 'true' } })

describe('Social read-only local stubs', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    ;(isLocalDevAuthBypassEnabled as Mock).mockReturnValue(true)
    ;(requireCrmUser as Mock).mockResolvedValue({ id: 'dev-local', role: 'GESTOR' })
    ;(requireSocialAdmin as Mock).mockResolvedValue({ id: 'dev-local', role: 'GESTOR' })
    ;(getShareBucket as Mock).mockReturnValue(null)
  })

  it('keeps the social queue readable locally without an R2 binding', async () => {
    const response = await listQueue(localContext('http://localhost:8791/api/social/queue/list?dateKey=100726'))

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual(expect.objectContaining({
      ok: true,
      dateKey: '100726',
      groups: [],
      localStub: true,
    }))
  })

  it('keeps social account discovery readable locally without an R2 binding', async () => {
    const response = await listAccounts(localContext('http://localhost:8791/api/social/admin/accounts'))

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual(expect.objectContaining({
      ok: true,
      accounts: [],
      localStub: true,
    }))
  })
})
