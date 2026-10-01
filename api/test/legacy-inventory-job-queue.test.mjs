import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { JobQueue } from '../workers/legacy-inventory-durable-objects.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '..', '..');

function createDb(rows = []) {
    const calls = [];
    return {
        calls,
        prepare(sql) {
            const result = {
                all: async () => ({ results: sql.includes('SELECT id, type, unidade, payload_json') ? rows : [] }),
                first: async () => (sql.includes('COUNT(*)') ? { c: 0 } : null),
                run: async () => ({ meta: { changes: 1 } }),
            };
            return {
                bind(...bindings) {
                    calls.push({ sql, bindings });
                    return result;
                },
                first: result.first,
            };
        },
    };
}

test('legacy API JobQueue rejects every job type except notifications refresh before touching D1', async () => {
    const db = createDb();
    const queue = new JobQueue({ storage: { setAlarm: async () => {} } }, { DB: db });

    const result = await queue.enqueue({ type: 'REBUILD_SEARCH_INDEX' });

    assert.deepEqual(result, { enqueued: false, reason: 'UNSUPPORTED_JOB_TYPE' });
    assert.equal(db.calls.length, 0);
});

test('legacy API JobQueue rejects an invalid unit before creating a pending row', async () => {
    const db = createDb();
    const queue = new JobQueue({ storage: { setAlarm: async () => {} } }, { DB: db });

    const result = await queue.enqueue({ type: 'NOTIFICATIONS_REFRESH', unidade: 'unknown-unit' });

    assert.deepEqual(result, { enqueued: false, reason: 'UNIDADE_INVALID' });
    assert.equal(db.calls.length, 0);
});

test('legacy API JobQueue canonicalizes a valid unit before writing the pending row', async () => {
    const db = createDb();
    const queue = new JobQueue({ storage: { setAlarm: async () => {} } }, { DB: db });

    const result = await queue.enqueue({ type: 'NOTIFICATIONS_REFRESH', unidade: 'NH' });

    assert.deepEqual(result, { enqueued: true, id: 'NOTIFICATIONS_REFRESH:novo-hamburgo' });
    assert.equal(db.calls.length >= 2, true);
    assert.equal(db.calls[0].bindings[2], 'novo-hamburgo');
});

test('legacy API JobQueue executes notification work through the Inventory RPC binding', async () => {
    const db = createDb([{
        id: 'NOTIFICATIONS_REFRESH:novo-hamburgo',
        type: 'NOTIFICATIONS_REFRESH',
        unidade: 'novo-hamburgo',
        payload_json: null,
    }]);
    const alarms = [];
    const rpcCalls = [];
    const queue = new JobQueue({ storage: { setAlarm: async (at) => alarms.push(at) } }, {
        DB: db,
        INVENTORY_LEGACY_JOBS: {
            async runNotificationsRefresh(input) {
                rpcCalls.push(input);
                return { ok: true, type: 'NOTIFICATIONS_REFRESH', unidade: input.unidade };
            },
        },
    });

    const result = await queue.processBatch();

    assert.deepEqual(result, { processed: 1, remaining: 0 });
    assert.deepEqual(rpcCalls, [{ unidade: 'novo-hamburgo' }]);
    assert.equal(alarms.length, 0);
    assert.equal(db.calls.some(({ sql }) => sql.includes("status='RUNNING'")), true);
    assert.equal(db.calls.some(({ sql }) => sql.includes("status='DONE'")), true);
    assert.equal(db.calls.some(({ sql }) => sql.includes("WHERE status='PENDING'")), true);
});

test('legacy API JobQueue marks an inherited unsupported pending row failed without invoking Inventory RPC', async () => {
    const db = createDb([{
        id: 'REBUILD_SEARCH_INDEX:ALL',
        type: 'REBUILD_SEARCH_INDEX',
        unidade: null,
        payload_json: null,
    }]);
    let rpcCalls = 0;
    const queue = new JobQueue({ storage: { setAlarm: async () => {} } }, {
        DB: db,
        INVENTORY_LEGACY_JOBS: {
            async runNotificationsRefresh() {
                rpcCalls += 1;
                return { ok: true };
            },
        },
    });

    const result = await queue.processBatch();

    assert.deepEqual(result, { processed: 1, remaining: 0 });
    assert.equal(rpcCalls, 0);
    assert.equal(db.calls.some(({ sql }) => sql.includes("status='FAILED'")), true);
});

test('API has no Inventory implementation import and declares an internal named RPC binding', async () => {
    const [apiEntrypoint, apiConfig] = await Promise.all([
        readFile(path.join(repoRoot, 'api', 'workers', 'index.js'), 'utf8'),
        readFile(path.join(repoRoot, 'api', 'wrangler.toml'), 'utf8'),
    ]);

    assert.doesNotMatch(apiEntrypoint, /inventory\/src\/worker/);
    assert.match(apiEntrypoint, /legacy-inventory-durable-objects/);
    assert.match(apiConfig, /binding = "INVENTORY_LEGACY_JOBS"\s+service = "skincos-insumos"\s+entrypoint = "InventoryLegacyJobsEntrypoint"/);
    assert.match(apiConfig, /binding = "INVENTORY_LEGACY_JOBS"\s+service = "skincos-insumos-staging"\s+entrypoint = "InventoryLegacyJobsEntrypoint"/);
});

test('API Durable Object migration declarations stay intact while the implementation becomes local', async () => {
    const apiConfig = await readFile(path.join(repoRoot, 'api', 'wrangler.toml'), 'utf8');

    assert.match(apiConfig, /name = "RATE_LIMITER"\s+class_name = "RateLimiter"/);
    assert.match(apiConfig, /name = "JOB_QUEUE"\s+class_name = "JobQueue"/);
    assert.match(apiConfig, /tag = "v1"\s+new_sqlite_classes = \["RateLimiter"\]/);
    assert.match(apiConfig, /tag = "v2"\s+new_sqlite_classes = \["JobQueue"\]/);
    assert.doesNotMatch(apiConfig, /deleted_classes/);
});
