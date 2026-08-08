import { useCallback, useEffect, useMemo, useState } from 'react'
import { AlertTriangle, CalendarClock, CheckCircle2, ChevronRight, CircleDollarSign, RefreshCw, Save, ShieldCheck, UserRoundCheck, UsersRound } from 'lucide-react'
import { Button } from '@/button'
import { IdentityClusterWorkspace } from './IdentityClusterWorkspace'
import { CommercialCanaryManager } from '@/CommercialCanaryManager'
import { CommercialAnalyticsPanel } from './CommercialAnalyticsPanel'
import { CommercialAssistedWhatsappPanel } from './CommercialAssistedWhatsappPanel'
import {
  createCommercialAction,
  commercialCadenceManagerStatuses,
  decideClientIdentityReview,
  fetchCommercialReferences,
  fetchClientIdentityReviewQueue,
  fetchCommercialDataQuality,
  fetchCommercialSourceOperations,
  fetchCommercialOverview,
  fetchCommercialProfile,
  isCommercialDataQualityScopeDenied,
  isCommercialSourceOperationsScopeDenied,
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
  type CommercialSourceOperations,
  type CommercialOverview,
  type CommercialProfile,
  type CommercialProfileDetail,
  type ClientIdentityReviewItem,
} from '@/atendimentoApi'
import {
  clientesWorkspaceUrl,
  defaultClientesWalletUrlState,
  parseClientesWorkspaceRoute,
  readClientesWalletUrlState,
  type ClientesWalletUrlState,
  type ClientesWorkspaceRoute,
  type ClientesWorkspaceView,
} from '@/clientesRoutes'
import { ClientesWorkspaceNavigation } from '@/ClientesWorkspaceNavigation'
import { ClientesWorkspaceSection } from '@/ClientesWorkspaceSection'

const currency = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' })
const date = new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo' })
const dateTime = new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo', dateStyle: 'short', timeStyle: 'short' })
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

function formatDateTime(value: string | null | undefined, empty = 'Sem registro') {
  if (!value) return empty
  const parsed = new Date(value)
  return Number.isNaN(parsed.getTime()) ? empty : dateTime.format(parsed)
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
  // A saved rollout cohort remains an auditable preparation step only. The
  // current tranche deliberately cannot open the contact-writing path.
  void policy
  void identityId
  return false
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

function SegmentBadge({ profile }: { profile: Pick<CommercialProfile, 'priority' | 'segments'> }) {
  const primary = profile.segments[0]
  if (!primary) return <span className="text-xs text-slate-500">Sem prioridade</span>
  return <span className={`inline-flex rounded-full border px-2 py-0.5 text-[11px] font-medium ${priorityStyles[profile.priority]}`}>{primary.label}</span>
}

function maskedWalletCustomerLabel(index: number) {
  return `Cliente protegido ${String(index + 1).padStart(2, '0')}`
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

function ProfilePanel({ detail, units, professionals, onRefresh }: { detail: CommercialProfileDetail | null; units: Array<{ slug: string; name: string }>; professionals: Array<{ name: string }>; onRefresh: () => Promise<void> }) {
  if (!detail) return <aside className="rounded-2xl border border-slate-800/80 bg-slate-950/45 p-5 text-sm text-slate-500">Selecione um cliente para abrir o perfil comercial.</aside>
  const { profile } = detail
  const timeline = Array.isArray(detail.timeline) ? detail.timeline : []
  const contactEligibility = safeContactEligibility(profile.contactEligibility)
  const contactRolloutAllowed = detail.policy.commercialContactWriteControlsReady === true && commercialRolloutAllows(detail.policy, profile.identityId)
  return <aside className="space-y-5 rounded-2xl border border-slate-800/80 bg-slate-950/55 p-5 shadow-[0_20px_60px_rgba(2,6,23,0.28)]">
    <div><div className="flex items-start justify-between gap-3"><div><h2 className="text-lg font-semibold text-white">{profile.name}</h2><div className="mt-1 text-xs text-slate-400">{profile.contactEligibility?.hasPhone ? 'Contato confirmado para uso interno' : 'Contato ainda não confirmado'}</div></div><SegmentBadge profile={profile} /></div><p className="mt-3 text-sm text-slate-300">{profile.recommendedAction}</p></div>
    <div className="grid grid-cols-2 gap-2"><Fact label="Último atendimento" value={profile.lastAttendance ? formatDate(profile.lastAttendance) : 'Sem registro'} /><Fact label="Dias sem presença" value={profile.recencyDays == null ? '—' : String(profile.recencyDays)} /><Fact label="Faturamento" value={currency.format(profile.lifetimeSales)} /><Fact label="Ticket médio" value={currency.format(profile.ticketAverage)} /><Fact label="Visitas" value={String(profile.visitCount)} /><Fact label="Procedimentos" value={String(profile.procedureCount)} /></div>
    <section className="border-t border-slate-800/80 pt-4"><h3 className="text-sm font-semibold text-white">Histórico confirmado</h3><List label="Procedimentos realizados" values={profile.completedProcedures} empty="Sem procedimentos confirmados." /><List label="Procedimentos comprados classificados" values={profile.purchasedProcedures} empty="Sem itens classificados." />{profile.pendingSaleItems ? <div className="mt-3 flex items-start gap-2 rounded-lg border border-amber-300/20 bg-amber-500/10 p-2 text-xs text-amber-100"><AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />{profile.pendingSaleItems} item(ns) de venda seguem sem classificação e não entram em sugestão de procedimento.</div> : null}</section>
    <section className="border-t border-slate-800/80 pt-4"><div className="flex items-center justify-between gap-3"><h3 className="text-sm font-semibold text-white">Customer 360</h3><span className="text-[11px] text-slate-500">{timeline.length} evento(s) confirmados</span></div>{timeline.length ? <ol className="mt-3 space-y-2">{timeline.map((event) => <li key={event.id} className="rounded-lg border border-slate-800/80 bg-slate-900/45 p-2.5"><div className="flex items-start justify-between gap-3 text-[11px]"><span className={`rounded-full px-2 py-0.5 ${event.type === 'sale' ? 'bg-violet-500/15 text-violet-200' : 'bg-emerald-500/15 text-emerald-200'}`}>{event.type === 'sale' ? 'Caixa' : 'Atendimento'}</span><span className="text-slate-500">{formatDate(event.occurredOn)}</span></div><div className="mt-2 text-xs font-medium text-slate-100">{event.title}</div>{event.detail ? <div className="mt-0.5 text-[11px] text-slate-400">{event.detail}</div> : null}<div className="mt-1 flex flex-wrap gap-x-2 text-[11px] text-slate-500"><span>{event.unitName || 'Unidade não informada'}</span>{event.amount != null ? <span>· {currency.format(event.amount)}</span> : null}</div></li>)}</ol> : <p className="mt-2 text-xs text-slate-500">Nenhum evento confirmado no recorte selecionado.</p>}</section>
    <section className="border-t border-slate-800/80 pt-4"><h3 className="text-sm font-semibold text-white">Cadência clínica</h3>{detail.clinicalCadences.length ? <div className="mt-2 space-y-2">{detail.clinicalCadences.map((cadence) => <div key={`${cadence.procedureId}:${cadence.unitSlug}`} className="text-xs text-slate-300"><span className="font-medium text-slate-100">{cadence.procedureName}</span> · {cadence.status === 'approved' ? `regra aprovada: ${cadence.cadenceDays} dias` : 'sem regra aprovada'}</div>)}</div> : <p className="mt-2 text-xs text-slate-500">Nenhuma cadência aprovada. A plataforma não fará recomendação clínica.</p>}</section>
    <ContactPermission key={`${profile.identityId}:${contactEligibility.permissionRevision}`} profile={profile} contactRolloutAllowed={contactRolloutAllowed} onSaved={onRefresh} />
    <ActionForm detail={detail} units={units} professionals={professionals} onSaved={onRefresh} />
    <ActionHistory actions={detail.actions} contactEligibility={contactEligibility} contactRolloutAllowed={contactRolloutAllowed} onUpdated={onRefresh} />
    <CommercialAssistedWhatsappPanel actions={detail.actions} onUpdated={onRefresh} />
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

function sourceFreshnessStyle(value: string) {
  if (value === 'healthy') return 'text-emerald-300'
  if (value === 'preventive') return 'text-amber-200'
  return 'text-rose-300'
}

function sourceFreshnessLabel(value: string) {
  return ({ healthy: 'Em dia', preventive: 'Atenção', high: 'Defasada', missing: 'Sem leitura' } as Record<string, string>)[value] || 'Indisponível'
}

function SourceOperationsPanel({ operations, loading, onRefresh }: {
  operations: CommercialSourceOperations
  loading: boolean
  onRefresh: () => Promise<void>
}) {
  return <section aria-labelledby="commercial-source-operations-heading" className="rounded-2xl border border-slate-800/80 bg-slate-950/55 p-5 shadow-[0_20px_60px_rgba(2,6,23,0.28)]">
    <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between"><div><h2 id="commercial-source-operations-heading" className="text-lg font-semibold text-white">Fontes operacionais</h2><p className="mt-1 text-sm text-slate-500">Freshness e execução por fonte, sem dados de clientes, chaves técnicas, fingerprints ou backups.</p></div><Button size="sm" variant="outline" onClick={() => void onRefresh()} disabled={loading}><RefreshCw className={`mr-2 h-4 w-4 ${loading ? 'animate-spin' : ''}`} />Atualizar fontes</Button></div>
    <div className="mt-4 overflow-x-auto"><table aria-label="Estado operacional das fontes" className="w-full min-w-225 text-left text-xs"><thead className="border-y border-slate-800/80 text-slate-400"><tr><th className="px-2 py-3 font-medium">Fonte</th><th className="px-2 py-3 font-medium">Freshness</th><th className="px-2 py-3 font-medium">Execução</th><th className="px-2 py-3 font-medium">Sucesso / aplicação</th><th className="px-2 py-3 text-right font-medium">Lidos / aplicados</th><th className="px-2 py-3 text-right font-medium">Divergências</th><th className="px-2 py-3 font-medium">Snapshot</th><th className="px-2 py-3 font-medium">Retries / erro</th></tr></thead><tbody>{operations.sources.map((source) => <tr key={source.sourceId} className="border-b border-slate-800/65 align-top text-slate-300"><td className="px-2 py-3"><div className="font-medium text-slate-100">{source.label}</div><div className="mt-0.5 text-[11px] text-slate-500">{source.domain}{source.required ? ' · obrigatória' : ' · complementar'}</div></td><td className={`px-2 py-3 font-medium ${sourceFreshnessStyle(source.freshness)}`}>{sourceFreshnessLabel(source.freshness)}</td><td className="px-2 py-3"><div>{formatDateTime(source.lastExecution)}</div><div className="mt-1 text-[11px] text-slate-500">Próxima: {formatDateTime(source.nextExecution, 'aguardando')}</div></td><td className="px-2 py-3"><div>Sucesso: {formatDateTime(source.lastSuccess)}</div><div className="mt-1 text-[11px] text-slate-500">Aplicação: {formatDateTime(source.lastApplied, 'não aplicado')}</div></td><td className="px-2 py-3 text-right tabular-nums">{source.recordsRead} / {source.recordsApplied}</td><td className="px-2 py-3 text-right tabular-nums">{source.divergences}</td><td className="px-2 py-3">{source.snapshotComplete ? <span className="text-emerald-300">Completo</span> : <span className="text-amber-200">Pendente</span>}{source.reconciliationRequired ? <div className="mt-1 text-[11px] text-amber-200">Reconciliação necessária</div> : null}</td><td className="px-2 py-3"><div className="tabular-nums">{source.retries} retry(s) · {source.errors} erro(s)</div>{source.error ? <div className="mt-1 text-[11px] text-rose-300">{source.error.code}{source.error.retryable ? ' · retryável' : ''}</div> : null}</td></tr>)}</tbody></table></div>
    {!operations.sources.length ? <p className="py-6 text-center text-sm text-slate-500">Nenhuma fonte operacional foi registrada neste ambiente.</p> : null}
  </section>
}

const reviewTypeLabel: Record<ClientIdentityReviewItem['type'], string> = { attendance_name_merge: 'Grafia no Atendimento', attendance_caixa: 'Atendimento ↔ Caixa', app_attendance: 'Cadastro app ↔ Atendimento', app_caixa: 'Cadastro app ↔ Caixa', lead_app: 'Planilha ↔ Cadastro app', lead_caixa: 'Planilha ↔ Caixa' }
function reviewValue(value: unknown) { return Array.isArray(value) ? value.filter(Boolean).join(', ') : typeof value === 'string' || typeof value === 'number' ? String(value) : '' }
const reviewPresentationFields: Record<'context' | 'evidence', Record<ClientIdentityReviewItem['type'], Array<[string, string]>>> = {
  context: {
    attendance_name_merge: [['leftAttendanceCount', 'Atendimentos do primeiro registro'], ['rightAttendanceCount', 'Atendimentos do segundo registro'], ['leftAliases', 'Aliases do primeiro registro'], ['rightAliases', 'Aliases do segundo registro']],
    attendance_caixa: [['attendanceCount', 'Atendimentos'], ['aliases', 'Aliases'], ['sales', 'Vendas registradas'], ['salesTotal', 'Total de vendas']],
    app_attendance: [['appUnits', 'Unidades do cadastro app'], ['attendanceCount', 'Atendimentos'], ['aliases', 'Aliases']],
    app_caixa: [['appUnits', 'Unidades do cadastro app'], ['sales', 'Vendas registradas'], ['salesTotal', 'Total de vendas']],
    lead_app: [['leadUnits', 'Unidades do lead'], ['appUnits', 'Unidades do cadastro app']],
    lead_caixa: [['leadUnits', 'Unidades do lead'], ['sales', 'Vendas registradas'], ['salesTotal', 'Total de vendas']],
  },
  evidence: {
    attendance_name_merge: [['method', 'Método'], ['matchType', 'Tipo de correspondência'], ['sharedUnit', 'Unidade coincidente'], ['sharedProcedure', 'Procedimento coincidente'], ['uniqueCandidate', 'Candidato único'], ['sameName', 'Nome coincidente']],
    attendance_caixa: [['method', 'Método'], ['matchType', 'Tipo de correspondência'], ['sharedUnit', 'Unidade coincidente'], ['sharedProcedure', 'Procedimento coincidente'], ['uniqueCandidate', 'Candidato único'], ['sameName', 'Nome coincidente']],
    app_attendance: [['method', 'Método'], ['matchType', 'Tipo de correspondência'], ['sharedUnit', 'Unidade coincidente'], ['sharedProcedure', 'Procedimento coincidente'], ['uniqueCandidate', 'Candidato único']],
    app_caixa: [['method', 'Método'], ['matchType', 'Tipo de correspondência'], ['sharedUnit', 'Unidade coincidente'], ['sharedProcedure', 'Procedimento coincidente'], ['uniqueCandidate', 'Candidato único']],
    lead_app: [['method', 'Método'], ['matchType', 'Tipo de correspondência'], ['sharedUnit', 'Unidade coincidente'], ['sharedProcedure', 'Procedimento coincidente'], ['uniqueCandidate', 'Candidato único']],
    lead_caixa: [['method', 'Método'], ['matchType', 'Tipo de correspondência'], ['sharedUnit', 'Unidade coincidente'], ['sharedProcedure', 'Procedimento coincidente'], ['uniqueCandidate', 'Candidato único']],
  },
}
function reviewDisplayFields(type: ClientIdentityReviewItem['type'], section: 'context' | 'evidence', value: Record<string, unknown>) {
  return reviewPresentationFields[section][type].flatMap(([key, label]) => {
    const shown = reviewValue(value?.[key])
    return shown ? [{ key, label, value: shown }] : []
  })
}

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
      const contextFields = reviewDisplayFields(item.type, 'context', item.context)
      const evidenceFields = reviewDisplayFields(item.type, 'evidence', item.evidence)
      return <article key={key} className="rounded-xl border border-slate-800/80 bg-slate-900/35 p-4"><div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between"><div><div className="text-xs text-sky-300">{reviewTypeLabel[item.type]}</div><div className="mt-1 text-sm font-semibold text-white">{item.primaryName} <span className="mx-1 text-slate-600">↔</span> {item.secondaryName}</div></div><div className={`text-xs ${item.decisionState === 'stale' ? 'text-amber-200' : 'text-slate-400'}`}>{reviewDecisionLabel(item)} · confiança {Math.round(item.confidence * 100)}%</div></div><div className="mt-3 grid gap-2 text-xs text-slate-400 md:grid-cols-2"><div><span className="text-slate-500">Contexto: </span>{contextFields.length ? contextFields.map((field) => <span key={field.key} className="mr-3 inline-block">{field.label}: <span className="text-slate-200">{field.value}</span></span>) : <span className="text-slate-500">sem campos adicionais</span>}</div><div><span className="text-slate-500">Evidência: </span>{evidenceFields.length ? evidenceFields.map((field) => <span key={field.key} className="mr-3 inline-block">{field.label}: <span className="text-slate-200">{field.value}</span></span>) : <span className="text-slate-500">não disponível</span>}</div></div>{item.decisionState === 'stale' ? <p className="mt-3 text-xs text-amber-200">A fonte mudou depois da última decisão. Desfaça-a explicitamente e registre um novo motivo antes de revisar de novo.</p> : null}<div className="mt-3 grid gap-2 border-t border-slate-800/70 pt-3 md:grid-cols-[minmax(0,1fr)_auto]">{item.type === 'attendance_name_merge' && !undoable ? <select aria-label={`Cliente sobrevivente para ${item.primaryName}`} value={draft.survivorClientId} onChange={(event) => updateDraft(item, { survivorClientId: event.target.value })} disabled={!writesReady || isActing} className="rounded-lg border border-slate-800 bg-slate-950 px-3 py-2 text-sm text-slate-100"><option value="">Escolha o cliente canônico a manter</option><option value={item.sourceId}>Manter {item.primaryName}</option><option value={item.targetId}>Manter {item.secondaryName}</option></select> : null}<input aria-label={`Motivo da decisão para ${item.primaryName}`} value={draft.reason} onChange={(event) => updateDraft(item, { reason: event.target.value })} placeholder={undoable ? 'Motivo do desfazimento' : 'Motivo da decisão'} maxLength={1000} disabled={!writesReady || isActing} className="rounded-lg border border-slate-800 bg-slate-950 px-3 py-2 text-sm text-slate-100 placeholder:text-slate-500" /><div className="flex flex-wrap gap-2 md:justify-end">{undoable ? <Button size="sm" variant="outline" onClick={() => void undo(item)} disabled={!writesReady || isActing || draft.reason.trim().length < 3}>Desfazer decisão</Button> : <><Button size="sm" onClick={() => void decide(item, 'confirmed')} disabled={!writesReady || isActing || draft.reason.trim().length < 3 || (item.type === 'attendance_name_merge' && !draft.survivorClientId)}>Confirmar</Button><Button size="sm" variant="outline" onClick={() => void decide(item, 'rejected')} disabled={!writesReady || isActing || draft.reason.trim().length < 3}>Rejeitar</Button></>}</div></div></article>
    })}{!busy && !items.length ? <p className="py-6 text-center text-sm text-slate-500">Nenhuma sugestão encontrada para estes filtros.</p> : null}</div>
    {items.length < total ? <div className="mt-4 text-center"><Button size="sm" variant="outline" onClick={() => void load(items.length, true)} disabled={busy}>Carregar mais 100</Button></div> : null}
  </section>
}

export function ClientCommercialModule() {
  const initialLocation = useMemo(() => ({
    route: parseClientesWorkspaceRoute() || { view: 'overview' as const, source: 'legacy' as const },
    filters: readClientesWalletUrlState(),
  }), [])
  const [overview, setOverview] = useState<CommercialOverview | null>(null)
  const [detail, setDetail] = useState<CommercialProfileDetail | null>(null)
  const [units, setUnits] = useState<Array<{ slug: string; name: string }>>([])
  const [professionals, setProfessionals] = useState<Array<{ name: string }>>([])
  const [unit, setUnit] = useState(initialLocation.filters.unit)
  const [segment, setSegment] = useState(initialLocation.filters.segment)
  const [priority, setPriority] = useState(initialLocation.filters.priority)
  const [search, setSearch] = useState(initialLocation.filters.q)
  const [pageOffset, setPageOffset] = useState(initialLocation.filters.offset)
  const [sort, setSort] = useState<ClientesWalletUrlState['sort']>(initialLocation.filters.sort)
  const [direction, setDirection] = useState<ClientesWalletUrlState['direction']>(initialLocation.filters.direction)
  const [workspaceRoute, setWorkspaceRoute] = useState<ClientesWorkspaceRoute>(initialLocation.route)
  const workspaceView = workspaceRoute.view
  const [savedViewName, setSavedViewName] = useState('')
  const [savedViews, setSavedViews] = useState<Array<{ name: string; unit: string; segment: string; priority: string; search: string; sort: ClientesWalletUrlState['sort']; direction: ClientesWalletUrlState['direction'] }>>([])
  const pageSize = 50
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [cooldown, setCooldown] = useState(30)
  const [thresholds, setThresholds] = useState('90,180,365')
  const [cadenceProcedure, setCadenceProcedure] = useState('')
  const [cadenceDays, setCadenceDays] = useState('')
  const [cadenceStatus, setCadenceStatus] = useState<CommercialCadenceManagerStatus>('draft')
  const [cadenceJustification, setCadenceJustification] = useState('')
  const [cadenceEvidence, setCadenceEvidence] = useState('')
  const [cadenceEffectiveFrom, setCadenceEffectiveFrom] = useState(new Date().toISOString().slice(0, 10))
  const [cadenceExpiresAt, setCadenceExpiresAt] = useState('')
  const [cadenceNotice, setCadenceNotice] = useState('')
  const [procedureOptions, setProcedureOptions] = useState<Array<{ id: string; name: string }>>([])
  const [commercialDataQuality, setCommercialDataQuality] = useState<CommercialDataQualityQueue | null>(null)
  const [commercialDataQualityBusy, setCommercialDataQualityBusy] = useState(false)
  const [commercialDataQualityError, setCommercialDataQualityError] = useState('')
  const [commercialSourceOperations, setCommercialSourceOperations] = useState<CommercialSourceOperations | null>(null)
  const [commercialSourceOperationsBusy, setCommercialSourceOperationsBusy] = useState(false)
  const [commercialSourceOperationsError, setCommercialSourceOperationsError] = useState('')
  const contactSummary = overview?.dataQuality?.contactEligibility || { eligible: 0, blocked: 0, reviewRequired: 0, controlsReady: false, contactWriteControlsReady: false }

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
    } finally {
      setCommercialDataQualityBusy(false)
    }
  }, [])

  const loadCommercialSourceOperations = useCallback(async () => {
    try {
      setCommercialSourceOperationsBusy(true); setCommercialSourceOperationsError('')
      const result = await fetchCommercialSourceOperations()
      if (result.ok) {
        setCommercialSourceOperations(result)
        return
      }
      setCommercialSourceOperations(null)
      if (isCommercialSourceOperationsScopeDenied(result.error)) {
        setCommercialSourceOperationsError('As fontes agregadas não podem ser exibidas no escopo de unidade atual.')
      } else {
        setCommercialSourceOperationsError('O painel operacional de fontes não está disponível neste ambiente.')
      }
    } finally {
      setCommercialSourceOperationsBusy(false)
    }
  }, [])

  const load = useCallback(async (next?: {
    selectIdentityId?: string | null
    offset?: number
    unit?: string
    segment?: string
    priority?: string
    search?: string
    sort?: ClientesWalletUrlState['sort']
    direction?: ClientesWalletUrlState['direction']
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
      const [commercial, references] = await Promise.all([fetchCommercialOverview({ unit: requestUnit, segment: requestSegment, priority: requestPriority, q: requestSearch, limit: pageSize, offset: requestOffset, server: true, sort: requestSort, direction: requestDirection }), fetchCommercialReferences()])
      if (!commercial.ok) throw new Error(commercial.error || 'Não foi possível carregar a inteligência comercial.')
      if (!references.ok) throw new Error(references.error || 'Não foi possível carregar referências do CRM.')
      setPageOffset(requestOffset)
      setSort(requestSort)
      setDirection(requestDirection)
      setOverview(commercial); setUnits(references.units); setProfessionals(references.professionals.map((person) => ({ name: person.name }))); setProcedureOptions(references.procedures.map((procedure) => ({ id: procedure.id, name: procedure.name })))
      setCooldown(commercial.policy.activeContactCooldownDays); setThresholds(commercial.policy.returnRiskThresholds.join(','))
      const selectsExplicitly = Boolean(next && Object.prototype.hasOwnProperty.call(next, 'selectIdentityId'))
      const selectedId = selectsExplicitly ? next?.selectIdentityId : detail?.profile.identityId
      const candidate = selectedId
        ? commercial.profiles.find((profile) => profile.identityId === selectedId)
        : selectsExplicitly ? null : commercial.profiles[0]
      if (candidate) await loadDetail(candidate.identityId, commercial.asOf, requestUnit)
      else if (selectedId && selectsExplicitly) await loadDetail(selectedId, commercial.asOf, requestUnit)
      else if (selectsExplicitly) setDetail(null)
      else if (!commercial.profiles.length) setDetail(null)
      void loadCommercialDataQuality()
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Não foi possível carregar a inteligência comercial.') } finally { setBusy(false) }
  // Filters are deliberately applied only with the button, so typing does not trigger a request per keystroke.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [unit, segment, priority, search, pageOffset, sort, direction, detail?.profile.identityId])

  const loadDetail = useCallback(async (identityId: string, asOf?: string, unitOverride = unit) => {
    const result = await fetchCommercialProfile(identityId, { asOf, unit: unitOverride })
    if (!result.ok) throw new Error(result.error || 'Não foi possível carregar o perfil do cliente.')
    setDetail(result)
  }, [unit])

  // Initial load intentionally follows the route once. Changing a draft filter
  // remains explicit through “Aplicar”, so typing never triggers a request.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    const { q, ...filters } = initialLocation.filters
    void load({ ...filters, search: q, selectIdentityId: initialLocation.route.identityId || null })
  }, [])

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem('skincos:clientes:saved-views')
      if (raw) {
        const parsed = JSON.parse(raw)
        if (Array.isArray(parsed)) setSavedViews(parsed.filter((item) => item && typeof item.name === 'string').slice(0, 12))
      }
    } catch { /* local view persistence is best-effort and never blocks the module */ }
  }, [])

  useEffect(() => {
    const onPopState = () => {
      const route = parseClientesWorkspaceRoute()
      if (!route) return
      const filters = readClientesWalletUrlState()
      setWorkspaceRoute(route)
      setUnit(filters.unit); setSegment(filters.segment); setPriority(filters.priority); setSearch(filters.q)
      setPageOffset(filters.offset); setSort(filters.sort); setDirection(filters.direction)
      const { q, ...request } = filters
      void load({ ...request, search: q, selectIdentityId: route.identityId || null })
    }
    window.addEventListener('popstate', onPopState)
    return () => window.removeEventListener('popstate', onPopState)
  }, [load])

  useEffect(() => {
    if (workspaceView === 'quality') void loadCommercialSourceOperations()
  }, [workspaceView, loadCommercialSourceOperations])

  const walletUrlState = useMemo<ClientesWalletUrlState>(() => ({
    ...defaultClientesWalletUrlState,
    unit,
    segment,
    priority,
    q: search,
    sort,
    direction,
    offset: pageOffset,
  }), [direction, pageOffset, priority, search, segment, sort, unit])

  const navigateWorkspace = useCallback((route: Pick<ClientesWorkspaceRoute, 'view' | 'identityId'>, filters = walletUrlState) => {
    if (typeof window !== 'undefined') {
      const href = clientesWorkspaceUrl(route, filters)
      const currentHref = `${window.location.pathname}${window.location.search}${window.location.hash}`
      if (href !== currentHref) window.history.pushState(window.history.state, document.title, href)
    }
    setWorkspaceRoute({ ...route, source: 'path' })
    if (!route.identityId) setDetail(null)
  }, [walletUrlState])

  const persistSavedViews = (next: typeof savedViews) => {
    setSavedViews(next)
    try { window.localStorage.setItem('skincos:clientes:saved-views', JSON.stringify(next)) } catch { /* ignore unavailable storage */ }
  }

  const saveCurrentView = () => {
    const name = savedViewName.trim()
    if (!name) { setError('Informe um nome para salvar esta visão.'); return }
    const next = [{ name, unit, segment, priority, search, sort, direction }, ...savedViews.filter((view) => view.name !== name)].slice(0, 12)
    persistSavedViews(next)
    setSavedViewName('')
  }

  const applySavedView = (view: typeof savedViews[number]) => {
    setUnit(view.unit); setSegment(view.segment); setPriority(view.priority); setSearch(view.search); setSort(view.sort); setDirection(view.direction); setPageOffset(0)
    const filters = { ...walletUrlState, unit: view.unit, segment: view.segment, priority: view.priority, q: view.search, sort: view.sort, direction: view.direction, offset: 0 }
    navigateWorkspace(workspaceRoute, filters)
    void load({ unit: view.unit, segment: view.segment, priority: view.priority, search: view.search, sort: view.sort, direction: view.direction, offset: 0, selectIdentityId: workspaceRoute.identityId || null })
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
      const policy: {
        activeContactCooldownDays: number
        returnRiskThresholds: number[]
        expectedPolicyVersion: string
      } = {
        activeContactCooldownDays: Number(cooldown),
        returnRiskThresholds: values,
        expectedPolicyVersion: overview?.policy.policyVersion || '',
      }
      if (!overview?.policy.policyVersion) throw new Error('A versão atual da política não está disponível. Recarregue antes de salvar.')
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
      const result = await upsertCommercialCadence({ procedureId: cadenceProcedure, cadenceDays: Number(cadenceDays), status: cadenceStatus, justification: cadenceJustification, evidenceReference: cadenceEvidence, effectiveFrom: cadenceEffectiveFrom, expiresAt: cadenceExpiresAt || undefined, idempotencyKey: `commercial-cadence-${cadenceProcedure}-${cadenceEffectiveFrom}` })
      if (!result.ok) {
        if (result.error === 'CLINICAL_CADENCE_APPROVAL_REQUIRED') {
          throw new Error('A aprovação clínica exige um fluxo verificado e não está disponível neste módulo.')
        }
        throw new Error(result.error || 'Não foi possível salvar a cadência.')
      }
      setCadenceNotice('Rascunho salvo. A submissão e a aprovação dependem do domínio clínico e de um aprovador independente; nenhuma recomendação foi habilitada.')
      setCadenceDays('')
      setCadenceJustification('')
      setCadenceEvidence('')
      await load()
    } catch (cause) { setCadenceNotice(cause instanceof Error ? cause.message : 'Não foi possível salvar a cadência.') } finally { setBusy(false) }
  }

  const segmentOptions = useMemo(() => [{ key: '', label: 'Todos os segmentos' }, { key: 'return_at_risk', label: 'Retorno em risco' }, { key: 'high_value_inactive', label: 'Alto valor inativo' }, { key: 'frequent', label: 'Assíduos' }, { key: 'balanced_vip', label: 'VIP equilibrado' }, { key: 'first_return', label: 'Primeiro retorno' }, { key: 'reactivation_potential', label: 'Potencial de reativação' }], [])
  const contactScopeSuffix = contactSummary.scope === 'page' ? ' na página atual' : ''

  const showProfileWorkspace = workspaceView === 'overview' || workspaceView === 'wallet' || workspaceView === 'actions'
  const selectWorkspaceView = (next: ClientesWorkspaceView) => {
    const route = { view: next }
    navigateWorkspace(route)
    const { q, ...filters } = walletUrlState
    void load({ ...filters, search: q, selectIdentityId: null })
  }
  const applyWalletFilters = () => {
    const filters = { ...walletUrlState, offset: 0 }
    setPageOffset(0)
    navigateWorkspace(workspaceRoute, filters)
    const { q, ...request } = filters
    void load({ ...request, search: q, selectIdentityId: workspaceRoute.identityId || null })
  }
  const goToWalletPage = (offset: number) => {
    const filters = { ...walletUrlState, offset }
    setPageOffset(offset)
    navigateWorkspace(workspaceRoute, filters)
    void load({ offset, selectIdentityId: workspaceRoute.identityId || undefined })
  }
  const openProfile = (identityId: string, asOf?: string) => {
    navigateWorkspace({ view: 'wallet', identityId })
    void loadDetail(identityId, asOf).catch((cause) => setError(cause instanceof Error ? cause.message : 'Não foi possível carregar o perfil do cliente.'))
  }

  return <section className="space-y-6 text-white">
    <header className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between"><div><h1 className="text-2xl font-bold tracking-tight">Clientes</h1><p className="mt-1 text-sm text-slate-400">Prioridades comerciais baseadas em presença registrada, vendas e procedimentos confirmados.</p></div><div className="flex flex-wrap gap-2"><Button variant="outline" onClick={() => void load()} disabled={busy}><RefreshCw className={`mr-2 h-4 w-4 ${busy ? 'animate-spin' : ''}`} />Atualizar</Button><Button variant="outline" onClick={() => selectWorkspaceView('governance')}><ShieldCheck className="mr-2 h-4 w-4" />Governança</Button></div></header>
    <ClientesWorkspaceNavigation active={workspaceView} filters={walletUrlState} onNavigate={selectWorkspaceView} />
    {error ? <div className="rounded-xl border border-rose-300/30 bg-rose-500/10 p-4 text-sm text-rose-100">{error}</div> : null}
    {workspaceView === 'overview' && overview ? <div className="rounded-xl border border-amber-300/25 bg-amber-500/10 p-4 text-sm text-amber-100"><div className="flex gap-2"><AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" /><div><b>Uso comercial seguro:</b> a recência considera apenas o último atendimento realizado. Compras antecipadas não representam procedimento realizado. {overview.dataQuality.futureAttendancesExcluded ? `${overview.dataQuality.futureAttendancesExcluded} atendimento(s) futuro(s) foram excluídos desta métrica. ` : ''}{overview.dataQuality.activeAttendanceClientsWithoutIdentity ? `${overview.dataQuality.activeAttendanceClientsWithoutIdentity} cliente(s) de Atendimento ainda não têm identidade comercial. ` : ''}{contactSummary.controlsReady ? `${contactSummary.eligible} apto(s), ${contactSummary.blocked} bloqueado(s) e ${contactSummary.reviewRequired} em revisão para WhatsApp${contactScopeSuffix}. ` : 'Os controles de contato ainda não foram migrados; nenhum contato pode ser marcado. '}{!contactSummary.contactWriteControlsReady ? 'A cadência de contato aguarda a migration explícita; filas novas, concessões e registros de contato seguem bloqueados. ' : 'O rollout do canário usa fluxo próprio, auditável e escopado por unidade. Registro de contato, escrita comercial e mensagens seguem desativados.'}</div></div></div> : null}
    {workspaceView === 'governance' ? <section className="grid gap-4 rounded-2xl border border-slate-800/80 bg-slate-950/55 p-5 xl:grid-cols-2">
      <div className="rounded-xl border border-slate-800 bg-slate-950/65 p-4"><h2 className="font-semibold text-white">Política comercial</h2><p className="mt-1 text-sm text-slate-500">Define o intervalo entre contatos assistidos e as faixas de ausência. Não define canário, consentimento nem cadência clínica.</p><div className="mt-4 grid gap-2 sm:grid-cols-2"><label className="text-xs text-slate-400">Intervalo mínimo de contato (dias)<input type="number" value={cooldown} onChange={(event) => setCooldown(Number(event.target.value))} className="mt-1 w-full rounded-lg border border-slate-800 bg-slate-900 px-3 py-2 text-sm text-white" /></label><label className="text-xs text-slate-400">Faixas de ausência<input value={thresholds} onChange={(event) => setThresholds(event.target.value)} className="mt-1 w-full rounded-lg border border-slate-800 bg-slate-900 px-3 py-2 text-sm text-white" /></label></div><Button size="sm" onClick={() => void savePolicy()} disabled={busy} className="mt-3"><Save className="mr-2 h-4 w-4" />Salvar política</Button><p className="mt-3 text-xs text-amber-200">A política não habilita escrita comercial. Consentimento e bloqueios continuam verificados no instante de qualquer contato assistido.</p></div>
      <CommercialCanaryManager units={units} policyVersion={overview?.policy.policyVersion || ''} onChanged={() => load()} />
      <div className="rounded-xl border border-slate-800 bg-slate-950/65 p-4 xl:col-span-2"><h2 className="font-semibold text-white">Rascunho de regra clínica</h2><p className="mt-1 text-sm text-slate-500">Gestores comerciais apenas registram um rascunho. A aprovação exige o domínio clínico, segregação de funções e evidência; nenhuma prescrição ou recomendação automática é criada.</p><div className="mt-4 grid gap-2 sm:grid-cols-2"><select aria-label="Procedimento da regra clínica" value={cadenceProcedure} onChange={(event) => setCadenceProcedure(event.target.value)} className="rounded-lg border border-slate-800 bg-slate-900 px-3 py-2 text-sm text-white"><option value="">Procedimento</option>{procedureOptions.map((procedure) => <option key={procedure.id} value={procedure.id}>{procedure.name}</option>)}</select><input aria-label="Intervalo em dias" type="number" min="1" placeholder="Dias" value={cadenceDays} onChange={(event) => setCadenceDays(event.target.value)} className="rounded-lg border border-slate-800 bg-slate-900 px-3 py-2 text-sm text-white" /><select aria-label="Estado do rascunho" value={cadenceStatus} onChange={(event) => setCadenceStatus(event.target.value as CommercialCadenceManagerStatus)} className="rounded-lg border border-slate-800 bg-slate-900 px-3 py-2 text-sm text-white">{commercialCadenceManagerStatuses.map((item) => <option key={item} value={item}>{commercialCadenceStatusLabels[item]}</option>)}</select><input aria-label="Início da vigência" type="date" value={cadenceEffectiveFrom} onChange={(event) => setCadenceEffectiveFrom(event.target.value)} className="rounded-lg border border-slate-800 bg-slate-900 px-3 py-2 text-sm text-white" /><input aria-label="Expiração opcional" type="date" value={cadenceExpiresAt} onChange={(event) => setCadenceExpiresAt(event.target.value)} className="rounded-lg border border-slate-800 bg-slate-900 px-3 py-2 text-sm text-white" /><input aria-label="Referência da evidência" placeholder="Referência/evidência" value={cadenceEvidence} onChange={(event) => setCadenceEvidence(event.target.value)} className="rounded-lg border border-slate-800 bg-slate-900 px-3 py-2 text-sm text-white sm:col-span-2" /><textarea aria-label="Justificativa clínica" placeholder="Justificativa (mínimo 10 caracteres)" value={cadenceJustification} onChange={(event) => setCadenceJustification(event.target.value)} className="min-h-20 rounded-lg border border-slate-800 bg-slate-900 px-3 py-2 text-sm text-white sm:col-span-2" /></div><Button size="sm" variant="outline" onClick={() => void saveCadence()} disabled={busy || !cadenceProcedure || !cadenceDays || cadenceJustification.trim().length < 10 || cadenceEvidence.trim().length < 3} className="mt-3"><Save className="mr-2 h-4 w-4" />Salvar rascunho</Button>{cadenceNotice ? <div role="status" className="mt-2 text-xs text-slate-400">{cadenceNotice}</div> : null}</div>
    </section> : null}
    {workspaceView === 'overview' ? <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4"><Metric label="Retorno em risco" value={overview?.summary.returnAtRisk ?? '—'} detail="Sem presença registrada na faixa configurada" icon={CalendarClock} /><Metric label="Alto valor inativo" value={overview?.summary.highValueInactive ?? '—'} detail="Valor e ausência combinados" icon={CircleDollarSign} /><Metric label="Potencial de reativação" value={overview?.summary.reactivationPotential ?? '—'} detail="Prioridade para a equipe" icon={UserRoundCheck} /><Metric label="Aptos para WhatsApp" value={overview ? contactSummary.eligible : '—'} detail="Permissão explícita e bloqueios verificados" icon={UsersRound} /></div> : null}
    {workspaceView === 'quality' ? <ClientesWorkspaceSection sectionKey="quality">
    {workspaceView === 'quality' && commercialDataQualityError ? <div className="rounded-xl border border-amber-300/25 bg-amber-500/10 p-4 text-sm text-amber-100">{commercialDataQualityError}</div> : null}
    {workspaceView === 'quality' && commercialSourceOperationsError ? <div role="status" className="rounded-xl border border-amber-300/25 bg-amber-500/10 p-4 text-sm text-amber-100">{commercialSourceOperationsError}</div> : null}
    {workspaceView === 'quality' && commercialSourceOperationsBusy && !commercialSourceOperations ? <div role="status" className="rounded-xl border border-slate-800/80 bg-slate-950/55 p-4 text-sm text-slate-400">Carregando estado das fontes…</div> : null}
    {workspaceView === 'quality' && commercialSourceOperations ? <SourceOperationsPanel operations={commercialSourceOperations} loading={commercialSourceOperationsBusy} onRefresh={loadCommercialSourceOperations} /> : null}
    {workspaceView === 'quality' && commercialDataQuality ? <CommercialDataQualityPanel queue={commercialDataQuality} loading={commercialDataQualityBusy} onRefresh={loadCommercialDataQuality} /> : null}
    {workspaceView === 'quality' ? <CommercialAnalyticsPanel units={units} /> : null}
    </ClientesWorkspaceSection> : null}
    {showProfileWorkspace ? <ClientesWorkspaceSection sectionKey="wallet">
    <>
    <div className="flex flex-wrap gap-2 rounded-xl border border-slate-800/80 bg-slate-950/45 p-3"><select aria-label="Unidade" value={unit} onChange={(event) => setUnit(event.target.value)} className="rounded-lg border border-slate-800 bg-slate-900 px-3 py-2 text-sm text-slate-100"><option value="all">Todas as unidades</option>{units.map((item) => <option key={item.slug} value={item.slug}>{item.name}</option>)}</select><select aria-label="Segmento" value={segment} onChange={(event) => setSegment(event.target.value)} className="rounded-lg border border-slate-800 bg-slate-900 px-3 py-2 text-sm text-slate-100">{segmentOptions.map((item) => <option key={item.key} value={item.key}>{item.label}</option>)}</select><select aria-label="Prioridade" value={priority} onChange={(event) => setPriority(event.target.value)} className="rounded-lg border border-slate-800 bg-slate-900 px-3 py-2 text-sm text-slate-100"><option value="">Todas as prioridades</option><option value="high">Alta</option><option value="medium">Média</option><option value="normal">Normal</option></select><input aria-label="Buscar cliente" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Buscar cliente" className="min-w-48 flex-1 rounded-lg border border-slate-800 bg-slate-900 px-3 py-2 text-sm text-slate-100 placeholder:text-slate-500" /><select aria-label="Ordenar clientes" value={sort} onChange={(event) => setSort(event.target.value as ClientesWalletUrlState['sort'])} className="rounded-lg border border-slate-800 bg-slate-900 px-3 py-2 text-sm text-slate-100"><option value="priority">Prioridade</option><option value="recency">Recência</option><option value="lifetime_sales">Faturamento</option><option value="visits">Visitas</option><option value="sales">Compras</option><option value="last_attendance">Último atendimento</option><option value="name">Nome</option></select><select aria-label="Direção da ordenação" value={direction} onChange={(event) => setDirection(event.target.value as ClientesWalletUrlState['direction'])} className="rounded-lg border border-slate-800 bg-slate-900 px-3 py-2 text-sm text-slate-100"><option value="desc">Maior primeiro</option><option value="asc">Menor primeiro</option></select><Button size="sm" onClick={applyWalletFilters} disabled={busy}>Aplicar</Button><div className="flex w-full flex-wrap gap-2 border-t border-slate-800/80 pt-3"><input aria-label="Nome da visão salva" value={savedViewName} onChange={(event) => setSavedViewName(event.target.value)} placeholder="Nome da visão" className="min-w-48 flex-1 rounded-lg border border-slate-800 bg-slate-900 px-3 py-2 text-sm text-slate-100 placeholder:text-slate-500" /><Button size="sm" variant="outline" onClick={saveCurrentView} disabled={busy}>Salvar visão</Button>{savedViews.length ? <select aria-label="Visões salvas" defaultValue="" onChange={(event) => { const view = savedViews.find((item) => item.name === event.target.value); if (view) applySavedView(view); event.currentTarget.value = '' }} className="rounded-lg border border-slate-800 bg-slate-900 px-3 py-2 text-sm text-slate-100"><option value="">Abrir visão salva</option>{savedViews.map((view) => <option key={view.name} value={view.name}>{view.name}</option>)}</select> : null}</div></div>
    <div className="grid gap-5 2xl:grid-cols-[minmax(0,1.7fr)_minmax(22rem,0.8fr)]">
       <section className="overflow-hidden rounded-2xl border border-slate-800/80 bg-slate-950/55 shadow-[0_20px_60px_rgba(2,6,23,0.28)]">
         <div className="flex items-center justify-between border-b border-slate-800/80 p-5"><div><h2 className="font-semibold text-white">{workspaceView === 'wallet' ? 'Carteira de clientes' : workspaceView === 'actions' ? 'Fila de ações comerciais' : 'Prioridades de reativação'}</h2><p className="mt-1 text-xs text-slate-500">{workspaceView === 'actions' ? 'Ações assistidas, sem envio automático de mensagens.' : overview ? `${overview.total} clientes na seleção atual` : 'Carregando clientes…'}</p></div><div className="text-xs text-slate-500">Fila: {overview?.actions.actions ?? 0} · Contatos: {overview?.actions.contactedActions ?? 0}</div></div>
        <div className="overflow-x-auto"><table className="w-full min-w-190 text-sm"><thead className="bg-white/[0.025] text-left text-xs font-medium text-slate-400"><tr><th className="p-3">Cliente</th><th className="p-3">Último atendimento</th><th className="p-3 text-right">Faturamento</th><th className="p-3">Frequência</th><th className="p-3">Próxima ação</th><th className="p-3">Prioridade</th><th className="p-3" /></tr></thead><tbody>{overview?.profiles.map((profile, index) => <tr key={profile.identityId} className={`border-t border-slate-800/70 transition hover:bg-sky-500/[0.05] ${detail?.profile.identityId === profile.identityId ? 'bg-sky-500/[0.08]' : ''}`}><td className="p-3"><a href={clientesWorkspaceUrl({ view: 'wallet', identityId: profile.identityId }, walletUrlState)} aria-label={`Abrir perfil de ${maskedWalletCustomerLabel(pageOffset + index)}`} onClick={(event) => { if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return; event.preventDefault(); openProfile(profile.identityId, overview.asOf) }} className="font-medium text-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-300">{maskedWalletCustomerLabel(pageOffset + index)}</a><div className="mt-0.5 text-xs text-slate-500">{profile.identityQuality.replace(/_/g, ' ')}</div><div className={`mt-1 text-[11px] ${contactEligibilityTextStyle(profile.contactEligibility)}`}>{contactEligibilityLabel(profile.contactEligibility)}</div></td><td className="p-3"><div className="text-slate-200">{formatDate(profile.lastAttendance)}</div><div className={`mt-0.5 text-xs ${profile.recencyDays != null && profile.recencyDays >= 180 ? 'text-rose-300' : 'text-slate-500'}`}>{profile.recencyDays == null ? 'Sem presença confirmada' : `${profile.recencyDays} dias`}</div></td><td className="p-3 text-right"><div className="font-medium text-slate-100">{currency.format(profile.lifetimeSales)}</div><div className="mt-0.5 text-xs text-slate-500">{profile.saleCount} compra(s)</div></td><td className="p-3"><div className="text-slate-200">{profile.visitCount} visita(s)</div><div className="mt-0.5 text-xs text-slate-500">{profile.procedureCount} procedimento(s)</div></td><td className="max-w-56 p-3 text-slate-300">Consultar perfil</td><td className="p-3"><SegmentBadge profile={profile} /></td><td className="p-3 text-right"><ChevronRight className="inline h-4 w-4 text-slate-500" /></td></tr>)}</tbody></table>{overview && !overview.profiles.length ? <div className="p-8 text-center text-sm text-slate-500">Nenhum cliente encontrado para os filtros selecionados.</div> : null}</div>
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-800/80 p-4 text-xs text-slate-500"><span>{overview ? `${overview.total ? pageOffset + 1 : 0}–${Math.min(pageOffset + overview.profiles.length, overview.total)} de ${overview.total}` : 'Carregando…'}{overview?.pagination?.mode === 'sql' ? ' · paginação SQL' : ''}</span><div className="flex gap-2"><Button size="sm" variant="outline" disabled={busy || !overview?.pagination?.hasPrevious} onClick={() => goToWalletPage(Math.max(0, pageOffset - pageSize))}>Anterior</Button><Button size="sm" variant="outline" disabled={busy || !overview?.pagination?.hasNext} onClick={() => goToWalletPage(pageOffset + pageSize)}>Próxima</Button></div></div>
      </section>
      <ProfilePanel detail={detail} units={units} professionals={professionals} onRefresh={refreshDetail} />
    </div>
    <footer className="flex items-center gap-2 text-xs text-slate-500"><CheckCircle2 className="h-4 w-4 text-emerald-400" />Recência = último procedimento realizado. Vendas e procedimentos continuam separados no perfil comercial.</footer>
    </>
    </ClientesWorkspaceSection> : null}
    {workspaceView === 'identities' ? <ClientesWorkspaceSection sectionKey="identities"><div className="space-y-6"><IdentityClusterWorkspace /><IdentityReviewQueue /></div></ClientesWorkspaceSection> : null}
  </section>
}
