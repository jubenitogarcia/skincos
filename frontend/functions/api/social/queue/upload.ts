import { requireInsumosUser } from '../../../_lib/insumosAuth'
import { getShareBucket, getJson, putJson } from '../../../_lib/r2'
import { socialAssetFileKey, socialAssetMetaKey, socialQueueGroupKey } from '../../../_lib/socialKeys'
import { groupKeyFromFilename, groupKeyFromMsBrt, normalizeIsoOrThrow, scheduledAtFromGroupKeyBrt, dateKeyFromMsBrt, dateKeyFromGroupKey } from '../../../_lib/socialTime'
import { upsertAssetPointer } from '../../../_lib/socialQueue'
import type { SocialPlatform, SocialQueueAsset, SocialQueueGroup } from '../../../_lib/socialTypes'

const json = (status: number, body: any) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  })

const parsePlatforms = (raw: string): SocialPlatform[] => {
  const parts = String(raw || '')
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean)
  const ok = parts.filter((p) => p === 'instagram' || p === 'facebook' || p === 'threads') as SocialPlatform[]
  return [...new Set(ok)]
}

export async function onRequestPost(context: any): Promise<Response> {
  const userOrRes = await requireInsumosUser(context)
  if (userOrRes instanceof Response) return userOrRes

  const bucket = getShareBucket(context)
  if (!bucket) return json(503, { ok: false, error: 'SHARE_BUCKET not configured' })

  const fd = await context.request.formData()
  const unitKey = String(fd.get('unitKey') || '').trim() || 'BSS'
  const platforms = parsePlatforms(String(fd.get('platforms') || 'instagram,facebook,threads'))
  if (!platforms.length) return json(400, { ok: false, error: 'INVALID_PLATFORMS' })

  const scheduledAtRaw = fd.get('scheduledAt')
  const scheduledAtExplicit = scheduledAtRaw ? normalizeIsoOrThrow(String(scheduledAtRaw)) : ''

  const files = fd.getAll('files').filter((f) => f && typeof (f as any).arrayBuffer === 'function') as File[]
  if (!files.length) return json(400, { ok: false, error: 'NO_FILES' })

  const groupKeyExplicit = String(fd.get('groupKey') || '').trim()
  const groupKey =
    groupKeyExplicit ||
    (scheduledAtExplicit ? groupKeyFromMsBrt(Date.parse(scheduledAtExplicit)) : '') ||
    groupKeyFromFilename(files[0]?.name || '') ||
    groupKeyFromMsBrt(Date.now())

  const scheduledAt = scheduledAtExplicit || scheduledAtFromGroupKeyBrt(groupKey) || new Date().toISOString()
  const dateKey = dateKeyFromGroupKey(groupKey) || dateKeyFromMsBrt(Date.parse(scheduledAt))

  const captions: Partial<Record<SocialPlatform, string>> = {}
  const capIg = String(fd.get('captionInstagram') || '').trim()
  const capFb = String(fd.get('captionFacebook') || '').trim()
  const capTh = String(fd.get('captionThreads') || '').trim()
  if (capIg) captions.instagram = capIg
  if (capFb) captions.facebook = capFb
  if (capTh) captions.threads = capTh

  const nowIso = new Date().toISOString()

  const groupExisting = await getJson<SocialQueueGroup>(bucket, socialQueueGroupKey(dateKey, groupKey))
  const group: SocialQueueGroup = groupExisting
    ? {
        ...groupExisting,
        scheduledAt: scheduledAtExplicit ? scheduledAt : groupExisting.scheduledAt,
        unitKeys: [...new Set([...(groupExisting.unitKeys || []), unitKey])],
        platforms: [...new Set([...(groupExisting.platforms || []), ...platforms])],
        captions: { ...(groupExisting.captions || {}), ...captions },
        updatedAt: nowIso,
      }
    : {
        dateKey,
        groupKey,
        scheduledAt,
        unitKeys: [unitKey],
        platforms,
        captions: Object.keys(captions).length ? captions : undefined,
        createdAt: nowIso,
      }

  await putJson(bucket, socialQueueGroupKey(dateKey, groupKey), group)

  const storedAssetIds: string[] = []
  for (const file of files) {
    const assetId = crypto.randomUUID()
    const fileKey = socialAssetFileKey(assetId)
    const contentType = file.type || 'application/octet-stream'
    const buf = await file.arrayBuffer()

    await bucket.put(fileKey, buf, { httpMetadata: { contentType } })

    const meta: SocialQueueAsset = {
      assetId,
      originalName: file.name || 'arquivo',
      contentType,
      size: buf.byteLength,
      createdAt: nowIso,
      unitKey,
      platforms,
      dateKey,
      groupKey,
      scheduledAt,
      fileKey,
    }
    await putJson(bucket, socialAssetMetaKey(assetId), meta)
    await upsertAssetPointer(bucket, dateKey, groupKey, assetId)
    storedAssetIds.push(assetId)
  }

  return json(200, { ok: true, dateKey, groupKey, scheduledAt: group.scheduledAt, assetIds: storedAssetIds })
}

