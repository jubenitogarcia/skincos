import type {
  InfluencerComparison,
  InfluencerCampaignFitResponse,
  InfluencerCreatorDashboard,
  InfluencerCreatorSummary,
  InfluencerIntelligenceClient,
  InfluencerSearchResponse,
} from './influencerIntelligenceTypes'

const API_BASE = '/api/influencer-intelligence/v1'
const REQUEST_TIMEOUT_MS = 12_000
const SAFE_CREATOR_KEY = /^[A-Za-z0-9._:-]{1,128}$/

export class InfluencerIntelligenceApiError extends Error {
  readonly code: string
  readonly status: number | null
  readonly requestId: string | null

  constructor(message: string, options: { code?: string; status?: number | null; requestId?: string | null } = {}) {
    super(message)
    this.name = 'InfluencerIntelligenceApiError'
    this.code = String(options.code || 'INTERNAL')
    this.status = options.status ?? null
    this.requestId = options.requestId ?? null
  }
}

type FetchLike = typeof fetch

function boundedQuery(value: string): string {
  const normalized = String(value || '').trim()
  if (!/^[A-Za-z0-9._@ -]*$/.test(normalized)) return ''
  return normalized.slice(0, 80)
}

function creatorPath(creatorKey: string): string {
  return `${API_BASE}/creators/${encodeURIComponent(String(creatorKey || '').trim())}/analysis`
}

function boundedCreatorKeys(value: string[], { minimum = 0 } = {}): string[] {
  if (!Array.isArray(value) || value.length < minimum || value.length > 20) {
    throw new InfluencerIntelligenceApiError('Creators inválidos.', { code: 'INVALID_INPUT' })
  }
  const keys = value.map((item) => String(item || '').trim())
  if (new Set(keys).size !== keys.length || keys.some((key) => !SAFE_CREATOR_KEY.test(key))) {
    throw new InfluencerIntelligenceApiError('Creators inválidos.', { code: 'INVALID_INPUT' })
  }
  return keys
}

function unwrap<T>(payload: unknown): T {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw new InfluencerIntelligenceApiError('Resposta inválida do serviço interno.', { code: 'INVALID_SERVICE_RESPONSE' })
  }
  const record = payload as Record<string, unknown>
  return (record.data === undefined ? record : record.data) as T
}

function assertRecord(value: unknown, message: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new InfluencerIntelligenceApiError(message, { code: 'INVALID_SERVICE_RESPONSE' })
  }
  return value as Record<string, unknown>
}

async function readJson<T>(
  path: string,
  options: { method?: 'GET' | 'POST'; body?: unknown; fetchImpl?: FetchLike } = {},
): Promise<T> {
  const fetchImpl = options.fetchImpl || globalThis.fetch
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)
  try {
    const response = await fetchImpl(path, {
      method: options.method || 'GET',
      credentials: 'include',
      headers: {
        accept: 'application/json',
        ...(options.body === undefined ? {} : { 'content-type': 'application/json' }),
      },
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
      signal: controller.signal,
    })
    const requestId = response.headers.get('x-request-id') || response.headers.get('X-Request-Id')
    const text = await response.text()
    let payload: unknown = null
    try {
      payload = text ? JSON.parse(text) : null
    } catch {
      payload = null
    }
    if (!response.ok) {
      const error = assertRecord(payload || {}, 'Resposta de erro inválida.')
      throw new InfluencerIntelligenceApiError(
        'Não foi possível carregar o Influencer Intelligence.',
        { code: String(error.code || error.error || 'INTERNAL'), status: response.status, requestId },
      )
    }
    return unwrap<T>(payload)
  } catch (error) {
    if (error instanceof InfluencerIntelligenceApiError) throw error
    if ((error as { name?: string })?.name === 'AbortError') {
      throw new InfluencerIntelligenceApiError('A leitura do Influencer Intelligence excedeu o tempo limite.', { code: 'TIMEOUT' })
    }
    throw new InfluencerIntelligenceApiError('O serviço interno do Influencer Intelligence está indisponível.', { code: 'UNAVAILABLE' })
  } finally {
    clearTimeout(timeout)
  }
}

export function createInfluencerIntelligenceApi(fetchImpl: FetchLike = globalThis.fetch): InfluencerIntelligenceClient {
  return {
    async searchCreators(query) {
      const params = new URLSearchParams({ limit: '20' })
      const normalized = boundedQuery(query)
      if (normalized) params.set('query', normalized)
      const payload = await readJson<InfluencerSearchResponse>(`${API_BASE}/creators?${params.toString()}`, { fetchImpl })
      const record = assertRecord(payload, 'Resposta de busca inválida.')
      if (!Array.isArray(record.creators)) {
        throw new InfluencerIntelligenceApiError('Resposta de busca inválida.', { code: 'INVALID_SERVICE_RESPONSE' })
      }
      return record as unknown as InfluencerSearchResponse
    },

    async addCreator(handle) {
      const normalized = boundedQuery(handle).replace(/^@/, '').toLowerCase()
      const payload = await readJson<InfluencerCreatorSummary>(`${API_BASE}/creators`, {
        method: 'POST',
        body: { handle: normalized },
        fetchImpl,
      })
      const record = assertRecord(payload, 'Resposta de registro inválida.')
      const creator = record.creator === undefined ? record : record.creator
      const creatorRecord = assertRecord(creator, 'Resposta de registro inválida.')
      if (typeof creatorRecord.creatorKey !== 'string') {
        throw new InfluencerIntelligenceApiError('Resposta de registro inválida.', { code: 'INVALID_SERVICE_RESPONSE' })
      }
      return creatorRecord as unknown as InfluencerCreatorSummary
    },

    async getCreatorDashboard(creatorKey) {
      const payload = await readJson<InfluencerCreatorDashboard>(creatorPath(creatorKey), { fetchImpl })
      const record = assertRecord(payload, 'Resposta de análise inválida.')
      if (!record.creator || !record.profile || !record.score || !Array.isArray(record.history) || !Array.isArray(record.media)) {
        throw new InfluencerIntelligenceApiError('Resposta de análise inválida.', { code: 'INVALID_SERVICE_RESPONSE' })
      }
      return record as unknown as InfluencerCreatorDashboard
    },

    async compareCreators(creatorKeys) {
      const keys = boundedCreatorKeys(creatorKeys, { minimum: 1 })
      const payload = await readJson<InfluencerComparison>(`${API_BASE}/compare`, {
        method: 'POST',
        body: { creatorKeys: keys },
        fetchImpl,
      })
      const record = assertRecord(payload, 'Resposta de comparação inválida.')
      if (!Array.isArray(record.creators)) {
        throw new InfluencerIntelligenceApiError('Resposta de comparação inválida.', { code: 'INVALID_SERVICE_RESPONSE' })
      }
      return record as unknown as InfluencerComparison
    },

    async getCampaignFit(campaignKey, creatorKeys = [], campaignVersion = 1) {
      const normalizedKey = String(campaignKey || '').trim()
      if (!/^[A-Za-z0-9._:-]{1,128}$/.test(normalizedKey) || !Number.isSafeInteger(campaignVersion) || campaignVersion < 1) {
        throw new InfluencerIntelligenceApiError('Chave de campanha inválida.', { code: 'INVALID_INPUT' })
      }
      const keys = boundedCreatorKeys(creatorKeys)
      const payload = await readJson<InfluencerCampaignFitResponse>(`${API_BASE}/campaign-fit`, {
        method: 'POST',
        body: { campaignKey: normalizedKey, campaignVersion, creatorKeys: keys },
        fetchImpl,
      })
      const record = assertRecord(payload, 'Resposta de Campaign Fit inválida.')
      if (!Array.isArray(record.fits) || typeof record.campaignKey !== 'string') {
        throw new InfluencerIntelligenceApiError('Resposta de Campaign Fit inválida.', { code: 'INVALID_SERVICE_RESPONSE' })
      }
      return record as unknown as InfluencerCampaignFitResponse
    },
  }
}

export const __testables = Object.freeze({ boundedQuery, creatorPath, unwrap })
