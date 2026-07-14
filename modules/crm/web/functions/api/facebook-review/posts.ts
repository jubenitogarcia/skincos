import { requireCrmUser } from '../../_lib/crmAuth'
import { facebookReviewGraphGet } from '../../_lib/facebookReviewGraph'
import { readFacebookReviewConnectionDecrypted } from '../../_lib/facebookReviewStore'
import { getIntegrationsEncryptionSecret, integrationsEncryptionSecretRequired, isMissingIntegrationsEncryptionSecretError } from '../../_lib/integrationsEncryption'
import { getShareBucket } from '../../_lib/r2'

const json = (status: number, body: any) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  })

export async function onRequestGet(context: any): Promise<Response> {
  const userOrRes = await requireCrmUser(context)
  if (userOrRes instanceof Response) return userOrRes

  const bucket = getShareBucket(context)
  if (!bucket) return json(503, { ok: false, error: 'SHARE_BUCKET_NOT_CONFIGURED' })

  const secret = getIntegrationsEncryptionSecret(context)
  if (integrationsEncryptionSecretRequired(context) && !secret) {
    return json(503, { ok: false, error: 'INTEGRATIONS_ENCRYPTION_SECRET_REQUIRED' })
  }

  let connection: any = null
  try {
    connection = await readFacebookReviewConnectionDecrypted(bucket, userOrRes.id, secret)
  } catch (error: any) {
    if (!secret && isMissingIntegrationsEncryptionSecretError(error)) {
      return json(503, { ok: false, error: 'INTEGRATIONS_ENCRYPTION_SECRET_REQUIRED' })
    }
    return json(500, { ok: false, error: 'INTERNAL' })
  }
  if (!connection?.pageId || !connection?.pageAccessToken) {
    return json(401, { ok: false, error: 'PAGE_NOT_SELECTED' })
  }

  const feed = await facebookReviewGraphGet<{ data: any[] }>(
    `${connection.pageId}/feed`,
    { fields: 'id,message,created_time,permalink_url,full_picture,status_type', limit: 20 },
    connection.pageAccessToken,
  )

  return json(200, {
    ok: true,
    pageId: connection.pageId,
    posts: (feed.data || []).map((post: any) => ({
      id: String(post?.id || ''),
      message: post?.message ? String(post.message) : '',
      createdTime: post?.created_time ? String(post.created_time) : null,
      permalinkUrl: post?.permalink_url ? String(post.permalink_url) : null,
      fullPicture: post?.full_picture ? String(post.full_picture) : null,
      statusType: post?.status_type ? String(post.status_type) : null,
    })),
  })
}
