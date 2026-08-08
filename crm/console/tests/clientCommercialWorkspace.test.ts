import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const moduleSource = readFileSync(new URL('../ClientCommercialModule.tsx', import.meta.url), 'utf8')
const appSource = readFileSync(new URL('../App.tsx', import.meta.url), 'utf8')
const navigationSource = readFileSync(new URL('../ClientesWorkspaceNavigation.tsx', import.meta.url), 'utf8')
const routeSource = readFileSync(new URL('../clientesRoutes.ts', import.meta.url), 'utf8')
const storeSource = readFileSync(new URL('../../api/server/atendimento/store.js', import.meta.url), 'utf8')

describe('Clientes workspace navigation', () => {
  it('defines stable, canonical subareas for the commercial workspace', () => {
    for (const key of ['overview', 'wallet', 'actions', 'identities', 'quality', 'governance']) {
      expect(routeSource).toContain(`key: '${key}'`)
    }
    for (const slug of ['visao-geral', 'carteira', 'acoes', 'identidades', 'qualidade', 'governanca']) {
      expect(routeSource).toContain(`slug: '${slug}'`)
    }
    expect(navigationSource).toContain('role="tablist"')
    expect(navigationSource).toContain('role="tab"')
    expect(navigationSource).toContain('data-testid="clientes-workspace-nav"')
    expect(navigationSource).toContain('href={clientesWorkspaceUrl')
  })

  it('keeps the selected subarea addressable and restores it on browser history', () => {
    expect(routeSource).toContain('parseClientesWorkspaceRoute')
    expect(routeSource).toContain('readClientesWalletUrlState')
    expect(routeSource).toContain('clientesWorkspaceQueryKeys')
    expect(routeSource).toContain("url.searchParams.delete(key)")
    expect(appSource).toContain('parseClientesWorkspaceRoute(window.location)')
    expect(appSource).toContain("window.addEventListener('popstate', onPopState)")
    expect(moduleSource).toContain("window.addEventListener('popstate', onPopState)")
    expect(moduleSource).toContain("workspaceView === 'identities' ? <ClientesWorkspaceSection sectionKey=\"identities\"><div className=\"space-y-6\"><IdentityClusterWorkspace /><IdentityReviewQueue /></div></ClientesWorkspaceSection> : null")
    expect(moduleSource).not.toContain('Object.entries(item.context)')
    expect(moduleSource).not.toContain('Object.entries(item.evidence)')
    expect(moduleSource).toContain("workspaceView === 'quality' && commercialDataQuality")
    expect(moduleSource).toContain("workspaceView === 'quality' && commercialSourceOperations")
    expect(moduleSource).toContain("workspaceView === 'quality') void loadCommercialSourceOperations()")
    expect(moduleSource).toContain('aria-label="Estado operacional das fontes"')
    expect(moduleSource).toContain("'não aplicado'")
    expect(moduleSource).toContain("workspaceView === 'governance' ? <section")
  })

  it('keeps PII and identities out of the default wallet table', () => {
    const walletTableStart = moduleSource.lastIndexOf('<tbody>{overview?.profiles.map')
    const walletTableEnd = moduleSource.indexOf('</tbody></table>', walletTableStart)
    expect(walletTableStart).toBeGreaterThanOrEqual(0)
    expect(walletTableEnd).toBeGreaterThan(walletTableStart)
    const walletTable = moduleSource.slice(walletTableStart, walletTableEnd)
    expect(walletTable).toContain('maskedWalletCustomerLabel')
    expect(walletTable).toContain("href={clientesWorkspaceUrl({ view: 'wallet', identityId: profile.identityId }, walletUrlState)}")
    expect(walletTable).not.toContain('profile.name')
    expect(walletTable).not.toContain('profile.recommendedAction')
    expect(storeSource).toContain('map(minimizeCommercialOverviewProfile)')
  })

  it('does not render the identity queue as an unscoped duplicate on every subarea', () => {
    expect(moduleSource).not.toContain('\n    <IdentityReviewQueue />')
  })
})
