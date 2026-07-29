import { expect, test } from '@playwright/test'

test('CRM shell visual baseline uses the local non-mutating initial state', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByRole('heading', { name: 'Insumos' })).toBeVisible()
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.addStyleTag({ content: '*,*::before,*::after{animation:none!important;transition:none!important;caret-color:transparent!important}' })
  await expect(page.getByRole('banner')).toHaveScreenshot('crm-shell-header.png', { animations: 'disabled' })
})
