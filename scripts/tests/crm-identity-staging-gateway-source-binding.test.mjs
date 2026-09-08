import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { observeCrmGatewaySourceBinding, revalidateCrmGatewaySourceBinding,
  resolveCrmSmokeGatewaySource, validateCrmGatewaySourceBindingReport } from '../crm-identity-staging-gateway-source-binding.mjs';

const at = '2026-09-08T17:00:00.000Z';
function fixture(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'crm-source-binding-test-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const cwd = path.join(directory, 'checkout'); const remote = path.join(directory, 'origin.git');
  fs.mkdirSync(cwd);
  const gitEnv = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('GIT_')));
  const git = (...args) => execFileSync('git', args, { cwd, env: gitEnv, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  git('init', '--bare', remote); git('init', '-b', 'main');
  git('config', 'user.name', 'Synthetic source binding test'); git('config', 'user.email', 'test@example.invalid');
  const write = (name, value) => {
    const file = path.join(cwd, name); fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, value);
  };
  write('api/workers/index.js', 'export default {};\n'); write('api/wrangler.toml', 'main = "workers/index.js"\n');
  write('api/package-lock.json', '{}\n'); write('shared/identity-contract/index.js', 'export const contract = 1;\n');
  const commit = (name) => { git('add', '.'); git('commit', '-m', name); return git('rev-parse', 'HEAD'); };
  const gatewaySourceSha = commit('runtime'); write('notes.txt', 'workflow-only update\n');
  const workflowSourceSha = commit('workflow'); git('remote', 'add', 'origin', remote); git('push', 'origin', 'main');
  const env = {
    OPERATION: 'session-smoke', CRM_IDENTITY_SMOKE_PROFILE: 'session-and-projections', EXPECTED_GATEWAY_SOURCE_SHA: gatewaySourceSha,
    GITHUB_ACTIONS: 'true', GITHUB_EVENT_NAME: 'workflow_dispatch', GITHUB_REPOSITORY: 'jubenitogarcia/skincos', GITHUB_REF: 'refs/heads/main',
    GITHUB_RUN_ATTEMPT: '1', GITHUB_RUN_ID: '34250000000', GITHUB_SHA: workflowSourceSha, RELEASE_SHA: workflowSourceSha,
    CRM_CORE_RELEASE_SHA: 'c'.repeat(40), CRM_CORE_ARTIFACT_DIGEST: `sha256:${'d'.repeat(64)}`,
    EXPECTED_API_VERSION_ID: '11111111-1111-4111-8111-111111111111', EXPECTED_ISSUER_VERSION_ID: '22222222-2222-4222-8222-222222222222',
    RUNNER_TEMP: directory,
  };
  return { directory, cwd, env, git, write, commit, options: { env, cwd, now: () => at } };
}

test('only extended session smoke accepts an explicit runtime source; original defaults and workflow authority remain unchanged', () => {
  const release = 'a'.repeat(40); const runtime = 'b'.repeat(40);
  for (const operation of ['test', 'bootstrap', 'activate', 'refresh-gateway', 'disable', 'session-smoke']) {
    const env = { OPERATION: operation, CRM_IDENTITY_SMOKE_PROFILE: 'session', RELEASE_SHA: release };
    assert.equal(resolveCrmSmokeGatewaySource(env), release);
    assert.throws(() => resolveCrmSmokeGatewaySource({ ...env, EXPECTED_GATEWAY_SOURCE_SHA: runtime }), /OVERRIDE_INVALID/);
  }
  const env = { OPERATION: 'session-smoke', CRM_IDENTITY_SMOKE_PROFILE: 'session-and-projections', RELEASE_SHA: release, GITHUB_SHA: release };
  assert.equal(resolveCrmSmokeGatewaySource(env), release);
  assert.equal(resolveCrmSmokeGatewaySource({ ...env, EXPECTED_GATEWAY_SOURCE_SHA: runtime }), runtime);
  assert.deepEqual(env, { OPERATION: 'session-smoke', CRM_IDENTITY_SMOKE_PROFILE: 'session-and-projections', RELEASE_SHA: release, GITHUB_SHA: release });
  for (const invalid of ['main', `${runtime}\n`, runtime.toUpperCase(), [runtime], null]) {
    assert.throws(() => resolveCrmSmokeGatewaySource({ ...env, EXPECTED_GATEWAY_SOURCE_SHA: invalid }), /OVERRIDE_INVALID/);
  }
});

test('actual Git canonical ancestor with identical full runtime trees yields a sanitised companion and survives revalidation', (t) => {
  const f = fixture(t); const report = observeCrmGatewaySourceBinding(f.options);
  assert.notEqual(report.workflowSourceSha, report.gatewaySourceSha);
  assert.equal(report.apiTreeSha, f.git('rev-parse', `${report.gatewaySourceSha}:api`));
  assert.equal(report.sharedTreeSha, f.git('rev-parse', `${report.gatewaySourceSha}:shared`));
  assert.equal(report.runId, f.env.GITHUB_RUN_ID); assert.equal(report.runAttempt, '1');
  assert.equal(report.credentialMaterialIncluded, false); assert.equal(report.piiIncluded, false);
  const file = path.join(f.directory, 'crm-gateway-source-binding-report.json');
  fs.writeFileSync(file, JSON.stringify(report));
  assert.deepEqual(revalidateCrmGatewaySourceBinding(f.options), report);
  assert.doesNotMatch(fs.readFileSync(file, 'utf8'), /example.invalid|checkout|origin.git|cookie|Bearer|password/);
});

test('runtime source default equal to workflow source still requires the exact canonical trees', (t) => {
  const f = fixture(t); delete f.env.EXPECTED_GATEWAY_SOURCE_SHA;
  const report = observeCrmGatewaySourceBinding(f.options);
  assert.equal(report.gatewaySourceSha, report.workflowSourceSha);
});

test('any API code, config, dependency lock, or shared contract change refuses source equivalence', async (t) => {
  for (const file of ['api/workers/index.js', 'api/wrangler.toml', 'api/package-lock.json', 'shared/identity-contract/index.js']) {
    await t.test(file, (subtest) => {
      const f = fixture(subtest); f.write(file, 'runtime drift\n');
      f.env.RELEASE_SHA = f.env.GITHUB_SHA = f.commit('runtime drift'); f.git('push', 'origin', 'main');
      assert.throws(() => observeCrmGatewaySourceBinding(f.options), /RUNTIME_DRIFT/);
    });
  }
});

test('identical trees on a foreign non-ancestor commit do not establish canonical runtime provenance', (t) => {
  const f = fixture(t); f.git('checkout', '--orphan', 'foreign');
  f.env.EXPECTED_GATEWAY_SOURCE_SHA = f.commit('unrelated runtime'); f.git('checkout', 'main');
  assert.throws(() => observeCrmGatewaySourceBinding(f.options), /GIT_CHECK_FAILED/);
});

test('local tracked or untracked runtime drift fails before attestation', async (t) => {
  for (const file of ['api/wrangler.toml', 'shared/untracked-runtime.js']) await t.test(file, (subtest) => {
    const f = fixture(subtest); f.write(file, 'local drift\n');
    assert.throws(() => observeCrmGatewaySourceBinding(f.options), /CANONICAL_DRIFT/);
  });
});

test('revalidation refuses later canonical main drift and never refreshes the initial proof', (t) => {
  const f = fixture(t); const report = observeCrmGatewaySourceBinding(f.options);
  const file = path.join(f.directory, 'crm-gateway-source-binding-report.json'); const original = JSON.stringify(report);
  fs.writeFileSync(file, original); f.write('notes.txt', 'new canonical workflow\n');
  f.commit('later canonical main'); f.git('push', 'origin', 'main'); f.git('checkout', '--detach', f.env.RELEASE_SHA);
  assert.throws(() => revalidateCrmGatewaySourceBinding(f.options), /CANONICAL_DRIFT/);
  assert.equal(fs.readFileSync(file, 'utf8'), original);
});

test('runner guards reject branch, attempt, checkout identity, repository, and non-smoke overrides', (t) => {
  const f = fixture(t);
  for (const change of [{ GITHUB_ACTIONS: 'false' }, { GITHUB_EVENT_NAME: 'pull_request' }, { GITHUB_REPOSITORY: 'foreign/repo' },
    { GITHUB_REF: 'refs/heads/feature' }, { GITHUB_RUN_ATTEMPT: '2' }, { GITHUB_SHA: 'f'.repeat(40) }, { OPERATION: 'refresh-gateway' }]) {
    assert.throws(() => observeCrmGatewaySourceBinding({ ...f.options, env: { ...f.env, ...change } }), /RUNNER_REQUIRED|OVERRIDE_INVALID/);
  }
});

test('strict companion parser rejects wrong pins, raw fields, noncanonical timestamps, run types and stale reports', (t) => {
  const f = fixture(t); const report = observeCrmGatewaySourceBinding(f.options);
  for (const change of [{ secret: 'must-not-be-in-proof' }, { runId: 34250000000 }, { runAttempt: 1 }, { gatewaySourceSha: report.workflowSourceSha },
    { apiTreeSha: 'e'.repeat(40) }, { runtimeTreesEqual: false }, { canonicalAncestorVerified: false }, { piiIncluded: true },
    { at: '2026-02-30T00:00:00.000Z' }, { at: '2026-09-08T17:00:00Z' }, { at: '2026-09-08T17:00:00.000+00:00' }]) {
    assert.throws(() => validateCrmGatewaySourceBindingReport({ ...report, ...change }, report), /REPORT_INVALID/);
  }
  for (const change of [{ workflowSourceSha: [report.workflowSourceSha] }, { runId: 34250000000 }, { runAttempt: '2' }, { coreReleaseSha: '' }]) {
    assert.throws(() => validateCrmGatewaySourceBindingReport(report, { ...report, ...change }), /PINS_INVALID/);
  }
  assert.throws(() => validateCrmGatewaySourceBindingReport(report, { ...report, notBefore: '2026-09-08T17:00:00.001Z' }), /REPORT_INVALID/);
  assert.throws(() => validateCrmGatewaySourceBindingReport(report, { ...report, notBefore: '2026-02-30T00:00:00.000Z' }), /REPORT_INVALID/);
});

test('missing, malformed, extra-field, wrong-run and oversized companion files fail closed', (t) => {
  const f = fixture(t); const report = observeCrmGatewaySourceBinding(f.options);
  const file = path.join(f.directory, 'crm-gateway-source-binding-report.json');
  assert.throws(() => revalidateCrmGatewaySourceBinding(f.options), /REPORT_INVALID/);
  for (const text of ['{', JSON.stringify({ ...report, raw: 'private' }), JSON.stringify({ ...report, runId: '123' }), ' '.repeat(16_385)]) {
    fs.writeFileSync(file, text); assert.throws(() => revalidateCrmGatewaySourceBinding(f.options), /REPORT_INVALID/);
  }
});

test('workflow orders source proof before external work and keeps leases and artifact suffixes bound to workflow source', () => {
  const workflow = fs.readFileSync(new URL('../../.github/workflows/identity-crm-delivery.yml', import.meta.url), 'utf8');
  const refresh = fs.readFileSync(new URL('../crm-identity-staging-gateway-refresh.mjs', import.meta.url), 'utf8');
  const projection = fs.readFileSync(new URL('../crm-identity-staging-projection-smoke.mjs', import.meta.url), 'utf8');
  const inputBlock = workflow.split('  workflow_dispatch:\n')[1]?.split('\npermissions:')[0]
    || workflow.split('  workflow_dispatch:\r\n')[1]?.split('\r\npermissions:')[0];
  assert.equal((inputBlock.match(/^      [a-z_]+:/gm) || []).length, 10);
  assert.ok(workflow.indexOf('Test the exact staging source before any external operation') < workflow.indexOf('Verify canonical gateway runtime source equivalence'));
  assert.ok(workflow.indexOf('Verify canonical gateway runtime source equivalence') < workflow.indexOf('Attest the externally published CRM Core'));
  assert.match(workflow, /node scripts\/crm-identity-staging-gateway-source-binding\.mjs --validate-input/);
  assert.match(workflow, /Reject a gateway runtime source override for the test operation/);
  assert.match(workflow, /name: crm-gateway-source-binding-\$\{\{ inputs.release_sha \}\}/);
  assert.match(workflow, /name: crm-identity-projection-smoke-\$\{\{ inputs.release_sha \}\}/);
  assert.doesNotMatch(workflow, /source_sha: \$\{\{ inputs.expected_gateway_source_sha/);
  assert.equal((workflow.match(/crm-identity-staging-gateway-refresh\.mjs --attest-active/g) || []).length, 2);
  assert.match(refresh, /env.GITHUB_SHA !== env.RELEASE_SHA/);
  assert.ok(refresh.indexOf('revalidateCrmGatewaySourceBinding({ env })') < refresh.indexOf('const result = await attestCrmActiveGateway'));
  assert.match(refresh, /refreshCrmStagingGateway\(\{ sourceSha: env.RELEASE_SHA/);
  assert.match(projection, /sourceSha: resolveCrmSmokeGatewaySource\(\)/);
  assert.match(projection, /value.schemaVersion !== 1/);
});
