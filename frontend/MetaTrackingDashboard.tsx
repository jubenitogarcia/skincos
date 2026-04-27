import { useEffect, useMemo, useState } from 'react'
import { Badge } from '@/badge'
import { Button } from '@/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/card'
import { Progress } from '@/progress'
import { ArrowRight, ChartBar, CheckCircle, CirclesThreePlus, Funnel, LinkBreak, Spinner, WarningCircle, WhatsappLogo } from '@phosphor-icons/react'

type TrackingOverviewResponse = {
  ok: boolean
  partial?: boolean
  warnings?: string[]
  generatedAt?: number
  window?: { days: number; sinceIso: string }
  funnel?: {
    siteConfirmedBookings: number
    siteWhatsappClicks: number
    crmAttributedConversations: number
    crmAttributedAppointments: number
  }
  website?: {
    available: boolean
    error?: string
    sourceUrl?: string
    data?: {
      config?: {
        metaPixelConfigured: boolean
        metaCapiConfigured: boolean
        dashboardTokenConfigured: boolean
      }
      summary?: Record<string, number>
      topSources?: Array<{ utmSource: string; count: number }>
      topCampaigns?: Array<{ utmCampaign: string; count: number }>
      byUnit?: Array<{ unitSlug: string; count: number }>
      recentBookings?: Array<{
        id: string
        createdAtMs: number
        unitSlug: string
        doctorSlug: string
        serviceId: string
        patient: string | null
        whatsapp: string | null
        metaEventId: string | null
        marketingConsent: boolean
        analyticsConsent: boolean
        utmSource: string | null
        utmCampaign: string | null
        utmMedium: string | null
        landingPage: string | null
        hasFacebookIds: boolean
      }>
      recentWhatsappClicks?: Array<{
        id: string
        createdAtMs: number
        eventId: string
        waClickId: string
        placement: string | null
        source: string | null
        unitSlug: string | null
        doctorName: string | null
        bookingId: string | null
        pagePath: string | null
        utmSource: string | null
        utmCampaign: string | null
      }>
      capiIssueReasons?: Array<{
        reason: string
        count: number
      }>
      recentCapiIssues?: Array<{
        id: string
        createdAtMs: number
        eventName: string
        eventId: string
        bookingId: string | null
        waClickId: string | null
        httpStatus: number | null
        errorMessage: string | null
      }>
    }
  }
  whatsapp?: {
    available: boolean
    error?: string
    data?: {
      summary?: Record<string, number>
      stages?: Array<{ funnelStatus: string; count: number }>
      topSources?: Array<{ utmSource: string; count: number }>
      topCampaigns?: Array<{ utmCampaign: string; count: number }>
      recentConversations?: Array<{
        id: string
        unitSlug: string
        waClickId: string
        funnelStatus: string
        needsHuman: boolean
        updatedAt: string
        lastMessageAt: string | null
        phone: string | null
        externalId: string | null
        utmSource: string | null
        utmCampaign: string | null
      }>
      recentAppointments?: Array<{
        id: string
        unitSlug: string | null
        waClickId: string
        status: string
        startAt: string | null
        createdAt: string
        phone: string | null
        externalId: string | null
        utmSource: string | null
        utmCampaign: string | null
      }>
    }
  }
}

const WINDOW_OPTIONS = [7, 30, 60]

function formatNumber(value: number | string | null | undefined): string {
  const parsed = typeof value === 'number' ? value : Number(value || 0)
  if (!Number.isFinite(parsed)) return '0'
  return new Intl.NumberFormat('pt-BR').format(parsed)
}

function formatPercent(numerator: number, denominator: number): number {
  if (!denominator) return 0
  return Math.max(0, Math.min(100, Math.round((numerator / denominator) * 100)))
}

function formatDashboardLabel(value: string | null | undefined): string {
  const normalized = String(value || '').trim()
  if (!normalized) return '—'
  if (normalized === 'sem_tracking_context') return 'sem tracking_context'
  if (normalized === 'sem_campanha') return 'sem campanha'
  return normalized
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
    <Card className="glass-card border-white/10">
      <CardContent className="pt-6">
        <div className="space-y-2">
          <p className="text-xs uppercase tracking-[0.2em] text-blue-100/60">{title}</p>
          <div className={`text-3xl font-semibold ${toneClass}`}>{value}</div>
          <p className="text-sm text-blue-100/70">{hint}</p>
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
    <Card className="glass-card border-white/10">
      <CardHeader>
        <CardTitle className="text-base text-white">{title}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {items.length === 0 ? (
          <div className="text-sm text-blue-100/60">{emptyLabel}</div>
        ) : (
          items.map((item) => (
            <div key={`${item.label}-${item.value}`} className="flex items-center justify-between gap-3 text-sm">
              <span className="truncate text-blue-100/80">{item.label}</span>
              <span className="font-medium text-white">{item.value}</span>
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
  const websiteConfig = data?.website?.data?.config
  const whatsappSummary = data?.whatsapp?.data?.summary || {}
  const scheduleSkipped =
    Number(websiteSummary.capiScheduleSkippedNoConfig || 0) +
    Number(websiteSummary.capiScheduleSkippedConsent || 0)
  const contactSkipped =
    Number(websiteSummary.capiContactSkippedNoConfig || 0) +
    Number(websiteSummary.capiContactSkippedConsent || 0)
  const scheduleAttempted = Number(websiteSummary.capiScheduleOk || 0) + Number(websiteSummary.capiScheduleFailed || 0)
  const contactAttempted = Number(websiteSummary.capiContactOk || 0) + Number(websiteSummary.capiContactFailed || 0)

  const siteCoverage = useMemo(() => {
    const confirmed = Number(websiteSummary.confirmedBookings || 0)
    return {
      tracking: formatPercent(Number(websiteSummary.bookingsWithTrackingContext || 0), confirmed),
      metaEvent: formatPercent(Number(websiteSummary.bookingsWithMetaEventId || 0), confirmed),
      facebookIds: formatPercent(Number(websiteSummary.bookingsWithFacebookIds || 0), confirmed),
      analyticsConsent: formatPercent(Number(websiteSummary.bookingsWithAnalyticsConsent || 0), confirmed),
      marketingConsent: formatPercent(Number(websiteSummary.bookingsWithMarketingConsent || 0), confirmed),
    }
  }, [websiteSummary])

  const scheduleDeliveryRate = useMemo(() => {
    const ok = Number(websiteSummary.capiScheduleOk || 0)
    const fail = Number(websiteSummary.capiScheduleFailed || 0)
    return formatPercent(ok, ok + fail)
  }, [websiteSummary])

  const contactDeliveryRate = useMemo(() => {
    const ok = Number(websiteSummary.capiContactOk || 0)
    const fail = Number(websiteSummary.capiContactFailed || 0)
    return formatPercent(ok, ok + fail)
  }, [websiteSummary])

  const topSourceItems = (data?.website?.data?.topSources || []).map((item) => ({
    label: formatDashboardLabel(item.utmSource || 'direto'),
    value: formatNumber(item.count),
  }))
  const topCampaignItems = (data?.website?.data?.topCampaigns || []).map((item) => ({
    label: formatDashboardLabel(item.utmCampaign || 'sem_campanha'),
    value: formatNumber(item.count),
  }))
  const whatsappSourceItems = (data?.whatsapp?.data?.topSources || []).map((item) => ({
    label: formatDashboardLabel(item.utmSource || 'direto'),
    value: formatNumber(item.count),
  }))
  const capiIssueItems = (data?.website?.data?.capiIssueReasons || []).map((item) => ({
    label: formatDashboardLabel(item.reason),
    value: formatNumber(item.count),
  }))

  return (
    <div className="space-y-6">
      <Card className="glass-card border-white/10 overflow-hidden">
        <CardHeader className="border-b border-white/10 bg-white/[0.03]">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
            <div className="space-y-2">
              <CardTitle className="text-2xl text-white flex items-center gap-3">
                <ChartBar className="h-6 w-6 text-blue-300" />
                Acompanhamento de Tracking e Conversao
              </CardTitle>
              <CardDescription className="text-blue-100/70 max-w-3xl">
                Visao consolidada do funil site - Meta - WhatsApp - agendamento, usando os eventos reais publicados no
                website e os registros correlacionados no CRM/n8n.
              </CardDescription>
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <div className="flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.04] p-1">
                {WINDOW_OPTIONS.map((option) => (
                  <button
                    key={option}
                    type="button"
                    onClick={() => setDays(option)}
                    className={`rounded-full px-3 py-1.5 text-sm transition ${
                      option === days ? 'bg-white/[0.16] text-white' : 'text-blue-100/70 hover:text-white'
                    }`}
                  >
                    {option}d
                  </button>
                ))}
              </div>
              <Button
                variant="outline"
                className="border-white/15 bg-white/[0.04] text-blue-100 hover:bg-white/[0.08] hover:text-white"
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
            <div className="rounded-2xl border border-amber-400/30 bg-amber-500/10 p-5 text-amber-100">
              <div className="flex items-center gap-2 font-medium">
                <WarningCircle className="h-5 w-5" />
                Painel parcial
              </div>
              <div className="mt-3 flex flex-wrap gap-2">
                {data.warnings.map((warning) => (
                  <Badge key={warning} variant="outline" className="border-amber-300/30 text-amber-100">
                    {warning}
                  </Badge>
                ))}
              </div>
            </div>
          ) : null}

          {websiteConfig?.metaCapiConfigured === false ? (
            <div className="rounded-2xl border border-red-400/30 bg-red-500/10 p-5 text-red-100">
              <div className="flex items-center gap-2 font-medium">
                <WarningCircle className="h-5 w-5" />
                Conversions API sem configuração válida no runtime do site
              </div>
              <p className="mt-2 text-sm text-red-100/80">
                O painel live indica que o browser pode até disparar Pixel, mas o envio server-side ainda não está pronto
                para a Meta neste ambiente.
              </p>
            </div>
          ) : null}

          <div className="grid gap-4 xl:grid-cols-4">
            <div className="rounded-2xl border border-blue-400/20 bg-blue-500/10 p-4">
              <div className="text-xs uppercase tracking-[0.2em] text-blue-100/60">Clique WhatsApp no site</div>
              <div className="mt-2 text-2xl font-semibold text-white">{formatNumber(data?.funnel?.siteWhatsappClicks || 0)}</div>
            </div>
            <div className="flex items-center justify-center text-blue-100/50">
              <ArrowRight className="h-6 w-6" />
            </div>
            <div className="rounded-2xl border border-emerald-400/20 bg-emerald-500/10 p-4">
              <div className="text-xs uppercase tracking-[0.2em] text-blue-100/60">Conversas com wa_click_id</div>
              <div className="mt-2 text-2xl font-semibold text-white">{formatNumber(data?.funnel?.crmAttributedConversations || 0)}</div>
            </div>
            <div className="rounded-2xl border border-fuchsia-400/20 bg-fuchsia-500/10 p-4">
              <div className="text-xs uppercase tracking-[0.2em] text-blue-100/60">Agendamentos WhatsApp atribuidos</div>
              <div className="mt-2 text-2xl font-semibold text-white">{formatNumber(data?.funnel?.crmAttributedAppointments || 0)}</div>
            </div>
          </div>

          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
            <MetricCard
              title="Agendamentos confirmados no site"
              value={formatNumber(websiteSummary.confirmedBookings || 0)}
              hint="Base do evento principal Schedule."
              tone="success"
            />
            <MetricCard
              title="Schedule via CAPI OK"
              value={formatNumber(websiteSummary.capiScheduleOk || 0)}
              hint={
                scheduleAttempted > 0
                  ? `${scheduleDeliveryRate}% de sucesso nos envios tentados. ${formatNumber(scheduleSkipped)} skip(s).`
                  : `${formatNumber(scheduleSkipped)} skip(s) e nenhum envio efetivamente tentado no periodo.`
              }
              tone={
                scheduleAttempted > 0
                  ? scheduleDeliveryRate >= 90
                    ? 'success'
                    : scheduleDeliveryRate >= 70
                      ? 'warning'
                      : 'danger'
                  : scheduleSkipped > 0 || websiteConfig?.metaCapiConfigured === false
                    ? 'danger'
                    : 'warning'
              }
            />
            <MetricCard
              title="Contact via CAPI OK"
              value={formatNumber(websiteSummary.capiContactOk || 0)}
              hint={
                contactAttempted > 0
                  ? `${contactDeliveryRate}% de sucesso nos envios tentados. ${formatNumber(contactSkipped)} skip(s).`
                  : `${formatNumber(contactSkipped)} skip(s) e nenhum envio efetivamente tentado no periodo.`
              }
              tone={
                contactAttempted > 0
                  ? contactDeliveryRate >= 90
                    ? 'success'
                    : contactDeliveryRate >= 70
                      ? 'warning'
                      : 'danger'
                  : contactSkipped > 0 || websiteConfig?.metaCapiConfigured === false
                    ? 'danger'
                    : 'warning'
              }
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
              title="Consentimento analytics"
              value={`${siteCoverage.analyticsConsent}%`}
              hint="Bookings confirmados com analytics permitido."
              tone={siteCoverage.analyticsConsent >= 70 ? 'success' : siteCoverage.analyticsConsent >= 40 ? 'warning' : 'danger'}
            />
            <MetricCard
              title="Consentimento marketing"
              value={`${siteCoverage.marketingConsent}%`}
              hint="Bookings confirmados aptos a enviar sinais de marketing."
              tone={siteCoverage.marketingConsent >= 60 ? 'success' : siteCoverage.marketingConsent >= 30 ? 'warning' : 'danger'}
            />
          </div>

          <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
            <SmallList title="Top fontes do site" items={topSourceItems} emptyLabel="Sem origem UTM suficiente no periodo." />
            <SmallList title="Top campanhas do site" items={topCampaignItems} emptyLabel="Sem campanhas registradas no periodo." />
            <SmallList title="Top fontes no WhatsApp correlacionado" items={whatsappSourceItems} emptyLabel="Sem source_tracking nas conversas correlacionadas." />
          </div>

          <SmallList title="Principais motivos de issue no CAPI" items={capiIssueItems} emptyLabel="Sem falhas ou skips registrados no periodo." />

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
                <div>
                  <div className="mb-2 flex items-center justify-between text-sm text-blue-100/70">
                    <span>Consentimento analytics</span>
                    <span>{siteCoverage.analyticsConsent}%</span>
                  </div>
                  <Progress value={siteCoverage.analyticsConsent} className="h-2" />
                </div>
                <div>
                  <div className="mb-2 flex items-center justify-between text-sm text-blue-100/70">
                    <span>Consentimento marketing</span>
                    <span>{siteCoverage.marketingConsent}%</span>
                  </div>
                  <Progress value={siteCoverage.marketingConsent} className="h-2" />
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
                  <WhatsappLogo className="h-5 w-5 text-emerald-300" />
                  Fechamento via WhatsApp
                </CardTitle>
                <CardDescription className="text-blue-100/70">
                  Correlacao entre clique first-party, conversa e agendamento.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
                    <div className="text-xs uppercase tracking-[0.15em] text-blue-100/60">Conversas atribuídas</div>
                    <div className="mt-2 text-2xl font-semibold text-white">{formatNumber(whatsappSummary.conversations_attributed || 0)}</div>
                  </div>
                  <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
                    <div className="text-xs uppercase tracking-[0.15em] text-blue-100/60">Agendamentos atribuídos</div>
                    <div className="mt-2 text-2xl font-semibold text-white">{formatNumber(whatsappSummary.appointments_attributed || 0)}</div>
                  </div>
                </div>
                <div className="space-y-2">
                  {(data?.whatsapp?.data?.stages || []).slice(0, 5).map((stage) => (
                    <div key={stage.funnelStatus} className="flex items-center justify-between rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2 text-sm">
                      <span className="text-blue-100/75">{stage.funnelStatus}</span>
                      <span className="font-medium text-white">{formatNumber(stage.count)}</span>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          </div>

          <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
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
                            {item.unitSlug} • {formatDashboardLabel(item.utmSource || 'direto')} • {formatDashboardLabel(item.utmCampaign || 'sem_campanha')}
                          </div>
                        </div>
                        <div className="flex flex-wrap gap-2">
                          <Badge variant="outline" className={item.hasFacebookIds ? 'border-emerald-300/30 text-emerald-100' : 'border-amber-300/30 text-amber-100'}>
                            {item.hasFacebookIds ? 'FB IDs OK' : 'FB IDs faltando'}
                          </Badge>
                          <Badge variant="outline" className={item.marketingConsent ? 'border-emerald-300/30 text-emerald-100' : 'border-white/15 text-blue-100'}>
                            {item.marketingConsent ? 'marketing ok' : 'sem marketing'}
                          </Badge>
                        </div>
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
          </div>

            <Card className="glass-card border-white/10">
              <CardHeader>
                <CardTitle className="text-white">Falhas e skips recentes de entrega server-side</CardTitle>
                <CardDescription className="text-blue-100/70">
                  Erros reais e skips intencionais do `Contact` ou `Schedule` enviados pela camada server-side do site.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                {(data?.website?.data?.recentCapiIssues || []).length === 0 ? (
                  <div className="text-sm text-emerald-200/90">Nenhuma falha recente registrada no periodo consultado.</div>
                ) : (
                  data?.website?.data?.recentCapiIssues?.map((item) => {
                    const reason = String(item.errorMessage || '').trim()
                    const isSkip = reason === 'missing_meta_capi_config' || reason === 'marketing_consent_denied'
                    return (
                    <div key={item.id} className={`rounded-2xl p-4 ${isSkip ? 'border border-amber-400/20 bg-amber-500/10' : 'border border-red-400/20 bg-red-500/10'}`}>
                      <div className="flex flex-wrap items-center justify-between gap-3">
                        <div className={`font-medium ${isSkip ? 'text-amber-100' : 'text-red-100'}`}>
                          {item.eventName} • status {item.httpStatus || 'sem HTTP'}
                        </div>
                        <div className={`text-xs ${isSkip ? 'text-amber-100/70' : 'text-red-100/70'}`}>{formatDateTime(item.createdAtMs)}</div>
                      </div>
                      <div className={`mt-2 text-sm ${isSkip ? 'text-amber-100/80' : 'text-red-100/80'}`}>
                        {formatDashboardLabel(item.errorMessage || 'Sem mensagem de erro detalhada.')}
                      </div>
                      <div className={`mt-2 text-xs ${isSkip ? 'text-amber-100/65' : 'text-red-100/65'}`}>
                        event_id: {item.eventId} {item.waClickId ? `• wa_click_id: ${item.waClickId}` : ''}
                      </div>
                    </div>
                  )})
                )}
              </CardContent>
            </Card>
        </CardContent>
      </Card>
    </div>
  )
}
