import { sanitizeProxyRequestHeaders } from '../../_lib/proxy'

const json = (status: number, error: string) => new Response(JSON.stringify({ ok: false, error }), {
  status,
  headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
})

const TARGETS: Record<string, string> = {
  production: 'https://api.skincos.com.br',
  staging: 'https://api-staging.skincos.com.br',
}

function resolveTarget(context: any): string | null {
  const environment = String(context?.env?.SKINCOS_DEPLOYMENT_ENV || '').trim().toLowerCase()
  const expected = TARGETS[environment]
  const configured = String(context?.env?.INSUMOS_API_TARGET || context?.env?.AUTH_API_TARGET || '').trim()
  return expected && configured === expected ? expected : null
}

export async function onRequest(context: any): Promise<Response> {
  const request: Request = context.request
  const method = String(request.method || 'GET').toUpperCase()
  if (!['GET', 'HEAD'].includes(method)) return json(405, 'METHOD_NOT_ALLOWED')
  const target = resolveTarget(context)
  if (!target) return json(503, 'PONTO_INSUMOS_HEALTH_UNCONFIGURED')
  const headers = sanitizeProxyRequestHeaders(request.headers)
  headers.set('accept', 'application/json')
  const upstream = await fetch(`${target}/insumos/health`, { method, headers, redirect: 'manual' }).catch(() => null)
  if (!upstream) return json(502, 'PONTO_INSUMOS_HEALTH_UNAVAILABLE')
  const outHeaders = new Headers(upstream.headers)
  outHeaders.set('cache-control', 'no-store')
  return new Response(method === 'HEAD' ? null : upstream.body, { status: upstream.status, statusText: upstream.statusText, headers: outHeaders })
}
