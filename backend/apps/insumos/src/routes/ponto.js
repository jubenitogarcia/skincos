// @ts-nocheck

function clampInt(value, min, max, fallback) {
  const n = Number.parseInt(String(value ?? ''), 10)
  if (!Number.isFinite(n)) return fallback
  return Math.max(min, Math.min(max, n))
}

function clampFloat(value, min, max, fallback) {
  const n = Number.parseFloat(String(value ?? ''))
  if (!Number.isFinite(n)) return fallback
  return Math.max(min, Math.min(max, n))
}

function safeText(value, maxLen) {
  const s = String(value ?? '').trim()
  if (!s) return ''
  return s.length > maxLen ? s.slice(0, maxLen) : s
}

function normalizeEmail(value) {
  const raw = String(value ?? '').trim().toLowerCase()
  if (!raw) return ''
  if (raw.length > 180) return ''
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(raw)) return ''
  return raw
}

function getClientIp(request) {
  const xf = String(request.headers.get('x-forwarded-for') || '').trim()
  if (xf) return xf.split(',')[0].trim()
  const cf = String(request.headers.get('cf-connecting-ip') || '').trim()
  return cf || null
}

function safeJsonParse(raw) {
  if (!raw) return null
  try {
    return JSON.parse(raw)
  } catch {
    return null
  }
}

function stableStringify(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`
  const keys = Object.keys(value).sort()
  return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify(value[k])}`).join(',')}}`
}

function toCsvCell(value) {
  const s = String(value ?? '')
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`
  return s
}

function isNumberArray(arr, minLen, maxLen) {
  if (!Array.isArray(arr)) return false
  if (arr.length < minLen || arr.length > maxLen) return false
  for (const v of arr) {
    if (typeof v !== 'number' || !Number.isFinite(v)) return false
  }
  return true
}

function l2(a, b) {
  let sum = 0
  for (let i = 0; i < a.length; i++) {
    const d = a[i] - b[i]
    sum += d * d
  }
  return Math.sqrt(sum)
}

function b64UrlToBytes(b64url) {
  const s = String(b64url || '').trim()
  if (!s) return new Uint8Array()
  const padded = s.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(s.length / 4) * 4, '=')
  const bin = atob(padded)
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}

function b64UrlToUtf8(b64url) {
  const bytes = b64UrlToBytes(b64url)
  if (!bytes.length) return ''
  return new TextDecoder().decode(bytes)
}

function bytesToHex(bytes) {
  const hex = []
  for (const b of bytes) hex.push(b.toString(16).padStart(2, '0'))
  return hex.join('')
}

function bytesToB64Url(bytes) {
  let bin = ''
  for (const b of bytes) bin += String.fromCharCode(b)
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '')
}

async function sha256HexUtf8(input) {
  const bytes = new TextEncoder().encode(String(input ?? ''))
  const digest = await crypto.subtle.digest('SHA-256', bytes)
  return bytesToHex(new Uint8Array(digest))
}

async function hmacSha256Hex(secret, message) {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(String(secret ?? '')),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(String(message ?? '')))
  return bytesToHex(new Uint8Array(sig))
}

async function hmacSha256B64Url(secret, message) {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(String(secret ?? '')),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(String(message ?? '')))
  return bytesToB64Url(new Uint8Array(sig))
}

function safeEqualStr(a, b) {
  const aa = String(a ?? '')
  const bb = String(b ?? '')
  if (aa.length !== bb.length) return false
  let out = 0
  for (let i = 0; i < aa.length; i++) out |= aa.charCodeAt(i) ^ bb.charCodeAt(i)
  return out === 0
}

async function pbkdf2Sha256(pin, saltBytes, iterations, outLen = 32) {
  const baseKey = await crypto.subtle.importKey('raw', new TextEncoder().encode(String(pin ?? '')), 'PBKDF2', false, ['deriveBits'])
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', hash: 'SHA-256', salt: saltBytes, iterations },
    baseKey,
    outLen * 8,
  )
  return new Uint8Array(bits)
}

async function hashPin(pin, opts = {}) {
  const p = String(pin ?? '')
  if (!p) return null
  const iterations = clampInt(opts.iterations ?? 120_000, 20_000, 600_000, 120_000)
  const salt = opts.saltBytes instanceof Uint8Array && opts.saltBytes.length ? opts.saltBytes : crypto.getRandomValues(new Uint8Array(16))
  const dk = await pbkdf2Sha256(p, salt, iterations, 32)
  return {
    alg: 'pbkdf2-sha256',
    iters: iterations,
    saltB64: bytesToB64Url(salt),
    hashB64: bytesToB64Url(dk),
  }
}

async function verifyPin(pin, stored) {
  if (!stored || stored.alg !== 'pbkdf2-sha256') return false
  const salt = b64UrlToBytes(stored.saltB64)
  const expected = b64UrlToBytes(stored.hashB64)
  const iters = clampInt(stored.iters, 10_000, 800_000, null)
  if (!salt.length || !expected.length || !iters) return false
  const dk = await pbkdf2Sha256(pin, salt, iters, expected.length)
  if (dk.length !== expected.length) return false
  let out = 0
  for (let i = 0; i < dk.length; i++) out |= dk[i] ^ expected[i]
  return out === 0
}

function getIdempotencyKey(request, body) {
  const h = safeText(request.headers.get('x-idempotency-key'), 80)
  if (h) return h
  return safeText(body?.requestId, 80)
}

function getClientTimeMeta(body) {
  const clientTime = safeText(body?.clientTime, 40) || null
  const tzOffsetMinutesRaw = body?.tzOffsetMinutes
  const tzOffsetMinutes = tzOffsetMinutesRaw === null || tzOffsetMinutesRaw === undefined
    ? null
    : clampInt(tzOffsetMinutesRaw, -840, 840, null)
  const locale = safeText(body?.locale, 40) || null
  const appVersion = safeText(body?.appVersion, 40) || null
  return { clientTime, tzOffsetMinutes, locale, appVersion }
}

function actorFromRequest(request, { kind, id, label, unit } = {}) {
  return {
    kind: kind || 'unknown',
    id: id || null,
    label: label || null,
    unit: unit || null,
    ip: getClientIp(request),
    ua: safeText(request.headers.get('user-agent'), 220) || null,
  }
}

function publicEmployee(row) {
  return {
    id: String(row.id),
    code: row.code || '',
    name: row.name || '',
    loginEmail: row.login_email || '',
    active: row.active ? true : false,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    deletedAt: row.deleted_at || null,
    faceDescriptorsCount: Number(row.face_descriptors_count || 0) || 0,
    lastEnrolledAt: row.last_enrolled_at || null,
    pinSet: !!row.pin_hash,
  }
}

function publicDevice(row) {
  return {
    id: String(row.id),
    label: row.label || '',
    unit: row.unit || '',
    active: row.revoked_at ? false : true,
    createdAt: row.created_at,
    revokedAt: row.revoked_at || null,
    lastSeenAt: row.last_seen_at || null,
  }
}

async function withTxn(db, fn) {
  await db.prepare('BEGIN').run()
  try {
    const out = await fn()
    await db.prepare('COMMIT').run()
    return out
  } catch (e) {
    try { await db.prepare('ROLLBACK').run() } catch { /* ignore */ }
    throw e
  }
}

async function getAuditLastHash(db) {
  const row = await db.prepare(`SELECT value FROM ponto_meta WHERE key = ? LIMIT 1`).bind('audit_last_hash').first()
  return row?.value ? String(row.value) : null
}

async function setAuditLastHash(db, hash) {
  await db.prepare(
    `INSERT INTO ponto_meta (key, value) VALUES (?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`
  ).bind('audit_last_hash', String(hash || '')).run()
}

async function writeAudit(db, env, type, data, actor) {
  const now = new Date().toISOString()
  const id = crypto.randomUUID()
  const prevHash = await getAuditLastHash(db)
  const payload = { v: 1, id, type, at: now, actor, data, prevHash }
  const hashInput = (prevHash || '') + '\n' + stableStringify(payload)
  const hash = await sha256HexUtf8(hashInput)
  const auditKey = String(env?.PONTO_AUDIT_HMAC_KEY || '').trim()
  const hmac = auditKey ? await hmacSha256Hex(auditKey, hashInput) : null
  await db.prepare(
    `INSERT INTO ponto_audit (id, v, type, at, actor_json, data_json, prev_hash, hash, hmac, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  )
    .bind(id, 1, type, now, JSON.stringify(actor || {}), JSON.stringify(data || {}), prevHash, hash, hmac, now)
    .run()
  await setAuditLastHash(db, hash)
  return { ...payload, hash, hmac }
}

async function requireAdmin({ request, env, withCORS, appOrigin }) {
  const adminToken = String(env?.PONTO_ADMIN_TOKEN || '').trim()
  if (!adminToken) {
    return { ok: false, response: withCORS(JSON.stringify({ ok: false, error: 'ADMIN_TOKEN_NOT_CONFIGURED' }), { status: 503 }, appOrigin) }
  }
  const h = String(request.headers.get('authorization') || '').trim()
  const provided = h.toLowerCase().startsWith('admin ')
    ? h.slice(6).trim()
    : h.toLowerCase().startsWith('bearer ')
      ? h.slice(7).trim()
      : String(request.headers.get('x-ponto-admin-token') || '').trim()
  if (!provided || !safeEqualStr(provided, adminToken)) {
    return { ok: false, response: withCORS(JSON.stringify({ ok: false, error: 'ADMIN_UNAUTHORIZED' }), { status: 401 }, appOrigin) }
  }
  return { ok: true, actor: actorFromRequest(request, { kind: 'admin', id: 'token', label: 'admin-token' }) }
}

async function requireEmployee({ request, env, withCORS, appOrigin, actorSkewMs }) {
  const proxyToken = String(env?.PONTO_PROXY_TOKEN || '').trim()
  if (proxyToken) {
    const token = String(request.headers.get('x-ponto-proxy-token') || '').trim()
    if (!token || !safeEqualStr(token, proxyToken)) {
      return { ok: false, response: withCORS(JSON.stringify({ ok: false, error: 'UNAUTHORIZED', code: 'PROXY_TOKEN_INVALID' }), { status: 401 }, appOrigin) }
    }
  }

  const actorB64 = String(request.headers.get('x-skincos-actor') || '').trim()
  const tsRaw = String(request.headers.get('x-skincos-actor-ts') || '').trim()
  const sig = String(request.headers.get('x-skincos-actor-sig') || '').trim()
  if (!actorB64 || !tsRaw) {
    return { ok: false, response: withCORS(JSON.stringify({ ok: false, error: 'UNAUTHORIZED', code: 'ACTOR_MISSING' }), { status: 401 }, appOrigin) }
  }
  const ts = Number(tsRaw)
  if (!Number.isFinite(ts) || ts <= 0) {
    return { ok: false, response: withCORS(JSON.stringify({ ok: false, error: 'UNAUTHORIZED', code: 'ACTOR_TS_INVALID' }), { status: 401 }, appOrigin) }
  }
  if (Math.abs(Date.now() - ts) > actorSkewMs) {
    return { ok: false, response: withCORS(JSON.stringify({ ok: false, error: 'UNAUTHORIZED', code: 'ACTOR_TS_SKEW' }), { status: 401 }, appOrigin) }
  }

  const actorJson = b64UrlToUtf8(actorB64)
  const actor = safeJsonParse(actorJson)
  if (!actor || typeof actor !== 'object') {
    return { ok: false, response: withCORS(JSON.stringify({ ok: false, error: 'UNAUTHORIZED', code: 'ACTOR_INVALID' }), { status: 401 }, appOrigin) }
  }
  const email = normalizeEmail(actor.email)
  if (!email) {
    return { ok: false, response: withCORS(JSON.stringify({ ok: false, error: 'UNAUTHORIZED', code: 'ACTOR_EMAIL_MISSING' }), { status: 401 }, appOrigin) }
  }

  const actorHmacKey = String(env?.PONTO_ACTOR_HMAC_KEY || env?.PONTO_PROXY_TOKEN || '').trim()
  if (!actorHmacKey) {
    return { ok: false, response: withCORS(JSON.stringify({ ok: false, error: 'UNAUTHORIZED', code: 'ACTOR_KEY_MISSING' }), { status: 401 }, appOrigin) }
  }
  if (!sig) {
    return { ok: false, response: withCORS(JSON.stringify({ ok: false, error: 'UNAUTHORIZED', code: 'ACTOR_SIG_MISSING' }), { status: 401 }, appOrigin) }
  }
  const expected = await hmacSha256B64Url(actorHmacKey, `${tsRaw}.${actorB64}`)
  if (!safeEqualStr(sig, expected)) {
    return { ok: false, response: withCORS(JSON.stringify({ ok: false, error: 'UNAUTHORIZED', code: 'ACTOR_SIG_INVALID' }), { status: 401 }, appOrigin) }
  }

  return { ok: true, email, actor: actorFromRequest(request, { kind: 'employee', id: email, label: email }) }
}

async function findEmployeeByLoginEmail(db, email) {
  const needle = normalizeEmail(email)
  if (!needle) return null
  return await db.prepare(
    `SELECT
       e.*,
       (SELECT COUNT(*) FROM ponto_face_templates t WHERE t.employee_id = e.id) AS face_descriptors_count
     FROM ponto_employees e
     WHERE e.deleted_at IS NULL AND e.active = 1 AND lower(e.login_email) = lower(?)
     LIMIT 1`
  ).bind(needle).first()
}

async function findEmployeeById(db, id) {
  const employeeId = String(id || '').trim()
  if (!employeeId) return null
  return await db.prepare(
    `SELECT
       e.*,
       (SELECT COUNT(*) FROM ponto_face_templates t WHERE t.employee_id = e.id) AS face_descriptors_count
     FROM ponto_employees e
     WHERE e.id = ?
     LIMIT 1`
  ).bind(employeeId).first()
}

async function listEmployees(db) {
  const rows = await db.prepare(
    `SELECT
       e.*,
       (SELECT COUNT(*) FROM ponto_face_templates t WHERE t.employee_id = e.id) AS face_descriptors_count
     FROM ponto_employees e
     WHERE e.deleted_at IS NULL
     ORDER BY e.created_at DESC`
  ).all()
  return rows?.results || []
}

async function loadEmployeeTemplates(db, employeeId, maxDescriptors) {
  const rows = await db.prepare(
    `SELECT template_json FROM ponto_face_templates WHERE employee_id = ? ORDER BY created_at DESC LIMIT ?`
  ).bind(String(employeeId), Number(maxDescriptors)).all()
  const out = []
  for (const r of rows?.results || []) {
    const tpl = safeJsonParse(r?.template_json)
    if (isNumberArray(tpl, 64, 1024)) out.push(tpl)
  }
  return out
}

function computePunchType(requestedType, lastType) {
  const reqType = safeText(requestedType, 12).toUpperCase()
  let type = reqType === 'IN' || reqType === 'OUT' ? reqType : 'AUTO'
  if (type === 'AUTO') type = lastType === 'IN' ? 'OUT' : 'IN'
  return type
}

async function findLastEmployeePunch(db, employeeId) {
  return await db.prepare(
    `SELECT * FROM ponto_records WHERE kind = 'PUNCH' AND employee_id = ? ORDER BY at DESC LIMIT 1`
  ).bind(String(employeeId)).first()
}

async function enforceCooldown(db, employeeId, punchCooldownSeconds) {
  if (!punchCooldownSeconds) return { ok: true }
  const last = await findLastEmployeePunch(db, employeeId)
  if (!last) return { ok: true }
  const lastMs = new Date(last.at).getTime()
  if (!Number.isFinite(lastMs)) return { ok: true }
  const delta = Math.floor((Date.now() - lastMs) / 1000)
  if (delta >= punchCooldownSeconds) return { ok: true }
  return { ok: false, secondsRemaining: Math.max(1, punchCooldownSeconds - delta), last }
}

async function findExistingByIdempotency(db, { deviceId, employeeId, idempotencyKey }) {
  const key = String(idempotencyKey || '').trim()
  if (!key) return null
  if (deviceId) {
    return await db.prepare(
      `SELECT * FROM ponto_records WHERE idempotency_key = ? AND device_id = ? ORDER BY created_at DESC LIMIT 1`
    ).bind(key, String(deviceId)).first()
  }
  if (employeeId) {
    return await db.prepare(
      `SELECT * FROM ponto_records WHERE idempotency_key = ? AND employee_id = ? AND device_id IS NULL ORDER BY created_at DESC LIMIT 1`
    ).bind(key, String(employeeId)).first()
  }
  return null
}

async function findDeviceByToken(db, rawToken) {
  const token = String(rawToken || '').trim()
  if (!token) return null
  const hash = await sha256HexUtf8(token)
  return await db.prepare(
    `SELECT * FROM ponto_devices WHERE revoked_at IS NULL AND token_hash = ? LIMIT 1`
  ).bind(hash).first()
}

function getDeviceTokenFromRequest(request) {
  const h = String(request.headers.get('authorization') || '').trim()
  if (h.toLowerCase().startsWith('device ')) return h.slice(7).trim()
  if (h.toLowerCase().startsWith('bearer ')) return h.slice(7).trim()
  return String(request.headers.get('x-ponto-device-token') || '').trim()
}

async function requireDevice({ request, env, db, withCORS, appOrigin }) {
  const token = getDeviceTokenFromRequest(request)
  const device = await findDeviceByToken(db, token)
  if (!device) {
    return { ok: false, response: withCORS(JSON.stringify({ ok: false, error: 'DEVICE_UNAUTHORIZED' }), { status: 401 }, appOrigin) }
  }
  const now = new Date().toISOString()
  await db.prepare(`UPDATE ponto_devices SET last_seen_at = ? WHERE id = ?`).bind(now, String(device.id)).run()
  const actor = actorFromRequest(request, { kind: 'device', id: device.id, label: device.label, unit: device.unit })
  return { ok: true, device, actor }
}

export async function handlePontoRoutes({
  request,
  url,
  env,
  appOrigin,
  withCORS,
}) {
  let pathname = String(url?.pathname || '')
  if (pathname === '/api/ponto' || pathname.startsWith('/api/ponto/')) {
    pathname = '/ponto' + pathname.slice('/api/ponto'.length)
  }
  if (pathname === '/ponto') pathname = '/ponto/'
  if (!pathname.startsWith('/ponto/')) return null

  if (!env?.DB) {
    return withCORS(JSON.stringify({ ok: false, error: 'DB_NOT_CONFIGURED' }), { status: 500 }, appOrigin)
  }

  const db = env.DB
  const sub = pathname.slice('/ponto'.length) || '/'

  const maxDescriptors = clampInt(env?.PONTO_MAX_DESCRIPTORS, 1, 30, 10)
  const faceThresholdDefault = clampFloat(env?.PONTO_FACE_THRESHOLD, 0.2, 1.5, 0.52)
  const punchCooldownSeconds = clampInt(env?.PONTO_PUNCH_COOLDOWN_SECONDS, 0, 3600, 10)
  const actorSkewMs = clampInt(env?.PONTO_ACTOR_SKEW_MS, 5_000, 60 * 60 * 1000, 5 * 60 * 1000)

  const json = (status, body, extraHeaders = {}) => withCORS(
    JSON.stringify(body),
    {
      status,
      headers: {
        'content-type': 'application/json; charset=utf-8',
        'cache-control': 'no-store',
        ...extraHeaders,
      }
    },
    appOrigin
  )

  // -------------------------------------------------------------
  // Health (public)
  // -------------------------------------------------------------
  if ((sub === '/health' || sub === '/health/') && request.method === 'GET') {
    try {
      const row = await db.prepare(`SELECT COUNT(*) AS n FROM ponto_employees WHERE deleted_at IS NULL`).first()
      const devices = await db.prepare(`SELECT COUNT(*) AS n FROM ponto_devices WHERE revoked_at IS NULL`).first()
      const records = await db.prepare(`SELECT COUNT(*) AS n FROM ponto_records`).first()
      const audit = await db.prepare(`SELECT COUNT(*) AS n FROM ponto_audit`).first()
      return json(200, {
        ok: true,
        version: 2,
        storage: 'd1',
        cryptoAuditHmac: !!String(env?.PONTO_AUDIT_HMAC_KEY || '').trim(),
        employees: Number(row?.n || 0) || 0,
        devices: Number(devices?.n || 0) || 0,
        records: Number(records?.n || 0) || 0,
        auditEvents: Number(audit?.n || 0) || 0,
      })
    } catch (e) {
      return json(500, { ok: false, error: e?.message || String(e) })
    }
  }

  // -------------------------------------------------------------
  // Admin APIs
  // -------------------------------------------------------------
  if (sub === '/admin/employees' && request.method === 'GET') {
    const auth = await requireAdmin({ request, env, withCORS, appOrigin })
    if (!auth.ok) return auth.response
    const rows = await listEmployees(db)
    return json(200, { ok: true, data: rows.map(publicEmployee) })
  }

  if (sub === '/admin/employees' && request.method === 'POST') {
    const auth = await requireAdmin({ request, env, withCORS, appOrigin })
    if (!auth.ok) return auth.response
    const body = await request.json().catch(() => ({}))
    const name = safeText(body?.name, 80)
    const code = safeText(body?.code, 40)
    const loginEmail = normalizeEmail(body?.loginEmail)
    if (!name) return json(400, { ok: false, error: 'NAME_REQUIRED' })
    const now = new Date().toISOString()
    const id = crypto.randomUUID()
    await withTxn(db, async () => {
      await db.prepare(
        `INSERT INTO ponto_employees (
           id, code, name, login_email, active, created_at, updated_at, deleted_at, last_enrolled_at,
           pin_alg, pin_salt, pin_hash, pin_iters, consent_obtained_at, consent_version
         ) VALUES (?, ?, ?, ?, 1, ?, ?, NULL, NULL, NULL, NULL, NULL, NULL, ?, ?)`
      )
        .bind(id, code, name, loginEmail || '', now, now, safeText(body?.consentObtainedAt, 40) || now, safeText(body?.consentVersion, 40) || 'v1')
        .run()
      await writeAudit(db, env, 'EMPLOYEE_CREATE', { employeeId: id, name, code }, auth.actor)
    })
    const employee = await findEmployeeById(db, id)
    return json(200, { ok: true, data: publicEmployee(employee) })
  }

  if (sub.startsWith('/admin/employees/') && request.method === 'PATCH') {
    const auth = await requireAdmin({ request, env, withCORS, appOrigin })
    if (!auth.ok) return auth.response
    const employeeId = sub.split('/')[3] || ''
    const employee = await findEmployeeById(db, employeeId)
    if (!employee || employee.deleted_at) return json(404, { ok: false, error: 'NOT_FOUND' })
    const body = await request.json().catch(() => ({}))
    const activeRaw = body?.active
    const nameRaw = body?.name
    const codeRaw = body?.code
    const loginEmailRaw = body?.loginEmail

    await withTxn(db, async () => {
      if (nameRaw !== undefined) {
        const next = safeText(nameRaw, 80)
        if (next) employee.name = next
      }
      if (codeRaw !== undefined) employee.code = safeText(codeRaw, 40)
      if (typeof activeRaw === 'boolean') employee.active = activeRaw ? 1 : 0
      let linkEvent = null
      let prevEmail = null
      let nextEmail = null
      if (loginEmailRaw !== undefined) {
        prevEmail = normalizeEmail(employee.login_email)
        nextEmail = normalizeEmail(loginEmailRaw)
        employee.login_email = nextEmail || ''
        linkEvent = nextEmail ? 'EMPLOYEE_LINK_LOGIN' : 'EMPLOYEE_UNLINK_LOGIN'
      }
      const updatedAt = new Date().toISOString()
      employee.updated_at = updatedAt
      await db.prepare(
        `UPDATE ponto_employees SET code=?, name=?, login_email=?, active=?, updated_at=? WHERE id=?`
      ).bind(employee.code || '', employee.name || '', employee.login_email || '', employee.active ? 1 : 0, updatedAt, employeeId).run()
      if (linkEvent) {
        await writeAudit(db, env, linkEvent, { employeeId, prev: prevEmail || '', next: nextEmail || '' }, auth.actor)
      }
      await writeAudit(db, env, 'EMPLOYEE_UPDATE', { employeeId }, auth.actor)
    })

    const out = await findEmployeeById(db, employeeId)
    return json(200, { ok: true, data: publicEmployee(out) })
  }

  if (sub.startsWith('/admin/employees/') && request.method === 'DELETE') {
    const auth = await requireAdmin({ request, env, withCORS, appOrigin })
    if (!auth.ok) return auth.response
    const employeeId = sub.split('/')[3] || ''
    const employee = await findEmployeeById(db, employeeId)
    if (!employee || employee.deleted_at) return json(404, { ok: false, error: 'NOT_FOUND' })
    const now = new Date().toISOString()
    await withTxn(db, async () => {
      await db.prepare(`UPDATE ponto_employees SET deleted_at=?, active=0, updated_at=? WHERE id=?`).bind(now, now, employeeId).run()
      await writeAudit(db, env, 'EMPLOYEE_DELETE', { employeeId }, auth.actor)
    })
    return json(200, { ok: true })
  }

  if (sub.startsWith('/admin/employees/') && sub.endsWith('/pin') && request.method === 'POST') {
    const auth = await requireAdmin({ request, env, withCORS, appOrigin })
    if (!auth.ok) return auth.response
    const parts = sub.split('/').filter(Boolean)
    const employeeId = parts[2] || ''
    const employee = await findEmployeeById(db, employeeId)
    if (!employee || employee.deleted_at) return json(404, { ok: false, error: 'NOT_FOUND' })
    const body = await request.json().catch(() => ({}))
    const pin = safeText(body?.pin, 20)
    if (!pin || pin.length < 4) return json(400, { ok: false, error: 'PIN_INVALID' })
    const hashed = await hashPin(pin)
    const now = new Date().toISOString()
    await withTxn(db, async () => {
      await db.prepare(
        `UPDATE ponto_employees SET pin_alg=?, pin_salt=?, pin_hash=?, pin_iters=?, updated_at=? WHERE id=?`
      ).bind(hashed.alg, hashed.saltB64, hashed.hashB64, hashed.iters, now, employeeId).run()
      await writeAudit(db, env, 'EMPLOYEE_SET_PIN', { employeeId }, auth.actor)
    })
    const out = await findEmployeeById(db, employeeId)
    return json(200, { ok: true, data: publicEmployee(out) })
  }

  if (sub.startsWith('/admin/employees/') && sub.endsWith('/enroll') && request.method === 'POST') {
    const auth = await requireAdmin({ request, env, withCORS, appOrigin })
    if (!auth.ok) return auth.response
    const parts = sub.split('/').filter(Boolean)
    const employeeId = parts[2] || ''
    const employee = await findEmployeeById(db, employeeId)
    if (!employee || employee.deleted_at) return json(404, { ok: false, error: 'NOT_FOUND' })
    const body = await request.json().catch(() => ({}))
    const consentConfirmed = body?.consentConfirmed === true
    if (!consentConfirmed) return json(400, { ok: false, error: 'CONSENT_REQUIRED' })
    const descriptors = body?.descriptors
    if (!Array.isArray(descriptors) || !descriptors.length) return json(400, { ok: false, error: 'DESCRIPTORS_REQUIRED' })
    const replace = body?.replace === true
    const accepted = []
    for (const d of descriptors) {
      if (!isNumberArray(d, 64, 1024)) continue
      accepted.push(d)
      if (accepted.length >= maxDescriptors) break
    }
    if (!accepted.length) return json(400, { ok: false, error: 'DESCRIPTORS_INVALID' })
    const now = new Date().toISOString()
    await withTxn(db, async () => {
      if (replace) {
        await db.prepare(`DELETE FROM ponto_face_templates WHERE employee_id = ?`).bind(employeeId).run()
      }
      for (const tpl of accepted) {
        await db.prepare(
          `INSERT INTO ponto_face_templates (id, employee_id, created_at, template_json) VALUES (?, ?, ?, ?)`
        ).bind(crypto.randomUUID(), employeeId, now, JSON.stringify(tpl)).run()
      }
      // Keep last N templates
      await db.prepare(
        `DELETE FROM ponto_face_templates
         WHERE employee_id = ?
           AND id NOT IN (
             SELECT id FROM ponto_face_templates WHERE employee_id = ? ORDER BY created_at DESC LIMIT ?
           )`
      ).bind(employeeId, employeeId, Number(maxDescriptors)).run()
      await db.prepare(`UPDATE ponto_employees SET last_enrolled_at=?, updated_at=? WHERE id=?`).bind(now, now, employeeId).run()
      await writeAudit(db, env, 'EMPLOYEE_ENROLL_FACE', { employeeId, replace, count: accepted.length }, auth.actor)
    })
    const out = await findEmployeeById(db, employeeId)
    return json(200, { ok: true, data: publicEmployee(out) })
  }

  if (sub === '/admin/devices' && request.method === 'GET') {
    const auth = await requireAdmin({ request, env, withCORS, appOrigin })
    if (!auth.ok) return auth.response
    const rows = await db.prepare(`SELECT * FROM ponto_devices ORDER BY created_at DESC`).all()
    return json(200, { ok: true, data: (rows?.results || []).map(publicDevice) })
  }

  if (sub === '/admin/devices' && request.method === 'POST') {
    const auth = await requireAdmin({ request, env, withCORS, appOrigin })
    if (!auth.ok) return auth.response
    const body = await request.json().catch(() => ({}))
    const unit = safeText(body?.unit, 80)
    const label = safeText(body?.label, 80)
    if (!unit) return json(400, { ok: false, error: 'UNIT_REQUIRED' })
    const tokenBytes = crypto.getRandomValues(new Uint8Array(24))
    const tokenOnce = bytesToB64Url(tokenBytes)
    const tokenHash = await sha256HexUtf8(tokenOnce)
    const now = new Date().toISOString()
    const id = crypto.randomUUID()
    await withTxn(db, async () => {
      await db.prepare(
        `INSERT INTO ponto_devices (id, label, unit, token_hash, created_at, revoked_at, last_seen_at)
         VALUES (?, ?, ?, ?, ?, NULL, NULL)`
      ).bind(id, label, unit, tokenHash, now).run()
      await writeAudit(db, env, 'DEVICE_CREATE', { deviceId: id, unit, label }, auth.actor)
    })
    const device = await db.prepare(`SELECT * FROM ponto_devices WHERE id = ?`).bind(id).first()
    return json(200, { ok: true, data: publicDevice(device), tokenOnce })
  }

  if (sub.startsWith('/admin/devices/') && sub.endsWith('/revoke') && request.method === 'POST') {
    const auth = await requireAdmin({ request, env, withCORS, appOrigin })
    if (!auth.ok) return auth.response
    const parts = sub.split('/').filter(Boolean)
    const deviceId = parts[2] || ''
    const device = await db.prepare(`SELECT * FROM ponto_devices WHERE id = ?`).bind(deviceId).first()
    if (!device) return json(404, { ok: false, error: 'NOT_FOUND' })
    if (!device.revoked_at) {
      const now = new Date().toISOString()
      await withTxn(db, async () => {
        await db.prepare(`UPDATE ponto_devices SET revoked_at = ? WHERE id = ?`).bind(now, deviceId).run()
        await writeAudit(db, env, 'DEVICE_REVOKE', { deviceId }, auth.actor)
      })
    }
    const out = await db.prepare(`SELECT * FROM ponto_devices WHERE id = ?`).bind(deviceId).first()
    return json(200, { ok: true, data: publicDevice(out) })
  }

  if (sub === '/admin/records' && request.method === 'GET') {
    const auth = await requireAdmin({ request, env, withCORS, appOrigin })
    if (!auth.ok) return auth.response
    const from = safeText(url.searchParams.get('from'), 30)
    const to = safeText(url.searchParams.get('to'), 30)
    const employeeId = safeText(url.searchParams.get('employeeId'), 80)
    const limit = clampInt(url.searchParams.get('limit'), 1, 5000, 200)
    const fromMs = from ? new Date(from).getTime() : null
    const toMs = to ? new Date(to).getTime() : null
    if (from && fromMs != null && !Number.isFinite(fromMs)) return json(400, { ok: false, error: 'DATE_INVALID' })
    if (to && toMs != null && !Number.isFinite(toMs)) return json(400, { ok: false, error: 'DATE_INVALID' })

    let sql = `SELECT * FROM ponto_records WHERE kind='PUNCH'`
    const binds = []
    if (employeeId) { sql += ` AND employee_id=?`; binds.push(employeeId) }
    if (from) { sql += ` AND at>=?`; binds.push(new Date(from).toISOString()) }
    if (to) { sql += ` AND at<=?`; binds.push(new Date(to).toISOString()) }
    sql += ` ORDER BY at DESC LIMIT ?`; binds.push(limit)
    const rows = await db.prepare(sql).bind(...binds).all()
    return json(200, { ok: true, data: rows?.results || [], correctionsCount: 0 })
  }

  if (sub === '/admin/records.csv' && request.method === 'GET') {
    const auth = await requireAdmin({ request, env, withCORS, appOrigin })
    if (!auth.ok) return auth.response
    const from = safeText(url.searchParams.get('from'), 30)
    const to = safeText(url.searchParams.get('to'), 30)
    const employeeId = safeText(url.searchParams.get('employeeId'), 80)
    const limit = clampInt(url.searchParams.get('limit'), 1, 5000, 2000)
    let sql = `SELECT * FROM ponto_records WHERE kind='PUNCH'`
    const binds = []
    if (employeeId) { sql += ` AND employee_id=?`; binds.push(employeeId) }
    if (from) { sql += ` AND at>=?`; binds.push(new Date(from).toISOString()) }
    if (to) { sql += ` AND at<=?`; binds.push(new Date(to).toISOString()) }
    sql += ` ORDER BY at DESC LIMIT ?`; binds.push(limit)
    const rows = await db.prepare(sql).bind(...binds).all()
    const data = rows?.results || []

    const headers = [
      'id',
      'employeeId',
      'employeeName',
      'type',
      'at',
      'unit',
      'deviceId',
      'deviceLabel',
      'method',
      'matchDistance',
      'note',
      'ip',
      'userAgent',
      'idempotencyKey',
      'createdAt',
    ]
    const lines = [headers.join(',')]
    for (const r of data) {
      const row = [
        r.id,
        r.employee_id,
        r.employee_name,
        r.type,
        r.at,
        r.unit,
        r.device_id,
        r.device_label,
        r.method,
        r.match_distance,
        r.note,
        r.ip,
        r.user_agent,
        r.idempotency_key,
        r.created_at,
      ].map(toCsvCell)
      lines.push(row.join(','))
    }
    const csv = lines.join('\n') + '\n'
    return withCORS(csv, {
      status: 200,
      headers: {
        'content-type': 'text/csv; charset=utf-8',
        'cache-control': 'no-store',
        'content-disposition': 'attachment; filename="ponto_records.csv"',
      }
    }, appOrigin)
  }

  if (sub === '/admin/punch' && request.method === 'POST') {
    const auth = await requireAdmin({ request, env, withCORS, appOrigin })
    if (!auth.ok) return auth.response
    const body = await request.json().catch(() => ({}))
    const employeeId = safeText(body?.employeeId, 80)
    if (!employeeId) return json(400, { ok: false, error: 'EMPLOYEE_REQUIRED' })
    const employee = await findEmployeeById(db, employeeId)
    if (!employee || employee.deleted_at || !employee.active) return json(404, { ok: false, error: 'EMPLOYEE_NOT_FOUND' })

    const idempotencyKey = getIdempotencyKey(request, body)
    const existing = await findExistingByIdempotency(db, { deviceId: null, employeeId, idempotencyKey })
    if (existing) return json(200, { ok: true, data: existing, employee: publicEmployee(employee), idempotent: true })

    const cooldown = await enforceCooldown(db, employeeId, punchCooldownSeconds)
    if (!cooldown.ok) return json(409, { ok: false, error: 'COOLDOWN', secondsRemaining: cooldown.secondsRemaining, last: cooldown.last })

    const last = await findLastEmployeePunch(db, employeeId)
    const type = computePunchType(body?.type, last?.type)
    const unit = safeText(body?.unit, 80) || null
    const note = safeText(body?.note, 240) || null
    const now = new Date().toISOString()
    const record = {
      id: crypto.randomUUID(),
      kind: 'PUNCH',
      employee_id: employeeId,
      employee_name: employee.name,
      type,
      at: now,
      unit,
      device_id: null,
      device_label: null,
      method: 'ADMIN',
      match_distance: null,
      note,
      idempotency_key: idempotencyKey || null,
      ip: getClientIp(request),
      user_agent: safeText(request.headers.get('user-agent'), 220) || null,
      client_time: null,
      tz_offset_minutes: null,
      locale: null,
      app_version: null,
      created_at: now,
    }
    await withTxn(db, async () => {
      await db.prepare(
        `INSERT INTO ponto_records (
           id, kind, employee_id, employee_name, type, at, unit, device_id, device_label,
           method, match_distance, note, idempotency_key, ip, user_agent, client_time, tz_offset_minutes, locale, app_version, created_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
        .bind(
          record.id, record.kind, record.employee_id, record.employee_name, record.type, record.at, record.unit,
          record.device_id, record.device_label, record.method, record.match_distance, record.note, record.idempotency_key,
          record.ip, record.user_agent, record.client_time, record.tz_offset_minutes, record.locale, record.app_version, record.created_at
        )
        .run()
      await writeAudit(db, env, 'PUNCH_ADMIN', { recordId: record.id, employeeId, type, unit, note }, auth.actor)
    })
    return json(200, { ok: true, data: record, employee: publicEmployee(employee) })
  }

  if (sub === '/admin/audit/verify' && request.method === 'GET') {
    const auth = await requireAdmin({ request, env, withCORS, appOrigin })
    if (!auth.ok) return auth.response
    const fromLine = clampInt(url.searchParams.get('fromLine'), 0, Number.MAX_SAFE_INTEGER, 0)
    try {
      const rows = await db.prepare(`SELECT * FROM ponto_audit ORDER BY created_at ASC`).all()
      const events = rows?.results || []
      let prevHash = null
      for (let i = 0; i < events.length; i++) {
        if (i < fromLine) continue
        const ev = events[i]
        const payload = {
          v: Number(ev.v) || 1,
          id: ev.id,
          type: ev.type,
          at: ev.at,
          actor: safeJsonParse(ev.actor_json) || {},
          data: safeJsonParse(ev.data_json) || {},
          prevHash: ev.prev_hash || null,
        }
        const expectedPrev = payload.prevHash || null
        if (expectedPrev !== prevHash) return json(200, { ok: false, error: 'CHAIN_BROKEN', index: i, expectedPrev, actualPrev: prevHash })
        const hashInput = (prevHash || '') + '\n' + stableStringify(payload)
        const expectedHash = await sha256HexUtf8(hashInput)
        if (String(ev.hash || '') !== expectedHash) return json(200, { ok: false, error: 'HASH_MISMATCH', index: i })
        const auditKey = String(env?.PONTO_AUDIT_HMAC_KEY || '').trim()
        if (auditKey) {
          const expectedHmac = await hmacSha256Hex(auditKey, hashInput)
          if (String(ev.hmac || '') !== expectedHmac) return json(200, { ok: false, error: 'HMAC_MISMATCH', index: i })
        }
        prevHash = expectedHash
      }
      return json(200, { ok: true, count: Math.max(0, events.length - fromLine), lastHash: prevHash })
    } catch (e) {
      return json(500, { ok: false, error: e?.message || String(e) })
    }
  }

  // -------------------------------------------------------------
  // Employee APIs (self-service via Pages proxy actor headers)
  // -------------------------------------------------------------
  if (sub === '/me' && request.method === 'GET') {
    const auth = await requireEmployee({ request, env, withCORS, appOrigin, actorSkewMs })
    if (!auth.ok) return auth.response
    const employee = await findEmployeeByLoginEmail(db, auth.email)
    if (!employee) {
      return json(200, {
        ok: true,
        linked: false,
        actorEmail: auth.email,
        hint: 'Seu usuário ainda não está vinculado a um funcionário. Peça ao admin para definir o email no cadastro do funcionário.'
      })
    }
    const lastPunch = await findLastEmployeePunch(db, employee.id)
    const cooldown = await enforceCooldown(db, employee.id, punchCooldownSeconds)
    const hasFace = Number(employee.face_descriptors_count || 0) > 0
    return json(200, {
      ok: true,
      linked: true,
      actorEmail: auth.email,
      employee: publicEmployee(employee),
      hasFace,
      pinSet: !!employee.pin_hash,
      lastPunch: lastPunch || null,
      cooldown: cooldown.ok ? { active: false } : { active: true, secondsRemaining: cooldown.secondsRemaining, last: cooldown.last },
      suggestedNextMethod: hasFace ? 'FACE' : 'PIN',
    })
  }

  if (sub === '/me/records' && request.method === 'GET') {
    const auth = await requireEmployee({ request, env, withCORS, appOrigin, actorSkewMs })
    if (!auth.ok) return auth.response
    const employee = await findEmployeeByLoginEmail(db, auth.email)
    if (!employee) return json(404, { ok: false, error: 'EMPLOYEE_NOT_LINKED' })
    const from = safeText(url.searchParams.get('from'), 30)
    const to = safeText(url.searchParams.get('to'), 30)
    const limit = clampInt(url.searchParams.get('limit'), 1, 2000, 200)
    let sql = `SELECT * FROM ponto_records WHERE kind='PUNCH' AND employee_id=?`
    const binds = [employee.id]
    if (from) { sql += ` AND at>=?`; binds.push(new Date(from).toISOString()) }
    if (to) { sql += ` AND at<=?`; binds.push(new Date(to).toISOString()) }
    sql += ` ORDER BY at DESC LIMIT ?`; binds.push(limit)
    const rows = await db.prepare(sql).bind(...binds).all()
    return json(200, { ok: true, data: rows?.results || [], correctionsCount: 0 })
  }

  if (sub === '/me/punch' && request.method === 'POST') {
    const auth = await requireEmployee({ request, env, withCORS, appOrigin, actorSkewMs })
    if (!auth.ok) return auth.response
    const employee = await findEmployeeByLoginEmail(db, auth.email)
    if (!employee) return json(404, { ok: false, error: 'EMPLOYEE_NOT_LINKED' })
    const body = await request.json().catch(() => ({}))

    const idempotencyKey = getIdempotencyKey(request, body)
    const existing = await findExistingByIdempotency(db, { deviceId: null, employeeId: employee.id, idempotencyKey })
    if (existing) return json(200, { ok: true, data: existing, employee: publicEmployee(employee), idempotent: true })

    const cooldown = await enforceCooldown(db, employee.id, punchCooldownSeconds)
    if (!cooldown.ok) return json(409, { ok: false, error: 'COOLDOWN', secondsRemaining: cooldown.secondsRemaining, last: cooldown.last })

    const descriptor = body?.descriptor
    const pin = safeText(body?.pin, 20)
    const templatesCount = Number(employee.face_descriptors_count || 0) || 0
    const hasFace = templatesCount > 0
    let method = null
    let matchDistance = null

    if (descriptor !== undefined) {
      if (!isNumberArray(descriptor, 64, 1024)) return json(400, { ok: false, error: 'DESCRIPTOR_INVALID' })
      if (hasFace) {
        const templates = await loadEmployeeTemplates(db, employee.id, maxDescriptors)
        const threshold = clampFloat(body?.threshold ?? faceThresholdDefault, 0.2, 1.5, faceThresholdDefault)
        let bestDistance = Number.POSITIVE_INFINITY
        for (const tpl of templates) {
          if (!isNumberArray(tpl, descriptor.length, descriptor.length)) continue
          const dist = l2(descriptor, tpl)
          if (dist < bestDistance) bestDistance = dist
        }
        if (!Number.isFinite(bestDistance)) return json(401, { ok: false, error: 'FACE_NOT_ENROLLED', next: 'PIN', threshold })
        if (bestDistance > threshold) return json(401, { ok: false, error: 'FACE_NOT_RECOGNIZED', next: 'PIN', threshold, bestDistance })
        method = 'FACE'
        matchDistance = bestDistance
      }
    }

    if (!method && pin) {
      if (!employee.pin_hash) return json(400, { ok: false, error: 'PIN_NOT_SET' })
      const okPin = await verifyPin(pin, { alg: employee.pin_alg, saltB64: employee.pin_salt, hashB64: employee.pin_hash, iters: employee.pin_iters })
      if (!okPin) return json(401, { ok: false, error: 'PIN_INVALID' })
      method = 'PIN'
    }

    if (!method) return json(400, { ok: false, error: 'NEXT_METHOD_REQUIRED', next: hasFace ? 'FACE' : 'PIN' })

    const last = await findLastEmployeePunch(db, employee.id)
    const type = computePunchType(body?.type, last?.type)
    const unit = safeText(body?.unit, 80) || null
    const note = safeText(body?.note, 240) || null
    const now = new Date().toISOString()
    const client = getClientTimeMeta(body)
    const record = {
      id: crypto.randomUUID(),
      kind: 'PUNCH',
      employeeId: employee.id,
      employeeName: employee.name,
      type,
      at: now,
      client,
      unit,
      deviceId: null,
      deviceLabel: null,
      ip: getClientIp(request),
      userAgent: safeText(request.headers.get('user-agent'), 220) || null,
      matchDistance,
      method,
      geo: null,
      liveness: null,
      note,
      idempotencyKey: idempotencyKey || null,
      createdAt: now,
    }

    await withTxn(db, async () => {
      await db.prepare(
        `INSERT INTO ponto_records (
           id, kind, employee_id, employee_name, type, at, unit, device_id, device_label,
           method, match_distance, note, idempotency_key, ip, user_agent, client_time, tz_offset_minutes, locale, app_version, created_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
        .bind(
          record.id,
          record.kind,
          record.employeeId,
          record.employeeName,
          record.type,
          record.at,
          record.unit,
          null,
          null,
          record.method,
          record.matchDistance,
          record.note,
          record.idempotencyKey,
          record.ip,
          record.userAgent,
          client.clientTime,
          client.tzOffsetMinutes,
          client.locale,
          client.appVersion,
          record.createdAt
        )
        .run()
      await writeAudit(db, env, method === 'FACE' ? 'PUNCH_FACE' : 'PUNCH_PIN', { recordId: record.id, employeeId: employee.id, type, unit }, auth.actor)
    })

    return json(200, { ok: true, data: record, employee: publicEmployee(employee) })
  }

  // -------------------------------------------------------------
  // Device APIs
  // -------------------------------------------------------------
  if (sub === '/device/employees' && request.method === 'GET') {
    const auth = await requireDevice({ request, env, db, withCORS, appOrigin })
    if (!auth.ok) return auth.response
    const rows = await db.prepare(
      `SELECT
         e.id,
         e.code,
         e.name,
         e.pin_hash,
         (SELECT COUNT(*) FROM ponto_face_templates t WHERE t.employee_id = e.id) AS face_descriptors_count
       FROM ponto_employees e
       WHERE e.deleted_at IS NULL AND e.active = 1
       ORDER BY e.created_at DESC`
    ).all()
    const employees = (rows?.results || []).map((e) => ({
      id: e.id,
      code: e.code || '',
      name: e.name,
      hasFace: Number(e.face_descriptors_count || 0) > 0,
      pinSet: !!e.pin_hash,
    }))
    return json(200, { ok: true, unit: auth.device.unit, device: publicDevice(auth.device), data: employees })
  }

  if (sub === '/device/identify' && request.method === 'POST') {
    const auth = await requireDevice({ request, env, db, withCORS, appOrigin })
    if (!auth.ok) return auth.response
    const body = await request.json().catch(() => ({}))
    const descriptor = body?.descriptor
    if (!isNumberArray(descriptor, 64, 1024)) return json(400, { ok: false, error: 'DESCRIPTOR_INVALID' })
    const threshold = clampFloat(body?.threshold ?? faceThresholdDefault, 0.2, 1.5, faceThresholdDefault)

    const rows = await db.prepare(
      `SELECT t.employee_id, e.name, t.template_json
       FROM ponto_face_templates t
       JOIN ponto_employees e ON e.id = t.employee_id
       WHERE e.deleted_at IS NULL AND e.active = 1`
    ).all()
    let best = null
    let bestDistance = Number.POSITIVE_INFINITY
    const candidates = []
    for (const r of rows?.results || []) {
      const tpl = safeJsonParse(r.template_json)
      if (!isNumberArray(tpl, descriptor.length, descriptor.length)) continue
      const dist = l2(descriptor, tpl)
      candidates.push({ employeeId: r.employee_id, name: r.name, distance: dist })
      if (dist < bestDistance) {
        bestDistance = dist
        best = { employeeId: r.employee_id, name: r.name, distance: dist }
      }
    }
    candidates.sort((a, b) => a.distance - b.distance)
    const topK = clampInt(body?.topK ?? 5, 1, 25, 5)
    const top = candidates.slice(0, topK)
    if (!best || !Number.isFinite(bestDistance) || bestDistance > threshold) {
      return json(200, { ok: true, match: null, bestDistance: Number.isFinite(bestDistance) ? bestDistance : null, threshold, top })
    }
    return json(200, { ok: true, match: best, bestDistance, threshold, top })
  }

  if (sub === '/device/punch/face' && request.method === 'POST') {
    const auth = await requireDevice({ request, env, db, withCORS, appOrigin })
    if (!auth.ok) return auth.response
    const body = await request.json().catch(() => ({}))
    const idempotencyKey = getIdempotencyKey(request, body)
    const existing = await findExistingByIdempotency(db, { deviceId: auth.device.id, employeeId: null, idempotencyKey })
    if (existing) return json(200, { ok: true, data: existing, idempotent: true })

    const descriptor = body?.descriptor
    if (!isNumberArray(descriptor, 64, 1024)) return json(400, { ok: false, error: 'DESCRIPTOR_INVALID' })

    const threshold = clampFloat(body?.threshold ?? faceThresholdDefault, 0.2, 1.5, faceThresholdDefault)
    const rows = await db.prepare(
      `SELECT t.employee_id, e.name, t.template_json
       FROM ponto_face_templates t
       JOIN ponto_employees e ON e.id = t.employee_id
       WHERE e.deleted_at IS NULL AND e.active = 1`
    ).all()

    let best = null
    let bestDistance = Number.POSITIVE_INFINITY
    const top = []
    for (const r of rows?.results || []) {
      const tpl = safeJsonParse(r.template_json)
      if (!isNumberArray(tpl, descriptor.length, descriptor.length)) continue
      const dist = l2(descriptor, tpl)
      if (dist < bestDistance) {
        bestDistance = dist
        best = { employeeId: r.employee_id, name: r.name, distance: dist }
      }
      top.push({ employeeId: r.employee_id, name: r.name, distance: dist })
    }
    top.sort((a, b) => a.distance - b.distance)
    const top5 = top.slice(0, 5)
    if (!best || !Number.isFinite(bestDistance) || bestDistance > threshold) {
      return json(401, { ok: false, error: 'NOT_RECOGNIZED', bestDistance: Number.isFinite(bestDistance) ? bestDistance : null, threshold, top: top5 })
    }

    const employee = await findEmployeeById(db, best.employeeId)
    if (!employee || employee.deleted_at || !employee.active) return json(404, { ok: false, error: 'EMPLOYEE_INACTIVE' })

    const cooldown = await enforceCooldown(db, employee.id, punchCooldownSeconds)
    if (!cooldown.ok) return json(409, { ok: false, error: 'COOLDOWN', secondsRemaining: cooldown.secondsRemaining, last: cooldown.last })

    const last = await findLastEmployeePunch(db, employee.id)
    const type = computePunchType(body?.type, last?.type)
    const now = new Date().toISOString()
    const client = getClientTimeMeta(body)

    const record = {
      id: crypto.randomUUID(),
      kind: 'PUNCH',
      employeeId: employee.id,
      employeeName: employee.name,
      type,
      at: now,
      client,
      unit: auth.device.unit,
      deviceId: auth.device.id,
      deviceLabel: auth.device.label || null,
      ip: getClientIp(request),
      userAgent: safeText(request.headers.get('user-agent'), 220) || null,
      matchDistance: bestDistance,
      method: 'FACE',
      geo: null,
      liveness: null,
      note: null,
      idempotencyKey: idempotencyKey || null,
      createdAt: now,
    }

    await withTxn(db, async () => {
      await db.prepare(
        `INSERT INTO ponto_records (
           id, kind, employee_id, employee_name, type, at, unit, device_id, device_label,
           method, match_distance, note, idempotency_key, ip, user_agent, client_time, tz_offset_minutes, locale, app_version, created_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
        .bind(
          record.id,
          record.kind,
          record.employeeId,
          record.employeeName,
          record.type,
          record.at,
          record.unit,
          record.deviceId,
          record.deviceLabel,
          record.method,
          record.matchDistance,
          record.note,
          record.idempotencyKey,
          record.ip,
          record.userAgent,
          client.clientTime,
          client.tzOffsetMinutes,
          client.locale,
          client.appVersion,
          record.createdAt
        )
        .run()
      await writeAudit(db, env, 'PUNCH_FACE', { recordId: record.id, employeeId: employee.id, type, unit: auth.device.unit }, auth.actor)
    })

    return json(200, { ok: true, data: record, employee: publicEmployee(employee) })
  }

  if (sub === '/device/punch/pin' && request.method === 'POST') {
    const auth = await requireDevice({ request, env, db, withCORS, appOrigin })
    if (!auth.ok) return auth.response
    const body = await request.json().catch(() => ({}))
    const idempotencyKey = getIdempotencyKey(request, body)
    const existing = await findExistingByIdempotency(db, { deviceId: auth.device.id, employeeId: null, idempotencyKey })
    if (existing) return json(200, { ok: true, data: existing, idempotent: true })

    const employeeId = safeText(body?.employeeId, 80)
    const pin = safeText(body?.pin, 20)
    const employee = await findEmployeeById(db, employeeId)
    if (!employee || employee.deleted_at || !employee.active) return json(404, { ok: false, error: 'EMPLOYEE_NOT_FOUND' })
    if (!employee.pin_hash) return json(400, { ok: false, error: 'PIN_NOT_SET' })
    const okPin = await verifyPin(pin, { alg: employee.pin_alg, saltB64: employee.pin_salt, hashB64: employee.pin_hash, iters: employee.pin_iters })
    if (!okPin) return json(401, { ok: false, error: 'PIN_INVALID' })

    const cooldown = await enforceCooldown(db, employee.id, punchCooldownSeconds)
    if (!cooldown.ok) return json(409, { ok: false, error: 'COOLDOWN', secondsRemaining: cooldown.secondsRemaining, last: cooldown.last })

    const last = await findLastEmployeePunch(db, employee.id)
    const type = computePunchType(body?.type, last?.type)
    const now = new Date().toISOString()
    const client = getClientTimeMeta(body)
    const record = {
      id: crypto.randomUUID(),
      kind: 'PUNCH',
      employeeId: employee.id,
      employeeName: employee.name,
      type,
      at: now,
      client,
      unit: auth.device.unit,
      deviceId: auth.device.id,
      deviceLabel: auth.device.label || null,
      ip: getClientIp(request),
      userAgent: safeText(request.headers.get('user-agent'), 220) || null,
      matchDistance: null,
      method: 'PIN',
      geo: null,
      liveness: null,
      note: null,
      idempotencyKey: idempotencyKey || null,
      createdAt: now,
    }

    await withTxn(db, async () => {
      await db.prepare(
        `INSERT INTO ponto_records (
           id, kind, employee_id, employee_name, type, at, unit, device_id, device_label,
           method, match_distance, note, idempotency_key, ip, user_agent, client_time, tz_offset_minutes, locale, app_version, created_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
        .bind(
          record.id,
          record.kind,
          record.employeeId,
          record.employeeName,
          record.type,
          record.at,
          record.unit,
          record.deviceId,
          record.deviceLabel,
          record.method,
          record.matchDistance,
          record.note,
          record.idempotencyKey,
          record.ip,
          record.userAgent,
          client.clientTime,
          client.tzOffsetMinutes,
          client.locale,
          client.appVersion,
          record.createdAt
        )
        .run()
      await writeAudit(db, env, 'PUNCH_PIN', { recordId: record.id, employeeId: employee.id, type, unit: auth.device.unit }, auth.actor)
    })

    return json(200, { ok: true, data: record, employee: publicEmployee(employee) })
  }

  return json(404, { ok: false, error: 'NOT_FOUND' })
}

