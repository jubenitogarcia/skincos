import { useCallback, useEffect, useMemo, useState } from 'react'
import { BarChart3, RefreshCw, ShieldCheck } from 'lucide-react'
import { Button } from '@/button'
import {
  fetchCommercialAnalyticsAttributionWindows,
  fetchCommercialAnalyticsExperimentMetrics,
  fetchCommercialAnalyticsExperiments,
  fetchCommercialAnalyticsFunnel,
  fetchCommercialAnalyticsQuality,
  fetchCommercialAnalyticsReadiness,
  fetchCommercialAnalyticsSegments,
  type CommercialAnalyticsAttributionWindow,
  type CommercialAnalyticsExperiment,
  type CommercialAnalyticsExperimentMetrics,
  type CommercialAnalyticsFunnel,
  type CommercialAnalyticsQuality,
  type CommercialAnalyticsReadiness,
  type CommercialAnalyticsSegment,
} from '@/atendimentoApi'

const number = new Intl.NumberFormat('pt-BR')
const dateTime = new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short', timeZone: 'America/Sao_Paulo' })
const stageLabels: Record<string, string> = {
  eligible: 'Elegíveis', selected: 'Selecionados', action_created: 'Ação criada', contacted: 'Contato registrado',
  delivered: 'Entregues', responded: 'Responderam', scheduled: 'Agendaram', attended: 'Compareceram',
  purchased: 'Compraram', returned: 'Retornaram',
}

function displayDate(value: string | null | undefined) {
  if (!value) return '—'
  const parsed = new Date(value)
  return Number.isNaN(parsed.getTime()) ? '—' : dateTime.format(parsed)
}

function SafetyBanner() {
  return <div className="mt-3 flex gap-2 rounded-lg border border-emerald-300/20 bg-emerald-500/10 p-3 text-xs text-emerald-100"><ShieldCheck className="mt-0.5 h-4 w-4 shrink-0" /><span><b>Modo de observação e medição:</b> escrita comercial, envio de mensagens, automação e novas escritas de consentimento permanecem desativados. Esta tela não exibe dados de contato ou dados pessoais de clientes.</span></div>
}

function Stat({ label, value, detail }: { label: string; value: string | number; detail?: string }) {
  return <div className="rounded-xl border border-slate-800/80 bg-slate-900/45 p-3"><div className="text-[11px] text-slate-500">{label}</div><div className="mt-1 text-base font-semibold text-slate-100">{value}</div>{detail ? <div className="mt-1 text-[11px] text-slate-500">{detail}</div> : null}</div>
}

function Funnel({ data }: { data: CommercialAnalyticsFunnel | null }) {
  if (!data) return <div className="rounded-xl border border-slate-800/80 bg-slate-950/45 p-4 text-sm text-slate-500">O funil será exibido quando a projeção estiver disponível.</div>
  return <div className="rounded-xl border border-slate-800/80 bg-slate-950/45 p-4"><div className="flex flex-wrap items-start justify-between gap-2"><div><h3 className="font-medium text-slate-100">Funil comercial observado</h3><p className="mt-1 text-xs text-slate-500">Atribuição só é calculada dentro de uma janela versionada. Entrega permanece zero sem provedor de envio.</p></div>{data.attributionWindow ? <span className="rounded-full border border-sky-300/20 bg-sky-500/10 px-2 py-1 text-[11px] text-sky-100">Janela {data.attributionWindow.key} r{data.attributionWindow.revision}</span> : <span className="rounded-full border border-amber-300/20 bg-amber-500/10 px-2 py-1 text-[11px] text-amber-100">Sem janela de atribuição</span>}</div><div className="mt-4 grid gap-2 sm:grid-cols-2 xl:grid-cols-5">{Object.entries(data.observed).map(([stage, value]) => <Stat key={stage} label={stageLabels[stage] || stage} value={number.format(value)} detail={data.attributed ? `Atribuídos: ${number.format(data.attributed[stage] || 0)}` : undefined} />)}</div></div>
}

function SegmentTable({ segments }: { segments: CommercialAnalyticsSegment[] }) {
  return <div className="overflow-x-auto rounded-xl border border-slate-800/80"><table className="min-w-full text-left text-xs"><thead className="bg-slate-900/80 text-slate-400"><tr><th className="px-3 py-2">Segmento</th><th className="px-3 py-2">Unidade</th><th className="px-3 py-2">Versão</th><th className="px-3 py-2">População</th><th className="px-3 py-2">Snapshot</th></tr></thead><tbody>{segments.length ? segments.map((segment) => <tr key={segment.id} className="border-t border-slate-800/80 text-slate-200"><td className="px-3 py-2"><div className="font-medium">{segment.name}</div><div className="text-[11px] text-slate-500">{segment.key}</div></td><td className="px-3 py-2">{segment.unit}</td><td className="px-3 py-2">r{segment.revision} · v{segment.currentVersion ?? '—'}</td><td className="px-3 py-2">{number.format(segment.populationCount)}</td><td className="px-3 py-2">{displayDate(segment.snapshotAt)}</td></tr>) : <tr><td colSpan={5} className="px-3 py-5 text-slate-500">Nenhuma definição de segmento permitida neste escopo.</td></tr>}</tbody></table></div>
}

function ExperimentTable({ experiments, windows }: { experiments: CommercialAnalyticsExperiment[]; windows: CommercialAnalyticsAttributionWindow[] }) {
  const windowById = useMemo(() => new Map(windows.map((window) => [window.id, window])), [windows])
  return <div className="overflow-x-auto rounded-xl border border-slate-800/80"><table className="min-w-full text-left text-xs"><thead className="bg-slate-900/80 text-slate-400"><tr><th className="px-3 py-2">Experimento</th><th className="px-3 py-2">Estado</th><th className="px-3 py-2">Coorte</th><th className="px-3 py-2">Controle</th><th className="px-3 py-2">Janela</th></tr></thead><tbody>{experiments.length ? experiments.map((experiment) => <tr key={experiment.id} className="border-t border-slate-800/80 text-slate-200"><td className="px-3 py-2"><div className="font-medium">{experiment.name}</div><div className="text-[11px] text-slate-500">{experiment.unit} · r{experiment.revision}</div></td><td className="px-3 py-2">{experiment.state}</td><td className="px-3 py-2">{number.format(experiment.assignments)} <span className="text-slate-500">({number.format(experiment.excludedAssignments)} excluídos)</span></td><td className="px-3 py-2">{experiment.controlGroupPercent}%</td><td className="px-3 py-2">{windowById.get(experiment.attributionWindowId)?.key || 'Retida'}</td></tr>) : <tr><td colSpan={5} className="px-3 py-5 text-slate-500">Nenhum experimento persistido neste escopo.</td></tr>}</tbody></table></div>
}

function ExperimentImpact({ metrics }: { metrics: CommercialAnalyticsExperimentMetrics | null }) {
  if (!metrics) return null
  const lift = metrics.incremental.conversionLift == null ? '—' : `${(metrics.incremental.conversionLift * 100).toFixed(1)} p.p.`
  const revenue = metrics.incremental.incrementalRevenue == null ? '—' : new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(metrics.incremental.incrementalRevenue)
  return <div className="mt-4 rounded-xl border border-slate-800/80 bg-slate-950/45 p-4"><h3 className="font-medium text-slate-100">Impacto incremental do experimento</h3><p className="mt-1 text-xs text-slate-500">Coorte {metrics.experiment.name} · janela {metrics.attribution.key}. Receita e conversões são limitadas à janela versionada.</p><div className="mt-3 grid gap-2 sm:grid-cols-3"><Stat label="Lift atribuído" value={lift} detail={metrics.incremental.adequateSample ? 'IC 95% disponível' : 'Amostra ainda insuficiente'} /><Stat label="Conversões incrementais" value={metrics.incremental.incrementalConversions == null ? '—' : number.format(metrics.incremental.incrementalConversions)} detail={`Tratamento: ${number.format(metrics.attributed.treatment.conversions)} · Controle: ${number.format(metrics.attributed.control.conversions)}`} /><Stat label="Receita incremental" value={revenue} detail={metrics.incremental.warning || 'Estimativa atribuída'} /></div></div>
}

export function CommercialAnalyticsPanel({ units }: { units: Array<{ slug: string; name: string }> }) {
  const [unit, setUnit] = useState('all')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [readiness, setReadiness] = useState<CommercialAnalyticsReadiness | null>(null)
  const [quality, setQuality] = useState<CommercialAnalyticsQuality | null>(null)
  const [funnel, setFunnel] = useState<CommercialAnalyticsFunnel | null>(null)
  const [segments, setSegments] = useState<CommercialAnalyticsSegment[]>([])
  const [windows, setWindows] = useState<CommercialAnalyticsAttributionWindow[]>([])
  const [experiments, setExperiments] = useState<CommercialAnalyticsExperiment[]>([])
  const [experimentMetrics, setExperimentMetrics] = useState<CommercialAnalyticsExperimentMetrics | null>(null)
  const load = useCallback(async () => {
    setBusy(true); setError('')
    const filters = unit === 'all' ? {} : { unit }
    const [nextReadiness, nextQuality, nextFunnel, nextSegments, nextWindows, nextExperiments] = await Promise.all([
      fetchCommercialAnalyticsReadiness(), fetchCommercialAnalyticsQuality(filters), fetchCommercialAnalyticsFunnel(filters),
      fetchCommercialAnalyticsSegments(filters), fetchCommercialAnalyticsAttributionWindows(filters), fetchCommercialAnalyticsExperiments(filters),
    ])
    if (!nextReadiness.ok) setError(nextReadiness.error || 'A readiness de Analytics não está disponível neste ambiente.')
    else setReadiness(nextReadiness)
    if (nextQuality.ok) setQuality(nextQuality)
    else if (!nextReadiness.ok) setQuality(null)
    if (nextFunnel.ok) setFunnel(nextFunnel)
    else setFunnel(null)
    setSegments(nextSegments.ok ? nextSegments.segments : [])
    setWindows(nextWindows.ok ? nextWindows.windows : [])
    setExperiments(nextExperiments.ok ? nextExperiments.experiments : [])
    if (nextExperiments.ok && nextExperiments.experiments[0]) {
      const metrics = await fetchCommercialAnalyticsExperimentMetrics(nextExperiments.experiments[0].id)
      setExperimentMetrics(metrics.ok ? metrics : null)
    } else setExperimentMetrics(null)
    setBusy(false)
  }, [unit])
  useEffect(() => { void load() }, [load])
  const staleSources = quality?.freshness.filter((source) => !source.snapshotComplete || (source.freshnessHours != null && source.freshnessHours >= 24)).length || 0
  return <section aria-labelledby="commercial-analytics-heading" className="rounded-2xl border border-slate-800/80 bg-slate-950/55 p-5 shadow-[0_20px_60px_rgba(2,6,23,0.28)]"><div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between"><div><div className="flex items-center gap-2"><BarChart3 className="h-5 w-5 text-sky-200" /><h2 id="commercial-analytics-heading" className="text-lg font-semibold text-white">Analytics de Clientes</h2></div><p className="mt-1 text-sm text-slate-500">Séries de qualidade, funil, segmentos e experimentos com coortes persistidas — sem dados de contato.</p></div><div className="flex gap-2"><select aria-label="Unidade da análise" value={unit} onChange={(event) => setUnit(event.target.value)} className="rounded-lg border border-slate-800 bg-slate-900 px-3 py-2 text-sm text-slate-100"><option value="all">Todas as unidades permitidas</option>{units.map((item) => <option key={item.slug} value={item.slug}>{item.name}</option>)}</select><Button size="sm" variant="outline" onClick={() => void load()} disabled={busy}><RefreshCw className={`mr-2 h-4 w-4 ${busy ? 'animate-spin' : ''}`} />Atualizar</Button></div></div><SafetyBanner />{error ? <div role="alert" className="mt-3 rounded-lg border border-amber-300/25 bg-amber-500/10 p-3 text-sm text-amber-100">{error}</div> : null}<div className="mt-4 grid gap-2 sm:grid-cols-2 xl:grid-cols-4"><Stat label="Prontidão" value={readiness?.ready ? 'Pronto' : 'Fail-closed'} detail={readiness?.migrationId || 'Migration pendente'} /><Stat label="Cobertura de identidades" value={number.format(quality?.coverage.reduce((sum, item) => sum + item.identities, 0) || 0)} detail="Agregado apenas no escopo permitido" /><Stat label="Fontes a revisar" value={number.format(staleSources)} detail="Snapshot incompleto ou 24h+" /><Stat label="Experimentos" value={number.format(experiments.length)} detail="Coortes persistidas e auditáveis" /></div>{quality?.partial ? <div role="status" className="mt-3 rounded-lg border border-sky-300/20 bg-sky-500/10 p-3 text-xs text-sky-100">No escopo de unidade, a fila global e o ledger de fontes não são expostos. A cobertura abaixo foi derivada somente da unidade autorizada.</div> : null}<div className="mt-4 grid gap-4 xl:grid-cols-2"><Funnel data={funnel} /><div className="rounded-xl border border-slate-800/80 bg-slate-950/45 p-4"><h3 className="font-medium text-slate-100">Qualidade e freshness</h3><div className="mt-3 grid gap-2 sm:grid-cols-2">{quality?.coverage.map((item) => <Stat key={item.unit} label={item.unit} value={`${number.format(item.confirmedIdentityCount)}/${number.format(item.identities)}`} detail={`${number.format(item.permissionCount)} permissões · ${number.format(item.phoneCorrelatedCount)} telefones correlacionados`} />) || <p className="text-sm text-slate-500">Sem agregados disponíveis.</p>}</div>{quality && !quality.partial ? <div className="mt-3 text-xs text-slate-500">{quality.findings.length} finding(s), {quality.series.length} ponto(s) histórico(s) e {quality.freshness.length} fonte(s) observada(s).</div> : null}</div></div><ExperimentImpact metrics={experimentMetrics} /><div className="mt-4"><h3 className="mb-2 font-medium text-slate-100">Segmentos versionados</h3><SegmentTable segments={segments} /></div><div className="mt-4"><h3 className="mb-2 font-medium text-slate-100">Experimentos e janelas</h3><ExperimentTable experiments={experiments} windows={windows} /></div></section>
}
