import { format } from 'date-fns'
import { ptBR } from 'date-fns/locale'
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts'
import { Badge } from '@/badge'
import { Button } from '@/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/card'
import { TabsList, TabsTrigger } from '@/tabs'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/table'
import { Textarea } from '@/textarea'
import type {
  MetaAdAccount,
  MetaAdsApiError,
  MetaAdsHealthState,
  MetaAdsInventory,
  MetaAdsSummaryResponse,
  MetaAdsStatusResponse,
  MetaAdsTab,
  MetaAdsTrendPoint,
} from '@/metaAdsTypes'
import {
  ArrowClockwise,
  CheckCircle,
  FacebookLogo,
  FadersHorizontal,
  Link,
  Lock,
  PresentationChart,
  Spinner,
  Target,
  WarningCircle,
} from '@phosphor-icons/react'

function formatDateTimeLabel(value?: string | null) {
  if (!value) return '—'
  try {
    return format(new Date(value), "dd/MM/yyyy 'às' HH:mm", { locale: ptBR })
  } catch {
    return '—'
  }
}

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
  return 'bg-white/10 text-blue-100 border-white/10'
}

export function MetaAdsEmptyState({ message, actionLabel, onAction }: { message: string; actionLabel?: string; onAction?: () => void }) {
  return (
    <Card className="glass-card border-white/10">
      <CardContent className="flex flex-col items-center gap-3 py-10 text-center text-sm text-blue-100/70">
        <div>{message}</div>
        {actionLabel && onAction ? <Button variant="outline" onClick={onAction}>{actionLabel}</Button> : null}
      </CardContent>
    </Card>
  )
}

export function MetaAdsStatusHero({
  connected,
  refreshing,
  onRefresh,
  onDisconnect,
}: {
  connected: boolean
  refreshing: boolean
  onRefresh: () => void
  onDisconnect: () => void
}) {
  return (
    <Card className="glass-card border-white/10">
      <CardHeader className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
        <div>
          <CardTitle className="flex items-center gap-3 text-white">
            <div className="flex items-center gap-2">
              <FacebookLogo className="h-6 w-6 text-blue-400" />
              <Target className="h-6 w-6 text-pink-400" />
            </div>
            Meta Ads
          </CardTitle>
          <CardDescription>
            Conecte o Gerenciador de Anúncios da Meta ao CRM, escolha a conta certa e acompanhe inventário e tracking sem sair do módulo.
          </CardDescription>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {connected ? (
            <Badge className="bg-emerald-500/15 text-emerald-200 border border-emerald-500/30">
              <CheckCircle className="mr-1 h-4 w-4" />
              Conectado
            </Badge>
          ) : (
            <Badge className="bg-amber-500/15 text-amber-200 border border-amber-500/30">
              <Link className="mr-1 h-4 w-4" />
              Não conectado
            </Badge>
          )}
          <Button variant="outline" onClick={onRefresh} disabled={refreshing}>
            {refreshing ? <Spinner className="mr-2 h-4 w-4 animate-spin" /> : <ArrowClockwise className="mr-2 h-4 w-4" />}
            Atualizar
          </Button>
          {connected ? (
            <Button variant="outline" onClick={onDisconnect} disabled={refreshing}>
              Desconectar
            </Button>
          ) : null}
        </div>
      </CardHeader>
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
          : 'border-white/10 bg-white/[0.03] text-blue-100'
  const updatedLabel = statusUpdatedAt
    ? format(new Date(statusUpdatedAt), "dd/MM/yyyy 'às' HH:mm", { locale: ptBR })
    : null

  return (
    <Card className={`glass-card ${toneClass}`}>
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
    <Card className="glass-card border-rose-500/30 bg-rose-500/10">
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

export function MetaAdsWorkspaceTabs({
  trackingDisabled,
}: {
  trackingDisabled?: boolean
}) {
  return (
    <TabsList className="grid w-full max-w-5xl grid-cols-4 glass-morphism p-2 border-white/20">
      <TabsTrigger value="connect">Conexão</TabsTrigger>
      <TabsTrigger value="overview">Visão geral</TabsTrigger>
      <TabsTrigger value="inventory">Inventário</TabsTrigger>
      <TabsTrigger value="tracking" disabled={trackingDisabled}>
        Tracking
      </TabsTrigger>
    </TabsList>
  )
}

export function MetaAdsSessionFacts({
  status,
  selectedAccount,
}: {
  status: MetaAdsStatusResponse | null
  selectedAccount: MetaAdAccount | null
}) {
  const connection = status?.connection
  const facts = [
    {
      label: 'Modo de conexão',
      value: connection?.connected ? (connection.tokenType === 'oauth' ? 'Facebook OAuth' : 'Token manual') : 'Desconectado',
    },
    {
      label: 'Conta selecionada',
      value: selectedAccount?.name || selectedAccount?.id || 'Ainda não selecionada',
    },
    {
      label: 'Escopos ativos',
      value: connection?.scopes?.length ? `${connection.scopes.length} escopos` : 'Nenhum escopo reportado',
    },
    {
      label: 'Expiração do token',
      value: formatDateTimeLabel(connection?.expiresAt),
    },
    {
      label: 'Última atualização',
      value: formatDateTimeLabel(connection?.updatedAt),
    },
  ]

  return (
    <Card className="glass-card border-white/10">
      <CardHeader>
        <CardTitle>Saúde da integração</CardTitle>
        <CardDescription>
          Este resumo mostra se o problema atual é login, permissão, configuração do runtime ou ausência de conta selecionada.
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-3 md:grid-cols-2 xl:grid-cols-5">
        {facts.map((fact) => (
          <div key={fact.label} className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
            <div className="text-xs uppercase tracking-[0.22em] text-blue-100/55">{fact.label}</div>
            <div className="mt-2 text-sm font-medium text-white">{fact.value}</div>
          </div>
        ))}
      </CardContent>
    </Card>
  )
}

export function MetaAdsConnectionPanel({
  scopesLabel,
  connectedUser,
  connectDisabled,
  onOAuth,
}: {
  scopesLabel: string
  connectedUser?: string | null
  connectDisabled: boolean
  onOAuth: () => void
}) {
  return (
    <Card className="glass-card border-white/10">
      <CardHeader>
        <CardTitle>1. Autorize o Facebook</CardTitle>
        <CardDescription>
          Use OAuth quando quiser uma conexão guiada dentro do CRM. Se o popup for bloqueado, o fluxo cai para a mesma aba.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-wrap gap-2">
          <Button onClick={onOAuth} disabled={connectDisabled}>
            Conectar via Facebook
          </Button>
          <Badge className="bg-white/10 text-blue-100 border border-white/10">
            Escopos: {scopesLabel}
          </Badge>
        </div>
        {connectedUser ? (
          <div className="text-sm text-blue-100/70">
            Usuário Meta conectado: <span className="font-medium text-white">{connectedUser}</span>
          </div>
        ) : null}
      </CardContent>
    </Card>
  )
}

export function MetaAdsManualTokenPanel({
  manualToken,
  setManualToken,
  onConnect,
  disabled,
}: {
  manualToken: string
  setManualToken: (value: string) => void
  onConnect: () => void
  disabled: boolean
}) {
  return (
    <Card className="glass-card border-white/10">
      <CardHeader>
        <CardTitle>2. Ou conecte por token manual</CardTitle>
        <CardDescription>
          Use esta rota para tokens de longa duração ou acessos administrativos em ambientes mais controlados.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <Textarea
          value={manualToken}
          onChange={(e) => setManualToken(e.target.value)}
          placeholder="Cole aqui o access token da Meta"
          className="min-h-28"
        />
        <div className="flex justify-end">
          <Button onClick={onConnect} disabled={disabled}>
            Validar e conectar token
          </Button>
        </div>
      </CardContent>
    </Card>
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
    <Card className="glass-card border-white/10">
      <CardHeader>
        <CardTitle>3. Escolha a conta de anúncios</CardTitle>
        <CardDescription>
          A conta selecionada define qual inventário e qual visão geral alimentarão o CRM daqui em diante.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <MetaAdsPersistentError error={accountsError} onRetry={onRetry} />
        {!connected ? (
          <div className="text-sm text-blue-100/70">Conecte a Meta primeiro para listar as contas disponíveis.</div>
        ) : accounts.length === 0 ? (
          <div className="text-sm text-blue-100/70">Nenhuma conta encontrada para este usuário/token.</div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Conta</TableHead>
                <TableHead>Nome</TableHead>
                <TableHead>Moeda</TableHead>
                <TableHead>Timezone</TableHead>
                <TableHead className="text-right">Ação</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {accounts.map((account) => (
                <TableRow key={account.id}>
                  <TableCell className="font-mono">{account.id}</TableCell>
                  <TableCell>{account.name || '—'}</TableCell>
                  <TableCell>{account.currency || '—'}</TableCell>
                  <TableCell>{account.timezone_name || '—'}</TableCell>
                  <TableCell className="text-right">
                    {account.isSelected ? (
                      <Badge className="bg-emerald-500/15 text-emerald-200 border border-emerald-500/30">Selecionada</Badge>
                    ) : (
                      <Button size="sm" variant="outline" onClick={() => onSelectAccount(account.id)} disabled={refreshing}>
                        Selecionar
                      </Button>
                    )}
                  </TableCell>
                </TableRow>
              ))}
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
        <Card className="glass-card border-white/10">
          <CardHeader>
            <CardDescription>Spend (7 dias)</CardDescription>
            <CardTitle>{formatCurrency(summary?.spend ?? 0, selectedAccount.currency || 'USD')}</CardTitle>
          </CardHeader>
        </Card>
        <Card className="glass-card border-white/10">
          <CardHeader>
            <CardDescription>Impressões</CardDescription>
            <CardTitle>{formatNumber(summary?.impressions ?? 0)}</CardTitle>
          </CardHeader>
        </Card>
        <Card className="glass-card border-white/10">
          <CardHeader>
            <CardDescription>Clicks</CardDescription>
            <CardTitle>{formatNumber(summary?.clicks ?? 0)}</CardTitle>
          </CardHeader>
        </Card>
        <Card className="glass-card border-white/10">
          <CardHeader>
            <CardDescription>Campanhas ativas</CardDescription>
            <CardTitle>{formatNumber(summary?.activeCampaigns ?? 0)}</CardTitle>
          </CardHeader>
        </Card>
      </div>

      <div className="grid gap-4 md:grid-cols-4">
        <Card className="glass-card border-white/10">
          <CardHeader>
            <CardDescription>Campanhas</CardDescription>
            <CardTitle>{campaignCount}</CardTitle>
          </CardHeader>
        </Card>
        <Card className="glass-card border-white/10">
          <CardHeader>
            <CardDescription>Conjuntos</CardDescription>
            <CardTitle>{adSetCount}</CardTitle>
          </CardHeader>
        </Card>
        <Card className="glass-card border-white/10">
          <CardHeader>
            <CardDescription>Anúncios</CardDescription>
            <CardTitle>{adCount}</CardTitle>
          </CardHeader>
        </Card>
        <Card className="glass-card border-white/10">
          <CardHeader>
            <CardDescription>Criativos</CardDescription>
            <CardTitle>{creativeCount}</CardTitle>
          </CardHeader>
        </Card>
      </div>

      <Card className="glass-card border-white/10">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <PresentationChart className="h-5 w-5 text-blue-300" />
            Tendência de gasto
          </CardTitle>
          <CardDescription>Últimos 7 dias da conta selecionada.</CardDescription>
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
  return (
    <>
      <MetaAdsPersistentError error={inventoryError} onRetry={onRetry} />
      <Card className="glass-card border-white/10">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <FadersHorizontal className="h-5 w-5 text-blue-300" />
            Campanhas
          </CardTitle>
          <CardDescription>
            Relação da conta selecionada com total de conjuntos e anúncios por campanha.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Campanha</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Objetivo</TableHead>
                <TableHead>Conjuntos</TableHead>
                <TableHead>Anúncios</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {inventory.campaigns.map((campaign) => (
                <TableRow key={campaign.id}>
                  <TableCell>
                    <div className="space-y-1">
                      <div className="font-medium text-white">{campaign.name || campaign.id}</div>
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

      <Card className="glass-card border-white/10">
        <CardHeader>
          <CardTitle>Anúncios</CardTitle>
          <CardDescription>
            Mapa direto de anúncios com campanha, conjunto e criativo associados.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Anúncio</TableHead>
                <TableHead>Campanha</TableHead>
                <TableHead>Conjunto</TableHead>
                <TableHead>Criativo</TableHead>
                <TableHead>Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {inventory.ads.map((ad: any) => (
                <TableRow key={ad.id}>
                  <TableCell>
                    <div className="space-y-1">
                      <div className="font-medium text-white">{ad.name || ad.id}</div>
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

      <Card className="glass-card border-white/10">
        <CardHeader>
          <CardTitle>Criativos</CardTitle>
          <CardDescription>
            Criativos deduplicados a partir dos anúncios retornados pela Meta para a conta selecionada.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {inventory.creatives.length === 0 ? (
            <div className="text-sm text-blue-100/70">Nenhum criativo encontrado.</div>
          ) : (
            inventory.creatives.map((creative: any) => (
              <div key={creative.id} className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
                {creative.thumbnailUrl ? (
                  <img
                    src={creative.thumbnailUrl}
                    alt={creative.name || creative.id}
                    className="mb-3 h-40 w-full rounded-xl object-cover"
                  />
                ) : null}
                <div className="space-y-1">
                  <div className="font-medium text-white">{creative.name || creative.id}</div>
                  <div className="font-mono text-xs text-blue-100/60">{creative.id}</div>
                  <div className="text-xs text-blue-100/70">Campanha: {creative.campaignId || '—'}</div>
                  <div className="text-xs text-blue-100/70">Anúncio: {creative.adName || creative.adId || '—'}</div>
                </div>
              </div>
            ))
          )}
        </CardContent>
      </Card>
    </>
  )
}
