import { useRef } from 'react'
import { CalendarDays } from 'lucide-react'

type AtendimentoDatePickerProps = {
  value: string
  onValueChange: (value: string) => void
  ariaLabel: string
  testId?: string
  className?: string
}

type DateInputWithPicker = HTMLInputElement & {
  showPicker?: () => void
}

export function formatAtendimentoTableDate(value?: string) {
  const [, month, day] = String(value || '').slice(0, 10).split('-')
  return month && day ? `${day}/${month}` : ''
}

/**
 * Keeps the native calendar available without exposing a text-editable date
 * field in the dense attendance table.
 */
export function AtendimentoDatePicker({ value, onValueChange, ariaLabel, testId, className = '' }: AtendimentoDatePickerProps) {
  const inputRef = useRef<DateInputWithPicker>(null)

  const openPicker = () => {
    const input = inputRef.current
    if (!input) return
    try {
      if (input.showPicker) {
        input.showPicker()
        return
      }
    } catch {
      // Browsers without showPicker still receive the native click fallback.
    }
    input.focus()
    input.click()
  }

  return (
    <div className={`relative min-w-0 ${className}`}>
      <button
        type="button"
        onClick={openPicker}
        className="flex h-8 w-full items-center justify-center gap-1.5 rounded-lg border border-slate-700 bg-slate-950/80 px-2 text-center text-xs font-medium text-white transition hover:border-slate-600 hover:bg-slate-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-400/50"
        aria-label={ariaLabel}
        data-testid={testId}
      >
        <span>{formatAtendimentoTableDate(value) || 'Selecionar'}</span>
        <CalendarDays className="h-3.5 w-3.5 shrink-0 text-slate-400" aria-hidden="true" />
      </button>
      <input
        ref={inputRef}
        type="date"
        value={value}
        onChange={(event) => onValueChange(event.target.value)}
        tabIndex={-1}
        aria-hidden="true"
        className="pointer-events-none absolute left-0 top-0 h-px w-px opacity-0"
      />
    </div>
  )
}
