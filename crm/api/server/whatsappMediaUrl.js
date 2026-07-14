const WHATSAPP_MEDIA_ORIGIN = 'https://mmg.whatsapp.net'

function normalizeWhatsappMediaUrl(value) {
    if (typeof value !== 'string' || !value.trim()) return undefined

    try {
        const url = new URL(value.trim())
        if (url.protocol !== 'https:' || url.hostname !== 'mmg.whatsapp.net') return undefined
        return url.toString()
    } catch {
        return undefined
    }
}

export function resolveEvolutionMediaUrl(candidate, directPath) {
    const directValue = typeof directPath === 'string' ? directPath.trim() : ''
    const directUrl = normalizeWhatsappMediaUrl(directValue)
    if (directUrl) return directUrl

    if (directValue && !directValue.startsWith('//') && !directValue.includes('://')) {
        return new URL(`/${directValue.replace(/^\/+/, '')}`, WHATSAPP_MEDIA_ORIGIN).toString()
    }

    return normalizeWhatsappMediaUrl(candidate)
}
