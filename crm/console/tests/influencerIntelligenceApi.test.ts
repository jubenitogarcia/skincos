import { describe, expect, it, vi } from 'vitest'
import { createInfluencerIntelligenceApi } from '../influencerIntelligenceApi'

function response(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', 'x-request-id': 'ii-api-test' } })
}

describe('Influencer Intelligence CRM client', () => {
  it('uses only the internal contract for bounded creator search', async () => {
    const fetchMock = vi.fn().mockResolvedValue(response({ data: { creators: [], total: null, coverage: 0, freshness: 'unknown', limitations: ['not computed'] } }))
    const api = createInfluencerIntelligenceApi(fetchMock as unknown as typeof fetch)

    await api.searchCreators('@creator?token=secret')

    expect(fetchMock).toHaveBeenCalledOnce()
    const [url, init] = fetchMock.mock.calls[0]
    expect(String(url)).toBe('/api/influencer-intelligence/v1/creators?limit=20')
    expect((init as RequestInit).credentials).toBe('include')
    expect((init as RequestInit).method).toBe('GET')
    expect(String(url)).not.toContain('access_token')
  })

  it('does not invent missing response fields when the service marks them unavailable', async () => {
    const fetchMock = vi.fn().mockResolvedValue(response({ data: { creatorKey: 'creator-1', handle: 'creator' } }))
    const api = createInfluencerIntelligenceApi(fetchMock as unknown as typeof fetch)
    const creator = await api.addCreator('@creator')

    expect(creator.creatorKey).toBe('creator-1')
    expect((creator as unknown as Record<string, unknown>).followers).toBeUndefined()
  })

  it('keeps comparison bounded to the selected opaque creator keys', async () => {
    const fetchMock = vi.fn().mockResolvedValue(response({ data: { creators: [], limitations: [], calculatedAt: null } }))
    const api = createInfluencerIntelligenceApi(fetchMock as unknown as typeof fetch)

    await api.compareCreators(['creator-a', 'creator-b', 'creator-c'])

    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('/api/influencer-intelligence/v1/compare')
    expect(JSON.parse(String((init as RequestInit).body))).toEqual({ creatorKeys: ['creator-a', 'creator-b', 'creator-c'] })
  })

  it('reads persisted campaign fit through the internal service without sending a campaign brief', async () => {
    const fetchMock = vi.fn().mockResolvedValue(response({ data: { campaignKey: 'campaign-1', campaignVersion: 2, fits: [], freshness: 'stale', limitations: ['not_computed'] } }))
    const api = createInfluencerIntelligenceApi(fetchMock as unknown as typeof fetch)

    const result = await api.getCampaignFit('campaign-1', ['creator-a', 'creator-b'], 2)

    expect(result.campaignKey).toBe('campaign-1')
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('/api/influencer-intelligence/v1/campaign-fit')
    expect(JSON.parse(String((init as RequestInit).body))).toEqual({ campaignKey: 'campaign-1', campaignVersion: 2, creatorKeys: ['creator-a', 'creator-b'] })
    expect(String((init as RequestInit).body)).not.toContain('brief')
  })

  it('rejects unsafe campaign keys before making a request', async () => {
    const fetchMock = vi.fn()
    const api = createInfluencerIntelligenceApi(fetchMock as unknown as typeof fetch)

    await expect(api.getCampaignFit('campaign/with-secret')).rejects.toMatchObject({ code: 'INVALID_INPUT' })
    await expect(api.getCampaignFit('campaign-1', ['creator/with-secret'])).rejects.toMatchObject({ code: 'INVALID_INPUT' })
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
