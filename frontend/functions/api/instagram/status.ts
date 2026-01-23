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
  if (!conn) return json(200, { ok: true, connected: false })

  let username: string | undefined
  try {
    const info = await graphGet<{ username?: string }>(conn.igBusinessAccountId, { fields: 'username' }, conn.accessToken)
    username = info?.username
  } catch {
    username = undefined
  }

  return json(200, {
    ok: true,
    connected: true,
    businessAccountId: conn.igBusinessAccountId,
    pageId: conn.pageId,
    username,
    tokenType: conn.tokenType,
    updatedAt: conn.updatedAt,
  })
}

