type SharePayload = {
    title?: string
    text?: string
    url?: string
    files?: string[]
}

const buildRedirect = (request: Request, payload: SharePayload) => {
    const params = new URLSearchParams()
    params.set('module', 'insumos')
    params.set('insumosTab', 'insumos')
    params.set('action', 'cadastro')

    if (payload.title) params.set('shareTitle', payload.title)
    if (payload.text) params.set('shareText', payload.text)
    if (payload.url) params.set('shareUrl', payload.url)
    if (payload.files && payload.files.length) params.set('shareFiles', payload.files.join(', '))

    const origin = new URL(request.url).origin
    const target = `${origin}/?${params.toString()}`
    return Response.redirect(target, 303)
}

export async function onRequestPost(context: { request: Request }): Promise<Response> {
    try {
        const form = await context.request.formData()
        const title = form.get('title')
        const text = form.get('text')
        const url = form.get('url')
        const files = form.getAll('media')
        const fileNames = files
            .filter((f): f is File => typeof File !== 'undefined' && f instanceof File)
            .map((f) => f.name)
            .filter(Boolean)
            .slice(0, 6)
        return buildRedirect(context.request, {
            title: title ? String(title) : undefined,
            text: text ? String(text) : undefined,
            url: url ? String(url) : undefined,
            files: fileNames.length ? fileNames : undefined
        })
    } catch {
        return buildRedirect(context.request, {})
    }
}

export async function onRequestGet(context: { request: Request }): Promise<Response> {
    const url = new URL(context.request.url)
    return buildRedirect(context.request, {
        title: url.searchParams.get('title') || undefined,
        text: url.searchParams.get('text') || undefined,
        url: url.searchParams.get('url') || undefined
    })
}
