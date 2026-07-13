import { expect, test } from '@playwright/test'

test('Instagram status remains stable and refreshes once per manual action', async ({ page }) => {
  let statusRequests = 0

  await page.route('**/api/auth/me**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ user: { username: 'e2e', role: 'GESTOR', allowedUnits: [], allowedModules: ['conversa'] } }),
    })
  })
  await page.route('**/api/instagram/status**', async (route) => {
    statusRequests += 1
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ ok: true, connected: true, businessAccountId: 'ig-e2e' }),
    })
  })

  await page.goto('/?module=conversa')
  await expect(page.getByRole('heading', { name: 'Conversa' })).toBeVisible({ timeout: 30_000 })
  await page.waitForTimeout(2_500)

  const initialRequests = statusRequests
  expect(initialRequests).toBeLessThanOrEqual(2)

  await page.waitForTimeout(2_500)
  expect(statusRequests).toBe(initialRequests)

  await page.getByRole('button', { name: 'Instagram', exact: true }).click()
  await expect(page.getByRole('dialog').getByText('Instagram conectado', { exact: true })).toBeVisible()
  await page.getByRole('dialog').getByRole('button', { name: 'Atualizar', exact: true }).click()
  await expect.poll(() => statusRequests).toBe(initialRequests + 1)
})
