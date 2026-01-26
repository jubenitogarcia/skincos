// WhatsApp Integration Service
// Este serviço abstrai chamadas ao gateway WhatsApp (pode ser a API local no diretório /WhatsApp ou um provider externo)
// Adapta-se à documentação anexada (não lida via ferramenta aqui) presumindo endpoints REST típicos:
// - GET /sessions (listar sessão / status)
// - POST /messages (enviar mensagem) { to, type, text }
// - GET /messages?since=timestamp (listar mensagens novas)
// - GET /contacts (opcional)
// Ajuste conforme a API real do seu gateway (ex.: agent_zero_whatsapp.js / bot_com_api.js)

export interface WhatsAppSessionStatus {
    id: string
    state: string
    qr?: string
    createdAt?: string
    updatedAt?: string
}

export interface WhatsAppInboundMessage {
    id: string
    from: string
    to: string
    timestamp: string
    type: string
    text?: string
    status?: string
    raw?: any
}

export interface WhatsAppOutboundMessageRequest {
    to: string
    text: string
    type?: 'text' | 'image' | 'video' | 'document'
    // Campos adicionais para API final (/send)
    number?: string // alias de to
    message?: string // alias de text
    mediaUrl?: string
    url?: string
    mediaType?: string
    caption?: string
    base64?: string // fallback quando não houver hosting público
}

export interface WhatsAppOutboundMessageResponse {
    id: string
    to: string
    timestamp: string
    status: string
}

function normalizeBase(base: string) {
    return base.replace(/\/$/, '')
}

export async function fetchSession(baseUrl: string): Promise<WhatsAppSessionStatus | null> {
    try {
        const res = await fetch(normalizeBase(baseUrl) + '/sessions')
        if (!res.ok) return null
        const data: any = await res.json()
        // Se a API retornar array, pegue a primeira
        if (Array.isArray(data)) return (data[0] || null) as any
        return (data || null) as any
    } catch {
        return null
    }
}

export async function sendWhatsAppMessage(baseUrl: string, payload: WhatsAppOutboundMessageRequest): Promise<WhatsAppOutboundMessageResponse> {
    // Tenta endpoints preferenciais em ordem
    const bodyBase: any = {
        type: payload.type || 'text',
        number: payload.number || payload.to,
        to: payload.to,
        message: payload.message || payload.text || payload.caption,
        text: payload.text,
        caption: payload.caption,
        url: payload.url || payload.mediaUrl,
        mediaUrl: payload.mediaUrl,
        mediaType: payload.mediaType,
        base64: payload.base64,
    }
    const candidates = ['/send', '/v1/messages', '/messages']
    let lastError: any = null
    for (const path of candidates) {
        try {
            const res = await fetch(normalizeBase(baseUrl) + path, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(bodyBase)
            })
            if (!res.ok) { lastError = await res.text(); continue }
            return await (res.json() as Promise<any>)
        } catch (e) { lastError = e }
    }
    throw new Error('Falha ao enviar mensagem WhatsApp: ' + (lastError || 'unknown'))
}

// Send a WhatsApp contact (vCard-like) using dedicated endpoint when available
export async function sendWhatsAppContact(baseUrl: string, to: string, contactPhone: string, contactName?: string) {
    const body = {
        number: to,
        to,
        contactPhone,
        contactName: contactName || contactPhone
    }
    const candidates = ['/send-contact', '/v1/send-contact']
    let lastError: any = null
    for (const path of candidates) {
        try {
            const res = await fetch(normalizeBase(baseUrl) + path, {
                method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body)
            })
            if (!res.ok) { lastError = await res.text(); continue }
            return await (res.json() as Promise<any>)
        } catch (e) { lastError = e }
    }
    // fallback: plain text message with details
    return sendWhatsAppMessage(baseUrl, { to, text: `Contato: ${contactName || contactPhone} - ${contactPhone}` })
}

// Send a poll (question + options)
export async function sendWhatsAppPoll(baseUrl: string, to: string, question: string, options: string[]) {
    const payloads = [
        { path: '/poll', body: { number: to, to, question, options } },
        { path: '/v1/messages', body: { type: 'poll', to, question, options } },
        { path: '/send', body: { type: 'poll', number: to, to, question, options } }
    ]
    let lastError: any = null
    for (const p of payloads) {
        try {
            const res = await fetch(normalizeBase(baseUrl) + p.path, {
                method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(p.body)
            })
            if (!res.ok) { lastError = await res.text(); continue }
            return await res.json()
        } catch (e) { lastError = e }
    }
    throw new Error('Falha ao enviar enquete: ' + (lastError || 'unknown'))
}

// Helper para detectar tipo de mídia com base no MIME
export function detectWhatsAppMediaType(mime: string): 'image' | 'video' | 'document' {
    if (mime.startsWith('image/')) return 'image'
    if (mime.startsWith('video/')) return 'video'
    return 'document'
}

export interface LocalAttachment {
    id: string
    name: string
    size: number
    mime: string
    dataUrl: string // base64 Data URL
    waType: 'image' | 'video' | 'document'
}

export async function sendWhatsAppAttachments(baseUrl: string, to: string, attachments: LocalAttachment[], caption?: string) {
    const results: WhatsAppOutboundMessageResponse[] = []
    for (let i = 0; i < attachments.length; i++) {
        const a = attachments[i]
        const isFirst = i === 0 && caption
        const res = await sendWhatsAppMessage(baseUrl, {
            to,
            text: isFirst ? caption || '' : '',
            type: a.waType,
            caption: isFirst ? caption : undefined,
            base64: a.dataUrl,
            mediaType: a.mime,
            message: isFirst ? caption : undefined,
        })
        results.push(res)
    }
    return results
}

export async function fetchNewMessages(baseUrl: string, since?: string): Promise<WhatsAppInboundMessage[]> {
    try {
        const url = new URL(normalizeBase(baseUrl) + '/messages')
        if (since) url.searchParams.set('since', since)
        const res = await fetch(url.toString())
        if (!res.ok) return []
        const data = await res.json()
        if (!Array.isArray(data)) return []
        return data.map(m => ({
            id: m.id || m.messageId || 'wa_' + Math.random(),
            from: m.from || m.remoteJid || '',
            to: m.to || m.participant || '',
            timestamp: m.timestamp ? new Date(m.timestamp).toISOString() : new Date().toISOString(),
            type: m.type || 'text',
            text: m.text || m.body || m.message || '',
            status: m.status || 'received',
            raw: m
        }))
    } catch {
        return []
    }
    const candidates = ['/v1/messages', '/messages']
    for (const path of candidates) {
        try {
            const url = new URL(normalizeBase(baseUrl) + path, window.location.origin)
            if (since) url.searchParams.set('since', since as string)
            const res = await fetch(url.toString().replace(window.location.origin, ''))
            if (!res.ok) continue
            const data = await res.json()
            const list = Array.isArray(data) ? data : Array.isArray(data.messages) ? data.messages : []
            if (!list.length) continue
            return list.map((m: any) => ({
                id: m.id || m.messageId || 'wa_' + Math.random(),
                from: m.from || m.remoteJid || m.contact || '',
                to: m.to || m.participant || m.destination || '',
                timestamp: m.timestamp ? new Date(m.timestamp).toISOString() : new Date().toISOString(),
                type: m.type || 'text',
                text: m.text || m.body || m.message || m.content || '',
                status: m.status || 'received',
                raw: m
            }))
        } catch { /* ignore and try next */ }
    }
    return []
}

export function mapWhatsAppMessageToLead(msg: WhatsAppInboundMessage) {
    const phone = msg.from.replace(/[^0-9+]/g, '')
    return {
        title: 'Mr',
        firstName: phone.slice(-8, -4) || 'Contato',
        lastName: phone.slice(-4) || 'WhatsApp',
        company: 'WhatsApp',
        jobTitle: '',
        email: `${phone}@wa.local`,
        phone,
        website: '',
        address: { street: '', city: '', state: '', zipCode: '', country: 'Brasil' },
        leadSource: 'social-media',
        leadStatus: 'new',
        priority: 'medium',
        estimatedValue: 0,
        probability: 5,
        expectedCloseDate: '',
        assignedTo: 'user-1',
        tags: ['whatsapp'],
        notes: 'Gerado via mensagem WhatsApp',
        customFields: {},
        activities: [
            {
                id: 'act-' + Date.now(),
                type: 'note',
                subject: 'Mensagem WhatsApp inicial',
                description: msg.text || '',
                date: msg.timestamp,
                userId: 'contact'
            }
        ],
        score: 0
    }
}

// --- Advanced actions: forward, pin/unpin, delete ---

function ensureChatId(target: string) {
    // Accept raw phone like +5511999999999 or 5511999999999 and normalize to WhatsApp JID
    const t = String(target).trim()
    if (t.endsWith('@c.us') || t.endsWith('@g.us')) return t
    const phone = t.replace(/[^0-9+]/g, '')
    return phone + '@c.us'
}

export async function forwardWhatsAppMessage(baseUrl: string, messageId: string, targetChatIdOrPhone: string) {
    const body = { messageId, targetChatId: ensureChatId(targetChatIdOrPhone) }
    const candidates = ['/forward-message', '/v1/forward-message']
    let lastError: any = null
    for (const path of candidates) {
        try {
            const res = await fetch(normalizeBase(baseUrl) + path, {
                method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body)
            })
            if (!res.ok) { lastError = await res.text(); continue }
            return await res.json()
        } catch (e) { lastError = e }
    }
    throw new Error('Falha ao encaminhar: ' + (lastError || 'unknown'))
}

export async function pinWhatsAppMessage(baseUrl: string, messageId: string, durationMs?: number) {
    const body = { messageId, duration: durationMs }
    const candidates = ['/pin-message', '/v1/pin-message']
    let lastError: any = null
    for (const path of candidates) {
        try {
            const res = await fetch(normalizeBase(baseUrl) + path, {
                method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body)
            })
            if (!res.ok) { lastError = await res.text(); continue }
            return await res.json()
        } catch (e) { lastError = e }
    }
    throw new Error('Falha ao fixar: ' + (lastError || 'unknown'))
}

export async function unpinWhatsAppMessage(baseUrl: string, messageId: string) {
    const body = { messageId }
    const candidates = ['/unpin-message', '/v1/unpin-message']
    let lastError: any = null
    for (const path of candidates) {
        try {
            const res = await fetch(normalizeBase(baseUrl) + path, {
                method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body)
            })
            if (!res.ok) { lastError = await res.text(); continue }
            return await res.json()
        } catch (e) { lastError = e }
    }
    throw new Error('Falha ao desfixar: ' + (lastError || 'unknown'))
}

export async function deleteWhatsAppMessage(baseUrl: string, messageId: string, everyone?: boolean, clearMedia: boolean = true) {
    const body = { messageId, everyone: !!everyone, clearMedia }
    const candidates = ['/delete-message', '/v1/delete-message']
    let lastError: any = null
    for (const path of candidates) {
        try {
            const res = await fetch(normalizeBase(baseUrl) + path, {
                method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body)
            })
            if (!res.ok) { lastError = await res.text(); continue }
            return await res.json()
        } catch (e) { lastError = e }
    }
    throw new Error('Falha ao apagar mensagem: ' + (lastError || 'unknown'))
}

// Bulk operations (with graceful fallback)
export async function bulkForwardWhatsAppMessages(baseUrl: string, messageIds: string[], targetChatIdOrPhone: string) {
    if (!messageIds.length) return []
    const body = { messageIds, targetChatId: ensureChatId(targetChatIdOrPhone) }
    const candidates = ['/bulk-forward', '/v1/bulk-forward']
    for (const path of candidates) {
        try {
            const res = await fetch(normalizeBase(baseUrl) + path, {
                method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body)
            })
            if (res.ok) return await res.json()
        } catch { /* try next */ }
    }
    // Fallback: sequential per-item forward
    const results = [] as any[]
    for (const id of messageIds) {
        try { results.push(await forwardWhatsAppMessage(baseUrl, id, targetChatIdOrPhone)) } catch (e) { results.push({ success: false, id, error: (e as any)?.message || 'error' }) }
    }
    return results
}

export async function bulkDeleteWhatsAppMessages(baseUrl: string, messageIds: string[], everyone?: boolean, clearMedia: boolean = true) {
    if (!messageIds.length) return []
    const body = { messageIds, everyone: !!everyone, clearMedia }
    const candidates = ['/bulk-delete', '/v1/bulk-delete']
    for (const path of candidates) {
        try {
            const res = await fetch(normalizeBase(baseUrl) + path, {
                method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body)
            })
            if (res.ok) return await res.json()
        } catch { /* try next */ }
    }
    // Fallback: sequential per-item delete
    const results = [] as any[]
    for (const id of messageIds) {
        try { results.push(await deleteWhatsAppMessage(baseUrl, id, everyone, clearMedia)) } catch (e) { results.push({ success: false, id, error: (e as any)?.message || 'error' }) }
    }
    return results
}

// --- Chat-level operations (archive, mute, pin, mark seen) ---

export async function archiveWhatsAppChat(baseUrl: string, chatId: string) {
    const body = { chatId }
    const candidates = ['/archive-chat', '/v1/archive-chat']
    let lastError: any = null
    for (const path of candidates) {
        try {
            const res = await fetch(normalizeBase(baseUrl) + path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
            if (!res.ok) { lastError = await res.text(); continue }
            return await res.json()
        } catch (e) { lastError = e }
    }
    throw new Error('Falha ao arquivar conversa: ' + (lastError || 'unknown'))
}

export async function unarchiveWhatsAppChat(baseUrl: string, chatId: string) {
    const body = { chatId }
    const candidates = ['/unarchive-chat', '/v1/unarchive-chat']
    let lastError: any = null
    for (const path of candidates) {
        try {
            const res = await fetch(normalizeBase(baseUrl) + path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
            if (!res.ok) { lastError = await res.text(); continue }
            return await res.json()
        } catch (e) { lastError = e }
    }
    throw new Error('Falha ao desarquivar conversa: ' + (lastError || 'unknown'))
}

export async function muteWhatsAppChat(baseUrl: string, chatId: string, durationMs?: number) {
    const body = { chatId, duration: durationMs }
    const candidates = ['/mute-chat', '/v1/mute-chat']
    let lastError: any = null
    for (const path of candidates) {
        try {
            const res = await fetch(normalizeBase(baseUrl) + path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
            if (!res.ok) { lastError = await res.text(); continue }
            return await res.json()
        } catch (e) { lastError = e }
    }
    throw new Error('Falha ao silenciar conversa: ' + (lastError || 'unknown'))
}

export async function unmuteWhatsAppChat(baseUrl: string, chatId: string) {
    const body = { chatId }
    const candidates = ['/unmute-chat', '/v1/unmute-chat']
    let lastError: any = null
    for (const path of candidates) {
        try {
            const res = await fetch(normalizeBase(baseUrl) + path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
            if (!res.ok) { lastError = await res.text(); continue }
            return await res.json()
        } catch (e) { lastError = e }
    }
    throw new Error('Falha ao reativar notificações: ' + (lastError || 'unknown'))
}

export async function pinWhatsAppChat(baseUrl: string, chatId: string) {
    const body = { chatId }
    const candidates = ['/pin-chat', '/v1/pin-chat']
    let lastError: any = null
    for (const path of candidates) {
        try {
            const res = await fetch(normalizeBase(baseUrl) + path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
            if (!res.ok) { lastError = await res.text(); continue }
            return await res.json()
        } catch (e) { lastError = e }
    }
    throw new Error('Falha ao fixar conversa: ' + (lastError || 'unknown'))
}

export async function unpinWhatsAppChat(baseUrl: string, chatId: string) {
    const body = { chatId }
    const candidates = ['/unpin-chat', '/v1/unpin-chat']
    let lastError: any = null
    for (const path of candidates) {
        try {
            const res = await fetch(normalizeBase(baseUrl) + path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
            if (!res.ok) { lastError = await res.text(); continue }
            return await res.json()
        } catch (e) { lastError = e }
    }
    throw new Error('Falha ao desfixar conversa: ' + (lastError || 'unknown'))
}

export async function markChatSeen(baseUrl: string, chatId: string) {
    const body = { chatId }
    const candidates = ['/mark-seen', '/v1/mark-seen']
    for (const path of candidates) {
        try {
            const res = await fetch(normalizeBase(baseUrl) + path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
            if (res.ok) return await res.json()
        } catch { /* try next */ }
    }
    return { ok: true }
}

export async function searchWhatsAppMessages(baseUrl: string, query: string, chatId?: string) {
    const body = { query, chatId }
    const candidates = ['/search-messages', '/v1/search-messages']
    for (const path of candidates) {
        try {
            const res = await fetch(normalizeBase(baseUrl) + path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
            if (res.ok) return await res.json()
        } catch { /* ignore */ }
    }
    return { messages: [] }
}

// Fetch common groups for a contact (phone or chatId). Tries new endpoints we added to the gateway.
export async function fetchCommonGroups(baseUrl: string, contactIdOrPhone: string) {
    const base = normalizeBase(baseUrl)
    // Try v1 first
    const id = encodeURIComponent(contactIdOrPhone)
    const candidates = [
        `${base}/v1/contacts/${id}/common-groups`,
        `${base}/common-groups?contactId=${id}`,
        `${base}/common-groups?phone=${encodeURIComponent(contactIdOrPhone)}`
    ]
    for (const url of candidates) {
        try {
            const res = await fetch(url)
            if (res.ok) return await res.json()
        } catch { /* try next */ }
    }
    return { success: false, groups: [], total: 0 }
}
