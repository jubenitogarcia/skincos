import React, { useEffect, useRef, useState } from 'react'
import { Input } from '@/input'
import { fetchAtendimentoClientSuggestions, type AtendimentoClientSuggestion } from '@/atendimentoApi'

type AtendimentoClientAutocompleteProps = Omit<React.ComponentProps<typeof Input>, 'value' | 'onChange'> & {
  value: string
  unitSlug: string
  onValueChange: (value: string) => void
  onClientSelected?: (value: string) => void
}

/** Keeps request cancellation and the listbox contract local to the client field. */
export function AtendimentoClientAutocomplete({
  value,
  unitSlug,
  onValueChange,
  onClientSelected,
  onFocus,
  onBlur,
  className,
  ...props
}: AtendimentoClientAutocompleteProps) {
  const [suggestions, setSuggestions] = useState<AtendimentoClientSuggestion[]>([])
  const [open, setOpen] = useState(false)
  const requestRef = useRef(0)
  const query = value.trim()

  useEffect(() => {
    if (!open || query.length < 2 || !unitSlug) {
      setSuggestions([])
      return
    }
    const requestId = ++requestRef.current
    const timer = window.setTimeout(() => {
      void fetchAtendimentoClientSuggestions(unitSlug, query).then((result) => {
        if (requestId !== requestRef.current) return
        setSuggestions(result.ok ? result.clients || [] : [])
      })
    }, 180)
    return () => window.clearTimeout(timer)
  }, [open, query, unitSlug])

  const choose = (name: string) => {
    onValueChange(name)
    setOpen(false)
    onClientSelected?.(name)
  }

  return (
    <div className="relative min-w-0">
      <Input
        {...props}
        value={value}
        onChange={(event) => {
          onValueChange(event.target.value)
          setOpen(true)
        }}
        onFocus={(event) => {
          setOpen(true)
          onFocus?.(event)
        }}
        onBlur={(event) => {
          window.setTimeout(() => setOpen(false), 140)
          onBlur?.(event)
        }}
        className={className}
        aria-autocomplete="list"
        aria-expanded={open && suggestions.length > 0}
        aria-controls={suggestions.length ? 'atendimento-client-suggestions' : undefined}
      />
      {open && suggestions.length > 0 ? (
        <div id="atendimento-client-suggestions" role="listbox" data-testid="atendimento-client-suggestions" className="absolute left-0 top-[calc(100%+0.25rem)] z-50 max-h-52 w-full overflow-y-auto rounded-lg border border-slate-700 bg-slate-950/98 p-1 shadow-xl backdrop-blur">
          {suggestions.map((client) => (
            <button key={client.name} type="button" role="option" aria-selected={false} onMouseDown={(event) => event.preventDefault()} onClick={() => choose(client.name)} className="flex w-full items-center justify-between gap-2 rounded-md px-2 py-1.5 text-left text-xs text-slate-100 transition hover:bg-sky-400/15 focus:bg-sky-400/15 focus:outline-none">
              <span className="min-w-0 truncate">{client.name}</span>
              {client.usageCount > 0 ? <span className="shrink-0 text-[10px] text-slate-500">{client.usageCount} atend.</span> : null}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  )
}
