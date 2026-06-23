import { describe, expect, it } from 'vitest'

import {
  buildAtendimentoQuery,
  calculateAtendimentoValue,
  convertColorCodesToScores,
  determineAtendimentoShift,
  filterProfessionalsByUnitRole,
  normalizeCode,
  parseBrazilCurrency,
  resolveManagementLoadError,
  validateAtendimentoForm,
  type AtendimentoClinicaForm,
} from '../atendimentoClinicaDomain'

describe('Atendimento Clínica helpers', () => {
  it('preserves the migrated sheet value formula', () => {
    expect(calculateAtendimentoValue({ code: '#0799', quantity: 1, discount: false, otherValue: 0, roundValue: false })).toBe(799)
    expect(calculateAtendimentoValue({ code: '#0599', quantity: 1, discount: false, otherValue: 66, roundValue: false })).toBe(533)
    expect(calculateAtendimentoValue({ code: '#0499', quantity: 2, discount: true, otherValue: 0, roundValue: false })).toBe(968.06)
    expect(calculateAtendimentoValue({ code: '#0499', quantity: 1, discount: false, otherValue: 0, roundValue: true })).toBe(500)
  })

  it('normalizes Brazilian money and code input', () => {
    expect(parseBrazilCurrency('R$1.234,56')).toBe(1234.56)
    expect(parseBrazilCurrency('66,00')).toBe(66)
    expect(normalizeCode('799')).toBe('#0799')
  })

  it('builds a bounded query from active filters only', () => {
    expect(buildAtendimentoQuery({
      unit: 'novo-hamburgo',
      from: '2026-06-01',
      to: '',
      procedure: 'all',
      code: '799',
      injector: 'all',
      consultant: 'Consultora Sintética',
      search: 'Cliente',
    }, { limit: 50 }).toString()).toBe('unit=novo-hamburgo&from=2026-06-01&code=%230799&consultant=Consultora+Sint%C3%A9tica&search=Cliente&limit=50')
  })

  it('validates required fields and procedure-code compatibility', () => {
    const form: AtendimentoClinicaForm = {
      unitSlug: 'novo-hamburgo',
      unitName: 'Novo Hamburgo',
      date: '2026-06-10',
      clientName: 'Cliente Sintético',
      procedureName: 'Botox',
      code: '#0799',
      quantity: 1,
      discount: false,
      otherValue: 0,
      roundValue: false,
      injectorName: 'Dra. Sintética',
      consultantName: 'Consultora Sintética',
      observation: '',
    }
    expect(validateAtendimentoForm(form, ['#0799'])).toBe('')
    expect(validateAtendimentoForm({ ...form, code: '#0999' }, ['#0799'])).toBe('Código não permitido para o procedimento.')
    expect(validateAtendimentoForm({ ...form, clientName: '' }, ['#0799'])).toBe('Informe o cliente.')
  })

  it('filters staff by unit, role and current shift like the Apps Script cache', () => {
    const professionals = [
      { name: 'Injetora A', status: 'Ativo', units: ['Novo Hamburgo'], roles: ['Injetor'], turnos: ['Manhã'] },
      { name: 'Consultora A', status: 'Ativo', units: ['Novo Hamburgo'], roles: ['Coordenador', 'Consultor'], turnos: ['Tarde'] },
      { name: 'Consultora B', status: 'Inativo', units: ['Novo Hamburgo'], roles: ['Consultor'], turnos: ['Tarde'] },
    ]
    expect(determineAtendimentoShift('Novo Hamburgo', new Date('2026-06-16T15:00:00'))).toBe('Manhã')
    expect(filterProfessionalsByUnitRole(professionals, 'Novo Hamburgo', 'Injetor')).toEqual(['Injetora A'])
    expect(filterProfessionalsByUnitRole(professionals, 'Novo Hamburgo', 'Consultor', 'Tarde')).toEqual(['Consultora A'])
  })

  it('converts Gerência Apps Script background colors to scores', () => {
    expect(convertColorCodesToScores([['#6d9eeb', '#93c47d', '#ffd966', '#e06666', '#ffffff', '#000000']])).toEqual([[3, 2, 1, 0, 0, 'Erro']])
  })

  it('keeps management loading usable when optional restricted endpoints fail', () => {
    expect(resolveManagementLoadError({
      catalog: { ok: true },
      commercial: { ok: true },
      finance: { ok: true },
      inventory: { ok: true },
    })).toBe('')
    expect(resolveManagementLoadError({
      catalog: { ok: true },
      commercial: { ok: false, error: 'DATABASE_URL_not_configured' },
      finance: { ok: true },
      inventory: { ok: true },
    })).toBe('DATABASE_URL_not_configured')
  })
})
