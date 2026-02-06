// Audit routes extracted from the main worker router.

export async function handleAuditRoutes({
    request,
    url,
    env,
    appOrigin,
    withCORS,
    requireRoles,
}) {
    // GET /audit (consulta logs; prefer D1, fallback Sheets)
    if (url.pathname === "/audit" && request.method === "GET") {
        try {
            const auth = await requireRoles(['ADMIN', 'GESTOR', 'GERENTE']);
            if (!auth.ok) return auth.response;

            const actorQ = url.searchParams.get('actor');
            const actionQ = url.searchParams.get('action');
            const entityQ = url.searchParams.get('entity');
            const unidadeQ = url.searchParams.get('unidade');
            const limit = Math.max(1, Math.min(500, parseInt(url.searchParams.get('limit') || '100', 10) || 100));
            const pagina = Math.max(1, parseInt(url.searchParams.get('pagina') || '1', 10) || 1);

            if (env.DB) {
                const where = [];
                const binds = [];
                if (actorQ) {
                    where.push('LOWER(actor) LIKE ?');
                    binds.push(`%${String(actorQ).toLowerCase()}%`);
                }
                if (actionQ) {
                    where.push('UPPER(action) = ?');
                    binds.push(String(actionQ).toUpperCase());
                }
                if (entityQ) {
                    where.push('UPPER(entity) = ?');
                    binds.push(String(entityQ).toUpperCase());
                }
                if (unidadeQ) {
                    where.push('unidade = ?');
                    binds.push(String(unidadeQ));
                }
                const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
                const countRow = await env.DB.prepare(`SELECT COUNT(1) as total FROM audit_log ${whereSql}`)
                    .bind(...binds)
                    .first();
                const total = Number(countRow?.total || 0);
                const offset = (pagina - 1) * limit;
                const result = await env.DB.prepare(
                    `SELECT ts as timestamp, actor, role, action, entity, entity_id as entityId, unidade, ip, user_agent as userAgent, idempotency_key as idempotencyKey
                     FROM audit_log ${whereSql}
                     ORDER BY ts DESC
                     LIMIT ? OFFSET ?`
                )
                    .bind(...binds, limit, offset)
                    .all();
                return withCORS(
                    JSON.stringify({ success: true, data: result?.results || [], resumo: { total, pagina, limit } }),
                    { status: 200 },
                    appOrigin
                );
            }

            return withCORS(JSON.stringify({ success: false, error: 'DB_NOT_CONFIGURED' }), { status: 503 }, appOrigin);
        } catch (err) {
            return withCORS(JSON.stringify({ success: false, error: err.message }), { status: 500 }, appOrigin);
        }
    }

    return null;
}
