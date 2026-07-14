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
        body: JSON.stringify({ user: { username: 'e2e', role: 'GESTOR', allowedUnits: [] } })
      })
    })

    await page.goto('/?insumos=1')
    const insumosNav = page.getByRole('button', { name: 'Insumos', exact: true })
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

  test('stops insumos background traffic after leaving the module', async ({ page }) => {
    let backgroundRequests = 0

    await page.route('**/api/insumos/**', async (route) => {
      const path = new URL(route.request().url()).pathname
      if (!path.startsWith('/api/insumos/health') && !path.startsWith('/api/insumos/auth/me')) {
        backgroundRequests += 1
      }

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
            unidades: ['novo-hamburgo']
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
            user: { username: 'e2e', role: 'GESTOR', allowedUnits: ['novo-hamburgo'] },
            csrfToken: 'e2e'
          })
        })
        return
      }

      if (path.startsWith('/api/insumos/analytics/overview')) {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ success: true, data: { summary: {} } })
        })
        return
      }

      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ success: true, data: [], resumo: { total: 0 } })
      })
    })

    await page.route('**/api/auth/me**', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ user: { username: 'e2e', role: 'GESTOR', allowedUnits: ['novo-hamburgo'] } })
      })
    })

    await page.route('**/api/wa-orchestrator/status', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          success: true,
          provider: 'evolution',
          totalChannels: 1,
          availableChannels: 0,
          freeInstances: 0,
          connectedInstances: 1,
          errorInstances: 0,
          startingInstances: 0,
          channels: [{ channel: 1, status: 'connected', name: 'Canal 1' }]
        })
      })
    })

    await page.route('**/api/wa-orchestrator/channels/*/conversations**', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ success: true, conversations: [] })
      })
    })

    await page.goto('/?insumos=1')

    const insumosNav = page.getByRole('button', { name: 'Insumos', exact: true })
    await expect(insumosNav).toBeVisible({ timeout: 30000 })
    await insumosNav.click()
    await page.waitForTimeout(2000)
    expect(backgroundRequests).toBeGreaterThan(0)

    const snapshot = backgroundRequests
    await page.getByRole('button', { name: 'Conversa', exact: true }).click()
    await page.waitForTimeout(2500)

    expect(backgroundRequests).toBe(snapshot)
  })
})
