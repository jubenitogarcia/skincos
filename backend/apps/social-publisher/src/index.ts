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

type Env = {
  SHARE_BUCKET: R2Bucket
  LOCK: DurableObjectNamespace
  PUBLIC_ORIGIN: string
  SOCIAL_PUBLISHER_ENABLED?: string
  INTEGRATIONS_ENCRYPTION_SECRET?: string
}

const json = (status: number, body: any) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  })

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

const BRT_OFFSET_MS = 3 * 60 * 60 * 1000
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

const socialAccountKey = (unitKey: string, platform: SocialPlatform) =>
  `internal/social/accounts/${encodeURIComponent(unitKey)}/${platform}.json`

const socialPublishedMarkerKey = (dateKey: string, groupKey: string, unitKey: string, platform: SocialPlatform) =>
  `social/published/${dateKey}/${groupKey}/${encodeURIComponent(unitKey)}/${platform}.json`

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

    const assetsPointers = await listAll(bucket, { prefix: `${groupPrefix(dateKey, groupKey)}assets/` })
    const assetIds = assetsPointers.objects
      .map((o) => String(o.key.split('/').pop() || '').replace(/\.json$/, ''))
      .filter(Boolean)
    if (!assetIds.length) continue

    const publicOrigin = String(env.PUBLIC_ORIGIN || '').replace(/\/$/, '')
    if (!publicOrigin) throw new Error('PUBLIC_ORIGIN not configured')

    const assets: Array<SocialQueueAsset & { publicUrl: string }> = []
    for (const assetId of assetIds) {
      const meta = await getJsonObj<SocialQueueAsset>(bucket, socialAssetMetaKey(assetId))
      if (!meta) continue
      assets.push({ ...(meta as any), publicUrl: `${publicOrigin}/social-media/${assetId}?inline=1` })
    }
    if (!assets.length) continue

    const secret = env.INTEGRATIONS_ENCRYPTION_SECRET ? String(env.INTEGRATIONS_ENCRYPTION_SECRET).trim() : undefined

    for (const unitKey of group.unitKeys || []) {
      for (const platform of group.platforms || []) {
        if (await isPublished(bucket, dateKey, groupKey, unitKey, platform).catch(() => false)) continue

        const account = await readSocialAccount(bucket, unitKey, platform, secret).catch(() => null)
        if (!account) continue

        const base = getBase(platform, account.apiBase, account.apiVersion)
        const caption = String(group.captions?.[platform] || group.captions?.instagram || '').trim()

        try {
          const out =
            platform === 'instagram'
              ? await publishInstagram(base, account.accountId, account.accessToken, assets, caption)
              : platform === 'facebook'
                ? await publishFacebook(base, account.accountId, account.accessToken, assets, caption)
                : await publishThreads(base, account.accountId, account.accessToken, assets, caption)

          await putJsonObj(bucket, `social/results/${dateKey}/${groupKey}/${encodeURIComponent(unitKey)}/${platform}.json`, {
            ok: true,
            at: new Date().toISOString(),
            unitKey,
            platform,
            out,
          })
          await putJsonObj(bucket, socialPublishedMarkerKey(dateKey, groupKey, unitKey, platform), {
            ok: true,
            publishedAt: new Date().toISOString(),
            out,
          })
        } catch (e: any) {
          await putJsonObj(bucket, `social/results/${dateKey}/${groupKey}/${encodeURIComponent(unitKey)}/${platform}.json`, {
            ok: false,
            at: new Date().toISOString(),
            unitKey,
            platform,
            error: e?.message || 'PUBLISH_FAILED',
          })
        }
      }
    }
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
    if (String(env.SOCIAL_PUBLISHER_ENABLED || '').toLowerCase() !== 'true') return

    const id = env.LOCK.idFromName('global')
    const stub = env.LOCK.get(id)
    const lockRes = await stub.fetch('https://lock/acquire?ttlMs=240000')
    if (!lockRes.ok) return

    const today = dateKeyBrt()
    const yesterday = dateKeyBrt(Date.now() - 24 * 60 * 60 * 1000)
    ctx.waitUntil(processDate(env, yesterday))
    ctx.waitUntil(processDate(env, today))
  },
}

