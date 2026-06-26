import { test, expect, type Page } from '@playwright/test'

async function mockAuth(page: Page, role = 'GESTOR') {
  await page.route('**/api/auth/me**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ ok: true, user: { username: 'e2e', role, allowedUnits: [], allowedModules: ['atendimento-clinica'] } }),
    })
  })
}

async function mockAtendimentoApi(page: Page, options: { restrictedManagement?: boolean } = {}) {
  const references = {
    ok: true,
    units: [{ slug: 'novo-hamburgo', name: 'Novo Hamburgo' }],
    professionals: [
      { id: 'p1', name: 'Dra. Sintética', role: 'Injetor', status: 'Ativo', units: ['Novo Hamburgo'] },
      { id: 'p2', name: 'Consultora Sintética', role: 'Consultor', status: 'Ativo', units: ['Novo Hamburgo'] },
    ],
    procedures: [{ id: 'botox', name: 'Botox', codes: ['#0799', '#0599'] }],
  }
  let rows = [
    {
      id: 'row-1',
      unitSlug: 'novo-hamburgo',
      unitName: 'Novo Hamburgo',
      date: '2026-06-10',
      clientName: 'Cliente Inicial',
      procedureName: 'Botox',
      code: '#0799',
      quantity: 1,
      discount: false,
      otherValue: 0,
      roundValue: false,
      value: 799,
      injectorName: 'Dra. Sintética',
      consultantName: 'Consultora Sintética',
      observation: '',
    },
  ]
  const overview = () => ({
    ok: true,
    summary: {
      totalAttendances: rows.length,
      quantityTotal: rows.reduce((acc, row) => acc + Number(row.quantity || 0), 0),
      countMode: 'row',
      totalValue: rows.reduce((acc, row) => acc + row.value, 0),
      averageTicket: rows.length ? rows.reduce((acc, row) => acc + row.value, 0) / rows.length : 0,
      distinctClients: rows.length,
    },
    monthly: [{ month: '2026-06', count: rows.length, quantityTotal: rows.reduce((acc, row) => acc + Number(row.quantity || 0), 0), value: rows.reduce((acc, row) => acc + row.value, 0) }],
    rankings: {
      procedures: [{ label: 'Botox', count: rows.length, quantityTotal: rows.reduce((acc, row) => acc + Number(row.quantity || 0), 0), value: rows.reduce((acc, row) => acc + row.value, 0) }],
      injectors: [{ label: 'Dra. Sintética', count: rows.length, quantityTotal: rows.reduce((acc, row) => acc + Number(row.quantity || 0), 0), value: rows.reduce((acc, row) => acc + row.value, 0) }],
      consultants: [{ label: 'Consultora Sintética', count: rows.length, quantityTotal: rows.reduce((acc, row) => acc + Number(row.quantity || 0), 0), value: rows.reduce((acc, row) => acc + row.value, 0) }],
    },
  })

  await page.route('**/api/atendimento-clinica/**', async (route) => {
    const url = new URL(route.request().url())
    const method = route.request().method()
    if (url.pathname.endsWith('/references')) {
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(references) })
    }
    if (url.pathname.endsWith('/overview')) {
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(overview()) })
    }
    if (url.pathname.endsWith('/attendances') && method === 'GET') {
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, data: rows, total: rows.length, limit: 120, offset: 0 }) })
    }
    if (url.pathname.endsWith('/reports/preview')) {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          ok: true,
          unit: 'novo-hamburgo',
          from: '2026-06-10',
          to: '2026-06-10',
          summary: { doctors: 1, attendances: rows.length, quantityTotal: rows.reduce((acc, row) => acc + Number(row.quantity || 0), 0), totalValue: rows.reduce((acc, row) => acc + row.value, 0), remuneration: 100 },
          doctors: [{ doctorName: 'Dra. Sintética', count: rows.length, quantityTotal: rows.reduce((acc, row) => acc + Number(row.quantity || 0), 0), totalValue: rows.reduce((acc, row) => acc + row.value, 0), remuneration: 100, rows: [] }],
        }),
      })
    }
    if (url.pathname.endsWith('/management/catalog')) {
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ...references, tabs: [{ name: 'Procedimento', category: 'catalog', sensitive: false, rows: 3 }], scheduleSummary: [{ unitSlug: 'novo-hamburgo', unitName: 'Novo Hamburgo', days: 2, firstDate: '2026-06-10', lastDate: '2026-06-11' }] }) })
    }
    if (url.pathname.endsWith('/management/commercial')) {
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, summary: overview().summary, monthly: overview().monthly, rankings: overview().rankings, sourceTabs: [{ sourceTab: 'Comercial', rows: 2, activeRows: 2 }], items: [] }) })
    }
    if (url.pathname.endsWith('/management/conversion-report')) {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          ok: true,
          period: { targetYear: 2026, targetMonth: 6, weekNumber: 2, monthName: 'JUNHO' },
          source: { monthColumn: 'AG', weekColumn: 'AH', bxColumn: 'BX', bzColumn: 'BZ' },
          config: { fileNamePrefix: 'Informe Conversão', unitsOrder: ['BarraShoppingSul', 'Novo Hamburgo'], ignoreLabels: [], specialRows: [] },
          doctorRanking: {
            period: { metricStart: '2026-06-10', metricEnd: '2026-06-10' },
            sections: [{
              unitName: 'Novo Hamburgo',
              unitSlug: 'novo-hamburgo',
              goalPlan: {
                periodOperationalDays: 1,
                periodGoal: 20,
                dailyGoal: 20,
                segments: [{ monthKey: '2026-06-01', monthlyGoal: 20, monthOperationalDays: 1, periodOperationalDays: 1, dailyGoal: 20, periodGoal: 20 }],
              },
              metrics: {
                periodAttendanceTotal: { label: 'Total do período', weekValue: rows.reduce((acc, row) => acc + row.value, 0), totalValue: rows.reduce((acc, row) => acc + row.value, 0) },
                rankedDoctorTotal: { label: 'Total ranqueável', weekValue: rows.reduce((acc, row) => acc + row.value, 0), totalValue: rows.reduce((acc, row) => acc + row.value, 0) },
                periodGoal: { label: 'Meta do período', weekValue: 20, totalValue: 20 },
                dailyGoal: { label: 'Meta diária', weekValue: 20, totalValue: 20 },
                periodOperationalDays: { label: 'Dias período', weekValue: 1, totalValue: 1 },
                cutLine: { label: 'Linha Corte', weekValue: 12, totalValue: 12 },
                interval: { label: 'Intervalo', weekValue: 4, totalValue: 4 },
                intervalMultiplier: { label: 'Multiplicador', weekValue: 0.75, totalValue: 0.75 },
                lowerLimit: { label: 'Limite inferior', weekValue: 8, totalValue: 8 },
                upperLimit: { label: 'Limite superior', weekValue: 16, totalValue: 16 },
                level0: { label: 'Nível 0', weekValue: 0, totalValue: 0 },
                level1: { label: 'Nível 1', weekValue: 0, totalValue: 0 },
                level2: { label: 'Nível 2', weekValue: 1, totalValue: 1 },
                level3: { label: 'Nível 3', weekValue: 0, totalValue: 0 },
                outerRatio: { label: 'Razão exterior', weekValue: 0.1, totalValue: 0.1 },
                upperRatio: { label: 'Razão superior', weekValue: 0.2, totalValue: 0.2 },
                innerRatio: { label: 'Razão interior', weekValue: 0.3, totalValue: 0.3 },
                lowerRatio: { label: 'Razão inferior', weekValue: 0.4, totalValue: 0.4 },
                ratioDivisor: { label: 'Divisor razões', weekValue: 2, totalValue: 2 },
              },
              doctors: [{ name: 'Dra. Sintética', weekValue: 14, totalValue: 3, score: 3, position: '1ª', rank: 1, level: 2 }],
            }],
            topDoctors: [{ name: 'Dra. Sintética', unitName: 'Novo Hamburgo', unitSlug: 'novo-hamburgo', weekValue: 14, totalValue: 3, score: 3, position: '1ª', rank: 1, level: 2 }],
          },
          sections: [],
          warnings: [],
          summary: { sections: 1, rows: 4, doctorRankingSource: 'crm', scheduleSource: 'crm' },
        }),
      })
    }
    if (url.pathname.endsWith('/management/finance')) {
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, sourceTabs: [{ sourceTab: 'Caixa', rows: 2 }], items: [], attendanceTotals: { units: [{ unitSlug: 'novo-hamburgo', unitName: 'Novo Hamburgo', count: rows.length, quantityTotal: rows.reduce((acc, row) => acc + Number(row.quantity || 0), 0), value: rows.reduce((acc, row) => acc + row.value, 0) }] } }) })
    }
    if (url.pathname.endsWith('/management/inventory')) {
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, data: [{ id: 'inv-1', product: 'Produto Sintético', barraShoppingSul: 1, novoHamburgo: 2, sourceRow: 2 }] }) })
    }
    if (url.pathname.endsWith('/management/people')) {
      if (options.restrictedManagement) {
        return route.fulfill({ status: 403, contentType: 'application/json', body: JSON.stringify({ ok: false, error: 'FORBIDDEN' }) })
      }
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, professionals: references.professionals, items: [] }) })
    }
    if (url.pathname.endsWith('/management/raw-tabs')) {
      if (options.restrictedManagement) {
        return route.fulfill({ status: 403, contentType: 'application/json', body: JSON.stringify({ ok: false, error: 'FORBIDDEN' }) })
      }
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, tabs: [{ name: 'Procedimento', category: 'catalog', sensitive: false, rows: 3 }], rows: [], total: 0, limit: 100, offset: 0 }) })
    }
    if (url.pathname.endsWith('/management/charts')) {
      if (options.restrictedManagement) {
        return route.fulfill({ status: 403, contentType: 'application/json', body: JSON.stringify({ ok: false, error: 'FORBIDDEN' }) })
      }
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, spreadsheetId: 'gerencia-test', configured: true, charts: [] }) })
    }
    if (url.pathname.endsWith('/admin/import/google-sheet/gerencia') && method === 'POST') {
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, dryRun: true, tabCount: 2, rawRows: 10, procedures: 1, procedureCodes: 2, professionals: 2, schedules: 3, inventory: 1, managementItems: 4 }) })
    }
    if (url.pathname.endsWith('/attendances') && method === 'POST') {
      const body = await route.request().postDataJSON()
      const next = { ...body, id: 'row-2', unitName: 'Novo Hamburgo' }
      rows = [next, ...rows]
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, data: next }) })
    }
    if (url.pathname.includes('/attendances/row-2') && method === 'PATCH') {
      const body = await route.request().postDataJSON()
      rows = rows.map((row) => row.id === 'row-2' ? { ...row, ...body } : row)
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, data: rows.find((row) => row.id === 'row-2') }) })
    }
    if (url.pathname.includes('/attendances/row-2') && method === 'DELETE') {
      rows = rows.filter((row) => row.id !== 'row-2')
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true }) })
    }
    return route.fulfill({ status: 404, contentType: 'application/json', body: JSON.stringify({ ok: false, error: 'NOT_FOUND' }) })
  })
}

test.describe('atendimento clinica', () => {
  test.skip(!!process.env.CI && process.env.RUN_ATENDIMENTO_E2E_IN_CI !== '1', 'Atendimento Clínica E2E runs in dedicated workflow.')

  test('renders dashboard and supports create and inline edit flows', async ({ page }) => {
    await mockAuth(page)
    await mockAtendimentoApi(page)
    await page.goto('/?module=atendimento-clinica')

    await expect(page.getByRole('heading', { name: 'Atend. Clínica' })).toBeVisible({ timeout: 30000 })
    await expect(page.getByRole('button', { name: '7d' })).toHaveAttribute('title', 'Últimos 7 dias')
    await expect(page.getByRole('button', { name: '30d' })).toHaveAttribute('title', 'Últimos 30 dias')
    await expect(page.getByRole('button', { name: 'Semana atual' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Mês atual' })).toBeVisible()
    await expect(page.getByRole('button', { name: '60d' })).toHaveCount(0)
    await page.getByTestId('atendimento-header-refresh').hover()
    const refreshTooltip = page.getByRole('tooltip').filter({ hasText: 'Atualizar Atend. Clínica' })
    await expect(refreshTooltip).toBeVisible()
    await expect(refreshTooltip).toContainText('Status: Dados carregados')
    await expect(refreshTooltip).toContainText('Listagem: 1 linhas')
    await page.getByRole('button', { name: 'Semana atual' }).hover()
    const weekTooltip = page.getByRole('tooltip').filter({ hasText: 'Semana atual' })
    await expect(weekTooltip).toBeVisible()
    await expect(weekTooltip).toContainText('Da segunda-feira até hoje.')
    await page.getByRole('button', { name: 'Mês atual' }).hover()
    const monthTooltip = page.getByRole('tooltip').filter({ hasText: 'Mês atual' })
    await expect(monthTooltip).toBeVisible()
    await expect(monthTooltip).toContainText('Do primeiro dia do mês até hoje.')
    await expect(page.getByTestId('atendimento-kpis')).not.toContainText('Ticket médio')
    await expect(page.getByTestId('atendimento-kpis')).toContainText('Total do período')
    await expect(page.getByTestId('atendimento-kpis')).not.toContainText('Total ranqueável')
    await expect(page.getByTestId('atendimento-kpis')).not.toContainText('Doutores elegíveis')
    await expect(page.getByTestId('atendimento-kpis')).not.toContainText('Dias mês')
    await expect(page.getByTestId('atendimento-kpis')).not.toContainText('Fonte agenda')
    await expect(page.getByTestId('atendimento-kpis')).toContainText('Faixas por doutor')
    await expect(page.getByTestId('atendimento-kpi-ranking')).toHaveCount(0)
    await expect(page.getByTestId('atendimento-kpi-resumo')).toHaveCount(0)
    await expect(page.getByTestId('atendimento-conversion-distribution')).toContainText('Linha Corte')
    await expect(page.getByTestId('atendimento-conversion-distribution')).toContainText('Razão Exterior')
    await expect(page.getByTestId('atendimento-conversion-distribution')).toContainText('Resumo')
    await expect(page.getByTestId('atendimento-conversion-distribution')).toContainText('3 pts')
    await expect(page.getByTestId('atendimento-filters')).toBeVisible()
    await expect(page.getByText('Gerência', { exact: true })).toHaveCount(0)
    await expect(page.getByTestId('atendimento-conversion-ranking')).toContainText('Dra. Sintética')
    await expect(page.getByTestId('atendimento-row-client-row-1')).toHaveValue('Cliente Inicial')
    await expect(page.getByTestId('atendimento-loaded-count')).toContainText('1/1')
    await expect(page.getByTestId('atendimento-header-report')).toBeVisible()
    await expect(page.getByTestId('atendimento-inline-client')).toBeVisible()
    await expect(page.getByTestId('atendimento-table')).not.toContainText('Código')
    await expect(page.getByTestId('atendimento-table')).toContainText('Injetor')
    await expect(page.getByTestId('atendimento-table')).toContainText('Consultor')
    await expect(page.getByTestId('atendimento-table')).not.toContainText('Ações')
    await expect(page.getByTestId('atendimento-distinct-clients')).toContainText('1 distintos')
    await expect(page.getByTestId('atendimento-table-revenue')).toContainText('R$ 799,00')
    await expect(page.getByTestId('atendimento-header-import')).toBeVisible()
    await expect(page.getByTestId('atendimento-table')).not.toContainText('120 visíveis')
    await expect(page.getByText('Top procedimentos')).toHaveCount(0)
    await expect(page.getByTestId('atendimento-charts-panel')).toBeVisible()
    await expect(page.getByTestId('atendimento-charts-panel')).toContainText('Ticket médio')
    await expect(page.getByTestId('atendimento-charts-panel')).toContainText('Média por registro')
    for (const tabName of [/Inventário/, /Pessoas/, /Escala/, /Comercial/, /Conversão/, /Caixa/, /Importação/]) {
      await expect(page.getByRole('tab', { name: tabName })).toHaveCount(0)
    }

    await page.getByTestId('atendimento-header-import').click()
    await expect(page.getByTestId('atendimento-import-modal')).toBeVisible()
    await page.getByTestId('gerencia-import-dry-run').click()
    await expect(page.getByText(/Gerência dry-run:/)).toBeVisible()
    await page.keyboard.press('Escape')

    const dataHeadClass = await page.getByTestId('atendimento-table-head-date').getAttribute('class')
    expect(dataHeadClass || '').toContain('sticky')
    expect(dataHeadClass || '').toContain('left-0')
    await page.getByRole('button', { name: 'Ordenar Cliente' }).click()

    await page.getByTestId('atendimento-header-report').click()
    await expect(page.getByText(/Prévia:/)).toBeVisible()

    await page.getByTestId('atendimento-inline-date').fill('2026-06-18')
    await page.getByTestId('atendimento-inline-client').fill('Cliente Criado')
    await page.getByTestId('atendimento-inline-procedure').click()
    await page.getByRole('option', { name: 'Botox' }).click()
    await page.getByTestId('atendimento-inline-injector').click()
    await page.getByRole('option', { name: 'Dra. Sintética' }).click()
    await page.getByTestId('atendimento-inline-consultant').click()
    await page.getByRole('option', { name: 'Consultora Sintética' }).click()
    await expect(page.getByTestId('atendimento-row-client-row-2')).toHaveValue('Cliente Criado', { timeout: 5000 })

    await page.getByTestId('atendimento-row-client-row-2').fill('Cliente Editado')
    await page.getByTestId('atendimento-row-client-row-2').blur()
    await expect(page.getByTestId('atendimento-row-client-row-2')).toHaveValue('Cliente Editado')
  })

  test('keeps management area usable for non-manager users without restricted data', async ({ page }) => {
    await mockAuth(page, 'INJETOR')
    await mockAtendimentoApi(page, { restrictedManagement: true })
    await page.goto('/?module=atendimento-clinica')

    await expect(page.getByRole('heading', { name: 'Atend. Clínica' })).toBeVisible({ timeout: 30000 })
    await expect(page.getByTestId('atendimento-filters')).toBeVisible()
    await expect(page.getByTestId('atendimento-kpis')).not.toContainText('Ticket médio')
    await expect(page.getByTestId('atendimento-charts-panel')).toContainText('Ticket médio')
    await expect(page.getByTestId('atendimento-kpis')).not.toContainText('Dias mês')
    await expect(page.getByTestId('atendimento-kpi-ranking')).toHaveCount(0)
    await expect(page.getByTestId('atendimento-kpi-resumo')).toHaveCount(0)
    await expect(page.getByRole('button', { name: '60d' })).toHaveCount(0)
    await expect(page.getByText('Gerência', { exact: true })).toHaveCount(0)
    await expect(page.getByTestId('atendimento-conversion-ranking')).toContainText('Dra. Sintética')
    for (const tabName of [/Inventário/, /Pessoas/, /Escala/, /Comercial/, /Conversão/, /Caixa/, /Importação/]) {
      await expect(page.getByRole('tab', { name: tabName })).toHaveCount(0)
    }
    await expect(page.getByText('FORBIDDEN')).not.toBeVisible()
  })
})
