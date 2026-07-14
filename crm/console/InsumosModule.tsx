import React from 'react'
import { toast } from 'sonner'
import { DragDropContext, Draggable, Droppable, type DropResult } from '@hello-pangea/dnd'
import { Badge } from '@/badge'
import { Button } from '@/button'
import { Bar, BarChart, CartesianGrid, Cell, Legend, Line, LineChart, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { getCsrfToken } from '@/csrf'
import {
  InsumosAutoSyncBanner,
  InsumosAlertsPanel,
  InsumosChartsPanel,
  InsumosCategoryPoliciesPanel,
  InsumosEditDialog,
  InsumosLotDialog,
  InsumosMovementEditDialog,
  InsumosMovementsPanel,
  InsumosOfflineQueueDialog,
  InsumosInventoryDialog,
  InsumosPurchaseDialog,
  InsumosQualityMatchesDialog,
  InsumosQuickOperationDialog,
  InsumosSafeModeBanner,
} from '@/insumosPanels'
import {
  CHART_PRESETS,
  CHARTS_SLOTS_KEY,
  DEFAULT_CHART_SLOTS,
  MAX_CHARTS,
  filterChartSlotsView,
  getChartIndexFromKey,
  getNextChartPresetPatch,
  getNextDistributionGroupByPatch,
  getNextMovementsGroupByPatch,
  getNextMovementsModePatch,
  normalizeChartTopN,
  parseChartSlots,
  resolveChartPreset,
  resolveChartSlot,
  resolveChartViewOptions,
  type ChartFilterTipo,
  type ChartFilterTop,
  type ChartFilterView,
  type ChartFilterX,
  type ChartFilterY,
  type ChartGroupBy,
  type ChartMetric,
  type ChartPresetId,
  type ChartSlotConfig,
  type ChartView,
  type MovementsMode,
  updateChartSlotAt,
} from '@/insumosCharts'
import {
  buildMovementRows,
  buildMovimentacoesView,
  type MovementSortKey,
} from '@/insumosDerivations'
import { useInsumosDashboardController } from '@/insumosDashboardController'
import { useInsumosCreateLookupController } from '@/useInsumosCreateLookupController'
import { useInsumosInventoryMutationsController } from '@/useInsumosInventoryMutationsController'
import { useInsumosMovementsController } from '@/useInsumosMovementsController'
import { useInsumosQuickLookupController } from '@/useInsumosQuickLookupController'
import { useInsumosQuickOperationsController } from '@/useInsumosQuickOperationsController'
import {
  CANONICAL_TIPOS_UNIDADE,
  brToIsoDate,
  buildTagStyle,
  calcularStatusEstoque,
  combineLocalDateTimeToIso,
  dateInputToIso,
  estoqueStatusBadgeVariant,
  estoqueStatusLabel,
  extractTransferMovementNote,
  fmtDateOnlyBR,
  fmtDayShort,
  fmtMoneyBRL,
  fmtMoneyBRL0,
  fmtMoneyBRLCompact,
  fmtMovDateShort,
  fmtMovTimeShort,
  formatInsumoDescriptor,
  getCategoriaBgColor,
  getInsumoBarcodes,
  getMarcaBgColor,
  isoDayWeekStart,
  isoToBrDate,
  isoToLocalDateInput,
  isoToLocalTimeInput,
  normalizeAlertTags,
  normalizeMovimentacaoTipo,
  normalizeText,
  normalizeTimeInput,
  normalizeTipoUnidadeToCanonical,
  parseBarcodeInput,
  slugifyCategoria,
  statusBadgeVariant,
  uniqueSortedTextOptions,
  useViewportSize,
} from '@/insumosShared'
import type { AlertaStatusTag } from '@/insumosShared'
import type {
  Actionables,
  ApiError,
  CategoryPolicy,
  CategoryPolicySuggestion,
  EstoqueAlerta,
  EstoqueResumo,
  Insumo,
  InsumosHealth,
  InsumosProxyStatus,
  InsumosQuickOperation,
  InsumosUser,
  Movimentacao,
  NotificationsSummary,
  OfflineQueueItem,
  QuickActionFeedback,
  QuickCandidate,
  QualityIssue,
  QualityReport,
  RoiInsights,
  ShareHistoryItem,
  SharePayload,
  UserPrefs,
} from '@/insumosTypes'
import { useInsumosHeaderBridge } from '@/useInsumosHeaderBridge'

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
  const effectiveCsrfToken = getCsrfToken() || opts.csrfToken || null
  if (effectiveCsrfToken) headers['x-csrf-token'] = effectiveCsrfToken
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

  const [quickOp, setQuickOp] = React.useState<InsumosQuickOperation | null>(null)
  const [quickCodigo, setQuickCodigo] = React.useState('')
  const [quickSearch, setQuickSearch] = React.useState('')
  const [quickRegistro, setQuickRegistro] = React.useState('')
  const [quickRegistros, setQuickRegistros] = React.useState<string[]>([])
  const [quickCandidates, setQuickCandidates] = React.useState<QuickCandidate[]>([])
  const [quickAutoFefo, setQuickAutoFefo] = React.useState(true)
  const [quickScanOpen, setQuickScanOpen] = React.useState(false)
  const [quickQuantidade, setQuickQuantidade] = React.useState('1')
  const [quickNovoEstoque, setQuickNovoEstoque] = React.useState('')
  const [quickObs, setQuickObs] = React.useState('')
  const [quickMotivo, setQuickMotivo] = React.useState('Ajuste manual')
  const [quickActionLoading, setQuickActionLoading] = React.useState(false)
  const [quickActionFeedback, setQuickActionFeedback] = React.useState<QuickActionFeedback | null>(null)
  const [quickLookupLoading, setQuickLookupLoading] = React.useState(false)
  const [quickLookupError, setQuickLookupError] = React.useState<string | null>(null)
  const [quickLookupCtxUnidade, setQuickLookupCtxUnidade] = React.useState<string | null>(null)
  const [quickLookupCode, setQuickLookupCode] = React.useState<string | null>(null)
  const [quickLookupItems, setQuickLookupItems] = React.useState<Insumo[]>([])
  const [quickSelectedSnapshot, setQuickSelectedSnapshot] = React.useState<Insumo | null>(null)
  const [quickSearchRemote, setQuickSearchRemote] = React.useState<Insumo[]>([])
  const [quickSearchRemoteLoading, setQuickSearchRemoteLoading] = React.useState(false)
  const [quickSearchRemoteError, setQuickSearchRemoteError] = React.useState<string | null>(null)
  const overviewSectionRef = React.useRef<HTMLDivElement | null>(null)
  const movSectionRef = React.useRef<HTMLDivElement | null>(null)
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
  const insumosCacheRef = React.useRef<Map<string, Map<string, Insumo>>>(new Map())
  const [insumosCacheVersion, setInsumosCacheVersion] = React.useState(0)
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
  const [movFilterCategoria, setMovFilterCategoria] = React.useState('')
  const [movFilterMarca, setMovFilterMarca] = React.useState('')
  const [movSearch, setMovSearch] = React.useState('')
  const [movSortKey, setMovSortKey] = React.useState<MovementSortKey>('dataHora')
  const [movSortDir, setMovSortDir] = React.useState<'asc' | 'desc'>('desc')
  const movListContainerRef = React.useRef<HTMLDivElement | null>(null)
  const [editMovOpen, setEditMovOpen] = React.useState(false)
  const [editMovTarget, setEditMovTarget] = React.useState<Movimentacao | null>(null)
  const [editMovProduto, setEditMovProduto] = React.useState('')
  const [editMovData, setEditMovData] = React.useState('')
  const [editMovHora, setEditMovHora] = React.useState('')
  const [editMovUnidade, setEditMovUnidade] = React.useState('')
  const [editMovQuantidade, setEditMovQuantidade] = React.useState('1')
  const [editMovNovoEstoque, setEditMovNovoEstoque] = React.useState('')
  const [editMovObservacoes, setEditMovObservacoes] = React.useState('')
  const [editMovMotivo, setEditMovMotivo] = React.useState('')
  const [editMovSaving, setEditMovSaving] = React.useState(false)
  const [editMovDeleting, setEditMovDeleting] = React.useState(false)

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
  type AlertasFluxoFilter = 'TODOS' | 'ENTRADA' | 'SAIDA' | 'DESCARTE' | 'TRANSFERENCIA'
  const [alertasStatus, setAlertasStatus] = React.useState<AlertasStatusFilter>('TODOS')
  const [alertasCategoria, setAlertasCategoria] = React.useState('')
  const [alertasMarca, setAlertasMarca] = React.useState('')
  const [alertasFluxo, setAlertasFluxo] = React.useState<AlertasFluxoFilter>('TODOS')
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

  const isManagerRole = ['GESTOR', 'GERENTE'].includes(String(user?.role || '').toUpperCase())

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

  const readCachedInsumosByCodigo = React.useCallback(
    ({ codigoBarras, ctxUnidade }: { codigoBarras: string; ctxUnidade: string }) => {
      const codigo = String(codigoBarras || '').trim()
      if (!codigo) return []
      const byRegistro = insumosCacheRef.current.get(codigo)
      if (!byRegistro || !byRegistro.size) return []
      return Array.from(byRegistro.values()).map((item) => {
        const unit = String(ctxUnidade || '').trim()
        if (!unit || !item?.estoques) return item
        const stockForUnit = Number(item.estoques?.[unit])
        if (!Number.isFinite(stockForUnit)) return item
        return { ...item, estoqueAtual: stockForUnit }
      })
    },
    []
  )

  React.useEffect(() => {
    upsertInsumosCache(insumos || [])
  }, [insumos, upsertInsumosCache])

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

  const {
    autoSyncRemainingSeconds,
    autoSyncSuspended,
    dashboardProgress,
    loadInsights,
    loadOverview,
    loadingPercent,
    resumeAutoSync,
    schedulePostMutationRefresh,
    shouldShowDashboardLoading,
    showOverviewLoadingProgress,
  } = useInsumosDashboardController({
    apiJson,
    authLoaded,
    authLoading,
    canUseApi,
    chartsPanelOpen,
    chartsPanelVisible,
    healthLoaded,
    healthLoading,
    insightsLoaded,
    insumosLoaded,
    isAuthed,
    movLoaded,
    overviewCustomFrom,
    overviewCustomTo,
    overviewEverVisible,
    overviewInsumos,
    overviewLoaded,
    overviewLoading,
    overviewPeriod,
    overviewSectionRef,
    overviewVisible,
    setInsightsAlertas,
    setInsightsLoaded,
    setInsightsLoading,
    setInsightsTrends,
    setInsightsTurnover,
    setInsumosLoaded,
    setMovLoaded,
    setOverviewActionables,
    setOverviewEverVisible,
    setOverviewInsumos,
    setOverviewLoaded,
    setOverviewLoading,
    setOverviewMovResumo,
    setOverviewMovSeries,
    setOverviewNotifications,
    setOverviewQuality,
    setOverviewResumo,
    setOverviewRoi,
    unidade,
  })

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

  const layoutDragScrollY = React.useRef<number | null>(null)

  const onDragStartLayout = React.useCallback(() => {
    try {
      layoutDragScrollY.current = window.scrollY
    } catch {
      layoutDragScrollY.current = null
    }
  }, [])

  const onDragEndLayout = React.useCallback(
    (result: DropResult) => {
      const restoreScroll = () => {
        if (layoutDragScrollY.current == null) return
        const targetY = layoutDragScrollY.current
        layoutDragScrollY.current = null
        requestAnimationFrame(() => {
          try {
            window.scrollTo({ top: targetY, behavior: 'instant' as ScrollBehavior })
          } catch {
            window.scrollTo(0, targetY)
          }
        })
      }

      if (!result.destination) {
        restoreScroll()
        return
      }
      if (result.source.droppableId !== result.destination.droppableId) {
        restoreScroll()
        return
      }

      if (result.source.droppableId === 'overview-panels') {
        const next = moveIdInList(visibleOverviewPanels, result.source.index, result.destination.index)
        persistOverviewPanels(next)
        scheduleSaveUserPrefs({ mainPanelOrder, overviewPanelOrder: next, detailsOpen })
        restoreScroll()
        return
      }

      if (result.source.droppableId === 'main-panels') {
        const next = moveIdInList(visibleMainPanels, result.source.index, result.destination.index)
        persistMainPanels(next)
        scheduleSaveUserPrefs({ mainPanelOrder: next, overviewPanelOrder, detailsOpen })
      }
      restoreScroll()
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

  const lookupInsumosByCodigo = React.useCallback(
    async ({ codigoBarras, ctxUnidade }: { codigoBarras: string; ctxUnidade: string }) => {
      const codigo = String(codigoBarras || '').trim()
      if (!codigo) return []
      const cached = readCachedInsumosByCodigo({ codigoBarras: codigo, ctxUnidade })
      if (cached.length) return cached
      const params = new URLSearchParams({
        unidade: ctxUnidade,
        q: codigo,
        pagina: '1',
        limite: '80'
      })
      const out = await apiJson<{ success?: boolean; data?: Insumo[]; resumo?: any }>(`/insumos?${params.toString()}`)
      const list = Array.isArray(out?.data) ? out.data : []
      if (list.length) upsertInsumosCache(list)
      const exact = list.filter((i) => getInsumoBarcodes(i).includes(codigo))
      return exact.length ? exact : list
    },
    [apiJson, readCachedInsumosByCodigo, upsertInsumosCache]
  )

  const lookupInsumosByCodigos = React.useCallback(
    async ({ codigosBarras, ctxUnidade }: { codigosBarras: string[]; ctxUnidade: string }) => {
      const list = Array.isArray(codigosBarras) ? codigosBarras : []
      const cleaned = Array.from(new Set(list.map((v) => String(v || '').trim()).filter(Boolean)))
      if (!cleaned.length) return []
      const cachedItems = cleaned.flatMap((codigo) => readCachedInsumosByCodigo({ codigoBarras: codigo, ctxUnidade }))
      const cachedCodes = new Set(cachedItems.flatMap((item) => getInsumoBarcodes(item)))
      const missingCodes = cleaned.filter((codigo) => !cachedCodes.has(codigo))
      if (!missingCodes.length) return cachedItems
      const params = new URLSearchParams({ unidade: ctxUnidade })
      const out = await apiJson<{ success?: boolean; data?: Insumo[] }>(`/insumos/lookup?${params.toString()}`, {
        method: 'POST',
        body: { codigos: missingCodes }
      })
      const fetched = Array.isArray(out?.data) ? out.data : []
      if (fetched.length) upsertInsumosCache(fetched)
      const deduped = new Map<string, Insumo>()
      for (const item of [...cachedItems, ...fetched]) {
        const key = String(item?.registro || '').trim() || getInsumoBarcodes(item).join('|')
        if (!key) continue
        deduped.set(key, item)
      }
      return Array.from(deduped.values())
    },
    [apiJson, readCachedInsumosByCodigo, upsertInsumosCache]
  )

  const {
    applyQuickSelection,
    clearQuickSelection,
    hasQuickSelection,
    quickLoteNeedsPick,
    quickLotesForPicker,
    quickSearchMatches,
    selectQuickCodigo,
  } = useInsumosQuickLookupController({
    apiJson,
    canUseApi,
    insumos,
    isAuthed,
    isSameInsumo,
    lookupInsumosByCodigo,
    normalizeText,
    quickCandidates,
    quickCodigo,
    quickLookupCode,
    quickLookupCtxUnidade,
    quickLookupItems,
    quickLotes,
    quickOp,
    quickRegistros,
    quickSearch,
    quickSearchRemote,
    quickSearchRemoteError,
    quickSearchRemoteLoading,
    quickSelectedSnapshot,
    readCachedInsumosByCodigo,
    transferFrom,
    unidade,
    upsertInsumosCache,
    setQuickCandidates,
    setQuickCodigo,
    setQuickLookupCode,
    setQuickLookupCtxUnidade,
    setQuickLookupError,
    setQuickLookupItems,
    setQuickLookupLoading,
    setQuickRegistros,
    setQuickRegistro,
    setQuickSearch,
    setQuickSearchRemote,
    setQuickSearchRemoteError,
    setQuickSearchRemoteLoading,
    setQuickSelectedSnapshot,
  })

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
      op: InsumosQuickOperation,
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

  useInsumosCreateLookupController({
    canUseApi,
    createCalibre,
    createCategoria,
    createCodigo,
    createConcentracao,
    createEspecificacao,
    createHomologado,
    createMarca,
    createOpen,
    createPolicyTouched,
    createPrecoCusto,
    createProduto,
    createTipoUnidade,
    createVolume,
    getPolicyForItem,
    isAuthed,
    lookupInsumosByCodigo,
    readCachedInsumosByCodigo,
    unidade,
    setCreateCalibre,
    setCreateCategoria,
    setCreateCategoriaFefo,
    setCreateCategoriaRequiresExpiry,
    setCreateCategoriaRequiresLot,
    setCreateConcentracao,
    setCreateEspecificacao,
    setCreateHomologado,
    setCreateLookupError,
    setCreateLookupItems,
    setCreateLookupLoading,
    setCreateMarca,
    setCreatePrecoCusto,
    setCreateProduto,
    setCreateTipoUnidade,
    setCreateVolume,
  })

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
        else if (actionLabel === 'Ajuste') openQuickOperation('AJUSTE')
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
      const out = await apiJson<InsumosProxyStatus>('/api/insumos/_proxy-status')
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

  const openMovementEditDialog = React.useCallback((m: Movimentacao) => {
    const movementId = String(m?.id || '').trim()
    if (!movementId) {
      toast.error('Movimentação sem identificador para edição.')
      return
    }
    const tipo = normalizeMovimentacaoTipo(m?.tipo)
    setEditMovTarget(m)
    setEditMovProduto(String(m?.produto || ''))
    setEditMovData(isoToLocalDateInput(m?.dataHora))
    setEditMovHora(isoToLocalTimeInput(m?.dataHora))
    setEditMovUnidade(String(m?.unidade || unidade))
    setEditMovQuantidade(String(Math.max(1, Number(m?.quantidade) || 1)))
    setEditMovNovoEstoque(String(Number.isFinite(Number(m?.estoqueNovo)) ? Number(m.estoqueNovo) : 0))
    setEditMovObservacoes(m?.transferId ? extractTransferMovementNote(m?.observacoes) : String(m?.observacoes || ''))
    setEditMovMotivo(String(m?.motivo || ''))
    if (tipo !== 'AJUSTE') setEditMovMotivo('')
    setEditMovOpen(true)
  }, [unidade])

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

  const {
    deleteMovementEdit,
    loadMovimentacoes,
    saveMovementEdit,
  } = useInsumosMovementsController({
    apiJson,
    canUseApi,
    editMovData,
    editMovHora,
    editMovMotivo,
    editMovNovoEstoque,
    editMovObservacoes,
    editMovProduto,
    editMovQuantidade,
    editMovTarget,
    editMovUnidade,
    isAuthed,
    movAte,
    movDe,
    movFilterCategoria,
    movFilterMarca,
    movListContainerRef,
    movTipo,
    mutateJson,
    refreshInsumos,
    schedulePostMutationRefresh,
    selectedCodigoBarras,
    setEditMovDeleting,
    setEditMovOpen,
    setEditMovSaving,
    setEditMovTarget,
    setMovLoaded,
    setMovLoading,
    setMovLoadError,
    setMovimentacoes,
    unidade,
  })
  const {
    deleteEdit,
    deleteInsumoByRegistro,
    saveCreateFromModal,
    saveCreateInline,
    saveEdit,
    saveLot,
  } = useInsumosInventoryMutationsController({
    canUseApi,
    createCalibre,
    createCategoria,
    createCategoriaFefo,
    createCategoriaRequiresExpiry,
    createCategoriaRequiresLot,
    createCodigo,
    createCodigosExtras,
    createConcentracao,
    createDataValidade,
    createEspecificacao,
    createEstoqueInicial,
    createEstoqueMinimo,
    createHomologado,
    createLote,
    createMarca,
    createNovoLote,
    createPrecoCusto,
    createProduto,
    createTipoUnidade,
    createVolume,
    editCalibre,
    editCategoria,
    editCategoriaFefo,
    editCategoriaRequiresExpiry,
    editCategoriaRequiresLot,
    editCodigo,
    editCodigosExtras,
    editConcentracao,
    editDataValidade,
    editEspecificacao,
    editEstoqueMinimo,
    editHomologado,
    editLote,
    editMarca,
    editPrecoCusto,
    editProduto,
    editTarget,
    editTipoUnidade,
    editVolume,
    getPolicyErrorCode,
    insumos,
    isAuthed,
    loadInsumosOptions,
    loadOverview,
    lotEditLote,
    lotEditValidade,
    lotSelecionado,
    mutateJson,
    policyErrorToast,
    refreshInsumos,
    setCreateCalibre,
    setCreateCategoria,
    setCreateCodigosExtras,
    setCreateCodigo,
    setCreateConcentracao,
    setCreateDataValidade,
    setCreateEspecificacao,
    setCreateEstoqueInicial,
    setCreateEstoqueMinimo,
    setCreateHomologado,
    setCreateLoading,
    setCreateLote,
    setCreateMarca,
    setCreateNovoLote,
    setCreateOpen,
    setCreatePrecoCusto,
    setCreateProduto,
    setCreateTipoUnidade,
    setCreateVolume,
    setEditOpen,
    setEditSaveError,
    setEditSaving,
    setEditValidationErrors,
    setLotDialogOpen,
    setLotSaving,
    setQualityMatchesItems,
    setQualityMatchesSavingRegistro,
    unidade,
  })

  const headerStatus = React.useMemo(
    () => ({
      online: healthLoaded ? Boolean(health) : null,
      authed: authLoaded ? isAuthed : null,
      integrated: healthLoaded
        ? (typeof health?.ready === 'boolean'
            ? health.ready
            : (typeof health?.dbConfigured === 'boolean' ? health.dbConfigured : (health?.ok == null ? null : Boolean(health.ok))))
        : null,
      unidades: unidadeOptions,
      allowedUnits,
    }),
    [allowedUnits, authLoaded, health, healthLoaded, isAuthed, unidadeOptions],
  )

  useInsumosHeaderBridge({
    allUnidades,
    allowedUnits,
    loadInsights,
    loadOverview,
    loadingPercent,
    openQuickOperation,
    overviewCustomFrom,
    overviewCustomTo,
    overviewMovResumo,
    overviewPeriod,
    overviewResumo,
    refreshInsumos,
    resetUserLayoutPrefs,
    selectedUnit: unidade,
    setAllDetailsOpen,
    setOverviewCustomFrom,
    setOverviewCustomTo,
    setOverviewPeriod,
    setSelectedUnit: setUnidade,
    showOverviewLoadingProgress,
    status: headerStatus,
    storageKey: INSUMOS_UNIT_KEY,
  })

  const { runQuickOperation, runTransfer } = useInsumosQuickOperationsController({
    canUseApi,
    isAuthed,
    loadMovimentacoes,
    mutateJson,
    policyErrorToast,
    quickCodigo,
    quickLoteNeedsPick,
    quickMotivo,
    quickNovoEstoque,
    quickObs,
    quickQuantidade,
    quickRegistro,
    refreshInsumos,
    schedulePostMutationRefresh,
    setQuickActionFeedback,
    setQuickActionLoading,
    setQuickCandidates,
    setQuickRegistros,
    transferFrom,
    transferTo,
    unidade,
  })

  React.useEffect(() => {
    void loadHealth()
    void loadMe()
    void loadProxyStatus()
  }, [loadHealth, loadMe, loadProxyStatus])

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
    const chunkSize = 60

    const run = async () => {
      for (let i = 0; i < queue.length && token === movInsumosLookupTokenRef.current; i += chunkSize) {
        const chunk = queue.slice(i, i + chunkSize).filter(Boolean)
        if (!chunk.length) continue
        for (const code of chunk) movInsumosLookupInflightRef.current.add(code)
        try {
          const items = await lookupInsumosByCodigos({ codigosBarras: chunk, ctxUnidade: unidade })
          if (token !== movInsumosLookupTokenRef.current) return
          upsertInsumosCache(items)
        } catch {
          // ignore
        } finally {
          for (const code of chunk) {
            movInsumosLookupInflightRef.current.delete(code)
            movInsumosLookupDoneRef.current.add(code)
          }
        }
      }
    }

    void run()
  }, [canUseApi, isAuthed, lookupInsumosByCodigos, movimentacoes, selectedCodigoBarras, unidade, upsertInsumosCache])

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

  const insumosProdutos = React.useMemo(() => {
    const fromInsumos = (insumos || []).map((item) => String(item.produto || '').trim()).filter(Boolean)
    const fromMovimentacoes = (movimentacoes || []).map((item) => String(item.produto || '').trim()).filter(Boolean)
    return uniqueSortedTextOptions([...fromInsumos, ...fromMovimentacoes])
  }, [insumos, movimentacoes])

  const insumosTiposUnidade = React.useMemo(() => Array.from(CANONICAL_TIPOS_UNIDADE as readonly string[]), [])

  const [chartSlots, setChartSlots] = React.useState<ChartSlotConfig[]>(() => {
    try {
      return parseChartSlots(window.localStorage.getItem(CHARTS_SLOTS_KEY))
    } catch {
      return DEFAULT_CHART_SLOTS
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  })

  const [chartsFilterTipo, setChartsFilterTipo] = React.useState<ChartFilterTipo>('__ALL__')
  const [chartsFilterY, setChartsFilterY] = React.useState<ChartFilterY>('__ALL__')
  const [chartsFilterX, setChartsFilterX] = React.useState<ChartFilterX>('__ALL__')
  const [chartsFilterView, setChartsFilterView] = React.useState<ChartFilterView>('__ALL__')
  const [chartsFilterTop, setChartsFilterTop] = React.useState<ChartFilterTop>('__ALL__')
  const [chartsSearch, setChartsSearch] = React.useState('')

  React.useEffect(() => {
    try {
      window.localStorage.setItem(CHARTS_SLOTS_KEY, JSON.stringify(chartSlots))
    } catch {
      // ignore
    }
  }, [chartSlots])

  const setChartSlot = React.useCallback((idx: number, next: Partial<ChartSlotConfig>) => {
    setChartSlots((prev) => updateChartSlotAt(prev, idx, next))
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

  const chartSlotsView = React.useMemo(() => {
    return filterChartSlotsView({
      chartSlots,
      chartsFilterTipo,
      chartsFilterY,
      chartsFilterX,
      chartsFilterView,
      chartsFilterTop,
      chartsSearch,
    })
  }, [
    chartSlots,
    chartsFilterTipo,
    chartsFilterY,
    chartsFilterX,
    chartsFilterView,
    chartsFilterTop,
    chartsSearch,
  ])

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

  const chartPresetOptions = React.useMemo(
    () => CHART_PRESETS.map((preset) => ({ id: preset.id, label: preset.label })),
    []
  )

  const chartCards = React.useMemo(
    () =>
      chartSlotsView.map(({ slot, idx, meta }) => {
        const { preset, groupBy, mode, viewOptions, view, metric, topN, showTopN, layout } = meta
        const baseHeight = chartSlotsView.length === 1 ? 360 : chartSlotsView.length === 2 ? 300 : 260
        const height = layout === 'tall' ? baseHeight + (chartSlotsView.length === 1 ? 180 : 120) : baseHeight
        return {
          key: String(idx),
          presetId: slot.presetId,
          presetLabel: preset.label,
          groupBy,
          mode,
          metric,
          topN,
          view,
          viewOptions,
          supportsMetric: !!preset.supportsMetric,
          supportsView: !!preset.supportsView,
          showTopN,
          controlsKind: slot.presetId === 'distribution' ? 'distribution' : slot.presetId === 'movements' ? 'movements' : 'none',
          canRemove: chartSlots.length > 1,
          cardSpanClass: chartSlotsView.length >= 3 && layout === 'wide' ? 'xl:col-span-2' : '',
          renderNode: renderChart({ ...slot, view, metric, topN }, { height }),
        } as const
      }),
    [chartSlots.length, chartSlotsView, renderChart]
  )

  const getChartIndexFromKey = React.useCallback((cardKey: string) => {
    const idx = Number.parseInt(String(cardKey), 10)
    return Number.isInteger(idx) && idx >= 0 ? idx : -1
  }, [])

  const handleChartPresetChange = React.useCallback(
    (cardKey: string, value: string) => {
      const idx = getChartIndexFromKey(cardKey)
      if (idx < 0) return
      const slot = chartSlots[idx] || DEFAULT_CHART_SLOTS[0]
      setChartSlot(idx, getNextChartPresetPatch(slot, value))
    },
    [chartSlots, getChartIndexFromKey, setChartSlot]
  )

  const handleRemoveChart = React.useCallback(
    (cardKey: string) => {
      const idx = getChartIndexFromKey(cardKey)
      if (idx < 0) return
      setChartSlots((prev) => prev.filter((_, currentIdx) => currentIdx !== idx))
    },
    [getChartIndexFromKey]
  )

  const handleDistributionGroupByChange = React.useCallback(
    (cardKey: string, value: 'categoria' | 'marca' | 'item') => {
      const idx = getChartIndexFromKey(cardKey)
      if (idx < 0) return
      const slot = chartSlots[idx] || DEFAULT_CHART_SLOTS[0]
      setChartSlot(idx, getNextDistributionGroupByPatch(slot, value))
    },
    [chartSlots, getChartIndexFromKey, setChartSlot]
  )

  const handleMovementsGroupByChange = React.useCallback(
    (cardKey: string, value: 'tempo' | 'categoria') => {
      const idx = getChartIndexFromKey(cardKey)
      if (idx < 0) return
      const slot = chartSlots[idx] || DEFAULT_CHART_SLOTS[0]
      setChartSlot(idx, getNextMovementsGroupByPatch(slot, value))
    },
    [chartSlots, getChartIndexFromKey, setChartSlot]
  )

  const handleMovementsModeChange = React.useCallback(
    (cardKey: string, value: 'inout' | 'saldo' | 'entrada' | 'saida') => {
      const idx = getChartIndexFromKey(cardKey)
      if (idx < 0) return
      setChartSlot(idx, getNextMovementsModePatch(value))
    },
    [getChartIndexFromKey, setChartSlot]
  )

  const handleChartMetricChange = React.useCallback(
    (cardKey: string, value: 'qtd' | 'valor') => {
      const idx = getChartIndexFromKey(cardKey)
      if (idx < 0) return
      setChartSlot(idx, { metric: value })
    },
    [getChartIndexFromKey, setChartSlot]
  )

  const handleChartViewChange = React.useCallback(
    (cardKey: string, value: 'pie' | 'bar' | 'line') => {
      const idx = getChartIndexFromKey(cardKey)
      if (idx < 0) return
      setChartSlot(idx, { view: value })
    },
    [getChartIndexFromKey, setChartSlot]
  )

  const handleChartTopNChange = React.useCallback(
    (cardKey: string, value: number) => {
      const idx = getChartIndexFromKey(cardKey)
      if (idx < 0) return
      setChartSlot(idx, { topN: normalizeChartTopN(value) })
    },
    [getChartIndexFromKey, setChartSlot]
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

  const getAlertaFluxo = React.useCallback(
    (row: AlertasLinha) => {
      const code = String(row.codigoBarras || '').trim()
      const rec = code ? alertasRecommendationByCode.get(code) || null : null
      if (rec?.kind === 'TRANSFERENCIA') return 'TRANSFERENCIA'
      if (rec?.kind === 'ENTRADA') return 'ENTRADA'
      if (row.tags.includes('EXPIRADO')) return 'DESCARTE'
      if (row.tags.includes('VENCENDO')) return 'SAIDA'
      return ''
    },
    [alertasRecommendationByCode]
  )

  const alertasLinhasFiltradas = React.useMemo(() => {
    const q = alertasBusca.trim().toLowerCase()
    return alertasLinhas.filter((a) => {
      if (alertasCategoria && String(a.categoria || '') !== alertasCategoria) return false
      if (alertasMarca && String(a.marca || '') !== alertasMarca) return false
      if (alertasFluxo !== 'TODOS') {
        const fluxo = getAlertaFluxo(a)
        if (fluxo !== alertasFluxo) return false
      }
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
  }, [alertasBusca, alertasCategoria, alertasLinhas, alertasMarca, alertasStatus, alertasFluxo, getAlertaFluxo])

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

  const movimentacoesView = React.useMemo(
    () =>
      buildMovimentacoesView({
        movGroupTransfers,
        movSortDir,
        movSortKey,
        movTipo,
        movFilterCategoria,
        movFilterMarca,
        movSearch,
        movimentacoes,
        pickInsumoForMov,
        selectedCodigoBarras,
        normalizeText,
      }),
    [movGroupTransfers, movSortDir, movSortKey, movTipo, movFilterCategoria, movFilterMarca, movSearch, movimentacoes, pickInsumoForMov, selectedCodigoBarras]
  )

  const movementRows = React.useMemo(
    () =>
      buildMovementRows({
        movimentacoesView,
        pickInsumoForMov,
        selectedCodigoBarras,
        movFilterCategoria,
        movFilterMarca,
        movSearch,
        unidade,
        isAuthed,
        unidadeLabel,
        normalizeText,
        fmtMovDateShort,
        fmtMovTimeShort,
        fmtDateOnlyBR,
        fmtMoneyBRL,
        fmtMoneyBRL0,
      }),
    [isAuthed, movFilterCategoria, movFilterMarca, movSearch, movimentacoesView, pickInsumoForMov, selectedCodigoBarras, unidade, unidadeLabel]
  )

  return (
    <div ref={rootRef} className="px-3 py-4 sm:p-6 space-y-4 sm:space-y-6">
      {autoSyncSuspended ? (
        <InsumosAutoSyncBanner
          autoSyncRemainingSeconds={autoSyncRemainingSeconds}
          onResume={resumeAutoSync}
          onRefreshNow={() => {
            resumeAutoSync()
            void Promise.allSettled([loadOverview({ force: true }), loadInsights({ force: true }), refreshInsumos()])
          }}
        />
      ) : null}
      <DragDropContext onDragStart={onDragStartLayout} onDragEnd={onDragEndLayout}>
      <InsumosInventoryDialog
        open={insumosListModalOpen}
        dialogClassName={dialogWideClass}
        isAuthed={isAuthed}
        unit={unidade}
        unitLabel={unidadeLabel}
        query={insumosQuery}
        onQueryChange={setInsumosQuery}
        onOpenChange={setInsumosListModalOpen}
        onExport={() => window.open(`/api/insumos/export/insumos.csv?unidade=${encodeURIComponent(unidade)}`, '_blank', 'noopener,noreferrer')}
        createOpen={createOpen}
        onToggleCreate={() => setCreateOpen((value) => !value)}
        onCancelCreate={() => setCreateOpen(false)}
        createLookupLoading={createLookupLoading}
        createLookupError={createLookupError}
        createLookupCount={createLookupItems?.length || 0}
        createScanOpen={createScanOpen}
        onToggleCreateScan={() => setCreateScanOpen((value) => !value)}
        onCloseCreateScan={() => setCreateScanOpen(false)}
        onCreateBarcodeDetected={(code) => {
          setCreateCodigo(code)
          setCreateScanOpen(false)
          toast.success('Código detectado')
        }}
        createCodigo={createCodigo}
        onCreateCodigoChange={setCreateCodigo}
        createCodigosExtras={createCodigosExtras}
        onCreateCodigosExtrasChange={setCreateCodigosExtras}
        createProduto={createProduto}
        onCreateProdutoChange={setCreateProduto}
        createCategoria={createCategoria}
        onCreateCategoriaChange={setCreateCategoria}
        createMarca={createMarca}
        onCreateMarcaChange={setCreateMarca}
        createTipoUnidade={normalizeTipoUnidadeToCanonical(createTipoUnidade) || ''}
        onCreateTipoUnidadeChange={setCreateTipoUnidade}
        createPrecoCusto={createPrecoCusto}
        onCreatePrecoCustoChange={setCreatePrecoCusto}
        createEstoqueMinimo={createEstoqueMinimo}
        onCreateEstoqueMinimoChange={setCreateEstoqueMinimo}
        createEstoqueInicial={createEstoqueInicial}
        onCreateEstoqueInicialChange={setCreateEstoqueInicial}
        createLote={createLote}
        onCreateLoteChange={setCreateLote}
        createDataValidade={createDataValidade}
        onCreateDataValidadeChange={setCreateDataValidade}
        createNovoLote={createNovoLote}
        onToggleCreateNovoLote={() => setCreateNovoLote((value) => !value)}
        createCategoriaRequiresLot={createCategoriaRequiresLot}
        onCreateCategoriaRequiresLotChange={(value) => {
          setCreatePolicyTouched(true)
          setCreateCategoriaRequiresLot(value)
        }}
        createCategoriaRequiresExpiry={createCategoriaRequiresExpiry}
        onCreateCategoriaRequiresExpiryChange={(value) => {
          setCreatePolicyTouched(true)
          setCreateCategoriaRequiresExpiry(value)
          if (!value) setCreateCategoriaFefo(false)
        }}
        createCategoriaFefo={createCategoriaFefo}
        onCreateCategoriaFefoChange={(value) => {
          setCreatePolicyTouched(true)
          setCreateCategoriaFefo(value)
          if (value) setCreateCategoriaRequiresExpiry(true)
        }}
        isManagerRole={isManagerRole}
        lotCategorias={lotCategorias}
        insumosMarcas={insumosMarcas}
        insumosTiposUnidade={insumosTiposUnidade}
        createLoading={createLoading}
        onSaveCreate={() => void saveCreateFromModal()}
        filteredInsumos={filteredInsumos}
        listContainerRef={insumosModalListContainerRef}
        onListScroll={onInsumosModalScroll}
        insumosLoading={insumosLoading}
        insumosLoadError={insumosLoadError}
        emptyContent={renderListPlaceholder(insumosLoading, 'Sem itens.')}
        onEditItem={openEditDialog}
      />
      <InsumosOfflineQueueDialog
        open={offlineDialogOpen}
        dialogClassName={dialogSmallClass}
        items={offlineItems}
        debugUi={debugUi}
        isAuthed={isAuthed}
        fmtAge={fmtAge}
        onOpenChange={setOfflineDialogOpen}
        onSync={() => void syncOfflineQueue()}
        onClear={() => {
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
        onToggleDebug={toggleDebugUi}
        onCopyItem={async (item) => {
          try {
            await navigator.clipboard.writeText(JSON.stringify(item, null, 2))
            toast.success('Copiado.')
          } catch (error: any) {
            toast.error(error?.message || 'Não foi possível copiar.')
          }
        }}
      />

      <InsumosQuickOperationDialog
        open={quickOp != null}
        operation={quickOp}
        dialogClassName={dialogLargeClass}
        isAuthed={isAuthed}
        shouldShowDashboardLoading={shouldShowDashboardLoading}
        renderDashboardLoadingButton={() => <DashboardLoadingButton size="sm" />}
        unit={unidade}
        transferFrom={transferFrom}
        transferTo={transferTo}
        unitOptions={unidadeOptions}
        unitLabel={unidadeLabel}
        search={quickSearch}
        onSearchChange={setQuickSearch}
        scanOpen={quickScanOpen}
        onScanToggle={() => setQuickScanOpen((value) => !value)}
        onScanClose={() => setQuickScanOpen(false)}
        onBarcodeDetected={(code) => {
          selectQuickCodigo(code, { setSearch: true, snapshot: null })
          setQuickScanOpen(false)
          toast.success('Código detectado')
        }}
        searchRemoteLoading={quickSearchRemoteLoading}
        searchRemoteError={quickSearchRemoteError}
        searchMatches={quickSearchMatches}
        hasSelection={hasQuickSelection}
        lookupLoading={quickLookupLoading}
        lookupError={quickLookupError}
        lookupItems={quickLookupItems}
        selectedSnapshot={quickSelectedSnapshot}
        quickCode={quickCodigo}
        onClearSelection={clearQuickSelection}
        onApplySelection={applyQuickSelection}
        isSameInsumo={isSameInsumo}
        onSelectCode={(value, item) => selectQuickCodigo(value, { snapshot: item ?? null })}
        loteNeedsPick={quickLoteNeedsPick}
        lotesForPicker={quickLotesForPicker}
        selectedRegistro={quickRegistro}
        onRegistroChange={(value) => {
          setQuickRegistro(value)
          setQuickAutoFefo(false)
        }}
        showFefoToggle={
          (quickOp === 'BAIXA' || quickOp === 'TRANSFERENCIA') &&
          quickLotesForPicker.length > 1 &&
          getPolicyForItem(quickLookupItems?.[0] || null).fefo
        }
        autoFefo={quickAutoFefo}
        onToggleAutoFefo={() => setQuickAutoFefo((value) => !value)}
        quantity={quickQuantidade}
        onQuantityChange={setQuickQuantidade}
        adjustmentStock={quickNovoEstoque}
        onAdjustmentStockChange={setQuickNovoEstoque}
        adjustmentReason={quickMotivo}
        onAdjustmentReasonChange={setQuickMotivo}
        obs={quickObs}
        onObsChange={setQuickObs}
        onTransferFromChange={setTransferFrom}
        onTransferToChange={setTransferTo}
        feedback={quickActionFeedback}
        loading={quickActionLoading}
        onOpenChange={(open) => {
          if (open) return
          resetQuickOperationState()
          setQuickOp(null)
        }}
        onCancel={() => {
          resetQuickOperationState()
          setQuickOp(null)
        }}
        onConfirmTransfer={async () => {
          const ok = await runTransfer()
          if (ok) resetQuickOperationState({ keepFeedback: true })
        }}
        onConfirmOperation={async () => {
          const operation = quickOp === 'AJUSTE' ? 'AJUSTE' : quickOp === 'ENTRADA' ? 'ENTRADA' : 'BAIXA'
          const ok = await runQuickOperation(operation)
          if (ok) resetQuickOperationState({ keepFeedback: true })
        }}
        onEditItem={openEditDialog}
      />

      <InsumosMovementEditDialog
        open={editMovOpen}
        dialogClassName={dialogSmallClass}
        target={editMovTarget}
        isAuthed={isAuthed}
        saving={editMovSaving}
        deleting={editMovDeleting}
        produto={editMovProduto}
        data={editMovData}
        hora={editMovHora}
        unidade={editMovUnidade}
        quantidade={editMovQuantidade}
        novoEstoque={editMovNovoEstoque}
        motivo={editMovMotivo}
        unitOptions={unidadeOptions}
        insumosProdutos={insumosProdutos}
        unitLabel={unidadeLabel}
        onOpenChange={(open) => {
          setEditMovOpen(open)
          if (!open) {
            setEditMovTarget(null)
            setEditMovSaving(false)
            setEditMovDeleting(false)
          }
        }}
        onProdutoChange={setEditMovProduto}
        onDataChange={(value) => {
          const iso = dateInputToIso(value)
          setEditMovData(iso || value)
        }}
        onHoraChange={setEditMovHora}
        onUnidadeChange={setEditMovUnidade}
        onQuantidadeChange={setEditMovQuantidade}
        onNovoEstoqueChange={setEditMovNovoEstoque}
        onMotivoChange={setEditMovMotivo}
        onCancel={() => {
          setEditMovOpen(false)
          setEditMovTarget(null)
        }}
        onSave={() => void saveMovementEdit()}
        onDelete={() => void deleteMovementEdit()}
      />

      <InsumosPurchaseDialog
        actionables={overviewActionables}
        dialogClassName={dialogMediumClass}
        isAuthed={isAuthed}
        loading={overviewLoading}
        open={purchaseDialogOpen}
        onOpenChange={setPurchaseDialogOpen}
        onOpenQuickOperation={openQuickOperation}
        onClose={() => setPurchaseDialogOpen(false)}
        renderLoadingText={renderLoadingText}
        unit={unidade}
        unitLabel={unidadeLabel}
      />

      <InsumosSafeModeBanner visible={!!proxyStatus?.mutationsBlocked} />

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
                            <InsumosCategoryPoliciesPanel
                              panelOpen={panelOpen}
                              isAuthed={isAuthed}
                              policyFormLabel={policyFormLabel}
                              policyFormSlug={policyFormSlug}
                              policyFormSlugPlaceholder={slugifyCategoria(policyFormLabel) || 'ex: toxina-botulinica'}
                              policyFormSuggestion={policyFormSuggestion}
                              policyFormEditingSlug={policyFormEditingSlug}
                              policyFormRequiresLot={policyFormRequiresLot}
                              policyFormRequiresExpiry={policyFormRequiresExpiry}
                              policyFormFefo={policyFormFefo}
                              adminCategorySuggestions={adminCategorySuggestions}
                              adminCategoryPolicies={adminCategoryPolicies}
                              adminCategoryPoliciesLoading={adminCategoryPoliciesLoading}
                              dragHandleProps={handleProps || undefined}
                              onToggleOpen={() => setDetailsKeyOpen(OVERVIEW_PANEL_OPEN_KEYS.policies, !panelOpen)}
                              onPolicyFormLabelChange={setPolicyFormLabel}
                              onPolicyFormSlugChange={(value) => {
                                setPolicyFormSlugTouched(true)
                                setPolicyFormSlug(value)
                              }}
                              onPolicyFormSuggestionChange={(value) => {
                                const next = String(value)
                                setPolicyFormSuggestion(next)
                                if (next === '__NONE__') return
                                const hit = adminCategorySuggestions.find((suggestion) => suggestion.slug === next)
                                if (!hit) return
                                setPolicyFormLabel(hit.label)
                                setPolicyFormSlugTouched(true)
                                setPolicyFormSlug(hit.slug)
                              }}
                              onPolicyFormRequiresLotChange={setPolicyFormRequiresLot}
                              onPolicyFormRequiresExpiryChange={(value) => {
                                setPolicyFormRequiresExpiry(value)
                                if (!value) setPolicyFormFefo(false)
                              }}
                              onPolicyFormFefoChange={(value) => {
                                setPolicyFormFefo(value)
                                if (value) setPolicyFormRequiresExpiry(true)
                              }}
                              onResetPolicyForm={resetPolicyForm}
                              onSaveCategoryPolicy={() => void saveCategoryPolicy()}
                              onStartEditPolicyForm={startEditPolicyForm}
                              onDeleteCategoryPolicy={(slug) => void deleteCategoryPolicy(slug)}
                            />
                          </div>
                        )
                      }

                      if (panelId === 'alerts') {
                        return (
                          <div ref={dragProvided.innerRef} {...dragProvided.draggableProps}>
                            <InsumosAlertsPanel
                              panelOpen={panelOpen}
                              dragHandleProps={handleProps || undefined}
                              showOverviewLoadingProgress={showOverviewLoadingProgress}
                              loadingPercent={loadingPercent}
                              overviewCriticosCount={overviewCriticosCount}
                              overviewAtencaoCount={overviewAtencaoCount}
                              alertasStatus={alertasStatus}
                              alertasCategoria={alertasCategoria}
                              alertasFluxo={alertasFluxo}
                              alertasBusca={alertasBusca}
                              alertasCategorias={alertasCategorias}
                              alertasSortKey={alertasSortKey}
                              alertasSortDir={alertasSortDir}
                              rows={alertasLinhasOrdenadas}
                              recommendationByCode={alertasRecommendationByCode}
                              purchaseDisabled={!isAuthed || !(overviewActionables?.reposicao || []).length}
                              isAuthed={isAuthed}
                              emptyContent={renderListPlaceholder(insightsLoading, 'Sem alertas.')}
                              onToggleOpen={() => setDetailsKeyOpen(OVERVIEW_PANEL_OPEN_KEYS.alerts, !panelOpen)}
                              onOpenPurchaseDialog={() => setPurchaseDialogOpen(true)}
                              onAlertasStatusChange={setAlertasStatus}
                              onAlertasCategoriaChange={setAlertasCategoria}
                              onAlertasFluxoChange={setAlertasFluxo}
                              onAlertasBuscaChange={setAlertasBusca}
                              onSortChange={(key) => {
                                if (alertasSortKey === key) {
                                  setAlertasSortDir((dir) => (dir === 'asc' ? 'desc' : 'asc'))
                                  return
                                }
                                setAlertasSortKey(key)
                                setAlertasSortDir(key === 'status' ? 'asc' : 'desc')
                              }}
                              onSelectBarcode={(code) => selectQuickCodigo(code, { setSearch: true, snapshot: null })}
                              onToggleMarcaFilter={(value) => {
                                if (!value) return
                                setAlertasMarca((prev) => (prev === value ? '' : value))
                              }}
                              onToggleCategoriaFilter={(value) => setAlertasCategoria((prev) => (prev === value ? '' : value))}
                              onToggleStatusFilter={(value) => setAlertasStatus((prev) => (prev === value ? 'TODOS' : (value as AlertasStatusFilter)))}
                              onOpenQuickOperation={openQuickOperation}
                              onOpenQualityFix={openQualityFix}
                            />
                          </div>
                        )
                      }

                      return (
                        <div ref={dragProvided.innerRef} {...dragProvided.draggableProps}>
                          <InsumosChartsPanel
                            panelOpen={panelOpen}
                            dragHandleProps={handleProps || undefined}
                            chartsFilterTipo={chartsFilterTipo}
                            chartsFilterY={chartsFilterY}
                            chartsFilterX={chartsFilterX}
                            chartsFilterView={chartsFilterView}
                            chartsFilterTop={chartsFilterTop}
                            chartsSearch={chartsSearch}
                            canAddChart={!overviewLoading && !insightsLoading && chartSlots.length < MAX_CHARTS}
                            canResetCharts={!overviewLoading && !insightsLoading}
                            chartCards={chartCards}
                            presetOptions={chartPresetOptions}
                            emptyContent={
                              <div className="rounded-xl border border-white/10 bg-black/10 p-6 text-sm text-blue-100/70">
                                Nenhum gráfico encontrado para esses filtros.
                              </div>
                            }
                            onToggleOpen={() => setDetailsKeyOpen(OVERVIEW_PANEL_OPEN_KEYS.charts, !panelOpen)}
                            onChartsFilterTipoChange={setChartsFilterTipo}
                            onChartsFilterYChange={setChartsFilterY}
                            onChartsFilterXChange={setChartsFilterX}
                            onChartsFilterViewChange={setChartsFilterView}
                            onChartsFilterTopChange={setChartsFilterTop}
                            onChartsSearchChange={setChartsSearch}
                            onAddChart={() => {
                              if (chartSlots.length >= MAX_CHARTS) return
                              setChartSlots((prev) => [
                                ...prev,
                                { presetId: 'movements', groupBy: 'tempo', mode: 'inout', metric: 'qtd', view: 'bar', topN: 8 },
                              ])
                            }}
                            onResetCharts={() => setChartSlots(DEFAULT_CHART_SLOTS)}
                            onPresetChange={handleChartPresetChange}
                            onRemoveChart={handleRemoveChart}
                            onDistributionGroupByChange={handleDistributionGroupByChange}
                            onMovementsGroupByChange={handleMovementsGroupByChange}
                            onMovementsModeChange={handleMovementsModeChange}
                            onMetricChange={handleChartMetricChange}
                            onViewChange={handleChartViewChange}
                            onTopNChange={handleChartTopNChange}
                          />
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

      <InsumosQualityMatchesDialog
        open={qualityMatchesOpen}
        dialogClassName={dialogMediumClass}
        issue={qualityMatchesIssue}
        items={qualityMatchesItems}
        savingRegistro={qualityMatchesSavingRegistro}
        isAuthed={isAuthed}
        unit={unidade}
        unitLabel={unidadeLabel}
        onOpenChange={(next) => {
          setQualityMatchesOpen(next)
          if (!next) {
            setQualityMatchesIssue(null)
            setQualityMatchesItems([])
            setQualityMatchesSavingRegistro('')
          }
        }}
        onEditItem={(item) => {
          setQualityMatchesOpen(false)
          openEditDialog(item)
        }}
        onDeleteRegistro={(registro) => void deleteInsumoByRegistro(registro)}
      />

      <InsumosEditDialog
        open={editOpen}
        dialogClassName={dialogLargeClass}
        target={editTarget}
        isAuthed={isAuthed}
        canUseApi={canUseApi}
        isManagerRole={isManagerRole}
        saving={editSaving}
        saveError={editSaveError}
        validationErrors={editValidationErrors}
        codigo={editCodigo}
        codigosExtras={editCodigosExtras}
        produto={editProduto}
        categoria={editCategoria}
        categoriaRequiresLot={editCategoriaRequiresLot}
        categoriaRequiresExpiry={editCategoriaRequiresExpiry}
        categoriaFefo={editCategoriaFefo}
        marca={editMarca}
        tipoUnidade={editTipoUnidade}
        especificacao={editEspecificacao}
        concentracao={editConcentracao}
        volume={editVolume}
        homologado={editHomologado}
        calibre={editCalibre}
        precoCusto={editPrecoCusto}
        estoqueMinimo={editEstoqueMinimo}
        lote={editLote}
        dataValidade={editDataValidade}
        optionalDetailsOpen={detailsOpen['insumos.details.edit.optional'] ?? true}
        lotCategorias={lotCategorias}
        insumosMarcas={insumosMarcas}
        insumosTiposUnidade={insumosTiposUnidade}
        onOpenChange={(open) => {
          setEditOpen(open)
          if (!open) setEditTarget(null)
        }}
        onClearValidationError={clearEditValidationError}
        onCodigoChange={setEditCodigo}
        onCodigosExtrasChange={setEditCodigosExtras}
        onProdutoChange={setEditProduto}
        onCategoriaChange={setEditCategoria}
        onCategoriaRequiresLotChange={setEditCategoriaRequiresLot}
        onCategoriaRequiresExpiryChange={(value) => {
          setEditCategoriaRequiresExpiry(value)
          if (!value) setEditCategoriaFefo(false)
        }}
        onCategoriaFefoChange={(value) => {
          setEditCategoriaFefo(value)
          if (value) setEditCategoriaRequiresExpiry(true)
        }}
        onMarcaChange={setEditMarca}
        onTipoUnidadeChange={setEditTipoUnidade}
        onEspecificacaoChange={setEditEspecificacao}
        onConcentracaoChange={setEditConcentracao}
        onVolumeChange={setEditVolume}
        onHomologadoChange={setEditHomologado}
        onCalibreChange={setEditCalibre}
        onPrecoCustoChange={setEditPrecoCusto}
        onEstoqueMinimoChange={setEditEstoqueMinimo}
        onLoteChange={setEditLote}
        onDataValidadeChange={setEditDataValidade}
        onOptionalDetailsToggle={(open) => setDetailsKeyOpen('insumos.details.edit.optional', open)}
        onCancel={() => setEditOpen(false)}
        onDelete={deleteEdit}
        onSave={saveEdit}
      />

      <InsumosLotDialog
        open={lotDialogOpen}
        dialogClassName={dialogSmallClass}
        item={lotSelecionado}
        lotValue={lotEditLote}
        expiryValue={lotEditValidade}
        onOpenChange={setLotDialogOpen}
        onLotChange={setLotEditLote}
        onExpiryChange={setLotEditValidade}
        onSave={saveLot}
        saving={lotSaving}
        isAuthed={isAuthed}
      />

        <Droppable droppableId="main-panels" direction={mainPanelsDirection}>
          {(dropProvided) => (
            <div
              ref={dropProvided.innerRef}
              {...dropProvided.droppableProps}
              className="max-w-6xl mx-auto flex flex-col lg:flex-row gap-3"
            >
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
            <InsumosMovementsPanel
              panelOpen={movPanelOpen}
              dragHandleProps={dragProvided.dragHandleProps || undefined}
              movTipo={movTipo}
              movFilterCategoria={movFilterCategoria}
              movFilterMarca={movFilterMarca}
              movSearch={movSearch}
              movSortKey={movSortKey}
              movSortDir={movSortDir}
              lotCategorias={lotCategorias}
              insumosMarcas={insumosMarcas}
              isAuthed={isAuthed}
              rows={movementRows}
              emptyContent={
                movLoadError && !movLoading && isAuthed ? (
                  <span className="text-red-200">
                    Erro ao carregar movimentações ({movLoadError.status || 'erro'}
                    {movLoadError.code ? `/${movLoadError.code}` : ''}): {movLoadError.message}
                  </span>
                ) : (
                  renderListPlaceholder(movLoading, 'Sem movimentações.')
                )
              }
              listContainerRef={movListContainerRef}
              onToggleOpen={() => setDetailsKeyOpen(MAIN_PANEL_OPEN_KEYS.mov, !movPanelOpen)}
              onTipoChange={setMovTipo}
              onCategoriaChange={setMovFilterCategoria}
              onMarcaChange={setMovFilterMarca}
              onSearchChange={setMovSearch}
              onOpenInventoryList={() => openInsumosListModal()}
              onExportCsv={() => {
                const deIso = dateInputToIso(movDe)
                const ateIso = dateInputToIso(movAte)
                const params = new URLSearchParams({
                  unidade,
                  ...(selectedCodigoBarras.trim() ? { codigoBarras: selectedCodigoBarras.trim() } : {}),
                  ...(movTipo !== 'TODOS' ? { tipo: movTipo } : {}),
                  ...(deIso ? { de: deIso } : {}),
                  ...(ateIso ? { ate: ateIso } : {}),
                })
                window.open(`/api/insumos/export/movimentacoes.csv?${params.toString()}`, '_blank', 'noopener,noreferrer')
              }}
              onSortChange={(key) => {
                if (movSortKey === key) {
                  setMovSortDir((dir) => (dir === 'asc' ? 'desc' : 'asc'))
                  return
                }
                setMovSortKey(key)
                setMovSortDir(key === 'dataHora' ? 'desc' : 'asc')
              }}
              onProductClick={(productName) => {
                const product = String(productName || '').trim()
                if (!product || product === '-') return
                setSelectedCodigoBarras('')
                setMovFilterCategoria('')
                setMovFilterMarca('')
                setMovSearch((prev) => (normalizeText(prev) === normalizeText(product) ? '' : product))
              }}
              onCategoryClick={(categoryName) => {
                const category = String(categoryName || '').trim()
                if (!category || category === '-') return
                setSelectedCodigoBarras('')
                setMovSearch('')
                setMovFilterCategoria((prev) => (normalizeText(prev) === normalizeText(category) ? '' : category))
              }}
              onBrandClick={(brandName) => {
                const brand = String(brandName || '').trim()
                if (!brand || brand === '-') return
                setSelectedCodigoBarras('')
                setMovSearch('')
                setMovFilterMarca((prev) => (normalizeText(prev) === normalizeText(brand) ? '' : brand))
              }}
              onEditMovement={openMovementEditDialog}
            />
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
