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

test("baseline verification exports every immutable Worker deployment ID with its version ID", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "ponto-baseline-test-"));
  try {
    const unsigned = {
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
          commitHash: releaseSha,
          createdOn: "2026-07-29T23:59:00.000Z",
          status: "success",
          project: "skincos",
        },
      },
      health: {
        passed: true,
        state: "maintenance",
        crmStatus: 200,
        identityStatus: 200,
        observation: "external-production",
      },
      credentialsIncluded: false,
      piiIncluded: false,
    };
    const baseline = {
      ...unsigned,
      sha256: crypto.createHash("sha256").update(JSON.stringify(unsigned)).digest("hex"),
    };
    const baselineFile = path.join(directory, "baseline.json");
    const outputFile = path.join(directory, "github-output");
    fs.writeFileSync(baselineFile, `${JSON.stringify(baseline)}\n`);
    const result = spawnSync(process.execPath, [
      fileURLToPath(new URL("./ponto-production-baseline.mjs", import.meta.url)),
      "verify",
      baselineFile,
    ], {
      encoding: "utf8",
      env: {
        ...process.env,
        GITHUB_OUTPUT: outputFile,
        PONTO_EXPECTED_BASELINE_RELEASE_SHA: releaseSha,
        PONTO_EXPECTED_BASELINE_STAGING_RUN_ID: "101",
        PONTO_EXPECTED_BASELINE_RUN_ID: "202",
        PONTO_EXPECTED_BASELINE_REPOSITORY: "skincos/skincos",
      },
    });
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
