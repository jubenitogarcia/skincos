import React from 'react'

import { normalizeTipoUnidadeToCanonical } from '@/insumosShared'
import type { Insumo } from '@/insumosTypes'

type LookupByCodigoFn = (args: { codigoBarras: string; ctxUnidade: string }) => Promise<Insumo[]>
type ReadCachedByCodigoFn = (args: { codigoBarras: string; ctxUnidade: string }) => Insumo[]

type UseInsumosCreateLookupControllerArgs = {
  canUseApi: boolean
  createCalibre: string
  createCategoria: string
  createCodigo: string
  createConcentracao: string
  createEspecificacao: string
  createHomologado: boolean
  createMarca: string
  createOpen: boolean
  createPolicyTouched: boolean
  createPrecoCusto: string
  createProduto: string
  createTipoUnidade: string
  createVolume: string
  getPolicyForItem: (item?: Insumo | null) => { requiresLot: boolean; requiresExpiry: boolean; fefo: boolean }
  isAuthed: boolean
  lookupInsumosByCodigo: LookupByCodigoFn
  readCachedInsumosByCodigo: ReadCachedByCodigoFn
  unidade: string
  setCreateCalibre: React.Dispatch<React.SetStateAction<string>>
  setCreateCategoria: React.Dispatch<React.SetStateAction<string>>
  setCreateCategoriaFefo: React.Dispatch<React.SetStateAction<boolean>>
  setCreateCategoriaRequiresExpiry: React.Dispatch<React.SetStateAction<boolean>>
  setCreateCategoriaRequiresLot: React.Dispatch<React.SetStateAction<boolean>>
  setCreateConcentracao: React.Dispatch<React.SetStateAction<string>>
  setCreateEspecificacao: React.Dispatch<React.SetStateAction<string>>
  setCreateHomologado: React.Dispatch<React.SetStateAction<boolean>>
  setCreateLookupError: React.Dispatch<React.SetStateAction<string | null>>
  setCreateLookupItems: React.Dispatch<React.SetStateAction<Insumo[]>>
  setCreateLookupLoading: React.Dispatch<React.SetStateAction<boolean>>
  setCreateMarca: React.Dispatch<React.SetStateAction<string>>
  setCreatePrecoCusto: React.Dispatch<React.SetStateAction<string>>
  setCreateProduto: React.Dispatch<React.SetStateAction<string>>
  setCreateTipoUnidade: React.Dispatch<React.SetStateAction<string>>
  setCreateVolume: React.Dispatch<React.SetStateAction<string>>
}

export function useInsumosCreateLookupController({
  canUseApi,
  createCalibre,
  createCategoria,
  createCodigo,
  createConcentracao,
  createEspecificacao,
  createHomologado,
  createMarca,
  createOpen,
  createPolicyTouched,
  createPrecoCusto,
  createProduto,
  createTipoUnidade,
  createVolume,
  getPolicyForItem,
  isAuthed,
  lookupInsumosByCodigo,
  readCachedInsumosByCodigo,
  unidade,
  setCreateCalibre,
  setCreateCategoria,
  setCreateCategoriaFefo,
  setCreateCategoriaRequiresExpiry,
  setCreateCategoriaRequiresLot,
  setCreateConcentracao,
  setCreateEspecificacao,
  setCreateHomologado,
  setCreateLookupError,
  setCreateLookupItems,
  setCreateLookupLoading,
  setCreateMarca,
  setCreatePrecoCusto,
  setCreateProduto,
  setCreateTipoUnidade,
  setCreateVolume,
}: UseInsumosCreateLookupControllerArgs) {
  const createLookupTokenRef = React.useRef(0)

  const applyCreateLookupPrefill = React.useCallback((items: Insumo[]) => {
    const item = Array.isArray(items) && items.length ? items[0] : null
    if (!item) return
    if (!createProduto.trim() && item.produto) setCreateProduto(String(item.produto))
    if (!createCategoria.trim() && item.categoria) setCreateCategoria(String(item.categoria))
    if (!createMarca.trim() && item.marca) setCreateMarca(String(item.marca))
    if (!createEspecificacao.trim() && (item as any).especificacao) setCreateEspecificacao(String((item as any).especificacao))
    if (!createConcentracao.trim() && (item as any).concentracao) setCreateConcentracao(String((item as any).concentracao))
    if (!createVolume.trim() && (item as any).volume) setCreateVolume(String((item as any).volume))
    if (!createHomologado && /homologad/i.test(String((item as any).fonte || '').trim())) setCreateHomologado(true)
    if (!createCalibre.trim() && (item as any).calibre) setCreateCalibre(String((item as any).calibre))
    if (!createPrecoCusto.trim() && (item as any).precoCusto) setCreatePrecoCusto(String((item as any).precoCusto))
    if (!createTipoUnidade.trim() && item.tipoUnidade) {
      setCreateTipoUnidade(normalizeTipoUnidadeToCanonical(String(item.tipoUnidade)) || '')
    }
    if (!createPolicyTouched) {
      const policy = getPolicyForItem(item)
      setCreateCategoriaRequiresLot(!!policy.requiresLot)
      setCreateCategoriaRequiresExpiry(!!policy.requiresExpiry)
      setCreateCategoriaFefo(!!policy.fefo)
    }
  }, [
    createCalibre,
    createCategoria,
    createConcentracao,
    createEspecificacao,
    createHomologado,
    createMarca,
    createPolicyTouched,
    createPrecoCusto,
    createProduto,
    createTipoUnidade,
    createVolume,
    getPolicyForItem,
    setCreateCalibre,
    setCreateCategoria,
    setCreateCategoriaFefo,
    setCreateCategoriaRequiresExpiry,
    setCreateCategoriaRequiresLot,
    setCreateConcentracao,
    setCreateEspecificacao,
    setCreateHomologado,
    setCreateMarca,
    setCreatePrecoCusto,
    setCreateProduto,
    setCreateTipoUnidade,
    setCreateVolume,
  ])

  React.useEffect(() => {
    if (!createOpen) return
    if (!canUseApi || !isAuthed) return
    const codigo = createCodigo.trim()
    if (!codigo) {
      setCreateLookupLoading(false)
      setCreateLookupError(null)
      setCreateLookupItems([])
      return
    }
    const cached = readCachedInsumosByCodigo({ codigoBarras: codigo, ctxUnidade: unidade })
    if (cached.length) {
      setCreateLookupLoading(false)
      setCreateLookupError(null)
      setCreateLookupItems(cached)
      applyCreateLookupPrefill(cached)
      return
    }
    const token = ++createLookupTokenRef.current
    setCreateLookupLoading(true)
    setCreateLookupError(null)
    const timer = window.setTimeout(() => {
      void (async () => {
        try {
          const items = await lookupInsumosByCodigo({ codigoBarras: codigo, ctxUnidade: unidade })
          if (token !== createLookupTokenRef.current) return
          setCreateLookupItems(items)
          if (!items.length) setCreateLookupError('Nenhum insumo encontrado para este código.')
          applyCreateLookupPrefill(items)
        } catch (error: any) {
          if (token !== createLookupTokenRef.current) return
          setCreateLookupError(error?.message || 'Falha ao buscar o insumo.')
          setCreateLookupItems([])
        } finally {
          if (token === createLookupTokenRef.current) setCreateLookupLoading(false)
        }
      })()
    }, 250)
    return () => window.clearTimeout(timer)
  }, [
    applyCreateLookupPrefill,
    canUseApi,
    createCodigo,
    createOpen,
    isAuthed,
    lookupInsumosByCodigo,
    readCachedInsumosByCodigo,
    setCreateLookupError,
    setCreateLookupItems,
    setCreateLookupLoading,
    unidade,
  ])
}
