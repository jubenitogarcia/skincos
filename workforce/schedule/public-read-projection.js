import { SCHEDULE_PUBLIC_READ_CONTRACT_VERSION } from './public-read-contract.js'
import { SCHEDULE_PUBLIC_READ_KNOWN_IDENTITIES } from './public-read-professional-identities.js'

export const SCHEDULE_PUBLIC_READ_DATA_LIMITS = Object.freeze({ maxProfiles: 512, maxReferences: 512, maxResponseBytes: 64 * 1024,
  maxSourceIdBytes: 128, maxSourceNameBytes: 256, maxSourceStatusBytes: 128, maxSourceRoleBytes: 4096, maxSourceUnitsBytes: 4096 })
const profileFields = Object.freeze({ id: 128, name: 256, status: 128, role: 4096, units_json: 4096 })
const referenceFields = Object.freeze({ professional_id: 128, professional_name: 256 })
function boundedSqlProjection(fields) {
  const entries = Object.entries(fields)
  const columns = entries.map(([column, cap]) => 'case when length(cast(' + column + ' as blob)) <= ' + cap + ' then ' + column + ' else null end as ' + column)
  const overflow = entries.map(([column, cap]) => 'length(cast(' + column + ' as blob)) > ' + cap).join(' or ')
  return columns.concat('case when ' + overflow + ' then 1 else 0 end as projection_oversized').join(', ')
}
// Bound field materialization in D1 itself. Overflow remains a row and causes
// a failure, never a truncated value or an omitted/inactive/nullable profile.
export const SCHEDULE_PUBLIC_READ_PROFILE_SQL = 'select ' + boundedSqlProjection(profileFields) + ' from professionals order by id asc limit ?1'
export const SCHEDULE_PUBLIC_READ_REFERENCES_SQL = 'select ' + boundedSqlProjection(referenceFields) + ' from schedule_entries where unit = ?1 and date = ?2 order by professional_name asc limit ?3'
const encoder = new TextEncoder()
const sourceIdPattern = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i
const publicIdPattern = /^[a-z0-9][a-z0-9-]{0,79}$/
const controls = /[\u0000-\u001f\u007f]/
const knownIdentities = new Map(SCHEDULE_PUBLIC_READ_KNOWN_IDENTITIES.map((entry) => [entry.sourceId, entry]))
const knownPublicIdentities = new Map(SCHEDULE_PUBLIC_READ_KNOWN_IDENTITIES.map((entry) => [entry.publicId, entry]))
const units = new Map([
  ['novo-hamburgo', 'novo-hamburgo'], ['novohamburgo', 'novo-hamburgo'], ['novo hamburgo', 'novo-hamburgo'],
  ['barra-shopping-sul', 'barra-shopping-sul'], ['barrashoppingsul', 'barra-shopping-sul'],
])
const fail = () => { throw new Error('schedule_public_projection_invalid') }
function publicName(value) {
  if (typeof value !== 'string' || !value.isWellFormed() || controls.test(value)) fail()
  const text = value.trim()
  if (!text || encoder.encode(text).byteLength > 256) fail()
  return text
}
export function normalizeSchedulePublicReadUnit(value) {
  return typeof value === 'string' ? units.get(value.trim().toLowerCase()) || null : null
}
export function isSchedulePublicReadDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const time = Date.parse(value + 'T00:00:00Z')
  return Number.isFinite(time) && new Date(time).toISOString().slice(0, 10) === value
}
function memberUnits(raw) {
  if (typeof raw !== 'string' || encoder.encode(raw).byteLength > 4096) fail()
  let values
  try { values = JSON.parse(raw) } catch { fail() }
  if (!Array.isArray(values) || values.length > 32 || values.some((value) => typeof value !== 'string' || value.length > 80 || controls.test(value))) fail()
  return new Set(values.map(normalizeSchedulePublicReadUnit).filter(Boolean))
}
function eligible(row) {
  return typeof row.status === 'string' && row.status.trim().toLowerCase() === 'ativo'
    && typeof row.role === 'string' && row.role.split(',').map((part) => part.trim()).includes('Injetor')
}
function publicProfile(profile, unit) {
  if (!profile.units.has(unit)) fail()
  if (!profile.eligible) return null
  if (!sourceIdPattern.test(profile.sourceId)) fail()
  const identity = knownIdentities.get(profile.sourceId.toLowerCase())
  if (identity && !identity.units.includes(unit)) fail()
  // Identity originates in the existing source UUID, never a name or handle.
  const id = identity?.publicId || profile.sourceId.toLowerCase()
  if (!publicIdPattern.test(id)) fail()
  return { id, name: publicName(profile.identityName) }
}
export function createSchedulePublicReadCatalogue(rows) {
  if (!Array.isArray(rows) || rows.length > SCHEDULE_PUBLIC_READ_DATA_LIMITS.maxProfiles) fail()
  const byId = new Map(), byName = new Map(), profiles = []
  const overBytes = (value, cap) => typeof value === 'string' && encoder.encode(value).byteLength > cap
  for (const row of rows) {
    if (!row || typeof row !== 'object' || row.projection_oversized
      || typeof row.id !== 'string' || !row.id || overBytes(row.id, SCHEDULE_PUBLIC_READ_DATA_LIMITS.maxSourceIdBytes)
      || typeof row.name !== 'string' || !row.name || overBytes(row.name, SCHEDULE_PUBLIC_READ_DATA_LIMITS.maxSourceNameBytes)
      || overBytes(row.status, SCHEDULE_PUBLIC_READ_DATA_LIMITS.maxSourceStatusBytes)
      || overBytes(row.role, SCHEDULE_PUBLIC_READ_DATA_LIMITS.maxSourceRoleBytes) || controls.test(row.id) || controls.test(row.name)
      || byId.has(row.id) || byName.has(row.name)) fail()
    const profile = Object.freeze({ sourceId: row.id, identityName: row.name, units: memberUnits(row.units_json), eligible: eligible(row) })
    byId.set(row.id, profile); byName.set(row.name, profile); profiles.push(profile)
  }
  return Object.freeze({
    roster(unit) {
      if (!['barra-shopping-sul', 'novo-hamburgo'].includes(unit)) fail()
      return profiles.filter((profile) => profile.eligible && profile.units.has(unit)).map((profile) => publicProfile(profile, unit))
        .sort((left, right) => left.id < right.id ? -1 : left.id > right.id ? 1 : 0)
    },
    availability(references, unit) {
      if (!Array.isArray(references) || references.length > SCHEDULE_PUBLIC_READ_DATA_LIMITS.maxReferences) fail()
      const selected = new Map()
      for (const row of references) {
        if (!row || row.projection_oversized || typeof row.professional_name !== 'string' || !row.professional_name
          || overBytes(row.professional_name, SCHEDULE_PUBLIC_READ_DATA_LIMITS.maxSourceNameBytes)
          || overBytes(row.professional_id, SCHEDULE_PUBLIC_READ_DATA_LIMITS.maxSourceIdBytes)) fail()
        const hasId = row.professional_id !== null && row.professional_id !== undefined
        if (hasId && typeof row.professional_id !== 'string') fail()
        const profile = hasId ? byId.get(row.professional_id) : byName.get(row.professional_name)
        // Existing nullable references are resolved only by the exact UNIQUE
        // source name. Orphans, renames and cross-unit mismatches are not hidden.
        if (!profile || profile.identityName !== row.professional_name || !profile.units.has(unit)) fail()
        const projected = publicProfile(profile, unit)
        if (projected) selected.set(projected.id, projected)
      }
      return [...selected.values()].sort((left, right) => left.id < right.id ? -1 : left.id > right.id ? 1 : 0)
    },
  })
}
function professionals(value, unit) {
  if (!Array.isArray(value) || value.length > SCHEDULE_PUBLIC_READ_DATA_LIMITS.maxProfiles) fail()
  const ids = new Set(), names = new Set()
  return value.map((row) => {
    if (!row || typeof row.id !== 'string' || !publicIdPattern.test(row.id)
      || (!knownPublicIdentities.has(row.id) && !sourceIdPattern.test(row.id))
      || (knownPublicIdentities.has(row.id) && !knownPublicIdentities.get(row.id).units.includes(unit))) fail()
    const name = publicName(row.name)
    if (ids.has(row.id) || names.has(name)) fail()
    ids.add(row.id); names.add(name)
    return { id: row.id, name }
  })
}
export function validateSchedulePublicReadDto(body, { suffix, unit, date } = {}) {
  if (!body || body.ok !== true || body.contract !== SCHEDULE_PUBLIC_READ_CONTRACT_VERSION) fail()
  if (suffix === '/readiness') {
    if (body.ready !== true || body.dependencies?.schedule !== 'available') fail()
    return { ok: true, contract: SCHEDULE_PUBLIC_READ_CONTRACT_VERSION, ready: true, dependencies: { schedule: 'available' } }
  }
  const data = body.data
  if (!data || data.unit !== unit || !['barra-shopping-sul', 'novo-hamburgo'].includes(unit)) fail()
  const roster = professionals(data.professionals, unit)
  if (suffix === '/professionals') return { ok: true, contract: SCHEDULE_PUBLIC_READ_CONTRACT_VERSION, data: { unit, professionals: roster } }
  if (suffix !== '/availability' || !isSchedulePublicReadDate(date) || data.date !== date || typeof data.closed !== 'boolean') fail()
  const names = roster.map((row) => row.name)
  if (data.professionalNames !== undefined && (!Array.isArray(data.professionalNames)
    || data.professionalNames.length !== names.length || names.some((name, index) => data.professionalNames[index] !== name))) fail()
  return { ok: true, contract: SCHEDULE_PUBLIC_READ_CONTRACT_VERSION,
    data: { unit, date, closed: data.closed, professionals: roster, professionalNames: names } }
}
export function assertSchedulePublicReadResponseBudget(body) {
  if (encoder.encode(JSON.stringify(body)).byteLength > SCHEDULE_PUBLIC_READ_DATA_LIMITS.maxResponseBytes) fail()
  return body
}
