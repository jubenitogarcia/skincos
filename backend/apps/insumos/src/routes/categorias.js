// @ts-nocheck

const ROLE_ANY = ['CONSULTOR', 'OPERADOR', 'GERENTE', 'GESTOR', 'ADMIN'];

function toBool(v) {
    return v === true || v === 1 || v === '1' || String(v || '').toLowerCase() === 'true';
}

export async function handleCategoriasRoutes({
    request,
    url,
    env,
    appOrigin,
    withCORS,
    requireRoles,
}) {
    if (!url.pathname.startsWith('/categorias')) return null;

    const auth = await requireRoles(ROLE_ANY);
    if (!auth.ok) return auth.response;

    if (!env?.DB) {
        return withCORS(JSON.stringify({ success: true, data: [], source: 'no-db' }), { status: 200 }, appOrigin);
    }

    // GET /categorias/policies
    if ((url.pathname === '/categorias/policies' || url.pathname === '/categorias') && request.method === 'GET') {
        try {
            const rows = await env.DB.prepare(
                `SELECT slug, label, requires_lot, requires_expiry, fefo, created_at, updated_at
         FROM insumos_categories
         ORDER BY COALESCE(NULLIF(label, ''), slug) COLLATE NOCASE ASC`
            ).all();

            const data = (rows?.results || []).map((r) => ({
                slug: String(r.slug || ''),
                label: String(r.label || ''),
                requiresLot: toBool(r.requires_lot),
                requiresExpiry: toBool(r.requires_expiry),
                fefo: toBool(r.fefo),
                createdAt: r.created_at || null,
                updatedAt: r.updated_at || null,
            }));

            return withCORS(JSON.stringify({ success: true, data }), { status: 200 }, appOrigin);
        } catch (err) {
            return withCORS(JSON.stringify({ success: false, error: err.message }), { status: 500 }, appOrigin);
        }
    }

    return withCORS(JSON.stringify({ success: false, error: 'NOT_FOUND' }), { status: 404 }, appOrigin);
}
