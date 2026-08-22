import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const wranglerConfig = readFileSync(new URL('../wrangler.toml', import.meta.url), 'utf8')
const productionConfig = wranglerConfig.split('[env.preview.r2_buckets]', 1)[0]
const previewVars = wranglerConfig.split('[env.preview.vars]', 2)[1] || ''

describe('CRM Pages production Ponto secret binding', () => {
  it('leaves the production API target exclusively to the remote Pages secret', () => {
    expect(productionConfig).not.toMatch(/^PONTO_API_TARGET\s*=/m)
  })

  it('keeps the staging API target as an explicit preview variable', () => {
    expect(previewVars).toContain('PONTO_API_TARGET = "https://api-staging.skincos.com.br"')
  })
})
