import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  fetchCommercialDataQuality,
  isCommercialDataQualityScopeDenied,
  updateCommercialDataQualityFinding,
} from '../atendimentoApi'

describe('Clientes commercial data quality API', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('requests only the aggregate quality queue and preserves its bounded filters', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      ok: true,
      total: 0,
      limit: 24,
      offset: 0,
      metrics: { findings: 0, currentFindings: 0, overdue: 0, unassigned: 0, bySeverity: {}, byStatus: {} },
      sourceFreshness: {},
      findings: [],
    }), { status: 200, headers: { 'content-type': 'application/json' } }))
    vi.stubGlobal('fetch', fetchMock)

    const result = await fetchCommercialDataQuality({ severity: 'high', limit: 24 })

    expect(result.ok).toBe(true)
    expect(fetchMock).toHaveBeenCalledWith('/api/atendimento/commercial/data-quality?severity=high&limit=24', expect.objectContaining({
      method: 'GET',
      credentials: 'include',
    }))
  })

  it('sends every quality mutation with the current optimistic revision', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      ok: true,
      finding: { id: 'finding-1', revision: 5 },
    }), { status: 200, headers: { 'content-type': 'application/json' } }))
    vi.stubGlobal('fetch', fetchMock)

    await updateCommercialDataQualityFinding('finding/1', {
      expectedRevision: 4,
      owner: 'fila-operacional',
      status: 'in_progress',
    })

    expect(fetchMock).toHaveBeenCalledWith('/api/atendimento/commercial/data-quality/finding%2F1', expect.objectContaining({
      method: 'PATCH',
      body: JSON.stringify({ expectedRevision: 4, owner: 'fila-operacional', status: 'in_progress' }),
    }))
  })

  it('treats the scoped global-queue denial as an expected non-fatal state', () => {
    expect(isCommercialDataQualityScopeDenied('COMMERCIAL_DATA_QUALITY_UNIT_SCOPE_UNSUPPORTED')).toBe(true)
    expect(isCommercialDataQualityScopeDenied('FORBIDDEN')).toBe(true)
    expect(isCommercialDataQualityScopeDenied('DATABASE_URL_not_configured')).toBe(false)
  })
})
