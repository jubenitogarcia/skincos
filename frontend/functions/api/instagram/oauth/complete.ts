import { requireInsumosUser } from '../../../_lib/insumosAuth'
import { getShareBucket } from '../../../_lib/r2'
import { deletePending, readPendingDecrypted, writeConnection } from '../../../_lib/instagramStore'

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

  const body = await context.request.json().catch(() => null)
  const pendingId = String(body?.pendingId || '').trim()
  const pageId = String(body?.pageId || '').trim()
  if (!pendingId || !pageId) return json(400, { ok: false, error: 'INVALID_INPUT' })

  const encSecret = String(context?.env?.INTEGRATIONS_ENCRYPTION_SECRET || '').trim() || undefined
  const pending = await readPendingDecrypted(bucket, userOrRes.id, pendingId, encSecret)
  if (!pending) return json(404, { ok: false, error: 'PENDING_NOT_FOUND' })
  if (pending.userId !== userOrRes.id) return json(403, { ok: false, error: 'FORBIDDEN' })

  const page = (pending.pages || []).find((p) => String(p.id) === pageId)
  const igId = page?.instagram_business_account?.id
  if (!igId) return json(400, { ok: false, error: 'PAGE_INVALID' })

  await writeConnection(
    bucket,
    userOrRes.id,
    { accessToken: pending.accessToken, igBusinessAccountId: String(igId), pageId, tokenType: 'oauth', updatedAt: new Date().toISOString() },
    encSecret,
  )
  await deletePending(bucket, userOrRes.id, pendingId).catch(() => null)

  return json(200, { ok: true, connected: true, businessAccountId: String(igId) })
}

