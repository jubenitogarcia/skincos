import { test, expect, type Page } from '@playwright/test'

const cluster = {
  schemaVersion: 'crm-identity-cluster/v1',
  clusterKey: 'cluster-synthetic-a',
  version: 'version-synthetic-a',
  summary: { memberCount: 4, identityCount: 3, sourceCount: 4, unitCount: 1 },
  members: [
    { source: 'attendance_client', sourceLabel: 'Atendimento', name: 'Cliente Sintético', aliases: ['Cliente S.'], units: ['novo-hamburgo'], matchingFields: [{ field: 'name', label: 'Nome', status: 'present' }], freshness: 'current', stale: false, contact: { phone: [], email: [], masked: true } },
    { source: 'caixa_customer', sourceLabel: 'Caixa', name: 'Cliente Sintético', aliases: [], units: ['novo-hamburgo'], matchingFields: [{ field: 'phone', label: 'Telefone validado', status: 'validated', values: ['55••••88'] }], freshness: 'current', stale: false, contact: { phone: ['55••••88'], email: [], masked: true } },
    { source: 'app_registration', sourceLabel: 'Cadastro do app', name: 'Cliente S.', aliases: [], units: ['novo-hamburgo'], matchingFields: [{ field: 'email', label: 'E-mail validado', status: 'validated', values: ['c•••@e•••'] }], freshness: 'current', stale: false, contact: { phone: ['55••••88'], email: ['c•••@e•••'], masked: true } },
    { source: 'lead_profile', sourceLabel: 'Leads e planilhas', name: 'Cliente Sintético', aliases: [], units: ['novo-hamburgo'], matchingFields: [], freshness: 'current', stale: false, contact: { phone: ['55••••88'], email: [], masked: true } },
  ],
  membersBySource: [
    { source: 'attendance_client', sourceLabel: 'Atendimento', count: 1 },
    { source: 'caixa_customer', sourceLabel: 'Caixa', count: 1 },
    { source: 'app_registration', sourceLabel: 'Cadastro do app', count: 1 },
    { source: 'lead_profile', sourceLabel: 'Leads e planilhas', count: 1 },
  ],
  units: ['novo-hamburgo'], matchingFields: ['phone', 'email'], conflicts: [],
  evidence: { strong: [{ kind: 'source_link', label: 'Telefone validado igual', strength: 'strong', confidence: 1, source: 'Cadastro do app', target: 'Caixa', summary: 'campos: phone · candidatos: 1' }], weak: [] },
  confidence: 1,
  decision: { state: 'pending', count: 0, lastAt: null }, decisionHistory: [], materializations: [], automaticLinks: [], sourceChanges: [],
  staleState: 'current', lineage: [], impact: { membersToMove: [{ sourceLabel: 'Caixa', name: 'Cliente Sintético' }], survivorIdentity: { name: 'Cliente Sintético', sourceCount: 2, sourceLabels: ['Atendimento', 'Caixa'] }, retiredIdentities: [], commercialHistoryPresent: false, consentHistoryPresent: false, predictedAction: 'merge_if_confirmed' },
  undo: { blocked: false, reasons: [], blockingHistory: { commercialActions: 0, consentPermissions: 0, consentEvents: 0, identityAuditEvents: 0 } },
  bulkReview: { eligible: true, mode: 'bulk_safe', sharedContactField: 'phone', reasons: [] }, privacy: { contactsMasked: true, technicalIdsHidden: true, revealRequired: true },
}

const policy = { activeContactCooldownDays: 30, returnRiskThresholds: [90, 180, 365], commercialContactWritesEnabled: false, commercialContactCanaryIdentityIds: [], commercialContactWriteControlsReady: false, policyVersion: 'policy-synthetic-v1', updatedBy: 'synthetic', updatedAt: null }

async function mockClientesApi(page: Page) {
  await page.route('**/api/auth/me**', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, user: { username: 'synthetic', role: 'GESTOR', allowedUnits: [], allowedModules: ['atendimento'] } }) }))
  await page.route('**/api/atendimento/**', async (route) => {
    const url = new URL(route.request().url())
    const path = url.pathname
    const base = { ok: true, policy }
    if (path.endsWith('/commercial/references')) return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, units: [{ slug: 'novo-hamburgo', name: 'Novo Hamburgo' }], professionals: [], procedures: [] }) })
    if (path.endsWith('/commercial/overview')) {
      const profile = { identityId: 'identity-synthetic', name: 'Cliente Sintético', sourceTypes: ['attendance_client'], identityQuality: 'confirmed_multi_source', units: ['novo-hamburgo'], lastAttendance: '2026-08-01', recencyDays: 5, visitCount: 2, procedureCount: 2, completedProcedures: ['Botox'], saleCount: 1, lifetimeSales: 799, sales12m: 799, ticketAverage: 799, purchasedProcedures: ['Botox'], pendingSaleItems: 0, hasRecordedAttendance: true, dataWarnings: [], segments: [], priority: 'normal', recommendedAction: 'Nenhuma', activeActionCount: 0, lastActionAt: null, contactEligibility: { status: 'blocked', reason: 'synthetic', contactAllowed: false, contactWriteAllowed: false, controlsReady: true, contactWriteControlsReady: false } }
      const overview = { ...base, asOf: '2026-08-06', summary: { profiles: 1, returnAtRisk: 0, highValueInactive: 0, frequent: 0, balancedVip: 0, reactivationPotential: 0, averageTicket: 799 }, actions: { actions: 0, contactedActions: 0, recoveredSalesClients: 0, clinicalReturnClients: 0 }, coverage: { identitiesVisible: 1, confirmedMultiSourceIdentities: 1, unresolvedSingleSourceIdentities: 0, classifiedSaleItems: 1, saleItems: 1 }, dataQuality: { futureAttendancesExcluded: 0, recencySource: 'completed_attendance_only', saleItemsWithoutClassification: 0, activeAttendanceClientsWithoutIdentity: 0, identityDataUpdatedAt: '2026-08-06T00:00:00Z', contactEligibility: { eligible: 0, blocked: 1, reviewRequired: 0, controlsReady: true, contactWriteControlsReady: false } }, total: 1, limit: 50, offset: 0, pagination: { mode: 'sql', sort: 'priority', direction: 'desc', hasPrevious: false, hasNext: false }, profiles: [profile] }
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(overview) })
    }
    if (path.includes('/commercial/profiles/')) {
      const profile = { identityId: 'identity-synthetic', name: 'Cliente Sintético', sourceTypes: ['attendance_client'], identityQuality: 'confirmed_multi_source', units: ['novo-hamburgo'], lastAttendance: '2026-08-01', recencyDays: 5, visitCount: 2, procedureCount: 2, completedProcedures: ['Botox'], saleCount: 1, lifetimeSales: 799, sales12m: 799, ticketAverage: 799, purchasedProcedures: ['Botox'], pendingSaleItems: 0, hasRecordedAttendance: true, dataWarnings: [], segments: [], priority: 'normal', recommendedAction: 'Nenhuma', activeActionCount: 0, lastActionAt: null, contactEligibility: { status: 'blocked', reason: 'synthetic', contactAllowed: false, contactWriteAllowed: false, controlsReady: true, contactWriteControlsReady: false } }
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, asOf: '2026-08-06', policy, profile, actions: [], timeline: [], clinicalCadences: [] }) })
    }
    if (path.endsWith('/commercial/data-quality')) return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, total: 0, limit: 24, offset: 0, metrics: { findings: 0, currentFindings: 0, overdue: 0, unassigned: 0, bySeverity: {}, byStatus: {} }, sourceFreshness: {}, findings: [] }) })
    if (path.endsWith('/commercial/identity-clusters')) return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, schemaVersion: 'crm-identity-cluster/v1', total: 1, limit: 50, offset: 0, clusters: [cluster], workflow: { writesReady: false }, workspace: { ready: true, migrationId: '20260806_identity_cluster_workspace_v1' }, graph: { members: 4, edges: 3 }, pagination: { hasPrevious: false, hasNext: false } }) })
    if (path.includes('/commercial/identity-clusters/')) return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, schemaVersion: 'crm-identity-cluster/v1', cluster, workflow: { writesReady: false }, workspace: { ready: true, migrationId: '20260806_identity_cluster_workspace_v1' } }) })
    return route.fulfill({ status: 404, contentType: 'application/json', body: JSON.stringify({ ok: false, error: 'NOT_FOUND' }) })
  })
}

test('renders the synthetic identity cluster workspace and preserves masked contacts on mobile', async ({ page }) => {
  await mockClientesApi(page)
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/?module=clientes')
  await expect(page.getByRole('heading', { name: 'Clientes' })).toBeVisible()
  await page.getByRole('tab', { name: 'Identidades' }).click()
  await expect(page).toHaveURL(/clientesView=identities/)
  await expect(page.getByRole('heading', { name: 'Clusters de identidade' })).toBeVisible()
  await expect(page.getByRole('button', { name: /Cliente Sintético/ }).first()).toBeVisible()
  await expect(page.getByText('55••••88').first()).toBeVisible()
  await expect(page.getByText('5511999998888')).toHaveCount(0)
  await expect(page.getByText('IDs técnicos não são renderizados.')).toBeVisible()
  await page.getByRole('button', { name: /Cliente Sintético/ }).click()
  await expect(page.getByTestId('identity-cluster-detail')).toBeVisible()
  await expect(page.getByText('Lineage e impacto previsto')).toBeVisible()
})
