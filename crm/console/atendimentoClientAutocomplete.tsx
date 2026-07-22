import React, { useEffect, useId, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Input } from '@/input'
import { fetchAtendimentoClientSuggestions, type AtendimentoClientSuggestion } from '@/atendimentoApi'

type AtendimentoClientAutocompleteProps = Omit<React.ComponentProps<typeof Input>, 'value' | 'onChange'> & {
  value: string
  unitSlug: string
  fallbackSuggestions?: AtendimentoClientSuggestion[]
  onValueChange: (value: string) => void
  onClientSelected?: (value: string) => void
}

function normalizeSearchText(value: string) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLocaleLowerCase('pt-BR')
    .trim()
}

export function filterAtendimentoClientSuggestions(
  query: string,
  fallbackSuggestions: AtendimentoClientSuggestion[] = [],
): AtendimentoClientSuggestion[] {
  const normalizedQuery = normalizeSearchText(query)
  if (normalizedQuery.length < 2) return []

  return fallbackSuggestions
    .filter((client) => normalizeSearchText(client.name).includes(normalizedQuery))
    .sort((left, right) => right.usageCount - left.usageCount || left.name.localeCompare(right.name, 'pt-BR'))
    .slice(0, 8)
}

function mergeClientSuggestions(
  fallbackSuggestions: AtendimentoClientSuggestion[],
  remoteSuggestions: AtendimentoClientSuggestion[],
) {
  const merged = new Map<string, AtendimentoClientSuggestion>()
  for (const client of [...fallbackSuggestions, ...remoteSuggestions]) {
    const key = normalizeSearchText(client.name)
    if (!key) continue
    const existing = merged.get(key)
    if (!existing || client.usageCount > existing.usageCount) merged.set(key, client)
  }
  return [...merged.values()]
    .sort((left, right) => right.usageCount - left.usageCount || left.name.localeCompare(right.name, 'pt-BR'))
    .slice(0, 8)
}

/**
 * Combines the protected server-side search with clients already loaded for the
 * selected unit. The local list is an immediate, read-only fallback while the
 * debounced database query is in flight (or an older local API is unavailable).
 */
export function AtendimentoClientAutocomplete({
  value,
  unitSlug,
  fallbackSuggestions = [],
  onValueChange,
  onClientSelected,
  onFocus,
  onBlur,
  className,
  ...props
}: AtendimentoClientAutocompleteProps) {
  const [remoteSuggestions, setRemoteSuggestions] = useState<AtendimentoClientSuggestion[]>([])
  const [open, setOpen] = useState(false)
  const [activeIndex, setActiveIndex] = useState(-1)
  const [position, setPosition] = useState<{ left: number; top: number; width: number } | null>(null)
  const requestRef = useRef(0)
  const triggerRef = useRef<HTMLDivElement>(null)
  const listboxId = useId()
  const query = value.trim()
  const localSuggestions = filterAtendimentoClientSuggestions(query, fallbackSuggestions)
  const suggestions = mergeClientSuggestions(localSuggestions, remoteSuggestions)

  useEffect(() => {
    if (!open || query.length < 2 || !unitSlug) {
      setRemoteSuggestions([])
      return
    }
    const requestId = ++requestRef.current
    const timer = window.setTimeout(() => {
      void fetchAtendimentoClientSuggestions(unitSlug, query).then((result) => {
        if (requestId !== requestRef.current) return
        setRemoteSuggestions(result.ok ? result.clients || [] : [])
      })
    }, 180)
    return () => window.clearTimeout(timer)
  }, [open, query, unitSlug])

  useEffect(() => {
    setActiveIndex(-1)
  }, [query, suggestions.length])

  useLayoutEffect(() => {
    if (!open || !suggestions.length) {
      setPosition(null)
      return
    }
    const updatePosition = () => {
      const rect = triggerRef.current?.getBoundingClientRect()
      if (!rect) return
      setPosition({ left: rect.left, top: rect.bottom + 4, width: rect.width })
    }
    updatePosition()
    window.addEventListener('resize', updatePosition)
    window.addEventListener('scroll', updatePosition, true)
    return () => {
      window.removeEventListener('resize', updatePosition)
      window.removeEventListener('scroll', updatePosition, true)
    }
  }, [open, suggestions.length])

  const choose = (name: string) => {
    onValueChange(name)
    setOpen(false)
    onClientSelected?.(name)
  }

  return (
    <div ref={triggerRef} className="relative min-w-0">
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
        onKeyDown={(event) => {
          if (suggestions.length && event.key === 'ArrowDown') {
            event.preventDefault()
            setOpen(true)
            setActiveIndex((index) => Math.min(index + 1, suggestions.length - 1))
            return
          }
          if (suggestions.length && event.key === 'ArrowUp') {
            event.preventDefault()
            setActiveIndex((index) => Math.max(index - 1, 0))
            return
          }
          if (suggestions.length && event.key === 'Enter' && activeIndex >= 0) {
            event.preventDefault()
            choose(suggestions[activeIndex].name)
            return
          }
          if (event.key === 'Escape') {
            setOpen(false)
            return
          }
          props.onKeyDown?.(event)
        }}
        className={className}
        aria-autocomplete="list"
        aria-expanded={open && suggestions.length > 0}
        aria-activedescendant={activeIndex >= 0 ? `${listboxId}-${activeIndex}` : undefined}
        aria-controls={suggestions.length ? listboxId : undefined}
      />
      {open && suggestions.length > 0 && position && typeof document !== 'undefined' ? createPortal(
        <div id={listboxId} role="listbox" data-testid="atendimento-client-suggestions" className="fixed z-[1100] max-h-52 overflow-y-auto rounded-lg border border-slate-700 bg-slate-950/98 p-1 shadow-2xl backdrop-blur" style={{ left: position.left, top: position.top, width: position.width }}>
          {suggestions.map((client, index) => (
            <button id={`${listboxId}-${index}`} key={client.name} type="button" role="option" aria-selected={activeIndex === index} onMouseDown={(event) => event.preventDefault()} onClick={() => choose(client.name)} className={`flex w-full items-center justify-between gap-2 rounded-md px-2 py-1.5 text-left text-xs text-slate-100 transition focus:outline-none ${activeIndex === index ? 'bg-sky-400/15' : 'hover:bg-sky-400/15 focus:bg-sky-400/15'}`}>
              <span className="min-w-0 truncate">{client.name}</span>
              {client.usageCount > 0 ? <span className="shrink-0 text-[10px] text-slate-500">{client.usageCount} atend.</span> : null}
            </button>
          ))}
        </div>
      , document.body) : null}
    </div>
  )
}
