import {
  CANONICAL_UNIT_SCOPES,
  normalizeAllowedUnits,
  normalizeUnitScope,
} from '../../shared/identity-contract/index.js'

/** Sentinel used only by the read-only aggregate view in the CRM. */
export const INSUMOS_ALL_UNITS = 'all'

export function isInsumosAllUnits(value: unknown) {
  return String(value || '').trim().toLowerCase() === INSUMOS_ALL_UNITS
}

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
  const requestedAllUnits = isInsumosAllUnits(input.savedUnit)
  const requestedUnit = requestedAllUnits ? INSUMOS_ALL_UNITS : normalizeUnitScope(input.savedUnit)
  const canAggregate = visibleUnits.length > 1
  const selectedUnit = requestedAllUnits && canAggregate
    ? INSUMOS_ALL_UNITS
    : (requestedUnit && visibleUnits.includes(requestedUnit) ? requestedUnit : (visibleUnits[0] || ''))
  return {
    allowedUnits,
    visibleUnits,
    requestedUnit,
    selectedUnit,
    hasAuthorizedUnit: visibleUnits.length > 0,
    canAggregate,
    isAllUnits: selectedUnit === INSUMOS_ALL_UNITS,
    isAdmin,
  }
}
