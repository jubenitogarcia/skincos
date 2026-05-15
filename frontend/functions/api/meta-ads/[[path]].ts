import { requireSocialAdmin } from '../../_lib/socialAuth'
import { requireCsrfForMutations } from '../../_lib/csrf'
import { getShareBucket } from '../../_lib/r2'
import { getIntegrationsEncryptionSecret, integrationsEncryptionSecretRequired } from '../../_lib/integrationsEncryption'
import { signState, verifyState } from '../../_lib/oauthState'
import {
  deleteMetaAdsConnection,
  readMetaAdsConnectionDecrypted,
  writeMetaAdsConnection,
  type MetaAdsConnection,
} from '../../_lib/metaAdsStore'
import {
  debugMetaAccessToken,
  getMetaAdsSummary,
  getMetaAdsTrend,
  getMetaProfile,
  listMetaAdAccounts,
  listMetaAds,
  listMetaAdSets,
  listMetaCampaigns,
} from '../../_lib/metaAdsGraph'
import {
  aggregateMetaAdsWorkflowSummary,
  buildMetaAdsWorkflowReport,
  normalizeMetaAdsWorkflowAccountId,
  type MetaAdsWorkflowWindow,
} from '../../../metaAdsWorkflowReport'

type OAuthState = { userId: string; nonce: string; iat: number }
type OAuthPopupMessage = {
  type: 'meta-ads:connected'
  ok: boolean
  error?: {
    code: string
    message: string
    hint?: string | null
  }
}
type MetaAdsApiErrorInit = {
  message?: string
  hint?: string
  retryable?: boolean
  extra?: Record<string, unknown>
}
type MetaTokenValidation = {
  grantedScopes: string[]
  expiresAt?: string
  dataAccessExpiresAt?: string
  lastValidatedAt: string
}

const OAUTH_STATE_MAX_AGE_MS = 15 * 60 * 1000
const CONNECTION_REVALIDATE_INTERVAL_MS = 60 * 60 * 1000

const json = (status: number, body: any) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  })

const html = (body: string) =>
  new Response(body, {
    status: 200,
    headers: {
      'content-type': 'text/html; charset=utf-8',
      'cache-control': 'no-store',
      'x-content-type-options': 'nosniff',
      'x-frame-options': 'DENY',
      'referrer-policy': 'same-origin',
      'content-security-policy': [
        "default-src 'none'",
        "base-uri 'none'",
        "frame-ancestors 'none'",
        "form-action 'self'",
        "script-src 'unsafe-inline'",
        "style-src 'unsafe-inline'",
      ].join('; '),
    },
  })

const esc = (value: any) =>
  String(value || '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char] as string))

const apiError = (
  status: number,
  code: string,
  { message, hint, retryable = status >= 500, extra }: MetaAdsApiErrorInit = {},
) =>
  json(status, {
    ok: false,
    error: code,
    code,
    message: message || code,
    hint: hint || null,
    retryable,
    ...(extra || {}),
  })

class MetaAdsRouteError extends Error {
  status: number
  code: string
  hint?: string
  retryable: boolean
  extra?: Record<string, unknown>

  constructor(status: number, code: string, { message, hint, retryable = status >= 500, extra }: MetaAdsApiErrorInit = {}) {
    super(message || code)
    this.status = status
    this.code = code
    this.hint = hint
    this.retryable = retryable
    this.extra = extra
  }
}

function runtimeConfig(context: any) {
  const env = context?.env || {}
  return {
    appId: String(env.META_APP_ID || '').trim(),
    appSecret: String(env.META_APP_SECRET || '').trim(),
    stateSecret: String(env.META_OAUTH_STATE_SECRET || env.META_APP_SECRET || '').trim(),
    graphVersion: String(env.META_GRAPH_VERSION || 'v20.0').trim() || 'v20.0',
    configId: String(env.META_ADS_CONFIG_ID || '').trim(),
    reportWorkerBaseUrl: String(env.META_ADS_REPORT_WORKER_BASE_URL || '').trim(),
    reportWorkerApiToken: String(env.META_ADS_REPORT_WORKER_API_TOKEN || '').trim(),
    reportWorkerAuthHeader: String(env.META_ADS_REPORT_WORKER_AUTH_HEADER || 'Authorization').trim() || 'Authorization',
    reportWorkerAuthScheme: String(env.META_ADS_REPORT_WORKER_AUTH_SCHEME || 'Bearer').trim() || 'Bearer',
    scopes:
      String(env.META_ADS_OAUTH_SCOPES || '').trim() ||
      ['ads_read', 'ads_management', 'business_management'].join(','),
  }
}

function requiredScopes(cfg: ReturnType<typeof runtimeConfig>) {
  return String(cfg.scopes || '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean)
}

function normalizeScopes(values: unknown[]) {
  return Array.from(new Set(values.map((value) => String(value || '').trim()).filter(Boolean)))
}

function epochSecondsToIso(value: unknown) {
  const raw = Number(value || 0)
  if (!Number.isFinite(raw) || raw <= 0) return undefined
  return new Date(raw * 1000).toISOString()
}

function extractDebugScopes(data: any) {
  const direct = Array.isArray(data?.scopes) ? data.scopes : []
  const granular = Array.isArray(data?.granular_scopes)
    ? data.granular_scopes.map((item: any) => item?.scope)
    : []
  return normalizeScopes([...direct, ...granular])
}

function shouldRevalidateConnection(connection: MetaAdsConnection | null) {
  if (!connection?.accessToken) return false
  if (!connection.lastValidatedAt) return true
  const timestamp = Date.parse(connection.lastValidatedAt)
  if (!Number.isFinite(timestamp)) return true
  return Date.now() - timestamp >= CONNECTION_REVALIDATE_INTERVAL_MS
}

function normalizeUnhandledMetaError(error: any) {
  const message = String(error?.message || '').toLowerCase()
  if (!message) return null
  if (message.includes('invalid oauth access token') || message.includes('session has been invalidated')) {
    return new MetaAdsRouteError(401, 'META_TOKEN_INVALID', {
      message: 'A sessão da Meta expirou ou foi revogada.',
      hint: 'Conecte novamente a conta Meta pelo Facebook ou valide um novo token manual.',
      retryable: false,
    })
  }
  if (message.includes('permissions error') || message.includes('missing permissions')) {
    return new MetaAdsRouteError(403, 'META_PERMISSIONS_ERROR', {
      message: 'A Meta negou parte das permissões necessárias para esta operação.',
      hint: 'Refaça o login e confirme as permissões do Gerenciador de Anúncios.',
      retryable: false,
    })
  }
  return null
}

function normalizeWorkerBaseUrl(value: string) {
  return String(value || '').trim().replace(/\/+$/, '')
}

function resolveWorkflowSummaryWindow(range: { since: string; until: string }): MetaAdsWorkflowWindow {
  const since = Date.parse(`${String(range.since || '').trim()}T00:00:00Z`)
  const until = Date.parse(`${String(range.until || '').trim()}T00:00:00Z`)
  if (!Number.isFinite(since) || !Number.isFinite(until) || until < since) return 'last_7d'
  const diffDays = Math.max(1, Math.floor((until - since) / 86400000) + 1)
  if (diffDays <= 1) return 'last_24h'
  if (diffDays <= 7) return 'last_7d'
  return 'last_30d'
}

async function fetchWorkflowSummary(
  adAccountId: string,
  range: { since: string; until: string },
  cfg: ReturnType<typeof runtimeConfig>,
) {
  const baseUrl = normalizeWorkerBaseUrl(cfg.reportWorkerBaseUrl)
  const token = String(cfg.reportWorkerApiToken || '').trim()
  if (!baseUrl || !token) return null

  const window = resolveWorkflowSummaryWindow(range)
  const reportDate = String(range.until || '').trim()
  const url = new URL(`${baseUrl}/report/meta-ads-performance-report`)
  url.searchParams.set('account_id', normalizeMetaAdsWorkflowAccountId(adAccountId))
  url.searchParams.set('report_date', reportDate)
  url.searchParams.set('windows', window)
  url.searchParams.set('include', 'summary')
  url.searchParams.set('limit', '500')

  const headerName = cfg.reportWorkerAuthHeader || 'Authorization'
  const authValue = cfg.reportWorkerAuthScheme
    ? `${cfg.reportWorkerAuthScheme} ${token}`
    : token

  const response = await fetch(url.toString(), {
    headers: {
      accept: 'application/json',
      [headerName]: authValue,
    },
  })

  const payload = await response.json().catch(() => null)
  if (!response.ok || !payload?.ok || !Array.isArray(payload?.summary_rows)) {
    throw new Error(
      payload?.message ||
        payload?.error ||
        `workflow report request failed with status ${response.status}`,
    )
  }

  return aggregateMetaAdsWorkflowSummary(payload.summary_rows, window)
}

async function fetchWorkflowReport(
  adAccountId: string,
  range: { since: string; until: string },
  cfg: ReturnType<typeof runtimeConfig>,
) {
  const baseUrl = normalizeWorkerBaseUrl(cfg.reportWorkerBaseUrl)
  const token = String(cfg.reportWorkerApiToken || '').trim()
  if (!baseUrl || !token) return null

  const window = resolveWorkflowSummaryWindow(range)
  const reportDate = String(range.until || '').trim()
  const url = new URL(`${baseUrl}/report/meta-ads-performance-report`)
  url.searchParams.set('account_id', normalizeMetaAdsWorkflowAccountId(adAccountId))
  url.searchParams.set('report_date', reportDate)
  url.searchParams.set('windows', window)
  url.searchParams.set('include', 'summary')
  url.searchParams.set('limit', '500')

  const headerName = cfg.reportWorkerAuthHeader || 'Authorization'
  const authValue = cfg.reportWorkerAuthScheme
    ? `${cfg.reportWorkerAuthScheme} ${token}`
    : token

  const response = await fetch(url.toString(), {
    headers: {
      accept: 'application/json',
      [headerName]: authValue,
    },
  })

  const payload = await response.json().catch(() => null)
  if (!response.ok || !payload?.ok || !Array.isArray(payload?.summary_rows)) {
    throw new Error(
      payload?.message ||
        payload?.error ||
        `workflow report request failed with status ${response.status}`,
    )
  }

  return buildMetaAdsWorkflowReport(payload.summary_rows, window, {
    reportDate: String(payload?.metadata?.report_date || reportDate).trim(),
    runsCount: Number(payload?.metadata?.runs_count || 0),
    source: String(payload?.metadata?.source || 'd1').trim() || 'd1',
  })
}

async function validateMetaAccessToken(
  accessToken: string,
  cfg: ReturnType<typeof runtimeConfig>,
): Promise<MetaTokenValidation> {
  if (!cfg.appId || !cfg.appSecret) {
    return {
      grantedScopes: requiredScopes(cfg),
      lastValidatedAt: new Date().toISOString(),
    }
  }

  const debug = await debugMetaAccessToken(accessToken, cfg.appId, cfg.appSecret, cfg.graphVersion)
  const debugData = debug?.data || {}
  if (!debugData?.is_valid) {
    throw new MetaAdsRouteError(401, 'META_TOKEN_INVALID', {
      message: 'A Meta rejeitou o access token desta conexão.',
      hint: 'Refaça a autenticação com Facebook ou gere um token manual válido.',
      retryable: false,
    })
  }

  const tokenAppId = String(debugData?.app_id || '').trim()
  if (tokenAppId && cfg.appId && tokenAppId !== cfg.appId) {
    throw new MetaAdsRouteError(400, 'META_TOKEN_APP_MISMATCH', {
      message: 'O token retornado pertence a outro app Meta.',
      hint: 'Confirme que o app do Meta Developer usado no CRM é o mesmo da autenticação.',
      retryable: false,
    })
  }

  const grantedScopes = extractDebugScopes(debugData)
  const missingScopes = requiredScopes(cfg).filter((scope) => !grantedScopes.includes(scope))
  if (missingScopes.length) {
    throw new MetaAdsRouteError(400, 'META_SCOPES_INCOMPLETE', {
      message: 'A autenticação não concedeu todos os acessos exigidos pelo Meta Ads.',
      hint: `Escopos ausentes: ${missingScopes.join(', ')}.`,
      retryable: false,
      extra: { missingScopes, grantedScopes },
    })
  }

  return {
    grantedScopes,
    expiresAt: epochSecondsToIso(debugData?.expires_at),
    dataAccessExpiresAt: epochSecondsToIso(debugData?.data_access_expires_at),
    lastValidatedAt: new Date().toISOString(),
  }
}

function buildOauthPopupResponse(payload: OAuthPopupMessage, body: string) {
  const safePayload = JSON.stringify(payload).replace(/</g, '\\u003c')
  return html(`
      <script>
        try {
          if (window.opener) {
            window.opener.postMessage(${safePayload}, window.location.origin);
          }
        } catch {}
        try { window.close(); } catch {}
      </script>
      <p>${esc(body)}</p>
    `)
}

function connectionSummary(connection: MetaAdsConnection | null) {
  if (!connection) {
    return {
      connected: false,
      tokenType: null,
      metaUserId: null,
      metaUserName: null,
      selectedAdAccountId: null,
      scopes: [],
      updatedAt: null,
      expiresAt: null,
    }
  }
  return {
    connected: true,
    tokenType: connection.tokenType,
    metaUserId: connection.metaUserId || null,
    metaUserName: connection.metaUserName || null,
    selectedAdAccountId: connection.selectedAdAccountId || null,
    scopes: Array.isArray(connection.scopes) ? connection.scopes : [],
    updatedAt: connection.updatedAt || null,
    expiresAt: connection.expiresAt || null,
  }
}

function resolveMissingConfig(context: any) {
  const cfg = runtimeConfig(context)
  const missing: string[] = []
  if (!cfg.appId) missing.push('META_APP_ID')
  if (!cfg.appSecret) missing.push('META_APP_SECRET')
  if (!cfg.stateSecret) missing.push('META_OAUTH_STATE_SECRET')
  if (integrationsEncryptionSecretRequired(context) && !getIntegrationsEncryptionSecret(context)) {
    missing.push('INTEGRATIONS_ENCRYPTION_SECRET')
  }
  if (!getShareBucket(context)) missing.push('SHARE_BUCKET')
  return missing
}

function resolveOauthStartMissingConfig(context: any) {
  const cfg = runtimeConfig(context)
  const missing: string[] = []
  if (!cfg.appId) missing.push('META_APP_ID')
  if (!cfg.stateSecret) missing.push('META_OAUTH_STATE_SECRET')
  return missing
}

function parseRange(url: URL) {
  const until = String(url.searchParams.get('until') || '').trim() || new Date().toISOString().slice(0, 10)
  const since = String(url.searchParams.get('since') || '').trim() || (() => {
    const date = new Date()
    date.setDate(date.getDate() - 6)
    return date.toISOString().slice(0, 10)
  })()
  return { since, until }
}

function buildInventory(campaigns: any[], adsets: any[], ads: any[]) {
  const adsetsByCampaign = new Map<string, any[]>()
  const adsByAdset = new Map<string, any[]>()
  const creativesById = new Map<string, any>()

  for (const adset of adsets) {
    const list = adsetsByCampaign.get(adset.campaign_id || '') || []
    list.push({ ...adset, ads: [] as any[] })
    adsetsByCampaign.set(adset.campaign_id || '', list)
  }

  for (const ad of ads) {
    if (ad.creative?.id) {
      creativesById.set(ad.creative.id, {
        id: ad.creative.id,
        name: ad.creative.name || ad.name,
        thumbnailUrl: ad.creative.thumbnail_url || null,
        effectiveObjectStoryId: ad.creative.effective_object_story_id || null,
        adId: ad.id,
        adName: ad.name,
        adsetId: ad.adset_id || null,
        campaignId: ad.campaign_id || null,
      })
    }
    const list = adsByAdset.get(ad.adset_id || '') || []
    list.push(ad)
    adsByAdset.set(ad.adset_id || '', list)
  }

  const campaignsWithChildren = campaigns.map((campaign) => {
    const campaignAdsets = (adsetsByCampaign.get(campaign.id) || []).map((adset) => ({
      ...adset,
      ads: adsByAdset.get(adset.id) || [],
    }))
    return {
      ...campaign,
      adSets: campaignAdsets,
      totals: {
        adSets: campaignAdsets.length,
        ads: campaignAdsets.reduce((sum, adset) => sum + adset.ads.length, 0),
      },
    }
  })

  return {
    campaigns: campaignsWithChildren,
    adSets: adsets,
    ads,
    creatives: Array.from(creativesById.values()),
  }
}

async function readConnection(context: any, userId: string) {
  const bucket = getShareBucket(context)
  if (!bucket) throw new Error('SHARE_BUCKET_NOT_CONFIGURED')
  const secret = getIntegrationsEncryptionSecret(context)
  return readMetaAdsConnectionDecrypted(bucket, userId, secret)
}

async function writeConnection(context: any, userId: string, value: MetaAdsConnection) {
  const bucket = getShareBucket(context)
  if (!bucket) throw new Error('SHARE_BUCKET_NOT_CONFIGURED')
  const secret = getIntegrationsEncryptionSecret(context)
  await writeMetaAdsConnection(bucket, userId, value, secret)
}

async function fetchLiveAccounts(context: any, userId: string) {
  const cfg = runtimeConfig(context)
  const connection = await readConnection(context, userId)
  if (!connection?.accessToken) return { connection: null, accounts: [] as any[] }
  const accounts = await listMetaAdAccounts(connection.accessToken, cfg.graphVersion, cfg.appSecret)
  return { connection, accounts }
}

async function handleStatus(context: any) {
  const userOrRes = await requireSocialAdmin(context)
  if (userOrRes instanceof Response) return userOrRes
  const cfg = runtimeConfig(context)
  const missingConfig = resolveMissingConfig(context)

  let connection: MetaAdsConnection | null = null
  try {
    connection = await readConnection(context, userOrRes.id)
    if (connection && shouldRevalidateConnection(connection)) {
      try {
        const tokenValidation = await validateMetaAccessToken(connection.accessToken, cfg)
        connection = {
          ...connection,
          scopes: tokenValidation.grantedScopes,
          grantedScopes: tokenValidation.grantedScopes,
          expiresAt: tokenValidation.expiresAt || connection.expiresAt,
          dataAccessExpiresAt: tokenValidation.dataAccessExpiresAt || connection.dataAccessExpiresAt,
          lastValidatedAt: tokenValidation.lastValidatedAt,
        }
        await writeConnection(context, userOrRes.id, connection)
      } catch (error: any) {
        if (error instanceof MetaAdsRouteError && error.code === 'META_TOKEN_INVALID') {
          const bucket = getShareBucket(context)
          if (bucket) await deleteMetaAdsConnection(bucket, userOrRes.id)
          connection = null
        } else {
          throw error
        }
      }
    }
  } catch {
    connection = null
  }

  return json(200, {
    ok: true,
    oauthConfigured: missingConfig.length === 0,
    missingConfig,
    oauthMode: cfg.configId ? 'business-config' : 'scopes',
    businessLoginConfigId: cfg.configId || null,
    connection: connectionSummary(connection),
  })
}

async function handleOauthStart(context: any) {
  const userOrRes = await requireSocialAdmin(context)
  if (userOrRes instanceof Response) return userOrRes
  const cfg = runtimeConfig(context)
  const missing = resolveOauthStartMissingConfig(context)
  if (missing.length) {
    return apiError(503, 'META_ADS_OAUTH_NOT_CONFIGURED', {
      message: 'A integração Meta Ads ainda não está configurada neste runtime.',
      hint: `Faltam bindings/segredos obrigatórios: ${missing.join(', ')}`,
      retryable: false,
      extra: { missingConfig: missing },
    })
  }

  const origin = new URL(context.request.url).origin
  const redirectUri = `${origin}/api/meta-ads/oauth/callback`
  const state = await signState({ userId: userOrRes.id, nonce: crypto.randomUUID(), iat: Date.now() }, cfg.stateSecret)
  const qs = new URLSearchParams({
    client_id: cfg.appId,
    redirect_uri: redirectUri,
    state,
    response_type: 'code',
    display: 'popup',
  })
  if (cfg.configId) {
    qs.set('config_id', cfg.configId)
    qs.set('override_default_response_type', 'true')
  } else {
    qs.set('scope', cfg.scopes)
  }
  return Response.redirect(`https://www.facebook.com/${cfg.graphVersion}/dialog/oauth?${qs.toString()}`, 302)
}

async function fetchJson(url: string) {
  const res = await fetch(url, { headers: { accept: 'application/json' } })
  const data = await res.json().catch(() => null)
  if (!res.ok || data?.error) throw new Error(data?.error?.message || data?.error_description || `HTTP ${res.status}`)
  return data
}

async function handleOauthCallback(context: any) {
  const userOrRes = await requireSocialAdmin(context)
  if (userOrRes instanceof Response) return userOrRes
  const cfg = runtimeConfig(context)
  const missing = resolveMissingConfig(context)
  if (missing.length) {
    return buildOauthPopupResponse(
      {
        type: 'meta-ads:connected',
        ok: false,
        error: {
          code: 'META_ADS_OAUTH_NOT_CONFIGURED',
          message: 'A integração Meta Ads ainda não está pronta neste runtime.',
          hint: `Faltam bindings/segredos obrigatórios: ${missing.join(', ')}`,
        },
      },
      `Meta Ads OAuth não configurado: ${esc(missing.join(', '))}`,
    )
  }

  const url = new URL(context.request.url)
  const code = url.searchParams.get('code')
  const state = url.searchParams.get('state')
  const err = url.searchParams.get('error') || url.searchParams.get('error_reason')
  const errDesc = url.searchParams.get('error_description')
  if (err) {
    return buildOauthPopupResponse(
      {
        type: 'meta-ads:connected',
        ok: false,
        error: {
          code: String(err || 'OAUTH_DENIED'),
          message: 'A Meta não concluiu a autorização da conta.',
          hint: String(errDesc || 'Conclua a autorização no Facebook e tente novamente.'),
        },
      },
      `Erro OAuth: ${esc(err)}${errDesc ? `<br/>${esc(errDesc)}` : ''}`,
    )
  }
  if (!code || !state) {
    return buildOauthPopupResponse(
      {
        type: 'meta-ads:connected',
        ok: false,
        error: {
          code: 'OAUTH_CALLBACK_INVALID',
          message: 'A Meta retornou uma resposta incompleta para o CRM.',
          hint: 'Refaça a autenticação e confirme o login no Facebook.',
        },
      },
      'Callback inválido (code/state ausentes).',
    )
  }

  const verified = await verifyState<OAuthState>(state, cfg.stateSecret)
  if (!verified || verified.userId !== userOrRes.id) {
    return buildOauthPopupResponse(
      {
        type: 'meta-ads:connected',
        ok: false,
        error: {
          code: 'OAUTH_STATE_INVALID',
          message: 'A resposta de autenticação da Meta não corresponde à sessão atual.',
          hint: 'Feche a janela e reinicie o login pelo CRM.',
        },
      },
      'State inválido. Tente novamente.',
    )
  }
  if (Date.now() - Number(verified.iat || 0) > OAUTH_STATE_MAX_AGE_MS) {
    return buildOauthPopupResponse(
      {
        type: 'meta-ads:connected',
        ok: false,
        error: {
          code: 'OAUTH_STATE_EXPIRED',
          message: 'A tentativa de login expirou antes de concluir a autorização.',
          hint: 'Reinicie a conexão do Meta Ads pelo CRM.',
        },
      },
      'A tentativa de login expirou. Reinicie a conexão pelo CRM.',
    )
  }

  const origin = new URL(context.request.url).origin
  const redirectUri = `${origin}/api/meta-ads/oauth/callback`

  try {
    const tokenData = await fetchJson(
      `https://graph.facebook.com/${cfg.graphVersion}/oauth/access_token?` +
        new URLSearchParams({
          client_id: cfg.appId,
          client_secret: cfg.appSecret,
          redirect_uri: redirectUri,
          code,
        }).toString(),
    )
    const shortToken = String(tokenData?.access_token || '').trim()
    if (!shortToken) throw new Error('Token ausente no exchange')

    const longData = await fetchJson(
      `https://graph.facebook.com/${cfg.graphVersion}/oauth/access_token?` +
        new URLSearchParams({
          grant_type: 'fb_exchange_token',
          client_id: cfg.appId,
          client_secret: cfg.appSecret,
          fb_exchange_token: shortToken,
        }).toString(),
    )

    const accessToken = String(longData?.access_token || '').trim() || shortToken
    const [profile, tokenValidation] = await Promise.all([
      getMetaProfile(accessToken, cfg.graphVersion, cfg.appSecret),
      validateMetaAccessToken(accessToken, cfg),
    ])

    await writeConnection(context, userOrRes.id, {
      accessToken,
      tokenType: 'oauth',
      metaUserId: String(profile?.id || '').trim() || undefined,
      metaUserName: String(profile?.name || '').trim() || undefined,
      scopes: tokenValidation.grantedScopes,
      grantedScopes: tokenValidation.grantedScopes,
      expiresAt:
        tokenValidation.expiresAt ||
        (longData?.expires_in ? new Date(Date.now() + Number(longData.expires_in || 0) * 1000).toISOString() : undefined),
      dataAccessExpiresAt: tokenValidation.dataAccessExpiresAt,
      lastValidatedAt: tokenValidation.lastValidatedAt,
      updatedAt: new Date().toISOString(),
    })

    return buildOauthPopupResponse(
      {
        type: 'meta-ads:connected',
        ok: true,
      },
      'Conta Meta Ads conectada. Você pode fechar esta janela.',
    )
  } catch (error: any) {
    const routeError = error instanceof MetaAdsRouteError ? error : null
    return buildOauthPopupResponse(
      {
        type: 'meta-ads:connected',
        ok: false,
        error: {
          code: routeError?.code || 'META_OAUTH_CONNECT_FAILED',
          message: routeError?.message || 'Falha ao conectar a conta Meta.',
          hint: routeError?.hint || error?.message || 'Tente novamente e revise o app Meta configurado no CRM.',
        },
      },
      `Falha ao conectar: ${esc(routeError?.message || error?.message || 'Erro')}`,
    )
  }
}

async function handleManualConnect(context: any) {
  const userOrRes = await requireSocialAdmin(context)
  if (userOrRes instanceof Response) return userOrRes
  const csrfRes = requireCsrfForMutations(context)
  if (csrfRes) return csrfRes

  const body = await context.request.json().catch(() => null)
  const accessToken = String(body?.accessToken || body?.token || '').trim()
  if (!accessToken) {
    return apiError(400, 'INVALID_INPUT', {
      message: 'Informe um access token válido da Meta.',
      hint: 'Cole o access token completo antes de enviar.',
      retryable: false,
    })
  }

  try {
    const cfg = runtimeConfig(context)
    const [profile, tokenValidation, accounts] = await Promise.all([
      getMetaProfile(accessToken, cfg.graphVersion, cfg.appSecret),
      validateMetaAccessToken(accessToken, cfg),
      listMetaAdAccounts(accessToken, cfg.graphVersion, cfg.appSecret),
    ])
    await writeConnection(context, userOrRes.id, {
      accessToken,
      tokenType: 'manual',
      metaUserId: String(profile?.id || '').trim() || undefined,
      metaUserName: String(profile?.name || '').trim() || undefined,
      scopes: tokenValidation.grantedScopes,
      grantedScopes: tokenValidation.grantedScopes,
      expiresAt: tokenValidation.expiresAt,
      dataAccessExpiresAt: tokenValidation.dataAccessExpiresAt,
      lastValidatedAt: tokenValidation.lastValidatedAt,
      updatedAt: new Date().toISOString(),
      selectedAdAccountId: accounts[0]?.id || undefined,
    })
    return json(200, {
      ok: true,
      connected: true,
      accountCount: accounts.length,
      connection: connectionSummary(await readConnection(context, userOrRes.id)),
    })
  } catch (error: any) {
    return apiError(400, 'TOKEN_INVALID', {
      message: error?.message || 'Token inválido',
      hint: 'Revise se o token ainda está ativo e se possui os escopos esperados pela integração.',
      retryable: false,
    })
  }
}

async function handleDisconnect(context: any) {
  const userOrRes = await requireSocialAdmin(context)
  if (userOrRes instanceof Response) return userOrRes
  const csrfRes = requireCsrfForMutations(context)
  if (csrfRes) return csrfRes

  const bucket = getShareBucket(context)
  if (!bucket) {
    return apiError(503, 'SHARE_BUCKET_NOT_CONFIGURED', {
      message: 'O armazenamento seguro da integração não está configurado.',
      hint: 'Verifique o binding SHARE_BUCKET do Pages runtime.',
      retryable: false,
    })
  }
  await deleteMetaAdsConnection(bucket, userOrRes.id)
  return json(200, { ok: true, disconnected: true })
}

async function handleListAccounts(context: any) {
  const userOrRes = await requireSocialAdmin(context)
  if (userOrRes instanceof Response) return userOrRes

  const { connection, accounts } = await fetchLiveAccounts(context, userOrRes.id)
  if (!connection?.accessToken) return json(200, { ok: true, connected: false, accounts: [] })

  return json(200, {
    ok: true,
    connected: true,
    selectedAdAccountId: connection.selectedAdAccountId || null,
    accounts: accounts.map((account) => ({
      ...account,
      isSelected: connection.selectedAdAccountId === account.id,
    })),
  })
}

async function handleSelectAccount(context: any) {
  const userOrRes = await requireSocialAdmin(context)
  if (userOrRes instanceof Response) return userOrRes
  const csrfRes = requireCsrfForMutations(context)
  if (csrfRes) return csrfRes

  const body = await context.request.json().catch(() => null)
  const adAccountId = String(body?.adAccountId || '').trim()
  if (!adAccountId) {
    return apiError(400, 'INVALID_INPUT', {
      message: 'Informe a conta de anúncios que deve ser selecionada.',
      hint: 'Escolha uma conta válida na lista antes de salvar.',
      retryable: false,
    })
  }

  const connection = await readConnection(context, userOrRes.id)
  if (!connection?.accessToken) {
    return apiError(404, 'NOT_CONNECTED', {
      message: 'Nenhuma conexão Meta ativa foi encontrada para este usuário.',
      hint: 'Conecte a conta Meta primeiro e depois selecione a conta de anúncios.',
      retryable: false,
    })
  }
  const cfg = runtimeConfig(context)
  const accounts = await listMetaAdAccounts(connection.accessToken, cfg.graphVersion, cfg.appSecret)
  const selected = accounts.find((account) => account.id === adAccountId)
  if (!selected) {
    return apiError(404, 'ACCOUNT_NOT_FOUND', {
      message: 'A conta de anúncios informada não foi encontrada para este usuário/token.',
      hint: 'Atualize a lista de contas antes de tentar selecionar novamente.',
      retryable: true,
    })
  }

  await writeConnection(context, userOrRes.id, {
    ...connection,
    selectedAdAccountId: adAccountId,
    updatedAt: new Date().toISOString(),
  })
  return json(200, { ok: true, selectedAdAccountId: adAccountId })
}

async function withSelectedAccount(
  context: any,
  userId: string,
): Promise<
  | { connection: MetaAdsConnection; adAccountId: string }
  | { error: Response }
> {
  const connection = await readConnection(context, userId)
  if (!connection?.accessToken) {
    return {
      error: apiError(404, 'NOT_CONNECTED', {
        message: 'A conta Meta ainda não está conectada.',
        hint: 'Use a aba Conexão para autenticar o Facebook ou validar um token manual.',
        retryable: false,
      }),
    }
  }
  const adAccountId = String(connection.selectedAdAccountId || '').trim()
  if (!adAccountId) {
    return {
      error: apiError(400, 'AD_ACCOUNT_NOT_SELECTED', {
        message: 'Nenhuma conta de anúncios foi selecionada.',
        hint: 'Escolha uma conta na aba Conexão para liberar visão geral e inventário.',
        retryable: false,
      }),
    }
  }
  return { connection, adAccountId }
}

async function handleSummary(context: any) {
  const userOrRes = await requireSocialAdmin(context)
  if (userOrRes instanceof Response) return userOrRes
  const selected = await withSelectedAccount(context, userOrRes.id)
  if ('error' in selected) return selected.error

  const cfg = runtimeConfig(context)
  const range = parseRange(new URL(context.request.url))
  try {
    const workflowSummary = await fetchWorkflowSummary(selected.adAccountId, range, cfg)
    if (workflowSummary) {
      return json(200, workflowSummary)
    }
  } catch {
    // Fallback seguro para Graph quando o worker consolidado não está disponível.
  }

  const [summary, campaigns] = await Promise.all([
    getMetaAdsSummary(selected.connection.accessToken, selected.adAccountId, range, cfg.graphVersion, cfg.appSecret),
    listMetaCampaigns(selected.connection.accessToken, selected.adAccountId, cfg.graphVersion, cfg.appSecret),
  ])

  return json(200, {
    ...summary,
    source: 'graph',
    activeCampaigns: campaigns.filter((campaign) => String(campaign.status || '').toUpperCase() === 'ACTIVE').length,
  })
}

async function handleTrend(context: any) {
  const userOrRes = await requireSocialAdmin(context)
  if (userOrRes instanceof Response) return userOrRes
  const selected = await withSelectedAccount(context, userOrRes.id)
  if ('error' in selected) return selected.error

  const cfg = runtimeConfig(context)
  const range = parseRange(new URL(context.request.url))
  const trend = await getMetaAdsTrend(
    selected.connection.accessToken,
    selected.adAccountId,
    range,
    cfg.graphVersion,
    cfg.appSecret,
  )
  return json(200, trend)
}

async function handleReport(context: any) {
  const userOrRes = await requireSocialAdmin(context)
  if (userOrRes instanceof Response) return userOrRes
  const selected = await withSelectedAccount(context, userOrRes.id)
  if ('error' in selected) return selected.error

  const cfg = runtimeConfig(context)
  const range = parseRange(new URL(context.request.url))

  try {
    const report = await fetchWorkflowReport(selected.adAccountId, range, cfg)
    if (report) {
      return json(200, report)
    }
  } catch {
    // fallback seguro abaixo
  }

  const [summary, campaigns] = await Promise.all([
    getMetaAdsSummary(selected.connection.accessToken, selected.adAccountId, range, cfg.graphVersion, cfg.appSecret),
    listMetaCampaigns(selected.connection.accessToken, selected.adAccountId, cfg.graphVersion, cfg.appSecret),
  ])

  return json(200, {
    ok: true,
    source: 'graph-fallback',
    window: resolveWorkflowSummaryWindow(range),
    summary: {
      ...summary,
      source: 'graph',
      activeCampaigns: campaigns.filter((campaign) => String(campaign.status || '').toUpperCase() === 'ACTIVE').length,
    },
    metadata: {
      reportDate: String(range.until || '').trim(),
      runsCount: 0,
      source: 'graph',
    },
    campaigns: campaigns.map((campaign) => ({
      campaignId: campaign.id,
      campaignName: campaign.name || campaign.id,
      status: String(campaign.effective_status || campaign.status || '').trim().toUpperCase() || 'UNKNOWN',
      spend: 0,
      impressions: 0,
      clicks: 0,
      conversations: 0,
      ctr: 0,
      cpc: 0,
      cpm: 0,
    })),
    warnings: ['graph_fallback'],
  })
}

async function handleInventory(context: any) {
  const userOrRes = await requireSocialAdmin(context)
  if (userOrRes instanceof Response) return userOrRes
  const selected = await withSelectedAccount(context, userOrRes.id)
  if ('error' in selected) return selected.error

  const cfg = runtimeConfig(context)
  const [campaigns, adSets, ads] = await Promise.all([
    listMetaCampaigns(selected.connection.accessToken, selected.adAccountId, cfg.graphVersion, cfg.appSecret),
    listMetaAdSets(selected.connection.accessToken, selected.adAccountId, cfg.graphVersion, cfg.appSecret),
    listMetaAds(selected.connection.accessToken, selected.adAccountId, cfg.graphVersion, cfg.appSecret),
  ])

  return json(200, {
    ok: true,
    accountId: selected.adAccountId,
    inventory: buildInventory(campaigns, adSets, ads),
  })
}

export async function onRequest(context: any): Promise<Response> {
  try {
    const request: Request = context.request
    const method = String(request.method || 'GET').toUpperCase()
    const url = new URL(request.url)
    const prefix = '/api/meta-ads'
    const rest = url.pathname.startsWith(prefix) ? url.pathname.slice(prefix.length) || '/' : url.pathname

    if (method === 'GET' && (rest === '/status' || rest === '/status/')) return handleStatus(context)
    if (method === 'GET' && (rest === '/oauth/start' || rest === '/oauth/start/')) return handleOauthStart(context)
    if (method === 'GET' && (rest === '/oauth/callback' || rest === '/oauth/callback/')) return handleOauthCallback(context)
    if (method === 'POST' && (rest === '/connect/manual' || rest === '/connect/manual/')) return handleManualConnect(context)
    if (method === 'POST' && (rest === '/disconnect' || rest === '/disconnect/')) return handleDisconnect(context)
    if (method === 'GET' && (rest === '/ad-accounts' || rest === '/ad-accounts/')) return handleListAccounts(context)
    if (method === 'POST' && (rest === '/ad-accounts/select' || rest === '/ad-accounts/select/')) return handleSelectAccount(context)
    if (method === 'GET' && (rest === '/summary' || rest === '/summary/')) return handleSummary(context)
    if (method === 'GET' && (rest === '/trend' || rest === '/trend/')) return handleTrend(context)
    if (method === 'GET' && (rest === '/report' || rest === '/report/')) return handleReport(context)
    if (method === 'GET' && (rest === '/inventory' || rest === '/inventory/')) return handleInventory(context)

    return apiError(404, 'NOT_FOUND', {
      message: 'Endpoint Meta Ads não encontrado.',
      hint: 'Revise a rota solicitada em /api/meta-ads/*.',
      retryable: false,
    })
  } catch (error: any) {
    const mapped = normalizeUnhandledMetaError(error)
    if (mapped) {
      return apiError(mapped.status, mapped.code, {
        message: mapped.message,
        hint: mapped.hint,
        retryable: mapped.retryable,
        extra: mapped.extra,
      })
    }
    if (error instanceof MetaAdsRouteError) {
      return apiError(error.status, error.code, {
        message: error.message,
        hint: error.hint,
        retryable: error.retryable,
        extra: error.extra,
      })
    }
    return apiError(500, 'META_ADS_INTERNAL_ERROR', {
      message: 'A API Meta Ads encontrou um erro inesperado.',
      hint: error?.message || 'Erro interno.',
      retryable: true,
    })
  }
}
