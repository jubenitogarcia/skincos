import React from 'react'
import { dispatchInsumosHeaderAction, emitInsumosHeaderState, subscribeInsumosHeaderAction } from '@/insumosBridge'
import type {
  InsumosHeaderState,
  InsumosLayoutAction,
  InsumosOverviewPeriod,
  InsumosQuickOperation,
} from '@/insumosTypes'

type UseInsumosHeaderBridgeArgs = {
  allUnidades: string[]
  allowedUnits: string[]
  loadInsights: (opts?: { force?: boolean }) => Promise<void>
  loadOverview: (opts?: { force?: boolean }) => Promise<void>
  loadingPercent: number
  openQuickOperation: (op: InsumosQuickOperation) => void
  overviewCustomFrom: string
  overviewCustomTo: string
  overviewMovResumo: { entradaValor?: number | null; saidaValor?: number | null } | null
  overviewPeriod: InsumosOverviewPeriod
  overviewResumo: { valorEstoqueTotal?: number | null } | null
  refreshInsumos: () => Promise<void>
  resetUserLayoutPrefs: () => Promise<void>
  selectedUnit: string
  setAllDetailsOpen: (value: boolean) => void
  setOverviewCustomFrom: React.Dispatch<React.SetStateAction<string>>
  setOverviewCustomTo: React.Dispatch<React.SetStateAction<string>>
  setOverviewPeriod: React.Dispatch<React.SetStateAction<InsumosOverviewPeriod>>
  setSelectedUnit: React.Dispatch<React.SetStateAction<string>>
  showOverviewLoadingProgress: boolean
  status: InsumosHeaderState['status']
  storageKey: string
}

export function useInsumosHeaderBridge({
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
  selectedUnit,
  setAllDetailsOpen,
  setOverviewCustomFrom,
  setOverviewCustomTo,
  setOverviewPeriod,
  setSelectedUnit,
  showOverviewLoadingProgress,
  status,
  storageKey,
}: UseInsumosHeaderBridgeArgs) {
  React.useEffect(() => {
    try {
      window.localStorage.setItem(storageKey, selectedUnit)
    } catch {
      // ignore
    }
  }, [selectedUnit, storageKey])

  React.useEffect(() => {
    if (!allowedUnits.length) return
    if (allowedUnits.includes(selectedUnit)) return
    const next = allowedUnits[0]
    setSelectedUnit(next)
    dispatchInsumosHeaderAction({ type: 'set-unit', value: next })
  }, [allowedUnits, selectedUnit, setSelectedUnit])

  React.useEffect(() => {
    if (!allUnidades.length) return
    if (allUnidades.includes(selectedUnit)) return
    const next = allUnidades[0]
    if (!next) return
    setSelectedUnit(next)
    dispatchInsumosHeaderAction({ type: 'set-unit', value: next })
  }, [allUnidades, selectedUnit, setSelectedUnit])

  React.useEffect(() => {
    emitInsumosHeaderState({
      status,
      stock: {
        value: overviewResumo?.valorEstoqueTotal == null ? null : Number(overviewResumo.valorEstoqueTotal),
        loading: showOverviewLoadingProgress,
        percent: loadingPercent,
        entradaValor: Number.isFinite(Number(overviewMovResumo?.entradaValor)) ? Number(overviewMovResumo?.entradaValor) : null,
        saidaValor: Number.isFinite(Number(overviewMovResumo?.saidaValor)) ? Number(overviewMovResumo?.saidaValor) : null,
      },
      selectedUnit,
      overview: {
        period: overviewPeriod,
        from: overviewCustomFrom,
        to: overviewCustomTo,
      },
    })
  }, [
    loadingPercent,
    overviewCustomFrom,
    overviewCustomTo,
    overviewMovResumo?.entradaValor,
    overviewMovResumo?.saidaValor,
    overviewPeriod,
    overviewResumo?.valorEstoqueTotal,
    selectedUnit,
    showOverviewLoadingProgress,
    status,
  ])

  React.useEffect(() => {
    return subscribeInsumosHeaderAction((action) => {
      if (action.type === 'set-unit') {
        setSelectedUnit(action.value)
        return
      }
      if (action.type === 'set-overview') {
        if (action.value.period) setOverviewPeriod(action.value.period)
        if (typeof action.value.from === 'string') setOverviewCustomFrom(action.value.from)
        if (typeof action.value.to === 'string') setOverviewCustomTo(action.value.to)
        if (action.value.action === 'reload') {
          void Promise.allSettled([loadOverview({ force: true }), loadInsights({ force: true }), refreshInsumos()])
        }
        return
      }
      if (action.type === 'reload-overview') {
        void Promise.allSettled([loadOverview({ force: true }), loadInsights({ force: true }), refreshInsumos()])
        return
      }
      if (action.type === 'quick-op') {
        openQuickOperation(action.value)
        try {
          window.scrollTo({ top: 0, behavior: 'smooth' })
        } catch {
          // ignore
        }
        return
      }
      if (action.type === 'layout') {
        const layoutAction: InsumosLayoutAction = action.value
        if (layoutAction === 'expandAll') setAllDetailsOpen(true)
        if (layoutAction === 'collapseAll') setAllDetailsOpen(false)
        if (layoutAction === 'reset') void resetUserLayoutPrefs()
      }
    })
  }, [
    loadInsights,
    loadOverview,
    openQuickOperation,
    refreshInsumos,
    resetUserLayoutPrefs,
    setAllDetailsOpen,
    setOverviewCustomFrom,
    setOverviewCustomTo,
    setOverviewPeriod,
    setSelectedUnit,
  ])
}
