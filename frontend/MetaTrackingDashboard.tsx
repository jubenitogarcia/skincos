import { Badge } from '@/badge'
import type { MetaAdsReportResponse } from '@/metaAdsTypes'
import { LinkBreak, WarningCircle } from '@phosphor-icons/react'

function describeFallbackReason(report: MetaAdsReportResponse | null) {
  const reason = report?.fallbackReason
  if (reason === 'worker_unconfigured') {
    return 'As métricas consolidadas ainda não estão disponíveis nesta leitura. O painel está usando dados parciais da Meta para não ficar vazio.'
  }
  if (reason === 'worker_unauthorized') {
    return 'O CRM não conseguiu acessar a fonte consolidada de métricas. O painel está usando dados parciais da Meta enquanto a credencial é normalizada.'
  }
  if (reason === 'worker_unavailable') {
    return 'A fonte consolidada de métricas não respondeu nesta leitura. O painel está usando dados parciais da Meta até o serviço voltar.'
  }
  if (reason === 'worker_invalid_response') {
    return 'A fonte consolidada retornou dados incompletos para esta tela. O painel está usando dados parciais da Meta para preservar a operação.'
  }
  return 'As métricas consolidadas não responderam neste momento. O painel está usando dados parciais da Meta para não ficar vazio.'
}

function describeWarning(warning: string) {
  if (warning === 'empty_report') return 'Sem consolidado diário para a janela consultada'
  if (warning === 'graph_fallback') return 'Dados parciais da Meta'
  if (warning === 'worker_unconfigured') return 'Fonte consolidada indisponível'
  if (warning === 'worker_unauthorized') return 'Credencial pendente'
  if (warning === 'worker_unavailable') return 'Fonte consolidada temporariamente indisponível'
  if (warning === 'worker_invalid_response') return 'Fonte consolidada incompleta'
  return warning
}

export function MetaTrackingDashboard({
  data,
  error,
}: {
  data: MetaAdsReportResponse | null
  error?: string | null
}) {
  const warnings = data?.warnings || []
  const readingWarnings = data?.source === 'graph-fallback'
    ? [...new Set(['graph_fallback', ...(warnings || [])])]
    : warnings
  if (!error && readingWarnings.length === 0) return null

  return (
    <div className="space-y-4">
      {error ? (
        <div className="rounded-2xl border border-red-400/30 bg-red-500/10 p-4 text-red-100">
          <div className="flex items-center gap-2 font-medium">
            <LinkBreak className="h-5 w-5" />
            Falha ao carregar o painel consolidado do Meta Ads
          </div>
          <p className="mt-2 text-sm text-red-100/80">{error}</p>
        </div>
      ) : null}

      {readingWarnings.length > 0 ? (
        <div className="rounded-2xl border border-amber-400/30 bg-amber-500/10 p-4 text-amber-100">
          <div className="flex items-center gap-2 font-medium">
            <WarningCircle className="h-5 w-5" />
            Métricas parciais
          </div>
          {data?.source === 'graph-fallback' ? (
            <p className="mt-2 text-sm text-amber-100/90">{describeFallbackReason(data)}</p>
          ) : null}
          <div className="mt-3 flex flex-wrap gap-2">
            {readingWarnings.map((warning) => (
              <Badge key={warning} variant="outline" className="border-amber-300/30 text-amber-100">
                {describeWarning(warning)}
              </Badge>
            ))}
          </div>
        </div>
      ) : null}

    </div>
  )
}
