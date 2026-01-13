export async function onRequest(context: any): Promise<Response> {
    const request: Request = context.request
    const url = new URL(request.url)

    // Incoming:  /api/insumos/<rest>
    // Outgoing:  https://api.skincos.com.br/insumos/<rest>
    const prefix = '/api/insumos'
    const rest = url.pathname.startsWith(prefix) ? url.pathname.slice(prefix.length) || '/' : url.pathname

    const targetOrigin = (context.env?.INSUMOS_API_TARGET as string | undefined) || 'https://api.skincos.com.br'
    const targetUrl = new URL(targetOrigin)
    targetUrl.pathname = `/insumos${rest.startsWith('/') ? '' : '/'}${rest}`
    targetUrl.search = url.search

    const headers = new Headers(request.headers)
    headers.delete('host')

    const upstreamRequest = new Request(targetUrl.toString(), {
        method: request.method,
        headers,
        body: request.body,
        redirect: 'manual'
    })

    return fetch(upstreamRequest)
}

