import type { AtendimentoClinicaFilters, AtendimentoClinicaForm } from '@/atendimentoClinicaDomain'
import { buildAtendimentoQuery } from '@/atendimentoClinicaDomain'

const API_BASE = '/api/atendimento-clinica'

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

export type AtendimentoClinicaAttendance = AtendimentoClinicaForm & {
  id: string
  unitSlug: string
  unitName: string
  value: number
  sourceTab?: string | null
  sourceRow?: number | null
  createdAt?: string
  updatedAt?: string
}

export type AtendimentoClinicaReferences = {
  units: Array<{ slug: string; name: string }>
  professionals: Array<{ id: string; name: string; role?: string; status?: string; units?: string[]; shift?: string; roles?: string[]; turnos?: string[]; backgroundColor?: string; fontColor?: string; fontFamily?: string; fontSize?: number | null; fontWeight?: string; fontStyle?: string; alias?: string; phone?: string; email?: string; instagram?: string }>
  procedures: Array<{ id: string; name: string; codes: string[] }>
}

export type AtendimentoClinicaOverview = {
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

export type AtendimentoClinicaReportPreview = {
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

export type AtendimentoManagementCatalog = AtendimentoClinicaReferences & {
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
  summary: AtendimentoClinicaOverview['summary']
  monthly: AtendimentoClinicaOverview['monthly']
  rankings: AtendimentoClinicaOverview['rankings']
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
  professionals: AtendimentoClinicaReferences['professionals']
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
      }>
      doctors: Array<{ name: string; unitName?: string; unitSlug?: string; weekValue: number; totalValue: number; score: number; position?: string; rank: number; classification?: string; level?: number }>
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
    return { ok: false, error: `Falha de conexão com Atendimento Clínica. ${message}` } as ApiResponse<T>
  }
}

export async function fetchAtendimentoReferences() {
  return api<AtendimentoClinicaReferences>('/references')
}

export async function fetchAtendimentoOverview(filters: AtendimentoClinicaFilters) {
  const qs = buildAtendimentoQuery(filters).toString()
  return api<AtendimentoClinicaOverview>(`/overview${qs ? `?${qs}` : ''}`)
}

export async function fetchAtendimentoAttendances(filters: AtendimentoClinicaFilters, paging: { limit?: number; offset?: number } = {}) {
  const qs = buildAtendimentoQuery(filters, paging).toString()
  return api<{ data: AtendimentoClinicaAttendance[]; total: number; limit: number; offset: number }>(`/attendances${qs ? `?${qs}` : ''}`)
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
  return api<AtendimentoClinicaReportPreview>(`/reports/preview?${params.toString()}`)
}

export async function createAtendimentoAttendance(payload: AtendimentoClinicaForm) {
  return api<{ data: AtendimentoClinicaAttendance }>('/attendances', { method: 'POST', body: payload })
}

export async function updateAtendimentoAttendance(id: string, payload: AtendimentoClinicaForm) {
  return api<{ data: AtendimentoClinicaAttendance }>(`/attendances/${encodeURIComponent(id)}`, { method: 'PATCH', body: payload })
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

export async function fetchAtendimentoManagementCommercial(filters: AtendimentoClinicaFilters) {
  const qs = buildAtendimentoQuery(filters).toString()
  return api<AtendimentoManagementCommercial>(`/management/commercial${qs ? `?${qs}` : ''}`)
}

export async function fetchAtendimentoManagementConversionReport(date?: string, filters?: Pick<AtendimentoClinicaFilters, 'unit' | 'from' | 'to'>) {
  const params = new URLSearchParams()
  if (date) params.set('date', date)
  if (filters?.unit && filters.unit !== 'all') params.set('unit', filters.unit)
  if (filters?.from) params.set('from', filters.from)
  if (filters?.to) params.set('to', filters.to)
  const qs = params.toString()
  return api<AtendimentoManagementConversionReport>(`/management/conversion-report${qs ? `?${qs}` : ''}`)
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
