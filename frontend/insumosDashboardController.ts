import React from 'react'
import { toast } from 'sonner'

import { dateInputToIso } from '@/insumosShared'
import type {
  Actionables,
  EstoqueAlerta,
  EstoqueResumo,
  InsightsBundleData,
  Insumo,
  InsumosOverviewPeriod,
  NotificationsSummary,
  OverviewBundleData,
  QualityReport,
  RoiInsights,
} from '@/insumosTypes'

type OverviewMovResumo = {
  entradaQtd: number
  saidaQtd: number
  entradaValor: number
  saidaValor: number
  saldoLiquido: number
} | null

type OverviewMovSeriesItem = {
  day: string
  entrada: number
  saida: number
  entradaValor?: number
  saidaValor?: number
}

type ApiJsonFn = <T>(path: string, opts?: { signal?: AbortSignal }) => Promise<T>

type DashboardStateSetters = {
  setOverviewLoaded: React.Dispatch<React.SetStateAction<boolean>>
  setInsumosLoaded: React.Dispatch<React.SetStateAction<boolean>>
  setMovLoaded: React.Dispatch<React.SetStateAction<boolean>>
  setInsightsLoaded: React.Dispatch<React.SetStateAction<boolean>>
  setOverviewLoading: React.Dispatch<React.SetStateAction<boolean>>
  setOverviewResumo: React.Dispatch<React.SetStateAction<EstoqueResumo | null>>
  setOverviewInsumos: React.Dispatch<React.SetStateAction<Insumo[] | null>>
  setOverviewNotifications: React.Dispatch<React.SetStateAction<NotificationsSummary | null>>
  setOverviewActionables: React.Dispatch<React.SetStateAction<Actionables | null>>
  setOverviewRoi: React.Dispatch<React.SetStateAction<RoiInsights | null>>
  setOverviewQuality: React.Dispatch<React.SetStateAction<QualityReport | null>>
  setOverviewMovResumo: React.Dispatch<React.SetStateAction<OverviewMovResumo>>
  setOverviewMovSeries: React.Dispatch<React.SetStateAction<OverviewMovSeriesItem[]>>
  setInsightsLoading: React.Dispatch<React.SetStateAction<boolean>>
  setInsightsAlertas: React.Dispatch<React.SetStateAction<EstoqueAlerta[]>>
  setInsightsTrends: React.Dispatch<React.SetStateAction<any | null>>
  setInsightsTurnover: React.Dispatch<React.SetStateAction<{ saida?: any; entrada?: any } | null>>
  setOverviewEverVisible: React.Dispatch<React.SetStateAction<boolean>>
}

type UseInsumosDashboardControllerArgs = DashboardStateSetters & {
  apiJson: ApiJsonFn
  authLoaded: boolean
  authLoading: boolean
  canUseApi: boolean
  chartsPanelOpen: boolean
  chartsPanelVisible: boolean
  healthLoaded: boolean
  healthLoading: boolean
  insightsLoaded: boolean
  insumosLoaded: boolean
  isAuthed: boolean
  movLoaded: boolean
  overviewCustomFrom: string
  overviewCustomTo: string
  overviewEverVisible: boolean
  overviewInsumos: Insumo[] | null
  overviewLoaded: boolean
  overviewLoading: boolean
  overviewPeriod: InsumosOverviewPeriod
  overviewSectionRef: React.RefObject<HTMLDivElement | null>
  overviewVisible: boolean
  unidade: string
}

type LoadOverviewOptions = { force?: boolean; lite?: boolean }
type LoadInsightsOptions = { force?: boolean }
type PostMutationRefreshOptions = { overview?: boolean; insights?: boolean }

export function resolveOverviewDateRange(args: {
  period: InsumosOverviewPeriod
  customFrom: string
  customTo: string
  now?: Date
}) {
  const now = args.now ?? new Date()
  const yyyyMmDd = (value: Date) => value.toISOString().slice(0, 10)

  let de = ''
  let ate = yyyyMmDd(now)
  let days = args.period === '7d' ? 7 : args.period === '30d' ? 30 : 365

  if (args.period === 'custom') {
    const deIso = dateInputToIso(args.customFrom)
    const ateIso = dateInputToIso(args.customTo)
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
    if (args.period === '7d') start.setDate(start.getDate() - 7)
    else if (args.period === '30d') start.setDate(start.getDate() - 30)
    else start.setFullYear(start.getFullYear() - 1)
    de = yyyyMmDd(start)
  }

  return { de, ate, days }
}

function isOverviewViewportVisible(sectionRef: React.RefObject<HTMLDivElement | null>) {
  try {
    const el = sectionRef.current
    if (!el) return true
    const rect = el.getBoundingClientRect()
    const viewportHeight = window.innerHeight || 0
    if (!viewportHeight) return true
    const topOk = rect.top < viewportHeight * 0.85
    const bottomOk = rect.bottom > viewportHeight * 0.15
    return topOk && bottomOk
  } catch {
    return true
  }
}

export function useInsumosDashboardController({
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
}: UseInsumosDashboardControllerArgs) {
  const overviewAbortRef = React.useRef<AbortController | null>(null)
  const insightsAbortRef = React.useRef<AbortController | null>(null)
  const overviewFullAttemptRef = React.useRef<number>(0)
  const apiFailureTimestampsRef = React.useRef<number[]>([])
  const postMutationRefreshTimerRef = React.useRef<number | null>(null)
  const [autoSyncSuspendedUntil, setAutoSyncSuspendedUntil] = React.useState(0)

  const autoSyncSuspended = autoSyncSuspendedUntil > Date.now()
  const autoSyncRemainingSeconds = autoSyncSuspended
    ? Math.max(1, Math.ceil((autoSyncSuspendedUntil - Date.now()) / 1000))
    : 0

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
  }, [canUseApi, isAuthed, setInsightsLoaded, setInsumosLoaded, setMovLoaded, setOverviewLoaded])

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
      ...(canUseApi && isAuthed ? [overviewLoaded, insumosLoaded, movLoaded, insightsLoaded] : []),
    ]
    const total = steps.length || 1
    const done = steps.filter(Boolean).length
    return Math.max(0, Math.min(100, Math.round((done / total) * 100)))
  }, [authLoaded, canUseApi, healthLoaded, insightsLoaded, insumosLoaded, isAuthed, movLoaded, overviewLoaded])

  const loadingPercent = Math.max(0, Math.min(100, Math.round(dashboardProgress)))
  const isDashboardLoading = authLoading || healthLoading || (canUseApi && isAuthed && dashboardProgress < 100)
  const shouldShowDashboardLoading = isDashboardLoading || !authLoaded || !healthLoaded
  const showOverviewLoadingProgress = overviewLoading || (canUseApi && isAuthed && shouldShowDashboardLoading)

  const loadOverview = React.useCallback(
    async (opts?: LoadOverviewOptions) => {
      if (!canUseApi || !isAuthed) return
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
        const { de, ate, days } = resolveOverviewDateRange({
          period: overviewPeriod,
          customFrom: overviewCustomFrom,
          customTo: overviewCustomTo,
        })
        const params = new URLSearchParams({
          unidade,
          de,
          ate,
          days: String(days),
          limitIssues: '120',
        })
        const isLite = opts?.lite !== false
        if (isLite) params.set('lite', '1')
        const out = await apiJson<{ success?: boolean; data?: OverviewBundleData }>(
          `/analytics/overview?${params.toString()}`,
          { signal: ac.signal }
        )
        if (overviewAbortRef.current !== ac) return
        const data = out?.data || null
        setOverviewResumo(data?.resumo || null)
        if (Array.isArray(data?.itens)) {
          setOverviewInsumos(data.itens as Insumo[])
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
                  saidaValor: Number.isFinite(Number(item?.saidaValor)) ? Number(item?.saidaValor) : undefined,
                }))
                .filter((item) => item.day)
            : []
        )
      } catch (error) {
        if ((error as any)?.name === 'AbortError') return
        if (overviewAbortRef.current !== ac) return
        markAutoSyncFailure(error)
        toast.error(error instanceof Error ? error.message : String(error))
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
    },
    [
      apiJson,
      autoSyncSuspendedUntil,
      canUseApi,
      isAuthed,
      markAutoSyncFailure,
      overviewCustomFrom,
      overviewCustomTo,
      overviewPeriod,
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
    ]
  )

  const loadInsights = React.useCallback(
    async (opts?: LoadInsightsOptions) => {
      if (!canUseApi || !isAuthed) return
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
        const { days } = resolveOverviewDateRange({
          period: overviewPeriod,
          customFrom: overviewCustomFrom,
          customTo: overviewCustomTo,
        })
        const params = new URLSearchParams()
        params.set('unidade', unidade)
        params.set('groupBy', 'day')
        if (overviewPeriod === 'custom') {
          const from = dateInputToIso(overviewCustomFrom)
          const to = dateInputToIso(overviewCustomTo)
          if (from && to) {
            params.set('from', from)
            params.set('to', to)
          }
        }
        params.set('days', String(days))

        const out = await apiJson<{ success?: boolean; data?: InsightsBundleData }>(
          `/analytics/insights?${params.toString()}`,
          { signal: ac.signal }
        )
        if (insightsAbortRef.current !== ac) return
        const data = out?.data || null
        setInsightsAlertas(Array.isArray(data?.alertas) ? data.alertas : [])
        setInsightsTrends(data?.trends || null)
        setInsightsTurnover(data?.turnover || null)
      } catch (error) {
        if ((error as any)?.name === 'AbortError') return
        if (insightsAbortRef.current !== ac) return
        markAutoSyncFailure(error)
        toast.error(error instanceof Error ? error.message : String(error))
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
    },
    [
      apiJson,
      autoSyncSuspendedUntil,
      canUseApi,
      isAuthed,
      markAutoSyncFailure,
      overviewCustomFrom,
      overviewCustomTo,
      overviewPeriod,
      setInsightsAlertas,
      setInsightsLoaded,
      setInsightsLoading,
      setInsightsTrends,
      setInsightsTurnover,
      setOverviewEverVisible,
      unidade,
    ]
  )

  const schedulePostMutationRefresh = React.useCallback(
    (opts?: PostMutationRefreshOptions) => {
      const wantsOverview = opts?.overview !== false
      const wantsInsights = opts?.insights !== false
      if (!wantsOverview && !wantsInsights) return
      if (autoSyncSuspendedUntil > Date.now()) return

      if (postMutationRefreshTimerRef.current) {
        window.clearTimeout(postMutationRefreshTimerRef.current)
        postMutationRefreshTimerRef.current = null
      }

      postMutationRefreshTimerRef.current = window.setTimeout(() => {
        const tasks: Promise<unknown>[] = []
        const isVisible = isOverviewViewportVisible(overviewSectionRef)
        if (wantsOverview && overviewLoaded && isVisible) tasks.push(Promise.resolve(loadOverview()))
        if (wantsInsights && insightsLoaded && isVisible) tasks.push(Promise.resolve(loadInsights()))
        if (tasks.length) void Promise.allSettled(tasks)
      }, 2500)
    },
    [autoSyncSuspendedUntil, insightsLoaded, loadInsights, loadOverview, overviewLoaded, overviewSectionRef]
  )

  const resumeAutoSync = React.useCallback(() => {
    apiFailureTimestampsRef.current = []
    setAutoSyncSuspendedUntil(0)
  }, [])

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
    overviewLoading,
  ])

  React.useEffect(() => {
    if (!canUseApi || !isAuthed) return
    if (!overviewVisible && !overviewEverVisible) return
    const timeoutId = window.setTimeout(() => {
      void loadOverview()
    }, 250)
    return () => window.clearTimeout(timeoutId)
  }, [canUseApi, isAuthed, loadOverview, overviewEverVisible, overviewVisible])

  React.useEffect(() => {
    if (!canUseApi || !isAuthed) return
    if (!overviewVisible && !overviewEverVisible) return
    const timeoutId = window.setTimeout(() => {
      void loadInsights()
    }, 450)
    return () => window.clearTimeout(timeoutId)
  }, [canUseApi, isAuthed, loadInsights, overviewEverVisible, overviewVisible])

  React.useEffect(() => {
    return () => {
      if (postMutationRefreshTimerRef.current) window.clearTimeout(postMutationRefreshTimerRef.current)
      try {
        overviewAbortRef.current?.abort()
        insightsAbortRef.current?.abort()
      } catch {
        // ignore
      }
    }
  }, [])

  return {
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
  }
}
