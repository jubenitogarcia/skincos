import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react-swc";
import { createHmac, randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { defineConfig } from "vite";
import type { PluginOption } from "vite";

function createIconImportProxy() {
  return {
    name: 'mock-icon-import-proxy',
    configureServer() { },
    transform() {
      return null
    }
  }
}

function sparkPlugin() {
  return {
    name: 'mock-spark-plugin',
    configureServer() { },
    transform() {
      return null
    }
  }
}

function loadLocalEnvFile(filePath: string): Record<string, string> {
  if (!existsSync(filePath)) return {}

  const out: Record<string, string> = {}
  const raw = readFileSync(filePath, 'utf8')
  const lines = raw.split(/\r?\n/)

  for (const line of lines) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const match = trimmed.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/)
    if (!match) continue
    let value = match[2] ?? ''
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1)
    }
    out[match[1]] = value
  }

  return out
}

function parseBooleanEnv(value: unknown): boolean | null {
  const raw = String(value ?? '').trim().toLowerCase()
  if (!raw) return null
  if (raw === '1' || raw === 'true' || raw === 'yes' || raw === 'on') return true
  if (raw === '0' || raw === 'false' || raw === 'no' || raw === 'off') return false
  return null
}

const projectRoot = process.env.PROJECT_ROOT || import.meta.dirname
const localDevEnv = loadLocalEnvFile(resolve(projectRoot, '.dev.vars'))

function envValue(...keys: string[]): string | undefined {
  for (const key of keys) {
    const runtime = process.env[key]
    if (runtime !== undefined && runtime !== '') return runtime
    const localValue = localDevEnv[key]
    if (localValue !== undefined && localValue !== '') return localValue
  }
  return undefined
}

// https://vite.dev/config/
const apiProxyTarget =
  envValue('VITE_API_PROXY_TARGET', 'API_PROXY_TARGET') ||
  'http://localhost:8099'

const localAuthBypassEnabled =
  parseBooleanEnv(envValue('VITE_LOCAL_AUTH_BYPASS', 'LOCAL_AUTH_BYPASS')) ?? false
const localAuthRole = (() => {
  const raw = String(envValue('VITE_LOCAL_AUTH_ROLE', 'LOCAL_AUTH_ROLE') || 'GESTOR').trim().toUpperCase()
  if (raw === 'ADMIN') return 'GESTOR'
  if (raw === 'OPERADOR') return 'INJETOR'
  return raw || 'GESTOR'
})()
const localAuthEmail =
  String(envValue('VITE_LOCAL_AUTH_EMAIL', 'LOCAL_AUTH_EMAIL') || 'dev@local.test').trim() || 'dev@local.test'
const localAuthUsername =
  String(envValue('VITE_LOCAL_AUTH_USERNAME', 'LOCAL_AUTH_USERNAME') || localAuthEmail.split('@')[0] || 'dev').trim() || 'dev'
const localAuthName =
  String(envValue('VITE_LOCAL_AUTH_NAME', 'LOCAL_AUTH_NAME') || 'Dev Local').trim() || 'Dev Local'
const localAuthAllowedUnits = String(
  envValue('VITE_LOCAL_AUTH_ALLOWED_UNITS', 'LOCAL_AUTH_ALLOWED_UNITS') || '',
).trim()
  .split(',')
  .map((item) => item.trim())
  .filter(Boolean)
const localAuthAllowedModules = String(
  envValue('VITE_LOCAL_AUTH_ALLOWED_MODULES', 'LOCAL_AUTH_ALLOWED_MODULES') || '',
).trim()
  .split(',')
  .map((item) => item.trim())
  .filter(Boolean)

const escalaApiTarget = String(
  envValue('VITE_ESCALA_API_TARGET', 'ESCALA_API_TARGET') || '',
).trim()
const escalaActorHmacKey = String(
  envValue('VITE_ESCALA_ACTOR_HMAC_KEY', 'ESCALA_ACTOR_HMAC_KEY') || '',
).trim()
const localEscalaMockOverride = parseBooleanEnv(
  envValue(
    'VITE_LOCAL_ESCALA_MOCK',
    'LOCAL_ESCALA_MOCK',
    'ESCALA_LOCAL_MOCK',
    'DEV_ESCALA_MOCK',
  ),
)
const localEscalaMockEnabled =
  localAuthBypassEnabled && (localEscalaMockOverride ?? (!escalaApiTarget || !escalaActorHmacKey))
const localEscalaShadowWritesEnabled =
  !localEscalaMockEnabled &&
  (parseBooleanEnv(
    envValue(
      'VITE_LOCAL_ESCALA_SHADOW_WRITES',
      'LOCAL_ESCALA_SHADOW_WRITES',
      'ESCALA_LOCAL_SHADOW_WRITES',
      'DEV_ESCALA_SHADOW_WRITES',
    ),
  ) ?? localAuthBypassEnabled)
const localEscalaShadowPersistenceEnabled =
  parseBooleanEnv(
    envValue(
      'VITE_LOCAL_ESCALA_SHADOW_PERSIST',
      'LOCAL_ESCALA_SHADOW_PERSIST',
      'ESCALA_LOCAL_SHADOW_PERSIST',
      'DEV_ESCALA_SHADOW_PERSIST',
    ),
  ) ?? true
const escalaShadowFilePath = resolve(
  projectRoot,
  envValue('VITE_ESCALA_LOCAL_SHADOW_FILE', 'LOCAL_ESCALA_SHADOW_FILE') || '.local/escala-shadow.json',
)

const localAuthUser = {
  id: localAuthEmail || localAuthUsername || 'local-dev',
  username: localAuthUsername,
  email: localAuthEmail,
  displayName: localAuthName,
  role: localAuthRole,
  allowedUnits: localAuthAllowedUnits,
  allowedModules: localAuthAllowedModules,
  createdAt: new Date().toISOString()
}

type LocalProfessional = {
  name: string
  status: string
  units: string[]
  role: string
  shift: string
  nickname: string
  phone: string
  email: string
  instagram: string
}

type LocalScheduleEntry = { date: string; unit: string; professional: string }
type LocalClosedDay = { date: string; unit: string; reason: string }
type LocalHoliday = { date: string; unit: string; name: string }
type EscalaActor = {
  id: string
  username?: string
  email?: string
  name?: string
  role: string
  allowedUnits?: string[]
}

type ShadowOperation =
  | { kind: 'schedule_add'; date: string; unit: string; professionals: string[] }
  | { kind: 'schedule_replace'; date: string; unit: string; professionals: string[] }
  | { kind: 'schedule_remove'; date: string; unit: string; professional?: string }
  | { kind: 'closed_add'; date: string; unit: string; reason: string }
  | { kind: 'closed_remove'; date: string; unit: string }
  | { kind: 'holiday_add'; date: string; unit: string; name: string }
  | { kind: 'holiday_remove'; date: string; unit: string; name: string }

type EscalaShadowStore = {
  version: number
  savedAt: string | null
  byScope: Record<string, ShadowOperation[]>
}

const localEscalaStore: {
  professionals: LocalProfessional[]
  schedule: LocalScheduleEntry[]
  closedDays: LocalClosedDay[]
  holidays: LocalHoliday[]
} = {
  professionals: [
    {
      name: 'Dra. Ana',
      status: 'Ativo',
      units: ['novo-hamburgo'],
      role: 'Injetor',
      shift: 'Integral',
      nickname: 'Ana',
      phone: '',
      email: 'ana@local.test',
      instagram: ''
    },
    {
      name: 'Dr. Lucas',
      status: 'Ativo',
      units: ['novo-hamburgo', 'porto-alegre'],
      role: 'Injetor',
      shift: 'Integral',
      nickname: 'Lucas',
      phone: '',
      email: 'lucas@local.test',
      instagram: ''
    },
    {
      name: 'Dra. Carla',
      status: 'Ativo',
      units: ['porto-alegre'],
      role: 'Injetor',
      shift: 'Integral',
      nickname: 'Carla',
      phone: '',
      email: 'carla@local.test',
      instagram: ''
    }
  ],
  schedule: [],
  closedDays: [],
  holidays: []
}

function sanitizeShadowOperation(input: any): ShadowOperation | null {
  const kind = String(input?.kind || '').trim()
  const date = String(input?.date || '').trim()
  const unit = String(input?.unit || '').trim()

  if (!kind || !isValidIsoDate(date) || !unit) return null

  if (kind === 'schedule_add' || kind === 'schedule_replace') {
    const professionals = csvNames(input?.professionals)
    if (!professionals.length) return null
    return { kind, date, unit, professionals }
  }

  if (kind === 'schedule_remove') {
    const professional = String(input?.professional || '').trim() || undefined
    return { kind, date, unit, professional }
  }

  if (kind === 'closed_add') {
    const reason = String(input?.reason || '').trim() || 'Sem atendimento'
    return { kind, date, unit, reason }
  }

  if (kind === 'closed_remove') {
    return { kind, date, unit }
  }

  if (kind === 'holiday_add' || kind === 'holiday_remove') {
    const name = String(input?.name || '').trim()
    if (!name) return null
    return { kind, date, unit, name }
  }

  return null
}

function loadEscalaShadowStore(): EscalaShadowStore {
  const empty: EscalaShadowStore = { version: 1, savedAt: null, byScope: {} }
  if (!localEscalaShadowPersistenceEnabled || !existsSync(escalaShadowFilePath)) return empty

  try {
    const raw = JSON.parse(readFileSync(escalaShadowFilePath, 'utf8'))
    const source = raw && typeof raw === 'object' && raw.byScope && typeof raw.byScope === 'object'
      ? raw.byScope
      : {}
    const byScope: Record<string, ShadowOperation[]> = {}

    Object.entries(source).forEach(([key, ops]) => {
      const sanitized = Array.isArray(ops)
        ? ops.map((op) => sanitizeShadowOperation(op)).filter((op): op is ShadowOperation => !!op)
        : []
      if (sanitized.length) byScope[key] = sanitized
    })

    return {
      version: 1,
      savedAt: typeof raw?.savedAt === 'string' ? raw.savedAt : null,
      byScope,
    }
  } catch {
    return empty
  }
}

const escalaShadowStore: EscalaShadowStore = loadEscalaShadowStore()

function persistEscalaShadowStore() {
  escalaShadowStore.savedAt = new Date().toISOString()
  if (!localEscalaShadowPersistenceEnabled) return
  mkdirSync(dirname(escalaShadowFilePath), { recursive: true })
  writeFileSync(
    escalaShadowFilePath,
    JSON.stringify(
      {
        version: escalaShadowStore.version,
        savedAt: escalaShadowStore.savedAt,
        byScope: escalaShadowStore.byScope,
      },
      null,
      2,
    ),
    'utf8',
  )
}

function clearEscalaShadowStore() {
  Object.keys(escalaShadowStore.byScope).forEach((key) => {
    delete escalaShadowStore.byScope[key]
  })
  escalaShadowStore.savedAt = new Date().toISOString()
  if (!localEscalaShadowPersistenceEnabled) return
  try {
    rmSync(escalaShadowFilePath, { force: true })
  } catch {
    persistEscalaShadowStore()
  }
}

function toJson(res: any, status: number, body: any, extraHeaders: Record<string, string> = {}) {
  res.statusCode = status
  res.setHeader('content-type', 'application/json')
  res.setHeader('cache-control', 'no-store')
  Object.entries(extraHeaders).forEach(([key, value]) => res.setHeader(key, value))
  res.end(JSON.stringify(body))
}

function parseJsonBody(req: any): Promise<any> {
  return new Promise((resolvePromise) => {
    const chunks: Buffer[] = []
    req.on('data', (chunk: Buffer) => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)))
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8')
      if (!raw) return resolvePromise(null)
      try {
        resolvePromise(JSON.parse(raw))
      } catch {
        resolvePromise(null)
      }
    })
    req.on('error', () => resolvePromise(null))
  })
}

function readRawBody(req: any): Promise<Buffer> {
  return new Promise((resolvePromise) => {
    const chunks: Buffer[] = []
    req.on('data', (chunk: Buffer) => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)))
    req.on('end', () => resolvePromise(Buffer.concat(chunks)))
    req.on('error', () => resolvePromise(Buffer.alloc(0)))
  })
}

function parseJsonBuffer(rawBody: Buffer): any {
  if (!rawBody.length) return null
  try {
    return JSON.parse(rawBody.toString('utf8'))
  } catch {
    return null
  }
}

function isValidIsoDate(value: unknown): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(value || ''))
}

function csvNames(input: unknown): string[] {
  if (Array.isArray(input)) {
    return input.map((item) => String(item || '').trim()).filter(Boolean)
  }
  return String(input || '').split(',').map((item) => item.trim()).filter(Boolean)
}

function normalizeUnitKey(value: unknown): string {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '')
    .trim()
}

function canUseUnit(actor: EscalaActor, unit: string): boolean {
  const requested = normalizeUnitKey(unit)
  if (!requested) return true
  const allowed = Array.isArray(actor.allowedUnits) ? actor.allowedUnits : []
  if (!allowed.length) return true
  return allowed.some((item) => normalizeUnitKey(item) === requested)
}

function extractMonth(isoDate: string): string {
  return isoDate.slice(0, 7)
}

function buildScopeKey(unit: string, month: string): string {
  return `${unit}::${month}`
}

function pushShadowOperation(op: ShadowOperation) {
  const key = buildScopeKey(op.unit, extractMonth(op.date))
  if (!Array.isArray(escalaShadowStore.byScope[key])) escalaShadowStore.byScope[key] = []
  escalaShadowStore.byScope[key].push(op)
  persistEscalaShadowStore()
}

function listShadowOperations(unit?: string, month?: string): ShadowOperation[] {
  if (unit && month) {
    return [...(escalaShadowStore.byScope[buildScopeKey(unit, month)] || [])]
  }
  return Object.entries(escalaShadowStore.byScope)
    .filter(([key]) => {
      const [scopeUnit, scopeMonth] = key.split('::')
      if (unit && scopeUnit !== unit) return false
      if (month && scopeMonth !== month) return false
      return true
    })
    .flatMap(([, ops]) => ops || [])
}

function allShadowOperationCount(): number {
  return Object.values(escalaShadowStore.byScope).reduce((acc, ops) => acc + ops.length, 0)
}

function applyShadowOperationsToSchedulePayload(basePayload: any, ops: ShadowOperation[]): any {
  let schedule: LocalScheduleEntry[] = Array.isArray(basePayload?.schedule)
    ? basePayload.schedule.map((row: any) => ({
      date: String(row?.date || ''),
      unit: String(row?.unit || ''),
      professional: String(row?.professional || ''),
    })).filter((row) => row.date && row.unit && row.professional)
    : []

  let closedDays: LocalClosedDay[] = Array.isArray(basePayload?.closedDays)
    ? basePayload.closedDays.map((row: any) => ({
      date: String(row?.date || ''),
      unit: String(row?.unit || ''),
      reason: String(row?.reason || ''),
    })).filter((row) => row.date && row.unit)
    : []

  let holidays: LocalHoliday[] = Array.isArray(basePayload?.holidays)
    ? basePayload.holidays.map((row: any) => ({
      date: String(row?.date || ''),
      unit: String(row?.unit || ''),
      name: String(row?.name || ''),
    })).filter((row) => row.date && row.unit && row.name)
    : []

  for (const op of ops) {
    if (op.kind === 'schedule_add') {
      op.professionals.forEach((professional) => {
        const exists = schedule.some((row) => row.date === op.date && row.unit === op.unit && row.professional === professional)
        if (!exists) schedule.push({ date: op.date, unit: op.unit, professional })
      })
      continue
    }

    if (op.kind === 'schedule_replace') {
      schedule = schedule.filter((row) => !(row.date === op.date && row.unit === op.unit))
      op.professionals.forEach((professional) => {
        schedule.push({ date: op.date, unit: op.unit, professional })
      })
      continue
    }

    if (op.kind === 'schedule_remove') {
      schedule = schedule.filter((row) => {
        if (row.date !== op.date || row.unit !== op.unit) return true
        if (!op.professional) return false
        return row.professional !== op.professional
      })
      continue
    }

    if (op.kind === 'closed_add') {
      closedDays = closedDays.filter((row) => !(row.date === op.date && row.unit === op.unit))
      closedDays.push({ date: op.date, unit: op.unit, reason: op.reason })
      continue
    }

    if (op.kind === 'closed_remove') {
      closedDays = closedDays.filter((row) => !(row.date === op.date && row.unit === op.unit))
      continue
    }

    if (op.kind === 'holiday_add') {
      const exists = holidays.some((row) => row.date === op.date && row.unit === op.unit && row.name === op.name)
      if (!exists) holidays.push({ date: op.date, unit: op.unit, name: op.name })
      continue
    }

    holidays = holidays.filter((row) => !(row.date === op.date && row.unit === op.unit && row.name === op.name))
  }

  return {
    ...(basePayload && typeof basePayload === 'object' ? basePayload : {}),
    ok: true,
    schedule,
    closedDays,
    holidays,
    source: 'upstream+local-shadow',
  }
}

function applyShadowOperationsToOverviewPayload(basePayload: any, ops: ShadowOperation[]): any {
  const units = new Set<string>(Array.isArray(basePayload?.units) ? basePayload.units.map(String) : [])
  const months = new Set<string>(Array.isArray(basePayload?.months) ? basePayload.months.map(String) : [])

  ops.forEach((op) => {
    units.add(op.unit)
    months.add(extractMonth(op.date))
  })

  return {
    ...(basePayload && typeof basePayload === 'object' ? basePayload : {}),
    ok: true,
    units: Array.from(units).sort(),
    months: Array.from(months).sort(),
    source: 'upstream+local-shadow',
  }
}

async function handleLocalShadowWrite(
  res: any,
  path: string,
  method: string,
  actor: EscalaActor,
  payload: any,
  requestId: string,
): Promise<void> {
  const done = (status: number, body: any) => toJson(res, status, body, { 'x-request-id': requestId })

  if (path === '/api/escala/schedule') {
    const date = String(payload?.date || '').trim()
    const unit = String(payload?.unit || '').trim()

    if (!isValidIsoDate(date) || !unit) {
      done(400, { ok: false, error: 'INVALID_PAYLOAD' })
      return
    }
    if (!canUseUnit(actor, unit)) {
      done(403, { ok: false, error: 'FORBIDDEN_UNIT' })
      return
    }

    if (method === 'POST') {
      const professionals = csvNames(payload?.professionals || payload?.professional)
      if (!professionals.length) {
        done(400, { ok: false, error: 'INVALID_PAYLOAD' })
        return
      }
      pushShadowOperation({ kind: 'schedule_add', date, unit, professionals })
      done(200, { ok: true, source: 'local-shadow', shadowWrite: true })
      return
    }

    if (method === 'PUT') {
      const professionals = csvNames(payload?.professionals)
      if (!professionals.length) {
        done(400, { ok: false, error: 'INVALID_PAYLOAD' })
        return
      }
      pushShadowOperation({ kind: 'schedule_replace', date, unit, professionals })
      done(200, { ok: true, source: 'local-shadow', shadowWrite: true })
      return
    }

    if (method === 'DELETE') {
      const professional = String(payload?.professional || '').trim() || undefined
      pushShadowOperation({ kind: 'schedule_remove', date, unit, professional })
      done(200, { ok: true, source: 'local-shadow', shadowWrite: true })
      return
    }
  }

  if (path === '/api/escala/closed-days') {
    const date = String(payload?.date || '').trim()
    const unit = String(payload?.unit || '').trim()
    if (!isValidIsoDate(date) || !unit) {
      done(400, { ok: false, error: 'INVALID_PAYLOAD' })
      return
    }
    if (!canUseUnit(actor, unit)) {
      done(403, { ok: false, error: 'FORBIDDEN_UNIT' })
      return
    }

    if (method === 'POST') {
      const reason = String(payload?.reason || '').trim() || 'Sem atendimento'
      pushShadowOperation({ kind: 'closed_add', date, unit, reason })
      done(200, { ok: true, source: 'local-shadow', shadowWrite: true })
      return
    }

    if (method === 'DELETE') {
      pushShadowOperation({ kind: 'closed_remove', date, unit })
      done(200, { ok: true, source: 'local-shadow', shadowWrite: true })
      return
    }
  }

  if (path === '/api/escala/holidays') {
    const date = String(payload?.date || '').trim()
    const unit = String(payload?.unit || '').trim()
    const name = String(payload?.name || '').trim()
    if (!isValidIsoDate(date) || !unit || !name) {
      done(400, { ok: false, error: 'INVALID_PAYLOAD' })
      return
    }
    if (!canUseUnit(actor, unit)) {
      done(403, { ok: false, error: 'FORBIDDEN_UNIT' })
      return
    }

    if (method === 'DELETE') {
      pushShadowOperation({ kind: 'holiday_remove', date, unit, name })
      done(200, { ok: true, source: 'local-shadow', shadowWrite: true })
      return
    }

    pushShadowOperation({ kind: 'holiday_add', date, unit, name })
    done(200, { ok: true, source: 'local-shadow', shadowWrite: true })
  }
}

function buildUpstreamHeaders(req: any, requestId: string): Headers {
  const allow = new Set([
    'accept',
    'content-type',
    'range',
    'if-none-match',
    'if-modified-since',
    'cache-control',
    'pragma',
    'user-agent',
  ])

  const headers = new Headers()
  Object.entries(req.headers || {}).forEach(([key, value]) => {
    if (!allow.has(key.toLowerCase()) || value == null) return
    headers.set(key, Array.isArray(value) ? value.join(', ') : String(value))
  })
  headers.set('x-request-id', requestId)
  return headers
}

async function writeFetchResponse(
  res: any,
  response: Response,
  extraHeaders: Record<string, string> = {},
) {
  res.statusCode = response.status
  response.headers.forEach((value, key) => {
    const normalized = key.toLowerCase()
    if (normalized === 'content-length' || normalized === 'transfer-encoding' || normalized === 'connection') return
    res.setHeader(key, value)
  })
  res.setHeader('cache-control', 'no-store')
  Object.entries(extraHeaders).forEach(([key, value]) => res.setHeader(key, value))
  const buffer = Buffer.from(await response.arrayBuffer())
  res.end(buffer)
}

async function maybeHandleLocalEscala(req: any, res: any): Promise<boolean> {
  if (!req.url || !req.url.startsWith('/api/escala')) return false

  const method = String(req.method || 'GET').toUpperCase()
  const url = new URL(req.url, 'http://localhost')
  const path = url.pathname
  const unit = String(url.searchParams.get('unit') || '').trim()
  const month = String(url.searchParams.get('month') || '').trim()
  const requestId = randomUUID()
  const actor: EscalaActor = {
    id: localAuthUser.id,
    username: localAuthUser.username,
    email: localAuthUser.email,
    name: localAuthUser.displayName,
    role: localAuthUser.role,
    allowedUnits: localAuthUser.allowedUnits,
  }

  if (path === '/api/escala/_proxy-status') {
    toJson(res, 200, {
      ok: true,
      localMockEnabled: localEscalaMockEnabled,
      localShadowWritesEnabled: localEscalaShadowWritesEnabled,
      localShadowPersistenceEnabled: localEscalaShadowPersistenceEnabled,
      shadowOperationCount: allShadowOperationCount(),
      shadowStorePath: escalaShadowFilePath,
      shadowSavedAt: escalaShadowStore.savedAt,
      targetConfigured: !!escalaApiTarget || localEscalaMockEnabled,
      actorKeyConfigured: !!escalaActorHmacKey || localEscalaMockEnabled,
      mode: localEscalaMockEnabled ? 'local-mock' : (localEscalaShadowWritesEnabled ? 'upstream+local-shadow' : 'upstream'),
      hint: !escalaApiTarget
        ? (localEscalaMockEnabled
          ? 'Usando mock local para /api/escala em localhost.'
          : 'Configure ESCALA_API_TARGET na configuracao local.')
        : undefined,
    }, { 'x-request-id': requestId })
    return true
  }

  if (path === '/api/escala/_local-shadow' && method === 'GET') {
    toJson(res, 200, {
      ok: true,
      persistenceEnabled: localEscalaShadowPersistenceEnabled,
      filePath: escalaShadowFilePath,
      savedAt: escalaShadowStore.savedAt,
      operationCount: allShadowOperationCount(),
      scopes: Object.entries(escalaShadowStore.byScope).map(([scope, ops]) => ({
        scope,
        operationCount: ops.length,
      })),
      byScope: escalaShadowStore.byScope,
    }, { 'x-request-id': requestId })
    return true
  }

  if (path === '/api/escala/_local-shadow' && method === 'DELETE') {
    clearEscalaShadowStore()
    toJson(res, 200, {
      ok: true,
      cleared: true,
      persistenceEnabled: localEscalaShadowPersistenceEnabled,
      filePath: escalaShadowFilePath,
      operationCount: allShadowOperationCount(),
    }, { 'x-request-id': requestId })
    return true
  }

  if (localEscalaMockEnabled) {
    if (path === '/api/escala/overview' && method === 'GET') {
      const units = new Set<string>()
      localEscalaStore.professionals.forEach((prof) => prof.units.forEach((u) => units.add(u)))
      localEscalaStore.schedule.forEach((row) => units.add(row.unit))
      localEscalaStore.closedDays.forEach((row) => units.add(row.unit))
      localEscalaStore.holidays.forEach((row) => units.add(row.unit))
      const months = new Set(localEscalaStore.schedule.map((row) => row.date.slice(0, 7)))
      toJson(res, 200, { ok: true, units: Array.from(units).sort(), months: Array.from(months).sort(), source: 'local-mock' }, { 'x-request-id': requestId })
      return true
    }

    if (path === '/api/escala/professionals' && method === 'GET') {
      const data = localEscalaStore.professionals.filter((prof) => !unit || !prof.units.length || prof.units.includes(unit))
      toJson(res, 200, { ok: true, data, source: 'local-mock' }, { 'x-request-id': requestId })
      return true
    }

    if (path === '/api/escala/professionals' && method === 'POST') {
      const payload = await parseJsonBody(req)
      const nextName = String(payload?.name || '').trim()
      const nextUnits = csvNames(payload?.units)
      if (!nextName) {
        toJson(res, 400, { ok: false, error: 'INVALID_PAYLOAD' }, { 'x-request-id': requestId })
        return true
      }
      if (localEscalaStore.professionals.some((prof) => prof.name === nextName)) {
        toJson(res, 409, { ok: false, error: 'PROFESSIONAL_ALREADY_EXISTS' }, { 'x-request-id': requestId })
        return true
      }
      localEscalaStore.professionals.push({
        name: nextName,
        status: String(payload?.status || '').trim(),
        units: nextUnits,
        role: String(payload?.role || '').trim(),
        shift: String(payload?.shift || '').trim(),
        nickname: String(payload?.nickname || '').trim(),
        phone: String(payload?.phone || '').trim(),
        email: String(payload?.email || '').trim(),
        instagram: String(payload?.instagram || '').trim(),
      })
      toJson(res, 200, { ok: true, source: 'local-mock' }, { 'x-request-id': requestId })
      return true
    }

    if (path === '/api/escala/professionals' && method === 'PUT') {
      const payload = await parseJsonBody(req)
      const currentName = String(payload?.currentName || '').trim()
      const nextName = String(payload?.name || '').trim()
      const nextUnits = csvNames(payload?.units)
      if (!currentName || !nextName) {
        toJson(res, 400, { ok: false, error: 'INVALID_PAYLOAD' }, { 'x-request-id': requestId })
        return true
      }
      const index = localEscalaStore.professionals.findIndex((prof) => prof.name === currentName)
      if (index < 0) {
        toJson(res, 404, { ok: false, error: 'PROFESSIONAL_NOT_FOUND' }, { 'x-request-id': requestId })
        return true
      }
      if (currentName !== nextName && localEscalaStore.professionals.some((prof) => prof.name === nextName)) {
        toJson(res, 409, { ok: false, error: 'PROFESSIONAL_ALREADY_EXISTS' }, { 'x-request-id': requestId })
        return true
      }
      localEscalaStore.professionals[index] = {
        ...localEscalaStore.professionals[index],
        name: nextName,
        status: String(payload?.status || '').trim(),
        units: nextUnits,
        role: String(payload?.role || '').trim(),
        shift: String(payload?.shift || '').trim(),
        nickname: String(payload?.nickname || '').trim(),
        phone: String(payload?.phone || '').trim(),
        email: String(payload?.email || '').trim(),
        instagram: String(payload?.instagram || '').trim(),
      }
      if (currentName !== nextName) {
        localEscalaStore.schedule = localEscalaStore.schedule.map((row) => (
          row.professional === currentName ? { ...row, professional: nextName } : row
        ))
      }
      toJson(res, 200, { ok: true, source: 'local-mock' }, { 'x-request-id': requestId })
      return true
    }

    if (path === '/api/escala/schedule' && method === 'GET') {
      let schedule = [...localEscalaStore.schedule]
      let closedDays = [...localEscalaStore.closedDays]
      let holidays = [...localEscalaStore.holidays]
      if (unit) {
        schedule = schedule.filter((row) => row.unit === unit)
        closedDays = closedDays.filter((row) => row.unit === unit)
        holidays = holidays.filter((row) => row.unit === unit)
      }
      if (month) {
        schedule = schedule.filter((row) => row.date.startsWith(`${month}-`))
        closedDays = closedDays.filter((row) => row.date.startsWith(`${month}-`))
        holidays = holidays.filter((row) => row.date.startsWith(`${month}-`))
      }
      toJson(res, 200, { ok: true, schedule, closedDays, holidays, source: 'local-mock' }, { 'x-request-id': requestId })
      return true
    }

    if (path === '/api/escala/schedule' && method === 'POST') {
      const payload = await parseJsonBody(req)
      const date = String(payload?.date || '').trim()
      const reqUnit = String(payload?.unit || '').trim()
      const professionals = csvNames(payload?.professionals || payload?.professional)
      if (!isValidIsoDate(date) || !reqUnit || !professionals.length) {
        toJson(res, 400, { ok: false, error: 'INVALID_PAYLOAD' }, { 'x-request-id': requestId })
        return true
      }
      professionals.forEach((professional) => {
        const exists = localEscalaStore.schedule.some((row) => row.date === date && row.unit === reqUnit && row.professional === professional)
        if (!exists) localEscalaStore.schedule.push({ date, unit: reqUnit, professional })
      })
      toJson(res, 200, { ok: true, source: 'local-mock' }, { 'x-request-id': requestId })
      return true
    }

    if (path === '/api/escala/schedule' && method === 'PUT') {
      const payload = await parseJsonBody(req)
      const date = String(payload?.date || '').trim()
      const reqUnit = String(payload?.unit || '').trim()
      const professionals = csvNames(payload?.professionals)
      if (!isValidIsoDate(date) || !reqUnit || !professionals.length) {
        toJson(res, 400, { ok: false, error: 'INVALID_PAYLOAD' }, { 'x-request-id': requestId })
        return true
      }
      localEscalaStore.schedule = localEscalaStore.schedule.filter((row) => !(row.date === date && row.unit === reqUnit))
      professionals.forEach((professional) => localEscalaStore.schedule.push({ date, unit: reqUnit, professional }))
      toJson(res, 200, { ok: true, source: 'local-mock' }, { 'x-request-id': requestId })
      return true
    }

    if (path === '/api/escala/schedule' && method === 'DELETE') {
      const payload = await parseJsonBody(req)
      const date = String(payload?.date || '').trim()
      const reqUnit = String(payload?.unit || '').trim()
      const professional = String(payload?.professional || '').trim()
      if (!isValidIsoDate(date) || !reqUnit) {
        toJson(res, 400, { ok: false, error: 'INVALID_PAYLOAD' }, { 'x-request-id': requestId })
        return true
      }
      localEscalaStore.schedule = localEscalaStore.schedule.filter((row) => {
        if (row.date !== date || row.unit !== reqUnit) return true
        if (!professional) return false
        return row.professional !== professional
      })
      toJson(res, 200, { ok: true, source: 'local-mock' }, { 'x-request-id': requestId })
      return true
    }

    if (path === '/api/escala/closed-days' && method === 'POST') {
      const payload = await parseJsonBody(req)
      const date = String(payload?.date || '').trim()
      const reqUnit = String(payload?.unit || '').trim()
      const reason = String(payload?.reason || '').trim() || 'Sem atendimento'
      if (!isValidIsoDate(date) || !reqUnit) {
        toJson(res, 400, { ok: false, error: 'INVALID_PAYLOAD' }, { 'x-request-id': requestId })
        return true
      }
      localEscalaStore.closedDays = localEscalaStore.closedDays.filter((row) => !(row.date === date && row.unit === reqUnit))
      localEscalaStore.closedDays.push({ date, unit: reqUnit, reason })
      toJson(res, 200, { ok: true, source: 'local-mock' }, { 'x-request-id': requestId })
      return true
    }

    if (path === '/api/escala/closed-days' && method === 'DELETE') {
      const payload = await parseJsonBody(req)
      const date = String(payload?.date || '').trim()
      const reqUnit = String(payload?.unit || '').trim()
      if (!isValidIsoDate(date) || !reqUnit) {
        toJson(res, 400, { ok: false, error: 'INVALID_PAYLOAD' }, { 'x-request-id': requestId })
        return true
      }
      localEscalaStore.closedDays = localEscalaStore.closedDays.filter((row) => !(row.date === date && row.unit === reqUnit))
      toJson(res, 200, { ok: true, source: 'local-mock' }, { 'x-request-id': requestId })
      return true
    }

    if (path === '/api/escala/holidays' && method === 'POST') {
      const payload = await parseJsonBody(req)
      const date = String(payload?.date || '').trim()
      const reqUnit = String(payload?.unit || '').trim()
      const name = String(payload?.name || '').trim()
      if (!isValidIsoDate(date) || !reqUnit || !name) {
        toJson(res, 400, { ok: false, error: 'INVALID_PAYLOAD' }, { 'x-request-id': requestId })
        return true
      }
      const exists = localEscalaStore.holidays.some((row) => row.date === date && row.unit === reqUnit && row.name === name)
      if (!exists) localEscalaStore.holidays.push({ date, unit: reqUnit, name })
      toJson(res, 200, { ok: true, source: 'local-mock' }, { 'x-request-id': requestId })
      return true
    }

    if (path === '/api/escala/holidays' && method === 'DELETE') {
      const payload = await parseJsonBody(req)
      const date = String(payload?.date || '').trim()
      const reqUnit = String(payload?.unit || '').trim()
      const name = String(payload?.name || '').trim()
      if (!isValidIsoDate(date) || !reqUnit || !name) {
        toJson(res, 400, { ok: false, error: 'INVALID_PAYLOAD' }, { 'x-request-id': requestId })
        return true
      }
      localEscalaStore.holidays = localEscalaStore.holidays.filter((row) => !(row.date === date && row.unit === reqUnit && row.name === name))
      toJson(res, 200, { ok: true, source: 'local-mock' }, { 'x-request-id': requestId })
      return true
    }

    toJson(res, 404, { ok: false, error: 'NOT_FOUND' }, { 'x-request-id': requestId })
    return true
  }

  if (!escalaApiTarget) {
    toJson(res, 503, {
      ok: false,
      error: 'ESCALA_API_TARGET nao configurado',
      hint: 'Defina ESCALA_API_TARGET no ambiente local.',
    }, { 'x-request-id': requestId })
    return true
  }

  if (!escalaActorHmacKey) {
    toJson(res, 503, {
      ok: false,
      error: 'ESCALA_ACTOR_HMAC_KEY nao configurado',
      hint: 'Defina ESCALA_ACTOR_HMAC_KEY no ambiente local.',
    }, { 'x-request-id': requestId })
    return true
  }

  const isShadowWriteRoute =
    (path === '/api/escala/schedule' || path === '/api/escala/closed-days' || path === '/api/escala/holidays') &&
    (method === 'POST' || method === 'PUT' || method === 'DELETE')

  if (localEscalaShadowWritesEnabled && isShadowWriteRoute) {
    const rawBody = await readRawBody(req)
    const payload = parseJsonBuffer(rawBody)
    await handleLocalShadowWrite(res, path, method, actor, payload, requestId)
    return true
  }

  const actorB64 = Buffer.from(JSON.stringify(actor)).toString('base64url')
  const actorTs = String(Date.now())
  const signature = createHmac('sha256', escalaActorHmacKey).update(`${actorTs}.${actorB64}`).digest('base64url')
  const targetUrl = new URL(escalaApiTarget)
  const basePath = targetUrl.pathname.replace(/\/$/, '')
  const rest = path.replace(/^\/api\/escala/, '') || '/'
  targetUrl.pathname = `${basePath}/api/escala${rest.startsWith('/') ? '' : '/'}${rest}`
  targetUrl.search = url.search

  const headers = buildUpstreamHeaders(req, requestId)
  headers.set('x-crm-user', actorB64)
  headers.set('x-crm-ts', actorTs)
  headers.set('x-crm-signature', signature)

  let rawBody: Buffer | undefined
  if (method !== 'GET' && method !== 'HEAD') {
    rawBody = await readRawBody(req)
  }

  let upstream: Response
  try {
    upstream = await fetch(targetUrl.toString(), {
      method,
      headers,
      body: rawBody && rawBody.length ? rawBody : undefined,
      redirect: 'manual',
    })
  } catch (error: any) {
    toJson(res, 502, {
      ok: false,
      error: 'UPSTREAM_UNREACHABLE',
      detail: String(error?.message || error || 'Falha de conexao com escala-api'),
    }, { 'x-request-id': requestId })
    return true
  }

  const shouldApplyShadowOnRead =
    localEscalaShadowWritesEnabled &&
    method === 'GET' &&
    (path === '/api/escala/schedule' || path === '/api/escala/overview')

  if (shouldApplyShadowOnRead) {
    const text = await upstream.text()
    let parsed: any = null
    try {
      parsed = text ? JSON.parse(text) : null
    } catch {
      parsed = null
    }

    if (!parsed || typeof parsed !== 'object') {
      res.statusCode = upstream.status
      res.setHeader('content-type', upstream.headers.get('content-type') || 'application/json')
      res.setHeader('cache-control', 'no-store')
      res.setHeader('x-request-id', requestId)
      res.end(text)
      return true
    }

    const canOverlay = upstream.ok && parsed?.ok !== false

    if (path === '/api/escala/schedule') {
      const ops = listShadowOperations(unit || undefined, month || undefined)
      const out = canOverlay && ops.length ? applyShadowOperationsToSchedulePayload(parsed, ops) : parsed
      toJson(res, upstream.status, out, {
        'x-request-id': requestId,
        'x-escala-local-shadow': '1',
      })
      return true
    }

    const ops = listShadowOperations()
    const out = canOverlay && ops.length ? applyShadowOperationsToOverviewPayload(parsed, ops) : parsed
    toJson(res, upstream.status, out, {
      'x-request-id': requestId,
      'x-escala-local-shadow': '1',
    })
    return true
  }

  await writeFetchResponse(res, upstream, { 'x-request-id': requestId })
  return true
}

function attachDevMiddleware(server: any) {
  server.middlewares.use((req: any, res: any, next: any) => {
    if (!req.url) return next()
    const method = String(req.method || 'GET').toUpperCase()
    if (localAuthBypassEnabled) {
      if (req.url.startsWith('/api/auth/me') && method === 'GET') {
        res.statusCode = 200
        res.setHeader('content-type', 'application/json')
        res.end(JSON.stringify({ ok: true, user: localAuthUser, csrfToken: 'local-dev-csrf' }))
        return
      }
      if ((req.url.startsWith('/api/auth/login') || req.url.startsWith('/api/auth/register') || req.url.startsWith('/api/auth/refresh')) && method === 'POST') {
        res.statusCode = 200
        res.setHeader('content-type', 'application/json')
        res.end(JSON.stringify({ ok: true, user: localAuthUser, csrfToken: 'local-dev-csrf' }))
        return
      }
      if (req.url.startsWith('/api/auth/logout') && method === 'POST') {
        res.statusCode = 200
        res.setHeader('content-type', 'application/json')
        res.end('{"ok":true}')
        return
      }
      if (req.url.startsWith('/api/insumos/auth/me') && method === 'GET') {
        res.statusCode = 200
        res.setHeader('content-type', 'application/json')
        res.end(JSON.stringify({ success: true, user: localAuthUser, csrfToken: 'local-dev-csrf' }))
        return
      }
    }
    maybeHandleLocalEscala(req, res).then((handled) => {
      if (handled) return
      if (
        req.url.startsWith('/health') ||
        req.url.startsWith('/api/health') ||
        req.url.startsWith('/v1/health') ||
        req.url.startsWith('/api/insumos/health')
      ) {
        res.statusCode = 200
        res.setHeader('content-type', 'application/json')
        res.end('{"ok":true}')
        return
      }
      if (req.url.startsWith('/api/instagram/status')) {
        res.statusCode = 200
        res.setHeader('content-type', 'application/json')
        res.end('{"ok":true,"connected":false}')
        return
      }
      if (req.url.startsWith('/api/instagram/oauth/status')) {
        res.statusCode = 200
        res.setHeader('content-type', 'application/json')
        res.end('{"ok":true,"configured":false,"missing":["META_APP_ID","META_APP_SECRET","META_OAUTH_STATE_SECRET"]}')
        return
      }
      next()
    }).catch(() => next())
  })
}

export default defineConfig({
  plugins: [
    tailwindcss(),
    react(),
    // DO NOT REMOVE
    createIconImportProxy() as PluginOption,
    sparkPlugin() as PluginOption,
    // Inject simple health endpoints for dev/preview to satisfy automated probes
    {
      name: 'health-endpoints',
      configureServer(server) {
        attachDevMiddleware(server)
      },
      configurePreviewServer(server) {
        attachDevMiddleware(server)
      }
    } as PluginOption,
  ],
  resolve: {
    alias: {
      '@': resolve(projectRoot, '.'),
    },
    // DEDUPE React to prevent multiple copies causing useContext null errors
    dedupe: ['react', 'react-dom']
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks: {
          vendor: ['react', 'react-dom'],
          ui: ['@radix-ui/react-tabs', '@radix-ui/react-dialog', '@radix-ui/react-select'],
          icons: ['@phosphor-icons/react'],
          charts: ['recharts', 'd3'],
          utils: ['date-fns', 'clsx', 'tailwind-merge']
        }
      }
    },
    chunkSizeWarningLimit: 1000
  },
  optimizeDeps: {
    include: [
      'react',
      'react-dom',
      '@phosphor-icons/react',
      '@radix-ui/react-tabs',
      '@radix-ui/react-dialog',
      '@radix-ui/react-select'
    ]
  },
  server: {
    host: '0.0.0.0',
    port: 5000,
    allowedHosts: true, // Allow all hosts for Replit compatibility
    hmr: {
      overlay: false
    },
    proxy: {
      '/api': {
        target: apiProxyTarget,
        changeOrigin: true,
        secure: false,
        ws: true,
        timeout: 30000
      },
      '/whatsapp': {
        target: 'http://localhost:3001',
        changeOrigin: true,
        secure: false,
        ws: true,
        timeout: 30000
      }
    }
  },
});
