const SURFACES = new Set(['clientes', 'full'])

export const ATENDIMENTO_SURFACES = Object.freeze(['clientes', 'full'])

export function normalizeAtendimentoSurface(value) {
    const surface = String(value || '').trim().toLowerCase()
    return SURFACES.has(surface) ? surface : null
}

// The shared CRM keeps its historical full router when no isolated profile is
// supplied. The isolated runtime always passes an explicit profile, or fails
// closed before mounting the router.
export function resolveAtendimentoSurface({ surface, clientesOnly, defaultSurface = 'full' } = {}) {
    const explicit = normalizeAtendimentoSurface(surface)
    if (String(surface || '').trim()) return explicit
    if (clientesOnly === true) return 'clientes'
    if (clientesOnly === false) return defaultSurface === null ? null : normalizeAtendimentoSurface(defaultSurface)
    return normalizeAtendimentoSurface(defaultSurface)
}

export function isClientesSurface(surface) {
    return normalizeAtendimentoSurface(surface) === 'clientes'
}
