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
    createdAt?: string
}

const getBucket = (context: any) => {
    return (context?.env?.SHARE_BUCKET as R2Bucket | undefined) || undefined
}

const readPayload = async (bucket: R2Bucket, shareId: string): Promise<SharePayload | null> => {
    const metaKey = `shares/${shareId}/payload.json`
    const obj = await bucket.get(metaKey)
    if (!obj) return null
    const text = await obj.text()
    return JSON.parse(text) as SharePayload
}

export async function onRequestGet(context: { request: Request; params: { id?: string } }): Promise<Response> {
    const shareId = context.params?.id
    if (!shareId) return new Response('Not found', { status: 404 })

    const bucket = getBucket(context)
    if (!bucket) return new Response('Share storage not configured', { status: 404 })

    const url = new URL(context.request.url)
    const fileName = url.searchParams.get('file')
    const payload = await readPayload(bucket, shareId)
    if (!payload) return new Response('Not found', { status: 404 })

    if (fileName) {
        const file = (payload.files || []).find((f) => f.name === fileName) || null
        if (!file) return new Response('File not found', { status: 404 })
        const obj = await bucket.get(file.key)
        if (!obj) return new Response('File not found', { status: 404 })
        const headers = new Headers()
        headers.set('Content-Type', file.contentType || obj.httpMetadata?.contentType || 'application/octet-stream')
        headers.set('Content-Disposition', `attachment; filename="${file.name}"`)
        headers.set('Cache-Control', 'no-store')
        return new Response(obj.body, { status: 200, headers })
    }

    const outHeaders = new Headers()
    outHeaders.set('Content-Type', 'application/json')
    outHeaders.set('Cache-Control', 'no-store')
    return new Response(JSON.stringify(payload), { status: 200, headers: outHeaders })
}
