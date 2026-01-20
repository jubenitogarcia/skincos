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
    getInsumosUnidadeHeaderKeys,
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

    d1,
}) {
    if (d1?.enabled) {
        // GET /insumos
        if (url.pathname === "/insumos" && request.method === "GET") {
            try {
                const q = url.searchParams.get('q') || url.searchParams.get('query') || '';
                const pagina = url.searchParams.get('pagina') || url.searchParams.get('page') || null;
                const limite = url.searchParams.get('limite') || url.searchParams.get('limit') || null;
                const shouldPage = (pagina !== null && pagina !== '') || (limite !== null && limite !== '') || String(q || '').trim();

                if (shouldPage && typeof d1.listInsumosPaged === 'function') {
                    const out = await d1.listInsumosPaged({ unidade, q, pagina, limite });
                    return withCORS(JSON.stringify({ success: true, data: out.items, resumo: out.resumo }), { status: 200 }, appOrigin);
                }

                const items = await d1.listInsumos({ unidade });
                return withCORS(JSON.stringify({ success: true, data: items }), { status: 200 }, appOrigin);
            } catch (err) {
                return withCORS(JSON.stringify({ success: false, error: err.message }), { status: 500 }, appOrigin);
            }
        }

        // POST /insumos - cadastrar novo insumo/lote
        if (url.pathname === "/insumos" && request.method === "POST") {
            try {
                const auth = await requireRoles(['ADMIN', 'GESTOR', 'GERENTE']);
                if (!auth.ok) return auth.response;

                const body = await request.json().catch(() => ({}));

                const out = await d1.createInsumo({ unidade, body });
                if (!out.ok) {
                    return withCORS(JSON.stringify({ success: false, error: out.error }), { status: out.status || 400 }, appOrigin);
                }

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
                    entityId: out.registro,
                    unidade,
                    before: null,
                    after: { registro: out.registro, payload: body }
                });

                ctx.waitUntil(enqueueNotificationsRefresh(env, unidade));
                return withCORS(JSON.stringify({ success: true, message: "Insumo cadastrado", data: { registro: out.registro } }), { status: 201 }, appOrigin);
            } catch (err) {
                return withCORS(JSON.stringify({ success: false, error: err.message }), { status: 500 }, appOrigin);
            }
        }

        // PUT /insumos/:registro
        if (url.pathname.startsWith("/insumos/") && request.method === "PUT") {
            try {
                const auth = await requireRoles(['ADMIN', 'GESTOR', 'GERENTE']);
                if (!auth.ok) return auth.response;

                const registro = decodeURIComponent(url.pathname.split('/')[2] || '').trim();
                if (!registro) return withCORS(JSON.stringify({ success: false, error: "Registro inválido" }), { status: 400 }, appOrigin);

                const body = await request.json().catch(() => ({}));
                const out = await d1.updateInsumo({ registro, body });
                if (!out.ok) return withCORS(JSON.stringify({ success: false, error: out.error }), { status: out.status || 400 }, appOrigin);

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
                    before: null,
                    after: { payload: body }
                });

                ctx.waitUntil(enqueueNotificationsRefresh(env, unidade));
                return withCORS(JSON.stringify({ success: true, message: "Insumo atualizado" }), { status: 200 }, appOrigin);
            } catch (err) {
                return withCORS(JSON.stringify({ success: false, error: err.message }), { status: 500 }, appOrigin);
            }
        }

        // DELETE /insumos/:registro
        if (url.pathname.startsWith("/insumos/") && request.method === "DELETE") {
            try {
                const auth = await requireRoles(['ADMIN', 'GESTOR', 'GERENTE']);
                if (!auth.ok) return auth.response;

                const registro = decodeURIComponent(url.pathname.split('/')[2] || '').trim();
                const out = await d1.deleteInsumo({ registro });
                if (!out.ok) return withCORS(JSON.stringify({ success: false, error: out.error }), { status: out.status || 400 }, appOrigin);

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
                    before: null,
                    after: null
                });
                ctx.waitUntil(enqueueNotificationsRefresh(env, unidade));
                return withCORS(JSON.stringify({ success: true, message: "Insumo removido" }), { status: 200 }, appOrigin);
            } catch (err) {
                return withCORS(JSON.stringify({ success: false, error: err.message }), { status: 500 }, appOrigin);
            }
        }

        // POST /insumos/entrada
        if (url.pathname === "/insumos/entrada" && request.method === "POST") {
            try {
                const auth = await requireRoles(['ADMIN', 'GESTOR', 'GERENTE', 'OPERADOR']);
                if (!auth.ok) return auth.response;
                const body = await request.json().catch(() => ({}));
                const out = await d1.entradaBaixa({ unidade, body, kind: 'ENTRADA' });
                if (!out.ok) return withCORS(JSON.stringify({ success: false, error: out.error, code: out.code, registros: out.registros || [] }), { status: out.status || 400 }, appOrigin);

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
                    entityId: `${body?.codigoBarras || ''}:${out.registro}`,
                    unidade,
                    before: { estoqueAnterior: out.estoqueAnterior },
                    after: { quantidade: body?.quantidade, novoEstoque: out.novoEstoque, registro: out.registro }
                });
                ctx.waitUntil(enqueueNotificationsRefresh(env, unidade));
                return withCORS(JSON.stringify({ success: true, estoqueAnterior: out.estoqueAnterior, novoEstoque: out.novoEstoque }), { status: 200 }, appOrigin);
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
                const out = await d1.entradaBaixa({ unidade, body, kind: 'BAIXA' });
                if (!out.ok) return withCORS(JSON.stringify({ success: false, error: out.error, code: out.code, registros: out.registros || [] }), { status: out.status || 400 }, appOrigin);

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
                    entityId: `${body?.codigoBarras || ''}:${out.registro}`,
                    unidade,
                    before: { estoqueAnterior: out.estoqueAnterior },
                    after: { quantidade: body?.quantidade, novoEstoque: out.novoEstoque, registro: out.registro }
                });
                ctx.waitUntil(enqueueNotificationsRefresh(env, unidade));
                return withCORS(JSON.stringify({ success: true, estoqueAnterior: out.estoqueAnterior, novoEstoque: out.novoEstoque }), { status: 200 }, appOrigin);
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
                const out = await d1.transfer({ body });
                if (!out.ok) return withCORS(JSON.stringify({ success: false, error: out.error, code: out.code, registros: out.registros || [] }), { status: out.status || 400 }, appOrigin);

                await appendAuditLog({
                    env,
                    spreadsheetId,
                    accessToken,
                    actor: auth.user.username,
                    role: auth.user.role,
                    ip,
                    userAgent,
                    idempotencyKey,
                    action: 'TRANSFERENCIA',
                    entity: 'INSUMO',
                    entityId: `${body?.codigoBarras || ''}:${out.registro}`,
                    unidade: body?.fromUnidade || unidade,
                    before: null,
                    after: { transferId: out.transferId, quantidade: body?.quantidade, registro: out.registro, from: body?.fromUnidade, to: body?.toUnidade }
                });
                ctx.waitUntil(enqueueNotificationsRefresh(env, body?.fromUnidade || unidade));
                ctx.waitUntil(enqueueNotificationsRefresh(env, body?.toUnidade || unidade));
                return withCORS(JSON.stringify({
                    success: true,
                    transferId: out.transferId,
                    estoqueAnteriorOrigem: out.estoqueAnteriorOrigem,
                    estoqueNovoOrigem: out.estoqueNovoOrigem,
                    estoqueAnteriorDestino: out.estoqueAnteriorDestino,
                    estoqueNovoDestino: out.estoqueNovoDestino,
                }), { status: 200 }, appOrigin);
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
                const out = await d1.ajuste({ unidade, body });
                if (!out.ok) return withCORS(JSON.stringify({ success: false, error: out.error, code: out.code, registros: out.registros || [] }), { status: out.status || 400 }, appOrigin);

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
                    entityId: `${body?.codigoBarras || ''}:${out.registro}`,
                    unidade,
                    before: { estoqueAnterior: out.estoqueAnterior },
                    after: { motivo: body?.motivo, novoEstoque: out.novoEstoque, registro: out.registro }
                });
                ctx.waitUntil(enqueueNotificationsRefresh(env, unidade));
                return withCORS(JSON.stringify({ success: true, estoqueAnterior: out.estoqueAnterior, novoEstoque: out.novoEstoque }), { status: 200 }, appOrigin);
            } catch (err) {
                return withCORS(JSON.stringify({ success: false, error: err.message }), { status: 500 }, appOrigin);
            }
        }

        return null;
    }

    const resolveStockIndex = (headerMap, unit) => {
        const candidates = (typeof getInsumosUnidadeHeaderKeys === 'function' ? getInsumosUnidadeHeaderKeys(unit) : []) || [];
        const raw = String(unit || '').trim().toLowerCase();
        const withSpaces = raw.replace(/-/g, ' ');
        const expanded = [withSpaces, raw.replace(/-/g, ''), withSpaces.replace(/\s+/g, '')];
        const keys = Array.from(new Set([...candidates, ...expanded].filter(Boolean)));
        for (const k of keys) {
            const idx = headerMap[k];
            if (idx !== undefined) return { key: k, idx };
        }
        return { key: keys[0] || '', idx: undefined };
    };

    const findInsumoRowIndex = ({ values, headerMap, codigo, registro }) => {
        const registroIdx = headerMap['registro'];
        const codigoIdx = headerMap['código'];
        if (codigoIdx === undefined) {
            return { ok: false, error: 'Coluna CÓDIGO não encontrada', code: 'HEADERS_MISSING' };
        }

        const normCodigo = (codigo || '').toString().trim();
        const normRegistro = (registro || '').toString().trim();

        if (normRegistro && registroIdx !== undefined) {
            const idx = values.slice(1).findIndex((r) => ((r?.[registroIdx] || '').toString().trim() === normRegistro));
            if (idx === -1) return { ok: false, error: 'Registro não encontrado', code: 'NOT_FOUND' };
            const row = values[idx + 1] || [];
            const rowCodigo = (row?.[codigoIdx] || '').toString().trim();
            if (normCodigo && rowCodigo && rowCodigo !== normCodigo) {
                return { ok: false, error: 'Registro não corresponde ao código informado', code: 'MISMATCH' };
            }
            return { ok: true, rowIndex: idx };
        }

        const matches = values
            .slice(1)
            .map((r, idx) => ({ r, idx }))
            .filter(({ r }) => ((r?.[codigoIdx] || '').toString().trim() === normCodigo));

        if (!matches.length) return { ok: false, error: 'Insumo não encontrado', code: 'NOT_FOUND' };
        if (matches.length > 1) {
            return {
                ok: false,
                error: 'Código possui múltiplos registros (lotes). Informe o registro.',
                code: 'AMBIGUOUS',
                registros: matches
                    .map(({ r }) => (registroIdx !== undefined ? (r?.[registroIdx] || '').toString().trim() : ''))
                    .filter(Boolean)
            };
        }
        return { ok: true, rowIndex: matches[0].idx };
    };

    const safeParseJson = (raw) => {
        try {
            if (!raw) return null;
            return JSON.parse(raw);
        } catch {
            return null;
        }
    };

	    const maybeReplayIdempotency = async ({ action, entity, entityId }) => {
	        if (!idempotencyKey) return null;
	        if (!env?.DB) return null;
	        try {
	            const row = await env.DB.prepare(
	                `SELECT before_json, after_json
	                 FROM audit_log
	                 WHERE idempotency_key = ?
	                   AND action = ?
	                   AND entity = ?
	                   AND entity_id = ?
	                 ORDER BY id DESC
	                 LIMIT 1`
	            )
	                .bind(String(idempotencyKey), String(action || ''), String(entity || ''), String(entityId || ''))
	                .first();
	            if (!row) return null;
	            const before = safeParseJson(row.before_json);
	            const after = safeParseJson(row.after_json);
	            // Best-effort: return a shape compatible with the route response.
	            const out = { success: true, replay: true, idempotencyKey: String(idempotencyKey) };
	            if (action === 'ENTRADA') {
	                return withCORS(JSON.stringify({ ...out, estoqueAnterior: before?.estoqueAnterior ?? null, novoEstoque: after?.novoEstoque ?? null }), { status: 200 }, appOrigin);
	            }
	            if (action === 'BAIXA') {
	                return withCORS(JSON.stringify({ ...out, estoqueAnterior: before?.estoqueAnterior ?? null, novoEstoque: after?.novoEstoque ?? null, alerta: after?.alerta ?? null }), { status: 200 }, appOrigin);
	            }
	            if (action === 'AJUSTE') {
	                return withCORS(JSON.stringify({ ...out, estoqueAnterior: before?.estoqueAnterior ?? null, novoEstoque: after?.estoqueNovo ?? after?.novoEstoque ?? null }), { status: 200 }, appOrigin);
	            }
	            if (action === 'TRANSFERENCIA') {
	                return withCORS(JSON.stringify({
	                    ...out,
	                    transferId: after?.transferId ?? null,
	                    estoqueAnteriorOrigem: before?.estoqueAnteriorOrigem ?? null,
	                    estoqueNovoOrigem: after?.estoqueNovoOrigem ?? null,
	                    estoqueAnteriorDestino: before?.estoqueAnteriorDestino ?? null,
	                    estoqueNovoDestino: after?.estoqueNovoDestino ?? null,
	                }), { status: 200 }, appOrigin);
	            }
	            if (action === 'CREATE') {
	                return withCORS(
	                    JSON.stringify({ ...out, message: 'Insumo cadastrado', data: { registro: after?.registro ?? null } }),
	                    { status: 201 },
	                    appOrigin
	                );
	            }
	            if (action === 'UPDATE') {
	                return withCORS(JSON.stringify({ ...out, message: 'Insumo atualizado' }), { status: 200 }, appOrigin);
	            }
	            if (action === 'DELETE') {
	                return withCORS(JSON.stringify({ ...out, message: 'Insumo removido' }), { status: 200 }, appOrigin);
	            }
	        } catch {
	            return null;
	        }
	        return null;
	    };

    // GET /insumos/headers
    if (url.pathname === "/insumos/headers" && request.method === "GET") {
        const values = await readSheet(spreadsheetId, `${insumosSheetName}!1:1`, accessToken);
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
            const registro = (body.registro || '').toString().trim();
            const quantidade = Math.max(1, parseInt(body.quantidade, 10) || 0);
            const usuario = (body.usuario || auth.user.username || '').toString();
            const observacoes = (body.observacoes || '').toString();
            if (!codigo || !quantidade) {
                return withCORS(JSON.stringify({ success: false, error: "Código e quantidade são obrigatórios" }), { status: 400 }, appOrigin);
            }

            const replay = await maybeReplayIdempotency({ action: 'ENTRADA', entity: 'INSUMO', entityId: codigo });
            if (replay) return replay;

            const values = await readSheet(spreadsheetId, sheetRange, accessToken);
            const headers = values[0] || [];
            const headerMap = getHeaderMap(headers);
            const found = findInsumoRowIndex({ values, headerMap, codigo, registro });
            if (!found.ok) {
                const status = found.code === 'NOT_FOUND' ? 404 : found.code === 'AMBIGUOUS' ? 409 : 400;
                return withCORS(JSON.stringify({ success: false, error: found.error, code: found.code, registros: found.registros || [] }), { status }, appOrigin);
            }
            const rowIndex = found.rowIndex;

            const { idx: stockIdx } = resolveStockIndex(headerMap, unidade);
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
                requiredHeaders: ['UNIDADE', 'REGISTRO INSUMO', 'LOTE', 'DATA VALIDADE']
            });
            const movValues = await readSheet(spreadsheetId, `${movimentacoesSheetName}!1:1`, accessToken);
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
            setIfPresent(movRow, movMap, 'registro insumo', (headerMap['registro'] !== undefined ? currentRow[headerMap['registro']] : '') || '');
            setIfPresent(movRow, movMap, 'lote', (headerMap['lote'] !== undefined ? currentRow[headerMap['lote']] : '') || '');
            setIfPresent(movRow, movMap, 'data validade', (headerMap['data validade'] !== undefined ? currentRow[headerMap['data validade']] : '') || '');
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
            const registro = (body.registro || '').toString().trim();
            const quantidade = Math.max(1, parseInt(body.quantidade, 10) || 0);
            const usuario = (body.usuario || auth.user.username || '').toString();
            const observacoes = (body.observacoes || '').toString();
            if (!codigo || !quantidade) {
                return withCORS(JSON.stringify({ success: false, error: "Código e quantidade são obrigatórios" }), { status: 400 }, appOrigin);
            }

            const replay = await maybeReplayIdempotency({ action: 'BAIXA', entity: 'INSUMO', entityId: codigo });
            if (replay) return replay;

            const values = await readSheet(spreadsheetId, sheetRange, accessToken);
            const headers = values[0] || [];
            const headerMap = getHeaderMap(headers);
            const found = findInsumoRowIndex({ values, headerMap, codigo, registro });
            if (!found.ok) {
                const status = found.code === 'NOT_FOUND' ? 404 : found.code === 'AMBIGUOUS' ? 409 : 400;
                return withCORS(JSON.stringify({ success: false, error: found.error, code: found.code, registros: found.registros || [] }), { status }, appOrigin);
            }
            const rowIndex = found.rowIndex;

            const { idx: stockIdx } = resolveStockIndex(headerMap, unidade);
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
                requiredHeaders: ['UNIDADE', 'REGISTRO INSUMO', 'LOTE', 'DATA VALIDADE']
            });
            const movValues = await readSheet(spreadsheetId, `${movimentacoesSheetName}!1:1`, accessToken);
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
            setIfPresent(movRow, movMap, 'registro insumo', (headerMap['registro'] !== undefined ? currentRow[headerMap['registro']] : '') || '');
            setIfPresent(movRow, movMap, 'lote', (headerMap['lote'] !== undefined ? currentRow[headerMap['lote']] : '') || '');
            setIfPresent(movRow, movMap, 'data validade', (headerMap['data validade'] !== undefined ? currentRow[headerMap['data validade']] : '') || '');
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

    // POST /insumos/transferir
    if (url.pathname === "/insumos/transferir" && request.method === "POST") {
        try {
            const auth = await requireRoles(['ADMIN', 'GESTOR', 'GERENTE', 'OPERADOR']);
            if (!auth.ok) return auth.response;

            const body = await request.json().catch(() => ({}));
            const codigo = (body.codigoBarras || '').toString().trim();
            const registro = (body.registro || '').toString().trim();
            const quantidade = Math.max(1, parseInt(body.quantidade, 10) || 0);
            const fromUnidade = (body.fromUnidade || body.unidadeOrigem || body.from || '').toString().trim();
            const toUnidade = (body.toUnidade || body.unidadeDestino || body.to || '').toString().trim();
            const usuario = (body.usuario || auth.user.username || '').toString();
            const observacoes = (body.observacoes || '').toString();

            if (!codigo || !quantidade) {
                return withCORS(JSON.stringify({ success: false, error: "Código e quantidade são obrigatórios" }), { status: 400 }, appOrigin);
            }
            if (!fromUnidade || !toUnidade) {
                return withCORS(JSON.stringify({ success: false, error: "Unidade origem e destino são obrigatórias" }), { status: 400 }, appOrigin);
            }
            if (fromUnidade === toUnidade) {
                return withCORS(JSON.stringify({ success: false, error: "Origem e destino devem ser diferentes" }), { status: 400 }, appOrigin);
            }
            if (!UNIDADES.includes(fromUnidade) || !UNIDADES.includes(toUnidade)) {
                return withCORS(JSON.stringify({ success: false, error: "Unidade inválida" }), { status: 400 }, appOrigin);
            }

            const roleUpper = String(auth?.user?.role || '').toUpperCase();
            const allowedUnits = Array.isArray(auth?.user?.allowedUnits) ? auth.user.allowedUnits.filter(Boolean) : [];
            const hasUnitAccess = (u) => roleUpper === 'ADMIN' || allowedUnits.length === 0 || allowedUnits.includes(u);
	            if (!hasUnitAccess(fromUnidade) || !hasUnitAccess(toUnidade)) {
	                return withCORS(
	                    JSON.stringify({ success: false, error: 'Sem permissão para unidade', code: 'RBAC_UNIT_DENIED', allowedUnits }),
	                    { status: 403 },
	                    appOrigin
	                );
	            }

	            const replayEntityId = registro ? `${codigo}:${registro}` : codigo;
	            const replay = await maybeReplayIdempotency({ action: 'TRANSFERENCIA', entity: 'INSUMO', entityId: replayEntityId });
	            if (replay) return replay;

	            const values = await readSheet(spreadsheetId, sheetRange, accessToken);
	            const headers = values[0] || [];
	            const headerMap = getHeaderMap(headers);
	            const found = findInsumoRowIndex({ values, headerMap, codigo, registro });
	            if (!found.ok) {
	                const status = found.code === 'NOT_FOUND' ? 404 : found.code === 'AMBIGUOUS' ? 409 : 400;
	                return withCORS(JSON.stringify({ success: false, error: found.error, code: found.code, registros: found.registros || [] }), { status }, appOrigin);
	            }
	            const rowIndex = found.rowIndex;

            const { idx: fromIdx } = resolveStockIndex(headerMap, fromUnidade);
            const { idx: toIdx } = resolveStockIndex(headerMap, toUnidade);
            if (fromIdx === undefined || toIdx === undefined) {
                return withCORS(JSON.stringify({ success: false, error: "Coluna de estoque da unidade não encontrada" }), { status: 500 }, appOrigin);
            }

            const absoluteRowNumber = rowIndex + 2;
            const beforeRow = ensureRowLength(values[rowIndex + 1], headers.length);
            const currentRow = [...beforeRow];

            const estoqueAnteriorOrigem = parseInt(currentRow[fromIdx], 10) || 0;
            const estoqueAnteriorDestino = parseInt(currentRow[toIdx], 10) || 0;
            if (quantidade > estoqueAnteriorOrigem) {
                return withCORS(JSON.stringify({ success: false, error: "Estoque insuficiente" }), { status: 400 }, appOrigin);
            }

            const estoqueNovoOrigem = estoqueAnteriorOrigem - quantidade;
            const estoqueNovoDestino = estoqueAnteriorDestino + quantidade;
            currentRow[fromIdx] = String(estoqueNovoOrigem);
            currentRow[toIdx] = String(estoqueNovoDestino);
            setIfPresent(currentRow, headerMap, 'data atualização', new Date().toISOString());

            const range = `${insumosSheetName}!A${absoluteRowNumber}:${toA1Col(headers.length - 1)}${absoluteRowNumber}`;
            await batchUpdate(spreadsheetId, [{ range, values: [currentRow] }], accessToken);

            // Append movements (SAÍDA origem + ENTRADA destino)
            await ensureHeaderColumns({
                spreadsheetId,
                sheetName: movimentacoesSheetName,
                accessToken,
                requiredHeaders: ['UNIDADE', 'UNIDADE ORIGEM', 'UNIDADE DESTINO', 'ID TRANSFERÊNCIA', 'REGISTRO INSUMO', 'LOTE', 'DATA VALIDADE']
            });
            const movValues = await readSheet(spreadsheetId, `${movimentacoesSheetName}!1:1`, accessToken);
            const movHeaders = movValues[0] || [];
            const movMap = getHeaderMap(movHeaders);

            const transferId = crypto.randomUUID();
            const when = new Date().toISOString();
            const produto = (headerMap['produto'] !== undefined ? currentRow[headerMap['produto']] : '') || '';

            const buildMovRow = (tipo, unidadeRow, estoqueAnterior, estoqueNovo, obsPrefix) => {
                const movRow = ensureRowLength([], movHeaders.length);
                setIfPresent(movRow, movMap, 'id movimentação', crypto.randomUUID());
                setIfPresent(movRow, movMap, 'data/hora', when);
                setIfPresent(movRow, movMap, 'tipo', tipo);
                setIfPresent(movRow, movMap, 'código de barras', codigo);
                setIfPresent(movRow, movMap, 'produto', produto);
                setIfPresent(movRow, movMap, 'quantidade', quantidade);
                setIfPresent(movRow, movMap, 'estoque anterior', estoqueAnterior);
                setIfPresent(movRow, movMap, 'estoque novo', estoqueNovo);
                setIfPresent(movRow, movMap, 'unidade', unidadeRow);
                setIfPresent(movRow, movMap, 'usuário', usuario);
                setIfPresent(movRow, movMap, 'unidade origem', fromUnidade);
                setIfPresent(movRow, movMap, 'unidade destino', toUnidade);
                setIfPresent(movRow, movMap, 'id transferência', transferId);
                setIfPresent(movRow, movMap, 'registro insumo', (headerMap['registro'] !== undefined ? currentRow[headerMap['registro']] : '') || '');
                setIfPresent(movRow, movMap, 'lote', (headerMap['lote'] !== undefined ? currentRow[headerMap['lote']] : '') || '');
                setIfPresent(movRow, movMap, 'data validade', (headerMap['data validade'] !== undefined ? currentRow[headerMap['data validade']] : '') || '');
                const obs = `${obsPrefix}${observacoes ? ` | ${observacoes}` : ''}`;
                setIfPresent(movRow, movMap, 'observações', obs);
                return movRow;
            };

            const saidaRow = buildMovRow('SAÍDA', fromUnidade, estoqueAnteriorOrigem, estoqueNovoOrigem, `Transferência para ${toUnidade}`);
            const entradaRow = buildMovRow('ENTRADA', toUnidade, estoqueAnteriorDestino, estoqueNovoDestino, `Transferência de ${fromUnidade}`);
            await writeSheet(spreadsheetId, movimentacoesRange, [saidaRow, entradaRow], accessToken, 'APPEND');

            await appendAuditLog({
                env,
                spreadsheetId,
                accessToken,
                actor: auth.user.username,
                role: auth.user.role,
                ip,
                userAgent,
                idempotencyKey,
                action: 'TRANSFERENCIA',
                entity: 'INSUMO',
                entityId: replayEntityId,
                unidade: fromUnidade,
                before: { fromUnidade, toUnidade, estoqueAnteriorOrigem, estoqueAnteriorDestino, row: beforeRow },
                after: { registro: (headerMap['registro'] !== undefined ? currentRow[headerMap['registro']] : '') || '', quantidade, transferId, estoqueNovoOrigem, estoqueNovoDestino, row: currentRow }
            });

            ctx.waitUntil(enqueueNotificationsRefresh(env, fromUnidade));
            ctx.waitUntil(enqueueNotificationsRefresh(env, toUnidade));
            return withCORS(JSON.stringify({
                success: true,
                transferId,
                estoqueAnteriorOrigem,
                estoqueNovoOrigem,
                estoqueAnteriorDestino,
                estoqueNovoDestino,
            }), { status: 200 }, appOrigin);
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
            const registro = (body.registro || '').toString().trim();
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

	            const replay = await maybeReplayIdempotency({ action: 'AJUSTE', entity: 'MOVIMENTACAO', entityId: codigo });
	            if (replay) return replay;

	            const values = await readSheet(spreadsheetId, sheetRange, accessToken);
	            const headers = values[0] || [];
	            const headerMap = getHeaderMap(headers);
	            const found = findInsumoRowIndex({ values, headerMap, codigo, registro });
	            if (!found.ok) {
	                const status = found.code === 'NOT_FOUND' ? 404 : found.code === 'AMBIGUOUS' ? 409 : 400;
	                return withCORS(JSON.stringify({ success: false, error: found.error, code: found.code, registros: found.registros || [] }), { status }, appOrigin);
	            }
	            const rowIndex = found.rowIndex;

            const { idx: stockIdx } = resolveStockIndex(headerMap, unidade);
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
                requiredHeaders: ['UNIDADE', 'MOTIVO', 'REGISTRO INSUMO', 'LOTE', 'DATA VALIDADE']
            });
            const movValues = await readSheet(spreadsheetId, `${movimentacoesSheetName}!1:1`, accessToken);
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
            setIfPresent(movRow, movMap, 'registro insumo', (headerMap['registro'] !== undefined ? currentRow[headerMap['registro']] : '') || '');
            setIfPresent(movRow, movMap, 'lote', (headerMap['lote'] !== undefined ? currentRow[headerMap['lote']] : '') || '');
            setIfPresent(movRow, movMap, 'data validade', (headerMap['data validade'] !== undefined ? currentRow[headerMap['data validade']] : '') || '');
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

	            const allowDuplicateLot = body.allowDuplicateLot === true || body.novoLote === true;
	            const lote = (body.lote || '').toString().trim();
	            const replayEntityId = allowDuplicateLot ? `${codigoBarras}:${lote || 'SEM_LOTE'}` : codigoBarras;
	            const replay = await maybeReplayIdempotency({ action: 'CREATE', entity: 'INSUMO', entityId: replayEntityId });
	            if (replay) return replay;

	            if (allowDuplicateLot) {
	                if (!lote) return withCORS(JSON.stringify({ success: false, error: "Lote é obrigatório para cadastrar novo lote" }), { status: 400 }, appOrigin);
	                const loteIdx = headerMap['lote'];
	                if (loteIdx === undefined) {
	                    return withCORS(JSON.stringify({ success: false, error: "Coluna LOTE não encontrada" }), { status: 500 }, appOrigin);
	                }
	                const existsSameLot = values
	                    .slice(1)
	                    .some((r) => ((r?.[codigoIdx] || '').toString().trim() === codigoBarras) && ((r?.[loteIdx] || '').toString().trim() === lote));
	                if (existsSameLot) {
	                    return withCORS(JSON.stringify({ success: false, error: "Lote já cadastrado para este código de barras" }), { status: 409 }, appOrigin);
	                }
	            } else {
	                const exists = values.slice(1).some((r) => ((r?.[codigoIdx] || '').toString().trim() === codigoBarras));
	                if (exists) return withCORS(JSON.stringify({ success: false, error: "Código de barras já cadastrado" }), { status: 409 }, appOrigin);
	            }

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
            setIfPresent(newRow, headerMap, 'calibre', body.calibre || '');
            setIfPresent(newRow, headerMap, 'calibre / bitola', body.calibre || '');
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
            const { key: estoqueKey } = resolveStockIndex(headerMap, unidade);
            if (estoqueKey) setIfPresent(newRow, headerMap, estoqueKey, estoqueInicial);

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
	                entityId: replayEntityId,
	                unidade,
	                before: null,
	                after: { registro, codigoBarras, lote, allowDuplicateLot, payload: body }
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

	            const replay = await maybeReplayIdempotency({ action: 'UPDATE', entity: 'INSUMO', entityId: registro });
	            if (replay) return replay;

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
            if (body.calibre !== undefined) {
                setIfPresent(currentRow, headerMap, 'calibre', body.calibre);
                setIfPresent(currentRow, headerMap, 'calibre / bitola', body.calibre);
            }
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

	            const replay = await maybeReplayIdempotency({ action: 'DELETE', entity: 'INSUMO', entityId: registro });
	            if (replay) return replay;

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
