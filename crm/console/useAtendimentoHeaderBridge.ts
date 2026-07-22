import { useEffect } from 'react'
import { emitAtendimentoHeaderState, subscribeAtendimentoHeaderAction } from '@/atendimentoHeaderBridge'
import type { AtendimentoFilters } from '@/atendimentoDomain'

type HeaderOption = { value: string; label: string }

type UseAtendimentoHeaderBridgeOptions = {
  loading: boolean
  canManage: boolean
  filters: AtendimentoFilters
  units: HeaderOption[]
  procedures: HeaderOption[]
  injectors: HeaderOption[]
  activeUnitLabel: string
  periodLabel: string
  periodOperationalDays: number | null
  latestImportLabel: string
  localMirrorSummary: string
  localMirrorDetail: string
  total: number
  refresh: () => void | Promise<void>
  refreshManagement: (options?: { force?: boolean }) => void | Promise<void>
  openImport: () => void
  openReport: () => void | Promise<void>
  updateFilters: (patch: Partial<AtendimentoFilters>) => void
}

/** Owns the bridge subscription so the page component stays focused on domain state. */
export function useAtendimentoHeaderBridge({
  loading,
  canManage,
  filters,
  units,
  procedures,
  injectors,
  activeUnitLabel,
  periodLabel,
  periodOperationalDays,
  latestImportLabel,
  localMirrorSummary,
  localMirrorDetail,
  total,
  refresh,
  refreshManagement,
  openImport,
  openReport,
  updateFilters,
}: UseAtendimentoHeaderBridgeOptions) {
  useEffect(() => {
    emitAtendimentoHeaderState({
      loading,
      canManage,
      filters,
      units,
      procedures,
      injectors,
      activeUnitLabel,
      periodLabel,
      periodOperationalDays,
      latestImportLabel,
      localMirrorSummary,
      localMirrorDetail,
      total,
    })
    return () => emitAtendimentoHeaderState(null)
  }, [activeUnitLabel, canManage, filters, injectors, latestImportLabel, loading, localMirrorDetail, localMirrorSummary, periodLabel, periodOperationalDays, procedures, total, units])

  useEffect(() => subscribeAtendimentoHeaderAction((action) => {
    if (action.type === 'refresh') {
      void refresh()
      void refreshManagement({ force: true })
      return
    }
    if (action.type === 'open-import') {
      if (canManage) openImport()
      return
    }
    if (action.type === 'report') {
      void openReport()
      return
    }
    if (action.type === 'set-filter') updateFilters(action.patch)
  }), [canManage, openImport, openReport, refresh, refreshManagement, updateFilters])
}
