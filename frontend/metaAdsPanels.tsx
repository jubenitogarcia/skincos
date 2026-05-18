import { useMemo, useState } from 'react'
import { format } from 'date-fns'
import { ptBR } from 'date-fns/locale'
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts'
import { Badge } from '@/badge'
import { Button } from '@/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/card'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/dialog'
import { EntityDetailModal, type EntityDetailSection } from '@/EntityDetailModal'
import { OpenEntityButton } from '@/OpenEntityButton'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/select'
import { TabsList, TabsTrigger } from '@/tabs'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/table'
import { Textarea } from '@/textarea'
import type {
  MetaAdAccount,
  MetaAd,
  MetaAdSet,
  MetaAdsApiError,
  MetaAdsHealthState,
  MetaAdsInventory,
  MetaAdsInventoryLevel,
  MetaAdsSummaryResponse,
  MetaAdsTab,
  MetaAdsTrendPoint,
  MetaCampaignRow,
  MetaCreativeInventoryItem,
} from '@/metaAdsTypes'
import { describeMetaAdAccountStatus } from '@/metaAdsState'
import {
  ArrowClockwise,
  CheckCircle,
  FacebookLogo,
  FadersHorizontal,
  Link,
  Lock,
  PresentationChart,
  ShieldCheck,
  Spinner,
  Target,
  WarningCircle,
} from '@phosphor-icons/react'

const panelClass = 'border-slate-800/80 bg-slate-950/60 shadow-[0_20px_80px_rgba(2,6,23,0.35)] backdrop-blur-xl'

type MetaAdsEntityDetail =
  | { kind: 'campaign'; title: string; payload: MetaCampaignRow }
  | { kind: 'adset'; title: string; payload: MetaAdSet }
  | { kind: 'ad'; title: string; payload: MetaAd }
  | { kind: 'creative'; title: string; payload: MetaCreativeInventoryItem }

function formatCurrency(value: number, currency = 'USD') {
  try {
    return new Intl.NumberFormat('pt-BR', {
      style: 'currency',
      currency: currency || 'USD',
      maximumFractionDigits: 2,
    }).format(Number(value || 0))
  } catch {
    return `${currency || 'USD'} ${Number(value || 0).toFixed(2)}`
  }
}

function formatNumber(value: number) {
  return new Intl.NumberFormat('pt-BR').format(Number(value || 0))
}

function statusTone(status?: string) {
  const normalized = String(status || '').toUpperCase()
  if (normalized === 'ACTIVE') return 'bg-emerald-500/15 text-emerald-200 border-emerald-500/30'
  if (normalized === 'PAUSED') return 'bg-amber-500/15 text-amber-200 border-amber-500/30'
  if (normalized === 'ARCHIVED') return 'bg-slate-500/15 text-slate-200 border-slate-500/30'
  return 'border-slate-700 bg-slate-900/70 text-slate-200'
}

function describeAdAccountStatus(account: MetaAdAccount) {
  const status = describeMetaAdAccountStatus(account)
  return {
    ...status,
    tone:
      status.tone === 'success'
        ? 'border-emerald-500/30 bg-emerald-500/15 text-emerald-100'
        : status.tone === 'warning'
          ? 'border-amber-500/30 bg-amber-500/15 text-amber-100'
          : status.tone === 'danger'
            ? 'border-rose-500/30 bg-rose-500/15 text-rose-100'
            : 'border-slate-700 bg-slate-900/70 text-slate-200',
  }
}

export function MetaAdsEmptyState({ message, actionLabel, onAction }: { message: string; actionLabel?: string; onAction?: () => void }) {
  return (
    <Card className={panelClass}>
      <CardContent className="flex flex-col items-center gap-3 py-10 text-center text-sm text-slate-300">
        <div>{message}</div>
        {actionLabel && onAction ? <Button variant="outline" onClick={onAction}>{actionLabel}</Button> : null}
      </CardContent>
    </Card>
  )
}

export function MetaAdsStatusHero({
  connected,
  refreshing,
  selectedAccount,
  accounts,
  onSelectAccount,
  onManageConnections,
  onRefresh,
  onDisconnect,
}: {
  connected: boolean
  refreshing: boolean
  selectedAccount: MetaAdAccount | null
  accounts: MetaAdAccount[]
  onSelectAccount: (adAccountId: string) => void
  onManageConnections: () => void
  onRefresh: () => void
  onDisconnect: () => void
}) {
  const selectedAccountStatus = selectedAccount ? describeAdAccountStatus(selectedAccount) : null

  return (
    <Card className={`overflow-hidden ${panelClass}`}>
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top_left,rgba(59,130,246,0.18),transparent_36%),radial-gradient(circle_at_top_right,rgba(236,72,153,0.14),transparent_28%)]" />
      <CardHeader className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
        <div className="relative">
          <CardTitle className="flex items-center gap-3 text-white">
            <div className="flex items-center gap-2">
              <FacebookLogo className="h-6 w-6 text-sky-400" />
              <Target className="h-6 w-6 text-pink-400" />
            </div>
            Meta Ads
          </CardTitle>
          <CardDescription className="max-w-3xl text-slate-300">
            Conecte o Gerenciador de Anúncios da Meta ao CRM, escolha a conta certa e acompanhe inventário e tracking sem sair do módulo.
          </CardDescription>
        </div>
        <div className="relative flex flex-wrap items-center gap-2">
          {connected ? (
            <Badge className="border border-emerald-500/30 bg-emerald-500/15 text-emerald-100">
              <CheckCircle className="mr-1 h-4 w-4" />
              Conectado
            </Badge>
          ) : (
            <Badge className="border border-amber-500/30 bg-amber-500/15 text-amber-100">
              <Link className="mr-1 h-4 w-4" />
              Não conectado
            </Badge>
          )}
          <Button variant="outline" className="border-slate-700 bg-slate-900/60 text-slate-100 hover:bg-slate-800/80" onClick={onRefresh} disabled={refreshing}>
            {refreshing ? <Spinner className="mr-2 h-4 w-4 animate-spin" /> : <ArrowClockwise className="mr-2 h-4 w-4" />}
            Atualizar
          </Button>
          <Button variant="outline" className="border-slate-700 bg-slate-900/60 text-slate-100 hover:bg-slate-800/80" onClick={onManageConnections}>
            Gerenciar conexão
          </Button>
          {connected ? (
            <Button variant="outline" className="border-slate-700 bg-slate-900/60 text-slate-100 hover:bg-slate-800/80" onClick={onDisconnect} disabled={refreshing}>
              Desconectar
            </Button>
          ) : null}
        </div>
      </CardHeader>
      {connected ? (
        <CardContent className="relative flex flex-col gap-4 border-t border-slate-800/80 pt-0 md:flex-row md:items-center md:justify-between">
          <div className="grid gap-2 md:min-w-[20rem] md:max-w-md">
            <div className="text-xs uppercase tracking-[0.2em] text-slate-400/80">Conta de anúncios ativa</div>
            <Select value={selectedAccount?.id || undefined} onValueChange={onSelectAccount} disabled={!accounts.length || refreshing}>
              <SelectTrigger className="border-slate-700 bg-slate-900/70 text-slate-100">
                <SelectValue placeholder="Escolha a conta da Meta" />
              </SelectTrigger>
              <SelectContent>
                {accounts.map((account) => (
                  <SelectItem key={account.id} value={account.id}>
                    {account.name || account.id}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {selectedAccount ? (
              <>
                <Badge className="border border-slate-700 bg-slate-900/70 text-slate-100">
                  {selectedAccount.currency || '—'} · {selectedAccount.timezone_name || 'sem timezone'}
                </Badge>
                {selectedAccountStatus ? (
                  <Badge className={selectedAccountStatus.tone} title={selectedAccountStatus.detail}>
                    <ShieldCheck className="mr-1 h-4 w-4" />
                    {selectedAccountStatus.label}
                  </Badge>
                ) : null}
              </>
            ) : (
              <Badge className="border border-amber-500/30 bg-amber-500/15 text-amber-100">
                Escolha uma conta para liberar o módulo
              </Badge>
            )}
          </div>
        </CardContent>
      ) : null}
    </Card>
  )
}

export function MetaAdsHealthBanner({
  health,
  statusUpdatedAt,
  selectedAccount,
  onNavigate,
}: {
  health: MetaAdsHealthState
  statusUpdatedAt?: string | null
  selectedAccount: MetaAdAccount | null
  onNavigate: (tab: MetaAdsTab) => void
}) {
  const toneClass =
    health.tone === 'success'
      ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-100'
      : health.tone === 'danger'
      ? 'border-rose-500/30 bg-rose-500/10 text-rose-100'
      : health.tone === 'warning'
        ? 'border-amber-500/30 bg-amber-500/10 text-amber-100'
          : 'border-slate-700/80 bg-slate-900/60 text-slate-100'
  const updatedLabel = statusUpdatedAt
    ? format(new Date(statusUpdatedAt), "dd/MM/yyyy 'às' HH:mm", { locale: ptBR })
    : null

  return (
    <Card className={`${panelClass} ${toneClass}`}>
      <CardContent className="flex flex-col gap-4 pt-6 lg:flex-row lg:items-start lg:justify-between">
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <Badge className="border border-current/20 bg-transparent">
              {health.mode === 'forbidden' ? <Lock className="mr-1 h-4 w-4" /> : <WarningCircle className="mr-1 h-4 w-4" />}
              {health.title}
            </Badge>
            {selectedAccount ? (
              <Badge className="border border-current/20 bg-transparent">
                Conta ativa: {selectedAccount.name || selectedAccount.id}
              </Badge>
            ) : null}
          </div>
          <div className="text-sm leading-6 opacity-90">{health.description}</div>
          <div className="text-xs opacity-75">
            {updatedLabel ? `Última atualização de sessão: ${updatedLabel}` : 'Ainda sem atualização de sessão Meta nesta aba.'}
          </div>
        </div>
        {health.ctaLabel && health.ctaTab ? (
          <Button variant="outline" onClick={() => onNavigate(health.ctaTab!)}>
            {health.ctaLabel}
          </Button>
        ) : null}
      </CardContent>
    </Card>
  )
}

export function MetaAdsPersistentError({
  error,
  onRetry,
}: {
  error: MetaAdsApiError | null
  onRetry?: () => void
}) {
  if (!error) return null
  return (
    <Card className="border-rose-500/30 bg-rose-500/12 shadow-[0_20px_60px_rgba(136,19,55,0.18)] backdrop-blur-xl">
      <CardContent className="flex flex-col gap-3 pt-6 text-sm text-rose-100 lg:flex-row lg:items-center lg:justify-between">
        <div className="space-y-1">
          <div className="font-medium">
            {error.message}
          </div>
          {error.hint ? <div className="text-rose-100/80">{error.hint}</div> : null}
          <div className="font-mono text-xs text-rose-100/70">
            {error.code}{error.status ? ` · HTTP ${error.status}` : ''}
          </div>
        </div>
        {onRetry && error.retryable ? (
          <Button variant="outline" onClick={onRetry}>
            Tentar novamente
          </Button>
        ) : null}
      </CardContent>
    </Card>
  )
}

function MetaAdsEntityDetailDialog({
  detail,
  open,
  onOpenChange,
}: {
  detail: MetaAdsEntityDetail | null
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  if (!detail) return null

  const payload = detail.payload
  const previewUrl = detail.kind === 'creative' ? detail.payload.thumbnailUrl : undefined
  const sections: EntityDetailSection[] = [
    {
      title: 'Identificação',
      fields: [
        { label: 'Nome', value: payload.name },
        { label: 'ID', value: payload.id },
        {
          label: 'Status',
          value:
            ('effective_status' in payload && payload.effective_status) ||
            ('status' in payload && payload.status),
        },
      ],
    },
    {
      title: 'Relacionamentos',
      fields: [
        {
          label: 'Campanha',
          value:
            ('campaign_name' in payload && payload.campaign_name) ||
            ('campaignName' in payload && payload.campaignName) ||
            ('campaign_id' in payload && payload.campaign_id) ||
            ('campaignId' in payload && payload.campaignId),
        },
        {
          label: 'Conjunto de anúncios',
          value:
            ('adset_name' in payload && payload.adset_name) ||
            ('adSetName' in payload && payload.adSetName) ||
            ('adset_id' in payload && payload.adset_id) ||
            ('adSetId' in payload && payload.adSetId),
        },
        {
          label: 'Anúncio',
          value:
            ('adName' in payload && payload.adName) ||
            ('adId' in payload && payload.adId),
        },
        {
          label: 'Criativo',
          value:
            ('creative' in payload && payload.creative?.name) ||
            ('creative' in payload && payload.creative?.id) ||
            ('effectiveObjectStoryId' in payload && payload.id),
        },
        { label: 'Objetivo', value: 'objective' in payload ? payload.objective : undefined },
        {
          label: 'Anúncios associados',
          value:
            ('ads_count' in payload && payload.ads_count) ||
            ('ads' in payload && Array.isArray(payload.ads) ? payload.ads.length : undefined),
        },
      ],
    },
    {
      title: 'Orçamento e otimização',
      fields: [
        { label: 'Orçamento diário', value: 'daily_budget' in payload ? payload.daily_budget : undefined },
        { label: 'Orçamento vitalício', value: 'lifetime_budget' in payload ? payload.lifetime_budget : undefined },
        { label: 'Estratégia de lance', value: 'bid_strategy' in payload ? payload.bid_strategy : undefined },
        { label: 'Meta de otimização', value: 'optimization_goal' in payload ? payload.optimization_goal : undefined },
      ],
    },
    {
      title: 'Janela operacional',
      fields: [
        { label: 'Início', value: 'start_time' in payload ? payload.start_time : undefined },
        {
          label: 'Fim',
          value:
            ('stop_time' in payload && payload.stop_time) ||
            ('end_time' in payload && payload.end_time),
        },
        {
          label: 'Story ID efetivo',
          value:
            ('effectiveObjectStoryId' in payload && payload.effectiveObjectStoryId) ||
            ('creative' in payload && payload.creative?.effective_object_story_id),
        },
      ],
    },
  ]

  return (
    <EntityDetailModal
      open={open}
      onOpenChange={onOpenChange}
      title={detail.title}
      description="Configuração consolidada do item selecionado dentro do inventário da conta Meta."
      previewUrl={previewUrl}
      sections={sections}
      rawPayload={payload}
    />
  )
}

export function MetaAdsWorkspaceTabs() {
  return (
    <TabsList className="grid w-full max-w-3xl grid-cols-2 rounded-3xl border border-slate-800/80 bg-slate-950/65 p-2 backdrop-blur-xl">
      <TabsTrigger value="overview">Visão geral</TabsTrigger>
      <TabsTrigger value="inventory">Inventário</TabsTrigger>
    </TabsList>
  )
}

export function MetaAdsConnectionPanel({
  connectDisabled,
  onOAuth,
  manualToken,
  setManualToken,
  onManualConnect,
  manualDisabled,
}: {
  connectDisabled: boolean
  onOAuth: () => void
  manualToken: string
  setManualToken: (value: string) => void
  onManualConnect: () => void
  manualDisabled: boolean
}) {
  const [showManualAccess, setShowManualAccess] = useState(false)
  const manualAccessLabel = useMemo(
    () => (showManualAccess ? 'Ocultar acessos alternativos' : 'Outros tipos de acesso'),
    [showManualAccess],
  )

  return (
    <Card className={`overflow-hidden ${panelClass}`}>
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top_left,rgba(59,130,246,0.18),transparent_36%),radial-gradient(circle_at_top_right,rgba(236,72,153,0.14),transparent_28%)]" />
      <CardHeader className="relative gap-6">
        <div className="space-y-2">
          <CardTitle>Conectar a conta Meta</CardTitle>
          <CardDescription className="text-slate-300">
            Autorize com Facebook no fluxo principal. O token manual permanece apenas como contingência administrativa.
          </CardDescription>
        </div>
      </CardHeader>
      <CardContent className="relative space-y-6">
        <div className="rounded-3xl border border-slate-800/80 bg-slate-900/65 p-5">
          <div className="flex flex-col gap-4">
            <div className="space-y-2">
              <div className="text-sm font-medium text-white">Fluxo recomendado</div>
              <div className="text-sm leading-6 text-slate-300">
                O login do Facebook abre em uma janela segura sobre o CRM. Depois da autorização, basta escolher a conta de anúncios correta para liberar as demais áreas.
              </div>
            </div>
            <Button className="bg-sky-500 text-slate-950 hover:bg-sky-400" onClick={onOAuth} disabled={connectDisabled}>
              Conectar com Facebook
            </Button>
            <div>
              <button
                type="button"
                onClick={() => setShowManualAccess((current) => !current)}
                className="text-sm font-medium text-slate-300 transition hover:text-white"
              >
                {manualAccessLabel}
              </button>
            </div>
          </div>
        </div>
        {showManualAccess ? (
          <div className="rounded-3xl border border-slate-800/80 bg-slate-900/45 p-5">
            <div className="mb-3 text-sm font-medium text-white">Acesso por token manual</div>
            <div className="mb-4 text-sm text-slate-300">
              Use esta rota apenas para tokens de longa duração ou integrações administrativas.
            </div>
            <Textarea
              value={manualToken}
              onChange={(e) => setManualToken(e.target.value)}
              placeholder="Cole aqui o access token da Meta"
              className="min-h-28 border-slate-700 bg-slate-950/70 text-slate-100 placeholder:text-slate-500"
            />
            <div className="mt-4 flex justify-end">
              <Button variant="outline" className="border-slate-700 bg-slate-900/60 text-slate-100 hover:bg-slate-800/80" onClick={onManualConnect} disabled={manualDisabled}>
                Validar e conectar token
              </Button>
            </div>
          </div>
        ) : null}
      </CardContent>
    </Card>
  )
}

export function MetaAdsOAuthDialog({
  open,
  state,
  error,
  onOpenChange,
  onRetry,
}: {
  open: boolean
  state: 'opening' | 'opened' | 'blocked' | 'closed' | 'error'
  error?: MetaAdsApiError | null
  onOpenChange: (open: boolean) => void
  onRetry: () => void
}) {
  const title =
    state === 'blocked'
      ? 'Permita a janela do Facebook'
      : state === 'closed'
        ? 'Continue a conexão com Facebook'
        : state === 'error'
          ? 'Falha ao concluir o login da Meta'
        : 'Conectar com Facebook'

  const description =
    state === 'blocked'
      ? 'O navegador bloqueou a janela de autenticação. Libere pop-ups para o CRM e tente abrir novamente.'
      : state === 'closed'
        ? 'A janela foi fechada antes de concluir a autorização. Reabra o login do Facebook para continuar.'
        : state === 'error'
          ? error?.hint || error?.message || 'O Facebook retornou um erro antes de concluir a conexão no CRM.'
        : 'O Facebook foi aberto em uma janela segura para concluir a autenticação da conta Meta sem sair desta página.'

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg border-slate-800/80 bg-slate-950 text-slate-100">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription className="text-slate-300">{description}</DialogDescription>
        </DialogHeader>
        <div className="rounded-2xl border border-slate-800/80 bg-slate-900/70 p-4 text-sm text-slate-300">
          {state === 'blocked' ? (
            <div>
              Se o pop-up não aparecer, permita janelas para <span className="font-medium text-white">crm.skincos.com.br</span> e clique em <span className="font-medium text-white">Abrir login novamente</span>.
            </div>
          ) : state === 'closed' ? (
            <div>
              A autenticação precisa ser concluída na janela do Facebook. Se você finalizou o login e nada mudou, reabra a janela para tentar novamente.
            </div>
          ) : state === 'error' ? (
            <div className="space-y-2">
              <div className="font-medium text-white">{error?.message || 'O login da Meta falhou.'}</div>
              {error?.hint ? <div>{error.hint}</div> : null}
              {error?.code ? <div className="font-mono text-xs text-slate-400">{error.code}</div> : null}
            </div>
          ) : (
            <div className="flex items-center gap-3">
              <Spinner className="h-4 w-4 animate-spin text-sky-300" />
              <span>Aguardando autorização do Facebook...</span>
            </div>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" className="border-slate-700 bg-slate-900/60 text-slate-100 hover:bg-slate-800/80" onClick={() => onOpenChange(false)}>
            Fechar
          </Button>
          {(state === 'blocked' || state === 'closed' || state === 'error') ? (
            <Button className="bg-sky-500 text-slate-950 hover:bg-sky-400" onClick={onRetry}>
              Abrir login novamente
            </Button>
          ) : null}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

export function MetaAdsAccountsPanel({
  connected,
  accounts,
  refreshing,
  accountsError,
  onRetry,
  onSelectAccount,
}: {
  connected: boolean
  accounts: MetaAdAccount[]
  refreshing: boolean
  accountsError: MetaAdsApiError | null
  onRetry: () => void
  onSelectAccount: (adAccountId: string) => void
}) {
  return (
    <Card className={panelClass}>
      <CardHeader>
        <CardTitle>Escolher a conta de anúncios</CardTitle>
        <CardDescription className="text-slate-300">
          A conta selecionada define qual inventário e qual visão geral alimentarão o CRM daqui em diante.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <MetaAdsPersistentError error={accountsError} onRetry={onRetry} />
        {!connected ? (
          <div className="text-sm text-slate-300">Conecte a Meta primeiro para listar as contas disponíveis.</div>
        ) : accounts.length === 0 ? (
          <div className="text-sm text-slate-300">Nenhuma conta encontrada para este usuário/token.</div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow className="border-slate-800">
                <TableHead>Conta</TableHead>
                <TableHead>Nome</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Moeda</TableHead>
                <TableHead>Timezone</TableHead>
                <TableHead className="text-right">Ação</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {accounts.map((account) => {
                const accountStatus = describeAdAccountStatus(account)
                return (
                  <TableRow key={account.id} className="border-slate-800/80">
                    <TableCell className="font-mono text-slate-200">{account.id}</TableCell>
                    <TableCell className="text-slate-100">
                      <div className="space-y-1">
                        <div>{account.name || '—'}</div>
                        {account.business_name ? <div className="text-xs text-slate-400">{account.business_name}</div> : null}
                      </div>
                    </TableCell>
                    <TableCell>
                      <Badge className={accountStatus.tone} title={accountStatus.detail}>
                        {accountStatus.label}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-slate-300">{account.currency || '—'}</TableCell>
                    <TableCell className="text-slate-300">{account.timezone_name || '—'}</TableCell>
                    <TableCell className="text-right">
                      {account.isSelected ? (
                        <Badge className="border border-emerald-500/30 bg-emerald-500/15 text-emerald-100">Selecionada</Badge>
                      ) : (
                        <Button size="sm" variant="outline" className="border-slate-700 bg-slate-900/60 text-slate-100 hover:bg-slate-800/80" onClick={() => onSelectAccount(account.id)} disabled={refreshing}>
                          Selecionar
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  )
}

export function MetaAdsOverviewPanel({
  selectedAccount,
  summary,
  trend,
  inventory,
  overviewError,
  onRetry,
}: {
  selectedAccount: MetaAdAccount
  summary: MetaAdsSummaryResponse | null
  trend: MetaAdsTrendPoint[]
  inventory: MetaAdsInventory | null
  overviewError: MetaAdsApiError | null
  onRetry?: () => void
}) {
  const creativeCount = inventory?.creatives?.length || 0
  const adCount = inventory?.ads?.length || 0
  const adSetCount = inventory?.adSets?.length || 0
  const campaignCount = inventory?.campaigns?.length || 0

  return (
    <>
      <MetaAdsPersistentError error={overviewError} onRetry={onRetry} />
      <div className="grid gap-4 md:grid-cols-4">
        <Card className={panelClass}>
          <CardHeader>
            <CardDescription className="text-slate-400">Spend (7 dias)</CardDescription>
            <CardTitle>{formatCurrency(summary?.spend ?? 0, selectedAccount.currency || 'USD')}</CardTitle>
          </CardHeader>
        </Card>
        <Card className={panelClass}>
          <CardHeader>
            <CardDescription className="text-slate-400">Impressões</CardDescription>
            <CardTitle>{formatNumber(summary?.impressions ?? 0)}</CardTitle>
          </CardHeader>
        </Card>
        <Card className={panelClass}>
          <CardHeader>
            <CardDescription className="text-slate-400">Clicks</CardDescription>
            <CardTitle>{formatNumber(summary?.clicks ?? 0)}</CardTitle>
          </CardHeader>
        </Card>
        <Card className={panelClass}>
          <CardHeader>
            <CardDescription className="text-slate-400">Campanhas ativas</CardDescription>
            <CardTitle>{formatNumber(summary?.activeCampaigns ?? 0)}</CardTitle>
          </CardHeader>
        </Card>
      </div>

      <div className="grid gap-4 md:grid-cols-4">
        <Card className={panelClass}>
          <CardHeader>
            <CardDescription className="text-slate-400">Campanhas</CardDescription>
            <CardTitle>{campaignCount}</CardTitle>
          </CardHeader>
        </Card>
        <Card className={panelClass}>
          <CardHeader>
            <CardDescription className="text-slate-400">Conjuntos</CardDescription>
            <CardTitle>{adSetCount}</CardTitle>
          </CardHeader>
        </Card>
        <Card className={panelClass}>
          <CardHeader>
            <CardDescription className="text-slate-400">Anúncios</CardDescription>
            <CardTitle>{adCount}</CardTitle>
          </CardHeader>
        </Card>
        <Card className={panelClass}>
          <CardHeader>
            <CardDescription className="text-slate-400">Criativos</CardDescription>
            <CardTitle>{creativeCount}</CardTitle>
          </CardHeader>
        </Card>
      </div>

      <Card className={panelClass}>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <PresentationChart className="h-5 w-5 text-sky-300" />
            Tendência de gasto
          </CardTitle>
          <CardDescription className="text-slate-300">Últimos 7 dias da conta selecionada.</CardDescription>
        </CardHeader>
        <CardContent className="h-72">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={trend}>
              <XAxis dataKey="day" />
              <YAxis />
              <Tooltip />
              <Line type="monotone" dataKey="spend" stroke="#38bdf8" strokeWidth={2} />
            </LineChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>
    </>
  )
}

export function MetaAdsInventoryPanel({
  inventory,
  inventoryError,
  onRetry,
}: {
  inventory: MetaAdsInventory
  inventoryError: MetaAdsApiError | null
  onRetry?: () => void
}) {
  const [selection, setSelection] = useState<Partial<Record<MetaAdsInventoryLevel, string>>>({})
  const [selectedCreativeId, setSelectedCreativeId] = useState<string | null>(null)
  const [detail, setDetail] = useState<MetaAdsEntityDetail | null>(null)

  const selectedCampaignId = selection.campaign || null
  const selectedAdSetId = selection.adset || null
  const selectedAdId = selection.ad || null

  const campaignsById = useMemo(
    () => new Map(inventory.campaigns.map((campaign) => [campaign.id, campaign])),
    [inventory.campaigns],
  )
  const adSetsById = useMemo(
    () => new Map(inventory.adSets.map((adSet) => [adSet.id, adSet])),
    [inventory.adSets],
  )
  const adsById = useMemo(
    () => new Map(inventory.ads.map((ad) => [ad.id, ad])),
    [inventory.ads],
  )

  const selectedCampaign = selectedCampaignId
    ? campaignsById.get(selectedCampaignId) || null
    : null
  const selectedAdSet = selectedAdSetId
    ? adSetsById.get(selectedAdSetId) || null
    : null
  const selectedAd = selectedAdId
    ? adsById.get(selectedAdId) || null
    : null
  const selectedCreative = selectedCreativeId
    ? inventory.creatives.find((creative) => creative.id === selectedCreativeId) || null
    : null

  const filteredCampaigns = useMemo(() => {
    if (!selectedCampaignId) return inventory.campaigns
    return inventory.campaigns.filter((campaign) => campaign.id === selectedCampaignId)
  }, [inventory.campaigns, selectedCampaignId])

  const filteredAdSets = useMemo(() => {
    return inventory.adSets.filter((adSet) => {
      if (selectedCampaignId && adSet.campaign_id !== selectedCampaignId) return false
      return !selectedAdSetId || adSet.id === selectedAdSetId
    })
  }, [inventory.adSets, selectedCampaignId, selectedAdSetId])

  const filteredAds = useMemo(() => {
    return inventory.ads.filter((ad) => {
      if (selectedCampaignId && ad.campaign_id !== selectedCampaignId) return false
      if (selectedAdSetId && ad.adset_id !== selectedAdSetId) return false
      return !selectedAdId || ad.id === selectedAdId
    })
  }, [inventory.ads, selectedCampaignId, selectedAdSetId, selectedAdId])

  const filteredCreatives = useMemo(() => {
    return inventory.creatives.filter((creative) => {
      if (selectedCampaignId && creative.campaignId !== selectedCampaignId) return false
      if (selectedAdSetId && creative.adSetId !== selectedAdSetId) return false
      if (selectedAdId && creative.adId !== selectedAdId) return false
      return !selectedCreativeId || creative.id === selectedCreativeId
    })
  }, [inventory.creatives, selectedCampaignId, selectedAdSetId, selectedAdId, selectedCreativeId])

  const clearSelection = () => {
    setSelection({})
    setSelectedCreativeId(null)
  }

  const handleCampaignSelect = (campaignId: string) => {
    if (selectedCampaignId === campaignId && !selectedAdSetId && !selectedAdId && !selectedCreativeId) {
      clearSelection()
      return
    }
    setSelection({ campaign: campaignId })
    setSelectedCreativeId(null)
  }

  const handleAdSetSelect = (adSet: MetaAdSet) => {
    const parentCampaignId = adSet.campaign_id || null
    if (selectedAdSetId === adSet.id && !selectedAdId && !selectedCreativeId) {
      setSelection(parentCampaignId ? { campaign: parentCampaignId } : {})
      setSelectedCreativeId(null)
      return
    }
    setSelection({
      campaign: parentCampaignId || undefined,
      adset: adSet.id,
    })
    setSelectedCreativeId(null)
  }

  const handleAdSelect = (ad: MetaAd) => {
    const parentCampaignId = ad.campaign_id || null
    const parentAdSetId = ad.adset_id || null
    if (selectedAdId === ad.id && !selectedCreativeId) {
      setSelection({
        campaign: parentCampaignId || undefined,
        adset: parentAdSetId || undefined,
      })
      setSelectedCreativeId(null)
      return
    }
    setSelection({
      campaign: parentCampaignId || undefined,
      adset: parentAdSetId || undefined,
      ad: ad.id,
    })
    setSelectedCreativeId(null)
  }

  const handleCreativeSelect = (creative: MetaCreativeInventoryItem) => {
    if (selectedCreativeId === creative.id) {
      setSelectedCreativeId(null)
      setSelection({
        campaign: creative.campaignId || undefined,
        adset: creative.adSetId || undefined,
        ad: creative.adId || undefined,
      })
      return
    }
    setSelection({
      campaign: creative.campaignId || undefined,
      adset: creative.adSetId || undefined,
      ad: creative.adId || undefined,
    })
    setSelectedCreativeId(creative.id)
  }

  const clearSelectionFromLevel = (level: MetaAdsInventoryLevel) => {
    if (level === 'campaign') {
      clearSelection()
      return
    }
    if (level === 'adset') {
      setSelection((current) => ({ campaign: current.campaign }))
      setSelectedCreativeId(null)
      return
    }
    if (level === 'ad') {
      setSelection((current) => ({
        campaign: current.campaign,
        adset: current.adset,
      }))
      setSelectedCreativeId(null)
      return
    }
    setSelectedCreativeId(null)
  }

  const rowClass = (isSelected: boolean) =>
    `border-slate-800/80 transition ${isSelected ? 'bg-sky-500/10' : 'hover:bg-slate-900/45'}`

  const itemButtonClass = (isSelected: boolean) =>
    `text-left transition ${isSelected ? 'text-sky-200' : 'text-white hover:text-sky-200'}`

  return (
    <>
      <MetaAdsPersistentError error={inventoryError} onRetry={onRetry} />
      <MetaAdsEntityDetailDialog detail={detail} open={Boolean(detail)} onOpenChange={(open) => !open && setDetail(null)} />
      {(selectedCampaign || selectedAdSet || selectedAd || selectedCreative) ? (
        <Card className={panelClass}>
          <CardContent className="flex flex-col gap-3 pt-6 md:flex-row md:items-center md:justify-between">
            <div className="flex flex-wrap items-center gap-2 text-sm text-slate-200">
              <span className="text-slate-400">Filtro ativo:</span>
              {selectedCampaign ? (
                <button
                  type="button"
                  onClick={() => clearSelectionFromLevel('campaign')}
                  className="inline-flex h-8 items-center gap-1 rounded-full border border-sky-500/30 bg-sky-500/15 px-3 text-sky-100 transition hover:bg-sky-500/20"
                >
                  Campanha: {selectedCampaign.name || selectedCampaign.id}
                </button>
              ) : null}
              {selectedAdSet ? (
                <button
                  type="button"
                  onClick={() => clearSelectionFromLevel('adset')}
                  className="inline-flex h-8 items-center gap-1 rounded-full border border-sky-500/30 bg-sky-500/15 px-3 text-sky-100 transition hover:bg-sky-500/20"
                >
                  Conjunto: {selectedAdSet.name || selectedAdSet.id}
                </button>
              ) : null}
              {selectedAd ? (
                <button
                  type="button"
                  onClick={() => clearSelectionFromLevel('ad')}
                  className="inline-flex h-8 items-center gap-1 rounded-full border border-sky-500/30 bg-sky-500/15 px-3 text-sky-100 transition hover:bg-sky-500/20"
                >
                  Anúncio: {selectedAd.name || selectedAd.id}
                </button>
              ) : null}
              {selectedCreative ? (
                <button
                  type="button"
                  onClick={() => clearSelectionFromLevel('creative')}
                  className="inline-flex h-8 items-center gap-1 rounded-full border border-sky-500/30 bg-sky-500/15 px-3 text-sky-100 transition hover:bg-sky-500/20"
                >
                  Criativo: {selectedCreative.name || selectedCreative.id}
                </button>
              ) : null}
            </div>
            <Button variant="outline" className="border-slate-700 bg-slate-900/60 text-slate-100 hover:bg-slate-800/80" onClick={clearSelection}>
              Limpar filtro
            </Button>
          </CardContent>
        </Card>
      ) : null}
      <Card className={panelClass}>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <FadersHorizontal className="h-5 w-5 text-sky-300" />
            Campanha
          </CardTitle>
          <CardDescription className="text-slate-300">
            Relação das campanhas da conta selecionada com objetivo, status e volume de entrega associado.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow className="border-slate-800">
                <TableHead>Campanha</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Objetivo</TableHead>
                <TableHead>Conjuntos</TableHead>
                <TableHead>Anúncios</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filteredCampaigns.map((campaign) => (
                <TableRow key={campaign.id} className={rowClass(selectedCampaignId === campaign.id)}>
                  <TableCell>
                    <div className="space-y-1">
                      <div className="flex items-center gap-2">
                        <button type="button" className={itemButtonClass(selectedCampaignId === campaign.id)} onClick={() => handleCampaignSelect(campaign.id)}>
                          {campaign.name || campaign.id}
                        </button>
                        <OpenEntityButton onClick={() => setDetail({ kind: 'campaign', title: campaign.name || campaign.id, payload: campaign })} />
                      </div>
                      <div className="font-mono text-xs text-blue-100/60">{campaign.id}</div>
                    </div>
                  </TableCell>
                  <TableCell>
                    <Badge className={statusTone(campaign.effective_status || campaign.status)}>
                      {campaign.effective_status || campaign.status || '—'}
                    </Badge>
                  </TableCell>
                  <TableCell>{campaign.objective || '—'}</TableCell>
                  <TableCell>{campaign.totals?.adSets || 0}</TableCell>
                  <TableCell>{campaign.totals?.ads || 0}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Card className={panelClass}>
        <CardHeader>
          <CardTitle>Conjunto de Anúncios</CardTitle>
          <CardDescription className="text-slate-300">
            Organização intermediária entre campanha e anúncio, com o status operacional de cada conjunto.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow className="border-slate-800">
                <TableHead>Conjunto de anúncios</TableHead>
                <TableHead>Campanha</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Anúncios</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filteredAdSets.map((adSet) => (
                <TableRow key={adSet.id} className={rowClass(selectedAdSetId === adSet.id)}>
                  <TableCell>
                    <div className="space-y-1">
                      <div className="flex items-center gap-2">
                        <button type="button" className={itemButtonClass(selectedAdSetId === adSet.id)} onClick={() => handleAdSetSelect(adSet)}>
                          {adSet.name || adSet.id}
                        </button>
                        <OpenEntityButton onClick={() => setDetail({ kind: 'adset', title: adSet.name || adSet.id, payload: adSet })} />
                      </div>
                      <div className="font-mono text-xs text-blue-100/60">{adSet.id}</div>
                    </div>
                  </TableCell>
                  <TableCell>{adSet.campaign_name || adSet.campaign_id || '—'}</TableCell>
                  <TableCell>
                    <Badge className={statusTone(adSet.effective_status || adSet.status)}>
                      {adSet.effective_status || adSet.status || '—'}
                    </Badge>
                  </TableCell>
                  <TableCell>{adSet.ads_count ?? adSet.ads?.length ?? '—'}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Card className={panelClass}>
        <CardHeader>
          <CardTitle>Anúncio</CardTitle>
          <CardDescription className="text-slate-300">
            Mapa direto de anúncios com campanha, conjunto e criativo associados.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow className="border-slate-800">
                <TableHead>Anúncio</TableHead>
                <TableHead>Campanha</TableHead>
                <TableHead>Conjunto</TableHead>
                <TableHead>Criativo</TableHead>
                <TableHead>Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filteredAds.map((ad) => (
                <TableRow key={ad.id} className={rowClass(selectedAdId === ad.id)}>
                  <TableCell>
                    <div className="space-y-1">
                      <div className="flex items-center gap-2">
                        <button type="button" className={itemButtonClass(selectedAdId === ad.id)} onClick={() => handleAdSelect(ad)}>
                          {ad.name || ad.id}
                        </button>
                        <OpenEntityButton onClick={() => setDetail({ kind: 'ad', title: ad.name || ad.id, payload: ad })} />
                      </div>
                      <div className="font-mono text-xs text-blue-100/60">{ad.id}</div>
                    </div>
                  </TableCell>
                  <TableCell>{ad.campaign_name || ad.campaign_id || '—'}</TableCell>
                  <TableCell>{ad.adset_name || ad.adset_id || '—'}</TableCell>
                  <TableCell>{ad.creative?.name || ad.creative?.id || '—'}</TableCell>
                  <TableCell>
                    <Badge className={statusTone(ad.effective_status || ad.status)}>
                      {ad.effective_status || ad.status || '—'}
                    </Badge>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Card className={panelClass}>
        <CardHeader>
          <CardTitle>Criativo</CardTitle>
          <CardDescription className="text-slate-300">
            Criativos deduplicados a partir dos anúncios retornados pela Meta para a conta selecionada.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {filteredCreatives.length === 0 ? (
            <div className="text-sm text-slate-300">Nenhum criativo encontrado.</div>
          ) : (
            filteredCreatives.map((creative) => (
              <button
                key={creative.id}
                type="button"
                onClick={() => handleCreativeSelect(creative)}
                className={`rounded-2xl border p-4 text-left transition ${
                  selectedCreativeId === creative.id
                    ? 'border-sky-500/40 bg-sky-500/10'
                    : 'border-slate-800/80 bg-slate-900/55 hover:bg-slate-900/75'
                }`}
              >
                {creative.thumbnailUrl ? (
                  <img
                    src={creative.thumbnailUrl}
                    alt={creative.name || creative.id}
                    className="mb-3 h-40 w-full rounded-xl object-cover"
                  />
                ) : null}
                <div className="space-y-1">
                  <div className="flex items-center gap-2">
                    <div className="font-medium text-white">{creative.name || creative.id}</div>
                    <OpenEntityButton onClick={() => setDetail({ kind: 'creative', title: creative.name || creative.id, payload: creative })} />
                  </div>
                  <div className="font-mono text-xs text-slate-400">{creative.id}</div>
                  <div className="text-xs text-slate-300">Campanha: {creative.campaignName || creative.campaignId || '—'}</div>
                  <div className="text-xs text-slate-300">Conjunto: {creative.adSetName || creative.adSetId || '—'}</div>
                  <div className="text-xs text-slate-300">Anúncio: {creative.adName || creative.adId || '—'}</div>
                </div>
              </button>
            ))
          )}
        </CardContent>
      </Card>
    </>
  )
}
