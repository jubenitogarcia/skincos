import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const moduleSource = readFileSync(new URL('../ClientCommercialModule.tsx', import.meta.url), 'utf8')
const panelSource = readFileSync(new URL('../CommercialAssistedWhatsappPanel.tsx', import.meta.url), 'utf8')
const apiSource = readFileSync(new URL('../atendimentoApi.ts', import.meta.url), 'utf8')
const runbook = readFileSync(new URL('../../../docs/runbooks/clientes-commercial-assisted-whatsapp-v2.md', import.meta.url), 'utf8')

describe('Clientes assisted communication console', () => {
  it('mounts the profile panel with the existing action context', () => {
    expect(moduleSource).toContain('CommercialAssistedWhatsappPanel')
    expect(moduleSource).toContain('<CommercialAssistedWhatsappPanel actions={detail.actions} onUpdated={onRefresh} />')
    expect(panelSource).toContain('aria-label="Comunicação assistida por WhatsApp"')
    expect(panelSource).toContain('recipientMasked')
  })

  it('keeps mutations compiled off and does not add a transport or destination exposure path', () => {
    expect(panelSource).toContain('const COMMERCIAL_ASSISTED_MUTATIONS_ENABLED = false')
    expect(panelSource).toContain('commercialContactWritesEnabled')
    expect(panelSource).toContain('CONFIRMAR_CONTATO_ASSISTIDO')
    expect(panelSource).not.toMatch(/wa\.me|window\.open|href=|handoffs|reveal|dispatch|provider|phone|email/i)
    expect(apiSource).not.toContain('/commercial/assisted-whatsapp/handoffs')
  })

  it('uses only the governed API contracts and documents the fail-closed panel', () => {
    expect(apiSource).toContain('fetchCommercialAssistedReadiness')
    expect(apiSource).toContain('fetchCommercialAssistedOffers')
    expect(apiSource).toContain('fetchCommercialAssistedTemplates')
    expect(apiSource).toContain('previewCommercialAssistedWhatsapp')
    expect(apiSource).toContain('confirmCommercialAssistedWhatsapp')
    expect(runbook).toContain('controles mutáveis permanecem desabilitados')
    expect(runbook).toContain('não emite transporte externo')
  })
})