import React from 'react'
import { toast } from 'sonner'

import { dateInputToIso, getInsumoBarcodes, normalizeTipoUnidadeToCanonical, parseBarcodeInput } from '@/insumosShared'
import type { Insumo } from '@/insumosTypes'

type MutateJsonFn = <T>(
  path: string,
  opts: {
    method?: string
    body?: unknown
    queueLabel?: string
  }
) => Promise<T | { queued: true }>

type PolicyErrorCode = 'POLICY_REQUIRES_LOT' | 'POLICY_REQUIRES_EXPIRY' | null
type EditValidationErrors = Partial<Record<'codigoBarras' | 'produto' | 'categoria' | 'marca' | 'tipoUnidade' | 'lote' | 'dataValidade' | 'policy', string>>

type UseInsumosInventoryMutationsControllerArgs = {
  canUseApi: boolean
  createCalibre: string
  createCategoria: string
  createCategoriaFefo: boolean
  createCategoriaRequiresExpiry: boolean
  createCategoriaRequiresLot: boolean
  createCodigo: string
  createCodigosExtras: string
  createConcentracao: string
  createDataValidade: string
  createEspecificacao: string
  createEstoqueInicial: string
  createEstoqueMinimo: string
  createHomologado: boolean
  createLote: string
  createMarca: string
  createNovoLote: boolean
  createPrecoCusto: string
  createProduto: string
  createTipoUnidade: string
  createVolume: string
  editCalibre: string
  editCategoria: string
  editCategoriaFefo: boolean
  editCategoriaRequiresExpiry: boolean
  editCategoriaRequiresLot: boolean
  editCodigo: string
  editCodigosExtras: string
  editConcentracao: string
  editDataValidade: string
  editEspecificacao: string
  editEstoqueMinimo: string
  editHomologado: boolean
  editLote: string
  editMarca: string
  editPrecoCusto: string
  editProduto: string
  editTarget: Insumo | null
  editTipoUnidade: string
  editVolume: string
  getPolicyErrorCode: (error: unknown) => PolicyErrorCode
  insumos: Insumo[]
  isAuthed: boolean
  loadInsumosOptions: () => Promise<void>
  loadOverview: (opts?: { force?: boolean; lite?: boolean }) => Promise<void>
  lotEditLote: string
  lotEditValidade: string
  lotSelecionado: Insumo | null
  mutateJson: MutateJsonFn
  policyErrorToast: (error: unknown) => boolean
  refreshInsumos: (opts?: { pagina?: number }) => Promise<void>
  setCreateCalibre: React.Dispatch<React.SetStateAction<string>>
  setCreateCategoria: React.Dispatch<React.SetStateAction<string>>
  setCreateCodigosExtras: React.Dispatch<React.SetStateAction<string>>
  setCreateCodigo: React.Dispatch<React.SetStateAction<string>>
  setCreateConcentracao: React.Dispatch<React.SetStateAction<string>>
  setCreateDataValidade: React.Dispatch<React.SetStateAction<string>>
  setCreateEspecificacao: React.Dispatch<React.SetStateAction<string>>
  setCreateEstoqueInicial: React.Dispatch<React.SetStateAction<string>>
  setCreateEstoqueMinimo: React.Dispatch<React.SetStateAction<string>>
  setCreateHomologado: React.Dispatch<React.SetStateAction<boolean>>
  setCreateLoading: React.Dispatch<React.SetStateAction<boolean>>
  setCreateLote: React.Dispatch<React.SetStateAction<string>>
  setCreateMarca: React.Dispatch<React.SetStateAction<string>>
  setCreateNovoLote: React.Dispatch<React.SetStateAction<boolean>>
  setCreateOpen: React.Dispatch<React.SetStateAction<boolean>>
  setCreatePrecoCusto: React.Dispatch<React.SetStateAction<string>>
  setCreateProduto: React.Dispatch<React.SetStateAction<string>>
  setCreateTipoUnidade: React.Dispatch<React.SetStateAction<string>>
  setCreateVolume: React.Dispatch<React.SetStateAction<string>>
  setEditOpen: React.Dispatch<React.SetStateAction<boolean>>
  setEditSaveError: React.Dispatch<React.SetStateAction<string | null>>
  setEditSaving: React.Dispatch<React.SetStateAction<boolean>>
  setEditValidationErrors: React.Dispatch<React.SetStateAction<EditValidationErrors>>
  setLotDialogOpen: React.Dispatch<React.SetStateAction<boolean>>
  setLotSaving: React.Dispatch<React.SetStateAction<boolean>>
  setQualityMatchesItems: React.Dispatch<React.SetStateAction<Insumo[]>>
  setQualityMatchesSavingRegistro: React.Dispatch<React.SetStateAction<string>>
  unidade: string
}

function resolveCreateDraft(args: {
  createCalibre: string
  createCategoria: string
  createCategoriaFefo: boolean
  createCategoriaRequiresExpiry: boolean
  createCategoriaRequiresLot: boolean
  createCodigo: string
  createCodigosExtras: string
  createConcentracao: string
  createDataValidade: string
  createEspecificacao: string
  createEstoqueInicial: string
  createEstoqueMinimo: string
  createHomologado: boolean
  createLote: string
  createMarca: string
  createNovoLote: boolean
  createPrecoCusto: string
  createProduto: string
  createTipoUnidade: string
  createVolume: string
  insumos: Insumo[]
}) {
  const codigoBarras = args.createCodigo.trim()
  if (!codigoBarras) return { error: 'Informe o código de barras' as const }

  const extraCodes = parseBarcodeInput(args.createCodigosExtras)
  const codigosBarras = Array.from(new Set([codigoBarras, ...extraCodes].map((value) => String(value || '').trim()).filter(Boolean)))
  const existing = (args.insumos || []).find((item) => getInsumoBarcodes(item).includes(codigoBarras))
  const categoria = args.createCategoria.trim() || String(existing?.categoria || '').trim()
  const policy = {
    requiresLot: !!args.createCategoriaRequiresLot,
    requiresExpiry: !!args.createCategoriaRequiresExpiry,
    fefo: !!args.createCategoriaFefo,
  }
  const validadeIso = dateInputToIso(args.createDataValidade)
  const allowDuplicateLot = args.createNovoLote || (!!existing && policy.requiresLot)

  if ((policy.requiresLot || allowDuplicateLot) && !args.createLote.trim()) {
    return {
      allowDuplicateLot,
      error: policy.requiresLot ? 'Informe o lote (obrigatório pelo item)' : 'Informe o lote (Novo lote: on)' as const,
    }
  }
  if (policy.requiresExpiry && !validadeIso) return { allowDuplicateLot, error: 'Informe a data de validade (obrigatória pelo item)' as const }
  if (policy.fefo && !policy.requiresExpiry) return { allowDuplicateLot, error: 'FEFO exige validade obrigatória' as const }

  const produto = args.createProduto.trim() || (allowDuplicateLot ? String(existing?.produto || '').trim() : '')
  if (!produto) return { allowDuplicateLot, error: 'Informe o produto' as const }

  const tipoUnidade = normalizeTipoUnidadeToCanonical(args.createTipoUnidade)
  if (!tipoUnidade) return { allowDuplicateLot, error: 'Informe a unidade (medida)' as const }

  return {
    allowDuplicateLot,
    body: {
      codigoBarras,
      codigosBarras,
      produto,
      allowDuplicateLot,
      categoria,
      marca: args.createMarca.trim(),
      tipoUnidade,
      especificacao: args.createEspecificacao.trim(),
      concentracao: args.createConcentracao.trim(),
      volume: args.createVolume.trim(),
      fonte: args.createHomologado ? 'Homologado' : '',
      calibre: args.createCalibre.trim(),
      precoCusto: args.createPrecoCusto ? Number(args.createPrecoCusto) : undefined,
      estoqueInicial: args.createEstoqueInicial ? Number(args.createEstoqueInicial) : undefined,
      estoqueMinimo: args.createEstoqueMinimo ? Number(args.createEstoqueMinimo) : undefined,
      lote: args.createLote.trim(),
      dataValidade: validadeIso || undefined,
      policyRequiresLot: policy.requiresLot,
      policyRequiresExpiry: policy.requiresExpiry,
      policyFefo: policy.fefo,
    },
    existing,
    codigoBarras,
  }
}

export function useInsumosInventoryMutationsController({
  canUseApi,
  createCalibre,
  createCategoria,
  createCategoriaFefo,
  createCategoriaRequiresExpiry,
  createCategoriaRequiresLot,
  createCodigo,
  createCodigosExtras,
  createConcentracao,
  createDataValidade,
  createEspecificacao,
  createEstoqueInicial,
  createEstoqueMinimo,
  createHomologado,
  createLote,
  createMarca,
  createNovoLote,
  createPrecoCusto,
  createProduto,
  createTipoUnidade,
  createVolume,
  editCalibre,
  editCategoria,
  editCategoriaFefo,
  editCategoriaRequiresExpiry,
  editCategoriaRequiresLot,
  editCodigo,
  editCodigosExtras,
  editConcentracao,
  editDataValidade,
  editEspecificacao,
  editEstoqueMinimo,
  editHomologado,
  editLote,
  editMarca,
  editPrecoCusto,
  editProduto,
  editTarget,
  editTipoUnidade,
  editVolume,
  getPolicyErrorCode,
  insumos,
  isAuthed,
  loadInsumosOptions,
  loadOverview,
  lotEditLote,
  lotEditValidade,
  lotSelecionado,
  mutateJson,
  policyErrorToast,
  refreshInsumos,
  setCreateCalibre,
  setCreateCategoria,
  setCreateCodigosExtras,
  setCreateCodigo,
  setCreateConcentracao,
  setCreateDataValidade,
  setCreateEspecificacao,
  setCreateEstoqueInicial,
  setCreateEstoqueMinimo,
  setCreateHomologado,
  setCreateLoading,
  setCreateLote,
  setCreateMarca,
  setCreateNovoLote,
  setCreateOpen,
  setCreatePrecoCusto,
  setCreateProduto,
  setCreateTipoUnidade,
  setCreateVolume,
  setEditOpen,
  setEditSaveError,
  setEditSaving,
  setEditValidationErrors,
  setLotDialogOpen,
  setLotSaving,
  setQualityMatchesItems,
  setQualityMatchesSavingRegistro,
  unidade,
}: UseInsumosInventoryMutationsControllerArgs) {
  const resetCreateInlineForm = React.useCallback(() => {
    setCreateCodigo('')
    setCreateCodigosExtras('')
    setCreateProduto('')
    setCreateCategoria('')
    setCreateMarca('')
    setCreateTipoUnidade('')
    setCreateEspecificacao('')
    setCreateConcentracao('')
    setCreateVolume('')
    setCreateHomologado(false)
    setCreateCalibre('')
    setCreatePrecoCusto('')
    setCreateEstoqueInicial('0')
    setCreateEstoqueMinimo('5')
    setCreateLote('')
    setCreateDataValidade('')
    setCreateNovoLote(false)
    setCreateOpen(false)
  }, [
    setCreateCalibre,
    setCreateCategoria,
    setCreateCodigosExtras,
    setCreateCodigo,
    setCreateConcentracao,
    setCreateDataValidade,
    setCreateEspecificacao,
    setCreateEstoqueInicial,
    setCreateEstoqueMinimo,
    setCreateHomologado,
    setCreateLote,
    setCreateMarca,
    setCreateNovoLote,
    setCreateOpen,
    setCreatePrecoCusto,
    setCreateProduto,
    setCreateTipoUnidade,
    setCreateVolume,
  ])

  const saveCreateFromModal = React.useCallback(async () => {
    const draft = resolveCreateDraft({
      createCalibre,
      createCategoria,
      createCategoriaFefo,
      createCategoriaRequiresExpiry,
      createCategoriaRequiresLot,
      createCodigo,
      createCodigosExtras,
      createConcentracao,
      createDataValidade,
      createEspecificacao,
      createEstoqueInicial,
      createEstoqueMinimo,
      createHomologado,
      createLote,
      createMarca,
      createNovoLote,
      createPrecoCusto,
      createProduto,
      createTipoUnidade,
      createVolume,
      insumos,
    })
    if ('allowDuplicateLot' in draft && draft.allowDuplicateLot && !createNovoLote) setCreateNovoLote(true)
    if ('error' in draft) return toast.error(draft.error)

    setCreateLoading(true)
    try {
      await mutateJson(`/insumos?unidade=${encodeURIComponent(unidade)}`, {
        method: 'POST',
        queueLabel: 'Cadastro de insumo',
        body: draft.body,
      })
      toast.success('Insumo cadastrado.')
      setCreateCodigosExtras('')
      setCreateOpen(false)
      await Promise.allSettled([refreshInsumos({ pagina: 1 }), loadOverview({ force: true }), loadInsumosOptions()])
    } catch (error) {
      if (policyErrorToast(error)) return
      toast.error(error instanceof Error ? error.message : String(error))
    } finally {
      setCreateLoading(false)
    }
  }, [
    createCalibre,
    createCategoria,
    createCategoriaFefo,
    createCategoriaRequiresExpiry,
    createCategoriaRequiresLot,
    createCodigo,
    createCodigosExtras,
    createConcentracao,
    createDataValidade,
    createEspecificacao,
    createEstoqueInicial,
    createEstoqueMinimo,
    createHomologado,
    createLote,
    createMarca,
    createNovoLote,
    createPrecoCusto,
    createProduto,
    createTipoUnidade,
    createVolume,
    insumos,
    loadInsumosOptions,
    loadOverview,
    mutateJson,
    policyErrorToast,
    refreshInsumos,
    setCreateCodigosExtras,
    setCreateLoading,
    setCreateNovoLote,
    setCreateOpen,
    unidade,
  ])

  const saveCreateInline = React.useCallback(async () => {
    const draft = resolveCreateDraft({
      createCalibre,
      createCategoria,
      createCategoriaFefo,
      createCategoriaRequiresExpiry,
      createCategoriaRequiresLot,
      createCodigo,
      createCodigosExtras,
      createConcentracao,
      createDataValidade,
      createEspecificacao,
      createEstoqueInicial,
      createEstoqueMinimo,
      createHomologado,
      createLote,
      createMarca,
      createNovoLote,
      createPrecoCusto,
      createProduto,
      createTipoUnidade,
      createVolume,
      insumos,
    })
    if ('allowDuplicateLot' in draft && draft.allowDuplicateLot && !createNovoLote) setCreateNovoLote(true)
    if ('error' in draft) return toast.error(draft.error)

    setCreateLoading(true)
    try {
      await mutateJson(`/insumos?unidade=${encodeURIComponent(unidade)}`, {
        method: 'POST',
        queueLabel: 'Cadastro de insumo',
        body: {
          ...draft.body,
          precoCusto: createPrecoCusto.trim(),
          estoqueInicial: Number(createEstoqueInicial) || 0,
          estoqueMinimo: Number(createEstoqueMinimo) || 0,
          dataValidade: dateInputToIso(createDataValidade),
        },
      })
      toast.success('Insumo cadastrado')
      resetCreateInlineForm()
      await Promise.allSettled([refreshInsumos({ pagina: 1 }), loadInsumosOptions()])
    } catch (error) {
      const status = (error as any)?.status
      const message = error instanceof Error ? error.message : String(error)
      if (status === 409 && /código de barras já cadastrado/i.test(message)) {
        setCreateNovoLote(true)
        toast.error('Código já existe. Ative “Novo lote” e informe Lote/Validade para cadastrar um lote adicional.')
        return
      }
      if (policyErrorToast(error)) return
      toast.error(message)
    } finally {
      setCreateLoading(false)
    }
  }, [
    createCalibre,
    createCategoria,
    createCategoriaFefo,
    createCategoriaRequiresExpiry,
    createCategoriaRequiresLot,
    createCodigo,
    createCodigosExtras,
    createConcentracao,
    createDataValidade,
    createEspecificacao,
    createEstoqueInicial,
    createEstoqueMinimo,
    createHomologado,
    createLote,
    createMarca,
    createNovoLote,
    createPrecoCusto,
    createProduto,
    createTipoUnidade,
    createVolume,
    insumos,
    loadInsumosOptions,
    mutateJson,
    policyErrorToast,
    refreshInsumos,
    resetCreateInlineForm,
    setCreateLoading,
    setCreateNovoLote,
    unidade,
  ])

  const saveLot = React.useCallback(async () => {
    if (!lotSelecionado?.registro) {
      toast.error('Registro do insumo ausente.')
      return
    }
    if (!canUseApi || !isAuthed) return
    setLotSaving(true)
    try {
      const dataValidade = dateInputToIso(lotEditValidade)
      await mutateJson<{ success?: boolean }>(`/insumos/${encodeURIComponent(lotSelecionado.registro)}?unidade=${encodeURIComponent(unidade)}`, {
        method: 'PUT',
        body: { lote: lotEditLote.trim(), dataValidade },
        queueLabel: 'Atualização de lote/validade',
      })
      toast.success('Lote/validade atualizados.')
      setLotDialogOpen(false)
      await Promise.allSettled([refreshInsumos(), loadOverview({ force: true })])
    } catch (error) {
      if (policyErrorToast(error)) return
      toast.error(error instanceof Error ? error.message : String(error))
    } finally {
      setLotSaving(false)
    }
  }, [
    canUseApi,
    isAuthed,
    loadOverview,
    lotEditLote,
    lotEditValidade,
    lotSelecionado?.registro,
    mutateJson,
    policyErrorToast,
    refreshInsumos,
    setLotDialogOpen,
    setLotSaving,
    unidade,
  ])

  const saveEdit = React.useCallback(async () => {
    const registro = String(editTarget?.registro || '').trim()
    if (!registro) {
      setEditSaveError('Registro do insumo ausente.')
      toast.error('Registro do insumo ausente.')
      return
    }
    if (!isAuthed) {
      setEditSaveError('Nao autenticado.')
      toast.error('Nao autenticado.')
      return
    }
    if (!canUseApi) {
      setEditSaveError('API indisponivel ou nao pronta. Aguarde carregar e tente novamente.')
      toast.error('API indisponivel ou nao pronta. Aguarde carregar e tente novamente.')
      return
    }

    const codigoBarras = editCodigo.trim()
    const extraCodes = parseBarcodeInput(editCodigosExtras)
    const codigosBarras = Array.from(new Set([codigoBarras, ...extraCodes].map((value) => String(value || '').trim()).filter(Boolean)))
    const produto = editProduto.trim()
    if (!codigoBarras) {
      setEditValidationErrors({ codigoBarras: 'Obrigatorio.' })
      setEditSaveError('Informe o código de barras para salvar.')
      return toast.error('Informe o código de barras')
    }
    if (!produto) {
      setEditValidationErrors({ produto: 'Obrigatorio.' })
      setEditSaveError('Informe o produto para salvar.')
      return toast.error('Informe o produto')
    }

    setEditSaving(true)
    try {
      setEditSaveError(null)
      setEditValidationErrors({})
      const categoria = editCategoria.trim()
      const policy = {
        requiresLot: !!editCategoriaRequiresLot,
        requiresExpiry: !!editCategoriaRequiresExpiry,
        fefo: !!editCategoriaFefo,
      }
      const lote = editLote.trim()
      const dataValidade = dateInputToIso(editDataValidade)
      const tipoUnidade = normalizeTipoUnidadeToCanonical(editTipoUnidade)

      if (!tipoUnidade) {
        setEditValidationErrors({ tipoUnidade: 'Selecione a unidade (medida).' })
        setEditSaveError('Informe a unidade (medida) para salvar.')
        toast.error('Informe a unidade (medida) para salvar.')
        return
      }
      if (policy.fefo && !policy.requiresExpiry) {
        setEditValidationErrors({ policy: 'FEFO exige validade obrigatoria.' })
        setEditSaveError('FEFO exige validade obrigatoria.')
        toast.error('FEFO exige validade obrigatória')
        return
      }
      if (policy.requiresLot && !lote) {
        setEditValidationErrors({ policy: 'Lote obrigatorio pela politica.', lote: 'Obrigatorio (pela politica do item).' })
        setEditSaveError('Este item exige Lote. Preencha o campo lote para salvar.')
        toast.error('Este item exige Lote. Preencha o campo lote para salvar.')
        return
      }
      if (policy.requiresExpiry && !dataValidade) {
        setEditValidationErrors({ policy: 'Validade obrigatoria pela politica.', dataValidade: 'Obrigatorio (pela politica do item).' })
        setEditSaveError('Este item exige Data de validade. Preencha o campo validade para salvar.')
        toast.error('Este item exige Data de validade. Preencha o campo validade para salvar.')
        return
      }

      await mutateJson(`/insumos/${encodeURIComponent(registro)}?unidade=${encodeURIComponent(unidade)}`, {
        method: 'PUT',
        queueLabel: 'Edição de insumo',
        body: {
          codigoBarras,
          codigosBarras,
          produto,
          categoria,
          marca: editMarca.trim(),
          tipoUnidade,
          especificacao: editEspecificacao.trim(),
          concentracao: editConcentracao.trim(),
          volume: editVolume.trim(),
          fonte: editHomologado ? 'Homologado' : '',
          calibre: editCalibre.trim(),
          precoCusto: editPrecoCusto.trim(),
          estoqueMinimo: Number(editEstoqueMinimo) || 0,
          lote,
          dataValidade,
          policyRequiresLot: policy.requiresLot,
          policyRequiresExpiry: policy.requiresExpiry,
          policyFefo: policy.fefo,
        },
      })
      toast.success('Insumo atualizado')
      setEditOpen(false)
      await Promise.allSettled([refreshInsumos({ pagina: 1 }), loadOverview({ force: true }), loadInsumosOptions()])
    } catch (error) {
      const policyCode = getPolicyErrorCode(error)
      if (policyCode) {
        setEditSaveError(error instanceof Error ? error.message : String(error))
        policyErrorToast(error)
        if (policyCode === 'POLICY_REQUIRES_LOT') {
          setEditValidationErrors({ policy: 'Lote obrigatorio pela politica.', lote: 'Obrigatorio (pela politica do item).' })
        } else {
          setEditValidationErrors({ policy: 'Validade obrigatoria pela politica.', dataValidade: 'Obrigatorio (pela politica do item).' })
        }
        return
      }
      setEditSaveError(error instanceof Error ? error.message : String(error))
      toast.error(error instanceof Error ? error.message : String(error))
    } finally {
      setEditSaving(false)
    }
  }, [
    canUseApi,
    editCalibre,
    editCategoria,
    editCategoriaFefo,
    editCategoriaRequiresExpiry,
    editCategoriaRequiresLot,
    editCodigo,
    editCodigosExtras,
    editConcentracao,
    editDataValidade,
    editEspecificacao,
    editEstoqueMinimo,
    editHomologado,
    editLote,
    editMarca,
    editPrecoCusto,
    editProduto,
    editTarget?.registro,
    editTipoUnidade,
    editVolume,
    getPolicyErrorCode,
    isAuthed,
    loadInsumosOptions,
    loadOverview,
    mutateJson,
    policyErrorToast,
    refreshInsumos,
    setEditOpen,
    setEditSaveError,
    setEditSaving,
    setEditValidationErrors,
    unidade,
  ])

  const deleteEdit = React.useCallback(async () => {
    const registro = String(editTarget?.registro || '').trim()
    if (!registro || !canUseApi || !isAuthed) return
    if (!window.confirm('Excluir este insumo? Esta ação não pode ser desfeita.')) return
    setEditSaving(true)
    try {
      await mutateJson(`/insumos/${encodeURIComponent(registro)}?unidade=${encodeURIComponent(unidade)}`, {
        method: 'DELETE',
        queueLabel: 'Exclusão de insumo',
      })
      toast.success('Insumo excluído')
      setEditOpen(false)
      await Promise.allSettled([refreshInsumos({ pagina: 1 }), loadOverview({ force: true }), loadInsumosOptions()])
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error))
    } finally {
      setEditSaving(false)
    }
  }, [
    canUseApi,
    editTarget?.registro,
    isAuthed,
    loadInsumosOptions,
    loadOverview,
    mutateJson,
    refreshInsumos,
    setEditOpen,
    setEditSaving,
    unidade,
  ])

  const deleteInsumoByRegistro = React.useCallback(async (registroRaw: string) => {
    const registro = String(registroRaw || '').trim()
    if (!registro || !canUseApi || !isAuthed) return
    if (!window.confirm('Excluir este insumo? Esta ação não pode ser desfeita.')) return
    setQualityMatchesSavingRegistro(registro)
    try {
      await mutateJson(`/insumos/${encodeURIComponent(registro)}?unidade=${encodeURIComponent(unidade)}`, {
        method: 'DELETE',
        queueLabel: 'Exclusão de insumo',
      })
      toast.success('Insumo excluído')
      setQualityMatchesItems((prev) => prev.filter((item) => String(item?.registro || '').trim() !== registro))
      await Promise.allSettled([refreshInsumos({ pagina: 1 }), loadOverview({ force: true }), loadInsumosOptions()])
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error))
    } finally {
      setQualityMatchesSavingRegistro('')
    }
  }, [
    canUseApi,
    isAuthed,
    loadInsumosOptions,
    loadOverview,
    mutateJson,
    refreshInsumos,
    setQualityMatchesItems,
    setQualityMatchesSavingRegistro,
    unidade,
  ])

  return {
    deleteEdit,
    deleteInsumoByRegistro,
    saveCreateFromModal,
    saveCreateInline,
    saveEdit,
    saveLot,
  }
}
