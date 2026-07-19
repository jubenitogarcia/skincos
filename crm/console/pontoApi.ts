import type { PontoApiError } from './pontoTypes'
import { csrfHeader } from './csrf'

export const LS_DEV_ACTOR_EMAIL = 'skincos.ponto.devActorEmail.v1'

export function errorMetaString(meta: { code?: string; requestId?: string; cfRay?: string }) {
  const parts: string[] = []
  if (meta.code) parts.push(`code:${meta.code}`)
  if (meta.requestId) parts.push(`req:${meta.requestId}`)
  if (meta.cfRay) parts.push(`cf:${meta.cfRay}`)
  return parts.length ? parts.join(' • ') : ''
}

function b64UrlEncodeString(input: string): string {
  const bytes = new TextEncoder().encode(input)
  const binary = String.fromCharCode(...bytes)
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '')
}

export function getDevEmployeeActorHeaders(emailOverride?: string): Record<string, string> {
  if (!import.meta.env.DEV) return {}
  let email = ''
  if (emailOverride) email = String(emailOverride).trim().toLowerCase()
  else { try { email = String(localStorage.getItem(LS_DEV_ACTOR_EMAIL) || '').trim().toLowerCase() } catch { email = '' } }
  if (!email) return {}
  const actorB64 = b64UrlEncodeString(JSON.stringify({ email }))
  return { 'x-skincos-actor': actorB64, 'x-skincos-actor-ts': String(Date.now()) }
}

export function createRequestMeta() {
  return { requestId: globalThis.crypto?.randomUUID?.() || String(Date.now()), clientTime: new Date().toISOString(), tzOffsetMinutes: -new Date().getTimezoneOffset(), locale: navigator.language || 'pt-BR', appVersion: null as string | null }
}

export async function apiJson<T>(path: string, opts: { method?: string; body?: unknown; signal?: AbortSignal; headers?: Record<string, string> } = {}): Promise<T> {
  const method = (opts.method || 'GET').toUpperCase()
  const headers: Record<string, string> = { Accept: 'application/json', ...(!['GET', 'HEAD', 'OPTIONS'].includes(method) ? csrfHeader() : {}), ...(opts.headers || {}) }
  if (opts.body !== undefined) headers['content-type'] = 'application/json'
  const res = await fetch(path, { method, credentials: 'include', headers, body: opts.body === undefined ? undefined : JSON.stringify(opts.body), signal: opts.signal })
  const requestId = String(res.headers.get('x-request-id') || '').trim(); const cfRay = String(res.headers.get('cf-ray') || '').trim(); const text = await res.text()
  let payload: unknown = null
  try { payload = text ? JSON.parse(text) : null } catch { payload = null }
  const contentType = String(res.headers.get('content-type') || '').toLowerCase()
  if (res.ok && payload !== null && contentType.includes('application/json')) return payload as T
  const nonJsonText = String(text || ''); const workerCrash = !payload && (nonJsonText.includes('Worker threw exception') || nonJsonText.includes('Cloudflare Ray ID'))
  const detail = (payload || {}) as PontoApiError
  const code = String(detail.error || detail.code || (workerCrash ? 'UPSTREAM_WORKER_EXCEPTION' : !contentType.includes('application/json') ? 'INVALID_API_CONTENT_TYPE' : 'INVALID_API_PAYLOAD')).trim()
  const hint = typeof detail.hint === 'string' ? detail.hint.trim() : workerCrash ? 'Falha no Worker upstream. Consulte os logs com request-id/cf-ray.' : ''
  const base = detail.error || detail.message || (res.ok ? 'Resposta inválida da API de Ponto' : `HTTP ${res.status}`)
  const error = new Error([base, hint, errorMetaString({ code, requestId, cfRay })].filter(Boolean).join(' • '))
  Object.assign(error, { details: payload || { error: code }, status: res.status, requestId, cfRay, code, rawText: nonJsonText.slice(0, 240) })
  throw error
}

export async function apiBlob(path: string, opts: { signal?: AbortSignal } = {}): Promise<Blob> {
  const res = await fetch(path, { headers: { Accept: 'text/csv' }, credentials: 'include', signal: opts.signal })
  if (!res.ok) {
    const requestId = String(res.headers.get('x-request-id') || '').trim(); const cfRay = String(res.headers.get('cf-ray') || '').trim(); let message = `HTTP ${res.status}`
    try { const body = await res.json() as PontoApiError; message = body.error || body.message || message } catch { /* response is not JSON */ }
    const error = new Error([message, errorMetaString({ requestId, cfRay })].filter(Boolean).join(' • ')); Object.assign(error, { status: res.status, requestId, cfRay }); throw error
  }
  if (!String(res.headers.get('content-type') || '').toLowerCase().includes('text/csv')) throw new Error('Resposta de exportação inválida')
  return res.blob()
}

export async function fetchJsonWithMeta(path: string, opts: { method?: string; body?: unknown; signal?: AbortSignal; headers?: Record<string, string> } = {}) {
  const method = (opts.method || 'GET').toUpperCase(); const headers: Record<string, string> = { Accept: 'application/json', ...(!['GET', 'HEAD', 'OPTIONS'].includes(method) ? csrfHeader() : {}), ...(opts.headers || {}) }
  if (opts.body !== undefined) headers['content-type'] = 'application/json'
  const res = await fetch(path, { method, credentials: 'include', headers, body: opts.body === undefined ? undefined : JSON.stringify(opts.body), signal: opts.signal })
  const requestId = String(res.headers.get('x-request-id') || '').trim(); const cfRay = String(res.headers.get('cf-ray') || '').trim(); const text = await res.text(); let json: unknown = null
  try { json = text ? JSON.parse(text) : null } catch { json = null }
  return { ok: res.ok && json !== null && String(res.headers.get('content-type') || '').toLowerCase().includes('application/json'), status: res.status, requestId, cfRay, json, text }
}
