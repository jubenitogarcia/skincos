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
  if (!connection?.pageId || !connection?.pageAccessToken) {
    return json(401, { ok: false, error: 'PAGE_NOT_SELECTED' })
  }

  const body = await context.request.json().catch(() => null)
  const message = String(body?.message || '').trim()
  const imageUrl = String(body?.imageUrl || '').trim()

  if (!message) return json(400, { ok: false, error: 'INVALID_INPUT', hint: 'Informe a mensagem do post' })
  if (imageUrl && !imageUrl.startsWith('https://')) {
    return json(400, { ok: false, error: 'INVALID_IMAGE_URL', hint: 'A imagem deve usar https://' })
  }

  const result = imageUrl
    ? await facebookReviewGraphPost<{ id?: string; post_id?: string }>(
        `${connection.pageId}/photos`,
        { url: imageUrl, caption: message, published: 'true' },
        connection.pageAccessToken,
      )
    : await facebookReviewGraphPost<{ id?: string; post_id?: string }>(
        `${connection.pageId}/feed`,
        { message },
        connection.pageAccessToken,
      )

  await writeAuditEvent(bucket, {
    scope: 'facebook-review',
    action: 'facebook-review.publish',
    actor: { id: userOrRes.id, email: userOrRes.email, name: userOrRes.name },
    request: requestAuditMeta(context.request),
    target: { pageId: connection.pageId, hasImage: !!imageUrl },
    ok: true,
  }).catch(() => null)

  return json(200, {
    ok: true,
    pageId: connection.pageId,
    postId: String(result?.post_id || result?.id || ''),
    message,
    imageUrl: imageUrl || null,
  })
}
