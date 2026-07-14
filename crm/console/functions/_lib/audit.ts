import { putJson } from './r2'

export type AuditEvent = {
  id: string
  at: string
  scope: string
  action: string
  actor?: { id?: string; email?: string; name?: string }
  target?: Record<string, unknown>
  request?: { method?: string; path?: string; ip?: string; cfRay?: string; userAgent?: string }
  ok?: boolean
  error?: string
}

const dateKeyUtc = (iso: string) => {
  const ms = Date.parse(iso)
  const d = Number.isFinite(ms) ? new Date(ms) : new Date()
  const yyyy = String(d.getUTCFullYear()).padStart(4, '0')
  const mm = String(d.getUTCMonth() + 1).padStart(2, '0')
  const dd = String(d.getUTCDate()).padStart(2, '0')
  return `${yyyy}-${mm}-${dd}`
}

export function auditEventKey(scope: string, atIso: string, id: string) {
  const day = dateKeyUtc(atIso)
  return `internal/audit/${encodeURIComponent(scope)}/${day}/${encodeURIComponent(id)}.json`
}

export function requestAuditMeta(request: Request) {
  try {
    const url = new URL(request.url)
    const ip =
      request.headers.get('cf-connecting-ip') ||
      request.headers.get('x-forwarded-for') ||
      request.headers.get('x-real-ip') ||
      undefined
    return {
      method: request.method,
      path: `${url.pathname}${url.search}`,
      ip: ip ? String(ip).split(',')[0].trim() : undefined,
      cfRay: request.headers.get('cf-ray') || undefined,
      userAgent: request.headers.get('user-agent') || undefined,
    }
  } catch {
    return { method: request.method }
  }
}

export async function writeAuditEvent(bucket: R2Bucket, event: Omit<AuditEvent, 'id' | 'at'> & { id?: string; at?: string }) {
  const id = String(event.id || crypto.randomUUID())
  const at = String(event.at || new Date().toISOString())
  const scope = String(event.scope || '').trim() || 'unknown'
  const out: AuditEvent = { ...event, id, at, scope }
  await putJson(bucket, auditEventKey(scope, at, id), out)
  return out
}

