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
  image_url?: string | null
  effective_object_story_id?: string | null
  object_story_id?: string | null
  object_story_spec?: unknown
  asset_feed_spec?: unknown
  image_hash?: string | null
  video_id?: string | null
  title?: string | null
  body?: string | null
  call_to_action_type?: string | null
  url_tags?: string | null
  instagram_permalink_url?: string | null
  object_url?: string | null
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
  imageUrl?: string | null
  effectiveObjectStoryId?: string | null
  adId?: string | null
  adName?: string | null
  adSetId?: string | null
  adSetName?: string | null
  campaignId?: string | null
  campaignName?: string | null
}

export type MetaAdsEntityType = 'campaign' | 'adset' | 'ad' | 'creative'

export type MetaAdsEntityPatch = {
  name?: string
  status?: 'ACTIVE' | 'PAUSED'
  daily_budget?: string
  lifetime_budget?: string
  start_time?: string
  stop_time?: string
  end_time?: string
  bid_strategy?: string
  optimization_goal?: string
}

export type MetaAdsLiveEntityDetail = {
  type: MetaAdsEntityType
  id: string
  accountId: string
  editable: boolean
  readOnlyReason?: string | null
  editableFields: string[]
  fields: Record<string, unknown>
  raw?: Record<string, unknown>
  updatedAt: string
}

export type MetaAdsEntityDetailResponse = {
  ok: boolean
  entity: MetaAdsLiveEntityDetail
}

export type MetaAdsEntityUpdateResponse = {
  ok: boolean
  entity: MetaAdsLiveEntityDetail
  changedFields: string[]
  audit: {
    entityType: MetaAdsEntityType
    entityId: string
    adAccountId: string
    changedFields: string[]
    timestamp: string
  }
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
  reach?: number
  impressions: number
  clicks: number
  linkClicks?: number
  engagement?: number
  instagramProfileVisits?: number
  conversations: number
  ctr: number
  linkCtr?: number
  cpc: number
  linkCpc?: number
  cpm: number
  cpp?: number
  frequency?: number
}

export type MetaAdsReportAdSet = {
  adSetId: string
  adSetName: string
  campaignId: string
  campaignName: string
  spend: number
  reach?: number
  impressions: number
  clicks: number
  linkClicks?: number
  engagement?: number
  instagramProfileVisits?: number
  conversations: number
  ctr: number
  linkCtr?: number
  cpc: number
  linkCpc?: number
  cpm: number
  cpp?: number
  frequency?: number
}

export type MetaAdsReportAd = {
  adId: string
  adName: string
  adSetId: string
  adSetName: string
  campaignId: string
  campaignName: string
  spend: number
  reach?: number
  impressions: number
  clicks: number
  linkClicks?: number
  engagement?: number
  instagramProfileVisits?: number
  conversations: number
  ctr: number
  linkCtr?: number
  cpc: number
  linkCpc?: number
  cpm: number
  cpp?: number
  frequency?: number
}

export type MetaAdsReportFallbackReason =
  | 'worker_unconfigured'
  | 'worker_unavailable'
  | 'worker_unauthorized'
  | 'worker_invalid_response'
  | 'empty_report'

export type MetaAdsReportWindowDays = 7 | 30 | 60
export type MetaAdsCustomDateRange = {
  since: string
  until: string
}

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
  adSets: MetaAdsReportAdSet[]
  ads: MetaAdsReportAd[]
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
  statusLabel?: string
  statusTone?: MetaAdsHeaderBadgeTone
}

export type MetaAdsHeaderState = {
  refreshing: boolean
  accounts: MetaAdsHeaderAccountOption[]
  selectedAccountId: string
  reportWindowDays: MetaAdsReportWindowDays
  customRangeActive?: boolean
  customRangeLabel?: string
  selectedAccountName?: string
  sessionUpdatedAt?: string
}

export type MetaAdsHeaderAction =
  | { type: 'set-account'; value: string }
  | { type: 'remove-account'; value: string }
  | { type: 'set-report-window'; value: MetaAdsReportWindowDays }
  | { type: 'connect' }
  | { type: 'open-custom-period' }
  | { type: 'refresh' }
  | { type: 'manage-connections' }
  | { type: 'disconnect' }
