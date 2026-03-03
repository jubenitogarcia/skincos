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
            { name: 'Dra. Ana', status: 'Ativo', units: ['Novo Hamburgo'], role: 'Injetor', shift: '', nickname: '', phone: '', email: '', instagram: '' }
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
    await expect(page.getByText('Dra. Ana')).toBeVisible()
    await expect(page.getByText('Dia do Cliente')).toBeVisible()
    await expect(page.getByText('Feriado local')).toBeVisible()
  })

  test('edits schedule entries via editor', async ({ page }) => {
    let replacePayload: any = null
    let addPayload: any = null
    let removePayload: any = null
    let closedAddPayload: any = null
    let closedRemovePayload: any = null
    let holidayAddPayload: any = null
    let holidayRemovePayload: any = null

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
        replacePayload = await req.postDataJSON()
      }
      if (req.method() === 'POST') {
        addPayload = await req.postDataJSON()
      }
      if (req.method() === 'DELETE') {
        removePayload = await req.postDataJSON()
      }
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true }) })
    })

    await page.route('**/api/escala/closed-days**', async (route) => {
      const req = route.request()
      if (req.method() === 'POST') closedAddPayload = await req.postDataJSON()
      if (req.method() === 'DELETE') closedRemovePayload = await req.postDataJSON()
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true }) })
    })

    await page.route('**/api/escala/holidays**', async (route) => {
      const req = route.request()
      if (req.method() === 'POST') holidayAddPayload = await req.postDataJSON()
      if (req.method() === 'DELETE') holidayRemovePayload = await req.postDataJSON()
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true }) })
    })

    await page.goto('/?module=escala-profissionais')

    await page.locator('#escala-editor input[type="date"]').fill('2026-03-15')
    await page.locator('#escala-editor input[placeholder="ex: Dra. Ana, Dr. Lucas"]').fill('Dra. Ana, Dr. Lucas')
    await page.getByRole('button', { name: 'Substituir agenda do dia' }).click()

    await expect.poll(() => replacePayload).toEqual({
      date: '2026-03-15',
      unit: 'Novo Hamburgo',
      professionals: ['Dra. Ana', 'Dr. Lucas']
    })

    await page.getByTestId('escala-editor-professional').click()
    await page.getByRole('option', { name: 'Dra. Ana' }).click()
    await page.getByRole('button', { name: 'Adicionar ao dia' }).click()

    await expect.poll(() => addPayload).toEqual({
      date: '2026-03-15',
      unit: 'Novo Hamburgo',
      professional: 'Dra. Ana'
    })

    await page.getByRole('button', { name: 'Remover do dia' }).click()
    await expect.poll(() => removePayload).toEqual({
      date: '2026-03-15',
      unit: 'Novo Hamburgo',
      professional: 'Dra. Ana'
    })

    await page.locator('#escala-editor input[placeholder="Motivo do bloqueio"]').fill('Manutenção')
    await page.getByRole('button', { name: 'Bloquear dia' }).click()
    await expect.poll(() => closedAddPayload).toEqual({
      date: '2026-03-15',
      unit: 'Novo Hamburgo',
      reason: 'Manutenção'
    })

    await page.getByRole('button', { name: 'Remover bloqueio' }).click()
    await expect.poll(() => closedRemovePayload).toEqual({
      date: '2026-03-15',
      unit: 'Novo Hamburgo'
    })

    await page.locator('#escala-editor input[placeholder="Nome do feriado"]').fill('Dia do Cliente')
    await page.getByRole('button', { name: 'Adicionar feriado' }).click()
    await expect.poll(() => holidayAddPayload).toEqual({
      date: '2026-03-15',
      unit: 'Novo Hamburgo',
      name: 'Dia do Cliente'
    })

    await page.getByRole('button', { name: 'Remover feriado' }).click()
    await expect.poll(() => holidayRemovePayload).toEqual({
      date: '2026-03-15',
      unit: 'Novo Hamburgo',
      name: 'Dia do Cliente'
    })
  })
})
