type LoadingPercentTextProps = {
  percent?: number
  label?: string
  showPercent?: boolean
  className?: string
}

export function LoadingPercentText({
  percent,
  label = 'Carregando',
  showPercent = true,
  className = '',
}: LoadingPercentTextProps) {
  const hasPercent = Number.isFinite(percent)
  const value = hasPercent ? Math.max(0, Math.min(100, Math.round(percent as number))) : 0
  const suffix = showPercent && hasPercent ? ` ${value}%` : '…'

  return (
    <span className={`inline-flex items-center gap-2 text-blue-100/70 ${className}`.trim()}>
      <span className="inline-flex h-3 w-3 animate-spin rounded-full border border-blue-200/70 border-t-transparent" />
      {`${label}${suffix}`}
    </span>
  )
}
