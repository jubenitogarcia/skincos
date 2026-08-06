import { expect, test, type Page } from '@playwright/test'

async function mockClientes(page: Page) {
  await page.route('**/api/auth/me**', async (route) => route.fulfill({
    status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, user: { username: 'synthetic-gestor', role: 'GESTOR', allowedUnits: ['novo-hamburgo'], allowedModules: ['atendimento'] } }),
  }))
  const profile = {
    identityId: '11111111-1111-4111-8111-111111111111', name: 'Cliente Sintético', sourceTypes: ['attendance_client'], identityQuality: 'confirmed_multi_source', units: ['Novo Hamburgo'], lastAttendance: '2026-01-10', recencyDays: 210, visitCount: 2, procedureCount: 2, completedProcedures: ['Botox'], saleCount: 1, lifetimeSales: 900, sales12m: 900, ticketAverage: 900, purchasedProcedures: ['Botox'], pendingSaleItems: 0, hasRecordedAttendance: true, dataWarnings: [], segments: [{ key: 'return_at_risk', label: 'Retorno em risco', priority: 'high', nextAction: 'Revisar retorno', evidence: {} }], priority: 'high', recommendedAction: 'Revisar retorno', activeActionCount: 1, lastActionAt: '2026-08-05', contactEligibility: { channel: 'whatsapp', status: 'eligible', contactAllowed: true, reason: 'eligible', controlsReady: true, contactWriteControlsReady: true, harmoniaChecked: true, hasPhone: true, optOutRecorded: false, permissionStatus: 'granted', evidenceSource: 'synthetic', evidenceReference: 'synthetic', expiresAt: '2026-08-12', permissionRevision: 1, recordedBy: 'synthetic', updatedAt: '2026-08-05' },
  }
  const action = { id: 'action-synthetic', identityId: profile.identityId, clientName: profile.name, unitSlug: 'novo-hamburgo', unitName: 'Novo Hamburgo', segmentKey: 'return_at_risk', actionType: 'follow_up', contactChannel: 'whatsapp', status: 'open', owner: 'Dra. Sintética', dueDate: '2026-08-06', notes: '', outcomeNotes: '', outcomeCode: null, revision: 1, createdBy: 'synthetic', completedAt: null, contactedAt: null, createdAt: '2026-08-05', updatedAt: '2026-08-05', queueFlags: ['assigned_to_me', 'due_today', 'permission_expiring'] }
  await page.route('**/api/atendimento/**', async (route) => {
    const url = new URL(route.request().url())
    const path = url.pathname
    const body = (payload: unknown) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, ...(payload as object) }) })
    if (path.endsWith('/commercial/references')) return body({ units: [{ slug: 'novo-hamburgo', name: 'Novo Hamburgo' }], professionals: [{ id: 'p1', name: 'Dra. Sintética', role: 'Gestor', status: 'Ativo', units: ['Novo Hamburgo'] }], procedures: [{ id: 'proc', name: 'Botox' }] })
    if (path.endsWith('/commercial/overview')) return body({ asOf: '2026-08-06', policy: { activeContactCooldownDays: 30, returnRiskThresholds: [90, 180, 365], commercialContactWritesEnabled: false, commercialContactCanaryIdentityIds: [], commercialContactWriteControlsReady: true, policyVersion: 'synthetic', updatedBy: 'synthetic', updatedAt: '2026-08-05' }, summary: { profiles: 1, returnAtRisk: 1, highValueInactive: 0, frequent: 0, balancedVip: 0, reactivationPotential: 1, averageTicket: 900 }, actions: { actions: 1, contactedActions: 0, recoveredSalesClients: 0, clinicalReturnClients: 0 }, coverage: { identitiesVisible: 1, confirmedMultiSourceIdentities: 1, unresolvedSingleSourceIdentities: 0, classifiedSaleItems: 1, saleItems: 1 }, dataQuality: { futureAttendancesExcluded: 0, recencySource: 'completed_attendance_only', saleItemsWithoutClassification: 0, activeAttendanceClientsWithoutIdentity: 0, identityDataUpdatedAt: '2026-08-06', contactEligibility: { eligible: 1, blocked: 0, reviewRequired: 0, controlsReady: true, contactWriteControlsReady: true } }, total: 1, limit: 50, offset: 0, pagination: { mode: 'sql', sort: 'priority', direction: 'desc', hasPrevious: false, hasNext: false }, profiles: [profile] })
    if (path.endsWith('/commercial/profile/' + profile.identityId) || path.includes('/commercial/profiles/')) return body({ asOf: '2026-08-06', policy: { activeContactCooldownDays: 30, returnRiskThresholds: [90, 180, 365], commercialContactWritesEnabled: false, commercialContactCanaryIdentityIds: [], commercialContactWriteControlsReady: true, policyVersion: 'synthetic', updatedBy: 'synthetic', updatedAt: '2026-08-05' }, profile, actions: [action], timeline: [{ id: 'sale:synthetic', type: 'sale', occurredOn: '2026-01-09', title: 'Compra registrada', detail: 'Botox', unitName: 'Novo Hamburgo', source: 'Caixa', amount: 900, status: 'confirmed' }], clinicalCadences: [] })
    if (path.endsWith('/commercial/operations')) return body({ asOf: '2026-08-06', scope: ['novo-hamburgo'], wallet: { total: 1, actions: [action], countsByFlag: { assigned_to_me: 1, due_today: 1, overdue: 0, permission_expiring: 1 }, pagination: { limit: 25, offset: 0, hasPrevious: false, hasNext: false } }, team: { totals: { total: 1, active: 1, dueToday: 1, overdue: 0, completed: 0, responded: 0, scheduled: 0, attended: 0, sale: 0, returned: 0, cancelled: 0, completionRate: 0, responseRate: 0, schedulingRate: 0, attendanceRate: 0, saleRate: 0, returnRate: 0, cancellationRate: 0 }, byStatus: { open: 1 }, byOwner: [{ owner: 'Dra. Sintética', total: 1, active: 1, overdue: 0, completed: 0, statuses: { open: 1 } }], stageDurations: {}, slaHours: 24 }, absences: [], controls: { migrationReady: true, commercialContactWritesEnabled: false, messagesEnabled: false, policyVersion: 'synthetic' }, privacy: { piiInMetrics: false, phoneOrEmailInList: false } })
    if (path.endsWith('/commercial/campaigns')) return body({ campaigns: [] })
    if (path.endsWith('/commercial/data-quality')) return body({ total: 0, limit: 24, offset: 0, metrics: { findings: 0, currentFindings: 0, overdue: 0, unassigned: 0, bySeverity: {}, byStatus: {} }, sourceFreshness: {}, findings: [] })
    if (path.endsWith('/commercial/policy')) return body({ policy: { activeContactCooldownDays: 30, returnRiskThresholds: [90, 180, 365], commercialContactWritesEnabled: false, commercialContactCanaryIdentityIds: [], commercialContactWriteControlsReady: true, policyVersion: 'synthetic', updatedBy: 'synthetic', updatedAt: '2026-08-05' } })
    if (path.endsWith('/commercial/cadences')) return body({ cadences: [] })
    return body({})
  })
}

test('Cliente actions workspace renders queue, team and campaign controls without PII contact fields', async ({ page }) => {
  await mockClientes(page)
  await page.goto('/?module=clientes&clientesView=actions')
  await expect(page.getByTestId('clientes-workspace-nav')).toBeVisible({ timeout: 30_000 })
  await expect(page.getByTestId('commercial-operations-panel')).toBeVisible({ timeout: 30_000 })
  await expect(page.getByRole('heading', { name: 'Operação comercial assistida' })).toBeVisible()
  await expect(page.getByText('Cliente Sintético')).toBeVisible()
  await expect(page.getByText('Permissão expirando')).toBeVisible()
  await expect(page.getByText('Campanhas e coortes congeladas')).toBeVisible()
  await expect(page.locator('text=555199999')).toHaveCount(0)
  await expect(page.locator('text=@')).toHaveCount(0)
})

test('Cliente actions layout remains usable at mobile width', async ({ page }) => {
  await mockClientes(page)
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/?module=clientes&clientesView=actions')
  const panel = page.getByTestId('commercial-operations-panel')
  await expect(panel).toBeVisible({ timeout: 30_000 })
  await expect(panel.getByRole('button', { name: 'Atualizar' })).toBeVisible()
  await expect(panel.getByLabel('Buscar ação por cliente')).toBeVisible()
})
