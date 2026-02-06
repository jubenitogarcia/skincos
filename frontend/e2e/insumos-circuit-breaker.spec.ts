import { test, expect } from '@playwright/test'

test.describe('insumos', () => {
  test('pauses auto-sync after repeated API failures and allows resume', async ({ page }) => {
    let overviewRequests = 0

    const unstablePrefixes = [
      '/api/insumos/analytics/overview',
      '/api/insumos/analytics/insights',
    ]

    await page.route('**/api/insumos/**', async (route) => {
      const reqUrl = new URL(route.request().url())
      const path = reqUrl.pathname

      if (path.startsWith('/api/insumos/health')) {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            ok: true,
            service: 'insumos',
            runtime: 'e2e',
            storage: 'd1',
            dbConfigured: true,
            unidades: ['novo-hamburgo', 'barra-shopping-sul']
          })
        })
        return
      }

      if (path.startsWith('/api/insumos/auth/me')) {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            success: true,
            user: { username: 'e2e', role: 'ADMIN', allowedUnits: [] },
            csrfToken: 'e2e'
          })
        })
        return
      }

      if (path.startsWith('/api/insumos/analytics/overview')) {
        overviewRequests += 1
      }

      if (unstablePrefixes.some((prefix) => path.startsWith(prefix))) {
        await route.fulfill({
          status: 503,
          headers: { 'x-request-id': `e2e-${Date.now()}` },
          contentType: 'application/json',
          body: JSON.stringify({ success: false, error: 'upstream unavailable' })
        })
        return
      }

      if (path.startsWith('/api/insumos/insumos')) {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ success: true, data: [], resumo: { total: 0 } })
        })
        return
      }

      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true, data: [] }) })
    })

    await page.route('**/api/auth/me**', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ user: { username: 'e2e', role: 'ADMIN', allowedUnits: [] } })
      })
    })

    await page.goto('/?insumos=1')
    await expect(page.getByText('Insumos')).toBeVisible({ timeout: 30000 })
    await page.getByText('Insumos').click()
    await page.waitForTimeout(1000)

    // Repeated manual reloads force overview/insights and should trip the breaker.
    for (let index = 0; index < 6; index += 1) {
      await page.evaluate(() => {
        window.dispatchEvent(new CustomEvent('skincos:insumos:overview', { detail: { action: 'reload' } }))
      })
      await page.waitForTimeout(900)
    }

    await expect(page.getByText('API instável detectada.')).toBeVisible({ timeout: 10000 })

    const requestsBeforePauseProbe = overviewRequests
    await page.evaluate(() => {
      window.dispatchEvent(new CustomEvent('skincos:insumos:overview', { detail: { period: '7d' } }))
    })
    await page.waitForTimeout(800)
    expect(overviewRequests).toBe(requestsBeforePauseProbe)

    await page.getByRole('button', { name: 'Retomar auto-sync' }).click()

    await page.evaluate(() => {
      window.dispatchEvent(new CustomEvent('skincos:insumos:overview', { detail: { period: '30d' } }))
    })
    await page.waitForTimeout(800)
    expect(overviewRequests).toBeGreaterThan(requestsBeforePauseProbe)
  })
})
