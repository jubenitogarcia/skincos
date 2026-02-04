import { requireCrmUser } from './crmAuth'

const json = (status: number, body: any) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  })

const ADMIN_ROLES = new Set(['ADMIN', 'GESTOR', 'GERENTE'])

export async function requireSocialAdmin(context: any) {
  const userOrRes = await requireCrmUser(context)
  if (userOrRes instanceof Response) return userOrRes

  const role = String((userOrRes as any).role || '').trim().toUpperCase()
  if (ADMIN_ROLES.has(role)) return userOrRes

  return json(403, { ok: false, error: 'FORBIDDEN', code: 'ADMIN_REQUIRED' })
}
