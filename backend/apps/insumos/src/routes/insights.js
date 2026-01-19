// @ts-nocheck

function toDateOrNull(v) {
    if (!v) return null;
    const d = new Date(v);
    if (Number.isNaN(d.getTime())) return null;
    return d;
}

function yyyyMmDd(d) {
    return d.toISOString().slice(0, 10);
}

function startOfWeekMonday(d) {
    const out = new Date(d);
    const day = out.getUTCDay(); // 0=Sun..6=Sat
    const diff = (day === 0 ? -6 : 1 - day);
    out.setUTCDate(out.getUTCDate() + diff);
    out.setUTCHours(0, 0, 0, 0);
    return out;
}

function bucketKeyForDate(d, groupBy) {
    if (groupBy === 'month') return d.toISOString().slice(0, 7); // YYYY-MM
    if (groupBy === 'week') return yyyyMmDd(startOfWeekMonday(d));
    return yyyyMmDd(d);
}

function normalizeTipo(tipo) {
    return String(tipo || '').toUpperCase().replace('Í', 'I');
}

function safeNumber(v) {
    const n = Number(v);
    return Number.isFinite(n) ? n : 0;
}

function computeTrends({ movimentos, insumoByCode, groupBy, from, to, unidade }) {
    const byBucket = new Map();
    const totals = { entradaQtd: 0, saidaQtd: 0, ajusteQtd: 0, entradaValor: 0, saidaValor: 0 };

    for (const m of movimentos) {
        if (unidade && String(m.unidade || '') !== String(unidade)) continue;
        const d = toDateOrNull(m.dataHora);
        if (!d) continue;
        if (from && d < from) continue;
        if (to && d > to) continue;

        const key = bucketKeyForDate(d, groupBy);
        const item = insumoByCode.get(String(m.codigoBarras || '').trim()) || null;
        const preco = safeNumber(item?.precoCusto);
        const qty = safeNumber(m.quantidade);
        const val = qty * preco;
        const tipo = normalizeTipo(m.tipo);

        const agg = byBucket.get(key) || {
            bucket: key,
            entradaQtd: 0,
            saidaQtd: 0,
            ajusteQtd: 0,
            entradaValor: 0,
            saidaValor: 0
        };

        if (tipo === 'ENTRADA') {
            agg.entradaQtd += qty;
            agg.entradaValor += val;
            totals.entradaQtd += qty;
            totals.entradaValor += val;
        } else if (tipo === 'SAIDA' || tipo === 'SAÍDA') {
            agg.saidaQtd += qty;
            agg.saidaValor += val;
            totals.saidaQtd += qty;
            totals.saidaValor += val;
        } else if (tipo === 'AJUSTE') {
            agg.ajusteQtd += qty;
            totals.ajusteQtd += qty;
        }

        byBucket.set(key, agg);
    }

    const buckets = Array.from(byBucket.values()).sort((a, b) => String(a.bucket).localeCompare(String(b.bucket)));
    return {
        unidade,
        groupBy,
        from: from ? from.toISOString() : null,
        to: to ? to.toISOString() : null,
        totals: {
            ...totals,
            saldoQtd: totals.entradaQtd - totals.saidaQtd,
            saldoValor: totals.entradaValor - totals.saidaValor
        },
        buckets
    };
}

function computeCategoryTurnover({ movimentos, insumoByCode, from, to, unidade, mode }) {
    const byCat = new Map();
    const only = mode === 'saida' ? 'SAIDA' : mode === 'entrada' ? 'ENTRADA' : null;

    for (const m of movimentos) {
        if (unidade && String(m.unidade || '') !== String(unidade)) continue;
        const d = toDateOrNull(m.dataHora);
        if (!d) continue;
        if (from && d < from) continue;
        if (to && d > to) continue;
        const tipo = normalizeTipo(m.tipo);
        if (only && tipo !== only) continue;

        const code = String(m.codigoBarras || '').trim();
        const item = insumoByCode.get(code) || null;
        const categoria = String(item?.categoria || 'Outros').trim() || 'Outros';
        const preco = safeNumber(item?.precoCusto);
        const qty = safeNumber(m.quantidade);
        const val = qty * preco;

        const agg = byCat.get(categoria) || { categoria, qtd: 0, valor: 0, movimentos: 0 };
        agg.qtd += qty;
        agg.valor += val;
        agg.movimentos += 1;
        byCat.set(categoria, agg);
    }

    const categories = Array.from(byCat.values()).sort((a, b) => (b.valor || 0) - (a.valor || 0));
    return {
        unidade,
        from: from ? from.toISOString() : null,
        to: to ? to.toISOString() : null,
        mode: mode || 'all',
        categories
    };
}

export async function handleInsightsRoutes({
    request,
    url,
    env,
    appOrigin,
    withCORS,
    spreadsheetId,
    accessToken,
    sheetRange,
    movimentacoesRange,
    movimentacoesSheetName,
    unidade,
    ensureHeaderColumns,
    readSheet,
    parseInsumos,
    normalizeInsumos,
    parseMovimentacoes,
    buildActionables,
    buildRoi,
    buildQualityReport,
    stockDistribution,
    buildResumoEstoque,
    d1,
}) {
    const listInsumos = async (unidadeQ) => {
        if (d1?.enabled) return d1.listInsumos({ unidade: unidadeQ });
        const rows = await readSheet(spreadsheetId, sheetRange, accessToken);
        return normalizeInsumos(parseInsumos(rows), unidadeQ);
    };

    const listMovimentos = async ({ unidadeQ, fromIso, toIso }) => {
        if (d1?.enabled) {
            if (!env?.DB) throw new Error('DB_NOT_CONFIGURED');
            const where = [];
            const binds = [];
            if (unidadeQ) {
                where.push('unidade = ?');
                binds.push(String(unidadeQ));
            }
            if (fromIso) {
                where.push('data_hora >= ?');
                binds.push(String(fromIso));
            }
            if (toIso) {
                where.push('data_hora <= ?');
                binds.push(String(toIso));
            }
            const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
            const r = await env.DB.prepare(
                `SELECT data_hora as dataHora, tipo, codigo_barras as codigoBarras, produto, quantidade, unidade, usuario
                 FROM insumos_movements
                 ${whereSql}
                 ORDER BY data_hora ASC
                 LIMIT 100000`
            )
                .bind(...binds)
                .all();
            return r?.results || [];
        }

        await ensureHeaderColumns({
            spreadsheetId,
            sheetName: movimentacoesSheetName,
            accessToken,
            requiredHeaders: ['UNIDADE']
        });
        const movRaw = await readSheet(spreadsheetId, movimentacoesRange, accessToken);
        return parseMovimentacoes(movRaw);
    };
    // Stub analytics / relatorios / alertas / movimentacoes endpoints expected by frontend
    if (url.pathname === "/analytics/actionables" && request.method === "GET") {
        try {
            const insumos = await listInsumos(unidade);
            const data = buildActionables(insumos, unidade);
            return withCORS(JSON.stringify({ success: true, data }), { status: 200 }, appOrigin);
        } catch (err) {
            return withCORS(JSON.stringify({ success: false, error: err.message }), { status: 500 }, appOrigin);
        }
    }
    if (url.pathname === "/analytics/roi" && request.method === "GET") {
        try {
            const insumos = await listInsumos(unidade);
            const data = buildRoi(insumos, unidade);
            return withCORS(JSON.stringify({ success: true, data }), { status: 200 }, appOrigin);
        } catch (err) {
            return withCORS(JSON.stringify({ success: false, error: err.message }), { status: 500 }, appOrigin);
        }
    }
    if (url.pathname === "/quality/report" && request.method === "GET") {
        try {
            const limitIssues = url.searchParams.get('limitIssues') || '500';
            const insumos = await listInsumos(unidade);
            const data = buildQualityReport(insumos, unidade, limitIssues);
            return withCORS(JSON.stringify({ success: true, data }), { status: 200 }, appOrigin);
        } catch (err) {
            return withCORS(JSON.stringify({ success: false, error: err.message }), { status: 500 }, appOrigin);
        }
    }
    if (url.pathname === "/analytics/trends") {
        try {
            const days = Math.max(1, Math.min(366, parseInt(url.searchParams.get('days') || '30', 10) || 30));
            const groupBy = (url.searchParams.get('groupBy') || 'day').toLowerCase();
            const group = groupBy === 'week' || groupBy === 'month' ? groupBy : 'day';
            const now = new Date();
            const from = toDateOrNull(url.searchParams.get('from')) || toDateOrNull(url.searchParams.get('de')) || new Date(now.getTime() - days * 86400000);
            const to = toDateOrNull(url.searchParams.get('to')) || toDateOrNull(url.searchParams.get('ate')) || now;

            const [insumos, movimentos] = await Promise.all([
                listInsumos(unidade),
                listMovimentos({
                    unidadeQ: unidade,
                    fromIso: from ? from.toISOString() : null,
                    toIso: to ? to.toISOString() : null
                }),
            ]);
            const insumoByCode = new Map(insumos.map((i) => [String(i.codigoBarras || '').trim(), i]));

            const data = computeTrends({ movimentos, insumoByCode, groupBy: group, from, to, unidade });
            return withCORS(JSON.stringify({ success: true, data }), { status: 200 }, appOrigin);
        } catch (err) {
            return withCORS(JSON.stringify({ success: false, error: err.message }), { status: 500 }, appOrigin);
        }
    }
    if (url.pathname === "/analytics/category-turnover") {
        try {
            const days = Math.max(1, Math.min(366, parseInt(url.searchParams.get('days') || '30', 10) || 30));
            const now = new Date();
            const from = toDateOrNull(url.searchParams.get('from')) || toDateOrNull(url.searchParams.get('de')) || new Date(now.getTime() - days * 86400000);
            const to = toDateOrNull(url.searchParams.get('to')) || toDateOrNull(url.searchParams.get('ate')) || now;
            const mode = (url.searchParams.get('mode') || 'saida').toLowerCase(); // saida|entrada|all
            const [insumos, movimentos] = await Promise.all([
                listInsumos(unidade),
                listMovimentos({
                    unidadeQ: unidade,
                    fromIso: from ? from.toISOString() : null,
                    toIso: to ? to.toISOString() : null
                }),
            ]);
            const insumoByCode = new Map(insumos.map((i) => [String(i.codigoBarras || '').trim(), i]));

            const data = computeCategoryTurnover({ movimentos, insumoByCode, from, to, unidade, mode });
            return withCORS(JSON.stringify({ success: true, data }), { status: 200 }, appOrigin);
        } catch (err) {
            return withCORS(JSON.stringify({ success: false, error: err.message }), { status: 500 }, appOrigin);
        }
    }
    if (url.pathname === "/analytics/report" && request.method === "POST") {
        try {
            const body = await request.json().catch(() => ({}));
            const groupBy = String(body.groupBy || url.searchParams.get('groupBy') || 'day').toLowerCase();
            const group = groupBy === 'week' || groupBy === 'month' ? groupBy : 'day';
            const days = Math.max(1, Math.min(366, parseInt(body.days || url.searchParams.get('days') || '30', 10) || 30));
            const now = new Date();
            const from = toDateOrNull(body.from || body.de || url.searchParams.get('from') || url.searchParams.get('de')) || new Date(now.getTime() - days * 86400000);
            const to = toDateOrNull(body.to || body.ate || url.searchParams.get('to') || url.searchParams.get('ate')) || now;
            const mode = String(body.mode || url.searchParams.get('mode') || 'saida').toLowerCase();
            const [insumos, movimentos] = await Promise.all([
                listInsumos(unidade),
                listMovimentos({
                    unidadeQ: unidade,
                    fromIso: from ? from.toISOString() : null,
                    toIso: to ? to.toISOString() : null
                }),
            ]);
            const insumoByCode = new Map(insumos.map((i) => [String(i.codigoBarras || '').trim(), i]));

            const trends = computeTrends({ movimentos, insumoByCode, groupBy: group, from, to, unidade });
            const turnover = computeCategoryTurnover({ movimentos, insumoByCode, from, to, unidade, mode });

            // Top produtos por valor (turnover)
            const byProduct = new Map();
            for (const m of movimentos) {
                if (unidade && String(m.unidade || '') !== String(unidade)) continue;
                const d = toDateOrNull(m.dataHora);
                if (!d) continue;
                if (from && d < from) continue;
                if (to && d > to) continue;
                const tipo = normalizeTipo(m.tipo);
                if (mode === 'saida' && tipo !== 'SAIDA') continue;
                if (mode === 'entrada' && tipo !== 'ENTRADA') continue;

                const code = String(m.codigoBarras || '').trim();
                const item = insumoByCode.get(code) || null;
                const produto = String(item?.produto || m.produto || code || '-');
                const categoria = String(item?.categoria || 'Outros');
                const preco = safeNumber(item?.precoCusto);
                const qty = safeNumber(m.quantidade);
                const val = qty * preco;
                const agg = byProduct.get(code) || { codigoBarras: code, produto, categoria, qtd: 0, valor: 0, movimentos: 0 };
                agg.qtd += qty;
                agg.valor += val;
                agg.movimentos += 1;
                byProduct.set(code, agg);
            }
            const topProdutos = Array.from(byProduct.values()).sort((a, b) => (b.valor || 0) - (a.valor || 0)).slice(0, 25);

            const data = { unidade, from: from.toISOString(), to: to.toISOString(), groupBy: group, mode, trends, turnover, topProdutos };
            return withCORS(JSON.stringify({ success: true, data }), { status: 200 }, appOrigin);
        } catch (err) {
            return withCORS(JSON.stringify({ success: false, error: err.message }), { status: 500 }, appOrigin);
        }
    }
    if (url.pathname === "/analytics/stock-distribution") {
        try {
            const insumos = await listInsumos(unidade);
            const dist = stockDistribution(insumos);
            return withCORS(JSON.stringify(dist), { status: 200 }, appOrigin);
        } catch (err) {
            return withCORS(JSON.stringify({ success: false, error: err.message }), { status: 500 }, appOrigin);
        }
    }
    if (url.pathname === "/relatorios/estoque") {
        try {
            const insumos = await listInsumos(unidade);
            const resumo = buildResumoEstoque(insumos);
            return withCORS(JSON.stringify({ success: true, data: { itens: insumos, resumo } }), { status: 200 }, appOrigin);
        } catch (err) {
            return withCORS(JSON.stringify({ success: false, error: err.message }), { status: 500 }, appOrigin);
        }
    }
    if (url.pathname === "/alertas/estoque") {
        try {
            const insumos = await listInsumos(unidade);
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
        } catch (err) {
            return withCORS(JSON.stringify({ success: false, error: err.message }), { status: 500 }, appOrigin);
        }
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
