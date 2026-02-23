import { test, expect } from '@playwright/test'

test.describe('insumos', () => {
  test('limits concurrent overview/insights fan-out requests', async ({ page }) => {
    let trackedInFlight = 0
    let trackedMax = 0

    const trackedPrefixes = [
      '/api/insumos/analytics/overview',
      '/api/insumos/analytics/insights',
    ]

    const delay = (ms: number) => new Promise((r) => setTimeout(r, ms))

    await page.route('**/api/insumos/**', async (route) => {
      const reqUrl = new URL(route.request().url())
      const path = reqUrl.pathname
      const shouldTrack = trackedPrefixes.some((p) => path.startsWith(p))

      if (shouldTrack) {
        trackedInFlight += 1
        trackedMax = Math.max(trackedMax, trackedInFlight)
      }

      try {
        if (shouldTrack) await delay(200)

        const json = (() => {
          if (path.startsWith('/api/insumos/analytics/overview')) {
            return {
              success: true,
              data: {
                resumo: {},
                itens: [],
                notifications: {},
                actionables: {},
                roi: {},
                quality: {},
                movResumo: {},
                movSeries: []
              }
            }
          }
          if (path.startsWith('/api/insumos/analytics/insights')) return { success: true, data: { alertas: [], trends: {}, turnover: { saida: {}, entrada: {} } } }
          if (path.startsWith('/api/insumos/relatorios/estoque')) return { success: true, data: { resumo: {}, itens: [] } }
          if (path.startsWith('/api/insumos/notifications/summary')) return { success: true, data: {} }
          if (path.startsWith('/api/insumos/analytics/')) return { success: true, data: {} }
          if (path.startsWith('/api/insumos/quality/report')) return { success: true, data: {} }
          if (path.startsWith('/api/insumos/movimentacoes')) return { success: true, data: [] }
          if (path.startsWith('/api/insumos/alertas/estoque')) return { success: true, data: [] }
          if (path.startsWith('/api/insumos/health')) return { ok: true, service: 'insumos', runtime: 'e2e', storage: 'd1', dbConfigured: true, unidades: ['novo-hamburgo', 'barra-shopping-sul'] }
          if (path.startsWith('/api/insumos/auth/me')) return { success: true, user: { username: 'e2e', role: 'ADMIN', allowedUnits: [] }, csrfToken: 'e2e' }
          return { success: true }
        })()

        await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(json) })
      } finally {
        if (shouldTrack) trackedInFlight = Math.max(0, trackedInFlight - 1)
      }
    })

    await page.route('**/api/auth/me**', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ user: { username: 'e2e', role: 'ADMIN', allowedUnits: [] } })
      })
    })

    await page.goto('/?insumos=1')
    const insumosNav = page.getByRole('button', { name: 'Insumos' })
    await expect(insumosNav).toBeVisible({ timeout: 30000 })
    await insumosNav.click()

    await page.waitForTimeout(3000)

    expect(trackedMax).toBeLessThanOrEqual(4)
  })
})
