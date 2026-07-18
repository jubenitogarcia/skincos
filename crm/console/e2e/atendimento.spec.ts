import { test, expect, type Page } from '@playwright/test'

async function mockAuth(page: Page, role = 'GESTOR') {
  await page.route('**/api/auth/me**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ ok: true, user: { username: 'e2e', role, allowedUnits: [], allowedModules: ['atendimento'] } }),
    })
  })
}

async function mockAtendimentoApi(page: Page, options: { restrictedManagement?: boolean; duplicateDoctorAlias?: boolean; duplicateProfessionalAlias?: boolean; invalidDoctorRows?: boolean } = {}) {
  const references = {
    ok: true,
    units: [{ slug: 'novo-hamburgo', name: 'Novo Hamburgo' }],
    professionals: [
      { id: 'p1', name: 'Dra. Sintética', role: 'Injetor', status: 'Ativo', units: ['Novo Hamburgo'] },
      { id: 'p2', name: 'Consultora Sintética', role: 'Consultor', status: 'Ativo', units: ['Novo Hamburgo'] },
      ...(options.duplicateProfessionalAlias
        ? [
            { id: 'raul-short', name: 'Raul Júnior', role: 'Injetor', status: 'Ativo', units: ['Novo Hamburgo'] },
            { id: 'raul-full', name: 'Raul Rosário Júnior', role: 'Injetor', status: 'Ativo', units: ['Novo Hamburgo'] },
          ]
        : []),
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
      valueFormulaVersion: 'attendance-value/v1',
      revision: 1,
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
  const conversionDoctors = [
    { name: 'Dra. Sintética', weekValue: 18, totalValue: 3, score: 3, position: '1ª', rank: 1, level: 3 },
    { name: 'Dr. Prata', weekValue: 14, totalValue: 2, score: 2, position: '2ª', rank: 2, level: 2 },
    { name: 'Dra. Bronze', weekValue: 10, totalValue: 1, score: 1, position: '3ª', rank: 3, level: 1 },
    ...(options.duplicateDoctorAlias
      ? [
          { name: 'Raul Rosário Júnior', weekValue: 9, totalValue: 9, score: 1, position: '4ª', rank: 4, level: 1 },
          { name: 'Raul Júnior', weekValue: 0, totalValue: 0, score: 0, position: '5ª', rank: 5, level: 0 },
        ]
      : []),
    ...(options.invalidDoctorRows
      ? [
          { name: '[object Object]', weekValue: 0, totalValue: 0, score: 0, position: '6ª', rank: 6, level: 0 },
          { name: 'Dóris Caroline Moisyn', weekValue: 0, totalValue: 0, score: 0, position: '7ª', rank: 7, level: 0 },
        ]
      : []),
  ]

  await page.route('**/api/atendimento/**', async (route) => {
    const url = new URL(route.request().url())
    const method = route.request().method()
    if (url.pathname.endsWith('/references')) {
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(references) })
    }
    if (url.pathname.endsWith('/clients')) {
      const query = String(url.searchParams.get('q') || '').toLocaleLowerCase('pt-BR')
      const clients = query.includes('cyn') ? [{ name: 'Cynthia Cordova', usageCount: 2 }] : []
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, clients }) })
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
                periodAttendanceTotal: { label: 'Total', weekValue: rows.reduce((acc, row) => acc + row.value, 0), totalValue: rows.reduce((acc, row) => acc + row.value, 0) },
                rankedDoctorTotal: { label: 'Total ranqueável', weekValue: rows.reduce((acc, row) => acc + row.value, 0), totalValue: rows.reduce((acc, row) => acc + row.value, 0) },
                periodGoal: { label: 'Meta do período', weekValue: 10, totalValue: 10 },
                dailyGoal: { label: 'Meta diária', weekValue: 10, totalValue: 10 },
                periodOperationalDays: { label: 'Dias período', weekValue: 1, totalValue: 1 },
                eligibleDoctorCount: { label: 'Doutores elegíveis', weekValue: 3, totalValue: 3 },
                average: { label: 'Média', weekValue: 14, totalValue: 14 },
                median: { label: 'Mediana', weekValue: 14, totalValue: 14 },
                standardDeviation: { label: 'Desvio padrão', weekValue: 4.31, totalValue: 4.31 },
                cutLine: { label: 'Linha Corte', weekValue: 12, totalValue: 12 },
                interval: { label: 'Intervalo', weekValue: 4, totalValue: 4 },
                intervalMultiplier: { label: 'Multiplicador Otimizado', weekValue: 0.92853, totalValue: 0.92853 },
                homogeneityScore: { label: 'Homogeneidade', weekValue: 1, totalValue: 1 },
                lowerLimit: { label: 'Limite Inferior', weekValue: 8, totalValue: 8 },
                upperLimit: { label: 'Limite Superior', weekValue: 16, totalValue: 16 },
                level0: { label: 'Nível 0', weekValue: 1, totalValue: 1, proportion: 0.25 },
                level1: { label: 'Nível 1', weekValue: 1, totalValue: 1, proportion: 0.25 },
                level2: { label: 'Nível 2', weekValue: 1, totalValue: 1, proportion: 0.25 },
                level3: { label: 'Nível 3', weekValue: 1, totalValue: 1, proportion: 0.25 },
                outerRatio: { label: 'Razão exterior', weekValue: 0.1, totalValue: 0.1 },
                upperRatio: { label: 'Razão superior', weekValue: 0.2, totalValue: 0.2 },
                innerRatio: { label: 'Razão interior', weekValue: 0.3, totalValue: 0.3 },
                lowerRatio: { label: 'Razão inferior', weekValue: 0.4, totalValue: 0.4 },
                ratioDivisor: { label: 'Divisor Razões', weekValue: 2, totalValue: 2 },
                lowerSide: { label: 'Lado Inferior', weekValue: 0, totalValue: 0 },
                upperSide: { label: 'Lado Superior', weekValue: 1, totalValue: 1 },
                centerShare: { label: 'Faixas Centrais', weekValue: 1, totalValue: 1 },
                extremesShare: { label: 'Faixas Extremas', weekValue: 0, totalValue: 0 },
              },
              optimization: {
                selectedMultiplier: 0.92853,
                defaultIntervalMultiplier: null,
                previousIntervalMultiplier: 0.75,
                intervalMultiplierMin: 0,
                intervalMultiplierMax: 2,
                objectiveName: 'sse_uniform',
                tieBreakPolicy: 'previous_then_widest_plateau_center',
                selectionReason: 'widest_optimal_plateau_center',
                optimalPlateau: { start: 0.740358, end: 1.116701, startInclusive: true, endInclusive: false, width: 0.376343, homogeneityScore: 1, loss: 0, counts: { level0: 1, level1: 1, level2: 1, level3: 1 }, proportions: { p0: 0.25, p1: 0.25, p2: 0.25, p3: 0.25 }, isOptimal: true },
                optimalPlateaus: [{ start: 0.740358, end: 1.116701, startInclusive: true, endInclusive: false, width: 0.376343, homogeneityScore: 1, loss: 0, counts: { level0: 1, level1: 1, level2: 1, level3: 1 }, proportions: { p0: 0.25, p1: 0.25, p2: 0.25, p3: 0.25 }, isOptimal: true }],
                homogeneityCurve: [
                  { start: 0, end: 0.740358, startInclusive: true, endInclusive: false, width: 0.740358, homogeneityScore: 0.833333, loss: 0.125, counts: { level0: 2, level1: 0, level2: 1, level3: 1 }, proportions: { p0: 0.5, p1: 0, p2: 0.25, p3: 0.25 }, isOptimal: false },
                  { start: 0.740358, end: 1.116701, startInclusive: true, endInclusive: false, width: 0.376343, homogeneityScore: 1, loss: 0, counts: { level0: 1, level1: 1, level2: 1, level3: 1 }, proportions: { p0: 0.25, p1: 0.25, p2: 0.25, p3: 0.25 }, isOptimal: true },
                  { start: 1.116701, end: 2, startInclusive: true, endInclusive: true, width: 0.883299, homogeneityScore: 0.666667, loss: 0.25, counts: { level0: 0, level1: 2, level2: 2, level3: 0 }, proportions: { p0: 0, p1: 0.5, p2: 0.5, p3: 0 }, isOptimal: false },
                ],
                statusCode: 'OPTIMAL_ALL_BANDS',
                optimizationStatusCode: 'OPTIMAL_ALL_BANDS',
                counts: { N0: 1, N1: 1, N2: 1, N3: 1 },
                proportions: { p0: 0.25, p1: 0.25, p2: 0.25, p3: 0.25 },
                legacyReasons: { upperRatio: 1, lowerRatio: 0, innerRatio: 1, outerRatio: 0 },
                balancedReasons: { lowerSide: 0, upperSide: 1, center: 1, extremes: 0 },
                homogeneityScore: 1,
                homogeneityLoss: 0,
                diagnostics: { breakpointCount: 4, candidatesEvaluated: 10, allBandsPopulated: true, extremesPopulated: true },
                configHash: 'fnv1a-test',
                calendarHash: 'calendar-fnv1a-test',
              },
              history: [
                { id: 'history-current', unitSlug: 'novo-hamburgo', unitName: 'Novo Hamburgo', periodStart: '2026-06-10', periodEnd: '2026-06-10', selectedMultiplier: 0.92853, previousIntervalMultiplier: 0.75, homogeneityScore: 1, homogeneityLoss: 0, statusCode: 'OPTIMAL_ALL_BANDS', optimizationStatusCode: 'OPTIMAL_ALL_BANDS', counts: { N0: 1, N1: 1, N2: 1, N3: 1 }, proportions: { p0: 0.25, p1: 0.25, p2: 0.25, p3: 0.25 }, configHash: 'fnv1a-test', calendarHash: 'calendar-fnv1a-test' },
                { id: 'history-previous', unitSlug: 'novo-hamburgo', unitName: 'Novo Hamburgo', periodStart: '2026-06-03', periodEnd: '2026-06-03', selectedMultiplier: 0.7, previousIntervalMultiplier: null, homogeneityScore: 0.8, homogeneityLoss: 0.15, statusCode: 'OPTIMAL_EXTREMES_ONLY', optimizationStatusCode: 'OPTIMAL_EXTREMES_ONLY', counts: { N0: 1, N1: 0, N2: 2, N3: 1 }, proportions: { p0: 0.25, p1: 0, p2: 0.5, p3: 0.25 }, configHash: 'fnv1a-test', calendarHash: 'calendar-fnv1a-previous' },
              ],
              doctors: conversionDoctors,
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
      expect(route.request().headers()['idempotency-key']).toBeTruthy()
      expect(body.value).toBeUndefined()
      const next = { ...body, id: 'row-2', unitName: 'Novo Hamburgo', valueFormulaVersion: 'attendance-value/v1', revision: 1 }
      rows = [next, ...rows]
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, data: next }) })
    }
    if (url.pathname.includes('/attendances/row-2') && method === 'PATCH') {
      const body = await route.request().postDataJSON()
      rows = rows.map((row) => row.id === 'row-2' ? { ...row, ...body, revision: Number(row.revision || 1) + 1 } : row)
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, data: rows.find((row) => row.id === 'row-2') }) })
    }
    if (url.pathname.includes('/attendances/row-2') && method === 'DELETE') {
      rows = rows.filter((row) => row.id !== 'row-2')
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true }) })
    }
    return route.fulfill({ status: 404, contentType: 'application/json', body: JSON.stringify({ ok: false, error: 'NOT_FOUND' }) })
  })
}

test.describe('atendimento', () => {
  test.skip(!!process.env.CI && process.env.RUN_ATENDIMENTO_E2E_IN_CI !== '1', 'Atendimento E2E runs in dedicated workflow.')

  test('renders dashboard and supports create and inline edit flows', async ({ page }) => {
    await mockAuth(page)
    await mockAtendimentoApi(page)
    await page.goto('/?module=atendimento')

    await expect(page.getByRole('heading', { name: 'Atendimento' })).toBeVisible({ timeout: 30000 })
    await expect(page.getByRole('button', { name: '7d' })).toHaveCount(0)
    await expect(page.getByRole('button', { name: '30d' })).toHaveCount(0)
    await expect(page.getByRole('button', { name: 'Semana atual' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Mês atual' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Selecionar período personalizado' })).toBeVisible()
    await expect(page.getByRole('button', { name: '60d' })).toHaveCount(0)
    await expect(page.getByTestId('atendimento-header-refresh')).toHaveAttribute('aria-label', 'Atualizar Atendimento')
    await page.getByRole('button', { name: 'Semana atual' }).hover()
    const weekTooltip = page.getByRole('tooltip').filter({ hasText: 'Semana atual' })
    await expect(weekTooltip).toBeVisible()
    await expect(weekTooltip).toContainText('Da segunda-feira até hoje.')
    await page.getByRole('button', { name: 'Mês atual' }).hover()
    const monthTooltip = page.getByRole('tooltip').filter({ hasText: 'Mês atual' })
    await expect(monthTooltip).toBeVisible()
    await expect(monthTooltip).toContainText('Do primeiro dia do mês até hoje.')
    await page.getByRole('button', { name: 'Semana atual' }).click()
    await page.getByRole('button', { name: 'Selecionar período personalizado' }).click()
    const periodMenu = page.getByRole('menu')
    await expect(periodMenu).toContainText('Período personalizado')
    await expect(periodMenu.getByRole('button', { name: 'Últimos 7 dias' })).toBeVisible()
    await expect(periodMenu.getByRole('button', { name: 'Últimos 30 dias' })).toBeVisible()
    await expect(periodMenu).not.toContainText('Todos procedimentos')
    await periodMenu.getByLabel('Data inicial').fill('2026-06-01')
    await periodMenu.getByLabel('Data final').fill('2026-06-15')
    await periodMenu.getByRole('button', { name: 'Aplicar período' }).click()
    await expect(page.getByTestId('atendimento-custom-period-label')).toHaveText('01/06/2026 - 15/06/2026')
    const analysisToggle = page.getByTestId('atendimento-analysis-toggle')
    await expect(analysisToggle).toHaveAttribute('aria-expanded', 'false')
    await expect(page.getByTestId('atendimento-analysis-collapsed')).toBeVisible()
    await analysisToggle.click()
    await expect(analysisToggle).toHaveAttribute('aria-expanded', 'true')
    await expect(page.getByTestId('atendimento-kpis')).not.toContainText('Ticket médio')
    await expect(page.getByTestId('atendimento-kpis')).toContainText('Total')
    await expect(page.getByTestId('atendimento-kpis')).not.toContainText('Total ranqueável')
    await expect(page.getByTestId('atendimento-kpis')).not.toContainText('Doutores elegíveis')
    await expect(page.getByTestId('atendimento-kpis')).not.toContainText('Dias mês')
    await expect(page.getByTestId('atendimento-kpis')).not.toContainText('Fonte agenda')
    await expect(page.getByTestId('atendimento-kpis')).toContainText('Desempenho por doutor')
    await expect(page.getByTestId('atendimento-kpi-ranking')).toHaveCount(0)
    await expect(page.getByTestId('atendimento-kpi-resumo')).toHaveCount(0)
    await expect(page.getByTestId('atendimento-conversion-distribution')).toContainText('Resumo')
    await expect(page.getByTestId('atendimento-conversion-distribution')).toContainText('Meta diária')
    await expect(page.getByTestId('atendimento-conversion-distribution')).toContainText('Limite Superior')
    await expect(page.getByTestId('atendimento-conversion-distribution')).toContainText('Linha Corte')
    await expect(page.getByTestId('atendimento-conversion-distribution')).toContainText('Limite Inferior')
    await expect(page.getByTestId('atendimento-conversion-distribution')).toContainText('R$ 10,00 ÷ 1 dia = R$ 10,00')
    await expect(page.getByTestId('atendimento-conversion-distribution')).toContainText('30% × R$ 14,00 + 20% × R$ 14,00 + 50% × R$ 10,00 = R$ 12,00')
    await expect(page.getByTestId('atendimento-conversion-distribution')).not.toContainText('3 pts')
    await expect(page.getByTestId('atendimento-conversion-distribution')).not.toContainText('Total principal do período e dispersão calculada pelo CRM')
    // As faixas foram incorporadas ao Resumo para evitar dois painéis
    // concorrentes; o único tooltip de grupo restante explica essa composição.
    for (const group of [
      { label: 'Resumo', excerpt: 'Síntese financeira e referências de classificação' },
    ]) {
      await page.getByRole('button', { name: `Detalhes de ${group.label}` }).hover()
      const groupTooltip = page.getByRole('tooltip', { name: new RegExp(`^${group.label} O que é:`) })
      await expect(groupTooltip).toContainText('O que é:')
      await expect(groupTooltip).toContainText('Cálculo:')
      await expect(groupTooltip).toContainText('Uso:')
      await expect(groupTooltip).toContainText(group.excerpt)
    }
    await expect(page.getByTestId('atendimento-conversion-goals')).toHaveCount(0)
    await expect(page.getByTestId('atendimento-rank-trophy-1')).toBeVisible()
    await expect(page.getByTestId('atendimento-rank-trophy-2')).toBeVisible()
    await expect(page.getByTestId('atendimento-rank-trophy-3')).toBeVisible()
    await expect(page.getByTestId('atendimento-filters')).toBeVisible()
    await expect(page.getByText('Gerência', { exact: true })).toHaveCount(0)
    await expect(page.getByTestId('atendimento-conversion-ranking')).toContainText('Dra. Sintética')
    await expect(page.getByTestId('atendimento-kpis')).toContainText('Total')
    await expect(page.getByRole('button', { name: 'Detalhes de Faixas' })).toHaveCount(0)
    await expect(page.getByTestId('atendimento-kpis')).not.toContainText('Total do período')
    const multiplierDetails = page.getByTestId('atendimento-multiplier-details')
    await expect(multiplierDetails).toBeVisible()
    await expect(multiplierDetails).toContainText('Multiplicador por homogeneidade')
    await expect(multiplierDetails).toContainText('Lado inferior')
    await expect(multiplierDetails).toContainText('Lado superior')
    await expect(multiplierDetails).toContainText('Faixas centrais')
    await expect(multiplierDetails).toContainText('Faixas extremas')
    await expect(page.getByTestId('atendimento-multiplier-group-lower-levels')).toHaveAttribute('aria-label', 'Nível 0 e Nível 1 · 50%')
    await expect(multiplierDetails).not.toContainText('N0 + N1')
    await expect(page.getByTestId('atendimento-multiplier-calculation-basis')).toContainText('Base do cálculo')
    await expect(page.getByTestId('atendimento-multiplier-calculation-basis')).toContainText('Platô ótimo')
    const doctorProfileTarget = page.getByLabel('Detalhes do perfil de Dra. Sintética: R$ 18,00, Nível 3, posição 1.')
    await expect(doctorProfileTarget).toHaveCount(1)
    await doctorProfileTarget.hover()
    const doctorProfileTooltip = page.getByTestId('atendimento-doctor-tooltip')
    await expect(doctorProfileTooltip).toContainText('Dra. Sintética')
    await expect(doctorProfileTooltip).not.toContainText('Z modificado')
    await expect(doctorProfileTooltip).not.toContainText('Distância ao')
    const [doctorProfileBox, doctorProfileTooltipBox] = await Promise.all([
      doctorProfileTarget.boundingBox(),
      doctorProfileTooltip.boundingBox(),
    ])
    expect(doctorProfileBox).not.toBeNull()
    expect(doctorProfileTooltipBox).not.toBeNull()
    if (doctorProfileBox && doctorProfileTooltipBox) {
      expect(Math.abs(
        (doctorProfileTooltipBox.x + doctorProfileTooltipBox.width / 2)
        - (doctorProfileBox.x + doctorProfileBox.width / 2),
      )).toBeLessThan(150)
      const doctorTooltipGap = doctorProfileBox.y - (doctorProfileTooltipBox.y + doctorProfileTooltipBox.height)
      expect(doctorTooltipGap).toBeGreaterThanOrEqual(0)
      expect(doctorTooltipGap).toBeLessThan(96)
    }
    await expect(multiplierDetails).toContainText('Evolução recente')
    await expect(page.getByTestId('atendimento-conversion-k-history-chart')).toBeVisible()
    await expect(page.getByTestId('atendimento-conversion-optimization-status')).toHaveCount(0)
    await page.getByTestId('atendimento-multiplier-selected-value').hover()
    const multiplierTooltip = page.getByRole('tooltip').filter({ hasText: 'Quatro faixas equilibradas' })
    await expect(multiplierTooltip).toContainText('centro do maior platô ótimo')
    await page.getByRole('button', { name: 'Como funciona o multiplicador por homogeneidade' }).hover()
    const multiplierInfoTooltip = page.getByRole('tooltip').filter({ hasText: 'curva em degraus avalia' })
    await expect(multiplierInfoTooltip).toContainText('Cálculo:')
    await expect(page.getByTestId('atendimento-multiplier-popover-trigger')).toHaveCount(0)
    await expect(page.getByTestId('atendimento-multiplier-popover')).toHaveCount(0)
    const cutReference = page.getByTestId('atendimento-reference-badge-cut')
    await cutReference.getByRole('img').hover()
    const cutReferenceTooltip = page.getByTestId('atendimento-reference-tooltip-cut')
    await expect(cutReferenceTooltip).toBeVisible()
    await expect(cutReferenceTooltip).toContainText('Linha de corte')
    await expect(cutReferenceTooltip).toContainText('R$ 12,00')
    await expect(cutReference.locator('title')).toHaveCount(0)
    await page.getByText('Meta diária', { exact: true }).hover()
    const dailyGoalTooltip = page.getByRole('tooltip').filter({ hasText: 'meta_periodo / dias_trabalhados_periodo' })
    await expect(dailyGoalTooltip).toContainText('Cálculo:')
    await expect(dailyGoalTooltip).not.toContainText('R$ 10,00 ÷ 1 dia')
    await page.getByTestId('atendimento-conversion-band-2').focus()
    const bandTooltip = page.getByTestId('atendimento-conversion-band-tooltip')
    await expect(bandTooltip).toContainText('Nível 2')
    await expect(bandTooltip).toContainText('Razão da faixa: 25%')
    await expect(page.getByTestId('atendimento-conversion-band-2')).toHaveAttribute('fill-opacity', '0.3')
    const doctorBar = page.locator('[data-testid^="atendimento-doctor-bar-target-"]').first()
    await doctorBar.hover()
    const doctorTooltip = page.getByTestId('atendimento-doctor-tooltip')
    await expect(doctorTooltip).toBeVisible()
    await expect(doctorTooltip).toContainText('Realizado')
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
    await page.getByTestId('atendimento-inline-save').click()
    await expect(page.getByTestId('atendimento-row-client-row-2')).toHaveValue('Cliente Criado', { timeout: 5000 })

    await page.getByTestId('atendimento-row-client-row-2').fill('Cliente Editado')
    await page.getByTestId('atendimento-row-client-row-2').blur()
    await expect(page.getByTestId('atendimento-row-client-row-2')).toHaveValue('Cliente Editado')
  })

  test('consolida aliases do mesmo doutor em uma coluna com avatar', async ({ page }) => {
    await mockAuth(page)
    await mockAtendimentoApi(page, { duplicateDoctorAlias: true, invalidDoctorRows: true })
    await page.goto('/?module=atendimento')

    await page.getByTestId('atendimento-analysis-toggle').click()

    const distribution = page.getByTestId('atendimento-conversion-distribution')
    await expect(distribution).toBeVisible({ timeout: 30000 })
    await expect(distribution.getByText('Raul Júnior', { exact: true })).toHaveCount(1)
    await expect(distribution).not.toContainText('[object Object]')
    await expect(distribution).not.toContainText('Dóris Caroline Moisyn')
    const avatars = distribution.locator('svg image')
    await expect(avatars).toHaveCount(1)
    await expect(avatars.first()).toHaveAttribute('width', '64')
    await expect(distribution.locator('[data-testid^="atendimento-doctor-score-"]')).toHaveCount(0)
    await expect(distribution.getByTestId('atendimento-reference-badge-upper')).toBeVisible()
    await expect(distribution.getByTestId('atendimento-reference-badge-cut')).toBeVisible()
    await expect(distribution.getByTestId('atendimento-reference-badge-lower')).toBeVisible()
  })

  test('sugere clientes da unidade e não repete alias confirmado de profissional', async ({ page }) => {
    await mockAuth(page)
    await mockAtendimentoApi(page, { duplicateProfessionalAlias: true })
    await page.setViewportSize({ width: 1280, height: 900 })
    await page.goto('/?module=atendimento')

    const clientInput = page.getByTestId('atendimento-inline-client')
    await clientInput.fill('Cyn')
    const clientSuggestions = page.getByTestId('atendimento-client-suggestions')
    await expect(clientSuggestions.getByRole('option', { name: 'Cynthia Cordova 2 atend.' })).toBeVisible()
    await clientSuggestions.getByRole('option', { name: 'Cynthia Cordova 2 atend.' }).click()
    await expect(clientInput).toHaveValue('Cynthia Cordova')

    await page.getByTestId('atendimento-inline-injector').click()
    await expect(page.getByRole('option', { name: 'Raul Rosário Júnior' })).toHaveCount(1)
    await expect(page.getByRole('option', { name: 'Raul Júnior' })).toHaveCount(0)

    const scrollMetrics = await page.getByTestId('atendimento-table-scroll').evaluate((element) => ({
      clientWidth: element.clientWidth,
      scrollWidth: element.scrollWidth,
    }))
    expect(scrollMetrics.scrollWidth).toBeLessThanOrEqual(scrollMetrics.clientWidth)
  })

  test('keeps management area usable for non-manager users without restricted data', async ({ page }) => {
    await mockAuth(page, 'INJETOR')
    await mockAtendimentoApi(page, { restrictedManagement: true })
    await page.goto('/?module=atendimento')

    await page.getByTestId('atendimento-analysis-toggle').click()

    await expect(page.getByRole('heading', { name: 'Atendimento' })).toBeVisible({ timeout: 30000 })
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
