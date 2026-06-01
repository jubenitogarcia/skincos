import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type PointerEvent, type ReactElement, type ReactNode } from 'react'
import { DragDropContext, Draggable, Droppable, type DraggableProvidedDragHandleProps, type DropResult } from '@hello-pangea/dnd'
import { format } from 'date-fns'
import { ptBR } from 'date-fns/locale'
import { CartesianGrid, LineChart, Line, XAxis, YAxis, Tooltip as RechartsTooltip, ResponsiveContainer } from 'recharts'
import { Badge } from '@/badge'
import { Button } from '@/button'
import { Calendar } from '@/calendar'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/card'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/dialog'
import { EntityDetailModal, type EntityDetailSection } from '@/EntityDetailModal'
import { Input } from '@/input'
import { Popover, PopoverContent, PopoverTrigger } from '@/popover'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/select'
import { Switch } from '@/switch'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/table'
import { Textarea } from '@/textarea'
import { TooltipLabel } from '@/tooltip'
import { metaAdsApi } from '@/metaAdsApi'
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
  MetaAdsLiveEntityDetail,
  MetaAdsEntityPatch,
  MetaCampaignRow,
  MetaAdCreativeRef,
  MetaCreativeInventoryItem,
} from '@/metaAdsTypes'
import { describeMetaAdAccountStatus } from '@/metaAdsState'
import { toast } from 'sonner'
import {
  ArrowClockwise,
  CalendarBlank,
  CaretDown,
  CaretRight,
  Clock,
  CurrencyDollar,
  CheckCircle,
  DotsSixVertical,
  Eye,
  FacebookLogo,
  FadersHorizontal,
  ChatCircleDots,
  Heart,
  InstagramLogo,
  Link,
  Lock,
  Minus,
  EyeSlash,
  PauseCircle,
  PresentationChart,
  Plus,
  ShieldCheck,
  Spinner,
  Target,
  TrendUp,
  TreeStructure,
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
  | 'trend'
type MetaAdsOverviewMetricSize = 'compact' | 'wide'
type MetaAdsOverviewMetricLayout = {
  key: MetaAdsOverviewMetricKey
  visible: boolean
  width: number
  height: number
}
type MetaAdsInventoryColumnKey = MetaAdsInventorySortKey

const META_ADS_OVERVIEW_METRIC_LAYOUT_KEY = 'skincos.metaAds.layout.overviewMetrics.v2'
const META_ADS_INVENTORY_COLUMN_WIDTHS_KEY = 'skincos.metaAds.layout.inventoryColumns.v1'
const META_ADS_METRIC_TILE_DIMENSIONS = {
  minWidth: 140,
  maxWidth: 680,
  minHeight: 96,
  maxHeight: 520,
  defaultWidth: 164,
  defaultHeight: 118,
  trendWidth: 520,
  trendHeight: 340,
} as const
const DEFAULT_META_ADS_OVERVIEW_METRIC_LAYOUT: MetaAdsOverviewMetricLayout[] = [
  { key: 'spend', visible: true, width: META_ADS_METRIC_TILE_DIMENSIONS.defaultWidth, height: META_ADS_METRIC_TILE_DIMENSIONS.defaultHeight },
  { key: 'conversations', visible: true, width: META_ADS_METRIC_TILE_DIMENSIONS.defaultWidth, height: META_ADS_METRIC_TILE_DIMENSIONS.defaultHeight },
  { key: 'cpcv', visible: true, width: META_ADS_METRIC_TILE_DIMENSIONS.defaultWidth, height: META_ADS_METRIC_TILE_DIMENSIONS.defaultHeight },
  { key: 'clicks', visible: true, width: META_ADS_METRIC_TILE_DIMENSIONS.defaultWidth, height: META_ADS_METRIC_TILE_DIMENSIONS.defaultHeight },
  { key: 'reach', visible: true, width: META_ADS_METRIC_TILE_DIMENSIONS.defaultWidth, height: META_ADS_METRIC_TILE_DIMENSIONS.defaultHeight },
  { key: 'impressions', visible: true, width: META_ADS_METRIC_TILE_DIMENSIONS.defaultWidth, height: META_ADS_METRIC_TILE_DIMENSIONS.defaultHeight },
  { key: 'engagement', visible: true, width: META_ADS_METRIC_TILE_DIMENSIONS.defaultWidth, height: META_ADS_METRIC_TILE_DIMENSIONS.defaultHeight },
  { key: 'redirect', visible: true, width: META_ADS_METRIC_TILE_DIMENSIONS.defaultWidth, height: META_ADS_METRIC_TILE_DIMENSIONS.defaultHeight },
  { key: 'ctr', visible: true, width: META_ADS_METRIC_TILE_DIMENSIONS.defaultWidth, height: META_ADS_METRIC_TILE_DIMENSIONS.defaultHeight },
  { key: 'cpc', visible: true, width: META_ADS_METRIC_TILE_DIMENSIONS.defaultWidth, height: META_ADS_METRIC_TILE_DIMENSIONS.defaultHeight },
  { key: 'cpm', visible: true, width: META_ADS_METRIC_TILE_DIMENSIONS.defaultWidth, height: META_ADS_METRIC_TILE_DIMENSIONS.defaultHeight },
  { key: 'cpp', visible: true, width: META_ADS_METRIC_TILE_DIMENSIONS.defaultWidth, height: META_ADS_METRIC_TILE_DIMENSIONS.defaultHeight },
  { key: 'frequency', visible: true, width: META_ADS_METRIC_TILE_DIMENSIONS.defaultWidth, height: META_ADS_METRIC_TILE_DIMENSIONS.defaultHeight },
  { key: 'trend', visible: true, width: META_ADS_METRIC_TILE_DIMENSIONS.trendWidth, height: META_ADS_METRIC_TILE_DIMENSIONS.trendHeight },
]
const META_ADS_INVENTORY_COLUMN_LIMITS: Record<MetaAdsInventoryColumnKey, { width: number; min: number; max: number }> = {
  item: { width: 300, min: 220, max: 520 },
  rank: { width: 86, min: 72, max: 120 },
  status: { width: 92, min: 76, max: 128 },
  objective: { width: 112, min: 88, max: 160 },
  items: { width: 92, min: 78, max: 132 },
  spend: { width: 124, min: 104, max: 176 },
  conversations: { width: 112, min: 92, max: 156 },
  cpcv: { width: 108, min: 92, max: 152 },
  clicks: { width: 104, min: 88, max: 144 },
  reach: { width: 108, min: 92, max: 152 },
  impressions: { width: 118, min: 98, max: 164 },
  engagement: { width: 112, min: 92, max: 154 },
  igRedirect: { width: 152, min: 124, max: 220 },
  ctr: { width: 116, min: 96, max: 164 },
  cpc: { width: 116, min: 96, max: 164 },
  cpm: { width: 108, min: 90, max: 152 },
  cpp: { width: 108, min: 90, max: 152 },
  frequency: { width: 112, min: 92, max: 152 },
  cul: { width: 108, min: 90, max: 152 },
}
const META_ADS_INVENTORY_COLUMN_ORDER: MetaAdsInventoryColumnKey[] = [
  'item',
  'rank',
  'status',
  'objective',
  'items',
  'spend',
  'conversations',
  'cpcv',
  'clicks',
  'reach',
  'impressions',
  'engagement',
  'igRedirect',
  'ctr',
  'cpc',
  'cpm',
  'cpp',
  'frequency',
  'cul',
]
const META_ADS_LIVE_FIELD_LABELS: Record<string, string> = {
  account_id: 'Conta de anúncios',
  adset: 'Conjunto de anúncios',
  adset_id: 'ID do conjunto',
  asset_feed_spec: 'Configuração dinâmica',
  bid_strategy: 'Estratégia de lance',
  billing_event: 'Evento de cobrança',
  body: 'Texto',
  buying_type: 'Tipo de compra',
  call_to_action_type: 'Chamada para ação',
  campaign: 'Campanha',
  campaign_id: 'ID da campanha',
  conversion_specs: 'Conversões configuradas',
  created_time: 'Criado em',
  creative: 'Criativo',
  daily_budget: 'Orçamento diário',
  effective_object_story_id: 'Story ID efetivo',
  effective_status: 'Status efetivo',
  end_time: 'Fim',
  id: 'ID',
  image_hash: 'Hash da imagem',
  image_url: 'Imagem',
  instagram_permalink_url: 'Link do Instagram',
  issues_info: 'Avisos da Meta',
  lifetime_budget: 'Orçamento vitalício',
  name: 'Nome',
  object_story_id: 'Object story ID',
  object_story_spec: 'Conteúdo do post/anúncio',
  object_url: 'URL de destino',
  objective: 'Objetivo',
  optimization_goal: 'Meta de otimização',
  promoted_object: 'Objeto promovido',
  recommendations: 'Recomendações da Meta',
  special_ad_categories: 'Categorias especiais',
  start_time: 'Início',
  status: 'Status configurado',
  stop_time: 'Fim',
  targeting: 'Segmentação',
  thumbnail_url: 'Miniatura',
  title: 'Título',
  tracking_specs: 'Tracking configurado',
  updated_time: 'Atualizado em',
  url_tags: 'Parâmetros de URL',
  video_id: 'ID do vídeo',
}
const META_ADS_LIVE_FIELD_ORDER = [
  'name',
  'id',
  'account_id',
  'status',
  'effective_status',
  'objective',
  'optimization_goal',
  'daily_budget',
  'lifetime_budget',
  'bid_strategy',
  'buying_type',
  'billing_event',
  'start_time',
  'stop_time',
  'end_time',
  'campaign',
  'campaign_id',
  'adset',
  'adset_id',
  'creative',
  'promoted_object',
  'targeting',
  'special_ad_categories',
  'tracking_specs',
  'conversion_specs',
  'object_story_spec',
  'asset_feed_spec',
  'thumbnail_url',
  'image_url',
  'title',
  'body',
  'call_to_action_type',
  'url_tags',
  'instagram_permalink_url',
  'object_url',
  'issues_info',
  'recommendations',
  'created_time',
  'updated_time',
] as const
const META_ADS_HIDDEN_LIVE_FIELDS = new Set(['_crm_detail_warning'])
const META_ADS_MODAL_HEADER_FIELDS = new Set(['id', 'account_id', 'name', 'status', 'effective_status', 'objective', 'optimization_goal', 'buying_type', 'bid_strategy', 'billing_event'])
const META_ADS_MODAL_TIMELINE_FIELDS = new Set(['start_time', 'stop_time', 'end_time', 'created_time', 'updated_time'])
const META_ADS_EDITABLE_DATE_FIELDS = new Set(['start_time', 'stop_time', 'end_time'])
const META_ADS_BUDGET_FIELDS = new Set(['daily_budget', 'lifetime_budget'])

function clampMetaAdsMetricDimension(value: unknown, min: number, max: number, fallback: number) {
  const numberValue = Number(value)
  if (!Number.isFinite(numberValue)) return fallback
  return Math.min(max, Math.max(min, Math.round(numberValue)))
}

function getDefaultMetaAdsMetricDimensions(key: MetaAdsOverviewMetricKey, legacySize?: MetaAdsOverviewMetricSize) {
  if (key === 'trend') {
    return {
      width: legacySize === 'compact' ? 320 : META_ADS_METRIC_TILE_DIMENSIONS.trendWidth,
      height: legacySize === 'compact' ? 250 : META_ADS_METRIC_TILE_DIMENSIONS.trendHeight,
    }
  }
  return {
    width: legacySize === 'wide' ? 340 : META_ADS_METRIC_TILE_DIMENSIONS.defaultWidth,
    height: legacySize === 'wide' ? 156 : META_ADS_METRIC_TILE_DIMENSIONS.defaultHeight,
  }
}

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
          width: clampMetaAdsMetricDimension(
            item?.width,
            META_ADS_METRIC_TILE_DIMENSIONS.minWidth,
            META_ADS_METRIC_TILE_DIMENSIONS.maxWidth,
            getDefaultMetaAdsMetricDimensions(key, item?.size === 'wide' ? 'wide' : 'compact').width,
          ),
          height: clampMetaAdsMetricDimension(
            item?.height,
            META_ADS_METRIC_TILE_DIMENSIONS.minHeight,
            META_ADS_METRIC_TILE_DIMENSIONS.maxHeight,
            getDefaultMetaAdsMetricDimensions(key, item?.size === 'wide' ? 'wide' : 'compact').height,
          ),
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

function getMetaAdsLiveFieldLabel(field: string) {
  return META_ADS_LIVE_FIELD_LABELS[field] || field.replace(/_/g, ' ')
}

function summarizeMetaAdsLiveObject(value: Record<string, unknown>) {
  const preferredKeys = ['name', 'id', 'status', 'effective_status', 'objective', 'optimization_goal', 'pixel_id', 'page_id', 'custom_event_type', 'application_id']
  const visibleParts = preferredKeys
    .filter((key) => value[key] !== undefined && value[key] !== null && value[key] !== '')
    .map((key) => `${getMetaAdsLiveFieldLabel(key)}: ${String(value[key])}`)
  if (visibleParts.length) return visibleParts.slice(0, 4).join(' · ')

  const primitiveParts = Object.entries(value)
    .filter(([, item]) => ['string', 'number', 'boolean'].includes(typeof item))
    .slice(0, 4)
    .map(([key, item]) => `${getMetaAdsLiveFieldLabel(key)}: ${String(item)}`)
  if (primitiveParts.length) return primitiveParts.join(' · ')

  const keys = Object.keys(value)
  return keys.length ? `Configuração disponível (${keys.length} ${keys.length === 1 ? 'campo' : 'campos'})` : ''
}

function formatMetaAdsLiveDate(value: unknown) {
  if (value === null || value === undefined || value === '') return ''
  const raw = String(value)
  const normalized = raw.replace(/([+-]\d{2})(\d{2})$/, '$1:$2')
  const date = new Date(normalized)
  if (Number.isNaN(date.getTime())) return raw
  return new Intl.DateTimeFormat('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    year: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date)
}

function getMetaAdsDateOffset(value: unknown) {
  const match = String(value || '').match(/(Z|[+-]\d{2}:?\d{2})$/)
  return match ? match[1].replace(':', '') : '-0300'
}

function parseMetaAdsFriendlyDate(value: string, previousValue: unknown) {
  const trimmed = value.trim()
  if (!trimmed) return ''
  if (/^\d{4}-\d{2}-\d{2}T/.test(trimmed)) return trimmed
  const match = trimmed.match(/^(\d{2})\/(\d{2})\/(\d{2}|\d{4})(?:[\s,]+(\d{1,2}):(\d{2}))?$/)
  if (!match) return null
  const day = Number(match[1])
  const month = Number(match[2])
  const yearInput = Number(match[3])
  const year = match[3].length === 2 ? 2000 + yearInput : yearInput
  const hour = match[4] === undefined ? 0 : Number(match[4])
  const minute = match[5] === undefined ? 0 : Number(match[5])
  const date = new Date(year, month - 1, day, hour, minute)
  if (
    date.getFullYear() !== year ||
    date.getMonth() !== month - 1 ||
    date.getDate() !== day ||
    date.getHours() !== hour ||
    date.getMinutes() !== minute
  ) {
    return null
  }
  const two = (numberValue: number) => String(numberValue).padStart(2, '0')
  return `${year}-${two(month)}-${two(day)}T${two(hour)}:${two(minute)}:00${getMetaAdsDateOffset(previousValue)}`
}

function parseMetaAdsDateForPicker(value: unknown, previousValue: unknown) {
  const parsed = typeof value === 'string' ? parseMetaAdsFriendlyDate(value, previousValue) : null
  const raw = parsed === null ? String(previousValue || value || '') : String(parsed || value || previousValue || '')
  if (!raw) return null
  const normalized = raw.replace(/([+-]\d{2})(\d{2})$/, '$1:$2')
  const date = new Date(normalized)
  if (Number.isNaN(date.getTime())) return null
  return date
}

function formatMetaAdsDatePickerValue(date: Date) {
  return new Intl.DateTimeFormat('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    year: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date)
}

function mergeMetaAdsDatePickerValue({
  current,
  date,
  hour,
  minute,
}: {
  current: Date | null
  date?: Date
  hour?: number
  minute?: number
}) {
  const next = current ? new Date(current) : new Date()
  if (date) {
    next.setFullYear(date.getFullYear(), date.getMonth(), date.getDate())
  }
  if (hour !== undefined) next.setHours(hour)
  if (minute !== undefined) next.setMinutes(minute)
  next.setSeconds(0, 0)
  return formatMetaAdsDatePickerValue(next)
}

function formatMetaAdsBudgetFromCents(value: unknown, currency = 'BRL') {
  if (value === null || value === undefined || value === '') return ''
  const cents = Number(String(value).replace(/[^\d.-]/g, ''))
  if (!Number.isFinite(cents)) return String(value)
  return formatCurrency(cents / 100, currency)
}

function parseMetaAdsCurrencyAmount(value: string) {
  const compact = String(value || '').replace(/[^\d,.-]/g, '').trim()
  if (!compact) return null
  const hasComma = compact.includes(',')
  const normalized = hasComma ? compact.replace(/\./g, '').replace(',', '.') : compact.replace(/,/g, '')
  const amount = Number(normalized)
  return Number.isFinite(amount) ? amount : null
}

function formatMetaAdsCurrencyInput(value: string, currency = 'BRL') {
  const amount = parseMetaAdsCurrencyAmount(value)
  return amount === null ? '' : formatCurrency(amount, currency)
}

function stepMetaAdsCurrencyInput(value: string, delta: number, currency = 'BRL') {
  const amount = parseMetaAdsCurrencyAmount(value) ?? 0
  return formatCurrency(Math.max(0, amount + delta), currency)
}

function parseMetaAdsBudgetToCents(value: string) {
  const amount = parseMetaAdsCurrencyAmount(value)
  if (amount === null) return ''
  return String(Math.max(0, Math.round(amount * 100)))
}

function formatMetaAdsEditableValue(field: string, value: unknown) {
  if (META_ADS_BUDGET_FIELDS.has(field)) return formatMetaAdsBudgetFromCents(value)
  if (META_ADS_EDITABLE_DATE_FIELDS.has(field)) return formatMetaAdsLiveDate(value)
  return value === null || value === undefined ? '' : String(value)
}

function parseMetaAdsEditableValue(field: string, value: string, previousValue: unknown) {
  if (META_ADS_BUDGET_FIELDS.has(field)) return parseMetaAdsBudgetToCents(value)
  if (META_ADS_EDITABLE_DATE_FIELDS.has(field)) return parseMetaAdsFriendlyDate(value, previousValue)
  return value
}

function formatMetaAdsLiveFieldValue(field: string, value: unknown) {
  if (value === null || value === undefined || value === '') return ''
  if (typeof value === 'boolean') return value ? 'Sim' : 'Não'
  if (typeof value === 'number') return String(value)
  if (META_ADS_BUDGET_FIELDS.has(field)) return formatMetaAdsBudgetFromCents(value)
  if (META_ADS_MODAL_TIMELINE_FIELDS.has(field)) return formatMetaAdsLiveDate(value)
  if (typeof value === 'string') return value
  if (Array.isArray(value)) {
    if (!value.length) return ''
    const primitiveValues = value.filter((item) => ['string', 'number', 'boolean'].includes(typeof item))
    if (primitiveValues.length === value.length) return primitiveValues.map(String).join(', ')
    return `${value.length} ${value.length === 1 ? 'registro disponível' : 'registros disponíveis'}`
  }
  if (typeof value === 'object') {
    const summary = summarizeMetaAdsLiveObject(value as Record<string, unknown>)
    if (summary) return summary
    return `Configuração disponível em ${getMetaAdsLiveFieldLabel(field).toLowerCase()}`
  }
  return String(value)
}

type MetaAdsLiveFieldCard = {
  key: string
  label: string
  value: string
}

function buildMetaAdsLiveFieldCards(fields: Record<string, unknown>, editableFields: Set<string>, excludedFields = new Set<string>()) {
  const entries = Object.entries(fields)
    .filter(([key]) => !META_ADS_HIDDEN_LIVE_FIELDS.has(key) && !excludedFields.has(key))
    .map(([key, value]) => ({
      key,
      label: getMetaAdsLiveFieldLabel(key),
      value: formatMetaAdsLiveFieldValue(key, value),
      editable: editableFields.has(key),
      order: META_ADS_LIVE_FIELD_ORDER.indexOf(key as (typeof META_ADS_LIVE_FIELD_ORDER)[number]),
    }))
    .filter((field) => field.value)
    .sort((left, right) => {
      const leftOrder = left.order >= 0 ? left.order : 999
      const rightOrder = right.order >= 0 ? right.order : 999
      if (leftOrder !== rightOrder) return leftOrder - rightOrder
      return left.label.localeCompare(right.label, 'pt-BR')
    })

  return {
    editable: entries.filter((field) => field.editable).map(({ key, label, value }) => ({ key, label, value })),
    readOnly: entries.filter((field) => !field.editable).map(({ key, label, value }) => ({ key, label, value })),
  }
}

function MetaAdsLiveFieldPanel({
  title,
  description,
  fields,
  tone,
}: {
  title: string
  description: string
  fields: MetaAdsLiveFieldCard[]
  tone: 'editable' | 'blocked' | 'readonly'
}) {
  if (!fields.length) return null
  const toneClass =
    tone === 'editable'
      ? 'border-sky-500/20 bg-sky-500/5'
      : tone === 'blocked'
        ? 'border-amber-500/20 bg-amber-500/5'
      : 'border-slate-800/70 bg-slate-900/30'
  const badgeClass =
    tone === 'editable'
      ? 'bg-sky-400/15 text-sky-100'
      : tone === 'blocked'
        ? 'bg-amber-400/15 text-amber-100'
      : 'bg-slate-700/70 text-slate-200'
  const badgeLabel =
    tone === 'editable'
      ? 'Editável'
      : tone === 'blocked'
        ? 'Bloqueado nesta sessão'
        : 'Somente leitura'
  const fieldClass =
    tone === 'readonly'
      ? 'border-slate-800/65 bg-slate-950/35 opacity-75'
      : 'border-slate-800/80 bg-slate-950/45'

  return (
    <div className={`space-y-3 rounded-2xl border p-4 ${toneClass}`}>
      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <div className="text-sm font-medium text-white">{title}</div>
          <div className="text-xs text-slate-400">{description}</div>
        </div>
        {tone === 'readonly' ? null : <Badge className={badgeClass}>{badgeLabel}</Badge>}
      </div>
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {fields.map((field) => (
          <div key={field.key} className={`rounded-2xl border p-3 ${fieldClass}`}>
            <div className="text-[10px] uppercase tracking-[0.16em] text-slate-500">{field.label}</div>
            <div className={`mt-1 whitespace-pre-wrap break-words text-sm ${tone === 'readonly' ? 'text-slate-300' : 'text-slate-100'}`}>{field.value}</div>
          </div>
        ))}
      </div>
    </div>
  )
}

function clampMetaAdsInventoryColumnWidth(key: MetaAdsInventoryColumnKey, width: number) {
  const limits = META_ADS_INVENTORY_COLUMN_LIMITS[key]
  return Math.min(limits.max, Math.max(limits.min, Math.round(width)))
}

function getDefaultMetaAdsInventoryColumnWidths(): Record<MetaAdsInventoryColumnKey, number> {
  return META_ADS_INVENTORY_COLUMN_ORDER.reduce(
    (acc, key) => {
      acc[key] = META_ADS_INVENTORY_COLUMN_LIMITS[key].width
      return acc
    },
    {} as Record<MetaAdsInventoryColumnKey, number>,
  )
}

function parseMetaAdsInventoryColumnWidths(raw: string | null | undefined): Record<MetaAdsInventoryColumnKey, number> {
  const defaults = getDefaultMetaAdsInventoryColumnWidths()
  try {
    const parsed = raw ? JSON.parse(raw) : null
    if (!parsed || typeof parsed !== 'object') return defaults
    return META_ADS_INVENTORY_COLUMN_ORDER.reduce(
      (acc, key) => {
        const value = Number((parsed as Record<string, unknown>)[key])
        acc[key] = Number.isFinite(value) ? clampMetaAdsInventoryColumnWidth(key, value) : defaults[key]
        return acc
      },
      {} as Record<MetaAdsInventoryColumnKey, number>,
    )
  } catch {
    return defaults
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
    <TooltipLabel label={content}>
      {children}
    </TooltipLabel>
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

function MetaAdsLinkClicksGlyph({ className = 'h-5 w-5' }: { className?: string; weight?: unknown }) {
  return (
    <span className={`relative inline-flex items-center justify-center ${className}`} aria-hidden="true">
      <span className="absolute h-[78%] w-[78%] rounded-full border border-current opacity-55" />
      <span className="absolute left-[24%] top-[48%] h-px w-[44%] -rotate-12 rounded-full bg-current" />
      <span className="absolute right-[18%] top-[28%] h-[34%] w-[34%] rotate-45 border-r-2 border-t-2 border-current" />
      <span className="absolute bottom-[18%] left-[18%] h-1.5 w-1.5 rounded-full bg-current" />
    </span>
  )
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
  if (normalized === 'ACTIVE') return 'ligado'
  if (normalized === 'PAUSED') return 'desligado'
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
      title: 'Geração de Lead',
      description: 'Prioriza cadastros, formulários ou conversas com potencial de virar atendimento.',
      icon: Target,
      toneClass: 'border-sky-500/25 bg-sky-500/12 text-sky-100',
    }
  }
  if (normalized === 'MESSAGES' || normalized === 'ENGAGED_USERS') {
    return {
      title: normalized === 'ENGAGED_USERS' ? 'Engajamento' : 'Mensagens',
      description: normalized === 'ENGAGED_USERS' ? 'Prioriza pessoas com maior chance de interagir com o anúncio.' : 'Prioriza conversas iniciadas nos canais configurados.',
      icon: ChatCircleDots,
      toneClass: 'border-emerald-500/25 bg-emerald-500/12 text-emerald-100',
    }
  }
  if (normalized === 'LINK_CLICKS' || normalized === 'TRAFFIC' || normalized === 'OUTBOUND_CLICKS') {
    return {
      title: normalized === 'TRAFFIC' ? 'Tráfego' : 'Cliques no link',
      description: 'Prioriza visitas ao destino configurado, como site, WhatsApp ou landing page.',
      icon: MetaAdsLinkClicksGlyph,
      toneClass: 'border-violet-500/25 bg-violet-500/12 text-violet-100',
    }
  }
  if (normalized === 'SALES' || normalized === 'CONVERSIONS') {
    return {
      title: normalized === 'SALES' ? 'Vendas' : 'Conversões',
      description: 'Prioriza ações de valor, como compra, agendamento ou outra conversão configurada.',
      icon: PresentationChart,
      toneClass: 'border-amber-500/25 bg-amber-500/12 text-amber-100',
    }
  }
  return {
    title: normalized ? formatMetaAdsEnumLabel(normalized) : 'Sem objetivo',
    description: normalized ? 'Objetivo informado pela Meta para orientar a entrega deste item.' : 'Sem objetivo informado pela Meta.',
    icon: WarningCircle,
    toneClass: 'border-slate-700 bg-slate-900/70 text-slate-200',
  }
}

function MetaAdsObjectiveBadge({ objective }: { objective?: string | null }) {
  const { title, description, toneClass } = describeObjective(objective)
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
        <MetaAdsObjectiveSignalGlyph value={objective} className="h-5 w-5" />
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
  currency = 'USD',
}: {
  primary?: number | null
  secondary?: number | null
  kind: 'number' | 'percent' | 'currency'
  currency?: string
}) {
  const primaryValue =
    primary === null || primary === undefined || Number.isNaN(Number(primary))
      ? '—'
      : kind === 'percent'
        ? formatPercent(primary)
        : kind === 'currency'
          ? formatCurrency(primary, currency)
          : formatNumber(primary)
  const secondaryValue =
    secondary === null || secondary === undefined || Number.isNaN(Number(secondary))
      ? '—'
      : kind === 'percent'
        ? formatPercent(secondary)
        : kind === 'currency'
          ? formatCurrency(secondary, currency)
          : formatNumber(secondary)

  return (
    <div className="flex flex-col items-center justify-center leading-tight">
      <span className="text-[13px] font-medium text-slate-100 sm:text-sm">{primaryValue}</span>
      <span className="mt-0.5 text-[10px] text-slate-400 sm:text-[11px]">{secondaryValue}</span>
    </div>
  )
}

function MetaAdsRankBadge({ rank }: { rank?: number | null }) {
  const normalizedRank = rank && Number.isFinite(Number(rank)) ? Number(rank) : null
  const podium =
    normalizedRank === 1
      ? {
          label: 'Ouro',
          className: 'border-amber-400/35 bg-amber-400/12 text-amber-200 shadow-[inset_0_1px_0_rgba(255,255,255,0.08)]',
          dotClassName: 'bg-amber-300',
        }
      : normalizedRank === 2
        ? {
            label: 'Prata',
            className: 'border-slate-300/35 bg-slate-300/10 text-slate-200 shadow-[inset_0_1px_0_rgba(255,255,255,0.08)]',
            dotClassName: 'bg-slate-300',
          }
        : normalizedRank === 3
          ? {
              label: 'Bronze',
              className: 'border-orange-400/35 bg-orange-400/10 text-orange-200 shadow-[inset_0_1px_0_rgba(255,255,255,0.08)]',
              dotClassName: 'bg-orange-300',
            }
          : null

  if (podium && normalizedRank) {
    return (
      <MetaAdsHoverTooltip content={`${podium.label} · ${normalizedRank}º lugar no ranking do período`}>
        <span
          className={`inline-flex h-6 min-w-9 items-center justify-center gap-1.5 rounded-full border px-2 text-[11px] font-semibold ${podium.className}`}
          aria-label={`${podium.label}: ${normalizedRank}º lugar no ranking do período`}
        >
          <span className={`h-1.5 w-1.5 rounded-full ${podium.dotClassName}`} aria-hidden="true" />
          {normalizedRank}º
        </span>
      </MetaAdsHoverTooltip>
    )
  }

  return (
    <MetaAdsHoverTooltip content={normalizedRank ? `${normalizedRank}º lugar no ranking do período` : 'Sem ranking no período'}>
      <Badge className="h-6 min-w-9 justify-center rounded-full border border-slate-700/80 bg-slate-900/60 px-2 text-[11px] font-semibold text-slate-300">
        {normalizedRank ? `${normalizedRank}º` : '—'}
      </Badge>
    </MetaAdsHoverTooltip>
  )
}

function hasMetaDynamicProductToken(value?: string | null) {
  return /\{\{\s*product\.name\s*\}\}/i.test(String(value || ''))
}

function getMetaAdsCreativeDisplayName(creative: MetaCreativeInventoryItem) {
  const rawName = String(creative.name || '').trim()
  if (!rawName) return creative.id || 'Criativo'
  if (!hasMetaDynamicProductToken(rawName)) return rawName
  const date = rawName.match(/\d{4}-\d{2}-\d{2}/)?.[0]
  if (date) {
    const parsedDate = new Date(`${date}T00:00:00`)
    const formattedDate = Number.isNaN(parsedDate.getTime()) ? date : format(parsedDate, 'dd/MM/yyyy', { locale: ptBR })
    return `Criativo dinâmico · ${formattedDate}`
  }
  const sanitizedName = rawName
    .replace(/\{\{\s*product\.name\s*\}\}/gi, 'Produto dinâmico')
    .replace(/\s+/g, ' ')
    .trim()
  return sanitizedName.length <= 72 ? sanitizedName : 'Criativo dinâmico'
}

function formatMetaAdsEnumLabel(value?: unknown) {
  const raw = String(value || '').trim()
  if (!raw) return ''
  const normalized = raw.toUpperCase()
  const labels: Record<string, string> = {
    AUCTION: 'Leilão',
    BUYING_TYPE_AUCTION: 'Leilão',
    LEADS: 'Geração de Lead',
    LEAD_GENERATION: 'Geração de Lead',
    OUTCOME_LEADS: 'Geração de Leads',
    CONVERSATIONS: 'Conversas',
    MESSAGES: 'Mensagens',
    ENGAGED_USERS: 'Engajamento',
    TRAFFIC: 'Tráfego',
    LINK_CLICKS: 'Cliques no link',
    OUTBOUND_CLICKS: 'Cliques externos',
    REACH: 'Alcance',
    IMPRESSIONS: 'Impressões',
    POST_ENGAGEMENT: 'Engajamento',
    PAGE_LIKES: 'Curtidas na página',
    EVENT_RESPONSES: 'Respostas ao evento',
    VIDEO_VIEWS: 'Visualizações de vídeo',
    APP_INSTALLS: 'Instalações do app',
    BRAND_AWARENESS: 'Reconhecimento da marca',
    LOCAL_AWARENESS: 'Reconhecimento local',
    STORE_VISITS: 'Visitas à loja',
    VALUE: 'Valor',
    LANDING_PAGE_VIEWS: 'Visualizações da página',
    QUALITY_CALL: 'Ligação qualificada',
    SALES: 'Vendas',
    CONVERSIONS: 'Conversões',
    OFFSITE_CONVERSIONS: 'Conversões no site',
    LEARN_MORE: 'Saiba mais',
    SIGN_UP: 'Cadastre-se',
    CONTACT_US: 'Fale conosco',
    WHATSAPP_MESSAGE: 'Enviar mensagem',
    MESSAGE_PAGE: 'Enviar mensagem',
    BOOK_NOW: 'Agendar agora',
    APPLY_NOW: 'Inscrever-se',
    DOWNLOAD: 'Baixar',
    SHOP_NOW: 'Comprar agora',
    GET_QUOTE: 'Solicitar orçamento',
    LOWEST_COST_WITHOUT_CAP: 'Menor custo sem limite',
    LOWEST_COST_WITH_BID_CAP: 'Menor custo com limite de lance',
    COST_CAP: 'Controle de custo',
    BID_CAP: 'Limite de lance',
    ABSOLUTE_OCPM: 'Otimização por mil impressões',
    TARGET_COST: 'Custo alvo',
    NONE: 'Sem estratégia definida',
    RESERVED: 'Reservado',
    REACH_AND_FREQUENCY: 'Alcance e frequência',
    CLICKS: 'Cliques',
    THRUPLAY: 'ThruPlay',
    TWO_SECOND_CONTINUOUS_VIDEO_VIEWS: 'Visualizações contínuas',
  }
  if (labels[normalized]) return labels[normalized]
  return normalized
    .split('_')
    .filter(Boolean)
    .map((part) => part.charAt(0) + part.slice(1).toLowerCase())
    .join(' ')
}

type MetaAdsHeaderSignalKind = 'objective' | 'optimization_goal' | 'bid_strategy' | 'buying_type' | 'billing_event'

function describeMetaAdsHeaderValue(kind: MetaAdsHeaderSignalKind, value?: unknown) {
  const normalized = String(value || '').trim().toUpperCase()
  const generic: Record<MetaAdsHeaderSignalKind, string> = {
    objective: 'Define o resultado principal que a campanha busca entregar.',
    optimization_goal: 'Define o tipo de resultado que o conjunto prioriza na entrega.',
    bid_strategy: 'Define como a Meta distribui o orçamento durante os leilões.',
    buying_type: 'Define como a entrega dos anúncios é comprada na Meta.',
    billing_event: 'Define qual entrega a Meta usa para calcular a cobrança.',
  }
  const billingDescriptions: Record<string, string> = {
    IMPRESSIONS: 'A cobrança acompanha o volume de impressões entregues.',
    LINK_CLICKS: 'A cobrança acompanha cliques no link configurado.',
    CLICKS: 'A cobrança acompanha cliques registrados no anúncio.',
    CONVERSATIONS: 'A cobrança acompanha conversas iniciadas pelos anúncios.',
    THRUPLAY: 'A cobrança acompanha visualizações de vídeo qualificadas como ThruPlay.',
    TWO_SECOND_CONTINUOUS_VIDEO_VIEWS: 'A cobrança acompanha visualizações contínuas de vídeo por pelo menos dois segundos.',
  }
  if (kind === 'billing_event') return billingDescriptions[normalized] || generic.billing_event
  const descriptions: Record<string, string> = {
    LEAD_GENERATION: 'Prioriza pessoas com maior chance de enviar cadastro ou iniciar uma conversa qualificada.',
    LEADS: 'Prioriza pessoas com maior chance de enviar cadastro ou iniciar uma conversa qualificada.',
    OUTCOME_LEADS: 'Prioriza oportunidades de lead dentro da configuração atual da campanha.',
    MESSAGES: 'Prioriza conversas iniciadas nos canais configurados para o anúncio.',
    CONVERSATIONS: 'Prioriza conversas iniciadas nos canais configurados para o anúncio.',
    ENGAGED_USERS: 'Prioriza pessoas com maior chance de interagir com o anúncio.',
    TRAFFIC: 'Prioriza visitas ao destino configurado, como site, WhatsApp ou landing page.',
    LINK_CLICKS: 'Prioriza pessoas com maior probabilidade de clicar no link.',
    OUTBOUND_CLICKS: 'Prioriza cliques que levam a pessoa para fora da Meta.',
    REACH: 'Busca alcançar o maior número possível de pessoas do público definido.',
    IMPRESSIONS: 'Busca gerar o maior volume possível de exibições.',
    POST_ENGAGEMENT: 'Prioriza curtidas, comentários, compartilhamentos e outras interações.',
    SALES: 'Prioriza ações de valor, como compra, agendamento ou outra conversão configurada.',
    CONVERSIONS: 'Prioriza ações de valor, como compra, agendamento ou outra conversão configurada.',
    OFFSITE_CONVERSIONS: 'Prioriza ações de conversão registradas fora da Meta, como no site.',
    LOWEST_COST_WITHOUT_CAP: 'A Meta busca o maior volume de resultados dentro do orçamento, sem limite máximo de lance definido.',
    LOWEST_COST_WITH_BID_CAP: 'A Meta tenta manter o menor custo possível sem ultrapassar o limite de lance configurado.',
    COST_CAP: 'A Meta tenta manter o custo médio próximo do valor definido.',
    BID_CAP: 'A entrega respeita um limite máximo de lance em cada leilão.',
    TARGET_COST: 'A Meta tenta manter o custo próximo de um alvo definido ao longo da entrega.',
    ABSOLUTE_OCPM: 'Usa otimização por mil impressões quando a configuração exige entrega mais controlada.',
    AUCTION: 'Os anúncios competem em leilão a cada oportunidade de entrega.',
    BUYING_TYPE_AUCTION: 'Os anúncios competem em leilão a cada oportunidade de entrega.',
    RESERVED: 'Entrega comprada antecipadamente com volume e preço mais previsíveis.',
    REACH_AND_FREQUENCY: 'Entrega planejada para controlar alcance e frequência antes da veiculação.',
  }
  return descriptions[normalized] || generic[kind]
}

function MetaAdsHeaderTooltipDescription({
  value,
  description,
}: {
  value: string
  description: string
}) {
  return (
    <span className="block space-y-1">
      <span className="block font-medium text-slate-100">{value}</span>
      <span className="block">{description}</span>
    </span>
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
  width,
  height,
  dragHandleProps,
  onHide,
  onResize,
}: {
  label: string
  tooltipLabel?: string
  description?: string
  subtitle?: string
  value: ReactNode
  icon: typeof CurrencyDollar
  toneClass: string
  width: number
  height: number
  dragHandleProps?: DraggableProvidedDragHandleProps | null
  onHide?: () => void
  onResize?: (dimensions: { width: number; height: number }) => void
}) {
  const resizeStartRef = useRef<{ x: number; y: number; width: number; height: number } | null>(null)
  const spacious = width >= 250 || height >= 150
  const roomy = width >= 320 && height >= 176
  const labelNode = <div className="text-[9px] font-medium uppercase tracking-[0.14em] text-slate-400 sm:text-[10px]">{label}</div>
  const iconNode = (
    <div className={`inline-flex ${roomy ? 'h-9 w-9' : spacious ? 'h-7 w-7' : 'h-6 w-6'} items-center justify-center rounded-full border ${toneClass}`}>
      <Icon className={roomy ? 'h-4 w-4' : 'h-3 w-3'} weight="fill" />
    </div>
  )
  const content = (
    <div className={`${spacious ? 'flex-row text-left' : 'flex-col text-center'} flex items-center justify-center gap-2`}>
      {iconNode}
      <div className="space-y-0.5">
        {labelNode}
        {subtitle && spacious ? <div className="text-[9px] leading-tight text-slate-500">{subtitle}</div> : null}
      </div>
    </div>
  )
  const body = (
    <CardContent
      tabIndex={tooltipLabel || description ? 0 : undefined}
      className={`${spacious ? 'items-start text-left' : 'items-center text-center'} flex h-full flex-col justify-center gap-2 p-3 outline-none focus-visible:ring-2 focus-visible:ring-sky-400/45`}
    >
      {content}
      <div className={spacious ? 'space-y-1' : 'space-y-0.5'}>
        <div className={`${roomy ? 'text-[1.35rem]' : spacious ? 'text-[1.16rem]' : 'text-[1.05rem]'} font-semibold leading-tight text-white`}>{value}</div>
        {roomy && description ? <div className="max-w-64 text-[10px] leading-snug text-slate-400">{description}</div> : null}
      </div>
    </CardContent>
  )
  const handleResizePointerDown = (event: PointerEvent<HTMLButtonElement>) => {
    if (!onResize) return
    event.preventDefault()
    event.stopPropagation()
    resizeStartRef.current = { x: event.clientX, y: event.clientY, width, height }
    event.currentTarget.setPointerCapture?.(event.pointerId)
  }
  const handleResizePointerMove = (event: PointerEvent<HTMLButtonElement>) => {
    if (!onResize || !resizeStartRef.current) return
    const nextWidth = clampMetaAdsMetricDimension(
      resizeStartRef.current.width + event.clientX - resizeStartRef.current.x,
      META_ADS_METRIC_TILE_DIMENSIONS.minWidth,
      META_ADS_METRIC_TILE_DIMENSIONS.maxWidth,
      resizeStartRef.current.width,
    )
    const nextHeight = clampMetaAdsMetricDimension(
      resizeStartRef.current.height + event.clientY - resizeStartRef.current.y,
      META_ADS_METRIC_TILE_DIMENSIONS.minHeight,
      META_ADS_METRIC_TILE_DIMENSIONS.maxHeight,
      resizeStartRef.current.height,
    )
    onResize({ width: nextWidth, height: nextHeight })
  }
  const handleResizePointerUp = (event: PointerEvent<HTMLButtonElement>) => {
    if (!onResize || !resizeStartRef.current) return
    event.preventDefault()
    event.stopPropagation()
    resizeStartRef.current = null
  }

  return (
    <Card className={`group relative h-full gap-0 overflow-hidden py-0 transition hover:border-sky-400/25 hover:bg-slate-900/70 ${panelClass}`}>
      <button
        type="button"
        className="absolute left-2 top-2 z-10 inline-flex h-6 w-6 cursor-grab items-center justify-center rounded-full border border-slate-700/75 bg-slate-950/45 text-slate-500 opacity-60 shadow-sm transition hover:scale-105 hover:border-sky-400/40 hover:text-sky-100 hover:opacity-100 active:cursor-grabbing group-hover:opacity-100 focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-400/45"
        aria-label={`Mover card ${tooltipLabel || label}`}
        {...dragHandleProps}
      >
        <DotsSixVertical className="h-3.5 w-3.5" weight="bold" />
      </button>
      {onHide ? (
        <button
          type="button"
          className="absolute right-2 top-2 z-10 inline-flex h-6 w-6 items-center justify-center rounded-full border border-slate-700/80 bg-slate-950/60 text-slate-400 opacity-70 shadow-sm transition hover:border-rose-400/40 hover:text-rose-100 hover:opacity-100 focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-400/45"
          aria-label={`Ocultar card ${tooltipLabel || label}`}
          onClick={(event) => {
            event.preventDefault()
            event.stopPropagation()
            onHide()
          }}
        >
          <EyeSlash className="h-3.5 w-3.5" />
        </button>
      ) : null}
      {tooltipLabel || description ? (
        <MetaAdsTableTooltip label={tooltipLabel || label} description={description}>
          {body}
        </MetaAdsTableTooltip>
      ) : (
        body
      )}
      {onResize ? (
        <button
          type="button"
          className="absolute bottom-1.5 right-1.5 z-10 h-5 w-5 cursor-se-resize rounded-br-2xl border-b border-r border-slate-500/50 bg-gradient-to-br from-transparent via-transparent to-sky-300/10 opacity-60 transition hover:border-sky-300/70 hover:opacity-100 group-hover:opacity-100 focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-400/45"
          aria-label={`Redimensionar card ${tooltipLabel || label}`}
          onPointerDown={handleResizePointerDown}
          onPointerMove={handleResizePointerMove}
          onPointerUp={handleResizePointerUp}
          onPointerCancel={() => {
            resizeStartRef.current = null
          }}
        >
          <span className="absolute bottom-1 right-1 h-2.5 w-2.5 rounded-br-xl border-b border-r border-sky-200/35" aria-hidden="true" />
        </button>
      ) : null}
    </Card>
  )
}

function MetaAdsTrendWidget({
  trend,
  currency,
  syncing,
  width,
  height,
  dragHandleProps,
  onHide,
  onResize,
}: {
  trend: MetaAdsTrendPoint[]
  currency: string
  syncing?: boolean
  width: number
  height: number
  dragHandleProps?: DraggableProvidedDragHandleProps | null
  onHide?: () => void
  onResize?: (dimensions: { width: number; height: number }) => void
}) {
  const resizeStartRef = useRef<{ x: number; y: number; width: number; height: number } | null>(null)
  const roomy = width >= 440 && height >= 300
  const trendTicks = useMemo(() => buildTrendTicks(trend), [trend])
  const trendAxisFormatter = useMemo(
    () => (value: string) => formatTrendAxisLabel(value, trend.length),
    [trend.length],
  )
  const chartHeight = Math.max(150, height - (roomy ? 108 : 78))

  const handleResizePointerDown = (event: PointerEvent<HTMLButtonElement>) => {
    if (!onResize) return
    event.preventDefault()
    event.stopPropagation()
    resizeStartRef.current = { x: event.clientX, y: event.clientY, width, height }
    event.currentTarget.setPointerCapture?.(event.pointerId)
  }
  const handleResizePointerMove = (event: PointerEvent<HTMLButtonElement>) => {
    if (!onResize || !resizeStartRef.current) return
    const nextWidth = clampMetaAdsMetricDimension(
      resizeStartRef.current.width + event.clientX - resizeStartRef.current.x,
      META_ADS_METRIC_TILE_DIMENSIONS.minWidth,
      META_ADS_METRIC_TILE_DIMENSIONS.maxWidth,
      resizeStartRef.current.width,
    )
    const nextHeight = clampMetaAdsMetricDimension(
      resizeStartRef.current.height + event.clientY - resizeStartRef.current.y,
      META_ADS_METRIC_TILE_DIMENSIONS.minHeight,
      META_ADS_METRIC_TILE_DIMENSIONS.maxHeight,
      resizeStartRef.current.height,
    )
    onResize({ width: nextWidth, height: nextHeight })
  }
  const handleResizePointerUp = (event: PointerEvent<HTMLButtonElement>) => {
    if (!onResize || !resizeStartRef.current) return
    event.preventDefault()
    event.stopPropagation()
    resizeStartRef.current = null
  }

  return (
    <Card className={`${panelClass} group relative h-full overflow-hidden`}>
      <MetaAdsSyncOverlay show={syncing && trend.length > 0} label="Atualizando tendência" />
      <button
        type="button"
        className="absolute left-3 top-3 z-10 inline-flex h-6 w-6 cursor-grab items-center justify-center rounded-full border border-slate-700/75 bg-slate-950/45 text-slate-500 opacity-60 shadow-sm transition hover:scale-105 hover:border-sky-400/40 hover:text-sky-100 hover:opacity-100 active:cursor-grabbing group-hover:opacity-100 focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-400/45"
        aria-label="Mover gráfico de tendência"
        {...dragHandleProps}
      >
        <DotsSixVertical className="h-3.5 w-3.5" weight="bold" />
      </button>
      {onHide ? (
        <button
          type="button"
          className="absolute right-3 top-3 z-10 inline-flex h-6 w-6 items-center justify-center rounded-full border border-slate-700/80 bg-slate-950/60 text-slate-400 opacity-70 shadow-sm transition hover:border-rose-400/40 hover:text-rose-100 hover:opacity-100 focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-400/45"
          aria-label="Ocultar gráfico de tendência"
          onClick={(event) => {
            event.preventDefault()
            event.stopPropagation()
            onHide()
          }}
        >
          <EyeSlash className="h-3.5 w-3.5" />
        </button>
      ) : null}
      <CardHeader className={`${roomy ? 'pl-11' : 'px-10 py-3'} gap-1.5`}>
        <CardTitle className="flex items-center gap-2 text-sm sm:text-base">
          <PresentationChart className="h-5 w-5 text-sky-300" />
          Tendência de gasto
        </CardTitle>
        {roomy ? <CardDescription className="text-slate-300">Histórico de investimento da conta selecionada.</CardDescription> : null}
      </CardHeader>
      <CardContent className="pt-2" style={{ height: chartHeight }}>
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
              formatter={(value: number) => [formatCurrency(value, currency), 'Investimento']}
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
      {onResize ? (
        <button
          type="button"
          className="absolute bottom-1.5 right-1.5 z-10 h-5 w-5 cursor-se-resize rounded-br-2xl border-b border-r border-slate-500/50 bg-gradient-to-br from-transparent via-transparent to-sky-300/10 opacity-60 transition hover:border-sky-300/70 hover:opacity-100 group-hover:opacity-100 focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-400/45"
          aria-label="Redimensionar gráfico de tendência"
          onPointerDown={handleResizePointerDown}
          onPointerMove={handleResizePointerMove}
          onPointerUp={handleResizePointerUp}
          onPointerCancel={() => {
            resizeStartRef.current = null
          }}
        >
          <span className="absolute bottom-1 right-1 h-2.5 w-2.5 rounded-br-xl border-b border-r border-sky-200/35" aria-hidden="true" />
        </button>
      ) : null}
    </Card>
  )
}

function MetaAdsSyncOverlay({
  show,
  label = 'Sincronizando dados da Meta',
}: {
  show?: boolean
  label?: string
}) {
  if (!show) return null
  return (
    <div className="pointer-events-none absolute inset-0 z-20 flex items-start justify-end rounded-[inherit] bg-slate-950/18 p-3">
      <div className="inline-flex items-center gap-2 rounded-full border border-sky-400/25 bg-slate-950/85 px-3 py-1.5 text-xs font-medium text-sky-100 shadow-[0_12px_32px_rgba(14,165,233,0.16)] backdrop-blur-md">
        <Spinner className="h-3.5 w-3.5 animate-spin text-sky-300" />
        {label}
      </div>
    </div>
  )
}

function MetaAdsLoadingCard({ label = 'Carregando dados da Meta Ads' }: { label?: string }) {
  return (
    <Card className={panelClass}>
      <CardContent className="flex min-h-40 flex-col items-center justify-center gap-3 py-10 text-center text-sm text-slate-300">
        <Spinner className="h-6 w-6 animate-spin text-sky-300" />
        <div className="space-y-1">
          <div className="font-medium text-white">{label}</div>
          <div className="text-xs text-slate-500">Mantendo dados recentes em cache para acelerar a próxima abertura.</div>
        </div>
      </CardContent>
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

export function MetaAdsEmptyState({
  message,
  actionLabel,
  onAction,
  loading,
}: {
  message: string
  actionLabel?: string
  onAction?: () => void
  loading?: boolean
}) {
  return (
    <Card className={panelClass}>
      <CardContent className="flex flex-col items-center gap-3 py-10 text-center text-sm text-slate-300">
        {loading ? <Spinner className="h-5 w-5 animate-spin text-sky-300" /> : null}
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

function metaAdsStatusToBoolean(status?: string) {
  return String(status || '').toUpperCase() === 'ACTIVE'
}

function metaAdsStatusFromBoolean(active: boolean) {
  return active ? 'ACTIVE' : 'PAUSED'
}

function metaAdsStatusDisplay(status?: string) {
  const normalized = String(status || '').toUpperCase()
  if (normalized === 'ACTIVE') return 'Ativa'
  if (normalized === 'PAUSED') return 'Pausada'
  if (normalized === 'DELETED') return 'Excluída'
  if (normalized === 'ARCHIVED') return 'Arquivada'
  return normalized || 'Indefinido'
}

function metaAdsStatusControlLabel(status?: string) {
  const normalized = String(status || '').toUpperCase()
  if (normalized === 'ACTIVE') return 'ligado'
  if (normalized === 'PAUSED') return 'desligado'
  if (normalized === 'DELETED') return 'excluido'
  if (normalized === 'ARCHIVED') return 'arquivado'
  return normalized ? normalized.toLowerCase() : 'sem status'
}

function MetaAdsModalHeaderIcon({
  icon,
  label,
  description,
  value,
}: {
  icon: ReactNode
  label: string
  description: ReactNode
  value?: unknown
}) {
  if (value === undefined || value === null || value === '') return null
  return (
    <TooltipLabel label={label} description={description}>
      <span className="inline-flex h-9 w-9 items-center justify-center rounded-full border border-sky-400/25 bg-sky-400/10 text-sky-100 shadow-[0_0_24px_rgba(56,189,248,0.12)]">
        {icon}
      </span>
    </TooltipLabel>
  )
}

function MetaAdsModalHeaderStat({
  icon,
  label,
  description,
  value,
}: {
  icon: ReactNode
  label: string
  description?: ReactNode
  value?: unknown
}) {
  if (value === undefined || value === null || value === '') return null
  return (
    <TooltipLabel label={label} description={description || String(value)}>
      <span className="inline-flex h-8 items-center gap-1.5 rounded-full border border-sky-400/20 bg-sky-400/8 px-2 text-sky-100">
        <span className="inline-flex h-5 w-5 items-center justify-center text-sky-200" aria-hidden>
          {icon}
        </span>
        <span className="text-xs font-semibold leading-none">{String(value)}</span>
      </span>
    </TooltipLabel>
  )
}

function formatMetaAdsCountDescription(value: unknown, singular: string, plural: string, context: string) {
  const count = Number(value)
  const safeCount = Number.isFinite(count) ? count : 0
  const suffix = context ? ` ${context}` : ''
  return `${safeCount} ${safeCount === 1 ? singular : plural}${suffix}.`
}

function MetaAdsTitleMetaBadge({
  kind,
  label,
  value,
}: {
  kind: MetaAdsEntityKind
  label: string
  value?: string
}) {
  const trimmedValue = String(value || '').trim()
  if (!trimmedValue) return null
  return (
    <TooltipLabel label={label} description={trimmedValue}>
      <span className="inline-flex max-w-64 items-center gap-1.5 rounded-full border border-sky-400/20 bg-sky-400/8 px-2.5 py-1 text-xs text-sky-100">
        <MetaAdsEntityGlyph kind={kind} className="h-3.5 w-3.5 shrink-0" />
        <span className="truncate">{trimmedValue}</span>
      </span>
    </TooltipLabel>
  )
}

function MetaAdsEditableTitleInput({
  value,
  onChange,
  disabled,
  label,
}: {
  value: string
  onChange: (value: string) => void
  disabled: boolean
  label: string
}) {
  const inputWidth = `${Math.max(8, Math.min(42, value.length + 1))}ch`
  const inputRef = useRef<HTMLInputElement | null>(null)
  return (
    <span className="group inline-flex max-w-full items-center gap-1.5">
      <span className="inline-flex max-w-[calc(100%-2.25rem)] rounded-lg border border-transparent px-0.5 py-0.5 transition hover:border-sky-400/25 hover:bg-sky-400/5 focus-within:border-sky-400/35 focus-within:bg-sky-400/8 focus-within:ring-2 focus-within:ring-sky-400/35">
        <input
          ref={inputRef}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          disabled={disabled}
          aria-label={label}
          style={{ width: inputWidth, maxWidth: '100%' }}
          className="block min-w-0 bg-transparent text-xl font-semibold leading-tight text-white outline-none transition disabled:cursor-not-allowed disabled:opacity-70 sm:text-2xl"
        />
      </span>
      <button
        type="button"
        className="inline-flex h-7 w-7 shrink-0 cursor-pointer items-center justify-center rounded-full border border-sky-400/20 bg-sky-400/8 text-sky-100 shadow-[0_0_18px_rgba(56,189,248,0.12)] transition hover:border-sky-300/45 hover:bg-sky-400/15 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-400/45"
        aria-label={`Editar ${label.toLowerCase()}`}
        disabled={disabled}
        onClick={() => inputRef.current?.focus()}
      >
        <span className="relative h-3.5 w-3.5 rotate-[-38deg]">
          <span className="absolute left-1 top-0 h-3 w-1.5 rounded-sm border border-current bg-current/20" />
          <span className="absolute left-[0.275rem] top-3 h-0 w-0 border-l-[3px] border-r-[3px] border-t-[4px] border-l-transparent border-r-transparent border-t-current" />
          <span className="absolute left-1 top-[-0.2rem] h-1 w-1.5 rounded-t-sm bg-current" />
        </span>
      </button>
    </span>
  )
}

function MetaAdsBudgetStepperInput({
  value,
  onChange,
  disabled,
}: {
  value: string
  onChange: (value: string) => void
  disabled: boolean
}) {
  const changeBy = (delta: number) => onChange(stepMetaAdsCurrencyInput(value, delta))
  return (
    <div className="flex h-10 items-center overflow-hidden rounded-md border border-slate-700 bg-slate-950/70 text-slate-100 focus-within:ring-2 focus-within:ring-sky-400/55">
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="h-10 w-10 shrink-0 rounded-none border-r border-slate-800 text-slate-300 hover:bg-slate-800/70 hover:text-white"
        onClick={() => changeBy(-5)}
        disabled={disabled}
        aria-label="Reduzir orçamento em R$ 5,00"
      >
        <Minus className="h-4 w-4" aria-hidden="true" />
      </Button>
      <Input
        value={value}
        onChange={(event) => onChange(formatMetaAdsCurrencyInput(event.target.value))}
        onBlur={(event) => onChange(formatMetaAdsCurrencyInput(event.target.value))}
        className="h-10 min-w-0 flex-1 border-0 bg-transparent px-3 text-slate-100 shadow-none focus-visible:ring-0"
        inputMode="decimal"
        placeholder="R$ 0,00"
        disabled={disabled}
      />
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="h-10 w-10 shrink-0 rounded-none border-l border-slate-800 text-slate-300 hover:bg-slate-800/70 hover:text-white"
        onClick={() => changeBy(5)}
        disabled={disabled}
        aria-label="Aumentar orçamento em R$ 5,00"
      >
        <Plus className="h-4 w-4" aria-hidden="true" />
      </Button>
    </div>
  )
}

function MetaAdsAuctionGlyph({ className = 'h-4 w-4' }: { className?: string }) {
  return (
    <span className={`relative inline-flex items-center justify-center ${className}`} aria-hidden="true">
      <span className="absolute bottom-[18%] left-[18%] h-[52%] w-[52%] rounded-sm border border-current rotate-45 opacity-80" />
      <span className="absolute right-[16%] top-[18%] h-[28%] w-[28%] rounded-full bg-current" />
      <span className="absolute bottom-[12%] right-[12%] h-px w-[42%] -rotate-45 rounded-full bg-current opacity-70" />
    </span>
  )
}

function MetaAdsReachFrequencyGlyph({ className = 'h-4 w-4' }: { className?: string }) {
  return (
    <span className={`relative inline-flex items-center justify-center ${className}`} aria-hidden="true">
      <span className="absolute h-[72%] w-[72%] rounded-full border border-current opacity-60" />
      <span className="absolute h-[44%] w-[44%] rounded-full border border-current" />
      <span className="absolute right-[12%] top-[18%] h-1.5 w-1.5 rounded-full bg-current" />
    </span>
  )
}

function MetaAdsSignalFallbackGlyph({ className = 'h-4 w-4' }: { className?: string }) {
  return (
    <span className={`relative inline-flex items-center justify-center ${className}`} aria-hidden="true">
      <span className="absolute h-[74%] w-[74%] rounded-full border border-current opacity-65" />
      <span className="absolute h-[20%] w-[20%] rounded-full bg-current" />
      <span className="absolute right-[12%] top-[12%] h-[28%] w-[28%] rounded-full border border-current" />
    </span>
  )
}

function MetaAdsBidStrategyGlyph({ value, className = 'h-4 w-4' }: { value?: unknown; className?: string }) {
  const normalized = String(value || '').trim().toUpperCase()
  if (normalized === 'COST_CAP' || normalized === 'TARGET_COST') {
    return (
      <span className={`relative inline-flex items-center justify-center ${className}`} aria-hidden="true">
        <span className="absolute h-[74%] w-[74%] rounded-full border border-current opacity-65" />
        <span className="absolute left-[24%] top-[47%] h-px w-[52%] rounded-full bg-current" />
        <span className="absolute left-[46%] top-[18%] h-[62%] w-px rounded-full bg-current" />
        <span className="absolute h-[24%] w-[24%] rounded-full bg-current" />
      </span>
    )
  }
  if (normalized === 'BID_CAP' || normalized === 'LOWEST_COST_WITH_BID_CAP') {
    return (
      <span className={`relative inline-flex items-end justify-center gap-0.5 ${className}`} aria-hidden="true">
        <span className="h-[34%] w-[18%] rounded-full bg-current opacity-45" />
        <span className="h-[58%] w-[18%] rounded-full bg-current opacity-70" />
        <span className="h-[82%] w-[18%] rounded-full bg-current" />
        <span className="absolute right-[7%] top-[5%] h-[34%] w-[34%] rounded-full border border-current bg-slate-950" />
      </span>
    )
  }
  return (
    <span className={`relative inline-flex items-end justify-center gap-0.5 ${className}`} aria-hidden="true">
      <span className="h-[30%] w-[18%] rounded-full bg-current opacity-55" />
      <span className="h-[58%] w-[18%] rounded-full bg-current opacity-80" />
      <span className="h-[84%] w-[18%] rounded-full bg-current" />
      <span className="absolute left-[14%] top-[16%] h-px w-[70%] rotate-[-28deg] rounded-full bg-current opacity-80" />
    </span>
  )
}

function MetaAdsObjectiveSignalGlyph({ value, className = 'h-4 w-4' }: { value?: unknown; className?: string }) {
  const normalized = String(value || '').trim().toUpperCase()
  if (normalized === 'LEADS' || normalized === 'LEAD_GENERATION' || normalized === 'OUTCOME_LEADS') {
    return (
      <span className={`relative inline-flex items-center justify-center ${className}`} aria-hidden="true">
        <span className="absolute left-[16%] top-[18%] h-[28%] w-[28%] rounded-full border border-current" />
        <span className="absolute right-[16%] top-[18%] h-[28%] w-[28%] rounded-full border border-current opacity-70" />
        <span className="absolute bottom-[14%] h-[38%] w-[70%] rounded-full border border-current" />
      </span>
    )
  }
  if (normalized === 'MESSAGES' || normalized === 'CONVERSATIONS') {
    return <ChatCircleDots className={className} weight="fill" aria-hidden="true" />
  }
  if (normalized === 'LINK_CLICKS' || normalized === 'TRAFFIC' || normalized === 'OUTBOUND_CLICKS') {
    return <MetaAdsLinkClicksGlyph className={className} />
  }
  if (normalized === 'REACH' || normalized === 'IMPRESSIONS') {
    return <MetaAdsReachFrequencyGlyph className={className} />
  }
  if (normalized === 'APP_INSTALLS') {
    return (
      <span className={`relative inline-flex items-center justify-center ${className}`} aria-hidden="true">
        <span className="absolute h-[78%] w-[54%] rounded-sm border border-current" />
        <span className="absolute bottom-[18%] h-px w-[30%] rounded-full bg-current" />
        <span className="absolute top-[20%] h-[30%] w-px rounded-full bg-current" />
        <span className="absolute top-[38%] h-px w-[28%] rounded-full bg-current" />
      </span>
    )
  }
  if (normalized === 'VIDEO_VIEWS' || normalized === 'THRUPLAY') {
    return <MetaAdsBillingEventGlyph value="THRUPLAY" className={className} />
  }
  if (normalized === 'SALES' || normalized === 'CONVERSIONS' || normalized === 'OFFSITE_CONVERSIONS') {
    return (
      <span className={`relative inline-flex items-center justify-center ${className}`} aria-hidden="true">
        <span className="absolute h-[66%] w-[66%] rounded-full border border-current" />
        <span className="absolute bottom-[18%] h-[28%] w-[48%] rounded-t-full border border-current border-b-0" />
        <span className="absolute top-[18%] h-[16%] w-[36%] rounded-full bg-current" />
      </span>
    )
  }
  return <MetaAdsSignalFallbackGlyph className={className} />
}

function MetaAdsBuyingTypeGlyph({ value, className = 'h-4 w-4' }: { value?: unknown; className?: string }) {
  const normalized = String(value || '').trim().toUpperCase()
  if (normalized === 'RESERVED' || normalized === 'REACH_AND_FREQUENCY') {
    return <MetaAdsReachFrequencyGlyph className={className} />
  }
  return <MetaAdsAuctionGlyph className={className} />
}

function MetaAdsBillingEventGlyph({ value, className = 'h-4 w-4' }: { value?: unknown; className?: string }) {
  const normalized = String(value || '').trim().toUpperCase()
  if (normalized === 'IMPRESSIONS') return <MetaAdsReachFrequencyGlyph className={className} />
  if (normalized === 'LINK_CLICKS' || normalized === 'CLICKS') return <MetaAdsLinkClicksGlyph className={className} />
  if (normalized === 'CONVERSATIONS') return <ChatCircleDots className={className} weight="fill" aria-hidden="true" />
  if (normalized.includes('VIDEO') || normalized === 'THRUPLAY') {
    return (
      <span className={`relative inline-flex items-center justify-center ${className}`} aria-hidden="true">
        <span className="absolute h-[68%] w-[82%] rounded-sm border border-current" />
        <span className="absolute ml-0.5 h-0 w-0 border-y-[4px] border-l-[6px] border-y-transparent border-l-current" />
      </span>
    )
  }
  return (
    <span className={`relative inline-flex items-center justify-center ${className}`} aria-hidden="true">
      <span className="absolute h-[76%] w-[76%] rounded-full border border-current opacity-65" />
      <span className="absolute h-[52%] w-px rounded-full bg-current" />
      <span className="absolute bottom-[18%] h-px w-[46%] rounded-full bg-current" />
    </span>
  )
}

function MetaAdsStatusIcon({ status }: { status?: string }) {
  const active = metaAdsStatusToBoolean(status)
  const label = metaAdsStatusControlLabel(status)
  const normalized = String(status || '').toUpperCase()
  const paused = normalized === 'PAUSED'
  const Icon = active ? CheckCircle : paused ? PauseCircle : WarningCircle
  const className = active
    ? 'border-emerald-400/35 bg-emerald-500/15 text-emerald-100'
    : paused
      ? 'border-amber-400/35 bg-amber-500/15 text-amber-100'
      : 'border-slate-700 bg-slate-900/70 text-slate-200'
  return (
    <span className={`inline-flex h-9 w-9 items-center justify-center rounded-full border ${className}`} aria-label={`Status: ${label}`}>
      <Icon className="h-4 w-4" weight="fill" aria-hidden="true" />
    </span>
  )
}

function MetaAdsDateTimePickerInput({
  value,
  previousValue,
  onChange,
  label,
  disabled,
}: {
  value: string
  previousValue: unknown
  onChange: (next: string) => void
  label: string
  disabled?: boolean
}) {
  const [open, setOpen] = useState(false)
  const selected = useMemo(() => parseMetaAdsDateForPicker(value, previousValue), [previousValue, value])
  const selectedHour = selected ? String(selected.getHours()).padStart(2, '0') : '00'
  const selectedMinute = selected ? String(selected.getMinutes()).padStart(2, '0') : '00'
  const displayValue = selected ? formatMetaAdsDatePickerValue(selected) : 'Selecionar data e hora'
  const hourOptions = useMemo(() => Array.from({ length: 24 }, (_, index) => String(index).padStart(2, '0')), [])
  const minuteOptions = useMemo(() => Array.from({ length: 60 }, (_, index) => String(index).padStart(2, '0')), [])

  const updateDate = (date?: Date) => {
    if (!date) return
    onChange(mergeMetaAdsDatePickerValue({ current: selected, date }))
  }
  const updateHour = (hour: string) => {
    onChange(mergeMetaAdsDatePickerValue({ current: selected, hour: Number(hour) }))
  }
  const updateMinute = (minute: string) => {
    onChange(mergeMetaAdsDatePickerValue({ current: selected, minute: Number(minute) }))
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="glass-morphism flex h-10 w-full items-center justify-between rounded-md border border-slate-700 bg-slate-950/70 px-3 text-left text-sm text-slate-100 transition hover:border-sky-400/35 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-400/45 disabled:cursor-not-allowed disabled:opacity-60"
          aria-label={`${label}: ${displayValue}`}
          disabled={disabled}
        >
          <span>{displayValue}</span>
          <CalendarBlank className="h-4 w-4 text-sky-200" aria-hidden="true" />
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-auto border-slate-700 bg-slate-950 p-3 text-slate-100">
        <div className="grid gap-3 md:grid-cols-[auto_11rem]">
          <Calendar
            mode="single"
            selected={selected || undefined}
            onSelect={updateDate}
            initialFocus
          />
          <div className="flex flex-col justify-between gap-3 rounded-2xl border border-slate-800 bg-slate-900/70 p-3">
            <div className="space-y-1">
              <div className="flex items-center gap-2 text-xs font-medium text-slate-200">
                <Clock className="h-4 w-4 text-sky-200" aria-hidden="true" />
                Horário
              </div>
              <div className="grid grid-cols-2 gap-2">
                <Select value={selectedHour} onValueChange={updateHour}>
                  <SelectTrigger className="h-9 border-slate-700 bg-slate-950/70 text-slate-100">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent className="max-h-60">
                    {hourOptions.map((hour) => (
                      <SelectItem key={hour} value={hour}>{hour}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Select value={selectedMinute} onValueChange={updateMinute}>
                  <SelectTrigger className="h-9 border-slate-700 bg-slate-950/70 text-slate-100">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent className="max-h-60">
                    {minuteOptions.map((minute) => (
                      <SelectItem key={minute} value={minute}>{minute}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <Button type="button" size="sm" variant="outline" className="border-slate-700 bg-slate-950/70 text-slate-100" onClick={() => setOpen(false)}>
              Aplicar
            </Button>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  )
}

type MetaAdsResolvedAdCreative = MetaCreativeInventoryItem & {
  raw?: MetaAdCreativeRef
}

function mergeMetaAdsCreativeForAd({
  raw,
  matched,
  ad,
}: {
  raw?: MetaAdCreativeRef | null
  matched?: MetaCreativeInventoryItem | null
  ad: MetaAd
}): MetaAdsResolvedAdCreative | null {
  const id = String(matched?.id || raw?.id || '').trim()
  if (!id) return null
  return {
    id,
    name: String(matched?.name || raw?.name || ad.name || id),
    thumbnailUrl: matched?.thumbnailUrl || matched?.imageUrl || raw?.thumbnail_url || raw?.image_url || null,
    imageUrl: matched?.imageUrl || raw?.image_url || matched?.thumbnailUrl || raw?.thumbnail_url || null,
    effectiveObjectStoryId: matched?.effectiveObjectStoryId || raw?.effective_object_story_id || raw?.object_story_id || null,
    adId: matched?.adId || ad.id || null,
    adName: matched?.adName || ad.name || null,
    adSetId: matched?.adSetId || ad.adset_id || null,
    adSetName: matched?.adSetName || ad.adset_name || null,
    campaignId: matched?.campaignId || ad.campaign_id || null,
    campaignName: matched?.campaignName || ad.campaign_name || null,
    raw: raw || undefined,
  }
}

function resolveMetaAdsAdCreatives({
  ad,
  fields,
  creatives,
}: {
  ad: MetaAd
  fields: unknown
  creatives: MetaCreativeInventoryItem[]
}) {
  const rawCreative = (((fields as any)?.creative || ad.creative || null) as MetaAdCreativeRef | null)
  const rawId = String(rawCreative?.id || '').trim()
  const rawStoryId = String(rawCreative?.effective_object_story_id || rawCreative?.object_story_id || '').trim()
  const matches = creatives.filter((creative) => {
    const creativeStoryId = String(creative.effectiveObjectStoryId || '').trim()
    return (
      creative.adId === ad.id ||
      (rawId && creative.id === rawId) ||
      (rawStoryId && creativeStoryId === rawStoryId)
    )
  })
  const byId = new Map<string, MetaAdsResolvedAdCreative>()
  const addCreative = (creative: MetaAdsResolvedAdCreative | null) => {
    if (!creative?.id) return
    byId.set(creative.id, creative)
  }
  matches.forEach((matched) => {
    addCreative(mergeMetaAdsCreativeForAd({
      raw: rawId === matched.id || rawStoryId === matched.effectiveObjectStoryId ? rawCreative : null,
      matched,
      ad,
    }))
  })
  if (rawCreative) {
    const matched = matches.find((creative) => creative.id === rawId || creative.effectiveObjectStoryId === rawStoryId)
    addCreative(mergeMetaAdsCreativeForAd({ raw: rawCreative, matched, ad }))
  }
  return Array.from(byId.values())
}

type MetaAdsCreativeVariationGroup = {
  label: string
  values: string[]
}

function asMetaAdsRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null
}

function getMetaAdsObjectValue(source: unknown, path: string[]) {
  let current = source
  for (const key of path) {
    const record = asMetaAdsRecord(current)
    if (!record) return undefined
    current = record[key]
  }
  return current
}

function extractMetaAdsCreativeValue(value: unknown) {
  if (value === null || value === undefined) return ''
  if (typeof value === 'string' || typeof value === 'number') return String(value).trim()
  const record = asMetaAdsRecord(value)
  if (!record) return ''
  const candidate =
    record.text ||
    record.body ||
    record.title ||
    record.name ||
    record.description ||
    record.type ||
    record.call_to_action_type ||
    record.website_url ||
    record.url ||
    record.link ||
    record.hash ||
    record.image_hash ||
    record.video_id
  return typeof candidate === 'string' || typeof candidate === 'number' ? String(candidate).trim() : ''
}

function collectMetaAdsCreativeValues(values: unknown[], formatter?: (value: string) => string) {
  const seen = new Set<string>()
  const collected: string[] = []
  values.flatMap((value) => Array.isArray(value) ? value : [value]).forEach((value) => {
    const extracted = extractMetaAdsCreativeValue(value)
    if (!extracted) return
    const formatted = formatter ? formatter(extracted) : extracted
    const normalized = formatted.toLowerCase()
    if (!formatted || seen.has(normalized)) return
    seen.add(normalized)
    collected.push(formatted)
  })
  return collected
}

function formatMetaAdsCreativeActionLabel(value: string) {
  return formatMetaAdsEnumLabel(value)
}

function buildMetaAdsCreativeVariationGroups(raw?: MetaAdCreativeRef): MetaAdsCreativeVariationGroup[] {
  if (!raw) return []
  const assetFeed = asMetaAdsRecord(raw.asset_feed_spec)
  const objectStory = asMetaAdsRecord(raw.object_story_spec)
  const objectLinkData = getMetaAdsObjectValue(objectStory, ['link_data'])
  const objectVideoData = getMetaAdsObjectValue(objectStory, ['video_data'])
  const objectPhotoData = getMetaAdsObjectValue(objectStory, ['photo_data'])
  const objectCallToAction = getMetaAdsObjectValue(objectStory, ['link_data', 'call_to_action']) || getMetaAdsObjectValue(objectStory, ['video_data', 'call_to_action'])
  const objectCallToActionValue = getMetaAdsObjectValue(objectCallToAction, ['value'])

  const groups: MetaAdsCreativeVariationGroup[] = [
    {
      label: 'Textos',
      values: collectMetaAdsCreativeValues([
        raw.body,
        assetFeed?.bodies,
        getMetaAdsObjectValue(objectLinkData, ['message']),
        getMetaAdsObjectValue(objectVideoData, ['message']),
        getMetaAdsObjectValue(objectPhotoData, ['caption']),
      ]),
    },
    {
      label: 'Títulos',
      values: collectMetaAdsCreativeValues([
        raw.title,
        assetFeed?.titles,
        getMetaAdsObjectValue(objectLinkData, ['name']),
        getMetaAdsObjectValue(objectVideoData, ['title']),
      ]),
    },
    {
      label: 'Descrições',
      values: collectMetaAdsCreativeValues([
        assetFeed?.descriptions,
        getMetaAdsObjectValue(objectLinkData, ['description']),
      ]),
    },
    {
      label: 'CTAs',
      values: collectMetaAdsCreativeValues([
        raw.call_to_action_type,
        assetFeed?.call_to_action_types,
        getMetaAdsObjectValue(objectCallToAction, ['type']),
      ], formatMetaAdsCreativeActionLabel),
    },
    {
      label: 'URLs',
      values: collectMetaAdsCreativeValues([
        raw.object_url,
        assetFeed?.link_urls,
        getMetaAdsObjectValue(objectLinkData, ['link']),
        getMetaAdsObjectValue(objectCallToActionValue, ['link']),
      ]),
    },
    {
      label: 'Mídias',
      values: collectMetaAdsCreativeValues([
        raw.image_hash,
        raw.video_id,
        assetFeed?.images,
        assetFeed?.videos,
      ]),
    },
  ]

  return groups.filter((group) => group.values.length > 0)
}

function MetaAdsCreativeVariationPanel({ group }: { group: MetaAdsCreativeVariationGroup }) {
  return (
    <div className="min-w-0 rounded-xl border border-slate-800/85 bg-slate-950/40 p-3">
      <div className="text-[10px] font-medium uppercase tracking-[0.16em] text-slate-500">{group.label}</div>
      <div className="mt-2 space-y-2">
        {group.values.map((value, index) => (
          <div key={`${group.label}-${index}-${value}`} className="rounded-lg border border-slate-800/70 bg-slate-950/55 px-3 py-2 text-xs leading-5 text-slate-200">
            {group.values.length > 1 ? <span className="mb-1 block text-[10px] font-medium uppercase tracking-[0.14em] text-sky-300/80">Variação {index + 1}</span> : null}
            <span className="whitespace-pre-wrap break-words">{value}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

function MetaAdsAdCreativeDetails({ creative }: { creative: MetaAdsResolvedAdCreative }) {
  const creativeName = getMetaAdsCreativeDisplayName(creative)
  const preview = creative.imageUrl || creative.thumbnailUrl
  const raw = creative.raw
  const variationGroups = buildMetaAdsCreativeVariationGroups(raw)
  const storyId = creative.effectiveObjectStoryId || raw?.object_story_id || '—'

  return (
    <article className="rounded-2xl border border-amber-500/20 bg-amber-500/5 p-4">
      <div className="mb-3">
        <div className="text-sm font-medium text-white">Criativo do anúncio</div>
        <div className="text-xs text-slate-400">Textos, títulos, descrições e variações usados por este anúncio.</div>
      </div>
      <div className="grid gap-4 lg:grid-cols-[12rem_minmax(0,1fr)]">
        <div className="overflow-hidden rounded-xl border border-slate-800 bg-slate-950/60">
          {preview ? (
            <img src={preview} alt={creativeName} className="h-40 w-full object-cover" loading="lazy" referrerPolicy="no-referrer" />
          ) : (
            <div className="flex h-40 items-center justify-center text-xs text-slate-500">Sem prévia</div>
          )}
        </div>
        <div className="min-w-0 space-y-3">
          <div>
            <div className="text-[10px] font-medium uppercase tracking-[0.16em] text-slate-500">Criativo</div>
            <div className="break-words text-base font-medium text-slate-100">{creativeName}</div>
          </div>
          <div className="grid gap-2 md:grid-cols-2">
            <div className="rounded-xl border border-slate-800/85 bg-slate-950/45 p-3">
              <div className="text-[10px] uppercase tracking-[0.16em] text-slate-500">ID</div>
              <div className="break-all font-mono text-xs text-blue-100/75">{creative.id || '—'}</div>
            </div>
            <div className="rounded-xl border border-slate-800/85 bg-slate-950/45 p-3">
              <div className="text-[10px] uppercase tracking-[0.16em] text-slate-500">Story ID</div>
              <div className="break-all font-mono text-xs text-blue-100/75">{storyId}</div>
            </div>
          </div>
        </div>
      </div>
      {variationGroups.length ? (
        <div className="mt-4">
          <div className="mb-3 text-sm font-medium text-slate-100">Variações do criativo</div>
          <div className="grid gap-3 lg:grid-cols-2">
            {variationGroups.map((group) => (
              <MetaAdsCreativeVariationPanel key={group.label} group={group} />
            ))}
          </div>
        </div>
      ) : null}
    </article>
  )
}

function MetaAdsEntityDetailDialog({
  detail,
  open,
  onOpenChange,
  onEntityUpdated,
  hasBackTarget,
  creatives = [],
}: {
  detail: MetaAdsEntityDetail | null
  open: boolean
  onOpenChange: (open: boolean) => void
  onEntityUpdated?: () => void | Promise<void>
  hasBackTarget?: boolean
  creatives?: MetaCreativeInventoryItem[]
}) {
  const [liveEntity, setLiveEntity] = useState<MetaAdsLiveEntityDetail | null>(null)
  const [loadingDetail, setLoadingDetail] = useState(false)
  const [detailError, setDetailError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [form, setForm] = useState<Record<string, string>>({})

  useEffect(() => {
    if (!open || !detail) return
    let cancelled = false
    setDetailError(null)
    const applyEntity = (entity: MetaAdsLiveEntityDetail) => {
      setLiveEntity(entity)
      const nextForm: Record<string, string> = {}
      for (const field of entity.editableFields || []) {
        const value = entity.fields?.[field]
        if (value !== undefined && value !== null) nextForm[field] = formatMetaAdsEditableValue(field, value)
      }
      setForm(nextForm)
    }
    const cached = metaAdsApi.cachedEntityDetail(detail.kind, detail.payload.id)
    if (cached?.entity) {
      applyEntity(cached.entity)
      setLoadingDetail(false)
      return () => {
        cancelled = true
      }
    }
    setLiveEntity(null)
    setLoadingDetail(true)

    metaAdsApi.entityDetail(detail.kind, detail.payload.id)
      .then((response) => {
        if (cancelled) return
        applyEntity(response.entity)
      })
      .catch((error) => {
        if (cancelled) return
        setDetailError(error?.message || 'Falha ao carregar os dados live da Meta.')
      })
      .finally(() => {
        if (!cancelled) setLoadingDetail(false)
      })

    return () => {
      cancelled = true
    }
  }, [detail, open])

  if (!detail) return null

  const fields = liveEntity?.fields || detail.payload
  const previewUrl =
    detail.kind === 'creative'
      ? String((fields as any).image_url || (fields as any).thumbnail_url || detail.payload.imageUrl || detail.payload.thumbnailUrl || '')
      : undefined
  const hasValue = (value: unknown) => value !== undefined && value !== null && value !== ''
  const fieldValue = (key: string, fallback?: unknown) => (hasValue((fields as any)?.[key]) ? (fields as any)[key] : fallback)
  const currentStatus = String(form.status || fieldValue('status', (detail.payload as any).status) || fieldValue('effective_status', (detail.payload as any).effective_status) || '')
  const currentEntityId = String(fieldValue('id', detail.payload.id) || detail.payload.id || '')
  const currentObjective = fieldValue('objective', (detail.payload as any).objective) || fieldValue('optimization_goal', (detail.payload as any).optimization_goal)
  const currentBuyingType = fieldValue('buying_type')
  const currentBidStrategy = fieldValue('bid_strategy', (detail.payload as any).bid_strategy)
  const currentBillingEvent = fieldValue('billing_event')
  const currentTitle = detail.kind === 'creative' ? getMetaAdsCreativeDisplayName(detail.payload) : detail.title
  const currentEditableTitle = Object.prototype.hasOwnProperty.call(form, 'name')
    ? form.name
    : String(fieldValue('name', currentTitle) || currentTitle)
  const campaignAdSetTotal = detail.kind === 'campaign'
    ? ((detail.payload as MetaCampaignRow).totals?.adSets ?? (detail.payload as MetaCampaignRow).adSets?.length)
    : null
  const campaignAdTotal = detail.kind === 'campaign' ? (detail.payload as MetaCampaignRow).totals?.ads : null
  const adSetParentCampaignLabel =
    detail.kind === 'adset'
      ? String((fields as any)?.campaign?.name || (detail.payload as MetaAdSet).campaign_name || (detail.payload as MetaAdSet).campaign_id || '')
      : ''
  const adSetAssociatedAdsTotal =
    detail.kind === 'adset'
      ? ((detail.payload as MetaAdSet).ads_count ?? (detail.payload as MetaAdSet).ads?.length)
      : null
  const adParentCampaignLabel =
    detail.kind === 'ad'
      ? String((fields as any)?.campaign?.name || (detail.payload as MetaAd).campaign_name || (detail.payload as MetaAd).campaign_id || '')
      : ''
  const adParentAdSetLabel =
    detail.kind === 'ad'
      ? String((fields as any)?.adset?.name || (detail.payload as MetaAd).adset_name || (detail.payload as MetaAd).adset_id || '')
      : ''
  const adLinkedCreatives =
    detail.kind === 'ad'
      ? resolveMetaAdsAdCreatives({ ad: detail.payload as MetaAd, fields, creatives })
      : []
  const creativeParentCampaignLabel =
    detail.kind === 'creative'
      ? String((detail.payload as MetaCreativeInventoryItem).campaignName || (detail.payload as MetaCreativeInventoryItem).campaignId || '')
      : ''
  const creativeParentAdSetLabel =
    detail.kind === 'creative'
      ? String((detail.payload as MetaCreativeInventoryItem).adSetName || (detail.payload as MetaCreativeInventoryItem).adSetId || '')
      : ''
  const creativeParentAdLabel =
    detail.kind === 'creative'
      ? String((detail.payload as MetaCreativeInventoryItem).adName || (detail.payload as MetaCreativeInventoryItem).adId || '')
      : ''
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
      ...(!liveEntity
        ? [
            {
              title: 'Orçamento configurado',
              fields: [
                { label: 'Orçamento diário', value: fieldValue('daily_budget', payload.daily_budget) },
                { label: 'Orçamento vitalício', value: fieldValue('lifetime_budget', payload.lifetime_budget) },
              ],
            },
          ]
        : []),
    ])
  } else if (detail.kind === 'adset') {
    const payload = detail.payload
    sections = filterSections([
      ...(!liveEntity
        ? [
            {
              title: 'Orçamento configurado',
              fields: [
                { label: 'Orçamento diário', value: fieldValue('daily_budget', payload.daily_budget) },
                { label: 'Orçamento vitalício', value: fieldValue('lifetime_budget', payload.lifetime_budget) },
              ],
            },
          ]
        : []),
    ])
  } else if (detail.kind === 'ad') {
    sections = []
  } else {
    sections = []
  }

  const editableFields = liveEntity?.editableFields || []
  const visibleEditableFields = editableFields.filter((field) => !['bid_strategy', 'optimization_goal', 'name', 'status'].includes(field))
  const hasVisibleEditableFields = visibleEditableFields.length > 0
  const canEdit = Boolean(liveEntity?.editable && editableFields.length)
  const editablePanelTitle =
    detail.kind === 'campaign'
      ? 'Ajustes da campanha'
      : detail.kind === 'adset'
        ? 'Ajustes do conjunto'
        : detail.kind === 'ad'
          ? 'Ajustes do anúncio'
          : 'Ajustes disponíveis'
  const editablePanelDescription = 'Altere os dados disponíveis abaixo. As mudanças só entram em vigor quando você clicar em Salvar.'
  const changedFields = editableFields.filter((field) => {
    const previous = formatMetaAdsEditableValue(field, (liveEntity?.fields as any)?.[field])
    const next = String(form[field] ?? '')
    return next !== previous
  })
  const hasChanges = changedFields.length > 0
  const setFormField = (field: string, value: string) => setForm((current) => ({ ...current, [field]: value }))
  const handleSave = async () => {
    if (!detail || !hasChanges) return
    const changedPatch = changedFields.reduce((patch, field) => {
      const parsed = parseMetaAdsEditableValue(field, String(form[field] ?? ''), (liveEntity?.fields as any)?.[field])
      if (parsed === null) {
        ;(patch as any).__invalidField = field
        return patch
      }
      ;(patch as Record<string, string>)[field] = parsed
      return patch
    }, {} as MetaAdsEntityPatch & { __invalidField?: string })
    if (changedPatch.__invalidField) {
      toast.error(`Use DD/MM/AA, HH:mm no campo ${getMetaAdsLiveFieldLabel(changedPatch.__invalidField)}.`)
      return
    }
    delete changedPatch.__invalidField
    const sensitive = Object.keys(changedPatch).some((field) => field === 'status' || field.includes('budget'))
    if (sensitive && !window.confirm('Confirmar alteração no Gerenciador de Anúncios da Meta? A mudança será aplicada na conta selecionada.')) {
      return
    }
    setSaving(true)
    try {
      const response = await metaAdsApi.updateEntity(detail.kind, detail.payload.id, changedPatch)
      setLiveEntity(response.entity)
      const nextForm: Record<string, string> = {}
      for (const field of response.entity.editableFields || []) {
        const value = response.entity.fields?.[field]
        if (value !== undefined && value !== null) nextForm[field] = formatMetaAdsEditableValue(field, value)
      }
      setForm(nextForm)
      toast.success('Alteração enviada para o Gerenciador de Anúncios')
      await onEntityUpdated?.()
    } catch (error: any) {
      toast.error(error?.message || 'Falha ao atualizar item na Meta')
    } finally {
      setSaving(false)
    }
  }

  return (
    <EntityDetailModal
      open={open}
      onOpenChange={onOpenChange}
      title={
        canEdit && editableFields.includes('name') && detail.kind !== 'creative' ? (
          <MetaAdsEditableTitleInput
            value={currentEditableTitle}
            onChange={(value) => setFormField('name', value)}
            disabled={saving || loadingDetail}
            label={
              detail.kind === 'campaign'
                ? 'Nome da campanha'
                : detail.kind === 'adset'
                  ? 'Nome do conjunto'
                  : 'Nome do anúncio'
            }
          />
        ) : (
          currentTitle
        )
      }
      description={
        detail.kind === 'campaign'
          ? 'Configuração consolidada da campanha selecionada.'
          : detail.kind === 'adset'
            ? 'Configuração consolidada do conjunto de anúncios selecionado.'
            : detail.kind === 'ad'
              ? 'Configuração consolidada do anúncio selecionado.'
              : 'Configuração consolidada do criativo selecionado.'
      }
      titleMeta={
        currentEntityId || adSetParentCampaignLabel || adParentCampaignLabel || adParentAdSetLabel ? (
          <div className="flex flex-wrap items-center gap-2">
            {detail.kind === 'adset' ? (
              <MetaAdsTitleMetaBadge kind="campaign" label="Campanha pai" value={adSetParentCampaignLabel} />
            ) : null}
            {detail.kind === 'ad' ? (
              <>
                <MetaAdsTitleMetaBadge kind="campaign" label="Campanha pai" value={adParentCampaignLabel} />
                <MetaAdsTitleMetaBadge kind="adset" label="Conjunto de anúncios pai" value={adParentAdSetLabel} />
              </>
            ) : null}
            {currentEntityId ? (
              <span className="inline-flex rounded-full border border-slate-700 bg-slate-900/70 px-3 py-1 text-xs font-mono text-slate-300">
                ID {currentEntityId}
              </span>
            ) : null}
          </div>
        ) : null
      }
      previewUrl={previewUrl}
      closeIcon={hasBackTarget ? <span aria-hidden="true">↩</span> : undefined}
      closeLabel={hasBackTarget ? 'Voltar' : 'Close'}
      headerAccessory={
        <div className="flex flex-wrap items-center gap-2 sm:justify-end">
          {detail.kind === 'creative' ? (
            <>
              <MetaAdsModalHeaderIcon
                icon={<MetaAdsEntityGlyph kind="campaign" className="h-4 w-4" />}
                label="Campanha pai"
                description={creativeParentCampaignLabel}
                value={creativeParentCampaignLabel}
              />
              <MetaAdsModalHeaderIcon
                icon={<MetaAdsEntityGlyph kind="adset" className="h-4 w-4" />}
                label="Conjunto de anúncios pai"
                description={creativeParentAdSetLabel}
                value={creativeParentAdSetLabel}
              />
              <MetaAdsModalHeaderIcon
                icon={<MetaAdsEntityGlyph kind="ad" className="h-4 w-4" />}
                label="Anúncio pai"
                description={creativeParentAdLabel}
                value={creativeParentAdLabel}
              />
            </>
          ) : null}
          {detail.kind !== 'creative' && editableFields.includes('status') ? (
            <TooltipLabel label="Status" description="Ative ou pause este item. A mudança só entra em vigor ao salvar.">
              <label className="inline-flex items-center rounded-full border border-slate-700 bg-slate-900/70 px-2.5 py-2 text-xs text-slate-200" aria-label="Status">
                <Switch
                  checked={metaAdsStatusToBoolean(currentStatus)}
                  onCheckedChange={(checked) => setFormField('status', metaAdsStatusFromBoolean(checked))}
                  disabled={saving || loadingDetail || !canEdit}
                  className="data-[state=checked]:!bg-emerald-500 data-[state=unchecked]:!bg-slate-700"
                />
              </label>
            </TooltipLabel>
          ) : detail.kind !== 'creative' && currentStatus ? (
            <TooltipLabel label="Status" description="Status atual deste item.">
              <span>
                <MetaAdsStatusIcon status={currentStatus} />
              </span>
            </TooltipLabel>
          ) : null}
          {detail.kind === 'campaign' ? (
            <>
              <MetaAdsModalHeaderStat
                icon={<MetaAdsEntityGlyph kind="adset" className="h-4 w-4" />}
                label="Conjuntos"
                description={formatMetaAdsCountDescription(campaignAdSetTotal, 'conjunto vinculado', 'conjuntos vinculados', 'à campanha')}
                value={campaignAdSetTotal}
              />
              <MetaAdsModalHeaderStat
                icon={<MetaAdsEntityGlyph kind="ad" className="h-4 w-4" />}
                label="Anúncios"
                description={formatMetaAdsCountDescription(campaignAdTotal, 'anúncio vinculado', 'anúncios vinculados', 'à campanha')}
                value={campaignAdTotal}
              />
            </>
          ) : null}
          {detail.kind === 'adset' ? (
            <MetaAdsModalHeaderStat
              icon={<MetaAdsEntityGlyph kind="ad" className="h-4 w-4" />}
              label="Anúncios"
              description={formatMetaAdsCountDescription(adSetAssociatedAdsTotal, 'anúncio neste conjunto', 'anúncios neste conjunto', '')}
              value={adSetAssociatedAdsTotal}
            />
          ) : null}
          <MetaAdsModalHeaderIcon
            icon={<MetaAdsBidStrategyGlyph value={currentBidStrategy} />}
            label="Estratégia de lance"
            description={
              <MetaAdsHeaderTooltipDescription
                value={formatMetaAdsEnumLabel(currentBidStrategy)}
                description={describeMetaAdsHeaderValue('bid_strategy', currentBidStrategy)}
              />
            }
            value={currentBidStrategy}
          />
          <MetaAdsModalHeaderIcon
            icon={<MetaAdsObjectiveSignalGlyph value={currentObjective} />}
            label={detail.kind === 'adset' ? 'Meta de otimização' : 'Objetivo'}
            description={
              <MetaAdsHeaderTooltipDescription
                value={formatMetaAdsEnumLabel(currentObjective)}
                description={describeMetaAdsHeaderValue(detail.kind === 'adset' ? 'optimization_goal' : 'objective', currentObjective)}
              />
            }
            value={currentObjective}
          />
          <MetaAdsModalHeaderIcon
            icon={<MetaAdsBuyingTypeGlyph value={currentBuyingType} />}
            label="Tipo de compra"
            description={
              <MetaAdsHeaderTooltipDescription
                value={formatMetaAdsEnumLabel(currentBuyingType)}
                description={describeMetaAdsHeaderValue('buying_type', currentBuyingType)}
              />
            }
            value={currentBuyingType}
          />
          {detail.kind === 'adset' ? (
            <MetaAdsModalHeaderIcon
              icon={<MetaAdsBillingEventGlyph value={currentBillingEvent} />}
              label="Evento de cobrança"
              description={
                <MetaAdsHeaderTooltipDescription
                  value={formatMetaAdsEnumLabel(currentBillingEvent)}
                  description={describeMetaAdsHeaderValue('billing_event', currentBillingEvent)}
                />
              }
              value={currentBillingEvent}
            />
          ) : null}
        </div>
      }
      sections={sections}
      footer={
        <div className="flex w-full flex-col gap-2 sm:flex-row sm:justify-end">
          <Button
            type="button"
            variant="outline"
            className="border-slate-700 bg-slate-900/60 text-slate-100 hover:bg-slate-800/80"
            onClick={() => onOpenChange(false)}
            disabled={saving}
          >
            {hasBackTarget ? 'Voltar' : 'Fechar'}
          </Button>
          {canEdit ? (
            <Button
              type="button"
              className="bg-sky-500 text-slate-950 hover:bg-sky-400"
              onClick={handleSave}
              disabled={!hasChanges || saving || loadingDetail}
            >
              {saving ? 'Salvando...' : 'Salvar'}
            </Button>
          ) : null}
        </div>
      }
    >
      {loadingDetail || detailError ? (
        <div className="flex items-center gap-3 rounded-2xl border border-slate-800/80 bg-slate-900/45 p-4 text-sm text-slate-300">
          {loadingDetail ? <Spinner className="h-4 w-4 animate-spin text-sky-300" /> : <WarningCircle className="h-4 w-4 text-amber-300" />}
          <span>{loadingDetail ? 'Carregando dados atualizados.' : detailError}</span>
        </div>
      ) : null}

      {detail.kind === 'ad' && adLinkedCreatives.length ? (
        <div className="grid gap-3">
          {adLinkedCreatives.map((creative) => (
            <MetaAdsAdCreativeDetails key={creative.id} creative={creative} />
          ))}
        </div>
      ) : null}

      {canEdit && hasVisibleEditableFields ? (
        <div className="space-y-3 rounded-2xl border border-sky-500/20 bg-sky-500/5 p-4">
          <div>
            <div className="text-sm font-medium text-white">{editablePanelTitle}</div>
            <div className="text-xs text-slate-400">{editablePanelDescription}</div>
          </div>
          <div className="grid gap-3 md:grid-cols-2">
            {visibleEditableFields.includes('name') ? (
              <label className="space-y-1 text-xs text-slate-300">
                Nome
                <Input value={form.name || ''} onChange={(event) => setFormField('name', event.target.value)} className="h-10 border-slate-700 bg-slate-950/70 text-slate-100" />
              </label>
            ) : null}
            {(['daily_budget', 'lifetime_budget', 'start_time', 'stop_time', 'end_time'] as const).map((field) =>
              visibleEditableFields.includes(field) ? (
                <label key={field} className="space-y-1 text-xs text-slate-300">
                  {{
                    daily_budget: 'Orçamento diário',
                    lifetime_budget: 'Orçamento vitalício',
                    start_time: 'Início',
                    stop_time: 'Fim da campanha',
                    end_time: 'Fim do conjunto',
                  }[field]}
                  {META_ADS_EDITABLE_DATE_FIELDS.has(field) ? (
                    <MetaAdsDateTimePickerInput
                      value={form[field] || ''}
                      previousValue={(liveEntity?.fields as any)?.[field]}
                      onChange={(next) => setFormField(field, next)}
                      label={getMetaAdsLiveFieldLabel(field)}
                      disabled={saving || loadingDetail}
                    />
                  ) : (
                    <MetaAdsBudgetStepperInput
                      value={form[field] || ''}
                      onChange={(next) => setFormField(field, next)}
                      disabled={saving || loadingDetail}
                    />
                  )}
                </label>
              ) : null,
            )}
          </div>
        </div>
      ) : null}
    </EntityDetailModal>
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
  loading,
  syncing,
}: {
  selectedAccount: MetaAdAccount
  summary: MetaAdsSummaryResponse | null
  trend: MetaAdsTrendPoint[]
  report: MetaAdsReportResponse | null
  overviewError: MetaAdsApiError | null
  onRetry?: () => void
  loading?: boolean
  syncing?: boolean
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
        label: 'Clique / Link',
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
        tooltipLabel: 'CTR / CTRL',
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
        tooltipLabel: 'CPC / CPCL',
        description: 'Custo por clique geral e custo por clique em link.',
        subtitle: 'Custo por clique',
        value: (
          <MetaAdsDualMetricCell
            primary={cpc}
            secondary={reportTotals.hasLinkClicks ? linkCpc : null}
            kind="currency"
            currency={selectedAccount.currency || 'USD'}
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
  const overviewTiles = useMemo(
    () => [
      ...metricTiles,
      {
        key: 'trend' as const,
        label: 'Tendência de gasto',
        tooltipLabel: 'Tendência de gasto',
        description: 'Histórico visual do investimento da conta no período selecionado.',
      },
    ],
    [metricTiles],
  )

  const visibleMetricTiles = useMemo(() => {
    const byKey = new Map(overviewTiles.map((tile) => [tile.key, tile]))
    return metricLayout
      .map((config) => {
        const tile = byKey.get(config.key)
        if (!tile || !config.visible) return null
        return { ...tile, width: config.width, height: config.height }
      })
      .filter(Boolean) as Array<(typeof overviewTiles)[number] & { width: number; height: number }>
  }, [metricLayout, overviewTiles])

  const hiddenMetricTiles = useMemo(() => {
    const byKey = new Map(overviewTiles.map((tile) => [tile.key, tile]))
    return metricLayout
      .filter((config) => !config.visible)
      .map((config) => byKey.get(config.key))
      .filter(Boolean) as typeof overviewTiles
  }, [metricLayout, overviewTiles])

  const updateMetricTile = (key: MetaAdsOverviewMetricKey, patch: Partial<MetaAdsOverviewMetricLayout>) => {
    setMetricLayout((prev) => prev.map((item) => (item.key === key ? { ...item, ...patch } : item)))
  }

  const handleMetricDragEnd = (result: DropResult) => {
    if (!result.destination || result.destination.droppableId !== 'meta-ads-overview-metrics') return
    if (result.source.index === result.destination.index) return
    const visibleKeys = metricLayout.filter((item) => item.visible).map((item) => item.key)
    const movedKey = visibleKeys[result.source.index]
    if (!movedKey) return

    setMetricLayout((prev) => {
      const next = [...prev]
      const sourceIndex = next.findIndex((item) => item.key === movedKey)
      if (sourceIndex < 0) return prev
      const [entry] = next.splice(sourceIndex, 1)
      const visibleAfterRemoval = next.filter((item) => item.visible)
      const beforeKey = visibleAfterRemoval[result.destination?.index ?? 0]?.key
      const destinationIndex = beforeKey ? next.findIndex((item) => item.key === beforeKey) : next.length
      next.splice(destinationIndex < 0 ? next.length : destinationIndex, 0, entry)
      return next
    })
  }
  const hasOverviewData = Boolean(primarySummary || trend.length || report)

  if (loading && !hasOverviewData) {
    return (
      <>
        <MetaAdsPersistentError error={overviewError} onRetry={onRetry} />
        <MetaAdsLoadingCard label="Sincronizando resumo da conta Meta Ads" />
      </>
    )
  }

  return (
    <>
      <MetaAdsPersistentError error={overviewError} onRetry={onRetry} />
      {hiddenMetricTiles.length > 0 ? (
        <div className="flex flex-wrap items-center justify-end gap-2">
          <span className="text-[11px] uppercase tracking-[0.16em] text-slate-500">Ocultas</span>
          {hiddenMetricTiles.map((tile) => (
            <Button
              key={tile.key}
              type="button"
              variant="ghost"
              size="sm"
              className="h-7 rounded-full border border-slate-800 bg-slate-900/55 px-2 text-[11px] text-slate-300 hover:border-sky-400/35 hover:bg-slate-800/80 hover:text-white"
              onClick={() => updateMetricTile(tile.key, { visible: true })}
            >
              + {tile.label}
            </Button>
          ))}
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-7 px-2 text-[11px] text-slate-400 hover:bg-slate-800/80 hover:text-white"
            onClick={() => setMetricLayout(DEFAULT_META_ADS_OVERVIEW_METRIC_LAYOUT)}
          >
            Restaurar padrão
          </Button>
        </div>
      ) : null}
      <DragDropContext onDragEnd={handleMetricDragEnd}>
        <Droppable droppableId="meta-ads-overview-metrics" direction="horizontal">
          {(dropProvided) => (
            <div
              ref={dropProvided.innerRef}
              {...dropProvided.droppableProps}
              className="relative flex flex-wrap items-stretch gap-2"
            >
              <MetaAdsSyncOverlay show={syncing && hasOverviewData} label="Atualizando métricas" />
              {visibleMetricTiles.length > 0 ? (
                visibleMetricTiles.map((tile, index) => (
                  <Draggable key={tile.key} draggableId={`meta-ads-metric-${tile.key}`} index={index}>
                    {(dragProvided, snapshot) => (
                      <div
                        ref={dragProvided.innerRef}
                        {...dragProvided.draggableProps}
                        className={`min-w-0 flex-none ${snapshot.isDragging ? 'z-30' : ''}`}
                        style={
                          {
                            ...dragProvided.draggableProps.style,
                            width: `min(${tile.width}px, 100%)`,
                            height: tile.height,
                          } as CSSProperties
                        }
                      >
                        {tile.key === 'trend' ? (
                          <MetaAdsTrendWidget
                            trend={trend}
                            currency={selectedAccount.currency || 'USD'}
                            syncing={syncing}
                            width={tile.width}
                            height={tile.height}
                            dragHandleProps={dragProvided.dragHandleProps}
                            onHide={() => updateMetricTile(tile.key, { visible: false })}
                            onResize={(dimensions) => updateMetricTile(tile.key, dimensions)}
                          />
                        ) : (
                          <MetaAdsMetricTile
                            label={tile.label}
                            tooltipLabel={tile.tooltipLabel}
                            description={tile.description}
                            subtitle={tile.subtitle}
                            value={tile.value}
                            icon={tile.icon}
                            toneClass={tile.toneClass}
                            width={tile.width}
                            height={tile.height}
                            dragHandleProps={dragProvided.dragHandleProps}
                            onHide={() => updateMetricTile(tile.key, { visible: false })}
                            onResize={(dimensions) => updateMetricTile(tile.key, dimensions)}
                          />
                        )}
                      </div>
                    )}
                  </Draggable>
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
              {dropProvided.placeholder}
            </div>
          )}
        </Droppable>
      </DragDropContext>
    </>
  )
}

export function MetaAdsInventoryPanel({
  selectedAccount,
  inventory,
  report,
  inventoryError,
  onRetry,
  onEntityUpdated,
  loading,
  syncing,
}: {
  selectedAccount: MetaAdAccount
  inventory: MetaAdsInventory
  report: MetaAdsReportResponse | null
  inventoryError: MetaAdsApiError | null
  onRetry?: () => void
  onEntityUpdated?: () => void | Promise<void>
  loading?: boolean
  syncing?: boolean
}) {
  const [detail, setDetail] = useState<MetaAdsEntityDetail | null>(null)
  const [collapsedCampaignIds, setCollapsedCampaignIds] = useState<string[]>([])
  const [collapsedAdSetIds, setCollapsedAdSetIds] = useState<string[]>([])
  const [sortKey, setSortKey] = useState<MetaAdsInventorySortKey>('rank')
  const [sortDir, setSortDir] = useState<MetaAdsInventorySortDir>('asc')
  const [columnWidths, setColumnWidths] = useState<Record<MetaAdsInventoryColumnKey, number>>(() => {
    try {
      return parseMetaAdsInventoryColumnWidths(window.localStorage.getItem(META_ADS_INVENTORY_COLUMN_WIDTHS_KEY))
    } catch {
      return getDefaultMetaAdsInventoryColumnWidths()
    }
  })
  const columnResizeRef = useRef<{ key: MetaAdsInventoryColumnKey; startX: number; startWidth: number } | null>(null)
  const currency = selectedAccount.currency || 'USD'
  const openEntityDetail = useCallback((nextDetail: MetaAdsEntityDetail) => {
    setDetail(nextDetail)
  }, [])
  const handleDetailOpenChange = useCallback((open: boolean) => {
    if (open) return
    setDetail(null)
  }, [])

  useEffect(() => {
    try {
      window.localStorage.setItem(META_ADS_INVENTORY_COLUMN_WIDTHS_KEY, JSON.stringify(columnWidths))
    } catch {
      // Column sizing is a preference; ignore storage failures.
    }
  }, [columnWidths])

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

  const rowClass = (level: InventoryTreeRow['level']) => {
    const base = 'border-slate-800/80 transition'
    if (level === 'campaign') return `${base} bg-sky-500/[0.045] hover:bg-sky-500/[0.09]`
    if (level === 'adset') return `${base} bg-fuchsia-500/[0.04] hover:bg-fuchsia-500/[0.085]`
    return `${base} bg-amber-500/[0.035] hover:bg-amber-500/[0.08]`
  }

  const itemButtonClass = 'min-w-0 truncate text-left transition hover:text-sky-200'
  const campaignItemClass = `${itemButtonClass} text-[15px] font-semibold tracking-[0.01em] text-white`
  const adSetItemClass = `${itemButtonClass} text-sm font-medium italic text-fuchsia-50`
  const adItemClass = `${itemButtonClass} text-[13px] font-normal text-amber-50/90`
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
  const inventoryTableWidth = useMemo(
    () => META_ADS_INVENTORY_COLUMN_ORDER.reduce((sum, key) => sum + columnWidths[key], 0),
    [columnWidths],
  )

  const handleColumnResizeStart = (key: MetaAdsInventoryColumnKey, event: PointerEvent<HTMLButtonElement>) => {
    event.preventDefault()
    event.stopPropagation()
    columnResizeRef.current = { key, startX: event.clientX, startWidth: columnWidths[key] }
    event.currentTarget.setPointerCapture?.(event.pointerId)
  }

  const handleColumnResizeMove = (event: PointerEvent<HTMLButtonElement>) => {
    const state = columnResizeRef.current
    if (!state) return
    event.preventDefault()
    const nextWidth = clampMetaAdsInventoryColumnWidth(state.key, state.startWidth + event.clientX - state.startX)
    setColumnWidths((current) => (current[state.key] === nextWidth ? current : { ...current, [state.key]: nextWidth }))
  }

  const handleColumnResizeEnd = (event: PointerEvent<HTMLButtonElement>) => {
    if (!columnResizeRef.current) return
    event.preventDefault()
    event.stopPropagation()
    columnResizeRef.current = null
  }

  const renderUnavailableMetricCell = () => (
    <MetaAdsTableTooltip
      label="Métrica indisponível"
      description="A fonte consolidada atual ainda não entrega esse valor neste nível da hierarquia."
    >
      <span className="text-slate-500">—</span>
    </MetaAdsTableTooltip>
  )

  const columnHelp: Partial<Record<MetaAdsInventoryColumnKey, { label: string; description?: string }>> = {
    item: { label: 'Item', description: 'Nome da campanha, conjunto ou anúncio.' },
    rank: { label: 'Rank', description: 'Posição relativa pelo consolidado do período.' },
    status: { label: 'Status', description: 'Situação operacional atual do item na Meta.' },
    objective: { label: 'Objetivo', description: 'Objetivo principal de entrega e otimização.' },
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

  const renderSortHead = (key: MetaAdsInventoryColumnKey, label: string) => {
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

  const renderResizableHead = (key: MetaAdsInventoryColumnKey, label: string, className = 'text-center') => (
    <TableHead
      data-testid={`meta-ads-inventory-head-${key}`}
      className={`sticky top-0 z-30 border-b border-slate-800 bg-slate-950/95 px-2 backdrop-blur-md ${className}`}
      style={{
        width: columnWidths[key],
        minWidth: columnWidths[key],
        maxWidth: columnWidths[key],
      }}
    >
      <div className={`relative flex h-10 items-center ${className.includes('text-left') ? 'justify-start' : 'justify-center'}`}>
        {renderSortHead(key, label)}
        <button
          type="button"
          data-testid={`meta-ads-column-resize-${key}`}
          aria-label={`Ajustar largura da coluna ${columnHelp[key]?.label || label}`}
          className="absolute -right-2 top-1/2 h-7 w-3 -translate-y-1/2 cursor-col-resize rounded-full border border-transparent transition hover:border-sky-400/35 hover:bg-sky-400/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-400/45"
          onPointerDown={(event) => handleColumnResizeStart(key, event)}
          onPointerMove={handleColumnResizeMove}
          onPointerUp={handleColumnResizeEnd}
          onPointerCancel={handleColumnResizeEnd}
          onClick={(event) => {
            event.preventDefault()
            event.stopPropagation()
          }}
        >
          <span className="mx-auto block h-4 w-px rounded-full bg-slate-500/55" aria-hidden="true" />
        </button>
      </div>
    </TableHead>
  )

  return (
    <>
      <MetaAdsPersistentError error={inventoryError} onRetry={onRetry} />
      {loading && !inventoryTreeRows.length ? <MetaAdsLoadingCard label="Sincronizando mapa da conta Meta" /> : null}
      <MetaAdsEntityDetailDialog
        detail={detail}
        open={Boolean(detail)}
        onOpenChange={handleDetailOpenChange}
        onEntityUpdated={onEntityUpdated}
        creatives={inventory.creatives}
      />
      <Card className={`${panelClass} relative overflow-hidden`}>
        <MetaAdsSyncOverlay show={syncing && inventoryTreeRows.length > 0} label="Atualizando mapa da conta" />
        <CardHeader>
          <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
            <div>
              <CardTitle className="flex items-center gap-2">
                <TreeStructure className="h-5 w-5 text-sky-300" />
                Mapa da conta Meta
              </CardTitle>
              <CardDescription className="text-slate-300">
                Hierarquia navegável de campanhas, conjuntos de anúncios e anúncios. Use a seta à esquerda para expandir ou compactar sem perder as métricas operacionais.
              </CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent className="px-6 pb-6">
          <div className="overflow-hidden rounded-2xl border border-slate-800/75 bg-slate-950/20 shadow-inner">
            <div
              data-testid="meta-ads-inventory-scroll"
              className="max-h-[min(62vh,36rem)] overflow-auto scrollbar-thin scrollbar-thumb-slate-700/70 scrollbar-track-transparent"
              style={{ scrollbarGutter: 'stable both-edges' }}
            >
              <table className="caption-bottom table-fixed text-sm" style={{ width: inventoryTableWidth, minWidth: '100%' }}>
              <colgroup>
                {META_ADS_INVENTORY_COLUMN_ORDER.map((key) => (
                  <col key={key} style={{ width: columnWidths[key] }} />
                ))}
              </colgroup>
              <TableHeader>
                <TableRow className="border-slate-800">
                  {renderResizableHead('item', 'Item', 'text-left')}
                  {renderResizableHead('rank', 'Rank')}
                  {renderResizableHead('status', 'Status')}
                  {renderResizableHead('objective', 'Objetivo')}
                  {renderResizableHead('items', 'Itens')}
                  {renderResizableHead('spend', 'Invest.')}
                  {renderResizableHead('conversations', 'Conversa')}
                  {renderResizableHead('cpcv', 'CPCv')}
                  {renderResizableHead('clicks', 'Clique')}
                  {renderResizableHead('reach', 'Alcance')}
                  {renderResizableHead('impressions', 'Impressão')}
                  {renderResizableHead('engagement', 'Engaj.')}
                  {renderResizableHead('igRedirect', 'Redirecionamento')}
                  {renderResizableHead('ctr', 'CTR/CTRL')}
                  {renderResizableHead('cpc', 'CPC/CPCL')}
                  {renderResizableHead('cpm', 'CPM')}
                  {renderResizableHead('cpp', 'CPP')}
                  {renderResizableHead('frequency', 'Frequência')}
                  {renderResizableHead('cul', 'CU/CUL')}
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
                    <TableRow key={row.key} className={rowClass(row.level)}>
                      <TableCell>
                        <div className="space-y-1">
                          <div className="grid grid-cols-[1.75rem_1.75rem_minmax(0,1fr)] items-center gap-2">
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
                            <button type="button" className={campaignItemClass} onClick={() => openEntityDetail({ kind: 'campaign', title: campaign.name || campaign.id, payload: campaign })}>
                              {campaign.name || campaign.id}
                            </button>
                          </div>
                          <div className="pl-[4.375rem] font-mono text-xs text-blue-100/60">{campaign.id}</div>
                        </div>
                      </TableCell>
                      <TableCell className="text-center">
                        <MetaAdsRankBadge rank={campaignRankMap.get(campaign.id)} />
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
                      <TableCell className="text-center">{campaignMetrics ? formatCurrency(campaignMetrics.spend, currency) : renderUnavailableMetricCell()}</TableCell>
                      <TableCell className="text-center">{campaignMetrics ? formatNumber(campaignMetrics.conversations) : renderUnavailableMetricCell()}</TableCell>
                      <TableCell className="text-center">{campaignCostPerConversation !== null ? formatCurrency(campaignCostPerConversation, currency) : renderUnavailableMetricCell()}</TableCell>
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
                            currency={currency}
                          />
                        ) : renderUnavailableMetricCell()}
                      </TableCell>
                      <TableCell className="text-center">{campaignMetrics ? formatCurrency(campaignMetrics.cpm, currency) : renderUnavailableMetricCell()}</TableCell>
                      <TableCell className="text-center">{campaignMetrics?.cpp ? formatCurrency(campaignMetrics.cpp, currency) : renderUnavailableMetricCell()}</TableCell>
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
                    <TableRow key={row.key} className={rowClass(row.level)}>
                      <TableCell>
                        <div className="space-y-1 pl-3">
                          <div className="grid grid-cols-[1.75rem_1.75rem_minmax(0,1fr)] items-center gap-2">
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
                            <button type="button" className={adSetItemClass} onClick={() => openEntityDetail({ kind: 'adset', title: adSet.name || adSet.id, payload: adSet })}>
                              {adSet.name || adSet.id}
                            </button>
                          </div>
                          <div className="pl-[4.375rem] font-mono text-xs text-blue-100/60">{adSet.id}</div>
                        </div>
                      </TableCell>
                      <TableCell className="text-center">
                        <MetaAdsRankBadge rank={adSetRankMap.get(adSet.id)} />
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
                      <TableCell className="text-center">{adSetMetrics ? formatCurrency(adSetMetrics.spend, currency) : renderUnavailableMetricCell()}</TableCell>
                      <TableCell className="text-center">{adSetMetrics ? formatNumber(adSetMetrics.conversations) : renderUnavailableMetricCell()}</TableCell>
                      <TableCell className="text-center">{adSetCostPerConversation !== null ? formatCurrency(adSetCostPerConversation, currency) : renderUnavailableMetricCell()}</TableCell>
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
                            currency={currency}
                          />
                        ) : renderUnavailableMetricCell()}
                      </TableCell>
                      <TableCell className="text-center">{adSetMetrics ? formatCurrency(adSetMetrics.cpm, currency) : renderUnavailableMetricCell()}</TableCell>
                      <TableCell className="text-center">{adSetMetrics?.cpp ? formatCurrency(adSetMetrics.cpp, currency) : renderUnavailableMetricCell()}</TableCell>
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
                  <TableRow key={row.key} className={rowClass(row.level)}>
                    <TableCell>
                      <div className="space-y-1 pl-6">
                        <div className="grid grid-cols-[1.75rem_1.75rem_minmax(0,1fr)] items-center gap-2">
                          <span className="inline-flex h-7 w-7" aria-hidden="true" />
                          <MetaAdsEntityInlineBadge
                            kind="ad"
                            label="Anúncio"
                            toneClass="border-amber-500/20 bg-amber-500/10 text-amber-100"
                          />
                          <button type="button" className={adItemClass} onClick={() => openEntityDetail({ kind: 'ad', title: ad.name || ad.id, payload: ad })}>
                            {ad.name || ad.id}
                          </button>
                        </div>
                        <div className="pl-[4.375rem] font-mono text-xs text-blue-100/60">{ad.id}</div>
                      </div>
                    </TableCell>
                    <TableCell className="text-center">
                      <MetaAdsRankBadge rank={adRankMap.get(ad.id)} />
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
                    <TableCell className="text-center">{adMetrics ? formatCurrency(adMetrics.spend, currency) : renderUnavailableMetricCell()}</TableCell>
                    <TableCell className="text-center">{adMetrics ? formatNumber(adMetrics.conversations) : renderUnavailableMetricCell()}</TableCell>
                    <TableCell className="text-center">{adCostPerConversation !== null ? formatCurrency(adCostPerConversation, currency) : renderUnavailableMetricCell()}</TableCell>
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
                          currency={currency}
                        />
                      ) : renderUnavailableMetricCell()}
                    </TableCell>
                    <TableCell className="text-center">{adMetrics ? formatCurrency(adMetrics.cpm, currency) : renderUnavailableMetricCell()}</TableCell>
                    <TableCell className="text-center">{adMetrics?.cpp ? formatCurrency(adMetrics.cpp, currency) : renderUnavailableMetricCell()}</TableCell>
                    <TableCell className="text-center">{adMetrics?.frequency ? formatNumber(adMetrics.frequency) : renderUnavailableMetricCell()}</TableCell>
                    <TableCell className="text-center">{renderUnavailableMetricCell()}</TableCell>
                  </TableRow>
                )
              })}
            </TableBody>
              </table>
            </div>
          </div>
        </CardContent>
      </Card>
    </>
  )
}
