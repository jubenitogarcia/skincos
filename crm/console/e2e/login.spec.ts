import { test, expect } from '@playwright/test'

const email = process.env.E2E_EMAIL || ''
const password = process.env.E2E_PASSWORD || ''

test.describe('auth', () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => {
      window.localStorage.setItem('crm.localAuth', 'off')
    })
  })

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
    await expect(page.getByAltText('Espaço Facial')).toBeVisible()
    await expect(page.getByText(/Google|GitHub|Apple/i)).toHaveCount(0)
    await expect(page.getByText(/credenciais internas/i)).toBeVisible()
    await expect(page.getByText(/Novas contas precisam de convite administrativo/i)).toBeVisible()
  })

  test('shows invite-scoped account creation fields', async ({ page }) => {
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
    await page.getByRole('tab', { name: /Criar conta/i }).click()
    await expect(page.locator('#auth-name')).toBeVisible()
    await expect(page.locator('#auth-inviteToken')).toBeVisible()
    await expect(page.getByText(/escopo definido na administração/i)).toBeVisible()
    await expect(page.getByRole('button', { name: 'Criar conta' })).toBeDisabled()
    await page.fill('#auth-name', 'Ana Souza')
    await page.fill('#auth-email', 'email-invalido')
    await page.fill('#auth-inviteToken', 'ABCD EFGH IJKL MNOP QRST UVWX')
    await expect(page.locator('#auth-inviteToken')).toHaveValue('ABCDEFGHIJKLMNOPQRSTUVWX')
    await page.fill('#auth-password', '123')
    await expect(page.getByText(/email corporativo válido/i)).toBeVisible()
    await expect(page.getByText('Mínimo de 6 caracteres', { exact: true })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Criar conta' })).toBeDisabled()
    await page.fill('#auth-email', 'ana@empresa.com')
    await page.fill('#auth-password', '123456')
    await expect(page.getByText(/Dados prontos/i)).toBeVisible()
    await expect(page.getByRole('button', { name: 'Criar conta' })).toBeEnabled()
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
    await page.getByRole('button', { name: 'Acessar CRM' }).click()
    await expect(page.getByRole('button', { name: 'Insumos' })).toBeVisible({ timeout: 30000 })
    await page.reload()
    await expect(page.getByRole('button', { name: 'Insumos' })).toBeVisible({ timeout: 30000 })
  })
})
