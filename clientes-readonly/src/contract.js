export const CLIENTES_READONLY_CONTRACT_VERSION = 'clientes-readonly/v1'

export const CLIENTES_READONLY_ACTOR_FIELDS = Object.freeze([
  'subject',
  'role',
  'unitIds',
])

export const CLIENTES_READONLY_ACTOR_ROLES = Object.freeze([
  'GESTOR',
])

export const CLIENTES_READONLY_RECORD_FIELDS = Object.freeze([
  'clientId',
  'displayName',
  'unitId',
  'status',
  'updatedAt',
])

export const CLIENTES_READONLY_STATUS_VALUES = Object.freeze([
  'active',
  'inactive',
  'archived',
])

export const CLIENTES_READONLY_QUERY_FIELDS = Object.freeze([
  'unitId',
  'cursor',
  'limit',
])

export const CLIENTES_READONLY_ROUTES = Object.freeze([
  Object.freeze({ id: 'health', path: '/health', methods: Object.freeze(['GET', 'HEAD']), actorRequired: false }),
  Object.freeze({ id: 'readiness', path: '/readiness', methods: Object.freeze(['GET', 'HEAD']), actorRequired: false }),
  Object.freeze({ id: 'list', path: '/v1/clientes', methods: Object.freeze(['GET', 'HEAD']), actorRequired: true }),
  Object.freeze({ id: 'detail', path: '/v1/clientes/:clientId', methods: Object.freeze(['GET', 'HEAD']), actorRequired: true }),
])

const ACTOR_TEXT_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/
const UNIT_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/
const CLIENT_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/
const CURSOR_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._~-]{0,255}$/
const UPDATED_AT_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/

function text(value, maxLength = 256) {
  const normalized = String(value || '').trim()
  return normalized && normalized.length <= maxLength ? normalized : ''
}

function optionalQueryText(searchParams, key, maxLength) {
  const value = searchParams.get(key)
  if (value === null) return { present: false, value: '' }
  const textValue = String(value)
  return {
    present: true,
    value: textValue,
    validLength: textValue.length > 0 && textValue.length <= maxLength && textValue === textValue.trim(),
  }
}

function validUpdatedAt(value) {
  if (!UPDATED_AT_PATTERN.test(value)) return false
  const parsed = new Date(value)
  if (!Number.isFinite(parsed.getTime())) return false
  const canonical = value.includes('.') ? value : value.replace(/Z$/, '.000Z')
  return parsed.toISOString() === canonical
}

function unique(values) {
  return [...new Set(values)]
}

export function clientesReadonlyRouteFor(pathname) {
  const path = String(pathname || '')
  if (path === '/health') return { route: CLIENTES_READONLY_ROUTES[0] }
  if (path === '/readiness') return { route: CLIENTES_READONLY_ROUTES[1] }
  if (path === '/v1/clientes') return { route: CLIENTES_READONLY_ROUTES[2] }
  const detail = path.match(/^\/v1\/clientes\/([A-Za-z0-9][A-Za-z0-9._-]{0,127})$/)
  return detail ? { route: CLIENTES_READONLY_ROUTES[3], clientId: detail[1] } : null
}

export function normalizeClientesReadonlyActor(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return { ok: false, code: 'CLIENTES_ACTOR_REQUIRED' }
  }
  const subject = text(input.subject, 128)
  if (!ACTOR_TEXT_PATTERN.test(subject)) return { ok: false, code: 'CLIENTES_ACTOR_INVALID' }
  const role = text(input.role, 32).toUpperCase()
  if (!CLIENTES_READONLY_ACTOR_ROLES.includes(role)) {
    return { ok: false, code: 'CLIENTES_ACTOR_FORBIDDEN' }
  }
  const unitIds = unique((Array.isArray(input.unitIds) ? input.unitIds : [])
    .map((unitId) => text(unitId, 64))
    .filter((unitId) => UNIT_ID_PATTERN.test(unitId)))
  if (!unitIds.length) return { ok: false, code: 'CLIENTES_UNIT_SCOPE_REQUIRED' }
  return {
    ok: true,
    actor: Object.freeze({
      subject,
      role,
      unitIds: Object.freeze(unitIds),
    }),
  }
}

export function actorCanReadClientesUnit(actor, unitId) {
  const normalizedUnitId = text(unitId, 64)
  return Boolean(normalizedUnitId && Array.isArray(actor?.unitIds) && actor.unitIds.includes(normalizedUnitId))
}

export function normalizeClientesReadonlyCursor(value) {
  if (typeof value !== 'string' || value.length === 0 || value.length > 256) return null
  return CURSOR_PATTERN.test(value) ? value : null
}

export function parseClientesReadonlyListQuery(searchParams) {
  const seen = new Set()
  for (const key of searchParams.keys()) {
    if (!CLIENTES_READONLY_QUERY_FIELDS.includes(key)) {
      return { ok: false, code: 'CLIENTES_QUERY_NOT_ALLOWED' }
    }
    if (seen.has(key)) return { ok: false, code: 'CLIENTES_QUERY_AMBIGUOUS' }
    seen.add(key)
  }
  const unitId = text(searchParams.get('unitId'), 64)
  if (!UNIT_ID_PATTERN.test(unitId)) return { ok: false, code: 'CLIENTES_UNIT_REQUIRED' }
  const cursorInput = optionalQueryText(searchParams, 'cursor', 256)
  if (cursorInput.present && !cursorInput.validLength) return { ok: false, code: 'CLIENTES_CURSOR_INVALID' }
  const rawCursor = cursorInput.value
  const cursor = normalizeClientesReadonlyCursor(rawCursor)
  if (rawCursor && !cursor) return { ok: false, code: 'CLIENTES_CURSOR_INVALID' }
  const limitInput = optionalQueryText(searchParams, 'limit', 3)
  if (limitInput.present && !limitInput.validLength) return { ok: false, code: 'CLIENTES_LIMIT_INVALID' }
  const rawLimit = limitInput.value
  const limit = rawLimit ? Number(rawLimit) : 25
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
    return { ok: false, code: 'CLIENTES_LIMIT_INVALID' }
  }
  return { ok: true, query: Object.freeze({ unitId, cursor: cursor || null, limit }) }
}

export function projectClientesReadonlyRecord(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return null
  const clientId = text(input.clientId, 128)
  const unitId = text(input.unitId, 64)
  if (!CLIENT_ID_PATTERN.test(clientId) || !UNIT_ID_PATTERN.test(unitId)) return null
  const status = text(input.status, 64)
  const updatedAt = text(input.updatedAt, 64)
  return Object.freeze({
    clientId,
    displayName: text(input.displayName, 160) || null,
    unitId,
    status: CLIENTES_READONLY_STATUS_VALUES.includes(status) ? status : null,
    updatedAt: validUpdatedAt(updatedAt) ? updatedAt : null,
  })
}
