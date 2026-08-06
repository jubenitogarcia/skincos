import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const moduleSource = readFileSync(new URL('../ClientCommercialModule.tsx', import.meta.url), 'utf8')

describe('Clientes workspace navigation', () => {
  it('defines stable subareas for the commercial workspace', () => {
    for (const key of ['overview', 'wallet', 'actions', 'identities', 'quality', 'governance']) {
      expect(moduleSource).toContain(`key: '${key}'`)
    }
    expect(moduleSource).toContain('role="tablist"')
    expect(moduleSource).toContain('role="tab"')
    expect(moduleSource).toContain('data-testid="clientes-workspace-nav"')
  })

  it('keeps the selected subarea addressable without creating a new backend route', () => {
    expect(moduleSource).toContain("get('clientesView')")
    expect(moduleSource).toContain("set('clientesView', workspaceView)")
    expect(moduleSource).toContain("workspaceView === 'identities' ? <IdentityReviewQueue /> : null")
    expect(moduleSource).toContain("workspaceView === 'quality' && commercialDataQuality")
    expect(moduleSource).toContain("workspaceView === 'governance' ? <section")
  })

  it('does not render the identity queue as an unscoped duplicate on every subarea', () => {
    expect(moduleSource).not.toContain('\n    <IdentityReviewQueue />')
  })
})
