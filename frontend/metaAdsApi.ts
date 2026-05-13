import { getCsrfToken } from '@/csrf'
import {
  connectMetaAdsManualLocal,
  disconnectMetaAdsLocal,
  getMetaAdsLocalInventory,
  getMetaAdsLocalStatus,
  getMetaAdsLocalSummary,
  getMetaAdsLocalTrend,
  isMetaAdsLocalMockEnabled,
  listMetaAdsLocalAccounts,
  selectMetaAdsLocalAccount,
  simulateMetaAdsOAuthConnect,
} from '@/metaAdsLocalMock'
import { normalizeMetaAdsApiError } from '@/metaAdsState'
import type {
  MetaAdAccount,
  MetaAdsStatusResponse,
  MetaAdsSummaryResponse,
  MetaAdsTrendPoint,
  MetaInventoryResponse,
} from '@/metaAdsTypes'

const META_ADS_API_URL =
  (import.meta as any).env?.VITE_META_ADS_API_URL || '/api/meta-ads'

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const headers = new Headers(options.headers || {})
  headers.set('Accept', 'application/json')
  const method = String(options.method || 'GET').toUpperCase()
  if (options.body !== undefined && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json')
  }
  if (method !== 'GET') {
    const csrfToken = getCsrfToken()
    if (csrfToken) headers.set('x-csrf-token', csrfToken)
  }
  const res = await fetch(`${META_ADS_API_URL}${path}`, {
    ...options,
    headers,
    credentials: 'include',
  })
  const text = await res.text()
  let json: any = null
  try {
    json = text ? JSON.parse(text) : null
  } catch {
    json = null
  }
  if (!res.ok) {
    const error = new Error(json?.message || json?.hint || json?.error || text || 'Request failed')
    ;(error as any).status = res.status
    ;(error as any).payload = json
    throw normalizeMetaAdsApiError(error)
  }
  return json as T
}

export const metaAdsApi = {
  isLocalMockMode: () => isMetaAdsLocalMockEnabled(),
  simulateOAuthConnect: () => simulateMetaAdsOAuthConnect(),
  status: () => (isMetaAdsLocalMockEnabled() ? getMetaAdsLocalStatus() : request<MetaAdsStatusResponse>('/status')),
  oauthStartUrl: () => `${META_ADS_API_URL}/oauth/start`,
  connectManual: (payload: { accessToken: string }) =>
    isMetaAdsLocalMockEnabled()
      ? connectMetaAdsManualLocal()
      : request('/connect/manual', { method: 'POST', body: JSON.stringify(payload) }),
  disconnect: () => (isMetaAdsLocalMockEnabled() ? disconnectMetaAdsLocal() : request('/disconnect', { method: 'POST' })),
  listAdAccounts: () =>
    isMetaAdsLocalMockEnabled()
      ? listMetaAdsLocalAccounts()
      : request<{
          ok: boolean
          connected: boolean
          selectedAdAccountId: string | null
          accounts: MetaAdAccount[]
        }>('/ad-accounts'),
  selectAdAccount: (payload: { adAccountId: string }) =>
    isMetaAdsLocalMockEnabled()
      ? selectMetaAdsLocalAccount(payload.adAccountId)
      : request('/ad-accounts/select', { method: 'POST', body: JSON.stringify(payload) }),
  summary: (params?: { since?: string; until?: string }) => {
    const search = new URLSearchParams(params as any).toString()
    return isMetaAdsLocalMockEnabled()
      ? getMetaAdsLocalSummary()
      : request<MetaAdsSummaryResponse>(`/summary${search ? `?${search}` : ''}`)
  },
  trend: (params?: { since?: string; until?: string }) => {
    const search = new URLSearchParams(params as any).toString()
    return isMetaAdsLocalMockEnabled()
      ? getMetaAdsLocalTrend()
      : request<MetaAdsTrendPoint[]>(`/trend${search ? `?${search}` : ''}`)
  },
  inventory: () => (isMetaAdsLocalMockEnabled() ? getMetaAdsLocalInventory() : request<MetaInventoryResponse>('/inventory')),
}
