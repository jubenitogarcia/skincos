import type { Insumo, Movimentacao } from './insumosTypes'

export type MovementSortKey = 'dataHora' | 'produto' | 'categoria' | 'marca' | 'estoque' | 'valor' | 'usuario' | 'observacao'
export type MovementSortDir = 'asc' | 'desc'
export type MovementTipoFilter = 'TODOS' | 'ENTRADA' | 'SAÍDA' | 'AJUSTE'

export type MovementRowView = {
  key: string
  movement: Movimentacao
  rowClass: string
  productName: string
  categoryName: string
  brandName: string
  dateLabel: string
  timeLabel: string
  stockLabel: string
  movementValueLabel: string
  stockValueLabel: string
  userLabel: string
  notePrimary: string
  noteSecondary?: string | null
  noteMeta?: string | null
  productPressed: boolean
  categoryPressed: boolean
  brandPressed: boolean
  canEdit: boolean
}

type BuildMovimentacoesViewArgs = {
  movGroupTransfers: boolean
  movSortDir: MovementSortDir
  movSortKey: MovementSortKey
  movTipo: MovementTipoFilter
  movFilterCategoria: string
  movFilterMarca: string
  movSearch: string
  movimentacoes: Movimentacao[]
  pickInsumoForMov: (movement: Movimentacao) => Insumo | null | undefined
  selectedCodigoBarras: string
  normalizeText: (value: string) => string
}

export function buildMovimentacoesView({
  movGroupTransfers,
  movSortDir,
  movSortKey,
  movTipo,
  movFilterCategoria,
  movFilterMarca,
  movSearch,
  movimentacoes,
  pickInsumoForMov,
  selectedCodigoBarras,
  normalizeText,
}: BuildMovimentacoesViewArgs): Movimentacao[] {
  const list = Array.isArray(movimentacoes) ? movimentacoes : []
  const selectedCode = selectedCodigoBarras.trim()
  const filterCategoria = normalizeText(movFilterCategoria)
  const filterMarca = normalizeText(movFilterMarca)
  const filterSearch = normalizeText(movSearch)

  const applyFiltersAndSort = (base: Movimentacao[]) => {
    const filtered = base.filter((movement) => {
      if (selectedCode) {
        if (String(movement?.codigoBarras || '').trim() !== selectedCode) return false
      } else if (filterSearch) {
        const insumo = pickInsumoForMov(movement)
        const productName = normalizeText(String(insumo?.produto || movement?.produto || '').trim())
        const categoryName = normalizeText(insumo?.categoria || '')
        const brandName = normalizeText(insumo?.marca || movement?.marca || '')
        const barcode = normalizeText(String(movement?.codigoBarras || insumo?.codigoBarras || '').trim())
        if (
          !(
            (productName && productName.includes(filterSearch)) ||
            (categoryName && categoryName.includes(filterSearch)) ||
            (brandName && brandName.includes(filterSearch)) ||
            (barcode && barcode.includes(filterSearch))
          )
        ) {
          return false
        }
      }

      if (filterCategoria) {
        const insumo = pickInsumoForMov(movement)
        const categoryName = normalizeText(insumo?.categoria || '')
        if (!categoryName || categoryName !== filterCategoria) return false
      }

      if (filterMarca) {
        const insumo = pickInsumoForMov(movement)
        const brandName = normalizeText(insumo?.marca || '')
        if (!brandName || brandName !== filterMarca) return false
      }

      return true
    })

    const dir = movSortDir === 'asc' ? 1 : -1
    const getSortValue = (movement: Movimentacao) => {
      if (movSortKey === 'dataHora') return new Date(movement?.dataHora || 0).getTime() || 0
      if (movSortKey === 'usuario') return String(movement?.usuario || '').trim().toLowerCase()
      if (movSortKey === 'observacao') {
        const value = movement?.transferId
          ? `transferencia ${String(movement?.unidadeOrigem || '')}->${String(movement?.unidadeDestino || '')}`
          : String(movement?.motivo || movement?.observacoes || '').trim()
        return value.toLowerCase()
      }

      const insumo = pickInsumoForMov(movement)
      if (movSortKey === 'produto') return String(insumo?.produto || movement?.produto || '').trim().toLowerCase()
      if (movSortKey === 'categoria') return String(insumo?.categoria || '').trim().toLowerCase()
      if (movSortKey === 'marca') return String(insumo?.marca || '').trim().toLowerCase()
      if (movSortKey === 'estoque') return Number(movement?.estoqueNovo ?? movement?.estoqueAnterior ?? 0) || 0
      if (movSortKey === 'valor') {
        const price = Number(movement?.preco) || Number(insumo?.precoCusto) || 0
        const quantity = Number(movement?.quantidade) || 0
        return price * quantity
      }
      return 0
    }

    filtered.sort((left, right) => {
      const leftValue = getSortValue(left) as any
      const rightValue = getSortValue(right) as any
      if (typeof leftValue === 'number' && typeof rightValue === 'number') {
        if (leftValue !== rightValue) return (leftValue - rightValue) * dir
        return (new Date(left?.dataHora || 0).getTime() - new Date(right?.dataHora || 0).getTime()) * dir
      }
      const compare = String(leftValue).localeCompare(String(rightValue), 'pt-BR', { sensitivity: 'base' })
      if (compare !== 0) return compare * dir
      return (new Date(left?.dataHora || 0).getTime() - new Date(right?.dataHora || 0).getTime()) * dir
    })

    return filtered
  }

  if (!movGroupTransfers || movTipo !== 'TODOS') return applyFiltersAndSort(list)

  const byTransfer = new Map<string, Movimentacao[]>()
  for (const movement of list) {
    const transferId = String((movement as any)?.transferId || '').trim()
    if (!transferId) continue
    const grouped = byTransfer.get(transferId) || []
    grouped.push(movement)
    byTransfer.set(transferId, grouped)
  }

  const seen = new Set<string>()
  const merged: Movimentacao[] = []
  for (const movement of list) {
    const transferId = String((movement as any)?.transferId || '').trim()
    if (!transferId) {
      merged.push(movement)
      continue
    }
    if (seen.has(transferId)) continue
    seen.add(transferId)

    const group = byTransfer.get(transferId) || [movement]
    if (group.length < 2) {
      merged.push(movement)
      continue
    }

    const picked = group.reduce((best, current) => {
      const bestTs = new Date(best?.dataHora || 0).getTime()
      const currentTs = new Date(current?.dataHora || 0).getTime()
      return currentTs > bestTs ? current : best
    }, group[0])

    const quantity = group.reduce((acc, current) => Math.max(acc, Number(current?.quantidade) || 0), 0)
    const fromUnit = String((picked as any)?.unidadeOrigem || '').trim()
    const toUnit = String((picked as any)?.unidadeDestino || '').trim()

    merged.push({
      ...picked,
      tipo: 'TRANSFERÊNCIA',
      quantidade: quantity,
      unidadeOrigem: fromUnit,
      unidadeDestino: toUnit,
      transferId,
    } as any)
  }

  return applyFiltersAndSort(merged)
}

type BuildMovementRowsArgs = {
  movimentacoesView: Movimentacao[]
  pickInsumoForMov: (movement: Movimentacao) => Insumo | null | undefined
  selectedCodigoBarras: string
  movFilterCategoria: string
  movFilterMarca: string
  movSearch: string
  unidade: string
  isAuthed: boolean
  unidadeLabel: (unit: string) => string
  normalizeText: (value: string) => string
  fmtMovDateShort: (value?: string | null) => string
  fmtMovTimeShort: (value?: string | null) => string
  fmtDateOnlyBR: (value?: string | null) => string
  fmtMoneyBRL: (value: number) => string
  fmtMoneyBRL0: (value: number) => string
}

export function buildMovementRows({
  movimentacoesView,
  pickInsumoForMov,
  selectedCodigoBarras,
  movFilterCategoria,
  movFilterMarca,
  movSearch,
  unidade,
  isAuthed,
  unidadeLabel,
  normalizeText,
  fmtMovDateShort,
  fmtMovTimeShort,
  fmtDateOnlyBR,
  fmtMoneyBRL,
  fmtMoneyBRL0,
}: BuildMovementRowsArgs): MovementRowView[] {
  return movimentacoesView.map((movement, idx) => {
    const codigoBarras = String(movement.codigoBarras || '').trim()
    const insumo = pickInsumoForMov(movement)
    const ctxUnit = String(movement.unidade || unidade || '').trim()
    const estoqueAtual = insumo
      ? ctxUnit && insumo?.estoques
        ? Number(insumo.estoques?.[ctxUnit] ?? 0)
        : Number(insumo.estoqueAtual ?? 0)
      : null
    const tipoNorm = String(movement.tipo || '').toUpperCase().replace('Í', 'I')
    const isEntrada = tipoNorm.includes('ENTRADA')
    const isSaida = tipoNorm.includes('SAIDA')
    const preco = Number(movement.preco) || Number(insumo?.precoCusto) || 0
    const quantidade = Number(movement.quantidade) || 0
    const valorMov = preco * quantidade
    const estoqueDepois = Number.isFinite(Number(movement.estoqueNovo)) ? Number(movement.estoqueNovo) : estoqueAtual != null ? estoqueAtual : null
    const estoqueAntes = Number.isFinite(Number(movement.estoqueAnterior))
      ? Number(movement.estoqueAnterior)
      : Number.isFinite(Number(estoqueDepois)) && Number.isFinite(quantidade) && (isEntrada || isSaida)
        ? isEntrada
          ? Number(estoqueDepois) - quantidade
          : Number(estoqueDepois) + quantidade
        : null
    const valorEstoqueTotal =
      preco && estoqueDepois != null && Number.isFinite(Number(estoqueDepois)) ? preco * Number(estoqueDepois) : null
    const productName = String(insumo?.produto || movement.produto || '').trim() || '-'
    const categoryName = String(insumo?.categoria || '').trim() || '-'
    const brandName = String(insumo?.marca || movement.marca || '').trim() || '-'
    const isSelected = !!codigoBarras && selectedCodigoBarras.trim() === codigoBarras
    const rowTone = isEntrada
      ? 'bg-emerald-400/10 hover:bg-emerald-400/15'
      : isSaida
        ? 'bg-rose-400/10 hover:bg-rose-400/15'
        : 'hover:bg-white/5'
    const metaParts: string[] = []
    if (movement.registroInsumo) metaParts.push(`Reg ${movement.registroInsumo}`)
    if (movement.lote) metaParts.push(`Lote ${movement.lote}`)
    if (movement.dataValidade) metaParts.push(`Val ${fmtDateOnlyBR(movement.dataValidade)}`)

    return {
      key: `${movement.dataHora || ''}-${idx}`,
      movement,
      rowClass: `${rowTone} ${isSelected ? 'ring-1 ring-white/10' : ''}`,
      productName,
      categoryName,
      brandName,
      dateLabel: fmtMovDateShort(movement.dataHora) || '-',
      timeLabel: fmtMovTimeShort(movement.dataHora) || '',
      stockLabel:
        estoqueAntes != null && estoqueDepois != null && Number.isFinite(estoqueAntes) && Number.isFinite(estoqueDepois)
          ? `${estoqueAntes} → ${estoqueDepois}`
          : '-',
      movementValueLabel: preco ? fmtMoneyBRL(valorMov) : '-',
      stockValueLabel: valorEstoqueTotal != null ? fmtMoneyBRL0(valorEstoqueTotal) : '',
      userLabel: movement.usuario || '-',
      notePrimary: movement.transferId
        ? `Transferência ${movement.unidadeOrigem ? unidadeLabel(movement.unidadeOrigem) : '-'} → ${movement.unidadeDestino ? unidadeLabel(movement.unidadeDestino) : '-'}`
        : movement.motivo
          ? `Motivo: ${movement.motivo}`
          : movement.observacoes || '-',
      noteSecondary: movement.transferId ? String(movement.transferId) : null,
      noteMeta: metaParts.length ? metaParts.join(' • ') : null,
      productPressed: normalizeText(movSearch) === normalizeText(productName),
      categoryPressed: normalizeText(movFilterCategoria) === normalizeText(categoryName),
      brandPressed: normalizeText(movFilterMarca) === normalizeText(brandName),
      canEdit: !!isAuthed && !!String(movement.id || '').trim(),
    }
  })
}
