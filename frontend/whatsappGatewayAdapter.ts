// Adaptive WhatsApp gateway adapter: tenta diferentes convenções de endpoints
// para compatibilizar com múltiplos scripts/bots (ex.: bot_com_api.js, agent_zero_whatsapp, etc.)
// Este arquivo usa heurísticas e deve ser refinado com base no contrato real do gateway.

export interface UnifiedSession {
    state: 'QR' | 'CONNECTED' | 'STARTING' | 'ERROR' | 'UNKNOWN'
    qr?: string
    message?: string
    raw?: any
    ready?: boolean
    qrRequired?: boolean
}

interface EndpointCandidate {
    kind: 'status' | 'start' | 'messages' | 'send' | 'chats' | 'qr' | 'events'
    method: 'GET' | 'POST'
    path: string
    body?: any
}

const CANDIDATES: Record<string, EndpointCandidate[]> = {
    status: [
        { kind: 'status', method: 'GET', path: '/status' }, // produção
        { kind: 'status', method: 'GET', path: '/sessions' },
        { kind: 'status', method: 'GET', path: '/session' },
        { kind: 'status', method: 'GET', path: '/health' }
    ],
    start: [
        { kind: 'start', method: 'GET', path: '/init' },
        { kind: 'start', method: 'POST', path: '/start' },
        { kind: 'start', method: 'POST', path: '/sessions' },
        { kind: 'start', method: 'POST', path: '/session/start' }
    ],
    send: [
        { kind: 'send', method: 'POST', path: '/send' },
        { kind: 'send', method: 'POST', path: '/v1/messages' },
        { kind: 'send', method: 'POST', path: '/messages' }
    ],
    messages: [
        { kind: 'messages', method: 'GET', path: '/v1/messages' },
        { kind: 'messages', method: 'GET', path: '/messages' }
    ],
    chats: [
        { kind: 'chats', method: 'GET', path: '/chats' },
        { kind: 'chats', method: 'GET', path: '/v1/conversations' }
    ],
    qr: [
        { kind: 'qr', method: 'GET', path: '/qr' },
        { kind: 'qr', method: 'GET', path: '/qrcode' }
    ],
    events: [
        { kind: 'events', method: 'GET', path: '/v1/events' },
        { kind: 'events', method: 'GET', path: '/events' },
        { kind: 'events', method: 'GET', path: '/stream' }
    ]
}

function normalize(base: string) { return base.replace(/\/$/, '') }

async function tryFetch(base: string, candidate: EndpointCandidate): Promise<any | null> {
    const url = normalize(base) + candidate.path
    try {
        const res = await fetch(url, {
            method: candidate.method,
            headers: candidate.method === 'POST' ? { 'Content-Type': 'application/json' } : undefined,
            body: candidate.method === 'POST' && candidate.body ? JSON.stringify(candidate.body) : undefined
        })
        if (!res.ok) return null
        const contentType = res.headers.get('content-type') || ''
        if (contentType.includes('application/json')) {
            return await res.json()
        }
        return await res.text()
    } catch {
        return null
    }
}

export async function startSessionAuto(base: string): Promise<UnifiedSession> {
    // Muitos gateways já estão prontos sem start explícito; primeiro cheque status.
    const status = await getSessionAuto(base)
    if (status.state === 'CONNECTED' || status.state === 'QR') return status
    // If already starting/connecting or indicates QR required, just return status (no need for /start)
    if (status.state === 'STARTING' || status.qrRequired) return status
    for (const cand of CANDIDATES.start) {
        const data = await tryFetch(base, cand)
        if (data) {
            const ses = extractSession(data)
            if ((ses.state === 'QR' || ses.qrRequired) && !ses.qr) {
                for (const q of CANDIDATES.qr) {
                    const qdata = await tryFetch(base, q)
                    if (qdata && typeof qdata === 'object' && (qdata.qr || qdata.qrcode || qdata.qrCode)) {
                        ses.qr = (qdata.qr || qdata.qrcode || qdata.qrCode)
                        break
                    }
                }
            }
            return ses
        }
    }
    // No explicit /start found; return current status instead of error
    return await getSessionAuto(base)
}

export async function getSessionAuto(base: string): Promise<UnifiedSession> {
    for (const cand of CANDIDATES.status) {
        const data = await tryFetch(base, cand)
        if (data) {
            const ses = extractSession(data)
            // If we know QR is required but we didn't get the QR value, try to fetch from QR endpoints
            if ((ses.state === 'QR' || ses.qrRequired) && !ses.qr) {
                for (const q of CANDIDATES.qr) {
                    const qdata = await tryFetch(base, q)
                    if (qdata && typeof qdata === 'object' && (qdata.qr || qdata.qrcode || qdata.qrCode)) {
                        ses.qr = (qdata.qr || qdata.qrcode || qdata.qrCode)
                        break
                    }
                }
            }
            return ses
        }
    }
    return { state: 'ERROR', message: 'Nenhum endpoint de status respondeu' }
}

export async function detectEndpoints(base: string) {
    const found: Partial<Record<EndpointCandidate['kind'], string>> = {}
    for (const category of ['status', 'send', 'messages', 'chats', 'qr', 'events'] as const) {
        for (const cand of CANDIDATES[category] || []) {
            const data = await tryFetch(base, cand)
            if (data) { found[category] = cand.path; break }
        }
    }
    return found
}

export async function sendAuto(base: string, payload: any) {
    for (const cand of CANDIDATES.send) {
        const url = normalize(base) + cand.path
        try {
            const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) })
            if (res.ok) return await res.json()
        } catch { /* ignore */ }
    }
    throw new Error('Nenhum endpoint de envio funcionou')
}

export async function fetchMessagesAuto(base: string, since?: string) {
    for (const cand of CANDIDATES.messages) {
        try {
            const full = normalize(base) + cand.path
            let url: URL
            if (typeof window !== 'undefined' && full.startsWith('http')) {
                url = new URL(full)
            } else if (typeof window !== 'undefined') {
                url = new URL(full, window.location.origin)
            } else {
                // ambiente sem window (SSR/build) não busca
                return []
            }
            if (since) url.searchParams.set('since', since)
            const res = await fetch(url.toString())
            if (!res.ok) continue
            const data = await res.json()
            if (Array.isArray(data)) return data
            if (Array.isArray((data as any).messages)) return (data as any).messages
        } catch { /* ignore */ }
    }
    return []
}

export async function fetchChatsAuto(base: string) {
    for (const cand of CANDIDATES.chats) {
        try {
            const res = await fetch(normalize(base) + cand.path)
            if (!res.ok) continue
            const data = await res.json()
            if (Array.isArray(data)) return data
            if (Array.isArray((data as any).chats)) return (data as any).chats
        } catch { /* ignore */ }
    }
    return []
}

export function openEventsStreamAuto(base: string, onEvent: (payload: any) => void): EventSource | null {
    const paths = (['/v1/events', '/events', '/stream'] as const)
    for (const p of paths) {
        try {
            const es = new EventSource(normalize(base) + p)
            es.onmessage = (ev) => {
                try { onEvent(JSON.parse(ev.data)) } catch { /* ignore parse */ }
            }
            es.onerror = () => {
                es.close()
            }
            return es
        } catch { /* try next */ }
    }
    return null
}

// Try to fetch avatar/profile picture for a contact/chat using common endpoint patterns
export async function fetchAvatarAuto(base: string, contactIdOrPhone: string): Promise<string | null> {
    const norm = normalize(base)
    const id = encodeURIComponent(contactIdOrPhone)
    const candidates = [
        `${norm}/v1/contacts/${id}/avatar`,
        `${norm}/contacts/${id}/avatar`,
        `${norm}/avatar?chatId=${id}`,
        `${norm}/avatar?phone=${encodeURIComponent(contactIdOrPhone)}`
    ]
    for (const url of candidates) {
        try {
            const res = await fetch(url)
            if (!res.ok) continue
            const ct = res.headers.get('content-type') || ''
            if (ct.startsWith('image/')) {
                // Return as object URL
                const blob = await res.blob()
                return URL.createObjectURL(blob)
            }
            const data = await res.json().catch(() => null)
            if (data && typeof data === 'object') {
                const u = (data.url || data.avatar || data.profilePicUrl)
                if (typeof u === 'string') return u
                if (data.base64 && typeof data.base64 === 'string') return data.base64
            }
        } catch { /* try next */ }
    }
    return null
}

// Fetch recent media for a chat: images/videos/documents limited by count
export async function fetchRecentMediaAuto(base: string, contactIdOrPhone: string, limit: number = 10): Promise<any[]> {
    const norm = normalize(base)
    const id = encodeURIComponent(contactIdOrPhone)
    const candidates = [
        `${norm}/v1/chats/${id}/media?limit=${limit}`,
        `${norm}/v1/media?chatId=${id}&limit=${limit}`,
        `${norm}/media?chatId=${id}&limit=${limit}`,
        `${norm}/chats/${id}/media?limit=${limit}`,
        `${norm}/chats/${id}/messages?media=true&limit=${limit}`,
        `${norm}/v1/messages/search?chatId=${id}&hasMedia=1&limit=${limit}`,
        `${norm}/messages?chatId=${id}&limit=${limit}`
    ]
    for (const url of candidates) {
        try {
            const res = await fetch(url)
            if (!res.ok) continue
            const data = await res.json()
            const list = Array.isArray(data) ? data : (Array.isArray((data as any).media) ? (data as any).media : (Array.isArray((data as any).messages) ? (data as any).messages : null))
            if (!Array.isArray(list)) continue
            // Normalize common fields if possible
            return list.map((m: any) => ({
                id: m.id || m.key || m.messageId || null,
                type: m.type || m.mediaType || m.mimetype || m.mimeType || null,
                timestamp: m.timestamp || m.t || m.time || null,
                url: m.url || m.mediaUrl || m.directPath || m.link || null,
                thumbnail: m.thumb || m.thumbnail || m.thumbnailUrl || null,
                caption: m.caption || m.text || m.name || null,
                mime: m.mimetype || m.mimeType || null,
                raw: m
            }))
        } catch { /* try next */ }
    }
    return []
}

// Batch hydrate chat flags (pinned/archived/unread). Returns sets of chat ids.
export async function fetchChatFlagsAuto(base: string): Promise<{ pinned: Set<string>, archived: Set<string>, unread: Set<string> }> {
    const norm = normalize(base)
    const pinned = new Set<string>()
    const archived = new Set<string>()
    const unread = new Set<string>()
    const candidates = [
        `${norm}/v1/chats/flags`,
        `${norm}/chats/flags`
    ]
    for (const url of candidates) {
        try {
            const res = await fetch(url)
            if (!res.ok) continue
            const data = await res.json()
            const p = (data?.pinned || data?.pins || []) as any[]
            const a = (data?.archived || []) as any[]
            const u = (data?.unread || []) as any[]
            p.forEach(id => pinned.add(String(id)))
            a.forEach(id => archived.add(String(id)))
            u.forEach(id => unread.add(String(id)))
            return { pinned, archived, unread }
        } catch { /* try next */ }
    }
    // Fallback: infer from chats payload
    try {
        const chats = await (fetchChatsAuto as any)(base)
        if (Array.isArray(chats)) {
            chats.forEach((c: any) => {
                const id = String(c.id || c.chatId || c.jid || c.remoteJid || c.number || '')
                if (!id) return
                if (c.pinned || c.isPinned || c.starred) pinned.add(id)
                if (c.archived || c.isArchived) archived.add(id)
                if ((c.unreadCount || c.unread || c.hasUnread) && Number(c.unreadCount || (c.hasUnread ? 1 : 0)) > 0) unread.add(id)
            })
        }
    } catch { /* ignore */ }
    return { pinned, archived, unread }
}

// Fetch unread counts per chat if the gateway exposes it; returns a map chatId -> count
export async function fetchUnreadCountsAuto(base: string): Promise<Record<string, number>> {
    const norm = normalize(base)
    const urls = [
        `${norm}/v1/chats/unread-counts`,
        `${norm}/chats/unread-counts`
    ]
    for (const url of urls) {
        try {
            const res = await fetch(url)
            if (!res.ok) continue
            const data = await res.json()
            if (data && typeof data.counts === 'object') return data.counts as Record<string, number>
        } catch { /* try next */ }
    }
    return {}
}

// Unified global search helper; returns contacts/messages/media arrays
export async function globalSearchAuto(base: string, params: { q?: string, phone?: string, tag?: string, has?: string, type?: string, before?: string, after?: string, limit?: number, offset?: number, sort?: string }) {
    const norm = normalize(base)
    const u = new URL(`${norm}/v1/search`, typeof window !== 'undefined' ? window.location.origin : 'http://localhost')
    Object.entries(params || {}).forEach(([k, v]) => { if (v != null && v !== '') u.searchParams.set(k, String(v)) })
    const url = typeof window !== 'undefined' ? u.toString().replace(window.location.origin, '') : u.toString()
    try {
        const res = await fetch(url)
        if (!res.ok) return { contacts: [], messages: [], media: [] }
        const data = await res.json()
        return { contacts: data.contacts || [], messages: data.messages || [], media: data.media || [], meta: { total: data.total || {}, query: data.query || {} } }
    } catch { return { contacts: [], messages: [], media: [] } }
}

function extractSession(raw: any): UnifiedSession {
    if (!raw) return { state: 'UNKNOWN' }
    if (Array.isArray(raw)) {
        const first = raw[0]
        if (!first) return { state: 'UNKNOWN', raw }
        return {
            state: mapState(first.state || first.status),
            qr: first.qr || first.qrcode || first.qrCode,
            raw: raw,
            ready: first.ready,
            qrRequired: first.qrRequired
        }
    }
    const stateVal = raw.state || raw.status || (raw.connected ? 'CONNECTED' : (raw.ready ? 'READY' : undefined))
    const qrVal = raw.qr || raw.qrcode || raw.qrCode
    return {
        state: mapState(qrVal && (raw.qrRequired || String(stateVal).toUpperCase().includes('QR')) ? 'QR' : stateVal),
        qr: qrVal,
        message: raw.message || raw.error,
        raw,
        ready: raw.ready,
        qrRequired: raw.qrRequired
    }
}

function mapState(val: any): UnifiedSession['state'] {
    if (!val) return 'UNKNOWN'
    const v = String(val).toUpperCase()
    // Be strict: CONNECTED or READY only; do NOT treat CONNECTING as connected
    if (v === 'CONNECTED' || v === 'READY') return 'CONNECTED'
    if (v === 'CONNECTING') return 'STARTING'
    if (v.includes('QR')) return 'QR'
    if (v.startsWith('START') || v.startsWith('INIT')) return 'STARTING'
    if (v.includes('ERR') || v.includes('FAIL')) return 'ERROR'
    return 'UNKNOWN'
}
