export async function onRequest(context: any): Promise<Response> {
  const request: Request = context.request
  const url = new URL(request.url)

  // Incoming:  /api/unit-monitor/<rest>
  // Outgoing:  <UNIT_MONITOR_API_TARGET>/api/unit-monitor/<rest>
  const prefix = '/api/unit-monitor'
  const rest = url.pathname.startsWith(prefix) ? url.pathname.slice(prefix.length) || '/' : url.pathname

  if (rest === '/_proxy-status' || rest === '/_proxy-status/') {
    const targetOrigin = (context.env?.UNIT_MONITOR_API_TARGET as string | undefined) || ''
    const proxyToken = (context.env?.UNIT_MONITOR_PROXY_TOKEN as string | undefined) || ''
    return new Response(
      JSON.stringify({
        ok: true,
        targetConfigured: !!targetOrigin,
        proxyTokenConfigured: !!proxyToken,
        hint:
          !targetOrigin
            ? 'Configure UNIT_MONITOR_API_TARGET no Cloudflare Pages para apontar para o gateway (URL pública do tunnel).'
            : undefined,
      }),
      { status: 200, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' } },
    )
  }

  const targetOrigin = (context.env?.UNIT_MONITOR_API_TARGET as string | undefined) || ''
  if (!targetOrigin) {
    return new Response(
      JSON.stringify({
        ok: false,
        error: 'UNIT_MONITOR_API_TARGET não configurado',
        hint: 'Defina UNIT_MONITOR_API_TARGET (ex: https://crm-api.seudominio.com) no Cloudflare Pages/Functions. O serviço precisa estar acessível publicamente e rodar na mesma rede da câmera (para alcançar IPs 192.168.x.x).'
      }),
      { status: 503, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' } }
    )
  }
  const targetUrl = new URL(targetOrigin)
  const basePath = targetUrl.pathname.replace(/\/$/, '')
  targetUrl.pathname = `${basePath}/api/unit-monitor${rest.startsWith('/') ? '' : '/'}${rest}`
  targetUrl.search = url.search

  const headers = new Headers(request.headers)
  headers.delete('host')

  const proxyToken = (context.env?.UNIT_MONITOR_PROXY_TOKEN as string | undefined) || ''
  if (proxyToken) headers.set('x-unit-monitor-proxy-token', proxyToken)

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
