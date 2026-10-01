export type UnitOption = { value: string; label: string }

// The Ponto surface needs only the stable canonical fallback options. It does
// not import the CRM-wide persisted unit-selection hook.
export const DEFAULT_UNIT_OPTIONS: UnitOption[] = [
  { value: 'novo-hamburgo', label: 'Novo Hamburgo' },
  { value: 'barra-shopping-sul', label: 'Barra Shopping Sul' },
]
