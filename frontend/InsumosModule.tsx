import React from 'react'
import { toast } from 'sonner'
import { Badge } from '@/badge'
import { Button } from '@/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/card'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/dialog'
import { Input } from '@/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/select'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/tabs'
import { Bar, BarChart, CartesianGrid, Cell, Legend, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'

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

type StockDistributionItem = { name?: string; value?: number }

type MovReport = {
  resumo?: { totalEntradas?: number; totalSaidas?: number; totalMovimentacoes?: number }
  movimentos?: Movimentacao[]
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
  if (status === 'URGENTE') return 'Urgente'
  if (status === 'ATENCAO') return 'Atenção'
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

  throw new Error(message)
}

export function InsumosModule() {
  type InsumosTab = 'insumos' | 'lotes' | 'mov' | 'insights'

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

  const [activeTab, setActiveTab] = React.useState<InsumosTab>('insumos')

  const [quickOp, setQuickOp] = React.useState<'ENTRADA' | 'BAIXA' | 'TRANSFERENCIA' | null>(null)
  const [quickCodigo, setQuickCodigo] = React.useState('')
  const [quickScanOpen, setQuickScanOpen] = React.useState(false)
  const [quickQuantidade, setQuickQuantidade] = React.useState('1')
  const [quickNovoEstoque, setQuickNovoEstoque] = React.useState('')
  const [quickObs, setQuickObs] = React.useState('')
  const [quickMotivo, setQuickMotivo] = React.useState('Ajuste manual')
  const [quickActionLoading, setQuickActionLoading] = React.useState(false)
  const quickSectionRef = React.useRef<HTMLDivElement | null>(null)
  const overviewSectionRef = React.useRef<HTMLDivElement | null>(null)
  const [sharePayload, setSharePayload] = React.useState<SharePayload | null>(null)
  const [shareHidden, setShareHidden] = React.useState(false)
  const [shareSourceId, setShareSourceId] = React.useState<string | null>(null)
  const [shareHistory, setShareHistory] = React.useState<ShareHistoryItem[]>([])
  const [shareLoading, setShareLoading] = React.useState(false)
  const [shareHistoryLoading, setShareHistoryLoading] = React.useState(false)
  const shareLoggedRef = React.useRef<string>('')
  const shareSyncedRef = React.useRef<Set<string>>(new Set())

  const [insumos, setInsumos] = React.useState<Insumo[]>([])
  const [insumosLoading, setInsumosLoading] = React.useState(false)
  const [insumosQuery, setInsumosQuery] = React.useState('')
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
  const [createLoading, setCreateLoading] = React.useState(false)

  const [lotFiltroCategoria, setLotFiltroCategoria] = React.useState('')
  const [lotFiltroValidade, setLotFiltroValidade] = React.useState<'TODOS' | 'OK' | 'VENCENDO' | 'EXPIRADO' | 'SEM_VALIDADE'>('TODOS')
  const [lotBusca, setLotBusca] = React.useState('')
  const [lotDialogOpen, setLotDialogOpen] = React.useState(false)
  const [lotSelecionado, setLotSelecionado] = React.useState<Insumo | null>(null)
  const [lotEditLote, setLotEditLote] = React.useState('')
  const [lotEditValidade, setLotEditValidade] = React.useState('')
  const [lotSaving, setLotSaving] = React.useState(false)

  const [movimentacoes, setMovimentacoes] = React.useState<Movimentacao[]>([])
  const [movLoading, setMovLoading] = React.useState(false)
  const [movTipo, setMovTipo] = React.useState<'TODOS' | 'ENTRADA' | 'SAÍDA' | 'AJUSTE'>('TODOS')
  const [movDe, setMovDe] = React.useState('')
  const [movAte, setMovAte] = React.useState('')
  const [movPagina, setMovPagina] = React.useState(1)
  const [movLimite, setMovLimite] = React.useState(50)
  const [movTotal, setMovTotal] = React.useState<number | null>(null)

  const movChartData = React.useMemo(() => {
    const map = new Map<string, { day: string; entradas: number; saidas: number }>()
    for (const m of movimentacoes) {
      const raw = String(m.dataHora || '').slice(0, 10)
      if (!raw || raw.length !== 10) continue
      const cur = map.get(raw) || { day: raw, entradas: 0, saidas: 0 }
      const tipo = String(m.tipo || '').toUpperCase().replace('Í', 'I')
      const qtd = Number(m.quantidade) || 0
      if (tipo === 'ENTRADA') cur.entradas += qtd
      else if (tipo === 'SAIDA' || tipo === 'SAÍDA') cur.saidas += qtd
      map.set(raw, cur)
    }
    return Array.from(map.values()).sort((a, b) => a.day.localeCompare(b.day))
  }, [movimentacoes])

  // Backups/auditoria foram movidos para o módulo Status do sistema.

  const [overviewLoading, setOverviewLoading] = React.useState(false)
  const [overviewResumo, setOverviewResumo] = React.useState<EstoqueResumo | null>(null)
  const [overviewNotifications, setOverviewNotifications] = React.useState<NotificationsSummary | null>(null)
  const [overviewActionables, setOverviewActionables] = React.useState<Actionables | null>(null)
  const [overviewPeriod, setOverviewPeriod] = React.useState<'7d' | '30d' | '90d' | '1y'>('30d')
  const [overviewRoi, setOverviewRoi] = React.useState<RoiInsights | null>(null)
  const [overviewQuality, setOverviewQuality] = React.useState<QualityReport | null>(null)
  const [overviewStockDist, setOverviewStockDist] = React.useState<StockDistributionItem[]>([])
  const [overviewMovResumo, setOverviewMovResumo] = React.useState<{ entradaQtd: number; saidaQtd: number; entradaValor: number; saidaValor: number; saldoLiquido: number } | null>(null)
  const [overviewMovSeries, setOverviewMovSeries] = React.useState<Array<{ day: string; entrada: number; saida: number }>>([])

  const [insightsLoading, setInsightsLoading] = React.useState(false)
  const [insightsAlertas, setInsightsAlertas] = React.useState<EstoqueAlerta[]>([])
  const [insightsRoi, setInsightsRoi] = React.useState<RoiInsights | null>(null)
  const [insightsQuality, setInsightsQuality] = React.useState<QualityReport | null>(null)
  const [insightsStockDist, setInsightsStockDist] = React.useState<StockDistributionItem[]>([])
  const [insightsMovReport, setInsightsMovReport] = React.useState<MovReport | null>(null)
  const [insightsTrends, setInsightsTrends] = React.useState<any | null>(null)
  const [insightsTurnover, setInsightsTurnover] = React.useState<any | null>(null)
  const [qrText, setQrText] = React.useState('')
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

  const canUseApi = !!health?.ok && !!health?.sheetsConfigured
  const isAuthed = !!user?.username
  const allowedUnits = Array.isArray(user?.allowedUnits) ? user!.allowedUnits!.filter(Boolean) : []

  const allUnidades = React.useMemo(() => {
    const fromHealth = Array.isArray(health?.unidades) ? health!.unidades!.filter(Boolean) : []
    return fromHealth.length ? fromHealth : ['novo-hamburgo', 'barra-shopping-sul']
  }, [Array.isArray(health?.unidades) ? health!.unidades!.join('|') : ''])

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
    const mapTab = (raw: string | null): 'overview' | InsumosTab | null => {
      const value = String(raw || '')
        .trim()
        .toLowerCase()
      if (!value) return null
      if (['overview', 'resumo', 'dashboard'].includes(value)) return 'overview'
      if (['insumos', 'cadastro', 'cadastrar', 'novo'].includes(value)) return 'insumos'
      if (['lotes', 'validade', 'lotes-validade'].includes(value)) return 'lotes'
      if (['mov', 'movimentacoes', 'historico', 'histórico'].includes(value)) return 'mov'
      if (['insights', 'alertas'].includes(value)) return 'insights'
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
      if (requestedTab === 'overview') {
        setTimeout(() => {
          overviewSectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
        }, 250)
      } else if (requestedTab) {
        setActiveTab(requestedTab)
      }

      const action = String(
        params.get('insumosAction') || params.get('action') || params.get('type') || params.get('tipo') || ''
      ).trim()
      const actionLabel = action ? mapActionLabel(action) : null
      const wantsCadastro = params.get('cadastro') === '1' || actionLabel === 'Cadastro'
      const wantsScanner = params.get('scanner') === '1' || actionLabel === 'Scanner'
      const wantsQuickAction = ['Entrada', 'Saída', 'Ajuste', 'Transferência'].includes(actionLabel || '')

      if (wantsCadastro) {
        setActiveTab('insumos')
        setCreateOpen(true)
      }

      if (wantsScanner) {
        setQuickScanOpen(true)
      }

      if (wantsQuickAction) {
        if (actionLabel === 'Entrada') setQuickOp('ENTRADA')
        else if (actionLabel === 'Saída') setQuickOp('BAIXA')
        else if (actionLabel === 'Transferência') setQuickOp('TRANSFERENCIA')
        setTimeout(() => {
          quickSectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
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
        setActiveTab('insumos')
        setCreateOpen(true)
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
    setActiveTab('insumos')
    setCreateOpen(true)
    setSharePayload(payload)
    setShareSourceId(payload.id || null)
    setShareHidden(false)
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
    setLotEditValidade(i.dataValidade ? String(i.dataValidade) : '')
    setLotDialogOpen(true)
  }, [])

  const loadInsumos = React.useCallback(async () => {
    if (!canUseApi || !isAuthed) return
    setInsumosLoading(true)
    try {
      const out = await apiJson<{ success?: boolean; data?: Insumo[] }>(`/insumos?unidade=${encodeURIComponent(unidade)}`)
      setInsumos(Array.isArray(out?.data) ? out.data : [])
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e))
      setInsumos([])
    } finally {
      setInsumosLoading(false)
    }
  }, [canUseApi, isAuthed, unidade])

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
      if (movDe) params.set('de', movDe)
      if (movAte) params.set('ate', movAte)
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
      const [estoque, notif, act, roi, quality, dist, movs] = await Promise.all([
        apiJson<{ success?: boolean; data?: { resumo?: EstoqueResumo } }>(`/relatorios/estoque?${params}`),
        apiJson<{ success?: boolean; data?: NotificationsSummary }>(`/notifications/summary?${params}`),
        apiJson<{ success?: boolean; data?: Actionables }>(`/analytics/actionables?${params}`),
        apiJson<{ success?: boolean; data?: RoiInsights }>(`/analytics/roi?${params}`),
        apiJson<{ success?: boolean; data?: QualityReport }>(`/quality/report?${new URLSearchParams({ unidade, limitIssues: '120' }).toString()}`),
        apiJson<StockDistributionItem[]>(`/analytics/stock-distribution?${params}`),
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
      setOverviewStockDist(Array.isArray(dist) ? dist : [])

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

      const byDay = new Map<string, { day: string; entrada: number; saida: number }>()
      for (const m of list) {
        const d = new Date(m.dataHora || '')
        if (Number.isNaN(d.getTime())) continue
        const day = d.toISOString().slice(0, 10)
        const cur = byDay.get(day) || { day, entrada: 0, saida: 0 }
        const t = String(m.tipo || '').toUpperCase().replace('Í', 'I')
        if (t === 'ENTRADA') cur.entrada += Number(m.quantidade) || 0
        else if (t === 'SAIDA' || t === 'SAÍDA') cur.saida += Number(m.quantidade) || 0
        byDay.set(day, cur)
      }
      setOverviewMovSeries(Array.from(byDay.values()).sort((a, b) => a.day.localeCompare(b.day)).slice(-30))
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e))
      setOverviewResumo(null)
      setOverviewNotifications(null)
      setOverviewActionables(null)
      setOverviewRoi(null)
      setOverviewQuality(null)
      setOverviewStockDist([])
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
      await mutateJson<{ success?: boolean }>(`/insumos/${encodeURIComponent(lotSelecionado.registro)}?unidade=${encodeURIComponent(unidade)}`, {
        method: 'PUT',
        body: { lote: lotEditLote.trim(), dataValidade: lotEditValidade.trim() || '' },
        queueLabel: 'Atualização de lote/validade'
      })
      toast.success('Lote/validade atualizados.')
      setLotDialogOpen(false)
      await Promise.allSettled([loadInsumos(), loadOverview()])
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e))
    } finally {
      setLotSaving(false)
    }
  }, [canUseApi, isAuthed, loadInsumos, loadOverview, lotEditLote, lotEditValidade, lotSelecionado?.registro, mutateJson, unidade])

  const loadInsights = React.useCallback(async () => {
    if (!canUseApi || !isAuthed) return
    setInsightsLoading(true)
    try {
      const base = new URLSearchParams()
      base.set('unidade', unidade)

      const movParams = new URLSearchParams(base.toString())
      movParams.set('limite', '200')
      if (movTipo !== 'TODOS') movParams.set('tipo', movTipo)
      if (movDe) movParams.set('de', movDe)
      if (movAte) movParams.set('ate', movAte)

      const trendsParams = new URLSearchParams(base.toString())
      trendsParams.set('groupBy', 'day')
      trendsParams.set('days', '30')
      if (movDe) trendsParams.set('from', movDe)
      if (movAte) trendsParams.set('to', movAte)

      const turnoverParams = new URLSearchParams(base.toString())
      turnoverParams.set('days', '30')
      turnoverParams.set('mode', 'saida')
      if (movDe) turnoverParams.set('from', movDe)
      if (movAte) turnoverParams.set('to', movAte)

      const [alertas, roi, quality, dist, movReport, trends, turnover] = await Promise.all([
        apiJson<{ success?: boolean; data?: EstoqueAlerta[] }>(`/alertas/estoque?${base.toString()}`),
        apiJson<{ success?: boolean; data?: RoiInsights }>(`/analytics/roi?${base.toString()}`),
        apiJson<{ success?: boolean; data?: QualityReport }>(`/quality/report?${new URLSearchParams({ unidade, limitIssues: '200' }).toString()}`),
        apiJson<StockDistributionItem[]>(`/analytics/stock-distribution?${base.toString()}`),
        apiJson<{ success?: boolean; data?: MovReport }>(`/relatorios/movimentacoes?${movParams.toString()}`),
        apiJson<{ success?: boolean; data?: any }>(`/analytics/trends?${trendsParams.toString()}`),
        apiJson<{ success?: boolean; data?: any }>(`/analytics/category-turnover?${turnoverParams.toString()}`)
      ])

      setInsightsAlertas(Array.isArray(alertas?.data) ? alertas.data : [])
      setInsightsRoi(roi?.data || null)
      setInsightsQuality(quality?.data || null)
      setInsightsStockDist(Array.isArray(dist) ? dist : [])
      setInsightsMovReport(movReport?.data || null)
      setInsightsTrends(trends?.data || null)
      setInsightsTurnover(turnover?.data || null)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e))
      setInsightsAlertas([])
      setInsightsRoi(null)
      setInsightsQuality(null)
      setInsightsStockDist([])
      setInsightsMovReport(null)
      setInsightsTrends(null)
      setInsightsTurnover(null)
    } finally {
      setInsightsLoading(false)
    }
  }, [canUseApi, isAuthed, movAte, movDe, movTipo, unidade])

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
          await mutateJson(`/insumos/ajuste?unidade=${encodeURIComponent(unidade)}`, {
            method: 'POST',
            body: { codigoBarras, novoEstoque, motivo: quickMotivo, observacoes: quickObs },
            queueLabel: 'Ajuste'
          })
          toast.success('Ajuste registrado')
        } else {
          const quantidade = Math.max(1, parseInt(quickQuantidade, 10) || 0)
          const path = kind === 'ENTRADA' ? '/insumos/entrada' : '/insumos/baixa'
          await mutateJson(`${path}?unidade=${encodeURIComponent(unidade)}`, {
            method: 'POST',
            body: { codigoBarras, quantidade, observacoes: quickObs },
            queueLabel: kind === 'ENTRADA' ? 'Entrada' : 'Baixa'
          })
          toast.success(kind === 'ENTRADA' ? 'Entrada registrada' : 'Baixa registrada')
        }

        await Promise.allSettled([loadInsumos(), loadMovimentacoes()])
        return true
      } catch (e) {
        toast.error(e instanceof Error ? e.message : String(e))
        return false
      } finally {
        setQuickActionLoading(false)
      }
    },
    [
      canUseApi,
      isAuthed,
      loadInsumos,
      loadMovimentacoes,
      mutateJson,
      quickCodigo,
      quickMotivo,
      quickNovoEstoque,
      quickObs,
      quickQuantidade,
      unidade
    ]
  )

  const runTransfer = React.useCallback(async (): Promise<boolean> => {
    if (!canUseApi || !isAuthed) return
    const codigoBarras = quickCodigo.trim()
    if (!codigoBarras) return toast.error('Informe o código de barras')

    if (transferFrom === transferTo) return toast.error('Origem e destino devem ser diferentes')

    setQuickActionLoading(true)
    try {
      const quantidade = Math.max(1, parseInt(quickQuantidade, 10) || 0)
      await mutateJson(`/insumos/transferir?unidade=${encodeURIComponent(transferFrom)}`, {
        method: 'POST',
        body: {
          codigoBarras,
          quantidade,
          fromUnidade: transferFrom,
          toUnidade: transferTo,
          observacoes: quickObs
        },
        queueLabel: 'Transferência'
      })
      toast.success('Transferência registrada')

      // Refresh what the user is seeing (estoque + movimentações)
      await Promise.allSettled([loadInsumos(), loadMovimentacoes(), loadOverview()])
      return true
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e))
      return false
    } finally {
      setQuickActionLoading(false)
    }
  }, [
    canUseApi,
    isAuthed,
    loadInsumos,
    loadMovimentacoes,
    loadOverview,
    mutateJson,
    quickCodigo,
    quickObs,
    quickQuantidade,
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
    if (!canUseApi || !isAuthed) return
    if (activeTab === 'insumos') {
      void loadInsumos()
      void loadShareHistory()
    }
    if (activeTab === 'lotes') void loadInsumos()
    if (activeTab === 'mov') void loadMovimentacoes()
    if (activeTab === 'insights') void loadInsights()
  }, [activeTab, canUseApi, isAuthed, loadInsumos, loadInsights, loadMovimentacoes, loadShareHistory])

  const filteredInsumos = React.useMemo(() => {
    const q = insumosQuery.trim().toLowerCase()
    if (!q) return insumos
    return insumos.filter((i) => {
      const hay = [i.codigoBarras, i.produto, i.categoria, i.marca, i.lote]
        .filter(Boolean)
        .join(' ')
        .toLowerCase()
      return hay.includes(q)
    })
  }, [insumos, insumosQuery])

  const lotCategorias = React.useMemo(() => {
    return Array.from(new Set((insumos || []).map((i) => String(i.categoria || '').trim()).filter(Boolean))).sort((a, b) =>
      a.localeCompare(b, 'pt-BR', { sensitivity: 'base' })
    )
  }, [insumos])

  const insumosMarcas = React.useMemo(() => {
    return Array.from(new Set((insumos || []).map((i) => String(i.marca || '').trim()).filter(Boolean))).sort((a, b) =>
      a.localeCompare(b, 'pt-BR', { sensitivity: 'base' })
    )
  }, [insumos])

  const insumosTiposUnidade = React.useMemo(() => {
    const fromData = Array.from(
      new Set((insumos || []).map((i) => String(i.tipoUnidade || '').trim()).filter(Boolean))
    ).sort((a, b) => a.localeCompare(b, 'pt-BR', { sensitivity: 'base' }))
    const fixed = ['Frasco', 'Seringa', 'Unidade', 'Caixa', 'ml']
    return Array.from(new Set([...fixed, ...fromData])).filter(Boolean)
  }, [insumos])

  const lotResumo = React.useMemo(() => {
    const base = { ok: 0, vencendo: 0, expirado: 0, sem: 0 }
    for (const i of insumos || []) {
      const st = String(i.statusValidade?.status || '').toUpperCase()
      if (!i.dataValidade) base.sem += 1
      else if (st === 'EXPIRADO') base.expirado += 1
      else if (st === 'VENCENDO') base.vencendo += 1
      else base.ok += 1
    }
    return base
  }, [insumos])

  const insumosLoteFiltrados = React.useMemo(() => {
    const q = lotBusca.trim().toLowerCase()
    return (insumos || []).filter((i) => {
      if (lotFiltroCategoria && String(i.categoria || '') !== lotFiltroCategoria) return false
      const st = String(i.statusValidade?.status || 'OK').toUpperCase()
      if (lotFiltroValidade === 'SEM_VALIDADE') {
        if (i.dataValidade) return false
      } else if (lotFiltroValidade !== 'TODOS') {
        if (!st || st !== lotFiltroValidade) return false
      }
      if (!q) return true
      const hay = [i.produto, i.marca, i.categoria, i.codigoBarras, i.lote, i.dataValidade].filter(Boolean).join(' ').toLowerCase()
      return hay.includes(q)
    })
  }, [insumos, lotBusca, lotFiltroCategoria, lotFiltroValidade])

  const overviewStockDistPie = React.useMemo(() => {
    if (!overviewStockDist.length) return []
    const sorted = [...overviewStockDist].sort((a, b) => (Number(b.value) || 0) - (Number(a.value) || 0))
    const topN = 8
    const top = sorted.slice(0, topN).map((c) => ({
      name: c.name || 'Outros',
      value: Number(c.value) || 0,
      color: getCategoriaBgColor(c.name || 'Outros')
    }))
    const restValue = sorted.slice(topN).reduce((acc, c) => acc + (Number(c.value) || 0), 0)
    if (restValue > 0) top.push({ name: 'Outros', value: restValue, color: '#9aa5b1' })
    return top
  }, [overviewStockDist])

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
            <div className="overflow-auto rounded-xl border border-white/10">
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

      <div ref={quickSectionRef} className="max-w-6xl mx-auto flex items-center justify-end gap-2">
        {offlineQueueCount > 0 ? (
          <Button
            variant="outline"
            className="h-9 px-3"
            onClick={() => setOfflineDialogOpen(true)}
            disabled={!isAuthed}
            title="Pendências offline"
          >
            Pendências <span className="ml-2 font-mono">{offlineQueueCount}</span>
          </Button>
        ) : null}
        <Button
          className="h-9 w-9 p-0 !bg-green-600 hover:!bg-green-700 !text-white"
          onClick={() => setQuickOp('ENTRADA')}
          disabled={!isAuthed}
          title="Entrada"
          aria-label="Entrada"
        >
          +
        </Button>
        <Button
          className="h-9 w-9 p-0"
          variant="destructive"
          onClick={() => setQuickOp('BAIXA')}
          disabled={!isAuthed}
          title="Saída"
          aria-label="Saída"
        >
          −
        </Button>
        <Button
          className="h-9 w-9 p-0 !bg-blue-600 hover:!bg-blue-700 !text-white"
          onClick={() => setQuickOp('TRANSFERENCIA')}
          disabled={!isAuthed}
          title="Transferência"
          aria-label="Transferência"
        >
          ⟲
        </Button>
      </div>

      <div ref={overviewSectionRef} className="max-w-6xl mx-auto">
        <Card className="glass-morphism border border-white/10">
          <CardHeader>
            <CardTitle className="text-white">Visão geral</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="text-sm text-blue-100/70">KPIs, gráficos e ações recomendadas para a unidade atual.</div>
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
                  onClick={() => void Promise.allSettled([loadOverview(), loadInsights()])}
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

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
              <Card className="bg-black/20 border border-white/10">
                <CardHeader>
                  <CardTitle className="text-white text-base">Distribuição por categoria</CardTitle>
                </CardHeader>
                <CardContent>
                  {overviewStockDistPie.length ? (
                    <div className="h-[280px]">
                      <ResponsiveContainer width="100%" height="100%">
                        <PieChart>
                          <Pie data={overviewStockDistPie} dataKey="value" nameKey="name" innerRadius={60} outerRadius={95} paddingAngle={2}>
                            {overviewStockDistPie.map((entry, idx) => (
                              <Cell key={idx} fill={(entry as any).color} />
                            ))}
                          </Pie>
                          <Tooltip formatter={(v) => `${v}`} />
                          <Legend />
                        </PieChart>
                      </ResponsiveContainer>
                    </div>
                  ) : (
                    <div className="text-sm text-blue-100/70">{overviewLoading ? 'Carregando…' : 'Sem dados.'}</div>
                  )}
                </CardContent>
              </Card>

              <Card className="bg-black/20 border border-white/10">
                <CardHeader>
                  <CardTitle className="text-white text-base">Entrada vs Saída</CardTitle>
                </CardHeader>
                <CardContent>
                  {overviewMovSeries.length ? (
                    <div className="h-[280px]">
                      <ResponsiveContainer width="100%" height="100%">
                        <BarChart data={overviewMovSeries}>
                          <CartesianGrid strokeDasharray="3 3" opacity={0.2} />
                          <XAxis dataKey="day" tickFormatter={fmtDayShort} />
                          <YAxis />
                          <Tooltip labelFormatter={(d) => fmtDayShort(String(d))} />
                          <Legend />
                          <Bar dataKey="entrada" name="Entrada" fill="#22c55e" radius={[4, 4, 0, 0]} />
                          <Bar dataKey="saida" name="Saída" fill="#ef4444" radius={[4, 4, 0, 0]} />
                        </BarChart>
                      </ResponsiveContainer>
                    </div>
                  ) : (
                    <div className="text-sm text-blue-100/70">{overviewLoading ? 'Carregando…' : 'Sem dados.'}</div>
                  )}
                </CardContent>
              </Card>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
              <Card className="bg-black/20 border border-white/10 lg:col-span-2">
                <CardHeader>
                  <CardTitle className="text-white text-base">Ações recomendadas</CardTitle>
                </CardHeader>
                <CardContent className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <div className="text-sm text-blue-100/80">Reposição</div>
                    {(overviewActionables?.reposicao || []).slice(0, 6).map((r) => (
                      <button
                        key={String(r.codigoBarras)}
                        className="w-full text-left rounded-lg border border-white/10 bg-black/20 px-3 py-2 hover:bg-white/5"
                        onClick={() => { if (r.codigoBarras) setQuickCodigo(String(r.codigoBarras)) }}
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
                </CardContent>
              </Card>
            </div>

            <Card className="bg-black/20 border border-white/10">
              <CardHeader>
                <CardTitle className="text-white text-base">Tendências (30d)</CardTitle>
              </CardHeader>
              <CardContent>
                {Array.isArray(insightsTrends?.buckets) && insightsTrends.buckets.length ? (
                  <div className="h-[260px]">
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={(insightsTrends.buckets || []).slice(-30)}>
                        <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.1)" />
                        <XAxis dataKey="bucket" tick={{ fill: 'rgba(219,234,254,0.8)', fontSize: 11 }} />
                        <YAxis tick={{ fill: 'rgba(219,234,254,0.8)', fontSize: 11 }} />
                        <Tooltip />
                        <Legend />
                        <Bar dataKey="entradaQtd" name="Entradas" fill="#22c55e" />
                        <Bar dataKey="saidaQtd" name="Saídas" fill="#ef4444" />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                ) : (
                  <div className="text-sm text-blue-100/70">{insightsLoading ? 'Carregando…' : 'Sem dados para o período.'}</div>
                )}
                <div className="text-xs text-blue-200/60 mt-2">
                  Saldo (qtd):{' '}
                  <span className="font-mono">
                    {insightsTrends?.totals ? Number(insightsTrends.totals.saldoQtd || 0).toFixed(0) : '-'}
                  </span>
                  {' • '}
                  Saldo (valor):{' '}
                  <span className="font-mono">
                    {insightsTrends?.totals ? fmtMoneyBRL(Number(insightsTrends.totals.saldoValor || 0)) : '-'}
                  </span>
                </div>
              </CardContent>
            </Card>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
              <Card className="bg-black/20 border border-white/10">
                <CardHeader>
                  <CardTitle className="text-white text-base">Giro por categoria (saídas)</CardTitle>
                </CardHeader>
                <CardContent className="space-y-2">
                  {Array.isArray(insightsTurnover?.categories) && insightsTurnover.categories.length ? (
                    <div className="overflow-auto rounded-xl border border-white/10">
                      <table className="min-w-full text-sm">
                        <thead className="bg-black/30 text-blue-100/80">
                          <tr>
                            <th className="text-left p-3">Categoria</th>
                            <th className="text-right p-3">Qtd</th>
                            <th className="text-right p-3">Valor</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-white/5">
                          {(insightsTurnover.categories || []).slice(0, 10).map((c: any, idx: number) => (
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
                  <div className="text-xs text-blue-200/60">Use “Movimentações” (De/Até) e recarregue.</div>
                </CardContent>
              </Card>

              <Card className="bg-black/20 border border-white/10">
                <CardHeader>
                  <CardTitle className="text-white text-base">ROI (perdas & risco)</CardTitle>
                </CardHeader>
                <CardContent className="space-y-1">
                  <div className="text-sm text-blue-100/80">
                    Expirados: <span className="font-mono">{insightsRoi?.perdas?.itensExpirados ?? '-'}</span> •{' '}
                    {insightsRoi?.perdas?.valorExpirado != null ? fmtMoneyBRL(Number(insightsRoi.perdas.valorExpirado) || 0) : '-'}
                  </div>
                  <div className="text-sm text-blue-100/80">
                    Vencendo: <span className="font-mono">{insightsRoi?.perdas?.itensVencendo ?? '-'}</span> •{' '}
                    {insightsRoi?.perdas?.valorRiscoVencendo != null
                      ? fmtMoneyBRL(Number(insightsRoi.perdas.valorRiscoVencendo) || 0)
                      : '-'}
                  </div>
                  <div className="text-sm text-blue-100/80">
                    Rupturas (estoque 0): <span className="font-mono">{insightsRoi?.ruptura?.itensRuptura ?? '-'}</span>
                  </div>
                  <div className="text-xs text-blue-200/60 mt-2">Use “Movimentações” para filtrar por data.</div>
                </CardContent>
              </Card>
            </div>
          </CardContent>
        </Card>
      </div>

      <Card className="glass-morphism border border-white/10 max-w-6xl mx-auto">
        <CardHeader className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <CardTitle className="text-white">Gestão</CardTitle>
          <div className="flex flex-wrap items-center gap-2">
            {offlineQueueCount > 0 ? (
              <>
                <Button variant="outline" size="sm" onClick={() => setOfflineDialogOpen(true)} disabled={!isAuthed}>
                  Pendências
                </Button>
                <Button variant="outline" size="sm" onClick={() => void syncOfflineQueue()} disabled={!isAuthed}>
                  Sincronizar
                </Button>
              </>
            ) : null}
            <Button variant="ghost" size="sm" onClick={toggleDebugUi}>
              {debugUi ? 'Ocultar detalhes' : 'Detalhes'}
            </Button>
            <Button size="sm" onClick={loadHealth} disabled={healthLoading}>
              {healthLoading ? 'Atualizando…' : 'Atualizar'}
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as any)}>
            <TabsList className="bg-black/20 flex flex-wrap">
              <TabsTrigger value="insumos">Insumos</TabsTrigger>
              <TabsTrigger value="lotes">Avisos</TabsTrigger>
              <TabsTrigger value="mov">Movimentações</TabsTrigger>
              <TabsTrigger value="insights">Insights</TabsTrigger>
            </TabsList>

            <TabsContent value="lotes" className="mt-4 space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <div className="text-base text-white font-semibold">Avisos</div>
                  <div className="text-sm text-blue-100/70">Alertas de estoque, qualidade do cadastro e validade (lotes).</div>
                </div>
                <Button
                  variant="secondary"
                  onClick={() => void Promise.allSettled([loadInsights(), loadInsumos()])}
                  disabled={(!isAuthed) || insightsLoading || insumosLoading}
                >
                  {(insightsLoading || insumosLoading) ? 'Atualizando…' : 'Recarregar'}
                </Button>
              </div>

              <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
                <Card className="bg-black/20 border border-white/10 lg:col-span-2">
                  <CardHeader>
                    <CardTitle className="text-white text-base">Alertas de estoque</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-2">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="text-sm text-blue-100/70">
                        Itens abaixo do mínimo: <span className="font-mono">{insightsAlertasFiltrados.length}</span>{' '}
                        • urgentes:{' '}
                        <span className="font-mono">
                          {insightsAlertasFiltrados.filter((a) => calcularStatusEstoque(Number(a.estoqueAtual) || 0, Number(a.estoqueMinimo) || 0) === 'URGENTE').length}
                        </span>
                      </div>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-3 gap-2 items-end">
                      <div>
                        <div className="text-xs text-blue-200/70 mb-1">Status</div>
                        <Select value={alertasStatus} onValueChange={(v) => setAlertasStatus(v as any)}>
                          <SelectTrigger>
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="TODOS">Todos</SelectItem>
                            <SelectItem value="ATENCAO">Atenção</SelectItem>
                            <SelectItem value="URGENTE">Urgente</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                      <div>
                        <div className="text-xs text-blue-200/70 mb-1">Categoria</div>
                        <Select value={alertasCategoria || '__ALL__'} onValueChange={(v) => setAlertasCategoria(v === '__ALL__' ? '' : String(v))}>
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

                    <div className="overflow-auto rounded-xl border border-white/10">
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
                  </CardContent>
                </Card>

                <Card className="bg-black/20 border border-white/10">
                  <CardHeader>
                    <CardTitle className="text-white text-base">Qualidade do cadastro</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-2">
                    <div className="flex flex-wrap items-center gap-2 text-sm text-blue-100/80">
                      <span>Total issues:</span>
                      <span className="font-mono">{insightsQuality?.summary?.total ?? '-'}</span>
                      {insightsQuality?.summary?.bySeverity ? (
                        <>
                          <Badge variant="destructive">CRIT {insightsQuality.summary.bySeverity.CRITICAL ?? 0}</Badge>
                          <Badge variant="secondary">WARN {insightsQuality.summary.bySeverity.WARN ?? 0}</Badge>
                          <Badge variant="default">INFO {insightsQuality.summary.bySeverity.INFO ?? 0}</Badge>
                        </>
                      ) : null}
                    </div>
                    <div className="overflow-auto rounded-xl border border-white/10">
                      <table className="min-w-full text-sm">
                        <thead className="bg-black/30 text-blue-100/80">
                          <tr>
                            <th className="text-left p-3">Sev</th>
                            <th className="text-left p-3">Código</th>
                            <th className="text-left p-3">Mensagem</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-white/5">
                          {(insightsQuality?.issues || []).slice(0, 20).map((it, idx) => {
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
                                      {(it.codigoBarras ? `#${it.codigoBarras}` : '')}{it.codigoBarras && it.produto ? ' • ' : ''}{it.produto || ''}
                                    </div>
                                  ) : null}
                                </td>
                              </tr>
                            )
                          })}
                          {!(insightsQuality?.issues || []).length ? (
                            <tr>
                              <td className="p-3 text-blue-100/70" colSpan={3}>
                                {insightsLoading ? 'Carregando…' : isAuthed ? 'Sem issues.' : 'Faça login para carregar.'}
                              </td>
                            </tr>
                          ) : null}
                        </tbody>
                      </table>
                    </div>
                  </CardContent>
                </Card>
              </div>

              <div className="flex items-center justify-between gap-2">
                <div>
                  <div className="text-base text-white font-semibold">Validade (lotes)</div>
                  <div className="text-sm text-blue-100/70">Controle simples e operacional (OK / Vencendo / Expirado).</div>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
                <Card className="bg-black/20 border border-white/10">
                  <CardHeader>
                    <CardTitle className="text-white text-sm">✅ Dentro do prazo</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="text-lg text-blue-50 font-mono">{lotResumo.ok}</div>
                    <div className="text-xs text-blue-200/60">status OK</div>
                  </CardContent>
                </Card>
                <Card className="bg-black/20 border border-white/10">
                  <CardHeader>
                    <CardTitle className="text-white text-sm">⚠️ Vencendo</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="text-lg text-blue-50 font-mono">{lotResumo.vencendo}</div>
                    <div className="text-xs text-blue-200/60">janela próxima</div>
                  </CardContent>
                </Card>
                <Card className="bg-black/20 border border-white/10">
                  <CardHeader>
                    <CardTitle className="text-white text-sm">❌ Expirado</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="text-lg text-blue-50 font-mono">{lotResumo.expirado}</div>
                    <div className="text-xs text-blue-200/60">risco</div>
                  </CardContent>
                </Card>
                <Card className="bg-black/20 border border-white/10">
                  <CardHeader>
                    <CardTitle className="text-white text-sm">🧾 Sem validade</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="text-lg text-blue-50 font-mono">{lotResumo.sem}</div>
                    <div className="text-xs text-blue-200/60">dados incompletos</div>
                  </CardContent>
                </Card>
              </div>

              <Card className="bg-black/20 border border-white/10">
                <CardHeader>
                  <CardTitle className="text-white text-sm">Filtros</CardTitle>
                </CardHeader>
                <CardContent className="grid grid-cols-1 md:grid-cols-3 gap-3">
                  <div>
                    <div className="text-xs text-blue-200/70 mb-1">Categoria</div>
                    <Select
                      value={lotFiltroCategoria || '__ALL__'}
                      onValueChange={(v) => setLotFiltroCategoria(v === '__ALL__' ? '' : String(v))}
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="Todas" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="__ALL__">Todas</SelectItem>
                        {lotCategorias.map((c) => (
                          <SelectItem key={c} value={c}>
                            {c}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <div className="text-xs text-blue-200/70 mb-1">Validade</div>
                    <Select value={lotFiltroValidade} onValueChange={(v) => setLotFiltroValidade(v as any)}>
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="TODOS">Todos</SelectItem>
                        <SelectItem value="OK">OK</SelectItem>
                        <SelectItem value="VENCENDO">Vencendo</SelectItem>
                        <SelectItem value="EXPIRADO">Expirado</SelectItem>
                        <SelectItem value="SEM_VALIDADE">Sem validade</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <div className="text-xs text-blue-200/70 mb-1">Busca</div>
                    <Input value={lotBusca} onChange={(e) => setLotBusca(e.target.value)} placeholder="produto, código, lote..." />
                  </div>
                </CardContent>
              </Card>

              <Card className="bg-black/20 border border-white/10">
                <CardHeader>
                  <CardTitle className="text-white text-sm">Itens ({insumosLoteFiltrados.length})</CardTitle>
                </CardHeader>
                <CardContent className="space-y-2">
                  {!insumosLoteFiltrados.length ? (
                    <div className="text-sm text-blue-100/70">Nenhum item para os filtros.</div>
                  ) : (
                    <div className="overflow-auto">
                      <table className="w-full text-sm">
                        <thead className="text-blue-200/70">
                          <tr className="border-b border-white/10">
                            <th className="text-left py-2 pr-3">Produto</th>
                            <th className="text-left py-2 pr-3">Lote</th>
                            <th className="text-left py-2 pr-3">Validade</th>
                            <th className="text-left py-2 pr-3">Status</th>
                            <th className="text-right py-2">Estoque</th>
                            <th className="text-right py-2 pl-3">Ações</th>
                          </tr>
                        </thead>
                        <tbody className="text-blue-50/90">
                          {insumosLoteFiltrados.map((i) => {
                            const st = String(i.statusValidade?.status || (i.dataValidade ? 'OK' : '—')).toUpperCase()
                            const badgeVariant = st === 'EXPIRADO' ? 'destructive' : st === 'VENCENDO' ? 'secondary' : 'default'
                            return (
                              <tr key={String(i.registro || i.codigoBarras)} className="border-b border-white/5 hover:bg-white/5">
                                <td className="py-2 pr-3">
                                  <div className="font-medium">{i.produto || '-'}</div>
                                  <div className="text-xs text-blue-200/60">{i.categoria || ''}</div>
                                </td>
                                <td className="py-2 pr-3">
                                  <span className="font-mono">{i.lote ? String(i.lote) : '-'}</span>
                                </td>
                                <td className="py-2 pr-3">
                                  <span className="font-mono">{i.dataValidade ? String(i.dataValidade) : '-'}</span>
                                </td>
                                <td className="py-2 pr-3">
                                  <Badge variant={badgeVariant}>{st}</Badge>
                                </td>
                                <td className="py-2 text-right font-mono">{Number(i.estoqueAtual) || 0}</td>
                                <td className="py-2 pl-3 text-right">
                                  <Button variant="secondary" onClick={() => openLotDialog(i)} disabled={!isAuthed}>
                                    Detalhes
                                  </Button>
                                </td>
                              </tr>
                            )
                          })}
                        </tbody>
                      </table>
                    </div>
                  )}
                </CardContent>
              </Card>

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
                      <div className="text-xs text-muted-foreground mb-1">Validade (YYYY-MM-DD)</div>
                      <Input value={lotEditValidade} onChange={(e) => setLotEditValidade(e.target.value)} placeholder="ex: 2026-12-31" />
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
            </TabsContent>

            <TabsContent value="insumos" className="mt-4 space-y-3">
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
                  <Button variant="secondary" onClick={loadInsumos} disabled={insumosLoading || !isAuthed}>
                    {insumosLoading ? 'Carregando…' : 'Recarregar'}
                  </Button>
                  <Button
                    variant="outline"
                    onClick={() => setCreateOpen((v) => !v)}
                    disabled={!isAuthed}
                  >
                    {createOpen ? 'Fechar' : 'Adicionar'}
                  </Button>
                </div>
                <div className="text-xs text-blue-200/60">{filteredInsumos.length} itens</div>
              </div>

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
                      <div className="text-xs text-blue-200/70 mb-1">Lote</div>
                      <Input value={createLote} onChange={(e) => setCreateLote(e.target.value)} placeholder="opcional" />
                    </div>
	                    <div>
	                      <div className="text-xs text-blue-200/70 mb-1">Data validade</div>
	                      <Input value={createDataValidade} onChange={(e) => setCreateDataValidade(e.target.value)} placeholder="YYYY-MM-DD" />
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
                      Dica: para listar nas unidades, a planilha precisa ter colunas da unidade e estoque inicial.
                    </div>
                    <Button
                      onClick={async () => {
                        const codigoBarras = createCodigo.trim()
                        if (!codigoBarras) return toast.error('Informe o código de barras')
                        const produto = createProduto.trim()
                        if (!produto) return toast.error('Informe o produto')

                        setCreateLoading(true)
                        try {
                          await mutateJson(`/insumos?unidade=${encodeURIComponent(unidade)}`, {
                            method: 'POST',
                            queueLabel: 'Cadastro de insumo',
                            body: {
                              codigoBarras,
                              produto,
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
                              dataValidade: createDataValidade.trim()
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
                          setCreateOpen(false)
                          await loadInsumos()
                        } catch (e) {
                          toast.error(e instanceof Error ? e.message : String(e))
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

              <div className="overflow-auto rounded-xl border border-white/10">
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
                      const status = i.statusValidade?.status || 'OK'
                      const estoque = Number(i.estoqueAtual) || 0
                      const min = Number(i.estoqueMinimo) || 0
                      const critico = min > 0 && estoque <= min
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
                            {i.codigoBarras ? (
                              <a
                                className="text-xs underline text-blue-200/70"
                                href={`/api/insumos/insumos/${encodeURIComponent(i.codigoBarras)}/qr`}
                                target="_blank"
                                rel="noreferrer"
                              >
                                QR
                              </a>
                            ) : null}
                          </td>
                          <td className={`p-3 text-right ${critico ? 'text-red-200' : 'text-blue-100/80'}`}>
                            <div className="flex items-center justify-end gap-2">
                              <span className="font-mono">{estoque}</span>
                              {min > 0 ? (
                                <Badge variant={estoqueStatusBadgeVariant(calcularStatusEstoque(estoque, min))}>
                                  {estoqueStatusLabel(calcularStatusEstoque(estoque, min))}
                                </Badge>
                              ) : null}
                            </div>
                            {otherSummary ? <div className="mt-1 text-[11px] text-blue-200/50">{otherSummary}</div> : null}
                          </td>
                          <td className="p-3 text-right text-blue-100/70">{min || '-'}</td>
                          <td className="p-3">
                            <div className="flex items-center gap-2">
                              <Badge variant={statusBadgeVariant(status)}>{status}</Badge>
                              <span className="text-blue-100/70">{fmtDate(i.dataValidade || '')}</span>
                            </div>
                          </td>
                          <td className="p-3 text-right text-blue-100/80">{fmtMoneyBRL(valor)}</td>
                          <td className="p-3 text-right">
                            <Button
                              variant="secondary"
                              className="h-8 px-2 text-xs"
                              onClick={() => {
                                if (i.codigoBarras) setQuickCodigo(i.codigoBarras)
                              }}
                            >
                              Usar
                            </Button>
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
            </TabsContent>

	            <TabsContent value="mov" className="mt-4 space-y-3">
	              <Card className="bg-black/20 border border-white/10">
	                <CardHeader>
	                  <CardTitle className="text-white text-sm">Entradas vs Saídas (por dia)</CardTitle>
	                </CardHeader>
	                <CardContent>
	                  {movChartData.length ? (
	                    <div className="h-[240px]">
	                      <ResponsiveContainer width="100%" height="100%">
	                        <BarChart data={movChartData}>
	                          <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.1)" />
	                          <XAxis dataKey="day" tick={{ fill: 'rgba(255,255,255,0.7)', fontSize: 11 }} />
	                          <YAxis tick={{ fill: 'rgba(255,255,255,0.7)', fontSize: 11 }} />
	                          <Tooltip
	                            contentStyle={{ backgroundColor: 'rgba(0,0,0,0.85)', border: '1px solid rgba(255,255,255,0.15)' }}
	                            labelStyle={{ color: 'rgba(255,255,255,0.8)' }}
	                          />
	                          <Legend />
	                          <Bar dataKey="entradas" name="Entradas" fill="#22c55e" />
	                          <Bar dataKey="saidas" name="Saídas" fill="#ef4444" />
	                        </BarChart>
	                      </ResponsiveContainer>
	                    </div>
	                  ) : (
	                    <div className="text-sm text-blue-100/60">
	                      Sem dados para o gráfico (ajuste filtros e recarregue).
	                    </div>
	                  )}
	                </CardContent>
	              </Card>

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
                  <Input value={movDe} onChange={(e) => setMovDe(e.target.value)} placeholder="YYYY-MM-DD" />
                </div>
                <div className="w-48">
                  <div className="text-xs text-blue-200/70 mb-1">Até</div>
                  <Input value={movAte} onChange={(e) => setMovAte(e.target.value)} placeholder="YYYY-MM-DD" />
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
                <Button variant="secondary" onClick={() => void loadMovimentacoes()} disabled={movLoading || !isAuthed}>
                  {movLoading ? 'Carregando…' : 'Filtrar'}
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

              <div className="overflow-auto rounded-xl border border-white/10">
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
                    {movimentacoes.map((m, idx) => (
                      <tr key={`${m.dataHora || ''}-${idx}`} className="hover:bg-white/5">
                        <td className="p-3 text-blue-100/70">{fmtDate(m.dataHora)}</td>
                        <td className="p-3 text-blue-100/80">{m.tipo || '-'}</td>
                        <td className="p-3 text-blue-50">{m.produto || '-'}</td>
                        <td className="p-3 font-mono text-blue-100/70">{m.codigoBarras || '-'}</td>
                        <td className="p-3 text-right text-blue-100/80">{m.quantidade ?? '-'}</td>
                        <td className="p-3 text-blue-100/70">{m.unidade ? unidadeLabel(m.unidade) : '-'}</td>
                        <td className="p-3 text-blue-100/70">{m.usuario || '-'}</td>
                        <td className="p-3 text-blue-100/60">
                          {m.transferId ? (
                            <div>
                              <div>Transferência {m.unidadeOrigem ? unidadeLabel(m.unidadeOrigem) : '-'} → {m.unidadeDestino ? unidadeLabel(m.unidadeDestino) : '-'}</div>
                              <div className="font-mono text-xs">{m.transferId}</div>
                            </div>
                          ) : m.motivo ? (
                            <span>Motivo: {m.motivo}</span>
                          ) : (
                            <span>{m.observacoes || '-'}</span>
                          )}
                        </td>
                      </tr>
                    ))}
                    {!movimentacoes.length ? (
                      <tr>
                        <td className="p-3 text-blue-100/70" colSpan={8}>
                          {movLoading ? 'Carregando…' : isAuthed ? 'Sem movimentações.' : 'Faça login para carregar.'}
                        </td>
                      </tr>
                    ) : null}
                  </tbody>
                </table>
              </div>
            </TabsContent>

            <TabsContent value="insights" className="mt-4 space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="text-sm text-blue-100/70">Relatórios e ferramentas (export, QR e análises detalhadas).</div>
                <Button variant="secondary" onClick={loadInsights} disabled={insightsLoading || !isAuthed}>
                  {insightsLoading ? 'Carregando…' : 'Recarregar'}
                </Button>
              </div>

              <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
                <Card className="bg-black/20 border border-white/10">
                  <CardHeader>
                    <CardTitle className="text-white text-base">Distribuição (por categoria)</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-2">
                    <div className="overflow-auto rounded-xl border border-white/10">
                      <table className="min-w-full text-sm">
                        <thead className="bg-black/30 text-blue-100/80">
                          <tr>
                            <th className="text-left p-3">Categoria</th>
                            <th className="text-right p-3">Qtd</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-white/5">
                          {[...insightsStockDist]
                            .sort((a, b) => (Number(b.value) || 0) - (Number(a.value) || 0))
                            .slice(0, 12)
                            .map((d, idx) => (
                              <tr key={`${d.name || ''}-${idx}`} className="hover:bg-white/5">
                                <td className="p-3 text-blue-50">{d.name || 'Outros'}</td>
                                <td className="p-3 text-right text-blue-100/80">{d.value ?? 0}</td>
                              </tr>
                            ))}
                          {!insightsStockDist.length ? (
                            <tr>
                              <td className="p-3 text-blue-100/70" colSpan={2}>
                                {insightsLoading ? 'Carregando…' : isAuthed ? 'Sem dados.' : 'Faça login para carregar.'}
                              </td>
                            </tr>
                          ) : null}
                        </tbody>
                      </table>
                    </div>
                  </CardContent>
                </Card>

                <Card className="bg-black/20 border border-white/10">
                  <CardHeader>
                    <CardTitle className="text-white text-base">Relatório de movimentações</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-2">
                    <div className="text-sm text-blue-100/80">
                      Entradas: <span className="font-mono">{insightsMovReport?.resumo?.totalEntradas ?? '-'}</span> • Saídas:{' '}
                      <span className="font-mono">{insightsMovReport?.resumo?.totalSaidas ?? '-'}</span> • Total:{' '}
                      <span className="font-mono">{insightsMovReport?.resumo?.totalMovimentacoes ?? '-'}</span>
                    </div>
                    <div className="text-xs text-blue-200/60">
                      Export:{' '}
                      <a
                        className="underline"
                        href={`/api/insumos/export/movimentacoes.csv?${new URLSearchParams({
                          unidade,
                          ...(movTipo !== 'TODOS' ? { tipo: movTipo } : {}),
                          ...(movDe ? { de: movDe } : {}),
                          ...(movAte ? { ate: movAte } : {})
                        }).toString()}`}
                        target="_blank"
                        rel="noreferrer"
                      >
                        movimentacoes.csv (filtros atuais)
                      </a>
                    </div>
                    <div className="overflow-auto rounded-xl border border-white/10">
                      <table className="min-w-full text-sm">
                        <thead className="bg-black/30 text-blue-100/80">
                          <tr>
                            <th className="text-left p-3">Data</th>
                            <th className="text-left p-3">Tipo</th>
                            <th className="text-left p-3">Produto</th>
                            <th className="text-right p-3">Qtd</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-white/5">
                          {(insightsMovReport?.movimentos || []).slice(0, 25).map((m, idx) => (
                            <tr key={`${m.dataHora || ''}-${idx}`} className="hover:bg-white/5">
                              <td className="p-3 text-blue-100/70">{fmtDate(m.dataHora)}</td>
                              <td className="p-3 text-blue-100/80">{m.tipo || '-'}</td>
                              <td className="p-3 text-blue-50">{m.produto || '-'}</td>
                              <td className="p-3 text-right text-blue-100/80">{m.quantidade ?? '-'}</td>
                            </tr>
                          ))}
                          {!(insightsMovReport?.movimentos || []).length ? (
                            <tr>
                              <td className="p-3 text-blue-100/70" colSpan={4}>
                                {insightsLoading ? 'Carregando…' : isAuthed ? 'Sem dados.' : 'Faça login para carregar.'}
                              </td>
                            </tr>
                          ) : null}
                        </tbody>
                      </table>
                    </div>
                  </CardContent>
                </Card>

                <Card className="bg-black/20 border border-white/10 lg:col-span-2">
                  <CardHeader>
                    <CardTitle className="text-white text-base">Ferramentas (export & QR)</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    <div className="text-xs text-blue-200/60">
                      Export:{' '}
                      <a className="underline" href={`/api/insumos/export/insumos.csv?unidade=${encodeURIComponent(unidade)}`} target="_blank" rel="noreferrer">
                        insumos.csv
                      </a>{' '}
                      •{' '}
                      <a className="underline" href={`/api/insumos/export/movimentacoes.csv?unidade=${encodeURIComponent(unidade)}`} target="_blank" rel="noreferrer">
                        movimentacoes.csv
                      </a>
                    </div>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3 items-start">
                      <div>
                        <div className="text-xs text-blue-200/70 mb-1">Gerar QR (texto livre)</div>
                        <Input value={qrText} onChange={(e) => setQrText(e.target.value)} placeholder="ex.: CODIGO123" />
                      </div>
                      <div className="flex items-center justify-center rounded-xl border border-white/10 bg-black/20 min-h-[92px]">
                        {qrText.trim() ? (
                          <img
                            src={`/api/insumos/qr?text=${encodeURIComponent(qrText.trim())}`}
                            alt="QR"
                            className="h-[84px] w-[84px]"
                          />
                        ) : (
                          <div className="text-xs text-blue-100/60">Digite um texto para ver o QR.</div>
                        )}
                      </div>
                    </div>
                  </CardContent>
                </Card>
              </div>
            </TabsContent>

          </Tabs>
        </CardContent>
      </Card>
    </div>
  )
}
