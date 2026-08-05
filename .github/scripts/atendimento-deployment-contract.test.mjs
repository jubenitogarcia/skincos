import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

import {
  ATENDIMENTO_COMMAND_IDS,
  ATENDIMENTO_CONTROL_FILE,
  ATENDIMENTO_HEALTH_URLS,
  validateAtendimentoDeploymentContract,
} from "./atendimento-deployment-contract.mjs";

const releaseSha = "a".repeat(40);
const deployWorkflow = fs.readFileSync(
  new URL("../workflows/deploy-atendimento.yml", import.meta.url),
  "utf8",
);
const availabilityWorkflow = fs.readFileSync(
  new URL("../workflows/atendimento-availability.yml", import.meta.url),
  "utf8",
);
const contractSource = fs.readFileSync(
  new URL("./atendimento-deployment-contract.mjs", import.meta.url),
  "utf8",
);

function configuredEnvironment(overrides = {}) {
  return {
    CONTRACT_KIND: "deploy",
    CONTRACT_TARGET: "staging",
    RELEASE_SHA: releaseSha,
    ATENDIMENTO_OPERATION: "deploy",
    ENABLE_ATENDIMENTO_DEPLOY: "true",
    CRM_MODULE_CONTROL_FILE: ATENDIMENTO_CONTROL_FILE,
    CRM_ATENDIMENTO_DEPLOY_COMMAND: ATENDIMENTO_COMMAND_IDS.deploy,
    CRM_ATENDIMENTO_ROLLBACK_COMMAND: ATENDIMENTO_COMMAND_IDS.rollback,
    CRM_ATENDIMENTO_CONTROL_COMMAND: ATENDIMENTO_COMMAND_IDS.control,
    CRM_ATENDIMENTO_HEALTH_URL: ATENDIMENTO_HEALTH_URLS.staging,
    ...overrides,
  };
}

test("native Atendimento deployment contract requires explicit enablement and exact command identifiers", () => {
  const accepted = validateAtendimentoDeploymentContract(configuredEnvironment());
  assert.equal(accepted.result, "configuration-attested-native-runtime");
  assert.deepEqual(accepted.errors, []);
  assert.equal(accepted.mutation.remoteCommandExecuted, false);
  assert.equal(accepted.mutation.sharedCrmRestarted, false);

  const disabled = validateAtendimentoDeploymentContract(configuredEnvironment({ ENABLE_ATENDIMENTO_DEPLOY: "false" }));
  assert.equal(disabled.result, "blocked");
  assert.match(disabled.errors.join("\n"), /ENABLE_ATENDIMENTO_DEPLOY must be explicitly true/);

  const shellString = validateAtendimentoDeploymentContract(configuredEnvironment({
    CRM_ATENDIMENTO_DEPLOY_COMMAND: "bash -lc deploy-atendimento",
  }));
  assert.match(shellString.errors.join("\n"), /CRM_ATENDIMENTO_DEPLOY_COMMAND must use the versioned, allowlisted contract identifier/);
  assert.equal(shellString.controls.deployCommand.matchesExpected, false);
});

test("preview availability validates source identity without probing or mutating an external runtime", () => {
  const report = validateAtendimentoDeploymentContract({
    CONTRACT_KIND: "availability",
    CONTRACT_TARGET: "preview",
    RELEASE_SHA: releaseSha,
    ATENDIMENTO_AVAILABILITY_STATE: "disabled",
  });
  assert.equal(report.result, "validated-preview-only");
  assert.deepEqual(report.errors, []);
  assert.deepEqual(report.controls, {});
  assert.equal(report.mutation.attempted, false);
});

test("Atendimento workflows remain main-custodied, manually dispatched, immutable, and non-publishing", () => {
  for (const [name, workflow, unit] of [
    ["release", deployWorkflow, "atendimento"],
    ["availability", availabilityWorkflow, "atendimento-availability"],
  ]) {
    assert.match(workflow, /^on:\n  workflow_dispatch:/m, `${name} must be dispatch-only`);
    assert.doesNotMatch(workflow, /^  (push|schedule|pull_request_target|workflow_run|repository_dispatch):/m);
    assert.match(workflow, /DISPATCH_REF.*github\.ref[\s\S]*refs\/heads\/main/);
    assert.match(workflow, /GITHUB_RUN_ATTEMPT.*==\s*"1"/);
    assert.match(workflow, new RegExp(`unit: ${unit}`));
    assert.match(workflow, /promotion-gate\.yml/);
    assert.match(workflow, /release_sha/);
    assert.match(workflow, /emit_preview_evidence: false/);
    assert.match(workflow, /github\.workflow_sha/);
    assert.match(workflow, /ENABLE_ATENDIMENTO_DEPLOY/);
    assert.match(workflow, /Verify (?:staged )?native Atendimento runtime health/);
    assert.doesNotMatch(workflow, /Stop before remote/);
    assert.doesNotMatch(workflow, /\beval\b|bash\s+-c|sh\s+-c|appleboy\/ssh-action|systemctl\s+(?:restart|stop|start)\s+crm\.service/);
  }
});

test("the contract validator never launches an environment-provided command", () => {
  assert.match(contractSource, /versioned, allowlisted contract identifier/);
  assert.doesNotMatch(contractSource, /child_process|execFile|spawn\(|\beval\b|bash\s+-c|sh\s+-c/);
});
