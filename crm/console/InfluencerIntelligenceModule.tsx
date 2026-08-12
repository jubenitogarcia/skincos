import React from 'react'
import { AlertTriangle, CheckCircle2, Database, Plus, RefreshCw, Search, ShieldCheck, Users } from 'lucide-react'
import { Badge } from '@/badge'
import { Button } from '@/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/card'
import { Input } from '@/input'
import { useAuth } from '@/contexts'
import { createInfluencerIntelligenceApi, InfluencerIntelligenceApiError } from '@/influencerIntelligenceApi'
import {
  INFLUENCER_INTELLIGENCE_FEATURE_FLAG,
  INFLUENCER_INTELLIGENCE_GRANT,
  type InfluencerComparison,
  type InfluencerCreatorDashboard,
  type InfluencerCreatorSummary,
  type InfluencerFreshness,
  type InfluencerIntelligenceClient,
  type InfluencerMetric,
  type InfluencerScoreComponent,
} from '@/influencerIntelligenceTypes'

type PanelProps = {
  client?: InfluencerIntelligenceClient
  enabled?: boolean
  granted?: boolean
}

function metricIsAvailable<T>(metric: InfluencerMetric<T> | null | undefined): metric is InfluencerMetric<T> {
  return Boolean(metric && metric.evidenceState !== 'unavailable' && metric.value !== null && metric.value !== undefined)
}

function formatMetric<T>(metric: InfluencerMetric<T> | null | undefined, mode: 'number' | 'ratio' | 'date' = 'number'): string {
  if (!metricIsAvailable(metric)) return 'Indisponível'
  if (mode === 'date') return String(metric.value)
  if (typeof metric.value !== 'number') return String(metric.value)
  if (mode === 'ratio') return `${(metric.value * 100).toLocaleString('pt-BR', { maximumFractionDigits: 2 })}%`
  return metric.value.toLocaleString('pt-BR', { maximumFractionDigits: 2 })
}

function formatScore(value: number | null | undefined): string {
  return typeof value === 'number' && Number.isFinite(value) ? value.toLocaleString('pt-BR', { maximumFractionDigits: 1 }) : 'Indisponível'
}

function safeFreshness(value: InfluencerFreshness | undefined): InfluencerFreshness {
  return value === 'fresh' || value === 'stale' || value === 'unknown' ? value : 'unknown'
}

function stateLabel(value: string | undefined): string {
  if (value === 'observed') return 'observed'
  if (value === 'derived') return 'derived'
  if (value === 'inferred') return 'inferred'
  return 'unavailable'
}

function freshnessLabel(value: InfluencerFreshness | undefined): string {
  const freshness = safeFreshness(value)
  if (freshness === 'fresh') return 'fresh'
  if (freshness === 'stale') return 'stale'
  return 'unknown'
}

function metricBadge(metric: InfluencerMetric<unknown> | null | undefined) {
  if (!metric || metric.evidenceState === 'unavailable' || metric.value === null || metric.value === undefined) {
    return <Badge variant="secondary">unavailable</Badge>
  }
  const variant = metric.evidenceState === 'inferred' ? 'warning' : metric.evidenceState === 'derived' ? 'secondary' : 'success'
  return <Badge variant={variant}>{stateLabel(metric.evidenceState)} · {freshnessLabel(metric.freshness)}</Badge>
}

function MetricMeta({ metric }: { metric: InfluencerMetric<unknown> | null | undefined }) {
  if (!metric) return <div className="mt-1 text-[11px] text-slate-500">Sem envelope de evidência.</div>
  return (
    <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[11px] text-slate-400">
      {metricBadge(metric)}
      {metric.provider ? <span>provider: {metric.provider}</span> : null}
      {metric.retrievedAt ? <span>• {new Date(metric.retrievedAt).toLocaleString('pt-BR')}</span> : null}
    </div>
  )
}

function MetricCard({ label, metric, mode = 'number' }: { label: string; metric: InfluencerMetric<unknown> | null | undefined; mode?: 'number' | 'ratio' }) {
  return (
    <Card className="border-white/10 bg-white/[0.04]">
      <CardContent className="p-4">
        <div className="text-xs uppercase tracking-[0.12em] text-slate-400">{label}</div>
        <div className="mt-2 text-2xl font-semibold text-white">{formatMetric(metric, mode)}</div>
        <MetricMeta metric={metric} />
      </CardContent>
    </Card>
  )
}

function ScoreCard({ label, value, detail }: { label: string; value: number | null | undefined; detail?: string }) {
  const available = typeof value === 'number' && Number.isFinite(value)
  return (
    <Card className="border-white/10 bg-white/[0.04]">
      <CardContent className="p-4">
        <div className="text-xs uppercase tracking-[0.12em] text-slate-400">{label}</div>
        <div className="mt-2 text-3xl font-semibold text-white">{formatScore(value)}{available ? <span className="ml-1 text-sm text-slate-400">/100</span> : null}</div>
        {detail ? <div className="mt-1 text-xs text-slate-400">{detail}</div> : null}
      </CardContent>
    </Card>
  )
}

function CreatorIdentity({ creator }: { creator: InfluencerCreatorSummary }) {
  return (
    <div className="min-w-0">
      <div className="truncate text-sm font-semibold text-white">{creator.handle ? `@${creator.handle.replace(/^@/, '')}` : creator.creatorKey}</div>
      <div className="truncate text-xs text-slate-400">{creator.displayName || 'Nome público indisponível'} · {creator.registryState}</div>
    </div>
  )
}

function ComponentTable({ components }: { components: InfluencerScoreComponent[] }) {
  return (
    <div className="overflow-x-auto rounded-xl border border-white/10">
      <table className="min-w-full text-left text-sm">
        <thead className="bg-black/20 text-xs uppercase tracking-[0.08em] text-slate-400">
          <tr>
            <th className="px-3 py-2">Componente</th>
            <th className="px-3 py-2">Score</th>
            <th className="px-3 py-2">Confidence</th>
            <th className="px-3 py-2">Explicação</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-white/5">
          {components.map((component) => (
            <tr key={component.key}>
              <td className="px-3 py-3 text-slate-200">{component.label}</td>
              <td className="px-3 py-3 text-white">{formatScore(component.score)}{component.score === null ? null : ' / 100'}<div className="mt-1">{metricBadge({ value: component.score, evidenceState: component.evidenceState, freshness: 'unknown', provider: null, retrievedAt: null, limitations: [] })}</div></td>
              <td className="px-3 py-3 text-slate-300">{formatScore(component.confidence)} / 100</td>
              <td className="max-w-xl px-3 py-3 text-xs leading-relaxed text-slate-400">{component.explanation || 'Explicação indisponível.'}</td>
            </tr>
          ))}
          {!components.length ? <tr><td colSpan={4} className="px-3 py-5 text-center text-slate-500">Componentes ainda não calculados.</td></tr> : null}
        </tbody>
      </table>
    </div>
  )
}

function CreatorDashboardView({ dashboard }: { dashboard: InfluencerCreatorDashboard }) {
  const score = dashboard.score
  return (
    <div className="space-y-4" data-testid="influencer-dashboard">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="text-xs uppercase tracking-[0.2em] text-sky-300">Creator selecionado</div>
          <h2 className="mt-1 text-2xl font-semibold text-white">{dashboard.creator.handle ? `@${dashboard.creator.handle.replace(/^@/, '')}` : dashboard.creator.creatorKey}</h2>
          <p className="mt-1 text-sm text-slate-400">Dados do serviço interno, sem acesso direto a provider.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="secondary">{score.algorithmVersion || 'score não calculado'}</Badge>
          {score.weightsVersion ? <Badge variant="secondary">{score.weightsVersion}</Badge> : null}
          <Badge variant={score.evidenceState === 'unavailable' ? 'secondary' : 'success'}>{stateLabel(score.evidenceState)}</Badge>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <ScoreCard label="Influencer Score" value={score.overallScore} detail={score.calculatedAt ? `calculado em ${new Date(score.calculatedAt).toLocaleString('pt-BR')}` : 'Sem cálculo persistido'} />
        <ScoreCard label="Confidence" value={score.confidenceScore} detail="Baseado em histórico, posts, freshness e cobertura." />
        <ScoreCard label="Data Coverage" value={score.dataCoverage} detail={`${dashboard.coverage.availableMetrics}/${dashboard.coverage.expectedMetrics} métricas esperadas`} />
      </div>

      <div className="grid grid-cols-1 gap-3 md:grid-cols-4">
        <MetricCard label="Followers" metric={dashboard.profile.followers} />
        <MetricCard label="Following" metric={dashboard.profile.following} />
        <MetricCard label="Posts" metric={dashboard.profile.mediaCount} />
        <MetricCard label="Engagement rate" metric={dashboard.analysis.engagementRate} mode="ratio" />
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1.25fr)_minmax(20rem,0.75fr)]">
        <Card className="border-white/10 bg-white/[0.03]">
          <CardHeader><CardTitle className="text-base text-white">Component scores</CardTitle></CardHeader>
          <CardContent><ComponentTable components={score.components} /></CardContent>
        </Card>
        <Card className="border-white/10 bg-white/[0.03]">
          <CardHeader><CardTitle className="text-base text-white">Analytics estruturado</CardTitle></CardHeader>
          <CardContent className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-1">
            <MetricCard label="Cadência de publicação" metric={dashboard.analysis.postingCadence} />
            <MetricCard label="Mediana de likes" metric={dashboard.analysis.medianLikes} />
            <MetricCard label="Mediana de views" metric={dashboard.analysis.medianViews} />
            <MetricCard label="Velocidade de crescimento" metric={dashboard.analysis.growthVelocity} />
            <MetricCard label="Aceleração de crescimento" metric={dashboard.analysis.growthAcceleration} />
            <MetricCard label="Volatilidade" metric={dashboard.analysis.volatility} />
          </CardContent>
        </Card>
      </div>

      {dashboard.analysis.warnings.length || score.limitations.length ? (
        <Card className="border-amber-300/20 bg-amber-500/[0.06]">
          <CardHeader><CardTitle className="flex items-center gap-2 text-base text-amber-100"><AlertTriangle className="size-4" />Warnings e limitações</CardTitle></CardHeader>
          <CardContent className="space-y-2 text-sm text-amber-50/80">
            {[...dashboard.analysis.warnings, ...score.limitations].map((warning, index) => <div key={`${warning}-${index}`}>• {warning}</div>)}
          </CardContent>
        </Card>
      ) : null}

      <Card className="border-white/10 bg-white/[0.03]">
        <CardHeader><CardTitle className="text-base text-white">Histórico de followers e engagement</CardTitle></CardHeader>
        <CardContent>
          <div className="overflow-x-auto rounded-xl border border-white/10">
            <table className="min-w-full text-left text-sm">
              <thead className="bg-black/20 text-xs uppercase tracking-[0.08em] text-slate-400"><tr><th className="px-3 py-2">Data</th><th className="px-3 py-2">Followers</th><th className="px-3 py-2">Posts</th><th className="px-3 py-2">Engagement</th></tr></thead>
              <tbody className="divide-y divide-white/5">
                {dashboard.history.map((point) => <tr key={point.observedAt}><td className="px-3 py-3 text-slate-300">{new Date(point.observedAt).toLocaleDateString('pt-BR')}</td><td className="px-3 py-3">{formatMetric(point.followers)}<MetricMeta metric={point.followers} /></td><td className="px-3 py-3">{formatMetric(point.mediaCount)}<MetricMeta metric={point.mediaCount} /></td><td className="px-3 py-3">{formatMetric(point.engagementRate, 'ratio')}<MetricMeta metric={point.engagementRate} /></td></tr>)}
                {!dashboard.history.length ? <tr><td colSpan={4} className="px-3 py-5 text-center text-slate-500">Histórico ainda não disponível.</td></tr> : null}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      <Card className="border-white/10 bg-white/[0.03]">
        <CardHeader><CardTitle className="text-base text-white">Mídia recente</CardTitle></CardHeader>
        <CardContent>
          <div className="overflow-x-auto rounded-xl border border-white/10">
            <table className="min-w-full text-left text-sm">
              <thead className="bg-black/20 text-xs uppercase tracking-[0.08em] text-slate-400"><tr><th className="px-3 py-2">Publicação</th><th className="px-3 py-2">Formato</th><th className="px-3 py-2">Likes</th><th className="px-3 py-2">Comentários</th><th className="px-3 py-2">Views/reach</th><th className="px-3 py-2">Sinal</th></tr></thead>
              <tbody className="divide-y divide-white/5">
                {dashboard.media.map((row) => <tr key={row.mediaKey}><td className="px-3 py-3 text-slate-300">{row.publishedAt ? new Date(row.publishedAt).toLocaleDateString('pt-BR') : 'Indisponível'}</td><td className="px-3 py-3 text-slate-300">{row.format}</td><td className="px-3 py-3">{formatMetric(row.likes)}<MetricMeta metric={row.likes} /></td><td className="px-3 py-3">{formatMetric(row.comments)}<MetricMeta metric={row.comments} /></td><td className="px-3 py-3">{formatMetric(row.views)}<MetricMeta metric={row.views} /><div className="mt-1 text-xs text-slate-500">reach: {formatMetric(row.reach)}</div></td><td className="px-3 py-3">{row.outlier.value === true ? <Badge variant="warning">outlier sinalizado</Badge> : row.outlier.evidenceState === 'unavailable' ? <Badge variant="secondary">sem classificação</Badge> : <Badge variant="secondary">regular</Badge>}</td></tr>)}
                {!dashboard.media.length ? <tr><td colSpan={6} className="px-3 py-5 text-center text-slate-500">Mídia recente indisponível.</td></tr> : null}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      <Card className="border-white/10 bg-white/[0.03]">
        <CardHeader><CardTitle className="flex items-center gap-2 text-base text-white"><Database className="size-4" />Proveniência e freshness</CardTitle></CardHeader>
        <CardContent className="space-y-3 text-sm">
          <div className="flex flex-wrap gap-2"><Badge variant="secondary">coverage: {(dashboard.coverage.ratio * 100).toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%</Badge><Badge variant={dashboard.coverage.freshness === 'stale' ? 'warning' : 'secondary'}>{freshnessLabel(dashboard.coverage.freshness)}</Badge></div>
          {dashboard.coverage.limitations.map((item, index) => <div key={`${item}-${index}`} className="text-xs text-slate-400">• {item}</div>)}
          <div className="grid gap-2 md:grid-cols-2">
            {dashboard.provenance.map((item, index) => <div key={`${item.sourceRef}-${index}`} className="rounded-lg border border-white/10 bg-black/10 p-3 text-xs text-slate-400"><div className="text-slate-200">{item.sourceType} · {item.provider || 'provider indisponível'}</div><div className="mt-1">{stateLabel(item.evidenceState)} · {item.observedAt ? new Date(item.observedAt).toLocaleString('pt-BR') : 'observed_at indisponível'}</div><div className="mt-1 break-all">ref: {item.sourceRef}</div></div>)}
          </div>
        </CardContent>
      </Card>
    </div>
  )
}

function ComparisonTable({ comparison }: { comparison: InfluencerComparison }) {
  return (
    <div className="space-y-3" data-testid="influencer-comparison">
      <div className="overflow-x-auto rounded-xl border border-white/10">
        <table className="min-w-full text-left text-sm">
          <thead className="bg-black/20 text-xs uppercase tracking-[0.08em] text-slate-400"><tr><th className="px-3 py-2">Creator</th><th className="px-3 py-2">Score</th><th className="px-3 py-2">Confidence</th><th className="px-3 py-2">Coverage</th><th className="px-3 py-2">Engagement</th><th className="px-3 py-2">Growth</th></tr></thead>
          <tbody className="divide-y divide-white/5">
            {comparison.creators.map((row) => <tr key={row.creator.creatorKey}><td className="px-3 py-3"><CreatorIdentity creator={row.creator} /></td><td className="px-3 py-3">{formatMetric(row.overallScore)}<MetricMeta metric={row.overallScore} /></td><td className="px-3 py-3">{formatMetric(row.confidence)}<MetricMeta metric={row.confidence} /></td><td className="px-3 py-3">{formatMetric(row.dataCoverage)}<MetricMeta metric={row.dataCoverage} /></td><td className="px-3 py-3">{formatMetric(row.engagementRate, 'ratio')}<MetricMeta metric={row.engagementRate} /></td><td className="px-3 py-3">{formatMetric(row.growthVelocity)}<MetricMeta metric={row.growthVelocity} /></td></tr>)}
          </tbody>
        </table>
      </div>
      {comparison.limitations.map((item, index) => <div key={`${item}-${index}`} className="text-xs text-slate-400">• {item}</div>)}
    </div>
  )
}

function getUiError(error: unknown): string {
  if (error instanceof InfluencerIntelligenceApiError) {
    if (error.code === 'GRANT_REQUIRED' || error.status === 403) return 'A permissão do módulo não está disponível para esta sessão.'
    if (error.code === 'TIMEOUT') return 'A consulta excedeu o tempo limite. Nenhuma coleta foi iniciada.'
    if (error.code === 'NOT_FOUND' || error.status === 404) return 'Creator ou análise não encontrada.'
    if (error.code === 'UNAVAILABLE' || error.status === 503) return 'A análise ainda não está disponível neste ambiente.'
  }
  return 'Não foi possível consultar o serviço interno. Nenhum valor foi inferido.'
}

export function InfluencerIntelligencePanel({ client = createInfluencerIntelligenceApi(), enabled = true, granted = true }: PanelProps) {
  const [query, setQuery] = React.useState('')
  const [results, setResults] = React.useState<InfluencerCreatorSummary[]>([])
  const [selectedKeys, setSelectedKeys] = React.useState<string[]>([])
  const [dashboard, setDashboard] = React.useState<InfluencerCreatorDashboard | null>(null)
  const [comparison, setComparison] = React.useState<InfluencerComparison | null>(null)
  const [loading, setLoading] = React.useState(false)
  const [notice, setNotice] = React.useState('')
  const [error, setError] = React.useState('')

  const search = React.useCallback(async () => {
    setLoading(true)
    setError('')
    setNotice('')
    try {
      const response = await client.searchCreators(query)
      setResults(response.creators)
      setNotice(response.creators.length ? `${response.creators.length} creator(es) encontrado(s).` : 'Nenhum creator encontrado.')
    } catch (caught) {
      setResults([])
      setError(getUiError(caught))
    } finally {
      setLoading(false)
    }
  }, [client, query])

  const openCreator = React.useCallback(async (creatorKey: string) => {
    setLoading(true)
    setError('')
    setNotice('')
    setComparison(null)
    try {
      setDashboard(await client.getCreatorDashboard(creatorKey))
      setSelectedKeys((current) => current.includes(creatorKey) ? current : [...current, creatorKey].slice(-20))
    } catch (caught) {
      setDashboard(null)
      setError(getUiError(caught))
    } finally {
      setLoading(false)
    }
  }, [client])

  const addCreator = React.useCallback(async (handle: string) => {
    setLoading(true)
    setError('')
    setNotice('')
    try {
      const creator = await client.addCreator(handle)
      setNotice(`Creator ${creator.handle ? `@${creator.handle}` : creator.creatorKey} registrado no serviço interno.`)
      setResults((current) => current.some((item) => item.creatorKey === creator.creatorKey) ? current : [creator, ...current])
      await openCreator(creator.creatorKey)
    } catch (caught) {
      setError(getUiError(caught))
    } finally {
      setLoading(false)
    }
  }, [client, openCreator])

  const compare = React.useCallback(async () => {
    if (selectedKeys.length < 2) return
    setLoading(true)
    setError('')
    try {
      setComparison(await client.compareCreators(selectedKeys))
    } catch (caught) {
      setComparison(null)
      setError(getUiError(caught))
    } finally {
      setLoading(false)
    }
  }, [client, selectedKeys])

  if (!enabled || !granted) {
    return (
      <section className="mx-auto max-w-4xl rounded-2xl border border-amber-300/20 bg-amber-500/[0.06] p-6" data-testid="influencer-module-off">
        <div className="flex items-start gap-3"><ShieldCheck className="mt-0.5 size-5 text-amber-200" /><div><h1 className="text-lg font-semibold text-amber-100">Influencer Intelligence desligado</h1><p className="mt-2 text-sm leading-relaxed text-amber-50/75">O módulo exige a flag e o grant server-side. Nenhum provider, dado ou workflow é acessado enquanto esses gates não estiverem ativos.</p></div></div>
      </section>
    )
  }

  return (
    <main className="mx-auto max-w-[1240px] space-y-5" data-testid="influencer-intelligence-module">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div><div className="text-xs uppercase tracking-[0.2em] text-sky-300">Social · leitura analítica</div><h1 className="mt-1 text-2xl font-semibold text-white">Influencer Intelligence</h1><p className="mt-1 max-w-3xl text-sm text-slate-400">Compare creators com evidência, freshness, confidence e cobertura visíveis. A tela consome somente o serviço interno.</p></div>
        <div className="flex items-center gap-2"><Badge variant="secondary"><Users className="mr-1 size-3" />somente leitura</Badge><Badge variant="secondary">official-first</Badge></div>
      </header>

      <Card className="border-white/10 bg-white/[0.03]">
        <CardContent className="p-4">
          <form className="flex flex-col gap-2 sm:flex-row" onSubmit={(event) => { event.preventDefault(); void search() }}>
            <div className="relative min-w-0 flex-1"><Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-slate-500" /><Input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Buscar creator por handle ou chave aprovada" aria-label="Buscar creator" className="pl-9" maxLength={80} /></div>
            <Button type="submit" disabled={loading}><Search className="size-4" />{loading ? 'Consultando…' : 'Buscar'}</Button>
            <Button type="button" variant="outline" onClick={() => { setQuery(''); setResults([]); setDashboard(null); setComparison(null); setError(''); setNotice('') }} disabled={loading}>Limpar</Button>
          </form>
          <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-slate-400"><Database className="size-3.5" />A busca não dispara scraping ou snapshot. O cadastro apenas registra a intenção no serviço interno.</div>
        </CardContent>
      </Card>

      {notice || error ? <div role="status" aria-live="polite" className={`rounded-xl border p-3 text-sm ${error ? 'border-rose-300/20 bg-rose-500/[0.06] text-rose-100' : 'border-emerald-300/20 bg-emerald-500/[0.06] text-emerald-100'}`}>{error || notice}</div> : null}

      {results.length ? <Card className="border-white/10 bg-white/[0.03]" data-testid="influencer-search-results"><CardHeader><CardTitle className="text-base text-white">Creators encontrados</CardTitle></CardHeader><CardContent className="space-y-2">{results.map((creator) => <div key={creator.creatorKey} className="flex flex-wrap items-center gap-3 rounded-xl border border-white/10 bg-black/10 p-3"><input type="checkbox" aria-label={`Selecionar ${creator.handle ? `@${creator.handle}` : creator.creatorKey}`} checked={selectedKeys.includes(creator.creatorKey)} onChange={(event) => setSelectedKeys((current) => event.target.checked ? [...new Set([...current, creator.creatorKey])].slice(-20) : current.filter((key) => key !== creator.creatorKey))} /><CreatorIdentity creator={creator} /><div className="ml-auto flex flex-wrap gap-2"><Button size="sm" variant="outline" onClick={() => void openCreator(creator.creatorKey)} disabled={loading}>Ver análise</Button><Button size="sm" onClick={() => void addCreator(creator.handle || creator.creatorKey)} disabled={loading || creator.registryState !== 'candidate'}><Plus className="size-3.5" />Adicionar creator</Button></div></div>)}<div className="flex flex-wrap items-center justify-between gap-2 border-t border-white/10 pt-3"><span className="text-xs text-slate-400">{selectedKeys.length} selecionado(s) · máximo 20</span><Button size="sm" onClick={() => void compare()} disabled={loading || selectedKeys.length < 2}><Users className="size-3.5" />Comparar selecionados</Button></div></CardContent></Card> : null}

      {comparison ? <ComparisonTable comparison={comparison} /> : null}
      {loading && !dashboard ? <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-8 text-center text-sm text-slate-400"><RefreshCw className="mx-auto mb-2 size-5 animate-spin" />Consultando o serviço interno…</div> : null}
      {dashboard ? <CreatorDashboardView dashboard={dashboard} /> : !loading && !results.length ? <div className="rounded-2xl border border-dashed border-white/10 bg-white/[0.02] p-10 text-center text-sm text-slate-500">Busque um creator para visualizar uma análise versionada. Sem análise, os valores permanecem indisponíveis.</div> : null}
      <div className="flex items-center gap-2 text-xs text-slate-500"><CheckCircle2 className="size-3.5" />Sem follow, like, post, DM, publicação ou automação de engagement.</div>
    </main>
  )
}

export function InfluencerIntelligenceModule() {
  const { user } = useAuth()
  const enabled = user?.featureFlags?.[INFLUENCER_INTELLIGENCE_FEATURE_FLAG] === true
  const granted = Array.isArray(user?.grants) && user.grants.includes(INFLUENCER_INTELLIGENCE_GRANT)
  return <InfluencerIntelligencePanel enabled={enabled} granted={granted} />
}

export const __testables = Object.freeze({ formatMetric, formatScore, getUiError, metricIsAvailable })
