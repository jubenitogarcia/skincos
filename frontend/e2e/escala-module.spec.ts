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
	            { name: 'Dra. Ana', status: 'Ativo', units: ['novo-hamburgo'], role: 'Injetor', shift: '', nickname: '', phone: '', email: '', instagram: '' },
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

    await expect(page.getByRole('heading', { name: 'Escala' })).toBeVisible({ timeout: 30000 })
    await expect(page.getByTestId('escala-day-2026-03-05')).toBeVisible()
    await expect(page.getByText('Dra. Ana').first()).toBeVisible()
    await expect(page.getByText('Dia do Cliente').first()).toBeVisible()
	    await expect(page.getByTestId('escala-day-2026-03-10')).toContainText('Feriado local')

	    await page.getByRole('combobox', { name: '' }).nth(3).click()
	    await expect(page.getByRole('option', { name: 'Dra. Ana' })).toBeVisible()
	    await expect(page.getByRole('option', { name: 'Bruna' })).toHaveCount(0)
	    await expect(page.getByRole('option', { name: 'Carla' })).toHaveCount(0)
	  })

  test('edits schedule entries directly from the day card modal', async ({ page }) => {
    const replacePayloads: any[] = []
    const closedAddPayloads: any[] = []
    const closedRemovePayloads: any[] = []
    let scheduleState = {
      schedule: [{ date: '2026-03-15', unit: 'Novo Hamburgo', professional: 'Dra. Ana' }],
      closedDays: [] as any[],
      holidays: [] as any[]
    }

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
            schedule: scheduleState.schedule,
            closedDays: scheduleState.closedDays,
            holidays: scheduleState.holidays
          })
        })
        return
      }
      if (req.method() === 'PUT') {
        replacePayloads.push(await req.postDataJSON())
      }
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true }) })
    })

    await page.route('**/api/escala/closed-days**', async (route) => {
      const req = route.request()
      if (req.method() === 'POST') {
        const payload = await req.postDataJSON()
        closedAddPayloads.push(payload)
        scheduleState = { ...scheduleState, closedDays: [payload] }
      }
      if (req.method() === 'DELETE') {
        const payload = await req.postDataJSON()
        closedRemovePayloads.push(payload)
        scheduleState = { ...scheduleState, closedDays: [] }
      }
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true }) })
    })

    await page.goto('/?module=escala-profissionais')

    await page.getByTestId('escala-day-2026-03-15').click()
    await page.getByText('Dr. Lucas').click()
    await page.keyboard.press('Escape')

    await expect.poll(() => replacePayloads).toEqual([
      { date: '2026-03-15', unit: 'Novo Hamburgo', professionals: ['Dra. Ana', 'Dr. Lucas'] }
    ])

    await page.getByTestId('escala-day-2026-03-15').click()
    await page.getByTestId('escala-block-2026-03-15').click()
    await page.getByTestId('escala-block-reason-2026-03-15').fill('Manutenção')
    await page.getByTestId('escala-toggle-block-2026-03-15').click()
    await expect.poll(() => closedAddPayloads).toEqual([
      { date: '2026-03-15', unit: 'Novo Hamburgo', reason: 'Manutenção' }
    ])
    await expect(page.getByTestId('escala-day-2026-03-15')).toContainText('Manutenção')
    await expect(page.getByTestId('escala-day-2026-03-15')).not.toContainText('Dra. Ana')

    await page.getByTestId('escala-day-2026-03-15').click()
    await page.getByTestId('escala-block-2026-03-15').click()
    await expect(page.getByTestId('escala-toggle-block-2026-03-15')).toBeVisible()
    await page.getByTestId('escala-toggle-block-2026-03-15').click()
    await expect.poll(() => closedRemovePayloads).toEqual([
      { date: '2026-03-15', unit: 'Novo Hamburgo' }
    ])
  })

  test('clicking a professional badge syncs the header filter and highlights matching days', async ({ page }) => {
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
            schedule: [
              { date: '2026-03-05', unit: 'Novo Hamburgo', professional: 'Dra. Ana' },
              { date: '2026-03-12', unit: 'Novo Hamburgo', professional: 'Dra. Ana' },
              { date: '2026-03-18', unit: 'Novo Hamburgo', professional: 'Dr. Lucas' }
            ],
            closedDays: [{ date: '2026-03-20', unit: 'Novo Hamburgo', reason: 'Fechado' }],
            holidays: []
          })
        })
        return
      }
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true }) })
    })

    await page.goto('/?module=escala-profissionais')

    await page.getByTestId('escala-pill-2026-03-05-dra-ana').click()

    await expect(page.getByRole('combobox', { name: '' }).nth(3)).toContainText('Dra. Ana')
    await expect(page.getByTestId('escala-day-2026-03-05')).toHaveClass(/escala-day-card--tracked/)
    await expect(page.getByTestId('escala-day-2026-03-12')).toHaveClass(/escala-day-card--tracked/)
    await expect(page.getByTestId('escala-day-2026-03-18')).not.toHaveClass(/escala-day-card--tracked/)
    await page.getByTestId('escala-day-2026-03-18').click()
    await expect(page.getByRole('combobox', { name: '' }).nth(3)).toContainText('–')
    await expect(page.getByText('Injetores do dia')).toHaveCount(0)

    await page.getByRole('button', { name: 'Destacar dias laborais' }).click({ force: true })
    await expect(page.getByTestId('escala-day-2026-03-05')).toHaveClass(/escala-day-card--tracked/)
    await expect(page.getByTestId('escala-day-2026-03-20')).not.toHaveClass(/escala-day-card--tracked/)

    await page.getByRole('button', { name: 'Destacar dias sem atendimento' }).click({ force: true })
    await expect(page.getByTestId('escala-day-2026-03-01')).toHaveClass(/escala-day-card--tracked/)
    await expect(page.getByTestId('escala-day-2026-03-20')).toHaveClass(/escala-day-card--tracked/)
  })

  test('edits team member fields from the sidebar next to the calendar', async ({ page }) => {
    const professionalPayloads: any[] = []
    let professionalsState = [
      {
        name: 'Dra. Ana',
        status: 'Ativo',
        units: ['Novo Hamburgo'],
        role: 'Injetor',
        shift: 'Manhã',
        nickname: 'Ana',
        phone: '',
        email: 'ana@local.test',
        instagram: 'draana'
      }
    ]
    let scheduleState = {
      schedule: [{ date: '2026-03-05', unit: 'Novo Hamburgo', professional: 'Dra. Ana' }],
      closedDays: [] as any[],
      holidays: [] as any[]
    }

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
      const req = route.request()
      if (req.method() === 'GET') {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ ok: true, data: professionalsState })
        })
        return
      }
      if (req.method() === 'PUT') {
        const payload = await req.postDataJSON()
        professionalPayloads.push(payload)
        professionalsState = [{
          name: payload.name,
          status: payload.status,
          units: payload.units,
          role: payload.role,
          shift: payload.shift,
          nickname: payload.nickname,
          phone: payload.phone,
          email: payload.email,
          instagram: payload.instagram
        }]
        scheduleState = {
          ...scheduleState,
          schedule: scheduleState.schedule.map((entry) => (
            entry.professional === payload.currentName
              ? { ...entry, professional: payload.name }
              : entry
          ))
        }
      }
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true }) })
    })

    await page.route('**/api/escala/schedule**', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          ok: true,
          schedule: scheduleState.schedule,
          closedDays: scheduleState.closedDays,
          holidays: scheduleState.holidays
        })
      })
    })

    await page.goto('/?module=escala-profissionais')

    const calendarPanelBefore = await page.getByTestId('escala-calendar-panel').boundingBox()
    const teamPanelBefore = await page.getByTestId('escala-team-panel').boundingBox()
    const teamPanelOverflowBefore = await page.getByTestId('escala-team-panel').evaluate((element) => ({
      scrollHeight: element.scrollHeight,
      clientHeight: element.clientHeight,
    }))

    await expect(page.getByTestId('escala-team-field-name')).toHaveCount(0)
    await page.getByTestId('escala-team-member-dra-ana').click()
    await expect(page.getByRole('combobox', { name: '' }).nth(3)).toContainText('Dra. Ana')
    await expect(page.getByTestId('escala-day-2026-03-05')).toHaveClass(/escala-day-card--tracked/)
    await page.getByTestId('escala-team-member-dra-ana').click()
    await expect(page.getByRole('combobox', { name: '' }).nth(3)).toContainText('–')
    await expect(page.getByTestId('escala-day-2026-03-05')).not.toHaveClass(/escala-day-card--tracked/)
    await expect(page.getByTestId('escala-team-edit')).toBeDisabled()
    await page.getByTestId('escala-team-member-dra-ana').click()
    await expect(page.getByRole('combobox', { name: '' }).nth(3)).toContainText('Dra. Ana')
    await page.getByTestId('escala-team-edit').click()
    await expect(page.getByTestId('escala-team-field-name')).toHaveValue('Dra. Ana')
    await expect(page.getByTestId('escala-team-edit')).toHaveCount(0)
    await expect(page.getByTestId('escala-team-save')).toBeVisible()
    await expect(page.getByTestId('escala-team-close')).toBeVisible()
    await expect(page.getByTestId('escala-team-field-shift')).toHaveCount(0)
    await expect(page.getByTestId('escala-team-field-nickname')).toHaveCount(0)
    await expect(page.getByTestId('escala-team-field-instagram')).toHaveCount(0)
    const calendarPanelAfterEdit = await page.getByTestId('escala-calendar-panel').boundingBox()
    const teamPanelAfterEdit = await page.getByTestId('escala-team-panel').boundingBox()
    const teamPanelOverflowAfterEdit = await page.getByTestId('escala-team-panel').evaluate((element) => ({
      scrollHeight: element.scrollHeight,
      clientHeight: element.clientHeight,
    }))
    expect(calendarPanelBefore?.width ?? 0).toBeCloseTo(calendarPanelAfterEdit?.width ?? 0, 0)
    expect(teamPanelBefore?.width ?? 0).toBeCloseTo(teamPanelAfterEdit?.width ?? 0, 0)
    expect(teamPanelOverflowBefore.scrollHeight).toBeLessThanOrEqual(teamPanelOverflowBefore.clientHeight + 1)
    expect(teamPanelOverflowAfterEdit.scrollHeight).toBeLessThanOrEqual(teamPanelOverflowAfterEdit.clientHeight + 1)
    await page.getByTestId('escala-team-close').click()
    await expect(page.getByTestId('escala-team-field-name')).toHaveCount(0)
    await expect(page.getByTestId('escala-team-close')).toHaveCount(0)
    await expect(page.getByTestId('escala-team-save')).toHaveCount(0)
    await page.getByTestId('escala-team-edit').click()
    await expect(page.getByTestId('escala-team-field-name')).toHaveValue('Dra. Ana')
    await page.getByTestId('escala-team-field-name').fill('Dra. Anita')
    await page.getByTestId('escala-team-field-phone').fill('5551999999999')
    await page.getByTestId('escala-team-save').click()

    await expect.poll(() => professionalPayloads).toEqual([
      {
        currentName: 'Dra. Ana',
        name: 'Dra. Anita',
        status: 'Ativo',
        units: ['Novo Hamburgo'],
        role: 'Injetor',
        shift: 'Manhã',
        nickname: 'Ana',
        phone: '5551999999999',
        email: 'ana@local.test',
        instagram: 'draana'
      }
    ])

    await expect(page.getByTestId('escala-team-field-name')).toHaveCount(0)
    await expect(page.getByTestId('escala-team-member-dra-anita')).toBeVisible()
    await expect(page.getByTestId('escala-day-2026-03-05')).toContainText('Dra. Anita')
  })

  test('adds a team member from the sidebar using dropdown fields', async ({ page }) => {
    const professionalPayloads: any[] = []
    let professionalsState = [
      {
        name: 'Dra. Ana',
        status: 'Ativo',
        units: ['Novo Hamburgo'],
        role: 'Injetor',
        shift: 'Manhã',
        nickname: 'Ana',
        phone: '',
        email: 'ana@local.test',
        instagram: 'draana'
      }
    ]

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
      const req = route.request()
      if (req.method() === 'GET') {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ ok: true, data: professionalsState })
        })
        return
      }
      if (req.method() === 'POST') {
        const payload = await req.postDataJSON()
        professionalPayloads.push(payload)
        professionalsState = [...professionalsState, payload]
      }
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true }) })
    })

    await page.route('**/api/escala/schedule**', async (route) => {
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
    })

    await page.goto('/?module=escala-profissionais')

    await page.getByTestId('escala-team-add').click()
    await page.getByTestId('escala-team-field-name').fill('Paula Nova')
    await page.getByTestId('escala-team-field-status').click()
    await page.getByRole('option', { name: 'Inativo' }).click()
    await expect(page.getByTestId('escala-team-field-shift')).toHaveCount(0)
    await expect(page.getByTestId('escala-team-field-nickname')).toHaveCount(0)
    await expect(page.getByTestId('escala-team-field-instagram')).toHaveCount(0)
    await page.getByTestId('escala-team-field-role').click()
    await page.getByTestId('escala-team-field-role-consultor').click()
    await page.getByTestId('escala-team-save').click()

    await expect.poll(() => professionalPayloads).toEqual([
      {
        name: 'Paula Nova',
        status: 'Inativo',
        units: ['Novo Hamburgo'],
        role: 'Consultor',
        shift: '',
        nickname: '',
        phone: '',
        email: '',
        instagram: ''
      }
    ])

    await expect(page.getByTestId('escala-team-member-paula-nova')).toBeVisible()
    await expect(page.getByTestId('escala-team-field-name')).toHaveCount(0)
  })
})
