const META_ADS_API_URL =
  (import.meta as any).env?.VITE_META_ADS_API_URL || '/api/meta-ads'

const TOKEN_KEY = 'skincos.metaAds.token.v1'

export function setMetaAdsToken(token: string) {
  localStorage.setItem(TOKEN_KEY, token)
}

export function getMetaAdsToken(): string | null {
  return localStorage.getItem(TOKEN_KEY)
}

export function clearMetaAdsToken() {
  localStorage.removeItem(TOKEN_KEY)
}

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const token = getMetaAdsToken()
  const headers = new Headers(options.headers || {})
  headers.set('Content-Type', 'application/json')
  if (token) headers.set('Authorization', `Bearer ${token}`)
  const res = await fetch(`${META_ADS_API_URL}${path}`, { ...options, headers })
  const text = await res.text()
  let json: any = null
  try {
    json = text ? JSON.parse(text) : null
  } catch {
    json = null
  }
  if (!res.ok) {
    throw new Error(json?.message || json?.error || text || 'Request failed')
  }
  return json as T
}

export const metaAdsApi = {
  register: (payload: any) => request('/auth/register', { method: 'POST', body: JSON.stringify(payload) }),
  login: (payload: any) => request('/auth/login', { method: 'POST', body: JSON.stringify(payload) }),
  me: () => request('/auth/me'),
  oauthUrl: () => request('/meta/oauth/url'),
  listAdAccounts: () => request('/meta/ad-accounts'),
  selectAdAccount: (payload: any) => request('/meta/ad-accounts/select', { method: 'POST', body: JSON.stringify(payload) }),
  listCampaigns: () => request('/meta/campaigns'),
  syncInsights: (payload: any) => request('/meta/insights/sync', { method: 'POST', body: JSON.stringify(payload) }),
  bulkPreview: (payload: any) => request('/bulk/preview', { method: 'POST', body: JSON.stringify(payload) }),
  bulkExecute: (payload: any) => request('/bulk/execute', { method: 'POST', body: JSON.stringify(payload) }),
  bulkOperations: () => request('/bulk/operations'),
  alerts: () => request('/alerts'),
  resolveAlert: (id: string) => request(`/alerts/${id}/resolve`, { method: 'POST' }),
  summary: (params?: { since?: string; until?: string }) => {
    const search = new URLSearchParams(params as any).toString()
    return request(`/reports/summary${search ? `?${search}` : ''}`)
  },
  trend: (params?: { since?: string; until?: string }) => {
    const search = new URLSearchParams(params as any).toString()
    return request(`/reports/trend${search ? `?${search}` : ''}`)
  },
}
