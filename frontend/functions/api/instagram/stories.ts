import { requireInsumosUser } from '../../_lib/insumosAuth'
import { getShareBucket } from '../../_lib/r2'
import { graphGet } from '../../_lib/instagramGraph'
import { readConnectionDecrypted } from '../../_lib/instagramStore'

const json = (status: number, body: any) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  })

export async function onRequestGet(context: any): Promise<Response> {
  const userOrRes = await requireInsumosUser(context)
  if (userOrRes instanceof Response) return userOrRes

  const bucket = getShareBucket(context)
  if (!bucket) return json(503, { ok: false, error: 'SHARE_BUCKET not configured' })

  const secret = String(context?.env?.INTEGRATIONS_ENCRYPTION_SECRET || '').trim() || undefined
  const conn = await readConnectionDecrypted(bucket, userOrRes.id, secret)
  if (!conn) return json(401, { ok: false, error: 'INSTAGRAM_NOT_CONNECTED' })

  const url = new URL(context.request.url)
  const limit = Math.max(1, Math.min(100, Number(url.searchParams.get('limit') || 25)))
  const fields = ['id', 'media_type', 'media_url', 'thumbnail_url', 'permalink', 'timestamp', 'caption'].join(',')

  const data = await graphGet<{ data: any[] }>(`${conn.igBusinessAccountId}/stories`, { fields, limit }, conn.accessToken)
  return json(200, { ok: true, data: data.data || [] })
}

