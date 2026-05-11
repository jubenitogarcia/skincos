import React from 'react'
import { toast } from 'sonner'

import { getInsumoBarcodes } from '@/insumosShared'
import type { Insumo, InsumosQuickOperation, QuickCandidate } from '@/insumosTypes'

type ApiJsonFn = <T>(path: string, init?: { method?: string; body?: unknown }) => Promise<T>

type LookupByCodigoFn = (args: { codigoBarras: string; ctxUnidade: string }) => Promise<Insumo[]>
type ReadCachedByCodigoFn = (args: { codigoBarras: string; ctxUnidade: string }) => Insumo[]
type UpsertInsumosCacheFn = (items: Insumo[]) => void
type NormalizeTextFn = (value: unknown) => string
type IsSameInsumoFn = (item: Insumo, target: Insumo | null) => boolean

type QuickSearchMatch = {
  item: Insumo
  matchedCode: string
  score: number
}

type UseInsumosQuickLookupControllerArgs = {
  apiJson: ApiJsonFn
  canUseApi: boolean
  insumos: Insumo[]
  isAuthed: boolean
  isSameInsumo: IsSameInsumoFn
  lookupInsumosByCodigo: LookupByCodigoFn
  normalizeText: NormalizeTextFn
  quickCandidates: QuickCandidate[]
  quickCodigo: string
  quickLookupCode: string | null
  quickLookupCtxUnidade: string | null
  quickLookupItems: Insumo[]
  quickLotes: QuickCandidate[]
  quickOp: InsumosQuickOperation | null
  quickRegistros: string[]
  quickSearch: string
  quickSearchRemote: Insumo[]
  quickSearchRemoteError: string | null
  quickSearchRemoteLoading: boolean
  quickSelectedSnapshot: Insumo | null
  readCachedInsumosByCodigo: ReadCachedByCodigoFn
  transferFrom: string
  unidade: string
  upsertInsumosCache: UpsertInsumosCacheFn
  setQuickCandidates: React.Dispatch<React.SetStateAction<QuickCandidate[]>>
  setQuickCodigo: React.Dispatch<React.SetStateAction<string>>
  setQuickLookupCode: React.Dispatch<React.SetStateAction<string | null>>
  setQuickLookupCtxUnidade: React.Dispatch<React.SetStateAction<string | null>>
  setQuickLookupError: React.Dispatch<React.SetStateAction<string | null>>
  setQuickLookupItems: React.Dispatch<React.SetStateAction<Insumo[]>>
  setQuickLookupLoading: React.Dispatch<React.SetStateAction<boolean>>
  setQuickRegistros: React.Dispatch<React.SetStateAction<string[]>>
  setQuickRegistro: React.Dispatch<React.SetStateAction<string>>
  setQuickSearch: React.Dispatch<React.SetStateAction<string>>
  setQuickSearchRemote: React.Dispatch<React.SetStateAction<Insumo[]>>
  setQuickSearchRemoteError: React.Dispatch<React.SetStateAction<string | null>>
  setQuickSearchRemoteLoading: React.Dispatch<React.SetStateAction<boolean>>
  setQuickSelectedSnapshot: React.Dispatch<React.SetStateAction<Insumo | null>>
}

export function useInsumosQuickLookupController({
  apiJson,
  canUseApi,
  insumos,
  isAuthed,
  isSameInsumo,
  lookupInsumosByCodigo,
  normalizeText,
  quickCandidates,
  quickCodigo,
  quickLookupCode,
  quickLookupCtxUnidade,
  quickLookupItems,
  quickLotes,
  quickOp,
  quickRegistros,
  quickSearch,
  quickSearchRemote,
  quickSearchRemoteError,
  quickSearchRemoteLoading,
  quickSelectedSnapshot,
  readCachedInsumosByCodigo,
  transferFrom,
  unidade,
  upsertInsumosCache,
  setQuickCandidates,
  setQuickCodigo,
  setQuickLookupCode,
  setQuickLookupCtxUnidade,
  setQuickLookupError,
  setQuickLookupItems,
  setQuickLookupLoading,
  setQuickRegistros,
  setQuickRegistro,
  setQuickSearch,
  setQuickSearchRemote,
  setQuickSearchRemoteError,
  setQuickSearchRemoteLoading,
  setQuickSelectedSnapshot,
}: UseInsumosQuickLookupControllerArgs) {
  const quickLookupTokenRef = React.useRef(0)
  const quickSearchRemoteTokenRef = React.useRef(0)

  const quickSearchMatches = React.useMemo(() => {
    const query = quickSearch.trim().toLowerCase()
    if (!query) return [] as QuickSearchMatch[]
    const looksLikeCode = /^[0-9]{4,}$/.test(query)
    const remoteActive = canUseApi && isAuthed && !looksLikeCode && query.length >= 2
    const baseList = remoteActive
      ? (quickSearchRemoteError ? (Array.isArray(insumos) ? insumos : []) : quickSearchRemote)
      : (Array.isArray(insumos) ? insumos : [])
    const selected: Insumo[] = []
    if (Array.isArray(quickLookupItems) && quickLookupItems.length) selected.push(...quickLookupItems)
    else if (quickSelectedSnapshot) selected.push(quickSelectedSnapshot)
    const primarySelected = quickSelectedSnapshot || (quickLookupItems.length ? quickLookupItems[0] : null)
    const allowSelectedWhileLoading = !!(quickSearchRemoteLoading && primarySelected)
    const selectedSignatures = selected.map((selectedItem) => ({
      registro: normalizeText(selectedItem?.registro || ''),
      codes: getInsumoBarcodes(selectedItem).map((code) => normalizeText(code)),
      produto: normalizeText(selectedItem?.produto || ''),
      categoria: normalizeText(selectedItem?.categoria || ''),
      marca: normalizeText(selectedItem?.marca || ''),
    }))
    const isSelected = (item: Insumo) => {
      const registro = normalizeText(item?.registro || '')
      if (registro && selectedSignatures.some((signature) => signature.registro && signature.registro === registro)) return true
      const codes = getInsumoBarcodes(item).map((code) => normalizeText(code))
      const produto = normalizeText(item?.produto || '')
      const categoria = normalizeText(item?.categoria || '')
      const marca = normalizeText(item?.marca || '')
      return selectedSignatures.some((signature) => {
        const sameCore =
          (!!produto || !!categoria || !!marca) &&
          produto === signature.produto &&
          categoria === signature.categoria &&
          marca === signature.marca
        if (!sameCore) return false
        if (!codes.length || !signature.codes.length) return true
        return signature.codes.some((code) => codes.includes(code))
      })
    }
    const scoreMatch = (item: Insumo, matchedCode: string) => {
      let score = 0
      const produto = normalizeText(item?.produto || '')
      const categoria = normalizeText(item?.categoria || '')
      const marca = normalizeText(item?.marca || '')
      const extras = [
        normalizeText((item as any)?.especificacao || ''),
        normalizeText((item as any)?.concentracao || ''),
        normalizeText((item as any)?.volume || ''),
        normalizeText((item as any)?.calibre || ''),
        normalizeText((item as any)?.tipoUnidade || ''),
      ]
      const codes = getInsumoBarcodes(item).map((code) => normalizeText(code))
      const normalizedQuery = normalizeText(query)
      if (matchedCode) score += 20
      if (codes.includes(normalizedQuery)) score += 80
      if (produto === normalizedQuery) score += 70
      else if (produto.startsWith(normalizedQuery)) score += 40
      else if (produto.includes(normalizedQuery)) score += 25
      if (marca === normalizedQuery) score += 30
      else if (marca.includes(normalizedQuery)) score += 12
      if (categoria === normalizedQuery) score += 25
      else if (categoria.includes(normalizedQuery)) score += 10
      if (extras.some((extra) => extra && extra === normalizedQuery)) score += 15
      else if (extras.some((extra) => extra && extra.includes(normalizedQuery))) score += 8
      return score
    }

    const scored: QuickSearchMatch[] = []
    for (const item of baseList) {
      if (isSelected(item) && !(allowSelectedWhileLoading && isSameInsumo(item, primarySelected))) continue
      const codes = getInsumoBarcodes(item)
      const produto = String(item?.produto || '').toLowerCase()
      const categoria = String(item?.categoria || '').toLowerCase()
      const marca = String(item?.marca || '').toLowerCase()
      const extras = [
        String((item as any)?.especificacao || '').toLowerCase(),
        String((item as any)?.concentracao || '').toLowerCase(),
        String((item as any)?.volume || '').toLowerCase(),
        String((item as any)?.calibre || '').toLowerCase(),
        String((item as any)?.tipoUnidade || '').toLowerCase(),
      ]
      const haystack = [produto, categoria, marca, ...extras, ...codes].filter(Boolean).join(' ')
      if (!haystack.includes(query)) continue
      const matchedCode = codes.find((code) => String(code || '').toLowerCase().includes(query)) || codes[0] || ''
      scored.push({ item, matchedCode, score: scoreMatch(item, matchedCode) })
    }

    return scored
      .sort((a, b) => {
        if (b.score !== a.score) return b.score - a.score
        return String(a.item?.produto || '').localeCompare(String(b.item?.produto || ''), 'pt-BR', { sensitivity: 'base' })
      })
      .slice(0, 8)
  }, [
    canUseApi,
    insumos,
    isAuthed,
    isSameInsumo,
    normalizeText,
    quickLookupItems,
    quickSearch,
    quickSearchRemote,
    quickSearchRemoteError,
    quickSearchRemoteLoading,
    quickSelectedSnapshot,
  ])

  const hasQuickSelection = !!quickSelectedSnapshot || quickLookupItems.length > 0

  const selectQuickCodigo = React.useCallback(
    (code: string, opts?: { setSearch?: boolean; snapshot?: Insumo | null }) => {
      const value = String(code || '').trim()
      if (!value) return false
      setQuickCodigo(value)
      if (opts?.setSearch) setQuickSearch(value)
      if (opts && Object.prototype.hasOwnProperty.call(opts, 'snapshot')) {
        setQuickSelectedSnapshot(opts?.snapshot ?? null)
      }
      setQuickLookupError(null)
      return true
    },
    [setQuickCodigo, setQuickLookupError, setQuickSearch, setQuickSelectedSnapshot],
  )

  const clearQuickSelection = React.useCallback(() => {
    setQuickCodigo('')
    setQuickSelectedSnapshot(null)
    setQuickRegistro('')
    setQuickRegistros([])
    setQuickCandidates([])
    setQuickLookupError(null)
    setQuickLookupCtxUnidade(null)
    setQuickLookupCode(null)
    setQuickLookupItems([])
  }, [
    setQuickCandidates,
    setQuickCodigo,
    setQuickLookupCode,
    setQuickLookupCtxUnidade,
    setQuickLookupError,
    setQuickLookupItems,
    setQuickRegistro,
    setQuickRegistros,
    setQuickSelectedSnapshot,
  ])

  const applyQuickSelection = React.useCallback(
    (item: Insumo, preferredCode?: string) => {
      const codes = getInsumoBarcodes(item)
      if (!codes.length) {
        const message = 'Este item não possui código de barras cadastrado.'
        setQuickLookupError(message)
        toast.error(message)
        return
      }
      const code = preferredCode && codes.includes(preferredCode) ? preferredCode : codes[0] || ''
      if (!code) return
      selectQuickCodigo(code, { setSearch: false, snapshot: item })
    },
    [selectQuickCodigo, setQuickLookupError],
  )

  React.useEffect(() => {
    if (!quickLookupItems.length) return
    setQuickSelectedSnapshot(quickLookupItems[0])
  }, [quickLookupItems, setQuickSelectedSnapshot])

  React.useEffect(() => {
    if (!quickOp) return
    if (!canUseApi || !isAuthed) {
      setQuickSearchRemote([])
      setQuickSearchRemoteLoading(false)
      setQuickSearchRemoteError(null)
      return
    }
    const query = quickSearch.trim()
    const looksLikeCode = /^[0-9]{4,}$/.test(query)
    if (!query || looksLikeCode || query.length < 2) {
      setQuickSearchRemote([])
      setQuickSearchRemoteLoading(false)
      setQuickSearchRemoteError(null)
      return
    }
    const ctxUnidade = quickOp === 'TRANSFERENCIA' ? transferFrom : unidade
    const token = ++quickSearchRemoteTokenRef.current
    setQuickSearchRemoteLoading(true)
    setQuickSearchRemoteError(null)
    const timer = window.setTimeout(() => {
      void (async () => {
        try {
          const params = new URLSearchParams({
            unidade: ctxUnidade,
            q: query,
            pagina: '1',
            limite: '30',
          })
          const out = await apiJson<{ success?: boolean; data?: Insumo[] }>(`/insumos?${params.toString()}`)
          if (token !== quickSearchRemoteTokenRef.current) return
          const items = Array.isArray(out?.data) ? out.data : []
          if (items.length) upsertInsumosCache(items)
          setQuickSearchRemote(items)
        } catch (error: any) {
          if (token !== quickSearchRemoteTokenRef.current) return
          setQuickSearchRemoteError(error?.message || 'Falha ao buscar insumos.')
          setQuickSearchRemote([])
          console.warn('[insumos][quick-search]', {
            unit: ctxUnidade,
            query,
            status: error?.status || 0,
            code: error?.code || null,
          })
        } finally {
          if (token === quickSearchRemoteTokenRef.current) setQuickSearchRemoteLoading(false)
        }
      })()
    }, 250)
    return () => window.clearTimeout(timer)
  }, [
    apiJson,
    canUseApi,
    isAuthed,
    quickOp,
    quickSearch,
    setQuickSearchRemote,
    setQuickSearchRemoteError,
    setQuickSearchRemoteLoading,
    transferFrom,
    unidade,
    upsertInsumosCache,
  ])

  React.useEffect(() => {
    const query = quickSearch.trim()
    const hasSelection = !!quickSelectedSnapshot || quickLookupItems.length > 0
    if (!query) {
      if (!hasSelection && quickCodigo) setQuickCodigo('')
      return
    }
    if (query === quickCodigo) return
    const looksLikeCode = /^[0-9]{4,}$/.test(query)
    if (looksLikeCode) {
      if (query !== quickCodigo) {
        setQuickSelectedSnapshot(null)
        setQuickCodigo(query)
      }
      return
    }
    if (!hasSelection && quickCodigo) setQuickCodigo('')
  }, [quickSearch, quickCodigo, quickLookupItems.length, quickSelectedSnapshot, setQuickCodigo, setQuickSelectedSnapshot])

  React.useEffect(() => {
    if (quickCodigo) return
    const selected = quickLookupItems[0] || quickSelectedSnapshot
    if (!selected) return
    const codes = getInsumoBarcodes(selected)
    if (!codes.length) return
    setQuickCodigo(codes[0])
  }, [quickCodigo, quickLookupItems, quickSelectedSnapshot, setQuickCodigo])

  const quickLoteNeedsPick = quickCandidates.length > 1 || quickRegistros.length > 1 || quickLotes.length > 1
  const quickLotesForPicker = React.useMemo(() => {
    if (quickCandidates.length) return quickCandidates
    if (quickRegistros.length) {
      const registrosSet = new Set(quickRegistros)
      const filtered = quickLotes.filter((lote) => registrosSet.has(lote.registro))
      if (filtered.length) return filtered
      return quickRegistros.map((registro) => ({ registro, lote: '', dataValidade: null, estoque: 0 }))
    }
    return quickLotes
  }, [quickCandidates, quickLotes, quickRegistros])

  React.useEffect(() => {
    if (!quickOp) return
    if (!canUseApi || !isAuthed) return
    const codigo = quickCodigo.trim()
    if (!codigo) {
      setQuickLookupLoading(false)
      setQuickLookupError(null)
      setQuickLookupItems([])
      setQuickLookupCode(null)
      setQuickLookupCtxUnidade(null)
      return
    }
    const ctxUnidade = quickOp === 'TRANSFERENCIA' ? transferFrom : unidade
    const cached = readCachedInsumosByCodigo({ codigoBarras: codigo, ctxUnidade })
    if (cached.length) {
      setQuickLookupLoading(false)
      setQuickLookupError(null)
      setQuickLookupItems(cached)
      setQuickLookupCode(codigo)
      setQuickLookupCtxUnidade(ctxUnidade)
      return
    }
    const token = ++quickLookupTokenRef.current
    setQuickLookupLoading(true)
    setQuickLookupError(null)
    const timer = window.setTimeout(() => {
      void (async () => {
        try {
          const items = await lookupInsumosByCodigo({ codigoBarras: codigo, ctxUnidade })
          if (token !== quickLookupTokenRef.current) return
          setQuickLookupItems(items)
          setQuickLookupCode(codigo)
          setQuickLookupCtxUnidade(ctxUnidade)
          if (!items.length) setQuickLookupError('Nenhum insumo encontrado para este código.')
        } catch (error: any) {
          if (token !== quickLookupTokenRef.current) return
          setQuickLookupError(error?.message || 'Falha ao buscar o insumo.')
          setQuickLookupItems([])
          setQuickLookupCode(codigo)
          setQuickLookupCtxUnidade(ctxUnidade)
          console.warn('[insumos][quick-lookup]', {
            unit: ctxUnidade,
            codigo,
            status: error?.status || 0,
            code: error?.code || null,
          })
        } finally {
          if (token === quickLookupTokenRef.current) setQuickLookupLoading(false)
        }
      })()
    }, 250)

    return () => window.clearTimeout(timer)
  }, [
    canUseApi,
    isAuthed,
    lookupInsumosByCodigo,
    quickCodigo,
    quickOp,
    readCachedInsumosByCodigo,
    setQuickLookupCode,
    setQuickLookupCtxUnidade,
    setQuickLookupError,
    setQuickLookupItems,
    setQuickLookupLoading,
    transferFrom,
    unidade,
  ])

  return {
    applyQuickSelection,
    clearQuickSelection,
    hasQuickSelection,
    quickLoteNeedsPick,
    quickLotesForPicker,
    quickSearchMatches,
    selectQuickCodigo,
  }
}
