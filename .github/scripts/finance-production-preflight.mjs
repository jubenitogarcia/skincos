import { appendFile, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const WORKER_NAME = 'skincos-finance';
const API_WORKER_NAME = 'skincos-api';
const D1_NAME = 'skincos-finance';
const KV_TITLE = 'SKINCOS_FINANCE_PRODUCTION_FLAGS';
const SERVICE_SECRET_NAME = 'FINANCE_SERVICE_AUTH_SECRET';

const requireValue = (value, message) => {
  if (!value) throw new Error(message);
  return value;
};

const binding = (settings, name) =>
  (Array.isArray(settings?.bindings) ? settings.bindings : []).find((entry) => entry?.name === name);

const secretNames = (secrets) =>
  new Set((Array.isArray(secrets) ? secrets : []).map((entry) => entry?.name).filter(Boolean));

const deployments = (result) => {
  if (Array.isArray(result)) return result;
  return Array.isArray(result?.deployments) ? result.deployments : [];
};

export function validateFinanceProductionPreflight({
  operation,
  releaseSha,
  deployEnabled,
  d1Id,
  controlKvId,
  githubBackupPassphrasePresent,
  githubServiceSecretPresent,
  d1,
  kv,
  financeSettings,
  financeSecrets,
  financeDeployments,
  financeSubdomain,
  accountSubdomain,
  apiSettings,
  apiSecrets,
}) {
  requireValue(['deploy', 'rollback'].includes(operation), 'operation must be deploy or rollback');
  requireValue(/^[0-9a-f]{40}$/.test(releaseSha), 'release_sha must be a full lowercase commit SHA');
  if (operation === 'deploy') {
    requireValue(deployEnabled === true, 'ENABLE_FINANCE_PRODUCTION_DEPLOY must be true for a production deploy');
  }
  requireValue(/^[0-9a-f-]{36}$/i.test(d1Id), 'FINANCE_D1_PRODUCTION_ID is missing or malformed');
  requireValue(/^[0-9a-f]{32}$/i.test(controlKvId), 'FINANCE_CONTROL_PRODUCTION_KV_ID is missing or malformed');
  requireValue(githubBackupPassphrasePresent, 'FINANCE_BACKUP_PASSPHRASE is missing from the production environment');
  requireValue(githubServiceSecretPresent, 'FINANCE_SERVICE_AUTH_SECRET is missing from the production environment');

  requireValue(d1?.uuid === d1Id && d1?.name === D1_NAME, 'production D1 id/name does not match skincos-finance');
  requireValue(kv?.id === controlKvId && kv?.title === KV_TITLE, 'production Finance KV id/title does not match the canonical resource');

  const dbBinding = binding(financeSettings, 'DB');
  requireValue(
    dbBinding?.type === 'd1' &&
      (dbBinding.id === d1Id || dbBinding.database_id === d1Id),
    'skincos-finance DB binding does not match the production D1',
  );
  const moduleControlBinding = binding(financeSettings, 'MODULE_CONTROL');
  requireValue(
    moduleControlBinding?.type === 'kv_namespace' && moduleControlBinding.namespace_id === controlKvId,
    'skincos-finance MODULE_CONTROL binding does not match the production KV',
  );
  const environmentBinding = binding(financeSettings, 'ENVIRONMENT');
  requireValue(
    environmentBinding?.type === 'plain_text' && environmentBinding.text === 'production',
    'skincos-finance ENVIRONMENT binding is not production',
  );
  requireValue(
    secretNames(financeSecrets).has(SERVICE_SECRET_NAME),
    'skincos-finance is missing the remote FINANCE_SERVICE_AUTH_SECRET',
  );
  requireValue(deployments(financeDeployments).length > 0, 'skincos-finance has no deployed rollback baseline');
  requireValue(financeSubdomain?.enabled === true, 'skincos-finance workers.dev endpoint is not enabled');
  requireValue(
    typeof accountSubdomain?.subdomain === 'string' && /^[a-z0-9-]+$/i.test(accountSubdomain.subdomain),
    'Cloudflare Workers account subdomain is unavailable',
  );

  const apiFinanceBinding = binding(apiSettings, 'FINANCE');
  requireValue(
    apiFinanceBinding?.type === 'service' &&
      apiFinanceBinding.service === WORKER_NAME &&
      (!apiFinanceBinding.environment || apiFinanceBinding.environment === 'production'),
    'skincos-api FINANCE binding does not target the production Finance Worker',
  );
  requireValue(
    secretNames(apiSecrets).has(SERVICE_SECRET_NAME),
    'skincos-api is missing the remote FINANCE_SERVICE_AUTH_SECRET',
  );

  const workerUrl = `https://${WORKER_NAME}.${accountSubdomain.subdomain}.workers.dev`;
  return {
    schemaVersion: 1,
    result: 'passed',
    target: 'production',
    operation,
    releaseSha,
    authorization: {
      deployFlagEnabled: operation === 'deploy' ? true : null,
      rollbackDoesNotRequireDeployFlag: operation === 'rollback',
    },
    resources: {
      worker: WORKER_NAME,
      d1: D1_NAME,
      controlKv: KV_TITLE,
      workerDeploymentBaselinePresent: true,
      workersDevEnabled: true,
    },
    bindings: {
      financeDbMatches: true,
      financeModuleControlMatches: true,
      financeEnvironmentIsProduction: true,
      apiFinanceServiceMatches: true,
    },
    secrets: {
      githubBackupPassphrasePresent: true,
      githubServiceSecretPresent: true,
      financeRemoteServiceSecretPresent: true,
      apiRemoteServiceSecretPresent: true,
      valuesReadOrEmitted: false,
    },
    workerUrl,
  };
}

function cloudflareClient({ accountId, apiToken, fetchImpl = fetch }) {
  const baseUrl = `https://api.cloudflare.com/client/v4/accounts/${accountId}`;
  return async (relativePath, label) => {
    const response = await fetchImpl(`${baseUrl}${relativePath}`, {
      headers: {
        authorization: `Bearer ${apiToken}`,
        accept: 'application/json',
      },
    });
    let payload;
    try {
      payload = await response.json();
    } catch {
      throw new Error(`${label} returned a non-JSON response (HTTP ${response.status})`);
    }
    if (!response.ok || payload?.success !== true) {
      const codes = (payload?.errors || []).map((entry) => entry?.code).filter(Boolean).join(',');
      throw new Error(`${label} failed (HTTP ${response.status}${codes ? `, Cloudflare ${codes}` : ''})`);
    }
    return payload.result;
  };
}

export async function runFinanceProductionPreflight({
  env = process.env,
  fetchImpl = fetch,
} = {}) {
  const accountId = requireValue(env.CLOUDFLARE_ACCOUNT_ID?.trim(), 'CLOUDFLARE_ACCOUNT_ID is missing');
  const apiToken = requireValue(env.CLOUDFLARE_API_TOKEN?.trim(), 'CLOUDFLARE_API_TOKEN is missing');
  requireValue(/^[0-9a-f]{32}$/i.test(accountId), 'CLOUDFLARE_ACCOUNT_ID is malformed');
  const d1Id = env.FINANCE_D1_PRODUCTION_ID?.trim() || '';
  const controlKvId = env.FINANCE_CONTROL_PRODUCTION_KV_ID?.trim() || '';
  requireValue(/^[0-9a-f-]{36}$/i.test(d1Id), 'FINANCE_D1_PRODUCTION_ID is missing or malformed');
  requireValue(/^[0-9a-f]{32}$/i.test(controlKvId), 'FINANCE_CONTROL_PRODUCTION_KV_ID is missing or malformed');

  const get = cloudflareClient({ accountId, apiToken, fetchImpl });
  const [
    d1,
    kv,
    financeSettings,
    financeSecrets,
    financeDeployments,
    financeSubdomain,
    accountSubdomain,
    apiSettings,
    apiSecrets,
  ] = await Promise.all([
    get(`/d1/database/${encodeURIComponent(d1Id)}`, 'production Finance D1 inventory'),
    get(`/storage/kv/namespaces/${encodeURIComponent(controlKvId)}`, 'production Finance KV inventory'),
    get(`/workers/scripts/${WORKER_NAME}/settings`, 'production Finance Worker settings'),
    get(`/workers/scripts/${WORKER_NAME}/secrets`, 'production Finance Worker secret inventory'),
    get(`/workers/scripts/${WORKER_NAME}/deployments`, 'production Finance Worker deployment inventory'),
    get(`/workers/scripts/${WORKER_NAME}/subdomain`, 'production Finance Worker subdomain'),
    get('/workers/subdomain', 'Cloudflare Workers account subdomain'),
    get(`/workers/scripts/${API_WORKER_NAME}/settings`, 'production API Worker settings'),
    get(`/workers/scripts/${API_WORKER_NAME}/secrets`, 'production API Worker secret inventory'),
  ]);

  return validateFinanceProductionPreflight({
    operation: env.OPERATION?.trim() || '',
    releaseSha: env.RELEASE_SHA?.trim() || '',
    deployEnabled: env.ENABLE_FINANCE_PRODUCTION_DEPLOY?.trim() === 'true',
    d1Id,
    controlKvId,
    githubBackupPassphrasePresent: Boolean(env.FINANCE_BACKUP_PASSPHRASE),
    githubServiceSecretPresent: Boolean(env.FINANCE_SERVICE_AUTH_SECRET),
    d1,
    kv,
    financeSettings,
    financeSecrets,
    financeDeployments,
    financeSubdomain,
    accountSubdomain,
    apiSettings,
    apiSecrets,
  });
}

async function main() {
  const reportPath = process.argv[2];
  requireValue(reportPath, 'usage: node finance-production-preflight.mjs <report-path>');
  let report;
  let failure;
  try {
    report = await runFinanceProductionPreflight();
  } catch (error) {
    failure = error;
    report = {
      schemaVersion: 1,
      result: 'failed',
      target: 'production',
      operation: process.env.OPERATION || null,
      releaseSha: process.env.RELEASE_SHA || null,
      error: error instanceof Error ? error.message : String(error),
      secretsEmitted: false,
    };
  }
  await mkdir(path.dirname(reportPath), { recursive: true });
  await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 });
  if (!failure && process.env.GITHUB_ENV) {
    await appendFile(process.env.GITHUB_ENV, `FINANCE_PRODUCTION_WORKER_URL=${report.workerUrl}\n`, { mode: 0o600 });
  }
  process.stdout.write(`${JSON.stringify({ ...report, workerUrl: report.workerUrl ? '[attested]' : undefined })}\n`);
  if (failure) throw failure;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    process.stderr.write(`Finance production preflight failed: ${error.message}\n`);
    process.exitCode = 1;
  });
}
