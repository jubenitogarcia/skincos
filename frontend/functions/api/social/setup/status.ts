import { requireInsumosUser } from '../../../_lib/insumosAuth'
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

const parseCsvLower = (raw: any): Set<string> => new Set(parseCsv(raw).map((s) => s.toLowerCase()))
const parseCsvUpper = (raw: any): Set<string> => new Set(parseCsv(raw).map((s) => s.toUpperCase()))

export async function onRequestGet(context: any): Promise<Response> {
  const userOrRes = await requireInsumosUser(context)
  if (userOrRes instanceof Response) return userOrRes

  const { bucketConfigured, effectiveKeyPrefix } = getShareBucketInfo(context)
  const secret = getIntegrationsEncryptionSecret(context)
  const encryptionRequired = integrationsEncryptionSecretRequired(context)

  const roleAllowlist = parseCsvUpper(context?.env?.SOCIAL_ADMIN_ROLE_ALLOWLIST)
  const emailAllowlist = parseCsvLower(context?.env?.SOCIAL_ADMIN_EMAIL_ALLOWLIST)
  const tokenConfigured = !!String(context?.env?.SOCIAL_ADMIN_TOKEN || '').trim()

  const roleAllowlistConfigured = roleAllowlist.size > 0
  const emailAllowlistConfigured = emailAllowlist.size > 0

  const role = String((userOrRes as any)?.role || '').trim().toUpperCase()
  const userCanAdminWithoutToken = roleAllowlistConfigured && !!role && roleAllowlist.has(role)
  const tokenRequiredForThisUser = !userCanAdminWithoutToken && tokenConfigured

  const defaultUnitsFromEnv = parseCsv(context?.env?.SOCIAL_DEFAULT_UNITS)

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
    adminPolicy: {
      roleAllowlistConfigured,
      emailAllowlistConfigured,
      tokenConfigured,
      userCanAdminWithoutToken,
      tokenRequiredForThisUser,
    },
    socialDefaults: { defaultUnitsFromEnv },
  })
}

