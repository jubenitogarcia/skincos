import React from 'react'
import ChevronDownIcon from 'lucide-react/dist/esm/icons/chevron-down'
import { Popover, PopoverAnchor, PopoverContent } from '@/popover'
import { Input } from '@/input'
import { cn } from '@/utils'

type AutocompleteInputProps = {
  value: string
  onValueChange: (next: string) => void
  options: string[]
  placeholder?: string
  disabled?: boolean
  ariaInvalid?: boolean
  inputTestId?: string
  className?: string
  inputClassName?: string
  maxItems?: number
}

const normalizeForSearch = (value: string) =>
  String(value || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()

export function AutocompleteInput({
  value,
  onValueChange,
  options,
  placeholder,
  disabled,
  ariaInvalid,
  inputTestId,
  className,
  inputClassName,
  maxItems = 40
}: AutocompleteInputProps) {
  const [open, setOpen] = React.useState(false)

  const filtered = React.useMemo(() => {
    const q = normalizeForSearch(value)
    if (!Array.isArray(options) || !options.length) return []
    if (!q) return options.slice(0, maxItems)
    const out: string[] = []
    for (const opt of options) {
      if (!opt) continue
      if (normalizeForSearch(opt).includes(q)) out.push(opt)
      if (out.length >= maxItems) break
    }
    return out
  }, [maxItems, options, value])

  const show = open && !!filtered.length && !disabled

  return (
    <Popover open={show} onOpenChange={setOpen}>
      <PopoverAnchor asChild>
        <div className={cn('relative', className)}>
          <Input
            value={value}
            onChange={(e) => onValueChange(e.target.value)}
            onFocus={() => setOpen(true)}
            onKeyDown={(e) => {
              if (e.key === 'Escape') setOpen(false)
            }}
            placeholder={placeholder}
            disabled={disabled}
            aria-invalid={ariaInvalid ? true : undefined}
            data-testid={inputTestId}
            className={cn('pr-9', inputClassName)}
          />
          <button
            type="button"
            className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-muted-foreground hover:bg-muted/40 disabled:opacity-50"
            onClick={() => setOpen((v) => !v)}
            disabled={disabled}
            aria-label="Abrir lista"
          >
            <ChevronDownIcon className="size-4 opacity-70" />
          </button>
        </div>
      </PopoverAnchor>

      <PopoverContent
        align="start"
        className="w-[var(--radix-popover-trigger-width)] p-1"
        onOpenAutoFocus={(e) => e.preventDefault()}
      >
        <div className="max-h-64 overflow-y-auto overflow-x-hidden">
          {filtered.map((opt) => (
            <button
              key={opt}
              type="button"
              className="w-full rounded px-2 py-1.5 text-left text-sm hover:bg-accent hover:text-accent-foreground"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => {
                onValueChange(opt)
                setOpen(false)
              }}
            >
              {opt}
            </button>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  )
}
