import { expect, test, type Page } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'

const identityId = '11111111-1111-4111-8111-111111111111'

const profile = {
  identityId,
  name: 'Cliente PII Sintético',
  sourceTypes: ['attendance_client', 'caixa_customer'],
  identityQuality: 'confirmed_multi_source',
  units: ['Novo Hamburgo'],
  lastAttendance: '2026-01-10',
  recencyDays: 30,
  visitCount: 3,
  procedureCount: 3,
  completedProcedures: ['Botox'],
  saleCount: 2,
  lifetimeSales: 900,
  sales12m: 900,
  ticketAverage: 450,
  purchasedProcedures: ['Botox'],
  pendingSaleItems: 0,
  hasRecordedAttendance: true,
  dataWarnings: [],
  segments: [{ key: 'return_at_risk', label: 'Retorno em risco', priority: 'high', nextAction: 'Revisar fila', evidence: {} }],
  priority: 'high',
  recommendedAction: 'Revisar fila consultiva',
  activeActionCount: 1,
  lastActionAt: '2026-08-01T12:00:00.000Z',
  contactEligibility: {
    channel: 'whatsapp', status: 'review_required', contactAllowed: false,
    reason: 'commercial_contact_controls_not_ready', controlsReady: false,
    contactWriteControlsReady: false, harmoniaChecked: false, hasPhone: false,
    optOutRecorded: false, permissionStatus: 'unknown', evidenceSource: '',
    evidenceReference: '', expiresAt: null, permissionRevision: 0, recordedBy: '', updatedAt: null,
  },
}

function overview() {
  return {
    ok: true,
    contract: 'crm-clientes-wallet/v1',
    asOf: '2026-08-06',
    policy: {
      activeContactCooldownDays: 30, returnRiskThresholds: [90, 180, 365],
      commercialContactWritesEnabled: false, commercialContactCanaryIdentityIds: [],
      commercialContactWriteControlsReady: false, policyVersion: 'synthetic', updatedBy: '', updatedAt: null,
    },
    summary: { profiles: 1, returnAtRisk: 1, highValueInactive: 0, frequent: 1, balancedVip: 0, reactivationPotential: 1, averageTicket: 450 },
    actions: { actions: 1, contactedActions: 0, recoveredSalesClients: 0, clinicalReturnClients: 0 },
    coverage: { identitiesVisible: 1, confirmedMultiSourceIdentities: 1, unresolvedSingleSourceIdentities: 0, classifiedSaleItems: 2, saleItems: 2 },
    dataQuality: { futureAttendancesExcluded: 0, recencySource: 'completed_attendance_only', saleItemsWithoutClassification: 0, activeAttendanceClientsWithoutIdentity: 0, identityDataUpdatedAt: '2026-08-06T00:00:00.000Z', contactEligibility: { eligible: 0, blocked: 0, reviewRequired: 1, controlsReady: false, contactWriteControlsReady: false, scope: 'page' } },
    total: 1, limit: 50, offset: 0,
    pagination: { mode: 'sql', sort: 'priority', direction: 'desc', hasPrevious: false, hasNext: false },
    profiles: [profile],
  }
}

async function mockClientesApis(page: Page) {
  await page.route('**/api/auth/me**', (route) => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ ok: true, csrfToken: 'synthetic', user: { id: 'synthetic-gestor', username: 'synthetic', email: 'synthetic@example.test', role: 'GESTOR', allowedModules: [] } }),
  }))
  await page.route('**/api/atendimento/**', async (route) => {
    const url = new URL(route.request().url())
    if (url.pathname.endsWith('/commercial/wallet')) return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(overview()) })
    if (url.pathname.endsWith('/commercial/references')) return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, units: [{ slug: 'novo-hamburgo', name: 'Novo Hamburgo' }], professionals: [{ id: 'professional-1', name: 'Equipe Sintética', status: 'Ativo', units: ['Novo Hamburgo'] }], procedures: [{ id: 'botox', name: 'Botox', codes: [] }] }) })
    if (url.pathname.endsWith('/commercial/data-quality')) return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, total: 0, limit: 24, offset: 0, metrics: { findings: 0, currentFindings: 0, overdue: 0, unassigned: 0, bySeverity: {}, byStatus: {} }, sourceFreshness: {}, findings: [] }) })
    if (url.pathname.includes('/commercial/profiles/')) return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, asOf: '2026-08-06', policy: overview().policy, profile, actions: [], timeline: [], clinicalCadences: [] }) })
    return route.fulfill({ status: 404, contentType: 'application/json', body: JSON.stringify({ ok: false, error: 'NOT_FOUND' }) })
  })
}

test.describe('Clientes workspace visual and responsive contract', () => {
  test('renders the deep-linked wallet without PII in the default list and keeps profile history', async ({ page }, testInfo) => {
    await mockClientesApis(page)
    await page.goto('/clientes/carteira?q=synthetic&assigned=none')
    await expect(page.getByRole('heading', { name: 'Carteira de clientes' })).toBeVisible()
    await expect(page.getByText('Cliente 11111111', { exact: true })).toBeVisible()
    await expect(page.getByRole('main')).toBeVisible()
    await expect(page.getByText('Cliente PII Sintético', { exact: true })).toHaveCount(0)

    const screenshot = await page.screenshot({ type: 'png' })
    await testInfo.attach(`clientes-${testInfo.project.name}.png`, { body: screenshot, contentType: 'image/png' })

    await page.getByText('Cliente 11111111', { exact: true }).click()
    await expect(page).toHaveURL(new RegExp(`/clientes/cliente/${identityId}`))
    await expect(page.getByRole('dialog', { name: 'Perfil do cliente' })).toBeVisible()
    await page.getByRole('button', { name: 'Fechar perfil e voltar para a carteira' }).click()
    await expect(page).toHaveURL(/\/clientes\/carteira\?/)
    await expect(page).toHaveURL(/q=synthetic/)
  })

  test('keeps the operational wallet keyboard- and landmark-accessible', async ({ page }) => {
    await mockClientesApis(page)
    await page.goto('/clientes/carteira?q=synthetic')
    await expect(page.getByRole('heading', { name: 'Carteira de clientes' })).toBeVisible()
    const results = await new AxeBuilder({ page }).analyze()
    const blocking = results.violations.filter((violation) => violation.impact === 'critical' || violation.impact === 'serious')
    expect(blocking, JSON.stringify(blocking, null, 2)).toEqual([])
  })
})
