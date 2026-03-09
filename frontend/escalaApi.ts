const DEFAULT_ESCALA_API_BASE = '/api/escala'

export const ESCALA_API_BASE =
  (import.meta as any).env?.VITE_ESCALA_API_URL || DEFAULT_ESCALA_API_BASE

type ApiResponse<T> = { ok: boolean; error?: string } & T

function parseJsonResponse(text: string) {
  if (!text) return null
  try {
    return JSON.parse(text)
  } catch {
    return null
  }
}

function normalizeApiError(res: Response, json: any, text: string) {
  if (json?.error) return String(json.error)
  if (json?.message) return String(json.message)
  if (text && !json) {
    const compact = text.replace(/\s+/g, ' ').trim()
    if (compact) return compact.slice(0, 180)
  }
  return `HTTP ${res.status}`
}

function normalizeFetchError(error: unknown) {
  const detail = String((error as any)?.message || error || '').trim()
  const suffix = detail ? ` ${detail}` : ''
  return `Falha de conexão com a Escala.${suffix} Verifique /api/escala/_proxy-status.`
}

async function apiGet<T>(path: string): Promise<ApiResponse<T>> {
  const url = `${ESCALA_API_BASE}${path}`
  try {
    const res = await fetch(url, { credentials: 'include', headers: { accept: 'application/json' } })
    const text = await res.text()
    const json = parseJsonResponse(text)
    const contentType = String(res.headers.get('content-type') || '').toLowerCase()
    const likelyJson = contentType.includes('application/json')
    if (!res.ok || json?.ok === false) {
      return { ok: false, error: normalizeApiError(res, json, text) } as ApiResponse<T>
    }
    if (!json || typeof json !== 'object') {
      const hint = likelyJson ? 'Payload JSON inválido.' : 'Retorno não-JSON.'
      return { ok: false, error: `${hint} Verifique /api/escala/_proxy-status.` } as ApiResponse<T>
    }
    return json as ApiResponse<T>
  } catch (error) {
    return { ok: false, error: normalizeFetchError(error) } as ApiResponse<T>
  }
}

async function apiWrite<T>(path: string, method: string, body?: any): Promise<ApiResponse<T>> {
  const url = `${ESCALA_API_BASE}${path}`
  try {
    const res = await fetch(url, {
      method,
      credentials: 'include',
      headers: { accept: 'application/json', 'content-type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
    })
    const text = await res.text()
    const json = parseJsonResponse(text)
    const contentType = String(res.headers.get('content-type') || '').toLowerCase()
    const likelyJson = contentType.includes('application/json')
    if (!res.ok || json?.ok === false) {
      return { ok: false, error: normalizeApiError(res, json, text) } as ApiResponse<T>
    }
    if (!json || typeof json !== 'object') {
      const hint = likelyJson ? 'Payload JSON inválido.' : 'Retorno não-JSON.'
      return { ok: false, error: `${hint} Verifique /api/escala/_proxy-status.` } as ApiResponse<T>
    }
    return json as ApiResponse<T>
  } catch (error) {
    return { ok: false, error: normalizeFetchError(error) } as ApiResponse<T>
  }
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
