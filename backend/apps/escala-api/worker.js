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

function toIsoDate(value) {
  return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, '0')}-${String(value.getDate()).padStart(2, '0')}`
}

function getWeekdayFromIsoDate(value) {
  const [year, month, day] = String(value || '').split('-').map(Number)
  if (!year || !month || !day) return -1
  return new Date(year, month - 1, day).getDay()
}

function buildPreviousMonthKeys(monthValue, count = 3) {
  const [year, month] = String(monthValue || '').split('-').map(Number)
  if (!year || !month || count <= 0) return []
  const keys = []
  for (let index = 1; index <= count; index += 1) {
    const date = new Date(year, month - 1 - index, 1)
    keys.push(`${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`)
  }
  return keys
}

function buildMonthDates(monthValue) {
  const [year, month] = String(monthValue || '').split('-').map(Number)
  if (!year || !month) return []
  const daysInMonth = new Date(year, month, 0).getDate()
  return Array.from({ length: daysInMonth }, (_, index) => {
    const day = index + 1
    return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
  })
}

function normalizeUnitKey(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '')
    .trim()
}

async function getTableColumns(env, tableName) {
  if (!globalThis.__escalaSchemaCache) {
    globalThis.__escalaSchemaCache = new WeakMap()
  }
  const dbCache = globalThis.__escalaSchemaCache
  let tableCache = dbCache.get(env.DB)
  if (!tableCache) {
    tableCache = new Map()
    dbCache.set(env.DB, tableCache)
  }
  if (!tableCache.has(tableName)) {
    tableCache.set(
      tableName,
      env.DB.prepare(`pragma table_info(${tableName})`).all()
        .then((res) => new Set((res.results || []).map((row) => String(row.name || '').trim()).filter(Boolean)))
        .catch(() => new Set())
    )
  }
  return tableCache.get(tableName)
}

async function tableHasColumn(env, tableName, columnName) {
  const columns = await getTableColumns(env, tableName)
  return columns.has(String(columnName || '').trim())
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
  const hasColorColumn = await tableHasColumn(env, 'professionals', 'color')
  const res = await env.DB.prepare(
    `select name, status, role, shift, nickname, phone, email, instagram, ${hasColorColumn ? 'color' : 'null as color'}, units_json
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

function deriveWeekdaySuggestionStats(entries) {
  const byWeekday = new Map()
  for (const entry of entries) {
    const professional = normalizeName(entry?.professional)
    const weekday = getWeekdayFromIsoDate(entry?.date)
    if (!professional || weekday < 0) continue
    const countByProfessional = byWeekday.get(weekday) || new Map()
    countByProfessional.set(professional, (countByProfessional.get(professional) || 0) + 1)
    byWeekday.set(weekday, countByProfessional)
  }
  const stats = new Map()
  byWeekday.forEach((countByProfessional, weekday) => {
    const ranked = Array.from(countByProfessional.entries()).sort((left, right) => {
      if (right[1] !== left[1]) return right[1] - left[1]
      return left[0].localeCompare(right[0])
    })
    const winner = ranked[0]
    if (!winner) return
    const total = ranked.reduce((sum, [, count]) => sum + count, 0)
    stats.set(weekday, {
      professional: winner[0],
      count: winner[1],
      total,
      confidence: total ? Number((winner[1] / total).toFixed(4)) : 0,
    })
  })
  return stats
}

async function handlePrefill(env, unit, month, actor) {
  const normalizedUnit = normalizeName(unit)
  const normalizedMonth = normalizeName(month)
  if (!normalizedUnit || !normalizedMonth || !isValidMonth(normalizedMonth)) {
    return { ok: false, status: 400, body: { ok: false, error: 'INVALID_INPUT' } }
  }
  const unitAllowed = ensureUnitAllowed(actor, normalizedUnit)
  if (!unitAllowed.ok) return unitAllowed

  const previousMonths = buildPreviousMonthKeys(normalizedMonth, 3)
  const [currentMonthData, ...historyResponses] = await Promise.all([
    handleSchedule(env, normalizedUnit, normalizedMonth, actor),
    ...previousMonths.map((monthKey) => handleSchedule(env, normalizedUnit, monthKey, actor)),
  ])
  const historicalEntries = historyResponses.flatMap((response) => response.schedule || [])
  const stats = deriveWeekdaySuggestionStats(historicalEntries)
  const scheduledDates = new Set((currentMonthData.schedule || []).map((entry) => entry.date))
  const blockedDates = new Set((currentMonthData.closedDays || []).map((entry) => entry.date))
  const todayIso = toIsoDate(new Date())
  const suggestions = buildMonthDates(normalizedMonth)
    .filter((date) => date >= todayIso && !scheduledDates.has(date) && !blockedDates.has(date))
    .map((date) => {
      const stat = stats.get(getWeekdayFromIsoDate(date))
      if (!stat) return null
      return {
        date,
        professional: stat.professional,
        confidence: stat.confidence,
        sampleSize: stat.total,
      }
    })
    .filter(Boolean)

  return {
    ok: true,
    status: 200,
    body: {
      ok: true,
      suggestions,
      windowMonths: previousMonths,
    },
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

async function runStatements(env, statements) {
  if (!statements.length) return
  if (typeof env.DB.batch === 'function') {
    await env.DB.batch(statements)
    return
  }
  for (const statement of statements) {
    await statement.run()
  }
}

async function handleProfessionalPut(env, actor, body) {
  const hasColorColumn = await tableHasColumn(env, 'professionals', 'color')
  const currentName = normalizeName(body?.currentName)
  const nextName = normalizeName(body?.name)
  const status = normalizeName(body?.status)
  const role = normalizeName(body?.role)
  const shift = normalizeName(body?.shift)
  const nickname = normalizeName(body?.nickname)
  const phone = normalizeName(body?.phone)
  const email = normalizeName(body?.email)
  const instagram = normalizeName(body?.instagram)
  const color = normalizeName(body?.color)
  const unitsInput = Array.isArray(body?.units) ? body.units : []
  const units = Array.from(new Set(unitsInput.map(normalizeName).filter(Boolean)))

  if (!currentName || !nextName) {
    return { ok: false, status: 400, body: { ok: false, error: 'INVALID_INPUT' } }
  }
  for (const unit of units) {
    const unitAllowed = ensureUnitAllowed(actor, unit)
    if (!unitAllowed.ok) return unitAllowed
  }

  const existing = await env.DB.prepare(
    `select name from professionals where name = ?1`
  ).bind(currentName).first()
  if (!existing) {
    return { ok: false, status: 404, body: { ok: false, error: 'PROFESSIONAL_NOT_FOUND' } }
  }

  if (currentName !== nextName) {
    const conflicting = await env.DB.prepare(
      `select name from professionals where name = ?1`
    ).bind(nextName).first()
    if (conflicting) {
      return { ok: false, status: 409, body: { ok: false, error: 'PROFESSIONAL_ALREADY_EXISTS' } }
    }
  }

  const now = new Date().toISOString()
  if (hasColorColumn) {
    await env.DB.prepare(
      `update professionals
       set name = ?1,
           status = ?2,
           role = ?3,
           shift = ?4,
           nickname = ?5,
           phone = ?6,
           email = ?7,
           instagram = ?8,
           color = ?9,
           units_json = ?10,
           updated_at = ?11
       where name = ?12`
    ).bind(
      nextName,
      status || null,
      role || null,
      shift || null,
      nickname || null,
      phone || null,
      email || null,
      instagram || null,
      color || null,
      JSON.stringify(units),
      now,
      currentName,
    ).run()
  } else {
    await env.DB.prepare(
      `update professionals
       set name = ?1,
           status = ?2,
           role = ?3,
           shift = ?4,
           nickname = ?5,
           phone = ?6,
           email = ?7,
           instagram = ?8,
           units_json = ?9,
           updated_at = ?10
       where name = ?11`
    ).bind(
      nextName,
      status || null,
      role || null,
      shift || null,
      nickname || null,
      phone || null,
      email || null,
      instagram || null,
      JSON.stringify(units),
      now,
      currentName,
    ).run()
  }

  if (currentName !== nextName) {
    await env.DB.prepare(
      `update schedule_entries
       set professional_name = ?1,
           updated_at = ?2,
           updated_by = ?3
       where professional_name = ?4`
    ).bind(nextName, now, actor.id, currentName).run()
  }

  return { ok: true, status: 200, body: { ok: true } }
}

async function handleProfessionalPost(env, actor, body) {
  const hasColorColumn = await tableHasColumn(env, 'professionals', 'color')
  const name = normalizeName(body?.name)
  const status = normalizeName(body?.status)
  const role = normalizeName(body?.role)
  const shift = normalizeName(body?.shift)
  const nickname = normalizeName(body?.nickname)
  const phone = normalizeName(body?.phone)
  const email = normalizeName(body?.email)
  const instagram = normalizeName(body?.instagram)
  const color = normalizeName(body?.color)
  const unitsInput = Array.isArray(body?.units) ? body.units : []
  const units = Array.from(new Set(unitsInput.map(normalizeName).filter(Boolean)))

  if (!name) {
    return { ok: false, status: 400, body: { ok: false, error: 'INVALID_INPUT' } }
  }
  for (const unit of units) {
    const unitAllowed = ensureUnitAllowed(actor, unit)
    if (!unitAllowed.ok) return unitAllowed
  }

  const conflicting = await env.DB.prepare(
    `select name from professionals where name = ?1`
  ).bind(name).first()
  if (conflicting) {
    return { ok: false, status: 409, body: { ok: false, error: 'PROFESSIONAL_ALREADY_EXISTS' } }
  }

  const now = new Date().toISOString()
  if (hasColorColumn) {
    await env.DB.prepare(
      `insert into professionals
       (id, name, status, role, shift, nickname, phone, email, instagram, color, units_json, created_at, updated_at)
       values (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13)`
    ).bind(
      crypto.randomUUID(),
      name,
      status || null,
      role || null,
      shift || null,
      nickname || null,
      phone || null,
      email || null,
      instagram || null,
      color || null,
      JSON.stringify(units),
      now,
      now,
    ).run()
  } else {
    await env.DB.prepare(
      `insert into professionals
       (id, name, status, role, shift, nickname, phone, email, instagram, units_json, created_at, updated_at)
       values (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12)`
    ).bind(
      crypto.randomUUID(),
      name,
      status || null,
      role || null,
      shift || null,
      nickname || null,
      phone || null,
      email || null,
      instagram || null,
      JSON.stringify(units),
      now,
      now,
    ).run()
  }

  return { ok: true, status: 200, body: { ok: true } }
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
  const rawEntries = Array.isArray(body?.entries)
    ? body.entries
    : [{ date: body?.date, professionals: Array.isArray(body?.professionals) ? body.professionals : [] }]
  const entries = rawEntries
    .map((entry) => ({
      date: normalizeName(entry?.date),
      professionals: Array.from(new Set((Array.isArray(entry?.professionals) ? entry.professionals : []).map(normalizeName).filter(Boolean))),
    }))
    .filter((entry) => entry.date)
  if (!unit || !entries.length || entries.some((entry) => !isValidDate(entry.date) || !entry.professionals.length)) {
    return { ok: false, status: 400, body: { ok: false, error: 'INVALID_INPUT' } }
  }
  const unitAllowed = ensureUnitAllowed(actor, unit)
  if (!unitAllowed.ok) return unitAllowed
  const uniqueNames = Array.from(new Set(entries.flatMap((entry) => entry.professionals)))
  const known = await listKnownProfessionals(env, uniqueNames)
  if (known.length !== uniqueNames.length) {
    return { ok: false, status: 400, body: { ok: false, error: 'UNKNOWN_PROFESSIONAL' } }
  }
  const now = new Date().toISOString()
  const statements = []
  let updatedEntries = 0
  for (const entry of entries) {
    statements.push(
      env.DB.prepare(`delete from schedule_entries where date = ?1 and unit = ?2`).bind(entry.date, unit),
    )
    for (const name of entry.professionals) {
      updatedEntries += 1
      statements.push(
        env.DB.prepare(
          `insert into schedule_entries
           (id, date, unit, professional_name, created_at, updated_at, created_by, updated_by)
           values (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)`
        ).bind(crypto.randomUUID(), entry.date, unit, name, now, now, actor.id, actor.id),
      )
    }
  }
  await runStatements(env, statements)
  return { ok: true, status: 200, body: { ok: true, updatedDates: entries.length, updatedEntries } }
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

function safeJsonParse(value, fallback) {
  try {
    return JSON.parse(String(value || ''))
  } catch {
    return fallback
  }
}

function mergeUnitLists(currentUnits, importedUnits) {
  const byKey = new Map()
  ;[...(Array.isArray(currentUnits) ? currentUnits : []), ...(Array.isArray(importedUnits) ? importedUnits : [])]
    .map(normalizeName)
    .filter(Boolean)
    .forEach((unit) => {
      const key = normalizeUnitKey(unit)
      if (!byKey.has(key)) byKey.set(key, unit)
    })
  return Array.from(byKey.values())
}

function normalizeImportedProfessional(row) {
  const name = normalizeName(row?.name)
  const units = Array.isArray(row?.units)
    ? row.units.map(normalizeName).filter(Boolean)
    : normalizeName(row?.unit)
      ? [normalizeName(row.unit)]
      : []
  if (!name) return null
  return {
    name,
    status: normalizeName(row?.status) || 'Ativo',
    units,
    role: normalizeName(row?.role),
    shift: normalizeName(row?.shift),
    nickname: normalizeName(row?.nickname),
    phone: normalizeName(row?.phone),
    email: normalizeName(row?.email),
    instagram: normalizeName(row?.instagram),
    color: normalizeName(row?.color),
  }
}

function normalizeImportedSchedule(row) {
  const date = normalizeName(row?.date)
  const unit = normalizeName(row?.unit)
  const professional = normalizeName(row?.professional || row?.doctor || row?.name)
  if (!date || !isValidDate(date) || !unit || !professional) return null
  return { date, unit, professional }
}

function normalizeImportedClosedDay(row) {
  const date = normalizeName(row?.date)
  const unit = normalizeName(row?.unit)
  if (!date || !isValidDate(date) || !unit) return null
  return { date, unit, reason: normalizeName(row?.reason) || 'Sem Atendimento' }
}

function normalizeImportedHoliday(row) {
  const date = normalizeName(row?.date)
  const unit = normalizeName(row?.unit)
  const name = normalizeName(row?.name || row?.reason)
  if (!date || !isValidDate(date) || !unit || !name) return null
  return { date, unit, name }
}

function buildCoverageSummary(scheduleRows, closedRows, holidayRows) {
  const coverage = new Map()
  const touch = (unit, date, field) => {
    const key = `${unit}__${String(date || '').slice(0, 7)}`
    if (!String(date || '').slice(0, 7)) return
    const row = coverage.get(key) || { unit, month: String(date).slice(0, 7), scheduleEntries: 0, closedDays: 0, holidays: 0 }
    row[field] += 1
    coverage.set(key, row)
  }
  scheduleRows.forEach((row) => touch(row.unit, row.date, 'scheduleEntries'))
  closedRows.forEach((row) => touch(row.unit, row.date, 'closedDays'))
  holidayRows.forEach((row) => touch(row.unit, row.date, 'holidays'))
  return Array.from(coverage.values()).sort((a, b) => `${a.month}:${a.unit}`.localeCompare(`${b.month}:${b.unit}`))
}

async function handleAtendimentoClinicaImport(env, actor, body) {
  const input = body?.feed && typeof body.feed === 'object' ? body.feed : body || {}
  const commit = Boolean(body?.commit)
  const force = Boolean(body?.force)
  const rawProfessionals = Array.isArray(input.professionals) ? input.professionals : []
  const rawSchedule = Array.isArray(input.schedule) ? input.schedule : []
  const rawClosedDays = Array.isArray(input.closedDays) ? input.closedDays : []
  const rawHolidays = Array.isArray(input.holidays) ? input.holidays : []

  const skipped = { professionals: 0, schedule: 0, closedDays: 0, holidays: 0 }
  const professionals = rawProfessionals
    .map(normalizeImportedProfessional)
    .filter((row) => {
      if (!row) {
        skipped.professionals += 1
        return false
      }
      const visibleUnits = row.units.filter((unit) => isUnitVisibleForActor(actor, unit))
      if (!visibleUnits.length && row.units.length) {
        skipped.professionals += 1
        return false
      }
      row.units = visibleUnits
      return true
    })
  const schedule = rawSchedule
    .map(normalizeImportedSchedule)
    .filter((row) => {
      if (!row || !isUnitVisibleForActor(actor, row.unit)) {
        skipped.schedule += 1
        return false
      }
      return true
    })
  const closedDays = rawClosedDays
    .map(normalizeImportedClosedDay)
    .filter((row) => {
      if (!row || !isUnitVisibleForActor(actor, row.unit)) {
        skipped.closedDays += 1
        return false
      }
      return true
    })
  const holidays = rawHolidays
    .map(normalizeImportedHoliday)
    .filter((row) => {
      if (!row || !isUnitVisibleForActor(actor, row.unit)) {
        skipped.holidays += 1
        return false
      }
      return true
    })

  const hasColorColumn = await tableHasColumn(env, 'professionals', 'color')
  const existingProfessionalsRes = await env.DB.prepare(
    hasColorColumn
      ? `select name, status, role, shift, nickname, phone, email, instagram, color, units_json from professionals`
      : `select name, status, role, shift, nickname, phone, email, instagram, null as color, units_json from professionals`
  ).all()
  const existingScheduleRes = await env.DB.prepare(
    `select date, unit, professional_name as professional from schedule_entries`
  ).all()
  const existingClosedRes = await env.DB.prepare(`select date, unit, reason from closed_days`).all()
  const existingHolidaysRes = await env.DB.prepare(`select date, unit, name from holidays`).all()

  const existingProfessionals = new Map((existingProfessionalsRes.results || []).map((row) => [normalizeName(row.name), row]))
  const existingSchedule = new Set((existingScheduleRes.results || []).map((row) => `${row.date}__${normalizeUnitKey(row.unit)}__${normalizeName(row.professional)}`))
  const existingScheduleByDay = new Set((existingScheduleRes.results || []).map((row) => `${row.date}__${normalizeUnitKey(row.unit)}`))
  const existingClosed = new Map((existingClosedRes.results || []).map((row) => [`${row.date}__${normalizeUnitKey(row.unit)}`, row]))
  const existingHolidays = new Set((existingHolidaysRes.results || []).map((row) => `${row.date}__${normalizeUnitKey(row.unit)}__${normalizeName(row.name)}`))

  const summary = {
    professionals: { source: professionals.length, existing: 0, toInsert: 0, toUpdate: 0, unchanged: 0, skipped: skipped.professionals },
    schedule: { source: schedule.length, existing: 0, toInsert: 0, conflicts: 0, skipped: skipped.schedule },
    closedDays: { source: closedDays.length, existing: 0, toInsert: 0, conflicts: 0, skipped: skipped.closedDays },
    holidays: { source: holidays.length, existing: 0, toInsert: 0, skipped: skipped.holidays },
    coverage: buildCoverageSummary(schedule, closedDays, holidays),
  }
  const statements = []
  const now = new Date().toISOString()

  for (const prof of professionals) {
    const existing = existingProfessionals.get(prof.name)
    if (!existing) {
      summary.professionals.toInsert += 1
      if (commit) {
        const baseValues = [
          crypto.randomUUID(),
          prof.name,
          prof.status || 'Ativo',
          prof.role || null,
          prof.shift || null,
          prof.nickname || null,
          prof.phone || null,
          prof.email || null,
          prof.instagram || null,
        ]
        statements.push(
          hasColorColumn
            ? env.DB.prepare(
              `insert into professionals
               (id, name, status, role, shift, nickname, phone, email, instagram, color, units_json, created_at, updated_at)
               values (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13)`
            ).bind(...baseValues, prof.color || null, JSON.stringify(prof.units || []), now, now)
            : env.DB.prepare(
              `insert into professionals
               (id, name, status, role, shift, nickname, phone, email, instagram, units_json, created_at, updated_at)
               values (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12)`
            ).bind(...baseValues, JSON.stringify(prof.units || []), now, now)
        )
      }
      continue
    }
    summary.professionals.existing += 1
    const existingUnits = safeJsonParse(existing.units_json, [])
    const mergedUnits = mergeUnitLists(existingUnits, prof.units)
    const needsUpdate = force
      || JSON.stringify(mergedUnits) !== JSON.stringify(existingUnits)
      || (!normalizeName(existing.role) && prof.role)
      || (!normalizeName(existing.shift) && prof.shift)
      || (!normalizeName(existing.nickname) && prof.nickname)
      || (!normalizeName(existing.phone) && prof.phone)
      || (!normalizeName(existing.email) && prof.email)
      || (!normalizeName(existing.instagram) && prof.instagram)
      || (hasColorColumn && !normalizeName(existing.color) && prof.color)
    if (!needsUpdate) {
      summary.professionals.unchanged += 1
      continue
    }
    summary.professionals.toUpdate += 1
    if (commit) {
      const next = {
        status: force ? prof.status || existing.status || 'Ativo' : existing.status || prof.status || 'Ativo',
        role: force ? prof.role || existing.role || null : existing.role || prof.role || null,
        shift: force ? prof.shift || existing.shift || null : existing.shift || prof.shift || null,
        nickname: force ? prof.nickname || existing.nickname || null : existing.nickname || prof.nickname || null,
        phone: force ? prof.phone || existing.phone || null : existing.phone || prof.phone || null,
        email: force ? prof.email || existing.email || null : existing.email || prof.email || null,
        instagram: force ? prof.instagram || existing.instagram || null : existing.instagram || prof.instagram || null,
        color: force ? prof.color || existing.color || null : existing.color || prof.color || null,
      }
      statements.push(
        hasColorColumn
          ? env.DB.prepare(
            `update professionals
             set name = ?1, status = ?2, role = ?3, shift = ?4, nickname = ?5, phone = ?6,
                 email = ?7, instagram = ?8, color = ?9, units_json = ?10, updated_at = ?11
             where name = ?12`
          ).bind(prof.name, next.status, next.role, next.shift, next.nickname, next.phone, next.email, next.instagram, next.color, JSON.stringify(mergedUnits), now, prof.name)
          : env.DB.prepare(
            `update professionals
             set name = ?1, status = ?2, role = ?3, shift = ?4, nickname = ?5, phone = ?6,
                 email = ?7, instagram = ?8, units_json = ?9, updated_at = ?10
             where name = ?11`
          ).bind(prof.name, next.status, next.role, next.shift, next.nickname, next.phone, next.email, next.instagram, JSON.stringify(mergedUnits), now, prof.name)
      )
    }
  }

  for (const row of schedule) {
    const key = `${row.date}__${normalizeUnitKey(row.unit)}__${row.professional}`
    if (existingSchedule.has(key)) {
      summary.schedule.existing += 1
      continue
    }
    const closed = existingClosed.get(`${row.date}__${normalizeUnitKey(row.unit)}`)
    if (closed && normalizeUnitKey(closed.reason) !== normalizeUnitKey('Sem Atendimento')) {
      summary.schedule.conflicts += 1
      continue
    }
    summary.schedule.toInsert += 1
    if (commit) {
      if (closed) statements.push(env.DB.prepare(`delete from closed_days where date = ?1 and unit = ?2`).bind(row.date, row.unit))
      statements.push(
        env.DB.prepare(
          `insert or ignore into schedule_entries
           (id, date, unit, professional_name, created_at, updated_at, created_by, updated_by)
           values (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)`
        ).bind(crypto.randomUUID(), row.date, row.unit, row.professional, now, now, actor.id, actor.id),
      )
    }
  }

  for (const row of closedDays) {
    const key = `${row.date}__${normalizeUnitKey(row.unit)}`
    if (existingClosed.has(key)) {
      summary.closedDays.existing += 1
      continue
    }
    if (existingScheduleByDay.has(key)) {
      summary.closedDays.conflicts += 1
      continue
    }
    summary.closedDays.toInsert += 1
    if (commit) {
      statements.push(
        env.DB.prepare(
          `insert or replace into closed_days
           (id, date, unit, reason, created_at, updated_at, created_by, updated_by)
           values (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)`
        ).bind(crypto.randomUUID(), row.date, row.unit, row.reason, now, now, actor.id, actor.id),
      )
    }
  }

  for (const row of holidays) {
    const key = `${row.date}__${normalizeUnitKey(row.unit)}__${row.name}`
    if (existingHolidays.has(key)) {
      summary.holidays.existing += 1
      continue
    }
    summary.holidays.toInsert += 1
    if (commit) {
      statements.push(
        env.DB.prepare(
          `insert or replace into holidays
           (id, date, unit, name, created_at, updated_at, created_by, updated_by)
           values (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)`
        ).bind(crypto.randomUUID(), row.date, row.unit, row.name, now, now, actor.id, actor.id),
      )
    }
  }

  if (commit && statements.length) await runStatements(env, statements)
  return { ok: true, status: 200, body: { ok: true, dryRun: !commit, committed: commit, summary } }
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
        if (request.method === 'POST') {
          const body = await readJson(request)
          if (!body) {
            return jsonResponse({ ok: false, error: 'INVALID_JSON' }, { status: 400, headers: { ...corsHeaders, 'x-request-id': requestId } })
          }
          const result = await handleProfessionalPost(env, actor, body)
          console.log(JSON.stringify({ event: 'escala.professionals.create', requestId, actor: actor.id, status: result.status }))
          return jsonResponse(result.body, { status: result.status, headers: { ...corsHeaders, 'x-request-id': requestId } })
        }
        if (request.method === 'PUT') {
          const body = await readJson(request)
          if (!body) {
            return jsonResponse({ ok: false, error: 'INVALID_JSON' }, { status: 400, headers: { ...corsHeaders, 'x-request-id': requestId } })
          }
          const result = await handleProfessionalPut(env, actor, body)
          console.log(JSON.stringify({ event: 'escala.professionals.update', requestId, actor: actor.id, status: result.status }))
          return jsonResponse(result.body, { status: result.status, headers: { ...corsHeaders, 'x-request-id': requestId } })
        }
        if (request.method !== 'GET') {
          return jsonResponse({ ok: false, error: 'METHOD_NOT_ALLOWED' }, { status: 405, headers: { ...corsHeaders, 'x-request-id': requestId } })
        }
        const unit = url.searchParams.get('unit') || ''
        const unitAllowed = ensureUnitAllowed(actor, unit)
        if (!unitAllowed.ok) {
          return jsonResponse(unitAllowed.body, { status: unitAllowed.status, headers: { ...corsHeaders, 'x-request-id': requestId } })
        }
        const data = await handleProfessionals(env, unit, actor)
        const hasColorColumn = await tableHasColumn(env, 'professionals', 'color')
        console.log(JSON.stringify({ event: 'escala.professionals', requestId, actor: actor.id, unit, total: data.data.length, hasColorColumn }))
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

      if (path === '/api/escala/prefill') {
        if (request.method !== 'GET') {
          return jsonResponse({ ok: false, error: 'METHOD_NOT_ALLOWED' }, { status: 405, headers: { ...corsHeaders, 'x-request-id': requestId } })
        }
        const unit = url.searchParams.get('unit') || ''
        const month = url.searchParams.get('month') || ''
        const startedAt = Date.now()
        console.log(JSON.stringify({ event: 'escala.prefill.analyze.started', requestId, actor: actor.id, unit, month }))
        const result = await handlePrefill(env, unit, month, actor)
        if (!result.ok) {
          return jsonResponse(result.body, { status: result.status, headers: { ...corsHeaders, 'x-request-id': requestId } })
        }
        console.log(JSON.stringify({
          event: 'escala.prefill.analyze.completed',
          requestId,
          actor: actor.id,
          unit,
          month,
          candidateDates: result.body.suggestions.length,
          durationMs: Date.now() - startedAt,
        }))
        return jsonResponse(result.body, { status: result.status, headers: { ...corsHeaders, 'x-request-id': requestId } })
      }

      if (path === '/api/escala/admin/import/atendimento-clinica') {
        if (request.method !== 'POST') {
          return jsonResponse({ ok: false, error: 'METHOD_NOT_ALLOWED' }, { status: 405, headers: { ...corsHeaders, 'x-request-id': requestId } })
        }
        const body = await readJson(request)
        if (!body) {
          return jsonResponse({ ok: false, error: 'INVALID_JSON' }, { status: 400, headers: { ...corsHeaders, 'x-request-id': requestId } })
        }
        const result = await handleAtendimentoClinicaImport(env, actor, body)
        console.log(JSON.stringify({
          event: 'escala.import.atendimento_clinica',
          requestId,
          actor: actor.id,
          committed: result.body.committed,
          scheduleToInsert: result.body.summary?.schedule?.toInsert || 0,
          closedToInsert: result.body.summary?.closedDays?.toInsert || 0,
        }))
        return jsonResponse(result.body, { status: result.status, headers: { ...corsHeaders, 'x-request-id': requestId } })
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
