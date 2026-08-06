import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const moduleSource = readFileSync(new URL('../ClientCommercialModule.tsx', import.meta.url), 'utf8')
const apiSource = readFileSync(new URL('../atendimentoApi.ts', import.meta.url), 'utf8')

describe('Clientes assisted WhatsApp communication', () => {
  it('keeps offer context explicit, current and separate from clinical recommendation', () => {
    expect(moduleSource).toContain("status: 'approved_active'")
    expect(moduleSource).toContain('Compatibilidade com procedimentos classificados será validada no servidor')
    expect(moduleSource).toContain('offerRevision')
    expect(moduleSource).toContain('offerContextHash')
    expect(moduleSource).toContain('Oferta contextual:')
  })

  it('requires approved template, masked preview and an explicit human confirmation', () => {
    for (const contract of ['fetchCommercialWhatsappTemplates', 'previewCommercialWhatsapp', 'confirmCommercialWhatsapp', 'CONFIRMAR_ENVIO_ASSISTIDO', 'recipientMasked', 'clickToSendUrl']) {
      expect(apiSource + moduleSource).toContain(contract)
    }
    expect(moduleSource).toContain('Nenhum disparo automático ou em massa')
    expect(moduleSource).toContain("window.open(result.clickToSendUrl, '_blank'")
  })

  it('exposes emergency off only through the explicit governance control', () => {
    expect(apiSource).toContain('/commercial/contact/emergency-off')
    expect(moduleSource).toContain('CommercialEmergencyControl')
    expect(moduleSource).toContain('Emergency off de comunicação assistida')
  })
})
