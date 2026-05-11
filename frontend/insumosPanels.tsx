import React from 'react'
import { AutocompleteInput } from '@/autocomplete-input'
import { Badge } from '@/badge'
import { BrDatePickerInput } from '@/br-date-picker'
import { Button } from '@/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/card'
import { Checkbox } from '@/checkbox'
import { Input } from '@/input'
import { InsumosBarcodeScannerInline } from '@/InsumosBarcodeScannerInline'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/dialog'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/select'
import { Textarea } from '@/textarea'
import {
  alertaTagLabel,
  alertaTagVariant,
  buildTagStyle,
  calcularStatusEstoque,
  fmtDateOnlyBR,
  fmtDate,
  fmtMoneyBRL,
  formatInsumoDescriptor,
  getCategoriaBgColor,
  getInsumoBarcodes,
  getMarcaBgColor,
  normalizeMovimentacaoTipo,
  normalizeTipoUnidadeToCanonical,
  severityBadgeVariant,
  severityLabel,
} from '@/insumosShared'
import type { MovementRowView } from '@/insumosDerivations'
import type { AlertaStatusTag } from '@/insumosShared'
import type {
  Actionables,
  CategoryPolicy,
  CategoryPolicySuggestion,
  Insumo,
  InsumosQuickOperation,
  Movimentacao,
  OfflineQueueItem,
  QuickActionFeedback,
  QuickCandidate,
  QualityIssue,
  ShareHistoryItem,
  SharePayload,
} from '@/insumosTypes'

type InsumosAutoSyncBannerProps = {
  autoSyncRemainingSeconds: number
  onRefreshNow: () => void
  onResume: () => void
}

export function InsumosAutoSyncBanner({
  autoSyncRemainingSeconds,
  onRefreshNow,
  onResume,
}: InsumosAutoSyncBannerProps) {
  return (
    <div className="flex flex-wrap items-center gap-3 rounded-xl border border-amber-400/40 bg-amber-500/10 p-3 text-amber-100">
      <div className="text-sm">
        API instável detectada. Sincronização automática de Overview/Insights pausada por {autoSyncRemainingSeconds}s.
      </div>
      <div className="ml-auto flex items-center gap-2">
        <Button
          variant="outline"
          className="border-amber-300/50 text-amber-100 hover:bg-amber-500/20"
          onClick={onResume}
        >
          Retomar auto-sync
        </Button>
        <Button className="!bg-amber-600 hover:!bg-amber-700 !text-white" onClick={onRefreshNow}>
          Atualizar agora
        </Button>
      </div>
    </div>
  )
}

type InsumosSafeModeBannerProps = {
  visible: boolean
}

export function InsumosSafeModeBanner({ visible }: InsumosSafeModeBannerProps) {
  if (!visible) return null
  return (
    <div className="mx-auto mb-3 max-w-6xl rounded-xl border border-amber-400/40 bg-amber-500/10 px-4 py-3 text-sm text-amber-100">
      <div className="font-semibold">Modo local seguro ativo</div>
      <div className="text-amber-100/80">
        Mutações para o backend de produção estão bloqueadas. Para liberar, rode com
        <span className="font-mono"> LOCAL_ALLOW_UPSTREAM_MUTATIONS=1</span>.
      </div>
    </div>
  )
}

type InsumosPurchaseDialogProps = {
  actionables: Actionables | null
  dialogClassName: string
  isAuthed: boolean
  loading: boolean
  open: boolean
  onOpenChange: (open: boolean) => void
  onOpenQuickOperation: (op: InsumosQuickOperation, prefill?: { codigoBarras?: string; quantidade?: number; obs?: string }) => void
  onClose: () => void
  renderLoadingText: (loading: boolean, emptyLabel: string) => React.ReactNode
  unit: string
  unitLabel: (unit: string) => string
}

type InventoryLoadError = {
  message: string
  status?: number
  code?: string
}

type InsumosInventoryDialogProps = {
  open: boolean
  dialogClassName: string
  isAuthed: boolean
  unit: string
  unitLabel: (unit: string) => string
  query: string
  onQueryChange: (value: string) => void
  onOpenChange: (open: boolean) => void
  onExport: () => void
  createOpen: boolean
  onToggleCreate: () => void
  onCancelCreate: () => void
  createLookupLoading: boolean
  createLookupError: string | null
  createLookupCount: number
  createScanOpen: boolean
  onToggleCreateScan: () => void
  onCloseCreateScan: () => void
  onCreateBarcodeDetected: (code: string) => void
  createCodigo: string
  onCreateCodigoChange: (value: string) => void
  createCodigosExtras: string
  onCreateCodigosExtrasChange: (value: string) => void
  createProduto: string
  onCreateProdutoChange: (value: string) => void
  createCategoria: string
  onCreateCategoriaChange: (value: string) => void
  createMarca: string
  onCreateMarcaChange: (value: string) => void
  createTipoUnidade: string
  onCreateTipoUnidadeChange: (value: string) => void
  createPrecoCusto: string
  onCreatePrecoCustoChange: (value: string) => void
  createEstoqueMinimo: string
  onCreateEstoqueMinimoChange: (value: string) => void
  createEstoqueInicial: string
  onCreateEstoqueInicialChange: (value: string) => void
  createLote: string
  onCreateLoteChange: (value: string) => void
  createDataValidade: string
  onCreateDataValidadeChange: (value: string) => void
  createNovoLote: boolean
  onToggleCreateNovoLote: () => void
  createCategoriaRequiresLot: boolean
  onCreateCategoriaRequiresLotChange: (value: boolean) => void
  createCategoriaRequiresExpiry: boolean
  onCreateCategoriaRequiresExpiryChange: (value: boolean) => void
  createCategoriaFefo: boolean
  onCreateCategoriaFefoChange: (value: boolean) => void
  isManagerRole: boolean
  lotCategorias: string[]
  insumosMarcas: string[]
  insumosTiposUnidade: string[]
  createLoading: boolean
  onSaveCreate: () => void
  filteredInsumos: Insumo[]
  listContainerRef: React.RefObject<HTMLDivElement | null>
  onListScroll: (event: React.UIEvent<HTMLDivElement>) => void
  insumosLoading: boolean
  insumosLoadError: InventoryLoadError | null
  emptyContent: React.ReactNode
  onEditItem: (item: Insumo) => void
}

export function InsumosInventoryDialog({
  open,
  dialogClassName,
  isAuthed,
  unit,
  unitLabel,
  query,
  onQueryChange,
  onOpenChange,
  onExport,
  createOpen,
  onToggleCreate,
  onCancelCreate,
  createLookupLoading,
  createLookupError,
  createLookupCount,
  createScanOpen,
  onToggleCreateScan,
  onCloseCreateScan,
  onCreateBarcodeDetected,
  createCodigo,
  onCreateCodigoChange,
  createCodigosExtras,
  onCreateCodigosExtrasChange,
  createProduto,
  onCreateProdutoChange,
  createCategoria,
  onCreateCategoriaChange,
  createMarca,
  onCreateMarcaChange,
  createTipoUnidade,
  onCreateTipoUnidadeChange,
  createPrecoCusto,
  onCreatePrecoCustoChange,
  createEstoqueMinimo,
  onCreateEstoqueMinimoChange,
  createEstoqueInicial,
  onCreateEstoqueInicialChange,
  createLote,
  onCreateLoteChange,
  createDataValidade,
  onCreateDataValidadeChange,
  createNovoLote,
  onToggleCreateNovoLote,
  createCategoriaRequiresLot,
  onCreateCategoriaRequiresLotChange,
  createCategoriaRequiresExpiry,
  onCreateCategoriaRequiresExpiryChange,
  createCategoriaFefo,
  onCreateCategoriaFefoChange,
  isManagerRole,
  lotCategorias,
  insumosMarcas,
  insumosTiposUnidade,
  createLoading,
  onSaveCreate,
  filteredInsumos,
  listContainerRef,
  onListScroll,
  insumosLoading,
  insumosLoadError,
  emptyContent,
  onEditItem,
}: InsumosInventoryDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="wideTable" className={dialogClassName}>
        <DialogHeader className="space-y-2">
          <div className="flex min-w-0 w-full flex-nowrap items-center gap-2 overflow-x-auto">
            <DialogTitle className="text-white">Insumos</DialogTitle>
            <Input
              value={query}
              onChange={(e) => onQueryChange(e.target.value)}
              placeholder="Buscar por código, produto, categoria…"
              className="ml-auto h-8 min-w-[160px] flex-1 md:min-w-0"
            />
            <Button variant="outline" className="h-8 px-3" onClick={onExport} disabled={!isAuthed} title="Exportar CSV">
              Exportar
            </Button>
            <Button variant="outline" className="h-8 px-3" onClick={onToggleCreate} disabled={!isAuthed}>
              {createOpen ? 'Fechar' : 'Adicionar'}
            </Button>
          </div>
          <DialogDescription>Lista e cadastro de insumos da unidade selecionada.</DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          {createOpen ? (
            <div className="space-y-3 rounded-xl border border-white/10 bg-black/20 p-3">
              <div className="text-sm text-blue-100/70">Cadastro rápido (campos mínimos) + detalhes opcionais.</div>
              <div className="grid grid-cols-1 gap-2 md:grid-cols-3">
                <div>
                  <div className="mb-1 text-xs text-blue-200/70">Código de barras</div>
                  <div className="flex flex-wrap items-center gap-2">
                    <Input value={createCodigo} onChange={(e) => onCreateCodigoChange(e.target.value)} placeholder="789..." />
                    <Button variant="secondary" type="button" onClick={onToggleCreateScan}>
                      {createScanOpen ? 'Fechar' : 'Escanear'}
                    </Button>
                  </div>
                  <div className="mt-2">
                    {createLookupLoading ? (
                      <div className="text-xs text-blue-200/70">Buscando informações do insumo…</div>
                    ) : createLookupError ? (
                      <div className="text-xs text-red-200">{createLookupError}</div>
                    ) : createLookupCount ? (
                      <div className="text-xs text-blue-200/70">
                        Encontrado no histórico: <span className="font-mono">{createLookupCount}</span> variação(ões)
                      </div>
                    ) : null}
                  </div>
                  <div className="mt-2">
                    <div className="mb-1 text-xs text-blue-200/70">Códigos adicionais</div>
                    <Textarea
                      value={createCodigosExtras}
                      onChange={(e) => onCreateCodigosExtrasChange(e.target.value)}
                      placeholder="um por linha"
                      rows={3}
                      className="border-white/20 bg-white/[0.06] text-white"
                    />
                    <div className="mt-1 text-[10px] text-blue-200/50">Opcional. Use para variações de código do mesmo produto.</div>
                  </div>
                </div>
                <div className="md:col-span-2">
                  <div className="mb-1 text-xs text-blue-200/70">Produto</div>
                  <Input value={createProduto} onChange={(e) => onCreateProdutoChange(e.target.value)} placeholder="ex: Toxina botulínica" />
                </div>
                <div>
                  <div className="mb-1 text-xs text-blue-200/70">Categoria</div>
                  <Input
                    value={createCategoria}
                    onChange={(e) => onCreateCategoriaChange(e.target.value)}
                    placeholder="ex: toxina"
                    list="insumos-categorias"
                  />
                  <datalist id="insumos-categorias">
                    {lotCategorias.map((categoria) => (
                      <option key={categoria} value={categoria} />
                    ))}
                  </datalist>
                </div>
                <div className="md:col-span-2 rounded-xl border border-white/10 bg-black/10 p-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="text-xs text-blue-200/70">Política do item</div>
                    <div className="text-xs text-blue-200/60">Defina as regras para este insumo.</div>
                  </div>
                  <div className="mt-2 flex flex-wrap items-center gap-4 text-sm text-blue-100/80">
                    <label className={`flex select-none items-center gap-2 ${isManagerRole ? 'cursor-pointer' : 'cursor-default'}`}>
                      <Checkbox checked={createCategoriaRequiresLot} onCheckedChange={(value) => onCreateCategoriaRequiresLotChange(!!value)} disabled={!isManagerRole} />
                      Lote obrigatório
                    </label>
                    <label className={`flex select-none items-center gap-2 ${isManagerRole ? 'cursor-pointer' : 'cursor-default'}`}>
                      <Checkbox
                        checked={createCategoriaRequiresExpiry}
                        onCheckedChange={(value) => onCreateCategoriaRequiresExpiryChange(!!value)}
                        disabled={!isManagerRole}
                      />
                      Validade obrigatória
                    </label>
                    <label className={`flex select-none items-center gap-2 ${isManagerRole ? 'cursor-pointer' : 'cursor-default'}`}>
                      <Checkbox checked={createCategoriaFefo} onCheckedChange={(value) => onCreateCategoriaFefoChange(!!value)} disabled={!isManagerRole} />
                      FEFO
                    </label>
                    {!isManagerRole ? <span className="text-xs text-blue-200/60">Somente gestores alteram.</span> : null}
                  </div>
                </div>
                <div>
                  <div className="mb-1 text-xs text-blue-200/70">Marca</div>
                  <Input
                    value={createMarca}
                    onChange={(e) => onCreateMarcaChange(e.target.value)}
                    placeholder="ex: Allergan"
                    list="insumos-marcas"
                  />
                  <datalist id="insumos-marcas">
                    {insumosMarcas.map((marca) => (
                      <option key={marca} value={marca} />
                    ))}
                  </datalist>
                </div>
                <div>
                  <div className="mb-1 text-xs text-blue-200/70">Tipo (unidade)</div>
                  <Select value={createTipoUnidade || undefined} onValueChange={onCreateTipoUnidadeChange}>
                    <SelectTrigger>
                      <SelectValue placeholder="Selecione a unidade" />
                    </SelectTrigger>
                    <SelectContent>
                      {insumosTiposUnidade.map((tipo) => (
                        <SelectItem key={tipo} value={tipo}>
                          {tipo}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <div className="mb-1 text-xs text-blue-200/70">Preço (custo)</div>
                  <Input value={createPrecoCusto} onChange={(e) => onCreatePrecoCustoChange(e.target.value)} placeholder="ex: 1200" />
                </div>
                <div>
                  <div className="mb-1 text-xs text-blue-200/70">Estoque mínimo</div>
                  <Input value={createEstoqueMinimo} onChange={(e) => onCreateEstoqueMinimoChange(e.target.value)} placeholder="ex: 5" />
                </div>
                <div>
                  <div className="mb-1 text-xs text-blue-200/70">Estoque inicial</div>
                  <Input value={createEstoqueInicial} onChange={(e) => onCreateEstoqueInicialChange(e.target.value)} placeholder="ex: 0" />
                </div>
                <div>
                  <div className="mb-1 flex items-center justify-between gap-2">
                    <div className="text-xs text-blue-200/70">Lote</div>
                    <Button
                      variant={createNovoLote ? 'secondary' : 'outline'}
                      size="sm"
                      type="button"
                      onClick={onToggleCreateNovoLote}
                      title="Ative quando estiver cadastrando um lote adicional para um código já existente."
                    >
                      {createNovoLote ? 'Novo lote: on' : 'Novo lote: off'}
                    </Button>
                  </div>
                  <Input
                    value={createLote}
                    onChange={(e) => onCreateLoteChange(e.target.value)}
                    placeholder={createNovoLote ? 'obrigatório (ex: L2026-01)' : 'opcional'}
                  />
                </div>
                <div>
                  <div className="mb-1 text-xs text-blue-200/70">Validade</div>
                  <BrDatePickerInput value={createDataValidade} onChange={onCreateDataValidadeChange} placeholder="DD/MM/AA" ariaLabel="Validade" />
                </div>
              </div>

              {createScanOpen ? <InsumosBarcodeScannerInline onDetected={onCreateBarcodeDetected} onClose={onCloseCreateScan} /> : null}

              <div className="flex items-center justify-end gap-2">
                <Button variant="secondary" onClick={onCancelCreate}>
                  Cancelar
                </Button>
                <Button onClick={onSaveCreate} disabled={!isAuthed || createLoading}>
                  {createLoading ? 'Salvando…' : 'Salvar'}
                </Button>
              </div>
            </div>
          ) : null}

          <div ref={listContainerRef as React.RefObject<HTMLDivElement>} onScroll={onListScroll} className="max-h-[60vh] overflow-auto rounded-xl border border-white/10">
            <table className="w-full min-w-[880px] table-auto text-sm">
              <thead className="bg-black/30 text-blue-100/80">
                <tr>
                  <th className="w-[30%] p-3 text-left">Produto</th>
                  <th className="hidden w-[20%] p-3 text-left md:table-cell">Categoria</th>
                  <th className="hidden w-[18%] p-3 text-left lg:table-cell">Código</th>
                  <th className="w-[6rem] p-3 text-right whitespace-nowrap">Estoque</th>
                  <th className="hidden w-[5rem] p-3 text-right whitespace-nowrap sm:table-cell">Mín</th>
                  <th className="hidden w-[7rem] p-3 text-left whitespace-nowrap xl:table-cell">Validade</th>
                  <th className="hidden w-[7.5rem] p-3 text-right whitespace-nowrap xl:table-cell">Valor</th>
                  <th className="w-[6.5rem] p-3 text-right whitespace-nowrap">Ações</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/5">
                {filteredInsumos.map((item, idx) => {
                  const estoque = unit && item?.estoques ? Number(item.estoques?.[unit] ?? 0) : Number(item.estoqueAtual ?? 0)
                  const min = Number(item.estoqueMinimo) || 0
                  const valor = (Number(item.precoCusto) || 0) * (Number.isFinite(estoque) ? estoque : 0)
                  return (
                    <tr key={`${item.registro || ''}-${idx}`} className="hover:bg-white/5">
                      <td className="p-3 align-top text-blue-50">
                        <div className="min-w-0">
                          <div className="break-words font-medium">{item.produto || '-'}</div>
                          <div className="mt-1 space-y-0.5">
                            <div className="break-words text-xs text-blue-200/60 md:hidden">{item.categoria || '-'}</div>
                            <div className="break-all font-mono text-xs text-blue-200/60 lg:hidden">{item.codigoBarras || '-'}</div>
                            <div className="text-xs text-blue-200/60 xl:hidden">{fmtDateOnlyBR(item.dataValidade || '') || '-'}</div>
                            <div className="text-xs text-blue-200/60 xl:hidden">{fmtMoneyBRL(valor)}</div>
                          </div>
                        </div>
                      </td>
                      <td className="hidden p-3 align-middle text-blue-100/80 md:table-cell">
                        <div className="break-words">{item.categoria || '-'}</div>
                      </td>
                      <td className="hidden break-all p-3 align-middle font-mono text-blue-100/70 lg:table-cell">{item.codigoBarras || '-'}</td>
                      <td className="p-3 align-middle text-right font-mono text-blue-100/80 whitespace-nowrap">{Number.isFinite(estoque) ? estoque : '-'}</td>
                      <td className="hidden p-3 align-middle text-right font-mono text-blue-100/70 whitespace-nowrap sm:table-cell">{min || '-'}</td>
                      <td className="hidden p-3 align-middle text-blue-100/70 whitespace-nowrap xl:table-cell">{fmtDateOnlyBR(item.dataValidade || '')}</td>
                      <td className="hidden p-3 align-middle text-right text-blue-100/80 whitespace-nowrap xl:table-cell">{fmtMoneyBRL(valor)}</td>
                      <td className="p-3 align-middle text-right whitespace-nowrap">
                        <div className="flex items-center justify-end">
                          <Button variant="outline" size="sm" className="h-8 px-3 text-xs" onClick={() => onEditItem(item)} disabled={!isAuthed}>
                            Editar
                          </Button>
                        </div>
                      </td>
                    </tr>
                  )
                })}
                {!filteredInsumos.length ? (
                  <tr>
                    <td className="p-3 text-blue-100/70" colSpan={8}>
                      {insumosLoadError && !insumosLoading ? (
                        <span className="text-red-200">
                          Erro ao carregar insumos ({insumosLoadError.status || 'erro'}
                          {insumosLoadError.code ? `/${insumosLoadError.code}` : ''}): {insumosLoadError.message}
                        </span>
                      ) : (
                        emptyContent
                      )}
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}

export function InsumosPurchaseDialog({
  actionables,
  dialogClassName,
  isAuthed,
  loading,
  open,
  onOpenChange,
  onOpenQuickOperation,
  onClose,
  renderLoadingText,
  unit,
  unitLabel,
}: InsumosPurchaseDialogProps) {
  const items = React.useMemo(() => (actionables?.reposicao || []).slice(), [actionables?.reposicao])
  const totalValue = React.useMemo(
    () => items.reduce((acc, it) => acc + (Number(it.estimatedValue) || 0), 0),
    [items],
  )
  const totalQty = React.useMemo(
    () => items.reduce((acc, it) => acc + (Number(it.suggestedPurchaseQty) || 0), 0),
    [items],
  )
  const categories = React.useMemo(() => {
    const byCat = new Map<string, typeof items>()
    for (const it of items) {
      const cat = String(it.categoria || 'Outros').trim() || 'Outros'
      const prev = byCat.get(cat) || []
      prev.push(it)
      byCat.set(cat, prev)
    }
    return Array.from(byCat.entries()).sort((a, b) => a[0].localeCompare(b[0]))
  }, [items])

  const escapeCsv = React.useCallback((value: unknown) => {
    const out = String(value ?? '')
    if (/[";\n\r]/.test(out)) return `"${out.replace(/"/g, '""')}"`
    return out
  }, [])

  const toCsv = React.useCallback(() => {
    const header = ['Categoria', 'Produto', 'Código', 'Qtd sugerida', 'Valor estimado (R$)']
    const rows = items.map((it) => [
      it.categoria || '',
      it.produto || '',
      it.codigoBarras || '',
      Number(it.suggestedPurchaseQty) || 0,
      Number(it.estimatedValue) || 0,
    ])
    return [header, ...rows].map((row) => row.map(escapeCsv).join(';')).join('\n')
  }, [escapeCsv, items])

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="wideTable" className={`${dialogClassName} dark bg-corporate-900 border-white/10 text-white`}>
        <DialogHeader>
          <DialogTitle className="text-white">Lista de compra</DialogTitle>
          <DialogDescription className="text-blue-100/70">
            Sugestões de reposição para {unitLabel(unit)} (baseado em estoque mínimo).
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="text-sm text-blue-100/80">
              <span className="font-mono">{items.length}</span> itens • <span className="font-mono">{totalQty}</span> unidades sugeridas •{' '}
              <span className="font-mono">{fmtMoneyBRL(totalValue)}</span>
            </div>
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                onClick={async () => {
                  try {
                    await navigator.clipboard.writeText(toCsv())
                  } catch {
                    // ignore clipboard errors
                  }
                }}
                disabled={!items.length}
              >
                Copiar CSV
              </Button>
              <Button
                variant="secondary"
                onClick={() => {
                  const csv = toCsv()
                  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' })
                  const url = URL.createObjectURL(blob)
                  const link = document.createElement('a')
                  link.href = url
                  link.download = `lista-compra-${unit}-${new Date().toISOString().slice(0, 10)}.csv`
                  document.body.appendChild(link)
                  link.click()
                  link.remove()
                  setTimeout(() => URL.revokeObjectURL(url), 2000)
                }}
                disabled={!items.length}
              >
                Baixar CSV
              </Button>
            </div>
          </div>

          <div className="max-h-[60vh] overflow-auto rounded-xl border border-white/10">
            <table className="min-w-full text-sm">
              <thead className="bg-black/30 text-blue-100/80">
                <tr>
                  <th className="p-3 text-left">Produto</th>
                  <th className="hidden p-3 text-left md:table-cell">Categoria</th>
                  <th className="hidden p-3 text-left sm:table-cell">Código</th>
                  <th className="p-3 text-right">Qtd sugerida</th>
                  <th className="p-3 text-right">Valor</th>
                  <th className="p-3 text-right">Ação</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/5">
                {categories.flatMap(([category, list]) =>
                  list.map((it, idx) => (
                    <tr key={`${String(it.codigoBarras || '')}-${idx}`} className="hover:bg-white/5">
                      <td className="p-3 text-blue-50">
                        <div className="font-medium">{it.produto || '-'}</div>
                      </td>
                      <td className="hidden p-3 text-blue-100/80 md:table-cell">{it.categoria || category}</td>
                      <td className="hidden break-all p-3 font-mono text-blue-100/80 sm:table-cell">{it.codigoBarras || ''}</td>
                      <td className="p-3 text-right font-mono text-blue-100/80">{it.suggestedPurchaseQty ?? 0}</td>
                      <td className="p-3 text-right font-mono text-blue-100/80">
                        {fmtMoneyBRL(Number(it.estimatedValue) || 0)}
                      </td>
                      <td className="p-3 text-right">
                        <Button
                          variant="outline"
                          className="h-8 px-2 text-xs"
                          onClick={() => {
                            onOpenQuickOperation('ENTRADA', {
                              codigoBarras: String(it.codigoBarras || ''),
                              quantidade: it.suggestedPurchaseQty ?? 1,
                              obs: 'Reposição sugerida',
                            })
                            onClose()
                          }}
                          disabled={!isAuthed}
                        >
                          Registrar entrada
                        </Button>
                      </td>
                    </tr>
                  )),
                )}
                {!items.length ? (
                  <tr>
                    <td className="p-3 text-blue-100/70" colSpan={6}>
                      {renderLoadingText(loading, 'Sem recomendações de compra.')}
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </div>

        <DialogFooter>
          <Button variant="secondary" onClick={onClose}>
            Fechar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

type QuickSearchMatch = {
  item: Insumo
  matchedCode: string
  score: number
}

type InsumosQuickOperationDialogProps = {
  open: boolean
  operation: InsumosQuickOperation | null
  dialogClassName: string
  isAuthed: boolean
  shouldShowDashboardLoading: boolean
  renderDashboardLoadingButton: () => React.ReactNode
  unit: string
  transferFrom: string
  transferTo: string
  unitOptions: string[]
  unitLabel: (unit: string) => string
  search: string
  onSearchChange: (value: string) => void
  scanOpen: boolean
  onScanToggle: () => void
  onScanClose: () => void
  onBarcodeDetected: (code: string) => void
  searchRemoteLoading: boolean
  searchRemoteError: string | null
  searchMatches: QuickSearchMatch[]
  hasSelection: boolean
  lookupLoading: boolean
  lookupError: string | null
  lookupItems: Insumo[]
  selectedSnapshot: Insumo | null
  quickCode: string
  onClearSelection: () => void
  onApplySelection: (item: Insumo, preferredCode?: string) => void
  isSameInsumo: (item: Insumo, target: Insumo | null) => boolean
  onSelectCode: (value: string, item?: Insumo | null) => void
  loteNeedsPick: boolean
  lotesForPicker: QuickCandidate[]
  selectedRegistro: string
  onRegistroChange: (value: string) => void
  showFefoToggle: boolean
  autoFefo: boolean
  onToggleAutoFefo: () => void
  quantity: string
  onQuantityChange: (value: string) => void
  adjustmentStock: string
  onAdjustmentStockChange: (value: string) => void
  adjustmentReason: string
  onAdjustmentReasonChange: (value: string) => void
  obs: string
  onObsChange: (value: string) => void
  onTransferFromChange: (value: string) => void
  onTransferToChange: (value: string) => void
  feedback: QuickActionFeedback | null
  loading: boolean
  onOpenChange: (open: boolean) => void
  onCancel: () => void
  onConfirmTransfer: () => Promise<void>
  onConfirmOperation: () => Promise<void>
  onEditItem: (item: Insumo) => void
}

export function InsumosQuickOperationDialog({
  open,
  operation,
  dialogClassName,
  isAuthed,
  shouldShowDashboardLoading,
  renderDashboardLoadingButton,
  unit,
  transferFrom,
  transferTo,
  unitOptions,
  unitLabel,
  search,
  onSearchChange,
  scanOpen,
  onScanToggle,
  onScanClose,
  onBarcodeDetected,
  searchRemoteLoading,
  searchRemoteError,
  searchMatches,
  hasSelection,
  lookupLoading,
  lookupError,
  lookupItems,
  selectedSnapshot,
  quickCode,
  onClearSelection,
  onApplySelection,
  isSameInsumo,
  onSelectCode,
  loteNeedsPick,
  lotesForPicker,
  selectedRegistro,
  onRegistroChange,
  showFefoToggle,
  autoFefo,
  onToggleAutoFefo,
  quantity,
  onQuantityChange,
  adjustmentStock,
  onAdjustmentStockChange,
  adjustmentReason,
  onAdjustmentReasonChange,
  obs,
  onObsChange,
  onTransferFromChange,
  onTransferToChange,
  feedback,
  loading,
  onOpenChange,
  onCancel,
  onConfirmTransfer,
  onConfirmOperation,
  onEditItem,
}: InsumosQuickOperationDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className={`${dialogClassName} dark bg-corporate-900 border-white/10 text-white`}>
        <DialogHeader>
          <DialogTitle className="text-white">
            {operation === 'ENTRADA'
              ? 'Entrada'
              : operation === 'BAIXA'
                ? 'Saída'
                : operation === 'AJUSTE'
                  ? 'Ajuste'
                : operation === 'TRANSFERENCIA'
                  ? 'Transferência'
                  : 'Operação'}
          </DialogTitle>
          <DialogDescription className="text-blue-100/70">
            Preencha os dados para registrar a operação na unidade selecionada.
          </DialogDescription>
        </DialogHeader>

        {!isAuthed ? (
          shouldShowDashboardLoading ? (
            renderDashboardLoadingButton()
          ) : (
            <div className="text-sm text-blue-100/80">Faça login no CRM para usar as operações de Insumos.</div>
          )
        ) : null}

        <div className="rounded-lg border border-blue-400/40 bg-blue-500/10 px-3 py-2 text-xs text-blue-100">
          {operation === 'TRANSFERENCIA'
            ? `Unidade da operação: ${unitLabel(transferFrom)} → ${unitLabel(transferTo)}`
            : `Unidade da operação: ${unitLabel(unit)}`}
        </div>

        <div className="space-y-3">
          <div>
            <div className="mb-1 text-xs text-blue-200/70">Buscar por produto, marca, categoria ou código</div>
            <div className="flex flex-wrap items-center gap-2">
              <Input
                value={search}
                onChange={(e) => onSearchChange(e.target.value)}
                placeholder="ex: Rennova, preenchedor, 789..."
                className="w-full sm:min-w-[240px] sm:flex-1"
              />
              <Button variant="secondary" type="button" onClick={onScanToggle}>
                {scanOpen ? 'Fechar' : 'Escanear'}
              </Button>
            </div>
            <div className="mt-2">
              {searchRemoteLoading ? (
                <div className="text-xs text-blue-200/70">Buscando no servidor…</div>
              ) : searchRemoteError ? (
                <div className="text-xs text-amber-200">{searchRemoteError} (mostrando cache local).</div>
              ) : null}
              {searchMatches.length && (!hasSelection || lookupLoading) ? (
                <div className="rounded-lg border border-white/10 bg-black/20 px-3 py-2">
                  <div className="mb-2 text-[11px] text-blue-200/60">Selecione o produto para lançar a operação:</div>
                  <div className="space-y-2">
                    {searchMatches.map(({ item, matchedCode }) => {
                      const codes = getInsumoBarcodes(item)
                      const code = matchedCode && codes.includes(matchedCode) ? matchedCode : codes[0] || ''
                      const hasCode = !!code
                      const descriptor = formatInsumoDescriptor(item)
                      const primarySelected = selectedSnapshot || (lookupItems.length ? lookupItems[0] : null)
                      const isLoadingSelection = !!(lookupLoading && primarySelected && isSameInsumo(item, primarySelected))
                      return (
                        <div
                          key={`${item.registro || ''}-${code || 'nocode'}`}
                          className="w-full min-w-0 rounded-md border border-white/5 bg-white/5 px-2 py-2"
                        >
                          <button
                            type="button"
                            onClick={() => onApplySelection(item, code)}
                            disabled={!hasCode || isLoadingSelection}
                            className={`w-full rounded-md px-1 py-1 text-left ${!hasCode || isLoadingSelection ? 'cursor-not-allowed' : 'hover:bg-white/10'}`}
                            aria-busy={isLoadingSelection}
                          >
                            <div className="flex flex-wrap items-center justify-between gap-2">
                              <div className="break-words text-sm font-semibold text-blue-50">{String(item.produto || 'Insumo')}</div>
                              <div className="flex items-center gap-2 break-all font-mono text-xs text-blue-200/60">
                                {code || '—'}
                                {isLoadingSelection ? (
                                  <span className="inline-flex items-center gap-1 font-sans text-blue-200/70">
                                    <span className="inline-flex h-3 w-3 animate-spin rounded-full border border-blue-200/70 border-t-transparent" />
                                    Carregando…
                                  </span>
                                ) : null}
                              </div>
                            </div>
                            {descriptor ? (
                              <div className="mt-0.5 break-words text-xs text-blue-200/70">{descriptor}</div>
                            ) : null}
                            {!hasCode ? (
                              <div className="mt-1 text-xs text-amber-200">Sem código de barras cadastrado</div>
                            ) : null}
                            <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-blue-200/70">
                              {item.categoria ? (
                                <Badge style={buildTagStyle(getCategoriaBgColor(String(item.categoria)))} className="border">
                                  {String(item.categoria)}
                                </Badge>
                              ) : null}
                              {item.marca ? (
                                <Badge style={buildTagStyle(getMarcaBgColor(String(item.marca)))} className="border">
                                  {String(item.marca)}
                                </Badge>
                              ) : null}
                            </div>
                          </button>
                          {!hasCode ? (
                            <div className="mt-2 flex justify-end">
                              <Button variant="outline" size="sm" onClick={() => onEditItem(item)} disabled={!isAuthed}>
                                Editar cadastro
                              </Button>
                            </div>
                          ) : null}
                        </div>
                      )
                    })}
                  </div>
                </div>
              ) : null}
              {lookupLoading ? (
                <div className="text-xs text-blue-200/70">Buscando informações do insumo…</div>
              ) : lookupError ? (
                <div className="text-xs text-red-200">{lookupError}</div>
              ) : lookupItems.length || selectedSnapshot ? (
                (() => {
                  const selected = lookupItems[0] || selectedSnapshot
                  if (!selected) return null
                  const selectedCodes = getInsumoBarcodes(selected)
                  const activeCode = quickCode.trim() || selectedCodes[0] || ''
                  const resumoBase = lookupItems.length ? lookupItems : [selected]
                  return (
                    <div className="rounded-lg border border-blue-400/40 bg-blue-500/10 px-3 py-2">
                      <div className="flex flex-wrap items-start justify-between gap-2">
                        <div>
                          <div className="text-xs uppercase tracking-wide text-blue-200/70">Selecionado</div>
                          <div className="text-sm font-semibold text-blue-50">
                            {String(selected?.produto || '').trim() || 'Insumo'}
                          </div>
                          {formatInsumoDescriptor(selected) ? (
                            <div className="mt-0.5 text-xs text-blue-200/70">{formatInsumoDescriptor(selected)}</div>
                          ) : null}
                        </div>
                        <div className="flex flex-col items-end gap-2 text-xs text-blue-200/70">
                          <Button variant="outline" size="sm" onClick={onClearSelection}>
                            Trocar seleção
                          </Button>
                          <div className="text-right">
                            {(() => {
                              const ctx = operation === 'TRANSFERENCIA' ? transferFrom : unit
                              const total = resumoBase.reduce((acc, it) => {
                                const value =
                                  ctx && (it as any)?.estoques
                                    ? Number((it as any).estoques?.[ctx] ?? 0)
                                    : Number((it as any).estoqueAtual ?? 0)
                                return acc + (Number.isFinite(value) ? value : 0)
                              }, 0)
                              return `Estoque: ${total}`
                            })()}
                            {' • '}
                            {
                              Array.from(
                                new Set(resumoBase.map((it) => String((it as any)?.registro || '').trim()).filter(Boolean)),
                              ).length
                            }{' '}
                            registros
                          </div>
                        </div>
                      </div>
                      {selectedCodes.length > 1 ? (
                        <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-blue-200/70">
                          <span className="uppercase tracking-wide">Código</span>
                          <Select value={activeCode} onValueChange={(value) => onSelectCode(value, selected)}>
                            <SelectTrigger className="h-8">
                              <SelectValue placeholder="Selecione o código" />
                            </SelectTrigger>
                            <SelectContent>
                              {selectedCodes.map((code) => (
                                <SelectItem key={code} value={code}>
                                  <span className="font-mono">{code}</span>
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                      ) : null}
                      <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-blue-200/70">
                        {selected?.categoria ? (
                          <Badge style={buildTagStyle(getCategoriaBgColor(String(selected.categoria)))} className="border">
                            {String(selected.categoria)}
                          </Badge>
                        ) : null}
                        {selected?.marca ? (
                          <Badge style={buildTagStyle(getMarcaBgColor(String(selected.marca)))} className="border">
                            {String(selected.marca)}
                          </Badge>
                        ) : null}
                      </div>
                    </div>
                  )
                })()
              ) : null}
            </div>
          </div>

          {loteNeedsPick ? (
            <div className="space-y-2 rounded-xl border border-white/10 bg-black/20 p-3">
              <div className="flex items-center justify-between gap-2">
                <div className="text-xs text-blue-200/70">Lote/registro</div>
                {showFefoToggle ? (
                  <Button
                    variant="outline"
                    size="sm"
                    type="button"
                    onClick={onToggleAutoFefo}
                    title="FEFO (First-Expire, First-Out): prioriza o lote com validade mais próxima"
                  >
                    FEFO {autoFefo ? 'auto' : 'manual'}
                  </Button>
                ) : null}
              </div>
              <Select value={selectedRegistro} onValueChange={onRegistroChange}>
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="Selecione o lote/registro" />
                </SelectTrigger>
                <SelectContent>
                  {lotesForPicker.map((lote) => (
                    <SelectItem key={lote.registro} value={lote.registro}>
                      <span className="flex w-full items-center justify-between gap-3">
                        <span className="font-mono">{lote.registro}</span>
                        <span className="flex items-center gap-2 text-xs text-blue-100/70">
                          {lote.lote ? <span>Lote {lote.lote}</span> : null}
                          {lote.dataValidade ? <span>Vence {fmtDateOnlyBR(lote.dataValidade)}</span> : null}
                          {Number.isFinite(Number(lote.estoque)) ? <span>Estoque {Number(lote.estoque)}</span> : null}
                        </span>
                      </span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <div className="text-xs text-blue-200/60">
                Se o produto tiver múltiplos lotes, selecione qual registro deve ser movimentado.
              </div>
            </div>
          ) : null}

          {operation === 'AJUSTE' ? (
            <>
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                <div>
                  <div className="mb-1 text-xs text-blue-200/70">Novo estoque</div>
                  <Input value={adjustmentStock} onChange={(e) => onAdjustmentStockChange(e.target.value)} type="number" min={0} />
                </div>
                <div>
                  <div className="mb-1 text-xs text-blue-200/70">Motivo</div>
                  <Input value={adjustmentReason} onChange={(e) => onAdjustmentReasonChange(e.target.value)} placeholder="Ajuste manual" />
                </div>
              </div>
              <div>
                <div className="mb-1 text-xs text-blue-200/70">Observações</div>
                <Input value={obs} onChange={(e) => onObsChange(e.target.value)} placeholder="opcional" />
              </div>
            </>
          ) : (
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              <div>
                <div className="mb-1 text-xs text-blue-200/70">Quantidade</div>
                <Input value={quantity} onChange={(e) => onQuantityChange(e.target.value)} type="number" min={1} />
              </div>
              <div>
                <div className="mb-1 text-xs text-blue-200/70">Observações</div>
                <Input value={obs} onChange={(e) => onObsChange(e.target.value)} placeholder="opcional" />
              </div>
            </div>
          )}

          {operation === 'TRANSFERENCIA' ? (
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              <div>
                <div className="mb-1 text-xs text-blue-200/70">Origem</div>
                <Select value={transferFrom} onValueChange={onTransferFromChange}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {unitOptions.map((unitOption) => (
                      <SelectItem key={unitOption} value={unitOption}>
                        {unitLabel(unitOption)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <div className="mb-1 text-xs text-blue-200/70">Destino</div>
                <Select value={transferTo} onValueChange={onTransferToChange}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {unitOptions.map((unitOption) => (
                      <SelectItem key={unitOption} value={unitOption}>
                        {unitLabel(unitOption)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
          ) : null}

          {scanOpen ? (
            <InsumosBarcodeScannerInline onDetected={onBarcodeDetected} onClose={onScanClose} />
          ) : null}

          {feedback ? (
            <div
              className={`rounded-lg border px-3 py-2 text-sm ${
                feedback.type === 'success'
                  ? 'border-emerald-400/40 bg-emerald-500/10 text-emerald-100'
                  : 'border-red-400/40 bg-red-500/10 text-red-100'
              }`}
            >
              {feedback.message}
            </div>
          ) : null}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onCancel}>
            Cancelar
          </Button>
          {operation === 'TRANSFERENCIA' ? (
            <Button
              className="!bg-blue-600 hover:!bg-blue-700 !text-white"
              onClick={() => void onConfirmTransfer()}
              disabled={loading || !isAuthed}
            >
              <span className="flex items-center gap-2">
                {loading ? (
                  <svg className="h-4 w-4 animate-spin" viewBox="0 0 24 24" fill="none" aria-hidden>
                    <circle cx="12" cy="12" r="10" stroke="currentColor" strokeOpacity="0.25" strokeWidth="3" />
                    <path d="M22 12a10 10 0 0 0-10-10" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
                  </svg>
                ) : null}
                {loading ? 'Processando...' : 'Confirmar transferência'}
              </span>
            </Button>
          ) : (
            <Button
              className={
                operation === 'ENTRADA'
                  ? '!bg-green-600 hover:!bg-green-700 !text-white'
                  : operation === 'AJUSTE'
                    ? '!bg-amber-500 hover:!bg-amber-600 !text-white'
                    : ''
              }
              variant={operation === 'BAIXA' ? 'destructive' : 'default'}
              onClick={() => void onConfirmOperation()}
              disabled={loading || !isAuthed}
            >
              <span className="flex items-center gap-2">
                {loading ? (
                  <svg className="h-4 w-4 animate-spin" viewBox="0 0 24 24" fill="none" aria-hidden>
                    <circle cx="12" cy="12" r="10" stroke="currentColor" strokeOpacity="0.25" strokeWidth="3" />
                    <path d="M22 12a10 10 0 0 0-10-10" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
                  </svg>
                ) : null}
                {loading
                  ? 'Processando...'
                  : operation === 'ENTRADA'
                    ? 'Confirmar entrada'
                    : operation === 'AJUSTE'
                      ? 'Confirmar ajuste'
                      : 'Confirmar saída'}
              </span>
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

type InsumosLotDialogProps = {
  open: boolean
  dialogClassName: string
  item: Insumo | null
  lotValue: string
  expiryValue: string
  onOpenChange: (open: boolean) => void
  onLotChange: (value: string) => void
  onExpiryChange: (value: string) => void
  onSave: () => void
  saving: boolean
  isAuthed: boolean
}

export function InsumosLotDialog({
  open,
  dialogClassName,
  item,
  lotValue,
  expiryValue,
  onOpenChange,
  onLotChange,
  onExpiryChange,
  onSave,
  saving,
  isAuthed,
}: InsumosLotDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className={dialogClassName}>
        <DialogHeader>
          <DialogTitle>Editar lote/validade</DialogTitle>
          <DialogDescription>
            {item?.produto || '-'} • <span className="font-mono">{item?.codigoBarras || '-'}</span>
          </DialogDescription>
        </DialogHeader>

        {item ? (
          <div className="rounded-lg border border-white/10 bg-black/20 p-3 text-sm text-blue-100/70">
            <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
              <div>
                <div className="text-xs text-muted-foreground">Categoria</div>
                <div className="text-blue-100/80">{item.categoria || '-'}</div>
              </div>
              <div>
                <div className="text-xs text-muted-foreground">Marca</div>
                <div className="text-blue-100/80">{item.marca || '-'}</div>
              </div>
              {item.concentracao ? (
                <div>
                  <div className="text-xs text-muted-foreground">Concentração</div>
                  <div className="text-blue-100/80">{item.concentracao}</div>
                </div>
              ) : null}
              {item.volume ? (
                <div>
                  <div className="text-xs text-muted-foreground">Volume</div>
                  <div className="text-blue-100/80">{item.volume}</div>
                </div>
              ) : null}
              {item.calibre ? (
                <div>
                  <div className="text-xs text-muted-foreground">Calibre</div>
                  <div className="text-blue-100/80">{item.calibre}</div>
                </div>
              ) : null}
              <div>
                <div className="text-xs text-muted-foreground">Homologado</div>
                <div className="text-blue-100/80">{/homologad/i.test(String(item.fonte || '').trim()) ? 'Sim' : 'Não'}</div>
              </div>
            </div>
          </div>
        ) : null}

        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          <div>
            <div className="mb-1 text-xs text-muted-foreground">Lote</div>
            <Input value={lotValue} onChange={(e) => onLotChange(e.target.value)} placeholder="ex: 2026-01A" />
          </div>
          <div>
            <div className="mb-1 text-xs text-muted-foreground">Validade</div>
            <BrDatePickerInput
              value={expiryValue}
              onChange={onExpiryChange}
              placeholder="DD/MM/AA"
              ariaLabel="Validade do lote"
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="secondary" onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          <Button onClick={onSave} disabled={saving || !isAuthed}>
            {saving ? 'Salvando…' : 'Salvar'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

type InsumosOfflineQueueDialogProps = {
  open: boolean
  dialogClassName: string
  items: OfflineQueueItem[]
  debugUi: boolean
  isAuthed: boolean
  fmtAge: (ts?: number) => string
  onOpenChange: (open: boolean) => void
  onSync: () => void
  onClear: () => void
  onToggleDebug: () => void
  onCopyItem: (item: OfflineQueueItem) => void
}

export function InsumosOfflineQueueDialog({
  open,
  dialogClassName,
  items,
  debugUi,
  isAuthed,
  fmtAge,
  onOpenChange,
  onSync,
  onClear,
  onToggleDebug,
  onCopyItem,
}: InsumosOfflineQueueDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className={dialogClassName}>
        <DialogHeader>
          <DialogTitle>Pendências de sincronização</DialogTitle>
          <DialogDescription>
            Operações salvas localmente quando a rede cai. Ao reconectar, clique em “Sincronizar”.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="text-sm text-muted-foreground">
            Itens: <span className="font-mono">{items.length}</span>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="secondary" onClick={onSync} disabled={!isAuthed || !items.length}>
              Sincronizar
            </Button>
            <Button variant="destructive" onClick={onClear} disabled={!items.length}>
              Limpar
            </Button>
          </div>
        </div>

        {debugUi ? (
          <div className="max-h-[60vh] overflow-auto rounded-xl border border-white/10">
            <table className="min-w-full text-sm">
              <thead className="bg-black/30 text-blue-100/80">
                <tr>
                  <th className="p-3 text-left">Quando</th>
                  <th className="p-3 text-left">Método</th>
                  <th className="p-3 text-left">Endpoint</th>
                  <th className="p-3 text-right">Ações</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/5">
                {items.map((item) => (
                  <tr key={item.id} className="hover:bg-white/5">
                    <td className="p-3 text-blue-100/70">{fmtAge(item.ts)}</td>
                    <td className="p-3 font-mono text-blue-100/80">{item.method}</td>
                    <td className="p-3 font-mono text-blue-50">{item.path}</td>
                    <td className="p-3 text-right">
                      <Button variant="outline" onClick={() => onCopyItem(item)}>
                        Copiar
                      </Button>
                    </td>
                  </tr>
                ))}
                {!items.length ? (
                  <tr>
                    <td className="p-3 text-blue-100/70" colSpan={4}>
                      Sem itens pendentes.
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="rounded-xl border border-white/10 bg-black/20 p-3 text-sm text-blue-100/70">
            {items.length ? (
              <div>
                Existem <span className="font-semibold text-blue-100">{items.length}</span> operações pendentes. Clique em
                “Sincronizar” quando estiver online.
              </div>
            ) : (
              <div>Sem pendências.</div>
            )}
            <div className="mt-2">
              <Button variant="outline" size="sm" onClick={onToggleDebug}>
                Ver detalhes técnicos
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}

type InsumosMovementEditDialogProps = {
  open: boolean
  dialogClassName: string
  target: Movimentacao | null
  isAuthed: boolean
  saving: boolean
  deleting: boolean
  produto: string
  data: string
  hora: string
  unidade: string
  quantidade: string
  novoEstoque: string
  motivo: string
  unitOptions: string[]
  insumosProdutos: string[]
  unitLabel: (value: string) => string
  onOpenChange: (open: boolean) => void
  onProdutoChange: (value: string) => void
  onDataChange: (value: string) => void
  onHoraChange: (value: string) => void
  onUnidadeChange: (value: string) => void
  onQuantidadeChange: (value: string) => void
  onNovoEstoqueChange: (value: string) => void
  onMotivoChange: (value: string) => void
  onCancel: () => void
  onSave: () => void
  onDelete: () => void
}

export function InsumosMovementEditDialog({
  open,
  dialogClassName,
  target,
  isAuthed,
  saving,
  deleting,
  produto,
  data,
  hora,
  unidade,
  quantidade,
  novoEstoque,
  motivo,
  unitOptions,
  insumosProdutos,
  unitLabel,
  onOpenChange,
  onProdutoChange,
  onDataChange,
  onHoraChange,
  onUnidadeChange,
  onQuantidadeChange,
  onNovoEstoqueChange,
  onMotivoChange,
  onCancel,
  onSave,
  onDelete,
}: InsumosMovementEditDialogProps) {
  const tipo = normalizeMovimentacaoTipo(target?.tipo)
  const isTransfer = !!String(target?.transferId || '').trim()
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className={`${dialogClassName} dark bg-corporate-900 border-white/10 text-white`}>
        <DialogHeader>
          <DialogTitle className="text-white">
            {isTransfer
              ? 'Editar transferência'
              : tipo === 'AJUSTE'
                ? 'Editar ajuste'
                : tipo.includes('ENTRADA')
                  ? 'Editar entrada'
                  : tipo.includes('SAIDA')
                    ? 'Editar saída'
                    : 'Editar lançamento'}
          </DialogTitle>
          <DialogDescription className="text-blue-100/70">
            Edite os dados do lançamento sem abrir o cadastro do insumo.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div>
            <div className="mb-1 text-xs text-blue-200/70">Produto</div>
            <AutocompleteInput
              value={produto}
              onValueChange={onProdutoChange}
              placeholder="Nome do produto"
              options={insumosProdutos}
            />
          </div>

          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            <div>
              <div className="mb-1 text-xs text-blue-200/70">Data</div>
              <BrDatePickerInput
                value={fmtDateOnlyBR(data)}
                onChange={onDataChange}
                placeholder="DD/MM/AA"
                ariaLabel="Data da movimentação"
              />
            </div>
            <div>
              <div className="mb-1 text-xs text-blue-200/70">Hora</div>
              <Input type="time" value={hora} onChange={(e) => onHoraChange(e.target.value)} />
            </div>
          </div>

          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            <div>
              <div className="mb-1 text-xs text-blue-200/70">Unidade</div>
              {isTransfer ? (
                <Input
                  value={`${unitLabel(String(target?.unidadeOrigem || ''))} → ${unitLabel(String(target?.unidadeDestino || ''))}`}
                  disabled
                />
              ) : (
                <Select value={unidade || undefined} onValueChange={onUnidadeChange}>
                  <SelectTrigger>
                    <SelectValue placeholder="Selecione a unidade" />
                  </SelectTrigger>
                  <SelectContent>
                    {unitOptions.map((unitOption) => (
                      <SelectItem key={unitOption} value={unitOption}>
                        {unitLabel(unitOption)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            </div>

            {tipo === 'AJUSTE' ? (
              <div>
                <div className="mb-1 text-xs text-blue-200/70">Novo estoque</div>
                <Input type="number" min={0} value={novoEstoque} onChange={(e) => onNovoEstoqueChange(e.target.value)} />
              </div>
            ) : (
              <div>
                <div className="mb-1 text-xs text-blue-200/70">Quantidade</div>
                <Input type="number" min={1} value={quantidade} onChange={(e) => onQuantidadeChange(e.target.value)} />
              </div>
            )}
          </div>

          {tipo === 'AJUSTE' ? (
            <div>
              <div className="mb-1 text-xs text-blue-200/70">Motivo</div>
              <Input value={motivo} onChange={(e) => onMotivoChange(e.target.value)} />
            </div>
          ) : null}

          {target?.registroInsumo ? (
            <div className="text-xs text-blue-200/60">
              Registro: <span className="font-mono">{String(target.registroInsumo)}</span>
            </div>
          ) : null}
        </div>

        <DialogFooter className="flex-col-reverse sm:flex-row sm:justify-between">
          <Button variant="destructive" onClick={onDelete} disabled={saving || deleting || !isAuthed}>
            {deleting ? 'Excluindo...' : 'Excluir'}
          </Button>
          <div className="flex flex-col-reverse gap-2 sm:flex-row">
            <Button variant="secondary" onClick={onCancel} disabled={saving || deleting}>
              Cancelar
            </Button>
            <Button onClick={onSave} disabled={saving || deleting || !isAuthed}>
              {saving ? 'Salvando...' : 'Salvar lançamento'}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

type InsumosQualityMatchesDialogProps = {
  open: boolean
  dialogClassName: string
  issue: QualityIssue | null
  items: Insumo[]
  savingRegistro: string
  isAuthed: boolean
  unit: string
  unitLabel: (unit: string) => string
  onOpenChange: (open: boolean) => void
  onEditItem: (item: Insumo) => void
  onDeleteRegistro: (registro: string) => void
}

export function InsumosQualityMatchesDialog({
  open,
  dialogClassName,
  issue,
  items,
  savingRegistro,
  isAuthed,
  unit,
  unitLabel,
  onOpenChange,
  onEditItem,
  onDeleteRegistro,
}: InsumosQualityMatchesDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="wideTable" className={dialogClassName}>
        <DialogHeader>
          <DialogTitle>Duplicidade de código de barras</DialogTitle>
          <DialogDescription>
            {issue?.codigoBarras ? (
              <>
                Selecione qual registro editar ou excluir para o código <span className="font-mono">#{issue.codigoBarras}</span>. ({items.length}{' '}
                correspondências)
              </>
            ) : (
              <>Selecione qual registro editar ou excluir para resolver a duplicidade.</>
            )}
          </DialogDescription>
        </DialogHeader>
        <div className="max-h-[60vh] overflow-auto rounded-xl border border-white/10">
          <table className="min-w-full text-sm">
            <thead className="bg-black/30 text-blue-100/80">
              <tr>
                <th className="w-[20%] p-3 text-left">Registro</th>
                <th className="w-[32%] p-3 text-left">Produto</th>
                <th className="hidden w-[18%] p-3 text-left md:table-cell">Lote</th>
                <th className="hidden w-[14%] p-3 text-left sm:table-cell">Estoque ({unitLabel(unit)})</th>
                <th className="w-[16%] p-3 text-left">Ações</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/5">
              {items.map((item) => {
                const registro = String(item?.registro || '').trim()
                const isDeleting = savingRegistro === registro
                return (
                  <tr key={registro || String(item?.codigoBarras || '')} className="hover:bg-white/5">
                    <td className="p-3 font-mono text-blue-100/80">{registro || '-'}</td>
                    <td className="p-3 text-blue-50">{String(item?.produto || '-')}</td>
                    <td className="hidden p-3 text-blue-100/70 md:table-cell">{String(item?.lote || '-')}</td>
                    <td className="hidden p-3 text-blue-100/70 sm:table-cell">{Number(item?.estoqueAtual || 0)}</td>
                    <td className="p-3">
                      <div className="flex flex-col items-stretch gap-2 sm:flex-row sm:items-center">
                        <Button size="sm" variant="outline" onClick={() => onEditItem(item)} disabled={!isAuthed || isDeleting}>
                          Editar
                        </Button>
                        <Button
                          size="sm"
                          variant="destructive"
                          onClick={() => onDeleteRegistro(registro)}
                          disabled={!isAuthed || !registro || isDeleting}
                        >
                          {isDeleting ? 'Excluindo…' : 'Excluir'}
                        </Button>
                      </div>
                    </td>
                  </tr>
                )
              })}
              {!items.length ? (
                <tr>
                  <td className="p-3 text-blue-100/70" colSpan={5}>
                    Nenhuma correspondência encontrada.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </DialogContent>
    </Dialog>
  )
}

type InsumosShareReceivedPanelProps = {
  payload: SharePayload
  loading: boolean
  onClose: () => void
}

export function InsumosShareReceivedPanel({ payload, loading, onClose }: InsumosShareReceivedPanelProps) {
  return (
    <div className="rounded-xl border border-white/10 bg-black/30 p-3 text-sm text-blue-100/80">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="font-semibold text-blue-50">Compartilhamento recebido</div>
        <Button variant="secondary" size="sm" onClick={onClose}>
          Fechar
        </Button>
      </div>
      {loading ? <div className="mt-2 text-xs text-blue-200/60">Carregando anexos…</div> : null}
      <div className="mt-2 space-y-1">
        {payload.title ? (
          <div>
            <span className="text-blue-200/70">Título:</span> {payload.title}
          </div>
        ) : null}
        {payload.text ? (
          <div>
            <span className="text-blue-200/70">Texto:</span> {payload.text}
          </div>
        ) : null}
        {payload.url ? (
          <div className="break-words">
            <span className="text-blue-200/70">Link:</span>{' '}
            <a className="underline" href={payload.url} target="_blank" rel="noreferrer">
              {payload.url}
            </a>
          </div>
        ) : null}
        {payload.files && payload.files.length ? (
          <div className="space-y-1">
            <div className="text-blue-200/70">Arquivos:</div>
            <div className="flex flex-wrap gap-2">
              {payload.files.map((file, idx) => (
                <span key={`${file.name}-${idx}`} className="text-xs">
                  {file.url ? (
                    <a className="underline" href={file.url} target="_blank" rel="noreferrer">
                      {file.name}
                    </a>
                  ) : (
                    file.name
                  )}
                </span>
              ))}
            </div>
          </div>
        ) : null}
      </div>
      <div className="mt-2 text-xs text-blue-200/60">Preenchi o cadastro com os dados compartilhados. Revise antes de salvar.</div>
    </div>
  )
}

type InsumosShareHistoryPanelProps = {
  items: ShareHistoryItem[]
  loading: boolean
  onClear: () => void
  onUseItem: (item: ShareHistoryItem) => void
  onRemoveItem: (id: string) => void
}

export function InsumosShareHistoryPanel({
  items,
  loading,
  onClear,
  onUseItem,
  onRemoveItem,
}: InsumosShareHistoryPanelProps) {
  if (!items.length) return null
  return (
    <Card className="border border-white/10 bg-black/20">
      <CardHeader className="flex flex-row items-center justify-between gap-2">
        <CardTitle className="text-sm text-white">Importações recentes</CardTitle>
        <div className="flex items-center gap-2">
          <span className="text-xs text-blue-200/60">{items.length} itens</span>
          <Button variant="secondary" size="sm" onClick={onClear}>
            Limpar
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-2">
        {loading ? <div className="text-xs text-blue-200/60">Sincronizando…</div> : null}
        {items.slice(0, 6).map((item) => (
          <div key={item.id} className="rounded-lg border border-white/10 bg-black/20 px-3 py-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="text-sm text-blue-50">{item.title || item.url || 'Conteúdo compartilhado'}</div>
              <div className="text-xs text-blue-200/60">{fmtDate(item.createdAt)}</div>
            </div>
            {item.text ? <div className="mt-1 text-xs text-blue-200/70">{item.text}</div> : null}
            {item.files && item.files.length ? (
              <div className="mt-1 flex flex-wrap gap-2 text-xs text-blue-200/70">
                {item.files.map((file, idx) => (
                  <span key={`${item.id}-${idx}`} className="break-words">
                    {file.url ? (
                      <a className="underline" href={file.url} target="_blank" rel="noreferrer">
                        {file.name}
                      </a>
                    ) : (
                      file.name
                    )}
                  </span>
                ))}
              </div>
            ) : null}
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <Button variant="secondary" size="sm" onClick={() => onUseItem(item)}>
                Usar no cadastro
              </Button>
              <Button variant="outline" size="sm" onClick={() => onRemoveItem(item.id)}>
                Remover
              </Button>
            </div>
          </div>
        ))}
      </CardContent>
    </Card>
  )
}

type InsumosCreateInlinePanelProps = Omit<
  InsumosInventoryDialogProps,
  'open' | 'dialogClassName' | 'query' | 'onQueryChange' | 'onOpenChange' | 'onExport' | 'filteredInsumos' | 'listContainerRef' | 'onListScroll' | 'insumosLoading' | 'insumosLoadError' | 'emptyContent' | 'onEditItem'
> & {
  hint: string
  optionalDetailsOpen: boolean
  onOptionalDetailsToggle: (open: boolean) => void
  createEspecificacao: string
  onCreateEspecificacaoChange: (value: string) => void
  createConcentracao: string
  onCreateConcentracaoChange: (value: string) => void
  createVolume: string
  onCreateVolumeChange: (value: string) => void
  createCalibre: string
  onCreateCalibreChange: (value: string) => void
  createHomologado: boolean
  onCreateHomologadoChange: (value: boolean) => void
}

export function InsumosCreateInlinePanel({
  createOpen,
  unit,
  unitLabel,
  isAuthed,
  createLookupLoading,
  createLookupError,
  createLookupCount,
  createScanOpen,
  onToggleCreateScan,
  onCloseCreateScan,
  onCreateBarcodeDetected,
  createCodigo,
  onCreateCodigoChange,
  createCodigosExtras,
  onCreateCodigosExtrasChange,
  createProduto,
  onCreateProdutoChange,
  createCategoria,
  onCreateCategoriaChange,
  createMarca,
  onCreateMarcaChange,
  createTipoUnidade,
  onCreateTipoUnidadeChange,
  createPrecoCusto,
  onCreatePrecoCustoChange,
  createEstoqueMinimo,
  onCreateEstoqueMinimoChange,
  createEstoqueInicial,
  onCreateEstoqueInicialChange,
  createLote,
  onCreateLoteChange,
  createDataValidade,
  onCreateDataValidadeChange,
  createNovoLote,
  onToggleCreateNovoLote,
  createCategoriaRequiresLot,
  onCreateCategoriaRequiresLotChange,
  createCategoriaRequiresExpiry,
  onCreateCategoriaRequiresExpiryChange,
  createCategoriaFefo,
  onCreateCategoriaFefoChange,
  isManagerRole,
  lotCategorias,
  insumosMarcas,
  insumosTiposUnidade,
  createLoading,
  onSaveCreate,
  onCancelCreate,
  hint,
  optionalDetailsOpen,
  onOptionalDetailsToggle,
  createEspecificacao,
  onCreateEspecificacaoChange,
  createConcentracao,
  onCreateConcentracaoChange,
  createVolume,
  onCreateVolumeChange,
  createCalibre,
  onCreateCalibreChange,
  createHomologado,
  onCreateHomologadoChange,
}: InsumosCreateInlinePanelProps) {
  if (!createOpen) return null
  return (
    <div className="space-y-3 rounded-xl border border-white/10 bg-black/20 p-3">
      <div className="text-sm text-blue-100/70">Cadastro rápido (campos mínimos) + detalhes opcionais (como no app antigo de Insumos).</div>
      <div className="grid grid-cols-1 gap-2 md:grid-cols-3">
        <div>
          <div className="mb-1 text-xs text-blue-200/70">Código de barras</div>
          <div className="flex items-center gap-2">
            <Input value={createCodigo} onChange={(e) => onCreateCodigoChange(e.target.value)} placeholder="789..." />
            <Button variant="secondary" type="button" onClick={onToggleCreateScan}>
              {createScanOpen ? 'Fechar' : 'Escanear'}
            </Button>
          </div>
          <div className="mt-2">
            {createLookupLoading ? (
              <div className="text-xs text-blue-200/70">Buscando informações do insumo…</div>
            ) : createLookupError ? (
              <div className="text-xs text-red-200">{createLookupError}</div>
            ) : createLookupCount ? (
              <div className="text-xs text-blue-200/70">
                Encontramos um cadastro para este código e pré-preenchemos alguns campos (produto/categoria/marca). Se quiser, você pode cadastrar um novo lote.
              </div>
            ) : null}
          </div>
          <div className="mt-2">
            <div className="mb-1 text-xs text-blue-200/70">Códigos adicionais</div>
            <Textarea
              value={createCodigosExtras}
              onChange={(e) => onCreateCodigosExtrasChange(e.target.value)}
              placeholder="um por linha"
              rows={3}
              className="border-white/20 bg-white/[0.06] text-white"
            />
            <div className="mt-1 text-[10px] text-blue-200/50">Opcional. Use para variações de código do mesmo produto.</div>
          </div>
        </div>
        <div className="md:col-span-2">
          <div className="mb-1 text-xs text-blue-200/70">Produto</div>
          <Input value={createProduto} onChange={(e) => onCreateProdutoChange(e.target.value)} placeholder="Nome do produto" />
        </div>
        <div>
          <div className="mb-1 text-xs text-blue-200/70">Categoria</div>
          <Input value={createCategoria} onChange={(e) => onCreateCategoriaChange(e.target.value)} placeholder="ex: Anestésicos" list="insumos-categorias-inline" />
          <datalist id="insumos-categorias-inline">
            {lotCategorias.map((categoria) => (
              <option key={categoria} value={categoria} />
            ))}
          </datalist>
        </div>
        <div className="md:col-span-2 rounded-xl border border-white/10 bg-black/10 p-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="text-xs text-blue-200/70">Política do item</div>
            <div className="text-xs text-blue-200/60">Defina as regras para este insumo.</div>
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-4 text-sm text-blue-100/80">
            <label className={`flex select-none items-center gap-2 ${isManagerRole ? 'cursor-pointer' : 'cursor-default'}`}>
              <Checkbox checked={createCategoriaRequiresLot} onCheckedChange={(value) => onCreateCategoriaRequiresLotChange(!!value)} disabled={!isManagerRole} />
              Lote obrigatório
            </label>
            <label className={`flex select-none items-center gap-2 ${isManagerRole ? 'cursor-pointer' : 'cursor-default'}`}>
              <Checkbox checked={createCategoriaRequiresExpiry} onCheckedChange={(value) => onCreateCategoriaRequiresExpiryChange(!!value)} disabled={!isManagerRole} />
              Validade obrigatória
            </label>
            <label className={`flex select-none items-center gap-2 ${isManagerRole ? 'cursor-pointer' : 'cursor-default'}`}>
              <Checkbox checked={createCategoriaFefo} onCheckedChange={(value) => onCreateCategoriaFefoChange(!!value)} disabled={!isManagerRole} />
              FEFO
            </label>
            {!isManagerRole ? <span className="text-xs text-blue-200/60">Somente gestores alteram.</span> : null}
          </div>
        </div>
        <div>
          <div className="mb-1 text-xs text-blue-200/70">Marca</div>
          <Input value={createMarca} onChange={(e) => onCreateMarcaChange(e.target.value)} placeholder="ex: Galderma" list="insumos-marcas-inline" />
          <datalist id="insumos-marcas-inline">
            {insumosMarcas.map((marca) => (
              <option key={marca} value={marca} />
            ))}
          </datalist>
        </div>
        <div>
          <div className="mb-1 text-xs text-blue-200/70">Unidade (medida)</div>
          <Select value={createTipoUnidade || undefined} onValueChange={onCreateTipoUnidadeChange}>
            <SelectTrigger>
              <SelectValue placeholder="Selecione a unidade" />
            </SelectTrigger>
            <SelectContent>
              {insumosTiposUnidade.map((tipo) => (
                <SelectItem key={tipo} value={tipo}>
                  {tipo}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div>
          <div className="mb-1 text-xs text-blue-200/70">Preço custo</div>
          <Input value={createPrecoCusto} onChange={(e) => onCreatePrecoCustoChange(e.target.value)} placeholder="R$ 0,00" />
        </div>
        <div>
          <div className="mb-1 text-xs text-blue-200/70">Estoque inicial ({unitLabel(unit)})</div>
          <Input value={createEstoqueInicial} onChange={(e) => onCreateEstoqueInicialChange(e.target.value)} type="number" min={0} />
        </div>
        <div>
          <div className="mb-1 text-xs text-blue-200/70">Estoque mínimo</div>
          <Input value={createEstoqueMinimo} onChange={(e) => onCreateEstoqueMinimoChange(e.target.value)} type="number" min={0} />
        </div>
        <div>
          <div className="mb-1 flex items-center justify-between gap-2">
            <div className="text-xs text-blue-200/70">Lote</div>
            <Button variant={createNovoLote ? 'secondary' : 'outline'} size="sm" type="button" onClick={onToggleCreateNovoLote} title="Ative quando estiver cadastrando um lote adicional para um código já existente.">
              {createNovoLote ? 'Novo lote: on' : 'Novo lote: off'}
            </Button>
          </div>
          <Input value={createLote} onChange={(e) => onCreateLoteChange(e.target.value)} placeholder={createNovoLote ? 'obrigatório (ex: L2026-01)' : 'opcional'} />
        </div>
        <div>
          <div className="mb-1 text-xs text-blue-200/70">Validade</div>
          <BrDatePickerInput value={createDataValidade} onChange={onCreateDataValidadeChange} placeholder="DD/MM/AA" ariaLabel="Validade" />
        </div>
      </div>

      {createScanOpen ? <InsumosBarcodeScannerInline onDetected={onCreateBarcodeDetected} onClose={onCloseCreateScan} /> : null}
      <details
        open={optionalDetailsOpen}
        onToggle={(event) => onOptionalDetailsToggle((event.currentTarget as HTMLDetailsElement).open)}
        className="rounded-lg border border-white/10 bg-black/10 p-3"
      >
        <summary className="cursor-pointer select-none text-sm text-blue-100/80">Detalhes (opcional)</summary>
        <div className="mt-3 grid grid-cols-1 gap-2 md:grid-cols-3">
          <div className="md:col-span-2">
            <div className="mb-1 text-xs text-blue-200/70">Especificação / Modelo</div>
            <Input value={createEspecificacao} onChange={(e) => onCreateEspecificacaoChange(e.target.value)} placeholder="ex: Base, Lidocaine" />
          </div>
          <div>
            <div className="mb-1 text-xs text-blue-200/70">Concentração</div>
            <Input value={createConcentracao} onChange={(e) => onCreateConcentracaoChange(e.target.value)} placeholder="ex: 300U" />
          </div>
          <div>
            <div className="mb-1 text-xs text-blue-200/70">Volume</div>
            <Input value={createVolume} onChange={(e) => onCreateVolumeChange(e.target.value)} placeholder="ex: 1ml" />
          </div>
          <div>
            <div className="mb-1 text-xs text-blue-200/70">Calibre / Bitola</div>
            <Input value={createCalibre} onChange={(e) => onCreateCalibreChange(e.target.value)} placeholder="ex: 30G" />
          </div>
          <div className="md:col-span-2">
            <div className="mb-1 text-xs text-blue-200/70">Homologado</div>
            <label className="flex select-none items-center gap-2 text-sm text-blue-100/80">
              <Checkbox checked={createHomologado} onCheckedChange={(value) => onCreateHomologadoChange(!!value)} />
              Produto homologado
            </label>
          </div>
        </div>
      </details>
      <div className="flex items-center justify-between gap-2">
        <div className="text-xs text-blue-200/60">{hint}</div>
        <div className="flex items-center gap-2">
          <Button variant="secondary" onClick={onCancelCreate}>
            Cancelar
          </Button>
          <Button onClick={onSaveCreate} disabled={createLoading || !isAuthed}>
            {createLoading ? 'Salvando…' : 'Salvar'}
          </Button>
        </div>
      </div>
    </div>
  )
}

type InsumosInventoryWorkspaceTableProps = {
  items: Insumo[]
  unit: string
  unitLabel: (unit: string) => string
  selectedBarcode: string
  isAuthed: boolean
  listContainerRef: React.RefObject<HTMLDivElement | null>
  onListScroll: (event: React.UIEvent<HTMLDivElement>) => void
  onSelectBarcode: (barcode: string) => void
  onEditItem: (item: Insumo) => void
  onUseItem: (item: Insumo) => void
  emptyContent: React.ReactNode
}

export function InsumosInventoryWorkspaceTable({
  items,
  unit,
  unitLabel,
  selectedBarcode,
  isAuthed,
  listContainerRef,
  onListScroll,
  onSelectBarcode,
  onEditItem,
  onUseItem,
  emptyContent,
}: InsumosInventoryWorkspaceTableProps) {
  return (
    <div ref={listContainerRef as React.RefObject<HTMLDivElement>} onScroll={onListScroll} className="max-h-[70vh] overflow-auto rounded-xl border border-white/10">
      <table className="w-full table-fixed text-sm">
        <thead className="bg-black/30 text-blue-100/80">
          <tr>
            <th className="w-[28%] p-3 text-left">Produto</th>
            <th className="w-[16%] p-3 text-left">Categoria</th>
            <th className="hidden w-[16%] p-3 text-left lg:table-cell">Código</th>
            <th className="w-[7%] p-3 text-right">Estoque</th>
            <th className="w-[7%] p-3 text-right">Mín</th>
            <th className="hidden w-[10%] p-3 text-left md:table-cell">Validade</th>
            <th className="hidden w-[8%] p-3 text-right xl:table-cell">Valor</th>
            <th className="w-[8%] p-3 text-right">Ações</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-white/5">
          {items.map((item) => {
            const codigoBarras = String(item.codigoBarras || '').trim()
            const isSelected = !!codigoBarras && selectedBarcode.trim() === codigoBarras
            const estoque = Number(item.estoqueAtual) || 0
            const min = Number(item.estoqueMinimo) || 0
            const stockStatus = calcularStatusEstoque(estoque, min)
            const isCritico = stockStatus === 'URGENTE'
            const isLowStock = stockStatus === 'ATENCAO'
            const validadeStatus = String(item.statusValidade?.status || '').toUpperCase()
            const isVencendo = validadeStatus === 'VENCENDO'
            const isExpirado = validadeStatus === 'EXPIRADO'
            const valor = (Number(item.precoCusto) || 0) * estoque
            const otherStocks = item.estoques
              ? Object.entries(item.estoques)
                  .filter(([u, v]) => u !== unit && (Number(v) || 0) > 0)
                  .sort((a, b) => (Number(b[1]) || 0) - (Number(a[1]) || 0))
              : []
            const otherSummary = otherStocks.length
              ? `${otherStocks
                  .slice(0, 2)
                  .map(([u, v]) => `${unitLabel(u)}: ${Number(v) || 0}`)
                  .join(' • ')}${otherStocks.length > 2 ? ` • +${otherStocks.length - 2}` : ''}`
              : ''
            return (
              <tr key={`${item.registro || ''}-${item.codigoBarras || ''}`} className={isSelected ? 'bg-white/5 hover:bg-white/10' : 'hover:bg-white/5'}>
                <td className="min-w-0 p-3 align-top">
                  <button
                    type="button"
                    className="group w-full cursor-pointer rounded-sm text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-300/40"
                    onClick={() => {
                      if (!codigoBarras) return
                      onSelectBarcode(codigoBarras)
                    }}
                    title={codigoBarras ? 'Ver movimentações deste insumo' : undefined}
                    aria-pressed={isSelected}
                  >
                    <div className="flex min-w-0 items-center justify-between gap-2">
                      <div className="line-clamp-2 break-words text-blue-50 group-hover:underline">{item.produto || '-'}</div>
                      {isSelected ? <div className="text-xs text-blue-200/60">Filtrando</div> : null}
                    </div>
                    {item.marca ? (
                      <div className="mt-1 flex flex-wrap gap-1">
                        <Badge style={buildTagStyle(getMarcaBgColor(String(item.marca)))} className="border">
                          {String(item.marca)}
                        </Badge>
                      </div>
                    ) : null}
                    {isCritico || isLowStock || isVencendo || isExpirado ? (
                      <div className="mt-1 flex flex-wrap gap-1">
                        {isCritico ? <Badge variant="destructive">Crítico</Badge> : null}
                        {isLowStock ? <Badge variant="secondary">Atenção</Badge> : null}
                        {isVencendo ? <Badge variant="secondary">Vencendo</Badge> : null}
                        {isExpirado ? <Badge variant="destructive">Expirado</Badge> : null}
                      </div>
                    ) : null}
                  </button>
                </td>
                <td className="p-3 align-top text-blue-100/80">
                  <div className="flex min-w-0 items-center gap-2">
                    <Badge style={buildTagStyle(getCategoriaBgColor(item.categoria || 'Outros'))} className="border">
                      {item.categoria || '-'}
                    </Badge>
                  </div>
                </td>
                <td className="hidden p-3 align-top lg:table-cell">
                  <div className="break-all font-mono text-blue-100/80">{item.codigoBarras || '-'}</div>
                </td>
                <td className={`p-3 align-top text-right ${isCritico ? 'text-red-200' : 'text-blue-100/80'}`}>
                  <div className="flex items-center justify-end gap-2">
                    <span className="font-mono">{estoque}</span>
                  </div>
                  {otherSummary ? <div className="mt-1 text-[11px] text-blue-200/50">{otherSummary}</div> : null}
                </td>
                <td className="p-3 align-top text-right text-blue-100/70">{min || '-'}</td>
                <td className="hidden p-3 align-top text-blue-100/70 md:table-cell">
                  <span>{fmtDateOnlyBR(item.dataValidade || '')}</span>
                </td>
                <td className="hidden p-3 align-top text-right text-blue-100/80 xl:table-cell">{fmtMoneyBRL(valor)}</td>
                <td className="p-3 align-top text-right">
                  <div className="flex items-center justify-end gap-2">
                    <Button variant="secondary" className="h-8 px-2 text-xs" onClick={() => onUseItem(item)}>
                      Usar
                    </Button>
                    <Button variant="outline" className="h-8 px-2 text-xs" onClick={() => onEditItem(item)} disabled={!isAuthed}>
                      Editar
                    </Button>
                  </div>
                </td>
              </tr>
            )
          })}
          {!items.length ? (
            <tr>
              <td className="p-3 text-blue-100/70" colSpan={8}>
                {emptyContent}
              </td>
            </tr>
          ) : null}
        </tbody>
      </table>
    </div>
  )
}

type InsumosEditValidationKey =
  | 'codigoBarras'
  | 'produto'
  | 'categoria'
  | 'marca'
  | 'tipoUnidade'
  | 'lote'
  | 'dataValidade'
  | 'policy'

type InsumosEditValidationErrors = Partial<Record<InsumosEditValidationKey, string>>

type InsumosEditDialogProps = {
  open: boolean
  dialogClassName: string
  target: Insumo | null
  isAuthed: boolean
  canUseApi: boolean
  isManagerRole: boolean
  saving: boolean
  saveError: string | null
  validationErrors: InsumosEditValidationErrors
  codigo: string
  codigosExtras: string
  produto: string
  categoria: string
  categoriaRequiresLot: boolean
  categoriaRequiresExpiry: boolean
  categoriaFefo: boolean
  marca: string
  tipoUnidade: string
  especificacao: string
  concentracao: string
  volume: string
  homologado: boolean
  calibre: string
  precoCusto: string
  estoqueMinimo: string
  lote: string
  dataValidade: string
  optionalDetailsOpen: boolean
  lotCategorias: string[]
  insumosMarcas: string[]
  insumosTiposUnidade: string[]
  onOpenChange: (open: boolean) => void
  onClearValidationError: (key: InsumosEditValidationKey) => void
  onCodigoChange: (value: string) => void
  onCodigosExtrasChange: (value: string) => void
  onProdutoChange: (value: string) => void
  onCategoriaChange: (value: string) => void
  onCategoriaRequiresLotChange: (value: boolean) => void
  onCategoriaRequiresExpiryChange: (value: boolean) => void
  onCategoriaFefoChange: (value: boolean) => void
  onMarcaChange: (value: string) => void
  onTipoUnidadeChange: (value: string) => void
  onEspecificacaoChange: (value: string) => void
  onConcentracaoChange: (value: string) => void
  onVolumeChange: (value: string) => void
  onHomologadoChange: (value: boolean) => void
  onCalibreChange: (value: string) => void
  onPrecoCustoChange: (value: string) => void
  onEstoqueMinimoChange: (value: string) => void
  onLoteChange: (value: string) => void
  onDataValidadeChange: (value: string) => void
  onOptionalDetailsToggle: (open: boolean) => void
  onCancel: () => void
  onDelete: () => void
  onSave: () => void
}

export function InsumosEditDialog({
  open,
  dialogClassName,
  target,
  isAuthed,
  canUseApi,
  isManagerRole,
  saving,
  saveError,
  validationErrors,
  codigo,
  codigosExtras,
  produto,
  categoria,
  categoriaRequiresLot,
  categoriaRequiresExpiry,
  categoriaFefo,
  marca,
  tipoUnidade,
  especificacao,
  concentracao,
  volume,
  homologado,
  calibre,
  precoCusto,
  estoqueMinimo,
  lote,
  dataValidade,
  optionalDetailsOpen,
  lotCategorias,
  insumosMarcas,
  insumosTiposUnidade,
  onOpenChange,
  onClearValidationError,
  onCodigoChange,
  onCodigosExtrasChange,
  onProdutoChange,
  onCategoriaChange,
  onCategoriaRequiresLotChange,
  onCategoriaRequiresExpiryChange,
  onCategoriaFefoChange,
  onMarcaChange,
  onTipoUnidadeChange,
  onEspecificacaoChange,
  onConcentracaoChange,
  onVolumeChange,
  onHomologadoChange,
  onCalibreChange,
  onPrecoCustoChange,
  onEstoqueMinimoChange,
  onLoteChange,
  onDataValidadeChange,
  onOptionalDetailsToggle,
  onCancel,
  onDelete,
  onSave,
}: InsumosEditDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className={dialogClassName}>
        <DialogHeader>
          <DialogTitle>Editar insumo</DialogTitle>
          <DialogDescription className="break-words">
            {target?.produto || '-'} • <span className="font-mono break-all">{target?.codigoBarras || '-'}</span>
            {target?.registro ? <span className="break-all"> • Reg {target.registro}</span> : null}
          </DialogDescription>
        </DialogHeader>

        {saveError ? <div className="mt-2 rounded-lg border border-red-500/40 bg-red-500/10 p-2 text-sm text-red-100">{saveError}</div> : null}

        <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
          <div>
            <div className="mb-1 text-xs text-muted-foreground">Código de barras</div>
            <Input
              value={codigo}
              onChange={(event) => {
                onCodigoChange(event.target.value)
                onClearValidationError('codigoBarras')
              }}
              placeholder="789..."
              aria-invalid={validationErrors.codigoBarras ? true : undefined}
              className={validationErrors.codigoBarras ? 'border-red-500/60 focus:border-red-500/60 focus:ring-red-500/25' : undefined}
            />
            {validationErrors.codigoBarras ? <div className="mt-1 text-xs text-red-300">{validationErrors.codigoBarras}</div> : null}
          </div>
          <div className="md:col-span-2">
            <div className="mb-1 text-xs text-muted-foreground">Códigos adicionais</div>
            <Textarea
              value={codigosExtras}
              onChange={(event) => onCodigosExtrasChange(event.target.value)}
              placeholder="um por linha"
              rows={3}
              className="border-white/20 bg-white/[0.06] text-white"
            />
            <div className="mt-1 text-[10px] text-muted-foreground">Opcional. Use para variações de código do mesmo produto.</div>
          </div>
          <div className="md:col-span-2">
            <div className="mb-1 text-xs text-muted-foreground">Produto</div>
            <Input
              value={produto}
              onChange={(event) => {
                onProdutoChange(event.target.value)
                onClearValidationError('produto')
              }}
              placeholder="Nome do produto"
              aria-invalid={validationErrors.produto ? true : undefined}
              className={validationErrors.produto ? 'border-red-500/60 focus:border-red-500/60 focus:ring-red-500/25' : undefined}
            />
            {validationErrors.produto ? <div className="mt-1 text-xs text-red-300">{validationErrors.produto}</div> : null}
          </div>
          <div>
            <div className="mb-1 text-xs text-muted-foreground">Categoria</div>
            <AutocompleteInput
              value={categoria}
              onValueChange={(value) => {
                onCategoriaChange(value)
                onClearValidationError('categoria')
              }}
              placeholder="ex: toxina"
              options={lotCategorias}
              inputTestId="insumos-edit-categoria"
              ariaInvalid={validationErrors.categoria ? true : undefined}
              inputClassName={validationErrors.categoria ? 'border-red-500/60 focus:border-red-500/60 focus:ring-red-500/25' : undefined}
            />
            {validationErrors.categoria ? <div className="mt-1 text-xs text-red-300">{validationErrors.categoria}</div> : null}
          </div>
          <div className={`rounded-xl border p-3 md:col-span-2 ${validationErrors.policy ? 'border-red-500/50 bg-red-500/5' : 'border-white/10 bg-black/10'}`}>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="text-xs text-muted-foreground">Política do item</div>
              <div className="text-xs text-muted-foreground">Defina as regras para este insumo.</div>
            </div>
            <div className="mt-2 flex flex-wrap items-center gap-4 text-sm text-blue-100/80">
              <label className={`flex select-none items-center gap-2 ${isManagerRole ? 'cursor-pointer' : 'cursor-default'}`}>
                <Checkbox
                  checked={categoriaRequiresLot}
                  onCheckedChange={(value) => {
                    onCategoriaRequiresLotChange(!!value)
                    onClearValidationError('policy')
                    onClearValidationError('lote')
                  }}
                  disabled={!isManagerRole}
                />
                Lote obrigatório
              </label>
              <label className={`flex select-none items-center gap-2 ${isManagerRole ? 'cursor-pointer' : 'cursor-default'}`}>
                <Checkbox
                  checked={categoriaRequiresExpiry}
                  onCheckedChange={(value) => {
                    onCategoriaRequiresExpiryChange(!!value)
                    onClearValidationError('policy')
                    onClearValidationError('dataValidade')
                  }}
                  disabled={!isManagerRole}
                />
                Validade obrigatória
              </label>
              <label className={`flex select-none items-center gap-2 ${isManagerRole ? 'cursor-pointer' : 'cursor-default'}`}>
                <Checkbox
                  checked={categoriaFefo}
                  onCheckedChange={(value) => {
                    onCategoriaFefoChange(!!value)
                    onClearValidationError('policy')
                  }}
                  disabled={!isManagerRole}
                />
                FEFO
              </label>
              {!isManagerRole ? <span className="text-xs text-muted-foreground">Somente gestores alteram.</span> : null}
            </div>
            {validationErrors.policy ? <div className="mt-2 text-xs text-red-300">{validationErrors.policy}</div> : null}
          </div>
          <div>
            <div className="mb-1 text-xs text-muted-foreground">Marca</div>
            <AutocompleteInput
              value={marca}
              onValueChange={(value) => {
                onMarcaChange(value)
                onClearValidationError('marca')
              }}
              placeholder="ex: Allergan"
              options={insumosMarcas}
              inputTestId="insumos-edit-marca"
              ariaInvalid={validationErrors.marca ? true : undefined}
              inputClassName={validationErrors.marca ? 'border-red-500/60 focus:border-red-500/60 focus:ring-red-500/25' : undefined}
            />
            {validationErrors.marca ? <div className="mt-1 text-xs text-red-300">{validationErrors.marca}</div> : null}
          </div>
          <div>
            <div className="mb-1 text-xs text-muted-foreground">Unidade (medida)</div>
            <Select
              value={normalizeTipoUnidadeToCanonical(tipoUnidade) || undefined}
              onValueChange={(value) => {
                onTipoUnidadeChange(value)
                onClearValidationError('tipoUnidade')
              }}
            >
              <SelectTrigger aria-invalid={validationErrors.tipoUnidade ? true : undefined} className={validationErrors.tipoUnidade ? 'border-red-500/60 ring-2 ring-red-500/15' : undefined}>
                <SelectValue placeholder="Selecione a unidade" />
              </SelectTrigger>
              <SelectContent>
                {insumosTiposUnidade.map((tipo) => (
                  <SelectItem key={tipo} value={tipo}>
                    {tipo}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {validationErrors.tipoUnidade ? <div className="mt-1 text-xs text-red-300">{validationErrors.tipoUnidade}</div> : null}
          </div>
          <div>
            <div className="mb-1 text-xs text-muted-foreground">Preço custo (R$)</div>
            <Input value={precoCusto} onChange={(event) => onPrecoCustoChange(event.target.value)} placeholder="ex: 120,00" />
          </div>
          <div>
            <div className="mb-1 text-xs text-muted-foreground">Estoque mínimo</div>
            <Input value={estoqueMinimo} onChange={(event) => onEstoqueMinimoChange(event.target.value)} placeholder="ex: 5" />
          </div>
          <div>
            <div className="mb-1 text-xs text-muted-foreground">Lote</div>
            <Input
              value={lote}
              onChange={(event) => {
                onLoteChange(event.target.value)
                onClearValidationError('lote')
              }}
              placeholder="ex: L2026-01"
              aria-invalid={validationErrors.lote ? true : undefined}
              className={validationErrors.lote ? 'border-red-500/60 focus:border-red-500/60 focus:ring-red-500/25' : undefined}
            />
            {validationErrors.lote ? <div className="mt-1 text-xs text-red-300">{validationErrors.lote}</div> : null}
          </div>
          <div>
            <div className="mb-1 text-xs text-muted-foreground">Validade</div>
            <BrDatePickerInput
              value={dataValidade}
              onChange={(value) => {
                onDataValidadeChange(value)
                onClearValidationError('dataValidade')
              }}
              placeholder="DD/MM/AA"
              ariaLabel="Validade"
              className={validationErrors.dataValidade ? 'border-red-500/60 focus:border-red-500/60 focus:ring-red-500/25' : undefined}
            />
            {validationErrors.dataValidade ? <div className="mt-1 text-xs text-red-300">{validationErrors.dataValidade}</div> : null}
          </div>
        </div>

        <details
          open={optionalDetailsOpen}
          onToggle={(event) => onOptionalDetailsToggle((event.currentTarget as HTMLDetailsElement).open)}
          className="mt-2 rounded-lg border border-white/10 bg-black/10 p-3"
        >
          <summary className="cursor-pointer select-none text-sm text-blue-100/80">Detalhes (opcional)</summary>
          <div className="mt-3 grid grid-cols-1 gap-2 md:grid-cols-3">
            <div className="md:col-span-2">
              <div className="mb-1 text-xs text-muted-foreground">Especificação / Modelo</div>
              <Input value={especificacao} onChange={(event) => onEspecificacaoChange(event.target.value)} placeholder="ex: Base, Lidocaine" />
            </div>
            <div>
              <div className="mb-1 text-xs text-muted-foreground">Concentração</div>
              <Input value={concentracao} onChange={(event) => onConcentracaoChange(event.target.value)} placeholder="ex: 300U" />
            </div>
            <div>
              <div className="mb-1 text-xs text-muted-foreground">Volume</div>
              <Input value={volume} onChange={(event) => onVolumeChange(event.target.value)} placeholder="ex: 1ml" />
            </div>
            <div>
              <div className="mb-1 text-xs text-muted-foreground">Calibre / Bitola</div>
              <Input value={calibre} onChange={(event) => onCalibreChange(event.target.value)} placeholder="ex: 30G" />
            </div>
            <div className="md:col-span-2">
              <div className="mb-1 text-xs text-muted-foreground">Homologado</div>
              <label className="flex select-none items-center gap-2 text-sm text-blue-100/80">
                <Checkbox checked={homologado} onCheckedChange={(value) => onHomologadoChange(!!value)} />
                Produto homologado
              </label>
            </div>
          </div>
        </details>

        <DialogFooter>
          {!canUseApi ? <span className="mr-auto text-xs text-muted-foreground">API indisponivel. Aguarde o carregamento.</span> : null}
          <Button variant="secondary" onClick={onCancel} disabled={saving}>
            Cancelar
          </Button>
          <Button variant="destructive" onClick={onDelete} disabled={saving || !isAuthed}>
            Excluir
          </Button>
          <Button onClick={onSave} disabled={saving || !isAuthed || !canUseApi}>
            {saving ? 'Salvando…' : 'Salvar'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

type InsumosCategoryPoliciesPanelProps = {
  panelOpen: boolean
  isAuthed: boolean
  policyFormLabel: string
  policyFormSlug: string
  policyFormSlugPlaceholder: string
  policyFormSuggestion: string
  policyFormEditingSlug: string | null
  policyFormRequiresLot: boolean
  policyFormRequiresExpiry: boolean
  policyFormFefo: boolean
  adminCategorySuggestions: CategoryPolicySuggestion[]
  adminCategoryPolicies: CategoryPolicy[]
  adminCategoryPoliciesLoading: boolean
  dragHandleProps?: React.HTMLAttributes<HTMLDivElement>
  onToggleOpen: () => void
  onPolicyFormLabelChange: (value: string) => void
  onPolicyFormSlugChange: (value: string) => void
  onPolicyFormSuggestionChange: (value: string) => void
  onPolicyFormRequiresLotChange: (value: boolean) => void
  onPolicyFormRequiresExpiryChange: (value: boolean) => void
  onPolicyFormFefoChange: (value: boolean) => void
  onResetPolicyForm: () => void
  onSaveCategoryPolicy: () => void
  onStartEditPolicyForm: (policy: CategoryPolicy) => void
  onDeleteCategoryPolicy: (slug: string) => void
}

export function InsumosCategoryPoliciesPanel({
  panelOpen,
  isAuthed,
  policyFormLabel,
  policyFormSlug,
  policyFormSlugPlaceholder,
  policyFormSuggestion,
  policyFormEditingSlug,
  policyFormRequiresLot,
  policyFormRequiresExpiry,
  policyFormFefo,
  adminCategorySuggestions,
  adminCategoryPolicies,
  adminCategoryPoliciesLoading,
  dragHandleProps,
  onToggleOpen,
  onPolicyFormLabelChange,
  onPolicyFormSlugChange,
  onPolicyFormSuggestionChange,
  onPolicyFormRequiresLotChange,
  onPolicyFormRequiresExpiryChange,
  onPolicyFormFefoChange,
  onResetPolicyForm,
  onSaveCategoryPolicy,
  onStartEditPolicyForm,
  onDeleteCategoryPolicy,
}: InsumosCategoryPoliciesPanelProps) {
  return (
    <Card className="border border-white/10 bg-black/20">
      <CardHeader className="relative pr-24">
        <CardTitle className="text-base text-white">Políticas por categoria</CardTitle>
        <div className="absolute right-2 top-2 flex items-center gap-1">
          <div
            {...dragHandleProps}
            className="flex h-9 w-9 cursor-grab items-center justify-center rounded-md bg-transparent text-white hover:bg-white/[0.10] active:cursor-grabbing"
            title="Arraste para mover"
            aria-label="Mover"
            role="button"
            tabIndex={0}
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden>
              <path d="M9 6h.01M15 6h.01M9 12h.01M15 12h.01M9 18h.01M15 18h.01" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
            </svg>
          </div>
          <Button
            size="icon"
            variant="ghost"
            className="h-9 w-9 bg-transparent text-white hover:bg-white/[0.10]"
            onClick={onToggleOpen}
            title={panelOpen ? 'Contrair' : 'Expandir'}
            aria-label={panelOpen ? 'Contrair' : 'Expandir'}
          >
            {panelOpen ? (
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden>
                <path d="M6 15l6-6 6 6" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            ) : (
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden>
                <path d="M6 9l6 6 6-6" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            )}
          </Button>
        </div>
      </CardHeader>
      {panelOpen ? (
        <CardContent className="space-y-3">
          <div className="text-xs text-blue-200/60">
            Configure quais categorias exigem <span className="font-medium text-blue-100/80">lote</span> e/ou <span className="font-medium text-blue-100/80">validade</span>, e habilite <span className="font-medium text-blue-100/80">FEFO</span> quando aplicável.
          </div>

          <div className="space-y-3 rounded-xl border border-white/10 bg-black/10 p-3">
            <div className="grid grid-cols-1 items-end gap-2 md:grid-cols-3">
              <div className="md:col-span-2">
                <div className="mb-1 text-xs text-blue-200/70">Categoria (nome)</div>
                <Input value={policyFormLabel} onChange={(event) => onPolicyFormLabelChange(event.target.value)} placeholder="Ex: Toxina botulínica" disabled={!isAuthed} />
              </div>
              <div>
                <div className="mb-1 text-xs text-blue-200/70">Slug (opcional)</div>
                <Input value={policyFormSlug} onChange={(event) => onPolicyFormSlugChange(event.target.value)} placeholder={policyFormSlugPlaceholder} disabled={!isAuthed} />
              </div>
            </div>

            {adminCategorySuggestions.length ? (
              <div className="grid grid-cols-1 items-end gap-2 md:grid-cols-3">
                <div className="md:col-span-2">
                  <div className="mb-1 text-xs text-blue-200/70">Sugestões (já usadas em itens)</div>
                  <Select value={policyFormSuggestion} onValueChange={onPolicyFormSuggestionChange}>
                    <SelectTrigger>
                      <SelectValue placeholder="Escolher…" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__NONE__">(nenhuma)</SelectItem>
                      {adminCategorySuggestions.map((suggestion) => (
                        <SelectItem key={suggestion.slug} value={suggestion.slug}>
                          {suggestion.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="text-xs text-blue-200/60">
                  {policyFormEditingSlug ? <Badge variant="secondary">Editando: {policyFormEditingSlug}</Badge> : <Badge variant="secondary">Nova política</Badge>}
                </div>
              </div>
            ) : policyFormEditingSlug ? (
              <div className="text-xs text-blue-200/60">
                <Badge variant="secondary">Editando: {policyFormEditingSlug}</Badge>
              </div>
            ) : null}

            <div className="flex flex-wrap gap-4">
              <div className="flex items-center gap-2">
                <Checkbox id="policy-requires-lot" checked={policyFormRequiresLot} onCheckedChange={(checked) => onPolicyFormRequiresLotChange(!!checked)} />
                <label htmlFor="policy-requires-lot" className="cursor-pointer text-sm text-blue-100/80">
                  Lote obrigatório
                </label>
              </div>
              <div className="flex items-center gap-2">
                <Checkbox id="policy-requires-expiry" checked={policyFormRequiresExpiry} onCheckedChange={(checked) => onPolicyFormRequiresExpiryChange(!!checked)} />
                <label htmlFor="policy-requires-expiry" className="cursor-pointer text-sm text-blue-100/80">
                  Validade obrigatória
                </label>
              </div>
              <div className="flex items-center gap-2">
                <Checkbox id="policy-fefo" checked={policyFormFefo} onCheckedChange={(checked) => onPolicyFormFefoChange(!!checked)} />
                <label htmlFor="policy-fefo" className="cursor-pointer text-sm text-blue-100/80">
                  FEFO (sugere lote por validade)
                </label>
              </div>
            </div>

            <div className="flex items-center justify-between gap-2">
              <Button variant="outline" onClick={onResetPolicyForm} disabled={!isAuthed}>
                Limpar
              </Button>
              <Button className="!bg-blue-600 !text-white hover:!bg-blue-700" onClick={onSaveCategoryPolicy} disabled={!isAuthed}>
                {policyFormEditingSlug ? 'Salvar alterações' : 'Criar política'}
              </Button>
            </div>
          </div>

          <div className="overflow-auto rounded-xl border border-white/10">
            <table className="min-w-full text-sm">
              <thead className="bg-black/30 text-blue-100/80">
                <tr>
                  <th className="w-[34%] p-3 text-left">Categoria</th>
                  <th className="w-[46%] p-3 text-left">Regras</th>
                  <th className="w-[20%] p-3 text-right">Ações</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/5">
                {adminCategoryPolicies.map((policy) => (
                  <tr key={policy.slug} className="hover:bg-white/5">
                    <td className="p-3 text-blue-50">
                      <div className="text-blue-50">{policy.label || policy.slug}</div>
                      <div className="font-mono text-xs text-blue-200/60">{policy.slug}</div>
                    </td>
                    <td className="p-3">
                      <div className="flex flex-wrap gap-2">
                        {policy.requiresLot ? <Badge variant="secondary">lote</Badge> : <Badge variant="secondary">lote opcional</Badge>}
                        {policy.requiresExpiry ? <Badge variant="secondary">validade</Badge> : <Badge variant="secondary">validade opcional</Badge>}
                        {policy.fefo ? <Badge>FEFO</Badge> : <Badge variant="secondary">sem FEFO</Badge>}
                      </div>
                    </td>
                    <td className="p-3 text-right">
                      <div className="flex justify-end gap-2">
                        <Button variant="outline" className="h-8 px-2" onClick={() => onStartEditPolicyForm(policy)}>
                          Editar
                        </Button>
                        <Button variant="destructive" className="h-8 px-2" onClick={() => onDeleteCategoryPolicy(policy.slug)}>
                          Remover
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))}
                {!adminCategoryPoliciesLoading && !adminCategoryPolicies.length ? (
                  <tr>
                    <td className="p-3 text-blue-100/70" colSpan={3}>
                      Sem políticas cadastradas.
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </CardContent>
      ) : null}
    </Card>
  )
}

type AlertasStatusFilter = 'TODOS' | 'ATENCAO' | 'URGENTE' | 'VENCENDO' | 'EXPIRADO' | 'INFO'
type AlertasFluxoFilter = 'TODOS' | 'ENTRADA' | 'SAIDA' | 'DESCARTE' | 'TRANSFERENCIA'
type AlertasSortKey = 'produto' | 'categoria' | 'status' | 'acao' | 'atual' | 'min' | 'dif' | 'percentual'

type AlertasLinha = {
  key: string
  codigoBarras?: string
  produto?: string
  categoria?: string
  marca?: string
  qualityIssue?: QualityIssue
  qualityMessage?: string
  qualitySeverity?: string
  estoqueAtual?: number
  estoqueMinimo?: number
  diferenca?: number
  percentual?: number | null
  dataValidade?: string | null
  dias?: number | null
  tags: AlertaStatusTag[]
}

type AlertasRecommendation =
  | { kind: 'TRANSFERENCIA'; fromUnidade?: string | null; toUnidade?: string | null; qty?: number | null }
  | { kind: 'ENTRADA'; qty?: number | null }

type InsumosAlertsPanelProps = {
  panelOpen: boolean
  dragHandleProps?: Record<string, any>
  showOverviewLoadingProgress: boolean
  loadingPercent: number
  overviewCriticosCount: number | null
  overviewAtencaoCount: number | null
  alertasStatus: AlertasStatusFilter
  alertasCategoria: string
  alertasFluxo: AlertasFluxoFilter
  alertasBusca: string
  alertasCategorias: string[]
  alertasSortKey: AlertasSortKey
  alertasSortDir: 'asc' | 'desc'
  rows: AlertasLinha[]
  recommendationByCode: Map<string, AlertasRecommendation>
  purchaseDisabled: boolean
  isAuthed: boolean
  emptyContent: React.ReactNode
  onToggleOpen: () => void
  onOpenPurchaseDialog: () => void
  onAlertasStatusChange: (value: AlertasStatusFilter) => void
  onAlertasCategoriaChange: (value: string) => void
  onAlertasFluxoChange: (value: AlertasFluxoFilter) => void
  onAlertasBuscaChange: (value: string) => void
  onSortChange: (key: AlertasSortKey) => void
  onSelectBarcode: (code: string) => void
  onToggleMarcaFilter: (value: string) => void
  onToggleCategoriaFilter: (value: string) => void
  onToggleStatusFilter: (value: AlertaStatusTag) => void
  onOpenQuickOperation: (
    op: InsumosQuickOperation,
    prefill?: { codigoBarras?: string | null; quantidade?: number | string | null; obs?: string | null; fromUnidade?: string | null; toUnidade?: string | null }
  ) => void
  onOpenQualityFix: (issue: QualityIssue) => void
}

export function InsumosAlertsPanel({
  panelOpen,
  dragHandleProps,
  showOverviewLoadingProgress,
  loadingPercent,
  overviewCriticosCount,
  overviewAtencaoCount,
  alertasStatus,
  alertasCategoria,
  alertasFluxo,
  alertasBusca,
  alertasCategorias,
  alertasSortKey,
  alertasSortDir,
  rows,
  recommendationByCode,
  purchaseDisabled,
  isAuthed,
  emptyContent,
  onToggleOpen,
  onOpenPurchaseDialog,
  onAlertasStatusChange,
  onAlertasCategoriaChange,
  onAlertasFluxoChange,
  onAlertasBuscaChange,
  onSortChange,
  onSelectBarcode,
  onToggleMarcaFilter,
  onToggleCategoriaFilter,
  onToggleStatusFilter,
  onOpenQuickOperation,
  onOpenQualityFix,
}: InsumosAlertsPanelProps) {
  const columns: Array<{ key: AlertasSortKey; label: string; align: string; widthClass?: string }> = [
    { key: 'produto', label: 'Produto', align: 'text-left', widthClass: 'w-[24%]' },
    { key: 'categoria', label: 'Categoria', align: 'text-left', widthClass: 'w-[14%]' },
    { key: 'status', label: 'Status', align: 'text-left', widthClass: 'w-[14%]' },
    { key: 'acao', label: 'Ação recomendada', align: 'text-left', widthClass: 'w-[20%]' },
    { key: 'atual', label: 'Atual', align: 'text-right', widthClass: 'w-[8%]' },
    { key: 'min', label: 'Mín', align: 'text-right hidden sm:table-cell', widthClass: 'w-[6%]' },
    { key: 'dif', label: 'Dif', align: 'text-right hidden lg:table-cell', widthClass: 'w-[7%]' },
    { key: 'percentual', label: '%', align: 'text-right hidden lg:table-cell', widthClass: 'w-[7%]' },
  ]

  return (
    <Card className="border border-white/10 bg-black/20">
      <CardHeader className="flex flex-col gap-2">
        <div className="flex min-w-0 w-full flex-col gap-2 md:flex-row md:items-center md:gap-3">
          <div className="flex min-w-0 items-center gap-3">
            <button
              type="button"
              {...dragHandleProps}
              className="mt-0.5 flex h-9 w-9 cursor-grab items-center justify-center rounded-md bg-transparent text-white hover:bg-white/[0.10] active:cursor-grabbing"
              title="Arraste para mover"
              aria-label="Mover"
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden>
                <path d="M9 6h.01M15 6h.01M9 12h.01M15 12h.01M9 18h.01M15 18h.01" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
              </svg>
            </button>
            <CardTitle className="text-base text-white">Avisos</CardTitle>
            <div className="hidden items-center gap-3 text-xs text-blue-200/70 sm:flex">
              <span className="inline-flex items-center gap-1">
                <span className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-red-500/40 text-red-50" title="Crítico" aria-label="Crítico">
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" aria-hidden>
                    <path d="M12 7v7" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />
                    <circle cx="12" cy="17" r="1.5" fill="currentColor" />
                  </svg>
                </span>
                <span className="font-mono text-blue-50">
                  {showOverviewLoadingProgress ? (
                    <span className="inline-flex items-center gap-2">
                      <span className="inline-flex h-3 w-3 animate-spin rounded-full border border-blue-200/70 border-t-transparent" />
                      {loadingPercent}%
                    </span>
                  ) : (
                    overviewCriticosCount ?? '-'
                  )}
                </span>
              </span>
              <span className="inline-flex items-center gap-1">
                <span className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-amber-500/35 text-amber-100" title="Atenção" aria-label="Atenção">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden>
                    <path d="M12 3l9 16H3l9-16z" fill="currentColor" fillOpacity="0.45" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" />
                    <path d="M12 9v5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                    <circle cx="12" cy="16.5" r="1.2" fill="currentColor" />
                  </svg>
                </span>
                <span className="font-mono text-blue-50">
                  {showOverviewLoadingProgress ? (
                    <span className="inline-flex items-center gap-2">
                      <span className="inline-flex h-3 w-3 animate-spin rounded-full border border-blue-200/70 border-t-transparent" />
                      {loadingPercent}%
                    </span>
                  ) : (
                    overviewAtencaoCount ?? '-'
                  )}
                </span>
              </span>
            </div>
          </div>
          <div className="ml-auto flex min-w-0 flex-1 flex-nowrap items-center justify-end gap-2 overflow-x-auto">
            <Select value={alertasStatus} onValueChange={(value) => onAlertasStatusChange(value as AlertasStatusFilter)}>
              <SelectTrigger className="h-8 w-24 shrink-0">
                <SelectValue placeholder="Status" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="TODOS">–</SelectItem>
                <SelectItem value="ATENCAO">Atenção</SelectItem>
                <SelectItem value="URGENTE">Crítico</SelectItem>
                <SelectItem value="INFO">Info</SelectItem>
              </SelectContent>
            </Select>
            <Select value={alertasCategoria || '__ALL__'} onValueChange={(value) => onAlertasCategoriaChange(value === '__ALL__' ? '' : String(value))}>
              <SelectTrigger className="h-8 w-36 shrink-0">
                <SelectValue placeholder="Categoria" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__ALL__">–</SelectItem>
                {alertasCategorias.map((categoria) => (
                  <SelectItem key={categoria} value={categoria}>
                    {categoria}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={alertasFluxo} onValueChange={(value) => onAlertasFluxoChange(value as AlertasFluxoFilter)}>
              <SelectTrigger className="h-8 w-28 shrink-0">
                <SelectValue placeholder="Fluxo" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="TODOS">–</SelectItem>
                <SelectItem value="ENTRADA">Entrada</SelectItem>
                <SelectItem value="SAIDA">Saída</SelectItem>
                <SelectItem value="DESCARTE">Descarte</SelectItem>
                <SelectItem value="TRANSFERENCIA">Transferência</SelectItem>
              </SelectContent>
            </Select>
            <Input value={alertasBusca} onChange={(event) => onAlertasBuscaChange(event.target.value)} placeholder="Buscar" className="ml-auto h-8 min-w-[120px] flex-1 md:min-w-0" />
            <div className="flex shrink-0 items-center gap-2">
              <Button
                size="icon"
                variant="ghost"
                className="h-9 w-9 bg-transparent text-white hover:bg-white/[0.10]"
                onClick={onOpenPurchaseDialog}
                disabled={purchaseDisabled}
                title="Lista de compra"
                aria-label="Lista de compra"
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden>
                  <path d="M3 4h2l2.4 11.2a2 2 0 0 0 2 1.6h7.6a2 2 0 0 0 2-1.6L21 8H7" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
                  <circle cx="9" cy="20" r="1.6" fill="currentColor" />
                  <circle cx="17" cy="20" r="1.6" fill="currentColor" />
                </svg>
              </Button>
              <Button size="icon" variant="ghost" className="h-9 w-9 bg-transparent text-white hover:bg-white/[0.10]" onClick={onToggleOpen} title={panelOpen ? 'Contrair' : 'Expandir'} aria-label={panelOpen ? 'Contrair' : 'Expandir'}>
                {panelOpen ? (
                  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden>
                    <path d="M6 15l6-6 6 6" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                ) : (
                  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden>
                    <path d="M6 9l6 6 6-6" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                )}
              </Button>
            </div>
          </div>
        </div>
      </CardHeader>
      {panelOpen ? (
        <CardContent className="space-y-2">
          <div className="max-h-[60vh] overflow-auto rounded-xl border border-white/10">
            <table className="w-full table-fixed text-sm">
              <thead className="bg-black/30 text-blue-100/80">
                <tr>
                  {columns.map((column) => {
                    const isActive = alertasSortKey === column.key
                    return (
                      <th key={column.label} className={`sticky top-0 z-10 bg-black/40 p-3 backdrop-blur ${column.align} ${column.widthClass || ''}`}>
                        <button
                          type="button"
                          className={`inline-flex w-full items-center gap-2 rounded-sm px-0.5 ${column.align.includes('right') ? 'justify-end' : 'justify-start'} cursor-pointer select-none ${isActive ? 'text-white' : 'text-blue-100/80'} hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-300/40`}
                          onClick={() => onSortChange(column.key)}
                          aria-label={`Ordenar ${column.label}`}
                          title={`Ordenar ${column.label}`}
                        >
                          <span>{column.label}</span>
                          <span className={`inline-flex items-center justify-center ${isActive ? 'text-white' : 'text-blue-100/30'}`} aria-hidden>
                            {isActive && alertasSortDir === 'asc' ? (
                              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden>
                                <path d="M6 15l6-6 6 6" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
                              </svg>
                            ) : (
                              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden>
                                <path d="M6 9l6 6 6-6" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
                              </svg>
                            )}
                          </span>
                        </button>
                      </th>
                    )
                  })}
                </tr>
              </thead>
              <tbody className="divide-y divide-white/5">
                {rows.slice(0, 120).map((row, index) => {
                  const code = String(row.codigoBarras || '').trim()
                  const recommendation = code ? recommendationByCode.get(code) || null : null
                  const canQuick = !!code && isAuthed
                  const qualityIssue = row.qualityIssue
                  const qualityMessage = String(row.qualityMessage || '').trim()
                  const qualitySeverity = row.qualitySeverity || (qualityIssue as any)?.severity
                  const canQualityEdit = !!qualityIssue && isAuthed && (!!qualityIssue.registro || !!qualityIssue.codigoBarras || !!qualityIssue.produto)
                  const hasQualityAction = !!qualityIssue
                  const isVencendo = row.tags.includes('VENCENDO')
                  const isExpirado = row.tags.includes('EXPIRADO')
                  const hasExpiringAction = !recommendation && (isExpirado || isVencendo)
                  const hasAnyAction = !!recommendation || hasExpiringAction || hasQualityAction
                  const displayTagsSet = new Set<AlertaStatusTag>()
                  if (row.tags.includes('URGENTE') || isExpirado) displayTagsSet.add('URGENTE')
                  if (row.tags.includes('ATENCAO') || isVencendo) displayTagsSet.add('ATENCAO')
                  if (row.tags.includes('INFO')) displayTagsSet.add('INFO')
                  const displayTags = Array.from(displayTagsSet)

                  return (
                    <tr
                      key={`${row.key}-${index}`}
                      className={`hover:bg-white/5 ${row.codigoBarras ? 'cursor-pointer' : ''}`}
                      onClick={() => {
                        if (code) onSelectBarcode(code)
                      }}
                      title={row.codigoBarras ? 'Clique para usar este código de barras' : undefined}
                    >
                      <td className="p-3 align-top text-blue-50">
                        <div className="flex flex-wrap items-center gap-2 break-words text-blue-50">
                          <span>{row.produto || '-'}</span>
                          {isVencendo ? <Badge variant="secondary" className="h-4 border px-1 py-0 text-[10px] leading-4">Venc.</Badge> : null}
                          {isExpirado ? <Badge variant="destructive" className="h-4 border px-1 py-0 text-[10px] leading-4">Exp.</Badge> : null}
                        </div>
                        <div className="hidden break-all font-mono text-xs text-blue-200/60 md:block">{row.codigoBarras || '-'}</div>
                        {row.marca ? (
                          <div className="mt-1">
                            <Badge
                              style={buildTagStyle(getMarcaBgColor(row.marca))}
                              className="cursor-pointer border hover:opacity-80"
                              onClick={(event) => {
                                event.stopPropagation()
                                onToggleMarcaFilter(String(row.marca || ''))
                              }}
                              title="Filtrar por marca"
                            >
                              {row.marca}
                            </Badge>
                          </div>
                        ) : null}
                        {row.dataValidade ? (
                          <div className="mt-1 text-xs text-blue-200/60">
                            validade: <span className="font-mono">{fmtDateOnlyBR(String(row.dataValidade))}</span>
                            {row.dias != null ? <><span>{' '}</span><span className="font-mono">({Number(row.dias)}d)</span></> : null}
                          </div>
                        ) : null}
                      </td>
                      <td className="hidden p-3 text-blue-100/80 sm:table-cell">
                        <Badge
                          style={buildTagStyle(getCategoriaBgColor(row.categoria || 'Outros'))}
                          className="cursor-pointer border hover:opacity-80"
                          onClick={(event) => {
                            event.stopPropagation()
                            onToggleCategoriaFilter(String(row.categoria || 'Outros'))
                          }}
                          title="Filtrar por categoria"
                        >
                          {row.categoria || 'Outros'}
                        </Badge>
                      </td>
                      <td className="p-3">
                        <div className="flex flex-wrap gap-1">
                          {displayTags.map((tag) => (
                            <Badge
                              key={tag}
                              variant={alertaTagVariant(tag)}
                              className="cursor-pointer hover:opacity-80"
                              onClick={(event) => {
                                event.stopPropagation()
                                onToggleStatusFilter(tag)
                              }}
                              title="Filtrar por status"
                            >
                              {alertaTagLabel(tag)}
                            </Badge>
                          ))}
                        </div>
                      </td>
                      <td className="p-3">
                        <div className="flex flex-wrap gap-2">
                          {recommendation?.kind === 'TRANSFERENCIA' ? (
                            <Button
                              size="icon"
                              variant="ghost"
                              className="h-8 w-8 bg-sky-500/30 text-sky-100 hover:bg-sky-500/45"
                              disabled={!canQuick}
                              title="Transferir"
                              aria-label="Transferir"
                              onClick={(event) => {
                                event.stopPropagation()
                                onOpenQuickOperation('TRANSFERENCIA', {
                                  codigoBarras: code,
                                  quantidade: recommendation.qty ?? 1,
                                  fromUnidade: recommendation.fromUnidade ?? null,
                                  toUnidade: recommendation.toUnidade ?? null,
                                  obs: 'Transferência sugerida',
                                })
                              }}
                            >
                              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden>
                                <path d="M7 7h10m0 0-3-3m3 3-3 3M17 17H7m0 0 3-3m-3 3 3 3" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                              </svg>
                            </Button>
                          ) : null}
                          {recommendation?.kind === 'ENTRADA' ? (
                            <Button
                              size="icon"
                              variant="ghost"
                              className="h-8 w-8 bg-emerald-500/30 text-emerald-100 hover:bg-emerald-500/45"
                              disabled={!canQuick}
                              title="Entrada"
                              aria-label="Entrada"
                              onClick={(event) => {
                                event.stopPropagation()
                                onOpenQuickOperation('ENTRADA', {
                                  codigoBarras: code,
                                  quantidade: recommendation.qty ?? 1,
                                  obs: 'Reposição sugerida',
                                })
                              }}
                            >
                              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden>
                                <path d="M12 5v10m0 0-4-4m4 4 4-4M5 19h14" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                              </svg>
                            </Button>
                          ) : null}
                          {hasExpiringAction ? (
                            <Button
                              size="icon"
                              variant="ghost"
                              className="h-8 w-8 bg-rose-500/35 text-rose-100 hover:bg-rose-500/50"
                              disabled={!canQuick}
                              title={row.tags.includes('EXPIRADO') ? 'Descarte' : 'Saída'}
                              aria-label={row.tags.includes('EXPIRADO') ? 'Descarte' : 'Saída'}
                              onClick={(event) => {
                                event.stopPropagation()
                                onOpenQuickOperation('BAIXA', {
                                  codigoBarras: code,
                                  quantidade: 1,
                                  obs: row.tags.includes('EXPIRADO') ? 'Descarte (expirado)' : 'Saída (vencendo)',
                                })
                              }}
                            >
                              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden>
                                <path d="M12 19V9m0 0-4 4m4-4 4 4M5 5h14" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                              </svg>
                            </Button>
                          ) : null}
                          {hasQualityAction ? (
                            <Button
                              variant="outline"
                              className="h-8 px-2 text-xs"
                              disabled={!canQualityEdit}
                              onClick={(event) => {
                                event.stopPropagation()
                                if (qualityIssue) onOpenQualityFix(qualityIssue)
                              }}
                            >
                              Editar
                            </Button>
                          ) : null}
                          {!hasAnyAction ? <span className="text-xs text-blue-200/60">-</span> : null}
                        </div>
                        {qualityMessage ? (
                          <div className="mt-2 text-xs text-blue-200/70">
                            <div className="inline-flex items-center gap-2">
                              <Badge variant={severityBadgeVariant(qualitySeverity) as any} className="border">
                                {severityLabel(qualitySeverity)}
                              </Badge>
                            </div>
                            <div className="mt-1 break-words">{qualityMessage}</div>
                          </div>
                        ) : null}
                      </td>
                      <td className="p-3 text-right text-blue-100/80">{row.estoqueAtual ?? '-'}</td>
                      <td className="hidden p-3 text-right text-blue-100/70 sm:table-cell">{row.estoqueMinimo ?? '-'}</td>
                      <td className="hidden p-3 text-right text-blue-100/70 lg:table-cell">{row.diferenca ?? '-'}</td>
                      <td className="hidden p-3 text-right text-blue-100/70 lg:table-cell">{row.percentual != null ? `${row.percentual}%` : '-'}</td>
                    </tr>
                  )
                })}
                {!rows.length ? (
                  <tr>
                    <td className="p-3 text-blue-100/70" colSpan={8}>
                      {emptyContent}
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </CardContent>
      ) : null}
    </Card>
  )
}

type ChartsFilterTipo = 'distribution' | 'movements' | 'roi_risk' | '__ALL__'
type ChartsFilterY = 'categoria' | 'marca' | 'item' | 'tempo' | '__ALL__'
type ChartsFilterX = 'qtd' | 'valor' | '__ALL__'
type ChartsFilterView = 'pie' | 'bar' | 'line' | '__ALL__'
type ChartsFilterTop = '5' | '8' | '10' | '15' | '__ALL__'

type InsumosChartCardView = {
  key: string
  presetId: string
  presetLabel: string
  groupBy?: string
  mode?: string
  metric: 'qtd' | 'valor'
  topN: number
  view: 'pie' | 'bar' | 'line'
  viewOptions: Array<'pie' | 'bar' | 'line'>
  supportsMetric: boolean
  supportsView: boolean
  showTopN: boolean
  controlsKind: 'distribution' | 'movements' | 'none'
  canRemove: boolean
  cardSpanClass: string
  renderNode: React.ReactNode
}

type InsumosChartsPanelProps = {
  panelOpen: boolean
  dragHandleProps?: Record<string, any>
  chartsFilterTipo: ChartsFilterTipo
  chartsFilterY: ChartsFilterY
  chartsFilterX: ChartsFilterX
  chartsFilterView: ChartsFilterView
  chartsFilterTop: ChartsFilterTop
  chartsSearch: string
  canAddChart: boolean
  canResetCharts: boolean
  chartCards: InsumosChartCardView[]
  presetOptions: Array<{ id: string; label: string }>
  emptyContent: React.ReactNode
  onToggleOpen: () => void
  onChartsFilterTipoChange: (value: ChartsFilterTipo) => void
  onChartsFilterYChange: (value: ChartsFilterY) => void
  onChartsFilterXChange: (value: ChartsFilterX) => void
  onChartsFilterViewChange: (value: ChartsFilterView) => void
  onChartsFilterTopChange: (value: ChartsFilterTop) => void
  onChartsSearchChange: (value: string) => void
  onAddChart: () => void
  onResetCharts: () => void
  onPresetChange: (cardKey: string, value: string) => void
  onRemoveChart: (cardKey: string) => void
  onDistributionGroupByChange: (cardKey: string, value: 'categoria' | 'marca' | 'item') => void
  onMovementsGroupByChange: (cardKey: string, value: 'tempo' | 'categoria') => void
  onMovementsModeChange: (cardKey: string, value: 'inout' | 'saldo' | 'entrada' | 'saida') => void
  onMetricChange: (cardKey: string, value: 'qtd' | 'valor') => void
  onViewChange: (cardKey: string, value: 'pie' | 'bar' | 'line') => void
  onTopNChange: (cardKey: string, value: number) => void
}

export function InsumosChartsPanel({
  panelOpen,
  dragHandleProps,
  chartsFilterTipo,
  chartsFilterY,
  chartsFilterX,
  chartsFilterView,
  chartsFilterTop,
  chartsSearch,
  canAddChart,
  canResetCharts,
  chartCards,
  presetOptions,
  emptyContent,
  onToggleOpen,
  onChartsFilterTipoChange,
  onChartsFilterYChange,
  onChartsFilterXChange,
  onChartsFilterViewChange,
  onChartsFilterTopChange,
  onChartsSearchChange,
  onAddChart,
  onResetCharts,
  onPresetChange,
  onRemoveChart,
  onDistributionGroupByChange,
  onMovementsGroupByChange,
  onMovementsModeChange,
  onMetricChange,
  onViewChange,
  onTopNChange,
}: InsumosChartsPanelProps) {
  return (
    <Card className="border border-white/10 bg-black/20">
      <CardHeader className="flex flex-col gap-2">
        <div className="flex min-w-0 w-full flex-col gap-2 md:flex-row md:items-center md:gap-3">
          <div className="flex min-w-0 items-center gap-3">
            <button
              type="button"
              {...dragHandleProps}
              className="mt-0.5 flex h-9 w-9 cursor-grab items-center justify-center rounded-md bg-transparent text-white hover:bg-white/[0.10] active:cursor-grabbing"
              title="Arraste para mover"
              aria-label="Mover"
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden>
                <path d="M9 6h.01M15 6h.01M9 12h.01M15 12h.01M9 18h.01M15 18h.01" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
              </svg>
            </button>
            <CardTitle className="text-base text-white">Gráficos</CardTitle>
          </div>
          <div className="ml-auto flex min-w-0 flex-1 flex-nowrap items-center justify-end gap-2 overflow-x-auto">
            <Select value={chartsFilterTipo} onValueChange={(value) => onChartsFilterTipoChange(value as ChartsFilterTipo)}>
              <SelectTrigger className="h-8 w-32 shrink-0">
                <SelectValue placeholder="Tipo" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__ALL__">–</SelectItem>
                <SelectItem value="distribution">Distribuição</SelectItem>
                <SelectItem value="movements">Movimentações</SelectItem>
                <SelectItem value="roi_risk">ROI</SelectItem>
              </SelectContent>
            </Select>
            <Select value={chartsFilterY} onValueChange={(value) => onChartsFilterYChange(value as ChartsFilterY)}>
              <SelectTrigger className="h-8 w-28 shrink-0">
                <SelectValue placeholder="Eixo Y" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__ALL__">–</SelectItem>
                <SelectItem value="categoria">Categoria</SelectItem>
                <SelectItem value="marca">Marca</SelectItem>
                <SelectItem value="item">Item</SelectItem>
                <SelectItem value="tempo">Tempo</SelectItem>
              </SelectContent>
            </Select>
            <Select value={chartsFilterX} onValueChange={(value) => onChartsFilterXChange(value as ChartsFilterX)}>
              <SelectTrigger className="h-8 w-24 shrink-0">
                <SelectValue placeholder="Eixo X" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__ALL__">–</SelectItem>
                <SelectItem value="qtd">Qtd</SelectItem>
                <SelectItem value="valor">R$</SelectItem>
              </SelectContent>
            </Select>
            <Select value={chartsFilterView} onValueChange={(value) => onChartsFilterViewChange(value as ChartsFilterView)}>
              <SelectTrigger className="h-8 w-32 shrink-0">
                <SelectValue placeholder="Representação" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__ALL__">–</SelectItem>
                <SelectItem value="pie">Pizza</SelectItem>
                <SelectItem value="bar">Barras</SelectItem>
                <SelectItem value="line">Linhas</SelectItem>
              </SelectContent>
            </Select>
            <Select value={chartsFilterTop} onValueChange={(value) => onChartsFilterTopChange(value as ChartsFilterTop)}>
              <SelectTrigger className="h-8 w-24 shrink-0">
                <SelectValue placeholder="Top" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__ALL__">–</SelectItem>
                <SelectItem value="5">Top 5</SelectItem>
                <SelectItem value="8">Top 8</SelectItem>
                <SelectItem value="10">Top 10</SelectItem>
                <SelectItem value="15">Top 15</SelectItem>
              </SelectContent>
            </Select>
            <Input value={chartsSearch} onChange={(event) => onChartsSearchChange(event.target.value)} placeholder="Buscar" className="ml-auto h-8 min-w-[120px] flex-1 md:min-w-0" />
            <div className="flex shrink-0 items-center gap-2">
              <Button variant="ghost" size="icon" className="h-9 w-9 bg-transparent text-white hover:bg-white/[0.10]" onClick={onAddChart} disabled={!canAddChart} title="Adicionar gráfico" aria-label="Adicionar gráfico">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden>
                  <path d="M12 5v14M5 12h14" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />
                </svg>
              </Button>
              <Button variant="ghost" size="icon" className="h-9 w-9 bg-transparent text-white hover:bg-white/[0.10]" onClick={onResetCharts} disabled={!canResetCharts} title="Resetar gráficos" aria-label="Resetar gráficos">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden>
                  <path d="M20 12a8 8 0 1 1-2.34-5.66" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
                  <path d="M20 4v6h-6" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </Button>
              <Button size="icon" variant="ghost" className="h-9 w-9 bg-transparent text-white hover:bg-white/[0.10]" onClick={onToggleOpen} title={panelOpen ? 'Contrair' : 'Expandir'} aria-label={panelOpen ? 'Contrair' : 'Expandir'}>
                {panelOpen ? (
                  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden>
                    <path d="M6 15l6-6 6 6" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                ) : (
                  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden>
                    <path d="M6 9l6 6 6-6" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                )}
              </Button>
            </div>
          </div>
        </div>
      </CardHeader>
      {panelOpen ? (
        <CardContent className="space-y-3">
          <div
            className={`grid gap-3 ${
              chartCards.length <= 1
                ? 'grid-cols-1'
                : chartCards.length === 2
                  ? 'grid-cols-1 lg:grid-cols-2'
                  : 'grid-cols-1 md:grid-cols-2 xl:grid-cols-3 xl:grid-flow-dense'
            }`}
          >
            {chartCards.length ? (
              chartCards.map((card) => (
                <Card key={card.key} className={`border border-white/10 bg-black/20 ${card.cardSpanClass}`}>
                  <CardHeader className="space-y-2">
                    <div className="flex items-center gap-2">
                      <Select value={card.presetId} onValueChange={(value) => onPresetChange(card.key, value)}>
                        <SelectTrigger className="h-8 w-full">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {presetOptions.map((preset) => (
                            <SelectItem key={preset.id} value={preset.id}>
                              {preset.label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      {card.canRemove ? (
                        <Button variant="outline" className="h-8 w-8 p-0" title="Remover gráfico" aria-label="Remover gráfico" onClick={() => onRemoveChart(card.key)}>
                          ×
                        </Button>
                      ) : null}
                    </div>

                    <div className="flex flex-wrap items-center gap-2">
                      {card.controlsKind === 'distribution' ? (
                        <Select value={(card.groupBy as 'categoria' | 'marca' | 'item' | undefined) || 'categoria'} onValueChange={(value) => onDistributionGroupByChange(card.key, value as 'categoria' | 'marca' | 'item')}>
                          <SelectTrigger className="h-8 w-32">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="categoria">Categoria</SelectItem>
                            <SelectItem value="marca">Marca</SelectItem>
                            <SelectItem value="item">Item</SelectItem>
                          </SelectContent>
                        </Select>
                      ) : null}

                      {card.controlsKind === 'movements' ? (
                        <>
                          <Select value={card.groupBy === 'categoria' ? 'categoria' : 'tempo'} onValueChange={(value) => onMovementsGroupByChange(card.key, value as 'tempo' | 'categoria')}>
                            <SelectTrigger className="h-8 w-28">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="tempo">Tempo</SelectItem>
                              <SelectItem value="categoria">Categoria</SelectItem>
                            </SelectContent>
                          </Select>

                          {card.groupBy === 'categoria' ? (
                            <Select value={card.mode === 'entrada' ? 'entrada' : 'saida'} onValueChange={(value) => onMovementsModeChange(card.key, value as 'entrada' | 'saida')}>
                              <SelectTrigger className="h-8 w-28">
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value="saida">Saídas</SelectItem>
                                <SelectItem value="entrada">Entradas</SelectItem>
                              </SelectContent>
                            </Select>
                          ) : (
                            <Select value={(card.mode as 'inout' | 'saldo' | 'entrada' | 'saida' | undefined) || 'inout'} onValueChange={(value) => onMovementsModeChange(card.key, value as 'inout' | 'saldo' | 'entrada' | 'saida')}>
                              <SelectTrigger className="h-8 w-36">
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value="inout">Entradas vs Saídas</SelectItem>
                                <SelectItem value="saldo">Saldo</SelectItem>
                                <SelectItem value="entrada">Entradas</SelectItem>
                                <SelectItem value="saida">Saídas</SelectItem>
                              </SelectContent>
                            </Select>
                          )}
                        </>
                      ) : null}

                      {card.supportsMetric ? (
                        <Select value={card.metric} onValueChange={(value) => onMetricChange(card.key, value as 'qtd' | 'valor')}>
                          <SelectTrigger className="h-8 w-24">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="qtd">Qtd</SelectItem>
                            <SelectItem value="valor">R$</SelectItem>
                          </SelectContent>
                        </Select>
                      ) : null}

                      {card.supportsView && card.viewOptions.length > 1 ? (
                        <Select value={card.view} onValueChange={(value) => onViewChange(card.key, value as 'pie' | 'bar' | 'line')}>
                          <SelectTrigger className="h-8 w-28">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {card.viewOptions.map((viewOption) => (
                              <SelectItem key={viewOption} value={viewOption}>
                                {viewOption === 'bar' ? 'Barras' : viewOption === 'line' ? 'Linhas' : 'Pizza'}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      ) : null}

                      {card.showTopN ? (
                        <Select value={String(card.topN)} onValueChange={(value) => onTopNChange(card.key, parseInt(String(value), 10) || 8)}>
                          <SelectTrigger className="h-8 w-20">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="5">Top 5</SelectItem>
                            <SelectItem value="8">Top 8</SelectItem>
                            <SelectItem value="10">Top 10</SelectItem>
                            <SelectItem value="15">Top 15</SelectItem>
                          </SelectContent>
                        </Select>
                      ) : null}
                    </div>
                    <div className="flex justify-end" />
                  </CardHeader>
                  <CardContent>{card.renderNode}</CardContent>
                </Card>
              ))
            ) : (
              emptyContent
            )}
          </div>
        </CardContent>
      ) : null}
    </Card>
  )
}

type InsumosMovementsPanelProps = {
  panelOpen: boolean
  dragHandleProps?: Record<string, any>
  movTipo: 'TODOS' | 'ENTRADA' | 'SAÍDA' | 'AJUSTE'
  movFilterCategoria: string
  movFilterMarca: string
  movSearch: string
  movSortKey: 'dataHora' | 'produto' | 'categoria' | 'marca' | 'estoque' | 'valor' | 'usuario' | 'observacao'
  movSortDir: 'asc' | 'desc'
  lotCategorias: string[]
  insumosMarcas: string[]
  isAuthed: boolean
  rows: MovementRowView[]
  emptyContent: React.ReactNode
  listContainerRef: React.RefObject<HTMLDivElement | null>
  onToggleOpen: () => void
  onTipoChange: (value: 'TODOS' | 'ENTRADA' | 'SAÍDA' | 'AJUSTE') => void
  onCategoriaChange: (value: string) => void
  onMarcaChange: (value: string) => void
  onSearchChange: (value: string) => void
  onOpenInventoryList: () => void
  onExportCsv: () => void
  onSortChange: (value: 'dataHora' | 'produto' | 'categoria' | 'marca' | 'estoque' | 'valor' | 'usuario' | 'observacao') => void
  onProductClick: (productName: string) => void
  onCategoryClick: (categoryName: string) => void
  onBrandClick: (brandName: string) => void
  onEditMovement: (movement: Movimentacao) => void
}

export function InsumosMovementsPanel({
  panelOpen,
  dragHandleProps,
  movTipo,
  movFilterCategoria,
  movFilterMarca,
  movSearch,
  movSortKey,
  movSortDir,
  lotCategorias,
  insumosMarcas,
  isAuthed,
  rows,
  emptyContent,
  listContainerRef,
  onToggleOpen,
  onTipoChange,
  onCategoriaChange,
  onMarcaChange,
  onSearchChange,
  onOpenInventoryList,
  onExportCsv,
  onSortChange,
  onProductClick,
  onCategoryClick,
  onBrandClick,
  onEditMovement,
}: InsumosMovementsPanelProps) {
  const columns: Array<{
    key: null | 'dataHora' | 'produto' | 'categoria' | 'marca' | 'estoque' | 'valor' | 'usuario' | 'observacao'
    label: string
    compact?: boolean
    className?: string
    widthClass?: string
  }> = [
    { key: 'dataHora', label: 'Data', compact: true, className: '', widthClass: 'w-[8%]' },
    { key: 'produto', label: 'Produto', widthClass: 'w-[22%]' },
    { key: 'categoria', label: 'Categoria', compact: true, className: 'hidden md:table-cell', widthClass: 'w-[12%]' },
    { key: 'marca', label: 'Marca', compact: true, className: 'hidden lg:table-cell', widthClass: 'w-[10%]' },
    { key: 'estoque', label: 'Estoque', compact: true, widthClass: 'w-[10%]' },
    { key: 'valor', label: 'Valor', compact: true, widthClass: 'w-[10%]' },
    { key: 'usuario', label: 'Usuário', compact: true, className: 'hidden xl:table-cell', widthClass: 'w-[10%]' },
    { key: 'observacao', label: 'Observação', className: 'hidden md:table-cell', widthClass: 'w-[16%]' },
    { key: null, label: 'Ações', compact: true, widthClass: 'w-[6%]' },
  ]

  return (
    <Card className="border border-white/10 bg-black/20">
      <CardHeader className="flex flex-col gap-2">
        <div className="flex min-w-0 w-full flex-col gap-2 md:flex-row md:items-center md:gap-3">
          <div className="flex min-w-0 items-center gap-3">
            <button
              type="button"
              {...dragHandleProps}
              className="mt-0.5 flex h-9 w-9 cursor-grab items-center justify-center rounded-md bg-transparent text-white hover:bg-white/[0.10] active:cursor-grabbing"
              title="Arraste para mover"
              aria-label="Mover"
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden>
                <path d="M9 6h.01M15 6h.01M9 12h.01M15 12h.01M9 18h.01M15 18h.01" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
              </svg>
            </button>
            <CardTitle className="text-lg text-white">Movimentações</CardTitle>
          </div>
          <div className="flex min-w-0 flex-1 flex-nowrap items-center justify-end gap-2 overflow-x-auto">
            <Select value={movTipo} onValueChange={(value) => onTipoChange(value as 'TODOS' | 'ENTRADA' | 'SAÍDA' | 'AJUSTE')}>
              <SelectTrigger className="h-8 w-28 shrink-0">
                <SelectValue placeholder="Fluxo" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="TODOS">–</SelectItem>
                <SelectItem value="ENTRADA">Entrada</SelectItem>
                <SelectItem value="SAÍDA">Saída</SelectItem>
                <SelectItem value="AJUSTE">Ajuste</SelectItem>
              </SelectContent>
            </Select>
            <Select value={movFilterCategoria || '__ALL__'} onValueChange={(value) => onCategoriaChange(value === '__ALL__' ? '' : String(value))}>
              <SelectTrigger className="h-8 w-36 shrink-0">
                <SelectValue placeholder="Categoria" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__ALL__">–</SelectItem>
                {lotCategorias.map((categoria) => (
                  <SelectItem key={categoria} value={categoria}>
                    {categoria}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={movFilterMarca || '__ALL__'} onValueChange={(value) => onMarcaChange(value === '__ALL__' ? '' : String(value))}>
              <SelectTrigger className="h-8 w-32 shrink-0">
                <SelectValue placeholder="Marca" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__ALL__">–</SelectItem>
                {insumosMarcas.map((marca) => (
                  <SelectItem key={marca} value={marca}>
                    {marca}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Input
              value={movSearch}
              onChange={(event) => onSearchChange(event.target.value)}
              placeholder="Buscar"
              className="ml-auto h-8 min-w-[120px] flex-1 md:min-w-0"
            />
            <div className="flex shrink-0 items-center gap-2">
              <Button
                size="icon"
                variant="ghost"
                className="h-9 w-9 bg-transparent text-white hover:bg-white/[0.10]"
                onClick={onOpenInventoryList}
                title="Abrir lista de insumos"
                aria-label="Abrir lista de insumos"
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden>
                  <path d="M8 6h12M8 12h12M8 18h12" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />
                  <circle cx="5" cy="6" r="1.5" fill="currentColor" />
                  <circle cx="5" cy="12" r="1.5" fill="currentColor" />
                  <circle cx="5" cy="18" r="1.5" fill="currentColor" />
                </svg>
              </Button>
              <Button
                size="icon"
                variant="ghost"
                className="h-9 w-9 bg-transparent text-white hover:bg-white/[0.10]"
                onClick={onExportCsv}
                disabled={!isAuthed}
                title="Exportar CSV"
                aria-label="Exportar CSV"
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden>
                  <path d="M12 16V4m0 12-4-4m4 4 4-4M4 20h16" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </Button>
              <Button
                size="icon"
                variant="ghost"
                className="h-9 w-9 bg-transparent text-white hover:bg-white/[0.10]"
                onClick={onToggleOpen}
                title={panelOpen ? 'Contrair' : 'Expandir'}
                aria-label={panelOpen ? 'Contrair' : 'Expandir'}
              >
                {panelOpen ? (
                  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden>
                    <path d="M6 15l6-6 6 6" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                ) : (
                  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden>
                    <path d="M6 9l6 6 6-6" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                )}
              </Button>
            </div>
          </div>
        </div>
      </CardHeader>
      {panelOpen ? (
        <CardContent className="space-y-3">
          <div ref={listContainerRef} className="max-h-[60vh] overflow-auto rounded-xl border border-white/10">
            <table className="w-full table-fixed text-sm">
              <thead className="bg-black/30 text-blue-100/80">
                <tr>
                  {columns.map((column) => {
                    const isActive = !!column.key && movSortKey === column.key
                    return (
                      <th
                        key={column.label}
                        className={`sticky top-0 z-10 bg-black/40 p-3 text-center align-middle backdrop-blur ${column.compact ? 'whitespace-nowrap' : ''} ${column.widthClass || ''} ${column.className || ''}`}
                      >
                        <div className="flex items-center justify-center gap-2">
                          {column.key ? (
                            <button
                              type="button"
                              className={`cursor-pointer select-none rounded-sm px-0.5 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-300/40 ${isActive ? 'text-white' : 'text-blue-100/80'} hover:underline`}
                              onClick={() => onSortChange(column.key)}
                              aria-label={`Ordenar ${column.label}`}
                              title={`Ordenar ${column.label}`}
                            >
                              {column.label}
                            </button>
                          ) : (
                            <span>{column.label}</span>
                          )}
                          {column.key ? (
                            <span className={`inline-flex items-center justify-center ${isActive ? 'text-white' : 'text-blue-100/30'}`} aria-hidden>
                              {isActive && movSortDir === 'asc' ? (
                                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden>
                                  <path d="M6 15l6-6 6 6" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
                                </svg>
                              ) : (
                                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden>
                                  <path d="M6 9l6 6 6-6" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
                                </svg>
                              )}
                            </span>
                          ) : null}
                        </div>
                      </th>
                    )
                  })}
                </tr>
              </thead>
              <tbody className="divide-y divide-white/5">
                {rows.length ? (
                  rows.map((row) => (
                    <tr key={row.key} className={row.rowClass}>
                      <td className="whitespace-nowrap p-3 text-center align-top text-blue-100/70">
                        <div className="text-blue-50">{row.dateLabel}</div>
                        <div className="text-xs text-blue-200/60">{row.timeLabel}</div>
                      </td>
                      <td className="p-3 text-center align-top">
                        <button
                          type="button"
                          className="w-full cursor-pointer break-words rounded-sm text-center text-blue-50 hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-300/40"
                          onClick={() => onProductClick(row.productName)}
                          title="Filtrar por produto"
                          aria-pressed={row.productPressed}
                        >
                          <span className="line-clamp-2">{row.productName}</span>
                        </button>
                        {row.brandName && row.brandName !== '-' ? (
                          <div className="mt-1 flex flex-wrap justify-center gap-1 lg:hidden">
                            <Badge style={buildTagStyle(getMarcaBgColor(row.brandName))} className="border">
                              {row.brandName}
                            </Badge>
                          </div>
                        ) : null}
                      </td>
                      <td className="hidden whitespace-nowrap p-3 text-center align-top md:table-cell">
                        {row.categoryName && row.categoryName !== '-' ? (
                          <button
                            type="button"
                            className="inline-flex w-full items-center justify-center rounded-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-300/40"
                            onClick={() => onCategoryClick(row.categoryName)}
                            title="Filtrar por categoria"
                            aria-pressed={row.categoryPressed}
                          >
                            <Badge style={buildTagStyle(getCategoriaBgColor(row.categoryName))} className="border">
                              {row.categoryName}
                            </Badge>
                          </button>
                        ) : (
                          <span className="text-blue-100/70">-</span>
                        )}
                      </td>
                      <td className="hidden whitespace-nowrap p-3 text-center align-top lg:table-cell">
                        {row.brandName && row.brandName !== '-' ? (
                          <button
                            type="button"
                            className="inline-flex w-full items-center justify-center rounded-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-300/40"
                            onClick={() => onBrandClick(row.brandName)}
                            title="Filtrar por marca"
                            aria-pressed={row.brandPressed}
                          >
                            <Badge style={buildTagStyle(getMarcaBgColor(row.brandName))} className="border">
                              {row.brandName}
                            </Badge>
                          </button>
                        ) : (
                          <span className="text-blue-100/70">-</span>
                        )}
                      </td>
                      <td className="whitespace-nowrap p-3 text-center align-top">
                        <span className={`font-mono ${row.stockLabel === '-' ? 'text-blue-100/70' : 'text-blue-50'}`}>{row.stockLabel}</span>
                      </td>
                      <td className="w-[1%] whitespace-nowrap p-3 text-center align-top">
                        <div className="text-blue-50">{row.movementValueLabel}</div>
                        <div className="text-xs text-blue-200/60">{row.stockValueLabel}</div>
                      </td>
                      <td className="hidden whitespace-nowrap p-3 text-center align-top text-blue-100/70 xl:table-cell">{row.userLabel}</td>
                      <td className="hidden p-3 text-left align-top text-blue-100/60 md:table-cell">
                        <div className="space-y-1 break-words">
                          <div>{row.notePrimary}</div>
                          {row.noteSecondary ? <div className="font-mono text-xs">{row.noteSecondary}</div> : null}
                          {row.noteMeta ? <div className="text-xs text-blue-200/60">{row.noteMeta}</div> : null}
                        </div>
                      </td>
                      <td className="whitespace-nowrap p-3 text-center align-top">
                        <div className="flex justify-center gap-2">
                          <Button variant="outline" size="sm" onClick={() => onEditMovement(row.movement)} disabled={!row.canEdit}>
                            Editar
                          </Button>
                        </div>
                      </td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td className="p-3 text-center text-blue-100/70" colSpan={9}>
                      {emptyContent}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </CardContent>
      ) : null}
    </Card>
  )
}
