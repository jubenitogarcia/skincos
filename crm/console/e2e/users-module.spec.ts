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

  test('does not overflow at 390, 768 or 1280 pixels', async ({ page }) => {
    await mockUsersApi(page)
    for (const width of [390, 768, 1280]) {
      await page.setViewportSize({ width, height: width === 390 ? 844 : 720 })
      await page.goto('/?module=users')
      await expect(page.getByRole('heading', { name: 'Usuários' })).toBeVisible()
      const dimensions = await page.evaluate(() => ({ viewport: window.innerWidth, document: document.documentElement.scrollWidth, body: document.body.scrollWidth }))
      expect(dimensions.document, `document overflow at ${width}px`).toBeLessThanOrEqual(dimensions.viewport)
      expect(dimensions.body, `body overflow at ${width}px`).toBeLessThanOrEqual(dimensions.viewport)
    }
  })
})
