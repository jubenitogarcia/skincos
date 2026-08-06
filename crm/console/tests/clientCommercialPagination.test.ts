import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const moduleSource = readFileSync(new URL('../ClientCommercialModule.tsx', import.meta.url), 'utf8')
const apiSource = readFileSync(new URL('../atendimentoApi.ts', import.meta.url), 'utf8')

describe('Clientes commercial pagination', () => {
  it('requests bounded server pagination and exposes deterministic navigation', () => {
    expect(moduleSource).toContain('server: true')
    expect(moduleSource).toContain('limit: pageSize')
    expect(moduleSource).toContain('Anterior')
    expect(moduleSource).toContain('Próxima')
    expect(moduleSource).toContain('paginação SQL')
    expect(moduleSource).not.toContain('fetchCommercialOverview({ unit, segment, priority, q: search, limit: 100')
  })

  it('serializes sort, direction and the explicit server opt-in', () => {
    expect(apiSource).toContain("server?: boolean")
    expect(apiSource).toContain("sort?: string")
    expect(apiSource).toContain("direction?: 'asc' | 'desc'")
    expect(apiSource).toContain("if (value === true) params.set(key, '1')")
  })

  it('exposes total-aware pagination for the assisted operations queue', () => {
    expect(apiSource).toContain('hasPrevious: boolean; hasNext: boolean')
    expect(apiSource).toContain('offset?: number')
    expect(readFileSync(new URL('../CommercialOperationsPanel.tsx', import.meta.url), 'utf8')).toContain('wallet.pagination.hasNext')
  })
})
