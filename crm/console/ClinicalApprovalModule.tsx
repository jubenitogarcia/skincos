import { useCallback, useEffect, useMemo, useState } from 'react'
import { Check, RefreshCw, X } from 'lucide-react'
import { Button } from '@/button'
import { useAuth } from '@/contexts'
import {
  approveClinicalApproval,
  fetchClinicalApprovals,
  rejectClinicalApproval,
  type ClinicalApprovalRule,
  type ClinicalApprovalStatus,
} from '@/atendimentoApi'

const labels: Record<ClinicalApprovalStatus, string> = {
  draft: 'Rascunho',
  submitted: 'Aguardando revisão',
  approved: 'Aprovada',
  rejected: 'Rejeitada',
  expired: 'Expirada',
  disabled: 'Desativada',
}

function idempotencyKey(action: string, rule: ClinicalApprovalRule) {
  const random = typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function' ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`
  return `clinical-${action}-${rule.id}-${rule.revision}-${random}`
}

function formatDate(value: string | null) {
  if (!value) return 'sem expiração'
  const parsed = new Date(`${value.slice(0, 10)}T00:00:00Z`)
  return Number.isNaN(parsed.getTime()) ? value : parsed.toLocaleDateString('pt-BR', { timeZone: 'UTC' })
}

export function ClinicalApprovalModule() {
  const { user } = useAuth()
  const role = String(user?.role || '').toUpperCase()
  const [status, setStatus] = useState<ClinicalApprovalStatus>('submitted')
  const [rules, setRules] = useState<ClinicalApprovalRule[]>([])
  const [loading, setLoading] = useState(true)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    const result = await fetchClinicalApprovals({ status })
    if (!result.ok) setError(result.error || 'Não foi possível carregar as regras clínicas.')
    else setRules(result.rules || [])
    setLoading(false)
  }, [status])

  useEffect(() => { void load() }, [load])

  const submitted = useMemo(() => rules.filter((rule) => rule.status === 'submitted'), [rules])

  const decide = async (rule: ClinicalApprovalRule, action: 'approve' | 'reject') => {
    setBusyId(rule.id)
    setError('')
    setNotice('')
    const result = action === 'approve'
      ? await approveClinicalApproval(rule.id, { expectedRevision: rule.revision, reason: 'revisão clínica registrada', idempotencyKey: idempotencyKey(action, rule) })
      : await rejectClinicalApproval(rule.id, { expectedRevision: rule.revision, reason: 'evidência insuficiente para aprovação', idempotencyKey: idempotencyKey(action, rule) })
    if (!result.ok) setError(result.error || 'A decisão não foi aplicada.')
    else {
      setNotice(action === 'approve' ? 'Regra aprovada e registrada no histórico.' : 'Regra rejeitada e registrada no histórico.')
      await load()
    }
    setBusyId(null)
  }

  if (role !== 'CLINICAL_APPROVER') {
    return <section aria-labelledby="clinical-approval-forbidden" className="rounded-2xl border border-amber-800/60 bg-amber-950/20 p-6"><h1 id="clinical-approval-forbidden" className="text-lg font-semibold text-amber-100">Aprovação clínica</h1><p className="mt-2 text-sm text-amber-200">Este workspace é restrito ao papel de aprovador clínico.</p></section>
  }

  return <main aria-labelledby="clinical-approval-title" className="space-y-5 p-4 sm:p-6">
    <header className="flex flex-wrap items-start justify-between gap-3">
      <div><p className="text-xs uppercase tracking-[0.2em] text-sky-300">Domínio independente</p><h1 id="clinical-approval-title" className="mt-1 text-2xl font-semibold text-white">Aprovações clínicas</h1><p className="mt-1 max-w-2xl text-sm text-slate-400">Revisa regras por procedimento e unidade. A aprovação não prescreve, não seleciona coortes e não envia mensagens.</p></div>
      <Button variant="outline" aria-label="Atualizar regras clínicas" onClick={() => void load()} disabled={loading}><RefreshCw className="mr-2 h-4 w-4" />Atualizar</Button>
    </header>
    <div role="status" aria-live="polite" className="min-h-5 text-sm">{notice ? <span className="text-emerald-300">{notice}</span> : null}{error ? <span className="text-rose-300">{error}</span> : null}</div>
    <div className="flex flex-wrap items-center gap-2" role="tablist" aria-label="Status das regras clínicas">
      {(['submitted', 'approved', 'rejected', 'expired', 'disabled'] as ClinicalApprovalStatus[]).map((value) => <button key={value} type="button" role="tab" aria-selected={status === value} onClick={() => setStatus(value)} className={`rounded-full border px-3 py-1.5 text-xs ${status === value ? 'border-sky-400 bg-sky-500/20 text-sky-100' : 'border-slate-700 text-slate-400'}`}>{labels[value]}</button>)}
    </div>
    {loading ? <div role="status" className="rounded-2xl border border-slate-800 bg-slate-950/50 p-6 text-sm text-slate-400">Carregando regras clínicas…</div> : null}
    {!loading && !error && !rules.length ? <div className="rounded-2xl border border-dashed border-slate-700 p-8 text-center text-sm text-slate-400">Nenhuma regra neste estado.</div> : null}
    {!loading && !error && rules.length ? <section aria-label="Lista de regras clínicas" className="grid gap-3">{rules.map((rule) => <article key={rule.id} className="rounded-2xl border border-slate-800 bg-slate-950/55 p-4">
      <div className="flex flex-wrap items-start justify-between gap-3"><div><h2 className="font-medium text-white">{rule.procedureName || 'Procedimento não identificado'}</h2><p className="mt-1 text-xs text-slate-400">{rule.unitName || 'Escopo global'} · revisão {rule.revision} · {labels[rule.status]}</p></div><span className="rounded-full border border-slate-700 px-2 py-1 text-xs text-slate-300">{rule.intervalMinDays === rule.intervalMaxDays ? `${rule.intervalMinDays} dias` : `${rule.intervalMinDays}–${rule.intervalMaxDays} dias`}</span></div>
      <dl className="mt-4 grid gap-3 text-sm sm:grid-cols-2"><div><dt className="text-xs text-slate-500">Justificativa</dt><dd className="mt-1 text-slate-200">{rule.justification}</dd></div><div><dt className="text-xs text-slate-500">Referência/evidência</dt><dd className="mt-1 break-words text-slate-200">{rule.evidenceReference}</dd></div><div><dt className="text-xs text-slate-500">Vigência</dt><dd className="mt-1 text-slate-200">{formatDate(rule.effectiveFrom)} → {formatDate(rule.expiresAt)}</dd></div><div><dt className="text-xs text-slate-500">Auditoria</dt><dd className="mt-1 text-slate-200">Autor e decisão registrados no ledger append-only.</dd></div></dl>
      {rule.status === 'submitted' ? <div className="mt-4 flex flex-wrap gap-2"><Button size="sm" onClick={() => void decide(rule, 'approve')} disabled={busyId === rule.id}><Check className="mr-2 h-4 w-4" />Aprovar</Button><Button size="sm" variant="outline" onClick={() => void decide(rule, 'reject')} disabled={busyId === rule.id}><X className="mr-2 h-4 w-4" />Rejeitar</Button></div> : null}
    </article>)}</section> : null}
    <p className="text-xs text-slate-500">Fila submetida: {submitted.length}. Nenhuma regra aprovada é convertida automaticamente em recomendação clínica.</p>
  </main>
}
