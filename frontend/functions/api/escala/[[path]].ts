import { isLocalDevAuthBypassEnabled, requireCrmUser } from '../../_lib/crmAuth'

const json = (status: number, body: any, extraHeaders: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      ...extraHeaders,
    },
  })

function newRequestId(): string {
  try {
    return crypto.randomUUID()
  } catch {
    return `${Date.now()}_${Math.random().toString(16).slice(2)}`
  }
}

function normalizeRole(value: unknown): string {
  const raw = String(value || '').trim().toUpperCase()
  if (!raw) return ''
  if (raw === 'ADMIN') return 'GESTOR'
  if (raw === 'OPERADOR') return 'INJETOR'
  return raw
}

function buildUpstreamHeaders(request: Request, requestId: string): Headers {
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
  for (const [k, v] of request.headers.entries()) {
    const key = k.toLowerCase()
    if (!allow.has(key)) continue
    headers.set(k, v)
  }

  headers.set('x-request-id', requestId)
  return headers
}

function b64UrlEncodeBytes(bytes: ArrayBuffer): string {
  const bin = String.fromCharCode(...new Uint8Array(bytes))
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '')
}

function b64UrlEncodeString(input: string): string {
  const bytes = new TextEncoder().encode(input)
  return b64UrlEncodeBytes(bytes.buffer)
}

async function signHmacSha256B64Url(secret: string, message: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(message))
  return b64UrlEncodeBytes(sig)
}

type EscalaActor = {
  id: string
  username?: string
  email?: string
  name?: string
  role: string
  allowedUnits?: string[]
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
  color: string
}

type LocalScheduleEntry = { date: string; unit: string; professional: string }
type LocalClosedDay = { date: string; unit: string; reason: string }
type LocalHoliday = { date: string; unit: string; name: string }

type EscalaLocalStore = {
  professionals: LocalProfessional[]
  schedule: LocalScheduleEntry[]
  closedDays: LocalClosedDay[]
  holidays: LocalHoliday[]
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
  byScope: Record<string, ShadowOperation[]>
}

function parseBooleanEnv(value: unknown): boolean | null {
  const raw = String(value ?? '').trim().toLowerCase()
  if (!raw) return null
  if (raw === '1' || raw === 'true' || raw === 'yes' || raw === 'on') return true
  if (raw === '0' || raw === 'false' || raw === 'no' || raw === 'off') return false
  return null
}

function isValidIsoDate(value: unknown): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(value || ''))
}

function normalizeUnitKey(value: unknown): string {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '')
    .trim()
}

function getAllowedUnitKeySet(actor: EscalaActor): Set<string> {
  const raw = Array.isArray(actor.allowedUnits) ? actor.allowedUnits : []
  return new Set(raw.map((unit) => normalizeUnitKey(unit)).filter(Boolean))
}

function sanitizeCsvNames(input: unknown): string[] {
  if (Array.isArray(input)) {
    return input
      .map((item) => String(item || '').trim())
      .filter(Boolean)
  }
  return String(input || '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean)
}

function extractMonth(isoDate: string): string {
  return isoDate.slice(0, 7)
}

function buildScopeKey(unit: string, month: string): string {
  return `${unit}::${month}`
}

function getEscalaShadowStore(): EscalaShadowStore {
  const g = globalThis as unknown as { __escalaShadowStore?: EscalaShadowStore }
  if (g.__escalaShadowStore) return g.__escalaShadowStore
  g.__escalaShadowStore = { byScope: {} }
  return g.__escalaShadowStore
}

function pushShadowOperation(op: ShadowOperation) {
  const month = extractMonth(op.date)
  const key = buildScopeKey(op.unit, month)
  const store = getEscalaShadowStore()
  if (!Array.isArray(store.byScope[key])) store.byScope[key] = []
  store.byScope[key].push(op)
}

function listShadowOperations(unit?: string, month?: string): ShadowOperation[] {
  const store = getEscalaShadowStore()
  if (unit && month) {
    return [...(store.byScope[buildScopeKey(unit, month)] || [])]
  }
  const allKeys = Object.keys(store.byScope)
  const selected = allKeys.filter((key) => {
    const [scopeUnit, scopeMonth] = key.split('::')
    if (unit && scopeUnit !== unit) return false
    if (month && scopeMonth !== month) return false
    return true
  })
  return selected.flatMap((key) => store.byScope[key] || [])
}

function allShadowOperationCount(): number {
  const store = getEscalaShadowStore()
  return Object.values(store.byScope).reduce((acc, arr) => acc + (Array.isArray(arr) ? arr.length : 0), 0)
}

function getEscalaLocalStore(): EscalaLocalStore {
  const g = globalThis as unknown as { __escalaLocalStore?: EscalaLocalStore }
  if (g.__escalaLocalStore) return g.__escalaLocalStore

  g.__escalaLocalStore = {
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
        instagram: '',
        color: '',
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
        instagram: '',
        color: '',
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
        instagram: '',
        color: '',
      },
    ],
    schedule: [],
    closedDays: [],
    holidays: [],
  }

  return g.__escalaLocalStore
}

function canUseUnit(actor: EscalaActor, unit: string): boolean {
  const requested = normalizeUnitKey(unit)
  if (!requested) return true
  const allowed = getAllowedUnitKeySet(actor)
  if (!allowed.size) return true
  return allowed.has(requested)
}

function visibleByAllowedUnits<T extends { unit: string }>(rows: T[], actor: EscalaActor): T[] {
  const allowed = Array.isArray(actor.allowedUnits) ? actor.allowedUnits.filter(Boolean) : []
  if (!allowed.length) return rows
  return rows.filter((item) => allowed.includes(String(item.unit || '')))
}

async function readJson(request: Request): Promise<any> {
  try {
    return await request.json()
  } catch {
    return null
  }
}

function isLocalEscalaMockEnabled(context: any, targetOrigin: string, actorKey: string): boolean {
  const env = context?.env || {}
  const explicit =
    parseBooleanEnv(env.LOCAL_ESCALA_MOCK) ??
    parseBooleanEnv(env.ESCALA_LOCAL_MOCK) ??
    parseBooleanEnv(env.DEV_ESCALA_MOCK)
  if (explicit !== null) return explicit

  // In localhost dev, automatically fallback to mock when upstream auth vars are missing.
  return isLocalDevAuthBypassEnabled(context) && (!targetOrigin || !actorKey)
}

function isLocalEscalaShadowWritesEnabled(context: any): boolean {
  const env = context?.env || {}
  const explicit =
    parseBooleanEnv(env.LOCAL_ESCALA_SHADOW_WRITES) ??
    parseBooleanEnv(env.ESCALA_LOCAL_SHADOW_WRITES) ??
    parseBooleanEnv(env.DEV_ESCALA_SHADOW_WRITES)
  if (explicit !== null) return explicit
  return isLocalDevAuthBypassEnabled(context)
}

function applyShadowOperationsToSchedulePayload(basePayload: any, ops: ShadowOperation[]): any {
  const baseSchedule: LocalScheduleEntry[] = Array.isArray(basePayload?.schedule)
    ? basePayload.schedule.map((row: any) => ({
      date: String(row?.date || ''),
      unit: String(row?.unit || ''),
      professional: String(row?.professional || ''),
    })).filter((row) => row.date && row.unit && row.professional)
    : []

  const baseClosedDays: LocalClosedDay[] = Array.isArray(basePayload?.closedDays)
    ? basePayload.closedDays.map((row: any) => ({
      date: String(row?.date || ''),
      unit: String(row?.unit || ''),
      reason: String(row?.reason || ''),
    })).filter((row) => row.date && row.unit)
    : []

  const baseHolidays: LocalHoliday[] = Array.isArray(basePayload?.holidays)
    ? basePayload.holidays.map((row: any) => ({
      date: String(row?.date || ''),
      unit: String(row?.unit || ''),
      name: String(row?.name || ''),
    })).filter((row) => row.date && row.unit && row.name)
    : []

  let schedule = [...baseSchedule]
  let closedDays = [...baseClosedDays]
  let holidays = [...baseHolidays]

  ops.forEach((op) => {
    if (op.kind === 'schedule_add') {
      op.professionals.forEach((professional) => {
        const exists = schedule.some((row) => row.date === op.date && row.unit === op.unit && row.professional === professional)
        if (!exists) schedule.push({ date: op.date, unit: op.unit, professional })
      })
      return
    }
    if (op.kind === 'schedule_replace') {
      schedule = schedule.filter((row) => !(row.date === op.date && row.unit === op.unit))
      op.professionals.forEach((professional) => {
        schedule.push({ date: op.date, unit: op.unit, professional })
      })
      return
    }
    if (op.kind === 'schedule_remove') {
      schedule = schedule.filter((row) => {
        if (row.date !== op.date || row.unit !== op.unit) return true
        if (!op.professional) return false
        return row.professional !== op.professional
      })
      return
    }
    if (op.kind === 'closed_add') {
      closedDays = closedDays.filter((row) => !(row.date === op.date && row.unit === op.unit))
      closedDays.push({ date: op.date, unit: op.unit, reason: op.reason })
      return
    }
    if (op.kind === 'closed_remove') {
      closedDays = closedDays.filter((row) => !(row.date === op.date && row.unit === op.unit))
      return
    }
    if (op.kind === 'holiday_add') {
      const exists = holidays.some((row) => row.date === op.date && row.unit === op.unit && row.name === op.name)
      if (!exists) holidays.push({ date: op.date, unit: op.unit, name: op.name })
      return
    }
    if (op.kind === 'holiday_remove') {
      holidays = holidays.filter((row) => !(row.date === op.date && row.unit === op.unit && row.name === op.name))
    }
  })

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
  request: Request,
  rest: string,
  actor: EscalaActor,
  requestId: string,
): Promise<Response | null> {
  const method = String(request.method || 'GET').toUpperCase()
  const done = (status: number, body: any) => json(status, body, { 'x-request-id': requestId })

  if (!(rest === '/schedule' || rest === '/closed-days' || rest === '/holidays')) return null
  if (!(method === 'POST' || method === 'PUT' || method === 'DELETE')) return null

  const payload = await readJson(request)

  if (rest === '/schedule' && method === 'POST') {
    const date = String(payload?.date || '').trim()
    const unit = String(payload?.unit || '').trim()
    const professionals = sanitizeCsvNames(payload?.professionals || payload?.professional)
    if (!isValidIsoDate(date) || !unit || !professionals.length) return done(400, { ok: false, error: 'INVALID_PAYLOAD' })
    if (!canUseUnit(actor, unit)) return done(403, { ok: false, error: 'FORBIDDEN_UNIT' })
    pushShadowOperation({ kind: 'schedule_add', date, unit, professionals })
    return done(200, { ok: true, source: 'local-shadow', shadowWrite: true })
  }

  if (rest === '/schedule' && method === 'PUT') {
    const date = String(payload?.date || '').trim()
    const unit = String(payload?.unit || '').trim()
    const professionals = sanitizeCsvNames(payload?.professionals)
    if (!isValidIsoDate(date) || !unit || !professionals.length) return done(400, { ok: false, error: 'INVALID_PAYLOAD' })
    if (!canUseUnit(actor, unit)) return done(403, { ok: false, error: 'FORBIDDEN_UNIT' })
    pushShadowOperation({ kind: 'schedule_replace', date, unit, professionals })
    return done(200, { ok: true, source: 'local-shadow', shadowWrite: true })
  }

  if (rest === '/schedule' && method === 'DELETE') {
    const date = String(payload?.date || '').trim()
    const unit = String(payload?.unit || '').trim()
    const professional = String(payload?.professional || '').trim() || undefined
    if (!isValidIsoDate(date) || !unit) return done(400, { ok: false, error: 'INVALID_PAYLOAD' })
    if (!canUseUnit(actor, unit)) return done(403, { ok: false, error: 'FORBIDDEN_UNIT' })
    pushShadowOperation({ kind: 'schedule_remove', date, unit, professional })
    return done(200, { ok: true, source: 'local-shadow', shadowWrite: true })
  }

  if (rest === '/closed-days' && method === 'POST') {
    const date = String(payload?.date || '').trim()
    const unit = String(payload?.unit || '').trim()
    const reason = String(payload?.reason || '').trim() || 'Sem atendimento'
    if (!isValidIsoDate(date) || !unit) return done(400, { ok: false, error: 'INVALID_PAYLOAD' })
    if (!canUseUnit(actor, unit)) return done(403, { ok: false, error: 'FORBIDDEN_UNIT' })
    pushShadowOperation({ kind: 'closed_add', date, unit, reason })
    return done(200, { ok: true, source: 'local-shadow', shadowWrite: true })
  }

  if (rest === '/closed-days' && method === 'DELETE') {
    const date = String(payload?.date || '').trim()
    const unit = String(payload?.unit || '').trim()
    if (!isValidIsoDate(date) || !unit) return done(400, { ok: false, error: 'INVALID_PAYLOAD' })
    if (!canUseUnit(actor, unit)) return done(403, { ok: false, error: 'FORBIDDEN_UNIT' })
    pushShadowOperation({ kind: 'closed_remove', date, unit })
    return done(200, { ok: true, source: 'local-shadow', shadowWrite: true })
  }

  if (rest === '/holidays' && method === 'POST') {
    const date = String(payload?.date || '').trim()
    const unit = String(payload?.unit || '').trim()
    const name = String(payload?.name || '').trim()
    if (!isValidIsoDate(date) || !unit || !name) return done(400, { ok: false, error: 'INVALID_PAYLOAD' })
    if (!canUseUnit(actor, unit)) return done(403, { ok: false, error: 'FORBIDDEN_UNIT' })
    pushShadowOperation({ kind: 'holiday_add', date, unit, name })
    return done(200, { ok: true, source: 'local-shadow', shadowWrite: true })
  }

  if (rest === '/holidays' && method === 'DELETE') {
    const date = String(payload?.date || '').trim()
    const unit = String(payload?.unit || '').trim()
    const name = String(payload?.name || '').trim()
    if (!isValidIsoDate(date) || !unit || !name) return done(400, { ok: false, error: 'INVALID_PAYLOAD' })
    if (!canUseUnit(actor, unit)) return done(403, { ok: false, error: 'FORBIDDEN_UNIT' })
    pushShadowOperation({ kind: 'holiday_remove', date, unit, name })
    return done(200, { ok: true, source: 'local-shadow', shadowWrite: true })
  }

  return null
}

async function handleLocalEscalaRequest(
  request: Request,
  rest: string,
  actor: EscalaActor,
  requestId: string,
): Promise<Response> {
  const store = getEscalaLocalStore()
  const method = String(request.method || 'GET').toUpperCase()
  const url = new URL(request.url)
  const unit = String(url.searchParams.get('unit') || '').trim()
  const month = String(url.searchParams.get('month') || '').trim()

  const done = (status: number, body: any) => json(status, body, { 'x-request-id': requestId })

  if (rest === '/overview' && method === 'GET') {
    const units = new Set<string>()
    visibleByAllowedUnits(store.schedule, actor).forEach((row) => units.add(row.unit))
    visibleByAllowedUnits(store.closedDays, actor).forEach((row) => units.add(row.unit))
    visibleByAllowedUnits(store.holidays, actor).forEach((row) => units.add(row.unit))
    store.professionals.forEach((prof) => {
      ;(prof.units || []).forEach((u) => {
        if (canUseUnit(actor, u)) units.add(u)
      })
    })

    const months = new Set<string>()
    visibleByAllowedUnits(store.schedule, actor).forEach((row) => months.add(extractMonth(row.date)))

    return done(200, {
      ok: true,
      units: Array.from(units).sort(),
      months: Array.from(months).sort(),
      source: 'local-mock',
    })
  }

  if (rest === '/professionals' && method === 'GET') {
    const requestedUnitKey = normalizeUnitKey(unit)
    const visible = store.professionals.filter((prof) => {
      if (requestedUnitKey && prof.units.length && !prof.units.some((u) => normalizeUnitKey(u) === requestedUnitKey)) return false
      if (!prof.units.length) return true
      return prof.units.some((u) => canUseUnit(actor, u))
    })
    return done(200, { ok: true, data: visible, source: 'local-mock' })
  }

  if (rest === '/professionals' && method === 'POST') {
    const payload = await readJson(request)
    const name = String(payload?.name || '').trim()
    const unitsInput = Array.isArray(payload?.units) ? payload.units : []
    const nextUnits: string[] = Array.from(new Set(unitsInput.map((item) => String(item || '').trim()).filter(Boolean)))
    if (!name) return done(400, { ok: false, error: 'INVALID_PAYLOAD' })
    if (store.professionals.some((prof) => prof.name === name)) {
      return done(409, { ok: false, error: 'PROFESSIONAL_ALREADY_EXISTS' })
    }
    store.professionals.push({
      name,
      status: String(payload?.status || '').trim(),
      units: nextUnits,
      role: String(payload?.role || '').trim(),
      shift: String(payload?.shift || '').trim(),
      nickname: String(payload?.nickname || '').trim(),
      phone: String(payload?.phone || '').trim(),
      email: String(payload?.email || '').trim(),
      instagram: String(payload?.instagram || '').trim(),
      color: String(payload?.color || '').trim(),
    })
    return done(200, { ok: true, source: 'local-mock' })
  }

  if (rest === '/professionals' && method === 'PUT') {
    const payload = await readJson(request)
    const currentName = String(payload?.currentName || '').trim()
    const nextName = String(payload?.name || '').trim()
    const unitsInput = Array.isArray(payload?.units) ? payload.units : []
    const nextUnits: string[] = Array.from(new Set(unitsInput.map((item) => String(item || '').trim()).filter(Boolean)))
    if (!currentName || !nextName) return done(400, { ok: false, error: 'INVALID_PAYLOAD' })
    const index = store.professionals.findIndex((prof) => prof.name === currentName)
    if (index < 0) return done(404, { ok: false, error: 'PROFESSIONAL_NOT_FOUND' })
    if (currentName !== nextName && store.professionals.some((prof) => prof.name === nextName)) {
      return done(409, { ok: false, error: 'PROFESSIONAL_ALREADY_EXISTS' })
    }
    store.professionals[index] = {
      ...store.professionals[index],
      name: nextName,
      status: String(payload?.status || '').trim(),
      units: nextUnits,
      role: String(payload?.role || '').trim(),
      shift: String(payload?.shift || '').trim(),
      nickname: String(payload?.nickname || '').trim(),
      phone: String(payload?.phone || '').trim(),
      email: String(payload?.email || '').trim(),
      instagram: String(payload?.instagram || '').trim(),
      color: String(payload?.color || '').trim(),
    }
    if (currentName !== nextName) {
      store.schedule = store.schedule.map((row) => (
        row.professional === currentName ? { ...row, professional: nextName } : row
      ))
    }
    return done(200, { ok: true, source: 'local-mock' })
  }

  if (rest === '/schedule' && method === 'GET') {
    let scheduleRows = visibleByAllowedUnits(store.schedule, actor)
    let closedRows = visibleByAllowedUnits(store.closedDays, actor)
    let holidayRows = visibleByAllowedUnits(store.holidays, actor)

    if (unit) {
      if (!canUseUnit(actor, unit)) return done(403, { ok: false, error: 'FORBIDDEN_UNIT' })
      scheduleRows = scheduleRows.filter((row) => row.unit === unit)
      closedRows = closedRows.filter((row) => row.unit === unit)
      holidayRows = holidayRows.filter((row) => row.unit === unit)
    }
    if (month) {
      scheduleRows = scheduleRows.filter((row) => row.date.startsWith(`${month}-`))
      closedRows = closedRows.filter((row) => row.date.startsWith(`${month}-`))
      holidayRows = holidayRows.filter((row) => row.date.startsWith(`${month}-`))
    }

    return done(200, {
      ok: true,
      schedule: scheduleRows,
      closedDays: closedRows,
      holidays: holidayRows,
      source: 'local-mock',
    })
  }

  if (rest === '/schedule' && method === 'POST') {
    const payload = await readJson(request)
    const date = String(payload?.date || '').trim()
    const postUnit = String(payload?.unit || '').trim()
    const names = sanitizeCsvNames(payload?.professionals || payload?.professional)
    if (!isValidIsoDate(date) || !postUnit || !names.length) {
      return done(400, { ok: false, error: 'INVALID_PAYLOAD' })
    }
    if (!canUseUnit(actor, postUnit)) return done(403, { ok: false, error: 'FORBIDDEN_UNIT' })

    for (const professional of names) {
      const exists = store.schedule.some((row) => row.date === date && row.unit === postUnit && row.professional === professional)
      if (!exists) store.schedule.push({ date, unit: postUnit, professional })
    }
    return done(200, { ok: true, source: 'local-mock' })
  }

  if (rest === '/schedule' && method === 'PUT') {
    const payload = await readJson(request)
    const date = String(payload?.date || '').trim()
    const putUnit = String(payload?.unit || '').trim()
    const names = sanitizeCsvNames(payload?.professionals)
    if (!isValidIsoDate(date) || !putUnit || !names.length) {
      return done(400, { ok: false, error: 'INVALID_PAYLOAD' })
    }
    if (!canUseUnit(actor, putUnit)) return done(403, { ok: false, error: 'FORBIDDEN_UNIT' })

    store.schedule = store.schedule.filter((row) => !(row.date === date && row.unit === putUnit))
    names.forEach((professional) => {
      store.schedule.push({ date, unit: putUnit, professional })
    })
    return done(200, { ok: true, source: 'local-mock' })
  }

  if (rest === '/schedule' && method === 'DELETE') {
    const payload = await readJson(request)
    const date = String(payload?.date || '').trim()
    const deleteUnit = String(payload?.unit || '').trim()
    const professional = String(payload?.professional || '').trim()
    if (!isValidIsoDate(date) || !deleteUnit) {
      return done(400, { ok: false, error: 'INVALID_PAYLOAD' })
    }
    if (!canUseUnit(actor, deleteUnit)) return done(403, { ok: false, error: 'FORBIDDEN_UNIT' })

    store.schedule = store.schedule.filter((row) => {
      if (row.date !== date || row.unit !== deleteUnit) return true
      if (!professional) return false
      return row.professional !== professional
    })
    return done(200, { ok: true, source: 'local-mock' })
  }

  if (rest === '/closed-days' && method === 'POST') {
    const payload = await readJson(request)
    const date = String(payload?.date || '').trim()
    const postUnit = String(payload?.unit || '').trim()
    const reason = String(payload?.reason || '').trim() || 'Sem atendimento'
    if (!isValidIsoDate(date) || !postUnit) return done(400, { ok: false, error: 'INVALID_PAYLOAD' })
    if (!canUseUnit(actor, postUnit)) return done(403, { ok: false, error: 'FORBIDDEN_UNIT' })
    store.closedDays = store.closedDays.filter((row) => !(row.date === date && row.unit === postUnit))
    store.closedDays.push({ date, unit: postUnit, reason })
    return done(200, { ok: true, source: 'local-mock' })
  }

  if (rest === '/closed-days' && method === 'DELETE') {
    const payload = await readJson(request)
    const date = String(payload?.date || '').trim()
    const deleteUnit = String(payload?.unit || '').trim()
    if (!isValidIsoDate(date) || !deleteUnit) return done(400, { ok: false, error: 'INVALID_PAYLOAD' })
    if (!canUseUnit(actor, deleteUnit)) return done(403, { ok: false, error: 'FORBIDDEN_UNIT' })
    store.closedDays = store.closedDays.filter((row) => !(row.date === date && row.unit === deleteUnit))
    return done(200, { ok: true, source: 'local-mock' })
  }

  if (rest === '/holidays' && method === 'POST') {
    const payload = await readJson(request)
    const date = String(payload?.date || '').trim()
    const postUnit = String(payload?.unit || '').trim()
    const name = String(payload?.name || '').trim()
    if (!isValidIsoDate(date) || !postUnit || !name) return done(400, { ok: false, error: 'INVALID_PAYLOAD' })
    if (!canUseUnit(actor, postUnit)) return done(403, { ok: false, error: 'FORBIDDEN_UNIT' })
    const exists = store.holidays.some((row) => row.date === date && row.unit === postUnit && row.name === name)
    if (!exists) store.holidays.push({ date, unit: postUnit, name })
    return done(200, { ok: true, source: 'local-mock' })
  }

  if (rest === '/holidays' && method === 'DELETE') {
    const payload = await readJson(request)
    const date = String(payload?.date || '').trim()
    const deleteUnit = String(payload?.unit || '').trim()
    const name = String(payload?.name || '').trim()
    if (!isValidIsoDate(date) || !deleteUnit || !name) return done(400, { ok: false, error: 'INVALID_PAYLOAD' })
    if (!canUseUnit(actor, deleteUnit)) return done(403, { ok: false, error: 'FORBIDDEN_UNIT' })
    store.holidays = store.holidays.filter((row) => !(row.date === date && row.unit === deleteUnit && row.name === name))
    return done(200, { ok: true, source: 'local-mock' })
  }

  return done(404, { ok: false, error: 'NOT_FOUND' })
}

export async function onRequest(context: any): Promise<Response> {
  const request: Request = context.request
  const url = new URL(request.url)
  const requestId = newRequestId()

  const userOrRes = await requireCrmUser(context)
  if (userOrRes instanceof Response) return userOrRes

  const role = normalizeRole((userOrRes as any)?.role)
  if (!(role === 'GESTOR' || role === 'GERENTE')) {
    return json(
      403,
      { ok: false, error: 'FORBIDDEN', hint: 'Acesso restrito a gestores.' },
      { 'x-request-id': requestId },
    )
  }

  const actor = {
    id: String((userOrRes as any).id || ''),
    username: (userOrRes as any).username ? String((userOrRes as any).username) : undefined,
    email: (userOrRes as any).email ? String((userOrRes as any).email) : undefined,
    name: (userOrRes as any).displayName ? String((userOrRes as any).displayName) : undefined,
    role,
    allowedUnits: Array.isArray((userOrRes as any).allowedUnits) ? (userOrRes as any).allowedUnits : undefined,
  }

  const actorB64 = b64UrlEncodeString(JSON.stringify(actor))
  const targetOrigin = String(context.env?.ESCALA_API_TARGET || '').trim()
  const actorKey = String(context?.env?.ESCALA_ACTOR_HMAC_KEY || '').trim()

  const prefix = '/api/escala'
  const rest = url.pathname.startsWith(prefix) ? url.pathname.slice(prefix.length) || '/' : url.pathname
  const localMockEnabled = isLocalEscalaMockEnabled(context, targetOrigin, actorKey)
  const localShadowWritesEnabled = !localMockEnabled && isLocalEscalaShadowWritesEnabled(context)

  if (rest === '/_proxy-status' || rest === '/_proxy-status/') {
    return json(
      200,
      {
        ok: true,
        localMockEnabled,
        localShadowWritesEnabled,
        shadowOperationCount: allShadowOperationCount(),
        targetConfigured: !!targetOrigin || localMockEnabled,
        actorKeyConfigured: !!actorKey || localMockEnabled,
        mode: localMockEnabled ? 'local-mock' : (localShadowWritesEnabled ? 'upstream+local-shadow' : 'upstream'),
        hint: !targetOrigin
          ? (localMockEnabled
            ? 'Usando mock local para /api/escala em localhost.'
            : 'Configure ESCALA_API_TARGET no Cloudflare Pages/Functions (ex: https://escala-api.skincos.com.br).')
          : undefined,
      },
      { 'x-request-id': requestId },
    )
  }

  if (localMockEnabled) {
    return handleLocalEscalaRequest(request, rest, actor, requestId)
  }

  if (!targetOrigin) {
    return json(
      503,
      {
        ok: false,
        error: 'ESCALA_API_TARGET nao configurado',
        hint: 'Defina ESCALA_API_TARGET no Cloudflare Pages/Functions.',
      },
      { 'x-request-id': requestId },
    )
  }
  if (!actorKey) {
    return json(
      503,
      {
        ok: false,
        error: 'ESCALA_ACTOR_HMAC_KEY nao configurado',
        hint: 'Defina ESCALA_ACTOR_HMAC_KEY no Cloudflare Pages/Functions.',
      },
      { 'x-request-id': requestId },
    )
  }

  if (localShadowWritesEnabled) {
    const shadowWriteResponse = await handleLocalShadowWrite(request.clone() as unknown as Request, rest, actor, requestId)
    if (shadowWriteResponse) return shadowWriteResponse
  }

  const actorTs = String(Date.now())
  const targetUrl = new URL(targetOrigin)
  const basePath = targetUrl.pathname.replace(/\/$/, '')
  targetUrl.pathname = `${basePath}/api/escala${rest.startsWith('/') ? '' : '/'}${rest}`
  targetUrl.search = url.search

  const headers = buildUpstreamHeaders(request, requestId)
  headers.set('x-crm-user', actorB64)
  headers.set('x-crm-ts', actorTs)
  const sig = await signHmacSha256B64Url(actorKey, `${actorTs}.${actorB64}`)
  headers.set('x-crm-signature', sig)

  const method = (request.method || 'GET').toUpperCase()
  const body = method === 'GET' || method === 'HEAD' ? undefined : request.body

  const upstreamRequest = new Request(targetUrl.toString(), {
    method,
    headers,
    body,
    redirect: 'manual',
  })

  let upstream: Response
  try {
    upstream = await fetch(upstreamRequest)
  } catch (error: any) {
    return json(
      502,
      {
        ok: false,
        error: 'UPSTREAM_UNREACHABLE',
        detail: String(error?.message || error || 'Falha de conexão com escala-api'),
      },
      { 'x-request-id': requestId },
    )
  }
  const shouldApplyShadowOnRead =
    localShadowWritesEnabled &&
    method === 'GET' &&
    (rest === '/schedule' || rest === '/overview')

  if (shouldApplyShadowOnRead) {
    const text = await upstream.text()
    let parsed: any = null
    try {
      parsed = text ? JSON.parse(text) : null
    } catch {
      parsed = null
    }
    if (!parsed || typeof parsed !== 'object') {
      const headers = new Headers(upstream.headers)
      headers.set('Cache-Control', 'no-store')
      headers.set('x-request-id', requestId)
      return new Response(text, {
        status: upstream.status,
        statusText: upstream.statusText,
        headers,
      })
    }

    const canOverlay = upstream.ok && parsed?.ok !== false

    if (rest === '/schedule') {
      const unit = String(url.searchParams.get('unit') || '').trim() || undefined
      const month = String(url.searchParams.get('month') || '').trim() || undefined
      const ops = listShadowOperations(unit, month)
      const out = canOverlay && ops.length ? applyShadowOperationsToSchedulePayload(parsed, ops) : parsed
      return json(upstream.status, out, {
        'x-request-id': requestId,
        'x-escala-local-shadow': '1',
      })
    }

    if (rest === '/overview') {
      const ops = listShadowOperations()
      const out = canOverlay && ops.length ? applyShadowOperationsToOverviewPayload(parsed, ops) : parsed
      return json(upstream.status, out, {
        'x-request-id': requestId,
        'x-escala-local-shadow': '1',
      })
    }
  }

  const outHeaders = new Headers(upstream.headers)
  outHeaders.set('Cache-Control', 'no-store')
  outHeaders.set('x-request-id', requestId)

  return new Response(upstream.body, {
    status: upstream.status,
    statusText: upstream.statusText,
    headers: outHeaders,
  })
}
