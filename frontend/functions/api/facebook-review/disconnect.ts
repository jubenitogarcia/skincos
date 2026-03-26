import { requireCrmUser } from '../../_lib/crmAuth'
import { requireCsrfForMutations } from '../../_lib/csrf'
import { deleteFacebookReviewConnection } from '../../_lib/facebookReviewStore'
import { getShareBucket } from '../../_lib/r2'

const json = (status: number, body: any) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  })

export async function onRequestPost(context: any): Promise<Response> {
  const userOrRes = await requireCrmUser(context)
  if (userOrRes instanceof Response) return userOrRes
  const csrfRes = requireCsrfForMutations(context)
  if (csrfRes) return csrfRes

  const bucket = getShareBucket(context)
  if (!bucket) return json(503, { ok: false, error: 'SHARE_BUCKET_NOT_CONFIGURED' })

  await deleteFacebookReviewConnection(bucket, userOrRes.id)
  return json(200, { ok: true })
}
