import { csrfHeader } from '@/csrf'

const FINANCE_ORIGIN = String(import.meta.env.VITE_FINANCE_API_ORIGIN || '/api').replace(/\/$/, '')

export type FinanceGrant = { scope_id: string; permission: string; label: string; kind?: 'unit' | 'personal' }
export type FinanceBootstrap = { ok: boolean; moduleEnabled: boolean; canAccess: boolean; grants: FinanceGrant[] }
export type FinanceList<T> = { ok: boolean; page: number; limit: number; total?: number; movements?: T[]; events?: T[]; accounts?: T[]; categories?: T[]; payees?: T[]; tags?: T[]; costCenters?: T[] }
export type FinanceFilters = { from?: string; to?: string; accountId?: string; categoryId?: string; payeeId?: string; costCenterId?: string; status?: string; q?: string; page?: number; limit?: number }

export class FinanceApiError extends Error {
  code?: string
  status?: number

  constructor(message: string, { code, status }: { code?: string; status?: number } = {}) {
    super(message)
    this.name = 'FinanceApiError'
    this.code = code
    this.status = status
  }
}

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
  if (!res.ok) throw new FinanceApiError(payload.message || payload.error || `HTTP ${res.status}`, { code: payload.error, status: res.status })
  return payload as T
}

function scopedQuery(scopeId: string, filters: Record<string, string | number | undefined> = {}) {
  const search = new URLSearchParams({ scopeId })
  for (const [key, value] of Object.entries(filters)) if (value !== undefined && value !== '') search.set(key, String(value))
  return search.toString()
}

function idempotencyHeaders(key?: string) {
  return { 'content-type': 'application/json', 'idempotency-key': key || crypto.randomUUID() }
}

export const financeApi = {
  bootstrap: () => request<FinanceBootstrap>('/bootstrap'),
  overview: (scopeId: string, from: string, to: string) => request<any>(`/overview?${scopedQuery(scopeId, { from, to })}`),
  accounts: (scopeId: string) => request<FinanceList<any>>(`/accounts?${scopedQuery(scopeId)}`),
  categories: (scopeId: string) => request<FinanceList<any>>(`/categories?${scopedQuery(scopeId)}`),
  payees: (scopeId: string) => request<FinanceList<any>>(`/payees?${scopedQuery(scopeId)}`),
  tags: (scopeId: string) => request<FinanceList<any>>(`/tags?${scopedQuery(scopeId)}`),
  costCenters: (scopeId: string) => request<FinanceList<any>>(`/cost-centers?${scopedQuery(scopeId)}`),
  movements: (scopeId: string, filters: FinanceFilters = {}) => request<FinanceList<any>>(`/movements?${scopedQuery(scopeId, filters)}`),
  movement: (scopeId: string, movementId: string) => request<any>(`/movements/${encodeURIComponent(movementId)}?${scopedQuery(scopeId)}`),
  reviseDraft: (scopeId: string, movementId: string, body: Record<string, unknown>, idempotencyKey?: string) => request<any>(`/movements/${encodeURIComponent(movementId)}?${scopedQuery(scopeId)}`, { method: 'PUT', headers: idempotencyHeaders(idempotencyKey), body: JSON.stringify(body) }),
  audit: (scopeId: string, filters: { entityId?: string; entityType?: string; page?: number; limit?: number } = {}) => request<FinanceList<any>>(`/audit?${scopedQuery(scopeId, filters)}`),
  create: (path: string, scopeId: string, body: unknown, idempotencyKey?: string) => request<any>(`${path}?${scopedQuery(scopeId)}`, { method: 'POST', headers: idempotencyHeaders(idempotencyKey), body: JSON.stringify(body) }),
  registrationLifecycle: (scopeId: string, collection: 'accounts' | 'categories' | 'payees' | 'tags' | 'cost-centers', entityId: string, action: 'archive' | 'restore', idempotencyKey?: string) => request<any>(`/${collection}/${encodeURIComponent(entityId)}/${action}?${scopedQuery(scopeId)}`, { method: 'POST', headers: idempotencyHeaders(idempotencyKey), body: '{}' }),
  reconciliationLines: (scopeId: string, accountId?: string) => request<any>(`/reconciliation/lines?${scopedQuery(scopeId, { accountId })}`),
  createReconciliationLine: (scopeId: string, body: { accountId: string; postedDate: string; amountMinor: number; currency: string; description?: string; externalId?: string }, idempotencyKey?: string) => request<any>(`/reconciliation/lines?${scopedQuery(scopeId)}`, { method: 'POST', headers: idempotencyHeaders(idempotencyKey), body: JSON.stringify(body) }),
  reconciliationSuggestions: (scopeId: string, lineId: string, idempotencyKey?: string) => request<any>(`/reconciliation/lines/${encodeURIComponent(lineId)}/suggestions?${scopedQuery(scopeId)}`, { method: 'POST', headers: idempotencyHeaders(idempotencyKey), body: '{}' }),
  reconciliationMatch: (scopeId: string, lineId: string, movementId: string, decision: 'confirm' | 'reject', idempotencyKey?: string) => request<any>(`/reconciliation/lines/${encodeURIComponent(lineId)}/matches?${scopedQuery(scopeId)}`, { method: 'POST', headers: idempotencyHeaders(idempotencyKey), body: JSON.stringify({ movementId, decision }) }),
  stageCsv: (scopeId: string, filename: string, content: string, options: { mapping?: Record<string, string>; encoding?: string; sourceType?: 'generic' | 'moneywiz' | 'ef-caixa'; efCaixa?: unknown; idempotencyKey?: string } = {}) => request<any>(`/imports?${scopedQuery(scopeId)}`, { method: 'POST', headers: idempotencyHeaders(options.idempotencyKey), body: JSON.stringify({ filename, csv: options.sourceType === 'ef-caixa' ? undefined : content, efCaixa: options.efCaixa, mapping: options.mapping, encoding: options.encoding, sourceType: options.sourceType || 'generic' }) }),
  import: (scopeId: string, batchId: string) => request<any>(`/imports/${encodeURIComponent(batchId)}?${scopedQuery(scopeId)}`),
  importAnalyze: (scopeId: string, batchId: string, body: { mapping: Record<string, string>; encoding?: string }, idempotencyKey?: string) => request<any>(`/imports/${encodeURIComponent(batchId)}/analyze?${scopedQuery(scopeId)}`, { method: 'POST', headers: idempotencyHeaders(idempotencyKey), body: JSON.stringify(body) }),
  importDecision: (scopeId: string, batchId: string, body: { rowId: string; decision: 'import' | 'skip' | 'review'; accountId?: string | null; categoryId?: string | null; payeeId?: string | null; transferAccountId?: string | null; reason?: string }, idempotencyKey?: string) => request<any>(`/imports/${encodeURIComponent(batchId)}/decisions?${scopedQuery(scopeId)}`, { method: 'POST', headers: idempotencyHeaders(idempotencyKey), body: JSON.stringify(body) }),
  importPreview: (scopeId: string, batchId: string) => request<any>(`/imports/${encodeURIComponent(batchId)}/preview?${scopedQuery(scopeId)}`, { method: 'POST', headers: idempotencyHeaders(), body: '{}' }),
  importCommit: (scopeId: string, batchId: string, body: { defaultAccountId?: string; defaultCategoryId?: string; incomeCategoryId?: string; expenseCategoryId?: string; accountId?: string; categoryId?: string }, idempotencyKey?: string) => request<any>(`/imports/${encodeURIComponent(batchId)}/commit?${scopedQuery(scopeId)}`, { method: 'POST', headers: idempotencyHeaders(idempotencyKey), body: JSON.stringify(body) }),
  importUndo: (scopeId: string, batchId: string, reason: string, idempotencyKey?: string) => request<any>(`/imports/${encodeURIComponent(batchId)}/undo?${scopedQuery(scopeId)}`, { method: 'POST', headers: idempotencyHeaders(idempotencyKey), body: JSON.stringify({ reason }) }),
  transition: (scopeId: string, movementId: string, action: 'confirm' | 'reconcile' | 'reverse', body: Record<string, unknown> = {}) => request<any>(`/movements/${encodeURIComponent(movementId)}/${action}?${scopedQuery(scopeId)}`, { method: 'POST', headers: idempotencyHeaders(), body: JSON.stringify(body) }),
  payInstallment: (scopeId: string, installmentId: string, paidDate: string) => request<any>(`/installments/${encodeURIComponent(installmentId)}/pay?${scopedQuery(scopeId)}`, { method: 'POST', headers: idempotencyHeaders(), body: JSON.stringify({ paidDate }) }),
}
