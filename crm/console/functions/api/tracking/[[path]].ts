import { copySetCookieHeaders, proxyRequestBody, sanitizeProxyRequestHeaders } from '../../_lib/proxy'

const DEFAULT_TARGET = 'https://cs-api.skincos.com.br'

function resolveRuntimeEnv(context: any): Record<string, string | undefined> {
  if (context?.env) return context.env as Record<string, string | undefined>
  if (typeof process !== 'undefined' && (process as any)?.env) {
    return (process as any).env as Record<string, string | undefined>
  }
  return {}
}

function pickTargetOrigin(runtimeEnv: Record<string, string | undefined>, requestOrigin: string): string {
  const candidates = [
    runtimeEnv.TRACKING_API_TARGET,
    runtimeEnv.CRM_API_TARGET,
  ]
    .map((value) => String(value || '').trim())
    .filter(Boolean)

  for (const candidate of candidates) {
    try {
      const parsed = new URL(candidate)
      if (parsed.origin === requestOrigin) continue
      return parsed.origin + parsed.pathname.replace(/\/$/, '')
    } catch {
      // ignore invalid candidate
    }
  }

  return DEFAULT_TARGET
}

function sanitizeTargetForDisplay(targetOrigin: string): string {
  try {
    const url = new URL(targetOrigin)
    if (url.username || url.password) {
      url.username = ''
      url.password = ''
    }
    return url.toString()
  } catch {
    return targetOrigin
  }
}

export async function onRequest(context: any): Promise<Response> {
  const request: Request = context.request
  const url = new URL(request.url)

  const prefix = '/api/tracking'
  const rest = url.pathname.startsWith(prefix) ? url.pathname.slice(prefix.length) || '/' : url.pathname
  const runtimeEnv = resolveRuntimeEnv(context)
  const targetOrigin = pickTargetOrigin(runtimeEnv, url.origin)

  if (rest === '/_proxy-status' || rest === '/_proxy-status/') {
    return new Response(
      JSON.stringify({
        ok: true,
        target: sanitizeTargetForDisplay(targetOrigin),
      }),
      {
        status: 200,
        headers: {
          'content-type': 'application/json',
          'cache-control': 'no-store',
        },
      },
    )
  }

  const targetUrl = new URL(targetOrigin)
  const basePath = targetUrl.pathname.replace(/\/$/, '')
  targetUrl.pathname = `${basePath}/api/tracking${rest.startsWith('/') ? '' : '/'}${rest}`
  targetUrl.search = url.search

  const headers = sanitizeProxyRequestHeaders(request.headers)
  headers.set('accept', 'application/json')

  const method = (request.method || 'GET').toUpperCase()
  const body = proxyRequestBody(method, request)

  const upstreamRequest = new Request(targetUrl.toString(), {
    method,
    headers,
    body,
    redirect: 'manual',
  })

  const upstream = await fetch(upstreamRequest)
  const outHeaders = new Headers(upstream.headers)
  outHeaders.set('cache-control', 'no-store')

  try {
    copySetCookieHeaders(upstream.headers, outHeaders)
  } catch {
    // ignore
  }

  return new Response(upstream.body, {
    status: upstream.status,
    statusText: upstream.statusText,
    headers: outHeaders,
  })
}
