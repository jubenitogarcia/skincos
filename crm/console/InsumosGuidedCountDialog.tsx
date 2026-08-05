import React from 'react'
import { Badge } from '@/badge'
import { Button } from '@/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/dialog'
import { Input } from '@/input'
import { Textarea } from '@/textarea'

type ApiJson = <T>(path: string, opts?: { method?: string; body?: unknown; idempotencyKey?: string | null }) => Promise<T>

export type GuidedCountLine = {
  id?: string
  registro?: string
  codigoBarras?: string
  produto?: string
  lote?: string | null
  dataValidade?: string | null
  snapshotQuantity?: number
  physicalQuantity?: number | null
  status?: string
}

export type GuidedCountSession = {
  id?: string
  unidade?: string
  status?: string
  snapshotAt?: string
  startedAt?: string
  startedBy?: string
  closedAt?: string | null
  conflictAt?: string | null
  conflictReason?: string | null
  lines?: GuidedCountLine[]
}

type InsumosGuidedCountDialogProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  dialogClassName?: string
  isAuthed: boolean
  managerRole: boolean
  unit: string
  unitLabel: string
  apiJson: ApiJson
  onRefresh: () => void
}

function unwrap<T>(value: any): T {
  return (value?.data ?? value) as T
}

function newIdempotencyKey(prefix: string) {
  try {
    return `${prefix}:${crypto.randomUUID()}`
  } catch {
    return `${prefix}:${Date.now()}`
  }
}

function formatDate(value?: string | null) {
  if (!value) return '-'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return String(value).slice(0, 16).replace('T', ' ')
  return date.toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })
}

function statusLabel(value?: string) {
  const status = String(value || '').toUpperCase()
  if (status === 'CONFLICT') return 'Conflito — recontagem necessária'
  if (status === 'CLOSED') return 'Fechada'
  if (status === 'CANCELLED') return 'Cancelada'
  return 'Aberta'
}

export function InsumosGuidedCountDialog({
  open,
  onOpenChange,
  dialogClassName,
  isAuthed,
  managerRole,
  unit,
  unitLabel,
  apiJson,
  onRefresh,
}: InsumosGuidedCountDialogProps) {
  const [session, setSession] = React.useState<GuidedCountSession | null>(null)
  const [loading, setLoading] = React.useState(false)
  const [saving, setSaving] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const [notes, setNotes] = React.useState('')
  const [search, setSearch] = React.useState('')
  const [quantities, setQuantities] = React.useState<Record<string, string>>({})

  const reset = React.useCallback(() => {
    setSession(null)
    setLoading(false)
    setSaving(false)
    setError(null)
    setNotes('')
    setSearch('')
    setQuantities({})
  }, [])

  React.useEffect(() => {
    if (!open) reset()
  }, [open, reset])

  const loadSession = React.useCallback(
    async (id: string) => {
      setLoading(true)
      setError(null)
      try {
        const response = await apiJson<any>(`/contagens/${encodeURIComponent(id)}?unidade=${encodeURIComponent(unit)}`)
        const next = unwrap<GuidedCountSession>(response)
        setSession(next)
        const nextQuantities: Record<string, string> = {}
        for (const line of next.lines || []) {
          if (line.id && line.physicalQuantity != null) nextQuantities[line.id] = String(line.physicalQuantity)
        }
        setQuantities(nextQuantities)
      } catch (cause: any) {
        setError(cause?.message || 'Não foi possível carregar a sessão de contagem.')
      } finally {
        setLoading(false)
      }
    },
    [apiJson, unit],
  )

  const startSession = React.useCallback(async () => {
    if (!isAuthed || !unit) return
    setSaving(true)
    setError(null)
    try {
      const response = await apiJson<any>(`/contagens?unidade=${encodeURIComponent(unit)}`, {
        method: 'POST',
        body: { observacoes: notes.trim() || undefined },
        idempotencyKey: newIdempotencyKey('contagem-start'),
      })
      const next = unwrap<GuidedCountSession>(response)
      setSession(next)
      if (next.id) await loadSession(String(next.id))
    } catch (cause: any) {
      if (cause?.code === 'COUNT_ALREADY_OPEN' && cause?.sessionId) {
        await loadSession(String(cause.sessionId))
        return
      }
      setError(cause?.message || 'Não foi possível iniciar a contagem.')
    } finally {
      setSaving(false)
    }
  }, [apiJson, isAuthed, loadSession, notes, unit])

  const recordLine = React.useCallback(
    async (line: GuidedCountLine) => {
      if (!session?.id || !line.registro) return
      const raw = quantities[String(line.id || line.registro)] ?? ''
      const quantity = Number(raw)
      if (!Number.isInteger(quantity) || quantity < 0) {
        setError('Informe uma quantidade física inteira e não negativa.')
        return
      }
      setSaving(true)
      setError(null)
      try {
        await apiJson(`/contagens/${encodeURIComponent(session.id)}/leituras?unidade=${encodeURIComponent(unit)}`, {
          method: 'POST',
          body: { registro: line.registro, lote: line.lote || undefined, quantidade },
          idempotencyKey: newIdempotencyKey(`contagem-read:${line.registro}`),
        })
        await loadSession(String(session.id))
      } catch (cause: any) {
        setError(cause?.message || 'Não foi possível registrar a leitura.')
      } finally {
        setSaving(false)
      }
    },
    [apiJson, loadSession, quantities, session?.id, unit],
  )

  const closeSession = React.useCallback(async () => {
    if (!session?.id || !managerRole) return
    setSaving(true)
    setError(null)
    try {
      await apiJson(`/contagens/${encodeURIComponent(session.id)}/fechar?unidade=${encodeURIComponent(unit)}`, {
        method: 'POST',
        idempotencyKey: newIdempotencyKey(`contagem-close:${session.id}`),
      })
      await loadSession(String(session.id))
      onRefresh()
    } catch (cause: any) {
      setError(cause?.message || 'A sessão não pôde ser fechada.')
      if (cause?.code === 'COUNT_CONFLICT' && session.id) await loadSession(String(session.id))
    } finally {
      setSaving(false)
    }
  }, [apiJson, loadSession, managerRole, onRefresh, session?.id, unit])

  const recountSession = React.useCallback(async () => {
    if (!session?.id || !managerRole) return
    setSaving(true)
    setError(null)
    try {
      await apiJson(`/contagens/${encodeURIComponent(session.id)}/recontar?unidade=${encodeURIComponent(unit)}`, {
        method: 'POST',
        idempotencyKey: newIdempotencyKey(`contagem-recount:${session.id}`),
      })
      await loadSession(String(session.id))
    } catch (cause: any) {
      setError(cause?.message || 'Não foi possível abrir a recontagem.')
    } finally {
      setSaving(false)
    }
  }, [apiJson, loadSession, managerRole, session?.id, unit])

  const lines = React.useMemo(() => {
    const query = search.trim().toLocaleLowerCase('pt-BR')
    const source = session?.lines || []
    if (!query) return source
    return source.filter((line) => [line.registro, line.codigoBarras, line.produto, line.lote].some((value) => String(value || '').toLocaleLowerCase('pt-BR').includes(query)))
  }, [search, session?.lines])

  const counted = (session?.lines || []).filter((line) => String(line.status || '').toUpperCase() === 'COUNTED' || line.physicalQuantity != null).length
  const isClosed = ['CLOSED', 'CANCELLED'].includes(String(session?.status || '').toUpperCase())
  const isConflict = String(session?.status || '').toUpperCase() === 'CONFLICT'

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="wideTable" className={`${dialogClassName || ''} dark bg-corporate-900 border-white/10 text-white`}>
        <DialogHeader>
          <DialogTitle className="text-white">Contagem física guiada</DialogTitle>
          <DialogDescription className="text-blue-100/70">
            Unidade: <span className="font-medium text-blue-50">{unitLabel || unit}</span>. O snapshot é fechado pelo backend e toda diferença vira ajuste auditável.
          </DialogDescription>
        </DialogHeader>

        {error ? <div role="alert" className="rounded-lg border border-red-300/30 bg-red-500/10 px-3 py-2 text-sm text-red-100">{error}</div> : null}

        {!session ? (
          <div className="space-y-4 rounded-xl border border-white/10 bg-black/20 p-4">
            <div className="text-sm text-blue-100/80">Inicie uma sessão para congelar o saldo por lote e registrar a contagem sem alterar o histórico original.</div>
            <Textarea value={notes} onChange={(event) => setNotes(event.target.value)} placeholder="Observações da sessão (opcional)" className="min-h-20" disabled={!isAuthed || saving} />
            <Button onClick={() => void startSession()} disabled={!isAuthed || !unit || saving}>
              {saving ? 'Iniciando…' : 'Iniciar sessão'}
            </Button>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="flex flex-wrap items-center gap-2 rounded-xl border border-white/10 bg-black/20 p-3 text-sm">
              <Badge variant={isConflict ? 'destructive' : isClosed ? 'secondary' : 'default'}>{statusLabel(session.status)}</Badge>
              <span className="text-blue-100/70">Snapshot {formatDate(session.snapshotAt)}</span>
              <span className="text-blue-100/70">{counted}/{session.lines?.length || 0} lotes lidos</span>
              {session.startedBy ? <span className="text-blue-100/60">por {session.startedBy}</span> : null}
              <Input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Ler/buscar registro, código ou lote" className="ml-auto h-9 min-w-[220px] max-w-md" disabled={loading} />
            </div>

            {isConflict ? <div className="rounded-lg border border-amber-300/30 bg-amber-500/10 px-3 py-2 text-sm text-amber-100">Foi detectada movimentação depois do snapshot. Reabra a sessão para obter novo saldo antes de fechar.</div> : null}

            <div className="max-h-[52vh] overflow-auto rounded-xl border border-white/10">
              <table className="w-full text-sm">
                <thead className="sticky top-0 z-10 bg-corporate-900/95 text-blue-100/80">
                  <tr>
                    <th className="p-3 text-left">Produto / lote</th>
                    <th className="p-3 text-right">Snapshot</th>
                    <th className="p-3 text-right">Física</th>
                    <th className="p-3 text-right">Ação</th>
                  </tr>
                </thead>
                <tbody>
                  {lines.map((line) => {
                    const key = String(line.id || line.registro || '')
                    const physical = quantities[key] ?? (line.physicalQuantity == null ? '' : String(line.physicalQuantity))
                    const done = line.physicalQuantity != null || String(line.status || '').toUpperCase() === 'COUNTED'
                    return (
                      <tr key={key} className="border-t border-white/10 align-middle">
                        <td className="p-3">
                          <div className="font-medium text-white">{line.produto || line.registro || 'Sem descrição'}</div>
                          <div className="text-xs text-blue-100/60">{line.registro || '-'} · lote {line.lote || 'sem lote'}{line.codigoBarras ? ` · ${line.codigoBarras}` : ''}</div>
                        </td>
                        <td className="p-3 text-right font-mono text-blue-100/80">{Number(line.snapshotQuantity || 0)}</td>
                        <td className="p-3 text-right"><Input aria-label={`Física ${line.registro || line.produto || ''}`} value={physical} onChange={(event) => setQuantities((prev) => ({ ...prev, [key]: event.target.value }))} className="ml-auto h-9 w-24 text-right" inputMode="numeric" min={0} disabled={isClosed || saving} /></td>
                        <td className="p-3 text-right"><Button size="sm" variant={done ? 'outline' : 'default'} onClick={() => void recordLine(line)} disabled={isClosed || saving || loading}>{done ? 'Atualizar' : 'Registrar'}</Button></td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
              {!lines.length ? <div className="p-6 text-center text-sm text-blue-100/60">Nenhum lote corresponde à leitura.</div> : null}
            </div>
          </div>
        )}

        {session ? (
          <DialogFooter className="gap-2 sm:justify-between">
            <Button variant="ghost" onClick={() => onOpenChange(false)}>Fechar janela</Button>
            <div className="flex flex-wrap gap-2">
              {isConflict && managerRole ? <Button variant="outline" onClick={() => void recountSession()} disabled={saving}>Recontar snapshot</Button> : null}
              {!isClosed && managerRole ? <Button onClick={() => void closeSession()} disabled={saving || loading || counted !== (session.lines || []).length}>{saving ? 'Fechando…' : 'Fechar e ajustar'}</Button> : null}
            </div>
          </DialogFooter>
        ) : null}
      </DialogContent>
    </Dialog>
  )
}
