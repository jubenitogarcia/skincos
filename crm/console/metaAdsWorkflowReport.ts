import type {
  MetaAdsReportAd,
  MetaAdsReportAdSet,
  MetaAdsReportCampaign,
  MetaAdsReportResponse,
  MetaAdsSummaryResponse,
} from './metaAdsTypes'

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

function readOptionalMetric(
  row: MetaAdsWorkflowSummaryRow,
  window: MetaAdsWorkflowWindow,
  candidates: string[],
) {
  for (const name of candidates) {
    const value = toNumber(row[`ad_${window}_${name}`])
    if (value !== null) return value
  }
  return null
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
  const adSets = new Map<string, MetaAdsReportAdSet>()
  const ads = new Map<string, MetaAdsReportAd>()

  for (const row of Array.isArray(rows) ? rows : []) {
    const campaignId = String(row.campaign_id || '').trim()
    const campaignName = String(row.campaign_name || campaignId || 'Sem campanha').trim() || 'Sem campanha'
    const adSetId = String(row.adset_id || '').trim()
    const adSetName = String(row.adset_name || adSetId || 'Sem conjunto').trim() || 'Sem conjunto'
    const adId = String(row.ad_id || '').trim()
    const adName = String(row.ad_name || adId || 'Sem anúncio').trim() || 'Sem anúncio'
    const status = buildCampaignStatus(row) || 'UNKNOWN'
    const spend = readMetric(row, window, ['scalar_spend', 'spend'])
    const reach = readOptionalMetric(row, window, ['scalar_reach', 'reach'])
    const impressions = readMetric(row, window, ['scalar_impressions', 'impressions'])
    const clicks = readMetric(row, window, ['scalar_clicks', 'clicks'])
    const linkClicks = readOptionalMetric(row, window, ['inline_link_clicks'])
    const engagement = readOptionalMetric(row, window, ['inline_post_engagement'])
    const instagramProfileVisits = readOptionalMetric(row, window, ['instagram_profile_visits'])
    const conversations = readMetric(row, window, ['conversation_started', 'whatsapp_conversations_started'])
    const cpp = readOptionalMetric(row, window, ['scalar_cpp', 'cpp'])
    const frequency = readOptionalMetric(row, window, ['scalar_frequency', 'frequency'])
    const key = campaignId || `campaign:${campaignName}`

    const current = campaigns.get(key) || {
      campaignId: campaignId || key,
      campaignName,
      status,
      spend: 0,
      reach: 0,
      impressions: 0,
      clicks: 0,
      linkClicks: 0,
      engagement: 0,
      instagramProfileVisits: 0,
      conversations: 0,
      ctr: 0,
      linkCtr: 0,
      cpc: 0,
      linkCpc: 0,
      cpm: 0,
      cpp: 0,
      frequency: 0,
    }

    current.spend += spend
    current.reach = Number(current.reach || 0) + (reach || 0)
    current.impressions += impressions
    current.clicks += clicks
    current.linkClicks = Number(current.linkClicks || 0) + (linkClicks || 0)
    current.engagement = Number(current.engagement || 0) + (engagement || 0)
    current.instagramProfileVisits = Number(current.instagramProfileVisits || 0) + (instagramProfileVisits || 0)
    current.conversations += conversations
    current.cpp = Number(current.cpp || 0) + (cpp || 0)
    current.frequency = Number(current.frequency || 0) + (frequency || 0)
    if (current.status !== 'ACTIVE' && status === 'ACTIVE') {
      current.status = status
    }
    campaigns.set(key, current)

    if (adSetId) {
      const adSetKey = adSetId
      const currentAdSet = adSets.get(adSetKey) || {
        adSetId,
        adSetName,
        campaignId: campaignId || '',
        campaignName,
        spend: 0,
        reach: 0,
        impressions: 0,
        clicks: 0,
        linkClicks: 0,
        engagement: 0,
        instagramProfileVisits: 0,
        conversations: 0,
        ctr: 0,
        linkCtr: 0,
        cpc: 0,
        linkCpc: 0,
        cpm: 0,
        cpp: 0,
        frequency: 0,
      }
      currentAdSet.spend += spend
      currentAdSet.reach = Number(currentAdSet.reach || 0) + (reach || 0)
      currentAdSet.impressions += impressions
      currentAdSet.clicks += clicks
      currentAdSet.linkClicks = Number(currentAdSet.linkClicks || 0) + (linkClicks || 0)
      currentAdSet.engagement = Number(currentAdSet.engagement || 0) + (engagement || 0)
      currentAdSet.instagramProfileVisits = Number(currentAdSet.instagramProfileVisits || 0) + (instagramProfileVisits || 0)
      currentAdSet.conversations += conversations
      currentAdSet.cpp = Number(currentAdSet.cpp || 0) + (cpp || 0)
      currentAdSet.frequency = Number(currentAdSet.frequency || 0) + (frequency || 0)
      adSets.set(adSetKey, currentAdSet)
    }

    if (adId) {
      const adKey = adId
      const currentAd = ads.get(adKey) || {
        adId,
        adName,
        adSetId: adSetId || '',
        adSetName,
        campaignId: campaignId || '',
        campaignName,
        spend: 0,
        reach: 0,
        impressions: 0,
        clicks: 0,
        linkClicks: 0,
        engagement: 0,
        instagramProfileVisits: 0,
        conversations: 0,
        ctr: 0,
        linkCtr: 0,
        cpc: 0,
        linkCpc: 0,
        cpm: 0,
        cpp: 0,
        frequency: 0,
      }
      currentAd.spend += spend
      currentAd.reach = Number(currentAd.reach || 0) + (reach || 0)
      currentAd.impressions += impressions
      currentAd.clicks += clicks
      currentAd.linkClicks = Number(currentAd.linkClicks || 0) + (linkClicks || 0)
      currentAd.engagement = Number(currentAd.engagement || 0) + (engagement || 0)
      currentAd.instagramProfileVisits = Number(currentAd.instagramProfileVisits || 0) + (instagramProfileVisits || 0)
      currentAd.conversations += conversations
      currentAd.cpp = Number(currentAd.cpp || 0) + (cpp || 0)
      currentAd.frequency = Number(currentAd.frequency || 0) + (frequency || 0)
      ads.set(adKey, currentAd)
    }
  }

  const campaignRows = Array.from(campaigns.values())
    .map((campaign) => ({
      ...campaign,
      ctr: toMetricPercent(campaign.clicks, campaign.impressions),
      linkCtr: toMetricPercent(Number(campaign.linkClicks || 0), campaign.impressions),
      cpc: campaign.clicks > 0 ? Math.round((campaign.spend / campaign.clicks) * 100) / 100 : 0,
      linkCpc: Number(campaign.linkClicks || 0) > 0 ? Math.round((campaign.spend / Number(campaign.linkClicks || 0)) * 100) / 100 : 0,
      cpm: campaign.impressions > 0 ? Math.round((campaign.spend / campaign.impressions) * 100000) / 100 : 0,
    }))
    .sort((left, right) => right.spend - left.spend || right.clicks - left.clicks)

  const adSetRows = Array.from(adSets.values())
    .map((adSet) => ({
      ...adSet,
      ctr: toMetricPercent(adSet.clicks, adSet.impressions),
      linkCtr: toMetricPercent(Number(adSet.linkClicks || 0), adSet.impressions),
      cpc: adSet.clicks > 0 ? Math.round((adSet.spend / adSet.clicks) * 100) / 100 : 0,
      linkCpc: Number(adSet.linkClicks || 0) > 0 ? Math.round((adSet.spend / Number(adSet.linkClicks || 0)) * 100) / 100 : 0,
      cpm: adSet.impressions > 0 ? Math.round((adSet.spend / adSet.impressions) * 100000) / 100 : 0,
    }))
    .sort((left, right) => right.spend - left.spend || right.clicks - left.clicks)

  const adRows = Array.from(ads.values())
    .map((ad) => ({
      ...ad,
      ctr: toMetricPercent(ad.clicks, ad.impressions),
      linkCtr: toMetricPercent(Number(ad.linkClicks || 0), ad.impressions),
      cpc: ad.clicks > 0 ? Math.round((ad.spend / ad.clicks) * 100) / 100 : 0,
      linkCpc: Number(ad.linkClicks || 0) > 0 ? Math.round((ad.spend / Number(ad.linkClicks || 0)) * 100) / 100 : 0,
      cpm: ad.impressions > 0 ? Math.round((ad.spend / ad.impressions) * 100000) / 100 : 0,
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
    adSets: adSetRows,
    ads: adRows,
    warnings: rows.length ? [] : ['empty_report'],
  }
}
