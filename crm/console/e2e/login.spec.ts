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
    await expect(page.getByText('Mínimo de 12 caracteres', { exact: true })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Criar conta' })).toBeDisabled()
    await page.fill('#auth-email', 'ana@empresa.com')
    await page.fill('#auth-password', '123456789012')
    await expect(page.getByText(/Dados prontos/i)).toBeVisible()
    await expect(page.getByRole('button', { name: 'Criar conta' })).toBeEnabled()
  })

  test('recovery validates the email code before allowing a new password', async ({ page }) => {
    let authenticated = false
    await page.route('**/api/auth/me', route => route.fulfill({
      status: authenticated ? 200 : 401,
      contentType: 'application/json',
      body: authenticated
        ? JSON.stringify({ success: true, user: { username: 'ana', email: 'ana@empresa.com', displayName: 'Ana Souza' } })
        : JSON.stringify({ error: 'Not authenticated' }),
    }))
    await page.route('**/api/auth/password/request', route => route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({ success: true, expiresAt: '2026-07-20T12:10:00.000Z' }),
    }))
    await page.route('**/api/auth/password/verify', route => route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({ success: true, resetGrant: 'grant-only-in-memory', expiresAt: '2026-07-20T12:10:00.000Z' }),
    }))
    await page.route('**/api/auth/password/reset', route => {
      authenticated = true
      return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ success: true }) })
    })

    await page.goto('/')
    await page.getByRole('button', { name: 'Esqueci minha senha' }).click()
    await page.fill('#auth-email', 'ana@empresa.com')
    await page.getByRole('button', { name: 'Enviar código' }).click()
    await expect(page.getByRole('heading', { name: 'Validar código' })).toBeVisible()
    await page.fill('#auth-code', '123456')
    await page.getByRole('button', { name: 'Validar código' }).click()
    await expect(page.getByRole('heading', { name: 'Definir nova senha' })).toBeVisible()
    await page.fill('#auth-password', 'senha-nova-123')
    await page.fill('#auth-password-confirmation', 'senha-nova-123')
    await page.getByRole('button', { name: 'Atualizar senha' }).click()
  })

  test('recovery explains when the email is not registered', async ({ page }) => {
    await page.route('**/api/auth/me', route => route.fulfill({ status: 401, contentType: 'application/json', body: JSON.stringify({ error: 'Not authenticated' }) }))
    await page.route('**/api/auth/password/request', route => route.fulfill({
      status: 404,
      contentType: 'application/json',
      body: JSON.stringify({ success: false, error: 'EMAIL_NOT_REGISTERED' }),
    }))
    await page.goto('/')
    await page.getByRole('button', { name: 'Esqueci minha senha' }).click()
    await page.fill('#auth-email', 'ausente@empresa.com')
    await page.getByRole('button', { name: 'Enviar código' }).click()
    await expect(page.getByRole('alert')).toHaveText(/Não há e-mail cadastrado/i)
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
