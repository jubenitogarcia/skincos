import assert from 'node:assert/strict';
import test from 'node:test';

import { handleShareRoutes } from '../src/routes/share.js';

function createDb() {
    const calls = [];
    const row = {
        id: 'share-1',
        createdAt: '2026-07-10T12:00:00.000Z',
        title: 'Arquivo',
        text: 'Conteúdo',
        url: 'https://example.test/file',
        filesJson: '[]',
        sourceId: 'source-1',
    };

    return {
        calls,
        prepare(sql) {
            return {
                bind(...bindings) {
                    calls.push({ sql, bindings });
                    return {
                        first: async () => {
                            if (sql.includes('COUNT(1)')) return { total: 1 };
                            if (sql.includes('WHERE id = ?')) return row;
                            return null;
                        },
                        all: async () => ({ results: [row] }),
                        run: async () => ({ success: true }),
                    };
                },
            };
        },
    };
}

function createContext(routePath, init = {}) {
    const db = createDb();
    let auth = { ok: true, user: { username: 'dev', role: 'GESTOR' } };
    const request = new Request('http://127.0.0.1:8787' + routePath, init);

    return {
        db,
        args: {
            request,
            url: new URL(request.url),
            env: { DB: db },
            appOrigin: 'http://localhost:8791',
            withCORS: (body, responseInit = {}) => new Response(body, responseInit),
            requireRoles: async () => auth,
        },
        setAuth(nextAuth) {
            auth = nextAuth;
        },
    };
}

test('lists history instead of treating history as a share id', async () => {
    const { args, db } = createContext('/share/history?limit=12');

    const response = await handleShareRoutes(args);
    const payload = await response.json();

    assert.equal(response.status, 200);
    assert.equal(payload.success, true);
    assert.equal(payload.data[0].id, 'share-1');
    assert.deepEqual(payload.resumo, { total: 1, pagina: 1, limit: 12 });
    assert.equal(db.calls.some((call) => call.sql.includes('COUNT(1)')), true);
    assert.equal(db.calls.some((call) => call.sql.includes('WHERE id = ?')), false);
});

test('creates and removes history records through their dedicated routes', async () => {
    const create = createContext('/share/history', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ id: 'share-2', title: 'Novo arquivo', files: [] }),
    });
    const createResponse = await handleShareRoutes(create.args);
    assert.equal(createResponse.status, 200);
    assert.equal(create.db.calls.some((call) => call.sql.includes('INSERT OR REPLACE INTO share_history')), true);

    const remove = createContext('/share/history/share-2', { method: 'DELETE' });
    const removeResponse = await handleShareRoutes(remove.args);
    assert.equal(removeResponse.status, 200);
    assert.equal(remove.db.calls.some((call) => call.sql.includes('DELETE FROM share_history')), true);
});

test('keeps individual share lookup separate from history', async () => {
    const { args, db } = createContext('/share/share-1');

    const response = await handleShareRoutes(args);
    const payload = await response.json();

    assert.equal(response.status, 200);
    assert.equal(payload.id, 'share-1');
    assert.equal(payload.title, 'Arquivo');
    assert.equal(db.calls.some((call) => call.sql.includes('WHERE id = ?')), true);
});

test('returns the authentication response before touching D1', async () => {
    const context = createContext('/share/history');
    context.setAuth({ ok: false, response: new Response('{"error":"UNAUTHORIZED"}', { status: 401 }) });

    const response = await handleShareRoutes(context.args);

    assert.equal(response.status, 401);
    assert.equal(context.db.calls.length, 0);
});
