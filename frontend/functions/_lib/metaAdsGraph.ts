const DEFAULT_GRAPH_VERSION = 'v20.0'

const esc = (value: unknown) => String(value ?? '').trim()

export type MetaAdAccount = {
  id: string
  name: string
  account_status?: string
  disable_reason?: string
  currency?: string
  timezone_name?: string
  business_name?: string
}

export type MetaCampaign = {
  id: string
  name: string
  status?: string
  effective_status?: string
  objective?: string
  daily_budget?: string
  lifetime_budget?: string
  start_time?: string
  stop_time?: string
}

export type MetaAdSet = {
  id: string
  name: string
  status?: string
  effective_status?: string
  campaign_id?: string
  daily_budget?: string
  lifetime_budget?: string
  bid_strategy?: string
  optimization_goal?: string
  start_time?: string
  end_time?: string
}

export type MetaAd = {
  id: string
  name: string
  status?: string
  effective_status?: string
  campaign_id?: string
  campaign_name?: string
  adset_id?: string
  adset_name?: string
  creative?: {
    id?: string
    name?: string
    thumbnail_url?: string
    image_url?: string
    effective_object_story_id?: string
    object_story_id?: string
    object_story_spec?: unknown
    asset_feed_spec?: unknown
    image_hash?: string
    video_id?: string
    title?: string
    body?: string
    call_to_action_type?: string
    url_tags?: string
    instagram_permalink_url?: string
    object_url?: string
  }
}

export type MetaSummary = {
  spend: number
  impressions: number
  clicks: number
  roas: number
  activeCampaigns: number
}

export type MetaInsightsLevel = 'campaign' | 'adset' | 'ad'

export type MetaInsight = {
  campaign_id?: string
  campaign_name?: string
  adset_id?: string
  adset_name?: string
  ad_id?: string
  ad_name?: string
  spend: number
  reach?: number
  impressions: number
  clicks: number
  linkClicks?: number
  engagement?: number
  instagramProfileVisits?: number
  conversations: number
  ctr: number
  linkCtr?: number
  cpc: number
  linkCpc?: number
  cpm: number
  cpp?: number
  frequency?: number
}

export type MetaAdsEntityType = 'campaign' | 'adset' | 'ad' | 'creative'

const ENTITY_DETAIL_FIELDS: Record<MetaAdsEntityType, string> = {
  campaign:
    'id,account_id,name,status,effective_status,objective,daily_budget,lifetime_budget,bid_strategy,buying_type,special_ad_categories,start_time,stop_time,created_time,updated_time,issues_info,recommendations',
  adset:
    'id,account_id,name,status,effective_status,campaign{id,name},campaign_id,daily_budget,lifetime_budget,bid_strategy,billing_event,optimization_goal,promoted_object,targeting,start_time,end_time,created_time,updated_time,issues_info,recommendations',
  ad:
    'id,account_id,name,status,effective_status,campaign{id,name},adset{id,name},creative{id,name,thumbnail_url,image_url,effective_object_story_id,object_story_id,object_story_spec,asset_feed_spec,image_hash,video_id,url_tags,title,body,call_to_action_type,instagram_permalink_url,object_url},tracking_specs,conversion_specs,created_time,updated_time,issues_info,recommendations',
  creative:
    'id,account_id,name,thumbnail_url,image_url,effective_object_story_id,object_story_id,object_story_spec,asset_feed_spec,image_hash,video_id,body,title,call_to_action_type,url_tags,instagram_permalink_url,object_url,created_time,updated_time',
}

const ENTITY_SAFE_DETAIL_FIELDS: Record<MetaAdsEntityType, string> = {
  campaign: 'id,account_id,name,status,effective_status,objective,daily_budget,lifetime_budget,start_time,stop_time,created_time,updated_time',
  adset: 'id,account_id,name,status,effective_status,campaign{id,name},campaign_id,daily_budget,lifetime_budget,bid_strategy,optimization_goal,start_time,end_time,created_time,updated_time',
  ad: 'id,account_id,name,status,effective_status,campaign{id,name},adset{id,name},creative{id,name,thumbnail_url,image_url,effective_object_story_id,object_story_id,object_story_spec,asset_feed_spec,image_hash,video_id,title,body,call_to_action_type,url_tags,instagram_permalink_url,object_url},created_time,updated_time',
  creative: 'id,account_id,name,thumbnail_url,image_url,effective_object_story_id,object_story_id,object_story_spec,asset_feed_spec,image_hash,video_id,title,body,call_to_action_type,url_tags,instagram_permalink_url,object_url',
}

function parseGraphBaseUrl(version?: string) {
  return `https://graph.facebook.com/${esc(version) || DEFAULT_GRAPH_VERSION}`
}

function asNumber(value: unknown) {
  const parsed = Number(value || 0)
  return Number.isFinite(parsed) ? parsed : 0
}

function parseRoas(value: unknown) {
  if (Array.isArray(value)) {
    const first = value.find((item) => item && typeof item === 'object' && 'value' in item)
    return asNumber((first as any)?.value)
  }
  return asNumber(value)
}

function parseActionValue(actions: unknown, candidates: string[]) {
  if (!Array.isArray(actions)) return 0
  const wanted = new Set(candidates.map((item) => item.toLowerCase()))
  return actions.reduce((sum, action) => {
    const type = esc((action as any)?.action_type).toLowerCase()
    if (!type || !wanted.has(type)) return sum
    return sum + asNumber((action as any)?.value)
  }, 0)
}

function parseOptionalNumber(value: unknown) {
  if (value === null || value === undefined || value === '') return undefined
  const numeric = Number(value)
  return Number.isFinite(numeric) ? numeric : undefined
}

function percent(numerator: number, denominator: number) {
  if (!denominator) return 0
  return Math.round((numerator / denominator) * 10000) / 100
}

function moneyRatio(numerator: number, denominator: number) {
  if (!denominator) return 0
  return Math.round((numerator / denominator) * 100) / 100
}

function normalizeAccountId(adAccountId: string) {
  const raw = esc(adAccountId)
  if (!raw) return raw
  return raw.startsWith('act_') ? raw : `act_${raw}`
}

async function buildAppSecretProof(accessToken: string, appSecret?: string) {
  const secret = esc(appSecret)
  if (!secret) return ''
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(accessToken))
  return Array.from(new Uint8Array(sig)).map((byte) => byte.toString(16).padStart(2, '0')).join('')
}

async function graphFetch<T = any>(
  path: string,
  params: Record<string, string | number | undefined>,
  accessToken: string,
  version?: string,
  appSecret?: string,
): Promise<T> {
  const qs = new URLSearchParams()
  for (const [key, value] of Object.entries(params || {})) {
    if (value == null || value === '') continue
    qs.set(key, String(value))
  }
  qs.set('access_token', accessToken)
  const appSecretProof = await buildAppSecretProof(accessToken, appSecret)
  if (appSecretProof) qs.set('appsecret_proof', appSecretProof)

  const url = `${parseGraphBaseUrl(version)}${path.startsWith('/') ? '' : '/'}${path}?${qs.toString()}`
  const res = await fetch(url, { headers: { accept: 'application/json' } })
  const data = await res.json().catch(() => null)
  if (!res.ok || data?.error) {
    throw new Error(data?.error?.message || data?.error_description || `Meta Graph HTTP ${res.status}`)
  }
  return data as T
}

async function graphPost<T = any>(
  path: string,
  params: Record<string, string | number | boolean | undefined | null>,
  accessToken: string,
  version?: string,
  appSecret?: string,
): Promise<T> {
  const body = new URLSearchParams()
  for (const [key, value] of Object.entries(params || {})) {
    if (value == null || value === '') continue
    body.set(key, String(value))
  }
  body.set('access_token', accessToken)
  const appSecretProof = await buildAppSecretProof(accessToken, appSecret)
  if (appSecretProof) body.set('appsecret_proof', appSecretProof)

  const url = `${parseGraphBaseUrl(version)}${path.startsWith('/') ? '' : '/'}${path}`
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      accept: 'application/json',
      'content-type': 'application/x-www-form-urlencoded',
    },
    body,
  })
  const data = await res.json().catch(() => null)
  if (!res.ok || data?.error) {
    const err = data?.error || {}
    const message = err?.error_user_msg || err?.message || data?.error_description || `Meta Graph HTTP ${res.status}`
    const error = new Error(message)
    ;(error as any).meta = err
    ;(error as any).status = res.status
    throw error
  }
  return data as T
}

async function collectPaged<T = any>(
  path: string,
  params: Record<string, string | number | undefined>,
  accessToken: string,
  version?: string,
  appSecret?: string,
): Promise<T[]> {
  const out: T[] = []
  let nextUrl: string | null = null
  let first = true

  while (first || nextUrl) {
    let data: any
    if (first) {
      data = await graphFetch<any>(path, params, accessToken, version, appSecret)
      first = false
    } else {
      const next = new URL(String(nextUrl))
      const appSecretProof = await buildAppSecretProof(accessToken, appSecret)
      if (appSecretProof && !next.searchParams.has('appsecret_proof')) {
        next.searchParams.set('appsecret_proof', appSecretProof)
      }
      const res = await fetch(String(next), { headers: { accept: 'application/json' } })
      data = await res.json().catch(() => null)
      if (!res.ok || data?.error) {
        throw new Error(data?.error?.message || data?.error_description || `Meta Graph HTTP ${res.status}`)
      }
    }

    if (Array.isArray(data?.data)) out.push(...data.data)
    nextUrl = esc(data?.paging?.next) || null
  }

  return out
}

export async function getMetaProfile(accessToken: string, version?: string, appSecret?: string) {
  return graphFetch<{ id: string; name?: string }>(
    '/me',
    { fields: 'id,name' },
    accessToken,
    version,
    appSecret,
  )
}

export async function listMetaAdAccounts(accessToken: string, version?: string, appSecret?: string): Promise<MetaAdAccount[]> {
  const rows = await collectPaged<any>(
    '/me/adaccounts',
    {
      fields: 'id,name,account_status,disable_reason,currency,timezone_name,business_name',
      limit: 100,
    },
    accessToken,
    version,
    appSecret,
  )
  return rows.map((row) => ({
    id: esc(row?.id),
    name: esc(row?.name),
    account_status: esc(row?.account_status),
    disable_reason: esc(row?.disable_reason),
    currency: esc(row?.currency),
    timezone_name: esc(row?.timezone_name),
    business_name: esc(row?.business_name),
  })).filter((row) => row.id)
}

export async function listMetaCampaigns(accessToken: string, adAccountId: string, version?: string, appSecret?: string): Promise<MetaCampaign[]> {
  const rows = await collectPaged<any>(
    `/${normalizeAccountId(adAccountId)}/campaigns`,
    {
      fields: 'id,name,status,effective_status,objective,daily_budget,lifetime_budget,start_time,stop_time',
      limit: 200,
    },
    accessToken,
    version,
    appSecret,
  )
  return rows.map((row) => ({
    id: esc(row?.id),
    name: esc(row?.name),
    status: esc(row?.status),
    effective_status: esc(row?.effective_status),
    objective: esc(row?.objective),
    daily_budget: esc(row?.daily_budget),
    lifetime_budget: esc(row?.lifetime_budget),
    start_time: esc(row?.start_time),
    stop_time: esc(row?.stop_time),
  })).filter((row) => row.id)
}

export async function listMetaAdSets(accessToken: string, adAccountId: string, version?: string, appSecret?: string): Promise<MetaAdSet[]> {
  const rows = await collectPaged<any>(
    `/${normalizeAccountId(adAccountId)}/adsets`,
    {
      fields: 'id,name,status,effective_status,campaign_id,daily_budget,lifetime_budget,bid_strategy,optimization_goal,start_time,end_time',
      limit: 500,
    },
    accessToken,
    version,
    appSecret,
  )
  return rows.map((row) => ({
    id: esc(row?.id),
    name: esc(row?.name),
    status: esc(row?.status),
    effective_status: esc(row?.effective_status),
    campaign_id: esc(row?.campaign_id),
    daily_budget: esc(row?.daily_budget),
    lifetime_budget: esc(row?.lifetime_budget),
    bid_strategy: esc(row?.bid_strategy),
    optimization_goal: esc(row?.optimization_goal),
    start_time: esc(row?.start_time),
    end_time: esc(row?.end_time),
  })).filter((row) => row.id)
}

export async function listMetaAds(accessToken: string, adAccountId: string, version?: string, appSecret?: string): Promise<MetaAd[]> {
  const rows = await collectPaged<any>(
    `/${normalizeAccountId(adAccountId)}/ads`,
    {
      fields: 'id,name,status,effective_status,campaign{id,name},adset{id,name},creative{id,name,thumbnail_url,image_url,effective_object_story_id}',
      limit: 500,
    },
    accessToken,
    version,
    appSecret,
  )
  return rows.map((row) => ({
    id: esc(row?.id),
    name: esc(row?.name),
    status: esc(row?.status),
    effective_status: esc(row?.effective_status),
    campaign_id: esc(row?.campaign?.id),
    campaign_name: esc(row?.campaign?.name),
    adset_id: esc(row?.adset?.id),
    adset_name: esc(row?.adset?.name),
    creative: row?.creative
      ? {
          id: esc(row.creative.id),
          name: esc(row.creative.name),
          thumbnail_url: esc(row.creative.thumbnail_url),
          image_url: esc(row.creative.image_url),
          effective_object_story_id: esc(row.creative.effective_object_story_id),
        }
      : undefined,
  })).filter((row) => row.id)
}

export async function getMetaAdsSummary(
  accessToken: string,
  adAccountId: string,
  range: { since: string; until: string },
  version?: string,
  appSecret?: string,
): Promise<MetaSummary> {
  const data = await graphFetch<any>(
    `/${normalizeAccountId(adAccountId)}/insights`,
    {
      fields: 'spend,impressions,clicks,purchase_roas',
      level: 'account',
      time_range: JSON.stringify({ since: range.since, until: range.until }),
      limit: 1,
    },
    accessToken,
    version,
    appSecret,
  )
  const row = Array.isArray(data?.data) ? data.data[0] || {} : {}
  return {
    spend: asNumber(row?.spend),
    impressions: asNumber(row?.impressions),
    clicks: asNumber(row?.clicks),
    roas: parseRoas(row?.purchase_roas),
    activeCampaigns: 0,
  }
}

export async function getMetaAdsTrend(
  accessToken: string,
  adAccountId: string,
  range: { since: string; until: string },
  version?: string,
  appSecret?: string,
) {
  const data = await graphFetch<any>(
    `/${normalizeAccountId(adAccountId)}/insights`,
    {
      fields: 'date_start,spend',
      level: 'account',
      time_range: JSON.stringify({ since: range.since, until: range.until }),
      time_increment: 1,
      limit: 100,
    },
    accessToken,
    version,
    appSecret,
  )
  const rows = Array.isArray(data?.data) ? data.data : []
  return rows.map((row: any) => ({
    day: esc(row?.date_start),
    spend: asNumber(row?.spend),
  }))
}

export async function listMetaAdsInsights(
  accessToken: string,
  adAccountId: string,
  level: MetaInsightsLevel,
  range: { since: string; until: string },
  version?: string,
  appSecret?: string,
): Promise<MetaInsight[]> {
  const identityFields = ['campaign_id', 'campaign_name', 'adset_id', 'adset_name', 'ad_id', 'ad_name']
  const metricFields = ['spend', 'reach', 'impressions', 'clicks', 'inline_link_clicks', 'ctr', 'cpc', 'cpm', 'cpp', 'frequency']
  const collectInsights = (fields: string[]) => collectPaged<any>(
    `/${normalizeAccountId(adAccountId)}/insights`,
    {
      fields: fields.join(','),
      level,
      time_range: JSON.stringify({ since: range.since, until: range.until }),
      limit: 500,
    },
    accessToken,
    version,
    appSecret,
  )
  let rows: any[]
  try {
    rows = await collectInsights([...identityFields, ...metricFields, 'actions'])
  } catch {
    // Some accounts/apps reject richer action fields. Keep operational metrics available.
    rows = await collectInsights([...identityFields, ...metricFields])
  }

  return rows.map((row) => {
    const spend = asNumber(row?.spend)
    const impressions = asNumber(row?.impressions)
    const clicks = asNumber(row?.clicks)
    const linkClicks = parseOptionalNumber(row?.inline_link_clicks)
    const conversations = parseActionValue(row?.actions, [
      'onsite_conversion.messaging_conversation_started_7d',
      'onsite_conversion.messaging_conversation_started',
      'onsite_conversion.total_messaging_connection',
      'onsite_conversion.messaging_first_reply',
    ])
    const engagement = parseActionValue(row?.actions, [
      'post_engagement',
      'page_engagement',
      'post_reaction',
      'comment',
      'like',
    ])
    const instagramProfileVisits = parseActionValue(row?.actions, [
      'instagram_profile_visit',
      'ig_profile_visit',
      'onsite_conversion.instagram_profile_visit',
    ])

    return {
      campaign_id: esc(row?.campaign_id),
      campaign_name: esc(row?.campaign_name),
      adset_id: esc(row?.adset_id),
      adset_name: esc(row?.adset_name),
      ad_id: esc(row?.ad_id),
      ad_name: esc(row?.ad_name),
      spend,
      reach: parseOptionalNumber(row?.reach),
      impressions,
      clicks,
      linkClicks,
      engagement: engagement || undefined,
      instagramProfileVisits: instagramProfileVisits || undefined,
      conversations,
      ctr: parseOptionalNumber(row?.ctr) ?? percent(clicks, impressions),
      linkCtr: linkClicks === undefined ? undefined : percent(linkClicks, impressions),
      cpc: parseOptionalNumber(row?.cpc) ?? moneyRatio(spend, clicks),
      linkCpc: linkClicks === undefined ? undefined : moneyRatio(spend, linkClicks),
      cpm: parseOptionalNumber(row?.cpm) ?? moneyRatio(spend * 1000, impressions),
      cpp: parseOptionalNumber(row?.cpp),
      frequency: parseOptionalNumber(row?.frequency),
    }
  })
}

export async function getMetaAdsEntityDetail(
  accessToken: string,
  type: MetaAdsEntityType,
  id: string,
  version?: string,
  appSecret?: string,
) {
  const cleanId = esc(id)
  if (!cleanId) throw new Error('Meta Ads entity id is required')
  try {
    return await graphFetch<any>(
      `/${cleanId}`,
      { fields: ENTITY_DETAIL_FIELDS[type] },
      accessToken,
      version,
      appSecret,
    )
  } catch (error) {
    const detail = await graphFetch<any>(
      `/${cleanId}`,
      { fields: ENTITY_SAFE_DETAIL_FIELDS[type] },
      accessToken,
      version,
      appSecret,
    )
    detail._crm_detail_warning = String((error as Error | null)?.message || error || 'detail_fields_fallback')
    return detail
  }
}

export async function updateMetaAdsEntity(
  accessToken: string,
  type: Exclude<MetaAdsEntityType, 'creative'>,
  id: string,
  patch: Record<string, string | number | boolean | undefined | null>,
  version?: string,
  appSecret?: string,
) {
  const cleanId = esc(id)
  if (!cleanId) throw new Error('Meta Ads entity id is required')
  return graphPost<any>(`/${cleanId}`, patch, accessToken, version, appSecret)
}

export async function debugMetaAccessToken(
  inputToken: string,
  appId: string,
  appSecret: string,
  version?: string,
) {
  const appAccessToken = `${esc(appId)}|${esc(appSecret)}`
  return graphFetch<any>(
    '/debug_token',
    {
      input_token: inputToken,
    },
    appAccessToken,
    version,
    appSecret,
  )
}
