import { test, expect, type Page } from '@playwright/test'

async function mockEscalaAuth(page: Page) {
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
}

async function mockEscalaPrefill(
  page: Page,
  payload: { ok: true; suggestions: Array<{ date: string; professional: string; confidence: number; sampleSize: number }>; windowMonths: string[] } = {
    ok: true,
    suggestions: [],
    windowMonths: ['2026-03', '2026-02', '2026-01'],
  },
) {
  await page.route('**/api/escala/prefill**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      headers: { 'x-request-id': 'e2e-prefill' },
      body: JSON.stringify(payload),
    })
  })
}

async function openEscalaModule(page: Page) {
  await page.goto('/')
  await page.evaluate(() => {
    localStorage.setItem('app.activeModule', 'escala-profissionais')
  })
  await page.reload()
  const escalaButton = page.getByRole('button', { name: 'Escala' })
  await escalaButton.waitFor({ state: 'visible', timeout: 30000 })
  await escalaButton.evaluate((element: HTMLElement) => element.click())
}

async function dismissPlanningAssistantIfVisible(page: Page) {
  const modal = page.getByTestId('escala-planning-assistant-modal')
  await modal.waitFor({ state: 'visible', timeout: 2000 }).catch(() => null)
  if (!(await modal.isVisible().catch(() => false))) return
  await page.keyboard.press('Escape')
  await expect(modal).not.toBeVisible()
}

test.describe('escala', () => {
  test.describe.configure({ mode: 'serial' })

  test.skip(
    !!process.env.CI && process.env.RUN_ESCALA_E2E_IN_CI !== '1',
    'Escala E2E only runs in the dedicated CI workflow.',
  )

  test('renders overview and schedule from API', async ({ page }) => {
    await mockEscalaAuth(page)
    await mockEscalaPrefill(page)

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
            { name: 'Dra. Ana', status: '', units: ['novo-hamburgo'], role: '', shift: '', nickname: '', phone: '', email: '', instagram: '', color: '#22c55e' },
            { name: 'Bruna', status: 'Ativo', units: ['Novo Hamburgo'], role: 'Consultor', shift: '', nickname: '', phone: '', email: '', instagram: '', color: '' },
            { name: 'Carla', status: 'Inativo', units: ['Novo Hamburgo'], role: 'Injetor', shift: '', nickname: '', phone: '', email: '', instagram: '', color: '#ef4444' }
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
          schedule: [
            { date: '2026-03-05', unit: 'Novo Hamburgo', professional: 'Dra. Ana' },
            { date: '2026-03-06', unit: 'Novo Hamburgo', professional: 'Dr. Agenda' }
          ],
          closedDays: [{ date: '2026-03-10', unit: 'Novo Hamburgo', reason: 'Feriado local' }],
          holidays: [{ date: '2026-03-20', unit: 'Novo Hamburgo', name: 'Dia do Cliente' }]
        })
      })
    })

    await openEscalaModule(page)

    await expect(page.getByTestId('escala-calendar-panel')).toBeVisible({ timeout: 30000 })
    await expect(page.getByTestId('escala-planning-assistant-modal')).toHaveCount(0)
    await expect(page.getByTestId('escala-autoprefill-status')).toHaveCount(0)
    await expect(page.getByTestId('escala-day-2026-03-05')).toBeVisible()
    await expect(page.getByText('Dra. Ana').first()).toBeVisible()
    await expect(page.getByText('Dr. Agenda').first()).toBeVisible()
    await expect(page.getByText('Dia do Cliente').first()).toBeVisible()
    await expect(page.getByTestId('escala-no-attendance-icon-2026-03-10')).toBeVisible()
    await expect(page.getByTestId('escala-day-2026-03-10')).not.toContainText('Feriado local')
    await expect(page.getByTestId('escala-team-member-dra-ana')).toBeVisible()
    await expect(page.getByTestId('escala-team-member-dr-agenda')).toBeVisible()
    await expect(page.getByTestId('escala-team-member-bruna')).toHaveCount(0)
    await expect(page.getByTestId('escala-team-member-carla')).toHaveCount(0)
    await expect(page.getByTestId('escala-team-inactive-toggle')).toContainText('Inativos (1)')
    await page.getByTestId('escala-team-inactive-toggle').click()
    await expect(page.getByTestId('escala-team-member-carla')).toBeVisible()
    await expect(page.getByTestId('escala-no-attendance-icon-2026-03-01')).toBeVisible()

    await page.getByTestId('escala-pill-2026-03-05-dra-ana').click()
    await expect(page.getByTestId('escala-pill-2026-03-05-dra-ana')).toHaveAttribute('aria-pressed', 'true')
    await expect(page.getByTestId('escala-day-2026-03-05')).toHaveClass(/escala-day-card--tracked/)
    await expect(page.getByTestId('escala-day-2026-03-06')).not.toHaveClass(/escala-day-card--tracked/)
  })

  test('keeps team members visible when the selected month has no schedule entries', async ({ page }) => {
    await mockEscalaAuth(page)
    await mockEscalaPrefill(page)

    await page.route('**/api/escala/overview', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ ok: true, units: ['Novo Hamburgo'], months: ['2026-04'] })
      })
    })

    await page.route('**/api/escala/professionals**', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          ok: true,
          data: [
            { name: 'Dra. Ana', status: '', units: ['Novo Hamburgo'], role: '', shift: '', nickname: '', phone: '', email: '', instagram: '', color: '#22c55e' },
            { name: 'Dr. Bruno', status: 'Ativo', units: ['Novo Hamburgo'], role: 'Injetor', shift: '', nickname: '', phone: '', email: '', instagram: '', color: '#0ea5e9' },
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
          schedule: [],
          closedDays: [],
          holidays: []
        })
      })
    })

    await openEscalaModule(page)

    await expect(page.getByTestId('escala-calendar-panel')).toBeVisible({ timeout: 30000 })
    await expect(page.getByTestId('escala-planning-assistant-modal')).toBeVisible()
    await dismissPlanningAssistantIfVisible(page)
    await expect(page.getByTestId('escala-team-member-dra-ana')).toBeVisible()
    await expect(page.getByTestId('escala-team-member-dr-bruno')).toBeVisible()
    await page.getByTestId('escala-team-member-dra-ana').click()
    await expect(page.getByTestId('escala-day-2026-04-01')).not.toHaveClass(/escala-day-card--tracked/)
    await page.getByTestId('escala-team-member-dra-ana').click()
    await expect(page.getByTestId('escala-team-member-dr-bruno')).toBeVisible()
  })

  test('shows team load failure as an error state instead of an empty team', async ({ page }) => {
    await mockEscalaAuth(page)
    await mockEscalaPrefill(page)

    await page.route('**/api/escala/overview', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ ok: true, units: ['Novo Hamburgo'], months: ['2026-04'] })
      })
    })

    await page.route('**/api/escala/professionals**', async (route) => {
      await route.fulfill({
        status: 500,
        contentType: 'application/json',
        body: JSON.stringify({ ok: false, error: 'professionals unavailable' })
      })
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

    await openEscalaModule(page)

    await expect(page.getByTestId('escala-calendar-panel')).toBeVisible({ timeout: 30000 })
    await dismissPlanningAssistantIfVisible(page)
    await expect(page.getByTestId('escala-team-error')).toContainText('Falha ao carregar a equipe')
    await expect(page.getByText('Nenhum injetor encontrado para a unidade selecionada.')).toHaveCount(0)
    await expect(page.getByTestId('escala-team-add')).toBeDisabled()
    await expect(page.getByTestId('escala-team-edit')).toBeDisabled()
  })

  test('shows planning suggestions explicitly and applies them in batch', async ({ page }) => {
    const replacePayloads: any[] = []

    await mockEscalaAuth(page)
    await mockEscalaPrefill(page, {
      ok: true,
      windowMonths: ['2026-03', '2026-02', '2026-01'],
      suggestions: [
        { date: '2026-04-14', professional: 'Dra. Ana', confidence: 0.6667, sampleSize: 3 },
        { date: '2026-04-15', professional: 'Dr. Bruno', confidence: 1, sampleSize: 2 },
      ],
    })

    await page.route('**/api/escala/overview', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ ok: true, units: ['Novo Hamburgo'], months: ['2026-04'] })
      })
    })

    await page.route('**/api/escala/professionals**', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          ok: true,
          data: [
            { name: 'Dra. Ana', status: 'Ativo', units: ['Novo Hamburgo'], role: 'Injetor', shift: '', nickname: '', phone: '', email: '', instagram: '', color: '#22c55e' },
            { name: 'Dr. Bruno', status: 'Ativo', units: ['Novo Hamburgo'], role: 'Injetor', shift: '', nickname: '', phone: '', email: '', instagram: '', color: '#0ea5e9' },
          ]
        })
      })
    })

    await page.route('**/api/escala/schedule**', async (route) => {
      if (route.request().method() === 'GET') {
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

      replacePayloads.push(route.request().postDataJSON())
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        headers: { 'x-request-id': 'e2e-schedule-put' },
        body: JSON.stringify({ ok: true, updatedDates: 2, updatedEntries: 2 })
      })
    })

    await openEscalaModule(page)

    await expect(page.getByTestId('escala-calendar-panel')).toBeVisible({ timeout: 30000 })
    await expect(page.getByTestId('escala-planning-assistant-modal')).toBeVisible()
    await expect(page.getByTestId('escala-autoprefill-status')).toContainText('Sugestões prontas para aplicar')
    await expect(page.getByTestId('escala-prefill-apply')).toBeVisible()
    await page.getByTestId('escala-prefill-apply').click()

    await expect.poll(() => replacePayloads.length).toBe(1)
    expect(replacePayloads[0]).toEqual({
      unit: 'Novo Hamburgo',
      entries: [
        { date: '2026-04-14', professionals: ['Dra. Ana'] },
        { date: '2026-04-15', professionals: ['Dr. Bruno'] },
      ],
    })

    await expect(page.getByTestId('escala-day-source-2026-04-14')).toBeVisible()
    await page.getByTestId('escala-day-source-2026-04-14').hover()
    await expect(page.getByRole('tooltip')).toContainText('Automático')
    await expect(page.getByTestId('escala-day-source-2026-04-15')).toBeVisible()
    await expect(page.getByTestId('escala-highlight-auto')).toContainText('2')
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

    await mockEscalaAuth(page)
    await mockEscalaPrefill(page)

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
            { name: 'Dra. Ana', status: 'Ativo', units: ['Novo Hamburgo'], role: 'Injetor', shift: '', nickname: '', phone: '', email: '', instagram: '', color: '#22c55e' },
            { name: 'Dr. Lucas', status: 'Ativo', units: ['Novo Hamburgo'], role: 'Injetor', shift: '', nickname: '', phone: '', email: '', instagram: '', color: '#0ea5e9' }
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

    await openEscalaModule(page)

    await page.getByTestId('escala-day-2026-03-15').click()
    await page.getByRole('dialog').getByText('Dr. Lucas').click()
    await page.getByTestId('escala-modal-confirm').click()

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
    await expect(page.getByTestId('escala-no-attendance-icon-2026-03-15')).toBeVisible()
    await expect(page.getByTestId('escala-day-2026-03-15')).not.toContainText('Dra. Ana')

    await page.getByTestId('escala-day-2026-03-15').click()
    await page.getByTestId('escala-block-2026-03-15').click()
    await expect(page.getByTestId('escala-toggle-block-2026-03-15')).toBeVisible()
    await page.getByTestId('escala-toggle-block-2026-03-15').click()
    await expect.poll(() => closedRemovePayloads).toEqual([
      { date: '2026-03-15', unit: 'Novo Hamburgo' }
    ])
  })

  test('permite editar dias com feriado legado sem tratá-los como bloqueio', async ({ page }) => {
    const replacePayloads: any[] = []

    await mockEscalaAuth(page)
    await mockEscalaPrefill(page)

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
            { name: 'Dra. Ana', status: 'Ativo', units: ['Novo Hamburgo'], role: 'Injetor', shift: '', nickname: '', phone: '', email: '', instagram: '', color: '#22c55e' },
            { name: 'Dr. Lucas', status: 'Ativo', units: ['Novo Hamburgo'], role: 'Injetor', shift: '', nickname: '', phone: '', email: '', instagram: '', color: '#0ea5e9' }
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
            schedule: [{ date: '2026-03-20', unit: 'Novo Hamburgo', professional: 'Dra. Ana' }],
            closedDays: [],
            holidays: [{ date: '2026-03-20', unit: 'Novo Hamburgo', name: 'Dia do Cliente' }]
          })
        })
        return
      }
      if (req.method() === 'PUT') {
        replacePayloads.push(await req.postDataJSON())
      }
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true }) })
    })

    await openEscalaModule(page)

    await page.getByTestId('escala-day-2026-03-20').click()
    await expect(page.getByRole('dialog')).toBeVisible()
    await page.getByRole('dialog').getByText('Dr. Lucas').click()
    await page.getByTestId('escala-modal-confirm').click()

    await expect.poll(() => replacePayloads).toEqual([
      { date: '2026-03-20', unit: 'Novo Hamburgo', professionals: ['Dra. Ana', 'Dr. Lucas'] }
    ])
  })

  test('clicking a professional badge syncs the header filter and highlights matching days', async ({ page }) => {
    await mockEscalaAuth(page)
    await mockEscalaPrefill(page)

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
            { name: 'Dra. Ana', status: 'Ativo', units: ['Novo Hamburgo'], role: 'Injetor', shift: '', nickname: '', phone: '', email: '', instagram: '', color: '#22c55e' },
            { name: 'Dr. Lucas', status: 'Ativo', units: ['Novo Hamburgo'], role: 'Injetor', shift: '', nickname: '', phone: '', email: '', instagram: '', color: '#0ea5e9' }
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

    await openEscalaModule(page)

    await page.getByTestId('escala-pill-2026-03-05-dra-ana').click()

    await expect(page.getByTestId('escala-pill-2026-03-05-dra-ana')).toHaveAttribute('aria-pressed', 'true')
    await expect(page.getByTestId('escala-day-2026-03-05')).toHaveClass(/escala-day-card--tracked/)
    await expect(page.getByTestId('escala-day-2026-03-12')).toHaveClass(/escala-day-card--tracked/)
    await expect(page.getByTestId('escala-day-2026-03-18')).not.toHaveClass(/escala-day-card--tracked/)
    await page.getByTestId('escala-day-2026-03-18').click()
    await expect(page.getByTestId('escala-pill-2026-03-05-dra-ana')).toHaveAttribute('aria-pressed', 'false')
    await expect(page.getByText('Injetores do dia')).toHaveCount(0)

    await page.getByRole('button', { name: 'Destacar dias manual' }).click({ force: true })
    await expect(page.getByTestId('escala-day-2026-03-05')).toHaveClass(/escala-day-card--tracked/)
    await expect(page.getByTestId('escala-day-2026-03-20')).not.toHaveClass(/escala-day-card--tracked/)

    await page.getByRole('button', { name: 'Destacar dias vazio' }).click({ force: true })
    await expect(page.getByTestId('escala-day-2026-03-01')).toHaveClass(/escala-day-card--tracked/)
    await expect(page.getByTestId('escala-day-2026-03-20')).not.toHaveClass(/escala-day-card--tracked/)

    await page.getByRole('button', { name: 'Destacar dias bloq' }).click({ force: true })
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
        instagram: 'draana',
        color: '#22c55e'
      }
    ]
    let scheduleState = {
      schedule: [{ date: '2026-03-05', unit: 'Novo Hamburgo', professional: 'Dra. Ana' }],
      closedDays: [] as any[],
      holidays: [] as any[]
    }

    await mockEscalaAuth(page)
    await mockEscalaPrefill(page)

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
          instagram: payload.instagram,
          color: payload.color
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

    await openEscalaModule(page)

    const calendarPanelBefore = await page.getByTestId('escala-calendar-panel').boundingBox()
    const teamPanelBefore = await page.getByTestId('escala-team-panel').boundingBox()
    const teamPanelOverflowBefore = await page.getByTestId('escala-team-panel').evaluate((element) => ({
      scrollHeight: element.scrollHeight,
      clientHeight: element.clientHeight,
    }))

    await expect(page.getByTestId('escala-team-field-name')).toHaveCount(0)
    await page.getByTestId('escala-team-member-dra-ana').click()
    await expect(page.getByTestId('escala-day-2026-03-05')).toHaveClass(/escala-day-card--tracked/)
    await expect(page.getByTestId('escala-day-2026-03-05')).toHaveClass(/escala-day-card--tracked/)
    await page.getByTestId('escala-team-member-dra-ana').click()
    await expect(page.getByTestId('escala-day-2026-03-05')).not.toHaveClass(/escala-day-card--tracked/)
    await expect(page.getByTestId('escala-team-edit')).toBeDisabled()
    await page.getByTestId('escala-team-member-dra-ana').click()
    await expect(page.getByTestId('escala-day-2026-03-05')).toHaveClass(/escala-day-card--tracked/)
    await page.getByTestId('escala-team-edit').click()
    await expect(page.getByTestId('escala-team-field-name')).toHaveValue('Dra. Ana')
    await expect(page.getByTestId('escala-team-edit')).toHaveCount(0)
    await expect(page.getByTestId('escala-team-save')).toBeVisible()
    await expect(page.getByTestId('escala-team-close')).toBeVisible()
    await expect(page.getByTestId('escala-team-field-shift')).toHaveCount(0)
    await expect(page.getByTestId('escala-team-field-nickname')).toHaveCount(0)
    await expect(page.getByTestId('escala-team-field-instagram')).toHaveValue('draana')
    await expect(page.getByTestId('escala-team-field-color')).toHaveValue('#22c55e')
    const calendarPanelAfterEdit = await page.getByTestId('escala-calendar-panel').boundingBox()
    const teamPanelAfterEdit = await page.getByTestId('escala-team-panel').boundingBox()
    const teamPanelOverflowAfterEdit = await page.getByTestId('escala-team-panel').evaluate((element) => ({
      scrollHeight: element.scrollHeight,
      clientHeight: element.clientHeight,
    }))
    expect(calendarPanelBefore?.width ?? 0).toBeGreaterThan(0)
    expect(teamPanelBefore?.width ?? 0).toBeGreaterThan(0)
    expect(calendarPanelAfterEdit?.width ?? 0).toBeGreaterThan(0)
    expect(teamPanelAfterEdit?.width ?? 0).toBeGreaterThan(120)
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
    await page.getByTestId('escala-team-field-instagram').fill('draanita')
    await page.getByTestId('escala-team-field-color').fill('#0ea5e9')
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
        phone: '+55 (51) 99999-9999',
        email: 'ana@local.test',
        instagram: 'draanita',
        color: '#0ea5e9'
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
        instagram: 'draana',
        color: '#22c55e'
      }
    ]

    await mockEscalaAuth(page)
    await mockEscalaPrefill(page)

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

    await openEscalaModule(page)

    await dismissPlanningAssistantIfVisible(page)
    await page.getByTestId('escala-team-add').click()
    await page.getByTestId('escala-team-field-name').fill('Paula Nova')
    await page.getByTestId('escala-team-field-status').click()
    await page.getByRole('option', { name: 'Inativo' }).click()
    await expect(page.getByTestId('escala-team-field-shift')).toHaveCount(0)
    await expect(page.getByTestId('escala-team-field-nickname')).toHaveCount(0)
    await expect(page.getByTestId('escala-team-field-instagram')).toHaveValue('')
    await expect(page.getByTestId('escala-team-field-color')).toHaveValue('#ec4899')
    await page.getByTestId('escala-team-field-role').click()
    await page.getByTestId('escala-team-field-role-injetor').click()
    await page.getByTestId('escala-team-field-phone').fill('51999999999')
    await page.getByTestId('escala-team-field-instagram').fill('paulanova')
    await page.getByTestId('escala-team-field-color').fill('#f97316')
    await page.getByTestId('escala-team-save').click()

    await expect.poll(() => professionalPayloads).toEqual([
      {
        name: 'Paula Nova',
        status: 'Inativo',
        units: ['Novo Hamburgo'],
        role: 'Injetor',
        shift: '',
        nickname: '',
        phone: '+55 (51) 99999-9999',
        email: '',
        instagram: 'paulanova',
        color: '#f97316'
      }
    ])

    await expect(page.getByTestId('escala-team-inactive-toggle')).toContainText('Inativos (1)')
    if (await page.getByTestId('escala-team-member-paula-nova').count() === 0) {
      await page.getByTestId('escala-team-inactive-toggle').click()
    }
    await expect(page.getByTestId('escala-team-member-paula-nova')).toBeVisible()
    await expect(page.getByTestId('escala-team-field-name')).toHaveCount(0)
  })

  test('fecha a seleção múltipla ao clicar fora do calendário', async ({ page }) => {
    await mockEscalaAuth(page)
    await mockEscalaPrefill(page)

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
            { name: 'Dra. Ana', status: 'Ativo', units: ['Novo Hamburgo'], role: 'Injetor', shift: '', nickname: '', phone: '', email: '', instagram: '', color: '#22c55e' },
            { name: 'Dr. Lucas', status: 'Ativo', units: ['Novo Hamburgo'], role: 'Injetor', shift: '', nickname: '', phone: '', email: '', instagram: '', color: '#0ea5e9' }
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
          closedDays: [],
          holidays: []
        })
      })
    })

    await openEscalaModule(page)

    await page.getByTestId('escala-multi-select-toggle').click()
    await expect(page.getByTestId('escala-multi-select-close')).toBeVisible()
    await page.getByTestId('escala-day-2026-03-05').click()
    await expect(page.getByTestId('escala-day-2026-03-05')).toHaveClass(/escala-day-card--selected/)
    await page.getByTestId('escala-team-panel').click({ position: { x: 20, y: 20 } })
    await expect(page.getByTestId('escala-multi-select-close')).toHaveCount(0)
    await expect(page.getByTestId('escala-day-2026-03-05')).not.toHaveClass(/escala-day-card--selected/)
  })

  test('limpa filtro ativo com Escape quando não há modal aberta', async ({ page }) => {
    await mockEscalaAuth(page)
    await mockEscalaPrefill(page)

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
            { name: 'Dra. Ana', status: 'Ativo', units: ['Novo Hamburgo'], role: 'Injetor', shift: '', nickname: '', phone: '', email: '', instagram: '', color: '#22c55e' },
            { name: 'Dr. Lucas', status: 'Ativo', units: ['Novo Hamburgo'], role: 'Injetor', shift: '', nickname: '', phone: '', email: '', instagram: '', color: '#0ea5e9' }
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
          schedule: [
            { date: '2026-03-05', unit: 'Novo Hamburgo', professional: 'Dra. Ana' },
            { date: '2026-03-12', unit: 'Novo Hamburgo', professional: 'Dr. Lucas' },
          ],
          closedDays: [],
          holidays: []
        })
      })
    })

    await openEscalaModule(page)

    await page.getByTestId('escala-pill-2026-03-05-dra-ana').click()
    await expect(page.getByTestId('escala-day-2026-03-05')).toHaveClass(/escala-day-card--tracked/)
    await page.keyboard.press('Escape')
    await expect(page.getByTestId('escala-day-2026-03-05')).not.toHaveClass(/escala-day-card--tracked/)
  })

  test('abre a edição do dia pelo teclado e fecha com Escape', async ({ page }) => {
    await mockEscalaAuth(page)
    await mockEscalaPrefill(page)

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
            { name: 'Dra. Ana', status: 'Ativo', units: ['Novo Hamburgo'], role: 'Injetor', shift: '', nickname: '', phone: '', email: '', instagram: '', color: '#22c55e' },
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
          closedDays: [],
          holidays: []
        })
      })
    })

    await openEscalaModule(page)

    const targetDay = page.getByTestId('escala-day-2026-03-05')
    await targetDay.focus()
    await page.keyboard.press('Enter')
    await expect(page.getByTestId('escala-modal-confirm')).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(page.getByTestId('escala-modal-confirm')).toHaveCount(0)
  })

  test('mantém os controles principais acessíveis em viewport mobile', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 })
    await mockEscalaAuth(page)
    await mockEscalaPrefill(page)

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
            { name: 'Dra. Ana', status: 'Ativo', units: ['Novo Hamburgo'], role: 'Injetor', shift: '', nickname: '', phone: '', email: '', instagram: '', color: '#22c55e' },
            { name: 'Dr. Lucas', status: 'Ativo', units: ['Novo Hamburgo'], role: 'Injetor', shift: '', nickname: '', phone: '', email: '', instagram: '', color: '#0ea5e9' }
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
          closedDays: [],
          holidays: []
        })
      })
    })

    await openEscalaModule(page)

    await expect(page.getByTestId('escala-calendar-panel')).toBeVisible()
    await page.getByTestId('escala-team-panel').scrollIntoViewIfNeeded()
    await expect(page.getByTestId('escala-team-panel')).toBeVisible()
    await expect(page.getByTestId('escala-multi-select-toggle')).toBeVisible()
  })
})
