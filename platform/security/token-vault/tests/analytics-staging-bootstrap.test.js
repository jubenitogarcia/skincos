import assert from 'node:assert/strict';
import test from 'node:test';
import { handleRequest } from '../src/index.js';

const ADMIN_TOKEN = 'unit-admin-token';
const ANALYTICS_TOKEN = 'unit-analytics-token';
const OPERATIONAL_TOKEN = 'unit-operational-token';
const BOOTSTRAP_TOKEN = 'unit-bootstrap-token';
const ENCRYPTION_KEY = 'unit-encryption-key-with-enough-length';
const META_ACCESS_TOKEN = 'EAAsyntheticMetaAccessTokenForBootstrapOnly';
const ACCOUNT_ID = '17841400000000001';
const CREDENTIAL_REF = 'ig-analytics-shadow-unit-001';

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
    if (this.sql.includes('SELECT id FROM credential_tokens')) {
      const row = this.db.tokens.find((token) => token.provider === this.values[0]);
      return row ? { id: row.id } : null;
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
    this.failBatch = false;
  }

  prepare(sql) {
    return new FakeStatement(this, sql);
  }

  async batch(statements) {
    if (this.failBatch) throw new Error('transaction unavailable');
    assert.equal(statements.length, 2);
    const [insert, audit] = statements;
    assert.match(insert.sql, /INSERT INTO credential_tokens/);
    assert.match(audit.sql, /INSERT INTO credential_token_audit/);
    if (this.failAudit) throw new Error('audit unavailable');
    if (this.tokens.some((token) => token.id === insert.values[0])) throw new Error('UNIQUE constraint failed');
    this.tokens.push({
      id: insert.values[0],
      provider: insert.values[1],
      unit: insert.values[2],
      external_account_id: insert.values[3],
      token_type: insert.values[4],
      token_ciphertext: insert.values[5],
      expires_at: insert.values[6],
      last_refreshed_at: insert.values[7],
      active: insert.values[8],
      metadata_json: insert.values[9],
      created_at: insert.values[10],
      updated_at: insert.values[11],
    });
    this.audit.push([...audit.values]);
    return [{ success: true }, { success: true }];
  }
}

function environment(db, overrides = {}) {
  return {
    TOKEN_VAULT_DB: db,
    TOKEN_VAULT_API_TOKEN: ADMIN_TOKEN,
    TOKEN_VAULT_N8N_API_TOKEN: OPERATIONAL_TOKEN,
    TOKEN_VAULT_ANALYTICS_API_TOKEN: ANALYTICS_TOKEN,
    TOKEN_VAULT_STAGING_ANALYTICS_BOOTSTRAP_TOKEN: BOOTSTRAP_TOKEN,
    TOKEN_VAULT_ENCRYPTION_KEY: ENCRYPTION_KEY,
    REQUIRE_AUTH: 'true',
    WORKER_AUTH_HEADER_NAME: 'Authorization',
    WORKER_AUTH_SCHEME: 'Bearer',
    ENVIRONMENT: 'staging',
    INFLUENCER_INTELLIGENCE_ANALYTICS_MODE: 'shadow',
    INFLUENCER_INTELLIGENCE_ENABLED: 'false',
    ...overrides,
  };
}

function request(body, token = BOOTSTRAP_TOKEN) {
  return new Request('https://api-staging.skincos.com.br/internal/token-vault/v1/analytics/staging-bootstrap', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify(body),
  });
}

function payload(overrides = {}) {
  return {
    access_token: META_ACCESS_TOKEN,
    credential_ref: CREDENTIAL_REF,
    instagram_business_account_id: ACCOUNT_ID,
    ...overrides,
  };
}

test('staging bootstrap seals one encrypted analytics credential without returning source inputs', async () => {
  const db = new FakeDb();
  const env = environment(db);
  let graphCalls = 0;
  env.ANALYTICS_FETCH = async () => {
    graphCalls += 1;
    throw new Error('bootstrap must not call Meta');
  };

  const response = await handleRequest(request(payload()), env);
  const body = await response.json();
  assert.equal(response.status, 201);
  assert.deepEqual(body, {
    ok: true,
    bootstrap: 'sealed',
    contract_version: 'influencer-intelligence/staging-bootstrap/v1',
    provider: 'meta-graph',
    requestId: body.requestId,
  });
  assert.equal(typeof body.requestId, 'string');
  assert.equal(JSON.stringify(body).includes(META_ACCESS_TOKEN), false);
  assert.equal(JSON.stringify(body).includes(ACCOUNT_ID), false);
  assert.equal(JSON.stringify(body).includes(CREDENTIAL_REF), false);
  assert.equal(graphCalls, 0);
  assert.equal(db.tokens.length, 1);
  assert.equal(db.tokens[0].id, CREDENTIAL_REF);
  assert.equal(db.tokens[0].provider, 'instagram');
  assert.equal(db.tokens[0].unit, 'influencer-intelligence-shadow');
  assert.equal(db.tokens[0].external_account_id, ACCOUNT_ID);
  assert.equal(db.tokens[0].active, 1);
  assert.equal(db.tokens[0].token_ciphertext.includes(META_ACCESS_TOKEN), false);
  assert.deepEqual(JSON.parse(db.tokens[0].metadata_json), {
    analytics_scopes: ['influencer-intelligence'],
    credential_purpose: 'influencer-intelligence-shadow',
    bootstrap_contract: 'influencer-intelligence/staging-bootstrap/v1',
  });
  assert.equal(db.audit.length, 1);
  assert.equal(db.audit[0][1], CREDENTIAL_REF);
  assert.equal(db.audit[0][2], 'analytics.staging_bootstrap');
  assert.equal(db.audit[0][6], 'ok');
  assert.equal(JSON.stringify(db.audit).includes(META_ACCESS_TOKEN), false);
  assert.equal(JSON.stringify(db.audit).includes(ACCOUNT_ID), false);
  assert.equal(JSON.stringify(db.audit).includes(CREDENTIAL_REF), true, 'foreign-key audit may retain the sealed internal reference');
});

test('bootstrap is one-time and cannot replace an existing Instagram credential', async () => {
  const db = new FakeDb();
  const env = environment(db);
  const first = await handleRequest(request(payload()), env);
  assert.equal(first.status, 201);

  const repeated = await handleRequest(request(payload()), env);
  assert.equal(repeated.status, 409);
  const repeatedBody = await repeated.json();
  assert.equal(repeatedBody.error, 'bootstrap_already_sealed');
  assert.equal(JSON.stringify(repeatedBody).includes(CREDENTIAL_REF), false);
  assert.equal(db.tokens.length, 1);

  const differentRef = await handleRequest(request(payload({ credential_ref: 'ig-analytics-shadow-unit-002' })), env);
  assert.equal(differentRef.status, 409);
  assert.equal((await differentRef.json()).error, 'bootstrap_existing_credential');
  assert.equal(db.tokens.length, 1);
});

test('bootstrap authentication is exclusive to the single staging route', async () => {
  const db = new FakeDb();
  const env = environment(db);
  const wrongRoute = await handleRequest(
    new Request('https://api-staging.skincos.com.br/internal/token-vault/health', {
      headers: { Authorization: `Bearer ${BOOTSTRAP_TOKEN}` },
    }),
    env,
  );
  assert.equal(wrongRoute.status, 403);
  assert.equal((await wrongRoute.json()).error, 'bootstrap_endpoint_required');

  const analyticsRoute = await handleRequest(
    new Request('https://api-staging.skincos.com.br/internal/token-vault/v1/analytics/operations', {
      method: 'POST',
      headers: { Authorization: `Bearer ${BOOTSTRAP_TOKEN}`, 'content-type': 'application/json' },
      body: JSON.stringify({}),
    }),
    env,
  );
  assert.equal(analyticsRoute.status, 403);
  assert.equal((await analyticsRoute.json()).error, 'bootstrap_endpoint_required');

  const wrongRole = await handleRequest(request(payload(), ANALYTICS_TOKEN), env);
  assert.equal(wrongRole.status, 403);
  assert.equal((await wrongRole.json()).error, 'staging_bootstrap_credential_required');
  assert.equal(db.tokens.length, 0);
});

test('bootstrap secret fails closed outside disabled staging shadow', async () => {
  const productionDb = new FakeDb();
  const production = await handleRequest(request(payload()), environment(productionDb, { ENVIRONMENT: 'production' }));
  assert.equal(production.status, 500);
  assert.equal((await production.json()).error, 'invalid_worker_secret_configuration');
  assert.equal(productionDb.tokens.length, 0);

  const enabledDb = new FakeDb();
  const enabled = await handleRequest(request(payload()), environment(enabledDb, { INFLUENCER_INTELLIGENCE_ENABLED: 'true' }));
  assert.equal(enabled.status, 500);
  assert.equal((await enabled.json()).error, 'invalid_worker_secret_configuration');
  assert.equal(enabledDb.tokens.length, 0);

  const implicitDb = new FakeDb();
  const implicit = await handleRequest(request(payload()), environment(implicitDb, { INFLUENCER_INTELLIGENCE_ENABLED: undefined }));
  assert.equal(implicit.status, 500);
  assert.equal((await implicit.json()).error, 'invalid_worker_secret_configuration');
  assert.equal(implicitDb.tokens.length, 0);
});

test('bootstrap rejects malformed inputs and rolls back the credential when the atomic audit write fails', async () => {
  const malformedDb = new FakeDb();
  const malformed = await handleRequest(request({ ...payload(), arbitrary_path: 'https://example.invalid' }), environment(malformedDb));
  assert.equal(malformed.status, 400);
  assert.equal((await malformed.json()).error, 'invalid_request');
  assert.equal(malformedDb.tokens.length, 0);
  assert.equal(JSON.stringify(malformedDb.audit).includes(META_ACCESS_TOKEN), false);

  const failedBatchDb = new FakeDb();
  failedBatchDb.failBatch = true;
  const failedBatch = await handleRequest(request(payload()), environment(failedBatchDb));
  assert.equal(failedBatch.status, 503);
  assert.equal((await failedBatch.json()).error, 'bootstrap_unavailable');
  assert.equal(failedBatchDb.tokens.length, 0);
  assert.equal(failedBatchDb.audit.length, 1);
  assert.equal(failedBatchDb.audit[0][6], 'bootstrap_unavailable');
  assert.equal(JSON.stringify(failedBatchDb.audit).includes(META_ACCESS_TOKEN), false);
});
