import { afterEach, describe, expect, it, vi } from 'vitest'
import { apiBlob, apiJson, fetchJsonWithMeta } from '../pontoApi'

describe('Ponto API client', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('accepts a structured JSON success response', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ ok: true, data: { id: 'op-1' } }), { status: 200, headers: { 'content-type': 'application/json; charset=utf-8', 'x-request-id': 'req-1' } })))
    await expect(apiJson<{ ok: boolean; data: { id: string } }>('/api/ponto/health')).resolves.toEqual({ ok: true, data: { id: 'op-1' } })
  })

  it('rejects HTML even when an upstream responds 200', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('<html>frontend fallback</html>', { status: 200, headers: { 'content-type': 'text/html' } })))
    await expect(apiJson('/api/ponto/health')).rejects.toMatchObject({ code: 'INVALID_API_CONTENT_TYPE' })
  })

  it('preserves API error metadata for support', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ ok: false, error: 'PERIOD_CLOSED' }), { status: 409, headers: { 'content-type': 'application/json', 'x-request-id': 'req-closed', 'cf-ray': 'ray-1' } })))
    await expect(apiJson('/api/ponto/punches')).rejects.toMatchObject({ status: 409, code: 'PERIOD_CLOSED', requestId: 'req-closed', cfRay: 'ray-1' })
  })

  it('keeps API payload inside details instead of assigning its fields onto the error', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ ok: false, error: 'PERIOD_CLOSED', status: 200, requestId: 'attacker-value' }), { status: 409, headers: { 'content-type': 'application/json', 'x-request-id': 'req-authoritative' } })))
    await expect(apiJson('/api/ponto/punches')).rejects.toMatchObject({ status: 409, requestId: 'req-authoritative', details: expect.objectContaining({ status: 200, requestId: 'attacker-value' }) })
  })

  it('sends the CRM CSRF token on mutations', async () => {
    vi.stubGlobal('document', { cookie: 'csrfToken=test-csrf' })
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ ok: true }), { status: 200, headers: { 'content-type': 'application/json' } }))
    vi.stubGlobal('fetch', fetchMock)
    await apiJson('/api/ponto/corrections', { method: 'POST', body: { eventId: 'event-1' } })
    expect((fetchMock.mock.calls[0][1] as RequestInit).headers).toMatchObject({ 'x-csrf-token': 'test-csrf' })
  })

  it('requires CSV content type for export', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ ok: true }), { status: 200, headers: { 'content-type': 'application/json' } })))
    await expect(apiBlob('/api/ponto/export')).rejects.toThrow('Resposta de exportação inválida')
  })

  it('marks non-JSON health responses unhealthy', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('not-json', { status: 200, headers: { 'content-type': 'text/plain' } })))
    await expect(fetchJsonWithMeta('/api/ponto/health')).resolves.toEqual(expect.objectContaining({ ok: false, status: 200, json: null }))
  })
})
