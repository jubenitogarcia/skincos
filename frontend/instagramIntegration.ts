// Stub de integração com Instagram Graph API
// Substitua as funções abaixo por chamadas reais usando fetch ao endpoint:
// https://graph.facebook.com/v20.0/{ig_business_account_id}/...
// Necessário: access_token com permissões instagram_basic, instagram_manage_messages, instagram_manage_insights

export interface InstagramUserProfile {
    id: string
    username: string
    name?: string
    profilePic?: string
}

export interface InstagramDMMessage {
    id: string
    from: string
    to: string
    text: string
    timestamp: string
    direction: 'in' | 'out'
}

type ApiError = { ok?: boolean; error?: string; message?: string; hint?: string }

async function apiGet<T>(path: string): Promise<T> {
    const res = await fetch(path, { headers: { accept: 'application/json' }, credentials: 'include' as any })
    const text = await res.text()
    let json: any = null
    try { json = text ? JSON.parse(text) : null } catch { json = null }
    if (!res.ok) throw new Error((json as ApiError)?.message || (json as ApiError)?.error || `HTTP ${res.status}`)
    return json as T
}

async function apiPost<T>(path: string, body: any): Promise<T> {
    const res = await fetch(path, {
        method: 'POST',
        headers: { 'content-type': 'application/json', accept: 'application/json' },
        credentials: 'include' as any,
        body: JSON.stringify(body),
    })
    const text = await res.text()
    let json: any = null
    try { json = text ? JSON.parse(text) : null } catch { json = null }
    if (!res.ok) throw new Error((json as ApiError)?.message || (json as ApiError)?.error || `HTTP ${res.status}`)
    return json as T
}

// ---------------- REAL API HELPERS ----------------
const GRAPH_BASE = 'https://graph.facebook.com/v20.0'

interface GraphError { error: { message: string, type: string, code: number } }

async function graphGet<T>(path: string, params: Record<string, any>, token: string): Promise<T> {
    const qs = new URLSearchParams({ ...Object.fromEntries(Object.entries(params).filter(([_, v]) => v !== undefined && v !== null)), access_token: token })
    const url = `${GRAPH_BASE}/${path}?${qs.toString()}`
    const res = await fetch(url)
    const json = await res.json()
    if (!res.ok) throw new Error((json as GraphError).error?.message || 'Erro API Graph')
    return json as T
}

async function graphPost<T>(path: string, body: Record<string, any>, token: string): Promise<T> {
    const form = new URLSearchParams({ ...Object.fromEntries(Object.entries(body).filter(([_, v]) => v !== undefined && v !== null)), access_token: token })
    const res = await fetch(`${GRAPH_BASE}/${path}`, { method: 'POST', body: form })
    const json = await res.json()
    if (!res.ok) throw new Error((json as GraphError).error?.message || 'Erro API Graph')
    return json as T
}

// ---------------- HIGH LEVEL FUNCTIONS ----------------

export async function fetchRecentCommentLeads(igBusinessAccountId?: string, token?: string): Promise<InstagramUserProfile[]> {
    if (!igBusinessAccountId || !token) {
        // fallback mock
        return [
            { id: 'ig_u_101', username: 'lead_potencial', name: 'Lead Potencial' },
            { id: 'ig_u_102', username: 'clinica_estetica', name: 'Clínica Estética' }
        ]
    }
    // Example: fetch recent media then comments
    try {
        const media: any = await graphGet(`${igBusinessAccountId}/media`, { fields: 'id,caption,comments.limit(10){id,text,username,user{id,username,profile_picture_url}}', limit: 5 }, token)
        const profilesMap: Record<string, InstagramUserProfile> = {}
        for (const item of media.data || []) {
            const comments = item.comments?.data || []
            for (const c of comments) {
                if (c.user) {
                    profilesMap[c.user.id] = {
                        id: c.user.id,
                        username: c.user.username,
                        name: c.user.username,
                        profilePic: c.user.profile_picture_url
                    }
                }
            }
        }
        return Object.values(profilesMap)
    } catch (e) {
        console.warn('Erro fetchRecentCommentLeads Graph, usando mock', e)
        return [
            { id: 'ig_u_101', username: 'lead_potencial', name: 'Lead Potencial' }
        ]
    }
}

export async function fetchRecentDMConversations(igBusinessAccountId?: string, token?: string): Promise<Record<string, InstagramDMMessage[]>> {
    if (!igBusinessAccountId || !token) {
        return {
            ig_u_101: [
                { id: 'm1', from: 'ig_u_101', to: 'me', text: 'Olá, queria saber valores de harmonização.', timestamp: new Date().toISOString(), direction: 'in' }
            ]
        }
    }
    // NOTE: Instagram Messaging API requires setting up webhooks; direct fetch of conversation history is limited.
    // Placeholder: return empty set to avoid misleading data.
    return {}
}

export async function sendDirectMessage(userId: string, text: string, fromBizUserId?: string, token?: string): Promise<InstagramDMMessage> {
    if (token && fromBizUserId) {
        try {
            await graphPost(`${fromBizUserId}/messages`, { recipient: userId, message: text }, token)
        } catch (e) {
            console.warn('Erro ao enviar DM (Graph). Fallback local.', e)
        }
    }
    return {
        id: 'local_' + Date.now(),
        from: fromBizUserId || 'me',
        to: userId,
        text,
        timestamp: new Date().toISOString(),
        direction: 'out'
    }
}

export async function fetchInstagramAccountMetrics(igBusinessAccountId?: string, token?: string) {
    if (!igBusinessAccountId || !token) {
        const data = await apiGet<{ ok: boolean; connected: boolean; metrics: any }>(`/api/instagram/metrics`)
        return data.metrics
    }
    const fields = 'followers_count,media_count'
    return graphGet(`${igBusinessAccountId}`, { fields }, token)
}

export function mapInstagramProfileToLead(user: InstagramUserProfile) {
    const nameParts = (user.name || user.username).split(' ')
    const firstName = nameParts[0]
    const lastName = nameParts.slice(1).join(' ') || 'Instagram'
    return {
        title: 'Mr',
        firstName,
        lastName,
        company: 'Instagram',
        jobTitle: '',
        email: `${user.username}@instagram.local`,
        phone: '',
        website: `https://instagram.com/${user.username}`,
        address: { street: '', city: '', state: '', zipCode: '', country: 'Brasil' },
        leadSource: 'social-media',
        leadStatus: 'new',
        priority: 'medium',
        estimatedValue: 0,
        probability: 10,
        expectedCloseDate: '',
        assignedTo: 'user-1',
        tags: ['instagram'],
        notes: 'Gerado via integração Instagram',
        customFields: {},
        activities: [],
        score: 0
    }
}

// Exchange short-lived token for long-lived using local proxy (via CRM API)
export async function exchangeForLongLivedToken(shortLivedToken: string, appId: string, appSecret: string, proxyBase = 'http://localhost:7070') {
    const res = await fetch(`${proxyBase}/api/token/extend`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ shortLivedToken, appId, appSecret })
    })
    if (!res.ok) throw new Error('Falha ao trocar token')
    return res.json()
}

// ---------------- CONTENT (MEDIA/STORIES/COMMENTS) ----------------

export interface InstagramGraphMedia {
    id: string
    caption?: string
    media_type: 'IMAGE' | 'VIDEO' | 'CAROUSEL_ALBUM' | 'REELS' | string
    media_url?: string
    thumbnail_url?: string
    permalink?: string
    timestamp?: string
    like_count?: number
    comments_count?: number
    children?: { data: Array<{ id: string; media_type?: string; media_url?: string; thumbnail_url?: string }> }
}

export interface InstagramGraphComment {
    id: string
    text?: string
    timestamp?: string
    username?: string
    like_count?: number
    from?: { id: string; username?: string }
    replies?: { data: InstagramGraphComment[] }
}

export async function fetchInstagramMedia(igBusinessAccountId?: string, token?: string, limit = 25): Promise<InstagramGraphMedia[]> {
    if (!igBusinessAccountId || !token) {
        const data = await apiGet<{ ok: boolean; data: InstagramGraphMedia[] }>(`/api/instagram/media?limit=${encodeURIComponent(String(limit))}`)
        return data.data || []
    }
    const fields = [
        'id',
        'caption',
        'media_type',
        'media_url',
        'thumbnail_url',
        'permalink',
        'timestamp',
        'like_count',
        'comments_count',
        'children{media_type,media_url,thumbnail_url}',
    ].join(',')
    const data = await graphGet<{ data: InstagramGraphMedia[] }>(`${igBusinessAccountId}/media`, { fields, limit }, token)
    return data.data || []
}

export async function fetchInstagramStories(igBusinessAccountId?: string, token?: string, limit = 25): Promise<InstagramGraphMedia[]> {
    if (!igBusinessAccountId || !token) {
        const data = await apiGet<{ ok: boolean; data: InstagramGraphMedia[] }>(`/api/instagram/stories?limit=${encodeURIComponent(String(limit))}`)
        return data.data || []
    }
    const fields = [
        'id',
        'media_type',
        'media_url',
        'thumbnail_url',
        'permalink',
        'timestamp',
        'caption',
    ].join(',')
    const data = await graphGet<{ data: InstagramGraphMedia[] }>(`${igBusinessAccountId}/stories`, { fields, limit }, token)
    return data.data || []
}

export async function fetchInstagramMediaComments(mediaId: string, token?: string, limit = 50): Promise<InstagramGraphComment[]> {
    if (!token) {
        const data = await apiGet<{ ok: boolean; data: InstagramGraphComment[] }>(
            `/api/instagram/comments?mediaId=${encodeURIComponent(mediaId)}&limit=${encodeURIComponent(String(limit))}`
        )
        return data.data || []
    }
    const fields = [
        'id',
        'text',
        'timestamp',
        'username',
        'like_count',
        'from{id,username}',
        'replies.limit(20){id,text,timestamp,username,like_count,from{id,username}}',
    ].join(',')
    const data = await graphGet<{ data: InstagramGraphComment[] }>(`${mediaId}/comments`, { fields, limit }, token)
    return data.data || []
}

export async function replyToInstagramComment(commentId: string, message: string, token?: string): Promise<{ id: string }> {
    if (!token) {
        const out = await apiPost<{ ok: boolean; id: string }>(`/api/instagram/comment-reply`, { commentId, message })
        return { id: out.id }
    }
    return graphPost<{ id: string }>(`${commentId}/replies`, { message }, token)
}

// ---------------- PUBLISHING ----------------
export async function publishInstagramContent(input: { type: 'image' | 'carousel' | 'story'; urls: string[]; caption?: string; igBusinessAccountId?: string; token?: string }) {
    const urls = Array.isArray(input.urls) ? input.urls.map((u) => String(u || '').trim()).filter(Boolean) : []
    if (!urls.length) throw new Error('Nenhuma URL informada para publicação.')

    const caption = input.caption ? String(input.caption) : undefined

    const igBusinessAccountId = String(input.igBusinessAccountId || '').trim()
    const token = String(input.token || '').trim()
    if (!igBusinessAccountId || !token) {
        return apiPost<{ ok: boolean; creationId: string; publishedId: string; children?: string[] }>(`/api/instagram/publish`, {
            type: input.type,
            urls,
            caption,
        })
    }

    if (input.type === 'story') {
        const c = await createInstagramMediaContainer(igBusinessAccountId, token, {
            image_url: urls[0],
            caption,
            media_type: 'STORIES',
        })
        const pub = await publishInstagramMediaContainer(igBusinessAccountId, token, c.id)
        return { ok: true, creationId: c.id, publishedId: pub.id }
    }

    if (input.type === 'carousel' && urls.length > 1) {
        const children: string[] = []
        for (const u of urls.slice(0, 10)) {
            const child = await createInstagramMediaContainer(igBusinessAccountId, token, { image_url: u, is_carousel_item: true })
            children.push(child.id)
        }
        const carousel = await createInstagramCarouselContainer(igBusinessAccountId, token, { children, caption })
        const pub = await publishInstagramMediaContainer(igBusinessAccountId, token, carousel.id)
        return { ok: true, creationId: carousel.id, publishedId: pub.id, children }
    }

    // Default: single image post
    const c = await createInstagramMediaContainer(igBusinessAccountId, token, { image_url: urls[0], caption })
    const pub = await publishInstagramMediaContainer(igBusinessAccountId, token, c.id)
    return { ok: true, creationId: c.id, publishedId: pub.id }
}

export async function createInstagramMediaContainer(
    igBusinessAccountId: string,
    token: string,
    input: {
        image_url?: string
        video_url?: string
        caption?: string
        media_type?: 'STORIES' | string
        is_carousel_item?: boolean
    }
): Promise<{ id: string }> {
    return graphPost<{ id: string }>(`${igBusinessAccountId}/media`, input, token)
}

export async function createInstagramCarouselContainer(
    igBusinessAccountId: string,
    token: string,
    input: {
        children: string[]
        caption?: string
    }
): Promise<{ id: string }> {
    return graphPost<{ id: string }>(
        `${igBusinessAccountId}/media`,
        {
            media_type: 'CAROUSEL',
            children: input.children.join(','),
            caption: input.caption,
        },
        token
    )
}

export async function publishInstagramMediaContainer(igBusinessAccountId: string, token: string, creationId: string): Promise<{ id: string }> {
    return graphPost<{ id: string }>(`${igBusinessAccountId}/media_publish`, { creation_id: creationId }, token)
}
