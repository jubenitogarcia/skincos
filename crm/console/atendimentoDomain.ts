export type AtendimentoFilters = {
  unit: string
  from: string
  to: string
  procedure: string
  code: string
  injector: string
  consultant: string
  search: string
}

export type AtendimentoForm = {
  id?: string
  revision?: number
  unitSlug: string
  unitName?: string
  date: string
  clientName: string
  procedureName: string
  code: string
  quantity: number
  discount: boolean
  otherValue: number
  roundValue: boolean
  value?: number
  injectorId?: string | null
  consultantId?: string | null
  injectorName: string
  consultantName: string
  observation: string
}

export type AtendimentoProfessionalRef = {
  id: string
  canonicalId?: string
  name: string
  role?: string
  status?: string
  units?: string[]
  shift?: string
  roles?: string[]
  turnos?: string[]
}

export type AtendimentoApiResultLike = {
  ok: boolean
  error?: string
}

export const DEFAULT_ATENDIMENTO_FILTERS: AtendimentoFilters = {
  unit: 'all',
  from: '',
  to: '',
  procedure: 'all',
  code: '',
  injector: 'all',
  consultant: 'all',
  search: '',
}

export const EMPTY_ATENDIMENTO_FORM: AtendimentoForm = {
  unitSlug: 'novo-hamburgo',
  unitName: 'Novo Hamburgo',
  date: new Date().toISOString().slice(0, 10),
  clientName: '',
  procedureName: '',
  code: '',
  quantity: 1,
  discount: false,
  otherValue: 0,
  roundValue: false,
  injectorName: '',
  injectorId: null,
  consultantName: '',
  consultantId: null,
  observation: '',
}

export function normalizeCode(value: string) {
  const raw = String(value || '').trim().toUpperCase()
  const digits = raw.match(/\d+/)?.[0] || ''
  if (!digits) return raw
  return `#${digits.padStart(4, '0')}`
}

export function codeNumericValue(code: string) {
  const digits = String(code || '').match(/\d+/)?.[0] || ''
  if (!digits) return null
  const value = Number(digits)
  return Number.isFinite(value) ? value : null
}

export function parseBrazilCurrency(value: string | number) {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  const cleaned = String(value || '')
    .replace(/[^\d,.-]/g, '')
    .replace(/\.(?=\d{3}(?:\D|$))/g, '')
    .replace(',', '.')
  const parsed = Number(cleaned)
  return Number.isFinite(parsed) ? parsed : 0
}

export function calculateAtendimentoValue(input: Pick<AtendimentoForm, 'code' | 'quantity' | 'discount' | 'otherValue' | 'roundValue'>) {
  const base = codeNumericValue(input.code)
  if (base == null) return 0
  const quantity = Number(input.quantity || 0)
  const other = Number(input.otherValue || 0)
  const raw = base * quantity * (input.discount ? 0.97 : 1) - other
  const value = input.roundValue ? Math.round(raw / 10) * 10 : raw
  return Math.round((value + Number.EPSILON) * 100) / 100
}

export function convertColorCodesToScores(colorArray: string[] | string[][]) {
  const map: Record<string, number> = {
    '#6d9eeb': 3,
    '#93c47d': 2,
    '#ffd966': 1,
    '#e06666': 0,
    '#ffffff': 0,
  }
  if (!Array.isArray(colorArray) || colorArray.length === 0) return [[]]
  const rows = Array.isArray(colorArray[0]) ? colorArray as string[][] : (colorArray as string[]).map((value) => [value])
  return rows.map((row) => row.map((color) => {
    const key = String(color || '').trim().toLowerCase()
    return map[key] !== undefined ? map[key] : 'Erro'
  }))
}

export function resolveManagementLoadError(results: {
  catalog: AtendimentoApiResultLike
  commercial: AtendimentoApiResultLike
  finance: AtendimentoApiResultLike
  inventory: AtendimentoApiResultLike
}) {
  const blocking = [results.catalog, results.commercial, results.finance, results.inventory].find((result) => !result.ok)
  return blocking?.error || ''
}

function normalizeRole(value: string) {
  const raw = String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toLowerCase()
  if (raw === 'consultora') return 'consultor'
  if (raw === 'injetora') return 'injetor'
  return raw
}

function splitList(value: string | string[] | undefined) {
  if (Array.isArray(value)) return value.map(String).map((item) => item.trim()).filter(Boolean)
  return String(value || '').split(',').map((item) => item.trim()).filter(Boolean)
}

export function determineAtendimentoShift(unitSlugOrName: string, at = new Date()) {
  const unit = String(unitSlugOrName || '').toLowerCase()
  const h = at.getHours()
  const m = at.getMinutes()
  if (unit.includes('novo')) {
    if ((h === 8 && m >= 30) || (h > 8 && h < 16) || (h === 16 && m <= 30)) return 'Manhã'
    if ((h === 12 && m >= 30) || (h > 12 && h < 20) || (h === 20 && m <= 30)) return 'Tarde'
  }
  if (unit.includes('barra')) {
    if (h >= 10 && h < 18) return 'Manhã'
    if (h >= 14 && h < 22) return 'Tarde'
  }
  return ''
}

export function filterProfessionalsByUnitRole(
  professionals: AtendimentoProfessionalRef[],
  unitName: string,
  role: string,
  shift?: string,
) {
  return filterProfessionalReferencesByUnitRole(professionals, unitName, role, shift)
    .map((professional) => professional.name)
}

export function filterProfessionalReferencesByUnitRole(
  professionals: AtendimentoProfessionalRef[],
  unitName: string,
  role: string,
  shift?: string,
) {
  const wantedRole = normalizeRole(role)
  return professionals
    .filter((professional) => {
      if (professional.status && professional.status !== 'Ativo') return false
      const units = splitList(professional.units)
      const roles = splitList(professional.roles?.length ? professional.roles : professional.role).map(normalizeRole)
      const shifts = splitList(professional.turnos?.length ? professional.turnos : professional.shift)
      if (units.length && !units.includes(unitName)) return false
      if (!roles.includes(wantedRole)) return false
      if (shift && shifts.length && !shifts.includes(shift)) return false
      return true
    })
}

export function formatCurrencyBRL(value: number) {
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(Number(value || 0))
}

export function formatNumberBR(value: number) {
  return new Intl.NumberFormat('pt-BR').format(Number(value || 0))
}

export function buildAtendimentoQuery(filters: AtendimentoFilters, paging: { limit?: number; offset?: number } = {}) {
  const params = new URLSearchParams()
  if (filters.unit && filters.unit !== 'all') params.set('unit', filters.unit)
  if (filters.from) params.set('from', filters.from)
  if (filters.to) params.set('to', filters.to)
  if (filters.procedure && filters.procedure !== 'all') params.set('procedure', filters.procedure)
  if (filters.code) params.set('code', normalizeCode(filters.code))
  if (filters.injector && filters.injector !== 'all') params.set('injector', filters.injector)
  if (filters.consultant && filters.consultant !== 'all') params.set('consultant', filters.consultant)
  if (filters.search) params.set('search', filters.search)
  if (paging.limit) params.set('limit', String(paging.limit))
  if (paging.offset) params.set('offset', String(paging.offset))
  return params
}

export function validateAtendimentoForm(form: AtendimentoForm, allowedCodes: string[]) {
  if (!form.date) return 'Informe a data.'
  if (!form.clientName.trim()) return 'Informe o cliente.'
  if (!form.procedureName.trim()) return 'Selecione o procedimento.'
  const code = normalizeCode(form.code)
  if (!code) return 'Selecione o código.'
  if (allowedCodes.length && !allowedCodes.includes(code)) return 'Código não permitido para o procedimento.'
  if (!Number.isFinite(Number(form.quantity)) || Number(form.quantity) <= 0) return 'Quantidade inválida.'
  return ''
}
