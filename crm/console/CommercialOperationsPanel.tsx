import { useCallback, useEffect, useMemo, useState } from 'react'
import { AlertTriangle, CalendarDays, CheckCircle2, ChevronLeft, ChevronRight, RefreshCw, Scale, UsersRound } from 'lucide-react'
import { Button } from '@/button'
import {
  createCommercialCampaign,
  fetchCommercialCampaigns,
  fetchCommercialOperations,
  previewCommercialCampaign,
  reassignCommercialAction,
  rebalanceCommercialWallet,
  updateCommercialAction,
  upsertCommercialOwnerAbsence,
  type CommercialCampaign,
  type CommercialCampaignPreview,
  type CommercialAction,
  type CommercialOperationAction,
  type CommercialOperations,
} from '@/atendimentoApi'

type Props = {
  units: Array<{ slug: string; name: string }>
  professionals: Array<{ name: string }>
  onOpenIdentity: (identityId: string) => void
}

const outcomeOptions = [
  ['no_response', 'Não respondeu'], ['wrong_number', 'Número incorreto'], ['requested_follow_up', 'Pediu contato posterior'],
  ['not_interested', 'Sem interesse'], ['completed_elsewhere', 'Realizou em outro local'], ['scheduled', 'Agendou'],
  ['attended', 'Compareceu'], ['cancelled', 'Cancelou'], ['sale', 'Venda'], ['clinical_return', 'Retorno'], ['opt_out_requested', 'Opt-out solicitado'],
] as const

function token() {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `crm-${Date.now()}-${Math.random().toString(16).slice(2)}`
}

function flagLabel(flag: string) {
  return ({ assigned_to_me: 'Minha carteira', due_today: 'Vence hoje', overdue: 'Atrasada', awaiting_response: 'Aguardando resposta', scheduled: 'Agendada', no_return: 'Sem retorno', permission_expiring: 'Permissão expirando', ineligible: 'Inelegível', source_stale: 'Fonte stale', identity_review: 'Identidade em revisão' } as Record<string, string>)[flag] || flag
}

function ActionRow({ action, professionals, onOpenIdentity, onReload }: { action: CommercialOperationAction; professionals: Array<{ name: string }>; onOpenIdentity: (id: string) => void; onReload: () => Promise<void> }) {
  const [owner, setOwner] = useState(action.owner || '')
  const [outcome, setOutcome] = useState<CommercialAction['outcomeCode'] | ''>(action.outcomeCode || '')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const save = async (status = action.status) => {
    try {
      setBusy(true); setError('')
      const result = await updateCommercialAction(action.id, { status, owner: owner || undefined, outcomeCode: outcome || undefined, expectedRevision: action.revision, idempotencyKey: token(), reason: 'Atualização operacional assistida' })
      if (!result.ok) throw new Error(result.error || 'Não foi possível atualizar a ação.')
      await onReload()
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Não foi possível atualizar a ação.') } finally { setBusy(false) }
  }
  const reassign = async () => {
    if (!owner || owner === action.owner) return
    try {
      setBusy(true); setError('')
      const result = await reassignCommercialAction(action.id, { owner, expectedRevision: action.revision, idempotencyKey: token(), reason: 'Reatribuição operacional assistida' })
      if (!result.ok) throw new Error(result.error || 'Não foi possível reatribuir a ação.')
      await onReload()
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Não foi possível reatribuir a ação.') } finally { setBusy(false) }
  }
  return <article className="rounded-xl border border-slate-800/80 bg-slate-900/35 p-4" data-testid={`commercial-action-${action.id}`}>
    <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
      <button type="button" className="text-left" onClick={() => onOpenIdentity(action.identityId)} aria-label={`Abrir perfil de ${action.clientName || 'cliente'}`}><div className="font-medium text-slate-100">{action.clientName || 'Cliente sem nome'}</div><div className="mt-1 text-xs text-slate-400">{action.unitName || action.unitSlug || 'Unidade não informada'} · {action.status}</div></button>
      <div className="text-xs text-slate-500">{action.dueDate || 'Sem prazo'}</div>
    </div>
    <div className="mt-2 flex flex-wrap gap-1">{action.queueFlags.map((flag) => <span key={flag} className={`rounded-full border px-2 py-0.5 text-[11px] ${flag === 'overdue' || flag === 'ineligible' ? 'border-rose-300/30 bg-rose-500/10 text-rose-100' : 'border-amber-300/25 bg-amber-500/10 text-amber-100'}`}>{flagLabel(flag)}</span>)}</div>
    <div className="mt-3 grid gap-2 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto]">
      <select aria-label="Responsável da ação" value={owner} onChange={(event) => setOwner(event.target.value)} disabled={busy} className="rounded-lg border border-slate-800 bg-slate-950 px-2 py-2 text-xs text-slate-200"><option value="">Sem responsável</option>{professionals.map((person) => <option key={person.name} value={person.name}>{person.name}</option>)}</select>
      <select aria-label="Outcome estruturado" value={outcome || ''} onChange={(event) => setOutcome(event.target.value as CommercialAction['outcomeCode'] | '')} disabled={busy} className="rounded-lg border border-slate-800 bg-slate-950 px-2 py-2 text-xs text-slate-200"><option value="">Outcome pendente</option>{outcomeOptions.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select>
      <div className="flex gap-2"><Button size="sm" onClick={() => void save()} disabled={busy}>Salvar</Button>{owner !== action.owner ? <Button size="sm" variant="outline" onClick={() => void reassign()} disabled={busy}>Reatribuir</Button> : null}</div>
    </div>
    {['open', 'contacted', 'responded', 'scheduled'].includes(action.status) ? <select aria-label="Status da ação" value={action.status} onChange={(event) => void save(event.target.value as CommercialOperationAction['status'])} disabled={busy} className="mt-2 rounded-lg border border-slate-800 bg-slate-950 px-2 py-2 text-xs text-slate-200"><option value="open">Aberta</option><option value="contacted">Contatado (registro assistido)</option><option value="responded">Respondeu</option><option value="scheduled">Agendado</option><option value="won_sale">Venda registrada</option><option value="returned">Retorno clínico</option><option value="closed">Encerrada</option><option value="cancelled">Cancelada</option></select> : null}
    {error ? <p className="mt-2 text-xs text-rose-200">{error}</p> : null}
  </article>
}

export function CommercialOperationsPanel({ units, professionals, onOpenIdentity }: Props) {
  const [operations, setOperations] = useState<CommercialOperations | null>(null)
  const [campaigns, setCampaigns] = useState<CommercialCampaign[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [filter, setFilter] = useState('')
  const [unit, setUnit] = useState(units.length === 1 ? units[0].slug : 'all')
  const [pageOffset, setPageOffset] = useState(0)
  const pageSize = 25
  const [campaignDraft, setCampaignDraft] = useState({ name: '', segmentKey: 'manual_follow_up', segmentVersion: 'v1', owner: professionals[0]?.name || '', offerId: '', cutoffAt: new Date().toISOString(), assignmentWindowStart: new Date().toISOString(), assignmentWindowEnd: new Date(Date.now() + 7 * 86400000).toISOString(), controlGroupPercent: '0', reason: '' })
  const [preview, setPreview] = useState<CommercialCampaignPreview | null>(null)
  const [absence, setAbsence] = useState({ owner: '', absenceType: 'vacation' as 'vacation' | 'absence' | 'leave', startsAt: '', endsAt: '', substituteOwner: '', reason: '' })
  const [capacities, setCapacities] = useState<Record<string, number>>({})
  const [balance, setBalance] = useState<Array<{ actionId: string; fromOwner: string | null; toOwner: string }>>([])

  const load = useCallback(async (nextOffset = 0) => {
    try {
      setBusy(true); setError('')
      const [operationsResult, campaignsResult] = await Promise.all([fetchCommercialOperations({ unit, q: filter, limit: pageSize, offset: nextOffset }), fetchCommercialCampaigns({ unit })])
      if (!operationsResult.ok) throw new Error(operationsResult.error || 'Operações indisponíveis.')
      if (!campaignsResult.ok) throw new Error(campaignsResult.error || 'Campanhas indisponíveis.')
      setOperations(operationsResult); setCampaigns(campaignsResult.campaigns); setPageOffset(nextOffset)
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Operações indisponíveis.') } finally { setBusy(false) }
  }, [filter, pageSize, unit])
  useEffect(() => { void load() }, [load])

  const selectedIds = useMemo(() => {
    const blockedFlags = new Set(['ineligible', 'source_stale', 'identity_review'])
    return Array.from(new Set(
      operations?.wallet.actions
        .filter((action) => action.identityId && action.queueFlags.every((flag) => !blockedFlags.has(flag)))
        .map((action) => action.identityId)
        .filter(Boolean),
    )).slice(0, 500)
  }, [operations])
  const previewCampaign = async () => {
    try {
      setBusy(true); setError('')
      const result = await previewCommercialCampaign({ ...campaignDraft, unit: unit === 'all' ? units[0]?.slug : unit, identityIds: selectedIds, filters: { source: 'minha_carteira' }, controlGroupPercent: Number(campaignDraft.controlGroupPercent) })
      if (!result.ok) throw new Error(result.error || 'Não foi possível simular a coorte.')
      setPreview(result)
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Não foi possível simular a coorte.') } finally { setBusy(false) }
  }
  const createCampaign = async () => {
    if (!preview) return
    try {
      setBusy(true); setError('')
      const result = await createCommercialCampaign({ ...campaignDraft, unit: unit === 'all' ? units[0]?.slug : unit, identityIds: selectedIds, filters: { source: 'minha_carteira' }, controlGroupPercent: Number(campaignDraft.controlGroupPercent), idempotencyKey: token() })
      if (!result.ok) throw new Error(result.error || 'Não foi possível criar a campanha.')
      setNotice('Campanha congelada como rascunho. Nenhuma mensagem foi enviada.')
      setPreview(null); await load()
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Não foi possível criar a campanha.') } finally { setBusy(false) }
  }
  const saveAbsence = async () => {
    try {
      setBusy(true); setError('')
      const result = await upsertCommercialOwnerAbsence({ ...absence, unit: unit === 'all' ? units[0]?.slug || '' : unit, reason: absence.reason, idempotencyKey: token() })
      if (!result.ok) throw new Error(result.error || 'Não foi possível registrar a ausência.')
      setNotice('Ausência registrada; a carteira pode ser rebalanceada sem contato automático.')
      setAbsence((current) => ({ ...current, startsAt: '', endsAt: '', reason: '' })); await load()
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Não foi possível registrar a ausência.') } finally { setBusy(false) }
  }
  const simulateBalance = async (apply = false) => {
    try {
      setBusy(true); setError('')
      const result = await rebalanceCommercialWallet({ unit: unit === 'all' ? undefined : unit, capacities, apply, reason: apply ? 'Balanceamento operacional confirmado' : undefined, idempotencyKey: apply ? token() : undefined })
      if (!result.ok) throw new Error(result.error || 'Não foi possível calcular o balanceamento.')
      setBalance(result.moves); setNotice(apply ? 'Balanceamento aplicado com auditoria. Nenhuma mensagem foi enviada.' : 'Simulação pronta; nada foi alterado.')
      if (apply) await load()
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Não foi possível calcular o balanceamento.') } finally { setBusy(false) }
  }

  if (error && !operations) return <section role="alert" className="rounded-2xl border border-rose-300/30 bg-rose-500/10 p-5 text-sm text-rose-100">{error}<Button className="ml-3" size="sm" variant="outline" onClick={() => void load()}>Tentar novamente</Button></section>
  return <section aria-labelledby="commercial-operations-heading" className="space-y-4 rounded-2xl border border-slate-800/80 bg-slate-950/55 p-5 shadow-[0_20px_60px_rgba(2,6,23,0.28)]" data-testid="commercial-operations-panel">
    <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between"><div><h2 id="commercial-operations-heading" className="text-lg font-semibold text-white">Operação comercial assistida</h2><p className="mt-1 text-sm text-slate-500">Fila, equipe e coortes versionadas. O runtime permanece sem envio automático e sem escrita de contato.</p></div><Button size="sm" variant="outline" onClick={() => void load()} disabled={busy}><RefreshCw className={`mr-2 h-4 w-4 ${busy ? 'animate-spin' : ''}`} />Atualizar</Button></div>
    {error ? <div role="alert" className="rounded-lg border border-rose-300/30 bg-rose-500/10 p-3 text-sm text-rose-100">{error}</div> : null}{notice ? <div role="status" className="rounded-lg border border-emerald-300/25 bg-emerald-500/10 p-3 text-sm text-emerald-100">{notice}</div> : null}
    <div className="grid gap-2 sm:grid-cols-[auto_minmax(0,1fr)_auto]"><label className="sr-only" htmlFor="commercial-operation-unit">Unidade</label><select id="commercial-operation-unit" value={unit} onChange={(event) => setUnit(event.target.value)} className="rounded-lg border border-slate-800 bg-slate-900 px-3 py-2 text-sm text-slate-100"><option value="all">Todas as unidades</option>{units.map((item) => <option key={item.slug} value={item.slug}>{item.name}</option>)}</select><input aria-label="Buscar ação por cliente" value={filter} onChange={(event) => setFilter(event.target.value)} placeholder="Buscar por cliente (sem telefone/e-mail)" className="rounded-lg border border-slate-800 bg-slate-900 px-3 py-2 text-sm text-slate-100 placeholder:text-slate-500" /><span className="self-center text-xs text-slate-500">{operations?.wallet.total ?? '—'} ações na página</span></div>
    <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">{operations ? <><div className="rounded-xl border border-slate-800 p-3"><div className="text-xs text-slate-500">Minha carteira</div><div className="mt-1 text-2xl font-semibold text-white">{operations.wallet.countsByFlag.assigned_to_me || 0}</div><div className="text-xs text-slate-400">atribuídas a mim</div></div><div className="rounded-xl border border-slate-800 p-3"><div className="text-xs text-slate-500">SLA</div><div className="mt-1 text-2xl font-semibold text-white">{operations.team.totals.overdue}</div><div className="text-xs text-slate-400">atrasadas</div></div><div className="rounded-xl border border-slate-800 p-3"><div className="text-xs text-slate-500">Conclusão</div><div className="mt-1 text-2xl font-semibold text-white">{operations.team.totals.completionRate}%</div><div className="text-xs text-slate-400">taxa de conclusão</div></div><div className="rounded-xl border border-slate-800 p-3"><div className="text-xs text-slate-500">Controles</div><div className="mt-1 flex items-center gap-2 text-sm text-emerald-200"><CheckCircle2 className="h-4 w-4" />Sem mensagens</div><div className="text-xs text-slate-400">sem escrita comercial</div></div></> : <div className="col-span-full p-6 text-center text-sm text-slate-500">Carregando operação…</div>}</div>
    <div className="grid gap-4 xl:grid-cols-[minmax(0,1.2fr)_minmax(20rem,0.8fr)]"><section aria-labelledby="commercial-wallet-heading"><div className="mb-2 flex items-center gap-2"><UsersRound className="h-4 w-4 text-sky-300" /><h3 id="commercial-wallet-heading" className="font-semibold text-white">Minha carteira e fila da equipe</h3></div><div className="space-y-2">{operations?.wallet.actions.map((action) => <ActionRow key={action.id} action={action} professionals={professionals} onOpenIdentity={onOpenIdentity} onReload={() => load(pageOffset)} />)}{operations && !operations.wallet.actions.length ? <p className="rounded-lg border border-dashed border-slate-800 p-6 text-center text-sm text-slate-500">Nenhuma ação encontrada para os filtros atuais.</p> : null}</div>{operations ? <div className="mt-3 flex items-center justify-between gap-3 border-t border-slate-800/80 pt-3 text-xs text-slate-500"><span>{operations.wallet.total ? `${pageOffset + 1}–${Math.min(pageOffset + operations.wallet.actions.length, operations.wallet.total)} de ${operations.wallet.total}` : '0 ações'}</span><div className="flex gap-2"><Button size="sm" variant="outline" aria-label="Página anterior da fila" disabled={busy || !operations.wallet.pagination.hasPrevious} onClick={() => void load(Math.max(0, pageOffset - pageSize))}><ChevronLeft className="h-4 w-4" />Anterior</Button><Button size="sm" variant="outline" aria-label="Próxima página da fila" disabled={busy || !operations.wallet.pagination.hasNext} onClick={() => void load(pageOffset + pageSize)}>Próxima<ChevronRight className="h-4 w-4" /></Button></div></div> : null}</section><aside className="space-y-4"><section className="rounded-xl border border-slate-800 p-4"><div className="flex items-center gap-2"><Scale className="h-4 w-4 text-sky-300" /><h3 className="font-semibold text-white">Gestão da equipe</h3></div><div className="mt-3 space-y-2 text-xs text-slate-400">{operations?.team.byOwner.map((owner) => <div key={owner.owner} className="flex items-center justify-between border-b border-slate-800/70 pb-2"><span>{owner.owner}</span><span>{owner.active} ativas · {owner.overdue} atrasadas · {owner.completed} concluídas</span></div>)}</div><div className="mt-3 grid gap-2">{professionals.map((person) => <label key={person.name} className="text-xs text-slate-400">Capacidade {person.name}<input type="number" min="0" value={capacities[person.name] ?? ''} onChange={(event) => setCapacities((current) => ({ ...current, [person.name]: Number(event.target.value) || 0 }))} className="mt-1 w-full rounded-lg border border-slate-800 bg-slate-950 px-2 py-1.5 text-sm text-slate-100" /></label>)}</div><div className="mt-3 flex flex-wrap gap-2"><Button size="sm" variant="outline" onClick={() => void simulateBalance(false)} disabled={busy}>Simular balanceamento</Button><Button size="sm" onClick={() => void simulateBalance(true)} disabled={busy || !balance.length}>Aplicar balanceamento</Button></div>{balance.length ? <p className="mt-2 text-xs text-amber-200">{balance.length} reatribuição(ões) planejada(s).</p> : null}</section><section className="rounded-xl border border-slate-800 p-4"><div className="flex items-center gap-2"><CalendarDays className="h-4 w-4 text-sky-300" /><h3 className="font-semibold text-white">Ausência ou férias</h3></div><div className="mt-3 grid gap-2"><select aria-label="Responsável ausente" value={absence.owner} onChange={(event) => setAbsence((current) => ({ ...current, owner: event.target.value }))} className="rounded-lg border border-slate-800 bg-slate-950 px-2 py-2 text-xs text-slate-100"><option value="">Responsável</option>{professionals.map((person) => <option key={person.name} value={person.name}>{person.name}</option>)}</select><select aria-label="Tipo de ausência" value={absence.absenceType} onChange={(event) => setAbsence((current) => ({ ...current, absenceType: event.target.value as typeof absence.absenceType }))} className="rounded-lg border border-slate-800 bg-slate-950 px-2 py-2 text-xs text-slate-100"><option value="vacation">Férias</option><option value="absence">Ausência</option><option value="leave">Licença</option></select><div className="grid grid-cols-2 gap-2"><input aria-label="Início da ausência" type="date" value={absence.startsAt} onChange={(event) => setAbsence((current) => ({ ...current, startsAt: event.target.value }))} className="rounded-lg border border-slate-800 bg-slate-950 px-2 py-2 text-xs text-slate-100" /><input aria-label="Fim da ausência" type="date" value={absence.endsAt} onChange={(event) => setAbsence((current) => ({ ...current, endsAt: event.target.value }))} className="rounded-lg border border-slate-800 bg-slate-950 px-2 py-2 text-xs text-slate-100" /></div><select aria-label="Substituto" value={absence.substituteOwner} onChange={(event) => setAbsence((current) => ({ ...current, substituteOwner: event.target.value }))} className="rounded-lg border border-slate-800 bg-slate-950 px-2 py-2 text-xs text-slate-100"><option value="">Sem substituto</option>{professionals.map((person) => <option key={person.name} value={person.name}>{person.name}</option>)}</select><input aria-label="Motivo da ausência" value={absence.reason} onChange={(event) => setAbsence((current) => ({ ...current, reason: event.target.value }))} placeholder="Motivo obrigatório" className="rounded-lg border border-slate-800 bg-slate-950 px-2 py-2 text-xs text-slate-100" /><Button size="sm" onClick={() => void saveAbsence()} disabled={busy || !absence.owner || !absence.startsAt || !absence.endsAt || absence.reason.trim().length < 3}>Registrar ausência</Button></div></section></aside></div>
    <section aria-labelledby="commercial-campaigns-heading" className="rounded-xl border border-slate-800 p-4"><div className="flex items-center gap-2"><AlertTriangle className="h-4 w-4 text-amber-300" /><h3 id="commercial-campaigns-heading" className="font-semibold text-white">Campanhas e coortes congeladas</h3></div><p className="mt-1 text-xs text-slate-500">A simulação é obrigatória. Campanhas são versionadas e não enviam mensagens nesta tranche.</p><div className="mt-3 grid gap-2 sm:grid-cols-2 xl:grid-cols-4"><input aria-label="Nome da campanha" value={campaignDraft.name} onChange={(event) => setCampaignDraft((current) => ({ ...current, name: event.target.value }))} placeholder="Nome da campanha" className="rounded-lg border border-slate-800 bg-slate-950 px-2 py-2 text-xs text-slate-100" /><select aria-label="Responsável da campanha" value={campaignDraft.owner} onChange={(event) => setCampaignDraft((current) => ({ ...current, owner: event.target.value }))} className="rounded-lg border border-slate-800 bg-slate-950 px-2 py-2 text-xs text-slate-100"><option value="">Responsável da campanha</option>{professionals.map((person) => <option key={person.name} value={person.name}>{person.name}</option>)}</select><input aria-label="Oferta da campanha" value={campaignDraft.offerId} onChange={(event) => setCampaignDraft((current) => ({ ...current, offerId: event.target.value }))} placeholder="Oferta (opcional)" className="rounded-lg border border-slate-800 bg-slate-950 px-2 py-2 text-xs text-slate-100" /><input aria-label="Versão do segmento" value={campaignDraft.segmentVersion} onChange={(event) => setCampaignDraft((current) => ({ ...current, segmentVersion: event.target.value }))} placeholder="Versão do segmento" className="rounded-lg border border-slate-800 bg-slate-950 px-2 py-2 text-xs text-slate-100" /><input aria-label="Grupo de controle" type="number" min="0" max="100" value={campaignDraft.controlGroupPercent} onChange={(event) => setCampaignDraft((current) => ({ ...current, controlGroupPercent: event.target.value }))} placeholder="Controle %" className="rounded-lg border border-slate-800 bg-slate-950 px-2 py-2 text-xs text-slate-100" /><input aria-label="Motivo da campanha" value={campaignDraft.reason} onChange={(event) => setCampaignDraft((current) => ({ ...current, reason: event.target.value }))} placeholder="Motivo obrigatório" className="rounded-lg border border-slate-800 bg-slate-950 px-2 py-2 text-xs text-slate-100 sm:col-span-2 xl:col-span-1" /></div><div className="mt-3 flex flex-wrap gap-2"><Button size="sm" variant="outline" onClick={() => void previewCampaign()} disabled={busy || !campaignDraft.name || !campaignDraft.owner || campaignDraft.reason.trim().length < 3 || !selectedIds.length}>Simular coorte ({selectedIds.length})</Button>{preview ? <Button size="sm" onClick={() => void createCampaign()} disabled={busy}>Confirmar criação</Button> : null}</div>{preview ? <div className="mt-3 rounded-lg border border-emerald-300/25 bg-emerald-500/10 p-3 text-xs text-emerald-100">Simulação: {preview.summary.total} total · {preview.summary.eligible} elegíveis · {preview.summary.blocked} bloqueados · {preview.summary.review} em revisão · {preview.summary.permissionExpiring} permissões expirando · {preview.summary.sourceStale} fontes stale. Impacto: {preview.summary.impact}.</div> : null}<div className="mt-4 grid gap-2 sm:grid-cols-2">{campaigns.map((campaign) => <article key={campaign.id} className="rounded-lg border border-slate-800/80 bg-slate-950/40 p-3 text-xs"><div className="font-medium text-slate-100">{campaign.name}</div><div className="mt-1 text-slate-400">{campaign.state} · revisão {campaign.revision} · {campaign.counts?.total || 0} membros</div><div className="mt-1 text-slate-500">{campaign.unitName} · segmento {campaign.segmentKey}@{campaign.segmentVersion}</div></article>)}{!campaigns.length ? <p className="text-xs text-slate-500">Nenhuma campanha congelada.</p> : null}</div></section>
  </section>
}
