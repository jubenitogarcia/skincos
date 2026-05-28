import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  buildMetaAdsHealthState,
  deriveMetaAdsConnectionMode,
  getDefaultMetaAdsTab,
  normalizeMetaAdsApiError,
} from '../metaAdsState'
import {
  aggregateMetaAdsWorkflowSummary,
  buildMetaAdsWorkflowReport,
  normalizeMetaAdsWorkflowAccountId,
} from '../metaAdsWorkflowReport'
import { getMetaAdsEntityDetail, listMetaAdsInsights, updateMetaAdsEntity } from '../functions/_lib/metaAdsGraph'
import type { MetaAdsStatusResponse } from '../metaAdsTypes'

const baseStatus = (overrides: Partial<MetaAdsStatusResponse> = {}): MetaAdsStatusResponse => ({
  ok: true,
  oauthConfigured: true,
  missingConfig: [],
  oauthMode: 'scopes',
  businessLoginConfigId: null,
  connection: {
    connected: false,
    tokenType: null,
    metaUserId: null,
    metaUserName: null,
    selectedAdAccountId: null,
    scopes: [],
    updatedAt: null,
    expiresAt: null,
  },
  ...overrides,
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('Meta Ads state helpers', () => {
  it('normalizes API errors with code, hint and retryable', () => {
    const error = new Error('Falha base')
    ;(error as any).status = 403
    ;(error as any).payload = {
      code: 'ADMIN_REQUIRED',
      message: 'Acesso restrito ao módulo Meta Ads.',
      hint: 'Este módulo exige GESTOR/GERENTE.',
      retryable: false,
    }

    expect(normalizeMetaAdsApiError(error)).toEqual({
      status: 403,
      code: 'ADMIN_REQUIRED',
      message: 'Acesso restrito ao módulo Meta Ads.',
      hint: 'Este módulo exige GESTOR/GERENTE.',
      retryable: false,
      payload: {
        code: 'ADMIN_REQUIRED',
        message: 'Acesso restrito ao módulo Meta Ads.',
        hint: 'Este módulo exige GESTOR/GERENTE.',
        retryable: false,
      },
    })
  })

  it('derives an unauthorized mode for login failures before generic disconnected', () => {
    expect(
      deriveMetaAdsConnectionMode({
        status: null,
        statusError: {
          code: 'UNAUTHORIZED',
          message: 'Faça login no CRM para continuar.',
          retryable: false,
          status: 401,
        },
        selectedAccount: null,
      }),
    ).toBe('unauthorized')
  })

  it('derives a connected-ready mode only after account selection', () => {
    const connectedStatus = baseStatus({
      connection: {
        connected: true,
        tokenType: 'oauth',
        metaUserId: '1',
        metaUserName: 'Jubenito',
        selectedAdAccountId: 'act_123',
        scopes: ['ads_read'],
        updatedAt: '2026-05-13T12:00:00.000Z',
        expiresAt: null,
      },
    })

    expect(
      deriveMetaAdsConnectionMode({
        status: connectedStatus,
        statusError: null,
        selectedAccount: { id: 'act_123', name: 'Conta Principal', isSelected: true },
      }),
    ).toBe('connected-ready')

    expect(
      deriveMetaAdsConnectionMode({
        status: connectedStatus,
        statusError: null,
        selectedAccount: null,
      }),
    ).toBe('connected-no-account')
  })

  it('prioritizes forbidden and misconfigured states before generic disconnected', () => {
    expect(
      deriveMetaAdsConnectionMode({
        status: null,
        statusError: {
          code: 'ADMIN_REQUIRED',
          message: 'Acesso restrito',
          retryable: false,
          status: 403,
        },
        selectedAccount: null,
      }),
    ).toBe('forbidden')

    expect(
      deriveMetaAdsConnectionMode({
        status: baseStatus({ oauthConfigured: false, missingConfig: ['META_APP_ID'] }),
        statusError: null,
        selectedAccount: null,
      }),
    ).toBe('misconfigured')
  })

  it('keeps the product flow centered on Conexão until setup is complete', () => {
    expect(getDefaultMetaAdsTab('disconnected')).toBe('connect')
    expect(getDefaultMetaAdsTab('unauthorized')).toBe('connect')
    expect(getDefaultMetaAdsTab('connected-no-account')).toBe('connect')
    expect(getDefaultMetaAdsTab('connected-ready')).toBe('overview')
  })

  it('builds a health banner that clarifies the difference between connection and account selection', () => {
    const health = buildMetaAdsHealthState({
      mode: 'connected-no-account',
      selectedAccount: null,
      status: baseStatus({
        connection: {
          connected: true,
          tokenType: 'manual',
          metaUserId: '1',
          metaUserName: 'Jubenito',
          selectedAdAccountId: null,
          scopes: ['ads_read'],
          updatedAt: '2026-05-13T12:00:00.000Z',
          expiresAt: null,
        },
      }),
      statusError: null,
    })

    expect(health).toMatchObject({
      mode: 'connected-no-account',
      tone: 'warning',
    })
    expect(health.description).toContain('Selecione a conta de anúncios')
  })

  it('builds a health banner that tells the user to log in again when unauthorized', () => {
    const health = buildMetaAdsHealthState({
      mode: 'unauthorized',
      selectedAccount: null,
      status: null,
      statusError: {
        code: 'UNAUTHORIZED',
        message: 'Faça login no CRM para continuar.',
        retryable: false,
        status: 401,
      },
    })

    expect(health).toMatchObject({
      mode: 'unauthorized',
      tone: 'danger',
      ctaTab: 'connect',
    })
    expect(health.title).toContain('Faça login')
  })

  it('aggregates workflow report rows into the CRM summary shape', () => {
    const summary = aggregateMetaAdsWorkflowSummary(
      [
        {
          campaign_id: 'cmp_1',
          ad_status: 'ACTIVE',
          ad_last_7d_scalar_spend: 150.5,
          ad_last_7d_scalar_impressions: 2000,
          ad_last_7d_scalar_clicks: 40,
          ad_last_7d_conversation_started: 5,
        },
        {
          campaign_id: 'cmp_2',
          ad_effective_status: 'ACTIVE',
          ad_last_7d_spend: 99.5,
          ad_last_7d_impressions: 800,
          ad_last_7d_clicks: 18,
          ad_last_7d_whatsapp_conversations_started: 3,
        },
        {
          campaign_id: 'cmp_2',
          ad_effective_status: 'PAUSED',
          ad_last_7d_spend: 20,
          ad_last_7d_impressions: 100,
          ad_last_7d_clicks: 2,
          ad_last_7d_conversation_started: 0,
        },
      ],
      'last_7d',
    )

    expect(summary).toMatchObject({
      spend: 270,
      impressions: 2900,
      clicks: 60,
      conversations: 8,
      activeCampaigns: 2,
      source: 'workflow-report',
      window: 'last_7d',
    })
    expect(summary.avgCostConversation).toBeCloseTo(33.75, 2)
  })

  it('normalizes ad account ids for workflow report lookups', () => {
    expect(normalizeMetaAdsWorkflowAccountId('act_3271664739829465')).toBe('3271664739829465')
    expect(normalizeMetaAdsWorkflowAccountId('3271664739829465')).toBe('3271664739829465')
  })

  it('builds a report payload with campaign ranking from workflow rows', () => {
    const report = buildMetaAdsWorkflowReport(
      [
        {
          campaign_id: 'cmp_1',
          campaign_name: 'Campanha 1',
          campaign_effective_status: 'ACTIVE',
          adset_id: 'set_1',
          adset_name: 'Conjunto 1',
          ad_id: 'ad_1',
          ad_name: 'Anúncio 1',
          ad_last_30d_scalar_spend: 150,
          ad_last_30d_scalar_impressions: 1000,
          ad_last_30d_scalar_clicks: 50,
          ad_last_30d_conversation_started: 8,
        },
        {
          campaign_id: 'cmp_2',
          campaign_name: 'Campanha 2',
          campaign_effective_status: 'PAUSED',
          adset_id: 'set_2',
          adset_name: 'Conjunto 2',
          ad_id: 'ad_2',
          ad_name: 'Anúncio 2',
          ad_last_30d_scalar_spend: 90,
          ad_last_30d_scalar_impressions: 500,
          ad_last_30d_scalar_clicks: 25,
          ad_last_30d_conversation_started: 3,
        },
      ],
      'last_30d',
      {
        reportDate: '2026-05-14',
        runsCount: 2,
        source: 'd1',
      },
    )

    expect(report).toMatchObject({
      ok: true,
      source: 'workflow-report',
      window: 'last_30d',
      metadata: {
        reportDate: '2026-05-14',
        runsCount: 2,
      },
    })
    expect(report.campaigns[0]).toMatchObject({
      campaignId: 'cmp_1',
      status: 'ACTIVE',
      spend: 150,
      clicks: 50,
      conversations: 8,
    })
    expect(report.campaigns[0].ctr).toBe(5)
    expect(report.adSets[0]).toMatchObject({
      adSetId: 'set_1',
      campaignId: 'cmp_1',
      spend: 150,
      clicks: 50,
    })
    expect(report.ads[0]).toMatchObject({
      adId: 'ad_1',
      adSetId: 'set_1',
      spend: 150,
      clicks: 50,
    })
  })

  it('parses Graph insights with action metrics for campaign fallback reports', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          data: [
            {
              campaign_id: 'cmp_1',
              campaign_name: 'Campanha Primavera',
              spend: '100',
              reach: '50',
              impressions: '1000',
              clicks: '20',
              inline_link_clicks: '12',
              ctr: '2',
              cpc: '5',
              cpm: '100',
              cpp: '2',
              frequency: '2',
              actions: [
                { action_type: 'onsite_conversion.messaging_conversation_started_7d', value: '4' },
                { action_type: 'post_engagement', value: '9' },
                { action_type: 'instagram_profile_visit', value: '3' },
              ],
            },
          ],
        }),
        {
          status: 200,
          headers: { 'content-type': 'application/json' },
        },
      ),
    )

    const rows = await listMetaAdsInsights(
      'token',
      'act_123',
      'campaign',
      { since: '2026-05-01', until: '2026-05-07' },
      'v20.0',
    )

    expect(rows[0]).toMatchObject({
      campaign_id: 'cmp_1',
      campaign_name: 'Campanha Primavera',
      spend: 100,
      reach: 50,
      impressions: 1000,
      clicks: 20,
      linkClicks: 12,
      conversations: 4,
      engagement: 9,
      instagramProfileVisits: 3,
      ctr: 2,
      linkCtr: 1.2,
      cpc: 5,
      linkCpc: 8.33,
      cpm: 100,
      cpp: 2,
      frequency: 2,
    })
  })

  it('falls back to basic Graph insight fields when action metrics are rejected', async () => {
    const originalFetch = globalThis.fetch
    const requests: string[] = []
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      const url = String(input)
      requests.push(url)
      if (requests.length === 1) {
        return new Response(JSON.stringify({ error: { message: 'Unsupported get request for field actions' } }), {
          status: 400,
          headers: { 'content-type': 'application/json' },
        })
      }
      return new Response(
        JSON.stringify({
          data: [
            {
              campaign_id: 'cmp_1',
              campaign_name: 'Campanha 1',
              spend: '123.45',
              reach: '1000',
              impressions: '2000',
              clicks: '40',
              inline_link_clicks: '25',
              ctr: '2',
              cpc: '3.08',
              cpm: '61.72',
              cpp: '0.12',
              frequency: '2',
            },
          ],
        }),
        {
          status: 200,
          headers: { 'content-type': 'application/json' },
        },
      )
    }) as typeof fetch

    try {
      const rows = await listMetaAdsInsights(
        'token',
        'act_123',
        'campaign',
        { since: '2026-05-01', until: '2026-05-30' },
        'v20.0',
      )

      expect(requests).toHaveLength(2)
      expect(requests[0]).toContain('actions')
      expect(requests[1]).not.toContain('actions')
      expect(rows[0]).toMatchObject({
        campaign_id: 'cmp_1',
        campaign_name: 'Campanha 1',
        spend: 123.45,
        reach: 1000,
        impressions: 2000,
        clicks: 40,
        linkClicks: 25,
        ctr: 2,
        cpc: 3.08,
        cpm: 61.72,
        cpp: 0.12,
        frequency: 2,
      })
      expect(rows[0].conversations).toBe(0)
    } finally {
      globalThis.fetch = originalFetch
    }
  })

  it('fetches live Meta Ads entity details with the expected Graph fields', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          id: 'cmp_1',
          account_id: 'act_123',
          name: 'Campanha Primavera',
          status: 'ACTIVE',
        }),
        {
          status: 200,
          headers: { 'content-type': 'application/json' },
        },
      ),
    )

    const detail = await getMetaAdsEntityDetail('token', 'campaign', 'cmp_1', 'v20.0')
    expect(detail).toMatchObject({ id: 'cmp_1', account_id: 'act_123', status: 'ACTIVE' })
    const requestedUrl = String((globalThis.fetch as any).mock.calls[0][0])
    expect(requestedUrl).toContain('/v20.0/cmp_1?')
    expect(requestedUrl).toContain('fields=')
    expect(decodeURIComponent(requestedUrl)).toContain('daily_budget')
    expect(decodeURIComponent(requestedUrl)).toContain('issues_info')
  })

  it('falls back to safe entity detail fields when rich Meta fields are rejected', async () => {
    vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ error: { message: 'Unsupported field issues_info' } }), {
          status: 400,
          headers: { 'content-type': 'application/json' },
        }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ id: 'cmp_1', account_id: 'act_123', name: 'Campanha 1' }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      )

    const detail = await getMetaAdsEntityDetail('token', 'campaign', 'cmp_1', 'v20.0')
    expect(detail).toMatchObject({ id: 'cmp_1', account_id: 'act_123', _crm_detail_warning: 'Unsupported field issues_info' })
    const fallbackUrl = String((globalThis.fetch as any).mock.calls[1][0])
    expect(decodeURIComponent(fallbackUrl)).not.toContain('issues_info')
  })

  it('updates Meta Ads entities through POST form payloads', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(JSON.stringify({ success: true }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    )

    const result = await updateMetaAdsEntity('token', 'ad', 'ad_1', { name: 'Novo anúncio', status: 'PAUSED' }, 'v20.0')
    expect(result).toEqual({ success: true })
    const [url, init] = (globalThis.fetch as any).mock.calls[0]
    expect(String(url)).toBe('https://graph.facebook.com/v20.0/ad_1')
    expect(init.method).toBe('POST')
    expect(String(init.body)).toContain('name=Novo+an%C3%BAncio')
    expect(String(init.body)).toContain('status=PAUSED')
    expect(String(init.body)).toContain('access_token=token')
  })
})
