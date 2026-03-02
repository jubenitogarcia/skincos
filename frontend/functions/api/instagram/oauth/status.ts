import { requireCrmUser } from '../../../_lib/crmAuth'
import { getIntegrationsEncryptionSecret, integrationsEncryptionSecretRequired } from '../../../_lib/integrationsEncryption'

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

  const missing: string[] = []
  if (!appId) missing.push('META_APP_ID')
  if (!appSecret) missing.push('META_APP_SECRET')
  if (!stateSecret) missing.push('META_OAUTH_STATE_SECRET')

  const encSecret = getIntegrationsEncryptionSecret(context)
  if (integrationsEncryptionSecretRequired(context) && !encSecret) missing.push('INTEGRATIONS_ENCRYPTION_SECRET')

  return json(200, {
    ok: true,
    configured: missing.length === 0,
    missing,
  })
}
