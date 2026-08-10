import { expect, test } from '@playwright/test'
import { mockUsersApi } from './users-module-fixtures'

test.describe('Usuários e Equipe', () => {
  test('renders the unified table, filters by unit and exposes safe bulk actions', async ({ page }) => {
    await mockUsersApi(page)
    await page.goto('/?module=users')
    await expect(page.getByRole('heading', { name: 'Usuários' })).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Equipe' })).toBeVisible()
    await expect(page.getByRole('table').getByText('Ana Ribeiro', { exact: true })).toBeVisible()
    await expect(page.getByRole('table').getByText('Convite enviado', { exact: true })).toBeVisible()

    await page.getByLabel('Buscar equipe').fill('barra-shopping-sul')
    await expect(page.getByRole('table').getByText('Lucas Mendes', { exact: true })).toBeVisible()
    await page.getByRole('button', { name: 'Limpar' }).click()

    await page.getByRole('table').getByLabel('Selecionar Ana Ribeiro').check()
    await expect(page.getByRole('button', { name: 'Suspender' })).toBeVisible()
    page.once('dialog', (dialog) => dialog.accept())
    await page.getByRole('button', { name: 'Suspender' }).click()
    await expect(page.getByRole('table').getByText('Ana Ribeiro', { exact: true })).toHaveCount(0)
  })

  test('navigates a server-paginated roster without losing the total count', async ({ page }) => {
    await mockUsersApi(page, 'GESTOR', { paginated: true })
    await page.goto('/?module=users')
    await expect(page.getByRole('navigation', { name: 'Paginação da equipe' })).toBeVisible()
    await expect(page.getByText('Página 1 de 2', { exact: true })).toBeVisible()
    await expect(page.getByText('Exibindo 1–50 de 54', { exact: true })).toBeVisible()
    await page.getByRole('button', { name: 'Próxima página' }).click()
    await expect(page.getByText('Página 2 de 2', { exact: true })).toBeVisible()
    await expect(page.getByText('Exibindo 51–54 de 54', { exact: true })).toBeVisible()
  })

  test('keeps identity, operation, invite and read-only editing in one auditable flow', async ({ page }) => {
    await mockUsersApi(page)
    await page.goto('/?module=users')
    await page.getByRole('button', { name: 'Editar Ana Ribeiro' }).click()
    await expect(page.getByRole('dialog')).toBeVisible()
    await expect(page.getByRole('tab', { name: 'Identidade e acesso' })).toBeVisible()
    await expect(page.getByRole('tab', { name: 'Operação' })).toBeVisible()
    await page.getByRole('tab', { name: 'Operação' }).click()
    await expect(page.getByText('Vínculo operacional da Escala', { exact: true })).toBeVisible()
    await page.getByRole('tab', { name: 'Histórico' }).click()
    await expect(page.getByRole('heading', { name: 'Histórico do cadastro' })).toBeVisible()
    await expect(page.getByText('Cadastro atualizado', { exact: true })).toBeVisible()
    await page.getByRole('button', { name: 'Fechar' }).click()

    await page.getByRole('button', { name: 'Editar Lucas Mendes' }).click()
    page.once('dialog', (dialog) => dialog.accept())
    await page.getByRole('button', { name: 'Reenviar convite' }).click()
    await expect(page.getByRole('dialog')).toBeHidden()

    await page.getByRole('button', { name: 'Editar Ana Ribeiro' }).click()
    page.once('dialog', (dialog) => dialog.accept())
    await page.getByRole('button', { name: 'Suspender membro' }).click()
    await expect(page.getByRole('dialog')).toBeHidden()
    await expect(page.getByRole('table').getByText('Ana Ribeiro', { exact: true })).toHaveCount(0)
  })

  test('exposes native required semantics for the unified employee form', async ({ page }) => {
    await mockUsersApi(page)
    await page.goto('/?module=users')
    await page.getByRole('button', { name: 'Cadastrar funcionário' }).click()
    await expect(page.getByLabel('Nome completo')).toHaveAttribute('required', '')
    await expect(page.getByLabel('Nome de usuário')).toHaveAttribute('required', '')
    await expect(page.getByLabel(/E-mail pessoal/)).toHaveAttribute('required', '')
    await expect(page.getByLabel(/Celular/)).toHaveAttribute('required', '')
    await expect(page.getByLabel('Departamento')).toHaveAttribute('required', '')
    await expect(page.getByRole('combobox', { name: 'Cargo' })).toHaveAttribute('aria-required', 'true')
    await expect(page.getByRole('group', { name: 'Unidades de acesso' })).toHaveAttribute('aria-required', 'true')
  })

  test('shows a read-only inspection view to Supervisor', async ({ page }) => {
    await mockUsersApi(page, 'SUPERVISOR')
    await page.goto('/?module=users')
    await page.getByRole('button', { name: 'Editar Ana Ribeiro' }).click()
    await expect(page.getByText('Somente leitura', { exact: true })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Salvar alterações' })).toHaveCount(0)
    await expect(page.getByLabel('Nome completo')).toBeDisabled()
    await page.getByRole('button', { name: 'Fechar' }).click()
  })

  test('registers explicit operational links without name-based matching', async ({ page }) => {
    await mockUsersApi(page)
    await page.goto('/?module=users')
    await page.getByRole('button', { name: 'Editar Ana Ribeiro' }).click()
    await page.getByRole('tab', { name: 'Operação' }).click()
    await page.getByLabel('Identificador').fill('e2e-escala-ana-manual')
    await page.getByRole('button', { name: 'Registrar vínculo' }).click()
    await expect(page.getByText('e2e-escala-ana-manual', { exact: true })).toBeVisible()
    await expect(page.getByText('Revisão pendente', { exact: true })).toBeVisible()
  })

  test('retries a failed Escala synchronization from the unified member modal', async ({ page }) => {
    await mockUsersApi(page)
    await page.goto('/?module=users')
    await page.getByRole('combobox', { name: 'Filtrar status' }).click()
    await page.getByRole('option', { name: 'Todos os estados' }).click()
    await page.getByRole('button', { name: 'Editar Carla Souza' }).click()
    await page.getByRole('tab', { name: 'Operação' }).click()
    await expect(page.getByRole('tabpanel').getByText('Falhou', { exact: true })).toBeVisible()
    await page.getByRole('button', { name: 'Tentar novamente' }).click()
    await expect(page.getByRole('tabpanel').getByText('Sincronizada', { exact: true })).toBeVisible()
  })

  test('retries a failed identity activation only after the invite registration boundary', async ({ page }) => {
    await mockUsersApi(page, 'GESTOR', { failedActivationFor: 'e2e-lucas' })
    await page.goto('/?module=users')
    await page.getByRole('button', { name: 'Editar Lucas Mendes' }).click()
    await expect(page.getByRole('button', { name: 'Concluir ativação' })).toBeVisible()
    page.once('dialog', (dialog) => dialog.accept())
    await page.getByRole('button', { name: 'Concluir ativação' }).click()
    const memberDialog = page.getByRole('dialog')
    await expect(memberDialog).toBeVisible()
    await expect(memberDialog.getByRole('button', { name: 'Concluir ativação' })).toHaveCount(0)
    await expect(memberDialog.getByText('Ativo', { exact: true })).toBeVisible()
    await memberDialog.getByRole('button', { name: 'Fechar' }).click()
    const lucasRow = page.getByRole('row').filter({ hasText: 'Lucas Mendes' })
    await expect(lucasRow.getByText('Ativo', { exact: true })).toBeVisible()
  })

  test('resolves a pending operational link with an explicit review action', async ({ page }) => {
    await mockUsersApi(page)
    await page.goto('/?module=users')
    await page.getByRole('combobox', { name: 'Filtrar status' }).click()
    await page.getByRole('option', { name: 'Todos os estados' }).click()
    await page.getByRole('button', { name: 'Editar Carla Souza' }).click()
    await page.getByRole('tab', { name: 'Operação' }).click()
    page.once('dialog', (dialog) => dialog.accept())
    await page.getByRole('button', { name: 'Confirmar vínculo e2e-escala-carla' }).click()
    await expect(page.getByText('Confirmado', { exact: true })).toBeVisible()
  })

  test('resolves a legacy CRM account only through exact username review', async ({ page }) => {
    await mockUsersApi(page)
    await page.goto('/?module=users')
    await page.getByRole('combobox', { name: 'Filtrar status' }).click()
    await page.getByRole('option', { name: 'Todos os estados' }).click()
    await page.getByRole('button', { name: 'Editar Carla Souza' }).click()
    await page.getByRole('tab', { name: 'Operação' }).click()
    await expect(page.getByText('legacycarla', { exact: true })).toBeVisible()
    page.once('dialog', (dialog) => dialog.accept())
    await page.getByRole('button', { name: 'Confirmar conta CRM legacycarla' }).click()
    await expect(page.getByText('Confirmada', { exact: true })).toBeVisible()
  })

  test('does not overflow at 390, 768 or 1280 pixels', async ({ page }) => {
    await mockUsersApi(page)
    for (const width of [390, 768, 1280]) {
      await page.setViewportSize({ width, height: width === 390 ? 844 : 720 })
      await page.goto('/?module=users')
      await expect(page.getByRole('heading', { name: 'Usuários' })).toBeVisible()
      const dimensions = await page.evaluate(() => ({ viewport: window.innerWidth, document: document.documentElement.scrollWidth, body: document.body.scrollWidth }))
      expect(dimensions.document, `document overflow at ${width}px`).toBeLessThanOrEqual(dimensions.viewport)
      expect(dimensions.body, `body overflow at ${width}px`).toBeLessThanOrEqual(dimensions.viewport)
      if (width >= 768) {
        const overflowingCells = await page.locator('table tbody tr').first().locator('td').evaluateAll((cells) => cells
          .filter((cell) => cell.scrollWidth > cell.clientWidth + 1)
          .map((cell) => ({ width: cell.clientWidth, scrollWidth: cell.scrollWidth })))
        expect(overflowingCells, `table cell content overflow at ${width}px`).toEqual([])
      }
    }
  })
})
