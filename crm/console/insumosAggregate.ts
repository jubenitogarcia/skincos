import type {
  Actionables,
  EstoqueAlerta,
  EstoqueResumo,
  InsightsBundleData,
  Insumo,
  NotificationsSummary,
  OverviewBundleData,
  QualityReport,
  RoiInsights,
} from '@/insumosTypes'

type UnitItemsResponse = { unit: string; items: Insumo[] }

function numberOrZero(value: unknown) {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : 0
}

function mergeNumericRecord<T extends Record<string, unknown>>(values: Array<T | null | undefined>) {
  const result: Record<string, unknown> = {}
  for (const value of values) {
    if (!value || typeof value !== 'object') continue
    for (const [key, raw] of Object.entries(value)) {
      if (typeof raw === 'number' || (typeof raw === 'string' && raw.trim() !== '' && Number.isFinite(Number(raw)))) {
        result[key] = numberOrZero(result[key]) + numberOrZero(raw)
      } else if (result[key] == null) {
        result[key] = raw
      }
    }
  }
  return result as T
}

/**
 * Combines unit-scoped item responses without ever trusting estoqueAtual from
 * another unit. The worker returns all per-unit stocks in `estoques`, so the
 * selected unit's value is copied explicitly before summing the aggregate.
 */
export function mergeInsumosByUnitResponses(responses: UnitItemsResponse[]) {
  const byKey = new Map<string, Insumo>()
  const stockByKey = new Map<string, Record<string, number>>()

  for (const response of responses) {
    const unit = String(response?.unit || '').trim()
    if (!unit) continue
    for (const item of Array.isArray(response?.items) ? response.items : []) {
      const registro = String(item?.registro || '').trim()
      const code = String(item?.codigoBarras || '').trim()
      const key = registro || code
      if (!key) continue

      const current = byKey.get(key)
      if (!current) byKey.set(key, { ...item, estoques: {} })
      else byKey.set(key, { ...current, ...item, estoques: current.estoques || {} })

      const stocks = stockByKey.get(key) || {}
      const rawUnitStock = item?.estoques?.[unit] ?? item?.estoqueAtual
      stocks[unit] = numberOrZero(rawUnitStock)
      stockByKey.set(key, stocks)
    }
  }

  return Array.from(byKey.entries()).map(([key, item]) => {
    const stocks = stockByKey.get(key) || {}
    const estoqueAtual = Object.values(stocks).reduce((sum, value) => sum + numberOrZero(value), 0)
    return { ...item, estoques: stocks, estoqueAtual }
  })
}

function mergeResumo(values: Array<EstoqueResumo | null | undefined>, itemCount: number): EstoqueResumo {
  const totalValue = values.reduce((sum, value) => sum + numberOrZero(value?.valorEstoqueTotal), 0)
  const critical = values.reduce((sum, value) => sum + numberOrZero(value?.criticos), 0)
  return {
    totalInsumos: itemCount,
    valorEstoqueTotal: totalValue,
    criticos: critical,
  }
}

function mergeNotifications(values: Array<NotificationsSummary | null | undefined>): NotificationsSummary | null {
  const valid = values.filter(Boolean) as NotificationsSummary[]
  if (!valid.length) return null
  const counts = {
    lowStock: valid.reduce((sum, value) => sum + numberOrZero(value.counts?.lowStock), 0),
    expiringSoon: valid.reduce((sum, value) => sum + numberOrZero(value.counts?.expiringSoon), 0),
    expiredWithStock: valid.reduce((sum, value) => sum + numberOrZero(value.counts?.expiredWithStock), 0),
  }
  return {
    generatedAt: (() => {
      const timestamps = valid.map((value) => value.generatedAt || '').sort()
      return timestamps[timestamps.length - 1] || undefined
    })(),
    unidade: 'all',
    counts,
    lowStock: valid.flatMap((value) => value.lowStock || []),
    expiringSoon: valid.flatMap((value) => value.expiringSoon || []),
    expiredWithStock: valid.flatMap((value) => value.expiredWithStock || []),
  }
}

function mergeActionables(values: Array<Actionables | null | undefined>): Actionables | null {
  const valid = values.filter(Boolean) as Actionables[]
  if (!valid.length) return null
  return {
    unidade: 'all',
    reposicao: valid.flatMap((value) => value.reposicao || []),
    transferencias: valid.flatMap((value) => value.transferencias || []),
    perdasValidade: valid.flatMap((value) => value.perdasValidade || []),
    rupturas: valid.flatMap((value) => value.rupturas || []),
  }
}

function mergeRoi(values: Array<RoiInsights | null | undefined>): RoiInsights | null {
  const valid = values.filter(Boolean) as RoiInsights[]
  if (!valid.length) return null
  return {
    unidade: 'all',
    perdas: {
      valorExpirado: valid.reduce((sum, value) => sum + numberOrZero(value.perdas?.valorExpirado), 0),
      valorRiscoVencendo: valid.reduce((sum, value) => sum + numberOrZero(value.perdas?.valorRiscoVencendo), 0),
      itensExpirados: valid.reduce((sum, value) => sum + numberOrZero(value.perdas?.itensExpirados), 0),
      itensVencendo: valid.reduce((sum, value) => sum + numberOrZero(value.perdas?.itensVencendo), 0),
    },
    ruptura: { itensRuptura: valid.reduce((sum, value) => sum + numberOrZero(value.ruptura?.itensRuptura), 0) },
    produtividade: {
      entrada: valid.reduce((sum, value) => sum + numberOrZero(value.produtividade?.entrada), 0),
      baixa: valid.reduce((sum, value) => sum + numberOrZero(value.produtividade?.baixa), 0),
    },
  }
}

function mergeQuality(values: Array<QualityReport | null | undefined>): QualityReport | null {
  const valid = values.filter(Boolean) as QualityReport[]
  if (!valid.length) return null
  const bySeverity: Record<string, number> = {}
  for (const value of valid) {
    for (const [severity, count] of Object.entries(value.summary?.bySeverity || {})) {
      bySeverity[severity] = numberOrZero(bySeverity[severity]) + numberOrZero(count)
    }
  }
  return {
    generatedAt: (() => {
      const timestamps = valid.map((value) => value.generatedAt || '').sort()
      return timestamps[timestamps.length - 1] || undefined
    })(),
    unidade: 'all',
    summary: {
      total: valid.reduce((sum, value) => sum + numberOrZero(value.summary?.total), 0),
      bySeverity,
    },
    issues: valid.flatMap((value) => value.issues || []),
  }
}

function mergeMovementSeries(values: Array<OverviewBundleData['movSeries'] | null | undefined>) {
  const byDay = new Map<string, { day: string; entrada: number; saida: number; entradaValor: number; saidaValor: number }>()
  for (const series of values) {
    for (const item of series || []) {
      const day = String(item?.day || '').trim()
      if (!day) continue
      const current = byDay.get(day) || { day, entrada: 0, saida: 0, entradaValor: 0, saidaValor: 0 }
      current.entrada += numberOrZero(item?.entrada)
      current.saida += numberOrZero(item?.saida)
      current.entradaValor += numberOrZero(item?.entradaValor)
      current.saidaValor += numberOrZero(item?.saidaValor)
      byDay.set(day, current)
    }
  }
  return Array.from(byDay.values()).sort((left, right) => left.day.localeCompare(right.day))
}

export function mergeOverviewData(values: Array<OverviewBundleData | null | undefined>, units: string[] = []): OverviewBundleData {
  const valid = values.filter(Boolean) as OverviewBundleData[]
  const hasItems = valid.some((value) => Array.isArray(value.itens))
  const items = mergeInsumosByUnitResponses(
    valid.map((value, index) => ({ unit: String(units[index] || `unit-${index}`), items: value.itens || [] }))
  )
  const itemCount = hasItems
    ? items.length
    : valid.reduce((sum, value) => sum + numberOrZero(value.resumo?.totalInsumos), 0)
  const movResumo = {
    entradaQtd: valid.reduce((sum, value) => sum + numberOrZero(value.movResumo?.entradaQtd), 0),
    saidaQtd: valid.reduce((sum, value) => sum + numberOrZero(value.movResumo?.saidaQtd), 0),
    entradaValor: valid.reduce((sum, value) => sum + numberOrZero(value.movResumo?.entradaValor), 0),
    saidaValor: valid.reduce((sum, value) => sum + numberOrZero(value.movResumo?.saidaValor), 0),
  }
  return {
    resumo: mergeResumo(valid.map((value) => value.resumo), itemCount),
    itens: hasItems ? items : undefined,
    notifications: mergeNotifications(valid.map((value) => value.notifications)),
    actionables: mergeActionables(valid.map((value) => value.actionables)),
    roi: mergeRoi(valid.map((value) => value.roi)),
    quality: mergeQuality(valid.map((value) => value.quality)),
    movResumo: { ...movResumo, saldoLiquido: movResumo.entradaValor - movResumo.saidaValor },
    movSeries: mergeMovementSeries(valid.map((value) => value.movSeries)),
  }
}

function mergeTrends(values: unknown[]) {
  const objects = values.filter((value) => value && typeof value === 'object') as Array<Record<string, any>>
  if (!objects.length) return null
  const buckets = new Map<string, Record<string, any>>()
  for (const value of objects) {
    for (const bucket of Array.isArray(value.buckets) ? value.buckets : []) {
      const key = String(bucket?.bucket || '').trim()
      if (!key) continue
      const current = buckets.get(key) || { bucket: key }
      for (const field of ['entradaQtd', 'saidaQtd', 'ajusteQtd', 'entradaValor', 'saidaValor']) {
        current[field] = numberOrZero(current[field]) + numberOrZero(bucket?.[field])
      }
      buckets.set(key, current)
    }
  }
  const totals = mergeNumericRecord(objects.map((value) => value.totals || null))
  return {
    ...objects[0],
    unidade: 'all',
    totals: {
      ...totals,
      saldoQtd: numberOrZero(totals.entradaQtd) - numberOrZero(totals.saidaQtd),
      saldoValor: numberOrZero(totals.entradaValor) - numberOrZero(totals.saidaValor),
    },
    buckets: Array.from(buckets.values()).sort((left, right) => String(left.bucket).localeCompare(String(right.bucket))),
  }
}

function mergeTurnover(values: unknown[]) {
  const objects = values.filter((value) => value && typeof value === 'object') as Array<Record<string, any>>
  if (!objects.length) return null
  const byCategory = new Map<string, { categoria: string; qtd: number; valor: number; movimentos: number }>()
  for (const value of objects) {
    for (const row of Array.isArray(value.categories) ? value.categories : []) {
      const categoria = String(row?.categoria || 'Outros')
      const current = byCategory.get(categoria) || { categoria, qtd: 0, valor: 0, movimentos: 0 }
      current.qtd += numberOrZero(row?.qtd)
      current.valor += numberOrZero(row?.valor)
      current.movimentos += numberOrZero(row?.movimentos)
      byCategory.set(categoria, current)
    }
  }
  return {
    ...objects[0],
    unidade: 'all',
    categories: Array.from(byCategory.values()).sort((left, right) => right.valor - left.valor),
  }
}

export function mergeInsightsData(values: Array<InsightsBundleData | null | undefined>): InsightsBundleData {
  const valid = values.filter(Boolean) as InsightsBundleData[]
  const alerts = new Map<string, EstoqueAlerta>()
  for (const value of valid) {
    for (const alert of value.alertas || []) {
      const keyParts = [alert.codigoBarras, alert.tipoAlerta, alert.statusAlerta].map((part) => String(part || ''))
      if (keyParts.some(Boolean)) alerts.set(keyParts.join('|'), alert)
    }
  }
  return {
    alertas: Array.from(alerts.values()),
    trends: mergeTrends(valid.map((value) => value.trends)),
    turnover: {
      saida: mergeTurnover(valid.map((value) => value.turnover?.saida)),
      entrada: mergeTurnover(valid.map((value) => value.turnover?.entrada)),
    },
  }
}
