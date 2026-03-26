import { requireCrmUser } from '../../_lib/crmAuth'
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

  const appId = String(context?.env?.META_APP_ID || '').trim()
  const appSecret = String(context?.env?.META_APP_SECRET || '').trim()
  const stateSecret = String(context?.env?.META_OAUTH_STATE_SECRET || context?.env?.META_APP_SECRET || '').trim()
  const bucket = getShareBucket(context)
  const secret = getIntegrationsEncryptionSecret(context)

  const missing: string[] = []
  if (!appId) missing.push('META_APP_ID')
  if (!appSecret) missing.push('META_APP_SECRET')
  if (!stateSecret) missing.push('META_OAUTH_STATE_SECRET')
  if (!bucket) missing.push('SHARE_BUCKET')
  if (integrationsEncryptionSecretRequired(context) && !secret) missing.push('INTEGRATIONS_ENCRYPTION_SECRET')

  let connection: any = null
  if (bucket) {
    try {
      connection = await readFacebookReviewConnectionDecrypted(bucket, userOrRes.id, secret)
    } catch (error: any) {
      if (!secret && isMissingIntegrationsEncryptionSecretError(error)) {
        missing.push('INTEGRATIONS_ENCRYPTION_SECRET')
      } else {
        return json(500, { ok: false, error: 'INTERNAL' })
      }
    }
  }

  return json(200, {
    ok: true,
    configured: missing.length === 0,
    missing,
    connected: !!connection?.pageId && !!connection?.pageAccessToken,
    selectedPage: connection?.pageId
      ? {
          id: connection.pageId,
          name: connection.pageName || null,
          updatedAt: connection.updatedAt || null,
        }
      : null,
  })
}
