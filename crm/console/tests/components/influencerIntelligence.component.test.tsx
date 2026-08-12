import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it } from 'vitest'
import { InfluencerIntelligencePanel } from '../../InfluencerIntelligenceModule'
import type { InfluencerCreatorDashboard, InfluencerIntelligenceClient, InfluencerMetric } from '../../influencerIntelligenceTypes'

const metric = <T,>(value: T | null, evidenceState: InfluencerMetric<T>['evidenceState'] = 'observed'): InfluencerMetric<T> => ({
  value,
  evidenceState,
  freshness: evidenceState === 'unavailable' ? 'unknown' : 'fresh',
  provider: evidenceState === 'unavailable' ? null : 'meta-graph',
  retrievedAt: evidenceState === 'unavailable' ? null : '2026-08-11T12:00:00.000Z',
  limitations: evidenceState === 'unavailable' ? ['metric_not_available'] : [],
})

const dashboard: InfluencerCreatorDashboard = {
  creator: { creatorKey: 'creator-1', handle: 'synthetic.creator', displayName: 'Creator Sintético', registryState: 'candidate', provider: 'meta-graph' },
  profile: { followers: metric(12345), following: metric(0), mediaCount: metric(42), biography: metric('Conteúdo sintético') },
  history: [{ observedAt: '2026-08-10T12:00:00.000Z', followers: metric(12000), following: metric<number>(null, 'unavailable'), mediaCount: metric(40), engagementRate: metric(0.035, 'derived') }],
  media: [{ mediaKey: 'media-1', publishedAt: '2026-08-09T12:00:00.000Z', format: 'reel', likes: metric(350), comments: metric(12), views: metric<number>(null, 'unavailable'), reach: metric<number>(null, 'unavailable'), engagementRate: metric(0.029, 'derived'), outlier: metric(false, 'derived') }],
  analysis: { postingCadence: metric(3, 'derived'), medianLikes: metric(350, 'derived'), medianComments: metric(12, 'derived'), engagementRate: metric(0.035, 'derived'), medianViews: metric<number>(null, 'unavailable'), growthVelocity: metric(345, 'derived'), growthAcceleration: metric<number>(null, 'unavailable'), volatility: metric(0.08, 'derived'), outlierRatio: metric(0, 'derived'), warnings: ['Pouco histórico próprio para crescimento.'] },
  score: { overallScore: 71, confidenceScore: 48, dataCoverage: 62, evidenceState: 'derived', algorithmVersion: 'influencer-intelligence-scoring/v0', weightsVersion: 'weights-v0', calculatedAt: '2026-08-11T12:01:00.000Z', providers: ['meta-graph'], components: [{ key: 'engagement_quality', label: 'Engagement quality', score: 74, evidenceState: 'derived', confidence: 51, explanation: 'Mediana normalizada com dados observados.', sourceRefs: ['analysis/creator-1'] }], limitations: ['views não disponíveis'] },
  coverage: { availableMetrics: 5, expectedMetrics: 8, ratio: 0.625, freshness: 'fresh', limitations: ['views e reach não fornecidos'] },
  provenance: [{ provider: 'meta-graph', sourceType: 'profile', sourceRef: 'creator/creator-1/profile', evidenceState: 'observed', observedAt: '2026-08-10T12:00:00.000Z', retrievedAt: '2026-08-11T12:00:00.000Z' }],
}

function client(): InfluencerIntelligenceClient {
  return {
    searchCreators: async () => ({ creators: [dashboard.creator], total: 1, coverage: 1, freshness: 'fresh', limitations: [] }),
    addCreator: async () => dashboard.creator,
    getCreatorDashboard: async () => dashboard,
    compareCreators: async () => ({ creators: [], limitations: [], calculatedAt: null }),
    getCampaignFit: async (campaignKey, creatorKeys = [], campaignVersion = 1) => ({ campaignKey, campaignVersion, freshness: 'fresh', limitations: [], fits: creatorKeys.map((creatorKey) => ({ creatorKey, campaignKey, campaignVersion, campaignFitScore: 82, campaignFitConfidence: 61, dataCoverage: 75, evidenceState: 'derived' as const, algorithmVersion: 'influencer-intelligence-campaign-fit/v1', weightsVersion: 'influencer-intelligence-campaign-fit-weights/v1', calculatedAt: '2026-08-11T12:01:00.000Z', providers: ['meta-graph'], components: [], competitorConflicts: [], limitations: [] })) }),
  }
}

describe('Influencer Intelligence CRM panel', () => {
  afterEach(() => cleanup())

  it('renders explicit evidence states and keeps unavailable metrics distinct from zero', async () => {
    const user = userEvent.setup()
    render(<InfluencerIntelligencePanel client={client()} enabled granted />)

    await user.type(screen.getByRole('textbox', { name: 'Buscar creator' }), 'synthetic')
    await user.click(screen.getByRole('button', { name: 'Buscar' }))
    await user.click(screen.getByRole('button', { name: 'Ver análise' }))

    expect(await screen.findByTestId('influencer-dashboard')).toBeVisible()
    expect(screen.getByText('12.345')).toBeVisible()
    expect(screen.getAllByText('Indisponível').length).toBeGreaterThan(0)
    expect(screen.getAllByText(/unavailable/).length).toBeGreaterThan(0)
    expect(screen.getByText(/views não disponíveis/i)).toBeVisible()
    expect(screen.getByText('0', { exact: true })).toBeVisible()
  })

  it('keeps the module closed when its gates are absent, including direct embedding defaults', () => {
    render(<InfluencerIntelligencePanel client={client()} />)
    expect(screen.getByTestId('influencer-module-off')).toHaveTextContent(/desligado/i)
    expect(screen.queryByRole('button', { name: 'Buscar' })).not.toBeInTheDocument()
  })

  it('shows persisted campaign fit separately from the general score', async () => {
    const user = userEvent.setup()
    render(<InfluencerIntelligencePanel client={client()} enabled granted />)

    await user.type(screen.getByRole('textbox', { name: 'Buscar creator' }), 'synthetic')
    await user.click(screen.getByRole('button', { name: 'Buscar' }))
    await user.click(screen.getByRole('checkbox', { name: 'Selecionar @synthetic.creator' }))
    await user.type(screen.getByRole('textbox', { name: 'Chave da campanha' }), 'campaign-1')
    await user.click(screen.getByRole('button', { name: 'Consultar Campaign Fit' }))

    expect(await screen.findByTestId('influencer-campaign-fit')).toBeVisible()
    expect(screen.getByText('Campaign Fit · campaign-1 v1')).toBeVisible()
    expect(screen.getByText(/projeção separada do Influencer Score geral/i)).toBeVisible()
    expect(screen.getByText('82 / 100')).toBeVisible()
  })
})
