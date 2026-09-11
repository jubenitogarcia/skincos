import assert from 'node:assert/strict';
import test from 'node:test';
import { handleRequest } from '../src/index.js';
import { encryptToken } from '../src/token-crypto.js';

const HASH = 'a'.repeat(32);
const OTHER_HASH = 'b'.repeat(32);
const RUN_ID = 'map_synthetic_image';
const UPLOAD_KEY = 'upload:v3:synthetic';
const PRIVATE = 'SYNTHETIC-private-provider-data';
const OPERATIONAL = 'unit-operational-readback-token';
const TOKEN_ID = 'unit-facebook-token';
const ACCOUNT_ID = '123456789';

class ReadOnlyDb {
  constructor() {
    this.run = { id: RUN_ID, status: 'failed', summary_json: '{}', error_json: '{}' };
    this.upload = { run_id: RUN_ID, operation_key: UPLOAD_KEY, action: 'upload_image', status: 'completed', result_json: JSON.stringify({ images: { file: { hash: HASH } } }) };
    this.reads = [];
  }
  prepare(sql) {
    assert.match(sql.trim(), /^SELECT\s/);
    const db = this;
    return {
      bind(...values) {
        db.reads.push({ sql, values });
        return {
          async first() {
            if (sql.includes('FROM meta_ads_publish_runs')) return db.run?.id === values[0] ? structuredClone(db.run) : null;
            if (sql.includes('FROM meta_ads_publish_operations')) {
              assert.match(sql, /WHERE run_id = \? AND operation_key = \?/);
              return db.upload?.run_id === values[0] && db.upload.operation_key === values[1] ? structuredClone(db.upload) : null;
            }
            if (sql.includes('FROM credential_tokens')) return db.credential?.id === values[0] ? structuredClone(db.credential) : null;
            throw new Error('unexpected_read_query');
          },
          async all() {
            if (sql.includes('FROM meta_ads_publish_jobs')) return { results: [] };
            if (sql.includes('FROM meta_ads_publish_operations')) return { results: db.upload ? [structuredClone(db.upload)] : [] };
            throw new Error('unexpected_read_query');
          },
        };
      },
    };
  }
}

async function fixture(graph) {
  const db = new ReadOnlyDb();
  const calls = [];
  const env = {
    TOKEN_VAULT_API_TOKEN: 'unit-admin-readback-token',
    TOKEN_VAULT_N8N_API_TOKEN: OPERATIONAL,
    TOKEN_VAULT_ANALYTICS_API_TOKEN: 'unit-analytics-readback-token',
    TOKEN_VAULT_META_ADS_CONFIG_TOKEN: 'unit-config-readback-token',
    TOKEN_VAULT_ENCRYPTION_KEY: 'unit-encryption-key-for-readback-fixtures',
    TOKEN_VAULT_DB: db,
    META_GRAPH_SLEEP: async () => { throw new Error('readback_must_not_retry'); },
    META_GRAPH_FETCH: async (url, init) => {
      calls.push({ url: new URL(url), method: init.method, redirect: init.redirect });
      assert.equal(init.method, 'GET');
      assert.equal(init.redirect, 'error');
      assert.equal(init.headers.get('Authorization'), `Bearer ${PRIVATE}`);
      assert.equal(init.body, undefined);
      return graph ? graph(url, init) : Response.json({ data: [{ hash: HASH, account_id: ACCOUNT_ID, status: 'ACTIVE', width: 1200, height: 1500, name: PRIVATE, url: `https://private.invalid/${PRIVATE}` }] });
    },
  };
  db.credential = {
    id: TOKEN_ID, provider: 'facebook', active: 1,
    token_ciphertext: await encryptToken(PRIVATE, env),
    metadata_json: JSON.stringify({ meta_ads_publish: { account_id: ACCOUNT_ID, api_version: 'v25.0' } }),
  };
  const query = new URLSearchParams({ upload_operation_key: UPLOAD_KEY, image_hash: HASH, token_id: TOKEN_ID, account_id: ACCOUNT_ID });
  async function invoke({ overrides = {}, extra = '', bearer = OPERATIONAL, method = 'GET', pathname, rawQuery, headers = {} } = {}) {
    const selected = new URLSearchParams(rawQuery ?? query);
    for (const [name, value] of Object.entries(overrides)) value === null ? selected.delete(name) : selected.set(name, value);
    const url = 'https://token-vault.test/internal/token-vault/v1/meta-ads-publish/' + (pathname || `runs/${RUN_ID}/image-readback`) + '?' + selected + extra;
    const response = await handleRequest(new Request(url, { method, headers: { ...(bearer ? { Authorization: `Bearer ${bearer}` } : {}), ...headers } }), env);
    const output = await response.json();
    assert.doesNotMatch(JSON.stringify(output), new RegExp(PRIVATE));
    return { response, output };
  }
  return { db, env, calls, query, invoke };
}

test('terminal-run readback is one fresh fixed Graph GET, with no journal or Meta mutation', async () => {
  const { db, calls, invoke } = await fixture();
  const before = structuredClone({ run: db.run, upload: db.upload, credential: db.credential });
  const { response, output } = await invoke();
  assert.equal(response.status, 200);
  assert.equal(output.image.found, true);
  assert.equal(output.image.account_match, true);
  assert.equal(output.image.graph_status, 'ACTIVE');
  assert.equal(output.image.width, 1200);
  assert.equal(output.image.height, 1500);
  assert.equal(output.image.creative_acceptance_verified, false);
  assert.equal(output.meta_mutations_performed, false);
  assert.equal(output.journal_mutations_performed, false);
  assert.match(output.image.hash_fingerprint, /^[a-f0-9]{64}$/);
  for (const forbidden of [HASH, UPLOAD_KEY, RUN_ID, ACCOUNT_ID, TOKEN_ID, 'private.invalid']) {
    assert.equal(JSON.stringify(output).includes(forbidden), false);
  }
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url.origin, 'https://graph.facebook.com');
  assert.equal(calls[0].url.pathname, `/v25.0/act_${ACCOUNT_ID}/adimages`);
  assert.deepEqual([...calls[0].url.searchParams.keys()].sort(), ['fields', 'hashes', 'limit']);
  assert.deepEqual(JSON.parse(calls[0].url.searchParams.get('hashes')), [HASH]);
  assert.equal(calls[0].url.searchParams.get('fields'), 'hash,account_id,status,width,height');
  assert.deepEqual({ run: db.run, upload: db.upload, credential: db.credential }, before);
  assert.equal((await invoke()).response.status, 200);
  assert.equal(calls.length, 2, 'a repeated read must observe Graph again, not replay an upload receipt');
});

test('missing Graph image is absence in the response, never proof of permanent deletion', async () => {
  const { invoke } = await fixture(() => Response.json({ data: [] }));
  const { response, output } = await invoke();
  assert.equal(response.status, 200);
  assert.equal(output.image.found, false);
  assert.equal(output.image.account_match, null);
  assert.equal(output.image.graph_status, null);
  assert.equal(output.image.creative_acceptance_verified, false);
});

test('readback success and failure never echo private correlation headers', async () => {
  const { invoke } = await fixture();
  for (const overrides of [{}, { image_hash: '' }]) {
    const { output } = await invoke({ overrides, headers: { 'cf-ray': PRIVATE } });
    assert.match(output.requestId, /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/);
  }
});

for (const status of ['ACTIVE', 'DELETED', 'INTERNAL', PRIVATE]) {
  test(`status is an allowlisted metadata value: ${status === PRIVATE ? 'unknown' : status}`, async () => {
    const { invoke } = await fixture(() => Response.json({ data: [{ hash: HASH, account_id: ACCOUNT_ID, status, width: -1, height: PRIVATE }] }));
    const { output } = await invoke();
    assert.equal(output.image.graph_status, status === PRIVATE ? 'UNKNOWN' : status);
    assert.equal(output.image.width, null);
    assert.equal(output.image.height, null);
    assert.equal(output.image.creative_acceptance_verified, false);
  });
}

test('journal GET remains available for a failed run without Graph calls or writes', async () => {
  const { invoke, calls } = await fixture();
  const { response, output } = await invoke({ pathname: `runs/${RUN_ID}`, rawQuery: '' });
  assert.equal(response.status, 200);
  assert.equal(output.run.status, 'failed');
  assert.equal(output.operations[0].status, 'completed');
  assert.equal(calls.length, 0);
});

for (const bearer of [null, 'wrong-token', 'unit-analytics-readback-token', 'unit-config-readback-token']) {
  test(`existing role boundary rejects ${bearer || 'missing authentication'}`, async () => {
    const { invoke, db, calls } = await fixture();
    const { response } = await invoke({ bearer });
    assert.ok([401, 403].includes(response.status));
    assert.equal(db.reads.length, 0);
    assert.equal(calls.length, 0);
  });
}

test('administrator may perform the same constrained read', async () => {
  const { invoke } = await fixture();
  assert.equal((await invoke({ bearer: 'unit-admin-readback-token' })).response.status, 200);
});

test('POST to readback never changes a run or reaches Graph', async () => {
  const { invoke, db, calls } = await fixture();
  assert.equal((await invoke({ method: 'POST' })).response.status, 404);
  assert.equal(db.reads.length, 0);
  assert.equal(calls.length, 0);
});

for (const overrides of [
  { image_hash: '' }, { image_hash: 'x'.repeat(32) }, { image_hash: HASH + '\n' }, { image_hash: null },
  { upload_operation_key: null }, { account_id: null }, { account_id: '1/ads' }, { token_id: null },
  { api_version: 'v24.0' }, { api_version: '' }, { fields: 'url,name' }, { url: 'https://private.invalid' },
]) {
  test(`invalid request is rejected before storage/token lookup: ${Object.keys(overrides)[0]}=${overrides[Object.keys(overrides)[0]] === null ? 'missing' : 'invalid'}`, async () => {
    const { invoke, db, calls } = await fixture();
    const { response, output } = await invoke({ overrides });
    assert.equal(response.status, 400);
    assert.equal(output.error, 'image_readback_request_invalid');
    assert.equal(db.reads.length, 0);
    assert.equal(calls.length, 0);
  });
}

test('duplicate query fields fail closed', async () => {
  const { invoke, db } = await fixture();
  const { response } = await invoke({ extra: `&image_hash=${HASH}` });
  assert.equal(response.status, 400);
  assert.equal(db.reads.length, 0);
});

for (const change of ['missing_run', 'foreign_run', 'wrong_action', 'pending_upload', 'unknown_hash', 'receipt_account']) {
  test(`receipt provenance rejects ${change} before credential access`, async () => {
    const { invoke, db, calls } = await fixture();
    if (change === 'missing_run') db.run = null;
    if (change === 'foreign_run') db.upload.run_id = 'map_other_run';
    if (change === 'wrong_action') db.upload.action = 'create_creative';
    if (change === 'pending_upload') db.upload.status = 'in_progress';
    if (change === 'unknown_hash') db.upload.result_json = JSON.stringify({ images: { file: { hash: OTHER_HASH } } });
    if (change === 'receipt_account') db.upload.result_json = JSON.stringify({ images: { file: { hash: HASH, account_id: '987654321' } } });
    const { response } = await invoke();
    assert.ok([404, 409].includes(response.status));
    assert.equal(db.reads.some(({ sql }) => sql.includes('FROM credential_tokens')), false);
    assert.equal(calls.length, 0);
  });
}

test('account not authorized for credential is rejected before Graph', async () => {
  const { invoke, calls } = await fixture();
  const { response, output } = await invoke({ overrides: { account_id: '987654321' } });
  assert.equal(response.status, 403);
  assert.equal(output.error, 'account_not_authorized_for_token');
  assert.equal(calls.length, 0);
});

test('inactive or unknown token cannot read an image', async () => {
  for (const change of ['inactive', 'missing']) {
    const { invoke, db, calls } = await fixture();
    if (change === 'inactive') db.credential.active = 0;
    else db.credential = null;
    assert.equal((await invoke()).response.status, 401);
    assert.equal(calls.length, 0);
  }
});

for (const body of [
  { data: [{ hash: OTHER_HASH, account_id: ACCOUNT_ID }] },
  { data: [{ hash: HASH, account_id: '987654321' }] },
  { data: [{ hash: HASH }] }, { data: [null] }, { data: ['invalid'] }, { data: {} },
  { data: [{ hash: HASH, account_id: ACCOUNT_ID }, { hash: HASH, account_id: ACCOUNT_ID }] },
  { data: [], paging: { next: `https://private.invalid/${PRIVATE}` } },
]) {
  test('malformed, mismatched, or paginated Graph responses cannot attest the image', async () => {
    const { invoke, calls } = await fixture(() => Response.json(body));
    const { response, output } = await invoke();
    assert.equal(response.status, 502);
    assert.equal(output.ok, false);
    assert.equal(calls.length, 1);
  });
}

for (const [status, code] of [[401, 190], [403, 200], [400, 100], [429, 4], [500, 2]]) {
  test(`Graph HTTP ${status} exposes only safe structured error metadata without retry`, async () => {
    const { invoke, calls } = await fixture(() => Response.json({ error: { message: PRIVATE, error_user_msg: PRIVATE, fbtrace_id: PRIVATE, code, error_subcode: 2446578 } }, { status }));
    const { response, output } = await invoke();
    assert.equal(response.status, status);
    assert.equal(output.error, 'meta_image_readback_failed');
    assert.equal(output.detail.code, code);
    assert.equal(output.detail.error_subcode, 2446578);
    assert.equal(calls.length, 1);
  });
}

test('timeout, redirect and oversized response are bounded and never followed', async () => {
  for (const graph of [
    () => { throw Object.assign(new Error(PRIVATE), { name: 'AbortError' }); },
    () => new Response('', { status: 302, headers: { location: `https://private.invalid/${PRIVATE}` } }),
    () => Response.json({ data: [], extra: 'x'.repeat(33 * 1024) }),
  ]) {
    const { invoke, calls } = await fixture(graph);
    const { response, output } = await invoke();
    assert.equal(response.status, 502);
    assert.equal(output.ok, false);
    assert.equal(calls.length, 1);
  }
});
