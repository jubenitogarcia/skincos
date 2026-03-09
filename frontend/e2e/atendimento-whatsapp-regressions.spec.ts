import { expect, test } from '@playwright/test'

const email = process.env.E2E_EMAIL || ''
const password = process.env.E2E_PASSWORD || ''

const PNG_DATA_URL = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO4B6m8AAAAASUVORK5CYII='
const FILE_DATA_URL = 'data:text/plain;base64,SGVsbG8gU2tpbkNvcyE='

async function authenticateIfNeeded(page: any) {
  const authInput = page.locator('#auth-email')
  if (await authInput.isVisible().catch(() => false)) {
    if (!email || !password) test.skip(true, 'Missing E2E_EMAIL or E2E_PASSWORD')
    await page.fill('#auth-email', email)
    await page.fill('#auth-password', password)
    await page.getByRole('button', { name: 'Acessar Plataforma' }).click()
  }
}

function mockStatus(page: any, channels: number[]) {
  page.route('**/api/wa-orchestrator/status**', async (route: any) => {
    const instances = channels.map((channel) => ({
      id: `wa-channel-${channel}`,
      channel,
      port: 3000 + channel,
      status: 'connected',
      metadata: { phoneNumber: `+55 11 90000-00${channel}` }
    }))
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        success: true,
        provider: 'evolution',
        totalChannels: 9,
        connectedInstances: instances.length,
        freeInstances: Math.max(0, 9 - instances.length),
        errorInstances: 0,
        startingInstances: 0,
        channels: instances,
        instances
      })
    })
  })
}

function extractChannelFromUrl(url: string) {
  const match = url.match(/\/channels\/(\d+)\//)
  return Number(match?.[1] || 0)
}

async function openAtendimento(page: any) {
  await page.goto('/?module=atendimento')
  await page.evaluate(() => {
    localStorage.setItem('app.activeModule', 'atendimento')
  })
  await page.reload()
  await authenticateIfNeeded(page)
  const heading = page.getByRole('heading', { name: 'Atendimento' }).first()
  if (!(await heading.isVisible().catch(() => false))) {
    const atendimentoNav = page.getByRole('button', { name: 'Atendimento' }).first()
    if (await atendimentoNav.isVisible().catch(() => false)) {
      await atendimentoNav.click()
    }
  }
  await expect(heading).toBeVisible({ timeout: 30000 })
}

test.describe('atendimento whatsapp regressions', () => {
  test('remove não lidas ao abrir conversa e envia read-sync', async ({ page }) => {
    const readRequests: any[] = []
    mockStatus(page, [1])

    await page.route('**/api/wa-orchestrator/channels/*/conversations?**', async (route: any) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          success: true,
          items: [
            {
              conversationId: '5511912345678@s.whatsapp.net',
              name: '210329044807849',
              phone: '5511912345678',
              unreadCount: 2,
              lastMessage: 'Mensagem nova',
              updatedAt: new Date().toISOString(),
              profilePic: ''
            }
          ]
        })
      })
    })

    await page.route('**/api/wa-orchestrator/channels/*/conversations/**/messages?**', async (route: any) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          success: true,
          items: [
            {
              id: 'm-in-1',
              direction: 'inbound',
              text: 'Mensagem inbound',
              createdAt: new Date().toISOString()
            },
            {
              id: 'm-out-1',
              direction: 'outbound',
              text: 'Mensagem outbound',
              createdAt: new Date().toISOString()
            }
          ]
        })
      })
    })

    await page.route('**/api/wa-orchestrator/channels/*/conversations/**/read', async (route: any) => {
      const payload = route.request().postDataJSON()
      readRequests.push(payload)
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ success: true, readCount: payload?.messageIds?.length || 0 })
      })
    })

    await openAtendimento(page)

    const conversationItem = page.locator('[data-testid="conversation-item"]').first()
    await expect(conversationItem).toContainText('+55 (11) 91234-5678')
    await expect(conversationItem).toHaveClass(/bg-sky-400\/10/)
    await expect(conversationItem.locator('span[class*="bg-sky-500/90"]')).toHaveText('2')

    await conversationItem.click()

    await expect(page.getByText('Mensagem inbound')).toBeVisible({ timeout: 15000 })
    await expect.poll(() => readRequests.length).toBe(1)
    expect(readRequests[0]?.onlyInbound).toBe(true)
    expect(readRequests[0]?.messageIds).toEqual(['m-in-1'])
    await expect(conversationItem.locator('span[class*="bg-sky-500/90"]')).toHaveCount(0)
  })

  test('não gera erro global ao falhar fetch de mensagens', async ({ page }) => {
    const pageErrors: string[] = []
    page.on('pageerror', (error) => {
      pageErrors.push(String(error?.message || error))
    })

    mockStatus(page, [1])

    await page.route('**/api/wa-orchestrator/channels/*/conversations?**', async (route: any) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          success: true,
          items: [
            {
              conversationId: '5511912345678@s.whatsapp.net',
              name: 'Contato Instável',
              phone: '5511912345678',
              unreadCount: 1,
              lastMessage: 'Falha de rede',
              updatedAt: new Date().toISOString()
            }
          ]
        })
      })
    })

    await page.route('**/api/wa-orchestrator/channels/*/conversations/**/messages?**', async (route: any) => {
      await route.abort('failed')
    })

    await page.route('**/api/wa-orchestrator/channels/*/conversations/**/read', async (route: any) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ success: true, skipped: true, reason: 'NO_MESSAGES_TO_MARK' })
      })
    })

    await openAtendimento(page)

    const conversationItem = page.locator('[data-testid="conversation-item"]', { hasText: 'Contato Instável' }).first()
    await conversationItem.click()
    await page.waitForTimeout(800)

    await expect.poll(() =>
      pageErrors.filter((message) => message.includes('Failed to fetch') || message.includes('Unhandled Promise')).length
    ).toBe(0)
    await expect(conversationItem).toBeVisible()
  })

  test('exibe seletor de unidade apenas em conversa unificada multi-canal', async ({ page }) => {
    mockStatus(page, [1, 2])

    await page.route('**/api/wa-orchestrator/channels/*/conversations?**', async (route: any) => {
      const channel = extractChannelFromUrl(route.request().url())
      const now = new Date().toISOString()
      const channelItems =
        channel === 2
          ? [
              {
                conversationId: '5511911111111@s.whatsapp.net',
                name: 'Contato Multi',
                phone: '5511911111111',
                unreadCount: 0,
                lastMessage: 'Canal 2',
                updatedAt: now
              }
            ]
          : [
              {
                conversationId: '5511911111111@s.whatsapp.net',
                name: 'Contato Multi',
                phone: '5511911111111',
                unreadCount: 0,
                lastMessage: 'Canal 1',
                updatedAt: now
              },
              {
                conversationId: '5511922222222@s.whatsapp.net',
                name: 'Contato Único',
                phone: '5511922222222',
                unreadCount: 0,
                lastMessage: 'Canal único',
                updatedAt: now
              }
            ]
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ success: true, items: channelItems })
      })
    })

    await page.route('**/api/wa-orchestrator/channels/*/conversations/**/messages?**', async (route: any) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          success: true,
          items: [{ id: 'm-1', direction: 'inbound', text: 'Teste', createdAt: new Date().toISOString() }]
        })
      })
    })

    await page.route('**/api/wa-orchestrator/channels/*/conversations/**/read', async (route: any) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ success: true, skipped: true, reason: 'NO_MESSAGES_TO_MARK' })
      })
    })

    await openAtendimento(page)

    await page.locator('[data-testid="conversation-item"]', { hasText: 'Contato Multi' }).first().click()
    await expect(page.getByText('Unidade de envio')).toBeVisible({ timeout: 10000 })

    await page.locator('[data-testid="conversation-item"]', { hasText: 'Contato Único' }).first().click()
    await expect(page.getByText('Unidade de envio')).toHaveCount(0)
  })

  test('renderiza previews semânticos na lista para tipos especiais', async ({ page }) => {
    mockStatus(page, [1])

    await page.route('**/api/wa-orchestrator/channels/*/conversations?**', async (route: any) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          success: true,
          items: [
            {
              conversationId: '5511000000001@s.whatsapp.net',
              name: 'Contato Template',
              lastMessage: '[Mensagem]',
              lastMessageType: 'templateMessage',
              updatedAt: new Date('2026-03-05T12:00:05.000Z').toISOString()
            },
            {
              conversationId: '5511000000002@s.whatsapp.net',
              name: 'Contato Interativo',
              lastMessage: '[Mensagem]',
              lastMessageType: 'interactiveMessage',
              updatedAt: new Date('2026-03-05T12:00:04.000Z').toISOString()
            },
            {
              conversationId: '5511000000003@s.whatsapp.net',
              name: 'Contato Resposta',
              lastMessage: '[Mensagem]',
              lastMessageType: 'templateButtonReplyMessage',
              updatedAt: new Date('2026-03-05T12:00:03.000Z').toISOString()
            },
            {
              conversationId: '5511000000004@s.whatsapp.net',
              name: 'Contato Placeholder',
              lastMessage: '[Mensagem]',
              lastMessageType: 'placeholderMessage',
              updatedAt: new Date('2026-03-05T12:00:02.000Z').toISOString()
            },
            {
              conversationId: '120363000000004@g.us',
              name: 'Grupo Fixo',
              lastMessage: '[Mensagem]',
              lastMessageType: 'pinInChatMessage',
              updatedAt: new Date('2026-03-05T12:00:01.000Z').toISOString()
            },
            {
              conversationId: '5511000000005@s.whatsapp.net',
              name: 'Contato Ligação',
              lastMessage: '[Ligação]',
              lastMessageType: 'call',
              updatedAt: new Date('2026-03-05T12:00:00.000Z').toISOString()
            }
          ]
        })
      })
    })

    await page.route('**/api/wa-orchestrator/channels/*/conversations/**/messages?**', async (route: any) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ success: true, items: [] })
      })
    })

    await page.route('**/api/wa-orchestrator/channels/*/conversations/**/read', async (route: any) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ success: true, skipped: true, reason: 'NO_MESSAGES_TO_MARK' })
      })
    })

    await openAtendimento(page)

    const previews = page.getByTestId('conversation-preview')
    await expect(previews).toHaveCount(6)
    await expect(previews).toHaveText(['Modelo', 'Interativa', 'Modelo', 'Conteúdo', 'Fixada', 'Ligação'])
    await expect(page.getByText('[Mensagem]')).toHaveCount(0)
  })

  test('renderiza grupo com remetente e thumbnail e abre arquivo em modal sem nova aba', async ({ page }) => {
    let popupOpened = false
    page.context().on('page', () => {
      popupOpened = true
    })

    mockStatus(page, [1])

    await page.route('**/api/wa-orchestrator/channels/*/conversations?**', async (route: any) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          success: true,
          items: [
            {
              conversationId: '120363000000000@g.us',
              name: 'Grupo SkinCos',
              unreadCount: 0,
              lastMessage: '[Sticker]',
              lastMessageMediaType: 'sticker',
              updatedAt: new Date().toISOString()
            }
          ]
        })
      })
    })

    await page.route('**/api/wa-orchestrator/channels/*/conversations/**/messages?**', async (route: any) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          success: true,
          items: [
            {
              id: 'g-1',
              direction: 'inbound',
              text: 'Bom dia time',
              senderName: 'Ana Souza',
              senderJid: '5511998887777@s.whatsapp.net',
              senderAvatarUrl: PNG_DATA_URL,
              reactions: [{ emoji: '❤️', count: 1, reactedByMe: false }],
              createdAt: new Date().toISOString()
            },
            {
              id: 'g-2',
              direction: 'inbound',
              text: '[Sticker]',
              senderName: 'Ana Souza',
              senderJid: '5511998887777@s.whatsapp.net',
              senderAvatarUrl: PNG_DATA_URL,
              media: {
                type: 'sticker',
                url: PNG_DATA_URL,
                mimeType: 'image/webp',
                fileName: 'sticker.webp'
              },
              mediaProxyUrl: PNG_DATA_URL,
              createdAt: new Date().toISOString()
            },
            {
              id: 'g-3',
              direction: 'inbound',
              text: 'Adorei o convite @5511998887707',
              senderName: 'Carlos',
              senderJid: '5511998887707@s.whatsapp.net',
              createdAt: new Date().toISOString()
            },
            {
              id: 'g-4',
              direction: 'inbound',
              text: 'Planilha',
              senderName: 'Carlos',
              senderJid: '5511998887707@s.whatsapp.net',
              media: {
                type: 'document',
                url: FILE_DATA_URL,
                mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
                fileName: 'planilha.xlsx'
              },
              mediaProxyUrl: FILE_DATA_URL,
              createdAt: new Date().toISOString()
            },
            {
              id: 'g-5',
              direction: 'inbound',
              type: 'reactionMessage',
              text: '[Mensagem]',
              senderName: 'Carlos',
              senderJid: '5511998887707@s.whatsapp.net',
              createdAt: new Date().toISOString()
            }
          ]
        })
      })
    })

    await page.route('**/api/wa-orchestrator/channels/*/conversations/**/read', async (route: any) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ success: true })
      })
    })

    await openAtendimento(page)
    const conversationItem = page.locator('[data-testid="conversation-item"]', { hasText: 'Grupo SkinCos' }).first()
    await expect(conversationItem.getByTestId('conversation-preview')).toHaveText('Sticker')
    await expect(conversationItem).not.toContainText('[Sticker]')
    await conversationItem.click()

    await expect(page.getByText('Ana Souza').first()).toBeVisible({ timeout: 15000 })
    await expect(page.locator('img[alt="Ana Souza"]').first()).toBeVisible({ timeout: 15000 })
    await expect(page.locator('img[alt="sticker.webp"]').first()).toBeVisible({ timeout: 15000 })
    await expect(page.getByText('[Sticker]')).toHaveCount(0)
    await expect(page.getByText('Reação')).toHaveCount(0)
    await expect(page.getByText('@Carlos')).toBeVisible({ timeout: 15000 })
    await expect(page.getByRole('button', { name: /abrir anexo/i })).toHaveCount(0)
    await expect(page.getByTestId('scroll-bottom-button')).toBeVisible({ timeout: 15000 })

    const anaBubble = page.locator('div.max-w-\\[88\\%\\], div.md\\:max-w-\\[75\\%\\]').filter({ hasText: 'Bom dia time' }).first()
    const carlosBubble = page.locator('div.max-w-\\[88\\%\\], div.md\\:max-w-\\[75\\%\\]').filter({ hasText: /@Carlos/ }).first()
    const anaBg = await anaBubble.evaluate((el) => getComputedStyle(el as HTMLElement).backgroundColor)
    const carlosBg = await carlosBubble.evaluate((el) => getComputedStyle(el as HTMLElement).backgroundColor)
    expect(anaBg).not.toEqual(carlosBg)
    await expect(anaBubble.getByRole('button', { name: /❤️/ })).toBeVisible({ timeout: 15000 })

    const viewFileButton = page.getByRole('button', { name: 'Visualizar arquivo' }).first()
    await expect(viewFileButton).toBeVisible({ timeout: 15000 })
    await viewFileButton.click()

    const dialog = page.getByRole('dialog').filter({ hasText: 'planilha.xlsx' }).first()
    await expect(dialog).toBeVisible({ timeout: 10000 })
    await page.waitForTimeout(300)
    expect(popupOpened).toBe(false)
  })

  test('abre menu de ações da mensagem no canto superior direito e executa ações', async ({ page }) => {
    mockStatus(page, [1])
    const toggledFlags: string[] = []

    await page.route('**/api/wa-orchestrator/channels/*/conversations?**', async (route: any) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          success: true,
          items: [
            {
              conversationId: '120363000000000@g.us',
              name: 'Grupo SkinCos',
              unreadCount: 0,
              lastMessage: 'Bom dia time',
              updatedAt: new Date().toISOString()
            },
          ]
        })
      })
    })

    await page.route('**/api/wa-orchestrator/channels/*/conversations/**/messages?**', async (route: any) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          success: true,
          items: [
            {
              id: 'menu-1',
              direction: 'inbound',
              text: 'Bom dia time',
              senderName: 'Ana Souza',
              senderJid: '5511998887777@s.whatsapp.net',
              senderAvatarUrl: PNG_DATA_URL,
              createdAt: new Date().toISOString()
            }
          ]
        })
      })
    })

    await page.route('**/api/wa-orchestrator/channels/*/conversations/**/read', async (route: any) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ success: true, skipped: true, reason: 'NO_MESSAGES_TO_MARK' })
      })
    })

    await page.route('**/api/wa-orchestrator/channels/*/conversations/**/messages/*/flags/toggle', async (route: any) => {
      const payload = route.request().postDataJSON()
      toggledFlags.push(String(payload?.field || ''))
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          success: true,
          flags: {
            favorite: payload?.field === 'favorite',
            pinned: false,
            reported: false
          }
        })
      })
    })

    await openAtendimento(page)

    await page.locator('[data-testid="conversation-item"]', { hasText: 'Grupo SkinCos' }).first().click()
    await expect(page.getByTestId('message-bubble').getByText('Bom dia time')).toBeVisible({ timeout: 15000 })

    const actionTrigger = page.getByTestId('message-actions-trigger-menu-1')
    await actionTrigger.click()
    await page.getByRole('menuitem', { name: 'Favoritar' }).click()
    expect(toggledFlags).toEqual(['favorite'])
    await expect(page.getByText('Favorita')).toBeVisible()

    await actionTrigger.click()
    await page.getByRole('menuitem', { name: 'Selecionar mensagens' }).click()
    await expect(page.getByText('1 mensagem selecionada')).toBeVisible()

    await actionTrigger.click()
    await page.getByRole('menuitem', { name: 'Encaminhar' }).click()
    await expect(page.locator('textarea[placeholder*="Digite sua mensagem"]')).toHaveValue(/\[Encaminhada\]\nBom dia time/)
  })

  test('apaga mensagem via endpoint e remove o balão da conversa', async ({ page }) => {
    mockStatus(page, [1])
    const deletedMessageIds: string[] = []

    await page.route('**/api/wa-orchestrator/channels/*/conversations?**', async (route: any) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          success: true,
          items: [
            {
              conversationId: '120363000000000@g.us',
              name: 'Grupo SkinCos',
              unreadCount: 0,
              lastMessage: 'Mensagem para apagar',
              updatedAt: new Date().toISOString()
            },
          ]
        })
      })
    })

    await page.route('**/api/wa-orchestrator/channels/*/conversations/**/messages?**', async (route: any) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          success: true,
          items: [
            {
              id: 'delete-1',
              direction: 'inbound',
              text: 'Mensagem para apagar',
              senderName: 'Ana Souza',
              senderJid: '5511998887777@s.whatsapp.net',
              senderAvatarUrl: PNG_DATA_URL,
              createdAt: new Date().toISOString()
            }
          ]
        })
      })
    })

    await page.route('**/api/wa-orchestrator/channels/*/conversations/**/read', async (route: any) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ success: true, skipped: true, reason: 'NO_MESSAGES_TO_MARK' })
      })
    })

    await page.route('**/api/wa-orchestrator/channels/*/conversations/**/messages/*', async (route: any) => {
      if (route.request().method() !== 'DELETE') {
        await route.fallback()
        return
      }
      deletedMessageIds.push(route.request().url())
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ success: true, deleted: true })
      })
    })

    await openAtendimento(page)

    await page.locator('[data-testid="conversation-item"]', { hasText: 'Grupo SkinCos' }).first().click()
    await expect(page.getByTestId('message-bubble').getByText('Mensagem para apagar')).toBeVisible({ timeout: 15000 })

    await page.getByTestId('message-actions-trigger-delete-1').click()
    await page.getByRole('menuitem', { name: 'Apagar' }).click()

    await expect(page.getByTestId('message-bubble').filter({ hasText: 'Mensagem para apagar' })).toHaveCount(0)
    expect(deletedMessageIds).toHaveLength(1)
  })
})
