import { Button } from '@/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/dialog'

function formatDetailValue(value: unknown) {
  if (value == null || value === '') return '—'
  if (typeof value === 'boolean') return value ? 'Sim' : 'Não'
  if (Array.isArray(value)) return value.length ? value.join(', ') : '—'
  return String(value)
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
      <div className="mt-1 text-sm text-slate-100">{formatDetailValue(value)}</div>
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
  sections,
  rawPayload,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: string
  description: string
  previewUrl?: string | null
  sections: EntityDetailSection[]
  rawPayload: unknown
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] max-w-4xl overflow-y-auto border-slate-800/80 bg-slate-950 text-slate-100">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription className="text-slate-300">{description}</DialogDescription>
        </DialogHeader>

        <div className="space-y-6">
          {previewUrl ? (
            <div className="overflow-hidden rounded-3xl border border-slate-800/80 bg-slate-900/60">
              <img src={previewUrl} alt={title} className="h-64 w-full object-cover" />
            </div>
          ) : null}

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

          <div className="space-y-3">
            <div className="text-sm font-medium text-white">JSON técnico</div>
            <div className="overflow-hidden rounded-3xl border border-slate-800/80 bg-slate-900/60">
              <pre className="max-h-80 overflow-auto p-4 text-xs text-slate-300">
                {JSON.stringify(rawPayload, null, 2)}
              </pre>
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            className="border-slate-700 bg-slate-900/60 text-slate-100 hover:bg-slate-800/80"
            onClick={() => onOpenChange(false)}
          >
            Fechar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
