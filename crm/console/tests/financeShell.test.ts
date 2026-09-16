import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

describe('Finance CRM shell boundary', () => {
  it('routes Finance browser requests through the Pages proxy instead of the static shell', () => {
    const routes = JSON.parse(readFileSync(new URL('../public/_routes.json', import.meta.url), 'utf8'))
    expect(routes.include).toContain('/api/finance/*')
  })

  it('unlocks Finance navigation only after the server bootstrap authorizes it', () => {
    const app = readFileSync(new URL('../App.tsx', import.meta.url), 'utf8')
    expect(app).toContain("financeEnabled ? 'finance' : DEFAULT_MODULE_KEY,")
    expect(app).toContain("user?.localFocusModule || ''")
    expect(app).toContain('}, [financeEnabled, initializing])')
    expect(app).toContain('resolveFinanceBootstrapEnabled')
  })

  it('keeps the local authorization smoke synchronized with the asynchronous Finance bootstrap gate', () => {
    const smoke = readFileSync(new URL('../scripts/finance-local-smoke.cjs', import.meta.url), 'utf8')
    expect(smoke).toContain("financeNav.waitFor({ state: 'hidden', timeout: 30_000 })")
    expect(smoke).toContain('bootstrap.body.moduleEnabled !== false || bootstrap.body.canAccess !== false')
    expect(smoke).toContain("scenario === 'no-module' && /server responded with a status of 403/i.test(message)")
    expect(smoke).toContain('expectedOfflineClientErrors')
    expect(smoke).toContain('expectedNoModuleClientErrors')
    expect(smoke).toContain('unexpectedClientErrors.length')
  })
})
