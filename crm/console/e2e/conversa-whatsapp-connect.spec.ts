import { test, expect, type Page } from '@playwright/test'

const email = process.env.E2E_EMAIL || ''
const password = process.env.E2E_PASSWORD || ''

async function openConversa(page: Page) {
  await page.goto('/?module=conversa')

  const authInput = page.locator('#auth-email')
  if (await authInput.isVisible().catch(() => false)) {
    if (!email || !password) test.skip(true, 'Missing E2E_EMAIL or E2E_PASSWORD')
    await page.fill('#auth-email', email)
    await page.fill('#auth-password', password)
    await page.getByRole('button', { name: 'Acessar Plataforma' }).click()
  }

  await expect(page.getByRole('heading', { name: 'Conversa' }).first()).toBeVisible({ timeout: 30000 })
}

async function openWhatsAppDialog(page: Page, expectConnectedDialog = true) {
  const dialog = page.getByRole('dialog').filter({ hasText: /WhatsApp conectado/i })
  const waHeaderButton = page.getByRole('button', { name: /WhatsApp/i }).first()
  if (await waHeaderButton.isVisible().catch(() => false)) {
    await waHeaderButton.click()
  } else {
    await page.evaluate(() => {
      window.dispatchEvent(new CustomEvent('skincos:conversa:header-action', { detail: { action: 'wa' } }))
    })
  }
  if (!expectConnectedDialog) return
  const openedFromHeader = await dialog.waitFor({ state: 'visible', timeout: 2000 }).then(() => true).catch(() => false)
  if (!openedFromHeader) {
    await page.evaluate(() => {
      window.dispatchEvent(new CustomEvent('skincos:conversa:header-action', { detail: { action: 'wa' } }))
    })
  }
  await expect(dialog).toBeVisible({ timeout: 10000 })
}

const freeChannelStatus = {
  success: true,
  provider: 'evolution',
  totalChannels: 9,
  availableChannels: 9,
  connectedInstances: 0,
  freeInstances: 1,
  errorInstances: 0,
  startingInstances: 0,
  channels: [{ channel: 1, instanceName: 'crm-channel-1', status: 'free' }],
  freeChannelsList: [1],
  availableChannelsList: [1],
}

test.describe('conversa whatsapp connect', () => {
  test('shows immediate connection progress, then renders the returned QR without pairing an account', async ({ page }) => {
    let startRequests = 0
    let qrRequests = 0
    await page.route('**/api/wa-orchestrator/status', route => route.fulfill({ json: freeChannelStatus }))
    await page.route('**/api/wa-orchestrator/channels/1/start', async route => {
      startRequests += 1
      await new Promise(resolve => setTimeout(resolve, 250))
      await route.fulfill({ json: { success: true, channel: 1, status: 'qr_pending' } })
    })
    await page.route('**/api/wa-orchestrator/channels/1/qr', route => {
      qrRequests += 1
      return route.fulfill({ json: { success: true, channel: 1, qr: 'mock-qr-payload' } })
    })

    await openConversa(page)
    await openWhatsAppDialog(page)
    await expect(page.getByRole('dialog').filter({ hasText: /WhatsApp conectado/i })).toBeVisible()
    await page.getByRole('button', { name: 'Conectar novo' }).click()

    await expect.poll(() => startRequests, { timeout: 10000 }).toBe(1)
    await expect(page.getByText('Conectando ao WhatsApp')).toBeVisible({ timeout: 10000 })
    await expect(page.getByText('QR Code do canal 1')).toBeVisible({ timeout: 10000 })
    const qrImage = page.locator('img[alt="QR 1"]')
    await expect(qrImage).toBeVisible()
    await expect(qrImage).toHaveAttribute('src', /data:image\//)
    expect(qrRequests).toBe(1)
  })

  test('reuses a pending unpaired channel before starting a pristine slot', async ({ page }) => {
    let pristineStarts = 0
    let pendingStarts = 0
    let pendingQrRequests = 0
    await page.route('**/api/wa-orchestrator/status', route => route.fulfill({
      json: {
        ...freeChannelStatus,
        freeInstances: 1,
        startingInstances: 1,
        channels: [
          { channel: 1, name: 'WhatsApp Channel 1', status: 'free', createdAt: null, updatedAt: null },
          { channel: 2, name: 'crm-channel-2', status: 'qr_pending', createdAt: '2026-07-17T10:00:00.000Z' },
        ],
        freeChannelsList: [1],
        availableChannelsList: [1, 2],
      },
    }))
    await page.route('**/api/wa-orchestrator/channels/1/start', route => {
      pristineStarts += 1
      return route.fulfill({ json: { success: true, channel: 1 } })
    })
    await page.route('**/api/wa-orchestrator/channels/2/start', route => {
      pendingStarts += 1
      return route.fulfill({ json: { success: true, channel: 2 } })
    })
    await page.route('**/api/wa-orchestrator/channels/2/qr', route => {
      pendingQrRequests += 1
      return route.fulfill({ json: { success: true, channel: 2, status: 'qr_pending', qr: 'pending-channel-qr' } })
    })

    await openConversa(page)
    await openWhatsAppDialog(page)
    await page.getByRole('button', { name: 'Conectar novo' }).click()

    await expect(page.getByText('QR Code do canal 2')).toBeVisible({ timeout: 10000 })
    await expect(page.locator('img[alt="QR 2"]')).toBeVisible()
    expect(pendingQrRequests).toBeGreaterThan(0)
    expect(pendingStarts).toBe(0)
    expect(pristineStarts).toBe(0)
  })

  test('recycles the same free unpaired channel instead of creating the next channel', async ({ page }) => {
    let existingStarts = 0
    let existingQrRequests = 0
    let pristineStarts = 0
    await page.route('**/api/wa-orchestrator/status', route => route.fulfill({
      json: {
        ...freeChannelStatus,
        freeInstances: 2,
        channels: [
          { channel: 1, name: 'WhatsApp Channel 1', status: 'free', createdAt: null, updatedAt: null },
          { channel: 2, name: 'crm-channel-2', status: 'free', createdAt: '2026-07-17T10:00:00.000Z', metadata: {} },
        ],
        freeChannelsList: [1, 2],
        availableChannelsList: [1, 2],
      },
    }))
    await page.route('**/api/wa-orchestrator/channels/1/start', route => {
      pristineStarts += 1
      return route.fulfill({ json: { success: true, channel: 1 } })
    })
    await page.route('**/api/wa-orchestrator/channels/2/start', route => {
      existingStarts += 1
      return route.fulfill({ json: { success: true, channel: 2, status: 'qr_pending', qr: 'existing-channel-qr' } })
    })
    await page.route('**/api/wa-orchestrator/channels/2/qr', route => {
      existingQrRequests += 1
      return route.fulfill({ json: { success: true, channel: 2, status: 'qr_pending', qr: 'existing-channel-qr' } })
    })

    await openConversa(page)
    await openWhatsAppDialog(page)
    await page.getByRole('button', { name: 'Conectar novo' }).click()

    await expect(page.getByText('QR Code do canal 2')).toBeVisible({ timeout: 10000 })
    await expect(page.locator('img[alt="QR 2"]')).toBeVisible()
    expect(existingStarts).toBe(1)
    expect(pristineStarts).toBe(0)

    const firstQrDialog = page.getByRole('dialog').filter({ hasText: /QR Code do canal 2/i })
    await firstQrDialog.getByRole('button', { name: 'Fechar' }).click()
    await page.getByRole('dialog').filter({ hasText: /WhatsApp conectado/i }).getByRole('button', { name: 'Conectar novo' }).click()
    await expect(page.locator('img[alt="QR 2"]')).toBeVisible()
    expect(existingStarts).toBe(1)
    expect(existingQrRequests).toBe(0)
  })

  test('missing target is visible and never starts a WhatsApp channel', async ({ page }) => {
    let startRequests = 0
    let statusRequests = 0
    await page.route('**/api/wa-orchestrator/status', route => {
      statusRequests += 1
      return route.fulfill({
        status: 503,
        json: {
          success: false,
          code: 'WA_ORCHESTRATOR_API_TARGET_REQUIRED',
          hint: 'Configure WA_ORCHESTRATOR_API_TARGET para o adaptador local do WhatsApp.',
          localStub: true,
        },
      })
    })
    await page.route('**/api/wa-orchestrator/channels/*/start', route => {
      startRequests += 1
      return route.fulfill({ status: 500, json: { success: false } })
    })

    await openConversa(page)
    await expect.poll(() => statusRequests, { timeout: 10000 }).toBeGreaterThan(0)
    await openWhatsAppDialog(page, false)
    const dialog = page.getByRole('dialog').filter({ hasText: /Integração WhatsApp indisponível/i })
    await expect(dialog).toBeVisible()
    await expect(dialog.getByText('WA_ORCHESTRATOR_API_TARGET_REQUIRED')).toBeVisible()
    await expect(dialog.getByRole('button', { name: 'Tentar novamente' })).toBeEnabled()
    expect(startRequests).toBe(0)
  })

  test('real local adapter returns a QR when explicitly enabled', async ({ page }) => {
    test.skip(process.env.E2E_REAL_WA !== '1', 'Set E2E_REAL_WA=1 only for the local Evolution adapter')
    let startOk = false
    let qrOk = false
    let startResponses = 0
    let qrResponses = 0

    page.on('response', async response => {
      const url = response.url()
      if (url.includes('/api/wa-orchestrator/channels/') && url.endsWith('/start')) {
        startOk = response.ok()
        if (response.ok()) {
          startResponses += 1
          const body = await response.json().catch(() => null)
          qrOk = qrOk || Boolean(body?.success && body?.qr)
        }
      }
      if (url.includes('/api/wa-orchestrator/channels/') && url.endsWith('/qr') && response.ok()) {
        const body = await response.json().catch(() => null)
        qrOk = Boolean(body?.success && body?.qr)
        if (qrOk) qrResponses += 1
      }
    })

    await openConversa(page)
    const proxyStatus = await page.request.get('/api/wa-orchestrator/_proxy-status')
    expect(proxyStatus.ok()).toBeTruthy()
    await expect(proxyStatus.json()).resolves.toEqual(expect.objectContaining({
      mode: 'real',
      targetSource: 'WA_ORCHESTRATOR_API_TARGET',
      reachability: 'reachable',
    }))

    await openWhatsAppDialog(page)
    const waDialog = page.getByRole('dialog').filter({ hasText: /WhatsApp conectado/i })
    await expect(waDialog).toBeVisible()
    await page.getByRole('button', { name: 'Conectar novo' }).click()
    await expect.poll(() => startOk || qrOk, { timeout: 30000 }).toBeTruthy()
    await expect(page.getByText(/QR Code do canal/i)).toBeVisible({ timeout: 15000 })
    await expect.poll(() => qrOk, { timeout: 30000 }).toBeTruthy()
    await expect(page.locator('img[alt^="QR "]').first()).toBeVisible()

    const firstQrDialog = page.getByRole('dialog').filter({ hasText: /QR Code do canal/i })
    const firstQrTitle = await firstQrDialog.getByRole('heading', { name: /QR Code do canal/i }).innerText()
    const startResponsesBeforeReuse = startResponses
    await firstQrDialog.getByRole('button', { name: 'Fechar' }).click()
    await expect(firstQrDialog).toBeHidden()

    await waDialog.getByRole('button', { name: 'Conectar novo' }).click()
    const reusedQrDialog = page.getByRole('dialog').filter({ hasText: /QR Code do canal/i })
    await expect(reusedQrDialog.getByRole('heading', { name: firstQrTitle })).toBeVisible({ timeout: 15000 })
    await expect(reusedQrDialog.locator('img[alt^="QR "]').first()).toBeVisible()
    expect(startResponses).toBe(startResponsesBeforeReuse)
  })
})
