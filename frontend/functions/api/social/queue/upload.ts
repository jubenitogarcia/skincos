import { requireInsumosUser } from '../../../_lib/insumosAuth'
import { getShareBucket, getJson, putJson } from '../../../_lib/r2'
import { socialAssetFileKey, socialAssetMetaKey, socialQueueGroupKey } from '../../../_lib/socialKeys'
import { groupKeyFromFilename, groupKeyFromMsBrt, normalizeIsoOrThrow, scheduledAtFromGroupKeyBrt, dateKeyFromMsBrt, dateKeyFromGroupKey } from '../../../_lib/socialTime'
import { upsertAssetPointer } from '../../../_lib/socialQueue'
import { requireCsrfForMutations } from '../../../_lib/csrf'
import { requestAuditMeta, writeAuditEvent } from '../../../_lib/audit'
import type { SocialPlatform, SocialQueueAsset, SocialQueueGroup } from '../../../_lib/socialTypes'

const json = (status: number, body: any) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  })

const MAX_FILES = 10
const MAX_TOTAL_BYTES = 90 * 1024 * 1024
const MAX_FILE_BYTES = 90 * 1024 * 1024

const parseUnitKeys = (raw: string): string[] => {
  const parts = String(raw || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
  return [...new Set(parts)]
}

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
  const csrfRes = requireCsrfForMutations(context)
  if (csrfRes) return csrfRes

  const bucket = getShareBucket(context)
  if (!bucket) return json(503, { ok: false, error: 'SHARE_BUCKET not configured' })

  const fd = await context.request.formData()
  const unitKey = String(fd.get('unitKey') || '').trim() || 'BSS'
  const unitKeysRaw = String(fd.get('unitKeys') || '').trim()
  const defaultUnitsRaw = String(context?.env?.SOCIAL_DEFAULT_UNITS || '').trim()
  const defaultUnits = defaultUnitsRaw ? parseUnitKeys(defaultUnitsRaw) : []
  const unitKeys = unitKeysRaw ? parseUnitKeys(unitKeysRaw) : (defaultUnits.length ? defaultUnits : [unitKey])
  const platforms = parsePlatforms(String(fd.get('platforms') || 'instagram,facebook,threads'))
  if (!platforms.length) return json(400, { ok: false, error: 'INVALID_PLATFORMS' })

  const scheduledAtRaw = fd.get('scheduledAt')
  const scheduledAtExplicit = scheduledAtRaw ? normalizeIsoOrThrow(String(scheduledAtRaw)) : ''

  const files = fd.getAll('files').filter((f) => f && typeof (f as any).arrayBuffer === 'function') as File[]
  const fileObjs = files.slice(0, MAX_FILES)
  if (!fileObjs.length) return json(400, { ok: false, error: 'NO_FILES' })

  let totalBytes = 0
  let videoCount = 0
  for (const f of fileObjs) {
    const size = Number(f?.size || 0)
    if (!Number.isFinite(size) || size <= 0) return json(400, { ok: false, error: 'INVALID_FILE', hint: 'Arquivo inválido.' })
    if (size > MAX_FILE_BYTES) return json(413, { ok: false, error: 'FILE_TOO_LARGE', maxBytes: MAX_FILE_BYTES })
    totalBytes += size
    if (totalBytes > MAX_TOTAL_BYTES) return json(413, { ok: false, error: 'PAYLOAD_TOO_LARGE', maxBytes: MAX_TOTAL_BYTES })
    if (String(f.type || '').startsWith('video/')) videoCount += 1
  }

  if (videoCount > 1) return json(400, { ok: false, error: 'INVALID_FILES', hint: 'Envie no máximo 1 vídeo por vez.' })
  if (videoCount === 1 && fileObjs.length > 1) {
    return json(400, { ok: false, error: 'INVALID_FILES', hint: 'Carrossel com vídeo não é suportado neste fluxo.' })
  }
  if (videoCount === 1 && platforms.includes('threads')) {
    return json(400, { ok: false, error: 'INVALID_FILES', hint: 'Threads não suporta vídeo neste fluxo.' })
  }

  const groupKeyExplicit = String(fd.get('groupKey') || '').trim()
  const groupKey =
    groupKeyExplicit ||
    (scheduledAtExplicit ? groupKeyFromMsBrt(Date.parse(scheduledAtExplicit)) : '') ||
    groupKeyFromFilename(fileObjs[0]?.name || '') ||
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
        unitKeys: [...new Set([...(groupExisting.unitKeys || []), ...unitKeys])],
        platforms: [...new Set([...(groupExisting.platforms || []), ...platforms])],
        captions: { ...(groupExisting.captions || {}), ...captions },
        updatedAt: nowIso,
      }
    : {
        dateKey,
        groupKey,
        scheduledAt,
        unitKeys,
        platforms,
        captions: Object.keys(captions).length ? captions : undefined,
        createdAt: nowIso,
      }

  await putJson(bucket, socialQueueGroupKey(dateKey, groupKey), group)

  const storedAssetIds: string[] = []
  for (const file of fileObjs) {
    const assetId = crypto.randomUUID()
    const fileKey = socialAssetFileKey(assetId)
    const contentType = file.type || 'application/octet-stream'
    if (!(contentType.startsWith('image/') || contentType.startsWith('video/'))) {
      return json(400, { ok: false, error: 'INVALID_FILE_TYPE', hint: `Tipo não suportado: ${contentType}` })
    }

    await bucket.put(fileKey, file, { httpMetadata: { contentType } })

    const meta: SocialQueueAsset = {
      assetId,
      originalName: file.name || 'arquivo',
      contentType,
      size: Number(file.size || 0) || undefined,
      createdAt: nowIso,
      unitKey: unitKeys[0] || unitKey,
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

  await writeAuditEvent(bucket, {
    scope: 'social',
    action: 'social.queue.upload',
    actor: { id: userOrRes.id, email: userOrRes.email, name: userOrRes.name },
    request: requestAuditMeta(context.request),
    target: {
      dateKey,
      groupKey,
      scheduledAt,
      unitKeys,
      platforms,
      fileCount: fileObjs.length,
      totalBytes,
    },
    ok: true,
  }).catch(() => null)

  return json(200, { ok: true, dateKey, groupKey, scheduledAt: group.scheduledAt, assetIds: storedAssetIds })
}
