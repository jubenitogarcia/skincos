export const INFLUENCER_INTELLIGENCE_FEATURE_FLAG = 'INFLUENCER_INTELLIGENCE_ENABLED' as const
export const INFLUENCER_INTELLIGENCE_GRANT = 'module.influencer-intelligence.access' as const

export type InfluencerEvidenceState = 'observed' | 'derived' | 'inferred' | 'unavailable'
export type InfluencerFreshness = 'fresh' | 'stale' | 'unknown'

export type InfluencerMetric<T = number | string> = {
  value: T | null
  evidenceState: InfluencerEvidenceState
  freshness: InfluencerFreshness
  provider: string | null
  retrievedAt: string | null
  limitations: string[]
  sourceRefs?: string[]
}

export type InfluencerCreatorSummary = {
  creatorKey: string
  handle: string | null
  displayName?: string | null
  registryState: 'candidate' | 'paused' | 'unavailable' | string
  provider: string | null
  addedAt?: string | null
}

export type InfluencerHistoryPoint = {
  observedAt: string
  followers: InfluencerMetric<number>
  following: InfluencerMetric<number>
  mediaCount: InfluencerMetric<number>
  engagementRate: InfluencerMetric<number>
}

export type InfluencerMediaRow = {
  mediaKey: string
  publishedAt: string | null
  format: 'image' | 'video' | 'reel' | 'carousel' | 'unknown' | string
  likes: InfluencerMetric<number>
  comments: InfluencerMetric<number>
  views: InfluencerMetric<number>
  reach: InfluencerMetric<number>
  engagementRate: InfluencerMetric<number>
  outlier: InfluencerMetric<boolean>
}

export type InfluencerScoreComponent = {
  key: string
  label: string
  score: number | null
  evidenceState: InfluencerEvidenceState
  confidence: number
  explanation: string
  sourceRefs: string[]
}

export type InfluencerScore = {
  overallScore: number | null
  confidenceScore: number
  dataCoverage: number
  evidenceState: InfluencerEvidenceState
  algorithmVersion: string | null
  weightsVersion: string | null
  calculatedAt: string | null
  providers: string[]
  components: InfluencerScoreComponent[]
  limitations: string[]
}

export type InfluencerAnalysis = {
  postingCadence: InfluencerMetric<number>
  medianLikes: InfluencerMetric<number>
  medianComments: InfluencerMetric<number>
  engagementRate: InfluencerMetric<number>
  medianViews: InfluencerMetric<number>
  growthVelocity: InfluencerMetric<number>
  growthAcceleration: InfluencerMetric<number>
  volatility: InfluencerMetric<number>
  outlierRatio: InfluencerMetric<number>
  warnings: string[]
}

export type InfluencerCreatorDashboard = {
  creator: InfluencerCreatorSummary
  profile: {
    followers: InfluencerMetric<number>
    following: InfluencerMetric<number>
    mediaCount: InfluencerMetric<number>
    biography: InfluencerMetric<string>
  }
  history: InfluencerHistoryPoint[]
  media: InfluencerMediaRow[]
  analysis: InfluencerAnalysis
  score: InfluencerScore
  coverage: {
    availableMetrics: number
    expectedMetrics: number
    ratio: number
    freshness: InfluencerFreshness
    limitations: string[]
  }
  provenance: Array<{
    provider: string | null
    sourceType: string
    sourceRef: string
    evidenceState: InfluencerEvidenceState
    observedAt: string | null
    retrievedAt: string | null
  }>
}

export type InfluencerSearchResponse = {
  creators: InfluencerCreatorSummary[]
  total: number | null
  coverage: number
  freshness: InfluencerFreshness
  limitations: string[]
}

export type InfluencerComparison = {
  creators: Array<{
    creator: InfluencerCreatorSummary
    overallScore: InfluencerMetric<number>
    confidence: InfluencerMetric<number>
    dataCoverage: InfluencerMetric<number>
    engagementRate: InfluencerMetric<number>
    growthVelocity: InfluencerMetric<number>
    warnings: string[]
  }>
  limitations: string[]
  calculatedAt: string | null
}

export type InfluencerCampaignFitComponent = {
  key: string
  score: number | null
  confidence: number
  evidenceState: InfluencerEvidenceState
  explanation: string
  sourceRefs: string[]
  conflicts?: string[]
}

export type InfluencerCampaignFit = {
  campaignKey: string
  campaignVersion: number
  creatorKey: string
  campaignFitScore: number | null
  campaignFitConfidence: number
  dataCoverage: number
  evidenceState: InfluencerEvidenceState
  algorithmVersion: string | null
  weightsVersion: string | null
  calculatedAt: string | null
  providers: string[]
  components: InfluencerCampaignFitComponent[]
  competitorConflicts: string[]
  limitations: string[]
}

export type InfluencerCampaignFitResponse = {
  campaignKey: string
  campaignVersion: number
  fits: InfluencerCampaignFit[]
  freshness: InfluencerFreshness
  limitations: string[]
}

export type InfluencerIntelligenceClient = {
  searchCreators: (query: string) => Promise<InfluencerSearchResponse>
  addCreator: (handle: string) => Promise<InfluencerCreatorSummary>
  getCreatorDashboard: (creatorKey: string) => Promise<InfluencerCreatorDashboard>
  compareCreators: (creatorKeys: string[]) => Promise<InfluencerComparison>
  getCampaignFit: (campaignKey: string, creatorKeys?: string[], campaignVersion?: number) => Promise<InfluencerCampaignFitResponse>
}
