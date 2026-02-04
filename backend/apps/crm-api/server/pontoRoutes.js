import { promises as fs } from 'fs'
import path from 'path'
import * as crypto from 'crypto'

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

function getClientIp(req) {
  const xf = String(req.headers['x-forwarded-for'] || '').trim()
  if (xf) return xf.split(',')[0].trim()
  return req.socket?.remoteAddress || null
}

function safeEqual(a, b) {
  const aa = Buffer.from(String(a || ''))
  const bb = Buffer.from(String(b || ''))
  if (aa.length !== bb.length) return false
  return crypto.timingSafeEqual(aa, bb)
}

function b64UrlToUtf8(b64url) {
  const s = String(b64url || '').trim()
  if (!s) return ''
  const padded = s.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(s.length / 4) * 4, '=')
  return Buffer.from(padded, 'base64').toString('utf-8')
}

function sha256Hex(input) {
  return crypto.createHash('sha256').update(input).digest('hex')
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

function tryParseKey(input) {
  const raw = String(input || '').trim()
  if (!raw) return null
  try {
    const b64 = raw.replace(/-/g, '+').replace(/_/g, '/')
    const buf = Buffer.from(b64, 'base64')
    if (buf.length === 32) return buf
  } catch { /* ignore */ }
  try {
    const buf = Buffer.from(raw, 'hex')
    if (buf.length === 32) return buf
  } catch { /* ignore */ }
  return null
}

function encryptJson(key, data) {
  const iv = crypto.randomBytes(12)
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv)
  const pt = Buffer.from(JSON.stringify(data), 'utf-8')
  const ct = Buffer.concat([cipher.update(pt), cipher.final()])
  const tag = cipher.getAuthTag()
  return { alg: 'A256GCM', iv: iv.toString('base64'), tag: tag.toString('base64'), ct: ct.toString('base64') }
}

function decryptJson(key, enc) {
  if (!enc || typeof enc !== 'object') return null
  if (enc.alg !== 'A256GCM') return null
  const iv = Buffer.from(String(enc.iv || ''), 'base64')
  const tag = Buffer.from(String(enc.tag || ''), 'base64')
  const ct = Buffer.from(String(enc.ct || ''), 'base64')
  if (iv.length !== 12 || tag.length !== 16 || !ct.length) return null
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv)
  decipher.setAuthTag(tag)
  const pt = Buffer.concat([decipher.update(ct), decipher.final()])
  return JSON.parse(pt.toString('utf-8'))
}

function hashPin(pin, salt) {
  const p = String(pin || '')
  if (!p) return null
  const s = salt || crypto.randomBytes(16)
  const dk = crypto.scryptSync(p, s, 32)
  return { alg: 'scrypt', salt: s.toString('base64'), hash: dk.toString('base64') }
}

function verifyPin(pin, stored) {
  if (!stored || stored.alg !== 'scrypt') return false
  const salt = Buffer.from(String(stored.salt || ''), 'base64')
  const expected = Buffer.from(String(stored.hash || ''), 'base64')
  if (!salt.length || expected.length !== 32) return false
  const dk = crypto.scryptSync(String(pin || ''), salt, 32)
  return crypto.timingSafeEqual(dk, expected)
}

function getIdempotencyKey(req, maxLen = 80) {
  const h = safeText(req.headers['x-idempotency-key'], maxLen)
  if (h) return h
  return safeText(req.body?.requestId, maxLen)
}

function getClientTimeMeta(req) {
  const clientTime = safeText(req.body?.clientTime, 40) || null
  const tzOffsetMinutesRaw = req.body?.tzOffsetMinutes
  const tzOffsetMinutes = tzOffsetMinutesRaw === null || tzOffsetMinutesRaw === undefined
    ? null
    : clampInt(tzOffsetMinutesRaw, -840, 840, null)
  const locale = safeText(req.body?.locale, 40) || null
  const appVersion = safeText(req.body?.appVersion, 40) || null
  return { clientTime, tzOffsetMinutes, locale, appVersion }
}

async function tryReadJson(filePath) {
  try {
    const raw = await fs.readFile(filePath, 'utf-8')
    return JSON.parse(raw)
  } catch {
    return null
  }
}

async function ensureDir(dir) {
  try { await fs.mkdir(dir, { recursive: true }) } catch { /* ignore */ }
}

export function registerPontoRoutes(app, { coreStateDir }) {
  const STORE_FILE_V1 = path.join(coreStateDir, 'ponto_store.v1.json')
  const STORE_FILE = path.join(coreStateDir, 'ponto_store.v2.json')
  const AUDIT_FILE = path.join(coreStateDir, 'ponto_audit.v1.jsonl')

  const adminToken = String(process.env.PONTO_ADMIN_TOKEN || '').trim()
  const templatesKey = tryParseKey(process.env.PONTO_TEMPLATES_KEY)
  const auditHmacKey = tryParseKey(process.env.PONTO_AUDIT_HMAC_KEY)

  // Optional hardening for /api/ponto/me (Cloudflare Pages proxy -> backend).
  const proxyToken = String(process.env.PONTO_PROXY_TOKEN || '').trim()
  const actorHmacKey = String(process.env.PONTO_ACTOR_HMAC_KEY || proxyToken).trim()
  const actorSkewMs = clampInt(process.env.PONTO_ACTOR_SKEW_MS, 5_000, 60 * 60 * 1000, 5 * 60 * 1000)

  const maxDescriptors = clampInt(process.env.PONTO_MAX_DESCRIPTORS, 1, 30, 10)
  const faceThresholdDefault = clampFloat(process.env.PONTO_FACE_THRESHOLD, 0.2, 1.5, 0.52)
  const punchCooldownSeconds = clampInt(process.env.PONTO_PUNCH_COOLDOWN_SECONDS, 0, 3600, 10)

  const faceCache = new Map() // employeeId -> number[][]

  let state = {
    version: 2,
    employees: [],
    devices: [],
    records: [],
    audit: { lastHash: null }
  }

  let saveTimer = null
  let writeQueue = Promise.resolve()

  function schedulePersist() {
    if (saveTimer) clearTimeout(saveTimer)
    saveTimer = setTimeout(() => { void persistNow() }, 500).unref()
  }

  async function persistNow() {
    await ensureDir(coreStateDir)
    const tmp = STORE_FILE + '.tmp'
    await fs.writeFile(tmp, JSON.stringify(state, null, 2))
    await fs.rename(tmp, STORE_FILE)
  }

  function enqueueWrite(fn) {
    writeQueue = writeQueue.then(fn, fn)
    return writeQueue
  }

  async function appendAudit(event) {
    await ensureDir(coreStateDir)
    await fs.appendFile(AUDIT_FILE, JSON.stringify(event) + '\n')
  }

  function actorFromReq(req, { kind, id, label, unit } = {}) {
    return {
      kind: kind || 'unknown',
      id: id || null,
      label: label || null,
      unit: unit || null,
      ip: getClientIp(req),
      ua: safeText(req.headers['user-agent'], 220) || null
    }
  }

  function makeAuditEvent(type, data, actor) {
    const now = new Date().toISOString()
    const base = { v: 1, id: crypto.randomUUID(), type, at: now, actor, data }
    const prevHash = state.audit?.lastHash || null
    const payload = { ...base, prevHash }
    const hashInput = (prevHash || '') + '\n' + stableStringify(payload)
    const hash = sha256Hex(hashInput)
    const hmac = auditHmacKey ? crypto.createHmac('sha256', auditHmacKey).update(hashInput).digest('hex') : null
    return { ...payload, hash, hmac }
  }

  async function writeAudit(type, data, actor) {
    const ev = makeAuditEvent(type, data, actor)
    state.audit = { ...(state.audit || {}), lastHash: ev.hash }
    await appendAudit(ev)
    schedulePersist()
    return ev
  }

  function publicEmployee(employee) {
    const cached = faceCache.get(employee.id)
    return {
      id: employee.id,
      code: employee.code || '',
      name: employee.name,
      loginEmail: employee.loginEmail || '',
      active: employee.active !== false,
      createdAt: employee.createdAt,
      updatedAt: employee.updatedAt,
      deletedAt: employee.deletedAt || null,
      faceDescriptorsCount: Array.isArray(cached) ? cached.length : 0,
      lastEnrolledAt: employee.lastEnrolledAt || null,
      pinSet: !!employee.pinHash
    }
  }

  function publicDevice(device) {
    return {
      id: device.id,
      label: device.label || '',
      unit: device.unit || '',
      active: device.revokedAt ? false : true,
      createdAt: device.createdAt,
      revokedAt: device.revokedAt || null,
      lastSeenAt: device.lastSeenAt || null
    }
  }

  function findEmployee(id) {
    const employeeId = String(id || '')
    return state.employees.find((e) => e && e.id === employeeId) || null
  }

  function findDeviceByToken(rawToken) {
    const token = String(rawToken || '').trim()
    if (!token) return null
    const hash = sha256Hex(token)
    for (const d of state.devices) {
      if (!d || d.revokedAt) continue
      if (d.tokenHash && safeEqual(d.tokenHash, hash)) return d
    }
    return null
  }

  function getDeviceTokenFromReq(req) {
    const h = String(req.headers.authorization || '').trim()
    if (h.toLowerCase().startsWith('device ')) return h.slice(7).trim()
    if (h.toLowerCase().startsWith('bearer ')) return h.slice(7).trim()
    const alt = String(req.headers['x-ponto-device-token'] || '').trim()
    return alt || ''
  }

  function getAdminTokenFromReq(req) {
    const h = String(req.headers.authorization || '').trim()
    if (h.toLowerCase().startsWith('admin ')) return h.slice(6).trim()
    if (h.toLowerCase().startsWith('bearer ')) return h.slice(7).trim()
    const alt = String(req.headers['x-ponto-admin-token'] || '').trim()
    return alt || ''
  }

  function requireAdmin(req, res) {
    if (!adminToken) {
      res.status(503).json({ ok: false, error: 'ADMIN_TOKEN_NOT_CONFIGURED' })
      return null
    }
    const provided = getAdminTokenFromReq(req)
    if (!provided || !safeEqual(provided, adminToken)) {
      res.status(401).json({ ok: false, error: 'ADMIN_UNAUTHORIZED' })
      return null
    }
    return actorFromReq(req, { kind: 'admin', id: 'token', label: 'admin-token' })
  }

  function requireDevice(req, res) {
    const token = getDeviceTokenFromReq(req)
    const device = findDeviceByToken(token)
    if (!device) {
      res.status(401).json({ ok: false, error: 'DEVICE_UNAUTHORIZED' })
      return null
    }
    device.lastSeenAt = new Date().toISOString()
    schedulePersist()
    return { device, actor: actorFromReq(req, { kind: 'device', id: device.id, label: device.label, unit: device.unit }) }
  }

  function verifyActor(req) {
    const actorB64 = String(req.headers['x-skincos-actor'] || '').trim()
    const tsRaw = String(req.headers['x-skincos-actor-ts'] || '').trim()
    const sig = String(req.headers['x-skincos-actor-sig'] || '').trim()

    if (!actorB64 || !tsRaw) return { ok: false, code: 'ACTOR_MISSING' }
    const ts = Number(tsRaw)
    if (!Number.isFinite(ts) || ts <= 0) return { ok: false, code: 'ACTOR_TS_INVALID' }
    if (Math.abs(Date.now() - ts) > actorSkewMs) return { ok: false, code: 'ACTOR_TS_SKEW' }

    const actorJson = b64UrlToUtf8(actorB64)
    let actor = null
    try { actor = JSON.parse(actorJson) } catch { actor = null }
    if (!actor || typeof actor !== 'object') return { ok: false, code: 'ACTOR_INVALID' }

    const isDev = String(process.env.NODE_ENV || '').toLowerCase() === 'development'
    const sigRequired = !isDev || !!actorHmacKey
    if (sigRequired) {
      if (!actorHmacKey) return { ok: false, code: 'ACTOR_KEY_MISSING' }
      if (!sig) return { ok: false, code: 'ACTOR_SIG_MISSING' }
      const expected = crypto.createHmac('sha256', actorHmacKey).update(`${tsRaw}.${actorB64}`).digest('base64url')
      if (!safeEqual(sig, expected)) return { ok: false, code: 'ACTOR_SIG_INVALID' }
    }

    const email = normalizeEmail(actor.email)
    if (!email) return { ok: false, code: 'ACTOR_EMAIL_MISSING' }
    return { ok: true, actor: { ...actor, email } }
  }

  function requireEmployee(req, res) {
    if (proxyToken) {
      const token = String(req.headers['x-ponto-proxy-token'] || '').trim()
      if (!token || token !== proxyToken) {
        res.status(401).json({ ok: false, error: 'UNAUTHORIZED', code: 'PROXY_TOKEN_INVALID' })
        return null
      }
    }

    const verified = verifyActor(req)
    if (!verified.ok) {
      res.status(401).json({
        ok: false,
        error: 'UNAUTHORIZED',
        code: verified.code,
        hint: 'Missing/invalid actor headers. Requests must come from the CRM Pages proxy.'
      })
      return null
    }

    const email = verified.actor.email
    return actorFromReq(req, { kind: 'employee', id: email, label: email })
  }

  function findEmployeeByLoginEmail(email) {
    const needle = normalizeEmail(email)
    if (!needle) return null
    for (const e of state.employees) {
      if (!e || e.deletedAt || e.active === false) continue
      if (normalizeEmail(e.loginEmail) === needle) return e
    }
    return null
  }

  function matchEmployeeDescriptor(employeeId, descriptor, opts = {}) {
    const threshold = clampFloat(opts.threshold ?? faceThresholdDefault, 0.2, 1.5, faceThresholdDefault)
    const templates = faceCache.get(employeeId) || []
    if (!templates.length) return { ok: false, code: 'FACE_NOT_ENROLLED', threshold }
    let bestDistance = Number.POSITIVE_INFINITY
    for (const tpl of templates) {
      if (!isNumberArray(tpl, descriptor.length, descriptor.length)) continue
      const dist = l2(descriptor, tpl)
      if (dist < bestDistance) bestDistance = dist
    }
    if (!Number.isFinite(bestDistance)) return { ok: false, code: 'FACE_NOT_ENROLLED', threshold }
    if (bestDistance > threshold) return { ok: false, code: 'FACE_NOT_RECOGNIZED', threshold, bestDistance }
    return { ok: true, threshold, bestDistance }
  }

  function migrateFromV1(loaded) {
    const employees = Array.isArray(loaded?.employees) ? loaded.employees.filter(Boolean) : []
    const records = Array.isArray(loaded?.records) ? loaded.records.filter(Boolean) : []

    const migratedEmployees = employees.map((e) => {
      const id = String(e.id || crypto.randomUUID())
      const faceDescriptors = Array.isArray(e.faceDescriptors) ? e.faceDescriptors.filter(Boolean) : []
      if (faceDescriptors.length) faceCache.set(id, faceDescriptors.filter((d) => isNumberArray(d, 64, 1024)).slice(0, maxDescriptors))
      return {
        id,
        code: safeText(e.code, 40),
        name: safeText(e.name, 80) || 'Funcionario',
        loginEmail: normalizeEmail(e.loginEmail || e.email || ''),
        active: e.active !== false,
        createdAt: e.createdAt || new Date().toISOString(),
        updatedAt: e.updatedAt || new Date().toISOString(),
        deletedAt: e.deletedAt || null,
        lastEnrolledAt: e.lastEnrolledAt || null,
        faceTemplates: [],
        pinHash: null,
        consent: { obtainedAt: new Date().toISOString(), version: 'v1' }
      }
    })

    return { version: 2, employees: migratedEmployees, devices: [], records, audit: { lastHash: null } }
  }

  async function loadNow() {
    await ensureDir(coreStateDir)
    const loadedV2 = await tryReadJson(STORE_FILE)
    if (loadedV2 && typeof loadedV2 === 'object') {
      state = {
        version: 2,
        employees: Array.isArray(loadedV2.employees) ? loadedV2.employees.filter(Boolean) : [],
        devices: Array.isArray(loadedV2.devices) ? loadedV2.devices.filter(Boolean) : [],
        records: Array.isArray(loadedV2.records) ? loadedV2.records.filter(Boolean) : [],
        audit: loadedV2.audit && typeof loadedV2.audit === 'object' ? loadedV2.audit : { lastHash: null }
      }
    } else {
      const loadedV1 = await tryReadJson(STORE_FILE_V1)
      if (loadedV1) {
        state = migrateFromV1(loadedV1)
        schedulePersist()
      }
    }

    faceCache.clear()
    for (const e of state.employees) {
      if (!e || typeof e !== 'object') continue
      const templates = Array.isArray(e.faceTemplates) ? e.faceTemplates : []
      if (!templates.length) continue
      if (!templatesKey) {
        const plain = templates.filter((t) => isNumberArray(t, 64, 1024)).slice(0, maxDescriptors)
        if (plain.length) faceCache.set(e.id, plain)
        continue
      }
      const out = []
      for (const enc of templates) {
        const dec = decryptJson(templatesKey, enc)
        if (isNumberArray(dec, 64, 1024)) out.push(dec)
        if (out.length >= maxDescriptors) break
      }
      if (out.length) faceCache.set(e.id, out)
    }
  }

  void loadNow()

  function findLastEmployeePunch(employeeId) {
    for (let i = state.records.length - 1; i >= 0; i--) {
      const r = state.records[i]
      if (r && r.kind === 'PUNCH' && r.employeeId === employeeId) return r
    }
    return null
  }

  function findExistingByIdempotency({ deviceId, employeeId, idempotencyKey }) {
    if (!idempotencyKey) return null
    for (let i = state.records.length - 1; i >= 0; i--) {
      const r = state.records[i]
      if (!r || r.kind !== 'PUNCH') continue
      if (String(r.idempotencyKey || '') !== idempotencyKey) continue
      if (deviceId && r.deviceId === deviceId) return r
      if (!deviceId && employeeId && r.employeeId === employeeId) return r
    }
    return null
  }

  function computePunchType(requestedType, employeeId) {
    const reqType = safeText(requestedType, 12).toUpperCase()
    const last = findLastEmployeePunch(employeeId)
    let type = reqType === 'IN' || reqType === 'OUT' ? reqType : 'AUTO'
    if (type === 'AUTO') type = last && last.type === 'IN' ? 'OUT' : 'IN'
    return type
  }

  function enforceCooldown(employeeId) {
    if (!punchCooldownSeconds) return { ok: true }
    const last = findLastEmployeePunch(employeeId)
    if (!last) return { ok: true }
    const lastMs = new Date(last.at).getTime()
    const nowMs = Date.now()
    if (!Number.isFinite(lastMs)) return { ok: true }
    const delta = Math.floor((nowMs - lastMs) / 1000)
    if (delta >= punchCooldownSeconds) return { ok: true }
    return { ok: false, secondsRemaining: Math.max(1, punchCooldownSeconds - delta), last }
  }

  function identifyFromDescriptor(descriptor, opts = {}) {
    const threshold = clampFloat(opts.threshold ?? faceThresholdDefault, 0.2, 1.5, faceThresholdDefault)

    let best = null
    let bestDistance = Number.POSITIVE_INFINITY
    const candidates = []

    for (const employee of state.employees) {
      if (!employee || employee.active === false || employee.deletedAt) continue
      const templates = faceCache.get(employee.id) || []
      if (!templates.length) continue
      for (const tpl of templates) {
        if (!isNumberArray(tpl, descriptor.length, descriptor.length)) continue
        const dist = l2(descriptor, tpl)
        if (dist < bestDistance) {
          bestDistance = dist
          best = employee
        }
        candidates.push({ employeeId: employee.id, name: employee.name, distance: dist })
      }
    }

    candidates.sort((a, b) => a.distance - b.distance)
    const topK = clampInt(opts.topK ?? 5, 1, 25, 5)
    const top = candidates.slice(0, topK)

    if (!best || !Number.isFinite(bestDistance) || bestDistance > threshold) {
      return { match: null, bestDistance: Number.isFinite(bestDistance) ? bestDistance : null, threshold, top }
    }
    return { match: { employeeId: best.id, name: best.name, distance: bestDistance }, bestDistance, threshold, top }
  }

  function applyCorrections(records, corrections) {
    const byTarget = new Map()
    for (const c of corrections) {
      if (!c || c.kind !== 'CORRECTION') continue
      const id = String(c.targetRecordId || '')
      if (!id) continue
      const existing = byTarget.get(id)
      if (!existing || String(existing.createdAt || '') < String(c.createdAt || '')) byTarget.set(id, c)
    }
    return records.map((r) => {
      const corr = byTarget.get(r.id)
      if (!corr) return { ...r, corrected: null }
      const next = { ...r }
      if (corr.newAt) next.at = corr.newAt
      if (corr.newType) next.type = corr.newType
      if (corr.newUnit !== undefined) next.unit = corr.newUnit
      next.corrected = { id: corr.id, at: corr.createdAt, reason: corr.reason || null }
      return next
    })
  }

  // -------------------------------------------------------------
  // Health (public)
  // -------------------------------------------------------------
  app.get('/api/ponto/health', async (req, res) => {
    res.json({
      ok: true,
      version: state.version,
      storeFile: STORE_FILE,
      auditFile: AUDIT_FILE,
      cryptoTemplates: !!templatesKey,
      cryptoAuditHmac: !!auditHmacKey,
      employees: state.employees.filter((e) => e && !e.deletedAt).length,
      devices: state.devices.filter((d) => d && !d.revokedAt).length,
      records: state.records.length
    })
  })

  // -------------------------------------------------------------
  // Admin APIs
  // -------------------------------------------------------------
  app.get('/api/ponto/admin/employees', async (req, res) => {
    const actor = requireAdmin(req, res)
    if (!actor) return
    res.json({ ok: true, data: state.employees.filter((e) => e && !e.deletedAt).map(publicEmployee) })
  })

  app.post('/api/ponto/admin/employees', async (req, res) => {
    const actor = requireAdmin(req, res)
    if (!actor) return
    const name = safeText(req.body?.name, 80)
    const code = safeText(req.body?.code, 40)
    const loginEmail = normalizeEmail(req.body?.loginEmail)
    if (!name) return res.status(400).json({ ok: false, error: 'NAME_REQUIRED' })

    const now = new Date().toISOString()
    const employee = {
      id: crypto.randomUUID(),
      code,
      name,
      loginEmail: loginEmail || '',
      active: true,
      createdAt: now,
      updatedAt: now,
      deletedAt: null,
      lastEnrolledAt: null,
      faceTemplates: [],
      pinHash: null,
      consent: {
        obtainedAt: safeText(req.body?.consentObtainedAt, 40) || now,
        version: safeText(req.body?.consentVersion, 40) || 'v1'
      }
    }
    state.employees.push(employee)
    schedulePersist()
    await enqueueWrite(() => writeAudit('EMPLOYEE_CREATE', { employeeId: employee.id, name: employee.name, code: employee.code }, actor))
    res.json({ ok: true, data: publicEmployee(employee) })
  })

  app.patch('/api/ponto/admin/employees/:id', async (req, res) => {
    const actor = requireAdmin(req, res)
    if (!actor) return
    const employee = findEmployee(req.params.id)
    if (!employee || employee.deletedAt) return res.status(404).json({ ok: false, error: 'NOT_FOUND' })
    const activeRaw = req.body?.active
    const nameRaw = req.body?.name
    const codeRaw = req.body?.code
    const loginEmailRaw = req.body?.loginEmail

    if (nameRaw !== undefined) {
      const name = safeText(nameRaw, 80)
      if (name) employee.name = name
    }

    if (codeRaw !== undefined) {
      const code = safeText(codeRaw, 40)
      employee.code = code
    }

    if (loginEmailRaw !== undefined) {
      const next = normalizeEmail(loginEmailRaw)
      const prev = normalizeEmail(employee.loginEmail)
      employee.loginEmail = next || ''
      await enqueueWrite(() =>
        writeAudit(next ? 'EMPLOYEE_LINK_LOGIN' : 'EMPLOYEE_UNLINK_LOGIN', { employeeId: employee.id, prev, next: next || '' }, actor)
      )
    }

    if (typeof activeRaw === 'boolean') employee.active = activeRaw
    employee.updatedAt = new Date().toISOString()
    schedulePersist()
    await enqueueWrite(() => writeAudit('EMPLOYEE_UPDATE', { employeeId: employee.id }, actor))
    res.json({ ok: true, data: publicEmployee(employee) })
  })

  app.delete('/api/ponto/admin/employees/:id', async (req, res) => {
    const actor = requireAdmin(req, res)
    if (!actor) return
    const employee = findEmployee(req.params.id)
    if (!employee || employee.deletedAt) return res.status(404).json({ ok: false, error: 'NOT_FOUND' })
    const now = new Date().toISOString()
    employee.deletedAt = now
    employee.active = false
    employee.updatedAt = now
    schedulePersist()
    await enqueueWrite(() => writeAudit('EMPLOYEE_DELETE', { employeeId: employee.id }, actor))
    res.json({ ok: true })
  })

  app.post('/api/ponto/admin/employees/:id/enroll', async (req, res) => {
    const actor = requireAdmin(req, res)
    if (!actor) return
    const employee = findEmployee(req.params.id)
    if (!employee || employee.deletedAt) return res.status(404).json({ ok: false, error: 'NOT_FOUND' })
    const consentConfirmed = req.body?.consentConfirmed === true
    if (!consentConfirmed) return res.status(400).json({ ok: false, error: 'CONSENT_REQUIRED' })

    const descriptors = req.body?.descriptors
    if (!Array.isArray(descriptors) || !descriptors.length) return res.status(400).json({ ok: false, error: 'DESCRIPTORS_REQUIRED' })
    const replace = req.body?.replace === true

    const accepted = []
    for (const d of descriptors) {
      if (!isNumberArray(d, 64, 1024)) continue
      accepted.push(d)
      if (accepted.length >= maxDescriptors) break
    }
    if (!accepted.length) return res.status(400).json({ ok: false, error: 'DESCRIPTORS_INVALID' })

    const existing = faceCache.get(employee.id) || []
    const merged = replace ? accepted : existing.concat(accepted)
    const trimmed = merged.slice(0, maxDescriptors)
    faceCache.set(employee.id, trimmed)

    employee.faceTemplates = templatesKey ? trimmed.map((d) => encryptJson(templatesKey, d)) : trimmed
    employee.lastEnrolledAt = new Date().toISOString()
    employee.updatedAt = employee.lastEnrolledAt
    schedulePersist()

    await enqueueWrite(() => writeAudit('EMPLOYEE_ENROLL_FACE', { employeeId: employee.id, replace, count: accepted.length }, actor))
    res.json({ ok: true, data: publicEmployee(employee) })
  })

  app.post('/api/ponto/admin/employees/:id/pin', async (req, res) => {
    const actor = requireAdmin(req, res)
    if (!actor) return
    const employee = findEmployee(req.params.id)
    if (!employee || employee.deletedAt) return res.status(404).json({ ok: false, error: 'NOT_FOUND' })
    const pin = safeText(req.body?.pin, 20)
    if (!pin || pin.length < 4) return res.status(400).json({ ok: false, error: 'PIN_INVALID' })
    employee.pinHash = hashPin(pin, null)
    employee.updatedAt = new Date().toISOString()
    schedulePersist()
    await enqueueWrite(() => writeAudit('EMPLOYEE_SET_PIN', { employeeId: employee.id }, actor))
    res.json({ ok: true, data: publicEmployee(employee) })
  })

  app.get('/api/ponto/admin/devices', async (req, res) => {
    const actor = requireAdmin(req, res)
    if (!actor) return
    res.json({ ok: true, data: state.devices.filter(Boolean).map(publicDevice) })
  })

  app.post('/api/ponto/admin/devices', async (req, res) => {
    const actor = requireAdmin(req, res)
    if (!actor) return
    const unit = safeText(req.body?.unit, 80)
    const label = safeText(req.body?.label, 80)
    if (!unit) return res.status(400).json({ ok: false, error: 'UNIT_REQUIRED' })
    const token = crypto.randomBytes(24).toString('base64url')
    const device = {
      id: crypto.randomUUID(),
      label,
      unit,
      tokenHash: sha256Hex(token),
      createdAt: new Date().toISOString(),
      revokedAt: null,
      lastSeenAt: null
    }
    state.devices.push(device)
    schedulePersist()
    await enqueueWrite(() => writeAudit('DEVICE_CREATE', { deviceId: device.id, unit, label }, actor))
    res.json({ ok: true, data: publicDevice(device), tokenOnce: token })
  })

  app.post('/api/ponto/admin/devices/:id/revoke', async (req, res) => {
    const actor = requireAdmin(req, res)
    if (!actor) return
    const deviceId = String(req.params.id || '')
    const device = state.devices.find((d) => d && d.id === deviceId) || null
    if (!device) return res.status(404).json({ ok: false, error: 'NOT_FOUND' })
    if (!device.revokedAt) {
      device.revokedAt = new Date().toISOString()
      schedulePersist()
      await enqueueWrite(() => writeAudit('DEVICE_REVOKE', { deviceId: device.id }, actor))
    }
    res.json({ ok: true, data: publicDevice(device) })
  })

  app.get('/api/ponto/admin/records', async (req, res) => {
    const actor = requireAdmin(req, res)
    if (!actor) return
    const from = safeText(req.query?.from, 30)
    const to = safeText(req.query?.to, 30)
    const employeeId = safeText(req.query?.employeeId, 80)
    const limit = clampInt(req.query?.limit, 1, 5000, 200)
    const includeCorrections = String(req.query?.includeCorrections || '1') !== '0'

    const fromMs = from ? new Date(from).getTime() : null
    const toMs = to ? new Date(to).getTime() : null

    const punches = []
    const corrections = []
    for (let i = state.records.length - 1; i >= 0; i--) {
      const r = state.records[i]
      if (!r) continue
      if (employeeId && r.employeeId !== employeeId && r.kind !== 'CORRECTION') continue
      const ms = new Date(r.at || r.createdAt).getTime()
      if (fromMs != null && Number.isFinite(fromMs) && ms < fromMs) continue
      if (toMs != null && Number.isFinite(toMs) && ms > toMs) continue
      if (r.kind === 'CORRECTION') corrections.push(r)
      if (r.kind === 'PUNCH') punches.push(r)
      if (punches.length >= limit && corrections.length >= limit) break
    }

    const out = includeCorrections ? applyCorrections(punches, corrections) : punches
    res.json({ ok: true, data: out, correctionsCount: includeCorrections ? corrections.length : 0 })
  })

  app.get('/api/ponto/admin/records.csv', async (req, res) => {
    const actor = requireAdmin(req, res)
    if (!actor) return
    const from = safeText(req.query?.from, 30)
    const to = safeText(req.query?.to, 30)
    const employeeId = safeText(req.query?.employeeId, 80)
    const includeCorrections = String(req.query?.includeCorrections || '1') !== '0'

    const fromMs = from ? new Date(from).getTime() : null
    const toMs = to ? new Date(to).getTime() : null

    const punches = []
    const corrections = []
    for (const r of state.records) {
      if (!r) continue
      if (employeeId && r.employeeId !== employeeId && r.kind !== 'CORRECTION') continue
      const ms = new Date(r.at || r.createdAt).getTime()
      if (fromMs != null && Number.isFinite(fromMs) && ms < fromMs) continue
      if (toMs != null && Number.isFinite(toMs) && ms > toMs) continue
      if (r.kind === 'CORRECTION') corrections.push(r)
      if (r.kind === 'PUNCH') punches.push(r)
    }

    const out = includeCorrections ? applyCorrections(punches, corrections) : punches

    const rows = []
    rows.push(['id', 'employeeId', 'employeeName', 'type', 'at', 'unit', 'deviceId', 'deviceLabel', 'ip', 'method', 'matchDistance', 'note', 'correctedId', 'correctedAt', 'correctedReason'].join(','))
    for (const r of out) {
      const corrected = r.corrected || null
      rows.push([
        toCsvCell(r.id),
        toCsvCell(r.employeeId),
        toCsvCell(r.employeeName),
        toCsvCell(r.type),
        toCsvCell(r.at),
        toCsvCell(r.unit || ''),
        toCsvCell(r.deviceId || ''),
        toCsvCell(r.deviceLabel || ''),
        toCsvCell(r.ip || ''),
        toCsvCell(r.method || ''),
        toCsvCell(r.matchDistance ?? ''),
        toCsvCell(r.note || ''),
        toCsvCell(corrected?.id || ''),
        toCsvCell(corrected?.at || ''),
        toCsvCell(corrected?.reason || '')
      ].join(','))
    }

    res.status(200)
    res.setHeader('content-type', 'text/csv; charset=utf-8')
    res.setHeader('content-disposition', 'attachment; filename=\"ponto_records.csv\"')
    res.end(rows.join('\n'))
  })

  app.post('/api/ponto/admin/punch', async (req, res) => {
    const actor = requireAdmin(req, res)
    if (!actor) return
    const employeeId = safeText(req.body?.employeeId, 80)
    const employee = findEmployee(employeeId)
    if (!employee || employee.active === false || employee.deletedAt) return res.status(404).json({ ok: false, error: 'EMPLOYEE_NOT_FOUND' })

    const idempotencyKey = getIdempotencyKey(req)
    const existing = findExistingByIdempotency({ deviceId: null, employeeId: employee.id, idempotencyKey })
    if (existing) return res.json({ ok: true, data: existing, employee: publicEmployee(employee), idempotent: true })

    const cooldown = enforceCooldown(employee.id)
    if (!cooldown.ok) return res.status(409).json({ ok: false, error: 'COOLDOWN', secondsRemaining: cooldown.secondsRemaining, last: cooldown.last })

    const type = computePunchType(req.body?.type, employee.id)
    const unit = safeText(req.body?.unit, 80) || null
    const note = safeText(req.body?.note, 240) || null
    const now = new Date().toISOString()

    const record = {
      id: crypto.randomUUID(),
      kind: 'PUNCH',
      employeeId: employee.id,
      employeeName: employee.name,
      type,
      at: now,
      client: getClientTimeMeta(req),
      unit,
      deviceId: null,
      deviceLabel: null,
      ip: getClientIp(req),
      userAgent: safeText(req.headers['user-agent'], 220) || null,
      matchDistance: null,
      method: 'ADMIN',
      geo: null,
      liveness: null,
      note,
      idempotencyKey: idempotencyKey || null,
      createdAt: now
    }

    state.records.push(record)
    schedulePersist()
    await enqueueWrite(() => writeAudit('PUNCH_ADMIN', { recordId: record.id, employeeId: employee.id, type, unit, note }, actor))
    res.json({ ok: true, data: record, employee: publicEmployee(employee) })
  })

  app.post('/api/ponto/admin/corrections', async (req, res) => {
    const actor = requireAdmin(req, res)
    if (!actor) return
    const targetRecordId = safeText(req.body?.targetRecordId, 80)
    if (!targetRecordId) return res.status(400).json({ ok: false, error: 'TARGET_REQUIRED' })

    const target = state.records.find((r) => r && r.kind === 'PUNCH' && r.id === targetRecordId) || null
    if (!target) return res.status(404).json({ ok: false, error: 'TARGET_NOT_FOUND' })

    const newAt = safeText(req.body?.newAt, 40) || null
    const newType = safeText(req.body?.newType, 12).toUpperCase() || null
    const newUnit = req.body?.newUnit === null ? null : (safeText(req.body?.newUnit, 80) || undefined)
    const reason = safeText(req.body?.reason, 240) || null

    if (!newAt && !newType && newUnit === undefined) return res.status(400).json({ ok: false, error: 'NO_CHANGES' })
    if (newType && newType !== 'IN' && newType !== 'OUT') return res.status(400).json({ ok: false, error: 'TYPE_INVALID' })
    if (newAt) {
      const ms = new Date(newAt).getTime()
      if (!Number.isFinite(ms)) return res.status(400).json({ ok: false, error: 'DATE_INVALID' })
    }

    const now = new Date().toISOString()
    const correction = {
      id: crypto.randomUUID(),
      kind: 'CORRECTION',
      employeeId: target.employeeId,
      employeeName: target.employeeName,
      targetRecordId,
      newAt: newAt || null,
      newType: newType || null,
      newUnit: newUnit,
      reason,
      createdAt: now,
      at: now,
      method: 'ADMIN',
      ip: getClientIp(req),
      userAgent: safeText(req.headers['user-agent'], 220) || null
    }

    state.records.push(correction)
    schedulePersist()
    await enqueueWrite(() => writeAudit('PUNCH_CORRECTION', { correctionId: correction.id, targetRecordId, employeeId: correction.employeeId }, actor))
    res.json({ ok: true, data: correction })
  })

  app.get('/api/ponto/admin/audit/tail', async (req, res) => {
    const actor = requireAdmin(req, res)
    if (!actor) return
    const lines = clampInt(req.query?.lines, 10, 2000, 200)
    try {
      const raw = await fs.readFile(AUDIT_FILE, 'utf-8')
      const all = raw.split('\n').filter(Boolean)
      const tail = all.slice(Math.max(0, all.length - lines)).map((l) => {
        try { return JSON.parse(l) } catch { return { raw: l } }
      })
      res.json({ ok: true, lines, tail, lastHash: state.audit?.lastHash || null })
    } catch {
      res.json({ ok: true, lines, tail: [], lastHash: state.audit?.lastHash || null })
    }
  })

  app.get('/api/ponto/admin/audit/verify', async (req, res) => {
    const actor = requireAdmin(req, res)
    if (!actor) return
    const fromLine = clampInt(req.query?.fromLine, 0, Number.MAX_SAFE_INTEGER, 0)
    try {
      const raw = await fs.readFile(AUDIT_FILE, 'utf-8')
      const lines = raw.split('\n').filter(Boolean)
      let prevHash = null
      for (let i = 0; i < lines.length; i++) {
        if (i < fromLine) continue
        let ev = null
        try {
          ev = JSON.parse(lines[i])
        } catch {
          return res.status(200).json({ ok: false, error: 'INVALID_JSON', index: i })
        }
        const { hash, hmac, ...payload } = ev
        const expectedPrev = payload.prevHash || null
        if (expectedPrev !== prevHash) {
          return res.status(200).json({ ok: false, error: 'CHAIN_BROKEN', index: i, expectedPrev, actualPrev: prevHash })
        }
        const hashInput = (prevHash || '') + '\n' + stableStringify(payload)
        const expectedHash = sha256Hex(hashInput)
        if (String(hash || '') !== expectedHash) {
          return res.status(200).json({ ok: false, error: 'HASH_MISMATCH', index: i })
        }
        if (auditHmacKey) {
          const expectedHmac = crypto.createHmac('sha256', auditHmacKey).update(hashInput).digest('hex')
          if (String(hmac || '') !== expectedHmac) {
            return res.status(200).json({ ok: false, error: 'HMAC_MISMATCH', index: i })
          }
        }
        prevHash = expectedHash
      }
      res.json({ ok: true, count: Math.max(0, lines.length - fromLine), lastHash: prevHash })
    } catch (e) {
      res.status(500).json({ ok: false, error: e?.message || String(e) })
    }
  })

  // -------------------------------------------------------------
  // Employee APIs (self-service via Pages proxy actor headers)
  // -------------------------------------------------------------
  app.get('/api/ponto/me', async (req, res) => {
    const actor = requireEmployee(req, res)
    if (!actor) return
    const email = actor.label
    const employee = findEmployeeByLoginEmail(email)
    if (!employee) {
      return res.json({
        ok: true,
        linked: false,
        actorEmail: email,
        hint: 'Seu usuário ainda não está vinculado a um funcionário. Peça ao admin para definir o email no cadastro do funcionário.'
      })
    }
    const lastPunch = findLastEmployeePunch(employee.id)
    const cooldown = enforceCooldown(employee.id)
    const hasFace = (faceCache.get(employee.id) || []).length > 0
    return res.json({
      ok: true,
      linked: true,
      actorEmail: email,
      employee: publicEmployee(employee),
      hasFace,
      pinSet: !!employee.pinHash,
      lastPunch: lastPunch || null,
      cooldown: cooldown.ok ? { active: false } : { active: true, secondsRemaining: cooldown.secondsRemaining, last: cooldown.last },
      suggestedNextMethod: hasFace ? 'FACE' : 'PIN'
    })
  })

  app.get('/api/ponto/me/records', async (req, res) => {
    const actor = requireEmployee(req, res)
    if (!actor) return
    const email = actor.label
    const employee = findEmployeeByLoginEmail(email)
    if (!employee) return res.status(404).json({ ok: false, error: 'EMPLOYEE_NOT_LINKED' })
    const from = safeText(req.query?.from, 30)
    const to = safeText(req.query?.to, 30)
    const limit = clampInt(req.query?.limit, 1, 2000, 200)
    const includeCorrections = String(req.query?.includeCorrections || '1') !== '0'

    const fromMs = from ? new Date(from).getTime() : null
    const toMs = to ? new Date(to).getTime() : null

    const punches = []
    const corrections = []
    for (let i = state.records.length - 1; i >= 0; i--) {
      const r = state.records[i]
      if (!r) continue
      if (r.employeeId !== employee.id && r.kind !== 'CORRECTION') continue
      if (r.kind === 'CORRECTION' && r.employeeId !== employee.id) continue
      const ms = new Date(r.at || r.createdAt).getTime()
      if (fromMs != null && Number.isFinite(fromMs) && ms < fromMs) continue
      if (toMs != null && Number.isFinite(toMs) && ms > toMs) continue
      if (r.kind === 'CORRECTION') corrections.push(r)
      if (r.kind === 'PUNCH') punches.push(r)
      if (punches.length >= limit && corrections.length >= limit) break
    }
    const out = includeCorrections ? applyCorrections(punches, corrections) : punches
    res.json({ ok: true, data: out, correctionsCount: includeCorrections ? corrections.length : 0 })
  })

  app.post('/api/ponto/me/punch', async (req, res) => {
    const actor = requireEmployee(req, res)
    if (!actor) return
    const email = actor.label
    const employee = findEmployeeByLoginEmail(email)
    if (!employee) return res.status(404).json({ ok: false, error: 'EMPLOYEE_NOT_LINKED' })

    const idempotencyKey = getIdempotencyKey(req)
    const existing = findExistingByIdempotency({ deviceId: null, employeeId: employee.id, idempotencyKey })
    if (existing) return res.json({ ok: true, data: existing, employee: publicEmployee(employee), idempotent: true })

    const cooldown = enforceCooldown(employee.id)
    if (!cooldown.ok) return res.status(409).json({ ok: false, error: 'COOLDOWN', secondsRemaining: cooldown.secondsRemaining, last: cooldown.last })

    const descriptor = req.body?.descriptor
    const pin = safeText(req.body?.pin, 20)
    const hasFace = (faceCache.get(employee.id) || []).length > 0

    let method = null
    let matchDistance = null

    if (descriptor !== undefined) {
      if (!isNumberArray(descriptor, 64, 1024)) return res.status(400).json({ ok: false, error: 'DESCRIPTOR_INVALID' })
      if (hasFace) {
        const match = matchEmployeeDescriptor(employee.id, descriptor, { threshold: req.body?.threshold })
        if (!match.ok) return res.status(401).json({ ok: false, error: match.code, next: 'PIN', threshold: match.threshold, bestDistance: match.bestDistance ?? null })
        method = 'FACE'
        matchDistance = match.bestDistance
      }
    }

    if (!method && pin) {
      if (!employee.pinHash) return res.status(400).json({ ok: false, error: 'PIN_NOT_SET' })
      if (!verifyPin(pin, employee.pinHash)) return res.status(401).json({ ok: false, error: 'PIN_INVALID' })
      method = 'PIN'
    }

    if (!method) {
      return res.status(400).json({ ok: false, error: 'NEXT_METHOD_REQUIRED', next: hasFace ? 'FACE' : 'PIN' })
    }

    const type = computePunchType(req.body?.type, employee.id)
    const unit = safeText(req.body?.unit, 80) || null
    const note = safeText(req.body?.note, 240) || null
    const now = new Date().toISOString()

    const record = {
      id: crypto.randomUUID(),
      kind: 'PUNCH',
      employeeId: employee.id,
      employeeName: employee.name,
      type,
      at: now,
      client: getClientTimeMeta(req),
      unit,
      deviceId: null,
      deviceLabel: null,
      ip: getClientIp(req),
      userAgent: safeText(req.headers['user-agent'], 220) || null,
      matchDistance,
      method,
      geo: null,
      liveness: null,
      note,
      idempotencyKey: idempotencyKey || null,
      createdAt: now
    }

    state.records.push(record)
    schedulePersist()
    await enqueueWrite(() => writeAudit(method === 'FACE' ? 'PUNCH_FACE' : 'PUNCH_PIN', { recordId: record.id, employeeId: employee.id, type, unit }, actor))
    res.json({ ok: true, data: record, employee: publicEmployee(employee) })
  })

  // -------------------------------------------------------------
  // Device APIs
  // -------------------------------------------------------------
  app.get('/api/ponto/device/employees', async (req, res) => {
    const ctx = requireDevice(req, res)
    if (!ctx) return
    const employees = state.employees
      .filter((e) => e && !e.deletedAt && e.active !== false)
      .map((e) => {
        const cached = faceCache.get(e.id)
        return { id: e.id, code: e.code || '', name: e.name, hasFace: Array.isArray(cached) && cached.length > 0, pinSet: !!e.pinHash }
      })
    res.json({ ok: true, unit: ctx.device.unit, device: publicDevice(ctx.device), data: employees })
  })

  app.post('/api/ponto/device/identify', async (req, res) => {
    const ctx = requireDevice(req, res)
    if (!ctx) return
    const descriptor = req.body?.descriptor
    if (!isNumberArray(descriptor, 64, 1024)) return res.status(400).json({ ok: false, error: 'DESCRIPTOR_INVALID' })
    const out = identifyFromDescriptor(descriptor, { threshold: req.body?.threshold, topK: req.body?.topK })
    res.json({ ok: true, ...out })
  })

  app.post('/api/ponto/device/punch/face', async (req, res) => {
    const ctx = requireDevice(req, res)
    if (!ctx) return
    const idempotencyKey = getIdempotencyKey(req)
    const existing = findExistingByIdempotency({ deviceId: ctx.device.id, employeeId: null, idempotencyKey })
    if (existing) return res.json({ ok: true, data: existing, employee: publicEmployee(findEmployee(existing.employeeId) || { id: existing.employeeId }), idempotent: true })

    const descriptor = req.body?.descriptor
    if (!isNumberArray(descriptor, 64, 1024)) return res.status(400).json({ ok: false, error: 'DESCRIPTOR_INVALID' })

    const identify = identifyFromDescriptor(descriptor, { threshold: req.body?.threshold, topK: 5 })
    if (!identify.match) {
      return res.status(401).json({ ok: false, error: 'NOT_RECOGNIZED', bestDistance: identify.bestDistance, threshold: identify.threshold, top: identify.top })
    }

    const employee = findEmployee(identify.match.employeeId)
    if (!employee || employee.active === false || employee.deletedAt) return res.status(404).json({ ok: false, error: 'EMPLOYEE_INACTIVE' })

    const cooldown = enforceCooldown(employee.id)
    if (!cooldown.ok) return res.status(409).json({ ok: false, error: 'COOLDOWN', secondsRemaining: cooldown.secondsRemaining, last: cooldown.last })

    const type = computePunchType(req.body?.type, employee.id)

    const geo = req.body?.geo && typeof req.body.geo === 'object'
      ? {
        lat: clampFloat(req.body.geo.lat, -90, 90, null),
        lng: clampFloat(req.body.geo.lng, -180, 180, null),
        accuracy: clampFloat(req.body.geo.accuracy, 0, 100000, null)
      }
      : null

    const liveness = req.body?.liveness && typeof req.body.liveness === 'object'
      ? {
        mode: safeText(req.body.liveness.mode, 40) || null,
        ok: req.body.liveness.ok === true,
        detail: safeText(req.body.liveness.detail, 120) || null
      }
      : null

    const now = new Date().toISOString()
    const record = {
      id: crypto.randomUUID(),
      kind: 'PUNCH',
      employeeId: employee.id,
      employeeName: employee.name,
      type,
      at: now,
      client: getClientTimeMeta(req),
      unit: ctx.device.unit,
      deviceId: ctx.device.id,
      deviceLabel: ctx.device.label || null,
      ip: getClientIp(req),
      userAgent: safeText(req.headers['user-agent'], 220) || null,
      matchDistance: identify.match.distance,
      method: 'FACE',
      geo,
      liveness,
      note: null,
      idempotencyKey: idempotencyKey || null,
      createdAt: now
    }

    state.records.push(record)
    schedulePersist()
    await enqueueWrite(() => writeAudit('PUNCH_FACE', { recordId: record.id, employeeId: employee.id, type, unit: ctx.device.unit }, ctx.actor))
    res.json({ ok: true, data: record, employee: publicEmployee(employee) })
  })

  app.post('/api/ponto/device/punch/pin', async (req, res) => {
    const ctx = requireDevice(req, res)
    if (!ctx) return
    const idempotencyKey = getIdempotencyKey(req)
    const existing = findExistingByIdempotency({ deviceId: ctx.device.id, employeeId: null, idempotencyKey })
    if (existing) return res.json({ ok: true, data: existing, employee: publicEmployee(findEmployee(existing.employeeId) || { id: existing.employeeId }), idempotent: true })

    const employeeId = safeText(req.body?.employeeId, 80)
    const pin = safeText(req.body?.pin, 20)
    const employee = findEmployee(employeeId)
    if (!employee || employee.active === false || employee.deletedAt) return res.status(404).json({ ok: false, error: 'EMPLOYEE_NOT_FOUND' })
    if (!employee.pinHash) return res.status(400).json({ ok: false, error: 'PIN_NOT_SET' })
    if (!verifyPin(pin, employee.pinHash)) return res.status(401).json({ ok: false, error: 'PIN_INVALID' })

    const cooldown = enforceCooldown(employee.id)
    if (!cooldown.ok) return res.status(409).json({ ok: false, error: 'COOLDOWN', secondsRemaining: cooldown.secondsRemaining, last: cooldown.last })

    const type = computePunchType(req.body?.type, employee.id)

    const now = new Date().toISOString()
    const record = {
      id: crypto.randomUUID(),
      kind: 'PUNCH',
      employeeId: employee.id,
      employeeName: employee.name,
      type,
      at: now,
      client: getClientTimeMeta(req),
      unit: ctx.device.unit,
      deviceId: ctx.device.id,
      deviceLabel: ctx.device.label || null,
      ip: getClientIp(req),
      userAgent: safeText(req.headers['user-agent'], 220) || null,
      matchDistance: null,
      method: 'PIN',
      geo: null,
      liveness: null,
      note: safeText(req.body?.note, 120) || 'PIN fallback',
      idempotencyKey: idempotencyKey || null,
      createdAt: now
    }

    state.records.push(record)
    schedulePersist()
    await enqueueWrite(() => writeAudit('PUNCH_PIN', { recordId: record.id, employeeId: employee.id, type, unit: ctx.device.unit }, ctx.actor))
    res.json({ ok: true, data: record, employee: publicEmployee(employee) })
  })
}
