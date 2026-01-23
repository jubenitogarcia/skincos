import { requireInsumosUser } from './insumosAuth'

const json = (status: number, body: any) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  })

export async function requireSocialAdmin(context: any) {
  const userOrRes = await requireInsumosUser(context)
  if (userOrRes instanceof Response) return userOrRes

  const expected = String(context?.env?.SOCIAL_ADMIN_TOKEN || '').trim()
  if (!expected) return json(503, { ok: false, error: 'SOCIAL_ADMIN_TOKEN_NOT_CONFIGURED' })

  const got = String(context?.request?.headers?.get?.('x-social-admin-token') || '').trim()
  if (!got || got !== expected) return json(403, { ok: false, error: 'FORBIDDEN' })

  return userOrRes
}

