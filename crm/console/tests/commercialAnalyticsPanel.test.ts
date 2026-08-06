import { readFileSync } from 'node:fs'
import { describe, expect, it, vi, afterEach } from 'vitest'

import {
  fetchCommercialAnalyticsFunnel,
  fetchCommercialAnalyticsQuality,
} from '../atendimentoApi'

const panelSource = readFileSync(new URL('../CommercialAnalyticsPanel.tsx', import.meta.url), 'utf8')

describe('Clientes analytics workspace', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('renders explicit, non-PII panels and persists filters in the URL', () => {
    expect(panelSource).toContain('data-testid="commercial-analytics-panel"')
    expect(panelSource).toContain('clientesAnalyticsFrom')
    expect(panelSource).toContain('clientesAnalyticsState')
    expect(panelSource).toContain('Qualidade ao longo do tempo')
    expect(panelSource).toContain('Funil comercial')
    expect(panelSource).toContain('Experimentos e holdout')
    expect(panelSource).not.toMatch(/\b(phone|email|telefone|e-mail)Raw\b/i)
  })

  it('keeps analytics filters server-side and scopes requests to the selected unit', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      ok: true,
      scope: { kind: 'unit', units: ['novo-hamburgo'] },
      filters: {},
      findings: [],
      events: [],
      timeSeries: { granularity: 'day', byFinding: {}, backlogAging: [], timing: {}, reopenRate: 0, ownerCoverage: null, activeFindings: 0, overdueSla: 0, metrics: [] },
      metrics: {},
    }), { status: 200, headers: { 'content-type': 'application/json' } }))
    vi.stubGlobal('fetch', fetchMock)
    await fetchCommercialAnalyticsQuality({ unit: 'novo-hamburgo', from: '2026-01-01', to: '2026-01-31', granularity: 'week' })
    await fetchCommercialAnalyticsFunnel({ unit: 'novo-hamburgo', campaign: 'reactivation', attributionState: 'attributed' })
    expect(fetchMock).toHaveBeenNthCalledWith(1, '/api/atendimento/commercial/analytics/quality?unit=novo-hamburgo&from=2026-01-01&to=2026-01-31&granularity=week', expect.objectContaining({ method: 'GET', credentials: 'include' }))
    expect(fetchMock).toHaveBeenNthCalledWith(2, '/api/atendimento/commercial/analytics/funnel?unit=novo-hamburgo&campaign=reactivation&attributionState=attributed', expect.objectContaining({ method: 'GET', credentials: 'include' }))
  })
})
