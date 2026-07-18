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
  valueFormulaVersion?: string
  revision: number
  injectorId?: string | null
  consultantId?: string | null
  sourceTab?: string | null
  sourceRow?: number | null
  createdAt?: string
  updatedAt?: string
}

export type AtendimentoReferences = {
  units: Array<{ slug: string; name: string }>
  professionals: Array<{ id: string; canonicalId?: string; name: string; role?: string; status?: string; units?: string[]; shift?: string; roles?: string[]; turnos?: string[]; backgroundColor?: string; fontColor?: string; fontFamily?: string; fontSize?: number | null; fontWeight?: string; fontStyle?: string; alias?: string; phone?: string; email?: string; instagram?: string }>
  procedures: Array<{ id: string; name: string; codes: string[] }>
}

export type AtendimentoClientSuggestion = {
  name: string
  usageCount: number
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
  remunerationPolicy?: {
    version: string
    percentage: number
    minimum: number
    scope: 'report_preview_only'
    businessStatus: 'pending_confirmation'
  }
  doctors: Array<{
    doctorName: string
    count: number
    quantityTotal: number
    totalValue: number
    remuneration: number
    remunerationFormulaVersion?: string
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
      calendarMode?: 'unit-calendar' | 'per-unit-capacity-sum'
      calendarCompatible?: boolean
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
  if (json?.error === 'REVISION_CONFLICT') return 'Este lançamento foi alterado por outra pessoa. Atualize a lista antes de tentar novamente.'
  if (json?.error === 'REVISION_REQUIRED') return 'A versão do lançamento não foi informada. Atualize a lista e tente novamente.'
  if (json?.error === 'UNIT_FORBIDDEN') return 'Você não tem permissão para alterar esta unidade.'
  if (json?.error === 'PROFESSIONAL_ID_REQUIRED') return 'Selecione um profissional da lista para registrar uma identidade válida.'
  if (json?.error === 'PROFESSIONAL_IDENTITY_MISMATCH') return 'O profissional selecionado não corresponde ao nome do lançamento. Atualize a seleção.'
  if (json?.error === 'AMBIGUOUS_PROFESSIONAL') return 'Há mais de um profissional compatível. Selecione o cadastro correto na lista.'
  if (json?.error === 'INACTIVE_PROFESSIONAL') return 'Este profissional está inativo e não pode ser usado em novos lançamentos.'
  if (json?.error === 'PROFESSIONAL_NOT_AVAILABLE_FOR_UNIT') return 'Este profissional não está vinculado à unidade selecionada.'
  if (json?.error === 'PROFESSIONAL_ROLE_MISMATCH') return 'O profissional não possui o papel necessário para este campo.'
  if (json?.hint) return `${json.error || json.message || `HTTP ${res.status}`}: ${json.hint}`
  if (json?.error) return String(json.error)
  if (json?.message) return String(json.message)
  const compact = String(text || '').replace(/\s+/g, ' ').trim()
  return compact ? compact.slice(0, 180) : `HTTP ${res.status}`
}

async function api<T>(path: string, opts: { method?: string; body?: unknown; headers?: Record<string, string> } = {}): Promise<ApiResponse<T>> {
  const method = opts.method || 'GET'
  try {
    const response = await fetch(`${API_BASE}${path}`, {
      method,
      credentials: 'include',
      headers: {
        accept: 'application/json',
        ...(opts.body === undefined ? {} : { 'content-type': 'application/json' }),
        ...(opts.headers || {}),
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

export async function fetchAtendimentoClientSuggestions(unit: string, query: string, limit = 8) {
  const params = new URLSearchParams({ unit, q: query, limit: String(limit) })
  return api<{ clients: AtendimentoClientSuggestion[] }>(`/clients?${params.toString()}`)
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

export type AtendimentoMutation = Omit<AtendimentoForm, 'value'> & { revision?: number }

export async function createAtendimentoAttendance(payload: AtendimentoMutation, idempotencyKey: string) {
  return api<{ data: AtendimentoAttendance }>('/attendances', {
    method: 'POST',
    body: payload,
    headers: { 'idempotency-key': idempotencyKey },
  })
}

export async function updateAtendimentoAttendance(id: string, payload: AtendimentoMutation) {
  return api<{ data: AtendimentoAttendance }>(`/attendances/${encodeURIComponent(id)}`, { method: 'PATCH', body: payload })
}

export async function deleteAtendimentoAttendance(id: string, revision: number) {
  return api<{ ok: boolean }>(`/attendances/${encodeURIComponent(id)}`, { method: 'DELETE', body: { revision } })
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

export const __testables = {
  normalizeApiError,
  parseJson,
}
