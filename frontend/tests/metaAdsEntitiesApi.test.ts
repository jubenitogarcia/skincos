import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest'

vi.mock('../functions/_lib/socialAuth', () => ({
  requireSocialAdmin: vi.fn(),
}))

vi.mock('../functions/_lib/r2', () => ({
  getShareBucket: vi.fn(),
}))

vi.mock('../functions/_lib/integrationsEncryption', () => ({
  getIntegrationsEncryptionSecret: vi.fn(),
  integrationsEncryptionSecretRequired: vi.fn(() => false),
}))

vi.mock('../functions/_lib/metaAdsStore', () => ({
  readMetaAdsConnectionDecrypted: vi.fn(),
  writeMetaAdsConnection: vi.fn(),
  deleteMetaAdsConnection: vi.fn(),
}))

vi.mock('../functions/_lib/metaAdsGraph', async () => {
  const actual = await vi.importActual<typeof import('../functions/_lib/metaAdsGraph')>('../functions/_lib/metaAdsGraph')
  return {
    ...actual,
    getMetaAdsEntityDetail: vi.fn(),
    updateMetaAdsEntity: vi.fn(),
  }
})

import { onRequest } from '../functions/api/meta-ads/[[path]].ts'
import { requireSocialAdmin } from '../functions/_lib/socialAuth'
import { getShareBucket } from '../functions/_lib/r2'
import { readMetaAdsConnectionDecrypted } from '../functions/_lib/metaAdsStore'
import { getMetaAdsEntityDetail, updateMetaAdsEntity } from '../functions/_lib/metaAdsGraph'

function createContext(url: string, init?: RequestInit) {
  return {
    request: new Request(url, {
      headers: {
        accept: 'application/json',
        'content-type': 'application/json',
        cookie: 'csrfToken=test-csrf',
        'x-csrf-token': 'test-csrf',
        origin: 'https://crm.skincos.com.br',
        ...(init?.headers || {}),
      },
      ...init,
    }),
    env: {
      META_GRAPH_VERSION: 'v20.0',
    },
  }
}

function mockConnection(scopes = ['ads_read', 'ads_management']) {
  ;(requireSocialAdmin as Mock).mockResolvedValue({ id: 'user-1', role: 'GESTOR' })
  ;(getShareBucket as Mock).mockReturnValue({})
  ;(readMetaAdsConnectionDecrypted as Mock).mockResolvedValue({
    accessToken: 'token',
    tokenType: 'oauth',
    selectedAdAccountId: 'act_123',
    scopes,
    grantedScopes: scopes,
    updatedAt: '2026-05-28T12:00:00.000Z',
  })
}

describe('Meta Ads live entity API', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    mockConnection()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('returns live entity details for the selected ad account', async () => {
    ;(getMetaAdsEntityDetail as Mock).mockResolvedValue({
      id: 'cmp_1',
      account_id: 'act_123',
      name: 'Campanha Primavera',
      status: 'ACTIVE',
      effective_status: 'ACTIVE',
    })

    const response = await onRequest(createContext('https://crm.skincos.com.br/api/meta-ads/entities/campaign/cmp_1'))
    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual(
      expect.objectContaining({
        ok: true,
        entity: expect.objectContaining({
          type: 'campaign',
          id: 'cmp_1',
          accountId: '123',
          editable: true,
          editableFields: expect.arrayContaining(['name', 'status']),
        }),
      }),
    )
  })

  it('keeps potentially editable fields visible but locked without ads_management', async () => {
    mockConnection(['ads_read'])
    ;(getMetaAdsEntityDetail as Mock).mockResolvedValue({
      id: 'cmp_1',
      account_id: 'act_123',
      name: 'Campanha Primavera',
      status: 'ACTIVE',
    })

    const response = await onRequest(createContext('https://crm.skincos.com.br/api/meta-ads/entities/campaign/cmp_1'))
    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual(
      expect.objectContaining({
        ok: true,
        entity: expect.objectContaining({
          editable: false,
          editableFields: expect.arrayContaining(['name', 'status']),
          readOnlyReason: expect.stringContaining('ads_management'),
        }),
      }),
    )
  })

  it('rejects live details for entities outside the selected ad account', async () => {
    ;(getMetaAdsEntityDetail as Mock).mockResolvedValue({
      id: 'cmp_1',
      account_id: 'act_999',
      name: 'Outra conta',
    })

    const response = await onRequest(createContext('https://crm.skincos.com.br/api/meta-ads/entities/campaign/cmp_1'))
    expect(response.status).toBe(403)
    await expect(response.json()).resolves.toEqual(
      expect.objectContaining({
        ok: false,
        code: 'META_ADS_ENTITY_ACCOUNT_MISMATCH',
      }),
    )
  })

  it('updates allowlisted campaign fields through Graph only after ownership validation', async () => {
    ;(getMetaAdsEntityDetail as Mock)
      .mockResolvedValueOnce({
        id: 'cmp_1',
        account_id: 'act_123',
        name: 'Campanha Primavera',
        status: 'ACTIVE',
      })
      .mockResolvedValueOnce({
        id: 'cmp_1',
        account_id: 'act_123',
        name: 'Campanha Primavera v2',
        status: 'PAUSED',
      })
    ;(updateMetaAdsEntity as Mock).mockResolvedValue({ success: true })

    const response = await onRequest(
      createContext('https://crm.skincos.com.br/api/meta-ads/entities/campaign/cmp_1', {
        method: 'PATCH',
        body: JSON.stringify({ patch: { name: 'Campanha Primavera v2', status: 'PAUSED' } }),
      }),
    )

    expect(response.status).toBe(200)
    expect(updateMetaAdsEntity).toHaveBeenCalledWith('token', 'campaign', 'cmp_1', {
      name: 'Campanha Primavera v2',
      status: 'PAUSED',
    }, 'v20.0', '')
    await expect(response.json()).resolves.toEqual(
      expect.objectContaining({
        ok: true,
        changedFields: ['name', 'status'],
      }),
    )
  })

  it('blocks non-allowlisted update fields', async () => {
    ;(getMetaAdsEntityDetail as Mock).mockResolvedValue({
      id: 'cmp_1',
      account_id: 'act_123',
      name: 'Campanha Primavera',
    })

    const response = await onRequest(
      createContext('https://crm.skincos.com.br/api/meta-ads/entities/campaign/cmp_1', {
        method: 'PATCH',
        body: JSON.stringify({ patch: { objective: 'MESSAGES' } }),
      }),
    )

    expect(response.status).toBe(400)
    expect(updateMetaAdsEntity).not.toHaveBeenCalled()
    await expect(response.json()).resolves.toEqual(
      expect.objectContaining({
        ok: false,
        code: 'META_ADS_FIELD_NOT_EDITABLE',
      }),
    )
  })

  it('keeps creatives read-only in V1', async () => {
    const response = await onRequest(
      createContext('https://crm.skincos.com.br/api/meta-ads/entities/creative/cr_1', {
        method: 'PATCH',
        body: JSON.stringify({ patch: { name: 'Novo criativo' } }),
      }),
    )

    expect(response.status).toBe(405)
    expect(updateMetaAdsEntity).not.toHaveBeenCalled()
    await expect(response.json()).resolves.toEqual(
      expect.objectContaining({
        ok: false,
        code: 'META_ADS_CREATIVE_READ_ONLY',
      }),
    )
  })
})
