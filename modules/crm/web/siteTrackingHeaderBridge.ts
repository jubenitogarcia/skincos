import type {
  SiteTrackingHeaderAction,
  SiteTrackingHeaderBadgeTone,
  SiteTrackingHeaderState,
  SiteTrackingWindowDays,
} from '@/siteTrackingTypes'

const SITE_TRACKING_HEADER_EVENT = 'skincos:site-tracking:header'
const SITE_TRACKING_ACTION_EVENT = 'skincos:site-tracking:action'

function isBadgeTone(value: unknown): value is SiteTrackingHeaderBadgeTone {
  return value === 'neutral' || value === 'success' || value === 'warning' || value === 'danger'
}

function isWindowDays(value: unknown): value is SiteTrackingWindowDays {
  return value === 7 || value === 30 || value === 60 || value === 90
}

export function normalizeSiteTrackingHeaderState(detail: unknown): SiteTrackingHeaderState | null {
  if (!detail || typeof detail !== 'object') return null
  const payload = detail as Partial<SiteTrackingHeaderState>
  if (!Array.isArray(payload.sites)) return null
  return {
    refreshing: Boolean(payload.refreshing),
    sites: payload.sites.map((site) => ({
      id: String(site?.id || ''),
      name: String(site?.name || site?.host || site?.id || ''),
      host: String(site?.host || site?.id || ''),
      statusLabel: site?.statusLabel ? String(site.statusLabel) : undefined,
      statusTone: isBadgeTone(site?.statusTone) ? site.statusTone : undefined,
    })).filter((site) => site.id),
    selectedSiteId: String(payload.selectedSiteId || ''),
    windowDays: isWindowDays(payload.windowDays) ? payload.windowDays : 30,
    selectedSiteName: payload.selectedSiteName ? String(payload.selectedSiteName) : undefined,
    updatedAt: payload.updatedAt ? String(payload.updatedAt) : undefined,
    dataSourceLabel: payload.dataSourceLabel ? String(payload.dataSourceLabel) : undefined,
    dataSiteHost: payload.dataSiteHost ? String(payload.dataSiteHost) : undefined,
  }
}

export function normalizeSiteTrackingHeaderAction(detail: unknown): SiteTrackingHeaderAction | null {
  if (!detail || typeof detail !== 'object') return null
  const payload = detail as { type?: unknown; value?: unknown; action?: unknown }
  const rawType = String(payload.type || payload.action || '').trim()
  if (rawType === 'refresh' || rawType === 'connect') return { type: rawType }
  if (rawType === 'rename-site') {
    const value = String(payload.value || '').trim()
    return value ? { type: 'rename-site', value } : { type: 'rename-site' }
  }
  if (rawType === 'set-site') {
    const value = String(payload.value || '').trim()
    return value ? { type: 'set-site', value } : null
  }
  if (rawType === 'set-window') {
    const value = Number(payload.value)
    return isWindowDays(value) ? { type: 'set-window', value } : null
  }
  return null
}

export function emitSiteTrackingHeaderState(detail: SiteTrackingHeaderState | null) {
  try {
    window.dispatchEvent(new CustomEvent<SiteTrackingHeaderState | null>(SITE_TRACKING_HEADER_EVENT, { detail }))
  } catch {
    // ignore browser event bridge errors
  }
}

export function dispatchSiteTrackingHeaderAction(action: SiteTrackingHeaderAction) {
  try {
    window.dispatchEvent(new CustomEvent<SiteTrackingHeaderAction>(SITE_TRACKING_ACTION_EVENT, { detail: action }))
  } catch {
    // ignore browser event bridge errors
  }
}

export function subscribeSiteTrackingHeaderState(callback: (state: SiteTrackingHeaderState | null) => void) {
  const handler = (event: Event) => {
    callback(normalizeSiteTrackingHeaderState((event as CustomEvent<unknown>).detail))
  }
  window.addEventListener(SITE_TRACKING_HEADER_EVENT, handler as EventListener)
  return () => window.removeEventListener(SITE_TRACKING_HEADER_EVENT, handler as EventListener)
}

export function subscribeSiteTrackingHeaderAction(callback: (action: SiteTrackingHeaderAction) => void) {
  const handler = (event: Event) => {
    const action = normalizeSiteTrackingHeaderAction((event as CustomEvent<unknown>).detail)
    if (!action) return
    callback(action)
  }
  window.addEventListener(SITE_TRACKING_ACTION_EVENT, handler as EventListener)
  return () => window.removeEventListener(SITE_TRACKING_ACTION_EVENT, handler as EventListener)
}
