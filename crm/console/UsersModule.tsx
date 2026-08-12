import React from 'react'
import { Ban, CircleAlert, ListChecks, Mail, Pencil, Power, RefreshCw, Search, ShieldCheck, UsersRound } from 'lucide-react'
import { toast } from 'sonner'
import { addEscalaProfessional, updateEscalaProfessional } from '@/escalaApi'
import { Badge as BaseBadge } from '@/badge'
import { Button } from '@/button'
import { Card, CardContent, CardHeader } from '@/card'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/dialog'
import { getCsrfToken } from '@/csrf'
import { Input } from '@/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/select'
import { Switch } from '@/switch'
import { buildCorporateEmail, suggestUsername, type UnifiedTeamConfig, type UnifiedTeamMember, type UnifiedTeamPagination } from '@/teamApi'
import { TooltipButton } from '@/tooltip'

type Me = { success?: boolean; user?: { username?: string; role?: string; allowedUnits?: string[] }; csrfToken?: string }
type Onboarding = { id: string; fullName: string; username?: string | null; corporateEmail: string; workforceEmployeeId?: string | null; profile: string; jobTitle: string; department: string; units: string[]; accountStatus: string; createdAt?: string; updatedAt?: string }
type ApiError = { error?: string; message?: string; code?: string }
type RequestOptions = { method?: string; body?: unknown; csrf?: string | null; headers?: Record<string, string> }
type TeamSummary = { members?: number; pendingInvites?: number }

function Badge({ variant, className, style, ...props }: React.ComponentProps<typeof BaseBadge>) {
  const accessibleColors = variant === 'success'
    ? 'bg-emerald-300 text-emerald-950 hover:bg-emerald-200'
    : variant === 'warning'
      ? 'bg-amber-200 text-amber-950 hover:bg-amber-100'
      : variant === 'destructive'
        ? 'bg-rose-300 text-rose-950 hover:bg-rose-200'
        : ''
  const accessibleStyle = variant === 'success'
    ? { backgroundColor: '#a7f3d0', color: '#022c22', ...style }
    : variant === 'warning'
      ? { backgroundColor: '#fde68a', color: '#451a03', ...style }
      : variant === 'destructive'
        ? { backgroundColor: '#fecdd3', color: '#4c0519', ...style }
        : style
  return <BaseBadge variant={variant} className={[accessibleColors, className].filter(Boolean).join(' ')} style={accessibleStyle} {...props} />
}

class RequestError extends Error {
  code?: string

  constructor(message: string, code?: string) {
    super(message)
    this.name = 'RequestError'
    this.code = code
  }
}

function requestErrorMessage(error: any, fallback: string) {
  const code = String(error?.code || '').trim().toUpperCase()
  const message = String(error?.message || '').trim()
  const normalized = `${code} ${message.toUpperCase()}`
  if (['DOMAIN_SERVICE_DEGRADED', 'SERVICE_DEGRADED', 'WORKFORCE_SERVICE_DEGRADED', 'MODULE_MAINTENANCE'].some((value) => normalized.includes(value))) {
    return 'A integração operacional está temporariamente em manutenção. Nenhum acesso foi liberado; tente novamente após a normalização do serviço.'
  }
  if (['TEAM_LOCAL_PERSISTENCE_PENDING', 'LOCAL_TEAM_CREATE_PENDING'].some((value) => code === value || message.toUpperCase().includes(value))) {
    return 'A identidade foi sincronizada, mas a projeção da equipe ficou pendente de compensação. Atualize a lista e tente novamente.'
  }
  if (['TEAM_MIGRATION_REQUIRED', 'ONBOARDING_MIGRATION_REQUIRED'].includes(code)) {
    return 'A estrutura do cadastro unificado ainda não foi aplicada neste ambiente.'
  }
  return message || fallback
}

const readinessLabels: Record<string, string> = {
  UNIFIED_TEAM_ENABLED: 'liberação da centralização',
  TEAM_SCHEMA: 'estrutura do cadastro unificado',
  ONBOARDING_USERNAME: 'coluna de usuário do onboarding',
  ONBOARDING_REQUEST_FINGERPRINT: 'fingerprint de idempotência',
  INVITE_USERNAME: 'usuário do convite',
  INVITE_CORPORATE_EMAIL: 'identidade corporativa do convite',
  ONBOARDING_SAGA: 'estado transacional do onboarding',
  TEAM_LINK_LEDGER: 'ledger de vínculos da equipe',
  WORKFORCE_BINDING: 'vínculo com Workforce',
  IDENTITY_PII_KEY: 'chave privada de identidade',
  INVITE_MAILER: 'mailer de convites',
}

function readinessMessage(readiness?: UnifiedTeamConfig['readiness']) {
  if (!readiness || readiness.ready) return ''
  const missing = (readiness.missing || []).map((item) => readinessLabels[item] || item).join(', ')
  if (readiness.state === 'MIGRATION_REQUIRED') return `A centralização está bloqueada até concluir ${missing || 'as migrações do cadastro unificado'}.`
  if (readiness.state === 'DEPENDENCY_DEGRADED') return `A centralização está em modo protegido porque falta configurar ${missing || 'uma dependência operacional'}.`
  return 'A centralização da equipe está desligada neste ambiente.'
}

const unitLabels: Record<string, string> = { 'novo-hamburgo': 'Novo Hamburgo', 'barra-shopping-sul': 'Barra Shopping Sul' }
const standardDepartmentOptions = ['Atendimento', 'Recepção', 'Comercial', 'Operações', 'Administrativo', 'Financeiro', 'Marketing', 'Recursos Humanos', 'Tecnologia']
const scheduleRoleByJobTitle: Record<string, string> = {
  Gestor: 'Gestor',
  Gerente: 'Gerente',
  Coordenador: 'Coordenador',
  'Responsável Técnico': 'Responsável Técnico',
  Injetor: 'Injetor',
  Consultor: 'Consultor',
}
const unitAccentClasses: Record<string, string> = {
  'novo-hamburgo': 'border-emerald-300/70 bg-emerald-400/20 text-emerald-50 hover:bg-emerald-400/30',
  'barra-shopping-sul': 'border-violet-300/70 bg-violet-400/20 text-violet-50 hover:bg-violet-400/30',
}
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
  scheduleRole: 'Consultor',
  scheduleShift: '',
  scheduleNickname: '',
  scheduleInstagram: '',
  scheduleColor: '',
}

function scheduleRoleForJobTitle(jobTitle: string, fallback = '') {
  return scheduleRoleByJobTitle[jobTitle] || fallback || jobTitle
}

function isScheduleActive(value?: string) {
  return !['inativo', 'inactive', 'desligado', 'off', '0', 'false'].includes(String(value || '').trim().toLowerCase())
}

function nationalMobileDigits(value: string) {
  const raw = String(value || '').replace(/\D/g, '')
  const hasBrazilCountryCode = String(value || '').trim().startsWith('+55') || (raw.length >= 13 && raw.startsWith('55'))
  return (hasBrazilCountryCode ? raw.slice(2) : raw).slice(0, 11)
}

function formatMobileInput(value: string) {
  const digits = nationalMobileDigits(value)
  if (!digits) return ''
  if (digits.length <= 2) return `(${digits}`
  if (digits.length <= 7) return `(${digits.slice(0, 2)}) ${digits.slice(2)}`
  return `(${digits.slice(0, 2)}) ${digits.slice(2, 7)}-${digits.slice(7)}`
}

function storedMobilePhone(value: string) {
  const digits = nationalMobileDigits(value)
  return digits ? `+55${digits}` : ''
}

function unitButtonClass(unit: string, selected: boolean) {
  if (!selected) return 'border-white/15 bg-white/[0.03] text-blue-100/75 hover:bg-white/[0.08]'
  return `${unitAccentClasses[unit] || 'border-sky-300/70 bg-sky-400/20 text-sky-50 hover:bg-sky-400/30'} ring-2 ring-white/25 ring-offset-2 ring-offset-corporate-900`
}

const TEAM_PAGE_SIZE = 50

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
    scheduleRole: scheduleRoleForJobTitle(row?.jobTitle || 'Consultor', row?.schedule?.role || ''),
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

// The desktop table keeps compact columns at the dashboard width. Badges must
// be allowed to wrap inside those cells instead of painting over the adjacent
// account, schedule, or action columns.
const compactTableBadgeClass = 'max-w-full !whitespace-normal !shrink break-words text-center leading-tight px-2 py-1 text-[11px]'

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

function scheduleSyncLabel(state?: string) {
  return ({ NOT_CONFIGURED: 'Não configurada', PENDING: 'Pendente', SYNCED: 'Sincronizada', FAILED: 'Falhou', BLOCKED: 'Bloqueada' } as Record<string, string>)[String(state || '').toUpperCase()] || 'Pendente'
}

function scheduleSyncBadgeVariant(state?: string): BadgeVariant {
  const normalized = String(state || '').toUpperCase()
  if (normalized === 'SYNCED') return 'success'
  if (normalized === 'FAILED' || normalized === 'BLOCKED') return 'destructive'
  if (normalized === 'NOT_CONFIGURED') return 'outline'
  return 'warning'
}

export function UsersModule() {
  const [me, setMe] = React.useState<Me | null>(null)
  const [teamRows, setTeamRows] = React.useState<UnifiedTeamMember[]>([])
  const [teamConfig, setTeamConfig] = React.useState<UnifiedTeamConfig>({ enabled: false, legacyEscalaEditor: true })
  const [open, setOpen] = React.useState(false)
  const [loading, setLoading] = React.useState(true)
  const [loadError, setLoadError] = React.useState('')
  const [saving, setSaving] = React.useState(false)
  const [syncingEscala, setSyncingEscala] = React.useState(false)
  const [editingId, setEditingId] = React.useState<string | null>(null)
  const [editingOriginalName, setEditingOriginalName] = React.useState('')
  const [collisionRequired, setCollisionRequired] = React.useState(false)
  const [form, setForm] = React.useState(initialForm)
  const [statusFilter, setStatusFilter] = React.useState('ACTIVE')
  const [searchQuery, setSearchQuery] = React.useState('')
  const [searchInput, setSearchInput] = React.useState('')
  const [page, setPage] = React.useState(1)
  const [summary, setSummary] = React.useState<TeamSummary>({})
  const [pagination, setPagination] = React.useState<UnifiedTeamPagination | null>(null)
  const [selectedIds, setSelectedIds] = React.useState<string[]>([])
  const [bulkSaving, setBulkSaving] = React.useState(false)
  const [activationRetryingId, setActivationRetryingId] = React.useState<string | null>(null)
  const [submitBlockedMessage, setSubmitBlockedMessage] = React.useState('')
  const usernameWasEdited = React.useRef(false)
  const loadSequence = React.useRef(0)

  const role = String(me?.user?.role || '').toUpperCase()
  const actorUnits = Array.isArray(me?.user?.allowedUnits) ? me!.user!.allowedUnits!.filter(Boolean) : []
  const canManage = ['ADMIN', 'GESTOR', 'GERENTE'].includes(role) && (role === 'ADMIN' || actorUnits.length > 0)
  const selectableUnits = role === 'ADMIN' ? Object.keys(unitLabels) : actorUnits
  const selectableTitles = React.useMemo(() => creatableTitlesByRole[role] || [], [role])
  const generatedEmail = buildCorporateEmail(form.fullName)
  const effectiveEmail = form.corporateEmailOverride.trim().toLowerCase() || generatedEmail
  const editingRow = editingId ? teamRows.find((row) => row.id === editingId) || null : null
  const editingIsSuspended = editingRow?.accountStatus === 'SUSPENDED'
  const unitCount = new Set(teamRows.flatMap((row) => row.units)).size
  const pageTotal = pagination?.total ?? summary.members ?? teamRows.length
  const pageStart = pageTotal > 0 ? ((pagination?.page || page) - 1) * (pagination?.limit || TEAM_PAGE_SIZE) + 1 : 0
  const pageEnd = pageTotal > 0 ? Math.min(pageTotal, pageStart + teamRows.length - 1) : 0
  const canRead = ['ADMIN', 'GESTOR', 'GERENTE', 'SUPERVISOR'].includes(role)
  const formReadOnly = !canManage
  const editTitles = Array.from(new Set([editingRow?.jobTitle, ...selectableTitles].filter((value): value is string => Boolean(value))))
  const departmentOptions = React.useMemo(() => Array.from(new Set([
    ...standardDepartmentOptions,
    ...teamRows.map((row) => row.department),
    editingRow?.department,
  ].filter((value): value is string => Boolean(value?.trim())))), [editingRow?.department, teamRows])

  const load = React.useCallback(async () => {
    const sequence = ++loadSequence.current
    setLoading(true)
    setLoadError('')
    try {
      const auth = await api<Me>('/auth/me')
      if (sequence !== loadSequence.current) return
      setMe(auth)
      if (!auth?.user?.username) throw new RequestError('Sessão não identificada. Entre novamente para consultar a equipe.')
      const configResult = await api<{ success?: boolean; data?: UnifiedTeamConfig }>('/admin/team?mode=config', { csrf: auth.csrfToken })
      if (sequence !== loadSequence.current) return
      const config = configResult?.data || { enabled: false, legacyEscalaEditor: true }
      setTeamConfig(config)
      if (config.enabled) {
        const params = new URLSearchParams()
        if (statusFilter) params.set('status', statusFilter)
        if (searchQuery.trim()) params.set('q', searchQuery.trim())
        params.set('page', String(page))
        params.set('limit', String(TEAM_PAGE_SIZE))
        const result = await api<{ success?: boolean; data?: UnifiedTeamMember[]; summary?: TeamSummary; pagination?: UnifiedTeamPagination }>(`/admin/team?${params.toString()}`, { csrf: auth.csrfToken })
        if (sequence !== loadSequence.current) return
        const members = Array.isArray(result?.data) ? result!.data! : []
        setTeamRows(members)
        setSelectedIds((current) => current.filter((id) => members.some((member) => member.id === id)))
        setSummary(result?.summary || { members: members.length })
        setPagination(result?.pagination || { page, limit: TEAM_PAGE_SIZE, total: members.length, pages: 1, hasMore: false })
      } else {
        const params = new URLSearchParams({ status: statusFilter || 'ALL' })
        if (searchQuery.trim()) params.set('q', searchQuery.trim())
        const result = await api<{ success?: boolean; data?: Onboarding[]; summary?: TeamSummary }>(`/admin/onboarding?${params.toString()}`, { csrf: auth.csrfToken })
        if (sequence !== loadSequence.current) return
        const legacyRows = Array.isArray(result?.data) ? result!.data! : []
        setTeamRows(legacyRows.map((row) => ({ ...row, schedule: undefined, identityLinks: [] })))
        setSelectedIds([])
        setSummary(result?.summary || { members: legacyRows.length })
        setPagination(null)
      }
      if (sequence === loadSequence.current) setLoadError('')
    } catch (error: any) {
      if (sequence === loadSequence.current) setLoadError(error?.message || 'Não foi possível carregar a equipe. Tente novamente.')
    } finally {
      if (sequence === loadSequence.current) setLoading(false)
    }
  }, [page, searchQuery, statusFilter])

  React.useEffect(() => { void load() }, [load])

  React.useEffect(() => {
    const timer = window.setTimeout(() => { setSearchQuery(searchInput); setPage(1) }, 250)
    return () => window.clearTimeout(timer)
  }, [searchInput])

  const updateField = (field: keyof typeof initialForm, value: string | string[]) => setForm((current) => ({ ...current, [field]: value }))
  const updateJobTitle = (jobTitle: string) => setForm((current) => ({ ...current, jobTitle, scheduleRole: scheduleRoleForJobTitle(jobTitle, current.scheduleRole) }))
  const toggleUnit = (unit: string) => setForm((current) => ({ ...current, units: current.units.includes(unit) ? current.units.filter((item) => item !== unit) : [...current.units, unit] }))

  const openCreate = React.useCallback(() => {
    const defaultTitle = selectableTitles[selectableTitles.length - 1] || 'Consultor'
    const defaultUnits = [...selectableUnits]
    setEditingId(null)
    setEditingOriginalName('')
    setCollisionRequired(false)
    setSubmitBlockedMessage('')
    usernameWasEdited.current = false
    setForm({
      ...initialForm,
      jobTitle: defaultTitle,
      scheduleRole: scheduleRoleForJobTitle(defaultTitle),
      units: defaultUnits,
    })
    setOpen(true)
  }, [selectableTitles, selectableUnits])

  const openEdit = (row: UnifiedTeamMember) => {
    setEditingId(row.id)
    setEditingOriginalName(row.fullName)
    setCollisionRequired(false)
    setSubmitBlockedMessage('')
    usernameWasEdited.current = true
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
          body: { source: 'ESCALA', sourceId: professionalId, matchMethod: 'AUTO_ESCALA_PROFESSIONAL_ID', confidence: 'HIGH', reviewStatus: 'CONFIRMED' },
      })
      return true
    } catch (error: any) {
      toast.warning(`Cadastro salvo, mas o vínculo com a Escala ficou pendente: ${requestErrorMessage(error, 'tente novamente')}.`)
      return false
    }
  }

  const reportEscalaSync = async (member: UnifiedTeamMember, state: 'PENDING' | 'SYNCED' | 'FAILED' | 'BLOCKED' | 'NOT_CONFIGURED', details: { professionalId?: string; errorCode?: string } = {}) => {
    const operationKey = `crm-escala-sync-${member.id}-${Date.now()}-${Math.random().toString(16).slice(2)}`
    try {
      await api(`/admin/team/${encodeURIComponent(member.id)}/schedule-sync`, {
        method: 'POST',
        csrf: me?.csrfToken,
        headers: { 'idempotency-key': operationKey },
        body: { state, ...(details.professionalId ? { professionalId: details.professionalId } : {}), ...(details.errorCode ? { errorCode: details.errorCode } : {}) },
      })
      return true
    } catch (error: any) {
      toast.warning(`A Escala foi processada, mas o estado não pôde ser registrado: ${requestErrorMessage(error, 'tente atualizar a lista')}.`)
      return false
    }
  }

  const syncEscala = async (member: UnifiedTeamMember, created: boolean) => {
    if (!teamConfig.enabled || form.jobTitle !== 'Injetor' || !member.workforceEmployeeId) return true
    setSyncingEscala(true)
    try {
      const schedulePayload = {
        professionalId: member.schedule?.professionalId || member.scheduleSync?.professionalId || undefined,
        name: form.fullName,
        status: form.scheduleStatus,
        units: form.units,
        role: form.scheduleRole,
        shift: form.scheduleShift,
        nickname: form.scheduleNickname,
        phone: storedMobilePhone(form.mobilePhone) || storedMobilePhone(member.schedule?.phone || '') || undefined,
        email: effectiveEmail,
        instagram: form.scheduleInstagram,
        color: form.scheduleColor,
        workforceEmployeeId: member.workforceEmployeeId,
      }
      const hasScheduleLink = Boolean(member.schedule?.professionalId || member.scheduleSync?.professionalId)
      const result = created || !hasScheduleLink
        ? await addEscalaProfessional(schedulePayload)
        : await updateEscalaProfessional({ currentName: editingOriginalName, ...schedulePayload })
      if (!result.ok) {
        const recorded = await reportEscalaSync(member, 'FAILED', { errorCode: 'ESCALA_API_ERROR' })
        if (!created && recorded) await load()
        toast.warning(`Cadastro salvo, mas a Escala ficou pendente: ${result.error || 'tente novamente'}.`)
        return false
      }
      const professionalId = result.data?.professionalId
      if (!professionalId) {
        const recorded = await reportEscalaSync(member, 'FAILED', { errorCode: 'ESCALA_PROFESSIONAL_ID_MISSING' })
        if (!created && recorded) await load()
        toast.warning('Cadastro salvo, mas a Escala não devolveu um identificador para o vínculo.')
        return false
      }
      const linked = await linkEscalaMember(member, { professionalId })
      if (!linked) {
        const recorded = await reportEscalaSync(member, 'FAILED', { professionalId, errorCode: 'ESCALA_LINK_FAILED' })
        if (!created && recorded) await load()
        return false
      }
      const recorded = await reportEscalaSync(member, 'SYNCED', { professionalId })
      if (!created && recorded) await load()
      if (recorded) toast.success('Vínculo com a Escala sincronizado.')
      return recorded
    } finally {
      setSyncingEscala(false)
    }
  }

  const submit = async () => {
    if (!canManage) return
    if (!teamConfig.enabled) {
      const message = 'A gestão centralizada está desligada neste ambiente. Nenhuma alteração foi enviada.'
      setSubmitBlockedMessage(message)
      toast.error(message)
      return
    }
    const username = form.username.trim() || suggestUsername(form.fullName, effectiveEmail)
    const normalizedMobilePhone = storedMobilePhone(form.mobilePhone)
    const mobileDigits = nationalMobileDigits(form.mobilePhone)
    if (!form.fullName.trim() || !username || !effectiveEmail || (!editingId && (!form.personalEmail.trim() || !mobileDigits)) || !form.department.trim() || !form.units.length) {
      toast.error('Preencha nome, usuário, e-mails, telefone, departamento e ao menos uma unidade.')
      return
    }
    if ((mobileDigits.length > 0 && mobileDigits.length !== 11) || (!editingId && mobileDigits.length !== 11)) {
      toast.error('Informe o celular com DDD e 9 dígitos após o +55.')
      return
    }
    setSaving(true)
    try {
      const body = {
        fullName: form.fullName,
        username,
        corporateEmail: effectiveEmail,
        ...(form.personalEmail.trim() ? { personalEmail: form.personalEmail } : {}),
        ...(normalizedMobilePhone ? { mobilePhone: normalizedMobilePhone } : {}),
        department: form.department,
        jobTitle: form.jobTitle,
        units: form.units,
        ...(form.jobTitle === 'Injetor' ? {
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
        } : {}),
      }
      const endpoint = editingId ? `/admin/team/${encodeURIComponent(editingId)}` : '/admin/team'
      const result = await api<{ data?: Onboarding & UnifiedTeamMember; replayed?: boolean }>(endpoint, {
        method: editingId ? 'PUT' : 'POST',
        csrf: me?.csrfToken,
        headers: editingId ? {} : { 'idempotency-key': `crm-team-${Date.now()}-${Math.random().toString(16).slice(2)}` },
        body,
      })
      let escalaSynced = true
      if (result.data && teamConfig.enabled && form.jobTitle === 'Injetor' && !result.replayed) {
        escalaSynced = (await syncEscala(result.data as UnifiedTeamMember, !editingId)) !== false
      }
      setCollisionRequired(false)
      setSubmitBlockedMessage('')
      setForm(initialForm)
      setEditingId(null)
      setOpen(false)
      toast.success(escalaSynced
        ? (editingId ? 'Membro atualizado.' : 'Cadastro criado; convite enviado para o e-mail pessoal.')
        : (editingId ? 'Membro atualizado; vínculo com a Escala pendente.' : 'Cadastro criado; vínculo com a Escala pendente.'))
      await load()
    } catch (error: any) {
      if (error instanceof RequestError && (error.code === 'EMAIL_TAKEN' || error.code === 'CORPORATE_EMAIL_OVERRIDE_REQUIRES_COLLISION')) {
        setCollisionRequired(true)
        toast.error('O e-mail calculado já está em uso. Informe um ajuste explícito, como um sufixo numérico.')
      } else if (error instanceof RequestError && error.code === 'USERNAME_TAKEN') {
        toast.error('Esse nome de usuário já está reservado. Escolha outro.')
      } else {
        toast.error(requestErrorMessage(error, 'Não foi possível concluir o cadastro.'))
      }
    } finally {
      setSaving(false)
    }
  }

  const changeStatus = async (row: UnifiedTeamMember, nextStatus: 'ACTIVE' | 'SUSPENDED' | 'TERMINATED') => {
    const activating = nextStatus === 'ACTIVE'
    const actionLabel = nextStatus === 'TERMINATED' ? 'desativar permanentemente' : activating ? 'ativar' : 'suspender'
    if (!teamConfig.enabled || !window.confirm(`${actionLabel[0].toUpperCase() + actionLabel.slice(1)} ${row.fullName}?${nextStatus === 'TERMINATED' ? ' O acesso será encerrado e o histórico preservado.' : activating ? '' : ' O histórico e a agenda serão preservados.'}`)) return
    const terminationReason = nextStatus === 'TERMINATED'
      ? window.prompt('Informe o motivo do desligamento (obrigatório):', '')?.trim() || ''
      : ''
    if (nextStatus === 'TERMINATED' && terminationReason.length < 5) {
      toast.error('Informe um motivo com pelo menos 5 caracteres para desativar o membro.')
      return
    }
    try {
      await api(`/admin/team/${encodeURIComponent(row.id)}/status`, { method: 'POST', csrf: me?.csrfToken, body: { accountStatus: nextStatus, ...(terminationReason ? { reason: terminationReason } : {}) } })
      toast.success(nextStatus === 'TERMINATED' ? 'Membro desativado; histórico preservado.' : activating ? 'Membro ativado.' : 'Membro suspenso; histórico preservado.')
      setOpen(false)
      setEditingId(null)
      await load()
    } catch (error: any) {
      toast.error(requestErrorMessage(error, `Não foi possível ${activating ? 'ativar' : 'desativar'} o membro.`))
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
      toast.error(requestErrorMessage(error, `Não foi possível ${action === 'resend' ? 'reenviar' : 'revogar'} o convite.`))
    }
  }

  const retryActivation = async (row: UnifiedTeamMember) => {
    if (!teamConfig.enabled || !canManage || String(row.accountStatus || '').toUpperCase() !== 'INVITED' || String(row.provisioningState || '').toUpperCase() !== 'FAILED') return
    if (!window.confirm(`Concluir a ativação de ${row.fullName}? O funcionário precisa já ter criado a própria senha pelo convite.`)) return
    setActivationRetryingId(row.id)
    try {
      await api(`/admin/team/${encodeURIComponent(row.id)}/activate`, { method: 'POST', csrf: me?.csrfToken })
      toast.success('Acesso ativado e Workforce reconciliado.')
      await load()
    } catch (error: any) {
      toast.error(error?.code === 'INVITE_REGISTRATION_REQUIRED' ? 'O funcionário ainda não criou a senha pelo convite.' : requestErrorMessage(error, 'Não foi possível concluir a ativação.'))
    } finally {
      setActivationRetryingId(null)
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
      toast.error(requestErrorMessage(error, 'A ação em lote ficou pendente de sincronização.'))
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
                <span>{loading ? 'Atualizando' : `${pageTotal} ${pageTotal === 1 ? 'membro' : 'membros'}`}</span>
                <span className="size-1 rounded-full bg-white/25" aria-hidden="true" />
                <span>{unitCount} {unitCount === 1 ? 'unidade' : 'unidades'}</span>
              </div>
            </div>
          </CardHeader>
          <CardContent className="p-3 sm:p-5">
            {loadError && <div className="mb-4 flex items-start gap-3 rounded-2xl border border-rose-200/20 bg-rose-400/[0.08] px-3 py-3 text-sm text-rose-50" role="alert">
              <CircleAlert className="mt-0.5 size-4 shrink-0 text-rose-200" aria-hidden="true" />
              <div className="min-w-0 flex-1"><p>{loadError}</p><p className="mt-1 text-xs text-rose-100/65">Os dados exibidos podem estar desatualizados.</p></div>
              <TooltipButton label="Tentar carregar novamente"><Button type="button" size="icon" variant="ghost" className="h-8 w-8 shrink-0 rounded-full text-rose-100 hover:bg-rose-200/10" aria-label="Tentar carregar novamente" onClick={() => void load()}><RefreshCw className={`size-4 ${loading ? 'animate-spin' : ''}`} aria-hidden="true" /></Button></TooltipButton>
            </div>}
            {teamConfig.enabled && teamConfig.readiness && !teamConfig.readiness.ready && <div className="mb-4 flex items-start gap-3 rounded-2xl border border-amber-200/20 bg-amber-300/[0.06] px-3 py-3 text-sm text-amber-50" role="status">
              <CircleAlert className="mt-0.5 size-4 shrink-0 text-amber-200" aria-hidden="true" />
              <div className="min-w-0 flex-1"><p>{readinessMessage(teamConfig.readiness)}</p><p className="mt-1 text-xs text-amber-100/60">As ações de escrita continuam protegidas até o ambiente ficar pronto.</p></div>
              <TooltipButton label="Atualizar prontidão"><Button type="button" size="icon" variant="ghost" className="h-8 w-8 shrink-0 rounded-full text-amber-100 hover:bg-amber-200/10" aria-label="Atualizar prontidão" onClick={() => void load()}><RefreshCw className={`size-4 ${loading ? 'animate-spin' : ''}`} aria-hidden="true" /></Button></TooltipButton>
            </div>}
            {canRead && (
              <div className="mb-4 space-y-3">
                <div className="flex flex-col gap-2 lg:flex-row lg:items-center lg:justify-between">
                  <label className="relative min-w-0 flex-1 lg:max-w-md">
                    <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-blue-100/45" aria-hidden="true" />
                    <Input value={searchInput} onChange={(event) => setSearchInput(event.target.value)} placeholder="Buscar por nome, usuário, cargo ou unidade" className="pl-9" aria-label="Buscar equipe" />
                  </label>
                  <div className="flex flex-wrap items-center gap-2">
                    <Select value={statusFilter} onValueChange={(value) => { setStatusFilter(value); setPage(1) }}>
                      <SelectTrigger className="w-full min-w-[170px] sm:w-[190px]" aria-label="Filtrar status"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="ACTIVE">Ativos e convites</SelectItem>
                        <SelectItem value="INVITED">Convites enviados</SelectItem>
                        <SelectItem value="PENDING_ACCESS">Aguardando acesso</SelectItem>
                        <SelectItem value="SUSPENDED">Suspensos</SelectItem>
                        <SelectItem value="TERMINATED">Desativados</SelectItem>
                        <SelectItem value="ALL">Todos os estados</SelectItem>
                      </SelectContent>
                    </Select>
                    {(searchInput || searchQuery || statusFilter !== 'ACTIVE') && <Button type="button" variant="ghost" size="sm" onClick={() => { setSearchInput(''); setSearchQuery(''); setStatusFilter('ACTIVE'); setPage(1) }}>Limpar</Button>}
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                  <div className="rounded-xl border border-white/10 bg-white/[0.025] px-3 py-2"><p className="text-[10px] uppercase tracking-[0.12em] text-blue-100/45">Total</p><p className="mt-1 text-lg font-semibold text-white">{pageTotal}</p></div>
                  <div className="rounded-xl border border-amber-300/15 bg-amber-400/[0.06] px-3 py-2"><p className="text-[10px] uppercase tracking-[0.12em] text-amber-100/55">Convites</p><p className="mt-1 text-lg font-semibold text-amber-50">{summary.pendingInvites || 0}</p></div>
                  <div className="rounded-xl border border-white/10 bg-white/[0.025] px-3 py-2"><p className="text-[10px] uppercase tracking-[0.12em] text-blue-100/45">Unidades</p><p className="mt-1 text-lg font-semibold text-white">{unitCount}</p></div>
                  <div className="rounded-xl border border-sky-300/15 bg-sky-400/[0.06] px-3 py-2"><p className="text-[10px] uppercase tracking-[0.12em] text-sky-100/55">Gestão</p><p className="mt-1 text-lg font-semibold text-sky-50">Centralizada</p></div>
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
              </div>
            )}
            <div className="hidden overflow-auto rounded-xl border border-white/10 md:block">
                <table className="w-full table-fixed text-sm">
                  <colgroup>
                  <col className="w-[6%]" />
                  <col className="w-[17%]" />
                  <col className="w-[12%]" />
                  <col className="w-[10%]" />
                  <col className="w-[11%]" />
                  <col className="w-[13%]" />
                  <col className="w-[14%]" />
                  <col className="w-[9%]" />
                </colgroup>
                <thead className="bg-black/25 text-[11px] uppercase tracking-[0.12em] text-blue-100/60">
                  <tr>
                    <th className="p-3 text-left" scope="col"><span className="sr-only">Selecionar</span></th>
                    <th className="p-3 text-left" scope="col">Nome</th>
                    <th className="p-3 text-left" scope="col">Usuário</th>
                    <th className="p-3 text-left" scope="col">Cargo</th>
                    <th className="p-3 text-left" scope="col">Departamento</th>
                    <th className="p-3 text-left" scope="col">Unidades</th>
                    <th className="p-3 text-left" scope="col">Status</th>
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
                      <td className="min-w-0 p-3 align-middle font-mono text-xs break-words text-blue-100/80">{row.username || '—'}</td>
                      <td className="min-w-0 p-3 align-middle"><Badge variant={titleBadgeVariant(row.jobTitle)} className={compactTableBadgeClass}>{row.jobTitle}</Badge></td>
                      <td className="min-w-0 p-3 align-middle break-words text-blue-100/80">{row.department || '—'}</td>
                      <td className="p-3 align-middle">
                        <div className="flex min-w-0 flex-wrap gap-1">
                          {row.units.length ? row.units.map((unit) => (
                            <Badge key={unit} variant="outline" className={compactTableBadgeClass}>{unitLabels[unit] || unit}</Badge>
                          )) : <Badge variant="outline" className={compactTableBadgeClass}>Sem unidade</Badge>}
                        </div>
                      </td>
                      <td className="min-w-0 p-3 align-middle"><Badge variant={statusBadgeVariant(row.accountStatus)} className={compactTableBadgeClass}>{statusLabel(row.accountStatus)}</Badge></td>
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
                    <tr><td className="p-5 text-blue-100/70" colSpan={8}>{loading ? 'Carregando…' : teamConfig.enabled ? (searchQuery || statusFilter !== 'ACTIVE' ? 'Nenhum membro corresponde aos filtros.' : 'Nenhum integrante ativo.') : 'A lista aparecerá após a liberação da centralização.'}</td></tr>
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
                    <div><p className="mb-1 text-[10px] uppercase tracking-[0.12em] text-blue-100/45">Status</p><Badge variant={statusBadgeVariant(row.accountStatus)} className="px-2 py-1 text-[11px]">{statusLabel(row.accountStatus)}</Badge></div>
                  </div>
                </article>
              ))}
              {!teamRows.length && <div className="rounded-2xl border border-dashed border-white/15 p-5 text-sm text-blue-100/70">{loading ? 'Carregando…' : teamConfig.enabled ? (searchQuery || statusFilter !== 'ACTIVE' ? 'Nenhum membro corresponde aos filtros.' : 'Nenhum integrante ativo.') : 'A lista aparecerá após a liberação da centralização.'}</div>}
            </div>
            {teamConfig.enabled && pagination && (
              <nav className="mt-4 flex flex-col gap-3 rounded-2xl border border-white/10 bg-black/10 px-3 py-3 text-xs text-blue-100/65 sm:flex-row sm:items-center sm:justify-between" aria-label="Paginação da equipe">
                <span>{pageTotal > 0 ? `Exibindo ${pageStart}–${pageEnd} de ${pageTotal}` : 'Nenhum membro encontrado'}</span>
                <div className="flex items-center gap-2">
                  <Button type="button" size="sm" variant="outline" disabled={loading || page <= 1} aria-label="Página anterior" onClick={() => setPage((current) => Math.max(1, current - 1))}>Anterior</Button>
                  <span aria-live="polite" className="min-w-[5.5rem] text-center">Página {pagination.page} de {pagination.pages}</span>
                  <Button type="button" size="sm" variant="outline" disabled={loading || !pagination.hasMore} aria-label="Próxima página" onClick={() => setPage((current) => current + 1)}>Próxima</Button>
                </div>
              </nav>
            )}
          </CardContent>
        </Card>
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[calc(100vh-1rem)] max-w-4xl overflow-y-auto border-white/10 bg-corporate-900 px-4 py-5 text-white dark sm:px-6">
          <DialogHeader className="border-b border-white/10 pb-4">
            <div className="flex flex-col items-stretch gap-4 sm:flex-row sm:items-start sm:justify-between">
              <div className="min-w-0 flex-1">
                <DialogTitle>{editingId ? 'Editar membro da equipe' : 'Cadastro unificado de equipe'}</DialogTitle>
                <DialogDescription className="mt-1 text-blue-100/70">{editingId ? 'Atualize os dados do membro, cargo e unidades. A senha continua sob controle do funcionário.' : 'O e-mail corporativo será calculado e o convite enviado ao e-mail pessoal. A senha é criada pelo funcionário.'}</DialogDescription>
              </div>
              {editingId && editingRow && teamConfig.enabled && (
                <div className="flex w-full shrink-0 flex-wrap items-center justify-start gap-2 rounded-xl border border-white/10 bg-black/20 p-2 sm:w-auto sm:justify-end">
                  <Badge variant={statusBadgeVariant(editingRow.accountStatus)} className="px-2 py-1 text-[11px]">{statusLabel(editingRow.accountStatus)}</Badge>
                  {canManage && (editingRow.accountStatus === 'INVITED' || editingRow.accountStatus === 'PENDING_ACCESS') && <>
                    <TooltipButton label="Reenviar convite"><Button type="button" size="icon" variant="ghost" className="h-8 w-8 rounded-full text-amber-100 hover:bg-amber-200/10" aria-label="Reenviar convite" onClick={() => void changeInvite(editingRow, 'resend')}><Mail className="size-4" aria-hidden="true" /></Button></TooltipButton>
                    <TooltipButton label="Revogar convite"><Button type="button" size="icon" variant="ghost" className="h-8 w-8 rounded-full text-rose-100 hover:bg-rose-200/10" aria-label="Revogar convite" onClick={() => void changeInvite(editingRow, 'revoke')}><Ban className="size-4" aria-hidden="true" /></Button></TooltipButton>
                  </>}
                  {canManage && editingRow.accountStatus === 'INVITED' && String(editingRow.provisioningState || '').toUpperCase() === 'FAILED' && <TooltipButton label="Tentar concluir ativação"><Button type="button" size="sm" variant="outline" disabled={activationRetryingId === editingRow.id} onClick={() => void retryActivation(editingRow)}><RefreshCw className={`mr-2 size-3.5 ${activationRetryingId === editingRow.id ? 'animate-spin' : ''}`} aria-hidden="true" />{activationRetryingId === editingRow.id ? 'Tentando…' : 'Concluir ativação'}</Button></TooltipButton>}
                  {canManage && editingRow.accountStatus !== 'TERMINATED' && editingRow.accountStatus !== 'PENDING_ACCESS' && <Button type="button" size="sm" variant={editingIsSuspended ? 'default' : 'outline'} aria-label={editingIsSuspended ? 'Ativar membro' : 'Suspender membro'} onClick={() => void changeStatus(editingRow, editingIsSuspended ? 'ACTIVE' : 'SUSPENDED')}>
                    <Power className="mr-2 size-4" aria-hidden="true" />
                    {editingIsSuspended ? 'Ativar' : 'Suspender'}
                  </Button>}
                  {canManage && editingRow.accountStatus !== 'TERMINATED' && <TooltipButton label="Desativar definitivamente"><Button type="button" size="icon" variant="ghost" className="h-8 w-8 rounded-full text-rose-100 hover:bg-rose-200/10" aria-label="Desativar definitivamente" onClick={() => void changeStatus(editingRow, 'TERMINATED')}><Power className="size-4" aria-hidden="true" /></Button></TooltipButton>}
                </div>
              )}
            </div>
          </DialogHeader>

          <div className="mt-4 space-y-5">
              <div className="grid gap-3 md:grid-cols-2">
                <label className="space-y-1.5 text-sm">Nome completo<Input value={form.fullName} disabled={formReadOnly} required={!formReadOnly} onChange={(event) => setForm((current) => ({ ...current, fullName: event.target.value, username: usernameWasEdited.current ? current.username : suggestUsername(event.target.value, buildCorporateEmail(event.target.value)) }))} /></label>
                <label className="space-y-1.5 text-sm">Nome de usuário<Input value={form.username} onChange={(event) => { usernameWasEdited.current = true; updateField('username', event.target.value) }} placeholder="primeironomeultimosobrenome" disabled={formReadOnly || !!editingId} required={!formReadOnly && !editingId} /></label>
                <label className="space-y-1.5 text-sm">E-mail corporativo <span className="text-xs text-blue-100/45">{editingId ? 'mantido' : 'calculado'}</span><Input value={effectiveEmail} readOnly aria-readonly="true" /></label>
                <label className="space-y-1.5 text-sm">E-mail pessoal <span className="text-xs text-blue-100/45">{editingId ? 'opcional' : 'obrigatório'}</span><Input type="email" value={form.personalEmail} disabled={formReadOnly} required={!formReadOnly && !editingId} onChange={(event) => updateField('personalEmail', event.target.value)} /></label>
                <label className="space-y-1.5 text-sm">
                  Celular <span className="text-xs text-blue-100/45">{editingId ? 'opcional' : 'obrigatório'}</span>
                  <div className="flex items-center overflow-hidden rounded-md border border-white/10 bg-white/[0.03] focus-within:border-sky-300/60 focus-within:ring-2 focus-within:ring-sky-300/20">
                    <span className="border-r border-white/10 px-3 py-2 text-sm font-semibold text-blue-100/65" aria-hidden="true">+55</span>
                    <Input id="users-mobile-phone" value={formatMobileInput(form.mobilePhone)} disabled={formReadOnly} required={!formReadOnly && !editingId} onChange={(event) => updateField('mobilePhone', storedMobilePhone(event.target.value))} inputMode="numeric" maxLength={15} aria-label="Celular" className="border-0 bg-transparent focus-visible:ring-0" />
                  </div>
                  <span className="block text-xs text-blue-100/45">Somente números: DDD + 9 dígitos. O código +55 é fixo.</span>
                </label>
                <label className="space-y-1.5 text-sm">
                  Departamento <span className="text-xs text-blue-100/45">obrigatório</span>
                  <Select value={form.department} onValueChange={(department) => updateField('department', department)} disabled={formReadOnly}>
                    <SelectTrigger className="w-full" disabled={formReadOnly} aria-label="Departamento" aria-required={!formReadOnly}><SelectValue placeholder="Selecionar departamento" /></SelectTrigger>
                    <SelectContent>{departmentOptions.map((department) => <SelectItem value={department} key={department}>{department}</SelectItem>)}</SelectContent>
                  </Select>
                </label>
                <label className="space-y-1.5 text-sm">
                  Cargo
                  <Select value={form.jobTitle} onValueChange={updateJobTitle} disabled={formReadOnly}>
                    <SelectTrigger className="w-full" disabled={formReadOnly} aria-label="Cargo" aria-required={!formReadOnly}><SelectValue /></SelectTrigger>
                    <SelectContent>{editTitles.map((title) => <SelectItem value={title} key={title}>{title}</SelectItem>)}</SelectContent>
                  </Select>
                </label>
              </div>

              {!editingId && (collisionRequired || form.corporateEmailOverride) && <label className="block space-y-1.5 text-sm">Ajuste do e-mail em caso de colisão<Input type="email" value={form.corporateEmailOverride} disabled={formReadOnly} onChange={(event) => updateField('corporateEmailOverride', event.target.value)} placeholder="primeironomeultimosobrenome2@espacofacial.com" /><span className="block text-xs text-amber-100/70">Use somente após o sistema informar colisão; o ajuste também deve manter o domínio corporativo.</span></label>}

              <div>
                <p className="mb-3 text-xs font-semibold uppercase tracking-[0.14em] text-blue-100/55">Unidades de acesso</p>
                <div className="flex flex-wrap gap-2" role="group" aria-label="Unidades de acesso" aria-required={!formReadOnly}>{selectableUnits.map((unit) => <Button key={unit} type="button" variant="outline" aria-pressed={form.units.includes(unit)} className={unitButtonClass(unit, form.units.includes(unit))} disabled={formReadOnly} onClick={() => toggleUnit(unit)}>{unitLabels[unit] || unit}</Button>)}</div>
                <p className="mt-2 text-xs text-blue-100/45">As unidades disponíveis já começam selecionadas; a cor indica a unidade ativa.</p>
              </div>
            <div className="space-y-4 border-t border-white/10 pt-5">

            <div className="space-y-4">
              {teamConfig.enabled && form.jobTitle === 'Injetor' ? <>
                <section className="rounded-2xl border border-white/10 bg-black/20 p-4" aria-labelledby="team-schedule-title">
                  <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
                    <div className="flex min-w-0 items-start gap-3">
                    <div className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-sky-400/10 text-sky-200"><ListChecks className="size-4" aria-hidden="true" /></div>
                    <div><h3 id="team-schedule-title" className="text-sm font-semibold text-white">Vínculo operacional da Escala</h3><p className="mt-1 text-xs text-blue-100/55">A configuração operacional é liberada somente para o cargo Injetor e sincronizada automaticamente.</p></div>
                    </div>
                    {editingRow && <div className="flex flex-wrap items-center justify-end gap-2" aria-live="polite">
                      <Badge variant={scheduleSyncBadgeVariant(editingRow.scheduleSync?.state)} className="px-2 py-1 text-[10px]">{scheduleSyncLabel(editingRow.scheduleSync?.state)}</Badge>
                      {editingRow.scheduleSync?.errorCode && <span className="text-[11px] text-rose-100/70">{editingRow.scheduleSync.errorCode}</span>}
                      {canManage && <Button type="button" size="sm" variant="outline" disabled={syncingEscala || saving} onClick={() => void syncEscala(editingRow, false)}>
                        <RefreshCw className={`mr-2 size-3.5 ${syncingEscala ? 'animate-spin' : ''}`} aria-hidden="true" />
                        {syncingEscala ? 'Sincronizando…' : editingRow.scheduleSync?.state === 'SYNCED' ? 'Sincronizar novamente' : 'Tentar novamente'}
                      </Button>}
                    </div>}
                  </div>
                  <div className="grid gap-3 md:grid-cols-2">
                    <label className="space-y-1.5 text-sm">
                      Status na Escala <span className="text-xs text-blue-100/45">on/off</span>
                      <div className="flex min-h-9 items-center gap-3 rounded-md border border-white/10 bg-white/[0.03] px-3 py-2">
                        <Switch checked={isScheduleActive(form.scheduleStatus)} disabled={formReadOnly} onCheckedChange={(checked) => updateField('scheduleStatus', checked ? 'Ativo' : 'Inativo')} aria-label="Status na Escala" />
                        <span className={isScheduleActive(form.scheduleStatus) ? 'font-medium text-emerald-100' : 'font-medium text-rose-100'}>{isScheduleActive(form.scheduleStatus) ? 'Ativo' : 'Inativo'}</span>
                      </div>
                    </label>
                    <label className="space-y-1.5 text-sm">
                      Função na Escala <span className="text-xs text-blue-100/45">definida pelo cargo</span>
                      <Input value={form.scheduleRole} disabled={formReadOnly} readOnly={!formReadOnly} aria-readonly="true" />
                    </label>
                    <label className="space-y-1.5 text-sm">Turno<Input value={form.scheduleShift} disabled={formReadOnly} onChange={(event) => updateField('scheduleShift', event.target.value)} /></label>
                    <label className="space-y-1.5 text-sm">Apelido<Input value={form.scheduleNickname} disabled={formReadOnly} onChange={(event) => updateField('scheduleNickname', event.target.value)} /></label>
                    <label className="space-y-1.5 text-sm">Instagram<Input value={form.scheduleInstagram} disabled={formReadOnly} onChange={(event) => updateField('scheduleInstagram', event.target.value)} /></label>
                    <label className="space-y-1.5 text-sm">Cor<Input value={form.scheduleColor} disabled={formReadOnly} onChange={(event) => updateField('scheduleColor', event.target.value)} placeholder="#6d9eeb" /></label>
                 </div>
               </section>
              </> : !teamConfig.enabled ? <div className="rounded-2xl border border-dashed border-white/15 p-4 text-sm text-blue-100/65">O vínculo operacional aparece após a liberação da centralização.</div> : null}
            </div>
          </div>
          </div>

          {submitBlockedMessage && <div className="mt-4 rounded-2xl border border-amber-200/20 bg-amber-300/[0.06] px-3 py-3 text-sm text-amber-50" role="alert">{submitBlockedMessage}</div>}
          <DialogFooter className="border-t border-white/10 pt-4"><Button variant="outline" onClick={() => setOpen(false)}>Fechar</Button>{canManage ? <Button onClick={() => void submit()} disabled={saving}>{saving ? 'Salvando…' : editingId ? 'Salvar alterações' : 'Cadastrar e convidar'}</Button> : <span className="inline-flex items-center gap-2 text-xs text-blue-100/55"><ShieldCheck className="size-4" aria-hidden="true" />Somente leitura</span>}</DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
