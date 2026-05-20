import { useMemo, useState, type ReactElement, type ReactNode } from 'react'
import { format } from 'date-fns'
import { ptBR } from 'date-fns/locale'
import { LineChart, Line, XAxis, YAxis, Tooltip as RechartsTooltip, ResponsiveContainer } from 'recharts'
import { Badge } from '@/badge'
import { Button } from '@/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/card'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/dialog'
import { EntityDetailModal, type EntityDetailSection } from '@/EntityDetailModal'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/select'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/table'
import { Textarea } from '@/textarea'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/tooltip'
import type {
  MetaAdAccount,
  MetaAd,
  MetaAdSet,
  MetaAdsApiError,
  MetaAdsHealthState,
  MetaAdsInventory,
  MetaAdsReportResponse,
  MetaAdsSummaryResponse,
  MetaAdsTab,
  MetaAdsTrendPoint,
  MetaCampaignRow,
  MetaCreativeInventoryItem,
} from '@/metaAdsTypes'
import { describeMetaAdAccountStatus } from '@/metaAdsState'
import {
  ArrowClockwise,
  CaretDown,
  CaretRight,
  CheckCircle,
  FacebookLogo,
  FadersHorizontal,
  ChatCircleDots,
  Link,
  Lock,
  PauseCircle,
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

type MetaAdsEntityKind = 'campaign' | 'adset' | 'ad' | 'creative'
type MetaAdsInventorySortKey =
  | 'item'
  | 'rank'
  | 'status'
  | 'objective'
  | 'items'
  | 'spend'
  | 'conversations'
  | 'cpcv'
  | 'clicks'
  | 'reach'
  | 'impressions'
  | 'engagement'
  | 'igRedirect'
  | 'ctr'
  | 'cpc'
  | 'cpm'
  | 'cpp'
  | 'frequency'
  | 'cul'
type MetaAdsInventorySortDir = 'asc' | 'desc'

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

function formatPercent(value?: number | null) {
  if (value === null || value === undefined || Number.isNaN(Number(value))) return '—'
  return `${Number(value).toFixed(2)}%`
}

function MetaAdsHoverTooltip({
  content,
  children,
}: {
  content: ReactNode
  children: ReactElement
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>{children}</TooltipTrigger>
      <TooltipContent>{content}</TooltipContent>
    </Tooltip>
  )
}

function MetaAdsEntityGlyph({
  kind,
  className = 'h-4 w-4',
}: {
  kind: MetaAdsEntityKind
  className?: string
}) {
  switch (kind) {
    case 'campaign':
      return <Target className={className} />
    case 'adset':
      return <FadersHorizontal className={className} />
    case 'ad':
      return <PresentationChart className={className} />
    case 'creative':
      return <FacebookLogo className={className} />
    default:
      return <Target className={className} />
  }
}

function MetaAdsEntityLevelBadge({
  kind,
  label,
  toneClass,
}: {
  kind: MetaAdsEntityKind
  label: string
  toneClass: string
}) {
  return (
    <Badge
      className={`h-9 w-9 justify-center rounded-full px-0 ${toneClass}`}
      title={label}
      aria-label={label}
    >
      <MetaAdsEntityGlyph kind={kind} className="h-4 w-4" />
    </Badge>
  )
}

function MetaAdsEntityInlineBadge({
  kind,
  label,
  toneClass,
}: {
  kind: MetaAdsEntityKind
  label: string
  toneClass: string
}) {
  return (
    <MetaAdsHoverTooltip content={label}>
      <span
        className={`inline-flex h-7 w-7 items-center justify-center rounded-full border ${toneClass}`}
        aria-label={label}
      >
        <MetaAdsEntityGlyph kind={kind} className="h-3.5 w-3.5" />
      </span>
    </MetaAdsHoverTooltip>
  )
}

function MetaAdsTableTooltip({
  label,
  description,
  children,
}: {
  label: string
  description?: string
  children: ReactElement
}) {
  return (
    <MetaAdsHoverTooltip
      content={
        <div className="space-y-1">
          <div className="font-medium text-white">{label}</div>
          {description ? <div className="max-w-56 text-xs leading-5 text-slate-300">{description}</div> : null}
        </div>
      }
    >
      {children}
    </MetaAdsHoverTooltip>
  )
}

function statusTone(status?: string) {
  const normalized = String(status || '').toUpperCase()
  if (normalized === 'ACTIVE') return 'bg-emerald-500/15 text-emerald-200 border-emerald-500/30'
  if (normalized === 'PAUSED') return 'bg-amber-500/15 text-amber-200 border-amber-500/30'
  if (normalized === 'ARCHIVED') return 'bg-slate-500/15 text-slate-200 border-slate-500/30'
  return 'border-slate-700 bg-slate-900/70 text-slate-200'
}

function statusTooltip(status?: string) {
  const normalized = String(status || '').toUpperCase()
  if (normalized === 'ACTIVE') return 'ativa'
  if (normalized === 'PAUSED') return 'inativo'
  if (normalized === 'ARCHIVED') return 'arquivado'
  return normalized ? normalized.toLowerCase() : 'sem status'
}

function MetaAdsStatusBadge({ status }: { status?: string }) {
  const normalized = String(status || '').toUpperCase()
  const Icon = normalized === 'ACTIVE' ? CheckCircle : normalized === 'PAUSED' ? PauseCircle : WarningCircle
  return (
    <MetaAdsHoverTooltip content={statusTooltip(status)}>
      <Badge
        className={`h-10 min-w-10 justify-center rounded-full px-0 ${statusTone(status)}`}
        aria-label={statusTooltip(status)}
      >
        <Icon className="h-4 w-4" weight="fill" aria-hidden="true" />
      </Badge>
    </MetaAdsHoverTooltip>
  )
}

function MetaAdsInlineItemCounter({
  activeCount,
  inactiveCount,
  title,
}: {
  activeCount: number
  inactiveCount: number
  title: string
}) {
  return (
    <MetaAdsHoverTooltip content={`${title}: ${activeCount} ativos · ${inactiveCount} inativos`}>
      <div
        role="img"
        aria-label={`${title}: ${activeCount} ativos e ${inactiveCount} inativos`}
        className="inline-flex overflow-hidden rounded-full border border-slate-800/80 bg-slate-900/60 shadow-[inset_0_1px_0_rgba(148,163,184,0.08)]"
      >
        <span className="inline-flex min-w-7 items-center justify-center bg-emerald-500/20 px-2 py-1 text-[11px] font-semibold text-emerald-100">
          {activeCount}
        </span>
        <span className="inline-flex min-w-7 items-center justify-center bg-rose-500/20 px-2 py-1 text-[11px] font-semibold text-rose-100">
          {inactiveCount}
        </span>
      </div>
    </MetaAdsHoverTooltip>
  )
}

function describeObjective(objective?: string | null) {
  const normalized = String(objective || '').toUpperCase()
  if (normalized === 'LEADS' || normalized === 'LEAD_GENERATION') {
    return {
      title: normalized || 'Leads',
      description: 'Captação e qualificação de leads.',
      icon: Target,
      toneClass: 'border-sky-500/25 bg-sky-500/12 text-sky-100',
    }
  }
  if (normalized === 'MESSAGES' || normalized === 'ENGAGED_USERS') {
    return {
      title: normalized || 'Mensagens',
      description: 'Incentiva conversas e atendimentos iniciados.',
      icon: ChatCircleDots,
      toneClass: 'border-emerald-500/25 bg-emerald-500/12 text-emerald-100',
    }
  }
  if (normalized === 'LINK_CLICKS' || normalized === 'TRAFFIC' || normalized === 'OUTBOUND_CLICKS') {
    return {
      title: normalized || 'Cliques em link',
      description: 'Foco em tráfego e cliques em destinos externos.',
      icon: Link,
      toneClass: 'border-violet-500/25 bg-violet-500/12 text-violet-100',
    }
  }
  if (normalized === 'SALES' || normalized === 'CONVERSIONS') {
    return {
      title: normalized || 'Conversões',
      description: 'Otimização para conversões e resultado final.',
      icon: PresentationChart,
      toneClass: 'border-amber-500/25 bg-amber-500/12 text-amber-100',
    }
  }
  return {
    title: normalized || 'Sem objetivo',
    description: normalized ? 'Objetivo retornado pela Meta sem mapeamento visual específico.' : 'Sem objetivo informado pela Meta.',
    icon: WarningCircle,
    toneClass: 'border-slate-700 bg-slate-900/70 text-slate-200',
  }
}

function MetaAdsObjectiveBadge({ objective }: { objective?: string | null }) {
  const { title, description, icon: Icon, toneClass } = describeObjective(objective)
  return (
    <MetaAdsTableTooltip label={title} description={description}>
      <Badge
        className={`h-10 min-w-10 justify-center rounded-full px-0 ${toneClass}`}
        aria-label={`${title}: ${description}`}
      >
        <Icon className="h-4 w-4" weight="fill" aria-hidden="true" />
      </Badge>
    </MetaAdsTableTooltip>
  )
}

function formatDualMetric(primary?: number | null, secondary?: number | null, kind: 'number' | 'percent' | 'currency' = 'number') {
  const formatValue = (value?: number | null) => {
    if (value === null || value === undefined || Number.isNaN(Number(value))) return '—'
    if (kind === 'percent') return formatPercent(value)
    if (kind === 'currency') return formatCurrency(value)
    return formatNumber(value)
  }
  return `${formatValue(primary)} / ${formatValue(secondary)}`
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
  onNavigate?: (tab: MetaAdsTab) => void
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
          <Button variant="outline" onClick={() => onNavigate?.(health.ctaTab!)}>
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

  const previewUrl = detail.kind === 'creative' ? detail.payload.thumbnailUrl : undefined
  const hasValue = (value: unknown) => value !== undefined && value !== null && value !== ''
  const filterSections = (sections: EntityDetailSection[]) =>
    sections
      .map((section) => ({
        ...section,
        fields: section.fields.filter((field) => hasValue(field.value)),
      }))
      .filter((section) => section.fields.length > 0)

  let sections: EntityDetailSection[] = []
  if (detail.kind === 'campaign') {
    const payload = detail.payload
    sections = filterSections([
      {
        title: 'Identificação',
        fields: [
          { label: 'Nome', value: payload.name },
          { label: 'ID', value: payload.id },
          { label: 'Status', value: payload.effective_status || payload.status },
          { label: 'Objetivo', value: payload.objective },
        ],
      },
      {
        title: 'Estrutura',
        fields: [
          { label: 'Conjuntos totais', value: payload.totals?.adSets ?? payload.adSets?.length },
          { label: 'Anúncios totais', value: payload.totals?.ads },
        ],
      },
      {
        title: 'Orçamento',
        fields: [
          { label: 'Orçamento diário', value: payload.daily_budget },
          { label: 'Orçamento vitalício', value: payload.lifetime_budget },
        ],
      },
      {
        title: 'Janela operacional',
        fields: [
          { label: 'Início', value: payload.start_time },
          { label: 'Fim', value: payload.stop_time },
        ],
      },
    ])
  } else if (detail.kind === 'adset') {
    const payload = detail.payload
    sections = filterSections([
      {
        title: 'Identificação',
        fields: [
          { label: 'Nome', value: payload.name },
          { label: 'ID', value: payload.id },
          { label: 'Status', value: payload.effective_status || payload.status },
          { label: 'Campanha', value: payload.campaign_name || payload.campaign_id },
        ],
      },
      {
        title: 'Estrutura',
        fields: [{ label: 'Anúncios associados', value: payload.ads_count ?? payload.ads?.length }],
      },
      {
        title: 'Otimização e orçamento',
        fields: [
          { label: 'Meta de otimização', value: payload.optimization_goal },
          { label: 'Estratégia de lance', value: payload.bid_strategy },
          { label: 'Orçamento diário', value: payload.daily_budget },
          { label: 'Orçamento vitalício', value: payload.lifetime_budget },
        ],
      },
      {
        title: 'Janela operacional',
        fields: [
          { label: 'Início', value: payload.start_time },
          { label: 'Fim', value: payload.end_time },
        ],
      },
    ])
  } else if (detail.kind === 'ad') {
    const payload = detail.payload
    sections = filterSections([
      {
        title: 'Identificação',
        fields: [
          { label: 'Nome', value: payload.name },
          { label: 'ID', value: payload.id },
          { label: 'Status', value: payload.effective_status || payload.status },
        ],
      },
      {
        title: 'Relacionamentos',
        fields: [
          { label: 'Campanha', value: payload.campaign_name || payload.campaign_id },
          { label: 'Conjunto de anúncios', value: payload.adset_name || payload.adset_id },
          { label: 'Criativo', value: payload.creative?.name || payload.creative?.id },
          { label: 'Story ID efetivo', value: payload.creative?.effective_object_story_id },
        ],
      },
    ])
  } else {
    const payload = detail.payload
    sections = filterSections([
      {
        title: 'Identificação',
        fields: [
          { label: 'Nome', value: payload.name },
          { label: 'ID', value: payload.id },
          { label: 'Story ID efetivo', value: payload.effectiveObjectStoryId },
        ],
      },
      {
        title: 'Relacionamentos',
        fields: [
          { label: 'Campanha', value: payload.campaignName || payload.campaignId },
          { label: 'Conjunto de anúncios', value: payload.adSetName || payload.adSetId },
          { label: 'Anúncio', value: payload.adName || payload.adId },
        ],
      },
    ])
  }

  return (
    <EntityDetailModal
      open={open}
      onOpenChange={onOpenChange}
      title={detail.title}
      description={
        detail.kind === 'campaign'
          ? 'Configuração consolidada da campanha selecionada.'
          : detail.kind === 'adset'
            ? 'Configuração consolidada do conjunto de anúncios selecionado.'
            : detail.kind === 'ad'
              ? 'Configuração consolidada do anúncio selecionado.'
              : 'Configuração consolidada do criativo selecionado.'
      }
      previewUrl={previewUrl}
      sections={sections}
    />
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
                <TableHead className="text-center">Status</TableHead>
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
  report,
  overviewError,
  onRetry,
}: {
  selectedAccount: MetaAdAccount
  summary: MetaAdsSummaryResponse | null
  trend: MetaAdsTrendPoint[]
  report: MetaAdsReportResponse | null
  overviewError: MetaAdsApiError | null
  onRetry?: () => void
}) {
  const reportSummary = report?.summary || null
  const primarySummary = reportSummary || summary
  const ctr =
    Number(primarySummary?.impressions || 0) > 0
      ? (Number(primarySummary?.clicks || 0) / Number(primarySummary?.impressions || 0)) * 100
      : 0
  const cpc =
    Number(primarySummary?.clicks || 0) > 0
      ? Number(primarySummary?.spend || 0) / Number(primarySummary?.clicks || 0)
      : 0
  const cpm =
    Number(primarySummary?.impressions || 0) > 0
      ? (Number(primarySummary?.spend || 0) / Number(primarySummary?.impressions || 0)) * 1000
      : 0

  return (
    <>
      <MetaAdsPersistentError error={overviewError} onRetry={onRetry} />
      <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-4">
        <Card className={panelClass}>
          <CardHeader className="space-y-1 pb-4">
            <CardDescription className="text-slate-400">Spend</CardDescription>
            <CardTitle>{formatCurrency(primarySummary?.spend ?? 0, selectedAccount.currency || 'USD')}</CardTitle>
          </CardHeader>
        </Card>
        <Card className={panelClass}>
          <CardHeader className="space-y-1 pb-4">
            <CardDescription className="text-slate-400">Impressões</CardDescription>
            <CardTitle>{formatNumber(primarySummary?.impressions ?? 0)}</CardTitle>
          </CardHeader>
        </Card>
        <Card className={panelClass}>
          <CardHeader className="space-y-1 pb-4">
            <CardDescription className="text-slate-400">Clicks</CardDescription>
            <CardTitle>{formatNumber(primarySummary?.clicks ?? 0)}</CardTitle>
          </CardHeader>
        </Card>
        <Card className={panelClass}>
          <CardHeader className="space-y-1 pb-4">
            <CardDescription className="text-slate-400">Conversas iniciadas</CardDescription>
            <CardTitle>{formatNumber(reportSummary?.conversations ?? 0)}</CardTitle>
          </CardHeader>
        </Card>
        <Card className={panelClass}>
          <CardHeader className="space-y-1 pb-4">
            <CardDescription className="text-slate-400">Custo por conversa</CardDescription>
            <CardTitle>{formatCurrency(reportSummary?.avgCostConversation ?? 0, selectedAccount.currency || 'USD')}</CardTitle>
          </CardHeader>
        </Card>
        <Card className={panelClass}>
          <CardHeader className="space-y-1 pb-4">
            <CardDescription className="text-slate-400">CTR</CardDescription>
            <CardTitle>{formatPercent(ctr)}</CardTitle>
          </CardHeader>
        </Card>
        <Card className={panelClass}>
          <CardHeader className="space-y-1 pb-4">
            <CardDescription className="text-slate-400">CPC médio</CardDescription>
            <CardTitle>{formatCurrency(cpc, selectedAccount.currency || 'USD')}</CardTitle>
          </CardHeader>
        </Card>
        <Card className={panelClass}>
          <CardHeader className="space-y-1 pb-4">
            <CardDescription className="text-slate-400">CPM</CardDescription>
            <CardTitle>{formatCurrency(cpm, selectedAccount.currency || 'USD')}</CardTitle>
          </CardHeader>
        </Card>
      </div>

      <Card className={panelClass}>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <PresentationChart className="h-5 w-5 text-sky-300" />
            Tendência de gasto
          </CardTitle>
          <CardDescription className="text-slate-300">Histórico de investimento da conta selecionada.</CardDescription>
        </CardHeader>
        <CardContent className="h-72">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={trend}>
              <XAxis dataKey="day" />
              <YAxis />
              <RechartsTooltip />
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
  report,
  inventoryError,
  onRetry,
}: {
  inventory: MetaAdsInventory
  report: MetaAdsReportResponse | null
  inventoryError: MetaAdsApiError | null
  onRetry?: () => void
}) {
  const [detail, setDetail] = useState<MetaAdsEntityDetail | null>(null)
  const [collapsedCampaignIds, setCollapsedCampaignIds] = useState<string[]>([])
  const [collapsedAdSetIds, setCollapsedAdSetIds] = useState<string[]>([])
  const [sortKey, setSortKey] = useState<MetaAdsInventorySortKey>('rank')
  const [sortDir, setSortDir] = useState<MetaAdsInventorySortDir>('asc')

  const campaignOrderMap = useMemo(
    () => new Map(inventory.campaigns.map((campaign, index) => [campaign.id, index])),
    [inventory.campaigns],
  )
  const adSetOrderMap = useMemo(
    () => new Map(inventory.adSets.map((adSet, index) => [adSet.id, index])),
    [inventory.adSets],
  )
  const adOrderMap = useMemo(
    () => new Map(inventory.ads.map((ad, index) => [ad.id, index])),
    [inventory.ads],
  )
  const campaignRankMap = useMemo(() => {
    const rankedCampaignIds = [...(report?.campaigns || [])]
      .sort((left, right) => {
        if (right.spend !== left.spend) return right.spend - left.spend
        if (right.conversations !== left.conversations) return right.conversations - left.conversations
        if (right.clicks !== left.clicks) return right.clicks - left.clicks
        if (right.impressions !== left.impressions) return right.impressions - left.impressions
        return (left.campaignName || left.campaignId).localeCompare(right.campaignName || right.campaignId, 'pt-BR')
      })
      .map((campaign) => campaign.campaignId)
    const seen = new Set(rankedCampaignIds)
    const fallbackIds = inventory.campaigns
      .filter((campaign) => !seen.has(campaign.id))
      .sort((left, right) => (left.name || left.id).localeCompare(right.name || right.id, 'pt-BR'))
      .map((campaign) => campaign.id)
    return new Map([...rankedCampaignIds, ...fallbackIds].map((campaignId, index) => [campaignId, index + 1]))
  }, [inventory.campaigns, report?.campaigns])
  const adSetRankMap = useMemo(() => {
    const rankedAdSetIds = [...(report?.adSets || [])]
      .sort((left, right) => {
        if (right.spend !== left.spend) return right.spend - left.spend
        if (right.conversations !== left.conversations) return right.conversations - left.conversations
        if (right.clicks !== left.clicks) return right.clicks - left.clicks
        if (right.impressions !== left.impressions) return right.impressions - left.impressions
        return (left.adSetName || left.adSetId).localeCompare(right.adSetName || right.adSetId, 'pt-BR')
      })
      .map((adSet) => adSet.adSetId)
    const seen = new Set(rankedAdSetIds)
    const fallbackIds = inventory.adSets
      .filter((adSet) => !seen.has(adSet.id))
      .sort((left, right) => {
        const campaignRankDiff = (campaignRankMap.get(left.campaign_id || '') || 999) - (campaignRankMap.get(right.campaign_id || '') || 999)
        if (campaignRankDiff) return campaignRankDiff
        return (left.name || left.id).localeCompare(right.name || right.id, 'pt-BR')
      })
      .map((adSet) => adSet.id)
    return new Map([...rankedAdSetIds, ...fallbackIds].map((adSetId, index) => [adSetId, index + 1]))
  }, [campaignRankMap, inventory.adSets, report?.adSets])
  const adRankMap = useMemo(() => {
    const rankedAdIds = [...(report?.ads || [])]
      .sort((left, right) => {
        if (right.spend !== left.spend) return right.spend - left.spend
        if (right.conversations !== left.conversations) return right.conversations - left.conversations
        if (right.clicks !== left.clicks) return right.clicks - left.clicks
        if (right.impressions !== left.impressions) return right.impressions - left.impressions
        return (left.adName || left.adId).localeCompare(right.adName || right.adId, 'pt-BR')
      })
      .map((ad) => ad.adId)
    const seen = new Set(rankedAdIds)
    const fallbackIds = inventory.ads
      .filter((ad) => !seen.has(ad.id))
      .sort((left, right) => {
        const campaignRankDiff = (campaignRankMap.get(left.campaign_id || '') || 999) - (campaignRankMap.get(right.campaign_id || '') || 999)
        if (campaignRankDiff) return campaignRankDiff
        const adSetRankDiff = (adSetRankMap.get(left.adset_id || '') || 999) - (adSetRankMap.get(right.adset_id || '') || 999)
        if (adSetRankDiff) return adSetRankDiff
        return (left.name || left.id).localeCompare(right.name || right.id, 'pt-BR')
      })
      .map((ad) => ad.id)
    return new Map([...rankedAdIds, ...fallbackIds].map((adId, index) => [adId, index + 1]))
  }, [adSetRankMap, campaignRankMap, inventory.ads, report?.ads])
  const creativeRankMap = useMemo(() => {
    const sorted = [...inventory.creatives].sort((left, right) => {
      const adRankDiff = (adRankMap.get(left.adId || '') || 999) - (adRankMap.get(right.adId || '') || 999)
      if (adRankDiff) return adRankDiff
      const campaignRankDiff = (campaignRankMap.get(left.campaignId || '') || 999) - (campaignRankMap.get(right.campaignId || '') || 999)
      if (campaignRankDiff) return campaignRankDiff
      return (left.name || left.id).localeCompare(right.name || right.id, 'pt-BR')
    })
    return new Map(sorted.map((item, index) => [item.id, index + 1]))
  }, [adRankMap, campaignRankMap, inventory.creatives])
  const campaignMetricsMap = useMemo(
    () => new Map((report?.campaigns || []).map((campaign) => [campaign.campaignId, campaign])),
    [report?.campaigns],
  )
  const adSetMetricsMap = useMemo(
    () => new Map((report?.adSets || []).map((adSet) => [adSet.adSetId, adSet])),
    [report?.adSets],
  )
  const adMetricsMap = useMemo(
    () => new Map((report?.ads || []).map((ad) => [ad.adId, ad])),
    [report?.ads],
  )

  const filteredCampaigns = useMemo(() => {
    return inventory.campaigns
  }, [inventory.campaigns])

  const filteredAdSets = useMemo(() => {
    return inventory.adSets
  }, [inventory.adSets])

  const filteredAds = useMemo(() => {
    return inventory.ads
  }, [inventory.ads])

  const filteredCreatives = useMemo(() => {
    return inventory.creatives
  }, [inventory.creatives])

  const filteredAdSetsByCampaign = useMemo(() => {
    const map = new Map<string, MetaAdSet[]>()
    filteredAdSets.forEach((adSet) => {
      const campaignId = adSet.campaign_id || ''
      if (!map.has(campaignId)) map.set(campaignId, [])
      map.get(campaignId)!.push(adSet)
    })
    return map
  }, [filteredAdSets])

  const filteredAdsByAdSet = useMemo(() => {
    const map = new Map<string, MetaAd[]>()
    filteredAds.forEach((ad) => {
      const adSetId = ad.adset_id || ''
      if (!map.has(adSetId)) map.set(adSetId, [])
      map.get(adSetId)!.push(ad)
    })
    return map
  }, [filteredAds])

  const filteredAdsWithoutAdSetByCampaign = useMemo(() => {
    const map = new Map<string, MetaAd[]>()
    filteredAds
      .filter((ad) => !ad.adset_id)
      .forEach((ad) => {
        const campaignId = ad.campaign_id || ''
        if (!map.has(campaignId)) map.set(campaignId, [])
        map.get(campaignId)!.push(ad)
      })
    return map
  }, [filteredAds])
  const filteredCreativesByAdSet = useMemo(() => {
    const map = new Map<string, MetaCreativeInventoryItem[]>()
    filteredCreatives.forEach((creative) => {
      const adSetId = creative.adSetId || ''
      if (!map.has(adSetId)) map.set(adSetId, [])
      map.get(adSetId)!.push(creative)
    })
    return map
  }, [filteredCreatives])
  const filteredCreativesByAd = useMemo(() => {
    const map = new Map<string, MetaCreativeInventoryItem[]>()
    filteredCreatives.forEach((creative) => {
      const adId = creative.adId || ''
      if (!map.has(adId)) map.set(adId, [])
      map.get(adId)!.push(creative)
    })
    return map
  }, [filteredCreatives])

  const compareText = (left: string, right: string) => left.localeCompare(right, 'pt-BR', { sensitivity: 'base' })
  const compareMaybeNumber = (left?: number | null, right?: number | null) => {
    const leftMissing = left === undefined || left === null || Number.isNaN(Number(left))
    const rightMissing = right === undefined || right === null || Number.isNaN(Number(right))
    if (leftMissing && rightMissing) return 0
    if (leftMissing) return 1
    if (rightMissing) return -1
    return Number(left) - Number(right)
  }
  const statusSortRank = (status?: string) => {
    const normalized = String(status || '').toUpperCase()
    if (normalized === 'ACTIVE') return 0
    if (normalized === 'PAUSED') return 1
    if (normalized === 'ARCHIVED') return 2
    return 3
  }
  const defaultSortDir = (_key: MetaAdsInventorySortKey): MetaAdsInventorySortDir => 'asc'
  const handleSortChange = (key: MetaAdsInventorySortKey) => {
    if (sortKey === key) {
      setSortDir((current) => (current === 'asc' ? 'desc' : 'asc'))
      return
    }
    setSortKey(key)
    setSortDir(defaultSortDir(key))
  }
  const sortMultiplier = sortDir === 'asc' ? 1 : -1

  const compareCampaigns = (left: MetaCampaignRow, right: MetaCampaignRow) => {
    const leftMetrics = campaignMetricsMap.get(left.id)
    const rightMetrics = campaignMetricsMap.get(right.id)
    const leftAdSets = filteredAdSetsByCampaign.get(left.id) || []
    const rightAdSets = filteredAdSetsByCampaign.get(right.id) || []
    const leftActive = leftAdSets.filter((adSet) => String(adSet.effective_status || adSet.status || '').toUpperCase() === 'ACTIVE').length
    const rightActive = rightAdSets.filter((adSet) => String(adSet.effective_status || adSet.status || '').toUpperCase() === 'ACTIVE').length
    let compare = 0
    switch (sortKey) {
      case 'item':
        compare = compareText(left.name || left.id, right.name || right.id)
        break
      case 'rank':
        compare = compareMaybeNumber(campaignRankMap.get(left.id), campaignRankMap.get(right.id))
        break
      case 'status':
        compare = compareMaybeNumber(statusSortRank(left.effective_status || left.status), statusSortRank(right.effective_status || right.status))
        break
      case 'objective':
        compare = compareText(left.objective || '', right.objective || '')
        break
      case 'items':
        compare = compareMaybeNumber(leftActive, rightActive) || compareMaybeNumber(leftAdSets.length, rightAdSets.length)
        break
      case 'spend':
        compare = compareMaybeNumber(leftMetrics?.spend, rightMetrics?.spend)
        break
      case 'conversations':
        compare = compareMaybeNumber(leftMetrics?.conversations, rightMetrics?.conversations)
        break
      case 'cpcv':
        compare = compareMaybeNumber(
          leftMetrics && leftMetrics.conversations > 0 ? leftMetrics.spend / leftMetrics.conversations : null,
          rightMetrics && rightMetrics.conversations > 0 ? rightMetrics.spend / rightMetrics.conversations : null,
        )
        break
      case 'clicks':
        compare = compareMaybeNumber(leftMetrics?.clicks, rightMetrics?.clicks)
        break
      case 'reach':
        compare = compareMaybeNumber(leftMetrics?.reach, rightMetrics?.reach)
        break
      case 'impressions':
        compare = compareMaybeNumber(leftMetrics?.impressions, rightMetrics?.impressions)
        break
      case 'ctr':
        compare = compareMaybeNumber(leftMetrics?.ctr, rightMetrics?.ctr)
        break
      case 'cpc':
        compare = compareMaybeNumber(leftMetrics?.cpc, rightMetrics?.cpc)
        break
      case 'cpm':
        compare = compareMaybeNumber(leftMetrics?.cpm, rightMetrics?.cpm)
        break
      case 'cpp':
        compare = compareMaybeNumber(leftMetrics?.cpp, rightMetrics?.cpp)
        break
      case 'frequency':
        compare = compareMaybeNumber(leftMetrics?.frequency, rightMetrics?.frequency)
        break
      default:
        compare = 0
        break
    }
    if (compare !== 0) return compare * sortMultiplier
    return ((campaignOrderMap.get(left.id) ?? 0) - (campaignOrderMap.get(right.id) ?? 0))
  }

  const compareAdSets = (left: MetaAdSet, right: MetaAdSet) => {
    const leftMetrics = adSetMetricsMap.get(left.id)
    const rightMetrics = adSetMetricsMap.get(right.id)
    const leftAds = filteredAdsByAdSet.get(left.id) || []
    const rightAds = filteredAdsByAdSet.get(right.id) || []
    const leftActive = leftAds.filter((ad) => String(ad.effective_status || ad.status || '').toUpperCase() === 'ACTIVE').length
    const rightActive = rightAds.filter((ad) => String(ad.effective_status || ad.status || '').toUpperCase() === 'ACTIVE').length
    let compare = 0
    switch (sortKey) {
      case 'item':
        compare = compareText(left.name || left.id, right.name || right.id)
        break
      case 'rank':
        compare = compareMaybeNumber(adSetRankMap.get(left.id), adSetRankMap.get(right.id))
        break
      case 'status':
        compare = compareMaybeNumber(statusSortRank(left.effective_status || left.status), statusSortRank(right.effective_status || right.status))
        break
      case 'objective':
        compare = compareText(left.optimization_goal || '', right.optimization_goal || '')
        break
      case 'items':
        compare = compareMaybeNumber(leftActive, rightActive) || compareMaybeNumber(leftAds.length, rightAds.length)
        break
      case 'spend':
        compare = compareMaybeNumber(leftMetrics?.spend, rightMetrics?.spend)
        break
      case 'conversations':
        compare = compareMaybeNumber(leftMetrics?.conversations, rightMetrics?.conversations)
        break
      case 'cpcv':
        compare = compareMaybeNumber(
          leftMetrics && leftMetrics.conversations > 0 ? leftMetrics.spend / leftMetrics.conversations : null,
          rightMetrics && rightMetrics.conversations > 0 ? rightMetrics.spend / rightMetrics.conversations : null,
        )
        break
      case 'clicks':
        compare = compareMaybeNumber(leftMetrics?.clicks, rightMetrics?.clicks)
        break
      case 'reach':
        compare = compareMaybeNumber(leftMetrics?.reach, rightMetrics?.reach)
        break
      case 'impressions':
        compare = compareMaybeNumber(leftMetrics?.impressions, rightMetrics?.impressions)
        break
      case 'ctr':
        compare = compareMaybeNumber(leftMetrics?.ctr, rightMetrics?.ctr)
        break
      case 'cpc':
        compare = compareMaybeNumber(leftMetrics?.cpc, rightMetrics?.cpc)
        break
      case 'cpm':
        compare = compareMaybeNumber(leftMetrics?.cpm, rightMetrics?.cpm)
        break
      case 'cpp':
        compare = compareMaybeNumber(leftMetrics?.cpp, rightMetrics?.cpp)
        break
      case 'frequency':
        compare = compareMaybeNumber(leftMetrics?.frequency, rightMetrics?.frequency)
        break
      default:
        compare = 0
        break
    }
    if (compare !== 0) return compare * sortMultiplier
    return ((adSetOrderMap.get(left.id) ?? 0) - (adSetOrderMap.get(right.id) ?? 0))
  }

  const compareAds = (left: MetaAd, right: MetaAd) => {
    const leftMetrics = adMetricsMap.get(left.id)
    const rightMetrics = adMetricsMap.get(right.id)
    const leftCreatives = filteredCreativesByAd.get(left.id) || []
    const rightCreatives = filteredCreativesByAd.get(right.id) || []
    const leftActive = String(left.effective_status || left.status || '').toUpperCase() === 'ACTIVE' ? leftCreatives.length : 0
    const rightActive = String(right.effective_status || right.status || '').toUpperCase() === 'ACTIVE' ? rightCreatives.length : 0
    const leftInactive = String(left.effective_status || left.status || '').toUpperCase() === 'ACTIVE' ? 0 : leftCreatives.length
    const rightInactive = String(right.effective_status || right.status || '').toUpperCase() === 'ACTIVE' ? 0 : rightCreatives.length
    let compare = 0
    switch (sortKey) {
      case 'item':
        compare = compareText(left.name || left.id, right.name || right.id)
        break
      case 'rank':
        compare = compareMaybeNumber(adRankMap.get(left.id), adRankMap.get(right.id))
        break
      case 'status':
        compare = compareMaybeNumber(statusSortRank(left.effective_status || left.status), statusSortRank(right.effective_status || right.status))
        break
      case 'items':
        compare = compareMaybeNumber(leftActive, rightActive) || compareMaybeNumber(leftInactive, rightInactive)
        break
      case 'spend':
        compare = compareMaybeNumber(leftMetrics?.spend, rightMetrics?.spend)
        break
      case 'conversations':
        compare = compareMaybeNumber(leftMetrics?.conversations, rightMetrics?.conversations)
        break
      case 'cpcv':
        compare = compareMaybeNumber(
          leftMetrics && leftMetrics.conversations > 0 ? leftMetrics.spend / leftMetrics.conversations : null,
          rightMetrics && rightMetrics.conversations > 0 ? rightMetrics.spend / rightMetrics.conversations : null,
        )
        break
      case 'clicks':
        compare = compareMaybeNumber(leftMetrics?.clicks, rightMetrics?.clicks)
        break
      case 'reach':
        compare = compareMaybeNumber(leftMetrics?.reach, rightMetrics?.reach)
        break
      case 'impressions':
        compare = compareMaybeNumber(leftMetrics?.impressions, rightMetrics?.impressions)
        break
      case 'ctr':
        compare = compareMaybeNumber(leftMetrics?.ctr, rightMetrics?.ctr)
        break
      case 'cpc':
        compare = compareMaybeNumber(leftMetrics?.cpc, rightMetrics?.cpc)
        break
      case 'cpm':
        compare = compareMaybeNumber(leftMetrics?.cpm, rightMetrics?.cpm)
        break
      case 'cpp':
        compare = compareMaybeNumber(leftMetrics?.cpp, rightMetrics?.cpp)
        break
      case 'frequency':
        compare = compareMaybeNumber(leftMetrics?.frequency, rightMetrics?.frequency)
        break
      default:
        compare = 0
        break
    }
    if (compare !== 0) return compare * sortMultiplier
    return ((adOrderMap.get(left.id) ?? 0) - (adOrderMap.get(right.id) ?? 0))
  }

  const rowClass = () => 'border-slate-800/80 transition hover:bg-slate-900/45'

  const itemButtonClass = 'text-left transition text-white hover:text-sky-200'
  const describeCount = (filteredCount: number, totalCount: number, singular: string, plural: string) =>
    filteredCount === totalCount ? `${totalCount} ${totalCount === 1 ? singular : plural}` : `${filteredCount} de ${totalCount}`
  const toggleCampaign = (campaignId: string) => {
    setCollapsedCampaignIds((current) =>
      current.includes(campaignId) ? current.filter((id) => id !== campaignId) : [...current, campaignId],
    )
  }

  const toggleAdSet = (adSetId: string) => {
    setCollapsedAdSetIds((current) =>
      current.includes(adSetId) ? current.filter((id) => id !== adSetId) : [...current, adSetId],
    )
  }

  type InventoryTreeRow =
    | { key: string; level: 'campaign'; campaign: MetaCampaignRow }
    | { key: string; level: 'adset'; adSet: MetaAdSet }
    | { key: string; level: 'ad'; ad: MetaAd }

  const inventoryTreeRows = useMemo<InventoryTreeRow[]>(() => {
    const rows: InventoryTreeRow[] = [];

    [...filteredCampaigns].sort(compareCampaigns).forEach((campaign) => {
      rows.push({ key: `campaign:${campaign.id}`, level: 'campaign', campaign })
      const campaignExpanded = !collapsedCampaignIds.includes(campaign.id)

      if (!campaignExpanded) return

      const campaignAdSets = [...(filteredAdSetsByCampaign.get(campaign.id) || [])].sort(compareAdSets)
      campaignAdSets.forEach((adSet) => {
        rows.push({ key: `adset:${adSet.id}`, level: 'adset', adSet })
        const adSetExpanded = !collapsedAdSetIds.includes(adSet.id)
        if (!adSetExpanded) return
        const adSetAds = [...(filteredAdsByAdSet.get(adSet.id) || [])].sort(compareAds)
        adSetAds.forEach((ad) => {
          rows.push({ key: `ad:${ad.id}`, level: 'ad', ad })
        })
      })

      const directAds = [...(filteredAdsWithoutAdSetByCampaign.get(campaign.id) || [])].sort(compareAds)
      directAds.forEach((ad) => {
        rows.push({ key: `ad:${ad.id}`, level: 'ad', ad })
      })
    })

    return rows
  }, [
    adOrderMap,
    adRankMap,
    adSetOrderMap,
    adSetRankMap,
    campaignOrderMap,
    campaignRankMap,
    collapsedAdSetIds,
    collapsedCampaignIds,
    compareAdSets,
    compareAds,
    compareCampaigns,
    filteredAds,
    filteredAdsByAdSet,
    filteredAdsWithoutAdSetByCampaign,
    filteredAdSets,
    filteredAdSetsByCampaign,
    filteredCampaigns,
  ])

  const renderUnavailableMetricCell = () => (
    <MetaAdsTableTooltip
      label="Métrica indisponível"
      description="A fonte consolidada atual ainda não entrega esse valor neste nível da hierarquia."
    >
      <span className="text-slate-500">—</span>
    </MetaAdsTableTooltip>
  )

  const renderSortHead = (key: MetaAdsInventorySortKey, label: string) => {
    const isActive = sortKey === key
    return (
      <button
        type="button"
        className={`inline-flex items-center justify-center gap-2 rounded-sm px-0.5 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-300/40 ${
          isActive ? 'text-white' : 'text-blue-100/80'
        } hover:underline`}
        onClick={() => handleSortChange(key)}
        aria-label={`Ordenar ${label}`}
        title={`Ordenar ${label}`}
      >
        <span>{label}</span>
        <span className={`inline-flex items-center justify-center ${isActive ? 'text-white' : 'text-blue-100/30'}`} aria-hidden>
          {isActive && sortDir === 'asc' ? (
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden>
              <path d="M6 15l6-6 6 6" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          ) : (
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden>
              <path d="M6 9l6 6 6-6" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          )}
        </span>
      </button>
    )
  }

  return (
    <>
      <MetaAdsPersistentError error={inventoryError} onRetry={onRetry} />
      <MetaAdsEntityDetailDialog detail={detail} open={Boolean(detail)} onOpenChange={(open) => !open && setDetail(null)} />
      <Card className={panelClass}>
        <CardHeader>
          <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
            <div>
              <CardTitle className="flex items-center gap-2">
                <FadersHorizontal className="h-5 w-5 text-sky-300" />
                Estrutura operacional
              </CardTitle>
              <CardDescription className="text-slate-300">
                Árvore única de campanha, conjunto de anúncios e anúncio. Use a seta à esquerda para expandir ou compactar a hierarquia sem perder as colunas operacionais.
              </CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow className="border-slate-800">
                <TableHead>{renderSortHead('item', 'Item')}</TableHead>
                <TableHead className="text-center">{renderSortHead('rank', 'Rank')}</TableHead>
                <TableHead className="text-center">{renderSortHead('status', 'Status')}</TableHead>
                <TableHead className="text-center">{renderSortHead('objective', 'Objetivo')}</TableHead>
                <TableHead className="text-center">{renderSortHead('items', 'Itens')}</TableHead>
                <TableHead className="text-center">{renderSortHead('spend', 'Invest.')}</TableHead>
                <TableHead className="text-center">{renderSortHead('conversations', 'Conversa')}</TableHead>
                <TableHead className="text-center">{renderSortHead('cpcv', 'CPCv')}</TableHead>
                <TableHead className="text-center">{renderSortHead('clicks', 'Clique')}</TableHead>
                <TableHead className="text-center">{renderSortHead('reach', 'Alcance')}</TableHead>
                <TableHead className="text-center">{renderSortHead('impressions', 'Impressão')}</TableHead>
                <TableHead className="text-center">{renderSortHead('engagement', 'Engaj.')}</TableHead>
                <TableHead className="text-center">{renderSortHead('igRedirect', 'Redir. IG')}</TableHead>
                <TableHead className="text-center">{renderSortHead('ctr', 'CTR/CTRL')}</TableHead>
                <TableHead className="text-center">{renderSortHead('cpc', 'CPC/CPCL')}</TableHead>
                <TableHead className="text-center">{renderSortHead('cpm', 'CPM')}</TableHead>
                <TableHead className="text-center">{renderSortHead('cpp', 'CPP')}</TableHead>
                <TableHead className="text-center">{renderSortHead('frequency', 'Frequência')}</TableHead>
                <TableHead className="text-center">{renderSortHead('cul', 'CU/CUL')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {inventoryTreeRows.map((row) => {
                if (row.level === 'campaign') {
                  const campaign = row.campaign
                  const isExpanded = !collapsedCampaignIds.includes(campaign.id)
                  const campaignMetrics = campaignMetricsMap.get(campaign.id)
                  const campaignAdSets = filteredAdSetsByCampaign.get(campaign.id) || []
                  const campaignAdSetActiveCount = campaignAdSets.filter((adSet) => String(adSet.effective_status || adSet.status || '').toUpperCase() === 'ACTIVE').length
                  const campaignCostPerConversation =
                    campaignMetrics && campaignMetrics.conversations > 0
                      ? campaignMetrics.spend / campaignMetrics.conversations
                      : null
                  return (
                    <TableRow key={row.key} className={rowClass()}>
                      <TableCell>
                        <div className="space-y-1">
                          <div className="flex items-center gap-2">
                            <button
                              type="button"
                              onClick={() => toggleCampaign(campaign.id)}
                              aria-label={isExpanded ? 'Compactar campanha' : 'Expandir campanha'}
                              className="inline-flex h-7 w-7 items-center justify-center rounded-full border border-slate-700 bg-slate-900/70 text-slate-200 transition hover:border-sky-500/40 hover:text-sky-100"
                            >
                              {isExpanded ? <CaretDown className="h-3.5 w-3.5" /> : <CaretRight className="h-3.5 w-3.5" />}
                            </button>
                            <MetaAdsEntityInlineBadge
                              kind="campaign"
                              label="Campanha"
                              toneClass="border-sky-500/20 bg-sky-500/10 text-sky-100"
                            />
                            <button type="button" className={itemButtonClass} onClick={() => setDetail({ kind: 'campaign', title: campaign.name || campaign.id, payload: campaign })}>
                              {campaign.name || campaign.id}
                            </button>
                          </div>
                          <div className="pl-9 font-mono text-xs text-blue-100/60">{campaign.id}</div>
                        </div>
                      </TableCell>
                      <TableCell className="text-center">
                        <Badge className="border border-slate-700 bg-slate-900/70 text-slate-100">#{campaignRankMap.get(campaign.id) || '—'}</Badge>
                      </TableCell>
                      <TableCell className="text-center">
                        <div className="flex justify-center">
                          <MetaAdsStatusBadge status={campaign.effective_status || campaign.status} />
                        </div>
                      </TableCell>
                      <TableCell className="text-center">
                        <div className="flex justify-center">
                          <MetaAdsObjectiveBadge objective={campaign.objective} />
                        </div>
                      </TableCell>
                      <TableCell className="text-center">
                        <div className="flex justify-center">
                          <MetaAdsInlineItemCounter
                            activeCount={campaignAdSetActiveCount}
                            inactiveCount={campaignAdSets.length - campaignAdSetActiveCount}
                            title="Conjuntos da campanha"
                          />
                        </div>
                      </TableCell>
                      <TableCell className="text-center">{campaignMetrics ? formatCurrency(campaignMetrics.spend) : renderUnavailableMetricCell()}</TableCell>
                      <TableCell className="text-center">{campaignMetrics ? formatNumber(campaignMetrics.conversations) : renderUnavailableMetricCell()}</TableCell>
                      <TableCell className="text-center">{campaignCostPerConversation !== null ? formatCurrency(campaignCostPerConversation) : renderUnavailableMetricCell()}</TableCell>
                      <TableCell className="text-center">{campaignMetrics ? formatNumber(campaignMetrics.clicks) : renderUnavailableMetricCell()}</TableCell>
                      <TableCell className="text-center">{campaignMetrics?.reach ? formatNumber(campaignMetrics.reach) : renderUnavailableMetricCell()}</TableCell>
                      <TableCell className="text-center">{campaignMetrics ? formatNumber(campaignMetrics.impressions) : renderUnavailableMetricCell()}</TableCell>
                      <TableCell className="text-center">{renderUnavailableMetricCell()}</TableCell>
                      <TableCell className="text-center">{renderUnavailableMetricCell()}</TableCell>
                      <TableCell className="text-center">{campaignMetrics ? formatDualMetric(campaignMetrics.ctr, campaignMetrics.linkCtr, 'percent') : renderUnavailableMetricCell()}</TableCell>
                      <TableCell className="text-center">{campaignMetrics ? formatDualMetric(campaignMetrics.cpc, campaignMetrics.linkCpc, 'currency') : renderUnavailableMetricCell()}</TableCell>
                      <TableCell className="text-center">{campaignMetrics ? formatCurrency(campaignMetrics.cpm) : renderUnavailableMetricCell()}</TableCell>
                      <TableCell className="text-center">{campaignMetrics?.cpp ? formatCurrency(campaignMetrics.cpp) : renderUnavailableMetricCell()}</TableCell>
                      <TableCell className="text-center">{campaignMetrics?.frequency ? formatNumber(campaignMetrics.frequency) : renderUnavailableMetricCell()}</TableCell>
                      <TableCell className="text-center">{renderUnavailableMetricCell()}</TableCell>
                    </TableRow>
                  )
                }

                if (row.level === 'adset') {
                  const adSet = row.adSet
                  const isExpanded = !collapsedAdSetIds.includes(adSet.id)
                  const adSetAds = filteredAdsByAdSet.get(adSet.id) || []
                  const adSetMetrics = adSetMetricsMap.get(adSet.id)
                  const adSetAdsActiveCount = adSetAds.filter((ad) => String(ad.effective_status || ad.status || '').toUpperCase() === 'ACTIVE').length
                  const adSetCostPerConversation =
                    adSetMetrics && adSetMetrics.conversations > 0
                      ? adSetMetrics.spend / adSetMetrics.conversations
                      : null
                  return (
                    <TableRow key={row.key} className={rowClass()}>
                      <TableCell>
                        <div className="space-y-1">
                          <div className="flex items-center gap-2 pl-6">
                            <button
                              type="button"
                              onClick={() => toggleAdSet(adSet.id)}
                              aria-label={isExpanded ? 'Compactar conjunto de anúncios' : 'Expandir conjunto de anúncios'}
                              className="inline-flex h-7 w-7 items-center justify-center rounded-full border border-slate-700 bg-slate-900/70 text-slate-200 transition hover:border-sky-500/40 hover:text-sky-100"
                            >
                              {isExpanded ? <CaretDown className="h-3.5 w-3.5" /> : <CaretRight className="h-3.5 w-3.5" />}
                            </button>
                            <MetaAdsEntityInlineBadge
                              kind="adset"
                              label="Conjunto"
                              toneClass="border-fuchsia-500/20 bg-fuchsia-500/10 text-fuchsia-100"
                            />
                            <button type="button" className={itemButtonClass} onClick={() => setDetail({ kind: 'adset', title: adSet.name || adSet.id, payload: adSet })}>
                              {adSet.name || adSet.id}
                            </button>
                          </div>
                          <div className="pl-[3.75rem] font-mono text-xs text-blue-100/60">{adSet.id}</div>
                        </div>
                      </TableCell>
                      <TableCell className="text-center">
                        <Badge className="border border-slate-700 bg-slate-900/70 text-slate-100">#{adSetRankMap.get(adSet.id) || '—'}</Badge>
                      </TableCell>
                      <TableCell className="text-center">
                        <div className="flex justify-center">
                          <MetaAdsStatusBadge status={adSet.effective_status || adSet.status} />
                        </div>
                      </TableCell>
                      <TableCell className="text-center">
                        <div className="flex justify-center">
                          <MetaAdsObjectiveBadge objective={adSet.optimization_goal} />
                        </div>
                      </TableCell>
                      <TableCell className="text-center">
                        <div className="flex justify-center">
                          <MetaAdsInlineItemCounter
                            activeCount={adSetAdsActiveCount}
                            inactiveCount={adSetAds.length - adSetAdsActiveCount}
                            title="Anúncios do conjunto"
                          />
                        </div>
                      </TableCell>
                      <TableCell className="text-center">{adSetMetrics ? formatCurrency(adSetMetrics.spend) : renderUnavailableMetricCell()}</TableCell>
                      <TableCell className="text-center">{adSetMetrics ? formatNumber(adSetMetrics.conversations) : renderUnavailableMetricCell()}</TableCell>
                      <TableCell className="text-center">{adSetCostPerConversation !== null ? formatCurrency(adSetCostPerConversation) : renderUnavailableMetricCell()}</TableCell>
                      <TableCell className="text-center">{adSetMetrics ? formatNumber(adSetMetrics.clicks) : renderUnavailableMetricCell()}</TableCell>
                      <TableCell className="text-center">{adSetMetrics?.reach ? formatNumber(adSetMetrics.reach) : renderUnavailableMetricCell()}</TableCell>
                      <TableCell className="text-center">{adSetMetrics ? formatNumber(adSetMetrics.impressions) : renderUnavailableMetricCell()}</TableCell>
                      <TableCell className="text-center">{renderUnavailableMetricCell()}</TableCell>
                      <TableCell className="text-center">{renderUnavailableMetricCell()}</TableCell>
                      <TableCell className="text-center">{adSetMetrics ? formatDualMetric(adSetMetrics.ctr, adSetMetrics.linkCtr, 'percent') : renderUnavailableMetricCell()}</TableCell>
                      <TableCell className="text-center">{adSetMetrics ? formatDualMetric(adSetMetrics.cpc, adSetMetrics.linkCpc, 'currency') : renderUnavailableMetricCell()}</TableCell>
                      <TableCell className="text-center">{adSetMetrics ? formatCurrency(adSetMetrics.cpm) : renderUnavailableMetricCell()}</TableCell>
                      <TableCell className="text-center">{adSetMetrics?.cpp ? formatCurrency(adSetMetrics.cpp) : renderUnavailableMetricCell()}</TableCell>
                      <TableCell className="text-center">{adSetMetrics?.frequency ? formatNumber(adSetMetrics.frequency) : renderUnavailableMetricCell()}</TableCell>
                      <TableCell className="text-center">{renderUnavailableMetricCell()}</TableCell>
                    </TableRow>
                  )
                }

                const ad = row.ad
                const adCreatives = filteredCreativesByAd.get(ad.id) || []
                const adMetrics = adMetricsMap.get(ad.id)
                const adCostPerConversation =
                  adMetrics && adMetrics.conversations > 0
                    ? adMetrics.spend / adMetrics.conversations
                    : null
                return (
                  <TableRow key={row.key} className={rowClass()}>
                    <TableCell>
                      <div className="space-y-1">
                        <div className="flex items-center gap-2 pl-12">
                          <span className="inline-flex h-7 w-7 shrink-0" aria-hidden="true" />
                          <MetaAdsEntityInlineBadge
                            kind="ad"
                            label="Anúncio"
                            toneClass="border-amber-500/20 bg-amber-500/10 text-amber-100"
                          />
                          <button type="button" className={itemButtonClass} onClick={() => setDetail({ kind: 'ad', title: ad.name || ad.id, payload: ad })}>
                            {ad.name || ad.id}
                          </button>
                        </div>
                        <div className="pl-[5.5rem] font-mono text-xs text-blue-100/60">{ad.id}</div>
                      </div>
                    </TableCell>
                    <TableCell className="text-center">
                      <Badge className="border border-slate-700 bg-slate-900/70 text-slate-100">#{adRankMap.get(ad.id) || '—'}</Badge>
                    </TableCell>
                    <TableCell className="text-center">
                      <div className="flex justify-center">
                        <MetaAdsStatusBadge status={ad.effective_status || ad.status} />
                      </div>
                    </TableCell>
                    <TableCell className="text-center text-slate-500">—</TableCell>
                      <TableCell className="text-center">
                        <div className="flex justify-center">
                          <MetaAdsInlineItemCounter
                            activeCount={String(ad.effective_status || ad.status || '').toUpperCase() === 'ACTIVE' ? adCreatives.length : 0}
                            inactiveCount={String(ad.effective_status || ad.status || '').toUpperCase() === 'ACTIVE' ? 0 : adCreatives.length}
                            title="Criativos do anúncio"
                          />
                      </div>
                    </TableCell>
                    <TableCell className="text-center">{adMetrics ? formatCurrency(adMetrics.spend) : renderUnavailableMetricCell()}</TableCell>
                    <TableCell className="text-center">{adMetrics ? formatNumber(adMetrics.conversations) : renderUnavailableMetricCell()}</TableCell>
                    <TableCell className="text-center">{adCostPerConversation !== null ? formatCurrency(adCostPerConversation) : renderUnavailableMetricCell()}</TableCell>
                    <TableCell className="text-center">{adMetrics ? formatNumber(adMetrics.clicks) : renderUnavailableMetricCell()}</TableCell>
                    <TableCell className="text-center">{adMetrics?.reach ? formatNumber(adMetrics.reach) : renderUnavailableMetricCell()}</TableCell>
                    <TableCell className="text-center">{adMetrics ? formatNumber(adMetrics.impressions) : renderUnavailableMetricCell()}</TableCell>
                    <TableCell className="text-center">{renderUnavailableMetricCell()}</TableCell>
                    <TableCell className="text-center">{renderUnavailableMetricCell()}</TableCell>
                    <TableCell className="text-center">{adMetrics ? formatDualMetric(adMetrics.ctr, adMetrics.linkCtr, 'percent') : renderUnavailableMetricCell()}</TableCell>
                    <TableCell className="text-center">{adMetrics ? formatDualMetric(adMetrics.cpc, adMetrics.linkCpc, 'currency') : renderUnavailableMetricCell()}</TableCell>
                    <TableCell className="text-center">{adMetrics ? formatCurrency(adMetrics.cpm) : renderUnavailableMetricCell()}</TableCell>
                    <TableCell className="text-center">{adMetrics?.cpp ? formatCurrency(adMetrics.cpp) : renderUnavailableMetricCell()}</TableCell>
                    <TableCell className="text-center">{adMetrics?.frequency ? formatNumber(adMetrics.frequency) : renderUnavailableMetricCell()}</TableCell>
                    <TableCell className="text-center">{renderUnavailableMetricCell()}</TableCell>
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Card className={panelClass}>
        <CardHeader>
          <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
            <div>
              <CardTitle>Criativo</CardTitle>
              <CardDescription className="text-slate-300">
                Criativos deduplicados a partir dos anúncios retornados pela Meta para a conta selecionada. Ranking segue a campanha consolidada e a hierarquia do anúncio pai.
              </CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {filteredCreatives.length === 0 ? (
            <div className="text-sm text-slate-300">Nenhum criativo encontrado.</div>
          ) : (
            filteredCreatives.map((creative) => (
              <button
                key={creative.id}
                type="button"
                onClick={() => setDetail({ kind: 'creative', title: creative.name || creative.id, payload: creative })}
                className="rounded-2xl border border-slate-800/80 bg-slate-900/55 p-4 text-left transition hover:bg-slate-900/75"
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
                    <Badge className="border border-slate-700 bg-slate-900/70 text-slate-100">#{creativeRankMap.get(creative.id) || '—'}</Badge>
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
