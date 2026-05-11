export type InsumosHealth = {
  ok?: boolean
  ready?: boolean
  service?: string
  runtime?: string
  storage?: string
  dbConfigured?: boolean
  unidades?: string[]
}

export type InsumosUser = {
  username?: string
  displayName?: string
  name?: string
  email?: string
  role?: string
  photoUrl?: string
  allowedUnits?: string[]
}

export type Insumo = {
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

export type Movimentacao = {
  id?: string
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

export type NotificationsSummary = {
  generatedAt?: string
  unidade?: string
  counts?: { lowStock?: number; expiringSoon?: number; expiredWithStock?: number }
  lowStock?: Array<{ codigoBarras?: string; produto?: string; estoqueAtual?: number; estoqueMinimo?: number; categoria?: string }>
  expiringSoon?: Array<{ codigoBarras?: string; produto?: string; estoqueAtual?: number; dataValidade?: string; dias?: number; categoria?: string }>
  expiredWithStock?: Array<{ codigoBarras?: string; produto?: string; estoqueAtual?: number; dataValidade?: string; categoria?: string }>
}

export type EstoqueResumo = {
  totalInsumos?: number
  valorEstoqueTotal?: number
  criticos?: number
}

export type Actionables = {
  unidade?: string
  reposicao?: Array<{ codigoBarras?: string; produto?: string; categoria?: string; estoqueAtual?: number; estoqueMinimo?: number; suggestedPurchaseQty?: number; estimatedValue?: number }>
  transferencias?: Array<{ codigoBarras?: string; produto?: string; categoria?: string; from?: string; to?: string; qty?: number; estimatedValue?: number }>
  perdasValidade?: Array<{ codigoBarras?: string; produto?: string; categoria?: string; estoqueAtual?: number; dataValidade?: string; lossValue?: number }>
  rupturas?: Array<{ codigoBarras?: string; produto?: string; categoria?: string; estoqueMinimo?: number; estimatedImpact?: number }>
}

export type EstoqueAlerta = {
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

export type RoiInsights = {
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

export type QualityIssue = {
  severity?: 'CRITICAL' | 'WARN' | 'INFO' | string
  code?: string
  message?: string
  registro?: string
  codigoBarras?: string
  produto?: string
  unidade?: string
  suggestion?: string
}

export type QualityReport = {
  generatedAt?: string
  unidade?: string
  summary?: { total?: number; bySeverity?: Record<string, number> }
  issues?: QualityIssue[]
}

export type OverviewBundleData = {
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

export type InsightsBundleData = {
  alertas?: EstoqueAlerta[] | null
  trends?: unknown
  turnover?: {
    saida?: unknown
    entrada?: unknown
  } | null
}

export type InsumosProxyStatus = {
  ok?: boolean
  localDirect?: boolean
  target?: string
  isProductionTarget?: boolean
  localSafeMode?: boolean
  mutationsBlocked?: boolean
}

export type ShareFile = {
  name: string
  size?: number
  contentType?: string
  url?: string
}

export type SharePayload = {
  title?: string
  text?: string
  url?: string
  files?: ShareFile[]
}

export type ShareHistoryItem = SharePayload & {
  id: string
  createdAt: string
}

export type CategoryPolicy = {
  slug: string
  label?: string
  requiresLot?: boolean
  requiresExpiry?: boolean
  fefo?: boolean
  createdAt?: string | null
  updatedAt?: string | null
}

export type CategoryPolicySuggestion = {
  slug: string
  label: string
}

export type ApiError = {
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

export type UserPrefs = {
  overviewPanelOrder?: string[]
  mainPanelOrder?: string[]
  detailsOpen?: Record<string, boolean>
}

export type OfflineQueueItem = {
  id: string
  ts: number
  path: string
  method: string
  body?: unknown
}

export type InsumosOverviewPeriod = '7d' | '30d' | '1y' | 'custom'
export type InsumosQuickOperation = 'ENTRADA' | 'BAIXA' | 'AJUSTE' | 'TRANSFERENCIA'
export type InsumosLayoutAction = 'expandAll' | 'collapseAll' | 'reset'
export type InsumosUiSection =
  | 'context'
  | 'workspace'
  | 'overview'
  | 'inventory'
  | 'quick-operations'
  | 'movements'
  | 'policies'
  | 'history'
  | 'governance'
export type InsumosWorkspaceMode = 'inventory' | 'movements' | 'analytics' | 'governance'

export type InsumosOverviewQuery = {
  action?: 'reload'
  period?: InsumosOverviewPeriod
  from?: string
  to?: string
}

export type InsumosLoadState<T> = {
  data: T
  loading: boolean
  loaded: boolean
  error: string | null
}

export type InsumosMutationResult = {
  ok: boolean
  changed: boolean
  error?: string
}

export type QuickCandidate = {
  registro: string
  lote: string
  dataValidade: string | null
  estoque: number
}

export type QuickActionFeedback = {
  type: 'success' | 'error'
  message: string
}

export type InsumosHeaderStatus = {
  online: boolean | null
  authed: boolean | null
  integrated: boolean | null
  unidades: string[]
  allowedUnits: string[]
}

export type InsumosHeaderStockState = {
  value: number | null
  loading: boolean
  percent: number | null
  entradaValor?: number | null
  saidaValor?: number | null
}

export type InsumosHeaderState = {
  status: InsumosHeaderStatus | null
  stock: InsumosHeaderStockState | null
  selectedUnit: string
  overview: Required<Pick<InsumosOverviewQuery, 'period'>> & Pick<InsumosOverviewQuery, 'from' | 'to'>
}

export type InsumosHeaderAction =
  | { type: 'set-unit'; value: string }
  | { type: 'set-overview'; value: InsumosOverviewQuery }
  | { type: 'reload-overview' }
  | { type: 'quick-op'; value: InsumosQuickOperation }
  | { type: 'layout'; value: InsumosLayoutAction }
