import React from 'react'
import { toast } from 'sonner'

import type { InsumosQuickOperation, QuickActionFeedback, QuickCandidate } from '@/insumosTypes'

type MutateJsonFn = <T>(
  path: string,
  opts: {
    method?: string
    body?: unknown
    queueLabel?: string
  }
) => Promise<T | { queued: true }>

type SchedulePostMutationRefreshFn = (opts?: { overview?: boolean; insights?: boolean }) => void

type UseInsumosQuickOperationsControllerArgs = {
  canUseApi: boolean
  isAuthed: boolean
  loadMovimentacoes: () => Promise<void>
  mutateJson: MutateJsonFn
  policyErrorToast: (error: unknown) => boolean
  quickCodigo: string
  quickLoteNeedsPick: boolean
  quickMotivo: string
  quickNovoEstoque: string
  quickObs: string
  quickQuantidade: string
  quickRegistro: string
  refreshInsumos: () => Promise<void>
  schedulePostMutationRefresh: SchedulePostMutationRefreshFn
  setQuickActionFeedback: React.Dispatch<React.SetStateAction<QuickActionFeedback | null>>
  setQuickActionLoading: React.Dispatch<React.SetStateAction<boolean>>
  setQuickCandidates: React.Dispatch<React.SetStateAction<QuickCandidate[]>>
  setQuickRegistros: React.Dispatch<React.SetStateAction<string[]>>
  transferFrom: string
  transferTo: string
  unidade: string
}

function normalizeAmbiguousCandidates(raw: unknown): QuickCandidate[] {
  const list = Array.isArray(raw) ? raw : []
  return list
    .map((candidate: any) => ({
      registro: String(candidate?.registro || '').trim(),
      lote: String(candidate?.lote || '').trim(),
      dataValidade: candidate?.dataValidade ? String(candidate.dataValidade) : null,
      estoque: Number.isFinite(Number(candidate?.estoque)) ? Number(candidate.estoque) : 0,
    }))
    .filter((candidate) => candidate.registro)
    .sort((a, b) => {
      const sa = (Number(a.estoque) || 0) > 0 ? 0 : 1
      const sb = (Number(b.estoque) || 0) > 0 ? 0 : 1
      if (sa !== sb) return sa - sb
      const da = a.dataValidade ? new Date(a.dataValidade).getTime() : Number.POSITIVE_INFINITY
      const db = b.dataValidade ? new Date(b.dataValidade).getTime() : Number.POSITIVE_INFINITY
      if (da !== db) return da - db
      return String(a.registro).localeCompare(String(b.registro))
    })
}

function applyAmbiguousSelection(args: {
  error: unknown
  setQuickActionFeedback: React.Dispatch<React.SetStateAction<QuickActionFeedback | null>>
  setQuickCandidates: React.Dispatch<React.SetStateAction<QuickCandidate[]>>
  setQuickRegistros: React.Dispatch<React.SetStateAction<string[]>>
}) {
  const code = String((args.error as any)?.code || '').toUpperCase()
  if (code !== 'AMBIGUOUS') return false

  const registros = Array.isArray((args.error as any)?.registros) ? (args.error as any).registros : []
  const candidates = normalizeAmbiguousCandidates((args.error as any)?.candidates)
  if (candidates.length) {
    args.setQuickCandidates(candidates)
    args.setQuickRegistros(candidates.map((candidate) => candidate.registro))
  } else {
    args.setQuickCandidates([])
    args.setQuickRegistros(registros)
  }
  args.setQuickActionFeedback({
    type: 'error',
    message: 'Este código possui múltiplos lotes. Selecione o lote/registro.',
  })
  return true
}

export function useInsumosQuickOperationsController({
  canUseApi,
  isAuthed,
  loadMovimentacoes,
  mutateJson,
  policyErrorToast,
  quickCodigo,
  quickLoteNeedsPick,
  quickMotivo,
  quickNovoEstoque,
  quickObs,
  quickQuantidade,
  quickRegistro,
  refreshInsumos,
  schedulePostMutationRefresh,
  setQuickActionFeedback,
  setQuickActionLoading,
  setQuickCandidates,
  setQuickRegistros,
  transferFrom,
  transferTo,
  unidade,
}: UseInsumosQuickOperationsControllerArgs) {
  const runQuickOperation = React.useCallback(
    async (operation: Exclude<InsumosQuickOperation, 'TRANSFERENCIA'>): Promise<boolean> => {
      if (!canUseApi || !isAuthed) return false
      setQuickActionFeedback(null)
      const codigoBarras = quickCodigo.trim()
      if (!codigoBarras) {
        setQuickActionFeedback({ type: 'error', message: 'Informe o código de barras' })
        return false
      }

      setQuickActionLoading(true)
      try {
        if (operation === 'AJUSTE') {
          const novoEstoque = Number.isFinite(Number(quickNovoEstoque)) ? Number(quickNovoEstoque) : null
          if (novoEstoque === null) {
            setQuickActionFeedback({ type: 'error', message: 'Informe o novo estoque' })
            return false
          }
          const registro = quickRegistro.trim()
          await mutateJson(`/insumos/ajuste?unidade=${encodeURIComponent(unidade)}`, {
            method: 'POST',
            body: {
              codigoBarras,
              registro: registro || undefined,
              novoEstoque,
              motivo: quickMotivo,
              observacoes: quickObs,
            },
            queueLabel: 'Ajuste',
          })
          setQuickActionFeedback({ type: 'success', message: 'Ajuste registrado' })
        } else {
          const quantidade = Math.max(1, parseInt(quickQuantidade, 10) || 0)
          const path = operation === 'ENTRADA' ? '/insumos/entrada' : '/insumos/baixa'
          const registro = quickRegistro.trim()
          if (quickLoteNeedsPick && !registro) {
            setQuickActionFeedback({ type: 'error', message: 'Selecione o lote/registro' })
            return false
          }
          const out = await mutateJson<{ success?: boolean; novoEstoque?: number; quebraEstoque?: boolean; deficit?: number }>(
            `${path}?unidade=${encodeURIComponent(unidade)}`,
            {
              method: 'POST',
              body: { codigoBarras, registro: registro || undefined, quantidade, observacoes: quickObs },
              queueLabel: operation === 'ENTRADA' ? 'Entrada' : 'Baixa',
            },
          )
          const novoEstoque = Number((out as any)?.novoEstoque)
          const quebraEstoque =
            operation === 'BAIXA' && ((out as any)?.quebraEstoque === true || (Number.isFinite(novoEstoque) && novoEstoque < 0))
          const message = quebraEstoque
            ? `Baixa registrada com quebra de estoque (saldo: ${Number.isFinite(novoEstoque) ? novoEstoque : '-'})`
            : operation === 'ENTRADA'
              ? 'Entrada registrada'
              : 'Baixa registrada'
          setQuickActionFeedback({ type: 'success', message })
          if (quebraEstoque) {
            const deficit = Number((out as any)?.deficit)
            toast.warning(`Quebra de estoque detectada${Number.isFinite(deficit) ? `: déficit de ${deficit}` : ''}. Confira os alertas.`)
          }
        }

        await Promise.allSettled([refreshInsumos(), loadMovimentacoes()])
        schedulePostMutationRefresh({ overview: true, insights: true })
        return true
      } catch (error) {
        if (
          applyAmbiguousSelection({
            error,
            setQuickActionFeedback,
            setQuickCandidates,
            setQuickRegistros,
          })
        ) {
          return false
        }
        if (policyErrorToast(error)) {
          setQuickActionFeedback({ type: 'error', message: error instanceof Error ? error.message : String(error) })
          return false
        }
        setQuickActionFeedback({ type: 'error', message: error instanceof Error ? error.message : String(error) })
        return false
      } finally {
        setQuickActionLoading(false)
      }
    },
    [
      canUseApi,
      isAuthed,
      loadMovimentacoes,
      mutateJson,
      policyErrorToast,
      quickCodigo,
      quickLoteNeedsPick,
      quickMotivo,
      quickNovoEstoque,
      quickObs,
      quickQuantidade,
      quickRegistro,
      refreshInsumos,
      schedulePostMutationRefresh,
      setQuickActionFeedback,
      setQuickActionLoading,
      setQuickCandidates,
      setQuickRegistros,
      unidade,
    ],
  )

  const runTransfer = React.useCallback(async (): Promise<boolean> => {
    if (!canUseApi || !isAuthed) return false
    setQuickActionFeedback(null)
    const codigoBarras = quickCodigo.trim()
    if (!codigoBarras) {
      setQuickActionFeedback({ type: 'error', message: 'Informe o código de barras' })
      return false
    }
    if (transferFrom === transferTo) {
      setQuickActionFeedback({ type: 'error', message: 'Origem e destino devem ser diferentes' })
      return false
    }

    const registro = quickRegistro.trim()
    if (quickLoteNeedsPick && !registro) {
      setQuickActionFeedback({ type: 'error', message: 'Selecione o lote/registro' })
      return false
    }

    setQuickActionLoading(true)
    try {
      const quantidade = Math.max(1, parseInt(quickQuantidade, 10) || 0)
      const out = await mutateJson<{
        success?: boolean
        estoqueNovoOrigem?: number
        quebraEstoqueOrigem?: boolean
        deficitOrigem?: number
      }>(`/insumos/transferir?unidade=${encodeURIComponent(transferFrom)}`, {
        method: 'POST',
        body: {
          codigoBarras,
          registro: registro || undefined,
          quantidade,
          fromUnidade: transferFrom,
          toUnidade: transferTo,
          observacoes: quickObs,
        },
        queueLabel: 'Transferência',
      })

      const novoOrigem = Number((out as any)?.estoqueNovoOrigem)
      const quebraEstoque = (out as any)?.quebraEstoqueOrigem === true || (Number.isFinite(novoOrigem) && novoOrigem < 0)
      const message = quebraEstoque
        ? `Transferência registrada com quebra de estoque (origem: ${Number.isFinite(novoOrigem) ? novoOrigem : '-'})`
        : 'Transferência registrada'
      setQuickActionFeedback({ type: 'success', message })
      if (quebraEstoque) {
        const deficit = Number((out as any)?.deficitOrigem)
        toast.warning(
          `Quebra de estoque detectada na origem${Number.isFinite(deficit) ? `: déficit de ${deficit}` : ''}. Confira os alertas.`,
        )
      }

      await Promise.allSettled([refreshInsumos(), loadMovimentacoes()])
      schedulePostMutationRefresh({ overview: true, insights: true })
      return true
    } catch (error) {
      if (
        applyAmbiguousSelection({
          error,
          setQuickActionFeedback,
          setQuickCandidates,
          setQuickRegistros,
        })
      ) {
        return false
      }
      if (policyErrorToast(error)) {
        setQuickActionFeedback({ type: 'error', message: error instanceof Error ? error.message : String(error) })
        return false
      }
      setQuickActionFeedback({ type: 'error', message: error instanceof Error ? error.message : String(error) })
      return false
    } finally {
      setQuickActionLoading(false)
    }
  }, [
    canUseApi,
    isAuthed,
    loadMovimentacoes,
    mutateJson,
    policyErrorToast,
    quickCodigo,
    quickLoteNeedsPick,
    quickObs,
    quickQuantidade,
    quickRegistro,
    refreshInsumos,
    schedulePostMutationRefresh,
    setQuickActionFeedback,
    setQuickActionLoading,
    setQuickCandidates,
    setQuickRegistros,
    transferFrom,
    transferTo,
  ])

  return {
    runQuickOperation,
    runTransfer,
  }
}
