import type { AtendimentoFilters, AtendimentoForm } from '@/atendimentoDomain'
import { buildAtendimentoQuery } from '@/atendimentoDomain'

const API_BASE = '/api/atendimento'

type UnknownRecord = Record<string, unknown>

export type AtendimentoCellStyle = {
  backgroundColor?: string
  fontColor?: string
  fontFamily?: string
  fontSize?: number | null
  fontWeight?: string
  fontStyle?: string
  horizontalAlignment?: string
  verticalAlignment?: string
  numberFormat?: string
}

export type AtendimentoRawCell = {
  col: number
  a1: string
  value: unknown
  formula?: string
  style?: AtendimentoCellStyle
}

export type AtendimentoImportSummary = {
  tabs?: number
  rawRows?: number
  procedures?: number
  procedureCodes?: number
  professionals?: number
  schedules?: number
  inventory?: number
  managementItems?: number
  goalTableRows?: number
  monthlyGoals?: number
  monthlyGoalLevels?: number
  tabSummaries?: AtendimentoImportTabSummary[]
}

export type AtendimentoLatestImport = {
  id: string
  source_sheet_id: string
  source_name: string
  summary?: AtendimentoImportSummary
  created_at?: string
}

export type AtendimentoAttendance = AtendimentoForm & {
  id: string
  unitSlug: string
  unitName: string
  value: number
  sourceTab?: string | null
  sourceRow?: number | null
  createdAt?: string
  updatedAt?: string
}

export type AtendimentoReferences = {
  units: Array<{ slug: string; name: string }>
  professionals: Array<{ id: string; name: string; role?: string; status?: string; units?: string[]; shift?: string; roles?: string[]; turnos?: string[]; backgroundColor?: string; fontColor?: string; fontFamily?: string; fontSize?: number | null; fontWeight?: string; fontStyle?: string; alias?: string; phone?: string; email?: string; instagram?: string }>
  procedures: Array<{ id: string; name: string; codes: string[] }>
}

export type AtendimentoOverview = {
  summary: {
    totalAttendances: number
    quantityTotal: number
    countMode: 'row'
    totalValue: number
    averageTicket: number
    distinctClients: number
  }
  monthly: Array<{ month: string; count: number; quantityTotal: number; value: number }>
  rankings: {
    procedures: Array<{ label: string; count: number; quantityTotal: number; value: number }>
    injectors: Array<{ label: string; count: number; quantityTotal: number; value: number }>
    consultants: Array<{ label: string; count: number; quantityTotal: number; value: number }>
  }
}

export type AtendimentoLocalMirrorStatus = {
  mode: 'local-sandbox' | string
  syncedAt: string | null
  updatedAt: string | null
  rowCounts: Record<string, number>
  attendances: number
  minServiceDate: string | null
  maxServiceDate: string | null
}

export type AtendimentoReportPreview = {
  unit: string
  from: string
  to: string
  summary: { doctors: number; attendances: number; quantityTotal: number; totalValue: number; remuneration: number }
  doctors: Array<{
    doctorName: string
    count: number
    quantityTotal: number
    totalValue: number
    remuneration: number
    rows: Array<{ date: string; clientName: string; procedureName: string; quantity: number; value: number; consultantName: string }>
  }>
}

export type AtendimentoManagementTabSummary = {
  name: string
  category: string
  sensitive: boolean
  rows: number
  importedAt?: string
}

export type AtendimentoImportTabSummary = {
  tabName: string
  category: string
  sensitive: boolean
  active: boolean
  rowCount: number
  nonEmptyRows: number
  headers?: string[]
  formulaCount?: number
}

export type AtendimentoManagementItem = {
  id: string
  sourceTab: string
  sourceRow: number
  category: string
  label: string
  active: boolean
  sensitive: boolean
  unitSlug?: string
  recordDate?: string
  payload?: { values?: unknown[]; [key: string]: unknown }
  importedAt?: string
}

export type AtendimentoManagementCatalog = AtendimentoReferences & {
  latestImport?: AtendimentoLatestImport | null
  scheduleSummary?: Array<{ unitSlug: string; unitName: string; days: number; firstDate: string; lastDate: string }>
  scheduleDropdowns?: Array<{ unitSlug: string; unitName: string; columns: string[]; values: string[] }>
  appsScript?: {
    noServiceLabel: string
    sheets: { team: string; schedule: string; conversion: string; tempExport: string }
    noServiceStyle: { background: string; fontColor: string; fontWeight: string; fontStyle: string }
    schedulePattern: { startRow: number; blockHeight: number; patternRows: number[] }
    onEditMaxCells: number
    backgroundCacheRange: string
    cache: { styleMapKey: string; backgroundPrefix: string; ttlSecondsStyles: number; ttlSecondsBackgrounds: number }
    features: { onEditMaxCells: number; autoInitializeLayoutOnOpen: boolean }
    conversion: { columns: { bx: string; bz: string }; unitsOrder: string[]; ignoreLabels: string[]; specialRows: string[]; weeksPerMonth: number }
    reportPeriod: { targetYear: number; targetMonth: number; weekNumber: number; monthName: string }
    reports: { folderId: string; fileNamePrefix: string; pdfPortrait: boolean; deleteTempAfterExport: boolean; pdfExportRetries: number; pdfExportBackoffMs: number }
  }
  tabs: AtendimentoManagementTabSummary[]
}

export type AtendimentoManagementCommercial = {
  summary: AtendimentoOverview['summary']
  monthly: AtendimentoOverview['monthly']
  rankings: AtendimentoOverview['rankings']
  sourceTabs: Array<{ sourceTab: string; rows: number; activeRows?: number }>
  items: AtendimentoManagementItem[]
}

export type AtendimentoManagementFinance = {
  sourceTabs: Array<{ sourceTab: string; rows: number }>
  items: AtendimentoManagementItem[]
  monthlyGoals?: AtendimentoMonthlyGoal[]
  monthlyGoalLevels?: AtendimentoMonthlyGoalLevel[]
  goalTables?: AtendimentoGoalTable[]
  attendanceTotals?: { units: Array<{ unitSlug: string; unitName: string; count: number; quantityTotal: number; value: number }> }
}

export type AtendimentoMonthlyGoal = {
  id: string
  unitSlug: string
  unitName: string
  month: string
  value: number
  updatedAt?: string
  updatedBy?: string
  sourceTab?: string
  sourceRow?: number | null
  sourceCol?: number | null
}

export type AtendimentoMonthlyGoalLevel = AtendimentoMonthlyGoal & {
  levelKey: 'first' | 'second' | 'third' | 'super' | string
  levelLabel: string
}

export type AtendimentoMonthlyGoalsResponse = {
  goals: AtendimentoMonthlyGoal[]
  goalLevels?: AtendimentoMonthlyGoalLevel[]
  units: Array<{ slug: string; name: string }>
}

export type AtendimentoGoalTableRow = {
  id: string
  sourceTab: string
  sourceRow: number
  year: number
  unitSlug: string
  unitName: string
  label: string
  values: unknown[]
  formulas?: unknown[]
  importedAt?: string
}

export type AtendimentoGoalTable = {
  sourceTab: string
  year: number
  unitSlug: string
  unitName: string
  title: string
  columns: string[]
  rows: AtendimentoGoalTableRow[]
}

export type AtendimentoGoalTablesResponse = {
  tables: AtendimentoGoalTable[]
}

export type AtendimentoManagementInventory = {
  data: Array<{ id: string; product: string; barraShoppingSul: number | null; novoHamburgo: number | null; sourceRow: number; importedAt?: string }>
}

export type AtendimentoManagementPeople = {
  professionals: AtendimentoReferences['professionals']
  items: AtendimentoManagementItem[]
}

export type AtendimentoManagementRawTabs = {
  tabs: AtendimentoManagementTabSummary[]
  rows: Array<{ sourceTab: string; sourceRow: number; category: string; sensitive: boolean; cells: AtendimentoRawCell[]; importedAt?: string }>
  total: number
  limit: number
  offset: number
}

export type AtendimentoManagementConversionReport = {
  period: { targetYear: number; targetMonth: number; weekNumber: number; monthName: string }
  source?: { monthColumn: string; weekColumn: string; bxColumn: string; bzColumn: string }
  tempExport?: {
    sheetName: string
    fileName: string
    folderId: string
    drivePath: string
    deleteAfterExport: boolean
    pdf: {
      format: string
      size: string
      portrait: boolean
      fitWidth: boolean
      showSheetNames: boolean
      printTitle: boolean
      pageNumbers: boolean
      gridlines: boolean
      frozenRows: boolean
      retries: number
      backoffMs: number
    }
  }
  config?: { fileNamePrefix: string; unitsOrder: string[]; ignoreLabels: string[]; specialRows: string[] }
  doctorRanking?: {
    period?: {
      monthStart?: string
      monthEnd?: string
      weekStart?: string
      weekEnd?: string
      metricStart?: string
      metricEnd?: string
      metricSource?: string
      weekNumber?: number
    } | null
    intervalMultiplier?: number
    objectiveName?: string
    sections: Array<{
      unitName: string
      unitSlug: string
      isAggregate?: boolean
      aggregateNotice?: string
      goalPlan?: {
        periodOperationalDays: number
        periodGoal: number
        dailyGoal: number
        segments: Array<{
          monthKey: string
          monthlyGoal: number
          monthOperationalDays: number
          periodOperationalDays: number
          dailyGoal: number
          periodGoal: number
        }>
      }
      metrics: Record<string, {
        label: string
        weekValue: number
        totalValue: number
        position?: string
        formula?: string
        levelCounts?: { level0?: number; level1?: number; level2?: number; level3?: number }
        proportion?: number
      }>
      optimization?: {
        selectedMultiplier: number | null
        defaultIntervalMultiplier: number | null
        previousIntervalMultiplier?: number | null
        intervalMultiplierMin: number
        intervalMultiplierMax: number
        objectiveName: string
        tieBreakPolicy: 'previous_then_widest_plateau_center' | string
        selectionReason: 'previous_in_optimal_plateau' | 'widest_optimal_plateau_center' | 'optimal_singleton' | 'not_applicable' | string
        optimalPlateau: AtendimentoDoctorConversionPlateau | null
        optimalPlateaus: AtendimentoDoctorConversionPlateau[]
        homogeneityCurve: AtendimentoDoctorConversionPlateau[]
        statusCode: string
        optimizationStatusCode: string
        counts: { N0: number; N1: number; N2: number; N3: number }
        proportions: { p0: number; p1: number; p2: number; p3: number }
        legacyReasons: { upperRatio: number; lowerRatio: number; innerRatio: number; outerRatio: number }
        balancedReasons: { lowerSide: number; upperSide: number; center: number; extremes: number }
        homogeneityScore: number
        homogeneityLoss: number
        diagnostics: {
          skewness?: number
          kurtosis?: number
          mad?: number
          iqr?: number
          outlierCount?: number
          outlierHeavy?: boolean
          breakpointCount?: number
          candidatesEvaluated?: number
          allBandsPopulated?: boolean
          extremesPopulated?: boolean
          cutoffOutsideDistribution?: boolean
          unstableJump?: boolean
        }
        configHash?: string
        calendarHash?: string
      }
      history?: Array<{
        id?: string | null
        unitSlug: string
        unitName: string
        periodStart: string
        periodEnd: string
        reportDate?: string
        weekOfMonth?: number | null
        selectedMultiplier: number | null
        previousIntervalMultiplier?: number | null
        selectionReason?: string | null
        optimalPlateau?: AtendimentoDoctorConversionPlateau | null
        homogeneityScore: number
        homogeneityLoss: number
        statusCode: string
        optimizationStatusCode: string
        counts: { N0?: number; N1?: number; N2?: number; N3?: number }
        proportions: { p0?: number; p1?: number; p2?: number; p3?: number }
        configHash: string
        calendarHash: string
        computedAt?: string | null
      }>
      doctors: Array<{ name: string; unitName?: string; unitSlug?: string; weekValue: number; totalValue: number; score: number; position?: string; rank: number; classification?: string; level?: number; modifiedZ?: number; distanceToCutOff?: number; distanceToLowerLimit?: number; distanceToUpperLimit?: number }>
    }>
    topDoctors: Array<{ name: string; unitName: string; unitSlug: string; weekValue: number; totalValue: number; score: number; position?: string; rank: number; classification?: string; level?: number }>
  }
  sections: Array<{
    unitName: string
    unitSlug: string
    rows: Array<{ label: string; values: unknown[]; cells?: Array<{ value: unknown; formula?: string; style?: AtendimentoCellStyle }> }>
  }>
  warnings?: string[]
  summary?: {
    sections?: number
    rows?: number
    doctorRankingSource?: string
    scheduleSource?: string
    scheduleCoverageMonths?: Array<{ unitSlug: string; unitName: string; month: string }>
  }
}

export type AtendimentoManagementCharts = {
  spreadsheetId: string
  configured: boolean
  hint?: string
  charts: Array<{ tabName: string; sheetId?: number; chartId: number; title?: string }>
}

export type AtendimentoInsumosFeed = {
  destination: 'insumos'
  category: string
  summary: { items: number; units: string[] }
  items: Array<{
    source: string
    sourceRow: number
    codigoBarras: string
    produto: string
    categoria: string
    marca: string
    tipoUnidade: string
    fonte: string
    estoqueMinimo: number
    estoques: Record<string, number>
    importedAt?: string
  }>
}

export type AtendimentoEscalaFeed = {
  destination: 'escala-profissionais'
  summary: { professionals: number; scheduleEntries: number; closedDays: number }
  professionals: Array<{ name: string; status: string; units: string[]; role: string; shift: string; nickname: string; phone: string; email: string; instagram: string; color: string; source: string }>
  schedule: Array<{ date: string; unit: string; professional: string }>
  closedDays: Array<{ date: string; unit: string; reason: string }>
}

type ApiResponse<T> = { ok: boolean; error?: string; hint?: string; requestId?: string } & T

type ApiErrorPayload = {
  error?: unknown
  message?: unknown
  hint?: unknown
}

function parseJson(text: string) {
  try {
    return text ? JSON.parse(text) : null
  } catch {
    return null
  }
}

function normalizeApiError(res: Response, json: ApiErrorPayload | null, text: string) {
  if (json?.hint) return `${json.error || json.message || `HTTP ${res.status}`}: ${json.hint}`
  if (json?.error) return String(json.error)
  if (json?.message) return String(json.message)
  const compact = String(text || '').replace(/\s+/g, ' ').trim()
  if (/<!doctype html|<html\b/i.test(compact)) return `O serviço de Atendimento não está disponível nesta instância (HTTP ${res.status}).`
  return compact ? compact.slice(0, 180) : `HTTP ${res.status}`
}

async function api<T>(path: string, opts: { method?: string; body?: unknown } = {}): Promise<ApiResponse<T>> {
  const method = opts.method || 'GET'
  try {
    const response = await fetch(`${API_BASE}${path}`, {
      method,
      credentials: 'include',
      headers: {
        accept: 'application/json',
        ...(opts.body === undefined ? {} : { 'content-type': 'application/json' }),
      },
      body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
    })
    const text = await response.text()
    const json = parseJson(text) as (ApiErrorPayload & UnknownRecord) | null
    const requestId = String(response.headers.get('x-request-id') || '').trim() || undefined
    if (!response.ok || json?.ok === false) {
      return { ok: false, error: normalizeApiError(response, json, text), requestId } as ApiResponse<T>
    }
    return { ...(json as ApiResponse<T>), requestId }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error || '')
    return { ok: false, error: `Falha de conexão com Atendimento. ${message}` } as ApiResponse<T>
  }
}

export async function fetchAtendimentoReferences() {
  return api<AtendimentoReferences>('/references')
}

export type AtendimentoDoctorConversionConfig = {
  defaultIntervalMultiplier: number | null
  intervalMultiplierMin: number
  intervalMultiplierMax: number
  objectiveName: string
  requireAllBandsIfPossible: boolean
  requireExtremesIfPossible: boolean
  stabilityTieBreak: boolean
  tieBreakPolicy: 'previous_then_widest_plateau_center' | string
  unstableJumpThreshold: number
  configHash: string
  updatedAt?: string | null
  updatedBy?: string | null
}

export type AtendimentoDoctorConversionPlateau = {
  start: number
  end: number
  startInclusive: boolean
  endInclusive: boolean
  width: number
  homogeneityScore: number
  loss: number
  counts: { level0: number; level1: number; level2: number; level3: number }
  proportions: { p0: number; p1: number; p2: number; p3: number }
  isOptimal: boolean
}

export type AtendimentoDoctorConversionHistoryItem = NonNullable<
  NonNullable<AtendimentoManagementConversionReport['doctorRanking']>['sections'][number]['history']
>[number]

export async function fetchAtendimentoLocalMirrorStatus() {
  return api<AtendimentoLocalMirrorStatus>('/local-mirror/status')
}

export async function fetchAtendimentoOverview(filters: AtendimentoFilters) {
  const qs = buildAtendimentoQuery(filters).toString()
  return api<AtendimentoOverview>(`/overview${qs ? `?${qs}` : ''}`)
}

export async function fetchAtendimentoAttendances(filters: AtendimentoFilters, paging: { limit?: number; offset?: number } = {}) {
  const qs = buildAtendimentoQuery(filters, paging).toString()
  return api<{ data: AtendimentoAttendance[]; total: number; limit: number; offset: number }>(`/attendances${qs ? `?${qs}` : ''}`)
}

export async function fetchAtendimentoDoctorSuggestion(unit: string, date: string) {
  const params = new URLSearchParams({ unit, date })
  return api<{ unitSlug: string; unitName: string; date: string; doctorName: string }>(`/doctor-suggestion?${params.toString()}`)
}

export async function fetchAtendimentoReportPreview(filters: { unit?: string; date?: string; from?: string; to?: string }) {
  const params = new URLSearchParams()
  if (filters.unit && filters.unit !== 'all') params.set('unit', filters.unit)
  if (filters.date) params.set('date', filters.date)
  if (filters.from) params.set('from', filters.from)
  if (filters.to) params.set('to', filters.to)
  return api<AtendimentoReportPreview>(`/reports/preview?${params.toString()}`)
}

export async function createAtendimentoAttendance(payload: AtendimentoForm) {
  return api<{ data: AtendimentoAttendance }>('/attendances', { method: 'POST', body: payload })
}

export async function updateAtendimentoAttendance(id: string, payload: AtendimentoForm) {
  return api<{ data: AtendimentoAttendance }>(`/attendances/${encodeURIComponent(id)}`, { method: 'PATCH', body: payload })
}

export async function deleteAtendimentoAttendance(id: string) {
  return api<{ ok: boolean }>(`/attendances/${encodeURIComponent(id)}`, { method: 'DELETE' })
}

export async function importAtendimentoGoogleSheet(dryRun = true) {
  return api<{ dryRun: boolean; records: number; inserted?: number; updated?: number; skipped?: number; spreadsheetId?: string; tabs?: string[] }>(
    '/admin/import/google-sheet',
    { method: 'POST', body: { dryRun } },
  )
}

export async function fetchAtendimentoManagementCatalog() {
  return api<AtendimentoManagementCatalog>('/management/catalog')
}

export async function fetchAtendimentoManagementCommercial(filters: AtendimentoFilters) {
  const qs = buildAtendimentoQuery(filters).toString()
  return api<AtendimentoManagementCommercial>(`/management/commercial${qs ? `?${qs}` : ''}`)
}

export async function fetchAtendimentoManagementConversionReport(date?: string, filters?: Pick<AtendimentoFilters, 'unit' | 'from' | 'to'>) {
  const params = new URLSearchParams()
  if (date) params.set('date', date)
  if (filters?.unit && filters.unit !== 'all') params.set('unit', filters.unit)
  if (filters?.from) params.set('from', filters.from)
  if (filters?.to) params.set('to', filters.to)
  const qs = params.toString()
  return api<AtendimentoManagementConversionReport>(`/management/conversion-report${qs ? `?${qs}` : ''}`)
}

export async function fetchAtendimentoDoctorConversionConfig() {
  return api<{ config: AtendimentoDoctorConversionConfig }>('/doctor-conversion/config')
}

export async function updateAtendimentoDoctorConversionConfig(payload: Partial<AtendimentoDoctorConversionConfig>) {
  return api<{ config: AtendimentoDoctorConversionConfig }>('/doctor-conversion/config', { method: 'PUT', body: payload })
}

export async function fetchAtendimentoDoctorConversionHistory(filters: { unit?: string; before?: string; limit?: number } = {}) {
  const params = new URLSearchParams()
  if (filters.unit && filters.unit !== 'all') params.set('unit', filters.unit)
  if (filters.before) params.set('before', filters.before)
  if (filters.limit) params.set('limit', String(filters.limit))
  const qs = params.toString()
  return api<{ history: AtendimentoDoctorConversionHistoryItem[] }>(`/doctor-conversion/history${qs ? `?${qs}` : ''}`)
}

export async function optimizeAtendimentoDoctorConversion(payload: Record<string, unknown>) {
  return api<{ result: NonNullable<AtendimentoManagementConversionReport['doctorRanking']>['sections'][number] | null; config: AtendimentoDoctorConversionConfig }>(
    '/doctor-conversion/optimize',
    { method: 'POST', body: payload },
  )
}

export async function recomputeAtendimentoDoctorConversions(payload: Record<string, unknown>) {
  return api<{ recomputed: number; results: Array<{ unitSlug: string; period: unknown; optimization: unknown }> }>(
    '/doctor-conversion/recompute',
    { method: 'POST', body: payload },
  )
}

export async function fetchAtendimentoManagementCharts(tab?: string) {
  const params = new URLSearchParams()
  if (tab) params.set('tab', tab)
  const qs = params.toString()
  return api<AtendimentoManagementCharts>(`/management/charts${qs ? `?${qs}` : ''}`)
}

export async function fetchAtendimentoManagementFinance() {
  return api<AtendimentoManagementFinance>('/management/finance')
}

export async function fetchAtendimentoMonthlyGoals(filters: { month?: string; unit?: string } = {}) {
  const params = new URLSearchParams()
  if (filters.month) params.set('month', filters.month)
  if (filters.unit && filters.unit !== 'all') params.set('unit', filters.unit)
  const qs = params.toString()
  return api<AtendimentoMonthlyGoalsResponse>(`/management/finance/monthly-goals${qs ? `?${qs}` : ''}`)
}

export async function fetchAtendimentoGoalTables(filters: { year?: number; tab?: string } = {}) {
  const params = new URLSearchParams()
  if (filters.year) params.set('year', String(filters.year))
  if (filters.tab) params.set('tab', filters.tab)
  const qs = params.toString()
  return api<AtendimentoGoalTablesResponse>(`/management/finance/goal-tables${qs ? `?${qs}` : ''}`)
}

export async function upsertAtendimentoMonthlyGoal(payload: { unitSlug: string; month: string; value?: number; levels?: Record<string, number> }) {
  return api<{ goal: AtendimentoMonthlyGoal; goalLevels?: AtendimentoMonthlyGoalLevel[] }>('/management/finance/monthly-goals', { method: 'POST', body: payload })
}

export async function fetchAtendimentoManagementInventory() {
  return api<AtendimentoManagementInventory>('/management/inventory')
}

export async function fetchAtendimentoManagementPeople() {
  return api<AtendimentoManagementPeople>('/management/people')
}

export async function fetchAtendimentoManagementRawTabs(tab?: string, paging: { limit?: number; offset?: number } = {}) {
  const params = new URLSearchParams()
  if (tab) params.set('tab', tab)
  if (paging.limit) params.set('limit', String(paging.limit))
  if (paging.offset) params.set('offset', String(paging.offset))
  const qs = params.toString()
  return api<AtendimentoManagementRawTabs>(`/management/raw-tabs${qs ? `?${qs}` : ''}`)
}

export async function fetchAtendimentoInsumosFeed() {
  return api<AtendimentoInsumosFeed>('/management/feeds/insumos')
}

export async function fetchAtendimentoEscalaFeed() {
  return api<AtendimentoEscalaFeed>('/management/feeds/escala')
}

export async function importGerenciaGoogleSheet(dryRun = true) {
  return api<{ dryRun: boolean; tabCount?: number; tabs?: string[]; rawRows: number; procedures: number; procedureCodes: number; professionals: number; schedules?: number; inventory: number; managementItems: number; goalTableRows?: number; monthlyGoals?: number; monthlyGoalLevels?: number; spreadsheetId?: string; tabSummaries?: AtendimentoImportTabSummary[] }>(
    '/admin/import/google-sheet/gerencia',
    { method: 'POST', body: { dryRun } },
  )
}

export type CommercialPriority = 'high' | 'medium' | 'normal'

export type CommercialSegment = {
  key: string
  label: string
  priority: CommercialPriority
  nextAction: string
  evidence: Record<string, number>
}

export type CommercialProfile = {
  identityId: string
  name: string
  phone: string
  email: string
  sourceTypes: string[]
  identityQuality: string
  units: string[]
  lastAttendance: string | null
  recencyDays: number | null
  visitCount: number
  procedureCount: number
  completedProcedures: string[]
  saleCount: number
  lifetimeSales: number
  sales12m: number
  ticketAverage: number
  purchasedProcedures: string[]
  pendingSaleItems: number
  hasRecordedAttendance: boolean
  dataWarnings: string[]
  segments: CommercialSegment[]
  priority: CommercialPriority
  recommendedAction: string
  activeActionCount: number
  lastActionAt: string | null
}

export type CommercialAction = {
  id: string
  identityId: string
  unitSlug: string
  unitName: string
  segmentKey: string
  actionType: 'contact' | 'follow_up' | 'appointment' | 'relationship'
  status: 'open' | 'contacted' | 'responded' | 'scheduled' | 'won_sale' | 'returned' | 'closed' | 'cancelled'
  owner: string
  dueDate: string | null
  notes: string
  outcomeNotes: string
  createdBy: string
  completedAt: string | null
  createdAt: string
  updatedAt: string
}

export type CommercialPolicy = {
  activeContactCooldownDays: number
  returnRiskThresholds: number[]
  updatedBy: string
  updatedAt: string | null
}

export type CommercialOverview = {
  asOf: string
  policy: CommercialPolicy
  summary: { profiles: number; returnAtRisk: number; highValueInactive: number; frequent: number; balancedVip: number; reactivationPotential: number; averageTicket: number }
  actions: { actions: number; recoveredSalesClients: number; clinicalReturnClients: number }
  coverage: { confirmedIdentities: number; classifiedSaleItems: number; saleItems: number }
  dataQuality: { futureAttendancesExcluded: number; recencySource: 'completed_attendance_only'; saleItemsWithoutClassification: number }
  total: number
  limit: number
  offset: number
  profiles: CommercialProfile[]
}

export type CommercialProfileDetail = {
  asOf: string
  policy: CommercialPolicy
  profile: CommercialProfile
  actions: CommercialAction[]
  clinicalCadences: Array<{ procedureId: string; procedureName: string; cadenceDays: number | null; status: 'approved' | 'not_configured'; notes: string; unitSlug: string; unitName: string; approvedAt: string | null; approvedBy: string }>
}

export type ClientIdentityReviewItem = {
  id: string
  type: 'attendance_name_merge' | 'attendance_caixa' | 'app_attendance' | 'app_caixa' | 'lead_app' | 'lead_caixa'
  status: 'pending' | 'suggested' | 'ambiguous'
  confidence: number
  primaryName: string
  secondaryName: string
  evidence: Record<string, unknown>
  context: Record<string, unknown>
}

export type ClientIdentityReviewQueue = { total: number; limit: number; offset: number; items: ClientIdentityReviewItem[] }

export function fetchCommercialOverview(filters: { asOf?: string; unit?: string; segment?: string; priority?: string; q?: string; limit?: number; offset?: number } = {}) {
  const params = new URLSearchParams()
  Object.entries(filters).forEach(([key, value]) => { if (value !== undefined && value !== '' && value !== 'all') params.set(key, String(value)) })
  const qs = params.toString()
  return api<CommercialOverview>(`/commercial/overview${qs ? `?${qs}` : ''}`)
}

export function fetchClientIdentityReviewQueue(filters: { type?: ClientIdentityReviewItem['type']; q?: string; limit?: number; offset?: number } = {}) {
  const params = new URLSearchParams()
  Object.entries(filters).forEach(([key, value]) => { if (value !== undefined && value !== '') params.set(key, String(value)) })
  const qs = params.toString()
  return api<ClientIdentityReviewQueue>(`/commercial/review${qs ? `?${qs}` : ''}`)
}

export function fetchCommercialProfile(identityId: string, filters: { asOf?: string; unit?: string } = {}) {
  const params = new URLSearchParams()
  if (filters.asOf) params.set('asOf', filters.asOf)
  if (filters.unit && filters.unit !== 'all') params.set('unit', filters.unit)
  const qs = params.toString()
  return api<CommercialProfileDetail>(`/commercial/profiles/${encodeURIComponent(identityId)}${qs ? `?${qs}` : ''}`)
}

export function createCommercialAction(payload: { identityId: string; segmentKey: string; actionType: CommercialAction['actionType']; owner?: string; unit?: string; dueDate?: string; notes?: string }) {
  return api<{ id: string }>('/commercial/actions', { method: 'POST', body: payload })
}

export function updateCommercialAction(id: string, payload: { status: CommercialAction['status']; owner?: string; outcomeNotes?: string }) {
  return api<{ id: string; status: CommercialAction['status'] }>(`/commercial/actions/${encodeURIComponent(id)}`, { method: 'PATCH', body: payload })
}

export function fetchCommercialPolicy() {
  return api<{ policy: CommercialPolicy }>('/commercial/policy')
}

export function updateCommercialPolicy(payload: Pick<CommercialPolicy, 'activeContactCooldownDays' | 'returnRiskThresholds'>) {
  return api<{ policy: CommercialPolicy }>('/commercial/policy', { method: 'PUT', body: payload })
}

export function fetchCommercialCadences() {
  return api<{ cadences: Array<{ id: string; procedureId: string; procedureName: string; cadenceDays: number; status: string; notes: string; approvedBy: string; approvedAt: string | null; updatedBy: string; updatedAt: string | null; unitSlug: string; unitName: string }> }>('/commercial/cadences')
}

export function upsertCommercialCadence(payload: { procedureId: string; unit?: string; cadenceDays: number; status: 'draft' | 'approved' | 'disabled'; notes?: string }) {
  return api<{ id: string }>('/commercial/cadences', { method: 'PUT', body: payload })
}

export const __testables = {
  normalizeApiError,
  parseJson,
}
