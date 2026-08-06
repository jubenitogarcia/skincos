import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const source = readFileSync(new URL('../CommercialCanaryManager.tsx', import.meta.url), 'utf8')
const workspaceSource = readFileSync(new URL('../ClientCommercialModule.tsx', import.meta.url), 'utf8')

describe('Clientes commercial canary selection', () => {
  it('uses masked, server-validated candidates instead of a manual UUID input', () => {
    expect(source).toContain('CommercialCanaryManager')
    expect(source).toContain('displayNameMasked')
    expect(source).toContain('candidateRef')
    expect(source).toContain('previewCommercialCanary')
    expect(source).toContain('emergencyOffCommercialCanary')
    expect(source).toContain('Unidade do canário')
    expect(source).toContain('Opt-out')
    expect(source).not.toContain('Identidades UUID autorizadas')
    expect(source).not.toContain('placeholder="UUID da identidade sintética ou aprovada"')
    expect(workspaceSource).toContain('<CommercialCanaryManager')
    expect(workspaceSource).not.toContain('<CanarySelection')
  })
})
