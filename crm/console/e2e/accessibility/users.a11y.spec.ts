import { expect, test } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'
import { mockUsersApi } from '../users-module-fixtures'
import { blockNonLoopbackRequests } from '../local-only'

test('Usuários keeps the unified team surface accessible', async ({ page }) => {
  await blockNonLoopbackRequests(page)
  await mockUsersApi(page)
  await page.goto('/?module=users')
  await expect(page.getByRole('heading', { name: 'Equipe' })).toBeVisible()
  const results = await new AxeBuilder({ page }).analyze()
  if (process.env.A11Y_ENFORCE === '1') expect(results.violations, JSON.stringify(results.violations, null, 2)).toEqual([])
})

