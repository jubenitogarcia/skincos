import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import { Badge } from '@/badge'
import { Button } from '@/button'
import { getMetaTrackingLocalOverview, isMetaTrackingLocalMockEnabled, type TrackingOverviewResponse } from '@/metaTrackingLocalMock'
import { ArrowClockwise, ChartLineUp, CursorClick, Funnel, LinkSimple, Pulse, WarningCircle } from '@phosphor-icons/react'

type WindowDays = 7 | 30 | 60 | 90

const WINDOW_OPTIONS: WindowDays[] = [7, 30, 60, 90]

function n(value: unknown): number {
  const parsed = Number(value || 0)
  return Number.isFinite(parsed) ? parsed : 0
}

export function formatSiteTrackingNumber(value: unknown): string {
  return new Intl.NumberFormat('pt-BR').format(n(value))
}

export function formatSiteTrackingPercent(value: unknown): string {
  return `${formatSiteTrackingNumber(value)}%`
}

export function siteTrackingHealthTone(status?: string | null) {
  if (status === 'healthy') return 'border-emerald-400/30 bg-emerald-500/10 text-emerald-100'
  if (status === 'critical') return 'border-red-400/30 bg-red-500/10 text-red-100'
  return 'border-amber-400/30 bg-amber-500/10 text-amber-100'
}

export function funnelBarWidth(value: unknown, max: unknown): string {
  const denominator = Math.max(1, n(max))
  return `${Math.max(4, Math.min(100, Math.round((n(value) / denominator) * 100)))}%`
}

function fmtDate(ms?: number | null) {
  if (!ms) return 'sem data'
  return new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short' }).format(new Date(ms))
}

function shortUrl(value?: string | null) {
  if (!value) return 'sem link'
  try {
    const url = new URL(value)
    return `${url.hostname}${url.pathname}${url.search ? '?...' : ''}`
  } catch {
    return value.length > 72 ? `${value.slice(0, 72)}...` : value
  }
}

function listOrEmpty<T>(items: T[] | undefined | null): T[] {
  return Array.isArray(items) ? items : []
}

async function fetchSiteTrackingOverview(days: WindowDays): Promise<TrackingOverviewResponse> {
  if (isMetaTrackingLocalMockEnabled()) return getMetaTrackingLocalOverview(days)
  const response = await fetch(`/api/tracking/overview?days=${days}&limit=12`, { credentials: 'include' })
  const data = await response.json().catch(() => null)
  if (!response.ok || !data?.ok) {
    throw new Error(data?.message || data?.error || `tracking_overview_${response.status}`)
  }
  return data as TrackingOverviewResponse
}

function MetricCard({ label, value, detail }: { label: string; value: string; detail?: string }) {
  return (
    <div className="rounded-lg border border-white/10 bg-white/[0.04] p-4">
      <div className="text-xs font-semibold uppercase tracking-wide text-slate-400">{label}</div>
      <div className="mt-2 text-2xl font-semibold text-white">{value}</div>
      {detail ? <div className="mt-1 text-xs text-slate-400">{detail}</div> : null}
    </div>
  )
}

function Section({ title, icon, children }: { title: string; icon: ReactNode; children: ReactNode }) {
  return (
    <section className="rounded-lg border border-white/10 bg-slate-950/60 p-5">
      <div className="mb-4 flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-slate-300">
        {icon}
        {title}
      </div>
      {children}
    </section>
  )
}

function RankedList({
  items,
  labelKey,
  empty,
}: {
  items: Array<Record<string, unknown>>
  labelKey: string
  empty: string
}) {
  if (!items.length) return <div className="text-sm text-slate-500">{empty}</div>
  const max = Math.max(...items.map((item) => n(item.count)))
  return (
    <div className="space-y-3">
      {items.map((item, index) => {
        const label = String(item[labelKey] || 'sem valor')
        const count = n(item.count)
        return (
          <div key={`${label}-${index}`} className="space-y-1">
            <div className="flex items-center justify-between gap-3 text-sm">
              <span className="min-w-0 truncate text-slate-200">{label}</span>
              <span className="font-mono text-slate-400">{formatSiteTrackingNumber(count)}</span>
            </div>
            <div className="h-1.5 overflow-hidden rounded-full bg-white/10">
              <div className="h-full rounded-full bg-cyan-400" style={{ width: funnelBarWidth(count, max) }} />
            </div>
          </div>
        )
      })}
    </div>
  )
}

export function SiteTrackingModule() {
  const [days, setDays] = useState<WindowDays>(30)
  const [data, setData] = useState<TrackingOverviewResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      setData(await fetchSiteTrackingOverview(days))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'tracking_overview_failed')
    } finally {
      setLoading(false)
    }
  }, [days])

  useEffect(() => {
    void load()
  }, [load])

  const summary = data?.website?.data?.summary || {}
  const behaviorSummary = data?.siteBehavior?.summary || {}
  const funnel = data?.siteFunnel || {}
  const quality = data?.behaviorQuality || {}
  const alerts = listOrEmpty(data?.alerts)

  const funnelRows = useMemo(() => [
    { label: 'Sessões', value: n(funnel.sessions) },
    { label: 'Pageviews', value: n(funnel.pageViews) },
    { label: 'Cliques CTA/link', value: n(funnel.ctaClicks) },
    { label: 'Agendamento iniciado', value: n(funnel.bookingStarted) },
    { label: 'Etapa final aberta', value: n(funnel.finalStepOpened) },
    { label: 'Agendamentos confirmados', value: n(funnel.confirmedBookings) },
  ], [funnel])
  const funnelMax = Math.max(...funnelRows.map((row) => row.value), 1)

  return (
    <div className="space-y-6 text-slate-100">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-cyan-200">
            <Pulse className="h-5 w-5" />
            Site Tracking
          </div>
          <h1 className="mt-2 text-3xl font-semibold text-white">espacofacial.com</h1>
          <p className="mt-1 max-w-3xl text-sm text-slate-400">
            Acompanhamento agregado de comportamento, campanhas, links personalizados, WhatsApp, agendamentos e qualidade de tracking do site.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {WINDOW_OPTIONS.map((option) => (
            <Button
              key={option}
              variant={days === option ? 'default' : 'outline'}
              size="sm"
              onClick={() => setDays(option)}
            >
              {option}d
            </Button>
          ))}
          <Button variant="outline" size="sm" onClick={load} disabled={loading}>
            <ArrowClockwise className={loading ? 'animate-spin' : ''} />
            Atualizar
          </Button>
        </div>
      </div>

      {error ? (
        <div className="rounded-lg border border-red-400/30 bg-red-500/10 p-4 text-red-100">
          Falha ao carregar tracking do site: {error}
        </div>
      ) : null}

      {data?.health ? (
        <div className={`rounded-lg border p-4 ${siteTrackingHealthTone(data.health.status)}`}>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <div className="text-sm font-semibold uppercase tracking-wide">Saúde do tracking: {data.health.label}</div>
              <div className="mt-1 text-sm opacity-90">{data.health.summary}</div>
            </div>
            {data.partial ? <Badge variant="warning">Leitura parcial</Badge> : <Badge variant="success">Leitura completa</Badge>}
          </div>
        </div>
      ) : null}

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <MetricCard label="Sessões anônimas" value={formatSiteTrackingNumber(behaviorSummary.sessions)} detail={`${formatSiteTrackingNumber(behaviorSummary.pageViews)} pageviews`} />
        <MetricCard label="Agendamentos" value={formatSiteTrackingNumber(summary.confirmedBookings)} detail={`${formatSiteTrackingPercent(data?.coverage?.trackingContext)} com tracking_context`} />
        <MetricCard label="WhatsApp no site" value={formatSiteTrackingNumber(summary.whatsappClicks)} detail={`${formatSiteTrackingPercent(data?.coverage?.whatsappTracking)} com contexto`} />
        <MetricCard label="Schedule CAPI OK" value={formatSiteTrackingNumber(summary.capiScheduleOk)} detail={`${formatSiteTrackingPercent(data?.coverage?.scheduleDelivery)} entrega`} />
        <MetricCard label="FB IDs" value={formatSiteTrackingPercent(data?.coverage?.facebookIds)} detail="fbp/fbc/fbclid em bookings" />
        <MetricCard label="Consentimento marketing" value={formatSiteTrackingPercent(data?.coverage?.marketingConsent)} detail="bookings confirmados" />
        <MetricCard label="Campanhas em eventos" value={formatSiteTrackingPercent(quality.campaignCoverage)} detail={`${formatSiteTrackingNumber(quality.eventsWithCampaign)} eventos com utm_campaign`} />
        <MetricCard label="Taxa visita -> booking" value={formatSiteTrackingPercent(funnel.visitToBookingRate)} detail={`${formatSiteTrackingNumber(funnel.confirmedBookings)} confirmações`} />
      </div>

      {alerts.length ? (
        <Section title="Alertas operacionais" icon={<WarningCircle className="h-5 w-5" />}>
          <div className="grid gap-3 md:grid-cols-2">
            {alerts.map((alert) => (
              <div key={alert.code} className="rounded-lg border border-white/10 bg-white/[0.03] p-4">
                <Badge variant={alert.severity === 'critical' ? 'destructive' : 'warning'}>{alert.severity}</Badge>
                <div className="mt-3 font-semibold text-white">{alert.title}</div>
                <div className="mt-1 text-sm text-slate-400">{alert.message}</div>
              </div>
            ))}
          </div>
        </Section>
      ) : null}

      <div className="grid gap-6 xl:grid-cols-[1.1fr_0.9fr]">
        <Section title="Funil do site" icon={<Funnel className="h-5 w-5" />}>
          <div className="space-y-4">
            {funnelRows.map((row) => (
              <div key={row.label} className="space-y-1">
                <div className="flex items-center justify-between text-sm">
                  <span className="text-slate-300">{row.label}</span>
                  <span className="font-mono text-white">{formatSiteTrackingNumber(row.value)}</span>
                </div>
                <div className="h-2 overflow-hidden rounded-full bg-white/10">
                  <div className="h-full rounded-full bg-emerald-400" style={{ width: funnelBarWidth(row.value, funnelMax) }} />
                </div>
              </div>
            ))}
          </div>
        </Section>

        <Section title="Qualidade de tracking" icon={<ChartLineUp className="h-5 w-5" />}>
          <div className="grid gap-3 sm:grid-cols-2">
            <MetricCard label="tracking_context" value={formatSiteTrackingPercent(data?.coverage?.trackingContext)} />
            <MetricCard label="meta_event_id" value={formatSiteTrackingPercent(data?.coverage?.metaEventId)} />
            <MetricCard label="FB IDs" value={formatSiteTrackingPercent(data?.coverage?.facebookIds)} />
            <MetricCard label="Marketing" value={formatSiteTrackingPercent(data?.coverage?.marketingConsent)} />
          </div>
        </Section>
      </div>

      <div className="grid gap-6 xl:grid-cols-3">
        <Section title="Páginas mais vistas" icon={<CursorClick className="h-5 w-5" />}>
          <RankedList items={listOrEmpty(data?.siteBehavior?.topPages)} labelKey="pagePath" empty="Sem pageviews agregados ainda." />
        </Section>
        <Section title="Entradas" icon={<CursorClick className="h-5 w-5" />}>
          <RankedList items={listOrEmpty(data?.siteBehavior?.topEntryPages)} labelKey="pagePath" empty="Sem páginas de entrada no período." />
        </Section>
        <Section title="Campanhas" icon={<LinkSimple className="h-5 w-5" />}>
          <RankedList items={listOrEmpty(data?.website?.data?.topCampaigns)} labelKey="utmCampaign" empty="Sem campanhas atribuídas no período." />
        </Section>
      </div>

      <div className="grid gap-6 xl:grid-cols-2">
        <Section title="Links personalizados e CTAs" icon={<LinkSimple className="h-5 w-5" />}>
          <RankedList items={listOrEmpty(data?.customLinks?.topLinks)} labelKey="linkUrl" empty="Sem cliques em links rastreados." />
        </Section>
        <Section title="Links sem UTM" icon={<WarningCircle className="h-5 w-5" />}>
          <RankedList items={listOrEmpty(data?.customLinks?.linksMissingUtm)} labelKey="linkUrl" empty="Nenhum link sem UTM relevante no período." />
        </Section>
      </div>

      <div className="grid gap-6 xl:grid-cols-2">
        <Section title="Bookings com tracking incompleto" icon={<WarningCircle className="h-5 w-5" />}>
          <div className="space-y-3">
            {listOrEmpty(data?.reconciliation?.incompleteBookings).slice(0, 8).map((booking) => (
              <div key={booking.id} className="rounded-lg border border-white/10 bg-white/[0.03] p-3">
                <div className="flex items-center justify-between gap-3">
                  <span className="font-mono text-xs text-slate-400">{booking.id}</span>
                  <Badge variant="outline">{booking.primaryCause}</Badge>
                </div>
                <div className="mt-2 text-sm text-slate-300">{booking.unitSlug} · {booking.utmSource || 'sem origem'} · {booking.utmCampaign || 'sem campanha'}</div>
              </div>
            ))}
            {!listOrEmpty(data?.reconciliation?.incompleteBookings).length ? <div className="text-sm text-slate-500">Nenhum booking incompleto no período.</div> : null}
          </div>
        </Section>

        <Section title="Cliques recentes" icon={<CursorClick className="h-5 w-5" />}>
          <div className="space-y-3">
            {listOrEmpty(data?.customLinks?.recentClicks).slice(0, 8).map((click) => (
              <div key={click.id} className="rounded-lg border border-white/10 bg-white/[0.03] p-3">
                <div className="flex items-center justify-between gap-3">
                  <span className="text-sm font-semibold text-white">{click.eventName}</span>
                  <span className="text-xs text-slate-500">{fmtDate(click.createdAtMs)}</span>
                </div>
                <div className="mt-1 truncate text-sm text-slate-300">{shortUrl(click.linkUrl)}</div>
                <div className="mt-1 text-xs text-slate-500">{click.utmCampaign || 'sem campanha'} · {click.placement || 'sem placement'}</div>
              </div>
            ))}
            {!listOrEmpty(data?.customLinks?.recentClicks).length ? <div className="text-sm text-slate-500">Nenhum clique recente no período.</div> : null}
          </div>
        </Section>
      </div>
    </div>
  )
}

export default SiteTrackingModule
