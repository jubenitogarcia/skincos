import { requireInsumosUser } from '../../_lib/insumosAuth'
import { getShareBucket } from '../../_lib/r2'
import { deleteConnection } from '../../_lib/instagramStore'
import { requireCsrfForMutations } from '../../_lib/csrf'
import { requestAuditMeta, writeAuditEvent } from '../../_lib/audit'

const json = (status: number, body: any) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  })

export async function onRequestPost(context: any): Promise<Response> {
  const userOrRes = await requireInsumosUser(context)
  if (userOrRes instanceof Response) return userOrRes
  const csrfRes = requireCsrfForMutations(context)
  if (csrfRes) return csrfRes

  const bucket = getShareBucket(context)
  if (!bucket) return json(503, { ok: false, error: 'SHARE_BUCKET not configured' })

  await deleteConnection(bucket, userOrRes.id).catch(() => null)
  await writeAuditEvent(bucket, {
    scope: 'instagram',
    action: 'instagram.disconnect',
    actor: { id: userOrRes.id, email: userOrRes.email, name: userOrRes.name },
    request: requestAuditMeta(context.request),
    ok: true,
  }).catch(() => null)
  return json(200, { ok: true, connected: false })
}
