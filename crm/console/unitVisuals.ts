const UNIT_BADGE_CLASSES: Record<string, string> = {
  'novo-hamburgo': 'border-sky-300/30 bg-sky-400/10 text-sky-100',
  'barra-shopping-sul': 'border-rose-300/30 bg-rose-400/10 text-rose-100',
}

const UNIT_SELECTED_CLASSES: Record<string, string> = {
  'novo-hamburgo': 'border-sky-300/70 bg-sky-400/20 text-sky-50 hover:bg-sky-400/30',
  'barra-shopping-sul': 'border-rose-300/70 bg-rose-400/20 text-rose-50 hover:bg-rose-400/30',
}

const FALLBACK_BADGE_CLASS = 'border-slate-600 bg-slate-800/60 text-slate-200'
const FALLBACK_SELECTED_CLASS = 'border-sky-300/70 bg-sky-400/20 text-sky-50 hover:bg-sky-400/30'

export function normalizeUnitVisualKey(value: string) {
  return String(value || '').trim().toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '')
}

function unitKey(value: string) {
  const normalized = normalizeUnitVisualKey(value)
  if (normalized.includes('novohamburgo')) return 'novo-hamburgo'
  if (normalized.includes('barrashopping')) return 'barra-shopping-sul'
  return String(value || '').trim().toLowerCase()
}

/** Badge palette shared by Usuários and Atendimento. */
export function unitBadgeClass(value: string) {
  return UNIT_BADGE_CLASSES[unitKey(value)] || FALLBACK_BADGE_CLASS
}

/** Selected access-button palette corresponding to the shared unit badge. */
export function unitSelectedClass(value: string) {
  return UNIT_SELECTED_CLASSES[unitKey(value)] || FALLBACK_SELECTED_CLASS
}
