import { requireCrmUser } from '../../../_lib/crmAuth'
import {
  deleteFacebookReviewPending,
  readFacebookReviewPendingDecrypted,
  writeFacebookReviewConnection,
} from '../../../_lib/facebookReviewStore'
import { getIntegrationsEncryptionSecret, integrationsEncryptionSecretRequired, isMissingIntegrationsEncryptionSecretError } from '../../../_lib/integrationsEncryption'
import { getShareBucket } from '../../../_lib/r2'
import { requireCsrfForMutations } from '../../../_lib/csrf'

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

  const body = await context.request.json().catch(() => null)
  const pendingId = String(body?.pendingId || '').trim()
  const pageId = String(body?.pageId || '').trim()
  if (!pendingId || !pageId) return json(400, { ok: false, error: 'INVALID_INPUT' })

  let pending: any = null
  try {
    pending = await readFacebookReviewPendingDecrypted(bucket, userOrRes.id, pendingId, secret)
  } catch (error: any) {
    if (!secret && isMissingIntegrationsEncryptionSecretError(error)) {
      return json(503, { ok: false, error: 'INTEGRATIONS_ENCRYPTION_SECRET_REQUIRED' })
    }
    return json(500, { ok: false, error: 'INTERNAL' })
  }

  if (!pending) return json(404, { ok: false, error: 'PENDING_NOT_FOUND' })

  const selectedPage = (pending.pages || []).find((page: any) => String(page?.id || '') === pageId)
  if (!selectedPage?.accessToken) return json(404, { ok: false, error: 'PAGE_NOT_FOUND' })

  await writeFacebookReviewConnection(
    bucket,
    userOrRes.id,
    {
      userAccessToken: pending.userAccessToken,
      pageId: selectedPage.id,
      pageName: selectedPage.name,
      pageAccessToken: selectedPage.accessToken,
      tokenType: 'oauth',
      updatedAt: new Date().toISOString(),
    },
    secret,
  )
  await deleteFacebookReviewPending(bucket, userOrRes.id, pendingId)

  return json(200, { ok: true, pageId: selectedPage.id, pageName: selectedPage.name || null })
}
