import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { assertCrmSmokeCors, CRM_SMOKE_CONSOLE_ORIGINS } from './crm-identity-staging-projection-smoke.mjs';
import { resolveCrmSmokeGatewaySource, revalidateCrmGatewaySourceBinding } from './crm-identity-staging-gateway-source-binding.mjs';

const API = 'skincos-api-staging';
const ISSUER = 'skincos-identity-crm-delivery-staging';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const SHA = /^[0-9a-f]{40}$/;
const DIGEST = /^sha256:[0-9a-f]{64}$/;
const TYPES = new Set(['plain_text', 'secret_text', 'json', 'service', 'd1', 'r2_bucket', 'durable_object_namespace', 'version_metadata', 'kv_namespace']);
const fail = (code) => { throw new Error(code); };
const safeCode = (error) => /^CRM_GATEWAY_(?:REFRESH|SOURCE)_[A-Z0-9_]+$/.test(error?.message || '') ? error.message : 'CRM_GATEWAY_REFRESH_FAILED';
const stable = (value) => JSON.stringify(value, (_, item) => item && typeof item === 'object' && !Array.isArray(item)
  ? Object.fromEntries(Object.keys(item).sort().map((key) => [key, item[key]])) : item);
const digest = (value) => `sha256:${createHash('sha256').update(stable(value)).digest('hex')}`;

function bindingMap(version) {
  const bindings = version?.resources?.bindings;
  if (!UUID.test(version?.id || '') || !Array.isArray(bindings) || bindings.length > 100) fail('CRM_GATEWAY_REFRESH_BINDINGS_INVALID');
  const map = new Map();
  for (const binding of bindings) {
    if (!binding || !/^[A-Z][A-Z0-9_]{0,127}$/.test(binding.name || '') || !TYPES.has(binding.type)
      || map.has(binding.name)) fail('CRM_GATEWAY_REFRESH_BINDINGS_INVALID');
    if (binding.type === 'plain_text' && typeof binding.text !== 'string') fail('CRM_GATEWAY_REFRESH_BINDINGS_INVALID');
    if (binding.type === 'service' && typeof binding.service !== 'string') fail('CRM_GATEWAY_REFRESH_BINDINGS_INVALID');
    if (binding.type === 'd1' && !UUID.test(binding.id || '')) fail('CRM_GATEWAY_REFRESH_BINDINGS_INVALID');
    if (binding.type === 'r2_bucket' && typeof binding.bucket_name !== 'string') fail('CRM_GATEWAY_REFRESH_BINDINGS_INVALID');
    if (binding.type === 'durable_object_namespace' && (typeof binding.class_name !== 'string' || typeof binding.namespace_id !== 'string')) fail('CRM_GATEWAY_REFRESH_BINDINGS_INVALID');
    if (binding.type === 'kv_namespace' && !/^[0-9a-f]{32}$/.test(binding.namespace_id || '')) fail('CRM_GATEWAY_REFRESH_BINDINGS_INVALID');
    map.set(binding.name, binding);
  }
  return map;
}

function textBinding(bindings, name, expected) {
  const binding = bindings.get(name);
  if (binding?.type !== 'plain_text' || (expected !== undefined && binding.text !== expected)) fail('CRM_GATEWAY_REFRESH_CALLER_STATE_INVALID');
  return binding.text;
}

function runtimeIdentity(resources) {
  const object = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
  const strings = (value) => Array.isArray(value) && value.length <= 128
    && value.every((item) => typeof item === 'string' && item.length > 0 && item.length <= 256)
    && new Set(value).size === value.length;
  const json = (value, depth = 0) => depth <= 8 && (value === null || typeof value === 'boolean'
    || (typeof value === 'number' && Number.isFinite(value)) || (typeof value === 'string' && value.length <= 4096)
    || (Array.isArray(value) && value.length <= 128 && value.every((item) => json(item, depth + 1)))
    || (object(value) && Object.keys(value).length <= 128
      && Object.entries(value).every(([key, item]) => key.length <= 256 && json(item, depth + 1))));
  // Version Detail separates runtime settings from script content metadata.
  // Read the real script_runtime object; missing settings must never hash as
  // fabricated null/[] compatibility. Include every runtime field in the pin.
  const runtime = resources?.script_runtime;
  if (!object(runtime) || !json(runtime) || Buffer.byteLength(stable(runtime)) > 65_536
    || !/^\d{4}-\d{2}-\d{2}$/.test(runtime.compatibility_date || '')
    || !Number.isFinite(Date.parse(runtime.compatibility_date))
    || new Date(runtime.compatibility_date).toISOString() !== `${runtime.compatibility_date}T00:00:00.000Z`
    || ('compatibility_flags' in runtime && !strings(runtime.compatibility_flags))
    || ['usage_model', 'migration_tag'].some((key) => key in runtime
      && (typeof runtime[key] !== 'string' || !runtime[key].length || runtime[key].length > 256))
    || ['exports', 'limits'].some((key) => key in runtime && !object(runtime[key]))) fail('CRM_GATEWAY_REFRESH_RUNTIME_INVALID');
  const script = resources?.script;
  if (!object(script) || !strings(script.handlers) || !script.handlers.includes('fetch')
    || !Array.isArray(script.named_handlers) || script.named_handlers.length > 128) fail('CRM_GATEWAY_REFRESH_RUNTIME_INVALID');
  const names = new Set();
  const namedHandlers = script.named_handlers.map((entry) => {
    if (!object(entry) || Object.keys(entry).length !== 2 || !strings(entry.handlers)
      || typeof entry.name !== 'string' || !entry.name.length || entry.name.length > 256
      || names.has(entry.name)) fail('CRM_GATEWAY_REFRESH_RUNTIME_INVALID');
    names.add(entry.name);
    return { name: entry.name, handlers: [...entry.handlers].sort() };
  }).sort((left, right) => left.name.localeCompare(right.name));
  return {
    runtime: { ...runtime, ...('compatibility_flags' in runtime ? { compatibility_flags: [...runtime.compatibility_flags].sort() } : {}) },
    handlers: [...script.handlers].sort(), namedHandlers,
  };
}

export function gatewayBindingIdentity(version) {
  const bindings = bindingMap(version);
  textBinding(bindings, 'ENVIRONMENT', 'staging');
  textBinding(bindings, 'CRM_IDENTITY_ISSUER_CALLER_ENABLED', 'true');
  textBinding(bindings, 'CRM_IDENTITY_ISSUER_CALLER_ID', 'crm-api-staging-v1');
  const sourceSha = textBinding(bindings, 'APP_VERSION');
  const timekeepingVersionId = textBinding(bindings, 'TIMEKEEPING_VERSION_ID');
  if (!SHA.test(sourceSha) || !UUID.test(timekeepingVersionId)) fail('CRM_GATEWAY_REFRESH_AFFINITY_INVALID');
  for (const [name, service] of Object.entries({
    CRM_CORE: 'skincos-crm-core-staging', IDENTITY_CRM_ISSUER: ISSUER,
    INVENTORY: 'skincos-insumos-staging', INVENTORY_LEGACY_JOBS: 'skincos-insumos-staging',
    TIMEKEEPING: 'skincos-timekeeping-staging', FINANCE: 'skincos-finance-staging',
  })) {
    if (bindings.get(name)?.type !== 'service' || bindings.get(name)?.service !== service) fail('CRM_GATEWAY_REFRESH_SERVICE_INVALID');
  }
  if (bindings.get('INVENTORY_LEGACY_JOBS')?.entrypoint !== 'InventoryLegacyJobsEntrypoint'
    || bindings.get('CRM_IDENTITY_ISSUER_CALLER_HMAC')?.type !== 'secret_text'
    || bindings.get('DB')?.type !== 'd1' || bindings.get('DB')?.id !== '4bdd7995-ad69-465a-917c-0aab22db5c4e'
    || bindings.get('BACKUP_BUCKET')?.type !== 'r2_bucket' || bindings.get('BACKUP_BUCKET')?.bucket_name !== 'skincos-backups-staging'
    || bindings.get('CF_VERSION_METADATA')?.type !== 'version_metadata') fail('CRM_GATEWAY_REFRESH_CUSTODY_INVALID');
  // Secret values cannot be read back. Their exact names/types, unchanged active
  // versions, keep-vars upload and the absence of any secret writer are attested.
  const comparable = [...bindings.values()].filter((entry) => entry.name !== 'APP_VERSION')
    .map((entry) => entry.type === 'secret_text' ? { name: entry.name, type: entry.type } : entry)
    .sort((left, right) => left.name.localeCompare(right.name));
  return {
    sourceSha, timekeepingVersionId, bindingCount: bindings.size, bindingsDigest: digest(comparable),
    compatibilityDigest: digest(runtimeIdentity(version.resources)),
  };
}

function issuerIdentity(version) {
  const bindings = bindingMap(version);
  textBinding(bindings, 'IDENTITY_CRM_DELIVERY_ENVIRONMENT', 'staging');
  textBinding(bindings, 'IDENTITY_CRM_DELIVERY_ENABLED', 'true');
  textBinding(bindings, 'IDENTITY_CRM_DELIVERY_CALLER_ENABLED', 'true');
  textBinding(bindings, 'IDENTITY_CRM_DELIVERY_CALLER_ID', 'crm-api-staging-v1');
  for (const name of ['IDENTITY_CRM_DELIVERY_CALLER_HMAC', 'IDENTITY_CRM_DELIVERY_REQUEST_HMAC', 'IDENTITY_CRM_DELIVERY_KID', 'IDENTITY_CRM_DELIVERY_PRIVATE_JWK', 'IDENTITY_CRM_DELIVERY_PUBLIC_JWK']) {
    if (bindings.get(name)?.type !== 'secret_text') fail('CRM_GATEWAY_REFRESH_ISSUER_CUSTODY_INVALID');
  }
}

function deploymentIdentity(deployment) {
  if (!UUID.test(deployment?.id || '') || deployment?.strategy !== 'percentage'
    || !Array.isArray(deployment.versions) || deployment.versions.length !== 1
    || deployment.versions[0].percentage !== 100 || !UUID.test(deployment.versions[0].version_id || '')) fail('CRM_GATEWAY_REFRESH_DEPLOYMENT_INVALID');
  return { deploymentId: deployment.id, versionId: deployment.versions[0].version_id };
}

function exactSnapshot(snapshot, expected) {
  const identity = deploymentIdentity(snapshot?.deployment);
  if (snapshot?.version?.id !== identity.versionId || identity.versionId !== expected.versionId
    || (expected.deploymentId && identity.deploymentId !== expected.deploymentId)) fail('CRM_GATEWAY_REFRESH_OWNERSHIP_CONFLICT');
  return identity;
}

function unchangedBindings(actual, expected) {
  if (actual.bindingsDigest !== expected.bindingsDigest || actual.compatibilityDigest !== expected.compatibilityDigest
    || actual.bindingCount !== expected.bindingCount || actual.timekeepingVersionId !== expected.timekeepingVersionId) fail('CRM_GATEWAY_REFRESH_BINDING_DRIFT');
}

/** IO is injected for offline tests; only the CLI adapter below can mutate Cloudflare. */
export async function refreshCrmStagingGateway({ sourceSha, coreReleaseSha, coreArtifactDigest,
  expectedApiVersionId, expectedIssuerVersionId, runId, io, onReport = () => {} }) {
  if (!SHA.test(sourceSha || '') || !SHA.test(coreReleaseSha || '') || !DIGEST.test(coreArtifactDigest || '')
    || !UUID.test(expectedApiVersionId || '') || !UUID.test(expectedIssuerVersionId || '')
    || !/^\d{1,20}$/.test(runId || '')) fail('CRM_GATEWAY_REFRESH_INPUT_INVALID');
  const report = { schemaVersion: 1, operation: 'refresh-gateway', environment: 'staging', sourceSha,
    coreReleaseSha, coreArtifactDigest, runId, state: 'preflight', at: new Date().toISOString(),
    credentialMaterialIncluded: false, piiIncluded: false, issuerWritten: false, secretsWritten: false, d1Written: false,
    rollback: 'not-needed' };
  let incumbent; let issuer; let originalBindings;
  const persist = () => onReport({ ...report });
  const unchanged = async () => {
    const apiNow = await io.snapshot(API); const issuerNow = await io.snapshot(ISSUER);
    exactSnapshot(apiNow, incumbent); exactSnapshot(issuerNow, issuer);
    unchangedBindings(gatewayBindingIdentity(apiNow.version), originalBindings);
    issuerIdentity(issuerNow.version);
  };
  try {
    const apiBefore = await io.snapshot(API); const issuerBefore = await io.snapshot(ISSUER);
    incumbent = exactSnapshot(apiBefore, { versionId: expectedApiVersionId });
    issuer = exactSnapshot(issuerBefore, { versionId: expectedIssuerVersionId });
    originalBindings = gatewayBindingIdentity(apiBefore.version); issuerIdentity(issuerBefore.version);
    Object.assign(report, { incumbent, issuer, bindingCount: originalBindings.bindingCount,
      bindingsDigest: originalBindings.bindingsDigest, compatibilityDigest: originalBindings.compatibilityDigest,
      timekeepingVersionId: originalBindings.timekeepingVersionId, incumbentSourceSha: originalBindings.sourceSha });
    persist();
    await io.ready({ coreReleaseSha, coreArtifactDigest });
    await io.guard('upload'); await unchanged();
    const candidateVersionId = await io.upload({ sourceSha, timekeepingVersionId: originalBindings.timekeepingVersionId });
    if (!UUID.test(candidateVersionId || '') || candidateVersionId === incumbent.versionId) fail('CRM_GATEWAY_REFRESH_CANDIDATE_INVALID');
    report.candidateVersionId = candidateVersionId; report.state = 'candidate-uploaded'; persist();
    const candidate = await io.version(API, candidateVersionId);
    if (candidate.id !== candidateVersionId || candidate.annotations?.['workers/message'] !== `crm:gateway:${sourceSha}:${runId}`) fail('CRM_GATEWAY_REFRESH_CANDIDATE_INVALID');
    const candidateBindings = gatewayBindingIdentity(candidate);
    if (candidateBindings.sourceSha !== sourceSha) fail('CRM_GATEWAY_REFRESH_SOURCE_INVALID');
    unchangedBindings(candidateBindings, originalBindings);
    await io.ready({ coreReleaseSha, coreArtifactDigest });
    await io.guard('switch'); await unchanged();
    report.state = 'switch-attempted'; persist();
    // A timed-out POST is never retried. Without its exact returned deployment id,
    // the report remains outcome-unknown and automatic rollback is forbidden.
    const deployed = deploymentIdentity(await io.deploy(candidateVersionId, `crm:gateway:${sourceSha}:${runId}`));
    if (deployed.versionId !== candidateVersionId) fail('CRM_GATEWAY_REFRESH_DEPLOYMENT_INVALID');
    report.deploymentId = deployed.deploymentId; report.state = 'switched'; persist();
    const apiAfter = await io.snapshot(API); const issuerAfter = await io.snapshot(ISSUER);
    exactSnapshot(apiAfter, deployed); exactSnapshot(issuerAfter, issuer);
    unchangedBindings(gatewayBindingIdentity(apiAfter.version), originalBindings);
    await io.probe({ sourceSha, candidateVersionId, coreReleaseSha, coreArtifactDigest });
    exactSnapshot(await io.snapshot(API), deployed); exactSnapshot(await io.snapshot(ISSUER), issuer);
    report.state = 'verified'; report.verifiedAt = new Date().toISOString(); persist();
    return report;
  } catch (cause) {
    report.failure = safeCode(cause);
    if (report.deploymentId) {
      try {
        await io.guard('rollback');
        exactSnapshot(await io.snapshot(API), { deploymentId: report.deploymentId, versionId: report.candidateVersionId });
        exactSnapshot(await io.snapshot(ISSUER), issuer);
        const restored = deploymentIdentity(await io.deploy(incumbent.versionId, `crm:gateway:rollback:${sourceSha}:${runId}`));
        if (restored.versionId !== incumbent.versionId) fail('CRM_GATEWAY_REFRESH_ROLLBACK_INVALID');
        report.rollbackDeploymentId = restored.deploymentId;
        const restoredSnapshot = await io.snapshot(API);
        exactSnapshot(restoredSnapshot, restored);
        exactSnapshot(await io.snapshot(ISSUER), issuer);
        unchangedBindings(gatewayBindingIdentity(restoredSnapshot.version), originalBindings);
        report.rollback = 'verified-api-incumbent-restored';
      } catch (rollbackError) {
        report.rollback = 'not-proven'; report.rollbackFailure = safeCode(rollbackError);
      }
    } else if (report.state === 'switch-attempted') report.rollback = 'forbidden-outcome-unknown';
    report.state = 'failed'; persist();
    throw new Error(report.failure);
  }
}

async function jsonFetch(url, init = {}) {
  const response = await fetch(url, { ...init, redirect: 'manual', signal: AbortSignal.timeout(15_000) });
  if (!response.ok) fail('CRM_GATEWAY_REFRESH_READBACK_FAILED');
  return { response, body: await response.json() };
}

function command(args, options = {}) {
  try { return execFileSync(process.execPath, args, { encoding: 'utf8', timeout: 120_000, maxBuffer: 1024 * 1024, ...options }); }
  catch { fail('CRM_GATEWAY_REFRESH_COMMAND_FAILED'); }
}

export async function attestCrmActiveGateway({ sourceSha, expectedApiVersionId, expectedIssuerVersionId, io }) {
  if (!SHA.test(sourceSha || '') || !UUID.test(expectedApiVersionId || '') || !UUID.test(expectedIssuerVersionId || '')) fail('CRM_GATEWAY_REFRESH_INPUT_INVALID');
  const api = await io.snapshot(API); const issuer = await io.snapshot(ISSUER);
  exactSnapshot(api, { versionId: expectedApiVersionId }); exactSnapshot(issuer, { versionId: expectedIssuerVersionId });
  if (gatewayBindingIdentity(api.version).sourceSha !== sourceSha) fail('CRM_GATEWAY_REFRESH_SOURCE_INVALID');
  issuerIdentity(issuer.version);
  return { state: 'active-attested', sourceSha, gatewayVersionId: expectedApiVersionId, issuerVersionId: expectedIssuerVersionId, credentialMaterialIncluded: false };
}

function createIo(env) {
  if (!/^[0-9a-f]{32}$/.test(env.CLOUDFLARE_ACCOUNT_ID || '') || !env.CLOUDFLARE_API_TOKEN
    || !env.RUNNER_TEMP || env.GITHUB_ACTIONS !== 'true' || env.GITHUB_REF !== 'refs/heads/main'
    || env.GITHUB_RUN_ATTEMPT !== '1' || env.GITHUB_SHA !== env.RELEASE_SHA) fail('CRM_GATEWAY_REFRESH_RUNNER_REQUIRED');
  const base = `https://api.cloudflare.com/client/v4/accounts/${env.CLOUDFLARE_ACCOUNT_ID}/workers/scripts`;
  const cloud = async (script, suffix, options = {}) => {
    if (![API, ISSUER].includes(script) || (options.method && (script !== API || suffix !== '/deployments' || options.method !== 'POST'))) fail('CRM_GATEWAY_REFRESH_TARGET_INVALID');
    const { body } = await jsonFetch(`${base}/${script}${suffix}`, { ...options,
      headers: { accept: 'application/json', 'content-type': 'application/json', authorization: `Bearer ${env.CLOUDFLARE_API_TOKEN}` } });
    if (body?.success !== true) fail('CRM_GATEWAY_REFRESH_CLOUDFLARE_FAILED');
    return body.result;
  };
  const version = (script, id) => {
    if (!UUID.test(id || '')) fail('CRM_GATEWAY_REFRESH_VERSION_INVALID');
    return cloud(script, `/versions/${id}`);
  };
  const ready = async ({ coreReleaseSha, coreArtifactDigest }) => {
    const { response, body } = await jsonFetch('https://api-staging.skincos.com.br/crm/ready', { headers: { accept: 'application/json', 'cache-control': 'no-store' } });
    if (response.status !== 200 || response.headers.has('set-cookie') || body.ok !== true || body.environment !== 'staging'
      || body.reason !== 'CRM_STAGING_READY' || body.release !== coreReleaseSha || body.artifactDigest !== coreArtifactDigest) fail('CRM_GATEWAY_REFRESH_CORE_DRIFT');
  };
  return {
    version, ready,
    snapshot: async (script) => {
      const result = await cloud(script, '/deployments');
      const list = Array.isArray(result) ? result : result?.deployments;
      if (!Array.isArray(list) || !list.length || list.some((item) => !Number.isFinite(Date.parse(item.created_on)))) fail('CRM_GATEWAY_REFRESH_DEPLOYMENT_INVALID');
      const ordered = [...list].sort((a, b) => Date.parse(b.created_on) - Date.parse(a.created_on));
      if (ordered[1] && ordered[0].created_on === ordered[1].created_on) fail('CRM_GATEWAY_REFRESH_DEPLOYMENT_INVALID');
      const deployment = ordered[0]; const active = deploymentIdentity(deployment);
      return { deployment, version: await version(script, active.versionId) };
    },
    guard: async (phase) => {
      if (!['upload', 'switch', 'rollback'].includes(phase)) fail('CRM_GATEWAY_REFRESH_PHASE_INVALID');
      try {
        const head = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
        if (head !== env.RELEASE_SHA) fail('CRM_GATEWAY_REFRESH_SOURCE_DRIFT');
        // A later source-only main commit cannot prohibit recovery of this
        // run's exact deployment. Rollback still requires the original fenced
        // lease and exact deployment ownership immediately before its POST.
        if (phase !== 'rollback') {
          execFileSync('git', ['fetch', '--no-tags', 'origin', 'main:refs/remotes/origin/main'], { stdio: 'pipe', timeout: 30_000 });
          const main = execFileSync('git', ['rev-parse', 'refs/remotes/origin/main'], { encoding: 'utf8' }).trim();
          if (main !== env.RELEASE_SHA) fail('CRM_GATEWAY_REFRESH_SOURCE_DRIFT');
        }
      } catch { fail('CRM_GATEWAY_REFRESH_SOURCE_DRIFT'); }
      command(['scripts/codex-global-coordination-workflow.mjs', 'check',
        '--proof-file', path.join(env.RUNNER_TEMP, 'crm-identity-workers-lease.json'),
        '--resource', 'global:ponto-workers-writer', '--module', 'core',
        '--source', env.RELEASE_SHA, '--candidate-source', env.RELEASE_SHA]);
    },
    upload: async ({ sourceSha, timekeepingVersionId }) => {
      const output = path.join(env.RUNNER_TEMP, `crm-gateway-upload-${env.GITHUB_RUN_ID}.ndjson`);
      if (fs.existsSync(output)) fail('CRM_GATEWAY_REFRESH_UPLOAD_ALREADY_ATTEMPTED');
      try {
        command(['api/node_modules/wrangler/bin/wrangler.js', 'versions', 'upload', '--config', 'api/wrangler.toml', '--env', 'staging', '--keep-vars',
          '--var', `APP_VERSION:${sourceSha}`, '--var', 'ENVIRONMENT:staging',
          '--var', 'CRM_IDENTITY_ISSUER_CALLER_ENABLED:true', '--var', 'CRM_IDENTITY_ISSUER_CALLER_ID:crm-api-staging-v1',
          '--var', `TIMEKEEPING_VERSION_ID:${timekeepingVersionId}`, '--message', `crm:gateway:${sourceSha}:${env.GITHUB_RUN_ID}`,
        ], { env: { ...env, WRANGLER_OUTPUT_FILE_PATH: output } });
        const records = fs.readFileSync(output, 'utf8').trim().split('\n').map((line) => JSON.parse(line));
        const uploads = records.filter((entry) => entry.type === 'version-upload');
        if (uploads.length !== 1 || uploads[0].worker_name !== API || uploads[0].wrangler_environment !== 'staging') fail('CRM_GATEWAY_REFRESH_UPLOAD_INVALID');
        return uploads[0].version_id;
      } finally { if (fs.existsSync(output)) fs.unlinkSync(output); }
    },
    // Direct version weighting avoids Wrangler's ancillary settings patch. No
    // route, binding, migration, issuer or secret mutation exists in this adapter.
    deploy: (versionId, message) => cloud(API, '/deployments', { method: 'POST', body: JSON.stringify({
      strategy: 'percentage', versions: [{ version_id: versionId, percentage: 100 }], annotations: { 'workers/message': message },
    }) }),
    probe: async ({ sourceSha, candidateVersionId, coreReleaseSha, coreArtifactDigest }) => {
      await ready({ coreReleaseSha, coreArtifactDigest });
      for (const origin of CRM_SMOKE_CONSOLE_ORIGINS) {
        for (const target of ['/crm/session', '/crm/projections?units=novo-hamburgo']) {
          const response = await fetch(`https://api-staging.skincos.com.br${target}`, {
            headers: { accept: 'application/json', 'cache-control': 'no-store', origin }, redirect: 'manual', signal: AbortSignal.timeout(15_000),
          });
          assertCrmSmokeCors(response, origin);
          const body = await response.json();
          if (response.status !== 401 || body.ok !== false || body.error !== 'CRM_IDENTITY_REQUIRED'
            || Object.keys(body).length !== 2 || response.headers.get('x-skincos-gateway-release-sha') !== sourceSha
            || response.headers.get('x-skincos-gateway-version-id') !== candidateVersionId
            || response.headers.get('x-skincos-gateway-environment') !== 'staging') fail('CRM_GATEWAY_REFRESH_PROBE_FAILED');
        }
      }
    },
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const env = process.env;
  try {
    if (process.argv.length === 3 && process.argv[2] === '--attest-active') {
      const sourceSha = resolveCrmSmokeGatewaySource(env);
      if (env.OPERATION === 'session-smoke' && env.CRM_IDENTITY_SMOKE_PROFILE === 'session-and-projections') revalidateCrmGatewaySourceBinding({ env });
      const result = await attestCrmActiveGateway({ sourceSha,
        expectedApiVersionId: env.EXPECTED_API_VERSION_ID, expectedIssuerVersionId: env.EXPECTED_ISSUER_VERSION_ID, io: createIo(env) });
      process.stdout.write(`${JSON.stringify(result)}\n`);
      process.exit(0);
    }
    if (process.argv.length !== 2 || env.OPERATION !== 'refresh-gateway'
      || env.CONFIRMATION !== 'refresh-crm-gateway-staging') fail('CRM_GATEWAY_REFRESH_OPERATION_INVALID');
    const reportPath = path.join(env.RUNNER_TEMP || '.', 'crm-gateway-refresh-report.json');
    const result = await refreshCrmStagingGateway({ sourceSha: env.RELEASE_SHA,
      coreReleaseSha: env.CRM_CORE_RELEASE_SHA, coreArtifactDigest: env.CRM_CORE_ARTIFACT_DIGEST,
      expectedApiVersionId: env.EXPECTED_API_VERSION_ID, expectedIssuerVersionId: env.EXPECTED_ISSUER_VERSION_ID,
      runId: env.GITHUB_RUN_ID, io: createIo(env),
      onReport: (report) => fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 }),
    });
    process.stdout.write(`${JSON.stringify(result)}\n`);
  } catch (error) {
    process.stderr.write(`${safeCode(error)}\n`); process.exitCode = 1;
  }
}
