import assert from 'node:assert/strict';
import test from 'node:test';
import {
  attestStagingSyntheticMetaAdsTracking,
  attestStagingSyntheticMetaAdsTrackingAppSecretProof,
  rollbackStagingSyntheticMetaAdsTracking,
  seedStagingSyntheticMetaAdsTracking,
} from '../src/meta-ads-publish.js';

const ACCOUNT_ID = '17841400000000001';
const BUSINESS_ID = '18841400000000001';
const PIXEL_ID = '99444000000000001';
const PAGE_ID = '12000000000000001';
const INSTAGRAM_ID = '17841400000000002';
const BARRA_SHOPPING_SUL_PAGE_ID = '12000000000000003';
const BARRA_SHOPPING_SUL_INSTAGRAM_ID = '17841400000000004';
const DESTINATION_PAGE_IDS = Object.freeze({
  novo_hamburgo: PAGE_ID,
  barra_shopping_sul: BARRA_SHOPPING_SUL_PAGE_ID,
});
const DATASET_ID = '19944000000000001';
const SYSTEM_USER_ID = '15500000000000001';
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
  constructor({ ambiguousCreatePath = '', readFailures = {}, readResponses = {} } = {}) {
    this.ambiguousCreatePath = ambiguousCreatePath;
    this.readFailures = new Map(Object.entries(readFailures));
    this.readResponses = new Map(Object.entries(readResponses));
    this.calls = [];
    this.postCalls = [];
    this.resources = new Map();
    this.nextId = 23800000000000001n;
  }

  async fetch(url, init = {}) {
    const target = new URL(url);
    const path = target.pathname.replace(/^\/v\d+\.0\//, '');
    const method = String(init.method || 'GET').toUpperCase();
    this.calls.push({
      path,
      method,
      query: Object.fromEntries(target.searchParams.entries()),
    });
    if (init.headers?.get?.('Authorization') !== `Bearer ${SOURCE_ACCESS_TOKEN}`) {
      return graphResponse({ error: { message: 'invalid auth' } }, 401);
    }

    if (method === 'GET') {
      const failure = this.readFailures.get(path);
      if (failure) {
        return graphResponse({ error: { message: 'source read denied', code: failure.code || 0 } }, failure.status ?? 403);
      }
      const response = this.readResponses.get(path);
      if (response) return graphResponse(response.body, response.status ?? 200);
      return this.read(path);
    }

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
      return graphResponse({ id: PIXEL_ID });
    }
    if (path === `act_${ACCOUNT_ID}/adspixels`) {
      return graphResponse({ data: [{ id: PIXEL_ID }] });
    }
    if (path === 'me') {
      return graphResponse({ id: SYSTEM_USER_ID });
    }
    if (path === `${SYSTEM_USER_ID}/assigned_pages`) {
      return graphResponse({
        data: [
          {
            id: PAGE_ID,
            tasks: ['ADVERTISE'],
            instagram_business_account: { id: INSTAGRAM_ID },
            website: 'https://staging.example.invalid/tracking-fixture',
            picture: { data: { url: 'https://cdn.example.invalid/staging-fixture.jpg' } },
          },
          {
            id: BARRA_SHOPPING_SUL_PAGE_ID,
            tasks: ['PROFILE_PLUS_ADVERTISE'],
            instagram_business_account: { id: BARRA_SHOPPING_SUL_INSTAGRAM_ID },
            website: 'https://staging-barra.example.invalid/tracking-fixture',
            picture: { data: { url: 'https://cdn.example.invalid/staging-barra-fixture.jpg' } },
          },
        ],
      });
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
    if (path === BARRA_SHOPPING_SUL_PAGE_ID) {
      return graphResponse({
        id: BARRA_SHOPPING_SUL_PAGE_ID,
        instagram_business_account: { id: BARRA_SHOPPING_SUL_INSTAGRAM_ID },
        website: 'https://staging-barra.example.invalid/tracking-fixture',
        picture: { data: { url: 'https://cdn.example.invalid/staging-barra-fixture.jpg' } },
      });
    }
    if (path === `act_${ACCOUNT_ID}`) {
      return graphResponse({ id: ACCOUNT_ID, business: { id: BUSINESS_ID } });
    }
    if (path === `${BUSINESS_ID}/ads_dataset`) {
      return graphResponse({ data: [{ id: DATASET_ID, dataset_id: DATASET_ID }] });
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
      destination_page_ids: DESTINATION_PAGE_IDS,
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

async function seed({ db, graph, operationKey, env = {}, requestOverrides = {} }) {
  return seedStagingSyntheticMetaAdsTracking({
    request: request(operationKey, requestOverrides),
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
      destination_page_ids: DESTINATION_PAGE_IDS,
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

function appSecretProofAttestRequest(operationKey, overrides = {}) {
  return new Request('https://token-vault.invalid/v1/meta-ads-publish/config/staging-synthetic-seed/attest-appsecret-proof', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      operation_key: operationKey,
      access_token: SOURCE_ACCESS_TOKEN,
      account_id: ACCOUNT_ID,
      pixel_id: PIXEL_ID,
      destination_page_ids: DESTINATION_PAGE_IDS,
      api_version: 'v25.0',
      ...overrides,
    }),
  });
}

async function attestAppSecretProof({ db, graph, operationKey, env = {}, requestOverrides = {} }) {
  return attestStagingSyntheticMetaAdsTrackingAppSecretProof({
    request: appSecretProofAttestRequest(operationKey, requestOverrides),
    env: environment(db, graph, env),
    requestId: 'seed-appsecret-proof-attestation-test-request-id',
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
    contract: 'meta-ads-tracking-v20/staging-synthetic-seed/v2',
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
    contract_version: 'meta-ads-tracking-v20/staging-synthetic-seed/v2',
    requestId: 'seed-attestation-test-request-id',
  });
  assert.equal(graph.calls.length, 6);
  assert.ok(graph.calls.every((call) => call.method === 'GET'));
  assert.deepEqual(
    graph.calls.find((call) => call.path === `${BUSINESS_ID}/ads_dataset`).query,
    { fields: 'id' },
  );
  assert.equal(graph.postCalls.length, 0);
  assert.equal(db.operations.size, 0);
  assert.equal(db.tokens.length, 0);
  assert.equal(db.locks.size, 0);
  assert.equal(db.adsetLocks.size, 0);
  const serialized = JSON.stringify(body);
  for (const value of [
    SOURCE_ACCESS_TOKEN, ACCOUNT_ID, PIXEL_ID, PAGE_ID, INSTAGRAM_ID,
    BARRA_SHOPPING_SUL_PAGE_ID, BARRA_SHOPPING_SUL_INSTAGRAM_ID, DATASET_ID,
  ]) {
    assert.equal(serialized.includes(value), false);
  }
});

test('staging seed attestation proves two explicitly selected System User Page and Instagram pairs before any mutation', async () => {
  const db = new SeedDb();
  db.prepare = () => {
    throw new Error('D1 must remain untouched by two-destination source attestation');
  };
  const alternatePageId = '12000000000000009';
  const alternateInstagramId = '17841400000000009';
  const graph = new FakeGraph({
    readResponses: {
      [`${SYSTEM_USER_ID}/assigned_pages`]: {
        body: {
          data: [
            {
              id: alternatePageId,
              tasks: ['ADVERTISE'],
              instagram_business_account: { id: alternateInstagramId },
              website: 'https://staging-alternate.example.invalid/tracking-fixture',
              picture: { data: { url: 'https://cdn.example.invalid/alternate-fixture.jpg' } },
            },
            {
              id: PAGE_ID,
              tasks: ['ADVERTISE'],
              instagram_business_account: { id: INSTAGRAM_ID },
              website: 'https://staging.example.invalid/tracking-fixture',
              picture: { data: { url: 'https://cdn.example.invalid/staging-fixture.jpg' } },
            },
            {
              id: BARRA_SHOPPING_SUL_PAGE_ID,
              tasks: ['PROFILE_PLUS_ADVERTISE'],
              instagram_business_account: { id: BARRA_SHOPPING_SUL_INSTAGRAM_ID },
              website: 'https://staging-barra.example.invalid/tracking-fixture',
              picture: { data: { url: 'https://cdn.example.invalid/staging-barra-fixture.jpg' } },
            },
          ],
        },
      },
    },
  });
  const response = await attest({
    db,
    graph,
    operationKey: 'meta-ads-staging-seed:attestation-two-destination-pages-001',
  });
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.equal(body.attestation, 'match');
  assert.deepEqual(graph.calls.map((call) => call.path), [
    PIXEL_ID,
    `act_${ACCOUNT_ID}/adspixels`,
    'me',
    `${SYSTEM_USER_ID}/assigned_pages`,
    `act_${ACCOUNT_ID}`,
    `${BUSINESS_ID}/ads_dataset`,
  ]);
  assert.ok(graph.calls.every((call) => call.method === 'GET'));
  assert.equal(graph.postCalls.length, 0);
  assert.equal(db.operations.size, 0);
  assert.equal(db.tokens.length, 0);
  assert.equal(db.locks.size, 0);
  assert.equal(db.adsetLocks.size, 0);
  const serialized = JSON.stringify(body);
  for (const value of [
    SOURCE_ACCESS_TOKEN, ACCOUNT_ID, PIXEL_ID, PAGE_ID, INSTAGRAM_ID,
    BARRA_SHOPPING_SUL_PAGE_ID, BARRA_SHOPPING_SUL_INSTAGRAM_ID,
    alternatePageId, alternateInstagramId, DATASET_ID, SYSTEM_USER_ID,
  ]) {
    assert.equal(serialized.includes(value), false);
  }
});

test('staging seed rejects missing, malformed, or duplicate destination selectors before it creates a mutation journal', async () => {
  const cases = [
    { label: 'missing', value: undefined },
    { label: 'malformed', value: { ...DESTINATION_PAGE_IDS, barra_shopping_sul: 'not-a-page-id' } },
    { label: 'duplicate', value: { novo_hamburgo: PAGE_ID, barra_shopping_sul: PAGE_ID } },
  ];
  for (const entry of cases) {
    const db = new SeedDb();
    const graph = new FakeGraph();
    const response = await seed({
      db,
      graph,
      operationKey: `meta-ads-staging-seed:destination-selector-${entry.label}-001`,
      requestOverrides: entry.value === undefined
        ? { destination_page_ids: undefined }
        : { destination_page_ids: entry.value },
    });
    const body = await response.json();

    assert.equal(response.status, 400, entry.label);
    assert.equal(body.error, 'meta_ads_publish_staging_seed_request_invalid', entry.label);
    assert.equal(graph.calls.length, 0, entry.label);
    assert.equal(graph.postCalls.length, 0, entry.label);
    assert.equal(db.operations.size, 0, entry.label);
    assert.equal(db.tokens.length, 0, entry.label);
    assert.equal(JSON.stringify(body).includes('not-a-page-id'), false, entry.label);
  }
});

test('staging seed attestation rejects ambiguous, malformed, or unassigned destination Page pairs before Page or dataset reads', async () => {
  const cases = [
    {
      label: 'unassigned',
      payload: { data: [{ id: PAGE_ID, tasks: ['ADVERTISE'], instagram_business_account: { id: INSTAGRAM_ID } }] },
      expectedError: 'meta_ads_publish_staging_seed_graph_page_ambiguous',
    },
    {
      label: 'target-task-missing',
      payload: {
        data: [
          { id: PAGE_ID, tasks: ['ADVERTISE'], instagram_business_account: { id: INSTAGRAM_ID } },
          {
            id: BARRA_SHOPPING_SUL_PAGE_ID,
            tasks: ['PROFILE_PLUS_READ'],
            instagram_business_account: { id: BARRA_SHOPPING_SUL_INSTAGRAM_ID },
          },
        ],
      },
      expectedError: 'meta_ads_publish_staging_seed_graph_page_ambiguous',
    },
    {
      label: 'target-instagram-missing',
      payload: {
        data: [
          { id: PAGE_ID, tasks: ['ADVERTISE'], instagram_business_account: { id: INSTAGRAM_ID } },
          { id: BARRA_SHOPPING_SUL_PAGE_ID, tasks: ['ADVERTISE'], instagram_business_account: {} },
        ],
      },
      expectedError: 'meta_ads_publish_staging_seed_graph_page_ambiguous',
    },
    {
      label: 'duplicate-instagram',
      payload: {
        data: [
          { id: PAGE_ID, tasks: ['ADVERTISE'], instagram_business_account: { id: INSTAGRAM_ID } },
          { id: BARRA_SHOPPING_SUL_PAGE_ID, tasks: ['ADVERTISE'], instagram_business_account: { id: INSTAGRAM_ID } },
        ],
      },
      expectedError: 'meta_ads_publish_staging_seed_graph_identity_mismatch',
    },
    {
      label: 'malformed',
      payload: { data: false },
      expectedError: 'meta_ads_publish_staging_seed_graph_identity_malformed',
    },
    {
      label: 'paged',
      payload: {
        data: [
          { id: PAGE_ID, tasks: ['ADVERTISE'], instagram_business_account: { id: INSTAGRAM_ID } },
          { id: BARRA_SHOPPING_SUL_PAGE_ID, tasks: ['ADVERTISE'], instagram_business_account: { id: BARRA_SHOPPING_SUL_INSTAGRAM_ID } },
        ],
        paging: { next: false },
      },
      expectedError: 'meta_ads_publish_staging_seed_graph_page_ambiguous',
    },
  ];
  for (const entry of cases) {
    const db = new SeedDb();
    db.prepare = () => {
      throw new Error('D1 must remain untouched by destination Page attestation');
    };
    const graph = new FakeGraph({
      readResponses: { [`${SYSTEM_USER_ID}/assigned_pages`]: { body: entry.payload } },
    });
    const response = await attest({
      db,
      graph,
      operationKey: `meta-ads-staging-seed:destination-pages-${entry.label}-001`,
    });
    const body = await response.json();

    assert.equal(response.status, 409, entry.label);
    assert.equal(body.error, entry.expectedError, entry.label);
    assert.deepEqual(graph.calls.map((call) => call.path), [
      PIXEL_ID,
      `act_${ACCOUNT_ID}/adspixels`,
      'me',
      `${SYSTEM_USER_ID}/assigned_pages`,
    ], entry.label);
    assert.equal(graph.postCalls.length, 0, entry.label);
    assert.equal(db.operations.size, 0, entry.label);
    assert.equal(db.tokens.length, 0, entry.label);
    assert.equal(db.locks.size, 0, entry.label);
    assert.equal(db.adsetLocks.size, 0, entry.label);
  }
});

test('staging seed attestation uses the assigned Page pair without an incompatible direct Page read', async () => {
  const db = new SeedDb();
  db.prepare = () => {
    throw new Error('D1 must remain untouched by direct Page pair validation');
  };
  const graph = new FakeGraph({
    readResponses: {
      [BARRA_SHOPPING_SUL_PAGE_ID]: {
        body: {
          id: BARRA_SHOPPING_SUL_PAGE_ID,
          instagram_business_account: { id: INSTAGRAM_ID },
          website: 'https://staging-barra.example.invalid/tracking-fixture',
          picture: { data: { url: 'https://cdn.example.invalid/staging-barra-fixture.jpg' } },
        },
      },
    },
  });
  const response = await attest({
    db,
    graph,
    operationKey: 'meta-ads-staging-seed:destination-page-pair-swap-001',
  });
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.equal(body.attestation, 'match');
  assert.deepEqual(graph.calls.map((call) => call.path), [
    PIXEL_ID,
    `act_${ACCOUNT_ID}/adspixels`,
    'me',
    `${SYSTEM_USER_ID}/assigned_pages`,
    `act_${ACCOUNT_ID}`,
    `${BUSINESS_ID}/ads_dataset`,
  ]);
  assert.equal(graph.postCalls.length, 0);
  assert.equal(db.operations.size, 0);
  assert.equal(db.tokens.length, 0);
});

test('staging seed attestation accepts an exact account Pixel membership on a bounded page with more results', async () => {
  const db = new SeedDb();
  const graph = new FakeGraph({
    readResponses: {
      [`act_${ACCOUNT_ID}/adspixels`]: {
        body: { data: [{ id: PIXEL_ID }], paging: { next: 'https://graph.example.invalid/opaque' } },
      },
    },
  });
  const response = await attest({
    db,
    graph,
    operationKey: 'meta-ads-staging-seed:attestation-membership-first-page-001',
  });
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.equal(body.attestation, 'match');
  assert.equal(graph.calls.length, 6);
  assert.ok(graph.calls.every((call) => call.method === 'GET'));
  assert.equal(graph.postCalls.length, 0);
  assert.equal(db.operations.size, 0);
  assert.equal(db.tokens.length, 0);
  assert.equal(db.locks.size, 0);
  assert.equal(db.adsetLocks.size, 0);
});

test('staging seed attestation accepts the explicit Profile Plus advertising task', async () => {
  const db = new SeedDb();
  const graph = new FakeGraph({
    readResponses: {
      [`${SYSTEM_USER_ID}/assigned_pages`]: {
        body: {
          data: [
            {
              id: PAGE_ID,
              tasks: ['PROFILE_PLUS_ADVERTISE'],
              instagram_business_account: { id: INSTAGRAM_ID },
              website: 'https://staging.example.invalid/tracking-fixture',
              picture: { data: { url: 'https://cdn.example.invalid/staging-fixture.jpg' } },
            },
            {
              id: BARRA_SHOPPING_SUL_PAGE_ID,
              tasks: ['ADVERTISE'],
              instagram_business_account: { id: BARRA_SHOPPING_SUL_INSTAGRAM_ID },
              website: 'https://staging-barra.example.invalid/tracking-fixture',
              picture: { data: { url: 'https://cdn.example.invalid/staging-barra-fixture.jpg' } },
            },
          ],
        },
      },
    },
  });
  const response = await attest({
    db,
    graph,
    operationKey: 'meta-ads-staging-seed:attestation-profile-plus-advertise-001',
  });
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.equal(body.attestation, 'match');
  assert.equal(graph.calls.length, 6);
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

test('staging seed attestation does not broaden unrelated Profile Plus tasks into advertising', async () => {
  const db = new SeedDb();
  const graph = new FakeGraph({
    readResponses: {
      [`${SYSTEM_USER_ID}/assigned_pages`]: {
        body: {
          data: [
            { id: PAGE_ID, tasks: ['PROFILE_PLUS_ANALYZE'], instagram_business_account: { id: INSTAGRAM_ID } },
            {
              id: BARRA_SHOPPING_SUL_PAGE_ID,
              tasks: ['ADVERTISE'],
              instagram_business_account: { id: BARRA_SHOPPING_SUL_INSTAGRAM_ID },
            },
          ],
        },
      },
    },
  });
  const response = await attest({
    db,
    graph,
    operationKey: 'meta-ads-staging-seed:attestation-profile-plus-non-advertise-001',
  });
  const body = await response.json();

  assert.equal(response.status, 409);
  assert.equal(body.error, 'meta_ads_publish_staging_seed_graph_page_ambiguous');
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

test('staging seed attestation exposes only finite mismatch, malformed, and source-auth outcomes', async () => {
  const mismatchDb = new SeedDb();
  const mismatchGraph = new FakeGraph({
    readResponses: {
      [`act_${ACCOUNT_ID}/adspixels`]: { body: { data: [{ id: MISMATCH_ACCOUNT_ID }] } },
    },
  });
  const mismatch = await attest({
    db: mismatchDb,
    graph: mismatchGraph,
    operationKey: 'meta-ads-staging-seed:attestation-mismatch-001',
  });
  const mismatchBody = await mismatch.json();
  assert.equal(mismatch.status, 409);
  assert.equal(mismatchBody.error, 'meta_ads_publish_staging_seed_graph_identity_mismatch');
  assert.equal(mismatchGraph.calls.length, 2);
  assert.equal(mismatchGraph.postCalls.length, 0);
  assert.equal(mismatchDb.operations.size, 0);
  assert.equal(mismatchDb.tokens.length, 0);

  const malformedDb = new SeedDb();
  const malformedGraph = new FakeGraph({
    readResponses: {
      [`act_${ACCOUNT_ID}/adspixels`]: { body: { data: [{ id: 'not-a-graph-id' }] } },
    },
  });
  const malformed = await attest({
    db: malformedDb,
    graph: malformedGraph,
    operationKey: 'meta-ads-staging-seed:attestation-malformed-001',
  });
  const malformedBody = await malformed.json();
  assert.equal(malformed.status, 409);
  assert.equal(malformedBody.error, 'meta_ads_publish_staging_seed_graph_identity_malformed');
  assert.equal(malformedGraph.calls.length, 2);
  assert.equal(malformedGraph.postCalls.length, 0);
  assert.equal(malformedDb.operations.size, 0);
  assert.equal(malformedDb.tokens.length, 0);

  const rejectedDb = new SeedDb();
  const rejectedGraph = new FakeGraph({
    readFailures: { [PIXEL_ID]: { status: 400, code: 190 } },
  });
  const rejected = await attest({
    db: rejectedDb,
    graph: rejectedGraph,
    operationKey: 'meta-ads-staging-seed:attestation-unavailable-001',
  });
  const rejectedBody = await rejected.json();
  assert.equal(rejected.status, 409);
  assert.equal(rejectedBody.error, 'meta_ads_publish_staging_seed_graph_source_auth_rejected');
  assert.equal(rejectedGraph.calls.length, 1);
  assert.equal(rejectedDb.operations.size, 0);
  assert.equal(rejectedDb.tokens.length, 0);

  for (const body of [mismatchBody, malformedBody, rejectedBody]) {
    const serialized = JSON.stringify(body);
    for (const value of [SOURCE_ACCESS_TOKEN, ACCOUNT_ID, MISMATCH_ACCOUNT_ID, PIXEL_ID]) {
      assert.equal(serialized.includes(value), false);
    }
  }
});

test('staging seed attestation returns a finite resource stage for permanent Graph source failures', async () => {
  const cases = [
    {
      label: 'pixel',
      path: PIXEL_ID,
      expectedError: 'meta_ads_publish_staging_seed_graph_pixel_access_denied',
      expectedReads: 1,
      status: 403,
    },
    {
      label: 'pixel-account-relation',
      path: `act_${ACCOUNT_ID}/adspixels`,
      expectedError: 'meta_ads_publish_staging_seed_graph_pixel_account_relation_denied',
      expectedReads: 2,
      status: 403,
    },
    {
      label: 'pixel-account-relation-contract',
      path: `act_${ACCOUNT_ID}/adspixels`,
      expectedError: 'meta_ads_publish_staging_seed_graph_identity_malformed',
      expectedReads: 2,
      // Graph can return a 2xx envelope carrying a permanent code-100 error.
      // It is a contract incompatibility, never evidence for an asset grant.
      status: 200,
      code: 100,
    },
    {
      label: 'system-user',
      path: 'me',
      expectedError: 'meta_ads_publish_staging_seed_graph_page_access_denied',
      expectedReads: 3,
      status: 403,
    },
    {
      label: 'page-read',
      path: `${SYSTEM_USER_ID}/assigned_pages`,
      expectedError: 'meta_ads_publish_staging_seed_graph_page_access_denied',
      expectedReads: 4,
      status: 403,
    },
    {
      label: 'dataset',
      path: `${BUSINESS_ID}/ads_dataset`,
      expectedError: 'meta_ads_publish_staging_seed_graph_dataset_access_denied',
      expectedReads: 6,
      // Graph can return a 2xx envelope containing an error. It remains a
      // permanent source capability failure and must not become a success.
      status: 200,
    },
    {
      label: 'dataset-contract',
      path: `${BUSINESS_ID}/ads_dataset`,
      expectedError: 'meta_ads_publish_staging_seed_graph_contract_invalid',
      expectedReads: 6,
      // A code-100 response is a Graph edge/field contract rejection, not
      // evidence that the configured source lacks an asset permission.
      status: 200,
      code: 100,
    },
    {
      label: 'dataset-contract-envelope',
      path: `${BUSINESS_ID}/ads_dataset`,
      expectedError: 'meta_ads_publish_staging_seed_graph_contract_invalid',
      expectedReads: 6,
      // A non-auth 4xx envelope without a usable Graph code is still a
      // contract/response failure, not an asset-permission verdict.
      status: 400,
      code: 0,
    },
  ];

  for (const entry of cases) {
    const db = new SeedDb();
    const graph = new FakeGraph({
      readFailures: { [entry.path]: { status: entry.status, code: entry.code ?? 10 } },
    });
    const response = await attest({
      db,
      graph,
      operationKey: `meta-ads-staging-seed:attestation-${entry.label}-denied-001`,
    });
    const body = await response.json();

    assert.equal(response.status, 409, entry.label);
    assert.equal(body.error, entry.expectedError, entry.label);
    assert.equal(graph.calls.length, entry.expectedReads, entry.label);
    assert.equal(graph.postCalls.length, 0, entry.label);
    assert.equal(db.operations.size, 0, entry.label);
    assert.equal(db.tokens.length, 0, entry.label);
    assert.equal(db.locks.size, 0, entry.label);
    assert.equal(db.adsetLocks.size, 0, entry.label);
    const serialized = JSON.stringify(body);
    for (const value of [SOURCE_ACCESS_TOKEN, ACCOUNT_ID, PIXEL_ID, PAGE_ID, INSTAGRAM_ID, DATASET_ID]) {
      assert.equal(serialized.includes(value), false, entry.label);
    }
  }
});

test('staging seed attestation identifies a rejected appsecret proof without mutating', async () => {
  const db = new SeedDb();
  db.prepare = () => {
    throw new Error('D1 must remain untouched by source attestation');
  };
  const graph = new FakeGraph();
  const observedReads = [];
  const response = await attest({
    db,
    graph,
    operationKey: 'meta-ads-staging-seed:attestation-appsecret-proof-mismatch-001',
    env: {
      META_APP_SECRET: 'unit-test-app-secret-not-a-real-secret',
      META_GRAPH_FETCH: async (url, init) => {
        const target = new URL(url);
        observedReads.push({
          path: target.pathname.replace(/^\/v\d+\.0\//, ''),
          method: String(init.method || 'GET').toUpperCase(),
          hasProof: target.searchParams.has('appsecret_proof'),
        });
        if (target.searchParams.has('appsecret_proof')) {
          return graphResponse({ error: { message: 'proof rejected', code: 10 } }, 403);
        }
        return graph.fetch(url, init);
      },
    },
  });
  const body = await response.json();

  assert.equal(response.status, 409);
  assert.equal(body.error, 'meta_ads_publish_staging_seed_graph_appsecret_proof_mismatch');
  assert.deepEqual(observedReads, [
    { path: PIXEL_ID, method: 'GET', hasProof: true },
    { path: PIXEL_ID, method: 'GET', hasProof: false },
  ]);
  assert.equal(graph.calls.length, 1);
  assert.equal(graph.postCalls.length, 0);
  assert.equal(db.operations.size, 0);
  assert.equal(db.tokens.length, 0);
  assert.equal(db.locks.size, 0);
  assert.equal(db.adsetLocks.size, 0);
  const serialized = JSON.stringify(body);
  for (const value of [SOURCE_ACCESS_TOKEN, ACCOUNT_ID, PIXEL_ID]) {
    assert.equal(serialized.includes(value), false);
  }
});

test('candidate appsecret-proof attestation fails closed before Graph or D1 when the inherited proof binding is unavailable', async () => {
  const db = new SeedDb();
  db.prepare = () => {
    throw new Error('D1 must remain untouched by candidate proof attestation');
  };
  const graph = new FakeGraph();
  const response = await attestAppSecretProof({
    db,
    graph,
    operationKey: 'meta-ads-staging-seed:candidate-proof-unavailable-001',
  });
  const body = await response.json();

  assert.equal(response.status, 409);
  assert.equal(body.error, 'meta_ads_publish_staging_seed_graph_appsecret_proof_unavailable');
  assert.equal(graph.calls.length, 0);
  assert.equal(graph.postCalls.length, 0);
  const serialized = JSON.stringify(body);
  for (const value of [SOURCE_ACCESS_TOKEN, ACCOUNT_ID, PIXEL_ID]) {
    assert.equal(serialized.includes(value), false);
  }
});

test('candidate appsecret-proof attestation remains staging-only before it reads Graph or D1', async () => {
  const db = new SeedDb();
  const graph = new FakeGraph();
  const response = await attestAppSecretProof({
    db,
    graph,
    operationKey: 'meta-ads-staging-seed:candidate-proof-production-denied-001',
    env: {
      ENVIRONMENT: 'production',
      META_APP_SECRET: 'unit-test-app-secret-not-a-real-secret',
    },
  });
  const body = await response.json();

  assert.equal(response.status, 503);
  assert.equal(body.error, 'meta_ads_publish_staging_seed_disabled');
  assert.equal(graph.calls.length, 0);
  assert.equal(graph.postCalls.length, 0);
  assert.equal(db.operations.size, 0);
  assert.equal(db.tokens.length, 0);
  assert.equal(db.locks.size, 0);
  assert.equal(db.adsetLocks.size, 0);
});

test('candidate appsecret-proof attestation verifies only bounded proof-bearing Graph reads without D1', async () => {
  const db = new SeedDb();
  db.prepare = () => {
    throw new Error('D1 must remain untouched by candidate proof attestation');
  };
  const graph = new FakeGraph({
    readResponses: {
      me: { body: { id: SYSTEM_USER_ID } },
      [`${SYSTEM_USER_ID}/assigned_pages`]: {
        body: {
          data: [
            {
              id: PAGE_ID,
              tasks: ['ADVERTISE'],
              instagram_business_account: { id: INSTAGRAM_ID },
              website: 'https://staging.example.invalid/tracking-fixture',
              picture: { data: { url: 'https://cdn.example.invalid/staging-fixture.jpg' } },
            },
            {
              id: BARRA_SHOPPING_SUL_PAGE_ID,
              tasks: ['ADVERTISE'],
              instagram_business_account: { id: BARRA_SHOPPING_SUL_INSTAGRAM_ID },
              website: 'https://staging-barra.example.invalid/tracking-fixture',
              picture: { data: { url: 'https://cdn.example.invalid/staging-barra-fixture.jpg' } },
            },
          ],
        },
      },
    },
  });
  const observedReads = [];
  const response = await attestAppSecretProof({
    db,
    graph,
    operationKey: 'meta-ads-staging-seed:candidate-proof-verified-001',
    env: {
      META_APP_SECRET: 'unit-test-app-secret-not-a-real-secret',
      META_GRAPH_FETCH: async (url, init) => {
        const target = new URL(url);
        observedReads.push({
          path: target.pathname.replace(/^\/v\d+\.0\//, ''),
          method: String(init.method || 'GET').toUpperCase(),
          hasProof: target.searchParams.has('appsecret_proof'),
        });
        return graph.fetch(url, init);
      },
    },
  });
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.deepEqual(body, {
    ok: true,
    attestation: 'appsecret_proof_verified',
    contract_version: 'meta-ads-tracking-v20/staging-synthetic-seed/v2',
    requestId: 'seed-appsecret-proof-attestation-test-request-id',
  });
  assert.deepEqual(observedReads.map((read) => read.path), [
    PIXEL_ID,
    `act_${ACCOUNT_ID}/adspixels`,
    'me',
    `${SYSTEM_USER_ID}/assigned_pages`,
    `act_${ACCOUNT_ID}`,
    `${BUSINESS_ID}/ads_dataset`,
  ]);
  assert.ok(observedReads.every((read) => read.method === 'GET' && read.hasProof));
  assert.equal(graph.calls.length, 6);
  assert.equal(graph.postCalls.length, 0);
  const serialized = JSON.stringify(body);
  for (const value of [SOURCE_ACCESS_TOKEN, ACCOUNT_ID, PIXEL_ID, PAGE_ID, INSTAGRAM_ID, DATASET_ID]) {
    assert.equal(serialized.includes(value), false);
  }
});

test('candidate appsecret-proof attestation preserves the sanitized proof mismatch without D1 or Graph mutation', async () => {
  const db = new SeedDb();
  db.prepare = () => {
    throw new Error('D1 must remain untouched by candidate proof attestation');
  };
  const graph = new FakeGraph();
  const observedReads = [];
  const response = await attestAppSecretProof({
    db,
    graph,
    operationKey: 'meta-ads-staging-seed:candidate-proof-mismatch-001',
    env: {
      META_APP_SECRET: 'unit-test-app-secret-not-a-real-secret',
      META_GRAPH_FETCH: async (url, init) => {
        const target = new URL(url);
        observedReads.push({
          path: target.pathname.replace(/^\/v\d+\.0\//, ''),
          method: String(init.method || 'GET').toUpperCase(),
          hasProof: target.searchParams.has('appsecret_proof'),
        });
        if (target.searchParams.has('appsecret_proof')) {
          return graphResponse({ error: { message: 'proof rejected', code: 10 } }, 403);
        }
        return graph.fetch(url, init);
      },
    },
  });
  const body = await response.json();

  assert.equal(response.status, 409);
  assert.equal(body.error, 'meta_ads_publish_staging_seed_graph_appsecret_proof_mismatch');
  assert.deepEqual(observedReads, [
    { path: PIXEL_ID, method: 'GET', hasProof: true },
    { path: PIXEL_ID, method: 'GET', hasProof: false },
  ]);
  assert.equal(graph.postCalls.length, 0);
  const serialized = JSON.stringify(body);
  for (const value of [SOURCE_ACCESS_TOKEN, ACCOUNT_ID, PIXEL_ID]) {
    assert.equal(serialized.includes(value), false);
  }
});

test('staging seed attestation keeps pixel access denied when proofless retry also fails', async () => {
  const db = new SeedDb();
  db.prepare = () => {
    throw new Error('D1 must remain untouched by source attestation');
  };
  const graph = new FakeGraph();
  const observedReads = [];
  const response = await attest({
    db,
    graph,
    operationKey: 'meta-ads-staging-seed:attestation-proofless-pixel-denied-001',
    env: {
      META_APP_SECRET: 'unit-test-app-secret-not-a-real-secret',
      META_GRAPH_FETCH: async (url, init) => {
        const target = new URL(url);
        observedReads.push({
          path: target.pathname.replace(/^\/v\d+\.0\//, ''),
          method: String(init.method || 'GET').toUpperCase(),
          hasProof: target.searchParams.has('appsecret_proof'),
        });
        return graphResponse({ error: { message: 'pixel denied', code: 10 } }, 403);
      },
    },
  });
  const body = await response.json();

  assert.equal(response.status, 409);
  assert.equal(body.error, 'meta_ads_publish_staging_seed_graph_pixel_access_denied');
  assert.deepEqual(observedReads, [
    { path: PIXEL_ID, method: 'GET', hasProof: true },
    { path: PIXEL_ID, method: 'GET', hasProof: false },
  ]);
  assert.equal(graph.calls.length, 0);
  assert.equal(graph.postCalls.length, 0);
  assert.equal(db.operations.size, 0);
  assert.equal(db.tokens.length, 0);
  assert.equal(db.locks.size, 0);
  assert.equal(db.adsetLocks.size, 0);
  const serialized = JSON.stringify(body);
  for (const value of [SOURCE_ACCESS_TOKEN, ACCOUNT_ID, PIXEL_ID]) {
    assert.equal(serialized.includes(value), false);
  }
});

test('staging seed attestation preserves finite non-identity source eligibility outcomes', async () => {
  const cases = [
    {
      label: 'pixel-account-relation-ambiguous',
      path: `act_${ACCOUNT_ID}/adspixels`,
      response: { body: { data: [], paging: { next: 'https://graph.example.invalid/opaque' } } },
      expectedError: 'meta_ads_publish_staging_seed_graph_pixel_account_relation_ambiguous',
      expectedReads: 2,
    },
    {
      label: 'page-ambiguous',
      path: `${SYSTEM_USER_ID}/assigned_pages`,
      response: {
        body: {
          data: [
            { id: PAGE_ID, tasks: ['ADVERTISE'], instagram_business_account: { id: INSTAGRAM_ID } },
            { id: PAGE_ID, tasks: ['PROFILE_PLUS_ADVERTISE'], instagram_business_account: { id: INSTAGRAM_ID } },
            {
              id: BARRA_SHOPPING_SUL_PAGE_ID,
              tasks: ['ADVERTISE'],
              instagram_business_account: { id: BARRA_SHOPPING_SUL_INSTAGRAM_ID },
            },
          ],
        },
      },
      expectedError: 'meta_ads_publish_staging_seed_graph_page_ambiguous',
      expectedReads: 4,
    },
    {
      label: 'dataset-ambiguous',
      path: `${BUSINESS_ID}/ads_dataset`,
      response: { body: { data: [] } },
      expectedError: 'meta_ads_publish_staging_seed_graph_dataset_ambiguous',
      expectedReads: 6,
    },
    {
      label: 'landing-unavailable',
      path: `${SYSTEM_USER_ID}/assigned_pages`,
      response: {
        body: {
          data: [
            {
              id: PAGE_ID,
              tasks: ['ADVERTISE'],
              instagram_business_account: { id: INSTAGRAM_ID },
              website: '',
              picture: { data: { url: 'https://cdn.example.invalid/staging-fixture.jpg' } },
            },
            {
              id: BARRA_SHOPPING_SUL_PAGE_ID,
              tasks: ['ADVERTISE'],
              instagram_business_account: { id: BARRA_SHOPPING_SUL_INSTAGRAM_ID },
              website: 'https://staging-barra.example.invalid/tracking-fixture',
              picture: { data: { url: 'https://cdn.example.invalid/staging-barra-fixture.jpg' } },
            },
          ],
        },
      },
      expectedError: 'meta_ads_publish_staging_seed_landing_or_media_unavailable',
      expectedReads: 4,
    },
  ];

  for (const entry of cases) {
    const db = new SeedDb();
    const graph = new FakeGraph({ readResponses: { [entry.path]: entry.response } });
    const response = await attest({
      db,
      graph,
      operationKey: `meta-ads-staging-seed:attestation-${entry.label}-001`,
    });
    const body = await response.json();

    assert.equal(response.status, 409, entry.label);
    assert.equal(body.error, entry.expectedError, entry.label);
    assert.equal(graph.calls.length, entry.expectedReads, entry.label);
    assert.equal(graph.postCalls.length, 0, entry.label);
    assert.equal(db.operations.size, 0, entry.label);
    assert.equal(db.tokens.length, 0, entry.label);
    assert.equal(db.locks.size, 0, entry.label);
    assert.equal(db.adsetLocks.size, 0, entry.label);
    const serialized = JSON.stringify(body);
    for (const value of [SOURCE_ACCESS_TOKEN, ACCOUNT_ID, PIXEL_ID, PAGE_ID, INSTAGRAM_ID, DATASET_ID]) {
      assert.equal(serialized.includes(value), false, entry.label);
    }
  }
});

test('staging seed attestation classifies successful AdsDataset shape drift as a contract failure', async () => {
  const cases = [
    {
      label: 'missing-data-array',
      body: { id: DATASET_ID },
    },
    {
      label: 'missing-stable-id',
      body: { data: [{ dataset_id: DATASET_ID }] },
    },
  ];

  for (const entry of cases) {
    const db = new SeedDb();
    db.prepare = () => {
      throw new Error('D1 must remain untouched by contract diagnostics');
    };
    const graph = new FakeGraph({
      readResponses: {
        [`${BUSINESS_ID}/ads_dataset`]: { body: entry.body },
      },
    });
    const response = await attest({
      db,
      graph,
      operationKey: `meta-ads-staging-seed:attestation-${entry.label}-001`,
    });
    const body = await response.json();

    assert.equal(response.status, 409, entry.label);
    assert.equal(body.error, 'meta_ads_publish_staging_seed_graph_contract_invalid', entry.label);
    assert.equal(graph.calls.length, 6, entry.label);
    assert.ok(graph.calls.every((call) => call.method === 'GET'), entry.label);
    assert.equal(graph.postCalls.length, 0, entry.label);
    assert.equal(db.operations.size, 0, entry.label);
    assert.equal(db.tokens.length, 0, entry.label);
    assert.equal(db.locks.size, 0, entry.label);
    const serialized = JSON.stringify(body);
    for (const value of [SOURCE_ACCESS_TOKEN, ACCOUNT_ID, PIXEL_ID, DATASET_ID]) {
      assert.equal(serialized.includes(value), false, entry.label);
    }
  }
});

test('staging seed attestation keeps transient source failures retryable and bounded', async () => {
  const db = new SeedDb();
  const graph = new FakeGraph({
    readFailures: { [PIXEL_ID]: { status: 429, code: 4 } },
  });
  const response = await attest({
    db,
    graph,
    operationKey: 'meta-ads-staging-seed:attestation-transient-unavailable-001',
  });
  const body = await response.json();

  assert.equal(response.status, 503);
  assert.equal(body.error, 'meta_ads_publish_staging_seed_unavailable');
  assert.equal(graph.calls.length, 1);
  assert.equal(graph.postCalls.length, 0);
  assert.equal(db.operations.size, 0);
  assert.equal(db.tokens.length, 0);
  assert.equal(JSON.stringify(body).includes(SOURCE_ACCESS_TOKEN), false);
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
    contract_version: 'meta-ads-tracking-v20/staging-synthetic-seed/v2',
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
  const sourceMetadata = metadata.find((entry) => entry.source_adset_id);
  const targetMetadata = metadata.find((entry) => entry.source_config_token_id);
  assert.deepEqual(
    { page_id: sourceMetadata.page_id, instagram_user_id: sourceMetadata.instagram_user_id },
    { page_id: PAGE_ID, instagram_user_id: INSTAGRAM_ID },
  );
  assert.deepEqual(
    { page_id: targetMetadata.page_id, instagram_user_id: targetMetadata.instagram_user_id },
    { page_id: BARRA_SHOPPING_SUL_PAGE_ID, instagram_user_id: BARRA_SHOPPING_SUL_INSTAGRAM_ID },
  );
  assert.notEqual(sourceMetadata.destination_group, targetMetadata.destination_group);

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

test('staging seed seals a configured Page only after the System User assignment proves the exact Page and IG pair', async () => {
  const db = new SeedDb();
  const graph = new FakeGraph({
    readResponses: {
      me: { body: { id: SYSTEM_USER_ID } },
      [`${SYSTEM_USER_ID}/assigned_pages`]: {
        body: {
          data: [
            {
              id: PAGE_ID,
              tasks: ['ADVERTISE'],
              instagram_business_account: { id: INSTAGRAM_ID },
              website: 'https://staging.example.invalid/tracking-fixture',
              picture: { data: { url: 'https://cdn.example.invalid/staging-fixture.jpg' } },
            },
            {
              id: BARRA_SHOPPING_SUL_PAGE_ID,
              tasks: ['ADVERTISE'],
              instagram_business_account: { id: BARRA_SHOPPING_SUL_INSTAGRAM_ID },
              website: 'https://staging-barra.example.invalid/tracking-fixture',
              picture: { data: { url: 'https://cdn.example.invalid/staging-barra-fixture.jpg' } },
            },
          ],
        },
      },
    },
  });
  const operationKey = 'meta-ads-staging-seed:configured-page-happy-path-001';
  const response = await seed({
    db,
    graph,
    operationKey,
  });
  const body = await response.json();

  assert.equal(response.status, 201);
  assert.equal(body.seed, 'sealed');
  assert.deepEqual(graph.calls.slice(0, 6).map((call) => call.path), [
    PIXEL_ID,
    `act_${ACCOUNT_ID}/adspixels`,
    'me',
    `${SYSTEM_USER_ID}/assigned_pages`,
    `act_${ACCOUNT_ID}`,
    `${BUSINESS_ID}/ads_dataset`,
  ]);
  assert.ok(graph.calls.every((call) => call.path !== 'me/accounts'));
  assert.equal(db.tokens.length, 2);
  assert.equal(db.operations.get(operationKey).status, 'sealed');
  const persisted = JSON.stringify(db.operations.get(operationKey));
  for (const value of [SOURCE_ACCESS_TOKEN, ACCOUNT_ID, PIXEL_ID, PAGE_ID, INSTAGRAM_ID, DATASET_ID, SYSTEM_USER_ID]) {
    assert.equal(persisted.includes(value), false);
  }
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
    contract_version: 'meta-ads-tracking-v20/staging-synthetic-seed/v2',
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
