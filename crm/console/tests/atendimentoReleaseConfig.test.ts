import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const wranglerConfig = readFileSync(new URL('../wrangler.toml', import.meta.url), 'utf8')
const productionVars = wranglerConfig.split('[env.preview.r2_buckets]', 1)[0]

describe('Atendimento Pages release target', () => {
  it('routes production only to the dedicated isolated runtime', () => {
    expect(productionVars).toContain('ATENDIMENTO_API_TARGET = "https://crm-atendimento.skincos.com.br"')
    expect(productionVars).not.toContain('ATENDIMENTO_API_TARGET = "https://cs-api.skincos.com.br"')
  })

  it('does not invent a public staging runtime target', () => {
    const previewVars = wranglerConfig.split('[env.preview.vars]', 2)[1] || ''
    expect(previewVars).not.toContain('ATENDIMENTO_API_TARGET =')
  })
})
