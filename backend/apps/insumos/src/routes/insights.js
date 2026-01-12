// @ts-nocheck

export async function handleInsightsRoutes({
    request,
    url,
    appOrigin,
    withCORS,
    spreadsheetId,
    accessToken,
    sheetRange,
    unidade,
    readSheet,
    parseInsumos,
    normalizeInsumos,
    buildActionables,
    buildRoi,
    buildQualityReport,
    stockDistribution,
    buildResumoEstoque,
}) {
    // Stub analytics / relatorios / alertas / movimentacoes endpoints expected by frontend
    if (url.pathname === "/analytics/actionables" && request.method === "GET") {
        try {
            const rows = await readSheet(spreadsheetId, sheetRange, accessToken);
            const insumos = normalizeInsumos(parseInsumos(rows), unidade);
            const data = buildActionables(insumos, unidade);
            return withCORS(JSON.stringify({ success: true, data }), { status: 200 }, appOrigin);
        } catch (err) {
            return withCORS(JSON.stringify({ success: false, error: err.message }), { status: 500 }, appOrigin);
        }
    }
    if (url.pathname === "/analytics/roi" && request.method === "GET") {
        try {
            const rows = await readSheet(spreadsheetId, sheetRange, accessToken);
            const insumos = normalizeInsumos(parseInsumos(rows), unidade);
            const data = buildRoi(insumos, unidade);
            return withCORS(JSON.stringify({ success: true, data }), { status: 200 }, appOrigin);
        } catch (err) {
            return withCORS(JSON.stringify({ success: false, error: err.message }), { status: 500 }, appOrigin);
        }
    }
    if (url.pathname === "/quality/report" && request.method === "GET") {
        try {
            const limitIssues = url.searchParams.get('limitIssues') || '500';
            const rows = await readSheet(spreadsheetId, sheetRange, accessToken);
            const insumos = normalizeInsumos(parseInsumos(rows), unidade);
            const data = buildQualityReport(insumos, unidade, limitIssues);
            return withCORS(JSON.stringify({ success: true, data }), { status: 200 }, appOrigin);
        } catch (err) {
            return withCORS(JSON.stringify({ success: false, error: err.message }), { status: 500 }, appOrigin);
        }
    }
    if (url.pathname === "/analytics/trends") {
        return withCORS(JSON.stringify({ data: [] }), { status: 200 }, appOrigin);
    }
    if (url.pathname === "/analytics/category-turnover") {
        return withCORS(JSON.stringify({ data: [] }), { status: 200 }, appOrigin);
    }
    if (url.pathname === "/analytics/report" && request.method === "POST") {
        return withCORS(JSON.stringify({ data: [] }), { status: 200 }, appOrigin);
    }
    if (url.pathname === "/analytics/stock-distribution") {
        const rows = await readSheet(spreadsheetId, sheetRange, accessToken);
        const insumos = normalizeInsumos(parseInsumos(rows), unidade);
        const dist = stockDistribution(insumos);
        return withCORS(JSON.stringify(dist), { status: 200 }, appOrigin);
    }
    if (url.pathname === "/relatorios/estoque") {
        const rows = await readSheet(spreadsheetId, sheetRange, accessToken);
        const insumos = normalizeInsumos(parseInsumos(rows), unidade);
        const resumo = buildResumoEstoque(insumos);
        return withCORS(JSON.stringify({ success: true, data: { itens: insumos, resumo } }), { status: 200 }, appOrigin);
    }
    if (url.pathname === "/alertas/estoque") {
        const rows = await readSheet(spreadsheetId, sheetRange, accessToken);
        const insumos = normalizeInsumos(parseInsumos(rows), unidade);
        const alertas = insumos
            .filter(i => i.estoqueMinimo > 0 && (i.estoqueAtual || 0) <= i.estoqueMinimo)
            .map(i => ({
                codigoBarras: i.codigoBarras,
                produto: i.produto,
                categoria: i.categoria,
                estoqueAtual: i.estoqueAtual,
                estoqueMinimo: i.estoqueMinimo,
                diferenca: (i.estoqueAtual || 0) - (i.estoqueMinimo || 0),
                percentual: i.estoqueMinimo > 0
                    ? Math.round(((i.estoqueAtual || 0) / i.estoqueMinimo) * 100)
                    : null,
                tipoAlerta: 'ESTOQUE_BAIXO'
            }));
        return withCORS(JSON.stringify({ success: true, data: alertas }), { status: 200 }, appOrigin);
    }

    // Legacy/stub paths
    if (url.pathname === "/movimentacoes") {
        return withCORS(JSON.stringify({ data: [] }), { status: 200 }, appOrigin);
    }
    if (url.pathname === "/estoque") {
        return withCORS(JSON.stringify({ data: [] }), { status: 200 }, appOrigin);
    }
    if (url.pathname === "/api/insumos/movimentacoes") {
        return withCORS(JSON.stringify({ data: [] }), { status: 200 }, appOrigin);
    }

    return null;
}
