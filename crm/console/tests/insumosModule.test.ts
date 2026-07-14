import { describe, expect, it } from 'vitest'

import { normalizeInsumosHeaderAction, normalizeInsumosHeaderState } from '../insumosBridge'
import { getNextChartPresetPatch, getNextMovementsGroupByPatch, parseChartSlots } from '../insumosCharts'
import { resolveOverviewDateRange } from '../insumosDashboardController'
import { buildMovimentacoesView } from '../insumosDerivations'
import { brToIsoDate, calcularStatusEstoque, normalizeTipoUnidadeToCanonical, parseBarcodeInput } from '../insumosShared'
import { buildMovimentacoesQuery } from '../useInsumosMovementsController'

describe('Insumos module helpers', () => {
  it('normalizes typed and legacy header actions', () => {
    expect(normalizeInsumosHeaderAction({ type: 'set-unit', value: 'novo-hamburgo' })).toEqual({
      type: 'set-unit',
      value: 'novo-hamburgo',
    })

    expect(normalizeInsumosHeaderAction({ op: 'BAIXA' })).toEqual({
      type: 'quick-op',
      value: 'BAIXA',
    })

    expect(normalizeInsumosHeaderAction({ op: 'AJUSTE' })).toEqual({
      type: 'quick-op',
      value: 'AJUSTE',
    })

    expect(normalizeInsumosHeaderAction({ action: 'expandAll' })).toEqual({
      type: 'layout',
      value: 'expandAll',
    })

    expect(normalizeInsumosHeaderAction({ action: 'reload', period: '30d' })).toEqual({
      type: 'set-overview',
      value: { action: 'reload', period: '30d' },
    })
  })

  it('normalizes the header state emitted to App', () => {
    expect(normalizeInsumosHeaderState({
      status: {
        online: true,
        authed: true,
        integrated: false,
        unidades: ['novo-hamburgo'],
        allowedUnits: ['novo-hamburgo'],
      },
      stock: {
        value: 1234,
        loading: true,
        percent: 82,
        entradaValor: 500,
        saidaValor: 120,
      },
      selectedUnit: 'novo-hamburgo',
      overview: { period: 'custom', from: '01/05/2026', to: '10/05/2026' },
    })).toEqual({
      status: {
        online: true,
        authed: true,
        integrated: false,
        unidades: ['novo-hamburgo'],
        allowedUnits: ['novo-hamburgo'],
      },
      stock: {
        value: 1234,
        loading: true,
        percent: 82,
        entradaValor: 500,
        saidaValor: 120,
      },
      selectedUnit: 'novo-hamburgo',
      overview: { period: 'custom', from: '01/05/2026', to: '10/05/2026' },
    })
  })

  it('keeps barcode parsing, unit normalization and stock severity predictable', () => {
    expect(parseBarcodeInput('789\n 123 ; 456,789')).toEqual(['789', '123', '456', '789'])
    expect(normalizeTipoUnidadeToCanonical('Flaconete')).toBe('frasco')
    expect(calcularStatusEstoque(2, 3)).toBe('URGENTE')
    expect(calcularStatusEstoque(3, 3)).toBe('ATENCAO')
    expect(calcularStatusEstoque(4, 3)).toBe('OK')
  })

  it('converts Brazilian dates to ISO safely', () => {
    expect(brToIsoDate('10/05/2026')).toBe('2026-05-10')
    expect(brToIsoDate('10/05/26')).toBe('2026-05-10')
    expect(brToIsoDate('31/02/2026')).toBe('')
  })

  it('groups duplicate transfer movements and keeps sorting deterministic', () => {
    const insumos = {
      '111': { codigoBarras: '111', produto: 'Seringa', categoria: 'Descartáveis', marca: 'Marca A', precoCusto: 10 },
      '222': { codigoBarras: '222', produto: 'Luva', categoria: 'EPIs', marca: 'Marca B', precoCusto: 4 },
    }

    const view = buildMovimentacoesView({
      movGroupTransfers: true,
      movSortDir: 'desc',
      movSortKey: 'dataHora',
      movTipo: 'TODOS',
      movFilterCategoria: '',
      movFilterMarca: '',
      movSearch: '',
      movimentacoes: [
        {
          id: '1',
          dataHora: '2026-05-10T10:00:00.000Z',
          tipo: 'SAÍDA',
          codigoBarras: '111',
          quantidade: 2,
          transferId: 'tx-1',
          unidadeOrigem: 'novo-hamburgo',
          unidadeDestino: 'barra-shopping-sul',
        },
        {
          id: '2',
          dataHora: '2026-05-10T10:01:00.000Z',
          tipo: 'ENTRADA',
          codigoBarras: '111',
          quantidade: 2,
          transferId: 'tx-1',
          unidadeOrigem: 'novo-hamburgo',
          unidadeDestino: 'barra-shopping-sul',
        },
        {
          id: '3',
          dataHora: '2026-05-09T09:00:00.000Z',
          tipo: 'ENTRADA',
          codigoBarras: '222',
          quantidade: 1,
        },
      ],
      pickInsumoForMov: (movement) => insumos[String(movement.codigoBarras || '') as '111' | '222'] || null,
      selectedCodigoBarras: '',
      normalizeText: (value) => String(value || '').trim().toLowerCase(),
    })

    expect(view).toHaveLength(2)
    expect(view[0]).toMatchObject({
      transferId: 'tx-1',
      tipo: 'TRANSFERÊNCIA',
      quantidade: 2,
      unidadeOrigem: 'novo-hamburgo',
      unidadeDestino: 'barra-shopping-sul',
    })
    expect(view[1]).toMatchObject({
      id: '3',
      codigoBarras: '222',
    })
  })

  it('normalizes legacy chart slots and clamps invalid values', () => {
    const slots = parseChartSlots(
      JSON.stringify([
        { presetId: 'stock_brand', metric: 'valor', view: 'pie', topN: 99 },
        { presetId: 'mov_saldo', topN: 2, view: 'line' },
      ])
    )

    expect(slots).toEqual([
      { presetId: 'distribution', groupBy: 'marca', metric: 'valor', view: 'pie', topN: 15 },
      { presetId: 'movements', groupBy: 'tempo', mode: 'saldo', metric: undefined, view: 'line', topN: 5 },
    ])
  })

  it('recomputes chart mode and view when moving movement charts to categoria', () => {
    expect(
      getNextMovementsGroupByPatch(
        { presetId: 'movements', groupBy: 'tempo', mode: 'inout', metric: 'qtd', view: 'line', topN: 8 },
        'categoria'
      )
    ).toEqual({
      groupBy: 'categoria',
      mode: 'saida',
      view: 'bar',
    })

    expect(
      getNextChartPresetPatch(
        { presetId: 'distribution', groupBy: 'item', metric: 'qtd', view: 'bar', topN: 8 },
        'movements'
      )
    ).toEqual({
      presetId: 'movements',
      groupBy: 'tempo',
      mode: 'inout',
      view: 'bar',
    })
  })

  it('derives stable overview date ranges for rolling and custom periods', () => {
    expect(
      resolveOverviewDateRange({
        period: '30d',
        customFrom: '',
        customTo: '',
        now: new Date('2026-05-10T12:00:00.000Z'),
      })
    ).toEqual({
      de: '2026-04-10',
      ate: '2026-05-10',
      days: 30,
    })

    expect(
      resolveOverviewDateRange({
        period: 'custom',
        customFrom: '01/05/2026',
        customTo: '10/05/2026',
        now: new Date('2026-05-10T12:00:00.000Z'),
      })
    ).toEqual({
      de: '2026-05-01',
      ate: '2026-05-10',
      days: 9,
    })
  })

  it('builds movement queries with normalized filters and dates', () => {
    expect(
      buildMovimentacoesQuery({
        unidade: 'novo-hamburgo',
        limite: 200,
        pagina: 2,
        movTipo: 'SAÍDA',
        selectedCodigoBarras: '789',
        movDe: '01/05/2026',
        movAte: '10/05/2026',
      }).toString()
    ).toBe(
      'unidade=novo-hamburgo&limite=200&pagina=2&tipo=SA%C3%8DDA&codigoBarras=789&de=2026-05-01&ate=2026-05-10'
    )
  })
})
