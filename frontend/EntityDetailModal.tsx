import { Button } from '@/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/dialog'
import { TooltipLabel } from '@/tooltip'
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
  icon,
  description,
}: {
  label: string
  value: unknown
  icon?: ReactNode
  description?: string
}) {
  if (icon) {
    return (
      <TooltipLabel label={label} description={description}>
        <div className="flex items-center gap-3 rounded-2xl border border-slate-800/80 bg-slate-900/55 p-3">
          <span className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-sky-400/20 bg-sky-400/10 text-sky-100" aria-hidden>
            {icon}
          </span>
          <span className="min-w-0">
            <span className="sr-only">{label}</span>
            <span className="block text-xl font-semibold leading-tight text-slate-100">{formatDetailValue(value, label)}</span>
          </span>
        </div>
      </TooltipLabel>
    )
  }
  return (
    <div className="rounded-2xl border border-slate-800/80 bg-slate-900/55 p-3">
      <div className="text-[11px] uppercase tracking-[0.18em] text-slate-400">{label}</div>
      <div className="mt-1 text-sm text-slate-100">{formatDetailValue(value, label)}</div>
    </div>
  )
}

export type EntityDetailSection = {
  title: string
  fields: Array<{ label: string; value: unknown; icon?: ReactNode; description?: string }>
}

export function EntityDetailModal({
  open,
  onOpenChange,
  title,
  description,
  titleMeta,
  previewUrl,
  headerAccessory,
  closeIcon,
  closeLabel,
  sections,
  children,
  footer,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: ReactNode
  description: string
  titleMeta?: ReactNode
  previewUrl?: string | null
  headerAccessory?: ReactNode
  closeIcon?: ReactNode
  closeLabel?: string
  sections: EntityDetailSection[]
  children?: ReactNode
  footer?: ReactNode
}) {
  const titleText = typeof title === 'string' ? title : description

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="max-h-[90vh] overflow-y-auto border-slate-800/80 bg-slate-950 text-slate-100"
        style={{ width: 'min(92vw, 56rem)', maxWidth: 'calc(100vw - 1rem)' }}
        closeIcon={closeIcon}
        closeLabel={closeLabel}
      >
        <DialogHeader>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div className="min-w-0 flex-1">
              <DialogTitle className="text-xl leading-tight sm:text-2xl">{title}</DialogTitle>
              <DialogDescription className="max-w-2xl text-slate-300">{description}</DialogDescription>
              {titleMeta ? <div className="mt-2">{titleMeta}</div> : null}
            </div>
            {headerAccessory ? <div className="max-w-full shrink-0 sm:max-w-[52%]">{headerAccessory}</div> : null}
          </div>
        </DialogHeader>

        <div className="space-y-6">
          {previewUrl ? (
            <div className="overflow-hidden rounded-3xl border border-slate-800/80 bg-slate-950/80">
              <img src={previewUrl} alt={titleText} loading="lazy" decoding="async" referrerPolicy="no-referrer" className="h-64 w-full object-contain" />
            </div>
          ) : null}

          {children}

          {sections.map((section) => (
            <div key={section.title} className="space-y-3">
              <div className="text-sm font-medium text-white">{section.title}</div>
              <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                {section.fields.map((field) => (
                  <EntityDetailField key={`${section.title}:${field.label}`} label={field.label} value={field.value} icon={field.icon} description={field.description} />
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
