import { test, expect } from '@playwright/test'

test.describe('insumos', () => {
  test('does not show simulated-data banner by default', async ({ page }) => {
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
    const insumosNav = page.getByRole('button', { name: 'Insumos', exact: true })
    await expect(insumosNav).toBeVisible({ timeout: 30000 })
    await insumosNav.click()

    await page.waitForTimeout(1200)
    await expect(page.getByText('DADOS SIMULADOS')).toHaveCount(0)
  })
})
