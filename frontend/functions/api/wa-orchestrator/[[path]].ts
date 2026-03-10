import { copySetCookieHeaders, proxyRequestBody, sanitizeProxyRequestHeaders } from '../../_lib/proxy'

export async function onRequest(context: any): Promise<Response> {
  const request: Request = context.request
  const url = new URL(request.url)

  // Incoming:  /api/wa-orchestrator/<rest>
  // Outgoing:  <TARGET>/api/wa-orchestrator/<rest>
  const prefix = '/api/wa-orchestrator'
  const rest = url.pathname.startsWith(prefix) ? url.pathname.slice(prefix.length) || '/' : url.pathname

  const runtimeEnv = (() => {
    if (context?.env) return context.env as Record<string, string | undefined>
    if (typeof process !== 'undefined' && (process as any)?.env) return (process as any).env as Record<string, string | undefined>
    return {}
  })()
  const rawTargets = [
    runtimeEnv.WA_ORCHESTRATOR_API_TARGET,
    runtimeEnv.CRM_API_TARGET,
    runtimeEnv.INSUMOS_API_TARGET
  ].map((v) => String(v || '').trim()).filter(Boolean)
  const requestOrigin = url.origin

  const defaultTarget = (() => {
    const host = String(url.hostname || '').toLowerCase()
    if (host === 'localhost' || host === '127.0.0.1') return 'http://localhost:8099'
    return 'https://cs-api.skincos.com.br'
  })()

  const isValidOrchestratorTarget = (candidate: string) => {
    try {
      const parsed = new URL(candidate)
      const host = parsed.hostname.toLowerCase()
      if (host === 'api.skincos.com.br' || host.endsWith('.skincos.workers.dev')) return false
      return true
    } catch {
      return false
    }
  }

  const pickTarget = () => {
    for (const candidate of rawTargets) {
      if (!isValidOrchestratorTarget(candidate)) continue
      try {
        const parsed = new URL(candidate)
        if (parsed.origin === requestOrigin) continue
        return candidate
      } catch {
        // ignore invalid
      }
    }
    return defaultTarget
  }

  const targetOrigin = String(pickTarget())
  const isProductionTarget = (() => {
    const raw = String(targetOrigin || '').trim().toLowerCase()
    return raw === 'https://api.skincos.com.br' || raw.endsWith('.skincos.com.br')
  })()

  const basicAuthRaw = String(runtimeEnv.WA_ORCHESTRATOR_BASIC_AUTH || runtimeEnv.CRM_BASIC_AUTH || '').trim()
  const hasBasicAuth = Boolean(basicAuthRaw && basicAuthRaw.includes(':'))
  const sanitizeUrl = (value: string) => {
    try {
      const u = new URL(value)
      if (u.username || u.password) {
        u.username = ''
        u.password = ''
      }
      return u.toString()
    } catch {
      return value
    }
  }

  if (rest === '/_proxy-status' || rest === '/_proxy-status/') {
    return new Response(
      JSON.stringify({
        ok: true,
        target: sanitizeUrl(targetOrigin),
        isProductionTarget,
        requestOrigin,
        targets: rawTargets.map(sanitizeUrl),
        hasBasicAuth
      }),
      {
        status: 200,
        headers: {
          'content-type': 'application/json',
          'cache-control': 'no-store'
        }
      }
    )
  }
  const targetUrl = new URL(targetOrigin)
  const basePath = targetUrl.pathname.replace(/\/$/, '')
  targetUrl.pathname = `${basePath}/api/wa-orchestrator${rest.startsWith('/') ? '' : '/'}${rest}`
  targetUrl.search = url.search

  const headers = sanitizeProxyRequestHeaders(request.headers)
  if (rest.startsWith('/events')) {
    headers.set('accept', 'text/event-stream')
  } else {
    headers.set('accept', 'application/json')
  }
  if (hasBasicAuth && !headers.has('authorization')) {
    const toBase64 = (value: string) => {
      if (typeof btoa === 'function') return btoa(value)
      const runtime = globalThis as { Buffer?: { from: (input: string) => { toString: (encoding: string) => string } } }
      if (typeof runtime.Buffer !== 'undefined') return runtime.Buffer.from(value).toString('base64')
      return value
    }
    headers.set('authorization', `Basic ${toBase64(basicAuthRaw)}`)
  }
  const method = (request.method || 'GET').toUpperCase()
  const body = proxyRequestBody(method, request)

  const upstreamRequest = new Request(targetUrl.toString(), {
    method,
    headers,
    body,
    redirect: 'manual'
  })

  const upstream = await fetch(upstreamRequest)

  const outHeaders = new Headers(upstream.headers)
  outHeaders.set('Cache-Control', 'no-store')

  const contentType = upstream.headers.get('content-type') || ''
  if (contentType.includes('text/html')) {
    const message = `Resposta inválida do orquestrador. Verifique WA_ORCHESTRATOR_API_TARGET/CRM_API_TARGET.`
    if (rest.startsWith('/events')) {
      return new Response(`data: ${JSON.stringify({ type: 'error', message })}\n\n`, {
        status: 502,
        headers: {
          'content-type': 'text/event-stream',
          'cache-control': 'no-store'
        }
      })
    }
    return new Response(
      JSON.stringify({ success: false, error: message, target: targetOrigin }),
      {
        status: 502,
        headers: {
          'content-type': 'application/json',
          'cache-control': 'no-store'
        }
      }
    )
  }

  try {
    const rewriteCookie = (cookie: string) => {
      if (!cookie) return cookie
      const parts = cookie.split(';').map(part => part.trim()).filter(Boolean)
      if (!parts.length) return cookie
      const [nameValue, ...attrs] = parts
      const filtered = attrs.filter(attr => !attr.toLowerCase().startsWith('domain='))
      return [nameValue, ...filtered].join('; ')
    }
    copySetCookieHeaders(upstream.headers, outHeaders, rewriteCookie)
  } catch {
    // ignore
  }

  return new Response(upstream.body, {
    status: upstream.status,
    statusText: upstream.statusText,
    headers: outHeaders
  })
}
