import { useCallback, useEffect, useMemo, useState, type ReactElement, type ReactNode } from 'react'
import { format } from 'date-fns'
import { ptBR } from 'date-fns/locale'
import { CartesianGrid, LineChart, Line, XAxis, YAxis, Tooltip as RechartsTooltip, ResponsiveContainer } from 'recharts'
import { Badge } from '@/badge'
import { Button } from '@/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/card'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/dialog'
import { EntityDetailModal, type EntityDetailSection } from '@/EntityDetailModal'
import { Popover, PopoverContent, PopoverTrigger } from '@/popover'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/select'
import { Switch } from '@/switch'
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
  CaretUp,
  CaretRight,
  CurrencyDollar,
  CheckCircle,
  Eye,
  FacebookLogo,
  FadersHorizontal,
  ChatCircleDots,
  Heart,
  InstagramLogo,
  Link,
  Lock,
  EyeSlash,
  PauseCircle,
  PresentationChart,
  ShieldCheck,
  Spinner,
  Target,
  TrendUp,
  Users,
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
type MetaAdsOverviewMetricKey =
  | 'spend'
  | 'conversations'
  | 'cpcv'
  | 'clicks'
  | 'reach'
  | 'impressions'
  | 'engagement'
  | 'redirect'
  | 'ctr'
  | 'cpc'
  | 'cpm'
  | 'cpp'
  | 'frequency'
type MetaAdsOverviewMetricSize = 'compact' | 'wide'
type MetaAdsOverviewMetricLayout = {
  key: MetaAdsOverviewMetricKey
  visible: boolean
  size: MetaAdsOverviewMetricSize
}

const META_ADS_OVERVIEW_METRIC_LAYOUT_KEY = 'skincos.metaAds.layout.overviewMetrics.v1'
const DEFAULT_META_ADS_OVERVIEW_METRIC_LAYOUT: MetaAdsOverviewMetricLayout[] = [
  { key: 'spend', visible: true, size: 'compact' },
  { key: 'conversations', visible: true, size: 'compact' },
  { key: 'cpcv', visible: true, size: 'compact' },
  { key: 'clicks', visible: true, size: 'compact' },
  { key: 'reach', visible: true, size: 'compact' },
  { key: 'impressions', visible: true, size: 'compact' },
  { key: 'engagement', visible: true, size: 'compact' },
  { key: 'redirect', visible: true, size: 'compact' },
  { key: 'ctr', visible: true, size: 'compact' },
  { key: 'cpc', visible: true, size: 'compact' },
  { key: 'cpm', visible: true, size: 'compact' },
  { key: 'cpp', visible: true, size: 'compact' },
  { key: 'frequency', visible: true, size: 'compact' },
]

function parseMetaAdsOverviewMetricLayout(raw: string | null | undefined): MetaAdsOverviewMetricLayout[] {
  try {
    const parsed = raw ? JSON.parse(raw) : null
    const items = Array.isArray(parsed) ? parsed : []
    const seen = new Set<MetaAdsOverviewMetricKey>()
    const normalized = items
      .map((item) => {
        const key = String(item?.key || '').trim() as MetaAdsOverviewMetricKey
        if (!DEFAULT_META_ADS_OVERVIEW_METRIC_LAYOUT.some((entry) => entry.key === key)) return null
        if (seen.has(key)) return null
        seen.add(key)
        return {
          key,
          visible: item?.visible !== false,
          size: item?.size === 'wide' ? 'wide' : 'compact',
        } satisfies MetaAdsOverviewMetricLayout
      })
      .filter(Boolean) as MetaAdsOverviewMetricLayout[]

    for (const fallback of DEFAULT_META_ADS_OVERVIEW_METRIC_LAYOUT) {
      if (!seen.has(fallback.key)) normalized.push(fallback)
    }
    return normalized.length ? normalized : DEFAULT_META_ADS_OVERVIEW_METRIC_LAYOUT
  } catch {
    return DEFAULT_META_ADS_OVERVIEW_METRIC_LAYOUT
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

function formatPercent(value?: number | null) {
  if (value === null || value === undefined || Number.isNaN(Number(value))) return '—'
  return `${Number(value).toFixed(2)}%`
}

function compareMetaAdsText(left: string, right: string) {
  return left.localeCompare(right, 'pt-BR', { sensitivity: 'base' })
}

function compareMetaAdsMaybeNumber(left?: number | null, right?: number | null) {
  const leftMissing = left === undefined || left === null || Number.isNaN(Number(left))
  const rightMissing = right === undefined || right === null || Number.isNaN(Number(right))
  if (leftMissing && rightMissing) return 0
  if (leftMissing) return 1
  if (rightMissing) return -1
  return Number(left) - Number(right)
}

function metaAdsStatusSortRank(status?: string) {
  const normalized = String(status || '').toUpperCase()
  if (normalized === 'ACTIVE') return 0
  if (normalized === 'PAUSED') return 1
  if (normalized === 'ARCHIVED') return 2
  return 3
}

function parseTrendDay(value: string) {
  const parsed = new Date(`${value}T12:00:00`)
  return Number.isNaN(parsed.getTime()) ? null : parsed
}

function formatTrendAxisLabel(value: string, totalDays: number) {
  const parsed = parseTrendDay(value)
  if (!parsed) return value
  if (totalDays > 35) return format(parsed, 'dd MMM', { locale: ptBR })
  return format(parsed, 'dd/MM', { locale: ptBR })
}

function formatTrendTooltipLabel(value: string) {
  const parsed = parseTrendDay(value)
  if (!parsed) return value
  return format(parsed, "dd 'de' MMMM 'de' yyyy", { locale: ptBR })
}

function buildTrendTicks(points: MetaAdsTrendPoint[]) {
  const data = Array.isArray(points) ? points : []
  if (data.length <= 7) return data.map((point) => point.day)
  const maxTicks = data.length > 45 ? 5 : data.length > 21 ? 6 : 8
  const step = Math.max(1, Math.ceil((data.length - 1) / (maxTicks - 1)))
  const ticks: string[] = []
  for (let index = 0; index < data.length; index += step) {
    ticks.push(data[index].day)
  }
  const last = data[data.length - 1]?.day
  if (last && ticks[ticks.length - 1] !== last) ticks.push(last)
  return [...new Set(ticks)]
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
    <MetaAdsHoverTooltip content={label}>
      <Badge
        className={`h-9 w-9 justify-center rounded-full px-0 ${toneClass}`}
        aria-label={label}
      >
        <MetaAdsEntityGlyph kind={kind} className="h-4 w-4" />
      </Badge>
    </MetaAdsHoverTooltip>
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
      <span
        className={`inline-flex h-10 w-10 items-center justify-center rounded-full ${normalized === 'ACTIVE' ? 'text-emerald-300' : normalized === 'PAUSED' ? 'text-amber-200' : 'text-slate-300'}`}
        aria-label={statusTooltip(status)}
      >
        <Icon className="h-5 w-5" weight="fill" aria-hidden="true" />
      </span>
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
  const iconToneClass = toneClass.includes('sky')
    ? 'text-sky-300'
    : toneClass.includes('emerald')
      ? 'text-emerald-300'
      : toneClass.includes('violet')
        ? 'text-violet-300'
        : toneClass.includes('amber')
          ? 'text-amber-300'
          : 'text-slate-300'
  return (
    <MetaAdsTableTooltip label={title} description={description}>
      <span
        className={`inline-flex h-10 w-10 items-center justify-center rounded-full ${iconToneClass}`}
        aria-label={`${title}: ${description}`}
      >
        <Icon className="h-5 w-5" weight="fill" aria-hidden="true" />
      </span>
    </MetaAdsTableTooltip>
  )
}

function formatMetricValue(value?: number | null, kind: 'number' | 'percent' | 'currency' | 'decimal' = 'number', currency = 'USD') {
  if (value === null || value === undefined || Number.isNaN(Number(value))) return '—'
  if (kind === 'percent') return formatPercent(value)
  if (kind === 'currency') return formatCurrency(value, currency)
  if (kind === 'decimal') return Number(value).toFixed(2)
  return formatNumber(value)
}

function MetaAdsDualMetricCell({
  primary,
  secondary,
  kind,
}: {
  primary?: number | null
  secondary?: number | null
  kind: 'number' | 'percent' | 'currency'
}) {
  const primaryValue =
    primary === null || primary === undefined || Number.isNaN(Number(primary))
      ? '—'
      : kind === 'percent'
        ? formatPercent(primary)
        : kind === 'currency'
          ? formatCurrency(primary)
          : formatNumber(primary)
  const secondaryValue =
    secondary === null || secondary === undefined || Number.isNaN(Number(secondary))
      ? '—'
      : kind === 'percent'
        ? formatPercent(secondary)
        : kind === 'currency'
          ? formatCurrency(secondary)
          : formatNumber(secondary)

  return (
    <div className="flex flex-col items-center justify-center leading-tight">
      <span className="text-[13px] font-medium text-slate-100 sm:text-sm">{primaryValue}</span>
      <span className="mt-0.5 text-[10px] text-slate-400 sm:text-[11px]">{secondaryValue}</span>
    </div>
  )
}

function MetaAdsMetricTile({
  label,
  tooltipLabel,
  description,
  subtitle,
  value,
  icon: Icon,
  toneClass,
  size,
}: {
  label: string
  tooltipLabel?: string
  description?: string
  subtitle?: string
  value: ReactNode
  icon: typeof CurrencyDollar
  toneClass: string
  size?: MetaAdsOverviewMetricSize
}) {
  const labelNode = <div className="text-[9px] font-medium uppercase tracking-[0.14em] text-slate-400 sm:text-[10px]">{label}</div>
  const iconNode = (
    <div className={`inline-flex h-6 w-6 items-center justify-center rounded-full border sm:h-7 sm:w-7 ${toneClass}`}>
      <Icon className="h-3 w-3" weight="fill" />
    </div>
  )
  const content = (
    <div className="flex flex-col items-center gap-1.5">
      {iconNode}
      <div className="space-y-0.5">
        {labelNode}
        {subtitle ? <div className="text-[9px] leading-tight text-slate-500">{subtitle}</div> : null}
      </div>
    </div>
  )
  const body = (
    <CardContent
      tabIndex={tooltipLabel || description ? 0 : undefined}
      className="flex min-h-[62px] flex-col items-center justify-center gap-1 p-2 text-center outline-none focus-visible:ring-2 focus-visible:ring-sky-400/45 sm:min-h-[68px]"
    >
      {content}
      <div className="space-y-0.5">
        <div className="text-[1.15rem] font-semibold leading-none text-white sm:text-[1.35rem] lg:text-[1.45rem]">{value}</div>
      </div>
    </CardContent>
  )

  return (
    <Card className={`${panelClass} ${size === 'wide' ? 'col-span-2' : ''}`}>
      {tooltipLabel || description ? (
        <MetaAdsTableTooltip label={tooltipLabel || label} description={description}>
          {body}
        </MetaAdsTableTooltip>
      ) : (
        body
      )}
    </Card>
  )
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
                  <MetaAdsHoverTooltip content={selectedAccountStatus.detail}>
                    <Badge className={selectedAccountStatus.tone}>
                      <ShieldCheck className="mr-1 h-4 w-4" />
                      {selectedAccountStatus.label}
                    </Badge>
                  </MetaAdsHoverTooltip>
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
                      <MetaAdsHoverTooltip content={accountStatus.detail}>
                        <Badge className={accountStatus.tone}>
                          {accountStatus.label}
                        </Badge>
                      </MetaAdsHoverTooltip>
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
  const [metricLayout, setMetricLayout] = useState<MetaAdsOverviewMetricLayout[]>(() => {
    try {
      if (typeof window === 'undefined') return DEFAULT_META_ADS_OVERVIEW_METRIC_LAYOUT
      return parseMetaAdsOverviewMetricLayout(window.localStorage.getItem(META_ADS_OVERVIEW_METRIC_LAYOUT_KEY))
    } catch {
      return DEFAULT_META_ADS_OVERVIEW_METRIC_LAYOUT
    }
  })

  useEffect(() => {
    try {
      window.localStorage.setItem(META_ADS_OVERVIEW_METRIC_LAYOUT_KEY, JSON.stringify(metricLayout))
    } catch {
      // ignore
    }
  }, [metricLayout])

  const reportSummary = report?.summary || null
  const primarySummary = reportSummary || summary
  const trendTicks = useMemo(() => buildTrendTicks(trend), [trend])
  const trendAxisFormatter = useMemo(
    () => (value: string) => formatTrendAxisLabel(value, trend.length),
    [trend.length],
  )
  const reportTotals = useMemo(() => {
    const campaigns = report?.campaigns || []
    return campaigns.reduce(
      (acc, campaign) => {
        if (campaign.reach !== null && campaign.reach !== undefined) {
          acc.hasReach = true
          acc.reach += Number(campaign.reach || 0)
        }
        if (campaign.linkClicks !== null && campaign.linkClicks !== undefined) {
          acc.hasLinkClicks = true
          acc.linkClicks += Number(campaign.linkClicks || 0)
        }
        if (campaign.engagement !== null && campaign.engagement !== undefined) {
          acc.hasEngagement = true
          acc.engagement += Number(campaign.engagement || 0)
        }
        if (campaign.instagramProfileVisits !== null && campaign.instagramProfileVisits !== undefined) {
          acc.hasInstagramProfileVisits = true
          acc.instagramProfileVisits += Number(campaign.instagramProfileVisits || 0)
        }
        return acc
      },
      {
        reach: 0,
        linkClicks: 0,
        engagement: 0,
        instagramProfileVisits: 0,
        hasReach: false,
        hasLinkClicks: false,
        hasEngagement: false,
        hasInstagramProfileVisits: false,
      },
    )
  }, [report?.campaigns])
  const ctr =
    Number(primarySummary?.impressions || 0) > 0
      ? (Number(primarySummary?.clicks || 0) / Number(primarySummary?.impressions || 0)) * 100
      : 0
  const linkCtr =
    Number(primarySummary?.impressions || 0) > 0
      ? (Number(reportTotals.linkClicks || 0) / Number(primarySummary?.impressions || 0)) * 100
      : 0
  const cpc =
    Number(primarySummary?.clicks || 0) > 0
      ? Number(primarySummary?.spend || 0) / Number(primarySummary?.clicks || 0)
      : 0
  const linkCpc =
    Number(reportTotals.linkClicks || 0) > 0
      ? Number(primarySummary?.spend || 0) / Number(reportTotals.linkClicks || 0)
      : 0
  const cpp =
    Number(reportTotals.reach || 0) > 0
      ? Number(primarySummary?.spend || 0) / Number(reportTotals.reach || 0)
      : 0
  const frequency =
    Number(reportTotals.reach || 0) > 0
      ? Number(primarySummary?.impressions || 0) / Number(reportTotals.reach || 0)
      : 0
  const cpm =
    Number(primarySummary?.impressions || 0) > 0
      ? (Number(primarySummary?.spend || 0) / Number(primarySummary?.impressions || 0)) * 1000
      : 0
  const metricTiles = useMemo(
    () => [
      {
        key: 'spend' as const,
        label: 'Investimento',
        tooltipLabel: 'Investimento',
        description: 'Valor total investido pela conta no período selecionado.',
        value: formatMetricValue(primarySummary?.spend ?? 0, 'currency', selectedAccount.currency || 'USD'),
        icon: CurrencyDollar,
        toneClass: 'border-emerald-500/25 bg-emerald-500/12 text-emerald-100',
      },
      {
        key: 'conversations' as const,
        label: 'Conversa',
        tooltipLabel: 'Conversas iniciadas',
        description: 'Quantidade de conversas atribuídas à conta no período selecionado.',
        value: formatMetricValue(reportSummary?.conversations ?? primarySummary?.conversations ?? 0),
        icon: ChatCircleDots,
        toneClass: 'border-sky-500/25 bg-sky-500/12 text-sky-100',
      },
      {
        key: 'cpcv' as const,
        label: 'CPCv',
        tooltipLabel: 'Custo por conversa',
        description: 'Investimento dividido pela quantidade de conversas iniciadas.',
        subtitle: 'Custo por conversa',
        value: formatMetricValue(reportSummary?.avgCostConversation ?? primarySummary?.avgCostConversation ?? 0, 'currency', selectedAccount.currency || 'USD'),
        icon: ArrowClockwise,
        toneClass: 'border-cyan-500/25 bg-cyan-500/12 text-cyan-100',
      },
      {
        key: 'clicks' as const,
        label: 'Clique / link',
        tooltipLabel: 'Cliques / Cliques em link',
        description: 'Cliques totais e cliques em link registrados para a conta no período.',
        value: (
          <MetaAdsDualMetricCell
            primary={primarySummary?.clicks ?? 0}
            secondary={reportTotals.hasLinkClicks ? reportTotals.linkClicks : null}
            kind="number"
          />
        ),
        icon: PresentationChart,
        toneClass: 'border-indigo-500/25 bg-indigo-500/12 text-indigo-100',
      },
      {
        key: 'reach' as const,
        label: 'Alcance',
        tooltipLabel: 'Alcance',
        description: 'Quantidade de pessoas alcançadas no período selecionado.',
        value: reportTotals.hasReach ? formatMetricValue(reportTotals.reach) : '—',
        icon: Users,
        toneClass: 'border-blue-500/25 bg-blue-500/12 text-blue-100',
      },
      {
        key: 'impressions' as const,
        label: 'Impressão',
        tooltipLabel: 'Impressões',
        description: 'Total de impressões registradas para a conta no período.',
        value: formatMetricValue(primarySummary?.impressions ?? 0),
        icon: Eye,
        toneClass: 'border-violet-500/25 bg-violet-500/12 text-violet-100',
      },
      {
        key: 'engagement' as const,
        label: 'Engajamento',
        tooltipLabel: 'Engajamento',
        description: 'Interações totais registradas para a conta, quando a fonte entrega essa métrica.',
        value: reportTotals.hasEngagement ? formatMetricValue(reportTotals.engagement) : '—',
        icon: Heart,
        toneClass: 'border-pink-500/25 bg-pink-500/12 text-pink-100',
      },
      {
        key: 'redirect' as const,
        label: 'Redirecionamento',
        tooltipLabel: 'Redirecionamento',
        description: 'Redirecionamentos ou visitas de perfil do Instagram, quando disponíveis.',
        value: reportTotals.hasInstagramProfileVisits ? formatMetricValue(reportTotals.instagramProfileVisits) : '—',
        icon: InstagramLogo,
        toneClass: 'border-fuchsia-500/25 bg-fuchsia-500/12 text-fuchsia-100',
      },
      {
        key: 'ctr' as const,
        label: 'CTR / CTRL',
        tooltipLabel: 'CTR / CTR link',
        description: 'Taxa de clique geral e taxa de clique em link.',
        subtitle: 'Taxa de clique',
        value: (
          <MetaAdsDualMetricCell
            primary={ctr}
            secondary={reportTotals.hasLinkClicks ? linkCtr : null}
            kind="percent"
          />
        ),
        icon: Target,
        toneClass: 'border-amber-500/25 bg-amber-500/12 text-amber-100',
      },
      {
        key: 'cpc' as const,
        label: 'CPC / CPCL',
        tooltipLabel: 'CPC / CPC link',
        description: 'Custo por clique geral e custo por clique em link.',
        subtitle: 'Custo por clique',
        value: (
          <MetaAdsDualMetricCell
            primary={cpc}
            secondary={reportTotals.hasLinkClicks ? linkCpc : null}
            kind="currency"
          />
        ),
        icon: CurrencyDollar,
        toneClass: 'border-orange-500/25 bg-orange-500/12 text-orange-100',
      },
      {
        key: 'cpm' as const,
        label: 'CPM',
        tooltipLabel: 'Custo por mil impressões',
        description: 'Investimento necessário para gerar mil impressões.',
        subtitle: 'Custo por mil',
        value: formatMetricValue(cpm, 'currency', selectedAccount.currency || 'USD'),
        icon: TrendUp,
        toneClass: 'border-rose-500/25 bg-rose-500/12 text-rose-100',
      },
      {
        key: 'cpp' as const,
        label: 'CPP',
        tooltipLabel: 'Custo por pessoa',
        description: 'Investimento dividido pela quantidade de pessoas alcançadas.',
        subtitle: 'Custo por pessoa',
        value: reportTotals.hasReach ? formatMetricValue(cpp, 'currency', selectedAccount.currency || 'USD') : '—',
        icon: Users,
        toneClass: 'border-teal-500/25 bg-teal-500/12 text-teal-100',
      },
      {
        key: 'frequency' as const,
        label: 'Frequência',
        tooltipLabel: 'Frequência',
        description: 'Média de exibições por pessoa alcançada.',
        value: reportTotals.hasReach ? formatMetricValue(frequency, 'decimal') : '—',
        icon: ArrowClockwise,
        toneClass: 'border-lime-500/25 bg-lime-500/12 text-lime-100',
      },
    ],
    [
      cpc,
      cpm,
      cpp,
      ctr,
      frequency,
      linkCpc,
      linkCtr,
      primarySummary?.avgCostConversation,
      primarySummary?.clicks,
      primarySummary?.conversations,
      primarySummary?.impressions,
      primarySummary?.spend,
      reportSummary?.avgCostConversation,
      reportSummary?.conversations,
      reportTotals.engagement,
      reportTotals.hasEngagement,
      reportTotals.hasInstagramProfileVisits,
      reportTotals.hasLinkClicks,
      reportTotals.hasReach,
      reportTotals.instagramProfileVisits,
      reportTotals.linkClicks,
      reportTotals.reach,
      selectedAccount.currency,
    ],
  )

  const visibleMetricTiles = useMemo(() => {
    const byKey = new Map(metricTiles.map((tile) => [tile.key, tile]))
    return metricLayout
      .map((config) => {
        const tile = byKey.get(config.key)
        if (!tile || !config.visible) return null
        return { ...tile, size: config.size }
      })
      .filter(Boolean) as Array<(typeof metricTiles)[number] & { size: MetaAdsOverviewMetricSize }>
  }, [metricLayout, metricTiles])

  const moveMetricTile = (key: MetaAdsOverviewMetricKey, direction: -1 | 1) => {
    setMetricLayout((prev) => {
      const currentIndex = prev.findIndex((item) => item.key === key)
      if (currentIndex < 0) return prev
      const targetIndex = currentIndex + direction
      if (targetIndex < 0 || targetIndex >= prev.length) return prev
      const next = [...prev]
      const [entry] = next.splice(currentIndex, 1)
      next.splice(targetIndex, 0, entry)
      return next
    })
  }

  const updateMetricTile = (key: MetaAdsOverviewMetricKey, patch: Partial<MetaAdsOverviewMetricLayout>) => {
    setMetricLayout((prev) => prev.map((item) => (item.key === key ? { ...item, ...patch } : item)))
  }

  return (
    <>
      <MetaAdsPersistentError error={overviewError} onRetry={onRetry} />
      <div className="flex items-center justify-between gap-3">
        <div className="text-xs uppercase tracking-[0.18em] text-slate-500">Resumo da conta</div>
        <Popover>
          <PopoverTrigger asChild>
            <Button variant="outline" size="sm" className="border-slate-700 bg-slate-900/60 text-slate-100 hover:bg-slate-800/80">
              <FadersHorizontal className="h-4 w-4" />
              Personalizar métricas
            </Button>
          </PopoverTrigger>
          <PopoverContent align="end" className="max-h-[min(38rem,calc(100vh-7rem))] w-[min(26rem,calc(100vw-2rem))] overflow-y-auto border-slate-800/80 bg-slate-950 text-slate-100">
            <div className="space-y-3">
              <div className="space-y-1">
                <div className="text-sm font-semibold text-white">Personalizar métricas</div>
              </div>
              <div className="space-y-2">
                {metricLayout.map((config, index) => {
                  const tile = metricTiles.find((entry) => entry.key === config.key)
                  if (!tile) return null
                  return (
                    <div key={config.key} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 rounded-xl border border-slate-800/80 bg-slate-900/60 p-3">
                      <div className="min-w-0">
                        <div className="truncate text-sm font-medium text-white">{tile.tooltipLabel || tile.label}</div>
                        <div className="truncate text-xs text-slate-400">{tile.description || tile.label}</div>
                      </div>
                      <div className="flex items-center gap-2">
                        <Switch
                          checked={config.visible}
                          onCheckedChange={(checked) => updateMetricTile(config.key, { visible: checked })}
                          aria-label={`${config.visible ? 'Ocultar' : 'Exibir'} ${tile.label}`}
                        />
                        <Select
                          value={config.size}
                          onValueChange={(value) => updateMetricTile(config.key, { size: value === 'wide' ? 'wide' : 'compact' })}
                        >
                          <SelectTrigger className="h-8 w-[7.5rem] border-slate-700 bg-slate-950/70 text-xs text-slate-100">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="compact">Compacto</SelectItem>
                            <SelectItem value="wide">Largo</SelectItem>
                          </SelectContent>
                        </Select>
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          className="h-8 px-2 text-slate-300 hover:bg-slate-800/80 hover:text-white"
                          onClick={() => moveMetricTile(config.key, -1)}
                          disabled={index === 0}
                          aria-label={`Mover ${tile.label} para cima`}
                        >
                          <CaretUp className="h-4 w-4" />
                        </Button>
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          className="h-8 px-2 text-slate-300 hover:bg-slate-800/80 hover:text-white"
                          onClick={() => moveMetricTile(config.key, 1)}
                          disabled={index === metricLayout.length - 1}
                          aria-label={`Mover ${tile.label} para baixo`}
                        >
                          <CaretDown className="h-4 w-4" />
                        </Button>
                      </div>
                    </div>
                  )
                })}
              </div>
              <div className="flex items-center justify-between pt-1">
                <div className="text-xs text-slate-400">Cards ocultos saem do topo, mas continuam disponíveis aqui.</div>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-8 px-2 text-slate-300 hover:bg-slate-800/80 hover:text-white"
                  onClick={() => setMetricLayout(DEFAULT_META_ADS_OVERVIEW_METRIC_LAYOUT)}
                >
                  <EyeSlash className="h-4 w-4" />
                  Resetar
                </Button>
              </div>
            </div>
          </PopoverContent>
        </Popover>
      </div>
      <div className="grid gap-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 xl:grid-cols-8">
        {visibleMetricTiles.length > 0 ? (
          visibleMetricTiles.map((tile) => (
            <MetaAdsMetricTile
              key={tile.label}
              label={tile.label}
              tooltipLabel={tile.tooltipLabel}
              description={tile.description}
              subtitle={tile.subtitle}
              value={tile.value}
              icon={tile.icon}
              toneClass={tile.toneClass}
              size={tile.size}
            />
          ))
        ) : (
          <Card className={`${panelClass} sm:col-span-3 md:col-span-4 lg:col-span-6 xl:col-span-8`}>
            <CardContent className="flex min-h-[72px] items-center justify-between gap-3 p-4 text-sm text-slate-300">
              <span>Nenhuma métrica visível no resumo.</span>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="border-slate-700 bg-slate-900/60 text-slate-100 hover:bg-slate-800/80"
                onClick={() => setMetricLayout(DEFAULT_META_ADS_OVERVIEW_METRIC_LAYOUT)}
              >
                Restaurar métricas
              </Button>
            </CardContent>
          </Card>
        )}
      </div>

      <Card className={panelClass}>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <PresentationChart className="h-5 w-5 text-sky-300" />
            Tendência de gasto
          </CardTitle>
          <CardDescription className="text-slate-300">Histórico de investimento da conta selecionada.</CardDescription>
        </CardHeader>
        <CardContent className="h-72 pt-2">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={trend}>
              <CartesianGrid strokeDasharray="3 3" opacity={0.15} />
              <XAxis
                dataKey="day"
                ticks={trendTicks}
                minTickGap={24}
                tickFormatter={trendAxisFormatter}
                tick={{ fill: 'rgba(219,234,254,0.78)', fontSize: 11 }}
                tickLine={false}
                axisLine={{ stroke: 'rgba(148,163,184,0.18)' }}
                interval="preserveStartEnd"
                tickMargin={10}
              />
              <YAxis
                tick={{ fill: 'rgba(219,234,254,0.78)', fontSize: 11 }}
                tickLine={false}
                axisLine={{ stroke: 'rgba(148,163,184,0.18)' }}
                width={38}
              />
              <RechartsTooltip
                labelFormatter={formatTrendTooltipLabel}
                formatter={(value: number) => formatCurrency(value, selectedAccount.currency || 'USD')}
                contentStyle={{
                  backgroundColor: 'rgba(2, 6, 23, 0.92)',
                  border: '1px solid rgba(148, 163, 184, 0.2)',
                  borderRadius: '16px',
                  color: 'white',
                }}
                itemStyle={{ color: '#e2e8f0' }}
                labelStyle={{ color: '#f8fafc' }}
              />
              <Line
                type="monotone"
                dataKey="spend"
                stroke="#38bdf8"
                strokeWidth={2}
                dot={false}
                activeDot={{ r: 4, fill: '#7dd3fc', stroke: '#082f49', strokeWidth: 2 }}
              />
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

  const compareCampaigns = useCallback((left: MetaCampaignRow, right: MetaCampaignRow) => {
    const leftMetrics = campaignMetricsMap.get(left.id)
    const rightMetrics = campaignMetricsMap.get(right.id)
    const leftAdSets = filteredAdSetsByCampaign.get(left.id) || []
    const rightAdSets = filteredAdSetsByCampaign.get(right.id) || []
    const leftActive = leftAdSets.filter((adSet) => String(adSet.effective_status || adSet.status || '').toUpperCase() === 'ACTIVE').length
    const rightActive = rightAdSets.filter((adSet) => String(adSet.effective_status || adSet.status || '').toUpperCase() === 'ACTIVE').length
    let compare = 0
    switch (sortKey) {
      case 'item':
        compare = compareMetaAdsText(left.name || left.id, right.name || right.id)
        break
      case 'rank':
        compare = compareMetaAdsMaybeNumber(campaignRankMap.get(left.id), campaignRankMap.get(right.id))
        break
      case 'status':
        compare = compareMetaAdsMaybeNumber(metaAdsStatusSortRank(left.effective_status || left.status), metaAdsStatusSortRank(right.effective_status || right.status))
        break
      case 'objective':
        compare = compareMetaAdsText(left.objective || '', right.objective || '')
        break
      case 'items':
        compare = compareMetaAdsMaybeNumber(leftActive, rightActive) || compareMetaAdsMaybeNumber(leftAdSets.length, rightAdSets.length)
        break
      case 'spend':
        compare = compareMetaAdsMaybeNumber(leftMetrics?.spend, rightMetrics?.spend)
        break
      case 'conversations':
        compare = compareMetaAdsMaybeNumber(leftMetrics?.conversations, rightMetrics?.conversations)
        break
      case 'cpcv':
        compare = compareMetaAdsMaybeNumber(
          leftMetrics && leftMetrics.conversations > 0 ? leftMetrics.spend / leftMetrics.conversations : null,
          rightMetrics && rightMetrics.conversations > 0 ? rightMetrics.spend / rightMetrics.conversations : null,
        )
        break
      case 'clicks':
        compare = compareMetaAdsMaybeNumber(leftMetrics?.clicks, rightMetrics?.clicks)
        break
      case 'reach':
        compare = compareMetaAdsMaybeNumber(leftMetrics?.reach, rightMetrics?.reach)
        break
      case 'impressions':
        compare = compareMetaAdsMaybeNumber(leftMetrics?.impressions, rightMetrics?.impressions)
        break
      case 'ctr':
        compare = compareMetaAdsMaybeNumber(leftMetrics?.ctr, rightMetrics?.ctr)
        break
      case 'cpc':
        compare = compareMetaAdsMaybeNumber(leftMetrics?.cpc, rightMetrics?.cpc)
        break
      case 'cpm':
        compare = compareMetaAdsMaybeNumber(leftMetrics?.cpm, rightMetrics?.cpm)
        break
      case 'cpp':
        compare = compareMetaAdsMaybeNumber(leftMetrics?.cpp, rightMetrics?.cpp)
        break
      case 'frequency':
        compare = compareMetaAdsMaybeNumber(leftMetrics?.frequency, rightMetrics?.frequency)
        break
      default:
        compare = 0
        break
    }
    if (compare !== 0) return compare * sortMultiplier
    return ((campaignOrderMap.get(left.id) ?? 0) - (campaignOrderMap.get(right.id) ?? 0))
  }, [campaignMetricsMap, campaignOrderMap, campaignRankMap, filteredAdSetsByCampaign, sortKey, sortMultiplier])

  const compareAdSets = useCallback((left: MetaAdSet, right: MetaAdSet) => {
    const leftMetrics = adSetMetricsMap.get(left.id)
    const rightMetrics = adSetMetricsMap.get(right.id)
    const leftAds = filteredAdsByAdSet.get(left.id) || []
    const rightAds = filteredAdsByAdSet.get(right.id) || []
    const leftActive = leftAds.filter((ad) => String(ad.effective_status || ad.status || '').toUpperCase() === 'ACTIVE').length
    const rightActive = rightAds.filter((ad) => String(ad.effective_status || ad.status || '').toUpperCase() === 'ACTIVE').length
    let compare = 0
    switch (sortKey) {
      case 'item':
        compare = compareMetaAdsText(left.name || left.id, right.name || right.id)
        break
      case 'rank':
        compare = compareMetaAdsMaybeNumber(adSetRankMap.get(left.id), adSetRankMap.get(right.id))
        break
      case 'status':
        compare = compareMetaAdsMaybeNumber(metaAdsStatusSortRank(left.effective_status || left.status), metaAdsStatusSortRank(right.effective_status || right.status))
        break
      case 'objective':
        compare = compareMetaAdsText(left.optimization_goal || '', right.optimization_goal || '')
        break
      case 'items':
        compare = compareMetaAdsMaybeNumber(leftActive, rightActive) || compareMetaAdsMaybeNumber(leftAds.length, rightAds.length)
        break
      case 'spend':
        compare = compareMetaAdsMaybeNumber(leftMetrics?.spend, rightMetrics?.spend)
        break
      case 'conversations':
        compare = compareMetaAdsMaybeNumber(leftMetrics?.conversations, rightMetrics?.conversations)
        break
      case 'cpcv':
        compare = compareMetaAdsMaybeNumber(
          leftMetrics && leftMetrics.conversations > 0 ? leftMetrics.spend / leftMetrics.conversations : null,
          rightMetrics && rightMetrics.conversations > 0 ? rightMetrics.spend / rightMetrics.conversations : null,
        )
        break
      case 'clicks':
        compare = compareMetaAdsMaybeNumber(leftMetrics?.clicks, rightMetrics?.clicks)
        break
      case 'reach':
        compare = compareMetaAdsMaybeNumber(leftMetrics?.reach, rightMetrics?.reach)
        break
      case 'impressions':
        compare = compareMetaAdsMaybeNumber(leftMetrics?.impressions, rightMetrics?.impressions)
        break
      case 'ctr':
        compare = compareMetaAdsMaybeNumber(leftMetrics?.ctr, rightMetrics?.ctr)
        break
      case 'cpc':
        compare = compareMetaAdsMaybeNumber(leftMetrics?.cpc, rightMetrics?.cpc)
        break
      case 'cpm':
        compare = compareMetaAdsMaybeNumber(leftMetrics?.cpm, rightMetrics?.cpm)
        break
      case 'cpp':
        compare = compareMetaAdsMaybeNumber(leftMetrics?.cpp, rightMetrics?.cpp)
        break
      case 'frequency':
        compare = compareMetaAdsMaybeNumber(leftMetrics?.frequency, rightMetrics?.frequency)
        break
      default:
        compare = 0
        break
    }
    if (compare !== 0) return compare * sortMultiplier
    return ((adSetOrderMap.get(left.id) ?? 0) - (adSetOrderMap.get(right.id) ?? 0))
  }, [adSetMetricsMap, adSetOrderMap, adSetRankMap, filteredAdsByAdSet, sortKey, sortMultiplier])

  const compareAds = useCallback((left: MetaAd, right: MetaAd) => {
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
        compare = compareMetaAdsText(left.name || left.id, right.name || right.id)
        break
      case 'rank':
        compare = compareMetaAdsMaybeNumber(adRankMap.get(left.id), adRankMap.get(right.id))
        break
      case 'status':
        compare = compareMetaAdsMaybeNumber(metaAdsStatusSortRank(left.effective_status || left.status), metaAdsStatusSortRank(right.effective_status || right.status))
        break
      case 'items':
        compare = compareMetaAdsMaybeNumber(leftActive, rightActive) || compareMetaAdsMaybeNumber(leftInactive, rightInactive)
        break
      case 'spend':
        compare = compareMetaAdsMaybeNumber(leftMetrics?.spend, rightMetrics?.spend)
        break
      case 'conversations':
        compare = compareMetaAdsMaybeNumber(leftMetrics?.conversations, rightMetrics?.conversations)
        break
      case 'cpcv':
        compare = compareMetaAdsMaybeNumber(
          leftMetrics && leftMetrics.conversations > 0 ? leftMetrics.spend / leftMetrics.conversations : null,
          rightMetrics && rightMetrics.conversations > 0 ? rightMetrics.spend / rightMetrics.conversations : null,
        )
        break
      case 'clicks':
        compare = compareMetaAdsMaybeNumber(leftMetrics?.clicks, rightMetrics?.clicks)
        break
      case 'reach':
        compare = compareMetaAdsMaybeNumber(leftMetrics?.reach, rightMetrics?.reach)
        break
      case 'impressions':
        compare = compareMetaAdsMaybeNumber(leftMetrics?.impressions, rightMetrics?.impressions)
        break
      case 'ctr':
        compare = compareMetaAdsMaybeNumber(leftMetrics?.ctr, rightMetrics?.ctr)
        break
      case 'cpc':
        compare = compareMetaAdsMaybeNumber(leftMetrics?.cpc, rightMetrics?.cpc)
        break
      case 'cpm':
        compare = compareMetaAdsMaybeNumber(leftMetrics?.cpm, rightMetrics?.cpm)
        break
      case 'cpp':
        compare = compareMetaAdsMaybeNumber(leftMetrics?.cpp, rightMetrics?.cpp)
        break
      case 'frequency':
        compare = compareMetaAdsMaybeNumber(leftMetrics?.frequency, rightMetrics?.frequency)
        break
      default:
        compare = 0
        break
    }
    if (compare !== 0) return compare * sortMultiplier
    return ((adOrderMap.get(left.id) ?? 0) - (adOrderMap.get(right.id) ?? 0))
  }, [adMetricsMap, adOrderMap, adRankMap, filteredCreativesByAd, sortKey, sortMultiplier])

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
    collapsedAdSetIds,
    collapsedCampaignIds,
    compareAdSets,
    compareAds,
    compareCampaigns,
    filteredAdsByAdSet,
    filteredAdsWithoutAdSetByCampaign,
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

  const columnHelp: Partial<Record<MetaAdsInventorySortKey | 'statusLabel' | 'objectiveLabel', { label: string; description?: string }>> = {
    item: { label: 'Item', description: 'Nome da campanha, conjunto ou anúncio.' },
    rank: { label: 'Rank', description: 'Posição relativa pelo consolidado do período.' },
    statusLabel: { label: 'Status', description: 'Situação operacional atual do item na Meta.' },
    objectiveLabel: { label: 'Objetivo', description: 'Objetivo principal de entrega e otimização.' },
    items: { label: 'Itens', description: 'Quantidade de itens filhos ativos e inativos.' },
    spend: { label: 'Investimento', description: 'Valor total investido no período selecionado.' },
    conversations: { label: 'Conversa', description: 'Conversas iniciadas atribuídas ao item.' },
    cpcv: { label: 'CPCv', description: 'Custo por conversa iniciada.' },
    clicks: { label: 'Clique', description: 'Cliques totais registrados no período.' },
    reach: { label: 'Alcance', description: 'Pessoas alcançadas no período.' },
    impressions: { label: 'Impressão', description: 'Total de impressões registradas.' },
    engagement: { label: 'Engajamento', description: 'Interações totais no item, quando a fonte entrega essa métrica.' },
    igRedirect: { label: 'Redirecionamento', description: 'Redirecionamentos ou visitas de perfil do Instagram, quando disponíveis.' },
    ctr: { label: 'CTR / CTRL', description: 'Taxa de clique geral e taxa de clique em link.' },
    cpc: { label: 'CPC / CPCL', description: 'Custo por clique geral e custo por clique em link.' },
    cpm: { label: 'CPM', description: 'Custo por mil impressões.' },
    cpp: { label: 'CPP', description: 'Custo por pessoa alcançada.' },
    frequency: { label: 'Frequência', description: 'Média de exibição por pessoa alcançada.' },
    cul: { label: 'CU / CUL', description: 'Cliques únicos e cliques únicos em link, quando disponíveis.' },
  }

  const renderSortHead = (key: MetaAdsInventorySortKey, label: string) => {
    const isActive = sortKey === key
    const help = columnHelp[key]
    return (
      <button
        type="button"
        className={`inline-flex items-center justify-center gap-2 rounded-sm px-0.5 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-300/40 ${
          isActive ? 'text-white' : 'text-blue-100/80'
        } hover:underline`}
        onClick={() => handleSortChange(key)}
        aria-label={`Ordenar ${label}`}
      >
        {help ? (
          <MetaAdsTableTooltip label={help.label} description={help.description}>
            <span>{label}</span>
          </MetaAdsTableTooltip>
        ) : (
          <span>{label}</span>
        )}
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
                <TableHead className="text-center">{renderSortHead('igRedirect', 'Redirecionamento')}</TableHead>
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
                      <TableCell className="text-center">
                        {campaignMetrics ? (
                          <MetaAdsDualMetricCell
                            primary={campaignMetrics.ctr}
                            secondary={campaignMetrics.linkCtr}
                            kind="percent"
                          />
                        ) : renderUnavailableMetricCell()}
                      </TableCell>
                      <TableCell className="text-center">
                        {campaignMetrics ? (
                          <MetaAdsDualMetricCell
                            primary={campaignMetrics.cpc}
                            secondary={campaignMetrics.linkCpc}
                            kind="currency"
                          />
                        ) : renderUnavailableMetricCell()}
                      </TableCell>
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
                      <TableCell className="text-center">
                        {adSetMetrics ? (
                          <MetaAdsDualMetricCell
                            primary={adSetMetrics.ctr}
                            secondary={adSetMetrics.linkCtr}
                            kind="percent"
                          />
                        ) : renderUnavailableMetricCell()}
                      </TableCell>
                      <TableCell className="text-center">
                        {adSetMetrics ? (
                          <MetaAdsDualMetricCell
                            primary={adSetMetrics.cpc}
                            secondary={adSetMetrics.linkCpc}
                            kind="currency"
                          />
                        ) : renderUnavailableMetricCell()}
                      </TableCell>
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
                    <TableCell className="text-center">
                      {adMetrics ? (
                        <MetaAdsDualMetricCell
                          primary={adMetrics.ctr}
                          secondary={adMetrics.linkCtr}
                          kind="percent"
                        />
                      ) : renderUnavailableMetricCell()}
                    </TableCell>
                    <TableCell className="text-center">
                      {adMetrics ? (
                        <MetaAdsDualMetricCell
                          primary={adMetrics.cpc}
                          secondary={adMetrics.linkCpc}
                          kind="currency"
                        />
                      ) : renderUnavailableMetricCell()}
                    </TableCell>
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
        <CardContent className="grid gap-3 md:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5">
          {filteredCreatives.length === 0 ? (
            <div className="text-sm text-slate-300">Nenhum criativo encontrado.</div>
          ) : (
            filteredCreatives.map((creative) => (
              <button
                key={creative.id}
                type="button"
                onClick={() => setDetail({ kind: 'creative', title: creative.name || creative.id, payload: creative })}
                className="rounded-2xl border border-slate-800/80 bg-slate-900/55 p-3 text-left transition hover:bg-slate-900/75"
              >
                {creative.thumbnailUrl ? (
                  <img
                    src={creative.thumbnailUrl}
                    alt={creative.name || creative.id}
                    className="mb-3 h-28 w-full rounded-xl object-cover"
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
