// @ts-nocheck

export async function handleInsumosRoutes({
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
                const msg = err?.message || String(err || '');
                const lower = String(msg || '').toLowerCase();
                let code = 'UNKNOWN';
                if (lower.includes('sql variables')) code = 'SQL_BIND_LIMIT';
                else if (lower.includes('sqlite') || lower.includes('d1_error')) code = 'D1_ERROR';
                const requestId = request.headers.get('cf-ray') || request.headers.get('x-request-id') || '';
                console.error('[insumos] list error', { code, requestId, error: msg });
                return withCORS(JSON.stringify({ success: false, error: msg, code }), { status: 500 }, appOrigin);
            }
        }

        // POST /insumos/lookup
        if (url.pathname === "/insumos/lookup" && request.method === "POST") {
            try {
                if (typeof d1.listInsumosByCodigos !== 'function') {
                    return withCORS(JSON.stringify({ success: false, error: 'Lookup indisponível', code: 'NOT_IMPLEMENTED' }), { status: 501 }, appOrigin);
                }
                const body = await request.json().catch(() => ({}));
                const raw = body?.codigos ?? body?.codigosBarras ?? body?.barcodes ?? body?.codes ?? [];
                const list = Array.isArray(raw)
                    ? raw.map((v) => String(v || '').trim()).filter(Boolean)
                    : String(raw || '')
                        .split(/[\n,;]+/g)
                        .map((v) => String(v || '').trim())
                        .filter(Boolean);
                const uniq = Array.from(new Set(list));
                const MAX_CODES = 500;
                if (uniq.length > MAX_CODES) {
                    return withCORS(JSON.stringify({ success: false, error: `Limite de ${MAX_CODES} códigos por requisição`, code: 'MAX_CODES' }), { status: 400 }, appOrigin);
                }
                const items = await d1.listInsumosByCodigos({ unidade, codigos: uniq });
                return withCORS(JSON.stringify({ success: true, data: items }), { status: 200 }, appOrigin);
            } catch (err) {
                return withCORS(JSON.stringify({ success: false, error: err.message || String(err || '') }), { status: 500 }, appOrigin);
            }
        }

        // GET /insumos/options
        if (url.pathname === "/insumos/options" && request.method === "GET") {
            try {
                const limite = url.searchParams.get('limite') || url.searchParams.get('limit') || null;
                if (typeof d1.listInsumosOptions === 'function') {
                    const data = await d1.listInsumosOptions({ limite });
                    return withCORS(JSON.stringify({ success: true, data }), { status: 200 }, appOrigin);
                }
                return withCORS(JSON.stringify({ success: true, data: { categorias: [], marcas: [] } }), { status: 200 }, appOrigin);
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

                const command = await d1.executeIdempotent({
                    actor: auth.user,
                    action: 'INSUMO_CREATE',
                    idempotencyKey,
                    command: { unidade, body },
                    execute: () => d1.createInsumo({ unidade, body, actor: auth.user }),
                });
                if (!command.ok) return withCORS(JSON.stringify({ success: false, code: command.code, error: command.error }), { status: command.status || 400 }, appOrigin);
                const out = command.result;
                if (!out.ok) return withCORS(JSON.stringify({ success: false, code: out.code, error: out.error }), { status: out.status || 400 }, appOrigin);

                if (!command.replayed) {
                    await appendAuditLog({
                        env,
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
                        after: { registro: out.registro, payload: body, saldoInicial: body?.estoqueInicial || 0 }
                    });
                    ctx.waitUntil(enqueueNotificationsRefresh(env, unidade));
                }
                return withCORS(JSON.stringify({ success: true, message: "Insumo cadastrado", data: { registro: out.registro }, idempotent: !!command.replayed }), { status: 201 }, appOrigin);
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
                const command = await d1.executeIdempotent({
                    actor: auth.user,
                    action: 'INSUMO_UPDATE',
                    idempotencyKey,
                    command: { registro, unidade, body },
                    execute: () => d1.updateInsumo({ registro, body }),
                });
                if (!command.ok) return withCORS(JSON.stringify({ success: false, code: command.code, error: command.error }), { status: command.status || 400 }, appOrigin);
                const out = command.result;
                if (!out.ok) return withCORS(JSON.stringify({ success: false, code: out.code, error: out.error }), { status: out.status || 400 }, appOrigin);

                if (!command.replayed) {
                    await appendAuditLog({
                        env,
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
                }
                return withCORS(JSON.stringify({ success: true, message: "Insumo atualizado", idempotent: !!command.replayed }), { status: 200 }, appOrigin);
            } catch (err) {
                return withCORS(JSON.stringify({ success: false, error: err.message }), { status: 500 }, appOrigin);
            }
        }

        // DELETE /insumos/:registro
        if (url.pathname.startsWith("/insumos/") && request.method === "DELETE") {
            return withCORS(JSON.stringify({ success: false, code: 'ARCHIVE_REQUIRED', error: 'Exclusão física de insumos é proibida; use o arquivamento' }), { status: 405, headers: { allow: 'GET, PUT, POST' } }, appOrigin);
        }

        // POST /insumos/:registro/arquivar
        if (url.pathname.startsWith("/insumos/") && request.method === "POST" && url.pathname.endsWith('/arquivar')) {
            try {
                const auth = await requireRoles(['ADMIN', 'GESTOR', 'GERENTE']);
                if (!auth.ok) return auth.response;
                const parts = url.pathname.split('/').filter(Boolean);
                const registro = decodeURIComponent(parts[1] || '').trim();
                if (!registro) return withCORS(JSON.stringify({ success: false, code: 'REGISTRO_INVALID', error: 'Registro inválido' }), { status: 400 }, appOrigin);
                const body = await request.json().catch(() => ({}));
                const command = await d1.executeIdempotent({
                    actor: auth.user,
                    action: 'INSUMO_ARCHIVE',
                    idempotencyKey,
                    command: { registro, unidade, body },
                    execute: () => d1.archiveInsumo({ registro }),
                });
                if (!command.ok) return withCORS(JSON.stringify({ success: false, code: command.code, error: command.error }), { status: command.status || 400 }, appOrigin);
                const out = command.result;
                if (!out.ok) return withCORS(JSON.stringify({ success: false, code: out.code, error: out.error }), { status: out.status || 400 }, appOrigin);
                if (!command.replayed) {
                    await appendAuditLog({ env, actor: auth.user.username, role: auth.user.role, ip, userAgent, idempotencyKey, action: 'ARCHIVE', entity: 'INSUMO', entityId: registro, unidade, before: null, after: { archivedAt: out.archivedAt, alreadyArchived: !!out.alreadyArchived } });
                    ctx.waitUntil(enqueueNotificationsRefresh(env, unidade));
                }
                return withCORS(JSON.stringify({ success: true, data: { registro, archivedAt: out.archivedAt }, idempotent: !!command.replayed }), { status: 200 }, appOrigin);
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
                const command = await d1.executeIdempotent({
                    actor: auth.user,
                    action: 'INSUMO_ENTRADA',
                    idempotencyKey,
                    command: { unidade, body },
                    execute: () => d1.entradaBaixa({ unidade, body, kind: 'ENTRADA', actor: auth.user }),
                });
                if (!command.ok) return withCORS(JSON.stringify({ success: false, code: command.code, error: command.error }), { status: command.status || 400 }, appOrigin);
                const out = command.result;
                if (!out.ok) return withCORS(JSON.stringify({ success: false, error: out.error, code: out.code, registros: out.registros || [], candidates: out.candidates || [] }), { status: out.status || 400 }, appOrigin);

                if (!command.replayed) {
                    await appendAuditLog({
                        env,
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
                }
                return withCORS(
                    JSON.stringify({
                        success: true,
                        estoqueAnterior: out.estoqueAnterior,
                        novoEstoque: out.novoEstoque,
                        quebraEstoque: !!out.quebraEstoque,
                        deficit: Number(out.deficit || 0),
                        idempotent: !!command.replayed
                    }),
                    { status: 200 },
                    appOrigin
                );
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
                const command = await d1.executeIdempotent({
                    actor: auth.user,
                    action: 'INSUMO_BAIXA',
                    idempotencyKey,
                    command: { unidade, body },
                    execute: () => d1.entradaBaixa({ unidade, body, kind: 'BAIXA', actor: auth.user }),
                });
                if (!command.ok) return withCORS(JSON.stringify({ success: false, code: command.code, error: command.error }), { status: command.status || 400 }, appOrigin);
                const out = command.result;
                if (!out.ok) return withCORS(JSON.stringify({ success: false, error: out.error, code: out.code, registros: out.registros || [], candidates: out.candidates || [] }), { status: out.status || 400 }, appOrigin);

                if (!command.replayed) {
                    await appendAuditLog({
                        env,
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
                        after: { quantidade: body?.quantidade, novoEstoque: out.novoEstoque, registro: out.registro, negativeOverride: !!out.negativeOverride }
                    });
                    if (out.negativeOverride) {
                        await appendAuditLog({
                            env,
                            actor: auth.user.username,
                            role: auth.user.role,
                            ip,
                            userAgent,
                            idempotencyKey,
                            action: 'NEGATIVE_STOCK_OVERRIDE',
                            entity: 'INSUMO',
                            entityId: `${body?.codigoBarras || ''}:${out.registro}`,
                            unidade,
                            before: { estoqueAnterior: out.estoqueAnterior },
                            after: { saldoResultante: out.novoEstoque, deficit: out.deficit, justificativa: out.negativeJustification }
                        });
                    }
                    ctx.waitUntil(enqueueNotificationsRefresh(env, unidade));
                }
                return withCORS(
                    JSON.stringify({
                        success: true,
                        estoqueAnterior: out.estoqueAnterior,
                        novoEstoque: out.novoEstoque,
                        quebraEstoque: !!out.quebraEstoque,
                        deficit: Number(out.deficit || 0),
                        idempotent: !!command.replayed
                    }),
                    { status: 200 },
                    appOrigin
                );
            } catch (err) {
                return withCORS(JSON.stringify({ success: false, error: err.message }), { status: 500 }, appOrigin);
            }
        }

        // POST /insumos/transferencias/:id/receber|cancelar
        if (url.pathname.startsWith("/insumos/transferencias/") && request.method === "POST") {
            try {
                const parts = url.pathname.split('/').filter(Boolean);
                const transferId = decodeURIComponent(parts[2] || '').trim();
                const action = String(parts[3] || '').trim().toLowerCase();
                if (!transferId || !['receber', 'cancelar'].includes(action)) {
                    return withCORS(JSON.stringify({ success: false, code: 'NOT_FOUND', error: 'Rota de transferência não encontrada' }), { status: 404 }, appOrigin);
                }
                const auth = await requireRoles(['ADMIN', 'GESTOR', 'GERENTE', 'OPERADOR']);
                if (!auth.ok) return auth.response;
                const body = await request.json().catch(() => ({}));
                const isReceipt = action === 'receber';
                const command = await d1.executeIdempotent({
                    actor: auth.user,
                    action: isReceipt ? 'TRANSFER_RECEBIMENTO' : 'TRANSFER_CANCELAMENTO',
                    idempotencyKey,
                    command: { transferId, unidade, body },
                    execute: () => isReceipt
                        ? d1.receberTransferencia({ id: transferId, actor: auth.user, unidade, observacoes: body?.observacoes })
                        : d1.cancelarTransferencia({ id: transferId, actor: auth.user, unidade, justificativa: body?.justificativa || body?.motivo }),
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
                        action: isReceipt ? 'TRANSFER_RECEBIMENTO' : 'TRANSFER_CANCELAMENTO',
                        entity: 'TRANSFERENCIA',
                        entityId: transferId,
                        unidade: unidade || out.unidadeDestino || out.unidadeOrigem,
                        before: { status: isReceipt ? 'PENDING_RECEIPT' : 'PENDING_RECEIPT' },
                        after: { status: out.status, registro: out.registro, motivo: body?.justificativa || body?.motivo || null }
                    });
                    const units = Array.from(new Set([out.unidadeOrigem, out.unidadeDestino].map((value) => String(value || '').trim()).filter(Boolean)));
                    for (const unit of units) ctx.waitUntil(enqueueNotificationsRefresh(env, unit));
                }
                return withCORS(JSON.stringify({ success: true, data: out, idempotent: !!command.replayed }), { status: 200 }, appOrigin);
            } catch (err) {
                return withCORS(JSON.stringify({ success: false, error: err.message || String(err || '') }), { status: 500 }, appOrigin);
            }
        }

        // POST /insumos/transferir
        if (url.pathname === "/insumos/transferir" && request.method === "POST") {
            try {
                const auth = await requireRoles(['ADMIN', 'GESTOR', 'GERENTE', 'OPERADOR']);
                if (!auth.ok) return auth.response;
                const body = await request.json().catch(() => ({}));
                const command = await d1.executeIdempotent({
                    actor: auth.user,
                    action: 'INSUMO_TRANSFERENCIA',
                    idempotencyKey,
                    command: { unidade, body },
                    execute: () => d1.transfer({ body, actor: auth.user, unidade }),
                });
                if (!command.ok) return withCORS(JSON.stringify({ success: false, code: command.code, error: command.error }), { status: command.status || 400 }, appOrigin);
                const out = command.result;
                if (!out.ok) return withCORS(JSON.stringify({ success: false, error: out.error, code: out.code, registros: out.registros || [], candidates: out.candidates || [] }), { status: out.status || 400 }, appOrigin);

                if (!command.replayed) {
                    await appendAuditLog({
                        env,
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
                }
                return withCORS(JSON.stringify({
                    success: true,
                    transferId: out.transferId,
                    dispatchMovementId: out.dispatchMovementId,
                    status: out.status,
                    pendingReceipt: !!out.pendingReceipt,
                    unidadeOrigem: out.unidadeOrigem,
                    unidadeDestino: out.unidadeDestino,
                    estoqueAnteriorOrigem: out.estoqueAnteriorOrigem,
                    estoqueNovoOrigem: out.estoqueNovoOrigem,
                    estoqueAnteriorDestino: out.estoqueAnteriorDestino,
                    estoqueNovoDestino: out.estoqueNovoDestino,
                    quebraEstoqueOrigem: out.quebraEstoqueOrigem,
                    deficitOrigem: out.deficitOrigem,
                    idempotent: !!command.replayed
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
                const command = await d1.executeIdempotent({
                    actor: auth.user,
                    action: 'INSUMO_AJUSTE',
                    idempotencyKey,
                    command: { unidade, body },
                    execute: () => d1.ajuste({ unidade, body, actor: auth.user }),
                });
                if (!command.ok) return withCORS(JSON.stringify({ success: false, code: command.code, error: command.error }), { status: command.status || 400 }, appOrigin);
                const out = command.result;
                if (!out.ok) return withCORS(JSON.stringify({ success: false, error: out.error, code: out.code, registros: out.registros || [], candidates: out.candidates || [] }), { status: out.status || 400 }, appOrigin);

                if (!command.replayed) {
                    await appendAuditLog({
                        env,
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
                }
                return withCORS(JSON.stringify({ success: true, estoqueAnterior: out.estoqueAnterior, novoEstoque: out.novoEstoque, idempotent: !!command.replayed }), { status: 200 }, appOrigin);
            } catch (err) {
                return withCORS(JSON.stringify({ success: false, error: err.message }), { status: 500 }, appOrigin);
            }
        }

        // GET /insumos/:codigoBarras and GET /insumos/:codigoBarras/qr (D1-only convenience)
        if (url.pathname.startsWith("/insumos/") && request.method === "GET") {
            const parts = url.pathname.split('/').filter(Boolean);
            const maybeCodigo = parts[1] ? decodeURIComponent(parts[1]).trim() : '';
            const isReserved = ['entrada', 'baixa', 'ajuste', 'transfer', 'headers'].includes(maybeCodigo);

            if (parts.length === 3 && parts[2] === 'qr') {
                if (!maybeCodigo) {
                    return withCORS(JSON.stringify({ success: false, error: 'Código inválido' }), { status: 400 }, appOrigin);
                }
                const svg = qrSvg(`INSUMO:${maybeCodigo}`);
                return withCORS(svg, { status: 200, headers: { 'content-type': 'image/svg+xml; charset=utf-8' } }, appOrigin);
            }

            if (parts.length === 2 && maybeCodigo && !isReserved) {
                try {
                    const items = await d1.listInsumos({ unidade });
                    const byCodigo = items.filter((i) => {
                        const primary = String(i?.codigoBarras || '').trim();
                        if (primary && primary === maybeCodigo) return true;
                        const list = Array.isArray(i?.codigosBarras) ? i.codigosBarras : [];
                        return list.some((code) => String(code || '').trim() === maybeCodigo);
                    });
                    if (byCodigo.length === 1) {
                        return withCORS(JSON.stringify({ success: true, data: byCodigo[0] }), { status: 200 }, appOrigin);
                    }
                    if (byCodigo.length > 1) {
                        return withCORS(
                            JSON.stringify({
                                success: false,
                                error: 'Código possui múltiplos registros (lotes). Selecione o lote/registro.',
                                code: 'AMBIGUOUS',
                                registros: byCodigo.map((i) => String(i?.registro || '').trim()).filter(Boolean),
                                candidates: byCodigo,
                            }),
                            { status: 409 },
                            appOrigin
                        );
                    }
                    const byRegistro = items.find((i) => String(i?.registro || '').trim() === maybeCodigo) || null;
                    if (!byRegistro) {
                        return withCORS(JSON.stringify({ success: false, error: "Insumo não encontrado" }), { status: 404 }, appOrigin);
                    }
                    return withCORS(JSON.stringify({ success: true, data: byRegistro }), { status: 200 }, appOrigin);
                } catch (err) {
                    return withCORS(JSON.stringify({ success: false, error: err.message }), { status: 500 }, appOrigin);
                }
            }
        }

        return null;
    }

    // D1-only: legacy Sheets insumos endpoints are intentionally disabled.
    return withCORS(JSON.stringify({ success: false, error: "D1_ONLY" }), { status: 503 }, appOrigin);

}
