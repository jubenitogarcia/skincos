// @ts-nocheck

export async function handleMovimentacoesRoutes({
    request,
    url,
    appOrigin,
    withCORS,
    unidade,

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
        return null;
    }

    // D1-only: legacy Sheets movimentacoes endpoints are intentionally disabled.
    return withCORS(JSON.stringify({ success: false, error: "D1_ONLY" }), { status: 503 }, appOrigin);

}
