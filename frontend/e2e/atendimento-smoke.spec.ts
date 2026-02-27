import { test, expect } from '@playwright/test'

const email = process.env.E2E_EMAIL || ''
const password = process.env.E2E_PASSWORD || ''

test.describe('atendimento', () => {
  test('smoke: abre atendimento e carrega inbox', async ({ page }) => {
    await page.goto('/?module=atendimento')

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

    const atendimentoHeading = page.getByRole('heading', { name: 'Atendimento' }).first()
    if (!(await atendimentoHeading.isVisible().catch(() => false))) {
      const atendimentoNav = page.getByRole('button', { name: 'Atendimento' })
      if (await atendimentoNav.isVisible().catch(() => false)) {
        await atendimentoNav.click()
      }
    }

    await expect(atendimentoHeading).toBeVisible({ timeout: 30000 })
    const searchInput = page.getByPlaceholder('Buscar por nome, telefone, perfil ou plataforma')
    await expect(searchInput).toBeAttached({ timeout: 30000 })

    const convItems = page.locator('[data-testid="conversation-item"]')
    const count = await convItems.count()
    if (count > 0) {
      await convItems.first().click()
      await expect(page.getByPlaceholder('Digite sua mensagem...')).toBeVisible({ timeout: 10000 })
    }
  })
})
