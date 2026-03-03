function jsonResponse(body, init = {}) {
  return new Response(JSON.stringify(body), {
    ...init,
    headers: {
      'content-type': 'application/json',
      ...(init.headers || {})
    }
  })
}

function buildCorsHeaders(request, env) {
  const origin = request.headers.get('origin') || ''
  const allowed = env.APP_ORIGIN ? String(env.APP_ORIGIN) : '*'
  const allowOrigin = allowed === '*' ? '*' : (origin && origin === allowed ? origin : allowed)
  const headers = {
    'Access-Control-Allow-Origin': allowOrigin,
    'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type,Authorization'
  }
  if (allowOrigin !== '*') {
    headers['Access-Control-Allow-Credentials'] = 'true'
  }
  return headers
}

async function handleOverview(env) {
  const unitsQuery = `
    select distinct unit from schedule_entries
    union
    select distinct unit from closed_days
    union
    select distinct unit from holidays
    order by unit;
  `
  const monthsQuery = `
    select distinct substr(date, 1, 7) as month
    from schedule_entries
    order by month;
  `
  const units = await env.DB.prepare(unitsQuery).all()
  const months = await env.DB.prepare(monthsQuery).all()
  return { units: (units.results || []).map((r) => r.unit), months: (months.results || []).map((r) => r.month) }
}

async function handleProfessionals(env, unit) {
  if (unit) {
    const stmt = env.DB.prepare(
      `select name, status, role, shift, nickname, phone, email, instagram, units_json
       from professionals
       where json_array_length(units_json) = 0
          or exists (select 1 from json_each(units_json) where value = ?)
       order by name`
    ).bind(unit)
    const res = await stmt.all()
    const data = (res.results || []).map((row) => ({
      ...row,
      units: JSON.parse(row.units_json || '[]')
    }))
    return { data }
  }
  const res = await env.DB.prepare(
    `select name, status, role, shift, nickname, phone, email, instagram, units_json
     from professionals
     order by name`
  ).all()
  const data = (res.results || []).map((row) => ({
    ...row,
    units: JSON.parse(row.units_json || '[]')
  }))
  return { data }
}

function buildScheduleWhere(params) {
  const clauses = []
  const values = []
  if (params.unit) {
    values.push(params.unit)
    clauses.push(`unit = ?${values.length}`)
  }
  if (params.month) {
    values.push(`${params.month}-`)
    clauses.push(`date like ?${values.length} || '%'`)
  }
  const where = clauses.length ? `where ${clauses.join(' and ')}` : ''
  return { where, values }
}

async function handleSchedule(env, unit, month) {
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
    schedule: scheduleRes.results || [],
    closedDays: closedRes.results || [],
    holidays: holidaysRes.results || []
  }
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url)
    const path = url.pathname
    const corsHeaders = buildCorsHeaders(request, env)

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders })
    }

    if (path === '/health' || path === '/api/escala/health') {
      return jsonResponse({ ok: true }, { headers: corsHeaders })
    }

    if (!path.startsWith('/api/escala')) {
      return jsonResponse({ ok: false, error: 'Not found' }, { status: 404, headers: corsHeaders })
    }

    try {
      if (path === '/api/escala/overview') {
        const data = await handleOverview(env)
        return jsonResponse({ ok: true, ...data }, { headers: corsHeaders })
      }

      if (path === '/api/escala/professionals') {
        const unit = url.searchParams.get('unit') || ''
        const data = await handleProfessionals(env, unit)
        return jsonResponse({ ok: true, ...data }, { headers: corsHeaders })
      }

      if (path === '/api/escala/schedule') {
        const unit = url.searchParams.get('unit') || ''
        const month = url.searchParams.get('month') || ''
        const data = await handleSchedule(env, unit || null, month || null)
        return jsonResponse({ ok: true, ...data }, { headers: corsHeaders })
      }

      return jsonResponse({ ok: false, error: 'Not found' }, { status: 404, headers: corsHeaders })
    } catch (err) {
      return jsonResponse({ ok: false, error: err?.message || 'Internal error' }, { status: 500, headers: corsHeaders })
    }
  }
}
