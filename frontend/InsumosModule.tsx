import React from 'react'
import { toast } from 'sonner'
import { Badge } from '@/badge'
import { Button } from '@/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/card'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/dialog'
import { Input } from '@/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/select'
import { Bar, BarChart, CartesianGrid, Cell, Legend, Line, LineChart, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'

type InsumosHealth = {
  ok?: boolean
  service?: string
  runtime?: string
  dbConfigured?: boolean
  sheetsConfigured?: boolean
  unidades?: string[]
  sheets?: {
    spreadsheetIdPresent?: boolean
    serviceAccountEmailPresent?: boolean
    privateKeyPresent?: boolean
    missing?: string[]
    hint?: string
  }
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
  categoria?: string
  marca?: string
  produto?: string
  especificacao?: string
  concentracao?: string
  volume?: string
  tipoUnidade?: string
  fonte?: string
  calibre?: string
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

type ApiError = {
  error?: string
  message?: string
  success?: boolean
  code?: string
  registros?: string[]
}

type OfflineQueueItem = {
  id: string
  ts: number
  path: string
  method: string
  body?: unknown
}

function fmtMoneyBRL(value: number) {
  try {
    return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(value)
  } catch {
    return `R$ ${value.toFixed(2)}`
  }
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

function getCategoriaBgColor(categoria?: string | null) {
  const key = String(categoria || '').trim().toLowerCase()
  return CATEGORIA_CORES[key] || '#0ea5e9'
}

type EstoqueStatus = 'OK' | 'ATENCAO' | 'URGENTE'

function calcularStatusEstoque(estoqueAtual?: number, estoqueMinimo?: number): EstoqueStatus {
  const atual = Number(estoqueAtual) || 0
  const minimo = Number(estoqueMinimo) || 0
  if (atual === 0 || atual <= 0.5 * minimo) return 'URGENTE'
  if (atual <= minimo) return 'ATENCAO'
  return 'OK'
}

function estoqueStatusLabel(status: EstoqueStatus) {
  if (status === 'URGENTE') return 'Críticos'
  if (status === 'ATENCAO') return 'Estoque baixo'
  return 'Ok'
}

function estoqueStatusBadgeVariant(status: EstoqueStatus): 'default' | 'secondary' | 'destructive' {
  if (status === 'URGENTE') return 'destructive'
  if (status === 'ATENCAO') return 'secondary'
  return 'default'
}

function fmtDate(value?: string | null) {
  if (!value) return ''
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return String(value)
  return d.toLocaleString('pt-BR')
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

  const m = v.match(/^(\d{2})\/(\d{2})\/(\d{4})$/)
  if (!m) return ''
  const day = parseInt(m[1], 10)
  const month = parseInt(m[2], 10)
  const year = parseInt(m[3], 10)
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
  const [error, setError] = React.useState<string | null>(null)
  const [supported, setSupported] = React.useState(true)

  React.useEffect(() => {
    const Detector = (globalThis as any).BarcodeDetector
    if (!Detector) {
      setSupported(false)
      return
    }

    let cancelled = false
    const detector = new Detector({
      formats: ['ean_13', 'ean_8', 'code_128', 'code_39', 'qr_code', 'upc_a', 'upc_e']
    })

    const stop = () => {
      if (rafRef.current != null) cancelAnimationFrame(rafRef.current)
      rafRef.current = null
      if (streamRef.current) {
        for (const t of streamRef.current.getTracks()) t.stop()
      }
      streamRef.current = null
    }

    const tick = async () => {
      if (cancelled) return
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
      rafRef.current = requestAnimationFrame(() => { void tick() })
    }

    ;(async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: 'environment' } as any },
          audio: false
        })
        if (cancelled) {
          for (const t of stream.getTracks()) t.stop()
          return
        }
        streamRef.current = stream
        const video = videoRef.current
        if (video) {
          video.srcObject = stream
          await video.play()
          rafRef.current = requestAnimationFrame(() => { void tick() })
        }
      } catch (e: any) {
        setError(e?.message || 'Não foi possível acessar a câmera.')
      }
    })()

    return () => {
      cancelled = true
      stop()
    }
  }, [onDetected])

  if (!supported) {
    return (
      <div className="rounded-xl border border-white/10 bg-black/20 p-3">
        <div className="text-sm text-blue-100/70">Scanner não suportado neste navegador (BarcodeDetector indisponível).</div>
      </div>
    )
  }

  return (
    <div className="rounded-xl border border-white/10 bg-black/20 p-3 space-y-2">
      <div className="flex items-center justify-between gap-2">
        <div className="text-sm text-blue-100/80">Aponte a câmera para o código de barras</div>
        <Button variant="secondary" onClick={onClose}>Fechar</Button>
      </div>
      {error ? <div className="text-sm text-red-200">{error}</div> : null}
      <video ref={videoRef} className="w-full max-w-xl rounded-lg border border-white/10 bg-black" playsInline muted />
      <div className="text-xs text-blue-200/60">
        Dica: se não detectar, aumente a luz e aproxime o código.
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
  const method = opts.method || 'GET'
  const headers: Record<string, string> = { Accept: 'application/json' }
  if (opts.body !== undefined) headers['content-type'] = 'application/json'
  if (opts.csrfToken) headers['x-csrf-token'] = opts.csrfToken
  if (opts.idempotencyKey) headers['idempotency-key'] = opts.idempotencyKey

  const url = path.startsWith('/api/insumos') ? path : `/api/insumos${path.startsWith('/') ? '' : '/'}${path}`
  const res = await fetch(url, {
    method,
    headers,
    credentials: 'include',
    body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
    signal: opts.signal
  })

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

  const ex = new Error(message) as any
  ex.status = res.status
  ex.code = err.code
  ex.registros = Array.isArray(err.registros) ? err.registros : []
  throw ex
}

export function InsumosModule() {
  const [health, setHealth] = React.useState<InsumosHealth | null>(null)
  const [error, setError] = React.useState<string | null>(null)
  const [healthLoading, setHealthLoading] = React.useState(true)

  const INSUMOS_UNIT_KEY = 'skincos.insumos.unidade.v1'
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

  const [quickOp, setQuickOp] = React.useState<'ENTRADA' | 'BAIXA' | 'TRANSFERENCIA' | null>(null)
  const [quickCodigo, setQuickCodigo] = React.useState('')
  const [quickRegistro, setQuickRegistro] = React.useState('')
  const [quickRegistros, setQuickRegistros] = React.useState<string[]>([])
  const [quickAutoFefo, setQuickAutoFefo] = React.useState(true)
  const [quickScanOpen, setQuickScanOpen] = React.useState(false)
  const [quickQuantidade, setQuickQuantidade] = React.useState('1')
  const [quickNovoEstoque, setQuickNovoEstoque] = React.useState('')
  const [quickObs, setQuickObs] = React.useState('')
  const [quickMotivo, setQuickMotivo] = React.useState('Ajuste manual')
  const [quickActionLoading, setQuickActionLoading] = React.useState(false)
  const overviewSectionRef = React.useRef<HTMLDivElement | null>(null)
  const insumosSectionRef = React.useRef<HTMLDivElement | null>(null)
  const movSectionRef = React.useRef<HTMLDivElement | null>(null)
  const skipInsumosQueryEffectRef = React.useRef(true)
  const [sharePayload, setSharePayload] = React.useState<SharePayload | null>(null)
  const [shareHidden, setShareHidden] = React.useState(false)
  const [shareSourceId, setShareSourceId] = React.useState<string | null>(null)
  const [shareHistory, setShareHistory] = React.useState<ShareHistoryItem[]>([])
  const [shareLoading, setShareLoading] = React.useState(false)
  const [shareHistoryLoading, setShareHistoryLoading] = React.useState(false)
  const shareLoggedRef = React.useRef<string>('')
  const shareSyncedRef = React.useRef<Set<string>>(new Set())

  const [insumos, setInsumos] = React.useState<Insumo[]>([])
  const [insumosFull, setInsumosFull] = React.useState<Insumo[]>([])
  const [insumosLoading, setInsumosLoading] = React.useState(false)
  const [insumosQuery, setInsumosQuery] = React.useState('')
  const [insumosMode, setInsumosMode] = React.useState<'full' | 'paged'>('full')
  const [insumosPagina, setInsumosPagina] = React.useState(1)
  const [insumosLimite, setInsumosLimite] = React.useState(200)
  const [insumosTotal, setInsumosTotal] = React.useState<number | null>(null)
  const [createOpen, setCreateOpen] = React.useState(false)
  const [createScanOpen, setCreateScanOpen] = React.useState(false)
  const [createCodigo, setCreateCodigo] = React.useState('')
  const [createProduto, setCreateProduto] = React.useState('')
  const [createCategoria, setCreateCategoria] = React.useState('')
  const [createMarca, setCreateMarca] = React.useState('')
  const [createTipoUnidade, setCreateTipoUnidade] = React.useState('')
  const [createEspecificacao, setCreateEspecificacao] = React.useState('')
  const [createConcentracao, setCreateConcentracao] = React.useState('')
  const [createVolume, setCreateVolume] = React.useState('')
  const [createFonte, setCreateFonte] = React.useState('')
  const [createCalibre, setCreateCalibre] = React.useState('')
  const [createPrecoCusto, setCreatePrecoCusto] = React.useState('')
  const [createEstoqueInicial, setCreateEstoqueInicial] = React.useState('0')
  const [createEstoqueMinimo, setCreateEstoqueMinimo] = React.useState('5')
  const [createLote, setCreateLote] = React.useState('')
  const [createDataValidade, setCreateDataValidade] = React.useState('')
  const [createNovoLote, setCreateNovoLote] = React.useState(false)
  const [createLoading, setCreateLoading] = React.useState(false)

  const [editOpen, setEditOpen] = React.useState(false)
  const [editTarget, setEditTarget] = React.useState<Insumo | null>(null)
  const [editCodigo, setEditCodigo] = React.useState('')
  const [editProduto, setEditProduto] = React.useState('')
  const [editCategoria, setEditCategoria] = React.useState('')
  const [editMarca, setEditMarca] = React.useState('')
  const [editTipoUnidade, setEditTipoUnidade] = React.useState('')
  const [editEspecificacao, setEditEspecificacao] = React.useState('')
  const [editConcentracao, setEditConcentracao] = React.useState('')
  const [editVolume, setEditVolume] = React.useState('')
  const [editFonte, setEditFonte] = React.useState('')
  const [editCalibre, setEditCalibre] = React.useState('')
  const [editPrecoCusto, setEditPrecoCusto] = React.useState('')
  const [editEstoqueMinimo, setEditEstoqueMinimo] = React.useState('')
  const [editLote, setEditLote] = React.useState('')
  const [editDataValidade, setEditDataValidade] = React.useState('')
  const [editSaving, setEditSaving] = React.useState(false)

  const [lotDialogOpen, setLotDialogOpen] = React.useState(false)
  const [lotSelecionado, setLotSelecionado] = React.useState<Insumo | null>(null)
  const [lotEditLote, setLotEditLote] = React.useState('')
  const [lotEditValidade, setLotEditValidade] = React.useState('')
  const [lotSaving, setLotSaving] = React.useState(false)

  const [movimentacoes, setMovimentacoes] = React.useState<Movimentacao[]>([])
  const [movLoading, setMovLoading] = React.useState(false)
  const [movTipo, setMovTipo] = React.useState<'TODOS' | 'ENTRADA' | 'SAÍDA' | 'AJUSTE'>('TODOS')
  const [movGroupTransfers, setMovGroupTransfers] = React.useState(true)
  const [movDe, setMovDe] = React.useState('')
  const [movAte, setMovAte] = React.useState('')
  const [movPagina, setMovPagina] = React.useState(1)
  const [movLimite, setMovLimite] = React.useState(50)
  const [movTotal, setMovTotal] = React.useState<number | null>(null)

  // Backups/auditoria foram movidos para o módulo Status do sistema.

  const [overviewLoading, setOverviewLoading] = React.useState(false)
  const [overviewResumo, setOverviewResumo] = React.useState<EstoqueResumo | null>(null)
  const [overviewNotifications, setOverviewNotifications] = React.useState<NotificationsSummary | null>(null)
  const [overviewActionables, setOverviewActionables] = React.useState<Actionables | null>(null)
  const [overviewPeriod, setOverviewPeriod] = React.useState<'7d' | '30d' | '90d' | '1y'>('30d')
  const [overviewRoi, setOverviewRoi] = React.useState<RoiInsights | null>(null)
  const [overviewQuality, setOverviewQuality] = React.useState<QualityReport | null>(null)
  const [overviewMovResumo, setOverviewMovResumo] = React.useState<{ entradaQtd: number; saidaQtd: number; entradaValor: number; saidaValor: number; saldoLiquido: number } | null>(null)
  const [overviewMovSeries, setOverviewMovSeries] = React.useState<
    Array<{ day: string; entrada: number; saida: number; entradaValor?: number; saidaValor?: number }>
  >([])

  const [insightsLoading, setInsightsLoading] = React.useState(false)
  const [insightsAlertas, setInsightsAlertas] = React.useState<EstoqueAlerta[]>([])
  const [insightsTrends, setInsightsTrends] = React.useState<any | null>(null)
  const [insightsTurnover, setInsightsTurnover] = React.useState<any | null>(null)
  const [alertasStatus, setAlertasStatus] = React.useState<'TODOS' | EstoqueStatus>('TODOS')
  const [alertasCategoria, setAlertasCategoria] = React.useState('')
  const [alertasBusca, setAlertasBusca] = React.useState('')
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

  const canUseApi = !!health?.ok
  const isAuthed = !!user?.username
  const allowedUnits = Array.isArray(user?.allowedUnits) ? user!.allowedUnits!.filter(Boolean) : []

  const allUnidades = React.useMemo(() => {
    const fromHealth = Array.isArray(health?.unidades) ? health!.unidades!.filter(Boolean) : []
    return fromHealth.length ? fromHealth : ['novo-hamburgo', 'barra-shopping-sul']
  }, [Array.isArray(health?.unidades) ? health!.unidades!.join('|') : ''])

  const quickLotes = React.useMemo(() => {
    const codigo = quickCodigo.trim()
    if (!codigo) return []
    const ctxUnidade = quickOp === 'TRANSFERENCIA' ? transferFrom : unidade
    const items = (insumos || [])
      .filter((i) => String(i.codigoBarras || '').trim() === codigo && String(i.registro || '').trim())
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
  }, [insumos, quickCodigo, quickOp, transferFrom, unidade])

  const quickLoteNeedsPick = (quickRegistros.length > 1) || (quickLotes.length > 1)
  const quickLotesForPicker = React.useMemo(() => {
    if (quickRegistros.length) {
      const set = new Set(quickRegistros)
      const filtered = quickLotes.filter((l) => set.has(l.registro))
      if (filtered.length) return filtered
      return quickRegistros.map((registro) => ({ registro, lote: '', dataValidade: null as any, estoque: 0 }))
    }
    return quickLotes
  }, [quickLotes, quickRegistros.join('|')])

  React.useEffect(() => {
    if (!quickOp) return
    setQuickRegistros([])
    setQuickRegistro('')
  }, [quickOp])

  React.useEffect(() => {
    if (!quickOp) return
    setQuickRegistros([])
    setQuickRegistro('')
  }, [quickCodigo])

  React.useEffect(() => {
    if (!quickOp) return
    if (!(quickOp === 'BAIXA' || quickOp === 'TRANSFERENCIA')) return
    if (!quickAutoFefo) return
    if (!quickLotes.length) return
    const suggested = quickLotes[0]?.registro
    if (!suggested) return
    setQuickRegistro((cur) => (cur ? cur : suggested))
  }, [quickAutoFefo, quickLotes.map((l) => l.registro).join('|'), quickOp])

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
	          else if (requestedTab === 'insumos') insumosSectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
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
	        setTimeout(() => insumosSectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 250)
	      }

      if (wantsScanner) {
        setQuickScanOpen(true)
      }

      if (wantsQuickAction) {
        if (actionLabel === 'Entrada') setQuickOp('ENTRADA')
        else if (actionLabel === 'Saída') setQuickOp('BAIXA')
        else if (actionLabel === 'Transferência') setQuickOp('TRANSFERENCIA')
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
	        setTimeout(() => insumosSectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 250)
	        if (payload.title) setCreateProduto((prev) => (prev ? prev : payload.title || ''))
	        if (payload.text) setCreateEspecificacao((prev) => (prev ? prev : payload.text || ''))
	        if (payload.url) setCreateFonte((prev) => (prev ? prev : payload.url || ''))
        if (payload.files && payload.files.length) {
          const filesSummary = `Arquivos: ${payload.files.map((f) => f.name).join(', ')}`
          setCreateFonte((prev) => (prev ? prev : filesSummary))
        }
      }

      if (shareId) {
        setShareLoading(true)
        void (async () => {
          try {
            const res = await fetch(`/share/${encodeURIComponent(shareId)}`, { cache: 'no-store' })
            if (!res.ok) throw new Error('share fetch failed')
            const data = (await res.json()) as SharePayload
            const files = (data.files || []).map((f) => ({
              ...f,
              url: f.name ? `/share/${encodeURIComponent(shareId)}?file=${encodeURIComponent(f.name)}` : undefined
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
	    setTimeout(() => insumosSectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 250)
	    if (payload.title) setCreateProduto(payload.title)
	    if (payload.text) setCreateEspecificacao(payload.text)
	    if (payload.url) setCreateFonte(payload.url)
	    if (payload.files && payload.files.length) {
      const filesSummary = `Arquivos: ${payload.files.map((f) => f.name).join(', ')}`
      setCreateFonte((prev) => (prev ? prev : filesSummary))
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

  const removeShareHistory = React.useCallback(
    (id: string) => {
      const next = shareHistory.filter((item) => item.id !== id)
      persistShareHistory(next)
      if (canUseApi && isAuthed) {
        void mutateJson(`/share/history/${encodeURIComponent(id)}`, {
          method: 'DELETE',
          queueLabel: 'Share history delete'
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
          queueLabel: 'Share history delete'
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
      queueLabel: 'Share history',
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
      setAuthLoading(false)
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
    setEditCodigo(String(i.codigoBarras || ''))
    setEditProduto(String(i.produto || ''))
    setEditCategoria(String(i.categoria || ''))
    setEditMarca(String(i.marca || ''))
    setEditTipoUnidade(String(i.tipoUnidade || ''))
    setEditEspecificacao(String(i.especificacao || ''))
    setEditConcentracao(String(i.concentracao || ''))
    setEditVolume(String(i.volume || ''))
    setEditFonte(String(i.fonte || ''))
    setEditCalibre(String(i.calibre || ''))
    setEditPrecoCusto(i.precoCusto != null ? String(i.precoCusto) : '')
    setEditEstoqueMinimo(i.estoqueMinimo != null ? String(i.estoqueMinimo) : '')
    setEditLote(String(i.lote || ''))
    setEditDataValidade(i.dataValidade ? fmtDateOnlyBR(i.dataValidade) : '')
    setEditOpen(true)
  }, [])

  const loadInsumosFull = React.useCallback(async () => {
    if (!canUseApi || !isAuthed) return
    setInsumosLoading(true)
    try {
      const out = await apiJson<{ success?: boolean; data?: Insumo[] }>(`/insumos?unidade=${encodeURIComponent(unidade)}`)
      const items = Array.isArray(out?.data) ? out.data : []
      setInsumos(items)
      setInsumosFull(items)
      setInsumosTotal(items.length)
      setInsumosMode('full')
      setInsumosPagina(1)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e))
      setInsumos([])
      setInsumosFull([])
      setInsumosTotal(null)
    } finally {
      setInsumosLoading(false)
    }
  }, [canUseApi, isAuthed, unidade])

  const loadInsumosPaged = React.useCallback(
    async (opts?: { pagina?: number; limite?: number; q?: string }): Promise<number | null> => {
      if (!canUseApi || !isAuthed) return null
      const pagina = Math.max(1, opts?.pagina ?? insumosPagina)
      const limite = Math.max(1, Math.min(1000, opts?.limite ?? insumosLimite))
      const q = String(opts?.q ?? insumosQuery).trim()

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
        setInsumos(items)
        setInsumosTotal(totalOut)
        setInsumosMode('paged')
        setInsumosPagina(pagina)
        setInsumosLimite(limite)
        return totalOut
      } catch (e) {
        toast.error(e instanceof Error ? e.message : String(e))
        setInsumos([])
        setInsumosTotal(null)
        return null
      } finally {
        setInsumosLoading(false)
      }
    },
    [canUseApi, insumosLimite, insumosPagina, insumosQuery, isAuthed, unidade]
  )

  const refreshInsumos = React.useCallback(
    async (opts?: { pagina?: number }) => {
      if (!canUseApi || !isAuthed) return
      if (insumosMode === 'paged') {
        const pagina = Math.max(1, opts?.pagina ?? insumosPagina)
        const q = insumosQuery.trim()
        await loadInsumosPaged({ pagina, limite: insumosLimite, q })
        return
      }
      await loadInsumosFull()
    },
    [canUseApi, insumosLimite, insumosMode, insumosPagina, insumosQuery, isAuthed, loadInsumosFull, loadInsumosPaged]
  )

	  const loadMovimentacoes = React.useCallback(async (opts?: { pagina?: number; limite?: number }) => {
	    if (!canUseApi || !isAuthed) return
	    setMovLoading(true)
	    try {
      const pagina = Math.max(1, opts?.pagina ?? movPagina)
      const limite = Math.max(1, Math.min(200, opts?.limite ?? movLimite))
      const params = new URLSearchParams()
      params.set('unidade', unidade)
	      params.set('limite', String(limite))
	      params.set('pagina', String(pagina))
	      if (movTipo !== 'TODOS') params.set('tipo', movTipo)
	      const deIso = dateInputToIso(movDe)
	      const ateIso = dateInputToIso(movAte)
	      if (deIso) params.set('de', deIso)
	      if (ateIso) params.set('ate', ateIso)
	      const out = await apiJson<{ success?: boolean; data?: Movimentacao[]; movimentos?: Movimentacao[]; resumo?: any }>(
	        `/movimentacoes?${params.toString()}`
	      )
      const list = (out as any)?.movimentos ?? out?.data
      setMovimentacoes(Array.isArray(list) ? list : [])
      const total = Number((out as any)?.resumo?.totalMovimentacoes)
      setMovTotal(Number.isFinite(total) ? total : null)
      setMovPagina(pagina)
      setMovLimite(limite)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e))
      setMovimentacoes([])
      setMovTotal(null)
    } finally {
      setMovLoading(false)
    }
  }, [canUseApi, isAuthed, movAte, movDe, movLimite, movPagina, movTipo, unidade])

  React.useEffect(() => {
    setMovPagina(1)
  }, [unidade, movAte, movDe, movLimite, movTipo])

  const INSUMOS_PAGED_THRESHOLD = 800

  const loadOverview = React.useCallback(async () => {
    if (!canUseApi || !isAuthed) return
    setOverviewLoading(true)
    try {
      const now = new Date()
      const start = new Date(now)
      if (overviewPeriod === '7d') start.setDate(start.getDate() - 7)
      else if (overviewPeriod === '30d') start.setDate(start.getDate() - 30)
      else if (overviewPeriod === '90d') start.setDate(start.getDate() - 90)
      else start.setFullYear(start.getFullYear() - 1)
      const yyyyMmDd = (d: Date) => d.toISOString().slice(0, 10)
      const de = yyyyMmDd(start)
      const ate = yyyyMmDd(now)

      const params = `unidade=${encodeURIComponent(unidade)}`
      const [estoque, notif, act, roi, quality, movs] = await Promise.all([
        apiJson<{ success?: boolean; data?: { resumo?: EstoqueResumo } }>(`/relatorios/estoque?${params}`),
        apiJson<{ success?: boolean; data?: NotificationsSummary }>(`/notifications/summary?${params}`),
        apiJson<{ success?: boolean; data?: Actionables }>(`/analytics/actionables?${params}`),
        apiJson<{ success?: boolean; data?: RoiInsights }>(`/analytics/roi?${params}`),
        apiJson<{ success?: boolean; data?: QualityReport }>(`/quality/report?${new URLSearchParams({ unidade, limitIssues: '120' }).toString()}`),
        apiJson<{ success?: boolean; data?: Movimentacao[]; movimentos?: Movimentacao[] }>(
          `/movimentacoes?${new URLSearchParams({
            unidade,
            limite: '400',
            de,
            ate
          }).toString()}`
        )
      ])
      setOverviewResumo(estoque?.data?.resumo || null)
      setOverviewNotifications(notif?.data || null)
      setOverviewActionables(act?.data || null)

      setOverviewRoi(roi?.data || null)
      setOverviewQuality(quality?.data || null)

      const movList = (movs as any)?.movimentos ?? movs?.data
      const list: Movimentacao[] = Array.isArray(movList) ? movList : []
      const resumo = list.reduce(
        (acc, m) => {
          const t = String(m.tipo || '').toUpperCase().replace('Í', 'I')
          const qtd = Number(m.quantidade) || 0
          const preco = Number(m.preco) || 0
          const valor = preco * qtd
          if (t === 'ENTRADA') {
            acc.entradaQtd += qtd
            acc.entradaValor += valor
          } else if (t === 'SAIDA' || t === 'SAÍDA') {
            acc.saidaQtd += qtd
            acc.saidaValor += valor
          }
          return acc
        },
        { entradaQtd: 0, saidaQtd: 0, entradaValor: 0, saidaValor: 0 }
      )
      setOverviewMovResumo({ ...resumo, saldoLiquido: resumo.entradaValor - resumo.saidaValor })

      const byDay = new Map<string, { day: string; entrada: number; saida: number; entradaValor: number; saidaValor: number }>()
      for (const m of list) {
        const d = new Date(m.dataHora || '')
        if (Number.isNaN(d.getTime())) continue
        const day = d.toISOString().slice(0, 10)
        const cur = byDay.get(day) || { day, entrada: 0, saida: 0, entradaValor: 0, saidaValor: 0 }
        const t = String(m.tipo || '').toUpperCase().replace('Í', 'I')
        const qtd = Number(m.quantidade) || 0
        const preco = Number((m as any).preco) || 0
        const valor = preco * qtd
        if (t === 'ENTRADA') {
          cur.entrada += qtd
          cur.entradaValor += valor
        } else if (t === 'SAIDA' || t === 'SAÍDA') {
          cur.saida += qtd
          cur.saidaValor += valor
        }
        byDay.set(day, cur)
      }
      const limit = overviewPeriod === '7d' ? 7 : overviewPeriod === '30d' ? 30 : overviewPeriod === '90d' ? 90 : 365
      setOverviewMovSeries(Array.from(byDay.values()).sort((a, b) => a.day.localeCompare(b.day)).slice(-limit))
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e))
      setOverviewResumo(null)
      setOverviewNotifications(null)
      setOverviewActionables(null)
      setOverviewRoi(null)
      setOverviewQuality(null)
      setOverviewMovResumo(null)
      setOverviewMovSeries([])
    } finally {
      setOverviewLoading(false)
    }
  }, [canUseApi, isAuthed, unidade, overviewPeriod])

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
      await Promise.allSettled([refreshInsumos(), loadOverview()])
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e))
    } finally {
      setLotSaving(false)
    }
  }, [canUseApi, isAuthed, loadOverview, lotEditLote, lotEditValidade, lotSelecionado?.registro, mutateJson, refreshInsumos, unidade])

  const saveEdit = React.useCallback(async () => {
    const registro = String(editTarget?.registro || '').trim()
    if (!registro) {
      toast.error('Registro do insumo ausente.')
      return
    }
    if (!canUseApi || !isAuthed) return
    const codigoBarras = editCodigo.trim()
    const produto = editProduto.trim()
    if (!codigoBarras) return toast.error('Informe o código de barras')
    if (!produto) return toast.error('Informe o produto')

    setEditSaving(true)
    try {
      await mutateJson(`/insumos/${encodeURIComponent(registro)}?unidade=${encodeURIComponent(unidade)}`, {
        method: 'PUT',
        queueLabel: 'Edição de insumo',
        body: {
          codigoBarras,
          produto,
          categoria: editCategoria.trim(),
          marca: editMarca.trim(),
          tipoUnidade: editTipoUnidade.trim(),
          especificacao: editEspecificacao.trim(),
          concentracao: editConcentracao.trim(),
          volume: editVolume.trim(),
          fonte: editFonte.trim(),
          calibre: editCalibre.trim(),
          precoCusto: editPrecoCusto.trim(),
          estoqueMinimo: Number(editEstoqueMinimo) || 0,
          lote: editLote.trim(),
          dataValidade: dateInputToIso(editDataValidade)
        }
      })
      toast.success('Insumo atualizado')
      setEditOpen(false)
      await Promise.allSettled([refreshInsumos({ pagina: 1 }), loadOverview()])
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e))
    } finally {
      setEditSaving(false)
    }
  }, [
    canUseApi,
    editCalibre,
    editCategoria,
    editCodigo,
    editConcentracao,
    editDataValidade,
    editEspecificacao,
    editEstoqueMinimo,
    editFonte,
    editLote,
    editMarca,
    editPrecoCusto,
    editProduto,
    editTarget?.registro,
    editTipoUnidade,
    editVolume,
    isAuthed,
    loadOverview,
    mutateJson,
    refreshInsumos,
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
      await Promise.allSettled([refreshInsumos({ pagina: 1 }), loadOverview()])
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e))
    } finally {
      setEditSaving(false)
    }
  }, [canUseApi, editTarget?.registro, isAuthed, loadOverview, mutateJson, refreshInsumos, unidade])

	  const loadInsights = React.useCallback(async () => {
    if (!canUseApi || !isAuthed) return
    setInsightsLoading(true)
    try {
      const base = new URLSearchParams()
      base.set('unidade', unidade)

	      const trendsParams = new URLSearchParams(base.toString())
	      trendsParams.set('groupBy', 'day')
	      const days = overviewPeriod === '7d' ? 7 : overviewPeriod === '30d' ? 30 : overviewPeriod === '90d' ? 90 : 365
	      trendsParams.set('days', String(days))
	      const deIso = dateInputToIso(movDe)
	      const ateIso = dateInputToIso(movAte)
	      if (deIso) trendsParams.set('from', deIso)
	      if (ateIso) trendsParams.set('to', ateIso)

	      const turnoverParams = new URLSearchParams(base.toString())
	      turnoverParams.set('days', String(days))
	      turnoverParams.set('mode', 'saida')
	      if (deIso) turnoverParams.set('from', deIso)
	      if (ateIso) turnoverParams.set('to', ateIso)

      const [alertas, trends, turnover] = await Promise.all([
        apiJson<{ success?: boolean; data?: EstoqueAlerta[] }>(`/alertas/estoque?${base.toString()}`),
        apiJson<{ success?: boolean; data?: any }>(`/analytics/trends?${trendsParams.toString()}`),
        apiJson<{ success?: boolean; data?: any }>(`/analytics/category-turnover?${turnoverParams.toString()}`)
      ])

      setInsightsAlertas(Array.isArray(alertas?.data) ? alertas.data : [])
      setInsightsTrends(trends?.data || null)
      setInsightsTurnover(turnover?.data || null)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e))
      setInsightsAlertas([])
      setInsightsTrends(null)
      setInsightsTurnover(null)
    } finally {
      setInsightsLoading(false)
    }
	  }, [canUseApi, isAuthed, movAte, movDe, movTipo, overviewPeriod, unidade])

  const runQuickAction = React.useCallback(
    async (kind: 'ENTRADA' | 'BAIXA' | 'AJUSTE'): Promise<boolean> => {
      if (!canUseApi || !isAuthed) return
      const codigoBarras = quickCodigo.trim()
      if (!codigoBarras) return toast.error('Informe o código de barras')

      setQuickActionLoading(true)
      try {
        if (kind === 'AJUSTE') {
          const novoEstoque = Number.isFinite(Number(quickNovoEstoque)) ? Number(quickNovoEstoque) : null
          if (novoEstoque === null) return toast.error('Informe o novo estoque')
          const registro = quickRegistro.trim()
          await mutateJson(`/insumos/ajuste?unidade=${encodeURIComponent(unidade)}`, {
            method: 'POST',
            body: { codigoBarras, registro: registro || undefined, novoEstoque, motivo: quickMotivo, observacoes: quickObs },
            queueLabel: 'Ajuste'
          })
          toast.success('Ajuste registrado')
        } else {
          const quantidade = Math.max(1, parseInt(quickQuantidade, 10) || 0)
          const path = kind === 'ENTRADA' ? '/insumos/entrada' : '/insumos/baixa'
          const registro = quickRegistro.trim()
          if (quickLoteNeedsPick && !registro) {
            toast.error('Selecione o lote/registro')
            return false
          }
          await mutateJson(`${path}?unidade=${encodeURIComponent(unidade)}`, {
            method: 'POST',
            body: { codigoBarras, registro: registro || undefined, quantidade, observacoes: quickObs },
            queueLabel: kind === 'ENTRADA' ? 'Entrada' : 'Baixa'
          })
          toast.success(kind === 'ENTRADA' ? 'Entrada registrada' : 'Baixa registrada')
        }

        await Promise.allSettled([refreshInsumos(), loadMovimentacoes()])
        return true
      } catch (e) {
        const code = (e as any)?.code
        const registros = Array.isArray((e as any)?.registros) ? (e as any).registros : []
        if (String(code || '').toUpperCase() === 'AMBIGUOUS') {
          setQuickRegistros(registros)
          toast.error('Este código possui múltiplos lotes. Selecione o lote/registro.')
          return false
        }
        toast.error(e instanceof Error ? e.message : String(e))
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
      unidade
    ]
  )

  const runTransfer = React.useCallback(async (): Promise<boolean> => {
    if (!canUseApi || !isAuthed) return
    const codigoBarras = quickCodigo.trim()
    if (!codigoBarras) return toast.error('Informe o código de barras')

    if (transferFrom === transferTo) return toast.error('Origem e destino devem ser diferentes')
    const registro = quickRegistro.trim()
    if (quickLoteNeedsPick && !registro) {
      toast.error('Selecione o lote/registro')
      return false
    }

    setQuickActionLoading(true)
    try {
      const quantidade = Math.max(1, parseInt(quickQuantidade, 10) || 0)
      await mutateJson(`/insumos/transferir?unidade=${encodeURIComponent(transferFrom)}`, {
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
      toast.success('Transferência registrada')

      // Refresh what the user is seeing (estoque + movimentações)
      await Promise.allSettled([refreshInsumos(), loadMovimentacoes(), loadOverview()])
      return true
    } catch (e) {
      const code = (e as any)?.code
      const registros = Array.isArray((e as any)?.registros) ? (e as any).registros : []
      if (String(code || '').toUpperCase() === 'AMBIGUOUS') {
        setQuickRegistros(registros)
        toast.error('Este código possui múltiplos lotes. Selecione o lote/registro.')
        return false
      }
      toast.error(e instanceof Error ? e.message : String(e))
      return false
    } finally {
      setQuickActionLoading(false)
    }
  }, [
    canUseApi,
    isAuthed,
    quickLoteNeedsPick,
    loadMovimentacoes,
    loadOverview,
    mutateJson,
    quickCodigo,
    quickObs,
    quickQuantidade,
    quickRegistro,
    refreshInsumos,
    transferFrom,
    transferTo
  ])

  React.useEffect(() => {
    void loadHealth()
    void loadMe()
  }, [loadHealth, loadMe])

  React.useEffect(() => {
    if (!canUseApi || !isAuthed) return
    void loadOverview()
  }, [canUseApi, isAuthed, loadOverview])

  React.useEffect(() => {
    if (!canUseApi || !isAuthed) return
    void loadInsights()
  }, [canUseApi, isAuthed, loadInsights])

  React.useEffect(() => {
    const onOp = (event: Event) => {
      const e = event as CustomEvent<{ op?: 'ENTRADA' | 'BAIXA' | 'TRANSFERENCIA' }>
      const op = e.detail?.op
      if (!op) return
      setQuickScanOpen(false)
      setQuickOp(op)
      try {
        window.scrollTo({ top: 0, behavior: 'smooth' })
      } catch {
        // ignore
      }
    }
    window.addEventListener('skincos:insumos:op', onOp as EventListener)
    return () => window.removeEventListener('skincos:insumos:op', onOp as EventListener)
  }, [])

  React.useEffect(() => {
    if (!canUseApi || !isAuthed) return
    void loadMovimentacoes()
    void loadShareHistory()
  }, [canUseApi, isAuthed, loadMovimentacoes, loadShareHistory])

  React.useEffect(() => {
    if (!canUseApi || !isAuthed) return
    let cancelled = false
    void (async () => {
      skipInsumosQueryEffectRef.current = true
      // Fast path: load first page and decide if we should load full data set.
      const total = await loadInsumosPaged({ pagina: 1, limite: insumosLimite, q: '' })
      if (cancelled) return
      if (total != null && total <= INSUMOS_PAGED_THRESHOLD) {
        await loadInsumosFull()
      }
      skipInsumosQueryEffectRef.current = false
    })()
    return () => {
      cancelled = true
    }
  }, [INSUMOS_PAGED_THRESHOLD, canUseApi, insumosLimite, isAuthed, loadInsumosFull, loadInsumosPaged, unidade])

  React.useEffect(() => {
    if (!canUseApi || !isAuthed) return
    if (insumosMode !== 'paged') return
    if (skipInsumosQueryEffectRef.current) return
    const q = insumosQuery.trim()
    const t = window.setTimeout(() => {
      void loadInsumosPaged({ pagina: 1, limite: insumosLimite, q })
    }, 350)
    return () => window.clearTimeout(t)
  }, [canUseApi, insumosLimite, insumosMode, insumosQuery, isAuthed, loadInsumosPaged, unidade])

  const filteredInsumos = React.useMemo(() => {
    const q = insumosQuery.trim().toLowerCase()
    if (!q) return insumos
    if (insumosMode === 'paged') return insumos
    return insumos.filter((i) => {
      const hay = [i.codigoBarras, i.produto, i.categoria, i.marca, i.lote]
        .filter(Boolean)
        .join(' ')
        .toLowerCase()
      return hay.includes(q)
    })
  }, [insumos, insumosMode, insumosQuery])

  const lotCategorias = React.useMemo(() => {
    const base = (insumosFull?.length ? insumosFull : insumos) || []
    return Array.from(new Set(base.map((i) => String(i.categoria || '').trim()).filter(Boolean))).sort((a, b) =>
      a.localeCompare(b, 'pt-BR', { sensitivity: 'base' })
    )
  }, [insumos, insumosFull])

  const insumosMarcas = React.useMemo(() => {
    const base = (insumosFull?.length ? insumosFull : insumos) || []
    return Array.from(new Set(base.map((i) => String(i.marca || '').trim()).filter(Boolean))).sort((a, b) =>
      a.localeCompare(b, 'pt-BR', { sensitivity: 'base' })
    )
  }, [insumos, insumosFull])

  const insumosTiposUnidade = React.useMemo(() => {
    const base = (insumosFull?.length ? insumosFull : insumos) || []
    const fromData = Array.from(
      new Set(base.map((i) => String(i.tipoUnidade || '').trim()).filter(Boolean))
    ).sort((a, b) => a.localeCompare(b, 'pt-BR', { sensitivity: 'base' }))
    const fixed = ['Frasco', 'Seringa', 'Unidade', 'Caixa', 'ml']
    return Array.from(new Set([...fixed, ...fromData])).filter(Boolean)
  }, [insumos, insumosFull])

  type ChartPresetId =
    | 'stock_category'
    | 'stock_brand'
    | 'stock_top'
    | 'mov_inout'
    | 'mov_saldo'
    | 'trends_inout'

  type ChartMetric = 'qtd' | 'valor'
  type ChartView = 'bar' | 'line' | 'pie'
  type ChartLayout = 'square' | 'wide' | 'tall'
  type ChartSlotConfig = { presetId: ChartPresetId; metric?: ChartMetric; view?: ChartView; topN?: number }

  const CHARTS_SLOTS_KEY = 'skincos.insumos.charts.slots.v1'
  const DEFAULT_CHART_SLOTS: ChartSlotConfig[] = [{ presetId: 'stock_category', metric: 'valor', view: 'pie', topN: 8 }]
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
    { id: 'stock_category', label: 'Distribuição por categoria', supportsMetric: true, supportsView: true, supportsTopN: true, defaultView: 'pie', layout: 'square' },
    { id: 'stock_brand', label: 'Distribuição por marca', supportsMetric: true, supportsView: true, supportsTopN: true, defaultView: 'pie', layout: 'square' },
    { id: 'stock_top', label: 'Top insumos (estoque)', supportsMetric: true, supportsView: true, supportsTopN: true, defaultView: 'bar', layout: 'tall' },
    { id: 'mov_inout', label: 'Entrada vs Saída', supportsMetric: true, supportsView: true, defaultView: 'bar', layout: 'wide' },
    { id: 'mov_saldo', label: 'Saldo (entrada − saída)', supportsMetric: true, supportsView: true, defaultView: 'line', layout: 'wide' },
    { id: 'trends_inout', label: `Tendências (${overviewPeriod})`, supportsMetric: true, supportsView: true, defaultView: 'bar', layout: 'wide' }
  ]

  const [chartSlots, setChartSlots] = React.useState<ChartSlotConfig[]>(() => {
    try {
      const raw = window.localStorage.getItem(CHARTS_SLOTS_KEY)
      if (!raw) return DEFAULT_CHART_SLOTS
      const parsed = JSON.parse(raw)
      const slots = Array.isArray(parsed) ? parsed : []
      const validIds = new Set(CHART_PRESETS.map((p) => p.id))
      const cleaned: ChartSlotConfig[] = slots
        .slice(0, MAX_CHARTS)
        .map((s: any, idx: number) => {
          const fallback = DEFAULT_CHART_SLOTS[0]
          const presetId: ChartPresetId = validIds.has(String(s?.presetId)) ? (String(s.presetId) as any) : fallback.presetId
          const preset = CHART_PRESETS.find((p) => p.id === presetId)
          const metric: ChartMetric | undefined = s?.metric === 'valor' || s?.metric === 'qtd' ? s.metric : preset?.defaultMetric
          const view: ChartView | undefined = s?.view === 'bar' || s?.view === 'line' || s?.view === 'pie' ? s.view : preset?.defaultView
          const topN = Math.max(5, Math.min(15, parseInt(String(s?.topN ?? ''), 10) || 0)) || fallback.topN
          return { presetId, metric, view, topN }
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
      const view = next.view ?? cur.view ?? preset?.defaultView
      const topN = next.topN ?? cur.topN
      copy[idx] = { ...cur, ...next, presetId, metric, view, topN }
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

    for (const i of insumos || []) {
      const estoque = Number(i.estoqueAtual) || 0
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
  }, [insumos])

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
    const limit = overviewPeriod === '7d' ? 7 : overviewPeriod === '30d' ? 30 : overviewPeriod === '90d' ? 90 : 365
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

  const movSeriesForCharts = React.useMemo(() => {
    if (overviewPeriod !== '1y') return overviewMovSeries
    const byWeek = new Map<string, { day: string; entrada: number; saida: number; entradaValor: number; saidaValor: number }>()
    for (const r of overviewMovSeries) {
      const week = isoDayWeekStart(r.day) || String(r.day || '')
      const cur = byWeek.get(week) || { day: week, entrada: 0, saida: 0, entradaValor: 0, saidaValor: 0 }
      cur.entrada += Number(r.entrada) || 0
      cur.saida += Number(r.saida) || 0
      cur.entradaValor += Number(r.entradaValor) || 0
      cur.saidaValor += Number(r.saidaValor) || 0
      byWeek.set(week, cur)
    }
    return Array.from(byWeek.values()).sort((a, b) => String(a.day).localeCompare(String(b.day))).slice(-60)
  }, [overviewMovSeries, overviewPeriod])

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

  const presetViewOptions = React.useCallback((id: ChartPresetId): ChartView[] => {
    if (id === 'stock_category' || id === 'stock_brand') return ['pie', 'bar']
    if (id === 'mov_saldo') return ['line', 'bar']
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

      if (presetId === 'stock_category' || presetId === 'stock_brand') {
        const base = presetId === 'stock_category' ? stockAgg.byCategoria : stockAgg.byMarca
        const sorted = [...base].sort((a, b) => (metric === 'valor' ? b.valor - a.valor : b.qtd - a.qtd))
        const top = sorted.slice(0, topN).map((x) => ({
          name: x.name,
          value: metric === 'valor' ? x.valor : x.qtd,
          color: getCategoriaBgColor(x.name)
        }))
        const restValue = sorted.slice(topN).reduce((acc, x) => acc + (metric === 'valor' ? x.valor : x.qtd), 0)
        if (restValue > 0) top.push({ name: 'Outros', value: restValue, color: '#9aa5b1' })

        if (!top.length) return <div className="text-sm text-blue-100/70">{overviewLoading ? 'Carregando…' : 'Sem dados.'}</div>

        return view === 'pie' ? (
          <div className="w-full" style={{ height }}>
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie data={top} dataKey="value" nameKey="name" innerRadius={58} outerRadius={92} paddingAngle={2}>
                  {top.map((entry, idx) => (
                    <Cell key={idx} fill={(entry as any).color} />
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
              <BarChart data={top} layout="vertical" margin={{ left: 12, right: 12 }}>
                <CartesianGrid strokeDasharray="3 3" opacity={0.15} />
                <XAxis type="number" tick={{ fill: 'rgba(219,234,254,0.8)', fontSize: 11 }} />
                <YAxis
                  type="category"
                  dataKey="name"
                  width={110}
                  tick={{ fill: 'rgba(219,234,254,0.8)', fontSize: 11 }}
                />
                <Tooltip formatter={tooltipFormatter} />
                <Bar dataKey="value" name={metric === 'valor' ? 'Valor' : 'Qtd'} fill="#60a5fa" radius={[0, 6, 6, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        )
      }

      if (presetId === 'stock_top') {
        const sorted = [...stockAgg.byProduto].sort((a, b) => (metric === 'valor' ? b.valor - a.valor : b.qtd - a.qtd)).slice(0, topN)
        const data = sorted.map((x) => ({ name: x.name, value: metric === 'valor' ? x.valor : x.qtd }))
        if (!data.length) return <div className="text-sm text-blue-100/70">{overviewLoading ? 'Carregando…' : 'Sem dados.'}</div>
        return (
          <div className="w-full" style={{ height }}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={data} layout="vertical" margin={{ left: 12, right: 12 }}>
                <CartesianGrid strokeDasharray="3 3" opacity={0.15} />
                <XAxis type="number" tick={{ fill: 'rgba(219,234,254,0.8)', fontSize: 11 }} />
                <YAxis type="category" dataKey="name" width={140} tick={{ fill: 'rgba(219,234,254,0.8)', fontSize: 11 }} />
                <Tooltip formatter={tooltipFormatter} />
                <Bar dataKey="value" name={metric === 'valor' ? 'Valor' : 'Qtd'} fill="#a78bfa" radius={[0, 6, 6, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        )
      }

      if (presetId === 'mov_inout' || presetId === 'mov_saldo') {
        if (!movSeriesForCharts.length) return <div className="text-sm text-blue-100/70">{overviewLoading ? 'Carregando…' : 'Sem dados.'}</div>
        const series =
          presetId === 'mov_saldo'
            ? movSeriesForCharts.map((p) => ({
                day: p.day,
                saldoQtd: (Number(p.entrada) || 0) - (Number(p.saida) || 0),
                saldoValor: (Number(p.entradaValor) || 0) - (Number(p.saidaValor) || 0)
              }))
            : movSeriesForCharts

        const xFormatter = (d: any) => fmtDayShort(String(d))

        if (view === 'line') {
          return (
            <div className="w-full" style={{ height }}>
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={series as any}>
                  <CartesianGrid strokeDasharray="3 3" opacity={0.15} />
                  <XAxis dataKey="day" tickFormatter={xFormatter} />
                  <YAxis />
                  <Tooltip labelFormatter={xFormatter} formatter={tooltipFormatter} />
                  <Legend />
                  {presetId === 'mov_saldo' ? (
                    <Line type="monotone" dataKey={metric === 'valor' ? 'saldoValor' : 'saldoQtd'} name="Saldo" stroke="#60a5fa" strokeWidth={2} dot={false} />
                  ) : (
                    <>
                      <Line type="monotone" dataKey={metric === 'valor' ? 'entradaValor' : 'entrada'} name="Entrada" stroke="#22c55e" strokeWidth={2} dot={false} />
                      <Line type="monotone" dataKey={metric === 'valor' ? 'saidaValor' : 'saida'} name="Saída" stroke="#ef4444" strokeWidth={2} dot={false} />
                    </>
                  )}
                </LineChart>
              </ResponsiveContainer>
            </div>
          )
        }

        return (
          <div className="w-full" style={{ height }}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={series as any}>
                <CartesianGrid strokeDasharray="3 3" opacity={0.2} />
                <XAxis dataKey="day" tickFormatter={xFormatter} />
                <YAxis />
                <Tooltip labelFormatter={xFormatter} formatter={tooltipFormatter} />
                <Legend />
                {presetId === 'mov_saldo' ? (
                  <Bar dataKey={metric === 'valor' ? 'saldoValor' : 'saldoQtd'} name="Saldo" fill="#60a5fa" radius={[4, 4, 0, 0]} />
                ) : (
                  <>
                    <Bar dataKey={metric === 'valor' ? 'entradaValor' : 'entrada'} name="Entrada" fill="#22c55e" radius={[4, 4, 0, 0]} />
                    <Bar dataKey={metric === 'valor' ? 'saidaValor' : 'saida'} name="Saída" fill="#ef4444" radius={[4, 4, 0, 0]} />
                  </>
                )}
              </BarChart>
            </ResponsiveContainer>
          </div>
        )
      }

      if (presetId === 'trends_inout') {
        if (!trendsSeries.length) return <div className="text-sm text-blue-100/70">{insightsLoading ? 'Carregando…' : 'Sem dados para o período.'}</div>
        const series = trendsSeries.map((b) => ({
          bucket: b.bucket,
          entrada: metric === 'valor' ? b.entradaValor : b.entradaQtd,
          saida: metric === 'valor' ? b.saidaValor : b.saidaQtd,
          saldo: metric === 'valor' ? b.saldoValor : b.saldoQtd
        }))
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
                    <Line type="monotone" dataKey="entrada" name="Entradas" stroke="#22c55e" strokeWidth={2} dot={false} />
                    <Line type="monotone" dataKey="saida" name="Saídas" stroke="#ef4444" strokeWidth={2} dot={false} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
              <div className="text-xs text-blue-200/60 mt-2">
                Saldo: <span className="font-mono">{fmtChartValue(metric, saldoTotal)}</span>
              </div>
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
                  <Bar dataKey="entrada" name="Entradas" fill="#22c55e" />
                  <Bar dataKey="saida" name="Saídas" fill="#ef4444" />
                </BarChart>
              </ResponsiveContainer>
            </div>
            <div className="text-xs text-blue-200/60 mt-2">
              Saldo: <span className="font-mono">{fmtChartValue(metric, saldoTotal)}</span>
            </div>
          </div>
        )
      }

      return <div className="text-sm text-blue-100/70">Preset indisponível.</div>
    },
    [fmtBucketLabel, fmtChartValue, fmtDayShort, insightsLoading, movSeriesForCharts, overviewLoading, stockAgg, trendsSeries]
  )

  const alertasCategorias = React.useMemo(() => {
    return Array.from(new Set((insightsAlertas || []).map((a) => String(a.categoria || '').trim()).filter(Boolean))).sort(
      (a, b) => a.localeCompare(b, 'pt-BR', { sensitivity: 'base' })
    )
  }, [insightsAlertas])

  const insightsAlertasFiltrados = React.useMemo(() => {
    const q = alertasBusca.trim().toLowerCase()
    return (insightsAlertas || []).filter((a) => {
      if (alertasCategoria && String(a.categoria || '') !== alertasCategoria) return false
      const status = calcularStatusEstoque(Number(a.estoqueAtual) || 0, Number(a.estoqueMinimo) || 0)
      if (alertasStatus !== 'TODOS' && status !== alertasStatus) return false
      if (!q) return true
      const hay = [a.produto, a.categoria, a.codigoBarras].filter(Boolean).join(' ').toLowerCase()
      return hay.includes(q)
    })
  }, [alertasBusca, alertasCategoria, alertasStatus, insightsAlertas])

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
    if (!movGroupTransfers || movTipo !== 'TODOS') return list

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
    return out
  }, [movGroupTransfers, movTipo, movimentacoes])

  return (
    <div className="p-6 space-y-6">
      <Dialog open={offlineDialogOpen} onOpenChange={setOfflineDialogOpen}>
        <DialogContent className="max-w-3xl">
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
          setQuickOp(null)
          setQuickScanOpen(false)
          setQuickRegistros([])
          setQuickRegistro('')
        }}
      >
        <DialogContent className="max-w-xl">
          <DialogHeader>
            <DialogTitle>
              {quickOp === 'ENTRADA'
                ? 'Entrada'
                : quickOp === 'BAIXA'
                  ? 'Saída'
                  : quickOp === 'TRANSFERENCIA'
                    ? 'Transferência'
                    : 'Operação'}
            </DialogTitle>
            <DialogDescription>
              Preencha os dados para registrar a operação na unidade selecionada.
            </DialogDescription>
          </DialogHeader>

          {!isAuthed ? (
            <div className="text-sm text-blue-100/70">Faça login no CRM para usar as operações de Insumos.</div>
          ) : null}

          <div className="space-y-3">
            <div>
              <div className="text-xs text-blue-200/70 mb-1">Código de barras</div>
              <div className="flex items-center gap-2">
                <Input value={quickCodigo} onChange={(e) => setQuickCodigo(e.target.value)} placeholder="ex: 789..." />
                <Button variant="secondary" type="button" onClick={() => setQuickScanOpen((v) => !v)}>
                  {quickScanOpen ? 'Fechar' : 'Scan'}
                </Button>
              </div>
            </div>

            {quickLoteNeedsPick ? (
              <div className="rounded-xl border border-white/10 bg-black/20 p-3 space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <div className="text-xs text-blue-200/70">Lote/registro</div>
                  {(quickOp === 'BAIXA' || quickOp === 'TRANSFERENCIA') && quickLotesForPicker.length > 1 ? (
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

            <div className="grid grid-cols-2 gap-2">
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
              <div className="grid grid-cols-2 gap-2">
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
                  setQuickCodigo(code)
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
                setQuickOp(null)
                setQuickScanOpen(false)
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
                    setQuickOp(null)
                    setQuickScanOpen(false)
                  }
                }}
                disabled={quickActionLoading || !isAuthed}
              >
                Confirmar transferência
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
                    setQuickOp(null)
                    setQuickScanOpen(false)
                  }
                }}
                disabled={quickActionLoading || !isAuthed}
              >
                {quickOp === 'ENTRADA' ? 'Confirmar entrada' : 'Confirmar saída'}
              </Button>
            )}
          </DialogFooter>
      </DialogContent>
      </Dialog>

		      <div className="max-w-6xl mx-auto mb-4 flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
		        <div className="flex items-center gap-2">
		          <div className="space-y-1">
		            <div className="text-xs text-blue-200/70">Unidade</div>
		            <Select value={unidade} onValueChange={(v) => setUnidade(v)}>
		              <SelectTrigger className="w-64">
		                <SelectValue placeholder="Selecione" />
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
	        <div className="flex items-center gap-2">
	          <Button
	            size="icon"
	            className="!bg-green-600 hover:!bg-green-700 !text-white"
	            title="Entrada"
	            onClick={() => {
	              setQuickScanOpen(false)
	              setQuickOp('ENTRADA')
	            }}
	            disabled={!isAuthed}
	          >
	            +
	          </Button>
	          <Button
	            size="icon"
	            variant="destructive"
	            title="Saída"
	            onClick={() => {
	              setQuickScanOpen(false)
	              setQuickOp('BAIXA')
	            }}
	            disabled={!isAuthed}
	          >
	            −
	          </Button>
	          <Button
	            size="icon"
	            className="!bg-blue-600 hover:!bg-blue-700 !text-white"
	            title="Transferência"
	            onClick={() => {
	              setQuickScanOpen(false)
	              setQuickOp('TRANSFERENCIA')
	            }}
	            disabled={!isAuthed}
	          >
	            ⟲
	          </Button>
	        </div>
	      </div>

	      <div ref={overviewSectionRef} className="max-w-6xl mx-auto space-y-3">
	        <div className="flex flex-col gap-2 md:flex-row md:items-start md:justify-between">
	          <div>
	            <div className="text-white text-lg font-semibold">Visão geral</div>
	            <div className="text-sm text-blue-100/70">KPIs, gráficos e alertas para a unidade atual.</div>
	          </div>
	          <div className="flex items-center gap-2">
	            <Select value={overviewPeriod} onValueChange={(v) => setOverviewPeriod(v as any)}>
	              <SelectTrigger className="w-24">
	                <SelectValue />
	              </SelectTrigger>
	              <SelectContent>
	                <SelectItem value="7d">7d</SelectItem>
	                <SelectItem value="30d">30d</SelectItem>
	                <SelectItem value="90d">90d</SelectItem>
	                <SelectItem value="1y">1 ano</SelectItem>
	              </SelectContent>
	            </Select>
	            <Button
	              variant="secondary"
	              onClick={() => void Promise.allSettled([loadOverview(), loadInsights(), refreshInsumos()])}
	              disabled={(!isAuthed) || overviewLoading || insightsLoading}
	            >
	              {(overviewLoading || insightsLoading) ? 'Carregando…' : 'Recarregar'}
	            </Button>
	          </div>
	        </div>

	              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-6 gap-3">
	              <Card className="bg-black/20 border border-white/10">
	                <CardHeader>
	                  <CardTitle className="text-white text-sm">💰 Valor em estoque</CardTitle>
	                </CardHeader>
                <CardContent>
                  <div className="text-lg text-blue-50 font-mono">
                    {overviewResumo?.valorEstoqueTotal != null ? fmtMoneyBRL(Number(overviewResumo.valorEstoqueTotal) || 0) : '-'}
                  </div>
                  <div className="text-xs text-blue-200/60">{overviewResumo?.totalInsumos ?? '-'} itens</div>
                </CardContent>
              </Card>

              <Card className="bg-black/20 border border-white/10">
                <CardHeader>
                  <CardTitle className="text-white text-sm">🚨 Críticos</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="text-lg text-blue-50 font-mono">{overviewResumo?.criticos ?? '-'}</div>
                  <div className="text-xs text-blue-200/60">abaixo do mínimo</div>
                </CardContent>
              </Card>

              <Card className="bg-black/20 border border-white/10">
                <CardHeader>
                  <CardTitle className="text-white text-sm">⚠️ Estoque baixo</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="text-lg text-blue-50 font-mono">{overviewNotifications?.counts?.lowStock ?? '-'}</div>
                  <div className="text-xs text-blue-200/60">atenção</div>
                </CardContent>
              </Card>

              <Card className="bg-black/20 border border-white/10">
                <CardHeader>
                  <CardTitle className="text-white text-sm">⏳ Vencendo</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="text-lg text-blue-50 font-mono">{overviewNotifications?.counts?.expiringSoon ?? '-'}</div>
                  <div className="text-xs text-blue-200/60">janela próxima</div>
                </CardContent>
              </Card>

              <Card className="bg-black/20 border border-white/10">
                <CardHeader>
                  <CardTitle className="text-white text-sm">🧨 Expirado c/ estoque</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="text-lg text-blue-50 font-mono">{overviewNotifications?.counts?.expiredWithStock ?? '-'}</div>
                  <div className="text-xs text-blue-200/60">risco imediato</div>
                </CardContent>
              </Card>

	              <Card className="bg-black/20 border border-white/10">
	                <CardHeader>
	                  <CardTitle className="text-white text-sm">📊 Movimentações</CardTitle>
	                </CardHeader>
	                <CardContent>
                  <div className="text-xs text-blue-200/60">{overviewPeriod}</div>
                  <div className="text-sm text-blue-100/80">
                    <span className="font-mono">+{overviewMovResumo?.entradaQtd ?? '-'}</span> •{' '}
                    <span className="font-mono">-{overviewMovResumo?.saidaQtd ?? '-'}</span>
	                  </div>
	                  <div className="text-xs text-blue-200/60">
	                    saldo: <span className="font-mono">{overviewMovResumo ? fmtMoneyBRL(overviewMovResumo.saldoLiquido || 0) : '-'}</span>
	                  </div>
	                </CardContent>
	              </Card>
	            </div>

			            <Card className="bg-black/20 border border-white/10">
			              <CardHeader className="flex flex-row items-center justify-between gap-2">
			                <CardTitle className="text-white text-base">Alertas</CardTitle>
		                <div className="flex items-center gap-2 text-xs text-blue-200/60">
		                  <span>
		                    estoque:{' '}
		                    <span className="font-mono">
		                      {Number.isFinite(Number(overviewNotifications?.counts?.lowStock)) ? Number(overviewNotifications?.counts?.lowStock) : insightsAlertasFiltrados.length}
		                    </span>
		                  </span>
		                  <span>•</span>
			                  <span>
			                    validade:{' '}
			                    <span className="font-mono">
			                      {(Number(overviewNotifications?.counts?.expiringSoon) || 0) + (Number(overviewNotifications?.counts?.expiredWithStock) || 0)}
			                    </span>
			                  </span>
			                </div>
			              </CardHeader>
		              <CardContent className="space-y-3">
		                <details className="rounded-xl border border-white/10 bg-black/10 p-3">
		                  <summary className="cursor-pointer select-none text-sm text-blue-100/80">
		                    Estoque abaixo do mínimo
		                  </summary>
		                  <div className="mt-3 space-y-2">
		                    <div className="grid grid-cols-1 md:grid-cols-3 gap-2 items-end">
		                      <div>
		                        <div className="text-xs text-blue-200/70 mb-1">Status</div>
		                        <Select value={alertasStatus} onValueChange={(v) => setAlertasStatus(v as any)}>
		                          <SelectTrigger>
		                            <SelectValue />
		                          </SelectTrigger>
			                          <SelectContent>
			                            <SelectItem value="TODOS">Todos</SelectItem>
			                            <SelectItem value="ATENCAO">Estoque baixo</SelectItem>
			                            <SelectItem value="URGENTE">Críticos</SelectItem>
			                          </SelectContent>
			                        </Select>
		                      </div>
		                      <div>
		                        <div className="text-xs text-blue-200/70 mb-1">Categoria</div>
		                        <Select
		                          value={alertasCategoria || '__ALL__'}
		                          onValueChange={(v) => setAlertasCategoria(v === '__ALL__' ? '' : String(v))}
		                        >
		                          <SelectTrigger>
		                            <SelectValue />
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
		                      </div>
		                      <div>
		                        <div className="text-xs text-blue-200/70 mb-1">Buscar</div>
		                        <Input value={alertasBusca} onChange={(e) => setAlertasBusca(e.target.value)} placeholder="produto, categoria, código…" />
		                      </div>
		                    </div>

		                    <div className="overflow-auto max-h-[60vh] rounded-xl border border-white/10">
		                      <table className="min-w-full text-sm">
		                        <thead className="bg-black/30 text-blue-100/80">
		                          <tr>
		                            <th className="text-left p-3">Produto</th>
		                            <th className="text-left p-3">Categoria</th>
		                            <th className="text-left p-3">Status</th>
		                            <th className="text-right p-3">Atual</th>
		                            <th className="text-right p-3">Mín</th>
		                            <th className="text-right p-3">Dif</th>
		                            <th className="text-right p-3">%</th>
		                          </tr>
		                        </thead>
		                        <tbody className="divide-y divide-white/5">
		                          {insightsAlertasFiltrados.slice(0, 80).map((a, idx) => {
		                            const status = calcularStatusEstoque(Number(a.estoqueAtual) || 0, Number(a.estoqueMinimo) || 0)
		                            return (
		                              <tr key={`${a.codigoBarras || ''}-${idx}`} className="hover:bg-white/5">
		                                <td className="p-3 text-blue-50">
		                                  <div className="text-blue-50">{a.produto || '-'}</div>
		                                  <div className="text-xs text-blue-200/60 font-mono">{a.codigoBarras || '-'}</div>
		                                </td>
		                                <td className="p-3 text-blue-100/80">
		                                  <div className="flex items-center gap-2">
		                                    <span className="inline-block h-2.5 w-2.5 rounded-full" style={{ backgroundColor: getCategoriaBgColor(a.categoria || 'Outros') }} />
		                                    <span className="truncate">{a.categoria || '-'}</span>
		                                  </div>
		                                </td>
		                                <td className="p-3">
		                                  <Badge variant={estoqueStatusBadgeVariant(status)}>{estoqueStatusLabel(status)}</Badge>
		                                </td>
		                                <td className="p-3 text-right text-blue-100/80">{a.estoqueAtual ?? '-'}</td>
		                                <td className="p-3 text-right text-blue-100/70">{a.estoqueMinimo ?? '-'}</td>
		                                <td className="p-3 text-right text-blue-100/70">{a.diferenca ?? '-'}</td>
		                                <td className="p-3 text-right text-blue-100/70">{a.percentual != null ? `${a.percentual}%` : '-'}</td>
		                              </tr>
		                            )
		                          })}
		                          {!insightsAlertasFiltrados.length ? (
		                            <tr>
		                              <td className="p-3 text-blue-100/70" colSpan={7}>
		                                {insightsLoading ? 'Carregando…' : isAuthed ? 'Sem alertas.' : 'Faça login para carregar.'}
		                              </td>
		                            </tr>
		                          ) : null}
		                        </tbody>
		                      </table>
		                    </div>
		                  </div>
		                </details>

			                <details className="rounded-xl border border-white/10 bg-black/10 p-3">
			                  <summary className="cursor-pointer select-none text-sm text-blue-100/80">Validade</summary>
			                  <div className="mt-3 space-y-3">
			                    <div className="text-xs text-blue-200/60">
			                      Lista resumida (até 50 itens) gerada automaticamente para a unidade.
			                    </div>
			                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
			                      <div className="rounded-xl border border-white/10 bg-black/10 p-3">
			                        <div className="flex items-center justify-between gap-2">
			                          <div className="text-sm text-blue-100/80">⏳ Vencendo</div>
			                          <Badge variant="secondary">{overviewNotifications?.counts?.expiringSoon ?? 0}</Badge>
			                        </div>
			                        <div className="mt-2 overflow-auto max-h-[50vh] rounded-lg border border-white/10">
			                          <table className="min-w-full text-sm">
			                            <thead className="bg-black/30 text-blue-100/80">
			                              <tr>
			                                <th className="text-left p-3">Produto</th>
			                                <th className="text-left p-3">Validade</th>
			                                <th className="text-right p-3">Estoque</th>
			                                <th className="text-right p-3">Ação</th>
			                              </tr>
			                            </thead>
			                            <tbody className="divide-y divide-white/5 text-blue-50/90">
			                              {(overviewNotifications?.expiringSoon || []).map((it: any, idx: number) => (
			                                <tr key={`${it.codigoBarras || ''}-${idx}`} className="hover:bg-white/5">
			                                  <td className="p-3">
			                                    <div className="font-medium">{it.produto || '-'}</div>
			                                    <div className="text-xs text-blue-200/60 font-mono">{it.codigoBarras || ''}</div>
			                                  </td>
			                                  <td className="p-3 font-mono">{it.dataValidade ? fmtDateOnlyBR(String(it.dataValidade)) : '-'}</td>
			                                  <td className="p-3 text-right font-mono">{it.estoqueAtual ?? '-'}</td>
			                                  <td className="p-3 text-right">
			                                    <Button
			                                      variant="secondary"
			                                      className="h-8 px-2 text-xs"
			                                      onClick={() => {
			                                        if (it.codigoBarras) setQuickCodigo(String(it.codigoBarras))
			                                      }}
			                                      disabled={!isAuthed}
			                                    >
			                                      Usar
			                                    </Button>
			                                  </td>
			                                </tr>
			                              ))}
			                              {!(overviewNotifications?.expiringSoon || []).length ? (
			                                <tr>
			                                  <td className="p-3 text-blue-100/70" colSpan={4}>
			                                    {overviewLoading ? 'Carregando…' : 'Sem itens.'}
			                                  </td>
			                                </tr>
			                              ) : null}
			                            </tbody>
			                          </table>
			                        </div>
			                      </div>
			                      <div className="rounded-xl border border-white/10 bg-black/10 p-3">
			                        <div className="flex items-center justify-between gap-2">
			                          <div className="text-sm text-blue-100/80">🧨 Expirado c/ estoque</div>
			                          <Badge variant="destructive">{overviewNotifications?.counts?.expiredWithStock ?? 0}</Badge>
			                        </div>
			                        <div className="mt-2 overflow-auto max-h-[50vh] rounded-lg border border-white/10">
			                          <table className="min-w-full text-sm">
			                            <thead className="bg-black/30 text-blue-100/80">
			                              <tr>
			                                <th className="text-left p-3">Produto</th>
			                                <th className="text-left p-3">Validade</th>
			                                <th className="text-right p-3">Estoque</th>
			                                <th className="text-right p-3">Ação</th>
			                              </tr>
			                            </thead>
			                            <tbody className="divide-y divide-white/5 text-blue-50/90">
			                              {(overviewNotifications?.expiredWithStock || []).map((it: any, idx: number) => (
			                                <tr key={`${it.codigoBarras || ''}-${idx}`} className="hover:bg-white/5">
			                                  <td className="p-3">
			                                    <div className="font-medium">{it.produto || '-'}</div>
			                                    <div className="text-xs text-blue-200/60 font-mono">{it.codigoBarras || ''}</div>
			                                  </td>
			                                  <td className="p-3 font-mono">{it.dataValidade ? fmtDateOnlyBR(String(it.dataValidade)) : '-'}</td>
			                                  <td className="p-3 text-right font-mono">{it.estoqueAtual ?? '-'}</td>
			                                  <td className="p-3 text-right">
			                                    <Button
			                                      variant="secondary"
			                                      className="h-8 px-2 text-xs"
			                                      onClick={() => {
			                                        if (it.codigoBarras) setQuickCodigo(String(it.codigoBarras))
			                                      }}
			                                      disabled={!isAuthed}
			                                    >
			                                      Usar
			                                    </Button>
			                                  </td>
			                                </tr>
			                              ))}
			                              {!(overviewNotifications?.expiredWithStock || []).length ? (
			                                <tr>
			                                  <td className="p-3 text-blue-100/70" colSpan={4}>
			                                    {overviewLoading ? 'Carregando…' : 'Sem itens.'}
			                                  </td>
			                                </tr>
			                              ) : null}
			                            </tbody>
			                          </table>
			                        </div>
			                      </div>
			                    </div>
			                  </div>
			                </details>

				                <details className="rounded-xl border border-white/10 bg-black/10 p-3">
				                  <summary className="cursor-pointer select-none text-sm text-blue-100/80">
				                    Ações recomendadas
				                  </summary>
				                  <div className="mt-3 grid grid-cols-1 md:grid-cols-2 gap-4">
			                    <div className="space-y-2">
			                      <div className="text-sm text-blue-100/80">Reposição</div>
			                      {(overviewActionables?.reposicao || []).slice(0, 6).map((r) => (
			                        <button
			                          key={String(r.codigoBarras)}
			                          className="w-full text-left rounded-lg border border-white/10 bg-black/20 px-3 py-2 hover:bg-white/5"
			                          onClick={() => {
			                            if (r.codigoBarras) setQuickCodigo(String(r.codigoBarras))
			                          }}
			                        >
			                          <div className="text-sm text-blue-50 truncate">{r.produto || '-'}</div>
			                          <div className="text-xs text-blue-200/60 font-mono truncate">{r.codigoBarras || ''}</div>
			                          <div className="text-xs text-blue-100/70 mt-1">
			                            sugerido: <span className="font-mono">+{r.suggestedPurchaseQty ?? '-'}</span> •{' '}
			                            {r.estimatedValue != null ? fmtMoneyBRL(Number(r.estimatedValue) || 0) : ''}
			                          </div>
			                        </button>
			                      ))}
			                      {!overviewActionables?.reposicao?.length ? (
			                        <div className="text-sm text-blue-100/70">{overviewLoading ? 'Carregando…' : 'Sem recomendações.'}</div>
			                      ) : null}
			                    </div>
			                    <div className="space-y-2">
			                      <div className="text-sm text-blue-100/80">Transferências sugeridas</div>
			                      {(overviewActionables?.transferencias || []).slice(0, 6).map((t) => (
			                        <button
			                          key={`${t.codigoBarras}-${t.from}-${t.to}`}
			                          className="w-full text-left rounded-lg border border-white/10 bg-black/20 px-3 py-2 hover:bg-white/5"
			                          onClick={() => {
			                            if (t.codigoBarras) setQuickCodigo(String(t.codigoBarras))
			                            if (t.qty != null) setQuickQuantidade(String(t.qty))
			                            if (t.from) setTransferFrom(String(t.from))
			                            if (t.to) setTransferTo(String(t.to))
			                          }}
			                        >
			                          <div className="text-sm text-blue-50 truncate">{t.produto || '-'}</div>
			                          <div className="text-xs text-blue-200/60 font-mono truncate">{t.codigoBarras || ''}</div>
			                          <div className="text-xs text-blue-100/70 mt-1">
			                            <span className="font-mono">{t.from ? unidadeLabel(String(t.from)) : '-'}</span> →{' '}
			                            <span className="font-mono">{t.to ? unidadeLabel(String(t.to)) : '-'}</span> •{' '}
			                            <span className="font-mono">{t.qty ?? '-'}</span>
			                          </div>
			                        </button>
			                      ))}
			                      {!overviewActionables?.transferencias?.length ? (
			                        <div className="text-sm text-blue-100/70">{overviewLoading ? 'Carregando…' : 'Sem sugestões.'}</div>
			                      ) : null}
				                    </div>
				                  </div>
				                </details>

			                <details className="rounded-xl border border-white/10 bg-black/10 p-3">
			                  <summary className="cursor-pointer select-none text-sm text-blue-100/80">
			                    Qualidade do cadastro{' '}
			                    <span className="text-xs text-blue-200/60">
			                      • {overviewQuality?.summary?.total != null ? `${overviewQuality.summary.total} issues` : overviewLoading ? 'Carregando…' : '—'}
			                    </span>
			                  </summary>
			                  <div className="mt-3 space-y-2">
			                    <div className="flex flex-wrap items-center gap-2 text-sm text-blue-100/80">
			                      {overviewQuality?.summary?.bySeverity ? (
			                        <>
			                          <Badge variant="destructive">CRIT {overviewQuality.summary.bySeverity.CRITICAL ?? 0}</Badge>
			                          <Badge variant="secondary">WARN {overviewQuality.summary.bySeverity.WARN ?? 0}</Badge>
			                          <Badge variant="default">INFO {overviewQuality.summary.bySeverity.INFO ?? 0}</Badge>
			                        </>
			                      ) : null}
			                      {!overviewQuality?.summary?.total ? (
			                        <span className="text-blue-100/70">{overviewLoading ? 'Carregando…' : 'Sem issues.'}</span>
			                      ) : null}
			                    </div>

			                    {overviewQuality?.issues?.length ? (
			                      <div className="overflow-auto max-h-[60vh] rounded-xl border border-white/10">
			                        <table className="min-w-full text-sm">
			                          <thead className="bg-black/30 text-blue-100/80">
			                            <tr>
			                              <th className="text-left p-3">Sev</th>
			                              <th className="text-left p-3">Código</th>
			                              <th className="text-left p-3">Mensagem</th>
			                            </tr>
			                          </thead>
			                          <tbody className="divide-y divide-white/5">
			                            {(overviewQuality.issues || []).slice(0, 30).map((it, idx) => {
			                              const sev = String(it.severity || '').toUpperCase()
			                              const badgeVariant = sev === 'CRITICAL' ? 'destructive' : sev === 'WARN' ? 'secondary' : 'default'
			                              return (
			                                <tr key={`${it.code || ''}-${idx}`} className="hover:bg-white/5">
			                                  <td className="p-3">
			                                    <Badge variant={badgeVariant as any}>{sev || 'INFO'}</Badge>
			                                  </td>
			                                  <td className="p-3 font-mono text-blue-100/70">{it.code || '-'}</td>
			                                  <td className="p-3 text-blue-50">
			                                    {it.message || '-'}
			                                    {(it.codigoBarras || it.produto) ? (
			                                      <div className="text-xs text-blue-200/60 mt-1">
			                                        {(it.codigoBarras ? `#${it.codigoBarras}` : '')}
			                                        {it.codigoBarras && it.produto ? ' • ' : ''}
			                                        {it.produto || ''}
			                                      </div>
			                                    ) : null}
			                                  </td>
			                                </tr>
			                              )
			                            })}
			                          </tbody>
			                        </table>
			                      </div>
			                    ) : null}
			                  </div>
			                </details>
				              </CardContent>
				            </Card>

			            <div className="flex flex-wrap items-center justify-between gap-2">
			              <div className="text-white text-base font-semibold">Gráficos</div>
			              <div className="flex items-center gap-2">
			                <Button
			                  variant="outline"
			                  size="sm"
			                  onClick={() => {
			                    if (chartSlots.length >= MAX_CHARTS) return
			                    setChartSlots((prev) => [...prev, { presetId: 'trends_inout', metric: 'qtd', view: 'bar' }])
			                  }}
			                  disabled={overviewLoading || insightsLoading || chartSlots.length >= MAX_CHARTS}
			                >
			                  + Adicionar
			                </Button>
			                <Button
			                  variant="outline"
			                  size="sm"
			                  onClick={() => setChartSlots(DEFAULT_CHART_SLOTS)}
			                  disabled={overviewLoading || insightsLoading}
			                >
			                  Reset
			                </Button>
			              </div>
			            </div>
			            <div
			              className={`grid gap-3 ${
			                chartSlots.length === 1
			                  ? 'grid-cols-1'
			                  : chartSlots.length === 2
			                    ? 'grid-cols-1 lg:grid-cols-2'
			                    : 'grid-cols-1 md:grid-cols-2 xl:grid-cols-3 xl:grid-flow-dense'
			              }`}
			            >
			              {chartSlots.map((slot, idx) => {
			                const preset = presetSupports(slot.presetId)
			                const viewOptions = presetViewOptions(slot.presetId)
			                const view = (slot.view || preset.defaultView || viewOptions[0] || 'bar') as any
			                const metric = (slot.metric === 'valor' ? 'valor' : 'qtd') as any
			                const topN = Math.max(5, Math.min(15, Number(slot.topN) || 8))
			                const layout = (preset as any).layout as ChartLayout | undefined
			                const baseH =
			                  chartSlots.length === 1 ? 360 : chartSlots.length === 2 ? 300 : 260
			                const height =
			                  layout === 'tall'
			                    ? baseH + (chartSlots.length === 1 ? 180 : 120)
			                    : baseH
			                const cardSpan =
			                  chartSlots.length >= 3 && layout === 'wide' ? 'xl:col-span-2' : ''

			                return (
			                  <Card
			                    key={`${slot.presetId}-${idx}`}
			                    className={`bg-black/20 border border-white/10 ${cardSpan}`}
			                  >
			                    <CardHeader className="space-y-2">
			                      <div className="flex items-center gap-2">
			                        <Select
			                          value={slot.presetId}
			                          onValueChange={(v) => {
			                            const nextId = v as any
			                            const nextPreset = presetSupports(nextId)
			                            const nextView = nextPreset?.defaultView || presetViewOptions(nextId)[0]
			                            setChartSlot(idx, { presetId: nextId, view: nextView as any })
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

			                        {preset.supportsTopN ? (
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
			                    </CardHeader>
			                    <CardContent>
			                      {renderChart({ ...slot, view, metric, topN }, { height })}
			                    </CardContent>
			                  </Card>
			                )
			              })}
			            </div>
			            <div className="text-xs text-blue-200/60">
			              Dica: use o período acima ({overviewPeriod}) e “Recarregar” para atualizar os dados.
			            </div>

		              <Card className="bg-black/20 border border-white/10">
		                <CardHeader>
		                  <CardTitle className="text-white text-base">ROI (perdas & risco)</CardTitle>
		                </CardHeader>
		                <CardContent className="space-y-1">
	                  <div className="text-sm text-blue-100/80">
	                    Expirados: <span className="font-mono">{overviewRoi?.perdas?.itensExpirados ?? '-'}</span> •{' '}
	                    {overviewRoi?.perdas?.valorExpirado != null ? fmtMoneyBRL(Number(overviewRoi.perdas.valorExpirado) || 0) : '-'}
	                  </div>
	                  <div className="text-sm text-blue-100/80">
	                    Vencendo: <span className="font-mono">{overviewRoi?.perdas?.itensVencendo ?? '-'}</span> •{' '}
	                    {overviewRoi?.perdas?.valorRiscoVencendo != null
	                      ? fmtMoneyBRL(Number(overviewRoi.perdas.valorRiscoVencendo) || 0)
	                      : '-'}
	                  </div>
	                  <div className="text-sm text-blue-100/80">
	                    Rupturas (estoque 0): <span className="font-mono">{overviewRoi?.ruptura?.itensRuptura ?? '-'}</span>
	                  </div>
		                  <div className="text-xs text-blue-200/60 mt-2">Use “Movimentações” para filtrar por data.</div>
		                </CardContent>
		              </Card>
			      </div>

		      <Dialog
		        open={editOpen}
		        onOpenChange={(v) => {
		          setEditOpen(v)
		          if (!v) setEditTarget(null)
		        }}
		      >
		        <DialogContent className="max-w-2xl">
		          <DialogHeader>
		            <DialogTitle>Editar insumo</DialogTitle>
		            <DialogDescription>
		              {editTarget?.produto || '-'} • <span className="font-mono">{editTarget?.codigoBarras || '-'}</span>
		              {editTarget?.registro ? <span> • Reg {editTarget.registro}</span> : null}
		            </DialogDescription>
		          </DialogHeader>

		          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
		            <div>
		              <div className="text-xs text-muted-foreground mb-1">Código de barras</div>
		              <Input value={editCodigo} onChange={(e) => setEditCodigo(e.target.value)} placeholder="789..." />
		            </div>
		            <div className="md:col-span-2">
		              <div className="text-xs text-muted-foreground mb-1">Produto</div>
		              <Input value={editProduto} onChange={(e) => setEditProduto(e.target.value)} placeholder="Nome do produto" />
		            </div>
		            <div>
		              <div className="text-xs text-muted-foreground mb-1">Categoria</div>
		              <Input value={editCategoria} onChange={(e) => setEditCategoria(e.target.value)} placeholder="ex: Anestésicos" list="edit-insumos-categorias" />
		              <datalist id="edit-insumos-categorias">
		                {lotCategorias.map((c) => (
		                  <option key={c} value={c} />
		                ))}
		              </datalist>
		            </div>
		            <div>
		              <div className="text-xs text-muted-foreground mb-1">Marca</div>
		              <Input value={editMarca} onChange={(e) => setEditMarca(e.target.value)} placeholder="ex: Galderma" list="edit-insumos-marcas" />
		              <datalist id="edit-insumos-marcas">
		                {insumosMarcas.map((m) => (
		                  <option key={m} value={m} />
		                ))}
		              </datalist>
		            </div>
		            <div>
		              <div className="text-xs text-muted-foreground mb-1">Unidade (medida)</div>
		              <Input value={editTipoUnidade} onChange={(e) => setEditTipoUnidade(e.target.value)} placeholder="ex: Frasco" list="insumos-tipos-unidade" />
		              <datalist id="insumos-tipos-unidade">
		                {insumosTiposUnidade.map((t) => (
		                  <option key={t} value={t} />
		                ))}
		              </datalist>
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
		              <Input value={editLote} onChange={(e) => setEditLote(e.target.value)} placeholder="ex: L2026-01" />
		            </div>
		            <div>
		              <div className="text-xs text-muted-foreground mb-1">Validade (DD/MM/AAAA)</div>
		              <Input value={editDataValidade} onChange={(e) => setEditDataValidade(e.target.value)} placeholder="ex: 31/12/2026" />
		            </div>
		          </div>

		          <details className="mt-2 rounded-lg border border-white/10 bg-black/10 p-3">
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
		                <div className="text-xs text-muted-foreground mb-1">Fonte</div>
		                <Input value={editFonte} onChange={(e) => setEditFonte(e.target.value)} placeholder="ex: Tabela 2025" />
		              </div>
		            </div>
		          </details>

		          <DialogFooter>
		            <Button variant="secondary" onClick={() => setEditOpen(false)} disabled={editSaving}>
		              Cancelar
		            </Button>
		            <Button variant="destructive" onClick={deleteEdit} disabled={editSaving || !isAuthed}>
		              Excluir
		            </Button>
		            <Button onClick={saveEdit} disabled={editSaving || !isAuthed}>
		              {editSaving ? 'Salvando…' : 'Salvar'}
		            </Button>
		          </DialogFooter>
		        </DialogContent>
		      </Dialog>

		      <Dialog open={lotDialogOpen} onOpenChange={setLotDialogOpen}>
		        <DialogContent className="max-w-xl">
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
	                {lotSelecionado.fonte ? (
	                  <div>
	                    <div className="text-xs text-muted-foreground">Fonte</div>
	                    <div className="text-blue-100/80 truncate">{lotSelecionado.fonte}</div>
	                  </div>
	                ) : null}
	              </div>
	            </div>
	          ) : null}

	          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
	            <div>
	              <div className="text-xs text-muted-foreground mb-1">Lote</div>
	              <Input value={lotEditLote} onChange={(e) => setLotEditLote(e.target.value)} placeholder="ex: 2026-01A" />
	            </div>
	            <div>
		              <div className="text-xs text-muted-foreground mb-1">Validade (DD/MM/AAAA)</div>
		              <Input value={lotEditValidade} onChange={(e) => setLotEditValidade(e.target.value)} placeholder="ex: 31/12/2026" />
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

		      <div ref={insumosSectionRef} className="max-w-6xl mx-auto space-y-3">
		        <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
		          <div>
		            <div className="text-white text-lg font-semibold">Insumos</div>
		            <div className="text-sm text-blue-100/70">Cadastro, estoque e ações rápidas.</div>
		          </div>
		          <div className="flex flex-wrap items-center gap-2">
		            {offlineQueueCount > 0 ? (
		              <Button variant="outline" size="sm" onClick={() => setOfflineDialogOpen(true)} disabled={!isAuthed}>
		                Pendências <span className="ml-2 font-mono">{offlineQueueCount}</span>
		              </Button>
		            ) : null}
		          </div>
		        </div>

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
                      <div className="truncate">
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
                              <span key={`${item.id}-${idx}`} className="truncate">
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
                  <Button variant="secondary" onClick={() => void refreshInsumos({ pagina: 1 })} disabled={insumosLoading || !isAuthed}>
                    {insumosLoading ? 'Carregando…' : 'Recarregar'}
                  </Button>
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
	              {insumosMode === 'paged' ? (
	                <div className="flex flex-wrap items-center justify-between gap-2">
	                  <div className="text-xs text-blue-200/60">
	                    Página <span className="font-mono">{insumosPagina}</span>
	                    {insumosTotal != null ? (
	                      <>
	                        {' '}
	                        de <span className="font-mono">{Math.max(1, Math.ceil(insumosTotal / insumosLimite))}</span>
	                      </>
	                    ) : null}
	                  </div>
	                  <div className="flex flex-wrap items-center gap-2">
	                    <div className="w-40">
	                      <Select
	                        value={String(insumosLimite)}
	                        onValueChange={(v) => {
	                          const lim = Math.max(1, Math.min(1000, parseInt(String(v), 10) || 200))
	                          setInsumosLimite(lim)
	                          void refreshInsumos({ pagina: 1 })
	                        }}
	                      >
	                        <SelectTrigger className="h-9">
	                          <SelectValue />
	                        </SelectTrigger>
	                        <SelectContent>
	                          <SelectItem value="50">50</SelectItem>
	                          <SelectItem value="100">100</SelectItem>
	                          <SelectItem value="200">200</SelectItem>
	                          <SelectItem value="400">400</SelectItem>
	                        </SelectContent>
	                      </Select>
	                    </div>
	                    <Button
	                      variant="outline"
	                      onClick={() => void refreshInsumos({ pagina: Math.max(1, insumosPagina - 1) })}
	                      disabled={insumosLoading || !isAuthed || insumosPagina <= 1}
	                    >
	                      Anterior
	                    </Button>
	                    <Button
	                      variant="secondary"
	                      onClick={() => void refreshInsumos({ pagina: insumosPagina + 1 })}
	                      disabled={
	                        insumosLoading ||
	                        !isAuthed ||
	                        (insumosTotal != null ? insumosPagina >= Math.max(1, Math.ceil(insumosTotal / insumosLimite)) : filteredInsumos.length < insumosLimite)
	                      }
	                    >
	                      Próxima
	                    </Button>
	                    {insumosTotal != null && insumosTotal <= INSUMOS_PAGED_THRESHOLD && !insumosFull.length ? (
	                      <Button
	                        variant="outline"
	                        onClick={() => void loadInsumosFull()}
	                        disabled={insumosLoading || !isAuthed}
	                      >
	                        Carregar tudo
	                      </Button>
	                    ) : null}
	                  </div>
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
                          {createScanOpen ? 'Fechar' : 'Scan'}
                        </Button>
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
	                      <Input
	                        value={createTipoUnidade}
	                        onChange={(e) => setCreateTipoUnidade(e.target.value)}
	                        placeholder="ex: Frasco"
	                        list="insumos-tipos-unidade"
	                      />
	                      <datalist id="insumos-tipos-unidade">
	                        {insumosTiposUnidade.map((u) => (
	                          <option key={u} value={u} />
	                        ))}
	                      </datalist>
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
	                      <div className="text-xs text-blue-200/70 mb-1">Data validade</div>
	                      <Input
	                        value={createDataValidade}
	                        onChange={(e) => setCreateDataValidade(e.target.value)}
	                        placeholder={createNovoLote ? 'recomendado (DD/MM/AAAA)' : 'DD/MM/AAAA'}
	                      />
	                    </div>
	                  </div>

	                  <details className="rounded-lg border border-white/10 bg-black/10 p-3">
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
	                        <div className="text-xs text-blue-200/70 mb-1">Fonte</div>
	                        <Input
	                          value={createFonte}
	                          onChange={(e) => setCreateFonte(e.target.value)}
	                          placeholder="ex: Tabela 2025"
	                        />
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
                        if (createNovoLote && !createLote.trim()) return toast.error('Informe o lote (Novo lote: on)')
                        const existing = (insumos || []).find((i) => String(i.codigoBarras || '').trim() === codigoBarras)
                        const produto = createProduto.trim() || (createNovoLote ? String(existing?.produto || '').trim() : '')
                        if (!produto) return toast.error('Informe o produto')

                        setCreateLoading(true)
                        try {
                          await mutateJson(`/insumos?unidade=${encodeURIComponent(unidade)}`, {
                            method: 'POST',
                            queueLabel: 'Cadastro de insumo',
                            body: {
                              codigoBarras,
                              produto,
                              allowDuplicateLot: createNovoLote,
	                              categoria: createCategoria.trim(),
	                              marca: createMarca.trim(),
	                              tipoUnidade: createTipoUnidade.trim(),
	                              especificacao: createEspecificacao.trim(),
	                              concentracao: createConcentracao.trim(),
	                              volume: createVolume.trim(),
	                              fonte: createFonte.trim(),
	                              calibre: createCalibre.trim(),
	                              precoCusto: createPrecoCusto.trim(),
	                              estoqueInicial: Number(createEstoqueInicial) || 0,
	                              estoqueMinimo: Number(createEstoqueMinimo) || 0,
	                              lote: createLote.trim(),
	                              dataValidade: dateInputToIso(createDataValidade)
                            }
                          })
                          toast.success('Insumo cadastrado')
                          setCreateCodigo('')
                          setCreateProduto('')
                          setCreateCategoria('')
	                          setCreateMarca('')
	                          setCreateTipoUnidade('')
	                          setCreateEspecificacao('')
	                          setCreateConcentracao('')
	                          setCreateVolume('')
	                          setCreateFonte('')
	                          setCreateCalibre('')
	                          setCreatePrecoCusto('')
	                          setCreateEstoqueInicial('0')
	                          setCreateEstoqueMinimo('5')
                          setCreateLote('')
                          setCreateDataValidade('')
                          setCreateNovoLote(false)
                          setCreateOpen(false)
                          await refreshInsumos({ pagina: 1 })
                        } catch (e) {
                          const status = (e as any)?.status
                          const msg = e instanceof Error ? e.message : String(e)
                          if (status === 409 && /código de barras já cadastrado/i.test(msg)) {
                            setCreateNovoLote(true)
                            toast.error('Código já existe. Ative “Novo lote” e informe Lote/Validade para cadastrar um lote adicional.')
                            return
                          }
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

              <div className="overflow-auto max-h-[60vh] rounded-xl border border-white/10">
                <table className="min-w-full text-sm">
                  <thead className="bg-black/30 text-blue-100/80">
                    <tr>
                      <th className="text-left p-3">Produto</th>
                      <th className="text-left p-3">Categoria</th>
                      <th className="text-left p-3">Código</th>
                      <th className="text-right p-3">Estoque</th>
                      <th className="text-right p-3">Mínimo</th>
                      <th className="text-left p-3">Validade</th>
                      <th className="text-right p-3">Valor</th>
                      <th className="text-right p-3">Ações</th>
                    </tr>
                  </thead>
	                  <tbody className="divide-y divide-white/5">
	                    {filteredInsumos.map((i) => {
	                      const estoque = Number(i.estoqueAtual) || 0
	                      const min = Number(i.estoqueMinimo) || 0
	                      const stockStatus = min > 0 ? calcularStatusEstoque(estoque, min) : 'OK'
	                      const isCritico = min > 0 && stockStatus === 'URGENTE'
	                      const isLowStock = min > 0 && stockStatus === 'ATENCAO'
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
	                        <tr key={`${i.registro || ''}-${i.codigoBarras || ''}`} className="hover:bg-white/5">
	                          <td className="p-3">
	                            <div className="text-blue-50">{i.produto || '-'}</div>
	                            <div className="text-xs text-blue-200/60">{i.marca || ''}</div>
	                            {isCritico || isLowStock || isVencendo || isExpirado ? (
	                              <div className="mt-1 flex flex-wrap gap-1">
	                                {isCritico ? <Badge variant="destructive">Críticos</Badge> : null}
	                                {isLowStock ? <Badge variant="secondary">Estoque baixo</Badge> : null}
	                                {isVencendo ? <Badge variant="secondary">Vencendo</Badge> : null}
	                                {isExpirado ? <Badge variant="destructive">Expirado</Badge> : null}
	                              </div>
	                            ) : null}
	                          </td>
                          <td className="p-3 text-blue-100/80">
                            <div className="flex items-center gap-2">
                              <span
                                className="inline-block h-2.5 w-2.5 rounded-full"
                                style={{ backgroundColor: getCategoriaBgColor(i.categoria || 'Outros') }}
                              />
                              <span className="truncate">{i.categoria || '-'}</span>
                            </div>
                          </td>
                          <td className="p-3">
                            <div className="font-mono text-blue-100/80">{i.codigoBarras || '-'}</div>
                          </td>
	                          <td className={`p-3 text-right ${isCritico ? 'text-red-200' : 'text-blue-100/80'}`}>
	                            <div className="flex items-center justify-end gap-2">
	                              <span className="font-mono">{estoque}</span>
	                            </div>
	                            {otherSummary ? <div className="mt-1 text-[11px] text-blue-200/50">{otherSummary}</div> : null}
	                          </td>
	                          <td className="p-3 text-right text-blue-100/70">{min || '-'}</td>
	                          <td className="p-3">
	                            <span className="text-blue-100/70">{fmtDateOnlyBR(i.dataValidade || '')}</span>
	                          </td>
                          <td className="p-3 text-right text-blue-100/80">{fmtMoneyBRL(valor)}</td>
	                          <td className="p-3 text-right">
	                            <div className="flex items-center justify-end gap-2">
	                              <Button
	                                variant="secondary"
	                                className="h-8 px-2 text-xs"
	                                onClick={() => {
	                                  if (i.codigoBarras) setQuickCodigo(i.codigoBarras)
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
                          {insumosLoading ? 'Carregando…' : isAuthed ? 'Sem itens.' : 'Faça login para carregar.'}
                        </td>
                      </tr>
                    ) : null}
                  </tbody>
                </table>
              </div>
		      </div>

		      <div ref={movSectionRef} className="max-w-6xl mx-auto space-y-3">
		        <div>
		          <div className="text-white text-lg font-semibold">Movimentações</div>
		          <div className="text-sm text-blue-100/70">Histórico operacional (entradas, saídas, ajustes e transferências).</div>
		        </div>

			              <div className="flex flex-wrap items-end gap-2">
			                <div className="w-48">
			                  <div className="text-xs text-blue-200/70 mb-1">Tipo</div>
		                  <Select value={movTipo} onValueChange={(v) => setMovTipo(v as any)}>
	                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="TODOS">Todos</SelectItem>
                      <SelectItem value="ENTRADA">Entrada</SelectItem>
                      <SelectItem value="SAÍDA">Saída</SelectItem>
                      <SelectItem value="AJUSTE">Ajuste</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="w-48">
                  <div className="text-xs text-blue-200/70 mb-1">De</div>
	                  <Input value={movDe} onChange={(e) => setMovDe(e.target.value)} placeholder="DD/MM/AAAA" />
                </div>
                <div className="w-48">
                  <div className="text-xs text-blue-200/70 mb-1">Até</div>
	                  <Input value={movAte} onChange={(e) => setMovAte(e.target.value)} placeholder="DD/MM/AAAA" />
                </div>
				                <div className="w-40">
				                  <div className="text-xs text-blue-200/70 mb-1">Por página</div>
				                  <Select
				                    value={String(movLimite)}
				                    onValueChange={(v) => {
				                      const lim = Math.max(1, Math.min(200, parseInt(String(v), 10) || 50))
				                      void loadMovimentacoes({ pagina: 1, limite: lim })
				                    }}
				                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="25">25</SelectItem>
                      <SelectItem value="50">50</SelectItem>
                      <SelectItem value="100">100</SelectItem>
                      <SelectItem value="200">200</SelectItem>
				                    </SelectContent>
				                  </Select>
				                </div>
				                <div className="flex items-center gap-2">
				                  <Button
				                    variant={movGroupTransfers ? 'secondary' : 'outline'}
				                    onClick={() => setMovGroupTransfers((v) => !v)}
				                    disabled={movTipo !== 'TODOS'}
				                    title={movTipo !== 'TODOS' ? 'Disponível apenas quando Tipo = Todos' : 'Agrupa entrada/saída de transferências em uma linha'}
				                  >
				                    Agrupar transferências
				                  </Button>
				                </div>
				                <Button
				                  variant="secondary"
				                  onClick={() => void Promise.allSettled([loadMovimentacoes(), loadInsights()])}
				                  disabled={movLoading || !isAuthed}
				                >
			                  {movLoading ? 'Carregando…' : 'Filtrar'}
			                </Button>
			              </div>

			              <details className="rounded-xl border border-white/10 bg-black/10 p-3">
			                <summary className="cursor-pointer select-none text-sm text-blue-100/80">
			                  Giro por categoria (saídas){' '}
			                  <span className="text-xs text-blue-200/60">
			                    • {Array.isArray(insightsTurnover?.categories) ? `${insightsTurnover.categories.length} categorias` : insightsLoading ? 'Carregando…' : '—'}
			                  </span>
			                </summary>
			                <div className="mt-3 space-y-2">
			                  {Array.isArray(insightsTurnover?.categories) && insightsTurnover.categories.length ? (
			                    <div className="overflow-auto max-h-[60vh] rounded-xl border border-white/10">
			                      <table className="min-w-full text-sm">
			                        <thead className="bg-black/30 text-blue-100/80">
			                          <tr>
			                            <th className="text-left p-3">Categoria</th>
			                            <th className="text-right p-3">Qtd</th>
			                            <th className="text-right p-3">Valor</th>
			                          </tr>
			                        </thead>
			                        <tbody className="divide-y divide-white/5">
			                          {(insightsTurnover.categories || []).slice(0, 12).map((c: any, idx: number) => (
			                            <tr key={`${c.categoria || ''}-${idx}`} className="hover:bg-white/5">
			                              <td className="p-3 text-blue-50">{c.categoria || 'Outros'}</td>
			                              <td className="p-3 text-right text-blue-100/80">{Number(c.qtd || 0).toFixed(0)}</td>
			                              <td className="p-3 text-right text-blue-100/80">{fmtMoneyBRL(Number(c.valor || 0))}</td>
			                            </tr>
			                          ))}
			                        </tbody>
			                      </table>
			                    </div>
			                  ) : (
			                    <div className="text-sm text-blue-100/70">{insightsLoading ? 'Carregando…' : 'Sem dados para o período.'}</div>
			                  )}
			                  <div className="text-xs text-blue-200/60">
			                    Usa os filtros desta seção (De/Até) e o período da Visão geral ({overviewPeriod}).
			                  </div>
			                </div>
			              </details>

			              <div className="flex items-center justify-end">
			                <Button
			                  variant="outline"
			                  size="sm"
			                  onClick={() => {
			                    const deIso = dateInputToIso(movDe)
			                    const ateIso = dateInputToIso(movAte)
			                    const params = new URLSearchParams({
			                      unidade,
			                      ...(movTipo !== 'TODOS' ? { tipo: movTipo } : {}),
			                      ...(deIso ? { de: deIso } : {}),
			                      ...(ateIso ? { ate: ateIso } : {})
			                    })
			                    window.open(`/api/insumos/export/movimentacoes.csv?${params.toString()}`, '_blank', 'noopener,noreferrer')
			                  }}
			                  disabled={!isAuthed}
			                >
			                  Exportar CSV
			                </Button>
			              </div>

		              <div className="flex flex-wrap items-center justify-between gap-2 text-sm text-blue-100/70">
		                <div>
		                  Página <span className="font-mono">{movPagina}</span>
                  {movTotal != null ? (
                    <>
                      {' '}
                      de <span className="font-mono">{Math.max(1, Math.ceil(movTotal / movLimite))}</span> • total{' '}
                      <span className="font-mono">{movTotal}</span>
                    </>
                  ) : null}
                </div>
                <div className="flex items-center gap-2">
                  <Button
                    variant="outline"
                    onClick={() => void loadMovimentacoes({ pagina: Math.max(1, movPagina - 1) })}
                    disabled={movLoading || !isAuthed || movPagina <= 1}
                  >
                    Anterior
                  </Button>
                  <Button
                    variant="secondary"
                    onClick={() => void loadMovimentacoes({ pagina: movPagina + 1 })}
                    disabled={
                      movLoading ||
                      !isAuthed ||
                      (movTotal != null ? movPagina >= Math.max(1, Math.ceil(movTotal / movLimite)) : movimentacoes.length < movLimite)
                    }
                  >
                    Próxima
                  </Button>
                </div>
              </div>

			              <div className="overflow-auto max-h-[60vh] rounded-xl border border-white/10">
			                <table className="min-w-full text-sm">
                  <thead className="bg-black/30 text-blue-100/80">
                    <tr>
                      <th className="text-left p-3">Data</th>
                      <th className="text-left p-3">Tipo</th>
                      <th className="text-left p-3">Produto</th>
                      <th className="text-left p-3">Código</th>
                      <th className="text-right p-3">Qtd</th>
                      <th className="text-left p-3">Unidade</th>
                      <th className="text-left p-3">Usuário</th>
                      <th className="text-left p-3">Detalhe</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-white/5">
	                    {movimentacoesView.map((m, idx) => (
	                      <tr key={`${m.dataHora || ''}-${idx}`} className="hover:bg-white/5">
	                        <td className="p-3 text-blue-100/70">{fmtDate(m.dataHora)}</td>
	                        <td className="p-3 text-blue-100/80">{m.tipo || '-'}</td>
	                        <td className="p-3 text-blue-50">{m.produto || '-'}</td>
	                        <td className="p-3 font-mono text-blue-100/70">{m.codigoBarras || '-'}</td>
	                        <td className="p-3 text-right text-blue-100/80">{m.quantidade ?? '-'}</td>
	                        <td className="p-3 text-blue-100/70">
	                          {m.transferId
	                            ? `${m.unidadeOrigem ? unidadeLabel(m.unidadeOrigem) : '-'} → ${m.unidadeDestino ? unidadeLabel(m.unidadeDestino) : '-'}`
	                            : (m.unidade ? unidadeLabel(m.unidade) : '-')}
	                        </td>
	                        <td className="p-3 text-blue-100/70">{m.usuario || '-'}</td>
	                        <td className="p-3 text-blue-100/60">
                          <div className="space-y-1">
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
                      </tr>
                    ))}
	                    {!movimentacoesView.length ? (
	                      <tr>
	                        <td className="p-3 text-blue-100/70" colSpan={8}>
	                          {movLoading ? 'Carregando…' : isAuthed ? 'Sem movimentações.' : 'Faça login para carregar.'}
	                        </td>
	                      </tr>
	                    ) : null}
                  </tbody>
                </table>
			              </div>
		      </div>
	    </div>
	  )
}
