import { ArrowSquareOut } from '@phosphor-icons/react'
import { TooltipButton } from '@/tooltip'

export function OpenEntityButton({
  onClick,
  label = 'Abrir',
}: {
  onClick: () => void
  label?: string
}) {
  return (
    <TooltipButton label={label}>
      <button
        type="button"
        onClick={onClick}
        aria-label={label}
        className="inline-flex h-7 w-7 items-center justify-center rounded-full border border-slate-700 bg-slate-900/70 text-slate-200 transition hover:border-sky-500/40 hover:text-sky-100"
      >
        <ArrowSquareOut className="h-3.5 w-3.5" />
      </button>
    </TooltipButton>
  )
}
