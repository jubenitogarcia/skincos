import { useEffect, useMemo, useState } from 'react'
import { Badge } from '@/badge'
import { Button } from '@/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/card'
import { getMetaTrackingLocalOverview, isMetaTrackingLocalMockEnabled } from '@/metaTrackingLocalMock'
import { Progress } from '@/progress'
import { ChartBar, CheckCircle, CirclesThreePlus, Funnel, LinkBreak, Spinner, WarningCircle, WhatsappLogo } from '@phosphor-icons/react'
import type { TrackingOverviewResponse } from '@/metaTrackingLocalMock'

const WINDOW_OPTIONS = [7, 30, 60]
const trackingPanelClass = 'glass-card border-slate-800/80 bg-slate-950/65 shadow-[0_20px_80px_rgba(2,6,23,0.35)]'
const trackingInsetClass = 'rounded-2xl border border-slate-800/80 bg-slate-900/70'

function formatNumber(value: number | string | null | undefined): string {
  const parsed = typeof value === 'number' ? value : Number(value || 0)
  if (!Number.isFinite(parsed)) return '0'
  return new Intl.NumberFormat('pt-BR').format(parsed)
}

function formatPercent(numerator: number, denominator: number): number {
  if (!denominator) return 0
  return Math.max(0, Math.min(100, Math.round((numerator / denominator) * 100)))
}

function buildDelta(current: number, previous: number): string {
  const delta = Math.round((current - previous) * 10) / 10
  return `${delta >= 0 ? '+' : ''}${delta}`
}

function formatDateTime(value: number | string | null | undefined): string {
  if (!value) return '—'
  const date = typeof value === 'number' ? new Date(value) : new Date(value)
  if (Number.isNaN(date.getTime())) return '—'
  return date.toLocaleString('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })
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
  tone?: 'default' | 'success' | 'warning' | 'danger'
}) {
  const toneClass =
    tone === 'success'
      ? 'text-emerald-300'
      : tone === 'warning'
        ? 'text-amber-300'
        : tone === 'danger'
          ? 'text-red-300'
          : 'text-white'

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

function SmallList({
  title,
  items,
  emptyLabel,
}: {
  title: string
  items: Array<{ label: string; value: string }>
  emptyLabel: string
}) {
  return (
    <Card className={trackingPanelClass}>
      <CardHeader>
        <CardTitle className="text-base text-white">{title}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {items.length === 0 ? (
          <div className="text-sm text-slate-400">{emptyLabel}</div>
        ) : (
          items.map((item) => (
            <div key={`${item.label}-${item.value}`} className="flex items-center justify-between gap-3 text-sm">
              <span className="truncate text-slate-300">{item.label}</span>
              <span className="font-medium text-white">{item.value}</span>
            </div>
          ))
        )}
      </CardContent>
    </Card>
  )
}

function AlertPanel({
  alerts,
}: {
  alerts: Array<{ severity: 'critical' | 'warning'; code: string; title: string; message: string }>
}) {
  return (
    <Card className={trackingPanelClass}>
      <CardHeader>
        <CardTitle className="text-white">Alertas operacionais</CardTitle>
        <CardDescription className="text-slate-300">
          Regras automáticas para cobertura, consentimento e falhas de entrega.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {alerts.length === 0 ? (
          <div className="rounded-2xl border border-emerald-400/20 bg-emerald-500/10 p-4 text-sm text-emerald-100">
            Nenhum alerta ativo no período consultado.
          </div>
        ) : (
          alerts.map((alert) => (
            <div
              key={alert.code}
              className={`rounded-2xl border p-4 text-sm ${
                alert.severity === 'critical'
                  ? 'border-red-400/20 bg-red-500/10 text-red-100'
                  : 'border-amber-400/20 bg-amber-500/10 text-amber-100'
              }`}
            >
              <div className="flex items-center justify-between gap-3">
                <div className="font-medium">{alert.title}</div>
                <Badge variant="outline" className={alert.severity === 'critical' ? 'border-red-300/30 text-red-100' : 'border-amber-300/30 text-amber-100'}>
                  {alert.severity === 'critical' ? 'Crítico' : 'Alerta'}
                </Badge>
              </div>
              <div className="mt-2 text-sm opacity-90">{alert.message}</div>
            </div>
          ))
        )}
      </CardContent>
    </Card>
  )
}

export function MetaTrackingDashboard() {
  const [days, setDays] = useState(30)
  const [loading, setLoading] = useState(true)
  const [refreshTick, setRefreshTick] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const [data, setData] = useState<TrackingOverviewResponse | null>(null)

  useEffect(() => {
    let cancelled = false

    async function load() {
      setLoading(true)
      setError(null)
      try {
        if (isMetaTrackingLocalMockEnabled()) {
          const mockData = getMetaTrackingLocalOverview(days)
          if (!cancelled) setData(mockData)
          return
        }
        const res = await fetch(`/api/tracking/overview?days=${days}&limit=10`, {
          credentials: 'include',
          headers: { accept: 'application/json' },
        })
        const json = (await res.json()) as TrackingOverviewResponse & { message?: string; error?: string }
        if (!res.ok || !json?.ok) {
          throw new Error(json?.message || json?.error || `HTTP ${res.status}`)
        }
        if (!cancelled) setData(json)
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Falha ao carregar painel de tracking')
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

  const websiteSummary = data?.website?.data?.summary || {}
  const whatsappSummary = data?.whatsapp?.data?.summary || {}
  const confirmedBookings = Number(data?.coverage?.confirmedBookings ?? websiteSummary.confirmedBookings ?? 0)
  const siteWhatsappClicks = Number(data?.coverage?.whatsappClicks ?? websiteSummary.whatsappClicks ?? 0)
  const whatsappConversationTotal = Number(whatsappSummary.conversations_total || 0)
  const whatsappAppointmentTotal = Number(whatsappSummary.appointments_total || 0)

  const siteCoverage = useMemo(() => {
    if (data?.coverage) {
      return {
        tracking: data.coverage.trackingContext,
        metaEvent: data.coverage.metaEventId,
        facebookIds: data.coverage.facebookIds,
      }
    }
    return {
      tracking: formatPercent(Number(websiteSummary.bookingsWithTrackingContext || 0), confirmedBookings),
      metaEvent: formatPercent(Number(websiteSummary.bookingsWithMetaEventId || 0), confirmedBookings),
      facebookIds: formatPercent(Number(websiteSummary.bookingsWithFacebookIds || 0), confirmedBookings),
    }
  }, [data?.coverage, websiteSummary, confirmedBookings])

  const siteBehaviorCoverage = useMemo(() => {
    if (data?.coverage) {
      return {
        marketingConsent: data.coverage.marketingConsent,
        analyticsConsent: data.coverage.analyticsConsent,
        whatsappTracking: data.coverage.whatsappTracking,
      }
    }
    return {
      marketingConsent: formatPercent(Number(websiteSummary.bookingsWithMarketingConsent || 0), confirmedBookings),
      analyticsConsent: formatPercent(Number(websiteSummary.bookingsWithAnalyticsConsent || 0), confirmedBookings),
      whatsappTracking: formatPercent(Number(websiteSummary.whatsappClicksWithTrackingContext || 0), siteWhatsappClicks),
    }
  }, [data?.coverage, websiteSummary, confirmedBookings, siteWhatsappClicks])

  const scheduleDeliveryRate = useMemo(() => {
    if (data?.coverage) return data.coverage.scheduleDelivery
    const ok = Number(websiteSummary.capiScheduleOk || 0)
    const fail = Number(websiteSummary.capiScheduleFailed || 0)
    return formatPercent(ok, ok + fail)
  }, [data?.coverage, websiteSummary])

  const contactDeliveryRate = useMemo(() => {
    if (data?.coverage) return data.coverage.contactDelivery
    const ok = Number(websiteSummary.capiContactOk || 0)
    const fail = Number(websiteSummary.capiContactFailed || 0)
    return formatPercent(ok, ok + fail)
  }, [data?.coverage, websiteSummary])

  const topSourceItems = (data?.website?.data?.topSources || []).map((item) => ({
    label: item.utmSource || 'direto',
    value: formatNumber(item.count),
  }))
  const topCampaignItems = (data?.website?.data?.topCampaigns || []).map((item) => ({
    label: item.utmCampaign || 'sem campanha',
    value: formatNumber(item.count),
  }))
  const unitItems = (data?.website?.data?.byUnit || []).map((item) => ({
    label: item.unitSlug || 'sem unidade',
    value: formatNumber(item.count),
  }))
  const reconciliationBuckets = data?.reconciliation?.buckets || []
  const incompleteBookings = data?.reconciliation?.incompleteBookings || []
  const retryCandidates = data?.reconciliation?.retryCandidates || []
  const previousTracking = Number(data?.previousCoverage?.trackingContext || 0)
  const previousFacebookIds = Number(data?.previousCoverage?.facebookIds || 0)
  const previousMarketingConsent = Number(data?.previousCoverage?.marketingConsent || 0)
  const whatsappAttributionReady = whatsappConversationTotal > 0 || whatsappAppointmentTotal > 0
  const siteInsights = useMemo(() => {
    const insights: Array<{ tone: 'success' | 'warning' | 'danger'; text: string }> = []

    if (!confirmedBookings) {
      insights.push({ tone: 'warning', text: 'Ainda não há agendamentos confirmados no período selecionado para auditar a qualidade final da atribuição.' })
      return insights
    }

    if (siteCoverage.tracking < 80) {
      insights.push({ tone: 'danger', text: `O tracking_context está chegando em apenas ${siteCoverage.tracking}% dos agendamentos confirmados.` })
    } else {
      insights.push({ tone: 'success', text: `O tracking_context está presente em ${siteCoverage.tracking}% dos agendamentos confirmados.` })
    }

    if (siteCoverage.facebookIds === 0) {
      insights.push({ tone: 'danger', text: 'fbp, fbc e fbclid ainda não chegaram em nenhum agendamento confirmado do período.' })
    } else if (siteCoverage.facebookIds < 70) {
      insights.push({ tone: 'warning', text: `Os identificadores Facebook chegaram em ${siteCoverage.facebookIds}% dos agendamentos.` })
    } else {
      insights.push({ tone: 'success', text: `Os identificadores Facebook chegaram em ${siteCoverage.facebookIds}% dos agendamentos.` })
    }

    if (Number(websiteSummary.capiScheduleOk || 0) === 0) {
      insights.push({ tone: 'warning', text: 'A CAPI do evento Schedule está configurada, mas ainda não há entregas confirmadas no período atual.' })
    } else if (scheduleDeliveryRate < 90) {
      insights.push({ tone: 'warning', text: `A taxa de sucesso do Schedule via CAPI está em ${scheduleDeliveryRate}%.` })
    } else {
      insights.push({ tone: 'success', text: `A taxa de sucesso do Schedule via CAPI está em ${scheduleDeliveryRate}%.` })
    }

    if (siteWhatsappClicks > 0 && siteBehaviorCoverage.whatsappTracking < 100) {
      insights.push({ tone: 'warning', text: `Os cliques para WhatsApp do site têm contexto persistido em ${siteBehaviorCoverage.whatsappTracking}%.` })
    }

    return insights
  }, [confirmedBookings, scheduleDeliveryRate, siteBehaviorCoverage.whatsappTracking, siteCoverage.facebookIds, siteCoverage.tracking, siteWhatsappClicks, websiteSummary])

  return (
    <div className="space-y-6">
      <Card className={`${trackingPanelClass} overflow-hidden`}>
        <CardHeader className="border-b border-slate-800/80 bg-slate-950/70">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
            <div className="space-y-2">
              <CardTitle className="text-2xl text-white flex items-center gap-3">
                <ChartBar className="h-6 w-6 text-sky-400" />
                Acompanhamento de Tracking e Conversao
              </CardTitle>
              <CardDescription className="max-w-3xl text-slate-300">
                Painel operacional dos sinais reais do site `espacofacial.com`, com foco em atribuicao, CAPI, booking
                confirmado e cliques para WhatsApp. A correlacao CRM/n8n fica secundaria enquanto essa camada nao for a
                prioridade.
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
        <CardContent className="pt-6 space-y-6">
          {error ? (
            <div className="rounded-2xl border border-red-400/30 bg-red-500/10 p-5 text-red-100">
              <div className="flex items-center gap-2 font-medium">
                <LinkBreak className="h-5 w-5" />
                Falha ao carregar o painel real de tracking
              </div>
              <p className="mt-2 text-sm text-red-100/80">{error}</p>
            </div>
          ) : null}

          {data?.warnings && data.warnings.length > 0 ? (
            <div className="rounded-2xl border border-amber-400/30 bg-amber-500/12 p-5 text-amber-100">
              <div className="flex items-center gap-2 font-medium">
                <WarningCircle className="h-5 w-5" />
                Painel parcial
              </div>
              <div className="mt-3 flex flex-wrap gap-2">
                {data.warnings.map((warning) => (
                  <Badge key={warning} variant="outline" className="border-amber-300/30 bg-amber-500/10 text-amber-50">
                    {warning}
                  </Badge>
                ))}
              </div>
            </div>
          ) : null}

          {data?.health ? (
            <div
              className={`rounded-2xl border p-5 ${
                data.health.status === 'healthy'
                  ? 'border-emerald-400/30 bg-emerald-500/10 text-emerald-100'
                  : data.health.status === 'critical'
                    ? 'border-red-400/30 bg-red-500/10 text-red-100'
                    : 'border-amber-400/30 bg-amber-500/10 text-amber-100'
              }`}
            >
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-center gap-2 font-medium">
                  {data.health.status === 'healthy' ? <CheckCircle className="h-5 w-5" /> : <WarningCircle className="h-5 w-5" />}
                  Saúde do tracking: {data.health.label}
                </div>
                <Badge
                  variant="outline"
                  className={
                    data.health.status === 'healthy'
                      ? 'border-emerald-300/30 text-emerald-100'
                      : data.health.status === 'critical'
                        ? 'border-red-300/30 text-red-100'
                        : 'border-amber-300/30 text-amber-100'
                  }
                >
                  janela {days}d
                </Badge>
              </div>
              <p className="mt-2 text-sm opacity-90">{data.health.summary}</p>
            </div>
          ) : null}

          {!whatsappAttributionReady ? (
            <div className="rounded-2xl border border-sky-500/30 bg-sky-500/10 p-5 text-sky-100">
              <div className="flex items-center gap-2 font-medium">
                <CheckCircle className="h-5 w-5" />
                Modo foco site ativo
              </div>
              <p className="mt-2 text-sm text-sky-100/85">
                O dashboard está priorizando leitura do `espacofacial.com`. A parte de conversa/agendamento atribuídos
                no CRM via WhatsApp permanece disponível, mas ainda sem volume integrado.
              </p>
            </div>
          ) : null}

          <div className="grid gap-4 xl:grid-cols-4">
            <div className={`${trackingInsetClass} p-4`}>
              <div className="text-xs uppercase tracking-[0.2em] text-slate-400/80">Agendamentos confirmados no site</div>
              <div className="mt-2 text-2xl font-semibold text-white">{formatNumber(confirmedBookings)}</div>
            </div>
            <div className={`${trackingInsetClass} p-4`}>
              <div className="text-xs uppercase tracking-[0.2em] text-slate-400/80">Clique WhatsApp no site</div>
              <div className="mt-2 text-2xl font-semibold text-white">{formatNumber(siteWhatsappClicks)}</div>
            </div>
            <div className={`${trackingInsetClass} p-4`}>
              <div className="text-xs uppercase tracking-[0.2em] text-slate-400/80">Schedule via CAPI OK</div>
              <div className="mt-2 text-2xl font-semibold text-white">{formatNumber(websiteSummary.capiScheduleOk || 0)}</div>
            </div>
            <div className={`${trackingInsetClass} p-4`}>
              <div className="text-xs uppercase tracking-[0.2em] text-slate-400/80">Cobertura tracking_context</div>
              <div className="mt-2 text-2xl font-semibold text-white">{siteCoverage.tracking}%</div>
            </div>
          </div>

          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
            <MetricCard
              title="Agendamentos confirmados no site"
              value={formatNumber(confirmedBookings)}
              hint="Base do evento principal Schedule."
              tone="success"
            />
            <MetricCard
              title="Schedule via CAPI OK"
              value={formatNumber(websiteSummary.capiScheduleOk || 0)}
              hint={`${scheduleDeliveryRate}% de sucesso no envio server-side no periodo.`}
              tone={scheduleDeliveryRate >= 90 ? 'success' : scheduleDeliveryRate >= 70 ? 'warning' : 'danger'}
            />
            <MetricCard
              title="Contact via CAPI OK"
              value={formatNumber(websiteSummary.capiContactOk || 0)}
              hint={`${contactDeliveryRate}% de sucesso nos cliques para WhatsApp.`}
              tone={contactDeliveryRate >= 90 ? 'success' : contactDeliveryRate >= 70 ? 'warning' : 'danger'}
            />
            <MetricCard
              title="Cobertura de tracking no booking"
              value={`${siteCoverage.tracking}%`}
              hint="Bookings confirmados com tracking_context persistido."
              tone={siteCoverage.tracking >= 85 ? 'success' : siteCoverage.tracking >= 60 ? 'warning' : 'danger'}
            />
            <MetricCard
              title="Cobertura de event_id Meta"
              value={`${siteCoverage.metaEvent}%`}
              hint="Bookings confirmados com meta_event_id salvo para dedupe."
              tone={siteCoverage.metaEvent >= 85 ? 'success' : siteCoverage.metaEvent >= 60 ? 'warning' : 'danger'}
            />
            <MetricCard
              title="Cobertura de identificadores Facebook"
              value={`${siteCoverage.facebookIds}%`}
              hint="Bookings com fbp/fbc/fbclid presentes."
              tone={siteCoverage.facebookIds >= 70 ? 'success' : siteCoverage.facebookIds >= 40 ? 'warning' : 'danger'}
            />
            <MetricCard
              title="Consentimento de marketing"
              value={`${siteBehaviorCoverage.marketingConsent}%`}
              hint="Bookings com marketing consentido na conversao."
              tone={siteBehaviorCoverage.marketingConsent >= 70 ? 'success' : siteBehaviorCoverage.marketingConsent >= 40 ? 'warning' : 'danger'}
            />
            <MetricCard
              title="Consentimento de analytics"
              value={`${siteBehaviorCoverage.analyticsConsent}%`}
              hint="Bookings com analytics consentido na conversao."
              tone={siteBehaviorCoverage.analyticsConsent >= 70 ? 'success' : siteBehaviorCoverage.analyticsConsent >= 40 ? 'warning' : 'danger'}
            />
            <MetricCard
              title="Contexto nos cliques WhatsApp"
              value={`${siteBehaviorCoverage.whatsappTracking}%`}
              hint="Cliques para WhatsApp com tracking persistido."
              tone={siteBehaviorCoverage.whatsappTracking >= 85 ? 'success' : siteBehaviorCoverage.whatsappTracking >= 60 ? 'warning' : 'danger'}
            />
          </div>

          <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
            <MetricCard
              title="Tracking_context vs janela anterior"
              value={`${buildDelta(siteCoverage.tracking, previousTracking)} pp`}
              hint={`Atual ${siteCoverage.tracking}% • anterior ${previousTracking}%`}
              tone={siteCoverage.tracking >= previousTracking ? 'success' : 'warning'}
            />
            <MetricCard
              title="FB IDs vs janela anterior"
              value={`${buildDelta(siteCoverage.facebookIds, previousFacebookIds)} pp`}
              hint={`Atual ${siteCoverage.facebookIds}% • anterior ${previousFacebookIds}%`}
              tone={siteCoverage.facebookIds >= previousFacebookIds ? 'success' : 'warning'}
            />
            <MetricCard
              title="Consentimento marketing vs anterior"
              value={`${buildDelta(siteBehaviorCoverage.marketingConsent, previousMarketingConsent)} pp`}
              hint={`Atual ${siteBehaviorCoverage.marketingConsent}% • anterior ${previousMarketingConsent}%`}
              tone={siteBehaviorCoverage.marketingConsent >= previousMarketingConsent ? 'success' : 'warning'}
            />
          </div>

          <AlertPanel alerts={data?.alerts || []} />

          <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
            <SmallList title="Top fontes do site" items={topSourceItems} emptyLabel="Sem origem UTM suficiente no periodo." />
            <SmallList title="Top campanhas do site" items={topCampaignItems} emptyLabel="Sem campanhas registradas no periodo." />
            <SmallList title="Unidades com mais bookings" items={unitItems} emptyLabel="Sem unidades registradas no periodo." />
          </div>

          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <Card className="glass-card border-white/10">
              <CardHeader>
                <CardTitle className="text-white flex items-center gap-2">
                  <Funnel className="h-5 w-5 text-blue-300" />
                  Qualidade do booking no site
                </CardTitle>
                <CardDescription className="text-blue-100/70">
                  Leitura do que realmente chegou no momento da conversao.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div>
                  <div className="mb-2 flex items-center justify-between text-sm text-blue-100/70">
                    <span>Tracking context persistido</span>
                    <span>{siteCoverage.tracking}%</span>
                  </div>
                  <Progress value={siteCoverage.tracking} className="h-2" />
                </div>
                <div>
                  <div className="mb-2 flex items-center justify-between text-sm text-blue-100/70">
                    <span>Deduplicacao com meta_event_id</span>
                    <span>{siteCoverage.metaEvent}%</span>
                  </div>
                  <Progress value={siteCoverage.metaEvent} className="h-2" />
                </div>
                <div>
                  <div className="mb-2 flex items-center justify-between text-sm text-blue-100/70">
                    <span>fbp / fbc / fbclid presentes</span>
                    <span>{siteCoverage.facebookIds}%</span>
                  </div>
                  <Progress value={siteCoverage.facebookIds} className="h-2" />
                </div>
                <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4 text-sm text-blue-100/75">
                  <div className="flex items-center gap-2 font-medium text-white">
                    <CheckCircle className="h-4 w-4 text-emerald-300" />
                    Ultima atualizacao
                  </div>
                  <div className="mt-2">{formatDateTime(data?.generatedAt)}</div>
                </div>
              </CardContent>
            </Card>

            <Card className="glass-card border-white/10">
              <CardHeader>
                <CardTitle className="text-white flex items-center gap-2">
                  <ChartBar className="h-5 w-5 text-emerald-300" />
                  Leitura operacional do site
                </CardTitle>
                <CardDescription className="text-blue-100/70">
                  Diagnostico objetivo do que o CRM ja consegue concluir apenas pelos sinais do site.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-3">
                  {siteInsights.map((item, index) => (
                    <div
                      key={`${item.tone}-${index}`}
                      className={`rounded-2xl border p-4 text-sm ${
                        item.tone === 'success'
                          ? 'border-emerald-400/20 bg-emerald-500/10 text-emerald-100'
                          : item.tone === 'danger'
                            ? 'border-red-400/20 bg-red-500/10 text-red-100'
                            : 'border-amber-400/20 bg-amber-500/10 text-amber-100'
                      }`}
                    >
                      {item.text}
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          </div>

          <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
            {reconciliationBuckets.map((item) => (
              <Card key={item.bucket} className="glass-card border-white/10">
                <CardHeader>
                  <CardTitle className="text-base text-white">{item.label}</CardTitle>
                  <CardDescription className="text-blue-100/70">
                    {item.percent}% dos bookings confirmados na janela atual.
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="text-3xl font-semibold text-white">{formatNumber(item.count)}</div>
                </CardContent>
              </Card>
            ))}
          </div>

          <div className={`grid grid-cols-1 gap-4 ${whatsappAttributionReady ? 'xl:grid-cols-2' : ''}`}>
            <Card className="glass-card border-white/10">
              <CardHeader>
                <CardTitle className="text-white">Ultimos agendamentos confirmados no site</CardTitle>
                <CardDescription className="text-blue-100/70">
                  Janela de {days} dias, com foco em origem e deduplicacao Meta.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                {(data?.website?.data?.recentBookings || []).length === 0 ? (
                  <div className="text-sm text-blue-100/60">Nenhum agendamento confirmado no periodo.</div>
                ) : (
                  data?.website?.data?.recentBookings?.map((item) => (
                    <div key={item.id} className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
                      <div className="flex flex-wrap items-center justify-between gap-3">
                        <div>
                          <div className="font-medium text-white">{item.patient || 'Paciente oculto'}</div>
                          <div className="text-sm text-blue-100/65">
                            {item.unitSlug} • {item.utmSource || 'direto'} • {item.utmCampaign || 'sem campanha'}
                          </div>
                        </div>
                        <Badge variant="outline" className={item.hasFacebookIds ? 'border-emerald-300/30 text-emerald-100' : 'border-amber-300/30 text-amber-100'}>
                          {item.hasFacebookIds ? 'FB IDs OK' : 'FB IDs faltando'}
                        </Badge>
                      </div>
                      <div className="mt-3 flex flex-wrap gap-2 text-xs text-blue-100/70">
                        <span>{formatDateTime(item.createdAtMs)}</span>
                        <span>•</span>
                        <span>{item.serviceId}</span>
                        <span>•</span>
                        <span>{item.landingPage || 'sem landing_path'}</span>
                        <span>•</span>
                        <span>{item.metaEventId ? 'event_id salvo' : 'sem event_id'}</span>
                      </div>
                    </div>
                  ))
                )}
              </CardContent>
            </Card>

            {whatsappAttributionReady ? (
              <Card className="glass-card border-white/10">
                <CardHeader>
                  <CardTitle className="text-white">Ultimos fechamentos correlacionados no WhatsApp</CardTitle>
                  <CardDescription className="text-blue-100/70">
                    Conversas e agendamentos com `wa_click_id` ja reconhecido no CRM/n8n.
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-3">
                  {(data?.whatsapp?.data?.recentAppointments || []).length === 0 ? (
                    <div className="text-sm text-blue-100/60">Sem agendamentos correlacionados no periodo.</div>
                  ) : (
                    data?.whatsapp?.data?.recentAppointments?.map((item) => (
                      <div key={item.id} className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
                        <div className="flex flex-wrap items-center justify-between gap-3">
                          <div>
                            <div className="font-medium text-white">{item.unitSlug || 'sem unidade'} • {item.status}</div>
                            <div className="text-sm text-blue-100/65">
                              {item.utmSource || 'direto'} • {item.utmCampaign || 'sem campanha'}
                            </div>
                          </div>
                          <Badge variant="outline" className="border-blue-300/30 text-blue-100">
                            {item.waClickId}
                          </Badge>
                        </div>
                        <div className="mt-3 flex flex-wrap gap-2 text-xs text-blue-100/70">
                          <span>Criado {formatDateTime(item.createdAt)}</span>
                          <span>•</span>
                          <span>Inicio {formatDateTime(item.startAt)}</span>
                          <span>•</span>
                          <span>{item.phone || 'telefone oculto'}</span>
                        </div>
                      </div>
                    ))
                  )}
                </CardContent>
              </Card>
            ) : null}
          </div>

          <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
            <Card className="glass-card border-white/10">
              <CardHeader>
                <CardTitle className="text-white">Bookings com tracking incompleto</CardTitle>
                <CardDescription className="text-blue-100/70">
                  Lista priorizada por data com a principal causa diagnosticada.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                {incompleteBookings.length === 0 ? (
                  <div className="text-sm text-emerald-200/90">Nenhum booking incompleto na janela consultada.</div>
                ) : (
                  incompleteBookings.map((item) => (
                    <div key={item.id} className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
                      <div className="flex flex-wrap items-center justify-between gap-3">
                        <div>
                          <div className="font-medium text-white">{item.patient || 'Paciente oculto'}</div>
                          <div className="text-sm text-blue-100/65">
                            {item.unitSlug} • {item.utmSource || 'direto'} • {item.utmCampaign || 'sem campanha'}
                          </div>
                        </div>
                        <Badge variant="outline" className="border-amber-300/30 text-amber-100">
                          {item.primaryCause}
                        </Badge>
                      </div>
                      <div className="mt-3 flex flex-wrap gap-2 text-xs text-blue-100/70">
                        <span>{formatDateTime(item.createdAtMs)}</span>
                        <span>•</span>
                        <span>{item.coverageBucket}</span>
                        <span>•</span>
                        <span>{item.incompleteCauses.join(', ')}</span>
                      </div>
                    </div>
                  ))
                )}
              </CardContent>
            </Card>

            <Card className="glass-card border-white/10">
              <CardHeader>
                <CardTitle className="text-white">Falhas retryable para reprocessamento</CardTitle>
                <CardDescription className="text-blue-100/70">
                  Eventos server-side com perfil transitório de erro na Meta.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                {retryCandidates.length === 0 ? (
                  <div className="text-sm text-emerald-200/90">Nenhuma falha transitória recente detectada.</div>
                ) : (
                  retryCandidates.map((item) => (
                    <div key={item.id} className="rounded-2xl border border-amber-400/20 bg-amber-500/10 p-4">
                      <div className="flex flex-wrap items-center justify-between gap-3">
                        <div className="font-medium text-amber-100">
                          {item.eventName} • status {item.httpStatus || 'sem HTTP'}
                        </div>
                        <Badge variant="outline" className="border-amber-300/30 text-amber-100">
                          {item.normalizedReason}
                        </Badge>
                      </div>
                      <div className="mt-2 text-sm text-amber-100/85">{item.errorMessage || 'Sem mensagem detalhada.'}</div>
                      <div className="mt-2 text-xs text-amber-100/70">
                        {formatDateTime(item.createdAtMs)} • event_id {item.eventId}
                      </div>
                    </div>
                  ))
                )}
              </CardContent>
            </Card>
          </div>

          <Card className="glass-card border-white/10">
            <CardHeader>
              <CardTitle className="text-white">Falhas recentes de entrega server-side</CardTitle>
              <CardDescription className="text-blue-100/70">
                Erros do `Contact` ou `Schedule` enviados pela camada server-side do site.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              {(data?.website?.data?.recentCapiIssues || []).length === 0 ? (
                <div className="text-sm text-emerald-200/90">Nenhuma falha recente registrada no periodo consultado.</div>
              ) : (
                data?.website?.data?.recentCapiIssues?.map((item) => (
                  <div key={item.id} className="rounded-2xl border border-red-400/20 bg-red-500/10 p-4">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div className="font-medium text-red-100">
                        {item.eventName} • status {item.httpStatus || 'sem HTTP'}
                      </div>
                      <div className="text-xs text-red-100/70">{formatDateTime(item.createdAtMs)}</div>
                    </div>
                    <div className="mt-2 text-sm text-red-100/80">
                      {item.errorMessage || 'Sem mensagem de erro detalhada.'}
                    </div>
                    <div className="mt-2 text-xs text-red-100/65">
                      event_id: {item.eventId} {item.waClickId ? `• wa_click_id: ${item.waClickId}` : ''}
                    </div>
                  </div>
                ))
              )}
            </CardContent>
          </Card>

          <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
            <Card className="glass-card border-white/10 xl:col-span-2">
              <CardHeader>
                <CardTitle className="text-white">Governança de campanhas e links</CardTitle>
                <CardDescription className="text-blue-100/70">
                  Convenção operacional para manter origem, deduplicação e domínio corretos.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4 text-sm text-blue-100/80">
                <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">{data?.governance?.campaignRule}</div>
                <div className="grid gap-4 lg:grid-cols-2">
                  <div>
                    <div className="mb-2 font-medium text-white">Exemplos válidos</div>
                    <div className="space-y-2">
                      {(data?.governance?.validExamples || []).map((item) => (
                        <div key={item} className="rounded-xl border border-emerald-400/20 bg-emerald-500/10 p-3 text-emerald-100 break-all">
                          {item}
                        </div>
                      ))}
                    </div>
                  </div>
                  <div>
                    <div className="mb-2 font-medium text-white">Exemplos inválidos</div>
                    <div className="space-y-2">
                      {(data?.governance?.invalidExamples || []).map((item) => (
                        <div key={item} className="rounded-xl border border-red-400/20 bg-red-500/10 p-3 text-red-100 break-all">
                          {item}
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
                <div>
                  <div className="mb-2 font-medium text-white">Allowlist cross-domain pública</div>
                  <div className="space-y-2">
                    {(data?.governance?.crossDomainAllowlist || []).map((item) => (
                      <div key={item.host} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-white/10 bg-white/[0.03] p-3">
                        <div>
                          <div className="text-white">{item.host}</div>
                          <div className="text-xs text-blue-100/70">{item.purpose}</div>
                        </div>
                        <Badge variant="outline" className={item.allowedFromPublicSite ? 'border-blue-300/30 text-blue-100' : 'border-white/20 text-blue-100/70'}>
                          {item.allowedFromPublicSite ? 'Saída pública permitida' : 'Uso interno/técnico'}
                        </Badge>
                      </div>
                    ))}
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card className="glass-card border-white/10">
              <CardHeader>
                <CardTitle className="text-white">Rotina contínua</CardTitle>
                <CardDescription className="text-blue-100/70">
                  Cadência mínima para manter o tracking auditável.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4 text-sm text-blue-100/80">
                <div className="rounded-xl border border-white/10 bg-white/[0.03] p-3">
                  <div className="font-medium text-white">Smoke</div>
                  <div>{data?.validationCadence?.smoke}</div>
                </div>
                <div className="rounded-xl border border-white/10 bg-white/[0.03] p-3">
                  <div className="font-medium text-white">Validação funcional</div>
                  <div>{data?.validationCadence?.functional}</div>
                </div>
                <div className="rounded-xl border border-white/10 bg-white/[0.03] p-3">
                  <div className="font-medium text-white">Auditoria de cobertura</div>
                  <div>{data?.validationCadence?.coverageAudit}</div>
                </div>
                <div className="space-y-2">
                  {(data?.validationCadence?.recurringChecks || []).map((item) => (
                    <div key={item} className="rounded-xl border border-white/10 bg-white/[0.03] p-3">
                      {item}
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          </div>

          <Card className="glass-card border-white/10">
            <CardHeader>
              <CardTitle className="text-white flex items-center gap-2">
                <WhatsappLogo className="h-5 w-5 text-emerald-300" />
                Contrato do loop WhatsApp/CRM
              </CardTitle>
              <CardDescription className="text-blue-100/70">
                Preparação do que o CRM deve exibir quando a frente n8n voltar a ser prioridade.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4 text-sm text-blue-100/80">
              <div className="rounded-xl border border-white/10 bg-white/[0.03] p-4">{data?.whatsappContract?.description}</div>
              <div className="flex flex-wrap gap-2">
                {(data?.whatsappContract?.lifecycle || []).map((step) => (
                  <Badge key={step} variant="outline" className="border-blue-300/30 text-blue-100">
                    {step}
                  </Badge>
                ))}
              </div>
            </CardContent>
          </Card>
        </CardContent>
      </Card>
    </div>
  )
}
