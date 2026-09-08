import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { attestCrmActiveGateway, gatewayBindingIdentity, refreshCrmStagingGateway } from '../crm-identity-staging-gateway-refresh.mjs';

const id = (n) => `${String(n).padStart(8, '0')}-0000-4000-8000-000000000000`;
const sha = 'a'.repeat(40); const oldSha = 'b'.repeat(40);
const API = 'skincos-api-staging'; const ISSUER = 'skincos-identity-crm-delivery-staging';
const text = (name, value) => ({ name, type: 'plain_text', text: value });
function apiVersion(versionId = id(1), sourceSha = oldSha) {
  return { id: versionId, annotations: { 'workers/message': `crm:gateway:${sourceSha}:123` }, resources: {
    script: { compatibility_date: '2024-11-20', compatibility_flags: [] },
    bindings: [text('APP_VERSION', sourceSha), text('ENVIRONMENT', 'staging'),
      text('CRM_IDENTITY_ISSUER_CALLER_ENABLED', 'true'), text('CRM_IDENTITY_ISSUER_CALLER_ID', 'crm-api-staging-v1'),
      text('TIMEKEEPING_VERSION_ID', id(8)), text('SIBLING_MODULE_CONFIG', 'retained-private-config'),
      ...Object.entries({ CRM_CORE: 'skincos-crm-core-staging', IDENTITY_CRM_ISSUER: ISSUER, INVENTORY: 'skincos-insumos-staging',
        INVENTORY_LEGACY_JOBS: 'skincos-insumos-staging', TIMEKEEPING: 'skincos-timekeeping-staging', FINANCE: 'skincos-finance-staging',
      }).map(([name, service]) => ({ name, type: 'service', service, ...(name === 'INVENTORY_LEGACY_JOBS' ? { entrypoint: 'InventoryLegacyJobsEntrypoint' } : {}) })),
      { name: 'CRM_IDENTITY_ISSUER_CALLER_HMAC', type: 'secret_text' },
      { name: 'DB', type: 'd1', id: '4bdd7995-ad69-465a-917c-0aab22db5c4e' },
      { name: 'BACKUP_BUCKET', type: 'r2_bucket', bucket_name: 'skincos-backups-staging' },
      { name: 'RATE_LIMITER', type: 'durable_object_namespace', class_name: 'RateLimiter', namespace_id: 'unchanged-namespace' },
      { name: 'CF_VERSION_METADATA', type: 'version_metadata' },
    ],
  } };
}
function fixture() {
  const versions = new Map([[id(1), apiVersion()], [id(3), apiVersion(id(3), sha)]]);
  const issuer = { id: id(2), resources: { bindings: [
    text('IDENTITY_CRM_DELIVERY_ENVIRONMENT', 'staging'), text('IDENTITY_CRM_DELIVERY_ENABLED', 'true'),
    text('IDENTITY_CRM_DELIVERY_CALLER_ENABLED', 'true'), text('IDENTITY_CRM_DELIVERY_CALLER_ID', 'crm-api-staging-v1'),
    ...['CALLER_HMAC', 'REQUEST_HMAC', 'KID', 'PRIVATE_JWK', 'PUBLIC_JWK'].map((name) => ({ name: `IDENTITY_CRM_DELIVERY_${name}`, type: 'secret_text' })),
  ] } };
  const deployment = (versionId, deploymentId) => ({ id: deploymentId, strategy: 'percentage', versions: [{ version_id: versionId, percentage: 100 }] });
  const state = { api: deployment(id(1), id(10)), issuer: deployment(id(2), id(20)), operations: [], reports: [] };
  const io = {
    snapshot: async (script) => script === API ? { deployment: structuredClone(state.api), version: structuredClone(versions.get(state.api.versions[0].version_id)) }
      : { deployment: structuredClone(state.issuer), version: structuredClone(issuer) },
    version: async (script, versionId) => { assert.equal(script, API); return structuredClone(versions.get(versionId)); },
    guard: async () => { state.operations.push('guard'); },
    ready: async () => { state.operations.push('ready'); },
    upload: async (options) => { assert.deepEqual(options, { sourceSha: sha, timekeepingVersionId: id(8) }); state.operations.push('upload'); return id(3); },
    deploy: async (versionId) => { state.operations.push(`deploy:${versionId}`); state.api = deployment(versionId, id(state.api.id === id(10) ? 30 : 40)); return structuredClone(state.api); },
    probe: async () => { state.operations.push('probe'); },
  };
  const args = { sourceSha: sha, coreReleaseSha: 'c'.repeat(40), coreArtifactDigest: `sha256:${'d'.repeat(64)}`,
    expectedApiVersionId: id(1), expectedIssuerVersionId: id(2), runId: '123', io,
    onReport: (report) => state.reports.push(structuredClone(report)),
  };
  return { args, io, state, versions, issuer };
}

test('refresh uploads at zero traffic, preserves complete typed bindings, then switches only API', async () => {
  const f = fixture(); const result = await refreshCrmStagingGateway(f.args);
  assert.equal(result.state, 'verified'); assert.equal(result.deploymentId, id(30));
  assert.equal(result.issuer.versionId, id(2)); assert.equal(result.timekeepingVersionId, id(8));
  assert.deepEqual(f.state.operations, ['ready', 'guard', 'upload', 'ready', 'guard', `deploy:${id(3)}`, 'probe']);
  assert.doesNotMatch(JSON.stringify(result), /retained-private-config|PRIVATE_JWK|CALLER_HMAC/);
  assert.equal(result.issuerWritten, false); assert.equal(result.secretsWritten, false); assert.equal(result.d1Written, false);
});

test('candidate binding or compatibility drift never receives traffic', async (t) => {
  for (const [label, mutate] of [
    ['caller disabled', (v) => v.resources.bindings.find((b) => b.name === 'CRM_IDENTITY_ISSUER_CALLER_ENABLED').text = 'false'],
    ['sibling var', (v) => v.resources.bindings.find((b) => b.name === 'SIBLING_MODULE_CONFIG').text = 'drift'],
    ['missing secret', (v) => v.resources.bindings = v.resources.bindings.filter((b) => b.type !== 'secret_text')],
    ['namespace', (v) => v.resources.bindings.find((b) => b.name === 'RATE_LIMITER').namespace_id = 'different'],
    ['Timekeeping', (v) => v.resources.bindings.find((b) => b.name === 'TIMEKEEPING_VERSION_ID').text = id(9)],
    ['compatibility', (v) => v.resources.script.compatibility_date = '2026-09-08'],
    ['version source', (v) => v.resources.bindings.find((b) => b.name === 'APP_VERSION').text = oldSha],
  ]) await t.test(label, async () => {
    const f = fixture(); mutate(f.versions.get(id(3)));
    await assert.rejects(refreshCrmStagingGateway(f.args), /CRM_GATEWAY_REFRESH_/);
    assert.equal(f.state.operations.some((entry) => entry.startsWith('deploy:')), false);
    assert.equal(f.state.api.id, id(10));
  });
});

test('stale expected versions, disabled callers or missing affinity fail before any upload', async (t) => {
  for (const [label, mutate] of [
    ['stale API', (f) => f.args.expectedApiVersionId = id(9)],
    ['stale issuer', (f) => f.args.expectedIssuerVersionId = id(9)],
    ['API caller disabled', (f) => f.versions.get(id(1)).resources.bindings.find((b) => b.name === 'CRM_IDENTITY_ISSUER_CALLER_ENABLED').text = 'false'],
    ['issuer disabled', (f) => f.issuer.resources.bindings.find((b) => b.name === 'IDENTITY_CRM_DELIVERY_CALLER_ENABLED').text = 'false'],
    ['missing affinity', (f) => f.versions.get(id(1)).resources.bindings = f.versions.get(id(1)).resources.bindings.filter((b) => b.name !== 'TIMEKEEPING_VERSION_ID')],
  ]) await t.test(label, async () => {
    const f = fixture(); mutate(f);
    await assert.rejects(refreshCrmStagingGateway(f.args), /CRM_GATEWAY_REFRESH_/);
    assert.equal(f.state.operations.includes('upload'), false);
  });
});

test('failed public probe restores only the exact owned API deployment to its incumbent', async () => {
  const f = fixture(); f.io.probe = async () => { throw new Error('private response detail'); };
  await assert.rejects(refreshCrmStagingGateway(f.args), /CRM_GATEWAY_REFRESH_FAILED/);
  assert.equal(f.state.api.versions[0].version_id, id(1)); assert.equal(f.state.issuer.id, id(20));
  assert.deepEqual(f.state.operations.filter((entry) => entry.startsWith('deploy:')), [`deploy:${id(3)}`, `deploy:${id(1)}`]);
  assert.equal(f.state.reports.at(-1).rollback, 'verified-api-incumbent-restored');
  assert.doesNotMatch(JSON.stringify(f.state.reports), /private response detail/);
});

test('a different deployment using even the same candidate is never rolled back', async () => {
  const f = fixture(); f.io.probe = async () => { f.state.api.id = id(99); throw new Error('failed'); };
  await assert.rejects(refreshCrmStagingGateway(f.args));
  assert.equal(f.state.api.id, id(99));
  assert.equal(f.state.operations.filter((entry) => entry.startsWith('deploy:')).length, 1);
  assert.equal(f.state.reports.at(-1).rollbackFailure, 'CRM_GATEWAY_REFRESH_OWNERSHIP_CONFLICT');
});

test('a source-only main advance after switching does not block fenced exact-deployment rollback', async () => {
  const f = fixture(); const phases = []; let mainAdvanced = false;
  f.io.guard = async (phase) => {
    phases.push(phase);
    if (phase !== 'rollback' && mainAdvanced) throw new Error('CRM_GATEWAY_REFRESH_SOURCE_DRIFT');
  };
  f.io.probe = async () => { mainAdvanced = true; throw new Error('CRM_GATEWAY_REFRESH_PROBE_FAILED'); };
  await assert.rejects(refreshCrmStagingGateway(f.args));
  assert.deepEqual(phases, ['upload', 'switch', 'rollback']);
  assert.equal(f.state.reports.at(-1).rollback, 'verified-api-incumbent-restored');
});

test('issuer deployment drift after switching cannot grant rollback or a verified custody claim', async () => {
  const f = fixture(); f.io.probe = async () => { f.state.issuer.id = id(99); throw new Error('failed'); };
  await assert.rejects(refreshCrmStagingGateway(f.args));
  assert.equal(f.state.operations.filter((entry) => entry.startsWith('deploy:')).length, 1);
  assert.equal(f.state.reports.at(-1).rollback, 'not-proven');
  assert.equal(f.state.reports.at(-1).rollbackFailure, 'CRM_GATEWAY_REFRESH_OWNERSHIP_CONFLICT');
});

test('uncertain switch response is not retried and grants no rollback authority', async () => {
  const f = fixture(); let attempts = 0;
  f.io.deploy = async () => { attempts += 1; throw new Error('network detail'); };
  await assert.rejects(refreshCrmStagingGateway(f.args));
  assert.equal(attempts, 1); assert.equal(f.state.reports.at(-1).rollback, 'forbidden-outcome-unknown');
});

test('lease refusal and intervening deployment prevent subsequent mutations', async () => {
  const f = fixture(); f.io.guard = async () => { throw new Error('no lease'); };
  await assert.rejects(refreshCrmStagingGateway(f.args)); assert.equal(f.state.operations.includes('upload'), false);
  const drift = fixture(); const upload = drift.io.upload;
  drift.io.upload = async (options) => { const result = await upload(options); drift.state.api.id = id(88); return result; };
  await assert.rejects(refreshCrmStagingGateway(drift.args), /OWNERSHIP_CONFLICT/);
  assert.equal(drift.state.operations.some((entry) => entry.startsWith('deploy:')), false);
});

test('active smoke attestation is read-only and requires exact source and both active callers', async () => {
  const f = fixture(); f.versions.get(id(1)).resources.bindings.find((b) => b.name === 'APP_VERSION').text = sha;
  const result = await attestCrmActiveGateway(f.args);
  assert.equal(result.state, 'active-attested'); assert.deepEqual(f.state.operations, []);
  f.args.sourceSha = oldSha;
  await assert.rejects(attestCrmActiveGateway(f.args), /SOURCE_INVALID/);
});

test('binding fingerprint is order-independent and never contains variable or secret values', () => {
  const first = apiVersion(); const second = structuredClone(first); second.resources.bindings.reverse();
  assert.deepEqual(gatewayBindingIdentity(first), gatewayBindingIdentity(second));
  second.resources.bindings.push({ name: 'NEW_UNKNOWN', type: 'arbitrary' });
  assert.throws(() => gatewayBindingIdentity(second), /BINDINGS_INVALID/);
});

test('workflow keeps original session delta and separates refresh, extended smoke and disabled bootstrap', () => {
  const workflow = fs.readFileSync(new URL('../../.github/workflows/identity-crm-delivery.yml', import.meta.url), 'utf8');
  const source = fs.readFileSync(new URL('../crm-identity-staging-gateway-refresh.mjs', import.meta.url), 'utf8');
  assert.match(workflow, /options: \[session, session-and-projections\]/);
  assert.match(workflow, /default: session/);
  assert.match(workflow, /refresh-crm-gateway-staging/);
  assert.match(workflow, /crm-identity-staging-gateway-refresh\.mjs --attest-active/);
  assert.match(source, /CRM_IDENTITY_ISSUER_CALLER_ENABLED:true/);
  assert.match(source, /CRM_IDENTITY_ISSUER_CALLER_ID:crm-api-staging-v1/);
  assert.doesNotMatch(source, /'secret',\s*'(?:put|delete|bulk)'|'d1',\s*'(?:execute|migrations)'/);
  assert.match(workflow, /node scripts\/crm-identity-staging-caller-runtime-readback\.mjs/);
});
