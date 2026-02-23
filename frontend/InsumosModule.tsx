import React from 'react'
import { toast } from 'sonner'
import { DragDropContext, Draggable, Droppable, type DropResult } from '@hello-pangea/dnd'
import { Badge } from '@/badge'
import { Button } from '@/button'
import { BrDatePickerInput } from '@/br-date-picker'
import { AutocompleteInput } from '@/autocomplete-input'
import { Card, CardContent, CardHeader, CardTitle } from '@/card'
import { Checkbox } from '@/checkbox'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/dialog'
import { Input } from '@/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/select'
import { Textarea } from '@/textarea'
import { Bar, BarChart, CartesianGrid, Cell, Legend, Line, LineChart, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'

type InsumosHealth = {
  ok?: boolean
  ready?: boolean
  service?: string
  runtime?: string
  storage?: string
  dbConfigured?: boolean
  unidades?: string[]
}

type InsumosUser = {
  username?: string
  displayName?: string
  name?: string
  email?: string
  role?: string
  photoUrl?: string
  allowedUnits?: string[]
}

type Insumo = {
  registro?: string
  codigoBarras?: string
  codigosBarras?: string[]
  categoria?: string
  marca?: string
  produto?: string
  especificacao?: string
  concentracao?: string
  volume?: string
  tipoUnidade?: string
  fonte?: string
  calibre?: string
  policyRequiresLot?: boolean | null
  policyRequiresExpiry?: boolean | null
  policyFefo?: boolean | null
  lote?: string
  precoCusto?: number
  estoqueAtual?: number
  estoqueMinimo?: number
  dataValidade?: string | null
  statusValidade?: { status?: string; dias?: number | null }
  estoques?: Record<string, number>
}

type Movimentacao = {
  dataHora?: string
  tipo?: string
  codigoBarras?: string
  produto?: string
  categoria?: string
  marca?: string
  quantidade?: number
  estoqueAnterior?: number
  estoqueNovo?: number
  preco?: number
  unidade?: string
  unidadeOrigem?: string
  unidadeDestino?: string
  transferId?: string
  usuario?: string
  motivo?: string
  registroInsumo?: string
  lote?: string
  dataValidade?: string
  observacoes?: string
}

type NotificationsSummary = {
  generatedAt?: string
  unidade?: string
  counts?: { lowStock?: number; expiringSoon?: number; expiredWithStock?: number }
  lowStock?: Array<{ codigoBarras?: string; produto?: string; estoqueAtual?: number; estoqueMinimo?: number; categoria?: string }>
  expiringSoon?: Array<{ codigoBarras?: string; produto?: string; estoqueAtual?: number; dataValidade?: string; dias?: number; categoria?: string }>
  expiredWithStock?: Array<{ codigoBarras?: string; produto?: string; estoqueAtual?: number; dataValidade?: string; categoria?: string }>
}

type EstoqueResumo = {
  totalInsumos?: number
  valorEstoqueTotal?: number
  criticos?: number
}

type Actionables = {
  unidade?: string
  reposicao?: Array<{ codigoBarras?: string; produto?: string; categoria?: string; estoqueAtual?: number; estoqueMinimo?: number; suggestedPurchaseQty?: number; estimatedValue?: number }>
  transferencias?: Array<{ codigoBarras?: string; produto?: string; categoria?: string; from?: string; to?: string; qty?: number; estimatedValue?: number }>
  perdasValidade?: Array<{ codigoBarras?: string; produto?: string; categoria?: string; estoqueAtual?: number; dataValidade?: string; lossValue?: number }>
  rupturas?: Array<{ codigoBarras?: string; produto?: string; categoria?: string; estoqueMinimo?: number; estimatedImpact?: number }>
}

type EstoqueAlerta = {
  codigoBarras?: string
  produto?: string
  categoria?: string
  estoqueAtual?: number
  estoqueMinimo?: number
  diferenca?: number
  percentual?: number | null
  tipoAlerta?: string
  statusAlerta?: 'URGENTE' | 'ATENCAO' | string
}

type RoiInsights = {
  unidade?: string
  perdas?: {
    valorExpirado?: number
    valorRiscoVencendo?: number
    itensExpirados?: number
    itensVencendo?: number
  }
  ruptura?: { itensRuptura?: number }
  produtividade?: { entrada?: number | null; baixa?: number | null }
}

type QualityIssue = {
  severity?: 'CRITICAL' | 'WARN' | 'INFO' | string
  code?: string
  message?: string
  registro?: string
  codigoBarras?: string
  produto?: string
  unidade?: string
  suggestion?: string
}

type QualityReport = {
  generatedAt?: string
  unidade?: string
  summary?: { total?: number; bySeverity?: Record<string, number> }
  issues?: QualityIssue[]
}

type OverviewBundleData = {
  resumo?: EstoqueResumo | null
  itens?: Insumo[] | null
  notifications?: NotificationsSummary | null
  actionables?: Actionables | null
  roi?: RoiInsights | null
  quality?: QualityReport | null
  movResumo?: {
    entradaQtd?: number
    saidaQtd?: number
    entradaValor?: number
    saidaValor?: number
    saldoLiquido?: number
  } | null
  movSeries?: Array<{ day?: string; entrada?: number; saida?: number; entradaValor?: number; saidaValor?: number }>
}

type InsightsBundleData = {
  alertas?: EstoqueAlerta[] | null
  trends?: any
  turnover?: {
    saida?: any
    entrada?: any
  } | null
}

type InsumosProxyStatus = {
  ok?: boolean
  localDirect?: boolean
  target?: string
  isProductionTarget?: boolean
  localSafeMode?: boolean
  mutationsBlocked?: boolean
}

type ShareFile = {
  name: string
  size?: number
  contentType?: string
  url?: string
}

type SharePayload = {
  title?: string
  text?: string
  url?: string
  files?: ShareFile[]
}

type ShareHistoryItem = SharePayload & {
  id: string
  createdAt: string
}

type CategoryPolicy = {
  slug: string
  label?: string
  requiresLot?: boolean
  requiresExpiry?: boolean
  fefo?: boolean
  createdAt?: string | null
  updatedAt?: string | null
}

type CategoryPolicySuggestion = {
  slug: string
  label: string
}

type ApiError = {
  error?: string
  message?: string
  success?: boolean
  code?: string
  registros?: string[]
  candidates?: Array<{
    registro?: string
    lote?: string
    dataValidade?: string | null
    estoque?: number
    categoria?: string
  }>
}

type UserPrefs = {
  overviewPanelOrder?: string[]
  mainPanelOrder?: string[]
  detailsOpen?: Record<string, boolean>
}

type OfflineQueueItem = {
  id: string
  ts: number
  path: string
  method: string
  body?: unknown
}

const CANONICAL_TIPOS_UNIDADE = ['unidade', 'frasco', 'seringa', 'caixa', 'ampola', 'pacote', 'rolo'] as const
const CANONICAL_TIPOS_UNIDADE_SET = new Set<string>(CANONICAL_TIPOS_UNIDADE as readonly string[])

function normalizeTipoUnidadeToCanonical(raw: string): string {
  const normalized = String(raw || '')
    .trim()
    .toLowerCase()
    .replace(/\s*\(s\)\s*/g, '')
    .trim()
  if (!normalized) return ''
  if (normalized === 'flaconete') return 'frasco'
  return CANONICAL_TIPOS_UNIDADE_SET.has(normalized) ? normalized : ''
}

function parseBarcodeInput(value: string): string[] {
  return String(value || '')
    .split(/[\n,;]+/g)
    .map((v) => String(v || '').trim())
    .filter(Boolean);
}

function getInsumoBarcodes(item: Insumo | null | undefined): string[] {
  const codes = new Set<string>();
  const add = (v?: string) => {
    const value = String(v || '').trim();
    if (value) codes.add(value);
  };
  add(item?.codigoBarras);
  if (Array.isArray(item?.codigosBarras)) {
    for (const v of item?.codigosBarras || []) add(String(v || ''));
  }
  return Array.from(codes);
}

function fmtMoneyBRL(value: number) {
  try {
    return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(value)
  } catch {
    return `R$ ${value.toFixed(2)}`
  }
}

function fmtMoneyBRL0(value: number) {
  try {
    return new Intl.NumberFormat('pt-BR', {
      style: 'currency',
      currency: 'BRL',
      minimumFractionDigits: 0,
      maximumFractionDigits: 0
    }).format(value)
  } catch {
    return `R$ ${Math.round(value)}`
  }
}

function fmtMoneyBRLCompact(value: number) {
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
  recepcao: '#c026d3'
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

function getCategoriaBgColor(categoria?: string | null) {
  const key = String(categoria || '').trim().toLowerCase()
  const mapped = CATEGORIA_CORES[key]
  if (mapped) return mapped
  if (!key) return '#0ea5e9'
  return CATEGORIA_PALETA[hashToIndex(key, CATEGORIA_PALETA.length)] || '#0ea5e9'
}

function getMarcaBgColor(marca?: string | null) {
  const key = String(marca || '').trim().toLowerCase()
  if (!key) return '#334155'
  return MARCA_PALETA[hashToIndex(key, MARCA_PALETA.length)] || '#334155'
}

function getContrastColor(hexColor?: string | null) {
  const raw = String(hexColor || '').trim()
  const hex = raw.startsWith('#') ? raw.slice(1) : raw
  if (!/^[0-9a-fA-F]{6}$/.test(hex)) return '#ffffff'
  const r = parseInt(hex.slice(0, 2), 16)
  const g = parseInt(hex.slice(2, 4), 16)
  const b = parseInt(hex.slice(4, 6), 16)
  const luminance = 0.2126 * r + 0.7152 * g + 0.0722 * b
  return luminance > 140 ? '#0f172a' : '#ffffff'
}

function buildTagStyle(bgColor?: string | null): React.CSSProperties {
  const bg = String(bgColor || '').trim() || '#334155'
  return {
    backgroundColor: bg,
    color: getContrastColor(bg),
    borderColor: 'rgba(255,255,255,0.25)'
  }
}

function buildInsumoDescriptor(item?: Insumo | null) {
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

function formatInsumoDescriptor(item?: Insumo | null) {
  const parts = buildInsumoDescriptor(item)
  if (!parts.length) return ''
  return parts.slice(0, 3).join(' • ')
}

function useViewportSize() {
  const [size, setSize] = React.useState({ width: 0, height: 0 })
  React.useEffect(() => {
    const update = () => setSize({ width: window.innerWidth, height: window.innerHeight })
    update()
    window.addEventListener('resize', update)
    return () => window.removeEventListener('resize', update)
  }, [])
  return size
}
function slugifyCategoria(value?: string | null) {
  const s0 = String(value || '').trim().toLowerCase()
  if (!s0) return ''
  return s0
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

function normalizeText(value?: string | null) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
}

function uniqueSortedTextOptions(values: Array<string | null | undefined>) {
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

type EstoqueStatus = 'OK' | 'ATENCAO' | 'URGENTE'

function calcularStatusEstoque(estoqueAtual?: number, estoqueMinimo?: number): EstoqueStatus {
  const atual = Number(estoqueAtual) || 0
  const minimo = Number(estoqueMinimo) || 0
  if (atual < 0) return 'URGENTE'
  if (minimo <= 0) return 'OK'
  // "Critico" means strictly below the configured minimum.
  if (atual < minimo) return 'URGENTE'
  // "Atencao" is only at the limit (not below it).
  if (atual === minimo) return 'ATENCAO'
  return 'OK'
}

function estoqueStatusLabel(status: EstoqueStatus) {
  if (status === 'URGENTE') return 'Crítico'
  if (status === 'ATENCAO') return 'Atenção'
  return 'Ok'
}

function estoqueStatusBadgeVariant(status: EstoqueStatus): 'default' | 'secondary' | 'destructive' {
  if (status === 'URGENTE') return 'destructive'
  if (status === 'ATENCAO') return 'secondary'
  return 'default'
}

type AlertaStatusTag = 'URGENTE' | 'ATENCAO' | 'VENCENDO' | 'EXPIRADO' | 'INFO'

function alertaTagLabel(tag: AlertaStatusTag) {
  if (tag === 'URGENTE') return 'Crítico'
  if (tag === 'ATENCAO') return 'Atenção'
  if (tag === 'VENCENDO') return 'Vencendo'
  if (tag === 'INFO') return 'Info'
  return 'Expirado'
}

function alertaTagVariant(tag: AlertaStatusTag): 'default' | 'secondary' | 'destructive' {
  if (tag === 'URGENTE') return 'destructive'
  if (tag === 'EXPIRADO') return 'destructive'
  if (tag === 'VENCENDO') return 'secondary'
  if (tag === 'ATENCAO') return 'secondary'
  return 'default'
}

function normalizeAlertTags(tags: Set<AlertaStatusTag>): AlertaStatusTag[] {
  const out = new Set(tags)
  if (out.has('URGENTE')) out.delete('ATENCAO')
  if (out.has('EXPIRADO')) out.delete('VENCENDO')
  const order: Record<AlertaStatusTag, number> = { URGENTE: 0, EXPIRADO: 1, VENCENDO: 2, ATENCAO: 3, INFO: 4 }
  return Array.from(out).sort((a, b) => order[a] - order[b])
}

function fmtDate(value?: string | null) {
  if (!value) return ''
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return String(value)
  return d.toLocaleString('pt-BR')
}

function fmtMovDateShort(value?: string | null) {
  if (!value) return ''
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return String(value)
  return d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: '2-digit' })
}

function fmtMovTimeShort(value?: string | null) {
  if (!value) return ''
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return ''
  return d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
}

function fmtDayShort(isoDay?: string) {
  if (!isoDay) return ''
  const d = new Date(`${isoDay}T00:00:00.000Z`)
  if (Number.isNaN(d.getTime())) return String(isoDay)
  return d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' })
}

function isoDayWeekStart(isoDay?: string) {
  const v = String(isoDay || '').trim()
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) return ''
  const d = new Date(`${v}T00:00:00.000Z`)
  if (Number.isNaN(d.getTime())) return ''
  const dow = d.getUTCDay() // 0=Sun
  const diff = (dow + 6) % 7 // days since Monday
  const start = new Date(d)
  start.setUTCDate(start.getUTCDate() - diff)
  return start.toISOString().slice(0, 10)
}

function isoToBrDate(value?: string | null) {
  const v = String(value || '').trim()
  if (!v) return ''
  const m = v.match(/^(\d{4})-(\d{2})-(\d{2})/)
  if (!m) return v
  return `${m[3]}/${m[2]}/${m[1]}`
}

function brToIsoDate(value?: string | null) {
  const v = String(value || '').trim()
  if (!v) return ''
  if (/^\d{4}-\d{2}-\d{2}$/.test(v)) return v

  const m = v.match(/^(\d{2})\/(\d{2})\/(\d{2}|\d{4})$/)
  if (!m) return ''
  const day = parseInt(m[1], 10)
  const month = parseInt(m[2], 10)
  const yearRaw = m[3]
  const year =
    yearRaw.length === 2
      ? 2000 + parseInt(yearRaw, 10)
      : parseInt(yearRaw, 10)
  const d = new Date(Date.UTC(year, month - 1, day))
  if (d.getUTCFullYear() !== year || d.getUTCMonth() !== month - 1 || d.getUTCDate() !== day) return ''
  const yyyy = String(year).padStart(4, '0')
  const mm = String(month).padStart(2, '0')
  const dd = String(day).padStart(2, '0')
  return `${yyyy}-${mm}-${dd}`
}

function dateInputToIso(value?: string | null) {
  const v = String(value || '').trim()
  if (!v) return ''
  if (/^\d{4}-\d{2}-\d{2}/.test(v)) return v.slice(0, 10)
  const iso = brToIsoDate(v)
  return iso || ''
}

function fmtDateOnlyBR(value?: string | null) {
  const v = String(value || '').trim()
  if (!v) return ''
  if (/^\d{2}\/\d{2}\/\d{4}$/.test(v)) return v
  const iso = dateInputToIso(v)
  return iso ? isoToBrDate(iso) : v
}

function statusBadgeVariant(status?: string): 'default' | 'secondary' | 'destructive' {
  const s = String(status || '').toUpperCase()
  if (s === 'EXPIRADO') return 'destructive'
  if (s === 'VENCENDO') return 'secondary'
  return 'default'
}

function severityBadgeVariant(severity?: string): 'default' | 'secondary' | 'destructive' {
  const s = String(severity || '').toUpperCase()
  if (s === 'CRITICAL') return 'destructive'
  if (s === 'WARN' || s === 'WARNING') return 'secondary'
  return 'default'
}

function severityLabel(severity?: string) {
  const key = normalizeText(severity).toUpperCase()
  if (!key) return 'Info'
  if (key === 'CRITICAL' || key === 'CRITICO') return 'Crítico'
  if (key === 'WARN' || key === 'WARNING' || key === 'ATENCAO') return 'Atenção'
  if (key === 'INFO') return 'Info'
  const raw = String(severity || '').trim()
  if (!raw) return 'Info'
  return raw.charAt(0).toUpperCase() + raw.slice(1).toLowerCase()
}

function BarcodeScannerInline({
  onDetected,
  onClose
}: {
  onDetected: (code: string) => void
  onClose: () => void
}) {
  const videoRef = React.useRef<HTMLVideoElement | null>(null)
  const rafRef = React.useRef<number | null>(null)
  const streamRef = React.useRef<MediaStream | null>(null)
  const zxingReaderRef = React.useRef<any>(null)
  const zxingControlsRef = React.useRef<any>(null)
  const runTokenRef = React.useRef(0)
  const mountedRef = React.useRef(true)
  const [error, setError] = React.useState<string | null>(null)
  const [supported, setSupported] = React.useState(true)
  const [starting, setStarting] = React.useState(false)
  const [running, setRunning] = React.useState(false)
  const [needsGesture, setNeedsGesture] = React.useState(false)
  const [mode, setMode] = React.useState<'BARCODE_DETECTOR' | 'ZXING' | 'NONE'>('BARCODE_DETECTOR')
  const [facingMode, setFacingMode] = React.useState<'user' | 'environment'>('environment')
  const [activeFacingMode, setActiveFacingMode] = React.useState<'user' | 'environment' | null>(null)

  const stop = React.useCallback(() => {
    runTokenRef.current += 1
    if (rafRef.current != null) cancelAnimationFrame(rafRef.current)
    rafRef.current = null
    try {
      zxingControlsRef.current?.stop?.()
    } catch {
      // ignore
    }
    zxingControlsRef.current = null
    try {
      zxingReaderRef.current?.reset?.()
    } catch {
      // ignore
    }
    zxingReaderRef.current = null
    if (streamRef.current) {
      for (const t of streamRef.current.getTracks()) t.stop()
    }
    streamRef.current = null
    if (mountedRef.current) {
      setRunning(false)
      setStarting(false)
      setActiveFacingMode(null)
    }
  }, [])

  const start = React.useCallback(async (origin: 'auto' | 'gesture', preferredFacing?: 'user' | 'environment') => {
    stop()
    setError(null)
    setNeedsGesture(false)
    setStarting(true)
    setSupported(true)

    if (!navigator?.mediaDevices?.getUserMedia) {
      setSupported(false)
      setMode('NONE')
      if (mountedRef.current) setStarting(false)
      return
    }

    const token = runTokenRef.current
    const targetFacingMode = preferredFacing || facingMode
    const facingAttempts: Array<'user' | 'environment'> =
      targetFacingMode === 'user' ? ['user', 'environment'] : ['environment', 'user']

    const getStreamWithFallback = async () => {
      let lastError: any = null
      for (const currentFacingMode of facingAttempts) {
        try {
          const stream = await navigator.mediaDevices.getUserMedia({
            video: { facingMode: { ideal: currentFacingMode } as any },
            audio: false
          })
          return { stream, currentFacingMode }
        } catch (e: any) {
          lastError = e
          const name = String(e?.name || '')
          if (name === 'NotAllowedError' || name === 'SecurityError') break
        }
      }
      throw lastError || new Error('Não foi possível abrir a câmera.')
    }

    const tickBarcodeDetector = async (detector: any, tickToken: number) => {
      if (tickToken !== runTokenRef.current) return
      const video = videoRef.current
      if (!video) return
      try {
        const results = await detector.detect(video)
        const raw = results?.[0]?.rawValue ? String(results[0].rawValue) : ''
        if (raw) {
          stop()
          onDetected(raw)
          return
        }
      } catch {
        // ignore detection errors and keep trying
      }
      rafRef.current = requestAnimationFrame(() => { void tickBarcodeDetector(detector, tickToken) })
    }

    const Detector = (globalThis as any).BarcodeDetector
    try {
      if (Detector) {
        setMode('BARCODE_DETECTOR')
        const detector = new Detector({
          formats: ['ean_13', 'ean_8', 'code_128', 'code_39', 'qr_code', 'upc_a', 'upc_e']
        })
        const { stream, currentFacingMode } = await getStreamWithFallback()
        if (token !== runTokenRef.current) {
          for (const t of stream.getTracks()) t.stop()
          return
        }
        streamRef.current = stream
        const video = videoRef.current
        if (!video) throw new Error('Pré-visualização indisponível.')
        video.srcObject = stream
        await video.play()
        if (token !== runTokenRef.current) return
        setRunning(true)
        setActiveFacingMode(currentFacingMode)
        rafRef.current = requestAnimationFrame(() => { void tickBarcodeDetector(detector, token) })
        return
      }

      setMode('ZXING')
      const mod: any = await import('@zxing/browser')
      const Reader = mod?.BrowserMultiFormatReader
      if (!Reader) throw new Error('Scanner indisponível.')
      const reader = new Reader()
      zxingReaderRef.current = reader

      const video = videoRef.current
      if (!video) throw new Error('Pré-visualização indisponível.')

      let controls: any = null
      let usedFacingMode: 'user' | 'environment' | null = null
      let lastDecodeError: any = null
      for (const currentFacingMode of facingAttempts) {
        try {
          controls = await reader.decodeFromConstraints(
            { video: { facingMode: { ideal: currentFacingMode } } } as any,
            video,
            (result: any) => {
              if (token !== runTokenRef.current) return
              const raw = result?.getText ? String(result.getText() || '') : ''
              if (!raw) return
              stop()
              onDetected(raw)
            }
          )
          usedFacingMode = currentFacingMode
          break
        } catch (e: any) {
          lastDecodeError = e
          const name = String(e?.name || '')
          if (name === 'NotAllowedError' || name === 'SecurityError') break
        }
      }
      if (!controls) {
        throw lastDecodeError || new Error('Não foi possível iniciar o scanner de câmera.')
      }
      if (!usedFacingMode) {
        usedFacingMode = targetFacingMode
      }
      if (token !== runTokenRef.current) {
        try {
          controls?.stop?.()
        } catch {
          // ignore
        }
        return
      }
      zxingControlsRef.current = controls
      setRunning(true)
      setActiveFacingMode(usedFacingMode)
    } catch (e: any) {
      const name = String(e?.name || '')
      const message = String(e?.message || '')

      // Safari/iOS: algumas versões exigem gesto explícito para pedir permissão de câmera.
      if (origin === 'auto' && (name === 'NotAllowedError' || name === 'SecurityError')) {
        setNeedsGesture(true)
      }

      if (name === 'NotFoundError') {
        setSupported(false)
        setMode('NONE')
        setError('Nenhuma câmera foi encontrada neste dispositivo.')
      } else if (!location?.protocol?.startsWith('https') && location?.hostname !== 'localhost') {
        setSupported(false)
        setMode('NONE')
        setError('O scanner precisa de HTTPS para acessar a câmera.')
      } else {
        setError(message || 'Não foi possível iniciar o scanner. Verifique a permissão de câmera no navegador.')
      }
    } finally {
      if (mountedRef.current && token === runTokenRef.current) setStarting(false)
    }
  }, [facingMode, onDetected, stop])

  React.useEffect(() => {
    void start('auto')
    return () => {
      mountedRef.current = false
      stop()
    }
  }, [start, stop])

  if (!supported) {
    return (
      <div className="rounded-xl border border-white/10 bg-black/20 p-3 space-y-2">
        <div className="flex items-center justify-between gap-2">
          <div className="text-sm text-blue-50 font-semibold">Scanner indisponível</div>
          <Button variant="secondary" onClick={onClose}>Fechar</Button>
        </div>
        <div className="text-sm text-blue-100/70">
          Este navegador não suporta leitura automática de códigos. Digite o código manualmente ou use Chrome/Edge.
        </div>
      </div>
    )
  }

  return (
    <div className="rounded-xl border border-white/10 bg-black/20 p-3 space-y-2">
      <div className="flex items-center justify-between gap-2">
        <div className="text-sm text-blue-100/80">
          {mode === 'ZXING' ? 'Scanner (compatível)' : 'Scanner (rápido)'} • {activeFacingMode === 'user' ? 'câmera frontal' : 'câmera traseira'}
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            type="button"
            onClick={() => {
              const next = facingMode === 'user' ? 'environment' : 'user'
              setFacingMode(next)
              void start('gesture', next)
            }}
            disabled={starting}
          >
            Inverter câmera
          </Button>
          {!running ? (
            <Button
              variant="outline"
              onClick={() => void start('gesture')}
              disabled={starting}
              title={needsGesture ? 'Clique para solicitar permissão de câmera' : 'Tentar novamente'}
            >
              {starting ? 'Iniciando…' : (needsGesture ? 'Ativar câmera' : 'Tentar novamente')}
            </Button>
          ) : null}
          <Button variant="secondary" onClick={() => { stop(); onClose() }}>Fechar</Button>
        </div>
      </div>
      {error ? <div className="text-sm text-red-200">{error}</div> : null}
      <div className="relative w-full max-w-xl">
        <video
          ref={videoRef}
          className="w-full rounded-lg border border-white/10 bg-black"
          style={{ transform: activeFacingMode === 'user' ? 'scaleX(-1)' : 'none' }}
          playsInline
          muted
        />
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
          <div className="relative h-[28%] w-[78%] rounded-xl border-2 border-emerald-300/90 shadow-[0_0_0_9999px_rgba(0,0,0,0.24)]">
            <div className="absolute -top-2 -left-2 h-6 w-6 border-l-2 border-t-2 border-white/90 rounded-tl-md" />
            <div className="absolute -top-2 -right-2 h-6 w-6 border-r-2 border-t-2 border-white/90 rounded-tr-md" />
            <div className="absolute -bottom-2 -left-2 h-6 w-6 border-l-2 border-b-2 border-white/90 rounded-bl-md" />
            <div className="absolute -bottom-2 -right-2 h-6 w-6 border-r-2 border-b-2 border-white/90 rounded-br-md" />
          </div>
        </div>
      </div>
      <div className="text-xs text-blue-200/60">
        Posicione o código dentro da moldura verde. Se não detectar, aumente a luz e aproxime o produto.
      </div>
    </div>
  )
}

async function apiJson<T>(
  path: string,
  opts: {
    method?: string
    body?: unknown
    csrfToken?: string | null
    idempotencyKey?: string | null
    signal?: AbortSignal
    retryOnCsrf?: () => Promise<string | null>
  } = {}
): Promise<T> {
  const method = String(opts.method || 'GET').toUpperCase()
  const headers: Record<string, string> = { Accept: 'application/json' }
  if (opts.body !== undefined) headers['content-type'] = 'application/json'
  if (opts.csrfToken) headers['x-csrf-token'] = opts.csrfToken
  if (opts.idempotencyKey) headers['idempotency-key'] = opts.idempotencyKey

  const url = path.startsWith('/api/insumos') ? path : `/api/insumos${path.startsWith('/') ? '' : '/'}${path}`

  // Prevent browser "network storms" by:
  // - limiting concurrent in-flight requests (Overview/Insights fan-out is heavy)
  // - coalescing identical GETs (best-effort) to avoid duplicate loads on mount/refresh
  const MAX_CONCURRENCY = 4
  ;(globalThis as any).__insumosApiGate ??= { active: 0, queue: [] as Array<() => void>, inflight: new Map<string, Promise<any>>() }
  const gate = (globalThis as any).__insumosApiGate as {
    active: number
    queue: Array<() => void>
    inflight: Map<string, Promise<any>>
  }

  const withSlot = async <R,>(fn: () => Promise<R>): Promise<R> => {
    if (gate.active >= MAX_CONCURRENCY) await new Promise<void>((resolve) => gate.queue.push(resolve))
    gate.active++
    try {
      return await fn()
    } finally {
      gate.active = Math.max(0, gate.active - 1)
      const next = gate.queue.shift()
      if (next) next()
    }
  }

  const doFetch = () =>
    withSlot(async () => {
      const res = await fetch(url, {
        method,
        headers,
        credentials: 'include',
        body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
        signal: opts.signal
      })

      const requestId = res.headers.get('x-request-id') || res.headers.get('X-Request-Id')

      const text = await res.text()
      let json: unknown = null
      try {
        json = text ? JSON.parse(text) : null
      } catch {
        json = null
      }

      if (res.ok) return json as T

      const err = (json || {}) as ApiError
      const message = err.error || err.message || `HTTP ${res.status}`

      if (res.status === 403 && String(err.code || '').toUpperCase() === 'CSRF_INVALID' && opts.retryOnCsrf) {
        const nextCsrf = await opts.retryOnCsrf()
        if (nextCsrf) {
          return apiJson<T>(path, { ...opts, csrfToken: nextCsrf, retryOnCsrf: undefined })
        }
      }

      const ex = new Error(requestId ? `${message} • req ${requestId}` : message) as any
      ex.status = res.status
      ex.code = err.code
      ex.requestId = requestId || null
      ex.registros = Array.isArray(err.registros) ? err.registros : []
      ex.candidates = Array.isArray((err as any).candidates) ? (err as any).candidates : []
      throw ex
    })

  const shouldDedupe = method === 'GET' && !opts.signal
  if (!shouldDedupe) return doFetch()

  const key = `${method} ${url}`
  const existing = gate.inflight.get(key)
  if (existing) return existing as Promise<T>

  const p = doFetch().finally(() => {
    try {
      gate.inflight.delete(key)
    } catch {
      // ignore
    }
  })
  gate.inflight.set(key, p)
  return p
}

export function InsumosModule() {
  const rootRef = React.useRef<HTMLDivElement | null>(null)
  const { width: viewportWidth, height: viewportHeight } = useViewportSize()
  const [isCoarsePointer, setIsCoarsePointer] = React.useState(false)
  React.useEffect(() => {
    const media = window.matchMedia('(pointer: coarse)')
    const update = () => setIsCoarsePointer(!!media.matches)
    update()
    try {
      media.addEventListener('change', update)
      return () => media.removeEventListener('change', update)
    } catch {
      media.addListener(update)
      return () => media.removeListener(update)
    }
  }, [])
  const isPhoneViewport = viewportWidth > 0 && viewportWidth < 640
  const isCompactViewport = viewportWidth > 0 && viewportWidth < 1024
  const isAdaptiveCompact = isPhoneViewport || (isCompactViewport && isCoarsePointer)
  const dialogMaxHeight = viewportHeight > 0 && viewportHeight < 720 ? 'max-h-[88vh]' : 'max-h-[92vh]'
  const dialogPaddingClass = isAdaptiveCompact ? 'p-3' : 'p-4 sm:p-5'
  const dialogBodyClass = `${dialogMaxHeight} min-w-0 overflow-auto`
  const dialogWideClass = `${dialogBodyClass} ${isAdaptiveCompact ? 'w-[calc(100vw-0.75rem)] max-w-[98vw]' : 'w-[calc(100vw-1.5rem)] max-w-[96vw] 2xl:max-w-[112rem]'} ${dialogPaddingClass}`
  const dialogLargeClass = `${dialogBodyClass} ${isAdaptiveCompact ? 'w-[calc(100vw-0.75rem)] max-w-[98vw]' : 'w-[calc(100vw-2rem)] max-w-[94vw] 2xl:max-w-[104rem]'} ${dialogPaddingClass}`
  const dialogMediumClass = `${dialogBodyClass} ${isAdaptiveCompact ? 'w-[calc(100vw-0.75rem)] max-w-[98vw]' : 'w-[calc(100vw-2rem)] max-w-[90vw] 2xl:max-w-[92rem]'} ${dialogPaddingClass}`
  const dialogSmallClass = `${dialogBodyClass} ${isAdaptiveCompact ? 'w-[calc(100vw-0.75rem)] max-w-[98vw]' : 'max-w-[42rem]'} ${dialogPaddingClass}`
  const [health, setHealth] = React.useState<InsumosHealth | null>(null)
  const [error, setError] = React.useState<string | null>(null)
  const [healthLoading, setHealthLoading] = React.useState(true)
  const [proxyStatus, setProxyStatus] = React.useState<InsumosProxyStatus | null>(null)

  const INSUMOS_UNIT_KEY = 'skincos.insumos.unidade.v1'
  const INSUMOS_OPTIONS_CACHE_KEY = 'skincos.insumos.options.v1'
  const [unidade, setUnidade] = React.useState<string>(() => {
    try {
      return window.localStorage.getItem(INSUMOS_UNIT_KEY) || 'novo-hamburgo'
    } catch {
      return 'novo-hamburgo'
    }
  })
  const [transferFrom, setTransferFrom] = React.useState<string>('novo-hamburgo')
  const [transferTo, setTransferTo] = React.useState<string>('barra-shopping-sul')
  const [csrfToken, setCsrfToken] = React.useState<string | null>(null)
  const [user, setUser] = React.useState<InsumosUser | null>(null)
  const [authLoading, setAuthLoading] = React.useState(true)
  const [healthLoaded, setHealthLoaded] = React.useState(false)
  const [authLoaded, setAuthLoaded] = React.useState(false)
  const [overviewLoaded, setOverviewLoaded] = React.useState(false)
  const [insumosLoaded, setInsumosLoaded] = React.useState(false)
  const [movLoaded, setMovLoaded] = React.useState(false)
  const [insightsLoaded, setInsightsLoaded] = React.useState(false)

  const [quickOp, setQuickOp] = React.useState<'ENTRADA' | 'BAIXA' | 'TRANSFERENCIA' | null>(null)
  const [quickCodigo, setQuickCodigo] = React.useState('')
  const [quickSearch, setQuickSearch] = React.useState('')
  const [quickRegistro, setQuickRegistro] = React.useState('')
  const [quickRegistros, setQuickRegistros] = React.useState<string[]>([])
  const [quickCandidates, setQuickCandidates] = React.useState<Array<{ registro: string; lote: string; dataValidade: string | null; estoque: number }>>([])
  const [quickAutoFefo, setQuickAutoFefo] = React.useState(true)
  const [quickScanOpen, setQuickScanOpen] = React.useState(false)
  const [quickQuantidade, setQuickQuantidade] = React.useState('1')
  const [quickNovoEstoque, setQuickNovoEstoque] = React.useState('')
  const [quickObs, setQuickObs] = React.useState('')
  const [quickMotivo, setQuickMotivo] = React.useState('Ajuste manual')
  const [quickActionLoading, setQuickActionLoading] = React.useState(false)
  const [quickActionFeedback, setQuickActionFeedback] = React.useState<{ type: 'success' | 'error'; message: string } | null>(null)
  const [quickLookupLoading, setQuickLookupLoading] = React.useState(false)
  const [quickLookupError, setQuickLookupError] = React.useState<string | null>(null)
  const [quickLookupCtxUnidade, setQuickLookupCtxUnidade] = React.useState<string | null>(null)
  const [quickLookupCode, setQuickLookupCode] = React.useState<string | null>(null)
  const [quickLookupItems, setQuickLookupItems] = React.useState<Insumo[]>([])
  const [quickSelectedSnapshot, setQuickSelectedSnapshot] = React.useState<Insumo | null>(null)
  const [quickSearchRemote, setQuickSearchRemote] = React.useState<Insumo[]>([])
  const [quickSearchRemoteLoading, setQuickSearchRemoteLoading] = React.useState(false)
  const [quickSearchRemoteError, setQuickSearchRemoteError] = React.useState<string | null>(null)
  const quickLookupTokenRef = React.useRef(0)
  const quickSearchRemoteTokenRef = React.useRef(0)
  const overviewSectionRef = React.useRef<HTMLDivElement | null>(null)
  const movSectionRef = React.useRef<HTMLDivElement | null>(null)
  const overviewAbortRef = React.useRef<AbortController | null>(null)
  const insightsAbortRef = React.useRef<AbortController | null>(null)
  const overviewFullAttemptRef = React.useRef<number>(0)
  const apiFailureTimestampsRef = React.useRef<number[]>([])
  const [autoSyncSuspendedUntil, setAutoSyncSuspendedUntil] = React.useState<number>(0)
  const [overviewVisible, setOverviewVisible] = React.useState(false)
  const [overviewEverVisible, setOverviewEverVisible] = React.useState(false)
  const [sharePayload, setSharePayload] = React.useState<SharePayload | null>(null)
  const [shareHidden, setShareHidden] = React.useState(false)
  const [shareSourceId, setShareSourceId] = React.useState<string | null>(null)
  const [shareHistory, setShareHistory] = React.useState<ShareHistoryItem[]>([])
  const [shareLoading, setShareLoading] = React.useState(false)
  const [shareHistoryLoading, setShareHistoryLoading] = React.useState(false)
  const shareLoggedRef = React.useRef<string>('')
  const shareSyncedRef = React.useRef<Set<string>>(new Set())

  const [categoryPolicies, setCategoryPolicies] = React.useState<CategoryPolicy[]>([])
  const [categoryPoliciesLoading, setCategoryPoliciesLoading] = React.useState(false)
  const [insumosOptionsCategorias, setInsumosOptionsCategorias] = React.useState<string[]>([])
  const [insumosOptionsMarcas, setInsumosOptionsMarcas] = React.useState<string[]>([])
  const readInsumosOptionsCache = React.useCallback(() => {
    try {
      const raw = localStorage.getItem(INSUMOS_OPTIONS_CACHE_KEY)
      if (!raw) return { categorias: [] as string[], marcas: [] as string[] }
      const parsed = JSON.parse(raw) as Record<string, { categorias?: string[]; marcas?: string[] }>
      const scoped = parsed?.[unidade]
      return {
        categorias: uniqueSortedTextOptions(scoped?.categorias || []),
        marcas: uniqueSortedTextOptions(scoped?.marcas || [])
      }
    } catch {
      return { categorias: [] as string[], marcas: [] as string[] }
    }
  }, [INSUMOS_OPTIONS_CACHE_KEY, unidade])
  const persistInsumosOptionsCache = React.useCallback(
    (categorias: string[], marcas: string[]) => {
      try {
        const raw = localStorage.getItem(INSUMOS_OPTIONS_CACHE_KEY)
        const current = raw ? (JSON.parse(raw) as Record<string, { categorias?: string[]; marcas?: string[] }>) : {}
        current[unidade] = {
          categorias: uniqueSortedTextOptions(categorias),
          marcas: uniqueSortedTextOptions(marcas)
        }
        localStorage.setItem(INSUMOS_OPTIONS_CACHE_KEY, JSON.stringify(current))
      } catch {
        // ignore
      }
    },
    [INSUMOS_OPTIONS_CACHE_KEY, unidade]
  )

  const [adminCategoryPolicies, setAdminCategoryPolicies] = React.useState<CategoryPolicy[]>([])
  const [adminCategorySuggestions, setAdminCategorySuggestions] = React.useState<CategoryPolicySuggestion[]>([])
  const [adminCategoryPoliciesLoading, setAdminCategoryPoliciesLoading] = React.useState(false)

  const [policyFormLabel, setPolicyFormLabel] = React.useState('')
  const [policyFormSlug, setPolicyFormSlug] = React.useState('')
  const [policyFormSlugTouched, setPolicyFormSlugTouched] = React.useState(false)
  const [policyFormRequiresLot, setPolicyFormRequiresLot] = React.useState(false)
  const [policyFormRequiresExpiry, setPolicyFormRequiresExpiry] = React.useState(false)
  const [policyFormFefo, setPolicyFormFefo] = React.useState(false)
  const [policyFormEditingSlug, setPolicyFormEditingSlug] = React.useState<string | null>(null)
  const [policyFormSuggestion, setPolicyFormSuggestion] = React.useState('__NONE__')

  const [insumos, setInsumos] = React.useState<Insumo[]>([])
  const [insumosLoading, setInsumosLoading] = React.useState(false)
  const [insumosLoadError, setInsumosLoadError] = React.useState<{ message: string; status: number; code?: string } | null>(null)
  const [insumosQuery, setInsumosQuery] = React.useState('')
  const [insumosPagina, setInsumosPagina] = React.useState(1)
  const [insumosLimite, setInsumosLimite] = React.useState(200)
  const [insumosTotal, setInsumosTotal] = React.useState<number | null>(null)
  const [insumosHasMore, setInsumosHasMore] = React.useState(false)
  const insumosRef = React.useRef<Insumo[]>([])
  const [selectedCodigoBarras, setSelectedCodigoBarras] = React.useState('')
  const [createOpen, setCreateOpen] = React.useState(false)
  const [createScanOpen, setCreateScanOpen] = React.useState(false)
  const [createCodigo, setCreateCodigo] = React.useState('')
  const [createCodigosExtras, setCreateCodigosExtras] = React.useState('')
  const [createProduto, setCreateProduto] = React.useState('')
  const [createCategoria, setCreateCategoria] = React.useState('')
  const [createPolicyTouched, setCreatePolicyTouched] = React.useState(false)
  const [createCategoriaRequiresLot, setCreateCategoriaRequiresLot] = React.useState(false)
  const [createCategoriaRequiresExpiry, setCreateCategoriaRequiresExpiry] = React.useState(false)
  const [createCategoriaFefo, setCreateCategoriaFefo] = React.useState(false)
  const [createMarca, setCreateMarca] = React.useState('')
  const [createTipoUnidade, setCreateTipoUnidade] = React.useState('')
  const [createEspecificacao, setCreateEspecificacao] = React.useState('')
  const [createConcentracao, setCreateConcentracao] = React.useState('')
  const [createVolume, setCreateVolume] = React.useState('')
  const [createHomologado, setCreateHomologado] = React.useState(false)
  const [createCalibre, setCreateCalibre] = React.useState('')
  const [createPrecoCusto, setCreatePrecoCusto] = React.useState('')
  const [createEstoqueInicial, setCreateEstoqueInicial] = React.useState('0')
  const [createEstoqueMinimo, setCreateEstoqueMinimo] = React.useState('5')
  const [createLote, setCreateLote] = React.useState('')
  const [createDataValidade, setCreateDataValidade] = React.useState('')
  const [createNovoLote, setCreateNovoLote] = React.useState(false)
  const [createLoading, setCreateLoading] = React.useState(false)
  const [createLookupLoading, setCreateLookupLoading] = React.useState(false)
  const [createLookupError, setCreateLookupError] = React.useState<string | null>(null)
  const [createLookupItems, setCreateLookupItems] = React.useState<Insumo[]>([])
  const createLookupTokenRef = React.useRef(0)

  const [editOpen, setEditOpen] = React.useState(false)
  const [editTarget, setEditTarget] = React.useState<Insumo | null>(null)
  const [editCodigo, setEditCodigo] = React.useState('')
  const [editCodigosExtras, setEditCodigosExtras] = React.useState('')
  const [editProduto, setEditProduto] = React.useState('')
  const [editCategoria, setEditCategoria] = React.useState('')
  const [editCategoriaRequiresLot, setEditCategoriaRequiresLot] = React.useState(false)
  const [editCategoriaRequiresExpiry, setEditCategoriaRequiresExpiry] = React.useState(false)
  const [editCategoriaFefo, setEditCategoriaFefo] = React.useState(false)
  const [editMarca, setEditMarca] = React.useState('')
  const [editTipoUnidade, setEditTipoUnidade] = React.useState('')
  const [editEspecificacao, setEditEspecificacao] = React.useState('')
  const [editConcentracao, setEditConcentracao] = React.useState('')
  const [editVolume, setEditVolume] = React.useState('')
  const [editHomologado, setEditHomologado] = React.useState(false)
  const [editCalibre, setEditCalibre] = React.useState('')
  const [editPrecoCusto, setEditPrecoCusto] = React.useState('')
  const [editEstoqueMinimo, setEditEstoqueMinimo] = React.useState('')
  const [editLote, setEditLote] = React.useState('')
  const [editDataValidade, setEditDataValidade] = React.useState('')
  const [editSaving, setEditSaving] = React.useState(false)
  type EditValidationKey =
    | 'codigoBarras'
    | 'produto'
    | 'categoria'
    | 'marca'
    | 'tipoUnidade'
    | 'lote'
    | 'dataValidade'
    | 'policy'
  type EditValidationErrors = Partial<Record<EditValidationKey, string>>
  const [editValidationErrors, setEditValidationErrors] = React.useState<EditValidationErrors>({})
  const [editSaveError, setEditSaveError] = React.useState<string | null>(null)
  const clearEditValidationError = React.useCallback((key: EditValidationKey) => {
    setEditValidationErrors((prev) => {
      if (!prev[key]) return prev
      const next = { ...prev }
      delete next[key]
      return next
    })
    setEditSaveError((prev) => (prev ? null : prev))
  }, [])

  const [lotDialogOpen, setLotDialogOpen] = React.useState(false)
  const [lotSelecionado, setLotSelecionado] = React.useState<Insumo | null>(null)
  const [lotEditLote, setLotEditLote] = React.useState('')
  const [lotEditValidade, setLotEditValidade] = React.useState('')
  const [lotSaving, setLotSaving] = React.useState(false)

  const [movimentacoes, setMovimentacoes] = React.useState<Movimentacao[]>([])
  const [movLoading, setMovLoading] = React.useState(false)
  const [movLoadError, setMovLoadError] = React.useState<{ message: string; status: number; code?: string } | null>(null)
  const [movTipo, setMovTipo] = React.useState<'TODOS' | 'ENTRADA' | 'SAÍDA' | 'AJUSTE'>('TODOS')
  const movGroupTransfers = true
  const [movDe, setMovDe] = React.useState('')
  const [movAte, setMovAte] = React.useState('')
  const [movFilterProduto, setMovFilterProduto] = React.useState('')
  const [movFilterCategoria, setMovFilterCategoria] = React.useState('')
  const [movFilterMarca, setMovFilterMarca] = React.useState('')
  const [movSearch, setMovSearch] = React.useState('')
  const [movSortKey, setMovSortKey] = React.useState<
    'dataHora' | 'produto' | 'categoria' | 'marca' | 'estoque' | 'valor' | 'usuario' | 'observacao'
  >('dataHora')
  const [movSortDir, setMovSortDir] = React.useState<'asc' | 'desc'>('desc')
  const [movPagina, setMovPagina] = React.useState(1)
  const [movLimite, setMovLimite] = React.useState(50)
  const [movTotal, setMovTotal] = React.useState<number | null>(null)
  const [movHasMore, setMovHasMore] = React.useState(false)
  const movRef = React.useRef<Movimentacao[]>([])
  const movListContainerRef = React.useRef<HTMLDivElement | null>(null)

  // Backups/auditoria foram movidos para o módulo Status do sistema.

	  const [overviewLoading, setOverviewLoading] = React.useState(false)
	  const [overviewResumo, setOverviewResumo] = React.useState<EstoqueResumo | null>(null)
	  const [overviewInsumos, setOverviewInsumos] = React.useState<Insumo[] | null>(null)
	  const [overviewNotifications, setOverviewNotifications] = React.useState<NotificationsSummary | null>(null)
	  const [overviewActionables, setOverviewActionables] = React.useState<Actionables | null>(null)
	  const [purchaseDialogOpen, setPurchaseDialogOpen] = React.useState(false)
  const [overviewPeriod, setOverviewPeriod] = React.useState<'7d' | '30d' | '1y' | 'custom'>('30d')
  const [overviewCustomFrom, setOverviewCustomFrom] = React.useState<string>('')
  const [overviewCustomTo, setOverviewCustomTo] = React.useState<string>('')

  const overviewPeriodLabel = React.useMemo(() => {
    if (overviewPeriod === '7d') return 'Última semana'
    if (overviewPeriod === '30d') return 'Último mês'
    if (overviewPeriod === '1y') return 'Último ano'
    return 'Personalizado'
  }, [overviewPeriod])

  React.useEffect(() => {
    const now = new Date()
    const yyyyMmDd = (d: Date) => d.toISOString().slice(0, 10)
    if (overviewPeriod === 'custom') {
      const fromIso = dateInputToIso(overviewCustomFrom)
      const toIso = dateInputToIso(overviewCustomTo)
      if (!fromIso || !toIso) return
      const nextFrom = isoToBrDate(fromIso)
      const nextTo = isoToBrDate(toIso)
      if (nextFrom !== movDe) setMovDe(nextFrom)
      if (nextTo !== movAte) setMovAte(nextTo)
      return
    }

    const start = new Date(now)
    if (overviewPeriod === '7d') start.setDate(start.getDate() - 7)
    else if (overviewPeriod === '30d') start.setDate(start.getDate() - 30)
    else start.setFullYear(start.getFullYear() - 1)
    const nextFrom = isoToBrDate(yyyyMmDd(start))
    const nextTo = isoToBrDate(yyyyMmDd(now))
    if (nextFrom !== movDe) setMovDe(nextFrom)
    if (nextTo !== movAte) setMovAte(nextTo)
  }, [movAte, movDe, overviewCustomFrom, overviewCustomTo, overviewPeriod])
  const [overviewRoi, setOverviewRoi] = React.useState<RoiInsights | null>(null)
  const [overviewQuality, setOverviewQuality] = React.useState<QualityReport | null>(null)
  const [qualityMatchesOpen, setQualityMatchesOpen] = React.useState(false)
  const [qualityMatchesItems, setQualityMatchesItems] = React.useState<Insumo[]>([])
  const [qualityMatchesIssue, setQualityMatchesIssue] = React.useState<QualityIssue | null>(null)
  const [qualityMatchesSavingRegistro, setQualityMatchesSavingRegistro] = React.useState('')
  const [overviewMovResumo, setOverviewMovResumo] = React.useState<{ entradaQtd: number; saidaQtd: number; entradaValor: number; saidaValor: number; saldoLiquido: number } | null>(null)
  const [overviewMovSeries, setOverviewMovSeries] = React.useState<
    Array<{ day: string; entrada: number; saida: number; entradaValor?: number; saidaValor?: number }>
  >([])

	  const [insightsLoading, setInsightsLoading] = React.useState(false)
	  const [insightsAlertas, setInsightsAlertas] = React.useState<EstoqueAlerta[]>([])
	  const [insightsTrends, setInsightsTrends] = React.useState<any | null>(null)
	  const [insightsTurnover, setInsightsTurnover] = React.useState<{ saida?: any; entrada?: any } | null>(null)
  type AlertasStatusFilter = 'TODOS' | 'ATENCAO' | 'URGENTE' | 'VENCENDO' | 'EXPIRADO' | 'INFO'
  const [alertasStatus, setAlertasStatus] = React.useState<AlertasStatusFilter>('TODOS')
  const [alertasCategoria, setAlertasCategoria] = React.useState('')
  const [alertasMarca, setAlertasMarca] = React.useState('')
  const [alertasBusca, setAlertasBusca] = React.useState('')
  type AlertasSortKey = 'produto' | 'categoria' | 'status' | 'acao' | 'atual' | 'min' | 'dif' | 'percentual'
  const [alertasSortKey, setAlertasSortKey] = React.useState<AlertasSortKey>('status')
  const [alertasSortDir, setAlertasSortDir] = React.useState<'asc' | 'desc'>('asc')
  const [offlineQueueCount, setOfflineQueueCount] = React.useState(0)
  const [offlineDialogOpen, setOfflineDialogOpen] = React.useState(false)
  const [offlineItems, setOfflineItems] = React.useState<OfflineQueueItem[]>([])

  const DEBUG_UI_KEY = 'skincos.ui.debug.v1'
  const OFFLINE_QUEUE_KEY = 'skincos.insumos.offlineQueue.v1'
  const SHARE_HISTORY_KEY = 'skincos.insumos.shareHistory.v1'

  const [debugUi, setDebugUi] = React.useState(false)

  React.useEffect(() => {
    try {
      const params = new URLSearchParams(window.location.search)
      const forced = params.get('debug') === '1'
      if (forced) {
        setDebugUi(true)
        return
      }
      setDebugUi(window.localStorage.getItem(DEBUG_UI_KEY) === '1')
    } catch {
      setDebugUi(false)
    }
  }, [])

  const toggleDebugUi = React.useCallback(() => {
    setDebugUi((cur) => {
      const next = !cur
      try {
        window.localStorage.setItem(DEBUG_UI_KEY, next ? '1' : '0')
      } catch {
        // ignore
      }
      return next
    })
  }, [])

  type MainPanelId = 'mov'
  const MAIN_PANELS_KEY = 'skincos.insumos.layout.mainPanels.v1'
  const DEFAULT_MAIN_PANELS: MainPanelId[] = ['mov']

  type OverviewPanelId = 'policies' | 'alerts' | 'charts'
  const OVERVIEW_PANELS_KEY = 'skincos.insumos.layout.overviewPanels.v1'
  const DETAILS_OPEN_KEY = 'skincos.insumos.layout.detailsOpen.v1'
  const MAIN_PANEL_OPEN_KEYS: Record<MainPanelId, string> = {
    mov: 'insumos.panel.movimentacoes'
  }
  const OVERVIEW_PANEL_OPEN_KEYS: Record<OverviewPanelId, string> = {
    policies: 'insumos.panel.policies',
    alerts: 'insumos.panel.alerts',
    charts: 'insumos.panel.charts'
  }
  const DEFAULT_OVERVIEW_PANELS: OverviewPanelId[] = ['alerts', 'charts']
  const [mainPanelOrder, setMainPanelOrder] = React.useState<MainPanelId[]>(() => {
    try {
      const raw = window.localStorage.getItem(MAIN_PANELS_KEY)
      if (!raw) return DEFAULT_MAIN_PANELS
      const parsed = JSON.parse(raw)
      const list = Array.isArray(parsed) ? parsed.map(String) : []
      const allowed = new Set(DEFAULT_MAIN_PANELS)
      const cleaned = list.filter((x) => allowed.has(x as any)) as MainPanelId[]
      return cleaned.length ? cleaned : DEFAULT_MAIN_PANELS
    } catch {
      return DEFAULT_MAIN_PANELS
    }
  })
  const [overviewPanelOrder, setOverviewPanelOrder] = React.useState<OverviewPanelId[]>(() => {
    try {
      const raw = window.localStorage.getItem(OVERVIEW_PANELS_KEY)
      if (!raw) return DEFAULT_OVERVIEW_PANELS
      const parsed = JSON.parse(raw)
      const list = Array.isArray(parsed) ? parsed.map(String) : []
      const allowed = new Set(DEFAULT_OVERVIEW_PANELS)
      const cleaned = list.filter((x) => allowed.has(x as any)) as OverviewPanelId[]
      return cleaned.length ? cleaned : DEFAULT_OVERVIEW_PANELS
    } catch {
      return DEFAULT_OVERVIEW_PANELS
    }
  })

  const [detailsOpen, setDetailsOpen] = React.useState<Record<string, boolean>>(() => {
    try {
      const raw = window.localStorage.getItem(DETAILS_OPEN_KEY)
      const parsed = raw ? JSON.parse(raw) : null
      if (!parsed || typeof parsed !== 'object') return {}
      const out: Record<string, boolean> = {}
      for (const [k, v] of Object.entries(parsed as any)) {
        out[String(k)] = !!v
      }
      return out
    } catch {
      return {}
    }
  })

  React.useEffect(() => {
    const el = overviewSectionRef.current
    if (!el) return
    if (typeof IntersectionObserver === 'undefined') {
      setOverviewVisible(true)
      setOverviewEverVisible(true)
      return
    }
    const observer = new IntersectionObserver(
      (entries) => {
        const entry = entries[0]
        if (!entry) return
        const isVisible = entry.isIntersecting || entry.intersectionRatio > 0
        setOverviewVisible(isVisible)
        if (isVisible) setOverviewEverVisible(true)
      },
      { root: null, rootMargin: '120px 0px', threshold: 0.15 }
    )
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  const canUseApi = Boolean(
    typeof health?.ready === 'boolean'
      ? health.ready
      : (typeof health?.dbConfigured === 'boolean' ? health.dbConfigured : health?.ok)
  )
  const isAuthed = !!user?.username
  const allowedUnits = Array.isArray(user?.allowedUnits) ? user!.allowedUnits!.filter(Boolean) : []
  const autoSyncSuspended = autoSyncSuspendedUntil > Date.now()
  const autoSyncRemainingSeconds = autoSyncSuspended ? Math.max(1, Math.ceil((autoSyncSuspendedUntil - Date.now()) / 1000)) : 0

  const isManagerRole = ['ADMIN', 'GESTOR', 'GERENTE'].includes(String(user?.role || '').toUpperCase())

  const markAutoSyncFailure = React.useCallback(
    (error: unknown) => {
      const status = Number((error as any)?.status || 0)
      const rawMessage = String((error as any)?.message || '')
      const message = rawMessage.toLowerCase()
      const isNetworkError =
        status <= 0 ||
        String((error as any)?.name || '') === 'TypeError' ||
        message.includes('network') ||
        message.includes('failed to fetch') ||
        message.includes('conex')
      const isRecoverableServerFailure = status >= 500 || status === 429 || isNetworkError
      if (!isRecoverableServerFailure) return

      const now = Date.now()
      const failureWindowMs = 30_000
      const cooldownMs = 60_000

      apiFailureTimestampsRef.current = apiFailureTimestampsRef.current.filter((ts) => now - ts <= failureWindowMs)
      apiFailureTimestampsRef.current.push(now)

      if (apiFailureTimestampsRef.current.length < 5) return
      if (autoSyncSuspendedUntil > now) return

      setAutoSyncSuspendedUntil(now + cooldownMs)
      toast.warning('API instável: sincronização automática reduzida por 60 segundos.')
    },
    [autoSyncSuspendedUntil]
  )

  React.useEffect(() => {
    if (!isAuthed || !canUseApi) {
      setOverviewLoaded(false)
      setInsumosLoaded(false)
      setMovLoaded(false)
      setInsightsLoaded(false)
    }
  }, [isAuthed, canUseApi])

  React.useEffect(() => {
    if (!autoSyncSuspendedUntil) return
    const remainingMs = autoSyncSuspendedUntil - Date.now()
    if (remainingMs <= 0) {
      apiFailureTimestampsRef.current = []
      setAutoSyncSuspendedUntil(0)
      return
    }
    const timeoutId = window.setTimeout(() => {
      apiFailureTimestampsRef.current = []
      setAutoSyncSuspendedUntil(0)
    }, remainingMs + 20)
    return () => window.clearTimeout(timeoutId)
  }, [autoSyncSuspendedUntil])

  React.useEffect(() => {
    if (autoSyncSuspendedUntil) return
    overviewFullAttemptRef.current = 0
  }, [autoSyncSuspendedUntil])

  const dashboardProgress = React.useMemo(() => {
    const steps = [
      healthLoaded,
      authLoaded,
      ...(canUseApi && isAuthed ? [overviewLoaded, insumosLoaded, movLoaded, insightsLoaded] : [])
    ]
    const total = steps.length || 1
    const done = steps.filter(Boolean).length
    return Math.max(0, Math.min(100, Math.round((done / total) * 100)))
  }, [authLoaded, canUseApi, healthLoaded, insumosLoaded, insightsLoaded, isAuthed, movLoaded, overviewLoaded])

  const loadingPercent = Math.max(0, Math.min(100, Math.round(dashboardProgress)))

  const isDashboardLoading =
    authLoading || healthLoading || (canUseApi && isAuthed && dashboardProgress < 100)
  const shouldShowDashboardLoading =
    isDashboardLoading || !authLoaded || !healthLoaded
  const showOverviewLoadingProgress =
    overviewLoading || (canUseApi && isAuthed && shouldShowDashboardLoading)

  const overviewCriticosCount = React.useMemo(() => {
    const criticos = Number(overviewResumo?.criticos ?? NaN)
    const expirados = Number(overviewNotifications?.counts?.expiredWithStock ?? NaN)
    if (Number.isNaN(criticos) && Number.isNaN(expirados)) return null
    return (Number.isNaN(criticos) ? 0 : criticos) + (Number.isNaN(expirados) ? 0 : expirados)
  }, [overviewNotifications?.counts?.expiredWithStock, overviewResumo?.criticos])

  const overviewAtencaoCount = React.useMemo(() => {
    const baixo = Number(overviewNotifications?.counts?.lowStock ?? NaN)
    const vencendo = Number(overviewNotifications?.counts?.expiringSoon ?? NaN)
    if (Number.isNaN(baixo) && Number.isNaN(vencendo)) return null
    return (Number.isNaN(baixo) ? 0 : baixo) + (Number.isNaN(vencendo) ? 0 : vencendo)
  }, [overviewNotifications?.counts?.expiringSoon, overviewNotifications?.counts?.lowStock])

  React.useEffect(() => {
    try {
      window.dispatchEvent(
        new CustomEvent('skincos:insumos:estoque', {
          detail: {
            value: overviewResumo?.valorEstoqueTotal ?? null,
            loading: showOverviewLoadingProgress,
            percent: loadingPercent
          }
        })
      )
    } catch {
      // ignore
    }
  }, [loadingPercent, overviewResumo?.valorEstoqueTotal, showOverviewLoadingProgress])
  const renderInlinePercent = React.useCallback(
    (active: boolean, className = '') => {
      if (!active) return null
      return (
        <div className={`inline-flex items-center gap-2 text-xs text-blue-200/70 ${className}`.trim()}>
          <span className="inline-flex h-3 w-3 rounded-full border border-blue-200/70 border-t-transparent animate-spin" />
          <span className="font-mono">{loadingPercent}%</span>
        </div>
      )
    },
    [loadingPercent]
  )

  const renderLoadingText = React.useCallback(
    (loading: boolean, emptyLabel: string) => {
      if (loading || shouldShowDashboardLoading) {
        return (
          <span className="inline-flex items-center gap-2 text-blue-100/70">
            <span className="inline-flex h-3 w-3 rounded-full border border-blue-200/70 border-t-transparent animate-spin" />
            {`Carregando ${loadingPercent}%`}
          </span>
        )
      }
      return <span>{emptyLabel}</span>
    },
    [loadingPercent, shouldShowDashboardLoading]
  )

  const DashboardLoadingButton = React.useCallback(
    ({ size = 'sm', className = '' }: { size?: 'sm' | 'default' | 'lg'; className?: string } = {}) => (
      <Button variant="secondary" size={size} disabled className={`gap-2 ${className}`.trim()}>
        <span className="animate-pulse">⏳</span>
        {`Carregando dados ${dashboardProgress}%`}
      </Button>
    ),
    [dashboardProgress]
  )

  const renderListPlaceholder = React.useCallback(
    (loading: boolean, emptyLabel: string) => {
      if (loading || shouldShowDashboardLoading) return <div className="text-sm text-blue-100/70">{renderLoadingText(true, emptyLabel)}</div>
      if (isAuthed) return emptyLabel
      return 'Faça login para carregar.'
    },
    [DashboardLoadingButton, isAuthed, renderLoadingText, shouldShowDashboardLoading]
  )

  const visibleMainPanels = React.useMemo(() => {
    const allowed = new Set(DEFAULT_MAIN_PANELS)
    const ordered = (mainPanelOrder || []).filter((p) => allowed.has(p))
    for (const p of DEFAULT_MAIN_PANELS) {
      if (allowed.has(p) && !ordered.includes(p)) ordered.push(p)
    }
    return ordered
  }, [DEFAULT_MAIN_PANELS.join('|'), mainPanelOrder.join('|')])

  const visibleOverviewPanels = React.useMemo(() => {
    const allowed = new Set<OverviewPanelId>(['alerts', 'charts'])
    const ordered = (overviewPanelOrder || []).filter((p) => allowed.has(p))
    for (const p of DEFAULT_OVERVIEW_PANELS) {
      if (allowed.has(p) && !ordered.includes(p)) ordered.push(p)
    }
    return ordered
  }, [DEFAULT_OVERVIEW_PANELS.join('|'), isManagerRole, overviewPanelOrder.join('|')])

  const chartsPanelOpen = detailsOpen[OVERVIEW_PANEL_OPEN_KEYS.charts] ?? true
  const chartsPanelVisible = visibleOverviewPanels.includes('charts')

  const persistMainPanels = React.useCallback((next: MainPanelId[]) => {
    setMainPanelOrder(next)
    try {
      window.localStorage.setItem(MAIN_PANELS_KEY, JSON.stringify(next))
    } catch {
      // ignore
    }
  }, [])

  const persistOverviewPanels = React.useCallback((next: OverviewPanelId[]) => {
    setOverviewPanelOrder(next)
    try {
      window.localStorage.setItem(OVERVIEW_PANELS_KEY, JSON.stringify(next))
    } catch {
      // ignore
    }
  }, [])

  const persistDetailsOpen = React.useCallback((next: Record<string, boolean>) => {
    setDetailsOpen(next)
    try {
      window.localStorage.setItem(DETAILS_OPEN_KEY, JSON.stringify(next))
    } catch {
      // ignore
    }
  }, [])

  const prefsLoadedForUserRef = React.useRef<string | null>(null)
  const prefsSaveTimerRef = React.useRef<number | null>(null)
  const pendingPrefsRef = React.useRef<UserPrefs | null>(null)

  const refreshCsrfForPrefs = React.useCallback(async () => {
    try {
      const out = await apiJson<{ success?: boolean; user?: InsumosUser; csrfToken?: string }>('/auth/refresh', { method: 'POST' })
      const next = out?.csrfToken || null
      setCsrfToken(next)
      if (out?.user) setUser(out.user)
      return next
    } catch {
      setCsrfToken(null)
      setUser(null)
      return null
    }
  }, [])

  const saveUserPrefs = React.useCallback(
    async (prefs: UserPrefs) => {
      if (!isAuthed) return
      try {
        await apiJson<{ success?: boolean }>('/prefs', {
          method: 'PUT',
          body: { prefs },
          csrfToken,
          retryOnCsrf: refreshCsrfForPrefs
        })
      } catch {
        // ignore (UI already persists in localStorage; server sync is best-effort)
      }
    },
    [csrfToken, isAuthed, refreshCsrfForPrefs]
  )

  const scheduleSaveUserPrefs = React.useCallback(
    (prefs: UserPrefs) => {
      if (!isAuthed) return
      pendingPrefsRef.current = prefs
      if (prefsSaveTimerRef.current) window.clearTimeout(prefsSaveTimerRef.current)
      prefsSaveTimerRef.current = window.setTimeout(() => {
        const pending = pendingPrefsRef.current
        pendingPrefsRef.current = null
        if (!pending) return
        void saveUserPrefs(pending)
      }, 700)
    },
    [isAuthed, saveUserPrefs]
  )

  React.useEffect(() => {
    return () => {
      if (prefsSaveTimerRef.current) window.clearTimeout(prefsSaveTimerRef.current)
    }
  }, [])

  const applyUserPrefs = React.useCallback(
    (prefs: UserPrefs | null | undefined) => {
      if (!prefs || typeof prefs !== 'object') return

      if (Array.isArray(prefs.mainPanelOrder)) {
        const allowed = new Set(DEFAULT_MAIN_PANELS)
        const cleaned = prefs.mainPanelOrder.map(String).filter((x) => allowed.has(x as any)) as MainPanelId[]
        if (cleaned.length) persistMainPanels(cleaned)
      }

      if (Array.isArray(prefs.overviewPanelOrder)) {
        const allowed = new Set(DEFAULT_OVERVIEW_PANELS)
        const cleaned = prefs.overviewPanelOrder.map(String).filter((x) => allowed.has(x as any)) as OverviewPanelId[]
        if (cleaned.length) persistOverviewPanels(cleaned)
      }

      if (prefs.detailsOpen && typeof prefs.detailsOpen === 'object') {
        const out: Record<string, boolean> = {}
        for (const [k, v] of Object.entries(prefs.detailsOpen)) out[String(k)] = !!v
        persistDetailsOpen(out)
      }
    },
    [DEFAULT_MAIN_PANELS.join('|'), DEFAULT_OVERVIEW_PANELS.join('|'), persistDetailsOpen, persistMainPanels, persistOverviewPanels]
  )

  const loadUserPrefs = React.useCallback(async () => {
    if (!isAuthed) return
    try {
      const out = await apiJson<{ success?: boolean; prefs?: UserPrefs | null }>('/prefs')
      applyUserPrefs(out?.prefs)
    } catch {
      // ignore
    } finally {
      prefsLoadedForUserRef.current = String(user?.username || '')
    }
  }, [applyUserPrefs, isAuthed, user?.username])

  React.useEffect(() => {
    if (!isAuthed) {
      prefsLoadedForUserRef.current = null
      return
    }
    const username = String(user?.username || '')
    if (!username) return
    if (prefsLoadedForUserRef.current === username) return
    void loadUserPrefs()
  }, [isAuthed, loadUserPrefs, user?.username])

  const setAllDetailsOpen = React.useCallback(
    (open: boolean) => {
      const root = rootRef.current
      if (!root) return
      const keys = Array.from(root.querySelectorAll('details[data-pref-key]'))
        .map((el) => el.getAttribute('data-pref-key') || '')
        .filter(Boolean)
      const allKeys = Array.from(
        new Set([...keys, ...Object.values(MAIN_PANEL_OPEN_KEYS), ...Object.values(OVERVIEW_PANEL_OPEN_KEYS)])
      )
      if (!allKeys.length) return
      setDetailsOpen((prev) => {
        const next = { ...prev }
        for (const k of allKeys) next[k] = open
        try {
          window.localStorage.setItem(DETAILS_OPEN_KEY, JSON.stringify(next))
        } catch {
          // ignore
        }
        scheduleSaveUserPrefs({ mainPanelOrder, overviewPanelOrder, detailsOpen: next })
        return next
      })
    },
    [
      mainPanelOrder.join('|'),
      overviewPanelOrder.join('|'),
      scheduleSaveUserPrefs
    ]
  )

  const setDetailsKeyOpen = React.useCallback(
    (key: string, open: boolean) => {
      setDetailsOpen((prev) => {
        const next = { ...prev, [key]: open }
        try {
          window.localStorage.setItem(DETAILS_OPEN_KEY, JSON.stringify(next))
        } catch {
          // ignore
        }
        scheduleSaveUserPrefs({ mainPanelOrder, overviewPanelOrder, detailsOpen: next })
        return next
      })
    },
    [mainPanelOrder.join('|'), overviewPanelOrder.join('|'), scheduleSaveUserPrefs]
  )

  const resetUserLayoutPrefs = React.useCallback(async () => {
    const nextMain = DEFAULT_MAIN_PANELS
    const nextOverview = DEFAULT_OVERVIEW_PANELS
    persistMainPanels(nextMain)
    persistOverviewPanels(nextOverview)
    persistDetailsOpen({})
    try {
      window.localStorage.removeItem(DETAILS_OPEN_KEY)
    } catch {
      // ignore
    }
    try {
      await saveUserPrefs({ mainPanelOrder: nextMain, overviewPanelOrder: nextOverview, detailsOpen: {} })
      toast.success('Layout resetado.')
    } catch {
      // ignore
    }
  }, [DEFAULT_MAIN_PANELS.join('|'), DEFAULT_OVERVIEW_PANELS.join('|'), persistDetailsOpen, persistMainPanels, persistOverviewPanels, saveUserPrefs])

  const moveIdInList = React.useCallback(<T,>(list: T[], fromIdx: number, toIdx: number) => {
    const next = Array.from(list)
    const [moved] = next.splice(fromIdx, 1)
    next.splice(toIdx, 0, moved)
    return next
  }, [])

  const [mainPanelsDirection, setMainPanelsDirection] = React.useState<'horizontal' | 'vertical'>(() => {
    if (typeof window === 'undefined' || !(window as any).matchMedia) return 'horizontal'
    return window.matchMedia('(min-width: 1024px)').matches ? 'horizontal' : 'vertical'
  })

  React.useEffect(() => {
    if (typeof window === 'undefined' || !(window as any).matchMedia) return
    const mq = window.matchMedia('(min-width: 1024px)')
    const apply = () => setMainPanelsDirection(mq.matches ? 'horizontal' : 'vertical')
    apply()
    const onChange = () => apply()
    try {
      mq.addEventListener('change', onChange)
      return () => mq.removeEventListener('change', onChange)
    } catch {
      // Safari fallback
      mq.addListener(onChange)
      return () => mq.removeListener(onChange)
    }
  }, [])

  const onDragEndLayout = React.useCallback(
    (result: DropResult) => {
      if (!result.destination) return
      if (result.source.droppableId !== result.destination.droppableId) return

      if (result.source.droppableId === 'overview-panels') {
        const next = moveIdInList(visibleOverviewPanels, result.source.index, result.destination.index)
        persistOverviewPanels(next)
        scheduleSaveUserPrefs({ mainPanelOrder, overviewPanelOrder: next, detailsOpen })
        return
      }

      if (result.source.droppableId === 'main-panels') {
        const next = moveIdInList(visibleMainPanels, result.source.index, result.destination.index)
        persistMainPanels(next)
        scheduleSaveUserPrefs({ mainPanelOrder: next, overviewPanelOrder, detailsOpen })
      }
    },
    [
      detailsOpen,
      mainPanelOrder.join('|'),
      moveIdInList,
      overviewPanelOrder.join('|'),
      persistMainPanels,
      persistOverviewPanels,
      scheduleSaveUserPrefs,
      visibleMainPanels.join('|'),
      visibleOverviewPanels.join('|')
    ]
  )

  const mainOrderIndex = React.useMemo(() => {
    const map = new Map<MainPanelId, number>()
    visibleMainPanels.forEach((id, idx) => map.set(id, idx))
    return map
  }, [visibleMainPanels.join('|')])

  const categoryPolicyBySlug = React.useMemo(() => {
    const map = new Map<string, CategoryPolicy>()
    for (const p of categoryPolicies || []) {
      const slug = String(p?.slug || '').trim()
      if (!slug) continue
      map.set(slug, p)
    }
    return map
  }, [Array.isArray(categoryPolicies) ? categoryPolicies.map((p) => String(p?.slug || '')).join('|') : ''])

  const getPolicyForCategoria = React.useCallback(
    (categoria?: string | null) => {
      const slug = slugifyCategoria(categoria)
      const p = slug ? categoryPolicyBySlug.get(slug) : undefined
      return {
        slug,
        requiresLot: !!p?.requiresLot,
        requiresExpiry: !!p?.requiresExpiry,
        fefo: !!p?.fefo
      }
    },
    [categoryPolicyBySlug]
  )

  React.useEffect(() => {
    if (!createOpen) return
    if (createPolicyTouched) return
    setCreateCategoriaRequiresLot(false)
    setCreateCategoriaRequiresExpiry(false)
    setCreateCategoriaFefo(false)
  }, [createOpen, createPolicyTouched])

  React.useEffect(() => {
    if (createOpen) return
    setCreatePolicyTouched(false)
  }, [createOpen])

  const getPolicyForItem = React.useCallback((item?: Insumo | null) => {
    const hasExplicit =
      item?.policyRequiresLot != null || item?.policyRequiresExpiry != null || item?.policyFefo != null
    if (hasExplicit) {
      return {
        requiresLot: !!item?.policyRequiresLot,
        requiresExpiry: !!item?.policyRequiresExpiry,
        fefo: !!item?.policyFefo
      }
    }
    return { requiresLot: false, requiresExpiry: false, fefo: false }
  }, [])

  const allUnidades = React.useMemo(() => {
    const fromHealth = Array.isArray(health?.unidades) ? health!.unidades!.filter(Boolean) : []
    return fromHealth.length ? fromHealth : ['novo-hamburgo', 'barra-shopping-sul']
  }, [Array.isArray(health?.unidades) ? health!.unidades!.join('|') : ''])

  const isSameInsumo = React.useCallback((item: Insumo, target: Insumo | null) => {
    if (!target) return false
    const registro = normalizeText(item?.registro || '')
    const targetRegistro = normalizeText(target?.registro || '')
    if (registro && targetRegistro && registro === targetRegistro) return true
    const codes = getInsumoBarcodes(item).map((c) => normalizeText(c))
    const targetCodes = getInsumoBarcodes(target).map((c) => normalizeText(c))
    const produto = normalizeText(item?.produto || '')
    const categoria = normalizeText(item?.categoria || '')
    const marca = normalizeText(item?.marca || '')
    const targetProduto = normalizeText(target?.produto || '')
    const targetCategoria = normalizeText(target?.categoria || '')
    const targetMarca = normalizeText(target?.marca || '')
    const sameCore =
      (!!produto || !!categoria || !!marca) &&
      produto === targetProduto &&
      categoria === targetCategoria &&
      marca === targetMarca
    if (!sameCore) return false
    if (!codes.length || !targetCodes.length) return true
    return targetCodes.some((c) => codes.includes(c))
  }, [])

  const quickLotes = React.useMemo(() => {
    const codigo = quickCodigo.trim()
    if (!codigo) return []
    const ctxUnidade = quickOp === 'TRANSFERENCIA' ? transferFrom : unidade
    const fromLookup =
      ctxUnidade &&
      quickLookupCtxUnidade === ctxUnidade &&
      quickLookupCode === codigo &&
      Array.isArray(quickLookupItems) &&
      quickLookupItems.length

    const source = fromLookup ? quickLookupItems : (insumos || [])
    const items = source
      .filter((i) => getInsumoBarcodes(i).includes(codigo) && String(i.registro || '').trim())
      .map((i) => {
        const registro = String(i.registro || '').trim()
        const lote = String(i.lote || '').trim()
        const dataValidade = i.dataValidade ?? null
        const estoque = ctxUnidade && i?.estoques ? Number(i.estoques[ctxUnidade] ?? 0) : Number(i.estoqueAtual ?? 0)
        return { registro, lote, dataValidade, estoque: Number.isFinite(estoque) ? estoque : 0 }
      })

    const unique = new Map<string, (typeof items)[number]>()
    for (const it of items) if (!unique.has(it.registro)) unique.set(it.registro, it)
    const list = Array.from(unique.values())

    const sortByValidade = (a: any, b: any) => {
      const da = a?.dataValidade ? new Date(a.dataValidade).getTime() : Number.POSITIVE_INFINITY
      const db = b?.dataValidade ? new Date(b.dataValidade).getTime() : Number.POSITIVE_INFINITY
      if (da !== db) return da - db
      return String(a.registro).localeCompare(String(b.registro))
    }

    if (quickOp === 'BAIXA' || quickOp === 'TRANSFERENCIA') {
      const withStock = list.filter((l) => (Number(l.estoque) || 0) > 0).sort(sortByValidade)
      const noStock = list.filter((l) => (Number(l.estoque) || 0) <= 0).sort(sortByValidade)
      return [...withStock, ...noStock]
    }

    return list.sort(sortByValidade)
  }, [insumos, quickCodigo, quickOp, quickLookupCode, quickLookupCtxUnidade, quickLookupItems, transferFrom, unidade])

  const quickSearchMatches = React.useMemo(() => {
    const query = quickSearch.trim().toLowerCase()
    if (!query) return []
    const looksLikeCode = /^[0-9]{4,}$/.test(query)
    const remoteActive = canUseApi && isAuthed && !looksLikeCode && query.length >= 2
    const baseList = remoteActive
      ? (quickSearchRemoteError ? (Array.isArray(insumos) ? insumos : []) : quickSearchRemote)
      : (Array.isArray(insumos) ? insumos : [])
    const selected: Insumo[] = []
    if (Array.isArray(quickLookupItems) && quickLookupItems.length) selected.push(...quickLookupItems)
    else if (quickSelectedSnapshot) selected.push(quickSelectedSnapshot)
    const primarySelected = quickSelectedSnapshot || (quickLookupItems.length ? quickLookupItems[0] : null)
    const allowSelectedWhileLoading = !!(quickLookupLoading && primarySelected)
    const selectedSignatures = selected.map((s) => ({
      registro: normalizeText(s?.registro || ''),
      codes: getInsumoBarcodes(s).map((c) => normalizeText(c)),
      produto: normalizeText(s?.produto || ''),
      categoria: normalizeText(s?.categoria || ''),
      marca: normalizeText(s?.marca || '')
    }))
    const isSelected = (item: Insumo) => {
      const registro = normalizeText(item?.registro || '')
      if (registro && selectedSignatures.some((s) => s.registro && s.registro === registro)) return true
      const codes = getInsumoBarcodes(item).map((c) => normalizeText(c))
      const produto = normalizeText(item?.produto || '')
      const categoria = normalizeText(item?.categoria || '')
      const marca = normalizeText(item?.marca || '')
      return selectedSignatures.some((s) => {
        const sameCore =
          (!!produto || !!categoria || !!marca) &&
          produto === s.produto &&
          categoria === s.categoria &&
          marca === s.marca
        if (!sameCore) return false
        if (!codes.length || !s.codes.length) return true
        return s.codes.some((c) => codes.includes(c))
      })
    }
    const scored: Array<{ item: Insumo; matchedCode: string; score: number }> = []
    const normQuery = normalizeText(query)
    const scoreMatch = (item: Insumo, matchedCode: string) => {
      let score = 0
      const produto = normalizeText(item?.produto || '')
      const categoria = normalizeText(item?.categoria || '')
      const marca = normalizeText(item?.marca || '')
      const extras = [
        normalizeText((item as any)?.especificacao || ''),
        normalizeText((item as any)?.concentracao || ''),
        normalizeText((item as any)?.volume || ''),
        normalizeText((item as any)?.calibre || ''),
        normalizeText((item as any)?.tipoUnidade || '')
      ]
      const codes = getInsumoBarcodes(item).map((c) => normalizeText(c))
      if (matchedCode) score += 20
      if (codes.includes(normQuery)) score += 80
      if (produto === normQuery) score += 70
      else if (produto.startsWith(normQuery)) score += 40
      else if (produto.includes(normQuery)) score += 25
      if (marca === normQuery) score += 30
      else if (marca.includes(normQuery)) score += 12
      if (categoria === normQuery) score += 25
      else if (categoria.includes(normQuery)) score += 10
      if (extras.some((e) => e && e === normQuery)) score += 15
      else if (extras.some((e) => e && e.includes(normQuery))) score += 8
      return score
    }
    for (const item of baseList) {
      if (isSelected(item) && !(allowSelectedWhileLoading && isSameInsumo(item, primarySelected))) continue
      const codes = getInsumoBarcodes(item)
      const produto = String(item?.produto || '').toLowerCase()
      const categoria = String(item?.categoria || '').toLowerCase()
      const marca = String(item?.marca || '').toLowerCase()
      const extras = [
        String((item as any)?.especificacao || '').toLowerCase(),
        String((item as any)?.concentracao || '').toLowerCase(),
        String((item as any)?.volume || '').toLowerCase(),
        String((item as any)?.calibre || '').toLowerCase(),
        String((item as any)?.tipoUnidade || '').toLowerCase()
      ]
      const hay = [produto, categoria, marca, ...extras, ...codes].filter(Boolean).join(' ')
      if (!hay.includes(query)) continue
      const matchedCode = codes.find((c) => String(c || '').toLowerCase().includes(query)) || codes[0] || ''
      scored.push({ item, matchedCode, score: scoreMatch(item, matchedCode) })
    }
    return scored
      .sort((a, b) => {
        if (b.score !== a.score) return b.score - a.score
        return String(a.item?.produto || '').localeCompare(String(b.item?.produto || ''), 'pt-BR', { sensitivity: 'base' })
      })
      .slice(0, 8)
  }, [canUseApi, insumos, isAuthed, isSameInsumo, quickLookupItems, quickLookupLoading, quickSearch, quickSearchRemote, quickSearchRemoteError, quickSelectedSnapshot])

  const hasQuickSelection = !!quickSelectedSnapshot || quickLookupItems.length > 0

  const selectQuickCodigo = React.useCallback(
    (code: string, opts?: { setSearch?: boolean; snapshot?: Insumo | null }) => {
      const value = String(code || '').trim()
      if (!value) return false
      setQuickCodigo(value)
      if (opts?.setSearch) setQuickSearch(value)
      if (opts && Object.prototype.hasOwnProperty.call(opts, 'snapshot')) {
        setQuickSelectedSnapshot(opts?.snapshot ?? null)
      }
      setQuickLookupError(null)
      return true
    },
    []
  )

  const clearQuickSelection = React.useCallback(() => {
    setQuickCodigo('')
    setQuickSelectedSnapshot(null)
    setQuickRegistro('')
    setQuickRegistros([])
    setQuickCandidates([])
    setQuickLookupError(null)
    setQuickLookupCtxUnidade(null)
    setQuickLookupCode(null)
    setQuickLookupItems([])
  }, [])

  const applyQuickSelection = React.useCallback((item: Insumo, preferredCode?: string) => {
    const codes = getInsumoBarcodes(item)
    if (!codes.length) {
      const message = 'Este item não possui código de barras cadastrado.'
      setQuickLookupError(message)
      toast.error(message)
      return
    }
    const code = preferredCode && codes.includes(preferredCode) ? preferredCode : codes[0] || ''
    if (!code) return
    selectQuickCodigo(code, { setSearch: false, snapshot: item })
  }, [selectQuickCodigo])

  React.useEffect(() => {
    if (!quickLookupItems.length) return
    setQuickSelectedSnapshot(quickLookupItems[0])
  }, [quickLookupItems])

  React.useEffect(() => {
    if (!quickOp) return
    if (!canUseApi || !isAuthed) {
      setQuickSearchRemote([])
      setQuickSearchRemoteLoading(false)
      setQuickSearchRemoteError(null)
      return
    }
    const query = quickSearch.trim()
    const looksLikeCode = /^[0-9]{4,}$/.test(query)
    if (!query || looksLikeCode || query.length < 2) {
      setQuickSearchRemote([])
      setQuickSearchRemoteLoading(false)
      setQuickSearchRemoteError(null)
      return
    }
    const ctxUnidade = quickOp === 'TRANSFERENCIA' ? transferFrom : unidade
    const token = ++quickSearchRemoteTokenRef.current
    setQuickSearchRemoteLoading(true)
    setQuickSearchRemoteError(null)
    const t = window.setTimeout(() => {
      void (async () => {
        try {
          const params = new URLSearchParams({
            unidade: ctxUnidade,
            q: query,
            pagina: '1',
            limite: '30'
          })
          const out = await apiJson<{ success?: boolean; data?: Insumo[] }>(`/insumos?${params.toString()}`)
          if (token !== quickSearchRemoteTokenRef.current) return
          setQuickSearchRemote(Array.isArray(out?.data) ? out.data : [])
        } catch (e: any) {
          if (token !== quickSearchRemoteTokenRef.current) return
          const message = e?.message || 'Falha ao buscar insumos.'
          setQuickSearchRemoteError(message)
          setQuickSearchRemote([])
          console.warn('[insumos][quick-search]', {
            unit: ctxUnidade,
            query,
            status: e?.status || 0,
            code: e?.code || null
          })
        } finally {
          if (token === quickSearchRemoteTokenRef.current) setQuickSearchRemoteLoading(false)
        }
      })()
    }, 250)
    return () => window.clearTimeout(t)
  }, [apiJson, canUseApi, isAuthed, quickOp, quickSearch, transferFrom, unidade])

  React.useEffect(() => {
    const query = quickSearch.trim()
    const hasSelection = !!quickSelectedSnapshot || quickLookupItems.length > 0
    if (!query) {
      if (!hasSelection && quickCodigo) setQuickCodigo('')
      return
    }
    if (query === quickCodigo) return
    const looksLikeCode = /^[0-9]{4,}$/.test(query)
    if (looksLikeCode) {
      if (query !== quickCodigo) {
        setQuickSelectedSnapshot(null)
        setQuickCodigo(query)
      }
      return
    }
    if (!hasSelection && quickCodigo) setQuickCodigo('')
  }, [quickSearch, quickCodigo, quickLookupItems.length, quickSelectedSnapshot])

  React.useEffect(() => {
    if (quickCodigo) return
    const selected = quickLookupItems[0] || quickSelectedSnapshot
    if (!selected) return
    const codes = getInsumoBarcodes(selected)
    if (!codes.length) return
    setQuickCodigo(codes[0])
  }, [quickCodigo, quickLookupItems, quickSelectedSnapshot])

  const quickLoteNeedsPick = (quickCandidates.length > 1) || (quickRegistros.length > 1) || (quickLotes.length > 1)
  const quickLotesForPicker = React.useMemo(() => {
    if (quickCandidates.length) return quickCandidates
    if (quickRegistros.length) {
      const set = new Set(quickRegistros)
      const filtered = quickLotes.filter((l) => set.has(l.registro))
      if (filtered.length) return filtered
      return quickRegistros.map((registro) => ({ registro, lote: '', dataValidade: null as any, estoque: 0 }))
    }
    return quickLotes
  }, [quickCandidates, quickLotes, quickRegistros.join('|')])

  const resetQuickOperationState = React.useCallback((opts?: { keepFeedback?: boolean }) => {
    setQuickSearch('')
    setQuickCodigo('')
    setQuickSelectedSnapshot(null)
    setQuickRegistro('')
    setQuickRegistros([])
    setQuickCandidates([])
    setQuickAutoFefo(true)
    setQuickQuantidade('1')
    setQuickNovoEstoque('')
    setQuickObs('')
    setQuickMotivo('Ajuste manual')
    setQuickScanOpen(false)
    setQuickLookupLoading(false)
    setQuickLookupError(null)
    setQuickLookupCtxUnidade(null)
    setQuickLookupCode(null)
    setQuickLookupItems([])
    setQuickSearchRemote([])
    setQuickSearchRemoteLoading(false)
    setQuickSearchRemoteError(null)
    setQuickActionLoading(false)
    if (!opts?.keepFeedback) setQuickActionFeedback(null)
  }, [])

  const openQuickOperation = React.useCallback(
    (
      op: 'ENTRADA' | 'BAIXA' | 'TRANSFERENCIA',
      prefill?: {
        codigoBarras?: string | null
        quantidade?: number | string | null
        obs?: string | null
        fromUnidade?: string | null
        toUnidade?: string | null
      }
    ) => {
      resetQuickOperationState()
      if (prefill?.codigoBarras) {
        const code = String(prefill.codigoBarras).trim()
        selectQuickCodigo(code, { setSearch: true, snapshot: null })
      }
      if (prefill?.quantidade != null) setQuickQuantidade(String(prefill.quantidade))
      if (prefill?.obs) setQuickObs(String(prefill.obs))
      if (prefill?.fromUnidade) setTransferFrom(String(prefill.fromUnidade))
      if (prefill?.toUnidade) setTransferTo(String(prefill.toUnidade))
      setQuickOp(op)
    },
    [resetQuickOperationState, selectQuickCodigo]
  )

  React.useEffect(() => {
    if (!quickOp) return
    setQuickRegistros([])
    setQuickCandidates([])
    setQuickRegistro('')
  }, [quickOp])

  React.useEffect(() => {
    if (!quickOp) return
    setQuickRegistros([])
    setQuickCandidates([])
    setQuickRegistro('')
  }, [quickCodigo])

  const lookupInsumosByCodigo = React.useCallback(
    async ({ codigoBarras, ctxUnidade }: { codigoBarras: string; ctxUnidade: string }) => {
      const codigo = String(codigoBarras || '').trim()
      if (!codigo) return []
      const params = new URLSearchParams({
        unidade: ctxUnidade,
        q: codigo,
        pagina: '1',
        limite: '80'
      })
      const out = await apiJson<{ success?: boolean; data?: Insumo[]; resumo?: any }>(`/insumos?${params.toString()}`)
      const list = Array.isArray(out?.data) ? out.data : []
      const exact = list.filter((i) => getInsumoBarcodes(i).includes(codigo))
      return exact.length ? exact : list
    },
    [apiJson]
  )

  React.useEffect(() => {
    if (!quickOp) return
    if (!canUseApi || !isAuthed) return
    const codigo = quickCodigo.trim()
    if (!codigo) {
      setQuickLookupLoading(false)
      setQuickLookupError(null)
      setQuickLookupItems([])
      setQuickLookupCode(null)
      setQuickLookupCtxUnidade(null)
      return
    }
    const ctxUnidade = quickOp === 'TRANSFERENCIA' ? transferFrom : unidade
    const token = ++quickLookupTokenRef.current
    setQuickLookupLoading(true)
    setQuickLookupError(null)
    const t = window.setTimeout(() => {
      void (async () => {
        try {
          const items = await lookupInsumosByCodigo({ codigoBarras: codigo, ctxUnidade })
          if (token !== quickLookupTokenRef.current) return
          setQuickLookupItems(items)
          setQuickLookupCode(codigo)
          setQuickLookupCtxUnidade(ctxUnidade)
          if (!items.length) setQuickLookupError('Nenhum insumo encontrado para este código.')
        } catch (e: any) {
          if (token !== quickLookupTokenRef.current) return
          setQuickLookupError(e?.message || 'Falha ao buscar o insumo.')
          setQuickLookupItems([])
          setQuickLookupCode(codigo)
          setQuickLookupCtxUnidade(ctxUnidade)
          console.warn('[insumos][quick-lookup]', {
            unit: ctxUnidade,
            codigo,
            status: e?.status || 0,
            code: e?.code || null
          })
        } finally {
	          if (token === quickLookupTokenRef.current) setQuickLookupLoading(false)
	        }
	      })()
	    }, 250)

    return () => window.clearTimeout(t)
  }, [canUseApi, isAuthed, lookupInsumosByCodigo, quickCodigo, quickOp, transferFrom, unidade])

  const createLookupApplyPrefill = React.useCallback((items: Insumo[]) => {
    const it = Array.isArray(items) && items.length ? items[0] : null
    if (!it) return
    if (!createProduto.trim() && it.produto) setCreateProduto(String(it.produto))
    if (!createCategoria.trim() && it.categoria) setCreateCategoria(String(it.categoria))
    if (!createMarca.trim() && it.marca) setCreateMarca(String(it.marca))
    if (!createTipoUnidade.trim() && it.tipoUnidade) setCreateTipoUnidade(normalizeTipoUnidadeToCanonical(String(it.tipoUnidade)) || '')
    if (!createEspecificacao.trim() && (it as any).especificacao) setCreateEspecificacao(String((it as any).especificacao))
    if (!createConcentracao.trim() && (it as any).concentracao) setCreateConcentracao(String((it as any).concentracao))
    if (!createVolume.trim() && (it as any).volume) setCreateVolume(String((it as any).volume))
    if (!createHomologado && /homologad/i.test(String((it as any).fonte || '').trim())) setCreateHomologado(true)
    if (!createCalibre.trim() && (it as any).calibre) setCreateCalibre(String((it as any).calibre))
    if (!createPrecoCusto.trim() && (it as any).precoCusto) setCreatePrecoCusto(String((it as any).precoCusto))
    if (!createPolicyTouched) {
      const policy = getPolicyForItem(it)
      setCreateCategoriaRequiresLot(!!policy.requiresLot)
      setCreateCategoriaRequiresExpiry(!!policy.requiresExpiry)
      setCreateCategoriaFefo(!!policy.fefo)
    }
  }, [
    createCalibre,
    createCategoria,
    createConcentracao,
    createEspecificacao,
    createHomologado,
    createMarca,
    createPolicyTouched,
    createPrecoCusto,
    createProduto,
    createTipoUnidade,
    createVolume,
    getPolicyForItem,
    normalizeTipoUnidadeToCanonical
  ])

  React.useEffect(() => {
    if (!createOpen) return
    if (!canUseApi || !isAuthed) return
    const codigo = createCodigo.trim()
    if (!codigo) {
      setCreateLookupLoading(false)
      setCreateLookupError(null)
      setCreateLookupItems([])
      return
    }
    const token = ++createLookupTokenRef.current
    setCreateLookupLoading(true)
    setCreateLookupError(null)
    const t = window.setTimeout(() => {
      void (async () => {
        try {
          const items = await lookupInsumosByCodigo({ codigoBarras: codigo, ctxUnidade: unidade })
          if (token !== createLookupTokenRef.current) return
          setCreateLookupItems(items)
          if (!items.length) setCreateLookupError('Nenhum insumo encontrado para este código.')
          createLookupApplyPrefill(items)
	        } catch (e: any) {
	          if (token !== createLookupTokenRef.current) return
	          setCreateLookupError(e?.message || 'Falha ao buscar o insumo.')
	          setCreateLookupItems([])
	        } finally {
	          if (token === createLookupTokenRef.current) setCreateLookupLoading(false)
	        }
	      })()
	    }, 250)
    return () => window.clearTimeout(t)
  }, [canUseApi, createCodigo, createLookupApplyPrefill, createOpen, isAuthed, lookupInsumosByCodigo, unidade])

  React.useEffect(() => {
    if (!quickOp) return
    if (!(quickOp === 'BAIXA' || quickOp === 'TRANSFERENCIA')) return
    if (!quickAutoFefo) return
    const policy = getPolicyForItem(quickLookupItems?.[0] || null)
    if (!policy.fefo) return
    if (!quickLotes.length) return
    const suggested = quickLotes[0]?.registro
    if (!suggested) return
    setQuickRegistro((cur) => (cur ? cur : suggested))
  }, [getPolicyForItem, quickAutoFefo, quickLotes.map((l) => l.registro).join('|'), quickLookupItems?.[0], quickOp])

  const persistShareHistory = React.useCallback(
    (next: ShareHistoryItem[]) => {
      setShareHistory(next)
      try {
        localStorage.setItem(SHARE_HISTORY_KEY, JSON.stringify(next))
      } catch {
        // ignore
      }
    },
    [SHARE_HISTORY_KEY]
  )

  const loadShareHistory = React.useCallback(async () => {
    if (!canUseApi || !isAuthed) return
    setShareHistoryLoading(true)
    try {
      const out = await apiJson<{ success?: boolean; data?: ShareHistoryItem[] }>(`/share/history?limit=12`)
      if (Array.isArray(out?.data)) {
        const normalized = out.data.map((item) => ({
          ...item,
          files: Array.isArray(item.files) ? item.files : []
        }))
        persistShareHistory(normalized)
      }
    } catch {
      // ignore
    } finally {
      setShareHistoryLoading(false)
    }
  }, [apiJson, canUseApi, isAuthed, persistShareHistory])

  const loadCategoryPolicies = React.useCallback(async () => {
    if (!canUseApi || !isAuthed) return
    setCategoryPoliciesLoading(true)
    try {
      const out = await apiJson<{ success?: boolean; data?: CategoryPolicy[] }>(`/categorias/policies`)
      const list = Array.isArray(out?.data) ? out.data : []
      setCategoryPolicies(
        list
          .map((p) => ({
            slug: String((p as any)?.slug || '').trim(),
            label: (p as any)?.label ? String((p as any).label) : '',
            requiresLot: !!(p as any)?.requiresLot,
            requiresExpiry: !!(p as any)?.requiresExpiry,
            fefo: !!(p as any)?.fefo,
            createdAt: (p as any)?.createdAt ?? null,
            updatedAt: (p as any)?.updatedAt ?? null
          }))
          .filter((p) => p.slug)
      )
    } catch {
      setCategoryPolicies([])
    } finally {
      setCategoryPoliciesLoading(false)
    }
  }, [apiJson, canUseApi, isAuthed])

  const loadInsumosOptions = React.useCallback(async () => {
    if (!canUseApi || !isAuthed) return
    let categorias: string[] = []
    let marcas: string[] = []
    try {
      const out = await apiJson<{ success?: boolean; data?: { categorias?: string[]; marcas?: string[] } }>(`/insumos/options?limit=300`)
      categorias = uniqueSortedTextOptions(Array.isArray(out?.data?.categorias) ? out!.data!.categorias! : [])
      marcas = uniqueSortedTextOptions(Array.isArray(out?.data?.marcas) ? out!.data!.marcas! : [])
    } catch {
      // fallback below
    }

    if (!categorias.length && !marcas.length) {
      try {
        const fallback = await apiJson<{ success?: boolean; data?: Insumo[] }>(`/insumos?pagina=1&limite=1000`)
        const items = Array.isArray(fallback?.data) ? fallback.data : []
        categorias = uniqueSortedTextOptions(items.map((item) => String(item?.categoria || '').trim()))
        marcas = uniqueSortedTextOptions(items.map((item) => String(item?.marca || '').trim()))
      } catch {
        // fallback below
      }
    }

    if (!categorias.length) {
      categorias = uniqueSortedTextOptions([
        ...((insumosRef.current || []).map((item) => String(item?.categoria || '').trim())),
        ...((categoryPolicies || []).map((policy) => String(policy?.label || '').trim()))
      ])
    }
    if (!marcas.length) {
      marcas = uniqueSortedTextOptions((insumosRef.current || []).map((item) => String(item?.marca || '').trim()))
    }

    if (categorias.length) setInsumosOptionsCategorias(categorias)
    if (marcas.length) setInsumosOptionsMarcas(marcas)
    if (categorias.length || marcas.length) persistInsumosOptionsCache(categorias, marcas)
  }, [apiJson, canUseApi, isAuthed, categoryPolicies, persistInsumosOptionsCache])

  const loadAdminCategoryPolicies = React.useCallback(
    async (opts?: { includeSuggestions?: boolean }) => {
      if (!canUseApi || !isAuthed || !isManagerRole) return
      const includeSuggestions = opts?.includeSuggestions !== false
      setAdminCategoryPoliciesLoading(true)
      try {
        const out = await apiJson<{ success?: boolean; data?: CategoryPolicy[]; suggestions?: CategoryPolicySuggestion[] }>(
          `/admin/categories?includeSuggestions=${includeSuggestions ? 'true' : 'false'}`
        )
        setAdminCategoryPolicies(
          (Array.isArray(out?.data) ? out.data : [])
            .map((p) => ({
              slug: String((p as any)?.slug || '').trim(),
              label: (p as any)?.label ? String((p as any).label) : '',
              requiresLot: !!(p as any)?.requiresLot,
              requiresExpiry: !!(p as any)?.requiresExpiry,
              fefo: !!(p as any)?.fefo,
              createdAt: (p as any)?.createdAt ?? null,
              updatedAt: (p as any)?.updatedAt ?? null
            }))
            .filter((p) => p.slug)
        )
        setAdminCategorySuggestions(
          (Array.isArray(out?.suggestions) ? out.suggestions : [])
            .map((s) => ({ slug: String((s as any)?.slug || '').trim(), label: String((s as any)?.label || '').trim() }))
            .filter((s) => s.slug && s.label)
        )
      } catch {
        setAdminCategoryPolicies([])
        setAdminCategorySuggestions([])
      } finally {
        setAdminCategoryPoliciesLoading(false)
      }
    },
    [apiJson, canUseApi, isAuthed, isManagerRole]
  )

  React.useEffect(() => {
    try {
      const raw = localStorage.getItem(SHARE_HISTORY_KEY)
      if (!raw) return
      const parsed = JSON.parse(raw) as ShareHistoryItem[]
      if (Array.isArray(parsed)) setShareHistory(parsed)
    } catch {
      // ignore
    }
  }, [SHARE_HISTORY_KEY])

  React.useEffect(() => {
    if (!canUseApi || !isAuthed) return
    void loadCategoryPolicies()
  }, [canUseApi, isAuthed, loadCategoryPolicies])

  React.useEffect(() => {
    const cached = readInsumosOptionsCache()
    if (cached.categorias.length) setInsumosOptionsCategorias(cached.categorias)
    if (cached.marcas.length) setInsumosOptionsMarcas(cached.marcas)
  }, [readInsumosOptionsCache])

  React.useEffect(() => {
    if (!canUseApi || !isAuthed) return
    void loadInsumosOptions()
  }, [canUseApi, isAuthed, loadInsumosOptions])

  React.useEffect(() => {
    if (!canUseApi || !isAuthed || !isManagerRole) return
    void loadAdminCategoryPolicies({ includeSuggestions: true })
  }, [canUseApi, isAuthed, isManagerRole, loadAdminCategoryPolicies])


  React.useEffect(() => {
    const mapTab = (raw: string | null): 'overview' | 'insumos' | 'mov' | null => {
      const value = String(raw || '')
        .trim()
        .toLowerCase()
      if (!value) return null
      if (['overview', 'resumo', 'dashboard'].includes(value)) return 'overview'
      if (['insumos', 'cadastro', 'cadastrar', 'novo'].includes(value)) return 'insumos'
      if (['lotes', 'validade', 'lotes-validade'].includes(value)) return 'overview'
      if (['mov', 'movimentacoes', 'historico', 'histórico'].includes(value)) return 'mov'
      if (['alertas', 'avisos'].includes(value)) return 'overview'
      if (['insights'].includes(value)) return 'overview'
      return null
    }

    const mapActionLabel = (raw: string) => {
      const value = raw.toLowerCase()
      if (['entrada', 'in', 'add'].includes(value)) return 'Entrada'
      if (['saida', 'saída', 'baixa', 'out', 'remove'].includes(value)) return 'Saída'
      if (['ajuste', 'ajustar'].includes(value)) return 'Ajuste'
      if (['transferir', 'transferencia', 'transferência'].includes(value)) return 'Transferência'
      if (['scanner', 'scan', 'escanear'].includes(value)) return 'Scanner'
      if (['cadastro', 'cadastrar', 'novo'].includes(value)) return 'Cadastro'
      return null
    }

    try {
      const params = new URLSearchParams(window.location.search)
	      const requestedTab = mapTab(params.get('insumosTab') || params.get('view') || params.get('page') || params.get('insumos'))
	      if (requestedTab) {
	        setTimeout(() => {
	          if (requestedTab === 'overview') overviewSectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
	          else if (requestedTab === 'insumos') setInsumosListModalOpen(true)
	          else if (requestedTab === 'mov') movSectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
	        }, 250)
	      }

      const action = String(
        params.get('insumosAction') || params.get('action') || params.get('type') || params.get('tipo') || ''
      ).trim()
      const actionLabel = action ? mapActionLabel(action) : null
      const wantsCadastro = params.get('cadastro') === '1' || actionLabel === 'Cadastro'
      const wantsScanner = params.get('scanner') === '1' || actionLabel === 'Scanner'
      const wantsQuickAction = ['Entrada', 'Saída', 'Ajuste', 'Transferência'].includes(actionLabel || '')

	      if (wantsCadastro) {
	        setCreateOpen(true)
	        setInsumosListModalOpen(true)
	      }

      if (wantsScanner) {
        setQuickScanOpen(true)
      }

      if (wantsQuickAction) {
        if (actionLabel === 'Entrada') openQuickOperation('ENTRADA')
        else if (actionLabel === 'Saída') openQuickOperation('BAIXA')
        else if (actionLabel === 'Transferência') openQuickOperation('TRANSFERENCIA')
        setTimeout(() => {
          window.scrollTo({ top: 0, behavior: 'smooth' })
        }, 250)
      }

      const shareId = params.get('shareId') || ''
      const shareTitle = params.get('shareTitle') || ''
      const shareText = params.get('shareText') || ''
      const shareUrl = params.get('shareUrl') || ''
      const shareFilesRaw = params.get('shareFiles') || ''
      const shareFiles = shareFilesRaw
        ? shareFilesRaw
          .split(',')
          .map((item) => item.trim())
          .filter(Boolean)
        : []
      const hasShare = Boolean(shareId || shareTitle || shareText || shareUrl || shareFiles.length)

	      const applySharePayload = (payload: SharePayload, sourceId?: string) => {
	        setSharePayload(payload)
	        setShareSourceId(sourceId || null)
	        setShareHidden(false)
	        setCreateOpen(true)
	        setInsumosListModalOpen(true)
	        if (payload.title) setCreateProduto((prev) => (prev ? prev : payload.title || ''))
	        if (payload.text) setCreateEspecificacao((prev) => (prev ? prev : payload.text || ''))
	        if (payload.url) setCreateEspecificacao((prev) => (prev ? prev : payload.url || ''))
	        if (payload.files && payload.files.length) {
	          const filesSummary = `Arquivos: ${payload.files.map((f) => f.name).join(', ')}`
	          setCreateEspecificacao((prev) => (prev ? prev : filesSummary))
	        }
	      }

      if (shareId) {
        setShareLoading(true)
        void (async () => {
          try {
            const data = await apiJson<SharePayload>(`/share/${encodeURIComponent(shareId)}`)
            const files = (data.files || []).map((f) => ({
              ...f,
              url:
                f.url ||
                (f.name
                  ? `/api/insumos/share/${encodeURIComponent(shareId)}?file=${encodeURIComponent(f.name)}`
                  : undefined)
            }))
            applySharePayload({ ...data, files }, shareId)
          } catch {
            if (shareTitle || shareText || shareUrl || shareFiles.length) {
              applySharePayload({
                title: shareTitle || undefined,
                text: shareText || undefined,
                url: shareUrl || undefined,
                files: shareFiles.map((name) => ({ name }))
              }, shareId)
            }
          } finally {
            setShareLoading(false)
          }
        })()
      } else if (shareTitle || shareText || shareUrl || shareFiles.length) {
        applySharePayload({
          title: shareTitle || undefined,
          text: shareText || undefined,
          url: shareUrl || undefined,
          files: shareFiles.map((name) => ({ name }))
        }, shareId)
      }

      if (hasShare) {
        ;['shareId', 'shareTitle', 'shareText', 'shareUrl', 'shareFiles'].forEach((k) => params.delete(k))
        const next = `${window.location.pathname}${params.toString() ? `?${params.toString()}` : ''}${window.location.hash || ''}`
        window.history.replaceState({}, '', next)
      }
    } catch {
      // ignore
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const unidadeOptions = React.useMemo(() => {
    if (!allowedUnits.length) return allUnidades
    const filtered = allUnidades.filter((u) => allowedUnits.includes(u))
    return filtered.length ? filtered : allUnidades
  }, [allUnidades.join('|'), allowedUnits.join('|')])

  const unidadeLabel = React.useCallback((u: string) => {
    return String(u || '')
      .split('-')
      .filter(Boolean)
      .map((p) => p.charAt(0).toUpperCase() + p.slice(1))
      .join(' ')
  }, [])

	  const applyShareToForm = React.useCallback((payload: SharePayload & { id?: string }) => {
	    setCreateOpen(true)
	    setSharePayload(payload)
	    setShareSourceId(payload.id || null)
	    setShareHidden(false)
	    setInsumosListModalOpen(true)
	    if (payload.title) setCreateProduto(payload.title)
	    if (payload.text) setCreateEspecificacao(payload.text)
	    if (payload.url) setCreateEspecificacao(payload.url)
	    if (payload.files && payload.files.length) {
	      const filesSummary = `Arquivos: ${payload.files.map((f) => f.name).join(', ')}`
	      setCreateEspecificacao((prev) => (prev ? prev : filesSummary))
	    }
	  }, [])

  React.useEffect(() => {
    try {
      window.localStorage.setItem(INSUMOS_UNIT_KEY, unidade)
    } catch {
      // ignore
    }
  }, [INSUMOS_UNIT_KEY, unidade])

  React.useEffect(() => {
    const onUnit = (evt: Event) => {
      const next = String((evt as any)?.detail?.unidade || '').trim()
      if (!next) return
      setUnidade(next)
    }
    window.addEventListener('skincos:insumos:unidade', onUnit as any)
    return () => window.removeEventListener('skincos:insumos:unidade', onUnit as any)
  }, [])

  React.useEffect(() => {
    if (!allowedUnits.length) return
    if (allowedUnits.includes(unidade)) return
    const next = allowedUnits[0]
    setUnidade(next)
    try {
      window.localStorage.setItem(INSUMOS_UNIT_KEY, next)
    } catch {
      // ignore
    }
    try {
      window.dispatchEvent(new CustomEvent('skincos:insumos:unidade', { detail: { unidade: next } }))
    } catch {
      // ignore
    }
  }, [allowedUnits.join('|'), unidade])

  React.useEffect(() => {
    const allowed = allUnidades || []
    if (!allowed.length) return
    if (allowed.includes(unidade)) return
    const next = allowed[0]
    if (!next) return
    setUnidade(next)
    try {
      window.localStorage.setItem(INSUMOS_UNIT_KEY, next)
    } catch {
      // ignore
    }
    try {
      window.dispatchEvent(new CustomEvent('skincos:insumos:unidade', { detail: { unidade: next } }))
    } catch {
      // ignore
    }
  }, [INSUMOS_UNIT_KEY, allUnidades.join('|'), unidade])

  React.useEffect(() => {
    setTransferFrom(unidade)
    setTransferTo((prev) => {
      const candidates = unidadeOptions.filter((u) => u !== unidade)
      if (!candidates.length) return unidade
      if (prev && prev !== unidade && candidates.includes(prev)) return prev
      return candidates[0]
    })
  }, [unidade, unidadeOptions.join('|')])

  const refreshCsrf = React.useCallback(async () => {
    try {
      const out = await apiJson<{ success?: boolean; user?: InsumosUser; csrfToken?: string }>('/auth/refresh', { method: 'POST' })
      const next = out?.csrfToken || null
      setCsrfToken(next)
      if (out?.user) setUser(out.user)
      return next
    } catch {
      setCsrfToken(null)
      setUser(null)
      return null
    }
  }, [])

  const readOfflineQueue = React.useCallback((): OfflineQueueItem[] => {
    try {
      if (typeof window === 'undefined') return []
      const raw = window.localStorage.getItem(OFFLINE_QUEUE_KEY)
      const parsed = raw ? JSON.parse(raw) : []
      return Array.isArray(parsed) ? (parsed as OfflineQueueItem[]) : []
    } catch {
      return []
    }
  }, [])

  const writeOfflineQueue = React.useCallback((items: OfflineQueueItem[]) => {
    try {
      if (typeof window === 'undefined') return
      window.localStorage.setItem(OFFLINE_QUEUE_KEY, JSON.stringify(items))
    } catch {
      // ignore
    }
  }, [])

  const refreshOfflineQueueCount = React.useCallback(() => {
    const items = readOfflineQueue()
    setOfflineQueueCount(items.length)
    if (offlineDialogOpen) setOfflineItems(items)
  }, [offlineDialogOpen, readOfflineQueue])

  React.useEffect(() => {
    if (!offlineDialogOpen) return
    setOfflineItems(readOfflineQueue())
  }, [offlineDialogOpen, readOfflineQueue])

  const isNetworkError = (e: unknown) => {
    const msg = e instanceof Error ? e.message : String(e)
    return e instanceof TypeError || /Failed to fetch|NetworkError|fetch failed/i.test(msg)
  }

  const policyErrorToast = (e: unknown) => {
    const code = String((e as any)?.code || '').toUpperCase()
    if (code === 'POLICY_REQUIRES_LOT') {
      toast.error('Este item exige Lote. Abra o cadastro do item e preencha o lote.')
      return true
    }
    if (code === 'POLICY_REQUIRES_EXPIRY') {
      toast.error('Este item exige Data de validade. Abra o cadastro do item e preencha a validade.')
      return true
    }
    return false
  }

  const getPolicyErrorCode = (e: unknown): 'POLICY_REQUIRES_LOT' | 'POLICY_REQUIRES_EXPIRY' | null => {
    const code = String((e as any)?.code || '').toUpperCase()
    if (code === 'POLICY_REQUIRES_LOT') return 'POLICY_REQUIRES_LOT'
    if (code === 'POLICY_REQUIRES_EXPIRY') return 'POLICY_REQUIRES_EXPIRY'
    return null
  }

  const enqueueOffline = React.useCallback(
    (item: Omit<OfflineQueueItem, 'id' | 'ts'>) => {
      const queue = readOfflineQueue()
      const rec: OfflineQueueItem = { id: (globalThis.crypto?.randomUUID?.() as any) || String(Date.now()), ts: Date.now(), ...item }
      const next = [...queue, rec].slice(-200) // cap to avoid exploding localStorage
      writeOfflineQueue(next)
      setOfflineQueueCount(next.length)
      return rec
    },
    [readOfflineQueue, writeOfflineQueue]
  )

  const syncOfflineQueue = React.useCallback(async () => {
    if (!canUseApi || !isAuthed) return
    const queue = readOfflineQueue()
    if (!queue.length) return
    let remaining = [...queue]

    for (const item of queue) {
      try {
        await apiJson(item.path, {
          method: item.method,
          body: item.body,
          csrfToken,
          idempotencyKey: item.id,
          retryOnCsrf: refreshCsrf
        })
        remaining = remaining.filter((q) => q.id !== item.id)
        writeOfflineQueue(remaining)
        setOfflineQueueCount(remaining.length)
        if (offlineDialogOpen) setOfflineItems(remaining)
      } catch (e) {
        if (isNetworkError(e)) break
        toast.error(e instanceof Error ? e.message : String(e))
        break
      }
    }
  }, [canUseApi, csrfToken, isAuthed, offlineDialogOpen, readOfflineQueue, refreshCsrf, writeOfflineQueue])

  const mutateJson = React.useCallback(
    async <T,>(
      path: string,
      opts: { method?: string; body?: unknown; queueLabel?: string },
      extra?: { needsCsrf?: boolean }
    ): Promise<T | { queued: true }> => {
      const method = (opts.method || 'POST').toUpperCase()
      const idempotencyKey =
        method === 'GET'
          ? null
          : (globalThis.crypto?.randomUUID?.() as any) || `${Date.now()}-${Math.random().toString(16).slice(2)}`
      try {
        return await apiJson<T>(path, {
          method,
          body: opts.body,
          csrfToken: extra?.needsCsrf === false ? undefined : csrfToken,
          idempotencyKey,
          retryOnCsrf: extra?.needsCsrf === false ? undefined : refreshCsrf
        })
      } catch (e) {
        if (isNetworkError(e) && method !== 'GET') {
          const rec = enqueueOffline({ path, method, body: opts.body })
          toast.message(`${opts.queueLabel || 'Operação'} salva na fila offline.`)
          if (offlineDialogOpen) setOfflineItems((prev) => [...prev, rec])
          return { queued: true } as any
        }
        throw e
      }
    },
    [csrfToken, enqueueOffline, offlineDialogOpen, refreshCsrf]
  )

  React.useEffect(() => {
    if (policyFormSlugTouched) return
    setPolicyFormSlug(slugifyCategoria(policyFormLabel))
  }, [policyFormLabel, policyFormSlugTouched])

  const resetPolicyForm = React.useCallback(() => {
    setPolicyFormLabel('')
    setPolicyFormSlug('')
    setPolicyFormSlugTouched(false)
    setPolicyFormRequiresLot(false)
    setPolicyFormRequiresExpiry(false)
    setPolicyFormFefo(false)
    setPolicyFormEditingSlug(null)
    setPolicyFormSuggestion('__NONE__')
  }, [])

  const startEditPolicyForm = React.useCallback((p: CategoryPolicy) => {
    setPolicyFormLabel(String(p?.label || ''))
    setPolicyFormSlug(String(p?.slug || ''))
    setPolicyFormSlugTouched(true)
    setPolicyFormRequiresLot(!!p?.requiresLot)
    setPolicyFormRequiresExpiry(!!p?.requiresExpiry)
    setPolicyFormFefo(!!p?.fefo)
    setPolicyFormEditingSlug(String(p?.slug || '') || null)
    setPolicyFormSuggestion('__NONE__')
  }, [])

	  const saveCategoryPolicy = React.useCallback(async () => {
	    if (!isAuthed) {
	      toast.error('Faça login para salvar a política.')
	      return
	    }
	    if (!isManagerRole) {
	      toast.error('Somente gestores podem alterar políticas.')
	      return
	    }
	    if (!canUseApi) {
	      toast.error('API indisponível ou não pronta. Aguarde carregar e tente novamente.')
	      return
	    }
	    const label = String(policyFormLabel || '').trim()
	    const slugInput = String(policyFormSlug || '').trim()
	    const slug = slugifyCategoria(slugInput || label)
	    if (!slug) {
	      toast.error('Informe a categoria (nome)')
      return
    }
    const requiresLot = !!policyFormRequiresLot
    const requiresExpiry = !!policyFormRequiresExpiry
    const fefo = !!policyFormFefo
    if (fefo && !requiresExpiry) {
      toast.error('FEFO exige validade obrigatória')
      return
    }

    try {
      const out = await mutateJson<{ success?: boolean; data?: CategoryPolicy }>(
        '/admin/categories',
        {
          method: 'POST',
          queueLabel: 'Política por categoria',
          body: {
            slug,
            label,
            requiresLot,
            requiresExpiry,
            fefo
          }
        },
        { needsCsrf: true }
      )

      if ((out as any)?.queued) {
        toast.message('Mudança salva na fila offline.')
        resetPolicyForm()
        return
      }

      toast.success(policyFormEditingSlug ? 'Política atualizada.' : 'Política criada.')
      resetPolicyForm()
      await Promise.allSettled([loadAdminCategoryPolicies({ includeSuggestions: true }), loadCategoryPolicies()])
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e))
    }
	  }, [
	    canUseApi,
	    isAuthed,
	    isManagerRole,
	    loadAdminCategoryPolicies,
	    loadCategoryPolicies,
	    mutateJson,
    policyFormEditingSlug,
    policyFormFefo,
    policyFormLabel,
    policyFormRequiresExpiry,
    policyFormRequiresLot,
    policyFormSlug,
    resetPolicyForm
  ])

	  const deleteCategoryPolicy = React.useCallback(
	    async (slugRaw: string) => {
	      if (!isAuthed) {
	        toast.error('Faça login para excluir a política.')
	        return
	      }
	      if (!isManagerRole) {
	        toast.error('Somente gestores podem excluir políticas.')
	        return
	      }
	      if (!canUseApi) {
	        toast.error('API indisponível ou não pronta. Aguarde carregar e tente novamente.')
	        return
	      }
	      const slug = String(slugRaw || '').trim()
	      if (!slug) return
      const ok = window.confirm(`Remover política da categoria "${slug}"?`)
      if (!ok) return

      try {
        const out = await mutateJson<{ success?: boolean }>(
          `/admin/categories/${encodeURIComponent(slug)}`,
          { method: 'DELETE', queueLabel: 'Política por categoria' },
          { needsCsrf: true }
        )
        if ((out as any)?.queued) {
          setAdminCategoryPolicies((prev) => prev.filter((p) => String(p?.slug || '') !== slug))
          toast.message('Remoção salva na fila offline.')
          return
        }

        toast.success('Política removida.')
        if (policyFormEditingSlug === slug) resetPolicyForm()
        await Promise.allSettled([loadAdminCategoryPolicies({ includeSuggestions: true }), loadCategoryPolicies()])
      } catch (e) {
        toast.error(e instanceof Error ? e.message : String(e))
      }
    },
	    [
	      canUseApi,
	      isAuthed,
	      isManagerRole,
	      loadAdminCategoryPolicies,
	      loadCategoryPolicies,
      mutateJson,
      policyFormEditingSlug,
      resetPolicyForm
    ]
  )

  const removeShareHistory = React.useCallback(
    (id: string) => {
      const next = shareHistory.filter((item) => item.id !== id)
      persistShareHistory(next)
      if (canUseApi && isAuthed) {
        void mutateJson(`/share/history/${encodeURIComponent(id)}`, {
          method: 'DELETE',
          queueLabel: 'Importações recentes (remover)'
        })
      }
    },
    [canUseApi, isAuthed, mutateJson, persistShareHistory, shareHistory]
  )

  const clearShareHistory = React.useCallback(() => {
    persistShareHistory([])
    if (canUseApi && isAuthed && shareHistory.length) {
      for (const item of shareHistory) {
        void mutateJson(`/share/history/${encodeURIComponent(item.id)}`, {
          method: 'DELETE',
          queueLabel: 'Importações recentes (remover)'
        })
      }
    }
  }, [canUseApi, isAuthed, mutateJson, persistShareHistory, shareHistory])

  React.useEffect(() => {
    if (!sharePayload) return
    const baseId = shareSourceId || `local-${Date.now()}`
    if (shareLoggedRef.current === baseId) return
    if (shareHistory.some((item) => item.id === baseId)) return
    shareLoggedRef.current = baseId
    const item: ShareHistoryItem = {
      id: baseId,
      createdAt: new Date().toISOString(),
      ...sharePayload
    }
    const next = [item, ...shareHistory].slice(0, 12)
    persistShareHistory(next)
  }, [persistShareHistory, shareHistory, sharePayload, shareSourceId])

  React.useEffect(() => {
    if (!sharePayload || !canUseApi || !isAuthed) return
    const baseId = shareSourceId || shareLoggedRef.current
    if (!baseId) return
    if (shareSyncedRef.current.has(baseId)) return
    shareSyncedRef.current.add(baseId)

    const files = (sharePayload.files || []).map((f) => ({
      name: f.name,
      size: f.size,
      contentType: f.contentType,
      url: f.url
    }))
    const sourceId = shareSourceId && !shareSourceId.startsWith('local-') ? shareSourceId : undefined
    void mutateJson('/share/history', {
      method: 'POST',
      queueLabel: 'Importações recentes',
      body: {
        id: baseId,
        createdAt: new Date().toISOString(),
        title: sharePayload.title || '',
        text: sharePayload.text || '',
        url: sharePayload.url || '',
        files,
        sourceId
      }
    }).then(() => {
      void loadShareHistory()
    })
  }, [canUseApi, isAuthed, loadShareHistory, mutateJson, sharePayload, shareSourceId])

  React.useEffect(() => {
    refreshOfflineQueueCount()
    const onOnline = () => {
      void syncOfflineQueue()
    }
    window.addEventListener('online', onOnline)
    return () => window.removeEventListener('online', onOnline)
  }, [refreshOfflineQueueCount, syncOfflineQueue])

  const loadHealth = React.useCallback(async () => {
    setHealthLoading(true)
    setError(null)
    try {
      const data = await apiJson<InsumosHealth>('/health')
      setHealth(data || null)
    } catch (e) {
      setHealth(null)
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setHealthLoaded(true)
      setHealthLoading(false)
    }
  }, [])

  const loadMe = React.useCallback(async () => {
    setAuthLoading(true)
    try {
      const out = await apiJson<{ success?: boolean; user?: InsumosUser; csrfToken?: string }>('/auth/me')
      setUser(out?.user || null)
      setCsrfToken(out?.csrfToken || null)
    } catch {
      setUser(null)
      setCsrfToken(null)
    } finally {
      setAuthLoaded(true)
      setAuthLoading(false)
    }
  }, [])

  const loadProxyStatus = React.useCallback(async () => {
    try {
      const out = await apiJson<InsumosProxyStatus>('/_proxy-status')
      setProxyStatus(out || null)
    } catch {
      setProxyStatus(null)
    }
  }, [])

  const openLotDialog = React.useCallback((i: Insumo) => {
    setLotSelecionado(i)
    setLotEditLote(String(i.lote || ''))
    setLotEditValidade(i.dataValidade ? fmtDateOnlyBR(i.dataValidade) : '')
    setLotDialogOpen(true)
  }, [])

  const openEditDialog = React.useCallback((i: Insumo) => {
    setEditTarget(i)
    setEditValidationErrors({})
    setEditSaveError(null)
    const primary = String(i.codigoBarras || '')
    setEditCodigo(primary)
    const extras = getInsumoBarcodes(i).filter((code) => code !== primary)
    setEditCodigosExtras(extras.join('\n'))
    setEditProduto(String(i.produto || ''))
    setEditCategoria(String(i.categoria || ''))
    setEditMarca(String(i.marca || ''))
    setEditTipoUnidade(String(i.tipoUnidade || ''))
    setEditEspecificacao(String(i.especificacao || ''))
    setEditConcentracao(String(i.concentracao || ''))
    setEditVolume(String(i.volume || ''))
    setEditHomologado(/homologad/i.test(String(i.fonte || '').trim()))
    setEditCalibre(String(i.calibre || ''))
    setEditPrecoCusto(i.precoCusto != null ? String(i.precoCusto) : '')
    setEditEstoqueMinimo(i.estoqueMinimo != null ? String(i.estoqueMinimo) : '')
    setEditLote(String(i.lote || ''))
    setEditDataValidade(i.dataValidade ? fmtDateOnlyBR(i.dataValidade) : '')
    const policy = getPolicyForItem(i)
    setEditCategoriaRequiresLot(!!policy.requiresLot)
    setEditCategoriaRequiresExpiry(!!policy.requiresExpiry)
    setEditCategoriaFefo(!!policy.fefo)
    setEditOpen(true)
  }, [getPolicyForItem])

  const openQualityFix = React.useCallback(
    async (issue: QualityIssue) => {
      if (!isAuthed) {
        toast.error('Faça login para editar.')
        return
      }
      const registro = String(issue?.registro || '').trim()
      const codigo = String(issue?.codigoBarras || '').trim()
      const issueCode = String(issue?.code || '').trim().toUpperCase()
      const issueUnit = String(issue?.unidade || '').trim()
      if (!registro && !codigo) {
        toast.error('Ocorrência sem referência de insumo para edição rápida.')
        return
      }
      if (issueUnit && issueUnit !== unidade) {
        setUnidade(issueUnit)
      }

      if (issueCode === 'DUPLICATE_BARCODE' && codigo) {
        try {
          const items = await lookupInsumosByCodigo({ codigoBarras: codigo, ctxUnidade: issueUnit || unidade })
          const byRegistro = new Map<string, Insumo>()
          for (const item of items || []) {
            const itemRegistro = String(item?.registro || '').trim()
            if (!itemRegistro || byRegistro.has(itemRegistro)) continue
            byRegistro.set(itemRegistro, item)
          }
          const matches = Array.from(byRegistro.values())
          if (matches.length > 1) {
            setQualityMatchesIssue(issue)
            setQualityMatchesItems(matches)
            setQualityMatchesOpen(true)
            return
          }
          if (matches.length === 1) {
            openEditDialog(matches[0])
            return
          }
          toast.error('Nenhuma correspondência encontrada para o código duplicado.')
          return
        } catch (e: any) {
          toast.error(e?.message || 'Falha ao buscar duplicidades para edição.')
          return
        }
      }
      if (registro) {
        const foundByRegistro = (insumosRef.current || []).find(
          (i) => String(i?.registro || '').trim() === registro
        )
        if (foundByRegistro) {
          openEditDialog(foundByRegistro)
          return
        }
      }

      if (codigo) {
        const foundByCodigo = (insumosRef.current || []).find(
          (i) => String(i?.codigoBarras || '').trim() === codigo
        )
        if (foundByCodigo) {
          openEditDialog(foundByCodigo)
          return
        }
        try {
          const items = await lookupInsumosByCodigo({ codigoBarras: codigo, ctxUnidade: issueUnit || unidade })
          if (items?.length) {
            openEditDialog(items[0])
            return
          }
        } catch (e: any) {
          toast.error(e?.message || 'Falha ao buscar insumo para edição.')
          return
        }
      }

      toast.error('Insumo não encontrado para edição rápida.')
    },
    [isAuthed, lookupInsumosByCodigo, openEditDialog, unidade]
  )

  const loadInsumosPaged = React.useCallback(
    async (opts?: { pagina?: number; limite?: number; q?: string; append?: boolean }): Promise<number | null> => {
      if (!canUseApi || !isAuthed) return null
      const pagina = Math.max(1, opts?.pagina ?? insumosPagina)
      const limite = Math.max(1, Math.min(1000, opts?.limite ?? insumosLimite))
      const q = String(opts?.q ?? insumosQuery).trim()
      const append = opts?.append === true
      const isInitialLoad = pagina === 1 && !append

      setInsumosLoading(true)
      try {
        const params = new URLSearchParams()
        params.set('unidade', unidade)
        params.set('pagina', String(pagina))
        params.set('limite', String(limite))
        if (q) params.set('q', q)
        const out = await apiJson<{ success?: boolean; data?: Insumo[]; resumo?: any }>(`/insumos?${params.toString()}`)
        const items = Array.isArray(out?.data) ? out.data : []
        const total = Number(out?.resumo?.total)
        const totalOut = Number.isFinite(total) ? total : null
          const merged = (() => {
          if (!append) return items
          const byRegistro = new Map<string, Insumo>()
          for (const it of insumosRef.current || []) {
            const key = String((it as any)?.registro || '').trim()
            if (key) byRegistro.set(key, it)
          }
          for (const it of items) {
            const key = String((it as any)?.registro || '').trim()
            if (!key) continue
            if (!byRegistro.has(key)) byRegistro.set(key, it)
          }
          return Array.from(byRegistro.values())
        })()
        setInsumos(merged)
        const mergedCount = merged.length
        setInsumosTotal(totalOut)
        setInsumosHasMore(totalOut != null ? mergedCount < totalOut : items.length >= limite)
        setInsumosPagina(pagina)
        setInsumosLimite(limite)
        setInsumosLoadError(null)
        return totalOut
      } catch (e) {
        toast.error(e instanceof Error ? e.message : String(e))
        setInsumosLoadError({
          message: e instanceof Error ? e.message : String(e),
          status: Number((e as any)?.status || 0) || 0,
          code: (e as any)?.code ? String((e as any).code) : undefined
        })
        setInsumos([])
        setInsumosTotal(null)
        setInsumosHasMore(false)
        return null
      } finally {
        if (isInitialLoad) setInsumosLoaded(true)
        setInsumosLoading(false)
      }
    },
    [canUseApi, insumosLimite, insumosPagina, insumosQuery, isAuthed, unidade]
  )

  const insumosListContainerRef = React.useRef<HTMLDivElement | null>(null)

  const refreshInsumos = React.useCallback(
    async (opts?: { pagina?: number }) => {
      if (!canUseApi || !isAuthed) return
      const pagina = Math.max(1, opts?.pagina ?? 1)
      const q = insumosQuery.trim()
      await loadInsumosPaged({ pagina, limite: insumosLimite, q, append: false })
      if (pagina === 1) {
        try {
          insumosListContainerRef.current?.scrollTo?.({ top: 0 })
        } catch {
          // ignore
        }
      }
    },
    [canUseApi, insumosLimite, insumosQuery, isAuthed, loadInsumosPaged]
  )

  const loadMoreInsumos = React.useCallback(() => {
    if (!canUseApi || !isAuthed) return
    if (insumosLoading) return
    if (!insumosHasMore) return
    void loadInsumosPaged({ pagina: insumosPagina + 1, limite: insumosLimite, q: insumosQuery.trim(), append: true })
  }, [canUseApi, insumosHasMore, insumosLimite, insumosLoading, insumosPagina, insumosQuery, isAuthed, loadInsumosPaged])

  const onInsumosScroll = React.useCallback(
    (e: React.UIEvent<HTMLDivElement>) => {
      const el = e.currentTarget
      const remaining = el.scrollHeight - el.scrollTop - el.clientHeight
      if (remaining < 220) loadMoreInsumos()
    },
    [loadMoreInsumos]
  )

  const [insumosListModalOpen, setInsumosListModalOpen] = React.useState(false)
  const insumosModalListContainerRef = React.useRef<HTMLDivElement | null>(null)
  const onInsumosModalScroll = React.useCallback(
    (e: React.UIEvent<HTMLDivElement>) => {
      const el = e.currentTarget
      const remaining = el.scrollHeight - el.scrollTop - el.clientHeight
      if (remaining < 220) loadMoreInsumos()
    },
    [loadMoreInsumos]
  )

  const openInsumosListModal = React.useCallback(
    (opts?: { codigoBarras?: string }) => {
      const code = String(opts?.codigoBarras || '').trim()
      if (code) setInsumosQuery(code)
      setInsumosListModalOpen(true)
    },
    []
  )

  React.useEffect(() => {
    const el = insumosListContainerRef.current
    if (!el) return
    if (!insumosHasMore || insumosLoading) return
    if (el.scrollHeight <= el.clientHeight + 80) loadMoreInsumos()
  }, [insumosHasMore, insumosLoading, insumos.length, loadMoreInsumos])

  React.useEffect(() => {
    const el = insumosModalListContainerRef.current
    if (!el) return
    if (!insumosHasMore || insumosLoading) return
    if (el.scrollHeight <= el.clientHeight + 80) loadMoreInsumos()
  }, [insumosHasMore, insumosLoading, insumos.length, loadMoreInsumos, insumosListModalOpen])

  const loadMovimentacoes = React.useCallback(async (opts?: { pagina?: number; limite?: number; append?: boolean }) => {
    if (!canUseApi || !isAuthed) return
    setMovLoading(true)
    try {
      const append = opts?.append === true
      const pagina = Math.max(1, opts?.pagina ?? (append ? movPagina + 1 : 1))
      const limite = Math.max(1, Math.min(200, opts?.limite ?? movLimite))
      const params = new URLSearchParams()
      params.set('unidade', unidade)
      params.set('limite', String(limite))
      params.set('pagina', String(pagina))
      if (movTipo !== 'TODOS') params.set('tipo', movTipo)
      const codigo = selectedCodigoBarras.trim()
      if (codigo) params.set('codigoBarras', codigo)
      const deIso = dateInputToIso(movDe)
      const ateIso = dateInputToIso(movAte)
      if (deIso) params.set('de', deIso)
      if (ateIso) params.set('ate', ateIso)
      const out = await apiJson<{ success?: boolean; data?: Movimentacao[]; movimentos?: Movimentacao[]; resumo?: any }>(
        `/movimentacoes?${params.toString()}`
      )
      const list = (out as any)?.movimentos ?? out?.data
      const items = Array.isArray(list) ? list : []
      const merged = append ? [...(movRef.current || []), ...items] : items
      setMovimentacoes(merged)
      const total = Number((out as any)?.resumo?.totalMovimentacoes)
      const totalOut = Number.isFinite(total) ? total : null
      setMovTotal(totalOut)
      setMovPagina(pagina)
      setMovLimite(limite)
      setMovHasMore(totalOut != null ? merged.length < totalOut : items.length >= limite)
      setMovLoadError(null)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e))
      setMovLoadError({
        message: e instanceof Error ? e.message : String(e),
        status: Number((e as any)?.status || 0) || 0,
        code: (e as any)?.code ? String((e as any).code) : undefined
      })
      setMovimentacoes([])
      setMovTotal(null)
      setMovHasMore(false)
    } finally {
      if (!opts?.append) setMovLoaded(true)
      setMovLoading(false)
    }
  }, [canUseApi, isAuthed, movAte, movDe, movLimite, movPagina, movTipo, selectedCodigoBarras, unidade])

  const loadMoreMovimentacoes = React.useCallback(() => {
    if (!canUseApi || !isAuthed) return
    if (movLoading) return
    if (!movHasMore) return
    void loadMovimentacoes({ append: true, limite: movLimite })
  }, [canUseApi, isAuthed, loadMovimentacoes, movHasMore, movLimite, movLoading])

  const onMovScroll = React.useCallback(
    (e: React.UIEvent<HTMLDivElement>) => {
      const el = e.currentTarget
      const remaining = el.scrollHeight - el.scrollTop - el.clientHeight
      if (remaining < 220) loadMoreMovimentacoes()
    },
    [loadMoreMovimentacoes]
  )

  React.useEffect(() => {
    const el = movListContainerRef.current
    if (!el) return
    if (!movHasMore || movLoading) return
    if (el.scrollHeight <= el.clientHeight + 80) loadMoreMovimentacoes()
  }, [loadMoreMovimentacoes, movHasMore, movLoading, movimentacoes.length])

  React.useEffect(() => {
    setMovPagina(1)
    try {
      movListContainerRef.current?.scrollTo?.({ top: 0 })
    } catch {
      // ignore
    }
  }, [unidade, movAte, movDe, movLimite, movTipo, selectedCodigoBarras, movFilterProduto, movFilterCategoria, movFilterMarca])

  React.useEffect(() => {
    if (!canUseApi || !isAuthed) return
    const deIso = movDe.trim() ? dateInputToIso(movDe) : ''
    const ateIso = movAte.trim() ? dateInputToIso(movAte) : ''
    if (movDe.trim() && !deIso) return
    if (movAte.trim() && !ateIso) return
    const t = window.setTimeout(() => {
      void loadMovimentacoes()
    }, 250)
    return () => window.clearTimeout(t)
  }, [canUseApi, isAuthed, loadMovimentacoes, movAte, movDe, movTipo, selectedCodigoBarras, unidade])

  const loadOverview = React.useCallback(async (opts?: { force?: boolean; lite?: boolean }) => {
    if (!canUseApi || !isAuthed) return
    // If the user triggered analytics loads (or they are visible), unlock subsequent auto-refreshes.
    setOverviewEverVisible(true)
    if (!opts?.force && autoSyncSuspendedUntil > Date.now()) return
    try {
      overviewAbortRef.current?.abort()
    } catch {
      // ignore
    }
    const ac = new AbortController()
    overviewAbortRef.current = ac
    setOverviewLoading(true)
    try {
      const now = new Date()
      const yyyyMmDd = (d: Date) => d.toISOString().slice(0, 10)
      let de = ''
      let ate = yyyyMmDd(now)
      let days = overviewPeriod === '7d' ? 7 : overviewPeriod === '30d' ? 30 : 365
      const isLite = opts?.lite !== false

      if (overviewPeriod === 'custom') {
        const deIso = dateInputToIso(overviewCustomFrom)
        const ateIso = dateInputToIso(overviewCustomTo)
        if (deIso && ateIso) {
          de = deIso
          ate = ateIso
          const fromMs = new Date(deIso).getTime()
          const toMs = new Date(ateIso).getTime()
          const diffDays = Math.max(1, Math.round((toMs - fromMs) / (1000 * 60 * 60 * 24)))
          days = Math.max(1, Math.min(365, diffDays))
        }
      }

      if (!de) {
        const start = new Date(now)
        if (overviewPeriod === '7d') start.setDate(start.getDate() - 7)
        else if (overviewPeriod === '30d') start.setDate(start.getDate() - 30)
        else start.setFullYear(start.getFullYear() - 1)
        de = yyyyMmDd(start)
      }

      const params = new URLSearchParams({
        unidade,
        de,
        ate,
        days: String(days),
        limitIssues: '120'
      })
      if (isLite) params.set('lite', '1')
      const out = await apiJson<{ success?: boolean; data?: OverviewBundleData }>(`/analytics/overview?${params.toString()}`, { signal: ac.signal })

      if (overviewAbortRef.current !== ac) return
      const data = out?.data || null
      setOverviewResumo(data?.resumo || null)
      if (Array.isArray(data?.itens)) {
        setOverviewInsumos(data?.itens as any)
      } else if (!isLite) {
        setOverviewInsumos(null)
      }
      setOverviewNotifications(data?.notifications || null)
      setOverviewActionables(data?.actionables || null)
      setOverviewRoi(data?.roi || null)
      setOverviewQuality(data?.quality || null)
      setOverviewMovResumo((data?.movResumo as any) || null)
      setOverviewMovSeries(
        Array.isArray(data?.movSeries)
          ? data.movSeries
              .map((item) => ({
                day: String(item?.day || ''),
                entrada: Number(item?.entrada ?? 0) || 0,
                saida: Number(item?.saida ?? 0) || 0,
                entradaValor: Number.isFinite(Number(item?.entradaValor)) ? Number(item?.entradaValor) : undefined,
                saidaValor: Number.isFinite(Number(item?.saidaValor)) ? Number(item?.saidaValor) : undefined
              }))
              .filter((item) => item.day)
          : []
      )
    } catch (e) {
      if ((e as any)?.name === 'AbortError') return
      if (overviewAbortRef.current !== ac) return
      markAutoSyncFailure(e)
      toast.error(e instanceof Error ? e.message : String(e))
      setOverviewResumo(null)
      setOverviewNotifications(null)
      setOverviewActionables(null)
      setOverviewRoi(null)
      setOverviewQuality(null)
      setOverviewMovResumo(null)
      setOverviewMovSeries([])
    } finally {
      if (overviewAbortRef.current === ac) {
        setOverviewLoaded(true)
        setOverviewLoading(false)
        overviewAbortRef.current = null
      }
    }
  }, [autoSyncSuspendedUntil, canUseApi, isAuthed, markAutoSyncFailure, overviewCustomFrom, overviewCustomTo, overviewPeriod, unidade])

  React.useEffect(() => {
    if (!canUseApi || !isAuthed) return
    if (!chartsPanelVisible || !chartsPanelOpen) return
    if (overviewInsumos && overviewInsumos.length) return
    if (overviewLoading) return
    if (autoSyncSuspendedUntil > Date.now()) return
    const now = Date.now()
    if (now - overviewFullAttemptRef.current < 15_000) return
    overviewFullAttemptRef.current = now
    void loadOverview({ force: true, lite: false })
  }, [
    autoSyncSuspendedUntil,
    canUseApi,
    chartsPanelOpen,
    chartsPanelVisible,
    isAuthed,
    loadOverview,
    overviewInsumos,
    overviewLoading
  ])

  const saveLot = React.useCallback(async () => {
    if (!lotSelecionado?.registro) {
      toast.error('Registro do insumo ausente.')
      return
    }
    if (!canUseApi || !isAuthed) return
    setLotSaving(true)
    try {
      const dataValidade = dateInputToIso(lotEditValidade)
      await mutateJson<{ success?: boolean }>(`/insumos/${encodeURIComponent(lotSelecionado.registro)}?unidade=${encodeURIComponent(unidade)}`, {
        method: 'PUT',
        body: { lote: lotEditLote.trim(), dataValidade },
        queueLabel: 'Atualização de lote/validade'
      })
      toast.success('Lote/validade atualizados.')
      setLotDialogOpen(false)
      await Promise.allSettled([refreshInsumos(), loadOverview({ force: true })])
    } catch (e) {
      if (policyErrorToast(e)) return
      toast.error(e instanceof Error ? e.message : String(e))
    } finally {
      setLotSaving(false)
    }
  }, [canUseApi, isAuthed, loadOverview, lotEditLote, lotEditValidade, lotSelecionado?.registro, mutateJson, refreshInsumos, unidade])

  const saveEdit = React.useCallback(async () => {
    const registro = String(editTarget?.registro || '').trim()
    if (!registro) {
      setEditSaveError('Registro do insumo ausente.')
      toast.error('Registro do insumo ausente.')
      return
    }
    if (!isAuthed) {
      setEditSaveError('Nao autenticado.')
      toast.error('Nao autenticado.')
      return
    }
    if (!canUseApi) {
      setEditSaveError('API indisponivel ou nao pronta. Aguarde carregar e tente novamente.')
      toast.error('API indisponivel ou nao pronta. Aguarde carregar e tente novamente.')
      return
    }
    const codigoBarras = editCodigo.trim()
    const extraCodes = parseBarcodeInput(editCodigosExtras)
    const codigosBarras = Array.from(new Set([codigoBarras, ...extraCodes].map((v) => String(v || '').trim()).filter(Boolean)))
    const produto = editProduto.trim()
    if (!codigoBarras) {
      setEditValidationErrors({ codigoBarras: 'Obrigatorio.' })
      setEditSaveError('Informe o código de barras para salvar.')
      return toast.error('Informe o código de barras')
    }
    if (!produto) {
      setEditValidationErrors({ produto: 'Obrigatorio.' })
      setEditSaveError('Informe o produto para salvar.')
      return toast.error('Informe o produto')
    }

    setEditSaving(true)
    try {
      setEditSaveError(null)
      setEditValidationErrors({})
      const categoria = editCategoria.trim()
      const policy = {
        requiresLot: !!editCategoriaRequiresLot,
        requiresExpiry: !!editCategoriaRequiresExpiry,
        fefo: !!editCategoriaFefo
      }
      const lote = editLote.trim()
      const dataValidade = dateInputToIso(editDataValidade)
      const tipoUnidade = normalizeTipoUnidadeToCanonical(editTipoUnidade)

      if (!tipoUnidade) {
        setEditValidationErrors({ tipoUnidade: 'Selecione a unidade (medida).' })
        setEditSaveError('Informe a unidade (medida) para salvar.')
        toast.error('Informe a unidade (medida) para salvar.')
        return
      }

      if (policy.fefo && !policy.requiresExpiry) {
        setEditValidationErrors({ policy: 'FEFO exige validade obrigatoria.' })
        setEditSaveError('FEFO exige validade obrigatoria.')
        toast.error('FEFO exige validade obrigatória')
        return
      }
      if (policy.requiresLot && !lote) {
        setEditValidationErrors({
          policy: 'Lote obrigatorio pela politica.',
          lote: 'Obrigatorio (pela politica do item).'
        })
        setEditSaveError('Este item exige Lote. Preencha o campo lote para salvar.')
        toast.error('Este item exige Lote. Preencha o campo lote para salvar.')
        return
      }
      if (policy.requiresExpiry && !dataValidade) {
        setEditValidationErrors({
          policy: 'Validade obrigatoria pela politica.',
          dataValidade: 'Obrigatorio (pela politica do item).'
        })
        setEditSaveError('Este item exige Data de validade. Preencha o campo validade para salvar.')
        toast.error('Este item exige Data de validade. Preencha o campo validade para salvar.')
        return
      }

      await mutateJson(`/insumos/${encodeURIComponent(registro)}?unidade=${encodeURIComponent(unidade)}`, {
        method: 'PUT',
        queueLabel: 'Edição de insumo',
        body: {
          codigoBarras,
          codigosBarras,
          produto,
          categoria,
          marca: editMarca.trim(),
          tipoUnidade,
          especificacao: editEspecificacao.trim(),
          concentracao: editConcentracao.trim(),
          volume: editVolume.trim(),
          fonte: editHomologado ? 'Homologado' : '',
          calibre: editCalibre.trim(),
          precoCusto: editPrecoCusto.trim(),
          estoqueMinimo: Number(editEstoqueMinimo) || 0,
          lote,
          dataValidade,
          policyRequiresLot: policy.requiresLot,
          policyRequiresExpiry: policy.requiresExpiry,
          policyFefo: policy.fefo
        }
      })
      toast.success('Insumo atualizado')
      setEditOpen(false)
      await Promise.allSettled([refreshInsumos({ pagina: 1 }), loadOverview({ force: true }), loadInsumosOptions()])
    } catch (e) {
      const policyCode = getPolicyErrorCode(e)
      if (policyCode) {
        setEditSaveError(e instanceof Error ? e.message : String(e))
        policyErrorToast(e)
        if (policyCode === 'POLICY_REQUIRES_LOT') {
          setEditValidationErrors({
            policy: 'Lote obrigatorio pela politica.',
            lote: 'Obrigatorio (pela politica do item).'
          })
        } else {
          setEditValidationErrors({
            policy: 'Validade obrigatoria pela politica.',
            dataValidade: 'Obrigatorio (pela politica do item).'
          })
        }
        return
      }
      setEditSaveError(e instanceof Error ? e.message : String(e))
      toast.error(e instanceof Error ? e.message : String(e))
    } finally {
      setEditSaving(false)
    }
  }, [
    canUseApi,
    clearEditValidationError,
    editCalibre,
    editCategoria,
    editCategoriaFefo,
    editCategoriaRequiresExpiry,
    editCategoriaRequiresLot,
    editCodigo,
    editConcentracao,
    editDataValidade,
    editEspecificacao,
    editEstoqueMinimo,
    editHomologado,
    editLote,
    editMarca,
    editPrecoCusto,
    editProduto,
    editTarget?.registro,
    editTipoUnidade,
    editVolume,
    isAuthed,
    loadInsumosOptions,
    loadOverview,
    mutateJson,
    refreshInsumos,
    getPolicyErrorCode,
    unidade
  ])

  const deleteEdit = React.useCallback(async () => {
    const registro = String(editTarget?.registro || '').trim()
    if (!registro) return
    if (!canUseApi || !isAuthed) return
    if (!window.confirm('Excluir este insumo? Esta ação não pode ser desfeita.')) return
    setEditSaving(true)
    try {
      await mutateJson(`/insumos/${encodeURIComponent(registro)}?unidade=${encodeURIComponent(unidade)}`, {
        method: 'DELETE',
        queueLabel: 'Exclusão de insumo'
      })
      toast.success('Insumo excluído')
      setEditOpen(false)
      await Promise.allSettled([refreshInsumos({ pagina: 1 }), loadOverview({ force: true }), loadInsumosOptions()])
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e))
    } finally {
      setEditSaving(false)
    }
  }, [canUseApi, editTarget?.registro, isAuthed, loadInsumosOptions, loadOverview, mutateJson, refreshInsumos, unidade])

  const deleteInsumoByRegistro = React.useCallback(
    async (registroRaw: string) => {
      const registro = String(registroRaw || '').trim()
      if (!registro || !canUseApi || !isAuthed) return
      if (!window.confirm('Excluir este insumo? Esta ação não pode ser desfeita.')) return
      setQualityMatchesSavingRegistro(registro)
      try {
        await mutateJson(`/insumos/${encodeURIComponent(registro)}?unidade=${encodeURIComponent(unidade)}`, {
          method: 'DELETE',
          queueLabel: 'Exclusão de insumo'
        })
        toast.success('Insumo excluído')
        setQualityMatchesItems((prev) => prev.filter((it) => String(it?.registro || '').trim() !== registro))
        await Promise.allSettled([refreshInsumos({ pagina: 1 }), loadOverview({ force: true }), loadInsumosOptions()])
      } catch (e) {
        toast.error(e instanceof Error ? e.message : String(e))
      } finally {
        setQualityMatchesSavingRegistro('')
      }
    },
    [canUseApi, isAuthed, loadInsumosOptions, loadOverview, mutateJson, refreshInsumos, unidade]
  )

  const loadInsights = React.useCallback(async (opts?: { force?: boolean }) => {
    if (!canUseApi || !isAuthed) return
    // If the user triggered analytics loads (or they are visible), unlock subsequent auto-refreshes.
    setOverviewEverVisible(true)
    if (!opts?.force && autoSyncSuspendedUntil > Date.now()) return
    try {
      insightsAbortRef.current?.abort()
    } catch {
      // ignore
    }
    const ac = new AbortController()
    insightsAbortRef.current = ac
    setInsightsLoading(true)
    try {
      const params = new URLSearchParams()
      params.set('unidade', unidade)
      params.set('groupBy', 'day')

      let days = overviewPeriod === '7d' ? 7 : overviewPeriod === '30d' ? 30 : 365
      const customFromIso = overviewPeriod === 'custom' ? dateInputToIso(overviewCustomFrom) : ''
      const customToIso = overviewPeriod === 'custom' ? dateInputToIso(overviewCustomTo) : ''
      if (overviewPeriod === 'custom' && customFromIso && customToIso) {
        const fromMs = new Date(customFromIso).getTime()
        const toMs = new Date(customToIso).getTime()
        const diffDays = Math.max(1, Math.round((toMs - fromMs) / (1000 * 60 * 60 * 24)))
        days = Math.max(1, Math.min(365, diffDays))
        params.set('from', customFromIso)
        params.set('to', customToIso)
      }
      params.set('days', String(days))

      const out = await apiJson<{ success?: boolean; data?: InsightsBundleData }>(`/analytics/insights?${params.toString()}`, { signal: ac.signal })
      if (insightsAbortRef.current !== ac) return
      const data = out?.data || null
      setInsightsAlertas(Array.isArray(data?.alertas) ? data.alertas : [])
      setInsightsTrends(data?.trends || null)
      setInsightsTurnover(data?.turnover || null)
    } catch (e) {
      if ((e as any)?.name === 'AbortError') return
      if (insightsAbortRef.current !== ac) return
      markAutoSyncFailure(e)
      toast.error(e instanceof Error ? e.message : String(e))
      setInsightsAlertas([])
      setInsightsTrends(null)
      setInsightsTurnover(null)
    } finally {
      if (insightsAbortRef.current === ac) {
        setInsightsLoaded(true)
        setInsightsLoading(false)
        insightsAbortRef.current = null
      }
    }
  }, [autoSyncSuspendedUntil, canUseApi, isAuthed, markAutoSyncFailure, overviewCustomFrom, overviewCustomTo, overviewPeriod, unidade])

  const postMutationRefreshTimerRef = React.useRef<number | null>(null)
	  const schedulePostMutationRefresh = React.useCallback(
	    (opts?: { overview?: boolean; insights?: boolean }) => {
	      const wantsOverview = opts?.overview !== false
	      const wantsInsights = opts?.insights !== false
	      if (!wantsOverview && !wantsInsights) return
	      if (autoSyncSuspendedUntil > Date.now()) return

	      if (postMutationRefreshTimerRef.current) {
	        window.clearTimeout(postMutationRefreshTimerRef.current)
	        postMutationRefreshTimerRef.current = null
	      }

      postMutationRefreshTimerRef.current = window.setTimeout(() => {
        const isOverviewVisible = (() => {
          try {
            const el = overviewSectionRef.current
            if (!el) return true
            const rect = el.getBoundingClientRect()
            const vh = window.innerHeight || 0
            if (!vh) return true
            const topOk = rect.top < vh * 0.85
            const bottomOk = rect.bottom > vh * 0.15
            return topOk && bottomOk
          } catch {
            return true
          }
        })()

        const tasks: Promise<any>[] = []
        if (wantsOverview && overviewLoaded && isOverviewVisible) tasks.push(Promise.resolve(loadOverview()))
        if (wantsInsights && insightsLoaded && isOverviewVisible) tasks.push(Promise.resolve(loadInsights()))
	        if (tasks.length) void Promise.allSettled(tasks)
	      }, 2500)
	    },
	    [autoSyncSuspendedUntil, insightsLoaded, loadInsights, loadOverview, overviewLoaded]
	  )

  const runQuickAction = React.useCallback(
    async (kind: 'ENTRADA' | 'BAIXA' | 'AJUSTE'): Promise<boolean> => {
      if (!canUseApi || !isAuthed) return false
      setQuickActionFeedback(null)
      const codigoBarras = quickCodigo.trim()
      if (!codigoBarras) {
        const message = 'Informe o código de barras'
        setQuickActionFeedback({ type: 'error', message })
        return false
      }

      setQuickActionLoading(true)
      try {
        if (kind === 'AJUSTE') {
          const novoEstoque = Number.isFinite(Number(quickNovoEstoque)) ? Number(quickNovoEstoque) : null
          if (novoEstoque === null) {
            const message = 'Informe o novo estoque'
            setQuickActionFeedback({ type: 'error', message })
            return false
          }
          const registro = quickRegistro.trim()
          await mutateJson(`/insumos/ajuste?unidade=${encodeURIComponent(unidade)}`, {
            method: 'POST',
            body: { codigoBarras, registro: registro || undefined, novoEstoque, motivo: quickMotivo, observacoes: quickObs },
            queueLabel: 'Ajuste'
          })
          const message = 'Ajuste registrado'
          setQuickActionFeedback({ type: 'success', message })
        } else {
          const quantidade = Math.max(1, parseInt(quickQuantidade, 10) || 0)
          const path = kind === 'ENTRADA' ? '/insumos/entrada' : '/insumos/baixa'
          const registro = quickRegistro.trim()
          if (quickLoteNeedsPick && !registro) {
            const message = 'Selecione o lote/registro'
            setQuickActionFeedback({ type: 'error', message })
            return false
          }
          const out = await mutateJson<{ success?: boolean; novoEstoque?: number; quebraEstoque?: boolean; deficit?: number }>(
            `${path}?unidade=${encodeURIComponent(unidade)}`,
            {
              method: 'POST',
              body: { codigoBarras, registro: registro || undefined, quantidade, observacoes: quickObs },
              queueLabel: kind === 'ENTRADA' ? 'Entrada' : 'Baixa'
            }
          )

          const novoEstoque = Number((out as any)?.novoEstoque)
          const quebraEstoque = kind === 'BAIXA' && (
            (out as any)?.quebraEstoque === true ||
            (Number.isFinite(novoEstoque) && novoEstoque < 0)
          )
          const message =
            quebraEstoque
              ? `Baixa registrada com quebra de estoque (saldo: ${Number.isFinite(novoEstoque) ? novoEstoque : '-'})`
              : (kind === 'ENTRADA' ? 'Entrada registrada' : 'Baixa registrada')
          setQuickActionFeedback({ type: 'success', message })
          if (quebraEstoque) {
            const deficit = Number((out as any)?.deficit)
            toast.warning(
              `Quebra de estoque detectada${Number.isFinite(deficit) ? `: déficit de ${deficit}` : ''}. Confira os alertas.`
            )
          }
        }

        await Promise.allSettled([refreshInsumos(), loadMovimentacoes()])
        schedulePostMutationRefresh({ overview: true, insights: true })
        return true
      } catch (e) {
        const code = (e as any)?.code
        const registros = Array.isArray((e as any)?.registros) ? (e as any).registros : []
        const candidatesRaw = Array.isArray((e as any)?.candidates) ? (e as any).candidates : []
        if (String(code || '').toUpperCase() === 'AMBIGUOUS') {
          if (candidatesRaw.length) {
            const candidates = candidatesRaw
              .map((c: any) => ({
                registro: String(c?.registro || '').trim(),
                lote: String(c?.lote || '').trim(),
                dataValidade: c?.dataValidade ? String(c.dataValidade) : null,
                estoque: Number.isFinite(Number(c?.estoque)) ? Number(c.estoque) : 0
              }))
              .filter((c: any) => c.registro)
              .sort((a: any, b: any) => {
                const sa = (Number(a.estoque) || 0) > 0 ? 0 : 1
                const sb = (Number(b.estoque) || 0) > 0 ? 0 : 1
                if (sa !== sb) return sa - sb
                const da = a?.dataValidade ? new Date(a.dataValidade).getTime() : Number.POSITIVE_INFINITY
                const db = b?.dataValidade ? new Date(b.dataValidade).getTime() : Number.POSITIVE_INFINITY
                if (da !== db) return da - db
                return String(a.registro).localeCompare(String(b.registro))
              })
            setQuickCandidates(candidates)
            setQuickRegistros(candidates.map((c: any) => c.registro))
          } else {
            setQuickCandidates([])
            setQuickRegistros(registros)
          }
          const message = 'Este código possui múltiplos lotes. Selecione o lote/registro.'
          setQuickActionFeedback({ type: 'error', message })
          return false
        }
        if (policyErrorToast(e)) {
          setQuickActionFeedback({ type: 'error', message: e instanceof Error ? e.message : String(e) })
          return false
        }
        const message = e instanceof Error ? e.message : String(e)
        setQuickActionFeedback({ type: 'error', message })
        return false
      } finally {
        setQuickActionLoading(false)
      }
    },
    [
      canUseApi,
      isAuthed,
      quickLoteNeedsPick,
      loadMovimentacoes,
      mutateJson,
      quickCodigo,
      quickMotivo,
      quickNovoEstoque,
      quickObs,
      quickQuantidade,
      quickRegistro,
      refreshInsumos,
      schedulePostMutationRefresh,
      setQuickActionFeedback,
      unidade
    ]
  )

  const runTransfer = React.useCallback(async (): Promise<boolean> => {
    if (!canUseApi || !isAuthed) return false
    setQuickActionFeedback(null)
    const codigoBarras = quickCodigo.trim()
    if (!codigoBarras) {
      const message = 'Informe o código de barras'
      setQuickActionFeedback({ type: 'error', message })
      return false
    }

    if (transferFrom === transferTo) {
      const message = 'Origem e destino devem ser diferentes'
      setQuickActionFeedback({ type: 'error', message })
      return false
    }
    const registro = quickRegistro.trim()
    if (quickLoteNeedsPick && !registro) {
      const message = 'Selecione o lote/registro'
      setQuickActionFeedback({ type: 'error', message })
      return false
    }

    setQuickActionLoading(true)
    try {
      const quantidade = Math.max(1, parseInt(quickQuantidade, 10) || 0)
      const out = await mutateJson<{
        success?: boolean
        estoqueNovoOrigem?: number
        quebraEstoqueOrigem?: boolean
        deficitOrigem?: number
      }>(`/insumos/transferir?unidade=${encodeURIComponent(transferFrom)}`, {
        method: 'POST',
        body: {
          codigoBarras,
          registro: registro || undefined,
          quantidade,
          fromUnidade: transferFrom,
          toUnidade: transferTo,
          observacoes: quickObs
        },
        queueLabel: 'Transferência'
      })
      const novoOrigem = Number((out as any)?.estoqueNovoOrigem)
      const quebraEstoque = (out as any)?.quebraEstoqueOrigem === true || (Number.isFinite(novoOrigem) && novoOrigem < 0)
      const message = quebraEstoque
        ? `Transferência registrada com quebra de estoque (origem: ${Number.isFinite(novoOrigem) ? novoOrigem : '-'})`
        : 'Transferência registrada'
      setQuickActionFeedback({ type: 'success', message })
      if (quebraEstoque) {
        const deficit = Number((out as any)?.deficitOrigem)
        toast.warning(
          `Quebra de estoque detectada na origem${Number.isFinite(deficit) ? `: déficit de ${deficit}` : ''}. Confira os alertas.`
        )
      }

      // Refresh what the user is seeing (estoque + movimentações)
      await Promise.allSettled([refreshInsumos(), loadMovimentacoes()])
      schedulePostMutationRefresh({ overview: true, insights: true })
      return true
    } catch (e) {
      const code = (e as any)?.code
      const registros = Array.isArray((e as any)?.registros) ? (e as any).registros : []
      const candidatesRaw = Array.isArray((e as any)?.candidates) ? (e as any).candidates : []
      if (String(code || '').toUpperCase() === 'AMBIGUOUS') {
        if (candidatesRaw.length) {
          const candidates = candidatesRaw
            .map((c: any) => ({
              registro: String(c?.registro || '').trim(),
              lote: String(c?.lote || '').trim(),
              dataValidade: c?.dataValidade ? String(c.dataValidade) : null,
              estoque: Number.isFinite(Number(c?.estoque)) ? Number(c.estoque) : 0
            }))
            .filter((c: any) => c.registro)
            .sort((a: any, b: any) => {
              const sa = (Number(a.estoque) || 0) > 0 ? 0 : 1
              const sb = (Number(b.estoque) || 0) > 0 ? 0 : 1
              if (sa !== sb) return sa - sb
              const da = a?.dataValidade ? new Date(a.dataValidade).getTime() : Number.POSITIVE_INFINITY
              const db = b?.dataValidade ? new Date(b.dataValidade).getTime() : Number.POSITIVE_INFINITY
              if (da !== db) return da - db
              return String(a.registro).localeCompare(String(b.registro))
            })
          setQuickCandidates(candidates)
          setQuickRegistros(candidates.map((c: any) => c.registro))
        } else {
          setQuickCandidates([])
          setQuickRegistros(registros)
        }
        const message = 'Este código possui múltiplos lotes. Selecione o lote/registro.'
        setQuickActionFeedback({ type: 'error', message })
        return false
      }
      if (policyErrorToast(e)) {
        setQuickActionFeedback({ type: 'error', message: e instanceof Error ? e.message : String(e) })
        return false
      }
      const message = e instanceof Error ? e.message : String(e)
      setQuickActionFeedback({ type: 'error', message })
      return false
    } finally {
      setQuickActionLoading(false)
    }
  }, [
    canUseApi,
    isAuthed,
    quickLoteNeedsPick,
    loadMovimentacoes,
    mutateJson,
    quickCodigo,
    quickObs,
    quickQuantidade,
    quickRegistro,
    refreshInsumos,
    schedulePostMutationRefresh,
    setQuickActionFeedback,
    transferFrom,
    transferTo
  ])

  React.useEffect(() => {
    void loadHealth()
    void loadMe()
    void loadProxyStatus()
  }, [loadHealth, loadMe, loadProxyStatus])

  React.useEffect(() => {
    if (!canUseApi || !isAuthed) return
    if (!overviewVisible && !overviewEverVisible) return
    const t = window.setTimeout(() => {
      void loadOverview()
    }, 250)
    return () => window.clearTimeout(t)
  }, [canUseApi, isAuthed, loadOverview, overviewEverVisible, overviewVisible])

  React.useEffect(() => {
    if (!canUseApi || !isAuthed) return
    if (!overviewVisible && !overviewEverVisible) return
    const t = window.setTimeout(() => {
      void loadInsights()
    }, 450)
    return () => window.clearTimeout(t)
  }, [canUseApi, isAuthed, loadInsights, overviewEverVisible, overviewVisible])

  React.useEffect(() => {
      const onOp = (event: Event) => {
        const e = event as CustomEvent<{ op?: 'ENTRADA' | 'BAIXA' | 'TRANSFERENCIA' }>
        const op = e.detail?.op
        if (!op) return
      openQuickOperation(op)
      try {
        window.scrollTo({ top: 0, behavior: 'smooth' })
      } catch {
        // ignore
      }
    }
    window.addEventListener('skincos:insumos:op', onOp as EventListener)
    return () => window.removeEventListener('skincos:insumos:op', onOp as EventListener)
  }, [openQuickOperation])

  React.useEffect(() => {
    const onLayout = (event: Event) => {
      const e = event as CustomEvent<{ action?: 'expandAll' | 'collapseAll' | 'reset' }>
      const action = e.detail?.action
      if (action === 'expandAll') setAllDetailsOpen(true)
      if (action === 'collapseAll') setAllDetailsOpen(false)
      if (action === 'reset') void resetUserLayoutPrefs()
    }
    window.addEventListener('skincos:insumos:layout', onLayout as EventListener)
    return () => window.removeEventListener('skincos:insumos:layout', onLayout as EventListener)
  }, [resetUserLayoutPrefs, setAllDetailsOpen])

  React.useEffect(() => {
    const onOverview = (event: Event) => {
      const e = event as CustomEvent<{ action?: 'reload'; period?: '7d' | '30d' | '1y' | 'custom'; from?: string; to?: string }>
      const nextPeriod = e.detail?.period
      if (nextPeriod) setOverviewPeriod(nextPeriod)
	      if (typeof e.detail?.from === 'string') setOverviewCustomFrom(e.detail.from)
	      if (typeof e.detail?.to === 'string') setOverviewCustomTo(e.detail.to)
	      if (e.detail?.action === 'reload') {
	        void Promise.allSettled([loadOverview({ force: true }), loadInsights({ force: true }), refreshInsumos()])
	      }
	    }
    window.addEventListener('skincos:insumos:overview', onOverview as EventListener)
    return () => window.removeEventListener('skincos:insumos:overview', onOverview as EventListener)
  }, [loadInsights, loadOverview, refreshInsumos])

  React.useEffect(() => {
    if (!canUseApi || !isAuthed) return
    void loadShareHistory()
  }, [canUseApi, isAuthed, loadShareHistory])

  React.useEffect(() => {
    if (!canUseApi || !isAuthed) return
    void loadInsumosPaged({ pagina: 1, limite: insumosLimite, q: '', append: false })
  }, [canUseApi, insumosLimite, isAuthed, loadInsumosPaged, unidade])

  React.useEffect(() => {
    if (!canUseApi || !isAuthed) return
    const q = insumosQuery.trim()
    const t = window.setTimeout(() => {
      void loadInsumosPaged({ pagina: 1, limite: insumosLimite, q, append: false })
    }, 350)
    return () => window.clearTimeout(t)
  }, [canUseApi, insumosLimite, insumosQuery, isAuthed, loadInsumosPaged, unidade])

  const filteredInsumos = insumos

  const insumosCacheRef = React.useRef<Map<string, Map<string, Insumo>>>(new Map())
  const [insumosCacheVersion, setInsumosCacheVersion] = React.useState(0)

  const upsertInsumosCache = React.useCallback((items: Insumo[]) => {
    if (!Array.isArray(items) || !items.length) return
    let changed = false
    for (const it of items) {
      const codes = getInsumoBarcodes(it)
      if (!codes.length) continue
      const registro = String(it?.registro || '').trim() || `__no_registro__:${codes[0]}`
      for (const codigo of codes) {
        let byRegistro = insumosCacheRef.current.get(codigo)
        if (!byRegistro) {
          byRegistro = new Map<string, Insumo>()
          insumosCacheRef.current.set(codigo, byRegistro)
        }
        const prev = byRegistro.get(registro)
        if (!prev) {
          byRegistro.set(registro, it)
          changed = true
          continue
        }
        const merged: Insumo = {
          ...prev,
          ...it,
          estoques: { ...(prev.estoques || {}), ...(it.estoques || {}) },
          statusValidade: it.statusValidade || prev.statusValidade
        }
        byRegistro.set(registro, merged)
        changed = true
      }
    }
    if (changed) setInsumosCacheVersion((v) => v + 1)
  }, [])

  React.useEffect(() => {
    upsertInsumosCache(insumos || [])
  }, [insumos, upsertInsumosCache])

  const selectedInsumo = React.useMemo(() => {
    const code = selectedCodigoBarras.trim()
    if (!code) return null
    const byRegistro = insumosCacheRef.current.get(code)
    if (!byRegistro || !byRegistro.size) return null
    return Array.from(byRegistro.values())[0] || null
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [insumosCacheVersion, selectedCodigoBarras])

  const insumosByCodigo = React.useMemo(() => {
    const map = new Map<string, Insumo[]>()
    for (const [code, byRegistro] of insumosCacheRef.current.entries()) {
      const list = Array.from(byRegistro.values())
      if (list.length) map.set(code, list)
    }
    return map
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [insumosCacheVersion])

  const pickInsumoForMov = React.useCallback(
    (m: Movimentacao) => {
      const codigo = String(m.codigoBarras || '').trim()
      if (!codigo) return null
      const list = insumosByCodigo.get(codigo) || []
      if (!list.length) return null

      const wantedRegistro = String(m.registroInsumo || '').trim()
      if (wantedRegistro) {
        const exact = list.find((i) => String(i.registro || '').trim() === wantedRegistro)
        if (exact) return exact
      }

      const ctxUnit = String(m.unidade || unidade || '').trim()
      const getStock = (i: Insumo) => {
        const v = ctxUnit && i?.estoques ? Number(i.estoques?.[ctxUnit] ?? 0) : Number(i.estoqueAtual ?? 0)
        return Number.isFinite(v) ? v : 0
      }

      return [...list].sort((a, b) => {
        const sa = getStock(b) - getStock(a)
        if (sa !== 0) return sa
        const da = a?.dataValidade ? new Date(a.dataValidade).getTime() : Number.POSITIVE_INFINITY
        const db = b?.dataValidade ? new Date(b.dataValidade).getTime() : Number.POSITIVE_INFINITY
        if (da !== db) return da - db
        return String(a.registro || '').localeCompare(String(b.registro || ''))
      })[0]
    },
    [insumosByCodigo, unidade]
  )

  const movInsumosLookupTokenRef = React.useRef(0)
  const movInsumosLookupDoneRef = React.useRef<Set<string>>(new Set())
  const movInsumosLookupInflightRef = React.useRef<Set<string>>(new Set())

  React.useEffect(() => {
    if (!canUseApi || !isAuthed) return
    const uniqueCodes = new Set<string>()
    const selected = selectedCodigoBarras.trim()
    const source = Array.isArray(movimentacoes) ? movimentacoes : []
    const base = selected ? source.filter((m) => String(m?.codigoBarras || '').trim() === selected) : source
    for (const m of base) {
      const code = String(m?.codigoBarras || '').trim()
      if (code) uniqueCodes.add(code)
    }

    const missing: string[] = []
    for (const code of uniqueCodes) {
      if (movInsumosLookupDoneRef.current.has(code)) continue
      if (movInsumosLookupInflightRef.current.has(code)) continue
      const cached = insumosCacheRef.current.get(code)
      if (cached && cached.size) continue
      missing.push(code)
    }
    if (!missing.length) return

    const token = ++movInsumosLookupTokenRef.current
    const queue = missing
    const concurrency = 4
    let cursor = 0

    const worker = async () => {
      while (cursor < queue.length && token === movInsumosLookupTokenRef.current) {
        const code = queue[cursor++]
        if (!code) continue
        if (movInsumosLookupDoneRef.current.has(code)) continue
        if (movInsumosLookupInflightRef.current.has(code)) continue
        movInsumosLookupInflightRef.current.add(code)
        try {
          const items = await lookupInsumosByCodigo({ codigoBarras: code, ctxUnidade: unidade })
          if (token !== movInsumosLookupTokenRef.current) return
          upsertInsumosCache(items)
        } catch {
          // ignore
        } finally {
          movInsumosLookupInflightRef.current.delete(code)
          movInsumosLookupDoneRef.current.add(code)
        }
      }
    }

    void Promise.allSettled(Array.from({ length: Math.min(concurrency, queue.length) }, () => worker()))
  }, [canUseApi, isAuthed, lookupInsumosByCodigo, movimentacoes, selectedCodigoBarras, unidade, upsertInsumosCache])

  const movPanelOpen = detailsOpen[MAIN_PANEL_OPEN_KEYS.mov] ?? true

  React.useEffect(() => {
    insumosRef.current = insumos
  }, [insumos])

  const lotCategorias = React.useMemo(() => {
    const fromInsumos = (insumos || []).map((item) => String(item.categoria || '').trim()).filter(Boolean)
    const fromPolicies = categoryPolicies
      .map((policy) => String(policy.label || '').trim())
      .filter(Boolean)
    return uniqueSortedTextOptions([...fromInsumos, ...fromPolicies, ...insumosOptionsCategorias])
  }, [categoryPolicies, insumos, insumosOptionsCategorias])

  const insumosMarcas = React.useMemo(() => {
    const fromInsumos = (insumos || []).map((item) => String(item.marca || '').trim()).filter(Boolean)
    return uniqueSortedTextOptions([...fromInsumos, ...insumosOptionsMarcas])
  }, [insumos, insumosOptionsMarcas])

  const insumosTiposUnidade = React.useMemo(() => Array.from(CANONICAL_TIPOS_UNIDADE as readonly string[]), [])

	  type ChartPresetId = 'distribution' | 'movements' | 'roi_risk'

	  type ChartMetric = 'qtd' | 'valor'
	  type ChartView = 'bar' | 'line' | 'pie'
	  type ChartLayout = 'square' | 'wide' | 'tall'
	  type ChartGroupBy = 'categoria' | 'marca' | 'item' | 'tempo'
	  type MovementsMode = 'inout' | 'saldo' | 'entrada' | 'saida'
	  type ChartSlotConfig = {
	    presetId: ChartPresetId
	    metric?: ChartMetric
	    view?: ChartView
	    topN?: number
	    groupBy?: ChartGroupBy
	    mode?: MovementsMode
	  }

	  const CHARTS_SLOTS_KEY = 'skincos.insumos.charts.slots.v1'
	  const DEFAULT_CHART_SLOTS: ChartSlotConfig[] = [
	    { presetId: 'distribution', groupBy: 'categoria', metric: 'qtd', view: 'pie', topN: 8 }
	  ]
	  const MAX_CHARTS = 9

	  const CHART_PRESETS: Array<{
	    id: ChartPresetId
	    label: string
	    supportsMetric?: boolean
	    supportsView?: boolean
	    supportsTopN?: boolean
	    defaultMetric?: ChartMetric
	    defaultView?: ChartView
	    layout?: ChartLayout
	  }> = [
	      { id: 'distribution', label: 'Distribuição', supportsMetric: true, supportsView: true, supportsTopN: true, defaultView: 'pie', layout: 'square' },
	      { id: 'movements', label: 'Movimentações', supportsMetric: true, supportsView: true, supportsTopN: true, defaultView: 'bar', layout: 'wide' },
	      { id: 'roi_risk', label: 'ROI (perdas & risco)', supportsMetric: true, supportsView: true, defaultView: 'bar', layout: 'square' }
	    ]

	  const [chartSlots, setChartSlots] = React.useState<ChartSlotConfig[]>(() => {
	    try {
	      const raw = window.localStorage.getItem(CHARTS_SLOTS_KEY)
	      if (!raw) return DEFAULT_CHART_SLOTS
	      const parsed = JSON.parse(raw)
	      const slots = Array.isArray(parsed) ? parsed : []
	      const validIds = new Set<ChartPresetId>(CHART_PRESETS.map((p) => p.id))
	      const cleaned: ChartSlotConfig[] = slots
	        .slice(0, MAX_CHARTS)
	        .map((s: any, idx: number) => {
	          const fallback = DEFAULT_CHART_SLOTS[0]
	          const presetIdRaw = String(s?.presetId || '')
	          let presetId: ChartPresetId = fallback.presetId
	          let groupBy: ChartGroupBy | undefined = undefined
	          let mode: MovementsMode | undefined = undefined

	          if (presetIdRaw === 'stock_category') {
	            presetId = 'distribution'
	            groupBy = 'categoria'
	          } else if (presetIdRaw === 'stock_brand') {
	            presetId = 'distribution'
	            groupBy = 'marca'
	          } else if (presetIdRaw === 'stock_top') {
	            presetId = 'distribution'
	            groupBy = 'item'
	          } else if (presetIdRaw === 'mov_inout') {
	            presetId = 'movements'
	            groupBy = 'tempo'
	            mode = 'inout'
	          } else if (presetIdRaw === 'mov_saldo') {
	            presetId = 'movements'
	            groupBy = 'tempo'
	            mode = 'saldo'
	          } else if (presetIdRaw === 'trends_inout') {
	            presetId = 'movements'
	            groupBy = 'tempo'
	            mode = 'inout'
	          } else if (presetIdRaw === 'turnover_category') {
	            presetId = 'movements'
	            groupBy = 'categoria'
	            mode = 'saida'
	          } else if (validIds.has(presetIdRaw as any)) {
	            presetId = presetIdRaw as ChartPresetId
	            groupBy = (s?.groupBy as any) || undefined
	            mode = (s?.mode as any) || undefined
	          }

	          if (!validIds.has(presetId)) presetId = fallback.presetId
	          const preset = CHART_PRESETS.find((p) => p.id === presetId)
	          const metric: ChartMetric | undefined = s?.metric === 'valor' || s?.metric === 'qtd' ? s.metric : preset?.defaultMetric
	          const view: ChartView | undefined = s?.view === 'bar' || s?.view === 'line' || s?.view === 'pie' ? s.view : preset?.defaultView
	          const topN = Math.max(5, Math.min(15, parseInt(String(s?.topN ?? ''), 10) || 0)) || fallback.topN
	          const groupByFixed: ChartGroupBy | undefined = (() => {
	            const v = String(groupBy || s?.groupBy || '').trim()
	            if (v === 'categoria' || v === 'marca' || v === 'item' || v === 'tempo') return v
	            if (presetId === 'distribution') return 'categoria'
	            if (presetId === 'movements') return 'tempo'
	            return undefined
	          })()
	          const modeFixed: MovementsMode | undefined = (() => {
	            const v = String(mode || s?.mode || '').trim()
	            if (v === 'inout' || v === 'saldo' || v === 'entrada' || v === 'saida') return v
	            if (presetId === 'movements') return groupByFixed === 'categoria' ? 'saida' : 'inout'
	            return undefined
	          })()
	          return { presetId, groupBy: groupByFixed, mode: modeFixed, metric, view, topN }
	        })
	      if (!cleaned.length) return DEFAULT_CHART_SLOTS
	      return cleaned
	    } catch {
	      return DEFAULT_CHART_SLOTS
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  })

  React.useEffect(() => {
    try {
      window.localStorage.setItem(CHARTS_SLOTS_KEY, JSON.stringify(chartSlots))
    } catch {
      // ignore
    }
  }, [chartSlots])

	  const setChartSlot = React.useCallback((idx: number, next: Partial<ChartSlotConfig>) => {
	    setChartSlots((prev) => {
	      const copy = [...prev]
	      const cur = copy[idx] || DEFAULT_CHART_SLOTS[0]
	      const presetId = (next.presetId ?? cur.presetId) as ChartPresetId
	      const preset = CHART_PRESETS.find((p) => p.id === presetId)
	      const metric = next.metric ?? cur.metric ?? preset?.defaultMetric
	      const groupBy: ChartGroupBy | undefined = (() => {
	        const v = String(next.groupBy ?? cur.groupBy ?? '').trim()
	        if (v === 'categoria' || v === 'marca' || v === 'item' || v === 'tempo') return v
	        if (presetId === 'distribution') return 'categoria'
	        if (presetId === 'movements') return 'tempo'
	        return undefined
	      })()
	      const mode: MovementsMode | undefined = (() => {
	        const v = String(next.mode ?? cur.mode ?? '').trim()
	        if (v === 'inout' || v === 'saldo' || v === 'entrada' || v === 'saida') return v
	        if (presetId === 'movements') return groupBy === 'categoria' ? 'saida' : 'inout'
	        return undefined
	      })()
	      const view = next.view ?? cur.view ?? preset?.defaultView
	      const topN = next.topN ?? cur.topN
	      copy[idx] = { ...cur, ...next, presetId, groupBy, mode, metric, view, topN }
	      return copy
	    })
	  }, [])

  const fmtChartValue = React.useCallback(
    (metric: ChartMetric, v: any) => {
      const n = Number(v) || 0
      return metric === 'valor' ? fmtMoneyBRL(n) : String(Math.round(n))
    },
    []
  )

	  const stockAgg = React.useMemo(() => {
	    const byCategoria = new Map<string, { name: string; qtd: number; valor: number }>()
	    const byMarca = new Map<string, { name: string; qtd: number; valor: number }>()
	    const byProduto = new Map<string, { name: string; qtd: number; valor: number }>()

	    const baseItems = (Array.isArray(overviewInsumos) && overviewInsumos.length ? overviewInsumos : insumos) || []
	    for (const i of baseItems) {
	      const estoque =
	        unidade && i.estoques
	          ? Number(i.estoques?.[unidade] ?? 0)
	          : Number(i.estoqueAtual ?? 0) || 0
	      if (!estoque) continue
	      const preco = Number(i.precoCusto) || 0
	      const valor = estoque * preco

      const cat = String(i.categoria || 'Outros').trim() || 'Outros'
      const brand = String(i.marca || 'Sem marca').trim() || 'Sem marca'
      const prod = String(i.produto || i.codigoBarras || 'Item').trim() || 'Item'

      const c = byCategoria.get(cat) || { name: cat, qtd: 0, valor: 0 }
      c.qtd += estoque
      c.valor += valor
      byCategoria.set(cat, c)

      const b = byMarca.get(brand) || { name: brand, qtd: 0, valor: 0 }
      b.qtd += estoque
      b.valor += valor
      byMarca.set(brand, b)

      const p = byProduto.get(prod) || { name: prod, qtd: 0, valor: 0 }
      p.qtd += estoque
      p.valor += valor
      byProduto.set(prod, p)
    }

    const toSorted = (m: Map<string, { name: string; qtd: number; valor: number }>) =>
      Array.from(m.values()).sort((a, b) => b.valor - a.valor)

	    return {
	      byCategoria: toSorted(byCategoria),
	      byMarca: toSorted(byMarca),
	      byProduto: toSorted(byProduto)
	    }
	  }, [insumos, overviewInsumos, unidade])

  const fmtBucketLabel = React.useCallback((bucket: string) => {
    const b = String(bucket || '')
    if (/^\d{4}-\d{2}-\d{2}$/.test(b)) return fmtDayShort(b)
    return b
  }, [])

  const trendsSeriesRaw = React.useMemo(() => {
    const buckets = Array.isArray((insightsTrends as any)?.buckets) ? ((insightsTrends as any).buckets as any[]) : []
    return buckets.map((b) => {
      const entradaQtd = Number(b.entradaQtd ?? b.inQty ?? b.entrada ?? 0) || 0
      const saidaQtd = Number(b.saidaQtd ?? b.outQty ?? b.saida ?? 0) || 0
      const entradaValor = Number(b.entradaValor ?? b.inValue ?? b.entradaV ?? 0) || 0
      const saidaValor = Number(b.saidaValor ?? b.outValue ?? b.saidaV ?? 0) || 0
      return {
        bucket: String(b.bucket ?? b.day ?? b.date ?? ''),
        entradaQtd,
        saidaQtd,
        saldoQtd: entradaQtd - saidaQtd,
        entradaValor,
        saidaValor,
        saldoValor: entradaValor - saidaValor
      }
    })
  }, [insightsTrends])

  const trendsSeries = React.useMemo(() => {
    const limit = overviewPeriod === '7d' ? 7 : overviewPeriod === '30d' ? 30 : 365
    const raw = trendsSeriesRaw.slice(-limit)
    if (overviewPeriod !== '1y') return raw

    const byWeek = new Map<string, { bucket: string; entradaQtd: number; saidaQtd: number; saldoQtd: number; entradaValor: number; saidaValor: number; saldoValor: number }>()
    for (const r of raw) {
      const week = isoDayWeekStart(r.bucket) || String(r.bucket || '')
      const cur =
        byWeek.get(week) || { bucket: week, entradaQtd: 0, saidaQtd: 0, saldoQtd: 0, entradaValor: 0, saidaValor: 0, saldoValor: 0 }
      cur.entradaQtd += Number(r.entradaQtd) || 0
      cur.saidaQtd += Number(r.saidaQtd) || 0
      cur.entradaValor += Number(r.entradaValor) || 0
      cur.saidaValor += Number(r.saidaValor) || 0
      cur.saldoQtd = cur.entradaQtd - cur.saidaQtd
      cur.saldoValor = cur.entradaValor - cur.saidaValor
      byWeek.set(week, cur)
    }
    return Array.from(byWeek.values()).sort((a, b) => String(a.bucket).localeCompare(String(b.bucket))).slice(-60)
  }, [overviewPeriod, trendsSeriesRaw])

	  const presetSupports = React.useCallback(
	    (id: ChartPresetId) =>
	      CHART_PRESETS.find((p) => p.id === id) || {
	        id,
        label: String(id),
        supportsMetric: false,
        supportsView: false,
        supportsTopN: false,
        defaultView: 'bar' as any,
        layout: 'square' as any
      },
    []
  )

	  const presetViewOptions = React.useCallback((slot: ChartSlotConfig): ChartView[] => {
	    if (slot.presetId === 'distribution') {
	      const gb = slot.groupBy === 'item' ? 'item' : slot.groupBy === 'marca' ? 'marca' : 'categoria'
	      return gb === 'item' ? ['bar'] : ['pie', 'bar']
	    }
	    if (slot.presetId === 'movements') {
	      const gb = slot.groupBy === 'categoria' ? 'categoria' : 'tempo'
	      return gb === 'tempo' ? ['bar', 'line'] : ['bar', 'pie']
	    }
	    if (slot.presetId === 'roi_risk') return ['bar', 'pie']
	    return ['bar', 'line']
	  }, [])

  const renderChart = React.useCallback(
    (slot: ChartSlotConfig, opts?: { height?: number }) => {
      const presetId = slot.presetId
      const metric: ChartMetric = slot.metric === 'valor' ? 'valor' : 'qtd'
      const view: ChartView = slot.view === 'pie' || slot.view === 'line' || slot.view === 'bar' ? slot.view : 'bar'
      const topN = Math.max(5, Math.min(15, Number(slot.topN) || 8))
      const height = Math.max(220, Math.min(560, Number(opts?.height) || 260))
      const tooltipFormatter = (v: any) => fmtChartValue(metric, v)
      const renderCategoriaLegend = (props: any) => {
        const payload = Array.isArray(props?.payload) ? props.payload : []
        if (!payload.length) return null
        return (
          <div className="mt-3 flex flex-wrap gap-2">
            {payload.map((entry: any, idx: number) => {
              const label = String(entry?.value || entry?.payload?.name || '').trim()
              if (!label) return null
              const color = entry?.color || getCategoriaBgColor(label)
              return (
                <Badge key={`${label}-${idx}`} style={buildTagStyle(color)} className="border">
                  {label}
                </Badge>
              )
            })}
          </div>
        )
      }

      if (presetId === 'distribution') {
        const gb: ChartGroupBy = slot.groupBy === 'marca' || slot.groupBy === 'item' || slot.groupBy === 'categoria' ? slot.groupBy : 'categoria'
        const base = gb === 'marca' ? stockAgg.byMarca : gb === 'item' ? stockAgg.byProduto : stockAgg.byCategoria
        const sorted = [...base].sort((a, b) => (metric === 'valor' ? b.valor - a.valor : b.qtd - a.qtd))
        const top = sorted.slice(0, topN).map((x) => ({
          name: x.name,
          value: metric === 'valor' ? x.valor : x.qtd,
          color: gb === 'item' ? undefined : gb === 'marca' ? getMarcaBgColor(x.name) : getCategoriaBgColor(x.name)
        }))
        const restValue = sorted.slice(topN).reduce((acc, x) => acc + (metric === 'valor' ? x.valor : x.qtd), 0)
        if (restValue > 0 && gb !== 'item') top.push({ name: 'Outros', value: restValue, color: '#9aa5b1' } as any)

        if (!top.length) return <div className="text-sm text-blue-100/70">{renderLoadingText(overviewLoading, 'Sem dados.')}</div>
        const hasAny = top.some((d) => (Number((d as any).value) || 0) > 0)
        if (!hasAny) {
          return (
            <div className="text-sm text-blue-100/70">
              {metric === 'valor'
                ? 'Sem valores (preço de custo) para calcular. Cadastre o custo ou mude a métrica para quantidade.'
                : 'Sem dados.'}
            </div>
          )
        }

        if (view === 'pie' && gb !== 'item') {
          return (
            <div className="w-full" style={{ height }}>
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie data={top} dataKey="value" nameKey="name" innerRadius={58} outerRadius={92} paddingAngle={2}>
                    {top.map((entry, idx) => (
                      <Cell key={idx} fill={(entry as any).color || '#60a5fa'} />
                    ))}
                  </Pie>
                  <Tooltip formatter={tooltipFormatter} />
                  <Legend content={renderCategoriaLegend} />
                </PieChart>
              </ResponsiveContainer>
            </div>
          )
        }

        const barFill = gb === 'item' ? '#a78bfa' : '#60a5fa'
        const axisWidth = gb === 'item' ? 140 : 110
        return (
          <div className="w-full" style={{ height }}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={top} layout="vertical" margin={{ left: 12, right: 12 }}>
                <CartesianGrid strokeDasharray="3 3" opacity={0.15} />
                <XAxis type="number" tick={{ fill: 'rgba(219,234,254,0.8)', fontSize: 11 }} />
                <YAxis
                  type="category"
                  dataKey="name"
                  width={axisWidth}
                  tick={{ fill: 'rgba(219,234,254,0.8)', fontSize: 11 }}
                  tickFormatter={(v) => String(v).slice(0, 24)}
                />
                <Tooltip formatter={tooltipFormatter} />
                <Bar dataKey="value" name={metric === 'valor' ? 'Valor' : 'Qtd'} fill={barFill} radius={[0, 6, 6, 0]}>
                  {top.map((entry, idx) => (
                    <Cell key={`cell-${idx}`} fill={(entry as any).color || barFill} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        )
      }

      if (presetId === 'movements') {
        const gb: ChartGroupBy = slot.groupBy === 'categoria' ? 'categoria' : 'tempo'

        if (gb === 'tempo') {
          if (!trendsSeries.length) return <div className="text-sm text-blue-100/70">{renderLoadingText(insightsLoading, 'Sem dados para o período.')}</div>
          const mode: MovementsMode =
            slot.mode === 'saldo' || slot.mode === 'entrada' || slot.mode === 'saida' || slot.mode === 'inout' ? slot.mode : 'inout'

          const series = trendsSeries.map((b) => ({
            bucket: b.bucket,
            entrada: metric === 'valor' ? b.entradaValor : b.entradaQtd,
            saida: metric === 'valor' ? b.saidaValor : b.saidaQtd,
            saldo: metric === 'valor' ? b.saldoValor : b.saldoQtd
          }))
          const pickKey = mode === 'saldo' ? 'saldo' : mode === 'entrada' ? 'entrada' : mode === 'saida' ? 'saida' : null
          const hasAny =
            mode === 'inout'
              ? series.some((r) => (Number(r.entrada) || 0) > 0 || (Number(r.saida) || 0) > 0)
              : series.some((r) => (Number((r as any)[pickKey || 'saldo']) || 0) !== 0)
          if (!hasAny) {
            return (
              <div className="text-sm text-blue-100/70">
                {metric === 'valor'
                  ? 'Sem valores (preço de custo) para calcular. Cadastre o custo ou mude a métrica para quantidade.'
                  : 'Sem dados para o período.'}
              </div>
            )
          }

          const saldoTotal = series.reduce((acc, r) => acc + (Number(r.saldo) || 0), 0)
          const xFormatter = (b: any) => fmtBucketLabel(String(b))

          if (view === 'line') {
            return (
              <div>
                <div className="w-full" style={{ height }}>
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={series}>
                      <CartesianGrid strokeDasharray="3 3" opacity={0.15} />
                      <XAxis dataKey="bucket" tickFormatter={xFormatter} />
                      <YAxis />
                      <Tooltip labelFormatter={xFormatter} formatter={tooltipFormatter} />
                      <Legend />
                      {mode === 'inout' ? (
                        <>
                          <Line type="monotone" dataKey="entrada" name="Entradas" stroke="#22c55e" strokeWidth={2} dot={false} />
                          <Line type="monotone" dataKey="saida" name="Saídas" stroke="#ef4444" strokeWidth={2} dot={false} />
                        </>
                      ) : (
                        <Line
                          type="monotone"
                          dataKey={pickKey || 'saldo'}
                          name={mode === 'saldo' ? 'Saldo' : mode === 'entrada' ? 'Entradas' : 'Saídas'}
                          stroke={mode === 'entrada' ? '#22c55e' : mode === 'saida' ? '#ef4444' : '#60a5fa'}
                          strokeWidth={2}
                          dot={false}
                        />
                      )}
                    </LineChart>
                  </ResponsiveContainer>
                </div>
                {mode === 'inout' ? (
                  <div className="text-xs text-blue-200/60 mt-2">
                    Saldo: <span className="font-mono">{fmtChartValue(metric, saldoTotal)}</span>
                  </div>
                ) : null}
              </div>
            )
          }

          return (
            <div>
              <div className="w-full" style={{ height }}>
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={series}>
                    <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.1)" />
                    <XAxis dataKey="bucket" tickFormatter={xFormatter} tick={{ fill: 'rgba(219,234,254,0.8)', fontSize: 11 }} />
                    <YAxis tick={{ fill: 'rgba(219,234,254,0.8)', fontSize: 11 }} />
                    <Tooltip labelFormatter={xFormatter} formatter={tooltipFormatter} />
                    <Legend />
                    {mode === 'inout' ? (
                      <>
                        <Bar dataKey="entrada" name="Entradas" fill="#22c55e" />
                        <Bar dataKey="saida" name="Saídas" fill="#ef4444" />
                      </>
                    ) : (
                      <Bar
                        dataKey={pickKey || 'saldo'}
                        name={mode === 'saldo' ? 'Saldo' : mode === 'entrada' ? 'Entradas' : 'Saídas'}
                        fill={mode === 'entrada' ? '#22c55e' : mode === 'saida' ? '#ef4444' : '#60a5fa'}
                        radius={[4, 4, 0, 0]}
                      />
                    )}
                  </BarChart>
                </ResponsiveContainer>
              </div>
              {mode === 'inout' ? (
                <div className="text-xs text-blue-200/60 mt-2">
                  Saldo: <span className="font-mono">{fmtChartValue(metric, saldoTotal)}</span>
                </div>
              ) : null}
            </div>
          )
        }

        const mode: MovementsMode = slot.mode === 'entrada' ? 'entrada' : 'saida'
        const turnover = (mode === 'entrada' ? insightsTurnover?.entrada : insightsTurnover?.saida) || null
        const raw = Array.isArray(turnover?.categories) ? turnover.categories : []
        if (!raw.length) return <div className="text-sm text-blue-100/70">{renderLoadingText(insightsLoading, 'Sem dados para o período.')}</div>

        const sorted = [...raw].sort((a: any, b: any) => {
          const av = metric === 'valor' ? Number(a?.valor || 0) : Number(a?.qtd || 0)
          const bv = metric === 'valor' ? Number(b?.valor || 0) : Number(b?.qtd || 0)
          return bv - av
        })
        const top = sorted.slice(0, topN).map((c: any) => ({
          name: String(c?.categoria || 'Outros'),
          value: metric === 'valor' ? Number(c?.valor || 0) : Number(c?.qtd || 0),
          color: getCategoriaBgColor(String(c?.categoria || ''))
        }))
        const restValue = sorted.slice(topN).reduce((acc: number, c: any) => acc + (metric === 'valor' ? Number(c?.valor || 0) : Number(c?.qtd || 0)), 0)
        if (restValue > 0) top.push({ name: 'Outros', value: restValue, color: '#9aa5b1' })

        if (!top.length) return <div className="text-sm text-blue-100/70">{renderLoadingText(insightsLoading, 'Sem dados.')}</div>
        const hasAny = top.some((d) => (Number((d as any).value) || 0) > 0)
        if (!hasAny) {
          return (
            <div className="text-sm text-blue-100/70">
              {metric === 'valor'
                ? 'Sem valores (preço de custo) para calcular. Cadastre o custo ou mude a métrica para quantidade.'
                : 'Sem dados.'}
            </div>
          )
        }

        return view === 'pie' ? (
          <div className="w-full" style={{ height }}>
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie data={top} dataKey="value" nameKey="name" outerRadius="80%">
                  {top.map((entry, i) => (
                    <Cell key={`cell-${i}`} fill={(entry as any).color || '#60a5fa'} />
                  ))}
                </Pie>
                <Tooltip formatter={tooltipFormatter} />
                <Legend />
              </PieChart>
            </ResponsiveContainer>
          </div>
        ) : (
          <div className="w-full" style={{ height }}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={top} layout="vertical" margin={{ left: 12 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.1)" />
                <XAxis type="number" tick={{ fill: 'rgba(219,234,254,0.8)', fontSize: 11 }} />
                <YAxis
                  type="category"
                  dataKey="name"
                  width={130}
                  tick={{ fill: 'rgba(219,234,254,0.8)', fontSize: 11 }}
                  tickFormatter={(v) => String(v).slice(0, 22)}
                />
                <Tooltip formatter={tooltipFormatter} />
                <Bar
                  dataKey="value"
                  name={metric === 'valor' ? 'Valor' : 'Qtd'}
                  fill={mode === 'entrada' ? '#22c55e' : '#ef4444'}
                  radius={[0, 4, 4, 0]}
                />
              </BarChart>
            </ResponsiveContainer>
          </div>
        )
      }

	      if (presetId === 'roi_risk') {
	        if (!overviewRoi) return <div className="text-sm text-blue-100/70">{renderLoadingText(overviewLoading, 'Sem dados.')}</div>

	        const perdas = (overviewRoi as any)?.perdas || {}
	        const ruptura = (overviewRoi as any)?.ruptura || {}

	        const isValor = metric === 'valor'
	        const data = isValor
	          ? [
	              { name: 'Expirado', value: Number(perdas?.valorExpirado || 0), color: '#ef4444' },
	              { name: 'Vencendo', value: Number(perdas?.valorRiscoVencendo || 0), color: '#f59e0b' }
	            ]
	          : [
	              { name: 'Expirado', value: Number(perdas?.itensExpirados || 0), color: '#ef4444' },
	              { name: 'Vencendo', value: Number(perdas?.itensVencendo || 0), color: '#f59e0b' },
	              { name: 'Rupturas', value: Number(ruptura?.itensRuptura || 0), color: '#60a5fa' }
	            ]

	        const hasAny = data.some((d) => (Number(d.value) || 0) > 0)
	        if (!hasAny) return <div className="text-sm text-blue-100/70">{renderLoadingText(overviewLoading, 'Sem dados.')}</div>

	        return view === 'pie' ? (
	          <div className="w-full" style={{ height }}>
	            <ResponsiveContainer width="100%" height="100%">
	              <PieChart>
	                <Pie data={data} dataKey="value" nameKey="name" outerRadius="80%">
	                  {data.map((entry, i) => (
	                    <Cell key={`cell-${i}`} fill={(entry as any).color || '#60a5fa'} />
	                  ))}
	                </Pie>
	                <Tooltip formatter={tooltipFormatter} />
                <Legend content={renderCategoriaLegend} />
	              </PieChart>
	            </ResponsiveContainer>
	          </div>
	        ) : (
	          <div className="w-full" style={{ height }}>
	            <ResponsiveContainer width="100%" height="100%">
	              <BarChart data={data}>
	                <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.1)" />
	                <XAxis dataKey="name" tick={{ fill: 'rgba(219,234,254,0.8)', fontSize: 11 }} />
	                <YAxis tick={{ fill: 'rgba(219,234,254,0.8)', fontSize: 11 }} />
	                <Tooltip formatter={tooltipFormatter} />
	                <Bar dataKey="value" name={isValor ? 'Valor' : 'Qtd'} radius={[4, 4, 0, 0]}>
	                  {data.map((entry: any, i: number) => (
	                    <Cell key={`cell-${i}`} fill={entry.color || '#60a5fa'} />
	                  ))}
	                </Bar>
	              </BarChart>
	            </ResponsiveContainer>
	          </div>
	        )
	      }

	      return <div className="text-sm text-blue-100/70">Preset indisponível.</div>
	    },
	    [fmtBucketLabel, fmtChartValue, insightsLoading, insightsTurnover, overviewLoading, overviewRoi, stockAgg, trendsSeries]
	  )

  type AlertasLinha = {
    key: string
    codigoBarras?: string
    produto?: string
    categoria?: string
    marca?: string
    qualityIssue?: QualityIssue
    qualityMessage?: string
    qualitySeverity?: string
    estoqueAtual?: number
    estoqueMinimo?: number
    diferenca?: number
    percentual?: number | null
    dataValidade?: string | null
    dias?: number | null
    tags: AlertaStatusTag[]
  }

  const alertasLinhas = React.useMemo<AlertasLinha[]>(() => {
    const byKey = new Map<string, { base: Omit<AlertasLinha, 'tags' | 'key'>; tags: Set<AlertaStatusTag> }>()

    const upsert = (
      id: { codigoBarras?: string; produto?: string; categoria?: string; marca?: string },
      patch: Partial<Omit<AlertasLinha, 'tags' | 'key'>>,
      tag?: AlertaStatusTag,
      forcedKey?: string
    ) => {
      const code = String(id.codigoBarras || '').trim()
      const produto = String(id.produto || '').trim()
      const categoria = String(id.categoria || '').trim()
      const marca = String(id.marca || '').trim()
      const key = forcedKey || code || `${produto}::${categoria}` || `${Math.random()}`
      const prev = byKey.get(key)
      if (!prev) {
        const base: any = {
          codigoBarras: code || undefined,
          produto: produto || undefined,
          categoria: categoria || undefined,
          marca: marca || undefined,
          qualityIssue: undefined,
          qualityMessage: undefined,
          qualitySeverity: undefined,
          estoqueAtual: undefined,
          estoqueMinimo: undefined,
          diferenca: undefined,
          percentual: null,
          dataValidade: null,
          dias: null,
          ...patch
        }
        const tags = new Set<AlertaStatusTag>()
        if (tag) tags.add(tag)
        byKey.set(key, { base, tags })
        return
      }
      Object.assign(prev.base, patch)
      if (tag) prev.tags.add(tag)
    }

    // Stock alerts (insights)
    for (const a of Array.isArray(insightsAlertas) ? insightsAlertas : []) {
      const estoqueAtual = Number(a?.estoqueAtual) || 0
      const estoqueMinimo = Number(a?.estoqueMinimo) || 0
      const backendStatus = String((a as any)?.statusAlerta || '').trim().toUpperCase()
      const st = backendStatus === 'URGENTE' || backendStatus === 'ATENCAO' ? backendStatus : calcularStatusEstoque(estoqueAtual, estoqueMinimo)
      const tag: AlertaStatusTag | null = st === 'URGENTE' ? 'URGENTE' : st === 'ATENCAO' ? 'ATENCAO' : null
      if (!tag) continue
      upsert(
        { codigoBarras: a.codigoBarras, produto: a.produto, categoria: a.categoria },
        {
          estoqueAtual,
          estoqueMinimo,
          diferenca: Number.isFinite(Number(a?.diferenca)) ? Number(a.diferenca) : estoqueAtual - estoqueMinimo,
          percentual: a?.percentual != null ? Number(a.percentual) : null
        },
        tag
      )
    }

    // Validity alerts (overview)
    for (const it of Array.isArray(overviewNotifications?.expiringSoon) ? overviewNotifications!.expiringSoon : []) {
      upsert(
        { codigoBarras: (it as any)?.codigoBarras, produto: (it as any)?.produto, categoria: (it as any)?.categoria },
        {
          estoqueAtual: Number((it as any)?.estoqueAtual) || 0,
          dataValidade: (it as any)?.dataValidade ? String((it as any).dataValidade) : null,
          dias: Number.isFinite(Number((it as any)?.dias)) ? Number((it as any).dias) : null
        },
        'VENCENDO'
      )
    }
    for (const it of Array.isArray(overviewNotifications?.expiredWithStock) ? overviewNotifications!.expiredWithStock : []) {
      upsert(
        { codigoBarras: (it as any)?.codigoBarras, produto: (it as any)?.produto, categoria: (it as any)?.categoria },
        {
          estoqueAtual: Number((it as any)?.estoqueAtual) || 0,
          dataValidade: (it as any)?.dataValidade ? String((it as any).dataValidade) : null,
          dias: null
        },
        'EXPIRADO'
      )
    }

    // Quality issues (overview)
    const qualityIssues = Array.isArray(overviewQuality?.issues) ? overviewQuality!.issues! : []
    for (const [idx, it] of qualityIssues.entries()) {
      const severityRaw = String(it?.severity || '').trim()
      const severity = severityRaw.toUpperCase()
      const tag: AlertaStatusTag =
        severity === 'CRITICAL'
          ? 'URGENTE'
          : (severity === 'WARN' || severity === 'WARNING')
            ? 'ATENCAO'
            : 'INFO'

      const registro = String(it?.registro || '').trim()
      const codigo = String(it?.codigoBarras || '').trim()
      let produto = String(it?.produto || '').trim()
      let categoria = ''
      let marca = ''
      let found: Insumo | undefined
      if (registro) {
        found = (insumosRef.current || []).find((i) => String(i?.registro || '').trim() === registro)
      }
      if (!found && codigo) {
        found = (insumosRef.current || []).find((i) => getInsumoBarcodes(i).includes(codigo))
      }
      if (!found && produto) {
        const produtoKey = normalizeText(produto)
        found = (insumosRef.current || []).find((i) => normalizeText(String(i?.produto || '').trim()) === produtoKey)
      }
      if (found) {
        if (!produto) produto = String(found.produto || '').trim()
        categoria = String(found.categoria || '').trim()
        marca = String(found.marca || '').trim()
      }
      const message = String(it?.message || it?.suggestion || '').trim()
      const forcedKey = `quality:${String(it?.code || 'ISSUE')}::${registro || codigo || produto || idx}`
      upsert(
        { codigoBarras: codigo, produto, categoria, marca },
        {
          qualityIssue: it,
          qualityMessage: message || undefined,
          qualitySeverity: severityRaw || undefined
        },
        tag,
        forcedKey
      )
    }

    const rows: AlertasLinha[] = []
    for (const [key, v] of byKey.entries()) {
      if (!v.base.marca) {
        const code = String(v.base.codigoBarras || '').trim()
        const produto = String(v.base.produto || '').trim()
        const categoria = String(v.base.categoria || '').trim()
        let found: Insumo | undefined
        if (code) {
          found = (insumosRef.current || []).find((i) => getInsumoBarcodes(i).includes(code))
        }
        if (!found && produto) {
          const produtoKey = normalizeText(produto)
          const categoriaKey = normalizeText(categoria)
          found = (insumosRef.current || []).find((i) => {
            if (normalizeText(String(i.produto || '').trim()) !== produtoKey) return false
            if (categoriaKey && normalizeText(String(i.categoria || '').trim()) !== categoriaKey) return false
            return true
          })
        }
        if (found?.marca) v.base.marca = String(found.marca || '').trim()
      }
      rows.push({ key, ...v.base, tags: normalizeAlertTags(v.tags) })
    }

    const severityRank = (tags: AlertaStatusTag[]) => {
      if (tags.includes('URGENTE')) return 0
      if (tags.includes('EXPIRADO')) return 1
      if (tags.includes('VENCENDO')) return 2
      if (tags.includes('ATENCAO')) return 3
      if (tags.includes('INFO')) return 4
      return 9
    }

    rows.sort((a, b) => {
      const ra = severityRank(a.tags)
      const rb = severityRank(b.tags)
      if (ra !== rb) return ra - rb
      const ca = String(a.categoria || '')
      const cb = String(b.categoria || '')
      const catCmp = ca.localeCompare(cb, 'pt-BR', { sensitivity: 'base' })
      if (catCmp !== 0) return catCmp
      return String(a.produto || '').localeCompare(String(b.produto || ''), 'pt-BR', { sensitivity: 'base' })
    })

    return rows
  }, [insightsAlertas, overviewNotifications, overviewQuality, calcularStatusEstoque])

  const alertasCategorias = React.useMemo(() => {
    return Array.from(new Set(alertasLinhas.map((a) => String(a.categoria || '').trim()).filter(Boolean))).sort((a, b) =>
      a.localeCompare(b, 'pt-BR', { sensitivity: 'base' })
    )
  }, [alertasLinhas])

  type AlertasRecommendation =
    | { kind: 'TRANSFERENCIA'; fromUnidade?: string | null; toUnidade?: string | null; qty?: number | null }
    | { kind: 'ENTRADA'; qty?: number | null }

  const alertasRecommendationByCode = React.useMemo(() => {
    const map = new Map<string, AlertasRecommendation>()

    for (const t of Array.isArray(overviewActionables?.transferencias) ? overviewActionables!.transferencias : []) {
      const code = String((t as any)?.codigoBarras || '').trim()
      if (!code) continue
      const qty = Number((t as any)?.qty) || 0
      const prev = map.get(code)
      if (!prev || prev.kind !== 'TRANSFERENCIA' || qty > (Number(prev.qty) || 0)) {
        map.set(code, {
          kind: 'TRANSFERENCIA',
          fromUnidade: (t as any)?.from != null ? String((t as any).from) : null,
          toUnidade: (t as any)?.to != null ? String((t as any).to) : null,
          qty: qty || null
        })
      }
    }

    for (const r of Array.isArray(overviewActionables?.reposicao) ? overviewActionables!.reposicao : []) {
      const code = String((r as any)?.codigoBarras || '').trim()
      if (!code) continue
      // Prefer transfer suggestion over purchase suggestion if both exist.
      if (map.get(code)?.kind === 'TRANSFERENCIA') continue
      const qty = Number((r as any)?.suggestedPurchaseQty) || 0
      map.set(code, { kind: 'ENTRADA', qty: qty || null })
    }

    return map
  }, [overviewActionables])

  const alertasLinhasFiltradas = React.useMemo(() => {
    const q = alertasBusca.trim().toLowerCase()
    return alertasLinhas.filter((a) => {
      if (alertasCategoria && String(a.categoria || '') !== alertasCategoria) return false
      if (alertasMarca && String(a.marca || '') !== alertasMarca) return false
      if (alertasStatus !== 'TODOS') {
        if (alertasStatus === 'ATENCAO') {
          if (!a.tags.includes('ATENCAO') && !a.tags.includes('VENCENDO')) return false
        } else if (alertasStatus === 'URGENTE') {
          if (!a.tags.includes('URGENTE') && !a.tags.includes('EXPIRADO')) return false
        } else if (!a.tags.includes(alertasStatus as any)) {
          return false
        }
      }
      if (!q) return true
      const hay = [a.produto, a.categoria, a.marca, a.codigoBarras, a.qualityMessage].filter(Boolean).join(' ').toLowerCase()
      return hay.includes(q)
    })
  }, [alertasBusca, alertasCategoria, alertasLinhas, alertasMarca, alertasStatus])

  const alertasLinhasOrdenadas = React.useMemo(() => {
    const rows = alertasLinhasFiltradas.map((row, index) => ({ row, index }))
    const statusOrder: AlertaStatusTag[] = ['URGENTE', 'ATENCAO', 'INFO']
    const statusRank = (tags: AlertaStatusTag[]) => {
      const derived = new Set(tags)
      if (derived.has('EXPIRADO')) derived.add('URGENTE')
      if (derived.has('VENCENDO')) derived.add('ATENCAO')
      for (let i = 0; i < statusOrder.length; i++) {
        if (derived.has(statusOrder[i])) return i
      }
      return statusOrder.length
    }
    const actionLabel = (row: AlertasLinha) => {
      const code = String(row.codigoBarras || '').trim()
      const rec = code ? alertasRecommendationByCode.get(code) || null : null
      if (rec?.kind === 'TRANSFERENCIA') {
        return `transferencia ${rec.fromUnidade || ''} ${rec.toUnidade || ''}`.trim()
      }
      if (rec?.kind === 'ENTRADA') return 'reposicao'
      if (row.qualityMessage) return String(row.qualityMessage)
      if (row.tags.includes('EXPIRADO')) return 'descarte'
      if (row.tags.includes('VENCENDO')) return 'saida'
      return ''
    }
    const dir = alertasSortDir === 'asc' ? 1 : -1
    const compareText = (a: string, b: string) => a.localeCompare(b, 'pt-BR', { sensitivity: 'base' })
    rows.sort((a, b) => {
      const ra = a.row
      const rb = b.row
      let cmp = 0
      switch (alertasSortKey) {
        case 'produto':
          cmp = compareText(String(ra.produto || ''), String(rb.produto || ''))
          break
        case 'categoria':
          cmp = compareText(String(ra.categoria || ''), String(rb.categoria || ''))
          break
        case 'status':
          cmp = statusRank(ra.tags) - statusRank(rb.tags)
          break
        case 'acao':
          cmp = compareText(actionLabel(ra), actionLabel(rb))
          break
        case 'atual':
          cmp = (Number(ra.estoqueAtual) || 0) - (Number(rb.estoqueAtual) || 0)
          break
        case 'min':
          cmp = (Number(ra.estoqueMinimo) || 0) - (Number(rb.estoqueMinimo) || 0)
          break
        case 'dif':
          cmp = (Number(ra.diferenca) || 0) - (Number(rb.diferenca) || 0)
          break
        case 'percentual':
          cmp = (Number(ra.percentual) || 0) - (Number(rb.percentual) || 0)
          break
        default:
          cmp = 0
      }
      if (cmp !== 0) return cmp * dir
      return a.index - b.index
    })
    return rows.map((r) => r.row)
  }, [alertasLinhasFiltradas, alertasRecommendationByCode, alertasSortDir, alertasSortKey])

  const fmtAge = React.useCallback((ts?: number) => {
    const t = Number(ts) || 0
    if (!t) return '-'
    const sec = Math.max(0, Math.floor((Date.now() - t) / 1000))
    if (sec < 60) return `${sec}s`
    const min = Math.floor(sec / 60)
    if (min < 60) return `${min}m`
    const h = Math.floor(min / 60)
    return `${h}h`
  }, [])

  const movimentacoesView = React.useMemo(() => {
    const list = Array.isArray(movimentacoes) ? movimentacoes : []
    const selectedCode = selectedCodigoBarras.trim()
    const filterProduto = normalizeText(movFilterProduto)
    const filterCategoria = normalizeText(movFilterCategoria)
    const filterMarca = normalizeText(movFilterMarca)
    const filterSearch = normalizeText(movSearch)

    const applyFiltersAndSort = (base: Movimentacao[]) => {
      const filtered = base.filter((m) => {
        if (selectedCode) {
          if (String(m?.codigoBarras || '').trim() !== selectedCode) return false
        } else if (filterSearch) {
          const insumo = pickInsumoForMov(m)
          const produtoNome = normalizeText(String(insumo?.produto || m?.produto || '').trim())
          const categoriaNome = normalizeText(insumo?.categoria || '')
          const marcaNome = normalizeText(insumo?.marca || m?.marca || '')
          const codigoBarras = normalizeText(String(m?.codigoBarras || insumo?.codigoBarras || '').trim())
          if (
            !(
              (produtoNome && produtoNome.includes(filterSearch)) ||
              (categoriaNome && categoriaNome.includes(filterSearch)) ||
              (marcaNome && marcaNome.includes(filterSearch)) ||
              (codigoBarras && codigoBarras.includes(filterSearch))
            )
          ) {
            return false
          }
        } else if (filterProduto) {
          const insumo = pickInsumoForMov(m)
          const produtoNome = normalizeText(String(insumo?.produto || m?.produto || '').trim())
          if (!produtoNome || produtoNome !== filterProduto) return false
        }

        if (filterCategoria) {
          const insumo = pickInsumoForMov(m)
          const categoriaNome = normalizeText(insumo?.categoria || '')
          if (!categoriaNome || categoriaNome !== filterCategoria) return false
        }

        if (filterMarca) {
          const insumo = pickInsumoForMov(m)
          const marcaNome = normalizeText(insumo?.marca || '')
          if (!marcaNome || marcaNome !== filterMarca) return false
        }
        return true
      })

      const dir = movSortDir === 'asc' ? 1 : -1
      const getSortValue = (m: Movimentacao) => {
        if (movSortKey === 'dataHora') return new Date(m?.dataHora || 0).getTime() || 0
        if (movSortKey === 'usuario') return String(m?.usuario || '').trim().toLowerCase()
        if (movSortKey === 'observacao') {
          const v = m?.transferId
            ? `transferencia ${String(m?.unidadeOrigem || '')}->${String(m?.unidadeDestino || '')}`
            : String(m?.motivo || m?.observacoes || '').trim()
          return v.toLowerCase()
        }

        const insumo = pickInsumoForMov(m)
        if (movSortKey === 'produto') return String(insumo?.produto || m?.produto || '').trim().toLowerCase()
        if (movSortKey === 'categoria') return String(insumo?.categoria || '').trim().toLowerCase()
        if (movSortKey === 'marca') return String(insumo?.marca || '').trim().toLowerCase()
        if (movSortKey === 'estoque') return Number(m?.estoqueNovo ?? m?.estoqueAnterior ?? 0) || 0
        if (movSortKey === 'valor') {
          const preco = Number(m?.preco) || Number(insumo?.precoCusto) || 0
          const qtd = Number(m?.quantidade) || 0
          return preco * qtd
        }
        return 0
      }

      filtered.sort((a, b) => {
        const av = getSortValue(a) as any
        const bv = getSortValue(b) as any
        if (typeof av === 'number' && typeof bv === 'number') {
          if (av !== bv) return (av - bv) * dir
          return (new Date(a?.dataHora || 0).getTime() - new Date(b?.dataHora || 0).getTime()) * dir
        }
        const cmp = String(av).localeCompare(String(bv), 'pt-BR', { sensitivity: 'base' })
        if (cmp !== 0) return cmp * dir
        return (new Date(a?.dataHora || 0).getTime() - new Date(b?.dataHora || 0).getTime()) * dir
      })

      return filtered
    }

    if (!movGroupTransfers || movTipo !== 'TODOS') return applyFiltersAndSort(list)

    const byTransfer = new Map<string, Movimentacao[]>()
    for (const m of list) {
      const id = String((m as any)?.transferId || '').trim()
      if (!id) continue
      const arr = byTransfer.get(id) || []
      arr.push(m)
      byTransfer.set(id, arr)
    }

    const seen = new Set<string>()
    const out: Movimentacao[] = []
    for (const m of list) {
      const id = String((m as any)?.transferId || '').trim()
      if (!id) {
        out.push(m)
        continue
      }
      if (seen.has(id)) continue
      seen.add(id)

      const group = byTransfer.get(id) || [m]
      if (group.length < 2) {
        out.push(m)
        continue
      }

      const pick = group.reduce((best, cur) => {
        const bt = new Date(best?.dataHora || 0).getTime()
        const ct = new Date(cur?.dataHora || 0).getTime()
        return ct > bt ? cur : best
      }, group[0])

      const quantidade = group.reduce((acc, cur) => Math.max(acc, Number(cur?.quantidade) || 0), 0)
      const unidadeOrigem = String((pick as any)?.unidadeOrigem || '').trim()
      const unidadeDestino = String((pick as any)?.unidadeDestino || '').trim()

      out.push({
        ...pick,
        tipo: 'TRANSFERÊNCIA',
        quantidade,
        unidadeOrigem,
        unidadeDestino,
        transferId: id
      } as any)
    }
    return applyFiltersAndSort(out)
  }, [
    movGroupTransfers,
    movSortDir,
    movSortKey,
    movTipo,
    movFilterCategoria,
    movFilterMarca,
    movFilterProduto,
    movSearch,
    movimentacoes,
    pickInsumoForMov,
    selectedCodigoBarras
  ])

  React.useEffect(() => {
    movRef.current = movimentacoes
  }, [movimentacoes])

  return (
    <div ref={rootRef} className="px-3 py-4 sm:p-6 space-y-4 sm:space-y-6">
      {autoSyncSuspended ? (
        <div className="rounded-xl border border-amber-400/40 bg-amber-500/10 p-3 text-amber-100 flex flex-wrap items-center gap-3">
          <div className="text-sm">
            API instável detectada. Sincronização automática de Overview/Insights pausada por {autoSyncRemainingSeconds}s.
          </div>
          <div className="ml-auto flex items-center gap-2">
            <Button
              variant="outline"
              className="border-amber-300/50 text-amber-100 hover:bg-amber-500/20"
              onClick={() => {
                apiFailureTimestampsRef.current = []
                setAutoSyncSuspendedUntil(0)
              }}
            >
              Retomar auto-sync
            </Button>
            <Button
              className="!bg-amber-600 hover:!bg-amber-700 !text-white"
              onClick={() => {
                apiFailureTimestampsRef.current = []
                setAutoSyncSuspendedUntil(0)
                void Promise.allSettled([loadOverview({ force: true }), loadInsights({ force: true }), refreshInsumos()])
              }}
            >
              Atualizar agora
            </Button>
          </div>
        </div>
      ) : null}
      <DragDropContext onDragEnd={onDragEndLayout}>
      <Dialog open={insumosListModalOpen} onOpenChange={setInsumosListModalOpen}>
        <DialogContent size="wideTable" className={dialogWideClass}>
          <DialogHeader>
            <DialogTitle>Insumos</DialogTitle>
            <DialogDescription>Lista e cadastro de insumos da unidade selecionada.</DialogDescription>
          </DialogHeader>

          <div className="space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex flex-wrap items-center gap-2">
                <Input
                  value={insumosQuery}
                  onChange={(e) => setInsumosQuery(e.target.value)}
                  placeholder="Buscar por código, produto, categoria…"
                  className="w-full sm:w-80"
                />
                <Button
                  variant="outline"
                  onClick={() => window.open(`/api/insumos/export/insumos.csv?unidade=${encodeURIComponent(unidade)}`, '_blank', 'noopener,noreferrer')}
                  disabled={!isAuthed}
                  title="Exportar CSV"
                >
                  Exportar
                </Button>
                <Button variant="outline" onClick={() => setCreateOpen((v) => !v)} disabled={!isAuthed}>
                  {createOpen ? 'Fechar' : 'Adicionar'}
                </Button>
              </div>
              <div className="text-xs text-blue-200/60">
                {insumosTotal != null ? (
                  <>
                    {filteredInsumos.length} de <span className="font-mono">{insumosTotal}</span> itens
                  </>
                ) : (
                  `${filteredInsumos.length} itens`
                )}
              </div>
            </div>

            {createOpen ? (
              <div className="rounded-xl border border-white/10 bg-black/20 p-3 space-y-3">
                <div className="text-sm text-blue-100/70">
                  Cadastro rápido (campos mínimos) + detalhes opcionais.
                </div>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
                  <div>
                    <div className="text-xs text-blue-200/70 mb-1">Código de barras</div>
                    <div className="flex flex-wrap items-center gap-2">
                      <Input value={createCodigo} onChange={(e) => setCreateCodigo(e.target.value)} placeholder="789..." />
                      <Button variant="secondary" type="button" onClick={() => setCreateScanOpen((v) => !v)}>
                        {createScanOpen ? 'Fechar' : 'Escanear'}
                      </Button>
                    </div>
                    <div className="mt-2">
                      {createLookupLoading ? (
                        <div className="text-xs text-blue-200/70">Buscando informações do insumo…</div>
                      ) : createLookupError ? (
                        <div className="text-xs text-red-200">{createLookupError}</div>
                      ) : createLookupItems?.length ? (
                        <div className="text-xs text-blue-200/70">
                          Encontrado no histórico: <span className="font-mono">{createLookupItems.length}</span> variação(ões)
                        </div>
                      ) : null}
                    </div>
                    <div className="mt-2">
                      <div className="text-xs text-blue-200/70 mb-1">Códigos adicionais</div>
                      <Textarea
                        value={createCodigosExtras}
                        onChange={(e) => setCreateCodigosExtras(e.target.value)}
                        placeholder="um por linha"
                        rows={3}
                        className="bg-white/[0.06] border-white/20 text-white"
                      />
                      <div className="mt-1 text-[10px] text-blue-200/50">
                        Opcional. Use para variações de código do mesmo produto.
                      </div>
                    </div>
                  </div>
                  <div className="md:col-span-2">
                    <div className="text-xs text-blue-200/70 mb-1">Produto</div>
                    <Input value={createProduto} onChange={(e) => setCreateProduto(e.target.value)} placeholder="ex: Toxina botulínica" />
                  </div>
	                  <div>
	                    <div className="text-xs text-blue-200/70 mb-1">Categoria</div>
	                    <Input
	                      value={createCategoria}
	                      onChange={(e) => setCreateCategoria(e.target.value)}
	                      placeholder="ex: toxina"
	                      list="insumos-categorias"
	                    />
	                    <datalist id="insumos-categorias">
	                      {lotCategorias.map((c) => (
	                        <option key={c} value={c} />
	                      ))}
	                    </datalist>
	                  </div>
                  <div className="md:col-span-2 rounded-xl border border-white/10 bg-black/10 p-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="text-xs text-blue-200/70">Política do item</div>
                      <div className="text-xs text-blue-200/60">Defina as regras para este insumo.</div>
                    </div>
                    <div className="mt-2 flex flex-wrap items-center gap-4 text-sm text-blue-100/80">
                      <label className={`flex items-center gap-2 ${isManagerRole ? 'cursor-pointer' : 'cursor-default'} select-none`}>
                        <Checkbox
                          checked={createCategoriaRequiresLot}
                          onCheckedChange={(v) => {
                            setCreatePolicyTouched(true)
                            setCreateCategoriaRequiresLot(!!v)
                          }}
                          disabled={!isManagerRole}
                        />
                        Lote obrigatório
                      </label>
                      <label className={`flex items-center gap-2 ${isManagerRole ? 'cursor-pointer' : 'cursor-default'} select-none`}>
                        <Checkbox
                          checked={createCategoriaRequiresExpiry}
                          onCheckedChange={(v) => {
                            setCreatePolicyTouched(true)
                            const next = !!v
                            setCreateCategoriaRequiresExpiry(next)
                            if (!next) setCreateCategoriaFefo(false)
                          }}
                          disabled={!isManagerRole}
                        />
                        Validade obrigatória
                      </label>
                      <label className={`flex items-center gap-2 ${isManagerRole ? 'cursor-pointer' : 'cursor-default'} select-none`}>
                        <Checkbox
                          checked={createCategoriaFefo}
                          onCheckedChange={(v) => {
                            setCreatePolicyTouched(true)
                            const next = !!v
                            setCreateCategoriaFefo(next)
                            if (next) setCreateCategoriaRequiresExpiry(true)
                          }}
                          disabled={!isManagerRole}
                        />
                        FEFO
                      </label>
                      {!isManagerRole ? <span className="text-xs text-blue-200/60">Somente gestores alteram.</span> : null}
                    </div>
                  </div>
	                  <div>
	                    <div className="text-xs text-blue-200/70 mb-1">Marca</div>
	                    <Input
	                      value={createMarca}
	                      onChange={(e) => setCreateMarca(e.target.value)}
	                      placeholder="ex: Allergan"
	                      list="insumos-marcas"
	                    />
	                    <datalist id="insumos-marcas">
	                      {insumosMarcas.map((m) => (
	                        <option key={m} value={m} />
	                      ))}
	                    </datalist>
	                  </div>
	                  <div>
	                    <div className="text-xs text-blue-200/70 mb-1">Tipo (unidade)</div>
	                    <Select
	                      value={normalizeTipoUnidadeToCanonical(createTipoUnidade) || undefined}
	                      onValueChange={setCreateTipoUnidade}
	                    >
	                      <SelectTrigger>
	                        <SelectValue placeholder="Selecione a unidade" />
	                      </SelectTrigger>
	                      <SelectContent>
	                        {insumosTiposUnidade.map((u) => (
	                          <SelectItem key={u} value={u}>
	                            {u}
	                          </SelectItem>
	                        ))}
	                      </SelectContent>
	                    </Select>
	                  </div>
                  <div>
                    <div className="text-xs text-blue-200/70 mb-1">Preço (custo)</div>
                    <Input value={createPrecoCusto} onChange={(e) => setCreatePrecoCusto(e.target.value)} placeholder="ex: 1200" />
                  </div>
                  <div>
                    <div className="text-xs text-blue-200/70 mb-1">Estoque mínimo</div>
                    <Input value={createEstoqueMinimo} onChange={(e) => setCreateEstoqueMinimo(e.target.value)} placeholder="ex: 5" />
                  </div>
	                  <div>
	                    <div className="text-xs text-blue-200/70 mb-1">Estoque inicial</div>
	                    <Input value={createEstoqueInicial} onChange={(e) => setCreateEstoqueInicial(e.target.value)} placeholder="ex: 0" />
	                  </div>
	                  <div>
	                    <div className="flex items-center justify-between gap-2 mb-1">
	                      <div className="text-xs text-blue-200/70">Lote</div>
	                      <Button
	                        variant={createNovoLote ? 'secondary' : 'outline'}
	                        size="sm"
	                        type="button"
	                        onClick={() => setCreateNovoLote((v) => !v)}
	                        title="Ative quando estiver cadastrando um lote adicional para um código já existente."
	                      >
	                        {createNovoLote ? 'Novo lote: on' : 'Novo lote: off'}
	                      </Button>
	                    </div>
	                    <Input
	                      value={createLote}
	                      onChange={(e) => setCreateLote(e.target.value)}
	                      placeholder={createNovoLote ? 'obrigatório (ex: L2026-01)' : 'opcional'}
	                    />
	                  </div>
	                  <div>
	                    <div className="text-xs text-blue-200/70 mb-1">Validade</div>
                      <BrDatePickerInput value={createDataValidade} onChange={setCreateDataValidade} placeholder="DD/MM/AA" ariaLabel="Validade" />
	                  </div>
	                </div>

                {createScanOpen ? (
                  <BarcodeScannerInline
                    onDetected={(code) => {
                      setCreateCodigo(code)
                      setCreateScanOpen(false)
                      toast.success('Código detectado')
                    }}
                    onClose={() => setCreateScanOpen(false)}
                  />
                ) : null}

                <div className="flex items-center justify-end gap-2">
                  <Button variant="secondary" onClick={() => setCreateOpen(false)}>
                    Cancelar
                  </Button>
                  <Button
                    onClick={async () => {
                      const codigoBarras = createCodigo.trim()
                      if (!codigoBarras) return toast.error('Informe o código de barras')
                      const extraCodes = parseBarcodeInput(createCodigosExtras)
                      const codigosBarras = Array.from(new Set([codigoBarras, ...extraCodes].map((v) => String(v || '').trim()).filter(Boolean)))
                      const existing = (insumos || []).find((i) => getInsumoBarcodes(i).includes(codigoBarras))
                      const categoria = createCategoria.trim() || String(existing?.categoria || '').trim()
                      const policy = {
                        requiresLot: !!createCategoriaRequiresLot,
                        requiresExpiry: !!createCategoriaRequiresExpiry,
                        fefo: !!createCategoriaFefo
                      }
                      const validadeIso = dateInputToIso(createDataValidade)

                      const allowDuplicateLot = createNovoLote || (!!existing && policy.requiresLot)
                      if (!createNovoLote && allowDuplicateLot) setCreateNovoLote(true)

                      if ((policy.requiresLot || allowDuplicateLot) && !createLote.trim()) {
                        return toast.error(policy.requiresLot ? 'Informe o lote (obrigatório pelo item)' : 'Informe o lote (Novo lote: on)')
                      }
                      if (policy.requiresExpiry && !validadeIso) {
                        return toast.error('Informe a data de validade (obrigatória pelo item)')
                      }
                      if (policy.fefo && !policy.requiresExpiry) {
                        return toast.error('FEFO exige validade obrigatória')
                      }

                      const produto = createProduto.trim() || (allowDuplicateLot ? String(existing?.produto || '').trim() : '')
                      if (!produto) return toast.error('Informe o produto')
                      const tipoUnidade = normalizeTipoUnidadeToCanonical(createTipoUnidade)
                      if (!tipoUnidade) return toast.error('Informe a unidade (medida)')

                      setCreateLoading(true)
                      try {
                        await mutateJson(`/insumos?unidade=${encodeURIComponent(unidade)}`, {
                          method: 'POST',
                          queueLabel: 'Cadastro de insumo',
                          body: {
                            codigoBarras,
                            codigosBarras,
                            produto,
                            allowDuplicateLot,
                            categoria,
                            marca: createMarca.trim(),
                            tipoUnidade,
                            especificacao: createEspecificacao.trim(),
                            concentracao: createConcentracao.trim(),
                            volume: createVolume.trim(),
                            fonte: createHomologado ? 'Homologado' : '',
                            calibre: createCalibre.trim(),
                            precoCusto: createPrecoCusto ? Number(createPrecoCusto) : undefined,
                            estoqueInicial: createEstoqueInicial ? Number(createEstoqueInicial) : undefined,
                            estoqueMinimo: createEstoqueMinimo ? Number(createEstoqueMinimo) : undefined,
                            lote: createLote.trim(),
                            dataValidade: validadeIso || undefined,
                            policyRequiresLot: policy.requiresLot,
                            policyRequiresExpiry: policy.requiresExpiry,
                            policyFefo: policy.fefo
                          }
                        })
                        toast.success('Insumo cadastrado.')
                        setCreateCodigosExtras('')
                        setCreateOpen(false)
                        await Promise.allSettled([refreshInsumos({ pagina: 1 }), loadOverview({ force: true }), loadInsumosOptions()])
                      } catch (e) {
                        if (policyErrorToast(e)) return
                        toast.error(e instanceof Error ? e.message : String(e))
                      } finally {
                        setCreateLoading(false)
                      }
                    }}
                    disabled={!isAuthed || createLoading}
                  >
                    {createLoading ? 'Salvando…' : 'Salvar'}
                  </Button>
                </div>
              </div>
            ) : null}

            <div
              ref={insumosModalListContainerRef}
              onScroll={onInsumosModalScroll}
              className="overflow-auto max-h-[60vh] rounded-xl border border-white/10"
            >
              <table className="w-full min-w-[880px] table-auto text-sm">
                <thead className="bg-black/30 text-blue-100/80">
                  <tr>
                    <th className="text-left p-3 w-[30%]">Produto</th>
                    <th className="text-left p-3 hidden md:table-cell w-[20%]">Categoria</th>
                    <th className="text-left p-3 hidden lg:table-cell w-[18%]">Código</th>
                    <th className="text-right p-3 w-[6rem] whitespace-nowrap">Estoque</th>
                    <th className="text-right p-3 hidden sm:table-cell w-[5rem] whitespace-nowrap">Mín</th>
                    <th className="text-left p-3 hidden xl:table-cell w-[7rem] whitespace-nowrap">Validade</th>
                    <th className="text-right p-3 hidden xl:table-cell w-[7.5rem] whitespace-nowrap">Valor</th>
                    <th className="text-right p-3 w-[6.5rem] whitespace-nowrap">Ações</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/5">
                  {filteredInsumos.map((i, idx) => {
                    const codigoBarras = String(i.codigoBarras || '').trim()
                    const estoque = unidade && i?.estoques ? Number(i.estoques?.[unidade] ?? 0) : Number(i.estoqueAtual ?? 0)
                    const min = Number(i.estoqueMinimo) || 0
                    const valor = (Number(i.precoCusto) || 0) * (Number.isFinite(estoque) ? estoque : 0)
                    return (
                      <tr key={`${i.registro || ''}-${idx}`} className="hover:bg-white/5">
                        <td className="p-3 text-blue-50 align-top">
                          <div className="min-w-0">
                            <div className="font-medium break-words">{i.produto || '-'}</div>
                            <div className="mt-1 space-y-0.5">
                              <div className="text-xs text-blue-200/60 md:hidden break-words">{i.categoria || '-'}</div>
                              <div className="text-xs text-blue-200/60 lg:hidden font-mono break-all">{i.codigoBarras || '-'}</div>
                              <div className="text-xs text-blue-200/60 xl:hidden">{fmtDateOnlyBR(i.dataValidade || '') || '-'}</div>
                              <div className="text-xs text-blue-200/60 xl:hidden">{fmtMoneyBRL(valor)}</div>
                            </div>
                          </div>
                        </td>
                        <td className="p-3 text-blue-100/80 hidden md:table-cell align-middle">
                          <div className="break-words">{i.categoria || '-'}</div>
                        </td>
                        <td className="p-3 font-mono text-blue-100/70 hidden lg:table-cell align-middle break-all">{i.codigoBarras || '-'}</td>
                        <td className="p-3 text-right text-blue-100/80 font-mono align-middle whitespace-nowrap">{Number.isFinite(estoque) ? estoque : '-'}</td>
                        <td className="p-3 text-right text-blue-100/70 font-mono hidden sm:table-cell align-middle whitespace-nowrap">{min || '-'}</td>
                        <td className="p-3 text-blue-100/70 hidden xl:table-cell align-middle whitespace-nowrap">{fmtDateOnlyBR(i.dataValidade || '')}</td>
                        <td className="p-3 text-right text-blue-100/80 hidden xl:table-cell align-middle whitespace-nowrap">{fmtMoneyBRL(valor)}</td>
                        <td className="p-3 text-right align-middle whitespace-nowrap">
                          <div className="flex items-center justify-end">
                            <Button variant="outline" size="sm" className="h-8 px-3 text-xs" onClick={() => openEditDialog(i)} disabled={!isAuthed}>
                              Editar
                            </Button>
                          </div>
                        </td>
                      </tr>
                    )
                  })}
                  {!filteredInsumos.length ? (
                    <tr>
                      <td className="p-3 text-blue-100/70" colSpan={8}>
                        {insumosLoadError && !insumosLoading && isAuthed ? (
                          <span className="text-red-200">
                            Erro ao carregar insumos ({insumosLoadError.status || 'erro'}
                            {insumosLoadError.code ? `/${insumosLoadError.code}` : ''}): {insumosLoadError.message}
                          </span>
                        ) : (
                          renderListPlaceholder(insumosLoading, 'Sem itens.')
                        )}
                      </td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </div>
            {insumosHasMore ? <div className="text-xs text-blue-200/60">Role até o fim para carregar mais…</div> : null}
          </div>
        </DialogContent>
      </Dialog>
      <Dialog open={offlineDialogOpen} onOpenChange={setOfflineDialogOpen}>
        <DialogContent className={dialogSmallClass}>
          <DialogHeader>
            <DialogTitle>Pendências de sincronização</DialogTitle>
            <DialogDescription>
              Operações salvas localmente quando a rede cai. Ao reconectar, clique em “Sincronizar”.
            </DialogDescription>
          </DialogHeader>

          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="text-sm text-muted-foreground">
              Itens: <span className="font-mono">{offlineItems.length}</span>
            </div>
            <div className="flex items-center gap-2">
              <Button variant="secondary" onClick={() => void syncOfflineQueue()} disabled={!isAuthed || !offlineItems.length}>
                Sincronizar
              </Button>
              <Button
                variant="destructive"
                onClick={() => {
                  if (!offlineItems.length) return
                  if (!window.confirm('Limpar a fila offline? Você perderá as operações pendentes.')) return
                  try {
                    window.localStorage.removeItem(OFFLINE_QUEUE_KEY)
                  } catch {
                    // ignore
                  }
                  setOfflineItems([])
                  setOfflineQueueCount(0)
                  toast.success('Fila limpa.')
                }}
                disabled={!offlineItems.length}
              >
                Limpar
              </Button>
            </div>
          </div>

          {debugUi ? (
            <div className="overflow-auto max-h-[60vh] rounded-xl border border-white/10">
              <table className="min-w-full text-sm">
                <thead className="bg-black/30 text-blue-100/80">
                  <tr>
                    <th className="text-left p-3">Quando</th>
                    <th className="text-left p-3">Método</th>
                    <th className="text-left p-3">Endpoint</th>
                    <th className="text-right p-3">Ações</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/5">
                  {offlineItems.map((it) => (
                    <tr key={it.id} className="hover:bg-white/5">
                      <td className="p-3 text-blue-100/70">{fmtAge(it.ts)}</td>
                      <td className="p-3 text-blue-100/80 font-mono">{it.method}</td>
                      <td className="p-3 text-blue-50 font-mono">{it.path}</td>
                      <td className="p-3 text-right">
                        <Button
                          variant="outline"
                          onClick={async () => {
                            try {
                              await navigator.clipboard.writeText(JSON.stringify(it, null, 2))
                              toast.success('Copiado.')
                            } catch (e: any) {
                              toast.error(e?.message || 'Não foi possível copiar.')
                            }
                          }}
                        >
                          Copiar
                        </Button>
                      </td>
                    </tr>
                  ))}
                  {!offlineItems.length ? (
                    <tr>
                      <td className="p-3 text-blue-100/70" colSpan={4}>
                        Sem itens pendentes.
                      </td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="rounded-xl border border-white/10 bg-black/20 p-3 text-sm text-blue-100/70">
              {offlineItems.length ? (
                <div>
                  Existem <span className="font-semibold text-blue-100">{offlineItems.length}</span> operações pendentes. Clique em
                  “Sincronizar” quando estiver online.
                </div>
              ) : (
                <div>Sem pendências.</div>
              )}
              <div className="mt-2">
                <Button variant="outline" size="sm" onClick={toggleDebugUi}>
                  Ver detalhes técnicos
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      <Dialog
        open={quickOp != null}
        onOpenChange={(open) => {
          if (open) return
          resetQuickOperationState({ keepFeedback: !!quickActionFeedback })
          setQuickOp(null)
        }}
      >
      <DialogContent className={`${dialogLargeClass} dark bg-corporate-900 border-white/10 text-white`}>
          <DialogHeader>
            <DialogTitle className="text-white">
              {quickOp === 'ENTRADA'
                ? 'Entrada'
                : quickOp === 'BAIXA'
                  ? 'Saída'
                  : quickOp === 'TRANSFERENCIA'
                    ? 'Transferência'
                    : 'Operação'}
            </DialogTitle>
            <DialogDescription className="text-blue-100/70">
              Preencha os dados para registrar a operação na unidade selecionada.
            </DialogDescription>
          </DialogHeader>

          {!isAuthed ? (
            shouldShowDashboardLoading ? (
              <DashboardLoadingButton size="sm" />
            ) : (
              <div className="text-sm text-blue-100/80">Faça login no CRM para usar as operações de Insumos.</div>
            )
          ) : null}

          <div className="rounded-lg border border-blue-400/40 bg-blue-500/10 px-3 py-2 text-xs text-blue-100">
            {quickOp === 'TRANSFERENCIA'
              ? `Unidade da operação: ${unidadeLabel(transferFrom)} → ${unidadeLabel(transferTo)}`
              : `Unidade da operação: ${unidadeLabel(unidade)}`}
          </div>

          <div className="space-y-3">
            <div>
              <div className="text-xs text-blue-200/70 mb-1">Buscar por produto, marca, categoria ou código</div>
              <div className="flex flex-wrap items-center gap-2">
                <Input
                  value={quickSearch}
                  onChange={(e) => setQuickSearch(e.target.value)}
                  placeholder="ex: Rennova, preenchedor, 789..."
                  className="w-full sm:flex-1 sm:min-w-[240px]"
                />
                <Button variant="secondary" type="button" onClick={() => setQuickScanOpen((v) => !v)}>
                  {quickScanOpen ? 'Fechar' : 'Escanear'}
                </Button>
              </div>
              <div className="mt-2">
                {quickSearchRemoteLoading ? (
                  <div className="text-xs text-blue-200/70">Buscando no servidor…</div>
                ) : quickSearchRemoteError ? (
                  <div className="text-xs text-amber-200">{quickSearchRemoteError} (mostrando cache local).</div>
                ) : null}
                {quickSearchMatches.length && (!hasQuickSelection || quickLookupLoading) ? (
                  <div className="rounded-lg border border-white/10 bg-black/20 px-3 py-2">
                    <div className="text-[11px] text-blue-200/60 mb-2">Selecione o produto para lançar a operação:</div>
                    <div className="space-y-2">
                      {quickSearchMatches.map(({ item, matchedCode }) => {
                        const codes = getInsumoBarcodes(item)
                        const code = matchedCode && codes.includes(matchedCode) ? matchedCode : codes[0] || ''
                        const hasCode = !!code
                        const descriptor = formatInsumoDescriptor(item)
                        const primarySelected = quickSelectedSnapshot || (quickLookupItems.length ? quickLookupItems[0] : null)
                        const isLoadingSelection = !!(quickLookupLoading && primarySelected && isSameInsumo(item, primarySelected))
                        return (
                          <div
                            key={`${item.registro || ''}-${code || 'nocode'}`}
                            className="w-full min-w-0 rounded-md border border-white/5 bg-white/5 px-2 py-2"
                          >
                            <button
                              type="button"
                              onClick={() => applyQuickSelection(item, code)}
                              disabled={!hasCode || isLoadingSelection}
                              className={`w-full text-left ${(!hasCode || isLoadingSelection) ? 'cursor-not-allowed' : 'hover:bg-white/10'} rounded-md px-1 py-1`}
                              aria-busy={isLoadingSelection}
                            >
                              <div className="flex flex-wrap items-center justify-between gap-2">
                                <div className="text-sm text-blue-50 font-semibold break-words">{String(item.produto || 'Insumo')}</div>
                                <div className="flex items-center gap-2 text-xs text-blue-200/60 font-mono break-all">
                                  {code || '—'}
                                  {isLoadingSelection ? (
                                    <span className="inline-flex items-center gap-1 text-blue-200/70 font-sans">
                                      <span className="inline-flex h-3 w-3 rounded-full border border-blue-200/70 border-t-transparent animate-spin" />
                                      Carregando…
                                    </span>
                                  ) : null}
                                </div>
                              </div>
                              {descriptor ? (
                                <div className="text-xs text-blue-200/70 mt-0.5 break-words">{descriptor}</div>
                              ) : null}
                              {!hasCode ? (
                                <div className="text-xs text-amber-200 mt-1">Sem código de barras cadastrado</div>
                              ) : null}
                              <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-blue-200/70">
                                {item.categoria ? (
                                  <Badge style={buildTagStyle(getCategoriaBgColor(String(item.categoria)))} className="border">
                                    {String(item.categoria)}
                                  </Badge>
                                ) : null}
                                {item.marca ? (
                                  <Badge style={buildTagStyle(getMarcaBgColor(String(item.marca)))} className="border">
                                    {String(item.marca)}
                                  </Badge>
                                ) : null}
                              </div>
                            </button>
                            {!hasCode ? (
                              <div className="mt-2 flex justify-end">
                                <Button
                                  variant="outline"
                                  size="sm"
                                  onClick={() => openEditDialog(item)}
                                  disabled={!isAuthed}
                                >
                                  Editar cadastro
                                </Button>
                              </div>
                            ) : null}
                          </div>
                        )
                      })}
                    </div>
                  </div>
                ) : null}
                {quickLookupLoading ? (
                  <div className="text-xs text-blue-200/70">Buscando informações do insumo…</div>
                ) : quickLookupError ? (
                  <div className="text-xs text-red-200">{quickLookupError}</div>
                ) : (quickLookupItems.length || quickSelectedSnapshot) ? (
                  (() => {
                    const selected = quickLookupItems[0] || quickSelectedSnapshot
                    if (!selected) return null
                    const selectedCodes = getInsumoBarcodes(selected)
                    const activeCode = quickCodigo.trim() || selectedCodes[0] || ''
                    const resumoBase = quickLookupItems.length ? quickLookupItems : [selected]
                    return (
                      <div className="rounded-lg border border-blue-400/40 bg-blue-500/10 px-3 py-2">
                        <div className="flex flex-wrap items-start justify-between gap-2">
                          <div>
                            <div className="text-xs uppercase tracking-wide text-blue-200/70">Selecionado</div>
                            <div className="text-sm text-blue-50 font-semibold">
                              {String(selected?.produto || '').trim() || 'Insumo'}
                            </div>
                            {formatInsumoDescriptor(selected) ? (
                              <div className="text-xs text-blue-200/70 mt-0.5">
                                {formatInsumoDescriptor(selected)}
                              </div>
                            ) : null}
                          </div>
                          <div className="flex flex-col items-end gap-2 text-xs text-blue-200/70">
                            <Button variant="outline" size="sm" onClick={clearQuickSelection}>
                              Trocar seleção
                            </Button>
                            <div className="text-right">
                              {(() => {
                                const ctx = quickOp === 'TRANSFERENCIA' ? transferFrom : unidade
                                const total = resumoBase.reduce((acc, it) => {
                                  const v = ctx && (it as any)?.estoques ? Number((it as any).estoques?.[ctx] ?? 0) : Number((it as any).estoqueAtual ?? 0)
                                  return acc + (Number.isFinite(v) ? v : 0)
                                }, 0)
                                return `Estoque: ${total}`
                              })()}
                              {' • '}
                              {Array.from(new Set(resumoBase.map((it) => String((it as any)?.registro || '').trim()).filter(Boolean))).length} registros
                            </div>
                          </div>
                        </div>
                        {selectedCodes.length > 1 ? (
                          <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-blue-200/70">
                            <span className="uppercase tracking-wide">Código</span>
                            <Select value={activeCode} onValueChange={(v) => selectQuickCodigo(v, { snapshot: selected })}>
                              <SelectTrigger className="h-8">
                                <SelectValue placeholder="Selecione o código" />
                              </SelectTrigger>
                              <SelectContent>
                                {selectedCodes.map((c) => (
                                  <SelectItem key={c} value={c}>
                                    <span className="font-mono">{c}</span>
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          </div>
                        ) : null}
                        <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-blue-200/70">
                          {selected?.categoria ? (
                            <Badge style={buildTagStyle(getCategoriaBgColor(String(selected.categoria)))} className="border">
                              {String(selected.categoria)}
                            </Badge>
                          ) : null}
                          {selected?.marca ? (
                            <Badge style={buildTagStyle(getMarcaBgColor(String(selected.marca)))} className="border">
                              {String(selected.marca)}
                            </Badge>
                          ) : null}
                        </div>
                      </div>
                    )
                  })()
                ) : null}
              </div>
            </div>

            {quickLoteNeedsPick ? (
              <div className="rounded-xl border border-white/10 bg-black/20 p-3 space-y-2">
                  <div className="flex items-center justify-between gap-2">
                    <div className="text-xs text-blue-200/70">Lote/registro</div>
                    {(quickOp === 'BAIXA' || quickOp === 'TRANSFERENCIA') &&
                      quickLotesForPicker.length > 1 &&
                      getPolicyForItem(quickLookupItems?.[0] || null).fefo ? (
                    <Button
                      variant="outline"
                      size="sm"
                      type="button"
                      onClick={() => setQuickAutoFefo((v) => !v)}
                      title="FEFO (First-Expire, First-Out): prioriza o lote com validade mais próxima"
                    >
                      FEFO {quickAutoFefo ? 'auto' : 'manual'}
                    </Button>
                  ) : null}
                </div>
                <Select
                  value={quickRegistro}
                  onValueChange={(v) => {
                    setQuickRegistro(v)
                    setQuickAutoFefo(false)
                  }}
                >
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder="Selecione o lote/registro" />
                  </SelectTrigger>
                  <SelectContent>
                    {quickLotesForPicker.map((l) => (
                      <SelectItem key={l.registro} value={l.registro}>
                        <span className="flex w-full items-center justify-between gap-3">
                          <span className="font-mono">{l.registro}</span>
                          <span className="flex items-center gap-2 text-xs text-blue-100/70">
                            {l.lote ? <span>Lote {l.lote}</span> : null}
                            {l.dataValidade ? <span>Vence {fmtDateOnlyBR(l.dataValidade)}</span> : null}
                            {Number.isFinite(Number(l.estoque)) ? <span>Estoque {Number(l.estoque)}</span> : null}
                          </span>
                        </span>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <div className="text-xs text-blue-200/60">
                  Se o produto tiver múltiplos lotes, selecione qual registro deve ser movimentado.
                </div>
              </div>
            ) : null}

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              <div>
                <div className="text-xs text-blue-200/70 mb-1">Quantidade</div>
                <Input value={quickQuantidade} onChange={(e) => setQuickQuantidade(e.target.value)} type="number" min={1} />
              </div>
              <div>
                <div className="text-xs text-blue-200/70 mb-1">Observações</div>
                <Input value={quickObs} onChange={(e) => setQuickObs(e.target.value)} placeholder="opcional" />
              </div>
            </div>

            {quickOp === 'TRANSFERENCIA' ? (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                <div>
                  <div className="text-xs text-blue-200/70 mb-1">Origem</div>
                  <Select value={transferFrom} onValueChange={setTransferFrom}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {unidadeOptions.map((u) => (
                        <SelectItem key={u} value={u}>
                          {unidadeLabel(u)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <div className="text-xs text-blue-200/70 mb-1">Destino</div>
                  <Select value={transferTo} onValueChange={setTransferTo}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {unidadeOptions.map((u) => (
                        <SelectItem key={u} value={u}>
                          {unidadeLabel(u)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
            ) : null}

            {quickScanOpen ? (
              <BarcodeScannerInline
                onDetected={(code) => {
                  selectQuickCodigo(code, { setSearch: true, snapshot: null })
                  setQuickScanOpen(false)
                  toast.success('Código detectado')
                }}
                onClose={() => setQuickScanOpen(false)}
              />
            ) : null}
          </div>

          <DialogFooter>
              <Button
                variant="outline"
                onClick={() => {
                  resetQuickOperationState()
                  setQuickOp(null)
                }}
              >
                Cancelar
              </Button>
            {quickOp === 'TRANSFERENCIA' ? (
              <Button
                className="!bg-blue-600 hover:!bg-blue-700 !text-white"
                onClick={async () => {
                  const ok = await runTransfer()
                  if (ok) {
                    resetQuickOperationState({ keepFeedback: true })
                    setQuickOp(null)
                  }
                }}
                disabled={quickActionLoading || !isAuthed}
              >
                <span className="flex items-center gap-2">
                  {quickActionLoading ? (
                    <svg className="h-4 w-4 animate-spin" viewBox="0 0 24 24" fill="none" aria-hidden>
                      <circle cx="12" cy="12" r="10" stroke="currentColor" strokeOpacity="0.25" strokeWidth="3" />
                      <path d="M22 12a10 10 0 0 0-10-10" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
                    </svg>
                  ) : null}
                  {quickActionLoading ? 'Processando...' : 'Confirmar transferência'}
                </span>
              </Button>
            ) : (
              <Button
                className={
                  quickOp === 'ENTRADA'
                    ? '!bg-green-600 hover:!bg-green-700 !text-white'
                    : quickOp === 'BAIXA'
                      ? ''
                      : ''
                }
                variant={quickOp === 'BAIXA' ? 'destructive' : 'default'}
                onClick={async () => {
                  const ok = await runQuickAction(quickOp === 'ENTRADA' ? 'ENTRADA' : 'BAIXA')
                  if (ok) {
                    resetQuickOperationState({ keepFeedback: true })
                    setQuickOp(null)
                  }
                }}
                disabled={quickActionLoading || !isAuthed}
              >
                <span className="flex items-center gap-2">
                  {quickActionLoading ? (
                    <svg className="h-4 w-4 animate-spin" viewBox="0 0 24 24" fill="none" aria-hidden>
                      <circle cx="12" cy="12" r="10" stroke="currentColor" strokeOpacity="0.25" strokeWidth="3" />
                      <path d="M22 12a10 10 0 0 0-10-10" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
                    </svg>
                  ) : null}
                  {quickActionLoading ? 'Processando...' : (quickOp === 'ENTRADA' ? 'Confirmar entrada' : 'Confirmar saída')}
                </span>
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={!!quickActionFeedback}
        onOpenChange={(open) => {
          if (!open) setQuickActionFeedback(null)
        }}
      >
        <DialogContent className={`${dialogSmallClass} dark bg-corporate-900 border-white/10 text-white`}>
          <DialogHeader>
            <DialogTitle className="text-white">
              {quickActionFeedback?.type === 'success' ? 'Sucesso' : 'Falha'}
            </DialogTitle>
            <DialogDescription className="text-blue-100/70">
              {quickActionFeedback?.type === 'success'
                ? 'A operacao foi registrada.'
                : 'Nao foi possivel concluir a operacao.'}
            </DialogDescription>
          </DialogHeader>
          <div className="rounded-lg border border-white/10 bg-black/30 px-3 py-3 text-sm text-blue-50">
            {quickActionFeedback?.message || '-'}
          </div>
          <DialogFooter>
            <Button variant="secondary" onClick={() => setQuickActionFeedback(null)}>
              Fechar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={purchaseDialogOpen} onOpenChange={setPurchaseDialogOpen}>
        <DialogContent size="wideTable" className={`${dialogMediumClass} dark bg-corporate-900 border-white/10 text-white`}>
          <DialogHeader>
            <DialogTitle className="text-white">Lista de compra</DialogTitle>
            <DialogDescription className="text-blue-100/70">
              Sugestões de reposição para {unidadeLabel(unidade)} (baseado em estoque mínimo).
            </DialogDescription>
          </DialogHeader>

          {(() => {
            const items = (overviewActionables?.reposicao || []).slice()
            const totalValue = items.reduce((acc, it) => acc + (Number(it.estimatedValue) || 0), 0)
            const totalQty = items.reduce((acc, it) => acc + (Number(it.suggestedPurchaseQty) || 0), 0)

            const byCat = new Map<string, any[]>()
            for (const it of items) {
              const cat = String(it.categoria || 'Outros').trim() || 'Outros'
              const prev = byCat.get(cat) || []
              prev.push(it)
              byCat.set(cat, prev)
            }
            const cats = Array.from(byCat.entries()).sort((a, b) => a[0].localeCompare(b[0]))

	            const escapeCsv = (v: any) => {
	              const s = String(v ?? '')
	              if (/[";\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`
	              return s
	            }
            const toCsv = () => {
              const header = ['Categoria', 'Produto', 'Código', 'Qtd sugerida', 'Valor estimado (R$)']
              const rows = items.map((it) => [
                it.categoria || '',
                it.produto || '',
                it.codigoBarras || '',
                Number(it.suggestedPurchaseQty) || 0,
                Number(it.estimatedValue) || 0
              ])
              return [header, ...rows].map((r) => r.map(escapeCsv).join(';')).join('\n')
            }

            return (
              <div className="space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="text-sm text-blue-100/80">
                    <span className="font-mono">{items.length}</span> itens •{' '}
                    <span className="font-mono">{totalQty}</span> unidades sugeridas •{' '}
                    <span className="font-mono">{fmtMoneyBRL(totalValue)}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <Button
                      variant="outline"
                      onClick={async () => {
                        try {
                          await navigator.clipboard.writeText(toCsv())
                          toast.success('Lista copiada (CSV)')
                        } catch {
                          toast.error('Não foi possível copiar')
                        }
                      }}
                      disabled={!items.length}
                    >
                      Copiar CSV
                    </Button>
                    <Button
                      variant="secondary"
                      onClick={() => {
                        const csv = toCsv()
                        const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' })
                        const url = URL.createObjectURL(blob)
                        const a = document.createElement('a')
                        a.href = url
                        a.download = `lista-compra-${unidade}-${new Date().toISOString().slice(0, 10)}.csv`
                        document.body.appendChild(a)
                        a.click()
                        a.remove()
                        setTimeout(() => URL.revokeObjectURL(url), 2000)
                      }}
                      disabled={!items.length}
                    >
                      Baixar CSV
                    </Button>
                  </div>
                </div>

                <div className="overflow-auto max-h-[60vh] rounded-xl border border-white/10">
                  <table className="min-w-full text-sm">
                    <thead className="bg-black/30 text-blue-100/80">
                      <tr>
                        <th className="text-left p-3">Produto</th>
                        <th className="text-left p-3 hidden md:table-cell">Categoria</th>
                        <th className="text-left p-3 hidden sm:table-cell">Código</th>
                        <th className="text-right p-3">Qtd sugerida</th>
                        <th className="text-right p-3">Valor</th>
                        <th className="text-right p-3">Ação</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-white/5">
                      {cats.flatMap(([cat, list]) => {
                        const rows = list.map((it, idx) => (
                          <tr key={`${String(it.codigoBarras || '')}-${idx}`} className="hover:bg-white/5">
                            <td className="p-3 text-blue-50">
                              <div className="font-medium">{it.produto || '-'}</div>
                            </td>
                            <td className="p-3 text-blue-100/80 hidden md:table-cell">{it.categoria || cat}</td>
                            <td className="p-3 font-mono text-blue-100/80 hidden sm:table-cell break-all">{it.codigoBarras || ''}</td>
                            <td className="p-3 text-right font-mono text-blue-100/80">{it.suggestedPurchaseQty ?? 0}</td>
                            <td className="p-3 text-right font-mono text-blue-100/80">
                              {fmtMoneyBRL(Number(it.estimatedValue) || 0)}
                            </td>
                            <td className="p-3 text-right">
                              <Button
                                variant="outline"
                                className="h-8 px-2 text-xs"
                                onClick={() => {
                                  openQuickOperation('ENTRADA', {
                                    codigoBarras: String(it.codigoBarras || ''),
                                    quantidade: it.suggestedPurchaseQty ?? 1,
                                    obs: 'Reposição sugerida'
                                  })
                                  setPurchaseDialogOpen(false)
                                }}
                                disabled={!isAuthed}
                              >
                                Registrar entrada
                              </Button>
                            </td>
                          </tr>
                        ))
                        return rows
                      })}
                      {!items.length ? (
                        <tr>
                          <td className="p-3 text-blue-100/70" colSpan={6}>
                            {renderLoadingText(overviewLoading, 'Sem recomendações de compra.')}
                          </td>
                        </tr>
                      ) : null}
                    </tbody>
                  </table>
                </div>
              </div>
            )
          })()}

          <DialogFooter>
            <Button variant="secondary" onClick={() => setPurchaseDialogOpen(false)}>
              Fechar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {proxyStatus?.mutationsBlocked ? (
        <div className="max-w-6xl mx-auto mb-3 rounded-xl border border-amber-400/40 bg-amber-500/10 px-4 py-3 text-sm text-amber-100">
          <div className="font-semibold">Modo local seguro ativo</div>
          <div className="text-amber-100/80">
            Mutações para o backend de produção estão bloqueadas. Para liberar, rode com
            <span className="font-mono"> LOCAL_ALLOW_UPSTREAM_MUTATIONS=1</span>.
          </div>
        </div>
      ) : null}

      <div ref={overviewSectionRef} className="max-w-6xl mx-auto space-y-3 pt-1">
        <div className="flex flex-col gap-3">
          <Droppable droppableId="overview-panels">
            {(dropProvided) => (
              <div ref={dropProvided.innerRef} {...dropProvided.droppableProps} className="flex flex-col gap-3">
                {visibleOverviewPanels.map((panelId, idx) => (
                  <Draggable key={panelId} draggableId={`overview-${panelId}`} index={idx}>
                    {(dragProvided) => {
                      const handleProps = dragProvided.dragHandleProps
                      const panelOpen = detailsOpen[OVERVIEW_PANEL_OPEN_KEYS[panelId]] ?? true

                      if (panelId === 'policies') {
                        if (!isManagerRole) return <div key={panelId} />
                        return (
                          <div ref={dragProvided.innerRef} {...dragProvided.draggableProps}>
	                            <Card className="bg-black/20 border border-white/10">
	                              <CardHeader className="relative pr-24">
	                                <CardTitle className="text-white text-base">Políticas por categoria</CardTitle>
	                                <div className="absolute top-2 right-2 flex items-center gap-1">
                                  <div
                                    {...handleProps}
                                    className="h-9 w-9 flex items-center justify-center rounded-md bg-transparent text-white hover:bg-white/[0.10] cursor-grab active:cursor-grabbing"
                                    title="Arraste para mover"
                                    aria-label="Mover"
                                    role="button"
                                    tabIndex={0}
                                  >
                                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden>
                                      <path
                                        d="M9 6h.01M15 6h.01M9 12h.01M15 12h.01M9 18h.01M15 18h.01"
                                        stroke="currentColor"
                                        strokeWidth="3"
                                        strokeLinecap="round"
                                      />
                                    </svg>
                                  </div>
                                  <Button
                                    size="icon"
                                    variant="ghost"
                                    className="h-9 w-9 bg-transparent text-white hover:bg-white/[0.10]"
                                    onClick={() => setDetailsKeyOpen(OVERVIEW_PANEL_OPEN_KEYS.policies, !panelOpen)}
                                    title={panelOpen ? 'Contrair' : 'Expandir'}
                                    aria-label={panelOpen ? 'Contrair' : 'Expandir'}
                                  >
                                    {panelOpen ? (
                                      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden>
                                        <path d="M6 15l6-6 6 6" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
                                      </svg>
                                    ) : (
                                      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden>
                                        <path d="M6 9l6 6 6-6" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
                                      </svg>
                                    )}
                                  </Button>
	                                </div>
	                              </CardHeader>
                              {panelOpen ? (
                                <CardContent className="space-y-3">
              <div className="text-xs text-blue-200/60">
                Configure quais categorias exigem <span className="font-medium text-blue-100/80">lote</span> e/ou <span className="font-medium text-blue-100/80">validade</span>, e habilite <span className="font-medium text-blue-100/80">FEFO</span> quando aplicável.
              </div>

              <div className="rounded-xl border border-white/10 bg-black/10 p-3 space-y-3">
                <div className="grid grid-cols-1 md:grid-cols-3 gap-2 items-end">
                  <div className="md:col-span-2">
                    <div className="text-xs text-blue-200/70 mb-1">Categoria (nome)</div>
                    <Input
                      value={policyFormLabel}
                      onChange={(e) => {
                        const next = e.target.value
                        setPolicyFormLabel(next)
                      }}
                      placeholder="Ex: Toxina botulínica"
                      disabled={!isAuthed}
                    />
                  </div>
                  <div>
                    <div className="text-xs text-blue-200/70 mb-1">Slug (opcional)</div>
                    <Input
                      value={policyFormSlug}
                      onChange={(e) => {
                        setPolicyFormSlugTouched(true)
                        setPolicyFormSlug(e.target.value)
                      }}
                      placeholder={slugifyCategoria(policyFormLabel) || 'ex: toxina-botulinica'}
                      disabled={!isAuthed}
                    />
                  </div>
                </div>

                {adminCategorySuggestions.length ? (
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-2 items-end">
                    <div className="md:col-span-2">
                      <div className="text-xs text-blue-200/70 mb-1">Sugestões (já usadas em itens)</div>
                      <Select
                        value={policyFormSuggestion}
                        onValueChange={(v) => {
                          const next = String(v)
                          setPolicyFormSuggestion(next)
                          if (next === '__NONE__') return
                          const hit = adminCategorySuggestions.find((s) => s.slug === next)
                          if (!hit) return
                          setPolicyFormLabel(hit.label)
                          setPolicyFormSlugTouched(true)
                          setPolicyFormSlug(hit.slug)
                        }}
                      >
                        <SelectTrigger>
                          <SelectValue placeholder="Escolher…" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="__NONE__">(nenhuma)</SelectItem>
                          {adminCategorySuggestions.map((s) => (
                            <SelectItem key={s.slug} value={s.slug}>
                              {s.label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="text-xs text-blue-200/60">
                      {policyFormEditingSlug ? (
                        <Badge variant="secondary">Editando: {policyFormEditingSlug}</Badge>
                      ) : (
                        <Badge variant="secondary">Nova política</Badge>
                      )}
                    </div>
                  </div>
                ) : policyFormEditingSlug ? (
                  <div className="text-xs text-blue-200/60">
                    <Badge variant="secondary">Editando: {policyFormEditingSlug}</Badge>
                  </div>
                ) : null}

                <div className="flex flex-wrap gap-4">
                  <div className="flex items-center gap-2">
                    <Checkbox
                      id="policy-requires-lot"
                      checked={policyFormRequiresLot}
                      onCheckedChange={(checked) => setPolicyFormRequiresLot(!!checked)}
                    />
                    <label htmlFor="policy-requires-lot" className="text-sm text-blue-100/80 cursor-pointer">
                      Lote obrigatório
                    </label>
                  </div>

                  <div className="flex items-center gap-2">
                    <Checkbox
                      id="policy-requires-expiry"
                      checked={policyFormRequiresExpiry}
                      onCheckedChange={(checked) => {
                        const next = !!checked
                        setPolicyFormRequiresExpiry(next)
                        if (!next) setPolicyFormFefo(false)
                      }}
                    />
                    <label htmlFor="policy-requires-expiry" className="text-sm text-blue-100/80 cursor-pointer">
                      Validade obrigatória
                    </label>
                  </div>

                  <div className="flex items-center gap-2">
                    <Checkbox
                      id="policy-fefo"
                      checked={policyFormFefo}
                      onCheckedChange={(checked) => {
                        const next = !!checked
                        setPolicyFormFefo(next)
                        if (next) setPolicyFormRequiresExpiry(true)
                      }}
                    />
                    <label htmlFor="policy-fefo" className="text-sm text-blue-100/80 cursor-pointer">
                      FEFO (sugere lote por validade)
                    </label>
                  </div>
                </div>

                <div className="flex items-center justify-between gap-2">
                  <Button
                    variant="outline"
                    onClick={() => resetPolicyForm()}
                    disabled={!isAuthed}
                  >
                    Limpar
                  </Button>
                  <Button
                    className="!bg-blue-600 hover:!bg-blue-700 !text-white"
                    onClick={() => void saveCategoryPolicy()}
                    disabled={!isAuthed}
                  >
                    {policyFormEditingSlug ? 'Salvar alterações' : 'Criar política'}
                  </Button>
                </div>
              </div>

              <div className="overflow-auto rounded-xl border border-white/10">
                <table className="min-w-full text-sm">
                      <thead className="bg-black/30 text-blue-100/80">
                        <tr>
                          <th className="text-left p-3 w-[34%]">Categoria</th>
                          <th className="text-left p-3 w-[46%]">Regras</th>
                          <th className="text-right p-3 w-[20%]">Ações</th>
                        </tr>
                      </thead>
                  <tbody className="divide-y divide-white/5">
                    {(adminCategoryPolicies || []).map((p) => (
                      <tr key={p.slug} className="hover:bg-white/5">
                        <td className="p-3 text-blue-50">
                          <div className="text-blue-50">{p.label || p.slug}</div>
                          <div className="text-xs text-blue-200/60 font-mono">{p.slug}</div>
                        </td>
                        <td className="p-3">
                          <div className="flex flex-wrap gap-2">
                            {p.requiresLot ? <Badge variant="secondary">lote</Badge> : <Badge variant="secondary">lote opcional</Badge>}
                            {p.requiresExpiry ? <Badge variant="secondary">validade</Badge> : <Badge variant="secondary">validade opcional</Badge>}
                            {p.fefo ? <Badge>FEFO</Badge> : <Badge variant="secondary">sem FEFO</Badge>}
                          </div>
                        </td>
                        <td className="p-3 text-right">
                          <div className="flex justify-end gap-2">
                            <Button variant="outline" className="h-8 px-2" onClick={() => startEditPolicyForm(p)}>
                              Editar
                            </Button>
                            <Button
                              variant="destructive"
                              className="h-8 px-2"
                              onClick={() => void deleteCategoryPolicy(p.slug)}
                            >
                              Remover
                            </Button>
                          </div>
                        </td>
                      </tr>
                    ))}
                    {!adminCategoryPoliciesLoading && !(adminCategoryPolicies || []).length ? (
                      <tr>
                        <td className="p-3 text-blue-100/70" colSpan={3}>
                          Sem políticas cadastradas.
                        </td>
                      </tr>
                    ) : null}
                  </tbody>
                </table>
              </div>
                                </CardContent>
                              ) : null}
                            </Card>
                          </div>
                        )
                      }

                      if (panelId === 'alerts') {
                        return (
                          <div ref={dragProvided.innerRef} {...dragProvided.draggableProps}>
		                            <Card className="bg-black/20 border border-white/10">
                              <CardHeader className="relative pr-24">
                                <div className="flex flex-col gap-2 min-w-0 w-full md:flex-row md:items-center">
                                  <div className="flex items-center gap-3 min-w-0">
                                    <button
                                      type="button"
                                      {...handleProps}
                                      className="mt-0.5 h-9 w-9 flex items-center justify-center rounded-md bg-transparent text-white hover:bg-white/[0.10] cursor-grab active:cursor-grabbing"
                                      title="Arraste para mover"
                                      aria-label="Mover"
                                    >
                                      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden>
                                        <path
                                          d="M9 6h.01M15 6h.01M9 12h.01M15 12h.01M9 18h.01M15 18h.01"
                                          stroke="currentColor"
                                          strokeWidth="3"
                                          strokeLinecap="round"
                                        />
                                      </svg>
                                    </button>
                                    <CardTitle className="text-white text-base">Alertas</CardTitle>
                                    <div className="hidden sm:flex items-center gap-3 text-xs text-blue-200/70">
                                      <span className="inline-flex items-center gap-1">
                                        <span>Crítico</span>
                                        <span className="font-mono text-blue-50">
                                          {showOverviewLoadingProgress ? (
                                            <span className="inline-flex items-center gap-2">
                                              <span className="inline-flex h-3 w-3 rounded-full border border-blue-200/70 border-t-transparent animate-spin" />
                                              {loadingPercent}%
                                            </span>
                                          ) : (
                                            overviewCriticosCount ?? '-'
                                          )}
                                        </span>
                                      </span>
                                      <span className="inline-flex items-center gap-1">
                                        <span>Atenção</span>
                                        <span className="font-mono text-blue-50">
                                          {showOverviewLoadingProgress ? (
                                            <span className="inline-flex items-center gap-2">
                                              <span className="inline-flex h-3 w-3 rounded-full border border-blue-200/70 border-t-transparent animate-spin" />
                                              {loadingPercent}%
                                            </span>
                                          ) : (
                                            overviewAtencaoCount ?? '-'
                                          )}
                                        </span>
                                      </span>
                                    </div>
                                  </div>
                                  <div className="flex flex-1 flex-wrap items-center gap-2 min-w-0">
                                    <Select value={alertasStatus} onValueChange={(v) => setAlertasStatus(v as any)}>
                                      <SelectTrigger className="h-8 w-24">
                                        <SelectValue placeholder="Tipo" />
                                      </SelectTrigger>
                                      <SelectContent>
                                        <SelectItem value="TODOS">Todos</SelectItem>
                                        <SelectItem value="ATENCAO">Atenção</SelectItem>
                                        <SelectItem value="URGENTE">Crítico</SelectItem>
                                        <SelectItem value="INFO">Info</SelectItem>
                                      </SelectContent>
                                    </Select>
                                    <Select
                                      value={alertasCategoria || '__ALL__'}
                                      onValueChange={(v) => setAlertasCategoria(v === '__ALL__' ? '' : String(v))}
                                    >
                                      <SelectTrigger className="h-8 w-36">
                                        <SelectValue placeholder="Categoria" />
                                      </SelectTrigger>
                                      <SelectContent>
                                        <SelectItem value="__ALL__">Todas</SelectItem>
                                        {alertasCategorias.map((c) => (
                                          <SelectItem key={c} value={c}>
                                            {c}
                                          </SelectItem>
                                        ))}
                                      </SelectContent>
                                    </Select>
                                    <Input
                                      value={alertasBusca}
                                      onChange={(e) => setAlertasBusca(e.target.value)}
                                      placeholder="Buscar"
                                      className="h-8 min-w-[140px] flex-1 max-w-[320px]"
                                    />
                                  </div>
                                </div>
                                <div className="absolute top-2 right-2 flex items-center gap-2">
                                  <Button
                                    size="icon"
                                    variant="ghost"
                                    className="h-9 w-9 bg-transparent text-white hover:bg-white/[0.10]"
                                    onClick={() => setPurchaseDialogOpen(true)}
                                    disabled={!isAuthed || !(overviewActionables?.reposicao || []).length}
                                    title="Lista de compra"
                                    aria-label="Lista de compra"
                                  >
                                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden>
                                      <path d="M3 4h2l2.4 11.2a2 2 0 0 0 2 1.6h7.6a2 2 0 0 0 2-1.6L21 8H7" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                                      <circle cx="9" cy="20" r="1.6" fill="currentColor" />
                                      <circle cx="17" cy="20" r="1.6" fill="currentColor" />
                                    </svg>
                                  </Button>
                                  <Button
	                                    size="icon"
	                                    variant="ghost"
	                                    className="h-9 w-9 bg-transparent text-white hover:bg-white/[0.10]"
	                                    onClick={() => setDetailsKeyOpen(OVERVIEW_PANEL_OPEN_KEYS.alerts, !panelOpen)}
                                    title={panelOpen ? 'Contrair' : 'Expandir'}
                                    aria-label={panelOpen ? 'Contrair' : 'Expandir'}
                                  >
                                    {panelOpen ? (
                                      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden>
                                        <path d="M6 15l6-6 6 6" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
                                      </svg>
                                    ) : (
                                      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden>
                                        <path d="M6 9l6 6 6-6" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
                                      </svg>
                                    )}
                                  </Button>
                                </div>
                              </CardHeader>
                              {panelOpen ? (
                                <CardContent className="space-y-2">
                                  <div className="overflow-auto max-h-[60vh] rounded-xl border border-white/10">
                                    <table className="w-full table-fixed text-sm">
                                      <thead className="bg-black/30 text-blue-100/80">
                                        <tr>
                                          {(
                                            [
                                              { key: 'produto', label: 'Produto', align: 'text-left', widthClass: 'w-[24%]' },
                                              { key: 'categoria', label: 'Categoria', align: 'text-left', widthClass: 'w-[14%]' },
                                              { key: 'status', label: 'Status', align: 'text-left', widthClass: 'w-[14%]' },
                                              { key: 'acao', label: 'Ação recomendada', align: 'text-left', widthClass: 'w-[20%]' },
                                              { key: 'atual', label: 'Atual', align: 'text-right', widthClass: 'w-[8%]' },
                                              { key: 'min', label: 'Mín', align: 'text-right hidden sm:table-cell', widthClass: 'w-[6%]' },
                                              { key: 'dif', label: 'Dif', align: 'text-right hidden lg:table-cell', widthClass: 'w-[7%]' },
                                              { key: 'percentual', label: '%', align: 'text-right hidden lg:table-cell', widthClass: 'w-[7%]' }
                                            ] as Array<{ key: AlertasSortKey; label: string; align: string; widthClass?: string }>
                                          ).map((col) => {
                                            const isActive = alertasSortKey === col.key
                                            return (
                                              <th
                                                key={col.label}
                                                className={`p-3 ${col.align} ${col.widthClass || ''} sticky top-0 z-10 bg-black/40 backdrop-blur`}
                                              >
                                                <button
                                                  type="button"
                                                  className={`w-full inline-flex items-center ${col.align.includes('right') ? 'justify-end' : 'justify-start'} gap-2 cursor-pointer select-none ${isActive ? 'text-white' : 'text-blue-100/80'} hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-300/40 rounded-sm px-0.5`}
                                                  onClick={() => {
                                                    if (alertasSortKey === col.key) {
                                                      setAlertasSortDir((d) => (d === 'asc' ? 'desc' : 'asc'))
                                                      return
                                                    }
                                                    setAlertasSortKey(col.key)
                                                    setAlertasSortDir(col.key === 'status' ? 'asc' : 'desc')
                                                  }}
                                                  aria-label={`Ordenar ${col.label}`}
                                                  title={`Ordenar ${col.label}`}
                                                >
                                                  <span>{col.label}</span>
                                                  <span className={`inline-flex items-center justify-center ${isActive ? 'text-white' : 'text-blue-100/30'}`} aria-hidden>
                                                    {isActive && alertasSortDir === 'asc' ? (
                                                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden>
                                                        <path d="M6 15l6-6 6 6" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
                                                      </svg>
                                                    ) : (
                                                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden>
                                                        <path d="M6 9l6 6 6-6" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
                                                      </svg>
                                                    )}
                                                  </span>
                                                </button>
                                              </th>
                                            )
                                          })}
                                        </tr>
                                      </thead>
                    <tbody className="divide-y divide-white/5">
                      {alertasLinhasOrdenadas.slice(0, 120).map((a, idx) => {
                        const code = String(a.codigoBarras || '').trim()
                        const rec = code ? alertasRecommendationByCode.get(code) || null : null
                        const canQuick = !!code && isAuthed
                        const qualityIssue = a.qualityIssue
                        const qualityMessage = String(a.qualityMessage || '').trim()
                        const qualitySeverity = a.qualitySeverity || (qualityIssue as any)?.severity
                        const canQualityEdit = !!qualityIssue && isAuthed && (!!qualityIssue.registro || !!qualityIssue.codigoBarras || !!qualityIssue.produto)
                        const hasQualityAction = !!qualityIssue
                        const isVencendo = a.tags.includes('VENCENDO')
                        const isExpirado = a.tags.includes('EXPIRADO')
                        const hasExpiringAction = !rec && (isExpirado || isVencendo)
                        const hasAnyAction = !!rec || hasExpiringAction || hasQualityAction
                        const displayTagsSet = new Set<AlertaStatusTag>()
                        if (a.tags.includes('URGENTE') || isExpirado) displayTagsSet.add('URGENTE')
                        if (a.tags.includes('ATENCAO') || isVencendo) displayTagsSet.add('ATENCAO')
                        if (a.tags.includes('INFO')) displayTagsSet.add('INFO')
                        const displayTags = Array.from(displayTagsSet)
                        return (
                          <tr
                            key={`${a.key}-${idx}`}
                            className={`hover:bg-white/5 ${a.codigoBarras ? 'cursor-pointer' : ''}`}
                            onClick={() => {
                              if (code) {
                                selectQuickCodigo(code, { setSearch: true, snapshot: null })
                              }
                            }}
                            title={a.codigoBarras ? 'Clique para usar este código de barras' : undefined}
                          >
                            <td className="p-3 text-blue-50 align-top">
                              <div className="flex flex-wrap items-center gap-2 text-blue-50 break-words">
                                <span>{a.produto || '-'}</span>
                                {isVencendo ? (
                                  <Badge variant="secondary" className="border text-[10px] px-1 py-0 h-4 leading-4">
                                    Venc.
                                  </Badge>
                                ) : null}
                                {isExpirado ? (
                                  <Badge variant="destructive" className="border text-[10px] px-1 py-0 h-4 leading-4">
                                    Exp.
                                  </Badge>
                                ) : null}
                              </div>
                              <div className="hidden md:block text-xs text-blue-200/60 font-mono break-all">{a.codigoBarras || '-'}</div>
                              {a.marca ? (
                                <div className="mt-1">
                                  <Badge
                                    style={buildTagStyle(getMarcaBgColor(a.marca))}
                                    className="border cursor-pointer hover:opacity-80"
                                    onClick={(e) => {
                                      e.stopPropagation()
                                      const value = String(a.marca || '')
                                      if (!value) return
                                      setAlertasMarca((prev) => (prev === value ? '' : value))
                                    }}
                                    title="Filtrar por marca"
                                  >
                                    {a.marca}
                                  </Badge>
                                </div>
                              ) : null}
                              {a.dataValidade ? (
                                <div className="mt-1 text-xs text-blue-200/60">
                                  validade: <span className="font-mono">{fmtDateOnlyBR(String(a.dataValidade))}</span>
                                  {a.dias != null ? (
                                    <>
                                      {' '}
                                      <span className="font-mono">({Number(a.dias)}d)</span>
                                    </>
                                  ) : null}
                                </div>
                              ) : null}
                            </td>
                            <td className="p-3 text-blue-100/80 hidden sm:table-cell">
                              <Badge
                                style={buildTagStyle(getCategoriaBgColor(a.categoria || 'Outros'))}
                                className="border cursor-pointer hover:opacity-80"
                                onClick={(e) => {
                                  e.stopPropagation()
                                  const value = String(a.categoria || 'Outros')
                                  setAlertasCategoria((prev) => (prev === value ? '' : value))
                                }}
                                title="Filtrar por categoria"
                              >
                                {a.categoria || 'Outros'}
                              </Badge>
                            </td>
                            <td className="p-3">
                              <div className="flex flex-wrap gap-1">
                                {displayTags.map((t) => (
                                  <Badge
                                    key={t}
                                    variant={alertaTagVariant(t)}
                                    className="cursor-pointer hover:opacity-80"
                                    onClick={(e) => {
                                      e.stopPropagation()
                                      setAlertasStatus((prev) => (prev === t ? 'TODOS' : (t as AlertasStatusFilter)))
                                    }}
                                    title="Filtrar por status"
                                  >
                                    {alertaTagLabel(t)}
                                  </Badge>
                                ))}
                              </div>
                            </td>
                            <td className="p-3">
                              <div className="flex flex-wrap gap-2">
                                {rec?.kind === 'TRANSFERENCIA' ? (
                                  <Button
                                    variant="outline"
                                    className="h-8 px-2 text-xs"
                                    disabled={!canQuick}
                                    onClick={(e) => {
                                      e.stopPropagation()
                                      openQuickOperation('TRANSFERENCIA', {
                                        codigoBarras: code,
                                        quantidade: rec.qty ?? 1,
                                        fromUnidade: rec.fromUnidade ?? null,
                                        toUnidade: rec.toUnidade ?? null,
                                        obs: 'Transferência sugerida'
                                      })
                                    }}
                                  >
                                    Transferir
                                  </Button>
                                ) : null}
                                {rec?.kind === 'ENTRADA' ? (
                                  <Button
                                    variant="outline"
                                    className="h-8 px-2 text-xs"
                                    disabled={!canQuick}
                                    onClick={(e) => {
                                      e.stopPropagation()
                                      openQuickOperation('ENTRADA', {
                                        codigoBarras: code,
                                        quantidade: rec.qty ?? 1,
                                        obs: 'Reposição sugerida'
                                      })
                                    }}
                                  >
                                    Entrada
                                  </Button>
                                ) : null}
                                {hasExpiringAction ? (
                                  <Button
                                    variant={a.tags.includes('EXPIRADO') ? 'destructive' : 'secondary'}
                                    className="h-8 px-2 text-xs"
                                    disabled={!canQuick}
                                    onClick={(e) => {
                                      e.stopPropagation()
                                      openQuickOperation('BAIXA', {
                                        codigoBarras: code,
                                        quantidade: 1,
                                        obs: a.tags.includes('EXPIRADO') ? 'Descarte (expirado)' : 'Saída (vencendo)'
                                      })
                                    }}
                                  >
                                    {a.tags.includes('EXPIRADO') ? 'Descarte' : 'Saída'}
                                  </Button>
                                ) : null}
                                {hasQualityAction ? (
                                  <Button
                                    variant="outline"
                                    className="h-8 px-2 text-xs"
                                    disabled={!canQualityEdit}
                                    onClick={(e) => {
                                      e.stopPropagation()
                                      if (qualityIssue) openQualityFix(qualityIssue)
                                    }}
                                  >
                                    Editar
                                  </Button>
                                ) : null}
                                {!hasAnyAction ? (
                                  <span className="text-xs text-blue-200/60">-</span>
                                ) : null}
                              </div>
                              {qualityMessage ? (
                                <div className="mt-2 text-xs text-blue-200/70">
                                  <div className="inline-flex items-center gap-2">
                                    <Badge variant={severityBadgeVariant(qualitySeverity) as any} className="border">
                                      {severityLabel(qualitySeverity)}
                                    </Badge>
                                  </div>
                                  <div className="mt-1 break-words">{qualityMessage}</div>
                                </div>
                              ) : null}
                            </td>
                            <td className="p-3 text-right text-blue-100/80">{a.estoqueAtual ?? '-'}</td>
                            <td className="p-3 text-right text-blue-100/70 hidden sm:table-cell">{a.estoqueMinimo ?? '-'}</td>
                            <td className="hidden lg:table-cell p-3 text-right text-blue-100/70">{a.diferenca ?? '-'}</td>
                            <td className="hidden lg:table-cell p-3 text-right text-blue-100/70">{a.percentual != null ? `${a.percentual}%` : '-'}</td>
                          </tr>
                        )
                      })}
                      {!alertasLinhasOrdenadas.length ? (
                        <tr>
                          <td className="p-3 text-blue-100/70" colSpan={8}>
                            {renderListPlaceholder(insightsLoading, 'Sem alertas.')}
                          </td>
                        </tr>
                      ) : null}
                                </tbody>
                              </table>
                            </div>
                          </CardContent>
                              ) : null}
                            </Card>
                          </div>
                        )
                      }

	                      return (
	                        <div ref={dragProvided.innerRef} {...dragProvided.draggableProps}>
		                          <Card className="bg-black/20 border border-white/10">
                              <CardHeader className="relative pr-24">
                                <div className="flex items-center gap-3 min-w-0">
                                  <button
                                    type="button"
                                    {...handleProps}
                                    className="mt-0.5 h-9 w-9 flex items-center justify-center rounded-md bg-transparent text-white hover:bg-white/[0.10] cursor-grab active:cursor-grabbing"
                                    title="Arraste para mover"
                                    aria-label="Mover"
                                  >
                                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden>
                                      <path d="M9 6h.01M15 6h.01M9 12h.01M15 12h.01M9 18h.01M15 18h.01" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
                                    </svg>
                                  </button>
                                  <div className="flex flex-wrap items-center gap-2 min-w-0">
                                    <CardTitle className="text-white text-base">Gráficos</CardTitle>
                                    <div className="flex items-center gap-2">
                                      <Button
                                        variant="outline"
                                        size="sm"
                                        onClick={() => {
                                          if (chartSlots.length >= MAX_CHARTS) return
                                          setChartSlots((prev) => [
                                            ...prev,
                                            { presetId: 'movements', groupBy: 'tempo', mode: 'inout', metric: 'qtd', view: 'bar', topN: 8 }
                                          ])
                                        }}
                                        disabled={overviewLoading || insightsLoading || chartSlots.length >= MAX_CHARTS}
                                      >
                                        + Adicionar
                                      </Button>
                                      <Button variant="outline" size="sm" onClick={() => setChartSlots(DEFAULT_CHART_SLOTS)} disabled={overviewLoading || insightsLoading}>
                                        Resetar
                                      </Button>
                                    </div>
                                  </div>
                                </div>
	                                <div className="absolute top-2 right-2 flex items-center gap-2">
	                                  <Button
	                                    size="icon"
	                                    variant="ghost"
	                                    className="h-9 w-9 bg-transparent text-white hover:bg-white/[0.10]"
	                                    onClick={() => setDetailsKeyOpen(OVERVIEW_PANEL_OPEN_KEYS.charts, !panelOpen)}
                                    title={panelOpen ? 'Contrair' : 'Expandir'}
                                    aria-label={panelOpen ? 'Contrair' : 'Expandir'}
                                  >
                                    {panelOpen ? (
                                      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden>
                                        <path d="M6 15l6-6 6 6" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
                                      </svg>
                                    ) : (
                                      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden>
                                        <path d="M6 9l6 6 6-6" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
                                      </svg>
                                    )}
                                  </Button>
                                </div>
                              </CardHeader>
                            {panelOpen ? (
                              <CardContent className="space-y-3">
              <div
                className={`grid gap-3 ${chartSlots.length === 1
                  ? 'grid-cols-1'
                  : chartSlots.length === 2
                    ? 'grid-cols-1 lg:grid-cols-2'
                    : 'grid-cols-1 md:grid-cols-2 xl:grid-cols-3 xl:grid-flow-dense'
                  }`}
              >
	                {chartSlots.map((slot, idx) => {
	                  const preset = presetSupports(slot.presetId)
	                  const groupBy: ChartGroupBy | undefined =
	                    slot.presetId === 'distribution'
	                      ? slot.groupBy === 'marca' || slot.groupBy === 'item'
	                        ? slot.groupBy
	                        : 'categoria'
	                      : slot.presetId === 'movements'
	                        ? slot.groupBy === 'categoria'
	                          ? 'categoria'
	                          : 'tempo'
	                        : undefined
	                  const mode: MovementsMode | undefined =
	                    slot.presetId === 'movements'
	                      ? slot.mode === 'saldo' || slot.mode === 'entrada' || slot.mode === 'saida' || slot.mode === 'inout'
	                        ? slot.mode
	                        : groupBy === 'categoria'
	                          ? 'saida'
	                          : 'inout'
	                      : undefined
	                  const viewOptions = presetViewOptions({ ...slot, groupBy, mode })
	                  const rawView = (slot.view || preset.defaultView || viewOptions[0] || 'bar') as any
	                  const view = viewOptions.includes(rawView) ? rawView : viewOptions[0]
	                  const metric = (slot.metric === 'valor' ? 'valor' : 'qtd') as any
	                  const topN = Math.max(5, Math.min(15, Number(slot.topN) || 8))
	                  const showTopN = !!preset.supportsTopN && (slot.presetId === 'distribution' || (slot.presetId === 'movements' && groupBy === 'categoria'))
	                  const layout = (preset as any).layout as ChartLayout | undefined
                  const baseH = chartSlots.length === 1 ? 360 : chartSlots.length === 2 ? 300 : 260
                  const height = layout === 'tall' ? baseH + (chartSlots.length === 1 ? 180 : 120) : baseH
                  const cardSpan = chartSlots.length >= 3 && layout === 'wide' ? 'xl:col-span-2' : ''

                  return (
                    <Card key={`${slot.presetId}-${idx}`} className={`bg-black/20 border border-white/10 ${cardSpan}`}>
	                      <CardHeader className="space-y-2">
	                        <div className="flex items-center gap-2">
	                          <Select
	                            value={slot.presetId}
	                            onValueChange={(v) => {
	                              const nextId = v as any
	                              const nextPreset = presetSupports(nextId)
	                              const baseNext: ChartSlotConfig = {
	                                ...slot,
	                                presetId: nextId,
	                                groupBy: nextId === 'distribution' ? 'categoria' : nextId === 'movements' ? 'tempo' : undefined,
	                                mode: nextId === 'movements' ? 'inout' : undefined
	                              }
	                              const nextViewOptions = presetViewOptions(baseNext)
	                              const presetDefault = (nextPreset as any)?.defaultView as any
	                              const nextView = nextViewOptions.includes(presetDefault) ? presetDefault : nextViewOptions[0]
	                              setChartSlot(idx, { presetId: nextId, groupBy: baseNext.groupBy, mode: baseNext.mode, view: nextView as any })
	                            }}
	                          >
                            <SelectTrigger className="h-8 w-full">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              {CHART_PRESETS.map((p) => (
                                <SelectItem key={p.id} value={p.id}>
                                  {p.label}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                          {chartSlots.length > 1 ? (
                            <Button
                              variant="outline"
                              className="h-8 w-8 p-0"
                              title="Remover gráfico"
                              aria-label="Remover gráfico"
                              onClick={() => {
                                setChartSlots((prev) => prev.filter((_, i) => i !== idx))
                              }}
                            >
                              ×
                            </Button>
                          ) : null}
                        </div>

                        <div className="flex flex-wrap items-center gap-2">
                          {slot.presetId === 'distribution' ? (
                            <Select
                              value={groupBy || 'categoria'}
                              onValueChange={(v) => {
                                const nextGroupBy = (v === 'marca' || v === 'item' || v === 'categoria' ? v : 'categoria') as ChartGroupBy
                                const baseNext: ChartSlotConfig = { ...slot, groupBy: nextGroupBy }
                                const nextViewOptions = presetViewOptions(baseNext)
                                const nextView = nextViewOptions.includes(view) ? view : nextViewOptions[0]
                                setChartSlot(idx, { groupBy: nextGroupBy, view: nextView as any })
                              }}
                            >
                              <SelectTrigger className="h-8 w-32">
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value="categoria">Categoria</SelectItem>
                                <SelectItem value="marca">Marca</SelectItem>
                                <SelectItem value="item">Item</SelectItem>
                              </SelectContent>
                            </Select>
                          ) : null}

                          {slot.presetId === 'movements' ? (
                            <>
                              <Select
                                value={groupBy === 'categoria' ? 'categoria' : 'tempo'}
                                onValueChange={(v) => {
                                  const nextGroupBy = v === 'categoria' ? ('categoria' as ChartGroupBy) : ('tempo' as ChartGroupBy)
                                  const nextMode: MovementsMode = nextGroupBy === 'categoria' ? 'saida' : 'inout'
                                  const baseNext: ChartSlotConfig = { ...slot, groupBy: nextGroupBy, mode: nextMode }
                                  const nextViewOptions = presetViewOptions(baseNext)
                                  const nextView = nextViewOptions.includes(view) ? view : nextViewOptions[0]
                                  setChartSlot(idx, { groupBy: nextGroupBy, mode: nextMode, view: nextView as any })
                                }}
                              >
                                <SelectTrigger className="h-8 w-28">
                                  <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                  <SelectItem value="tempo">Tempo</SelectItem>
                                  <SelectItem value="categoria">Categoria</SelectItem>
                                </SelectContent>
                              </Select>

                              {groupBy === 'categoria' ? (
                                <Select
                                  value={mode === 'entrada' ? 'entrada' : 'saida'}
                                  onValueChange={(v) => {
                                    const nextMode = v === 'entrada' ? ('entrada' as MovementsMode) : ('saida' as MovementsMode)
                                    setChartSlot(idx, { mode: nextMode })
                                  }}
                                >
                                  <SelectTrigger className="h-8 w-28">
                                    <SelectValue />
                                  </SelectTrigger>
                                  <SelectContent>
                                    <SelectItem value="saida">Saídas</SelectItem>
                                    <SelectItem value="entrada">Entradas</SelectItem>
                                  </SelectContent>
                                </Select>
                              ) : (
                                <Select
                                  value={mode || 'inout'}
                                  onValueChange={(v) => {
                                    const nextMode =
                                      v === 'saldo' || v === 'entrada' || v === 'saida' || v === 'inout' ? (v as MovementsMode) : ('inout' as MovementsMode)
                                    setChartSlot(idx, { mode: nextMode })
                                  }}
                                >
                                  <SelectTrigger className="h-8 w-36">
                                    <SelectValue />
                                  </SelectTrigger>
                                  <SelectContent>
                                    <SelectItem value="inout">Entradas vs Saídas</SelectItem>
                                    <SelectItem value="saldo">Saldo</SelectItem>
                                    <SelectItem value="entrada">Entradas</SelectItem>
                                    <SelectItem value="saida">Saídas</SelectItem>
                                  </SelectContent>
                                </Select>
                              )}
                            </>
                          ) : null}

                          {preset.supportsMetric ? (
                            <Select value={metric} onValueChange={(v) => setChartSlot(idx, { metric: v as any })}>
                              <SelectTrigger className="h-8 w-24">
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value="qtd">Qtd</SelectItem>
                                <SelectItem value="valor">R$</SelectItem>
                              </SelectContent>
                            </Select>
                          ) : null}

                          {preset.supportsView && viewOptions.length > 1 ? (
                            <Select value={view} onValueChange={(v) => setChartSlot(idx, { view: v as any })}>
                              <SelectTrigger className="h-8 w-28">
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                {viewOptions.map((vv) => (
                                  <SelectItem key={vv} value={vv}>
                                    {vv === 'bar' ? 'Barras' : vv === 'line' ? 'Linhas' : 'Pizza'}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          ) : null}

                          {showTopN ? (
                            <Select value={String(topN)} onValueChange={(v) => setChartSlot(idx, { topN: parseInt(String(v), 10) || 8 })}>
                              <SelectTrigger className="h-8 w-20">
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value="5">Top 5</SelectItem>
                                <SelectItem value="8">Top 8</SelectItem>
                                <SelectItem value="10">Top 10</SelectItem>
                                <SelectItem value="15">Top 15</SelectItem>
                              </SelectContent>
                            </Select>
                          ) : null}
                        </div>
                        <div className="flex justify-end" />
                      </CardHeader>
                      <CardContent>
                        {renderChart({ ...slot, view, metric, topN }, { height })}
                      </CardContent>
                    </Card>
                  )
                })}
              </div>

	                              </CardContent>
	                            ) : null}
	                          </Card>
	                        </div>
                      )
                    }}
                  </Draggable>
                ))}
                {dropProvided.placeholder}
              </div>
            )}
          </Droppable>
        </div>
      </div>

      <Dialog
        open={qualityMatchesOpen}
        onOpenChange={(next) => {
          setQualityMatchesOpen(next)
          if (!next) {
            setQualityMatchesIssue(null)
            setQualityMatchesItems([])
            setQualityMatchesSavingRegistro('')
          }
        }}
      >
        <DialogContent size="wideTable" className={dialogMediumClass}>
          <DialogHeader>
            <DialogTitle>Duplicidade de código de barras</DialogTitle>
            <DialogDescription>
              {qualityMatchesIssue?.codigoBarras ? (
                <>
                  Selecione qual registro editar ou excluir para o código <span className="font-mono">#{qualityMatchesIssue.codigoBarras}</span>.
                  {' '}
                  ({qualityMatchesItems.length} correspondências)
                </>
              ) : (
                <>Selecione qual registro editar ou excluir para resolver a duplicidade.</>
              )}
            </DialogDescription>
          </DialogHeader>
          <div className="overflow-auto max-h-[60vh] rounded-xl border border-white/10">
            <table className="min-w-full text-sm">
                      <thead className="bg-black/30 text-blue-100/80">
                        <tr>
                          <th className="text-left p-3 w-[20%]">Registro</th>
                          <th className="text-left p-3 w-[32%]">Produto</th>
                          <th className="text-left p-3 hidden md:table-cell w-[18%]">Lote</th>
                          <th className="text-left p-3 hidden sm:table-cell w-[14%]">Estoque ({unidadeLabel(unidade)})</th>
                          <th className="text-left p-3 w-[16%]">Ações</th>
                        </tr>
                      </thead>
              <tbody className="divide-y divide-white/5">
                {qualityMatchesItems.map((item) => {
                  const registro = String(item?.registro || '').trim()
                  const isDeleting = qualityMatchesSavingRegistro === registro
                  return (
                    <tr key={registro || String(item?.codigoBarras || '')} className="hover:bg-white/5">
                      <td className="p-3 font-mono text-blue-100/80">{registro || '-'}</td>
                      <td className="p-3 text-blue-50">{String(item?.produto || '-')}</td>
                      <td className="p-3 text-blue-100/70 hidden md:table-cell">{String(item?.lote || '-')}</td>
                      <td className="p-3 text-blue-100/70 hidden sm:table-cell">{Number(item?.estoqueAtual || 0)}</td>
                      <td className="p-3">
                        <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2">
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => {
                              setQualityMatchesOpen(false)
                              openEditDialog(item)
                            }}
                            disabled={!isAuthed || isDeleting}
                          >
                            Editar
                          </Button>
                          <Button
                            size="sm"
                            variant="destructive"
                            onClick={() => void deleteInsumoByRegistro(registro)}
                            disabled={!isAuthed || !registro || isDeleting}
                          >
                            {isDeleting ? 'Excluindo…' : 'Excluir'}
                          </Button>
                        </div>
                      </td>
                    </tr>
                  )
                })}
                {!qualityMatchesItems.length ? (
                  <tr>
                    <td className="p-3 text-blue-100/70" colSpan={5}>Nenhuma correspondência encontrada.</td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog
        open={editOpen}
        onOpenChange={(v) => {
          setEditOpen(v)
          if (!v) setEditTarget(null)
        }}
      >
        <DialogContent className={dialogLargeClass}>
          <DialogHeader>
            <DialogTitle>Editar insumo</DialogTitle>
            <DialogDescription className="break-words">
              {editTarget?.produto || '-'} • <span className="font-mono break-all">{editTarget?.codigoBarras || '-'}</span>
              {editTarget?.registro ? <span className="break-all"> • Reg {editTarget.registro}</span> : null}
            </DialogDescription>
          </DialogHeader>

          {editSaveError ? (
            <div className="mt-2 rounded-lg border border-red-500/40 bg-red-500/10 p-2 text-sm text-red-100">
              {editSaveError}
            </div>
          ) : null}

          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <div>
              <div className="text-xs text-muted-foreground mb-1">Código de barras</div>
              <Input
                value={editCodigo}
                onChange={(e) => {
                  setEditCodigo(e.target.value)
                  clearEditValidationError('codigoBarras')
                }}
                placeholder="789..."
                aria-invalid={editValidationErrors.codigoBarras ? true : undefined}
                className={
                  editValidationErrors.codigoBarras
                    ? 'border-red-500/60 focus:border-red-500/60 focus:ring-red-500/25'
                    : undefined
                }
              />
              {editValidationErrors.codigoBarras ? (
                <div className="mt-1 text-xs text-red-300">{editValidationErrors.codigoBarras}</div>
              ) : null}
            </div>
            <div className="md:col-span-2">
              <div className="text-xs text-muted-foreground mb-1">Códigos adicionais</div>
              <Textarea
                value={editCodigosExtras}
                onChange={(e) => setEditCodigosExtras(e.target.value)}
                placeholder="um por linha"
                rows={3}
                className="bg-white/[0.06] border-white/20 text-white"
              />
              <div className="mt-1 text-[10px] text-muted-foreground">
                Opcional. Use para variações de código do mesmo produto.
              </div>
            </div>
            <div className="md:col-span-2">
              <div className="text-xs text-muted-foreground mb-1">Produto</div>
              <Input
                value={editProduto}
                onChange={(e) => {
                  setEditProduto(e.target.value)
                  clearEditValidationError('produto')
                }}
                placeholder="Nome do produto"
                aria-invalid={editValidationErrors.produto ? true : undefined}
                className={
                  editValidationErrors.produto
                    ? 'border-red-500/60 focus:border-red-500/60 focus:ring-red-500/25'
                    : undefined
                }
              />
              {editValidationErrors.produto ? (
                <div className="mt-1 text-xs text-red-300">{editValidationErrors.produto}</div>
              ) : null}
            </div>
	            <div>
	              <div className="text-xs text-muted-foreground mb-1">Categoria</div>
	              <AutocompleteInput
	                value={editCategoria}
	                onValueChange={(next) => {
	                  setEditCategoria(next)
	                  clearEditValidationError('categoria')
	                }}
	                placeholder="ex: toxina"
	                options={lotCategorias}
	                inputTestId="insumos-edit-categoria"
	                ariaInvalid={editValidationErrors.categoria ? true : undefined}
	                inputClassName={
	                  editValidationErrors.categoria
	                    ? 'border-red-500/60 focus:border-red-500/60 focus:ring-red-500/25'
	                    : undefined
	                }
	              />
	              {editValidationErrors.categoria ? (
	                <div className="mt-1 text-xs text-red-300">{editValidationErrors.categoria}</div>
	              ) : null}
            </div>
            <div
              className={`md:col-span-2 rounded-xl border p-3 ${
                editValidationErrors.policy ? 'border-red-500/50 bg-red-500/5' : 'border-white/10 bg-black/10'
              }`}
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="text-xs text-muted-foreground">Política do item</div>
                <div className="text-xs text-muted-foreground">Defina as regras para este insumo.</div>
              </div>
              <div className="mt-2 flex flex-wrap items-center gap-4 text-sm text-blue-100/80">
                <label className={`flex items-center gap-2 ${isManagerRole ? 'cursor-pointer' : 'cursor-default'} select-none`}>
                  <Checkbox
                    checked={editCategoriaRequiresLot}
                    onCheckedChange={(v) => {
                      setEditCategoriaRequiresLot(!!v)
                      clearEditValidationError('policy')
                      clearEditValidationError('lote')
                    }}
                    disabled={!isManagerRole}
                  />
                  Lote obrigatório
                </label>
                <label className={`flex items-center gap-2 ${isManagerRole ? 'cursor-pointer' : 'cursor-default'} select-none`}>
                  <Checkbox
                    checked={editCategoriaRequiresExpiry}
                    onCheckedChange={(v) => {
                      const next = !!v
                      setEditCategoriaRequiresExpiry(next)
                      if (!next) setEditCategoriaFefo(false)
                      clearEditValidationError('policy')
                      clearEditValidationError('dataValidade')
                    }}
                    disabled={!isManagerRole}
                  />
                  Validade obrigatória
                </label>
                <label className={`flex items-center gap-2 ${isManagerRole ? 'cursor-pointer' : 'cursor-default'} select-none`}>
                  <Checkbox
                    checked={editCategoriaFefo}
                    onCheckedChange={(v) => {
                      const next = !!v
                      setEditCategoriaFefo(next)
                      if (next) setEditCategoriaRequiresExpiry(true)
                      clearEditValidationError('policy')
                    }}
                    disabled={!isManagerRole}
                  />
                  FEFO
                </label>
                {!isManagerRole ? <span className="text-xs text-muted-foreground">Somente gestores alteram.</span> : null}
              </div>
              {editValidationErrors.policy ? (
                <div className="mt-2 text-xs text-red-300">{editValidationErrors.policy}</div>
              ) : null}
            </div>
	            <div>
	              <div className="text-xs text-muted-foreground mb-1">Marca</div>
	              <AutocompleteInput
	                value={editMarca}
	                onValueChange={(next) => {
	                  setEditMarca(next)
	                  clearEditValidationError('marca')
	                }}
	                placeholder="ex: Allergan"
	                options={insumosMarcas}
	                inputTestId="insumos-edit-marca"
	                ariaInvalid={editValidationErrors.marca ? true : undefined}
	                inputClassName={
	                  editValidationErrors.marca ? 'border-red-500/60 focus:border-red-500/60 focus:ring-red-500/25' : undefined
	                }
	              />
	              {editValidationErrors.marca ? (
	                <div className="mt-1 text-xs text-red-300">{editValidationErrors.marca}</div>
	              ) : null}
	            </div>
            <div>
              <div className="text-xs text-muted-foreground mb-1">Unidade (medida)</div>
              <Select
                value={normalizeTipoUnidadeToCanonical(editTipoUnidade) || undefined}
                onValueChange={(v) => {
                  setEditTipoUnidade(v)
                  clearEditValidationError('tipoUnidade')
                }}
              >
                <SelectTrigger
                  aria-invalid={editValidationErrors.tipoUnidade ? true : undefined}
                  className={
                    editValidationErrors.tipoUnidade ? 'border-red-500/60 ring-2 ring-red-500/15' : undefined
                  }
                >
                  <SelectValue placeholder="Selecione a unidade" />
                </SelectTrigger>
                <SelectContent>
                  {insumosTiposUnidade.map((t) => (
                    <SelectItem key={t} value={t}>
                      {t}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {editValidationErrors.tipoUnidade ? (
                <div className="mt-1 text-xs text-red-300">{editValidationErrors.tipoUnidade}</div>
              ) : null}
            </div>
            <div>
              <div className="text-xs text-muted-foreground mb-1">Preço custo (R$)</div>
              <Input value={editPrecoCusto} onChange={(e) => setEditPrecoCusto(e.target.value)} placeholder="ex: 120,00" />
            </div>
            <div>
              <div className="text-xs text-muted-foreground mb-1">Estoque mínimo</div>
              <Input value={editEstoqueMinimo} onChange={(e) => setEditEstoqueMinimo(e.target.value)} placeholder="ex: 5" />
            </div>
            <div>
              <div className="text-xs text-muted-foreground mb-1">Lote</div>
              <Input
                value={editLote}
                onChange={(e) => {
                  setEditLote(e.target.value)
                  clearEditValidationError('lote')
                }}
                placeholder="ex: L2026-01"
                aria-invalid={editValidationErrors.lote ? true : undefined}
                className={editValidationErrors.lote ? 'border-red-500/60 focus:border-red-500/60 focus:ring-red-500/25' : undefined}
              />
              {editValidationErrors.lote ? (
                <div className="mt-1 text-xs text-red-300">{editValidationErrors.lote}</div>
              ) : null}
            </div>
            <div>
              <div className="text-xs text-muted-foreground mb-1">Validade</div>
              <BrDatePickerInput
                value={editDataValidade}
                onChange={(v) => {
                  setEditDataValidade(v)
                  clearEditValidationError('dataValidade')
                }}
                placeholder="DD/MM/AA"
                ariaLabel="Validade"
                className={editValidationErrors.dataValidade ? 'border-red-500/60 focus:border-red-500/60 focus:ring-red-500/25' : undefined}
              />
              {editValidationErrors.dataValidade ? (
                <div className="mt-1 text-xs text-red-300">{editValidationErrors.dataValidade}</div>
              ) : null}
            </div>
          </div>

          <details
            data-pref-key="insumos.details.edit.optional"
            open={detailsOpen['insumos.details.edit.optional'] ?? true}
            onToggle={(e) => setDetailsKeyOpen('insumos.details.edit.optional', (e.currentTarget as HTMLDetailsElement).open)}
            className="mt-2 rounded-lg border border-white/10 bg-black/10 p-3"
          >
            <summary className="cursor-pointer select-none text-sm text-blue-100/80">Detalhes (opcional)</summary>
            <div className="mt-3 grid grid-cols-1 md:grid-cols-3 gap-2">
              <div className="md:col-span-2">
                <div className="text-xs text-muted-foreground mb-1">Especificação / Modelo</div>
                <Input value={editEspecificacao} onChange={(e) => setEditEspecificacao(e.target.value)} placeholder="ex: Base, Lidocaine" />
              </div>
              <div>
                <div className="text-xs text-muted-foreground mb-1">Concentração</div>
                <Input value={editConcentracao} onChange={(e) => setEditConcentracao(e.target.value)} placeholder="ex: 300U" />
              </div>
              <div>
                <div className="text-xs text-muted-foreground mb-1">Volume</div>
                <Input value={editVolume} onChange={(e) => setEditVolume(e.target.value)} placeholder="ex: 1ml" />
              </div>
              <div>
                <div className="text-xs text-muted-foreground mb-1">Calibre / Bitola</div>
                <Input value={editCalibre} onChange={(e) => setEditCalibre(e.target.value)} placeholder="ex: 30G" />
              </div>
              <div className="md:col-span-2">
                <div className="text-xs text-muted-foreground mb-1">Homologado</div>
                <label className="flex items-center gap-2 text-sm text-blue-100/80 select-none">
                  <Checkbox checked={editHomologado} onCheckedChange={(v) => setEditHomologado(!!v)} />
                  Produto homologado
                </label>
              </div>
            </div>
          </details>

          <DialogFooter>
            {!canUseApi ? (
              <span className="mr-auto text-xs text-muted-foreground">API indisponivel. Aguarde o carregamento.</span>
            ) : null}
            <Button variant="secondary" onClick={() => setEditOpen(false)} disabled={editSaving}>
              Cancelar
            </Button>
            <Button variant="destructive" onClick={deleteEdit} disabled={editSaving || !isAuthed}>
              Excluir
            </Button>
            <Button onClick={saveEdit} disabled={editSaving || !isAuthed || !canUseApi}>
              {editSaving ? 'Salvando…' : 'Salvar'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={lotDialogOpen} onOpenChange={setLotDialogOpen}>
        <DialogContent className={dialogSmallClass}>
          <DialogHeader>
            <DialogTitle>Editar lote/validade</DialogTitle>
            <DialogDescription>
              {lotSelecionado?.produto || '-'} • <span className="font-mono">{lotSelecionado?.codigoBarras || '-'}</span>
            </DialogDescription>
          </DialogHeader>

          {lotSelecionado ? (
            <div className="rounded-lg border border-white/10 bg-black/20 p-3 text-sm text-blue-100/70">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                <div>
                  <div className="text-xs text-muted-foreground">Categoria</div>
                  <div className="text-blue-100/80">{lotSelecionado.categoria || '-'}</div>
                </div>
                <div>
                  <div className="text-xs text-muted-foreground">Marca</div>
                  <div className="text-blue-100/80">{lotSelecionado.marca || '-'}</div>
                </div>
                {lotSelecionado.concentracao ? (
                  <div>
                    <div className="text-xs text-muted-foreground">Concentração</div>
                    <div className="text-blue-100/80">{lotSelecionado.concentracao}</div>
                  </div>
                ) : null}
                {lotSelecionado.volume ? (
                  <div>
                    <div className="text-xs text-muted-foreground">Volume</div>
                    <div className="text-blue-100/80">{lotSelecionado.volume}</div>
                  </div>
                ) : null}
                {lotSelecionado.calibre ? (
                  <div>
                    <div className="text-xs text-muted-foreground">Calibre</div>
                    <div className="text-blue-100/80">{lotSelecionado.calibre}</div>
                  </div>
                ) : null}
                <div>
                  <div className="text-xs text-muted-foreground">Homologado</div>
                  <div className="text-blue-100/80">
                    {/homologad/i.test(String(lotSelecionado.fonte || '').trim()) ? 'Sim' : 'Não'}
                  </div>
                </div>
              </div>
            </div>
          ) : null}

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div>
              <div className="text-xs text-muted-foreground mb-1">Lote</div>
              <Input value={lotEditLote} onChange={(e) => setLotEditLote(e.target.value)} placeholder="ex: 2026-01A" />
            </div>
            <div>
              <div className="text-xs text-muted-foreground mb-1">Validade</div>
              <BrDatePickerInput value={lotEditValidade} onChange={setLotEditValidade} placeholder="DD/MM/AA" ariaLabel="Validade do lote" />
            </div>
          </div>

          <DialogFooter>
            <Button variant="secondary" onClick={() => setLotDialogOpen(false)}>
              Cancelar
            </Button>
            <Button onClick={saveLot} disabled={lotSaving || !isAuthed}>
              {lotSaving ? 'Salvando…' : 'Salvar'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

        <Droppable droppableId="main-panels" direction={mainPanelsDirection}>
          {(dropProvided) => (
            <div
              ref={dropProvided.innerRef}
              {...dropProvided.droppableProps}
              className="max-w-6xl mx-auto flex flex-col lg:flex-row gap-3"
            >
              {/*
              <Draggable draggableId="main-insumos" index={mainOrderIndex.get('insumos') ?? 0}>
                {(dragProvided) => (
                  <div
                    ref={(el) => {
                      dragProvided.innerRef(el)
                      insumosSectionRef.current = el
                    }}
                    {...dragProvided.draggableProps}
                    style={{ ...(dragProvided.draggableProps.style || {}), order: mainOrderIndex.get('insumos') ?? 0 }}
                    className="space-y-3 flex-1 min-w-0"
                  >
	          <Card className="bg-black/20 border border-white/10">
	            <CardHeader className="relative pr-24">
	              <div>
	                <div className="text-white text-lg font-semibold">Insumos</div>
	                <div className="text-sm text-blue-100/70">Cadastro, estoque e ações rápidas.</div>
	                {offlineQueueCount > 0 ? (
	                  <div className="mt-2">
	                    <Button variant="outline" size="sm" onClick={() => setOfflineDialogOpen(true)} disabled={!isAuthed}>
	                      Pendências <span className="ml-2 font-mono">{offlineQueueCount}</span>
	                    </Button>
	                  </div>
	                ) : null}
	              </div>
	              <div className="absolute top-2 right-2 flex items-center gap-1">
	                <div
	                  {...dragProvided.dragHandleProps}
	                  className="h-9 w-9 flex items-center justify-center rounded-md bg-transparent text-white hover:bg-white/[0.10] cursor-grab active:cursor-grabbing"
	                  title="Arraste para mover"
	                  aria-label="Mover"
	                  role="button"
	                  tabIndex={0}
	                >
	                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden>
	                    <path d="M9 6h.01M15 6h.01M9 12h.01M15 12h.01M9 18h.01M15 18h.01" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
	                  </svg>
	                </div>
	                <Button
	                  size="icon"
	                  variant="ghost"
	                  className="h-9 w-9 bg-transparent text-white hover:bg-white/[0.10]"
	                  onClick={() => setDetailsKeyOpen(MAIN_PANEL_OPEN_KEYS.insumos, !insumosPanelOpen)}
                  title={insumosPanelOpen ? 'Contrair' : 'Expandir'}
                  aria-label={insumosPanelOpen ? 'Contrair' : 'Expandir'}
                >
                  {insumosPanelOpen ? (
                    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden>
                      <path d="M6 15l6-6 6 6" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  ) : (
                    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden>
                      <path d="M6 9l6 6 6-6" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
	                  )}
	                </Button>
	              </div>
	            </CardHeader>
            {insumosPanelOpen ? (
              <CardContent className="space-y-3">

        {sharePayload && !shareHidden ? (
          <div className="rounded-xl border border-white/10 bg-black/30 p-3 text-sm text-blue-100/80">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="text-blue-50 font-semibold">Compartilhamento recebido</div>
              <Button variant="secondary" size="sm" onClick={() => setShareHidden(true)}>
                Fechar
              </Button>
            </div>
            {shareLoading ? <div className="mt-2 text-xs text-blue-200/60">Carregando anexos…</div> : null}
            <div className="mt-2 space-y-1">
              {sharePayload.title ? (
                <div>
                  <span className="text-blue-200/70">Título:</span> {sharePayload.title}
                </div>
              ) : null}
              {sharePayload.text ? (
                <div>
                  <span className="text-blue-200/70">Texto:</span> {sharePayload.text}
                </div>
              ) : null}
              {sharePayload.url ? (
                <div className="break-words">
                  <span className="text-blue-200/70">Link:</span>{' '}
                  <a className="underline" href={sharePayload.url} target="_blank" rel="noreferrer">
                    {sharePayload.url}
                  </a>
                </div>
              ) : null}
              {sharePayload.files && sharePayload.files.length ? (
                <div className="space-y-1">
                  <div className="text-blue-200/70">Arquivos:</div>
                  <div className="flex flex-wrap gap-2">
                    {sharePayload.files.map((f, idx) => (
                      <span key={`${f.name}-${idx}`} className="text-xs">
                        {f.url ? (
                          <a className="underline" href={f.url} target="_blank" rel="noreferrer">
                            {f.name}
                          </a>
                        ) : (
                          f.name
                        )}
                      </span>
                    ))}
                  </div>
                </div>
              ) : null}
            </div>
            <div className="mt-2 text-xs text-blue-200/60">
              Preenchi o cadastro com os dados compartilhados. Revise antes de salvar.
            </div>
          </div>
        ) : null}
        {shareHistory.length ? (
          <Card className="bg-black/20 border border-white/10">
            <CardHeader className="flex flex-row items-center justify-between gap-2">
              <CardTitle className="text-white text-sm">Importações recentes</CardTitle>
              <div className="flex items-center gap-2">
                <span className="text-xs text-blue-200/60">{shareHistory.length} itens</span>
                <Button variant="secondary" size="sm" onClick={clearShareHistory}>
                  Limpar
                </Button>
              </div>
            </CardHeader>
            <CardContent className="space-y-2">
              {shareHistoryLoading ? <div className="text-xs text-blue-200/60">Sincronizando…</div> : null}
              {shareHistory.slice(0, 6).map((item) => (
                <div key={item.id} className="rounded-lg border border-white/10 bg-black/20 px-3 py-2">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="text-sm text-blue-50">
                      {item.title || item.url || 'Conteúdo compartilhado'}
                    </div>
                    <div className="text-xs text-blue-200/60">{fmtDate(item.createdAt)}</div>
                  </div>
                  {item.text ? <div className="text-xs text-blue-200/70 mt-1">{item.text}</div> : null}
                  {item.files && item.files.length ? (
                    <div className="mt-1 flex flex-wrap gap-2 text-xs text-blue-200/70">
                      {item.files.map((f, idx) => (
                      <span key={`${item.id}-${idx}`} className="break-words">
                        {f.url ? (
                          <a className="underline" href={f.url} target="_blank" rel="noreferrer">
                            {f.name}
                          </a>
                          ) : (
                            f.name
                          )}
                        </span>
                      ))}
                    </div>
                  ) : null}
                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    <Button variant="secondary" size="sm" onClick={() => applyShareToForm(item)}>
                      Usar no cadastro
                    </Button>
                    <Button variant="outline" size="sm" onClick={() => removeShareHistory(item.id)}>
                      Remover
                    </Button>
                  </div>
                </div>
              ))}
            </CardContent>
          </Card>
        ) : null}
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <Input
              value={insumosQuery}
              onChange={(e) => setInsumosQuery(e.target.value)}
              placeholder="Buscar por código, produto, categoria…"
              className="w-80"
            />
            <Button
              variant="outline"
              onClick={() => window.open(`/api/insumos/export/insumos.csv?unidade=${encodeURIComponent(unidade)}`, '_blank', 'noopener,noreferrer')}
              disabled={!isAuthed}
              title="Exportar CSV"
            >
              Exportar
            </Button>
            <Button
              variant="outline"
              onClick={() => setCreateOpen((v) => !v)}
              disabled={!isAuthed}
            >
              {createOpen ? 'Fechar' : 'Adicionar'}
            </Button>
          </div>
          <div className="text-xs text-blue-200/60">
            {insumosTotal != null ? (
              <>
                {filteredInsumos.length} de <span className="font-mono">{insumosTotal}</span> itens
              </>
            ) : (
              `${filteredInsumos.length} itens`
            )}
          </div>
        </div>
        {insumosHasMore ? (
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="text-xs text-blue-200/60">Role até o fim para carregar mais…</div>
          </div>
        ) : null}

        {createOpen ? (
          <div className="rounded-xl border border-white/10 bg-black/20 p-3 space-y-3">
            <div className="text-sm text-blue-100/70">
              Cadastro rápido (campos mínimos) + detalhes opcionais (como no app antigo de Insumos).
            </div>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
              <div>
                <div className="text-xs text-blue-200/70 mb-1">Código de barras</div>
                <div className="flex items-center gap-2">
                  <Input value={createCodigo} onChange={(e) => setCreateCodigo(e.target.value)} placeholder="789..." />
                  <Button variant="secondary" type="button" onClick={() => setCreateScanOpen((v) => !v)}>
                    {createScanOpen ? 'Fechar' : 'Escanear'}
                  </Button>
                </div>
                <div className="mt-2">
                  {createLookupLoading ? (
                    <div className="text-xs text-blue-200/70">Buscando informações do insumo…</div>
                  ) : createLookupError ? (
                    <div className="text-xs text-red-200">{createLookupError}</div>
                  ) : createLookupItems.length ? (
                    <div className="text-xs text-blue-200/70">
                      Encontramos um cadastro para este código e pré-preenchemos alguns campos (produto/categoria/marca). Se quiser, você pode cadastrar um novo lote.
                    </div>
                  ) : null}
                </div>
                <div className="mt-2">
                  <div className="text-xs text-blue-200/70 mb-1">Códigos adicionais</div>
                  <Textarea
                    value={createCodigosExtras}
                    onChange={(e) => setCreateCodigosExtras(e.target.value)}
                    placeholder="um por linha"
                    rows={3}
                    className="bg-white/[0.06] border-white/20 text-white"
                  />
                  <div className="mt-1 text-[10px] text-blue-200/50">
                    Opcional. Use para variações de código do mesmo produto.
                  </div>
                </div>
              </div>
              <div className="md:col-span-2">
                <div className="text-xs text-blue-200/70 mb-1">Produto</div>
                <Input value={createProduto} onChange={(e) => setCreateProduto(e.target.value)} placeholder="Nome do produto" />
              </div>
              <div>
                <div className="text-xs text-blue-200/70 mb-1">Categoria</div>
                <Input
                  value={createCategoria}
                  onChange={(e) => setCreateCategoria(e.target.value)}
                  placeholder="ex: Anestésicos"
                  list="insumos-categorias"
                />
                <datalist id="insumos-categorias">
                  {lotCategorias.map((c) => (
                    <option key={c} value={c} />
                  ))}
                </datalist>
              </div>
              <div className="md:col-span-2 rounded-xl border border-white/10 bg-black/10 p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="text-xs text-blue-200/70">Política do item</div>
                  <div className="text-xs text-blue-200/60">Defina as regras para este insumo.</div>
                </div>
                <div className="mt-2 flex flex-wrap items-center gap-4 text-sm text-blue-100/80">
                  <label className={`flex items-center gap-2 ${isManagerRole ? 'cursor-pointer' : 'cursor-default'} select-none`}>
                    <Checkbox
                      checked={createCategoriaRequiresLot}
                      onCheckedChange={(v) => {
                        setCreatePolicyTouched(true)
                        setCreateCategoriaRequiresLot(!!v)
                      }}
                      disabled={!isManagerRole}
                    />
                    Lote obrigatório
                  </label>
                  <label className={`flex items-center gap-2 ${isManagerRole ? 'cursor-pointer' : 'cursor-default'} select-none`}>
                    <Checkbox
                      checked={createCategoriaRequiresExpiry}
                      onCheckedChange={(v) => {
                        setCreatePolicyTouched(true)
                        const next = !!v
                        setCreateCategoriaRequiresExpiry(next)
                        if (!next) setCreateCategoriaFefo(false)
                      }}
                      disabled={!isManagerRole}
                    />
                    Validade obrigatória
                  </label>
                  <label className={`flex items-center gap-2 ${isManagerRole ? 'cursor-pointer' : 'cursor-default'} select-none`}>
                    <Checkbox
                      checked={createCategoriaFefo}
                      onCheckedChange={(v) => {
                        setCreatePolicyTouched(true)
                        const next = !!v
                        setCreateCategoriaFefo(next)
                        if (next) setCreateCategoriaRequiresExpiry(true)
                      }}
                      disabled={!isManagerRole}
                    />
                    FEFO
                  </label>
                  {!isManagerRole ? <span className="text-xs text-blue-200/60">Somente gestores alteram.</span> : null}
                </div>
              </div>
              <div>
                <div className="text-xs text-blue-200/70 mb-1">Marca</div>
                <Input
                  value={createMarca}
                  onChange={(e) => setCreateMarca(e.target.value)}
                  placeholder="ex: Galderma"
                  list="insumos-marcas"
                />
                <datalist id="insumos-marcas">
                  {insumosMarcas.map((m) => (
                    <option key={m} value={m} />
                  ))}
                </datalist>
              </div>
              <div>
                <div className="text-xs text-blue-200/70 mb-1">Unidade (medida)</div>
                <Select
                  value={normalizeTipoUnidadeToCanonical(createTipoUnidade) || undefined}
                  onValueChange={setCreateTipoUnidade}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Selecione a unidade" />
                  </SelectTrigger>
                  <SelectContent>
                    {insumosTiposUnidade.map((u) => (
                      <SelectItem key={u} value={u}>
                        {u}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <div className="text-xs text-blue-200/70 mb-1">Preço custo</div>
                <Input value={createPrecoCusto} onChange={(e) => setCreatePrecoCusto(e.target.value)} placeholder="R$ 0,00" />
              </div>
              <div>
                <div className="text-xs text-blue-200/70 mb-1">Estoque inicial ({unidadeLabel(unidade)})</div>
                <Input value={createEstoqueInicial} onChange={(e) => setCreateEstoqueInicial(e.target.value)} type="number" min={0} />
              </div>
              <div>
                <div className="text-xs text-blue-200/70 mb-1">Estoque mínimo</div>
                <Input value={createEstoqueMinimo} onChange={(e) => setCreateEstoqueMinimo(e.target.value)} type="number" min={0} />
              </div>
              <div>
                <div className="flex items-center justify-between gap-2 mb-1">
                  <div className="text-xs text-blue-200/70">Lote</div>
                  <Button
                    variant={createNovoLote ? 'secondary' : 'outline'}
                    size="sm"
                    type="button"
                    onClick={() => setCreateNovoLote((v) => !v)}
                    title="Ative quando estiver cadastrando um lote adicional para um código já existente."
                  >
                    {createNovoLote ? 'Novo lote: on' : 'Novo lote: off'}
                  </Button>
                </div>
                <Input
                  value={createLote}
                  onChange={(e) => setCreateLote(e.target.value)}
                  placeholder={createNovoLote ? 'obrigatório (ex: L2026-01)' : 'opcional'}
                />
              </div>
              <div>
                <div className="text-xs text-blue-200/70 mb-1">Validade</div>
                <BrDatePickerInput value={createDataValidade} onChange={setCreateDataValidade} placeholder="DD/MM/AA" ariaLabel="Validade" />
              </div>
            </div>

            <details
              data-pref-key="insumos.details.create.optional"
              open={detailsOpen['insumos.details.create.optional'] ?? true}
              onToggle={(e) => setDetailsKeyOpen('insumos.details.create.optional', (e.currentTarget as HTMLDetailsElement).open)}
              className="rounded-lg border border-white/10 bg-black/10 p-3"
            >
              <summary className="cursor-pointer select-none text-sm text-blue-100/80">
                Detalhes (opcional)
              </summary>
              <div className="mt-3 grid grid-cols-1 md:grid-cols-3 gap-2">
                <div className="md:col-span-2">
                  <div className="text-xs text-blue-200/70 mb-1">Especificação / Modelo</div>
                  <Input
                    value={createEspecificacao}
                    onChange={(e) => setCreateEspecificacao(e.target.value)}
                    placeholder="ex: Base, Lidocaine"
                  />
                </div>
                <div>
                  <div className="text-xs text-blue-200/70 mb-1">Concentração</div>
                  <Input
                    value={createConcentracao}
                    onChange={(e) => setCreateConcentracao(e.target.value)}
                    placeholder="ex: 300U"
                  />
                </div>
                <div>
                  <div className="text-xs text-blue-200/70 mb-1">Volume</div>
                  <Input
                    value={createVolume}
                    onChange={(e) => setCreateVolume(e.target.value)}
                    placeholder="ex: 1ml"
                  />
                </div>
                <div>
                  <div className="text-xs text-blue-200/70 mb-1">Calibre / Bitola</div>
                  <Input
                    value={createCalibre}
                    onChange={(e) => setCreateCalibre(e.target.value)}
                    placeholder="ex: 30G"
                  />
                </div>
                <div className="md:col-span-2">
                  <div className="text-xs text-blue-200/70 mb-1">Homologado</div>
                  <label className="flex items-center gap-2 text-sm text-blue-100/80 select-none">
                    <Checkbox checked={createHomologado} onCheckedChange={(v) => setCreateHomologado(!!v)} />
                    Produto homologado
                  </label>
                </div>
              </div>
            </details>

            {createScanOpen ? (
              <BarcodeScannerInline
                onDetected={(code) => {
                  setCreateCodigo(code)
                  setCreateScanOpen(false)
                  toast.success('Código detectado')
                }}
                onClose={() => setCreateScanOpen(false)}
              />
            ) : null}
            <div className="flex items-center justify-between gap-2">
              <div className="text-xs text-blue-200/60">
                Dica: preencha só o essencial agora e complete os detalhes depois (categoria, lote, validade, etc.).
              </div>
              <Button
                onClick={async () => {
                  const codigoBarras = createCodigo.trim()
                  if (!codigoBarras) return toast.error('Informe o código de barras')
                  const extraCodes = parseBarcodeInput(createCodigosExtras)
                  const codigosBarras = Array.from(new Set([codigoBarras, ...extraCodes].map((v) => String(v || '').trim()).filter(Boolean)))
                  const existing = (insumos || []).find((i) => getInsumoBarcodes(i).includes(codigoBarras))
                  const categoria = createCategoria.trim() || String(existing?.categoria || '').trim()
                  const policy = {
                    requiresLot: !!createCategoriaRequiresLot,
                    requiresExpiry: !!createCategoriaRequiresExpiry,
                    fefo: !!createCategoriaFefo
                  }
                  const validadeIso = dateInputToIso(createDataValidade)

                  const allowDuplicateLot = createNovoLote || (!!existing && policy.requiresLot)
                  if (!createNovoLote && allowDuplicateLot) setCreateNovoLote(true)

                  if ((policy.requiresLot || allowDuplicateLot) && !createLote.trim()) {
                    return toast.error(policy.requiresLot ? 'Informe o lote (obrigatório pelo item)' : 'Informe o lote (Novo lote: on)')
                  }
                  if (policy.requiresExpiry && !validadeIso) {
                    return toast.error('Informe a data de validade (obrigatória pelo item)')
                  }
                  if (policy.fefo && !policy.requiresExpiry) {
                    return toast.error('FEFO exige validade obrigatória')
                  }

                  const produto = createProduto.trim() || (allowDuplicateLot ? String(existing?.produto || '').trim() : '')
                  if (!produto) return toast.error('Informe o produto')
                  const tipoUnidade = normalizeTipoUnidadeToCanonical(createTipoUnidade)
                  if (!tipoUnidade) return toast.error('Informe a unidade (medida)')

                  setCreateLoading(true)
                  try {
                    await mutateJson(`/insumos?unidade=${encodeURIComponent(unidade)}`, {
                      method: 'POST',
                      queueLabel: 'Cadastro de insumo',
                      body: {
                        codigoBarras,
                        codigosBarras,
                        produto,
                        allowDuplicateLot,
                        categoria,
                        marca: createMarca.trim(),
                        tipoUnidade,
                        especificacao: createEspecificacao.trim(),
                        concentracao: createConcentracao.trim(),
                        volume: createVolume.trim(),
                        fonte: createHomologado ? 'Homologado' : '',
                        calibre: createCalibre.trim(),
                        precoCusto: createPrecoCusto.trim(),
                        estoqueInicial: Number(createEstoqueInicial) || 0,
                        estoqueMinimo: Number(createEstoqueMinimo) || 0,
                        lote: createLote.trim(),
                        dataValidade: validadeIso,
                        policyRequiresLot: policy.requiresLot,
                        policyRequiresExpiry: policy.requiresExpiry,
                        policyFefo: policy.fefo
                      }
                    })
                    toast.success('Insumo cadastrado')
                    setCreateCodigo('')
                    setCreateCodigosExtras('')
                    setCreateProduto('')
                    setCreateCategoria('')
                    setCreateMarca('')
                    setCreateTipoUnidade('')
                    setCreateEspecificacao('')
                    setCreateConcentracao('')
                    setCreateVolume('')
                    setCreateHomologado(false)
                    setCreateCalibre('')
                    setCreatePrecoCusto('')
                    setCreateEstoqueInicial('0')
                    setCreateEstoqueMinimo('5')
                    setCreateLote('')
                    setCreateDataValidade('')
                    setCreateNovoLote(false)
                    setCreateOpen(false)
                    await Promise.allSettled([refreshInsumos({ pagina: 1 }), loadInsumosOptions()])
                  } catch (e) {
                    const status = (e as any)?.status
                    const msg = e instanceof Error ? e.message : String(e)
                    if (status === 409 && /código de barras já cadastrado/i.test(msg)) {
                      setCreateNovoLote(true)
                      toast.error('Código já existe. Ative “Novo lote” e informe Lote/Validade para cadastrar um lote adicional.')
                      return
                    }
                    if (policyErrorToast(e)) return
                    toast.error(msg)
                  } finally {
                    setCreateLoading(false)
                  }
                }}
                disabled={createLoading || !isAuthed}
              >
                {createLoading ? 'Salvando…' : 'Salvar'}
              </Button>
            </div>
          </div>
        ) : null}

        <div ref={insumosListContainerRef} onScroll={onInsumosScroll} className="overflow-auto max-h-[70vh] rounded-xl border border-white/10">
          <table className="w-full table-fixed text-sm">
            <thead className="bg-black/30 text-blue-100/80">
              <tr>
                <th className="text-left p-3 w-[28%]">Produto</th>
                <th className="text-left p-3 w-[16%]">Categoria</th>
                <th className="hidden lg:table-cell text-left p-3 w-[16%]">Código</th>
                <th className="text-right p-3 w-[7%]">Estoque</th>
                <th className="text-right p-3 w-[7%]">Mín</th>
                <th className="hidden md:table-cell text-left p-3 w-[10%]">Validade</th>
                <th className="hidden xl:table-cell text-right p-3 w-[8%]">Valor</th>
                <th className="text-right p-3 w-[8%]">Ações</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/5">
              {filteredInsumos.map((i) => {
                const codigoBarras = String(i.codigoBarras || '').trim()
                const isSelected = !!codigoBarras && selectedCodigoBarras.trim() === codigoBarras
                const estoque = Number(i.estoqueAtual) || 0
                const min = Number(i.estoqueMinimo) || 0
                const stockStatus = calcularStatusEstoque(estoque, min)
                const isCritico = stockStatus === 'URGENTE'
                const isLowStock = stockStatus === 'ATENCAO'
                const validadeStatus = String(i.statusValidade?.status || '').toUpperCase()
                const isVencendo = validadeStatus === 'VENCENDO'
                const isExpirado = validadeStatus === 'EXPIRADO'
                const valor = (Number(i.precoCusto) || 0) * estoque
                const otherStocks = i.estoques
                  ? Object.entries(i.estoques)
                    .filter(([u, v]) => u !== unidade && (Number(v) || 0) > 0)
                    .sort((a, b) => (Number(b[1]) || 0) - (Number(a[1]) || 0))
                  : []
                const otherSummary = otherStocks.length
                  ? `${otherStocks
                    .slice(0, 2)
                    .map(([u, v]) => `${unidadeLabel(u)}: ${Number(v) || 0}`)
                    .join(' • ')}${otherStocks.length > 2 ? ` • +${otherStocks.length - 2}` : ''}`
                  : ''

                return (
                  <tr
                    key={`${i.registro || ''}-${i.codigoBarras || ''}`}
                    className={isSelected ? 'bg-white/5 hover:bg-white/10' : 'hover:bg-white/5'}
                  >
                    <td className="p-3 min-w-0 align-top">
                      <button
                        type="button"
                        className="w-full text-left rounded-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-300/40 cursor-pointer group"
                        onClick={() => {
                          if (!codigoBarras) return
                          setSelectedCodigoBarras((prev) => (prev.trim() === codigoBarras ? '' : codigoBarras))
                          try {
                            movSectionRef.current?.scrollIntoView?.({ behavior: 'smooth', block: 'start' })
                          } catch {
                            // ignore
                          }
                        }}
                        title={codigoBarras ? 'Ver movimentações deste insumo' : undefined}
                        aria-pressed={isSelected}
                      >
                        <div className="flex items-center justify-between gap-2 min-w-0">
                          <div className="text-blue-50 group-hover:underline break-words line-clamp-2">{i.produto || '-'}</div>
                          {isSelected ? <div className="text-xs text-blue-200/60">Filtrando</div> : null}
                        </div>
                        {i.marca ? (
                          <div className="mt-1 flex flex-wrap gap-1">
                            <Badge style={buildTagStyle(getMarcaBgColor(String(i.marca)))} className="border">
                              {String(i.marca)}
                            </Badge>
                          </div>
                        ) : null}
                        {isCritico || isLowStock || isVencendo || isExpirado ? (
                          <div className="mt-1 flex flex-wrap gap-1">
                            {isCritico ? <Badge variant="destructive">Crítico</Badge> : null}
                            {isLowStock ? <Badge variant="secondary">Atenção</Badge> : null}
                            {isVencendo ? <Badge variant="secondary">Vencendo</Badge> : null}
                            {isExpirado ? <Badge variant="destructive">Expirado</Badge> : null}
                          </div>
                        ) : null}
                      </button>
                    </td>
                    <td className="p-3 text-blue-100/80 align-top">
                      <div className="flex items-center gap-2 min-w-0">
                        <Badge style={buildTagStyle(getCategoriaBgColor(i.categoria || 'Outros'))} className="border">
                          {i.categoria || '-'}
                        </Badge>
                      </div>
                    </td>
                    <td className="hidden lg:table-cell p-3 align-top">
                      <div className="font-mono text-blue-100/80 break-all">{i.codigoBarras || '-'}</div>
                    </td>
                    <td className={`p-3 text-right align-top ${isCritico ? 'text-red-200' : 'text-blue-100/80'}`}>
                      <div className="flex items-center justify-end gap-2">
                        <span className="font-mono">{estoque}</span>
                      </div>
                      {otherSummary ? <div className="mt-1 text-[11px] text-blue-200/50">{otherSummary}</div> : null}
                    </td>
                    <td className="p-3 text-right text-blue-100/70 align-top">{min || '-'}</td>
                    <td className="hidden md:table-cell p-3 align-top">
                      <span className="text-blue-100/70">{fmtDateOnlyBR(i.dataValidade || '')}</span>
                    </td>
                    <td className="hidden xl:table-cell p-3 text-right text-blue-100/80 align-top">{fmtMoneyBRL(valor)}</td>
                    <td className="p-3 text-right align-top">
                      <div className="flex items-center justify-end gap-2">
                        <Button
                          variant="secondary"
                          className="h-8 px-2 text-xs"
                          onClick={() => {
                            if (i.codigoBarras) {
                              selectQuickCodigo(i.codigoBarras, { setSearch: true, snapshot: i })
                            }
                          }}
                        >
                          Usar
                        </Button>
                        <Button
                          variant="outline"
                          className="h-8 px-2 text-xs"
                          onClick={() => openEditDialog(i)}
                          disabled={!isAuthed}
                        >
                          Editar
                        </Button>
                      </div>
                    </td>
                  </tr>
                )
              })}
              {!filteredInsumos.length ? (
                <tr>
                  <td className="p-3 text-blue-100/70" colSpan={8}>
                    {insumosLoadError && !insumosLoading && isAuthed ? (
                      <span className="text-red-200">
                        Erro ao carregar insumos ({insumosLoadError.status || 'erro'}
                        {insumosLoadError.code ? `/${insumosLoadError.code}` : ''}): {insumosLoadError.message}
                      </span>
                    ) : (
                      renderListPlaceholder(insumosLoading, 'Sem itens.')
                    )}
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
              </CardContent>
            ) : null}
	        </Card>
	      </div>

	    )}
	  </Draggable>
              */}

		  <Draggable draggableId="main-mov" index={mainOrderIndex.get('mov') ?? 0}>
		    {(dragProvided) => (
		      <div
	        ref={(el) => {
	          dragProvided.innerRef(el)
	          movSectionRef.current = el
	        }}
	        {...dragProvided.draggableProps}
	        style={{ ...(dragProvided.draggableProps.style || {}), order: mainOrderIndex.get('mov') ?? 0 }}
	        className="space-y-3 flex-1 min-w-0"
		      >
		        <Card className="bg-black/20 border border-white/10">
                <CardHeader className="relative pr-24">
                  <div className="flex flex-col gap-2 min-w-0 w-full md:flex-row md:items-center">
                    <div className="flex items-center gap-3 min-w-0">
                      <button
                        type="button"
                        {...dragProvided.dragHandleProps}
			                className="mt-0.5 h-9 w-9 flex items-center justify-center rounded-md bg-transparent text-white hover:bg-white/[0.10] cursor-grab active:cursor-grabbing"
			                title="Arraste para mover"
			                aria-label="Mover"
		              >
		                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden>
		                  <path d="M9 6h.01M15 6h.01M9 12h.01M15 12h.01M9 18h.01M15 18h.01" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
		                </svg>
                      </button>
                      <CardTitle className="text-white text-lg">Movimentações</CardTitle>
                      <div className="hidden sm:flex items-center gap-2 text-xs text-blue-200/70">
                        <span className="font-mono text-blue-50">
                          {showOverviewLoadingProgress ? (
                            <span className="inline-flex items-center gap-2">
                              <span className="inline-flex h-3 w-3 rounded-full border border-blue-200/70 border-t-transparent animate-spin" />
                              {loadingPercent}%
                            </span>
                          ) : (
                            <>
                              +{overviewMovResumo?.entradaQtd ?? '-'} • -{overviewMovResumo?.saidaQtd ?? '-'}
                            </>
                          )}
                        </span>
                      </div>
                    </div>
                    <div className="flex flex-1 flex-wrap items-center gap-2 min-w-0">
                      <Select value={movTipo} onValueChange={(v) => setMovTipo(v as any)}>
                        <SelectTrigger className="h-8 w-28">
                          <SelectValue placeholder="Tipo" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="TODOS">Todos</SelectItem>
                          <SelectItem value="ENTRADA">Entrada</SelectItem>
                          <SelectItem value="SAÍDA">Saída</SelectItem>
                          <SelectItem value="AJUSTE">Ajuste</SelectItem>
                        </SelectContent>
                      </Select>
                      <Input
                        value={movSearch}
                        onChange={(e) => setMovSearch(e.target.value)}
                        placeholder="Buscar"
                        className="h-8 min-w-[140px] flex-1 max-w-[320px]"
                      />
                    </div>
                  </div>
                  <div className="absolute top-2 right-2 flex items-center gap-1">
		                <Button
		                  size="icon"
		                  variant="ghost"
		                  className="h-9 w-9 bg-transparent text-white hover:bg-white/[0.10]"
		                  onClick={() => openInsumosListModal()}
                  title="Abrir lista de insumos"
                  aria-label="Abrir lista de insumos"
                >
                  <img src="/icons/insumos-icon-192.svg" alt="" aria-hidden className="h-6 w-6" />
                </Button>
                <Button
                  size="icon"
                  variant="ghost"
                  className="h-9 w-9 bg-transparent text-white hover:bg-white/[0.10]"
                  onClick={() => {
                    const deIso = dateInputToIso(movDe)
                    const ateIso = dateInputToIso(movAte)
                    const params = new URLSearchParams({
                      unidade,
                      ...(selectedCodigoBarras.trim() ? { codigoBarras: selectedCodigoBarras.trim() } : {}),
                      ...(movTipo !== 'TODOS' ? { tipo: movTipo } : {}),
                      ...(deIso ? { de: deIso } : {}),
                      ...(ateIso ? { ate: ateIso } : {})
                    })
                    window.open(`/api/insumos/export/movimentacoes.csv?${params.toString()}`, '_blank', 'noopener,noreferrer')
                  }}
                  disabled={!isAuthed}
                  title="Exportar CSV"
                  aria-label="Exportar CSV"
                >
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden>
                    <path
                      d="M12 16V4m0 12-4-4m4 4 4-4M4 20h16"
                      stroke="currentColor"
                      strokeWidth="2.2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                </Button>
                <Button
                  size="icon"
                  variant="ghost"
                  className="h-9 w-9 bg-transparent text-white hover:bg-white/[0.10]"
                  onClick={() => setDetailsKeyOpen(MAIN_PANEL_OPEN_KEYS.mov, !movPanelOpen)}
                title={movPanelOpen ? 'Contrair' : 'Expandir'}
                aria-label={movPanelOpen ? 'Contrair' : 'Expandir'}
              >
                {movPanelOpen ? (
                  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden>
                    <path d="M6 15l6-6 6 6" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                ) : (
                  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden>
                    <path d="M6 9l6 6 6-6" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
		                )}
		              </Button>
		            </div>
		          </CardHeader>
          {movPanelOpen ? (
            <CardContent className="space-y-3">

        {(selectedCodigoBarras.trim() || movFilterProduto.trim() || movFilterCategoria.trim() || movFilterMarca.trim() || movSearch.trim()) ? (
          <div className="rounded-xl border border-white/10 bg-black/20 px-3 py-2 text-sm text-blue-100/80 flex flex-wrap items-center justify-between gap-2">
            <div className="min-w-0">
              <span className="text-blue-200/70">Filtrando por:</span>{' '}
              {selectedCodigoBarras.trim() ? (
                <>
                  {selectedInsumo?.produto ? <span className="text-blue-50 font-semibold">{selectedInsumo.produto}</span> : <span className="text-blue-50 font-semibold">Insumo</span>}{' '}
                  • <span className="font-mono">{selectedCodigoBarras.trim()}</span>
                </>
              ) : movFilterProduto.trim() ? (
                <>
                  <span className="text-blue-50 font-semibold">{movFilterProduto.trim()}</span>
                </>
              ) : null}
              {movFilterCategoria.trim() ? (
                <>
                  {(selectedCodigoBarras.trim() || movFilterProduto.trim()) ? <span className="text-blue-200/60"> • </span> : null}
                  <span className="text-blue-50 font-semibold">{movFilterCategoria.trim()}</span>
                </>
              ) : null}
              {movFilterMarca.trim() ? (
                <>
                  {(selectedCodigoBarras.trim() || movFilterProduto.trim() || movFilterCategoria.trim()) ? <span className="text-blue-200/60"> • </span> : null}
                  <span className="text-blue-50 font-semibold">{movFilterMarca.trim()}</span>
                </>
              ) : null}
              {movSearch.trim() ? (
                <>
                  {(selectedCodigoBarras.trim() || movFilterProduto.trim() || movFilterCategoria.trim() || movFilterMarca.trim()) ? <span className="text-blue-200/60"> • </span> : null}
                  <span className="text-blue-50 font-semibold">{movSearch.trim()}</span>
                </>
              ) : null}
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                setSelectedCodigoBarras('')
                setMovFilterProduto('')
                setMovFilterCategoria('')
                setMovFilterMarca('')
                setMovSearch('')
              }}
            >
              Limpar
            </Button>
          </div>
        ) : null}

          <div className="flex items-center justify-end" />

          <div className="flex flex-wrap items-center justify-between gap-2 text-sm text-blue-100/70">
          <div>
            <span className="font-mono">{movimentacoesView.length}</span>
            {movTotal != null ? (
              <>
                {' '}
                de <span className="font-mono">{movTotal}</span>
              </>
            ) : null}
          </div>
          <div className="flex items-center gap-2">
            {movHasMore ? <div className="text-xs text-blue-200/60">Role até o fim para carregar mais…</div> : null}
          </div>
        </div>

        <div ref={movListContainerRef} onScroll={onMovScroll} className="overflow-auto max-h-[60vh] rounded-xl border border-white/10">
          <table className="w-full table-fixed text-sm">
            <thead className="bg-black/30 text-blue-100/80">
              <tr>
                  {(
                    [
                      { key: 'dataHora', label: 'Data', compact: true, className: '', widthClass: 'w-[8%]' },
                      { key: 'produto', label: 'Produto', widthClass: 'w-[22%]' },
                      { key: 'categoria', label: 'Categoria', compact: true, className: 'hidden md:table-cell', widthClass: 'w-[12%]' },
                      { key: 'marca', label: 'Marca', compact: true, className: 'hidden lg:table-cell', widthClass: 'w-[10%]' },
                      { key: 'estoque', label: 'Estoque', compact: true, widthClass: 'w-[10%]' },
                      { key: 'valor', label: 'Valor', compact: true, widthClass: 'w-[10%]' },
                      { key: 'usuario', label: 'Usuário', compact: true, className: 'hidden xl:table-cell', widthClass: 'w-[10%]' },
                      { key: 'observacao', label: 'Observação', className: 'hidden md:table-cell', widthClass: 'w-[16%]' },
                      { key: null, label: 'Ações', compact: true, widthClass: 'w-[6%]' }
                    ] as Array<{ key: null | 'dataHora' | 'produto' | 'categoria' | 'marca' | 'estoque' | 'valor' | 'usuario' | 'observacao'; label: string; compact?: boolean; className?: string; widthClass?: string }>
                  ).map((col) => {
                    const isActive = !!col.key && movSortKey === col.key
                    return (
                      <th
                        key={col.label}
                        className={`p-3 text-center align-middle ${col.compact ? 'whitespace-nowrap' : ''} ${col.widthClass || ''} ${col.className || ''} sticky top-0 z-10 bg-black/40 backdrop-blur`}
                      >
	                        <div className="flex items-center justify-center gap-2">
                            {col.key ? (
                              <button
                                type="button"
                                className={`cursor-pointer select-none ${isActive ? 'text-white' : 'text-blue-100/80'} hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-300/40 rounded-sm px-0.5`}
                                onClick={() => {
                                  if (movSortKey === col.key) {
                                    setMovSortDir((d) => (d === 'asc' ? 'desc' : 'asc'))
                                    return
                                  }
                                  setMovSortKey(col.key!)
                                  setMovSortDir(col.key === 'dataHora' ? 'desc' : 'asc')
                                }}
                                aria-label={`Ordenar ${col.label}`}
                                title={`Ordenar ${col.label}`}
                              >
                                {col.label}
                              </button>
                            ) : (
                              <span>{col.label}</span>
                            )}
                            {col.key ? (
                              <span className={`inline-flex items-center justify-center ${isActive ? 'text-white' : 'text-blue-100/30'}`} aria-hidden>
                                {isActive && movSortDir === 'asc' ? (
                                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden>
                                    <path d="M6 15l6-6 6 6" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
                                  </svg>
                                ) : (
                                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden>
                                    <path d="M6 9l6 6 6-6" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
                                  </svg>
                                )}
                              </span>
                            ) : null}
	                        </div>
	                      </th>
                    )
                  })}
	              </tr>
	            </thead>
	            <tbody className="divide-y divide-white/5">
	              {movimentacoesView.map((m, idx) => {
	                const codigoBarras = String(m.codigoBarras || '').trim()
                  const insumo = pickInsumoForMov(m)
                  const ctxUnit = String(m.unidade || unidade || '').trim()
                  const estoqueAtual = insumo
                    ? (ctxUnit && insumo?.estoques ? Number(insumo.estoques?.[ctxUnit] ?? 0) : Number(insumo.estoqueAtual ?? 0))
                    : null
                  const tipoNorm = String(m.tipo || '').toUpperCase().replace('Í', 'I')
                  const isEntrada = tipoNorm.includes('ENTRADA')
                  const isSaida = tipoNorm.includes('SAIDA')
                  const preco = Number(m.preco) || Number(insumo?.precoCusto) || 0
                  const qtd = Number(m.quantidade) || 0
                  const valorMov = preco * qtd
                  const estoqueDepois = Number.isFinite(Number(m.estoqueNovo)) ? Number(m.estoqueNovo) : (estoqueAtual != null ? estoqueAtual : null)
                  const estoqueAntes = Number.isFinite(Number(m.estoqueAnterior))
                    ? Number(m.estoqueAnterior)
                    : (Number.isFinite(Number(estoqueDepois)) && Number.isFinite(qtd) && (isEntrada || isSaida)
                      ? (isEntrada ? Number(estoqueDepois) - qtd : Number(estoqueDepois) + qtd)
                      : null)
                  const valorEstoqueTotal = preco && estoqueDepois != null && Number.isFinite(Number(estoqueDepois)) ? preco * Number(estoqueDepois) : null
                  const produtoNome = String(insumo?.produto || m.produto || '').trim() || '-'
                  const categoriaNome = String(insumo?.categoria || '').trim() || '-'
                  const marcaNome = String(insumo?.marca || m.marca || '').trim() || '-'
		                const isSelected = !!codigoBarras && selectedCodigoBarras.trim() === codigoBarras

                  const rowTone = isEntrada
                    ? 'bg-emerald-400/10 hover:bg-emerald-400/15'
                    : isSaida
                      ? 'bg-rose-400/10 hover:bg-rose-400/15'
                      : 'hover:bg-white/5'
                  const rowClass = `${rowTone} ${isSelected ? 'ring-1 ring-white/10' : ''}`

		                return (
		                  <tr key={`${m.dataHora || ''}-${idx}`} className={rowClass}>
                    <td className="p-3 text-center align-top text-blue-100/70 whitespace-nowrap">
                          <div className="text-blue-50">{fmtMovDateShort(m.dataHora) || '-'}</div>
                          <div className="text-xs text-blue-200/60">{fmtMovTimeShort(m.dataHora) || ''}</div>
                        </td>
                    <td className="p-3 text-center align-top">
                      <button
                        type="button"
                        className="w-full text-center text-blue-50 hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-300/40 rounded-sm cursor-pointer break-words"
                        onClick={() => {
                          const p = String(produtoNome || '').trim()
                          if (!p || p === '-') return
                          setSelectedCodigoBarras('')
                          setMovFilterCategoria('')
                          setMovFilterMarca('')
                          setMovFilterProduto((prev) => (normalizeText(prev) === normalizeText(p) ? '' : p))
                        }}
                        title="Filtrar por produto"
                        aria-pressed={normalizeText(movFilterProduto) === normalizeText(produtoNome)}
                      >
                        <span className="line-clamp-2">{produtoNome}</span>
                      </button>
                      {marcaNome && marcaNome !== '-' ? (
                        <div className="mt-1 flex flex-wrap justify-center gap-1 lg:hidden">
                          <Badge style={buildTagStyle(getMarcaBgColor(marcaNome))} className="border">
                            {marcaNome}
                          </Badge>
                        </div>
                      ) : null}
                    </td>
                      <td className="p-3 text-center align-top whitespace-nowrap hidden md:table-cell">
                        {categoriaNome && categoriaNome !== '-' ? (
                          <button
                            type="button"
                            className="inline-flex w-full items-center justify-center rounded-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-300/40"
                            onClick={() => {
                              const c = String(categoriaNome || '').trim()
                              if (!c || c === '-') return
                              setSelectedCodigoBarras('')
                              setMovFilterProduto('')
                              setMovFilterCategoria((prev) => (normalizeText(prev) === normalizeText(c) ? '' : c))
                            }}
                            title="Filtrar por categoria"
                            aria-pressed={normalizeText(movFilterCategoria) === normalizeText(categoriaNome)}
                          >
                            <Badge style={buildTagStyle(getCategoriaBgColor(categoriaNome))} className="border">
                              {categoriaNome}
                            </Badge>
                          </button>
                        ) : (
                          <span className="text-blue-100/70">-</span>
                        )}
                      </td>
                      <td className="p-3 text-center align-top whitespace-nowrap hidden lg:table-cell">
                        {marcaNome && marcaNome !== '-' ? (
                          <button
                            type="button"
                            className="inline-flex w-full items-center justify-center rounded-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-300/40"
                            onClick={() => {
                              const b = String(marcaNome || '').trim()
                              if (!b || b === '-') return
                              setSelectedCodigoBarras('')
                              setMovFilterProduto('')
                              setMovFilterMarca((prev) => (normalizeText(prev) === normalizeText(b) ? '' : b))
                            }}
                            title="Filtrar por marca"
                            aria-pressed={normalizeText(movFilterMarca) === normalizeText(marcaNome)}
                          >
                            <Badge style={buildTagStyle(getMarcaBgColor(marcaNome))} className="border">
                              {marcaNome}
                            </Badge>
                          </button>
                        ) : (
                          <span className="text-blue-100/70">-</span>
                        )}
                      </td>
                      <td className="p-3 text-center align-top whitespace-nowrap">
                        {estoqueAntes != null && estoqueDepois != null && Number.isFinite(estoqueAntes) && Number.isFinite(estoqueDepois) ? (
                          <span className="font-mono text-blue-50">{estoqueAntes} → {estoqueDepois}</span>
                        ) : (
                          <span className="font-mono text-blue-100/70">-</span>
                        )}
                      </td>
                      <td className="p-3 text-center align-top whitespace-nowrap w-[1%]">
                        <div className="text-blue-50">{preco ? fmtMoneyBRL(valorMov) : '-'}</div>
                        <div className="text-xs text-blue-200/60">
                          {valorEstoqueTotal != null ? fmtMoneyBRL0(valorEstoqueTotal) : ''}
                        </div>
                      </td>
                    <td className="p-3 text-center align-top text-blue-100/70 whitespace-nowrap hidden xl:table-cell">{m.usuario || '-'}</td>
                    <td className="p-3 text-left align-top text-blue-100/60 hidden md:table-cell">
                      <div className="space-y-1 break-words">
                        {m.transferId ? (
                          <div>
                            <div>
                              Transferência {m.unidadeOrigem ? unidadeLabel(m.unidadeOrigem) : '-'} →{' '}
                              {m.unidadeDestino ? unidadeLabel(m.unidadeDestino) : '-'}
                            </div>
                            <div className="font-mono text-xs">{m.transferId}</div>
                          </div>
                        ) : m.motivo ? (
                          <span>Motivo: {m.motivo}</span>
                        ) : (
                          <span>{m.observacoes || '-'}</span>
                        )}
                          {m.registroInsumo || m.lote || m.dataValidade ? (
                            <div className="text-xs text-blue-200/60">
                              {m.registroInsumo ? <span className="font-mono">Reg {m.registroInsumo}</span> : null}
                              {m.lote ? <span>{m.registroInsumo ? ' • ' : ''}Lote {m.lote}</span> : null}
                              {m.dataValidade ? <span>{(m.registroInsumo || m.lote) ? ' • ' : ''}Val {fmtDateOnlyBR(m.dataValidade)}</span> : null}
                            </div>
                          ) : null}
                        </div>
                      </td>
                      <td className="p-3 text-center align-top whitespace-nowrap">
                        <div className="flex justify-center gap-2">
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => {
                              if (insumo) openEditDialog(insumo)
                              else if (codigoBarras) openInsumosListModal({ codigoBarras })
                            }}
                            disabled={!isAuthed || !codigoBarras}
                          >
                            Editar
                          </Button>
                        </div>
                      </td>
		                  </tr>
		                )
	              })}
	              {!movimentacoesView.length ? (
	                <tr>
	                  <td className="p-3 text-blue-100/70 text-center" colSpan={9}>
	                    {movLoadError && !movLoading && isAuthed ? (
                        <span className="text-red-200">
                          Erro ao carregar movimentações ({movLoadError.status || 'erro'}
                          {movLoadError.code ? `/${movLoadError.code}` : ''}): {movLoadError.message}
                        </span>
                      ) : (
                        renderListPlaceholder(movLoading, 'Sem movimentações.')
                      )}
	                  </td>
	                </tr>
	              ) : null}
            </tbody>
          </table>
        </div>
            </CardContent>
          ) : null}
	        </Card>
	      </div>
	    )}
	  </Draggable>
	              {dropProvided.placeholder}
	            </div>
	          )}
	        </Droppable>
      </DragDropContext>
	    </div>
  )
}
