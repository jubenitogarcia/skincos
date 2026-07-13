import { Badge } from '@/badge'
import type { MetaAdsReportResponse } from '@/metaAdsTypes'
import { LinkBreak, WarningCircle } from '@phosphor-icons/react'

function describeFallbackReason(report: MetaAdsReportResponse | null) {
  const reason = report?.fallbackReason
  if (reason === 'worker_unconfigured') {
    return 'O consolidado do workflow ainda não está configurado neste runtime do CRM. O módulo caiu para o Graph para não ficar vazio.'
  }
  if (reason === 'worker_unauthorized') {
    return 'O CRM não conseguiu autenticar a leitura do worker consolidado. O módulo caiu para o Graph enquanto a credencial do worker não é corrigida.'
  }
  if (reason === 'worker_unavailable') {
    return 'O worker consolidado ficou indisponível nesta leitura. O CRM caiu para o Graph até o consolidado voltar a responder.'
  }
  if (reason === 'worker_invalid_response') {
    return 'O worker consolidado respondeu em formato inválido para esta tela. O CRM caiu para o Graph para preservar a operação.'
  }
  return 'O consolidado do workflow não respondeu neste momento. O CRM caiu para o Graph da Meta para não deixar o módulo vazio.'
}

function describeWarning(warning: string) {
  if (warning === 'empty_report') return 'Sem consolidado diário para a janela consultada'
  if (warning === 'graph_fallback') return 'Leitura degradada via Graph'
  if (warning === 'worker_unconfigured') return 'Worker não configurado'
  if (warning === 'worker_unauthorized') return 'Worker sem autorização'
  if (warning === 'worker_unavailable') return 'Worker indisponível'
  if (warning === 'worker_invalid_response') return 'Worker retornou payload inválido'
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
            Avisos de leitura
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
