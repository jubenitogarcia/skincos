import {
  CANONICAL_UNIT_SCOPES,
  normalizeAllowedUnits,
  normalizeUnitScope,
} from '../../shared/identity-contract/index.js'

export function resolveInsumosUnitAccess(input: {
  role?: string | null
  allowedUnits?: unknown
  savedUnit?: string | null
  availableUnits?: string[]
}) {
  const isAdmin = String(input.role || '').trim().toUpperCase() === 'ADMIN'
  const available = normalizeAllowedUnits(input.availableUnits || CANONICAL_UNIT_SCOPES)
  const allowedUnits = normalizeAllowedUnits(input.allowedUnits)
  const visibleUnits = isAdmin ? available : available.filter((unit) => allowedUnits.includes(unit))
  const requestedUnit = normalizeUnitScope(input.savedUnit)
  const selectedUnit = requestedUnit && visibleUnits.includes(requestedUnit) ? requestedUnit : (visibleUnits[0] || '')
  return { allowedUnits, visibleUnits, requestedUnit, selectedUnit, hasAuthorizedUnit: visibleUnits.length > 0, isAdmin }
}
