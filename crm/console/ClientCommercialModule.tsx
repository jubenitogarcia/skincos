import { useCallback, useEffect, useMemo, useState } from 'react'
import { AlertTriangle, CalendarClock, CheckCircle2, ChevronRight, CircleDollarSign, RefreshCw, Save, ShieldCheck, UserRoundCheck, UsersRound } from 'lucide-react'
import { Button } from '@/button'
import {
  createCommercialAction,
  fetchAtendimentoReferences,
  fetchClientIdentityReviewQueue,
  fetchCommercialOverview,
  fetchCommercialProfile,
  updateCommercialAction,
  updateCommercialPolicy,
  upsertCommercialCadence,
  type CommercialAction,
  type CommercialOverview,
  type CommercialProfile,
  type CommercialProfileDetail,
  type ClientIdentityReviewItem,
} from '@/atendimentoApi'

const currency = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' })
const date = new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo' })
const priorityStyles: Record<string, string> = {
  high: 'border-rose-300/30 bg-rose-500/10 text-rose-100',
  medium: 'border-amber-300/30 bg-amber-500/10 text-amber-100',
  normal: 'border-sky-300/25 bg-sky-500/10 text-sky-100',
}

function formatDate(value: string | null | undefined) {
  if (!value) return 'Sem registro'
  const parsed = new Date(`${String(value).slice(0, 10)}T12:00:00`)
  return Number.isNaN(parsed.getTime()) ? String(value) : date.format(parsed)
}

function statusLabel(value: string) {
  return ({ open: 'Aberta', contacted: 'Contatado', responded: 'Respondeu', scheduled: 'Agendado', won_sale: 'Venda registrada', returned: 'Retorno clínico', closed: 'Encerrada', cancelled: 'Cancelada' } as Record<string, string>)[value] || value
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

function ActionForm({ detail, units, professionals, onSaved }: { detail: CommercialProfileDetail; units: Array<{ slug: string; name: string }>; professionals: Array<{ name: string }>; onSaved: () => Promise<void> }) {
  const [owner, setOwner] = useState('')
  const [unit, setUnit] = useState('')
  const [actionType, setActionType] = useState<CommercialAction['actionType']>('contact')
  const [dueDate, setDueDate] = useState('')
  const [notes, setNotes] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const firstSegment = detail.profile.segments[0]
  const save = async () => {
    try {
      setBusy(true); setError('')
      const result = await createCommercialAction({ identityId: detail.profile.identityId, segmentKey: firstSegment?.key || 'manual_follow_up', actionType, owner, dueDate, notes, unit: unit || (units.length === 1 ? units[0].slug : undefined) })
      if (!result.ok) throw new Error(result.error || 'Não foi possível registrar a ação.')
      setNotes(''); setDueDate('')
      await onSaved()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Não foi possível registrar a ação.')
    } finally { setBusy(false) }
  }
  return <section className="border-t border-slate-800/80 pt-4">
    <div className="flex items-center gap-2"><UserRoundCheck className="h-4 w-4 text-emerald-300" /><h3 className="text-sm font-semibold text-white">Registrar ação assistida</h3></div>
    <p className="mt-1 text-xs text-slate-500">Nenhuma mensagem será enviada automaticamente.</p>
    <div className="mt-3 grid gap-2 sm:grid-cols-2">
      <select value={owner} onChange={(event) => setOwner(event.target.value)} className="rounded-lg border border-slate-800 bg-slate-900/70 px-3 py-2 text-sm text-slate-100"><option value="">Responsável</option>{professionals.map((person) => <option key={person.name} value={person.name}>{person.name}</option>)}</select>
      <select value={actionType} onChange={(event) => setActionType(event.target.value as CommercialAction['actionType'])} className="rounded-lg border border-slate-800 bg-slate-900/70 px-3 py-2 text-sm text-slate-100"><option value="contact">Contato consultivo</option><option value="follow_up">Acompanhamento</option><option value="appointment">Agendamento</option><option value="relationship">Relacionamento</option></select>
      <select value={unit} onChange={(event) => setUnit(event.target.value)} className="rounded-lg border border-slate-800 bg-slate-900/70 px-3 py-2 text-sm text-slate-100"><option value="">Unidade vinculada</option>{units.map((item) => <option key={item.slug} value={item.slug}>{item.name}</option>)}</select>
      <input type="date" aria-label="Data prevista" value={dueDate} onChange={(event) => setDueDate(event.target.value)} className="rounded-lg border border-slate-800 bg-slate-900/70 px-3 py-2 text-sm text-slate-100" />
      <Button size="sm" onClick={() => void save()} disabled={busy || !firstSegment} className="bg-emerald-500 text-slate-950 hover:bg-emerald-400 sm:col-span-2"><Save className="mr-2 h-4 w-4" />Registrar</Button>
    </div>
    <textarea value={notes} onChange={(event) => setNotes(event.target.value)} placeholder="Contexto, combinado ou observação para a equipe" className="mt-2 min-h-20 w-full rounded-lg border border-slate-800 bg-slate-900/70 px-3 py-2 text-sm text-slate-100 placeholder:text-slate-500" />
    {error ? <div className="mt-2 text-xs text-rose-200">{error}</div> : null}
  </section>
}

function ActionHistory({ actions, onUpdated }: { actions: CommercialAction[]; onUpdated: () => Promise<void> }) {
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
    {!actions.length ? <p className="mt-2 text-sm text-slate-500">Nenhuma ação registrada para este cliente.</p> : <div className="mt-3 space-y-2">{actions.map((action) => <div key={action.id} className="rounded-xl border border-slate-800/80 bg-slate-900/40 p-3">
      <div className="flex items-center justify-between gap-2"><span className="text-sm font-medium text-slate-100">{statusLabel(action.status)}</span><span className="text-xs text-slate-500">{formatDate(action.createdAt)}</span></div>
      <div className="mt-1 text-xs text-slate-400">{action.owner || 'Sem responsável'} · {action.segmentKey}</div>
      {action.notes ? <div className="mt-2 text-xs text-slate-300">{action.notes}</div> : null}
      {['open', 'contacted', 'responded', 'scheduled'].includes(action.status) ? <select disabled={busyId === action.id} value={action.status} onChange={(event) => void changeStatus(action, event.target.value as CommercialAction['status'])} className="mt-2 w-full rounded-lg border border-slate-800 bg-slate-950 px-2 py-1.5 text-xs text-slate-200"><option value="open">Aberta</option><option value="contacted">Contatado</option><option value="responded">Respondeu</option><option value="scheduled">Agendado</option><option value="won_sale">Venda registrada</option><option value="returned">Retorno clínico</option><option value="closed">Encerrada</option><option value="cancelled">Cancelada</option></select> : null}
    </div>)}</div>}
    {error ? <div className="mt-2 text-xs text-rose-200">{error}</div> : null}
  </section>
}

function ProfilePanel({ detail, units, professionals, onRefresh }: { detail: CommercialProfileDetail | null; units: Array<{ slug: string; name: string }>; professionals: Array<{ name: string }>; onRefresh: () => Promise<void> }) {
  if (!detail) return <aside className="rounded-2xl border border-slate-800/80 bg-slate-950/45 p-5 text-sm text-slate-500">Selecione um cliente para abrir o perfil comercial.</aside>
  const { profile } = detail
  return <aside className="space-y-5 rounded-2xl border border-slate-800/80 bg-slate-950/55 p-5 shadow-[0_20px_60px_rgba(2,6,23,0.28)]">
    <div><div className="flex items-start justify-between gap-3"><div><h2 className="text-lg font-semibold text-white">{profile.name}</h2><div className="mt-1 text-xs text-slate-400">{profile.phone || 'Sem telefone de contato'}{profile.email ? ` · ${profile.email}` : ''}</div></div><SegmentBadge profile={profile} /></div><p className="mt-3 text-sm text-slate-300">{profile.recommendedAction}</p></div>
    <div className="grid grid-cols-2 gap-2"><Fact label="Último atendimento" value={profile.lastAttendance ? formatDate(profile.lastAttendance) : 'Sem registro'} /><Fact label="Dias sem presença" value={profile.recencyDays == null ? '—' : String(profile.recencyDays)} /><Fact label="Faturamento" value={currency.format(profile.lifetimeSales)} /><Fact label="Ticket médio" value={currency.format(profile.ticketAverage)} /><Fact label="Visitas" value={String(profile.visitCount)} /><Fact label="Procedimentos" value={String(profile.procedureCount)} /></div>
    <section className="border-t border-slate-800/80 pt-4"><h3 className="text-sm font-semibold text-white">Histórico confirmado</h3><List label="Procedimentos realizados" values={profile.completedProcedures} empty="Sem procedimentos confirmados." /><List label="Procedimentos comprados classificados" values={profile.purchasedProcedures} empty="Sem itens classificados." />{profile.pendingSaleItems ? <div className="mt-3 flex items-start gap-2 rounded-lg border border-amber-300/20 bg-amber-500/10 p-2 text-xs text-amber-100"><AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />{profile.pendingSaleItems} item(ns) de venda seguem sem classificação e não entram em sugestão de procedimento.</div> : null}</section>
    <section className="border-t border-slate-800/80 pt-4"><h3 className="text-sm font-semibold text-white">Cadência clínica</h3>{detail.clinicalCadences.length ? <div className="mt-2 space-y-2">{detail.clinicalCadences.map((cadence) => <div key={`${cadence.procedureId}:${cadence.unitSlug}`} className="text-xs text-slate-300"><span className="font-medium text-slate-100">{cadence.procedureName}</span> · {cadence.status === 'approved' ? `regra aprovada: ${cadence.cadenceDays} dias` : 'sem regra aprovada'}</div>)}</div> : <p className="mt-2 text-xs text-slate-500">Nenhuma cadência aprovada. A plataforma não fará recomendação clínica.</p>}</section>
    <ActionForm detail={detail} units={units} professionals={professionals} onSaved={onRefresh} />
    <ActionHistory actions={detail.actions} onUpdated={onRefresh} />
  </aside>
}

function Fact({ label, value }: { label: string; value: string }) { return <div className="rounded-xl border border-slate-800/80 bg-slate-900/45 p-2.5"><div className="text-[11px] text-slate-500">{label}</div><div className="mt-1 truncate text-sm font-medium text-slate-100">{value}</div></div> }
function List({ label, values, empty }: { label: string; values: string[]; empty: string }) { return <div className="mt-3"><div className="text-xs text-slate-500">{label}</div><div className="mt-1 text-sm text-slate-200">{values.length ? values.join(', ') : empty}</div></div> }

const reviewTypeLabel: Record<ClientIdentityReviewItem['type'], string> = { attendance_name_merge: 'Grafia no Atendimento', attendance_caixa: 'Atendimento ↔ Caixa', app_attendance: 'Cadastro app ↔ Atendimento', app_caixa: 'Cadastro app ↔ Caixa', lead_app: 'Planilha ↔ Cadastro app', lead_caixa: 'Planilha ↔ Caixa' }
function reviewValue(value: unknown) { return Array.isArray(value) ? value.filter(Boolean).join(', ') : typeof value === 'string' || typeof value === 'number' ? String(value) : '' }

function IdentityReviewQueue() {
  const [items, setItems] = useState<ClientIdentityReviewItem[]>([])
  const [total, setTotal] = useState(0)
  const [type, setType] = useState('')
  const [search, setSearch] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const load = useCallback(async (offset = 0, append = false) => {
    try { setBusy(true); setError(''); const result = await fetchClientIdentityReviewQueue({ type: type as ClientIdentityReviewItem['type'] || undefined, q: search, limit: 100, offset }); if (!result.ok) throw new Error(result.error || 'Não foi possível carregar a revisão.'); setItems((current) => append ? [...current, ...result.items] : result.items); setTotal(result.total) } catch (cause) { setError(cause instanceof Error ? cause.message : 'Não foi possível carregar a revisão.') } finally { setBusy(false) }
  }, [search, type])
  useEffect(() => { void load() }, [load])
  return <section className="rounded-2xl border border-slate-800/80 bg-slate-950/55 p-5 shadow-[0_20px_60px_rgba(2,6,23,0.28)]">
    <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between"><div><h2 className="text-lg font-semibold text-white">Revisão de correspondências</h2><p className="mt-1 text-sm text-slate-500">{items.length} de {total} sugestão(ões) pendente(s), com evidências de cada fonte. Nenhuma unificação é disparada por esta tela.</p></div><Button size="sm" variant="outline" onClick={() => void load()} disabled={busy}><RefreshCw className={`mr-2 h-4 w-4 ${busy ? 'animate-spin' : ''}`} />Atualizar</Button></div>
    <div className="mt-4 flex flex-wrap gap-2"><select aria-label="Origem da correspondência" value={type} onChange={(event) => setType(event.target.value)} className="rounded-lg border border-slate-800 bg-slate-900 px-3 py-2 text-sm text-slate-100"><option value="">Todas as origens</option>{Object.entries(reviewTypeLabel).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select><input aria-label="Buscar correspondência" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Buscar nome, telefone ou evidência" className="min-w-64 flex-1 rounded-lg border border-slate-800 bg-slate-900 px-3 py-2 text-sm text-slate-100 placeholder:text-slate-500" /><Button size="sm" onClick={() => void load()} disabled={busy}>Aplicar</Button></div>
    {error ? <div className="mt-3 rounded-lg border border-rose-300/30 bg-rose-500/10 p-3 text-sm text-rose-100">{error}</div> : null}
    <div className="mt-4 space-y-3">{items.map((item) => <article key={`${item.type}:${item.id}`} className="rounded-xl border border-slate-800/80 bg-slate-900/35 p-4"><div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between"><div><div className="text-xs text-sky-300">{reviewTypeLabel[item.type]}</div><div className="mt-1 text-sm font-semibold text-white">{item.primaryName} <span className="mx-1 text-slate-600">↔</span> {item.secondaryName}</div></div><div className="text-xs text-slate-400">{item.status === 'ambiguous' ? 'Ambíguo' : 'Sugestão'} · confiança {Math.round(item.confidence * 100)}%</div></div><div className="mt-3 grid gap-2 text-xs text-slate-400 md:grid-cols-2"><div><span className="text-slate-500">Contexto: </span>{Object.entries(item.context).map(([key, value]) => { const shown = reviewValue(value); return shown ? <span key={key} className="mr-3 inline-block">{key}: <span className="text-slate-200">{shown}</span></span> : null })}</div><div><span className="text-slate-500">Evidência: </span>{Object.entries(item.evidence).map(([key, value]) => { const shown = reviewValue(value); return shown ? <span key={key} className="mr-3 inline-block">{key}: <span className="text-slate-200">{shown}</span></span> : null })}</div></div></article>)}{!busy && !items.length ? <p className="py-6 text-center text-sm text-slate-500">Nenhuma sugestão encontrada para estes filtros.</p> : null}</div>
    {items.length < total ? <div className="mt-4 text-center"><Button size="sm" variant="outline" onClick={() => void load(items.length, true)} disabled={busy}>Carregar mais 100</Button></div> : null}
  </section>
}

export function ClientCommercialModule() {
  const [overview, setOverview] = useState<CommercialOverview | null>(null)
  const [detail, setDetail] = useState<CommercialProfileDetail | null>(null)
  const [units, setUnits] = useState<Array<{ slug: string; name: string }>>([])
  const [professionals, setProfessionals] = useState<Array<{ name: string }>>([])
  const [unit, setUnit] = useState('all')
  const [segment, setSegment] = useState('')
  const [priority, setPriority] = useState('')
  const [search, setSearch] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [cooldown, setCooldown] = useState(30)
  const [thresholds, setThresholds] = useState('90,180,365')
  const [cadenceProcedure, setCadenceProcedure] = useState('')
  const [cadenceDays, setCadenceDays] = useState('')
  const [cadenceStatus, setCadenceStatus] = useState<'draft' | 'approved' | 'disabled'>('draft')
  const [cadenceNotice, setCadenceNotice] = useState('')
  const [procedureOptions, setProcedureOptions] = useState<Array<{ id: string; name: string }>>([])

  const load = useCallback(async (next?: { selectIdentityId?: string }) => {
    try {
      setBusy(true); setError('')
      const [commercial, references] = await Promise.all([fetchCommercialOverview({ unit, segment, priority, q: search, limit: 100 }), fetchAtendimentoReferences()])
      if (!commercial.ok) throw new Error(commercial.error || 'Não foi possível carregar a inteligência comercial.')
      if (!references.ok) throw new Error(references.error || 'Não foi possível carregar referências do CRM.')
      setOverview(commercial); setUnits(references.units); setProfessionals(references.professionals.map((person) => ({ name: person.name }))); setProcedureOptions(references.procedures.map((procedure) => ({ id: procedure.id, name: procedure.name })))
      setCooldown(commercial.policy.activeContactCooldownDays); setThresholds(commercial.policy.returnRiskThresholds.join(','))
      const selectedId = next?.selectIdentityId || detail?.profile.identityId
      const candidate = commercial.profiles.find((profile) => profile.identityId === selectedId) || commercial.profiles[0]
      if (candidate) await loadDetail(candidate.identityId, commercial.asOf)
      else setDetail(null)
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Não foi possível carregar a inteligência comercial.') } finally { setBusy(false) }
  // Filters are deliberately applied only with the button, so typing does not trigger a request per keystroke.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [unit, segment, priority, search, detail?.profile.identityId])

  const loadDetail = useCallback(async (identityId: string, asOf?: string) => {
    const result = await fetchCommercialProfile(identityId, { asOf, unit })
    if (!result.ok) throw new Error(result.error || 'Não foi possível carregar o perfil do cliente.')
    setDetail(result)
  }, [unit])

  // Initial load intentionally runs once; changing filters is explicit through “Aplicar”.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { void load() }, [])

  const refreshDetail = useCallback(async () => {
    if (!detail) return
    await loadDetail(detail.profile.identityId, overview?.asOf)
    await load({ selectIdentityId: detail.profile.identityId })
  }, [detail, load, loadDetail, overview?.asOf])

  const savePolicy = async () => {
    try {
      setBusy(true); setError('')
      const values = thresholds.split(',').map((value) => Number(value.trim())).filter(Boolean)
      const result = await updateCommercialPolicy({ activeContactCooldownDays: Number(cooldown), returnRiskThresholds: values })
      if (!result.ok) throw new Error(result.error || 'Não foi possível salvar a política.')
      await load()
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Não foi possível salvar a política.') } finally { setBusy(false) }
  }

  const saveCadence = async () => {
    try {
      setBusy(true); setCadenceNotice('')
      const result = await upsertCommercialCadence({ procedureId: cadenceProcedure, cadenceDays: Number(cadenceDays), status: cadenceStatus })
      if (!result.ok) throw new Error(result.error || 'Não foi possível salvar a cadência.')
      setCadenceNotice('Cadência salva. Ela só será usada em contexto clínico quando aprovada.')
      setCadenceDays('')
      await load()
    } catch (cause) { setCadenceNotice(cause instanceof Error ? cause.message : 'Não foi possível salvar a cadência.') } finally { setBusy(false) }
  }

  const segmentOptions = useMemo(() => [{ key: '', label: 'Todos os segmentos' }, { key: 'return_at_risk', label: 'Retorno em risco' }, { key: 'high_value_inactive', label: 'Alto valor inativo' }, { key: 'frequent', label: 'Assíduos' }, { key: 'balanced_vip', label: 'VIP equilibrado' }, { key: 'first_return', label: 'Primeiro retorno' }, { key: 'reactivation_potential', label: 'Potencial de reativação' }], [])

  return <section className="space-y-6 text-white">
    <header className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between"><div><h1 className="text-2xl font-bold tracking-tight">Clientes</h1><p className="mt-1 text-sm text-slate-400">Prioridades comerciais baseadas em presença registrada, vendas e procedimentos confirmados.</p></div><div className="flex flex-wrap gap-2"><Button variant="outline" onClick={() => void load()} disabled={busy}><RefreshCw className={`mr-2 h-4 w-4 ${busy ? 'animate-spin' : ''}`} />Atualizar</Button><Button variant="outline" onClick={() => setSettingsOpen((value) => !value)}><ShieldCheck className="mr-2 h-4 w-4" />Políticas clínicas</Button></div></header>
    {error ? <div className="rounded-xl border border-rose-300/30 bg-rose-500/10 p-4 text-sm text-rose-100">{error}</div> : null}
    {overview ? <div className="rounded-xl border border-amber-300/25 bg-amber-500/10 p-4 text-sm text-amber-100"><div className="flex gap-2"><AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" /><div><b>Uso comercial seguro:</b> a recência considera apenas o último atendimento realizado. Compras antecipadas não representam procedimento realizado. {overview.dataQuality.futureAttendancesExcluded ? `${overview.dataQuality.futureAttendancesExcluded} atendimento(s) futuro(s) foram excluídos desta métrica.` : ''}</div></div></div> : null}
    {settingsOpen ? <section className="grid gap-4 rounded-2xl border border-slate-800/80 bg-slate-950/55 p-5 xl:grid-cols-2"><div><h2 className="font-semibold text-white">Política de reativação</h2><p className="mt-1 text-sm text-slate-500">Define o intervalo entre contatos assistidos e as faixas de ausência, sem alterar o histórico clínico.</p><div className="mt-4 grid gap-2 sm:grid-cols-2"><label className="text-xs text-slate-400">Intervalo mínimo de contato (dias)<input type="number" value={cooldown} onChange={(event) => setCooldown(Number(event.target.value))} className="mt-1 w-full rounded-lg border border-slate-800 bg-slate-900 px-3 py-2 text-sm text-white" /></label><label className="text-xs text-slate-400">Faixas de ausência<input value={thresholds} onChange={(event) => setThresholds(event.target.value)} className="mt-1 w-full rounded-lg border border-slate-800 bg-slate-900 px-3 py-2 text-sm text-white" /></label></div><Button size="sm" onClick={() => void savePolicy()} disabled={busy} className="mt-3"><Save className="mr-2 h-4 w-4" />Salvar política</Button></div><div className="border-t border-slate-800 pt-4 xl:border-l xl:border-t-0 xl:pl-4 xl:pt-0"><h2 className="font-semibold text-white">Cadência clínica</h2><p className="mt-1 text-sm text-slate-500">Somente uma regra aprovada poderá ser exibida como referência; ela não cria mensagens automáticas.</p><div className="mt-4 grid gap-2 sm:grid-cols-3"><select value={cadenceProcedure} onChange={(event) => setCadenceProcedure(event.target.value)} className="rounded-lg border border-slate-800 bg-slate-900 px-3 py-2 text-sm text-white"><option value="">Procedimento</option>{procedureOptions.map((procedure) => <option key={procedure.id} value={procedure.id}>{procedure.name}</option>)}</select><input type="number" min="1" placeholder="Dias" value={cadenceDays} onChange={(event) => setCadenceDays(event.target.value)} className="rounded-lg border border-slate-800 bg-slate-900 px-3 py-2 text-sm text-white" /><select value={cadenceStatus} onChange={(event) => setCadenceStatus(event.target.value as typeof cadenceStatus)} className="rounded-lg border border-slate-800 bg-slate-900 px-3 py-2 text-sm text-white"><option value="draft">Rascunho</option><option value="approved">Aprovada</option><option value="disabled">Desativada</option></select></div><Button size="sm" variant="outline" onClick={() => void saveCadence()} disabled={busy || !cadenceProcedure || !cadenceDays} className="mt-3"><Save className="mr-2 h-4 w-4" />Salvar cadência</Button>{cadenceNotice ? <div className="mt-2 text-xs text-slate-400">{cadenceNotice}</div> : null}</div></section> : null}
    <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4"><Metric label="Retorno em risco" value={overview?.summary.returnAtRisk ?? '—'} detail="Sem presença registrada na faixa configurada" icon={CalendarClock} /><Metric label="Alto valor inativo" value={overview?.summary.highValueInactive ?? '—'} detail="Valor e ausência combinados" icon={CircleDollarSign} /><Metric label="Potencial de reativação" value={overview?.summary.reactivationPotential ?? '—'} detail="Prioridade para a equipe" icon={UserRoundCheck} /><Metric label="Ticket médio" value={overview ? currency.format(overview.summary.averageTicket) : '—'} detail="Por cliente com compra registrada" icon={UsersRound} /></div>
    <div className="flex flex-wrap gap-2 rounded-xl border border-slate-800/80 bg-slate-950/45 p-3"><select aria-label="Unidade" value={unit} onChange={(event) => setUnit(event.target.value)} className="rounded-lg border border-slate-800 bg-slate-900 px-3 py-2 text-sm text-slate-100"><option value="all">Todas as unidades</option>{units.map((item) => <option key={item.slug} value={item.slug}>{item.name}</option>)}</select><select aria-label="Segmento" value={segment} onChange={(event) => setSegment(event.target.value)} className="rounded-lg border border-slate-800 bg-slate-900 px-3 py-2 text-sm text-slate-100">{segmentOptions.map((item) => <option key={item.key} value={item.key}>{item.label}</option>)}</select><select aria-label="Prioridade" value={priority} onChange={(event) => setPriority(event.target.value)} className="rounded-lg border border-slate-800 bg-slate-900 px-3 py-2 text-sm text-slate-100"><option value="">Todas as prioridades</option><option value="high">Alta</option><option value="medium">Média</option><option value="normal">Normal</option></select><input aria-label="Buscar cliente" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Buscar cliente" className="min-w-48 flex-1 rounded-lg border border-slate-800 bg-slate-900 px-3 py-2 text-sm text-slate-100 placeholder:text-slate-500" /><Button size="sm" onClick={() => void load()} disabled={busy}>Aplicar</Button></div>
    <div className="grid gap-5 2xl:grid-cols-[minmax(0,1.7fr)_minmax(22rem,0.8fr)]">
      <section className="overflow-hidden rounded-2xl border border-slate-800/80 bg-slate-950/55 shadow-[0_20px_60px_rgba(2,6,23,0.28)]">
        <div className="flex items-center justify-between border-b border-slate-800/80 p-5"><div><h2 className="font-semibold text-white">Prioridades de reativação</h2><p className="mt-1 text-xs text-slate-500">{overview ? `${overview.total} clientes elegíveis na seleção atual` : 'Carregando clientes…'}</p></div><div className="text-xs text-slate-500">Ações assistidas: {overview?.actions.actions ?? 0}</div></div>
        <div className="overflow-x-auto"><table className="w-full min-w-190 text-sm"><thead className="bg-white/[0.025] text-left text-xs font-medium text-slate-400"><tr><th className="p-3">Cliente</th><th className="p-3">Último atendimento</th><th className="p-3 text-right">Faturamento</th><th className="p-3">Frequência</th><th className="p-3">Próxima ação</th><th className="p-3">Prioridade</th><th className="p-3" /></tr></thead><tbody>{overview?.profiles.map((profile) => <tr key={profile.identityId} onClick={() => void loadDetail(profile.identityId, overview.asOf)} className={`cursor-pointer border-t border-slate-800/70 transition hover:bg-sky-500/[0.05] ${detail?.profile.identityId === profile.identityId ? 'bg-sky-500/[0.08]' : ''}`}><td className="p-3"><div className="font-medium text-slate-100">{profile.name}</div><div className="mt-0.5 text-xs text-slate-500">{profile.phone || profile.identityQuality.replace(/_/g, ' ')}</div></td><td className="p-3"><div className="text-slate-200">{formatDate(profile.lastAttendance)}</div><div className={`mt-0.5 text-xs ${profile.recencyDays != null && profile.recencyDays >= 180 ? 'text-rose-300' : 'text-slate-500'}`}>{profile.recencyDays == null ? 'Sem presença confirmada' : `${profile.recencyDays} dias`}</div></td><td className="p-3 text-right"><div className="font-medium text-slate-100">{currency.format(profile.lifetimeSales)}</div><div className="mt-0.5 text-xs text-slate-500">{profile.saleCount} compra(s)</div></td><td className="p-3"><div className="text-slate-200">{profile.visitCount} visita(s)</div><div className="mt-0.5 text-xs text-slate-500">{profile.procedureCount} procedimento(s)</div></td><td className="max-w-56 p-3 text-slate-300">{profile.recommendedAction}</td><td className="p-3"><SegmentBadge profile={profile} /></td><td className="p-3 text-right"><ChevronRight className="inline h-4 w-4 text-slate-500" /></td></tr>)}</tbody></table>{overview && !overview.profiles.length ? <div className="p-8 text-center text-sm text-slate-500">Nenhum cliente encontrado para os filtros selecionados.</div> : null}</div>
      </section>
      <ProfilePanel detail={detail} units={units} professionals={professionals} onRefresh={refreshDetail} />
    </div>
    <IdentityReviewQueue />
    <footer className="flex items-center gap-2 text-xs text-slate-500"><CheckCircle2 className="h-4 w-4 text-emerald-400" />Recência = último procedimento realizado. Vendas e procedimentos continuam separados no perfil comercial.</footer>
  </section>
}
