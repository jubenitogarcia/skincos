import { copySetCookieHeaders, proxyRequestBody, sanitizeProxyRequestHeaders } from '../../_lib/proxy'
import { isLocalDevAuthBypassEnabled } from '../../_lib/crmAuth'

function json(status: number, body: Record<string, unknown>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  })
}

function missingOrchestratorConfiguration(isLocalDev: boolean): Response {
  return new Response(JSON.stringify({
    success: false,
    error: 'WA_ORCHESTRATOR_NOT_CONFIGURED',
    code: 'WA_ORCHESTRATOR_API_TARGET_REQUIRED',
    hint: 'Integração WhatsApp não configurada neste ambiente. Defina WA_ORCHESTRATOR_API_TARGET no overlay privado local.',
    channels: [],
    totalChannels: 0,
    availableChannels: 0,
    connectedInstances: 0,
    freeInstances: 0,
    errorInstances: 0,
    startingInstances: 0,
    availableChannelsList: [],
    freeChannelsList: [],
    localStub: isLocalDev,
    mode: 'stub',
    targetSource: null,
    reachability: 'not_configured',
  }), {
    status: 503,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  })
}

function missingOrchestratorEvents(isLocalDev: boolean): Response {
  return new Response(`event: error\ndata: ${JSON.stringify({
    success: false,
    error: 'WA_ORCHESTRATOR_NOT_CONFIGURED',
    code: 'WA_ORCHESTRATOR_API_TARGET_REQUIRED',
    localStub: isLocalDev,
  })}\n\n`, {
    status: 503,
    headers: {
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-cache, no-store',
      connection: 'keep-alive',
    },
  })
}

function sanitizeUrl(value: string): string {
  try {
    const url = new URL(value)
    url.username = ''
    url.password = ''
    return url.toString()
  } catch {
    return value
  }
}

async function probeTarget(targetOrigin: string, headers: Headers): Promise<'reachable' | 'unreachable'> {
  try {
    const healthUrl = new URL(targetOrigin)
    healthUrl.pathname = `${healthUrl.pathname.replace(/\/$/, '')}/health`
    const response = await fetch(healthUrl.toString(), {
      method: 'GET',
      headers,
      redirect: 'manual',
    })
    return response.ok ? 'reachable' : 'unreachable'
  } catch {
    return 'unreachable'
  }
}

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
  const configuredTarget = String(runtimeEnv.WA_ORCHESTRATOR_API_TARGET || '').trim()
  const requestOrigin = url.origin
  const basicAuthRaw = String(runtimeEnv.WA_ORCHESTRATOR_BASIC_AUTH || runtimeEnv.CRM_BASIC_AUTH || '').trim()
  const hasBasicAuth = Boolean(basicAuthRaw && basicAuthRaw.includes(':'))
  const isLocalDev = isLocalDevAuthBypassEnabled(context)

  if (rest === '/_proxy-status' || rest === '/_proxy-status/') {
    if (!configuredTarget) {
      return json(503, {
        ok: false,
        mode: 'stub',
        localStub: isLocalDev,
        target: null,
        targetSource: null,
        requestOrigin,
        hasBasicAuth,
        reachability: 'not_configured',
        reason: 'WA_ORCHESTRATOR_API_TARGET_REQUIRED',
      })
    }

    let targetOrigin: string
    try {
      targetOrigin = new URL(configuredTarget).toString()
    } catch {
      return json(503, {
        ok: false,
        mode: 'stub',
        localStub: isLocalDev,
        target: null,
        targetSource: 'WA_ORCHESTRATOR_API_TARGET',
        requestOrigin,
        hasBasicAuth,
        reachability: 'not_configured',
        reason: 'WA_ORCHESTRATOR_API_TARGET_INVALID',
      })
    }

    const probeHeaders = new Headers({ accept: 'application/json' })
    if (hasBasicAuth) {
      const runtime = globalThis as { Buffer?: { from: (input: string) => { toString: (encoding: string) => string } } }
      const encoded = typeof btoa === 'function'
        ? btoa(basicAuthRaw)
        : runtime.Buffer?.from(basicAuthRaw).toString('base64')
      probeHeaders.set('authorization', `Basic ${encoded}`)
    }
    const reachability = await probeTarget(targetOrigin, probeHeaders)
    return json(reachability === 'reachable' ? 200 : 503, {
      ok: reachability === 'reachable',
      mode: 'real',
      localStub: false,
      target: sanitizeUrl(targetOrigin),
      targetSource: 'WA_ORCHESTRATOR_API_TARGET',
      requestOrigin,
      hasBasicAuth,
      reachability,
      reason: reachability === 'reachable' ? null : 'WA_ORCHESTRATOR_TARGET_UNREACHABLE',
    })
  }
  if (!configuredTarget) {
    if (rest === '/events') return missingOrchestratorEvents(isLocalDev)
    return missingOrchestratorConfiguration(isLocalDev)
  }
  let targetOrigin: string
  try {
    targetOrigin = new URL(configuredTarget).toString()
  } catch {
    return json(503, {
      success: false,
      error: 'WA_ORCHESTRATOR_API_TARGET_INVALID',
      hint: 'WA_ORCHESTRATOR_API_TARGET deve conter uma URL válida no overlay privado local.',
      localStub: isLocalDev,
      mode: 'stub',
    })
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
    const message = 'Resposta inválida do orquestrador. Verifique WA_ORCHESTRATOR_API_TARGET.'
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
