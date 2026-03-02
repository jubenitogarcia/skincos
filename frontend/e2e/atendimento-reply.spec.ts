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
            name: 'Contato Reply',
            unreadCount: 0,
            lastMessage: 'Mensagem',
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
          { id: 'm-1', direction: 'inbound', text: 'Mensagem base', createdAt: new Date().toISOString() }
        ]
      })
    })
  })
}

test.describe('atendimento reply', () => {
  test('reply mostra referência e envia metadados', async ({ page }) => {
    mockBase(page)
    let requestBody: any = null
    page.route('**/api/wa-orchestrator/channels/1/conversations/**/send', async (route: any) => {
      requestBody = route.request().postDataJSON()
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          success: true,
          ack: { id: 'm-sent-1', replyTo: { messageId: requestBody?.replyToMessageId, textPreview: requestBody?.replyToPreview } }
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
    const messageBubble = page.locator('.group').first()
    await messageBubble.hover()
    await page.getByRole('button', { name: 'Responder mensagem' }).first().click()

    await expect(page.getByText('Respondendo:')).toBeVisible({ timeout: 10000 })
    await page.getByPlaceholder('Digite sua mensagem...').fill('Teste reply')
    await page.getByRole('button', { name: 'Enviar' }).click()

    await expect.poll(() => requestBody).not.toBeNull()
    expect(String(requestBody?.replyToMessageId || '')).toBe('m-1')
    expect(String(requestBody?.replyToPreview || '')).toContain('Mensagem base')
  })
})
