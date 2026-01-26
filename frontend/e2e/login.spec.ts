import { test, expect } from '@playwright/test'

const email = process.env.E2E_EMAIL || ''
const password = process.env.E2E_PASSWORD || ''

test.describe('auth', () => {
  test('requires login when unauthenticated', async ({ page }) => {
    await page.goto('/')
    await expect(page.locator('#auth-email')).toBeVisible()
  })

  test('login persists session', async ({ page }) => {
    test.skip(!email || !password, 'Missing E2E_EMAIL or E2E_PASSWORD')
    await page.goto('/')
    await page.fill('#auth-email', email)
    await page.fill('#auth-password', password)
    await page.getByRole('button', { name: 'Acessar Plataforma' }).click()
    await expect(page.getByText('Insumos')).toBeVisible({ timeout: 30000 })
    await page.reload()
    await expect(page.getByText('Insumos')).toBeVisible({ timeout: 30000 })
  })
})
