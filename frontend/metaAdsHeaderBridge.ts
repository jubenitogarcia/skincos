import type {
  MetaAdsHeaderAction,
  MetaAdsHeaderBadgeTone,
  MetaAdsHeaderState,
  MetaAdsReportWindowDays,
} from '@/metaAdsTypes'

const META_ADS_HEADER_EVENT = 'skincos:meta-ads:header'
const META_ADS_HEADER_ACTION_EVENT = 'skincos:meta-ads:action'

function isBadgeTone(value: unknown): value is MetaAdsHeaderBadgeTone {
  return value === 'neutral' || value === 'success' || value === 'warning' || value === 'danger'
}

function isReportWindowDays(value: unknown): value is MetaAdsReportWindowDays {
  return value === 7 || value === 30 || value === 60
}

export function normalizeMetaAdsHeaderState(detail: unknown): MetaAdsHeaderState | null {
  if (!detail || typeof detail !== 'object') return null
  const payload = detail as Partial<MetaAdsHeaderState>
  if (!Array.isArray(payload.accounts)) return null
  return {
    refreshing: Boolean(payload.refreshing),
    accounts: payload.accounts.map((account) => ({
      id: String(account?.id || ''),
      name: String(account?.name || account?.id || ''),
      statusLabel: account?.statusLabel ? String(account.statusLabel) : undefined,
      statusTone: isBadgeTone(account?.statusTone) ? account.statusTone : undefined,
    })).filter((account) => account.id),
    selectedAccountId: String(payload.selectedAccountId || ''),
    reportWindowDays: isReportWindowDays(payload.reportWindowDays) ? payload.reportWindowDays : 30,
    customRangeActive: Boolean(payload.customRangeActive),
    customRangeLabel: payload.customRangeLabel ? String(payload.customRangeLabel) : undefined,
    selectedAccountName: payload.selectedAccountName ? String(payload.selectedAccountName) : undefined,
    sessionUpdatedAt: payload.sessionUpdatedAt ? String(payload.sessionUpdatedAt) : undefined,
  }
}

export function normalizeMetaAdsHeaderAction(detail: unknown): MetaAdsHeaderAction | null {
  if (!detail || typeof detail !== 'object') return null
  const payload = detail as { type?: unknown; value?: unknown; action?: unknown }
  const rawType = String(payload.type || payload.action || '').trim()
  if (!rawType) return null
  if (rawType === 'refresh' || rawType === 'manage-connections' || rawType === 'disconnect' || rawType === 'open-custom-period' || rawType === 'connect') {
    return { type: rawType }
  }
  if (rawType === 'set-account' || rawType === 'remove-account') {
    return { type: rawType, value: String(payload.value || '') }
  }
  if (rawType === 'set-report-window') {
    const value = Number(payload.value)
    if (!isReportWindowDays(value)) return null
    return { type: 'set-report-window', value }
  }
  return null
}

export function emitMetaAdsHeaderState(detail: MetaAdsHeaderState | null) {
  try {
    window.dispatchEvent(new CustomEvent<MetaAdsHeaderState | null>(META_ADS_HEADER_EVENT, { detail }))
  } catch {
    // ignore browser event bridge errors
  }
}

export function dispatchMetaAdsHeaderAction(action: MetaAdsHeaderAction) {
  try {
    window.dispatchEvent(new CustomEvent<MetaAdsHeaderAction>(META_ADS_HEADER_ACTION_EVENT, { detail: action }))
  } catch {
    // ignore browser event bridge errors
  }
}

export function subscribeMetaAdsHeaderState(callback: (state: MetaAdsHeaderState | null) => void) {
  const handler = (event: Event) => {
    callback(normalizeMetaAdsHeaderState((event as CustomEvent<unknown>).detail))
  }
  window.addEventListener(META_ADS_HEADER_EVENT, handler as EventListener)
  return () => window.removeEventListener(META_ADS_HEADER_EVENT, handler as EventListener)
}

export function subscribeMetaAdsHeaderAction(callback: (action: MetaAdsHeaderAction) => void) {
  const handler = (event: Event) => {
    const action = normalizeMetaAdsHeaderAction((event as CustomEvent<unknown>).detail)
    if (!action) return
    callback(action)
  }
  window.addEventListener(META_ADS_HEADER_ACTION_EVENT, handler as EventListener)
  return () => window.removeEventListener(META_ADS_HEADER_ACTION_EVENT, handler as EventListener)
}
