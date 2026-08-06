import { useCallback, useEffect, useMemo, useState } from 'react'
import { AlertTriangle, CheckCircle2, Eye, LockKeyhole, Power, RefreshCw, ShieldCheck, XCircle } from 'lucide-react'
import { Button } from '@/button'
import {
  emergencyOffCommercialCanary,
  fetchCommercialCanaryCandidates,
  fetchCommercialCanaryState,
  previewCommercialCanary,
  removeCommercialCanary,
  saveCommercialCanary,
  validateCommercialCanaryIdentity,
  type CommercialCanaryCandidate,
  type CommercialCanaryPreview,
  type CommercialCanaryState,
} from '@/atendimentoApi'

type Props = {
  unit?: string
  units?: Array<{ slug: string; name: string }>
  onChanged?: () => Promise<void>
}

function freshLabel(value: string) {
  return ({ healthy: 'Saudável', preventive: 'Atualizar em breve', stale: 'Stale', unknown: 'Desconhecida' } as Record<string, string>)[value] || value
}

function statusClass(value: string) {
  if (value === 'eligible' || value === 'healthy' || value === 'synthetic' || value === 'explicit_approved') return 'border-emerald-300/25 bg-emerald-500/10 text-emerald-100'
  if (value === 'blocked' || value === 'stale') return 'border-rose-300/25 bg-rose-500/10 text-rose-100'
  return 'border-amber-300/25 bg-amber-500/10 text-amber-100'
}

function Metric({ label, value }: { label: string; value: number }) {
  return <div className="rounded-lg border border-slate-800/80 bg-slate-900/55 p-2.5"><div className="text-[11px] text-slate-500">{label}</div><div className="mt-1 text-lg font-semibold text-white">{value}</div></div>
}

function newIdempotencyKey(prefix: string) {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return `${prefix}:${crypto.randomUUID()}`
  return `${prefix}:${Date.now()}`
}

export function CommercialCanaryManager({ unit = '', units = [], onChanged }: Props) {
  const [state, setState] = useState<CommercialCanaryState | null>(null)
  const [candidates, setCandidates] = useState<CommercialCanaryCandidate[]>([])
  const [selected, setSelected] = useState<string[]>([])
  const [scopeUnit, setScopeUnit] = useState(unit)
  const [query, setQuery] = useState('')
  const [quality, setQuality] = useState('')
  const [permission, setPermission] = useState('')
  const [phone, setPhone] = useState('')
  const [optOut, setOptOut] = useState('')
  const [freshness, setFreshness] = useState('')
  const [preview, setPreview] = useState<CommercialCanaryPreview | null>(null)
  const [justification, setJustification] = useState('')
  const [confirm, setConfirm] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')

  useEffect(() => { setScopeUnit(unit) }, [unit])

  const load = useCallback(async () => {
    try {
      setBusy(true); setError('')
      const [nextState, nextCandidates] = await Promise.all([
        fetchCommercialCanaryState(),
        fetchCommercialCanaryCandidates({ q: query, unit: scopeUnit, quality, permission, phone, optOut, freshness, limit: 50 }),
      ])
      if (!nextState.ok) throw new Error(nextState.error || 'O estado do canário não está disponível.')
      if (!nextCandidates.ok) throw new Error(nextCandidates.error || 'Não foi possível carregar os candidatos.')
      setState(nextState)
      setCandidates(nextCandidates.candidates)
      setSelected((current) => current.filter((ref) => nextCandidates.candidates.some((candidate) => candidate.candidateRef === ref)))
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Não foi possível carregar o seletor.') } finally { setBusy(false) }
  }, [freshness, optOut, permission, phone, quality, query, scopeUnit])

  useEffect(() => { void load() }, [load])

  const selectedCandidates = useMemo(() => candidates.filter((candidate) => selected.includes(candidate.candidateRef)), [candidates, selected])
  const canPreview = selected.length > 0 && !busy
  const canMutate = !!state?.policyVersion && !!preview?.canApply && justification.trim().length >= 10 && confirm && !busy
  const expectedCohortVersion = state?.cohort?.version || 0

  const simulate = async () => {
    try {
      setBusy(true); setError(''); setNotice('')
      const result = await previewCommercialCanary({ candidateRefs: selected, unit: scopeUnit })
      if (!result.ok) throw new Error(result.error || 'Não foi possível simular a coorte.')
      setPreview(result.preview)
      setNotice('Simulação atualizada. Nada foi salvo e nenhuma mensagem será enviada.')
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Não foi possível simular a coorte.') } finally { setBusy(false) }
  }

  const save = async () => {
    if (!state?.policyVersion) return
    try {
      setBusy(true); setError(''); setNotice('')
      const result = await saveCommercialCanary({
        candidateRefs: selected,
        unit: scopeUnit,
        expectedPolicyVersion: state.policyVersion,
        expectedCohortVersion,
        justification: justification.trim(),
        confirm: true,
        idempotencyKey: newIdempotencyKey('commercial-canary-save'),
      })
      if (!result.ok) throw new Error(result.error || 'Não foi possível salvar a coorte.')
      setNotice('Coorte salva com auditoria. Escrita comercial continua desativada e nenhuma mensagem foi enviada.')
      setPreview(result.preview); setConfirm(false); setJustification('')
      await load(); await onChanged?.()
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Não foi possível salvar a coorte.') } finally { setBusy(false) }
  }

  const validateCandidate = async (candidate: CommercialCanaryCandidate) => {
    if (!state?.policyVersion || justification.trim().length < 10 || !confirm) {
      setError('Informe a justificativa, confirme a simulação e só então valide a identidade.')
      return
    }
    try {
      setBusy(true); setError(''); setNotice('')
      const result = await validateCommercialCanaryIdentity({
        candidateRef: candidate.candidateRef,
        validationType: candidate.sourceTypes.some((source) => source.toLowerCase().includes('synthetic')) ? 'synthetic' : 'explicit_approved',
        expectedPolicyVersion: state.policyVersion,
        expectedValidationRevision: candidate.validationRevision,
        justification: justification.trim(),
        confirm: true,
        idempotencyKey: newIdempotencyKey('commercial-canary-validate'),
        unit: scopeUnit,
      })
      if (!result.ok) throw new Error(result.error || 'Não foi possível validar a identidade.')
      setNotice('Validação registrada com auditoria. Simule novamente antes de salvar a coorte.')
      await load()
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Não foi possível validar a identidade.') } finally { setBusy(false) }
  }

  const remove = async (emergency: boolean) => {
    if (!state?.policyVersion) return
    try {
      setBusy(true); setError(''); setNotice('')
      const fn = emergency ? emergencyOffCommercialCanary : removeCommercialCanary
      const result = await fn({ expectedPolicyVersion: state.policyVersion, expectedCohortVersion, justification: justification.trim(), confirm: true, idempotencyKey: newIdempotencyKey(emergency ? 'commercial-canary-emergency-off' : 'commercial-canary-remove') })
      if (!result.ok) throw new Error(result.error || 'Não foi possível remover o canário.')
      setNotice(emergency ? 'Emergency off aplicado em uma transação. Escrita e mensagens permanecem bloqueadas.' : 'Canário removido em uma única operação auditada.')
      setSelected([]); setPreview(null); setConfirm(false); setJustification('')
      await load(); await onChanged?.()
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Não foi possível remover o canário.') } finally { setBusy(false) }
  }

  return <section aria-labelledby="commercial-canary-heading" className="mt-5 rounded-2xl border border-slate-800/80 bg-slate-950/55 p-5 shadow-[0_20px_60px_rgba(2,6,23,0.2)]">
    <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
      <div><div className="flex items-center gap-2"><ShieldCheck className="h-5 w-5 text-sky-300" /><h2 id="commercial-canary-heading" className="font-semibold text-white">Rollout e canário</h2></div><p className="mt-1 max-w-3xl text-xs text-slate-500">Coorte operacional separada da política comercial, do consentimento e da cadência clínica. Resultados mascarados, refs autenticadas e cifradas com expiração curta; nenhum UUID é digitado ou persistido pelo navegador.</p></div>
      <Button size="sm" variant="outline" onClick={() => void load()} disabled={busy}><RefreshCw className={`mr-2 h-4 w-4 ${busy ? 'animate-spin' : ''}`} />Atualizar</Button>
    </div>
    <div className="mt-4 flex flex-wrap items-center gap-2 text-xs"><span className={`rounded-full border px-2 py-1 ${state?.emergencyOff ? 'border-amber-300/25 bg-amber-500/10 text-amber-100' : 'border-emerald-300/25 bg-emerald-500/10 text-emerald-100'}`}><LockKeyhole className="mr-1 inline h-3.5 w-3.5" />Escrita comercial: desativada</span><span className="rounded-full border border-slate-700 px-2 py-1 text-slate-400">Mensagens: 0</span>{state?.cohort ? <span className="rounded-full border border-slate-700 px-2 py-1 text-slate-400">Coorte v{state.cohort.version} · {state.cohort.memberCount} identidade(s)</span> : <span className="rounded-full border border-slate-700 px-2 py-1 text-slate-400">Sem coorte ativa</span>}</div>
    <div className="mt-4 grid gap-2 md:grid-cols-2 xl:grid-cols-7"><select aria-label="Unidade do canário" value={scopeUnit} onChange={(event) => setScopeUnit(event.target.value)} className="rounded-lg border border-slate-800 bg-slate-900 px-3 py-2 text-sm text-slate-100"><option value="">Unidade: todas permitidas</option>{units.map((item) => <option key={item.slug} value={item.slug}>{item.name}</option>)}</select><input aria-label="Buscar cliente para o canário" value={query} onChange={(event) => setQuery(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') void load() }} placeholder="Buscar cliente" className="rounded-lg border border-slate-800 bg-slate-900 px-3 py-2 text-sm text-slate-100 placeholder:text-slate-500" /><select aria-label="Qualidade da identidade" value={quality} onChange={(event) => setQuality(event.target.value)} className="rounded-lg border border-slate-800 bg-slate-900 px-3 py-2 text-sm text-slate-100"><option value="">Qualidade: todas</option><option value="confirmed_multi_source">Confirmada multi-fonte</option><option value="unresolved_single_source">Fonte única / revisão</option></select><select aria-label="Status da permissão" value={permission} onChange={(event) => setPermission(event.target.value)} className="rounded-lg border border-slate-800 bg-slate-900 px-3 py-2 text-sm text-slate-100"><option value="">Permissão: todas</option><option value="granted">Concedida</option><option value="denied">Negada</option><option value="unknown">Sem registro</option></select><select aria-label="Status do telefone" value={phone} onChange={(event) => setPhone(event.target.value)} className="rounded-lg border border-slate-800 bg-slate-900 px-3 py-2 text-sm text-slate-100"><option value="">Telefone: todos</option><option value="correlated">Correlacionado</option><option value="uncorrelated">Não correlacionado</option></select><select aria-label="Opt-out" value={optOut} onChange={(event) => setOptOut(event.target.value)} className="rounded-lg border border-slate-800 bg-slate-900 px-3 py-2 text-sm text-slate-100"><option value="">Opt-out: todos</option><option value="yes">Com opt-out</option><option value="no">Sem opt-out</option></select><select aria-label="Freshness das fontes" value={freshness} onChange={(event) => setFreshness(event.target.value)} className="rounded-lg border border-slate-800 bg-slate-900 px-3 py-2 text-sm text-slate-100"><option value="">Freshness: todos</option><option value="healthy">Saudável</option><option value="preventive">Preventivo</option><option value="stale">Stale</option><option value="unknown">Desconhecida</option></select></div>
    <div className="mt-3 space-y-2">{candidates.map((candidate) => <label key={candidate.candidateRef} className="flex cursor-pointer items-start gap-3 rounded-xl border border-slate-800/80 bg-slate-900/35 p-3 hover:border-sky-400/40"><input type="checkbox" checked={selected.includes(candidate.candidateRef)} onChange={() => setSelected((current) => current.includes(candidate.candidateRef) ? current.filter((ref) => ref !== candidate.candidateRef) : [...current, candidate.candidateRef])} className="mt-1" aria-label={`Selecionar ${candidate.displayNameMasked}`} /><span className="min-w-0 flex-1"><span className="flex flex-wrap items-center gap-2 text-sm font-medium text-slate-100"><Eye className="h-3.5 w-3.5 text-slate-500" />{candidate.displayNameMasked}{candidate.unitSlugs.map((slug) => <span key={slug} className="rounded-full border border-slate-700 px-1.5 py-0.5 text-[10px] font-normal text-slate-400">{slug}</span>)}</span><span className="mt-1 flex flex-wrap gap-1.5 text-[11px]"><span className={`rounded-full border px-1.5 py-0.5 ${statusClass(candidate.identityQuality)}`}>{candidate.identityQuality === 'confirmed_multi_source' ? 'Identidade confirmada' : 'Identidade em revisão'}</span><span className={`rounded-full border px-1.5 py-0.5 ${statusClass(candidate.contactStatus)}`}>{candidate.contactStatus === 'eligible' ? 'Elegível' : candidate.contactStatus === 'blocked' ? 'Bloqueado' : 'Em revisão'}</span><span className={`rounded-full border px-1.5 py-0.5 ${statusClass(candidate.validationStatus)}`}>{candidate.validationStatus === 'not_validated' ? 'Validação pendente' : 'Validação aprovada'}</span><span className={`rounded-full border px-1.5 py-0.5 ${statusClass(candidate.freshnessStatus)}`}>{freshLabel(candidate.freshnessStatus)}</span><span className="rounded-full border border-slate-700 px-1.5 py-0.5 text-slate-400">Telefone: {candidate.phoneStatus === 'correlated' ? 'correlacionado' : 'não correlacionado'}</span>{candidate.optOut ? <span className="rounded-full border border-rose-300/25 bg-rose-500/10 px-1.5 py-0.5 text-rose-100">Opt-out</span> : null}</span><span className="mt-1 block text-[11px] text-slate-500">Motivo: {candidate.inclusionReason}</span>{candidate.validationStatus === 'not_validated' ? <button type="button" className="mt-2 rounded-md border border-sky-300/25 px-2 py-1 text-[11px] text-sky-100 hover:bg-sky-500/10" disabled={busy || !confirm || justification.trim().length < 10} onClick={(event) => { event.preventDefault(); event.stopPropagation(); void validateCandidate(candidate) }}>Registrar aprovação explícita</button> : null}</span></label>)}{!candidates.length && !busy ? <p className="rounded-lg border border-amber-300/20 bg-amber-500/10 p-3 text-xs text-amber-100">Nenhum candidato compatível. A busca não revela contatos e a ausência de dados permanece em revisão.</p> : null}</div>
    <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-slate-800/80 pt-3 text-xs text-slate-500"><span>{selected.length} selecionada(s) · {selectedCandidates.length} carregada(s)</span><Button size="sm" onClick={() => void simulate()} disabled={!canPreview}><Eye className="mr-2 h-4 w-4" />Simular alteração</Button></div>
    {preview ? <div className="mt-4 rounded-xl border border-sky-300/20 bg-sky-500/5 p-3"><div className="flex items-center gap-2 text-sm font-medium text-sky-100"><Eye className="h-4 w-4" />Simulação sem escrita</div><div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4 xl:grid-cols-8"><Metric label="Total" value={preview.totalCohort} /><Metric label="Elegíveis" value={preview.eligible} /><Metric label="Bloqueados" value={preview.blocked} /><Metric label="Em revisão" value={preview.inReview} /><Metric label="Expiram" value={preview.permissionsExpiring} /><Metric label="Telefone" value={preview.phonesUncorrelated} /><Metric label="Stale" value={preview.staleSources} /><Metric label="Decisão pendente" value={preview.pendingIdentityDecisions} /></div><p className="mt-3 text-xs text-slate-400">Impacto previsto: {preview.impact.identitiesAdded || 0} inclusão(ões), 0 contato(s), 0 mensagem(ns). {preview.canApply ? 'A coorte pode ser salva após confirmação.' : 'A coorte não pode ser salva enquanto houver bloqueios, revisão, stale ou validação pendente.'}</p></div> : null}
    <div className="mt-4 grid gap-3 rounded-xl border border-slate-800/80 bg-slate-900/30 p-3"><label className="text-xs text-slate-400">Justificativa obrigatória (mínimo de 10 caracteres)<textarea aria-label="Justificativa do canário" value={justification} onChange={(event) => setJustification(event.target.value)} maxLength={1000} className="mt-1 min-h-20 w-full rounded-lg border border-slate-800 bg-slate-950 px-3 py-2 text-sm text-slate-100 placeholder:text-slate-500" placeholder="Descreva o motivo operacional, a unidade e a validação usada." /></label><label className="flex items-start gap-2 text-xs text-amber-100"><input type="checkbox" checked={confirm} onChange={(event) => setConfirm(event.target.checked)} className="mt-0.5" />Confirmo explicitamente a simulação atual, a versão de política exibida e que nenhuma mensagem ou escrita comercial será executada.</label><div className="flex flex-wrap gap-2"><Button size="sm" onClick={() => void save()} disabled={!canMutate}><CheckCircle2 className="mr-2 h-4 w-4" />Salvar coorte auditada</Button><Button size="sm" variant="outline" onClick={() => void remove(false)} disabled={busy || !state?.cohort || justification.trim().length < 10 || !confirm}><XCircle className="mr-2 h-4 w-4" />Remover canário</Button><Button size="sm" variant="outline" onClick={() => void remove(true)} disabled={busy || !state?.cohort || justification.trim().length < 10 || !confirm} className="border-rose-300/30 text-rose-100 hover:bg-rose-500/10"><Power className="mr-2 h-4 w-4" />Emergency off</Button></div><p className="text-[11px] text-slate-500">Versão esperada da política: {state?.policyVersion || 'indisponível'} · versão da coorte: {expectedCohortVersion}. Gestores comerciais não aprovam regras clínicas.</p></div>
    {error ? <div role="alert" className="mt-3 rounded-lg border border-rose-300/30 bg-rose-500/10 p-3 text-sm text-rose-100"><AlertTriangle className="mr-2 inline h-4 w-4" />{error}</div> : null}{notice ? <div role="status" className="mt-3 rounded-lg border border-emerald-300/25 bg-emerald-500/10 p-3 text-sm text-emerald-100">{notice}</div> : null}
  </section>
}
