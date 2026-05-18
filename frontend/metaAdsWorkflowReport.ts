import type { MetaAdsReportCampaign, MetaAdsReportResponse, MetaAdsSummaryResponse } from './metaAdsTypes'

export type MetaAdsWorkflowWindow = 'last_24h' | 'last_7d' | 'last_30d'
export type MetaAdsWorkflowSummaryRow = Record<string, unknown>

function toNumber(value: unknown) {
  if (value === null || value === undefined || value === '') return null
  const numeric = Number(value)
  return Number.isFinite(numeric) ? numeric : null
}

function readMetric(
  row: MetaAdsWorkflowSummaryRow,
  window: MetaAdsWorkflowWindow,
  candidates: string[],
) {
  for (const name of candidates) {
    const value = toNumber(row[`ad_${window}_${name}`])
    if (value !== null) return value
  }
  return 0
}

function isActiveStatus(value: unknown) {
  const status = String(value || '').trim().toUpperCase()
  return status === 'ACTIVE'
}

function toMetricPercent(numerator: number, denominator: number) {
  if (!denominator) return 0
  return Math.round((numerator / denominator) * 10000) / 100
}

function buildCampaignStatus(row: MetaAdsWorkflowSummaryRow) {
  return String(
    row.campaign_effective_status ||
      row.campaign_status ||
      row.ad_effective_status ||
      row.ad_status ||
      ''
  )
    .trim()
    .toUpperCase()
}

export function normalizeMetaAdsWorkflowAccountId(adAccountId: string) {
  const raw = String(adAccountId || '').trim()
  return raw.startsWith('act_') ? raw.slice(4) : raw
}

export function aggregateMetaAdsWorkflowSummary(
  rows: MetaAdsWorkflowSummaryRow[],
  window: MetaAdsWorkflowWindow,
): MetaAdsSummaryResponse {
  const activeCampaignIds = new Set<string>()
  let spend = 0
  let impressions = 0
  let clicks = 0
  let conversations = 0

  for (const row of Array.isArray(rows) ? rows : []) {
    spend += readMetric(row, window, ['scalar_spend', 'spend'])
    impressions += readMetric(row, window, ['scalar_impressions', 'impressions'])
    clicks += readMetric(row, window, ['scalar_clicks', 'clicks'])
    conversations += readMetric(row, window, ['conversation_started', 'whatsapp_conversations_started'])

    const campaignId = String(row.campaign_id || '').trim()
    if (
      campaignId &&
      (isActiveStatus(row.ad_effective_status) ||
        isActiveStatus(row.ad_status) ||
        isActiveStatus(row.campaign_effective_status) ||
        isActiveStatus(row.campaign_status))
    ) {
      activeCampaignIds.add(campaignId)
    }
  }

  return {
    spend,
    impressions,
    clicks,
    conversations,
    avgCostConversation: conversations > 0 ? spend / conversations : 0,
    activeCampaigns: activeCampaignIds.size,
    source: 'workflow-report',
    window,
  }
}

export function buildMetaAdsWorkflowReport(
  rows: MetaAdsWorkflowSummaryRow[],
  window: MetaAdsWorkflowWindow,
  metadata?: {
    reportDate?: string
    runsCount?: number
    source?: string
  },
): MetaAdsReportResponse {
  const summary = aggregateMetaAdsWorkflowSummary(rows, window)
  const campaigns = new Map<string, MetaAdsReportCampaign>()

  for (const row of Array.isArray(rows) ? rows : []) {
    const campaignId = String(row.campaign_id || '').trim()
    const campaignName = String(row.campaign_name || campaignId || 'Sem campanha').trim() || 'Sem campanha'
    const status = buildCampaignStatus(row) || 'UNKNOWN'
    const spend = readMetric(row, window, ['scalar_spend', 'spend'])
    const impressions = readMetric(row, window, ['scalar_impressions', 'impressions'])
    const clicks = readMetric(row, window, ['scalar_clicks', 'clicks'])
    const conversations = readMetric(row, window, ['conversation_started', 'whatsapp_conversations_started'])
    const key = campaignId || `campaign:${campaignName}`

    const current = campaigns.get(key) || {
      campaignId: campaignId || key,
      campaignName,
      status,
      spend: 0,
      impressions: 0,
      clicks: 0,
      conversations: 0,
      ctr: 0,
      cpc: 0,
      cpm: 0,
    }

    current.spend += spend
    current.impressions += impressions
    current.clicks += clicks
    current.conversations += conversations
    if (current.status !== 'ACTIVE' && status === 'ACTIVE') {
      current.status = status
    }
    campaigns.set(key, current)
  }

  const campaignRows = Array.from(campaigns.values())
    .map((campaign) => ({
      ...campaign,
      ctr: toMetricPercent(campaign.clicks, campaign.impressions),
      cpc: campaign.clicks > 0 ? Math.round((campaign.spend / campaign.clicks) * 100) / 100 : 0,
      cpm: campaign.impressions > 0 ? Math.round((campaign.spend / campaign.impressions) * 100000) / 100 : 0,
    }))
    .sort((left, right) => right.spend - left.spend || right.clicks - left.clicks)

  return {
    ok: true,
    source: 'workflow-report',
    window,
    fallbackReason: rows.length ? undefined : 'empty_report',
    summary,
    metadata: {
      reportDate: String(metadata?.reportDate || '').trim(),
      runsCount: Number(metadata?.runsCount || 0),
      source: String(metadata?.source || 'd1').trim() || 'd1',
    },
    campaigns: campaignRows,
    warnings: rows.length ? [] : ['empty_report'],
  }
}
