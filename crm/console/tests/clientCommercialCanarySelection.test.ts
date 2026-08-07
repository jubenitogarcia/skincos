import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const source = readFileSync(new URL('../ClientCommercialModule.tsx', import.meta.url), 'utf8')

describe('Clientes commercial canary selection', () => {
  it('uses visible eligible profiles instead of a manual UUID input', () => {
    expect(source).toContain('function CanarySelection')
    expect(source).toContain('contactEligibility?.contactAllowed === true')
    expect(source).toContain('Selecionar ${maskedWalletCustomerLabel(index)} para o canário')
    expect(source).toContain('{maskedWalletCustomerLabel(index)}')
    expect(source).not.toContain('Selecionar ${profile.name} para o canário')
    expect(source).not.toContain('Identidades UUID autorizadas')
    expect(source).not.toContain('placeholder="UUID da identidade sintética ou aprovada"')
  })
})
