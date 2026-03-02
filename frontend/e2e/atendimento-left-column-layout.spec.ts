import { test, expect } from '@playwright/test'

const email = process.env.E2E_EMAIL || ''
const password = process.env.E2E_PASSWORD || ''

test.describe('atendimento left column layout', () => {
  test('coluna esquerda compacta sem clipping', async ({ page }) => {
    await page.route('**/api/wa-orchestrator/status**', async (route: any) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          success: true,
          provider: 'evolution',
          channels: [{ id: 'wa-channel-1', channel: 1, port: 3001, status: 'connected' }],
          connectedInstances: 1,
          freeInstances: 8,
          errorInstances: 0
        })
      })
    })

    await page.route('**/api/wa-orchestrator/channels/1/conversations?**', async (route: any) => {
      const now = new Date().toISOString()
      const items = Array.from({ length: 12 }).map((_, i) => ({
        conversationId: `55119999900${String(i).padStart(2, '0')}@s.whatsapp.net`,
        name: `Contato ${i}`,
        unreadCount: i % 3 === 0 ? i % 5 : 0,
        lastMessage: `Mensagem ${i}`,
        updatedAt: now
      }))
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ success: true, items })
      })
    })

    await page.route('**/api/wa-orchestrator/channels/1/conversations/**/messages?**', async (route: any) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ success: true, items: [] })
      })
    })

    await page.goto('/?module=atendimento')
    const authInput = page.locator('#auth-email')
    if (await authInput.isVisible().catch(() => false)) {
      if (!email || !password) test.skip(true, 'Missing E2E_EMAIL or E2E_PASSWORD')
      await page.fill('#auth-email', email)
      await page.fill('#auth-password', password)
      await page.getByRole('button', { name: 'Acessar Plataforma' }).click()
    }

    await expect(page.getByPlaceholder('Buscar por nome, telefone, perfil ou plataforma')).toBeVisible({ timeout: 30000 })
    await expect(page.getByRole('heading', { name: 'Conversas' })).toHaveCount(0)

    const geometry = await page.evaluate(() => {
      const firstItem = document.querySelector('[data-testid="conversation-item"]') as HTMLElement | null
      const viewport = firstItem?.closest('[data-slot="scroll-area-viewport"]') as HTMLElement | null
      const filterBar = document.querySelector('[data-slot="scroll-area-viewport"]')?.parentElement?.parentElement?.querySelector('div.flex.flex-wrap.items-center') as HTMLElement | null
      const search = document.querySelector('input[placeholder*="Buscar por nome"]') as HTMLElement | null
      if (!firstItem || !viewport || !filterBar || !search) return null
      const itemRect = firstItem.getBoundingClientRect()
      const viewportRect = viewport.getBoundingClientRect()
      const filterRect = filterBar.getBoundingClientRect()
      const searchRect = search.getBoundingClientRect()
      return {
        itemRight: itemRect.right,
        viewportRight: viewportRect.right,
        filterBottom: filterRect.bottom,
        searchTop: searchRect.top,
        searchBottom: searchRect.bottom,
        firstItemTop: itemRect.top
      }
    })

    expect(geometry).not.toBeNull()
    expect((geometry as any).itemRight).toBeLessThanOrEqual((geometry as any).viewportRight + 1)
    expect((geometry as any).filterBottom).toBeLessThan((geometry as any).searchTop + 2)
    expect((geometry as any).searchBottom).toBeLessThan((geometry as any).firstItemTop + 6)
  })
})
