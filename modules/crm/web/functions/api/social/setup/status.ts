import { requireCrmUser } from '../../../_lib/crmAuth'
import { getShareBucketInfo } from '../../../_lib/r2'
import { getIntegrationsEncryptionSecret, integrationsEncryptionSecretRequired } from '../../../_lib/integrationsEncryption'

const json = (status: number, body: any) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  })

const parseCsv = (raw: any): string[] => {
  const parts = String(raw || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
  return [...new Set(parts)]
}

export async function onRequestGet(context: any): Promise<Response> {
  const userOrRes = await requireCrmUser(context)
  if (userOrRes instanceof Response) return userOrRes

  const { bucketConfigured, effectiveKeyPrefix } = getShareBucketInfo(context)
  const secret = getIntegrationsEncryptionSecret(context)
  const encryptionRequired = integrationsEncryptionSecretRequired(context)

  const defaultUnitsFromEnv = parseCsv(context?.env?.SOCIAL_DEFAULT_UNITS)
  const role = String((userOrRes as any)?.role || '').trim()
  const normalizedRole = role.toUpperCase()
  const effectiveRole = normalizedRole === 'ADMIN' ? 'GESTOR' : normalizedRole === 'OPERADOR' ? 'INJETOR' : normalizedRole
  const isAdmin = effectiveRole === 'GESTOR' || effectiveRole === 'GERENTE'

  return json(200, {
    ok: true,
    user: {
      username: String((userOrRes as any)?.username || '').trim() || undefined,
      displayName: String((userOrRes as any)?.displayName || '').trim() || undefined,
      email: userOrRes.email || undefined,
      role: (userOrRes as any)?.role || undefined,
      allowedUnits: Array.isArray((userOrRes as any)?.allowedUnits) ? (userOrRes as any).allowedUnits : undefined,
    },
    r2: { bucketConfigured, effectiveKeyPrefix },
    encryption: { required: encryptionRequired, configured: !!secret },
    admin: { isAdmin, role: role || undefined },
    socialDefaults: { defaultUnitsFromEnv },
  })
}
