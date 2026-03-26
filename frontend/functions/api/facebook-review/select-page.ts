import { requireCrmUser } from '../../_lib/crmAuth'
import { requireCsrfForMutations } from '../../_lib/csrf'
import { facebookReviewGraphGet } from '../../_lib/facebookReviewGraph'
import { readFacebookReviewConnectionDecrypted, writeFacebookReviewConnection } from '../../_lib/facebookReviewStore'
import { getIntegrationsEncryptionSecret, integrationsEncryptionSecretRequired, isMissingIntegrationsEncryptionSecretError } from '../../_lib/integrationsEncryption'
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
  if (!connection?.userAccessToken) return json(401, { ok: false, error: 'META_NOT_CONNECTED' })

  const body = await context.request.json().catch(() => null)
  const pageId = String(body?.pageId || '').trim()
  if (!pageId) return json(400, { ok: false, error: 'INVALID_INPUT', hint: 'Informe pageId' })

  const pagesRes = await facebookReviewGraphGet<{ data: any[] }>(
    'me/accounts',
    { fields: 'id,name,access_token,picture{url},tasks', limit: 50 },
    connection.userAccessToken,
  )
  const selected = (pagesRes.data || []).find((page: any) => String(page?.id || '') === pageId)
  if (!selected?.access_token) return json(404, { ok: false, error: 'PAGE_NOT_FOUND' })

  await writeFacebookReviewConnection(
    bucket,
    userOrRes.id,
    {
      ...connection,
      pageId,
      pageName: selected?.name ? String(selected.name) : undefined,
      pageAccessToken: String(selected.access_token),
      updatedAt: new Date().toISOString(),
    },
    secret,
  )

  return json(200, { ok: true, pageId, pageName: selected?.name ? String(selected.name) : null })
}
