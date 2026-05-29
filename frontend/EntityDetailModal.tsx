import { Button } from '@/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/dialog'
import type { ReactNode } from 'react'

const DATE_LABEL_PATTERN = /(início|fim|criado em|atualizado em)/i
const BUDGET_LABEL_PATTERN = /orçamento/i

function formatDetailDate(value: string) {
  const normalized = value.replace(/([+-]\d{2})(\d{2})$/, '$1:$2')
  const date = new Date(normalized)
  if (Number.isNaN(date.getTime())) return value
  return new Intl.DateTimeFormat('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    year: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date)
}

function formatDetailBudget(value: string) {
  if (/^(R\$|US\$)/i.test(value.trim())) return value
  const cents = Number(value.replace(/[^\d.-]/g, ''))
  if (!Number.isFinite(cents)) return value
  return new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: 'BRL',
    maximumFractionDigits: 2,
  }).format(cents / 100)
}

function formatDetailValue(value: unknown, label?: string) {
  if (value == null || value === '') return '—'
  if (typeof value === 'boolean') return value ? 'Sim' : 'Não'
  if (Array.isArray(value)) {
    if (!value.length) return '—'
    const primitiveValues = value.filter((item) => ['string', 'number', 'boolean'].includes(typeof item))
    if (primitiveValues.length === value.length) return primitiveValues.map(String).join(', ')
    return `${value.length} ${value.length === 1 ? 'registro disponível' : 'registros disponíveis'}`
  }
  if (typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, item]) => ['string', 'number', 'boolean'].includes(typeof item))
      .slice(0, 3)
      .map(([key, item]) => `${key.replace(/_/g, ' ')}: ${String(item)}`)
    return entries.length ? entries.join(' · ') : 'Configuração disponível'
  }
  const stringValue = String(value)
  if (label && BUDGET_LABEL_PATTERN.test(label)) return formatDetailBudget(stringValue)
  return label && DATE_LABEL_PATTERN.test(label) ? formatDetailDate(stringValue) : stringValue
}

export function EntityDetailField({
  label,
  value,
}: {
  label: string
  value: unknown
}) {
  return (
    <div className="rounded-2xl border border-slate-800/80 bg-slate-900/55 p-3">
      <div className="text-[11px] uppercase tracking-[0.18em] text-slate-400">{label}</div>
      <div className="mt-1 text-sm text-slate-100">{formatDetailValue(value, label)}</div>
    </div>
  )
}

export type EntityDetailSection = {
  title: string
  fields: Array<{ label: string; value: unknown }>
}

export function EntityDetailModal({
  open,
  onOpenChange,
  title,
  description,
  previewUrl,
  headerAccessory,
  sections,
  children,
  footer,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: string
  description: string
  previewUrl?: string | null
  headerAccessory?: ReactNode
  sections: EntityDetailSection[]
  children?: ReactNode
  footer?: ReactNode
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent resizable={false} className="max-h-[85vh] max-w-4xl overflow-y-auto border-slate-800/80 bg-slate-950 text-slate-100">
        <DialogHeader>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div className="min-w-0">
              <DialogTitle>{title}</DialogTitle>
              <DialogDescription className="text-slate-300">{description}</DialogDescription>
            </div>
            {headerAccessory ? <div className="shrink-0">{headerAccessory}</div> : null}
          </div>
        </DialogHeader>

        <div className="space-y-6">
          {previewUrl ? (
            <div className="overflow-hidden rounded-3xl border border-slate-800/80 bg-slate-950/80">
              <img src={previewUrl} alt={title} loading="lazy" decoding="async" referrerPolicy="no-referrer" className="h-64 w-full object-contain" />
            </div>
          ) : null}

          {children}

          {sections.map((section) => (
            <div key={section.title} className="space-y-3">
              <div className="text-sm font-medium text-white">{section.title}</div>
              <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                {section.fields.map((field) => (
                  <EntityDetailField key={`${section.title}:${field.label}`} label={field.label} value={field.value} />
                ))}
              </div>
            </div>
          ))}
        </div>

        <DialogFooter>
          {footer || (
            <Button
              type="button"
              variant="outline"
              className="border-slate-700 bg-slate-900/60 text-slate-100 hover:bg-slate-800/80"
              onClick={() => onOpenChange(false)}
            >
              Fechar
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
