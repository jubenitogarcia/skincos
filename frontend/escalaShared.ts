import type { CSSProperties } from 'react'

import type { EscalaProfessional } from '@/escalaTypes'

export const MONTH_LABELS = new Map<string, string>()
export const DEFAULT_DATE = new Date()
export const DEFAULT_MONTH_NUMBER = String(DEFAULT_DATE.getMonth() + 1).padStart(2, '0')
export const DEFAULT_YEAR = String(DEFAULT_DATE.getFullYear())
export const MONTH_OPTIONS = Array.from({ length: 12 }, (_, index) => String(index + 1).padStart(2, '0'))
export const ALL_PROFESSIONALS_OPTION = '–'
export const NEW_TEAM_MEMBER_KEY = '__new__'
export const STATUS_OPTIONS = ['Ativo', 'Inativo']
export const UNIT_OPTIONS = ['BarraShoppingSul', 'Novo Hamburgo']
export const ROLE_OPTIONS = ['Diretor', 'Gerente', 'Coordenador', 'Responsável Técnico', 'Injetor', 'Consultor']
export const DEFAULT_TEAM_COLOR = '#ec4899'

export function formatMonthLabel(value: string) {
  if (MONTH_LABELS.has(value)) return MONTH_LABELS.get(value) as string
  const [year, month] = value.split('-').map(Number)
  const date = new Date(year, month - 1, 1)
  let label = date.toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' })
  label = label.charAt(0).toUpperCase() + label.slice(1)
  MONTH_LABELS.set(value, label)
  return label
}

export function formatMonthName(value: string) {
  const month = Number(value)
  if (!month) return value
  const date = new Date(2000, month - 1, 1)
  const label = date.toLocaleDateString('pt-BR', { month: 'long' })
  return label.charAt(0).toUpperCase() + label.slice(1)
}

export function formatDisplayDate(value: string) {
  const [year, month, day] = String(value || '').split('-')
  if (!year || !month || !day) return value
  return `${day}/${month}/${year}`
}

export function shiftMonthValue(monthValue: string, offset: number) {
  const [year, month] = monthValue.split('-').map(Number)
  const date = new Date(year, month - 1 + offset, 1)
  return {
    year: String(date.getFullYear()),
    monthNumber: String(date.getMonth() + 1).padStart(2, '0'),
  }
}

export function uniqueNames(values: string[]) {
  return Array.from(new Set(values.map((value) => String(value || '').trim()).filter(Boolean)))
}

export function normalizeText(value: string) {
  return String(value || '').trim().toLowerCase()
}

export function normalizeHexColor(value: string) {
  const raw = String(value || '').trim().toLowerCase()
  if (!raw) return ''
  const normalized = raw.startsWith('#') ? raw : `#${raw}`
  if (/^#[0-9a-f]{6}$/.test(normalized)) return normalized
  if (/^#[0-9a-f]{3}$/.test(normalized)) {
    const [, r, g, b] = normalized
    return `#${r}${r}${g}${g}${b}${b}`
  }
  return ''
}

export function hexToRgba(value: string, alpha: number) {
  const hex = normalizeHexColor(value)
  if (!hex) return `rgba(236, 72, 153, ${alpha})`
  const red = Number.parseInt(hex.slice(1, 3), 16)
  const green = Number.parseInt(hex.slice(3, 5), 16)
  const blue = Number.parseInt(hex.slice(5, 7), 16)
  return `rgba(${red}, ${green}, ${blue}, ${alpha})`
}

export function formatBrazilPhone(value: string) {
  const digits = String(value || '').replace(/\D/g, '')
  if (!digits) return ''
  const normalized = (digits.startsWith('55') ? digits : `55${digits}`).slice(0, 13)
  const country = normalized.slice(0, 2)
  const area = normalized.slice(2, 4)
  const subscriber = normalized.slice(4)
  let formatted = `+${country}`
  if (area) {
    formatted += ` (${area}`
    if (area.length === 2) formatted += ')'
  }
  if (subscriber) {
    const prefixLength = subscriber.length > 8 ? 5 : Math.min(4, subscriber.length)
    const prefix = subscriber.slice(0, prefixLength)
    const suffix = subscriber.slice(prefixLength)
    formatted += ` ${prefix}`
    if (suffix) formatted += `-${suffix}`
  }
  return formatted
}

export function normalizeUnitKey(value: string) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '')
    .trim()
}

export function unitsMatch(left: string, right: string) {
  return normalizeUnitKey(left) === normalizeUnitKey(right)
}

export function isActiveInjector(prof: EscalaProfessional) {
  const role = normalizeText(prof.role)
  const status = normalizeText(prof.status)
  return role.includes('injetor') && status === 'ativo'
}

export function isInactiveInjector(prof: EscalaProfessional) {
  const role = normalizeText(prof.role)
  const status = normalizeText(prof.status)
  return role.includes('injetor') && status === 'inativo'
}

export function isVisibleInjector(prof: EscalaProfessional) {
  return isActiveInjector(prof) || isInactiveInjector(prof)
}

export function normalizeProfessionalRecord(prof: EscalaProfessional) {
  return {
    ...prof,
    role: String(prof.role || '').trim() || 'Injetor',
    status: String(prof.status || '').trim() || 'Ativo',
    units: Array.isArray(prof.units) ? prof.units : [],
  }
}

export function mergeProfessionals(scheduleNames: Set<string>, base: EscalaProfessional[]) {
  const map = new Map<string, EscalaProfessional>()
  base.forEach((prof) => {
    map.set(prof.name, normalizeProfessionalRecord(prof))
  })
  scheduleNames.forEach((name) => {
    if (map.has(name)) return
    map.set(name, normalizeProfessionalRecord({
      name,
      status: 'Ativo',
      units: [],
      role: 'Injetor',
      shift: '',
      nickname: '',
      phone: '',
      email: '',
      instagram: '',
      color: '',
    }))
  })
  return Array.from(map.values())
}

export function parseDelimitedValues(value: string) {
  return uniqueNames(String(value || '').split(',').map((item) => item.trim()))
}

export function formatDelimitedValues(values: string[]) {
  return uniqueNames(values).join(', ')
}

export function parseUnitsInput(value: string) {
  return parseDelimitedValues(value)
}

export function normalizeProfessionalForCompare(prof: EscalaProfessional | null) {
  if (!prof) return null
  return {
    name: String(prof.name || '').trim(),
    status: String(prof.status || '').trim(),
    units: uniqueNames(prof.units || []),
    role: String(prof.role || '').trim(),
    shift: String(prof.shift || '').trim(),
    nickname: String(prof.nickname || '').trim(),
    phone: String(prof.phone || '').trim(),
    email: String(prof.email || '').trim(),
    instagram: String(prof.instagram || '').trim(),
    color: normalizeHexColor(prof.color),
  }
}

export function buildYearOptions(monthKeys: string[]) {
  const currentYear = Number(DEFAULT_YEAR)
  const years = new Set<string>([String(currentYear - 1), DEFAULT_YEAR, String(currentYear + 1), String(currentYear + 2)])
  monthKeys.forEach((value) => {
    const year = String(value || '').slice(0, 4)
    if (/^\d{4}$/.test(year)) years.add(year)
  })
  return Array.from(years).sort((a, b) => Number(a) - Number(b))
}

export function normalizeMonthKey(value: string) {
  return /^\d{4}-\d{2}$/.test(String(value || '')) ? String(value) : ''
}

export function resolveVisibleMonth(monthKeys: string[], year: string, monthNumber: string) {
  const available = Array.from(new Set(monthKeys.map(normalizeMonthKey).filter(Boolean))).sort()
  const selected = normalizeMonthKey(`${year}-${monthNumber}`)
  const fallback = available.length ? available[available.length - 1] : (selected || `${DEFAULT_YEAR}-${DEFAULT_MONTH_NUMBER}`)
  const next = selected && available.includes(selected) ? selected : fallback
  return {
    year: next.slice(0, 4),
    monthNumber: next.slice(5, 7),
  }
}

export function hashString(value: string) {
  let hash = 0
  for (let index = 0; index < value.length; index += 1) {
    hash = value.charCodeAt(index) + ((hash << 5) - hash)
  }
  return Math.abs(hash)
}

export function getProfessionalBadgeStyle(
  name: string,
  mode: 'default' | 'active' | 'muted' = 'default',
  accentColor?: string,
) {
  const color = normalizeHexColor(accentColor || '')
  const hash = hashString(name)
  const hue = hash % 360
  const baseText = color ? 'white' : `hsl(${hue} 88% 92%)`

  if (mode === 'active') {
    return {
      background: color
        ? `linear-gradient(135deg, ${hexToRgba(color, 0.55)}, ${hexToRgba(color, 0.28)})`
        : `linear-gradient(135deg, hsla(${hue}, 82%, 56%, 0.38), hsla(${(hue + 28) % 360}, 82%, 58%, 0.26))`,
      borderColor: color ? hexToRgba(color, 0.92) : `hsla(${hue}, 88%, 74%, 0.9)`,
      color: 'white',
      boxShadow: color
        ? `0 0 0 1px ${hexToRgba(color, 0.45)}, 0 16px 28px ${hexToRgba(color, 0.28)}, inset 0 1px 0 rgba(255,255,255,0.18)`
        : `0 0 0 1px hsla(${hue}, 90%, 74%, 0.45), 0 16px 28px hsla(${hue}, 90%, 20%, 0.28), inset 0 1px 0 rgba(255,255,255,0.18)`,
      opacity: 1,
    } as CSSProperties
  }

  if (mode === 'muted') {
    return {
      background: 'rgba(15, 23, 42, 0.28)',
      borderColor: 'rgba(148, 163, 184, 0.18)',
      color: 'rgba(226, 232, 240, 0.58)',
      boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.02)',
      opacity: 0.72,
    } as CSSProperties
  }

  return {
    background: color
      ? `linear-gradient(135deg, ${hexToRgba(color, 0.28)}, ${hexToRgba(color, 0.16)})`
      : `linear-gradient(135deg, hsla(${hue}, 78%, 56%, 0.22), hsla(${(hue + 24) % 360}, 78%, 58%, 0.14))`,
    borderColor: color ? hexToRgba(color, 0.5) : `hsla(${hue}, 84%, 72%, 0.4)`,
    color: baseText,
    boxShadow: color
      ? `inset 0 1px 0 rgba(255,255,255,0.08), 0 0 0 1px ${hexToRgba(color, 0.12)}`
      : 'inset 0 1px 0 rgba(255,255,255,0.05)',
    opacity: 1,
  } as CSSProperties
}

export function getProfessionalCardHighlightStyle(name: string, accentColor?: string) {
  const color = normalizeHexColor(accentColor || '')
  const hue = hashString(name) % 360
  return {
    borderColor: color ? hexToRgba(color, 0.78) : `hsla(${hue}, 88%, 74%, 0.72)`,
    background: color
      ? `linear-gradient(180deg, ${hexToRgba(color, 0.18)}, rgba(15, 23, 42, 0.34))`
      : `linear-gradient(180deg, hsla(${hue}, 86%, 54%, 0.12), rgba(15, 23, 42, 0.34))`,
    boxShadow: color
      ? `0 0 0 1px ${hexToRgba(color, 0.24)}, 0 18px 34px ${hexToRgba(color, 0.24)}, inset 0 1px 0 rgba(255,255,255,0.06)`
      : `0 0 0 1px hsla(${hue}, 88%, 74%, 0.25), 0 18px 34px hsla(${hue}, 90%, 18%, 0.24), inset 0 1px 0 rgba(255,255,255,0.06)`,
  } as CSSProperties
}

export function getAdjacentMonthCardStyle(type: 'previous-month' | 'next-month', position: number, total: number) {
  if (!total || !position) return {} as CSSProperties
  const step = 0.8 / total
  const transparency = type === 'previous-month'
    ? Math.min(0.9, 0.1 + step * (total - position + 1))
    : Math.min(0.9, 0.1 + step * (position - 1))
  const opacity = 1 - transparency * 0.58
  const blur = 8 + transparency * 10
  const saturation = 0.84 - transparency * 0.36
  const grayscale = 0.12 + transparency * 0.52
  const borderAlpha = 0.08 + transparency * 0.18
  const topAlpha = 0.025 + transparency * 0.07
  const bottomAlpha = 0.045 + transparency * 0.12
  return {
    opacity: Number(opacity.toFixed(3)),
    borderColor: `rgba(148, 163, 184, ${borderAlpha.toFixed(3)})`,
    background: `linear-gradient(180deg, rgba(255,255,255,${topAlpha.toFixed(3)}), rgba(148,163,184,${bottomAlpha.toFixed(3)}))`,
    boxShadow: `inset 0 1px 0 rgba(255,255,255,${(0.03 + transparency * 0.06).toFixed(3)}), 0 10px 24px rgba(15,23,42,${(0.05 + transparency * 0.08).toFixed(3)})`,
    filter: `grayscale(${grayscale.toFixed(2)}) saturate(${saturation.toFixed(2)})`,
    backdropFilter: `blur(${blur.toFixed(1)}px) saturate(${(0.9 - transparency * 0.18).toFixed(2)})`,
    WebkitBackdropFilter: `blur(${blur.toFixed(1)}px) saturate(${(0.9 - transparency * 0.18).toFixed(2)})`,
  } as CSSProperties
}

export function slugifySegment(value: string) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '')
}

export function createEmptyProfessional(selectedUnit?: string): EscalaProfessional {
  return {
    name: '',
    status: 'Ativo',
    units: selectedUnit ? [selectedUnit] : [],
    role: '',
    shift: '',
    nickname: '',
    phone: '',
    email: '',
    instagram: '',
    color: '',
  }
}

export function toLocalIsoDate(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}
