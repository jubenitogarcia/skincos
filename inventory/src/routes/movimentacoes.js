// @ts-nocheck

export async function handleMovimentacoesRoutes({
    request,
    url,
    env,
    ctx,
    appOrigin,
    withCORS,
    unidade,
    requireRoles,
    appendAuditLog,
    enqueueNotificationsRefresh,
    ip,
    userAgent,
    idempotencyKey,

    d1,
}) {
    if (d1?.enabled) {
        if (url.pathname === "/movimentacoes" && request.method === "GET") {
            try {
                const tipo = url.searchParams.get('tipo');
                const de = url.searchParams.get('de');
                const ate = url.searchParams.get('ate');
                const filtroUnidade = url.searchParams.get('unidade');
                const limite = url.searchParams.get('limite');
                const pagina = url.searchParams.get('pagina');
                const codigoBarras = url.searchParams.get('codigoBarras') || null;
                const out = await d1.listMovimentacoes({
                    unidade: filtroUnidade || unidade,
                    tipo,
                    de,
                    ate,
                    pagina,
                    limite,
                    codigoBarras,
                });
                return withCORS(JSON.stringify({ success: true, movimentos: out.movimentos, resumo: out.resumo }), { status: 200 }, appOrigin);
            } catch (err) {
                return withCORS(JSON.stringify({ success: false, error: err.message }), { status: 500 }, appOrigin);
            }
        }

        if (url.pathname.startsWith("/movimentacoes/") && request.method === "PUT") {
            try {
                const auth = await requireRoles(['ADMIN', 'GESTOR', 'GERENTE', 'OPERADOR']);
                if (!auth.ok) return auth.response;

                const id = decodeURIComponent(url.pathname.split('/')[2] || '').trim();
                if (!id) {
                    return withCORS(JSON.stringify({ success: false, error: 'Movimentação inválida' }), { status: 400 }, appOrigin);
                }

                const body = await request.json().catch(() => ({}));
                const out = await d1.updateMovimentacao({ id, body });
                if (!out.ok) {
                    return withCORS(JSON.stringify({ success: false, error: out.error }), { status: out.status || 400 }, appOrigin);
                }

                await appendAuditLog({
                    env,
                    actor: auth.user.username,
                    role: auth.user.role,
                    ip,
                    userAgent,
                    idempotencyKey,
                    action: 'UPDATE',
                    entity: 'MOVIMENTACAO',
                    entityId: id,
                    unidade: String(url.searchParams.get('unidade') || unidade || '').trim(),
                    before: null,
                    after: { payload: body, registro: out.registro, transferId: out.transferId || null }
                });

                if (out?.estoqueAtual && typeof out.estoqueAtual === 'object') {
                    const units = Array.from(new Set(Object.keys(out.estoqueAtual).map((v) => String(v || '').trim()).filter(Boolean)));
                    for (const unit of units) {
                        ctx.waitUntil(enqueueNotificationsRefresh(env, unit));
                    }
                } else {
                    ctx.waitUntil(enqueueNotificationsRefresh(env, String(url.searchParams.get('unidade') || unidade || '').trim()));
                }

                return withCORS(JSON.stringify({ success: true, data: out.movimentos || [] }), { status: 200 }, appOrigin);
            } catch (err) {
                return withCORS(JSON.stringify({ success: false, error: err.message || String(err || '') }), { status: 500 }, appOrigin);
            }
        }

        if (url.pathname.startsWith("/movimentacoes/") && request.method === "DELETE") {
            try {
                const auth = await requireRoles(['ADMIN', 'GESTOR', 'GERENTE', 'OPERADOR']);
                if (!auth.ok) return auth.response;

                const id = decodeURIComponent(url.pathname.split('/')[2] || '').trim();
                if (!id) {
                    return withCORS(JSON.stringify({ success: false, error: 'Movimentação inválida' }), { status: 400 }, appOrigin);
                }

                const out = await d1.deleteMovimentacao({ id });
                if (!out.ok) {
                    return withCORS(JSON.stringify({ success: false, error: out.error }), { status: out.status || 400 }, appOrigin);
                }

                await appendAuditLog({
                    env,
                    actor: auth.user.username,
                    role: auth.user.role,
                    ip,
                    userAgent,
                    idempotencyKey,
                    action: 'DELETE',
                    entity: 'MOVIMENTACAO',
                    entityId: id,
                    unidade: String(url.searchParams.get('unidade') || unidade || '').trim(),
                    before: { transferId: out.transferId || null, deletedIds: out.deletedIds || [id], registro: out.registro },
                    after: null
                });

                if (out?.estoqueAtual && typeof out.estoqueAtual === 'object') {
                  const units = Array.from(new Set(Object.keys(out.estoqueAtual).map((v) => String(v || '').trim()).filter(Boolean)));
                  for (const unit of units) {
                    ctx.waitUntil(enqueueNotificationsRefresh(env, unit));
                  }
                } else {
                  ctx.waitUntil(enqueueNotificationsRefresh(env, String(url.searchParams.get('unidade') || unidade || '').trim()));
                }

                return withCORS(JSON.stringify({ success: true, data: { deletedIds: out.deletedIds || [id] } }), { status: 200 }, appOrigin);
            } catch (err) {
                return withCORS(JSON.stringify({ success: false, error: err.message || String(err || '') }), { status: 500 }, appOrigin);
            }
        }
        return null;
    }

    // D1-only: legacy Sheets movimentacoes endpoints are intentionally disabled.
    return withCORS(JSON.stringify({ success: false, error: "D1_ONLY" }), { status: 503 }, appOrigin);

}
