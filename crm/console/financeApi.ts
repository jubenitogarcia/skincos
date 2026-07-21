import { csrfHeader } from '@/csrf'

const FINANCE_ORIGIN = String(import.meta.env.VITE_FINANCE_API_ORIGIN || '/api').replace(/\/$/, '')
export type FinanceBootstrap = { ok: boolean; moduleEnabled: boolean; canAccess: boolean; grants: Array<{ scope_id: string; permission: string; label: string }> }

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(`${FINANCE_ORIGIN}/finance${path}`, { credentials: 'include', headers: { accept: 'application/json', ...csrfHeader(), ...(init.headers || {}) }, ...init })
  const payload = await res.json().catch(() => ({}))
  if (!res.ok) throw Object.assign(new Error(payload.message || payload.error || `HTTP ${res.status}`), { code: payload.error, status: res.status })
  return payload as T
}
export const financeApi = {
  bootstrap: () => request<FinanceBootstrap>('/bootstrap'),
  overview: (scopeId: string, from: string, to: string) => request<any>(`/overview?scopeId=${encodeURIComponent(scopeId)}&from=${from}&to=${to}`),
  accounts: (scopeId: string) => request<any>(`/accounts?scopeId=${encodeURIComponent(scopeId)}`),
  movements: (scopeId: string) => request<any>(`/movements?scopeId=${encodeURIComponent(scopeId)}`),
  categories: (scopeId: string) => request<any>(`/categories?scopeId=${encodeURIComponent(scopeId)}`),
  payees: (scopeId: string) => request<any>(`/payees?scopeId=${encodeURIComponent(scopeId)}`),
  create: (path: string, scopeId: string, body: unknown) => request<any>(`${path}?scopeId=${encodeURIComponent(scopeId)}`, { method: 'POST', headers: { 'content-type': 'application/json', 'idempotency-key': crypto.randomUUID() }, body: JSON.stringify(body) }),
  stageCsv: (scopeId: string, filename: string, csv: string) => request<any>(`/imports?scopeId=${encodeURIComponent(scopeId)}`, { method: 'POST', headers: { 'content-type': 'application/json', 'idempotency-key': crypto.randomUUID() }, body: JSON.stringify({ filename, csv }) }),
}
