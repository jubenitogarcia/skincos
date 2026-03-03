const DEFAULT_ESCALA_API_BASE = (import.meta as any).env?.PROD
  ? 'https://escala-api.skincos.com.br/api/escala'
  : '/api/escala'

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
