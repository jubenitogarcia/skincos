import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { signCrmRequest } from '../runtime/auth.mjs';
import { createInfluencerIntelligenceServiceHandler, __testing as serviceTesting } from '../runtime/service-handler.mjs';
import { INFLUENCER_INTELLIGENCE_GRANT, INTERNAL_SERVICE_PATH } from '../runtime/runtime-contract.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..', '..', '..');
const unitService = fs.readFileSync(path.join(root, 'ops/runtime/units/influencer-intelligence.service'), 'utf8');
const unitMcp = fs.readFileSync(path.join(root, 'ops/runtime/units/influencer-intelligence-mcp.service'), 'utf8');
const installer = fs.readFileSync(path.join(root, 'scripts/runtime/install-influencer-intelligence-runtime.sh'), 'utf8');
const workflow = fs.readFileSync(path.join(root, 'orb/engine/workflows/influencer-intelligence-snapshot.json'), 'utf8');
const crmProxy = fs.readFileSync(path.join(root, 'crm/console/functions/api/influencer-intelligence/[[path]].ts'), 'utf8');
const tokenVaultWrangler = fs.readFileSync(path.join(root, 'platform/security/token-vault/wrangler.toml'), 'utf8');

const clock = () => 1_754_000_000_000;
const key = 'synthetic-runtime-hmac-key';
const actorScope = 'a'.repeat(64);

function envelope(data = { ok: true }) {
  const now = new Date(clock()).toISOString();
  return {
    data,
    data_classification: 'observed',
    freshness: 'fresh',
    retrieved_at: now,
    confidence: 1,
    coverage: { available_metrics: 1, expected_metrics: 1, ratio: 1 },
    providers: [],
    provenance: [{ provider: null, source_type: 'registry', source_ref: 'db:creator_registry', observed_at: now, retrieved_at: now, evidence_state: 'observed' }],
    limitations: [],
    errors: [],
  };
}

function crmRequest(pathname, { method = 'GET', body } = {}) {
  const timestamp = String(clock());
  const url = new URL(`http://127.0.0.1${pathname}`);
  const headers = new Headers({
    'x-crm-actor-scope': actorScope,
    'x-crm-actor-role': 'manager',
    'x-crm-ts': timestamp,
    'x-crm-signature-version': '2',
    'x-crm-grant': INFLUENCER_INTELLIGENCE_GRANT,
    'x-request-id': 'runtime-test',
  });
  headers.set('x-crm-signature', signCrmRequest(key, { timestamp, actorScope, method, path: url.pathname, search: url.search, grant: INFLUENCER_INTELLIGENCE_GRANT }));
  return new Request(url, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
}

test('registers both loopback units without enabling them or storing secrets', () => {
  assert.match(unitService, /EnvironmentFile=-__CONFIG_ROOT__\/influencer-intelligence\.env/);
  assert.match(unitMcp, /EnvironmentFile=-__CONFIG_ROOT__\/influencer-intelligence\.env/);
  assert.match(unitService, /127\.0\.0\.1:8899|SERVICE_PORT=8899/);
  assert.match(unitMcp, /MCP_PORT=8767/);
  assert.match(unitService, /INFLUENCER_INTELLIGENCE_RUNTIME_REGISTERED=true/);
  assert.match(unitMcp, /INFLUENCER_INTELLIGENCE_RUNTIME_REGISTERED=true/);
  assert.match(installer, /INFLUENCER_INTELLIGENCE_ENABLED=false/);
  assert.match(installer, /INFLUENCER_INTELLIGENCE_TOKEN_VAULT_BASE_URL=/);
  assert.match(installer, /INFLUENCER_INTELLIGENCE_TOKEN_VAULT_CREDENTIAL_REF=/);
  assert.match(installer, /TOKEN_VAULT_ANALYTICS_API_TOKEN=/);
  assert.match(tokenVaultWrangler, /TOKEN_VAULT_ANALYTICS_API_TOKEN/);
  assert.match(tokenVaultWrangler, /INFLUENCER_INTELLIGENCE_ANALYTICS_MODE = "off"/);
  assert.match(installer, /units remain disabled/);
  assert.doesNotMatch(installer, /systemctl enable influencer-intelligence/);
  assert.doesNotMatch(unitService, /INFLUENCER_INTELLIGENCE_SERVICE_TOKEN=[^\n]+/);
  assert.doesNotMatch(unitMcp, /INFLUENCER_INTELLIGENCE_MCP_BEARER_TOKEN=[^\n]+/);
});

test('registers signed CRM grant, private Orb auth, and inactive workflow source', () => {
  assert.match(crmProxy, /x-crm-signature-version', '2'/);
  assert.match(crmProxy, /x-crm-grant/);
  const parsed = JSON.parse(workflow);
  assert.equal(parsed.active, false);
  assert.equal(parsed.meta.runtime_registered, true);
  const dispatch = parsed.nodes.find((node) => node.name === '06_Dispatch_And_Register_Snapshot');
  assert.equal(dispatch.parameters.sendHeaders, true);
  assert.match(JSON.stringify(dispatch.parameters.headerParameters), /INFLUENCER_INTELLIGENCE_SERVICE_TOKEN/);
  assert.match(JSON.stringify(dispatch.parameters.headerParameters), /orb-scheduler/);
  assert.equal(parsed.meta.instagram_write, false);
  assert.equal(parsed.meta.publish_allowed, false);
});

test('feature flag off short-circuits before auth or database access', async () => {
  let called = false;
  const handler = createInfluencerIntelligenceServiceHandler({
    config: { enabled: false, crmHmacKey: key },
    readService: { searchCreators: async () => { called = true; return envelope(); } },
    audit: async () => {},
    clock,
  });
  const response = await handler.handle(new Request(`http://127.0.0.1${INTERNAL_SERVICE_PATH}/creators`));
  assert.equal(response.status, 404);
  assert.equal(called, false);
});

test('unregistered entrypoint reports health without exposing an enabled surface', async () => {
  const handler = createInfluencerIntelligenceServiceHandler({ config: { enabled: true, registered: false, crmHmacKey: key }, audit: async () => {}, clock });
  const response = await handler.handle(new Request(`http://127.0.0.1${INTERNAL_SERVICE_PATH}/health`));
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    ok: true,
    registered: false,
    enabled: false,
    flag: 'INFLUENCER_INTELLIGENCE_ENABLED',
    grant: INFLUENCER_INTELLIGENCE_GRANT,
    runtime_version: 'influencer-intelligence/runtime-registration/v1',
  });
});

test('CRM request reaches only the allowlisted internal read service with grant-bound signature', async () => {
  const audits = [];
  let input;
  const handler = createInfluencerIntelligenceServiceHandler({
    config: { enabled: true, crmHmacKey: key },
    readService: { searchCreators: async (value) => { input = value; return envelope({ items: [] }); } },
    audit: async (event) => audits.push(event),
    clock,
  });
  const response = await handler.handle(crmRequest(`${INTERNAL_SERVICE_PATH}/creators?query=synthetic&limit=10`));
  assert.equal(response.status, 200);
  assert.deepEqual(input, { query: 'synthetic', page: 1, page_size: 10 });
  assert.equal(audits.length, 1);
  assert.equal(audits[0].grant, true);
  assert.equal(audits[0].caller, 'crm');
});

test('creator snapshot history stays a read route and does not enter the Orb batch path', async () => {
  let input;
  let batchCalled = false;
  const handler = createInfluencerIntelligenceServiceHandler({
    config: { enabled: true, crmHmacKey: key },
    readService: { getCreatorSnapshots: async (value) => { input = value; return envelope({ items: [] }); } },
    snapshotOperations: async () => { batchCalled = true; return envelope(); },
    audit: async () => {},
    clock,
  });
  const response = await handler.handle(crmRequest(`${INTERNAL_SERVICE_PATH}/creators/creator%3Aone/snapshots?page=2&page_size=10`));
  assert.equal(response.status, 200);
  assert.deepEqual(input, { creator_key: 'creator:one', page: 2, page_size: 10 });
  assert.equal(batchCalled, false);
});

test('CRM dashboard projection is isolated from the MCP analytics route', async () => {
  let input;
  const handler = createInfluencerIntelligenceServiceHandler({
    config: { enabled: true, crmHmacKey: key },
    readService: { getCreatorDashboard: async (value) => { input = value; return envelope({ creator: { creatorKey: 'creator:one' }, profile: {}, history: [], media: [], analysis: {}, score: {}, coverage: {}, provenance: [] }); } },
    audit: async () => {},
    clock,
  });
  const response = await handler.handle(crmRequest(`${INTERNAL_SERVICE_PATH}/creators/creator%3Aone/dashboard`));
  assert.equal(response.status, 200);
  assert.deepEqual(input, { creator_key: 'creator:one' });
});

test('service envelope owns protocol metadata and snapshot input rejects invalid canonical handles', async () => {
  const handler = createInfluencerIntelligenceServiceHandler({
    config: { enabled: true, crmHmacKey: key },
    readService: { searchCreators: async () => ({ ...envelope({ items: [] }), contract_version: 'attacker', request_id: 'attacker', generated_at: 'attacker' }) },
    audit: async () => {},
    clock,
  });
  const response = await handler.handle(crmRequest(`${INTERNAL_SERVICE_PATH}/creators`));
  const body = await response.json();
  assert.equal(body.contract_version, 'influencer-intelligence/api/v1');
  assert.equal(body.request_id, 'runtime-test');
  assert.equal(body.generated_at, new Date(clock()).toISOString());

  const snapshotBody = { contract_version: 'influencer-intelligence/scheduler/v1', workflow_version: 'influencer-intelligence-snapshot-workflow/v1', mode: 'shadow', max_creators: 1, max_concurrency: 1, timeout_ms: 30_000, retry_policy: { max_attempts: 2, same_idempotency_key: true, retryable_classes: ['timeout'] }, service_path: `${INTERNAL_SERVICE_PATH}/snapshots`, creators: [{ creator_key: 'creator:one', identity_key: 'one', canonical_handle: 'bad handle', provider: 'meta-graph', operations: ['snapshot_creator', 'snapshot_creator_media'], bucket_seconds: 3600, media_limit: 10 }] };
  assert.throws(() => serviceTesting.parseSnapshotRequest(snapshotBody), /INVALID_INPUT/);
});

test('snapshot route accepts only Orb shadow contract and fails closed without a snapshot operation', async () => {
  const audits = [];
  const handler = createInfluencerIntelligenceServiceHandler({
    config: { enabled: true, serviceToken: 'synthetic-service-token' },
    audit: async (event) => audits.push(event),
    clock,
  });
  const headers = new Headers({
    'x-influencer-intelligence-service-token': 'synthetic-service-token',
    'x-influencer-intelligence-grant': INFLUENCER_INTELLIGENCE_GRANT,
    'x-influencer-intelligence-caller': 'orb-scheduler',
  });
  const body = { contract_version: 'influencer-intelligence/scheduler/v1', workflow_version: 'influencer-intelligence-snapshot-workflow/v1', mode: 'shadow', max_creators: 1, max_concurrency: 1, timeout_ms: 30_000, retry_policy: { max_attempts: 2, same_idempotency_key: true, retryable_classes: ['timeout'] }, service_path: `${INTERNAL_SERVICE_PATH}/snapshots`, creators: [] };
  assert.doesNotThrow(() => serviceTesting.parseSnapshotRequest(body));
  assert.deepEqual(await serviceTesting.readJson(new Request('http://127.0.0.1/test', { method: 'POST', body: JSON.stringify(body) })), body);
  const response = await handler.handle(new Request(`http://127.0.0.1${INTERNAL_SERVICE_PATH}/snapshots`, { method: 'POST', headers, body: JSON.stringify(body) }));
  assert.equal(response.status, 503, `${await response.text()} audit=${JSON.stringify(audits)}`);
  const invalid = { ...body, mode: 'active' };
  const invalidResponse = await handler.handle(new Request(`http://127.0.0.1${INTERNAL_SERVICE_PATH}/snapshots`, { method: 'POST', headers, body: JSON.stringify(invalid) }));
  assert.equal(invalidResponse.status, 400);
});
