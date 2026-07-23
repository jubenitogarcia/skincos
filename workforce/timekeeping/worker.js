import { canonicalEventType, calculateDay, calculatePeriod, isoDateInZone } from './domain.js'
import { biometricDistance, constantTimeEqual, decryptSensitiveText, decryptTemplate, encryptSensitiveText, encryptTemplate, hashPin, isValidBiometricTemplate, sha256, signHmac, verifyPin } from './security.js'
import { readModuleAvailability, moduleUnavailableResponse } from '../../shared/module-availability/worker.js'
import { dependencyState, operationalStatus } from '../../shared/observability/contract.js'

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

const hmac = signHmac

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
function normalizeWorkforceRole(value) {
  const raw = String(value || '').trim().toUpperCase()
  if (raw === 'RH' || raw === 'AUDITOR') return 'SUPERVISOR'
  if (raw === 'EMPLOYEE') return 'CONSULTOR'
  return raw || 'CONSULTOR'
}
function isConsultor(actor) { return actor?.role === 'CONSULTOR' }
function canManageWorkforce(actor) { return actor?.role === 'SUPERVISOR' || actor?.role === 'ADMIN' }
function isFacePunchEnabled(env) { return String(env?.PONTO_FACE_PUNCH_ENABLED || '').trim().toLowerCase() === 'true' }
function normalizeNetworkPolicy(value) { return ['NONE', 'OBSERVE', 'REQUIRE'].includes(String(value || '').trim().toUpperCase()) ? String(value).trim().toUpperCase() : 'NONE' }
function normalizePresenceMode(value) { return ['TERMINAL_REQUIRED', 'EXTERNAL_REVIEW', 'FLEXIBLE'].includes(String(value || '').trim().toUpperCase()) ? String(value).trim().toUpperCase() : 'FLEXIBLE' }
function ipv4ToInt(value) {
  const parts = String(value || '').trim().split('.')
  if (parts.length !== 4 || parts.some((part) => !/^\d{1,3}$/.test(part) || Number(part) > 255)) return null
  return parts.reduce((out, part) => ((out << 8) | Number(part)) >>> 0, 0)
}
function normalizeNetworks(value) {
  const values = Array.isArray(value) ? value : String(value || '').split(',')
  const output = []
  for (const raw of values.slice(0, 16)) {
    const [ip, bitsRaw] = String(raw || '').trim().split('/')
    const bits = Number(bitsRaw)
    if (ipv4ToInt(ip) === null || !Number.isInteger(bits) || bits < 0 || bits > 32) continue
    output.push(`${ip}/${bits}`)
  }
  return Array.from(new Set(output))
}
function storedNetworks(value) { try { return normalizeNetworks(JSON.parse(String(value || '[]'))) } catch { return [] } }
function ipInNetwork(ip, cidr) {
  const candidate = ipv4ToInt(ip); const [network, bitsRaw] = String(cidr || '').split('/'); const base = ipv4ToInt(network); const bits = Number(bitsRaw)
  if (candidate === null || base === null || !Number.isInteger(bits) || bits < 0 || bits > 32) return false
  if (bits === 0) return true
  const mask = (0xffffffff << (32 - bits)) >>> 0
  return (candidate & mask) === (base & mask)
}
function metersBetween(left, right) {
  const rad = (value) => Number(value) * Math.PI / 180
  const latitude = rad(Number(right.latitude) - Number(left.latitude)); const longitude = rad(Number(right.longitude) - Number(left.longitude))
  const a = Math.sin(latitude / 2) ** 2 + Math.cos(rad(left.latitude)) * Math.cos(rad(right.latitude)) * Math.sin(longitude / 2) ** 2
  return Math.round(6371008.8 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)))
}
function locationEvidence(location, policy) {
  if (!location || typeof location !== 'object') return { error: 'LOCATION_REQUIRED' }
  const latitude = Number(location.latitude); const longitude = Number(location.longitude); const accuracy = Number(location.accuracyMeters)
  const capturedAt = Date.parse(String(location.capturedAt || ''))
  if (!Number.isFinite(latitude) || latitude < -90 || latitude > 90 || !Number.isFinite(longitude) || longitude < -180 || longitude > 180 || !Number.isFinite(accuracy) || accuracy < 0 || accuracy > 10000 || !Number.isFinite(capturedAt) || Math.abs(Date.now() - capturedAt) > 5 * 60 * 1000) return { error: 'LOCATION_INVALID' }
  if (!Number.isFinite(Number(policy.geofence_latitude)) || !Number.isFinite(Number(policy.geofence_longitude))) return { error: 'LOCATION_POLICY_UNCONFIGURED' }
  const distanceMeters = metersBetween({ latitude, longitude }, { latitude: policy.geofence_latitude, longitude: policy.geofence_longitude })
  const within = distanceMeters <= Number(policy.geofence_radius_meters || 150) + accuracy
  return { status: within ? 'WITHIN_GEOFENCE' : 'OUTSIDE_GEOFENCE_REVIEW', payload: { accuracyMeters: Math.round(accuracy), distanceMeters, geofenceRadiusMeters: Number(policy.geofence_radius_meters || 150) } }
}
function roleAllows(role, action) {
  const matrix = {
    CONSULTOR: ['self.read', 'self.punch', 'self.profile.read', 'self.profile.write'], DEVICE: ['device.punch'],
    MANAGER: ['unit.read', 'correction.request', 'device.manage'],
    SUPERVISOR: ['unit.read', 'correction.request', 'correction.approve', 'period.close', 'period.reopen', 'export.read', 'audit.read', 'profile.read', 'profile.manage'],
    ADMIN: ['unit.read', 'correction.request', 'correction.approve', 'period.close', 'period.reopen', 'device.manage', 'export.read', 'audit.read', 'profile.read', 'profile.manage'],
  }
  return (matrix[normalizeWorkforceRole(role)] || []).includes(action)
}

async function actorFor(request, env, db, bodyHash) {
  const authorization = String(request.headers.get('authorization') || '')
  if (/^Device\s+/i.test(authorization)) {
    const tokenHash = await sha256(authorization.replace(/^Device\s+/i, '').trim())
    const device = await db.prepare('SELECT id, unit_id, label, device_mode, network_policy, allowed_networks_json FROM timekeeping_devices WHERE token_hash=? AND active=1 AND revoked_at IS NULL LIMIT 1').bind(tokenHash).first()
    if (!device) return null
    await db.prepare('UPDATE timekeeping_devices SET last_seen_at=? WHERE id=?').bind(now(), device.id).run()
    const networks = storedNetworks(device.allowed_networks_json)
    return { id: device.id, email: `device:${device.id}@internal`, role: 'DEVICE', allowedUnits: [device.unit_id], name: device.label || device.id, deviceId: device.id, deviceMode: String(device.device_mode || 'TERMINAL'), networkPolicy: normalizeNetworkPolicy(device.network_policy), allowedNetworks: networks }
  }
  const raw = String(request.headers.get('x-skincos-actor') || '')
  const timestamp = String(request.headers.get('x-skincos-actor-ts') || '')
  const signature = String(request.headers.get('x-skincos-actor-sig') || '')
  const signatureVersion = String(request.headers.get('x-skincos-signature-version') || '')
  const nonce = cleanText(request.headers.get('x-request-nonce') || request.headers.get('x-idempotency-key') || request.headers.get('idempotency-key'), 180)
  const secret = String(env.PONTO_ACTOR_HMAC_KEY || '')
  if (!raw || !timestamp || !signature || !secret || signatureVersion !== '2') return null
  const ms = Number(timestamp)
  if (!Number.isFinite(ms) || Math.abs(Date.now() - ms) > 300000) return null
  const url = new URL(request.url)
  const expected = await hmac(secret, [timestamp, raw, request.method.toUpperCase(), `${url.pathname}${url.search}`, nonce, bodyHash].join('.'))
  if (!equal(expected, signature)) return null
  try {
    const parsed = JSON.parse(b64Url(raw))
    if (!parsed?.id || !parsed?.email) return null
    return { id: String(parsed.id), email: String(parsed.email).toLowerCase(), role: normalizeWorkforceRole(parsed.role), allowedUnits: normalizeUnits(parsed.allowedUnits), name: String(parsed.name || '') }
  } catch { return null }
}

function requireUnit(actor, unitId) {
  return actor.role === 'ADMIN' || actor.allowedUnits.includes(String(unitId || ''))
}

function publicEmployee(row) {
  return row ? { id: row.id, employeeId: row.canonical_employee_id, name: row.display_name, email: row.login_email || null, status: row.status, terminatedAt: row.terminated_at || null } : null
}

const profilePrivateFields = ['cpf', 'mobilePhone', 'pis', 'rgNumber', 'rgIssuer', 'rgIssuerState', 'rgIssuedAt', 'motherName', 'fatherName', 'zipCode', 'street', 'addressNumber', 'addressComplement', 'neighborhood']
const profilePublicFields = ['socialName', 'personalEmail', 'groupName', 'departmentName', 'managerEmployeeId', 'managerCpf', 'admittedAt', 'dismissedAt', 'birthPlace', 'educationLevel', 'city', 'state']
const profileSelfPublicFields = ['socialName', 'personalEmail', 'birthPlace', 'educationLevel', 'city', 'state']
const profileSelfPrivateFields = ['mobilePhone', 'zipCode', 'street', 'addressNumber', 'addressComplement', 'neighborhood']

function profileInput(body, allowedPublic = profilePublicFields, allowedPrivate = profilePrivateFields) {
  const input = body?.profile && typeof body.profile === 'object' && !Array.isArray(body.profile) ? body.profile : body
  const publicPatch = {}; const privatePatch = {}; const provided = []
  for (const field of allowedPublic) {
    if (input?.[field] === undefined) continue
    provided.push(field)
    if (field === 'admittedAt' || field === 'dismissedAt') publicPatch[field] = dateOnly(input[field]) || null
    else if (field === 'managerCpf') publicPatch[field] = String(input[field] || '').replace(/\D/g, '') || null
    else publicPatch[field] = cleanText(input[field], field === 'personalEmail' ? 240 : 180) || null
  }
  for (const field of allowedPrivate) {
    if (input?.[field] === undefined) continue
    provided.push(field)
    const value = cleanText(input[field], 500)
    privatePatch[field] = field === 'cpf' ? value.replace(/\D/g, '') : value || null
  }
  return { publicPatch, privatePatch, provided }
}

async function profilePrivateData(profile, env) {
  if (!profile?.private_data_encrypted) return {}
  if (!env.PONTO_PROFILE_DATA_KEY) return {}
  const parsed = JSON.parse(await decryptSensitiveText(profile.private_data_encrypted, env.PONTO_PROFILE_DATA_KEY))
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('PROFILE_DATA_INVALID')
  return Object.fromEntries(profilePrivateFields.map((field) => [field, typeof parsed[field] === 'string' ? parsed[field] : null]))
}

function profileDocumentStatus(privateData = {}, employee = null) {
  return {
    cpf: privateData.cpf || employee?.cpf_hash ? 'CADASTRADO' : 'PENDENTE',
    pis: privateData.pis ? 'CADASTRADO' : 'PENDENTE',
    rg: privateData.rgNumber ? 'CADASTRADO' : 'PENDENTE',
    family: privateData.motherName || privateData.fatherName ? 'CADASTRADO' : 'PENDENTE',
  }
}

async function profileResponse(db, env, employee) {
  const profile = await db.prepare('SELECT * FROM workforce_employee_profiles WHERE employee_id=?').bind(employee.id).first()
  const privateData = profile ? await profilePrivateData(profile, env) : {}
  const units = await employeeUnits(db, employee.id)
  const manager = profile?.manager_employee_id
    ? await db.prepare('SELECT id, display_name, canonical_employee_id FROM workforce_employees WHERE id=?').bind(profile.manager_employee_id).first()
    : null
  const data = {
    employeeId: employee.canonical_employee_id,
    legalName: employee.display_name,
    socialName: profile?.social_name || null,
    employeeCode: employee.employee_code || null,
    loginEmail: employee.login_email || null,
    personalEmail: profile?.personal_email || null,
    mobilePhone: privateData.mobilePhone || null,
    jobTitle: employee.job_title || null,
    status: employee.status,
    admittedAt: profile?.admitted_at || null,
    dismissedAt: profile?.dismissed_at || employee.terminated_at || null,
    groupName: profile?.group_name || null,
    departmentName: profile?.department_name || null,
    manager: manager ? { employeeId: manager.canonical_employee_id, name: manager.display_name } : null,
    units,
    birthDate: employee.birth_date || null,
    birthPlace: profile?.birth_place || null,
    educationLevel: profile?.education_level || null,
    address: { zipCode: privateData.zipCode || null, street: privateData.street || null, number: privateData.addressNumber || null, complement: privateData.addressComplement || null, neighborhood: privateData.neighborhood || null, city: profile?.city || null, state: profile?.state || null },
    documents: profileDocumentStatus(privateData, employee),
  }
  const required = ['legalName', 'employeeCode', 'jobTitle', 'admittedAt', 'groupName', 'departmentName', 'mobilePhone', 'birthDate', 'birthPlace', 'educationLevel', 'zipCode', 'city', 'state']
  const missing = required.filter((field) => field === 'zipCode' ? !privateData.zipCode : !data[field])
  return { profile: data, completeness: { missing, complete: required.filter((field) => !missing.includes(field)), documents: profileDocumentStatus(privateData, employee) } }
}

async function saveProfile(db, env, actor, employee, patch, requestId) {
  const current = await db.prepare('SELECT * FROM workforce_employee_profiles WHERE employee_id=?').bind(employee.id).first()
  let existingPrivate = {}
  const hasPrivateUpdate = Object.keys(patch.privatePatch).length > 0
  if (hasPrivateUpdate && !env.PONTO_PROFILE_DATA_KEY) throw new Error('PROFILE_DATA_KEY_NOT_CONFIGURED')
  if (current?.private_data_encrypted && hasPrivateUpdate) existingPrivate = await profilePrivateData(current, env)
  const mergedPrivate = { ...existingPrivate, ...patch.privatePatch }
  const privateDataEncrypted = hasPrivateUpdate
    ? await encryptSensitiveText(JSON.stringify(mergedPrivate), env.PONTO_PROFILE_DATA_KEY)
    : current?.private_data_encrypted || null
  const values = {
    socialName: patch.publicPatch.socialName === undefined ? current?.social_name || null : patch.publicPatch.socialName,
    personalEmail: patch.publicPatch.personalEmail === undefined ? current?.personal_email || null : patch.publicPatch.personalEmail,
    groupName: patch.publicPatch.groupName === undefined ? current?.group_name || null : patch.publicPatch.groupName,
    departmentName: patch.publicPatch.departmentName === undefined ? current?.department_name || null : patch.publicPatch.departmentName,
    managerEmployeeId: patch.publicPatch.managerEmployeeId === undefined ? current?.manager_employee_id || null : patch.publicPatch.managerEmployeeId,
    managerCpfHash: patch.publicPatch.managerCpf === undefined ? current?.manager_cpf_hash || null : (patch.publicPatch.managerCpf ? await sha256(patch.publicPatch.managerCpf) : null),
    admittedAt: patch.publicPatch.admittedAt === undefined ? current?.admitted_at || null : patch.publicPatch.admittedAt,
    dismissedAt: patch.publicPatch.dismissedAt === undefined ? current?.dismissed_at || null : patch.publicPatch.dismissedAt,
    birthPlace: patch.publicPatch.birthPlace === undefined ? current?.birth_place || null : patch.publicPatch.birthPlace,
    educationLevel: patch.publicPatch.educationLevel === undefined ? current?.education_level || null : patch.publicPatch.educationLevel,
    city: patch.publicPatch.city === undefined ? current?.city || null : patch.publicPatch.city,
    state: patch.publicPatch.state === undefined ? current?.state || null : patch.publicPatch.state,
  }
  const at = now()
  await db.batch([
    db.prepare(`INSERT INTO workforce_employee_profiles (employee_id, social_name, personal_email, group_name, department_name, manager_employee_id, manager_cpf_hash, admitted_at, dismissed_at, birth_place, education_level, city, state, private_data_encrypted, created_at, updated_at, updated_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(employee_id) DO UPDATE SET social_name=excluded.social_name, personal_email=excluded.personal_email, group_name=excluded.group_name, department_name=excluded.department_name, manager_employee_id=excluded.manager_employee_id, manager_cpf_hash=excluded.manager_cpf_hash, admitted_at=excluded.admitted_at, dismissed_at=excluded.dismissed_at, birth_place=excluded.birth_place, education_level=excluded.education_level, city=excluded.city, state=excluded.state, private_data_encrypted=excluded.private_data_encrypted, updated_at=excluded.updated_at, updated_by=excluded.updated_by`)
      .bind(employee.id, values.socialName, values.personalEmail, values.groupName, values.departmentName, values.managerEmployeeId, values.managerCpfHash, values.admittedAt, values.dismissedAt, values.birthPlace, values.educationLevel, values.city, values.state, privateDataEncrypted, at, at, actor.id),
    await audit(db, { actor, action: 'EMPLOYEE_PROFILE_UPDATE', entityType: 'workforce_employee_profile', entityId: employee.id, requestId, after: { fields: patch.provided } }),
  ])
}

function cleanText(value, max = 240) { return String(value || '').trim().slice(0, max) }
function dateOnly(value) { return /^\d{4}-\d{2}-\d{2}$/.test(String(value || '')) ? String(value) : '' }
function monthOnly(value) { return /^\d{4}-\d{2}$/.test(String(value || '')) ? String(value) : '' }
function limitFor(url, fallback = 100, max = 500) { return Math.min(max, Math.max(1, Number.parseInt(url.searchParams.get('limit') || String(fallback), 10) || fallback)) }
function logEvent(event, fields = {}) {
  const safe = { service: 'workforce-timekeeping', event, ...fields }
  for (const key of Object.keys(safe)) if (/pin|token|descriptor|template|authorization|cookie|score|distance/i.test(key)) delete safe[key]
  console.log(JSON.stringify(safe))
}

async function isPeriodClosed(db, employeeId, unitId, occurredAtOrDate) {
  const date = dateOnly(occurredAtOrDate) || isoDateInZone(occurredAtOrDate, 'America/Sao_Paulo')
  return !!(await db.prepare(`SELECT id FROM timekeeping_period_closures WHERE employee_id=? AND unit_id=? AND status='CLOSED' AND period_start<=? AND period_end>=? ORDER BY revision DESC LIMIT 1`).bind(employeeId, unitId, date, date).first())
}

async function audit(db, { actor, action, entityType, entityId, unitId, requestId, reason, before, after }) {
  const occurredAt = now()
  const previous = await db.prepare('SELECT hash FROM timekeeping_audit_head WHERE id=1').first()
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

async function readBodyLimited(request, maxBytes = 1024 * 1024) {
  const declared = Number(request.headers.get('content-length') || 0)
  if (Number.isFinite(declared) && declared > maxBytes) throw new Error('PAYLOAD_TOO_LARGE')
  if (!request.body) return new Uint8Array()
  const reader = request.body.getReader()
  const chunks = []
  let total = 0
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    total += value.byteLength
    if (total > maxBytes) {
      await reader.cancel('PAYLOAD_TOO_LARGE').catch(() => {})
      throw new Error('PAYLOAD_TOO_LARGE')
    }
    chunks.push(value)
  }
  const out = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) { out.set(chunk, offset); offset += chunk.byteLength }
  return out
}

function csvCell(value) {
  let text = String(value ?? '')
  if (/^[\t\r ]*[=+\-@]/.test(text)) text = `'${text}`
  return `"${text.replaceAll('"', '""')}"`
}

function failure(status, code, requestId, extra = {}) {
  return json(status, { ok: false, error: code, code, ...extra }, requestId)
}

function addDays(date, amount) {
  const value = new Date(`${date}T12:00:00.000Z`)
  value.setUTCDate(value.getUTCDate() + amount)
  return value.toISOString().slice(0, 10)
}

function datesBetween(start, end) {
  const result = []
  for (let cursor = start; cursor <= end && result.length < 370; cursor = addDays(cursor, 1)) result.push(cursor)
  return result
}

function eventsForWorkDate(events, date, timeZone) {
  const ordered = [...events].sort((left, right) => Date.parse(left.occurredAt) - Date.parse(right.occurredAt))
  const selected = ordered.filter((event) => isoDateInZone(event.occurredAt, timeZone) === date)
  if (!selected.length) return []
  let shiftOpen = false
  for (const event of selected) {
    if (event.eventType === 'WORK_START') shiftOpen = true
    if (event.eventType === 'WORK_END') shiftOpen = false
  }
  if (!shiftOpen) return selected
  for (const event of ordered) {
    if (Date.parse(event.occurredAt) <= Date.parse(selected.at(-1).occurredAt)) continue
    selected.push(event)
    if (event.eventType === 'WORK_END') break
  }
  return selected
}

function canonicalPath(path) {
  const aliases = new Map([
    ['/api/ponto/admin/employees', '/api/ponto/employees'],
    ['/api/ponto/admin/devices', '/api/ponto/devices'],
    ['/api/ponto/admin/records', '/api/ponto/mirror'],
    ['/api/ponto/admin/export', '/api/ponto/export'],
    ['/api/ponto/admin/records.csv', '/api/ponto/export'],
    ['/api/ponto/me/punch', '/api/ponto/punches'],
    ['/api/ponto/me/events', '/api/ponto/punches'],
    ['/api/ponto/device/punches', '/api/ponto/punches'],
  ])
  return aliases.get(path) || path
    .replace(/^\/api\/ponto\/admin\/employees\/([^/]+)\/pin$/, '/api/ponto/pin/configure/$1')
    .replace(/^\/api\/ponto\/admin\/employees\/([^/]+)\/enroll$/, '/api/ponto/biometrics/enroll/$1')
    .replace(/^\/api\/ponto\/admin\/employees\/([^/]+)\/profile$/, '/api/ponto/employees/$1/profile')
    .replace(/^\/api\/ponto\/admin\/devices\/([^/]+)\/revoke$/, '/api/ponto/devices/$1/revoke')
    .replace(/^\/api\/ponto\/admin\/employees\/([^/]+)$/, '/api/ponto/employees/$1')
}

async function employeeUnits(db, employeeId, date = now().slice(0, 10)) {
  const rows = await db.prepare(`SELECT unit_id FROM timekeeping_employee_units WHERE employee_id=? AND effective_from<=? AND (effective_to IS NULL OR effective_to>=?) ORDER BY effective_from DESC`).bind(employeeId, date, date).all()
  return (rows.results || []).map((row) => row.unit_id)
}

async function employeeVisible(db, actor, employee, unitId = '') {
  if (!employee) return false
  if (isConsultor(actor)) return String(employee.login_email || '').toLowerCase() === actor.email
  if (actor.role === 'ADMIN') return true
  const units = unitId ? [unitId] : await employeeUnits(db, employee.id)
  return units.some((unit) => actor.allowedUnits.includes(unit))
}

async function employeeById(db, actor, id, unitId = '') {
  const employee = await db.prepare('SELECT * FROM workforce_employees WHERE id=? OR canonical_employee_id=? LIMIT 1').bind(id, id).first()
  return await employeeVisible(db, actor, employee, unitId) ? employee : null
}

async function activeUnitForEmployee(db, employeeId, requestedUnit, date) {
  const unitId = cleanText(requestedUnit, 120)
  if (!unitId) return null
  return db.prepare(`SELECT unit_id FROM timekeeping_employee_units WHERE employee_id=? AND unit_id=? AND effective_from<=? AND (effective_to IS NULL OR effective_to>=?) ORDER BY effective_from DESC LIMIT 1`).bind(employeeId, unitId, date, date).first()
}

async function employeeForTerminal(db, actor, employeeCode) {
  const code = cleanText(employeeCode, 80)
  if (!code) return null
  const rows = await db.prepare('SELECT * FROM workforce_employees WHERE employee_code=? AND status=\'ACTIVE\' LIMIT 2').bind(code).all()
  const candidates = rows.results || []
  if (candidates.length !== 1) return null
  return await employeeVisible(db, actor, candidates[0], actor.allowedUnits[0]) ? candidates[0] : null
}

async function presencePolicyFor(db, unitId) {
  const policy = await db.prepare('SELECT * FROM timekeeping_unit_presence_policies WHERE unit_id=?').bind(unitId).first()
  return policy || { unit_id: unitId, presence_mode: 'FLEXIBLE', geofence_latitude: null, geofence_longitude: null, geofence_radius_meters: 150 }
}

async function networkEvidence(request, env, actor) {
  const policy = normalizeNetworkPolicy(actor.networkPolicy)
  if (policy === 'NONE') return { status: 'NOT_CONFIGURED', payload: { policy } }
  const timestamp = String(request.headers.get('x-skincos-network-ts') || '')
  const ip = String(request.headers.get('x-skincos-network-ip') || '')
  const signature = String(request.headers.get('x-skincos-network-sig') || '')
  const secret = String(env.PONTO_NETWORK_CONTEXT_KEY || '')
  const url = new URL(request.url)
  const validTime = Number.isFinite(Number(timestamp)) && Math.abs(Date.now() - Number(timestamp)) <= 5 * 60 * 1000
  const validIp = ipv4ToInt(ip) !== null
  const expected = secret && validTime && validIp ? await hmac(secret, [timestamp, request.method.toUpperCase(), `${url.pathname}${url.search}`, ip].join('.')) : ''
  const validSignature = !!expected && equal(expected, signature)
  if (!validSignature) return policy === 'REQUIRE' ? { error: 'NETWORK_CONTEXT_REQUIRED' } : { status: 'UNAVAILABLE', payload: { policy } }
  const matched = actor.allowedNetworks.some((network) => ipInNetwork(ip, network))
  if (!matched && policy === 'REQUIRE') return { error: 'NETWORK_FORBIDDEN' }
  return { status: matched ? 'MATCHED' : 'OUTSIDE', payload: { policy, matched, allowedNetworksCount: actor.allowedNetworks.length } }
}

function evidenceStatement(db, eventId, type, evidence) {
  return db.prepare('INSERT INTO timekeeping_punch_evidence (id, event_id, evidence_type, status, payload_json, created_at) VALUES (?, ?, ?, ?, ?, ?)').bind(crypto.randomUUID(), eventId, type, evidence.status, JSON.stringify(evidence.payload || {}), now())
}

function nextEventType(previous) {
  return { WORK_START: 'BREAK_START', BREAK_START: 'BREAK_END', BREAK_END: 'WORK_END', WORK_END: 'WORK_START' }[previous] || 'WORK_START'
}

async function recordPinFailure(db, employeeId, deviceId) {
  const at = now()
  const current = await db.prepare('SELECT * FROM timekeeping_pin_failures WHERE employee_id=?').bind(employeeId).first()
  const recent = current && Date.parse(at) - Date.parse(current.window_started_at) < 15 * 60 * 1000
  const count = recent ? Number(current.failure_count) + 1 : 1
  const lockSeconds = count >= 5 ? Math.min(3600, 60 * 2 ** Math.min(6, count - 5)) : 0
  const lockedUntil = lockSeconds ? new Date(Date.now() + lockSeconds * 1000).toISOString() : null
  await db.prepare(`INSERT INTO timekeeping_pin_failures (employee_id, device_id, failure_count, window_started_at, locked_until, last_failed_at) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(employee_id) DO UPDATE SET device_id=excluded.device_id, failure_count=excluded.failure_count, window_started_at=excluded.window_started_at, locked_until=excluded.locked_until, last_failed_at=excluded.last_failed_at`).bind(employeeId, deviceId || '', count, recent ? current.window_started_at : at, lockedUntil, at).run()
  return { count, lockedUntil }
}

async function verifyPunchCredential(db, env, actor, employee, body) {
  if (body.pin !== undefined) {
    const failureRow = await db.prepare('SELECT * FROM timekeeping_pin_failures WHERE employee_id=?').bind(employee.id).first()
    if (failureRow?.locked_until && Date.parse(failureRow.locked_until) > Date.now()) return { error: 'PIN_LOCKED', secondsRemaining: Math.ceil((Date.parse(failureRow.locked_until) - Date.now()) / 1000) }
    const row = await db.prepare('SELECT * FROM timekeeping_pin_credentials WHERE employee_id=?').bind(employee.id).first()
    if (!row) return { error: 'PIN_NOT_SET' }
    const valid = await verifyPin(String(body.pin || ''), { algorithm: row.algorithm, saltB64: row.salt_b64, hashB64: row.hash_b64, iterations: row.iterations }).catch(() => false)
    if (!valid) {
      const failure = await recordPinFailure(db, employee.id, actor.deviceId || '')
      return { error: failure.lockedUntil ? 'PIN_LOCKED' : 'PIN_INVALID', secondsRemaining: failure.lockedUntil ? Math.ceil((Date.parse(failure.lockedUntil) - Date.now()) / 1000) : undefined }
    }
    await db.prepare('DELETE FROM timekeeping_pin_failures WHERE employee_id=?').bind(employee.id).run()
    return { source: 'PIN' }
  }
  const descriptor = body.descriptor || body.template
  if (descriptor !== undefined) {
    if (!isFacePunchEnabled(env)) return { error: 'FACE_DISABLED' }
    if (!isValidBiometricTemplate(descriptor) || !env.PONTO_TEMPLATES_KEY) return { error: 'FACE_UNAVAILABLE' }
    const templates = await db.prepare(`SELECT encrypted_template FROM timekeeping_biometric_templates WHERE employee_id=? AND revoked_at IS NULL AND (expires_at IS NULL OR expires_at>?)`).bind(employee.id, now()).all()
    if (!(templates.results || []).length) return { error: 'FACE_NOT_ENROLLED' }
    const threshold = Math.max(0.1, Math.min(2, Number(env.PONTO_FACE_THRESHOLD || 0.62)))
    let matched = false
    for (const row of templates.results || []) {
      const stored = await decryptTemplate(row.encrypted_template, env.PONTO_TEMPLATES_KEY).catch(() => null)
      if (stored && biometricDistance(stored, descriptor) <= threshold) { matched = true; break }
    }
    return matched ? { source: 'FACE' } : { error: 'FACE_NOT_RECOGNIZED' }
  }
  if (canManageWorkforce(actor)) return { source: 'MANUAL' }
  if (String(env.ALLOW_SYSTEM_PUNCH || '').toLowerCase() === 'true') return { source: 'SYSTEM' }
  return { error: 'PUNCH_CREDENTIAL_REQUIRED' }
}

async function resolveRule(db, employeeId, unitId, date) {
  const row = await db.prepare(`SELECT * FROM timekeeping_rule_versions WHERE (employee_id=? OR employee_id IS NULL) AND (unit_id=? OR unit_id IS NULL) AND effective_from<=? AND (effective_to IS NULL OR effective_to>=?) ORDER BY (employee_id IS NOT NULL) DESC, (unit_id IS NOT NULL) DESC, effective_from DESC LIMIT 1`).bind(employeeId, unitId, date, date).first()
  if (!row) return { id: null, timeZone: 'America/Sao_Paulo', expectedMinutes: 0 }
  try { return { id: row.id, ...JSON.parse(row.rules_json) } } catch { return { id: row.id, timeZone: 'America/Sao_Paulo', expectedMinutes: 0 } }
}

async function calculationForDate(db, employeeId, unitId, date, { live = false } = {}) {
  if (!live) {
    const snapshot = await db.prepare(`SELECT s.calculation_json FROM timekeeping_daily_snapshots s JOIN timekeeping_period_closures c ON c.id=s.closure_id WHERE s.employee_id=? AND s.work_date=? AND c.unit_id=? AND c.status='CLOSED' ORDER BY c.revision DESC LIMIT 1`).bind(employeeId, date, unitId).first()
    if (snapshot) return { ...JSON.parse(snapshot.calculation_json), frozen: true }
  }
  const from = new Date(`${date}T00:00:00.000Z`); from.setUTCHours(from.getUTCHours() - 12)
  const to = new Date(`${addDays(date, 2)}T12:00:00.000Z`)
  const rule = await resolveRule(db, employeeId, unitId, date)
  const events = await db.prepare(`SELECT e.id, e.event_type, COALESCE(c.proposed_at_utc,e.occurred_at_utc) AS occurred_at FROM timekeeping_events e LEFT JOIN timekeeping_corrections c ON c.event_id=e.id AND c.status='APPROVED' WHERE e.employee_id=? AND e.unit_id=? AND e.occurred_at_utc>=? AND e.occurred_at_utc<? AND e.superseded_by IS NULL ORDER BY occurred_at`).bind(employeeId, unitId, from.toISOString(), to.toISOString()).all()
  const workDateEvents = eventsForWorkDate((events.results || []).map((event) => ({ id: event.id, eventType: event.event_type, occurredAt: event.occurred_at })), date, rule.timeZone || 'America/Sao_Paulo')
  const scheduleRow = await db.prepare('SELECT * FROM timekeeping_schedule_assignments WHERE employee_id=? AND unit_id=? AND work_date=? ORDER BY created_at DESC LIMIT 1').bind(employeeId, unitId, date).first()
  const holiday = await db.prepare('SELECT id FROM timekeeping_holidays WHERE unit_id=? AND holiday_date=? LIMIT 1').bind(unitId, date).first()
  const absence = await db.prepare('SELECT * FROM timekeeping_absences WHERE employee_id=? AND (unit_id=? OR unit_id IS NULL) AND starts_at<=? AND ends_at>=? ORDER BY created_at DESC LIMIT 1').bind(employeeId, unitId, `${date}T23:59:59.999Z`, `${date}T00:00:00.000Z`).first()
  const result = calculateDay({
    date,
    events: workDateEvents,
    rule,
    schedule: scheduleRow ? { id: scheduleRow.id, expectedMinutes: scheduleRow.expected_minutes, startAt: scheduleRow.start_at_utc, endAt: scheduleRow.end_at_utc } : null,
    holiday: !!holiday,
    absence: absence ? { id: absence.id, kind: absence.kind } : null,
  })
  return { ...result, employeeId, unitId, frozen: false }
}

async function periodCalculation(db, employeeId, unitId, start, end) {
  const days = []
  for (const date of datesBetween(start, end)) days.push(await calculationForDate(db, employeeId, unitId, date))
  return calculatePeriod({ days })
}

async function listScopedEmployees(db, actor, url) {
  const limit = limitFor(url, 100, 500)
  const unit = cleanText(url.searchParams.get('unitId') || url.searchParams.get('unit'), 120)
  if (actor.role === 'MANAGER' || actor.role === 'SUPERVISOR') {
    const units = unit ? [unit] : actor.allowedUnits
    if (!units.length || units.some((value) => !actor.allowedUnits.includes(value))) return []
    const placeholders = units.map(() => '?').join(',')
    const rows = await db.prepare(`SELECT DISTINCT e.* FROM workforce_employees e JOIN timekeeping_employee_units eu ON eu.employee_id=e.id WHERE eu.unit_id IN (${placeholders}) ORDER BY e.display_name LIMIT ?`).bind(...units, limit).all()
    return rows.results || []
  }
  if (isConsultor(actor)) {
    const row = await employeeForActor(db, actor)
    return row ? [row] : []
  }
  const rows = await db.prepare('SELECT * FROM workforce_employees ORDER BY display_name LIMIT ?').bind(limit).all()
  return rows.results || []
}

async function listRecords(db, actor, url, employeeOverride = null) {
  const employeeId = employeeOverride || cleanText(url.searchParams.get('employeeId'), 120)
  const unitId = cleanText(url.searchParams.get('unitId') || url.searchParams.get('unit'), 120)
  let employee = employeeId ? await employeeById(db, actor, employeeId, unitId) : null
  if (isConsultor(actor)) employee = await employeeForActor(db, actor)
  if (!employee) return null
  const from = cleanText(url.searchParams.get('from'), 40) || '1970-01-01T00:00:00.000Z'
  const to = cleanText(url.searchParams.get('to'), 40) || '9999-12-31T23:59:59.999Z'
  const rows = await db.prepare(`SELECT e.id, e.employee_id, e.unit_id, e.device_id, e.event_type, e.source, e.occurred_at_utc, e.created_at, c.id AS correction_id, c.proposed_at_utc, c.reason AS correction_reason FROM timekeeping_events e LEFT JOIN timekeeping_corrections c ON c.event_id=e.id AND c.status='APPROVED' WHERE e.employee_id=? AND e.occurred_at_utc>=? AND e.occurred_at_utc<=? AND (?='' OR e.unit_id=?) ORDER BY e.occurred_at_utc DESC LIMIT ?`).bind(employee.id, from, to, unitId, unitId, limitFor(url, 200, 500)).all()
  return (rows.results || []).map((row) => ({ id: row.id, kind: 'PUNCH', employeeId: row.employee_id, employeeName: employee.display_name, type: row.event_type === 'WORK_START' ? 'IN' : row.event_type === 'WORK_END' ? 'OUT' : row.event_type, eventType: row.event_type, at: row.occurred_at_utc, unit: row.unit_id, unitId: row.unit_id, deviceId: row.device_id, method: row.source, source: row.source, corrected: row.correction_id ? { id: row.correction_id, at: row.proposed_at_utc, reason: row.correction_reason } : null }))
}

function encodeBase64Url(value) {
  const bytes = encoder.encode(JSON.stringify(value))
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '')
}

async function scheduleRequest(env, path, unitId) {
  if (!env.SCHEDULE || !env.ESCALA_ACTOR_HMAC_KEY) throw new Error('SCHEDULE_NOT_CONFIGURED')
  const actor = encodeBase64Url({ id: 'workforce-timekeeping-sync', role: 'GESTOR', allowedUnits: [unitId] })
  const timestamp = String(Date.now())
  const signature = await signHmac(env.ESCALA_ACTOR_HMAC_KEY, `${timestamp}.${actor}`)
  const response = await env.SCHEDULE.fetch(new Request(`https://schedule.internal${path}`, { headers: { 'x-crm-user': actor, 'x-crm-ts': timestamp, 'x-crm-signature': signature, 'x-request-id': crypto.randomUUID() } }))
  if (!response.ok) throw new Error(`SCHEDULE_HTTP_${response.status}`)
  return response.json()
}

async function syncSchedule(db, env, actor, unitId, month, requestId) {
  const query = `?unit=${encodeURIComponent(unitId)}&month=${encodeURIComponent(month)}`
  const [scheduleData, professionalData] = await Promise.all([
    scheduleRequest(env, `/api/escala/schedule${query}`, unitId),
    scheduleRequest(env, `/api/escala/professionals?unit=${encodeURIComponent(unitId)}`, unitId),
  ])
  const professionals = new Map((professionalData.data || []).map((row) => [String(row.name || row.professional || '').trim(), String(row.id || '').trim()]))
  let imported = 0; let conflicts = 0
  const statements = []
  for (const entry of scheduleData.schedule || []) {
    const name = cleanText(entry.professional, 180); const professionalId = professionals.get(name) || ''
    let alias = professionalId ? await db.prepare(`SELECT employee_id FROM workforce_employee_aliases WHERE source='ESCALA_PROFESSIONAL_ID' AND legacy_id=?`).bind(professionalId).first() : null
    if (!alias) alias = await db.prepare(`SELECT employee_id FROM workforce_employee_aliases WHERE source='ESCALA_NAME' AND legacy_id=?`).bind(name).first()
    if (!alias) {
      const existingConflict = await db.prepare(`SELECT id FROM workforce_identity_conflicts WHERE source='ESCALA' AND source_id=? AND status='OPEN' LIMIT 1`).bind(professionalId || name).first()
      if (!existingConflict) statements.push(db.prepare(`INSERT INTO workforce_identity_conflicts (id, source, source_id, candidates_json, reasons_json, created_at) VALUES (?, 'ESCALA', ?, ?, ?, ?)`).bind(crypto.randomUUID(), professionalId || name, '[]', JSON.stringify(['NO_CANONICAL_ALIAS', { name, unitId }]), now()))
      conflicts += 1
      continue
    }
    const rule = await resolveRule(db, alias.employee_id, unitId, entry.date)
    const sourceRef = professionalId || name
    statements.push(db.prepare(`INSERT INTO timekeeping_schedule_assignments (id, employee_id, unit_id, work_date, expected_minutes, source, source_ref, created_at) VALUES (?, ?, ?, ?, ?, 'ESCALA', ?, ?) ON CONFLICT(employee_id, unit_id, work_date, source) DO UPDATE SET expected_minutes=excluded.expected_minutes, source_ref=excluded.source_ref`).bind(crypto.randomUUID(), alias.employee_id, unitId, entry.date, Math.max(0, Number(rule.expectedMinutes || 0)), sourceRef, now()))
    imported += 1
  }
  for (const holiday of scheduleData.holidays || []) statements.push(db.prepare(`INSERT OR IGNORE INTO timekeeping_holidays (id, unit_id, holiday_date, name, created_at) VALUES (?, ?, ?, ?, ?)`).bind(crypto.randomUUID(), unitId, holiday.date, cleanText(holiday.name, 180), now()))
  statements.push(await audit(db, { actor, action: 'SCHEDULE_SYNC', entityType: 'timekeeping_schedule', entityId: `${unitId}:${month}`, unitId, requestId, after: { imported, conflicts, holidays: (scheduleData.holidays || []).length } }))
  await db.batch(statements)
  return { imported, conflicts, holidays: (scheduleData.holidays || []).length }
}

async function enforceReplayProtection(request, db, requestId, actor) {
  if (['GET', 'HEAD', 'OPTIONS'].includes(request.method)) return true
  const nonce = cleanText(request.headers.get('x-request-nonce') || request.headers.get('x-idempotency-key') || request.headers.get('idempotency-key'), 180)
  if (!nonce) return actor.role === 'DEVICE' // Device punches also require an idempotency key in their body.
  try {
    await db.prepare('DELETE FROM timekeeping_request_nonces WHERE expires_at<?').bind(now()).run()
    await db.prepare('INSERT INTO timekeeping_request_nonces (nonce, expires_at, request_id, created_at) VALUES (?, ?, ?, ?)').bind(nonce, new Date(Date.now() + 10 * 60 * 1000).toISOString(), requestId, now()).run()
    return true
  } catch { return false }
}

export async function handleTimekeeping(request, env) {
  const startedAt = Date.now()
  const requestId = requestIdFor(request)
  const url = new URL(request.url)
  let path = canonicalPath(url.pathname.replace(/^\/workforce/, ''))
  const availability = await readModuleAvailability(env, 'timekeeping')
  if (path === '/health' || path === '/api/ponto/health') return json(200, { service: 'workforce-timekeeping', database: Boolean(env.DB), ...operationalStatus({ unit: 'timekeeping', version: env.APP_VERSION || '1.0.0', environment: env.ENVIRONMENT, ready: Boolean(env.DB) && availability.state === 'active', requestId, dependencies: { d1: dependencyState(Boolean(env.DB)), schedule: dependencyState(Boolean(env.SCHEDULE), { required: false }), module_control: dependencyState(Boolean(env.MODULE_CONTROL), { required: false }) } }), availability }, requestId)
  if (path === '/readiness' || path === '/api/ponto/readiness') {
    try {
      if (!env.DB) throw new Error('DB_NOT_CONFIGURED')
      await env.DB.prepare('SELECT 1 AS ok').first()
      return json(200, { ok: true, service: 'workforce-timekeeping', ready: true, database: 'available' }, requestId)
    } catch { return json(503, { ok: false, error: 'NOT_READY', code: 'DATABASE_UNAVAILABLE' }, requestId) }
  }
  if (!path.startsWith('/api/ponto')) return json(404, { ok: false, error: 'NOT_FOUND' }, requestId)
  if (availability.state !== 'active') return moduleUnavailableResponse('timekeeping', availability, requestId)
  if (!env.DB) return json(503, { ok: false, error: 'NOT_READY', code: 'DATABASE_UNAVAILABLE' }, requestId)
  let bodyHash = await sha256('')
  if (!['GET', 'HEAD', 'OPTIONS'].includes(request.method)) {
    try {
      const bytes = await readBodyLimited(request)
      bodyHash = await sha256(bytes)
      request = new Request(request, { body: bytes.byteLength ? bytes : undefined })
    } catch (error) {
      if (error?.message === 'PAYLOAD_TOO_LARGE') return failure(413, 'PAYLOAD_TOO_LARGE', requestId)
      throw error
    }
  }
  const db = env.DB
  const actor = await actorFor(request, env, db, bodyHash)
  if (!actor) return json(401, { ok: false, error: 'UNAUTHORIZED' }, requestId)
  if (!await enforceReplayProtection(request, db, requestId, actor)) return failure(409, 'REPLAY_DETECTED', requestId)

  try {
    if (path === '/api/ponto/device/context' && request.method === 'GET') {
      if (actor.role !== 'DEVICE' || actor.deviceMode !== 'TERMINAL') return failure(403, 'DEVICE_TERMINAL_REQUIRED', requestId)
      return json(200, { ok: true, data: { deviceId: actor.deviceId, label: actor.name, unitId: actor.allowedUnits[0], serverTime: now(), pinOnly: true, networkPolicy: actor.networkPolicy, allowedNetworksCount: actor.allowedNetworks.length } }, requestId)
    }

    if (path === '/api/ponto/me/presence' && request.method === 'GET') {
      if (!roleAllows(actor.role, 'self.punch')) return failure(403, 'FORBIDDEN', requestId)
      const employee = await employeeForActor(db, actor); const unitId = cleanText(url.searchParams.get('unit') || url.searchParams.get('unitId'), 120)
      if (!employee || !unitId || !await activeUnitForEmployee(db, employee.id, unitId, now().slice(0, 10))) return failure(403, 'UNIT_FORBIDDEN', requestId)
      const policy = await presencePolicyFor(db, unitId)
      return json(200, { ok: true, data: { unitId, presenceMode: normalizePresenceMode(policy.presence_mode), locationRequired: normalizePresenceMode(policy.presence_mode) === 'EXTERNAL_REVIEW', geofenceConfigured: Number.isFinite(Number(policy.geofence_latitude)) && Number.isFinite(Number(policy.geofence_longitude)), geofenceRadiusMeters: Number(policy.geofence_radius_meters || 150) } }, requestId)
    }

    if ((path === '/api/ponto/me' || path === '/api/ponto/context') && request.method === 'GET') {
      const employee = await employeeForActor(db, actor)
      const units = employee ? await employeeUnits(db, employee.id) : []
      const last = employee ? await db.prepare('SELECT * FROM timekeeping_events WHERE employee_id=? ORDER BY occurred_at_utc DESC LIMIT 1').bind(employee.id).first() : null
      const biometrics = employee ? await db.prepare('SELECT COUNT(*) AS total, MAX(created_at) AS last_enrolled_at FROM timekeeping_biometric_templates WHERE employee_id=? AND revoked_at IS NULL').bind(employee.id).first() : null
      const pin = employee ? await db.prepare('SELECT employee_id FROM timekeeping_pin_credentials WHERE employee_id=?').bind(employee.id).first() : null
      const data = { linked: !!employee, actorEmail: actor.email, allowedUnits: actor.allowedUnits.length ? actor.allowedUnits : units, employee: publicEmployee(employee), hasFace: Number(biometrics?.total || 0) > 0, pinSet: !!pin, lastPunch: last ? { id: last.id, kind: 'PUNCH', employeeId: last.employee_id, employeeName: employee.display_name, type: last.event_type === 'WORK_START' ? 'IN' : last.event_type === 'WORK_END' ? 'OUT' : last.event_type, at: last.occurred_at_utc, unit: last.unit_id, method: last.source } : null, suggestedNextMethod: isFacePunchEnabled(env) && Number(biometrics?.total || 0) > 0 ? 'FACE' : 'PIN', capabilities: Object.values({ selfRead: 'self.read', selfPunch: 'self.punch', unitRead: 'unit.read', approve: 'correction.approve', close: 'period.close', reopen: 'period.reopen', audit: 'audit.read' }).filter((capability) => roleAllows(actor.role, capability)) }
      return json(200, { ok: true, ...data, data }, requestId)
    }

    if (path === '/api/ponto/me/records' && request.method === 'GET') {
      const records = await listRecords(db, actor, url, (await employeeForActor(db, actor))?.id)
      return records ? json(200, { ok: true, data: records }, requestId) : failure(404, 'EMPLOYEE_NOT_LINKED', requestId)
    }

    if (path === '/api/ponto/me/profile' && request.method === 'GET') {
      if (!roleAllows(actor.role, 'self.profile.read')) return failure(403, 'FORBIDDEN', requestId)
      const employee = await employeeForActor(db, actor)
      if (!employee) return failure(404, 'EMPLOYEE_NOT_LINKED', requestId)
      return json(200, { ok: true, data: await profileResponse(db, env, employee) }, requestId)
    }

    if (path === '/api/ponto/me/profile' && request.method === 'PATCH') {
      if (!roleAllows(actor.role, 'self.profile.write')) return failure(403, 'FORBIDDEN', requestId)
      const employee = await employeeForActor(db, actor); const body = await readJson(request)
      if (!employee) return failure(404, 'EMPLOYEE_NOT_LINKED', requestId)
      if (!body) return failure(400, 'INVALID_PROFILE', requestId)
      const patch = profileInput(body, profileSelfPublicFields, profileSelfPrivateFields)
      if (!patch.provided.length) return failure(400, 'PROFILE_CHANGES_REQUIRED', requestId)
      await saveProfile(db, env, actor, employee, patch, requestId)
      return json(200, { ok: true, data: await profileResponse(db, env, employee) }, requestId)
    }

    if (path === '/api/ponto/employees' && request.method === 'GET') {
      if (!roleAllows(actor.role, 'unit.read') && !isConsultor(actor)) return failure(403, 'FORBIDDEN', requestId)
      const employees = await listScopedEmployees(db, actor, url)
      const output = []
      for (const employee of employees) {
        const units = await employeeUnits(db, employee.id)
        const bio = await db.prepare('SELECT COUNT(*) AS count, MAX(created_at) AS last_at FROM timekeeping_biometric_templates WHERE employee_id=? AND revoked_at IS NULL').bind(employee.id).first()
        const pin = await db.prepare('SELECT employee_id FROM timekeeping_pin_credentials WHERE employee_id=?').bind(employee.id).first()
        output.push({ ...publicEmployee(employee), code: employee.employee_code || undefined, loginEmail: employee.login_email || undefined, birthDate: employee.birth_date || undefined, jobTitle: employee.job_title || undefined, unit: units[0] || undefined, units, active: employee.status === 'ACTIVE', faceDescriptorsCount: Number(bio?.count || 0), lastEnrolledAt: bio?.last_at || null, pinSet: !!pin })
      }
      return json(200, { ok: true, data: output, meta: { count: output.length } }, requestId)
    }

    const employeeMatch = path.match(/^\/api\/ponto\/employees\/([^/]+)$/)
    const employeeProfileMatch = path.match(/^\/api\/ponto\/employees\/([^/]+)\/profile$/)
    if (employeeProfileMatch && request.method === 'GET') {
      if (!roleAllows(actor.role, 'profile.read')) return failure(403, 'FORBIDDEN', requestId)
      const employee = await employeeById(db, actor, decodeURIComponent(employeeProfileMatch[1]))
      if (!employee) return failure(404, 'EMPLOYEE_NOT_FOUND', requestId)
      return json(200, { ok: true, data: await profileResponse(db, env, employee) }, requestId)
    }

    if (employeeProfileMatch && request.method === 'PATCH') {
      if (!roleAllows(actor.role, 'profile.manage')) return failure(403, 'FORBIDDEN', requestId)
      const employee = await employeeById(db, actor, decodeURIComponent(employeeProfileMatch[1])); const body = await readJson(request)
      if (!employee) return failure(404, 'EMPLOYEE_NOT_FOUND', requestId)
      if (!body) return failure(400, 'INVALID_PROFILE', requestId)
      const patch = profileInput(body)
      if (!patch.provided.length) return failure(400, 'PROFILE_CHANGES_REQUIRED', requestId)
      if (patch.publicPatch.managerEmployeeId) {
        const manager = await employeeById(db, actor, patch.publicPatch.managerEmployeeId)
        if (!manager) return failure(400, 'MANAGER_NOT_FOUND', requestId)
        patch.publicPatch.managerEmployeeId = manager.id
      }
      await saveProfile(db, env, actor, employee, patch, requestId)
      return json(200, { ok: true, data: await profileResponse(db, env, employee) }, requestId)
    }

    if (employeeMatch && request.method === 'GET') {
      if (!roleAllows(actor.role, 'unit.read') && !isConsultor(actor)) return failure(403, 'FORBIDDEN', requestId)
      const employee = await employeeById(db, actor, decodeURIComponent(employeeMatch[1]))
      if (!employee) return failure(404, 'EMPLOYEE_NOT_FOUND', requestId)
      const units = await employeeUnits(db, employee.id)
      return json(200, { ok: true, data: { ...publicEmployee(employee), code: employee.employee_code || undefined, loginEmail: employee.login_email || undefined, birthDate: employee.birth_date || undefined, jobTitle: employee.job_title || undefined, unit: units[0] || undefined, units, active: employee.status === 'ACTIVE' } }, requestId)
    }

    if (path === '/api/ponto/employees' && request.method === 'POST') {
      if (!canManageWorkforce(actor)) return failure(403, 'FORBIDDEN', requestId)
      const body = await readJson(request)
      const name = cleanText(body?.name, 180); const email = cleanText(body?.loginEmail, 240).toLowerCase(); const unitId = cleanText(body?.unit || body?.unitId, 120)
      if (!name || !/^\S+@\S+\.\S+$/.test(email) || !unitId) return failure(400, 'INVALID_EMPLOYEE', requestId)
      if (!requireUnit(actor, unitId)) return failure(403, 'UNIT_FORBIDDEN', requestId)
      const existing = await db.prepare('SELECT id, display_name FROM workforce_employees WHERE lower(login_email)=lower(?)').bind(email).first()
      if (existing) return failure(409, 'LOGIN_EMAIL_ALREADY_IN_USE', requestId, { employeeId: existing.id, employeeName: existing.display_name })
      const id = crypto.randomUUID(); const at = now(); const canonicalId = cleanText(body?.employeeId || body?.canonicalEmployeeId, 120) || `workforce:${id}`
      const cpfHash = body?.cpf ? await sha256(String(body.cpf).replace(/\D/g, '')) : null
      const phoneHash = body?.phone ? await sha256(String(body.phone).replace(/\D/g, '')) : null
      const insert = db.prepare(`INSERT INTO workforce_employees (id, canonical_employee_id, login_email, display_name, status, created_at, updated_at, employee_code, cpf_hash, phone_hash, birth_date, job_title, metadata_json) VALUES (?, ?, ?, ?, 'ACTIVE', ?, ?, ?, ?, ?, ?, ?, ?)`)
        .bind(id, canonicalId, email, name, at, at, cleanText(body?.code, 80) || null, cpfHash, phoneHash, dateOnly(body?.birthDate) || null, cleanText(body?.jobTitle, 160) || null, JSON.stringify({ source: 'CRM' }))
      const unit = db.prepare('INSERT INTO timekeeping_employee_units (id, employee_id, unit_id, effective_from, created_at) VALUES (?, ?, ?, ?, ?)').bind(crypto.randomUUID(), id, unitId, dateOnly(body?.effectiveFrom) || at.slice(0, 10), at)
      await db.batch([insert, unit, await audit(db, { actor, action: 'EMPLOYEE_LINK_CREATE', entityType: 'workforce_employee', entityId: id, unitId, requestId, after: { canonicalId, email, name } })])
      return json(201, { ok: true, data: { id, employeeId: canonicalId, name, loginEmail: email, unit: unitId, active: true } }, requestId)
    }

    if (employeeMatch && ['PATCH', 'DELETE'].includes(request.method)) {
      if (!canManageWorkforce(actor)) return failure(403, 'FORBIDDEN', requestId)
      const employee = await employeeById(db, actor, decodeURIComponent(employeeMatch[1]))
      if (!employee) return failure(404, 'EMPLOYEE_NOT_FOUND', requestId)
      const body = request.method === 'PATCH' ? await readJson(request) : {}
      const status = request.method === 'DELETE' || body?.active === false ? 'TERMINATED' : 'ACTIVE'
      const email = body?.loginEmail === undefined ? employee.login_email : cleanText(body.loginEmail, 240).toLowerCase() || null
      const name = body?.name === undefined ? employee.display_name : cleanText(body.name, 180)
      if (!name) return failure(400, 'INVALID_EMPLOYEE', requestId)
      try {
        await db.batch([
          db.prepare('UPDATE workforce_employees SET display_name=?, login_email=?, employee_code=?, birth_date=?, job_title=?, status=?, terminated_at=?, updated_at=? WHERE id=?').bind(name, email, body?.code === undefined ? employee.employee_code : cleanText(body.code, 80) || null, body?.birthDate === undefined ? employee.birth_date : dateOnly(body.birthDate) || null, body?.jobTitle === undefined ? employee.job_title : cleanText(body.jobTitle, 160) || null, status, status === 'TERMINATED' ? now() : null, now(), employee.id),
          await audit(db, { actor, action: status === 'TERMINATED' ? 'EMPLOYEE_TERMINATE' : 'EMPLOYEE_UPDATE', entityType: 'workforce_employee', entityId: employee.id, requestId, before: publicEmployee(employee), after: { name, email, status } }),
        ])
      } catch { return failure(409, 'LOGIN_EMAIL_ALREADY_IN_USE', requestId) }
      return json(200, { ok: true, data: { id: employee.id, name, loginEmail: email, active: status === 'ACTIVE' } }, requestId)
    }

    if (path === '/api/ponto/punches' && request.method === 'POST') {
      const body = await readJson(request)
      if (!body) return failure(400, 'INVALID_PUNCH_REQUEST', requestId)
      const isTerminal = actor.role === 'DEVICE'
      if (isTerminal && actor.deviceMode !== 'TERMINAL') return failure(403, 'DEVICE_TERMINAL_REQUIRED', requestId)
      if (isTerminal && (body.descriptor !== undefined || body.template !== undefined || body.pin === undefined)) return failure(400, 'TERMINAL_PIN_REQUIRED', requestId)
      let employee = isTerminal ? await employeeForTerminal(db, actor, body.employeeCode) : isConsultor(actor) ? await employeeForActor(db, actor) : await employeeById(db, actor, cleanText(body.employeeId, 120))
      if (!employee) return failure(404, 'EMPLOYEE_NOT_LINKED', requestId)
      if (employee.status !== 'ACTIVE') return failure(409, 'EMPLOYEE_NOT_ACTIVE', requestId)
      const occurredAt = isTerminal ? now() : body.occurredAt ? new Date(body.occurredAt).toISOString() : now()
      const unitId = isTerminal ? actor.allowedUnits[0] : cleanText(body.unitId || body.unit, 120)
      const initialWorkDate = isoDateInZone(occurredAt, 'America/Sao_Paulo')
      const punchRule = await resolveRule(db, employee.id, unitId, initialWorkDate)
      const workDate = isoDateInZone(occurredAt, punchRule.timeZone || 'America/Sao_Paulo')
      if (!unitId || !await activeUnitForEmployee(db, employee.id, unitId, workDate)) return failure(403, 'UNIT_FORBIDDEN', requestId)
      if (!isConsultor(actor) && !requireUnit(actor, unitId)) return failure(403, 'UNIT_FORBIDDEN', requestId)
      if (await isPeriodClosed(db, employee.id, unitId, workDate)) return failure(409, 'PERIOD_CLOSED', requestId)
      const presencePolicy = await presencePolicyFor(db, unitId)
      const presenceMode = normalizePresenceMode(presencePolicy.presence_mode)
      if (!isTerminal && presenceMode === 'TERMINAL_REQUIRED') return failure(409, 'TERMINAL_REQUIRED', requestId)
      const network = isTerminal ? await networkEvidence(request, env, actor) : null
      if (network?.error) return failure(403, network.error, requestId)
      const location = !isTerminal && presenceMode === 'EXTERNAL_REVIEW' ? locationEvidence(body.location, presencePolicy) : null
      if (location?.error) return failure(409, location.error, requestId)
      const credential = await verifyPunchCredential(db, env, actor, employee, body)
      if (credential.error) return failure(credential.error === 'PIN_LOCKED' ? 429 : 401, credential.error, requestId, credential.secondsRemaining ? { secondsRemaining: credential.secondsRemaining } : {})
      const manualReason = credential.source === 'MANUAL' ? cleanText(body.reason, 500) : ''
      if (credential.source === 'MANUAL' && !manualReason) return failure(400, 'JUSTIFICATION_REQUIRED', requestId)
      const previous = await db.prepare('SELECT event_type, occurred_at_utc FROM timekeeping_events WHERE employee_id=? AND unit_id=? ORDER BY occurred_at_utc DESC LIMIT 1').bind(employee.id, unitId).first()
      const eventType = canonicalEventType(body.eventType || body.type) || nextEventType(previous?.event_type)
      const idempotencyKey = cleanText(request.headers.get('idempotency-key') || request.headers.get('x-idempotency-key') || body.requestId, 160)
      if (!idempotencyKey) return failure(400, 'IDEMPOTENCY_KEY_REQUIRED', requestId)
      const scope = `employee:${employee.id}`; const fingerprint = await hmac(String(env.PONTO_IDEMPOTENCY_KEY || env.PONTO_ACTOR_HMAC_KEY), `${employee.id}.${unitId}.${eventType}.${body.occurredAt || ''}.${credential.source}`)
      const alreadyCreated = await db.prepare('SELECT * FROM timekeeping_events WHERE idempotency_scope=? AND idempotency_key=?').bind(scope, idempotencyKey).first()
      if (alreadyCreated) {
        if (!constantTimeEqual(alreadyCreated.request_fingerprint, fingerprint)) return failure(409, 'IDEMPOTENCY_CONFLICT', requestId)
        return json(200, { ok: true, idempotent: true, data: { id: alreadyCreated.id, operationId: alreadyCreated.id, employeeId: employee.id, employeeName: employee.display_name, type: alreadyCreated.event_type === 'WORK_START' ? 'IN' : alreadyCreated.event_type === 'WORK_END' ? 'OUT' : alreadyCreated.event_type, eventType: alreadyCreated.event_type, at: alreadyCreated.occurred_at_utc, occurredAtUtc: alreadyCreated.occurred_at_utc, unit: alreadyCreated.unit_id, unitId: alreadyCreated.unit_id, method: alreadyCreated.source, source: alreadyCreated.source } }, requestId)
      }
      if (previous && Date.parse(occurredAt) - Date.parse(previous.occurred_at_utc) < Number(env.PONTO_COOLDOWN_SECONDS || 15) * 1000) return failure(429, 'COOLDOWN', requestId, { secondsRemaining: Number(env.PONTO_COOLDOWN_SECONDS || 15) })
      const id = crypto.randomUUID()
      try {
        const statements = [
          db.prepare('INSERT INTO timekeeping_events (id, employee_id, unit_id, device_id, event_type, source, occurred_at_utc, work_date, idempotency_scope, idempotency_key, request_fingerprint, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').bind(id, employee.id, unitId, actor.deviceId || null, eventType, credential.source, occurredAt, workDate, scope, idempotencyKey, fingerprint, actor.id, now()),
          await audit(db, { actor, action: 'EVENT_CREATE', entityType: 'timekeeping_event', entityId: id, unitId, requestId, reason: manualReason, after: { employeeId: employee.id, eventType, source: credential.source, occurredAt } }),
        ]
        if (isTerminal) statements.push(evidenceStatement(db, id, 'TERMINAL_DEVICE', { status: 'REGISTERED', payload: { deviceId: actor.deviceId, deviceMode: actor.deviceMode } }))
        if (network) statements.push(evidenceStatement(db, id, 'NETWORK_CONTEXT', network))
        if (location) statements.push(evidenceStatement(db, id, 'LOCATION', location))
        await db.batch(statements)
      } catch (error) {
        if (String(error?.message || '').includes('PERIOD_CLOSED')) return failure(409, 'PERIOD_CLOSED', requestId)
        const existing = await db.prepare('SELECT * FROM timekeeping_events WHERE idempotency_scope=? AND idempotency_key=?').bind(scope, idempotencyKey).first()
        if (existing && constantTimeEqual(existing.request_fingerprint, fingerprint)) return json(200, { ok: true, idempotent: true, data: { id: existing.id, operationId: existing.id, employeeId: employee.id, employeeName: employee.display_name, type: existing.event_type === 'WORK_START' ? 'IN' : existing.event_type === 'WORK_END' ? 'OUT' : existing.event_type, eventType: existing.event_type, at: existing.occurred_at_utc, occurredAtUtc: existing.occurred_at_utc, unit: existing.unit_id, unitId: existing.unit_id, method: existing.source } }, requestId)
        return failure(409, 'IDEMPOTENCY_CONFLICT', requestId)
      }
      logEvent('punch_success', { requestId, employeeId: employee.id, unitId, source: credential.source, terminal: isTerminal, presenceMode, latencyMs: Date.now() - startedAt })
      return json(201, { ok: true, data: { id, operationId: id, employeeId: employee.id, employeeName: employee.display_name, type: eventType === 'WORK_START' ? 'IN' : eventType === 'WORK_END' ? 'OUT' : eventType, eventType, at: occurredAt, occurredAtUtc: occurredAt, unit: unitId, unitId, deviceId: actor.deviceId || null, method: credential.source, source: credential.source, presence: { mode: presenceMode, network: network?.status || null, location: location?.status || null } } }, requestId)
    }

    if (path === '/api/ponto/mirror' && request.method === 'GET') {
      if (!roleAllows(actor.role, 'unit.read') && !isConsultor(actor)) return failure(403, 'FORBIDDEN', requestId)
      const records = await listRecords(db, actor, url)
      return records ? json(200, { ok: true, data: records }, requestId) : failure(400, 'EMPLOYEE_REQUIRED', requestId)
    }

    if (['/api/ponto/daily', '/api/ponto/monthly', '/api/ponto/inconsistencies', '/api/ponto/bank'].includes(path) && request.method === 'GET') {
      const employeeId = cleanText(url.searchParams.get('employeeId'), 120)
      const unitId = cleanText(url.searchParams.get('unitId') || url.searchParams.get('unit'), 120)
      const employee = isConsultor(actor) ? await employeeForActor(db, actor) : await employeeById(db, actor, employeeId, unitId)
      if (!employee || !unitId) return failure(400, 'EMPLOYEE_AND_UNIT_REQUIRED', requestId)
      if (path === '/api/ponto/daily') {
        const date = dateOnly(url.searchParams.get('date'))
        if (!date) return failure(400, 'DATE_REQUIRED', requestId)
        return json(200, { ok: true, data: await calculationForDate(db, employee.id, unitId, date) }, requestId)
      }
      const month = monthOnly(url.searchParams.get('month'))
      const start = dateOnly(url.searchParams.get('from')) || (month ? `${month}-01` : '')
      const daysInMonth = month ? new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0)).getUTCDate() : 0
      const end = dateOnly(url.searchParams.get('to')) || (month ? addDays(`${month}-01`, daysInMonth - 1) : '')
      if (!start || !end || start > end) return failure(400, 'PERIOD_REQUIRED', requestId)
      const period = await periodCalculation(db, employee.id, unitId, start, end)
      if (path === '/api/ponto/inconsistencies') return json(200, { ok: true, data: period.days.filter((day) => day.inconsistencies?.length || day.status === 'MISSING') }, requestId)
      if (path === '/api/ponto/bank') return json(200, { ok: true, data: { employeeId: employee.id, unitId, from: start, to: end, openingBalanceMinutes: period.openingBalanceMinutes, closingBalanceMinutes: period.closingBalanceMinutes, entries: period.days.map((day) => ({ date: day.date, minutes: day.dailyBalanceMinutes, accumulatedMinutes: day.accumulatedBalanceMinutes, frozen: day.frozen })) } }, requestId)
      return json(200, { ok: true, data: { employee: publicEmployee(employee), unitId, from: start, to: end, ...period } }, requestId)
    }

    if (path === '/api/ponto/corrections' && request.method === 'POST') {
      if (!roleAllows(actor.role, 'correction.request') && !isConsultor(actor)) return failure(403, 'FORBIDDEN', requestId)
      const body = await readJson(request); const reason = cleanText(body?.reason, 500); const proposed = body?.proposedAtUtc ? new Date(body.proposedAtUtc).toISOString() : ''
      const event = await db.prepare('SELECT * FROM timekeeping_events WHERE id=?').bind(cleanText(body?.eventId, 120)).first()
      const employee = event ? await employeeById(db, actor, event.employee_id, event.unit_id) : null
      if (!event || !employee || !reason || !proposed) return failure(400, 'INVALID_CORRECTION', requestId)
      if (await isPeriodClosed(db, event.employee_id, event.unit_id, event.work_date || event.occurred_at_utc)) return failure(409, 'PERIOD_CLOSED', requestId)
      const id = crypto.randomUUID(); const at = now()
      await db.batch([
        db.prepare('INSERT INTO timekeeping_corrections (id, event_id, requested_at, requested_by, reason, proposed_at_utc) VALUES (?, ?, ?, ?, ?, ?)').bind(id, event.id, at, actor.id, reason, proposed),
        await audit(db, { actor, action: 'CORRECTION_REQUEST', entityType: 'timekeeping_correction', entityId: id, unitId: event.unit_id, requestId, reason, before: { occurredAt: event.occurred_at_utc }, after: { proposedAtUtc: proposed } }),
      ])
      return json(201, { ok: true, data: { id, status: 'PENDING' } }, requestId)
    }

    if (path === '/api/ponto/corrections' && request.method === 'GET') {
      if (!roleAllows(actor.role, 'unit.read') && !isConsultor(actor)) return failure(403, 'FORBIDDEN', requestId)
      const status = cleanText(url.searchParams.get('status'), 20).toUpperCase(); const unitId = cleanText(url.searchParams.get('unitId'), 120)
      const rows = await db.prepare(`SELECT c.id, c.event_id, c.requested_at, c.requested_by, c.reason, c.proposed_at_utc, c.status, c.decided_at, c.decided_by, c.decision_reason, e.employee_id, e.unit_id, e.occurred_at_utc, w.display_name AS employee_name FROM timekeeping_corrections c JOIN timekeeping_events e ON e.id=c.event_id JOIN workforce_employees w ON w.id=e.employee_id WHERE (?='' OR c.status=?) AND (?='' OR e.unit_id=?) ORDER BY c.requested_at DESC LIMIT ?`).bind(status, status, unitId, unitId, limitFor(url, 100, 300)).all()
      const data = (rows.results || []).filter((row) => isConsultor(actor) ? row.requested_by === actor.id : requireUnit(actor, row.unit_id)).map((row) => ({ id: row.id, eventId: row.event_id, employeeId: row.employee_id, employeeName: row.employee_name, unitId: row.unit_id, originalAtUtc: row.occurred_at_utc, proposedAtUtc: row.proposed_at_utc, requestedAt: row.requested_at, requestedBy: row.requested_by, reason: row.reason, status: row.status, decidedAt: row.decided_at, decidedBy: row.decided_by, decisionReason: row.decision_reason }))
      return json(200, { ok: true, data }, requestId)
    }

    if (path === '/api/ponto/schedule/sync' && request.method === 'POST') {
      if (!canManageWorkforce(actor)) return failure(403, 'FORBIDDEN', requestId)
      const body = await readJson(request); const unitId = cleanText(body?.unitId, 120); const month = monthOnly(body?.month)
      if (!unitId || !month || !requireUnit(actor, unitId)) return failure(400, 'UNIT_AND_MONTH_REQUIRED', requestId)
      const result = await syncSchedule(db, env, actor, unitId, month, requestId)
      return json(200, { ok: true, data: result }, requestId)
    }

    const correctionDecision = path.match(/^\/api\/ponto\/corrections\/([^/]+)\/(approve|reject)$/)
    if (correctionDecision && request.method === 'POST') {
      if (!roleAllows(actor.role, 'correction.approve')) return failure(403, 'FORBIDDEN', requestId)
      const body = await readJson(request); const reason = cleanText(body?.reason, 500)
      if (!reason) return failure(400, 'JUSTIFICATION_REQUIRED', requestId)
      const correction = await db.prepare(`SELECT c.*, e.unit_id, e.employee_id, e.occurred_at_utc, e.work_date FROM timekeeping_corrections c JOIN timekeeping_events e ON e.id=c.event_id WHERE c.id=?`).bind(decodeURIComponent(correctionDecision[1])).first()
      if (!correction || correction.status !== 'PENDING') return failure(409, 'CORRECTION_NOT_PENDING', requestId)
      if (correction.requested_by === actor.id) return failure(409, 'SEGREGATION_OF_DUTIES', requestId)
      if (!requireUnit(actor, correction.unit_id)) return failure(403, 'UNIT_FORBIDDEN', requestId)
      if (await isPeriodClosed(db, correction.employee_id, correction.unit_id, correction.work_date || correction.occurred_at_utc)) return failure(409, 'PERIOD_CLOSED', requestId)
      const status = correctionDecision[2] === 'approve' ? 'APPROVED' : 'REJECTED'
      await db.batch([
        db.prepare('UPDATE timekeeping_corrections SET status=?, decided_at=?, decided_by=?, decision_reason=? WHERE id=? AND status=\'PENDING\'').bind(status, now(), actor.id, reason, correction.id),
        await audit(db, { actor, action: `CORRECTION_${status}`, entityType: 'timekeeping_correction', entityId: correction.id, unitId: correction.unit_id, requestId, reason, before: { status: 'PENDING' }, after: { status } }),
      ])
      return json(200, { ok: true, data: { id: correction.id, status } }, requestId)
    }

    if (path === '/api/ponto/devices' && request.method === 'GET') {
      if (!roleAllows(actor.role, 'unit.read') && !roleAllows(actor.role, 'device.manage')) return failure(403, 'FORBIDDEN', requestId)
      const unitId = cleanText(url.searchParams.get('unitId') || url.searchParams.get('unit'), 120)
      const rows = await db.prepare(`SELECT id, unit_id, label, active, revoked_at, created_at, last_seen_at, device_mode, network_policy, allowed_networks_json FROM timekeeping_devices WHERE (?='' OR unit_id=?) ORDER BY created_at DESC LIMIT ?`).bind(unitId, unitId, limitFor(url)).all()
      const data = (rows.results || []).filter((row) => requireUnit(actor, row.unit_id)).map((row) => ({ id: row.id, unit: row.unit_id, unitId: row.unit_id, label: row.label, active: !!row.active, revokedAt: row.revoked_at, createdAt: row.created_at, lastSeenAt: row.last_seen_at, deviceMode: row.device_mode, networkPolicy: row.network_policy, allowedNetworksCount: storedNetworks(row.allowed_networks_json).length }))
      return json(200, { ok: true, data }, requestId)
    }

    if (path === '/api/ponto/devices' && request.method === 'POST') {
      if (!roleAllows(actor.role, 'device.manage')) return failure(403, 'FORBIDDEN', requestId)
      const body = await readJson(request); const unitId = cleanText(body?.unitId || body?.unit, 120); const label = cleanText(body?.label, 180)
      if (!unitId || !label || !requireUnit(actor, unitId)) return failure(400, 'INVALID_DEVICE', requestId)
      const deviceMode = String(body?.deviceMode || 'TERMINAL').trim().toUpperCase()
      if (deviceMode !== 'TERMINAL') return failure(400, 'TERMINAL_DEVICE_REQUIRED', requestId)
      const networkPolicy = normalizeNetworkPolicy(body?.networkPolicy)
      const networks = normalizeNetworks(body?.allowedNetworks)
      if (networkPolicy === 'REQUIRE' && !networks.length) return failure(400, 'NETWORKS_REQUIRED', requestId)
      const token = `ptd_${crypto.randomUUID().replace(/-/g, '')}${crypto.randomUUID().replace(/-/g, '')}`; const id = crypto.randomUUID(); const at = now()
      await db.batch([
        db.prepare('INSERT INTO timekeeping_devices (id, unit_id, label, token_hash, device_mode, network_policy, allowed_networks_json, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)').bind(id, unitId, label, await sha256(token), deviceMode, networkPolicy, JSON.stringify(networks), actor.id, at),
        await audit(db, { actor, action: 'DEVICE_CREATE', entityType: 'timekeeping_device', entityId: id, unitId, requestId, after: { label, deviceMode, networkPolicy, allowedNetworksCount: networks.length } }),
      ])
      return json(201, { ok: true, data: { id, unitId, label, active: true, deviceMode, networkPolicy, allowedNetworksCount: networks.length, token } }, requestId)
    }

    const presencePolicyPath = path.match(/^\/api\/ponto\/presence-policies\/([^/]+)$/)
    if (presencePolicyPath && ['GET', 'PATCH'].includes(request.method)) {
      if (!roleAllows(actor.role, 'device.manage')) return failure(403, 'FORBIDDEN', requestId)
      const unitId = decodeURIComponent(presencePolicyPath[1])
      if (!requireUnit(actor, unitId)) return failure(403, 'UNIT_FORBIDDEN', requestId)
      if (request.method === 'GET') {
        const policy = await presencePolicyFor(db, unitId)
        return json(200, { ok: true, data: { unitId, presenceMode: normalizePresenceMode(policy.presence_mode), geofenceLatitude: policy.geofence_latitude, geofenceLongitude: policy.geofence_longitude, geofenceRadiusMeters: Number(policy.geofence_radius_meters || 150) } }, requestId)
      }
      const body = await readJson(request); const presenceMode = normalizePresenceMode(body?.presenceMode); const latitude = body?.geofenceLatitude === null || body?.geofenceLatitude === '' ? null : Number(body?.geofenceLatitude); const longitude = body?.geofenceLongitude === null || body?.geofenceLongitude === '' ? null : Number(body?.geofenceLongitude); const radius = Math.round(Number(body?.geofenceRadiusMeters || 150))
      const hasLocation = latitude !== null || longitude !== null
      if ((hasLocation && (!Number.isFinite(latitude) || latitude < -90 || latitude > 90 || !Number.isFinite(longitude) || longitude < -180 || longitude > 180)) || !Number.isFinite(radius) || radius < 25 || radius > 5000 || (presenceMode === 'EXTERNAL_REVIEW' && !hasLocation)) return failure(400, 'INVALID_PRESENCE_POLICY', requestId)
      const at = now()
      await db.batch([
        db.prepare(`INSERT INTO timekeeping_unit_presence_policies (unit_id, presence_mode, geofence_latitude, geofence_longitude, geofence_radius_meters, created_at, updated_at, updated_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(unit_id) DO UPDATE SET presence_mode=excluded.presence_mode, geofence_latitude=excluded.geofence_latitude, geofence_longitude=excluded.geofence_longitude, geofence_radius_meters=excluded.geofence_radius_meters, updated_at=excluded.updated_at, updated_by=excluded.updated_by`).bind(unitId, presenceMode, latitude, longitude, radius, at, at, actor.id),
        await audit(db, { actor, action: 'PRESENCE_POLICY_UPDATE', entityType: 'timekeeping_unit_presence_policy', entityId: unitId, unitId, requestId, after: { presenceMode, geofenceConfigured: hasLocation, geofenceRadiusMeters: radius } }),
      ])
      return json(200, { ok: true, data: { unitId, presenceMode, geofenceLatitude: latitude, geofenceLongitude: longitude, geofenceRadiusMeters: radius } }, requestId)
    }

    const deviceRevoke = path.match(/^\/api\/ponto\/devices\/([^/]+)\/revoke$/)
    if (deviceRevoke && request.method === 'POST') {
      if (!roleAllows(actor.role, 'device.manage')) return failure(403, 'FORBIDDEN', requestId)
      const device = await db.prepare('SELECT * FROM timekeeping_devices WHERE id=?').bind(decodeURIComponent(deviceRevoke[1])).first()
      if (!device || !requireUnit(actor, device.unit_id)) return failure(404, 'DEVICE_NOT_FOUND', requestId)
      await db.batch([db.prepare('UPDATE timekeeping_devices SET active=0, revoked_at=? WHERE id=?').bind(now(), device.id), await audit(db, { actor, action: 'DEVICE_REVOKE', entityType: 'timekeeping_device', entityId: device.id, unitId: device.unit_id, requestId, reason: cleanText((await readJson(request))?.reason, 500) })])
      return json(200, { ok: true, data: { id: device.id, active: false } }, requestId)
    }

    const pinConfigure = path.match(/^\/api\/ponto\/pin\/configure(?:\/([^/]+))?$/)
    if (pinConfigure && request.method === 'POST') {
      if (!canManageWorkforce(actor)) return failure(403, 'FORBIDDEN', requestId)
      const body = await readJson(request); const employeeId = decodeURIComponent(pinConfigure[1] || cleanText(body?.employeeId, 120)); const employee = await employeeById(db, actor, employeeId)
      if (!employee) return failure(404, 'EMPLOYEE_NOT_FOUND', requestId)
      let credential
      try { credential = await hashPin(body?.pin, Number(env.PONTO_PIN_ITERATIONS || 150000)) } catch { return failure(400, 'PIN_INVALID', requestId) }
      await db.batch([
        db.prepare(`INSERT INTO timekeeping_pin_credentials (employee_id, algorithm, salt_b64, hash_b64, iterations, updated_by, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT(employee_id) DO UPDATE SET algorithm=excluded.algorithm, salt_b64=excluded.salt_b64, hash_b64=excluded.hash_b64, iterations=excluded.iterations, updated_by=excluded.updated_by, updated_at=excluded.updated_at`).bind(employee.id, credential.algorithm, credential.saltB64, credential.hashB64, credential.iterations, actor.id, now()),
        db.prepare('DELETE FROM timekeeping_pin_failures WHERE employee_id=?').bind(employee.id),
        await audit(db, { actor, action: 'PIN_CONFIGURE', entityType: 'workforce_employee', entityId: employee.id, requestId, after: { configured: true, algorithm: credential.algorithm } }),
      ])
      return json(200, { ok: true, data: { employeeId: employee.id, configured: true } }, requestId)
    }

    const biometricEnroll = path.match(/^\/api\/ponto\/biometrics\/enroll(?:\/([^/]+))?$/)
    if (biometricEnroll && request.method === 'POST') {
      if (!canManageWorkforce(actor)) return failure(403, 'FORBIDDEN', requestId)
      if (!env.PONTO_TEMPLATES_KEY) return failure(503, 'BIOMETRIC_KEY_NOT_CONFIGURED', requestId)
      const body = await readJson(request); const employeeId = decodeURIComponent(biometricEnroll[1] || cleanText(body?.employeeId, 120)); const employee = await employeeById(db, actor, employeeId)
      const descriptors = body?.descriptors || (body?.descriptor ? [body.descriptor] : [])
      if (!employee || body?.consentConfirmed !== true || !Array.isArray(descriptors) || !descriptors.length || descriptors.length > 10) return failure(400, 'INVALID_BIOMETRIC_ENROLLMENT', requestId)
      const statements = []
      if (body.replace) statements.push(db.prepare('UPDATE timekeeping_biometric_templates SET revoked_at=?, revoked_by=? WHERE employee_id=? AND revoked_at IS NULL').bind(now(), actor.id, employee.id))
      const enrolledAt = now()
      for (const descriptor of descriptors) statements.push(db.prepare('INSERT INTO timekeeping_biometric_templates (id, employee_id, encrypted_template, consent_version, consented_at, consented_by, expires_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)').bind(crypto.randomUUID(), employee.id, await encryptTemplate(descriptor, env.PONTO_TEMPLATES_KEY), cleanText(body.consentVersion, 80) || 'operational-v1', enrolledAt, actor.id, body.expiresAt ? new Date(body.expiresAt).toISOString() : null, enrolledAt))
      statements.push(await audit(db, { actor, action: 'BIOMETRIC_ENROLL', entityType: 'workforce_employee', entityId: employee.id, requestId, after: { templateCount: descriptors.length, consentVersion: cleanText(body.consentVersion, 80) || 'operational-v1' } }))
      await db.batch(statements)
      return json(201, { ok: true, data: { employeeId: employee.id, enrolled: descriptors.length } }, requestId)
    }

    if (path === '/api/ponto/biometrics/revoke' && request.method === 'POST') {
      if (!canManageWorkforce(actor)) return failure(403, 'FORBIDDEN', requestId)
      const body = await readJson(request); const employee = await employeeById(db, actor, cleanText(body?.employeeId, 120)); const reason = cleanText(body?.reason, 500)
      if (!employee || !reason) return failure(400, 'EMPLOYEE_AND_REASON_REQUIRED', requestId)
      await db.batch([db.prepare('UPDATE timekeeping_biometric_templates SET revoked_at=?, revoked_by=? WHERE employee_id=? AND revoked_at IS NULL').bind(now(), actor.id, employee.id), await audit(db, { actor, action: 'BIOMETRIC_REVOKE', entityType: 'workforce_employee', entityId: employee.id, requestId, reason, after: { revoked: true } })])
      return json(200, { ok: true, data: { employeeId: employee.id, revoked: true } }, requestId)
    }

    if (path === '/api/ponto/periods/close' && request.method === 'POST') {
      if (!roleAllows(actor.role, 'period.close')) return failure(403, 'FORBIDDEN', requestId)
      const body = await readJson(request); const employee = await employeeById(db, actor, cleanText(body?.employeeId, 120), cleanText(body?.unitId, 120)); const unitId = cleanText(body?.unitId, 120); const start = dateOnly(body?.from); const end = dateOnly(body?.to); const reason = cleanText(body?.reason, 500)
      if (!employee || !unitId || !start || !end || start > end || !reason) return failure(400, 'INVALID_PERIOD_CLOSE', requestId)
      const active = await db.prepare(`SELECT id FROM timekeeping_period_closures WHERE employee_id=? AND unit_id=? AND period_start=? AND period_end=? AND status='CLOSED' LIMIT 1`).bind(employee.id, unitId, start, end).first()
      if (active) return failure(409, 'PERIOD_ALREADY_CLOSED', requestId)
      const id = crypto.randomUUID(); const guardedDates = datesBetween(start, end); const guardedAt = now()
      try {
        await db.batch(guardedDates.map((date) => db.prepare(`INSERT INTO timekeeping_period_guards (employee_id, unit_id, work_date, operation_id, status, created_at) VALUES (?, ?, ?, ?, 'CLOSING', ?)`).bind(employee.id, unitId, date, id, guardedAt)))
      } catch { return failure(409, 'PERIOD_CLOSING_OR_CLOSED', requestId) }
      try {
        const period = await periodCalculation(db, employee.id, unitId, start, end); const rule = await resolveRule(db, employee.id, unitId, start); const revisionRow = await db.prepare('SELECT MAX(revision) AS revision FROM timekeeping_period_closures WHERE employee_id=? AND unit_id=? AND period_start=? AND period_end=?').bind(employee.id, unitId, start, end).first(); const revision = Number(revisionRow?.revision || 0) + 1
        const checksum = await sha256(JSON.stringify(period.days.map((day) => ({ date: day.date, eventIds: day.eventIds, balance: day.dailyBalanceMinutes }))))
        const statements = [db.prepare(`INSERT INTO timekeeping_period_closures (id, employee_id, unit_id, period_start, period_end, status, revision, rules_snapshot_json, input_checksum, calculation_version, closed_by, closed_at) VALUES (?, ?, ?, ?, ?, 'CLOSED', ?, ?, ?, ?, ?, ?)`).bind(id, employee.id, unitId, start, end, revision, JSON.stringify(rule), checksum, env.APP_VERSION || '1.0.0', actor.id, now())]
        for (const day of period.days) statements.push(db.prepare('INSERT INTO timekeeping_daily_snapshots (id, closure_id, employee_id, work_date, calculation_json, created_at) VALUES (?, ?, ?, ?, ?, ?)').bind(crypto.randomUUID(), id, employee.id, day.date, JSON.stringify(day), now()))
        statements.push(db.prepare(`UPDATE timekeeping_period_guards SET status='CLOSED', closure_id=? WHERE operation_id=? AND status='CLOSING'`).bind(id, id))
        statements.push(await audit(db, { actor, action: 'PERIOD_CLOSE', entityType: 'timekeeping_period_closure', entityId: id, unitId, requestId, reason, after: { employeeId: employee.id, start, end, revision, checksum } }))
        await db.batch(statements)
        return json(201, { ok: true, data: { id, status: 'CLOSED', revision, checksum, days: period.days.length } }, requestId)
      } catch (error) {
        await db.prepare(`DELETE FROM timekeeping_period_guards WHERE operation_id=? AND status='CLOSING'`).bind(id).run().catch(() => {})
        throw error
      }
    }

    if (path === '/api/ponto/periods/reopen' && request.method === 'POST') {
      if (!roleAllows(actor.role, 'period.reopen')) return failure(403, 'FORBIDDEN', requestId)
      const body = await readJson(request); const reason = cleanText(body?.reason, 500); const closure = await db.prepare(`SELECT * FROM timekeeping_period_closures WHERE id=? AND status='CLOSED'`).bind(cleanText(body?.closureId, 120)).first()
      if (!closure || !reason || !requireUnit(actor, closure.unit_id)) return failure(400, 'INVALID_PERIOD_REOPEN', requestId)
      await db.batch([db.prepare(`UPDATE timekeeping_period_closures SET status='REOPENED', reopened_by=?, reopened_at=?, reopen_reason=? WHERE id=? AND status='CLOSED'`).bind(actor.id, now(), reason, closure.id), db.prepare('DELETE FROM timekeeping_period_guards WHERE closure_id=?').bind(closure.id), await audit(db, { actor, action: 'PERIOD_REOPEN', entityType: 'timekeeping_period_closure', entityId: closure.id, unitId: closure.unit_id, requestId, reason, before: { status: 'CLOSED' }, after: { status: 'REOPENED' } })])
      return json(200, { ok: true, data: { id: closure.id, status: 'REOPENED' } }, requestId)
    }

    if (path === '/api/ponto/audit' && request.method === 'GET') {
      if (!roleAllows(actor.role, 'audit.read')) return failure(403, 'FORBIDDEN', requestId)
      const unitId = cleanText(url.searchParams.get('unitId'), 120); const rows = await db.prepare(`SELECT id, occurred_at, actor_id, actor_role, action, entity_type, entity_id, unit_id, reason, request_id, origin, prev_hash, hash FROM timekeeping_audit_events WHERE (?='' OR unit_id=?) ORDER BY occurred_at DESC LIMIT ?`).bind(unitId, unitId, limitFor(url, 100, 500)).all()
      return json(200, { ok: true, data: (rows.results || []).filter((row) => !row.unit_id || requireUnit(actor, row.unit_id)) }, requestId)
    }

    if (path === '/api/ponto/export' && request.method === 'GET') {
      if (!roleAllows(actor.role, 'export.read')) return failure(403, 'FORBIDDEN', requestId)
      const unitId = cleanText(url.searchParams.get('unitId') || url.searchParams.get('unit'), 120); if (unitId && !requireUnit(actor, unitId)) return failure(403, 'UNIT_FORBIDDEN', requestId)
      const employeeId = cleanText(url.searchParams.get('employeeId'), 120); const from = cleanText(url.searchParams.get('from'), 40); const to = cleanText(url.searchParams.get('to'), 40)
      if (employeeId && !await employeeById(db, actor, employeeId, unitId)) return failure(403, 'EMPLOYEE_FORBIDDEN', requestId)
      const rows = await db.prepare(`SELECT e.employee_id, w.display_name, e.unit_id, e.event_type, e.source, e.occurred_at_utc, e.device_id FROM timekeeping_events e JOIN workforce_employees w ON w.id=e.employee_id WHERE (?='' OR e.unit_id=?) AND (?='' OR e.employee_id=?) AND (?='' OR e.occurred_at_utc>=?) AND (?='' OR e.occurred_at_utc<=?) ORDER BY e.occurred_at_utc DESC LIMIT 10000`).bind(unitId, unitId, employeeId, employeeId, from, from, to, to).all()
      const csv = ['employeeId,employeeName,unitId,eventType,source,occurredAtUtc,deviceId', ...(rows.results || []).filter((row) => requireUnit(actor, row.unit_id)).map((row) => [row.employee_id, row.display_name, row.unit_id, row.event_type, row.source, row.occurred_at_utc, row.device_id].map(csvCell).join(','))].join('\n')
      return new Response(csv, { headers: { 'content-type': 'text/csv; charset=utf-8', 'content-disposition': 'attachment; filename="ponto.csv"', 'cache-control': 'no-store', 'x-request-id': requestId } })
    }

    if (path === '/api/ponto/admin/conflicts/login-email' && request.method === 'GET') {
      if (!canManageWorkforce(actor)) return failure(403, 'FORBIDDEN', requestId)
      const rows = await db.prepare(`SELECT id, source_id, candidates_json FROM workforce_identity_conflicts WHERE source='PONTO_LOGIN_EMAIL' AND status='OPEN' ORDER BY created_at`).all()
      const data = []
      for (const conflict of rows.results || []) {
        const employees = []
        let allCandidatesVisible = true
        for (const id of JSON.parse(conflict.candidates_json || '[]')) {
          const employee = await db.prepare('SELECT * FROM workforce_employees WHERE id=?').bind(id).first()
          if (!employee || !await employeeVisible(db, actor, employee)) {
            allCandidatesVisible = false
            continue
          }
          employees.push({ ...publicEmployee(employee), loginEmail: employee.login_email || undefined, active: employee.status === 'ACTIVE' })
        }
        // A Supervisor is never shown part of a cross-unit identity conflict.
        if (allCandidatesVisible) data.push({ id: conflict.id, email: conflict.source_id, count: employees.length, employees })
      }
      return json(200, { ok: true, data }, requestId)
    }

    if (path === '/api/ponto/admin/conflicts/login-email/resolve' && request.method === 'POST') {
      if (!canManageWorkforce(actor)) return failure(403, 'FORBIDDEN', requestId)
      const body = await readJson(request); const email = cleanText(body?.email, 240).toLowerCase(); const keepId = cleanText(body?.keepEmployeeId, 120)
      const conflict = await db.prepare(`SELECT * FROM workforce_identity_conflicts WHERE source='PONTO_LOGIN_EMAIL' AND source_id=? AND status='OPEN' LIMIT 1`).bind(email).first()
      const candidates = conflict ? JSON.parse(conflict.candidates_json || '[]') : []
      if (!conflict || !candidates.includes(keepId)) return failure(400, 'INVALID_CONFLICT_RESOLUTION', requestId)
      for (const candidateId of candidates) {
        const candidate = await db.prepare('SELECT * FROM workforce_employees WHERE id=?').bind(candidateId).first()
        if (!candidate || !await employeeVisible(db, actor, candidate)) return failure(403, 'UNIT_FORBIDDEN', requestId)
      }
      await db.batch([
        db.prepare('UPDATE workforce_employees SET login_email=?, updated_at=? WHERE id=?').bind(email, now(), keepId),
        db.prepare(`UPDATE workforce_identity_conflicts SET status='RESOLVED', resolved_at=?, resolved_by=? WHERE id=?`).bind(now(), actor.id, conflict.id),
        await audit(db, { actor, action: 'IDENTITY_CONFLICT_RESOLVE', entityType: 'workforce_identity_conflict', entityId: conflict.id, requestId, reason: 'human-reviewed email ownership', after: { email, keepEmployeeId: keepId, unlinkedEmployeeIds: candidates.filter((id) => id !== keepId) } }),
      ])
      return json(200, { ok: true, data: { id: conflict.id, status: 'RESOLVED', keepEmployeeId: keepId } }, requestId)
    }

    return failure(404, 'NOT_FOUND', requestId)
  } catch (error) {
    logEvent('request_failure', { requestId, path, method: request.method, latencyMs: Date.now() - startedAt, errorCode: cleanText(error?.message || 'INTERNAL_ERROR', 120) })
    return failure(500, 'INTERNAL_ERROR', requestId)
  }
}

export default { fetch: handleTimekeeping }
export const __testables = { normalizeWorkforceRole, roleAllows, requireUnit, canonicalEventType, calculateDay, calculatePeriod, csvCell, eventsForWorkDate, isFacePunchEnabled, verifyPunchCredential, profileInput, profileDocumentStatus, normalizeNetworks, ipInNetwork, locationEvidence, normalizePresenceMode, normalizeNetworkPolicy }
