import { spawnSync } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const SHA_PATTERN = /^[0-9a-f]{40}$/;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const EXPECTED_BASELINE_SHA = '0f3480dce1a170ac0f862fa392a95456af292a88';
const EXPECTED_SUBJECT_SUFFIX = '(#912)';
const EXPECTED_CHANGED_FILES = Object.freeze([
  'api/src/router.js',
  'api/test/gateway.test.mjs',
  'api/workers/ponto.js',
  'api/wrangler.ponto.toml',
]);
const TARGETS = Object.freeze({
  staging: {
    worker: 'skincos-ponto-core-staging',
    timekeeping: 'skincos-timekeeping-staging',
  },
  production: {
    worker: 'skincos-ponto-core',
    timekeeping: 'skincos-timekeeping',
  },
});

function requireValue(value, message) {
  if (!value) throw new Error(message);
  return value;
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd,
    env: options.env,
    encoding: 'utf8',
    stdio: options.stdio ?? ['ignore', 'pipe', 'pipe'],
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    const detail = [result.stderr, result.stdout]
      .map((value) => String(value || '').trim())
      .filter(Boolean)
      .join('\n');
    throw new Error(`${command} ${args.join(' ')} failed${detail ? `: ${detail}` : ''}`);
  }
  return String(result.stdout || '').trim();
}

function git(sourceDir, ...args) {
  return run('git', ['-C', sourceDir, ...args]);
}

function normalizeBindings(bindings) {
  requireValue(Array.isArray(bindings), 'active Worker version does not expose a binding inventory');
  const byName = new Map();
  for (const binding of bindings) {
    if (binding && typeof binding.name === 'string') byName.set(binding.name, binding);
  }
  return byName;
}

function plainText(bindings, name) {
  const binding = bindings.get(name);
  return binding?.type === 'plain_text' ? binding.text : undefined;
}

function serviceName(bindings, name) {
  const binding = bindings.get(name);
  return binding?.type === 'service' ? binding.service : undefined;
}

function deploymentList(result) {
  if (Array.isArray(result)) return result;
  return Array.isArray(result?.deployments) ? result.deployments : [];
}

function latestDeployment(result) {
  return [...deploymentList(result)].sort(
    (left, right) => Date.parse(String(right?.created_on || '')) - Date.parse(String(left?.created_on || '')),
  )[0];
}

function domainList(result) {
  if (Array.isArray(result)) return result;
  return Array.isArray(result?.domains) ? result.domains : [];
}

export function validateBaselineSourceFacts({
  baselineSha,
  headSha,
  ancestorOfMain,
  subject,
  parentCount,
  changedFiles,
  config,
}) {
  requireValue(SHA_PATTERN.test(baselineSha), 'baseline_sha must be a full lowercase commit SHA');
  requireValue(baselineSha === EXPECTED_BASELINE_SHA, 'baseline_sha must be the exact merged PR #912 squash SHA');
  requireValue(headSha === baselineSha, 'checked-out source does not match baseline_sha');
  requireValue(ancestorOfMain === true, 'baseline_sha is not reachable from origin/main');
  requireValue(parentCount === 1, 'the #912 baseline must be a single-parent squash commit');
  requireValue(
    typeof subject === 'string' && subject.endsWith(EXPECTED_SUBJECT_SUFFIX),
    'baseline_sha is not the squash commit produced by PR #912',
  );
  requireValue(
    JSON.stringify([...changedFiles].sort()) === JSON.stringify([...EXPECTED_CHANGED_FILES].sort()),
    `baseline_sha must change only: ${EXPECTED_CHANGED_FILES.join(', ')}`,
  );
  requireValue(/^name = "skincos-ponto-core"$/m.test(config), 'production Ponto Core Worker name is missing');
  requireValue(
    /^\[env\.staging\]\r?\nname = "skincos-ponto-core-staging"$/m.test(config),
    'staging Ponto Core Worker name is missing',
  );
  requireValue(/^main = "workers\/ponto\.js"$/m.test(config), 'private Ponto Core entrypoint is missing');
  requireValue(
    (config.match(/^workers_dev = false$/gm) || []).length === 2,
    'workers.dev must be disabled in both environments',
  );
  requireValue(
    (config.match(/^preview_urls = false$/gm) || []).length === 2,
    'preview URLs must be disabled in both environments',
  );
  requireValue(!/^\s*(?:route|routes)\s*=/m.test(config), 'Ponto Core baseline must not declare public routes');
  requireValue(
    (config.match(/^PONTO_ROUTE_ONLY = "true"$/gm) || []).length === 2,
    'PONTO_ROUTE_ONLY must be true in both environments',
  );
  requireValue(
    /^service = "skincos-timekeeping"$/m.test(config) &&
      /^service = "skincos-timekeeping-staging"$/m.test(config),
    'Ponto Core must use environment-specific private Timekeeping service bindings',
  );

  return {
    baselineSha,
    subject,
    parentCount,
    changedFiles: [...changedFiles].sort(),
    privateSurface: {
      workersDev: false,
      previewUrls: false,
      routeDeclarations: 0,
      routeOnly: true,
    },
  };
}

export function validateRemoteBaseline({
  baselineSha,
  target,
  script,
  routeInventory,
  deploymentsResult,
  subdomain,
  domainsResult,
  version,
}) {
  const expected = requireValue(TARGETS[target], 'target must be staging or production');
  requireValue(script?.id === expected.worker, `Worker inventory does not contain ${expected.worker}`);

  requireValue(
    Number.isInteger(routeInventory?.zoneCount) && routeInventory.zoneCount > 0,
    'account-wide Worker route inventory is absent',
  );
  requireValue(
    Array.isArray(routeInventory?.matches) && routeInventory.matches.length === 0,
    `${expected.worker} has public Worker routes`,
  );

  const domains = domainList(domainsResult).filter(
    (entry) => entry?.service === expected.worker || entry?.script === expected.worker,
  );
  requireValue(domains.length === 0, `${expected.worker} has a public custom domain`);
  requireValue(subdomain?.enabled === false, `${expected.worker} workers.dev endpoint is enabled`);
  requireValue(subdomain?.previews_enabled === false, `${expected.worker} preview URLs are enabled`);

  const active = requireValue(latestDeployment(deploymentsResult), `${expected.worker} has no active deployment`);
  requireValue(UUID_PATTERN.test(active.id || ''), `${expected.worker} active deployment id is malformed`);
  requireValue(
    Array.isArray(active.versions) &&
      active.versions.length === 1 &&
      active.versions[0]?.percentage === 100,
    `${expected.worker} must have exactly one active version at 100%`,
  );
  const activeVersionId = active.versions[0]?.version_id;
  requireValue(UUID_PATTERN.test(activeVersionId || ''), `${expected.worker} active version id is malformed`);
  requireValue(version?.id === activeVersionId, `${expected.worker} active version detail does not match deployment`);
  const expectedMessage = `ponto-core-baseline:${baselineSha}`;
  requireValue(
    version.annotations?.['workers/message'] === expectedMessage,
    `${expected.worker} version is not the requested immutable baseline`,
  );

  const bindings = normalizeBindings(version?.resources?.bindings);
  requireValue(plainText(bindings, 'APP_VERSION') === baselineSha, `${expected.worker} APP_VERSION does not match`);
  requireValue(plainText(bindings, 'ENVIRONMENT') === target, `${expected.worker} ENVIRONMENT does not match`);
  requireValue(plainText(bindings, 'PONTO_ROUTE_ONLY') === 'true', `${expected.worker} is not route-only`);
  requireValue(
    serviceName(bindings, 'TIMEKEEPING') === expected.timekeeping,
    `${expected.worker} TIMEKEEPING binding does not match ${target}`,
  );
  requireValue(
    bindings.get('CF_VERSION_METADATA')?.type === 'version_metadata',
    `${expected.worker} lacks the version metadata binding`,
  );

  return {
    worker: expected.worker,
    target,
    activeDeploymentId: active.id,
    activeVersionId,
    activeVersions: [{ versionId: activeVersionId, percentage: 100 }],
    versionMessage: expectedMessage,
    appVersion: baselineSha,
    environment: target,
    timekeepingService: expected.timekeeping,
    routeOnly: true,
    exposure: {
      workerRouteCount: 0,
      zonesInspected: routeInventory.zoneCount,
      customDomainCount: 0,
      workersDevEnabled: false,
      previewUrlsEnabled: false,
    },
  };
}

export async function inspectBaselineSource({ sourceDir, baselineSha, fetchMain = true }) {
  requireValue(SHA_PATTERN.test(baselineSha), 'baseline_sha must be a full lowercase commit SHA');
  const resolvedSource = path.resolve(sourceDir);
  if (fetchMain) git(resolvedSource, 'fetch', '--no-tags', 'origin', 'main');
  const headSha = git(resolvedSource, 'rev-parse', 'HEAD');
  const ancestor = spawnSync(
    'git',
    ['-C', resolvedSource, 'merge-base', '--is-ancestor', baselineSha, 'origin/main'],
    { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
  );
  if (ancestor.error) throw ancestor.error;
  if (![0, 1].includes(ancestor.status)) {
    throw new Error(`git merge-base failed: ${String(ancestor.stderr || '').trim()}`);
  }
  const parentLine = git(resolvedSource, 'rev-list', '--parents', '-n', '1', baselineSha);
  const subject = git(resolvedSource, 'show', '-s', '--format=%s', baselineSha);
  const changedFiles = git(
    resolvedSource,
    'diff-tree',
    '--no-commit-id',
    '--name-only',
    '-r',
    `${baselineSha}^`,
    baselineSha,
  )
    .split(/\r?\n/)
    .filter(Boolean);
  const config = await readFile(path.join(resolvedSource, 'api/wrangler.ponto.toml'), 'utf8');

  return validateBaselineSourceFacts({
    baselineSha,
    headSha,
    ancestorOfMain: ancestor.status === 0,
    subject,
    parentCount: parentLine.split(/\s+/).length - 1,
    changedFiles,
    config,
  });
}

function cloudflareClient({ accountId, apiToken, fetchImpl = fetch }) {
  const apiBase = 'https://api.cloudflare.com/client/v4';
  return async (pathname, label, query = {}) => {
    const url = new URL(`${apiBase}${pathname}`);
    for (const [name, value] of Object.entries(query)) {
      if (value !== undefined && value !== null && value !== '') url.searchParams.set(name, String(value));
    }
    const response = await fetchImpl(url, {
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
      const codes = (payload?.errors || [])
        .map((entry) => entry?.code)
        .filter(Boolean)
        .join(',');
      throw new Error(`${label} failed (HTTP ${response.status}${codes ? `, Cloudflare ${codes}` : ''})`);
    }
    return {
      result: payload.result,
      resultInfo: payload.result_info || null,
    };
  };
}

async function paginatedList(get, pathname, label, query = {}) {
  const items = [];
  let page = 1;
  let expectedTotal = null;
  while (page <= 100) {
    const payload = await get(pathname, label, { ...query, page, per_page: 100 });
    requireValue(Array.isArray(payload.result), `${label} is malformed`);
    items.push(...payload.result);
    const info = payload.resultInfo;
    if (Number.isInteger(info?.total_count)) expectedTotal = info.total_count;
    const totalPages = Number(info?.total_pages || 0);
    if ((totalPages > 0 && page >= totalPages) || (expectedTotal !== null && items.length >= expectedTotal)) break;
    if (!info || payload.result.length === 0 || payload.result.length < 100) break;
    page += 1;
  }
  requireValue(expectedTotal === null || items.length === expectedTotal, `${label} pagination is incomplete`);
  return items;
}

async function publicExposureSnapshot({ get, accountId, worker }) {
  const zones = await paginatedList(get, '/zones', 'Account zone inventory', { 'account.id': accountId });
  requireValue(zones.length > 0, 'account zone inventory is empty');
  requireValue(
    zones.every(zone => /^[0-9a-f]{32}$/i.test(String(zone?.id || '')) && zone?.account?.id === accountId),
    'account zone inventory is malformed or crosses accounts',
  );
  const routeMatches = [];
  for (const zone of zones) {
    const routes = await get(`/zones/${encodeURIComponent(zone.id)}/workers/routes`, `${zone.name} Worker route inventory`);
    requireValue(Array.isArray(routes.result), `${zone.name} Worker route inventory is malformed`);
    for (const route of routes.result) {
      if (route?.script === worker || route?.service === worker) {
        routeMatches.push({ zoneId: zone.id, routeId: route.id || null, pattern: route.pattern || null });
      }
    }
  }
  const domains = await paginatedList(
    get,
    `/accounts/${encodeURIComponent(accountId)}/workers/domains`,
    'Worker custom-domain inventory',
  );
  const domainMatches = domains.filter(entry => entry?.service === worker || entry?.script === worker);
  return {
    zoneCount: zones.length,
    matches: routeMatches,
    domainsResult: domainMatches,
  };
}

export async function remoteSnapshot({ accountId, apiToken, baselineSha, target, fetchImpl = fetch }) {
  const expected = TARGETS[target];
  const get = cloudflareClient({ accountId, apiToken, fetchImpl });
  const scriptsResponse = await get(`/accounts/${encodeURIComponent(accountId)}/workers/scripts`, 'Worker inventory');
  const scripts = scriptsResponse.result;
  requireValue(Array.isArray(scripts), 'Cloudflare Worker inventory is malformed');
  const exposure = await publicExposureSnapshot({ get, accountId, worker: expected.worker });
  requireValue(exposure.matches.length === 0, `${expected.worker} has public Worker routes`);
  requireValue(exposure.domainsResult.length === 0, `${expected.worker} has a public custom domain`);
  const script = scripts.find((entry) => entry?.id === expected.worker);
  if (!script) {
    return {
      exists: false,
      worker: expected.worker,
      target,
      exposure: {
        workerRouteCount: 0,
        customDomainCount: 0,
        zonesInspected: exposure.zoneCount,
      },
    };
  }

  const [deploymentsResponse, subdomainResponse] = await Promise.all([
    get(
      `/accounts/${encodeURIComponent(accountId)}/workers/scripts/${encodeURIComponent(expected.worker)}/deployments`,
      `${expected.worker} deployments`,
    ),
    get(
      `/accounts/${encodeURIComponent(accountId)}/workers/scripts/${encodeURIComponent(expected.worker)}/subdomain`,
      `${expected.worker} subdomain`,
    ),
  ]);
  const deploymentsResult = deploymentsResponse.result;
  const subdomain = subdomainResponse.result;
  const active = latestDeployment(deploymentsResult);
  const activeVersionId = active?.versions?.[0]?.version_id;
  requireValue(activeVersionId, `${expected.worker} has no resolvable active version`);
  const versionResponse = await get(
    `/accounts/${encodeURIComponent(accountId)}/workers/scripts/${encodeURIComponent(expected.worker)}/versions/${encodeURIComponent(activeVersionId)}`,
    `${expected.worker} active version`,
  );
  const version = versionResponse.result;
  const attestation = validateRemoteBaseline({
    baselineSha,
    target,
    script,
    routeInventory: exposure,
    deploymentsResult,
    subdomain,
    domainsResult: exposure.domainsResult,
    version,
  });
  return { exists: true, worker: expected.worker, target, attestation };
}

async function writeArtifacts(directory, report, journal) {
  await mkdir(directory, { recursive: true });
  await Promise.all([
    writeFile(path.join(directory, 'evidence.json'), `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 }),
    writeFile(
      path.join(directory, 'mutation-journal.json'),
      `${JSON.stringify({ schemaVersion: 1, entries: journal }, null, 2)}\n`,
      { mode: 0o600 },
    ),
  ]);
}

function event(journal, name, details = {}) {
  journal.push({
    at: new Date().toISOString(),
    event: name,
    ...details,
  });
}

async function retryAttestation(operation, attempts = 12, delayMs = 5000) {
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;
      if (attempt < attempts) await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }
  throw lastError;
}

async function publishBaseline({ sourceDir, artifactDir, env = process.env, fetchImpl = fetch }) {
  const baselineSha = env.BASELINE_SHA?.trim() || '';
  const target = env.TARGET?.trim() || '';
  const expected = requireValue(TARGETS[target], 'TARGET must be staging or production');
  const report = {
    schemaVersion: 1,
    result: 'incomplete',
    purpose: 'private-ponto-core-rollback-baseline',
    baselineSha: baselineSha || null,
    workflowControlSha: env.WORKFLOW_CONTROL_SHA?.trim() || null,
    target: target || null,
    worker: expected.worker,
    authorization: {
      explicitConfirmation: env.CONFIRM_BOOTSTRAP === 'true',
    },
    mutation: {
      attempted: false,
      performed: false,
      resourceDeletionAttempted: false,
    },
    secrets: {
      CLOUDFLARE_API_TOKEN: Boolean(env.CLOUDFLARE_API_TOKEN),
      CLOUDFLARE_ACCOUNT_ID: Boolean(env.CLOUDFLARE_ACCOUNT_ID),
      valuesEmitted: false,
    },
  };
  const journal = [];
  let failure;
  try {
    event(journal, 'publisher_started', { target, worker: expected.worker, baselineSha });
    requireValue(env.CONFIRM_BOOTSTRAP === 'true', `explicit ${target} bootstrap confirmation is required`);
    const accountId = requireValue(env.CLOUDFLARE_ACCOUNT_ID?.trim(), 'CLOUDFLARE_ACCOUNT_ID is missing');
    const apiToken = requireValue(env.CLOUDFLARE_API_TOKEN?.trim(), 'CLOUDFLARE_API_TOKEN is missing');
    requireValue(/^[0-9a-f]{32}$/i.test(accountId), 'CLOUDFLARE_ACCOUNT_ID is malformed');

    report.source = await inspectBaselineSource({ sourceDir, baselineSha });
    event(journal, 'immutable_source_attested', {
      baselineSha,
      changedFiles: report.source.changedFiles,
    });

    const before = await remoteSnapshot({ accountId, apiToken, baselineSha, target, fetchImpl });
    report.before = before.exists
      ? { exists: true, exactBaseline: true, attestation: before.attestation }
      : { exists: false, exactBaseline: false, exposure: before.exposure };
    if (before.exists) {
      report.result = 'passed';
      report.outcome = 'idempotent-attestation';
      report.after = { exists: true, attestation: before.attestation };
      event(journal, 'existing_worker_exactly_attested', {
        deploymentId: before.attestation.activeDeploymentId,
        versionId: before.attestation.activeVersionId,
      });
      return report;
    }

    event(journal, 'remote_worker_absent');
    report.mutation.attempted = true;
    event(journal, 'wrangler_deploy_started', {
      semantics: 'first private deployment at 100 percent',
      resourceDeletionAllowed: false,
    });
    const wrangler =
      process.platform === 'win32'
        ? path.join(path.resolve(sourceDir), 'api/node_modules/.bin/wrangler.cmd')
        : path.join(path.resolve(sourceDir), 'api/node_modules/.bin/wrangler');
    const args = [
      'deploy',
      '--config',
      'api/wrangler.ponto.toml',
      '--keep-vars',
      '--message',
      `ponto-core-baseline:${baselineSha}`,
      '--var',
      `APP_VERSION:${baselineSha}`,
      '--var',
      `ENVIRONMENT:${target}`,
      '--var',
      'PONTO_ROUTE_ONLY:true',
    ];
    if (target === 'staging') args.push('--env', 'staging');
    run(wrangler, args, {
      cwd: path.resolve(sourceDir),
      env: {
        ...env,
        CLOUDFLARE_API_TOKEN: apiToken,
        CLOUDFLARE_ACCOUNT_ID: accountId,
      },
      stdio: 'inherit',
    });
    report.mutation.performed = true;
    event(journal, 'wrangler_deploy_completed');

    const after = await retryAttestation(() =>
      remoteSnapshot({ accountId, apiToken, baselineSha, target, fetchImpl }),
    );
    requireValue(after.exists, `${expected.worker} was not found after deployment`);
    report.after = { exists: true, attestation: after.attestation };
    report.result = 'passed';
    report.outcome = 'created-and-attested';
    event(journal, 'control_plane_attestation_passed', {
      deploymentId: after.attestation.activeDeploymentId,
      versionId: after.attestation.activeVersionId,
      percentage: 100,
      publicTargets: 0,
    });
    return report;
  } catch (error) {
    failure = error;
    report.result = 'failed';
    report.error = error instanceof Error ? error.message : String(error);
    event(journal, 'publisher_failed', { error: report.error });
    throw error;
  } finally {
    report.finishedAt = new Date().toISOString();
    event(journal, 'publisher_finished', {
      result: report.result,
      mutationPerformed: report.mutation.performed,
      resourceDeletionAttempted: false,
    });
    await writeArtifacts(artifactDir, report, journal);
    if (failure) {
      process.stderr.write(`Ponto Core baseline publisher failed: ${report.error}\n`);
    } else {
      process.stdout.write(
        `${JSON.stringify({
          result: report.result,
          outcome: report.outcome,
          target: report.target,
          worker: report.worker,
          baselineSha: report.baselineSha,
          mutationPerformed: report.mutation.performed,
        })}\n`,
      );
    }
  }
}

async function validateCommand({ sourceDir, artifactDir, env = process.env }) {
  const baselineSha = env.BASELINE_SHA?.trim() || '';
  const journal = [];
  const report = {
    schemaVersion: 1,
    result: 'incomplete',
    purpose: 'private-ponto-core-rollback-baseline-validation',
    baselineSha: baselineSha || null,
    workflowControlSha: env.WORKFLOW_CONTROL_SHA?.trim() || null,
    mutation: {
      attempted: false,
      performed: false,
      resourceDeletionAttempted: false,
    },
    secrets: {
      valuesRead: false,
      valuesEmitted: false,
    },
  };
  let failure;
  try {
    event(journal, 'source_validation_started', { baselineSha });
    report.source = await inspectBaselineSource({ sourceDir, baselineSha });
    report.result = 'source-attested';
    event(journal, 'immutable_source_attested', {
      baselineSha,
      changedFiles: report.source.changedFiles,
    });
    return report;
  } catch (error) {
    failure = error;
    report.result = 'failed';
    report.error = error instanceof Error ? error.message : String(error);
    event(journal, 'source_validation_failed', { error: report.error });
    throw error;
  } finally {
    report.finishedAt = new Date().toISOString();
    event(journal, 'source_validation_finished', { result: report.result });
    await writeArtifacts(artifactDir, report, journal);
    if (failure) process.stderr.write(`Ponto Core baseline source validation failed: ${report.error}\n`);
  }
}

async function main() {
  const [command, sourceDir, artifactDir] = process.argv.slice(2);
  requireValue(
    ['validate', 'publish'].includes(command) && sourceDir && artifactDir,
    'usage: node ponto-core-baseline-publisher.mjs <validate|publish> <source-dir> <artifact-dir>',
  );
  if (command === 'validate') {
    await validateCommand({ sourceDir, artifactDir });
  } else {
    await publishBaseline({ sourceDir, artifactDir });
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  });
}
