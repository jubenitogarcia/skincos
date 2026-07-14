const UNIFIED_SYSTEM_ORIGIN = 'http://localhost:3001'

const CHANNEL_PATHS = Object.freeze({
    status: 'status',
    qr: 'qr',
    qrStream: 'qr/stream',
})

export function parseUnifiedChannelId(value) {
    const channel = String(value ?? '').trim()
    return /^[1-9]$/.test(channel) ? channel : null
}

export function unifiedSystemUrl(pathname) {
    const url = new URL(pathname, UNIFIED_SYSTEM_ORIGIN)
    if (url.origin !== UNIFIED_SYSTEM_ORIGIN) {
        throw new Error('UNIFIED_SYSTEM_ORIGIN_MISMATCH')
    }
    return url.toString()
}

export function unifiedChannelUrl(channelId, resource) {
    const channel = parseUnifiedChannelId(channelId)
    const suffix = CHANNEL_PATHS[resource]
    if (!channel || !suffix) {
        throw new Error('INVALID_UNIFIED_CHANNEL_ROUTE')
    }
    return unifiedSystemUrl(`/whatsapp/${channel}/${suffix}`)
}
