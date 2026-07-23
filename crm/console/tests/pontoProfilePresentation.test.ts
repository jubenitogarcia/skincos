import { describe, expect, it } from 'vitest'
import { profileFieldLabel, profileMissingSummary, profileValue } from '../pontoProfilePresentation'

describe('ponto profile presentation', () => {
  it('makes blank template fields clear without inventing data', () => {
    expect(profileValue(null)).toBe('Não informado')
    expect(profileFieldLabel('employeeCode')).toBe('matrícula')
  })

  it('summarizes missing fields and document status without revealing documents', () => {
    expect(profileMissingSummary({ documents: { cpf: 'PENDENTE', pis: 'CADASTRADO', rg: 'PENDENTE', family: 'PENDENTE' } }, ['employeeCode', 'city']))
      .toBe('Cadastros pendentes: matrícula, cidade • 3 documento(s) pendente(s).')
  })
})
