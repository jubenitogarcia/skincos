const ACTOR_SKEW_MS = 5 * 60 * 1000

function jsonResponse(body, init = {}) {
  return new Response(JSON.stringify(body), {
    ...init,
    headers: {
      'content-type': 'application/json',
      ...(init.headers || {})
    }
  })
}

function newRequestId() {
  try {
    return crypto.randomUUID()
  } catch {
    return `${Date.now()}_${Math.random().toString(16).slice(2)}`
  }
}

function buildCorsHeaders(request, env) {
  const origin = request.headers.get('origin') || ''
  const allowed = env.APP_ORIGIN ? String(env.APP_ORIGIN) : '*'
  const allowOrigin = allowed === '*' ? '*' : (origin && origin === allowed ? origin : allowed)
  const headers = {
    'Access-Control-Allow-Origin': allowOrigin,
    'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type,Authorization,x-crm-user,x-crm-ts,x-crm-signature,x-request-id'
  }
  if (allowOrigin !== '*') {
    headers['Access-Control-Allow-Credentials'] = 'true'
  }
  return headers
}

function normalizeRole(value) {
  const raw = String(value || '').trim().toUpperCase()
  if (!raw) return ''
  if (raw === 'ADMIN') return 'GESTOR'
  if (raw === 'OPERADOR') return 'INJETOR'
  return raw
}

function base64UrlDecode(input) {
  const padded = input.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((input.length + 3) % 4)
  const bin = atob(padded)
  const bytes = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i += 1) bytes[i] = bin.charCodeAt(i)
  return bytes
}

function base64UrlEncode(bytes) {
  const bin = String.fromCharCode(...new Uint8Array(bytes))
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '')
}

async function signHmacSha256(secret, message) {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  )
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(message))
  return base64UrlEncode(sig)
}

async function requireActor(request, env) {
  const payload = request.headers.get('x-crm-user') || ''
  const tsRaw = request.headers.get('x-crm-ts') || ''
  const sig = request.headers.get('x-crm-signature') || ''
  if (!payload || !tsRaw || !sig) {
    return { ok: false, status: 401, body: { ok: false, error: 'UNAUTHORIZED' } }
  }
  const secret = String(env.ESCALA_ACTOR_HMAC_KEY || '').trim()
  if (!secret) {
    return { ok: false, status: 503, body: { ok: false, error: 'ACTOR_KEY_MISSING' } }
  }
  const ts = Number(tsRaw)
  if (!Number.isFinite(ts)) {
    return { ok: false, status: 400, body: { ok: false, error: 'ACTOR_TS_INVALID' } }
  }
  if (Math.abs(Date.now() - ts) > ACTOR_SKEW_MS) {
    return { ok: false, status: 401, body: { ok: false, error: 'ACTOR_TS_SKEW' } }
  }
  const expected = await signHmacSha256(secret, `${tsRaw}.${payload}`)
  if (expected !== sig) {
    return { ok: false, status: 401, body: { ok: false, error: 'ACTOR_SIGNATURE_INVALID' } }
  }
  let actor = null
  try {
    const decoded = base64UrlDecode(payload)
    actor = JSON.parse(new TextDecoder().decode(decoded))
  } catch {
    actor = null
  }
  if (!actor || typeof actor !== 'object') {
    return { ok: false, status: 400, body: { ok: false, error: 'ACTOR_INVALID' } }
  }
  const role = normalizeRole(actor.role)
  if (!(role === 'GESTOR' || role === 'GERENTE')) {
    return { ok: false, status: 403, body: { ok: false, error: 'FORBIDDEN' } }
  }
  const allowedUnits = Array.isArray(actor.allowedUnits) ? actor.allowedUnits.map(String).filter(Boolean) : []
  const allowedUnitKeys = Array.from(new Set(allowedUnits.map((unit) => normalizeUnitKey(unit)).filter(Boolean)))
  return {
    ok: true,
    actor: {
      id: String(actor.id || actor.email || actor.username || ''),
      email: actor.email ? String(actor.email) : undefined,
      name: actor.name ? String(actor.name) : undefined,
      role,
      allowedUnits,
      allowedUnitKeys
    }
  }
}

function ensureUnitAllowed(actor, unit) {
  if (!unit) return { ok: true }
  if (!actor.allowedUnitKeys.length) return { ok: true }
  return isUnitVisibleForActor(actor, unit)
    ? { ok: true }
    : { ok: false, status: 403, body: { ok: false, error: 'FORBIDDEN_UNIT' } }
}

function isValidDate(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(value || ''))
}

function isValidMonth(value) {
  return /^\d{4}-\d{2}$/.test(String(value || ''))
}

function normalizeName(value) {
  return String(value || '').trim()
}

function normalizeUnitKey(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '')
    .trim()
}

function isUnitVisibleForActor(actor, unit) {
  const key = normalizeUnitKey(unit)
  if (!key) return true
  if (!Array.isArray(actor.allowedUnitKeys) || !actor.allowedUnitKeys.length) return true
  return actor.allowedUnitKeys.includes(key)
}

async function handleOverview(env, actor) {
  const unitsQuery = `
    select distinct unit from schedule_entries
    union
    select distinct unit from closed_days
    union
    select distinct unit from holidays
    order by unit;
  `
  const units = await env.DB.prepare(unitsQuery).all()

  const monthsQuery = `
    select distinct unit, substr(date, 1, 7) as month
    from schedule_entries
    order by month, unit;
  `
  const months = await env.DB.prepare(monthsQuery).all()

  const visibleUnits = (units.results || [])
    .map((r) => String(r.unit || ''))
    .filter(Boolean)
    .filter((unit) => isUnitVisibleForActor(actor, unit))

  const visibleMonths = new Set(
    (months.results || [])
      .filter((r) => isUnitVisibleForActor(actor, r.unit))
      .map((r) => String(r.month || ''))
      .filter(Boolean)
  )

  return { units: visibleUnits, months: Array.from(visibleMonths).sort() }
}

async function handleProfessionals(env, unit, actor) {
  const res = await env.DB.prepare(
    `select name, status, role, shift, nickname, phone, email, instagram, units_json
     from professionals
     order by name`
  ).all()
  const requestedUnitKey = normalizeUnitKey(unit)
  const allowed = new Set(actor.allowedUnitKeys || [])
  const data = (res.results || [])
    .map((row) => {
      let units = []
      try {
        units = JSON.parse(row.units_json || '[]')
      } catch {
        units = []
      }
      const unitKeys = Array.isArray(units) ? units.map((u) => normalizeUnitKey(u)).filter(Boolean) : []
      return {
        ...row,
        units: Array.isArray(units) ? units : [],
        unitKeys
      }
    })
    .filter((row) => {
      if (requestedUnitKey && row.unitKeys.length && !row.unitKeys.includes(requestedUnitKey)) return false
      if (!allowed.size) return true
      if (!row.unitKeys.length) return true
      return row.unitKeys.some((key) => allowed.has(key))
    })
    .map(({ unitKeys, ...row }) => row)
  return { data }
}

function buildScheduleWhere(params) {
  const clauses = []
  const values = []
  if (params.unit) {
    clauses.push('unit = ?')
    values.push(params.unit)
  }
  if (params.month) {
    clauses.push('date like ?')
    values.push(`${params.month}-%`)
  }
  const where = clauses.length ? `where ${clauses.join(' and ')}` : ''
  return { where, values }
}

async function handleSchedule(env, unit, month, actor) {
  const { where, values } = buildScheduleWhere({ unit, month })
  const scheduleRes = await env.DB.prepare(
    `select date, unit, professional_name as professional
     from schedule_entries
     ${where}
     order by date asc, professional_name asc`
  ).bind(...values).all()

  const closedRes = await env.DB.prepare(
    `select date, unit, reason
     from closed_days
     ${where}
     order by date asc`
  ).bind(...values).all()

  const holidaysRes = await env.DB.prepare(
    `select date, unit, name
     from holidays
     ${where}
     order by date asc, name asc`
  ).bind(...values).all()

  return {
    schedule: (scheduleRes.results || []).filter((row) => isUnitVisibleForActor(actor, row.unit)),
    closedDays: (closedRes.results || []).filter((row) => isUnitVisibleForActor(actor, row.unit)),
    holidays: (holidaysRes.results || []).filter((row) => isUnitVisibleForActor(actor, row.unit))
  }
}

async function readJson(request) {
  if (request.method === 'GET' || request.method === 'HEAD') return null
  const text = await request.text()
  if (!text) return null
  try {
    return JSON.parse(text)
  } catch {
    return null
  }
}

async function listKnownProfessionals(env, names) {
  const unique = Array.from(new Set(names))
  if (!unique.length) return []
  const placeholders = unique.map(() => '?').join(',')
  const res = await env.DB.prepare(
    `select name from professionals where name in (${placeholders})`
  ).bind(...unique).all()
  return (res.results || []).map((r) => r.name)
}

async function handleSchedulePost(env, actor, body) {
  const unit = normalizeName(body?.unit)
  const date = normalizeName(body?.date)
  const professionals = Array.isArray(body?.professionals) ? body.professionals : []
  const single = normalizeName(body?.professional)
  if (single) professionals.push(single)
  const names = Array.from(new Set(professionals.map(normalizeName).filter(Boolean)))
  if (!unit || !date || !isValidDate(date) || !names.length) {
    return { ok: false, status: 400, body: { ok: false, error: 'INVALID_INPUT' } }
  }
  const unitAllowed = ensureUnitAllowed(actor, unit)
  if (!unitAllowed.ok) return unitAllowed
  const known = await listKnownProfessionals(env, names)
  if (known.length !== names.length) {
    return { ok: false, status: 400, body: { ok: false, error: 'UNKNOWN_PROFESSIONAL' } }
  }
  const now = new Date().toISOString()
  const stmt = env.DB.prepare(
    `insert or ignore into schedule_entries
     (id, date, unit, professional_name, created_at, updated_at, created_by, updated_by)
     values (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)`
  )
  for (const name of names) {
    await stmt.bind(crypto.randomUUID(), date, unit, name, now, now, actor.id, actor.id).run()
  }
  return { ok: true, status: 200, body: { ok: true } }
}

async function handleSchedulePut(env, actor, body) {
  const unit = normalizeName(body?.unit)
  const date = normalizeName(body?.date)
  const professionals = Array.isArray(body?.professionals) ? body.professionals : []
  const names = Array.from(new Set(professionals.map(normalizeName).filter(Boolean)))
  if (!unit || !date || !isValidDate(date) || !names.length) {
    return { ok: false, status: 400, body: { ok: false, error: 'INVALID_INPUT' } }
  }
  const unitAllowed = ensureUnitAllowed(actor, unit)
  if (!unitAllowed.ok) return unitAllowed
  const known = await listKnownProfessionals(env, names)
  if (known.length !== names.length) {
    return { ok: false, status: 400, body: { ok: false, error: 'UNKNOWN_PROFESSIONAL' } }
  }
  await env.DB.prepare(
    `delete from schedule_entries where date = ?1 and unit = ?2`
  ).bind(date, unit).run()
  const now = new Date().toISOString()
  const stmt = env.DB.prepare(
    `insert into schedule_entries
     (id, date, unit, professional_name, created_at, updated_at, created_by, updated_by)
     values (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)`
  )
  for (const name of names) {
    await stmt.bind(crypto.randomUUID(), date, unit, name, now, now, actor.id, actor.id).run()
  }
  return { ok: true, status: 200, body: { ok: true } }
}

async function handleScheduleDelete(env, actor, body) {
  const unit = normalizeName(body?.unit)
  const date = normalizeName(body?.date)
  const professional = normalizeName(body?.professional)
  if (!unit || !date || !isValidDate(date)) {
    return { ok: false, status: 400, body: { ok: false, error: 'INVALID_INPUT' } }
  }
  const unitAllowed = ensureUnitAllowed(actor, unit)
  if (!unitAllowed.ok) return unitAllowed
  if (professional) {
    await env.DB.prepare(
      `delete from schedule_entries where date = ?1 and unit = ?2 and professional_name = ?3`
    ).bind(date, unit, professional).run()
  } else {
    await env.DB.prepare(
      `delete from schedule_entries where date = ?1 and unit = ?2`
    ).bind(date, unit).run()
  }
  return { ok: true, status: 200, body: { ok: true } }
}

async function handleClosedDayPost(env, actor, body) {
  const unit = normalizeName(body?.unit)
  const date = normalizeName(body?.date)
  const reason = normalizeName(body?.reason)
  if (!unit || !date || !isValidDate(date)) {
    return { ok: false, status: 400, body: { ok: false, error: 'INVALID_INPUT' } }
  }
  const unitAllowed = ensureUnitAllowed(actor, unit)
  if (!unitAllowed.ok) return unitAllowed
  const now = new Date().toISOString()
  await env.DB.prepare(
    `insert or replace into closed_days
     (id, date, unit, reason, created_at, updated_at, created_by, updated_by)
     values (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)`
  ).bind(crypto.randomUUID(), date, unit, reason || null, now, now, actor.id, actor.id).run()
  return { ok: true, status: 200, body: { ok: true } }
}

async function handleClosedDayDelete(env, actor, body) {
  const unit = normalizeName(body?.unit)
  const date = normalizeName(body?.date)
  if (!unit || !date || !isValidDate(date)) {
    return { ok: false, status: 400, body: { ok: false, error: 'INVALID_INPUT' } }
  }
  const unitAllowed = ensureUnitAllowed(actor, unit)
  if (!unitAllowed.ok) return unitAllowed
  await env.DB.prepare(`delete from closed_days where date = ?1 and unit = ?2`).bind(date, unit).run()
  return { ok: true, status: 200, body: { ok: true } }
}

async function handleHolidayPost(env, actor, body) {
  const unit = normalizeName(body?.unit)
  const date = normalizeName(body?.date)
  const name = normalizeName(body?.name)
  if (!unit || !date || !isValidDate(date) || !name) {
    return { ok: false, status: 400, body: { ok: false, error: 'INVALID_INPUT' } }
  }
  const unitAllowed = ensureUnitAllowed(actor, unit)
  if (!unitAllowed.ok) return unitAllowed
  const now = new Date().toISOString()
  await env.DB.prepare(
    `insert or replace into holidays
     (id, date, unit, name, created_at, updated_at, created_by, updated_by)
     values (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)`
  ).bind(crypto.randomUUID(), date, unit, name, now, now, actor.id, actor.id).run()
  return { ok: true, status: 200, body: { ok: true } }
}

async function handleHolidayDelete(env, actor, body) {
  const unit = normalizeName(body?.unit)
  const date = normalizeName(body?.date)
  const name = normalizeName(body?.name)
  if (!unit || !date || !isValidDate(date) || !name) {
    return { ok: false, status: 400, body: { ok: false, error: 'INVALID_INPUT' } }
  }
  const unitAllowed = ensureUnitAllowed(actor, unit)
  if (!unitAllowed.ok) return unitAllowed
  await env.DB.prepare(
    `delete from holidays where date = ?1 and unit = ?2 and name = ?3`
  ).bind(date, unit, name).run()
  return { ok: true, status: 200, body: { ok: true } }
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url)
    const path = url.pathname
    const requestId = request.headers.get('x-request-id') || newRequestId()
    const corsHeaders = buildCorsHeaders(request, env)

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders })
    }

    if (path === '/health' || path === '/api/escala/health') {
      return jsonResponse({ ok: true }, { headers: { ...corsHeaders, 'x-request-id': requestId } })
    }

    if (!path.startsWith('/api/escala')) {
      return jsonResponse({ ok: false, error: 'Not found' }, { status: 404, headers: { ...corsHeaders, 'x-request-id': requestId } })
    }

    const auth = await requireActor(request, env)
    if (!auth.ok) {
      return jsonResponse(auth.body, { status: auth.status, headers: { ...corsHeaders, 'x-request-id': requestId } })
    }

    const actor = auth.actor

    try {
      if (path === '/api/escala/overview') {
        const data = await handleOverview(env, actor)
        console.log(JSON.stringify({ event: 'escala.overview', requestId, actor: actor.id }))
        return jsonResponse({ ok: true, ...data }, { headers: { ...corsHeaders, 'x-request-id': requestId } })
      }

      if (path === '/api/escala/professionals') {
        const unit = url.searchParams.get('unit') || ''
        const unitAllowed = ensureUnitAllowed(actor, unit)
        if (!unitAllowed.ok) {
          return jsonResponse(unitAllowed.body, { status: unitAllowed.status, headers: { ...corsHeaders, 'x-request-id': requestId } })
        }
        const data = await handleProfessionals(env, unit, actor)
        console.log(JSON.stringify({ event: 'escala.professionals', requestId, actor: actor.id, unit }))
        return jsonResponse({ ok: true, ...data }, { headers: { ...corsHeaders, 'x-request-id': requestId } })
      }

      if (path === '/api/escala/schedule') {
        if (request.method === 'GET') {
          const unit = url.searchParams.get('unit') || ''
          const month = url.searchParams.get('month') || ''
          if (month && !isValidMonth(month)) {
            return jsonResponse({ ok: false, error: 'INVALID_MONTH' }, { status: 400, headers: { ...corsHeaders, 'x-request-id': requestId } })
          }
          const unitAllowed = ensureUnitAllowed(actor, unit)
          if (!unitAllowed.ok) {
            return jsonResponse(unitAllowed.body, { status: unitAllowed.status, headers: { ...corsHeaders, 'x-request-id': requestId } })
          }
          const data = await handleSchedule(env, unit || null, month || null, actor)
          console.log(JSON.stringify({ event: 'escala.schedule.read', requestId, actor: actor.id, unit, month }))
          return jsonResponse({ ok: true, ...data }, { headers: { ...corsHeaders, 'x-request-id': requestId } })
        }

        const body = await readJson(request)
        if (!body) {
          return jsonResponse({ ok: false, error: 'INVALID_JSON' }, { status: 400, headers: { ...corsHeaders, 'x-request-id': requestId } })
        }

        if (request.method === 'POST') {
          const result = await handleSchedulePost(env, actor, body)
          console.log(JSON.stringify({ event: 'escala.schedule.add', requestId, actor: actor.id, status: result.status }))
          return jsonResponse(result.body, { status: result.status, headers: { ...corsHeaders, 'x-request-id': requestId } })
        }
        if (request.method === 'PUT') {
          const result = await handleSchedulePut(env, actor, body)
          console.log(JSON.stringify({ event: 'escala.schedule.replace', requestId, actor: actor.id, status: result.status }))
          return jsonResponse(result.body, { status: result.status, headers: { ...corsHeaders, 'x-request-id': requestId } })
        }
        if (request.method === 'DELETE') {
          const result = await handleScheduleDelete(env, actor, body)
          console.log(JSON.stringify({ event: 'escala.schedule.delete', requestId, actor: actor.id, status: result.status }))
          return jsonResponse(result.body, { status: result.status, headers: { ...corsHeaders, 'x-request-id': requestId } })
        }
        return jsonResponse({ ok: false, error: 'METHOD_NOT_ALLOWED' }, { status: 405, headers: { ...corsHeaders, 'x-request-id': requestId } })
      }

      if (path === '/api/escala/closed-days') {
        const body = await readJson(request)
        if (!body) {
          return jsonResponse({ ok: false, error: 'INVALID_JSON' }, { status: 400, headers: { ...corsHeaders, 'x-request-id': requestId } })
        }
        if (request.method === 'POST') {
          const result = await handleClosedDayPost(env, actor, body)
          console.log(JSON.stringify({ event: 'escala.closed.add', requestId, actor: actor.id, status: result.status }))
          return jsonResponse(result.body, { status: result.status, headers: { ...corsHeaders, 'x-request-id': requestId } })
        }
        if (request.method === 'DELETE') {
          const result = await handleClosedDayDelete(env, actor, body)
          console.log(JSON.stringify({ event: 'escala.closed.delete', requestId, actor: actor.id, status: result.status }))
          return jsonResponse(result.body, { status: result.status, headers: { ...corsHeaders, 'x-request-id': requestId } })
        }
        return jsonResponse({ ok: false, error: 'METHOD_NOT_ALLOWED' }, { status: 405, headers: { ...corsHeaders, 'x-request-id': requestId } })
      }

      if (path === '/api/escala/holidays') {
        const body = await readJson(request)
        if (!body) {
          return jsonResponse({ ok: false, error: 'INVALID_JSON' }, { status: 400, headers: { ...corsHeaders, 'x-request-id': requestId } })
        }
        if (request.method === 'POST') {
          const result = await handleHolidayPost(env, actor, body)
          console.log(JSON.stringify({ event: 'escala.holiday.add', requestId, actor: actor.id, status: result.status }))
          return jsonResponse(result.body, { status: result.status, headers: { ...corsHeaders, 'x-request-id': requestId } })
        }
        if (request.method === 'DELETE') {
          const result = await handleHolidayDelete(env, actor, body)
          console.log(JSON.stringify({ event: 'escala.holiday.delete', requestId, actor: actor.id, status: result.status }))
          return jsonResponse(result.body, { status: result.status, headers: { ...corsHeaders, 'x-request-id': requestId } })
        }
        return jsonResponse({ ok: false, error: 'METHOD_NOT_ALLOWED' }, { status: 405, headers: { ...corsHeaders, 'x-request-id': requestId } })
      }

      return jsonResponse({ ok: false, error: 'Not found' }, { status: 404, headers: { ...corsHeaders, 'x-request-id': requestId } })
    } catch (err) {
      console.log(JSON.stringify({ event: 'escala.error', requestId, error: err?.message || String(err) }))
      return jsonResponse({ ok: false, error: err?.message || 'Internal error' }, { status: 500, headers: { ...corsHeaders, 'x-request-id': requestId } })
    }
  }
}
