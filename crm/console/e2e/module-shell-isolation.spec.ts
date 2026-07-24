import { expect, test, type Page } from '@playwright/test'

async function mockAuthenticatedShell(page: Page, allowedModules: string[] = ['finance']) {
  await page.route('**/api/**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ ok: true, success: true, data: [], total: 0, summary: {}, rankings: {}, monthly: [], units: [{ slug: 'novo-hamburgo', name: 'Novo Hamburgo' }] }),
    })
  })
  await page.route('**/api/auth/me**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        ok: true,
        user: {
          username: 'shell-e2e',
          email: 'shell-e2e@staging.invalid',
          role: 'GESTOR',
          allowedUnits: ['novo-hamburgo'],
          allowedModules,
        },
      }),
    })
  })
  await page.route('**/api/finance/bootstrap**', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, moduleEnabled: true, canAccess: true }) })
  })
}

test('direct URLs retain an isolated maintenance state and keep other modules reachable', async ({ page }) => {
  await mockAuthenticatedShell(page)
  await page.goto('/?module=atendimento')

  await expect(page.getByTestId('module-unavailable')).toBeVisible()
  await expect(page.getByText('Atendimento em manutenção', { exact: true })).toBeVisible()
  await expect(page.getByText(/navegação e os demais módulos continuam disponíveis/i)).toBeVisible()

  await page.getByRole('button', { name: 'Voltar aos módulos' }).click()
  await expect(page).toHaveURL(/module=insumos/)
})

test('unit selection remains available after the shell loads a module directly', async ({ page }) => {
  await mockAuthenticatedShell(page)
  await page.goto('/?module=insumos')

  const unitPicker = page.getByRole('combobox').first()
  await expect(unitPicker).toBeVisible({ timeout: 30_000 })
  await unitPicker.click()
  await page.getByRole('option', { name: 'Barra Shopping Sul' }).click()
  await expect(unitPicker).toContainText('Barra Shopping Sul')
})

test('a Finance chunk failure does not take down the shell or another module', async ({ page }) => {
  await mockAuthenticatedShell(page)
  await page.route('**/FinanceModule.tsx*', async (route) => route.abort('failed'))
  await page.goto('/?module=finance')

  await expect(page.getByText('Este módulo está indisponível')).toBeVisible({ timeout: 30_000 })
  await expect(page.getByText(/falha foi isolada/i)).toBeVisible()
  await expect(page.getByRole('button', { name: 'Insumos' })).toBeVisible()

  // Vite's development error overlay is outside the application shell. Dismiss it
  // before exercising the navigation that remains available in the real bundle.
  const closeDevOverlay = page.locator('#close-overlay')
  if (await closeDevOverlay.isVisible().catch(() => false)) await closeDevOverlay.click()
  await page.getByRole('button', { name: 'Insumos' }).click()
  await expect(page).toHaveURL(/module=insumos/)
  await expect(page.getByRole('heading', { name: 'Insumos' })).toBeVisible({ timeout: 30_000 })
})
