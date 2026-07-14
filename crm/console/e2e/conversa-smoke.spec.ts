import { test, expect } from '@playwright/test'

const email = process.env.E2E_EMAIL || ''
const password = process.env.E2E_PASSWORD || ''

test.describe('conversa', () => {
  test('smoke: abre conversa e carrega inbox', async ({ page }) => {
    await page.goto('/?module=conversa')

    const noAuthBanner = page.getByText(/NO_AUTH|Autentica[cç][aã]o\s+desabilitada/i)
    if (await noAuthBanner.isVisible().catch(() => false)) {
      test.skip(true, 'NO_AUTH mode active')
    }

    const authInput = page.locator('#auth-email')
    if (await authInput.isVisible().catch(() => false)) {
      if (!email || !password) {
        test.skip(true, 'Missing E2E_EMAIL or E2E_PASSWORD')
      }
      await page.fill('#auth-email', email)
      await page.fill('#auth-password', password)
      await page.getByRole('button', { name: 'Acessar Plataforma' }).click()
    }

    const conversaHeading = page.getByRole('heading', { name: 'Conversa' }).first()
    if (!(await conversaHeading.isVisible().catch(() => false))) {
      const conversaNav = page.getByRole('button', { name: 'Conversa' })
      if (await conversaNav.isVisible().catch(() => false)) {
        await conversaNav.click()
      }
    }

    await expect(conversaHeading).toBeVisible({ timeout: 30000 })
    const searchInput = page.getByPlaceholder('Buscar por nome, telefone, perfil ou plataforma')
    await expect(searchInput).toBeAttached({ timeout: 30000 })

    const convItems = page.locator('[data-testid="conversation-item"]')
    const count = await convItems.count()
    if (count > 0) {
      await convItems.first().click()
      await expect(page.getByPlaceholder('Digite sua mensagem...')).toBeVisible({ timeout: 10000 })
    }
  })

  test('sincroniza a rota ao trocar de Conversa para Atendimento', async ({ page }) => {
    await page.goto('/?module=conversa')

    const atendimentoNav = page.locator('[data-module-nav="true"][data-module-key="atendimento"]')
    await expect(atendimentoNav).toBeVisible({ timeout: 30000 })
    await atendimentoNav.click()

    await expect(page).toHaveURL(/\?module=atendimento(?:&|$)/)
    await expect(page.getByRole('heading', { name: 'Atendimento' })).toBeVisible({ timeout: 30000 })
  })
})
