import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

export const CANONICAL_REPOSITORY = 'jubenitogarcia/skincos';
export const CANONICAL_BRANCH = 'main';
export const CORE_REPOSITORY = 'jubenitogarcia/skincos-crm-core';
export const WORKFLOW_PATH = '.github/workflows/crm-private-production-candidate-preflight.yml';
export const PREFLIGHT_ENVIRONMENT = 'crm-production-candidate-preflight';
export const SINGLE_WRITER_POLICY_PATH = '.github/governance/cloudflare-single-writer-policy.json';
export const IDENTITY_MANIFEST_PATH = 'identity/wrangler.production.toml';
export const API_MANIFEST_PATH = 'api/wrangler.toml';
export const PRIVATE_CANDIDATE_REQUEST_CONFIRMATION = 'request-private-inert-crm-candidates';

const SHA = /^[0-9a-f]{40}$/i;
const DIGEST = /^(?:sha256:)?[0-9a-f]{64}$/i;
const SAFE_IDENTIFIER = /^[A-Za-z0-9._:/-]{1,200}$/;
const REQUESTED_OPERATIONS = new Set(['preflight', 'request-private-inert-candidates']);
const DEDICATED_IDENTITY_READBACK_SECRET_NAMES = Object.freeze([
  'CRM_IDENTITY_READBACK_API_TOKEN',
  'CRM_IDENTITY_READBACK_ACCOUNT_ID',
]);
const DEDICATED_IDENTITY_READBACK_SOURCE = 'crm-identity-readback';
const REQUIRED_IDENTITY_SECRETS = Object.freeze({
  IDENTITY_CRM_DELIVERY_PRODUCTION_KID: 'secret_text',
  IDENTITY_CRM_DELIVERY_PRODUCTION_SIGNING_KEY: 'secret_key',
  IDENTITY_CRM_DELIVERY_PRODUCTION_PUBLIC_JWK: 'secret_text',
  IDENTITY_CRM_DELIVERY_PRODUCTION_CALLER_HMAC: 'secret_text',
});

function text(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function isTrue(value) {
  return text(value).toLowerCase() === 'true';
}

function safeIdentifier(value) {
  const normalized = text(value);
  return SAFE_IDENTIFIER.test(normalized) ? normalized : null;
}

function safeSha(value) {
  const normalized = text(value).toLowerCase();
  return SHA.test(normalized) ? normalized : null;
}

function safeDigest(value) {
  const normalized = text(value).toLowerCase();
  if (!DIGEST.test(normalized)) return null;
  return normalized.startsWith('sha256:') ? normalized.slice('sha256:'.length) : normalized;
}

function boundedCount(value) {
  return Number.isSafeInteger(value) && value >= 0 && value <= 100_000 ? value : null;
}

function hasExactLine(source, line) {
  return String(source)
    .split(/\r?\n/)
    .some((candidate) => candidate.trim() === line);
}

function productionSection(source) {
  const boundary = source.search(/^\[env\.staging\]/m);
  return boundary === -1 ? source : source.slice(0, boundary);
}

function tomlAssignments(source, section = null) {
  const assignments = new Map();
  let active = section === null;
  for (const rawLine of String(source).split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    if (line.startsWith('[') && line.endsWith(']')) {
      active = section !== null && line === `[${section}]`;
      continue;
    }
    if (!active) continue;
    const delimiter = line.indexOf('=');
    if (delimiter <= 0) continue;
    const key = line.slice(0, delimiter).trim();
    const value = line.slice(delimiter + 1).trim();
    if (/^[A-Za-z0-9_.-]+$/.test(key)) assignments.set(key, value);
  }
  return assignments;
}

function effectiveTomlValue(source, { key, baseSection = null, overrideSection }) {
  const base = tomlAssignments(source, baseSection);
  const override = tomlAssignments(source, overrideSection);
  return override.has(key) ? override.get(key) : base.get(key);
}

function hasExpectedEffectiveTomlValue(source, options) {
  return effectiveTomlValue(source, options) === options.expected;
}

function manifestContract({ identityManifest = '', apiManifest = '', workflowSource = '' } = {}) {
  const blockers = [];
  const identity = String(identityManifest || '');
  const api = String(apiManifest || '');
  const workflow = String(workflowSource || '');
  const identityRequiredValues = [
    { key: 'name', expected: '"skincos-identity-crm-delivery-production"', overrideSection: 'env.production' },
    { key: 'workers_dev', expected: 'false', overrideSection: 'env.production' },
    { key: 'preview_urls', expected: 'false', overrideSection: 'env.production' },
    { key: 'IDENTITY_CRM_DELIVERY_ENABLED', expected: '"false"', baseSection: 'vars', overrideSection: 'env.production.vars' },
    { key: 'IDENTITY_CRM_DELIVERY_ENVIRONMENT', expected: '"production"', baseSection: 'vars', overrideSection: 'env.production.vars' },
    { key: 'IDENTITY_CRM_DELIVERY_PRODUCTION_ISSUER_ENABLED', expected: '"false"', baseSection: 'vars', overrideSection: 'env.production.vars' },
    { key: 'IDENTITY_CRM_DELIVERY_PRODUCTION_ROUTE_RECEIPT_RESOLVER_ENABLED', expected: '"false"', baseSection: 'vars', overrideSection: 'env.production.vars' },
  ];
  for (const requirement of identityRequiredValues) {
    if (!hasExpectedEffectiveTomlValue(identity, requirement)) {
      blockers.push(`Identity production manifest has an unsafe effective value for ${requirement.key}`);
    }
  }
  if (/^\s*routes\s*=/m.test(identity) || /^\s*route\s*=/m.test(identity)) {
    blockers.push('Identity production candidate manifest declares a route');
  }
  if (/^\s*\[\[.*(?:d1_databases|kv_namespaces|r2_buckets|services).*\]\]/m.test(identity)) {
    blockers.push('Identity production candidate manifest declares a data or service binding');
  }
  if (/IDENTITY_CRM_DELIVERY_PRODUCTION_(?:SIGNING_KEY|CALLER_HMAC|PUBLIC_JWK)\s*=\s*['"][^'"\s]+/m.test(identity)) {
    blockers.push('Identity production manifest contains credential material');
  }

  const apiProduction = productionSection(api);
  for (const line of [
    'name = "skincos-api"',
    'workers_dev = false',
    'preview_urls = false',
    'CRM_CORE_PRODUCTION_ENABLED = "false"',
    'CRM_IDENTITY_ISSUER_CALLER_ENABLED = "false"',
    'CRM_IDENTITY_ISSUER_CALLER_ID = "crm-api-production-v1"',
  ]) {
    if (!hasExactLine(apiProduction, line)) blockers.push(`API production manifest is missing its inert contract: ${line}`);
  }
  if (/binding\s*=\s*"IDENTITY_CRM_ISSUER"/m.test(apiProduction)) {
    blockers.push('normal API production manifest already binds the private Identity issuer');
  }

  if (!/^on:\s*\n\s+workflow_dispatch:/m.test(workflow)) {
    blockers.push('candidate preflight workflow must be dispatch-only');
  }
  if (/^\s*(?:push|pull_request|schedule):/m.test(workflow)) {
    blockers.push('candidate preflight workflow has an automatic trigger');
  }
  if (!new RegExp(`environment:\\s*${PREFLIGHT_ENVIRONMENT}`).test(workflow)) {
    blockers.push('candidate preflight workflow is not protected by the dedicated preflight environment');
  }
  for (const name of DEDICATED_IDENTITY_READBACK_SECRET_NAMES) {
    if (!workflow.includes(`secrets.${name}`)) {
      blockers.push(`candidate preflight workflow is missing the dedicated Identity readback credential ${name}`);
    }
  }
  if (!new RegExp(`IDENTITY_CRM_PRODUCTION_READBACK_CREDENTIAL_SOURCE:\\s*${DEDICATED_IDENTITY_READBACK_SOURCE}`).test(workflow)) {
    blockers.push('candidate preflight workflow does not select the dedicated Identity readback credential source');
  }
  if (/secrets\.CLOUDFLARE_(?:API_TOKEN|ACCOUNT_ID)/.test(workflow)) {
    blockers.push('candidate preflight workflow references a generic Cloudflare credential');
  }
  if (/deploy-core-workers\.yml|deploy-crm-pages\.yml/.test(workflow)) {
    blockers.push('candidate preflight workflow invokes a general publisher');
  }
  if (/\bwrangler\b|cloudflare\.com\/client\/v4.*(?:POST|PUT|PATCH|DELETE)|\b(?:routes?|pages|versions)\s+(?:deploy|upload)\b/i.test(workflow)) {
    blockers.push('candidate preflight workflow contains a Cloudflare mutation path');
  }

  return Object.freeze({
    state: blockers.length === 0 ? 'valid' : 'blocked',
    blockers,
    sourceOnly: true,
    generalPublishersReferenced: false,
  });
}

function summarizeIdentityReadback(report) {
  const source = report && typeof report === 'object' && !Array.isArray(report) ? report : {};
  const cloudflare = source.cloudflare && typeof source.cloudflare === 'object' ? source.cloudflare : {};
  const inventory = cloudflare.secretInventory && typeof cloudflare.secretInventory === 'object'
    ? cloudflare.secretInventory
    : {};
  const secretTypes = inventory.types && typeof inventory.types === 'object' ? inventory.types : {};
  const keyMetadata = inventory.keyMetadata && typeof inventory.keyMetadata === 'object' ? inventory.keyMetadata : {};
  const bindingStates = cloudflare.workerSettings?.requiredRuntimeBindings && typeof cloudflare.workerSettings.requiredRuntimeBindings === 'object'
    ? cloudflare.workerSettings.requiredRuntimeBindings
    : {};
  const requiredSecrets = Object.fromEntries(Object.entries(REQUIRED_IDENTITY_SECRETS).map(([name, expectedType]) => [
    name,
    secretTypes[name] === expectedType ? 'matches' : secretTypes[name] ? 'wrong-type' : 'missing',
  ]));
  const signingKey = keyMetadata.IDENTITY_CRM_DELIVERY_PRODUCTION_SIGNING_KEY;
  const signingKeyMetadataMatches = signingKey?.algorithm === 'Ed25519'
    && Array.isArray(signingKey.usages)
    && signingKey.usages.length === 1
    && signingKey.usages[0] === 'sign';
  return Object.freeze({
    readinessResult: safeIdentifier(source.result),
    readinessState: safeIdentifier(source.state),
    owner: safeIdentifier(source.owner),
    readbackAvailable: source?.cloudflare?.credentials?.accountIdPresent === true
      && source?.cloudflare?.credentials?.apiTokenPresent === true,
    workerName: safeIdentifier(source.workerName),
    state: safeIdentifier(source.state),
    settings: safeIdentifier(cloudflare.settings),
    deployments: safeIdentifier(cloudflare.deployments),
    secrets: safeIdentifier(cloudflare.secrets),
    subdomain: safeIdentifier(cloudflare.subdomain),
    routeInventory: safeIdentifier(cloudflare.routeInventory),
    customDomains: safeIdentifier(cloudflare.customDomains),
    workersDevDisabled: cloudflare.workerSettings?.workersDev === false,
    routes: boundedCount(cloudflare.routeReadback?.count),
    customDomainCount: boundedCount(cloudflare.customDomainReadback?.count),
    requiredSecrets,
    signingKeyMetadataMatches,
    resolverReceiptSecretPresent: secretTypes.IDENTITY_CRM_CORE_PRODUCTION_ROUTE_RECEIPT !== undefined,
    readOnly: source.readOnly?.mutationsAttempted === false
      && source.readOnly?.productionDeploymentAttempted === false
      && source.readOnly?.secretValuesReadOrEmitted === false
      && source.readOnly?.piiReadOrEmitted === false,
    runtimeBindingStates: Object.fromEntries([
      'IDENTITY_CRM_DELIVERY_ENABLED',
      'IDENTITY_CRM_DELIVERY_ENVIRONMENT',
      'IDENTITY_CRM_DELIVERY_PRODUCTION_CALLER_ENABLED',
      'IDENTITY_CRM_DELIVERY_PRODUCTION_CALLER_ID',
    ].map((name) => [name, safeIdentifier(bindingStates[name]) || 'unavailable'])),
  });
}

function identityCustodyBlockers(summary) {
  const blockers = [];
  if (summary.readinessResult !== 'eligible-for-approved-cutover' || summary.readinessState !== 'eligible') {
    blockers.push('Identity production readiness is not eligible for the source-only candidate preflight');
  }
  if (summary.owner !== 'Identity') blockers.push('Identity custody report does not identify the Identity owner');
  if (!summary.readbackAvailable) blockers.push('Identity Cloudflare custody readback is unavailable');
  if (summary.workerName !== 'skincos-identity-crm-delivery-production') {
    blockers.push('Identity readback is not for the canonical production Worker');
  }
  for (const state of ['settings', 'secrets', 'subdomain', 'routeInventory', 'customDomains']) {
    if (summary[state] !== 'available') blockers.push(`Identity ${state} readback is unavailable`);
  }
  if (!summary.workersDevDisabled) blockers.push('Identity workers.dev state is not proven disabled');
  if (summary.routes !== 0) blockers.push('Identity route inventory is not proven empty');
  if (summary.customDomainCount !== 0) blockers.push('Identity custom-domain inventory is not proven empty');
  for (const [name, state] of Object.entries(summary.requiredSecrets)) {
    if (state !== 'matches') blockers.push(`Identity custody lacks the required secret metadata for ${name}`);
  }
  if (!summary.signingKeyMetadataMatches) blockers.push('Identity signing key is not proven Ed25519 sign-only');
  if (summary.resolverReceiptSecretPresent) {
    blockers.push('Identity resolver receipt material is already present; I and R must remain separate');
  }
  if (!summary.readOnly) blockers.push('Identity custody report is not proven read-only');
  return blockers;
}

function externalGates(env) {
  return Object.freeze({
    identityCustodyAttested: isTrue(env.CRM_PRIVATE_CANDIDATE_IDENTITY_CUSTODY_ATTESTED),
    coreSourceCustodyAttested: isTrue(env.CRM_PRIVATE_CANDIDATE_CORE_SOURCE_CUSTODY_ATTESTED),
    pontoSeparated: isTrue(env.CRM_PRIVATE_CANDIDATE_PONTO_SEPARATED_ATTESTED),
    backfillReconciled: isTrue(env.CRM_PRIVATE_CANDIDATE_BACKFILL_RECONCILED_ATTESTED),
    singlePublisher: isTrue(env.CRM_PRIVATE_CANDIDATE_SINGLE_PUBLISHER_ATTESTED),
  });
}

function sourceContext(env) {
  return Object.freeze({
    repository: safeIdentifier(env.GITHUB_REPOSITORY),
    eventName: safeIdentifier(env.GITHUB_EVENT_NAME),
    ref: safeIdentifier(env.GITHUB_REF),
    githubSha: safeSha(env.GITHUB_SHA),
    checkedOutSha: safeSha(env.CRM_PRIVATE_CANDIDATE_CHECKED_OUT_SHA),
    observedMainSha: safeSha(env.CRM_PRIVATE_CANDIDATE_OBSERVED_MAIN_SHA),
    sourceSha: safeSha(env.CRM_PRIVATE_CANDIDATE_SOURCE_SHA),
    workflowRef: text(env.GITHUB_WORKFLOW_REF),
    runAttempt: text(env.GITHUB_RUN_ATTEMPT),
  });
}

function sourceContextBlockers(context) {
  const blockers = [];
  if (context.repository !== CANONICAL_REPOSITORY) blockers.push('workflow repository is not canonical');
  if (context.eventName !== 'workflow_dispatch') blockers.push('workflow event is not workflow_dispatch');
  if (context.ref !== `refs/heads/${CANONICAL_BRANCH}`) blockers.push('workflow ref is not main');
  if (!context.sourceSha || !context.githubSha || context.sourceSha !== context.githubSha) {
    blockers.push('requested source SHA does not equal the checked-out GitHub SHA');
  }
  if (!context.observedMainSha || context.observedMainSha !== context.sourceSha) {
    blockers.push('requested source SHA is not the observed main tip');
  }
  if (!context.checkedOutSha
    || context.checkedOutSha !== context.githubSha
    || context.checkedOutSha !== context.sourceSha
    || context.checkedOutSha !== context.observedMainSha) {
    blockers.push('checked-out source SHA is not bound to GitHub, requested and observed main SHA');
  }
  if (context.workflowRef !== `${CANONICAL_REPOSITORY}/${WORKFLOW_PATH}@refs/heads/${CANONICAL_BRANCH}`) {
    blockers.push('workflow source is not pinned to main');
  }
  if (context.runAttempt !== '1') blockers.push('only the first manual run attempt is admissible');
  return blockers;
}

function coreHandoff(env) {
  return Object.freeze({
    ownerRepository: CORE_REPOSITORY,
    sourceSha: safeSha(env.CRM_PRIVATE_CANDIDATE_CORE_SOURCE_SHA),
    artifactDigest: safeDigest(env.CRM_PRIVATE_CANDIDATE_CORE_ARTIFACT_DIGEST),
    state: 'independent-owner-required',
  });
}

export function evaluateCrmPrivateProductionCandidatePreflight({
  env = {},
  identityReadiness = null,
  identityManifest = '',
  apiManifest = '',
  workflowSource = '',
} = {}) {
  const blockers = [];
  const operation = text(env.CRM_PRIVATE_CANDIDATE_OPERATION || 'preflight');
  const context = sourceContext(env);
  const manifests = manifestContract({ identityManifest, apiManifest, workflowSource });
  const identity = summarizeIdentityReadback(identityReadiness);
  const gates = externalGates(env);
  const core = coreHandoff(env);

  if (!REQUESTED_OPERATIONS.has(operation)) blockers.push('candidate operation is not recognized');
  blockers.push(...sourceContextBlockers(context));
  blockers.push(...manifests.blockers);
  blockers.push(...identityCustodyBlockers(identity));
  if (!core.sourceSha) blockers.push('independent Core source SHA is absent or malformed');
  if (!core.artifactDigest) blockers.push('independent Core artifact digest is absent or malformed');
  if (!gates.identityCustodyAttested) blockers.push('Identity custody attestation is absent');
  if (!gates.coreSourceCustodyAttested) blockers.push('independent Core source custody attestation is absent');

  if (operation === 'request-private-inert-candidates') {
    if (text(env.CRM_PRIVATE_CANDIDATE_CONFIRMATION) !== PRIVATE_CANDIDATE_REQUEST_CONFIRMATION) {
      blockers.push('private candidate request lacks the exact confirmation');
    }
    blockers.push('private candidate publisher is intentionally not admitted by this source-only workflow');
  }

  // Ponto, data reconciliation and publisher ownership are deliberately not
  // treated as an approval to create a version here. They are recorded so a
  // later, separately reviewed publisher cannot turn missing external work
  // into an implicit authorization for R, the receipt or traffic activation.
  const deferredGates = Object.entries({
    pontoSeparated: gates.pontoSeparated,
    backfillReconciled: gates.backfillReconciled,
    singlePublisher: gates.singlePublisher,
  }).filter(([, value]) => !value).map(([name]) => name);

  return Object.freeze({
    schemaVersion: 1,
    result: blockers.length === 0 ? 'preflight-complete-source-only' : 'blocked',
    state: blockers.length === 0 ? 'preflight-complete' : 'blocked',
    operation: safeIdentifier(operation) || null,
    source: {
      repository: context.repository,
      branch: context.ref === `refs/heads/${CANONICAL_BRANCH}` ? CANONICAL_BRANCH : null,
      sourceSha: context.sourceSha,
      checkedOutSha: context.checkedOutSha,
      observedMainSha: context.observedMainSha,
      workflowPinnedToMain: !sourceContextBlockers(context).includes('workflow source is not pinned to main'),
    },
    readOnly: {
      sourceOnly: true,
      mutationsAttempted: false,
      productionDeploymentAttempted: false,
      routeMutationAttempted: false,
      pagesMutationAttempted: false,
      databaseMutationAttempted: false,
      secretValuesReadOrEmitted: false,
      piiReadOrEmitted: false,
    },
    manifests: {
      state: manifests.state,
      identity: IDENTITY_MANIFEST_PATH,
      gateway: API_MANIFEST_PATH,
      normalGatewayIdentityBindingDeferred: !/binding\s*=\s*"IDENTITY_CRM_ISSUER"/m.test(productionSection(String(apiManifest || ''))),
    },
    singleWriterPolicy: {
      path: SINGLE_WRITER_POLICY_PATH,
      classification: 'non-publishing-preflight',
      cloudflareMutationAuthority: false,
      futurePublisherRequiresPolicyAdmission: true,
    },
    identityCustody: identity,
    core,
    candidateRoles: {
      I: {
        owner: 'monorepo/Identity',
        worker: 'skincos-identity-crm-delivery-production',
        state: 'future-private-inert-version-only',
        publicTraffic: 'forbidden',
      },
      C: {
        owner: CORE_REPOSITORY,
        worker: 'skincos-crm-core',
        state: 'independent-repository-candidate-required',
        publicTraffic: 'forbidden',
      },
      G: {
        owner: 'monorepo/API',
        worker: 'skincos-api',
        state: 'future-private-inert-version-only',
        publicTraffic: 'forbidden',
      },
    },
    externalGates: {
      ...gates,
      deferredBeforeResolverReceiptOrActivation: deferredGates,
    },
    explicitlyOutOfScope: [
      'identity-resolver-R',
      'signed-route-receipt',
      'traffic-activation',
      'routes-or-custom-domains',
      'Cloudflare-Pages',
      'D1-or-migrations',
      'customer-data-or-backfill-execution',
      'legacy-runtime-retirement',
    ],
    publisher: {
      admitted: false,
      reason: 'This workflow performs only source and custody preflight. A future publisher requires its own reviewed admission.',
      generalPublishersUsed: false,
    },
    blockers: [...new Set(blockers)],
  });
}

async function readJson(file) {
  if (!file) return null;
  try {
    return JSON.parse(await readFile(path.resolve(file), 'utf8'));
  } catch {
    return null;
  }
}

async function sourceFiles(root) {
  const read = async (relative) => {
    try {
      return await readFile(path.join(root, relative), 'utf8');
    } catch {
      return '';
    }
  };
  return {
    identityManifest: await read(IDENTITY_MANIFEST_PATH),
    apiManifest: await read(API_MANIFEST_PATH),
    workflowSource: await read(WORKFLOW_PATH),
  };
}

export async function runCrmPrivateProductionCandidatePreflight({
  env = process.env,
  root = process.cwd(),
  identityReadiness = undefined,
} = {}) {
  const identity = identityReadiness === undefined
    ? await readJson(text(env.IDENTITY_CRM_PRODUCTION_READINESS_REPORT))
    : identityReadiness;
  const files = await sourceFiles(root);
  return evaluateCrmPrivateProductionCandidatePreflight({ env, identityReadiness: identity, ...files });
}

async function writeReport(reportPath, report) {
  await mkdir(path.dirname(reportPath), { recursive: true });
  await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 });
}

async function main() {
  const reportPath = text(process.env.CRM_PRIVATE_CANDIDATE_PREFLIGHT_REPORT)
    || path.join(process.cwd(), 'crm-private-production-candidate-preflight.json');
  const report = await runCrmPrivateProductionCandidatePreflight();
  await writeReport(reportPath, report);
  process.stdout.write(`${JSON.stringify(report)}\n`);
  if (report.result !== 'preflight-complete-source-only') {
    process.exitCode = 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().catch(() => {
    process.exitCode = 1;
  });
}
