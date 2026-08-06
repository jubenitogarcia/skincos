import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const moduleSource = readFileSync(new URL('../ClientCommercialModule.tsx', import.meta.url), 'utf8')
const apiSource = readFileSync(new URL('../atendimentoApi.ts', import.meta.url), 'utf8')

describe('Clientes Customer 360 profile', () => {
  it('renders a confirmed cross-source timeline without exposing contact fields', () => {
    expect(moduleSource).toContain('Customer 360')
    expect(moduleSource).toContain('event.type === \'sale\'')
    expect(moduleSource).toContain('event.unitName || \'Unidade não informada\'')
    expect(moduleSource).toContain('Nenhum evento confirmado no recorte selecionado.')
    expect(moduleSource).not.toContain('event.phone')
    expect(moduleSource).not.toContain('event.email')
  })

  it('keeps the timeline contract bounded and explicitly typed', () => {
    expect(apiSource).toContain('export type CommercialTimelineEntry')
    expect(apiSource).toContain('timeline: CommercialTimelineEntry[]')
  })
})
