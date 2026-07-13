import { useCallback, useEffect, useMemo, useState } from 'react'
import type { DropResult } from '@hello-pangea/dnd'
import { getMetaTrackingLocalOverview, isMetaTrackingLocalMockEnabled, type TrackingOverviewResponse } from '@/metaTrackingLocalMock'
import {
  ConnectionNotice,
  ManagedSiteUrlsSection,
  OperationalAlerts,
  SiteBehaviorSections,
  SiteFunnelSection,
  SiteIssueAndClickSections,
  SiteLinkSections,
  SiteMetricsGrid,
  type SiteConnectionForm,
  type ManagedSiteUrlForm,
} from '@/siteTrackingComponents'
import { emitSiteTrackingHeaderState, subscribeSiteTrackingHeaderAction } from '@/siteTrackingHeaderBridge'
import {
  DEFAULT_SITE_METRIC_LAYOUT,
  SITE_TRACKING_METRIC_LAYOUT_KEY,
  formatSiteTrackingNumber,
  formatSiteTrackingPercent,
  isInternalPreviewAlert,
  listOrEmpty,
  parseSiteMetricLayout,
  siteTrackingNumberValue,
  type SiteMetricAspect,
  type SiteMetricKey,
  type SiteMetricLayout,
  type WindowDays,
} from '@/siteTrackingPresentation'
import type { SiteTrackingHeaderSiteOption } from '@/siteTrackingTypes'
import {
  ArrowClockwise,
  ChartLineUp,
  CursorClick,
  Funnel,
  LinkSimple,
  Pulse,
  ShieldCheck,
  WhatsappLogo,
} from '@phosphor-icons/react'

const SITE_OPTIONS: SiteTrackingHeaderSiteOption[] = [
  {
    id: 'espacofacial.com',
    name: 'espacofacial.com',
    host: 'espacofacial.com',
    statusLabel: 'Domínio principal',
    statusTone: 'success',
  },
]
const SITE_TRACKING_SITE_NAMES_KEY = 'skincos.siteTracking.siteNames.v1'

async function fetchSiteTrackingOverview(days: WindowDays, siteHost: string): Promise<TrackingOverviewResponse> {
  if (isMetaTrackingLocalMockEnabled()) return getMetaTrackingLocalOverview(days)
  const params = new URLSearchParams({ days: String(days), limit: '12' })
  if (siteHost) params.set('siteHost', siteHost)
  const response = await fetch(`/api/tracking/overview?${params.toString()}`, { credentials: 'include' })
  const data = await response.json().catch(() => null)
  if (!response.ok || !data?.ok) {
    throw new Error(data?.message || data?.error || `Não foi possível carregar os dados do site (${response.status})`)
  }
  return data as TrackingOverviewResponse
}

export function SiteTrackingModule() {
  const [days, setDays] = useState<WindowDays>(30)
  const [selectedSiteId, setSelectedSiteId] = useState('espacofacial.com')
  const [data, setData] = useState<TrackingOverviewResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [connectionNoticeOpen, setConnectionNoticeOpen] = useState(false)
  const [savingManagedUrl, setSavingManagedUrl] = useState(false)
  const [savingSiteConnection, setSavingSiteConnection] = useState(false)
  const [renameSiteId, setRenameSiteId] = useState<string | null>(null)
  const [renameValue, setRenameValue] = useState('')
  const [siteNameOverrides, setSiteNameOverrides] = useState<Record<string, string>>(() => {
    try {
      if (typeof window === 'undefined') return {}
      const parsed = JSON.parse(window.localStorage.getItem(SITE_TRACKING_SITE_NAMES_KEY) || '{}')
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {}
    } catch {
      return {}
    }
  })
  const [metricLayout, setMetricLayout] = useState<SiteMetricLayout[]>(() => {
    try {
      if (typeof window === 'undefined') return DEFAULT_SITE_METRIC_LAYOUT
      return parseSiteMetricLayout(window.localStorage.getItem(SITE_TRACKING_METRIC_LAYOUT_KEY))
    } catch {
      return DEFAULT_SITE_METRIC_LAYOUT
    }
  })

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      setData(await fetchSiteTrackingOverview(days, selectedSiteId))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Não foi possível carregar os dados do site')
    } finally {
      setLoading(false)
    }
  }, [days, selectedSiteId])

  useEffect(() => {
    void load()
  }, [load])

  useEffect(() => {
    try {
      window.localStorage.setItem(SITE_TRACKING_METRIC_LAYOUT_KEY, JSON.stringify(metricLayout))
    } catch {
      // ignore local layout persistence errors
    }
  }, [metricLayout])

  useEffect(() => {
    try {
      window.localStorage.setItem(SITE_TRACKING_SITE_NAMES_KEY, JSON.stringify(siteNameOverrides))
    } catch {
      // ignore local name persistence errors
    }
  }, [siteNameOverrides])

  const summary = useMemo(() => data?.website?.data?.summary || {}, [data?.website?.data?.summary])
  const behaviorSummary = useMemo(() => data?.siteBehavior?.summary || {}, [data?.siteBehavior?.summary])
  const funnel = useMemo(() => data?.siteFunnel || {}, [data?.siteFunnel])
  const quality = useMemo(() => data?.behaviorQuality || {}, [data?.behaviorQuality])
  const alerts = listOrEmpty(data?.alerts)
  const operationalAlerts = alerts.filter((alert) => !isInternalPreviewAlert(alert))
  const siteOptions = useMemo(() => {
    const sites = new Map<string, SiteTrackingHeaderSiteOption>()
    SITE_OPTIONS.forEach((site) => sites.set(site.id, site))
    ;(data?.siteConnections?.sites || []).forEach((site) => {
      if (site.active === false) return
      sites.set(site.siteHost, {
        id: site.siteHost,
        name: site.name || site.siteHost,
        host: site.siteHost,
        statusLabel: site.statusLabel || 'Conexão ativa',
        statusTone: site.statusTone === 'warning' || site.statusTone === 'danger' || site.statusTone === 'neutral' ? site.statusTone : 'success',
      })
    })
    return Array.from(sites.values()).map((site) => ({
      ...site,
      name: siteNameOverrides[site.id] || site.name,
    }))
  }, [data?.siteConnections?.sites, siteNameOverrides])
  const selectedSite = siteOptions.find((site) => site.id === selectedSiteId) || siteOptions[0]
  const headerUpdatedAt = data?.generatedAt ? new Date(data.generatedAt).toISOString() : undefined
  const dataSourceLabel = data?.website?.data?.source || (data?.website?.available ? 'website_d1' : null)

  useEffect(() => {
    emitSiteTrackingHeaderState({
      refreshing: loading,
      sites: siteOptions,
      selectedSiteId,
      selectedSiteName: selectedSite?.name,
      windowDays: days,
      updatedAt: headerUpdatedAt,
      dataSourceLabel: dataSourceLabel || undefined,
      dataSiteHost: selectedSite?.host || undefined,
    })
  }, [dataSourceLabel, days, headerUpdatedAt, loading, selectedSite?.host, selectedSite?.name, selectedSiteId, siteOptions])

  useEffect(() => () => emitSiteTrackingHeaderState(null), [])

  useEffect(() => {
    return subscribeSiteTrackingHeaderAction((action) => {
      if (action.type === 'refresh') {
        void load()
        return
      }
      if (action.type === 'set-window') {
        setDays(action.value)
        return
      }
      if (action.type === 'set-site') {
        setSelectedSiteId(action.value)
        return
      }
      if (action.type === 'connect') {
        setConnectionNoticeOpen(true)
        return
      }
      if (action.type === 'rename-site') {
        const siteId = action.value || selectedSiteId
        const currentSite = siteOptions.find((site) => site.id === siteId)
        const currentName = currentSite?.name || currentSite?.host || siteId
        setRenameSiteId(siteId)
        setRenameValue(currentName)
      }
    })
  }, [load, selectedSiteId, siteOptions])

  const funnelRows = useMemo(() => [
    { label: 'Sessões', value: siteTrackingNumberValue(funnel.sessions) },
    { label: 'Pageviews', value: siteTrackingNumberValue(funnel.pageViews) },
    { label: 'Cliques CTA/link', value: siteTrackingNumberValue(funnel.ctaClicks) },
    { label: 'Agendamento iniciado', value: siteTrackingNumberValue(funnel.bookingStarted) },
    { label: 'Etapa final aberta', value: siteTrackingNumberValue(funnel.finalStepOpened) },
    { label: 'Agendamentos confirmados', value: siteTrackingNumberValue(funnel.confirmedBookings) },
  ], [funnel])
  const funnelMax = Math.max(...funnelRows.map((row) => row.value), 1)
  const metricTiles = useMemo(() => [
    {
      key: 'sessions' as const,
      label: 'Visitas',
      tooltipLabel: 'Visitas no site',
      description: 'Volume agregado de pessoas navegando pelo site no período selecionado.',
      value: formatSiteTrackingNumber(behaviorSummary.sessions),
      detail: `${formatSiteTrackingNumber(behaviorSummary.pageViews)} páginas vistas`,
      icon: Pulse,
      toneClass: 'border-cyan-500/25 bg-cyan-500/12 text-cyan-100',
    },
    {
      key: 'bookings' as const,
      label: 'Agendamentos',
      tooltipLabel: 'Agendamentos confirmados',
      description: 'Reservas confirmadas pelo fluxo do site no período selecionado.',
      value: formatSiteTrackingNumber(summary.confirmedBookings),
      detail: `${formatSiteTrackingPercent(data?.coverage?.trackingContext)} com origem`,
      icon: Funnel,
      toneClass: 'border-emerald-500/25 bg-emerald-500/12 text-emerald-100',
    },
    {
      key: 'whatsapp' as const,
      label: 'WhatsApp',
      tooltipLabel: 'Cliques de WhatsApp no site',
      description: 'Cliques em WhatsApp saindo do site com origem preservada.',
      value: formatSiteTrackingNumber(summary.whatsappClicks),
      detail: `${formatSiteTrackingPercent(data?.coverage?.whatsappTracking)} com origem`,
      icon: WhatsappLogo,
      toneClass: 'border-green-500/25 bg-green-500/12 text-green-100',
    },
    {
      key: 'schedule' as const,
      label: 'Conversões Meta',
      tooltipLabel: 'Agendamentos enviados à Meta',
      description: 'Agendamentos confirmados enviados para melhorar a otimização das campanhas.',
      value: formatSiteTrackingNumber(summary.capiScheduleOk),
      detail: `${formatSiteTrackingPercent(data?.coverage?.scheduleDelivery)} enviados`,
      icon: ShieldCheck,
      toneClass: 'border-blue-500/25 bg-blue-500/12 text-blue-100',
    },
    {
      key: 'origin' as const,
      label: 'Origem preservada',
      tooltipLabel: 'Origem preservada',
      description: 'Percentual de agendamentos em que foi possível manter campanha, fonte ou origem até a reserva.',
      value: formatSiteTrackingPercent(data?.coverage?.trackingContext),
      detail: 'campanha ou canal',
      icon: LinkSimple,
      toneClass: 'border-teal-500/25 bg-teal-500/12 text-teal-100',
    },
    {
      key: 'reservationLink' as const,
      label: 'Reserva vinculada',
      tooltipLabel: 'Reserva vinculada',
      description: 'Percentual de reservas com identificação suficiente para evitar contagem duplicada nos relatórios.',
      value: formatSiteTrackingPercent(data?.coverage?.metaEventId),
      detail: 'sem duplicidade',
      icon: ShieldCheck,
      toneClass: 'border-sky-500/25 bg-sky-500/12 text-sky-100',
    },
    {
      key: 'facebook' as const,
      label: 'Atribuição Meta',
      tooltipLabel: 'Atribuição Meta',
      description: 'Reservas com sinais suficientes para associar a origem a campanhas da Meta.',
      value: formatSiteTrackingPercent(data?.coverage?.facebookIds),
      detail: 'cliques identificados',
      icon: LinkSimple,
      toneClass: 'border-indigo-500/25 bg-indigo-500/12 text-indigo-100',
    },
    {
      key: 'marketing' as const,
      label: 'Consentimento',
      tooltipLabel: 'Consentimento marketing',
      description: 'Agendamentos em que o visitante autorizou mensuração de marketing.',
      value: formatSiteTrackingPercent(data?.coverage?.marketingConsent),
      detail: 'reservas permitidas',
      icon: ChartLineUp,
      toneClass: 'border-violet-500/25 bg-violet-500/12 text-violet-100',
    },
    {
      key: 'campaign' as const,
      label: 'Campanhas',
      tooltipLabel: 'Campanhas identificadas',
      description: 'Interações do site com campanha identificada no período.',
      value: formatSiteTrackingPercent(quality.campaignCoverage),
      detail: `${formatSiteTrackingNumber(quality.eventsWithCampaign)} interações`,
      icon: CursorClick,
      toneClass: 'border-amber-500/25 bg-amber-500/12 text-amber-100',
    },
    {
      key: 'conversion' as const,
      label: 'Visita -> Reserva',
      tooltipLabel: 'Taxa de conversão visita para reserva',
      description: 'Taxa agregada de sessões que chegaram a agendamento confirmado.',
      value: formatSiteTrackingPercent(funnel.visitToBookingRate),
      detail: `${formatSiteTrackingNumber(funnel.confirmedBookings)} reservas`,
      icon: ArrowClockwise,
      toneClass: 'border-rose-500/25 bg-rose-500/12 text-rose-100',
    },
  ], [
    behaviorSummary.pageViews,
    behaviorSummary.sessions,
    data?.coverage?.facebookIds,
    data?.coverage?.marketingConsent,
    data?.coverage?.metaEventId,
    data?.coverage?.scheduleDelivery,
    data?.coverage?.trackingContext,
    data?.coverage?.whatsappTracking,
    funnel.confirmedBookings,
    funnel.visitToBookingRate,
    quality.campaignCoverage,
    quality.eventsWithCampaign,
    summary.capiScheduleOk,
    summary.confirmedBookings,
    summary.whatsappClicks,
  ])
  const visibleMetricTiles = useMemo(() => {
    const byKey = new Map(metricTiles.map((tile) => [tile.key, tile]))
    return metricLayout
      .map((config) => {
        const tile = byKey.get(config.key)
        if (!tile || !config.visible) return null
        return { ...tile, width: config.width, height: config.height, aspect: config.aspect }
      })
      .filter(Boolean) as Array<(typeof metricTiles)[number] & { width: number; height: number; aspect: SiteMetricAspect }>
  }, [metricLayout, metricTiles])
  const hiddenMetricTiles = useMemo(() => {
    const byKey = new Map(metricTiles.map((tile) => [tile.key, tile]))
    return metricLayout
      .filter((config) => !config.visible)
      .map((config) => byKey.get(config.key))
      .filter(Boolean) as typeof metricTiles
  }, [metricLayout, metricTiles])
  const updateMetricTile = (key: SiteMetricKey, patch: Partial<SiteMetricLayout>) => {
    setMetricLayout((prev) => prev.map((item) => (item.key === key ? { ...item, ...patch } : item)))
  }
  const saveManagedUrl = async (form: ManagedSiteUrlForm) => {
    setSavingManagedUrl(true)
    try {
      if (isMetaTrackingLocalMockEnabled()) {
        const now = Date.now()
        setData((prev) => {
          if (!prev) return prev
          const existing = prev.customLinks?.managedUrls || []
          const nextUrl = {
            id: form.id || `local_url_${now}`,
            siteHost: form.siteHost || selectedSiteId,
            name: form.name,
            slugPath: form.slugPath || `/campanhas/${form.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'link'}`,
            publicUrl: `https://${form.siteHost || selectedSiteId}${form.slugPath || `/campanhas/${form.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'link'}`}`,
            destinationUrl: form.destinationUrl,
            destinationHost: (() => {
              try { return new URL(form.destinationUrl).hostname } catch { return null }
            })(),
            destinationPath: (() => {
              try {
                const url = new URL(form.destinationUrl)
                return `${url.pathname}${url.search}${url.hash}`
              } catch {
                return null
              }
            })(),
            description: form.description || null,
            source: 'manual',
            placement: form.placement || null,
            unitSlug: form.unitSlug || null,
            serviceId: form.serviceId || null,
            utmSource: form.utmSource || null,
            utmMedium: form.utmMedium || null,
            utmCampaign: form.utmCampaign || null,
            utmContent: form.utmContent || null,
            utmTerm: form.utmTerm || null,
            active: form.active,
            createdAtMs: existing.find((item) => item.id === form.id)?.createdAtMs || now,
            updatedAtMs: now,
            clickCount: existing.find((item) => item.id === form.id)?.clickCount || 0,
            lastClickAtMs: existing.find((item) => item.id === form.id)?.lastClickAtMs || null,
          }
          return {
            ...prev,
            customLinks: {
              ...(prev.customLinks || {}),
              managedUrls: form.id ? existing.map((item) => (item.id === form.id ? nextUrl : item)) : [nextUrl, ...existing],
            },
          }
        })
        return
      }

      const response = await fetch('/api/tracking/custom-urls', {
        method: form.id ? 'PATCH' : 'POST',
        credentials: 'include',
        headers: { 'content-type': 'application/json', accept: 'application/json' },
        body: JSON.stringify({ ...form, siteHost: form.siteHost || selectedSiteId }),
      })
      const payload = await response.json().catch(() => null)
      if (!response.ok || payload?.ok === false) throw new Error(payload?.message || payload?.error || 'Não foi possível salvar a URL')
      await load()
    } finally {
      setSavingManagedUrl(false)
    }
  }
  const saveSiteConnection = async (form: SiteConnectionForm) => {
    setSavingSiteConnection(true)
    try {
      const siteHost = form.siteHost.trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, '').replace(/^www\./, '')
      if (!siteHost) throw new Error('Informe o domínio do site.')
      if (isMetaTrackingLocalMockEnabled()) {
        const now = Date.now()
        setData((prev) => {
          if (!prev) return prev
          const existing = prev.siteConnections?.sites || []
          const nextSite = {
            id: form.id || siteHost,
            siteHost,
            host: siteHost,
            name: form.name.trim() || siteHost,
            statusLabel: form.statusLabel.trim() || 'Conexão ativa',
            statusTone: form.statusTone,
            source: 'crm',
            active: form.active,
            createdAtMs: existing.find((item) => item.siteHost === siteHost)?.createdAtMs || now,
            updatedAtMs: now,
            eventCount: existing.find((item) => item.siteHost === siteHost)?.eventCount || 0,
            lastEventAtMs: existing.find((item) => item.siteHost === siteHost)?.lastEventAtMs || null,
          }
          return {
            ...prev,
            siteConnections: {
              ...(prev.siteConnections || {}),
              sites: existing.some((item) => item.siteHost === siteHost)
                ? existing.map((item) => (item.siteHost === siteHost ? nextSite : item))
                : [nextSite, ...existing],
            },
          }
        })
        setSelectedSiteId(siteHost)
        return
      }

      const response = await fetch('/api/tracking/site-connections', {
        method: form.id ? 'PATCH' : 'POST',
        credentials: 'include',
        headers: { 'content-type': 'application/json', accept: 'application/json' },
        body: JSON.stringify({ ...form, siteHost }),
      })
      const payload = await response.json().catch(() => null)
      if (!response.ok || payload?.ok === false) throw new Error(payload?.message || payload?.error || 'Não foi possível salvar a conexão')
      const savedHost = payload?.siteConnection?.siteHost || siteHost
      setSelectedSiteId(savedHost)
      await load()
    } finally {
      setSavingSiteConnection(false)
    }
  }
  const saveRename = () => {
    if (!renameSiteId) return
    const nextName = renameValue.trim()
    if (!nextName) return
    setSiteNameOverrides((prev) => ({ ...prev, [renameSiteId]: nextName }))
    setRenameSiteId(null)
    setRenameValue('')
  }
  const handleMetricDragEnd = (result: DropResult) => {
    if (!result.destination || result.destination.droppableId !== 'site-tracking-metrics') return
    if (result.source.index === result.destination.index) return
    const visibleKeys = metricLayout.filter((item) => item.visible).map((item) => item.key)
    const movedKey = visibleKeys[result.source.index]
    if (!movedKey) return
    setMetricLayout((prev) => {
      const next = [...prev]
      const sourceIndex = next.findIndex((item) => item.key === movedKey)
      if (sourceIndex < 0) return prev
      const [entry] = next.splice(sourceIndex, 1)
      const visibleAfterRemoval = next.filter((item) => item.visible)
      const beforeKey = visibleAfterRemoval[result.destination?.index ?? 0]?.key
      const destinationIndex = beforeKey ? next.findIndex((item) => item.key === beforeKey) : next.length
      next.splice(destinationIndex < 0 ? next.length : destinationIndex, 0, entry)
      return next
    })
  }

  return (
    <div className="min-w-0 max-w-full space-y-6 overflow-x-hidden text-slate-100">
      {error ? (
        <div className="rounded-lg border border-red-400/30 bg-red-500/10 p-4 text-red-100">
          Falha ao carregar acompanhamento do site: {error}
        </div>
      ) : null}

      {connectionNoticeOpen ? (
        <ConnectionNotice
          sites={data?.siteConnections?.sites || []}
          saving={savingSiteConnection}
          selectedSiteId={selectedSiteId}
          onClose={() => setConnectionNoticeOpen(false)}
          onSave={saveSiteConnection}
        />
      ) : null}

      {renameSiteId ? (
        <div className="fixed inset-0 z-[80] flex items-start justify-center bg-slate-950/70 px-4 pt-24 backdrop-blur-sm">
          <form
            className="w-full max-w-md rounded-2xl border border-cyan-400/20 bg-slate-950 p-5 text-slate-100 shadow-[0_24px_100px_rgba(8,145,178,0.18)]"
            onSubmit={(event) => {
              event.preventDefault()
              saveRename()
            }}
          >
            <div className="text-sm font-semibold uppercase tracking-wide text-cyan-100">Renomear site</div>
            <label className="mt-4 block space-y-1 text-xs font-medium uppercase tracking-[0.12em] text-slate-500">
              <span>Nome exibido</span>
              <input
                autoFocus
                value={renameValue}
                onChange={(event) => setRenameValue(event.target.value)}
                className="h-10 w-full rounded-lg border border-slate-800 bg-slate-950/70 px-3 text-sm font-normal normal-case tracking-normal text-slate-100 outline-none transition placeholder:text-slate-600 focus:border-cyan-400/50 focus:ring-2 focus:ring-cyan-400/20"
              />
            </label>
            <div className="mt-5 flex justify-end gap-2">
              <button
                type="button"
                className="h-9 rounded-lg border border-slate-700 px-3 text-sm text-slate-300 transition hover:bg-slate-800 hover:text-white"
                onClick={() => {
                  setRenameSiteId(null)
                  setRenameValue('')
                }}
              >
                Cancelar
              </button>
              <button
                type="submit"
                disabled={!renameValue.trim()}
                className="h-9 rounded-lg bg-cyan-500 px-3 text-sm font-semibold text-slate-950 transition hover:bg-cyan-400 disabled:cursor-not-allowed disabled:opacity-50"
              >
                Salvar
              </button>
            </div>
          </form>
        </div>
      ) : null}

      <SiteMetricsGrid
        hiddenMetricTiles={hiddenMetricTiles}
        visibleMetricTiles={visibleMetricTiles}
        onDragEnd={handleMetricDragEnd}
        onHide={(key) => updateMetricTile(key, { visible: false })}
        onResize={updateMetricTile}
        onRestore={() => setMetricLayout(DEFAULT_SITE_METRIC_LAYOUT)}
        onShow={(key) => updateMetricTile(key, { visible: true })}
      />

      <OperationalAlerts alerts={operationalAlerts} />
      <SiteFunnelSection rows={funnelRows} max={funnelMax} />
      <SiteBehaviorSections data={data} />
      <ManagedSiteUrlsSection
        defaultSiteHost={selectedSiteId}
        urls={listOrEmpty(data?.customLinks?.managedUrls)}
        cloudflareRedirects={listOrEmpty(data?.customLinks?.cloudflareRedirects)}
        saving={savingManagedUrl}
        onSave={saveManagedUrl}
      />
      <SiteLinkSections data={data} />
      <SiteIssueAndClickSections data={data} />
    </div>
  )
}

export default SiteTrackingModule
