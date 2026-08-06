import { afterEach, describe, expect, it, vi } from 'vitest'

import { assignCommercialActions, fetchCommercialWallet } from '@/atendimentoApi'

describe('Clientes operational API contracts', () => {
  afterEach(() => vi.restoreAllMocks())

  it('always requests the server-side wallet contract with allowlisted filters', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      text: async () => JSON.stringify({ ok: true, contract: 'crm-clientes-wallet/v1', profiles: [], total: 0 }),
      headers: new Headers({ 'x-request-id': 'synthetic-request' }),
    })
    vi.stubGlobal('fetch', fetchMock)

    await fetchCommercialWallet({ q: 'synthetic', limit: 50, offset: 100, sort: 'priority', direction: 'desc', assigned: 'none', stale: 'stale' })

    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('/api/atendimento/commercial/wallet?server=1&q=synthetic&limit=50&offset=100&sort=priority&direction=desc&assigned=none&stale=stale')
    expect(init.method).toBe('GET')
    expect(init.credentials).toBe('include')
    expect(String(url)).not.toMatch(/phone|email|telefone|e-mail/i)
  })

  it('uses an explicit audited bulk assignment command', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      text: async () => JSON.stringify({ ok: true, updated: 1, skipped: 0 }),
      headers: new Headers(),
    })
    vi.stubGlobal('fetch', fetchMock)

    await assignCommercialActions({ identityIds: ['11111111-1111-4111-8111-111111111111'], owner: 'Equipe sintética', unit: 'all' })

    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('/api/atendimento/commercial/actions/bulk-assign')
    expect(init.method).toBe('POST')
    expect(JSON.parse(init.body)).toEqual({ identityIds: ['11111111-1111-4111-8111-111111111111'], owner: 'Equipe sintética', unit: 'all' })
  })
})
