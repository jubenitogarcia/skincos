import React from 'react'
import { Ban, CircleAlert, ListChecks, Mail, Pencil, Power, Search, ShieldCheck, UsersRound } from 'lucide-react'
import { toast } from 'sonner'
import { addEscalaProfessional, updateEscalaProfessional } from '@/escalaApi'
import { Badge } from '@/badge'
import { Button } from '@/button'
import { Card, CardContent, CardHeader } from '@/card'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/dialog'
import { getCsrfToken } from '@/csrf'
import { Input } from '@/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/select'
import { buildCorporateEmail, suggestUsername, type UnifiedTeamConfig, type UnifiedTeamMember } from '@/teamApi'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/tabs'
import { TooltipButton } from '@/tooltip'

type Me = { success?: boolean; user?: { username?: string; role?: string; allowedUnits?: string[] }; csrfToken?: string }
type Onboarding = { id: string; fullName: string; username?: string | null; corporateEmail: string; workforceEmployeeId?: string | null; profile: string; jobTitle: string; department: string; units: string[]; accountStatus: string; createdAt?: string; updatedAt?: string }
type ApiError = { error?: string; message?: string; code?: string }
type RequestOptions = { method?: string; body?: unknown; csrf?: string | null; headers?: Record<string, string> }
type TeamPendingItem = { memberId: string; kind: 'PROVISIONING' | 'IDENTITY_LINK' | 'ESCALA_LINK'; source?: string; status: string }
type TeamSummary = { members?: number; pendingLinks?: number; pendingProvisioning?: number; pendingInvites?: number; pendingItems?: TeamPendingItem[] }
type TeamHistoryEntry = { id: string | number; timestamp?: string | null; actor?: string; role?: string; action?: string; entity?: string; before?: Record<string, unknown> | null; after?: Record<string, unknown> | null }

class RequestError extends Error {
  code?: string

  constructor(message: string, code?: string) {
    super(message)
    this.name = 'RequestError'
    this.code = code
  }
}

const unitLabels: Record<string, string> = { 'novo-hamburgo': 'Novo Hamburgo', 'barra-shopping-sul': 'Barra Shopping Sul' }
const titleOptions = ['Gestor', 'Gerente', 'Coordenador', 'Responsável Técnico', 'Injetor', 'Consultor']
const creatableTitlesByRole: Record<string, string[]> = {
  ADMIN: titleOptions,
  GESTOR: ['Gerente', 'Coordenador', 'Responsável Técnico', 'Injetor', 'Consultor'],
  GERENTE: ['Coordenador', 'Responsável Técnico', 'Injetor', 'Consultor'],
}

const initialForm = {
  fullName: '',
  username: '',
  corporateEmailOverride: '',
  personalEmail: '',
  mobilePhone: '',
  department: '',
  jobTitle: 'Consultor',
  units: [] as string[],
  scheduleProfessionalId: '',
  scheduleStatus: 'Ativo',
  scheduleRole: 'Injetor',
  scheduleShift: '',
  scheduleNickname: '',
  scheduleInstagram: '',
  scheduleColor: '',
}

async function api<T>(path: string, opts: RequestOptions = {}): Promise<T> {
  const headers: Record<string, string> = { Accept: 'application/json', ...(opts.headers || {}) }
  if (opts.body !== undefined) headers['content-type'] = 'application/json'
  const csrf = getCsrfToken() || opts.csrf
  if (csrf) headers['x-csrf-token'] = csrf
  const target = path.startsWith('/auth/') ? `/api/auth${path.slice('/auth'.length)}` : `/api/crm${path}`
  const res = await fetch(target, {
    method: opts.method || 'GET',
    headers,
    credentials: 'include',
    body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
  })
  const payload = await res.json().catch(() => ({})) as T & ApiError
  if (!res.ok) throw new RequestError(payload.error || payload.message || `HTTP ${res.status}`, payload.code)
  return payload
}

function emptyTeamForm(row?: UnifiedTeamMember) {
  return {
    ...initialForm,
    fullName: row?.fullName || '',
    username: row?.username || '',
    // Keep the persisted login address while a name is edited. The corporate
    // address is immutable after the invite and must not be recalculated in
    // the request just because the display name changed.
    corporateEmailOverride: row?.corporateEmail || '',
    personalEmail: '',
    mobilePhone: row?.schedule?.phone || '',
    department: row?.department || '',
    jobTitle: row?.jobTitle || 'Consultor',
    units: row?.units || [],
    scheduleProfessionalId: row?.schedule?.professionalId || '',
    scheduleStatus: row?.schedule?.status || 'Ativo',
    scheduleRole: row?.schedule?.role || 'Injetor',
    scheduleShift: row?.schedule?.shift || '',
    scheduleNickname: row?.schedule?.nickname || '',
    scheduleInstagram: row?.schedule?.instagram || '',
    scheduleColor: row?.schedule?.color || '',
  }
}

function statusLabel(status: string) {
  return ({ INVITED: 'Convite enviado', ACTIVE: 'Ativo', SUSPENDED: 'Suspenso', TERMINATED: 'Desativado', PENDING_ACCESS: 'Aguardando acesso' } as Record<string, string>)[status] || status
}

type BadgeVariant = 'default' | 'secondary' | 'destructive' | 'outline' | 'success' | 'warning' | 'premium'

function statusBadgeVariant(status: string): BadgeVariant {
  if (status === 'ACTIVE') return 'success'
  if (status === 'INVITED' || status === 'PENDING_ACCESS') return 'warning'
  if (status === 'SUSPENDED' || status === 'TERMINATED') return 'destructive'
  return 'secondary'
}

function titleBadgeVariant(title: string): BadgeVariant {
  if (title === 'Gestor') return 'premium'
  if (title === 'Gerente' || title === 'Coordenador') return 'default'
  if (title === 'Responsável Técnico') return 'warning'
  if (title === 'Injetor') return 'success'
  return 'secondary'
}

function memberInitials(fullName: string) {
  return String(fullName || '')
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() || '')
    .join('') || '?'
}

function pendingItemLabel(item: TeamPendingItem) {
  if (item.kind === 'IDENTITY_LINK') return item.source === 'ATENDIMENTO' ? 'Vínculo do Atendimento' : 'Vínculo da Escala'
  if (item.kind === 'PROVISIONING') return 'Provisionamento'
  return 'Vínculo da Escala'
}

function historyActionLabel(action: string) {
  return ({
    EMPLOYEE_TEAM_CREATED: 'Cadastro criado',
    EMPLOYEE_TEAM_UPDATED: 'Cadastro atualizado',
    EMPLOYEE_TEAM_STATUS_CHANGED: 'Status alterado',
    EMPLOYEE_TEAM_BULK_STATUS_CHANGED: 'Status alterado em lote',
    EMPLOYEE_TEAM_INVITE_RESENT: 'Convite reenviado',
    EMPLOYEE_TEAM_INVITE_REVOKED: 'Convite revogado',
    EMPLOYEE_ONBOARDING_STATUS_CHANGED: 'Status alterado',
    EMPLOYEE_ONBOARDING_ACTIVATION_RETRY: 'Ativação processada',
    EMPLOYEE_IDENTITY_LINK_CREATED: 'Vínculo operacional criado',
  } as Record<string, string>)[String(action || '').toUpperCase()] || String(action || 'Alteração registrada')
}

function historyChange(entry: TeamHistoryEntry) {
  const after = entry.after && typeof entry.after === 'object' ? entry.after : {}
  const accountStatus = after.accountStatus || after.status
  if (accountStatus) return `Conta: ${statusLabel(String(accountStatus))}`
  const profile = after.profile || after.jobTitle
  const units = Array.isArray(after.units) ? after.units.map((unit) => unitLabels[String(unit)] || String(unit)).join(', ') : ''
  if (profile || units) return [profile ? `Cargo: ${String(profile)}` : '', units ? `Unidades: ${units}` : ''].filter(Boolean).join(' · ')
  const source = after.source
  const reviewStatus = after.reviewStatus
  if (source || reviewStatus) return [`Vínculo: ${String(source || 'operacional')}`, reviewStatus ? String(reviewStatus) : ''].filter(Boolean).join(' · ')
  if (after.inviteIssued) return 'Convite emitido'
  if (after.inviteRevoked) return 'Acesso aguardando novo convite'
  return 'Alteração registrada'
}

function historyTimestamp(timestamp?: string | null) {
  if (!timestamp) return 'Data não informada'
  const date = new Date(timestamp)
  return Number.isNaN(date.getTime()) ? 'Data não informada' : date.toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })
}

export function UsersModule() {
  const [me, setMe] = React.useState<Me | null>(null)
  const [teamRows, setTeamRows] = React.useState<UnifiedTeamMember[]>([])
  const [teamConfig, setTeamConfig] = React.useState<UnifiedTeamConfig>({ enabled: false, legacyEscalaEditor: true })
  const [open, setOpen] = React.useState(false)
  const [loading, setLoading] = React.useState(true)
  const [saving, setSaving] = React.useState(false)
  const [editingId, setEditingId] = React.useState<string | null>(null)
  const [editingOriginalName, setEditingOriginalName] = React.useState('')
  const [collisionRequired, setCollisionRequired] = React.useState(false)
  const [form, setForm] = React.useState(initialForm)
  const [statusFilter, setStatusFilter] = React.useState('ACTIVE')
  const [searchQuery, setSearchQuery] = React.useState('')
  const [searchInput, setSearchInput] = React.useState('')
  const [summary, setSummary] = React.useState<TeamSummary>({})
  const [selectedIds, setSelectedIds] = React.useState<string[]>([])
  const [bulkSaving, setBulkSaving] = React.useState(false)
  const [formTab, setFormTab] = React.useState('identity')
  const [historyRows, setHistoryRows] = React.useState<TeamHistoryEntry[]>([])
  const [historyLoading, setHistoryLoading] = React.useState(false)
  const [historyError, setHistoryError] = React.useState('')
  const usernameWasEdited = React.useRef(false)

  const role = String(me?.user?.role || '').toUpperCase()
  const actorUnits = Array.isArray(me?.user?.allowedUnits) ? me!.user!.allowedUnits!.filter(Boolean) : []
  const canManage = ['ADMIN', 'GESTOR', 'GERENTE'].includes(role) && (role === 'ADMIN' || actorUnits.length > 0)
  const selectableUnits = role === 'ADMIN' ? Object.keys(unitLabels) : actorUnits
  const selectableTitles = creatableTitlesByRole[role] || []
  const generatedEmail = buildCorporateEmail(form.fullName)
  const effectiveEmail = form.corporateEmailOverride.trim().toLowerCase() || generatedEmail
  const editingRow = editingId ? teamRows.find((row) => row.id === editingId) || null : null
  const editingIsSuspended = editingRow?.accountStatus === 'SUSPENDED'
  const unitCount = new Set(teamRows.flatMap((row) => row.units)).size
  const canRead = ['ADMIN', 'GESTOR', 'GERENTE', 'SUPERVISOR'].includes(role)
  const formReadOnly = !canManage
  const editTitles = Array.from(new Set([editingRow?.jobTitle, ...selectableTitles].filter((value): value is string => Boolean(value))))

  const load = React.useCallback(async () => {
    setLoading(true)
    try {
      const auth = await api<Me>('/auth/me').catch(() => null)
      setMe(auth)
      if (!auth?.user?.username) return
      const configResult = await api<{ success?: boolean; data?: UnifiedTeamConfig }>('/admin/team?mode=config', { csrf: auth.csrfToken }).catch(() => null)
      const config = configResult?.data || { enabled: false, legacyEscalaEditor: true }
      setTeamConfig(config)
      if (config.enabled) {
        const params = new URLSearchParams()
        if (statusFilter) params.set('status', statusFilter)
        if (searchQuery.trim()) params.set('q', searchQuery.trim())
        const result = await api<{ success?: boolean; data?: UnifiedTeamMember[]; summary?: TeamSummary; pendingItems?: TeamPendingItem[] }>(`/admin/team?${params.toString()}`, { csrf: auth.csrfToken }).catch(() => null)
        const members = Array.isArray(result?.data) ? result!.data! : []
        setTeamRows(members)
        setSelectedIds((current) => current.filter((id) => members.some((member) => member.id === id)))
        setSummary({ ...(result?.summary || { members: members.length }), pendingItems: result?.pendingItems || result?.summary?.pendingItems || [] })
      } else {
        const params = new URLSearchParams({ status: statusFilter || 'ALL' })
        if (searchQuery.trim()) params.set('q', searchQuery.trim())
        const result = await api<{ success?: boolean; data?: Onboarding[]; summary?: TeamSummary }>(`/admin/onboarding?${params.toString()}`, { csrf: auth.csrfToken }).catch(() => null)
        const legacyRows = Array.isArray(result?.data) ? result!.data! : []
        setTeamRows(legacyRows.map((row) => ({ ...row, schedule: undefined, identityLinks: [] })))
        setSelectedIds([])
        setSummary(result?.summary || { members: legacyRows.length })
      }
    } finally {
      setLoading(false)
    }
  }, [searchQuery, statusFilter])

  React.useEffect(() => { void load() }, [load])

  React.useEffect(() => {
    const timer = window.setTimeout(() => setSearchQuery(searchInput), 250)
    return () => window.clearTimeout(timer)
  }, [searchInput])

  const loadHistory = React.useCallback(async (memberId: string) => {
    setHistoryLoading(true)
    setHistoryError('')
    try {
      const result = await api<{ success?: boolean; data?: TeamHistoryEntry[] }>(`/admin/team/${encodeURIComponent(memberId)}/history`, { csrf: me?.csrfToken })
      setHistoryRows(Array.isArray(result?.data) ? result.data : [])
    } catch (error: any) {
      setHistoryRows([])
      setHistoryError(error?.message || 'O histórico está indisponível no momento.')
    } finally {
      setHistoryLoading(false)
    }
  }, [me?.csrfToken])

  React.useEffect(() => {
    if (!open || !editingId || !teamConfig.enabled) {
      setHistoryRows([])
      setHistoryError('')
      setHistoryLoading(false)
      return
    }
    void loadHistory(editingId)
  }, [open, editingId, teamConfig.enabled, loadHistory])

  const updateField = (field: keyof typeof initialForm, value: string | string[]) => setForm((current) => ({ ...current, [field]: value }))
  const toggleUnit = (unit: string) => setForm((current) => ({ ...current, units: current.units.includes(unit) ? current.units.filter((item) => item !== unit) : [...current.units, unit] }))

  const openCreate = React.useCallback(() => {
    const defaultTitle = selectableTitles[selectableTitles.length - 1] || 'Consultor'
    const defaultUnits = selectableUnits.length === 1 ? selectableUnits : []
    setEditingId(null)
    setEditingOriginalName('')
    setCollisionRequired(false)
    usernameWasEdited.current = false
    setFormTab('identity')
    setHistoryRows([])
    setHistoryError('')
    setForm({ ...initialForm, jobTitle: defaultTitle, units: defaultUnits })
    setOpen(true)
  }, [selectableTitles, selectableUnits])

  const openEdit = (row: UnifiedTeamMember) => {
    setEditingId(row.id)
    setEditingOriginalName(row.fullName)
    setCollisionRequired(false)
    usernameWasEdited.current = true
    setFormTab('identity')
    setHistoryRows([])
    setHistoryError('')
    setForm(emptyTeamForm(row))
    setOpen(true)
  }

  React.useEffect(() => {
    const onHeaderAction = (event: Event) => {
      const action = (event as CustomEvent<{ action?: string }>).detail?.action
      if (action === 'refresh') void load()
      if (action === 'create' && canManage) openCreate()
    }
    window.addEventListener('skincos:users:header-action', onHeaderAction)
    return () => window.removeEventListener('skincos:users:header-action', onHeaderAction)
  }, [canManage, load, openCreate])

  const linkEscalaMember = async (member: UnifiedTeamMember, schedule: { professionalId?: string; workforceEmployeeId?: string | null }) => {
    const professionalId = String(schedule.professionalId || '').trim()
    if (!professionalId || !member.workforceEmployeeId) return true
    try {
      await api(`/admin/team/${encodeURIComponent(member.id)}/links`, {
        method: 'POST',
        csrf: me?.csrfToken,
        body: { source: 'ESCALA', sourceId: professionalId, matchMethod: 'EXPLICIT_WORKFORCE_ID', confidence: 'HIGH', reviewStatus: 'CONFIRMED' },
      })
      return true
    } catch (error: any) {
      toast.warning(`Cadastro salvo, mas o vínculo com a Escala ficou pendente: ${error?.message || 'tente novamente'}.`)
      return false
    }
  }

  const syncEscala = async (member: UnifiedTeamMember, created: boolean) => {
    if (!teamConfig.enabled || !member.workforceEmployeeId) return
    const schedulePayload = {
      name: form.fullName,
      status: form.scheduleStatus,
      units: form.units,
      role: form.scheduleRole,
      shift: form.scheduleShift,
      nickname: form.scheduleNickname,
      phone: form.mobilePhone || member.schedule?.phone || undefined,
      email: effectiveEmail,
      instagram: form.scheduleInstagram,
      color: form.scheduleColor,
      workforceEmployeeId: member.workforceEmployeeId,
    }
    const hasScheduleLink = Boolean(member.schedule?.professionalId)
    const result = created || !hasScheduleLink
      ? await addEscalaProfessional(schedulePayload)
      : await updateEscalaProfessional({ currentName: editingOriginalName, ...schedulePayload })
    if (!result.ok) {
      toast.warning(`Cadastro salvo, mas a Escala ficou pendente: ${result.error || 'tente novamente'}.`)
      return
    }
    const professionalId = result.data?.professionalId
    if (professionalId) await linkEscalaMember(member, { professionalId })
  }

  const submit = async () => {
    if (!canManage) return
    const username = form.username.trim() || suggestUsername(form.fullName, effectiveEmail)
    if (!form.fullName.trim() || !username || !effectiveEmail || (!editingId && (!form.personalEmail.trim() || !form.mobilePhone.trim())) || !form.department.trim() || !form.units.length) {
      toast.error('Preencha nome, usuário, e-mails, telefone, departamento e ao menos uma unidade.')
      return
    }
    setSaving(true)
    try {
      const body = {
        fullName: form.fullName,
        username,
        corporateEmail: effectiveEmail,
        ...(form.personalEmail.trim() ? { personalEmail: form.personalEmail } : {}),
        ...(form.mobilePhone.trim() ? { mobilePhone: form.mobilePhone } : {}),
        department: form.department,
        jobTitle: form.jobTitle,
        units: form.units,
        team: {
          professionalId: form.scheduleProfessionalId,
          status: form.scheduleStatus,
          role: form.scheduleRole,
          shift: form.scheduleShift,
          nickname: form.scheduleNickname,
          instagram: form.scheduleInstagram,
          color: form.scheduleColor,
          units: form.units,
        },
      }
      const endpoint = teamConfig.enabled && editingId ? `/admin/team/${encodeURIComponent(editingId)}` : teamConfig.enabled ? '/admin/team' : '/admin/onboarding'
      const result = await api<{ data?: Onboarding & UnifiedTeamMember; replayed?: boolean }>(endpoint, {
        method: editingId ? 'PUT' : 'POST',
        csrf: me?.csrfToken,
        headers: editingId ? {} : { 'idempotency-key': `crm-team-${Date.now()}-${Math.random().toString(16).slice(2)}` },
        body,
      })
      if (result.data && teamConfig.enabled && !result.replayed) {
        await syncEscala(result.data as UnifiedTeamMember, !editingId)
      }
      setCollisionRequired(false)
      setForm(initialForm)
      setEditingId(null)
      setOpen(false)
      toast.success(editingId ? 'Membro atualizado.' : 'Cadastro criado; convite enviado para o e-mail pessoal.')
      await load()
    } catch (error: any) {
      if (error instanceof RequestError && (error.code === 'EMAIL_TAKEN' || error.code === 'CORPORATE_EMAIL_OVERRIDE_REQUIRES_COLLISION')) {
        setCollisionRequired(true)
        toast.error('O e-mail calculado já está em uso. Informe um ajuste explícito, como um sufixo numérico.')
      } else if (error instanceof RequestError && error.code === 'USERNAME_TAKEN') {
        toast.error('Esse nome de usuário já está reservado. Escolha outro.')
      } else {
        toast.error(error?.message || 'Não foi possível concluir o cadastro.')
      }
    } finally {
      setSaving(false)
    }
  }

  const changeStatus = async (row: UnifiedTeamMember, nextStatus: 'ACTIVE' | 'SUSPENDED' | 'TERMINATED') => {
    const activating = nextStatus === 'ACTIVE'
    const actionLabel = nextStatus === 'TERMINATED' ? 'desativar permanentemente' : activating ? 'ativar' : 'suspender'
    if (!teamConfig.enabled || !window.confirm(`${actionLabel[0].toUpperCase() + actionLabel.slice(1)} ${row.fullName}?${nextStatus === 'TERMINATED' ? ' O acesso será encerrado e o histórico preservado.' : activating ? '' : ' O histórico e a agenda serão preservados.'}`)) return
    try {
      await api(`/admin/team/${encodeURIComponent(row.id)}/status`, { method: 'POST', csrf: me?.csrfToken, body: { accountStatus: nextStatus } })
      toast.success(nextStatus === 'TERMINATED' ? 'Membro desativado; histórico preservado.' : activating ? 'Membro ativado.' : 'Membro suspenso; histórico preservado.')
      setOpen(false)
      setEditingId(null)
      await load()
    } catch (error: any) {
      toast.error(error?.message || `Não foi possível ${activating ? 'ativar' : 'desativar'} o membro.`)
    }
  }

  const changeInvite = async (row: UnifiedTeamMember, action: 'resend' | 'revoke') => {
    if (!teamConfig.enabled) return
    const label = action === 'resend' ? 'Reenviar o convite' : 'Revogar o convite'
    if (!window.confirm(`${label} de ${row.fullName}?`)) return
    try {
      await api(`/admin/team/${encodeURIComponent(row.id)}/invite/${action}`, { method: 'POST', csrf: me?.csrfToken })
      toast.success(action === 'resend' ? 'Convite reenviado.' : 'Convite revogado; acesso aguardando novo convite.')
      setOpen(false)
      setEditingId(null)
      await load()
    } catch (error: any) {
      toast.error(error?.message || `Não foi possível ${action === 'resend' ? 'reenviar' : 'revogar'} o convite.`)
    }
  }

  const toggleSelected = (id: string) => setSelectedIds((current) => current.includes(id) ? current.filter((item) => item !== id) : [...current, id])
  const bulkEligibleRows = teamRows.filter((row) => ['ACTIVE', 'SUSPENDED'].includes(String(row.accountStatus || '').toUpperCase()))
  const allBulkEligibleSelected = bulkEligibleRows.length > 0 && bulkEligibleRows.every((row) => selectedIds.includes(row.id))

  const bulkChangeStatus = async (nextStatus: 'ACTIVE' | 'SUSPENDED') => {
    if (!canManage || !teamConfig.enabled) return
    const ids = selectedIds.filter((id) => bulkEligibleRows.some((row) => row.id === id))
    if (!ids.length) return
    const label = nextStatus === 'ACTIVE' ? 'ativar' : 'suspender'
    if (!window.confirm(`Deseja ${label} ${ids.length} membro${ids.length === 1 ? '' : 's'}? O histórico e os vínculos serão preservados.`)) return
    setBulkSaving(true)
    try {
      await api('/admin/team/bulk-status', {
        method: 'POST',
        csrf: me?.csrfToken,
        headers: { 'idempotency-key': `crm-team-bulk-${Date.now()}-${Math.random().toString(16).slice(2)}` },
        body: { ids, accountStatus: nextStatus },
      })
      setSelectedIds([])
      toast.success(`${ids.length} membro${ids.length === 1 ? '' : 's'} ${nextStatus === 'ACTIVE' ? 'ativado' : 'suspenso'}${ids.length === 1 ? '' : 's'}.`)
      await load()
    } catch (error: any) {
      toast.error(error?.message || 'A ação em lote ficou pendente de sincronização.')
      await load()
    } finally {
      setBulkSaving(false)
    }
  }

  return (
    <div className="space-y-4 p-4 sm:space-y-6 sm:p-6">
      <div className="mx-auto max-w-7xl space-y-4">
        {!teamConfig.enabled && (
          <Card className="border-amber-300/20 bg-amber-500/10">
            <CardContent className="p-4 text-sm text-amber-50/90">
              A centralização da equipe está preparada, mas a flag de liberação ainda está desligada. A Escala continua com o editor antigo como contingência controlada.
            </CardContent>
          </Card>
        )}

        <Card className="overflow-hidden border border-white/10 bg-gradient-to-br from-white/[0.045] via-black/20 to-white/[0.02] shadow-[0_20px_60px_rgba(2,8,23,0.18)]">
          <CardHeader className="border-b border-white/[0.06] px-4 py-4 sm:px-5">
            <div className="flex flex-wrap items-center justify-between gap-4">
              <div className="flex min-w-0 items-center gap-3">
                <div className="flex size-10 shrink-0 items-center justify-center rounded-2xl border border-sky-200/15 bg-sky-400/10 text-sky-200 shadow-inner shadow-sky-950/20">
                  <UsersRound className="size-5" aria-hidden="true" />
                </div>
                <div className="min-w-0">
                  <h2 className="text-base font-semibold leading-tight text-white">Equipe</h2>
                  <p className="mt-1 truncate text-xs text-blue-100/60">Cadastro unificado de membros e vínculos.</p>
                </div>
              </div>
              <div className="flex items-center gap-2 text-xs text-blue-100/60">
                <span>{loading ? 'Atualizando' : `${teamRows.length} ${teamRows.length === 1 ? 'membro' : 'membros'}`}</span>
                <span className="size-1 rounded-full bg-white/25" aria-hidden="true" />
                <span>{unitCount} {unitCount === 1 ? 'unidade' : 'unidades'}</span>
              </div>
            </div>
          </CardHeader>
          <CardContent className="p-3 sm:p-5">
            {canRead && (
              <div className="mb-4 space-y-3">
                <div className="flex flex-col gap-2 lg:flex-row lg:items-center lg:justify-between">
                  <label className="relative min-w-0 flex-1 lg:max-w-md">
                    <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-blue-100/45" aria-hidden="true" />
                    <Input value={searchInput} onChange={(event) => setSearchInput(event.target.value)} placeholder="Buscar por nome, usuário, cargo ou unidade" className="pl-9" aria-label="Buscar equipe" />
                  </label>
                  <div className="flex flex-wrap items-center gap-2">
                    <Select value={statusFilter} onValueChange={setStatusFilter}>
                      <SelectTrigger className="w-full min-w-[170px] sm:w-[190px]" aria-label="Filtrar status"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="ACTIVE">Ativos e convites</SelectItem>
                        <SelectItem value="INVITED">Convites enviados</SelectItem>
                        <SelectItem value="PENDING_ACCESS">Aguardando convite</SelectItem>
                        <SelectItem value="SUSPENDED">Suspensos</SelectItem>
                        <SelectItem value="TERMINATED">Desativados</SelectItem>
                        <SelectItem value="ALL">Todos os estados</SelectItem>
                      </SelectContent>
                    </Select>
                    {(searchInput || searchQuery || statusFilter !== 'ACTIVE') && <Button type="button" variant="ghost" size="sm" onClick={() => { setSearchInput(''); setSearchQuery(''); setStatusFilter('ACTIVE') }}>Limpar</Button>}
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                  <div className="rounded-xl border border-white/10 bg-white/[0.025] px-3 py-2"><p className="text-[10px] uppercase tracking-[0.12em] text-blue-100/45">Exibidos</p><p className="mt-1 text-lg font-semibold text-white">{teamRows.length}</p></div>
                  <div className="rounded-xl border border-amber-300/15 bg-amber-400/[0.06] px-3 py-2"><p className="text-[10px] uppercase tracking-[0.12em] text-amber-100/55">Convites</p><p className="mt-1 text-lg font-semibold text-amber-50">{summary.pendingInvites || 0}</p></div>
                  <div className="rounded-xl border border-sky-300/15 bg-sky-400/[0.06] px-3 py-2"><p className="text-[10px] uppercase tracking-[0.12em] text-sky-100/55">Vínculos pendentes</p><p className="mt-1 text-lg font-semibold text-sky-50">{summary.pendingLinks || 0}</p></div>
                  <div className="rounded-xl border border-white/10 bg-white/[0.025] px-3 py-2"><p className="text-[10px] uppercase tracking-[0.12em] text-blue-100/45">Unidades</p><p className="mt-1 text-lg font-semibold text-white">{unitCount}</p></div>
                </div>
                {canManage && bulkEligibleRows.length > 0 && (
                  <div className="flex flex-col gap-2 rounded-2xl border border-white/10 bg-black/15 px-3 py-2.5 sm:flex-row sm:items-center sm:justify-between">
                    <label className="inline-flex items-center gap-2 text-xs text-blue-100/75">
                      <input type="checkbox" className="size-4 accent-sky-400" checked={allBulkEligibleSelected} onChange={() => setSelectedIds(allBulkEligibleSelected ? [] : bulkEligibleRows.map((row) => row.id))} aria-label="Selecionar membros ativos ou suspensos" />
                      {selectedIds.length ? `${selectedIds.length} selecionado${selectedIds.length === 1 ? '' : 's'}` : 'Selecionar membros para uma ação segura'}
                    </label>
                    {selectedIds.length > 0 && <div className="flex flex-wrap gap-2">
                      <Button type="button" size="sm" variant="outline" disabled={bulkSaving} onClick={() => void bulkChangeStatus('ACTIVE')}><ShieldCheck className="mr-2 size-4" aria-hidden="true" />Ativar</Button>
                      <Button type="button" size="sm" variant="outline" disabled={bulkSaving} onClick={() => void bulkChangeStatus('SUSPENDED')}><CircleAlert className="mr-2 size-4" aria-hidden="true" />Suspender</Button>
                    </div>}
                  </div>
                )}
                {(summary.pendingItems || []).length > 0 && (
                  <section className="rounded-2xl border border-amber-200/15 bg-amber-300/[0.045] px-3 py-3" aria-labelledby="team-pending-title">
                    <div className="flex items-start gap-2">
                      <ListChecks className="mt-0.5 size-4 shrink-0 text-amber-200" aria-hidden="true" />
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <h2 id="team-pending-title" className="text-sm font-semibold text-amber-50">Pendências para revisão</h2>
                          <span className="text-xs text-amber-100/60">{summary.pendingItems!.length} item{summary.pendingItems!.length === 1 ? '' : 's'}</span>
                        </div>
                        <div className="mt-2 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                          {summary.pendingItems!.slice(0, 6).map((item) => {
                            const member = teamRows.find((row) => row.id === item.memberId)
                            if (!member) return null
                            return <button key={`${item.memberId}-${item.kind}-${item.source || ''}`} type="button" className="flex min-w-0 items-center justify-between gap-3 rounded-xl border border-amber-100/10 bg-black/15 px-3 py-2 text-left transition hover:bg-amber-100/[0.08]" onClick={() => openEdit(member)}>
                              <span className="min-w-0"><span className="block truncate text-xs font-medium text-amber-50">{member.fullName}</span><span className="mt-0.5 block truncate text-[11px] text-amber-100/55">{pendingItemLabel(item)}</span></span>
                              <span className="shrink-0 text-[11px] text-amber-100/55">Revisar</span>
                            </button>
                          })}
                        </div>
                      </div>
                    </div>
                  </section>
                )}
              </div>
            )}
            <div className="hidden overflow-auto rounded-xl border border-white/10 md:block">
                <table className="w-full table-fixed text-sm">
                  <colgroup>
                  <col className="w-[4%]" />
                  <col className="w-[22%]" />
                  <col className="w-[12%]" />
                  <col className="w-[10%]" />
                  <col className="w-[12%]" />
                  <col className="w-[18%]" />
                  <col className="w-[10%]" />
                  <col className="w-[9%]" />
                  <col className="w-[7%]" />
                </colgroup>
                <thead className="bg-black/25 text-[11px] uppercase tracking-[0.12em] text-blue-100/60">
                  <tr>
                    <th className="p-3 text-left" scope="col"><span className="sr-only">Selecionar</span></th>
                    <th className="p-3 text-left" scope="col">Nome</th>
                    <th className="p-3 text-left" scope="col">Usuário</th>
                    <th className="p-3 text-left" scope="col">Cargo</th>
                    <th className="p-3 text-left" scope="col">Departamento</th>
                    <th className="p-3 text-left" scope="col">Unidades</th>
                    <th className="p-3 text-left" scope="col">Conta</th>
                    <th className="p-3 text-left" scope="col">Escala</th>
                    <th className="p-3 text-right" scope="col">Ações</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/5 text-blue-50">
                  {teamRows.map((row) => (
                    <tr key={row.id} className="transition-colors hover:bg-white/[0.035]">
                      <td className="p-3 align-middle">
                        {canManage && ['ACTIVE', 'SUSPENDED'].includes(String(row.accountStatus || '').toUpperCase()) && <input type="checkbox" className="size-4 accent-sky-400" checked={selectedIds.includes(row.id)} onChange={() => toggleSelected(row.id)} aria-label={`Selecionar ${row.fullName}`} />}
                      </td>
                      <td className="p-3 align-middle">
                        <div className="flex min-w-0 items-center gap-3">
                          <div className="flex size-9 shrink-0 items-center justify-center rounded-xl border border-white/15 bg-gradient-to-br from-sky-300/25 to-indigo-400/20 text-xs font-bold text-sky-50">{memberInitials(row.fullName)}</div>
                          <div className="min-w-0">
                            <span className="block truncate font-medium text-white">{row.fullName}</span>
                            <span className="mt-0.5 block truncate text-xs text-blue-100/50">{row.corporateEmail}</span>
                          </div>
                        </div>
                      </td>
                      <td className="p-3 align-middle font-mono text-xs text-blue-100/80">{row.username || '—'}</td>
                      <td className="p-3 align-middle"><Badge variant={titleBadgeVariant(row.jobTitle)} className="px-2 py-1 text-[11px]">{row.jobTitle}</Badge></td>
                      <td className="p-3 align-middle text-blue-100/80">{row.department || '—'}</td>
                      <td className="p-3 align-middle">
                        <div className="flex min-w-0 flex-wrap gap-1">
                          {row.units.length ? row.units.map((unit) => (
                            <Badge key={unit} variant="outline" className="px-2 py-1 text-[11px]">{unitLabels[unit] || unit}</Badge>
                          )) : <Badge variant="outline" className="px-2 py-1 text-[11px]">Sem unidade</Badge>}
                        </div>
                      </td>
                      <td className="p-3 align-middle"><Badge variant={statusBadgeVariant(row.accountStatus)} className="px-2 py-1 text-[11px]">{statusLabel(row.accountStatus)}</Badge></td>
                      <td className="p-3 align-middle"><Badge variant={row.schedule?.professionalId ? 'success' : 'outline'} className="px-2 py-1 text-[11px]">{row.schedule?.professionalId ? 'Vinculada' : 'Pendente'}</Badge></td>
                      <td className="p-3 text-right align-middle">
                        <TooltipButton label={`Editar ${row.fullName}`}>
                          <Button size="icon" variant="ghost" className="h-8 w-8 rounded-full text-blue-100 hover:bg-white/[0.10]" aria-label={`Editar ${row.fullName}`} onClick={() => openEdit(row)}>
                            <Pencil className="size-4" aria-hidden="true" />
                          </Button>
                        </TooltipButton>
                      </td>
                    </tr>
                  ))}
                  {!teamRows.length && (
                    <tr><td className="p-5 text-blue-100/70" colSpan={9}>{loading ? 'Carregando…' : teamConfig.enabled ? (searchQuery || statusFilter !== 'ACTIVE' ? 'Nenhum membro corresponde aos filtros.' : 'Nenhum integrante ativo.') : 'A lista aparecerá após a liberação da centralização.'}</td></tr>
                  )}
                </tbody>
              </table>
            </div>

            <div className="grid gap-3 md:hidden">
              {teamRows.map((row) => (
                <article key={row.id} className="rounded-2xl border border-white/10 bg-white/[0.025] p-4 shadow-lg shadow-black/10">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex min-w-0 items-center gap-3">
                      {canManage && ['ACTIVE', 'SUSPENDED'].includes(String(row.accountStatus || '').toUpperCase()) && <input type="checkbox" className="mt-1 size-4 shrink-0 accent-sky-400" checked={selectedIds.includes(row.id)} onChange={() => toggleSelected(row.id)} aria-label={`Selecionar ${row.fullName}`} />}
                      <div className="flex size-10 shrink-0 items-center justify-center rounded-xl border border-white/15 bg-gradient-to-br from-sky-300/25 to-indigo-400/20 text-xs font-bold text-sky-50">{memberInitials(row.fullName)}</div>
                      <div className="min-w-0">
                        <h2 className="truncate text-sm font-semibold text-white">{row.fullName}</h2>
                        <p className="truncate text-xs text-blue-100/55">{row.username || row.corporateEmail}</p>
                      </div>
                    </div>
                    <TooltipButton label={`Editar ${row.fullName}`}>
                      <Button size="icon" variant="ghost" className="h-8 w-8 shrink-0 rounded-full text-blue-100 hover:bg-white/[0.10]" aria-label={`Editar ${row.fullName}`} onClick={() => openEdit(row)}>
                        <Pencil className="size-4" aria-hidden="true" />
                      </Button>
                    </TooltipButton>
                  </div>
                  <div className="mt-4 grid grid-cols-2 gap-x-4 gap-y-4 border-t border-white/[0.07] pt-4 text-xs">
                    <div><p className="mb-1 text-[10px] uppercase tracking-[0.12em] text-blue-100/45">Cargo</p><Badge variant={titleBadgeVariant(row.jobTitle)} className="px-2 py-1 text-[11px]">{row.jobTitle}</Badge></div>
                    <div><p className="mb-1 text-[10px] uppercase tracking-[0.12em] text-blue-100/45">Departamento</p><p className="text-blue-100/80">{row.department || '—'}</p></div>
                    <div className="col-span-2"><p className="mb-1 text-[10px] uppercase tracking-[0.12em] text-blue-100/45">Unidades</p><div className="flex flex-wrap gap-1">{row.units.length ? row.units.map((unit) => <Badge key={unit} variant="outline" className="px-2 py-1 text-[11px]">{unitLabels[unit] || unit}</Badge>) : <Badge variant="outline" className="px-2 py-1 text-[11px]">Sem unidade</Badge>}</div></div>
                    <div><p className="mb-1 text-[10px] uppercase tracking-[0.12em] text-blue-100/45">Conta</p><Badge variant={statusBadgeVariant(row.accountStatus)} className="px-2 py-1 text-[11px]">{statusLabel(row.accountStatus)}</Badge></div>
                    <div><p className="mb-1 text-[10px] uppercase tracking-[0.12em] text-blue-100/45">Escala</p><Badge variant={row.schedule?.professionalId ? 'success' : 'outline'} className="px-2 py-1 text-[11px]">{row.schedule?.professionalId ? 'Vinculada' : 'Pendente'}</Badge></div>
                  </div>
                </article>
              ))}
              {!teamRows.length && <div className="rounded-2xl border border-dashed border-white/15 p-5 text-sm text-blue-100/70">{loading ? 'Carregando…' : teamConfig.enabled ? (searchQuery || statusFilter !== 'ACTIVE' ? 'Nenhum membro corresponde aos filtros.' : 'Nenhum integrante ativo.') : 'A lista aparecerá após a liberação da centralização.'}</div>}
            </div>
          </CardContent>
        </Card>
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[calc(100vh-1rem)] max-w-4xl overflow-y-auto border-white/10 bg-corporate-900 px-4 py-5 text-white dark sm:px-6">
          <DialogHeader className="border-b border-white/10 pb-4">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div className="min-w-0 flex-1">
                <DialogTitle>{editingId ? 'Editar membro da equipe' : 'Cadastro unificado de equipe'}</DialogTitle>
                <DialogDescription className="mt-1 text-blue-100/70">{editingId ? 'Atualize identidade, unidades e operação. A senha continua sob controle do funcionário.' : 'O e-mail corporativo será calculado e o convite enviado ao e-mail pessoal. A senha é criada pelo funcionário.'}</DialogDescription>
              </div>
              {editingId && editingRow && teamConfig.enabled && (
                <div className="flex max-w-full flex-wrap items-center justify-end gap-2 rounded-xl border border-white/10 bg-black/20 p-2">
                  <Badge variant={statusBadgeVariant(editingRow.accountStatus)} className="px-2 py-1 text-[11px]">{statusLabel(editingRow.accountStatus)}</Badge>
                  {canManage && (editingRow.accountStatus === 'INVITED' || editingRow.accountStatus === 'PENDING_ACCESS') && <>
                    <TooltipButton label="Reenviar convite"><Button type="button" size="icon" variant="ghost" className="h-8 w-8 rounded-full text-amber-100 hover:bg-amber-200/10" aria-label="Reenviar convite" onClick={() => void changeInvite(editingRow, 'resend')}><Mail className="size-4" aria-hidden="true" /></Button></TooltipButton>
                    <TooltipButton label="Revogar convite"><Button type="button" size="icon" variant="ghost" className="h-8 w-8 rounded-full text-rose-100 hover:bg-rose-200/10" aria-label="Revogar convite" onClick={() => void changeInvite(editingRow, 'revoke')}><Ban className="size-4" aria-hidden="true" /></Button></TooltipButton>
                  </>}
                  {canManage && editingRow.accountStatus !== 'TERMINATED' && editingRow.accountStatus !== 'PENDING_ACCESS' && <Button type="button" size="sm" variant={editingIsSuspended ? 'default' : 'outline'} aria-label={editingIsSuspended ? 'Ativar membro' : 'Suspender membro'} onClick={() => void changeStatus(editingRow, editingIsSuspended ? 'ACTIVE' : 'SUSPENDED')}>
                    <Power className="mr-2 size-4" aria-hidden="true" />
                    {editingIsSuspended ? 'Ativar' : 'Suspender'}
                  </Button>}
                  {canManage && editingRow.accountStatus !== 'TERMINATED' && <TooltipButton label="Desativar definitivamente"><Button type="button" size="icon" variant="ghost" className="h-8 w-8 rounded-full text-rose-100 hover:bg-rose-200/10" aria-label="Desativar definitivamente" onClick={() => void changeStatus(editingRow, 'TERMINATED')}><Power className="size-4" aria-hidden="true" /></Button></TooltipButton>}
                </div>
              )}
            </div>
          </DialogHeader>

          <Tabs value={formTab} onValueChange={setFormTab} className="mt-1">
            <TabsList className="w-full sm:w-auto">
              <TabsTrigger value="identity">Identidade e acesso</TabsTrigger>
              <TabsTrigger value="operation" disabled={!teamConfig.enabled}>Operação</TabsTrigger>
              <TabsTrigger value="history" disabled={!editingId}>Histórico</TabsTrigger>
            </TabsList>

            <TabsContent value="identity" className="mt-4 space-y-5">
              <div className="grid gap-3 md:grid-cols-2">
                <label className="space-y-1.5 text-sm">Nome completo<Input value={form.fullName} disabled={formReadOnly} onChange={(event) => setForm((current) => ({ ...current, fullName: event.target.value, username: usernameWasEdited.current ? current.username : suggestUsername(event.target.value, buildCorporateEmail(event.target.value)) }))} /></label>
                <label className="space-y-1.5 text-sm">Nome de usuário<Input value={form.username} onChange={(event) => { usernameWasEdited.current = true; updateField('username', event.target.value) }} placeholder="primeironomeultimosobrenome" disabled={formReadOnly || !!editingId} /></label>
                <label className="space-y-1.5 text-sm">E-mail corporativo <span className="text-xs text-blue-100/45">{editingId ? 'mantido' : 'calculado'}</span><Input value={effectiveEmail} readOnly aria-readonly="true" /></label>
                <label className="space-y-1.5 text-sm">E-mail pessoal <span className="text-xs text-blue-100/45">{editingId ? 'opcional' : 'obrigatório'}</span><Input type="email" value={form.personalEmail} disabled={formReadOnly} onChange={(event) => updateField('personalEmail', event.target.value)} /></label>
                <label className="space-y-1.5 text-sm">Celular <span className="text-xs text-blue-100/45">{editingId ? 'opcional' : 'obrigatório'}</span><Input value={form.mobilePhone} disabled={formReadOnly} onChange={(event) => updateField('mobilePhone', event.target.value)} inputMode="tel" /></label>
                <label className="space-y-1.5 text-sm">Departamento<Input value={form.department} disabled={formReadOnly} onChange={(event) => updateField('department', event.target.value)} /></label>
                <label className="space-y-1.5 text-sm">Cargo<Select value={form.jobTitle} onValueChange={(jobTitle) => updateField('jobTitle', jobTitle)} disabled={formReadOnly}><SelectTrigger disabled={formReadOnly}><SelectValue /></SelectTrigger><SelectContent>{editTitles.map((title) => <SelectItem value={title} key={title}>{title}</SelectItem>)}</SelectContent></Select></label>
              </div>

              {!editingId && (collisionRequired || form.corporateEmailOverride) && <label className="block space-y-1.5 text-sm">Ajuste do e-mail em caso de colisão<Input type="email" value={form.corporateEmailOverride} disabled={formReadOnly} onChange={(event) => updateField('corporateEmailOverride', event.target.value)} placeholder="primeironomeultimosobrenome2@espacofacial.com" /><span className="block text-xs text-amber-100/70">Use somente após o sistema informar colisão; o ajuste também deve manter o domínio corporativo.</span></label>}

              <div>
                <p className="mb-3 text-xs font-semibold uppercase tracking-[0.14em] text-blue-100/55">Unidades de acesso</p>
                <div className="flex flex-wrap gap-2">{selectableUnits.map((unit) => <Button key={unit} type="button" variant={form.units.includes(unit) ? 'default' : 'outline'} disabled={formReadOnly} onClick={() => toggleUnit(unit)}>{unitLabels[unit] || unit}</Button>)}</div>
              </div>
            </TabsContent>

            <TabsContent value="operation" className="mt-4">
              {teamConfig.enabled ? <div className="rounded-2xl border border-white/10 bg-black/20 p-4"><div className="mb-4 flex items-start gap-3"><div className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-sky-400/10 text-sky-200"><ListChecks className="size-4" aria-hidden="true" /></div><div><p className="text-sm font-semibold text-white">Vínculo operacional da Escala</p><p className="mt-1 text-xs text-blue-100/55">Agenda, função e identificação permanecem aqui; o vínculo usa o identificador do funcionário.</p></div></div><div className="grid gap-3 md:grid-cols-2"><label className="space-y-1.5 text-sm">Status na Escala<Input value={form.scheduleStatus} disabled={formReadOnly} onChange={(event) => updateField('scheduleStatus', event.target.value)} /></label><label className="space-y-1.5 text-sm">Função na Escala<Input value={form.scheduleRole} disabled={formReadOnly} onChange={(event) => updateField('scheduleRole', event.target.value)} /></label><label className="space-y-1.5 text-sm">Turno<Input value={form.scheduleShift} disabled={formReadOnly} onChange={(event) => updateField('scheduleShift', event.target.value)} /></label><label className="space-y-1.5 text-sm">Apelido<Input value={form.scheduleNickname} disabled={formReadOnly} onChange={(event) => updateField('scheduleNickname', event.target.value)} /></label><label className="space-y-1.5 text-sm">Instagram<Input value={form.scheduleInstagram} disabled={formReadOnly} onChange={(event) => updateField('scheduleInstagram', event.target.value)} /></label><label className="space-y-1.5 text-sm">Cor<Input value={form.scheduleColor} disabled={formReadOnly} onChange={(event) => updateField('scheduleColor', event.target.value)} placeholder="#6d9eeb" /></label></div></div> : <div className="rounded-2xl border border-dashed border-white/15 p-4 text-sm text-blue-100/65">O vínculo operacional aparece após a liberação da centralização.</div>}
            </TabsContent>

            <TabsContent value="history" className="mt-4">
              <section className="rounded-2xl border border-white/10 bg-black/20 p-4" aria-labelledby="team-history-title">
                <div className="mb-4 flex items-start justify-between gap-3">
                  <div>
                    <h3 id="team-history-title" className="text-sm font-semibold text-white">Histórico do cadastro</h3>
                    <p className="mt-1 text-xs text-blue-100/55">Alterações, convites e vínculos registrados sem expor dados sensíveis.</p>
                  </div>
                  {editingId && <span className="text-xs text-blue-100/45">Mais recente primeiro</span>}
                </div>
                {historyLoading && <p className="text-sm text-blue-100/65">Carregando histórico…</p>}
                {!historyLoading && historyError && <p role="status" className="text-sm text-amber-100/80">{historyError}</p>}
                {!historyLoading && !historyError && !historyRows.length && <p className="text-sm text-blue-100/65">Nenhuma alteração registrada para este cadastro.</p>}
                {!historyLoading && !historyError && historyRows.length > 0 && (
                  <ol className="space-y-3" aria-label="Eventos do histórico do cadastro">
                    {historyRows.map((entry) => (
                      <li key={String(entry.id)} className="rounded-xl border border-white/10 bg-white/[0.025] p-3">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <span className="text-sm font-medium text-white">{historyActionLabel(entry.action || '')}</span>
                          <time className="text-xs text-blue-100/50" dateTime={entry.timestamp || undefined}>{historyTimestamp(entry.timestamp)}</time>
                        </div>
                        <p className="mt-1 text-xs text-blue-100/70">{historyChange(entry)}</p>
                        <p className="mt-2 text-[11px] text-blue-100/45">Por {entry.actor || 'sistema'}{entry.role ? ` · ${entry.role}` : ''}</p>
                      </li>
                    ))}
                  </ol>
                )}
              </section>
            </TabsContent>
          </Tabs>

          <DialogFooter className="border-t border-white/10 pt-4"><Button variant="outline" onClick={() => setOpen(false)}>Fechar</Button>{canManage ? <Button onClick={() => void submit()} disabled={saving}>{saving ? 'Salvando…' : editingId ? 'Salvar alterações' : 'Cadastrar e convidar'}</Button> : <span className="inline-flex items-center gap-2 text-xs text-blue-100/55"><ShieldCheck className="size-4" aria-hidden="true" />Somente leitura</span>}</DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
