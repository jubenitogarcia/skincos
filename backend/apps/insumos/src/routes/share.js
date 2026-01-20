// Share history routes (D1-backed, per user).

const ROLE_ANY = ['CONSULTOR', 'OPERADOR', 'GERENTE', 'GESTOR', 'ADMIN'];

const safeJson = (value, fallback) => {
    try {
        return JSON.parse(value);
    } catch {
        return fallback;
    }
};

const normalizeFiles = (files) => {
    if (!Array.isArray(files)) return [];
    return files
        .slice(0, 6)
        .map((f) => ({
            name: String(f?.name || '').trim(),
            size: Number(f?.size || 0) || undefined,
            contentType: f?.contentType ? String(f.contentType) : undefined,
            url: f?.url ? String(f.url) : undefined,
        }))
        .filter((f) => f.name);
};

export async function handleShareRoutes({
    request,
    url,
    env,
    appOrigin,
    withCORS,
    requireRoles,
}) {
    const historyBasePath = '/share/history';
    const shareBasePath = '/share/';
    if (!url.pathname.startsWith(historyBasePath) && !url.pathname.startsWith(shareBasePath)) return null;

    const auth = await requireRoles(ROLE_ANY);
    if (!auth.ok) return auth.response;
    const username = String(auth.user?.username || '').trim();
    if (!username) {
        return withCORS(JSON.stringify({ success: false, error: 'Sem usuário' }), { status: 400 }, appOrigin);
    }

    if (!env.DB) {
        // history endpoints are safe to treat as empty; share-by-id should 404 to avoid confusion
        if (url.pathname.startsWith(historyBasePath)) {
            return withCORS(JSON.stringify({ success: true, data: [], source: 'no-db' }), { status: 200 }, appOrigin);
        }
        return withCORS(JSON.stringify({ success: false, error: 'DB_NOT_CONFIGURED' }), { status: 500 }, appOrigin);
    }

    // GET /share/:id (read a single share payload, per-user)
    if (url.pathname.startsWith(shareBasePath) && request.method === 'GET') {
        try {
            const id = decodeURIComponent(url.pathname.slice(shareBasePath.length)).trim();
            if (!id) {
                return withCORS(JSON.stringify({ success: false, error: 'ID ausente' }), { status: 400 }, appOrigin);
            }

            const row = await env.DB.prepare(
                `SELECT id, created_at as createdAt, title, text, url, files_json as filesJson, source_id as sourceId
                 FROM share_history
                 WHERE id = ? AND user = ?
                 LIMIT 1`
            )
                .bind(id, username)
                .first();

            if (!row?.id) {
                return withCORS(JSON.stringify({ success: false, error: 'NOT_FOUND' }), { status: 404 }, appOrigin);
            }

            const payload = {
                id: row.id,
                createdAt: row.createdAt,
                title: row.title || '',
                text: row.text || '',
                url: row.url || '',
                sourceId: row.sourceId || '',
                files: safeJson(row.filesJson || '[]', []),
            };

            const fileName = String(url.searchParams.get('file') || '').trim();
            if (fileName) {
                const files = normalizeFiles(payload.files);
                const hit = files.find((f) => String(f.name || '').trim() === fileName);
                const targetUrl = hit?.url ? String(hit.url) : '';
                if (!targetUrl) {
                    return withCORS(JSON.stringify({ success: false, error: 'FILE_NOT_FOUND' }), { status: 404 }, appOrigin);
                }
                return withCORS('', { status: 302, headers: { Location: targetUrl } }, appOrigin);
            }

            return withCORS(JSON.stringify(payload), { status: 200 }, appOrigin);
        } catch (err) {
            return withCORS(JSON.stringify({ success: false, error: err.message }), { status: 500 }, appOrigin);
        }
    }

    if (url.pathname === historyBasePath && request.method === 'GET') {
        try {
            const limit = Math.max(1, Math.min(50, parseInt(url.searchParams.get('limit') || '12', 10) || 12));
            const pagina = Math.max(1, parseInt(url.searchParams.get('pagina') || '1', 10) || 1);
            const offset = (pagina - 1) * limit;
            const countRow = await env.DB.prepare('SELECT COUNT(1) as total FROM share_history WHERE user = ?')
                .bind(username)
                .first();
            const total = Number(countRow?.total || 0);
            const rows = await env.DB.prepare(
                `SELECT id, created_at as createdAt, title, text, url, files_json as filesJson, source_id as sourceId
                 FROM share_history
                 WHERE user = ?
                 ORDER BY created_at DESC
                 LIMIT ? OFFSET ?`
            )
                .bind(username, limit, offset)
                .all();

            const data = (rows?.results || []).map((r) => ({
                id: r.id,
                createdAt: r.createdAt,
                title: r.title || '',
                text: r.text || '',
                url: r.url || '',
                sourceId: r.sourceId || '',
                files: safeJson(r.filesJson || '[]', []),
            }));
            return withCORS(JSON.stringify({ success: true, data, resumo: { total, pagina, limit } }), { status: 200 }, appOrigin);
        } catch (err) {
            return withCORS(JSON.stringify({ success: false, error: err.message }), { status: 500 }, appOrigin);
        }
    }

    if (url.pathname === historyBasePath && request.method === 'POST') {
        try {
            const body = await request.json().catch(() => ({}));
            const id = String(body.id || crypto.randomUUID());
            const createdAt = String(body.createdAt || new Date().toISOString());
            const title = body.title ? String(body.title) : '';
            const text = body.text ? String(body.text) : '';
            const link = body.url ? String(body.url) : '';
            const sourceId = body.sourceId ? String(body.sourceId) : '';
            const files = normalizeFiles(body.files);
            const filesJson = JSON.stringify(files);

            await env.DB.prepare(
                `INSERT OR REPLACE INTO share_history
                 (id, user, created_at, title, text, url, files_json, source_id)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
            )
                .bind(id, username, createdAt, title, text, link, filesJson, sourceId)
                .run();

            return withCORS(
                JSON.stringify({ success: true, data: { id, createdAt, title, text, url: link, files, sourceId } }),
                { status: 200 },
                appOrigin
            );
        } catch (err) {
            return withCORS(JSON.stringify({ success: false, error: err.message }), { status: 500 }, appOrigin);
        }
    }

    if (url.pathname.startsWith(`${historyBasePath}/`) && request.method === 'DELETE') {
        try {
            const id = url.pathname.slice(historyBasePath.length + 1);
            if (!id) {
                return withCORS(JSON.stringify({ success: false, error: 'ID ausente' }), { status: 400 }, appOrigin);
            }
            await env.DB.prepare('DELETE FROM share_history WHERE id = ? AND user = ?')
                .bind(id, username)
                .run();
            return withCORS(JSON.stringify({ success: true }), { status: 200 }, appOrigin);
        } catch (err) {
            return withCORS(JSON.stringify({ success: false, error: err.message }), { status: 500 }, appOrigin);
        }
    }

    return null;
}
