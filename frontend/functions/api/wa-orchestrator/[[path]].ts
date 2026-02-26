export async function onRequest(context: any): Promise<Response> {
  const request: Request = context.request
  const url = new URL(request.url)

  // Incoming:  /api/wa-orchestrator/<rest>
  // Outgoing:  <TARGET>/api/wa-orchestrator/<rest>
  const prefix = '/api/wa-orchestrator'
  const rest = url.pathname.startsWith(prefix) ? url.pathname.slice(prefix.length) || '/' : url.pathname

  const rawTargets = [
    context.env?.WA_ORCHESTRATOR_API_TARGET as string | undefined,
    context.env?.CRM_API_TARGET as string | undefined,
    context.env?.INSUMOS_API_TARGET as string | undefined
  ].map((v) => String(v || '').trim()).filter(Boolean)
  const requestOrigin = url.origin

  const pickTarget = () => {
    for (const candidate of rawTargets) {
      try {
        const parsed = new URL(candidate)
        if (parsed.origin === requestOrigin) continue
        return candidate
      } catch {
        // ignore invalid
      }
    }
    return 'https://api.skincos.com.br'
  }

  const targetOrigin = String(pickTarget())
  const isProductionTarget = (() => {
    const raw = String(targetOrigin || '').trim().toLowerCase()
    return raw === 'https://api.skincos.com.br' || raw.endsWith('.skincos.com.br')
  })()

  if (rest === '/_proxy-status' || rest === '/_proxy-status/') {
    return new Response(
      JSON.stringify({
        ok: true,
        target: targetOrigin,
        isProductionTarget,
        requestOrigin,
        targets: rawTargets,
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

  const headers = new Headers(request.headers)
  if (rest.startsWith('/events')) {
    headers.set('accept', 'text/event-stream')
  } else {
    headers.set('accept', 'application/json')
  }
  headers.delete('host')
  headers.delete('content-length')
  headers.delete('content-encoding')
  headers.delete('transfer-encoding')
  headers.delete('connection')

  const method = (request.method || 'GET').toUpperCase()
  const body = method === 'GET' || method === 'HEAD' ? undefined : request.body

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
    const splitSetCookie = (headerValue: string): string[] => {
      const raw = String(headerValue || '').trim()
      if (!raw) return []

      const out: string[] = []
      let start = 0
      let inExpires = false

      for (let i = 0; i < raw.length; i++) {
        const ch = raw[i]
        if (!inExpires && (ch === 'e' || ch === 'E')) {
          const maybe = raw.slice(i, i + 8).toLowerCase()
          if (maybe === 'expires=') inExpires = true
        }
        if (inExpires && ch === ';') inExpires = false
        if (!inExpires && ch === ',') {
          const part = raw.slice(start, i).trim()
          if (part) out.push(part)
          start = i + 1
        }
      }

      const tail = raw.slice(start).trim()
      if (tail) out.push(tail)
      return out
    }

    const getSetCookieMethod = (upstream.headers as any).getSetCookie?.bind?.(upstream.headers)
    const rewriteCookie = (cookie: string) => {
      if (!cookie) return cookie
      const parts = cookie.split(';').map(part => part.trim()).filter(Boolean)
      if (!parts.length) return cookie
      const [nameValue, ...attrs] = parts
      const filtered = attrs.filter(attr => !attr.toLowerCase().startsWith('domain='))
      return [nameValue, ...filtered].join('; ')
    }
    const applyCookies = (cookies: string[]) => {
      if (!Array.isArray(cookies) || !cookies.length) return
      outHeaders.delete('set-cookie')
      for (const c of cookies) outHeaders.append('Set-Cookie', rewriteCookie(c))
    }

    if (typeof getSetCookieMethod === 'function') {
      const cookies = getSetCookieMethod() as string[]
      applyCookies(cookies)
    } else {
      const single = upstream.headers.get('set-cookie')
      if (single) applyCookies(splitSetCookie(single))
    }
  } catch {
    // ignore
  }

  return new Response(upstream.body, {
    status: upstream.status,
    statusText: upstream.statusText,
    headers: outHeaders
  })
}
