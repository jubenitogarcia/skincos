import React from 'react'
import { CheckCircle, ClipboardText, CurrencyDollar, Plus, WarningCircle } from '@phosphor-icons/react'
import { toast } from 'sonner'
import { Badge } from '@/badge'
import { Button } from '@/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/card'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/dialog'
import { Input } from '@/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/select'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/table'
import { Textarea } from '@/textarea'
import { FinanceApiError, financeApi, minorUnitsFromDisplay, type FinanceObligationFilters, type FinanceObligationSummary } from '@/financeApi'

type ObligationKind = 'payable' | 'receivable'
type ObligationStatus = 'open' | 'partially_settled' | 'settled' | 'cancelled'
type ObligationDraft = { kind: ObligationKind; description: string; amount: string; competenceDate: string; dueDate: string; plannedDate: string; categoryId: string; payeeId: string; costCenterId: string; notes: string }
type SettlementDraft = { movementId: string; principalAmount: string; interest: string; penalty: string; discount: string; allowance: string; paidDate: string }

const today = new Date().toISOString().slice(0, 10)
const monthStart = `${today.slice(0, 8)}01`
const PAGE_SIZE = 25
const emptyDraft = (): ObligationDraft => ({ kind: 'payable', description: '', amount: '', competenceDate: today, dueDate: today, plannedDate: '', categoryId: '', payeeId: '', costCenterId: '', notes: '' })
const emptySettlement = (): SettlementDraft => ({ movementId: '', principalAmount: '', interest: '', penalty: '', discount: '', allowance: '', paidDate: today })

function money(value = 0, currency = 'BRL') { return new Intl.NumberFormat('pt-BR', { style: 'currency', currency }).format(Number(value || 0) / 100) }
function minorToInput(value = 0) { return (Number(value || 0) / 100).toFixed(2).replace('.', ',') }
function labelKind(value?: string) { return value === 'payable' ? 'A pagar' : value === 'receivable' ? 'A receber' : value || '—' }
function labelStatus(value?: string) { return ({ open: 'Em aberto', partially_settled: 'Baixado parcialmente', settled: 'Liquidado', cancelled: 'Cancelado' } as Record<string, string>)[value || ''] || value || '—' }
function statusVariant(value?: string) { return value === 'settled' ? 'default' : value === 'cancelled' ? 'destructive' : value === 'partially_settled' ? 'secondary' : 'outline' }
function errorMessage(error: unknown) {
  if (error instanceof FinanceApiError) {
    if (error.code === 'IDEMPOTENCY_CONFLICT') return 'Conflito de idempotência: a mesma operação foi enviada com dados diferentes.'
    if (error.code === 'SCOPE_DENIED') return 'Este escopo não foi concedido para a sua sessão.'
    if (error.code === 'FINANCE_DISABLED') return 'O Financeiro está temporariamente desativado.'
    if (error.status === 503) return 'O serviço Financeiro está indisponível. Tente novamente.'
  }
  return error instanceof Error ? error.message : 'Não foi possível concluir a operação.'
}

export function FinanceObligationsPanel({ scopeId, canOperate, categories, payees, costCenters, onChanged }: { scopeId: string; canOperate: boolean; categories: any[]; payees: any[]; costCenters: any[]; onChanged: () => Promise<void> }) {
  const [filters, setFilters] = React.useState<FinanceObligationFilters>({ from: monthStart, to: today, page: 1, limit: PAGE_SIZE })
  const [page, setPage] = React.useState<{ obligations: any[]; total: number; page: number; limit: number }>({ obligations: [], total: 0, page: 1, limit: PAGE_SIZE })
  const [summary, setSummary] = React.useState<FinanceObligationSummary | null>(null)
  const [loading, setLoading] = React.useState(true)
  const [error, setError] = React.useState('')
  const [busy, setBusy] = React.useState('')
  const [createOpen, setCreateOpen] = React.useState(false)
  const [detailOpen, setDetailOpen] = React.useState(false)
  const [settleOpen, setSettleOpen] = React.useState(false)
  const [draft, setDraft] = React.useState<ObligationDraft>(emptyDraft)
  const [selected, setSelected] = React.useState<any>(null)
  const [detail, setDetail] = React.useState<any>(null)
  const [auditEvents, setAuditEvents] = React.useState<any[]>([])
  const [settlement, setSettlement] = React.useState<SettlementDraft>(emptySettlement)
  const [settlementMovements, setSettlementMovements] = React.useState<any[]>([])
  const [cancelReason, setCancelReason] = React.useState('')

  const load = React.useCallback(async (nextFilters = filters) => {
    if (!scopeId) return
    setLoading(true); setError('')
    try {
      const result = await financeApi.obligations(scopeId, nextFilters)
      setPage({ obligations: result.obligations || [], total: Number(result.total || 0), page: Number(result.page || 1), limit: Number(result.limit || PAGE_SIZE) })
    } catch (cause) { setError(errorMessage(cause)) } finally { setLoading(false) }
  }, [filters, scopeId])

  React.useEffect(() => { void load() }, [load])
  React.useEffect(() => { void financeApi.obligationSummary(scopeId, { asOf: today, horizonDays: 30 }).then(setSummary).catch(() => setSummary(null)) }, [scopeId])

  const updateFilters = (changes: Partial<FinanceObligationFilters>) => setFilters((current) => ({ ...current, ...changes, page: changes.page === undefined ? 1 : changes.page }))
  const reloadEverything = async () => { const nextSummary = financeApi.obligationSummary(scopeId, { asOf: today, horizonDays: 30 }); await Promise.all([load(), onChanged(), nextSummary.then(setSummary)] ) }
  const run = async (label: string, action: () => Promise<void>) => {
    setBusy(label)
    try { await action(); toast.success('Operação concluída e registrada na auditoria.'); await reloadEverything() }
    catch (cause) { toast.error(errorMessage(cause)) }
    finally { setBusy('') }
  }

  const openDetail = async (obligation: any) => {
    setSelected(obligation); setDetailOpen(true); setDetail(null); setAuditEvents([])
    try {
      const [nextDetail, audit] = await Promise.all([
        financeApi.obligation(scopeId, obligation.id),
        financeApi.audit(scopeId, { entityType: 'obligation', entityId: obligation.id, limit: 50 }),
      ])
      setDetail(nextDetail); setAuditEvents(audit.events || [])
    } catch (cause) { toast.error(errorMessage(cause)) }
  }

  const openSettlement = async () => {
    if (!detail?.obligation) return
    setSettlement(emptySettlement())
    setSettlement((current) => ({ ...current, principalAmount: minorToInput(detail.remainingMinor), paidDate: detail.obligation.planned_date || today }))
    try {
      const result = await financeApi.movements(scopeId, { status: 'confirmed', limit: 100 })
      const reconciled = await financeApi.movements(scopeId, { status: 'reconciled', limit: 100 })
      const type = detail.obligation.kind === 'payable' ? 'expense' : 'income'
      setSettlementMovements([...(result.movements || []), ...(reconciled.movements || [])].filter((movement) => movement.type === type && movement.currency === detail.obligation.currency))
      setSettleOpen(true)
    } catch (cause) { toast.error(errorMessage(cause)) }
  }

  const submitObligation = () => void run('create-obligation', async () => {
    const amountMinor = minorUnitsFromDisplay(draft.amount)
    if (!amountMinor) throw new Error('Informe um valor positivo com no máximo duas casas decimais.')
    await financeApi.createObligation(scopeId, {
      kind: draft.kind, description: draft.description, amountMinor, currency: 'BRL', competenceDate: draft.competenceDate, dueDate: draft.dueDate,
      plannedDate: draft.plannedDate || undefined, categoryId: draft.categoryId || undefined, payeeId: draft.payeeId || undefined, costCenterId: draft.costCenterId || undefined, notes: draft.notes || undefined,
    })
    setCreateOpen(false); setDraft(emptyDraft())
  })

  const submitSettlement = () => void run('settle-obligation', async () => {
    if (!detail?.obligation) throw new Error('Título não carregado.')
    const principalAmountMinor = minorUnitsFromDisplay(settlement.principalAmount)
    if (!principalAmountMinor || !settlement.movementId) throw new Error('Selecione o lançamento de baixa e informe o principal.')
    const parseOptional = (value: string) => value.trim() ? minorUnitsFromDisplay(value) : 0
    const interestMinor = parseOptional(settlement.interest); const penaltyMinor = parseOptional(settlement.penalty); const discountMinor = parseOptional(settlement.discount); const allowanceMinor = parseOptional(settlement.allowance)
    if ([interestMinor, penaltyMinor, discountMinor, allowanceMinor].some((value) => value === null)) throw new Error('Juros, multa, desconto e abatimento devem ser positivos quando informados.')
    await financeApi.settleObligation(scopeId, detail.obligation.id, { movementId: settlement.movementId, principalAmountMinor, interestMinor: interestMinor || 0, penaltyMinor: penaltyMinor || 0, discountMinor: discountMinor || 0, allowanceMinor: allowanceMinor || 0, paidDate: settlement.paidDate })
    setSettleOpen(false); await openDetail(detail.obligation)
  })

  const cancel = () => void run('cancel-obligation', async () => {
    if (!detail?.obligation) throw new Error('Título não carregado.')
    if (!cancelReason.trim()) throw new Error('Informe o motivo do cancelamento.')
    await financeApi.cancelObligation(scopeId, detail.obligation.id, cancelReason.trim())
    setCancelReason(''); await openDetail(detail.obligation)
  })

  const compatibleCategories = categories.filter((category) => category.direction === (draft.kind === 'payable' ? 'expense' : 'income') || category.direction === 'both')
  const totalPages = Math.max(1, Math.ceil(page.total / page.limit))

  return <div className="space-y-5">
    <Card className="glass-card"><CardHeader><div className="flex flex-wrap items-start justify-between gap-3"><div><CardTitle className="flex items-center gap-2"><ClipboardText size={20} />Títulos a pagar e receber</CardTitle><CardDescription>Planejamento e baixa rastreável. A liquidação referencia um lançamento já confirmado; ela não gera um segundo lançamento no razão.</CardDescription></div>{canOperate ? <Button onClick={() => setCreateOpen(true)}><Plus size={16} />Novo título</Button> : null}</div></CardHeader><CardContent className="grid gap-3 md:grid-cols-2 xl:grid-cols-5"><label className="grid gap-1 text-sm">Pesquisar<Input value={filters.q || ''} onChange={(event) => updateFilters({ q: event.target.value })} placeholder="Descrição" /></label><SelectField label="Tipo" value={filters.kind || 'all'} onChange={(value) => updateFilters({ kind: value === 'all' ? undefined : value as ObligationKind })} items={[{ id: 'all', name: 'Todos' }, { id: 'payable', name: 'A pagar' }, { id: 'receivable', name: 'A receber' }]} /><SelectField label="Status" value={filters.status || 'all'} onChange={(value) => updateFilters({ status: value === 'all' ? undefined : value as ObligationStatus })} items={[{ id: 'all', name: 'Todos' }, { id: 'open', name: 'Em aberto' }, { id: 'partially_settled', name: 'Baixado parcialmente' }, { id: 'settled', name: 'Liquidado' }, { id: 'cancelled', name: 'Cancelado' }]} /><label className="grid gap-1 text-sm">Vencimento inicial<Input type="date" value={filters.from || ''} onChange={(event) => updateFilters({ from: event.target.value || undefined })} /></label><label className="grid gap-1 text-sm">Vencimento final<Input type="date" value={filters.to || ''} onChange={(event) => updateFilters({ to: event.target.value || undefined })} /></label><div className="flex items-end"><Button variant="outline" onClick={() => setFilters({ from: monthStart, to: today, page: 1, limit: PAGE_SIZE })}>Limpar filtros</Button></div></CardContent></Card>

    <ObligationPlanningSummary summary={summary} />

    <Card className="glass-card"><CardContent className="pt-6">{loading ? <PanelState text="Carregando títulos…" /> : error ? <PanelState text={error} action={<Button variant="outline" onClick={() => void load()}>Tentar novamente</Button>} /> : page.obligations.length ? <><Table><TableHeader><TableRow><TableHead>Vencimento</TableHead><TableHead>Descrição</TableHead><TableHead>Tipo</TableHead><TableHead>Status</TableHead><TableHead className="text-right">Em aberto</TableHead><TableHead className="text-right">Ação</TableHead></TableRow></TableHeader><TableBody>{page.obligations.map((obligation) => <TableRow key={obligation.id}><TableCell>{obligation.due_date}</TableCell><TableCell><div className="font-medium">{obligation.description}</div><div className="text-xs text-muted-foreground">{obligation.payee_name || obligation.category_name || 'Sem favorecido/categoria'}</div></TableCell><TableCell>{labelKind(obligation.kind)}</TableCell><TableCell><Badge variant={statusVariant(obligation.status) as any}>{labelStatus(obligation.status)}</Badge></TableCell><TableCell className="text-right font-semibold">{money(obligation.remaining_minor, obligation.currency)}</TableCell><TableCell className="text-right"><Button size="sm" variant="outline" onClick={() => void openDetail(obligation)}>Detalhes</Button></TableCell></TableRow>)}</TableBody></Table><div className="mt-4 flex items-center justify-between gap-3"><p className="text-sm text-muted-foreground">Página {page.page} de {totalPages} · {page.total} título{page.total === 1 ? '' : 's'}</p><div className="flex gap-2"><Button size="sm" variant="outline" disabled={page.page <= 1 || loading} onClick={() => updateFilters({ page: page.page - 1 })}>Anterior</Button><Button size="sm" variant="outline" disabled={page.page >= totalPages || loading} onClick={() => updateFilters({ page: page.page + 1 })}>Próxima</Button></div></div></> : <PanelState text="Nenhum título corresponde aos filtros deste escopo." action={canOperate ? <Button variant="outline" onClick={() => setCreateOpen(true)}>Criar título</Button> : undefined} />}</CardContent></Card>

    <Dialog open={createOpen} onOpenChange={(open) => { setCreateOpen(open); if (!open) setDraft(emptyDraft()) }}><DialogContent className="sm:max-w-2xl"><DialogHeader><DialogTitle>Novo título</DialogTitle><DialogDescription>O título representa uma obrigação a pagar ou receber. O caixa continua sendo registrado apenas pelo lançamento financeiro confirmado.</DialogDescription></DialogHeader><div className="grid max-h-[65vh] gap-4 overflow-y-auto pr-1 md:grid-cols-2"><SelectField label="Tipo" value={draft.kind} onChange={(value) => setDraft((current) => ({ ...current, kind: value as ObligationKind, categoryId: '' }))} items={[{ id: 'payable', name: 'Conta a pagar' }, { id: 'receivable', name: 'Conta a receber' }]} /><label className="grid gap-1 text-sm">Valor<Input inputMode="decimal" value={draft.amount} onChange={(event) => setDraft((current) => ({ ...current, amount: event.target.value }))} placeholder="0,00" /></label><label className="grid gap-1 text-sm md:col-span-2">Descrição<Input value={draft.description} onChange={(event) => setDraft((current) => ({ ...current, description: event.target.value }))} placeholder="Ex.: fornecedor de materiais" /></label><label className="grid gap-1 text-sm">Competência<Input type="date" value={draft.competenceDate} onChange={(event) => setDraft((current) => ({ ...current, competenceDate: event.target.value }))} /></label><label className="grid gap-1 text-sm">Vencimento<Input type="date" value={draft.dueDate} onChange={(event) => setDraft((current) => ({ ...current, dueDate: event.target.value }))} /></label><label className="grid gap-1 text-sm">Previsão de pagamento<Input type="date" value={draft.plannedDate} onChange={(event) => setDraft((current) => ({ ...current, plannedDate: event.target.value }))} /></label><SelectField label="Categoria" value={draft.categoryId || 'none'} onChange={(value) => setDraft((current) => ({ ...current, categoryId: value === 'none' ? '' : value }))} items={[{ id: 'none', name: 'Sem categoria' }, ...compatibleCategories]} /><SelectField label="Favorecido" value={draft.payeeId || 'none'} onChange={(value) => setDraft((current) => ({ ...current, payeeId: value === 'none' ? '' : value }))} items={[{ id: 'none', name: 'Sem favorecido' }, ...payees]} /><SelectField label="Centro de custo" value={draft.costCenterId || 'none'} onChange={(value) => setDraft((current) => ({ ...current, costCenterId: value === 'none' ? '' : value }))} items={[{ id: 'none', name: 'Sem centro de custo' }, ...costCenters]} /><label className="grid gap-1 text-sm md:col-span-2">Observação<Textarea value={draft.notes} onChange={(event) => setDraft((current) => ({ ...current, notes: event.target.value }))} /></label></div><DialogFooter><Button variant="outline" onClick={() => setCreateOpen(false)}>Cancelar</Button><Button onClick={submitObligation} disabled={busy === 'create-obligation'}>{busy === 'create-obligation' ? 'Salvando…' : 'Salvar título'}</Button></DialogFooter></DialogContent></Dialog>

    <Dialog open={detailOpen} onOpenChange={setDetailOpen}><DialogContent className="sm:max-w-2xl"><DialogHeader><DialogTitle>Detalhes do título</DialogTitle><DialogDescription>Dados, baixas e eventos append-only retornados pelo Financeiro.</DialogDescription></DialogHeader>{detail?.obligation ? <div className="max-h-[65vh] space-y-5 overflow-y-auto pr-1"><div className="grid gap-3 sm:grid-cols-2"><Detail label="Descrição" value={detail.obligation.description} /><Detail label="Status" value={labelStatus(detail.obligation.status)} /><Detail label="Valor original" value={money(detail.obligation.amount_minor, detail.obligation.currency)} /><Detail label="Em aberto" value={money(detail.remainingMinor, detail.obligation.currency)} /><Detail label="Competência" value={detail.obligation.competence_date} /><Detail label="Vencimento" value={detail.obligation.due_date} /></div><section><h3 className="mb-2 font-semibold">Baixas</h3>{detail.settlements?.length ? <Table><TableHeader><TableRow><TableHead>Data</TableHead><TableHead>Lançamento</TableHead><TableHead className="text-right">Principal</TableHead></TableRow></TableHeader><TableBody>{detail.settlements.map((item: any) => <TableRow key={item.id}><TableCell>{item.paid_date}</TableCell><TableCell>{item.movement_id}</TableCell><TableCell className="text-right">{money(item.principal_amount_minor, detail.obligation.currency)}</TableCell></TableRow>)}</TableBody></Table> : <p className="text-sm text-muted-foreground">Ainda não há baixa para este título.</p>}</section><section><h3 className="mb-2 flex items-center gap-2 font-semibold"><ClipboardText size={18} />Auditoria</h3>{auditEvents.length ? <div className="space-y-2">{auditEvents.map((event) => <div key={event.id} className="rounded-md border p-3 text-sm"><div className="flex justify-between gap-2"><strong>{event.action}</strong><span className="text-muted-foreground">{event.created_at}</span></div><p className="mt-1 text-muted-foreground">{event.actor}</p></div>)}</div> : <p className="text-sm text-muted-foreground">Nenhum evento de auditoria retornado.</p>}</section>{detail.obligation.status === 'open' && canOperate ? <label className="grid gap-1 text-sm">Motivo do cancelamento<Textarea value={cancelReason} onChange={(event) => setCancelReason(event.target.value)} placeholder="Cancelamento acordado" /></label> : null}</div> : <PanelState text="Carregando detalhes…" />}{detail?.obligation ? <DialogFooter>{['open', 'partially_settled'].includes(detail.obligation.status) && canOperate ? <Button onClick={() => void openSettlement()} disabled={Boolean(busy)}><CheckCircle size={16} />Registrar baixa</Button> : null}{detail.obligation.status === 'open' && canOperate ? <Button variant="destructive" onClick={cancel} disabled={busy === 'cancel-obligation'}>Cancelar título</Button> : null}<Button variant="outline" onClick={() => setDetailOpen(false)}>Fechar</Button></DialogFooter> : null}</DialogContent></Dialog>

    <Dialog open={settleOpen} onOpenChange={setSettleOpen}><DialogContent className="sm:max-w-2xl"><DialogHeader><DialogTitle>Registrar baixa</DialogTitle><DialogDescription>Selecione o lançamento confirmado que já movimentou caixa. O servidor rejeita tipo, moeda, categoria, favorecido, centro de custo e total incompatíveis.</DialogDescription></DialogHeader><div className="grid gap-4 md:grid-cols-2"><SelectField label="Lançamento confirmado" value={settlement.movementId} onChange={(value) => setSettlement((current) => ({ ...current, movementId: value }))} items={settlementMovements.map((movement) => ({ id: movement.id, name: `${movement.competence_date} · ${movement.description} · ${money(movement.amount_minor, movement.currency)}` }))} /><label className="grid gap-1 text-sm">Principal<Input inputMode="decimal" value={settlement.principalAmount} onChange={(event) => setSettlement((current) => ({ ...current, principalAmount: event.target.value }))} /></label><label className="grid gap-1 text-sm">Juros<Input inputMode="decimal" value={settlement.interest} onChange={(event) => setSettlement((current) => ({ ...current, interest: event.target.value }))} placeholder="0,00" /></label><label className="grid gap-1 text-sm">Multa<Input inputMode="decimal" value={settlement.penalty} onChange={(event) => setSettlement((current) => ({ ...current, penalty: event.target.value }))} placeholder="0,00" /></label><label className="grid gap-1 text-sm">Desconto<Input inputMode="decimal" value={settlement.discount} onChange={(event) => setSettlement((current) => ({ ...current, discount: event.target.value }))} placeholder="0,00" /></label><label className="grid gap-1 text-sm">Abatimento<Input inputMode="decimal" value={settlement.allowance} onChange={(event) => setSettlement((current) => ({ ...current, allowance: event.target.value }))} placeholder="0,00" /></label><label className="grid gap-1 text-sm">Data da baixa<Input type="date" value={settlement.paidDate} onChange={(event) => setSettlement((current) => ({ ...current, paidDate: event.target.value }))} /></label></div>{settlementMovements.length === 0 ? <p className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-800"><WarningCircle className="mr-1 inline" size={16} />Nenhum lançamento confirmado compatível está disponível nos primeiros 100 resultados. Registre ou localize o lançamento de caixa antes da baixa.</p> : null}<DialogFooter><Button variant="outline" onClick={() => setSettleOpen(false)}>Cancelar</Button><Button onClick={submitSettlement} disabled={busy === 'settle-obligation'}>{busy === 'settle-obligation' ? 'Registrando…' : 'Confirmar baixa'}</Button></DialogFooter></DialogContent></Dialog>
  </div>
}

function SelectField({ label, value, onChange, items }: { label: string; value: string; onChange: (value: string) => void; items: Array<{ id: string; name: string }> }) { return <label className="grid gap-1 text-sm">{label}<Select value={value} onValueChange={onChange}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{items.map((item) => <SelectItem key={item.id} value={item.id}>{item.name}</SelectItem>)}</SelectContent></Select></label> }
function Detail({ label, value }: { label: string; value: string }) { return <div className="rounded-md border p-3"><p className="text-xs text-muted-foreground">{label}</p><p className="mt-1 break-words text-sm font-medium">{value}</p></div> }
function PanelState({ text, action }: { text: string; action?: React.ReactNode }) { return <div className="flex min-h-40 flex-col items-center justify-center gap-3 py-8 text-center"><CurrencyDollar size={28} className="text-muted-foreground" /><p className="max-w-md text-sm text-muted-foreground">{text}</p>{action}</div> }
function ObligationPlanningSummary({ summary }: { summary: FinanceObligationSummary | null }) {
  if (!summary) return null
  const totals = summary.totals
  return <Card className="glass-card"><CardHeader><CardTitle>Posição e previsão de 30 dias</CardTitle><CardDescription>Valores em aberto por moeda, calculados no servidor. Previsões não criam lançamentos de caixa.</CardDescription></CardHeader><CardContent>{totals.length ? <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">{totals.map((total) => <div className="rounded-md border p-4" key={`${total.currency}-${total.kind}`}><p className="text-sm text-muted-foreground">{total.kind === 'payable' ? 'A pagar' : 'A receber'} · {total.currency}</p><p className="mt-1 text-xl font-semibold">{money(total.open_minor, total.currency)}</p><p className="mt-2 text-sm text-rose-700">Vencido: {money(total.overdue_minor, total.currency)}</p><p className="text-sm text-muted-foreground">Até {summary.horizonEnd}: {money(total.due_within_horizon_minor, total.currency)}</p></div>)}</div> : <p className="text-sm text-muted-foreground">Não há títulos em aberto para compor a posição e a previsão.</p>}</CardContent></Card>
}
