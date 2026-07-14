import { expect, test } from '@playwright/test'

const viewports = [
  { width: 928, height: 551 },
  { width: 1024, height: 768 },
  { width: 1440, height: 900 },
]

for (const viewport of viewports) {
  test(`CRM header stays inside the visible width at ${viewport.width}x${viewport.height}`, async ({ page }) => {
    await page.setViewportSize(viewport)
    await page.route('**/api/**', async (route) => {
      const path = new URL(route.request().url()).pathname
      if (path === '/api/auth/me') {
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            user: {
              username: 'e2e',
              role: 'GESTOR',
              allowedUnits: [],
              allowedModules: ['atendimento'],
            },
          }),
        })
      }
      if (path.endsWith('/references')) {
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            ok: true,
            units: [{ slug: 'novo-hamburgo', name: 'Novo Hamburgo' }],
            professionals: [],
            procedures: [],
          }),
        })
      }
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ ok: true, success: true, data: [], total: 0, summary: {}, rankings: {}, monthly: [] }),
      })
    })

    for (const pinned of [false, true]) {
      await page.addInitScript((isPinned) => {
        localStorage.setItem('ui.sidebarPinned', isPinned ? 'true' : 'false')
      }, pinned)
      await page.goto('/?module=atendimento')

      const title = page.getByRole('heading', { name: 'Atendimento' })
      await expect(title).toBeVisible({ timeout: 30_000 })
      await expect(page.getByTestId('crm-header-layout')).toBeVisible()

      const geometry = await page.evaluate(() => {
        const layout = document.querySelector('[data-testid="crm-header-layout"]')
        const actions = document.querySelector('[data-testid="crm-header-actions"]')
        const header = layout?.closest('header')
        const main = document.querySelector('main')
        const heading = layout?.querySelector('h1')
        const rect = (element: Element | null | undefined) => {
          if (!element) return null
          const value = element.getBoundingClientRect()
          return { x: value.x, right: value.right, width: value.width, height: value.height }
        }
        return {
          viewportWidth: window.innerWidth,
          documentWidth: document.documentElement.scrollWidth,
          header: rect(header),
          main: rect(main),
          layout: rect(layout),
          actions: rect(actions),
          heading: rect(heading),
        }
      })

      expect(geometry.documentWidth).toBeLessThanOrEqual(geometry.viewportWidth)
      expect(geometry.header).not.toBeNull()
      expect(geometry.main).not.toBeNull()
      expect(Math.abs(geometry.header!.x - geometry.main!.x)).toBeLessThanOrEqual(1)
      expect(Math.abs(geometry.header!.right - geometry.main!.right)).toBeLessThanOrEqual(1)
      expect(Math.abs(geometry.layout!.x - (geometry.header!.x + 32))).toBeLessThanOrEqual(1)
      expect(Math.abs(geometry.layout!.right - (geometry.header!.right - 32))).toBeLessThanOrEqual(1)
      expect(Math.abs(geometry.actions!.right - geometry.layout!.right)).toBeLessThanOrEqual(1)
      expect(geometry.heading!.height).toBeLessThanOrEqual(32)
    }
  })
}
