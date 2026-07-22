import React from 'react'
import { CheckCircle, ClipboardText, CurrencyDollar, Funnel, MagnifyingGlass, Plus, WarningCircle } from '@phosphor-icons/react'
import { toast } from 'sonner'
import { Badge } from '@/badge'
import { Button } from '@/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/card'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/dialog'
import { Input } from '@/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/select'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/table'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/tabs'
import { Textarea } from '@/textarea'
import { FinanceApiError, financeApi, minorUnitsFromDisplay, type FinanceBootstrap, type FinanceFilters } from '@/financeApi'
import { FinanceImportDialog } from '@/FinanceImportDialog'

type MovementType = 'income' | 'expense' | 'transfer'
type OperationStatus = 'pending' | 'confirmed'
type SplitDraft = { categoryId: string; amount: string; costCenterId: string }
type InstallmentDraft = { dueDate: string; amount: string }
type MovementDraft = {
  type: MovementType; operationalStatus: OperationStatus; accountId: string; destinationAccountId: string; categoryId: string; payeeId: string
  description: string; amount: string; competenceDate: string; dueDate: string; paidDate: string; costCenterId: string; tagIds: string[]; splits: SplitDraft[]; installments: InstallmentDraft[]
}

const today = new Date().toISOString().slice(0, 10)
const monthStart = `${today.slice(0, 8)}01`
const PAGE_SIZE = 25
const EMPTY_FILTERS: FinanceFilters = { from: monthStart, to: today, page: 1, limit: PAGE_SIZE }
const emptyMovement = (): MovementDraft => ({ type: 'income', operationalStatus: 'confirmed', accountId: '', destinationAccountId: '', categoryId: '', payeeId: '', description: '', amount: '', competenceDate: today, dueDate: '', paidDate: today, costCenterId: '', tagIds: [], splits: [], installments: [] })

function money(minor = 0, currency = 'BRL') { return new Intl.NumberFormat('pt-BR', { style: 'currency', currency }).format(Number(minor || 0) / 100) }
function minorToInput(minor = 0) { return (Number(minor || 0) / 100).toFixed(2).replace('.', ',') }
function dateInputBefore(from: string, to: string) {
  const start = new Date(`${from}T00:00:00Z`); const end = new Date(`${to}T00:00:00Z`); const days = Math.max(0, Math.round((end.getTime() - start.getTime()) / 86_400_000) + 1)
  const previousEnd = new Date(start.getTime() - 86_400_000); const previousStart = new Date(previousEnd.getTime() - Math.max(0, days - 1) * 86_400_000)
  return { from: previousStart.toISOString().slice(0, 10), to: previousEnd.toISOString().slice(0, 10) }
}
function labelForStatus(value?: string) { return ({ pending: 'Pendente', confirmed: 'Confirmado', reconciled: 'Conciliado', cancelled: 'Cancelado' } as Record<string, string>)[value || ''] || value || '—' }
function labelForType(value?: string) { return ({ income: 'Receita', expense: 'Despesa', transfer: 'Transferência' } as Record<string, string>)[value || ''] || value || '—' }
function stateVariant(value?: string) { return value === 'reconciled' ? 'default' : value === 'confirmed' ? 'secondary' : value === 'cancelled' ? 'destructive' : 'outline' }
function humanError(error: unknown) {
  if (error instanceof FinanceApiError) {
    if (error.code === 'IDEMPOTENCY_CONFLICT') return 'Conflito de idempotência: esta operação já foi registrada com dados diferentes.'
    if (error.code === 'FINANCE_MODULE_DENIED') return 'O módulo Financeiro não foi concedido para a sua sessão.'
    if (error.code === 'SCOPE_DENIED') return 'Este escopo não foi concedido para a sua sessão.'
    if (error.code === 'FINANCE_DISABLED') return 'O Financeiro está temporariamente desativado.'
    if (error.status === 503) return 'O serviço Financeiro está indisponível. Tente novamente.'
  }
  return error instanceof Error ? error.message : 'Não foi possível concluir a operação.'
}

export function FinanceModule() {
  const [boot, setBoot] = React.useState<FinanceBootstrap | null>(null)
  const [scopeId, setScopeId] = React.useState('')
  const [filters, setFilters] = React.useState<FinanceFilters>(EMPTY_FILTERS)
  const [overview, setOverview] = React.useState<any>(null)
  const [authorizedBalance, setAuthorizedBalance] = React.useState(0)
  const [previousOverview, setPreviousOverview] = React.useState<any>(null)
  const [accounts, setAccounts] = React.useState<any[]>([])
  const [categories, setCategories] = React.useState<any[]>([])
  const [payees, setPayees] = React.useState<any[]>([])
  const [tags, setTags] = React.useState<any[]>([])
  const [costCenters, setCostCenters] = React.useState<any[]>([])
  const [movementPage, setMovementPage] = React.useState<{ movements: any[]; total: number; page: number; limit: number }>({ movements: [], total: 0, page: 1, limit: PAGE_SIZE })
  const [initializing, setInitializing] = React.useState(true)
  const [refreshing, setRefreshing] = React.useState(false)
  const [error, setError] = React.useState('')
  const [notice, setNotice] = React.useState('')
  const [activeTab, setActiveTab] = React.useState('overview')
  const [movementOpen, setMovementOpen] = React.useState(false)
  const [editingDraft, setEditingDraft] = React.useState<{ id: string; revision: number } | null>(null)
  const [importOpen, setImportOpen] = React.useState(false)
  const [movementDraft, setMovementDraft] = React.useState<MovementDraft>(emptyMovement)
  const [entityOpen, setEntityOpen] = React.useState(false)
  const [entityKind, setEntityKind] = React.useState<'account' | 'category' | 'payee' | 'tag' | 'cost-center'>('account')
  const [entityName, setEntityName] = React.useState('')
  const [entityType, setEntityType] = React.useState('bank')
  const [entityDirection, setEntityDirection] = React.useState<'income' | 'expense'>('expense')
  const [entityParent, setEntityParent] = React.useState('none')
  const [openingBalance, setOpeningBalance] = React.useState('')
  const [selectedMovement, setSelectedMovement] = React.useState<any>(null)
  const [detail, setDetail] = React.useState<any>(null)
  const [auditEvents, setAuditEvents] = React.useState<any[]>([])
  const [detailLoading, setDetailLoading] = React.useState(false)
  const [reverseReason, setReverseReason] = React.useState('')
  const [reconciliationOpen, setReconciliationOpen] = React.useState(false)
  const [reconciliationLines, setReconciliationLines] = React.useState<any[]>([])
  const [reconciliationLoading, setReconciliationLoading] = React.useState(false)
  const [reconciliationDescription, setReconciliationDescription] = React.useState('')
  const [reconciliationExternalId, setReconciliationExternalId] = React.useState('')
  const [busy, setBusy] = React.useState('')
  const hasLoadedRef = React.useRef(false)

  const selectedGrant = boot?.grants.find((grant) => grant.scope_id === scopeId)
  const canOperate = ['operator', 'admin'].includes(selectedGrant?.permission || '')
  const previousPeriod = React.useMemo(() => dateInputBefore(String(filters.from || monthStart), String(filters.to || today)), [filters.from, filters.to])

  const refresh = React.useCallback(async (nextScope: string, nextFilters: FinanceFilters, options: { initial?: boolean } = {}) => {
    if (!nextScope || !boot?.canAccess) return
    if (options.initial) setInitializing(true); else setRefreshing(true)
    setError('')
    try {
      const period = { from: String(nextFilters.from || monthStart), to: String(nextFilters.to || today) }
      const before = dateInputBefore(period.from, period.to)
      const [nextOverview, nextAccounts, nextCategories, nextPayees, nextTags, nextCenters, nextMovements, nextPrevious, ...grantedOverviews] = await Promise.all([
        financeApi.overview(nextScope, period.from, period.to), financeApi.accounts(nextScope), financeApi.categories(nextScope), financeApi.payees(nextScope), financeApi.tags(nextScope), financeApi.costCenters(nextScope), financeApi.movements(nextScope, nextFilters), financeApi.overview(nextScope, before.from, before.to),
        ...(boot.grants || []).map((grant) => financeApi.overview(grant.scope_id, period.from, period.to)),
      ])
      setOverview(nextOverview); setAccounts(nextAccounts.accounts || []); setCategories(nextCategories.categories || []); setPayees(nextPayees.payees || []); setTags(nextTags.tags || []); setCostCenters(nextCenters.costCenters || [])
      setMovementPage({ movements: nextMovements.movements || [], total: Number(nextMovements.total || 0), page: Number(nextMovements.page || nextFilters.page || 1), limit: Number(nextMovements.limit || nextFilters.limit || PAGE_SIZE) })
      setPreviousOverview(nextPrevious)
      setAuthorizedBalance(grantedOverviews.reduce((total, item: any) => total + (item.accounts || []).reduce((sum: number, account: any) => sum + Number(account.balance_minor || 0), 0), 0))
    } catch (cause) { setError(humanError(cause)) } finally { setInitializing(false); setRefreshing(false) }
  }, [boot])

  React.useEffect(() => {
    let active = true
    financeApi.bootstrap().then((result) => {
      if (!active) return
      setBoot(result); const firstScope = result.grants?.[0]?.scope_id || ''; setScopeId(firstScope)
      if (!result.canAccess) setInitializing(false)
    }).catch((cause) => { if (active) { setError(humanError(cause)); setInitializing(false) } })
    return () => { active = false }
  }, [])

  React.useEffect(() => {
    if (!boot?.canAccess || !scopeId) return
    const initial = !hasLoadedRef.current
    hasLoadedRef.current = true
    void refresh(scopeId, filters, { initial })
  }, [boot?.canAccess, filters, refresh, scopeId])

  const updateFilters = (changes: Partial<FinanceFilters>) => setFilters((current) => ({ ...current, ...changes, page: changes.page === undefined ? 1 : changes.page }))
  const runAction = async (label: string, action: () => Promise<void>) => {
    setBusy(label); setNotice('')
    try { await action(); setNotice('Operação concluída e registrada na auditoria.'); toast.success('Operação concluída.'); await refresh(scopeId, filters) }
    catch (cause) { const message = humanError(cause); setNotice(message); toast.error(message) }
    finally { setBusy('') }
  }

  const openDetail = async (movement: any) => {
    setSelectedMovement(movement); setDetail(null); setAuditEvents([]); setReverseReason(''); setDetailLoading(true)
    try {
      const [movementDetail, audit] = await Promise.all([financeApi.movement(scopeId, movement.id), financeApi.audit(scopeId, { entityId: movement.id, entityType: 'movement', limit: 100 })])
      setDetail(movementDetail); setAuditEvents(audit.events || [])
    } catch (cause) { setNotice(humanError(cause)) } finally { setDetailLoading(false) }
  }

  const submitMovement = () => runAction('movement', async () => {
    const amountMinor = minorUnitsFromDisplay(movementDraft.amount)
    if (!amountMinor || !movementDraft.accountId || !movementDraft.description.trim()) throw new Error('Informe conta, descrição e valor válido.')
    if (movementDraft.type === 'transfer' && !movementDraft.destinationAccountId) throw new Error('Selecione a conta de destino da transferência.')
    if (movementDraft.type !== 'transfer' && !movementDraft.categoryId && !movementDraft.splits.length) throw new Error('Selecione uma categoria ou informe as divisões.')
    const splits = movementDraft.type === 'transfer' ? [] : movementDraft.splits.map((split) => ({ categoryId: split.categoryId, costCenterId: split.costCenterId || undefined, amountMinor: minorUnitsFromDisplay(split.amount) }))
    if (splits.some((split) => !split.categoryId || !split.amountMinor)) throw new Error('Cada divisão precisa de categoria e valor válido.')
    if (splits.length && splits.reduce((sum, split) => sum + Number(split.amountMinor), 0) !== amountMinor) throw new Error('As divisões devem totalizar exatamente o lançamento.')
    const installments = movementDraft.installments.map((installment) => ({ dueDate: installment.dueDate, amountMinor: minorUnitsFromDisplay(installment.amount) }))
    if (installments.some((installment) => !installment.dueDate || !installment.amountMinor)) throw new Error('Cada parcela precisa de vencimento e valor válido.')
    if (installments.length && installments.reduce((sum, installment) => sum + Number(installment.amountMinor), 0) !== amountMinor) throw new Error('As parcelas devem totalizar exatamente o lançamento.')
    const payload = {
      type: movementDraft.type, operationalStatus: movementDraft.operationalStatus, accountId: movementDraft.accountId, destinationAccountId: movementDraft.type === 'transfer' ? movementDraft.destinationAccountId : undefined,
      categoryId: movementDraft.type === 'transfer' ? undefined : movementDraft.categoryId, payeeId: movementDraft.payeeId || undefined, description: movementDraft.description.trim(), amountMinor, currency: 'BRL', competenceDate: movementDraft.competenceDate,
      dueDate: movementDraft.dueDate || undefined, paidDate: movementDraft.operationalStatus === 'confirmed' ? (movementDraft.paidDate || undefined) : undefined, costCenterId: movementDraft.costCenterId || undefined, tagIds: movementDraft.tagIds, splits, installments,
    }
    if (editingDraft) await financeApi.reviseDraft(scopeId, editingDraft.id, { ...payload, operationalStatus: undefined, expectedRevision: editingDraft.revision })
    else await financeApi.create('/movements', scopeId, payload)
    setMovementOpen(false); setMovementDraft(emptyMovement()); setEditingDraft(null)
  })

  const beginDraftRevision = () => {
    const movement = detail?.movement
    if (!movement || movement.status !== 'draft' || movement.operational_status !== 'pending') return
    setMovementDraft({
      type: movement.type, operationalStatus: 'pending', accountId: movement.account_id, destinationAccountId: movement.destination_account_id || '', categoryId: movement.category_id || '', payeeId: movement.payee_id || '', description: movement.description,
      amount: minorToInput(movement.amount_minor), competenceDate: movement.competence_date, dueDate: movement.due_date || '', paidDate: '', costCenterId: movement.cost_center_id || '', tagIds: (detail.tags || []).map((tag: any) => tag.id),
      splits: (detail.splits || []).map((split: any) => ({ categoryId: split.category_id, costCenterId: split.cost_center_id || '', amount: minorToInput(split.amount_minor) })),
      installments: (detail.installments || []).filter((installment: any) => installment.status === 'open').map((installment: any) => ({ dueDate: installment.due_date, amount: minorToInput(installment.amount_minor) })),
    })
    setEditingDraft({ id: movement.id, revision: Number(movement.revision) }); setSelectedMovement(null); setDetail(null); setMovementOpen(true)
  }

  const reconciliationAmount = (movement: any) => movement.type === 'income' ? Number(movement.amount_minor) : -Number(movement.amount_minor)
  const openReconciliation = async () => {
    const movement = detail?.movement
    if (!movement) return
    setReconciliationOpen(true); setReconciliationLoading(true); setReconciliationLines([]); setReconciliationDescription(movement.description || ''); setReconciliationExternalId('')
    try { const result = await financeApi.reconciliationLines(scopeId, movement.account_id); setReconciliationLines(result.lines || []) } catch (cause) { setNotice(humanError(cause)) } finally { setReconciliationLoading(false) }
  }
  const reloadReconciliationLines = async () => { const movement = detail?.movement; if (!movement) return; const result = await financeApi.reconciliationLines(scopeId, movement.account_id); setReconciliationLines(result.lines || []) }
  const createReconciliationLine = () => runAction('reconciliation', async () => {
    const movement = detail?.movement; if (!movement) throw new Error('Selecione um lançamento confirmado.')
    await financeApi.createReconciliationLine(scopeId, { accountId: movement.account_id, postedDate: today, amountMinor: reconciliationAmount(movement), currency: movement.currency, description: reconciliationDescription || undefined, externalId: reconciliationExternalId || undefined })
    await reloadReconciliationLines(); setReconciliationExternalId('')
  })
  const suggestReconciliation = (line: any) => runAction('reconciliation', async () => { await financeApi.reconciliationSuggestions(scopeId, line.id); await reloadReconciliationLines() })
  const confirmReconciliation = (line: any) => runAction('reconciliation', async () => { const movement = detail?.movement; if (!movement) return; await financeApi.reconciliationMatch(scopeId, line.id, movement.id, 'confirm'); await reloadReconciliationLines(); await openDetail(movement); setReconciliationOpen(false) })

  const submitEntity = () => runAction('entity', async () => {
    if (!entityName.trim()) throw new Error('Informe um nome para o cadastro.')
    if (entityKind === 'account') {
      const opening = openingBalance ? minorUnitsFromDisplay(openingBalance) : 0
      if (openingBalance && opening === null) throw new Error('Saldo inicial deve usar um valor positivo com até duas casas.')
      await financeApi.create('/accounts', scopeId, { name: entityName.trim(), type: entityType, currency: 'BRL', openingBalanceMinor: opening || 0 })
    } else if (entityKind === 'category') await financeApi.create('/categories', scopeId, { name: entityName.trim(), direction: entityDirection, parentId: entityParent === 'none' ? undefined : entityParent })
    else await financeApi.create(`/${entityKind === 'cost-center' ? 'cost-centers' : `${entityKind}s`}`, scopeId, { name: entityName.trim() })
    setEntityOpen(false); setEntityName(''); setOpeningBalance(''); setEntityParent('none')
  })

  const openEntity = (kind: typeof entityKind) => { setEntityKind(kind); setEntityName(''); setOpeningBalance(''); setEntityParent('none'); setEntityOpen(true) }
  const setDraft = (changes: Partial<MovementDraft>) => setMovementDraft((current) => ({ ...current, ...changes }))
  const toggleTag = (tagId: string) => setDraft({ tagIds: movementDraft.tagIds.includes(tagId) ? movementDraft.tagIds.filter((id) => id !== tagId) : [...movementDraft.tagIds, tagId] })

  if (initializing) return <FinanceState icon={<CurrencyDollar size={28} />} title="Carregando Financeiro" description="Validando seu acesso e buscando dados reais do escopo autorizado." />
  if (error && !boot) return <FinanceState icon={<WarningCircle size={28} />} title={error.includes('módulo Financeiro não foi concedido') ? 'Módulo Financeiro não concedido' : 'Serviço Financeiro indisponível'} description={error} action={<Button onClick={() => window.location.reload()}>Tentar novamente</Button>} />
  if (!boot?.moduleEnabled) return <FinanceState icon={<WarningCircle size={28} />} title="Financeiro ainda não está ativado" description="A feature flag está desligada. Nenhum dado financeiro foi exposto." />
  if (!boot.canAccess || !scopeId) return <FinanceState icon={<WarningCircle size={28} />} title="Sem permissão para Financeiro" description="Você precisa do módulo Financeiro e de uma concessão explícita para ao menos um escopo." />

  const periodTotal = Number(overview?.totals?.result || 0); const previousTotal = Number(previousOverview?.totals?.result || 0); const delta = periodTotal - previousTotal
  const selectedCategories = categories.filter((category) => category.direction === movementDraft.type)
  const accountBalances = overview?.accounts || []

  return <div className="space-y-6" data-finance-module="true">
    {notice ? <div role="status" className={`flex items-start gap-2 rounded-lg border p-3 text-sm ${notice.includes('concluída') ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300' : 'border-destructive/40 bg-destructive/10 text-destructive'}`}><CheckCircle size={18} className="mt-0.5 shrink-0" />{notice}</div> : null}
    {error ? <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive"><span>{error}</span><Button variant="outline" size="sm" onClick={() => void refresh(scopeId, filters)}>Tentar novamente</Button></div> : null}

    <section className="flex flex-wrap items-end justify-between gap-4">
      <div><h2 className="text-2xl font-bold tracking-tight">Financeiro</h2><p className="text-muted-foreground">Visão operacional com razão, auditoria e dados separados por escopo.</p></div>
      <div className="flex flex-wrap gap-2"><Button variant="outline" onClick={() => void refresh(scopeId, filters)} disabled={refreshing}>{refreshing ? 'Atualizando…' : 'Atualizar'}</Button><Button variant="outline" onClick={() => setImportOpen(true)} disabled={!canOperate}>Importar CSV</Button><Button onClick={() => setMovementOpen(true)} disabled={!canOperate}><Plus size={18} /> Novo lançamento</Button></div>
    </section>

    <Card className="glass-card"><CardContent className="flex flex-wrap items-end gap-3 p-4"><label className="grid gap-1 text-sm font-medium">De<Input aria-label="Período inicial" type="date" value={String(filters.from)} onChange={(event) => updateFilters({ from: event.target.value })} /></label><label className="grid gap-1 text-sm font-medium">Até<Input aria-label="Período final" type="date" value={String(filters.to)} onChange={(event) => updateFilters({ to: event.target.value })} /></label><label className="grid min-w-56 gap-1 text-sm font-medium">Escopo<Select value={scopeId} onValueChange={(value) => { setScopeId(value); updateFilters({ page: 1 }) }}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{boot.grants.map((grant) => <SelectItem key={grant.scope_id} value={grant.scope_id}>{grant.label}</SelectItem>)}</SelectContent></Select></label><p className="ml-auto text-sm text-muted-foreground">{selectedGrant?.permission === 'viewer' ? 'Consulta autorizada' : 'Operação autorizada'}</p></CardContent></Card>

    <FinanceImportDialog open={importOpen} onOpenChange={setImportOpen} scopeId={scopeId} grants={boot.grants} canOperate={canOperate} onCompleted={async () => { await refresh(scopeId, filters) }} />

    <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-5"><TabsList className="grid w-full grid-cols-3 md:w-[460px]"><TabsTrigger value="overview">Visão geral</TabsTrigger><TabsTrigger value="movements">Movimentações</TabsTrigger><TabsTrigger value="registrations">Cadastros</TabsTrigger></TabsList>
      <TabsContent value="overview" className="space-y-5">
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4"><Metric title="Saldo autorizado" value={money(authorizedBalance)} description="Todas as unidades concedidas" /><Metric title="Entradas" value={money(overview?.totals?.income)} tone="text-emerald-600" /><Metric title="Saídas" value={money(overview?.totals?.expense)} tone="text-rose-600" /><Metric title="Resultado" value={money(periodTotal)} tone={periodTotal >= 0 ? 'text-sky-600' : 'text-rose-600'} description={previousTotal || periodTotal ? `${delta >= 0 ? '+' : ''}${money(delta)} vs. período anterior` : 'Sem período anterior comparável'} /></div>
        <Card className="glass-card"><CardHeader><CardTitle>Contas e saldos</CardTitle><CardDescription>Saldos calculados no servidor a partir dos lançamentos confirmados ou conciliados.</CardDescription></CardHeader><CardContent>{accountBalances.length ? <Table><TableHeader><TableRow><TableHead>Conta</TableHead><TableHead>Moeda</TableHead><TableHead className="text-right">Saldo</TableHead></TableRow></TableHeader><TableBody>{accountBalances.map((account: any) => <TableRow key={account.id}><TableCell className="font-medium">{account.name}</TableCell><TableCell>{account.currency}</TableCell><TableCell className="text-right font-semibold">{money(account.balance_minor, account.currency)}</TableCell></TableRow>)}</TableBody></Table> : <EmptyState text="Nenhuma conta cadastrada neste escopo." action={canOperate ? <Button variant="outline" onClick={() => openEntity('account')}>Cadastrar conta</Button> : undefined} />}</CardContent></Card>
      </TabsContent>

      <TabsContent value="movements" className="space-y-5">
        <Card className="glass-card"><CardHeader><CardTitle className="flex items-center gap-2"><Funnel size={20} />Filtros</CardTitle><CardDescription>A pesquisa e os filtros são enviados para a API do Financeiro dentro do escopo selecionado.</CardDescription></CardHeader><CardContent className="grid gap-3 md:grid-cols-2 xl:grid-cols-4"><label className="grid gap-1 text-sm">Pesquisar<div className="relative"><MagnifyingGlass className="absolute left-2 top-2.5 text-muted-foreground" size={18} /><Input className="pl-8" value={String(filters.q || '')} onChange={(event) => updateFilters({ q: event.target.value })} placeholder="Descrição ou favorecido" /></div></label><FilterSelect label="Conta" value={String(filters.accountId || 'all')} onValueChange={(value) => updateFilters({ accountId: value === 'all' ? undefined : value })} items={accounts} /><FilterSelect label="Categoria" value={String(filters.categoryId || 'all')} onValueChange={(value) => updateFilters({ categoryId: value === 'all' ? undefined : value })} items={categories} /><FilterSelect label="Favorecido" value={String(filters.payeeId || 'all')} onValueChange={(value) => updateFilters({ payeeId: value === 'all' ? undefined : value })} items={payees} /><label className="grid gap-1 text-sm">Status<Select value={String(filters.status || 'all')} onValueChange={(value) => updateFilters({ status: value === 'all' ? undefined : value })}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">Todos</SelectItem><SelectItem value="pending">Pendente</SelectItem><SelectItem value="confirmed">Confirmado</SelectItem><SelectItem value="reconciled">Conciliado</SelectItem><SelectItem value="cancelled">Cancelado</SelectItem></SelectContent></Select></label><FilterSelect label="Centro de custo" value={String(filters.costCenterId || 'all')} onValueChange={(value) => updateFilters({ costCenterId: value === 'all' ? undefined : value })} items={costCenters} /><div className="flex items-end"><Button variant="outline" onClick={() => setFilters({ ...EMPTY_FILTERS, from: filters.from, to: filters.to })}>Limpar filtros</Button></div></CardContent></Card>
        <Card className="glass-card"><CardHeader><CardTitle>Movimentações</CardTitle><CardDescription>{movementPage.total} lançamento{movementPage.total === 1 ? '' : 's'} encontrado{movementPage.total === 1 ? '' : 's'}.</CardDescription></CardHeader><CardContent>{movementPage.movements.length ? <><Table><TableHeader><TableRow><TableHead>Competência</TableHead><TableHead>Descrição</TableHead><TableHead>Conta</TableHead><TableHead>Status</TableHead><TableHead className="text-right">Valor</TableHead><TableHead className="text-right">Ações</TableHead></TableRow></TableHeader><TableBody>{movementPage.movements.map((movement) => <TableRow key={movement.id}><TableCell>{movement.competence_date}</TableCell><TableCell><div className="font-medium">{movement.description}</div><div className="text-xs text-muted-foreground">{labelForType(movement.type)}{movement.payee_name ? ` · ${movement.payee_name}` : ''}</div></TableCell><TableCell>{movement.account_name || '—'}{movement.destination_account_name ? ` → ${movement.destination_account_name}` : ''}</TableCell><TableCell><Badge variant={stateVariant(movement.operational_status) as any}>{labelForStatus(movement.operational_status)}</Badge></TableCell><TableCell className={`text-right font-semibold ${movement.type === 'expense' ? 'text-rose-600' : movement.type === 'income' ? 'text-emerald-600' : ''}`}>{money(movement.amount_minor, movement.currency)}</TableCell><TableCell className="text-right"><Button size="sm" variant="outline" onClick={() => void openDetail(movement)}>Detalhes</Button></TableCell></TableRow>)}</TableBody></Table><div className="mt-4 flex items-center justify-between gap-3"><p className="text-sm text-muted-foreground">Página {movementPage.page} de {Math.max(1, Math.ceil(movementPage.total / movementPage.limit))}</p><div className="flex gap-2"><Button size="sm" variant="outline" disabled={movementPage.page <= 1 || refreshing} onClick={() => updateFilters({ page: movementPage.page - 1 })}>Anterior</Button><Button size="sm" variant="outline" disabled={movementPage.page * movementPage.limit >= movementPage.total || refreshing} onClick={() => updateFilters({ page: movementPage.page + 1 })}>Próxima</Button></div></div></> : <EmptyState text="Nenhuma movimentação corresponde aos filtros do período." action={canOperate ? <Button onClick={() => setMovementOpen(true)}>Criar lançamento</Button> : undefined} />}</CardContent></Card>
      </TabsContent>

      <TabsContent value="registrations" className="space-y-5"><div className="grid gap-5 lg:grid-cols-2"><RegistrationCard title="Contas financeiras" description="Banco, caixa, cartão e compensação." items={accounts} onAdd={() => openEntity('account')} onArchive={(item) => void runAction('archive-account', () => financeApi.registrationLifecycle(scopeId, 'accounts', item.id, 'archive'))} canOperate={canOperate} /><RegistrationCard title="Categorias" description="Estrutura hierárquica de receitas e despesas." items={categories} onAdd={() => openEntity('category')} onArchive={(item) => void runAction('archive-category', () => financeApi.registrationLifecycle(scopeId, 'categories', item.id, 'archive'))} canOperate={canOperate} extra={(item) => labelForType(item.direction)} /><RegistrationCard title="Favorecidos" description="Pessoas e empresas relacionadas aos lançamentos." items={payees} onAdd={() => openEntity('payee')} onArchive={(item) => void runAction('archive-payee', () => financeApi.registrationLifecycle(scopeId, 'payees', item.id, 'archive'))} canOperate={canOperate} /><RegistrationCard title="Tags" description="Classificações adicionais para relatórios futuros." items={tags} onAdd={() => openEntity('tag')} onArchive={(item) => void runAction('archive-tag', () => financeApi.registrationLifecycle(scopeId, 'tags', item.id, 'archive'))} canOperate={canOperate} /><RegistrationCard title="Centros de custo" description="Apropriação gerencial por escopo." items={costCenters} onAdd={() => openEntity('cost-center')} onArchive={(item) => void runAction('archive-cost-center', () => financeApi.registrationLifecycle(scopeId, 'cost-centers', item.id, 'archive'))} canOperate={canOperate} /></div></TabsContent>
    </Tabs>

    <Dialog open={movementOpen} onOpenChange={(open) => { setMovementOpen(open); if (!open) { setMovementDraft(emptyMovement()); setEditingDraft(null) } }}><DialogContent className="sm:max-w-3xl"><DialogHeader><DialogTitle>{editingDraft ? 'Revisar rascunho' : 'Novo lançamento'}</DialogTitle><DialogDescription>{editingDraft ? 'A revisão é atômica e registrada. Apenas este rascunho pendente pode ser alterado; após confirmação, qualquer correção exige estorno.' : 'O servidor valida escopo, idempotência, parcelas, splits e partidas dobradas antes de persistir.'}</DialogDescription></DialogHeader><div className="grid max-h-[65vh] gap-4 overflow-y-auto pr-1 md:grid-cols-2"><FieldSelect label="Tipo" value={movementDraft.type} onValueChange={(value) => setDraft({ type: value as MovementType, categoryId: '', destinationAccountId: '', splits: [], installments: [] })} items={[{ id: 'income', name: 'Receita' }, { id: 'expense', name: 'Despesa' }, { id: 'transfer', name: 'Transferência' }]} />{editingDraft ? <Detail label="Status" value="Pendente — rascunho editável" /> : <FieldSelect label="Status inicial" value={movementDraft.operationalStatus} onValueChange={(value) => setDraft({ operationalStatus: value as OperationStatus, paidDate: value === 'pending' ? '' : today })} items={[{ id: 'confirmed', name: 'Confirmado' }, { id: 'pending', name: 'Pendente' }]} />}<FieldSelect label="Conta de origem" value={movementDraft.accountId} onValueChange={(value) => setDraft({ accountId: value })} items={accounts} placeholder="Selecione" />{movementDraft.type === 'transfer' ? <FieldSelect label="Conta de destino" value={movementDraft.destinationAccountId} onValueChange={(value) => setDraft({ destinationAccountId: value })} items={accounts.filter((account) => account.id !== movementDraft.accountId)} placeholder="Selecione" /> : <FieldSelect label="Categoria" value={movementDraft.categoryId} onValueChange={(value) => setDraft({ categoryId: value })} items={selectedCategories} placeholder="Selecione" />}<label className="grid gap-1 text-sm">Descrição<Input value={movementDraft.description} onChange={(event) => setDraft({ description: event.target.value })} placeholder="Ex.: recebimento de procedimento" /></label><label className="grid gap-1 text-sm">Valor<Input inputMode="decimal" value={movementDraft.amount} onChange={(event) => setDraft({ amount: event.target.value })} placeholder="0,00" /></label><label className="grid gap-1 text-sm">Competência<Input type="date" value={movementDraft.competenceDate} onChange={(event) => setDraft({ competenceDate: event.target.value })} /></label><label className="grid gap-1 text-sm">Vencimento<Input type="date" value={movementDraft.dueDate} onChange={(event) => setDraft({ dueDate: event.target.value })} /></label>{movementDraft.operationalStatus === 'confirmed' ? <label className="grid gap-1 text-sm">Pagamento<Input type="date" value={movementDraft.paidDate} onChange={(event) => setDraft({ paidDate: event.target.value })} /></label> : null}{movementDraft.type !== 'transfer' ? <FieldSelect label="Favorecido" value={movementDraft.payeeId || 'none'} onValueChange={(value) => setDraft({ payeeId: value === 'none' ? '' : value })} items={[{ id: 'none', name: 'Sem favorecido' }, ...payees]} /> : null}{movementDraft.type !== 'transfer' ? <FieldSelect label="Centro de custo" value={movementDraft.costCenterId || 'none'} onValueChange={(value) => setDraft({ costCenterId: value === 'none' ? '' : value })} items={[{ id: 'none', name: 'Sem centro de custo' }, ...costCenters]} /> : null}</div>{movementDraft.type !== 'transfer' && tags.length ? <fieldset className="mt-4 grid gap-2"><legend className="text-sm font-medium">Tags</legend><div className="flex flex-wrap gap-3">{tags.map((tag) => <label key={tag.id} className="flex items-center gap-2 text-sm"><input type="checkbox" checked={movementDraft.tagIds.includes(tag.id)} onChange={() => toggleTag(tag.id)} />{tag.name}</label>)}</div></fieldset> : null}{movementDraft.type !== 'transfer' ? <SplitEditor draft={movementDraft} setDraft={setDraft} categories={selectedCategories} centers={costCenters} /> : null}{movementDraft.type !== 'transfer' ? <InstallmentEditor draft={movementDraft} setDraft={setDraft} /> : null}<DialogFooter><Button variant="outline" onClick={() => setMovementOpen(false)}>Cancelar</Button><Button onClick={() => void submitMovement()} disabled={!canOperate || busy === 'movement'}>{busy === 'movement' ? 'Salvando…' : editingDraft ? 'Salvar rascunho' : 'Salvar lançamento'}</Button></DialogFooter></DialogContent></Dialog>

    <Dialog open={entityOpen} onOpenChange={setEntityOpen}><DialogContent><DialogHeader><DialogTitle>Novo cadastro</DialogTitle><DialogDescription>O registro será criado apenas no escopo atualmente selecionado.</DialogDescription></DialogHeader><div className="grid gap-4"><label className="grid gap-1 text-sm">Nome<Input value={entityName} onChange={(event) => setEntityName(event.target.value)} autoFocus /></label>{entityKind === 'account' ? <><FieldSelect label="Tipo de conta" value={entityType} onValueChange={setEntityType} items={[{ id: 'bank', name: 'Banco' }, { id: 'cash', name: 'Caixa' }, { id: 'card', name: 'Cartão' }, { id: 'clearing', name: 'Compensação' }]} /><label className="grid gap-1 text-sm">Saldo inicial (opcional)<Input inputMode="decimal" value={openingBalance} onChange={(event) => setOpeningBalance(event.target.value)} placeholder="0,00" /></label></> : null}{entityKind === 'category' ? <><FieldSelect label="Natureza" value={entityDirection} onValueChange={(value) => { setEntityDirection(value as 'income' | 'expense'); setEntityParent('none') }} items={[{ id: 'expense', name: 'Despesa' }, { id: 'income', name: 'Receita' }]} /><FieldSelect label="Categoria pai" value={entityParent} onValueChange={setEntityParent} items={[{ id: 'none', name: 'Sem categoria pai' }, ...categories.filter((category) => category.direction === entityDirection)]} /></> : null}</div><DialogFooter><Button variant="outline" onClick={() => setEntityOpen(false)}>Cancelar</Button><Button onClick={() => void submitEntity()} disabled={!canOperate || busy === 'entity'}>{busy === 'entity' ? 'Salvando…' : 'Salvar'}</Button></DialogFooter></DialogContent></Dialog>

    <Dialog open={reconciliationOpen} onOpenChange={setReconciliationOpen}><DialogContent size="wideTable"><DialogHeader><DialogTitle>Conciliar com extrato</DialogTitle><DialogDescription>Registre ou selecione uma linha do extrato. O servidor só confirma conta, valor e moeda compatíveis.</DialogDescription></DialogHeader><div className="grid max-h-[60vh] gap-4 overflow-y-auto pr-1"><div className="grid gap-3 rounded-md border p-3 md:grid-cols-2"><label className="grid gap-1 text-sm">Descrição da linha<Input value={reconciliationDescription} onChange={(event) => setReconciliationDescription(event.target.value)} /></label><label className="grid gap-1 text-sm">Identificador externo (opcional)<Input value={reconciliationExternalId} onChange={(event) => setReconciliationExternalId(event.target.value)} /></label><div className="md:col-span-2"><Button onClick={() => void createReconciliationLine()} disabled={Boolean(busy)}>Registrar linha do extrato</Button></div></div>{reconciliationLoading ? <p className="py-6 text-center text-sm text-muted-foreground">Carregando linhas do extrato…</p> : reconciliationLines.length ? <div className="space-y-3">{reconciliationLines.map((line) => { const matches = line.matches || []; const suggested = matches.some((match: any) => match.movement_id === detail?.movement?.id && match.status === 'suggested'); const confirmed = matches.some((match: any) => match.movement_id === detail?.movement?.id && match.status === 'confirmed'); return <div key={line.id} className="rounded-md border p-3"><div className="flex flex-wrap items-center justify-between gap-2"><div><strong>{line.posted_date}</strong><p className="text-sm text-muted-foreground">{line.description || 'Sem descrição'} · {money(Math.abs(Number(line.amount_minor)), line.currency)} {Number(line.amount_minor) < 0 ? 'saída' : 'entrada'}</p></div><div className="flex gap-2">{!matches.length ? <Button size="sm" variant="outline" onClick={() => void suggestReconciliation(line)} disabled={Boolean(busy)}>Buscar sugestão</Button> : null}{suggested ? <Button size="sm" onClick={() => void confirmReconciliation(line)} disabled={Boolean(busy)}>Confirmar vínculo</Button> : null}{confirmed ? <Badge>Conciliado</Badge> : null}</div></div></div> })}</div> : <EmptyState text="Nenhuma linha de extrato nesta conta. Registre uma linha para iniciar a conciliação." />}</div><DialogFooter><Button variant="outline" onClick={() => setReconciliationOpen(false)}>Fechar</Button></DialogFooter></DialogContent></Dialog>

    <Dialog open={Boolean(selectedMovement)} onOpenChange={(open) => { if (!open) { setSelectedMovement(null); setDetail(null) } }}><DialogContent size="wideTable"><DialogHeader><DialogTitle>Detalhes do lançamento</DialogTitle><DialogDescription>Consulta do lançamento, suas parcelas, divisões e trilha de auditoria. Alterações não editam evidências financeiras.</DialogDescription></DialogHeader>{detailLoading ? <p className="py-8 text-center text-muted-foreground">Carregando detalhes auditáveis…</p> : detail ? <div className="grid max-h-[65vh] gap-5 overflow-y-auto pr-1"><div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4"><Detail label="Descrição" value={detail.movement.description} /><Detail label="Status" value={labelForStatus(detail.movement.operational_status)} /><Detail label="Competência" value={detail.movement.competence_date} /><Detail label="Valor" value={money(detail.movement.amount_minor, detail.movement.currency)} /></div>{detail.splits?.length ? <DetailSection title="Divisões" rows={detail.splits.map((split: any) => `${split.amount_minor} minor units · ${split.category_id}`)} /> : null}{detail.installments?.length ? <div><h3 className="mb-2 font-semibold">Parcelas</h3><Table><TableHeader><TableRow><TableHead>#</TableHead><TableHead>Vencimento</TableHead><TableHead>Status</TableHead><TableHead className="text-right">Valor</TableHead><TableHead /></TableRow></TableHeader><TableBody>{detail.installments.map((installment: any) => <TableRow key={installment.id}><TableCell>{installment.sequence}</TableCell><TableCell>{installment.due_date}</TableCell><TableCell>{installment.status === 'paid' ? 'Paga' : installment.status === 'cancelled' ? 'Cancelada' : 'Aberta'}</TableCell><TableCell className="text-right">{money(installment.amount_minor, detail.movement.currency)}</TableCell><TableCell className="text-right">{installment.status === 'open' && ['confirmed', 'reconciled'].includes(detail.movement.operational_status) && canOperate ? <Button size="sm" variant="outline" onClick={() => void runAction('installment', async () => { await financeApi.payInstallment(scopeId, installment.id, today); await openDetail(selectedMovement) })}>Baixar</Button> : null}</TableCell></TableRow>)}</TableBody></Table></div> : null}<div><h3 className="mb-2 flex items-center gap-2 font-semibold"><ClipboardText size={18} />Auditoria</h3>{auditEvents.length ? <div className="space-y-2">{auditEvents.map((event) => <div key={event.id} className="rounded-md border p-3 text-sm"><div className="flex flex-wrap justify-between gap-2"><strong>{event.action}</strong><span className="text-muted-foreground">{event.created_at}</span></div><p className="mt-1 text-muted-foreground">{event.actor}</p></div>)}</div> : <p className="text-sm text-muted-foreground">Nenhum evento de auditoria retornado para este lançamento.</p>}</div>{detail.movement.operational_status === 'confirmed' || detail.movement.operational_status === 'reconciled' ? <label className="grid gap-1 text-sm">Motivo do estorno<Textarea value={reverseReason} onChange={(event) => setReverseReason(event.target.value)} placeholder="Correção operacional" /></label> : null}</div> : <p className="py-8 text-center text-muted-foreground">Detalhes indisponíveis.</p>}<DialogFooter>{selectedMovement?.operational_status === 'pending' && canOperate ? <><Button variant="outline" onClick={beginDraftRevision} disabled={detailLoading || Boolean(busy)}>Editar rascunho</Button><Button onClick={() => void runAction('confirm', async () => { await financeApi.transition(scopeId, selectedMovement.id, 'confirm'); await openDetail(selectedMovement) })} disabled={Boolean(busy)}>Confirmar</Button></> : null}{selectedMovement?.operational_status === 'confirmed' && canOperate ? <Button variant="outline" onClick={() => void openReconciliation()} disabled={Boolean(busy)}>Conciliar com extrato</Button> : null}{['confirmed', 'reconciled'].includes(selectedMovement?.operational_status) && canOperate ? <Button variant="destructive" onClick={() => void runAction('reverse', async () => { await financeApi.transition(scopeId, selectedMovement.id, 'reverse', { reason: reverseReason || 'Correção operacional' }); setSelectedMovement(null) })} disabled={Boolean(busy)}>Estornar</Button> : null}<Button variant="outline" onClick={() => setSelectedMovement(null)}>Fechar</Button></DialogFooter></DialogContent></Dialog>
  </div>
}

function FinanceState({ icon, title, description, action }: { icon: React.ReactNode; title: string; description: string; action?: React.ReactNode }) { return <Card className="glass-card"><CardContent className="flex min-h-64 flex-col items-center justify-center gap-3 p-8 text-center"><span className="text-muted-foreground">{icon}</span><h2 className="text-xl font-semibold">{title}</h2><p className="max-w-md text-sm text-muted-foreground">{description}</p>{action}</CardContent></Card> }
function Metric({ title, value, description, tone = '' }: { title: string; value: string; description?: string; tone?: string }) { return <Card className="glass-card"><CardContent className="p-5"><p className="text-sm text-muted-foreground">{title}</p><p className={`mt-1 text-2xl font-bold ${tone}`}>{value}</p>{description ? <p className="mt-1 text-xs text-muted-foreground">{description}</p> : null}</CardContent></Card> }
function EmptyState({ text, action }: { text: string; action?: React.ReactNode }) { return <div className="flex min-h-40 flex-col items-center justify-center gap-3 py-8 text-center"><p className="text-sm text-muted-foreground">{text}</p>{action}</div> }
function Detail({ label, value }: { label: string; value: string }) { return <div className="rounded-md border p-3"><p className="text-xs text-muted-foreground">{label}</p><p className="mt-1 break-words text-sm font-medium">{value}</p></div> }
function DetailSection({ title, rows }: { title: string; rows: string[] }) { return <div><h3 className="mb-2 font-semibold">{title}</h3><ul className="space-y-1 text-sm text-muted-foreground">{rows.map((row, index) => <li key={`${row}-${index}`} className="rounded border px-3 py-2">{row}</li>)}</ul></div> }
function FilterSelect({ label, value, onValueChange, items }: { label: string; value: string; onValueChange: (value: string) => void; items: any[] }) { return <label className="grid gap-1 text-sm">{label}<Select value={value} onValueChange={onValueChange}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">Todos</SelectItem>{items.map((item) => <SelectItem key={item.id} value={item.id}>{item.name}</SelectItem>)}</SelectContent></Select></label> }
function FieldSelect({ label, value, onValueChange, items, placeholder = undefined }: { label: string; value: string; onValueChange: (value: string) => void; items: Array<{ id: string; name: string }>; placeholder?: string }) { return <label className="grid gap-1 text-sm">{label}<Select value={value} onValueChange={onValueChange}><SelectTrigger><SelectValue placeholder={placeholder} /></SelectTrigger><SelectContent>{items.map((item) => <SelectItem key={item.id} value={item.id}>{item.name}</SelectItem>)}</SelectContent></Select></label> }
function RegistrationCard({ title, description, items, onAdd, onArchive, canOperate, extra }: { title: string; description: string; items: any[]; onAdd: () => void; onArchive: (item: any) => void; canOperate: boolean; extra?: (item: any) => string }) { return <Card className="glass-card"><CardHeader><div className="flex items-start justify-between gap-3"><div><CardTitle>{title}</CardTitle><CardDescription>{description}</CardDescription></div>{canOperate ? <Button size="sm" variant="outline" onClick={onAdd}><Plus size={16} />Adicionar</Button> : null}</div></CardHeader><CardContent>{items.length ? <div className="max-h-52 space-y-2 overflow-y-auto">{items.map((item) => <div key={item.id} className="flex items-center justify-between gap-3 border-b pb-2 text-sm"><span className="font-medium">{item.name}</span><div className="flex items-center gap-2">{extra ? <span className="text-muted-foreground">{extra(item)}</span> : null}{canOperate ? <Button size="sm" variant="ghost" onClick={() => onArchive(item)}>Arquivar</Button> : null}</div></div>)}</div> : <p className="py-4 text-sm text-muted-foreground">Nenhum cadastro neste escopo.</p>}</CardContent></Card> }
function SplitEditor({ draft, setDraft, categories, centers }: { draft: MovementDraft; setDraft: (changes: Partial<MovementDraft>) => void; categories: any[]; centers: any[] }) { const change = (index: number, changes: Partial<SplitDraft>) => setDraft({ splits: draft.splits.map((split, splitIndex) => splitIndex === index ? { ...split, ...changes } : split) }); return <section className="mt-4 rounded-lg border p-3"><div className="mb-3 flex items-center justify-between gap-3"><div><h3 className="font-medium">Dividir lançamento</h3><p className="text-xs text-muted-foreground">As categorias devem totalizar o valor informado.</p></div><Button type="button" size="sm" variant="outline" onClick={() => setDraft({ splits: [...draft.splits, { categoryId: draft.categoryId, amount: '', costCenterId: draft.costCenterId }] })}>Adicionar divisão</Button></div>{draft.splits.map((split, index) => <div key={index} className="mb-2 grid gap-2 md:grid-cols-[1fr_1fr_120px_auto]"><FieldSelect label={index === 0 ? 'Categoria' : ''} value={split.categoryId} onValueChange={(value) => change(index, { categoryId: value })} items={categories} placeholder="Categoria" /><FieldSelect label={index === 0 ? 'Centro de custo' : ''} value={split.costCenterId || 'none'} onValueChange={(value) => change(index, { costCenterId: value === 'none' ? '' : value })} items={[{ id: 'none', name: 'Sem centro' }, ...centers]} /><label className="grid gap-1 text-sm">{index === 0 ? 'Valor' : ''}<Input inputMode="decimal" value={split.amount} onChange={(event) => change(index, { amount: event.target.value })} placeholder="0,00" /></label><Button type="button" size="sm" variant="ghost" className="self-end" onClick={() => setDraft({ splits: draft.splits.filter((_, splitIndex) => splitIndex !== index) })}>Remover</Button></div>)}</section> }
function InstallmentEditor({ draft, setDraft }: { draft: MovementDraft; setDraft: (changes: Partial<MovementDraft>) => void }) { const change = (index: number, changes: Partial<InstallmentDraft>) => setDraft({ installments: draft.installments.map((installment, installmentIndex) => installmentIndex === index ? { ...installment, ...changes } : installment) }); return <section className="mt-4 rounded-lg border p-3"><div className="mb-3 flex items-center justify-between gap-3"><div><h3 className="font-medium">Parcelas</h3><p className="text-xs text-muted-foreground">As parcelas devem totalizar o lançamento.</p></div><Button type="button" size="sm" variant="outline" onClick={() => setDraft({ installments: [...draft.installments, { dueDate: draft.dueDate || today, amount: '' }] })}>Adicionar parcela</Button></div>{draft.installments.map((installment, index) => <div key={index} className="mb-2 grid grid-cols-[1fr_1fr_auto] gap-2"><Input aria-label={`Vencimento da parcela ${index + 1}`} type="date" value={installment.dueDate} onChange={(event) => change(index, { dueDate: event.target.value })} /><Input aria-label={`Valor da parcela ${index + 1}`} inputMode="decimal" value={installment.amount} onChange={(event) => change(index, { amount: event.target.value })} placeholder="0,00" /><Button type="button" size="sm" variant="ghost" onClick={() => setDraft({ installments: draft.installments.filter((_, installmentIndex) => installmentIndex !== index) })}>Remover</Button></div>)}</section> }
