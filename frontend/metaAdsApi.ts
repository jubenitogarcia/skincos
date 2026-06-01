import { getCsrfToken } from '@/csrf'
import {
  connectMetaAdsManualLocal,
  disconnectMetaAdsLocal,
  getMetaAdsLocalInventory,
  getMetaAdsLocalEntityDetail,
  getMetaAdsLocalReport,
  getMetaAdsLocalStatus,
  getMetaAdsLocalSummary,
  getMetaAdsLocalTrend,
  isMetaAdsLocalMockEnabled,
  listMetaAdsLocalAccounts,
  removeMetaAdsLocalAccount,
  selectMetaAdsLocalAccount,
  simulateMetaAdsOAuthConnect,
  updateMetaAdsLocalEntity,
} from '@/metaAdsLocalMock'
import { normalizeMetaAdsApiError } from '@/metaAdsState'
import type {
  MetaAdAccount,
  MetaAdsStatusResponse,
  MetaAdsReportResponse,
  MetaAdsSummaryResponse,
  MetaAdsTrendPoint,
  MetaInventoryResponse,
  MetaAdsEntityDetailResponse,
  MetaAdsEntityPatch,
  MetaAdsEntityType,
  MetaAdsEntityUpdateResponse,
} from '@/metaAdsTypes'

const META_ADS_API_URL =
  (import.meta as any).env?.VITE_META_ADS_API_URL || '/api/meta-ads'
const META_ADS_ENTITY_DETAIL_CACHE_PREFIX = 'skincos:meta-ads:entity-detail:v1'
const META_ADS_ENTITY_DETAIL_CACHE_TTL_MS = 1000 * 60 * 30

const entityDetailMemoryCache = new Map<string, { value: MetaAdsEntityDetailResponse; cachedAt: number }>()

function entityDetailCacheKey(type: MetaAdsEntityType, id: string) {
  return `${META_ADS_ENTITY_DETAIL_CACHE_PREFIX}:${type}:${id}`
}

function readCachedEntityDetail(type: MetaAdsEntityType, id: string) {
  const key = entityDetailCacheKey(type, id)
  const memoryEntry = entityDetailMemoryCache.get(key)
  const now = Date.now()
  if (memoryEntry && now - memoryEntry.cachedAt <= META_ADS_ENTITY_DETAIL_CACHE_TTL_MS) {
    return memoryEntry.value
  }
  if (typeof window === 'undefined') return null
  try {
    const raw = window.localStorage.getItem(key)
    if (!raw) return null
    const parsed = JSON.parse(raw) as { cachedAt?: number; value?: MetaAdsEntityDetailResponse }
    if (!parsed?.cachedAt || !parsed.value || now - parsed.cachedAt > META_ADS_ENTITY_DETAIL_CACHE_TTL_MS) {
      window.localStorage.removeItem(key)
      return null
    }
    entityDetailMemoryCache.set(key, { value: parsed.value, cachedAt: parsed.cachedAt })
    return parsed.value
  } catch {
    return null
  }
}

function writeCachedEntityDetail(type: MetaAdsEntityType, id: string, value: MetaAdsEntityDetailResponse) {
  const key = entityDetailCacheKey(type, id)
  const cachedAt = Date.now()
  entityDetailMemoryCache.set(key, { value, cachedAt })
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(key, JSON.stringify({ cachedAt, value }))
  } catch {
    // Cache is an optimization only; storage quota or privacy failures should not block the CRM.
  }
}

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
  removeAdAccount: (payload: { adAccountId: string }) =>
    isMetaAdsLocalMockEnabled()
      ? removeMetaAdsLocalAccount(payload.adAccountId)
      : request('/ad-accounts/remove', { method: 'POST', body: JSON.stringify(payload) }),
  summary: (params?: { since?: string; until?: string }) => {
    const search = new URLSearchParams(params as any).toString()
    return isMetaAdsLocalMockEnabled()
      ? getMetaAdsLocalSummary(params)
      : request<MetaAdsSummaryResponse>(`/summary${search ? `?${search}` : ''}`)
  },
  trend: (params?: { since?: string; until?: string }) => {
    const search = new URLSearchParams(params as any).toString()
    return isMetaAdsLocalMockEnabled()
      ? getMetaAdsLocalTrend(params)
      : request<MetaAdsTrendPoint[]>(`/trend${search ? `?${search}` : ''}`)
  },
  report: (params?: { since?: string; until?: string }) => {
    const search = new URLSearchParams(params as any).toString()
    return isMetaAdsLocalMockEnabled()
      ? getMetaAdsLocalReport(params)
      : request<MetaAdsReportResponse>(`/report${search ? `?${search}` : ''}`)
  },
  inventory: () => (isMetaAdsLocalMockEnabled() ? getMetaAdsLocalInventory() : request<MetaInventoryResponse>('/inventory')),
  cachedEntityDetail: (type: MetaAdsEntityType, id: string) => readCachedEntityDetail(type, id),
  entityDetail: async (type: MetaAdsEntityType, id: string) => {
    const cached = readCachedEntityDetail(type, id)
    if (cached) return cached
    const response = isMetaAdsLocalMockEnabled()
      ? await getMetaAdsLocalEntityDetail(type, id)
      : await request<MetaAdsEntityDetailResponse>(`/entities/${type}/${encodeURIComponent(id)}`)
    writeCachedEntityDetail(type, id, response)
    return response
  },
  updateEntity: async (type: MetaAdsEntityType, id: string, patch: MetaAdsEntityPatch) => {
    const response = isMetaAdsLocalMockEnabled()
      ? await updateMetaAdsLocalEntity(type, id, patch)
      : await request<MetaAdsEntityUpdateResponse>(`/entities/${type}/${encodeURIComponent(id)}`, {
          method: 'PATCH',
          body: JSON.stringify({ patch }),
        })
    writeCachedEntityDetail(type, id, { ok: true, entity: response.entity })
    return response
  },
}
