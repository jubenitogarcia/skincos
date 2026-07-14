import { requireCrmUser } from './crmAuth'

const json = (status: number, body: any) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  })

const ADMIN_ROLES = new Set(['GESTOR', 'GERENTE'])

const normalizeRole = (value: unknown) => {
  const raw = String(value || '').trim().toUpperCase()
  if (!raw) return ''
  if (raw === 'ADMIN') return 'GESTOR'
  if (raw === 'OPERADOR') return 'INJETOR'
  return raw
}

export async function requireSocialAdmin(context: any) {
  const userOrRes = await requireCrmUser(context)
  if (userOrRes instanceof Response) return userOrRes

  const role = normalizeRole((userOrRes as any).role)
  if (ADMIN_ROLES.has(role)) return userOrRes

  return json(403, {
    ok: false,
    error: 'FORBIDDEN',
    code: 'ADMIN_REQUIRED',
    message: 'Acesso restrito ao módulo Meta Ads.',
    role,
    retryable: false,
    hint: `Seu role atual é ${role || '(vazio)'}. Este módulo exige GESTOR/GERENTE.`,
  })
}
