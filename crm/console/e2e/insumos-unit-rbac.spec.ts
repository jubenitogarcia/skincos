import { test, expect } from '@playwright/test'

async function mockInsumos(page: import('@playwright/test').Page, allowedUnits: string[], requests: string[]) {
  await page.route('**/api/insumos/**', async (route) => {
    const path = new URL(route.request().url()).pathname
    if (!path.endsWith('/health') && !path.endsWith('/auth/me')) requests.push(route.request().url())
    if (path.endsWith('/health')) {
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, ready: true, dbConfigured: true, unidades: ['novo-hamburgo', 'barra-shopping-sul'] }) })
    }
    if (path.endsWith('/auth/me')) {
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true, user: { username: 'e2e', role: 'GESTOR', allowedUnits }, csrfToken: 'e2e' }) })
    }
    if (path.includes('/movimentacoes')) {
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true, movimentos: [], resumo: { totalMovimentacoes: 0 } }) })
    }
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true, data: [], resumo: { total: 0 } }) })
  })
  await page.route('**/api/auth/me**', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ user: { username: 'e2e', role: 'GESTOR', allowedUnits } }) }))
}

test.describe('Insumos unit RBAC', () => {
  test('reconciles a stale local unit before movement requests', async ({ page }) => {
    const requests: string[] = []
    await page.addInitScript(() => localStorage.setItem('skincos.insumos.unidade.v1', 'Novo Hamburgo'))
    await mockInsumos(page, ['BSS'], requests)

    await page.goto('/?insumos=1')
    await page.getByRole('button', { name: 'Insumos', exact: true }).click()
    await page.waitForTimeout(1800)

    const movementRequests = requests.filter((url) => url.includes('/movimentacoes'))
    expect(movementRequests.length).toBeGreaterThan(0)
    expect(movementRequests.every((url) => new URL(url).searchParams.get('unidade') === 'barra-shopping-sul')).toBe(true)
    await expect.poll(() => page.evaluate(() => localStorage.getItem('skincos.insumos.unidade.v1'))).toBe('barra-shopping-sul')
  })

  test('does not send Insumos data requests for a user without units', async ({ page }) => {
    const requests: string[] = []
    await mockInsumos(page, [], requests)

    await page.goto('/?insumos=1')
    await page.getByRole('button', { name: 'Insumos', exact: true }).click()
    await expect(page.getByText(/ainda não possui uma unidade autorizada/i)).toBeVisible({ timeout: 10000 })
    await page.waitForTimeout(900)

    expect(requests).toEqual([])
  })
})
