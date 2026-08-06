import { describe, expect, it } from 'vitest'
import {
  buildClientesPath,
  clientesFiltersFromSearch,
  isClientesPath,
  parseClientesLocation,
} from '../clientesRoutes'

describe('Clientes route contract', () => {
  it('parses every deep-link section and the profile route', () => {
    expect(parseClientesLocation({ pathname: '/clientes/visao-geral', search: '' }).view).toBe('overview')
    expect(parseClientesLocation({ pathname: '/clientes/carteira', search: '?q=synthetic&page=2' }).filters).toMatchObject({ q: 'synthetic', page: 2 })
    expect(parseClientesLocation({ pathname: '/clientes/cliente/identity-abc_1', search: '' })).toMatchObject({ view: 'wallet', identityId: 'identity-abc_1' })
    expect(parseClientesLocation({ pathname: '/clientes/cliente/not%20safe', search: '' }).view).toBe('overview')
  })

  it('builds stable shareable filter URLs without PII fields', () => {
    expect(buildClientesPath('wallet', {
      q: 'synthetic', page: 2, sort: 'priority', direction: 'desc',
      assigned: 'none', stale: 'stale', columns: 'identity,lastAttendance',
    })).toBe('/clientes/carteira?q=synthetic&page=2&sort=priority&direction=desc&assigned=none&stale=stale&columns=identity%2ClastAttendance')
    expect(buildClientesPath('wallet', { q: 'synthetic' }, 'identity-abc_1')).toBe('/clientes/cliente/identity-abc_1?q=synthetic')
  })

  it('recognizes direct links and ignores arbitrary query keys', () => {
    expect(isClientesPath('/clientes')).toBe(true)
    expect(isClientesPath('/clientes/governanca')).toBe(true)
    expect(isClientesPath('/atendimento')).toBe(false)
    expect(clientesFiltersFromSearch('?phone=should-not-be-used&q=synthetic')).toEqual({ q: 'synthetic' })
  })
})
