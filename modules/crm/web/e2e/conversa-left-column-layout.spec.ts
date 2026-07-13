import { test, expect } from '@playwright/test'

const email = process.env.E2E_EMAIL || ''
const password = process.env.E2E_PASSWORD || ''

test.describe('conversa left column layout', () => {
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

    await page.goto('/?module=conversa')
    await page.waitForTimeout(1000)
    const loginVisible = (await page.getByText(/Acessar Plataforma/i).count()) > 0
    if (loginVisible) {
      if (!email || !password) test.skip(true, 'Missing E2E_EMAIL or E2E_PASSWORD')
      const authInput = page.locator('#auth-email, input[placeholder*="empresa.com"], input[type="email"]').first()
      await authInput.fill(email)
      const passwordInput = page.locator('#auth-password, input[type="password"]').first()
      await passwordInput.fill(password)
      await page.getByRole('button', { name: 'Acessar Plataforma' }).click()
    }

    const searchInput = page.locator('[data-testid="omnichannel-search"], input[placeholder*="Buscar por nome"]')
    await expect(searchInput.first()).toBeVisible({ timeout: 30000 })
    await expect(page.getByRole('heading', { name: 'Conversas' })).toHaveCount(0)

    const geometry = await page.evaluate(() => {
      const firstItem = document.querySelector('[data-testid="conversation-item"]') as HTMLElement | null
      const viewport = document.querySelector('[data-testid="conversation-scroll"]') as HTMLElement | null
      const filterBar = document.querySelector('[data-testid="conversation-filters"]') as HTMLElement | null
      const search = document.querySelector('[data-testid="omnichannel-search"]') as HTMLElement | null
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
