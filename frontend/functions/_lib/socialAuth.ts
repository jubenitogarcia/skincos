import { requireInsumosUser } from './insumosAuth'

const json = (status: number, body: any) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  })

function parseAllowlist(raw: any): Set<string> {
  const parts = String(raw || '')
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean)
  return new Set(parts)
}

function parseRoles(raw: any): Set<string> {
  const parts = String(raw || '')
    .split(',')
    .map((s) => s.trim().toUpperCase())
    .filter(Boolean)
  return new Set(parts)
}

export async function requireSocialAdmin(context: any) {
  const userOrRes = await requireInsumosUser(context)
  if (userOrRes instanceof Response) return userOrRes

  const roleAllowlist = parseRoles(context?.env?.SOCIAL_ADMIN_ROLE_ALLOWLIST)
  if (roleAllowlist.size) {
    const role = String((userOrRes as any).role || '').trim().toUpperCase()
    if (role && roleAllowlist.has(role)) return userOrRes
  }

  const allowlist = parseAllowlist(context?.env?.SOCIAL_ADMIN_EMAIL_ALLOWLIST)
  if (allowlist.size) {
    const email = String(userOrRes.email || '').trim().toLowerCase()
    if (!email || !allowlist.has(email)) return json(403, { ok: false, error: 'FORBIDDEN' })
  }

  const expected = String(context?.env?.SOCIAL_ADMIN_TOKEN || '').trim()
  if (!expected) return json(503, { ok: false, error: 'SOCIAL_ADMIN_TOKEN_NOT_CONFIGURED' })

  const got = String(context?.request?.headers?.get?.('x-social-admin-token') || '').trim()
  if (!got || got !== expected) return json(403, { ok: false, error: 'FORBIDDEN' })

  return userOrRes
}
