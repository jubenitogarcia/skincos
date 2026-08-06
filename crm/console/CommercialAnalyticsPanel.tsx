import { useCallback, useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import { BarChart3, Database, RefreshCw, ShieldCheck, Timer } from 'lucide-react'
import { Button } from '@/button'
import {
  commercialAnalyticsFunnelStages,
  fetchCommercialAnalyticsFunnel,
  fetchCommercialAnalyticsExperiments,
  fetchCommercialAnalyticsQuality,
  fetchCommercialAnalyticsSegments,
  type CommercialAnalyticsFunnel,
  type CommercialAnalyticsExperiment,
  type CommercialAnalyticsQuality,
  type CommercialAnalyticsSegment,
} from '@/atendimentoApi'

function percent(value: number | null | undefined) {
  return value == null || !Number.isFinite(value) ? '—' : `${(value * 100).toFixed(1)}%`
}

function number(value: number | null | undefined) {
  return value == null || !Number.isFinite(value) ? '—' : new Intl.NumberFormat('pt-BR').format(value)
}

function AnalyticsMetric({ label, value, detail, icon: Icon }: { label: string; value: string; detail: string; icon: typeof Timer }) {
  return <article className="rounded-xl border border-slate-800/80 bg-slate-900/45 p-3"><div className="flex items-center gap-2 text-[11px] uppercase tracking-wide text-slate-500"><Icon className="h-3.5 w-3.5 text-sky-300" />{label}</div><div className="mt-2 text-xl font-semibold text-white">{value}</div><p className="mt-1 text-[11px] text-slate-500">{detail}</p></article>
}

function PanelState({ loading, error, empty, children }: { loading: boolean; error: string; empty: boolean; children: ReactNode }) {
  if (loading) return <div className="rounded-xl border border-slate-800/80 bg-slate-900/30 p-6 text-center text-sm text-slate-500">Carregando série analítica…</div>
  if (error) return <div role="alert" className="rounded-xl border border-amber-300/25 bg-amber-500/10 p-4 text-sm text-amber-100">{error}</div>
  if (empty) return <div className="rounded-xl border border-slate-800/80 bg-slate-900/30 p-6 text-center text-sm text-slate-500">Sem dados suficientes para este recorte. O painel não interpreta ausência como zero.</div>
  return <>{children}</>
}

function initialAnalyticsFilter(key: string, fallback = '') {
  if (typeof window === 'undefined') return fallback
  return new URLSearchParams(window.location.search).get(`clientesAnalytics${key}`) || fallback
}

// Stable deep-link keys: clientesAnalyticsFrom, clientesAnalyticsTo,
// clientesAnalyticsGranularity and clientesAnalyticsState.

export function CommercialAnalyticsPanel({ unit = 'all' }: { unit?: string }) {
  const [quality, setQuality] = useState<CommercialAnalyticsQuality | null>(null)
  const [funnel, setFunnel] = useState<CommercialAnalyticsFunnel | null>(null)
  const [segments, setSegments] = useState<CommercialAnalyticsSegment[]>([])
  const [experiments, setExperiments] = useState<CommercialAnalyticsExperiment[]>([])
  const [from, setFrom] = useState(() => initialAnalyticsFilter('From'))
  const [to, setTo] = useState(() => initialAnalyticsFilter('To'))
  const [granularity, setGranularity] = useState<'day' | 'week' | 'month'>(() => {
    const value = initialAnalyticsFilter('Granularity', 'day')
    return ['day', 'week', 'month'].includes(value) ? value as 'day' | 'week' | 'month' : 'day'
  })
  const [state, setState] = useState<'observed' | 'attributed' | 'incremental'>(() => {
    const value = initialAnalyticsFilter('State', 'attributed')
    return ['observed', 'attributed', 'incremental'].includes(value) ? value as 'observed' | 'attributed' | 'incremental' : 'attributed'
  })
  const [loading, setLoading] = useState(false)
  const [errors, setErrors] = useState({ quality: '', funnel: '', segments: '', experiments: '' })

  useEffect(() => {
    if (typeof window === 'undefined') return
    const params = new URLSearchParams(window.location.search)
    const values: Record<string, string> = { From: from, To: to, Granularity: granularity, State: state }
    for (const [key, value] of Object.entries(values)) {
      if (value) params.set(`clientesAnalytics${key}`, value)
      else params.delete(`clientesAnalytics${key}`)
    }
    const query = params.toString()
    window.history.replaceState(window.history.state, '', `${window.location.pathname}${query ? `?${query}` : ''}${window.location.hash}`)
  }, [from, granularity, state, to])

  const load = useCallback(async () => {
    setLoading(true)
    setErrors({ quality: '', funnel: '', segments: '', experiments: '' })
    const filters = { unit: unit === 'all' ? undefined : unit, from: from || undefined, to: to || undefined, granularity }
    const [qualityResult, funnelResult, segmentsResult, experimentsResult] = await Promise.all([
      fetchCommercialAnalyticsQuality(filters),
      fetchCommercialAnalyticsFunnel(filters),
      fetchCommercialAnalyticsSegments({ unit: filters.unit }),
      fetchCommercialAnalyticsExperiments({ unit: filters.unit }),
    ])
    if (qualityResult.ok) setQuality(qualityResult)
    else setErrors((current) => ({ ...current, quality: qualityResult.error === 'COMMERCIAL_ANALYTICS_NOT_READY' ? 'A migration analítica ainda não foi ativada neste ambiente.' : 'A série de qualidade está indisponível para este escopo.' }))
    if (funnelResult.ok) setFunnel(funnelResult)
    else setErrors((current) => ({ ...current, funnel: funnelResult.error === 'COMMERCIAL_ANALYTICS_NOT_READY' ? 'O funil aguarda a migration analítica.' : 'O funil está indisponível para este escopo.' }))
    if (segmentsResult.ok) setSegments(segmentsResult.segments)
    else setErrors((current) => ({ ...current, segments: segmentsResult.error === 'COMMERCIAL_ANALYTICS_NOT_READY' ? 'As versões de segmento aguardam a migration analítica.' : 'As versões de segmento estão indisponíveis para este escopo.' }))
    if (experimentsResult.ok) setExperiments(experimentsResult.experiments)
    else setErrors((current) => ({ ...current, experiments: experimentsResult.error === 'COMMERCIAL_ANALYTICS_NOT_READY' ? 'Os experimentos aguardam a migration analítica.' : 'Os experimentos estão indisponíveis para este escopo.' }))
    setLoading(false)
  }, [from, granularity, to, unit])

  useEffect(() => { void load() }, [load])

  const latestFindingPoints = useMemo(() => Object.entries(quality?.timeSeries.byFinding || {}).map(([findingKey, points]) => ({ findingKey, point: points[points.length - 1] })).filter((item) => item.point), [quality])
  const maxFunnel = Math.max(1, ...(commercialAnalyticsFunnelStages.map((stage) => funnel?.stages?.[stage]?.[state] || 0)))
  const scopeText = quality?.scope.kind === 'unit' ? `Unidades: ${(quality.scope.units || []).join(', ') || 'nenhuma'}` : 'Escopo global autorizado'

  return <section aria-labelledby="commercial-analytics-heading" data-testid="commercial-analytics-panel" className="space-y-4 rounded-2xl border border-slate-800/80 bg-slate-950/55 p-5 shadow-[0_20px_60px_rgba(2,6,23,0.28)]">
    <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between"><div><div className="flex items-center gap-2"><BarChart3 className="h-5 w-5 text-sky-300" /><h2 id="commercial-analytics-heading" className="text-lg font-semibold text-white">Data Analytics de Clientes</h2></div><p className="mt-1 text-sm text-slate-500">Séries de qualidade, funil com janela versionada e drift explicável. Nenhum painel exibe PII.</p></div><div className="flex items-center gap-2 text-xs text-slate-400"><ShieldCheck className="h-4 w-4 text-emerald-300" />{scopeText}<Button size="sm" variant="outline" onClick={() => void load()} disabled={loading}><RefreshCw className={`mr-1.5 h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />Atualizar</Button></div></div>
    <div className="flex flex-wrap items-end gap-2 rounded-xl border border-slate-800/80 bg-slate-900/35 p-3"><label className="text-xs text-slate-400">De<input aria-label="Período inicial da análise" type="date" value={from} onChange={(event) => setFrom(event.target.value)} className="mt-1 block rounded-lg border border-slate-800 bg-slate-950 px-2 py-1.5 text-sm text-slate-100" /></label><label className="text-xs text-slate-400">Até<input aria-label="Período final da análise" type="date" value={to} onChange={(event) => setTo(event.target.value)} className="mt-1 block rounded-lg border border-slate-800 bg-slate-950 px-2 py-1.5 text-sm text-slate-100" /></label><label className="text-xs text-slate-400">Granularidade<select aria-label="Granularidade da série" value={granularity} onChange={(event) => setGranularity(event.target.value as typeof granularity)} className="mt-1 block rounded-lg border border-slate-800 bg-slate-950 px-2 py-1.5 text-sm text-slate-100"><option value="day">Dia</option><option value="week">Semana</option><option value="month">Mês</option></select></label><label className="text-xs text-slate-400">Estado do funil<select aria-label="Estado do funil" value={state} onChange={(event) => setState(event.target.value as typeof state)} className="mt-1 block rounded-lg border border-slate-800 bg-slate-950 px-2 py-1.5 text-sm text-slate-100"><option value="observed">Observada</option><option value="attributed">Atribuída</option><option value="incremental">Incremental</option></select></label><Button size="sm" onClick={() => void load()} disabled={loading}>Aplicar filtros</Button></div>
    <div className="grid gap-4 xl:grid-cols-2">
      <article aria-labelledby="quality-series-heading" className="space-y-3 rounded-xl border border-slate-800/80 bg-slate-900/25 p-4"><div className="flex items-center gap-2"><Database className="h-4 w-4 text-sky-300" /><h3 id="quality-series-heading" className="font-semibold text-white">Qualidade ao longo do tempo</h3></div><PanelState loading={loading && !quality} error={errors.quality} empty={!quality || (!quality.findings.length && !quality.timeSeries.metrics.length)}>{quality ? <><div className="grid gap-2 sm:grid-cols-4"><AnalyticsMetric label="Backlog ativo" value={number(quality.timeSeries.activeFindings)} detail="findings atualmente observados" icon={Database} /><AnalyticsMetric label="SLA vencido" value={number(quality.timeSeries.overdueSla)} detail="fila ativa fora do SLA" icon={Timer} /><AnalyticsMetric label="Reconhecimento" value={quality.timeSeries.timing.timeToRecognitionHours == null ? '—' : `${quality.timeSeries.timing.timeToRecognitionHours}h`} detail="tempo médio até reconhecer" icon={Timer} /><AnalyticsMetric label="Reopen rate" value={percent(quality.timeSeries.reopenRate)} detail="reabertura sobre detecções" icon={RefreshCw} /></div><div className="overflow-x-auto rounded-lg border border-slate-800/70"><table className="w-full text-left text-xs"><caption className="sr-only">Última observação por finding</caption><thead className="bg-white/[0.03] text-slate-500"><tr><th className="p-2">Finding</th><th className="p-2">Data</th><th className="p-2">Observados</th><th className="p-2">Status</th></tr></thead><tbody>{latestFindingPoints.map(({ findingKey, point }) => <tr key={findingKey} className="border-t border-slate-800/60"><td className="p-2 text-slate-200">{findingKey}</td><td className="p-2 text-slate-400">{point?.date || '—'}</td><td className="p-2 text-slate-300">{number(point?.observedCount)}</td><td className="p-2 text-slate-400">{point?.status || '—'}</td></tr>)}</tbody></table></div><div className="grid gap-2 sm:grid-cols-4"><AnalyticsMetric label="Identidade" value={percent(quality.metrics.identity?.coverage)} detail="multi-fonte no escopo" icon={ShieldCheck} /><AnalyticsMetric label="Classificação" value={percent(quality.metrics.salesClassification?.coverage)} detail="itens de venda classificados" icon={BarChart3} /><AnalyticsMetric label="Consentimento" value={percent(quality.metrics.consent?.coverage)} detail={quality.metrics.consent?.available ? 'permissões concedidas' : 'fonte não disponível'} icon={ShieldCheck} /><AnalyticsMetric label="Telefone correlacionado" value={percent(quality.metrics.correlatedPhone?.coverage)} detail="identidades com telefone de origem" icon={Database} /></div></> : null}</PanelState></article>
      <article aria-labelledby="funnel-heading" className="space-y-3 rounded-xl border border-slate-800/80 bg-slate-900/25 p-4"><div className="flex items-center gap-2"><BarChart3 className="h-4 w-4 text-emerald-300" /><h3 id="funnel-heading" className="font-semibold text-white">Funil comercial</h3></div><PanelState loading={loading && !funnel} error={errors.funnel} empty={!funnel || !funnel.dataAvailability.actionRows}>{funnel ? <><p className="text-xs text-slate-500">Janela {funnel.windows.version}: resposta {funnel.windows.responseDays}d · agendamento {funnel.windows.appointmentDays}d · comparecimento {funnel.windows.attendanceDays}d · venda {funnel.windows.saleDays}d.</p><div className="space-y-2" role="list" aria-label="Etapas do funil">{commercialAnalyticsFunnelStages.map((stage) => { const value = funnel.stages[stage]?.[state] || 0; return <div key={stage} role="listitem" className="grid grid-cols-[7rem_1fr_3rem] items-center gap-2 text-xs"><span className="truncate text-slate-400">{stage.replace(/_/g, ' ')}</span><div className="h-2 rounded-full bg-slate-800" role="img" aria-label={`${stage}: ${value}`}><div className="h-2 rounded-full bg-emerald-400/70" style={{ width: `${Math.min(100, (value / maxFunnel) * 100)}%` }} /></div><span className="text-right font-medium text-slate-200">{number(value)}</span></div> })}</div><p className="text-[11px] text-slate-500">Observada, atribuída e incremental são calculadas separadamente; eventos fora da janela não entram na atribuição.</p></> : null}</PanelState></article>
    </div>
    <article aria-labelledby="segments-heading" className="space-y-3 rounded-xl border border-slate-800/80 bg-slate-900/25 p-4"><div className="flex items-center gap-2"><BarChart3 className="h-4 w-4 text-violet-300" /><h3 id="segments-heading" className="font-semibold text-white">Segmentos versionados e drift</h3></div><PanelState loading={loading && !segments.length} error={errors.segments} empty={!segments.length}><div className="overflow-x-auto rounded-lg border border-slate-800/70"><table className="w-full text-left text-xs"><caption className="sr-only">Versões de segmentos e distribuição</caption><thead className="bg-white/[0.03] text-slate-500"><tr><th className="p-2">Segmento</th><th className="p-2">Versão</th><th className="p-2">Critérios</th><th className="p-2">População</th><th className="p-2">Drift</th></tr></thead><tbody>{segments.map((segment) => <tr key={`${segment.key}:${segment.version}`} className="border-t border-slate-800/60"><td className="p-2 text-slate-200">{segment.name}<div className="text-[10px] text-slate-500">{segment.key}</div></td><td className="p-2 text-slate-400">v{segment.version}</td><td className="max-w-72 p-2 text-slate-400">{Object.entries(segment.criteria).map(([key, value]) => `${key}=${String(value)}`).join(' · ') || 'Critério não informado'}</td><td className="p-2 text-slate-300">{number(segment.population)}</td><td className="p-2 text-slate-400">{segment.drift.available ? `${segment.drift.dimensions?.length || 0} dimensão(ões)` : 'Aguardando duas observações'}</td></tr>)}</tbody></table></div></PanelState></article>
    <article aria-labelledby="experiments-heading" className="space-y-3 rounded-xl border border-slate-800/80 bg-slate-900/25 p-4"><div className="flex items-center gap-2"><ShieldCheck className="h-4 w-4 text-amber-300" /><h3 id="experiments-heading" className="font-semibold text-white">Experimentos e holdout</h3></div><PanelState loading={loading && !experiments.length} error={errors.experiments} empty={!experiments.length}><div className="overflow-x-auto rounded-lg border border-slate-800/70"><table className="w-full text-left text-xs"><caption className="sr-only">Experimentos versionados no escopo</caption><thead className="bg-white/[0.03] text-slate-500"><tr><th className="p-2">Experimento</th><th className="p-2">Período</th><th className="p-2">Estado</th><th className="p-2">Amostra</th><th className="p-2">Controle</th><th className="p-2">Tratamento</th></tr></thead><tbody>{experiments.map((experiment) => <tr key={experiment.id} className="border-t border-slate-800/60"><td className="p-2 text-slate-200">{experiment.key} <span className="text-slate-500">v{experiment.version}</span></td><td className="p-2 text-slate-400">{experiment.periodStart} → {experiment.periodEnd}</td><td className="p-2 text-slate-400">{experiment.state}</td><td className="p-2 text-slate-300">{number(experiment.assignments)}</td><td className="p-2 text-slate-300">{number(experiment.controlAssignments)}</td><td className="p-2 text-slate-300">{number(experiment.treatmentAssignments)}</td></tr>)}</tbody></table></div><p className="text-[11px] text-slate-500">Atribuição determinística e persistida; o contato permanece bloqueado durante o holdout. Resultados abaixo do limiar estatístico são sinalizados como amostra insuficiente.</p></PanelState></article>
  </section>
}
