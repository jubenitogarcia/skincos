import { csrfHeader } from '@/csrf'

const FINANCE_ORIGIN = String(import.meta.env.VITE_FINANCE_API_ORIGIN || '/api').replace(/\/$/, '')
export type FinanceBootstrap = { ok: boolean; moduleEnabled: boolean; canAccess: boolean; grants: Array<{ scope_id: string; permission: string; label: string }> }

// Transport-only parser. The Finance Worker repeats the invariant and remains
// the authority; this avoids IEEE-754 arithmetic in the React component.
export function minorUnitsFromDisplay(value: string): number | null {
  const match = value.trim().match(/^(\d+)(?:[,.](\d{1,2}))?$/)
  if (!match) return null
  const minor = Number(match[1]) * 100 + Number((match[2] || '').padEnd(2, '0'))
  return Number.isSafeInteger(minor) && minor > 0 ? minor : null
}

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
  movements: (scopeId: string, filters: Record<string, string | number | undefined> = {}) => {
    const search = new URLSearchParams({ scopeId })
    for (const [key, value] of Object.entries(filters)) if (value !== undefined && value !== '') search.set(key, String(value))
    return request<any>(`/movements?${search.toString()}`)
  },
  movement: (scopeId: string, movementId: string) => request<any>(`/movements/${encodeURIComponent(movementId)}?scopeId=${encodeURIComponent(scopeId)}`),
  categories: (scopeId: string) => request<any>(`/categories?scopeId=${encodeURIComponent(scopeId)}`),
  payees: (scopeId: string) => request<any>(`/payees?scopeId=${encodeURIComponent(scopeId)}`),
  tags: (scopeId: string) => request<any>(`/tags?scopeId=${encodeURIComponent(scopeId)}`),
  costCenters: (scopeId: string) => request<any>(`/cost-centers?scopeId=${encodeURIComponent(scopeId)}`),
  create: (path: string, scopeId: string, body: unknown) => request<any>(`${path}?scopeId=${encodeURIComponent(scopeId)}`, { method: 'POST', headers: { 'content-type': 'application/json', 'idempotency-key': crypto.randomUUID() }, body: JSON.stringify(body) }),
  stageCsv: (scopeId: string, filename: string, csv: string) => request<any>(`/imports?scopeId=${encodeURIComponent(scopeId)}`, { method: 'POST', headers: { 'content-type': 'application/json', 'idempotency-key': crypto.randomUUID() }, body: JSON.stringify({ filename, csv }) }),
  transition: (scopeId: string, movementId: string, action: 'confirm' | 'reconcile' | 'reverse', body: Record<string, unknown> = {}) => request<any>(`/movements/${encodeURIComponent(movementId)}/${action}?scopeId=${encodeURIComponent(scopeId)}`, { method: 'POST', headers: { 'content-type': 'application/json', 'idempotency-key': crypto.randomUUID() }, body: JSON.stringify(body) }),
  payInstallment: (scopeId: string, installmentId: string, paidDate: string) => request<any>(`/installments/${encodeURIComponent(installmentId)}/pay?scopeId=${encodeURIComponent(scopeId)}`, { method: 'POST', headers: { 'content-type': 'application/json', 'idempotency-key': crypto.randomUUID() }, body: JSON.stringify({ paidDate }) }),
}
