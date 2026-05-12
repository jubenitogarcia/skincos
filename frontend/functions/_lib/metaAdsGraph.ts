const DEFAULT_GRAPH_VERSION = 'v20.0'

const esc = (value: unknown) => String(value ?? '').trim()

export type MetaAdAccount = {
  id: string
  name: string
  account_status?: string
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
    effective_object_story_id?: string
  }
}

export type MetaSummary = {
  spend: number
  impressions: number
  clicks: number
  roas: number
  activeCampaigns: number
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

function normalizeAccountId(adAccountId: string) {
  const raw = esc(adAccountId)
  if (!raw) return raw
  return raw.startsWith('act_') ? raw : `act_${raw}`
}

async function graphFetch<T = any>(
  path: string,
  params: Record<string, string | number | undefined>,
  accessToken: string,
  version?: string,
): Promise<T> {
  const qs = new URLSearchParams()
  for (const [key, value] of Object.entries(params || {})) {
    if (value == null || value === '') continue
    qs.set(key, String(value))
  }
  qs.set('access_token', accessToken)

  const url = `${parseGraphBaseUrl(version)}${path.startsWith('/') ? '' : '/'}${path}?${qs.toString()}`
  const res = await fetch(url, { headers: { accept: 'application/json' } })
  const data = await res.json().catch(() => null)
  if (!res.ok || data?.error) {
    throw new Error(data?.error?.message || data?.error_description || `Meta Graph HTTP ${res.status}`)
  }
  return data as T
}

async function collectPaged<T = any>(
  path: string,
  params: Record<string, string | number | undefined>,
  accessToken: string,
  version?: string,
): Promise<T[]> {
  const out: T[] = []
  let nextUrl: string | null = null
  let first = true

  while (first || nextUrl) {
    let data: any
    if (first) {
      data = await graphFetch<any>(path, params, accessToken, version)
      first = false
    } else {
      const res = await fetch(String(nextUrl), { headers: { accept: 'application/json' } })
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

export async function getMetaProfile(accessToken: string, version?: string) {
  return graphFetch<{ id: string; name?: string }>(
    '/me',
    { fields: 'id,name' },
    accessToken,
    version,
  )
}

export async function listMetaAdAccounts(accessToken: string, version?: string): Promise<MetaAdAccount[]> {
  const rows = await collectPaged<any>(
    '/me/adaccounts',
    {
      fields: 'id,name,account_status,currency,timezone_name,business_name',
      limit: 100,
    },
    accessToken,
    version,
  )
  return rows.map((row) => ({
    id: esc(row?.id),
    name: esc(row?.name),
    account_status: esc(row?.account_status),
    currency: esc(row?.currency),
    timezone_name: esc(row?.timezone_name),
    business_name: esc(row?.business_name),
  })).filter((row) => row.id)
}

export async function listMetaCampaigns(accessToken: string, adAccountId: string, version?: string): Promise<MetaCampaign[]> {
  const rows = await collectPaged<any>(
    `/${normalizeAccountId(adAccountId)}/campaigns`,
    {
      fields: 'id,name,status,effective_status,objective,daily_budget,lifetime_budget,start_time,stop_time',
      limit: 200,
    },
    accessToken,
    version,
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

export async function listMetaAdSets(accessToken: string, adAccountId: string, version?: string): Promise<MetaAdSet[]> {
  const rows = await collectPaged<any>(
    `/${normalizeAccountId(adAccountId)}/adsets`,
    {
      fields: 'id,name,status,effective_status,campaign_id,daily_budget,lifetime_budget,bid_strategy,optimization_goal,start_time,end_time',
      limit: 500,
    },
    accessToken,
    version,
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

export async function listMetaAds(accessToken: string, adAccountId: string, version?: string): Promise<MetaAd[]> {
  const rows = await collectPaged<any>(
    `/${normalizeAccountId(adAccountId)}/ads`,
    {
      fields: 'id,name,status,effective_status,campaign{id,name},adset{id,name},creative{id,name,thumbnail_url,effective_object_story_id}',
      limit: 500,
    },
    accessToken,
    version,
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
  )
  const rows = Array.isArray(data?.data) ? data.data : []
  return rows.map((row: any) => ({
    day: esc(row?.date_start),
    spend: asNumber(row?.spend),
  }))
}
