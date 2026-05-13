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
  await page.goto('/')
  await page.evaluate(() => {
    localStorage.setItem('app.activeModule', 'meta-ads')
  })
  await page.reload()
  const metaAdsNav = page.getByRole('button', { name: 'Meta Ads' })
  await metaAdsNav.waitFor({ state: 'visible', timeout: 30000 })
  await metaAdsNav.click()
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
                totals: { adSets: 1, ads: 1 },
              },
            ],
            adSets: [{ id: 'set_1' }],
            ads: [
              {
                id: 'ad_1',
                name: 'Anúncio 1',
                campaign_name: 'Campanha Primavera',
                adset_name: 'Conjunto 1',
                creative: { id: 'cr_1', name: 'Criativo 1' },
                effective_status: 'ACTIVE',
              },
            ],
            creatives: [
              {
                id: 'cr_1',
                name: 'Criativo 1',
                campaignId: 'cmp_1',
                adName: 'Anúncio 1',
              },
            ],
          },
        }),
      })
    })

    await page.route('**/api/tracking/**', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ ok: true, totals: {}, events: [], journeys: [], captains: [], errors: [] }),
      })
    })

    await openMetaAds(page)

    await expect(page.getByText('Conta Meta pronta para operar')).toBeVisible({ timeout: 30000 })
    await expect(page.getByText('Conta ativa: Conta Principal')).toBeVisible()
    await expect(page.getByText('Tendência de gasto')).toBeVisible()

    await expect(page.getByRole('tab', { name: 'Conexão' })).toHaveCount(0)
    await expect(page.getByRole('tab', { name: 'Visão geral' })).toBeVisible()
    await page.getByRole('button', { name: 'Gerenciar conexão' }).click()
    await expect(page.getByText('Escolher a conta de anúncios')).toBeVisible()
    await expect(page.getByText('Usuário Meta: Jubenito Garcia')).toBeVisible()

    await page.getByRole('tab', { name: 'Inventário' }).click()
    await expect(page.locator('body')).toContainText('Criativo 1')

    await page.getByRole('tab', { name: 'Tracking' }).click()
    await expect(page.getByText('Tracking do site e inventário da conta Meta convivem nesta aba')).toBeVisible()
  })
})
