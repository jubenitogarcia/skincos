import { useEffect, useMemo } from 'react'
import { useKV } from '@/spark-mock'

export type UnitOption = { value: string; label: string }

// Back-compat: older selections used "custom" + a separate text input.
// We no longer expose this in the UI, but we still normalize it to a real unit.
const LEGACY_CUSTOM_VALUE = 'custom'

// Canonical unit list used across the CRM (UI + modules).
// Keep this stable; modules rely on the same "value" keys everywhere.
export const DEFAULT_UNIT_OPTIONS: UnitOption[] = [
  { value: 'novo-hamburgo', label: 'Novo Hamburgo' },
  { value: 'barra-shopping-sul', label: 'Barra Shopping Sul' }
]

const GLOBAL_UNIT_KEY = 'skincos.unit.selected.v1'

// Back-compat: older insumos selection key.
const INSUMOS_UNIT_KEY = 'skincos.insumos.unidade.v1'

function safeLocalStorageGet(key: string): string {
  try {
    if (typeof window === 'undefined') return ''
    return String(window.localStorage.getItem(key) || '')
  } catch {
    return ''
  }
}

export function getInitialSelectedUnit(defaultValue = DEFAULT_UNIT_OPTIONS[0]?.value || 'novo-hamburgo'): string {
  const fromInsumos = safeLocalStorageGet(INSUMOS_UNIT_KEY).trim()
  const candidate = fromInsumos || defaultValue
  return normalizeSelectedUnit(candidate, defaultValue)
}

function normalizeSelectedUnit(value: string, fallback: string): string {
  const v = String(value || '').trim()
  if (!v) return fallback
  if (v === LEGACY_CUSTOM_VALUE) return fallback
  return v
}

export function useGlobalUnitSelection(options: UnitOption[] = DEFAULT_UNIT_OPTIONS) {
  const optionsByValue = useMemo(() => new Map(options.map((o) => [o.value, o])), [options])
  const fallback = options[0]?.value || 'novo-hamburgo'
  const defaultSelected = getInitialSelectedUnit(fallback)

  const [selectedUnit, setSelectedUnit] = useKV<string>(GLOBAL_UNIT_KEY, defaultSelected)
  const normalizedSelectedUnit = useMemo(() => normalizeSelectedUnit(selectedUnit, fallback), [fallback, selectedUnit])

  const effectiveUnit = normalizedSelectedUnit
  const selectedLabel = optionsByValue.get(normalizedSelectedUnit)?.label || normalizedSelectedUnit

  useEffect(() => {
    if (normalizedSelectedUnit !== selectedUnit) setSelectedUnit(normalizedSelectedUnit)
  }, [normalizedSelectedUnit, selectedUnit, setSelectedUnit])

  // Keep Insumos legacy key in sync so existing code paths keep working.
  useEffect(() => {
    try {
      if (typeof window === 'undefined') return
      window.localStorage.setItem(INSUMOS_UNIT_KEY, effectiveUnit)
    } catch {
      // ignore
    }
  }, [effectiveUnit])

  return {
    options,
    selectedUnit: normalizedSelectedUnit,
    setSelectedUnit,
    effectiveUnit,
    selectedLabel
  }
}
