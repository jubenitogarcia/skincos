import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { fileURLToPath } from "node:url";

const releaseSha = "a".repeat(40);
const timekeepingVersionId = "11111111-1111-4111-8111-111111111111";
const timekeepingDeploymentId = "22222222-2222-4222-8222-222222222222";
const coreVersionId = "33333333-3333-4333-8333-333333333333";
const coreDeploymentId = "44444444-4444-4444-8444-444444444444";
const identityVersionId = "55555555-5555-4555-8555-555555555555";
const identityDeploymentId = "66666666-6666-4666-8666-666666666666";
const pagesDeploymentId = "77777777-7777-4777-8777-777777777777";

const worker = (versionId, deploymentId) => ({
  versionId,
  deploymentId,
  percentage: 100,
  tag: "incumbent",
  message: "incumbent",
});

const unsignedBaseline = (state = "maintenance") => ({
  schemaVersion: 1,
  releaseSha,
  stagingRunId: "101",
  runId: "202",
  orchestratorRunId: "303",
  repository: "skincos/skincos",
  capturedAt: "2026-07-30T00:00:00.000Z",
  surfaces: {
    timekeeping: worker(timekeepingVersionId, timekeepingDeploymentId),
    coreApi: worker(coreVersionId, coreDeploymentId),
    identityWorkforce: worker(identityVersionId, identityDeploymentId),
    crmPages: {
      deploymentId: pagesDeploymentId,
      commitHash: "b".repeat(40),
      createdOn: "2026-07-29T23:59:00.000Z",
      status: "success",
      latestStage: {
        name: "deploy",
        endedOn: "2026-07-29T23:59:30.000Z",
      },
      isSkipped: false,
      project: "skincos",
      environment: "production",
      canonical: true,
      alias: "https://crm.skincos.com.br",
      sourceControl: {
        deploymentsEnabled: false,
        productionDeploymentsEnabled: false,
        previewDeploymentSetting: "none",
      },
    },
  },
  bootstrapCore: {
    workflowRunId: "30512105626",
    artifactId: "8747532031",
    artifactDigest: `sha256:${"a".repeat(64)}`,
    sourceSha: releaseSha,
    deploymentId: coreDeploymentId,
    versionId: coreVersionId,
    liveAttested: true,
  },
  health: {
    passed: true,
    state,
    ready: state === "active",
    crmStatus: 200,
    identityStatus: 200,
    observation: "external-production",
  },
  credentialsIncluded: false,
  piiIncluded: false,
});

const signedBaseline = (unsigned) => ({
  ...unsigned,
  sha256: crypto.createHash("sha256").update(JSON.stringify(unsigned)).digest("hex"),
});

const verifyBaseline = (baselineFile, outputFile) => spawnSync(process.execPath, [
  fileURLToPath(new URL("./ponto-production-baseline.mjs", import.meta.url)),
  "verify",
  baselineFile,
], {
  encoding: "utf8",
  env: {
    ...process.env,
    ...(outputFile ? { GITHUB_OUTPUT: outputFile } : { GITHUB_OUTPUT: "" }),
    PONTO_EXPECTED_BASELINE_RELEASE_SHA: releaseSha,
    PONTO_EXPECTED_BASELINE_STAGING_RUN_ID: "101",
    PONTO_EXPECTED_BASELINE_RUN_ID: "202",
    PONTO_EXPECTED_BASELINE_REPOSITORY: "skincos/skincos",
  },
});

test("baseline verification exports every immutable Worker deployment ID with its version ID", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "ponto-baseline-test-"));
  try {
    const baseline = signedBaseline(unsignedBaseline());
    const baselineFile = path.join(directory, "baseline.json");
    const outputFile = path.join(directory, "github-output");
    fs.writeFileSync(baselineFile, `${JSON.stringify(baseline)}\n`);
    const result = verifyBaseline(baselineFile, outputFile);
    assert.equal(result.status, 0, result.stderr);
    const outputs = Object.fromEntries(
      fs.readFileSync(outputFile, "utf8")
        .trim()
        .split(/\r?\n/)
        .map(line => line.split(/=(.*)/s).slice(0, 2)),
    );
    assert.equal(outputs.baseline_timekeeping_version_id, timekeepingVersionId);
    assert.equal(outputs.baseline_timekeeping_deployment_id, timekeepingDeploymentId);
    assert.equal(outputs.baseline_core_version_id, coreVersionId);
    assert.equal(outputs.baseline_core_deployment_id, coreDeploymentId);
    assert.equal(outputs.baseline_identity_version_id, identityVersionId);
    assert.equal(outputs.baseline_identity_deployment_id, identityDeploymentId);
    assert.equal(outputs.baseline_core_bootstrap_workflow_run_id, "30512105626");
    assert.equal(outputs.baseline_core_bootstrap_artifact_id, "8747532031");
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test("baseline verification accepts valid active and maintenance initial states", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "ponto-baseline-states-"));
  try {
    for (const state of ["active", "maintenance"]) {
      const baselineFile = path.join(directory, `${state}.json`);
      fs.writeFileSync(baselineFile, `${JSON.stringify(signedBaseline(unsignedBaseline(state)))}\n`);
      const result = verifyBaseline(baselineFile);
      assert.equal(result.status, 0, `${state}: ${result.stderr}`);
    }
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test("baseline verification rejects canary, absent, and invalid initial states", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "ponto-baseline-invalid-states-"));
  try {
    const cases = [
      ["canary", "canary"],
      ["absent", undefined],
      ["invalid", "disabled"],
    ];
    for (const [label, state] of cases) {
      const unsigned = unsignedBaseline(state);
      if (state === undefined) delete unsigned.health.state;
      const baselineFile = path.join(directory, `${label}.json`);
      fs.writeFileSync(baselineFile, `${JSON.stringify(signedBaseline(unsigned))}\n`);
      const result = verifyBaseline(baselineFile);
      assert.notEqual(result.status, 0, `${label} initial state unexpectedly passed`);
      assert.match(result.stderr, /baseline initial module state must be active or maintenance/);
    }
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test("baseline verification rejects readiness inconsistent with the initial state", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "ponto-baseline-readiness-"));
  try {
    for (const [state, ready] of [["active", false], ["maintenance", true]]) {
      const unsigned = unsignedBaseline(state);
      unsigned.health.ready = ready;
      const baselineFile = path.join(directory, `${state}.json`);
      fs.writeFileSync(baselineFile, `${JSON.stringify(signedBaseline(unsigned))}\n`);
      const result = verifyBaseline(baselineFile);
      assert.notEqual(result.status, 0, `${state} with ready=${ready} unexpectedly passed`);
      assert.match(result.stderr, /baseline initial readiness is inconsistent with module state/);
    }
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test("baseline verification rejects absent status and non-canonical Pages identity", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "ponto-baseline-pages-"));
  try {
    const cases = [
      ["missing-status", baseline => { delete baseline.surfaces.crmPages.status; }, /unskipped completed deploy success/],
      ["idle-status", baseline => { baseline.surfaces.crmPages.status = "idle"; }, /unskipped completed deploy success/],
      ["wrong-stage", baseline => { baseline.surfaces.crmPages.latestStage.name = "build"; }, /unskipped completed deploy success/],
      ["unfinished-stage", baseline => { baseline.surfaces.crmPages.latestStage.endedOn = ""; }, /unskipped completed deploy success/],
      ["skipped", baseline => { baseline.surfaces.crmPages.isSkipped = true; }, /unskipped completed deploy success/],
      ["candidate-as-incumbent", baseline => { baseline.surfaces.crmPages.commitHash = releaseSha; }, /cannot already be the release candidate/],
      ["legacy-auto-deploy", baseline => { baseline.surfaces.crmPages.sourceControl.deploymentsEnabled = true; }, /auto-deploy controls/],
      ["production-auto-deploy", baseline => { baseline.surfaces.crmPages.sourceControl.productionDeploymentsEnabled = true; }, /auto-deploy controls/],
      ["preview-auto-deploy", baseline => { baseline.surfaces.crmPages.sourceControl.previewDeploymentSetting = "all"; }, /auto-deploy controls/],
      ["wrong-project", baseline => { baseline.surfaces.crmPages.project = "skincos-staging"; }, /project is not canonical/],
      ["wrong-environment", baseline => { baseline.surfaces.crmPages.environment = "preview"; }, /environment is not production/],
      ["not-canonical", baseline => { baseline.surfaces.crmPages.canonical = false; }, /deployment is not canonical/],
      ["wrong-alias", baseline => { baseline.surfaces.crmPages.alias = "https:\\/\\/example.invalid"; }, /canonical alias is invalid/],
    ];
    for (const [label, mutate, pattern] of cases) {
      const unsigned = unsignedBaseline();
      mutate(unsigned);
      const baselineFile = path.join(directory, `${label}.json`);
      fs.writeFileSync(baselineFile, `${JSON.stringify(signedBaseline(unsigned))}\n`);
      const result = verifyBaseline(baselineFile);
      assert.notEqual(result.status, 0, `${label} unexpectedly passed`);
      assert.match(result.stderr, pattern);
    }
    const source = fs.readFileSync(
      new URL("./ponto-production-baseline.mjs", import.meta.url),
      "utf8",
    );
    assert.match(source, /project\\?\\.canonical_deployment|project\?\.canonical_deployment/);
    assert.doesNotMatch(source, /pages\/projects\/\$\{encodeURIComponent\(pagesProject\)\}\/deployments/);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test("baseline workflow, reusable gate, and coordinator retain every exported Worker deployment ID", () => {
  const baselineWorkflow = fs.readFileSync(
    new URL("../workflows/ponto-production-baseline.yml", import.meta.url),
    "utf8",
  );
  const gateWorkflow = fs.readFileSync(
    new URL("../workflows/ponto-release-gate.yml", import.meta.url),
    "utf8",
  );
  const coordinator = fs.readFileSync(
    new URL("../workflows/ponto-progressive-release.yml", import.meta.url),
    "utf8",
  );
  for (const name of [
    "baseline_timekeeping_deployment_id",
    "baseline_core_deployment_id",
    "baseline_identity_deployment_id",
  ]) {
    assert.match(baselineWorkflow, new RegExp(`${name}:`));
    assert.match(gateWorkflow, new RegExp(`${name}:`));
    assert.match(coordinator, new RegExp(`steps\\.baseline\\.outputs\\.${name}`));
  }
  assert.match(coordinator, /Pin exported Worker deployment and version identities for every pilot publisher/);
});
