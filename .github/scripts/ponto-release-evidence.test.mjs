import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { rootCustodyPayloadDigest } from "./ponto-root-custody.mjs";
import { buildReleaseIdentity } from "./ponto-release-identity.mjs";

const script = path.resolve(import.meta.dirname, "ponto-release-evidence.mjs");
const sha = "a".repeat(40);
const tree = "b".repeat(40);
const digest = "c".repeat(64);
const uuid = "11111111-1111-4111-8111-111111111111";
const uuid2 = "22222222-2222-4222-8222-222222222222";
const uuid3 = "33333333-3333-4333-8333-333333333333";
const previewSurfaces = {
  timekeeping: { sourceSha: sha, stage: "preview", runId: "100", validation: "test-and-dry-run" },
  coreApi: { sourceSha: sha, stage: "preview", runId: "100", validation: "test-and-dry-run" },
  identityWorkforce: { sourceSha: sha, stage: "preview", runId: "100", validation: "test-and-dry-run" },
  crmPages: { sourceSha: sha, stage: "preview", runId: "100", validation: "test-and-build" },
};
const stageWeights = {
  staging: { timekeeping: 100, coreApi: 100, identityWorkforce: 100 },
  pilot: { timekeeping: 0, coreApi: 0, identityWorkforce: 0 },
  canary: { timekeeping: 0, coreApi: 0, identityWorkforce: 0 },
  production: { timekeeping: 100, coreApi: 100, identityWorkforce: 100 },
  rollback: { timekeeping: 0, coreApi: 0, identityWorkforce: 0 },
};
const workerSurface = (unit, stage, url) => ({
    sourceSha: sha,
    stage,
    runId: "200",
    candidateVersionId: uuid,
    incumbentVersionId: uuid2,
    deploymentId: uuid3,
    candidatePercent: stageWeights[stage][unit],
    incumbentPercent: 100 - stageWeights[stage][unit],
    candidateTag: `ponto:${unit}:${sha}`,
    url,
});
const liveSurfaces = (stage) => {
  const rootCustody = {
      schemaVersion: 1,
      target: stage === "staging" ? "staging" : "production",
      releaseSha: sha,
      profileDigest: "d".repeat(64),
      idempotencyDigest: "e".repeat(64),
      attestationKeyCommitment: "f".repeat(64),
      profileCustodyRef: `vault:v1:${(stage === "staging" ? "p" : "q").repeat(43)}`,
      idempotencyCustodyRef: `vault:v1:${(stage === "staging" ? "i" : "j").repeat(43)}`,
      attestationKeyId: `vault:v1:${"k".repeat(43)}`,
      distinctWithinTarget: true,
      distinctFromStaging: stage === "staging" ? null : true,
      algorithm: "hmac-sha256-v2",
      credentialsIncluded: false,
      piiIncluded: false,
  };
  rootCustody.provenance = {
    workflowRunId: "201",
    coordinatorRunId: "200",
    workflowPath: ".github/workflows/cloudflare-workers-sync-ponto-secrets.yml",
    artifactId: "202",
    artifactDigest: "9".repeat(64),
    attestationSha256: rootCustodyPayloadDigest(rootCustody),
    artifactName: `ponto-root-custody-${stage === "staging" ? "staging" : "production"}-${sha}`,
    repository: "skincos/skincos",
  };
  return ({
  timekeeping: {
    ...workerSurface("timekeeping", stage, "https://api.skincos.com.br/api/ponto/health"),
    ...(stage === "pilot" ? { baselineRunId: "250" } : {}),
    rootCustody,
  },
  coreApi: { ...workerSurface("coreApi", stage, "https://api.skincos.com.br/health"), ...(stage === "pilot" ? { baselineRunId: "250" } : {}) },
  identityWorkforce: { ...workerSurface("identityWorkforce", stage, "https://api.skincos.com.br/insumos/health"), ...(stage === "pilot" ? { baselineRunId: "250" } : {}) },
  crmPages: {
    sourceSha: sha,
    stage,
    runId: "200",
    ...(stage === "pilot" ? { baselineRunId: "250" } : {}),
    deploymentId: uuid,
    rollbackDeploymentId: uuid2,
    candidateTag: `ponto:crmPages:${sha}`,
    url: "https://crm.skincos.com.br",
  },
  });
};
const rollbackSummary = (executed = false) => ({
  executed,
  timekeepingVersionId: uuid2,
  coreVersionId: uuid2,
  identityVersionId: uuid2,
  pagesDeploymentId: uuid2,
});
const stagingRollbackSummary = () => ({
  ...rollbackSummary(true),
  mode: "staging-drill-restored-candidate",
  evidenceRunId: "210",
  predecessorRunId: "205",
  restoredCandidate: true,
});
const stagingSloSummary = () => ({
  passed: true,
  samples: 23,
  errors: 0,
  p95Ms: 0,
  windowSeconds: 1,
  digest,
  teardown: {
    passed: true,
    environment: "staging",
    coreResidualCount: 0,
    timekeepingResidualCount: 0,
    coreAuditPreserved: true,
    timekeepingAuditPreserved: true,
    credentialsIncluded: false,
    piiIncluded: false,
    digest,
  },
});
const stagingBootstrapCore = () => ({
  schemaVersion: 1,
  target: "staging",
  workflowRunId: "30512105626",
  artifactId: "8747521765",
  artifactDigest: `sha256:${digest}`,
  sourceSha: "0f3480dce1a170ac0f862fa392a95456af292a88",
  deploymentId: uuid3,
  versionId: uuid2,
  liveAttested: true,
  liveAttestation: {
    activeDeploymentId: uuid3,
    activeVersionId: uuid2,
    exposure: {
      workerRouteCount: 0,
      customDomainCount: 0,
      workersDevEnabled: false,
      previewUrlsEnabled: false,
    },
  },
  credentialsIncluded: false,
  piiIncluded: false,
});
const productionBootstrapCore = () => ({
  ...stagingBootstrapCore(),
  target: "production",
  artifactId: "8747532031",
});
const edgeGuard = (stage) => {
  const summary = {
    schemaVersion: 1,
    releaseSha: sha,
    stage,
    zoneId: "c".repeat(32),
    rulesetId: "d".repeat(32),
    ruleIds: ["e".repeat(32), "f".repeat(32)],
    ruleDescriptions: [
      "ponto-release-block-public-version-selection-v1",
      "ponto-release-block-public-workforce-contract-v1",
    ],
    rulesetVersion: "7",
    ruleAction: "block",
    phase: "http_request_firewall_custom",
    unconditional: true,
    upstreamZoneExemption: false,
    blockedHeaders: ["cloudflare-workers-version-overrides", "cloudflare-workers-version-key"],
    blocksTruncatedHeaders: true,
    blockedPath: "/insumos/health/workforce-contract",
    recursivelyDecodesBlockedPath: true,
    firstRuleIds: ["e".repeat(32), "f".repeat(32)],
    hosts: ["api.skincos.com.br", "api-staging.skincos.com.br"],
    probes: ["api.skincos.com.br", "api-staging.skincos.com.br"].flatMap(host => [
      { host, kind: "negative-control", status: 200, cloudflareRayPresent: true, passed: true },
      { host, header: "cloudflare-workers-version-overrides", status: 403, cloudflareRayPresent: true, passed: true },
      { host, header: "cloudflare-workers-version-key", status: 403, cloudflareRayPresent: true, passed: true },
      { host, path: "/insumos/health/workforce-contract", status: 403, cloudflareRayPresent: true, passed: true },
      { host, path: "/%69nsumos/health/workforce-contract", status: 403, cloudflareRayPresent: true, passed: true },
      { host, path: "/%2569nsumos/health/workforce-contract", status: 403, cloudflareRayPresent: true, passed: true },
      { host, path: "/INSUMOS/HEALTH/WORKFORCE-CONTRACT", status: 403, cloudflareRayPresent: true, passed: true },
    ]),
    passed: true,
    credentialsIncluded: false,
    piiIncluded: false,
  };
  return {
    ...summary,
    digest: crypto.createHash("sha256").update(JSON.stringify(summary)).digest("hex"),
  };
};

function run(mode, file, env = {}) {
  return spawnSync(process.execPath, [script, mode, file], {
    encoding: "utf8",
    env: { ...process.env, ...env },
  });
}

function writePreviewAndStaging(dir) {
  const preview = path.join(dir, "preview.json");
  let result = run("write", preview, {
    PONTO_RELEASE_STAGE: "preview",
    PONTO_RELEASE_SHA: sha,
    PONTO_RELEASE_TREE: tree,
    PONTO_RELEASE_SURFACES_JSON: JSON.stringify(previewSurfaces),
    GITHUB_RUN_ID: "100",
    GITHUB_REPOSITORY: "skincos/skincos",
  });
  assert.equal(result.status, 0, result.stderr);
  const staging = path.join(dir, "staging.json");
  result = run("write", staging, {
    PONTO_RELEASE_STAGE: "staging",
    PONTO_RELEASE_SHA: sha,
    PONTO_RELEASE_TREE: tree,
    PONTO_PREDECESSOR_STAGE: "preview",
    PONTO_PREDECESSOR_RUN_ID: "100",
    PONTO_PREDECESSOR_SHA: sha,
    PONTO_PREDECESSOR_ARTIFACT: `ponto-release-evidence-preview-${sha}`,
    PONTO_PREDECESSOR_FILE: preview,
    PONTO_RELEASE_SURFACES_JSON: JSON.stringify(liveSurfaces("staging")),
    PONTO_RELEASE_EDGE_GUARD_JSON: JSON.stringify(edgeGuard("staging")),
    PONTO_RELEASE_BOOTSTRAP_CORE_JSON: JSON.stringify(stagingBootstrapCore()),
    PONTO_RELEASE_CHECKPOINT_JSON: JSON.stringify({
      timekeeping: { artifactName: `timekeeping-staging-pre-migration-${sha}`, sha256: digest, releaseSha: sha },
      identityWorkforce: { artifactName: `identity-staging-pre-migration-${sha}`, sha256: digest, releaseSha: sha },
    }),
    PONTO_RELEASE_MIGRATIONS_JSON: JSON.stringify([{ unit: "timekeeping", name: "0001_test.sql", sha256: digest, status: "applied-or-preexisting" }]),
    PONTO_RELEASE_SLO_JSON: JSON.stringify(stagingSloSummary()),
    PONTO_RELEASE_ROLLBACK_JSON: JSON.stringify(stagingRollbackSummary()),
    GITHUB_RUN_ID: "200",
    GITHUB_REPOSITORY: "skincos/skincos",
  });
  assert.equal(result.status, 0, result.stderr);
  const stagingEvidence = JSON.parse(fs.readFileSync(staging, "utf8"));
  assert.equal(stagingEvidence.edgeGuard.stage, "staging");
  assert.equal(stagingEvidence.edgeGuard.probes.length, 14);
  assert.equal(stagingEvidence.bootstrapCore.workflowRunId, "30512105626");
  return { preview, staging };
}

test("staging evidence durably requires zero synthetic residue and preserved audit", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ponto-evidence-"));
  const { preview, staging } = writePreviewAndStaging(dir);
  const evidence = JSON.parse(fs.readFileSync(staging, "utf8"));
  delete evidence.slo.teardown;
  fs.writeFileSync(staging, JSON.stringify(evidence));
  const result = run("verify", staging, {
    PONTO_EXPECTED_STAGE: "staging",
    PONTO_EXPECTED_SHA: sha,
    PONTO_EXPECTED_REPOSITORY: "skincos/skincos",
    PONTO_PREDECESSOR_FILE: preview,
  });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /staging synthetic teardown did not pass/);
});

test("rejects staging edge evidence without the exact negative and block probe matrix", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ponto-evidence-"));
  const { preview, staging } = writePreviewAndStaging(dir);
  const evidence = JSON.parse(fs.readFileSync(staging, "utf8"));
  evidence.edgeGuard.probes = evidence.edgeGuard.probes.filter(probe => probe.kind !== "negative-control");
  fs.writeFileSync(staging, JSON.stringify(evidence));
  const result = run("verify", staging, {
    PONTO_EXPECTED_STAGE: "staging",
    PONTO_EXPECTED_SHA: sha,
    PONTO_EXPECTED_REPOSITORY: "skincos/skincos",
    PONTO_PREDECESSOR_FILE: preview,
  });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /two negative controls and twelve external block probes/);
});

test("rejects staging evidence when the bootstrap predecessor differs from the exact incumbent", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ponto-evidence-"));
  const { preview, staging } = writePreviewAndStaging(dir);
  const evidence = JSON.parse(fs.readFileSync(staging, "utf8"));
  evidence.bootstrapCore.versionId = uuid;
  fs.writeFileSync(staging, JSON.stringify(evidence));
  const result = run("verify", staging, {
    PONTO_EXPECTED_STAGE: "staging",
    PONTO_EXPECTED_SHA: sha,
    PONTO_EXPECTED_REPOSITORY: "skincos/skincos",
    PONTO_PREDECESSOR_FILE: preview,
  });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Core bootstrap version differs from the staging incumbent/);
});

test("writes and verifies schema v2 pilot evidence with a digested predecessor", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ponto-evidence-"));
  const { staging } = writePreviewAndStaging(dir);
  const file = path.join(dir, "pilot.json");
  const written = run("write", file, {
    PONTO_RELEASE_STAGE: "pilot",
    PONTO_RELEASE_SHA: sha,
    PONTO_RELEASE_TREE: tree,
    PONTO_PREDECESSOR_STAGE: "staging",
    PONTO_PREDECESSOR_RUN_ID: "200",
    PONTO_PREDECESSOR_SHA: sha,
    PONTO_PREDECESSOR_ARTIFACT: `ponto-release-evidence-staging-${sha}`,
    PONTO_PREDECESSOR_FILE: staging,
    PONTO_RELEASE_SURFACES_JSON: JSON.stringify(liveSurfaces("pilot")),
    PONTO_RELEASE_EDGE_GUARD_JSON: JSON.stringify(edgeGuard("pilot")),
    PONTO_RELEASE_BOOTSTRAP_CORE_JSON: JSON.stringify(productionBootstrapCore()),
    PONTO_RELEASE_CHECKPOINT_JSON: JSON.stringify({ timekeeping: { artifactName: `timekeeping-production-pre-migration-${sha}`, sha256: digest, releaseSha: sha } }),
    PONTO_RELEASE_SLO_JSON: JSON.stringify({ passed: true, samples: 10, errors: 0, p95Ms: 400, windowSeconds: 300, digest }),
    PONTO_RELEASE_ROLLBACK_JSON: JSON.stringify(rollbackSummary()),
    GITHUB_RUN_ID: "300",
    GITHUB_REPOSITORY: "skincos/skincos",
  });
  assert.equal(written.status, 0, written.stderr);
  const verified = run("verify", file, {
    PONTO_EXPECTED_STAGE: "pilot",
    PONTO_EXPECTED_SHA: sha,
    PONTO_EXPECTED_REPOSITORY: "skincos/skincos",
    PONTO_PREDECESSOR_FILE: staging,
  });
  assert.equal(verified.status, 0, verified.stderr);
});

test("rejects a skipped stage and a different SHA", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ponto-evidence-"));
  const file = path.join(dir, "evidence.json");
  fs.writeFileSync(file, JSON.stringify({
    schemaVersion: 2,
    unit: "ponto",
    stage: "canary",
    sourceSha: sha,
    sourceTree: tree,
    runId: "456",
    repository: "skincos/skincos",
    decision: "pass",
    predecessor: { stage: "staging", runId: "123", sourceSha: sha, artifactName: "ponto-release-evidence-staging-x", artifactSha256: digest },
    surfaces: liveSurfaces("canary"),
    edgeGuard: edgeGuard("canary"),
    migrations: [],
    checkpoint: null,
    slo: { passed: true, samples: 10, errors: 0, p95Ms: 1, windowSeconds: 60, digest },
    rollback: rollbackSummary(),
  }));
  const result = run("verify", file, {
    PONTO_EXPECTED_STAGE: "canary",
    PONTO_EXPECTED_SHA: "d".repeat(40),
    PONTO_EXPECTED_REPOSITORY: "skincos/skincos",
  });
  assert.notEqual(result.status, 0);
});

test("accepts a finalized artifact identity only when it is linked to its immutable source identity", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ponto-evidence-"));
  const file = path.join(dir, "preview-final-identity.json");
  const sourceIdentity = buildReleaseIdentity({
    module: "ponto",
    sourceCommit: sha,
    sourceTree: tree,
    dependencyClosureDigest: digest,
  });
  const finalIdentity = buildReleaseIdentity({
    module: "ponto",
    sourceCommit: sha,
    sourceTree: tree,
    dependencyClosureDigest: digest,
    artifactBindings: [{ name: "pages", digest }],
    sourceIdentityDigest: sourceIdentity.releaseIdentityDigest,
  });
  const written = run("write", file, {
    PONTO_RELEASE_STAGE: "preview",
    PONTO_RELEASE_SHA: sha,
    PONTO_RELEASE_TREE: tree,
    PONTO_RELEASE_IDENTITY_JSON: JSON.stringify(finalIdentity),
    PONTO_RELEASE_IDENTITY_SOURCE_JSON: JSON.stringify(sourceIdentity),
    PONTO_RELEASE_SURFACES_JSON: JSON.stringify(previewSurfaces),
    GITHUB_RUN_ID: "400",
    GITHUB_REPOSITORY: "skincos/skincos",
  });
  assert.equal(written.status, 0, written.stderr);
  const evidence = JSON.parse(fs.readFileSync(file, "utf8"));
  assert.equal(evidence.releaseIdentity.sourceIdentityDigest, sourceIdentity.releaseIdentityDigest);
  assert.equal(evidence.releaseIdentitySource.releaseIdentityDigest, sourceIdentity.releaseIdentityDigest);
  const tampered = path.join(dir, "tampered.json");
  evidence.releaseIdentitySource.releaseIdentityDigest = "e".repeat(64);
  fs.writeFileSync(tampered, JSON.stringify(evidence));
  const rejected = run("verify", tampered, {
    PONTO_EXPECTED_STAGE: "preview",
    PONTO_EXPECTED_SHA: sha,
    PONTO_EXPECTED_REPOSITORY: "skincos/skincos",
  });
  assert.notEqual(rejected.status, 0);
  assert.match(rejected.stderr, /release identity digest differs/);
});

test("rejects identity or network material in a sanitised artifact", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ponto-evidence-"));
  const { staging } = writePreviewAndStaging(dir);
  const file = path.join(dir, "pilot.json");
  const result = run("write", file, {
    PONTO_RELEASE_STAGE: "pilot",
    PONTO_RELEASE_SHA: sha,
    PONTO_RELEASE_TREE: tree,
    PONTO_PREDECESSOR_STAGE: "staging",
    PONTO_PREDECESSOR_RUN_ID: "200",
    PONTO_PREDECESSOR_SHA: sha,
    PONTO_PREDECESSOR_ARTIFACT: `ponto-release-evidence-staging-${sha}`,
    PONTO_PREDECESSOR_FILE: staging,
    PONTO_RELEASE_SURFACES_JSON: JSON.stringify(liveSurfaces("pilot")),
    PONTO_RELEASE_EDGE_GUARD_JSON: JSON.stringify(edgeGuard("pilot")),
    PONTO_RELEASE_BOOTSTRAP_CORE_JSON: JSON.stringify(productionBootstrapCore()),
    PONTO_RELEASE_CHECKPOINT_JSON: JSON.stringify({ timekeeping: { artifactName: "checkpoint", sha256: digest, releaseSha: sha } }),
    PONTO_RELEASE_COHORT_SUMMARY_JSON: JSON.stringify({ employeeRefs: ["private"] }),
    PONTO_RELEASE_SLO_JSON: JSON.stringify({ passed: true, samples: 1, errors: 0, p95Ms: 1, windowSeconds: 1, digest }),
    PONTO_RELEASE_ROLLBACK_JSON: JSON.stringify(rollbackSummary()),
    GITHUB_RUN_ID: "300",
    GITHUB_REPOSITORY: "skincos/skincos",
  });
  assert.notEqual(result.status, 0);
});

test("accepts an executed rollback from a live progressive stage", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ponto-evidence-"));
  const { staging } = writePreviewAndStaging(dir);
  const pilot = path.join(dir, "pilot.json");
  let result = run("write", pilot, {
    PONTO_RELEASE_STAGE: "pilot",
    PONTO_RELEASE_SHA: sha,
    PONTO_RELEASE_TREE: tree,
    PONTO_PREDECESSOR_STAGE: "staging",
    PONTO_PREDECESSOR_RUN_ID: "200",
    PONTO_PREDECESSOR_SHA: sha,
    PONTO_PREDECESSOR_ARTIFACT: `ponto-release-evidence-staging-${sha}`,
    PONTO_PREDECESSOR_FILE: staging,
    PONTO_RELEASE_SURFACES_JSON: JSON.stringify(liveSurfaces("pilot")),
    PONTO_RELEASE_EDGE_GUARD_JSON: JSON.stringify(edgeGuard("pilot")),
    PONTO_RELEASE_BOOTSTRAP_CORE_JSON: JSON.stringify(productionBootstrapCore()),
    PONTO_RELEASE_CHECKPOINT_JSON: JSON.stringify({ timekeeping: { artifactName: "checkpoint", sha256: digest, releaseSha: sha } }),
    PONTO_RELEASE_SLO_JSON: JSON.stringify({ passed: true, samples: 1, errors: 0, p95Ms: 1, windowSeconds: 1, digest }),
    PONTO_RELEASE_ROLLBACK_JSON: JSON.stringify(rollbackSummary()),
    GITHUB_RUN_ID: "300",
    GITHUB_REPOSITORY: "skincos/skincos",
  });
  assert.equal(result.status, 0, result.stderr);
  const rollback = path.join(dir, "rollback.json");
  result = run("write", rollback, {
    PONTO_RELEASE_STAGE: "rollback",
    PONTO_RELEASE_SHA: sha,
    PONTO_RELEASE_TREE: tree,
    PONTO_PREDECESSOR_STAGE: "pilot",
    PONTO_PREDECESSOR_RUN_ID: "300",
    PONTO_PREDECESSOR_SHA: sha,
    PONTO_PREDECESSOR_ARTIFACT: `ponto-release-evidence-pilot-${sha}`,
    PONTO_PREDECESSOR_FILE: pilot,
    PONTO_RELEASE_SURFACES_JSON: JSON.stringify(liveSurfaces("rollback")),
    PONTO_RELEASE_SLO_JSON: JSON.stringify({ passed: true, samples: 1, errors: 0, p95Ms: 1, windowSeconds: 1, digest }),
    PONTO_RELEASE_ROLLBACK_JSON: JSON.stringify(rollbackSummary(true)),
    GITHUB_RUN_ID: "400",
    GITHUB_REPOSITORY: "skincos/skincos",
  });
  assert.equal(result.status, 0, result.stderr);
});
