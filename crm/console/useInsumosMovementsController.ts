import React from 'react'
import { toast } from 'sonner'

import { dateInputToIso } from '@/insumosShared'
import { INSUMOS_ALL_UNITS } from '@/insumosUnitAccess'
import type { Movimentacao } from '@/insumosTypes'

type ApiJsonFn = <T>(path: string, opts?: { signal?: AbortSignal }) => Promise<T>
type MovementLoadError = { message: string; status: number; code?: string } | null

type UseInsumosMovementsControllerArgs = {
  apiJson: ApiJsonFn
  canUseApi: boolean
  isAuthed: boolean
  movAte: string
  movDe: string
  movFilterCategoria: string
  movFilterMarca: string
  movListContainerRef: React.RefObject<HTMLDivElement | null>
  movTipo: 'TODOS' | 'ENTRADA' | 'SAÍDA' | 'AJUSTE'
  selectedCodigoBarras: string
  setMovLoaded: React.Dispatch<React.SetStateAction<boolean>>
  setMovLoading: React.Dispatch<React.SetStateAction<boolean>>
  setMovLoadError: React.Dispatch<React.SetStateAction<MovementLoadError>>
  setMovimentacoes: React.Dispatch<React.SetStateAction<Movimentacao[]>>
  readableUnits: string[]
  unidade: string
}

export function buildMovimentacoesQuery(args: {
  unidade: string
  limite: number
  pagina: number
  movTipo: 'TODOS' | 'ENTRADA' | 'SAÍDA' | 'AJUSTE'
  selectedCodigoBarras: string
  movDe: string
  movAte: string
}) {
  const params = new URLSearchParams()
  params.set('unidade', args.unidade)
  params.set('limite', String(args.limite))
  params.set('pagina', String(args.pagina))
  if (args.movTipo !== 'TODOS') params.set('tipo', args.movTipo)

  const codigo = String(args.selectedCodigoBarras || '').trim()
  if (codigo) params.set('codigoBarras', codigo)

  const deIso = dateInputToIso(args.movDe)
  const ateIso = dateInputToIso(args.movAte)
  if (deIso) params.set('de', deIso)
  if (ateIso) params.set('ate', ateIso)
  return params
}

export function useInsumosMovementsController({
  apiJson,
  canUseApi,
  isAuthed,
  movAte,
  movDe,
  movFilterCategoria,
  movFilterMarca,
  movListContainerRef,
  movTipo,
  selectedCodigoBarras,
  setMovLoaded,
  setMovLoading,
  setMovLoadError,
  setMovimentacoes,
  readableUnits,
  unidade,
}: UseInsumosMovementsControllerArgs) {
  const loadMovimentacoes = React.useCallback(async () => {
    if (!canUseApi || !isAuthed) return
    setMovLoading(true)
    try {
      const limite = 200
      const units = unidade === INSUMOS_ALL_UNITS ? readableUnits : [unidade]
      const loadUnit = async (unit: string) => {
        let pagina = 1
        let itemsForUnit: Movimentacao[] = []
        let totalOut: number | null = null
        while (true) {
          const params = buildMovimentacoesQuery({
            unidade: unit,
            limite,
            pagina,
            movTipo,
            selectedCodigoBarras,
            movDe,
            movAte,
          })
          const out = await apiJson<{ success?: boolean; data?: Movimentacao[]; movimentos?: Movimentacao[]; resumo?: any }>(
            `/movimentacoes?${params.toString()}`
          )
          const list = (out as any)?.movimentos ?? out?.data
          const items = Array.isArray(list) ? list : []
          itemsForUnit = [...itemsForUnit, ...items.map((item) => ({ ...item, unidade: String(item?.unidade || unit) }))]
          const total = Number((out as any)?.resumo?.totalMovimentacoes)
          if (Number.isFinite(total)) totalOut = total
          if (items.length < limite) break
          if (totalOut != null && itemsForUnit.length >= totalOut) break
          pagina += 1
        }
        return itemsForUnit
      }

      const perUnit = await Promise.all(units.filter(Boolean).map(loadUnit))
      const merged = perUnit.flat()

      setMovimentacoes(merged)
      setMovLoadError(null)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error))
      setMovLoadError({
        message: error instanceof Error ? error.message : String(error),
        status: Number((error as any)?.status || 0) || 0,
        code: (error as any)?.code ? String((error as any).code) : undefined,
      })
      setMovimentacoes([])
    } finally {
      setMovLoaded(true)
      setMovLoading(false)
    }
  }, [
    apiJson,
    canUseApi,
    isAuthed,
    movAte,
    movDe,
    movTipo,
    selectedCodigoBarras,
    setMovLoaded,
    setMovLoading,
    setMovLoadError,
    setMovimentacoes,
    readableUnits,
    unidade,
  ])

  React.useEffect(() => {
    try {
      movListContainerRef.current?.scrollTo?.({ top: 0 })
    } catch {
      // ignore
    }
  }, [movAte, movDe, movFilterCategoria, movFilterMarca, movListContainerRef, movTipo, readableUnits.join('|'), selectedCodigoBarras, unidade])

  React.useEffect(() => {
    if (!canUseApi || !isAuthed) return
    const deIso = movDe.trim() ? dateInputToIso(movDe) : ''
    const ateIso = movAte.trim() ? dateInputToIso(movAte) : ''
    if (movDe.trim() && !deIso) return
    if (movAte.trim() && !ateIso) return
    const timeoutId = window.setTimeout(() => {
      void loadMovimentacoes()
    }, 250)
    return () => window.clearTimeout(timeoutId)
  }, [canUseApi, isAuthed, loadMovimentacoes, movAte, movDe, movTipo, readableUnits.join('|'), selectedCodigoBarras, unidade])

  return {
    loadMovimentacoes,
  }
}
