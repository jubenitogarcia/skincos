import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import {
  PRIVATE_CANDIDATE_REQUEST_CONFIRMATION,
  PREFLIGHT_ENVIRONMENT,
  evaluateCrmPrivateProductionCandidatePreflight,
  runCrmPrivateProductionCandidatePreflight,
} from './crm-private-production-candidate-preflight.mjs';

const root = path.resolve(import.meta.dirname, '../..');
const sha = 'a'.repeat(40);
const coreSha = 'b'.repeat(40);
const digest = 'c'.repeat(64);

const identityManifest = `
name = "skincos-identity-crm-delivery-production"
main = "delivery/crm-issuer-production-worker.js"
workers_dev = false
preview_urls = false
[vars]
IDENTITY_CRM_DELIVERY_ENABLED = "false"
IDENTITY_CRM_DELIVERY_ENVIRONMENT = "production"
IDENTITY_CRM_DELIVERY_PRODUCTION_ISSUER_ENABLED = "false"
IDENTITY_CRM_DELIVERY_PRODUCTION_ROUTE_RECEIPT_RESOLVER_ENABLED = "false"
`;

const apiManifest = `
name = "skincos-api"
workers_dev = false
preview_urls = false
[vars]
CRM_CORE_PRODUCTION_ENABLED = "false"
CRM_IDENTITY_ISSUER_CALLER_ENABLED = "false"
CRM_IDENTITY_ISSUER_CALLER_ID = "crm-api-production-v1"
[env.staging]
name = "skincos-api-staging"
[[env.staging.services]]
binding = "IDENTITY_CRM_ISSUER"
service = "skincos-identity-crm-delivery-staging"
`;

const workflowSource = `
name: CRM private production candidate preflight
on:
  workflow_dispatch:
jobs:
  preflight:
    environment: crm-production-candidate-preflight
`;

function identityReadback() {
  return {
    owner: 'Identity',
    workerName: 'skincos-identity-crm-delivery-production',
    result: 'eligible-for-approved-cutover',
    state: 'eligible',
    readOnly: {
      mutationsAttempted: false,
      productionDeploymentAttempted: false,
      secretValuesReadOrEmitted: false,
      piiReadOrEmitted: false,
    },
    cloudflare: {
      credentials: { accountIdPresent: true, apiTokenPresent: true },
      settings: 'available',
      deployments: 'available',
      secrets: 'available',
      subdomain: 'available',
      routeInventory: 'available',
      customDomains: 'available',
      workerSettings: {
        workersDev: false,
        requiredRuntimeBindings: {},
      },
      routeReadback: { count: 0 },
      customDomainReadback: { count: 0 },
      secretInventory: {
        types: {
          IDENTITY_CRM_DELIVERY_PRODUCTION_KID: 'secret_text',
          IDENTITY_CRM_DELIVERY_PRODUCTION_SIGNING_KEY: 'secret_key',
          IDENTITY_CRM_DELIVERY_PRODUCTION_PUBLIC_JWK: 'secret_text',
          IDENTITY_CRM_DELIVERY_PRODUCTION_CALLER_HMAC: 'secret_text',
        },
        keyMetadata: {
          IDENTITY_CRM_DELIVERY_PRODUCTION_SIGNING_KEY: { algorithm: 'Ed25519', usages: ['sign'] },
        },
      },
    },
  };
}

function environment(overrides = {}) {
  return {
    GITHUB_REPOSITORY: 'jubenitogarcia/skincos',
    GITHUB_EVENT_NAME: 'workflow_dispatch',
    GITHUB_REF: 'refs/heads/main',
    GITHUB_SHA: sha,
    GITHUB_WORKFLOW_REF: 'jubenitogarcia/skincos/.github/workflows/crm-private-production-candidate-preflight.yml@refs/heads/main',
    GITHUB_RUN_ATTEMPT: '1',
    CRM_PRIVATE_CANDIDATE_OPERATION: 'preflight',
    CRM_PRIVATE_CANDIDATE_SOURCE_SHA: sha,
    CRM_PRIVATE_CANDIDATE_OBSERVED_MAIN_SHA: sha,
    CRM_PRIVATE_CANDIDATE_CORE_SOURCE_SHA: coreSha,
    CRM_PRIVATE_CANDIDATE_CORE_ARTIFACT_DIGEST: digest,
    CRM_PRIVATE_CANDIDATE_IDENTITY_CUSTODY_ATTESTED: 'true',
    CRM_PRIVATE_CANDIDATE_CORE_SOURCE_CUSTODY_ATTESTED: 'true',
    ...overrides,
  };
}

test('preflight produces a sanitized source-only plan and never admits a publisher', () => {
  const report = evaluateCrmPrivateProductionCandidatePreflight({
    env: environment(),
    identityReadiness: identityReadback(),
    identityManifest,
    apiManifest,
    workflowSource,
  });
  assert.equal(report.result, 'preflight-complete-source-only');
  assert.equal(report.publisher.admitted, false);
  assert.equal(report.readOnly.mutationsAttempted, false);
  assert.equal(report.singleWriterPolicy.classification, 'non-publishing-preflight');
  assert.equal(report.singleWriterPolicy.futurePublisherRequiresPolicyAdmission, true);
  assert.equal(report.candidateRoles.I.publicTraffic, 'forbidden');
  assert.equal(report.candidateRoles.C.owner, 'jubenitogarcia/skincos-crm-core');
  assert.ok(report.explicitlyOutOfScope.includes('identity-resolver-R'));
  assert.ok(report.externalGates.deferredBeforeResolverReceiptOrActivation.includes('pontoSeparated'));
  assert.doesNotMatch(JSON.stringify(report), /private-value-that-must-never-leave-custody/);
});

test('source custody rejects an automatic event, ref drift, stale main and missing workflow custody', () => {
  const report = evaluateCrmPrivateProductionCandidatePreflight({
    env: environment({
      GITHUB_EVENT_NAME: 'push',
      GITHUB_REF: 'refs/heads/codex/untrusted',
      CRM_PRIVATE_CANDIDATE_OBSERVED_MAIN_SHA: 'd'.repeat(40),
      GITHUB_WORKFLOW_REF: '',
      GITHUB_RUN_ATTEMPT: '',
    }),
    identityReadiness: identityReadback(),
    identityManifest,
    apiManifest,
    workflowSource,
  });
  assert.equal(report.result, 'blocked');
  assert.ok(report.blockers.includes('workflow event is not workflow_dispatch'));
  assert.ok(report.blockers.includes('workflow ref is not main'));
  assert.ok(report.blockers.includes('requested source SHA is not the observed main tip'));
  assert.ok(report.blockers.includes('workflow source is not pinned to main'));
  assert.ok(report.blockers.includes('only the first manual run attempt is admissible'));
});

test('Identity custody must retain the existing readiness eligibility', () => {
  const report = evaluateCrmPrivateProductionCandidatePreflight({
    env: environment(),
    identityReadiness: { ...identityReadback(), state: 'blocked' },
    identityManifest,
    apiManifest,
    workflowSource,
  });
  assert.equal(report.result, 'blocked');
  assert.ok(report.blockers.includes('Identity production readiness is not eligible for the source-only candidate preflight'));
});

test('a request for private candidates cannot become a publisher', () => {
  const report = evaluateCrmPrivateProductionCandidatePreflight({
    env: environment({
      CRM_PRIVATE_CANDIDATE_OPERATION: 'request-private-inert-candidates',
      CRM_PRIVATE_CANDIDATE_CONFIRMATION: PRIVATE_CANDIDATE_REQUEST_CONFIRMATION,
      CRM_PRIVATE_CANDIDATE_PONTO_SEPARATED_ATTESTED: 'true',
      CRM_PRIVATE_CANDIDATE_BACKFILL_RECONCILED_ATTESTED: 'true',
      CRM_PRIVATE_CANDIDATE_SINGLE_PUBLISHER_ATTESTED: 'true',
    }),
    identityReadiness: identityReadback(),
    identityManifest,
    apiManifest,
    workflowSource,
  });
  assert.equal(report.result, 'blocked');
  assert.ok(report.blockers.includes('private candidate publisher is intentionally not admitted by this source-only workflow'));
  assert.equal(report.publisher.generalPublishersUsed, false);
});

test('checked-in manifests retain the same source-only candidate contract', async () => {
  const report = await runCrmPrivateProductionCandidatePreflight({
    root,
    env: environment(),
    identityReadiness: identityReadback(),
  });
  assert.equal(report.result, 'preflight-complete-source-only');
  assert.equal(report.manifests.state, 'valid');
  assert.equal(report.manifests.normalGatewayIdentityBindingDeferred, true);
});

test('manifest safety rejects enabled routes, credential material and a general publisher reference', () => {
  const report = evaluateCrmPrivateProductionCandidatePreflight({
    env: environment(),
    identityReadiness: identityReadback(),
    identityManifest: identityManifest
      .replace('IDENTITY_CRM_DELIVERY_ENABLED = "false"', 'IDENTITY_CRM_DELIVERY_ENABLED = "true"')
      .concat('\nroutes = ["crm.skincos.com.br/*"]\nIDENTITY_CRM_DELIVERY_PRODUCTION_SIGNING_KEY = "forbidden"\n'),
    apiManifest: apiManifest.replace('CRM_CORE_PRODUCTION_ENABLED = "false"', 'CRM_CORE_PRODUCTION_ENABLED = "true"'),
    workflowSource: `${workflowSource}\n# deploy-core-workers.yml\n`,
  });
  assert.equal(report.result, 'blocked');
  assert.ok(report.blockers.some((blocker) => blocker.includes('Identity production candidate manifest declares a route')));
  assert.ok(report.blockers.some((blocker) => blocker.includes('credential material')));
  assert.ok(report.blockers.some((blocker) => blocker.includes('general publisher')));
});

test('the checked-in workflow is manual, dedicated-environment-gated and has no mutation command', async () => {
  const workflow = await readFile(path.join(root, '.github/workflows/crm-private-production-candidate-preflight.yml'), 'utf8');
  assert.match(workflow, /workflow_dispatch:/);
  assert.match(workflow, new RegExp(`environment: ${PREFLIGHT_ENVIRONMENT}`));
  assert.match(workflow, /identity-crm-production-readiness\.mjs/);
  assert.match(workflow, /crm-private-production-candidate-preflight\.mjs/);
  assert.doesNotMatch(workflow, /^\s*(?:push|pull_request|schedule):/m);
  assert.doesNotMatch(workflow, /deploy-core-workers\.yml|deploy-crm-pages\.yml/);
  assert.doesNotMatch(workflow, /\bwrangler\b|cloudflare\.com\/client\/v4.*(?:POST|PUT|PATCH|DELETE)/i);
  assert.doesNotMatch(workflow, /IDENTITY_CRM_DELIVERY_PRODUCTION_SIGNING_KEY:\s*[^$\n]/);
});
