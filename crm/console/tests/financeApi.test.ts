import { afterEach, describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'

import { financeApi, minorUnitsFromDisplay } from '../financeApi'

describe('Finance transport helpers', () => {
  it('converts a decimal display value without floating point arithmetic', () => {
    expect(minorUnitsFromDisplay('120,50')).toBe(12050)
    expect(minorUnitsFromDisplay('0.01')).toBe(1)
  })

  it('rejects fractional minor units and non-positive values before transport', () => {
    expect(minorUnitsFromDisplay('12.345')).toBeNull()
    expect(minorUnitsFromDisplay('0')).toBeNull()
    expect(minorUnitsFromDisplay('-1')).toBeNull()
  })

  afterEach(() => vi.unstubAllGlobals())

  it('sends movement search and filters to the Finance API rather than filtering client-side', async () => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => new Response(JSON.stringify({ ok: true, page: 2, limit: 25, total: 31, movements: [] }), { status: 200, headers: { 'content-type': 'application/json' } }))
    vi.stubGlobal('fetch', fetchMock)
    await financeApi.movements('finance-scope-novo-hamburgo', { q: 'ana', accountId: 'account-1', status: 'confirmed', page: 2, limit: 25 })
    const requested = String(fetchMock.mock.calls[0][0])
    expect(requested).toContain('/finance/movements?')
    expect(requested).toContain('scopeId=finance-scope-novo-hamburgo')
    expect(requested).toContain('q=ana')
    expect(requested).toContain('accountId=account-1')
    expect(requested).toContain('status=confirmed')
    expect(requested).toContain('page=2')
  })

  it('preserves idempotency conflicts for a visible recovery state', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ error: 'IDEMPOTENCY_CONFLICT', message: 'payload diferente' }), { status: 409, headers: { 'content-type': 'application/json' } })))
    await expect(financeApi.create('/accounts', 'finance-scope-novo-hamburgo', { name: 'Banco', type: 'bank', currency: 'BRL' }, 'same-key')).rejects.toMatchObject({ code: 'IDEMPOTENCY_CONFLICT', status: 409 })
  })

  it('routes Finance browser requests through the Pages proxy instead of the static shell', () => {
    const routes = JSON.parse(readFileSync(new URL('../public/_routes.json', import.meta.url), 'utf8'))
    expect(routes.include).toContain('/api/finance/*')
  })
})
