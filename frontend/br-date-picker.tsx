import React from 'react'
import { Calendar } from '@/calendar'
import { Input } from '@/input'
import { Popover, PopoverAnchor, PopoverContent } from '@/popover'

function digitsToBrDateInput(raw: string) {
  const digits = String(raw || '').replace(/\D/g, '').slice(0, 8)
  if (digits.length <= 2) return digits
  if (digits.length <= 4) return `${digits.slice(0, 2)}/${digits.slice(2)}`
  if (digits.length <= 6) return `${digits.slice(0, 2)}/${digits.slice(2, 4)}/${digits.slice(4)}`
  return `${digits.slice(0, 2)}/${digits.slice(2, 4)}/${digits.slice(4, 8)}`
}

function brToIsoDate(value?: string | null) {
  const v = String(value || '').trim()
  if (!v) return ''
  if (/^\d{4}-\d{2}-\d{2}$/.test(v)) return v

  const m = v.match(/^(\d{2})\/(\d{2})\/(\d{2}|\d{4})$/)
  if (!m) return ''
  const day = parseInt(m[1], 10)
  const month = parseInt(m[2], 10)
  const yearRaw = m[3]
  const year = yearRaw.length === 2 ? 2000 + parseInt(yearRaw, 10) : parseInt(yearRaw, 10)
  const d = new Date(Date.UTC(year, month - 1, day))
  if (d.getUTCFullYear() !== year || d.getUTCMonth() !== month - 1 || d.getUTCDate() !== day) return ''
  const yyyy = String(year).padStart(4, '0')
  const mm = String(month).padStart(2, '0')
  const dd = String(day).padStart(2, '0')
  return `${yyyy}-${mm}-${dd}`
}

function parseBrInputToDate(value?: string | null) {
  const iso = brToIsoDate(value)
  if (!iso) return undefined
  const d = new Date(`${iso}T00:00:00.000Z`)
  return Number.isNaN(d.getTime()) ? undefined : d
}

function fmtBrDateInput(d: Date) {
  try {
    return d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: '2-digit' })
  } catch {
    const iso = d.toISOString().slice(0, 10)
    const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})$/)
    if (!m) return iso
    return `${m[3]}/${m[2]}/${m[1].slice(2)}`
  }
}

export function BrDatePickerInput({
  value,
  onChange,
  placeholder,
  ariaLabel,
  className
}: {
  value: string
  onChange: (next: string) => void
  placeholder?: string
  ariaLabel?: string
  className?: string
}) {
  const [open, setOpen] = React.useState(false)
  const selected = React.useMemo(() => parseBrInputToDate(value), [value])

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverAnchor asChild>
        <div className="relative">
          <Input
            value={value}
            onChange={(e) => onChange(digitsToBrDateInput(e.target.value))}
            placeholder={placeholder || 'DD/MM/AA'}
            inputMode="numeric"
            onFocus={() => setOpen(true)}
            onClick={() => setOpen(true)}
            aria-label={ariaLabel}
            className={className}
          />
          <button
            type="button"
            className="absolute right-2 top-1/2 -translate-y-1/2 h-8 w-8 rounded-md border border-white/10 bg-black/20 hover:bg-white/10 text-blue-100/80 cursor-pointer flex items-center justify-center"
            onClick={() => setOpen((v) => !v)}
            aria-label="Selecionar data"
            title="Selecionar data"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden>
              <path
                d="M8 2v3M16 2v3M4 8h16M6 4h12a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </button>
        </div>
      </PopoverAnchor>
      <PopoverContent align="start" className="w-auto p-2">
        <Calendar
          mode="single"
          selected={selected}
          onSelect={(d) => {
            if (!d) return
            onChange(fmtBrDateInput(d))
            setOpen(false)
          }}
          initialFocus
        />
      </PopoverContent>
    </Popover>
  )
}

