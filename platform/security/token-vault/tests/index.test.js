import assert from 'node:assert/strict';
import test from 'node:test';
import { handleRequest } from '../src/index.js';

const encoder = new TextEncoder();
const TEST_API_TOKEN = ['unit', 'auth', 'token'].join('-');
const TEST_OPERATIONAL_TOKEN = ['unit', 'operational', 'token'].join('-');
const TEST_ANALYTICS_TOKEN = ['unit', 'analytics', 'token'].join('-');
const TEST_ENCRYPTION_KEY = ['unit', 'encryption', 'key', 'with', 'enough', 'length'].join('-');
const THREADS_TOKEN = ['threads', 'fixture', 'token'].join('-');
const FACEBOOK_TOKEN = ['facebook', 'fixture', 'token'].join('-');
const INSTAGRAM_OLD_TOKEN = ['instagram', 'old', 'fixture'].join('-');
const INSTAGRAM_NEW_TOKEN = ['instagram', 'new', 'fixture'].join('-');

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
    if (this.sql.includes('WHERE id = ?')) {
      return this.db.tokens.find((row) => row.id === this.values[0]) || null;
    }
    throw new Error(`Unexpected first SQL: ${this.sql}`);
  }

  async all() {
    if (!this.sql.includes('FROM credential_tokens')) {
      throw new Error(`Unexpected all SQL: ${this.sql}`);
    }
    const provider = this.values[0];
    return {
      results: this.db.tokens.filter((row) => row.provider === provider && row.active === 1),
    };
  }

  async run() {
    if (this.sql.includes('INSERT INTO credential_token_audit')) {
      this.db.audit.push([...this.values]);
      return { success: true };
    }
    if (this.sql.includes('UPDATE credential_tokens')) {
      const row = this.db.tokens.find((item) => item.id === this.values[5]);
      row.token_ciphertext = this.values[0];
      row.expires_at = this.values[1] || row.expires_at;
      row.last_refreshed_at = this.values[2];
      row.metadata_json = this.values[3];
      row.updated_at = this.values[4];
      return { success: true };
    }
    throw new Error(`Unexpected run SQL: ${this.sql}`);
  }
}

class FakeDb {
  constructor() {
    this.tokens = [];
    this.audit = [];
  }

  prepare(sql) {
    return new FakeStatement(this, sql);
  }
}

function env(db) {
  return {
    TOKEN_VAULT_DB: db,
    TOKEN_VAULT_API_TOKEN: TEST_API_TOKEN,
    TOKEN_VAULT_N8N_API_TOKEN: TEST_OPERATIONAL_TOKEN,
    TOKEN_VAULT_ANALYTICS_API_TOKEN: TEST_ANALYTICS_TOKEN,
    TOKEN_VAULT_ENCRYPTION_KEY: TEST_ENCRYPTION_KEY,
    REQUIRE_AUTH: 'true',
    WORKER_AUTH_HEADER_NAME: 'Authorization',
    WORKER_AUTH_SCHEME: 'Bearer',
    INFLUENCER_INTELLIGENCE_ANALYTICS_MODE: 'shadow',
  };
}

function authHeaders() {
  return { Authorization: `Bearer ${TEST_API_TOKEN}` };
}

function operationalAuthHeaders() {
  return { Authorization: `Bearer ${TEST_OPERATIONAL_TOKEN}` };
}

async function encryptForSeed(token, secret) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const raw = await crypto.subtle.digest('SHA-256', encoder.encode(secret));
  const key = await crypto.subtle.importKey('raw', raw, 'AES-GCM', false, ['encrypt']);
  const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, encoder.encode(token));
  return `v1:${Buffer.from(iv).toString('base64')}:${Buffer.from(ciphertext).toString('base64')}`;
}

test('health requires bearer auth', async () => {
  const db = new FakeDb();
  const response = await handleRequest(
    new Request('https://api.skincos.com.br/internal/token-vault/health'),
    env(db),
  );
  assert.equal(response.status, 401);
});

test('health validates configured bindings and secrets', async () => {
  const db = new FakeDb();
  const response = await handleRequest(
    new Request('https://api.skincos.com.br/internal/token-vault/health', { headers: authHeaders() }),
    env(db),
  );
  const body = await response.json();
  assert.equal(response.status, 200);
  assert.equal(body.ok, true);
  assert.equal(body.checks.d1, true);
  assert.equal(body.checks.n8nApiToken, true);
  assert.equal(body.analytics_mode, 'shadow');
  assert.equal(body.analytics_ready, true);
});

test('health stays unhealthy when the dedicated analytics secret is absent', async () => {
  const db = new FakeDb();
  const environment = env(db);
  delete environment.TOKEN_VAULT_ANALYTICS_API_TOKEN;
  const response = await handleRequest(
    new Request('https://api.skincos.com.br/internal/token-vault/health', { headers: authHeaders() }),
    environment,
  );
  const body = await response.json();
  assert.equal(response.status, 500);
  assert.equal(body.ok, false);
  assert.equal(body.checks.analyticsApiToken, false);
});

test('health stays unhealthy when the operational Orb credential is absent', async () => {
  const db = new FakeDb();
  const environment = env(db);
  delete environment.TOKEN_VAULT_N8N_API_TOKEN;
  const response = await handleRequest(
    new Request('https://api.skincos.com.br/internal/token-vault/health', { headers: authHeaders() }),
    environment,
  );
  const body = await response.json();
  assert.equal(response.status, 500);
  assert.equal(body.ok, false);
  assert.equal(body.checks.n8nApiToken, false);
});

test('analytics credential cannot reach write-capable sibling gateways', async () => {
  const db = new FakeDb();
  const socialResponse = await handleRequest(
    new Request('https://api.skincos.com.br/internal/token-vault/v1/social-publish/operations', {
      method: 'POST',
      headers: { Authorization: `Bearer ${TEST_ANALYTICS_TOKEN}`, 'content-type': 'application/json' },
      body: JSON.stringify({ platform: 'instagram', unit: 'bss', operation: 'probe', method: 'GET', url: 'https://graph.instagram.com/v25.0/123' }),
    }),
    env(db),
  );
  assert.equal(socialResponse.status, 403);

  const metaAdsResponse = await handleRequest(
    new Request('https://api.skincos.com.br/internal/token-vault/v1/meta-ads-publish/config', {
      headers: { Authorization: `Bearer ${TEST_ANALYTICS_TOKEN}` },
    }),
    env(db),
  );
  assert.equal(metaAdsResponse.status, 403);
  assert.equal(db.tokens.length, 0);
});

test('invalid authentication configuration fails closed', async () => {
  const db = new FakeDb();
  const environment = env(db);
  environment.REQUIRE_AUTH = 'false';
  const response = await handleRequest(
    new Request('https://api.skincos.com.br/internal/token-vault/health', { headers: authHeaders() }),
    environment,
  );
  assert.equal(response.status, 500);
  assert.equal((await response.json()).error, 'invalid_auth_configuration');
});

test('configured worker secrets must remain pairwise distinct', async () => {
  const db = new FakeDb();
  const environment = env(db);
  environment.TOKEN_VAULT_ANALYTICS_API_TOKEN = TEST_API_TOKEN;
  const response = await handleRequest(
    new Request('https://api.skincos.com.br/internal/token-vault/health', { headers: authHeaders() }),
    environment,
  );
  assert.equal(response.status, 500);
  assert.equal((await response.json()).error, 'invalid_worker_secret_configuration');
});

test('routes social publication requests to the fail-closed gateway', async () => {
  const db = new FakeDb();
  const response = await handleRequest(
    new Request('https://api.skincos.com.br/internal/token-vault/v1/social-publish/operations', {
      method: 'POST',
      headers: { ...authHeaders(), 'content-type': 'application/json' },
      body: JSON.stringify({
        platform: 'unsupported',
        unit: 'bss',
        operation: 'preflight_contract_probe',
        method: 'GET',
        url: 'https://graph.instagram.com/v25.0/1',
      }),
    }),
    env(db),
  );
  const body = await response.json();
  assert.equal(response.status, 400);
  assert.equal(body.error, 'invalid_platform');
});

test('operational credential can call the social gateway but not list token material', async () => {
  const db = new FakeDb();
  const socialResponse = await handleRequest(
    new Request('https://api.skincos.com.br/internal/token-vault/v1/social-publish/operations', {
      method: 'POST',
      headers: { ...operationalAuthHeaders(), 'content-type': 'application/json' },
      body: JSON.stringify({
        platform: 'unsupported',
        unit: 'bss',
        operation: 'preflight_contract_probe',
        method: 'GET',
        url: 'https://graph.instagram.com/v25.0/1',
      }),
    }),
    env(db),
  );
  assert.equal(socialResponse.status, 400);
  assert.equal((await socialResponse.json()).error, 'invalid_platform');

  const tokensResponse = await handleRequest(
    new Request('https://api.skincos.com.br/internal/token-vault/v1/tokens?active=true', {
      headers: operationalAuthHeaders(),
    }),
    env(db),
  );
  assert.equal(tokensResponse.status, 403);
  assert.equal((await tokensResponse.json()).error, 'admin_credential_required');
});

test('lists decrypted provider tokens with compatibility fields', async () => {
  const db = new FakeDb();
  db.tokens.push({
    id: 'tok_threads_1',
    provider: 'threads',
    unit: 'novo_hamburgo',
    external_account_id: '123',
    token_type: 'long_lived_access_token',
    token_ciphertext: await encryptForSeed(THREADS_TOKEN, env(db).TOKEN_VAULT_ENCRYPTION_KEY),
    expires_at: null,
    last_refreshed_at: null,
    active: 1,
    metadata_json: '{}',
    created_at: '2026-06-18T00:00:00.000Z',
    updated_at: '2026-06-18T00:00:00.000Z',
  });

  const response = await handleRequest(
    new Request('https://api.skincos.com.br/internal/token-vault/v1/tokens?provider=threads', {
      headers: authHeaders(),
    }),
    env(db),
  );
  const body = await response.json();
  assert.equal(response.status, 200);
  assert.equal(body.items[0].thId, '123');
  assert.equal(body.items[0].thToken, THREADS_TOKEN);
  assert.equal(body.items[0].token, THREADS_TOKEN);
});

test('lists facebook tokens with compatibility fields', async () => {
  const db = new FakeDb();
  db.tokens.push({
    id: 'tok_facebook_1',
    provider: 'facebook',
    unit: 'novo_hamburgo',
    external_account_id: '789',
    token_type: 'long_lived_access_token',
    token_ciphertext: await encryptForSeed(FACEBOOK_TOKEN, env(db).TOKEN_VAULT_ENCRYPTION_KEY),
    expires_at: null,
    last_refreshed_at: null,
    active: 1,
    metadata_json: '{}',
    created_at: '2026-06-18T00:00:00.000Z',
    updated_at: '2026-06-18T00:00:00.000Z',
  });

  const response = await handleRequest(
    new Request('https://api.skincos.com.br/internal/token-vault/v1/tokens?provider=facebook', {
      headers: authHeaders(),
    }),
    env(db),
  );
  const body = await response.json();
  assert.equal(response.status, 200);
  assert.equal(body.items[0].fbId, '789');
  assert.equal(body.items[0].fbToken, FACEBOOK_TOKEN);
  assert.equal(body.items[0].token, FACEBOOK_TOKEN);
});

test('patch updates encrypted token and writes audit without token payload', async () => {
  const db = new FakeDb();
  const seedEnv = env(db);
  db.tokens.push({
    id: 'tok_instagram_1',
    provider: 'instagram',
    unit: 'barra_shopping_sul',
    external_account_id: '456',
    token_type: 'long_lived_access_token',
    token_ciphertext: await encryptForSeed(INSTAGRAM_OLD_TOKEN, seedEnv.TOKEN_VAULT_ENCRYPTION_KEY),
    expires_at: null,
    last_refreshed_at: null,
    active: 1,
    metadata_json: '{}',
    created_at: '2026-06-18T00:00:00.000Z',
    updated_at: '2026-06-18T00:00:00.000Z',
  });

  const response = await handleRequest(
    new Request('https://api.skincos.com.br/internal/token-vault/v1/tokens/tok_instagram_1', {
      method: 'PATCH',
      headers: { ...authHeaders(), 'content-type': 'application/json' },
      body: JSON.stringify({ token: INSTAGRAM_NEW_TOKEN, metadata: { source: 'test' } }),
    }),
    seedEnv,
  );

  const body = await response.json();
  assert.equal(response.status, 200);
  assert.equal(body.ok, true);
  assert.notEqual(db.tokens[0].token_ciphertext.includes(INSTAGRAM_NEW_TOKEN), true);
  assert.equal(JSON.stringify(db.audit).includes(INSTAGRAM_NEW_TOKEN), false);
});
