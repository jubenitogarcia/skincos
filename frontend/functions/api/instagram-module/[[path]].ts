export async function onRequest(context: any): Promise<Response> {
  const request: Request = context.request
  const url = new URL(request.url)

  const prefix = '/api/instagram-module'
  const rest = url.pathname.startsWith(prefix) ? url.pathname.slice(prefix.length) || '/' : url.pathname

  const targetOrigin = (context.env?.INSTAGRAM_MODULE_TARGET as string | undefined) || ''
  if (!targetOrigin) {
    return new Response(
      JSON.stringify({
        success: false,
        error: 'INSTAGRAM_MODULE_TARGET não configurado',
        hint: 'Defina INSTAGRAM_MODULE_TARGET (ex: https://ig-module.seudominio.com) no Cloudflare Pages/Functions.',
      }),
      { status: 503, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' } },
    )
  }

  const targetUrl = new URL(targetOrigin)
  targetUrl.pathname = `${rest.startsWith('/') ? '' : '/'}${rest}`
  targetUrl.search = url.search

  const headers = new Headers(request.headers)
  headers.delete('host')

  const upstreamRequest = new Request(targetUrl.toString(), {
    method: request.method,
    headers,
    body: request.body,
    redirect: 'manual',
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
    headers: outHeaders,
  })
}

