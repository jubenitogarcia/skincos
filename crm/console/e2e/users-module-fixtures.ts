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
  provisioningState: string
  schedule: { professionalId: string | null; status: string; role: string; shift: string; nickname: string; instagram: string; color: string; units: string[] }
  identityLinks: Array<{ id: string; source: string; sourceId: string; reviewStatus: string; matchMethod: string; confidence: string }>
}

export const syntheticTeam: MockTeamMember[] = [
  {
    id: 'e2e-ana', fullName: 'Ana Ribeiro', username: 'anaribeiro', corporateEmail: 'anaribeiro@espacofacial.com', workforceEmployeeId: 'e2e-wf-ana', profile: 'INJETOR', jobTitle: 'Injetor', department: 'Atendimento Local', units: ['novo-hamburgo'], accountStatus: 'ACTIVE', provisioningState: 'COMPLETED',
    schedule: { professionalId: 'e2e-escala-ana', status: 'Ativo', role: 'Injetor', shift: 'Integral', nickname: 'Ana', instagram: 'ana.ribeiro', color: '#22c55e', units: ['novo-hamburgo'] },
    identityLinks: [{ id: 'e2e-link-ana', source: 'ATENDIMENTO', sourceId: 'e2e-atendimento-ana', reviewStatus: 'CONFIRMED', matchMethod: 'EXPLICIT_WORKFORCE_ID', confidence: 'HIGH' }],
  },
  {
    id: 'e2e-lucas', fullName: 'Lucas Mendes', username: 'lucasmendes', corporateEmail: 'lucasmendes@espacofacial.com', workforceEmployeeId: 'e2e-wf-lucas', profile: 'CONSULTOR', jobTitle: 'Consultor', department: 'Comercial', units: ['novo-hamburgo', 'barra-shopping-sul'], accountStatus: 'INVITED', provisioningState: 'COMPLETED',
    schedule: { professionalId: null, status: 'Ativo', role: 'Consultor', shift: 'Comercial', nickname: 'Lucas', instagram: 'lucas.mendes', color: '#6d9eeb', units: ['novo-hamburgo', 'barra-shopping-sul'] },
    identityLinks: [],
  },
  {
    id: 'e2e-carla', fullName: 'Carla Souza', username: 'carlasouza', corporateEmail: 'carlasouza@espacofacial.com', workforceEmployeeId: 'e2e-wf-carla', profile: 'SUPERVISOR', jobTitle: 'Coordenador', department: 'Operações', units: ['barra-shopping-sul'], accountStatus: 'SUSPENDED', provisioningState: 'COMPLETED',
    schedule: { professionalId: null, status: 'Ativo', role: 'Coordenador', shift: 'Tarde', nickname: 'Carla', instagram: 'carla.souza', color: '#f97316', units: ['barra-shopping-sul'] },
    identityLinks: [{ id: 'e2e-link-carla', source: 'ESCALA', sourceId: 'e2e-escala-carla', reviewStatus: 'PENDING_REVIEW', matchMethod: 'EXPLICIT_WORKFORCE_ID', confidence: 'LOW' }],
  },
]

function cloneRows() {
  return syntheticTeam.map((row) => ({ ...row, units: [...row.units], schedule: { ...row.schedule, units: [...row.schedule.units] }, identityLinks: row.identityLinks.map((link) => ({ ...link })) }))
}

export async function mockUsersApi(page: Page, role = 'GESTOR') {
  const rows = cloneRows()
  await page.route('**/api/**', async (route: Route) => {
    const request = route.request()
    const url = new URL(request.url())
    const path = url.pathname
    const json = async () => { try { return request.postDataJSON() } catch { return {} } }
    const send = (body: unknown, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) })

    if (path.endsWith('/api/auth/me')) return send({ ok: true, success: true, user: { username: 'users-e2e', email: 'users-e2e@staging.invalid', role, allowedUnits: ['novo-hamburgo', 'barra-shopping-sul'], allowedModules: ['atendimento'] }, csrfToken: 'users-e2e-csrf' })
    if (path.endsWith('/api/crm/admin/team') && request.method() === 'GET' && url.searchParams.get('mode') === 'config') return send({ success: true, data: { enabled: true, legacyEscalaEditor: false } })
    if (path.endsWith('/api/crm/admin/team') && request.method() === 'GET') {
      const status = (url.searchParams.get('status') || 'ACTIVE').toUpperCase()
      const query = (url.searchParams.get('q') || '').toLowerCase()
      const data = rows.filter((row) => status === 'ALL' || status === 'ACTIVE' ? ['ACTIVE', 'INVITED'].includes(row.accountStatus) : row.accountStatus === status).filter((row) => !query || [row.fullName, row.username, row.corporateEmail, row.department, row.jobTitle, ...row.units].some((value) => value.toLowerCase().includes(query)))
      const pendingItems = data.flatMap((row) => row.identityLinks.filter((link) => link.reviewStatus === 'PENDING_REVIEW').map((link) => ({ memberId: row.id, kind: 'IDENTITY_LINK', source: link.source, status: link.reviewStatus })))
      return send({ success: true, data, pendingItems, summary: { members: data.length, pendingInvites: data.filter((row) => row.accountStatus === 'INVITED').length, pendingLinks: pendingItems.length, pendingProvisioning: 0 } })
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
    const inviteMatch = path.match(/\/api\/crm\/admin\/team\/([^/]+)\/invite\/(resend|revoke)$/)
    if (inviteMatch && request.method() === 'POST') {
      const row = rows.find((item) => item.id === decodeURIComponent(inviteMatch[1]))
      if (row) row.accountStatus = inviteMatch[2] === 'resend' ? 'INVITED' : 'PENDING_ACCESS'
      return send({ success: true, data: row })
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
