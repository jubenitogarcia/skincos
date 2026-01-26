import { requireInsumosUser } from '../../_lib/insumosAuth'
import { getShareBucket } from '../../_lib/r2'
import { graphPost } from '../../_lib/instagramGraph'
import { readConnectionDecrypted } from '../../_lib/instagramStore'
import { requireCsrfForMutations } from '../../_lib/csrf'
import { getIntegrationsEncryptionSecret, integrationsEncryptionSecretRequired, isMissingIntegrationsEncryptionSecretError } from '../../_lib/integrationsEncryption'
import { requestAuditMeta, writeAuditEvent } from '../../_lib/audit'

const json = (status: number, body: any) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  })

type PublishType = 'image' | 'carousel' | 'story'

export async function onRequestPost(context: any): Promise<Response> {
  const userOrRes = await requireInsumosUser(context)
  if (userOrRes instanceof Response) return userOrRes
  const csrfRes = requireCsrfForMutations(context)
  if (csrfRes) return csrfRes

  const bucket = getShareBucket(context)
  if (!bucket) return json(503, { ok: false, error: 'SHARE_BUCKET not configured' })

  const secret = getIntegrationsEncryptionSecret(context)
  if (integrationsEncryptionSecretRequired(context) && !secret) {
    return json(503, { ok: false, error: 'INTEGRATIONS_ENCRYPTION_SECRET_REQUIRED' })
  }

  let conn: any = null
  try {
    conn = await readConnectionDecrypted(bucket, userOrRes.id, secret)
  } catch (e: any) {
    if (!secret && isMissingIntegrationsEncryptionSecretError(e)) {
      return json(503, { ok: false, error: 'INTEGRATIONS_ENCRYPTION_SECRET_REQUIRED' })
    }
    return json(500, { ok: false, error: 'INTERNAL' })
  }
  if (!conn) return json(401, { ok: false, error: 'INSTAGRAM_NOT_CONNECTED' })

  const body = await context.request.json().catch(() => null)
  const type = String(body?.type || '').toLowerCase().trim() as PublishType
  const urls = Array.isArray(body?.urls) ? body.urls.map((u: any) => String(u || '').trim()).filter(Boolean) : []
  const caption = typeof body?.caption === 'string' ? body.caption : undefined

  if (!type || !['image', 'carousel', 'story'].includes(type)) {
    return json(400, { ok: false, error: 'INVALID_TYPE', hint: 'type deve ser image|carousel|story' })
  }
  if (!urls.length) return json(400, { ok: false, error: 'INVALID_INPUT', hint: 'Informe urls[] (https).' })
  if (urls.some((u: string) => !u.startsWith('https://'))) return json(400, { ok: false, error: 'INVALID_URL', hint: 'URLs devem começar com https://' })

  const igId = conn.igBusinessAccountId
  const token = conn.accessToken

  if (type === 'image') {
    const container = await graphPost<{ id: string }>(`${igId}/media`, { image_url: urls[0], caption }, token)
    const published = await graphPost<{ id: string }>(`${igId}/media_publish`, { creation_id: container.id }, token)
    await writeAuditEvent(bucket, {
      scope: 'instagram',
      action: 'instagram.publish',
      actor: { id: userOrRes.id, email: userOrRes.email, name: userOrRes.name },
      request: requestAuditMeta(context.request),
      target: { type, urlCount: urls.length },
      ok: true,
    }).catch(() => null)
    return json(200, { ok: true, creationId: container.id, publishedId: published.id })
  }

  if (type === 'story') {
    const container = await graphPost<{ id: string }>(`${igId}/media`, { image_url: urls[0], media_type: 'STORIES', caption }, token)
    const published = await graphPost<{ id: string }>(`${igId}/media_publish`, { creation_id: container.id }, token)
    await writeAuditEvent(bucket, {
      scope: 'instagram',
      action: 'instagram.publish',
      actor: { id: userOrRes.id, email: userOrRes.email, name: userOrRes.name },
      request: requestAuditMeta(context.request),
      target: { type, urlCount: urls.length },
      ok: true,
    }).catch(() => null)
    return json(200, { ok: true, creationId: container.id, publishedId: published.id })
  }

  const children: string[] = []
  for (const u of urls.slice(0, 10)) {
    const child = await graphPost<{ id: string }>(`${igId}/media`, { image_url: u, is_carousel_item: true }, token)
    children.push(child.id)
  }
  const container = await graphPost<{ id: string }>(`${igId}/media`, { media_type: 'CAROUSEL', children: children.join(','), caption }, token)
  const published = await graphPost<{ id: string }>(`${igId}/media_publish`, { creation_id: container.id }, token)
  await writeAuditEvent(bucket, {
    scope: 'instagram',
    action: 'instagram.publish',
    actor: { id: userOrRes.id, email: userOrRes.email, name: userOrRes.name },
    request: requestAuditMeta(context.request),
    target: { type, urlCount: urls.length },
    ok: true,
  }).catch(() => null)
  return json(200, { ok: true, creationId: container.id, children, publishedId: published.id })
}
