import { test, expect } from '@playwright/test'

const email = process.env.E2E_EMAIL || ''
const password = process.env.E2E_PASSWORD || ''

const PNG_DATA_URL = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO4B6m8AAAAASUVORK5CYII='
const PDF_DATA_URL = 'data:application/pdf;base64,JVBERi0xLjQKJcTl8uXrPgoxIDAgb2JqPDwvVHlwZS9DYXRhbG9nL1BhZ2VzIDIgMCBSPj5lbmRvYmoKMiAwIG9iajw8L1R5cGUvUGFnZXMvS2lkc1szIDAgUl0vQ291bnQgMT4+ZW5kb2JqCjMgMCBvYmo8PC9UeXBlL1BhZ2UvUGFyZW50IDIgMCBSL01lZGlhQm94WzAgMCAzMDAgMTQ0XS9Db250ZW50cyA0IDAgUj4+ZW5kb2JqCjQgMCBvYmo8PC9MZW5ndGggNDQ+PnN0cmVhbQpCVCAvRjEgMTIgVGYgNzIgNzIgVGQgKEhlbGxvIFBERikgVGoKRVQKZW5kc3RyZWFtCmVuZG9iago1IDAgb2JqPDwvVHlwZS9Gb250L1N1YnR5cGUvVHlwZTEvTmFtZS9GMS9CYXNlRm9udC9IZWx2ZXRpY2E+PmVuZG9iagp4cmVmCjAgNgowMDAwMDAwMDAwIDY1NTM1IGYgCjAwMDAwMDAwMTAgMDAwMDAgbiAKMDAwMDAwMDA2MCAwMDAwMCBuIAowMDAwMDAwMTE3IDAwMDAwIG4gCjAwMDAwMDAyMTQgMDAwMDAgbiAKMDAwMDAwMDMwOCAwMDAwMCBuIAp0cmFpbGVyPDwvUm9vdCAxIDAgUi9TaXplIDY+PgpzdGFydHhyZWYKMzg0CiUlRU9G'
const AUDIO_DATA_URL = 'data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAIlYAAESsAAACABAAZGF0YQAAAAA='

function mockCoreEndpoints(page: any) {
  page.route('**/api/wa-orchestrator/status**', async (route: any) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        success: true,
        provider: 'evolution',
        totalChannels: 9,
        freeInstances: 8,
        connectedInstances: 1,
        errorInstances: 0,
        startingInstances: 0,
        channels: [{ id: 'wa-channel-1', channel: 1, port: 3001, status: 'connected' }]
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
            name: 'Contato Teste',
            phone: '5511999990000',
            platform: 'whatsapp',
            unreadCount: 0,
            lastMessage: 'Mídia',
            updatedAt: new Date().toISOString(),
            profilePic: ''
          }
        ]
      })
    })
  })
}

test.describe('atendimento media inline', () => {
  test('renderiza imagem, pdf e áudio inline', async ({ page }) => {
    mockCoreEndpoints(page)
    await page.route('**/api/wa-orchestrator/channels/1/conversations/**/messages?**', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          success: true,
          items: [
            { id: 'm-img', direction: 'inbound', text: 'Imagem', createdAt: new Date().toISOString(), media: { type: 'image', url: PNG_DATA_URL, mimeType: 'image/png' }, mediaProxyUrl: PNG_DATA_URL },
            { id: 'm-pdf', direction: 'inbound', text: 'PDF', createdAt: new Date().toISOString(), media: { type: 'document', url: PDF_DATA_URL, mimeType: 'application/pdf', fileName: 'teste.pdf' }, mediaProxyUrl: PDF_DATA_URL },
            { id: 'm-aud', direction: 'inbound', text: 'Áudio', createdAt: new Date().toISOString(), media: { type: 'audio', url: AUDIO_DATA_URL, mimeType: 'audio/wav' }, mediaProxyUrl: AUDIO_DATA_URL }
          ]
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

    await expect(page.getByRole('heading', { name: 'Atendimento' }).first()).toBeVisible({ timeout: 30000 })
    await page.locator('[data-testid="conversation-item"]').first().click()

    await expect(page.locator('img[alt="Imagem"]').first()).toBeVisible({ timeout: 15000 })
    await expect(page.locator('iframe[title="teste.pdf"]').first()).toBeVisible({ timeout: 15000 })
    await expect(page.getByRole('button', { name: /reproduzir áudio|pausar áudio/i }).first()).toBeVisible({ timeout: 15000 })
    await expect(page.locator('span', { hasText: /0:00/ }).first()).toBeVisible({ timeout: 15000 })

    await page.locator('img[alt="Imagem"]').first().click()
    await expect(page.getByRole('dialog')).toBeVisible({ timeout: 10000 })
    await expect(page.getByRole('heading', { name: 'Visualizar imagem' })).toBeVisible({ timeout: 10000 })
  })
})
