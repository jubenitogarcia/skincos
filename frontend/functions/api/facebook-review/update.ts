import { requireCrmUser } from '../../_lib/crmAuth'
import { requireCsrfForMutations } from '../../_lib/csrf'
import { facebookReviewGraphPost } from '../../_lib/facebookReviewGraph'
import { readFacebookReviewConnectionDecrypted } from '../../_lib/facebookReviewStore'
import { getIntegrationsEncryptionSecret, integrationsEncryptionSecretRequired, isMissingIntegrationsEncryptionSecretError } from '../../_lib/integrationsEncryption'
import { getShareBucket } from '../../_lib/r2'
import { requestAuditMeta, writeAuditEvent } from '../../_lib/audit'

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
  if (!connection?.pageAccessToken) return json(401, { ok: false, error: 'PAGE_NOT_SELECTED' })

  const body = await context.request.json().catch(() => null)
  const postId = String(body?.postId || '').trim()
  const message = String(body?.message || '').trim()
  if (!postId || !message) return json(400, { ok: false, error: 'INVALID_INPUT' })

  await facebookReviewGraphPost(postId, { message }, connection.pageAccessToken)

  await writeAuditEvent(bucket, {
    scope: 'facebook-review',
    action: 'facebook-review.update',
    actor: { id: userOrRes.id, email: userOrRes.email, name: userOrRes.name },
    request: requestAuditMeta(context.request),
    target: { pageId: connection.pageId, postId },
    ok: true,
  }).catch(() => null)

  return json(200, { ok: true, postId })
}
