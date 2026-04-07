import process from 'node:process'

const DEFAULT_BASE_URL = 'https://escala-api.skincos.com.br'

function encodeBase64Url(input) {
  return Buffer.from(String(input || ''), 'utf8')
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '')
}

async function signHmac(secret, message) {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  const signature = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(message))
  return Buffer.from(signature)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '')
}

function assert(condition, message) {
  if (!condition) throw new Error(message)
}

function normalizeMonth(value) {
  const raw = String(value || '').trim()
  return /^\d{4}-\d{2}$/.test(raw) ? raw : ''
}

function normalizeUnit(value) {
  return String(value || '').trim()
}

function pickLatestMonth(months) {
  return [...months].sort().at(-1) || ''
}

function isProfessionalShape(row) {
  return !!row
    && typeof row === 'object'
    && typeof row.name === 'string'
    && Array.isArray(row.units)
}

async function fetchJson({ baseUrl, path, secret, actor }) {
  const ts = String(Date.now())
  const actorPayload = encodeBase64Url(JSON.stringify(actor))
  const signature = await signHmac(secret, `${ts}.${actorPayload}`)
  const response = await fetch(`${baseUrl}${path}`, {
    headers: {
      accept: 'application/json',
      'user-agent': 'EscalaApiSmoke/1.0',
      'x-crm-user': actorPayload,
      'x-crm-ts': ts,
      'x-crm-signature': signature,
      'x-request-id': `escala-smoke-${Date.now()}`,
    },
  })
  const text = await response.text()
  let json = null
  try {
    json = text ? JSON.parse(text) : null
  } catch {
    throw new Error(`Resposta não-JSON em ${path}: ${text.slice(0, 200)}`)
  }
  if (!response.ok || json?.ok === false) {
    const detail = String(json?.error || json?.message || text || `HTTP ${response.status}`).trim()
    throw new Error(`Falha em ${path}: ${detail}`)
  }
  return json
}

async function main() {
  const secret = String(process.env.ESCALA_ACTOR_HMAC_KEY || '').trim()
  assert(secret, 'ESCALA_ACTOR_HMAC_KEY ausente.')

  const baseUrl = String(process.env.ESCALA_SMOKE_BASE_URL || DEFAULT_BASE_URL).trim().replace(/\/+$/, '')
  assert(baseUrl, 'ESCALA_SMOKE_BASE_URL inválido.')

  const explicitUnit = normalizeUnit(process.env.ESCALA_SMOKE_UNIT)
  const explicitMonth = normalizeMonth(process.env.ESCALA_SMOKE_MONTH)
  const actor = {
    id: 'escala-smoke',
    username: 'github-actions',
    email: 'escala-smoke@github-actions.local',
    role: 'GESTOR',
    allowedUnits: explicitUnit ? [explicitUnit] : [],
  }

  const overview = await fetchJson({
    baseUrl,
    path: '/api/escala/overview',
    secret,
    actor,
  })

  const units = explicitUnit
    ? [explicitUnit]
    : Array.isArray(overview?.units) ? overview.units.map(normalizeUnit).filter(Boolean) : []
  assert(units.length > 0, 'Nenhuma unidade retornada por /overview.')

  const overviewMonths = Array.isArray(overview?.months)
    ? overview.months.map(normalizeMonth).filter(Boolean)
    : []
  const selectedMonth = explicitMonth || pickLatestMonth(overviewMonths) || new Date().toISOString().slice(0, 7)

  let selectedUnit = ''
  let selectedProfessionals = []
  let emptyUnitsChecked = 0
  for (const unit of units) {
    const professionals = await fetchJson({
      baseUrl,
      path: `/api/escala/professionals?unit=${encodeURIComponent(unit)}`,
      secret,
      actor,
    })
    const rows = Array.isArray(professionals?.data) ? professionals.data : []
    assert(rows.every(isProfessionalShape), `Payload inválido em /professionals para unidade ${unit}.`)
    if (rows.length > 0) {
      selectedUnit = unit
      selectedProfessionals = rows
      break
    }
    emptyUnitsChecked += 1
  }

  assert(selectedUnit, `Nenhuma unidade com profissionais disponíveis. Unidades verificadas sem dados: ${emptyUnitsChecked}.`)

  const schedule = await fetchJson({
    baseUrl,
    path: `/api/escala/schedule?unit=${encodeURIComponent(selectedUnit)}&month=${encodeURIComponent(selectedMonth)}`,
    secret,
    actor,
  })

  assert(Array.isArray(schedule?.schedule), 'Payload inválido: schedule não é array.')
  assert(Array.isArray(schedule?.closedDays), 'Payload inválido: closedDays não é array.')
  assert(Array.isArray(schedule?.holidays), 'Payload inválido: holidays não é array.')

  const summary = {
    ok: true,
    baseUrl,
    unit: selectedUnit,
    month: selectedMonth,
    overviewUnits: units.length,
    overviewMonths: overviewMonths.length,
    professionals: selectedProfessionals.length,
    scheduleEntries: schedule.schedule.length,
    closedDays: schedule.closedDays.length,
    holidays: schedule.holidays.length,
  }

  console.log(JSON.stringify(summary, null, 2))
}

main().catch((error) => {
  console.error(`[escala-smoke] ${error instanceof Error ? error.message : String(error)}`)
  process.exitCode = 1
})
