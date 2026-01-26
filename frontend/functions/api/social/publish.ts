import { requireSocialAdmin } from '../../_lib/socialAuth'
import { getShareBucket, getJson, putJson } from '../../_lib/r2'
import { readSocialAccount } from '../../_lib/socialAccounts'
import { readAssetMeta, isPublished, markPublished } from '../../_lib/socialQueue'
import { socialQueueGroupKey } from '../../_lib/socialKeys'
import { graphGet, graphPost } from '../../_lib/socialGraph'
import { requireCsrfForMutations } from '../../_lib/csrf'
import { getIntegrationsEncryptionSecret, integrationsEncryptionSecretRequired, isMissingIntegrationsEncryptionSecretError } from '../../_lib/integrationsEncryption'
import { requestAuditMeta, writeAuditEvent } from '../../_lib/audit'
import type { SocialPlatform, SocialQueueAsset, SocialQueueGroup } from '../../_lib/socialTypes'

const json = (status: number, body: any) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  })

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

const getBase = (platform: SocialPlatform, apiBase?: string, apiVersion?: string) => {
  if (apiBase) return apiBase.replace(/\/$/, '')
  if (platform === 'threads') return `https://graph.threads.net/${apiVersion || 'v1.0'}`
  return `https://graph.facebook.com/${apiVersion || 'v20.0'}`
}

async function publishInstagram(base: string, igId: string, token: string, assets: SocialQueueAsset[], caption: string) {
  const videos = assets.filter((a) => (a.contentType || '').startsWith('video'))
  const images = assets.filter((a) => (a.contentType || '').startsWith('image'))

  if (assets.length > 1 && videos.length) throw new Error('Instagram: carrossel com vídeo ainda não suportado neste fluxo.')
  if (!assets.length) throw new Error('Instagram: sem assets.')

  if (videos.length === 1) {
    const a = videos[0]
    const container = await graphPost<{ id: string }>(base, `${igId}/media`, { media_type: 'REELS', video_url: (a as any).publicUrl, caption, share_to_feed: 'true' }, token)
    for (let i = 0; i < 12; i += 1) {
      await sleep(5000)
      const st = await graphGet<{ status_code?: string; status?: string }>(base, container.id, { fields: 'status_code,status' }, token)
      const code = String(st.status_code || '').toUpperCase()
      if (code === 'FINISHED' || code === 'PUBLISHED') break
      if (code === 'ERROR') throw new Error('Instagram: erro processando vídeo (container status=ERROR)')
    }
    const published = await graphPost<{ id: string }>(base, `${igId}/media_publish`, { creation_id: container.id }, token)
    return { containerId: container.id, publishedId: published.id }
  }

  if (assets.length === 1) {
    const a = assets[0]
    const container = await graphPost<{ id: string }>(base, `${igId}/media`, { image_url: (a as any).publicUrl, caption }, token)
    const published = await graphPost<{ id: string }>(base, `${igId}/media_publish`, { creation_id: container.id }, token)
    return { containerId: container.id, publishedId: published.id }
  }

  const children: string[] = []
  for (const a of images.slice(0, 10)) {
    const child = await graphPost<{ id: string }>(base, `${igId}/media`, { image_url: (a as any).publicUrl, is_carousel_item: 'true' }, token)
    children.push(child.id)
  }
  const container = await graphPost<{ id: string }>(base, `${igId}/media`, { media_type: 'CAROUSEL', children: children.join(','), caption }, token)
  const published = await graphPost<{ id: string }>(base, `${igId}/media_publish`, { creation_id: container.id }, token)
  return { containerId: container.id, publishedId: published.id, children }
}

async function publishFacebook(base: string, pageId: string, token: string, assets: SocialQueueAsset[], caption: string) {
  const videos = assets.filter((a) => (a.contentType || '').startsWith('video'))
  const images = assets.filter((a) => (a.contentType || '').startsWith('image'))
  if (!assets.length) throw new Error('Facebook: sem assets.')

  if (videos.length) {
    if (videos.length > 1) throw new Error('Facebook: múltiplos vídeos não suportado neste fluxo.')
    const v = videos[0]
    const up = await graphPost<{ id?: string; video_id?: string }>(base, `${pageId}/videos`, { file_url: (v as any).publicUrl, published: 'false', description: caption }, token)
    const videoId = String(up.video_id || up.id || '').trim()
    if (!videoId) throw new Error('Facebook: upload de vídeo não retornou id.')
    const finish = await graphPost<any>(base, `${pageId}/video_reels`, { upload_phase: 'finish', video_id: videoId, video_state: 'PUBLISHED', description: caption }, token)
    return { videoId, finish }
  }

  const mediaIds: string[] = []
  for (const a of images.slice(0, 10)) {
    const up = await graphPost<{ id?: string; post_id?: string }>(base, `${pageId}/photos`, { url: (a as any).publicUrl, published: 'false', caption }, token)
    const id = String(up.id || up.post_id || '').trim()
    if (id) mediaIds.push(id)
  }
  if (!mediaIds.length) throw new Error('Facebook: upload de fotos não retornou ids.')

  const attached = mediaIds.map((id) => ({ media_fbid: id }))
  const feed = await graphPost<any>(
    base,
    `${pageId}/feed`,
    {
      message: caption,
      published: 'true',
      attached_media: JSON.stringify(attached),
      ...(mediaIds.length > 1 ? { multi_share_optimized: 'true' } : null),
    },
    token,
  )
  return { mediaIds, feed }
}

async function publishThreads(base: string, threadsId: string, token: string, assets: SocialQueueAsset[], text: string) {
  const videos = assets.filter((a) => (a.contentType || '').startsWith('video'))
  const images = assets.filter((a) => (a.contentType || '').startsWith('image'))
  if (!assets.length) throw new Error('Threads: sem assets.')
  if (videos.length) throw new Error('Threads: vídeo não suportado neste fluxo.')

  if (images.length === 1) {
    const c = await graphPost<{ id: string }>(base, `${threadsId}/threads`, { image_url: (images[0] as any).publicUrl, text }, token)
    const pub = await graphPost<any>(base, `${threadsId}/threads_publish`, { creation_id: c.id }, token)
    return { creationId: c.id, published: pub }
  }

  const children: string[] = []
  for (const a of images.slice(0, 10)) {
    const child = await graphPost<{ id: string }>(base, `${threadsId}/threads`, { image_url: (a as any).publicUrl, is_carousel_item: 'true' }, token)
    children.push(child.id)
  }
  const container = await graphPost<{ id: string }>(base, `${threadsId}/threads`, { media_type: 'CAROUSEL', children: JSON.stringify(children), text }, token)
  const pub = await graphPost<any>(base, `${threadsId}/threads_publish`, { creation_id: container.id }, token)
  return { containerId: container.id, children, published: pub }
}

export async function onRequestPost(context: any): Promise<Response> {
  const adminOrRes = await requireSocialAdmin(context)
  if (adminOrRes instanceof Response) return adminOrRes
  const csrfRes = requireCsrfForMutations(context)
  if (csrfRes) return csrfRes

  const bucket = getShareBucket(context)
  if (!bucket) return json(503, { ok: false, error: 'SHARE_BUCKET not configured' })

  const body = await context.request.json().catch(() => null)
  const dateKey = String(body?.dateKey || '').trim()
  const groupKey = String(body?.groupKey || '').trim()
  const force = !!body?.force
  if (!dateKey || !groupKey) return json(400, { ok: false, error: 'INVALID_INPUT', hint: 'Informe dateKey e groupKey.' })

  const group = await getJson<SocialQueueGroup>(bucket, socialQueueGroupKey(dateKey, groupKey))
  if (!group) return json(404, { ok: false, error: 'GROUP_NOT_FOUND' })

  const assetPointers = await bucket.list({ prefix: `social/queue/${dateKey}/${groupKey}/assets/` })
  const assetIds: string[] = []
  for (const o of assetPointers.objects || []) {
    const id = String(o.key.split('/').pop() || '').replace(/\.json$/, '')
    if (id) assetIds.push(id)
  }
  if (!assetIds.length) return json(400, { ok: false, error: 'NO_ASSETS' })

  const origin = new URL(context.request.url).origin
  const assets: Array<SocialQueueAsset & { publicUrl: string }> = []
  for (const assetId of assetIds) {
    const meta = await readAssetMeta(bucket, assetId)
    if (!meta) continue
    assets.push({ ...(meta as any), publicUrl: `${origin}/social-media/${assetId}?inline=1` })
  }
  if (!assets.length) return json(400, { ok: false, error: 'NO_ASSET_META' })

  const secret = getIntegrationsEncryptionSecret(context)
  if (integrationsEncryptionSecretRequired(context) && !secret) {
    return json(503, { ok: false, error: 'INTEGRATIONS_ENCRYPTION_SECRET_REQUIRED' })
  }

  const results: any[] = []
  for (const unitKey of group.unitKeys || []) {
    for (const platform of group.platforms || []) {
      if (!force) {
        const already = await isPublished(bucket, dateKey, groupKey, unitKey, platform).catch(() => false)
        if (already) {
          results.push({ ok: true, unitKey, platform, skipped: true, reason: 'ALREADY_PUBLISHED' })
          continue
        }
      }

      let account: any = null
      try {
        account = await readSocialAccount(bucket, unitKey, platform, secret)
      } catch (e: any) {
        if (!secret && isMissingIntegrationsEncryptionSecretError(e)) {
          results.push({ ok: false, unitKey, platform, error: 'INTEGRATIONS_ENCRYPTION_SECRET_REQUIRED' })
          continue
        }
        results.push({ ok: false, unitKey, platform, error: 'ACCOUNT_READ_FAILED' })
        continue
      }
      if (!account) {
        results.push({ ok: false, unitKey, platform, error: 'ACCOUNT_NOT_CONFIGURED' })
        continue
      }

      const base = getBase(platform, account.apiBase, account.apiVersion)
      const caption = String(group.captions?.[platform] || group.captions?.instagram || '').trim()

      try {
        const out =
          platform === 'instagram'
            ? await publishInstagram(base, account.accountId, account.accessToken, assets as any, caption)
            : platform === 'facebook'
              ? await publishFacebook(base, account.accountId, account.accessToken, assets as any, caption)
              : await publishThreads(base, account.accountId, account.accessToken, assets as any, caption)

        const resultKey = `social/results/${dateKey}/${groupKey}/${encodeURIComponent(unitKey)}/${platform}.json`
        await putJson(bucket, resultKey, { ok: true, unitKey, platform, out, at: new Date().toISOString() })

        await markPublished(bucket, { dateKey, groupKey, unitKey, platform, result: out })
        results.push({ ok: true, unitKey, platform, out })
      } catch (e: any) {
        results.push({ ok: false, unitKey, platform, error: e?.message || 'PUBLISH_FAILED' })
      }
    }
  }

  await writeAuditEvent(bucket, {
    scope: 'social',
    action: 'social.publish',
    actor: { id: adminOrRes.id, email: adminOrRes.email, name: adminOrRes.name },
    request: requestAuditMeta(context.request),
    target: {
      dateKey,
      groupKey,
      force,
      attempted: results.length,
      okCount: results.filter((r) => r && r.ok).length,
      failCount: results.filter((r) => r && !r.ok).length,
    },
    ok: true,
  }).catch(() => null)

  return json(200, { ok: true, dateKey, groupKey, results })
}
