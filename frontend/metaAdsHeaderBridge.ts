import type { MetaAdsHeaderAction, MetaAdsHeaderBadgeTone, MetaAdsHeaderState } from '@/metaAdsTypes'

const META_ADS_HEADER_EVENT = 'skincos:meta-ads:header'
const META_ADS_HEADER_ACTION_EVENT = 'skincos:meta-ads:action'

function isBadgeTone(value: unknown): value is MetaAdsHeaderBadgeTone {
  return value === 'neutral' || value === 'success' || value === 'warning' || value === 'danger'
}

export function normalizeMetaAdsHeaderState(detail: unknown): MetaAdsHeaderState | null {
  if (!detail || typeof detail !== 'object') return null
  const payload = detail as Partial<MetaAdsHeaderState>
  if (!Array.isArray(payload.accounts)) return null
  return {
    connected: Boolean(payload.connected),
    refreshing: Boolean(payload.refreshing),
    accounts: payload.accounts.map((account) => ({
      id: String(account?.id || ''),
      name: String(account?.name || account?.id || ''),
    })).filter((account) => account.id),
    selectedAccountId: String(payload.selectedAccountId || ''),
    selectedAccountName: payload.selectedAccountName ? String(payload.selectedAccountName) : undefined,
    selectedAccountCurrency: payload.selectedAccountCurrency ? String(payload.selectedAccountCurrency) : undefined,
    selectedAccountTimezone: payload.selectedAccountTimezone ? String(payload.selectedAccountTimezone) : undefined,
    selectedAccountStatusLabel: payload.selectedAccountStatusLabel ? String(payload.selectedAccountStatusLabel) : undefined,
    selectedAccountStatusDetail: payload.selectedAccountStatusDetail ? String(payload.selectedAccountStatusDetail) : undefined,
    selectedAccountStatusTone: isBadgeTone(payload.selectedAccountStatusTone) ? payload.selectedAccountStatusTone : undefined,
    sessionUpdatedAt: payload.sessionUpdatedAt ? String(payload.sessionUpdatedAt) : undefined,
  }
}

export function normalizeMetaAdsHeaderAction(detail: unknown): MetaAdsHeaderAction | null {
  if (!detail || typeof detail !== 'object') return null
  const payload = detail as { type?: unknown; value?: unknown; action?: unknown }
  const rawType = String(payload.type || payload.action || '').trim()
  if (!rawType) return null
  if (rawType === 'refresh' || rawType === 'manage-connections' || rawType === 'disconnect') {
    return { type: rawType }
  }
  if (rawType === 'set-account') {
    return { type: 'set-account', value: String(payload.value || '') }
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
