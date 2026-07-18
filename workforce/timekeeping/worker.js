import { canonicalEventType, calculateDay, calculatePeriod } from './domain.js'

const encoder = new TextEncoder()
const json = (status, payload, requestId) => new Response(JSON.stringify({ ...payload, requestId }), {
  status,
  headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'x-request-id': requestId },
})
const now = () => new Date().toISOString()
const b64Url = (value) => {
  const normalized = String(value || '').replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(String(value || '').length / 4) * 4, '=')
  return new TextDecoder().decode(Uint8Array.from(atob(normalized), (ch) => ch.charCodeAt(0)))
}
const stable = (value) => JSON.stringify(value, Object.keys(value || {}).sort())

async function hmac(secret, text) {
  const key = await crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  const bytes = new Uint8Array(await crypto.subtle.sign('HMAC', key, encoder.encode(text)))
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '')
}

function equal(a, b) {
  const left = encoder.encode(String(a || ''))
  const right = encoder.encode(String(b || ''))
  if (left.length !== right.length) return false
  let result = 0
  for (let i = 0; i < left.length; i++) result |= left[i] ^ right[i]
  return result === 0
}

function requestIdFor(request) { return String(request.headers.get('x-request-id') || crypto.randomUUID()).slice(0, 120) }
function normalizeUnits(value) { return Array.from(new Set(Array.isArray(value) ? value.map((v) => String(v || '').trim()).filter(Boolean) : [])) }
function roleAllows(role, action) {
  const matrix = {
    EMPLOYEE: ['self.read', 'self.punch'], DEVICE: ['device.punch'],
    MANAGER: ['unit.read', 'correction.request', 'correction.approve'],
    HR: ['unit.read', 'correction.request', 'correction.approve', 'period.close', 'period.reopen', 'export.read'],
    ADMIN: ['unit.read', 'correction.request', 'correction.approve', 'period.close', 'period.reopen', 'device.manage', 'export.read', 'audit.read'],
    AUDITOR: ['unit.read', 'audit.read', 'export.read'],
  }
  return (matrix[String(role || '').toUpperCase()] || []).includes(action)
}

async function actorFor(request, env) {
  const raw = String(request.headers.get('x-skincos-actor') || '')
  const timestamp = String(request.headers.get('x-skincos-actor-ts') || '')
  const signature = String(request.headers.get('x-skincos-actor-sig') || '')
  const secret = String(env.PONTO_ACTOR_HMAC_KEY || '')
  if (!raw || !timestamp || !signature || !secret) return null
  const ms = Number(timestamp)
  if (!Number.isFinite(ms) || Math.abs(Date.now() - ms) > 300000) return null
  const expected = await hmac(secret, `${timestamp}.${raw}`)
  if (!equal(expected, signature)) return null
  try {
    const parsed = JSON.parse(b64Url(raw))
    if (!parsed?.id || !parsed?.email) return null
    return { id: String(parsed.id), email: String(parsed.email).toLowerCase(), role: String(parsed.role || 'EMPLOYEE').toUpperCase(), allowedUnits: normalizeUnits(parsed.allowedUnits), name: String(parsed.name || '') }
  } catch { return null }
}

function requireUnit(actor, unitId) {
  return actor.role === 'ADMIN' || actor.role === 'HR' || actor.allowedUnits.includes(String(unitId || ''))
}

async function audit(db, { actor, action, entityType, entityId, unitId, requestId, reason, before, after }) {
  const occurredAt = now()
  const previous = await db.prepare('SELECT hash FROM timekeeping_audit_events ORDER BY occurred_at DESC, id DESC LIMIT 1').first()
  const payload = { occurredAt, actorId: actor.id, action, entityType, entityId, unitId: unitId || null, requestId, reason: reason || null }
  const digest = await crypto.subtle.digest('SHA-256', encoder.encode(`${previous?.hash || ''}\n${stable(payload)}`))
  const hash = Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('')
  return db.prepare(`INSERT INTO timekeeping_audit_events (id, occurred_at, actor_id, actor_role, action, entity_type, entity_id, unit_id, reason, before_json, after_json, request_id, origin, prev_hash, hash) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .bind(crypto.randomUUID(), occurredAt, actor.id, actor.role, action, entityType, entityId, unitId || null, reason || null, before ? JSON.stringify(before) : null, after ? JSON.stringify(after) : null, requestId, 'api', previous?.hash || null, hash)
}

async function employeeForActor(db, actor) {
  return db.prepare('SELECT * FROM workforce_employees WHERE lower(login_email)=lower(?) LIMIT 1').bind(actor.email).first()
}

async function readJson(request) {
  const body = await request.json().catch(() => null)
  return body && typeof body === 'object' && !Array.isArray(body) ? body : null
}

export async function handleTimekeeping(request, env) {
  const requestId = requestIdFor(request)
  const url = new URL(request.url)
  const path = url.pathname.replace(/^\/workforce/, '')
  if (path === '/health' || path === '/api/ponto/health') return json(200, { ok: true, service: 'workforce-timekeeping', version: env.APP_VERSION || '1.0.0', database: !!env.DB }, requestId)
  if (path === '/readiness' || path === '/api/ponto/readiness') {
    try {
      if (!env.DB) throw new Error('DB_NOT_CONFIGURED')
      await env.DB.prepare('SELECT 1 AS ok').first()
      return json(200, { ok: true, service: 'workforce-timekeeping', ready: true, database: 'available' }, requestId)
    } catch { return json(503, { ok: false, error: 'NOT_READY', code: 'DATABASE_UNAVAILABLE' }, requestId) }
  }
  if (!path.startsWith('/api/ponto')) return json(404, { ok: false, error: 'NOT_FOUND' }, requestId)
  if (!env.DB) return json(503, { ok: false, error: 'NOT_READY', code: 'DATABASE_UNAVAILABLE' }, requestId)
  const actor = await actorFor(request, env)
  if (!actor) return json(401, { ok: false, error: 'UNAUTHORIZED' }, requestId)
  const db = env.DB

  if (path === '/api/ponto/me' && request.method === 'GET') {
    const employee = await employeeForActor(db, actor)
    return json(200, { ok: true, data: { linked: !!employee, employee: employee ? { id: employee.id, name: employee.display_name, status: employee.status } : null, capabilities: ['self.read', 'self.punch'].filter((cap) => roleAllows(actor.role, cap)) } }, requestId)
  }
  if (path === '/api/ponto/me/records' && request.method === 'GET') {
    const employee = await employeeForActor(db, actor)
    if (!employee) return json(404, { ok: false, error: 'EMPLOYEE_NOT_LINKED' }, requestId)
    const rows = await db.prepare('SELECT id, event_type, source, occurred_at_utc, unit_id, device_id, created_at FROM timekeeping_events WHERE employee_id=? AND superseded_by IS NULL ORDER BY occurred_at_utc DESC LIMIT 200').bind(employee.id).all()
    return json(200, { ok: true, data: rows.results || [] }, requestId)
  }
  if (path === '/api/ponto/me/events' && request.method === 'POST') {
    if (!roleAllows(actor.role, 'self.punch')) return json(403, { ok: false, error: 'FORBIDDEN' }, requestId)
    const employee = await employeeForActor(db, actor)
    const body = await readJson(request)
    const eventType = canonicalEventType(body?.eventType)
    const unitId = String(body?.unitId || '').trim()
    const key = String(request.headers.get('idempotency-key') || '').trim()
    if (!employee || !eventType || !unitId || !key || key.length > 160 || !requireUnit(actor, unitId)) return json(400, { ok: false, error: 'INVALID_PUNCH_REQUEST' }, requestId)
    const at = now(); const id = crypto.randomUUID(); const fingerprint = await hmac(String(env.PONTO_IDEMPOTENCY_KEY || env.PONTO_ACTOR_HMAC_KEY), `${eventType}.${unitId}`)
    try {
      const insert = db.prepare('INSERT INTO timekeeping_events (id, employee_id, unit_id, device_id, event_type, source, occurred_at_utc, idempotency_scope, idempotency_key, request_fingerprint, created_by, created_at) VALUES (?, ?, ?, NULL, ?, ?, ?, ?, ?, ?, ?, ?)')
        .bind(id, employee.id, unitId, eventType, 'SYSTEM', at, `employee:${employee.id}`, key, fingerprint, actor.id, at)
      await db.batch([insert, await audit(db, { actor, action: 'EVENT_CREATE', entityType: 'timekeeping_event', entityId: id, unitId, requestId, after: { eventType, source: 'SYSTEM' } })])
      return json(201, { ok: true, data: { id, eventType, occurredAtUtc: at, unitId, operationId: id } }, requestId)
    } catch (error) {
      const existing = await db.prepare('SELECT id, event_type, occurred_at_utc, request_fingerprint FROM timekeeping_events WHERE idempotency_scope=? AND idempotency_key=?').bind(`employee:${employee.id}`, key).first()
      if (existing && equal(existing.request_fingerprint, fingerprint)) return json(200, { ok: true, idempotent: true, data: { id: existing.id, eventType: existing.event_type, occurredAtUtc: existing.occurred_at_utc } }, requestId)
      return json(409, { ok: false, error: 'IDEMPOTENCY_CONFLICT' }, requestId)
    }
  }
  if (path === '/api/ponto/admin/employees' && request.method === 'GET') {
    if (!roleAllows(actor.role, 'unit.read')) return json(403, { ok: false, error: 'FORBIDDEN' }, requestId)
    const rows = await db.prepare('SELECT id, canonical_employee_id, display_name, status, terminated_at FROM workforce_employees ORDER BY display_name LIMIT 500').all()
    return json(200, { ok: true, data: rows.results || [] }, requestId)
  }
  if (path === '/api/ponto/admin/export' && request.method === 'GET') {
    if (!roleAllows(actor.role, 'export.read')) return json(403, { ok: false, error: 'FORBIDDEN' }, requestId)
    const rows = await db.prepare('SELECT employee_id, unit_id, event_type, source, occurred_at_utc FROM timekeeping_events ORDER BY occurred_at_utc DESC LIMIT 5000').all()
    const csv = ['employeeId,unitId,eventType,source,occurredAtUtc', ...(rows.results || []).map((r) => [r.employee_id, r.unit_id, r.event_type, r.source, r.occurred_at_utc].map((v) => JSON.stringify(v ?? '')).join(','))].join('\n')
    return new Response(csv, { headers: { 'content-type': 'text/csv; charset=utf-8', 'content-disposition': 'attachment; filename="ponto.csv"', 'x-request-id': requestId } })
  }
  return json(404, { ok: false, error: 'NOT_FOUND' }, requestId)
}

export default { fetch: handleTimekeeping }
export const __testables = { roleAllows, requireUnit, canonicalEventType, calculateDay, calculatePeriod }
