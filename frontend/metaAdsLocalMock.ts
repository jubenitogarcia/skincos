import type {
  MetaAdAccount,
  MetaAdsApiError,
  MetaAdsStatusResponse,
  MetaAdsSummaryResponse,
  MetaAdsTrendPoint,
  MetaInventoryResponse,
} from '@/metaAdsTypes'

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
  updatedAt: string | null
}

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '::1'])
const STORAGE_KEY = 'metaAds.localState.v1'
const SCENARIO_QUERY_KEY = 'metaAdsLocalScenario'
const DEFAULT_ACCOUNT_ID = 'act_123'

const ACCOUNT_FIXTURES: MetaAdAccount[] = [
  {
    id: 'act_123',
    name: 'Conta Principal',
    currency: 'BRL',
    timezone_name: 'America/Sao_Paulo',
    business_name: 'Skincos',
  },
  {
    id: 'act_456',
    name: 'Conta Captação',
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
  return ACCOUNT_FIXTURES.map((account) => ({
    ...account,
    isSelected: account.id === state.selectedAdAccountId,
  }))
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
  writeState({
    scenario: 'connected-no-account',
    tokenType: 'oauth',
    selectedAdAccountId: null,
    updatedAt: new Date().toISOString(),
  })
}

export async function connectMetaAdsManualLocal() {
  if (!canUseLocalStorage()) return
  writeState({
    scenario: 'connected-no-account',
    tokenType: 'manual',
    selectedAdAccountId: null,
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
    updatedAt: new Date().toISOString(),
  })
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

export async function getMetaAdsLocalSummary(): Promise<MetaAdsSummaryResponse> {
  const state = requireSelectedAccount()
  if (state.selectedAdAccountId === 'act_456') {
    return { spend: 864.12, impressions: 7120, clicks: 214, activeCampaigns: 1 }
  }
  return { spend: 1234.56, impressions: 9999, clicks: 321, activeCampaigns: 2 }
}

export async function getMetaAdsLocalTrend(): Promise<MetaAdsTrendPoint[]> {
  requireSelectedAccount()
  return [
    { day: '2026-05-07', spend: 82 },
    { day: '2026-05-08', spend: 96 },
    { day: '2026-05-09', spend: 101 },
    { day: '2026-05-10', spend: 100 },
    { day: '2026-05-11', spend: 120 },
    { day: '2026-05-12', spend: 148 },
    { day: '2026-05-13', spend: 132 },
  ]
}

export async function getMetaAdsLocalInventory(): Promise<MetaInventoryResponse> {
  const state = requireSelectedAccount()
  const accountId = state.selectedAdAccountId || DEFAULT_ACCOUNT_ID
  if (accountId === 'act_456') {
    return {
      ok: true,
      accountId,
      inventory: {
        campaigns: [
          {
            id: 'cmp_ret_1',
            name: 'Campanha Remarketing Face',
            status: 'ACTIVE',
            effective_status: 'ACTIVE',
            objective: 'SALES',
            totals: { adSets: 1, ads: 2 },
          },
        ],
        adSets: [{ id: 'set_ret_1', name: 'Visitantes 30d' }],
        ads: [
          {
            id: 'ad_ret_1',
            name: 'Anúncio Remarketing 1',
            campaign_name: 'Campanha Remarketing Face',
            adset_name: 'Visitantes 30d',
            creative: { id: 'cr_ret_1', name: 'Criativo Remarketing 1' },
            effective_status: 'ACTIVE',
          },
        ],
        creatives: [
          {
            id: 'cr_ret_1',
            name: 'Criativo Remarketing 1',
            campaignId: 'cmp_ret_1',
            adName: 'Anúncio Remarketing 1',
          },
        ],
      },
    }
  }

  return {
    ok: true,
    accountId,
    inventory: {
      campaigns: [
        {
          id: 'cmp_1',
          name: 'Campanha Primavera',
          status: 'ACTIVE',
          effective_status: 'ACTIVE',
          objective: 'LEADS',
          totals: { adSets: 1, ads: 1 },
        },
        {
          id: 'cmp_2',
          name: 'Campanha WhatsApp Facial',
          status: 'PAUSED',
          effective_status: 'PAUSED',
          objective: 'MESSAGES',
          totals: { adSets: 1, ads: 1 },
        },
      ],
      adSets: [
        { id: 'set_1', name: 'Conjunto 1' },
        { id: 'set_2', name: 'Conjunto 2' },
      ],
      ads: [
        {
          id: 'ad_1',
          name: 'Anúncio 1',
          campaign_name: 'Campanha Primavera',
          adset_name: 'Conjunto 1',
          creative: { id: 'cr_1', name: 'Criativo 1' },
          effective_status: 'ACTIVE',
        },
        {
          id: 'ad_2',
          name: 'Anúncio WhatsApp 1',
          campaign_name: 'Campanha WhatsApp Facial',
          adset_name: 'Conjunto 2',
          creative: { id: 'cr_2', name: 'Criativo WhatsApp 1' },
          effective_status: 'PAUSED',
        },
      ],
      creatives: [
        {
          id: 'cr_1',
          name: 'Criativo 1',
          campaignId: 'cmp_1',
          adName: 'Anúncio 1',
        },
        {
          id: 'cr_2',
          name: 'Criativo WhatsApp 1',
          campaignId: 'cmp_2',
          adName: 'Anúncio WhatsApp 1',
        },
      ],
    },
  }
}
