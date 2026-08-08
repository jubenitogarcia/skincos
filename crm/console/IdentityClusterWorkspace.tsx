import { useCallback, useEffect, useMemo, useState } from 'react'
import { AlertTriangle, CheckCircle2, Eye, GitBranch, LockKeyhole, RefreshCw, ShieldAlert, UsersRound } from 'lucide-react'
import { Button } from '@/button'
import {
  applyIdentityClusterBulk,
  fetchIdentityClusterDetail,
  fetchIdentityClusterWorkspace,
  previewIdentityClusterBulk,
  revealIdentityCluster,
  type IdentityClusterBulkPreview,
  type IdentityReviewCluster,
} from '@/atendimentoApi'

type ClusterFilters = { q: string; unit: string; stale: boolean; includeResolved: boolean }

const defaultFilters: ClusterFilters = { q: '', unit: 'all', stale: false, includeResolved: false }

function readUrlState(): ClusterFilters & { clusterKey: string } {
  if (typeof window === 'undefined') return { ...defaultFilters, clusterKey: '' }
  const params = new URLSearchParams(window.location.search)
  return {
    q: params.get('identityClusterQ') || '',
    unit: params.get('identityClusterUnit') || 'all',
    stale: params.get('identityClusterStale') === 'true',
    includeResolved: params.get('identityClusterResolved') === 'true',
    clusterKey: params.get('identityCluster') || '',
  }
}

function writeUrl(filters: ClusterFilters, clusterKey: string, historyMode: 'replace' | 'push' = 'replace') {
  if (typeof window === 'undefined') return
  const url = new URL(window.location.href)
  const set = (key: string, value: string, defaultValue = '') => value && value !== defaultValue ? url.searchParams.set(key, value) : url.searchParams.delete(key)
  set('identityClusterQ', filters.q)
  set('identityClusterUnit', filters.unit, 'all')
  set('identityClusterStale', filters.stale ? 'true' : '')
  set('identityClusterResolved', filters.includeResolved ? 'true' : '')
  set('identityCluster', clusterKey)
  const next = `${url.pathname}${url.search}${url.hash}`
  if (historyMode === 'push') window.history.pushState(window.history.state, document.title, next)
  else window.history.replaceState(window.history.state, document.title, next)
}

function clusterLabel(cluster: IdentityReviewCluster) {
  if (cluster.staleState === 'stale') return 'Fonte alterada'
  if (cluster.decision.state === 'confirmed') return 'Confirmado'
  if (cluster.decision.state === 'rejected') return 'Rejeitado'
  return cluster.bulkReview.eligible ? 'Lote seguro' : 'Revisão individual'
}

function clusterTone(cluster: IdentityReviewCluster) {
  if (cluster.staleState === 'stale') return 'border-amber-300/30 bg-amber-500/10 text-amber-100'
  if (cluster.bulkReview.eligible) return 'border-emerald-300/25 bg-emerald-500/10 text-emerald-100'
  return 'border-slate-700 bg-slate-900/60 text-slate-300'
}

function ErrorPanel({ message, retry }: { message: string; retry?: () => void }) {
  return <div role="alert" className="rounded-xl border border-rose-300/30 bg-rose-500/10 p-3 text-sm text-rose-100"><div className="flex items-start gap-2"><ShieldAlert className="mt-0.5 h-4 w-4 shrink-0" /><span className="min-w-0 flex-1">{message}</span>{retry ? <Button size="sm" variant="outline" onClick={retry}>Tentar novamente</Button> : null}</div></div>
}

function Detail({ cluster, onReveal, revealing, revealAllowed }: { cluster: IdentityReviewCluster; onReveal: () => void; revealing: boolean; revealAllowed: boolean }) {
  return <div className="space-y-4" data-testid="identity-cluster-detail">
    <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between"><div><div className="flex flex-wrap items-center gap-2"><h3 className="text-lg font-semibold text-white">Componente de identidade</h3><span className={`rounded-full border px-2 py-0.5 text-[11px] ${clusterTone(cluster)}`}>{clusterLabel(cluster)}</span></div><p className="mt-1 text-xs text-slate-500">{cluster.summary.memberCount} membro(s) · {cluster.summary.identityCount} identidade(s) · confiança {Math.round(cluster.confidence * 100)}%</p></div><Button size="sm" variant="outline" onClick={onReveal} disabled={revealing || !revealAllowed}><Eye className="mr-2 h-4 w-4" />Revelar contato</Button></div>
    <div className="grid gap-2 sm:grid-cols-4"><Fact label="Fontes" value={cluster.membersBySource.length} /><Fact label="Conflitos" value={cluster.conflicts.length} /><Fact label="Membros a mover" value={cluster.impact.membersToMove.length} /><Fact label="Desfazer" value={cluster.undo.blocked ? 'Bloqueado' : 'Disponível'} /></div>
    <section aria-labelledby="identity-cluster-members"><h4 id="identity-cluster-members" className="flex items-center gap-2 text-sm font-semibold text-white"><UsersRound className="h-4 w-4 text-sky-300" />Membros por fonte</h4><ul className="mt-2 grid gap-2 md:grid-cols-2">{cluster.members.map((member, index) => <li key={`${member.source}-${member.name}-${index}`} className="rounded-lg border border-slate-800/80 bg-slate-950/40 p-3"><div className="flex items-start justify-between gap-3"><div className="min-w-0"><div className="text-xs text-sky-300">{member.sourceLabel}</div><div className="truncate text-sm font-medium text-slate-100">{member.name}</div>{member.aliases.length ? <div className="mt-1 text-xs text-slate-500">Aliases: {member.aliases.join(', ')}</div> : null}</div><span className={`rounded-full border px-2 py-0.5 text-[10px] ${member.stale ? 'border-amber-300/30 text-amber-200' : 'border-slate-700 text-slate-400'}`}>{member.stale ? 'stale' : member.freshness}</span></div><div className="mt-2 flex flex-wrap gap-1.5 text-[11px] text-slate-400">{member.units.map((unit) => <span key={unit} className="rounded border border-slate-800 px-1.5 py-0.5">{unit}</span>)}{member.contact.phone.map((phone) => <span key={phone} className="rounded border border-slate-800 px-1.5 py-0.5">Tel. {phone}</span>)}{member.contact.email.map((email) => <span key={email} className="rounded border border-slate-800 px-1.5 py-0.5">E-mail {email}</span>)}</div><div className="mt-2 text-[11px] text-slate-500">{member.matchingFields.map((field) => `${field.label}: ${field.status}`).join(' · ')}</div></li>)}</ul></section>
    <div className="grid gap-3 lg:grid-cols-2"><section className="rounded-lg border border-slate-800 p-3"><h4 className="text-sm font-semibold text-white">Evidências fortes</h4>{cluster.evidence.strong.length ? <ul className="mt-2 space-y-2 text-xs text-slate-300">{cluster.evidence.strong.map((item, index) => <li key={`${item.label}-${index}`}><span className="text-emerald-300">{item.label}</span><span className="ml-2 text-slate-500">{Math.round(item.confidence * 100)}% · {item.summary}</span></li>)}</ul> : <p className="mt-2 text-xs text-slate-500">Nenhuma evidência forte suficiente.</p>}</section><section className="rounded-lg border border-slate-800 p-3"><h4 className="text-sm font-semibold text-white">Evidências fracas e conflitos</h4>{cluster.evidence.weak.length ? <ul className="mt-2 space-y-2 text-xs text-slate-300">{cluster.evidence.weak.map((item, index) => <li key={`${item.label}-${index}`}><span className="text-amber-200">{item.label}</span><span className="ml-2 text-slate-500">{item.summary}</span></li>)}</ul> : null}{cluster.conflicts.length ? <ul className="mt-2 space-y-2 text-xs text-rose-200">{cluster.conflicts.map((item) => <li key={item.field}>{item.summary}</li>)}</ul> : !cluster.evidence.weak.length ? <p className="mt-2 text-xs text-slate-500">Nenhum conflito explicitado.</p> : null}</section></div>
    <section className="rounded-lg border border-slate-800 p-3"><h4 className="flex items-center gap-2 text-sm font-semibold text-white"><GitBranch className="h-4 w-4 text-sky-300" />Lineage e impacto previsto</h4><div className="mt-2 grid gap-3 text-xs text-slate-300 md:grid-cols-2"><div><div className="text-slate-500">Identidade sobrevivente</div><div className="mt-1">{cluster.impact.survivorIdentity?.name || 'A definir na materialização'}</div><div className="mt-3 text-slate-500">Identidades retiradas</div><div className="mt-1">{cluster.impact.retiredIdentities.length ? cluster.impact.retiredIdentities.map((identity) => identity.name).join(', ') : 'Nenhuma'}</div><div className="mt-3 text-slate-500">Lineage</div><div className="mt-1">{cluster.lineage.length ? cluster.lineage.map((entry) => entry.relation).join(', ') : 'Ainda não materializada'}</div></div><div><div className="text-slate-500">Bloqueios de desfazimento</div><div className="mt-1">{cluster.undo.blocked ? cluster.undo.reasons.join(', ') : 'Nenhum histórico comercial ou de consentimento detectado.'}</div><div className="mt-3 text-slate-500">Alterações de fonte</div><div className="mt-1">{cluster.sourceChanges.length ? cluster.sourceChanges.map((change) => `${change.source}: ${change.name}`).join(' · ') : 'Nenhuma alteração após a decisão.'}</div><div className="mt-3 text-slate-500">Materializações</div><div className="mt-1">{cluster.materializations.length ? cluster.materializations.map((run) => `${run.mode}: ${run.membersMoved} membro(s)`).join(' · ') : 'Nenhuma'}</div></div></div></section>
    <div className="rounded-lg border border-slate-800 bg-slate-950/40 p-3 text-xs text-slate-400"><LockKeyhole className="mr-2 inline h-4 w-4 text-sky-300" />IDs técnicos não são renderizados. Telefones e e-mails permanecem mascarados até uma ação explícita e auditada.</div>
  </div>
}

function Fact({ label, value }: { label: string; value: number | string }) {
  return <div className="rounded-lg border border-slate-800 p-3"><div className="text-[11px] text-slate-500">{label}</div><div className="mt-1 text-lg font-semibold text-white">{value}</div></div>
}

export function IdentityClusterWorkspace() {
  const initial = readUrlState()
  const [filters, setFilters] = useState<ClusterFilters>(initial)
  const [clusterKey, setClusterKey] = useState(initial.clusterKey)
  const [clusters, setClusters] = useState<IdentityReviewCluster[]>([])
  const [detail, setDetail] = useState<IdentityReviewCluster | null>(null)
  const [total, setTotal] = useState(0)
  const [workspaceReady, setWorkspaceReady] = useState(false)
  const [writesReady, setWritesReady] = useState(false)
  const [selectedKeys, setSelectedKeys] = useState<string[]>([])
  const [preview, setPreview] = useState<IdentityClusterBulkPreview | null>(null)
  const [loading, setLoading] = useState(false)
  const [detailLoading, setDetailLoading] = useState(false)
  const [revealing, setRevealing] = useState(false)
  const [applying, setApplying] = useState(false)
  const [error, setError] = useState('')
  const [detailError, setDetailError] = useState('')
  const [notice, setNotice] = useState('')
  const [applyOpen, setApplyOpen] = useState(false)
  const [applyReason, setApplyReason] = useState('')
  const [revealOpen, setRevealOpen] = useState(false)
  const [revealReason, setRevealReason] = useState('')
  const [revealFields, setRevealFields] = useState<string[]>([])
  const [revealed, setRevealed] = useState<Array<{ sourceLabel: string; name: string; phone: string[]; email: string[] }>>([])

  const load = useCallback(async () => {
    try {
      setLoading(true); setError('')
      const result = await fetchIdentityClusterWorkspace({ ...filters, limit: 50, offset: 0 })
      if (!result.ok) throw new Error(result.error || 'Não foi possível carregar o grafo de identidades.')
      setClusters(result.clusters); setTotal(result.total); setWorkspaceReady(result.workspace.ready); setWritesReady(result.workflow.writesReady)
      const nextKey = clusterKey && result.clusters.some((cluster) => cluster.clusterKey === clusterKey) ? clusterKey : result.clusters[0]?.clusterKey || ''
      if (nextKey !== clusterKey) { setClusterKey(nextKey); writeUrl(filters, nextKey) }
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Não foi possível carregar o grafo de identidades.') } finally { setLoading(false) }
  }, [clusterKey, filters])

  const loadDetail = useCallback(async (nextKey: string) => {
    if (!nextKey) { setDetail(null); return }
    try {
      setDetailLoading(true); setDetailError('')
      const result = await fetchIdentityClusterDetail(nextKey, { unit: filters.unit })
      if (!result.ok) throw new Error(result.error || 'Não foi possível carregar o componente selecionado.')
      setDetail(result.cluster); setWorkspaceReady(result.workspace.ready); setWritesReady(result.workflow.writesReady)
    } catch (cause) { setDetail(null); setDetailError(cause instanceof Error ? cause.message : 'Não foi possível carregar o componente selecionado.') } finally { setDetailLoading(false) }
  }, [filters.unit])

  useEffect(() => { void load() }, [load])
  useEffect(() => { void loadDetail(clusterKey) }, [clusterKey, loadDetail])
  useEffect(() => {
    const popState = () => { const next = readUrlState(); setFilters(next); setClusterKey(next.clusterKey) }
    window.addEventListener('popstate', popState)
    return () => window.removeEventListener('popstate', popState)
  }, [])
  useEffect(() => {
    if (!revealed.length) return
    const timeout = window.setTimeout(() => setRevealed([]), 5 * 60 * 1000)
    return () => window.clearTimeout(timeout)
  }, [revealed])

  const units = useMemo(() => [...new Set(clusters.flatMap((cluster) => cluster.units))].sort(), [clusters])
  const updateFilters = (patch: Partial<ClusterFilters>) => { const next = { ...filters, ...patch }; setFilters(next); writeUrl(next, clusterKey) }
  const selectCluster = (nextKey: string) => { setClusterKey(nextKey); setNotice(''); writeUrl(filters, nextKey, 'push') }
  const toggle = (key: string) => setSelectedKeys((current) => current.includes(key) ? current.filter((item) => item !== key) : [...current, key])

  const simulate = async () => {
    try { setError(''); const result = await previewIdentityClusterBulk({ clusterKeys: selectedKeys, unit: filters.unit }); if (!result.ok) throw new Error(result.error || 'Não foi possível simular o lote.'); setPreview(result); setApplyOpen(false) } catch (cause) { setError(cause instanceof Error ? cause.message : 'Não foi possível simular o lote.') }
  }
  const apply = async () => {
    if (!preview || applyReason.trim().length < 3) return
    try {
      setApplying(true); setError('')
      const eligible = preview.clusters.filter((cluster) => cluster.eligible)
      const expectedVersions = Object.fromEntries(eligible.map((cluster) => [cluster.clusterKey, cluster.version]))
      const idempotencyKey = typeof globalThis.crypto?.randomUUID === 'function' ? globalThis.crypto.randomUUID() : `identity-cluster-${Date.now()}-${Math.random().toString(16).slice(2)}`
      const result = await applyIdentityClusterBulk({ clusterKeys: Object.keys(expectedVersions), expectedVersions, reason: applyReason.trim(), confirmation: 'REVIEW_CLUSTER', unit: filters.unit }, idempotencyKey)
      if (!result.ok) throw new Error(result.error || 'Não foi possível aplicar a revisão em lote.')
      setNotice(`${result.appliedClusters} componente(s) confirmado(s) com ledger append-only. ${result.membersMoved} membro(s) movido(s).`)
      setSelectedKeys([]); setPreview(null); setApplyOpen(false); setApplyReason(''); await load()
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Não foi possível aplicar a revisão em lote.') } finally { setApplying(false) }
  }
  const reveal = async () => {
    const requestedFields = revealFields.filter((field): field is 'phone' | 'email' => field === 'phone' || field === 'email')
    if (!detail || revealReason.trim().length < 3 || !requestedFields.length) return
    try {
      setRevealing(true); setDetailError('')
      const result = await revealIdentityCluster(detail.clusterKey, { expectedVersion: detail.version, fields: requestedFields, reason: revealReason.trim(), confirmation: 'REVIEW_CLUSTER', unit: filters.unit })
      if (!result.ok) throw new Error(result.error || 'Não foi possível revelar os dados de contato.')
      setRevealed(result.contacts); setRevealOpen(false); setNotice('Reveal registrado em ledger append-only; os dados serão removidos da tela após cinco minutos.')
    } catch (cause) { setDetailError(cause instanceof Error ? cause.message : 'Não foi possível revelar os dados de contato.') } finally { setRevealing(false) }
  }

  return <section aria-labelledby="identity-cluster-heading" className="rounded-2xl border border-slate-800/80 bg-slate-950/55 p-5 shadow-[0_20px_60px_rgba(2,6,23,0.28)]"><div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between"><div><h2 id="identity-cluster-heading" className="text-lg font-semibold text-white">Clusters de identidade</h2><p className="mt-1 text-sm text-slate-500">Componentes transitivos do grafo, com lineage explícita e revisão em lote somente quando a evidência é determinística.</p></div><Button size="sm" variant="outline" onClick={() => void load()} disabled={loading}><RefreshCw className={`mr-2 h-4 w-4 ${loading ? 'animate-spin' : ''}`} />Atualizar</Button></div><div className="mt-4 flex flex-wrap gap-2"><input aria-label="Buscar cluster por cliente" value={filters.q} onChange={(event) => updateFilters({ q: event.target.value })} placeholder="Buscar cliente ou alias" className="min-w-56 flex-1 rounded-lg border border-slate-800 bg-slate-900 px-3 py-2 text-sm text-slate-100 placeholder:text-slate-500" /><select aria-label="Unidade do cluster" value={filters.unit} onChange={(event) => updateFilters({ unit: event.target.value })} className="rounded-lg border border-slate-800 bg-slate-900 px-3 py-2 text-sm text-slate-100"><option value="all">Todas as unidades</option>{units.map((unit) => <option key={unit} value={unit}>{unit}</option>)}</select><label className="flex items-center gap-2 rounded-lg border border-slate-800 px-3 py-2 text-xs text-slate-300"><input type="checkbox" checked={filters.stale} onChange={(event) => updateFilters({ stale: event.target.checked })} />Somente stale</label><label className="flex items-center gap-2 rounded-lg border border-slate-800 px-3 py-2 text-xs text-slate-300"><input type="checkbox" checked={filters.includeResolved} onChange={(event) => updateFilters({ includeResolved: event.target.checked })} />Decisões vigentes</label></div>{!workspaceReady ? <div className="mt-3 rounded-lg border border-amber-300/25 bg-amber-500/10 p-3 text-xs text-amber-100">A migration do workspace ainda não está aplicada. Leitura permanece disponível; reveal e lote ficam bloqueados.</div> : null}{!writesReady ? <div className="mt-3 rounded-lg border border-amber-300/25 bg-amber-500/10 p-3 text-xs text-amber-100">O ledger de revisão ainda não está pronto neste ambiente. Nenhuma decisão pode ser gravada.</div> : null}{error ? <div className="mt-3"><ErrorPanel message={error} retry={() => void load()} /></div> : null}{notice ? <div role="status" className="mt-3 rounded-lg border border-emerald-300/25 bg-emerald-500/10 p-3 text-sm text-emerald-100">{notice}</div> : null}<div className="mt-4 grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(23rem,0.9fr)]"><section aria-labelledby="identity-cluster-list-heading" className="min-w-0"><div className="flex items-center justify-between gap-3"><h3 id="identity-cluster-list-heading" className="text-sm font-semibold text-white">{clusters.length} de {total} clusters</h3><div className="flex flex-wrap gap-2"><Button size="sm" variant="outline" onClick={() => void simulate()} disabled={!selectedKeys.length || loading}>Simular lote ({selectedKeys.length})</Button><Button size="sm" onClick={() => setApplyOpen(true)} disabled={!preview?.eligibleCount || !workspaceReady || !writesReady}>Aplicar elegíveis</Button></div></div><ul className="mt-2 divide-y divide-slate-800/70 overflow-hidden rounded-xl border border-slate-800/80">{loading && !clusters.length ? <li className="p-6 text-sm text-slate-500">Carregando componentes…</li> : clusters.map((cluster) => <li key={cluster.clusterKey} className={`p-3 ${cluster.clusterKey === clusterKey ? 'bg-sky-500/[0.08]' : ''}`}><div className="flex items-start gap-3"><input type="checkbox" aria-label={`Selecionar cluster com ${cluster.summary.memberCount} membros`} checked={selectedKeys.includes(cluster.clusterKey)} disabled={!cluster.bulkReview.eligible || !workspaceReady || !writesReady} onChange={() => toggle(cluster.clusterKey)} className="mt-1" /><button type="button" className="min-w-0 flex-1 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-300" onClick={() => selectCluster(cluster.clusterKey)}><div className="flex flex-wrap items-center gap-2"><span className="truncate text-sm font-medium text-slate-100">{cluster.members[0]?.name || 'Componente sem nome'}</span><span className={`rounded-full border px-2 py-0.5 text-[10px] ${clusterTone(cluster)}`}>{clusterLabel(cluster)}</span></div><div className="mt-1 text-xs text-slate-500">{cluster.summary.memberCount} membro(s) · {cluster.units.join(', ') || 'Unidade não resolvida'} · {cluster.membersBySource.map((source) => `${source.sourceLabel}: ${source.count}`).join(' · ')}</div></button></div></li>)}{!loading && !clusters.length ? <li className="p-6 text-center text-sm text-slate-500">Nenhum componente encontrado para os filtros atuais.</li> : null}</ul><div className="mt-2 flex items-center gap-2 text-xs text-slate-500"><CheckCircle2 className="h-4 w-4 text-emerald-400" />Apenas clusters determinísticos entram no lote; ambiguidades permanecem na revisão individual.</div></section><aside className="min-w-0 rounded-xl border border-slate-800/80 bg-slate-950/35 p-4">{detailLoading ? <p className="text-sm text-slate-500">Carregando detalhe…</p> : detailError ? <ErrorPanel message={detailError} retry={() => void loadDetail(clusterKey)} /> : detail ? <Detail cluster={detail} onReveal={() => { setRevealReason(''); setRevealFields([]); setRevealed([]); setRevealOpen(true) }} revealing={revealing} revealAllowed={workspaceReady} /> : <p className="text-sm text-slate-500">Selecione um componente para revisar lineage e impacto.</p>}{revealed.length ? <div className="mt-4 rounded-lg border border-amber-300/30 bg-amber-500/10 p-3 text-xs text-amber-100"><div className="font-semibold">Contato revelado (auditoria registrada)</div>{revealed.map((entry, index) => <div key={`${entry.sourceLabel}-${index}`} className="mt-2"><div>{entry.sourceLabel} · {entry.name}</div>{entry.phone.map((phone) => <div key={phone}>Telefone: {phone}</div>)}{entry.email.map((email) => <div key={email}>E-mail: {email}</div>)}</div>)}</div> : null}</aside></div>{preview ? <section aria-labelledby="identity-cluster-preview" className="mt-4 rounded-xl border border-sky-300/25 bg-sky-500/[0.06] p-4"><div className="flex items-center gap-2"><AlertTriangle className="h-4 w-4 text-sky-300" /><h3 id="identity-cluster-preview" className="text-sm font-semibold text-white">Simulação do lote</h3></div><div className="mt-3 grid gap-2 sm:grid-cols-5"><Fact label="Clusters" value={preview.clusterCount} /><Fact label="Elegíveis" value={preview.eligibleCount} /><Fact label="Bloqueados" value={preview.blockedCount} /><Fact label="Membros elegíveis" value={preview.eligibleMembers} /><div className="rounded-lg border border-slate-800 p-3"><div className="text-[11px] text-slate-500">Motivos</div><div className="mt-1 text-xs text-slate-300">{preview.blockedReasons.join(', ') || 'Nenhum'}</div></div></div></section> : null}{revealOpen ? <div role="dialog" aria-modal="true" aria-labelledby="identity-cluster-reveal-title" className="mt-4 rounded-xl border border-amber-300/30 bg-amber-500/10 p-4"><h3 id="identity-cluster-reveal-title" className="text-sm font-semibold text-amber-100">Revelar contato deste cluster</h3><p className="mt-1 text-xs text-amber-100/80">A ação exige justificativa, é auditada e expira após cinco minutos. Valores não entram em logs nem métricas.</p><div className="mt-3 flex flex-wrap gap-3 text-sm text-amber-50"><label className="flex items-center gap-2"><input type="checkbox" checked={revealFields.includes('phone')} onChange={(event) => setRevealFields((current) => event.target.checked ? [...new Set([...current, 'phone'])] : current.filter((field) => field !== 'phone'))} />Telefone</label><label className="flex items-center gap-2"><input type="checkbox" checked={revealFields.includes('email')} onChange={(event) => setRevealFields((current) => event.target.checked ? [...new Set([...current, 'email'])] : current.filter((field) => field !== 'email'))} />E-mail</label></div><textarea aria-label="Justificativa do reveal" value={revealReason} onChange={(event) => setRevealReason(event.target.value)} maxLength={1000} placeholder="Justificativa obrigatória" className="mt-3 min-h-20 w-full rounded-lg border border-amber-200/30 bg-slate-950/50 p-2 text-sm text-white" /><div className="mt-3 flex justify-end gap-2"><Button size="sm" variant="outline" onClick={() => setRevealOpen(false)}>Cancelar</Button><Button size="sm" onClick={() => void reveal()} disabled={revealing || revealReason.trim().length < 3 || !revealFields.length}>Confirmar reveal</Button></div></div> : null}{applyOpen ? <div role="dialog" aria-modal="true" aria-labelledby="identity-cluster-apply-title" className="mt-4 rounded-xl border border-emerald-300/25 bg-emerald-500/10 p-4"><h3 id="identity-cluster-apply-title" className="text-sm font-semibold text-emerald-100">Confirmar revisão em lote</h3><p className="mt-1 text-xs text-emerald-100/80">O servidor revalida versão, locks do grafo, escopo de unidade e histórico antes de gravar. A justificativa é mantida apenas como digest auditável.</p><textarea aria-label="Justificativa da revisão em lote" value={applyReason} onChange={(event) => setApplyReason(event.target.value)} maxLength={1000} placeholder="Justificativa obrigatória" className="mt-3 min-h-20 w-full rounded-lg border border-emerald-200/30 bg-slate-950/50 p-2 text-sm text-white" /><div className="mt-3 flex justify-end gap-2"><Button size="sm" variant="outline" onClick={() => setApplyOpen(false)}>Cancelar</Button><Button size="sm" onClick={() => void apply()} disabled={applying || applyReason.trim().length < 3}>Confirmar aplicação</Button></div></div> : null}</section>
}
