import { describe, expect, it } from 'vitest'
import { resolvePontoLegacyHandoff } from '../src/legacyHandoff'

const target = 'https://ponto.skincos.com.br'

describe('resolvePontoLegacyHandoff', () => {
  it('maps the current query-string entrypoint without installing a redirect', () => {
    expect(resolvePontoLegacyHandoff({ origin: 'https://crm.skincos.com.br', pathname: '/', search: '?module=ponto' }, target)).toBe(`${target}/`)
  })

  it('maps both terminal spellings to the dedicated terminal path', () => {
    expect(resolvePontoLegacyHandoff({ origin: 'https://crm.skincos.com.br', pathname: '/ponto-terminal' }, target)).toBe(`${target}/ponto-terminal.html`)
    expect(resolvePontoLegacyHandoff({ origin: 'https://crm.skincos.com.br', pathname: '/ponto-terminal.html' }, target)).toBe(`${target}/ponto-terminal.html`)
  })

  it('does not map unrelated legacy locations or unsafe targets', () => {
    expect(resolvePontoLegacyHandoff({ origin: 'https://crm.skincos.com.br', pathname: '/', search: '?module=insumos' }, target)).toBeNull()
    expect(resolvePontoLegacyHandoff({ origin: 'https://elsewhere.example', pathname: '/', search: '?module=ponto' }, target)).toBeNull()
    expect(resolvePontoLegacyHandoff({ origin: 'https://crm.skincos.com.br', pathname: '/', search: '?module=ponto' }, 'http://ponto.skincos.com.br')).toBeNull()
  })
})
