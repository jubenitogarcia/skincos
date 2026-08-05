import { test, expect } from '@playwright/test'

test.describe('insumos', () => {
  test('product row opens contextual operation with locked product identity and history', async ({ page }) => {
    await page.route('**/api/insumos/**', async (route) => {
      const reqUrl = new URL(route.request().url())
      const path = reqUrl.pathname

      if (path.startsWith('/api/insumos/health')) {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            ok: true,
            ready: true,
            service: 'insumos',
            runtime: 'e2e',
            storage: 'd1',
            dbConfigured: true,
            unidades: ['novo-hamburgo', 'barra-shopping-sul']
          })
        })
        return
      }

      if (path.startsWith('/api/insumos/auth/me')) {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            success: true,
            user: { username: 'e2e', role: 'GESTOR', allowedUnits: ['novo-hamburgo'] },
            csrfToken: 'e2e'
          })
        })
        return
      }

      if (path.startsWith('/api/insumos/options')) {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            success: true,
            data: {
              categorias: ['Preenchedor', 'Fio PDO'],
              marcas: ['Rennova', 'Allergan']
            }
          })
        })
        return
      }

      if (path.startsWith('/api/insumos/insumos')) {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            success: true,
            data: [
              {
                registro: 'r-001',
                codigoBarras: '7898615311337',
                produto: 'Lift Plus',
                categoria: 'Preenchedor',
                marca: 'Rennova',
                tipoUnidade: 'frasco',
                estoqueMinimo: 0,
                estoqueAtual: 0
              }
            ],
            resumo: { total: 1 }
          })
        })
        return
      }

      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true, data: [] }) })
    })

    await page.route('**/api/auth/me**', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ user: { username: 'e2e', role: 'GESTOR', allowedUnits: ['novo-hamburgo'] } })
      })
    })

    await page.goto('/?insumos=1')
    const insumosNav = page.getByRole('button', { name: 'Insumos' })
    await expect(insumosNav).toBeVisible({ timeout: 30000 })
    await insumosNav.click()

    await page.getByRole('button', { name: 'Abrir lista de insumos' }).click()
    await expect(page.getByTestId('insumos-product-row-r-001')).toBeVisible()

    const operations = ['Entrada', 'Saída', 'Ajuste', 'Transferência']
    for (const operation of operations) {
      await page.getByRole('button', { name: `${operation} de Lift Plus` }).click()
      const context = page.getByTestId('insumos-operation-context')
      await expect(context).toBeVisible()
      await expect(context).toContainText('Lift Plus')
      await expect(context).toContainText('7898615311337')
      await expect(context).toContainText('r-001')
      await expect(context).toContainText('Saldo atual')
      await expect(page.getByText('Contexto do produto · campos travados')).toBeVisible()
      await page.getByRole('button', { name: 'Cancelar' }).last().click()
    }

    await page.getByRole('button', { name: 'Histórico de Lift Plus' }).click()
    await expect(page.getByText('Histórico contextual')).toBeVisible()
    await expect(page.getByText(/registro/i).last()).toBeVisible()
  })
})
