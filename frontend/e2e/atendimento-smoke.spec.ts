import { test, expect } from '@playwright/test'

const email = process.env.E2E_EMAIL || ''
const password = process.env.E2E_PASSWORD || ''

function hasText(input: string, fallback = 'teste') {
  const cleaned = (input || '').replace(/\s+/g, ' ').trim()
  if (!cleaned) return fallback
  const parts = cleaned.split(' ')
  return parts[0] || fallback
}

test.describe('atendimento', () => {
  test('smoke: abre atendimento e carrega inbox', async ({ page }) => {
    await page.goto('/')

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

    const atendimentoNav = page.getByRole('button', { name: 'Atendimento' })
    await expect(atendimentoNav).toBeVisible({ timeout: 30000 })
    await atendimentoNav.click()

    await expect(page.getByRole('heading', { name: 'Atendimento' })).toBeVisible({ timeout: 30000 })
    await expect(page.getByText('Inbox (Harmonia / WhatsApp Leads)')).toBeVisible()
    await expect(page.getByPlaceholder('Buscar contato, telefone, mensagem...')).toBeVisible()

    const inboxItems = page.locator('button[title="Abrir conversa"]')
    const count = await inboxItems.count()

    if (count === 0) {
      test.skip(true, 'Inbox vazio ou DB não configurado')
    }

    const firstItem = inboxItems.first()
    const firstText = await firstItem.innerText()
    await firstItem.click()

    await expect(page.getByText('Conversa')).toBeVisible({ timeout: 10000 })

    const searchInput = page.getByPlaceholder('Buscar contato, telefone, mensagem...')
    await searchInput.fill(hasText(firstText))
    await expect(searchInput).toHaveValue(/\w+/)

    const resolverButton = page.getByRole('button', { name: 'Resolver' })
    if (await resolverButton.isVisible().catch(() => false)) {
      const disabled = await resolverButton.isDisabled()
      if (!disabled) {
        await resolverButton.click()
        await expect(page.getByText(/Ação aplicada/i)).toBeVisible({ timeout: 10000 })
      }
    }
  })
})
