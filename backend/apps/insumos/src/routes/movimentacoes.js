// @ts-nocheck

export async function handleMovimentacoesRoutes({
    request,
    url,
    appOrigin,
    withCORS,
    spreadsheetId,
    accessToken,
    movimentacoesSheetName,
    movimentacoesRange,
    ensureHeaderColumns,
    readSheet,
    parseMovimentacoes,
    sheetRange,
    parseInsumos,
    normalizeInsumos,
    unidade,
}) {
    if (url.pathname === "/relatorios/movimentacoes" && request.method === "GET") {
        try {
            await ensureHeaderColumns({
                spreadsheetId,
                sheetName: movimentacoesSheetName,
                accessToken,
                requiredHeaders: ['UNIDADE']
            });
            const raw = await readSheet(spreadsheetId, movimentacoesRange, accessToken);
            let movimentos = parseMovimentacoes(raw);

            const de = url.searchParams.get('de') || url.searchParams.get('from');
            const ate = url.searchParams.get('ate') || url.searchParams.get('to');
            const tipo = url.searchParams.get('tipo');
            const unidadeQ = url.searchParams.get('unidade') || null;
            const limite = Math.max(1, Math.min(2000, parseInt(url.searchParams.get('limite') || '200', 10) || 200));

            const start = de ? new Date(de) : null;
            const end = ate ? new Date(ate) : null;
            const tipoUpper = tipo ? String(tipo).toUpperCase() : null;

            movimentos = movimentos
                .filter((m) => {
                    const d = new Date(m.dataHora);
                    if (start && d < start) return false;
                    if (end && d > end) return false;
                    if (tipoUpper) {
                        const t = String(m.tipo || '').toUpperCase().replace('Í', 'I');
                        if (tipoUpper.replace('Í', 'I') !== t) return false;
                    }
                    if (unidadeQ && String(m.unidade || '') !== String(unidadeQ)) return false;
                    return true;
                })
                .sort((a, b) => new Date(b.dataHora).getTime() - new Date(a.dataHora).getTime())
                .slice(0, limite);

            const resumo = movimentos.reduce(
                (acc, mov) => {
                    const t = String(mov.tipo || '').toUpperCase().replace('Í', 'I');
                    if (t === 'ENTRADA') acc.totalEntradas += Number(mov.quantidade) || 0;
                    else acc.totalSaidas += Number(mov.quantidade) || 0;
                    acc.totalMovimentacoes += 1;
                    return acc;
                },
                { totalEntradas: 0, totalSaidas: 0, totalMovimentacoes: 0 }
            );

            return withCORS(JSON.stringify({ success: true, data: { resumo, movimentos } }), { status: 200 }, appOrigin);
        } catch (err) {
            return withCORS(JSON.stringify({ success: false, error: err.message }), { status: 500 }, appOrigin);
        }
    }

    // Movimentações (GET /movimentacoes)
    if (url.pathname === "/movimentacoes" && request.method === "GET") {
        try {
            await ensureHeaderColumns({
                spreadsheetId,
                sheetName: movimentacoesSheetName,
                accessToken,
                requiredHeaders: ['UNIDADE']
            });
            const raw = await readSheet(spreadsheetId, movimentacoesRange, accessToken);
            let movimentos = parseMovimentacoes(raw);

            const tipo = url.searchParams.get('tipo');
            const de = url.searchParams.get('de');
            const ate = url.searchParams.get('ate');
            const filtroUnidade = url.searchParams.get('unidade');
            const limite = Math.max(1, parseInt(url.searchParams.get('limite') || '50', 10) || 50);
            const pagina = Math.max(1, parseInt(url.searchParams.get('pagina') || '1', 10) || 1);

            if (tipo) {
                movimentos = movimentos.filter((m) => String(m.tipo).toUpperCase() === String(tipo).toUpperCase());
            }
            if (filtroUnidade) {
                movimentos = movimentos.filter((m) => (m.unidade || '') === filtroUnidade);
            }
            const start = de ? new Date(`${de}T00:00:00.000Z`) : null;
            const end = ate ? new Date(`${ate}T23:59:59.999Z`) : null;
            if (start || end) {
                movimentos = movimentos.filter((m) => {
                    const d = new Date(m.dataHora);
                    if (Number.isNaN(d.getTime())) return false;
                    if (start && d < start) return false;
                    if (end && d > end) return false;
                    return true;
                });
            }

            movimentos.sort((a, b) => new Date(b.dataHora).getTime() - new Date(a.dataHora).getTime());

            // Enrich with unit price from insumos sheet (optional)
            try {
                const insumosRaw = await readSheet(spreadsheetId, sheetRange, accessToken);
                const insumos = normalizeInsumos(parseInsumos(insumosRaw), unidade);
                const priceMap = new Map(insumos.map((i) => [i.codigoBarras, i.precoCusto]));
                movimentos = movimentos.map((m) => ({ ...m, preco: priceMap.get(m.codigoBarras) || 0 }));
            } catch (e) {
                // ignore
            }

            const totalMovimentacoes = movimentos.length;
            const startIdx = (pagina - 1) * limite;
            const pageItems = movimentos.slice(startIdx, startIdx + limite);

            return withCORS(JSON.stringify({
                success: true,
                movimentos: pageItems,
                resumo: { totalMovimentacoes, pagina, limite }
            }), { status: 200 }, appOrigin);
        } catch (err) {
            return withCORS(JSON.stringify({ success: false, error: err.message }), { status: 500 }, appOrigin);
        }
    }

    return null;
}
