import { describe, expect, it } from 'vitest'
import { isOnlineCrmRuntime, unlockedModuleKeys } from '../moduleAvailability'

describe('module availability', () => {
  it('keeps experimental modules locked in every online CRM runtime', () => {
    const unlocked = unlockedModuleKeys('insumos', true)

    for (const key of ['caixa', 'faturamento', 'meta-ads', 'meta-pages-review', 'procedimentos', 'instagram-studio', 'site-tracking', 'unit-monitor']) {
      expect(unlocked.has(key)).toBe(false)
    }
    expect(unlocked.has('atendimento')).toBe(true)
    expect(unlocked.has('clientes')).toBe(true)
  })

  it('keeps the modules available for local development validation', () => {
    const unlocked = unlockedModuleKeys('insumos', false)
    expect(unlocked.has('clientes')).toBe(true)
    expect(unlocked.has('caixa')).toBe(true)
    expect(unlocked.has('meta-ads')).toBe(true)
  })

  it('limits a modular local runtime to its canonical focus module', () => {
    expect([...unlockedModuleKeys('insumos', false, 'atendimento')]).toEqual(['atendimento'])
    expect([...unlockedModuleKeys('insumos', false, 'unknown-module')]).toEqual([])
    expect(unlockedModuleKeys('insumos', true, 'meta-ads').has('atendimento')).toBe(true)
  })

  it('distinguishes local loopback from online hosts', () => {
    expect(isOnlineCrmRuntime('localhost')).toBe(false)
    expect(isOnlineCrmRuntime('127.0.0.1')).toBe(false)
    expect(isOnlineCrmRuntime('crm.skincos.com.br')).toBe(true)
    expect(isOnlineCrmRuntime('preview.pages.dev')).toBe(true)
  })
})
