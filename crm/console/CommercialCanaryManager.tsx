import { useCallback, useEffect, useMemo, useState } from 'react'
import { AlertTriangle, CheckCircle2, RefreshCw, ShieldOff, UsersRound } from 'lucide-react'
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
  type CommercialCanaryState,
  type CommercialCanarySummary,
} from '@/atendimentoApi'

type Unit = { slug: string; name: string }

function requestKey(prefix: string) {
  const id = typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2, 12)}`
  return `${prefix}:${id}`
}

function statusLabel(candidate: CommercialCanaryCandidate) {
  if (candidate.eligibility === 'eligible') return 'Elegível'
  if (candidate.eligibility === 'blocked') return 'Bloqueado'
  return 'Em revisão'
}

function statusTone(candidate: CommercialCanaryCandidate) {
  if (candidate.eligibility === 'eligible') return 'text-emerald-300'
  if (candidate.eligibility === 'blocked') return 'text-rose-200'
  return 'text-amber-200'
}

function summaryLine(summary: CommercialCanarySummary | null) {
  if (!summary) return 'Faça a simulação antes de salvar a coorte.'
  return `${summary.totalCohort} selecionada(s) · ${summary.eligible} elegível(is) · ${summary.blocked} bloqueada(s) · ${summary.inReview} em revisão · ${summary.staleSources} com fonte não saudável`
}

export function CommercialCanaryManager({ units, policyVersion, onChanged }: { units: Unit[]; policyVersion: string; onChanged?: () => Promise<void> | void }) {
  const [unit, setUnit] = useState('')
  const [state, setState] = useState<CommercialCanaryState | null>(null)
  const [candidates, setCandidates] = useState<CommercialCanaryCandidate[]>([])
  const [selected, setSelected] = useState<CommercialCanaryCandidate[]>([])
  const [query, setQuery] = useState('')
  const [summary, setSummary] = useState<CommercialCanarySummary | null>(null)
  const [canApply, setCanApply] = useState(false)
  const [justification, setJustification] = useState('')
  const [confirmed, setConfirmed] = useState(false)
  const [validationType, setValidationType] = useState<'synthetic' | 'explicit_approved'>('synthetic')
  const [approvalReference, setApprovalReference] = useState('')
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState('')
  const [error, setError] = useState('')

  const activeCohort = useMemo(() => state?.canary.activeCohorts.find((cohort) => cohort.unit === unit) || null, [state, unit])
  const selectedRefs = useMemo(() => selected.map((candidate) => candidate.candidateRef), [selected])

  const loadState = useCallback(async (selectedUnit = unit) => {
    const result = await fetchCommercialCanaryState(selectedUnit || undefined)
    if (!result.ok) throw new Error(result.error || 'Não foi possível consultar o estado do canário.')
    setState(result)
    return result
  }, [unit])

  const loadCandidates = useCallback(async (selectedUnit = unit, nextQuery = query) => {
    if (!selectedUnit) { setCandidates([]); return }
    const result = await fetchCommercialCanaryCandidates({ unit: selectedUnit, q: nextQuery, limit: 25 })
    if (!result.ok) throw new Error(result.error || 'Não foi possível buscar identidades para o canário.')
    setCandidates(result.candidates)
  }, [query, unit])

  const refresh = useCallback(async (selectedUnit = unit, nextQuery = query) => {
    try {
      setBusy(true); setError('')
      await Promise.all([loadState(selectedUnit), loadCandidates(selectedUnit, nextQuery)])
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Não foi possível atualizar o canário.')
    } finally { setBusy(false) }
  }, [loadCandidates, loadState, query, unit])

  useEffect(() => { void refresh() }, []) // The unit remains explicit; this loads only neutral state first.

  const toggle = (candidate: CommercialCanaryCandidate) => {
    setSummary(null); setCanApply(false)
    setSelected((current) => current.some((item) => item.candidateRef === candidate.candidateRef)
      ? current.filter((item) => item.candidateRef !== candidate.candidateRef)
      : current.length >= 100 ? current : [...current, candidate])
  }

  const simulate = async () => {
    if (!unit || !selectedRefs.length) { setError('Selecione uma unidade e pelo menos uma identidade mascarada.'); return }
    try {
      setBusy(true); setError(''); setNotice('')
      const result = await previewCommercialCanary({ unit, candidateRefs: selectedRefs })
      if (!result.ok) throw new Error(result.error || 'Não foi possível simular a coorte.')
      setSummary(result.summary); setCanApply(result.canApply)
      setNotice(result.canApply ? 'A simulação está elegível. A escrita comercial e as mensagens continuam desativadas.' : 'A simulação encontrou bloqueios. Corrija a validação, escopo ou freshness antes de salvar.')
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Não foi possível simular a coorte.') } finally { setBusy(false) }
  }

  const validateCandidate = async (candidate: CommercialCanaryCandidate) => {
    if (!unit) return
    try {
      setBusy(true); setError(''); setNotice('')
      const result = await validateCommercialCanaryIdentity({
        unit,
        candidateRef: candidate.candidateRef,
        validationType,
        approvalReference: validationType === 'explicit_approved' ? approvalReference : undefined,
        justification,
        confirmed: true,
        expectedPolicyVersion: policyVersion,
        expectedValidationRevision: candidate.validationRevision,
        idempotencyKey: requestKey('canary-validate'),
      })
      if (!result.ok) throw new Error(result.error || 'Não foi possível validar a identidade.')
      setNotice(`Validação registrada até ${result.validation.expiresAt ? new Date(result.validation.expiresAt).toLocaleString('pt-BR') : 'a expiração definida'}.`)
      await refresh(unit)
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Não foi possível validar a identidade.') } finally { setBusy(false) }
  }

  const save = async () => {
    if (!unit || !summary || !canApply || !confirmed) { setError('Execute uma simulação elegível e confirme a alteração antes de salvar.'); return }
    try {
      setBusy(true); setError(''); setNotice('')
      const result = await saveCommercialCanary({
        unit, candidateRefs: selectedRefs, justification, confirmed: true, expectedPolicyVersion: policyVersion,
        expectedCohortVersion: activeCohort?.version || 0, idempotencyKey: requestKey('canary-save'),
      })
      if (!result.ok) throw new Error(result.error || 'Não foi possível salvar a coorte.')
      setNotice(`Coorte v${result.cohort.version} registrada. Escritas comerciais e mensagens permanecem desativadas.`)
      setSelected([]); setSummary(null); setCanApply(false); setConfirmed(false)
      await refresh(unit)
      await onChanged?.()
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Não foi possível salvar a coorte.') } finally { setBusy(false) }
  }

  const remove = async () => {
    if (!unit) return
    try {
      setBusy(true); setError(''); setNotice('')
      const result = await removeCommercialCanary({
        unit, justification, confirmed: true, expectedPolicyVersion: policyVersion,
        expectedCohortVersion: activeCohort?.version || 0, idempotencyKey: requestKey('canary-remove'),
      })
      if (!result.ok) throw new Error(result.error || 'Não foi possível remover o canário.')
      setNotice(result.removed ? 'Canário removido de forma atômica. Escritas e mensagens seguem desativadas.' : 'Nenhum canário ativo existia nesta unidade.')
      setSelected([]); setSummary(null); setCanApply(false); setConfirmed(false)
      await refresh(unit)
      await onChanged?.()
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Não foi possível remover o canário.') } finally { setBusy(false) }
  }

  const emergencyOff = async () => {
    try {
      setBusy(true); setError(''); setNotice('')
      const result = await emergencyOffCommercialCanary({ justification, confirmed: true, expectedPolicyVersion: policyVersion, idempotencyKey: requestKey('canary-emergency-off') })
      if (!result.ok) throw new Error(result.error || 'Não foi possível executar o desligamento emergencial.')
      setNotice(`Desligamento emergencial concluído para ${result.disabledCohorts} coorte(s). Escritas e mensagens seguem desativadas.`)
      setSelected([]); setSummary(null); setCanApply(false); setConfirmed(false)
      await refresh(unit)
      await onChanged?.()
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Não foi possível executar o desligamento emergencial.') } finally { setBusy(false) }
  }

  return <section aria-labelledby="commercial-canary-title" className="rounded-xl border border-slate-800 bg-slate-950/65 p-4">
    <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between"><div><div className="flex items-center gap-2"><UsersRound className="h-4 w-4 text-sky-300" /><h2 id="commercial-canary-title" className="font-semibold text-white">Rollout e canário comercial</h2></div><p className="mt-1 text-xs text-slate-400">Identidades mascaradas, escopo de unidade, validação temporária, simulação e ledger append-only. Esta área não habilita escrita comercial nem envia mensagens.</p></div><Button size="sm" variant="outline" onClick={() => void refresh()} disabled={busy}><RefreshCw className={`mr-2 h-4 w-4 ${busy ? 'animate-spin' : ''}`} />Atualizar</Button></div>
    <div className="mt-3 grid gap-2 md:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]"><label className="text-xs text-slate-400">Unidade<select aria-label="Unidade do canário" value={unit} onChange={(event) => { const next = event.target.value; setUnit(next); setSelected([]); setSummary(null); setCanApply(false); void refresh(next, '') }} className="mt-1 w-full rounded-lg border border-slate-800 bg-slate-900 px-3 py-2 text-sm text-white"><option value="">Selecione uma unidade</option>{units.map((item) => <option key={item.slug} value={item.slug}>{item.name}</option>)}</select></label><label className="text-xs text-slate-400">Buscar cliente (resultado mascarado)<div className="mt-1 flex gap-2"><input aria-label="Buscar cliente mascarado para o canário" value={query} onChange={(event) => setQuery(event.target.value)} disabled={!unit} placeholder="Nome comercial" className="min-w-0 flex-1 rounded-lg border border-slate-800 bg-slate-900 px-3 py-2 text-sm text-white placeholder:text-slate-500" /><Button size="sm" variant="outline" onClick={() => void refresh(unit, query)} disabled={!unit || busy}>Buscar</Button></div></label></div>
    {state ? <div className={`mt-3 rounded-lg border p-3 text-xs ${state.canary.ready ? 'border-emerald-300/20 bg-emerald-500/10 text-emerald-100' : 'border-amber-300/25 bg-amber-500/10 text-amber-100'}`}>{state.canary.ready ? `Controles prontos. Freshness: ${state.canary.sourceFreshness}.` : 'Controles do seletor ainda não estão prontos ou a chave operacional não está configurada; nenhuma coorte pode ser gravada.'} Escrita comercial: desativada. Mensagens enviadas: 0.</div> : null}
    {error ? <div role="alert" className="mt-3 rounded-lg border border-rose-300/30 bg-rose-500/10 p-3 text-sm text-rose-100">{error}</div> : null}
    {notice ? <div aria-live="polite" className="mt-3 rounded-lg border border-emerald-300/25 bg-emerald-500/10 p-3 text-sm text-emerald-100">{notice}</div> : null}
    <div className="mt-4 grid gap-2 md:grid-cols-2">{candidates.map((candidate) => <article key={candidate.candidateRef} className="rounded-lg border border-slate-800 bg-slate-900/50 p-3"><div className="flex items-start gap-2"><input type="checkbox" aria-label={`Selecionar ${candidate.displayNameMasked} para o canário`} checked={selected.some((item) => item.candidateRef === candidate.candidateRef)} disabled={!state?.canary.ready || busy} onChange={() => toggle(candidate)} className="mt-1" /><div className="min-w-0 flex-1"><div className="flex flex-wrap items-center justify-between gap-2"><span className="truncate font-medium text-slate-100">{candidate.displayNameMasked}</span><span className={`text-xs ${statusTone(candidate)}`}>{statusLabel(candidate)}</span></div><dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 text-[11px] text-slate-400"><div><dt className="inline text-slate-500">Unidade: </dt><dd className="inline">{candidate.unit}</dd></div><div><dt className="inline text-slate-500">Identidade: </dt><dd className="inline">{candidate.identityQuality === 'confirmed_multi_source' ? 'confirmada' : 'em revisão'}</dd></div><div><dt className="inline text-slate-500">Permissão: </dt><dd className="inline">{candidate.permissionStatus}</dd></div><div><dt className="inline text-slate-500">Telefone: </dt><dd className="inline">{candidate.phoneStatus}</dd></div><div><dt className="inline text-slate-500">Opt-out: </dt><dd className="inline">{candidate.optOut}</dd></div><div><dt className="inline text-slate-500">Fonte: </dt><dd className="inline">{candidate.freshness}</dd></div></dl><p className="mt-2 text-[11px] text-slate-500">Motivo: {candidate.inclusionReason.replace(/_/g, ' ')}</p>{candidate.validationStatus !== 'valid' ? <Button size="sm" variant="outline" className="mt-2" onClick={() => void validateCandidate(candidate)} disabled={busy || !justification.trim() || (validationType === 'explicit_approved' && !approvalReference.trim())}>Validar identidade</Button> : null}</div></div></article>)}</div>
    {unit && !busy && !candidates.length ? <p className="mt-4 text-center text-sm text-slate-500">Nenhuma identidade foi encontrada nesta unidade com estes filtros.</p> : null}
    <div className="mt-4 grid gap-2 border-t border-slate-800 pt-4 md:grid-cols-2"><label className="text-xs text-slate-400">Tipo de validação<select aria-label="Tipo de validação da identidade" value={validationType} onChange={(event) => setValidationType(event.target.value as 'synthetic' | 'explicit_approved')} className="mt-1 w-full rounded-lg border border-slate-800 bg-slate-900 px-3 py-2 text-sm text-white"><option value="synthetic">Identidade sintética</option><option value="explicit_approved">Identidade explicitamente aprovada</option></select></label>{validationType === 'explicit_approved' ? <label className="text-xs text-slate-400">Referência de aprovação (sem PII)<input aria-label="Referência de aprovação explícita" value={approvalReference} onChange={(event) => setApprovalReference(event.target.value)} maxLength={120} placeholder="ticket-aprovacao-123" className="mt-1 w-full rounded-lg border border-slate-800 bg-slate-900 px-3 py-2 text-sm text-white placeholder:text-slate-500" /></label> : <div className="rounded-lg border border-slate-800 bg-slate-900/50 p-3 text-xs text-slate-400">A validação sintética exige que a origem da identidade seja marcada como sintética pelo CRM.</div>}</div>
    <label className="mt-3 block text-xs text-slate-400">Justificativa operacional (sem PII)<textarea aria-label="Justificativa da operação do canário" value={justification} onChange={(event) => setJustification(event.target.value)} minLength={10} maxLength={500} placeholder="Explique o objetivo e o gate operacional, sem dados do cliente." className="mt-1 min-h-20 w-full rounded-lg border border-slate-800 bg-slate-900 px-3 py-2 text-sm text-white placeholder:text-slate-500" /></label>
    <div className="mt-3 rounded-lg border border-slate-800 bg-slate-900/45 p-3 text-xs text-slate-300"><div className="flex items-center gap-2"><AlertTriangle className="h-4 w-4 text-amber-200" /><span>{summaryLine(summary)}</span></div>{summary ? <div className="mt-2 grid grid-cols-2 gap-1 text-slate-400 sm:grid-cols-4"><span>Permissão expirando: {summary.permissionsExpiring}</span><span>Telefone não correlacionado: {summary.phonesUncorrelated}</span><span>Decisão pendente: {summary.pendingIdentityDecisions}</span><span>Não validada: {summary.notValidated}</span></div> : null}</div>
    <div className="mt-3 flex flex-wrap items-center gap-2"><Button size="sm" variant="outline" onClick={() => void simulate()} disabled={busy || !unit || !selected.length}>Simular coorte</Button><label className="flex items-center gap-2 text-xs text-slate-300"><input type="checkbox" checked={confirmed} onChange={(event) => setConfirmed(event.target.checked)} disabled={busy} />Confirmo a coorte, a justificativa e a versão atual da política.</label><Button size="sm" onClick={() => void save()} disabled={busy || !state?.canary.ready || !canApply || !confirmed || justification.trim().length < 10}><CheckCircle2 className="mr-2 h-4 w-4" />Salvar coorte</Button>{activeCohort ? <Button size="sm" variant="outline" onClick={() => void remove()} disabled={busy || !confirmed || justification.trim().length < 10}>Remover canário da unidade</Button> : null}{state?.canary.emergencyOffAvailable ? <Button size="sm" variant="outline" onClick={() => void emergencyOff()} disabled={busy || !confirmed || justification.trim().length < 10} className="border-rose-300/35 text-rose-100"><ShieldOff className="mr-2 h-4 w-4" />Emergency off global</Button> : null}</div>
  </section>
}
