const PRODUCTION_ORIGINS = Object.freeze([
    'https://crm.skincos.com.br',
    'https://espacofacial.com',
    'https://www.espacofacial.com',
    'https://espacofacial.com.br',
    'https://app.espacofacial.com.br'
])

export function configuredCorsOrigins(value = process.env.CRM_CORS_ALLOWED_ORIGINS) {
    const configured = String(value || '')
        .split(',')
        .map((origin) => origin.trim())
        .filter(Boolean)

    return new Set(configured.length ? configured : PRODUCTION_ORIGINS)
}

export function isAllowedCrmCorsOrigin(origin, {
    allowedOrigins = configuredCorsOrigins(),
    environment = process.env.NODE_ENV || 'development'
} = {}) {
    if (!origin) return true

    let parsed
    try {
        parsed = new URL(origin)
    } catch {
        return false
    }

    if (parsed.origin !== origin) return false
    if (allowedOrigins.has(origin)) return true

    return environment !== 'production' &&
        parsed.protocol === 'http:' &&
        (parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1')
}
