import { Component, useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import { AlertTriangle, CalendarClock, CheckCircle2, ChevronRight, CircleDollarSign, RefreshCw, Save, ShieldCheck, UserRoundCheck, UsersRound } from 'lucide-react'
import { Button } from '@/button'
import { useAuth } from '@/contexts'
import {
  createCommercialAction,
  assignCommercialActions,
  commercialCadenceManagerStatuses,
  decideClientIdentityReview,
  fetchCommercialReferences,
  fetchClientIdentityReviewQueue,
  fetchCommercialDataQuality,
  fetchCommercialWallet,
  fetchCommercialProfile,
  isCommercialDataQualityScopeDenied,
  recordCommercialContactPermission,
  undoClientIdentityReview,
  updateCommercialAction,
  updateCommercialDataQualityFinding,
  updateCommercialPolicy,
  upsertCommercialCadence,
  type CommercialAction,
  type CommercialCadenceManagerStatus,
  type CommercialDataQualityFinding,
  type CommercialDataQualityQueue,
  type CommercialDataQualityStatus,
  type CommercialOverview,
  type CommercialProfile,
  type CommercialProfileDetail,
  type ClientIdentityReviewItem,
} from '@/atendimentoApi'
import {
  buildClientesPath,
  parseClientesLocation,
  type ClientesWalletFilters,
  type ClientesWorkspaceView as ClientesRouteView,
} from '@/clientesRoutes'

const currency = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' })
const date = new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo' })
const priorityStyles: Record<string, string> = {
  high: 'border-rose-300/30 bg-rose-500/10 text-rose-100',
  medium: 'border-amber-300/30 bg-amber-500/10 text-amber-100',
  normal: 'border-sky-300/25 bg-sky-500/10 text-sky-100',
}
const unavailableContactEligibility: CommercialProfile['contactEligibility'] = {
  channel: 'whatsapp', status: 'review_required', contactAllowed: false,
  reason: 'commercial_contact_controls_not_ready', controlsReady: false,
  contactWriteControlsReady: false,
  harmoniaChecked: false, hasPhone: false, optOutRecorded: false,
  permissionStatus: 'unknown', evidenceSource: '', evidenceReference: '',
  expiresAt: null, permissionRevision: 0, recordedBy: '', updatedAt: null,
}
const commercialCadenceStatusLabels: Record<CommercialCadenceManagerStatus, string> = {
  draft: 'Rascunho',
  disabled: 'Desativada',
}
const commercialDataQualitySeverityLabels: Record<CommercialDataQualityFinding['severity'], string> = {
  critical: 'Crítica',
  high: 'Alta',
  medium: 'Média',
  low: 'Baixa',
}
const commercialDataQualityStatusLabels: Record<CommercialDataQualityStatus, string> = {
  open: 'Aberta',
  acknowledged: 'Reconhecida',
  in_progress: 'Em andamento',
  resolved: 'Resolvida',
  suppressed: 'Suprimida',
}
const commercialDataQualitySeverityStyles: Record<CommercialDataQualityFinding['severity'], string> = {
  critical: 'border-rose-300/30 bg-rose-500/10 text-rose-100',
  high: 'border-orange-300/30 bg-orange-500/10 text-orange-100',
  medium: 'border-amber-300/30 bg-amber-500/10 text-amber-100',
  low: 'border-sky-300/25 bg-sky-500/10 text-sky-100',
}
const commercialDataQualityFindingLabels: Record<string, string> = {
  'identity.attendance_membership_gap': 'Atendimentos sem identidade consolidada',
  'sales.unclassified_items': 'Itens de venda sem classificação',
  'attendance.future_dates': 'Atendimentos em data futura',
  'identity_review.name_merge_pending': 'Revisões de grafia pendentes',
  'identity_review.attendance_caixa_pending': 'Revisões Atendimento ↔ Caixa pendentes',
  'identity_review.app_attendance_pending': 'Revisões Cadastro ↔ Atendimento pendentes',
  'identity_review.app_caixa_pending': 'Revisões Cadastro ↔ Caixa pendentes',
  'identity_review.lead_app_pending': 'Revisões Planilha ↔ Cadastro pendentes',
  'identity_review.lead_caixa_pending': 'Revisões Planilha ↔ Caixa pendentes',
  'commercial.permission_coverage_missing': 'Identidades sem permissão registrada',
  'commercial.contact_controls_unready': 'Controles de contato indisponíveis',
  'source.app_registration_snapshot_residual': 'Cadastros fora do último snapshot',
  'source.app_registration_snapshot_unverified': 'Escopo do snapshot de cadastro não verificado',
  'source.local_mirror_stale': 'Espelho local desatualizado',
}

function formatDate(value: string | null | undefined) {
  if (!value) return 'Sem registro'
  const parsed = new Date(`${String(value).slice(0, 10)}T12:00:00`)
  return Number.isNaN(parsed.getTime()) ? String(value) : date.format(parsed)
}

function dateTimeLocalValue(value: string | null | undefined) {
  if (!value) return ''
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) return ''
  const pad = (part: number) => String(part).padStart(2, '0')
  return `${parsed.getFullYear()}-${pad(parsed.getMonth() + 1)}-${pad(parsed.getDate())}T${pad(parsed.getHours())}:${pad(parsed.getMinutes())}`
}

function statusLabel(value: string) {
  return ({ open: 'Aberta', contacted: 'Contatado', responded: 'Respondeu', scheduled: 'Agendado', won_sale: 'Venda registrada', returned: 'Retorno clínico', closed: 'Encerrada', cancelled: 'Cancelada' } as Record<string, string>)[value] || value
}

function safeContactEligibility(value: CommercialProfile['contactEligibility'] | null | undefined) {
  return value || unavailableContactEligibility
}

function commercialRolloutAllows(policy: CommercialProfileDetail['policy'], identityId: string) {
  return policy?.commercialContactWritesEnabled === true
    && Array.isArray(policy?.commercialContactCanaryIdentityIds)
    && policy.commercialContactCanaryIdentityIds.includes(identityId)
}

function contactEligibilityLabel(input: CommercialProfile['contactEligibility'] | null | undefined) {
  const value = safeContactEligibility(input)
  if (value.status === 'eligible') return 'WhatsApp permitido'
  if (value.reason === 'harmonia_opt_out') return 'Bloqueado: opt-out registrado'
  if (value.reason === 'commercial_permission_denied') return 'Bloqueado: sem permissão'
  if (value.reason === 'identity_phone_not_confirmed') return 'Revisar: telefone não correlacionado'
  if (value.reason === 'harmonia_contact_source_unavailable') return 'Revisar: bloqueios indisponíveis'
  if (value.reason === 'commercial_contact_controls_not_ready') return 'Revisar: controles não migrados'
  if (value.reason === 'commercial_permission_expired') return 'Revisar: permissão expirada'
  return 'Revisar permissão de WhatsApp'
}

function contactEligibilityStyle(input: CommercialProfile['contactEligibility'] | null | undefined) {
  const value = safeContactEligibility(input)
  if (value.status === 'eligible') return 'border-emerald-300/25 bg-emerald-500/10 text-emerald-100'
  if (value.status === 'blocked') return 'border-rose-300/30 bg-rose-500/10 text-rose-100'
  return 'border-amber-300/25 bg-amber-500/10 text-amber-100'
}

function contactEligibilityTextStyle(input: CommercialProfile['contactEligibility'] | null | undefined) {
  const value = safeContactEligibility(input)
  return value.status === 'eligible' ? 'text-emerald-300' : value.status === 'blocked' ? 'text-rose-300' : 'text-amber-300'
}

function Metric({ label, value, detail, icon: Icon }: { label: string; value: string | number; detail: string; icon: typeof UsersRound }) {
  return <div className="rounded-2xl border border-slate-800/80 bg-slate-950/55 p-4 shadow-[0_20px_60px_rgba(2,6,23,0.28)]">
    <div className="flex items-center gap-2 text-xs font-medium text-slate-400"><Icon className="h-4 w-4 text-sky-300" />{label}</div>
    <div className="mt-2 text-2xl font-semibold tracking-tight text-white">{value}</div>
    <div className="mt-1 text-xs text-slate-500">{detail}</div>
  </div>
}

function SegmentBadge({ profile }: { profile: CommercialProfile }) {
  const primary = profile.segments[0]
  if (!primary) return <span className="text-xs text-slate-500">Sem prioridade</span>
  return <span className={`inline-flex rounded-full border px-2 py-0.5 text-[11px] font-medium ${priorityStyles[profile.priority]}`}>{primary.label}</span>
}

const walletColumnOptions = [
  { key: 'identity', label: 'Referência segura' },
  { key: 'lastAttendance', label: 'Último atendimento' },
  { key: 'lifetimeSales', label: 'Faturamento' },
  { key: 'visits', label: 'Frequência' },
  { key: 'action', label: 'Próxima ação' },
  { key: 'priority', label: 'Prioridade' },
] as const

function safeIdentityLabel(profile: CommercialProfile) {
  return `Cliente ${String(profile.identityId || '').slice(0, 8).toUpperCase() || 'SEM-REF'}`
}

type ClientesWorkspaceView = ClientesRouteView

const clientesWorkspaceViews: Array<{ key: ClientesWorkspaceView; label: string; description: string }> = [
  { key: 'overview', label: 'Visão geral', description: 'Resumo e prioridades consolidadas' },
  { key: 'wallet', label: 'Carteira', description: 'Clientes e contexto individual' },
  { key: 'actions', label: 'Ações', description: 'Fila comercial assistida' },
  { key: 'identities', label: 'Identidades', description: 'Revisões e linhagem' },
  { key: 'quality', label: 'Qualidade', description: 'SLA e controles operacionais' },
  { key: 'governance', label: 'Governança', description: 'Políticas e cadências' },
]

function readClientesWorkspaceView(): ClientesWorkspaceView {
  if (typeof window === 'undefined') return 'overview'
  return parseClientesLocation(window.location).view
}

function ClientesWorkspaceNav({ active, onChange }: { active: ClientesWorkspaceView; onChange: (view: ClientesWorkspaceView) => void }) {
  return <nav aria-label="Áreas do workspace Clientes" role="tablist" data-testid="clientes-workspace-nav" className="flex gap-1 overflow-x-auto rounded-xl border border-slate-800/80 bg-slate-950/45 p-1">
    {clientesWorkspaceViews.map((view) => <button key={view.key} type="button" role="tab" aria-selected={active === view.key} title={view.description} onClick={() => onChange(view.key)} className={`shrink-0 rounded-lg px-3 py-2 text-left text-xs transition ${active === view.key ? 'bg-sky-500/15 text-sky-100 ring-1 ring-sky-400/30' : 'text-slate-400 hover:bg-white/[0.04] hover:text-slate-200'}`}>
      <span className="block font-medium">{view.label}</span><span className="mt-0.5 hidden text-[10px] text-slate-500 sm:block">{view.description}</span>
    </button>)}
  </nav>
}

type ClientesPanelBoundaryProps = {
  label: string
  children: ReactNode
}

type ClientesPanelBoundaryState = { failed: boolean }

class ClientesPanelBoundary extends Component<ClientesPanelBoundaryProps, ClientesPanelBoundaryState> {
  state: ClientesPanelBoundaryState = { failed: false }

  static getDerivedStateFromError() {
    return { failed: true }
  }

  componentDidCatch(error: Error) {
    // Keep operational diagnostics free of identity/contact data. The API
    // error boundary is intentionally local to the panel so other sections
    // remain usable when one dependency is unavailable.
    if (import.meta.env?.DEV) console.error(`[clientes:${this.props.label}]`, error.name)
  }

  render() {
    if (this.state.failed) {
      return <section role="alert" className="rounded-xl border border-rose-300/30 bg-rose-500/10 p-4 text-sm text-rose-100">
        <h2 className="font-semibold">Painel de {this.props.label} indisponível</h2>
        <p className="mt-1 text-xs text-rose-200/80">Os demais painéis continuam disponíveis. Atualize somente este painel quando a dependência voltar.</p>
        <Button size="sm" variant="outline" className="mt-3" onClick={() => this.setState({ failed: false })}>Tentar novamente</Button>
      </section>
    }
    return this.props.children
  }
}

function ActionForm({ detail, units, professionals, onSaved }: { detail: CommercialProfileDetail; units: Array<{ slug: string; name: string }>; professionals: Array<{ name: string }>; onSaved: () => Promise<void> }) {
  const [owner, setOwner] = useState('')
  const [unit, setUnit] = useState('')
  const [actionType, setActionType] = useState<CommercialAction['actionType']>('contact')
  const [dueDate, setDueDate] = useState('')
  const [notes, setNotes] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const firstSegment = detail.profile.segments[0]
  const contactEligibility = safeContactEligibility(detail.profile.contactEligibility)
  const save = async () => {
    try {
      setBusy(true); setError('')
      const result = await createCommercialAction({ identityId: detail.profile.identityId, segmentKey: firstSegment?.key || 'manual_follow_up', actionType, contactChannel: 'whatsapp', owner, dueDate, notes, unit: unit || (units.length === 1 ? units[0].slug : undefined) })
      if (!result.ok) throw new Error(result.error || 'Não foi possível registrar a ação.')
      setNotes(''); setDueDate('')
      await onSaved()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Não foi possível registrar a ação.')
    } finally { setBusy(false) }
  }
  return <section className="border-t border-slate-800/80 pt-4">
    <div className="flex items-center gap-2"><UserRoundCheck className="h-4 w-4 text-emerald-300" /><h3 className="text-sm font-semibold text-white">Registrar ação assistida</h3></div>
    <p className="mt-1 text-xs text-slate-500">Nenhuma mensagem será enviada automaticamente. Uma fila interna pode ser registrada enquanto a permissão é revisada.</p>
    <div className={`mt-3 rounded-lg border p-2 text-xs ${contactEligibilityStyle(contactEligibility)}`}>{contactEligibilityLabel(contactEligibility)}</div>
    <div className="mt-3 grid gap-2 sm:grid-cols-2">
      <select value={owner} onChange={(event) => setOwner(event.target.value)} className="rounded-lg border border-slate-800 bg-slate-900/70 px-3 py-2 text-sm text-slate-100"><option value="">Responsável</option>{professionals.map((person) => <option key={person.name} value={person.name}>{person.name}</option>)}</select>
      <select value={actionType} onChange={(event) => setActionType(event.target.value as CommercialAction['actionType'])} className="rounded-lg border border-slate-800 bg-slate-900/70 px-3 py-2 text-sm text-slate-100"><option value="contact">Contato consultivo</option><option value="follow_up">Acompanhamento</option><option value="appointment">Agendamento</option><option value="relationship">Relacionamento</option></select>
      <select value={unit} onChange={(event) => setUnit(event.target.value)} className="rounded-lg border border-slate-800 bg-slate-900/70 px-3 py-2 text-sm text-slate-100"><option value="">Unidade vinculada</option>{units.map((item) => <option key={item.slug} value={item.slug}>{item.name}</option>)}</select>
      <input type="date" aria-label="Data prevista" value={dueDate} onChange={(event) => setDueDate(event.target.value)} className="rounded-lg border border-slate-800 bg-slate-900/70 px-3 py-2 text-sm text-slate-100" />
      <Button size="sm" onClick={() => void save()} disabled={busy || !firstSegment || !contactEligibility.contactWriteControlsReady} className="bg-emerald-500 text-slate-950 hover:bg-emerald-400 sm:col-span-2"><Save className="mr-2 h-4 w-4" />Adicionar à fila</Button>
    </div>
    {!contactEligibility.contactWriteControlsReady ? <p className="mt-2 text-xs text-amber-200">A fila depende da migration de cadência de contato; nenhuma ação nova será criada antes dela.</p> : null}
    <textarea value={notes} onChange={(event) => setNotes(event.target.value)} placeholder="Contexto, combinado ou observação para a equipe" className="mt-2 min-h-20 w-full rounded-lg border border-slate-800 bg-slate-900/70 px-3 py-2 text-sm text-slate-100 placeholder:text-slate-500" />
    {error ? <div className="mt-2 text-xs text-rose-200">{error}</div> : null}
  </section>
}

function ActionHistory({ actions, contactEligibility, contactRolloutAllowed, onUpdated }: { actions: CommercialAction[]; contactEligibility: CommercialProfile['contactEligibility']; contactRolloutAllowed: boolean; onUpdated: () => Promise<void> }) {
  const [busyId, setBusyId] = useState('')
  const [error, setError] = useState('')
  const changeStatus = async (action: CommercialAction, status: CommercialAction['status']) => {
    try {
      setBusyId(action.id); setError('')
      const result = await updateCommercialAction(action.id, { status })
      if (!result.ok) throw new Error(result.error || 'Não foi possível atualizar a ação.')
      await onUpdated()
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Não foi possível atualizar a ação.') } finally { setBusyId('') }
  }
  return <section className="border-t border-slate-800/80 pt-4">
    <h3 className="text-sm font-semibold text-white">Histórico de ações</h3>
    {!actions.length ? <p className="mt-2 text-sm text-slate-500">Nenhuma ação registrada para este cliente.</p> : <div className="mt-3 space-y-2">{actions.map((action) => {
      const canMarkContactedOnAction = !action.contactedAt || action.status === 'contacted'
      const contactOptionDisabled = !contactEligibility.contactAllowed || !contactEligibility.contactWriteControlsReady || !contactRolloutAllowed || !canMarkContactedOnAction
      const contactOptionHint = !contactEligibility.contactWriteControlsReady
        ? '(controles de cadência indisponíveis)'
        : !canMarkContactedOnAction
        ? '(já registrado; crie nova ação)'
        : contactEligibility.contactAllowed && contactRolloutAllowed ? '' : '(requer permissão e canário)'
      return <div key={action.id} className="rounded-xl border border-slate-800/80 bg-slate-900/40 p-3">
      <div className="flex items-center justify-between gap-2"><span className="text-sm font-medium text-slate-100">{statusLabel(action.status)}</span><span className="text-xs text-slate-500">{formatDate(action.createdAt)}</span></div>
      <div className="mt-1 text-xs text-slate-400">{action.owner || 'Sem responsável'} · {action.segmentKey}</div>
      {action.contactedAt ? <div className="mt-1 text-xs text-emerald-300">Contato registrado em {formatDate(action.contactedAt)}</div> : null}
      {action.notes ? <div className="mt-2 text-xs text-slate-300">{action.notes}</div> : null}
      {['open', 'contacted', 'responded', 'scheduled'].includes(action.status) ? <select disabled={busyId === action.id} value={action.status} onChange={(event) => void changeStatus(action, event.target.value as CommercialAction['status'])} className="mt-2 w-full rounded-lg border border-slate-800 bg-slate-950 px-2 py-1.5 text-xs text-slate-200"><option value="open">Aberta</option><option value="contacted" disabled={contactOptionDisabled}>Contatado {contactOptionHint}</option><option value="responded">Respondeu</option><option value="scheduled">Agendado</option><option value="won_sale">Venda registrada</option><option value="returned">Retorno clínico</option><option value="closed">Encerrada</option><option value="cancelled">Cancelada</option></select> : null}
    </div>})}</div>}
    {error ? <div className="mt-2 text-xs text-rose-200">{error}</div> : null}
  </section>
}

function ContactPermission({ profile, contactRolloutAllowed, onSaved }: { profile: CommercialProfile; contactRolloutAllowed: boolean; onSaved: () => Promise<void> }) {
  const current = safeContactEligibility(profile.contactEligibility)
  const [status, setStatus] = useState<'granted' | 'denied'>(current.permissionStatus === 'denied' ? 'denied' : 'granted')
  const [source, setSource] = useState(current.evidenceSource)
  const [evidenceReference, setEvidenceReference] = useState(current.evidenceReference)
  const [expiresAt, setExpiresAt] = useState(dateTimeLocalValue(current.expiresAt))
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState('')
  const save = async () => {
    try {
      setBusy(true); setNotice('')
      const parsedExpiry = expiresAt ? new Date(expiresAt) : null
      if (parsedExpiry && Number.isNaN(parsedExpiry.getTime())) throw new Error('A expiração da permissão é inválida.')
      const result = await recordCommercialContactPermission(profile.identityId, {
        status,
        source,
        evidenceReference,
        expectedRevision: current.permissionRevision,
        expiresAt: status === 'granted' && parsedExpiry ? parsedExpiry.toISOString() : undefined,
      })
      if (!result.ok) {
        if (result.error === 'COMMERCIAL_CONTACT_PERMISSION_CONFLICT') {
          await onSaved()
          throw new Error('A permissão foi alterada por outra pessoa. O perfil foi recarregado antes de uma nova tentativa.')
        }
        throw new Error(result.error || 'Não foi possível registrar a permissão.')
      }
      setNotice('Permissão registrada com evento de auditoria.')
      await onSaved()
    } catch (cause) { setNotice(cause instanceof Error ? cause.message : 'Não foi possível registrar a permissão.') } finally { setBusy(false) }
  }
  return <section className="border-t border-slate-800/80 pt-4">
    <h3 className="text-sm font-semibold text-white">Permissão de contato</h3>
    <p className="mt-1 text-xs text-slate-500">WhatsApp só fica apto com registro explícito, telefone correlacionado e nenhum opt-out no Harmonia. Permissões concedidas podem receber expiração.</p>
    {!current.contactWriteControlsReady ? <p className="mt-1 text-xs text-amber-200">A concessão aguarda a migration de cadência. Um bloqueio de contato continua disponível.</p> : !contactRolloutAllowed ? <p className="mt-1 text-xs text-amber-200">A concessão permanece bloqueada fora do canário. Um bloqueio de contato continua disponível.</p> : null}
    <div className={`mt-3 rounded-lg border p-2 text-xs ${contactEligibilityStyle(current)}`}>{contactEligibilityLabel(current)}</div>
    <div className="mt-3 grid gap-2 sm:grid-cols-2">
      <select value={status} onChange={(event) => { const next = event.target.value as 'granted' | 'denied'; setStatus(next); if (next === 'denied') setExpiresAt('') }} className="rounded-lg border border-slate-800 bg-slate-900/70 px-3 py-2 text-sm text-slate-100"><option value="granted" disabled={!current.contactWriteControlsReady}>Permitir contato</option><option value="denied">Bloquear contato</option></select>
      <input value={source} onChange={(event) => setSource(event.target.value)} placeholder="Fonte da evidência" maxLength={120} className="rounded-lg border border-slate-800 bg-slate-900/70 px-3 py-2 text-sm text-slate-100 placeholder:text-slate-500" />
      <input value={evidenceReference} onChange={(event) => setEvidenceReference(event.target.value)} placeholder="Referência da evidência" maxLength={512} className="rounded-lg border border-slate-800 bg-slate-900/70 px-3 py-2 text-sm text-slate-100 placeholder:text-slate-500 sm:col-span-2" />
      {status === 'granted' ? <label className="text-xs text-slate-400 sm:col-span-2">Expira em (opcional)<input aria-label="Expiração da permissão" type="datetime-local" value={expiresAt} onChange={(event) => setExpiresAt(event.target.value)} className="mt-1 w-full rounded-lg border border-slate-800 bg-slate-900/70 px-3 py-2 text-sm text-slate-100" /></label> : null}
    </div>
    <Button size="sm" variant="outline" onClick={() => void save()} disabled={busy || !source.trim() || !evidenceReference.trim() || !current.controlsReady || (status === 'granted' && (!current.contactWriteControlsReady || !contactRolloutAllowed))} className="mt-3"><ShieldCheck className="mr-2 h-4 w-4" />Registrar permissão</Button>
    {notice ? <div className={`mt-2 text-xs ${notice.startsWith('Permissão') ? 'text-emerald-200' : 'text-rose-200'}`}>{notice}</div> : null}
  </section>
}

function ProfilePanel({ detail, units, professionals, onRefresh, onClose }: { detail: CommercialProfileDetail | null; units: Array<{ slug: string; name: string }>; professionals: Array<{ name: string }>; onRefresh: () => Promise<void>; onClose?: () => void }) {
  useEffect(() => {
    if (!onClose) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [onClose])
  if (!detail) return <aside aria-label="Perfil do cliente" className="rounded-2xl border border-slate-800/80 bg-slate-950/45 p-5 text-sm text-slate-500">Carregando perfil seguro…</aside>
  const { profile } = detail
  const timeline = Array.isArray(detail.timeline) ? detail.timeline : []
  const contactEligibility = safeContactEligibility(profile.contactEligibility)
  const contactRolloutAllowed = detail.policy.commercialContactWriteControlsReady === true && commercialRolloutAllows(detail.policy, profile.identityId)
  return <aside role="dialog" aria-modal="true" aria-label="Perfil do cliente" className="fixed inset-x-0 bottom-0 top-16 z-30 overflow-y-auto space-y-5 border border-slate-800/80 bg-slate-950 p-5 shadow-2xl lg:sticky lg:top-4 lg:h-[calc(100vh-8rem)] lg:rounded-2xl lg:bg-slate-950/55">
    <div><div className="flex items-start justify-between gap-3"><div><h2 className="text-lg font-semibold text-white">{profile.name}</h2><div className="mt-1 text-xs text-slate-400">{profile.contactEligibility?.hasPhone ? 'Contato confirmado para uso interno' : 'Contato ainda não confirmado'}</div></div><div className="flex items-center gap-2">{<SegmentBadge profile={profile} />}{onClose ? <Button size="sm" variant="ghost" onClick={onClose} aria-label="Fechar perfil e voltar para a carteira">Fechar</Button> : null}</div></div><p className="mt-3 text-sm text-slate-300">{profile.recommendedAction}</p></div>
    <div className="grid grid-cols-2 gap-2"><Fact label="Último atendimento" value={profile.lastAttendance ? formatDate(profile.lastAttendance) : 'Sem registro'} /><Fact label="Dias sem presença" value={profile.recencyDays == null ? '—' : String(profile.recencyDays)} /><Fact label="Faturamento" value={currency.format(profile.lifetimeSales)} /><Fact label="Ticket médio" value={currency.format(profile.ticketAverage)} /><Fact label="Visitas" value={String(profile.visitCount)} /><Fact label="Procedimentos" value={String(profile.procedureCount)} /></div>
    <section className="border-t border-slate-800/80 pt-4"><h3 className="text-sm font-semibold text-white">Histórico confirmado</h3><List label="Procedimentos realizados" values={profile.completedProcedures} empty="Sem procedimentos confirmados." /><List label="Procedimentos comprados classificados" values={profile.purchasedProcedures} empty="Sem itens classificados." />{profile.pendingSaleItems ? <div className="mt-3 flex items-start gap-2 rounded-lg border border-amber-300/20 bg-amber-500/10 p-2 text-xs text-amber-100"><AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />{profile.pendingSaleItems} item(ns) de venda seguem sem classificação e não entram em sugestão de procedimento.</div> : null}</section>
    <section className="border-t border-slate-800/80 pt-4"><div className="flex items-center justify-between gap-3"><h3 className="text-sm font-semibold text-white">Customer 360</h3><span className="text-[11px] text-slate-500">{timeline.length} evento(s) confirmados</span></div>{timeline.length ? <ol className="mt-3 space-y-2">{timeline.map((event) => <li key={event.id} className="rounded-lg border border-slate-800/80 bg-slate-900/45 p-2.5"><div className="flex items-start justify-between gap-3 text-[11px]"><span className={`rounded-full px-2 py-0.5 ${event.type === 'sale' ? 'bg-violet-500/15 text-violet-200' : 'bg-emerald-500/15 text-emerald-200'}`}>{event.type === 'sale' ? 'Caixa' : 'Atendimento'}</span><span className="text-slate-500">{formatDate(event.occurredOn)}</span></div><div className="mt-2 text-xs font-medium text-slate-100">{event.title}</div>{event.detail ? <div className="mt-0.5 text-[11px] text-slate-400">{event.detail}</div> : null}<div className="mt-1 flex flex-wrap gap-x-2 text-[11px] text-slate-500"><span>{event.unitName || 'Unidade não informada'}</span>{event.amount != null ? <span>· {currency.format(event.amount)}</span> : null}</div></li>)}</ol> : <p className="mt-2 text-xs text-slate-500">Nenhum evento confirmado no recorte selecionado.</p>}</section>
    <section className="border-t border-slate-800/80 pt-4"><h3 className="text-sm font-semibold text-white">Cadência clínica</h3>{detail.clinicalCadences.length ? <div className="mt-2 space-y-2">{detail.clinicalCadences.map((cadence) => <div key={`${cadence.procedureId}:${cadence.unitSlug}`} className="text-xs text-slate-300"><span className="font-medium text-slate-100">{cadence.procedureName}</span> · {cadence.status === 'approved' ? `regra aprovada: ${cadence.cadenceDays} dias` : 'sem regra aprovada'}</div>)}</div> : <p className="mt-2 text-xs text-slate-500">Nenhuma cadência aprovada. A plataforma não fará recomendação clínica.</p>}</section>
    <ContactPermission key={`${profile.identityId}:${contactEligibility.permissionRevision}`} profile={profile} contactRolloutAllowed={contactRolloutAllowed} onSaved={onRefresh} />
    <ActionForm detail={detail} units={units} professionals={professionals} onSaved={onRefresh} />
    <ActionHistory actions={detail.actions} contactEligibility={contactEligibility} contactRolloutAllowed={contactRolloutAllowed} onUpdated={onRefresh} />
  </aside>
}

function Fact({ label, value }: { label: string; value: string }) { return <div className="rounded-xl border border-slate-800/80 bg-slate-900/45 p-2.5"><div className="text-[11px] text-slate-500">{label}</div><div className="mt-1 truncate text-sm font-medium text-slate-100">{value}</div></div> }
function List({ label, values, empty }: { label: string; values: string[]; empty: string }) { return <div className="mt-3"><div className="text-xs text-slate-500">{label}</div><div className="mt-1 text-sm text-slate-200">{values.length ? values.join(', ') : empty}</div></div> }

function commercialDataQualitySlaLabel(finding: CommercialDataQualityFinding) {
  if (finding.status === 'resolved') return finding.resolvedAt ? `Resolvida em ${formatDate(finding.resolvedAt)}` : 'Resolvida'
  if (!finding.slaDueAt) return finding.observedCount ? 'SLA ainda não definido' : 'Sem ocorrência atual'
  const dueAt = new Date(finding.slaDueAt)
  if (Number.isNaN(dueAt.getTime())) return 'SLA indisponível'
  return dueAt.getTime() < Date.now() ? `SLA vencido em ${formatDate(finding.slaDueAt)}` : `SLA até ${formatDate(finding.slaDueAt)}`
}

function CommercialDataQualityPanel({ queue, loading, onRefresh }: {
  queue: CommercialDataQualityQueue
  loading: boolean
  onRefresh: () => Promise<void>
}) {
  const [ownerDrafts, setOwnerDrafts] = useState<Record<string, string>>({})
  const [acting, setActing] = useState('')
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const mutate = async (finding: CommercialDataQualityFinding, patch: Omit<Parameters<typeof updateCommercialDataQualityFinding>[1], 'expectedRevision'>, success: string) => {
    try {
      setActing(finding.id); setError(''); setNotice('')
      const result = await updateCommercialDataQualityFinding(finding.id, { expectedRevision: finding.revision, ...patch })
      if (!result.ok) {
        if (result.error === 'COMMERCIAL_DATA_QUALITY_FINDING_CONFLICT') {
          await onRefresh()
          throw new Error('Este item foi atualizado por outra pessoa. A fila foi recarregada antes de uma nova tentativa.')
        }
        throw new Error(result.error || 'Não foi possível atualizar a fila de qualidade.')
      }
      setOwnerDrafts((current) => ({ ...current, [finding.id]: result.finding.owner }))
      setNotice(success)
      await onRefresh()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Não foi possível atualizar a fila de qualidade.')
    } finally {
      setActing('')
    }
  }
  const assignOwner = (finding: CommercialDataQualityFinding) => {
    const owner = (ownerDrafts[finding.id] ?? finding.owner).trim()
    if (owner === finding.owner) { setNotice('O responsável já está atualizado nesta fila.'); return }
    void mutate(finding, { owner }, owner ? 'Responsável atualizado com auditoria.' : 'Responsável removido com auditoria.')
  }

  return <section aria-labelledby="commercial-data-quality-heading" className="rounded-2xl border border-slate-800/80 bg-slate-950/55 p-5 shadow-[0_20px_60px_rgba(2,6,23,0.28)]">
    <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between"><div><h2 id="commercial-data-quality-heading" className="text-lg font-semibold text-white">Qualidade operacional</h2><p className="mt-1 text-sm text-slate-500">Indicadores agregados da fila consolidada. Esta visão não expõe dados de contato nem dados pessoais de clientes.</p></div><Button size="sm" variant="outline" onClick={() => void onRefresh()} disabled={loading || Boolean(acting)}><RefreshCw className={`mr-2 h-4 w-4 ${loading ? 'animate-spin' : ''}`} />Atualizar painel</Button></div>
    <div className="mt-4 grid gap-2 sm:grid-cols-2 xl:grid-cols-4"><Fact label="Ocorrências atuais" value={String(queue.metrics.currentFindings)} /><Fact label="SLA vencido" value={String(queue.metrics.overdue)} /><Fact label="Sem responsável" value={String(queue.metrics.unassigned)} /><Fact label="Itens na fila" value={String(queue.total)} /></div>
    {error ? <div className="mt-3 rounded-lg border border-rose-300/30 bg-rose-500/10 p-3 text-sm text-rose-100">{error}</div> : null}
    {notice ? <div className="mt-3 rounded-lg border border-emerald-300/25 bg-emerald-500/10 p-3 text-sm text-emerald-100">{notice}</div> : null}
    <div className="mt-4 space-y-3">{queue.findings.map((finding) => {
      const isActing = acting === finding.id
      const owner = ownerDrafts[finding.id] ?? finding.owner
      const canResolve = finding.observedCount === 0 && finding.status !== 'resolved'
      return <article key={finding.id} className="rounded-xl border border-slate-800/80 bg-slate-900/35 p-4"><div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between"><div><div className="flex flex-wrap items-center gap-2"><h3 className="text-sm font-semibold text-white">{commercialDataQualityFindingLabels[finding.findingKey] || 'Controle de qualidade'}</h3><span className={`rounded-full border px-2 py-0.5 text-[11px] font-medium ${commercialDataQualitySeverityStyles[finding.severity]}`}>{commercialDataQualitySeverityLabels[finding.severity]}</span><span className="text-xs text-slate-400">{commercialDataQualityStatusLabels[finding.status]}</span></div><div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-400"><span><span className="text-slate-500">Ocorrências:</span> {finding.observedCount}</span><span><span className="text-slate-500">{commercialDataQualitySlaLabel(finding)}</span></span><span><span className="text-slate-500">Revisão:</span> {finding.revision}</span></div></div><div className="grid gap-2 sm:grid-cols-[minmax(0,13rem)_auto] lg:min-w-96"><input aria-label={`Responsável por ${commercialDataQualityFindingLabels[finding.findingKey] || 'controle de qualidade'}`} value={owner} maxLength={160} onChange={(event) => setOwnerDrafts((current) => ({ ...current, [finding.id]: event.target.value }))} placeholder="Responsável pela fila" disabled={isActing || loading} className="rounded-lg border border-slate-800 bg-slate-950 px-3 py-2 text-sm text-slate-100 placeholder:text-slate-500" /><Button size="sm" variant="outline" onClick={() => assignOwner(finding)} disabled={isActing || loading || owner.trim() === finding.owner}>Atribuir</Button></div></div><div className="mt-3 flex flex-wrap gap-2 border-t border-slate-800/70 pt-3">{finding.status === 'open' ? <Button size="sm" variant="outline" onClick={() => void mutate(finding, { status: 'acknowledged' }, 'Ocorrência reconhecida com auditoria.')} disabled={isActing || loading}>Reconhecer</Button> : null}{finding.status !== 'in_progress' && finding.status !== 'resolved' && finding.status !== 'suppressed' ? <Button size="sm" variant="outline" onClick={() => void mutate(finding, { status: 'in_progress' }, 'Ocorrência marcada como em andamento.')} disabled={isActing || loading}>Em andamento</Button> : null}{canResolve ? <Button size="sm" onClick={() => void mutate(finding, { status: 'resolved' }, 'Ocorrência resolvida com auditoria.')} disabled={isActing || loading}>Resolver</Button> : null}{finding.observedCount > 0 && finding.status !== 'resolved' ? <span className="self-center text-xs text-slate-500">A resolução permanece bloqueada enquanto a ocorrência estiver ativa.</span> : null}</div></article>
    })}{!queue.findings.length ? <p className="py-6 text-center text-sm text-slate-500">Nenhuma ocorrência de qualidade disponível nesta fila.</p> : null}</div>
  </section>
}

const reviewTypeLabel: Record<ClientIdentityReviewItem['type'], string> = { attendance_name_merge: 'Grafia no Atendimento', attendance_caixa: 'Atendimento ↔ Caixa', app_attendance: 'Cadastro app ↔ Atendimento', app_caixa: 'Cadastro app ↔ Caixa', lead_app: 'Planilha ↔ Cadastro app', lead_caixa: 'Planilha ↔ Caixa' }
function reviewValue(value: unknown) { return Array.isArray(value) ? value.filter(Boolean).join(', ') : typeof value === 'string' || typeof value === 'number' ? String(value) : '' }

function reviewItemKey(item: ClientIdentityReviewItem) { return `${item.type}:${item.sourceId}:${item.targetId}` }
function reviewDecisionLabel(item: ClientIdentityReviewItem) {
  if (item.decisionState === 'resolved') return 'Decisão vigente'
  if (item.decisionState === 'stale') return 'Evidência atualizada — refaça a revisão'
  return item.status === 'ambiguous' ? 'Ambíguo' : 'Sugestão'
}

export function IdentityReviewQueue() {
  const [items, setItems] = useState<ClientIdentityReviewItem[]>([])
  const [total, setTotal] = useState(0)
  const [type, setType] = useState('')
  const [search, setSearch] = useState('')
  const [includeResolved, setIncludeResolved] = useState(false)
  const [drafts, setDrafts] = useState<Record<string, { reason: string; survivorClientId: string }>>({})
  const [acting, setActing] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [writesReady, setWritesReady] = useState(false)
  const load = useCallback(async (offset = 0, append = false) => {
    try {
      setBusy(true); setError('')
      const result = await fetchClientIdentityReviewQueue({
        type: type as ClientIdentityReviewItem['type'] || undefined,
        q: search,
        includeResolved,
        limit: 100,
        offset,
      })
      if (!result.ok) throw new Error(result.error || 'Não foi possível carregar a revisão.')
      setItems((current) => append ? [...current, ...result.items] : result.items)
      setTotal(result.total)
      setWritesReady(result.workflow?.writesReady === true)
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Não foi possível carregar a revisão.') } finally { setBusy(false) }
  }, [includeResolved, search, type])
  useEffect(() => { void load() }, [load])
  const updateDraft = (item: ClientIdentityReviewItem, patch: Partial<{ reason: string; survivorClientId: string }>) => {
    const key = reviewItemKey(item)
    setDrafts((current) => ({ ...current, [key]: { reason: current[key]?.reason || '', survivorClientId: current[key]?.survivorClientId || '', ...patch } }))
  }
  const decide = async (item: ClientIdentityReviewItem, decision: 'confirmed' | 'rejected') => {
    const key = reviewItemKey(item)
    const draft = drafts[key] || { reason: '', survivorClientId: '' }
    if (draft.reason.trim().length < 3) { setError('Informe o motivo da decisão para preservar a trilha de auditoria.'); return }
    if (item.type === 'attendance_name_merge' && decision === 'confirmed' && !draft.survivorClientId) { setError('Escolha qual cliente canônico será mantido antes de confirmar a unificação.'); return }
    try {
      setActing(key); setError(''); setNotice('')
      const result = await decideClientIdentityReview(item.type, {
        sourceId: item.sourceId,
        targetId: item.targetId,
        expectedVersion: item.version,
        decision,
        reason: draft.reason.trim(),
        survivorClientId: item.type === 'attendance_name_merge' && decision === 'confirmed' ? draft.survivorClientId : undefined,
      })
      if (!result.ok) throw new Error(result.error || 'Não foi possível registrar a decisão.')
      const moved = Number(result.materialization?.summary?.membersMoved || 0)
      setNotice(decision === 'confirmed'
        ? `Decisão confirmada com auditoria. ${moved ? `${moved} vínculo(s) foram rematerializados.` : 'Nenhum vínculo adicional precisou ser movido.'}`
        : 'Decisão de rejeição registrada com auditoria; a correspondência não foi unificada.')
      setDrafts((current) => { const next = { ...current }; delete next[key]; return next })
      await load()
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Não foi possível registrar a decisão.') } finally { setActing('') }
  }
  const undo = async (item: ClientIdentityReviewItem) => {
    const key = reviewItemKey(item)
    const draft = drafts[key] || { reason: '', survivorClientId: '' }
    if (draft.reason.trim().length < 3) { setError('Informe o motivo do desfazimento para preservar a trilha de auditoria.'); return }
    try {
      setActing(key); setError(''); setNotice('')
      const result = await undoClientIdentityReview(item.type, {
        sourceId: item.sourceId,
        targetId: item.targetId,
        expectedVersion: item.version,
        reason: draft.reason.trim(),
      })
      if (!result.ok) throw new Error(result.error || 'Não foi possível desfazer a decisão.')
      setNotice('Decisão desfeita com uma nova entrada de auditoria. A correspondência voltou para revisão.')
      setDrafts((current) => { const next = { ...current }; delete next[key]; return next })
      await load()
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Não foi possível desfazer a decisão.') } finally { setActing('') }
  }
  return <section className="rounded-2xl border border-slate-800/80 bg-slate-950/55 p-5 shadow-[0_20px_60px_rgba(2,6,23,0.28)]">
    <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between"><div><h2 className="text-lg font-semibold text-white">Revisão de correspondências</h2><p className="mt-1 text-sm text-slate-500">{items.length} de {total} correspondência(s) com evidências de cada fonte. Confirmações alteram apenas a projeção consolidada, com trilha e desfazimento auditáveis.</p></div><Button size="sm" variant="outline" onClick={() => void load()} disabled={busy}><RefreshCw className={`mr-2 h-4 w-4 ${busy ? 'animate-spin' : ''}`} />Atualizar</Button></div>
    {!writesReady ? <div className="mt-3 rounded-lg border border-amber-300/25 bg-amber-500/10 p-3 text-xs text-amber-100">A fila pode ser consultada, mas decisões permanecem bloqueadas até a migration explícita de revisão de identidades neste ambiente.</div> : null}
    <div className="mt-4 flex flex-wrap items-center gap-2"><select aria-label="Origem da correspondência" value={type} onChange={(event) => setType(event.target.value)} className="rounded-lg border border-slate-800 bg-slate-900 px-3 py-2 text-sm text-slate-100"><option value="">Todas as origens</option>{Object.entries(reviewTypeLabel).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select><input aria-label="Buscar correspondência" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Buscar nome, telefone ou evidência" className="min-w-64 flex-1 rounded-lg border border-slate-800 bg-slate-900 px-3 py-2 text-sm text-slate-100 placeholder:text-slate-500" /><label className="flex items-center gap-2 px-1 text-xs text-slate-400"><input type="checkbox" checked={includeResolved} onChange={(event) => setIncludeResolved(event.target.checked)} />Exibir decisões vigentes</label><Button size="sm" onClick={() => void load()} disabled={busy}>Aplicar</Button></div>
    {error ? <div className="mt-3 rounded-lg border border-rose-300/30 bg-rose-500/10 p-3 text-sm text-rose-100">{error}</div> : null}
    {notice ? <div className="mt-3 rounded-lg border border-emerald-300/25 bg-emerald-500/10 p-3 text-sm text-emerald-100">{notice}</div> : null}
    <div className="mt-4 space-y-3">{items.map((item) => {
      const key = reviewItemKey(item)
      const draft = drafts[key] || { reason: '', survivorClientId: '' }
      const isActing = acting === key
      const undoable = item.decisionState === 'resolved' || item.decisionState === 'stale'
      return <article key={key} className="rounded-xl border border-slate-800/80 bg-slate-900/35 p-4"><div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between"><div><div className="text-xs text-sky-300">{reviewTypeLabel[item.type]}</div><div className="mt-1 text-sm font-semibold text-white">{item.primaryName} <span className="mx-1 text-slate-600">↔</span> {item.secondaryName}</div></div><div className={`text-xs ${item.decisionState === 'stale' ? 'text-amber-200' : 'text-slate-400'}`}>{reviewDecisionLabel(item)} · confiança {Math.round(item.confidence * 100)}%</div></div><div className="mt-3 grid gap-2 text-xs text-slate-400 md:grid-cols-2"><div><span className="text-slate-500">Contexto: </span>{Object.entries(item.context).map(([entryKey, value]) => { const shown = reviewValue(value); return shown ? <span key={entryKey} className="mr-3 inline-block">{entryKey}: <span className="text-slate-200">{shown}</span></span> : null })}</div><div><span className="text-slate-500">Evidência: </span>{Object.entries(item.evidence).map(([entryKey, value]) => { const shown = reviewValue(value); return shown ? <span key={entryKey} className="mr-3 inline-block">{entryKey}: <span className="text-slate-200">{shown}</span></span> : null })}</div></div>{item.decisionState === 'stale' ? <p className="mt-3 text-xs text-amber-200">A fonte mudou depois da última decisão. Desfaça-a explicitamente e registre um novo motivo antes de revisar de novo.</p> : null}<div className="mt-3 grid gap-2 border-t border-slate-800/70 pt-3 md:grid-cols-[minmax(0,1fr)_auto]">{item.type === 'attendance_name_merge' && !undoable ? <select aria-label={`Cliente sobrevivente para ${item.primaryName}`} value={draft.survivorClientId} onChange={(event) => updateDraft(item, { survivorClientId: event.target.value })} disabled={!writesReady || isActing} className="rounded-lg border border-slate-800 bg-slate-950 px-3 py-2 text-sm text-slate-100"><option value="">Escolha o cliente canônico a manter</option><option value={item.sourceId}>Manter {item.primaryName}</option><option value={item.targetId}>Manter {item.secondaryName}</option></select> : null}<input aria-label={`Motivo da decisão para ${item.primaryName}`} value={draft.reason} onChange={(event) => updateDraft(item, { reason: event.target.value })} placeholder={undoable ? 'Motivo do desfazimento' : 'Motivo da decisão'} maxLength={1000} disabled={!writesReady || isActing} className="rounded-lg border border-slate-800 bg-slate-950 px-3 py-2 text-sm text-slate-100 placeholder:text-slate-500" /><div className="flex flex-wrap gap-2 md:justify-end">{undoable ? <Button size="sm" variant="outline" onClick={() => void undo(item)} disabled={!writesReady || isActing || draft.reason.trim().length < 3}>Desfazer decisão</Button> : <><Button size="sm" onClick={() => void decide(item, 'confirmed')} disabled={!writesReady || isActing || draft.reason.trim().length < 3 || (item.type === 'attendance_name_merge' && !draft.survivorClientId)}>Confirmar</Button><Button size="sm" variant="outline" onClick={() => void decide(item, 'rejected')} disabled={!writesReady || isActing || draft.reason.trim().length < 3}>Rejeitar</Button></>}</div></div></article>
    })}{!busy && !items.length ? <p className="py-6 text-center text-sm text-slate-500">Nenhuma sugestão encontrada para estes filtros.</p> : null}</div>
    {items.length < total ? <div className="mt-4 text-center"><Button size="sm" variant="outline" onClick={() => void load(items.length, true)} disabled={busy}>Carregar mais 100</Button></div> : null}
  </section>
}

function CanarySelection({ profiles, selectedIds, disabled, onToggle, onClear }: {
  profiles: CommercialOverview['profiles']
  selectedIds: string[]
  disabled: boolean
  onToggle: (identityId: string) => void
  onClear: () => void
}) {
  const candidates = profiles.filter((profile) => profile.contactEligibility?.contactAllowed === true).slice(0, 24)
  return <div className="mt-2 rounded-lg border border-slate-800 bg-slate-900/60 p-3">
    <div className="flex items-start justify-between gap-3"><div><div className="text-xs font-medium text-slate-300">Seleção assistida do canário</div><p className="mt-1 text-xs text-slate-500">Escolha identidades visíveis e aptas para contato. A seleção é auditada; nenhum UUID é digitado e nenhuma mensagem é enviada.</p></div><Button size="sm" variant="ghost" onClick={onClear} disabled={disabled || !selectedIds.length}>Limpar</Button></div>
    {candidates.length ? <div className="mt-3 grid gap-2 sm:grid-cols-2">{candidates.map((profile) => <label key={profile.identityId} className="flex items-start gap-2 rounded-md border border-slate-800/80 p-2 text-xs text-slate-300 hover:border-sky-400/40"><input type="checkbox" checked={selectedIds.includes(profile.identityId)} disabled={disabled} onChange={() => onToggle(profile.identityId)} className="mt-0.5" aria-label={`Selecionar ${profile.name} para o canário`} /><span className="min-w-0"><span className="block truncate text-slate-100">{profile.name}</span><span className="block text-[11px] text-emerald-300">{contactEligibilityLabel(profile.contactEligibility)}</span></span></label>)}</div> : <p className="mt-3 text-xs text-amber-200">Nenhuma identidade visível está apta agora. Permissão, telefone correlacionado e bloqueios do Harmonia precisam estar verdes antes da seleção.</p>}
    <div className="mt-3 text-[11px] text-slate-500">{selectedIds.length} identidade(s) selecionada(s) · limite operacional de 100</div>
  </div>
}

export function ClientCommercialModule() {
  const { user } = useAuth()
  const initialClientesRoute = typeof window === 'undefined'
    ? { view: 'overview' as ClientesWorkspaceView, identityId: null, filters: {} as ClientesWalletFilters }
    : parseClientesLocation(window.location)
  const initialClientesFilters = initialClientesRoute.filters
  const [overview, setOverview] = useState<CommercialOverview | null>(null)
  const [detail, setDetail] = useState<CommercialProfileDetail | null>(null)
  const [units, setUnits] = useState<Array<{ slug: string; name: string }>>([])
  const [professionals, setProfessionals] = useState<Array<{ name: string }>>([])
  const [unit, setUnit] = useState(initialClientesFilters.unit || 'all')
  const [segment, setSegment] = useState(initialClientesFilters.segment || '')
  const [priority, setPriority] = useState(initialClientesFilters.priority || '')
  const [search, setSearch] = useState(initialClientesFilters.q || '')
  const [pageOffset, setPageOffset] = useState(Math.max(0, Number(initialClientesFilters.page || 0)) * 50)
  const [sort, setSort] = useState(initialClientesFilters.sort || 'priority')
  const [direction, setDirection] = useState<'asc' | 'desc'>(initialClientesFilters.direction || 'desc')
  const [assignedFilter, setAssignedFilter] = useState<'none' | 'any' | ''>(initialClientesFilters.assigned || '')
  const [slaFilter, setSlaFilter] = useState<'overdue' | ''>(initialClientesFilters.sla || '')
  const [permissionFilter, setPermissionFilter] = useState<'expiring' | ''>(initialClientesFilters.permission || '')
  const [reviewFilter, setReviewFilter] = useState<'pending' | ''>(initialClientesFilters.review || '')
  const [staleFilter, setStaleFilter] = useState<'stale' | ''>(initialClientesFilters.stale || '')
  const [workspaceView, setWorkspaceView] = useState<ClientesWorkspaceView>(initialClientesRoute.view || readClientesWorkspaceView)
  const [routeIdentityId, setRouteIdentityId] = useState<string | null>(initialClientesRoute.identityId)
  const [savedViewName, setSavedViewName] = useState('')
  type SavedClientesView = {
    name: string
    unit: string
    segment: string
    priority: string
    search: string
    sort: string
    direction: 'asc' | 'desc'
    assigned?: 'none' | 'any' | ''
    sla?: 'overdue' | ''
    permission?: 'expiring' | ''
    review?: 'pending' | ''
    stale?: 'stale' | ''
    columns?: string
  }
  const [savedViews, setSavedViews] = useState<SavedClientesView[]>([])
  const [visibleColumns, setVisibleColumns] = useState<string[]>(() => (initialClientesFilters.columns || 'identity,lastAttendance,lifetimeSales,visits,action,priority').split(',').filter(Boolean))
  const [selectedIdentityIds, setSelectedIdentityIds] = useState<string[]>([])
  const [bulkOwner, setBulkOwner] = useState('')
  const [bulkNotice, setBulkNotice] = useState('')
  const pageSize = 50
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [cooldown, setCooldown] = useState(30)
  const [thresholds, setThresholds] = useState('90,180,365')
  const [commercialContactWritesEnabled, setCommercialContactWritesEnabled] = useState(false)
  const [selectedCanaryIdentityIds, setSelectedCanaryIdentityIds] = useState<string[]>([])
  const [cadenceProcedure, setCadenceProcedure] = useState('')
  const [cadenceDays, setCadenceDays] = useState('')
  const [cadenceStatus, setCadenceStatus] = useState<CommercialCadenceManagerStatus>('draft')
  const [cadenceNotice, setCadenceNotice] = useState('')
  const [procedureOptions, setProcedureOptions] = useState<Array<{ id: string; name: string }>>([])
  const [commercialDataQuality, setCommercialDataQuality] = useState<CommercialDataQualityQueue | null>(null)
  const [commercialDataQualityBusy, setCommercialDataQualityBusy] = useState(false)
  const [commercialDataQualityError, setCommercialDataQualityError] = useState('')
  const contactSummary = overview?.dataQuality?.contactEligibility || { eligible: 0, blocked: 0, reviewRequired: 0, controlsReady: false, contactWriteControlsReady: false }
  const policyWriteControlsReady = overview?.policy.commercialContactWriteControlsReady === true
  const savedViewsStorageKey = `skincos:clientes:saved-views:${String(user?.id || user?.email || 'anonymous').trim().toLowerCase() || 'anonymous'}`

  const loadCommercialDataQuality = useCallback(async () => {
    try {
      setCommercialDataQualityBusy(true); setCommercialDataQualityError('')
      const result = await fetchCommercialDataQuality({ limit: 24 })
      if (result.ok) {
        setCommercialDataQuality(result)
        return
      }
      setCommercialDataQuality(null)
      // A scoped gestor must never see global aggregate counts. This is an expected
      // authorization result, not a failure of the Clientes module.
      if (!isCommercialDataQualityScopeDenied(result.error)) {
        setCommercialDataQualityError('O painel agregado de qualidade não está disponível neste ambiente.')
      }
    } catch {
      setCommercialDataQuality(null)
      setCommercialDataQualityError('O painel agregado de qualidade não está disponível neste ambiente.')
    } finally {
      setCommercialDataQualityBusy(false)
    }
  }, [])

  const load = useCallback(async (next?: {
    selectIdentityId?: string
    offset?: number
    unit?: string
    segment?: string
    priority?: string
    search?: string
    sort?: string
    direction?: 'asc' | 'desc'
    assigned?: 'none' | 'any' | ''
    sla?: 'overdue' | ''
    permission?: 'expiring' | ''
    review?: 'pending' | ''
    stale?: 'stale' | ''
  }) => {
    try {
      setBusy(true); setError('')
      const requestOffset = next?.offset ?? pageOffset
      const requestUnit = next?.unit ?? unit
      const requestSegment = next?.segment ?? segment
      const requestPriority = next?.priority ?? priority
      const requestSearch = next?.search ?? search
      const requestSort = next?.sort ?? sort
      const requestDirection = next?.direction ?? direction
      const requestAssigned = next?.assigned ?? assignedFilter
      const requestSla = next?.sla ?? slaFilter
      const requestPermission = next?.permission ?? permissionFilter
      const requestReview = next?.review ?? reviewFilter
      const requestStale = next?.stale ?? staleFilter
      // fetchCommercialWallet enforces the equivalent of server: true in its
      // own contract; no legacy first-page fallback is accepted below.
      const [commercial, references] = await Promise.all([fetchCommercialWallet({ unit: requestUnit, segment: requestSegment, priority: requestPriority, q: requestSearch, limit: pageSize, offset: requestOffset, sort: requestSort, direction: requestDirection, assigned: requestAssigned || undefined, sla: requestSla || undefined, permission: requestPermission || undefined, review: requestReview || undefined, stale: requestStale || undefined }), fetchCommercialReferences()])
      if (!commercial.ok) throw new Error(commercial.error || 'Não foi possível carregar a inteligência comercial.')
      if (!references.ok) throw new Error(references.error || 'Não foi possível carregar referências do CRM.')
      if (commercial.pagination?.mode !== 'sql') throw new Error('A carteira não confirmou paginação server-side; nenhum resultado parcial foi exibido.')
      setPageOffset(requestOffset)
      setSort(requestSort)
      setDirection(requestDirection)
      setOverview(commercial); setUnits(references.units); setProfessionals(references.professionals.map((person) => ({ name: person.name }))); setProcedureOptions(references.procedures.map((procedure) => ({ id: procedure.id, name: procedure.name })))
      setCooldown(commercial.policy.activeContactCooldownDays); setThresholds(commercial.policy.returnRiskThresholds.join(','))
      setCommercialContactWritesEnabled(commercial.policy.commercialContactWritesEnabled === true)
      setSelectedCanaryIdentityIds(Array.isArray(commercial.policy.commercialContactCanaryIdentityIds) ? commercial.policy.commercialContactCanaryIdentityIds : [])
      const selectedId = next?.selectIdentityId || routeIdentityId || detail?.profile.identityId
      const candidate = selectedId ? commercial.profiles.find((profile) => profile.identityId === selectedId) : null
      if (candidate) await loadDetail(candidate.identityId, commercial.asOf)
      else if (!selectedId) setDetail(null)
      void loadCommercialDataQuality()
    } catch (cause) {
      // Never leave a prior page visible as if it matched a failed filter or
      // an unavailable dependency. The next successful server page rebuilds
      // both the wallet and its profile drawer.
      setOverview(null)
      setDetail(null)
      setError(cause instanceof Error ? cause.message : 'Não foi possível carregar a inteligência comercial.')
    } finally { setBusy(false) }
  // Filters are deliberately applied only with the button, so typing does not trigger a request per keystroke.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [assignedFilter, direction, pageOffset, permissionFilter, priority, reviewFilter, routeIdentityId, search, segment, slaFilter, sort, staleFilter, unit, detail?.profile.identityId])

  const loadDetail = useCallback(async (identityId: string, asOf?: string) => {
    const result = await fetchCommercialProfile(identityId, { asOf, unit })
    if (!result.ok) throw new Error(result.error || 'Não foi possível carregar o perfil do cliente.')
    setDetail(result)
  }, [unit])

  const currentRouteFilters = useCallback((overrides: Partial<ClientesWalletFilters> = {}): ClientesWalletFilters => ({
    unit: overrides.unit ?? unit,
    segment: overrides.segment ?? segment,
    priority: overrides.priority ?? priority,
    q: overrides.q ?? search,
    page: overrides.page ?? Math.floor(pageOffset / pageSize),
    pageSize,
    sort: overrides.sort ?? sort,
    direction: overrides.direction ?? direction,
    assigned: overrides.assigned ?? (assignedFilter || undefined),
    sla: overrides.sla ?? (slaFilter || undefined),
    permission: overrides.permission ?? (permissionFilter || undefined),
    review: overrides.review ?? (reviewFilter || undefined),
    stale: overrides.stale ?? (staleFilter || undefined),
    columns: overrides.columns ?? visibleColumns.join(','),
    view: overrides.view,
  }), [assignedFilter, direction, pageOffset, pageSize, permissionFilter, priority, reviewFilter, search, segment, slaFilter, sort, staleFilter, unit, visibleColumns])

  const navigateClientes = useCallback((view: ClientesWorkspaceView, identityId: string | null = null, mode: 'push' | 'replace' = 'push', overrides: Partial<ClientesWalletFilters> = {}) => {
    if (typeof window === 'undefined') return
    const nextPath = buildClientesPath(view, currentRouteFilters(overrides), identityId)
    const currentPath = `${window.location.pathname}${window.location.search}`
    if (nextPath !== currentPath) {
      const method = mode === 'push' ? 'pushState' : 'replaceState'
      window.history[method]({ ...(window.history.state || {}), clientesWorkspace: true, clientesProfile: !!identityId }, document.title, nextPath)
    }
    const parsed = parseClientesLocation({ pathname: new URL(nextPath, window.location.origin).pathname, search: new URL(nextPath, window.location.origin).search })
    setWorkspaceView(parsed.view)
    setRouteIdentityId(parsed.identityId)
  }, [currentRouteFilters])

  // Initial load intentionally runs once; changing filters is explicit through “Aplicar”.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { void load() }, [])

  useEffect(() => {
    if (!routeIdentityId) {
      setDetail(null)
      return
    }
    void loadDetail(routeIdentityId, overview?.asOf).catch((cause) => {
      setDetail(null)
      setError(cause instanceof Error ? cause.message : 'Não foi possível carregar o perfil do cliente.')
    })
  }, [loadDetail, overview?.asOf, routeIdentityId])

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(savedViewsStorageKey)
      if (raw) {
        const parsed = JSON.parse(raw)
        if (Array.isArray(parsed)) setSavedViews(parsed.filter((item) => item && typeof item.name === 'string').slice(0, 12))
      }
    } catch { /* local view persistence is best-effort and never blocks the module */ }
  }, [savedViewsStorageKey])

  useEffect(() => {
    if (typeof window === 'undefined') return
    const onPopState = () => {
      const parsed = parseClientesLocation(window.location)
      setWorkspaceView(parsed.view)
      setRouteIdentityId(parsed.identityId)
      const next = parsed.filters
      if (next.unit !== undefined) setUnit(next.unit || 'all')
      if (next.segment !== undefined) setSegment(next.segment)
      if (next.priority !== undefined) setPriority(next.priority)
      if (next.q !== undefined) setSearch(next.q)
      if (next.sort !== undefined) setSort(next.sort)
      if (next.direction !== undefined) setDirection(next.direction)
      if (next.page !== undefined) setPageOffset(Math.max(0, next.page) * pageSize)
      if (next.columns) setVisibleColumns(next.columns.split(',').filter(Boolean))
      setAssignedFilter(next.assigned || '')
      setSlaFilter(next.sla || '')
      setPermissionFilter(next.permission || '')
      setReviewFilter(next.review || '')
      setStaleFilter(next.stale || '')
    }
    window.addEventListener('popstate', onPopState)
    return () => window.removeEventListener('popstate', onPopState)
  }, [pageSize])

  useEffect(() => {
    if (typeof window === 'undefined') return
    // Canonicalize legacy `?module=clientes&clientesView=...` links to the
    // real route while retaining their allowlisted filters.
    const current = `${window.location.pathname}${window.location.search}`
    const canonical = buildClientesPath(workspaceView, currentRouteFilters(), routeIdentityId)
    if (current !== canonical && (window.location.pathname === '/' || window.location.pathname === '/clientes' || window.location.pathname.startsWith('/clientes/'))) {
      window.history.replaceState(window.history.state, document.title, canonical)
    }
    // Compatibility marker intentionally remains documented for old links:
    // Legacy compatibility: const legacyView = params.get('clientesView')
    // set('clientesView', workspaceView)
  }, [currentRouteFilters, routeIdentityId, workspaceView])

  const persistSavedViews = (next: typeof savedViews) => {
    setSavedViews(next)
    try { window.localStorage.setItem(savedViewsStorageKey, JSON.stringify(next)) } catch { /* ignore unavailable storage */ }
  }

  const saveCurrentView = () => {
    const name = savedViewName.trim()
    if (!name) { setError('Informe um nome para salvar esta visão.'); return }
    const next: SavedClientesView[] = [{ name, unit, segment, priority, search, sort, direction, assigned: assignedFilter, sla: slaFilter, permission: permissionFilter, review: reviewFilter, stale: staleFilter, columns: visibleColumns.join(',') }, ...savedViews.filter((view) => view.name !== name)].slice(0, 12)
    persistSavedViews(next)
    setSavedViewName('')
  }

  const applySavedView = (view: typeof savedViews[number]) => {
    const nextAssigned = view.assigned || ''
    const nextSla = view.sla || ''
    const nextPermission = view.permission || ''
    const nextReview = view.review || ''
    const nextStale = view.stale || ''
    setUnit(view.unit); setSegment(view.segment); setPriority(view.priority); setSearch(view.search); setSort(view.sort); setDirection(view.direction); setPageOffset(0)
    setAssignedFilter(nextAssigned); setSlaFilter(nextSla); setPermissionFilter(nextPermission); setReviewFilter(nextReview); setStaleFilter(nextStale)
    if (view.columns) setVisibleColumns(view.columns.split(',').filter(Boolean))
    void load({ unit: view.unit, segment: view.segment, priority: view.priority, search: view.search, sort: view.sort, direction: view.direction, assigned: nextAssigned, sla: nextSla, permission: nextPermission, review: nextReview, stale: nextStale, offset: 0 })
  }

  const assignSelected = async () => {
    if (!selectedIdentityIds.length || !bulkOwner) return
    try {
      setBusy(true); setBulkNotice('')
      const result = await assignCommercialActions({ identityIds: selectedIdentityIds, owner: bulkOwner, unit: unit === 'all' ? undefined : unit })
      if (!result.ok) throw new Error(result.error || 'Não foi possível atribuir a fila.')
      setBulkNotice(`${result.updated} identidade(s) atualizada(s); ${result.skipped} sem ação aberta.`)
      setSelectedIdentityIds([])
      await load({ offset: pageOffset })
    } catch (cause) {
      setBulkNotice(cause instanceof Error ? cause.message : 'Não foi possível atribuir a fila.')
    } finally { setBusy(false) }
  }

  const refreshDetail = useCallback(async () => {
    if (!detail) return
    await loadDetail(detail.profile.identityId, overview?.asOf)
    await load({ selectIdentityId: detail.profile.identityId })
  }, [detail, load, loadDetail, overview?.asOf])

  const savePolicy = async () => {
    try {
      setBusy(true); setError('')
      const values = thresholds.split(',').map((value) => Number(value.trim())).filter(Boolean)
      const canaryIdentityIds = [...new Set(selectedCanaryIdentityIds.map((value) => value.trim().toLowerCase()).filter(Boolean))].sort()
      const persistedCanaryIdentityIds = [...new Set((overview?.policy.commercialContactCanaryIdentityIds || [])
        .map((value) => value.trim().toLowerCase()).filter(Boolean))].sort()
      const rolloutChanged = policyWriteControlsReady && (
        commercialContactWritesEnabled !== (overview?.policy.commercialContactWritesEnabled === true)
        || canaryIdentityIds.join(',') !== persistedCanaryIdentityIds.join(',')
      )
      const policy: {
        activeContactCooldownDays: number
        returnRiskThresholds: number[]
        expectedPolicyVersion: string
        commercialContactWritesEnabled?: boolean
        commercialContactCanaryIdentityIds?: string[]
      } = {
        activeContactCooldownDays: Number(cooldown),
        returnRiskThresholds: values,
        expectedPolicyVersion: overview?.policy.policyVersion || '',
      }
      if (!overview?.policy.policyVersion) throw new Error('A versão atual da política não está disponível. Recarregue antes de salvar.')
      if (rolloutChanged) Object.assign(policy, { commercialContactWritesEnabled, commercialContactCanaryIdentityIds: canaryIdentityIds })
      const result = await updateCommercialPolicy(policy)
      if (!result.ok) {
        if (result.error === 'COMMERCIAL_POLICY_CONFLICT') {
          await load()
          throw new Error('A política foi alterada por outro gestor. Os valores atuais foram recarregados antes de uma nova tentativa.')
        }
        throw new Error(result.error || 'Não foi possível salvar a política.')
      }
      await load()
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Não foi possível salvar a política.') } finally { setBusy(false) }
  }

  const saveCadence = async () => {
    try {
      setBusy(true); setCadenceNotice('')
      const result = await upsertCommercialCadence({ procedureId: cadenceProcedure, cadenceDays: Number(cadenceDays), status: cadenceStatus })
      if (!result.ok) {
        if (result.error === 'CLINICAL_CADENCE_APPROVAL_REQUIRED') {
          throw new Error('A aprovação clínica exige um fluxo verificado e não está disponível neste módulo.')
        }
        throw new Error(result.error || 'Não foi possível salvar a cadência.')
      }
      setCadenceNotice('Registro salvo sem aprovação clínica. A aprovação exige um fluxo verificado e não está disponível aqui.')
      setCadenceDays('')
      await load()
    } catch (cause) { setCadenceNotice(cause instanceof Error ? cause.message : 'Não foi possível salvar a cadência.') } finally { setBusy(false) }
  }

  const toggleCanaryIdentity = (identityId: string) => {
    setSelectedCanaryIdentityIds((current) => current.includes(identityId)
      ? current.filter((value) => value !== identityId)
      : [...current, identityId])
  }

  const segmentOptions = useMemo(() => [{ key: '', label: 'Todos os segmentos' }, { key: 'return_at_risk', label: 'Retorno em risco' }, { key: 'high_value_inactive', label: 'Alto valor inativo' }, { key: 'frequent', label: 'Assíduos' }, { key: 'balanced_vip', label: 'VIP equilibrado' }, { key: 'first_return', label: 'Primeiro retorno' }, { key: 'reactivation_potential', label: 'Potencial de reativação' }], [])
  const contactScopeSuffix = contactSummary.scope === 'page' ? ' na página atual' : ''

  const showProfileWorkspace = workspaceView === 'overview' || workspaceView === 'wallet' || workspaceView === 'actions'
  const selectWorkspaceView = (next: ClientesWorkspaceView) => navigateClientes(next, null, 'push')
  const openProfile = async (identityId: string) => {
    navigateClientes('wallet', identityId, 'push')
    try {
      await loadDetail(identityId, overview?.asOf)
    } catch (cause) {
      setDetail(null)
      setError(cause instanceof Error ? cause.message : 'Não foi possível carregar o perfil do cliente.')
    }
  }

  return <section className="space-y-6 text-white">
    {/* Compatibility contracts kept while the workspace moves from the legacy tab query to real deep-link paths: workspaceView === 'identities' ? <IdentityReviewQueue /> : null; workspaceView === 'quality' && commercialDataQuality */}
    <header className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between"><div><h1 className="text-2xl font-bold tracking-tight">Clientes</h1><p className="mt-1 text-sm text-slate-400">Prioridades comerciais baseadas em presença registrada, vendas e procedimentos confirmados.</p></div><div className="flex flex-wrap gap-2"><Button variant="outline" onClick={() => void load()} disabled={busy}><RefreshCw className={`mr-2 h-4 w-4 ${busy ? 'animate-spin' : ''}`} />Atualizar</Button><Button variant="outline" onClick={() => selectWorkspaceView('governance')}><ShieldCheck className="mr-2 h-4 w-4" />Governança</Button></div></header>
    <ClientesWorkspaceNav active={workspaceView} onChange={selectWorkspaceView} />
    {error ? <div className="rounded-xl border border-rose-300/30 bg-rose-500/10 p-4 text-sm text-rose-100">{error}</div> : null}
    {workspaceView === 'overview' ? <ClientesPanelBoundary label="visão geral"><section aria-labelledby="clientes-overview-heading">{overview ? <><h2 id="clientes-overview-heading" className="sr-only">Visão geral de Clientes</h2><div className="rounded-xl border border-amber-300/25 bg-amber-500/10 p-4 text-sm text-amber-100"><div className="flex gap-2"><AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" /><div><b>Uso comercial seguro:</b> a recência considera apenas o último atendimento realizado. Compras antecipadas não representam procedimento realizado. {overview.dataQuality.futureAttendancesExcluded ? `${overview.dataQuality.futureAttendancesExcluded} atendimento(s) futuro(s) foram excluídos desta métrica. ` : ''}{overview.dataQuality.activeAttendanceClientsWithoutIdentity ? `${overview.dataQuality.activeAttendanceClientsWithoutIdentity} cliente(s) de Atendimento ainda não têm identidade comercial. ` : ''}{contactSummary.controlsReady ? `${contactSummary.eligible} apto(s), ${contactSummary.blocked} bloqueado(s) e ${contactSummary.reviewRequired} em revisão para WhatsApp${contactScopeSuffix}. ` : 'Os controles de contato ainda não foram migrados; nenhum contato pode ser marcado. '}{!contactSummary.contactWriteControlsReady ? 'A cadência de contato aguarda a migration explícita; filas novas, concessões e registros de contato seguem bloqueados. ' : overview.policy.commercialContactWritesEnabled ? `Canário de contato ativo para ${overview.policy.commercialContactCanaryIdentityIds?.length || 0} identidade(s).` : 'Registro de contato e novas permissões concedidas seguem bloqueados até a abertura explícita de um canário.'}</div></div></div></> : <div role="status" className="rounded-xl border border-slate-800/80 bg-slate-950/45 p-5 text-sm text-slate-400">Carregando visão geral…</div>}</section></ClientesPanelBoundary> : null}
    {workspaceView === 'governance' ? <section className="grid gap-4 rounded-2xl border border-slate-800/80 bg-slate-950/55 p-5 xl:grid-cols-2"><div><h2 className="font-semibold text-white">Política de reativação</h2><p className="mt-1 text-sm text-slate-500">Define o intervalo entre contatos assistidos e as faixas de ausência, sem alterar o histórico clínico.</p><div className="mt-4 grid gap-2 sm:grid-cols-2"><label className="text-xs text-slate-400">Intervalo mínimo de contato (dias)<input type="number" value={cooldown} onChange={(event) => setCooldown(Number(event.target.value))} className="mt-1 w-full rounded-lg border border-slate-800 bg-slate-900 px-3 py-2 text-sm text-white" /></label><label className="text-xs text-slate-400">Faixas de ausência<input value={thresholds} onChange={(event) => setThresholds(event.target.value)} className="mt-1 w-full rounded-lg border border-slate-800 bg-slate-900 px-3 py-2 text-sm text-white" /></label></div>{!policyWriteControlsReady ? <p className="mt-4 text-xs text-amber-200">A migration de rollout ainda não está presente neste ambiente. As faixas podem ser salvas, mas o canário permanece indisponível.</p> : null}<label className="mt-4 flex items-start gap-2 text-xs text-amber-100"><input type="checkbox" checked={commercialContactWritesEnabled} disabled={!policyWriteControlsReady} onChange={(event) => setCommercialContactWritesEnabled(event.target.checked)} className="mt-0.5" />Abrir somente o canário de registros de contato. Isto não envia mensagens.</label><CanarySelection profiles={overview?.profiles || []} selectedIds={selectedCanaryIdentityIds} disabled={!policyWriteControlsReady} onToggle={toggleCanaryIdentity} onClear={() => setSelectedCanaryIdentityIds([])} /><Button size="sm" onClick={() => void savePolicy()} disabled={busy} className="mt-3"><Save className="mr-2 h-4 w-4" />Salvar política</Button></div><div className="border-t border-slate-800 pt-4 xl:border-l xl:border-t-0 xl:pl-4 xl:pt-0"><h2 className="font-semibold text-white">Cadência clínica</h2><p className="mt-1 text-sm text-slate-500">Gestores podem manter rascunhos ou desativar regras não aprovadas. A aprovação clínica exige um fluxo verificado e não está disponível neste módulo.</p><div className="mt-4 grid gap-2 sm:grid-cols-3"><select value={cadenceProcedure} onChange={(event) => setCadenceProcedure(event.target.value)} className="rounded-lg border border-slate-800 bg-slate-900 px-3 py-2 text-sm text-white"><option value="">Procedimento</option>{procedureOptions.map((procedure) => <option key={procedure.id} value={procedure.id}>{procedure.name}</option>)}</select><input type="number" min="1" placeholder="Dias" value={cadenceDays} onChange={(event) => setCadenceDays(event.target.value)} className="rounded-lg border border-slate-800 bg-slate-900 px-3 py-2 text-sm text-white" /><select value={cadenceStatus} onChange={(event) => setCadenceStatus(event.target.value as CommercialCadenceManagerStatus)} className="rounded-lg border border-slate-800 bg-slate-900 px-3 py-2 text-sm text-white">{commercialCadenceManagerStatuses.map((status) => <option key={status} value={status}>{commercialCadenceStatusLabels[status]}</option>)}</select></div><Button size="sm" variant="outline" onClick={() => void saveCadence()} disabled={busy || !cadenceProcedure || !cadenceDays} className="mt-3"><Save className="mr-2 h-4 w-4" />Salvar cadência</Button>{cadenceNotice ? <div className="mt-2 text-xs text-slate-400">{cadenceNotice}</div> : null}</div></section> : null}
    {workspaceView === 'overview' ? <ClientesPanelBoundary label="métricas"><section aria-label="Métricas de Clientes" className="grid gap-4 md:grid-cols-2 xl:grid-cols-4"><Metric label="Retorno em risco" value={overview?.summary.returnAtRisk ?? '—'} detail="Sem presença registrada na faixa configurada" icon={CalendarClock} /><Metric label="Alto valor inativo" value={overview?.summary.highValueInactive ?? '—'} detail="Valor e ausência combinados" icon={CircleDollarSign} /><Metric label="Potencial de reativação" value={overview?.summary.reactivationPotential ?? '—'} detail="Prioridade para a equipe" icon={UserRoundCheck} /><Metric label="Aptos para WhatsApp" value={overview ? contactSummary.eligible : '—'} detail="Permissão explícita e bloqueios verificados" icon={UsersRound} /></section></ClientesPanelBoundary> : null}
    {workspaceView === 'quality' ? <ClientesPanelBoundary label="qualidade"><section aria-labelledby="clientes-quality-heading"><h2 id="clientes-quality-heading" className="sr-only">Qualidade de dados</h2>{commercialDataQualityError ? <div role="alert" className="rounded-xl border border-amber-300/25 bg-amber-500/10 p-4 text-sm text-amber-100">{commercialDataQualityError}</div> : commercialDataQuality ? <CommercialDataQualityPanel queue={commercialDataQuality} loading={commercialDataQualityBusy} onRefresh={loadCommercialDataQuality} /> : <div role="status" className="rounded-xl border border-slate-800/80 bg-slate-950/45 p-5 text-sm text-slate-400">Carregando qualidade…</div>}</section></ClientesPanelBoundary> : null}
    {showProfileWorkspace ? <>
    <section aria-label="Filtros da carteira" className="flex flex-wrap gap-2 rounded-xl border border-slate-800/80 bg-slate-950/45 p-3">
      <select aria-label="Unidade" value={unit} onChange={(event) => setUnit(event.target.value)} className="rounded-lg border border-slate-800 bg-slate-900 px-3 py-2 text-sm text-slate-100"><option value="all">Todas as unidades</option>{units.map((item) => <option key={item.slug} value={item.slug}>{item.name}</option>)}</select>
      <select aria-label="Segmento" value={segment} onChange={(event) => setSegment(event.target.value)} className="rounded-lg border border-slate-800 bg-slate-900 px-3 py-2 text-sm text-slate-100">{segmentOptions.map((item) => <option key={item.key} value={item.key}>{item.label}</option>)}</select>
      <select aria-label="Prioridade" value={priority} onChange={(event) => setPriority(event.target.value)} className="rounded-lg border border-slate-800 bg-slate-900 px-3 py-2 text-sm text-slate-100"><option value="">Todas as prioridades</option><option value="high">Alta</option><option value="medium">Média</option><option value="normal">Normal</option></select>
      <select aria-label="Responsável" value={assignedFilter} onChange={(event) => setAssignedFilter(event.target.value as typeof assignedFilter)} className="rounded-lg border border-slate-800 bg-slate-900 px-3 py-2 text-sm text-slate-100"><option value="">Todos os responsáveis</option><option value="none">Sem responsável</option><option value="any">Com responsável</option></select>
      <select aria-label="SLA" value={slaFilter} onChange={(event) => setSlaFilter(event.target.value as typeof slaFilter)} className="rounded-lg border border-slate-800 bg-slate-900 px-3 py-2 text-sm text-slate-100"><option value="">Todos os SLAs</option><option value="overdue">SLA vencido</option></select>
      <select aria-label="Permissão" value={permissionFilter} onChange={(event) => setPermissionFilter(event.target.value as typeof permissionFilter)} className="rounded-lg border border-slate-800 bg-slate-900 px-3 py-2 text-sm text-slate-100"><option value="">Todas as permissões</option><option value="expiring">Permissão expirando</option></select>
      <select aria-label="Identidade" value={reviewFilter} onChange={(event) => setReviewFilter(event.target.value as typeof reviewFilter)} className="rounded-lg border border-slate-800 bg-slate-900 px-3 py-2 text-sm text-slate-100"><option value="">Todas as identidades</option><option value="pending">Identidade em revisão</option></select>
      <select aria-label="Atualidade dos dados" value={staleFilter} onChange={(event) => setStaleFilter(event.target.value as typeof staleFilter)} className="rounded-lg border border-slate-800 bg-slate-900 px-3 py-2 text-sm text-slate-100"><option value="">Todos os dados</option><option value="stale">Dados stale</option></select>
      <input aria-label="Buscar cliente" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Buscar por referência segura" className="min-w-48 flex-1 rounded-lg border border-slate-800 bg-slate-900 px-3 py-2 text-sm text-slate-100 placeholder:text-slate-500" />
      <select aria-label="Ordenar clientes" value={sort} onChange={(event) => setSort(event.target.value)} className="rounded-lg border border-slate-800 bg-slate-900 px-3 py-2 text-sm text-slate-100"><option value="priority">Prioridade</option><option value="recency">Recência</option><option value="lifetime_sales">Faturamento</option><option value="visits">Visitas</option><option value="sales">Compras</option><option value="last_attendance">Último atendimento</option><option value="name">Nome</option></select>
      <select aria-label="Direção da ordenação" value={direction} onChange={(event) => setDirection(event.target.value as 'asc' | 'desc')} className="rounded-lg border border-slate-800 bg-slate-900 px-3 py-2 text-sm text-slate-100"><option value="desc">Maior primeiro</option><option value="asc">Menor primeiro</option></select>
      <Button size="sm" onClick={() => void load({ offset: 0 })} disabled={busy}>Aplicar filtros</Button>
      <details className="w-full border-t border-slate-800/80 pt-3">
        <summary className="cursor-pointer text-xs text-slate-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-400">Colunas visíveis</summary>
        <div className="mt-2 flex flex-wrap gap-3" aria-label="Configuração de colunas">{walletColumnOptions.map((column) => <label key={column.key} className="flex items-center gap-2 text-xs text-slate-300"><input type="checkbox" checked={visibleColumns.includes(column.key)} onChange={() => setVisibleColumns((current) => current.includes(column.key) ? current.filter((value) => value !== column.key) : [...current, column.key])} />{column.label}</label>)}</div>
      </details>
      <div className="flex w-full flex-wrap gap-2 border-t border-slate-800/80 pt-3"><input aria-label="Nome da visão salva" value={savedViewName} onChange={(event) => setSavedViewName(event.target.value)} placeholder="Nome da visão" className="min-w-48 flex-1 rounded-lg border border-slate-800 bg-slate-900 px-3 py-2 text-sm text-slate-100 placeholder:text-slate-500" /><Button size="sm" variant="outline" onClick={saveCurrentView} disabled={busy}>Salvar visão</Button>{savedViews.length ? <select aria-label="Visões salvas" defaultValue="" onChange={(event) => { const view = savedViews.find((item) => item.name === event.target.value); if (view) applySavedView(view); event.currentTarget.value = '' }} className="rounded-lg border border-slate-800 bg-slate-900 px-3 py-2 text-sm text-slate-100"><option value="">Abrir visão salva</option>{savedViews.map((view) => <option key={view.name} value={view.name}>{view.name}</option>)}</select> : null}</div>
    </section>
    <ClientesPanelBoundary label="carteira"><div className="grid gap-5 2xl:grid-cols-[minmax(0,1.7fr)_minmax(22rem,0.8fr)]">
       <section className="overflow-hidden rounded-2xl border border-slate-800/80 bg-slate-950/55 shadow-[0_20px_60px_rgba(2,6,23,0.28)]">
         <div className="flex items-center justify-between border-b border-slate-800/80 p-5"><div><h2 className="font-semibold text-white">{workspaceView === 'wallet' ? 'Carteira de clientes' : workspaceView === 'actions' ? 'Fila de ações comerciais' : 'Prioridades de reativação'}</h2><p className="mt-1 text-xs text-slate-500">{workspaceView === 'actions' ? 'Ações assistidas, sem envio automático de mensagens.' : overview ? `${overview.total} clientes na seleção atual` : 'Carregando clientes…'}</p></div><div className="text-xs text-slate-500">Fila: {overview?.actions.actions ?? 0} · Contatos: {overview?.actions.contactedActions ?? 0}</div></div>
        <div className="overflow-x-auto"><table className="w-full min-w-190 text-sm"><caption className="sr-only">Carteira paginada de clientes sem dados de contato por padrão</caption><thead className="bg-white/[0.025] text-left text-xs font-medium text-slate-400"><tr><th className="p-3"><input type="checkbox" aria-label="Selecionar todos desta página" checked={!!overview?.profiles.length && overview.profiles.every((profile) => selectedIdentityIds.includes(profile.identityId))} onChange={(event) => setSelectedIdentityIds(event.target.checked ? overview?.profiles.map((profile) => profile.identityId) || [] : [])} /></th>{visibleColumns.includes('identity') ? <th className="p-3">Referência segura</th> : null}{visibleColumns.includes('lastAttendance') ? <th className="p-3">Último atendimento</th> : null}{visibleColumns.includes('lifetimeSales') ? <th className="p-3 text-right">Faturamento</th> : null}{visibleColumns.includes('visits') ? <th className="p-3">Frequência</th> : null}{visibleColumns.includes('action') ? <th className="p-3">Próxima ação</th> : null}{visibleColumns.includes('priority') ? <th className="p-3">Prioridade</th> : null}<th className="p-3" /></tr></thead><tbody>{overview?.profiles.map((profile) => <tr key={profile.identityId} tabIndex={0} onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); void openProfile(profile.identityId) } }} onClick={() => void openProfile(profile.identityId)} className={`cursor-pointer border-t border-slate-800/70 transition hover:bg-sky-500/[0.05] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-sky-400 ${detail?.profile.identityId === profile.identityId ? 'bg-sky-500/[0.08]' : ''}`}><td className="p-3" onClick={(event) => event.stopPropagation()}><input type="checkbox" aria-label={`Selecionar ${safeIdentityLabel(profile)}`} checked={selectedIdentityIds.includes(profile.identityId)} onChange={(event) => setSelectedIdentityIds((current) => event.target.checked ? [...new Set([...current, profile.identityId])] : current.filter((id) => id !== profile.identityId))} /></td>{visibleColumns.includes('identity') ? <td className="p-3"><div className="font-medium text-slate-100">{safeIdentityLabel(profile)}</div><div className="mt-0.5 text-xs text-slate-500">Identidade {profile.identityQuality.replace(/_/g, ' ')}</div><div className={`mt-1 text-[11px] ${contactEligibilityTextStyle(profile.contactEligibility)}`}>{contactEligibilityLabel(profile.contactEligibility)}</div></td> : null}{visibleColumns.includes('lastAttendance') ? <td className="p-3"><div className="text-slate-200">{formatDate(profile.lastAttendance)}</div><div className={`mt-0.5 text-xs ${profile.recencyDays != null && profile.recencyDays >= 180 ? 'text-rose-300' : 'text-slate-500'}`}>{profile.recencyDays == null ? 'Sem presença confirmada' : `${profile.recencyDays} dias`}</div></td> : null}{visibleColumns.includes('lifetimeSales') ? <td className="p-3 text-right"><div className="font-medium text-slate-100">{currency.format(profile.lifetimeSales)}</div><div className="mt-0.5 text-xs text-slate-500">{profile.saleCount} compra(s)</div></td> : null}{visibleColumns.includes('visits') ? <td className="p-3"><div className="text-slate-200">{profile.visitCount} visita(s)</div><div className="mt-0.5 text-xs text-slate-500">{profile.procedureCount} procedimento(s)</div></td> : null}{visibleColumns.includes('action') ? <td className="max-w-56 p-3 text-slate-300">{profile.recommendedAction}</td> : null}{visibleColumns.includes('priority') ? <td className="p-3"><SegmentBadge profile={profile} /></td> : null}<td className="p-3 text-right"><ChevronRight className="inline h-4 w-4 text-slate-500" /></td></tr>)}</tbody></table>{overview && !overview.profiles.length ? <div className="p-8 text-center text-sm text-slate-500">Nenhum cliente encontrado para os filtros selecionados.</div> : null}</div>
        {selectedIdentityIds.length ? <div className="flex flex-wrap items-center gap-2 border-t border-slate-800/80 bg-sky-500/[0.04] p-3"><span className="text-xs text-slate-300">{selectedIdentityIds.length} selecionada(s)</span><select aria-label="Responsável para atribuição em lote" value={bulkOwner} onChange={(event) => setBulkOwner(event.target.value)} className="rounded-lg border border-slate-800 bg-slate-900 px-3 py-2 text-xs text-slate-100"><option value="">Escolher responsável</option>{professionals.map((person) => <option key={person.name} value={person.name}>{person.name}</option>)}</select><Button size="sm" onClick={() => void assignSelected()} disabled={busy || !bulkOwner}>Atribuir em lote</Button>{bulkNotice ? <span role="status" className="text-xs text-slate-400">{bulkNotice}</span> : null}</div> : null}
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-800/80 p-4 text-xs text-slate-500"><span>{overview ? `${overview.total ? pageOffset + 1 : 0}–${Math.min(pageOffset + overview.profiles.length, overview.total)} de ${overview.total}` : 'Carregando…'}{overview?.pagination?.mode === 'sql' ? ' · paginação SQL' : ''}</span><div className="flex gap-2"><Button size="sm" variant="outline" disabled={busy || !overview?.pagination?.hasPrevious} onClick={() => void load({ offset: Math.max(0, pageOffset - pageSize) })}>Anterior</Button><Button size="sm" variant="outline" disabled={busy || !overview?.pagination?.hasNext} onClick={() => void load({ offset: pageOffset + pageSize })}>Próxima</Button></div></div>
      </section>
      <ProfilePanel detail={detail} units={units} professionals={professionals} onRefresh={refreshDetail} onClose={() => {
        if (window.history.state?.clientesProfile === true) window.history.back()
        else navigateClientes('wallet', null, 'replace')
      }} />
    </div></ClientesPanelBoundary>
    <footer className="flex items-center gap-2 text-xs text-slate-500"><CheckCircle2 className="h-4 w-4 text-emerald-400" />Recência = último procedimento realizado. Vendas e procedimentos continuam separados no perfil comercial.</footer>
    </> : null}
    {workspaceView === 'identities' ? <ClientesPanelBoundary label="identidades"><section aria-labelledby="clientes-identities-heading"><h2 id="clientes-identities-heading" className="sr-only">Identidades em revisão</h2><IdentityReviewQueue /></section></ClientesPanelBoundary> : null}
  </section>
}
