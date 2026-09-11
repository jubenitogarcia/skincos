import React from 'react'
import { CalendarPlus, Repeat, Plus } from '@phosphor-icons/react'
import { toast } from 'sonner'
import { Button } from '@/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/card'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/dialog'
import { Input } from '@/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/select'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/table'
import { Textarea } from '@/textarea'
import { FinanceApiError, financeApi, minorUnitsFromDisplay, type FinanceRecurrence } from '@/financeApi'

type RecurrenceDraft = { kind: 'payable' | 'receivable'; description: string; amount: string; competenceDay: string; dueDay: string; startsOn: string; endsOn: string; categoryId: string; payeeId: string; costCenterId: string; notes: string }
const today = new Date().toISOString().slice(0, 10)
const emptyDraft = (): RecurrenceDraft => ({ kind: 'payable', description: '', amount: '', competenceDay: String(Number(today.slice(8))), dueDay: String(Number(today.slice(8))), startsOn: today, endsOn: '', categoryId: '', payeeId: '', costCenterId: '', notes: '' })
function money(value = 0, currency = 'BRL') { return new Intl.NumberFormat('pt-BR', { style: 'currency', currency }).format(Number(value || 0) / 100) }
function advanceMonths(isoDate: string, months: number) { const [year, month, day] = isoDate.split('-').map(Number); const result = new Date(Date.UTC(year, month - 1 + months, day)); return result.toISOString().slice(0, 10) }
function message(cause: unknown) { if (cause instanceof FinanceApiError && cause.code === 'IDEMPOTENCY_CONFLICT') return 'Conflito de idempotência: essa operação já foi enviada com dados diferentes.'; return cause instanceof Error ? cause.message : 'Não foi possível concluir a operação.' }

export function FinanceRecurrencesPanel({ scopeId, canOperate, categories, payees, costCenters, onChanged }: { scopeId: string; canOperate: boolean; categories: any[]; payees: any[]; costCenters: any[]; onChanged: () => Promise<void> }) {
  const [recurrences, setRecurrences] = React.useState<FinanceRecurrence[]>([])
  const [loading, setLoading] = React.useState(true)
  const [error, setError] = React.useState('')
  const [busy, setBusy] = React.useState('')
  const [createOpen, setCreateOpen] = React.useState(false)
  const [materializeOpen, setMaterializeOpen] = React.useState<FinanceRecurrence | null>(null)
  const [throughDate, setThroughDate] = React.useState(advanceMonths(today, 3))
  const [draft, setDraft] = React.useState<RecurrenceDraft>(emptyDraft)

  const load = React.useCallback(async () => {
    if (!scopeId) return
    setLoading(true); setError('')
    try { const response = await financeApi.recurrences(scopeId, { limit: 100 }); setRecurrences(response.recurrences || []) }
    catch (cause) { setError(message(cause)) } finally { setLoading(false) }
  }, [scopeId])
  React.useEffect(() => { void load() }, [load])

  const run = async (name: string, action: () => Promise<void>) => {
    setBusy(name)
    try { await action(); await Promise.all([load(), onChanged()]); toast.success('Operação concluída e registrada na auditoria.') }
    catch (cause) { toast.error(message(cause)) } finally { setBusy('') }
  }
  const compatibleCategories = categories.filter((category) => category.direction === (draft.kind === 'payable' ? 'expense' : 'income'))
  const create = () => void run('create', async () => {
    const amountMinor = minorUnitsFromDisplay(draft.amount)
    const competenceDay = Number(draft.competenceDay); const dueDay = Number(draft.dueDay)
    if (!amountMinor) throw new Error('Informe um valor positivo com no máximo duas casas decimais.')
    if (!Number.isInteger(competenceDay) || competenceDay < 1 || competenceDay > 31 || !Number.isInteger(dueDay) || dueDay < 1 || dueDay > 31) throw new Error('Informe dias entre 1 e 31.')
    await financeApi.createRecurrence(scopeId, { kind: draft.kind, frequency: 'monthly', description: draft.description, amountMinor, currency: 'BRL', competenceDay, dueDay, startsOn: draft.startsOn, endsOn: draft.endsOn || undefined, categoryId: draft.categoryId || undefined, payeeId: draft.payeeId || undefined, costCenterId: draft.costCenterId || undefined, notes: draft.notes || undefined })
    setCreateOpen(false); setDraft(emptyDraft())
  })
  const materialize = () => void run('materialize', async () => {
    if (!materializeOpen) return
    await financeApi.materializeRecurrence(scopeId, materializeOpen.id, throughDate)
    setMaterializeOpen(null)
  })

  return <Card className="glass-card"><CardHeader><div className="flex flex-wrap items-start justify-between gap-3"><div><CardTitle className="flex items-center gap-2"><Repeat size={20} />Recorrências mensais</CardTitle><CardDescription>Modelos de títulos recorrentes. Materializar cria contas a pagar ou receber auditáveis; não movimenta caixa nem posta no razão.</CardDescription></div>{canOperate ? <Button variant="outline" onClick={() => setCreateOpen(true)}><Plus size={16} />Nova recorrência</Button> : null}</div></CardHeader><CardContent>{loading ? <PanelState text="Carregando recorrências…" /> : error ? <PanelState text={error} action={<Button variant="outline" onClick={() => void load()}>Tentar novamente</Button>} /> : recurrences.length ? <Table><TableHeader><TableRow><TableHead>Descrição</TableHead><TableHead>Fluxo</TableHead><TableHead>Regra</TableHead><TableHead>Próximo título</TableHead><TableHead className="text-right">Valor</TableHead><TableHead className="text-right">Ação</TableHead></TableRow></TableHeader><TableBody>{recurrences.map((item) => <TableRow key={item.id}><TableCell className="font-medium">{item.description}</TableCell><TableCell>{item.kind === 'payable' ? 'A pagar' : 'A receber'}</TableCell><TableCell>Todo mês · vencimento dia {item.due_day}</TableCell><TableCell>{item.active ? item.next_due_date : 'Encerrada'}</TableCell><TableCell className="text-right">{money(item.amount_minor, item.currency)}</TableCell><TableCell className="text-right">{canOperate && item.active ? <Button size="sm" variant="outline" onClick={() => { setThroughDate(advanceMonths(item.next_due_date, 2)); setMaterializeOpen(item) }}>Gerar títulos</Button> : null}</TableCell></TableRow>)}</TableBody></Table> : <PanelState text="Nenhuma recorrência configurada neste escopo." action={canOperate ? <Button variant="outline" onClick={() => setCreateOpen(true)}>Criar recorrência</Button> : undefined} />}</CardContent>

    <Dialog open={createOpen} onOpenChange={(open) => { setCreateOpen(open); if (!open) setDraft(emptyDraft()) }}><DialogContent className="sm:max-w-2xl"><DialogHeader><DialogTitle>Nova recorrência mensal</DialogTitle><DialogDescription>Os dados ficam no Financeiro como uma regra de planejamento. O servidor ajusta meses curtos e só cria títulos quando você confirmar a materialização.</DialogDescription></DialogHeader><div className="grid max-h-[65vh] gap-4 overflow-y-auto pr-1 md:grid-cols-2"><SelectField label="Tipo" value={draft.kind} onChange={(value) => setDraft((current) => ({ ...current, kind: value as RecurrenceDraft['kind'], categoryId: '' }))} items={[{ id: 'payable', name: 'Conta a pagar' }, { id: 'receivable', name: 'Conta a receber' }]} /><label className="grid gap-1 text-sm">Valor<Input inputMode="decimal" value={draft.amount} onChange={(event) => setDraft((current) => ({ ...current, amount: event.target.value }))} placeholder="0,00" /></label><label className="grid gap-1 text-sm md:col-span-2">Descrição<Input value={draft.description} onChange={(event) => setDraft((current) => ({ ...current, description: event.target.value }))} placeholder="Ex.: aluguel mensal" /></label><label className="grid gap-1 text-sm">Início<Input type="date" value={draft.startsOn} onChange={(event) => setDraft((current) => ({ ...current, startsOn: event.target.value }))} /></label><label className="grid gap-1 text-sm">Fim (opcional)<Input type="date" value={draft.endsOn} onChange={(event) => setDraft((current) => ({ ...current, endsOn: event.target.value }))} /></label><label className="grid gap-1 text-sm">Dia de competência<Input inputMode="numeric" value={draft.competenceDay} onChange={(event) => setDraft((current) => ({ ...current, competenceDay: event.target.value }))} /></label><label className="grid gap-1 text-sm">Dia de vencimento<Input inputMode="numeric" value={draft.dueDay} onChange={(event) => setDraft((current) => ({ ...current, dueDay: event.target.value }))} /></label><SelectField label="Categoria" value={draft.categoryId || 'none'} onChange={(value) => setDraft((current) => ({ ...current, categoryId: value === 'none' ? '' : value }))} items={[{ id: 'none', name: 'Sem categoria' }, ...compatibleCategories]} /><SelectField label="Favorecido" value={draft.payeeId || 'none'} onChange={(value) => setDraft((current) => ({ ...current, payeeId: value === 'none' ? '' : value }))} items={[{ id: 'none', name: 'Sem favorecido' }, ...payees]} /><SelectField label="Centro de custo" value={draft.costCenterId || 'none'} onChange={(value) => setDraft((current) => ({ ...current, costCenterId: value === 'none' ? '' : value }))} items={[{ id: 'none', name: 'Sem centro de custo' }, ...costCenters]} /><label className="grid gap-1 text-sm md:col-span-2">Observação<Textarea value={draft.notes} onChange={(event) => setDraft((current) => ({ ...current, notes: event.target.value }))} /></label></div><DialogFooter><Button variant="outline" onClick={() => setCreateOpen(false)}>Cancelar</Button><Button onClick={create} disabled={busy === 'create'}>{busy === 'create' ? 'Salvando…' : 'Salvar recorrência'}</Button></DialogFooter></DialogContent></Dialog>

    <Dialog open={Boolean(materializeOpen)} onOpenChange={(open) => { if (!open) setMaterializeOpen(null) }}><DialogContent><DialogHeader><DialogTitle>Gerar títulos recorrentes</DialogTitle><DialogDescription>Serão criados apenas títulos ainda ausentes, até a data informada. A operação é idempotente e não cria movimentação de caixa.</DialogDescription></DialogHeader><label className="grid gap-1 text-sm">Gerar até<Input type="date" min={materializeOpen?.next_due_date} value={throughDate} onChange={(event) => setThroughDate(event.target.value)} /></label>{materializeOpen ? <p className="rounded-md border p-3 text-sm text-muted-foreground">Próxima ocorrência: {materializeOpen.next_due_date} · {money(materializeOpen.amount_minor, materializeOpen.currency)}</p> : null}<DialogFooter><Button variant="outline" onClick={() => setMaterializeOpen(null)}>Cancelar</Button><Button onClick={materialize} disabled={busy === 'materialize'}><CalendarPlus size={16} />{busy === 'materialize' ? 'Gerando…' : 'Confirmar geração'}</Button></DialogFooter></DialogContent></Dialog>
  </Card>
}

function SelectField({ label, value, onChange, items }: { label: string; value: string; onChange: (value: string) => void; items: Array<{ id: string; name: string }> }) { return <label className="grid gap-1 text-sm">{label}<Select value={value} onValueChange={onChange}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{items.map((item) => <SelectItem key={item.id} value={item.id}>{item.name}</SelectItem>)}</SelectContent></Select></label> }
function PanelState({ text, action }: { text: string; action?: React.ReactNode }) { return <div className="flex min-h-32 flex-col items-center justify-center gap-3 py-6 text-center"><Repeat size={26} className="text-muted-foreground" /><p className="max-w-md text-sm text-muted-foreground">{text}</p>{action}</div> }
