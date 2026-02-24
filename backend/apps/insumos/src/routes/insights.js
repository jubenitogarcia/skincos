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

function parseDateBound(raw, bound) {
    const value = String(raw || '').trim();
    if (!value) return null;
    if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
        const suffix = bound === 'end' ? 'T23:59:59.999Z' : 'T00:00:00.000Z';
        return toDateOrNull(`${value}${suffix}`);
    }
    return toDateOrNull(value);
}

function resolveWindow(url, fallbackDays = 30) {
    const daysRaw = parseInt(url.searchParams.get('days') || `${fallbackDays}`, 10) || fallbackDays;
    const days = Math.max(1, Math.min(366, daysRaw));
    const now = new Date();
    const from =
        parseDateBound(url.searchParams.get('from') || url.searchParams.get('de'), 'start') ||
        new Date(now.getTime() - days * 86400000);
    const to = parseDateBound(url.searchParams.get('to') || url.searchParams.get('ate'), 'end') || now;
    return { from, to, days };
}

function buildStockAlerts(insumos) {
    return (Array.isArray(insumos) ? insumos : [])
        .filter((i) => {
            const estoqueAtual = safeNumber(i?.estoqueAtual);
            const estoqueMinimo = safeNumber(i?.estoqueMinimo);
            return estoqueAtual < 0 || (estoqueMinimo > 0 && estoqueAtual <= estoqueMinimo);
        })
        .map((i) => {
            const estoqueAtual = safeNumber(i?.estoqueAtual);
            const estoqueMinimo = safeNumber(i?.estoqueMinimo);
            const isBreakage = estoqueAtual < 0;
            const isBelowMin = estoqueMinimo > 0 && estoqueAtual < estoqueMinimo;
            const statusAlerta = isBreakage || isBelowMin ? 'URGENTE' : 'ATENCAO';
            return {
                codigoBarras: i.codigoBarras,
                produto: i.produto,
                categoria: i.categoria,
                estoqueAtual,
                estoqueMinimo,
                diferenca: estoqueAtual - estoqueMinimo,
                percentual: estoqueMinimo > 0 ? Math.round((estoqueAtual / estoqueMinimo) * 100) : null,
                tipoAlerta: isBreakage ? 'QUEBRA_ESTOQUE' : 'ESTOQUE_BAIXO',
                statusAlerta
            };
        });
}

function computeMovementOverview({ movimentos, insumoByCode, from, to, unidade, maxSeriesPoints = 365 }) {
    const resumo = { entradaQtd: 0, saidaQtd: 0, entradaValor: 0, saidaValor: 0 };
    const byDay = new Map();
    const limit = Math.max(1, Math.min(366, parseInt(String(maxSeriesPoints || 365), 10) || 365));

    for (const m of Array.isArray(movimentos) ? movimentos : []) {
        if (unidade && String(m?.unidade || '') !== String(unidade)) continue;
        const d = toDateOrNull(m?.dataHora);
        if (!d) continue;
        if (from && d < from) continue;
        if (to && d > to) continue;

        const code = String(m?.codigoBarras || '').trim();
        const item = code ? insumoByCode.get(code) || null : null;
        const tipo = normalizeTipo(m?.tipo);
        const qtd = safeNumber(m?.quantidade);
        const preco = safeNumber(m?.preco) || safeNumber(item?.precoCusto);
        const valor = qtd * preco;

        if (tipo === 'ENTRADA') {
            resumo.entradaQtd += qtd;
            resumo.entradaValor += valor;
        } else if (tipo === 'SAIDA' || tipo === 'SAÍDA') {
            resumo.saidaQtd += qtd;
            resumo.saidaValor += valor;
        } else {
            continue;
        }

        const day = d.toISOString().slice(0, 10);
        const current = byDay.get(day) || { day, entrada: 0, saida: 0, entradaValor: 0, saidaValor: 0 };
        if (tipo === 'ENTRADA') {
            current.entrada += qtd;
            current.entradaValor += valor;
        } else {
            current.saida += qtd;
            current.saidaValor += valor;
        }
        byDay.set(day, current);
    }

    return {
        movResumo: {
            ...resumo,
            saldoLiquido: resumo.entradaValor - resumo.saidaValor
        },
        movSeries: Array.from(byDay.values())
            .sort((a, b) => String(a.day).localeCompare(String(b.day)))
            .slice(-limit)
    };
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

function bucketExprForGroup(group) {
    if (group === 'month') return "strftime('%Y-%m', m.data_hora)";
    if (group === 'week') return "date(m.data_hora, 'weekday 1', '-7 days')";
    return "date(m.data_hora)";
}

async function listMovimentosAggregated({ env, unidadeQ, fromIso, toIso, groupBy }) {
    if (!env?.DB) throw new Error('DB_NOT_CONFIGURED');
    const where = [];
    const binds = [];
    if (unidadeQ) {
        where.push('m.unidade = ?');
        binds.push(String(unidadeQ));
    }
    if (fromIso) {
        where.push('m.data_hora >= ?');
        binds.push(String(fromIso));
    }
    if (toIso) {
        where.push('m.data_hora <= ?');
        binds.push(String(toIso));
    }
    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
    const bucketExpr = bucketExprForGroup(groupBy);
    const tipoExpr = "UPPER(REPLACE(m.tipo, 'Í', 'I'))";
    const r = await env.DB.prepare(
        `SELECT
            ${bucketExpr} AS bucket,
            SUM(CASE WHEN ${tipoExpr} = 'ENTRADA' THEN COALESCE(m.quantidade, 0) ELSE 0 END) AS entradaQtd,
            SUM(CASE WHEN ${tipoExpr} IN ('SAIDA','SAÍDA') THEN COALESCE(m.quantidade, 0) ELSE 0 END) AS saidaQtd,
            SUM(CASE WHEN ${tipoExpr} = 'AJUSTE' THEN COALESCE(m.quantidade, 0) ELSE 0 END) AS ajusteQtd,
            SUM(CASE WHEN ${tipoExpr} = 'ENTRADA' THEN COALESCE(m.quantidade, 0) * COALESCE(i.preco_custo, 0) ELSE 0 END) AS entradaValor,
            SUM(CASE WHEN ${tipoExpr} IN ('SAIDA','SAÍDA') THEN COALESCE(m.quantidade, 0) * COALESCE(i.preco_custo, 0) ELSE 0 END) AS saidaValor
         FROM insumos_movements m
         LEFT JOIN insumos_items i ON i.registro = m.registro_insumo
         ${whereSql}
         GROUP BY bucket
         ORDER BY bucket ASC`
    )
        .bind(...binds)
        .all();
    const buckets = (r?.results || []).filter((b) => b?.bucket);
    const totals = buckets.reduce(
        (acc, cur) => {
            acc.entradaQtd += Number(cur.entradaQtd) || 0;
            acc.saidaQtd += Number(cur.saidaQtd) || 0;
            acc.ajusteQtd += Number(cur.ajusteQtd) || 0;
            acc.entradaValor += Number(cur.entradaValor) || 0;
            acc.saidaValor += Number(cur.saidaValor) || 0;
            return acc;
        },
        { entradaQtd: 0, saidaQtd: 0, ajusteQtd: 0, entradaValor: 0, saidaValor: 0 }
    );
    return { buckets, totals };
}

async function listCategoryTurnoverAggregated({ env, unidadeQ, fromIso, toIso, mode }) {
    if (!env?.DB) throw new Error('DB_NOT_CONFIGURED');
    const where = [];
    const binds = [];
    if (unidadeQ) {
        where.push('m.unidade = ?');
        binds.push(String(unidadeQ));
    }
    if (fromIso) {
        where.push('m.data_hora >= ?');
        binds.push(String(fromIso));
    }
    if (toIso) {
        where.push('m.data_hora <= ?');
        binds.push(String(toIso));
    }
    const tipoExpr = "UPPER(REPLACE(m.tipo, 'Í', 'I'))";
    if (mode === 'saida') {
        where.push(`${tipoExpr} IN ('SAIDA','SAÍDA')`);
    } else if (mode === 'entrada') {
        where.push(`${tipoExpr} = 'ENTRADA'`);
    }
    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
    const r = await env.DB.prepare(
        `SELECT
            COALESCE(NULLIF(TRIM(i.categoria), ''), 'Outros') AS categoria,
            SUM(COALESCE(m.quantidade, 0)) AS qtd,
            SUM(COALESCE(m.quantidade, 0) * COALESCE(i.preco_custo, 0)) AS valor,
            COUNT(1) AS movimentos
         FROM insumos_movements m
         LEFT JOIN insumos_items i ON i.registro = m.registro_insumo
         ${whereSql}
         GROUP BY categoria
         ORDER BY valor DESC`
    )
        .bind(...binds)
        .all();
    const categories = (r?.results || []).map((row) => ({
        categoria: String(row?.categoria || 'Outros'),
        qtd: Number(row?.qtd) || 0,
        valor: Number(row?.valor) || 0,
        movimentos: Number(row?.movimentos) || 0,
    }));
    return {
        unidade: unidadeQ,
        from: fromIso || null,
        to: toIso || null,
        mode: mode || 'all',
        categories,
    };
}

function trendsFromBuckets({ buckets, totals, unidadeQ, groupBy, from, to }) {
    return {
        unidade: unidadeQ,
        groupBy,
        from: from ? from.toISOString() : null,
        to: to ? to.toISOString() : null,
        totals: {
            ...totals,
            saldoQtd: totals.entradaQtd - totals.saidaQtd,
            saldoValor: totals.entradaValor - totals.saidaValor
        },
        buckets: (buckets || []).map((b) => ({
            bucket: String(b.bucket || ''),
            entradaQtd: Number(b.entradaQtd) || 0,
            saidaQtd: Number(b.saidaQtd) || 0,
            ajusteQtd: Number(b.ajusteQtd) || 0,
            entradaValor: Number(b.entradaValor) || 0,
            saidaValor: Number(b.saidaValor) || 0
        }))
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
    unidade,
    buildActionables,
    buildRoi,
    buildQualityReport,
    computeNotificationsForUnidade,
    stockDistribution,
    buildResumoEstoque,
    d1,
}) {
    const listInsumos = async (unidadeQ, opts = {}) => {
        if (!d1?.enabled) throw new Error('D1_ONLY');
        if (opts?.lite && typeof d1.listInsumosLite === 'function') {
            return d1.listInsumosLite({ unidade: unidadeQ });
        }
        return d1.listInsumos({ unidade: unidadeQ });
    };

    const listMovimentos = async ({ unidadeQ, fromIso, toIso }) => {
        if (!d1?.enabled) throw new Error('D1_ONLY');
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
    };

    if (url.pathname === "/analytics/overview" && request.method === "GET") {
        try {
            const unidadeQ = url.searchParams.get('unidade') || unidade;
            const limitIssues = url.searchParams.get('limitIssues') || '120';
            const lite = String(url.searchParams.get('lite') || '').trim().toLowerCase();
            const isLite = lite === '1' || lite === 'true' || lite === 'yes';
            const { from, to, days } = resolveWindow(url, 30);

            const [insumos, movAgg] = await Promise.all([
                listInsumos(unidadeQ, { lite: isLite }),
                listMovimentosAggregated({
                    env,
                    unidadeQ,
                    fromIso: from ? from.toISOString() : null,
                    toIso: to ? to.toISOString() : null,
                    groupBy: 'day'
                }),
            ]);

            const resumo = buildResumoEstoque(insumos);
            const notifications = computeNotificationsForUnidade(insumos, unidadeQ);
            const actionables = buildActionables(insumos, unidadeQ);
            const roi = buildRoi(insumos, unidadeQ);
            const quality = buildQualityReport(insumos, unidadeQ, limitIssues);
            const movementData = (() => {
                const buckets = movAgg?.buckets || [];
                const totals = movAgg?.totals || { entradaQtd: 0, saidaQtd: 0, entradaValor: 0, saidaValor: 0 };
                const series = buckets.slice(-Math.max(1, days)).map((b) => ({
                    day: String(b.bucket || ''),
                    entrada: Number(b.entradaQtd) || 0,
                    saida: Number(b.saidaQtd) || 0,
                    entradaValor: Number(b.entradaValor) || 0,
                    saidaValor: Number(b.saidaValor) || 0
                }));
                return {
                    movResumo: {
                        entradaQtd: totals.entradaQtd,
                        saidaQtd: totals.saidaQtd,
                        entradaValor: totals.entradaValor,
                        saidaValor: totals.saidaValor,
                        saldoLiquido: totals.entradaValor - totals.saidaValor
                    },
                    movSeries: series
                };
            })();

            const data = {
                resumo,
                ...(isLite ? {} : { itens: insumos }),
                notifications,
                actionables,
                roi,
                quality,
                ...movementData,
                window: {
                    from: from ? from.toISOString() : null,
                    to: to ? to.toISOString() : null,
                    days
                }
            };
            return withCORS(JSON.stringify({ success: true, data }), { status: 200 }, appOrigin);
        } catch (err) {
            return withCORS(JSON.stringify({ success: false, error: err.message }), { status: 500 }, appOrigin);
        }
    }

    if (url.pathname === "/analytics/insights" && request.method === "GET") {
        try {
            const unidadeQ = url.searchParams.get('unidade') || unidade;
            const groupBy = (url.searchParams.get('groupBy') || 'day').toLowerCase();
            const group = groupBy === 'week' || groupBy === 'month' ? groupBy : 'day';
            const { from, to, days } = resolveWindow(url, 30);

            const fromIso = from ? from.toISOString() : null;
            const toIso = to ? to.toISOString() : null;
            const [insumos, movAgg, turnoverSaida, turnoverEntrada] = await Promise.all([
                listInsumos(unidadeQ),
                listMovimentosAggregated({
                    env,
                    unidadeQ,
                    fromIso,
                    toIso,
                    groupBy: group
                }),
                listCategoryTurnoverAggregated({ env, unidadeQ, fromIso, toIso, mode: 'saida' }),
                listCategoryTurnoverAggregated({ env, unidadeQ, fromIso, toIso, mode: 'entrada' }),
            ]);
            const trends = trendsFromBuckets({ buckets: movAgg.buckets, totals: movAgg.totals, unidadeQ, groupBy: group, from, to });

            const data = {
                alertas: buildStockAlerts(insumos),
                trends,
                turnover: {
                    saida: turnoverSaida,
                    entrada: turnoverEntrada
                },
                window: {
                    from: from ? from.toISOString() : null,
                    to: to ? to.toISOString() : null,
                    days,
                    groupBy: group
                }
            };
            return withCORS(JSON.stringify({ success: true, data }), { status: 200 }, appOrigin);
        } catch (err) {
            return withCORS(JSON.stringify({ success: false, error: err.message }), { status: 500 }, appOrigin);
        }
    }

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
            const groupBy = (url.searchParams.get('groupBy') || 'day').toLowerCase();
            const group = groupBy === 'week' || groupBy === 'month' ? groupBy : 'day';
            const { from, to } = resolveWindow(url, 30);

            const movAgg = await listMovimentosAggregated({
                env,
                unidadeQ: unidade,
                fromIso: from ? from.toISOString() : null,
                toIso: to ? to.toISOString() : null,
                groupBy: group
            });
            const data = trendsFromBuckets({ buckets: movAgg.buckets, totals: movAgg.totals, unidadeQ: unidade, groupBy: group, from, to });
            return withCORS(JSON.stringify({ success: true, data }), { status: 200 }, appOrigin);
        } catch (err) {
            return withCORS(JSON.stringify({ success: false, error: err.message }), { status: 500 }, appOrigin);
        }
    }
    if (url.pathname === "/analytics/category-turnover") {
        try {
            const { from, to } = resolveWindow(url, 30);
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

            const data = await listCategoryTurnoverAggregated({
                env,
                unidadeQ: unidade,
                fromIso: from ? from.toISOString() : null,
                toIso: to ? to.toISOString() : null,
                mode
            });
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
            const alertas = buildStockAlerts(insumos);
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
