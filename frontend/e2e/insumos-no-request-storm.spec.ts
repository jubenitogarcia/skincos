import { test, expect } from '@playwright/test'

test.describe('insumos', () => {
  test('does not storm health/me on enter', async ({ page }) => {
    const counts = {
      insumosHealth: 0,
      insumosAuthMe: 0,
      authMe: 0
    }

    await page.route('**/api/insumos/health**', async (route) => {
      counts.insumosHealth += 1
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          ok: false,
          service: 'insumos',
          runtime: 'e2e',
          storage: 'd1',
          dbConfigured: true,
          unidades: ['novo-hamburgo', 'barra-shopping-sul']
        })
      })
    })

    await page.route('**/api/insumos/auth/me**', async (route) => {
      counts.insumosAuthMe += 1
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ success: false, user: null, csrfToken: null })
      })
    })

    await page.route('**/api/auth/me**', async (route) => {
      counts.authMe += 1
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

    await page.waitForTimeout(2500)
    const snapshot = { ...counts }

    expect(snapshot.insumosHealth).toBeLessThanOrEqual(3)
    expect(snapshot.authMe).toBeLessThanOrEqual(2)
    expect(snapshot.insumosAuthMe).toBeLessThanOrEqual(2)

    await page.waitForTimeout(2500)
    expect(counts.insumosHealth).toBeLessThanOrEqual(snapshot.insumosHealth + 1)
    expect(counts.authMe).toBeLessThanOrEqual(snapshot.authMe + 1)
    expect(counts.insumosAuthMe).toBeLessThanOrEqual(snapshot.insumosAuthMe + 1)
    expect(counts.insumosHealth).toBeLessThanOrEqual(4)
    expect(counts.authMe).toBeLessThanOrEqual(3)
    expect(counts.insumosAuthMe).toBeLessThanOrEqual(3)
  })
})
