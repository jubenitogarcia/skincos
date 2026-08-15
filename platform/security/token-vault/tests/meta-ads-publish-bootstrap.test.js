import assert from 'node:assert/strict';
import test from 'node:test';
import {
  __test as metaAdsPublishTest,
  bootstrapMetaAdsPublishConfig,
  bootstrapMetaAdsPublishConfigFromDerivedPlan,
  deriveMetaAdsPublishBootstrapPlan,
  exerciseStagingMetaAdsTrackingFixture,
  handleMetaAdsPublishRequest,
  rollbackBootstrapMetaAdsPublishConfig,
} from '../src/meta-ads-publish.js';
import { handleRequest } from '../src/index.js';

const RAW_URL_TAGS = 'key1=value1&payload=abc==&key2=value2%20x';
const SOURCE_ADSET_ID = '323456790';
const TARGET_ADSET_ID = '323456791';
const WHATSAPP_ADSET_ID = '323456792';

class BootstrapStatement {
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
    if (this.sql.includes('FROM meta_ads_publish_runs') && this.sql.includes('batch_fingerprint = ?')) {
      return this.db.runsByFingerprint.get(this.values[0]) || null;
    }
    if (this.sql.includes('FROM meta_ads_publish_adset_tracking_snapshots')) {
      if (this.sql.includes('operation_key = ?')) return this.db.snapshotsByOperation.get(this.values[0]) || null;
      if (this.sql.includes('id = ?')) return this.db.snapshotsById.get(this.values[0]) || null;
    }
    if (this.sql.includes('FROM meta_ads_publish_locks')) {
      return this.db.operationLocks.get(this.values[0]) || null;
    }
    if (this.sql.includes('FROM meta_ads_publish_bootstrap_operations')) {
      return this.db.bootstrapOperations.get(this.values[0]) || null;
    }
    if (this.sql.includes('FROM meta_ads_publish_config_operations')) {
      return this.db.configOperations.get(this.values[0]) || null;
    }
    if (this.sql.includes('FROM meta_ads_publish_config_locks')) {
      return this.db.locks.get(this.values[0]) || null;
    }
    if (this.sql.includes('FROM credential_tokens') && this.sql.includes('WHERE id = ?')) {
      return this.db.tokens.find((row) => row.id === this.values[0]) || null;
    }
    throw new Error(`Unexpected first SQL: ${this.sql}`);
  }

  async all() {
    if (this.sql.includes('FROM credential_tokens')) {
      return {
        results: this.db.tokens
          .filter((row) => row.provider === 'facebook' && row.active === 1)
          .map((row) => ({ ...row })),
      };
    }
    throw new Error(`Unexpected all SQL: ${this.sql}`);
  }

  async run() {
    if (this.sql.includes('DELETE FROM meta_ads_publish_config_locks')) {
      const [resourceKey, ownerOrNow] = this.values;
      const lock = this.db.locks.get(resourceKey);
      const hasOwner = typeof ownerOrNow === 'string' && !/^\d{4}-\d{2}-\d{2}T/.test(ownerOrNow);
      if (lock && (!hasOwner
        ? Date.parse(lock.expires_at) <= Date.parse(ownerOrNow)
        : lock.owner_id === ownerOrNow)) {
        this.db.locks.delete(resourceKey);
        return changed(1);
      }
      return changed(0);
    }
    if (this.sql.includes('INSERT INTO meta_ads_publish_config_locks')) {
      const [resourceKey, ownerId, expiresAt] = this.values;
      const existing = this.db.locks.get(resourceKey);
      if (!existing || Date.parse(existing.expires_at) <= Date.now()) {
        this.db.locks.set(resourceKey, { resource_key: resourceKey, owner_id: ownerId, expires_at: expiresAt });
        return changed(1);
      }
      return changed(0);
    }
    if (this.sql.includes('UPDATE meta_ads_publish_config_locks')) {
      const [expiresAt, , resourceKey, ownerId] = this.values;
      const existing = this.db.locks.get(resourceKey);
      if (existing && existing.owner_id === ownerId) {
        existing.expires_at = expiresAt;
        return changed(1);
      }
      return changed(0);
    }
    if (this.sql.includes('INSERT INTO meta_ads_publish_bootstrap_operations')) {
      const [id, operationKey, requestHash, expectedRevision, stateCiphertext, summaryJson] = this.values;
      if (this.db.bootstrapOperations.has(operationKey)) return changed(0);
      this.db.bootstrapOperations.set(operationKey, {
        id,
        operation_key: operationKey,
        request_hash: requestHash,
        expected_config_authority_revision: expectedRevision,
        resulting_tracking_binding_revision: '',
        status: 'pending',
        state_ciphertext: stateCiphertext,
        summary_json: summaryJson,
      });
      return changed(1);
    }
    if (this.sql.includes('UPDATE meta_ads_publish_bootstrap_operations')) {
      const [status, stateCiphertext, summaryJson, resultingRevision, , id, operationKey, requestHash] = this.values;
      const operation = this.db.bootstrapOperations.get(operationKey);
      if (!operation || operation.id !== id || operation.request_hash !== requestHash) return changed(0);
      operation.status = status;
      operation.state_ciphertext = stateCiphertext;
      operation.summary_json = summaryJson;
      if (resultingRevision) operation.resulting_tracking_binding_revision = resultingRevision;
      return changed(1);
    }
    if (this.sql.includes('INSERT INTO meta_ads_publish_runs')) {
      const [id, fingerprint, requestHash, workflowExecutionId, configRevision] = this.values;
      if (this.db.runsByFingerprint.has(fingerprint)) return changed(0);
      const run = {
        id,
        batch_fingerprint: fingerprint,
        request_hash: requestHash,
        workflow_execution_id: workflowExecutionId,
        config_revision: configRevision,
        status: 'processing',
        summary_json: '{}',
      };
      this.db.runsByFingerprint.set(fingerprint, run);
      this.db.runsById.set(id, run);
      return changed(1);
    }
    if (this.sql.includes('UPDATE meta_ads_publish_runs SET status')) {
      const [status, summaryJson, , runId] = this.values;
      const run = this.db.runsById.get(runId);
      if (!run) return changed(0);
      run.status = status;
      run.summary_json = summaryJson;
      return changed(1);
    }
    if (this.sql.includes('INSERT OR IGNORE INTO meta_ads_publish_adset_tracking_snapshots')) {
      const [
        id, runId, operationKey, tokenId, accountId, adsetId, profileRef,
        previousCiphertext, previousFingerprint, desiredFingerprint, desiredCiphertext, trackingKeysJson,
      ] = this.values;
      if (this.db.snapshotsByOperation.has(operationKey)) return changed(0);
      const snapshot = {
        id,
        run_id: runId,
        operation_key: operationKey,
        token_id: tokenId,
        account_id: accountId,
        adset_id: adsetId,
        profile_ref: profileRef,
        previous_promoted_object_ciphertext: previousCiphertext,
        previous_promoted_object_fingerprint: previousFingerprint,
        desired_promoted_object_fingerprint: desiredFingerprint,
        desired_tracking_promoted_object_ciphertext: desiredCiphertext,
        tracking_keys_json: trackingKeysJson,
        status: 'captured',
      };
      this.db.snapshotsByOperation.set(operationKey, snapshot);
      this.db.snapshotsById.set(id, snapshot);
      return changed(1);
    }
    if (this.sql.includes("UPDATE meta_ads_publish_adset_tracking_snapshots") && this.sql.includes("status = 'reconciled'")) {
      const [, snapshotId] = this.values;
      const snapshot = this.db.snapshotsById.get(snapshotId);
      if (!snapshot || snapshot.status !== 'captured') return changed(0);
      snapshot.status = 'reconciled';
      return changed(1);
    }
    if (this.sql.includes("UPDATE meta_ads_publish_adset_tracking_snapshots") && this.sql.includes("status = 'restored'")) {
      const [, , snapshotId] = this.values;
      const snapshot = this.db.snapshotsById.get(snapshotId);
      if (!snapshot) return changed(0);
      snapshot.status = 'restored';
      return changed(1);
    }
    if (this.sql.includes('INSERT INTO meta_ads_publish_locks')) {
      const [resourceKey, runId, operationKey, , expiresAt] = this.values;
      this.db.operationLocks.set(resourceKey, {
        resource_key: resourceKey,
        run_id: runId,
        operation_key: operationKey,
        expires_at: expiresAt,
      });
      return changed(1);
    }
    if (this.sql.includes('DELETE FROM meta_ads_publish_locks')) {
      const [runId, operationKey, ...resourceKeys] = this.values;
      for (const [resourceKey, lock] of this.db.operationLocks) {
        if (
          lock.run_id === runId &&
          lock.operation_key === operationKey &&
          (!resourceKeys.length || resourceKeys.includes(resourceKey))
        ) {
          this.db.operationLocks.delete(resourceKey);
        }
      }
      return changed(1);
    }
    throw new Error(`Unexpected run SQL: ${this.sql}`);
  }
}

class BootstrapDb {
  constructor() {
    this.tokens = [
      tokenRow('facebook_a_source', 'Website source', SOURCE_ADSET_ID, 1),
      tokenRow('facebook_b_target', 'Website target', TARGET_ADSET_ID, 2),
      tokenRow('facebook_c_whatsapp', 'Click to WhatsApp', WHATSAPP_ADSET_ID, 3),
      {
        id: 'facebook_unrelated',
        provider: 'facebook',
        unit: 'Unrelated',
        external_account_id: '123456789',
        token_type: 'long_lived_access_token',
        token_ciphertext: 'credential:facebook_unrelated',
        expires_at: null,
        active: 1,
        updated_at: '2026-08-13T00:00:00.000Z',
        metadata_json: JSON.stringify({ unrelated_metadata: { retain: true, owner: 'another-workflow' } }),
      },
    ];
    this.bootstrapOperations = new Map();
    this.configOperations = new Map();
    this.locks = new Map();
    this.runsByFingerprint = new Map();
    this.runsById = new Map();
    this.operationLocks = new Map();
    this.snapshotsByOperation = new Map();
    this.snapshotsById = new Map();
  }

  prepare(sql) {
    return new BootstrapStatement(this, sql);
  }

  async batch(statements) {
    const results = [];
    for (const statement of statements) {
      const { sql, values } = statement;
      if (sql.includes('INSERT INTO meta_ads_publish_config_operations')) {
        const [id, operationKey, targetTokenIdsJson, requestHash, expectedRevision, resultingRevision] = values;
        if (this.configOperations.has(operationKey)) {
          results.push(changed(0));
          continue;
        }
        this.configOperations.set(operationKey, {
          id,
          operation_key: operationKey,
          target_token_ids_json: targetTokenIdsJson,
          request_hash: requestHash,
          expected_tracking_binding_revision: expectedRevision,
          resulting_tracking_binding_revision: resultingRevision,
          status: 'pending',
        });
        results.push(changed(1));
        continue;
      }
      if (sql.startsWith('UPDATE credential_tokens SET metadata_json = CASE') && !sql.includes('meta_ads_publish_config_operations')) {
        const planCount = (sql.match(/WHEN \? THEN \?/g) || []).length;
        const nextPairs = values.slice(0, planCount * 2);
        const targetIds = values.slice(planCount * 2 + 1, planCount * 3 + 1);
        const oldPairs = values.slice(planCount * 3 + 1, planCount * 5 + 1);
        const requiredCount = values[planCount * 5 + 1];
        const plans = Array.from({ length: planCount }, (_, index) => ({
          id: nextPairs[index * 2],
          nextMetadataJson: nextPairs[index * 2 + 1],
          oldMetadataJson: oldPairs[index * 2 + 1],
        }));
        const eligible = targetIds.length === planCount && new Set(targetIds).size === planCount &&
          plans.filter((plan) => {
            const row = this.tokens.find((item) => item.id === plan.id);
            return row && row.provider === 'facebook' && row.active === 1 && row.metadata_json === plan.oldMetadataJson;
          }).length === requiredCount;
        if (!eligible) {
          results.push(changed(0));
          continue;
        }
        for (const plan of plans) this.tokens.find((row) => row.id === plan.id).metadata_json = plan.nextMetadataJson;
        results.push(changed(planCount));
        continue;
      }
      if (sql.startsWith('UPDATE credential_tokens SET metadata_json = CASE')) {
        const planCount = (sql.match(/WHEN \? THEN \?/g) || []).length;
        const nextPairs = values.slice(0, planCount * 2);
        const targetIds = values.slice(planCount * 2 + 1, planCount * 3 + 1);
        const oldPairs = values.slice(planCount * 3 + 1, planCount * 5 + 1);
        const requiredCount = values[planCount * 5 + 1];
        const operationId = values[planCount * 5 + 2];
        const requestHash = values[planCount * 5 + 3];
        const operation = [...this.configOperations.values()].find((entry) => entry.id === operationId);
        const plans = Array.from({ length: planCount }, (_, index) => ({
          id: nextPairs[index * 2],
          nextMetadataJson: nextPairs[index * 2 + 1],
          oldMetadataJson: oldPairs[index * 2 + 1],
        }));
        const eligible = operation && operation.status === 'pending' && operation.request_hash === requestHash &&
          targetIds.length === planCount && new Set(targetIds).size === planCount &&
          plans.filter((plan) => {
            const row = this.tokens.find((item) => item.id === plan.id);
            return row && row.provider === 'facebook' && row.active === 1 && row.metadata_json === plan.oldMetadataJson;
          }).length === requiredCount;
        if (!eligible) {
          results.push(changed(0));
          continue;
        }
        for (const plan of plans) {
          const row = this.tokens.find((item) => item.id === plan.id);
          row.metadata_json = plan.nextMetadataJson;
        }
        results.push(changed(planCount));
        continue;
      }
      if (sql.startsWith('UPDATE meta_ads_publish_config_operations SET status')) {
        const [, operationId, ...pairsAndCount] = values;
        const requiredCount = pairsAndCount.at(-1);
        const pairs = pairsAndCount.slice(0, -1);
        const operation = [...this.configOperations.values()].find((entry) => entry.id === operationId);
        const applied = operation && operation.status === 'pending' &&
          Array.from({ length: requiredCount }, (_, index) => {
            const row = this.tokens.find((item) => item.id === pairs[index * 2]);
            return row && row.metadata_json === pairs[index * 2 + 1];
          }).every(Boolean);
        if (applied) operation.status = 'applied';
        results.push(changed(applied ? 1 : 0));
        continue;
      }
      if (sql.startsWith("UPDATE meta_ads_publish_bootstrap_operations SET status = 'rolled_back'")) {
        const [stateCiphertext, summaryJson, , operationId, operationKey, requestHash, expectedRevision, ...pairsAndCount] = values;
        const requiredCount = pairsAndCount.at(-1);
        const pairs = pairsAndCount.slice(0, -1);
        const operation = this.bootstrapOperations.get(operationKey);
        const restored = operation && operation.id === operationId && operation.request_hash === requestHash &&
          operation.status === 'applied' && operation.resulting_tracking_binding_revision === expectedRevision &&
          Array.from({ length: requiredCount }, (_, index) => {
            const row = this.tokens.find((item) => item.id === pairs[index * 2]);
            return row && row.metadata_json === pairs[index * 2 + 1];
          }).every(Boolean);
        if (restored) {
          operation.status = 'rolled_back';
          operation.state_ciphertext = stateCiphertext;
          operation.summary_json = summaryJson;
        }
        results.push(changed(restored ? 1 : 0));
        continue;
      }
      if (sql.includes('INSERT INTO credential_token_audit')) {
        results.push(changed(1));
        continue;
      }
      if (sql.includes('DELETE FROM meta_ads_publish_config_operations')) {
        const [operationId] = values;
        const entry = [...this.configOperations.entries()].find(([, value]) => value.id === operationId && value.status === 'pending');
        if (entry) this.configOperations.delete(entry[0]);
        results.push(changed(entry ? 1 : 0));
        continue;
      }
      throw new Error(`Unexpected batch SQL: ${sql}`);
    }
    return results;
  }
}

class BootstrapGraph {
  constructor({
    failTargetReadback = false,
    failTargetTrackingRestore = false,
    ambiguousCopyAdsetId = '',
  } = {}) {
    this.failTargetReadback = failTargetReadback;
    this.failTargetTrackingRestore = failTargetTrackingRestore;
    this.ambiguousCopyAdsetId = String(ambiguousCopyAdsetId || '');
    this.onTargetAdsetPost = null;
    this.onTargetAdsetRead = null;
    this.calls = [];
    this.nextFixture = 923456780;
    this.targetPostCount = 0;
    this.staleTargetReadServed = false;
    this.adsets = new Map([
      [SOURCE_ADSET_ID, websiteAdset({
        pixel_id: '723456789', custom_event_type: 'SCHEDULE', offline_conversion_data_set_id: '823456789',
      })],
      [TARGET_ADSET_ID, websiteAdset({
        pixel_id: '923456789', custom_conversion_id: '103456789', product_catalog_id: '113456789',
      })],
      [WHATSAPP_ADSET_ID, {
        account_id: '123456789',
        campaign: { id: '223456789', objective: 'OUTCOME_TRAFFIC' },
        billing_event: 'IMPRESSIONS',
        optimization_goal: 'LINK_CLICKS',
        destination_type: 'WHATSAPP',
        attribution_spec: [{ event_type: 'CLICK_THROUGH' }],
        promoted_object: {},
      }],
    ]);
    this.targetBefore = clone(this.adsets.get(TARGET_ADSET_ID));
    this.ads = new Map([
      ['723456780', ad('723456780', SOURCE_ADSET_ID, '823456780', RAW_URL_TAGS)],
      ['723456792', {
        ...ad('723456792', WHATSAPP_ADSET_ID, '823456792'),
        creative: {
          id: '823456792',
          asset_feed_spec: {
            link_urls: [{ website_url: 'https://api.whatsapp.com/send?phone=5551999999999' }],
          },
        },
      }],
    ]);
    this.creatives = new Map();
  }

  async fetch(url, init = {}) {
    const parsed = new URL(url);
    const parts = parsed.pathname.split('/').filter(Boolean);
    const id = parts[1];
    const child = parts[2] || '';
    const method = init.method || 'GET';
    const body = init.body ? JSON.parse(init.body) : null;
    this.calls.push({ id, child, method, body });

    if (method === 'POST' && child === 'copies') {
      const copied = this.copyFixture(body);
      if (this.ambiguousCopyAdsetId && String(body?.adset_id) === this.ambiguousCopyAdsetId) {
        throw new Error('simulated_copy_transport_interruption');
      }
      return copied;
    }
    if (method === 'POST' && this.adsets.has(id)) {
      if (id === TARGET_ADSET_ID && this.failTargetTrackingRestore && this.targetPostCount > 0) {
        return json({ error: { message: 'simulated_tracking_restore_failure', is_transient: true } }, 500);
      }
      this.adsets.get(id).promoted_object = clone(body.promoted_object);
      if (id === TARGET_ADSET_ID) this.targetPostCount += 1;
      if (id === TARGET_ADSET_ID && typeof this.onTargetAdsetPost === 'function') {
        await this.onTargetAdsetPost({ graph: this, body: clone(body) });
      }
      return json({ success: true });
    }
    if (method === 'POST' && this.ads.has(id)) {
      const current = this.ads.get(id);
      current.status = body.status || current.status;
      current.effective_status = body.status || current.effective_status;
      return json({ success: true });
    }
    if (method !== 'GET') throw new Error(`Unexpected graph mutation ${method} ${parsed.pathname}`);

    if (child === 'adsets' && id === 'act_123456789') {
      return json({
        data: [...this.adsets.entries()].map(([adsetId, value]) => ({ id: adsetId, ...clone(value) })),
      });
    }
    if (child === 'ads') {
      return json({ data: [...this.ads.values()].filter((entry) => entry.adset_id === id).map(clone) });
    }
    if (this.adsets.has(id)) {
      if (id === TARGET_ADSET_ID && typeof this.onTargetAdsetRead === 'function') {
        await this.onTargetAdsetRead({ graph: this });
      }
      if (id === TARGET_ADSET_ID && this.failTargetReadback && this.targetPostCount > 0 && !this.staleTargetReadServed) {
        this.staleTargetReadServed = true;
        return json(this.targetBefore);
      }
      return json(this.adsets.get(id));
    }
    if (this.ads.has(id)) return json(this.ads.get(id));
    if (this.creatives.has(id)) return json(this.creatives.get(id));
    throw new Error(`Unexpected graph read ${parsed.pathname}`);
  }

  copyFixture(body) {
    const adId = String(this.nextFixture++);
    const creativeId = String(this.nextFixture++);
    const creative = {
      id: creativeId,
      name: body.creative_parameters.name,
      url_tags: body.creative_parameters.url_tags,
    };
    this.creatives.set(creativeId, creative);
    this.ads.set(adId, {
      id: adId,
      adset_id: body.adset_id,
      status: 'PAUSED',
      effective_status: 'PAUSED',
      creative: clone(creative),
    });
    return json({ copied_ad_id: adId });
  }
}

function changed(count) {
  return { meta: { changes: count } };
}

function tokenRow(id, unit, adsetId, rowNumber) {
  return {
    id,
    provider: 'facebook',
    unit,
    external_account_id: '123456789',
    token_type: 'long_lived_access_token',
    token_ciphertext: `credential:${id}`,
    expires_at: null,
    active: 1,
    updated_at: '2026-08-13T00:00:00.000Z',
    metadata_json: JSON.stringify({
      custody_owner: 'approved-private-manifest',
      unrelated_metadata: { retain: true },
      meta_ads_publish: legacyConfig(unit, adsetId, rowNumber),
    }),
  };
}

function legacyConfig(destinationGroup, adsetId, rowNumber) {
  return {
    row_number: rowNumber,
    destination_group: destinationGroup,
    api_version: 'v25.0',
    account_id: '123456789',
    campaign_id: '223456789',
    adset_id: adsetId,
    page_id: String(423456780 + rowNumber),
    instagram_user_id: String(523456780 + rowNumber),
    allowed_link_hosts: ['espacofacial.com'],
    landing_pages_by_creative_group: {
      DEFAULT: `https://espacofacial.com/agendamento?unit=${rowNumber}`,
    },
    legacy_marker: 'v18-source',
  };
}

function websiteAdset(promotedObject) {
  return {
    account_id: '123456789',
    campaign: { id: '223456789', objective: 'OUTCOME_SALES' },
    billing_event: 'IMPRESSIONS',
    optimization_goal: 'OFFSITE_CONVERSIONS',
    destination_type: 'WEBSITE',
    attribution_spec: [{ event_type: 'CLICK_THROUGH' }],
    promoted_object: clone(promotedObject),
  };
}

function ad(id, adsetId, creativeId, urlTags = '') {
  return {
    id,
    adset_id: adsetId,
    status: 'ACTIVE',
    effective_status: 'ACTIVE',
    creative: { id: creativeId, ...(urlTags ? { url_tags: urlTags } : {}) },
  };
}

function enableDerivedStagingLineage(graph) {
  // Each legacy Website destination must have a distinct, already-enrolled
  // peer source. The source row itself is never implicitly adopted from its
  // own delivery creative.
  graph.ads.set('723456791', ad('723456791', TARGET_ADSET_ID, '823456791', RAW_URL_TAGS));
}

function json(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

async function legacyAuthorityRevision(env) {
  const response = await handleMetaAdsPublishRequest({
    request: new Request('https://token-vault.test/v1/meta-ads-publish/config'),
    env,
    requestId: 'bootstrap-authority-read',
    pathname: '/v1/meta-ads-publish/config',
    decryptToken: async () => { throw new Error('config read must not decrypt'); },
    writeAudit: async () => {},
  });
  const body = await response.json();
  assert.equal(response.status, 409);
  assert.match(body.config_authority_revision, /^legacy:[a-f0-9]{64}$/);
  return body.config_authority_revision;
}

function requestBody(expectedConfigAuthorityRevision, operationKey = 'bootstrap-test-happy-001') {
  return {
    operation_key: operationKey,
    expected_config_authority_revision: expectedConfigAuthorityRevision,
    entries: [
      {
        config_token_id: 'facebook_a_source',
        destination_type: 'website',
        source_config_token_id: 'facebook_a_source',
        fixture_source_ad_id: '723456780',
        url_tags: RAW_URL_TAGS,
      },
      {
        config_token_id: 'facebook_b_target',
        destination_type: 'website',
        source_adset_id: SOURCE_ADSET_ID,
        fixture_source_ad_id: '723456780',
        url_tags: RAW_URL_TAGS,
      },
      {
        config_token_id: 'facebook_c_whatsapp',
        destination_type: 'whatsapp',
      },
    ],
  };
}

function bootstrapRequest(body) {
  return new Request('https://token-vault.test/v1/meta-ads-publish/config/bootstrap', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

function bootstrapDerivePlanRequest(expectedConfigAuthorityRevision) {
  return new Request('https://token-vault.test/v1/meta-ads-publish/config/bootstrap/derive-plan', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ expected_config_authority_revision: expectedConfigAuthorityRevision }),
  });
}

function bootstrapDeriveRequest({ operationKey, expectedConfigAuthorityRevision, expectedManifestSha256 }) {
  return new Request('https://token-vault.test/v1/meta-ads-publish/config/bootstrap/derive', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      operation_key: operationKey,
      expected_config_authority_revision: expectedConfigAuthorityRevision,
      expected_manifest_sha256: expectedManifestSha256,
    }),
  });
}

function bootstrapRollbackRequest(operationKey, expectedTrackingBindingRevision) {
  return new Request('https://token-vault.test/v1/meta-ads-publish/config/bootstrap/rollback', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      operation_key: operationKey,
      expected_tracking_binding_revision: expectedTrackingBindingRevision,
    }),
  });
}

function stagingExerciseRequest(operationKey) {
  return new Request('https://token-vault.test/v1/meta-ads-publish/config/staging-exercise', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ operation_key: operationKey }),
  });
}

function bootstrapContext({ db, graph, state }) {
  const env = {
    TOKEN_VAULT_DB: db,
    META_GRAPH_FETCH: graph.fetch.bind(graph),
    META_GRAPH_SLEEP: async () => {},
    LANDING_PAGE_FETCH: async () => new Response('', { status: 200 }),
  };
  return {
    env,
    decryptToken: async (value) => state.get(value) || 'graph-access-token',
    encryptToken: async (value) => {
      const key = `cipher:${state.size + 1}`;
      state.set(key, String(value));
      return key;
    },
  };
}

async function applyHappyBootstrap({ db, graph, state, operationKey }) {
  const { env, decryptToken, encryptToken } = bootstrapContext({ db, graph, state });
  const expectedRevision = await legacyAuthorityRevision(env);
  const body = requestBody(expectedRevision, operationKey);
  const result = await bootstrapMetaAdsPublishConfig({
    request: bootstrapRequest(body),
    env,
    requestId: `${operationKey}:apply`,
    decryptToken,
    encryptToken,
    writeAudit: async () => {},
  });
  const payload = await result.json();
  assert.equal(result.status, 201, JSON.stringify(payload));
  return { env, decryptToken, encryptToken, body, payload };
}

test('autonomous bootstrap derivation keeps the manifest private and applies only its hash-bound plan', async () => {
  const db = new BootstrapDb();
  const graph = new BootstrapGraph();
  enableDerivedStagingLineage(graph);
  const state = new Map();
  const { env, decryptToken, encryptToken } = bootstrapContext({ db, graph, state });
  env.ENVIRONMENT = 'staging';
  const expectedRevision = await legacyAuthorityRevision(env);

  const plan = await deriveMetaAdsPublishBootstrapPlan({
    request: bootstrapDerivePlanRequest(expectedRevision),
    env,
    requestId: 'bootstrap-derive-plan-private',
    decryptToken,
  });
  const planPayload = await plan.json();
  assert.equal(plan.status, 200, JSON.stringify(planPayload));
  assert.equal(planPayload.ok, true);
  assert.equal(planPayload.config_authority_revision, expectedRevision);
  assert.match(planPayload.manifest_sha256, /^[a-f0-9]{64}$/);
  assert.deepEqual(planPayload.summary, {
    destination_count: 3,
    website_destination_count: 2,
    whatsapp_destination_count: 1,
    staging_fixture_count: 1,
  });
  const serializedPlan = JSON.stringify(planPayload);
  assert.equal(serializedPlan.includes(RAW_URL_TAGS), false);
  assert.equal(serializedPlan.includes(SOURCE_ADSET_ID), false);
  assert.equal(graph.calls.some((call) => call.method !== 'GET'), false);

  const applied = await bootstrapMetaAdsPublishConfigFromDerivedPlan({
    request: bootstrapDeriveRequest({
      operationKey: 'bootstrap-derive-apply-private-001',
      expectedConfigAuthorityRevision: expectedRevision,
      expectedManifestSha256: planPayload.manifest_sha256,
    }),
    env,
    requestId: 'bootstrap-derive-apply-private',
    decryptToken,
    encryptToken,
    writeAudit: async () => {},
  });
  const appliedPayload = await applied.json();
  assert.equal(applied.status, 201, JSON.stringify(appliedPayload));
  assert.equal(appliedPayload.ok, true);
  assert.equal(appliedPayload.website_fixture_count, 2);
  const targetConfig = JSON.parse(db.tokens.find((row) => row.id === 'facebook_b_target').metadata_json).meta_ads_publish;
  assert.equal(targetConfig.tracking_contract.url_tags, RAW_URL_TAGS);
  assert.equal(targetConfig.tracking_profiles[targetConfig.tracking_contract.profile_ref].staging_synthetic_fixture, true);
  assert.deepEqual(graph.adsets.get(TARGET_ADSET_ID).promoted_object, graph.targetBefore.promoted_object);

  const callsBeforeReplay = graph.calls.length;
  const replay = await bootstrapMetaAdsPublishConfigFromDerivedPlan({
    request: bootstrapDeriveRequest({
      operationKey: 'bootstrap-derive-apply-private-001',
      expectedConfigAuthorityRevision: expectedRevision,
      expectedManifestSha256: planPayload.manifest_sha256,
    }),
    env,
    requestId: 'bootstrap-derive-apply-private-replay',
    decryptToken,
    encryptToken,
    writeAudit: async () => {},
  });
  const replayPayload = await replay.json();
  assert.equal(replay.status, 200, JSON.stringify(replayPayload));
  assert.equal(replayPayload.ok, true);
  assert.equal(replayPayload.replayed, true);
  assert.equal(graph.calls.length, callsBeforeReplay);
});

test('autonomous bootstrap derivation rejects digest, authority and source ambiguity before any Graph mutation', async () => {
  const db = new BootstrapDb();
  const graph = new BootstrapGraph();
  enableDerivedStagingLineage(graph);
  const state = new Map();
  const { env, decryptToken, encryptToken } = bootstrapContext({ db, graph, state });
  env.ENVIRONMENT = 'staging';
  const expectedRevision = await legacyAuthorityRevision(env);
  const plan = await deriveMetaAdsPublishBootstrapPlan({
    request: bootstrapDerivePlanRequest(expectedRevision),
    env,
    requestId: 'bootstrap-derive-plan-stale',
    decryptToken,
  });
  const planPayload = await plan.json();
  assert.equal(plan.status, 200, JSON.stringify(planPayload));

  const callsBeforeWrongDigest = graph.calls.length;
  const wrongDigest = await bootstrapMetaAdsPublishConfigFromDerivedPlan({
    request: bootstrapDeriveRequest({
      operationKey: 'bootstrap-derive-wrong-digest-001',
      expectedConfigAuthorityRevision: expectedRevision,
      expectedManifestSha256: '0'.repeat(64),
    }),
    env,
    requestId: 'bootstrap-derive-wrong-digest',
    decryptToken,
    encryptToken,
    writeAudit: async () => {},
  });
  const wrongDigestPayload = await wrongDigest.json();
  assert.equal(wrongDigest.status, 409);
  assert.equal(wrongDigestPayload.error, 'meta_ads_publish_bootstrap_derive_plan_stale');
  assert.equal(graph.calls.slice(callsBeforeWrongDigest).some((call) => call.method !== 'GET'), false);

  const contractDb = new BootstrapDb();
  const contractGraph = new BootstrapGraph();
  enableDerivedStagingLineage(contractGraph);
  const contractState = new Map();
  const contract = bootstrapContext({ db: contractDb, graph: contractGraph, state: contractState });
  contract.env.ENVIRONMENT = 'staging';
  const contractRevision = await legacyAuthorityRevision(contract.env);
  const contractPlan = await deriveMetaAdsPublishBootstrapPlan({
    request: bootstrapDerivePlanRequest(contractRevision),
    env: contract.env,
    requestId: 'bootstrap-derive-plan-contract-drift',
    decryptToken: contract.decryptToken,
  });
  const contractPlanPayload = await contractPlan.json();
  assert.equal(contractPlan.status, 200, JSON.stringify(contractPlanPayload));
  contractGraph.adsets.get(SOURCE_ADSET_ID).promoted_object.offline_conversion_data_set_id = '823456788';
  const callsBeforeContractDrift = contractGraph.calls.length;
  const contractDrift = await bootstrapMetaAdsPublishConfigFromDerivedPlan({
    request: bootstrapDeriveRequest({
      operationKey: 'bootstrap-derive-contract-drift-001',
      expectedConfigAuthorityRevision: contractRevision,
      expectedManifestSha256: contractPlanPayload.manifest_sha256,
    }),
    env: contract.env,
    requestId: 'bootstrap-derive-contract-drift',
    decryptToken: contract.decryptToken,
    encryptToken: contract.encryptToken,
    writeAudit: async () => {},
  });
  const contractDriftPayload = await contractDrift.json();
  assert.equal(contractDrift.status, 409);
  assert.equal(contractDriftPayload.error, 'meta_ads_publish_bootstrap_derive_plan_stale');
  assert.equal(contractGraph.calls.slice(callsBeforeContractDrift).some((call) => call.method !== 'GET'), false);

  graph.ads.get('723456780').creative.url_tags = 'source=changed&value=1';
  const callsBeforeApply = graph.calls.length;
  const stale = await bootstrapMetaAdsPublishConfigFromDerivedPlan({
    request: bootstrapDeriveRequest({
      operationKey: 'bootstrap-derive-stale-apply-001',
      expectedConfigAuthorityRevision: expectedRevision,
      expectedManifestSha256: planPayload.manifest_sha256,
    }),
    env,
    requestId: 'bootstrap-derive-stale-apply',
    decryptToken,
    encryptToken,
    writeAudit: async () => {},
  });
  const stalePayload = await stale.json();
  assert.equal(stale.status, 409);
  assert.equal(stalePayload.error, 'meta_ads_publish_bootstrap_derive_plan_stale');
  assert.equal(graph.calls.slice(callsBeforeApply).some((call) => call.method !== 'GET'), false);

  const revisionDb = new BootstrapDb();
  const revisionGraph = new BootstrapGraph();
  enableDerivedStagingLineage(revisionGraph);
  const revisionState = new Map();
  const revision = bootstrapContext({ db: revisionDb, graph: revisionGraph, state: revisionState });
  revision.env.ENVIRONMENT = 'staging';
  const revisionBefore = await legacyAuthorityRevision(revision.env);
  const revisionPlan = await deriveMetaAdsPublishBootstrapPlan({
    request: bootstrapDerivePlanRequest(revisionBefore),
    env: revision.env,
    requestId: 'bootstrap-derive-plan-authority-drift',
    decryptToken: revision.decryptToken,
  });
  const revisionPlanPayload = await revisionPlan.json();
  assert.equal(revisionPlan.status, 200, JSON.stringify(revisionPlanPayload));
  const changedMetadata = JSON.parse(revisionDb.tokens[0].metadata_json);
  changedMetadata.meta_ads_publish.legacy_marker = 'v18-source-revised';
  revisionDb.tokens[0].metadata_json = JSON.stringify(changedMetadata);
  const callsBeforeAuthorityDrift = revisionGraph.calls.length;
  const authorityDrift = await bootstrapMetaAdsPublishConfigFromDerivedPlan({
    request: bootstrapDeriveRequest({
      operationKey: 'bootstrap-derive-authority-drift-001',
      expectedConfigAuthorityRevision: revisionBefore,
      expectedManifestSha256: revisionPlanPayload.manifest_sha256,
    }),
    env: revision.env,
    requestId: 'bootstrap-derive-authority-drift',
    decryptToken: revision.decryptToken,
    encryptToken: revision.encryptToken,
    writeAudit: async () => {},
  });
  const authorityDriftPayload = await authorityDrift.json();
  assert.equal(authorityDrift.status, 409);
  assert.equal(authorityDriftPayload.error, 'meta_ads_publish_bootstrap_binding_stale');
  assert.equal(revisionGraph.calls.slice(callsBeforeAuthorityDrift).some((call) => call.method !== 'GET'), false);

  const ambiguousDb = new BootstrapDb();
  const ambiguousGraph = new BootstrapGraph();
  const ambiguousState = new Map();
  const ambiguous = bootstrapContext({ db: ambiguousDb, graph: ambiguousGraph, state: ambiguousState });
  ambiguous.env.ENVIRONMENT = 'staging';
  const peerAdsetId = '323456793';
  ambiguousDb.tokens.push(tokenRow('facebook_d_peer', 'Website peer source', peerAdsetId, 4));
  ambiguousGraph.adsets.set(peerAdsetId, clone(ambiguousGraph.adsets.get(SOURCE_ADSET_ID)));
  ambiguousGraph.ads.set('723456781', ad('723456781', peerAdsetId, '823456781', 'source=other&value=2'));
  const ambiguousRevision = await legacyAuthorityRevision(ambiguous.env);
  const rejected = await deriveMetaAdsPublishBootstrapPlan({
    request: bootstrapDerivePlanRequest(ambiguousRevision),
    env: ambiguous.env,
    requestId: 'bootstrap-derive-plan-ambiguous',
    decryptToken: ambiguous.decryptToken,
  });
  const rejectedPayload = await rejected.json();
  assert.equal(rejected.status, 409);
  assert.equal(rejectedPayload.error, 'meta_ads_publish_bootstrap_derive_source_ambiguous');
  assert.equal(ambiguousGraph.calls.some((call) => call.method !== 'GET'), false);
});

test('autonomous bootstrap derivation fails closed instead of falling back after a source Graph authorization failure', async () => {
  const db = new BootstrapDb();
  const graph = new BootstrapGraph();
  const state = new Map();
  const { env, decryptToken } = bootstrapContext({ db, graph, state });
  env.ENVIRONMENT = 'staging';
  const unreadableAdsetId = '323456793';
  db.tokens.push(tokenRow('facebook_d_unreadable', 'Website unreadable peer', unreadableAdsetId, 4));
  const graphFetch = graph.fetch.bind(graph);
  env.META_GRAPH_FETCH = async (url, init) => {
    const parsed = new URL(url);
    if (parsed.pathname.endsWith(`/${unreadableAdsetId}`)) {
      return json({ error: { message: 'permission denied' } }, 403);
    }
    return graphFetch(url, init);
  };
  const expectedRevision = await legacyAuthorityRevision(env);
  const result = await deriveMetaAdsPublishBootstrapPlan({
    request: bootstrapDerivePlanRequest(expectedRevision),
    env,
    requestId: 'bootstrap-derive-source-auth-failure',
    decryptToken,
  });
  const payload = await result.json();
  assert.equal(result.status, 503);
  assert.equal(payload.error, 'meta_ads_publish_bootstrap_derive_unavailable');
  assert.equal(JSON.stringify(payload).includes(unreadableAdsetId), false);
  assert.equal(graph.calls.some((call) => call.method !== 'GET'), false);
});

test('autonomous bootstrap derivation never promotes a target creative into its own production source', async () => {
  const db = new BootstrapDb();
  const graph = new BootstrapGraph();
  const state = new Map();
  const { env, decryptToken } = bootstrapContext({ db, graph, state });
  env.ENVIRONMENT = 'production';
  const expectedRevision = await legacyAuthorityRevision(env);
  const result = await deriveMetaAdsPublishBootstrapPlan({
    request: bootstrapDerivePlanRequest(expectedRevision),
    env,
    requestId: 'bootstrap-derive-no-self-source',
    decryptToken,
  });
  const payload = await result.json();
  assert.equal(result.status, 409);
  assert.equal(payload.error, 'meta_ads_publish_bootstrap_derive_source_unavailable');
  assert.equal(graph.calls.some((call) => call.method !== 'GET'), false);
});

async function recordBootstrapAdsetLockContention({ db, env, lockKey, phase, observations }) {
  const lock = db.operationLocks.get(lockKey);
  try {
    await metaAdsPublishTest.acquireLocks(
      env,
      `competing-bootstrap-${phase}-${observations.length}`,
      `competing-bootstrap-${phase}-${observations.length}`,
      [lockKey],
    );
    observations.push({ phase, acquired: true, owner: lock?.operation_key || '', runId: lock?.run_id || '' });
  } catch (error) {
    observations.push({ phase, error: error.message, owner: lock?.operation_key || '', runId: lock?.run_id || '' });
  }
}

test('multi-resource acquisition releases only locks obtained by the failed operation', async () => {
  const db = new BootstrapDb();
  const graph = new BootstrapGraph();
  const state = new Map();
  const { env } = bootstrapContext({ db, graph, state });
  const expiresAt = new Date(Date.now() + 30 * 60 * 1000).toISOString();
  db.operationLocks.set('a', {
    resource_key: 'a',
    run_id: 'candidate',
    operation_key: 'candidate-op',
    expires_at: expiresAt,
  });
  db.operationLocks.set('z', {
    resource_key: 'z',
    run_id: 'incumbent',
    operation_key: 'incumbent-op',
    expires_at: expiresAt,
  });

  await assert.rejects(
    () => metaAdsPublishTest.acquireLocks(env, 'candidate', 'candidate-op', ['a', 'b', 'z']),
    { message: 'resource_locked:z' },
  );

  assert.equal(db.operationLocks.get('a')?.resource_key, 'a');
  assert.equal(db.operationLocks.get('a')?.run_id, 'candidate');
  assert.equal(db.operationLocks.get('a')?.operation_key, 'candidate-op');
  assert.ok(Date.parse(db.operationLocks.get('a')?.expires_at) >= Date.parse(expiresAt));
  assert.equal(db.operationLocks.has('b'), false);
  assert.deepEqual(db.operationLocks.get('z'), {
    resource_key: 'z',
    run_id: 'incumbent',
    operation_key: 'incumbent-op',
    expires_at: expiresAt,
  });
});

function assertBootstrapLockHeldThroughMutationReadback(observations, { lockKey, operationKey }) {
  const mutationIndex = observations.findIndex((entry) => entry.phase === 'mutation');
  const readbackIndex = observations.findIndex((entry, index) => index > mutationIndex && entry.phase === 'readback');
  assert.ok(mutationIndex >= 0, 'expected a promoted_object mutation observation');
  assert.ok(readbackIndex >= 0, 'expected a promoted_object readback after the mutation');
  for (const observation of [observations[mutationIndex], observations[readbackIndex]]) {
    assert.equal(observation.acquired, undefined);
    assert.equal(observation.error, `resource_locked:${lockKey}`);
    assert.equal(observation.runId, `bootstrap:${operationKey}`);
    assert.equal(observation.owner, `bootstrap-mutation:${operationKey}`);
  }
}

test('bootstrap moves legacy Website and Click-to-WhatsApp config to v20, preserving arbitrary raw URL tags', async () => {
  const db = new BootstrapDb();
  const graph = new BootstrapGraph();
  const state = new Map();
  const { env, decryptToken, encryptToken } = bootstrapContext({ db, graph, state });
  const expectedRevision = await legacyAuthorityRevision(env);
  const body = requestBody(expectedRevision);

  const result = await bootstrapMetaAdsPublishConfig({
    request: bootstrapRequest(body),
    env,
    requestId: 'bootstrap-happy',
    decryptToken,
    encryptToken,
    writeAudit: async () => {},
  });
  const payload = await result.json();

  assert.equal(result.status, 201, JSON.stringify(payload));
  assert.equal(payload.ok, true);
  assert.equal(payload.applied, true);
  assert.equal(payload.website_fixture_count, 2);
  assert.equal(payload.offline_dataset_count, 2);
  assert.equal(payload.website_url_tags_verified, true);
  assert.equal(payload.conversion_contract_verified, true);
  assert.doesNotMatch(JSON.stringify(payload), /key1=value1|payload=abc|%2520/);

  const fixtureCopies = graph.calls.filter((call) => call.method === 'POST' && call.child === 'copies');
  assert.equal(fixtureCopies.length, 2);
  for (const copy of fixtureCopies) {
    assert.equal(copy.body.status_option, 'PAUSED');
    assert.equal(copy.body.creative_parameters.url_tags, RAW_URL_TAGS);
    assert.equal(copy.body.creative_parameters.url_tags.includes('%2520'), false);
  }
  assert.deepEqual(graph.adsets.get(TARGET_ADSET_ID).promoted_object, {
    product_catalog_id: '113456789',
    pixel_id: '723456789',
    custom_event_type: 'SCHEDULE',
    offline_conversion_data_set_id: '823456789',
  });

  const sourceConfig = JSON.parse(db.tokens[0].metadata_json).meta_ads_publish;
  const targetConfig = JSON.parse(db.tokens[1].metadata_json).meta_ads_publish;
  const whatsappConfig = JSON.parse(db.tokens[2].metadata_json).meta_ads_publish;
  assert.equal(sourceConfig.destination_type, 'website');
  assert.equal(targetConfig.tracking_contract.url_tags, RAW_URL_TAGS);
  assert.equal(targetConfig.tracking_contract.url_tags.includes('%2520'), false);
  assert.equal(targetConfig.tracking_profiles[targetConfig.tracking_contract.profile_ref].offline_event_dataset_requirement, 'required');
  assert.equal(whatsappConfig.destination_type, 'whatsapp');
  assert.equal(whatsappConfig.whatsapp_destination_url, 'https://api.whatsapp.com/send?phone=5551999999999');
  assert.equal(Object.hasOwn(whatsappConfig, 'tracking_contract'), false);
  assert.equal(JSON.parse(db.tokens[1].metadata_json).unrelated_metadata.retain, true);

  const operation = db.bootstrapOperations.get(body.operation_key);
  assert.equal(operation.status, 'applied');
  assert.doesNotMatch(operation.summary_json, /key1=value1|723456789|823456789/);
  assert.doesNotMatch(operation.state_ciphertext, /key1=value1|723456789|823456789/);

  const replay = await bootstrapMetaAdsPublishConfig({
    request: bootstrapRequest(body),
    env,
    requestId: 'bootstrap-happy-replay',
    decryptToken,
    encryptToken,
    writeAudit: async () => {},
  });
  const replayPayload = await replay.json();
  assert.equal(replay.status, 200);
  assert.equal(replayPayload.replayed, true);
  assert.equal(graph.calls.filter((call) => call.method === 'POST' && call.child === 'copies').length, 2);
});

test('bootstrap holds the shared ad-set contract lock through promoted_object mutation and Graph readback', async () => {
  const db = new BootstrapDb();
  const graph = new BootstrapGraph();
  const state = new Map();
  const { env, decryptToken, encryptToken } = bootstrapContext({ db, graph, state });
  const operationKey = 'bootstrap-test-shared-adset-lock-001';
  const expectedRevision = await legacyAuthorityRevision(env);
  const lockKey = `adset-contract:123456789:${TARGET_ADSET_ID}`;
  const observations = [];
  let targetMutationSeen = false;
  graph.onTargetAdsetPost = async () => {
    targetMutationSeen = true;
    await recordBootstrapAdsetLockContention({ db, env, lockKey, phase: 'mutation', observations });
  };
  graph.onTargetAdsetRead = async () => {
    if (targetMutationSeen) {
      await recordBootstrapAdsetLockContention({ db, env, lockKey, phase: 'readback', observations });
    }
  };

  const result = await bootstrapMetaAdsPublishConfig({
    request: bootstrapRequest(requestBody(expectedRevision, operationKey)),
    env,
    requestId: 'bootstrap-shared-adset-lock',
    decryptToken,
    encryptToken,
    writeAudit: async () => {},
  });
  const payload = await result.json();

  assert.equal(result.status, 201, JSON.stringify(payload));
  assertBootstrapLockHeldThroughMutationReadback(observations, { lockKey, operationKey });
  assert.equal(db.operationLocks.size, 0);
});

test('bootstrap compensates the exact promoted_object when Graph POST succeeds but its readback is stale', async () => {
  const db = new BootstrapDb();
  const graph = new BootstrapGraph({ failTargetReadback: true });
  const state = new Map();
  const { env, decryptToken, encryptToken } = bootstrapContext({ db, graph, state });
  const expectedRevision = await legacyAuthorityRevision(env);
  const body = requestBody(expectedRevision, 'bootstrap-test-rollback-001');
  const targetBefore = clone(graph.targetBefore.promoted_object);

  const result = await bootstrapMetaAdsPublishConfig({
    request: bootstrapRequest(body),
    env,
    requestId: 'bootstrap-rollback',
    decryptToken,
    encryptToken,
    writeAudit: async () => {},
  });
  const payload = await result.json();

  assert.equal(result.status, 400);
  assert.equal(payload.ok, false);
  assert.equal(payload.error, 'meta_ads_publish_bootstrap_tracking_readback_mismatch');
  const targetPosts = graph.calls.filter((call) => call.id === TARGET_ADSET_ID && call.method === 'POST');
  assert.equal(targetPosts.length, 2);
  assert.equal(targetPosts[0].body.promoted_object.pixel_id, '723456789');
  assert.deepEqual(targetPosts[1].body.promoted_object, {
    product_catalog_id: '113456789',
    ...targetBefore,
  });
  assert.deepEqual(graph.adsets.get(TARGET_ADSET_ID).promoted_object, targetBefore);
  assert.equal(db.bootstrapOperations.get(body.operation_key).status, 'rolled_back');
});

test('external bootstrap rollback restores its encrypted legacy metadata, owned fixtures, and tracking only while the exact v20 authority remains current', async () => {
  const db = new BootstrapDb();
  const graph = new BootstrapGraph();
  const state = new Map();
  const legacyByToken = new Map(db.tokens.map((row) => [
    row.id,
    clone(JSON.parse(row.metadata_json).meta_ads_publish || {}),
  ]));
  const unrelatedBefore = db.tokens.find((row) => row.id === 'facebook_unrelated').metadata_json;
  const targetBefore = clone(graph.targetBefore.promoted_object);
  const applied = await applyHappyBootstrap({
    db,
    graph,
    state,
    operationKey: 'bootstrap-test-external-rollback-001',
  });
  const ownedFixtureIds = [...graph.ads.keys()].filter((id) => !['723456780', '723456792'].includes(id));
  assert.equal(ownedFixtureIds.length, 2);

  const laterMetadata = JSON.parse(db.tokens.find((row) => row.id === 'facebook_b_target').metadata_json);
  laterMetadata.unrelated_metadata.operator_note = 'preserve-later-non-meta-change';
  db.tokens.find((row) => row.id === 'facebook_b_target').metadata_json = JSON.stringify(laterMetadata);

  const rolledBack = await rollbackBootstrapMetaAdsPublishConfig({
    request: bootstrapRollbackRequest(applied.body.operation_key, applied.payload.tracking_binding_revision),
    env: applied.env,
    requestId: 'bootstrap-external-rollback',
    decryptToken: applied.decryptToken,
    encryptToken: applied.encryptToken,
    writeAudit: async () => {},
  });
  const rollbackPayload = await rolledBack.json();
  assert.equal(rolledBack.status, 200, JSON.stringify(rollbackPayload));
  assert.equal(rollbackPayload.ok, true);
  assert.equal(rollbackPayload.rolled_back, true);
  assert.equal(rollbackPayload.replayed, false);
  assert.match(rollbackPayload.config_authority_revision, /^legacy:[a-f0-9]{64}$/);

  for (const tokenId of ['facebook_a_source', 'facebook_b_target', 'facebook_c_whatsapp']) {
    const row = db.tokens.find((entry) => entry.id === tokenId);
    assert.deepEqual(JSON.parse(row.metadata_json).meta_ads_publish, legacyByToken.get(tokenId));
  }
  assert.equal(
    JSON.parse(db.tokens.find((row) => row.id === 'facebook_b_target').metadata_json).unrelated_metadata.operator_note,
    'preserve-later-non-meta-change',
  );
  assert.equal(db.tokens.find((row) => row.id === 'facebook_unrelated').metadata_json, unrelatedBefore);
  assert.deepEqual(graph.adsets.get(TARGET_ADSET_ID).promoted_object, targetBefore);
  for (const fixtureId of ownedFixtureIds) assert.equal(graph.ads.get(fixtureId).status, 'ARCHIVED');
  assert.equal(graph.ads.get('723456780').status, 'ACTIVE');
  assert.equal(graph.ads.get('723456792').status, 'ACTIVE');
  assert.equal(db.bootstrapOperations.get(applied.body.operation_key).status, 'rolled_back');

  const replay = await rollbackBootstrapMetaAdsPublishConfig({
    request: bootstrapRollbackRequest(applied.body.operation_key, applied.payload.tracking_binding_revision),
    env: applied.env,
    requestId: 'bootstrap-external-rollback-replay',
    decryptToken: applied.decryptToken,
    encryptToken: applied.encryptToken,
    writeAudit: async () => {},
  });
  const replayPayload = await replay.json();
  assert.equal(replay.status, 200);
  assert.equal(replayPayload.replayed, true);
});

test('external bootstrap rollback holds the shared ad-set contract lock through promoted_object restoration and Graph readback', async () => {
  const db = new BootstrapDb();
  const graph = new BootstrapGraph();
  const state = new Map();
  const operationKey = 'bootstrap-test-external-shared-adset-lock-001';
  const applied = await applyHappyBootstrap({ db, graph, state, operationKey });
  const lockKey = `adset-contract:123456789:${TARGET_ADSET_ID}`;
  const observations = [];
  let targetMutationSeen = false;
  graph.onTargetAdsetPost = async () => {
    targetMutationSeen = true;
    await recordBootstrapAdsetLockContention({ db, env: applied.env, lockKey, phase: 'mutation', observations });
  };
  graph.onTargetAdsetRead = async () => {
    if (targetMutationSeen) {
      await recordBootstrapAdsetLockContention({ db, env: applied.env, lockKey, phase: 'readback', observations });
    }
  };

  const result = await rollbackBootstrapMetaAdsPublishConfig({
    request: bootstrapRollbackRequest(operationKey, applied.payload.tracking_binding_revision),
    env: applied.env,
    requestId: 'bootstrap-external-shared-adset-lock',
    decryptToken: applied.decryptToken,
    encryptToken: applied.encryptToken,
    writeAudit: async () => {},
  });
  const payload = await result.json();

  assert.equal(result.status, 200, JSON.stringify(payload));
  assertBootstrapLockHeldThroughMutationReadback(observations, { lockKey, operationKey });
  assert.equal(db.operationLocks.size, 0);
});

test('external bootstrap rollback rejects a later v20 metadata change before touching Graph state', async () => {
  const db = new BootstrapDb();
  const graph = new BootstrapGraph();
  const state = new Map();
  const applied = await applyHappyBootstrap({
    db,
    graph,
    state,
    operationKey: 'bootstrap-test-stale-rollback-001',
  });
  const targetMetadata = JSON.parse(db.tokens.find((row) => row.id === 'facebook_b_target').metadata_json);
  targetMetadata.meta_ads_publish.destination_group = 'Changed after bootstrap';
  db.tokens.find((row) => row.id === 'facebook_b_target').metadata_json = JSON.stringify(targetMetadata);
  const callsBeforeRollback = graph.calls.length;

  const rollback = await rollbackBootstrapMetaAdsPublishConfig({
    request: bootstrapRollbackRequest(applied.body.operation_key, applied.payload.tracking_binding_revision),
    env: applied.env,
    requestId: 'bootstrap-stale-rollback',
    decryptToken: applied.decryptToken,
    encryptToken: applied.encryptToken,
    writeAudit: async () => {},
  });
  const payload = await rollback.json();
  assert.equal(rollback.status, 409);
  assert.equal(payload.error, 'meta_ads_publish_bootstrap_operation_state_stale');
  assert.equal(graph.calls.length, callsBeforeRollback);
  assert.equal(db.bootstrapOperations.get(applied.body.operation_key).status, 'applied');
  assert.equal(
    JSON.parse(db.tokens.find((row) => row.id === 'facebook_b_target').metadata_json).meta_ads_publish.destination_group,
    'Changed after bootstrap',
  );
});

test('staging exercise reconciles and restores the marked Website fixture while the operational bearer is denied', async () => {
  const db = new BootstrapDb();
  const graph = new BootstrapGraph();
  const state = new Map();
  const applied = await applyHappyBootstrap({
    db,
    graph,
    state,
    operationKey: 'bootstrap-test-staging-fixture-001',
  });
  const targetRow = db.tokens.find((row) => row.id === 'facebook_b_target');
  const targetMetadata = JSON.parse(targetRow.metadata_json);
  const profileRef = targetMetadata.meta_ads_publish.tracking_contract.profile_ref;
  targetMetadata.meta_ads_publish.tracking_profiles[profileRef].staging_synthetic_fixture = true;
  targetRow.metadata_json = JSON.stringify(targetMetadata);
  const targetBefore = clone(graph.targetBefore.promoted_object);
  graph.adsets.get(TARGET_ADSET_ID).promoted_object = clone(targetBefore);
  applied.env.ENVIRONMENT = 'staging';

  const exercised = await exerciseStagingMetaAdsTrackingFixture({
    request: stagingExerciseRequest('staging-tracking-fixture:exercise-001'),
    env: applied.env,
    requestId: 'staging-exercise',
    decryptToken: applied.decryptToken,
    encryptToken: applied.encryptToken,
    writeAudit: async () => {},
  });
  const payload = await exercised.json();
  assert.equal(exercised.status, 200, JSON.stringify(payload));
  assert.equal(payload.ok, true);
  assert.deepEqual(payload.exercise, {
    status: 'reconciled_and_rolled_back',
    reconciliation: 'reconciled',
    rollback: 'restored',
    fixture_count: 1,
  });
  assert.deepEqual(graph.adsets.get(TARGET_ADSET_ID).promoted_object, targetBefore);
  assert.equal([...db.snapshotsById.values()].length, 1);
  assert.equal([...db.snapshotsById.values()][0].status, 'restored');
  assert.equal([...db.runsById.values()][0].status, 'completed');
  assert.equal(db.operationLocks.size, 0);

  const denied = await handleRequest(new Request(
    'https://token-vault.test/internal/token-vault/v1/meta-ads-publish/config/staging-exercise',
    {
      method: 'POST',
      headers: {
        Authorization: 'Bearer operational-test-token',
        'content-type': 'application/json',
      },
      body: JSON.stringify({ operation_key: 'staging-tracking-fixture:deny-0001' }),
    },
  ), {
    REQUIRE_AUTH: 'true',
    TOKEN_VAULT_API_TOKEN: 'admin-test-token',
    TOKEN_VAULT_N8N_API_TOKEN: 'operational-test-token',
  });
  const deniedPayload = await denied.json();
  assert.equal(denied.status, 403);
  assert.equal(deniedPayload.error, 'meta_ads_config_credential_required');
});

test('staging bootstrap uses a direct source ad set, proves the fixture exercise, and rejects that marker in production', async () => {
  const db = new BootstrapDb();
  const graph = new BootstrapGraph();
  const state = new Map();
  const { env, decryptToken, encryptToken } = bootstrapContext({ db, graph, state });
  env.ENVIRONMENT = 'staging';
  const expectedRevision = await legacyAuthorityRevision(env);
  const body = requestBody(expectedRevision, 'bootstrap-test-staging-direct-source-001');
  const targetEntry = body.entries.find((entry) => entry.config_token_id === 'facebook_b_target');
  targetEntry.staging_synthetic_fixture = true;
  const targetBefore = clone(graph.targetBefore.promoted_object);

  const bootstrap = await bootstrapMetaAdsPublishConfig({
    request: bootstrapRequest(body),
    env,
    requestId: 'bootstrap-staging-direct-source',
    decryptToken,
    encryptToken,
    writeAudit: async () => {},
  });
  const bootstrapPayload = await bootstrap.json();
  assert.equal(bootstrap.status, 201, JSON.stringify(bootstrapPayload));

  const targetConfig = JSON.parse(db.tokens.find((row) => row.id === 'facebook_b_target').metadata_json).meta_ads_publish;
  const profileRef = targetConfig.tracking_contract.profile_ref;
  assert.equal(targetConfig.tracking_profiles[profileRef].source_adset_id, SOURCE_ADSET_ID);
  assert.equal(targetConfig.tracking_profiles[profileRef].staging_synthetic_fixture, true);
  assert.equal(targetConfig.tracking_contract.url_tags, RAW_URL_TAGS);
  assert.deepEqual(graph.adsets.get(TARGET_ADSET_ID).promoted_object, targetBefore);

  const exercise = await exerciseStagingMetaAdsTrackingFixture({
    request: stagingExerciseRequest('staging-tracking-fixture:direct-source-001'),
    env,
    requestId: 'staging-direct-source-exercise',
    decryptToken,
    encryptToken,
    writeAudit: async () => {},
  });
  const exercisePayload = await exercise.json();
  assert.equal(exercise.status, 200, JSON.stringify(exercisePayload));
  assert.equal(exercisePayload.exercise.rollback, 'restored');
  assert.deepEqual(graph.adsets.get(TARGET_ADSET_ID).promoted_object, targetBefore);

  const productionDb = new BootstrapDb();
  const productionGraph = new BootstrapGraph();
  const productionState = new Map();
  const production = bootstrapContext({ db: productionDb, graph: productionGraph, state: productionState });
  production.env.ENVIRONMENT = 'production';
  const productionExpectedRevision = await legacyAuthorityRevision(production.env);
  const productionBody = requestBody(productionExpectedRevision, 'bootstrap-test-production-marker-001');
  productionBody.entries.find((entry) => entry.config_token_id === 'facebook_b_target').staging_synthetic_fixture = true;

  const rejected = await bootstrapMetaAdsPublishConfig({
    request: bootstrapRequest(productionBody),
    env: production.env,
    requestId: 'bootstrap-production-marker',
    decryptToken: production.decryptToken,
    encryptToken: production.encryptToken,
    writeAudit: async () => {},
  });
  const rejectedPayload = await rejected.json();
  assert.equal(rejected.status, 409);
  assert.equal(rejectedPayload.error, 'meta_ads_publish_bootstrap_staging_fixture_forbidden');
  assert.equal(productionDb.bootstrapOperations.size, 0);
  assert.equal(productionGraph.calls.filter((call) => call.method === 'POST' && call.child === 'copies').length, 0);
});

test('external rollback fails closed when tracking restoration is unconfirmed, retaining v20 and the affected paused fixture', async () => {
  const db = new BootstrapDb();
  const graph = new BootstrapGraph();
  const state = new Map();
  const applied = await applyHappyBootstrap({
    db,
    graph,
    state,
    operationKey: 'bootstrap-test-external-rollback-restore-failure-001',
  });
  const targetRow = db.tokens.find((row) => row.id === 'facebook_b_target');
  const v20TargetConfig = clone(JSON.parse(targetRow.metadata_json).meta_ads_publish);
  const bootstrapState = JSON.parse(state.get(db.bootstrapOperations.get(applied.body.operation_key).state_ciphertext));
  const targetFixtureId = bootstrapState.items.find((item) => item.config_token_id === 'facebook_b_target').fixture.ad_id;
  graph.failTargetTrackingRestore = true;

  const rollback = await rollbackBootstrapMetaAdsPublishConfig({
    request: bootstrapRollbackRequest(applied.body.operation_key, applied.payload.tracking_binding_revision),
    env: applied.env,
    requestId: 'bootstrap-external-rollback-restore-failure',
    decryptToken: applied.decryptToken,
    encryptToken: applied.encryptToken,
    writeAudit: async () => {},
  });
  const payload = await rollback.json();
  assert.equal(rollback.status, 409);
  assert.equal(payload.error, 'meta_ads_publish_bootstrap_reconciliation_required');
  assert.equal(db.bootstrapOperations.get(applied.body.operation_key).status, 'reconciliation_required');
  assert.deepEqual(JSON.parse(targetRow.metadata_json).meta_ads_publish, v20TargetConfig);
  assert.equal(graph.ads.get(targetFixtureId).status, 'PAUSED');

  const replay = await rollbackBootstrapMetaAdsPublishConfig({
    request: bootstrapRollbackRequest(applied.body.operation_key, applied.payload.tracking_binding_revision),
    env: applied.env,
    requestId: 'bootstrap-external-rollback-restore-failure-replay',
    decryptToken: applied.decryptToken,
    encryptToken: applied.encryptToken,
    writeAudit: async () => {},
  });
  const replayPayload = await replay.json();
  assert.equal(replay.status, 409);
  assert.equal(replayPayload.error, 'meta_ads_publish_bootstrap_reconciliation_required');
  assert.equal(db.bootstrapOperations.get(applied.body.operation_key).status, 'reconciliation_required');
  assert.equal(graph.ads.get(targetFixtureId).status, 'PAUSED');
});

test('an ambiguous copy after its durable pre-intent never rolls back cleanly or issues a retry copy', async () => {
  const db = new BootstrapDb();
  const graph = new BootstrapGraph({ ambiguousCopyAdsetId: TARGET_ADSET_ID });
  const state = new Map();
  const { env, decryptToken, encryptToken } = bootstrapContext({ db, graph, state });
  const expectedRevision = await legacyAuthorityRevision(env);
  const body = requestBody(expectedRevision, 'bootstrap-test-ambiguous-copy-preintent-001');

  const interrupted = await bootstrapMetaAdsPublishConfig({
    request: bootstrapRequest(body),
    env,
    requestId: 'bootstrap-ambiguous-copy-preintent',
    decryptToken,
    encryptToken,
    writeAudit: async () => {},
  });
  const payload = await interrupted.json();
  assert.equal(interrupted.status, 409);
  assert.equal(payload.error, 'meta_ads_publish_bootstrap_reconciliation_required');
  const operation = db.bootstrapOperations.get(body.operation_key);
  assert.equal(operation.status, 'reconciliation_required');
  const persisted = JSON.parse(state.get(operation.state_ciphertext));
  const targetItem = persisted.items.find((item) => item.config_token_id === 'facebook_b_target');
  assert.equal(targetItem.fixture.copy_pending, true);
  assert.equal(targetItem.fixture.copy_ambiguous, true);
  const targetCopies = () => graph.calls.filter((call) => (
    call.method === 'POST' && call.child === 'copies' && call.body.adset_id === TARGET_ADSET_ID
  ));
  assert.equal(targetCopies().length, 1);
  const unownedAmbiguousFixture = [...graph.ads.values()].find((entry) => entry.adset_id === TARGET_ADSET_ID);
  assert.equal(unownedAmbiguousFixture.status, 'PAUSED');

  const retry = await bootstrapMetaAdsPublishConfig({
    request: bootstrapRequest(body),
    env,
    requestId: 'bootstrap-ambiguous-copy-preintent-retry',
    decryptToken,
    encryptToken,
    writeAudit: async () => {},
  });
  const retryPayload = await retry.json();
  assert.equal(retry.status, 409);
  assert.equal(retryPayload.error, 'meta_ads_publish_bootstrap_reconciliation_required');
  assert.equal(db.bootstrapOperations.get(body.operation_key).status, 'reconciliation_required');
  assert.equal(targetCopies().length, 1);
});

test('a resumed owned fixture whose tags drifted is never replaced by a second copy', async () => {
  const db = new BootstrapDb();
  const graph = new BootstrapGraph();
  const state = new Map();
  const applied = await applyHappyBootstrap({
    db,
    graph,
    state,
    operationKey: 'bootstrap-test-owned-fixture-tag-drift-001',
  });
  const restored = await rollbackBootstrapMetaAdsPublishConfig({
    request: bootstrapRollbackRequest(applied.body.operation_key, applied.payload.tracking_binding_revision),
    env: applied.env,
    requestId: 'bootstrap-owned-fixture-tag-drift-restore-legacy',
    decryptToken: applied.decryptToken,
    encryptToken: applied.encryptToken,
    writeAudit: async () => {},
  });
  assert.equal(restored.status, 200);

  const operation = db.bootstrapOperations.get(applied.body.operation_key);
  const persisted = JSON.parse(state.get(operation.state_ciphertext));
  persisted.config_input = null;
  persisted.config_applied = false;
  persisted.config_rolled_back = false;
  const sourceItem = persisted.items.find((item) => item.config_token_id === 'facebook_a_source');
  const targetItem = persisted.items.find((item) => item.config_token_id === 'facebook_b_target');
  for (const item of [sourceItem, targetItem]) {
    const fixture = graph.ads.get(item.fixture.ad_id);
    fixture.status = 'PAUSED';
    fixture.effective_status = 'PAUSED';
  }
  graph.ads.get(targetItem.fixture.ad_id).creative.url_tags = 'key1=externally-mutated';
  graph.creatives.get(targetItem.fixture.creative_id).url_tags = 'key1=externally-mutated';
  state.set(operation.state_ciphertext, JSON.stringify(persisted));
  operation.status = 'pending';
  operation.resulting_tracking_binding_revision = '';
  const targetCopyCount = () => graph.calls.filter((call) => (
    call.method === 'POST' && call.child === 'copies' && call.body.adset_id === TARGET_ADSET_ID
  )).length;
  const copiesBeforeResume = targetCopyCount();

  const resumed = await bootstrapMetaAdsPublishConfig({
    request: bootstrapRequest(applied.body),
    env: applied.env,
    requestId: 'bootstrap-owned-fixture-tag-drift-resume',
    decryptToken: applied.decryptToken,
    encryptToken: applied.encryptToken,
    writeAudit: async () => {},
  });
  const resumedPayload = await resumed.json();
  assert.equal(resumed.status, 409);
  assert.equal(resumedPayload.error, 'meta_ads_publish_bootstrap_reconciliation_required');
  assert.equal(db.bootstrapOperations.get(applied.body.operation_key).status, 'reconciliation_required');
  assert.equal(targetCopyCount(), copiesBeforeResume);

  const retry = await bootstrapMetaAdsPublishConfig({
    request: bootstrapRequest(applied.body),
    env: applied.env,
    requestId: 'bootstrap-owned-fixture-tag-drift-retry',
    decryptToken: applied.decryptToken,
    encryptToken: applied.encryptToken,
    writeAudit: async () => {},
  });
  assert.equal(retry.status, 409);
  assert.equal(targetCopyCount(), copiesBeforeResume);
});

test('the staging exercise holds the ad-set lock through both reconciliation and rollback', async () => {
  const db = new BootstrapDb();
  const graph = new BootstrapGraph();
  const state = new Map();
  const applied = await applyHappyBootstrap({
    db,
    graph,
    state,
    operationKey: 'bootstrap-test-staging-lock-continuity-001',
  });
  const targetRow = db.tokens.find((row) => row.id === 'facebook_b_target');
  const targetMetadata = JSON.parse(targetRow.metadata_json);
  const profileRef = targetMetadata.meta_ads_publish.tracking_contract.profile_ref;
  targetMetadata.meta_ads_publish.tracking_profiles[profileRef].staging_synthetic_fixture = true;
  targetRow.metadata_json = JSON.stringify(targetMetadata);
  graph.adsets.get(TARGET_ADSET_ID).promoted_object = clone(graph.targetBefore.promoted_object);
  applied.env.ENVIRONMENT = 'staging';
  const lockKey = `adset-contract:123456789:${TARGET_ADSET_ID}`;
  const contentions = [];
  graph.onTargetAdsetPost = async () => {
    const lock = db.operationLocks.get(lockKey);
    try {
      await metaAdsPublishTest.acquireLocks(
        applied.env,
        'competing-staging-run',
        'competing-staging-operation',
        [lockKey],
      );
      contentions.push({ acquired: true, owner: lock?.operation_key || '' });
    } catch (error) {
      contentions.push({ error: error.message, owner: lock?.operation_key || '' });
    }
  };

  const exercised = await exerciseStagingMetaAdsTrackingFixture({
    request: stagingExerciseRequest('staging-tracking-fixture:lock-continuity-001'),
    env: applied.env,
    requestId: 'staging-lock-continuity',
    decryptToken: applied.decryptToken,
    encryptToken: applied.encryptToken,
    writeAudit: async () => {},
  });
  const payload = await exercised.json();
  assert.equal(exercised.status, 200, JSON.stringify(payload));
  assert.equal(contentions.length, 2);
  for (const contention of contentions) {
    assert.equal(contention.acquired, undefined);
    assert.equal(contention.error, `resource_locked:${lockKey}`);
    assert.equal(contention.owner, 'staging-tracking-fixture:lock-continuity-001:transaction');
  }
  assert.equal(db.operationLocks.size, 0);
});
