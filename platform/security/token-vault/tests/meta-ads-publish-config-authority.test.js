import assert from 'node:assert/strict';
import test from 'node:test';
import { handleRequest } from '../src/index.js';

const ADMIN_TOKEN = 'meta-config-authority-admin-token';
const OPERATIONAL_TOKEN = 'meta-config-authority-operational-token';
const ANALYTICS_TOKEN = 'meta-config-authority-analytics-token';
const ENCRYPTION_KEY = 'meta-config-authority-encryption-key-material';

class AuthorityStatement {
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
    if (this.sql.includes('FROM meta_ads_publish_config_operations')) {
      return this.db.operations.get(this.values[0]) || null;
    }
    if (this.sql.includes('FROM meta_ads_publish_config_locks')) {
      return this.db.locks.get(this.values[0]) || null;
    }
    if (this.sql.includes('FROM credential_tokens') && this.sql.includes('WHERE id = ?')) {
      return this.db.tokens.find((row) => row.id === this.values[0]) || null;
    }
    if (this.sql.includes('SELECT 1 AS ok')) return { ok: 1 };
    throw new Error('Unexpected first SQL: ' + this.sql);
  }

  async all() {
    if (this.sql.includes('FROM credential_tokens')) {
      return {
        results: this.db.tokens
          .filter((row) => row.provider === 'facebook' && row.active === 1)
          .map((row) => ({ ...row })),
      };
    }
    throw new Error('Unexpected all SQL: ' + this.sql);
  }

  async run() {
    if (this.sql.includes('DELETE FROM meta_ads_publish_config_locks')) {
      const [resourceKey, ownerId] = this.values;
      const lock = this.db.locks.get(resourceKey);
      if (lock && (!ownerId || lock.owner_id === ownerId || Date.parse(lock.expires_at) <= Date.now())) {
        this.db.locks.delete(resourceKey);
        return { meta: { changes: 1 } };
      }
      return { meta: { changes: 0 } };
    }
    if (this.sql.includes('INSERT INTO meta_ads_publish_config_locks')) {
      const [resourceKey, ownerId, expiresAt] = this.values;
      const existing = this.db.locks.get(resourceKey);
      if (!existing || Date.parse(existing.expires_at) <= Date.now()) {
        this.db.locks.set(resourceKey, { resource_key: resourceKey, owner_id: ownerId, expires_at: expiresAt });
        return { meta: { changes: 1 } };
      }
      return { meta: { changes: 0 } };
    }
    throw new Error('Unexpected run SQL: ' + this.sql);
  }
}

class AuthorityDb {
  constructor() {
    this.tokens = [
      tokenRow('facebook_website', 'Website', legacyConfig('Website', 1)),
      tokenRow('facebook_ctwa', 'CTWA', legacyConfig('CTWA', 2)),
    ];
    this.operations = new Map();
    this.locks = new Map();
    this.audit = [];
    this.beforeMetadataUpdate = null;
  }

  prepare(sql) {
    return new AuthorityStatement(this, sql);
  }

  async batch(statements) {
    const results = [];
    for (const statement of statements) {
      const { sql, values } = statement;
      if (sql.includes('INSERT INTO meta_ads_publish_config_operations')) {
        const [id, operationKey, targetTokenIdsJson, requestHash, expectedRevision, resultRevision] = values;
        if (this.operations.has(operationKey)) {
          results.push({ meta: { changes: 0 } });
          continue;
        }
        this.operations.set(operationKey, {
          id,
          operation_key: operationKey,
          target_token_ids_json: targetTokenIdsJson,
          request_hash: requestHash,
          expected_tracking_binding_revision: expectedRevision,
          resulting_tracking_binding_revision: resultRevision,
          status: 'pending',
        });
        results.push({ meta: { changes: 1 } });
        continue;
      }
      if (sql.startsWith('UPDATE credential_tokens SET metadata_json = CASE')) {
        if (this.beforeMetadataUpdate) {
          const hook = this.beforeMetadataUpdate;
          this.beforeMetadataUpdate = null;
          hook(this);
        }
        const planCount = (sql.match(/WHEN \? THEN \?/g) || []).length;
        const nextPairs = values.slice(0, planCount * 2);
        const updatedAt = values[planCount * 2];
        const targetIds = values.slice(planCount * 2 + 1, planCount * 3 + 1);
        const oldPairs = values.slice(planCount * 3 + 1, planCount * 5 + 1);
        const requiredCount = values[planCount * 5 + 1];
        const operationId = values[planCount * 5 + 2];
        const requestHash = values[planCount * 5 + 3];
        const operation = [...this.operations.values()].find((entry) => entry.id === operationId);
        const plans = Array.from({ length: planCount }, (_, index) => ({
          id: nextPairs[index * 2],
          nextMetadataJson: nextPairs[index * 2 + 1],
          oldMetadataJson: oldPairs[index * 2 + 1],
        }));
        const eligible = operation &&
          operation.status === 'pending' &&
          operation.request_hash === requestHash &&
          targetIds.length === planCount &&
          new Set(targetIds).size === planCount &&
          plans.filter((plan) => {
            const row = this.tokens.find((item) => item.id === plan.id);
            return row && row.provider === 'facebook' && row.active === 1 && row.metadata_json === plan.oldMetadataJson;
          }).length === requiredCount;
        if (!eligible) {
          results.push({ meta: { changes: 0 } });
          continue;
        }
        for (const plan of plans) {
          const row = this.tokens.find((item) => item.id === plan.id);
          row.metadata_json = plan.nextMetadataJson;
          row.updated_at = updatedAt;
        }
        results.push({ meta: { changes: planCount } });
        continue;
      }
      if (sql.startsWith('UPDATE meta_ads_publish_config_operations SET status')) {
        const [updatedAt, operationId, ...pairsAndCount] = values;
        const requiredCount = pairsAndCount.at(-1);
        const pairs = pairsAndCount.slice(0, -1);
        const operation = [...this.operations.values()].find((entry) => entry.id === operationId);
        const allApplied = operation &&
          operation.status === 'pending' &&
          Array.from({ length: requiredCount }, (_, index) => {
            const row = this.tokens.find((item) => item.id === pairs[index * 2]);
            return row && row.provider === 'facebook' && row.active === 1 && row.metadata_json === pairs[index * 2 + 1];
          }).every(Boolean);
        if (!allApplied) {
          results.push({ meta: { changes: 0 } });
          continue;
        }
        operation.status = 'applied';
        operation.updated_at = updatedAt;
        results.push({ meta: { changes: 1 } });
        continue;
      }
      if (sql.includes('INSERT INTO credential_token_audit')) {
        const operationId = values.at(-1);
        const operation = [...this.operations.values()].find((entry) => entry.id === operationId);
        if (operation?.status === 'applied') {
          this.audit.push({ token_id: values[1], metadata_json: values[5] });
          results.push({ meta: { changes: 1 } });
        } else {
          results.push({ meta: { changes: 0 } });
        }
        continue;
      }
      if (sql.includes('DELETE FROM meta_ads_publish_config_operations')) {
        const operationId = values[0];
        const found = [...this.operations.entries()].find(([, entry]) => entry.id === operationId && entry.status === 'pending');
        if (found) {
          this.operations.delete(found[0]);
          results.push({ meta: { changes: 1 } });
        } else {
          results.push({ meta: { changes: 0 } });
        }
        continue;
      }
      throw new Error('Unexpected batch SQL: ' + sql);
    }
    return results;
  }
}

function tokenRow(id, unit, metaAdsPublish) {
  return {
    id,
    provider: 'facebook',
    unit,
    external_account_id: '123456789',
    token_type: 'long_lived_access_token',
    token_ciphertext: 'opaque-' + id,
    expires_at: null,
    last_refreshed_at: null,
    active: 1,
    metadata_json: JSON.stringify({
      custody_owner: 'approved-private-manifest',
      unrelated_metadata: { retain: true },
      meta_ads_publish: metaAdsPublish,
    }),
    created_at: '2026-08-13T00:00:00.000Z',
    updated_at: '2026-08-13T00:00:00.000Z',
  };
}

function legacyConfig(destinationGroup, rowNumber) {
  return {
    row_number: rowNumber,
    destination_group: destinationGroup,
    api_version: 'v25.0',
    account_id: '123456789',
    campaign_id: '223456789',
    adset_id: String(323456789 + rowNumber),
    page_id: String(423456789 + rowNumber),
    instagram_user_id: String(523456789 + rowNumber),
    allowed_link_hosts: ['espacofacial.com'],
    landing_pages_by_creative_group: {
      DEFAULT: 'https://espacofacial.com/agendamento?unit=' + rowNumber,
    },
    legacy_marker: 'v18-source',
  };
}

function websiteV20Config() {
  return {
    row_number: '1',
    destination_group: 'Website',
    api_version: 'v25.0',
    account_id: '123456789',
    campaign_id: '223456789',
    adset_id: '323456790',
    page_id: '423456790',
    instagram_user_id: '523456790',
    allowed_link_hosts: ['espacofacial.com'],
    landing_pages_by_creative_group: {
      DEFAULT: 'https://espacofacial.com/agendamento?unit=website',
    },
    freshness_window_days: 7,
    destination_type: 'website',
    tracking_contract: {
      url_tags: 'key1=value1&key2=value2%20encoded',
      profile_ref: 'website_schedule_v1',
      production_url_tags_readback_fixture: {
        ad_id: '723456789',
        creative_id: '823456789',
      },
    },
    tracking_profiles: {
      website_schedule_v1: {
        source_adset_id: '623456789',
        destination_kind: 'website',
        website_event_requirement: 'required',
        offline_event_dataset_requirement: 'required',
      },
    },
  };
}

function ctwaV20Config() {
  return {
    row_number: '2',
    destination_group: 'CTWA',
    api_version: 'v25.0',
    account_id: '123456789',
    campaign_id: '223456789',
    adset_id: '323456791',
    page_id: '423456791',
    instagram_user_id: '523456791',
    allowed_link_hosts: ['espacofacial.com'],
    landing_pages_by_creative_group: {
      DEFAULT: 'https://espacofacial.com/agendamento?unit=ctwa',
    },
    freshness_window_days: 7,
    destination_type: 'whatsapp',
    whatsapp_destination_url: 'https://api.whatsapp.com/send?phone=5551999999999',
  };
}

function environment(db) {
  return {
    TOKEN_VAULT_DB: db,
    TOKEN_VAULT_API_TOKEN: ADMIN_TOKEN,
    TOKEN_VAULT_N8N_API_TOKEN: OPERATIONAL_TOKEN,
    TOKEN_VAULT_ANALYTICS_API_TOKEN: ANALYTICS_TOKEN,
    TOKEN_VAULT_ENCRYPTION_KEY: ENCRYPTION_KEY,
    REQUIRE_AUTH: 'true',
    WORKER_AUTH_HEADER_NAME: 'Authorization',
    WORKER_AUTH_SCHEME: 'Bearer',
    INFLUENCER_INTELLIGENCE_ANALYTICS_MODE: 'shadow',
    LANDING_PAGE_FETCH: async () => new Response('', { status: 200 }),
  };
}

function adminHeaders() {
  return { Authorization: 'Bearer ' + ADMIN_TOKEN, 'content-type': 'application/json' };
}

async function readConfig(db) {
  const result = await handleRequest(
    new Request('https://api.skincos.com.br/internal/token-vault/v1/meta-ads-publish/config', {
      headers: { Authorization: 'Bearer ' + ADMIN_TOKEN },
    }),
    environment(db),
  );
  return { result, body: await result.json() };
}

function bootstrapBody(expectedRevision, overrides = {}) {
  return {
    operation_key: 'meta-v20-bootstrap-0001',
    expected_tracking_binding_revision: expectedRevision,
    updates: [
      { token_id: 'facebook_website', meta_ads_publish: websiteV20Config() },
      { token_id: 'facebook_ctwa', meta_ads_publish: ctwaV20Config() },
    ],
    ...overrides,
  };
}

test('admin writer atomically bootstraps two legacy rows to v20 and propagates CTWA safely', async () => {
  const db = new AuthorityDb();
  const beforeMetadata = db.tokens.map((row) => row.metadata_json);
  const beforeCiphertexts = db.tokens.map((row) => row.token_ciphertext);
  const initial = await readConfig(db);
  assert.equal(initial.result.status, 409);
  assert.equal(initial.body.config_authority_mode, 'legacy_bootstrap');
  assert.match(initial.body.config_authority_revision, /^legacy:[a-f0-9]{64}$/);

  const requestBody = bootstrapBody(initial.body.config_authority_revision);
  const result = await handleRequest(
    new Request('https://api.skincos.com.br/internal/token-vault/v1/meta-ads-publish/config', {
      method: 'PUT',
      headers: adminHeaders(),
      body: JSON.stringify(requestBody),
    }),
    environment(db),
  );
  const body = await result.json();
  assert.equal(result.status, 201);
  assert.equal(body.ok, true);
  assert.equal(body.applied, true);
  assert.equal(body.replayed, false);
  assert.match(body.tracking_binding_revision, /^[a-f0-9]{64}$/);
  assert.doesNotMatch(JSON.stringify(body), /key1=value1|723456789|823456789|access_token|token_ciphertext/);
  assert.deepEqual(db.tokens.map((row) => row.token_ciphertext), beforeCiphertexts);
  assert.notDeepEqual(db.tokens.map((row) => row.metadata_json), beforeMetadata);
  for (const row of db.tokens) {
    const metadata = JSON.parse(row.metadata_json);
    assert.equal(metadata.custody_owner, 'approved-private-manifest');
    assert.deepEqual(metadata.unrelated_metadata, { retain: true });
    assert.equal(metadata.meta_ads_publish.legacy_marker, undefined);
  }
  const websiteMetadata = JSON.parse(db.tokens[0].metadata_json);
  assert.equal(
    websiteMetadata.meta_ads_publish.tracking_contract.url_tags,
    'key1=value1&key2=value2%20encoded',
  );
  assert.doesNotMatch(websiteMetadata.meta_ads_publish.tracking_contract.url_tags, /%2520/);
  assert.equal(db.audit.length, 2);
  assert.doesNotMatch(JSON.stringify(db.audit), /key1=value1|723456789|823456789/);

  const readback = await readConfig(db);
  assert.equal(readback.result.status, 200);
  assert.equal(readback.body.ready, true);
  assert.equal(readback.body.config_authority_mode, 'tracking_ready');
  const ctwa = readback.body.destinations.find((item) => item.token_id === 'facebook_ctwa');
  assert.equal(ctwa.destination_type, 'WHATSAPP');
  assert.equal(ctwa.whatsapp_destination_url, 'https://api.whatsapp.com/send?phone=5551999999999');
  assert.equal(ctwa.tracking_contract.profile_configured, false);
  const website = readback.body.destinations.find((item) => item.token_id === 'facebook_website');
  assert.equal(website.destination_type, 'WEBSITE');
  assert.equal(website.tracking_contract.url_tags, 'key1=value1&key2=value2%20encoded');

  const replay = await handleRequest(
    new Request('https://api.skincos.com.br/internal/token-vault/v1/meta-ads-publish/config', {
      method: 'PUT',
      headers: adminHeaders(),
      body: JSON.stringify(requestBody),
    }),
    environment(db),
  );
  assert.equal(replay.status, 200);
  assert.equal((await replay.json()).replayed, true);
  assert.equal(db.audit.length, 2);
});

test('writer refuses stale, invalid, and non-admin bootstrap requests without partial mutation', async () => {
  const db = new AuthorityDb();
  const initial = await readConfig(db);
  const before = db.tokens.map((row) => row.metadata_json);

  const stale = await handleRequest(
    new Request('https://api.skincos.com.br/internal/token-vault/v1/meta-ads-publish/config', {
      method: 'PUT',
      headers: adminHeaders(),
      body: JSON.stringify(bootstrapBody('legacy:0000000000000000000000000000000000000000000000000000000000000000')),
    }),
    environment(db),
  );
  assert.equal(stale.status, 409);
  assert.equal((await stale.json()).error, 'meta_ads_publish_config_binding_stale');
  assert.deepEqual(db.tokens.map((row) => row.metadata_json), before);

  const invalidWebsite = websiteV20Config();
  delete invalidWebsite.tracking_contract.production_url_tags_readback_fixture;
  const invalid = await handleRequest(
    new Request('https://api.skincos.com.br/internal/token-vault/v1/meta-ads-publish/config', {
      method: 'PUT',
      headers: adminHeaders(),
      body: JSON.stringify(bootstrapBody(initial.body.config_authority_revision, {
        operation_key: 'meta-v20-bootstrap-invalid',
        updates: [
          { token_id: 'facebook_website', meta_ads_publish: invalidWebsite },
          { token_id: 'facebook_ctwa', meta_ads_publish: ctwaV20Config() },
        ],
      })),
    }),
    environment(db),
  );
  assert.equal(invalid.status, 400);
  assert.equal((await invalid.json()).error, 'meta_ads_publish_config_invalid');
  assert.deepEqual(db.tokens.map((row) => row.metadata_json), before);

  const nonAdmin = await handleRequest(
    new Request('https://api.skincos.com.br/internal/token-vault/v1/meta-ads-publish/config', {
      method: 'PUT',
      headers: { Authorization: 'Bearer ' + OPERATIONAL_TOKEN, 'content-type': 'application/json' },
      body: JSON.stringify(bootstrapBody(initial.body.config_authority_revision)),
    }),
    environment(db),
  );
  assert.equal(nonAdmin.status, 403);
  assert.equal((await nonAdmin.json()).error, 'admin_credential_required');
  assert.deepEqual(db.tokens.map((row) => row.metadata_json), before);
});

test('batch compare-and-swap rejects concurrent drift without updating only one destination', async () => {
  const db = new AuthorityDb();
  const initial = await readConfig(db);
  const originalWebsiteMetadata = db.tokens.find((row) => row.id === 'facebook_website').metadata_json;
  db.beforeMetadataUpdate = (state) => {
    const ctwa = state.tokens.find((row) => row.id === 'facebook_ctwa');
    ctwa.metadata_json = JSON.stringify({
      ...JSON.parse(ctwa.metadata_json),
      concurrent_custody_change: true,
    });
  };
  const response = await handleRequest(
    new Request('https://api.skincos.com.br/internal/token-vault/v1/meta-ads-publish/config', {
      method: 'PUT',
      headers: adminHeaders(),
      body: JSON.stringify(bootstrapBody(initial.body.config_authority_revision, {
        operation_key: 'meta-v20-bootstrap-concurrent',
      })),
    }),
    environment(db),
  );
  assert.equal(response.status, 409);
  assert.equal((await response.json()).error, 'meta_ads_publish_config_readback_mismatch');
  assert.equal(
    db.tokens.find((row) => row.id === 'facebook_website').metadata_json,
    originalWebsiteMetadata,
  );
  assert.equal(db.audit.length, 0);
});
