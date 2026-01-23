import { useEffect, useMemo } from 'react'
import { useKV } from '@/spark-mock'

export type UnitOption = { value: string; label: string }

export const UNIT_CUSTOM_VALUE = 'custom'

// Canonical unit list used across the CRM (UI + modules).
// Keep this stable; modules rely on the same "value" keys everywhere.
export const DEFAULT_UNIT_OPTIONS: UnitOption[] = [
  { value: 'novo-hamburgo', label: 'Novo Hamburgo' },
  { value: 'barra-shopping-sul', label: 'Barra Shopping Sul' },
  { value: UNIT_CUSTOM_VALUE, label: 'Outra…' }
]

const GLOBAL_UNIT_KEY = 'skincos.unit.selected.v1'
const GLOBAL_UNIT_CUSTOM_KEY = 'skincos.unit.custom.v1'

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
  if (fromInsumos) return fromInsumos
  return defaultValue
}

export function useGlobalUnitSelection(options: UnitOption[] = DEFAULT_UNIT_OPTIONS) {
  const optionsByValue = useMemo(() => new Map(options.map((o) => [o.value, o])), [options])
  const defaultSelected = getInitialSelectedUnit(options[0]?.value || 'novo-hamburgo')

  const [selectedUnit, setSelectedUnit] = useKV<string>(GLOBAL_UNIT_KEY, defaultSelected)
  const [customUnit, setCustomUnit] = useKV<string>(GLOBAL_UNIT_CUSTOM_KEY, '')

  const effectiveUnit = selectedUnit === UNIT_CUSTOM_VALUE ? (customUnit.trim() || UNIT_CUSTOM_VALUE) : selectedUnit
  const selectedLabel = optionsByValue.get(selectedUnit)?.label || selectedUnit

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
    selectedUnit,
    setSelectedUnit,
    customUnit,
    setCustomUnit,
    effectiveUnit,
    selectedLabel
  }
}

