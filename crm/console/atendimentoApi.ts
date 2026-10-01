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
  actorConsultantByUnit?: Record<string, { canonicalId: string | null; name: string | null; origin: 'actor' | 'unresolved'; reason?: string }>
  procedures: Array<{ id: string; name: string; aliases?: string[]; codes: string[] }>
}

export type AtendimentoCommercialOffer = {
  schemaVersion: 'crm-commercial-offer/v1' | string
  offerId: string
  offerKey: string
  revision: number
  unitSlug: string
  title: string
  description: string
  status: 'draft' | 'approved' | 'active' | 'expired' | 'archived' | string
  priceCents: number | null
  currency: 'BRL' | string
  priceQualifier: 'exact' | 'from' | 'on_request' | string
  installmentCount: number | null
  installmentValueCents: number | null
  discountPercent: number | null
  conditions: string
  validityStart: string | null
  validityEnd: string | null
  procedures: Array<{ id: string; name: string; aliases: string[]; quantity: number; quantityUnit: string }>
  approvedBy: string | null
  approvedAt: string | null
  updatedAt: string | null
  contextHash: string
}

export type AtendimentoCommercialOfferMutation = {
  unitSlug: string
  offerKey?: string
  title: string
  description?: string
  status: 'draft' | 'approved' | 'active' | 'expired' | 'archived'
  priceCents?: number | null
  priceQualifier?: 'exact' | 'from' | 'on_request'
  installmentCount?: number | null
  installmentValueCents?: number | null
  discountPercent?: number | null
  conditions?: string
  validityStart?: string | null
  validityEnd?: string | null
  procedures: Array<{ procedureId: string; quantity?: number; quantityUnit?: string }>
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
      doctors: Array<{ name: string; unitName?: string; unitSlug?: string; weekValue: number; totalValue: number; workingDays?: number; score: number; position?: string; rank: number; classification?: string; level?: number; modifiedZ?: number; distanceToCutOff?: number; distanceToLowerLimit?: number; distanceToUpperLimit?: number }>
      comparisonMetric?: 'production' | 'unit-score'
    }>
    topDoctors: Array<{ name: string; unitName: string; unitSlug: string; weekValue: number; totalValue: number; workingDays?: number; score: number; position?: string; rank: number; classification?: string; level?: number }>
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
  if (/<!doctype html|<html\b/i.test(compact)) return `O serviço de Atendimento não está disponível nesta instância (HTTP ${res.status}).`
  return compact ? compact.slice(0, 180) : `HTTP ${res.status}`
}

async function api<T>(path: string, opts: { method?: string; body?: unknown; headers?: Record<string, string> } = {}): Promise<ApiResponse<T>> {
  const method = opts.method || 'GET'
  try {
    const base = path.startsWith('/clinical') ? '/api' : API_BASE
    const response = await fetch(`${base}${path}`, {
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

export async function fetchCommercialReferences() {
  return api<AtendimentoReferences>('/commercial/references')
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

export type AtendimentoDoctorConversionHistoryItem = {
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
}

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
  return api<{
    unitSlug: string
    unitName: string
    date: string
    doctorId?: string | null
    doctorName: string
    assignmentOrigin?: 'schedule' | 'manager' | 'preserved' | 'unresolved'
    reason?: string | null
  }>(`/doctor-suggestion?${params.toString()}`)
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

export async function fetchAtendimentoCommercialOffers(filters: { unit?: string; status?: string } = {}) {
  const params = new URLSearchParams()
  if (filters.unit && filters.unit !== 'all') params.set('unit', filters.unit)
  if (filters.status && filters.status !== 'all') params.set('status', filters.status)
  const qs = params.toString()
  return api<{ offers: AtendimentoCommercialOffer[] }>(`/offers${qs ? `?${qs}` : ''}`)
}

export async function saveAtendimentoCommercialOffer(payload: AtendimentoCommercialOfferMutation) {
  return api<{ offer: AtendimentoCommercialOffer }>('/offers', { method: 'PUT', body: payload })
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

export type CommercialContactEligibility = {
  channel: 'whatsapp'
  status: 'eligible' | 'review_required' | 'blocked'
  contactAllowed: boolean
  reason: string
  controlsReady: boolean
  contactWriteControlsReady: boolean
  harmoniaChecked: boolean
  hasPhone: boolean
  optOutRecorded: boolean
  permissionStatus: 'granted' | 'denied' | 'unknown'
  evidenceSource: string
  evidenceReference: string
  expiresAt: string | null
  permissionRevision: number
  recordedBy: string
  updatedAt: string | null
}

export type CommercialProfile = {
  identityId: string
  name: string
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
  contactEligibility: CommercialContactEligibility
}

// The paginated discovery surface deliberately excludes direct identifiers.
// A name is returned only from the explicitly addressed profile endpoint.
export type CommercialProfileListItem = Omit<CommercialProfile, 'name'>

export type CommercialAction = {
  id: string
  identityId: string
  unitSlug: string
  unitName: string
  segmentKey: string
  actionType: 'contact' | 'follow_up' | 'appointment' | 'relationship'
  contactChannel: 'whatsapp'
  status: 'open' | 'contacted' | 'responded' | 'scheduled' | 'won_sale' | 'returned' | 'closed' | 'cancelled'
  owner: string
  dueDate: string | null
  notes: string
  outcomeNotes: string
  createdBy: string
  completedAt: string | null
  contactedAt: string | null
  createdAt: string
  updatedAt: string
}

export type CommercialPolicy = {
  activeContactCooldownDays: number
  returnRiskThresholds: number[]
  commercialContactWritesEnabled: boolean
  commercialContactCanaryIdentityIds: string[]
  commercialContactWriteControlsReady: boolean
  policyVersion: string
  updatedBy: string
  updatedAt: string | null
}

export type CommercialCanaryCandidate = {
  candidateRef: string
  displayNameMasked: string
  unit: string
  identityQuality: 'confirmed_multi_source' | 'review_required'
  permissionStatus: string
  phoneStatus: 'correlated' | 'uncorrelated'
  optOut: 'opted_out' | 'not_recorded'
  freshness: 'healthy' | 'stale' | 'unknown'
  inclusionReason: 'validated_synthetic' | 'validated_explicit_approved' | 'validation_required'
  validationStatus: 'valid' | 'required'
  validationRevision: number
  eligibility: 'eligible' | 'blocked' | 'review_required'
}

export type CommercialCanarySummary = {
  totalCohort: number
  eligible: number
  blocked: number
  inReview: number
  permissionsExpiring: number
  phonesUncorrelated: number
  staleSources: number
  pendingIdentityDecisions: number
  duplicateSelections: number
  outOfScope: number
  notValidated: number
  impact: { messagesSent: 0; commercialWritesEnabled: false; contactsRecorded: 0; actionsCreated: 0 }
}

export type CommercialCanaryState = {
  canary: {
    ready: boolean
    selectorConfigured: boolean
    sourceFreshness: 'healthy' | 'stale' | 'unknown'
    commercialWritesEnabled: false
    messagesSent: 0
    activeCohorts: Array<{ unit: string; version: number; status: string; memberCount: number; createdAt: string | null; removedAt: string | null }>
    latestCohorts: Array<{ unit: string; version: number; status: string; memberCount: number; createdAt: string | null; removedAt: string | null }>
    emergencyOffAvailable: boolean
  }
  policy: Pick<CommercialPolicy, 'policyVersion' | 'commercialContactWritesEnabled' | 'commercialContactCanaryIdentityIds'>
}

export type CommercialDataQualitySeverity = 'critical' | 'high' | 'medium' | 'low'
export type CommercialDataQualityStatus = 'open' | 'acknowledged' | 'in_progress' | 'resolved' | 'suppressed'

export type CommercialDataQualityFinding = {
  id: string
  findingKey: string
  severity: CommercialDataQualitySeverity
  status: CommercialDataQualityStatus
  owner: string
  observedCount: number
  // The API deliberately limits this object to aggregate safety/freshness values.
  metrics: {
    thresholdHours?: number
    mirrorSyncedAgeHours?: number
    latestImportAgeHours?: number
    currentSnapshotCount?: number
    residualRegistrationCount?: number
    controlsReady?: boolean
    snapshotVerified?: boolean
  }
  slaDueAt: string | null
  firstDetectedAt: string | null
  lastObservedAt: string | null
  lastEvaluatedAt: string | null
  acknowledgedAt: string | null
  resolvedAt: string | null
  revision: number
  updatedAt: string | null
}

export type CommercialDataQualityQueue = {
  total: number
  limit: number
  offset: number
  metrics: {
    findings: number
    currentFindings: number
    overdue: number
    unassigned: number
    bySeverity: Partial<Record<CommercialDataQualitySeverity, number>>
    byStatus: Partial<Record<CommercialDataQualityStatus, number>>
  }
  sourceFreshness: CommercialDataQualityFinding['metrics']
  findings: CommercialDataQualityFinding[]
}

export type CommercialDataQualityFindingMutation = {
  // The queue is shared. The server rejects writes based on a stale revision.
  expectedRevision: number
  owner?: string
  status?: CommercialDataQualityStatus
}

export type CommercialSourceOperation = {
  sourceId: string
  domain: string
  label: string
  required: boolean
  requiredFor: string[]
  status: string
  freshness: 'healthy' | 'preventive' | 'high' | 'missing' | string
  lastExecution: string | null
  lastRead: string | null
  lastSuccess: string | null
  lastApplied: string | null
  nextExecution: string | null
  recordsRead: number
  recordsApplied: number
  divergences: number
  snapshotComplete: boolean
  retries: number
  errors: number
  error: { code: string; retryable: boolean } | null
  durationMs: number
  reconciliationRequired: boolean
}

export type CommercialSourceOperations = {
  sources: CommercialSourceOperation[]
}

export type CommercialOverview = {
  asOf: string
  policy: CommercialPolicy
  summary: { profiles: number; returnAtRisk: number; highValueInactive: number; frequent: number; balancedVip: number; reactivationPotential: number; averageTicket: number }
  actions: { actions: number; contactedActions: number; recoveredSalesClients: number; clinicalReturnClients: number }
  coverage: { identitiesVisible: number; confirmedMultiSourceIdentities: number; unresolvedSingleSourceIdentities: number; classifiedSaleItems: number; saleItems: number }
  dataQuality: {
    futureAttendancesExcluded: number
    recencySource: 'completed_attendance_only'
    saleItemsWithoutClassification: number
    activeAttendanceClientsWithoutIdentity: number
    identityDataUpdatedAt: string | null
    contactEligibility: { eligible: number; blocked: number; reviewRequired: number; controlsReady: boolean; contactWriteControlsReady: boolean; scope?: 'page' | 'all' }
  }
  total: number
  limit: number
  offset: number
  pagination?: { mode: 'sql' | 'legacy'; sort: string; direction: 'asc' | 'desc'; hasPrevious: boolean; hasNext: boolean }
  profiles: CommercialProfileListItem[]
}

export type CommercialTimelineEntry = {
  id: string
  type: 'attendance' | 'sale'
  occurredOn: string | null
  title: string
  detail: string
  unitName: string
  source: string
  amount: number | null
  status: string
}

export type CommercialProfileDetail = {
  asOf: string
  policy: CommercialPolicy
  profile: CommercialProfile
  actions: CommercialAction[]
  timeline: CommercialTimelineEntry[]
  clinicalCadences: Array<{ procedureId: string; procedureName: string; cadenceDays: number | null; status: 'approved' | 'not_configured' | 'expired' | 'disabled'; notes: string; unitSlug: string; unitName: string; approvedAt: string | null; approvedBy: string; revision?: number; intervalMinDays?: number; intervalMaxDays?: number; effectiveFrom?: string | null; expiresAt?: string | null }>
}

export type ClientIdentityReviewItem = {
  id: string
  type: 'attendance_name_merge' | 'attendance_caixa' | 'app_attendance' | 'app_caixa' | 'lead_app' | 'lead_caixa'
  sourceId: string
  targetId: string
  status: 'pending' | 'suggested' | 'ambiguous' | 'confirmed' | 'rejected'
  version: string
  decisionState: 'resolved' | 'stale' | null
  confidence: number
  primaryName: string
  secondaryName: string
  evidence: Record<string, unknown>
  context: Record<string, unknown>
}

export type ClientIdentityReviewQueue = {
  total: number
  limit: number
  offset: number
  items: ClientIdentityReviewItem[]
  workflow?: { writesReady: boolean }
}

export type IdentityClusterMember = {
  source: 'attendance_client' | 'caixa_customer' | 'app_registration' | 'lead_profile' | string
  sourceLabel: string
  name: string
  aliases: string[]
  units: string[]
  matchingFields: Array<{ field: 'name' | 'phone' | 'email' | 'cpf' | 'unit' | string; label: string; status: string; values?: string[] }>
  freshness: 'current' | 'stale' | 'unknown' | string
  stale: boolean
  contact: { phone: string[]; email: string[]; masked: true }
}

export type IdentityReviewCluster = {
  schemaVersion: 'crm-identity-cluster/v2' | string
  clusterKey: string
  version: string
  summary: { memberCount: number; identityCount: number; sourceCount: number; unitCount: number }
  members: IdentityClusterMember[]
  membersBySource: Array<{ source: string; sourceLabel: string; count: number }>
  units: string[]
  matchingFields: string[]
  conflicts: Array<{ field: string; label: string; severity: 'strong' | 'weak' | string; summary: string }>
  evidence: { strong: IdentityClusterEvidence[]; weak: IdentityClusterEvidence[] }
  confidence: number
  decision: { state: 'pending' | 'confirmed' | 'rejected' | 'stale'; count: number; lastAt: string | null }
  decisionHistory: Array<{ reviewType: string; decision: string; resultingStatus: string; recordedAt: string | null; stale: boolean }>
  materializations: Array<{ mode: string; status: string; recordedAt: string | null; membersMoved: number }>
  automaticLinks: Array<{ source: string; target: string; status: string; method: string; confidence: number; history: Array<{ transition: string; resultingStatus: string; origin: string; recordedAt: string | null }> }>
  sourceChanges: Array<{ source: string; name: string; changedAt: string | null }>
  staleState: 'current' | 'stale'
  lineage: Array<{ relation: string; recordedAt: string | null }>
  impact: {
    membersToMove: Array<{ sourceLabel: string; name: string }>
    survivorIdentity: { name: string; sourceCount: number; sourceLabels: string[] } | null
    retiredIdentities: Array<{ name: string; sourceCount: number; sourceLabels: string[] }>
    commercialHistoryPresent: boolean
    consentHistoryPresent: boolean
    predictedAction: string
  }
  undo: { blocked: boolean; reasons: string[]; blockingHistory: { commercialActions: number; consentPermissions: number; consentEvents: number; identityAuditEvents: number } }
  bulkReview: { eligible: boolean; mode: 'bulk_safe' | 'individual_only' | string; sharedContactField: 'phone' | 'email' | null; reasons: string[] }
  privacy: { contactsMasked: true; technicalIdsHidden: true; revealRequired: true }
}

export type IdentityClusterEvidence = {
  kind: 'source_link' | string
  label: string
  strength: 'strong' | 'weak' | string
  confidence: number
  source: string
  target: string
  summary: string
}

export type IdentityClusterQueue = {
  schemaVersion: string
  total: number
  limit: number
  offset: number
  clusters: IdentityReviewCluster[]
  workflow: { writesReady: boolean }
  workspace: { ready: boolean; migrationId: string }
  graph: { members: number; edges: number }
  pagination: { hasPrevious: boolean; hasNext: boolean }
}

export type IdentityClusterBulkPreview = {
  schemaVersion: string
  clusterCount: number
  eligibleCount: number
  blockedCount: number
  memberCount: number
  eligibleMembers: number
  blockedReasons: string[]
  clusters: Array<{ clusterKey: string; version: string; eligible: boolean; reasons: string[] }>
  workspace: { ready: boolean; migrationId: string }
  workflow: { writesReady: boolean }
}

export type IdentityClusterReveal = {
  clusterKey: string
  version: string
  auditId: string | null
  revealedAt: string | null
  expiresAt: string
  contacts: Array<{ sourceLabel: string; name: string; phone: string[]; email: string[] }>
  privacy: { explicitAction: true; reasonRecorded: true; metricsAndLogsRedacted: true }
}

export type ClientIdentityReviewDecision = {
  id: string
  state: 'confirmed' | 'rejected' | 'reversed'
  sourceVersion: string
  reversesDecisionId?: string
}

export type ClientIdentityMaterialization = {
  id: string
  createdAt?: string
  summary: {
    membersMoved?: number
    sourceIdentityId?: string
    targetIdentityId?: string
    survivorIdentityId?: string
    retiredIdentityId?: string | null
    manualCanonicalMerge?: { sourceClientId: string; survivorClientId: string } | null
    [key: string]: unknown
  }
}

export function fetchCommercialOverview(filters: { asOf?: string; unit?: string; segment?: string; priority?: string; q?: string; limit?: number; offset?: number; server?: boolean; sort?: string; direction?: 'asc' | 'desc' } = {}) {
  const params = new URLSearchParams()
  Object.entries(filters).forEach(([key, value]) => {
    if (value === true) params.set(key, '1')
    else if (value !== undefined && value !== '' && value !== 'all') params.set(key, String(value))
  })
  const qs = params.toString()
  return api<CommercialOverview>(`/commercial/overview${qs ? `?${qs}` : ''}`)
}

export function fetchCommercialDataQuality(filters: {
  status?: CommercialDataQualityStatus
  severity?: CommercialDataQualitySeverity
  limit?: number
  offset?: number
} = {}) {
  const params = new URLSearchParams()
  Object.entries(filters).forEach(([key, value]) => { if (value !== undefined) params.set(key, String(value)) })
  const qs = params.toString()
  return api<CommercialDataQualityQueue>(`/commercial/data-quality${qs ? `?${qs}` : ''}`)
}

export function fetchCommercialSourceOperations() {
  return api<CommercialSourceOperations>('/commercial/source-operations')
}

export function updateCommercialDataQualityFinding(id: string, payload: CommercialDataQualityFindingMutation) {
  return api<{ finding: CommercialDataQualityFinding }>(`/commercial/data-quality/${encodeURIComponent(id)}`, { method: 'PATCH', body: payload })
}

export function isCommercialDataQualityScopeDenied(error: string | undefined) {
  return error === 'COMMERCIAL_DATA_QUALITY_UNIT_SCOPE_UNSUPPORTED' || error === 'FORBIDDEN'
}

export function isCommercialSourceOperationsScopeDenied(error: string | undefined) {
  return error === 'COMMERCIAL_SOURCE_OPERATIONS_UNIT_SCOPE_UNSUPPORTED' || error === 'FORBIDDEN'
}

export function fetchClientIdentityReviewQueue(filters: { type?: ClientIdentityReviewItem['type']; q?: string; limit?: number; offset?: number; includeResolved?: boolean } = {}) {
  const params = new URLSearchParams()
  Object.entries(filters).forEach(([key, value]) => { if (value !== undefined && value !== '') params.set(key, String(value)) })
  const qs = params.toString()
  return api<ClientIdentityReviewQueue>(`/commercial/review${qs ? `?${qs}` : ''}`)
}

export function fetchIdentityClusterWorkspace(filters: { q?: string; unit?: string; status?: string; stale?: boolean; limit?: number; offset?: number; includeResolved?: boolean } = {}) {
  const params = new URLSearchParams()
  Object.entries(filters).forEach(([key, value]) => {
    if (value === true) params.set(key, 'true')
    else if (value !== undefined && value !== '') params.set(key, String(value))
  })
  const qs = params.toString()
  return api<IdentityClusterQueue>(`/commercial/identity-clusters${qs ? `?${qs}` : ''}`)
}

export function fetchIdentityClusterDetail(clusterKey: string, filters: { unit?: string } = {}) {
  const params = new URLSearchParams()
  if (filters.unit && filters.unit !== 'all') params.set('unit', filters.unit)
  const qs = params.toString()
  return api<{ cluster: IdentityReviewCluster; workflow: { writesReady: boolean }; workspace: { ready: boolean; migrationId: string } }>(
    `/commercial/identity-clusters/${encodeURIComponent(clusterKey)}${qs ? `?${qs}` : ''}`,
  )
}

export function previewIdentityClusterBulk(payload: { clusterKeys?: string[]; unit?: string }) {
  return api<IdentityClusterBulkPreview>('/commercial/identity-clusters/bulk/preview', { method: 'POST', body: payload })
}

export function applyIdentityClusterBulk(payload: { clusterKeys: string[]; expectedVersions: Record<string, string>; reason: string; confirmation: 'REVIEW_CLUSTER'; unit?: string }, idempotencyKey: string) {
  return api<{ schemaVersion: string; idempotent: boolean; appliedClusters: number; membersMoved: number; results: Array<{ clusterKey: string; idempotent: boolean; membersMoved?: number; decisionState?: string }> }>(
    '/commercial/identity-clusters/bulk/apply',
    { method: 'POST', body: payload, headers: { 'idempotency-key': idempotencyKey } },
  )
}

export function revealIdentityCluster(clusterKey: string, payload: { expectedVersion: string; fields: Array<'phone' | 'email'>; reason: string; confirmation: 'REVIEW_CLUSTER'; unit?: string }) {
  return api<IdentityClusterReveal>(`/commercial/identity-clusters/${encodeURIComponent(clusterKey)}/reveal`, { method: 'POST', body: payload })
}

export function decideClientIdentityReview(type: ClientIdentityReviewItem['type'], payload: {
  sourceId: string
  targetId: string
  expectedVersion: string
  decision: 'confirmed' | 'rejected'
  reason: string
  survivorClientId?: string
}) {
  return api<{ decision: ClientIdentityReviewDecision; materialization: ClientIdentityMaterialization }>(
    `/commercial/review/${encodeURIComponent(type)}/decision`,
    { method: 'POST', body: payload },
  )
}

export function undoClientIdentityReview(type: ClientIdentityReviewItem['type'], payload: {
  sourceId: string
  targetId: string
  expectedVersion: string
  reason: string
}) {
  return api<{ decision: ClientIdentityReviewDecision; materialization: ClientIdentityMaterialization }>(
    `/commercial/review/${encodeURIComponent(type)}/undo`,
    { method: 'POST', body: payload },
  )
}

export function fetchCommercialProfile(identityId: string, filters: { asOf?: string; unit?: string } = {}) {
  const params = new URLSearchParams()
  if (filters.asOf) params.set('asOf', filters.asOf)
  if (filters.unit && filters.unit !== 'all') params.set('unit', filters.unit)
  const qs = params.toString()
  return api<CommercialProfileDetail>(`/commercial/profiles/${encodeURIComponent(identityId)}${qs ? `?${qs}` : ''}`)
}

export function createCommercialAction(payload: { identityId: string; segmentKey: string; actionType: CommercialAction['actionType']; contactChannel?: 'whatsapp'; owner?: string; unit?: string; dueDate?: string; notes?: string }) {
  return api<{ id: string; contactEligibility: CommercialContactEligibility }>('/commercial/actions', { method: 'POST', body: payload })
}

export function updateCommercialAction(id: string, payload: { status: CommercialAction['status']; owner?: string; outcomeNotes?: string }) {
  return api<{ id: string; status: CommercialAction['status']; contactEligibility: CommercialContactEligibility }>(`/commercial/actions/${encodeURIComponent(id)}`, { method: 'PATCH', body: payload })
}

export type CommercialContactPermissionMutation =
  | { status: 'granted'; source: string; evidenceReference: string; expectedRevision: number; expiresAt?: string }
  | { status: 'denied'; source: string; evidenceReference: string; expectedRevision?: number; expiresAt?: string }

export function recordCommercialContactPermission(identityId: string, payload: CommercialContactPermissionMutation) {
  return api<{ contactEligibility: CommercialContactEligibility }>(`/commercial/contact-permissions/${encodeURIComponent(identityId)}`, { method: 'PUT', body: payload })
}

export function fetchCommercialPolicy() {
  return api<{ policy: CommercialPolicy }>('/commercial/policy')
}

export function updateCommercialPolicy(payload: Pick<CommercialPolicy, 'activeContactCooldownDays' | 'returnRiskThresholds'> &
  { expectedPolicyVersion: string }) {
  return api<{ policy: CommercialPolicy }>('/commercial/policy', { method: 'PUT', body: payload })
}

export function fetchCommercialCanaryState(unit?: string) {
  const query = unit ? `?unit=${encodeURIComponent(unit)}` : ''
  return api<CommercialCanaryState>(`/commercial/canary/state${query}`)
}

export function fetchCommercialCanaryCandidates(query: { unit: string; q?: string; limit?: number; offset?: number }) {
  const params = new URLSearchParams({ unit: query.unit })
  if (query.q) params.set('q', query.q)
  if (query.limit) params.set('limit', String(query.limit))
  if (query.offset) params.set('offset', String(query.offset))
  return api<{ unit: string; candidates: CommercialCanaryCandidate[]; pagination: { hasNext: boolean; hasPrevious: boolean }; total: number; sourceFreshness: CommercialCanaryCandidate['freshness'] }>(`/commercial/canary/candidates?${params.toString()}`)
}

export function previewCommercialCanary(payload: { unit: string; candidateRefs: string[] }) {
  return api<{ unit: string; candidates: CommercialCanaryCandidate[]; summary: CommercialCanarySummary; canApply: boolean; commercialWritesEnabled: false; messagesSent: 0 }>('/commercial/canary/preview', { method: 'POST', body: payload })
}

export function validateCommercialCanaryIdentity(payload: { unit: string; candidateRef: string; validationType: 'synthetic' | 'explicit_approved'; approvalReference?: string; justification: string; confirmed: true; expectedPolicyVersion: string; expectedValidationRevision: number; idempotencyKey: string }) {
  return api<{ validation: { unit: string; validationStatus: 'valid'; validationType: 'synthetic' | 'explicit_approved'; revision: number; expiresAt: string | null }; commercialWritesEnabled: false; messagesSent: 0 }>('/commercial/canary/identities/validate', { method: 'POST', body: payload })
}

export function saveCommercialCanary(payload: { unit: string; candidateRefs: string[]; justification: string; confirmed: true; expectedPolicyVersion: string; expectedCohortVersion: number; idempotencyKey: string }) {
  return api<{ cohort: { unit: string; version: number; status: 'active'; memberCount: number; createdAt: string | null }; summary: CommercialCanarySummary; commercialWritesEnabled: false; messagesSent: 0 }>('/commercial/canary', { method: 'POST', body: payload })
}

export function removeCommercialCanary(payload: { unit: string; justification: string; confirmed: true; expectedPolicyVersion: string; expectedCohortVersion: number; idempotencyKey: string }) {
  return api<{ removed: boolean; unit: string; cohortVersion: number; commercialWritesEnabled: false; messagesSent: 0 }>('/commercial/canary/remove', { method: 'POST', body: payload })
}

export function emergencyOffCommercialCanary(payload: { justification: string; confirmed: true; expectedPolicyVersion: string; idempotencyKey: string }) {
  return api<{ emergencyOff: true; disabledCohorts: number; commercialWritesEnabled: false; messagesSent: 0 }>('/commercial/canary/emergency-off', { method: 'POST', body: payload })
}

export function fetchCommercialCadences() {
  return api<{ cadences: Array<{ id: string; procedureId: string; procedureName: string; cadenceDays: number | null; intervalMinDays?: number; intervalMaxDays?: number; status: string; notes: string; evidenceReference?: string; approvedBy: string; approvedAt: string | null; updatedBy: string; updatedAt: string | null; unitSlug: string; unitName: string; revision?: number; effectiveFrom?: string | null; expiresAt?: string | null }> }>('/commercial/cadences')
}

export const commercialCadenceManagerStatuses = ['draft', 'disabled'] as const
export type CommercialCadenceManagerStatus = (typeof commercialCadenceManagerStatuses)[number]

export function upsertCommercialCadence(payload: { procedureId: string; unit?: string; cadenceDays: number; status: CommercialCadenceManagerStatus; notes?: string; justification?: string; evidenceReference?: string; effectiveFrom?: string; expiresAt?: string; idempotencyKey?: string }) {
  return api<{ id: string; revision?: number; status?: string }>('/commercial/cadences', { method: 'PUT', body: payload })
}

export type ClinicalApprovalStatus = 'draft' | 'submitted' | 'approved' | 'rejected' | 'expired' | 'disabled'
export type ClinicalApprovalRule = {
  id: string
  procedureId: string
  procedureName: string
  unitId: string | null
  unitSlug: string
  unitName: string
  revision: number
  intervalMinDays: number
  intervalMaxDays: number
  cadenceDays: number | null
  justification: string
  evidenceReference: string
  effectiveFrom: string | null
  expiresAt: string | null
  status: ClinicalApprovalStatus
  authorId: string
  approverId: string | null
  approvedAt: string | null
  createdAt: string | null
  updatedAt: string | null
}
export type ClinicalApprovalEvent = {
  id: string
  ruleId: string
  revision: number
  eventType: string
  previousStatus: ClinicalApprovalStatus | null
  status: ClinicalApprovalStatus
  actorId: string
  actorRole: string
  reason: string | null
  recordedAt: string | null
}

export function fetchClinicalApprovals(filters: { status?: ClinicalApprovalStatus; unit?: string } = {}) {
  const params = new URLSearchParams()
  if (filters.status) params.set('status', filters.status)
  if (filters.unit && filters.unit !== 'all') params.set('unit', filters.unit)
  const qs = params.toString()
  return api<{ rules: ClinicalApprovalRule[]; total: number }>(`/clinical/approvals${qs ? `?${qs}` : ''}`)
}

export function fetchClinicalApproval(id: string) {
  return api<{ rule: ClinicalApprovalRule; events: ClinicalApprovalEvent[] }>(`/clinical/approvals/${encodeURIComponent(id)}`)
}

export function submitClinicalApproval(id: string, payload: { expectedRevision: number; reason?: string; idempotencyKey: string }) {
  return api<{ rule: ClinicalApprovalRule }>(`/clinical/approvals/${encodeURIComponent(id)}/submit`, { method: 'POST', body: payload, headers: { 'Idempotency-Key': payload.idempotencyKey } })
}

export function approveClinicalApproval(id: string, payload: { expectedRevision: number; reason?: string; idempotencyKey: string }) {
  return api<{ rule: ClinicalApprovalRule }>(`/clinical/approvals/${encodeURIComponent(id)}/approve`, { method: 'POST', body: payload, headers: { 'Idempotency-Key': payload.idempotencyKey } })
}

export function rejectClinicalApproval(id: string, payload: { expectedRevision: number; reason: string; idempotencyKey: string }) {
  return api<{ rule: ClinicalApprovalRule }>(`/clinical/approvals/${encodeURIComponent(id)}/reject`, { method: 'POST', body: payload, headers: { 'Idempotency-Key': payload.idempotencyKey } })
}

export type CommercialAnalyticsSafety = {
  commercialContactWritesEnabled: false
  messagesEnabled: false
  autonomousMessagingEnabled: false
  consentWritesEnabled: false
}

export type CommercialAnalyticsReadiness = {
  ready: boolean
  migrationId: string
  relationsReady: boolean
  appendOnlyReady: boolean
  grantsReady: boolean
  migrationReady: boolean
  readinessUnavailable?: boolean
  safety: CommercialAnalyticsSafety
}

export type CommercialAnalyticsCoverage = {
  unit: string
  identities: number
  confirmedIdentityCount: number
  permissionCount: number
  phoneCorrelatedCount: number
  salesClassifiedCount: number
}

export type CommercialAnalyticsQuality = {
  scope: { units: string[]; global: boolean }
  days: number
  coverage: CommercialAnalyticsCoverage[]
  findings: Array<{
    key: string; severity: string; status: string; observedCount: number; firstDetectedAt: string | null; lastObservedAt: string | null
    acknowledgedAt: string | null; resolvedAt: string | null; slaDueAt: string | null; startedAt: string | null; ageHours: number; recognitionHours: number | null
    startHours: number | null; resolutionHours: number | null; reopenCount: number; reopenRate: number; ownerAssigned: boolean; slaBreached: boolean
  }>
  series: Array<{ key: string; observedOn: string; observedCount: number; eventCount: number }>
  events: Array<{ key: string; eventType: string; status: string; observedCount: number; createdAt: string | null }>
  freshness: Array<{
    sourceId: string; status: string; snapshotComplete: boolean; validatedAt: string | null; appliedAt: string | null; lastReadAt: string | null
    recordsRead: number; recordsApplied: number; divergences: number; retries: number; consecutiveFailures: number; errorCode: string | null; freshnessHours: number | null
  }>
  partial: boolean
  partialReason?: string
  safety: CommercialAnalyticsSafety
}

export type CommercialAnalyticsFunnel = {
  scope: { units: string[]; global: boolean }
  filters: { campaignId: string | null; segmentVersionId: string | null; offerId: string | null; policyVersion: string | null; channel: string | null; startAt: string | null; endAt: string | null }
  observed: Record<string, number>
  attributed: Record<string, number> | null
  attributionWindow: { id: string; key: string; revision: number; responseDays: number; scheduledDays: number; attendedDays: number; purchasedDays: number; returnedDays: number } | null
  incremental: null
  caveats: string[]
  safety: CommercialAnalyticsSafety
}

export type CommercialAnalyticsSegment = {
  id: string; unit: string; key: string; name: string; criteria: Record<string, unknown>; status: string; revision: number
  currentVersionId: string | null; currentVersion: number | null; populationCount: number; snapshotAt: string | null; updatedAt: string | null
}

export type CommercialAnalyticsAttributionWindow = {
  id: string; unit: string; key: string; revision: number; state: string; startsAt: string | null; endsAt: string | null
  responseDays: number; scheduledDays: number; attendedDays: number; purchasedDays: number; returnedDays: number; updatedAt: string | null
}

export type CommercialAnalyticsExperiment = {
  id: string; unit: string; name: string; state: string; revision: number; segmentVersionId: string; attributionWindowId: string
  controlGroupPercent: number; startsAt: string | null; endsAt: string | null; policyVersion: string; assignments: number
  treatmentAssignments: number; controlAssignments: number; excludedAssignments: number; updatedAt: string | null
}

export type CommercialAnalyticsExperimentMetrics = {
  experiment: CommercialAnalyticsExperiment
  attribution: { windowId: string; key: string; purchasedDays: number }
  observed: { treatment: { population: number; conversions: number; revenue: number; conversionRate: number | null }; control: { population: number; conversions: number; revenue: number; conversionRate: number | null } }
  attributed: { treatment: { population: number; conversions: number; revenue: number; conversionRate: number | null }; control: { population: number; conversions: number; revenue: number; conversionRate: number | null } }
  incremental: { conversionLift: number | null; incrementalConversions: number | null; incrementalRevenue: number | null; confidenceInterval95: { lower: number; upper: number } | null; adequateSample: boolean; warning: string | null }
  safety: CommercialAnalyticsSafety
}

function analyticsQuery(filters: Record<string, string | number | undefined | null>) {
  const params = new URLSearchParams()
  Object.entries(filters).forEach(([key, value]) => { if (value != null && value !== '') params.set(key, String(value)) })
  const query = params.toString()
  return query ? `?${query}` : ''
}

export function fetchCommercialAnalyticsReadiness() {
  return api<CommercialAnalyticsReadiness>('/commercial/analytics/readiness')
}

export function fetchCommercialAnalyticsQuality(filters: { unit?: string; days?: number } = {}) {
  return api<CommercialAnalyticsQuality>(`/commercial/analytics/quality${analyticsQuery(filters)}`)
}

export function fetchCommercialAnalyticsFunnel(filters: { unit?: string; campaignId?: string; segmentVersionId?: string; attributionWindowId?: string; offerId?: string; policyVersion?: string; owner?: string; channel?: 'whatsapp'; startAt?: string; endAt?: string } = {}) {
  return api<CommercialAnalyticsFunnel>(`/commercial/analytics/funnel${analyticsQuery(filters)}`)
}

export function fetchCommercialAnalyticsSegments(filters: { unit?: string } = {}) {
  return api<{ scope: { units: string[]; global: boolean }; segments: CommercialAnalyticsSegment[]; safety: CommercialAnalyticsSafety }>(`/commercial/analytics/segments${analyticsQuery(filters)}`)
}

export function fetchCommercialAnalyticsAttributionWindows(filters: { unit?: string } = {}) {
  return api<{ scope: { units: string[]; global: boolean }; windows: CommercialAnalyticsAttributionWindow[]; safety: CommercialAnalyticsSafety }>(`/commercial/analytics/attribution-windows${analyticsQuery(filters)}`)
}

export function fetchCommercialAnalyticsExperiments(filters: { unit?: string } = {}) {
  return api<{ scope: { units: string[]; global: boolean }; experiments: CommercialAnalyticsExperiment[]; safety: CommercialAnalyticsSafety }>(`/commercial/analytics/experiments${analyticsQuery(filters)}`)
}

export function fetchCommercialAnalyticsExperimentMetrics(experimentId: string) {
  return api<CommercialAnalyticsExperimentMetrics>(`/commercial/analytics/experiments/${encodeURIComponent(experimentId)}/metrics`)
}

export const __testables = {
  normalizeApiError,
  parseJson,
}
