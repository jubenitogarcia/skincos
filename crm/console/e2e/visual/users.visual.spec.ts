import { expect, test } from '@playwright/test'
import { mockUsersApi } from '../users-module-fixtures'

test('Usuários renders the central team surface at the supported widths', async ({ page }, testInfo) => {
  await mockUsersApi(page)
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.addStyleTag({ content: '*,*::before,*::after{animation:none!important;transition:none!important;caret-color:transparent!important}' })
  for (const width of [390, 768, 1280]) {
    await page.setViewportSize({ width, height: width === 390 ? 844 : 720 })
    await page.goto('/?module=users')
    await expect(page.getByRole('heading', { name: 'Equipe' })).toBeVisible()
    const screenshot = await page.screenshot({ fullPage: false })
    await testInfo.attach(`users-${width}.png`, { body: screenshot, contentType: 'image/png' })
  }
})
