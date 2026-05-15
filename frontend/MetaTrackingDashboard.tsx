import { useEffect, useMemo, useState } from 'react'
import { format, subDays } from 'date-fns'
import { ptBR } from 'date-fns/locale'
import { Badge } from '@/badge'
import { Button } from '@/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/card'
import { metaAdsApi } from '@/metaAdsApi'
import type { MetaAdsReportCampaign, MetaAdsReportResponse } from '@/metaAdsTypes'
import { ChartBar, CheckCircle, CirclesThreePlus, LinkBreak, Spinner, Target, WarningCircle } from '@phosphor-icons/react'

const WINDOW_OPTIONS = [7, 30, 60]
const trackingPanelClass = 'glass-card border-slate-800/80 bg-slate-950/65 shadow-[0_20px_80px_rgba(2,6,23,0.35)]'
const trackingInsetClass = 'rounded-2xl border border-slate-800/80 bg-slate-900/70'

function buildRange(days: number) {
  return {
    since: format(subDays(new Date(), Math.max(0, days - 1)), 'yyyy-MM-dd'),
    until: format(new Date(), 'yyyy-MM-dd'),
  }
}

function formatNumber(value: number | string | null | undefined): string {
  const parsed = typeof value === 'number' ? value : Number(value || 0)
  if (!Number.isFinite(parsed)) return '0'
  return new Intl.NumberFormat('pt-BR').format(parsed)
}

function formatCurrency(value: number | null | undefined, currency = 'BRL') {
  const numeric = Number(value || 0)
  try {
    return new Intl.NumberFormat('pt-BR', {
      style: 'currency',
      currency,
      maximumFractionDigits: 2,
    }).format(Number.isFinite(numeric) ? numeric : 0)
  } catch {
    return `${currency} ${numeric.toFixed(2)}`
  }
}

function formatPercent(value: number | null | undefined) {
  const numeric = Number(value || 0)
  return `${Math.round(numeric * 100) / 100}%`
}

function formatDateTime(value: string | null | undefined): string {
  if (!value) return '—'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '—'
  return format(date, "dd/MM/yyyy 'às' HH:mm", { locale: ptBR })
}

function campaignStatusTone(status?: string) {
  const normalized = String(status || '').trim().toUpperCase()
  if (normalized === 'ACTIVE') return 'border-emerald-500/30 bg-emerald-500/15 text-emerald-100'
  if (normalized === 'PAUSED') return 'border-amber-500/30 bg-amber-500/15 text-amber-100'
  if (normalized === 'DISABLED' || normalized === 'ARCHIVED') return 'border-rose-500/30 bg-rose-500/15 text-rose-100'
  return 'border-slate-700 bg-slate-900/60 text-slate-200'
}

function MetricCard({
  title,
  value,
  hint,
  tone = 'default',
}: {
  title: string
  value: string
  hint: string
  tone?: 'default' | 'success' | 'warning'
}) {
  const toneClass = tone === 'success' ? 'text-emerald-300' : tone === 'warning' ? 'text-amber-300' : 'text-white'

  return (
    <Card className={trackingPanelClass}>
      <CardContent className="pt-6">
        <div className="space-y-2">
          <p className="text-xs uppercase tracking-[0.2em] text-slate-400/80">{title}</p>
          <div className={`text-3xl font-semibold ${toneClass}`}>{value}</div>
          <p className="text-sm text-slate-300">{hint}</p>
        </div>
      </CardContent>
    </Card>
  )
}

function CampaignRow({ campaign }: { campaign: MetaAdsReportCampaign }) {
  return (
    <div className={`${trackingInsetClass} flex flex-col gap-4 p-4 lg:flex-row lg:items-center lg:justify-between`}>
      <div className="space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          <div className="font-medium text-white">{campaign.campaignName || campaign.campaignId}</div>
          <Badge className={campaignStatusTone(campaign.status)}>{campaign.status || 'UNKNOWN'}</Badge>
        </div>
        <div className="font-mono text-xs text-slate-400">{campaign.campaignId}</div>
      </div>
      <div className="grid gap-3 sm:grid-cols-3 lg:min-w-[26rem] lg:grid-cols-6">
        <div>
          <div className="text-[11px] uppercase tracking-[0.18em] text-slate-400/80">Spend</div>
          <div className="mt-1 text-sm font-medium text-white">{formatCurrency(campaign.spend)}</div>
        </div>
        <div>
          <div className="text-[11px] uppercase tracking-[0.18em] text-slate-400/80">Impressões</div>
          <div className="mt-1 text-sm font-medium text-white">{formatNumber(campaign.impressions)}</div>
        </div>
        <div>
          <div className="text-[11px] uppercase tracking-[0.18em] text-slate-400/80">Cliques</div>
          <div className="mt-1 text-sm font-medium text-white">{formatNumber(campaign.clicks)}</div>
        </div>
        <div>
          <div className="text-[11px] uppercase tracking-[0.18em] text-slate-400/80">Conversas</div>
          <div className="mt-1 text-sm font-medium text-white">{formatNumber(campaign.conversations)}</div>
        </div>
        <div>
          <div className="text-[11px] uppercase tracking-[0.18em] text-slate-400/80">CTR</div>
          <div className="mt-1 text-sm font-medium text-white">{formatPercent(campaign.ctr)}</div>
        </div>
        <div>
          <div className="text-[11px] uppercase tracking-[0.18em] text-slate-400/80">CPC</div>
          <div className="mt-1 text-sm font-medium text-white">{formatCurrency(campaign.cpc)}</div>
        </div>
      </div>
    </div>
  )
}

export function MetaTrackingDashboard() {
  const [days, setDays] = useState(30)
  const [loading, setLoading] = useState(true)
  const [refreshTick, setRefreshTick] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const [data, setData] = useState<MetaAdsReportResponse | null>(null)

  useEffect(() => {
    let cancelled = false

    async function load() {
      setLoading(true)
      setError(null)
      try {
        const report = await metaAdsApi.report(buildRange(days))
        if (!cancelled) setData(report)
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Falha ao carregar relatório de Meta Ads')
          setData(null)
        }
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    load()
    return () => {
      cancelled = true
    }
  }, [days, refreshTick])

  const summary = data?.summary || {}
  const campaigns = data?.campaigns || []
  const reportDateLabel = formatDateTime(data?.metadata?.reportDate || null)
  const sourceLabel = data?.source === 'graph-fallback' ? 'fallback Graph' : 'workflow consolidado'
  const warnings = data?.warnings || []
  const ctr = useMemo(() => {
    const clicks = Number(summary.clicks || 0)
    const impressions = Number(summary.impressions || 0)
    return impressions > 0 ? (clicks / impressions) * 100 : 0
  }, [summary.clicks, summary.impressions])
  const cpc = useMemo(() => {
    const spend = Number(summary.spend || 0)
    const clicks = Number(summary.clicks || 0)
    return clicks > 0 ? spend / clicks : 0
  }, [summary.clicks, summary.spend])
  const cpm = useMemo(() => {
    const spend = Number(summary.spend || 0)
    const impressions = Number(summary.impressions || 0)
    return impressions > 0 ? (spend / impressions) * 1000 : 0
  }, [summary.impressions, summary.spend])

  return (
    <div className="space-y-6">
      <Card className={`${trackingPanelClass} overflow-hidden`}>
        <CardHeader className="border-b border-slate-800/80 bg-slate-950/70">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
            <div className="space-y-2">
              <CardTitle className="flex items-center gap-3 text-2xl text-white">
                <ChartBar className="h-6 w-6 text-sky-400" />
                Acompanhamento de Tracking e Conversão
              </CardTitle>
              <CardDescription className="max-w-3xl text-slate-300">
                Painel consolidado a partir do workflow `Meta Ads – Report`, com foco em spend, impressões, cliques,
                conversas iniciadas e saúde do consolidado diário da conta selecionada.
              </CardDescription>
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <div className="flex items-center gap-2 rounded-full border border-slate-800/80 bg-slate-900/70 p-1">
                {WINDOW_OPTIONS.map((option) => (
                  <button
                    key={option}
                    type="button"
                    onClick={() => setDays(option)}
                    className={`rounded-full px-3 py-1.5 text-sm transition ${
                      option === days ? 'bg-slate-700 text-white' : 'text-slate-300 hover:bg-slate-800 hover:text-white'
                    }`}
                  >
                    {option}d
                  </button>
                ))}
              </div>
              <Button
                variant="outline"
                className="border-slate-700 bg-slate-900/70 text-slate-100 hover:bg-slate-800"
                onClick={() => setRefreshTick((value) => value + 1)}
              >
                {loading ? <Spinner className="mr-2 h-4 w-4 animate-spin" /> : <CirclesThreePlus className="mr-2 h-4 w-4" />}
                Atualizar
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-6 pt-6">
          {error ? (
            <div className="rounded-2xl border border-red-400/30 bg-red-500/10 p-5 text-red-100">
              <div className="flex items-center gap-2 font-medium">
                <LinkBreak className="h-5 w-5" />
                Falha ao carregar o painel consolidado do Meta Ads
              </div>
              <p className="mt-2 text-sm text-red-100/80">{error}</p>
            </div>
          ) : null}

          {data ? (
            <div
              className={`rounded-2xl border p-5 ${
                data.source === 'graph-fallback'
                  ? 'border-amber-400/30 bg-amber-500/10 text-amber-100'
                  : 'border-emerald-400/30 bg-emerald-500/10 text-emerald-100'
              }`}
            >
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-center gap-2 font-medium">
                  {data.source === 'graph-fallback' ? <WarningCircle className="h-5 w-5" /> : <CheckCircle className="h-5 w-5" />}
                  {data.source === 'graph-fallback' ? 'Painel parcial em fallback' : 'Consolidado do workflow disponível'}
                </div>
                <div className="flex flex-wrap gap-2">
                  <Badge variant="outline" className="border-current/20 text-current">
                    fonte {sourceLabel}
                  </Badge>
                  <Badge variant="outline" className="border-current/20 text-current">
                    data base {reportDateLabel}
                  </Badge>
                  <Badge variant="outline" className="border-current/20 text-current">
                    execuções {formatNumber(data.metadata.runsCount)}
                  </Badge>
                </div>
              </div>
              <p className="mt-2 text-sm opacity-90">
                {data.source === 'graph-fallback'
                  ? 'O consolidado do workflow não respondeu neste momento. O CRM caiu para o Graph da Meta para não deixar o módulo vazio.'
                  : 'As métricas desta aba estão vindo do consolidado diário persistido pelo workflow Meta Ads – Report.'}
              </p>
            </div>
          ) : null}

          {warnings.length > 0 ? (
            <div className="rounded-2xl border border-amber-400/30 bg-amber-500/10 p-5 text-amber-100">
              <div className="flex items-center gap-2 font-medium">
                <WarningCircle className="h-5 w-5" />
                Avisos de leitura
              </div>
              <div className="mt-3 flex flex-wrap gap-2">
                {warnings.map((warning) => (
                  <Badge key={warning} variant="outline" className="border-amber-300/30 text-amber-100">
                    {warning}
                  </Badge>
                ))}
              </div>
            </div>
          ) : null}

          <div className="grid gap-4 xl:grid-cols-4">
            <div className={`${trackingInsetClass} p-4`}>
              <div className="text-xs uppercase tracking-[0.2em] text-slate-400/80">Conta consolidada</div>
              <div className="mt-2 text-xl font-semibold text-white">{sourceLabel}</div>
            </div>
            <div className={`${trackingInsetClass} p-4`}>
              <div className="text-xs uppercase tracking-[0.2em] text-slate-400/80">Janela consultada</div>
              <div className="mt-2 text-xl font-semibold text-white">{days} dias</div>
            </div>
            <div className={`${trackingInsetClass} p-4`}>
              <div className="text-xs uppercase tracking-[0.2em] text-slate-400/80">Conversas iniciadas</div>
              <div className="mt-2 text-xl font-semibold text-white">{formatNumber(summary.conversations || 0)}</div>
            </div>
            <div className={`${trackingInsetClass} p-4`}>
              <div className="text-xs uppercase tracking-[0.2em] text-slate-400/80">Campanhas ativas</div>
              <div className="mt-2 text-xl font-semibold text-white">{formatNumber(summary.activeCampaigns || 0)}</div>
            </div>
          </div>

          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
            <MetricCard
              title="Spend consolidado"
              value={formatCurrency(summary.spend || 0)}
              hint="Soma consolidada do período consultado."
              tone="success"
            />
            <MetricCard
              title="Impressões"
              value={formatNumber(summary.impressions || 0)}
              hint="Volume total do consolidado diário."
            />
            <MetricCard
              title="Cliques"
              value={formatNumber(summary.clicks || 0)}
              hint="Cliques totais registrados pelo workflow."
            />
            <MetricCard
              title="Conversas iniciadas"
              value={formatNumber(summary.conversations || 0)}
              hint="Conversas/WhatsApp iniciados no período."
              tone={Number(summary.conversations || 0) > 0 ? 'success' : 'warning'}
            />
            <MetricCard
              title="CTR"
              value={formatPercent(ctr)}
              hint="Cliques sobre impressões."
            />
            <MetricCard
              title="CPC médio"
              value={formatCurrency(cpc)}
              hint="Investimento dividido por cliques."
            />
            <MetricCard
              title="CPM"
              value={formatCurrency(cpm)}
              hint="Custo por mil impressões."
            />
            <MetricCard
              title="Custo por conversa"
              value={formatCurrency(summary.avgCostConversation || 0)}
              hint="Spend dividido por conversas iniciadas."
              tone={Number(summary.conversations || 0) > 0 ? 'success' : 'warning'}
            />
            <MetricCard
              title="Fonte operacional"
              value={data?.source === 'graph-fallback' ? 'Fallback' : 'Workflow'}
              hint="Mostra se o CRM está lendo o consolidado ou o Graph direto."
              tone={data?.source === 'graph-fallback' ? 'warning' : 'success'}
            />
          </div>

          <Card className={trackingPanelClass}>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-white">
                <Target className="h-5 w-5 text-sky-300" />
                Campanhas do período
              </CardTitle>
              <CardDescription className="text-slate-300">
                Ranking por investimento dentro do consolidado diário da conta selecionada.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              {campaigns.length === 0 ? (
                <div className="rounded-2xl border border-slate-800/80 bg-slate-900/60 p-4 text-sm text-slate-300">
                  Ainda não há linhas consolidadas de campanha para este período.
                </div>
              ) : (
                campaigns.map((campaign) => <CampaignRow key={campaign.campaignId} campaign={campaign} />)
              )}
            </CardContent>
          </Card>
        </CardContent>
      </Card>
    </div>
  )
}
