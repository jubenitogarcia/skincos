function isObject(value) {
    return value != null && typeof value === 'object' && !Array.isArray(value)
}

function shouldRedactKey(key) {
    const k = String(key || '').toLowerCase()
    return (
        k === 'apikey' ||
        k === 'api_key' ||
        k === 'x-api-key' ||
        k === 'authorization' ||
        k === 'token' ||
        k === 'access_token' ||
        k === 'refresh_token' ||
        k.endsWith('_token') ||
        k.includes('secret')
    )
}

export function redactSecrets(input) {
    if (Array.isArray(input)) return input.map(redactSecrets)
    if (!isObject(input)) return input

    const out = {}
    for (const [k, v] of Object.entries(input)) {
        if (shouldRedactKey(k)) {
            out[k] = '[REDACTED]'
            continue
        }
        out[k] = redactSecrets(v)
    }
    return out
}

