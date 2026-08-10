import type { Page, Route } from '@playwright/test'

export type MockTeamMember = {
  id: string
  fullName: string
  username: string
  corporateEmail: string
  workforceEmployeeId: string
  profile: string
  jobTitle: string
  department: string
  units: string[]
  accountStatus: string
  crmAccountLinked?: boolean
  crmAccountUsername?: string | null
  crmAccountReviewStatus?: string | null
  crmAccountLinkId?: string | null
  provisioningState: string
  schedule: { professionalId: string | null; status: string; role: string; shift: string; nickname: string; instagram: string; color: string; units: string[] }
  scheduleSync?: { state: string; professionalId?: string | null; errorCode?: string | null; attempt?: number; updatedAt?: string | null }
  identityLinks: Array<{ id: string; source: string; sourceId: string; reviewStatus: string; matchMethod: string; confidence: string }>
}

export const syntheticTeam: MockTeamMember[] = [
  {
    id: 'e2e-ana', fullName: 'Ana Ribeiro', username: 'anaribeiro', corporateEmail: 'anaribeiro@espacofacial.com', workforceEmployeeId: 'e2e-wf-ana', profile: 'INJETOR', jobTitle: 'Injetor', department: 'Atendimento Local', units: ['novo-hamburgo'], accountStatus: 'ACTIVE', provisioningState: 'COMPLETED',
    schedule: { professionalId: 'e2e-escala-ana', status: 'Ativo', role: 'Injetor', shift: 'Integral', nickname: 'Ana', instagram: 'ana.ribeiro', color: '#22c55e', units: ['novo-hamburgo'] }, scheduleSync: { state: 'SYNCED', professionalId: 'e2e-escala-ana', attempt: 1 },
    identityLinks: [{ id: 'e2e-link-ana', source: 'ATENDIMENTO', sourceId: 'e2e-atendimento-ana', reviewStatus: 'CONFIRMED', matchMethod: 'EXPLICIT_WORKFORCE_ID', confidence: 'HIGH' }],
  },
  {
    id: 'e2e-lucas', fullName: 'Lucas Mendes', username: 'lucasmendes', corporateEmail: 'lucasmendes@espacofacial.com', workforceEmployeeId: 'e2e-wf-lucas', profile: 'CONSULTOR', jobTitle: 'Consultor', department: 'Comercial', units: ['novo-hamburgo', 'barra-shopping-sul'], accountStatus: 'INVITED', provisioningState: 'COMPLETED',
    schedule: { professionalId: null, status: 'Ativo', role: 'Consultor', shift: 'Comercial', nickname: 'Lucas', instagram: 'lucas.mendes', color: '#6d9eeb', units: ['novo-hamburgo', 'barra-shopping-sul'] }, scheduleSync: { state: 'PENDING', attempt: 1 },
    identityLinks: [],
  },
  {
    id: 'e2e-carla', fullName: 'Carla Souza', username: 'carlasouza', corporateEmail: 'carlasouza@espacofacial.com', workforceEmployeeId: 'e2e-wf-carla', profile: 'SUPERVISOR', jobTitle: 'Coordenador', department: 'Operações', units: ['barra-shopping-sul'], accountStatus: 'SUSPENDED', crmAccountLinked: false, crmAccountUsername: 'legacycarla', crmAccountReviewStatus: 'PENDING_REVIEW', crmAccountLinkId: 'e2e-account-link-carla', provisioningState: 'COMPLETED',
    schedule: { professionalId: null, status: 'Ativo', role: 'Coordenador', shift: 'Tarde', nickname: 'Carla', instagram: 'carla.souza', color: '#f97316', units: ['barra-shopping-sul'] }, scheduleSync: { state: 'FAILED', errorCode: 'ESCALA_API_ERROR', attempt: 2 },
    identityLinks: [{ id: 'e2e-link-carla', source: 'ESCALA', sourceId: 'e2e-escala-carla', reviewStatus: 'PENDING_REVIEW', matchMethod: 'EXPLICIT_WORKFORCE_ID', confidence: 'LOW' }],
  },
]

function cloneRows() {
  return syntheticTeam.map((row) => ({ ...row, units: [...row.units], schedule: { ...row.schedule, units: [...row.schedule.units] }, scheduleSync: row.scheduleSync ? { ...row.scheduleSync } : undefined, identityLinks: row.identityLinks.map((link) => ({ ...link })) }))
}

type MockUsersOptions = { failedActivationFor?: string; paginated?: boolean }

export async function mockUsersApi(page: Page, role = 'GESTOR', options: MockUsersOptions = {}) {
  const rows = cloneRows()
  if (options.paginated) {
    for (let index = 0; index < 52; index += 1) {
      rows.push({
        ...rows[0],
        id: `e2e-extra-${index}`,
        fullName: `Membro Extra ${index + 1}`,
        username: `membroextra${index + 1}`,
        corporateEmail: `membroextra${index + 1}@espacofacial.com`,
        workforceEmployeeId: `e2e-wf-extra-${index}`,
        identityLinks: [],
      })
    }
  }
  const failedActivationRow = rows.find((row) => row.id === options.failedActivationFor)
  if (failedActivationRow) {
    failedActivationRow.accountStatus = 'INVITED'
    failedActivationRow.provisioningState = 'FAILED'
  }
  await page.route('**/api/**', async (route: Route) => {
    const request = route.request()
    const url = new URL(request.url())
    const path = url.pathname
    const json = async () => { try { return request.postDataJSON() } catch { return {} } }
    const send = (body: unknown, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) })

    if (path.endsWith('/api/auth/me')) return send({ ok: true, success: true, user: { username: 'users-e2e', email: 'users-e2e@staging.invalid', role, allowedUnits: ['novo-hamburgo', 'barra-shopping-sul'], allowedModules: ['atendimento'] }, csrfToken: 'users-e2e-csrf' })
    if (path.endsWith('/api/escala/professionals') && ['POST', 'PUT'].includes(request.method())) return send({ ok: true, data: { professionalId: 'e2e-escala-carla' } })
    if (path.endsWith('/api/crm/admin/team') && request.method() === 'GET' && url.searchParams.get('mode') === 'config') return send({ success: true, data: { enabled: true, legacyEscalaEditor: false } })
    if (path.endsWith('/api/crm/admin/team') && request.method() === 'GET') {
      const status = (url.searchParams.get('status') || 'ACTIVE').toUpperCase()
      const query = (url.searchParams.get('q') || '').toLowerCase()
      const filtered = rows.filter((row) => status === 'ALL' ? true : status === 'ACTIVE' ? ['ACTIVE', 'INVITED'].includes(row.accountStatus) : row.accountStatus === status).filter((row) => !query || [row.fullName, row.username, row.corporateEmail, row.department, row.jobTitle, ...row.units].some((value) => value.toLowerCase().includes(query)))
      const page = Number(url.searchParams.get('page') || '1')
      const limit = Number(url.searchParams.get('limit') || '50')
      const data = options.paginated ? filtered.slice((page - 1) * limit, page * limit) : filtered
      const pendingItems = data.flatMap((row) => [
        ...(!row.crmAccountLinked && ['ACTIVE', 'SUSPENDED', 'TERMINATED'].includes(row.accountStatus) ? [{ memberId: row.id, kind: 'CRM_ACCOUNT_LINK', status: row.crmAccountReviewStatus || 'PENDING' }] : []),
        ...row.identityLinks.filter((link) => link.reviewStatus === 'PENDING_REVIEW').map((link) => ({ memberId: row.id, kind: 'IDENTITY_LINK', source: link.source, status: link.reviewStatus })),
        ...(row.scheduleSync && ['PENDING', 'FAILED', 'BLOCKED'].includes(row.scheduleSync.state) ? [{ memberId: row.id, kind: 'ESCALA_SYNC', status: row.scheduleSync.state }] : []),
      ])
      return send({ success: true, data, pendingItems, summary: { members: filtered.length, pendingInvites: filtered.filter((row) => row.accountStatus === 'INVITED').length, pendingLinks: filtered.reduce((total, row) => total + row.identityLinks.filter((link) => link.reviewStatus === 'PENDING_REVIEW').length, 0), pendingProvisioning: 0, pendingAccountLinks: filtered.filter((row) => !row.crmAccountLinked && ['ACTIVE', 'SUSPENDED', 'TERMINATED'].includes(row.accountStatus)).length }, ...(options.paginated ? { pagination: { page, limit, total: filtered.length, pages: Math.max(1, Math.ceil(filtered.length / limit)), hasMore: page < Math.max(1, Math.ceil(filtered.length / limit)) } } : {}) })
    }
    if (path.endsWith('/api/crm/admin/team/bulk-status') && request.method() === 'POST') {
      const body = await json()
      for (const id of body.ids || []) {
        const row = rows.find((item) => item.id === id)
        if (row) row.accountStatus = body.accountStatus
      }
      return send({ success: true, data: { ids: body.ids || [], accountStatus: body.accountStatus, count: (body.ids || []).length, pendingIds: [] } })
    }
    const statusMatch = path.match(/\/api\/crm\/admin\/team\/([^/]+)\/status$/)
    if (statusMatch && request.method() === 'POST') {
      const body = await json(); const row = rows.find((item) => item.id === decodeURIComponent(statusMatch[1]))
      if (row) row.accountStatus = body.accountStatus
      return send({ success: true, data: row })
    }
    const activationMatch = path.match(/\/api\/crm\/admin\/team\/([^/]+)\/activate$/)
    if (activationMatch && request.method() === 'POST') {
      const row = rows.find((item) => item.id === decodeURIComponent(activationMatch[1]))
      if (!row) return send({ success: false, error: 'Membro não encontrado' }, 404)
      row.accountStatus = 'ACTIVE'
      row.provisioningState = 'COMPLETED'
      return send({ success: true, data: row })
    }
    const inviteMatch = path.match(/\/api\/crm\/admin\/team\/([^/]+)\/invite\/(resend|revoke)$/)
    if (inviteMatch && request.method() === 'POST') {
      const row = rows.find((item) => item.id === decodeURIComponent(inviteMatch[1]))
      if (row) row.accountStatus = inviteMatch[2] === 'resend' ? 'INVITED' : 'PENDING_ACCESS'
      return send({ success: true, data: row })
    }
    const accountLinkReviewMatch = path.match(/\/api\/crm\/admin\/team\/([^/]+)\/account-link\/([^/]+)\/review$/)
    if (accountLinkReviewMatch && request.method() === 'POST') {
      const body = await json(); const row = rows.find((item) => item.id === decodeURIComponent(accountLinkReviewMatch[1]))
      if (!row || row.crmAccountLinkId !== decodeURIComponent(accountLinkReviewMatch[2])) return send({ success: false, error: 'Vínculo da conta não encontrado' }, 404)
      row.crmAccountReviewStatus = body.reviewStatus
      row.crmAccountLinked = body.reviewStatus === 'CONFIRMED'
      return send({ success: true, data: { id: row.crmAccountLinkId, crmUsername: row.crmAccountUsername, reviewStatus: row.crmAccountReviewStatus } })
    }
    const scheduleSyncMatch = path.match(/\/api\/crm\/admin\/team\/([^/]+)\/schedule-sync$/)
    if (scheduleSyncMatch && request.method() === 'POST') {
      const body = await json(); const row = rows.find((item) => item.id === decodeURIComponent(scheduleSyncMatch[1]))
      if (!row) return send({ success: false, error: 'Membro não encontrado' }, 404)
      row.scheduleSync = { ...(row.scheduleSync || {}), state: body.state, professionalId: body.professionalId || row.scheduleSync?.professionalId || null, errorCode: body.errorCode || null, attempt: (row.scheduleSync?.attempt || 0) + 1 }
      if (body.state === 'SYNCED' && body.professionalId) row.schedule.professionalId = body.professionalId
      return send({ success: true, data: { scheduleSync: row.scheduleSync } })
    }
    const linkReviewMatch = path.match(/\/api\/crm\/admin\/team\/([^/]+)\/links\/([^/]+)\/review$/)
    if (linkReviewMatch && request.method() === 'POST') {
      const body = await json(); const row = rows.find((item) => item.id === decodeURIComponent(linkReviewMatch[1]))
      const link = row?.identityLinks.find((item) => item.id === decodeURIComponent(linkReviewMatch[2]))
      if (!row || !link) return send({ success: false, error: 'Vínculo não encontrado' }, 404)
      link.reviewStatus = body.reviewStatus
      if (body.reviewStatus === 'CONFIRMED' && link.source === 'ESCALA') row.schedule.professionalId = link.sourceId
      return send({ success: true, data: link })
    }
    const linksMatch = path.match(/\/api\/crm\/admin\/team\/([^/]+)\/links$/)
    if (linksMatch) {
      const row = rows.find((item) => item.id === decodeURIComponent(linksMatch[1]))
      if (!row) return send({ success: false, error: 'Membro não encontrado' }, 404)
      if (request.method() === 'GET') return send({ success: true, data: row.identityLinks })
      const body = await json()
      const link = { id: `e2e-link-${body.sourceId}`, source: body.source, sourceId: body.sourceId, reviewStatus: body.reviewStatus || 'PENDING_REVIEW', matchMethod: body.matchMethod || 'EXPLICIT_WORKFORCE_ID', confidence: body.confidence || 'HIGH' }
      row.identityLinks.push(link)
      if (body.source === 'ESCALA' && body.reviewStatus === 'CONFIRMED') row.schedule.professionalId = body.sourceId
      return send({ success: true, data: link })
    }
    const historyMatch = path.match(/\/api\/crm\/admin\/team\/([^/]+)\/history$/)
    if (historyMatch && request.method() === 'GET') {
      return send({ success: true, data: [{ id: 'e2e-history-ana', timestamp: '2026-08-05T12:00:00.000Z', actor: 'users-e2e', role: 'GESTOR', action: 'EMPLOYEE_TEAM_UPDATED', after: { profile: 'INJETOR', units: ['novo-hamburgo'] } }], summary: { count: 1, limit: 50 } })
    }
    const memberMatch = path.match(/\/api\/crm\/admin\/team\/([^/]+)$/)
    if (memberMatch && request.method() === 'PUT') {
      const body = await json(); const row = rows.find((item) => item.id === decodeURIComponent(memberMatch[1]))
      if (row) Object.assign(row, { fullName: body.fullName || row.fullName, department: body.department || row.department, units: body.units || row.units, jobTitle: body.jobTitle || row.jobTitle })
      return send({ success: true, data: row })
    }
    return send({ ok: true, success: true, data: [], total: 0, summary: {} })
  })
}
