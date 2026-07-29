import { expect, test } from '@playwright/test'

test('pilot: local CRM shell loads and primary navigation remains keyboard reachable', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByRole('heading', { name: 'Insumos' })).toBeVisible()
  await page.getByRole('button', { name: 'Atendimento' }).focus()
  await expect(page.getByRole('button', { name: 'Atendimento' })).toBeFocused()
  await page.keyboard.press('Tab')
  await expect(page.getByRole('button', { name: 'Caixa' })).toBeFocused()
})
