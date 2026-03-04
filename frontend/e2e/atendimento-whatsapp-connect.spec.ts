import { test, expect } from '@playwright/test'

const email = process.env.E2E_EMAIL || ''
const password = process.env.E2E_PASSWORD || ''

test.describe('atendimento whatsapp connect', () => {
  test('conectar novo abre modal e renderiza QR', async ({ page }) => {
    let startOk = false
    let qrOk = false

    page.on('response', async (response) => {
      const url = response.url()
      if (url.includes('/api/wa-orchestrator/channels/') && url.endsWith('/start')) {
        startOk = response.ok()
      }
      if (url.includes('/api/wa-orchestrator/channels/') && url.endsWith('/qr')) {
        if (!response.ok()) return
        const body = await response.json().catch(() => null)
        qrOk = Boolean(body?.success && body?.qr)
      }
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

    const waHeaderButton = page.getByRole('button', { name: /WhatsApp/i }).first()
    if (await waHeaderButton.isVisible().catch(() => false)) {
      await waHeaderButton.click()
    }
    const waDialog = page.getByRole('dialog').filter({ hasText: /WhatsApp conectado/i }).first()
    const openedByClick = await waDialog.isVisible({ timeout: 2000 }).catch(() => false)
    if (!openedByClick) {
      await page.evaluate(() => {
        window.dispatchEvent(new CustomEvent('skincos:atendimento:header-action', { detail: { action: 'wa' } }))
      })
    }
    await expect(waDialog).toBeVisible({ timeout: 10000 })
    await page.getByRole('button', { name: 'Conectar novo' }).click()

    await expect(page.getByText(/QR Code do canal/i)).toBeVisible({ timeout: 30000 })
    await expect.poll(() => startOk, { timeout: 30000 }).toBeTruthy()
    await expect.poll(() => qrOk, { timeout: 30000 }).toBeTruthy()

    const qrImage = page.locator('img[alt^="QR "]').first()
    await expect(qrImage).toBeVisible({ timeout: 15000 })
    const src = await qrImage.getAttribute('src')
    expect(src || '').toContain('data:image/')
  })
})
