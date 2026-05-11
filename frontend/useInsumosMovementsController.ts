import React from 'react'
import { toast } from 'sonner'

import { combineLocalDateTimeToIso, dateInputToIso, normalizeMovimentacaoTipo } from '@/insumosShared'
import type { Movimentacao } from '@/insumosTypes'

type ApiJsonFn = <T>(path: string, opts?: { signal?: AbortSignal }) => Promise<T>
type MutateJsonFn = <T>(
  path: string,
  opts: {
    method?: string
    body?: unknown
    queueLabel?: string
  }
) => Promise<T | { queued: true }>

type MovementLoadError = { message: string; status: number; code?: string } | null

type UseInsumosMovementsControllerArgs = {
  apiJson: ApiJsonFn
  canUseApi: boolean
  editMovData: string
  editMovHora: string
  editMovMotivo: string
  editMovNovoEstoque: string
  editMovObservacoes: string
  editMovProduto: string
  editMovQuantidade: string
  editMovTarget: Movimentacao | null
  editMovUnidade: string
  isAuthed: boolean
  movAte: string
  movDe: string
  movFilterCategoria: string
  movFilterMarca: string
  movListContainerRef: React.RefObject<HTMLDivElement | null>
  movTipo: 'TODOS' | 'ENTRADA' | 'SAÍDA' | 'AJUSTE'
  mutateJson: MutateJsonFn
  refreshInsumos: () => Promise<void>
  schedulePostMutationRefresh: (opts?: { overview?: boolean; insights?: boolean }) => void
  selectedCodigoBarras: string
  setEditMovDeleting: React.Dispatch<React.SetStateAction<boolean>>
  setEditMovOpen: React.Dispatch<React.SetStateAction<boolean>>
  setEditMovSaving: React.Dispatch<React.SetStateAction<boolean>>
  setEditMovTarget: React.Dispatch<React.SetStateAction<Movimentacao | null>>
  setMovLoaded: React.Dispatch<React.SetStateAction<boolean>>
  setMovLoading: React.Dispatch<React.SetStateAction<boolean>>
  setMovLoadError: React.Dispatch<React.SetStateAction<MovementLoadError>>
  setMovimentacoes: React.Dispatch<React.SetStateAction<Movimentacao[]>>
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
}: UseInsumosMovementsControllerArgs) {
  const loadMovimentacoes = React.useCallback(async () => {
    if (!canUseApi || !isAuthed) return
    setMovLoading(true)
    try {
      const limite = 200
      let pagina = 1
      let merged: Movimentacao[] = []
      let totalOut: number | null = null

      while (true) {
        const params = buildMovimentacoesQuery({
          unidade,
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
        merged = [...merged, ...items]
        const total = Number((out as any)?.resumo?.totalMovimentacoes)
        if (Number.isFinite(total)) totalOut = total
        if (items.length < limite) break
        if (totalOut != null && merged.length >= totalOut) break
        pagina += 1
      }

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
    unidade,
  ])

  React.useEffect(() => {
    try {
      movListContainerRef.current?.scrollTo?.({ top: 0 })
    } catch {
      // ignore
    }
  }, [movAte, movDe, movFilterCategoria, movFilterMarca, movListContainerRef, movTipo, selectedCodigoBarras, unidade])

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
  }, [canUseApi, isAuthed, loadMovimentacoes, movAte, movDe, movTipo, selectedCodigoBarras, unidade])

  const saveMovementEdit = React.useCallback(async () => {
    const target = editMovTarget
    const movementId = String(target?.id || '').trim()
    if (!movementId) {
      toast.error('Movimentação inválida.')
      return
    }
    if (!canUseApi || !isAuthed) return

    const tipo = normalizeMovimentacaoTipo(target?.tipo)
    const produto = editMovProduto.trim()
    if (!produto) {
      toast.error('Informe o produto.')
      return
    }
    const dataHora = combineLocalDateTimeToIso(editMovData, editMovHora)
    if (!dataHora) {
      toast.error('Informe uma data e hora válidas.')
      return
    }

    const body: Record<string, unknown> = {
      produto,
      dataHora,
      observacoes: editMovObservacoes.trim(),
    }

    if (!String(target?.transferId || '').trim()) {
      const nextUnidade = String(editMovUnidade || '').trim()
      if (!nextUnidade) {
        toast.error('Informe a unidade.')
        return
      }
      body.unidade = nextUnidade
    }

    if (String(target?.transferId || '').trim()) {
      const quantidade = parseInt(editMovQuantidade, 10)
      if (!Number.isFinite(quantidade) || quantidade < 1) {
        toast.error('Informe uma quantidade válida.')
        return
      }
      body.quantidade = quantidade
    } else if (tipo === 'AJUSTE') {
      const estoqueNovo = parseInt(editMovNovoEstoque, 10)
      if (!Number.isFinite(estoqueNovo) || estoqueNovo < 0) {
        toast.error('Informe o novo estoque.')
        return
      }
      const motivo = editMovMotivo.trim()
      if (!motivo) {
        toast.error('Informe o motivo do ajuste.')
        return
      }
      body.estoqueNovo = estoqueNovo
      body.motivo = motivo
    } else {
      const quantidade = parseInt(editMovQuantidade, 10)
      if (!Number.isFinite(quantidade) || quantidade < 1) {
        toast.error('Informe uma quantidade válida.')
        return
      }
      body.quantidade = quantidade
    }

    setEditMovSaving(true)
    try {
      await mutateJson<{ success?: boolean }>(
        `/movimentacoes/${encodeURIComponent(movementId)}?unidade=${encodeURIComponent(
          String(target?.unidade || unidade || '').trim() || unidade
        )}`,
        {
          method: 'PUT',
          body,
          queueLabel: 'Edição de movimentação',
        }
      )
      toast.success('Lançamento atualizado.')
      setEditMovOpen(false)
      setEditMovTarget(null)
      await Promise.allSettled([refreshInsumos(), loadMovimentacoes()])
      schedulePostMutationRefresh({ overview: true, insights: true })
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error))
    } finally {
      setEditMovSaving(false)
    }
  }, [
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
    loadMovimentacoes,
    mutateJson,
    refreshInsumos,
    schedulePostMutationRefresh,
    setEditMovOpen,
    setEditMovSaving,
    setEditMovTarget,
    unidade,
  ])

  const deleteMovementEdit = React.useCallback(async () => {
    const target = editMovTarget
    const movementId = String(target?.id || '').trim()
    if (!movementId) {
      toast.error('Movimentação inválida.')
      return
    }
    if (!canUseApi || !isAuthed) return

    const confirmed = window.confirm('Excluir este lançamento? Essa ação recalcula o estoque do insumo.')
    if (!confirmed) return

    setEditMovDeleting(true)
    try {
      await mutateJson<{ success?: boolean }>(
        `/movimentacoes/${encodeURIComponent(movementId)}?unidade=${encodeURIComponent(
          String(target?.unidade || unidade || '').trim() || unidade
        )}`,
        {
          method: 'DELETE',
          queueLabel: 'Exclusão de movimentação',
        }
      )
      toast.success('Lançamento excluído.')
      setEditMovOpen(false)
      setEditMovTarget(null)
      await Promise.allSettled([refreshInsumos(), loadMovimentacoes()])
      schedulePostMutationRefresh({ overview: true, insights: true })
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error))
    } finally {
      setEditMovDeleting(false)
    }
  }, [
    canUseApi,
    editMovTarget,
    isAuthed,
    loadMovimentacoes,
    mutateJson,
    refreshInsumos,
    schedulePostMutationRefresh,
    setEditMovDeleting,
    setEditMovOpen,
    setEditMovTarget,
    unidade,
  ])

  return {
    deleteMovementEdit,
    loadMovimentacoes,
    saveMovementEdit,
  }
}
