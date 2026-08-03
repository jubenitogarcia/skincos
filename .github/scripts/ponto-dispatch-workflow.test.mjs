import assert from "node:assert/strict";
import crypto from "node:crypto";
import test from "node:test";
import {
  assertMainShaUnchanged,
  dispatchTimeoutMsFor,
  governedLeaseKeyFor,
  isBodylessResponseStatus,
  readGitHubResponse,
  verifyConsumedCapabilityCheck,
} from "./ponto-dispatch-workflow.mjs";
import {
  createCapabilityCheck,
  transitionCapabilityDocument,
} from "./ponto-orchestrator-lease.mjs";
import fs from "node:fs";

test("production SLO dispatch budget covers protected preflight, clinic observation, and runner admission", () => {
  assert.equal(dispatchTimeoutMsFor("ponto-production-slo.yml", 20 * 60 * 1000), 65 * 60 * 1000);
  assert.equal(dispatchTimeoutMsFor("timekeeping-staging-journey.yml", 20 * 60 * 1000), 35 * 60 * 1000);
  assert.equal(dispatchTimeoutMsFor("unknown.yml", 20 * 60 * 1000), 20 * 60 * 1000);
});

test("GitHub dispatch and cancellation acknowledgements are treated as bodyless success", () => {
  for (const status of [202, 204]) {
    assert.equal(isBodylessResponseStatus(status), true);
    assert.equal(readGitHubResponse({
      status,
      json() {
        assert.fail(`response.json() must not be called for HTTP ${status}`);
      },
    }), null);
  }
  assert.equal(isBodylessResponseStatus(200), false);
});

test("preview dispatches never require a capability while every governed mutation stage does", () => {
  assert.equal(governedLeaseKeyFor("deploy-timekeeping.yml", {
    target: "preview",
    release_scope: "ponto",
  }), "");
  assert.equal(governedLeaseKeyFor("deploy-core-workers.yml", {
    target: "preview",
    release_scope: "ponto",
    unit: "api",
  }), "");
  assert.equal(governedLeaseKeyFor("deploy-crm-pages.yml", {
    target: "preview",
    release_scope: "ponto",
  }), "");
  for (const target of ["staging", "pilot", "canary", "production", "rollback"]) {
    assert.equal(governedLeaseKeyFor("deploy-timekeeping.yml", {
      target,
      release_scope: "ponto",
    }), "timekeeping");
    assert.equal(governedLeaseKeyFor("deploy-core-workers.yml", {
      target,
      release_scope: "ponto",
      unit: "api",
    }), "core-api");
    assert.equal(governedLeaseKeyFor("deploy-core-workers.yml", {
      target,
      release_scope: "ponto",
      unit: "inventory",
    }), "core-inventory");
    assert.equal(governedLeaseKeyFor("deploy-crm-pages.yml", {
      target,
      release_scope: "ponto",
    }), "pages");
  }
  assert.equal(governedLeaseKeyFor("deploy-core-workers.yml", {
    target: "production",
    release_scope: "general",
    unit: "api",
  }), "");
});

test("child dispatch refuses a coordinator SHA after main advances", () => {
  const sha = "a".repeat(40);
  assert.equal(assertMainShaUnchanged(sha, sha.toUpperCase()), sha);
  assert.throws(
    () => assertMainShaUnchanged(sha, "b".repeat(40)),
    /main advanced after the immutable Ponto coordinator was selected/,
  );
});

test("governed success requires one exact Ed25519-consumed capability check", () => {
  const pair = crypto.generateKeyPairSync("ed25519");
  const privateKey = pair.privateKey.export({ type: "pkcs8", format: "pem" });
  const publicKey = pair.publicKey.export({ type: "spki", format: "pem" });
  const repository = "owner/repo";
  const repositoryId = "123";
  const releaseSha = "a".repeat(40);
  const claims = {
    privateKey,
    keyId: "staging-dispatch-test",
    repositoryId,
    repository,
    parentWorkflowId: 10,
    parentWorkflowPath: ".github/workflows/ponto-progressive-release.yml",
    parentRunId: "42",
    issuerWorkflowId: 10,
    issuerWorkflowPath: ".github/workflows/ponto-progressive-release.yml",
    issuerRunId: "42",
    childWorkflowId: 11,
    childWorkflowPath: ".github/workflows/deploy-timekeeping.yml",
    childRunId: "99",
    leaseKey: "timekeeping",
    stage: "staging",
    target: "staging",
    releaseSha,
    dispatchNonce: "b".repeat(32),
    intentDigest: "c".repeat(64),
  };
  const issued = createCapabilityCheck(claims);
  const issuedDocument = JSON.parse(issued.output.summary);
  const consumedDocument = transitionCapabilityDocument(issuedDocument, {
    state: "consumed",
  });
  const exact = {
    id: 500,
    ...issued,
    status: "completed",
    conclusion: "success",
    app: { id: 15368, slug: "github-actions" },
    output: {
      title: "Ponto single-use child capability consumed",
      summary: JSON.stringify(consumedDocument),
    },
  };
  const options = {
    checkRuns: [exact],
    detail: exact,
    expectedCheckId: exact.id,
    expectedAppId: exact.app.id,
    checkName: issued.name,
    externalId: issued.external_id,
    releaseSha,
    documentClaims: {
      ...claims,
      publicKey,
      privateKey: undefined,
    },
  };
  assert.equal(verifyConsumedCapabilityCheck(options).state, "consumed");
  assert.throws(
    () => verifyConsumedCapabilityCheck({ ...options, checkRuns: [exact, { ...exact, id: 501 }] }),
    /absent or ambiguous/,
  );
  assert.throws(
    () => verifyConsumedCapabilityCheck({
      ...options,
      detail: { ...exact, output: { ...exact.output, summary: issued.output.summary } },
    }),
    /claims or Ed25519 signature differ/,
  );
  const tampered = structuredClone(consumedDocument);
  tampered.claims.leaseKey = "core-api";
  assert.throws(
    () => verifyConsumedCapabilityCheck({
      ...options,
      detail: { ...exact, output: { ...exact.output, summary: JSON.stringify(tampered) } },
    }),
    /claims or Ed25519 signature differ/,
  );
});

test("private signing custody is never persisted or inherited by direct rollback drill commands", () => {
  const progressive = fs.readFileSync(
    new URL("../workflows/ponto-progressive-release.yml", import.meta.url),
    "utf8",
  );
  const drillWorkflow = fs.readFileSync(
    new URL("../workflows/ponto-staging-rollback-drill.yml", import.meta.url),
    "utf8",
  );
  const drillScript = fs.readFileSync(
    new URL("./ponto-staging-rollback-drill.mjs", import.meta.url),
    "utf8",
  );
  assert.doesNotMatch(
    progressive,
    /PONTO_ORCHESTRATOR_CAPABILITY_PRIVATE_KEY=.*>>\s*["']?\$GITHUB_ENV/,
  );
  const exercise = drillWorkflow.slice(
    drillWorkflow.indexOf("- name: Exercise exact incumbents"),
    drillWorkflow.indexOf("- name: Upload immutable staging rollback"),
  );
  assert.doesNotMatch(exercise, /PONTO_ORCHESTRATOR_CAPABILITY_PRIVATE_KEY/);
  assert.match(drillWorkflow, /concurrency:\s*\n(?:\s*#[^\n]*\n)*[\s\S]*?group:\s*ponto-surface-mutation/);
  assert.doesNotMatch(drillWorkflow, /delegated-capability-broker:|INCUMBENT_DISPATCH_NONCE:|CANDIDATE_DISPATCH_NONCE:/);
  assert.match(drillScript, /delete childEnv\.PONTO_ORCHESTRATOR_CAPABILITY_PRIVATE_KEY/);
  assert.doesNotMatch(
    drillScript.replace(/delete childEnv\.PONTO_ORCHESTRATOR_CAPABILITY_PRIVATE_KEY;/, ""),
    /PONTO_ORCHESTRATOR_CAPABILITY_PRIVATE_KEY|delegatedCapability/,
  );
  assert.match(drillScript, /mutation:\s*"direct-signed-drill"/);
  assert.match(drillScript, /module-control:timekeeping:emergency-latch/);
  assert.match(drillScript, /value\?\.latched !== false/);
  assert.doesNotMatch(drillScript, /createCapabilityCheck|capabilityExternalId/);
});

test("current Pages and Ponto mutators are fenced from legacy repository controls", () => {
  const readWorkflow = (name) => fs.readFileSync(
    new URL(`../workflows/${name}`, import.meta.url),
    "utf8",
  );
  const currentPagesMutators = [
    "cloudflare-pages-audit.yml",
    "cloudflare-pages-sync-escala.yml",
    "cloudflare-pages-sync-meta-ads-report-secret.yml",
    "cloudflare-sync-integrations-encryption-secret.yml",
    "codex-autonomy-preflight.yml",
    "deploy-crm-pages.yml",
  ];
  for (const workflow of currentPagesMutators) {
    const source = readWorkflow(workflow);
    assert.doesNotMatch(
      source,
      /vars\.CLOUDFLARE_PAGES_PROJECT(?:_STAGING)?\b/,
      `${workflow} must not consume a legacy Pages project control`,
    );
  }

  for (const workflow of [
    "cloudflare-pages-audit.yml",
    "cloudflare-pages-sync-escala.yml",
    "cloudflare-pages-sync-meta-ads-report-secret.yml",
    "cloudflare-sync-integrations-encryption-secret.yml",
    "codex-autonomy-preflight.yml",
  ]) {
    assert.match(readWorkflow(workflow), /vars\.CRM_PAGES_PROJECT\b/);
  }

  const sharedPages = readWorkflow("deploy-crm-pages.yml");
  for (const name of [
    "CRM_PAGES_PROJECT",
    "CRM_PAGES_PROJECT_STAGING",
    "PONTO_CLOUDFLARE_PAGES_PROJECT",
    "PONTO_CLOUDFLARE_PAGES_PROJECT_STAGING",
    "ENABLE_PONTO_CRM_PAGES_DEPLOY",
    "ENABLE_PONTO_CRM_PAGES_DEPLOY_STAGING",
    "PONTO_MODULE_CONTROL_PRODUCTION_KV_ID",
    "PONTO_MODULE_CONTROL_STAGING_KV_ID",
  ]) {
    assert.match(sharedPages, new RegExp(`vars\\.${name}\\b`));
  }

  const pontoSources = [
    "cloudflare-pages-sync-ponto.yml",
    "cloudflare-workers-sync-ponto-secrets.yml",
    "deploy-timekeeping.yml",
    "ponto-production-baseline.yml",
    "ponto-production-slo.yml",
    "ponto-progressive-release.yml",
    "ponto-staging-rollback-drill.yml",
  ].map(readWorkflow).join("\n");
  for (const legacy of [
    /vars\.TIMEKEEPING_D1_(?:STAGING|PRODUCTION)_ID\b/,
    /vars\.MODULE_CONTROL_(?:STAGING|PRODUCTION)_KV_ID\b/,
    /vars\.ENABLE_TIMEKEEPING_PRODUCTION_DEPLOY\b/,
    /vars\.CLOUDFLARE_PAGES_PROJECT(?:_STAGING)?\b/,
  ]) {
    assert.doesNotMatch(pontoSources, legacy);
  }
  for (const current of [
    "PONTO_TIMEKEEPING_D1_STAGING_ID",
    "PONTO_TIMEKEEPING_D1_PRODUCTION_ID",
    "PONTO_MODULE_CONTROL_STAGING_KV_ID",
    "PONTO_MODULE_CONTROL_PRODUCTION_KV_ID",
    "PONTO_CLOUDFLARE_PAGES_PROJECT_STAGING",
    "PONTO_CLOUDFLARE_PAGES_PROJECT",
  ]) {
    assert.match(pontoSources, new RegExp(`vars\\.${current}\\b`));
  }

  const core = readWorkflow("deploy-core-workers.yml");
  assert.match(core, /vars\.ENABLE_PONTO_CORE_WORKERS_DEPLOY\b/);
  const timekeeping = readWorkflow("deploy-timekeeping.yml");
  assert.match(timekeeping, /vars\.ENABLE_PONTO_TIMEKEEPING_PRODUCTION_DEPLOY\b/);
  const stagingJourney = readWorkflow("timekeeping-staging-journey.yml");
  assert.match(stagingJourney, /vars\.PONTO_TIMEKEEPING_D1_STAGING_ID\b/);
  assert.match(stagingJourney, /TIMEKEEPING_STAGING_WRANGLER_CONFIG/);
  assert.match(stagingJourney, /--json > "\$CORE_RAW"/);
  assert.match(stagingJourney, /ponto-json-output\.mjs/);
  assert.match(stagingJourney, /for attempt in \$\(seq 1 12\)/);
  assert.match(stagingJourney, /bounded propagation/);
  assert.match(stagingJourney, /PIN attestation query command failed/);
  assert.match(stagingJourney, /PIN attestation query or credential contract failed/);
  assert.match(stagingJourney, /import crypto from "node:crypto";/);
  assert.match(stagingJourney, /import fs from "node:fs";/);
  assert.doesNotMatch(
    stagingJourney,
    /d1 execute \"\$STAGING_TIMEKEEPING_D1_DATABASE\" --config workforce\/timekeeping\/wrangler\.toml/,
  );
  const journey = fs.readFileSync(
    new URL("./ponto-production-journey.mjs", import.meta.url),
    "utf8",
  );
  const automaticRollback = fs.readFileSync(
    new URL("./ponto-automatic-rollback.mjs", import.meta.url),
    "utf8",
  );
  assert.doesNotMatch(journey, /CLOUDFLARE_PAGES_PROJECT\s*\|\|\s*["']skincos["']/);
  assert.doesNotMatch(automaticRollback, /CLOUDFLARE_PAGES_PROJECT\s*\|\|\s*["']skincos["']/);
});
