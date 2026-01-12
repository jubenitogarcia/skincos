// @ts-nocheck

export async function handleInsumosRoutes({
    request,
    url,
    env,
    ctx,
    appOrigin,
    withCORS,
    spreadsheetId,
    accessToken,
    unidade,

    insumosSheetName,
    sheetRange,

    movimentacoesSheetName,
    movimentacoesRange,

    UNIDADES,

    readSheet,
    writeSheet,
    batchUpdate,
    deleteRows,

    ensureHeaderColumns,
    getHeaderMap,
    getInsumosUnidadeHeaderKey,
    ensureRowLength,
    setIfPresent,
    toA1Col,

    parseInsumos,
    normalizeInsumos,

    nextRegistroFromValues,
    requireRoles,
    appendAuditLog,
    enqueueNotificationsRefresh,

    ip,
    userAgent,
    idempotencyKey,

    qrSvg,
}) {
    // GET /insumos/headers
    if (url.pathname === "/insumos/headers" && request.method === "GET") {
        const values = await readSheet(spreadsheetId, `${insumosSheetName}!A1:Z1`, accessToken);
        const headers = (values?.[0] || []).filter((h) => String(h || '').trim() !== '');
        return withCORS(JSON.stringify({ success: true, data: headers }), { status: 200 }, appOrigin);
    }

    // POST /insumos/entrada
    if (url.pathname === "/insumos/entrada" && request.method === "POST") {
        try {
            const auth = await requireRoles(['ADMIN', 'GESTOR', 'GERENTE', 'OPERADOR']);
            if (!auth.ok) return auth.response;

            const body = await request.json().catch(() => ({}));
            const codigo = (body.codigoBarras || '').toString().trim();
            const quantidade = Math.max(1, parseInt(body.quantidade, 10) || 0);
            const usuario = (body.usuario || auth.user.username || '').toString();
            const observacoes = (body.observacoes || '').toString();
            if (!codigo || !quantidade) {
                return withCORS(JSON.stringify({ success: false, error: "Código e quantidade são obrigatórios" }), { status: 400 }, appOrigin);
            }

            const values = await readSheet(spreadsheetId, sheetRange, accessToken);
            const headers = values[0] || [];
            const headerMap = getHeaderMap(headers);
            const codeIdx = headerMap['código'];
            if (codeIdx === undefined) {
                return withCORS(JSON.stringify({ success: false, error: "Coluna CÓDIGO não encontrada" }), { status: 500 }, appOrigin);
            }
            const rowIndex = values.slice(1).findIndex((r) => ((r?.[codeIdx] || '').toString().trim() === codigo));
            if (rowIndex === -1) {
                return withCORS(JSON.stringify({ success: false, error: "Insumo não encontrado" }), { status: 404 }, appOrigin);
            }

            const unidadeKey = getInsumosUnidadeHeaderKey(unidade);
            const stockIdx = headerMap[unidadeKey];
            if (stockIdx === undefined) {
                return withCORS(JSON.stringify({ success: false, error: "Coluna de estoque da unidade não encontrada" }), { status: 500 }, appOrigin);
            }

            const absoluteRowNumber = rowIndex + 2;
            const beforeRow = ensureRowLength(values[rowIndex + 1], headers.length);
            const currentRow = [...beforeRow];
            const estoqueAnterior = parseInt(currentRow[stockIdx], 10) || 0;
            const novoEstoque = estoqueAnterior + quantidade;
            currentRow[stockIdx] = String(novoEstoque);
            setIfPresent(currentRow, headerMap, 'data atualização', new Date().toISOString());

            const range = `${insumosSheetName}!A${absoluteRowNumber}:${toA1Col(headers.length - 1)}${absoluteRowNumber}`;
            await batchUpdate(spreadsheetId, [{ range, values: [currentRow] }], accessToken);

            // Append movement
            await ensureHeaderColumns({
                spreadsheetId,
                sheetName: movimentacoesSheetName,
                accessToken,
                requiredHeaders: ['UNIDADE']
            });
            const movValues = await readSheet(spreadsheetId, `${movimentacoesSheetName}!A1:Z1`, accessToken);
            const movHeaders = movValues[0] || [];
            const movMap = getHeaderMap(movHeaders);
            const movRow = ensureRowLength([], movHeaders.length);
            setIfPresent(movRow, movMap, 'id movimentação', crypto.randomUUID());
            setIfPresent(movRow, movMap, 'data/hora', new Date().toISOString());
            setIfPresent(movRow, movMap, 'tipo', 'ENTRADA');
            setIfPresent(movRow, movMap, 'código de barras', codigo);
            setIfPresent(movRow, movMap, 'produto', (headerMap['produto'] !== undefined ? currentRow[headerMap['produto']] : '') || '');
            setIfPresent(movRow, movMap, 'quantidade', quantidade);
            setIfPresent(movRow, movMap, 'estoque anterior', estoqueAnterior);
            setIfPresent(movRow, movMap, 'estoque novo', novoEstoque);
            setIfPresent(movRow, movMap, 'unidade', unidade);
            setIfPresent(movRow, movMap, 'usuário', usuario);
            setIfPresent(movRow, movMap, 'observações', observacoes);
            await writeSheet(spreadsheetId, movimentacoesRange, [movRow], accessToken, 'APPEND');

            await appendAuditLog({
                env,
                spreadsheetId,
                accessToken,
                actor: auth.user.username,
                role: auth.user.role,
                ip,
                userAgent,
                idempotencyKey,
                action: 'ENTRADA',
                entity: 'INSUMO',
                entityId: codigo,
                unidade,
                before: { estoqueAnterior, row: beforeRow },
                after: { quantidade, novoEstoque, row: currentRow }
            });

            ctx.waitUntil(enqueueNotificationsRefresh(env, unidade));
            return withCORS(JSON.stringify({ success: true, estoqueAnterior, novoEstoque }), { status: 200 }, appOrigin);
        } catch (err) {
            return withCORS(JSON.stringify({ success: false, error: err.message }), { status: 500 }, appOrigin);
        }
    }

    // POST /insumos/baixa
    if (url.pathname === "/insumos/baixa" && request.method === "POST") {
        try {
            const auth = await requireRoles(['ADMIN', 'GESTOR', 'GERENTE', 'OPERADOR']);
            if (!auth.ok) return auth.response;

            const body = await request.json().catch(() => ({}));
            const codigo = (body.codigoBarras || '').toString().trim();
            const quantidade = Math.max(1, parseInt(body.quantidade, 10) || 0);
            const usuario = (body.usuario || auth.user.username || '').toString();
            const observacoes = (body.observacoes || '').toString();
            if (!codigo || !quantidade) {
                return withCORS(JSON.stringify({ success: false, error: "Código e quantidade são obrigatórios" }), { status: 400 }, appOrigin);
            }

            const values = await readSheet(spreadsheetId, sheetRange, accessToken);
            const headers = values[0] || [];
            const headerMap = getHeaderMap(headers);
            const codeIdx = headerMap['código'];
            if (codeIdx === undefined) {
                return withCORS(JSON.stringify({ success: false, error: "Coluna CÓDIGO não encontrada" }), { status: 500 }, appOrigin);
            }
            const rowIndex = values.slice(1).findIndex((r) => ((r?.[codeIdx] || '').toString().trim() === codigo));
            if (rowIndex === -1) {
                return withCORS(JSON.stringify({ success: false, error: "Insumo não encontrado" }), { status: 404 }, appOrigin);
            }

            const unidadeKey = getInsumosUnidadeHeaderKey(unidade);
            const stockIdx = headerMap[unidadeKey];
            if (stockIdx === undefined) {
                return withCORS(JSON.stringify({ success: false, error: "Coluna de estoque da unidade não encontrada" }), { status: 500 }, appOrigin);
            }

            const absoluteRowNumber = rowIndex + 2;
            const beforeRow = ensureRowLength(values[rowIndex + 1], headers.length);
            const currentRow = [...beforeRow];
            const estoqueAnterior = parseInt(currentRow[stockIdx], 10) || 0;
            if (quantidade > estoqueAnterior) {
                return withCORS(JSON.stringify({ success: false, error: "Estoque insuficiente" }), { status: 400 }, appOrigin);
            }
            const novoEstoque = estoqueAnterior - quantidade;
            currentRow[stockIdx] = String(novoEstoque);
            setIfPresent(currentRow, headerMap, 'data atualização', new Date().toISOString());

            const range = `${insumosSheetName}!A${absoluteRowNumber}:${toA1Col(headers.length - 1)}${absoluteRowNumber}`;
            await batchUpdate(spreadsheetId, [{ range, values: [currentRow] }], accessToken);

            // Append movement
            await ensureHeaderColumns({
                spreadsheetId,
                sheetName: movimentacoesSheetName,
                accessToken,
                requiredHeaders: ['UNIDADE']
            });
            const movValues = await readSheet(spreadsheetId, `${movimentacoesSheetName}!A1:Z1`, accessToken);
            const movHeaders = movValues[0] || [];
            const movMap = getHeaderMap(movHeaders);
            const movRow = ensureRowLength([], movHeaders.length);
            setIfPresent(movRow, movMap, 'id movimentação', crypto.randomUUID());
            setIfPresent(movRow, movMap, 'data/hora', new Date().toISOString());
            setIfPresent(movRow, movMap, 'tipo', 'SAÍDA');
            setIfPresent(movRow, movMap, 'código de barras', codigo);
            setIfPresent(movRow, movMap, 'produto', (headerMap['produto'] !== undefined ? currentRow[headerMap['produto']] : '') || '');
            setIfPresent(movRow, movMap, 'quantidade', quantidade);
            setIfPresent(movRow, movMap, 'estoque anterior', estoqueAnterior);
            setIfPresent(movRow, movMap, 'estoque novo', novoEstoque);
            setIfPresent(movRow, movMap, 'unidade', unidade);
            setIfPresent(movRow, movMap, 'usuário', usuario);
            setIfPresent(movRow, movMap, 'observações', observacoes);
            await writeSheet(spreadsheetId, movimentacoesRange, [movRow], accessToken, 'APPEND');

            const estoqueMinimoIdx = headerMap['estoque mínimo'];
            const estoqueMinimo = estoqueMinimoIdx === undefined ? 0 : (parseInt(currentRow[estoqueMinimoIdx], 10) || 0);
            const alerta = estoqueMinimo > 0 && novoEstoque <= estoqueMinimo
                ? `Estoque abaixo do mínimo (${novoEstoque}/${estoqueMinimo})`
                : null;

            await appendAuditLog({
                env,
                spreadsheetId,
                accessToken,
                actor: auth.user.username,
                role: auth.user.role,
                ip,
                userAgent,
                idempotencyKey,
                action: 'BAIXA',
                entity: 'INSUMO',
                entityId: codigo,
                unidade,
                before: { estoqueAnterior, row: beforeRow },
                after: { quantidade, novoEstoque, alerta, row: currentRow }
            });

            ctx.waitUntil(enqueueNotificationsRefresh(env, unidade));
            return withCORS(JSON.stringify({ success: true, estoqueAnterior, novoEstoque, alerta }), { status: 200 }, appOrigin);
        } catch (err) {
            return withCORS(JSON.stringify({ success: false, error: err.message }), { status: 500 }, appOrigin);
        }
    }

    // POST /insumos/ajuste
    if (url.pathname === "/insumos/ajuste" && request.method === "POST") {
        try {
            const auth = await requireRoles(['ADMIN', 'GESTOR', 'GERENTE']);
            if (!auth.ok) return auth.response;

            const body = await request.json().catch(() => ({}));
            const codigo = (body.codigoBarras || '').toString().trim();
            const novoEstoque = Number.isFinite(Number(body.novoEstoque)) ? Number(body.novoEstoque) : parseInt(body.novoEstoque, 10);
            const motivo = (body.motivo || '').toString().trim();
            const observacoes = (body.observacoes || '').toString();
            const usuario = (body.usuario || auth.user.username || '').toString();

            if (!codigo) {
                return withCORS(JSON.stringify({ success: false, error: "Código é obrigatório" }), { status: 400 }, appOrigin);
            }
            if (!motivo) {
                return withCORS(JSON.stringify({ success: false, error: "Motivo é obrigatório para ajuste" }), { status: 400 }, appOrigin);
            }
            if (!Number.isFinite(Number(novoEstoque)) || Number(novoEstoque) < 0) {
                return withCORS(JSON.stringify({ success: false, error: "novoEstoque inválido" }), { status: 400 }, appOrigin);
            }

            const values = await readSheet(spreadsheetId, sheetRange, accessToken);
            const headers = values[0] || [];
            const headerMap = getHeaderMap(headers);
            const codeIdx = headerMap['código'];
            if (codeIdx === undefined) {
                return withCORS(JSON.stringify({ success: false, error: "Coluna CÓDIGO não encontrada" }), { status: 500 }, appOrigin);
            }
            const rowIndex = values.slice(1).findIndex((r) => ((r?.[codeIdx] || '').toString().trim() === codigo));
            if (rowIndex === -1) {
                return withCORS(JSON.stringify({ success: false, error: "Insumo não encontrado" }), { status: 404 }, appOrigin);
            }

            const unidadeKey = getInsumosUnidadeHeaderKey(unidade);
            const stockIdx = headerMap[unidadeKey];
            if (stockIdx === undefined) {
                return withCORS(JSON.stringify({ success: false, error: "Coluna de estoque da unidade não encontrada" }), { status: 500 }, appOrigin);
            }

            const absoluteRowNumber = rowIndex + 2;
            const beforeRow = ensureRowLength(values[rowIndex + 1], headers.length);
            const currentRow = [...beforeRow];
            const estoqueAnterior = parseInt(currentRow[stockIdx], 10) || 0;
            const estoqueNovo = Number(novoEstoque) || 0;
            currentRow[stockIdx] = String(estoqueNovo);
            setIfPresent(currentRow, headerMap, 'data atualização', new Date().toISOString());

            const range = `${insumosSheetName}!A${absoluteRowNumber}:${toA1Col(headers.length - 1)}${absoluteRowNumber}`;
            await batchUpdate(spreadsheetId, [{ range, values: [currentRow] }], accessToken);

            // Append movement
            await ensureHeaderColumns({
                spreadsheetId,
                sheetName: movimentacoesSheetName,
                accessToken,
                requiredHeaders: ['UNIDADE', 'MOTIVO']
            });
            const movValues = await readSheet(spreadsheetId, `${movimentacoesSheetName}!A1:Z1`, accessToken);
            const movHeaders = movValues[0] || [];
            const movMap = getHeaderMap(movHeaders);
            const movRow = ensureRowLength([], movHeaders.length);

            const diff = Math.abs((Number(estoqueNovo) || 0) - (Number(estoqueAnterior) || 0));
            setIfPresent(movRow, movMap, 'id movimentação', crypto.randomUUID());
            setIfPresent(movRow, movMap, 'data/hora', new Date().toISOString());
            setIfPresent(movRow, movMap, 'tipo', 'AJUSTE');
            setIfPresent(movRow, movMap, 'código de barras', codigo);
            setIfPresent(movRow, movMap, 'produto', (headerMap['produto'] !== undefined ? currentRow[headerMap['produto']] : '') || '');
            setIfPresent(movRow, movMap, 'quantidade', diff);
            setIfPresent(movRow, movMap, 'estoque anterior', estoqueAnterior);
            setIfPresent(movRow, movMap, 'estoque novo', estoqueNovo);
            setIfPresent(movRow, movMap, 'unidade', unidade);
            setIfPresent(movRow, movMap, 'usuário', usuario);
            setIfPresent(movRow, movMap, 'motivo', motivo);
            setIfPresent(movRow, movMap, 'observações', observacoes);
            await writeSheet(spreadsheetId, movimentacoesRange, [movRow], accessToken, 'APPEND');

            await appendAuditLog({
                env,
                spreadsheetId,
                accessToken,
                actor: auth.user.username,
                role: auth.user.role,
                ip,
                userAgent,
                idempotencyKey,
                action: 'AJUSTE',
                entity: 'MOVIMENTACAO',
                entityId: codigo,
                unidade,
                before: { estoqueAnterior, row: beforeRow },
                after: { motivo, observacoes, estoqueNovo, diff, row: currentRow }
            });

            ctx.waitUntil(enqueueNotificationsRefresh(env, unidade));
            return withCORS(JSON.stringify({ success: true, estoqueAnterior, novoEstoque: estoqueNovo }), { status: 200 }, appOrigin);
        } catch (err) {
            return withCORS(JSON.stringify({ success: false, error: err.message }), { status: 500 }, appOrigin);
        }
    }

    // POST /insumos/transferir
    if (url.pathname === "/insumos/transferir" && request.method === "POST") {
        try {
            const auth = await requireRoles(['ADMIN', 'GESTOR', 'GERENTE', 'OPERADOR']);
            if (!auth.ok) return auth.response;

            const body = await request.json().catch(() => ({}));
            const codigo = (body.codigoBarras || '').toString().trim();
            const quantidade = Math.max(1, parseInt(body.quantidade, 10) || 0);
            const fromUnidade = (body.fromUnidade || '').toString().trim() || unidade;
            const toUnidade = (body.toUnidade || '').toString().trim();
            const observacoes = (body.observacoes || '').toString();
            const usuario = auth.user.username || '';

            if (!codigo || !toUnidade) {
                return withCORS(JSON.stringify({ success: false, error: "Código e unidade destino são obrigatórios" }), { status: 400 }, appOrigin);
            }
            if (fromUnidade === toUnidade) {
                return withCORS(JSON.stringify({ success: false, error: "Unidades devem ser diferentes" }), { status: 400 }, appOrigin);
            }
            if (!UNIDADES.includes(fromUnidade) || !UNIDADES.includes(toUnidade)) {
                return withCORS(JSON.stringify({ success: false, error: "Unidade inválida" }), { status: 400 }, appOrigin);
            }

            const values = await readSheet(spreadsheetId, sheetRange, accessToken);
            const headers = values[0] || [];
            const headerMap = getHeaderMap(headers);
            const codeIdx = headerMap['código'];
            if (codeIdx === undefined) {
                return withCORS(JSON.stringify({ success: false, error: "Coluna CÓDIGO não encontrada" }), { status: 500 }, appOrigin);
            }
            const rowIndex = values.slice(1).findIndex((r) => ((r?.[codeIdx] || '').toString().trim() === codigo));
            if (rowIndex === -1) {
                return withCORS(JSON.stringify({ success: false, error: "Insumo não encontrado" }), { status: 404 }, appOrigin);
            }

            const fromKey = getInsumosUnidadeHeaderKey(fromUnidade);
            const toKey = getInsumosUnidadeHeaderKey(toUnidade);
            const fromIdx = headerMap[fromKey];
            const toIdx = headerMap[toKey];
            if (fromIdx === undefined || toIdx === undefined) {
                return withCORS(JSON.stringify({ success: false, error: "Colunas de estoque das unidades não encontradas" }), { status: 500 }, appOrigin);
            }

            const absoluteRowNumber = rowIndex + 2;
            const beforeRow = ensureRowLength(values[rowIndex + 1], headers.length);
            const currentRow = [...beforeRow];
            const estoqueOrigemAntes = parseInt(currentRow[fromIdx], 10) || 0;
            const estoqueDestinoAntes = parseInt(currentRow[toIdx], 10) || 0;
            if (quantidade > estoqueOrigemAntes) {
                return withCORS(JSON.stringify({ success: false, error: "Estoque insuficiente na origem" }), { status: 400 }, appOrigin);
            }
            const estoqueOrigemDepois = estoqueOrigemAntes - quantidade;
            const estoqueDestinoDepois = estoqueDestinoAntes + quantidade;
            currentRow[fromIdx] = String(estoqueOrigemDepois);
            currentRow[toIdx] = String(estoqueDestinoDepois);
            setIfPresent(currentRow, headerMap, 'data atualização', new Date().toISOString());

            const range = `${insumosSheetName}!A${absoluteRowNumber}:${toA1Col(headers.length - 1)}${absoluteRowNumber}`;
            await batchUpdate(spreadsheetId, [{ range, values: [currentRow] }], accessToken);

            // Movimentações: saída na origem + entrada no destino (para refletir nos gráficos)
            await ensureHeaderColumns({
                spreadsheetId,
                sheetName: movimentacoesSheetName,
                accessToken,
                requiredHeaders: ['UNIDADE']
            });
            const movValues = await readSheet(spreadsheetId, `${movimentacoesSheetName}!A1:Z1`, accessToken);
            const movHeaders = movValues[0] || [];
            const movMap = getHeaderMap(movHeaders);
            const produtoNome = (headerMap['produto'] !== undefined ? currentRow[headerMap['produto']] : '') || '';

            const movOut = ensureRowLength([], movHeaders.length);
            setIfPresent(movOut, movMap, 'id movimentação', crypto.randomUUID());
            setIfPresent(movOut, movMap, 'data/hora', new Date().toISOString());
            setIfPresent(movOut, movMap, 'tipo', 'SAÍDA');
            setIfPresent(movOut, movMap, 'código de barras', codigo);
            setIfPresent(movOut, movMap, 'produto', produtoNome);
            setIfPresent(movOut, movMap, 'quantidade', quantidade);
            setIfPresent(movOut, movMap, 'estoque anterior', estoqueOrigemAntes);
            setIfPresent(movOut, movMap, 'estoque novo', estoqueOrigemDepois);
            setIfPresent(movOut, movMap, 'unidade', fromUnidade);
            setIfPresent(movOut, movMap, 'usuário', usuario);
            setIfPresent(movOut, movMap, 'observações', `Transferência para ${toUnidade}${observacoes ? ` • ${observacoes}` : ''}`);

            const movIn = ensureRowLength([], movHeaders.length);
            setIfPresent(movIn, movMap, 'id movimentação', crypto.randomUUID());
            setIfPresent(movIn, movMap, 'data/hora', new Date().toISOString());
            setIfPresent(movIn, movMap, 'tipo', 'ENTRADA');
            setIfPresent(movIn, movMap, 'código de barras', codigo);
            setIfPresent(movIn, movMap, 'produto', produtoNome);
            setIfPresent(movIn, movMap, 'quantidade', quantidade);
            setIfPresent(movIn, movMap, 'estoque anterior', estoqueDestinoAntes);
            setIfPresent(movIn, movMap, 'estoque novo', estoqueDestinoDepois);
            setIfPresent(movIn, movMap, 'unidade', toUnidade);
            setIfPresent(movIn, movMap, 'usuário', usuario);
            setIfPresent(movIn, movMap, 'observações', `Transferência de ${fromUnidade}${observacoes ? ` • ${observacoes}` : ''}`);

            await writeSheet(spreadsheetId, movimentacoesRange, [movOut, movIn], accessToken, 'APPEND');

            await appendAuditLog({
                env,
                spreadsheetId,
                accessToken,
                actor: auth.user.username,
                role: auth.user.role,
                ip,
                userAgent,
                idempotencyKey,
                action: 'TRANSFERIR',
                entity: 'INSUMO',
                entityId: codigo,
                unidade: toUnidade,
                before: { fromUnidade, toUnidade, estoqueOrigemAntes, estoqueDestinoAntes, row: beforeRow },
                after: { quantidade, estoqueOrigemDepois, estoqueDestinoDepois, row: currentRow }
            });

            ctx.waitUntil(enqueueNotificationsRefresh(env, fromUnidade));
            ctx.waitUntil(enqueueNotificationsRefresh(env, toUnidade));
            return withCORS(JSON.stringify({ success: true }), { status: 200 }, appOrigin);
        } catch (err) {
            return withCORS(JSON.stringify({ success: false, error: err.message }), { status: 500 }, appOrigin);
        }
    }

    // GET /insumos/:codigoBarras - buscar por código de barras (CÓDIGO)
    if (url.pathname.startsWith("/insumos/") && request.method === "GET") {
        const parts = url.pathname.split('/').filter(Boolean);
        const maybeCodigo = parts[1];
        if (parts.length === 3 && parts[2] === 'qr') {
            try {
                const codigo = decodeURIComponent(maybeCodigo).trim();
                if (!codigo) {
                    return withCORS(JSON.stringify({ success: false, error: 'Código inválido' }), { status: 400 }, appOrigin);
                }
                const svg = qrSvg(`INSUMO:${codigo}`);
                return withCORS(svg, { status: 200, headers: { 'content-type': 'image/svg+xml; charset=utf-8' } }, appOrigin);
            } catch (err) {
                return withCORS(JSON.stringify({ success: false, error: err.message }), { status: 500 }, appOrigin);
            }
        }
        if (parts.length === 2 && maybeCodigo && !['headers', 'entrada', 'baixa'].includes(maybeCodigo)) {
            try {
                const codigo = decodeURIComponent(maybeCodigo).trim();
                const rows = await readSheet(spreadsheetId, sheetRange, accessToken);
                const insumos = normalizeInsumos(parseInsumos(rows), unidade);
                const found = insumos.find((i) => String(i.codigoBarras).trim() === codigo);
                if (!found) {
                    return withCORS(JSON.stringify({ success: false, error: "Insumo não encontrado" }), { status: 404 }, appOrigin);
                }
                return withCORS(JSON.stringify({ success: true, data: found }), { status: 200 }, appOrigin);
            } catch (err) {
                return withCORS(JSON.stringify({ success: false, error: err.message }), { status: 500 }, appOrigin);
            }
        }
    }

    // GET /insumos - lista insumos
    if (url.pathname === "/insumos" && request.method === "GET") {
        try {
            const rows = await readSheet(spreadsheetId, sheetRange, accessToken);
            const insumos = normalizeInsumos(parseInsumos(rows), unidade);
            return withCORS(JSON.stringify({ success: true, data: insumos }), { status: 200 }, appOrigin);
        } catch (err) {
            return withCORS(JSON.stringify({ success: false, error: err.message }), { status: 500 }, appOrigin);
        }
    }

    // POST /insumos - cadastrar novo insumo (mapeia payload do frontend -> colunas da planilha)
    if (url.pathname === "/insumos" && request.method === "POST") {
        try {
            const auth = await requireRoles(['ADMIN', 'GESTOR', 'GERENTE']);
            if (!auth.ok) return auth.response;

            const body = await request.json().catch(() => ({}));
            const values = await readSheet(spreadsheetId, sheetRange, accessToken);
            if (!values || values.length === 0) {
                throw new Error("Sheet is empty or headers missing");
            }
            const headers = values[0] || [];
            const headerMap = getHeaderMap(headers);

            const registroIdx = headerMap['registro'];
            const codigoIdx = headerMap['código'];
            if (registroIdx === undefined || codigoIdx === undefined) {
                throw new Error("Headers REGISTRO/CÓDIGO não encontrados");
            }

            const codigoBarras = (body.codigoBarras || '').toString().trim();
            if (!codigoBarras) return withCORS(JSON.stringify({ success: false, error: "Código de barras é obrigatório" }), { status: 400 }, appOrigin);

            const exists = values.slice(1).some((r) => ((r?.[codigoIdx] || '').toString().trim() === codigoBarras));
            if (exists) return withCORS(JSON.stringify({ success: false, error: "Código de barras já cadastrado" }), { status: 409 }, appOrigin);

            const newRow = ensureRowLength([], headers.length);
            const registro = nextRegistroFromValues(values, registroIdx);
            const now = new Date().toISOString();

            setIfPresent(newRow, headerMap, 'registro', registro);
            setIfPresent(newRow, headerMap, 'código', codigoBarras);
            setIfPresent(newRow, headerMap, 'categoria', body.categoria || '');
            setIfPresent(newRow, headerMap, 'marca', body.marca || '');
            setIfPresent(newRow, headerMap, 'produto', body.produto || '');
            setIfPresent(newRow, headerMap, 'especificação', body.especificacao || '');
            setIfPresent(newRow, headerMap, 'concentração', body.concentracao || '');
            setIfPresent(newRow, headerMap, 'volume', body.volume || '');
            setIfPresent(newRow, headerMap, 'unidade', body.unidade || body.tipoUnidade || '');
            setIfPresent(newRow, headerMap, 'preço', body.precoCusto ?? '');
            setIfPresent(newRow, headerMap, 'fonte', body.fonte || '');
            setIfPresent(newRow, headerMap, 'estoque mínimo', Number(body.estoqueMinimo) || 0);
            setIfPresent(newRow, headerMap, 'lote', body.lote || '');
            setIfPresent(newRow, headerMap, 'data validade', body.dataValidade || '');
            setIfPresent(newRow, headerMap, 'data cadastro', now);
            setIfPresent(newRow, headerMap, 'data atualização', now);

            const estoqueInicial = Number(body.estoqueInicial) || 0;
            const estoqueKey = getInsumosUnidadeHeaderKey(unidade);
            setIfPresent(newRow, headerMap, 'novo hamburgo', estoqueKey === 'novo hamburgo' ? estoqueInicial : 0);
            setIfPresent(newRow, headerMap, 'barrashoppingsul', estoqueKey === 'barrashoppingsul' ? estoqueInicial : 0);

            await writeSheet(spreadsheetId, sheetRange, [newRow], accessToken, 'APPEND');

            await appendAuditLog({
                env,
                spreadsheetId,
                accessToken,
                actor: auth.user.username,
                role: auth.user.role,
                ip,
                userAgent,
                idempotencyKey,
                action: 'CREATE',
                entity: 'INSUMO',
                entityId: codigoBarras,
                unidade,
                before: null,
                after: { registro, codigoBarras, payload: body }
            });

            ctx.waitUntil(enqueueNotificationsRefresh(env, unidade));
            return withCORS(JSON.stringify({ success: true, message: "Insumo cadastrado", data: { registro } }), { status: 201 }, appOrigin);
        } catch (err) {
            return withCORS(JSON.stringify({ success: false, error: err.message }), { status: 500 }, appOrigin);
        }
    }

    // PUT /insumos/:registro - atualizar por REGISTRO da planilha
    if (url.pathname.startsWith("/insumos/") && request.method === "PUT") {
        try {
            const auth = await requireRoles(['ADMIN', 'GESTOR', 'GERENTE']);
            if (!auth.ok) return auth.response;

            const registro = decodeURIComponent(url.pathname.split('/')[2] || '').trim();
            if (!registro) return withCORS(JSON.stringify({ success: false, error: "Registro inválido" }), { status: 400 }, appOrigin);

            const body = await request.json().catch(() => ({}));
            const values = await readSheet(spreadsheetId, sheetRange, accessToken);
            const headers = values[0] || [];
            const headerMap = getHeaderMap(headers);
            const registroIdx = headerMap['registro'];
            if (registroIdx === undefined) throw new Error("Coluna REGISTRO não encontrada");

            const rowIndex = values.slice(1).findIndex((r) => ((r?.[registroIdx] || '').toString().trim() === registro));
            if (rowIndex === -1) return withCORS(JSON.stringify({ success: false, error: "Registro não encontrado" }), { status: 404 }, appOrigin);

            const absoluteRowNumber = rowIndex + 2;
            const beforeRow = ensureRowLength(values[rowIndex + 1], headers.length);
            const currentRow = [...beforeRow];
            const now = new Date().toISOString();

            if (body.codigoBarras !== undefined) setIfPresent(currentRow, headerMap, 'código', body.codigoBarras);
            if (body.categoria !== undefined) setIfPresent(currentRow, headerMap, 'categoria', body.categoria);
            if (body.marca !== undefined) setIfPresent(currentRow, headerMap, 'marca', body.marca);
            if (body.produto !== undefined) setIfPresent(currentRow, headerMap, 'produto', body.produto);
            if (body.especificacao !== undefined) setIfPresent(currentRow, headerMap, 'especificação', body.especificacao);
            if (body.concentracao !== undefined) setIfPresent(currentRow, headerMap, 'concentração', body.concentracao);
            if (body.volume !== undefined) setIfPresent(currentRow, headerMap, 'volume', body.volume);
            if (body.tipoUnidade !== undefined) setIfPresent(currentRow, headerMap, 'unidade', body.tipoUnidade);
            if (body.unidade !== undefined) setIfPresent(currentRow, headerMap, 'unidade', body.unidade);
            if (body.precoCusto !== undefined) setIfPresent(currentRow, headerMap, 'preço', body.precoCusto);
            if (body.fonte !== undefined) setIfPresent(currentRow, headerMap, 'fonte', body.fonte);
            if (body.estoqueMinimo !== undefined) setIfPresent(currentRow, headerMap, 'estoque mínimo', Number(body.estoqueMinimo) || 0);
            if (body.lote !== undefined) setIfPresent(currentRow, headerMap, 'lote', body.lote);
            if (body.dataValidade !== undefined) setIfPresent(currentRow, headerMap, 'data validade', body.dataValidade);
            setIfPresent(currentRow, headerMap, 'data atualização', now);

            const range = `${insumosSheetName}!A${absoluteRowNumber}:${toA1Col(headers.length - 1)}${absoluteRowNumber}`;
            await batchUpdate(spreadsheetId, [{ range, values: [currentRow] }], accessToken);

            await appendAuditLog({
                env,
                spreadsheetId,
                accessToken,
                actor: auth.user.username,
                role: auth.user.role,
                ip,
                userAgent,
                idempotencyKey,
                action: 'UPDATE',
                entity: 'INSUMO',
                entityId: registro,
                unidade,
                before: { row: beforeRow },
                after: { payload: body, row: currentRow }
            });
            ctx.waitUntil(enqueueNotificationsRefresh(env, unidade));
            return withCORS(JSON.stringify({ success: true, message: "Insumo atualizado" }), { status: 200 }, appOrigin);
        } catch (err) {
            return withCORS(JSON.stringify({ success: false, error: err.message }), { status: 500 }, appOrigin);
        }
    }

    // DELETE /insumos/:registro - delete por registro
    if (url.pathname.startsWith("/insumos/") && request.method === "DELETE") {
        try {
            const auth = await requireRoles(['ADMIN', 'GESTOR', 'GERENTE']);
            if (!auth.ok) return auth.response;

            const registro = decodeURIComponent(url.pathname.split('/')[2] || '').trim();
            if (!registro) return withCORS(JSON.stringify({ success: false, error: "Registro inválido" }), { status: 400 }, appOrigin);
            const values = await readSheet(spreadsheetId, sheetRange, accessToken);
            const headers = values[0] || [];
            const headerMap = getHeaderMap(headers);
            const registroIdx = headerMap['registro'];
            if (registroIdx === undefined) throw new Error("Coluna REGISTRO não encontrada");
            const rowIndex = values.slice(1).findIndex((r) => ((r?.[registroIdx] || '').toString().trim() === registro));
            if (rowIndex === -1) return withCORS(JSON.stringify({ success: false, error: "Registro não encontrado" }), { status: 404 }, appOrigin);

            const sheetId = parseInt(env.SHEET_ID || '1511948550');
            const absoluteRowNumber = rowIndex + 2;
            const beforeRow = ensureRowLength(values[rowIndex + 1], headers.length);
            await deleteRows(spreadsheetId, sheetId, absoluteRowNumber - 1, absoluteRowNumber, accessToken);

            await appendAuditLog({
                env,
                spreadsheetId,
                accessToken,
                actor: auth.user.username,
                role: auth.user.role,
                ip,
                userAgent,
                idempotencyKey,
                action: 'DELETE',
                entity: 'INSUMO',
                entityId: registro,
                unidade,
                before: { row: beforeRow },
                after: null
            });

            ctx.waitUntil(enqueueNotificationsRefresh(env, unidade));
            return withCORS(JSON.stringify({ success: true, message: "Insumo removido" }), { status: 200 }, appOrigin);
        } catch (err) {
            return withCORS(JSON.stringify({ success: false, error: err.message }), { status: 500 }, appOrigin);
        }
    }

    return null;
}
