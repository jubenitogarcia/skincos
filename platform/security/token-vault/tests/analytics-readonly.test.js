import assert from 'node:assert/strict';
import test from 'node:test';
import { handleRequest } from '../src/index.js';

const TEST_ADMIN_TOKEN = 'unit-admin-token';
const TEST_ANALYTICS_TOKEN = 'unit-analytics-token';
const TEST_OPERATIONAL_TOKEN = 'unit-operational-token';
const TEST_ENCRYPTION_KEY = 'unit-encryption-key-with-enough-length';
const GRAPH_TOKEN = 'graph-secret-never-returned';
const encoder = new TextEncoder();

class FakeStatement {
  constructor(db, sql) {
    this.db = db;
    this.sql = sql;
    this.values = [];
  }

  bind(...values) {
    this.values = values;
    return this;
  }

  async first() {
    if (this.sql.includes('SELECT 1 AS ok')) return { ok: 1 };
    if (this.sql.includes('FROM credential_tokens')) {
      return this.db.tokens.find((row) => row.id === this.values[0]) || null;
    }
    throw new Error(`Unexpected first SQL: ${this.sql}`);
  }

  async run() {
    if (this.sql.includes('INSERT INTO credential_token_audit')) {
      if (this.db.failAudit) throw new Error('audit unavailable');
      this.db.audit.push([...this.values]);
      return { success: true };
    }
    throw new Error(`Unexpected run SQL: ${this.sql}`);
  }
}

class FakeDb {
  constructor() {
    this.tokens = [];
    this.audit = [];
    this.failAudit = false;
  }

  prepare(sql) {
    return new FakeStatement(this, sql);
  }
}

function environment(db) {
  return {
    TOKEN_VAULT_DB: db,
    TOKEN_VAULT_API_TOKEN: TEST_ADMIN_TOKEN,
    TOKEN_VAULT_N8N_API_TOKEN: TEST_OPERATIONAL_TOKEN,
    TOKEN_VAULT_ANALYTICS_API_TOKEN: TEST_ANALYTICS_TOKEN,
    TOKEN_VAULT_ENCRYPTION_KEY: TEST_ENCRYPTION_KEY,
    META_GRAPH_VERSION: 'v20.0',
    REQUIRE_AUTH: 'true',
    WORKER_AUTH_HEADER_NAME: 'Authorization',
    WORKER_AUTH_SCHEME: 'Bearer',
  };
}

function headers(token = TEST_ANALYTICS_TOKEN) {
  return {
    Authorization: `Bearer ${token}`,
    'content-type': 'application/json',
  };
}

async function encryptForSeed(token) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const raw = await crypto.subtle.digest('SHA-256', encoder.encode(TEST_ENCRYPTION_KEY));
  const key = await crypto.subtle.importKey('raw', raw, 'AES-GCM', false, ['encrypt']);
  const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, encoder.encode(token));
  return `v1:${Buffer.from(iv).toString('base64')}:${Buffer.from(ciphertext).toString('base64')}`;
}

async function seedInstagram(db, { analyticsScope = true, active = 1 } = {}) {
  db.tokens.push({
    id: 'ig_analytics_001',
    provider: 'instagram',
    unit: 'synthetic',
    external_account_id: '17841400000000001',
    token_type: 'long_lived_access_token',
    token_ciphertext: await encryptForSeed(GRAPH_TOKEN),
    expires_at: null,
    active,
    metadata_json: JSON.stringify(analyticsScope ? {
      analytics_scopes: ['influencer-intelligence'],
    } : {}),
  });
}

function profileRequest(overrides = {}) {
  return {
    provider: 'meta-graph',
    operation: 'get_profile',
    credential_ref: 'ig_analytics_001',
    creator_key: 'creator:synthetic-001',
    canonical_handle: 'synthetic.creator',
    observed_at: '2026-08-12T10:00:00.000Z',
    retrieved_at: '2026-08-12T10:00:01.000Z',
    correlation_id: 'ii:get_profile:creator:synthetic-001',
    requested_fields: ['username', 'followers_count', 'media_count'],
    ...overrides,
  };
}

async function withFetch(env, handler, callback) {
  const original = env.ANALYTICS_FETCH;
  env.ANALYTICS_FETCH = handler;
  try {
    return await callback();
  } finally {
    env.ANALYTICS_FETCH = original;
  }
}

test('analytics role can read a bounded Meta profile without returning credentials', async () => {
  const db = new FakeDb();
  const env = environment(db);
  await seedInstagram(db);
  const calls = [];
  await withFetch(env, async (url, init) => {
    calls.push({ url: String(url), init });
    return new Response(JSON.stringify({
      username: 'synthetic.creator',
      followers_count: 1200,
      media_count: 12,
    }), { status: 200, headers: { 'content-type': 'application/json' } });
  }, async () => {
    const response = await handleRequest(
      new Request('https://api-staging.skincos.com.br/internal/token-vault/v1/analytics/operations', {
        method: 'POST',
        headers: headers(),
        body: JSON.stringify(profileRequest()),
      }),
      env,
    );
    const body = await response.json();
    assert.equal(response.status, 200);
    assert.equal(body.ok, true);
    assert.equal(body.result.provider, 'meta-graph');
    assert.equal(body.result.data.followers_count, 1200);
    assert.equal(body.result.data.media_count, 12);
    assert.equal(JSON.stringify(body).includes(GRAPH_TOKEN), false);
    assert.equal(JSON.stringify(body).includes('access_token'), false);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].init.method, 'GET');
    assert.equal(calls[0].init.headers.authorization, `Bearer ${GRAPH_TOKEN}`);
    assert.equal(new URL(calls[0].url).searchParams.has('access_token'), false);
    assert.equal(calls[0].url, 'https://graph.facebook.com/v20.0/17841400000000001?fields=business_discovery.username%28synthetic.creator%29%7Bid%2Cusername%2Cfollowers_count%2Cmedia_count%7D');
    assert.equal(db.audit.length, 1);
    assert.equal(JSON.stringify(db.audit).includes(GRAPH_TOKEN), false);
  });
});

test('operational credentials cannot invoke analytics and missing scope fails closed', async () => {
  const db = new FakeDb();
  const env = environment(db);
  await seedInstagram(db, { analyticsScope: false });

  const operational = await handleRequest(
    new Request('https://api-staging.skincos.com.br/internal/token-vault/v1/analytics/operations', {
      method: 'POST',
      headers: headers(TEST_OPERATIONAL_TOKEN),
      body: JSON.stringify(profileRequest()),
    }),
    env,
  );
  assert.equal(operational.status, 403);
  assert.equal((await operational.json()).error, 'analytics_credential_required');

  const missingScope = await handleRequest(
    new Request('https://api-staging.skincos.com.br/internal/token-vault/v1/analytics/operations', {
      method: 'POST',
      headers: headers(),
      body: JSON.stringify(profileRequest()),
    }),
    env,
  );
  assert.equal(missingScope.status, 403);
  assert.equal((await missingScope.json()).error, 'permission_gap');
  assert.equal(db.audit.length, 1);
});

test('official transport preserves explicit zero metrics and omits unavailable fields', async () => {
  const db = new FakeDb();
  const env = environment(db);
  await seedInstagram(db);
  await withFetch(env, async () => new Response(JSON.stringify({
    id: '10000000000000001',
    like_count: 0,
    comments_count: 0,
  }), { status: 200 }), async () => {
    const response = await handleRequest(
      new Request('https://api-staging.skincos.com.br/internal/token-vault/v1/analytics/operations', {
        method: 'POST',
        headers: headers(),
        body: JSON.stringify({
          ...profileRequest(),
          operation: 'get_media_metrics',
          media_keys: ['10000000000000001'],
          requested_fields: ['id', 'like_count', 'comments_count', 'views'],
        }),
      }),
      env,
    );
    const body = await response.json();
    assert.equal(response.status, 200);
    assert.deepEqual(body.result.data, [{
      media_key: '10000000000000001',
      likes_count: 0,
      comments_count: 0,
    }]);
    assert.equal('views_count' in body.result.data[0], false);
  });
});

test('comment collection returns aggregate counts but never comment identifiers or text', async () => {
  const db = new FakeDb();
  const env = environment(db);
  await seedInstagram(db);
  await withFetch(env, async (url) => {
    assert.match(String(url), /\/10000000000000001\/comments\?/);
    return new Response(JSON.stringify({
      data: [{ id: 'comment-identifier' }, { id: 'another-comment' }],
      summary: { total_count: 9 },
    }), { status: 200 });
  }, async () => {
    const response = await handleRequest(
      new Request('https://api-staging.skincos.com.br/internal/token-vault/v1/analytics/operations', {
        method: 'POST',
        headers: headers(),
        body: JSON.stringify({
          ...profileRequest(),
          operation: 'get_comments_sample',
          media_keys: ['10000000000000001'],
          limit: 5,
          requested_fields: ['comments'],
        }),
      }),
      env,
    );
    const body = await response.json();
    assert.equal(response.status, 200);
    assert.deepEqual(body.result.data, [{ comment_count: 9, sample_size: 2 }]);
    assert.equal(JSON.stringify(body).includes('comment-identifier'), false);
    assert.equal(JSON.stringify(body).includes('another-comment'), false);
  });
});

test('Meta permission and timeout failures remain structured and do not fabricate data', async () => {
  const db = new FakeDb();
  const env = environment(db);
  await seedInstagram(db);
  await withFetch(env, async () => new Response('{}', { status: 403 }), async () => {
    const response = await handleRequest(
      new Request('https://api-staging.skincos.com.br/internal/token-vault/v1/analytics/operations', {
        method: 'POST',
        headers: headers(),
        body: JSON.stringify(profileRequest()),
      }),
      env,
    );
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.result.status, 'unavailable');
    assert.equal(body.result.data, null);
    assert.deepEqual(body.result.limitations, ['permission_gap']);
  });

  await withFetch(env, async () => {
    const error = new Error('aborted');
    error.name = 'AbortError';
    throw error;
  }, async () => {
    const response = await handleRequest(
      new Request('https://api-staging.skincos.com.br/internal/token-vault/v1/analytics/operations', {
        method: 'POST',
        headers: headers(),
        body: JSON.stringify(profileRequest()),
      }),
      env,
    );
    assert.equal(response.status, 504);
    assert.equal((await response.json()).error, 'timeout');
  });
});

test('analytics request rejects arbitrary fields and audit failure fails closed', async () => {
  const db = new FakeDb();
  const env = environment(db);
  await seedInstagram(db);
  await withFetch(env, async () => {
    throw new Error('fetch must not run');
  }, async () => {
    const response = await handleRequest(
      new Request('https://api-staging.skincos.com.br/internal/token-vault/v1/analytics/operations', {
        method: 'POST',
        headers: headers(),
        body: JSON.stringify({ ...profileRequest(), path: 'https://evil.example' }),
      }),
      env,
    );
    assert.equal(response.status, 400);
    assert.equal((await response.json()).error, 'invalid_request');
  });

  db.failAudit = true;
  const response = await handleRequest(
    new Request('https://api-staging.skincos.com.br/internal/token-vault/v1/analytics/operations', {
      method: 'POST',
      headers: headers(),
      body: JSON.stringify(profileRequest()),
    }),
    env,
  );
  assert.equal(response.status, 500);
  assert.equal((await response.json()).error, 'internal_error');
});
