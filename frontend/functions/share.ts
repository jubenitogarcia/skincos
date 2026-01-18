type ShareFile = {
    name: string
    key: string
    size?: number
    contentType?: string
}

type SharePayload = {
    title?: string
    text?: string
    url?: string
    files?: ShareFile[]
}

const MAX_FILES = 6
const MAX_TOTAL_BYTES = 25 * 1024 * 1024
const MAX_FILE_BYTES = 10 * 1024 * 1024

const sanitizeName = (name: string) => {
    const cleaned = name.replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/-+/g, '-').replace(/^-+|-+$/g, '')
    return cleaned || 'arquivo'
}

const buildRedirect = (request: Request, payload: SharePayload, shareId?: string) => {
    const params = new URLSearchParams()
    params.set('module', 'insumos')
    params.set('insumosTab', 'insumos')
    params.set('action', 'cadastro')

    if (shareId) {
        params.set('shareId', shareId)
    } else {
        if (payload.title) params.set('shareTitle', payload.title)
        if (payload.text) params.set('shareText', payload.text)
        if (payload.url) params.set('shareUrl', payload.url)
        if (payload.files && payload.files.length) {
            params.set('shareFiles', payload.files.map((f) => f.name).join(', '))
        }
    }

    const origin = new URL(request.url).origin
    const target = `${origin}/?${params.toString()}`
    return Response.redirect(target, 303)
}

const getBucket = (context: any) => {
    return (context?.env?.SHARE_BUCKET as R2Bucket | undefined) || undefined
}

export async function onRequestPost(context: { request: Request; env?: Record<string, unknown> }): Promise<Response> {
    try {
        const form = await context.request.formData()
        const title = form.get('title')
        const text = form.get('text')
        const url = form.get('url')
        const files = form.getAll('media')
        const fileObjs = files.filter((f): f is File => typeof File !== 'undefined' && f instanceof File).slice(0, MAX_FILES)
        const fileNames = fileObjs.map((f) => f.name).filter(Boolean)

        const payload: SharePayload = {
            title: title ? String(title) : undefined,
            text: text ? String(text) : undefined,
            url: url ? String(url) : undefined
        }

        const bucket = getBucket(context)
        if (bucket && fileObjs.length) {
            let total = 0
            const shareId = crypto.randomUUID()
            const storedFiles: ShareFile[] = []
            for (let idx = 0; idx < fileObjs.length; idx += 1) {
                const file = fileObjs[idx]
                if (!file || !file.name) continue
                if (file.size > MAX_FILE_BYTES) continue
                total += file.size || 0
                if (total > MAX_TOTAL_BYTES) break
                const safeName = sanitizeName(file.name)
                const key = `shares/${shareId}/files/${idx + 1}-${safeName}`
                await bucket.put(key, file, {
                    httpMetadata: { contentType: file.type || 'application/octet-stream' }
                })
                storedFiles.push({ name: file.name, key, size: file.size, contentType: file.type || undefined })
            }
            payload.files = storedFiles.length ? storedFiles : undefined
            const metaKey = `shares/${shareId}/payload.json`
            await bucket.put(metaKey, JSON.stringify({ ...payload, createdAt: new Date().toISOString() }), {
                httpMetadata: { contentType: 'application/json' }
            })
            return buildRedirect(context.request, payload, shareId)
        }

        payload.files = fileNames.length ? fileNames.map((name) => ({ name, key: name })) : undefined
        return buildRedirect(context.request, payload)
    } catch {
        return buildRedirect(context.request, {})
    }
}

export async function onRequestGet(context: { request: Request }): Promise<Response> {
    const url = new URL(context.request.url)
    const shareId = url.searchParams.get('id') || undefined
    return buildRedirect(
        context.request,
        {
            title: url.searchParams.get('title') || undefined,
            text: url.searchParams.get('text') || undefined,
            url: url.searchParams.get('url') || undefined
        },
        shareId
    )
}
