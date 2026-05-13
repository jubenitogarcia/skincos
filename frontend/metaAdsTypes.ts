export type MetaAdsTab = 'connect' | 'overview' | 'inventory' | 'tracking'

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
  currency?: string
  timezone_name?: string
  business_name?: string
  isSelected?: boolean
}

export type MetaCampaignRow = {
  id: string
  name: string
  status?: string
  effective_status?: string
  objective?: string
  totals?: { adSets: number; ads: number }
  adSets?: Array<{ id: string; name: string; ads: any[] }>
}

export type MetaAdsInventory = {
  campaigns: MetaCampaignRow[]
  adSets: any[]
  ads: any[]
  creatives: any[]
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
  activeCampaigns?: number
}

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
