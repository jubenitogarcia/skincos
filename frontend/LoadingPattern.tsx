import React, { ReactNode } from 'react'
import { Button } from '@/button'

const normalizePercent = (value?: number) => {
  const hasPercent = Number.isFinite(value)
  const pct = hasPercent ? Math.max(0, Math.min(100, Math.round(value as number))) : 0
  return { hasPercent, pct }
}

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
  className = ''
}: LoadingPercentTextProps) {
  const { hasPercent, pct } = normalizePercent(percent)
  const safeLabel = showPercent && hasPercent ? label : label.replace(/[.…]+$/, '')
  const suffix = showPercent && hasPercent ? ` ${pct}%` : '…'
  return (
    <span className={`inline-flex items-center gap-2 text-blue-100/70 ${className}`.trim()}>
      <span className="inline-flex h-3 w-3 rounded-full border border-blue-200/70 border-t-transparent animate-spin" />
      {`${safeLabel}${suffix}`}
    </span>
  )
}

type LoadingPercentButtonProps = {
  percent?: number
  label?: string
  size?: 'sm' | 'default' | 'lg'
  showPercent?: boolean
  className?: string
}

export function LoadingPercentButton({
  percent,
  label = 'Carregando dados',
  size = 'sm',
  showPercent = true,
  className = ''
}: LoadingPercentButtonProps) {
  const { hasPercent, pct } = normalizePercent(percent)
  const safeLabel = showPercent && hasPercent ? label : label.replace(/[.…]+$/, '')
  const suffix = showPercent && hasPercent ? ` ${pct}%` : '…'
  return (
    <Button variant="secondary" size={size} disabled className={`gap-2 ${className}`.trim()}>
      <span className="animate-pulse">⏳</span>
      {`${safeLabel}${suffix}`}
    </Button>
  )
}

type LoadingScreenProps = {
  title: string
  subtitle?: string
  percent?: number
  note?: string
  buttonLabel?: string
  overlay?: boolean
  children?: ReactNode
}

export function LoadingScreen({
  title,
  subtitle,
  percent,
  note,
  buttonLabel,
  overlay = false,
  children
}: LoadingScreenProps) {
  const containerClass = overlay ? 'fixed inset-0 z-[9999]' : 'min-h-screen'
  return (
    <div
      className={`${containerClass} flex items-center justify-center bg-gradient-to-br from-corporate-950 via-corporate-900 to-corporate-800 p-6 text-white`}
    >
      <div className="w-full max-w-md rounded-2xl border border-white/10 bg-black/20 p-6 text-center shadow-2xl">
        <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full border-2 border-blue-200/70 border-t-transparent animate-spin" />
        <div className="text-lg font-semibold mt-4">{title}</div>
        {subtitle ? <div className="text-sm text-blue-100/70 mt-1">{subtitle}</div> : null}
        <div className="mt-6 flex items-center justify-center">
          <LoadingPercentButton percent={percent} size="lg" label={buttonLabel} />
        </div>
        {note ? <div className="mt-4 text-xs text-blue-200/60">{note}</div> : null}
        {children ? <div className="mt-6 text-left">{children}</div> : null}
      </div>
    </div>
  )
}
