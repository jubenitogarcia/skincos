import type {
  MetaAdAccount,
  MetaAdsReportResponse,
  MetaAdsApiError,
  MetaAdsEntityDetailResponse,
  MetaAdsEntityPatch,
  MetaAdsEntityType,
  MetaAdsEntityUpdateResponse,
  MetaAdsReportWindowDays,
  MetaAdsStatusResponse,
  MetaAdsSummaryResponse,
  MetaAdsTrendPoint,
  MetaInventoryResponse,
} from '@/metaAdsTypes'
import { buildMetaAdsWorkflowReport } from '@/metaAdsWorkflowReport'

export type MetaAdsLocalScenario =
  | 'live'
  | 'disconnected'
  | 'connected-no-account'
  | 'connected-ready'
  | 'unauthorized'

type MetaAdsLocalState = {
  scenario: Exclude<MetaAdsLocalScenario, 'live' | 'unauthorized'>
  tokenType: 'oauth' | 'manual' | null
  selectedAdAccountId: string | null
  hiddenAdAccountIds: string[]
  updatedAt: string | null
}

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '::1'])
const STORAGE_KEY = 'metaAds.localState.v1'
const ENTITY_PATCH_STORAGE_KEY = 'metaAds.localEntityPatches.v1'
const SCENARIO_QUERY_KEY = 'metaAdsLocalScenario'
const DEFAULT_ACCOUNT_ID = 'act_123'

type LocalEntityPatchMap = Partial<Record<MetaAdsEntityType, Record<string, MetaAdsEntityPatch>>>

function resolveRequestedDays(params?: { since?: string; until?: string }): number {
  const since = params?.since ? new Date(params.since) : null
  const until = params?.until ? new Date(params.until) : null
  if (!since || !until || Number.isNaN(since.getTime()) || Number.isNaN(until.getTime())) return 30
  const diff = Math.round((until.getTime() - since.getTime()) / 86400000) + 1
  return Math.max(1, diff)
}

function resolveWindowDays(params?: { since?: string; until?: string }): MetaAdsReportWindowDays {
  const diff = resolveRequestedDays(params)
  if (diff <= 7) return 7
  if (diff <= 30) return 30
  return 60
}

function resolveWindowLabel(days: number) {
  if (days <= 1) return 'last_24h'
  if (days === 7) return 'last_7d'
  return 'last_30d'
}

function interpolateMetric(days: number, anchors: { d7: number; d30: number; d60: number }) {
  if (days <= 7) return anchors.d7 * (days / 7)
  if (days <= 30) {
    const progress = (days - 7) / (30 - 7)
    return anchors.d7 + (anchors.d30 - anchors.d7) * progress
  }
  if (days <= 60) {
    const progress = (days - 30) / (60 - 30)
    return anchors.d30 + (anchors.d60 - anchors.d30) * progress
  }
  return anchors.d60 * (days / 60)
}

function roundMetric(value: number, digits = 2) {
  const factor = 10 ** digits
  return Math.round(value * factor) / factor
}

function readLocalEntityPatches(): LocalEntityPatchMap {
  try {
    return JSON.parse(window.localStorage.getItem(ENTITY_PATCH_STORAGE_KEY) || '{}') || {}
  } catch {
    return {}
  }
}

function writeLocalEntityPatch(type: MetaAdsEntityType, id: string, patch: MetaAdsEntityPatch) {
  const current = readLocalEntityPatches()
  current[type] = {
    ...(current[type] || {}),
    [id]: {
      ...((current[type] || {})[id] || {}),
      ...patch,
    },
  }
  window.localStorage.setItem(ENTITY_PATCH_STORAGE_KEY, JSON.stringify(current))
}

function applyLocalEntityPatches(inventory: MetaInventoryResponse['inventory']) {
  const patches = readLocalEntityPatches()
  return {
    campaigns: inventory.campaigns.map((campaign) => ({ ...campaign, ...((patches.campaign || {})[campaign.id] || {}) })),
    adSets: inventory.adSets.map((adSet) => ({ ...adSet, ...((patches.adset || {})[adSet.id] || {}) })),
    ads: inventory.ads.map((ad) => ({ ...ad, ...((patches.ad || {})[ad.id] || {}) })),
    creatives: inventory.creatives.map((creative) => ({ ...creative, ...((patches.creative || {})[creative.id] || {}) })),
  }
}

function buildAdaptiveTrend(
  params: { since?: string; until?: string } | undefined,
  totalSpend: number,
  variant: 'default' | 'retargeting',
): MetaAdsTrendPoint[] {
  const days = resolveRequestedDays(params)
  const until = params?.until ? new Date(params.until) : new Date('2026-05-14T12:00:00-03:00')
  const pattern = variant === 'retargeting'
    ? [1.24, 0.82, 0.94, 1.08, 1.12, 0.9, 1.06, 1.18, 0.96, 0.88]
    : [0.92, 1.04, 1.08, 1.02, 1.18, 1.26, 1.11, 0.95, 0.89, 1.07]
  const weights = Array.from({ length: days }, (_, index) => pattern[index % pattern.length])
  const weightTotal = weights.reduce((sum, value) => sum + value, 0) || 1

  return weights.map((weight, index) => {
    const pointDate = new Date(until)
    pointDate.setDate(until.getDate() - (days - 1 - index))
    return {
      day: pointDate.toISOString().slice(0, 10),
      spend: roundMetric((totalSpend * weight) / weightTotal),
    }
  })
}

const ACCOUNT_FIXTURES: MetaAdAccount[] = [
  {
    id: 'act_123',
    name: 'Conta Principal',
    account_status: '1',
    disable_reason: '0',
    currency: 'BRL',
    timezone_name: 'America/Sao_Paulo',
    business_name: 'Skincos',
  },
  {
    id: 'act_456',
    name: 'Conta Captação',
    account_status: '8',
    disable_reason: '3',
    currency: 'BRL',
    timezone_name: 'America/Sao_Paulo',
    business_name: 'Skincos',
  },
]

function canUseLocalStorage() {
  return typeof window !== 'undefined' && LOCAL_HOSTS.has(window.location.hostname)
}

function normalizeScenario(value: unknown): MetaAdsLocalScenario {
  if (value === 'live' || value === 'disconnected' || value === 'connected-no-account' || value === 'connected-ready' || value === 'unauthorized') {
    return value
  }
  return 'live'
}

function buildDefaultState(
  scenario: Exclude<MetaAdsLocalScenario, 'live' | 'unauthorized'> = 'disconnected',
): MetaAdsLocalState {
  return {
    scenario,
    tokenType: scenario === 'disconnected' ? null : 'oauth',
    selectedAdAccountId: scenario === 'connected-ready' ? DEFAULT_ACCOUNT_ID : null,
    hiddenAdAccountIds: [],
    updatedAt: scenario === 'disconnected' ? null : new Date().toISOString(),
  }
}

function readQueryScenario(): MetaAdsLocalScenario | null {
  if (!canUseLocalStorage()) return null
  const params = new URLSearchParams(window.location.search)
  if (!params.has(SCENARIO_QUERY_KEY)) return null
  return normalizeScenario(params.get(SCENARIO_QUERY_KEY))
}

function writeState(next: MetaAdsLocalState | null) {
  if (!canUseLocalStorage()) return
  if (!next) {
    window.localStorage.removeItem(STORAGE_KEY)
    return
  }
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
}

function syncStateFromUrl() {
  if (!canUseLocalStorage()) return
  const scenario = readQueryScenario()
  if (!scenario) return
  if (scenario === 'live') {
    writeState(null)
    return
  }
  if (scenario === 'unauthorized') {
    writeState(buildDefaultState('disconnected'))
    return
  }
  const current = readState(false)
  if (!current || current.scenario !== scenario) {
    writeState(buildDefaultState(scenario))
  }
}

function readState(syncFromUrl = true): MetaAdsLocalState | null {
  if (!canUseLocalStorage()) return null
  if (syncFromUrl) syncStateFromUrl()
  const raw = window.localStorage.getItem(STORAGE_KEY)
  if (!raw) return null
  try {
    const parsed = JSON.parse(raw)
    const scenario = normalizeScenario(parsed?.scenario)
    if (scenario === 'live' || scenario === 'unauthorized') return buildDefaultState('disconnected')
    return {
      scenario,
      tokenType: parsed?.tokenType === 'manual' ? 'manual' : parsed?.tokenType === 'oauth' ? 'oauth' : null,
      selectedAdAccountId: typeof parsed?.selectedAdAccountId === 'string' ? parsed.selectedAdAccountId : null,
      hiddenAdAccountIds: Array.isArray(parsed?.hiddenAdAccountIds)
        ? Array.from(new Set(parsed.hiddenAdAccountIds.map((item: unknown) => String(item || '').trim()).filter(Boolean)))
        : [],
      updatedAt: typeof parsed?.updatedAt === 'string' ? parsed.updatedAt : null,
    }
  } catch {
    return null
  }
}

function buildError(input: {
  code: string
  message: string
  hint?: string
  status?: number
  retryable?: boolean
}): MetaAdsApiError {
  return {
    code: input.code,
    message: input.message,
    hint: input.hint,
    status: input.status,
    retryable: input.retryable ?? false,
  }
}

function connectedUserName(state: MetaAdsLocalState) {
  return state.tokenType === 'manual' ? 'Token administrativo local' : 'Jubenito Garcia'
}

function buildStatus(state: MetaAdsLocalState): MetaAdsStatusResponse {
  const connected = state.scenario !== 'disconnected'
  return {
    ok: true,
    oauthConfigured: true,
    missingConfig: [],
    oauthMode: 'scopes',
    businessLoginConfigId: null,
    connection: {
      connected,
      tokenType: connected ? state.tokenType : null,
      metaUserId: connected ? '42' : null,
      metaUserName: connected ? connectedUserName(state) : null,
      selectedAdAccountId: connected ? state.selectedAdAccountId : null,
      scopes: connected ? ['ads_read', 'ads_management', 'business_management'] : [],
      updatedAt: connected ? state.updatedAt || new Date().toISOString() : null,
      expiresAt: connected ? '2026-12-31T23:59:59.000Z' : null,
    },
  }
}

function buildAccounts(state: MetaAdsLocalState) {
  const hidden = new Set(state.hiddenAdAccountIds)
  return ACCOUNT_FIXTURES.map((account) => ({
    ...account,
    isSelected: account.id === state.selectedAdAccountId,
  })).filter((account) => !hidden.has(account.id))
}

function requireConnectedState(): MetaAdsLocalState {
  const scenario = getLocalScenario()
  if (scenario === 'unauthorized') {
    throw buildError({
      code: 'UNAUTHORIZED',
      status: 401,
      message: 'Faça login no CRM para continuar.',
      hint: 'No modo local do Meta Ads, escolha um cenário conectado para liberar o inventário.',
      retryable: false,
    })
  }
  const state = readState()
  if (!state || state.scenario === 'disconnected') {
    throw buildError({
      code: 'META_ADS_NOT_CONNECTED',
      status: 409,
      message: 'Conecte uma conta Meta Ads antes de continuar.',
      hint: 'Use o fluxo local de conexão para simular OAuth ou token manual.',
      retryable: false,
    })
  }
  return state
}

function requireSelectedAccount(): MetaAdsLocalState {
  const state = requireConnectedState()
  if (!state.selectedAdAccountId) {
    throw buildError({
      code: 'META_ADS_ACCOUNT_REQUIRED',
      status: 409,
      message: 'Escolha uma conta de anúncios para continuar.',
      hint: 'Selecione uma conta local para liberar visão geral e inventário.',
      retryable: false,
    })
  }
  return state
}

export function getLocalScenario(): MetaAdsLocalScenario {
  if (!canUseLocalStorage()) return 'live'
  syncStateFromUrl()
  const queryScenario = readQueryScenario()
  if (queryScenario === 'unauthorized') return 'unauthorized'
  const state = readState(false)
  return state?.scenario || 'live'
}

export function isMetaAdsLocalMockEnabled() {
  const scenario = getLocalScenario()
  return scenario !== 'live'
}

export function isMetaAdsLocalMockConnected() {
  const scenario = getLocalScenario()
  return scenario === 'connected-no-account' || scenario === 'connected-ready'
}

export async function simulateMetaAdsOAuthConnect() {
  if (!canUseLocalStorage()) return
  const current = readState(false)
  writeState({
    scenario: 'connected-no-account',
    tokenType: 'oauth',
    selectedAdAccountId: null,
    hiddenAdAccountIds: current?.hiddenAdAccountIds || [],
    updatedAt: new Date().toISOString(),
  })
}

export async function connectMetaAdsManualLocal() {
  if (!canUseLocalStorage()) return
  const current = readState(false)
  writeState({
    scenario: 'connected-no-account',
    tokenType: 'manual',
    selectedAdAccountId: null,
    hiddenAdAccountIds: current?.hiddenAdAccountIds || [],
    updatedAt: new Date().toISOString(),
  })
}

export async function disconnectMetaAdsLocal() {
  if (!canUseLocalStorage()) return
  writeState(buildDefaultState('disconnected'))
}

export async function selectMetaAdsLocalAccount(adAccountId: string) {
  const account = ACCOUNT_FIXTURES.find((item) => item.id === adAccountId)
  if (!account) {
    throw buildError({
      code: 'META_ADS_ACCOUNT_NOT_FOUND',
      status: 404,
      message: 'A conta solicitada não existe no cenário local.',
      hint: 'Escolha uma das contas simuladas exibidas na tela.',
      retryable: false,
    })
  }
  const current = readState() || buildDefaultState('connected-no-account')
  writeState({
    scenario: 'connected-ready',
    tokenType: current.tokenType || 'oauth',
    selectedAdAccountId: adAccountId,
    hiddenAdAccountIds: current.hiddenAdAccountIds.filter((id) => id !== adAccountId),
    updatedAt: new Date().toISOString(),
  })
}

export async function removeMetaAdsLocalAccount(adAccountId: string) {
  const current = requireConnectedState()
  const account = ACCOUNT_FIXTURES.find((item) => item.id === adAccountId)
  if (!account) {
    throw buildError({
      code: 'META_ADS_ACCOUNT_NOT_FOUND',
      status: 404,
      message: 'A conta solicitada não existe no cenário local.',
      hint: 'Escolha uma das contas simuladas exibidas na tela.',
      retryable: false,
    })
  }
  const hiddenAdAccountIds = Array.from(new Set([...current.hiddenAdAccountIds, adAccountId]))
  const visible = ACCOUNT_FIXTURES.filter((item) => !hiddenAdAccountIds.includes(item.id))
  const nextSelectedAdAccountId = current.selectedAdAccountId === adAccountId
    ? visible[0]?.id || null
    : current.selectedAdAccountId
  writeState({
    ...current,
    scenario: nextSelectedAdAccountId ? 'connected-ready' : 'connected-no-account',
    selectedAdAccountId: nextSelectedAdAccountId,
    hiddenAdAccountIds,
    updatedAt: new Date().toISOString(),
  })
  return {
    ok: true,
    removedAdAccountId: adAccountId,
    selectedAdAccountId: nextSelectedAdAccountId,
    remainingAccountCount: visible.length,
  }
}

export async function getMetaAdsLocalStatus() {
  const scenario = getLocalScenario()
  if (scenario === 'unauthorized') {
    throw buildError({
      code: 'UNAUTHORIZED',
      status: 401,
      message: 'Faça login no CRM para continuar.',
      hint: 'Para testes locais do Meta Ads, use um cenário conectado ou liberado no launcher.',
      retryable: false,
    })
  }
  const state = readState() || buildDefaultState('disconnected')
  return buildStatus(state)
}

export async function listMetaAdsLocalAccounts() {
  const state = requireConnectedState()
  return {
    ok: true,
    connected: true,
    selectedAdAccountId: state.selectedAdAccountId,
    accounts: buildAccounts(state),
  }
}

export async function getMetaAdsLocalSummary(params?: { since?: string; until?: string }): Promise<MetaAdsSummaryResponse> {
  const state = requireSelectedAccount()
  const days = resolveRequestedDays(params)
  const window = resolveWindowLabel(days)
  if (state.selectedAdAccountId === 'act_456') {
    const spend = roundMetric(interpolateMetric(days, { d7: 214.32, d30: 864.12, d60: 1240.9 }))
    const impressions = Math.round(interpolateMetric(days, { d7: 1880, d30: 7120, d60: 10240 }))
    const clicks = Math.round(interpolateMetric(days, { d7: 57, d30: 214, d60: 332 }))
    const conversations = Math.round(interpolateMetric(days, { d7: 5, d30: 19, d60: 28 }))
    return {
      spend,
      impressions,
      clicks,
      conversations,
      avgCostConversation: conversations > 0 ? roundMetric(spend / conversations) : 0,
      activeCampaigns: 1,
      window,
    }
  }
  const spend = roundMetric(interpolateMetric(days, { d7: 512.48, d30: 1234.56, d60: 1610.98 }))
  const impressions = Math.round(interpolateMetric(days, { d7: 3840, d30: 9999, d60: 11740 }))
  const clicks = Math.round(interpolateMetric(days, { d7: 102, d30: 321, d60: 424 }))
  const conversations = Math.round(interpolateMetric(days, { d7: 10, d30: 23, d60: 29 }))
  return {
    spend,
    impressions,
    clicks,
    conversations,
    avgCostConversation: conversations > 0 ? roundMetric(spend / conversations) : 0,
    activeCampaigns: 2,
    window,
  }
}

export async function getMetaAdsLocalTrend(params?: { since?: string; until?: string }): Promise<MetaAdsTrendPoint[]> {
  const state = requireSelectedAccount()
  const summary = await getMetaAdsLocalSummary(params)
  return buildAdaptiveTrend(params, Number(summary.spend || 0), state.selectedAdAccountId === 'act_456' ? 'retargeting' : 'default')
}

export async function getMetaAdsLocalInventory(): Promise<MetaInventoryResponse> {
  const state = requireSelectedAccount()
  const accountId = state.selectedAdAccountId || DEFAULT_ACCOUNT_ID
  if (accountId === 'act_456') {
    return {
      ok: true,
      accountId,
      inventory: applyLocalEntityPatches({
        campaigns: [
          {
            id: 'cmp_ret_1',
            name: 'Campanha Remarketing Face',
            status: 'ACTIVE',
            effective_status: 'ACTIVE',
            objective: 'SALES',
            daily_budget: '5000',
            start_time: '2026-05-01T08:00:00-03:00',
            totals: { adSets: 1, ads: 2 },
          },
        ],
        adSets: [
          {
            id: 'set_ret_1',
            name: 'Visitantes 30d',
            campaign_id: 'cmp_ret_1',
            campaign_name: 'Campanha Remarketing Face',
            effective_status: 'ACTIVE',
            ads_count: 1,
            bid_strategy: 'LOWEST_COST_WITHOUT_CAP',
            billing_event: 'IMPRESSIONS',
            optimization_goal: 'OFFSITE_CONVERSIONS',
          },
        ],
        ads: [
          {
            id: 'ad_ret_1',
            name: 'Anúncio Remarketing 1',
            campaign_id: 'cmp_ret_1',
            campaign_name: 'Campanha Remarketing Face',
            adset_id: 'set_ret_1',
            adset_name: 'Visitantes 30d',
            creative: { id: 'cr_ret_1', name: 'Criativo Remarketing 1', effective_object_story_id: 'story_ret_1' },
            effective_status: 'ACTIVE',
          },
        ],
        creatives: [
          {
            id: 'cr_ret_1',
            name: 'Criativo Remarketing 1',
            campaignId: 'cmp_ret_1',
            campaignName: 'Campanha Remarketing Face',
            adSetId: 'set_ret_1',
            adSetName: 'Visitantes 30d',
            adId: 'ad_ret_1',
            adName: 'Anúncio Remarketing 1',
          },
        ],
      }),
    }
  }

  return {
    ok: true,
    accountId,
    inventory: applyLocalEntityPatches({
      campaigns: [
          {
            id: 'cmp_1',
            name: 'Campanha Primavera',
            status: 'ACTIVE',
            effective_status: 'ACTIVE',
            objective: 'LEADS',
            daily_budget: '12000',
            start_time: '2026-05-10T08:00:00-03:00',
            totals: { adSets: 1, ads: 1 },
          },
          {
            id: 'cmp_2',
            name: 'Campanha WhatsApp Facial',
            status: 'PAUSED',
            effective_status: 'PAUSED',
            objective: 'MESSAGES',
            lifetime_budget: '40000',
            start_time: '2026-05-01T08:00:00-03:00',
            stop_time: '2026-05-31T23:00:00-03:00',
            totals: { adSets: 1, ads: 1 },
          },
      ],
      adSets: [
        {
          id: 'set_1',
          name: 'Conjunto 1',
          campaign_id: 'cmp_1',
          campaign_name: 'Campanha Primavera',
          effective_status: 'ACTIVE',
          ads_count: 1,
          bid_strategy: 'LOWEST_COST_WITHOUT_CAP',
          billing_event: 'IMPRESSIONS',
          optimization_goal: 'LEAD_GENERATION',
          start_time: '2026-05-10T08:00:00-03:00',
        },
        {
          id: 'set_2',
          name: 'Conjunto 2',
          campaign_id: 'cmp_2',
          campaign_name: 'Campanha WhatsApp Facial',
          effective_status: 'PAUSED',
          ads_count: 1,
          bid_strategy: 'LOWEST_COST_WITH_BID_CAP',
          billing_event: 'LINK_CLICKS',
          optimization_goal: 'LINK_CLICKS',
          end_time: '2026-05-31T23:00:00-03:00',
        },
      ],
      ads: [
        {
          id: 'ad_1',
          name: 'Anúncio 1',
          campaign_id: 'cmp_1',
          campaign_name: 'Campanha Primavera',
          adset_id: 'set_1',
          adset_name: 'Conjunto 1',
          creative: {
            id: 'cr_1',
            name: 'Criativo 1',
            thumbnail_url: 'https://images.unsplash.com/photo-1515377905703-c4788e51af15?auto=format&fit=crop&w=900&q=80',
            image_url: 'https://images.unsplash.com/photo-1515377905703-c4788e51af15?auto=format&fit=crop&w=900&q=80',
            effective_object_story_id: 'story_1',
            title: 'Renove sua rotina de skincare',
            body: 'Conheça protocolos faciais personalizados para sua pele.',
            call_to_action_type: 'LEARN_MORE',
            object_url: 'https://skincos.com.br/tratamentos',
            asset_feed_spec: {
              titles: [
                { text: 'Renove sua rotina de skincare' },
                { text: 'Pele mais luminosa com acompanhamento' },
                { text: 'Tratamentos faciais sob medida' },
              ],
              bodies: [
                { text: 'Conheça protocolos faciais personalizados para sua pele.' },
                { text: 'Agende uma avaliação e entenda o melhor caminho para seu objetivo.' },
                { text: 'Tecnologia, cuidado e orientação em uma experiência completa.' },
              ],
              descriptions: [
                { text: 'Avaliação individual com especialistas.' },
                { text: 'Resultados acompanhados do início ao fim.' },
              ],
              call_to_action_types: ['LEARN_MORE', 'SIGN_UP', 'CONTACT_US'],
              link_urls: [{ website_url: 'https://skincos.com.br/tratamentos' }],
              images: [{ hash: 'mock_skin_oil' }],
            },
          },
          effective_status: 'ACTIVE',
        },
        {
          id: 'ad_2',
          name: 'Anúncio WhatsApp 1',
          campaign_id: 'cmp_2',
          campaign_name: 'Campanha WhatsApp Facial',
          adset_id: 'set_2',
          adset_name: 'Conjunto 2',
          creative: {
            id: 'cr_2',
            name: 'Criativo WhatsApp 1',
            thumbnail_url: 'https://images.unsplash.com/photo-1524504388940-b1c1722653e1?auto=format&fit=crop&w=900&q=80',
            image_url: 'https://images.unsplash.com/photo-1524504388940-b1c1722653e1?auto=format&fit=crop&w=900&q=80',
            effective_object_story_id: 'story_2',
            title: 'Fale com uma consultora',
            body: 'Tire dúvidas pelo WhatsApp e receba orientação para o melhor protocolo.',
            call_to_action_type: 'WHATSAPP_MESSAGE',
            object_url: 'https://skincos.com.br/whatsapp',
            asset_feed_spec: {
              titles: [
                { text: 'Fale com uma consultora' },
                { text: 'Escolha seu protocolo facial' },
                { text: 'Comece pelo WhatsApp' },
              ],
              bodies: [
                { text: 'Tire dúvidas pelo WhatsApp e receba orientação para o melhor protocolo.' },
                { text: 'Nossa equipe ajuda você a escolher o cuidado ideal.' },
              ],
              descriptions: [{ text: 'Atendimento direto pelo WhatsApp.' }],
              call_to_action_types: ['WHATSAPP_MESSAGE', 'CONTACT_US'],
              link_urls: [{ website_url: 'https://skincos.com.br/whatsapp' }],
              images: [{ hash: 'mock_whatsapp_creative' }],
            },
          },
          effective_status: 'PAUSED',
        },
      ],
        creatives: [
        {
          id: 'cr_1',
          name: 'Criativo 1',
          thumbnailUrl: 'https://images.unsplash.com/photo-1515377905703-c4788e51af15?auto=format&fit=crop&w=900&q=80',
          campaignId: 'cmp_1',
          campaignName: 'Campanha Primavera',
          adSetId: 'set_1',
          adSetName: 'Conjunto 1',
          adId: 'ad_1',
          adName: 'Anúncio 1',
          effectiveObjectStoryId: 'story_1',
        },
        {
          id: 'cr_2',
          name: 'Criativo WhatsApp 1',
          thumbnailUrl: 'https://images.unsplash.com/photo-1524504388940-b1c1722653e1?auto=format&fit=crop&w=900&q=80',
          campaignId: 'cmp_2',
          campaignName: 'Campanha WhatsApp Facial',
          adSetId: 'set_2',
          adSetName: 'Conjunto 2',
          adId: 'ad_2',
          adName: 'Anúncio WhatsApp 1',
          effectiveObjectStoryId: 'story_2',
        },
      ],
    }),
  }
}

function localEditableFields(type: MetaAdsEntityType) {
  if (type === 'creative') return ['name']
  if (type === 'ad') return ['name', 'status']
  if (type === 'campaign') return ['name', 'status', 'daily_budget', 'lifetime_budget', 'start_time', 'stop_time']
  return ['name', 'status', 'daily_budget', 'lifetime_budget', 'start_time', 'end_time', 'bid_strategy', 'optimization_goal']
}

function buildLocalEntityDetail(type: MetaAdsEntityType, id: string, fields: Record<string, unknown>, accountId: string): MetaAdsEntityDetailResponse {
  const editableFields = localEditableFields(type)
  return {
    ok: true,
    entity: {
      type,
      id,
      accountId,
      editable: editableFields.length > 0,
      readOnlyReason: null,
      editableFields,
      fields,
      raw: fields,
      updatedAt: new Date().toISOString(),
    },
  }
}

export async function getMetaAdsLocalEntityDetail(type: MetaAdsEntityType, id: string): Promise<MetaAdsEntityDetailResponse> {
  const inventory = await getMetaAdsLocalInventory()
  const entity =
    type === 'campaign'
      ? inventory.inventory.campaigns.find((item) => item.id === id)
      : type === 'adset'
        ? inventory.inventory.adSets.find((item) => item.id === id)
        : type === 'ad'
          ? inventory.inventory.ads.find((item) => item.id === id)
          : inventory.inventory.creatives.find((item) => item.id === id)
  if (!entity) {
    throw {
      code: 'META_ADS_ENTITY_NOT_FOUND',
      message: 'Item Meta Ads não encontrado no mock local.',
      retryable: false,
    }
  }
  return buildLocalEntityDetail(type, id, entity as Record<string, unknown>, inventory.accountId)
}

export async function updateMetaAdsLocalEntity(
  type: MetaAdsEntityType,
  id: string,
  patch: MetaAdsEntityPatch,
): Promise<MetaAdsEntityUpdateResponse> {
  writeLocalEntityPatch(type, id, patch)
  const detail = await getMetaAdsLocalEntityDetail(type, id)
  const changedFields = Object.keys(patch)
  return {
    ok: true,
    entity: detail.entity,
    changedFields,
    audit: {
      entityType: type,
      entityId: id,
      adAccountId: detail.entity.accountId,
      changedFields,
      timestamp: new Date().toISOString(),
    },
  }
}

export async function getMetaAdsLocalReport(params?: { since?: string; until?: string }): Promise<MetaAdsReportResponse> {
  const state = requireSelectedAccount()
  const days = resolveRequestedDays(params)
  const reportDate = '2026-05-14'
  const windowLabel = resolveWindowLabel(days)
  const spendKey = `ad_${windowLabel}_scalar_spend`
  const reachKey = `ad_${windowLabel}_scalar_reach`
  const impressionsKey = `ad_${windowLabel}_scalar_impressions`
  const clicksKey = `ad_${windowLabel}_scalar_clicks`
  const linkClicksKey = `ad_${windowLabel}_inline_link_clicks`
  const engagementKey = `ad_${windowLabel}_inline_post_engagement`
  const instagramProfileVisitsKey = `ad_${windowLabel}_instagram_profile_visits`
  const conversationsKey = `ad_${windowLabel}_conversation_started`
  const rows =
    state.selectedAdAccountId === 'act_456'
      ? [
          {
            campaign_id: 'cmp_ret_1',
            campaign_name: 'Campanha Remarketing Face',
            campaign_effective_status: 'ACTIVE',
            adset_id: 'set_ret_1',
            adset_name: 'Visitantes 30d',
            ad_id: 'ad_ret_1',
            ad_name: 'Anúncio Remarketing 1',
            [spendKey]: roundMetric(interpolateMetric(days, { d7: 214.32, d30: 864.12, d60: 1240.9 })),
            [reachKey]: Math.round(interpolateMetric(days, { d7: 1420, d30: 5210, d60: 7420 })),
            [impressionsKey]: Math.round(interpolateMetric(days, { d7: 1880, d30: 7120, d60: 10240 })),
            [clicksKey]: Math.round(interpolateMetric(days, { d7: 57, d30: 214, d60: 332 })),
            [linkClicksKey]: Math.round(interpolateMetric(days, { d7: 39, d30: 138, d60: 214 })),
            [engagementKey]: Math.round(interpolateMetric(days, { d7: 82, d30: 284, d60: 412 })),
            [instagramProfileVisitsKey]: Math.round(interpolateMetric(days, { d7: 11, d30: 39, d60: 54 })),
            [conversationsKey]: Math.round(interpolateMetric(days, { d7: 5, d30: 19, d60: 28 })),
          },
        ]
      : [
          {
            campaign_id: 'cmp_1',
            campaign_name: 'Campanha Primavera',
            campaign_effective_status: 'ACTIVE',
            adset_id: 'set_1',
            adset_name: 'Conjunto 1',
            ad_id: 'ad_1',
            ad_name: 'Anúncio Primavera 1',
            [spendKey]: roundMetric(interpolateMetric(days, { d7: 342.2, d30: 834.56, d60: 1044.9 })),
            [reachKey]: Math.round(interpolateMetric(days, { d7: 1610, d30: 4620, d60: 5980 })),
            [impressionsKey]: Math.round(interpolateMetric(days, { d7: 2210, d30: 6120, d60: 8120 })),
            [clicksKey]: Math.round(interpolateMetric(days, { d7: 79, d30: 201, d60: 281 })),
            [linkClicksKey]: Math.round(interpolateMetric(days, { d7: 52, d30: 147, d60: 194 })),
            [engagementKey]: Math.round(interpolateMetric(days, { d7: 126, d30: 352, d60: 418 })),
            [instagramProfileVisitsKey]: Math.round(interpolateMetric(days, { d7: 18, d30: 64, d60: 72 })),
            [conversationsKey]: Math.round(interpolateMetric(days, { d7: 6, d30: 14, d60: 18 })),
          },
          {
            campaign_id: 'cmp_2',
            campaign_name: 'Campanha WhatsApp Facial',
            campaign_effective_status: 'PAUSED',
            adset_id: 'set_2',
            adset_name: 'Conjunto 2',
            ad_id: 'ad_2',
            ad_name: 'Anúncio WhatsApp 1',
            [spendKey]: roundMetric(interpolateMetric(days, { d7: 170.28, d30: 400, d60: 566.08 })),
            [reachKey]: Math.round(interpolateMetric(days, { d7: 1190, d30: 2890, d60: 2760 })),
            [impressionsKey]: Math.round(interpolateMetric(days, { d7: 1630, d30: 3879, d60: 3620 })),
            [clicksKey]: Math.round(interpolateMetric(days, { d7: 45, d30: 120, d60: 143 })),
            [linkClicksKey]: Math.round(interpolateMetric(days, { d7: 31, d30: 84, d60: 97 })),
            [engagementKey]: Math.round(interpolateMetric(days, { d7: 71, d30: 188, d60: 205 })),
            [instagramProfileVisitsKey]: Math.round(interpolateMetric(days, { d7: 9, d30: 27, d60: 31 })),
            [conversationsKey]: Math.round(interpolateMetric(days, { d7: 4, d30: 9, d60: 11 })),
          },
        ]

  return buildMetaAdsWorkflowReport(rows, windowLabel, {
    reportDate,
    runsCount: rows.length,
    source: 'local-preview',
  })
}
