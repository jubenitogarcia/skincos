import { test, expect } from '@playwright/test'

test.describe('escala', () => {
  test('renders overview and schedule from API', async ({ page }) => {
    await page.route('**/api/auth/me**', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ user: { username: 'e2e', role: 'GESTOR', allowedUnits: [] } })
      })
    })

    await page.route('**/api/insumos/auth/me**', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ success: true, user: { username: 'e2e', role: 'GESTOR', allowedUnits: [] }, csrfToken: 'e2e' })
      })
    })

    await page.route('**/api/escala/overview', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ ok: true, units: ['Novo Hamburgo'], months: ['2026-03'] })
      })
    })

    await page.route('**/api/escala/professionals**', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          ok: true,
          data: [
            { name: 'Dra. Ana', status: 'Ativo', units: ['Novo Hamburgo'], role: 'Injetor', shift: '', nickname: '', phone: '', email: '', instagram: '' }
          ]
        })
      })
    })

    await page.route('**/api/escala/schedule**', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          ok: true,
          schedule: [{ date: '2026-03-05', unit: 'Novo Hamburgo', professional: 'Dra. Ana' }],
          closedDays: [{ date: '2026-03-10', unit: 'Novo Hamburgo', reason: 'Feriado local' }],
          holidays: [{ date: '2026-03-20', unit: 'Novo Hamburgo', name: 'Dia do Cliente' }]
        })
      })
    })

    await page.goto('/?module=escala-profissionais')

    await expect(page.getByText('Escala de Profissionais')).toBeVisible({ timeout: 30000 })
    await expect(page.getByText('Dra. Ana')).toBeVisible()
    await expect(page.getByText('Dia do Cliente')).toBeVisible()
    await expect(page.getByText('Feriado local')).toBeVisible()
  })
})
