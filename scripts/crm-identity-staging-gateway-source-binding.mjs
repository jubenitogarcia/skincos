import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const SHA = /^[0-9a-f]{40}$/;
const DIGEST = /^sha256:[0-9a-f]{64}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const RUN = /^[1-9][0-9]{0,19}$/;
const fail = (code) => { throw new Error(code); };
const canonicalTime = (value) => typeof value === 'string' && Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value;
const PIN_KEYS = ['workflowSourceSha', 'gatewaySourceSha', 'apiTreeSha', 'sharedTreeSha',
  'coreReleaseSha', 'coreArtifactDigest', 'gatewayVersionId', 'issuerVersionId', 'runId', 'runAttempt'];
const extended = (env) => env.OPERATION === 'session-smoke' && env.CRM_IDENTITY_SMOKE_PROFILE === 'session-and-projections';

/** Only the extended read-only smoke may name an older, equivalent gateway. */
export function resolveCrmSmokeGatewaySource(env = process.env) {
  const override = env.EXPECTED_GATEWAY_SOURCE_SHA;
  if (override !== undefined && override !== '') {
    if (!extended(env) || typeof override !== 'string' || !SHA.test(override)) fail('CRM_GATEWAY_SOURCE_OVERRIDE_INVALID');
    return override;
  }
  return env.RELEASE_SHA;
}

function validPins(value) {
  if (!value || !['workflowSourceSha', 'gatewaySourceSha', 'apiTreeSha', 'sharedTreeSha', 'coreReleaseSha'].every((key) => typeof value[key] === 'string' && SHA.test(value[key]))
    || typeof value.coreArtifactDigest !== 'string' || !DIGEST.test(value.coreArtifactDigest)
    || !['gatewayVersionId', 'issuerVersionId'].every((key) => typeof value[key] === 'string' && UUID.test(value[key]))
    || typeof value.runId !== 'string' || !RUN.test(value.runId)
    || value.runAttempt !== '1') fail('CRM_GATEWAY_SOURCE_PINS_INVALID');
}

/** Consumers must also bind these pins to the original artifact and successful GitHub run. */
export function validateCrmGatewaySourceBindingReport(value, expected) {
  validPins(expected);
  const keys = ['schemaVersion', 'contractVersion', 'environment', 'operation', 'smokeProfile', 'result', 'at',
    'canonicalAncestorVerified', 'runtimeTreesEqual', 'credentialMaterialIncluded', 'piiIncluded', ...PIN_KEYS];
  if (!value || Array.isArray(value) || Object.keys(value).length !== keys.length || keys.some((key) => !Object.hasOwn(value, key))
    || PIN_KEYS.some((key) => value[key] !== expected[key]) || value.schemaVersion !== 1
    || value.contractVersion !== 'crm-gateway/source-binding/v1' || value.environment !== 'staging'
    || value.operation !== 'session-smoke' || value.smokeProfile !== 'session-and-projections' || value.result !== 'verified'
    || value.canonicalAncestorVerified !== true || value.runtimeTreesEqual !== true
    || value.credentialMaterialIncluded !== false || value.piiIncluded !== false || !canonicalTime(value.at)
    || (expected.notBefore !== undefined && (!canonicalTime(expected.notBefore) || Date.parse(value.at) < Date.parse(expected.notBefore)))) {
    fail('CRM_GATEWAY_SOURCE_REPORT_INVALID');
  }
  return value;
}

/** Git reads/fetch only. Entire API and shared trees include config, lockfiles and every transitive runtime import. */
export function observeCrmGatewaySourceBinding({ env = process.env, cwd = process.cwd(), now = () => new Date().toISOString() } = {}) {
  const gatewaySourceSha = resolveCrmSmokeGatewaySource(env);
  if (!extended(env) || env.GITHUB_ACTIONS !== 'true' || env.GITHUB_EVENT_NAME !== 'workflow_dispatch'
    || env.GITHUB_REPOSITORY !== 'jubenitogarcia/skincos' || env.GITHUB_REF !== 'refs/heads/main'
    || env.GITHUB_RUN_ATTEMPT !== '1' || !SHA.test(env.RELEASE_SHA || '') || env.GITHUB_SHA !== env.RELEASE_SHA
    || !SHA.test(gatewaySourceSha || '')) fail('CRM_GATEWAY_SOURCE_RUNNER_REQUIRED');
  // Resolve the explicit checkout, not an inherited shell's alternate Git tree.
  const gitEnv = { ...process.env };
  for (const key of ['GIT_DIR', 'GIT_WORK_TREE', 'GIT_COMMON_DIR', 'GIT_INDEX_FILE', 'GIT_OBJECT_DIRECTORY', 'GIT_ALTERNATE_OBJECT_DIRECTORIES', 'GIT_NAMESPACE', 'GIT_PREFIX']) delete gitEnv[key];
  const git = (...args) => {
    try { return execFileSync('git', args, { cwd, env: gitEnv, encoding: 'utf8', timeout: 30_000, maxBuffer: 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] }).trim(); }
    catch { fail('CRM_GATEWAY_SOURCE_GIT_CHECK_FAILED'); }
  };
  git('fetch', '--no-tags', 'origin', 'main:refs/remotes/origin/main');
  if (git('rev-parse', 'HEAD') !== env.RELEASE_SHA || git('rev-parse', 'refs/remotes/origin/main') !== env.RELEASE_SHA
    || git('status', '--porcelain', '--untracked-files=all', '--', 'api', 'shared') !== '') fail('CRM_GATEWAY_SOURCE_CANONICAL_DRIFT');
  git('merge-base', '--is-ancestor', gatewaySourceSha, env.RELEASE_SHA);
  const trees = Object.fromEntries(['api', 'shared'].map((name) => {
    const current = git('rev-parse', `${env.RELEASE_SHA}:${name}`);
    if (git('cat-file', '-t', current) !== 'tree' || current !== git('rev-parse', `${gatewaySourceSha}:${name}`)) fail('CRM_GATEWAY_SOURCE_RUNTIME_DRIFT');
    return [`${name}TreeSha`, current];
  }));
  const report = {
    schemaVersion: 1, contractVersion: 'crm-gateway/source-binding/v1', environment: 'staging',
    operation: 'session-smoke', smokeProfile: 'session-and-projections', result: 'verified', at: now(),
    workflowSourceSha: env.RELEASE_SHA, gatewaySourceSha, ...trees,
    coreReleaseSha: env.CRM_CORE_RELEASE_SHA, coreArtifactDigest: env.CRM_CORE_ARTIFACT_DIGEST,
    gatewayVersionId: env.EXPECTED_API_VERSION_ID, issuerVersionId: env.EXPECTED_ISSUER_VERSION_ID,
    runId: env.GITHUB_RUN_ID, runAttempt: env.GITHUB_RUN_ATTEMPT,
    canonicalAncestorVerified: true, runtimeTreesEqual: true, credentialMaterialIncluded: false, piiIncluded: false,
  };
  return validateCrmGatewaySourceBindingReport(report, report);
}

const reportPath = (env) => {
  if (!env.RUNNER_TEMP) fail('CRM_GATEWAY_SOURCE_RUNNER_REQUIRED');
  return path.join(env.RUNNER_TEMP, 'crm-gateway-source-binding-report.json');
};

/** Recheck source custody immediately before both active runtime readbacks; never rewrite the initial proof. */
export function revalidateCrmGatewaySourceBinding(options = {}) {
  const env = options.env || process.env;
  const expected = observeCrmGatewaySourceBinding(options);
  const file = reportPath(env);
  let report;
  try {
    if (fs.statSync(file).size > 16_384) fail('CRM_GATEWAY_SOURCE_REPORT_INVALID');
    report = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch { fail('CRM_GATEWAY_SOURCE_REPORT_INVALID'); }
  return validateCrmGatewaySourceBindingReport(report, expected);
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    if (process.argv.length !== 3 || !['--validate-input', '--prove'].includes(process.argv[2])) fail('CRM_GATEWAY_SOURCE_OPERATION_INVALID');
    if (process.argv[2] === '--validate-input') resolveCrmSmokeGatewaySource();
    else {
      const report = observeCrmGatewaySourceBinding();
      fs.writeFileSync(reportPath(process.env), `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600, flag: 'wx' });
    }
    process.stdout.write('Gateway source binding check passed.\n');
  } catch (error) {
    const code = /^CRM_GATEWAY_SOURCE_[A-Z0-9_]+$/.test(error?.message || '') ? error.message : 'CRM_GATEWAY_SOURCE_FAILED';
    process.stderr.write(`${code}\n`); process.exitCode = 1;
  }
}
