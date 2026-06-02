import type { SiteTrackingWindowDays } from '@/siteTrackingTypes'

export type SiteMetricKey =
  | 'sessions'
  | 'bookings'
  | 'whatsapp'
  | 'schedule'
  | 'origin'
  | 'reservationLink'
  | 'facebook'
  | 'marketing'
  | 'campaign'
  | 'conversion'

export type SiteMetricAspect = '1:1' | '4:3' | '2:1'

export type SiteMetricLayout = {
  key: SiteMetricKey
  visible: boolean
  width: number
  height: number
  aspect: SiteMetricAspect
}

export type WindowDays = SiteTrackingWindowDays

export const SITE_TRACKING_METRIC_LAYOUT_KEY = 'skincos.siteTracking.layout.metrics.v2'

export const SITE_METRIC_DIMENSIONS = {
  minWidth: 140,
  maxWidth: 680,
  minHeight: 96,
  maxHeight: 520,
  defaultWidth: 224,
  defaultHeight: 168,
} as const

export const SITE_METRIC_ASPECTS: SiteMetricAspect[] = ['1:1', '4:3', '2:1']

export const DEFAULT_SITE_METRIC_LAYOUT: SiteMetricLayout[] = [
  { key: 'sessions', visible: true, width: SITE_METRIC_DIMENSIONS.defaultWidth, height: SITE_METRIC_DIMENSIONS.defaultHeight, aspect: '4:3' },
  { key: 'bookings', visible: true, width: SITE_METRIC_DIMENSIONS.defaultWidth, height: SITE_METRIC_DIMENSIONS.defaultHeight, aspect: '4:3' },
  { key: 'whatsapp', visible: true, width: SITE_METRIC_DIMENSIONS.defaultWidth, height: SITE_METRIC_DIMENSIONS.defaultHeight, aspect: '4:3' },
  { key: 'schedule', visible: true, width: SITE_METRIC_DIMENSIONS.defaultWidth, height: SITE_METRIC_DIMENSIONS.defaultHeight, aspect: '4:3' },
  { key: 'origin', visible: true, width: SITE_METRIC_DIMENSIONS.defaultWidth, height: SITE_METRIC_DIMENSIONS.defaultHeight, aspect: '4:3' },
  { key: 'reservationLink', visible: true, width: SITE_METRIC_DIMENSIONS.defaultWidth, height: SITE_METRIC_DIMENSIONS.defaultHeight, aspect: '4:3' },
  { key: 'facebook', visible: true, width: SITE_METRIC_DIMENSIONS.defaultWidth, height: SITE_METRIC_DIMENSIONS.defaultHeight, aspect: '4:3' },
  { key: 'marketing', visible: true, width: SITE_METRIC_DIMENSIONS.defaultWidth, height: SITE_METRIC_DIMENSIONS.defaultHeight, aspect: '4:3' },
  { key: 'campaign', visible: true, width: SITE_METRIC_DIMENSIONS.defaultWidth, height: SITE_METRIC_DIMENSIONS.defaultHeight, aspect: '4:3' },
  { key: 'conversion', visible: true, width: SITE_METRIC_DIMENSIONS.defaultWidth, height: SITE_METRIC_DIMENSIONS.defaultHeight, aspect: '4:3' },
]

export function siteTrackingNumberValue(value: unknown): number {
  const parsed = Number(value || 0)
  return Number.isFinite(parsed) ? parsed : 0
}

export function formatSiteTrackingNumber(value: unknown): string {
  return new Intl.NumberFormat('pt-BR').format(siteTrackingNumberValue(value))
}

export function formatSiteTrackingPercent(value: unknown): string {
  return `${formatSiteTrackingNumber(value)}%`
}

export function funnelBarWidth(value: unknown, max: unknown): string {
  const denominator = Math.max(1, siteTrackingNumberValue(max))
  return `${Math.max(4, Math.min(100, Math.round((siteTrackingNumberValue(value) / denominator) * 100)))}%`
}

function clampMetricDimension(value: unknown, min: number, max: number, fallback: number) {
  const numberValue = Number(value)
  if (!Number.isFinite(numberValue)) return fallback
  return Math.min(max, Math.max(min, Math.round(numberValue)))
}

function getMetricAspect(value: unknown, width?: unknown, height?: unknown): SiteMetricAspect {
  if (value === '1:1' || value === '4:3' || value === '2:1') return value
  const ratio = Number(width) > 0 && Number(height) > 0 ? Number(width) / Number(height) : 4 / 3
  const ratios: Record<SiteMetricAspect, number> = { '1:1': 1, '4:3': 4 / 3, '2:1': 2 }
  return SITE_METRIC_ASPECTS.reduce((closest, option) => {
    const closestDelta = Math.abs(ratios[closest] - ratio)
    const optionDelta = Math.abs(ratios[option] - ratio)
    return optionDelta < closestDelta ? option : closest
  }, '4:3' as SiteMetricAspect)
}

export function fitMetricBoxToAspect(width: number, height: number, aspect: SiteMetricAspect) {
  const ratio = aspect === '1:1' ? 1 : aspect === '2:1' ? 2 : 4 / 3
  const nextHeight = clampMetricDimension(Math.round(width / ratio), SITE_METRIC_DIMENSIONS.minHeight, SITE_METRIC_DIMENSIONS.maxHeight, height)
  return {
    width: clampMetricDimension(Math.round(nextHeight * ratio), SITE_METRIC_DIMENSIONS.minWidth, SITE_METRIC_DIMENSIONS.maxWidth, width),
    height: nextHeight,
  }
}

export function cycleMetricDimensions(width: number, height: number, currentAspect: SiteMetricAspect) {
  const currentIndex = SITE_METRIC_ASPECTS.indexOf(currentAspect)
  const aspect = SITE_METRIC_ASPECTS[(currentIndex + 1) % SITE_METRIC_ASPECTS.length]
  return { ...fitMetricBoxToAspect(width, height, aspect), aspect }
}

export function parseSiteMetricLayout(raw: string | null | undefined): SiteMetricLayout[] {
  try {
    const parsed = raw ? JSON.parse(raw) : null
    const items = Array.isArray(parsed) ? parsed : []
    const seen = new Set<SiteMetricKey>()
    const normalized = items
      .map((item) => {
        const key = String(item?.key || '').trim() as SiteMetricKey
        const fallback = DEFAULT_SITE_METRIC_LAYOUT.find((entry) => entry.key === key)
        if (!fallback || seen.has(key)) return null
        seen.add(key)
        const aspect = getMetricAspect(item?.aspect, item?.width, item?.height)
        const dimensions = fitMetricBoxToAspect(
          clampMetricDimension(item?.width, SITE_METRIC_DIMENSIONS.minWidth, SITE_METRIC_DIMENSIONS.maxWidth, fallback.width),
          clampMetricDimension(item?.height, SITE_METRIC_DIMENSIONS.minHeight, SITE_METRIC_DIMENSIONS.maxHeight, fallback.height),
          aspect,
        )
        return {
          key,
          visible: item?.visible !== false,
          width: dimensions.width,
          height: dimensions.height,
          aspect,
        }
      })
      .filter(Boolean) as SiteMetricLayout[]
    const missing = DEFAULT_SITE_METRIC_LAYOUT.filter((entry) => !seen.has(entry.key))
    return [...normalized, ...missing]
  } catch {
    return DEFAULT_SITE_METRIC_LAYOUT
  }
}

export function fmtDate(ms?: number | null) {
  if (!ms) return 'sem data'
  return new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short' }).format(new Date(ms))
}

export function shortUrl(value?: string | null) {
  if (!value) return 'sem link'
  try {
    const url = new URL(value)
    if (url.pathname.includes('/api/whatsapp/redirect')) return 'WhatsApp pelo site'
    return `${url.hostname}${url.pathname}${url.search ? '?...' : ''}`
  } catch {
    return value.length > 72 ? `${value.slice(0, 72)}...` : value
  }
}

export function displayEventName(value?: string | null) {
  const normalized = String(value || '').toLowerCase()
  if (normalized.includes('whatsapp')) return 'Clique no WhatsApp'
  if (normalized.includes('booking_confirmed')) return 'Reserva confirmada'
  if (normalized.includes('booking')) return 'Agendamento'
  if (normalized.includes('cta')) return 'Clique em chamada'
  if (normalized.includes('external')) return 'Clique externo'
  return value ? String(value).replace(/_/g, ' ') : 'Interação'
}

export function displayIncompleteCause(value?: string | null) {
  const normalized = String(value || '').toLowerCase()
  if (normalized.includes('meta') || normalized.includes('event')) return 'Reserva sem vínculo completo'
  if (normalized.includes('facebook') || normalized.includes('fb')) return 'Origem Meta incompleta'
  if (normalized.includes('tracking') || normalized.includes('context')) return 'Origem não preservada'
  if (normalized.includes('consent')) return 'Consentimento ausente'
  return value ? String(value).replace(/_/g, ' ') : 'Origem incompleta'
}

export function isInternalPreviewAlert(alert: { code?: string; title?: string; message?: string }) {
  const haystack = `${alert.code || ''} ${alert.title || ''} ${alert.message || ''}`.toLowerCase()
  return haystack.includes('local_preview') || haystack.includes('modo local') || haystack.includes('cenário simulado')
}

export function alertSeverityLabel(severity?: string) {
  return severity === 'critical' ? 'Crítico' : 'Atenção'
}

export function listOrEmpty<T>(items: T[] | undefined | null): T[] {
  return Array.isArray(items) ? items : []
}
