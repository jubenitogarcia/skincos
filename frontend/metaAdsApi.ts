import { getCsrfToken } from '@/csrf'

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
    throw error
  }
  return json as T
}

export type MetaAdsStatusResponse = {
  ok: boolean
  oauthConfigured: boolean
  missingConfig: string[]
  connection: {
    connected: boolean
    tokenType: 'manual' | 'oauth' | null
    metaUserId: string | null
    metaUserName: string | null
    selectedAdAccountId: string | null
    scopes: string[]
    updatedAt: string | null
    expiresAt: string | null
  }
}

export const metaAdsApi = {
  status: () => request<MetaAdsStatusResponse>('/status'),
  oauthStartUrl: () => `${META_ADS_API_URL}/oauth/start`,
  connectManual: (payload: { accessToken: string }) =>
    request('/connect/manual', { method: 'POST', body: JSON.stringify(payload) }),
  disconnect: () => request('/disconnect', { method: 'POST' }),
  listAdAccounts: () => request<{
    ok: boolean
    connected: boolean
    selectedAdAccountId: string | null
    accounts: Array<{
      id: string
      name: string
      account_status?: string
      currency?: string
      timezone_name?: string
      business_name?: string
      isSelected?: boolean
    }>
  }>('/ad-accounts'),
  selectAdAccount: (payload: { adAccountId: string }) =>
    request('/ad-accounts/select', { method: 'POST', body: JSON.stringify(payload) }),
  summary: (params?: { since?: string; until?: string }) => {
    const search = new URLSearchParams(params as any).toString()
    return request(`/summary${search ? `?${search}` : ''}`)
  },
  trend: (params?: { since?: string; until?: string }) => {
    const search = new URLSearchParams(params as any).toString()
    return request(`/trend${search ? `?${search}` : ''}`)
  },
  inventory: () => request<{
    ok: boolean
    accountId: string
    inventory: {
      campaigns: any[]
      adSets: any[]
      ads: any[]
      creatives: any[]
    }
  }>('/inventory'),
}
