import { useEffect, useState, type CSSProperties, type ReactNode } from 'react'
import { DragDropContext, Draggable, Droppable, type DraggableProvidedDragHandleProps, type DropResult } from '@hello-pangea/dnd'
import { Badge } from '@/badge'
import { Button } from '@/button'
import { Card, CardContent } from '@/card'
import type { TrackingOverviewResponse } from '@/metaTrackingLocalMock'
import {
  DEFAULT_SITE_METRIC_LAYOUT,
  cycleMetricDimensions,
  displayEventName,
  displayIncompleteCause,
  fmtDate,
  formatSiteTrackingNumber,
  funnelBarWidth,
  listOrEmpty,
  shortUrl,
  siteTrackingNumberValue,
  type SiteMetricAspect,
  type SiteMetricKey,
  type SiteMetricLayout,
} from '@/siteTrackingPresentation'
import { TooltipLabel } from '@/tooltip'
import {
  CursorClick,
  DotsSixVertical,
  EyeSlash,
  Funnel,
  LinkSimple,
  Pulse,
  WarningCircle,
} from '@phosphor-icons/react'

export const siteTrackingPanelClass = 'border-slate-800/80 bg-slate-950/60 shadow-[0_20px_80px_rgba(2,6,23,0.35)] backdrop-blur-xl'

type SiteMetricTileData = {
  key: SiteMetricKey
  label: string
  tooltipLabel?: string
  description?: string
  value: ReactNode
  detail?: string
  icon: typeof Pulse
  toneClass: string
  width: number
  height: number
  aspect: SiteMetricAspect
}

type FunnelRow = {
  label: string
  value: number
}

export type ManagedSiteUrl = NonNullable<NonNullable<TrackingOverviewResponse['customLinks']>['managedUrls']>[number]
export type CloudflareRedirectUrl = NonNullable<NonNullable<TrackingOverviewResponse['customLinks']>['cloudflareRedirects']>[number]
export type SiteConnection = NonNullable<NonNullable<TrackingOverviewResponse['siteConnections']>['sites']>[number]

export type SiteConnectionForm = {
  id?: string
  siteHost: string
  name: string
  statusLabel: string
  statusTone: 'success' | 'warning' | 'danger' | 'neutral'
  active: boolean
}

export type ManagedSiteUrlForm = {
  id?: string
  name: string
  slugPath: string
  destinationUrl: string
  description: string
  placement: string
  unitSlug: string
  serviceId: string
  utmSource: string
  utmMedium: string
  utmCampaign: string
  utmContent: string
  utmTerm: string
  active: boolean
}

const emptyManagedUrlForm: ManagedSiteUrlForm = {
  name: '',
  slugPath: '',
  destinationUrl: 'https://espacofacial.com/agendamento',
  description: '',
  placement: '',
  unitSlug: '',
  serviceId: '',
  utmSource: 'meta',
  utmMedium: 'paid_social',
  utmCampaign: '',
  utmContent: '',
  utmTerm: '',
  active: true,
}

export const emptySiteConnectionForm: SiteConnectionForm = {
  siteHost: '',
  name: '',
  statusLabel: 'Conexão ativa',
  statusTone: 'success',
  active: true,
}

function managedUrlToForm(url: ManagedSiteUrl): ManagedSiteUrlForm {
  return {
    id: url.id,
    name: url.name || '',
    slugPath: url.slugPath || '',
    destinationUrl: url.destinationUrl || 'https://espacofacial.com/agendamento',
    description: url.description || '',
    placement: url.placement || '',
    unitSlug: url.unitSlug || '',
    serviceId: url.serviceId || '',
    utmSource: url.utmSource || '',
    utmMedium: url.utmMedium || '',
    utmCampaign: url.utmCampaign || '',
    utmContent: url.utmContent || '',
    utmTerm: url.utmTerm || '',
    active: url.active !== false,
  }
}

function ManagedUrlField({
  label,
  value,
  placeholder,
  onChange,
}: {
  label: string
  value: string
  placeholder?: string
  onChange: (value: string) => void
}) {
  return (
    <label className="space-y-1 text-xs font-medium uppercase tracking-[0.12em] text-slate-500">
      <span>{label}</span>
      <input
        value={value}
        placeholder={placeholder}
        onChange={(event) => onChange(event.target.value)}
        className="h-10 w-full rounded-lg border border-slate-800 bg-slate-950/70 px-3 text-sm font-normal normal-case tracking-normal text-slate-100 outline-none transition placeholder:text-slate-600 focus:border-cyan-400/50 focus:ring-2 focus:ring-cyan-400/20"
      />
    </label>
  )
}

function SiteMetricTile({
  label,
  tooltipLabel,
  description,
  value,
  detail,
  icon: Icon,
  toneClass,
  width,
  height,
  aspect,
  dragHandleProps,
  onHide,
  onResize,
}: SiteMetricTileData & {
  dragHandleProps?: DraggableProvidedDragHandleProps | null
  onHide?: () => void
  onResize?: (dimensions: { width: number; height: number; aspect?: SiteMetricAspect }) => void
}) {
  const isSquare = aspect === '1:1'
  const isWide = aspect === '2:1'
  const isLandscape = aspect === '4:3'
  const roomy = width >= 300 && height >= 150
  const body = (
    <CardContent
      tabIndex={tooltipLabel || description ? 0 : undefined}
      className={`flex h-full outline-none focus-visible:ring-2 focus-visible:ring-cyan-400/45 ${
        isWide
          ? 'items-center justify-between gap-4 px-10 py-4 text-left'
          : isLandscape
            ? 'items-start justify-between gap-3 p-4 text-left'
            : 'items-center justify-center gap-3 p-4 text-center'
      }`}
    >
      <div className={`${isWide ? 'flex min-w-0 items-center gap-3' : 'flex min-w-0 flex-col gap-2'} ${isSquare ? 'items-center' : 'items-start'}`}>
        <div className={`inline-flex ${roomy || isSquare ? 'h-9 w-9' : 'h-8 w-8'} shrink-0 items-center justify-center rounded-full border ${toneClass}`}>
          <Icon className={roomy || isSquare ? 'h-4 w-4' : 'h-3.5 w-3.5'} weight="fill" />
        </div>
        <div className={`min-w-0 space-y-0.5 ${isSquare ? 'text-center' : ''}`}>
          <div className={`${isWide ? 'text-[10px]' : 'text-[9px] sm:text-[10px]'} font-medium uppercase tracking-[0.14em] text-slate-400`}>{label}</div>
          {detail && !isSquare ? <div className="text-[9px] leading-tight text-slate-500">{detail}</div> : null}
        </div>
      </div>
      <div className={`${isWide ? 'min-w-[7rem] text-right' : isSquare ? 'text-center' : 'w-full'} space-y-1`}>
        <div className={`${isWide ? 'text-[1.35rem]' : isLandscape ? 'text-[1.3rem]' : 'text-[1.24rem]'} font-semibold leading-tight text-white`}>{value}</div>
        {description && (isWide || (isLandscape && roomy)) ? <div className={`${isWide ? 'ml-auto max-w-40' : 'max-w-56'} text-[10px] leading-snug text-slate-400`}>{description}</div> : null}
      </div>
    </CardContent>
  )
  const aspectClass =
    aspect === '2:1'
      ? 'bg-[radial-gradient(circle_at_15%_20%,rgba(34,211,238,0.13),transparent_36%),rgba(2,6,23,0.72)]'
      : aspect === '4:3'
        ? 'bg-[linear-gradient(135deg,rgba(15,23,42,0.88),rgba(2,6,23,0.74))]'
        : 'bg-[radial-gradient(circle_at_50%_20%,rgba(45,212,191,0.12),transparent_42%),rgba(2,6,23,0.78)]'
  return (
    <Card className={`group relative h-full gap-0 overflow-hidden py-0 transition hover:border-cyan-400/25 hover:bg-slate-900/70 ${siteTrackingPanelClass} ${aspectClass}`}>
      <button
        type="button"
        className="absolute left-2 top-2 z-10 inline-flex h-6 w-6 cursor-grab items-center justify-center rounded-full border border-slate-700/75 bg-slate-950/45 text-slate-500 opacity-60 shadow-sm transition hover:scale-105 hover:border-cyan-400/40 hover:text-cyan-100 hover:opacity-100 active:cursor-grabbing group-hover:opacity-100 focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400/45"
        aria-label={`Mover métrica ${tooltipLabel || label}`}
        {...dragHandleProps}
      >
        <DotsSixVertical className="h-3.5 w-3.5" weight="bold" />
      </button>
      {onHide ? (
        <button
          type="button"
          className="absolute right-2 top-2 z-10 inline-flex h-6 w-6 items-center justify-center rounded-full border border-slate-700/80 bg-slate-950/60 text-slate-400 opacity-70 shadow-sm transition hover:border-rose-400/40 hover:text-rose-100 hover:opacity-100 focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400/45"
          aria-label={`Ocultar métrica ${tooltipLabel || label}`}
          onClick={(event) => {
            event.preventDefault()
            event.stopPropagation()
            onHide()
          }}
        >
          <EyeSlash className="h-3.5 w-3.5" />
        </button>
      ) : null}
      {tooltipLabel || description ? (
        <TooltipLabel label={<span className="block space-y-1"><span className="block font-medium text-slate-100">{tooltipLabel || label}</span>{description ? <span className="block">{description}</span> : null}</span>}>
          {body}
        </TooltipLabel>
      ) : (
        body
      )}
      {onResize ? (
        <TooltipLabel label="Alternar formato" description={`Clique para alternar entre 1:1, 4:3 e 2:1. Atual: ${aspect}.`}>
          <button
            type="button"
            className="absolute bottom-1.5 right-1.5 z-10 h-6 w-6 rounded-br-2xl border-b border-r border-slate-500/50 bg-gradient-to-br from-transparent via-transparent to-cyan-300/10 opacity-65 transition hover:border-cyan-300/70 hover:bg-cyan-400/10 hover:opacity-100 group-hover:opacity-100 focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400/45"
            aria-label={`Alternar formato da métrica ${tooltipLabel || label}`}
            onClick={(event) => {
              event.preventDefault()
              event.stopPropagation()
              onResize(cycleMetricDimensions(width, height, aspect))
            }}
          >
            <span className="absolute bottom-1 right-1 h-2.5 w-2.5 rounded-br-xl border-b border-r border-cyan-200/35" aria-hidden="true" />
          </button>
        </TooltipLabel>
      ) : null}
    </Card>
  )
}

export function SiteTrackingSection({ title, icon, children }: { title: string; icon: ReactNode; children: ReactNode }) {
  return (
    <section className={`rounded-2xl p-5 ${siteTrackingPanelClass}`}>
      <div className="mb-4 flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-slate-300">
        {icon}
        {title}
      </div>
      {children}
    </section>
  )
}

export function RankedList({
  items,
  labelKey,
  empty,
}: {
  items: Array<Record<string, unknown>>
  labelKey: string
  empty: string
}) {
  if (!items.length) return <div className="text-sm text-slate-500">{empty}</div>
  const max = Math.max(...items.map((item) => siteTrackingNumberValue(item.count)))
  return (
    <div className="space-y-3">
      {items.map((item, index) => {
        const label = String(item[labelKey] || 'sem valor')
        const count = siteTrackingNumberValue(item.count)
        return (
          <div key={`${label}-${index}`} className="space-y-1">
            <div className="flex items-center justify-between gap-3 text-sm">
              <span className="min-w-0 truncate text-slate-200">{label}</span>
              <span className="font-mono text-slate-400">{formatSiteTrackingNumber(count)}</span>
            </div>
            <div className="h-1.5 max-w-md overflow-hidden rounded-full bg-white/10">
              <div className="h-full rounded-full bg-cyan-400" style={{ width: funnelBarWidth(count, max) }} />
            </div>
          </div>
        )
      })}
    </div>
  )
}

export function ConnectionNotice({
  sites,
  saving,
  selectedSiteId,
  onClose,
  onSave,
}: {
  sites: SiteConnection[]
  saving?: boolean
  selectedSiteId?: string
  onClose: () => void
  onSave: (form: SiteConnectionForm) => Promise<void>
}) {
  const [form, setForm] = useState<SiteConnectionForm>(emptySiteConnectionForm)
  const [feedback, setFeedback] = useState<string | null>(null)
  const activeSites = sites.filter((site) => site.active !== false)
  const selectedSite = activeSites.find((site) => site.siteHost === selectedSiteId || site.id === selectedSiteId)
  const update = (patch: Partial<SiteConnectionForm>) => setForm((prev) => ({ ...prev, ...patch }))

  return (
    <section className="rounded-2xl border border-cyan-400/25 bg-cyan-500/10 p-4 text-cyan-50 shadow-[0_20px_80px_rgba(8,145,178,0.12)]">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="text-sm font-semibold uppercase tracking-wide">Nova conexão de site</div>
          <p className="mt-1 max-w-3xl text-sm text-cyan-100/80">
            Conecte um domínio para liberar o filtro do dashboard por site. Eventos enviados com esse host aparecem no seletor e nas métricas do período.
          </p>
          {selectedSite ? (
            <div className="mt-3 inline-flex items-center gap-2 rounded-full border border-cyan-300/20 bg-cyan-950/40 px-3 py-1 text-xs text-cyan-100/85">
              <span className="font-mono">{selectedSite.siteHost}</span>
              <span>{selectedSite.statusLabel || 'Conexão ativa'}</span>
            </div>
          ) : null}
        </div>
        <Button variant="ghost" size="sm" className="border border-cyan-300/25 bg-cyan-400/10 text-cyan-50 hover:bg-cyan-400/18" onClick={onClose}>
          Fechar
        </Button>
      </div>
      <div className="mt-4 grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(340px,0.72fr)]">
        <div className="space-y-2">
          {activeSites.map((site) => (
            <div key={site.id} className="flex items-center justify-between gap-3 rounded-xl border border-white/10 bg-slate-950/35 p-3">
              <div className="min-w-0">
                <div className="truncate text-sm font-semibold text-white">{site.name || site.siteHost}</div>
                <div className="truncate font-mono text-xs text-cyan-100/70">{site.siteHost}</div>
              </div>
              <div className="text-right text-xs text-cyan-100/70">
                <div>{site.statusLabel || 'Conexão ativa'}</div>
                <div className="font-mono">{formatSiteTrackingNumber(site.eventCount)} eventos</div>
              </div>
            </div>
          ))}
        </div>
        <form
          className="space-y-3 rounded-xl border border-cyan-300/20 bg-slate-950/45 p-4"
          onSubmit={async (event) => {
            event.preventDefault()
            setFeedback(null)
            try {
              await onSave(form)
              setForm(emptySiteConnectionForm)
              setFeedback('Conexão cadastrada.')
            } catch (error) {
              setFeedback(error instanceof Error ? error.message : 'Não foi possível cadastrar a conexão.')
            }
          }}
        >
          <div>
            <div className="text-sm font-semibold text-white">Adicionar domínio</div>
            <div className="text-xs text-cyan-100/65">Use apenas o host, por exemplo site.espacofacial.com.</div>
          </div>
          <ManagedUrlField label="Domínio" value={form.siteHost} placeholder="novo-dominio.com" onChange={(siteHost) => update({ siteHost })} />
          <ManagedUrlField label="Nome no seletor" value={form.name} placeholder="Campanha institucional" onChange={(name) => update({ name })} />
          <ManagedUrlField label="Status" value={form.statusLabel} placeholder="Conexão ativa" onChange={(statusLabel) => update({ statusLabel })} />
          <label className="flex items-center gap-2 text-sm text-cyan-100/85">
            <input
              type="checkbox"
              checked={form.active}
              onChange={(event) => update({ active: event.target.checked })}
              className="h-4 w-4 rounded border-cyan-900 bg-slate-950 text-cyan-500"
            />
            Conexão ativa
          </label>
          {feedback ? <div className="text-xs text-emerald-200">{feedback}</div> : null}
          <Button type="submit" disabled={saving || !form.siteHost.trim()} className="w-full bg-cyan-500 text-slate-950 hover:bg-cyan-400">
            {saving ? 'Salvando...' : 'Conectar site'}
          </Button>
        </form>
      </div>
    </section>
  )
}

export function SiteMetricsGrid({
  hiddenMetricTiles,
  visibleMetricTiles,
  onDragEnd,
  onHide,
  onRestore,
  onResize,
  onShow,
}: {
  hiddenMetricTiles: Array<Pick<SiteMetricTileData, 'key' | 'label'>>
  visibleMetricTiles: SiteMetricTileData[]
  onDragEnd: (result: DropResult) => void
  onHide: (key: SiteMetricKey) => void
  onRestore: () => void
  onResize: (key: SiteMetricKey, dimensions: Partial<SiteMetricLayout>) => void
  onShow: (key: SiteMetricKey) => void
}) {
  return (
    <div className="space-y-3">
      {hiddenMetricTiles.length > 0 ? (
        <div className="flex flex-wrap items-center justify-end gap-2">
          <span className="text-[11px] uppercase tracking-[0.16em] text-slate-500">Ocultas</span>
          {hiddenMetricTiles.map((tile) => (
            <Button
              key={tile.key}
              type="button"
              variant="ghost"
              size="sm"
              className="h-7 rounded-full border border-slate-800 bg-slate-900/55 px-2 text-[11px] text-slate-300 hover:border-cyan-400/35 hover:bg-slate-800/80 hover:text-white"
              onClick={() => onShow(tile.key)}
            >
              + {tile.label}
            </Button>
          ))}
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-7 px-2 text-[11px] text-slate-400 hover:bg-slate-800/80 hover:text-white"
            onClick={onRestore}
          >
            Restaurar padrão
          </Button>
        </div>
      ) : null}
      <DragDropContext onDragEnd={onDragEnd}>
        <Droppable droppableId="site-tracking-metrics" direction="horizontal">
          {(dropProvided) => (
            <div ref={dropProvided.innerRef} {...dropProvided.droppableProps} className="relative flex flex-wrap items-stretch gap-2">
              {visibleMetricTiles.length > 0 ? (
                visibleMetricTiles.map((tile, index) => (
                  <Draggable key={tile.key} draggableId={`site-tracking-metric-${tile.key}`} index={index}>
                    {(dragProvided, snapshot) => (
                      <div
                        ref={dragProvided.innerRef}
                        {...dragProvided.draggableProps}
                        className={`min-w-0 flex-none ${snapshot.isDragging ? 'z-30' : ''}`}
                        style={
                          {
                            ...dragProvided.draggableProps.style,
                            width: `min(${tile.width}px, 100%)`,
                            height: tile.height,
                          } as CSSProperties
                        }
                      >
                        <SiteMetricTile
                          {...tile}
                          dragHandleProps={dragProvided.dragHandleProps}
                          onHide={() => onHide(tile.key)}
                          onResize={(dimensions) => onResize(tile.key, dimensions)}
                        />
                      </div>
                    )}
                  </Draggable>
                ))
              ) : (
                <Card className={`${siteTrackingPanelClass} w-full`}>
                  <CardContent className="flex min-h-[72px] items-center justify-between gap-3 p-4 text-sm text-slate-300">
                    <span>Nenhuma métrica visível no resumo do site.</span>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="border-slate-700 bg-slate-900/60 text-slate-100 hover:bg-slate-800/80"
                      onClick={onRestore}
                    >
                      Restaurar métricas
                    </Button>
                  </CardContent>
                </Card>
              )}
              {dropProvided.placeholder}
            </div>
          )}
        </Droppable>
      </DragDropContext>
    </div>
  )
}

export function OperationalAlerts({
  alerts,
}: {
  alerts: NonNullable<TrackingOverviewResponse['alerts']>
}) {
  if (!alerts.length) return null
  return (
    <SiteTrackingSection title="Alertas operacionais" icon={<WarningCircle className="h-5 w-5" />}>
      <div className="grid gap-3 md:grid-cols-2">
        {alerts.map((alert) => (
          <div key={alert.code} className="rounded-lg border border-white/10 bg-white/[0.03] p-4">
            <Badge variant={alert.severity === 'critical' ? 'destructive' : 'warning'}>{alert.severity === 'critical' ? 'Crítico' : 'Atenção'}</Badge>
            <div className="mt-3 font-semibold text-white">{alert.title}</div>
            <div className="mt-1 text-sm text-slate-400">{alert.message}</div>
          </div>
        ))}
      </div>
    </SiteTrackingSection>
  )
}

export function SiteFunnelSection({ rows, max }: { rows: FunnelRow[]; max: number }) {
  return (
    <div className="grid gap-6">
      <SiteTrackingSection title="Funil do site" icon={<Funnel className="h-5 w-5" />}>
        <div className="space-y-4">
          {rows.map((row) => (
            <div key={row.label} className="space-y-1">
              <div className="flex items-center justify-between text-sm">
                <span className="text-slate-300">{row.label}</span>
                <span className="font-mono text-white">{formatSiteTrackingNumber(row.value)}</span>
              </div>
              <div className="h-2 overflow-hidden rounded-full bg-white/10">
                <div className="h-full rounded-full bg-emerald-400" style={{ width: funnelBarWidth(row.value, max) }} />
              </div>
            </div>
          ))}
        </div>
      </SiteTrackingSection>
    </div>
  )
}

export function SiteBehaviorSections({ data }: { data: TrackingOverviewResponse | null }) {
  return (
    <div className="grid gap-4 lg:grid-cols-3">
      <SiteTrackingSection title="Páginas mais vistas" icon={<CursorClick className="h-5 w-5" />}>
        <RankedList items={listOrEmpty(data?.siteBehavior?.topPages)} labelKey="pagePath" empty="Sem pageviews agregados ainda." />
      </SiteTrackingSection>
      <SiteTrackingSection title="Entradas" icon={<CursorClick className="h-5 w-5" />}>
        <RankedList items={listOrEmpty(data?.siteBehavior?.topEntryPages)} labelKey="pagePath" empty="Sem páginas de entrada no período." />
      </SiteTrackingSection>
      <SiteTrackingSection title="Campanhas" icon={<LinkSimple className="h-5 w-5" />}>
        <RankedList items={listOrEmpty(data?.website?.data?.topCampaigns)} labelKey="utmCampaign" empty="Sem campanhas atribuídas no período." />
      </SiteTrackingSection>
    </div>
  )
}

export function ManagedSiteUrlsSection({
  urls,
  cloudflareRedirects,
  saving,
  onSave,
}: {
  urls: ManagedSiteUrl[]
  cloudflareRedirects: CloudflareRedirectUrl[]
  saving?: boolean
  onSave: (form: ManagedSiteUrlForm) => Promise<void>
}) {
  const [form, setForm] = useState<ManagedSiteUrlForm>(emptyManagedUrlForm)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [feedback, setFeedback] = useState<string | null>(null)

  useEffect(() => {
    if (!editingId) return
    const current = urls.find((url) => url.id === editingId)
    if (current) setForm(managedUrlToForm(current))
  }, [editingId, urls])

  const update = (patch: Partial<ManagedSiteUrlForm>) => setForm((prev) => ({ ...prev, ...patch }))
  const reset = () => {
    setEditingId(null)
    setForm(emptyManagedUrlForm)
    setFeedback(null)
  }

  return (
    <SiteTrackingSection title="URLs personalizadas" icon={<LinkSimple className="h-5 w-5" />}>
      <div className="grid gap-5 xl:grid-cols-[minmax(0,1.2fr)_minmax(340px,0.8fr)]">
        <div className="space-y-3">
          <div className="flex items-center justify-between gap-3">
            <div>
              <div className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">Gerenciadas no CRM</div>
              <div className="text-xs text-slate-500">Registros salvos no D1 e editáveis por esta tela.</div>
            </div>
            <Badge variant="outline">{formatSiteTrackingNumber(urls.length)}</Badge>
          </div>
          {urls.length ? urls.map((url) => (
            <div key={url.id} className="rounded-xl border border-white/10 bg-white/[0.03] p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-semibold text-white">{url.name}</span>
                    <Badge variant={url.active ? 'success' : 'secondary'}>{url.active ? 'Ativa' : 'Pausada'}</Badge>
                  </div>
                  <div className="mt-1 truncate font-mono text-xs text-cyan-100">{url.publicUrl}</div>
                  <div className="mt-1 truncate text-sm text-slate-400">{shortUrl(url.destinationUrl)}</div>
                  <div className="mt-2 text-xs text-slate-500">
                    {url.utmCampaign || 'sem campanha'} · {url.unitSlug || 'sem unidade'} · {url.serviceId || 'sem procedimento'}
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-3">
                  <div className="text-right">
                    <div className="font-mono text-lg font-semibold text-white">{formatSiteTrackingNumber(url.clickCount)}</div>
                    <div className="text-[10px] uppercase tracking-[0.12em] text-slate-500">cliques</div>
                  </div>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="border-slate-700 bg-slate-950/60 text-slate-100 hover:bg-slate-800"
                    onClick={() => {
                      setEditingId(url.id)
                      setFeedback(null)
                    }}
                  >
                    Editar
                  </Button>
                </div>
              </div>
            </div>
          )) : <div className="rounded-xl border border-dashed border-slate-800 bg-white/[0.02] p-5 text-sm text-slate-500">Nenhuma URL gerenciada no CRM cadastrada ainda.</div>}

          <div className="pt-3">
            <div className="flex items-center justify-between gap-3">
              <div>
                <div className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">Atalhos Cloudflare</div>
                <div className="text-xs text-slate-500">Links read-only do worker esfa.co. Edição permanece no catálogo de redirects.</div>
              </div>
              <Badge variant="outline">{formatSiteTrackingNumber(cloudflareRedirects.length)}</Badge>
            </div>
            <div className="mt-3 max-h-[420px] space-y-2 overflow-y-auto pr-1">
              {cloudflareRedirects.length ? cloudflareRedirects.map((url) => (
                <div key={url.id} className="rounded-xl border border-slate-800/80 bg-slate-950/40 p-3">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-semibold text-slate-100">{url.name}</span>
                        <Badge variant="secondary">Cloudflare</Badge>
                      </div>
                      <div className="mt-1 truncate font-mono text-xs text-cyan-100">{url.publicUrl}</div>
                      <div className="mt-1 truncate text-sm text-slate-400">{shortUrl(url.destinationUrl)}</div>
                    </div>
                    <div className="text-right text-[10px] uppercase tracking-[0.12em] text-slate-500">
                      Read-only
                    </div>
                  </div>
                </div>
              )) : <div className="rounded-xl border border-dashed border-slate-800 bg-white/[0.02] p-5 text-sm text-slate-500">Nenhum atalho Cloudflare carregado.</div>}
            </div>
          </div>
        </div>

        <form
          className="space-y-3 rounded-xl border border-cyan-400/20 bg-cyan-500/[0.04] p-4"
          onSubmit={async (event) => {
            event.preventDefault()
            setFeedback(null)
            try {
              await onSave(form)
              setFeedback(editingId ? 'URL atualizada.' : 'URL cadastrada.')
              setEditingId(null)
              setForm(emptyManagedUrlForm)
            } catch (error) {
              setFeedback(error instanceof Error ? error.message : 'Não foi possível salvar a URL.')
            }
          }}
        >
          <div className="flex items-center justify-between gap-3">
            <div>
              <div className="text-sm font-semibold text-white">{editingId ? 'Editar URL' : 'Adicionar URL'}</div>
              <div className="text-xs text-slate-500">Use para links de campanha, anúncios e atalhos monitorados.</div>
            </div>
            {editingId ? (
              <Button type="button" variant="ghost" size="sm" className="text-slate-400 hover:text-white" onClick={reset}>
                Cancelar
              </Button>
            ) : null}
          </div>
          <ManagedUrlField label="Nome" value={form.name} placeholder="Botox Novo Hamburgo Meta" onChange={(name) => update({ name })} />
          <ManagedUrlField label="URL final" value={form.destinationUrl} placeholder="https://espacofacial.com/agendamento?unit=novo-hamburgo&service=botox" onChange={(destinationUrl) => update({ destinationUrl })} />
          <ManagedUrlField label="Atalho" value={form.slugPath} placeholder="/campanhas/botox-novo-hamburgo-meta" onChange={(slugPath) => update({ slugPath })} />
          <div className="grid gap-3 sm:grid-cols-2">
            <ManagedUrlField label="utm_source" value={form.utmSource} onChange={(utmSource) => update({ utmSource })} />
            <ManagedUrlField label="utm_medium" value={form.utmMedium} onChange={(utmMedium) => update({ utmMedium })} />
            <ManagedUrlField label="utm_campaign" value={form.utmCampaign} onChange={(utmCampaign) => update({ utmCampaign })} />
            <ManagedUrlField label="utm_content" value={form.utmContent} onChange={(utmContent) => update({ utmContent })} />
            <ManagedUrlField label="Unidade" value={form.unitSlug} placeholder="novo-hamburgo" onChange={(unitSlug) => update({ unitSlug })} />
            <ManagedUrlField label="Procedimento" value={form.serviceId} placeholder="botox" onChange={(serviceId) => update({ serviceId })} />
          </div>
          <label className="flex items-center gap-2 text-sm text-slate-300">
            <input
              type="checkbox"
              checked={form.active}
              onChange={(event) => update({ active: event.target.checked })}
              className="h-4 w-4 rounded border-slate-700 bg-slate-950 text-cyan-500"
            />
            URL ativa
          </label>
          {feedback ? <div className="text-xs text-emerald-300">{feedback}</div> : null}
          <Button type="submit" disabled={saving || !form.name.trim() || !form.destinationUrl.trim()} className="w-full bg-cyan-500 text-slate-950 hover:bg-cyan-400">
            {saving ? 'Salvando...' : editingId ? 'Salvar alterações' : 'Cadastrar URL'}
          </Button>
        </form>
      </div>
    </SiteTrackingSection>
  )
}

export function SiteLinkSections({ data }: { data: TrackingOverviewResponse | null }) {
  return (
    <div className="grid gap-6 xl:grid-cols-2">
      <SiteTrackingSection title="Links personalizados e CTAs" icon={<LinkSimple className="h-5 w-5" />}>
        <RankedList items={listOrEmpty(data?.customLinks?.topLinks)} labelKey="linkUrl" empty="Sem cliques em links rastreados." />
      </SiteTrackingSection>
      <SiteTrackingSection title="Links sem campanha identificada" icon={<WarningCircle className="h-5 w-5" />}>
        <RankedList items={listOrEmpty(data?.customLinks?.linksMissingUtm)} labelKey="linkUrl" empty="Nenhum link sem campanha identificada no período." />
      </SiteTrackingSection>
    </div>
  )
}

export function SiteIssueAndClickSections({ data }: { data: TrackingOverviewResponse | null }) {
  const incompleteBookings = listOrEmpty(data?.reconciliation?.incompleteBookings)
  const recentClicks = listOrEmpty(data?.customLinks?.recentClicks)
  return (
    <div className="grid gap-6 xl:grid-cols-2">
      <SiteTrackingSection title="Reservas com origem incompleta" icon={<WarningCircle className="h-5 w-5" />}>
        <div className="space-y-3">
          {incompleteBookings.slice(0, 8).map((booking) => (
            <div key={booking.id} className="rounded-lg border border-white/10 bg-white/[0.03] p-3">
              <div className="flex items-center justify-between gap-3">
                <span className="font-mono text-xs text-slate-400">{booking.id}</span>
                <Badge variant="outline">{displayIncompleteCause(booking.primaryCause)}</Badge>
              </div>
              <div className="mt-2 text-sm text-slate-300">{booking.unitSlug} · {booking.utmSource || 'sem origem'} · {booking.utmCampaign || 'sem campanha'}</div>
            </div>
          ))}
          {!incompleteBookings.length ? <div className="text-sm text-slate-500">Nenhuma reserva com origem incompleta no período.</div> : null}
        </div>
      </SiteTrackingSection>

      <SiteTrackingSection title="Cliques recentes" icon={<CursorClick className="h-5 w-5" />}>
        <div className="space-y-3">
          {recentClicks.slice(0, 8).map((click) => (
            <div key={click.id} className="rounded-lg border border-white/10 bg-white/[0.03] p-3">
              <div className="flex items-center justify-between gap-3">
                <span className="text-sm font-semibold text-white">{displayEventName(click.eventName)}</span>
                <span className="text-xs text-slate-500">{fmtDate(click.createdAtMs)}</span>
              </div>
              <div className="mt-1 truncate text-sm text-slate-300">{shortUrl(click.linkUrl)}</div>
              <div className="mt-1 text-xs text-slate-500">{click.utmCampaign || 'sem campanha'} · {click.placement || 'sem posição'}</div>
            </div>
          ))}
          {!recentClicks.length ? <div className="text-sm text-slate-500">Nenhum clique recente no período.</div> : null}
        </div>
      </SiteTrackingSection>
    </div>
  )
}
