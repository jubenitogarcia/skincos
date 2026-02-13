function ensureTrailingSlash(url) {
    if (!url) return ''
    return url.endsWith('/') ? url.slice(0, -1) : url
}

function normalizeNumber(number) {
    const raw = String(number || '').trim()
    if (!raw) return null
    return raw
}

export function createWhatsAppProvider(config) {
    const baseUrl = ensureTrailingSlash(config?.wa?.baseUrl || '')
    const provider = String(config?.wa?.provider || 'official').toLowerCase()

    async function sendViaOfficial({ channelId, number, message }) {
        const url = `${baseUrl}/whatsapp/${channelId}/send-message`
        const payload = { number, message }
        const r = await fetch(url, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(payload),
        })
        const data = await r.json().catch(() => ({}))
        if (!r.ok || data?.error) {
            const err = data?.error || `HTTP ${r.status}`
            throw new Error(`official send-message failed: ${err}`)
        }
        return data
    }

    async function sendViaGateway({ number, message }) {
        const url = `${baseUrl}/send-message`
        const payload = { number, message }
        const r = await fetch(url, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(payload),
        })
        const data = await r.json().catch(() => ({}))
        if (!r.ok || data?.error) {
            const err = data?.error || `HTTP ${r.status}`
            throw new Error(`gateway send-message failed: ${err}`)
        }
        return data
    }

    return {
        async sendMessage({ channelId, number, message }) {
            const num = normalizeNumber(number)
            if (!num) throw new Error('number is required')
            const msg = String(message || '').trim()
            if (!msg) throw new Error('message is required')

            if (provider === 'gateway') {
                return sendViaGateway({ number: num, message: msg })
            }
            const channel = String(channelId || config?.wa?.channelDefault || '1')
            return sendViaOfficial({ channelId: channel, number: num, message: msg })
        },
    }
}

