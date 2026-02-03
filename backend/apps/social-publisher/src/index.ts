type SocialPlatform = 'instagram' | 'facebook' | 'threads'

type SocialAccountConfig = {
  platform: SocialPlatform
  unitKey: string
  accountId: string
  accessToken: string
  apiBase?: string
  apiVersion?: string
  updatedAt: string
}

type SocialQueueGroup = {
  dateKey: string
  groupKey: string
  scheduledAt: string
  unitKeys: string[]
  platforms: SocialPlatform[]
  captions?: Partial<Record<SocialPlatform, string>>
  createdAt: string
  updatedAt?: string
}

type SocialQueueAsset = {
  assetId: string
  originalName: string
  contentType?: string
  size?: number
  createdAt: string
  unitKey: string
  platforms: SocialPlatform[]
  dateKey: string
  groupKey: string
  scheduledAt: string
  fileKey: string
}

type SocialPublishJob = {
  jobId: string
  dateKey: string
  groupKey: string
  force?: boolean
  requestedAt?: string
  requestedBy?: { id?: string; email?: string; name?: string }
}

type Env = {
  SHARE_BUCKET: R2Bucket
  LOCK: DurableObjectNamespace
  PUBLIC_ORIGIN: string
  SOCIAL_PUBLISHER_ENABLED?: string
  SOCIAL_JOBS_ENABLED?: string
  SOCIAL_JOBS_MAX_PER_RUN?: string
  SOCIAL_CLEANUP_ENABLED?: string
  SOCIAL_RETENTION_DAYS?: string
  SOCIAL_CLEANUP_MAX_DATEKEYS_PER_RUN?: string
  SOCIAL_CLEANUP_MAX_ASSETS_PER_DATEKEY?: string
  SHARE_CLEANUP_ENABLED?: string
  SHARE_RETENTION_DAYS?: string
  SHARE_CLEANUP_MAX_SHARES_PER_RUN?: string
  INTEGRATIONS_ENCRYPTION_SECRET?: string
}

const json = (status: number, body: any) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  })

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

const BRT_OFFSET_MS = 3 * 60 * 60 * 1000
const MS_DAY = 24 * 60 * 60 * 1000

const parsePositiveInt = (raw: any): number | null => {
  const n = Number(String(raw ?? '').trim())
  if (!Number.isFinite(n)) return null
  const i = Math.floor(n)
  return i > 0 ? i : null
}

const chunk = <T,>(arr: T[], size: number) => {
  const out: T[][] = []
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size))
  return out
}
const dateKeyBrt = (nowMs = Date.now()) => {
  const d = new Date(nowMs - BRT_OFFSET_MS)
  const dd = String(d.getUTCDate()).padStart(2, '0')
  const mm = String(d.getUTCMonth() + 1).padStart(2, '0')
  const yy = String(d.getUTCFullYear()).slice(-2)
  return `${dd}${mm}${yy}`
}

const groupPrefix = (dateKey: string, groupKey: string) => `social/queue/${dateKey}/${groupKey}/`
const socialQueueGroupKey = (dateKey: string, groupKey: string) => `${groupPrefix(dateKey, groupKey)}group.json`
const socialAssetMetaKey = (assetId: string) => `social/assets/${assetId}/meta.json`
const socialAssetFileKey = (assetId: string) => `social/assets/${assetId}/file`

const socialAccountKey = (unitKey: string, platform: SocialPlatform) =>
  `internal/social/accounts/${encodeURIComponent(unitKey)}/${platform}.json`

const socialPublishedMarkerKey = (dateKey: string, groupKey: string, unitKey: string, platform: SocialPlatform) =>
  `social/published/${dateKey}/${groupKey}/${encodeURIComponent(unitKey)}/${platform}.json`

const shareIndexPrefix = (dayKey: string) => `internal/share/index/${dayKey}/`

const dayIndexUtc = (ms: number) => Math.floor(ms / MS_DAY)
const dayIndexBrt = (ms: number) => Math.floor((ms - BRT_OFFSET_MS) / MS_DAY)

const parseSocialDateKeyToDayIndex = (dateKey: string): number | null => {
  if (!dateKey.match(/^\d{6}$/)) return null
  const dd = Number(dateKey.slice(0, 2))
  const mm = Number(dateKey.slice(2, 4))
  const yy = Number(dateKey.slice(4, 6))
  if (!Number.isFinite(dd) || !Number.isFinite(mm) || !Number.isFinite(yy)) return null
  if (dd < 1 || dd > 31 || mm < 1 || mm > 12) return null
  const year = 2000 + yy
  return dayIndexUtc(Date.UTC(year, mm - 1, dd))
}

const parseIsoDayKeyToDayIndex = (dayKey: string): number | null => {
  if (!dayKey.match(/^\d{4}-\d{2}-\d{2}$/)) return null
  const ms = Date.parse(`${dayKey}T00:00:00.000Z`)
  if (!Number.isFinite(ms)) return null
  return dayIndexUtc(ms)
}

async function listAll(bucket: R2Bucket, opts: { prefix: string; delimiter?: string }) {
  const objects: R2Object[] = []
  const delimitedPrefixes: string[] = []
  let cursor: string | undefined = undefined
  for (;;) {
    const res = await bucket.list({ ...opts, cursor })
    objects.push(...(res.objects || []))
    delimitedPrefixes.push(...(res.delimitedPrefixes || []))
    if (!res.truncated) break
    cursor = res.cursor
    if (!cursor) break
  }
  return { objects, delimitedPrefixes }
}

async function deleteKeys(bucket: R2Bucket, keys: string[]) {
  const uniq = [...new Set(keys.filter(Boolean))]
  for (const batch of chunk(uniq, 900)) {
    await bucket.delete(batch)
  }
  return uniq.length
}

async function listAllKeys(bucket: R2Bucket, prefix: string) {
  const { objects } = await listAll(bucket, { prefix })
  return (objects || []).map((o) => String(o.key || '')).filter(Boolean)
}

const textEncoder = new TextEncoder()

const base64UrlDecodeBytes = (s: string) => {
  const base64 = s.replace(/-/g, '+').replace(/_/g, '/')
  const padded = base64 + '==='.slice((base64.length + 3) % 4)
  const binary = atob(padded)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i)
  return bytes
}

async function deriveAesKey(secret: string) {
  const hash = await crypto.subtle.digest('SHA-256', textEncoder.encode(secret))
  return crypto.subtle.importKey('raw', hash, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt'])
}

async function decryptTokenIfNeeded(token: string, secret?: string) {
  if (!token.startsWith('enc:')) return token
  if (!secret) throw new Error('Encrypted token but INTEGRATIONS_ENCRYPTION_SECRET not configured')
  const raw = token.slice('enc:'.length)
  const [ivB64, ctB64] = raw.split('.')
  if (!ivB64 || !ctB64) throw new Error('Invalid encrypted token')
  const iv = base64UrlDecodeBytes(ivB64)
  const ct = base64UrlDecodeBytes(ctB64)
  const key = await deriveAesKey(secret)
  const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, ct)
  return new TextDecoder().decode(new Uint8Array(pt))
}

async function getJsonObj<T>(bucket: R2Bucket, key: string): Promise<T | null> {
  const obj = await bucket.get(key)
  if (!obj) return null
  const text = await obj.text()
  return JSON.parse(text) as T
}

async function putJsonObj(bucket: R2Bucket, key: string, value: any) {
  await bucket.put(key, JSON.stringify(value), { httpMetadata: { contentType: 'application/json' } })
}

type GraphError = { error?: { message?: string } }

const normalizeParams = (params: Record<string, any>) =>
  Object.fromEntries(Object.entries(params || {}).filter(([, v]) => v !== undefined && v !== null))

const formValue = (v: any) => {
  if (typeof v === 'string') return v
  if (typeof v === 'number' || typeof v === 'boolean') return String(v)
  return JSON.stringify(v)
}

async function graphGet<T>(base: string, path: string, params: Record<string, any>, accessToken: string): Promise<T> {
  const qs = new URLSearchParams({ ...normalizeParams(params), access_token: accessToken } as any)
  const url = `${base.replace(/\/$/, '')}/${path.replace(/^\//, '')}?${qs.toString()}`
  const res = await fetch(url)
  const json = await res.json().catch(() => null)
  if (!res.ok) throw new Error((json as GraphError)?.error?.message || `Graph API error (HTTP ${res.status})`)
  return json as T
}

async function graphPost<T>(base: string, path: string, body: Record<string, any>, accessToken: string): Promise<T> {
  const form = new FormData()
  for (const [k, v] of Object.entries(normalizeParams(body))) form.set(k, formValue(v))
  form.set('access_token', accessToken)
  const url = `${base.replace(/\/$/, '')}/${path.replace(/^\//, '')}`
  const res = await fetch(url, { method: 'POST', body: form })
  const json = await res.json().catch(() => null)
  if (!res.ok) throw new Error((json as GraphError)?.error?.message || `Graph API error (HTTP ${res.status})`)
  return json as T
}

const getBase = (platform: SocialPlatform, apiBase?: string, apiVersion?: string) => {
  if (apiBase) return apiBase.replace(/\/$/, '')
  if (platform === 'threads') return `https://graph.threads.net/${apiVersion || 'v1.0'}`
  return `https://graph.facebook.com/${apiVersion || 'v20.0'}`
}

async function publishInstagram(base: string, igId: string, token: string, assets: Array<SocialQueueAsset & { publicUrl: string }>, caption: string) {
  const videos = assets.filter((a) => (a.contentType || '').startsWith('video'))
  const images = assets.filter((a) => (a.contentType || '').startsWith('image'))
  if (!assets.length) throw new Error('Instagram: sem assets.')
  if (assets.length > 1 && videos.length) throw new Error('Instagram: carrossel com vídeo não suportado.')

  if (videos.length === 1) {
    const a = videos[0]
    const container = await graphPost<{ id: string }>(base, `${igId}/media`, { media_type: 'REELS', video_url: a.publicUrl, caption, share_to_feed: 'true' }, token)
    for (let i = 0; i < 12; i += 1) {
      await sleep(5000)
      const st = await graphGet<{ status_code?: string; status?: string }>(base, container.id, { fields: 'status_code,status' }, token)
      const code = String(st.status_code || '').toUpperCase()
      if (code === 'FINISHED' || code === 'PUBLISHED') break
      if (code === 'ERROR') throw new Error('Instagram: vídeo status=ERROR')
    }
    const published = await graphPost<{ id: string }>(base, `${igId}/media_publish`, { creation_id: container.id }, token)
    return { containerId: container.id, publishedId: published.id }
  }

  if (assets.length === 1) {
    const a = assets[0]
    const container = await graphPost<{ id: string }>(base, `${igId}/media`, { image_url: a.publicUrl, caption }, token)
    const published = await graphPost<{ id: string }>(base, `${igId}/media_publish`, { creation_id: container.id }, token)
    return { containerId: container.id, publishedId: published.id }
  }

  const children: string[] = []
  for (const a of images.slice(0, 10)) {
    const child = await graphPost<{ id: string }>(base, `${igId}/media`, { image_url: a.publicUrl, is_carousel_item: 'true' }, token)
    children.push(child.id)
  }
  const container = await graphPost<{ id: string }>(base, `${igId}/media`, { media_type: 'CAROUSEL', children: children.join(','), caption }, token)
  const published = await graphPost<{ id: string }>(base, `${igId}/media_publish`, { creation_id: container.id }, token)
  return { containerId: container.id, publishedId: published.id, children }
}

async function publishFacebook(base: string, pageId: string, token: string, assets: Array<SocialQueueAsset & { publicUrl: string }>, caption: string) {
  const videos = assets.filter((a) => (a.contentType || '').startsWith('video'))
  const images = assets.filter((a) => (a.contentType || '').startsWith('image'))
  if (!assets.length) throw new Error('Facebook: sem assets.')

  if (videos.length) {
    if (videos.length > 1) throw new Error('Facebook: múltiplos vídeos não suportado.')
    const v = videos[0]
    const up = await graphPost<{ id?: string; video_id?: string }>(base, `${pageId}/videos`, { file_url: v.publicUrl, published: 'false', description: caption }, token)
    const videoId = String(up.video_id || up.id || '').trim()
    if (!videoId) throw new Error('Facebook: upload vídeo sem id')
    const finish = await graphPost<any>(base, `${pageId}/video_reels`, { upload_phase: 'finish', video_id: videoId, video_state: 'PUBLISHED', description: caption }, token)
    return { videoId, finish }
  }

  const mediaIds: string[] = []
  for (const a of images.slice(0, 10)) {
    const up = await graphPost<{ id?: string; post_id?: string }>(base, `${pageId}/photos`, { url: a.publicUrl, published: 'false', caption }, token)
    const id = String(up.id || up.post_id || '').trim()
    if (id) mediaIds.push(id)
  }
  if (!mediaIds.length) throw new Error('Facebook: upload fotos sem ids')
  const attached = mediaIds.map((id) => ({ media_fbid: id }))
  const feed = await graphPost<any>(
    base,
    `${pageId}/feed`,
    { message: caption, published: 'true', attached_media: JSON.stringify(attached), ...(mediaIds.length > 1 ? { multi_share_optimized: 'true' } : null) },
    token,
  )
  return { mediaIds, feed }
}

async function publishThreads(base: string, threadsId: string, token: string, assets: Array<SocialQueueAsset & { publicUrl: string }>, text: string) {
  const videos = assets.filter((a) => (a.contentType || '').startsWith('video'))
  const images = assets.filter((a) => (a.contentType || '').startsWith('image'))
  if (!assets.length) throw new Error('Threads: sem assets.')
  if (videos.length) throw new Error('Threads: vídeo não suportado.')

  if (images.length === 1) {
    const c = await graphPost<{ id: string }>(base, `${threadsId}/threads`, { image_url: images[0].publicUrl, text }, token)
    const pub = await graphPost<any>(base, `${threadsId}/threads_publish`, { creation_id: c.id }, token)
    return { creationId: c.id, published: pub }
  }

  const children: string[] = []
  for (const a of images.slice(0, 10)) {
    const child = await graphPost<{ id: string }>(base, `${threadsId}/threads`, { image_url: a.publicUrl, is_carousel_item: 'true' }, token)
    children.push(child.id)
  }
  const container = await graphPost<{ id: string }>(base, `${threadsId}/threads`, { media_type: 'CAROUSEL', children: JSON.stringify(children), text }, token)
  const pub = await graphPost<any>(base, `${threadsId}/threads_publish`, { creation_id: container.id }, token)
  return { containerId: container.id, children, published: pub }
}

async function readSocialAccount(bucket: R2Bucket, unitKey: string, platform: SocialPlatform, secret?: string): Promise<SocialAccountConfig | null> {
  const data = await getJsonObj<SocialAccountConfig>(bucket, socialAccountKey(unitKey, platform))
  if (!data) return null
  const accessToken = await decryptTokenIfNeeded(data.accessToken, secret)
  return { ...data, accessToken }
}

async function isPublished(bucket: R2Bucket, dateKey: string, groupKey: string, unitKey: string, platform: SocialPlatform) {
  const head = await bucket.head(socialPublishedMarkerKey(dateKey, groupKey, unitKey, platform))
  return !!head
}

async function buildAssetsForGroup(bucket: R2Bucket, dateKey: string, groupKey: string, publicOrigin: string) {
  const assetsPointers = await listAll(bucket, { prefix: `${groupPrefix(dateKey, groupKey)}assets/` })
  const assetIds = assetsPointers.objects
    .map((o) => String(o.key.split('/').pop() || '').replace(/\.json$/, ''))
    .filter(Boolean)
  if (!assetIds.length) return []

  const assets: Array<SocialQueueAsset & { publicUrl: string }> = []
  for (const assetId of assetIds) {
    const meta = await getJsonObj<SocialQueueAsset>(bucket, socialAssetMetaKey(assetId))
    if (!meta) continue
    assets.push({ ...(meta as any), publicUrl: `${publicOrigin}/social-media/${assetId}?inline=1` })
  }
  return assets
}

async function publishGroup(env: Env, group: SocialQueueGroup, opts: { force?: boolean }) {
  const bucket = env.SHARE_BUCKET
  const publicOrigin = String(env.PUBLIC_ORIGIN || '').replace(/\/$/, '')
  if (!publicOrigin) throw new Error('PUBLIC_ORIGIN not configured')

  const assets = await buildAssetsForGroup(bucket, group.dateKey, group.groupKey, publicOrigin)
  if (!assets.length) return { okCount: 0, failCount: 0, results: [] }

  const secret = env.INTEGRATIONS_ENCRYPTION_SECRET ? String(env.INTEGRATIONS_ENCRYPTION_SECRET).trim() : undefined
  const results: any[] = []

  for (const unitKey of group.unitKeys || []) {
    for (const platform of group.platforms || []) {
      if (!opts.force) {
        const already = await isPublished(bucket, group.dateKey, group.groupKey, unitKey, platform).catch(() => false)
        if (already) {
          results.push({ ok: true, unitKey, platform, skipped: true, reason: 'ALREADY_PUBLISHED' })
          continue
        }
      }

      const account = await readSocialAccount(bucket, unitKey, platform, secret).catch(() => null)
      if (!account) {
        results.push({ ok: false, unitKey, platform, error: 'ACCOUNT_NOT_CONFIGURED' })
        continue
      }

      const base = getBase(platform, account.apiBase, account.apiVersion)
      const caption = String(group.captions?.[platform] || group.captions?.instagram || '').trim()

      try {
        const out =
          platform === 'instagram'
            ? await publishInstagram(base, account.accountId, account.accessToken, assets, caption)
            : platform === 'facebook'
              ? await publishFacebook(base, account.accountId, account.accessToken, assets, caption)
              : await publishThreads(base, account.accountId, account.accessToken, assets, caption)

        await putJsonObj(bucket, `social/results/${group.dateKey}/${group.groupKey}/${encodeURIComponent(unitKey)}/${platform}.json`, {
          ok: true,
          unitKey,
          platform,
          out,
          at: new Date().toISOString(),
        })
        await putJsonObj(bucket, socialPublishedMarkerKey(group.dateKey, group.groupKey, unitKey, platform), {
          ok: true,
          publishedAt: new Date().toISOString(),
          out,
        })
        results.push({ ok: true, unitKey, platform, out })
      } catch (e: any) {
        await putJsonObj(bucket, `social/results/${group.dateKey}/${group.groupKey}/${encodeURIComponent(unitKey)}/${platform}.json`, {
          ok: false,
          unitKey,
          platform,
          error: e?.message || 'PUBLISH_FAILED',
          at: new Date().toISOString(),
        })
        results.push({ ok: false, unitKey, platform, error: e?.message || 'PUBLISH_FAILED' })
      }
    }
  }

  return {
    okCount: results.filter((r) => r && r.ok).length,
    failCount: results.filter((r) => r && !r.ok).length,
    results,
  }
}

async function processDate(env: Env, dateKey: string) {
  const bucket = env.SHARE_BUCKET
  const now = Date.now()
  const prefixes = await listAll(bucket, { prefix: `social/queue/${dateKey}/`, delimiter: '/' })

  for (const pref of prefixes.delimitedPrefixes) {
    const groupKey = pref.replace(`social/queue/${dateKey}/`, '').replace(/\/$/, '')
    const group = await getJsonObj<SocialQueueGroup>(bucket, socialQueueGroupKey(dateKey, groupKey)).catch(() => null)
    if (!group) continue
    const scheduledAtMs = Date.parse(group.scheduledAt)
    if (Number.isFinite(scheduledAtMs) && scheduledAtMs > now) continue

    await publishGroup(env, group, { force: false }).catch(() => null)
  }
}

async function processJobs(env: Env) {
  const bucket = env.SHARE_BUCKET
  const maxJobs = parsePositiveInt(env.SOCIAL_JOBS_MAX_PER_RUN) ?? 50
  const startedAt = Date.now()
  let processed = 0
  let okCount = 0
  let failCount = 0

  const { objects } = await listAll(bucket, { prefix: 'social/jobs/' })
  const keys = (objects || []).map((o) => String(o.key || '')).filter(Boolean).slice(0, maxJobs)
  for (const key of keys) {
    const job = await getJsonObj<SocialPublishJob>(bucket, key).catch(() => null)
    if (!job?.dateKey || !job?.groupKey || !job?.jobId) {
      await deleteKeys(bucket, [key]).catch(() => null)
      continue
    }

    const group = await getJsonObj<SocialQueueGroup>(bucket, socialQueueGroupKey(job.dateKey, job.groupKey)).catch(() => null)
    if (!group) {
      await putJsonObj(bucket, `social/job-results/${job.jobId}.json`, {
        ok: false,
        error: 'GROUP_NOT_FOUND',
        jobId: job.jobId,
        dateKey: job.dateKey,
        groupKey: job.groupKey,
        at: new Date().toISOString(),
      }).catch(() => null)
      await deleteKeys(bucket, [key]).catch(() => null)
      processed += 1
      failCount += 1
      continue
    }

    const out = await publishGroup(env, group, { force: !!job.force }).catch((e) => ({
      okCount: 0,
      failCount: 1,
      results: [],
      error: e?.message || 'PUBLISH_FAILED',
    }))

    await putJsonObj(bucket, `social/job-results/${job.jobId}.json`, {
      ok: !out?.error,
      error: out?.error,
      jobId: job.jobId,
      dateKey: job.dateKey,
      groupKey: job.groupKey,
      requestedAt: job.requestedAt,
      requestedBy: job.requestedBy,
      okCount: out?.okCount || 0,
      failCount: out?.failCount || 0,
      at: new Date().toISOString(),
    }).catch(() => null)

    await deleteKeys(bucket, [key]).catch(() => null)
    processed += 1
    okCount += out?.okCount || 0
    failCount += out?.failCount || 0
  }

  if (processed > 0) {
    await putJsonObj(bucket, 'social/metrics/last_jobs_run.json', {
      processed,
      okCount,
      failCount,
      startedAt: new Date(startedAt).toISOString(),
      finishedAt: new Date().toISOString(),
    }).catch(() => null)
  }
}

async function cleanupSocial(env: Env) {
  const bucket = env.SHARE_BUCKET
  const retentionDays = parsePositiveInt(env.SOCIAL_RETENTION_DAYS)
  if (!retentionDays) return

  const maxDateKeys = parsePositiveInt(env.SOCIAL_CLEANUP_MAX_DATEKEYS_PER_RUN) ?? 10
  const maxAssetsPerDateKey = parsePositiveInt(env.SOCIAL_CLEANUP_MAX_ASSETS_PER_DATEKEY) ?? 2000

  const { delimitedPrefixes } = await listAll(bucket, { prefix: 'social/queue/', delimiter: '/' })
  const nowIdx = dayIndexBrt(Date.now())

  const candidates: Array<{ dateKey: string; ageDays: number }> = []
  for (const pref of delimitedPrefixes || []) {
    const dk = String(pref).replace(/^social\/queue\//, '').replace(/\/$/, '')
    const idx = parseSocialDateKeyToDayIndex(dk)
    if (idx === null) continue
    const ageDays = nowIdx - idx
    if (ageDays > retentionDays) candidates.push({ dateKey: dk, ageDays })
  }

  candidates.sort((a, b) => b.ageDays - a.ageDays)
  const toClean = candidates.slice(0, maxDateKeys)

  for (const { dateKey } of toClean) {
    const queueKeys = await listAllKeys(bucket, `social/queue/${dateKey}/`)

    const assetIds: string[] = []
    for (const k of queueKeys) {
      const m = k.match(/\/assets\/([^/]+)\.json$/)
      if (m?.[1]) assetIds.push(m[1])
    }
    const uniqAssetIds = [...new Set(assetIds)].slice(0, maxAssetsPerDateKey)

    const publishedKeys = await listAllKeys(bucket, `social/published/${dateKey}/`)
    const resultsKeys = await listAllKeys(bucket, `social/results/${dateKey}/`)
    await deleteKeys(bucket, [...queueKeys, ...publishedKeys, ...resultsKeys])

    const assetKeys: string[] = []
    for (const assetId of uniqAssetIds) assetKeys.push(socialAssetMetaKey(assetId), socialAssetFileKey(assetId))
    if (assetKeys.length) await deleteKeys(bucket, assetKeys)
  }
}

async function cleanupShares(env: Env) {
  const bucket = env.SHARE_BUCKET
  const retentionDays = parsePositiveInt(env.SHARE_RETENTION_DAYS)
  if (!retentionDays) return

  const maxShares = parsePositiveInt(env.SHARE_CLEANUP_MAX_SHARES_PER_RUN) ?? 200
  const nowIdx = dayIndexUtc(Date.now())

  const { delimitedPrefixes } = await listAll(bucket, { prefix: 'internal/share/index/', delimiter: '/' })
  const dayKeys: Array<{ dayKey: string; ageDays: number }> = []
  for (const pref of delimitedPrefixes || []) {
    const dayKey = String(pref).replace(/^internal\/share\/index\//, '').replace(/\/$/, '')
    const idx = parseIsoDayKeyToDayIndex(dayKey)
    if (idx === null) continue
    const ageDays = nowIdx - idx
    if (ageDays > retentionDays) dayKeys.push({ dayKey, ageDays })
  }

  dayKeys.sort((a, b) => b.ageDays - a.ageDays)

  let deletedShares = 0
  for (const { dayKey } of dayKeys) {
    if (deletedShares >= maxShares) break

    const idxKeys = await listAllKeys(bucket, shareIndexPrefix(dayKey))
    const shareIds: string[] = []
    for (const k of idxKeys) {
      const m = k.match(/internal\/share\/index\/[^/]+\/([^/]+)\.json$/)
      if (m?.[1]) shareIds.push(m[1])
    }

    const uniqShareIds = [...new Set(shareIds)]
    for (const shareId of uniqShareIds) {
      if (deletedShares >= maxShares) break
      const shareKeys = await listAllKeys(bucket, `shares/${shareId}/`)
      if (shareKeys.length) await deleteKeys(bucket, shareKeys)
      deletedShares += 1
    }

    if (idxKeys.length) await deleteKeys(bucket, idxKeys)
  }
}

async function cleanupSocial(env: Env) {
  const bucket = env.SHARE_BUCKET
  const retentionDays = parsePositiveInt(env.SOCIAL_RETENTION_DAYS)
  if (!retentionDays) return

  const maxDateKeys = parsePositiveInt(env.SOCIAL_CLEANUP_MAX_DATEKEYS_PER_RUN) ?? 10
  const maxAssetsPerDateKey = parsePositiveInt(env.SOCIAL_CLEANUP_MAX_ASSETS_PER_DATEKEY) ?? 2000

  const { delimitedPrefixes } = await listAll(bucket, { prefix: 'social/queue/', delimiter: '/' })
  const nowIdx = dayIndexBrt(Date.now())

  const candidates: Array<{ dateKey: string; ageDays: number }> = []
  for (const pref of delimitedPrefixes || []) {
    const dk = String(pref).replace(/^social\/queue\//, '').replace(/\/$/, '')
    const idx = parseSocialDateKeyToDayIndex(dk)
    if (idx === null) continue
    const ageDays = nowIdx - idx
    if (ageDays > retentionDays) candidates.push({ dateKey: dk, ageDays })
  }

  candidates.sort((a, b) => b.ageDays - a.ageDays)
  const toClean = candidates.slice(0, maxDateKeys)

  for (const { dateKey } of toClean) {
    const queueKeys = await listAllKeys(bucket, `social/queue/${dateKey}/`)

    const assetIds: string[] = []
    for (const k of queueKeys) {
      const m = k.match(/\/assets\/([^/]+)\.json$/)
      if (m?.[1]) assetIds.push(m[1])
    }
    const uniqAssetIds = [...new Set(assetIds)].slice(0, maxAssetsPerDateKey)

    const publishedKeys = await listAllKeys(bucket, `social/published/${dateKey}/`)
    const resultsKeys = await listAllKeys(bucket, `social/results/${dateKey}/`)
    await deleteKeys(bucket, [...queueKeys, ...publishedKeys, ...resultsKeys])

    const assetKeys: string[] = []
    for (const assetId of uniqAssetIds) assetKeys.push(socialAssetMetaKey(assetId), socialAssetFileKey(assetId))
    if (assetKeys.length) await deleteKeys(bucket, assetKeys)
  }
}

async function cleanupShares(env: Env) {
  const bucket = env.SHARE_BUCKET
  const retentionDays = parsePositiveInt(env.SHARE_RETENTION_DAYS)
  if (!retentionDays) return

  const maxShares = parsePositiveInt(env.SHARE_CLEANUP_MAX_SHARES_PER_RUN) ?? 200
  const nowIdx = dayIndexUtc(Date.now())

  const { delimitedPrefixes } = await listAll(bucket, { prefix: 'internal/share/index/', delimiter: '/' })
  const dayKeys: Array<{ dayKey: string; ageDays: number }> = []
  for (const pref of delimitedPrefixes || []) {
    const dayKey = String(pref).replace(/^internal\/share\/index\//, '').replace(/\/$/, '')
    const idx = parseIsoDayKeyToDayIndex(dayKey)
    if (idx === null) continue
    const ageDays = nowIdx - idx
    if (ageDays > retentionDays) dayKeys.push({ dayKey, ageDays })
  }

  dayKeys.sort((a, b) => b.ageDays - a.ageDays)

  let deletedShares = 0
  for (const { dayKey } of dayKeys) {
    if (deletedShares >= maxShares) break

    const idxKeys = await listAllKeys(bucket, shareIndexPrefix(dayKey))
    const shareIds: string[] = []
    for (const k of idxKeys) {
      const m = k.match(/internal\/share\/index\/[^/]+\/([^/]+)\.json$/)
      if (m?.[1]) shareIds.push(m[1])
    }

    const uniqShareIds = [...new Set(shareIds)]
    for (const shareId of uniqShareIds) {
      if (deletedShares >= maxShares) break
      const shareKeys = await listAllKeys(bucket, `shares/${shareId}/`)
      if (shareKeys.length) await deleteKeys(bucket, shareKeys)
      deletedShares += 1
    }

    if (idxKeys.length) await deleteKeys(bucket, idxKeys)
  }
}

export class PublisherLock {
  state: DurableObjectState

  constructor(state: DurableObjectState) {
    this.state = state
  }

  async fetch(request: Request) {
    const url = new URL(request.url)
    if (url.pathname !== '/acquire') return json(404, { ok: false })
    const ttlMs = Math.max(10_000, Math.min(10 * 60_000, Number(url.searchParams.get('ttlMs') || 240_000)))
    const now = Date.now()
    const current = (await this.state.storage.get<{ expiresAt: number }>('lock')) || null
    if (current && current.expiresAt > now) return json(409, { ok: false, locked: true, expiresAt: current.expiresAt })
    const expiresAt = now + ttlMs
    await this.state.storage.put('lock', { expiresAt })
    return json(200, { ok: true, locked: false, expiresAt })
  }
}

export default {
  async scheduled(_event: ScheduledEvent, env: Env, ctx: ExecutionContext) {
    const publisherEnabled = String(env.SOCIAL_PUBLISHER_ENABLED || '').toLowerCase() === 'true'
    const jobsEnabled = String(env.SOCIAL_JOBS_ENABLED ?? 'true').toLowerCase() === 'true'
    const socialCleanupEnabled = String(env.SOCIAL_CLEANUP_ENABLED || '').toLowerCase() === 'true'
    const shareCleanupEnabled = String(env.SHARE_CLEANUP_ENABLED || '').toLowerCase() === 'true'
    if (!publisherEnabled && !jobsEnabled && !socialCleanupEnabled && !shareCleanupEnabled) return

    const id = env.LOCK.idFromName('global')
    const stub = env.LOCK.get(id)
    const lockRes = await stub.fetch('https://lock/acquire?ttlMs=240000')
    if (!lockRes.ok) return

    if (publisherEnabled) {
      const today = dateKeyBrt()
      const yesterday = dateKeyBrt(Date.now() - 24 * 60 * 60 * 1000)
      ctx.waitUntil(processDate(env, yesterday))
      ctx.waitUntil(processDate(env, today))
    }

    if (jobsEnabled) ctx.waitUntil(processJobs(env))
    if (socialCleanupEnabled) ctx.waitUntil(cleanupSocial(env))
    if (shareCleanupEnabled) ctx.waitUntil(cleanupShares(env))
  },
}
