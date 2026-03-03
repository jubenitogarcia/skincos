const DEFAULT_ESCALA_API_BASE = '/api/escala'

export const ESCALA_API_BASE =
  (import.meta as any).env?.VITE_ESCALA_API_URL || DEFAULT_ESCALA_API_BASE

type ApiResponse<T> = { ok: boolean; error?: string } & T

async function apiGet<T>(path: string): Promise<ApiResponse<T>> {
  const url = `${ESCALA_API_BASE}${path}`
  const res = await fetch(url, { credentials: 'include', headers: { accept: 'application/json' } })
  const json = await res.json().catch(() => null)
  if (!res.ok || !json) {
    return { ok: false, error: json?.error || `HTTP ${res.status}` } as ApiResponse<T>
  }
  return json as ApiResponse<T>
}

async function apiWrite<T>(path: string, method: string, body?: any): Promise<ApiResponse<T>> {
  const url = `${ESCALA_API_BASE}${path}`
  const res = await fetch(url, {
    method,
    credentials: 'include',
    headers: { accept: 'application/json', 'content-type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  })
  const json = await res.json().catch(() => null)
  if (!res.ok || !json) {
    return { ok: false, error: json?.error || `HTTP ${res.status}` } as ApiResponse<T>
  }
  return json as ApiResponse<T>
}

export async function fetchEscalaOverview() {
  return apiGet<{ units: string[]; months: string[] }>(`/overview`)
}

export async function fetchEscalaProfessionals(unit?: string) {
  const qs = unit ? `?unit=${encodeURIComponent(unit)}` : ''
  return apiGet<{ data: any[] }>(`/professionals${qs}`)
}

export async function fetchEscalaSchedule(unit?: string, month?: string) {
  const params = new URLSearchParams()
  if (unit) params.set('unit', unit)
  if (month) params.set('month', month)
  const qs = params.toString() ? `?${params.toString()}` : ''
  return apiGet<{ schedule: any[]; closedDays: any[]; holidays: any[] }>(`/schedule${qs}`)
}

export async function addScheduleEntry(payload: { date: string; unit: string; professional?: string; professionals?: string[] }) {
  return apiWrite<{ ok: boolean }>(`/schedule`, 'POST', payload)
}

export async function replaceScheduleEntries(payload: { date: string; unit: string; professionals: string[] }) {
  return apiWrite<{ ok: boolean }>(`/schedule`, 'PUT', payload)
}

export async function removeScheduleEntry(payload: { date: string; unit: string; professional?: string }) {
  return apiWrite<{ ok: boolean }>(`/schedule`, 'DELETE', payload)
}

export async function addClosedDay(payload: { date: string; unit: string; reason?: string }) {
  return apiWrite<{ ok: boolean }>(`/closed-days`, 'POST', payload)
}

export async function removeClosedDay(payload: { date: string; unit: string }) {
  return apiWrite<{ ok: boolean }>(`/closed-days`, 'DELETE', payload)
}

export async function addHoliday(payload: { date: string; unit: string; name: string }) {
  return apiWrite<{ ok: boolean }>(`/holidays`, 'POST', payload)
}

export async function removeHoliday(payload: { date: string; unit: string; name: string }) {
  return apiWrite<{ ok: boolean }>(`/holidays`, 'DELETE', payload)
}
