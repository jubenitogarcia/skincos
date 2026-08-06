import { expect, test, type Page } from '@playwright/test'

const policyVersion = 'a'.repeat(32)
const identityId = '00000000-0000-4000-8000-000000000001'

const profile = {
  identityId,
  name: 'Identidade Sintética',
  sourceTypes: ['synthetic_fixture'],
  identityQuality: 'confirmed_multi_source',
  units: ['Novo Hamburgo'],
  lastAttendance: '2026-07-01',
  recencyDays: 36,
  visitCount: 2,
  procedureCount: 2,
  completedProcedures: ['Procedimento sintético'],
  saleCount: 1,
  lifetimeSales: 1200,
  sales12m: 1200,
  ticketAverage: 1200,
  purchasedProcedures: ['Procedimento sintético'],
  pendingSaleItems: 0,
  hasRecordedAttendance: true,
  dataWarnings: [],
  segments: [{ key: 'reactivation_potential', label: 'Potencial de reativação', priority: 'normal' }],
  priority: 'normal',
  recommendedAction: 'Revisar próxima ação',
  activeActionCount: 0,
  lastActionAt: null,
  contactEligibility: {
    channel: 'whatsapp', status: 'eligible', contactAllowed: true,
    reason: 'eligible', controlsReady: true, contactWriteControlsReady: false,
    harmoniaChecked: true, hasPhone: true, optOutRecorded: false,
    permissionStatus: 'granted', evidenceSource: 'synthetic', evidenceReference: 'fixture-1',
    expiresAt: null, permissionRevision: 1, recordedBy: 'fixture', updatedAt: '2026-07-01T00:00:00Z',
  },
}

const candidate = {
  candidateRef: 'cc1.synthetic.candidate-ref',
  displayNameMasked: 'I•••••••••e S•••••••a',
  unitSlugs: ['novo-hamburgo'],
  identityQuality: 'confirmed_multi_source',
  sourceTypes: ['synthetic_fixture'],
  validationStatus: 'explicit_approved',
  validationReason: 'Fixture sintética aprovada',
  validationRevision: 1,
  contactStatus: 'eligible',
  contactReason: 'eligible',
  permissionStatus: 'granted',
  expiresAt: null,
  phoneStatus: 'correlated',
  hasPhone: true,
  optOut: false,
  freshnessStatus: 'healthy',
  sourceFreshness: { identidade: 'healthy' },
  sourceLastReadAt: { identidade: '2026-08-06T00:00:00Z' },
  inclusionReason: 'confirmed_multi_source_identity',
  inActorScope: true,
}

function overview() {
  return {
    ok: true,
    asOf: '2026-08-06',
    policy: {
      activeContactCooldownDays: 30,
      returnRiskThresholds: [90, 180, 365],
      commercialContactWritesEnabled: false,
      commercialContactCanaryIdentityIds: [],
      commercialContactWriteControlsReady: false,
      policyVersion,
      updatedBy: 'fixture',
      updatedAt: '2026-08-06T00:00:00Z',
    },
    summary: { profiles: 1, returnAtRisk: 0, highValueInactive: 0, frequent: 1, balancedVip: 0, reactivationPotential: 1, averageTicket: 1200 },
    actions: { actions: 0, contactedActions: 0, recoveredSalesClients: 0, clinicalReturnClients: 0 },
    coverage: { identitiesVisible: 1, confirmedMultiSourceIdentities: 1, unresolvedSingleSourceIdentities: 0, classifiedSaleItems: 1, saleItems: 1 },
    dataQuality: {
      futureAttendancesExcluded: 0, recencySource: 'completed_attendance_only', saleItemsWithoutClassification: 0,
      activeAttendanceClientsWithoutIdentity: 0, identityDataUpdatedAt: '2026-08-06T00:00:00Z',
      contactEligibility: { eligible: 1, blocked: 0, reviewRequired: 0, controlsReady: true, contactWriteControlsReady: false, scope: 'page' },
    },
    total: 1, limit: 50, offset: 0,
    pagination: { mode: 'sql', sort: 'priority', direction: 'desc', hasPrevious: false, hasNext: false },
    profiles: [profile],
  }
}

async function mockCanaryApi(page: Page) {
  await page.route('**/api/auth/me**', async (route) => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ ok: true, user: { username: 'synthetic-gestor', role: 'GESTOR', allowedUnits: [], allowedModules: ['clientes'] } }),
  }))

  await page.route('**/api/atendimento/**', async (route) => {
    const url = new URL(route.request().url())
    const path = url.pathname
    const method = route.request().method()
    const json = (body: unknown) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) })
    if (path.endsWith('/commercial/overview')) return json(overview())
    if (path.endsWith('/commercial/references')) return json({ ok: true, units: [{ slug: 'novo-hamburgo', name: 'Novo Hamburgo' }], professionals: [], procedures: [{ id: 'synthetic', name: 'Procedimento sintético', codes: [] }] })
    if (path.includes('/commercial/profiles/')) return json({ ok: true, asOf: '2026-08-06', policy: overview().policy, profile, actions: [], timeline: [], clinicalCadences: [] })
    if (path.endsWith('/commercial/data-quality')) return json({ ok: true, total: 0, limit: 24, offset: 0, metrics: { findings: 0, currentFindings: 0, overdue: 0, unassigned: 0, bySeverity: {}, byStatus: {} }, sourceFreshness: {}, findings: [] })
    if (path.endsWith('/commercial/canary/state')) return json({ ok: true, ready: true, emergencyOff: false, commercialContactWritesEnabled: false, cohort: null, policyVersion, writesDefault: false, messagesEnabled: false })
    if (path.endsWith('/commercial/canary/candidates')) return json({ ok: true, candidates: [candidate], total: 1, limit: 50, offset: 0, sourceFreshness: { observedAt: { identidade: '2026-08-06T00:00:00Z' }, statuses: { identidade: 'healthy' }, overall: 'healthy' }, writesEnabled: false, messagesEnabled: false })
    if (path.endsWith('/commercial/canary/preview') && method === 'POST') return json({ ok: true, preview: { totalCohort: 1, eligible: 1, blocked: 0, inReview: 0, permissionsExpiring: 0, phonesUncorrelated: 0, staleSources: 0, pendingIdentityDecisions: 0, duplicateSelections: 0, outOfScope: 0, notValidated: 0, canApply: true, impact: { identitiesSelected: 1, identitiesAdded: 1, commercialContactWritesEnabled: false, messagesToSend: 0, contactsToRecord: 0, actionsToCreate: 0, writesRemainDisabled: true }, sourceFreshness: { overall: 'healthy', statuses: { identidade: 'healthy' }, observedAt: {} } }, candidates: [candidate], policyVersion, confirmRequired: true, messagesEnabled: false })
    return json({ ok: true })
  })
}

test('Clientes canary selector is masked, scoped and simulation-first', async ({ page }) => {
  await mockCanaryApi(page)
  await page.goto('/?module=clientes&clientesView=governance')

  await expect(page.getByRole('heading', { name: 'Clientes' })).toBeVisible({ timeout: 30000 })
  await expect(page.getByRole('heading', { name: 'Rollout e canário' })).toBeVisible({ timeout: 30000 })
  const candidateCheckbox = page.getByRole('checkbox', { name: /Selecionar I••+e S••+a/ })
  await expect(candidateCheckbox).toBeVisible()
  await expect(page.getByText('Identidade Sintética', { exact: true })).toHaveCount(0)
  await expect(page.getByText('Escrita comercial: desativada', { exact: true })).toBeVisible()

  await candidateCheckbox.check()
  await page.getByRole('button', { name: 'Simular alteração' }).click()
  await expect(page.getByText('Simulação sem escrita', { exact: true })).toBeVisible()
  await expect(page.getByText(/1 inclusão\(ões\), 0 contato\(s\), 0 mensagem\(ns\)/)).toBeVisible()
})
