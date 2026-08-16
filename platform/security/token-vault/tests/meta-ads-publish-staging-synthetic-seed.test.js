import assert from 'node:assert/strict';
import test from 'node:test';
import {
  attestStagingSyntheticMetaAdsTracking,
  rollbackStagingSyntheticMetaAdsTracking,
  seedStagingSyntheticMetaAdsTracking,
} from '../src/meta-ads-publish.js';

const ACCOUNT_ID = '17841400000000001';
const PIXEL_ID = '99444000000000001';
const PAGE_ID = '12000000000000001';
const INSTAGRAM_ID = '17841400000000002';
const DATASET_ID = '19944000000000001';
const SOURCE_ACCESS_TOKEN = 'unit-test-source-access-token-not-a-real-secret';
const MISMATCH_ACCOUNT_ID = '17841400000000009';

class SeedStatement {
  constructor(db, sql) {
    this.db = db;
    this.sql = sql;
    this.values = [];
  }

  bind(...values) {
    this.values = values;
    return this;
  }

  first() {
    return this.db.first(this.sql, this.values);
  }

  all() {
    return this.db.all(this.sql, this.values);
  }

  run() {
    return this.db.run(this.sql, this.values);
  }
}

class SeedDb {
  constructor() {
    this.locks = new Map();
    this.adsetLocks = new Map();
    this.blockAdsetLocks = false;
    this.adsetLockReads = [];
    this.operations = new Map();
    this.tokens = [];
  }

  prepare(sql) {
    return new SeedStatement(this, sql);
  }

  async first(sql, values) {
    const normalized = compactSql(sql);
    if (normalized.startsWith('select resource_key, owner_id from meta_ads_publish_config_locks')) {
      const lock = this.locks.get(values[0]);
      return lock ? { resource_key: values[0], owner_id: lock.owner_id } : null;
    }
    if (normalized.includes('from meta_ads_publish_locks where resource_key = ?')) {
      const resourceKey = values[0];
      this.adsetLockReads.push(resourceKey);
      const lock = this.blockAdsetLocks
        ? {
          resource_key: resourceKey,
          run_id: 'independent-stage-run',
          operation_key: 'independent-stage-operation',
          expires_at: new Date(Date.now() + 60_000).toISOString(),
        }
        : this.adsetLocks.get(resourceKey);
      return lock ? { ...lock } : null;
    }
    if (
      normalized.startsWith('select count(*) as count from credential_tokens') &&
      normalized.includes('unit = ?') &&
      normalized.includes('id in')
    ) {
      const [unit, ...ids] = values;
      return {
        count: this.tokens.filter((token) => (
          token.provider === 'facebook' &&
          token.unit === unit &&
          token.active === 1 &&
          ids.includes(token.id)
        )).length,
      };
    }
    if (normalized.startsWith('select count(*) as count from credential_tokens where provider = ?')) {
      return { count: this.tokens.filter((token) => token.provider === values[0] && token.active === 1).length };
    }
    if (normalized.startsWith('select id, operation_key, status from meta_ads_publish_staging_seed_operations where status in')) {
      return [...this.operations.values()].find((operation) => [
        'pending', 'creating', 'rolling_back', 'reconciliation_required',
      ].includes(operation.status)) || null;
    }
    if (normalized.includes('from meta_ads_publish_staging_seed_operations where operation_key = ?')) {
      return this.operations.get(values[0]) || null;
    }
    throw new Error(`Unexpected D1 first: ${normalized}`);
  }

  async all(sql) {
    const normalized = compactSql(sql);
    if (normalized.includes('from credential_tokens') && normalized.includes("where provider = 'facebook' and active = 1")) {
      return {
        results: this.tokens
          .filter((token) => token.provider === 'facebook' && token.active === 1)
          .sort((left, right) => `${left.unit}:${left.external_account_id}`.localeCompare(`${right.unit}:${right.external_account_id}`))
          .map((token) => ({
            id: token.id,
            unit: token.unit,
            external_account_id: token.external_account_id,
            token_type: token.token_type,
            expires_at: null,
            active: token.active,
            metadata_json: token.metadata_json,
            updated_at: token.updated_at,
          })),
      };
    }
    throw new Error(`Unexpected D1 all: ${normalized}`);
  }

  async run(sql, values) {
    const normalized = compactSql(sql);
    if (normalized.startsWith('delete from meta_ads_publish_config_locks where resource_key = ? and expires_at <= ?')) {
      return changes(0);
    }
    if (normalized.startsWith('insert into meta_ads_publish_config_locks')) {
      const [resourceKey, ownerId, expiresAt] = values;
      const current = this.locks.get(resourceKey);
      if (!current || current.expires_at <= new Date().toISOString()) {
        this.locks.set(resourceKey, { owner_id: ownerId, expires_at: expiresAt });
        return changes(1);
      }
      return changes(0);
    }
    if (normalized.startsWith('update meta_ads_publish_config_locks set expires_at = ?, updated_at = ?')) {
      const [, , resourceKey, ownerId] = values;
      const current = this.locks.get(resourceKey);
      if (!current || current.owner_id !== ownerId) return changes(0);
      current.expires_at = values[0];
      return changes(1);
    }
    if (normalized.startsWith('delete from meta_ads_publish_config_locks where resource_key = ? and owner_id = ?')) {
      const [resourceKey, ownerId] = values;
      if (this.locks.get(resourceKey)?.owner_id !== ownerId) return changes(0);
      this.locks.delete(resourceKey);
      return changes(1);
    }
    if (normalized.startsWith('insert into meta_ads_publish_locks')) {
      const [resourceKey, runId, operationKey, , expiresAt] = values;
      const current = this.adsetLocks.get(resourceKey);
      if (
        current &&
        new Date(current.expires_at).getTime() > Date.now() &&
        (current.run_id !== runId || current.operation_key !== operationKey)
      ) {
        return changes(0);
      }
      this.adsetLocks.set(resourceKey, {
        resource_key: resourceKey,
        run_id: runId,
        operation_key: operationKey,
        expires_at: expiresAt,
      });
      return changes(1);
    }
    if (normalized.startsWith('delete from meta_ads_publish_locks where run_id = ? and operation_key = ?')) {
      const [runId, operationKey] = values;
      for (const [resourceKey, lock] of this.adsetLocks) {
        if (lock.run_id === runId && lock.operation_key === operationKey) this.adsetLocks.delete(resourceKey);
      }
      return changes(1);
    }
    if (normalized.startsWith('update credential_tokens set active = 0')) {
      const [, id, provider, unit, tokenType] = values;
      const token = this.tokens.find((entry) => (
        entry.id === id &&
        entry.provider === provider &&
        entry.unit === unit &&
        entry.token_type === tokenType &&
        entry.active === 1
      ));
      if (!token) return changes(0);
      token.active = 0;
      token.updated_at = values[0];
      return changes(1);
    }
    if (normalized.startsWith('insert into meta_ads_publish_staging_seed_operations')) {
      const [id, operationKey, requestHash, status, stateCiphertext, summaryJson, createdAt, updatedAt] = values;
      if (this.operations.has(operationKey)) throw new Error('UNIQUE constraint failed');
      this.operations.set(operationKey, {
        id,
        operation_key: operationKey,
        request_hash: requestHash,
        status,
        state_ciphertext: stateCiphertext,
        summary_json: summaryJson,
        created_at: createdAt,
        updated_at: updatedAt,
      });
      return changes(1);
    }
    if (normalized.startsWith('update meta_ads_publish_staging_seed_operations set status = ?, state_ciphertext = ?')) {
      const [status, stateCiphertext, summaryJson, updatedAt, id, operationKey] = values;
      const operation = this.operations.get(operationKey);
      if (!operation || operation.id !== id) return changes(0);
      Object.assign(operation, {
        status,
        state_ciphertext: stateCiphertext,
        summary_json: summaryJson,
        updated_at: updatedAt,
      });
      return changes(1);
    }
    throw new Error(`Unexpected D1 run: ${normalized}`);
  }

  async batch(statements) {
    const stagedTokens = [];
    const stagedDeactivations = [];
    let operationUpdate = null;

    for (const statement of statements) {
      const normalized = compactSql(statement.sql);
      if (normalized.startsWith('insert into credential_tokens')) {
        const [id, provider, unit, externalAccountId, tokenType, tokenCiphertext, metadataJson, createdAt, updatedAt] = statement.values;
        stagedTokens.push({
          id,
          provider,
          unit,
          external_account_id: externalAccountId,
          token_type: tokenType,
          token_ciphertext: tokenCiphertext,
          metadata_json: metadataJson,
          active: 1,
          created_at: createdAt,
          updated_at: updatedAt,
        });
        continue;
      }
      if (normalized.startsWith('update credential_tokens set active = 0')) {
        const [, id, provider, unit, tokenType] = statement.values;
        stagedDeactivations.push({ id, provider, unit, tokenType, updatedAt: statement.values[0] });
        continue;
      }
      if (normalized.startsWith('update meta_ads_publish_staging_seed_operations set status =')) {
        const [stateCiphertext, summaryJson, updatedAt, operationId, operationKey] = statement.values;
        operationUpdate = {
          status: normalized.includes("set status = 'sealed'") ? 'sealed' : 'rolled_back',
          stateCiphertext,
          summaryJson,
          updatedAt,
          operationId,
          operationKey,
        };
        continue;
      }
      throw new Error(`Unexpected D1 batch statement: ${normalized}`);
    }

    if (!operationUpdate) throw new Error('seed batch missing operation update');
    const operation = this.operations.get(operationUpdate.operationKey);
    if (!operation || operation.id !== operationUpdate.operationId) {
      throw new Error('seed operation missing');
    }
    if (stagedTokens.some((token) => this.tokens.some((existing) => existing.id === token.id))) {
      throw new Error('UNIQUE constraint failed');
    }
    for (const deactivation of stagedDeactivations) {
      const token = this.tokens.find((entry) => (
        entry.id === deactivation.id &&
        entry.provider === deactivation.provider &&
        entry.unit === deactivation.unit &&
        entry.token_type === deactivation.tokenType &&
        entry.active === 1
      ));
      if (!token) throw new Error('seed credential missing for deactivate');
    }
    this.tokens.push(...stagedTokens);
    for (const deactivation of stagedDeactivations) {
      const token = this.tokens.find((entry) => entry.id === deactivation.id);
      token.active = 0;
      token.updated_at = deactivation.updatedAt;
    }
    Object.assign(operation, {
      status: operationUpdate.status,
      state_ciphertext: operationUpdate.stateCiphertext,
      summary_json: operationUpdate.summaryJson,
      updated_at: operationUpdate.updatedAt,
    });
    return statements.map(() => changes(1));
  }
}

class FakeGraph {
  constructor({ ambiguousCreatePath = '' } = {}) {
    this.ambiguousCreatePath = ambiguousCreatePath;
    this.calls = [];
    this.postCalls = [];
    this.resources = new Map();
    this.nextId = 23800000000000001n;
  }

  async fetch(url, init = {}) {
    const target = new URL(url);
    const path = target.pathname.replace(/^\/v\d+\.0\//, '');
    const method = String(init.method || 'GET').toUpperCase();
    this.calls.push({ path, method });
    if (init.headers?.get?.('Authorization') !== `Bearer ${SOURCE_ACCESS_TOKEN}`) {
      return graphResponse({ error: { message: 'invalid auth' } }, 401);
    }

    if (method === 'GET') return this.read(path);

    this.postCalls.push(path);
    const body = JSON.parse(init.body || '{}');
    if (this.resources.has(path) && body.status === 'ARCHIVED') {
      const resource = this.resources.get(path);
      resource.body = { ...resource.body, status: 'ARCHIVED' };
      return graphResponse({ success: true });
    }
    if (path === this.ambiguousCreatePath) {
      return graphResponse({ error: { message: 'transient unit failure', is_transient: true } }, 503);
    }
    return this.create(path, body);
  }

  read(path) {
    if (path === PIXEL_ID) {
      return graphResponse({ id: PIXEL_ID, owner_ad_account: { id: ACCOUNT_ID } });
    }
    if (path === 'me/accounts') {
      return graphResponse({ data: [{ id: PAGE_ID, tasks: ['ADVERTISE'], instagram_business_account: { id: INSTAGRAM_ID } }] });
    }
    if (path === PAGE_ID) {
      return graphResponse({
        id: PAGE_ID,
        instagram_business_account: { id: INSTAGRAM_ID },
        website: 'https://staging.example.invalid/tracking-fixture',
        picture: { data: { url: 'https://cdn.example.invalid/staging-fixture.jpg' } },
      });
    }
    if (path === `act_${ACCOUNT_ID}/offline_conversion_data_sets`) {
      return graphResponse({ data: [{ id: DATASET_ID }] });
    }
    const resource = this.resources.get(path);
    if (!resource) return graphResponse({ error: { message: 'not found' } }, 404);
    if (resource.kind === 'campaign') {
      return graphResponse({
        id: resource.id,
        name: resource.body.name,
        objective: resource.body.objective,
        buying_type: resource.body.buying_type,
        special_ad_categories: resource.body.special_ad_categories,
        is_adset_budget_sharing_enabled: resource.body.is_adset_budget_sharing_enabled,
        status: resource.body.status,
      });
    }
    if (resource.kind === 'adset') {
      return graphResponse({
        id: resource.id,
        name: resource.body.name,
        account_id: ACCOUNT_ID,
        campaign_id: resource.body.campaign_id,
        campaign: { id: resource.body.campaign_id, objective: 'OUTCOME_LEADS' },
        status: resource.body.status,
        billing_event: resource.body.billing_event,
        optimization_goal: resource.body.optimization_goal,
        destination_type: resource.body.destination_type,
        attribution_spec: resource.body.attribution_spec,
        promoted_object: resource.body.promoted_object,
      });
    }
    if (resource.kind === 'creative') {
      return graphResponse({ id: resource.id, name: resource.body.name, url_tags: resource.body.url_tags });
    }
    if (resource.kind === 'ad') {
      return graphResponse({
        id: resource.id,
        name: resource.body.name,
        adset_id: resource.body.adset_id,
        creative: { id: resource.body.creative.creative_id },
        status: resource.body.status,
        effective_status: 'PAUSED',
      });
    }
    throw new Error(`Unsupported fake resource type ${resource.kind}`);
  }

  create(path, body) {
    const kinds = new Map([
      [`act_${ACCOUNT_ID}/campaigns`, 'campaign'],
      [`act_${ACCOUNT_ID}/adsets`, 'adset'],
      [`act_${ACCOUNT_ID}/adcreatives`, 'creative'],
      [`act_${ACCOUNT_ID}/ads`, 'ad'],
    ]);
    const kind = kinds.get(path);
    if (!kind) return graphResponse({ error: { message: 'unsupported mutation' } }, 400);
    const id = String(this.nextId++);
    this.resources.set(id, { id, kind, body });
    return graphResponse({ id });
  }
}

function compactSql(sql) {
  return String(sql).replace(/\s+/g, ' ').trim().toLowerCase();
}

function changes(count) {
  return { success: true, meta: { changes: count } };
}

function graphResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function environment(db, graph, overrides = {}) {
  return {
    ENVIRONMENT: 'staging',
    TOKEN_VAULT_DB: db,
    META_GRAPH_FETCH: graph.fetch.bind(graph),
    META_GRAPH_SLEEP: async () => {},
    ...overrides,
  };
}

function request(operationKey, overrides = {}) {
  return new Request('https://token-vault.invalid/v1/meta-ads-publish/config/staging-synthetic-seed', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      operation_key: operationKey,
      access_token: SOURCE_ACCESS_TOKEN,
      account_id: ACCOUNT_ID,
      pixel_id: PIXEL_ID,
      api_version: 'v25.0',
      ...overrides,
    }),
  });
}

async function encrypt(value) {
  return `enc:${Buffer.from(value).toString('base64')}`;
}

async function decrypt(value) {
  if (!String(value).startsWith('enc:')) throw new Error('ciphertext unavailable');
  return Buffer.from(String(value).slice(4), 'base64').toString();
}

async function seed({ db, graph, operationKey, env = {} }) {
  return seedStagingSyntheticMetaAdsTracking({
    request: request(operationKey),
    env: environment(db, graph, env),
    requestId: 'seed-test-request-id',
    encryptToken: encrypt,
    writeAudit: async () => {},
  });
}

function attestRequest(operationKey, overrides = {}) {
  return new Request('https://token-vault.invalid/v1/meta-ads-publish/config/staging-synthetic-seed/attest', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      operation_key: operationKey,
      access_token: SOURCE_ACCESS_TOKEN,
      account_id: ACCOUNT_ID,
      pixel_id: PIXEL_ID,
      api_version: 'v25.0',
      ...overrides,
    }),
  });
}

async function attest({ db, graph, operationKey, env = {}, requestOverrides = {} }) {
  return attestStagingSyntheticMetaAdsTracking({
    request: attestRequest(operationKey, requestOverrides),
    env: environment(db, graph, env),
    requestId: 'seed-attestation-test-request-id',
  });
}

function rollbackRequest(operationKey, overrides = {}) {
  return new Request('https://token-vault.invalid/v1/meta-ads-publish/config/staging-synthetic-seed/rollback', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      operation_key: operationKey,
      access_token: SOURCE_ACCESS_TOKEN,
      account_id: ACCOUNT_ID,
      api_version: 'v25.0',
      ...overrides,
    }),
  });
}

async function rollback({ db, graph, operationKey, env = {} }) {
  return rollbackStagingSyntheticMetaAdsTracking({
    request: rollbackRequest(operationKey),
    env: environment(db, graph, env),
    requestId: 'seed-rollback-test-request-id',
    decryptToken: decrypt,
    encryptToken: encrypt,
    writeAudit: async () => {},
  });
}

async function pendingSeedState(operationKey) {
  return {
    contract: 'meta-ads-tracking-v20/staging-synthetic-seed/v1',
    phase: 'pending',
    reconciliation_required: false,
    input: {
      operation_key: operationKey,
      account_id: ACCOUNT_ID,
      pixel_id: PIXEL_ID,
      api_version: 'v25.0',
    },
    marker: 'a'.repeat(64),
    url_tags: 'skincos_staging_v20=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    credential_ids: {
      source: 'staging.meta-ads.source.aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      target: 'staging.meta-ads.target.aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    },
    credentials_sealed: false,
    facts: {},
    resources: {},
  };
}

function operationSnapshot(db, operationKey) {
  const operation = db.operations.get(operationKey);
  return {
    operation: operation ? { ...operation } : null,
    tokens: db.tokens.map((token) => ({ ...token })),
  };
}

test('staging seed is staging-only and redacts all source inputs from a closed response', async () => {
  const db = new SeedDb();
  const graph = new FakeGraph();
  const response = await seed({
    db,
    graph,
    operationKey: 'meta-ads-staging-seed:production-denied-001',
    env: { ENVIRONMENT: 'production' },
  });
  const body = await response.json();

  assert.equal(response.status, 503);
  assert.equal(body.error, 'meta_ads_publish_staging_seed_disabled');
  assert.equal(graph.calls.length, 0);
  assert.equal(db.tokens.length, 0);
  assert.equal(JSON.stringify(body).includes(SOURCE_ACCESS_TOKEN), false);
  assert.equal(JSON.stringify(body).includes(ACCOUNT_ID), false);
  assert.equal(JSON.stringify(body).includes(PIXEL_ID), false);
});

test('staging seed attestation is staging-only and touches neither D1 nor Graph outside staging', async () => {
  const db = new SeedDb();
  const graph = new FakeGraph();
  const response = await attest({
    db,
    graph,
    operationKey: 'meta-ads-staging-seed:attestation-production-denied-001',
    env: { ENVIRONMENT: 'production' },
  });
  const body = await response.json();

  assert.equal(response.status, 503);
  assert.equal(body.error, 'meta_ads_publish_staging_seed_disabled');
  assert.equal(graph.calls.length, 0);
  assert.equal(graph.postCalls.length, 0);
  assert.equal(db.operations.size, 0);
  assert.equal(db.tokens.length, 0);
  assert.equal(db.locks.size, 0);
  assert.equal(JSON.stringify(body).includes(SOURCE_ACCESS_TOKEN), false);
  assert.equal(JSON.stringify(body).includes(ACCOUNT_ID), false);
  assert.equal(JSON.stringify(body).includes(PIXEL_ID), false);
});

test('staging seed attestation bounds Graph discovery and returns no source facts', async () => {
  const db = new SeedDb();
  const graph = new FakeGraph();
  const operationKey = 'meta-ads-staging-seed:attestation-match-001';
  const response = await attest({ db, graph, operationKey });
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.deepEqual(body, {
    ok: true,
    attestation: 'match',
    operation_key: operationKey,
    contract_version: 'meta-ads-tracking-v20/staging-synthetic-seed/v1',
    requestId: 'seed-attestation-test-request-id',
  });
  assert.equal(graph.calls.length, 4);
  assert.ok(graph.calls.every((call) => call.method === 'GET'));
  assert.equal(graph.postCalls.length, 0);
  assert.equal(db.operations.size, 0);
  assert.equal(db.tokens.length, 0);
  assert.equal(db.locks.size, 0);
  assert.equal(db.adsetLocks.size, 0);
  const serialized = JSON.stringify(body);
  for (const value of [SOURCE_ACCESS_TOKEN, ACCOUNT_ID, PIXEL_ID, PAGE_ID, INSTAGRAM_ID, DATASET_ID]) {
    assert.equal(serialized.includes(value), false);
  }
});

test('staging seed attestation exposes only finite mismatch, malformed, and source-unavailable outcomes', async () => {
  const mismatchDb = new SeedDb();
  const mismatchGraph = new FakeGraph();
  const mismatch = await attest({
    db: mismatchDb,
    graph: mismatchGraph,
    operationKey: 'meta-ads-staging-seed:attestation-mismatch-001',
    requestOverrides: { account_id: MISMATCH_ACCOUNT_ID },
  });
  const mismatchBody = await mismatch.json();
  assert.equal(mismatch.status, 409);
  assert.equal(mismatchBody.error, 'meta_ads_publish_staging_seed_graph_identity_mismatch');
  assert.equal(mismatchGraph.calls.length, 1);
  assert.equal(mismatchGraph.postCalls.length, 0);
  assert.equal(mismatchDb.operations.size, 0);
  assert.equal(mismatchDb.tokens.length, 0);

  const malformedDb = new SeedDb();
  const malformed = await attest({
    db: malformedDb,
    graph: new FakeGraph(),
    operationKey: 'meta-ads-staging-seed:attestation-malformed-001',
    env: {
      META_GRAPH_FETCH: async () => graphResponse({ id: PIXEL_ID, owner_ad_account: { id: 'not-a-graph-id' } }),
    },
  });
  const malformedBody = await malformed.json();
  assert.equal(malformed.status, 409);
  assert.equal(malformedBody.error, 'meta_ads_publish_staging_seed_graph_identity_malformed');
  assert.equal(malformedDb.operations.size, 0);
  assert.equal(malformedDb.tokens.length, 0);

  const unavailableDb = new SeedDb();
  const unavailable = await attest({
    db: unavailableDb,
    graph: new FakeGraph(),
    operationKey: 'meta-ads-staging-seed:attestation-unavailable-001',
    env: {
      META_GRAPH_FETCH: async () => graphResponse({ error: { message: 'denied' } }, 403),
    },
  });
  const unavailableBody = await unavailable.json();
  assert.equal(unavailable.status, 409);
  assert.equal(unavailableBody.error, 'meta_ads_publish_staging_seed_graph_source_unavailable');
  assert.equal(unavailableDb.operations.size, 0);
  assert.equal(unavailableDb.tokens.length, 0);

  for (const body of [mismatchBody, malformedBody, unavailableBody]) {
    const serialized = JSON.stringify(body);
    for (const value of [SOURCE_ACCESS_TOKEN, ACCOUNT_ID, MISMATCH_ACCOUNT_ID, PIXEL_ID]) {
      assert.equal(serialized.includes(value), false);
    }
  }
});

test('staging seed creates exactly two distinct active Facebook credentials from PAUSED synthetic Graph resources', async () => {
  const db = new SeedDb();
  const graph = new FakeGraph();
  const operationKey = 'meta-ads-staging-seed:happy-path-001';
  const response = await seed({ db, graph, operationKey });
  const body = await response.json();

  assert.equal(response.status, 201);
  assert.deepEqual(body, {
    ok: true,
    seed: 'sealed',
    operation_status: 'sealed',
    replayed: false,
    operation_key: operationKey,
    contract_version: 'meta-ads-tracking-v20/staging-synthetic-seed/v1',
    requestId: 'seed-test-request-id',
  });
  assert.equal(JSON.stringify(body).includes(SOURCE_ACCESS_TOKEN), false);
  assert.equal(JSON.stringify(body).includes(ACCOUNT_ID), false);
  assert.equal(JSON.stringify(body).includes(PIXEL_ID), false);

  assert.equal(db.tokens.length, 2);
  assert.equal(new Set(db.tokens.map((token) => token.id)).size, 2);
  assert.deepEqual(new Set(db.tokens.map((token) => token.provider)), new Set(['facebook']));
  assert.deepEqual(new Set(db.tokens.map((token) => token.active)), new Set([1]));
  assert.deepEqual(
    new Set(db.tokens.map((token) => token.token_type)),
    new Set(['staging_synthetic_source', 'staging_synthetic_target']),
  );
  assert.ok(db.tokens.every((token) => token.token_ciphertext.includes(SOURCE_ACCESS_TOKEN) === false));

  const metadata = db.tokens.map((token) => JSON.parse(token.metadata_json).meta_ads_publish);
  assert.equal(metadata.filter((entry) => entry.source_config_token_id).length, 1);
  assert.equal(metadata.filter((entry) => entry.source_adset_id).length, 1);
  assert.ok(metadata.every((entry) => entry.destination_type === 'website'));
  assert.ok(metadata.every((entry) => entry.url_tags.startsWith('skincos_staging_v20=')));

  assert.deepEqual(graph.postCalls, [
    `act_${ACCOUNT_ID}/campaigns`,
    `act_${ACCOUNT_ID}/adsets`,
    `act_${ACCOUNT_ID}/adsets`,
    `act_${ACCOUNT_ID}/adcreatives`,
    `act_${ACCOUNT_ID}/ads`,
  ]);
  const deliveryResources = [...graph.resources.values()].filter((resource) => resource.kind !== 'creative');
  assert.equal(deliveryResources.length, 4);
  assert.ok(deliveryResources.every((resource) => resource.body.status === 'PAUSED'));
  assert.equal(db.operations.get(operationKey).status, 'sealed');
  assert.equal(JSON.stringify({ operations: [...db.operations.values()], tokens: db.tokens }).includes(SOURCE_ACCESS_TOKEN), false);
});

test('a matching sealed operation replays idempotently without another Graph mutation', async () => {
  const db = new SeedDb();
  const graph = new FakeGraph();
  const operationKey = 'meta-ads-staging-seed:replay-001';
  const first = await seed({ db, graph, operationKey });
  assert.equal(first.status, 201);
  const postCount = graph.postCalls.length;

  const replay = await seed({ db, graph, operationKey });
  const body = await replay.json();
  assert.equal(replay.status, 200);
  assert.equal(body.seed, 'sealed');
  assert.equal(body.replayed, true);
  assert.equal(graph.postCalls.length, postCount);
  assert.equal(db.tokens.length, 2);
});

test('an ambiguous synthetic POST is never retried and leaves the operation fail-closed for reconciliation', async () => {
  const db = new SeedDb();
  const graph = new FakeGraph({ ambiguousCreatePath: `act_${ACCOUNT_ID}/campaigns` });
  const operationKey = 'meta-ads-staging-seed:ambiguous-post-001';
  const response = await seed({ db, graph, operationKey });
  const body = await response.json();

  assert.equal(response.status, 409);
  assert.equal(body.error, 'meta_ads_publish_staging_seed_reconciliation_required');
  assert.deepEqual(graph.postCalls, [`act_${ACCOUNT_ID}/campaigns`]);
  assert.equal(db.tokens.length, 0);
  assert.equal(db.operations.get(operationKey).status, 'reconciliation_required');
  assert.equal(JSON.stringify(body).includes(SOURCE_ACCESS_TOKEN), false);
  assert.equal(JSON.stringify(body).includes(ACCOUNT_ID), false);
});

test('rollback rejects a drifted seeded authority before it mutates Graph delivery or D1 credentials', async () => {
  const db = new SeedDb();
  const graph = new FakeGraph();
  const operationKey = 'meta-ads-staging-seed:rollback-authority-stale-001';
  const created = await seed({ db, graph, operationKey });
  assert.equal(created.status, 201);

  const source = db.tokens.find((token) => token.token_type === 'staging_synthetic_source');
  const sourceMetadata = JSON.parse(source.metadata_json);
  sourceMetadata.meta_ads_publish.url_tags = 'skincos_staging_v20=authority_drifted';
  source.metadata_json = JSON.stringify(sourceMetadata);

  const before = operationSnapshot(db, operationKey);
  const graphCallsBefore = graph.calls.length;
  const graphPostsBefore = graph.postCalls.length;
  const response = await rollback({ db, graph, operationKey });
  const body = await response.json();

  assert.equal(response.status, 409);
  assert.equal(body.ok, false);
  assert.equal(graph.calls.length, graphCallsBefore);
  assert.equal(graph.postCalls.length, graphPostsBefore);
  assert.deepEqual(operationSnapshot(db, operationKey), before);
  assert.equal(db.tokens.every((token) => token.active === 1), true);
  assert.equal(JSON.stringify(body).includes(SOURCE_ACCESS_TOKEN), false);
});

test('normal rollback archives every delivery object, deactivates both credentials, and leaves the detached creative inert', async () => {
  const db = new SeedDb();
  const graph = new FakeGraph();
  const operationKey = 'meta-ads-staging-seed:rollback-happy-001';
  const created = await seed({ db, graph, operationKey });
  assert.equal(created.status, 201);
  const mutationCountBeforeRollback = graph.postCalls.length;

  const response = await rollback({ db, graph, operationKey });
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.deepEqual(body, {
    ok: true,
    rolled_back: true,
    operation_status: 'rolled_back',
    replayed: false,
    operation_key: operationKey,
    contract_version: 'meta-ads-tracking-v20/staging-synthetic-seed/v1',
    requestId: 'seed-rollback-test-request-id',
  });
  assert.equal(db.operations.get(operationKey).status, 'rolled_back');
  assert.equal(db.tokens.length, 2);
  assert.equal(db.tokens.every((token) => token.active === 0), true);

  const delivery = [...graph.resources.values()].filter((resource) => resource.kind !== 'creative');
  assert.equal(delivery.length, 4);
  assert.equal(delivery.every((resource) => resource.body.status === 'ARCHIVED'), true);
  const creative = [...graph.resources.values()].find((resource) => resource.kind === 'creative');
  assert.ok(creative);
  assert.equal(creative.body.status, undefined);
  assert.equal(
    [...graph.resources.values()].filter((resource) => resource.kind === 'ad').every((resource) => resource.body.status === 'ARCHIVED'),
    true,
  );
  assert.equal(graph.postCalls.length, mutationCountBeforeRollback + 4);
});

test('an explicitly requested rollback can close a pending seed before any Graph object or credential exists', async () => {
  const db = new SeedDb();
  const graph = new FakeGraph();
  const operationKey = 'meta-ads-staging-seed:pending-rollback-001';
  const state = await pendingSeedState(operationKey);
  db.operations.set(operationKey, {
    id: 'seed-pending-operation-id',
    operation_key: operationKey,
    request_hash: 'opaque-test-request-hash',
    status: 'pending',
    state_ciphertext: await encrypt(JSON.stringify(state)),
    summary_json: JSON.stringify({ phase: 'pending' }),
    created_at: '2026-08-15T00:00:00.000Z',
    updated_at: '2026-08-15T00:00:00.000Z',
  });

  const response = await rollback({ db, graph, operationKey });
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.equal(body.ok, true);
  assert.equal(body.rolled_back, true);
  assert.equal(body.replayed, false);
  assert.equal(db.operations.get(operationKey).status, 'rolled_back');
  assert.equal(db.tokens.length, 0);
  assert.equal(graph.calls.length, 0);
  assert.equal(graph.postCalls.length, 0);
});

test('shared adset-contract leases stop a new seed before credential seal and a sealed rollback before delivery mutation', async () => {
  const contendedSeedDb = new SeedDb();
  contendedSeedDb.blockAdsetLocks = true;
  const contendedSeedGraph = new FakeGraph();
  const contendedSeedKey = 'meta-ads-staging-seed:adset-lock-seed-001';
  const seedResponse = await seed({ db: contendedSeedDb, graph: contendedSeedGraph, operationKey: contendedSeedKey });
  const seedBody = await seedResponse.json();

  assert.equal(seedResponse.status, 409);
  assert.equal(seedBody.ok, false);
  assert.equal(contendedSeedDb.tokens.length, 0);
  assert.notEqual(contendedSeedDb.operations.get(contendedSeedKey)?.status, 'sealed');
  assert.equal(
    [...contendedSeedGraph.resources.values()]
      .filter((resource) => resource.kind === 'creative' || resource.kind === 'ad').length,
    0,
  );
  assert.equal(
    [...contendedSeedGraph.resources.values()]
      .filter((resource) => resource.kind !== 'creative')
      .every((resource) => resource.body.status === 'PAUSED'),
    true,
  );
  assert.equal(
    contendedSeedDb.adsetLockReads.some((resourceKey) => resourceKey.startsWith(`adset-contract:${ACCOUNT_ID}:`)),
    true,
  );

  const db = new SeedDb();
  const graph = new FakeGraph();
  const operationKey = 'meta-ads-staging-seed:adset-lock-rollback-001';
  const created = await seed({ db, graph, operationKey });
  assert.equal(created.status, 201);
  db.blockAdsetLocks = true;
  const before = operationSnapshot(db, operationKey);
  const graphCallsBefore = graph.calls.length;
  const graphPostsBefore = graph.postCalls.length;

  const response = await rollback({ db, graph, operationKey });
  const body = await response.json();

  assert.ok(response.status >= 400);
  assert.equal(body.ok, false);
  assert.deepEqual(operationSnapshot(db, operationKey), before);
  assert.equal(graph.calls.length, graphCallsBefore);
  assert.equal(graph.postCalls.length, graphPostsBefore);
  assert.equal(
    db.adsetLockReads.some((resourceKey) => resourceKey.startsWith(`adset-contract:${ACCOUNT_ID}:`)),
    true,
  );
});
