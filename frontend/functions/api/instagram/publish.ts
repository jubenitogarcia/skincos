import { requireInsumosUser } from '../../_lib/insumosAuth'
import { getShareBucket } from '../../_lib/r2'
import { graphPost } from '../../_lib/instagramGraph'
import { readConnectionDecrypted } from '../../_lib/instagramStore'

const json = (status: number, body: any) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  })

type PublishType = 'image' | 'carousel' | 'story'

export async function onRequestPost(context: any): Promise<Response> {
  const userOrRes = await requireInsumosUser(context)
  if (userOrRes instanceof Response) return userOrRes

  const bucket = getShareBucket(context)
  if (!bucket) return json(503, { ok: false, error: 'SHARE_BUCKET not configured' })

  const secret = String(context?.env?.INTEGRATIONS_ENCRYPTION_SECRET || '').trim() || undefined
  const conn = await readConnectionDecrypted(bucket, userOrRes.id, secret)
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
    return json(200, { ok: true, creationId: container.id, publishedId: published.id })
  }

  if (type === 'story') {
    const container = await graphPost<{ id: string }>(`${igId}/media`, { image_url: urls[0], media_type: 'STORIES', caption }, token)
    const published = await graphPost<{ id: string }>(`${igId}/media_publish`, { creation_id: container.id }, token)
    return json(200, { ok: true, creationId: container.id, publishedId: published.id })
  }

  const children: string[] = []
  for (const u of urls.slice(0, 10)) {
    const child = await graphPost<{ id: string }>(`${igId}/media`, { image_url: u, is_carousel_item: true }, token)
    children.push(child.id)
  }
  const container = await graphPost<{ id: string }>(`${igId}/media`, { media_type: 'CAROUSEL', children: children.join(','), caption }, token)
  const published = await graphPost<{ id: string }>(`${igId}/media_publish`, { creation_id: container.id }, token)
  return json(200, { ok: true, creationId: container.id, children, publishedId: published.id })
}

