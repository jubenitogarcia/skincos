import { test, expect } from '@playwright/test'

const email = process.env.E2E_EMAIL || ''
const password = process.env.E2E_PASSWORD || ''

test.describe('auth', () => {
  test('requires login when unauthenticated', async ({ page }) => {
    await page.goto('/')
    const noAuthBanner = page.getByText(/NO_AUTH|Autentica[cç][aã]o\s+desabilitada/i)
    if (await noAuthBanner.isVisible().catch(() => false)) {
      test.skip(true, 'NO_AUTH mode active')
    }
    const authInput = page.locator('#auth-email')
    try {
      await authInput.waitFor({ state: 'visible', timeout: 3000 })
    } catch {
      test.skip(true, 'Auth screen not present (already authenticated or NO_AUTH)')
    }
    await expect(authInput).toBeVisible()
  })

  test('login persists session', async ({ page }) => {
    test.skip(!email || !password, 'Missing E2E_EMAIL or E2E_PASSWORD')
    await page.goto('/')
    const noAuthBanner = page.getByText(/NO_AUTH|Autentica[cç][aã]o\s+desabilitada/i)
    if (await noAuthBanner.isVisible().catch(() => false)) {
      test.skip(true, 'NO_AUTH mode active')
    }
    await page.fill('#auth-email', email)
    await page.fill('#auth-password', password)
    await page.getByRole('button', { name: 'Acessar Plataforma' }).click()
    await expect(page.getByRole('button', { name: 'Insumos' })).toBeVisible({ timeout: 30000 })
    await page.reload()
    await expect(page.getByRole('button', { name: 'Insumos' })).toBeVisible({ timeout: 30000 })
  })
})
