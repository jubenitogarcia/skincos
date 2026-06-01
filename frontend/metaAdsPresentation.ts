import type { MetaAdCreativeRef } from '@/metaAdsTypes'

export type MetaAdsOverviewMetricKey =
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

export type MetaAdsOverviewMetricSize = 'compact' | 'wide'
export type MetaAdsOverviewMetricAspect = '1:1' | '4:3' | '2:1'
export type MetaAdsOverviewMetricLayout = {
  key: MetaAdsOverviewMetricKey
  visible: boolean
  width: number
  height: number
  aspect: MetaAdsOverviewMetricAspect
}

export type MetaAdsHeaderSignalKind = 'objective' | 'optimization_goal' | 'bid_strategy' | 'buying_type' | 'billing_event'

export type MetaAdsCreativeVariationItem = {
  value: string
  previewUrl?: string | null
  aspectLabel?: string | null
  mediaKind?: 'image' | 'video'
}

export type MetaAdsCreativeVariationGroup = {
  label: string
  values: MetaAdsCreativeVariationItem[]
  kind?: 'text' | 'media'
}

export const META_ADS_OVERVIEW_METRIC_LAYOUT_KEY = 'skincos.metaAds.layout.overviewMetrics.v5'
export const META_ADS_METRIC_TILE_DIMENSIONS = {
  minWidth: 140,
  maxWidth: 680,
  minHeight: 96,
  maxHeight: 520,
  defaultWidth: 224,
  defaultHeight: 168,
  trendWidth: 520,
  trendHeight: 260,
} as const
export const META_ADS_METRIC_ASPECT_RATIOS: Record<MetaAdsOverviewMetricAspect, number> = {
  '1:1': 1,
  '4:3': 4 / 3,
  '2:1': 2,
}
export const META_ADS_METRIC_ASPECT_ORDER: MetaAdsOverviewMetricAspect[] = ['1:1', '4:3', '2:1']
export const DEFAULT_META_ADS_OVERVIEW_METRIC_LAYOUT: MetaAdsOverviewMetricLayout[] = [
  { key: 'spend', visible: true, width: META_ADS_METRIC_TILE_DIMENSIONS.defaultWidth, height: META_ADS_METRIC_TILE_DIMENSIONS.defaultHeight, aspect: '4:3' },
  { key: 'conversations', visible: true, width: META_ADS_METRIC_TILE_DIMENSIONS.defaultWidth, height: META_ADS_METRIC_TILE_DIMENSIONS.defaultHeight, aspect: '4:3' },
  { key: 'cpcv', visible: true, width: META_ADS_METRIC_TILE_DIMENSIONS.defaultWidth, height: META_ADS_METRIC_TILE_DIMENSIONS.defaultHeight, aspect: '4:3' },
  { key: 'clicks', visible: true, width: META_ADS_METRIC_TILE_DIMENSIONS.defaultWidth, height: META_ADS_METRIC_TILE_DIMENSIONS.defaultHeight, aspect: '4:3' },
  { key: 'reach', visible: true, width: META_ADS_METRIC_TILE_DIMENSIONS.defaultWidth, height: META_ADS_METRIC_TILE_DIMENSIONS.defaultHeight, aspect: '4:3' },
  { key: 'impressions', visible: true, width: META_ADS_METRIC_TILE_DIMENSIONS.defaultWidth, height: META_ADS_METRIC_TILE_DIMENSIONS.defaultHeight, aspect: '4:3' },
  { key: 'engagement', visible: true, width: META_ADS_METRIC_TILE_DIMENSIONS.defaultWidth, height: META_ADS_METRIC_TILE_DIMENSIONS.defaultHeight, aspect: '4:3' },
  { key: 'redirect', visible: true, width: META_ADS_METRIC_TILE_DIMENSIONS.defaultWidth, height: META_ADS_METRIC_TILE_DIMENSIONS.defaultHeight, aspect: '4:3' },
  { key: 'ctr', visible: true, width: META_ADS_METRIC_TILE_DIMENSIONS.defaultWidth, height: META_ADS_METRIC_TILE_DIMENSIONS.defaultHeight, aspect: '4:3' },
  { key: 'cpc', visible: true, width: META_ADS_METRIC_TILE_DIMENSIONS.defaultWidth, height: META_ADS_METRIC_TILE_DIMENSIONS.defaultHeight, aspect: '4:3' },
  { key: 'cpm', visible: true, width: META_ADS_METRIC_TILE_DIMENSIONS.defaultWidth, height: META_ADS_METRIC_TILE_DIMENSIONS.defaultHeight, aspect: '4:3' },
  { key: 'cpp', visible: true, width: META_ADS_METRIC_TILE_DIMENSIONS.defaultWidth, height: META_ADS_METRIC_TILE_DIMENSIONS.defaultHeight, aspect: '4:3' },
  { key: 'frequency', visible: true, width: META_ADS_METRIC_TILE_DIMENSIONS.defaultWidth, height: META_ADS_METRIC_TILE_DIMENSIONS.defaultHeight, aspect: '4:3' },
  { key: 'trend', visible: true, width: META_ADS_METRIC_TILE_DIMENSIONS.trendWidth, height: META_ADS_METRIC_TILE_DIMENSIONS.trendHeight, aspect: '2:1' },
]

export function clampMetaAdsMetricDimension(value: unknown, min: number, max: number, fallback: number) {
  const numberValue = Number(value)
  if (!Number.isFinite(numberValue)) return fallback
  return Math.min(max, Math.max(min, Math.round(numberValue)))
}

export function getMetaAdsMetricAspect(value: unknown, width?: unknown, height?: unknown): MetaAdsOverviewMetricAspect {
  if (value === '1:1' || value === '4:3' || value === '2:1') return value
  if (value === '3:4') return '4:3'
  const ratio = Number(width) > 0 && Number(height) > 0 ? Number(width) / Number(height) : META_ADS_METRIC_ASPECT_RATIOS['4:3']
  return META_ADS_METRIC_ASPECT_ORDER.reduce((closest, option) => {
    const closestDelta = Math.abs(META_ADS_METRIC_ASPECT_RATIOS[closest] - ratio)
    const optionDelta = Math.abs(META_ADS_METRIC_ASPECT_RATIOS[option] - ratio)
    return optionDelta < closestDelta ? option : closest
  }, '4:3' as MetaAdsOverviewMetricAspect)
}

export function fitMetaAdsMetricDimensionsToAspect(width: unknown, aspect: MetaAdsOverviewMetricAspect, fallbackHeight: number) {
  const ratio = META_ADS_METRIC_ASPECT_RATIOS[aspect]
  const nextWidth = clampMetaAdsMetricDimension(
    width,
    META_ADS_METRIC_TILE_DIMENSIONS.minWidth,
    META_ADS_METRIC_TILE_DIMENSIONS.maxWidth,
    META_ADS_METRIC_TILE_DIMENSIONS.defaultWidth,
  )
  const nextHeight = clampMetaAdsMetricDimension(
    Math.round(nextWidth / ratio),
    META_ADS_METRIC_TILE_DIMENSIONS.minHeight,
    META_ADS_METRIC_TILE_DIMENSIONS.maxHeight,
    fallbackHeight,
  )
  return { width: Math.round(nextHeight * ratio), height: nextHeight }
}

export function fitMetaAdsMetricBoxToAspect(width: number, height: number, aspect: MetaAdsOverviewMetricAspect) {
  const ratio = META_ADS_METRIC_ASPECT_RATIOS[aspect]
  const byWidthHeight = clampMetaAdsMetricDimension(
    Math.round(width / ratio),
    META_ADS_METRIC_TILE_DIMENSIONS.minHeight,
    META_ADS_METRIC_TILE_DIMENSIONS.maxHeight,
    height,
  )
  const byWidth = {
    width: clampMetaAdsMetricDimension(
      Math.round(byWidthHeight * ratio),
      META_ADS_METRIC_TILE_DIMENSIONS.minWidth,
      META_ADS_METRIC_TILE_DIMENSIONS.maxWidth,
      width,
    ),
    height: byWidthHeight,
  }
  const byHeightWidth = clampMetaAdsMetricDimension(
    Math.round(height * ratio),
    META_ADS_METRIC_TILE_DIMENSIONS.minWidth,
    META_ADS_METRIC_TILE_DIMENSIONS.maxWidth,
    width,
  )
  const byHeight = {
    width: byHeightWidth,
    height: clampMetaAdsMetricDimension(
      Math.round(byHeightWidth / ratio),
      META_ADS_METRIC_TILE_DIMENSIONS.minHeight,
      META_ADS_METRIC_TILE_DIMENSIONS.maxHeight,
      height,
    ),
  }
  const widthDelta = Math.abs(byWidth.width - width) + Math.abs(byWidth.height - height)
  const heightDelta = Math.abs(byHeight.width - width) + Math.abs(byHeight.height - height)
  return widthDelta <= heightDelta ? byWidth : byHeight
}

export function cycleMetaAdsMetricDimensions(
  width: number,
  height: number,
  currentAspect: MetaAdsOverviewMetricAspect,
) {
  const currentIndex = META_ADS_METRIC_ASPECT_ORDER.indexOf(currentAspect)
  const aspect = META_ADS_METRIC_ASPECT_ORDER[(currentIndex + 1) % META_ADS_METRIC_ASPECT_ORDER.length]
  return { ...fitMetaAdsMetricBoxToAspect(width, height, aspect), aspect }
}

export function getDefaultMetaAdsMetricDimensions(key: MetaAdsOverviewMetricKey, legacySize?: MetaAdsOverviewMetricSize) {
  if (key === 'trend') {
    return {
      width: legacySize === 'compact' ? 320 : META_ADS_METRIC_TILE_DIMENSIONS.trendWidth,
      height: legacySize === 'compact' ? 160 : META_ADS_METRIC_TILE_DIMENSIONS.trendHeight,
    }
  }
  return {
    width: legacySize === 'wide' ? 340 : META_ADS_METRIC_TILE_DIMENSIONS.defaultWidth,
    height: legacySize === 'wide' ? 255 : META_ADS_METRIC_TILE_DIMENSIONS.defaultHeight,
  }
}

export function parseMetaAdsOverviewMetricLayout(raw: string | null | undefined): MetaAdsOverviewMetricLayout[] {
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
        const fallback = getDefaultMetaAdsMetricDimensions(key, item?.size === 'wide' ? 'wide' : 'compact')
        const aspect = getMetaAdsMetricAspect(item?.aspect, item?.width, item?.height)
        const dimensions = fitMetaAdsMetricDimensionsToAspect(
          clampMetaAdsMetricDimension(
            item?.width,
            META_ADS_METRIC_TILE_DIMENSIONS.minWidth,
            META_ADS_METRIC_TILE_DIMENSIONS.maxWidth,
            fallback.width,
          ),
          aspect,
          fallback.height,
        )
        return {
          key,
          visible: item?.visible !== false,
          width: dimensions.width,
          height: dimensions.height,
          aspect,
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

export function formatMetaAdsEnumLabel(value?: unknown) {
  const normalized = String(value || '').trim().toUpperCase()
  if (!normalized) return 'Não informado'
  const labels: Record<string, string> = {
    LEADS: 'Geração de Lead',
    LEAD_GENERATION: 'Geração de Lead',
    OUTCOME_LEADS: 'Geração de Leads',
    AUCTION: 'Leilão',
    BUYING_TYPE_AUCTION: 'Leilão',
    MESSAGES: 'Mensagens',
    CONVERSATIONS: 'Conversas',
    ENGAGED_USERS: 'Engajamento',
    LINK_CLICKS: 'Cliques no link',
    OUTBOUND_CLICKS: 'Cliques externos',
    TRAFFIC: 'Tráfego',
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

export function describeMetaAdsHeaderValue(kind: MetaAdsHeaderSignalKind, value?: unknown) {
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

export function collectMetaAdsCreativeValues(values: unknown[], formatter?: (value: string) => string) {
  const seen = new Set<string>()
  const collected: MetaAdsCreativeVariationItem[] = []
  values.flatMap((value) => Array.isArray(value) ? value : [value]).forEach((value) => {
    const extracted = extractMetaAdsCreativeValue(value)
    if (!extracted) return
    const formatted = formatter ? formatter(extracted) : extracted
    const normalized = formatted.toLowerCase()
    if (!formatted || seen.has(normalized)) return
    seen.add(normalized)
    collected.push({ value: formatted })
  })
  return collected
}

export function formatMetaAdsCreativeActionLabel(value: string) {
  return formatMetaAdsEnumLabel(value)
}

function extractMetaAdsCreativeMediaUrl(record: Record<string, unknown> | null) {
  if (!record) return null
  const candidate =
    record.url ||
    record.image_url ||
    record.thumbnail_url ||
    record.permalink_url ||
    record.picture ||
    record.source
  return typeof candidate === 'string' && candidate.trim() ? candidate.trim() : null
}

function getMetaAdsMediaAspectLabel(value: unknown) {
  const record = asMetaAdsRecord(value)
  if (!record) return null
  const width = Number(record.width || record.original_width)
  const height = Number(record.height || record.original_height)
  if (Number.isFinite(width) && Number.isFinite(height) && width > 0 && height > 0) {
    const ratio = width / height
    if (Math.abs(ratio - 1) < 0.08) return '1x1'
    if (Math.abs(ratio - 0.75) < 0.08) return '3x4'
    if (Math.abs(ratio - 4 / 3) < 0.08) return '4x3'
    if (Math.abs(ratio - 2) < 0.12) return '2x1'
    const gcd = (a: number, b: number): number => (b ? gcd(b, a % b) : a)
    const divisor = gcd(Math.round(width), Math.round(height)) || 1
    const simplifiedWidth = Math.round(width / divisor)
    const simplifiedHeight = Math.round(height / divisor)
    if (simplifiedWidth > 0 && simplifiedHeight > 0 && simplifiedWidth <= 9 && simplifiedHeight <= 9) return `${simplifiedWidth}x${simplifiedHeight}`
  }
  const aspect = String(record.aspect_ratio || record.aspect || record.crop || '').trim().toLowerCase()
  if (aspect) {
    if (aspect.includes('1:1') || aspect.includes('1x1') || aspect.includes('square')) return '1x1'
    if (aspect.includes('3:4') || aspect.includes('3x4') || aspect.includes('vertical')) return '3x4'
    if (aspect.includes('4:3') || aspect.includes('4x3')) return '4x3'
    if (aspect.includes('2:1') || aspect.includes('2x1') || aspect.includes('wide')) return '2x1'
  }
  return null
}

export function collectMetaAdsCreativeMediaValues(values: unknown[], fallbackPreview?: string | null) {
  const seen = new Set<string>()
  const collected: MetaAdsCreativeVariationItem[] = []
  values.flatMap((value) => Array.isArray(value) ? value : [value]).forEach((value, index) => {
    const extracted = extractMetaAdsCreativeValue(value)
    if (!extracted) return
    const normalized = extracted.toLowerCase()
    if (seen.has(normalized)) return
    seen.add(normalized)
    const record = asMetaAdsRecord(value)
    const previewUrl = extractMetaAdsCreativeMediaUrl(record) || (index === 0 ? fallbackPreview || null : null)
    collected.push({
      value: extracted,
      previewUrl,
      aspectLabel: getMetaAdsMediaAspectLabel(value),
      mediaKind: record?.video_id || record?.source ? 'video' : 'image',
    })
  })
  return collected
}

export function buildMetaAdsCreativeVariationGroups(raw?: MetaAdCreativeRef, fallbackPreview?: string | null): MetaAdsCreativeVariationGroup[] {
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
      kind: 'media',
      values: collectMetaAdsCreativeMediaValues([
        raw.image_hash,
        raw.video_id,
        assetFeed?.images,
        assetFeed?.videos,
      ], fallbackPreview),
    },
  ]

  return groups.filter((group) => group.values.length > 0)
}
