import { isLocalDevAuthBypassEnabled, requireCrmUser } from '../../_lib/crmAuth'

const json = (status: number, body: Record<string, unknown>) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' } })
const role = (value: unknown) => { const raw = String(value || '').trim().toUpperCase(); return raw === 'ADMIN' ? 'GESTOR' : raw === 'OPERADOR' ? 'INJETOR' : raw }
const encode = (value: string) => btoa(String.fromCharCode(...new TextEncoder().encode(value))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '')
async function hmac(secret: string, message: string) { const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']); const signature = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(message)); return btoa(String.fromCharCode(...new Uint8Array(signature))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '') }

export async function onRequest(context: { request: Request; env?: Record<string, unknown> }): Promise<Response> {
  const request = context.request; const userOrResponse = await requireCrmUser(context); if (userOrResponse instanceof Response) return userOrResponse
  const allowed = Array.isArray(userOrResponse.allowedModules) ? userOrResponse.allowedModules.map(String) : []
  if (!['GESTOR', 'GERENTE'].includes(role(userOrResponse.role)) && allowed.length && !allowed.includes('caixa')) return json(403, { ok: false, error: 'FORBIDDEN' })
  const env = context.env || {}; const targetOrigin = String(env.CAIXA_API_TARGET || env.ATENDIMENTO_API_TARGET || env.CRM_API_TARGET || '').trim(); const secret = String(env.CAIXA_ACTOR_HMAC_KEY || env.ATENDIMENTO_ACTOR_HMAC_KEY || env.ESCALA_ACTOR_HMAC_KEY || env.CRM_ESCALA_HMAC_KEY || '').trim()
  if (!targetOrigin) return json(503, { ok: false, error: 'CAIXA_API_TARGET_NOT_CONFIGURED' })
  if (!secret && !isLocalDevAuthBypassEnabled(context)) return json(503, { ok: false, error: 'ACTOR_KEY_NOT_CONFIGURED' })
  const actor = { id: String(userOrResponse.id || userOrResponse.username || userOrResponse.email || ''), username: userOrResponse.username, email: userOrResponse.email, name: userOrResponse.displayName, role: role(userOrResponse.role), allowedUnits: userOrResponse.allowedUnits, allowedModules: userOrResponse.allowedModules }
  const encoded = encode(JSON.stringify(actor)); const headers = new Headers(); headers.set('content-type', request.headers.get('content-type') || 'application/json'); headers.set('x-crm-user', encoded)
  if (secret) { const ts = String(Date.now()); headers.set('x-crm-ts', ts); headers.set('x-crm-signature', await hmac(secret, `${ts}.${encoded}`)) }
  const incoming = new URL(request.url); const target = new URL(targetOrigin); const rest = incoming.pathname.replace(/^\/api\/caixa/, '') || '/'; target.pathname = `${target.pathname.replace(/\/$/, '')}/api/caixa${rest}`; target.search = incoming.search
  const method = request.method.toUpperCase(); const upstream = await fetch(target, { method, headers, body: method === 'GET' || method === 'HEAD' ? undefined : request.body, redirect: 'manual' }).catch(() => null)
  if (!upstream) return json(502, { ok: false, error: 'UPSTREAM_UNREACHABLE' })
  return new Response(upstream.body, { status: upstream.status, headers: new Headers({ 'cache-control': 'no-store', 'content-type': upstream.headers.get('content-type') || 'application/json' }) })
}
