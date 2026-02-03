export type InsumosAuthUser = {
  id: string
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

export async function getInsumosUser(context: any): Promise<InsumosAuthUser | null> {
  const targetOrigin = (context?.env?.INSUMOS_API_TARGET as string | undefined) || 'https://api.skincos.com.br'
  const url = new URL(targetOrigin)
  url.pathname = '/insumos/auth/me'

  const headers = new Headers()
  headers.set('accept', 'application/json')
  const cookie = context?.request?.headers?.get?.('cookie')
  if (cookie) headers.set('cookie', cookie)

  const res = await fetch(url.toString(), { method: 'GET', headers, redirect: 'manual' }).catch(() => null)
  if (!res || !res.ok) return null

  const data = await res.json().catch(() => null)
  const raw = data?.user || data?.usuario || data || null
  const id = raw?.username || raw?.email || raw?.id
  if (!id) return null
  return {
    id: String(id),
    name: raw?.displayName || raw?.name || raw?.username || raw?.email || undefined,
    email: raw?.email || undefined,
    role: raw?.role || undefined,
    allowedUnits: Array.isArray(raw?.allowedUnits) ? raw.allowedUnits : undefined,
  }
}

export async function requireInsumosUser(context: any): Promise<InsumosAuthUser | Response> {
  const user = await getInsumosUser(context)
  if (!user) return json(401, { ok: false, error: 'UNAUTHORIZED', hint: 'Faça login para usar a integração Instagram.' })
  return user
}
