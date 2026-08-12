import { expect, test } from '@playwright/test'

const metric = (value: number | string | boolean | null, evidenceState: 'observed' | 'derived' | 'inferred' | 'unavailable' = 'observed') => ({
  value,
  evidenceState,
  freshness: evidenceState === 'unavailable' ? 'unknown' : 'fresh',
  provider: evidenceState === 'unavailable' ? null : 'meta-graph',
  retrievedAt: evidenceState === 'unavailable' ? null : '2026-08-11T12:00:00.000Z',
  limitations: evidenceState === 'unavailable' ? ['metric_not_available'] : [],
})

const creator = {
  creatorKey: 'creator-1',
  handle: 'synthetic.creator',
  displayName: 'Creator Sintético',
  registryState: 'candidate',
  provider: 'meta-graph',
}

const dashboard = {
  creator,
  profile: {
    followers: metric(12345),
    following: metric(null, 'unavailable'),
    mediaCount: metric(42),
    biography: metric('Conteúdo sintético'),
  },
  history: [{
    observedAt: '2026-08-10T12:00:00.000Z',
    followers: metric(12000),
    following: metric(null, 'unavailable'),
    mediaCount: metric(40),
    engagementRate: metric(0.035, 'derived'),
  }],
  media: [{
    mediaKey: 'media-1',
    publishedAt: '2026-08-09T12:00:00.000Z',
    format: 'reel',
    likes: metric(350),
    comments: metric(12),
    views: metric(null, 'unavailable'),
    reach: metric(null, 'unavailable'),
    engagementRate: metric(0.029, 'derived'),
    outlier: metric(false, 'derived'),
  }],
  analysis: {
    postingCadence: metric(3, 'derived'),
    medianLikes: metric(350, 'derived'),
    medianComments: metric(12, 'derived'),
    engagementRate: metric(0.035, 'derived'),
    medianViews: metric(null, 'unavailable'),
    growthVelocity: metric(345, 'derived'),
    growthAcceleration: metric(null, 'unavailable'),
    volatility: metric(0.08, 'derived'),
    outlierRatio: metric(0, 'derived'),
    warnings: ['Pouco histórico próprio para crescimento.'],
  },
  score: {
    overallScore: 71,
    confidenceScore: 48,
    dataCoverage: 62,
    evidenceState: 'derived',
    algorithmVersion: 'influencer-intelligence-scoring/v0',
    weightsVersion: 'weights-v0',
    calculatedAt: '2026-08-11T12:01:00.000Z',
    providers: ['meta-graph'],
    components: [{
      key: 'engagement_quality',
      label: 'Engagement quality',
      score: 74,
      evidenceState: 'derived',
      confidence: 51,
      explanation: 'Mediana normalizada com dados observados.',
      sourceRefs: ['analysis/creator-1'],
    }],
    limitations: ['views não disponíveis'],
  },
  coverage: { availableMetrics: 5, expectedMetrics: 8, ratio: 0.625, freshness: 'fresh', limitations: ['views e reach não fornecidos'] },
  provenance: [{
    provider: 'meta-graph',
    sourceType: 'profile',
    sourceRef: 'creator/creator-1/profile',
    evidenceState: 'observed',
    observedAt: '2026-08-10T12:00:00.000Z',
    retrievedAt: '2026-08-11T12:00:00.000Z',
  }],
}

test('Influencer Intelligence completes a synthetic read-only CRM journey', async ({ page }) => {
  await page.route('**/api/auth/me**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        ok: true,
        user: {
          username: 'e2e',
          role: 'GESTOR',
          allowedUnits: [],
          allowedModules: ['influencer-intelligence'],
          grants: ['module.influencer-intelligence.access'],
          featureFlags: { INFLUENCER_INTELLIGENCE_ENABLED: true },
        },
      }),
    })
  })

  await page.route('**/api/influencer-intelligence/**', async (route) => {
    const url = new URL(route.request().url())
    if (url.pathname.endsWith('/creators') && route.request().method() === 'GET') {
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: { creators: [creator], total: 1, coverage: 1, freshness: 'fresh', limitations: [] } }) })
    }
    if (url.pathname.endsWith('/creator-1/analysis')) {
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: dashboard }) })
    }
    return route.fulfill({ status: 404, contentType: 'application/json', body: JSON.stringify({ ok: false, error: 'NOT_FOUND' }) })
  })

  await page.goto('/?module=influencer-intelligence')
  await expect(page.getByRole('heading', { name: 'Influencer Intelligence' })).toBeVisible({ timeout: 30_000 })
  await page.getByRole('textbox', { name: 'Buscar creator' }).fill('synthetic')
  await page.getByRole('button', { name: 'Buscar', exact: true }).click()
  await expect(page.getByTestId('influencer-search-results')).toBeVisible()
  await page.getByRole('button', { name: 'Ver análise', exact: true }).click()
  await expect(page.getByTestId('influencer-dashboard')).toBeVisible()
  await expect(page.getByText('12.345', { exact: true })).toBeVisible()
  await expect(page.getByText('Indisponível', { exact: true }).first()).toBeVisible()
  await expect(page.getByText('views não disponíveis', { exact: false })).toBeVisible()
})
