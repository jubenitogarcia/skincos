import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

export const PRODUCTION_WORKER_NAME = 'skincos-identity-crm-delivery-production';
export const STAGING_WORKER_NAME = 'skincos-identity-crm-delivery-staging';

// These names are an inventory contract for the future production runtime. The
// audit only checks their presence by name; it never reads or emits a value.
// Provisioning them is deliberately a separate, reviewed custody operation.
export const REQUIRED_PRODUCTION_SECRET_NAMES = Object.freeze([
  'IDENTITY_CRM_DELIVERY_PRODUCTION_KID',
  'IDENTITY_CRM_DELIVERY_PRODUCTION_PRIVATE_JWK',
  'IDENTITY_CRM_DELIVERY_PRODUCTION_PUBLIC_JWK',
  'IDENTITY_CRM_DELIVERY_PRODUCTION_REQUEST_HMAC',
]);

export const IDENTITY_CRM_DELIVERY_PROTOCOL = Object.freeze({
  version: 'identity-crm-delivery/v1',
  issuer: 'skincos-identity',
  audience: 'skincos-crm-core',
  algorithm: 'EdDSA',
  type: 'skincos-identity-delivery+jws',
  maxTtlSeconds: 60,
  targetPrefix: '/api/crm',
});

const ACCOUNT_ID_PATTERN = /^[0-9a-f]{32}$/i;
const IDENTIFIER_PATTERN = /^[A-Za-z0-9._-]{1,160}$/;
const ZONE_ID_PATTERN = /^[0-9a-f]{32}$/i;
const READ_METHOD = 'GET';
const PRODUCTION_ATTESTATION_ENV = Object.freeze({
  custody: 'IDENTITY_CRM_DELIVERY_PRODUCTION_CUSTODY_ATTESTED',
  caller: 'IDENTITY_CRM_DELIVERY_PRODUCTION_CALLER_ATTESTED',
  replay: 'IDENTITY_CRM_DELIVERY_PRODUCTION_REPLAY_ATTESTED',
  rotation: 'IDENTITY_CRM_DELIVERY_PRODUCTION_ROTATION_ATTESTED',
});

function string(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function present(value) {
  return string(value).length > 0;
}

function booleanEnv(value) {
  return string(value).toLowerCase() === 'true';
}

function safeIdentifier(value) {
  const normalized = string(value);
  return IDENTIFIER_PATTERN.test(normalized) ? normalized : null;
}

function safeDate(value) {
  const normalized = string(value);
  return normalized && !Number.isNaN(Date.parse(normalized)) ? normalized : null;
}

function endpointState(state, extra = {}) {
  return Object.freeze({ state, ...extra });
}

function unavailableEndpoint(reason = 'not-read') {
  return endpointState('unavailable', { reason });
}

function notAttemptedEndpoint(reason = 'cloudflare-credentials-unavailable') {
  return endpointState('not-attempted', { reason });
}

function summarizeApiError(response, payload) {
  const codes = Array.isArray(payload?.errors)
    ? payload.errors
      .map((entry) => entry?.code)
      .filter((code) => Number.isInteger(code))
      .slice(0, 8)
    : [];
  return endpointState(response?.status === 404 ? 'not-found' : 'unavailable', {
    httpStatus: Number.isInteger(response?.status) ? response.status : null,
    errorCodes: codes,
  });
}

function resultArray(value, key) {
  if (Array.isArray(value)) return value;
  if (Array.isArray(value?.[key])) return value[key];
  return [];
}

function sanitizeBindings(settings) {
  const bindings = Array.isArray(settings?.bindings) ? settings.bindings : [];
  return bindings
    .map((binding) => {
      const name = safeIdentifier(binding?.name);
      const type = safeIdentifier(binding?.type);
      if (!name || !type) return null;
      const sanitized = { name, type };
      if (type === 'service') {
        sanitized.service = safeIdentifier(binding?.service);
        sanitized.environment = safeIdentifier(binding?.environment);
      }
      return sanitized;
    })
    .filter(Boolean)
    .sort((left, right) => `${left.name}:${left.type}`.localeCompare(`${right.name}:${right.type}`));
}

export function sanitizeWorkerSettings(settings) {
  if (!settings || typeof settings !== 'object' || Array.isArray(settings)) {
    return { compatibilityDate: null, usageModel: null, workersDev: null, bindings: [] };
  }
  return {
    compatibilityDate: string(settings.compatibility_date) || null,
    usageModel: ['standard', 'bundled', 'unbound'].includes(settings.usage_model)
      ? settings.usage_model
      : null,
    workersDev: typeof settings.workers_dev === 'boolean' ? settings.workers_dev : null,
    bindings: sanitizeBindings(settings),
  };
}

export function sanitizeDeployments(value) {
  const entries = resultArray(value, 'deployments');
  const sanitized = entries
    .map((deployment) => {
      if (!deployment || typeof deployment !== 'object' || Array.isArray(deployment)) return null;
      const id = safeIdentifier(deployment.id || deployment.version_id);
      const versionId = safeIdentifier(deployment.version_id || deployment.id);
      const source = safeIdentifier(deployment.source || deployment.last_deployed_from);
      const strategy = safeIdentifier(deployment.strategy);
      const createdOn = safeDate(deployment.created_on || deployment.createdOn);
      const percentage = Number.isFinite(deployment.percentage) ? deployment.percentage : null;
      return { id, versionId, source, strategy, createdOn, percentage };
    })
    .filter(Boolean)
    .slice(0, 20);
  return { count: entries.length, entries: sanitized };
}

export function sanitizeSecretInventory(value) {
  const entries = resultArray(value, 'secrets');
  const names = [...new Set(entries
    .map((entry) => safeIdentifier(entry?.name))
    .filter(Boolean))].sort();
  return {
    count: names.length,
    names,
    valuesReadOrEmitted: false,
  };
}

export function sanitizeRoutes(value, workerName) {
  const entries = resultArray(value, 'routes');
  const matches = entries
    .filter((route) => route?.script === workerName)
    .map((route) => ({
      pattern: typeof route.pattern === 'string' ? route.pattern.slice(0, 512) : null,
      script: workerName,
    }))
    .filter((route) => route.pattern);
  return {
    count: matches.length,
    patterns: matches.map((route) => route.pattern).sort(),
  };
}

function workerReadback({ settings, deployments, secrets, subdomain }) {
  return {
    settings,
    deployments,
    secrets,
    subdomain,
  };
}

function hasAvailableEndpoint(endpoint) {
  return endpoint?.state === 'available';
}

function endpointWithResult(result) {
  return endpointState('available', { result });
}

function credentialsState(env) {
  const accountId = string(env.CLOUDFLARE_ACCOUNT_ID);
  const apiToken = string(env.CLOUDFLARE_API_TOKEN);
  if (!accountId || !apiToken) {
    return {
      usable: false,
      accountIdPresent: Boolean(accountId),
      apiTokenPresent: Boolean(apiToken),
      reason: 'CLOUDFLARE_API_TOKEN and CLOUDFLARE_ACCOUNT_ID are required',
    };
  }
  if (!ACCOUNT_ID_PATTERN.test(accountId)) {
    return {
      usable: false,
      accountIdPresent: true,
      apiTokenPresent: true,
      reason: 'CLOUDFLARE_ACCOUNT_ID is malformed',
    };
  }
  return { usable: true, accountIdPresent: true, apiTokenPresent: true };
}

function cloudflareReader({ accountId, apiToken, fetchImpl = fetch }) {
  const baseUrl = `https://api.cloudflare.com/client/v4/accounts/${accountId}`;
  return async (relativePath) => {
    const response = await fetchImpl(`${baseUrl}${relativePath}`, {
      method: READ_METHOD,
      headers: {
        authorization: `Bearer ${apiToken}`,
        accept: 'application/json',
      },
    });
    let payload = null;
    try {
      payload = await response.json();
    } catch {
      return endpointState('unavailable', {
        httpStatus: Number.isInteger(response.status) ? response.status : null,
        errorCodes: [],
        reason: 'non-json-response',
      });
    }
    if (!response.ok || payload?.success !== true) return summarizeApiError(response, payload);
    return endpointWithResult(payload.result);
  };
}

async function readProductionWorker({ reader, workerName }) {
  const encodedWorkerName = encodeURIComponent(workerName);
  const [settings, deployments, secrets, subdomain] = await Promise.all([
    reader(`/workers/scripts/${encodedWorkerName}/settings`),
    reader(`/workers/scripts/${encodedWorkerName}/deployments`),
    reader(`/workers/scripts/${encodedWorkerName}/secrets`),
    reader(`/workers/scripts/${encodedWorkerName}/subdomain`),
  ]);
  return workerReadback({ settings, deployments, secrets, subdomain });
}

export function evaluateIdentityCrmProductionReadiness({
  workerName = PRODUCTION_WORKER_NAME,
  stagingWorkerName = STAGING_WORKER_NAME,
  cloudflareCredentials,
  worker,
  routes,
  custodyRefPresent = false,
  custodyAttested = false,
  callerAttested = false,
  replayAttested = false,
  rotationAttested = false,
} = {}) {
  const blockers = [];
  const productionWorker = string(workerName);
  const stagingWorker = string(stagingWorkerName);
  const settings = worker?.settings?.state === 'available' ? worker.settings.result : null;
  const deploymentReadback = worker?.deployments?.state === 'available'
    ? sanitizeDeployments(worker.deployments.result)
    : { count: 0, entries: [] };
  const secretReadback = worker?.secrets?.state === 'available'
    ? sanitizeSecretInventory(worker.secrets.result)
    : { count: 0, names: [], valuesReadOrEmitted: false };
  const subdomain = worker?.subdomain?.state === 'available' ? worker.subdomain.result : null;
  const routeReadback = routes?.state === 'available'
    ? sanitizeRoutes(routes.result, productionWorker)
    : { count: 0, patterns: [] };

  if (productionWorker !== PRODUCTION_WORKER_NAME) {
    blockers.push('production worker name is not the canonical Identity owner');
  }
  if (!stagingWorker || stagingWorker === productionWorker) {
    blockers.push('staging and production worker names must be distinct');
  }
  if (!cloudflareCredentials?.usable) {
    blockers.push(cloudflareCredentials?.reason || 'Cloudflare read credentials are unavailable');
  }
  if (!hasAvailableEndpoint(worker?.settings)) {
    blockers.push('production Worker settings could not be read');
  }
  if (!hasAvailableEndpoint(worker?.deployments) || deploymentReadback.count < 1) {
    blockers.push('production Worker has no externally verified deployment baseline');
  }
  if (!hasAvailableEndpoint(worker?.secrets)) {
    blockers.push('production Worker secret inventory could not be read');
  }
  const missingSecretNames = REQUIRED_PRODUCTION_SECRET_NAMES
    .filter((name) => !secretReadback.names.includes(name));
  if (missingSecretNames.length > 0) {
    blockers.push(`production Worker is missing required secret names: ${missingSecretNames.join(', ')}`);
  }
  if (!hasAvailableEndpoint(worker?.subdomain)) {
    blockers.push('production Worker public subdomain state could not be read');
  } else if (subdomain?.enabled !== false) {
    blockers.push('production Worker public workers.dev access is not proven disabled');
  }
  if (!hasAvailableEndpoint(routes)) {
    blockers.push('production Worker route inventory could not be read');
  } else if (routeReadback.count > 0) {
    blockers.push('production Worker has a route; private Identity delivery must not have a public route');
  }
  if (!custodyRefPresent || !custodyAttested) {
    blockers.push('durable Identity-owned key custody is not externally attested');
  }
  if (!callerAttested) {
    blockers.push('CRM caller ownership and authentication are not externally attested');
  }
  if (!replayAttested) {
    blockers.push('CRM atomic replay-ledger readback is not externally attested');
  }
  if (!rotationAttested) {
    blockers.push('key rotation, overlap and rollback window are not externally attested');
  }

  const sanitizedSettings = settings ? sanitizeWorkerSettings(settings) : null;
  const report = {
    schemaVersion: 1,
    result: blockers.length === 0 ? 'eligible-for-approved-cutover' : 'blocked',
    state: blockers.length === 0 ? 'eligible' : 'blocked',
    owner: 'Identity',
    workerName: productionWorker || null,
    stagingWorkerName: stagingWorker || null,
    protocol: IDENTITY_CRM_DELIVERY_PROTOCOL,
    readOnly: {
      mutationsAttempted: false,
      productionDeploymentAttempted: false,
      secretValuesReadOrEmitted: false,
      piiReadOrEmitted: false,
    },
    cloudflare: {
      credentials: {
        accountIdPresent: Boolean(cloudflareCredentials?.accountIdPresent),
        apiTokenPresent: Boolean(cloudflareCredentials?.apiTokenPresent),
      },
      settings: worker?.settings?.state || 'not-read',
      deployments: worker?.deployments?.state || 'not-read',
      secrets: worker?.secrets?.state || 'not-read',
      subdomain: worker?.subdomain?.state || 'not-read',
      routeInventory: routes?.state || 'not-read',
      workerSettings: sanitizedSettings,
      deploymentBaseline: deploymentReadback,
      secretInventory: secretReadback,
      routeReadback: routeReadback,
    },
    attestations: {
      custodyReferencePresent: Boolean(custodyRefPresent),
      durableKeyCustody: Boolean(custodyAttested),
      crmCaller: Boolean(callerAttested),
      replayLedger: Boolean(replayAttested),
      keyRotationAndRollback: Boolean(rotationAttested),
    },
    blockers,
  };
  return Object.freeze(report);
}

export async function runIdentityCrmProductionReadiness({ env = process.env, fetchImpl = fetch } = {}) {
  const workerName = string(env.IDENTITY_CRM_PRODUCTION_WORKER_NAME) || PRODUCTION_WORKER_NAME;
  const stagingWorkerName = string(env.IDENTITY_CRM_STAGING_WORKER_NAME) || STAGING_WORKER_NAME;
  const credentials = credentialsState(env);
  let worker = workerReadback({
    settings: notAttemptedEndpoint(),
    deployments: notAttemptedEndpoint(),
    secrets: notAttemptedEndpoint(),
    subdomain: notAttemptedEndpoint(),
  });
  let routes = notAttemptedEndpoint();

  if (credentials.usable) {
    const reader = cloudflareReader({
      accountId: string(env.CLOUDFLARE_ACCOUNT_ID),
      apiToken: string(env.CLOUDFLARE_API_TOKEN),
      fetchImpl,
    });
    worker = await readProductionWorker({ reader, workerName });
    const zoneId = string(env.CLOUDFLARE_ZONE_ID);
    if (zoneId && ZONE_ID_PATTERN.test(zoneId)) {
      routes = await reader(`/zones/${zoneId}/workers/routes?per_page=1000`);
    } else {
      routes = endpointState('not-configured', { reason: 'CLOUDFLARE_ZONE_ID is required for route readback' });
    }
  }

  const report = evaluateIdentityCrmProductionReadiness({
    workerName,
    stagingWorkerName,
    cloudflareCredentials: credentials,
    worker,
    routes,
    custodyRefPresent: present(env.IDENTITY_CRM_DELIVERY_PRODUCTION_CUSTODY_REF),
    custodyAttested: booleanEnv(env[PRODUCTION_ATTESTATION_ENV.custody]),
    callerAttested: booleanEnv(env[PRODUCTION_ATTESTATION_ENV.caller]),
    replayAttested: booleanEnv(env[PRODUCTION_ATTESTATION_ENV.replay]),
    rotationAttested: booleanEnv(env[PRODUCTION_ATTESTATION_ENV.rotation]),
  });
  return report;
}

async function writeReport(reportPath, report) {
  await mkdir(path.dirname(reportPath), { recursive: true });
  await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 });
}

async function main() {
  const reportPath = string(process.env.IDENTITY_CRM_PRODUCTION_READINESS_REPORT)
    || string(process.argv[2])
    || path.join(process.cwd(), 'identity-crm-production-readiness.json');
  let report;
  try {
    report = await runIdentityCrmProductionReadiness();
  } catch (error) {
    // Keep the failure artifact sanitized. A transport/runtime error must not
    // turn a missing readback into a false positive or expose request details.
    report = {
      schemaVersion: 1,
      result: 'blocked',
      state: 'blocked',
      owner: 'Identity',
      readOnly: {
        mutationsAttempted: false,
        productionDeploymentAttempted: false,
        secretValuesReadOrEmitted: false,
        piiReadOrEmitted: false,
      },
      blockers: ['Cloudflare readback failed before a complete sanitized report was produced'],
      failureClass: error instanceof TypeError ? 'configuration' : 'transport-or-runtime',
    };
  }
  await writeReport(reportPath, report);
  process.stdout.write(`${JSON.stringify(report)}\n`);
  if (booleanEnv(process.env.IDENTITY_CRM_PRODUCTION_READINESS_STRICT) && report.result !== 'eligible-for-approved-cutover') {
    process.exitCode = 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(() => {
    process.exitCode = 1;
  });
}
