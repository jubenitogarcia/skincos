import { test, expect } from '@playwright/test'

test.describe('insumos', () => {
  test('edit modal shows categoria/marca options and surfaces policy validation errors', async ({ page }) => {
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
            user: { username: 'e2e', role: 'ADMIN', allowedUnits: [] },
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

      if (route.request().method() === 'PUT' && path.includes('/api/insumos/insumos/')) {
        await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true }) })
        return
      }

      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true, data: [] }) })
    })

    await page.route('**/api/auth/me**', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ user: { username: 'e2e', role: 'ADMIN', allowedUnits: [] } })
      })
    })

    await page.goto('/?insumos=1')
    await expect(page.getByText('Insumos')).toBeVisible({ timeout: 30000 })
    await page.getByText('Insumos').click()

    await page.getByRole('button', { name: 'Abrir lista de insumos' }).click()
    await page.getByRole('button', { name: 'Editar' }).first().click()
    await expect(page.getByText('Editar insumo')).toBeVisible()

    const categoriaInput = page.getByTestId('insumos-edit-categoria')
    const marcaInput = page.getByTestId('insumos-edit-marca')
    await expect(categoriaInput).toBeVisible()
    await expect(marcaInput).toBeVisible()

    await categoriaInput.focus()
    await expect(page.getByRole('button', { name: 'Preenchedor' })).toBeVisible()
    await page.getByRole('button', { name: 'Preenchedor' }).click()
    await expect(categoriaInput).toHaveValue('Preenchedor')

    await marcaInput.focus()
    await expect(page.getByRole('button', { name: 'Rennova' })).toBeVisible()
    await page.getByRole('button', { name: 'Rennova' }).click()
    await expect(marcaInput).toHaveValue('Rennova')

    // Trip policy validation: require expiry but leave date empty.
    await page.getByText('Validade obrigatória').click()
    await page.getByRole('button', { name: 'Salvar' }).click()

    await expect(page.getByText(/exige Data de validade/i)).toBeVisible()
    await expect(page.locator('input[aria-label="Validade"]')).toHaveClass(/border-red-500/)
  })
})
