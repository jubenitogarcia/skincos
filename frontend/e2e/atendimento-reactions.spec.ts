import { test, expect } from '@playwright/test'

const email = process.env.E2E_EMAIL || ''
const password = process.env.E2E_PASSWORD || ''

function mockBase(page: any) {
  page.route('**/api/wa-orchestrator/status**', async (route: any) => {
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
  page.route('**/api/wa-orchestrator/channels/1/conversations?**', async (route: any) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        success: true,
        items: [
          {
            conversationId: '5511999990000@s.whatsapp.net',
            name: 'Contato Reação',
            unreadCount: 0,
            lastMessage: 'Reagir',
            updatedAt: new Date().toISOString()
          }
        ]
      })
    })
  })
  page.route('**/api/wa-orchestrator/channels/1/conversations/**/messages?**', async (route: any) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        success: true,
        items: [
          {
            id: 'm-reaction',
            direction: 'inbound',
            text: 'Mensagem com reação',
            createdAt: new Date().toISOString(),
            reactions: [{ emoji: '👍', count: 1, reactedByMe: false }]
          }
        ]
      })
    })
  })
}

test.describe('atendimento reactions', () => {
  test('toggle reação atualiza contador', async ({ page }) => {
    mockBase(page)
    let currentCount = 1
    page.route('**/api/wa-orchestrator/channels/1/conversations/**/messages/**/reactions/toggle', async (route: any) => {
      const body = route.request().postDataJSON() || {}
      const emoji = body.emoji || '👍'
      currentCount = currentCount === 1 ? 2 : 1
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          success: true,
          reactions: [{ emoji, count: currentCount, reactedByMe: currentCount > 1 }]
        })
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

    await page.locator('[data-testid="conversation-item"]').first().click()
    const firstMessage = page.locator('.group').first()
    await firstMessage.hover()
    await page.getByRole('button', { name: 'Reagir mensagem' }).first().click()
    await page.locator('button').filter({ hasText: '👍' }).first().click()

    await expect(page.locator('button').filter({ hasText: '👍' }).first()).toContainText('2')
  })
})
