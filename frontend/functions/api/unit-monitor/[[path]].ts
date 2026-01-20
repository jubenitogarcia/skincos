export async function onRequest(context: any): Promise<Response> {
  const request: Request = context.request
  const url = new URL(request.url)

  // Incoming:  /api/unit-monitor/<rest>
  // Outgoing:  https://api.skincos.com.br/unit-monitor/<rest>
  const prefix = '/api/unit-monitor'
  const rest = url.pathname.startsWith(prefix) ? url.pathname.slice(prefix.length) || '/' : url.pathname

  const targetOrigin = (context.env?.UNIT_MONITOR_API_TARGET as string | undefined) || 'https://api.skincos.com.br'
  const targetUrl = new URL(targetOrigin)
  targetUrl.pathname = `/unit-monitor${rest.startsWith('/') ? '' : '/'}${rest}`
  targetUrl.search = url.search

  const headers = new Headers(request.headers)
  headers.delete('host')

  const upstreamRequest = new Request(targetUrl.toString(), {
    method: request.method,
    headers,
    body: request.body,
    redirect: 'manual'
  })

  const upstream = await fetch(upstreamRequest)

  const outHeaders = new Headers(upstream.headers)
  outHeaders.set('Cache-Control', 'no-store')

  try {
    const getSetCookie = (upstream.headers as any).getSetCookie
    if (typeof getSetCookie === 'function') {
      const cookies = getSetCookie.call(upstream.headers) as string[]
      if (Array.isArray(cookies) && cookies.length) {
        outHeaders.delete('set-cookie')
        for (const c of cookies) outHeaders.append('Set-Cookie', c)
      }
    }
  } catch {}

  return new Response(upstream.body, {
    status: upstream.status,
    statusText: upstream.statusText,
    headers: outHeaders
  })
}

