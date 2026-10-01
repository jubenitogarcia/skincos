import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import {
    LEGACY_API_JOBS_RPC_CAPABILITY,
    LEGACY_API_NOTIFICATIONS_REFRESH,
    normalizeLegacyApiNotificationsRefreshJob,
    normalizeLegacyApiNotificationsRefreshRequest,
} from '../src/legacy-api-jobs.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '..', '..');

test('the Inventory-owned legacy contract permits only a normalized notifications refresh DTO', () => {
    assert.deepEqual(
        normalizeLegacyApiNotificationsRefreshJob({ type: ' notifications_refresh ', unidade: ' novo-hamburgo ' }),
        { type: LEGACY_API_NOTIFICATIONS_REFRESH, unidade: 'novo-hamburgo' },
    );
    assert.deepEqual(
        normalizeLegacyApiNotificationsRefreshRequest({ unidade: null }),
        { type: LEGACY_API_NOTIFICATIONS_REFRESH, unidade: null },
    );
    assert.deepEqual(
        normalizeLegacyApiNotificationsRefreshRequest({ unidade: 'NH' }),
        { type: LEGACY_API_NOTIFICATIONS_REFRESH, unidade: 'novo-hamburgo' },
    );
});

test('the Inventory-owned legacy contract rejects a generic job dispatcher payload', () => {
    assert.throws(
        () => normalizeLegacyApiNotificationsRefreshJob({ type: 'DELETE_ALL' }),
        /LEGACY_API_JOB_TYPE_UNSUPPORTED/,
    );
    assert.throws(
        () => normalizeLegacyApiNotificationsRefreshRequest(['novo-hamburgo']),
        /LEGACY_API_JOB_REQUEST_INVALID/,
    );
    assert.throws(
        () => normalizeLegacyApiNotificationsRefreshRequest({ unidade: 'unknown-unit' }),
        /LEGACY_API_JOB_UNIDADE_INVALID/,
    );
});

test('the RPC entrypoint delegates business work to Inventory and exposes no HTTP route', async () => {
    const [entrypoint, worker] = await Promise.all([
        readFile(path.join(repoRoot, 'inventory', 'workers', 'legacy-api-jobs-entrypoint.js'), 'utf8'),
        readFile(path.join(repoRoot, 'inventory', 'src', 'worker.js'), 'utf8'),
    ]);

    assert.match(entrypoint, /runNotificationsRefreshJob\(\{ env: this\.env, unidade: job\.unidade \}\)/);
    assert.doesNotMatch(entrypoint, /(?:^|\n)\s*(?:async\s+)?fetch\s*\(/);
    assert.match(worker, /export async function runNotificationsRefreshJob/);
    assert.equal(LEGACY_API_JOBS_RPC_CAPABILITY, 'legacy-api-jobs-rpc/v1');
    assert.match(worker, /legacyApiJobsRpc: LEGACY_API_JOBS_RPC_CAPABILITY/);
});
