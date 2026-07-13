import React from 'react'
import type { Insumo } from '@/insumosTypes'

export const CANONICAL_TIPOS_UNIDADE = ['unidade', 'frasco', 'seringa', 'caixa', 'ampola', 'pacote', 'rolo'] as const
const CANONICAL_TIPOS_UNIDADE_SET = new Set<string>(CANONICAL_TIPOS_UNIDADE as readonly string[])

export function normalizeTipoUnidadeToCanonical(raw: string): string {
  const normalized = String(raw || '')
    .trim()
    .toLowerCase()
    .replace(/\s*\(s\)\s*/g, '')
    .trim()
  if (!normalized) return ''
  if (normalized === 'flaconete') return 'frasco'
  return CANONICAL_TIPOS_UNIDADE_SET.has(normalized) ? normalized : ''
}

export function parseBarcodeInput(value: string): string[] {
  return String(value || '')
    .split(/[\n,;]+/g)
    .map((v) => String(v || '').trim())
    .filter(Boolean)
}

export function getInsumoBarcodes(item: Insumo | null | undefined): string[] {
  const codes = new Set<string>()
  const add = (v?: string) => {
    const value = String(v || '').trim()
    if (value) codes.add(value)
  }
  add(item?.codigoBarras)
  if (Array.isArray(item?.codigosBarras)) {
    for (const v of item?.codigosBarras || []) add(String(v || ''))
  }
  return Array.from(codes)
}

export function fmtMoneyBRL(value: number) {
  try {
    return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(value)
  } catch {
    return `R$ ${value.toFixed(2)}`
  }
}

export function fmtMoneyBRL0(value: number) {
  try {
    return new Intl.NumberFormat('pt-BR', {
      style: 'currency',
      currency: 'BRL',
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    }).format(value)
  } catch {
    return `R$ ${Math.round(value)}`
  }
}

export function fmtMoneyBRLCompact(value: number) {
  if (!Number.isFinite(value)) return '-'
  const abs = Math.abs(value)
  if (abs >= 1000) {
    const rounded = Math.round(value / 1000)
    return `R$ ${rounded}k`
  }
  return fmtMoneyBRL0(value)
}

const CATEGORIA_CORES: Record<string, string> = {
  toxina: '#1e3a8a',
  'toxina botulínica': '#1e3a8a',
  'toxina botulinica': '#1e3a8a',
  preenchedor: '#bfdbfe',
  bioestimulador: '#ec4899',
  fio: '#7c3aed',
  'fio pdo': '#1f2937',
  descartável: '#6b7280',
  descartavel: '#6b7280',
  peeling: '#ea580c',
  skinbooster: '#ec4899',
  anestésico: '#be123c',
  anestesico: '#be123c',
  medicamento: '#14b8a6',
  limpeza: '#06b6d4',
  cosmético: '#10b981',
  cosmetico: '#10b981',
  intradermoterapia: '#86efac',
  perfurocortante: '#f87171',
  higiene: '#8b5cf6',
  recepção: '#c026d3',
  recepcao: '#c026d3',
}

const CATEGORIA_PALETA = ['#60a5fa', '#a78bfa', '#34d399', '#f87171', '#fbbf24', '#22d3ee', '#fb7185', '#c084fc', '#4ade80', '#f472b6']
const MARCA_PALETA = ['#0891b2', '#2563eb', '#7c3aed', '#db2777', '#16a34a', '#ea580c', '#475569', '#be123c']

function hashToIndex(value: string, mod: number) {
  let h = 0
  for (let i = 0; i < value.length; i++) {
    h = (h * 31 + value.charCodeAt(i)) >>> 0
  }
  return mod > 0 ? h % mod : 0
}

export function getCategoriaBgColor(categoria?: string | null) {
  const key = String(categoria || '').trim().toLowerCase()
  const mapped = CATEGORIA_CORES[key]
  if (mapped) return mapped
  if (!key) return '#0ea5e9'
  return CATEGORIA_PALETA[hashToIndex(key, CATEGORIA_PALETA.length)] || '#0ea5e9'
}

export function getMarcaBgColor(marca?: string | null) {
  const key = String(marca || '').trim().toLowerCase()
  if (!key) return '#334155'
  return MARCA_PALETA[hashToIndex(key, MARCA_PALETA.length)] || '#334155'
}

export function getContrastColor(hexColor?: string | null) {
  const raw = String(hexColor || '').trim()
  const hex = raw.startsWith('#') ? raw.slice(1) : raw
  if (!/^[0-9a-fA-F]{6}$/.test(hex)) return '#ffffff'
  const r = parseInt(hex.slice(0, 2), 16)
  const g = parseInt(hex.slice(2, 4), 16)
  const b = parseInt(hex.slice(4, 6), 16)
  const luminance = 0.2126 * r + 0.7152 * g + 0.0722 * b
  return luminance > 140 ? '#0f172a' : '#ffffff'
}

export function buildTagStyle(bgColor?: string | null): React.CSSProperties {
  const bg = String(bgColor || '').trim() || '#334155'
  return {
    backgroundColor: bg,
    color: getContrastColor(bg),
    borderColor: 'rgba(255,255,255,0.25)',
  }
}

export function normalizeText(value?: string | null) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
}

export function buildInsumoDescriptor(item?: Insumo | null) {
  if (!item) return []
  const produto = String(item.produto || '').trim()
  const produtoKey = normalizeText(produto)
  const rawParts = [item.especificacao, item.concentracao, item.volume, item.calibre, item.tipoUnidade]
  const out: string[] = []
  const seen = new Set<string>()
  const escapeRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  for (const raw of rawParts) {
    let v = String(raw || '').trim()
    if (!v) continue
    if (produtoKey) {
      const vNorm = normalizeText(v)
      if (vNorm.includes(produtoKey)) {
        const prodRegex = new RegExp(escapeRegExp(produto), 'ig')
        v = v.replace(prodRegex, '').trim()
      }
    }
    const key = normalizeText(v)
    if (!key || seen.has(key)) continue
    seen.add(key)
    out.push(v)
    if (out.length >= 3) break
  }
  return out
}

export function formatInsumoDescriptor(item?: Insumo | null) {
  const parts = buildInsumoDescriptor(item)
  if (!parts.length) return ''
  return parts.slice(0, 3).join(' • ')
}

export function useViewportSize() {
  const [size, setSize] = React.useState({ width: 0, height: 0 })
  React.useEffect(() => {
    const update = () => setSize({ width: window.innerWidth, height: window.innerHeight })
    update()
    window.addEventListener('resize', update)
    return () => window.removeEventListener('resize', update)
  }, [])
  return size
}

export function slugifyCategoria(value?: string | null) {
  const s0 = String(value || '').trim().toLowerCase()
  if (!s0) return ''
  return s0
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

export function uniqueSortedTextOptions(values: Array<string | null | undefined>) {
  const out: string[] = []
  const seen = new Set<string>()
  for (const raw of values || []) {
    const value = String(raw || '').trim()
    if (!value) continue
    const key = normalizeText(value)
    if (!key || seen.has(key)) continue
    seen.add(key)
    out.push(value)
  }
  return out.sort((a, b) => a.localeCompare(b, 'pt-BR', { sensitivity: 'base' }))
}

export type EstoqueStatus = 'OK' | 'ATENCAO' | 'URGENTE'

export function calcularStatusEstoque(estoqueAtual?: number, estoqueMinimo?: number): EstoqueStatus {
  const atual = Number(estoqueAtual) || 0
  const minimo = Number(estoqueMinimo) || 0
  if (atual < 0) return 'URGENTE'
  if (minimo <= 0) return 'OK'
  if (atual < minimo) return 'URGENTE'
  if (atual === minimo) return 'ATENCAO'
  return 'OK'
}

export function estoqueStatusLabel(status: EstoqueStatus) {
  if (status === 'URGENTE') return 'Crítico'
  if (status === 'ATENCAO') return 'Atenção'
  return 'Ok'
}

export function estoqueStatusBadgeVariant(status: EstoqueStatus): 'default' | 'secondary' | 'destructive' {
  if (status === 'URGENTE') return 'destructive'
  if (status === 'ATENCAO') return 'secondary'
  return 'default'
}

export type AlertaStatusTag = 'URGENTE' | 'ATENCAO' | 'VENCENDO' | 'EXPIRADO' | 'INFO'

export function alertaTagLabel(tag: AlertaStatusTag) {
  if (tag === 'URGENTE') return 'Crítico'
  if (tag === 'ATENCAO') return 'Atenção'
  if (tag === 'VENCENDO') return 'Vencendo'
  if (tag === 'INFO') return 'Info'
  return 'Expirado'
}

export function alertaTagVariant(tag: AlertaStatusTag): 'default' | 'secondary' | 'destructive' {
  if (tag === 'URGENTE') return 'destructive'
  if (tag === 'EXPIRADO') return 'destructive'
  if (tag === 'VENCENDO') return 'secondary'
  if (tag === 'ATENCAO') return 'secondary'
  return 'default'
}

export function normalizeAlertTags(tags: Set<AlertaStatusTag>): AlertaStatusTag[] {
  const out = new Set(tags)
  if (out.has('URGENTE')) out.delete('ATENCAO')
  if (out.has('EXPIRADO')) out.delete('VENCENDO')
  const order: Record<AlertaStatusTag, number> = { URGENTE: 0, EXPIRADO: 1, VENCENDO: 2, ATENCAO: 3, INFO: 4 }
  return Array.from(out).sort((a, b) => order[a] - order[b])
}

export function fmtDate(value?: string | null) {
  if (!value) return ''
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return String(value)
  return d.toLocaleString('pt-BR')
}

export function fmtMovDateShort(value?: string | null) {
  if (!value) return ''
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return String(value)
  return d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: '2-digit' })
}

export function fmtMovTimeShort(value?: string | null) {
  if (!value) return ''
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return ''
  return d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
}

export function fmtDayShort(isoDay?: string) {
  if (!isoDay) return ''
  const d = new Date(`${isoDay}T00:00:00.000Z`)
  if (Number.isNaN(d.getTime())) return String(isoDay)
  return d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' })
}

export function isoDayWeekStart(isoDay?: string) {
  const v = String(isoDay || '').trim()
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) return ''
  const d = new Date(`${v}T00:00:00.000Z`)
  if (Number.isNaN(d.getTime())) return ''
  const dow = d.getUTCDay()
  const diff = (dow + 6) % 7
  const start = new Date(d)
  start.setUTCDate(start.getUTCDate() - diff)
  return start.toISOString().slice(0, 10)
}

export function isoToBrDate(value?: string | null) {
  const v = String(value || '').trim()
  if (!v) return ''
  const m = v.match(/^(\d{4})-(\d{2})-(\d{2})/)
  if (!m) return v
  return `${m[3]}/${m[2]}/${m[1]}`
}

export function brToIsoDate(value?: string | null) {
  const v = String(value || '').trim()
  if (!v) return ''
  if (/^\d{4}-\d{2}-\d{2}$/.test(v)) return v

  const m = v.match(/^(\d{2})\/(\d{2})\/(\d{2}|\d{4})$/)
  if (!m) return ''
  const day = parseInt(m[1], 10)
  const month = parseInt(m[2], 10)
  const yearRaw = m[3]
  const year = yearRaw.length === 2 ? 2000 + parseInt(yearRaw, 10) : parseInt(yearRaw, 10)
  const d = new Date(Date.UTC(year, month - 1, day))
  if (d.getUTCFullYear() !== year || d.getUTCMonth() !== month - 1 || d.getUTCDate() !== day) return ''
  const yyyy = String(year).padStart(4, '0')
  const mm = String(month).padStart(2, '0')
  const dd = String(day).padStart(2, '0')
  return `${yyyy}-${mm}-${dd}`
}

export function dateInputToIso(value?: string | null) {
  const v = String(value || '').trim()
  if (!v) return ''
  if (/^\d{4}-\d{2}-\d{2}/.test(v)) return v.slice(0, 10)
  const iso = brToIsoDate(v)
  return iso || ''
}

export function fmtDateOnlyBR(value?: string | null) {
  const v = String(value || '').trim()
  if (!v) return ''
  if (/^\d{2}\/\d{2}\/\d{4}$/.test(v)) return v
  const iso = dateInputToIso(v)
  return iso ? isoToBrDate(iso) : v
}

export function isoToLocalDateInput(value?: string | null) {
  if (!value) return ''
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return ''
  const year = d.getFullYear()
  const month = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

export function isoToLocalTimeInput(value?: string | null) {
  if (!value) return ''
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return ''
  const hours = String(d.getHours()).padStart(2, '0')
  const minutes = String(d.getMinutes()).padStart(2, '0')
  return `${hours}:${minutes}`
}

export function normalizeTimeInput(value?: string | null) {
  const raw = String(value || '').trim()
  const match = raw.match(/^(\d{2}):(\d{2})$/)
  if (!match) return ''
  const hour = Number(match[1])
  const minute = Number(match[2])
  if (!Number.isInteger(hour) || !Number.isInteger(minute) || hour < 0 || hour > 23 || minute < 0 || minute > 59) return ''
  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`
}

export function combineLocalDateTimeToIso(dateValue?: string | null, timeValue?: string | null) {
  const isoDate = dateInputToIso(dateValue)
  const isoTime = normalizeTimeInput(timeValue)
  if (!isoDate || !isoTime) return ''
  const d = new Date(`${isoDate}T${isoTime}:00`)
  if (Number.isNaN(d.getTime())) return ''
  return d.toISOString()
}

export function normalizeMovimentacaoTipo(value?: string | null) {
  return String(value || '').toUpperCase().replace('Í', 'I')
}

export function extractTransferMovementNote(value?: string | null) {
  const raw = String(value || '').trim()
  if (!raw) return ''
  const sep = raw.indexOf(' | ')
  return sep >= 0 ? raw.slice(sep + 3).trim() : ''
}

export function statusBadgeVariant(status?: string): 'default' | 'secondary' | 'destructive' {
  const s = String(status || '').toUpperCase()
  if (s === 'EXPIRADO') return 'destructive'
  if (s === 'VENCENDO') return 'secondary'
  return 'default'
}

export function severityBadgeVariant(severity?: string): 'default' | 'secondary' | 'destructive' {
  const s = String(severity || '').toUpperCase()
  if (s === 'CRITICAL') return 'destructive'
  if (s === 'WARN' || s === 'WARNING') return 'secondary'
  return 'default'
}

export function severityLabel(severity?: string) {
  const key = normalizeText(severity).toUpperCase()
  if (!key) return 'Info'
  if (key === 'CRITICAL' || key === 'CRITICO') return 'Crítico'
  if (key === 'WARN' || key === 'WARNING' || key === 'ATENCAO') return 'Atenção'
  if (key === 'INFO') return 'Info'
  const raw = String(severity || '').trim()
  if (!raw) return 'Info'
  return raw.charAt(0).toUpperCase() + raw.slice(1).toLowerCase()
}
