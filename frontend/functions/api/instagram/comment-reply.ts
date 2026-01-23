import { requireInsumosUser } from '../../_lib/insumosAuth'
import { getShareBucket } from '../../_lib/r2'
import { graphPost } from '../../_lib/instagramGraph'
import { readConnectionDecrypted } from '../../_lib/instagramStore'

const json = (status: number, body: any) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  })

export async function onRequestPost(context: any): Promise<Response> {
  const userOrRes = await requireInsumosUser(context)
  if (userOrRes instanceof Response) return userOrRes

  const bucket = getShareBucket(context)
  if (!bucket) return json(503, { ok: false, error: 'SHARE_BUCKET not configured' })

  const secret = String(context?.env?.INTEGRATIONS_ENCRYPTION_SECRET || '').trim() || undefined
  const conn = await readConnectionDecrypted(bucket, userOrRes.id, secret)
  if (!conn) return json(401, { ok: false, error: 'INSTAGRAM_NOT_CONNECTED' })

  const body = await context.request.json().catch(() => null)
  const commentId = String(body?.commentId || '').trim()
  const message = String(body?.message || '').trim()
  if (!commentId || !message) return json(400, { ok: false, error: 'INVALID_INPUT', hint: 'Informe commentId e message.' })

  const out = await graphPost<{ id: string }>(`${commentId}/replies`, { message }, conn.accessToken)
  return json(200, { ok: true, id: out.id })
}

