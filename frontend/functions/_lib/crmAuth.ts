export type CrmAuthUser = {
  id: string
  username?: string
  displayName?: string
  name?: string
  email?: string
  role?: string
  allowedUnits?: string[]
}

const json = (status: number, body: any) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  })

export async function getCrmUser(context: any): Promise<CrmAuthUser | null> {
  const env = context?.env || {}
  const targetOrigin =
    (env.AUTH_API_TARGET as string | undefined) ||
    (env.INSUMOS_API_TARGET as string | undefined) ||
    'https://api.skincos.com.br'

  const url = new URL(targetOrigin)
  // Auth backend path (internal implementation detail; UI/docs must not mention it)
  url.pathname = '/insumos/auth/me'

  const headers = new Headers()
  headers.set('accept', 'application/json')
  const cookie = context?.request?.headers?.get?.('cookie')
  if (cookie) headers.set('cookie', cookie)

  const res = await fetch(url.toString(), { method: 'GET', headers, redirect: 'manual' }).catch(() => null)
  if (!res || !res.ok) return null

  const data = await res.json().catch(() => null)
  const raw = data?.user || data?.usuario || data || null
  const username = raw?.username || undefined
  const email = raw?.email || undefined
  const id = username || email || raw?.id
  if (!id) return null

  const displayName = raw?.displayName || raw?.name || raw?.username || raw?.email || undefined
  return {
    id: String(id),
    username: username ? String(username) : undefined,
    displayName: displayName ? String(displayName) : undefined,
    name: displayName ? String(displayName) : undefined,
    email: email ? String(email) : undefined,
    role: raw?.role || undefined,
    allowedUnits: Array.isArray(raw?.allowedUnits) ? raw.allowedUnits : undefined,
  }
}

export async function requireCrmUser(context: any): Promise<CrmAuthUser | Response> {
  const user = await getCrmUser(context)
  if (!user) return json(401, { ok: false, error: 'UNAUTHORIZED', hint: 'Faça login no CRM para continuar.' })
  return user
}

