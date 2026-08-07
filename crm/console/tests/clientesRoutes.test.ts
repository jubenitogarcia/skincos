import { describe, expect, it } from 'vitest'
import {
  clientesWorkspacePath,
  clientesWorkspaceUrl,
  parseClientesWorkspaceRoute,
  readClientesWalletUrlState,
} from '../clientesRoutes'

describe('Clientes workspace route contract', () => {
  it.each([
    ['visao-geral', 'overview'],
    ['carteira', 'wallet'],
    ['acoes', 'actions'],
    ['identidades', 'identities'],
    ['qualidade', 'quality'],
    ['governanca', 'governance'],
  ] as const)('maps /clientes/%s to %s', (slug, view) => {
    expect(parseClientesWorkspaceRoute(`https://crm.example/clientes/${slug}`)).toEqual({ view, source: 'path' })
    expect(clientesWorkspacePath({ view })).toBe(`/clientes/${slug}`)
  })

  it('keeps profile deep links opaque and rejects malformed identity identifiers', () => {
    expect(parseClientesWorkspaceRoute('https://crm.example/clientes/cliente/identity_42')).toEqual({ view: 'wallet', identityId: 'identity_42', source: 'path' })
    expect(parseClientesWorkspaceRoute('https://crm.example/clientes/cliente/%2Fetc')).toBeNull()
    expect(parseClientesWorkspaceRoute('https://crm.example/clientes/cliente/identity%20with%20spaces')).toBeNull()
  })

  it('supports the existing query URL while producing canonical, allowlisted filter links', () => {
    expect(parseClientesWorkspaceRoute('https://crm.example/?module=clientes&clientesView=quality')).toEqual({ view: 'quality', source: 'legacy' })
    const url = clientesWorkspaceUrl(
      { view: 'wallet' },
      { unit: 'centro', segment: 'frequent', priority: 'high', q: 'ana', sort: 'sales', direction: 'asc', offset: 50 },
      'https://crm.example/?module=clientes&clientesView=quality&identityId=leak&unrelated=kept',
    )
    expect(url).toBe('/clientes/carteira?unrelated=kept&unit=centro&segment=frequent&priority=high&q=ana&sort=sales&direction=asc&offset=50')
  })

  it('drops unrecognized wallet values instead of forwarding them to the API', () => {
    expect(readClientesWalletUrlState('https://crm.example/clientes/carteira?unit=' + 'x'.repeat(120) + '&segment=untrusted&priority=urgent&sort=sql&direction=sideways&offset=-4')).toEqual({
      unit: 'x'.repeat(80),
      segment: '',
      priority: '',
      q: '',
      sort: 'priority',
      direction: 'desc',
      offset: 0,
    })
    expect(clientesWorkspaceUrl({ view: 'wallet' }, {
      unit: 'all',
      segment: 'untrusted',
      priority: 'urgent',
      q: 'x'.repeat(120),
      sort: 'sql' as never,
      direction: 'sideways' as never,
      offset: -1,
    })).toBe('/clientes/carteira?q=' + 'x'.repeat(96))
  })
})
