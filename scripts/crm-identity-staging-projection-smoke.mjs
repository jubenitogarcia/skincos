import fs from 'node:fs';
import path from 'node:path';
import { validateCrmProjectionPayload } from '../api/src/crm-projection-response.js';
import { resolveCrmSmokeGatewaySource } from './crm-identity-staging-gateway-source-binding.mjs';

export const CRM_SMOKE_CONSOLE_ORIGINS = Object.freeze([
  'https://crm-core-staging.skincos.com.br',
  'https://crm-staging.skincos.com.br',
]);
const API_ORIGIN = 'https://api-staging.skincos.com.br';
const NH = 'novo-hamburgo';
const BSS = 'barra-shopping-sul';
const fail = (code) => { throw new Error(code); };
const SHA = /^[0-9a-f]{40}$/;
const DIGEST = /^sha256:[0-9a-f]{64}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const PIN_KEYS = ['sourceSha', 'coreReleaseSha', 'coreArtifactDigest', 'gatewayVersionId', 'issuerVersionId'];
const canonicalTime = (value) => typeof value === 'string' && Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value;

function validPins(pins) {
  if (!pins || !SHA.test(pins.sourceSha) || !SHA.test(pins.coreReleaseSha)
    || !DIGEST.test(pins.coreArtifactDigest) || !UUID.test(pins.gatewayVersionId)
    || !UUID.test(pins.issuerVersionId)) fail('CRM_PROJECTION_SMOKE_PINS_INVALID');
}

/** Artifact consumers must additionally attest its terminal GitHub run, teardown and lease release. */
export function validateCrmProjectionSmokeReport(value, expected) {
  validPins(expected);
  if (expected.notBefore && !canonicalTime(expected.notBefore)) fail('CRM_PROJECTION_SMOKE_REPORT_INVALID');
  const keys = ['schemaVersion', 'environment', 'apiOrigin', 'contractVersion', 'at',
    'credentialMaterialIncluded', 'piiIncluded', 'projectionRowsIncluded', ...PIN_KEYS,
    'result', 'origins', 'authenticatedStatuses', 'preflightCount', 'deniedOriginCount',
    'forbiddenScopeCount', 'expectedIdentityReceiptDelta', 'counts', 'scopePartitionVerified', 'repeatedOpaqueResponseVerified'];
  if (!value || Object.keys(value).length !== keys.length || keys.some((key) => !Object.hasOwn(value, key))
    || PIN_KEYS.some((key) => value[key] !== expected[key])
    || value.schemaVersion !== 1 || value.environment !== 'staging' || value.apiOrigin !== API_ORIGIN
    || value.contractVersion !== 'crm-core/projection-read/v2' || value.result !== 'verified'
    || value.credentialMaterialIncluded !== false || value.piiIncluded !== false || value.projectionRowsIncluded !== false
    || value.scopePartitionVerified !== true || value.repeatedOpaqueResponseVerified !== true
    || JSON.stringify(value.origins) !== JSON.stringify(CRM_SMOKE_CONSOLE_ORIGINS)
    || JSON.stringify(value.authenticatedStatuses) !== '[200,200,200,200]'
    || value.preflightCount !== 4 || value.deniedOriginCount !== 4 || value.forbiddenScopeCount !== 3
    || value.expectedIdentityReceiptDelta !== 4 || !canonicalTime(value.at)
    || (expected.notBefore && Date.parse(value.at) < Date.parse(expected.notBefore))) fail('CRM_PROJECTION_SMOKE_REPORT_INVALID');
  const counts = value.counts;
  if (!counts || Object.keys(counts).sort().join(',') !== 'barraShoppingSul,both,novoHamburgo,repeated'
    || Object.values(counts).some((count) => !Number.isInteger(count) || count < 0 || count > 100)
    || counts.both === 0 || counts.both !== counts.novoHamburgo + counts.barraShoppingSul
    || counts.repeated !== counts.novoHamburgo) fail('CRM_PROJECTION_SMOKE_REPORT_INVALID');
  return value;
}

function noCookie(response) {
  if (response.headers.has('set-cookie')) fail('CRM_PROJECTION_SMOKE_COOKIE_LEAK');
}

export function assertCrmSmokeCors(response, origin) {
  noCookie(response);
  if (response.headers.get('access-control-allow-origin') !== origin
    || response.headers.get('access-control-allow-credentials') !== 'true'
    || !String(response.headers.get('vary')).split(',').some((item) => item.trim().toLowerCase() === 'origin')
    || !String(response.headers.get('cache-control')).includes('no-store')) fail('CRM_PROJECTION_SMOKE_CORS_INVALID');
}

async function boundedJson(response) {
  if (!response.body || !/^application\/json(?:\s*;|$)/i.test(response.headers.get('content-type') || '')) fail('CRM_PROJECTION_SMOKE_RESPONSE_INVALID');
  const reader = response.body.getReader();
  let timer;
  try {
    const body = (async () => {
      const chunks = []; let size = 0;
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > 128 * 1024) fail('CRM_PROJECTION_SMOKE_RESPONSE_TOO_LARGE');
        chunks.push(value);
      }
      return JSON.parse(Buffer.concat(chunks).toString('utf8'));
    })();
    return await Promise.race([body, new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error('CRM_PROJECTION_SMOKE_TIMEOUT')), 15_000);
    })]);
  } finally {
    clearTimeout(timer);
    void reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}

function writeReport(reportPath, report) {
  fs.mkdirSync(path.dirname(path.resolve(reportPath)), { recursive: true });
  fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 });
}

/** Cookies are supplied only by the canonical fixture login, never returned or persisted. */
export async function runCrmIdentityStagingProjectionSmoke({
  fetchImpl = globalThis.fetch, getCookie, reportPath, now = () => new Date().toISOString(),
  pins = {
    sourceSha: resolveCrmSmokeGatewaySource(), coreReleaseSha: process.env.CRM_CORE_RELEASE_SHA,
    coreArtifactDigest: process.env.CRM_CORE_ARTIFACT_DIGEST,
    gatewayVersionId: process.env.EXPECTED_API_VERSION_ID, issuerVersionId: process.env.EXPECTED_ISSUER_VERSION_ID,
  },
} = {}) {
  if (typeof getCookie !== 'function' || typeof reportPath !== 'string' || !reportPath) fail('CRM_PROJECTION_SMOKE_CONFIGURATION_INVALID');
  validPins(pins);
  const report = {
    schemaVersion: 1, environment: 'staging', apiOrigin: API_ORIGIN,
    contractVersion: 'crm-core/projection-read/v2', at: now(),
    credentialMaterialIncluded: false, piiIncluded: false, projectionRowsIncluded: false,
    ...Object.fromEntries(PIN_KEYS.map((key) => [key, pins[key]])),
  };
  const request = async (target, origin, { method = 'GET', cookie, headers = {} } = {}) => {
    const response = await fetchImpl(`${API_ORIGIN}${target}`, {
      method, headers: { accept: 'application/json', 'cache-control': 'no-store', origin, ...(cookie ? { cookie } : {}), ...headers },
      redirect: 'manual', signal: AbortSignal.timeout(15_000),
    });
    noCookie(response);
    if (response.headers.get('x-skincos-gateway-release-sha') !== pins.sourceSha
      || response.headers.get('x-skincos-gateway-environment') !== 'staging'
      || response.headers.get('x-skincos-gateway-version-id') !== pins.gatewayVersionId) fail('CRM_PROJECTION_SMOKE_GATEWAY_DRIFT');
    return response;
  };
  const error = async (target, origin, status, code, options) => {
    const response = await request(target, origin, options);
    if (response.status !== status) fail('CRM_PROJECTION_SMOKE_ERROR_STATUS_INVALID');
    assertCrmSmokeCors(response, origin);
    const body = await boundedJson(response);
    if (Object.keys(body).length !== 2 || body.ok !== false || body.error !== code) fail('CRM_PROJECTION_SMOKE_ERROR_RESPONSE_INVALID');
  };
  try {
    const ready = await request('/crm/ready', '');
    const readiness = await boundedJson(ready);
    if (ready.status !== 200 || readiness.ok !== true || readiness.environment !== 'staging'
      || readiness.reason !== 'CRM_STAGING_READY' || readiness.release !== pins.coreReleaseSha
      || readiness.artifactDigest !== pins.coreArtifactDigest) fail('CRM_PROJECTION_SMOKE_CORE_DRIFT');
    for (const origin of CRM_SMOKE_CONSOLE_ORIGINS) {
      for (const target of ['/crm/session', `/crm/projections?units=${NH}`]) {
        const preflight = await request(target, origin, { method: 'OPTIONS', headers: {
          'access-control-request-method': 'GET', 'access-control-request-headers': 'accept, cache-control',
        } });
        assertCrmSmokeCors(preflight, origin);
        if (preflight.status !== 204 || preflight.headers.get('access-control-allow-methods') !== 'GET'
          || preflight.headers.get('access-control-allow-headers') !== 'accept, cache-control'
          || await preflight.text() !== '') fail('CRM_PROJECTION_SMOKE_PREFLIGHT_INVALID');
      }
      await error(`/crm/projections?units=${NH}`, origin, 401, 'CRM_IDENTITY_REQUIRED');
      await error('/crm/session', origin, 401, 'CRM_IDENTITY_REQUIRED');
      await error('/crm/session?unexpected=1', origin, 400, 'CRM_SESSION_QUERY_NOT_ALLOWED');
      await error('/crm/session', origin, 405, 'CRM_SESSION_METHOD_NOT_ALLOWED', { method: 'POST' });
      await error('/crm/projections?units=NH', origin, 400, 'CRM_PROJECTION_QUERY_INVALID');
      await error(`/crm/projections?units=${NH}`, origin, 405, 'CRM_PROJECTION_METHOD_NOT_ALLOWED', { method: 'POST' });
    }
    for (const origin of ['https://skincos-crm-core-staging.pages.dev', 'https://crm.skincos.com.br', 'https://crm-core-staging.skincos.com.br.attacker.invalid', 'null']) {
      const denied = await request(`/crm/projections?units=${NH}`, origin);
      if (denied.status !== 403 || denied.headers.has('access-control-allow-origin') || denied.headers.has('access-control-allow-credentials')) fail('CRM_PROJECTION_SMOKE_ORIGIN_BOUNDARY_INVALID');
      await denied.body?.cancel();
    }

    const positive = async (scenario, units, origin) => {
      const response = await request(`/crm/projections?units=${units.join(',')}`, origin, { cookie: await getCookie(scenario) });
      if (response.status !== 200) fail('CRM_PROJECTION_SMOKE_AUTHENTICATED_STATUS_INVALID');
      assertCrmSmokeCors(response, origin);
      const payload = await boundedJson(response);
      return validateCrmProjectionPayload(payload, { units, requestId: response.headers.get('x-request-id') });
    };
    const [exclusive, incumbent] = CRM_SMOKE_CONSOLE_ORIGINS;
    // Four deliveries, independent of result count. Negative probes never reach Core.
    const nh = await positive('nh', [NH], exclusive);
    const bss = await positive('bss', [BSS], exclusive);
    const both = await positive('both', [BSS, NH], exclusive);
    const repeated = await positive('nh', [NH], incumbent);
    const keys = (payload) => payload.projections.map((event) => JSON.stringify(event)).sort();
    if (JSON.stringify(keys(nh)) !== JSON.stringify(keys(repeated))
      || JSON.stringify([...keys(nh), ...keys(bss)].sort()) !== JSON.stringify(keys(both))
      || both.count === 0) fail('CRM_PROJECTION_SMOKE_SCOPE_PARTITION_INVALID');
    await error(`/crm/projections?units=${BSS}`, exclusive, 403, 'CRM_PROJECTION_SCOPE_FORBIDDEN', { cookie: await getCookie('nh') });
    await error(`/crm/projections?units=${NH}`, exclusive, 403, 'CRM_PROJECTION_SCOPE_FORBIDDEN', { cookie: await getCookie('bss') });
    await error(`/crm/projections?units=${NH}`, exclusive, 403, 'CRM_PROJECTION_SCOPE_FORBIDDEN', { cookie: await getCookie('admin') });
    Object.assign(report, {
      result: 'verified', origins: [...CRM_SMOKE_CONSOLE_ORIGINS],
      authenticatedStatuses: [200, 200, 200, 200], preflightCount: 4, deniedOriginCount: 4,
      forbiddenScopeCount: 3, expectedIdentityReceiptDelta: 4,
      counts: { novoHamburgo: nh.count, barraShoppingSul: bss.count, both: both.count, repeated: repeated.count },
      scopePartitionVerified: true, repeatedOpaqueResponseVerified: true,
    });
    validateCrmProjectionSmokeReport(report, pins);
    writeReport(reportPath, report);
    return report;
  } catch (cause) {
    const failure = /^[A-Z0-9_]{3,120}$/.test(cause?.message || '') ? cause.message : 'CRM_PROJECTION_SMOKE_FAILED';
    writeReport(reportPath, { ...report, result: 'failed', failure });
    throw new Error(failure);
  }
}
