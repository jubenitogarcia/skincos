import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const source = readFileSync(new URL('../ClientCommercialModule.tsx', import.meta.url), 'utf8')
const manager = readFileSync(new URL('../CommercialCanaryManager.tsx', import.meta.url), 'utf8')

describe('Clientes commercial canary selection', () => {
  it('uses an isolated masked selector instead of visible raw profiles or a UUID list', () => {
    expect(source).toContain('CommercialCanaryManager')
    expect(source).not.toContain('function CanarySelection')
    expect(source).not.toContain('selectedCanaryIdentityIds')
    expect(manager).toContain('displayNameMasked')
    expect(manager).toContain('fetchCommercialCanaryCandidates')
    expect(manager).toContain('previewCommercialCanary')
    expect(manager).toContain('saveCommercialCanary')
    expect(manager).toContain('emergencyOffCommercialCanary')
    expect(source).not.toContain('Identidades UUID autorizadas')
    expect(source).not.toContain('placeholder="UUID da identidade sintética ou aprovada"')
  })

  it('keeps commercial contact disabled in the UI while the selector records an audited cohort', () => {
    expect(source).toMatch(/function commercialRolloutAllows[\s\S]*return false/)
    expect(manager).toContain('Escrita comercial: desativada')
    expect(manager).toContain('Mensagens enviadas: 0')
    expect(manager).toContain('Justificativa operacional (sem PII)')
  })
})
