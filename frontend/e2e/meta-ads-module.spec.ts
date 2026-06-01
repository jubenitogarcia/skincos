import { test, expect, type Page } from '@playwright/test'

async function mockCrmUser(page: Page) {
  await page.route('**/api/auth/me**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ user: { username: 'e2e', role: 'GESTOR', allowedUnits: [] } }),
    })
  })
}

async function openMetaAds(page: Page) {
  await page.addInitScript(() => {
    localStorage.setItem('app.activeModule', 'meta-ads')
  })
  await page.goto('/')
  await page.reload()
  await expect(page.getByRole('heading', { name: 'Meta Ads' })).toBeVisible({ timeout: 30000 })
}

test.describe('meta ads', () => {
  test('shows a login-required state instead of a dead integration when status is unauthorized', async ({ page }) => {
    await mockCrmUser(page)

    await page.route('**/api/meta-ads/status', async (route) => {
      await route.fulfill({
        status: 401,
        contentType: 'application/json',
        body: JSON.stringify({
          ok: false,
          error: 'UNAUTHORIZED',
          code: 'UNAUTHORIZED',
          message: 'Faça login no CRM para continuar.',
          retryable: false,
        }),
      })
    })

    await openMetaAds(page)

    await expect(page.locator('body')).toContainText('Faça login no CRM para continuar', { timeout: 30000 })
    await expect(page.getByRole('button', { name: 'Conectar com Facebook' })).toBeDisabled()
    await expect(page.getByText('UNAUTHORIZED · HTTP 401')).toBeVisible()
    await expect(page.getByText('Saúde da integração')).toHaveCount(0)
    await expect(page.getByRole('tab', { name: 'Visão geral' })).toHaveCount(0)
  })

  test('surfaces connection health, selected account and inventory in a connected flow', async ({ page }) => {
    await mockCrmUser(page)

    await page.route('**/api/meta-ads/status', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          ok: true,
          oauthConfigured: true,
          missingConfig: [],
          connection: {
            connected: true,
            tokenType: 'oauth',
            metaUserId: '42',
            metaUserName: 'Jubenito Garcia',
            selectedAdAccountId: 'act_123',
            scopes: ['ads_read', 'ads_management'],
            updatedAt: '2026-05-13T12:00:00.000Z',
            expiresAt: '2026-06-13T12:00:00.000Z',
          },
        }),
      })
    })

    await page.route('**/api/meta-ads/ad-accounts', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          ok: true,
          connected: true,
          selectedAdAccountId: 'act_123',
          accounts: [
            {
              id: 'act_123',
              name: 'Conta Principal',
              account_status: '1',
              currency: 'BRL',
              timezone_name: 'America/Sao_Paulo',
              isSelected: true,
            },
          ],
        }),
      })
    })

    await page.route('**/api/meta-ads/summary**', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ spend: 1234.56, impressions: 9999, clicks: 321, activeCampaigns: 2 }),
      })
    })

    await page.route('**/api/meta-ads/trend**', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify([
          { day: '2026-05-10', spend: 100 },
          { day: '2026-05-11', spend: 120 },
        ]),
      })
    })

    await page.route('**/api/meta-ads/inventory', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          ok: true,
          accountId: 'act_123',
          inventory: {
            campaigns: [
              {
                id: 'cmp_1',
                name: 'Campanha Primavera',
                status: 'ACTIVE',
                effective_status: 'ACTIVE',
                objective: 'LEADS',
                daily_budget: '12000',
                totals: { adSets: 1, ads: 1 },
              },
              {
                id: 'cmp_2',
                name: 'Campanha WhatsApp Facial',
                status: 'PAUSED',
                effective_status: 'PAUSED',
                objective: 'MESSAGES',
                totals: { adSets: 1, ads: 1 },
              },
            ],
            adSets: [
              {
                id: 'set_1',
                name: 'Conjunto 1',
                campaign_id: 'cmp_1',
                campaign_name: 'Campanha Primavera',
                effective_status: 'ACTIVE',
                ads_count: 1,
                optimization_goal: 'LEAD_GENERATION',
              },
              {
                id: 'set_2',
                name: 'Conjunto 2',
                campaign_id: 'cmp_2',
                campaign_name: 'Campanha WhatsApp Facial',
                effective_status: 'PAUSED',
                ads_count: 1,
              },
            ],
            ads: [
              {
                id: 'ad_1',
                name: 'Anúncio 1',
                campaign_id: 'cmp_1',
                campaign_name: 'Campanha Primavera',
                adset_id: 'set_1',
                adset_name: 'Conjunto 1',
                creative: { id: 'cr_1', name: 'Criativo 1', effective_object_story_id: 'story_1' },
                effective_status: 'ACTIVE',
              },
              {
                id: 'ad_2',
                name: 'Anúncio WhatsApp 1',
                campaign_id: 'cmp_2',
                campaign_name: 'Campanha WhatsApp Facial',
                adset_id: 'set_2',
                adset_name: 'Conjunto 2',
                creative: { id: 'cr_2', name: 'Criativo WhatsApp 1' },
                effective_status: 'PAUSED',
              },
            ],
            creatives: [
              {
                id: 'cr_1',
                name: 'Criativo 1',
                campaignId: 'cmp_1',
                adSetId: 'set_1',
                adId: 'ad_1',
                adName: 'Anúncio 1',
                effectiveObjectStoryId: 'story_1',
              },
              {
                id: 'cr_2',
                name: 'Criativo WhatsApp 1',
                campaignId: 'cmp_2',
                adSetId: 'set_2',
                adId: 'ad_2',
                adName: 'Anúncio WhatsApp 1',
              },
            ],
          },
        }),
      })
    })

    await page.route('**/api/meta-ads/report**', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          ok: true,
          source: 'workflow-report',
          window: 'last_30d',
          summary: {
            spend: 1234.56,
            impressions: 9999,
            clicks: 321,
            conversations: 18,
            avgCostConversation: 68.59,
            activeCampaigns: 2,
            source: 'workflow-report',
          },
          metadata: {
            reportDate: '2026-05-14',
            runsCount: 4,
            source: 'd1',
          },
          campaigns: [
            {
              campaignId: 'cmp_1',
              campaignName: 'Campanha Primavera',
              status: 'ACTIVE',
              spend: 900,
              impressions: 7000,
              clicks: 250,
              conversations: 12,
              ctr: 3.57,
              cpc: 3.6,
              cpm: 128.57,
            },
          ],
          adSets: [
            {
              adSetId: 'set_1',
              adSetName: 'Conjunto 1',
              campaignId: 'cmp_1',
              campaignName: 'Campanha Primavera',
              spend: 900,
              impressions: 7000,
              clicks: 250,
              conversations: 12,
              ctr: 3.57,
              cpc: 3.6,
              cpm: 128.57,
            },
          ],
          ads: [
            {
              adId: 'ad_1',
              adName: 'Anúncio 1',
              adSetId: 'set_1',
              adSetName: 'Conjunto 1',
              campaignId: 'cmp_1',
              campaignName: 'Campanha Primavera',
              spend: 900,
              impressions: 7000,
              clicks: 250,
              conversations: 12,
              ctr: 3.57,
              cpc: 3.6,
              cpm: 128.57,
            },
          ],
          warnings: [],
        }),
      })
    })

    await openMetaAds(page)

    await expect(page.getByText('Conta Meta pronta para operar')).toHaveCount(0)
    await expect(page.getByText('Conta ativa: Conta Principal')).toHaveCount(0)
    await expect(page.getByRole('combobox')).toContainText('Conta Principal')
    await expect(page.getByLabel('Atualizar')).toBeVisible({ timeout: 30000 })
    await expect(page.getByText('Tendência de gasto')).toBeVisible()
    await expect(page.getByText('Conversa').first()).toBeVisible()
    await expect(page.getByText('CTR').first()).toBeVisible()
    await expect(page.getByText('Consolidado do workflow disponível')).toHaveCount(0)
    await expect(page.getByRole('button', { name: 'Campanha Primavera' })).toBeVisible()

    await expect(page.getByRole('tab', { name: 'Conexão' })).toHaveCount(0)
    await expect(page.getByRole('tab', { name: 'Visão geral' })).toHaveCount(0)
    await expect(page.getByRole('tab', { name: 'Inventário' })).toHaveCount(0)
    await expect(page.getByText('Comece conectando a Meta ao CRM.')).toHaveCount(0)
    await expect(page.getByText('OAuth:')).toHaveCount(0)

    await expect(page.locator('body')).toContainText('Mapa da conta Meta')
    await expect(page.getByRole('button', { name: 'Campanha Primavera' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Conjunto 1' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Anúncio 1', exact: true })).toBeVisible()
    await expect(page.locator('body')).toContainText('Conjunto 1')
    await expect(page.locator('body')).toContainText('Campanha WhatsApp Facial')

    const objectiveCell = page.locator('tbody tr').first().locator('td').nth(3).locator('[aria-label]').first()
    await objectiveCell.hover()
    await expect(page.getByRole('tooltip')).toContainText('Prioriza cadastros, formulários ou conversas')

    await page.getByRole('button', { name: 'Campanha Primavera' }).click()
    await expect(page.getByRole('dialog')).toContainText('Campanha Primavera')
    await expect(page.getByRole('dialog')).toContainText('Orçamento diário')
    await expect(page.getByRole('dialog')).toContainText('R$ 120,00')
    await page.getByRole('button', { name: 'Fechar' }).click()

    await page.getByRole('button', { name: 'Conjunto 1' }).click()
    await expect(page.getByRole('dialog')).toContainText('Conjunto 1')
    await expect(page.getByRole('dialog')).toContainText('Campanha Primavera')
    await page.getByRole('button', { name: 'Fechar' }).click()

    await page.getByRole('button', { name: 'Anúncio 1', exact: true }).click()
    await expect(page.getByRole('dialog')).toContainText('Anúncio 1')
    await expect(page.getByRole('dialog')).toContainText('Criativo do anúncio')
    await expect(page.getByRole('dialog')).toContainText('Criativo 1')
    await expect(page.getByRole('dialog')).toContainText('Story ID')
    await expect(page.getByRole('dialog')).toContainText('story_1')
    await page.getByRole('button', { name: 'Fechar' }).click()

    const firstRow = page.locator('tbody tr').first()
    await expect(firstRow).toContainText('Campanha Primavera')
    await page.getByRole('button', { name: 'Ordenar Invest.' }).click()
    await expect(page.locator('tbody tr').first()).toBeVisible()
    await page.getByRole('button', { name: 'Ordenar Invest.' }).click()
    await expect(page.locator('tbody tr').first()).toBeVisible()

    await expect(page.getByRole('tab', { name: 'Tracking' })).toHaveCount(0)
  })

  test('keeps the oauth flow inside CRM with a modal when the popup is blocked', async ({ page }) => {
    await mockCrmUser(page)

    await page.route('**/api/meta-ads/status', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          ok: true,
          oauthConfigured: true,
          missingConfig: [],
          connection: {
            connected: false,
            tokenType: null,
            metaUserId: null,
            metaUserName: null,
            selectedAdAccountId: null,
            scopes: [],
            updatedAt: null,
            expiresAt: null,
          },
        }),
      })
    })

    await openMetaAds(page)

    await page.evaluate(() => {
      window.open = () => null
    })

    await page.getByRole('button', { name: 'Conectar com Facebook' }).click()
    await expect(page.getByRole('dialog')).toContainText('Permita a janela do Facebook')
    await expect(page.locator('body')).not.toContainText('A autenticação será aberta nesta mesma aba.')
  })
})
