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

        if (url.pathname.startsWith("/movimentacoes/") && (request.method === "PUT" || request.method === "DELETE")) {
            return withCORS(JSON.stringify({ success: false, code: 'LEDGER_IMMUTABLE', error: 'Movimentações são imutáveis; use o estorno compensatório' }), { status: 405, headers: { allow: 'GET, POST' } }, appOrigin);
        }

        if (url.pathname.startsWith("/movimentacoes/") && request.method === "POST") {
            try {
                const parts = url.pathname.split('/').filter(Boolean);
                const id = decodeURIComponent(parts[1] || '').trim();
                const action = String(parts[2] || '').trim().toLowerCase();
                if (!id || action !== 'estorno') {
                    return withCORS(JSON.stringify({ success: false, code: 'NOT_FOUND', error: 'Rota de movimentação não encontrada' }), { status: 404 }, appOrigin);
                }
                const auth = await requireRoles(['ADMIN', 'GESTOR', 'GERENTE', 'OPERADOR']);
                if (!auth.ok) return auth.response;
                const body = await request.json().catch(() => ({}));
                const command = await d1.executeIdempotent({
                    actor: auth.user,
                    action: 'MOVIMENTACAO_ESTORNO',
                    idempotencyKey,
                    command: { id, unidade, body },
                    execute: () => d1.estornarMovimentacao({ id, actor: auth.user, justificativa: body?.justificativa || body?.motivo }),
                });
                if (!command.ok) return withCORS(JSON.stringify({ success: false, code: command.code, error: command.error }), { status: command.status || 400 }, appOrigin);
                const out = command.result;
                if (!out?.ok) return withCORS(JSON.stringify({ success: false, code: out?.code, error: out?.error }), { status: out?.status || 400 }, appOrigin);

                if (!command.replayed) {
                    await appendAuditLog({
                        env,
                        actor: auth.user.username,
                        role: auth.user.role,
                        ip,
                        userAgent,
                        idempotencyKey,
                        action: 'ESTORNO',
                        entity: 'MOVIMENTACAO',
                        entityId: id,
                        unidade: String(url.searchParams.get('unidade') || unidade || '').trim(),
                        before: { movimentoOriginal: id, transferId: out.transferId || null },
                        after: { estornoIds: out.estornoIds || [], motivo: body?.justificativa || body?.motivo || '' }
                    });
                    ctx.waitUntil(enqueueNotificationsRefresh(env, String(url.searchParams.get('unidade') || unidade || '').trim()));
                }
                return withCORS(JSON.stringify({ success: true, data: out, idempotent: !!command.replayed }), { status: 200 }, appOrigin);
            } catch (err) {
                return withCORS(JSON.stringify({ success: false, error: err.message || String(err || '') }), { status: 500 }, appOrigin);
            }
        }
        return null;
    }

    // D1-only: legacy Sheets movimentacoes endpoints are intentionally disabled.
    return withCORS(JSON.stringify({ success: false, error: "D1_ONLY" }), { status: 503 }, appOrigin);

}
