// @ts-nocheck
// Export/QR/Notifications routes extracted from the main worker router.

export async function handleExportsRoutes({
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
    readSheet,
    ensureHeaderColumns,
    parseMovimentacoes,
    normalizeInsumos,
    parseInsumos,
    computeNotificationsForUnidade,
    safeJson,
    toCsv,
    qrSvg,
    d1,
}) {
    // GET /qr?text=...
    if (url.pathname === "/qr" && request.method === "GET") {
        const text = (url.searchParams.get('text') || '').toString();
        if (!text) {
            return withCORS(JSON.stringify({ success: false, error: 'Parâmetro text é obrigatório' }), { status: 400 }, appOrigin);
        }
        const svg = qrSvg(text);
        return withCORS(svg, { status: 200, headers: { 'content-type': 'image/svg+xml; charset=utf-8' } }, appOrigin);
    }

    // GET /notifications/summary
    if (url.pathname === "/notifications/summary" && request.method === "GET") {
        try {
            const unidadeQ = url.searchParams.get('unidade') || unidade;
            if (env.DB) {
                const row = await env.DB.prepare(
                    'SELECT ts, payload_json FROM notification_snapshot WHERE unidade = ? ORDER BY ts DESC LIMIT 1'
                )
                    .bind(unidadeQ)
                    .first();
                if (row?.payload_json) {
                    const payload = JSON.parse(row.payload_json);
                    return withCORS(JSON.stringify({ success: true, data: payload }), { status: 200 }, appOrigin);
                }
            }

            let insumos;
            if (d1?.enabled) {
                insumos = await d1.listInsumos({ unidade: unidadeQ });
            } else {
                const rows = await readSheet(spreadsheetId, sheetRange, accessToken);
                insumos = normalizeInsumos(parseInsumos(rows), unidadeQ);
            }
            const data = computeNotificationsForUnidade(insumos, unidadeQ);
            try {
                if (env.DB) {
                    await env.DB.prepare(
                        `INSERT INTO notification_snapshot (ts, unidade, low_stock, expiring_soon, expired_with_stock, payload_json)
                         VALUES (?, ?, ?, ?, ?, ?)`
                    )
                        .bind(
                            data.generatedAt,
                            unidadeQ,
                            data.counts.lowStock,
                            data.counts.expiringSoon,
                            data.counts.expiredWithStock,
                            safeJson(data)
                        )
                        .run();
                }
            } catch {
                // ignore
            }
            return withCORS(JSON.stringify({ success: true, data }), { status: 200 }, appOrigin);
        } catch (err) {
            return withCORS(JSON.stringify({ success: false, error: err.message }), { status: 500 }, appOrigin);
        }
    }

    // GET /export/insumos.csv
    if (url.pathname === "/export/insumos.csv" && request.method === "GET") {
        try {
            const unidadeQ = url.searchParams.get('unidade') || unidade;
            let insumos;
            if (d1?.enabled) {
                insumos = await d1.listInsumos({ unidade: unidadeQ });
            } else {
                const rows = await readSheet(spreadsheetId, sheetRange, accessToken);
                insumos = normalizeInsumos(parseInsumos(rows), unidadeQ);
            }
            const headers = [
                'registro',
                'codigoBarras',
                'produto',
                'categoria',
                'marca',
                'estoqueAtual',
                'estoqueMinimo',
                'tipoUnidade',
                'precoCusto',
                'valorTotal',
                'dataValidade',
                'lote',
                'unidade',
            ];
            const dataRows = insumos.map((i) => [
                i.registro,
                i.codigoBarras,
                i.produto,
                i.categoria,
                i.marca,
                i.estoqueAtual,
                i.estoqueMinimo,
                i.tipoUnidade,
                i.precoCusto,
                (Number(i.precoCusto) || 0) * (Number(i.estoqueAtual) || 0),
                i.dataValidade,
                i.lote,
                unidadeQ,
            ]);
            const csv = toCsv(headers, dataRows);
            return withCORS(
                csv,
                {
                    status: 200,
                    headers: {
                        'content-type': 'text/csv; charset=utf-8',
                        'content-disposition': `attachment; filename=\"insumos-${unidadeQ}.csv\"`,
                    },
                },
                appOrigin
            );
        } catch (err) {
            return withCORS(JSON.stringify({ success: false, error: err.message }), { status: 500 }, appOrigin);
        }
    }

    // GET /export/movimentacoes.csv
    if (url.pathname === "/export/movimentacoes.csv" && request.method === "GET") {
        try {
            const tipo = url.searchParams.get('tipo');
            const de = url.searchParams.get('de');
            const ate = url.searchParams.get('ate');
            const filtroUnidade = url.searchParams.get('unidade');
            const filtroUser = url.searchParams.get('usuario');
            const filtroCodigo = url.searchParams.get('codigoBarras');

            let movimentos = [];
            if (d1?.enabled) {
                if (!env?.DB) throw new Error('DB_NOT_CONFIGURED');
                const where = [];
                const binds = [];

                if (tipo) {
                    where.push('UPPER(tipo) = ?');
                    binds.push(String(tipo).toUpperCase().replace('Í', 'I'));
                }
                if (filtroUnidade) {
                    where.push('unidade = ?');
                    binds.push(String(filtroUnidade));
                }
                if (filtroUser) {
                    where.push('usuario = ?');
                    binds.push(String(filtroUser));
                }
                if (filtroCodigo) {
                    where.push('codigo_barras = ?');
                    binds.push(String(filtroCodigo).trim());
                }
                if (de) {
                    where.push('data_hora >= ?');
                    binds.push(`${String(de)}T00:00:00.000Z`);
                }
                if (ate) {
                    where.push('data_hora <= ?');
                    binds.push(`${String(ate)}T23:59:59.999Z`);
                }

                const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
                const rows = await env.DB.prepare(
                    `SELECT data_hora as dataHora, tipo, codigo_barras as codigoBarras, produto, quantidade,
                            estoque_anterior as estoqueAnterior, estoque_novo as estoqueNovo, unidade, usuario, observacoes
                     FROM insumos_movements
                     ${whereSql}
                     ORDER BY data_hora DESC
                     LIMIT 50000`
                )
                    .bind(...binds)
                    .all();
                movimentos = rows?.results || [];
            } else {
                await ensureHeaderColumns({
                    spreadsheetId,
                    sheetName: movimentacoesSheetName,
                    accessToken,
                    requiredHeaders: ['UNIDADE'],
                });
                const raw = await readSheet(spreadsheetId, movimentacoesRange, accessToken);
                movimentos = parseMovimentacoes(raw);

                if (tipo) {
                    movimentos = movimentos.filter((m) => String(m.tipo).toUpperCase() === String(tipo).toUpperCase());
                }
                if (filtroUnidade) {
                    movimentos = movimentos.filter((m) => (m.unidade || '') === filtroUnidade);
                }
                if (filtroUser) {
                    movimentos = movimentos.filter((m) => (m.usuario || '') === filtroUser);
                }
                if (filtroCodigo) {
                    movimentos = movimentos.filter(
                        (m) => String(m.codigoBarras || '').trim() === String(filtroCodigo).trim()
                    );
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
            }

            const headers = [
                'dataHora',
                'tipo',
                'codigoBarras',
                'produto',
                'quantidade',
                'estoqueAnterior',
                'estoqueNovo',
                'unidade',
                'usuario',
                'observacoes',
            ];
            const dataRows = movimentos.map((m) => [
                m.dataHora,
                m.tipo,
                m.codigoBarras,
                m.produto,
                m.quantidade,
                m.estoqueAnterior,
                m.estoqueNovo,
                m.unidade,
                m.usuario,
                m.observacoes,
            ]);
            const csv = toCsv(headers, dataRows);
            return withCORS(
                csv,
                {
                    status: 200,
                    headers: {
                        'content-type': 'text/csv; charset=utf-8',
                        'content-disposition': 'attachment; filename="movimentacoes.csv"',
                    },
                },
                appOrigin
            );
        } catch (err) {
            return withCORS(JSON.stringify({ success: false, error: err.message }), { status: 500 }, appOrigin);
        }
    }

    return null;
}
