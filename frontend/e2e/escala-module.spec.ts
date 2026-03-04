import { test, expect } from '@playwright/test'

test.describe('escala', () => {
  test('renders overview and schedule from API', async ({ page }) => {
    await page.route('**/api/auth/me**', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ user: { username: 'e2e', role: 'GESTOR', allowedUnits: [] } })
      })
    })

    await page.route('**/api/insumos/auth/me**', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ success: true, user: { username: 'e2e', role: 'GESTOR', allowedUnits: [] }, csrfToken: 'e2e' })
      })
    })

    await page.route('**/api/escala/overview', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ ok: true, units: ['Novo Hamburgo'], months: ['2026-03'] })
      })
    })

    await page.route('**/api/escala/professionals**', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          ok: true,
          data: [
            { name: 'Dra. Ana', status: 'Ativo', units: ['Novo Hamburgo'], role: 'Injetor', shift: '', nickname: '', phone: '', email: '', instagram: '' },
            { name: 'Bruna', status: 'Ativo', units: ['Novo Hamburgo'], role: 'Consultor', shift: '', nickname: '', phone: '', email: '', instagram: '' },
            { name: 'Carla', status: 'Inativo', units: ['Novo Hamburgo'], role: 'Injetor', shift: '', nickname: '', phone: '', email: '', instagram: '' }
          ]
        })
      })
    })

    await page.route('**/api/escala/schedule**', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          ok: true,
          schedule: [{ date: '2026-03-05', unit: 'Novo Hamburgo', professional: 'Dra. Ana' }],
          closedDays: [{ date: '2026-03-10', unit: 'Novo Hamburgo', reason: 'Feriado local' }],
          holidays: [{ date: '2026-03-20', unit: 'Novo Hamburgo', name: 'Dia do Cliente' }]
        })
      })
    })

    await page.goto('/?module=escala-profissionais')

    await expect(page.getByText('Escala de Profissionais')).toBeVisible({ timeout: 30000 })
    await expect(page.getByTestId('escala-day-2026-03-05')).toBeVisible()
    await expect(page.getByRole('button', { name: /Dra\. Ana/i }).first()).toBeVisible()
    await expect(page.getByText('Dia do Cliente').first()).toBeVisible()
    await expect(page.getByText('Feriado local').first()).toBeVisible()

    await page.getByRole('combobox', { name: '' }).nth(2).click()
    await expect(page.getByRole('option', { name: 'Dra. Ana' })).toBeVisible()
    await expect(page.getByRole('option', { name: 'Bruna' })).toHaveCount(0)
    await expect(page.getByRole('option', { name: 'Carla' })).toHaveCount(0)
  })

  test('edits schedule entries via editor', async ({ page }) => {
    const replacePayloads: any[] = []
    const addPayloads: any[] = []
    const removePayloads: any[] = []
    const closedAddPayloads: any[] = []
    const closedRemovePayloads: any[] = []

    await page.route('**/api/auth/me**', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ user: { username: 'e2e', role: 'GESTOR', allowedUnits: [] } })
      })
    })

    await page.route('**/api/insumos/auth/me**', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ success: true, user: { username: 'e2e', role: 'GESTOR', allowedUnits: [] }, csrfToken: 'e2e' })
      })
    })

    await page.route('**/api/escala/overview', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ ok: true, units: ['Novo Hamburgo'], months: ['2026-03'] })
      })
    })

    await page.route('**/api/escala/professionals**', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          ok: true,
          data: [
            { name: 'Dra. Ana', status: 'Ativo', units: ['Novo Hamburgo'], role: 'Injetor', shift: '', nickname: '', phone: '', email: '', instagram: '' },
            { name: 'Dr. Lucas', status: 'Ativo', units: ['Novo Hamburgo'], role: 'Injetor', shift: '', nickname: '', phone: '', email: '', instagram: '' }
          ]
        })
      })
    })

    await page.route('**/api/escala/schedule**', async (route) => {
      const req = route.request()
      if (req.method() === 'GET') {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            ok: true,
            schedule: [],
            closedDays: [],
            holidays: []
          })
        })
        return
      }
      if (req.method() === 'PUT') {
        replacePayloads.push(await req.postDataJSON())
      }
      if (req.method() === 'POST') {
        addPayloads.push(await req.postDataJSON())
      }
      if (req.method() === 'DELETE') {
        removePayloads.push(await req.postDataJSON())
      }
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true }) })
    })

    await page.route('**/api/escala/closed-days**', async (route) => {
      const req = route.request()
      if (req.method() === 'POST') closedAddPayloads.push(await req.postDataJSON())
      if (req.method() === 'DELETE') closedRemovePayloads.push(await req.postDataJSON())
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true }) })
    })

    await page.goto('/?module=escala-profissionais')

    await page.getByTestId('escala-day-2026-03-15').click()
    await page.getByTestId('escala-day-2026-03-16').click()

    await page.locator('#escala-editor input[placeholder="ex: Dra. Ana, Dr. Lucas"]').fill('Dra. Ana, Dr. Lucas')
    await page.getByRole('button', { name: 'Substituir agenda dos dias selecionados' }).click()

    await expect.poll(() => replacePayloads).toEqual([
      { date: '2026-03-15', unit: 'Novo Hamburgo', professionals: ['Dra. Ana', 'Dr. Lucas'] },
      { date: '2026-03-16', unit: 'Novo Hamburgo', professionals: ['Dra. Ana', 'Dr. Lucas'] }
    ])

    await page.getByTestId('escala-editor-professional').click()
    await page.getByRole('option', { name: 'Dra. Ana' }).click()
    await page.getByRole('button', { name: 'Adicionar nos dias selecionados' }).click()

    await expect.poll(() => addPayloads).toEqual([
      { date: '2026-03-15', unit: 'Novo Hamburgo', professional: 'Dra. Ana' },
      { date: '2026-03-16', unit: 'Novo Hamburgo', professional: 'Dra. Ana' }
    ])

    await page.getByRole('button', { name: 'Remover dos dias selecionados' }).click()
    await expect.poll(() => removePayloads).toEqual([
      { date: '2026-03-15', unit: 'Novo Hamburgo', professional: 'Dra. Ana' },
      { date: '2026-03-16', unit: 'Novo Hamburgo', professional: 'Dra. Ana' }
    ])

    await page.getByPlaceholder('Motivo do bloqueio (ex: Feriado Nacional)').fill('Manutenção')
    await page.getByRole('button', { name: 'Bloquear dias selecionados' }).click()
    await expect.poll(() => closedAddPayloads).toEqual([
      { date: '2026-03-15', unit: 'Novo Hamburgo', reason: 'Manutenção' },
      { date: '2026-03-16', unit: 'Novo Hamburgo', reason: 'Manutenção' }
    ])

    await page.getByRole('button', { name: 'Remover bloqueio' }).click()
    await expect.poll(() => closedRemovePayloads).toEqual([
      { date: '2026-03-15', unit: 'Novo Hamburgo' },
      { date: '2026-03-16', unit: 'Novo Hamburgo' }
    ])
  })

  test('quick edit swaps professional directly from calendar badge', async ({ page }) => {
    const replacePayloads: any[] = []

    await page.route('**/api/auth/me**', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ user: { username: 'e2e', role: 'GESTOR', allowedUnits: [] } })
      })
    })

    await page.route('**/api/insumos/auth/me**', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ success: true, user: { username: 'e2e', role: 'GESTOR', allowedUnits: [] }, csrfToken: 'e2e' })
      })
    })

    await page.route('**/api/escala/overview', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ ok: true, units: ['Novo Hamburgo'], months: ['2026-03'] })
      })
    })

    await page.route('**/api/escala/professionals**', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          ok: true,
          data: [
            { name: 'Dra. Ana', status: 'Ativo', units: ['Novo Hamburgo'], role: 'Injetor', shift: '', nickname: '', phone: '', email: '', instagram: '' },
            { name: 'Dr. Lucas', status: 'Ativo', units: ['Novo Hamburgo'], role: 'Injetor', shift: '', nickname: '', phone: '', email: '', instagram: '' }
          ]
        })
      })
    })

    await page.route('**/api/escala/schedule**', async (route) => {
      const req = route.request()
      if (req.method() === 'GET') {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            ok: true,
            schedule: [{ date: '2026-03-05', unit: 'Novo Hamburgo', professional: 'Dra. Ana' }],
            closedDays: [],
            holidays: []
          })
        })
        return
      }
      if (req.method() === 'PUT') {
        replacePayloads.push(await req.postDataJSON())
      }
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true }) })
    })

    await page.goto('/?module=escala-profissionais')

    await page.getByTestId('escala-day-2026-03-05').getByRole('button', { name: 'Dra. Ana' }).click()
    await page.getByRole('combobox', { name: '' }).last().click()
    await page.getByRole('option', { name: 'Dr. Lucas' }).click()
    await page.getByRole('button', { name: 'Trocar' }).click()

    await expect.poll(() => replacePayloads).toEqual([
      { date: '2026-03-05', unit: 'Novo Hamburgo', professionals: ['Dr. Lucas'] }
    ])
  })
})
