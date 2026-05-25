import { CalendarX2, Pencil, Shield, Sparkles } from 'lucide-react'

import { Button } from '@/button'
import { Checkbox } from '@/checkbox'
import { Popover, PopoverContent, PopoverTrigger } from '@/popover'
import { Tooltip, TooltipContent, TooltipLabel, TooltipTrigger } from '@/tooltip'
import { cn } from '@/utils'
import { slugifySegment } from '@/escalaShared'
import type { DayPlanSource, PrefillSuggestion } from '@/escalaTypes'

export function NoAttendanceChip({
  date,
  blocked,
  label,
}: {
  date: string
  blocked?: boolean
  label?: string
}) {
  const text = String(label || 'Sem atendimento').trim() || 'Sem atendimento'

  return (
    <TooltipLabel label={text}>
      <div
        className={cn(
          'inline-flex h-8 w-8 items-center justify-center rounded-full border shadow-[inset_0_1px_0_rgba(255,255,255,0.06)]',
          blocked
            ? 'border-rose-200/35 bg-rose-500/14 text-rose-50'
            : 'border-white/10 bg-white/5 text-slate-200/80',
        )}
        data-testid={`escala-no-attendance-icon-${date}`}
        aria-label={text}
        tabIndex={0}
      >
        <CalendarX2 className="h-3.5 w-3.5" />
      </div>
    </TooltipLabel>
  )
}

type MultiSelectFieldProps = {
  label: string
  placeholder: string
  options: string[]
  values: string[]
  onToggle: (option: string) => void
  testId: string
  full?: boolean
}

export function MultiSelectField({
  label,
  placeholder,
  options,
  values,
  onToggle,
  testId,
  full,
}: MultiSelectFieldProps) {
  const displayValue = values.length ? values.join(', ') : placeholder

  return (
    <label className={cn('space-y-1.5', full && 'sm:col-span-2')}>
      <span className="text-[11px] font-medium uppercase tracking-[0.18em] text-slate-300/65">
        {label}
      </span>
      <Popover>
        <PopoverTrigger asChild>
          <button
            type="button"
            className={cn(
              'flex h-10 w-full items-center justify-between rounded-md border border-white/10 bg-white/[0.05] px-3 text-left text-sm transition hover:border-white/20',
              values.length ? 'text-white' : 'text-slate-400'
            )}
            data-testid={testId}
          >
            <span className="truncate">{displayValue}</span>
            <span className="ml-3 text-[10px] uppercase tracking-[0.14em] text-slate-400">
              {values.length || 0}
            </span>
          </button>
        </PopoverTrigger>
        <PopoverContent className="w-[320px] border-white/15 bg-slate-900/95 p-2 text-slate-100" align="start">
          <div className="space-y-1">
            {options.map((option) => {
              const checked = values.includes(option)
              return (
                <label
                  key={option}
                  className={cn(
                    'flex cursor-pointer items-center gap-2 rounded-lg px-2 py-2 text-sm transition hover:bg-white/[0.06]',
                    checked && 'bg-white/[0.08]'
                  )}
                >
                  <Checkbox
                    checked={checked}
                    onCheckedChange={() => onToggle(option)}
                    data-testid={`${testId}-${slugifySegment(option)}`}
                  />
                  <span>{option}</span>
                </label>
              )
            })}
          </div>
        </PopoverContent>
      </Popover>
    </label>
  )
}

export function EscalaDaySourceBadge({
  date,
  daySource,
  appliedSuggestion,
}: {
  date: string
  daySource: DayPlanSource
  appliedSuggestion?: PrefillSuggestion | null
}) {
  const label = daySource === 'manual'
    ? 'Manual'
    : daySource === 'auto'
      ? 'Automático'
      : daySource === 'blocked'
        ? 'Bloqueado'
        : 'Vazio'

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <div
          className={cn(
            'inline-flex size-7 items-center justify-center rounded-full border',
            daySource === 'manual' && 'border-sky-300/22 bg-sky-500/10 text-sky-100/85',
            daySource === 'auto' && 'border-emerald-300/22 bg-emerald-500/10 text-emerald-100/85',
            daySource === 'blocked' && 'border-rose-300/22 bg-rose-500/10 text-rose-100/85',
            daySource === 'empty' && 'border-amber-300/22 bg-amber-500/10 text-amber-100/85',
          )}
          data-testid={`escala-day-source-${date}`}
          aria-label={label}
        >
          {daySource === 'manual' ? <Pencil className="size-3.5" aria-hidden="true" /> : null}
          {daySource === 'auto' ? <Sparkles className="size-3.5" aria-hidden="true" /> : null}
          {daySource === 'blocked' ? <Shield className="size-3.5" aria-hidden="true" /> : null}
          {daySource === 'empty' ? <CalendarX2 className="size-3.5" aria-hidden="true" /> : null}
          <span className="sr-only">{label}</span>
        </div>
      </TooltipTrigger>
      <TooltipContent>
        <div className="text-xs font-medium">{label}</div>
        {daySource === 'auto' && appliedSuggestion ? (
          <div className="mt-1 text-[11px] text-slate-300/85">
            {`${appliedSuggestion.professional} • ${Math.round(appliedSuggestion.confidence * 100)}% • ${appliedSuggestion.sampleSize} ocorrências`}
          </div>
        ) : null}
      </TooltipContent>
    </Tooltip>
  )
}

export function EscalaBulkSelectionPanel({
  isBulkSelectionMode,
  onEnable,
  onConfirm,
  onCancel,
}: {
  isBulkSelectionMode: boolean
  onEnable: () => void
  onConfirm: () => void
  onCancel: () => void
}) {
  return (
    <div
      className="rounded-2xl border border-white/10 bg-slate-950/45 px-3 py-3"
      data-testid="escala-bulk-select-panel"
      data-escala-bulk-preserve="true"
    >
      <Button
        type="button"
        variant={isBulkSelectionMode ? 'premium' : 'outline'}
        className="w-full"
        onClick={onEnable}
        data-testid="escala-multi-select-toggle"
      >
        Seleção múltipla
      </Button>
      {isBulkSelectionMode ? (
        <>
          <div className="mt-2 text-[11px] text-slate-300/80">
            Clique nas datas do calendário para selecionar.
          </div>
          <div className="mt-2 grid grid-cols-2 gap-2">
            <Button
              type="button"
              variant="default"
              onClick={onConfirm}
              data-testid="escala-multi-select-ok"
            >
              OK
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={onCancel}
              data-testid="escala-multi-select-close"
            >
              Fechar
            </Button>
          </div>
        </>
      ) : null}
    </div>
  )
}
