export type MetaAdsTab = 'connect' | 'overview' | 'inventory'

export type MetaAdsConnectionMode =
  | 'disconnected'
  | 'connecting'
  | 'connected-no-account'
  | 'connected-ready'
  | 'unauthorized'
  | 'forbidden'
  | 'misconfigured'
  | 'degraded'

export type MetaAdsApiError = {
  status?: number
  code: string
  message: string
  hint?: string
  retryable: boolean
  payload?: unknown
}

export type MetaAdsStatusResponse = {
  ok: boolean
  oauthConfigured: boolean
  missingConfig: string[]
  oauthMode: 'scopes' | 'business-config'
  businessLoginConfigId: string | null
  connection: {
    connected: boolean
    tokenType: 'manual' | 'oauth' | null
    metaUserId: string | null
    metaUserName: string | null
    selectedAdAccountId: string | null
    scopes: string[]
    updatedAt: string | null
    expiresAt: string | null
  }
}

export type MetaAdAccount = {
  id: string
  name: string
  account_status?: string
  disable_reason?: string
  currency?: string
  timezone_name?: string
  business_name?: string
  isSelected?: boolean
}

export type MetaAdCreativeRef = {
  id?: string
  name?: string
  thumbnail_url?: string | null
  effective_object_story_id?: string | null
}

export type MetaCampaignRow = {
  id: string
  name: string
  status?: string
  effective_status?: string
  objective?: string
  daily_budget?: string
  lifetime_budget?: string
  start_time?: string
  stop_time?: string
  totals?: { adSets: number; ads: number }
  adSets?: MetaAdSet[]
}

export type MetaAdSet = {
  id: string
  name: string
  status?: string
  effective_status?: string
  campaign_id?: string
  campaign_name?: string
  daily_budget?: string
  lifetime_budget?: string
  bid_strategy?: string
  optimization_goal?: string
  start_time?: string
  end_time?: string
  ads_count?: number
  ads?: MetaAd[]
}

export type MetaAd = {
  id: string
  name: string
  status?: string
  effective_status?: string
  campaign_id?: string
  campaign_name?: string
  adset_id?: string
  adset_name?: string
  creative?: MetaAdCreativeRef
}

export type MetaCreativeInventoryItem = {
  id: string
  name: string
  thumbnailUrl?: string | null
  effectiveObjectStoryId?: string | null
  adId?: string | null
  adName?: string | null
  adSetId?: string | null
  adSetName?: string | null
  campaignId?: string | null
  campaignName?: string | null
}

export type MetaAdsInventory = {
  campaigns: MetaCampaignRow[]
  adSets: MetaAdSet[]
  ads: MetaAd[]
  creatives: MetaCreativeInventoryItem[]
}

export type MetaInventoryResponse = {
  ok: boolean
  accountId: string
  inventory: MetaAdsInventory
}

export type MetaAdsSummaryResponse = {
  spend?: number
  impressions?: number
  clicks?: number
  conversations?: number
  avgCostConversation?: number
  activeCampaigns?: number
  source?: 'graph' | 'workflow-report'
  window?: 'last_24h' | 'last_7d' | 'last_30d'
}

export type MetaAdsReportCampaign = {
  campaignId: string
  campaignName: string
  status: string
  spend: number
  impressions: number
  clicks: number
  conversations: number
  ctr: number
  cpc: number
  cpm: number
}

export type MetaAdsReportFallbackReason =
  | 'worker_unconfigured'
  | 'worker_unavailable'
  | 'worker_unauthorized'
  | 'worker_invalid_response'
  | 'empty_report'

export type MetaAdsReportResponse = {
  ok: boolean
  source: 'workflow-report' | 'graph-fallback'
  fallbackReason?: MetaAdsReportFallbackReason
  window: 'last_24h' | 'last_7d' | 'last_30d'
  summary: MetaAdsSummaryResponse
  metadata: {
    reportDate: string
    runsCount: number
    source: string
  }
  campaigns: MetaAdsReportCampaign[]
  warnings: string[]
}

export type MetaAdsInventoryLevel = 'campaign' | 'adset' | 'ad' | 'creative'

export type MetaAdsTrendPoint = {
  day: string
  spend: number
}

export type MetaAdsHealthState = {
  mode: MetaAdsConnectionMode
  title: string
  description: string
  tone: 'neutral' | 'success' | 'warning' | 'danger'
  ctaLabel?: string
  ctaTab?: MetaAdsTab
}

export type MetaAdsHeaderBadgeTone = 'neutral' | 'success' | 'warning' | 'danger'

export type MetaAdsHeaderAccountOption = {
  id: string
  name: string
}

export type MetaAdsHeaderState = {
  connected: boolean
  refreshing: boolean
  accounts: MetaAdsHeaderAccountOption[]
  selectedAccountId: string
  selectedAccountName?: string
  selectedAccountCurrency?: string
  selectedAccountTimezone?: string
  selectedAccountStatusLabel?: string
  selectedAccountStatusDetail?: string
  selectedAccountStatusTone?: MetaAdsHeaderBadgeTone
  sessionUpdatedAt?: string
}

export type MetaAdsHeaderAction =
  | { type: 'set-account'; value: string }
  | { type: 'refresh' }
  | { type: 'manage-connections' }
  | { type: 'disconnect' }
