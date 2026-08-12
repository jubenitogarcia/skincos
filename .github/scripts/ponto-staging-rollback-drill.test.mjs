import assert from "node:assert/strict";
import { createHmac, randomBytes } from "node:crypto";
import fs from "node:fs";
import test from "node:test";

import {
  loadConfig,
  classifyIncumbentBundle,
  isFailClosedIncumbentHealth,
  runStagingRollbackDrill,
  validateIncumbentProvenance,
  validateSourceEvidence,
} from "./ponto-staging-rollback-drill.mjs";

const ids = {
  timekeeping: {
    worker: "skincos-timekeeping-staging",
    candidate: "11111111-1111-4111-8111-111111111111",
    incumbent: "21111111-1111-4111-8111-111111111111",
  },
  identityWorkforce: {
    worker: "skincos-insumos-staging",
    candidate: "31111111-1111-4111-8111-111111111111",
    incumbent: "41111111-1111-4111-8111-111111111111",
  },
  coreApi: {
    worker: "skincos-ponto-core-staging",
    candidate: "51111111-1111-4111-8111-111111111111",
    incumbent: "61111111-1111-4111-8111-111111111111",
  },
  crmPages: {
    candidate: "71111111-1111-4111-8111-111111111111",
    incumbent: "81111111-1111-4111-8111-111111111111",
  },
};

const testCapabilityRoot = randomBytes(32);
const config = {
  releaseSha: "a".repeat(40),
  runId: "12345",
  orchestratorRunId: "67890",
  predecessorRunId: "24680",
  repository: "skincos/skincos",
  repositoryId: "42",
  incumbentDispatchNonce: "1".repeat(32),
  candidateDispatchNonce: "2".repeat(32),
  releaseProbeKey: createHmac("sha256", testCapabilityRoot).update("probe").digest("base64url"),
  ids,
};

const incumbentEvidence = {
  passed: true,
  timekeeping: {
    passed: true,
    worker: ids.timekeeping.worker,
    versionId: ids.timekeeping.incumbent,
    sourceSha: "b".repeat(40),
  },
  identityWorkforce: {
    passed: true,
    worker: ids.identityWorkforce.worker,
    versionId: ids.identityWorkforce.incumbent,
    sourceSha: null,
  },
  coreApi: {
    passed: true,
    worker: ids.coreApi.worker,
    versionId: ids.coreApi.incumbent,
    sourceSha: "c".repeat(40),
  },
  crmPages: {
    passed: true,
    deploymentId: ids.crmPages.incumbent,
    sourceSha: null,
  },
};

const coherentIncumbentEvidence = {
  passed: true,
  timekeeping: {
    passed: true,
    worker: ids.timekeeping.worker,
    versionId: ids.timekeeping.incumbent,
    sourceSha: "b".repeat(40),
  },
  identityWorkforce: {
    passed: true,
    worker: ids.identityWorkforce.worker,
    versionId: ids.identityWorkforce.incumbent,
    sourceSha: "b".repeat(40),
  },
  coreApi: {
    passed: true,
    worker: ids.coreApi.worker,
    versionId: ids.coreApi.incumbent,
    sourceSha: "b".repeat(40),
  },
  crmPages: {
    passed: true,
    deploymentId: ids.crmPages.incumbent,
    sourceSha: "b".repeat(40),
  },
};

test("configuration derives the transient release-probe key without delegated child correlations", () => {
  const idempotencyKey = "staging-idempotency-root-".repeat(2);
  const env = {
    RELEASE_SHA: config.releaseSha,
    GITHUB_RUN_ID: config.runId,
    GITHUB_REPOSITORY: config.repository,
    GITHUB_REPOSITORY_ID: config.repositoryId,
    ORCHESTRATOR_RUN_ID: config.orchestratorRunId,
    ORCHESTRATOR_STAGE: "staging",
    STAGING_JOURNEY_RUN_ID: config.predecessorRunId,
    CLOUDFLARE_ACCOUNT_ID: "d".repeat(32),
    CLOUDFLARE_API_TOKEN: "cloudflare-token",
    GH_TOKEN: "github-token",
    PONTO_IDEMPOTENCY_KEY: idempotencyKey,
    PONTO_MODULE_CONTROL_STAGING_KV_ID: "e".repeat(32),
    PONTO_CLOUDFLARE_PAGES_PROJECT_STAGING: "skincos-staging",
    TIMEKEEPING_STAGING_WRANGLER_CONFIG: "/tmp/ponto-timekeeping-staging-wrangler.toml",
    RUNNER_TEMP: "/tmp",
    TIMEKEEPING_CANDIDATE_VERSION_ID: ids.timekeeping.candidate,
    TIMEKEEPING_INCUMBENT_VERSION_ID: ids.timekeeping.incumbent,
    IDENTITY_CANDIDATE_VERSION_ID: ids.identityWorkforce.candidate,
    IDENTITY_INCUMBENT_VERSION_ID: ids.identityWorkforce.incumbent,
    CORE_CANDIDATE_VERSION_ID: ids.coreApi.candidate,
    CORE_INCUMBENT_VERSION_ID: ids.coreApi.incumbent,
    PAGES_CANDIDATE_DEPLOYMENT_ID: ids.crmPages.candidate,
    PAGES_INCUMBENT_DEPLOYMENT_ID: ids.crmPages.incumbent,
  };
  const loaded = loadConfig(env, ["/tmp/report.json"]);
  const expected = createHmac("sha256", idempotencyKey)
    .update("skincos/ponto/release-probe/v1")
    .digest("base64url");

  assert.equal(loaded.releaseProbeKey, expected);
  assert.equal(Object.hasOwn(loaded, "idempotencyKey"), false);
  assert.equal(Object.hasOwn(loaded, "incumbentDispatchNonce"), false);
  assert.equal(Object.hasOwn(loaded, "candidateDispatchNonce"), false);
});

test("incumbent provenance accepts heterogeneous and absent source SHAs with exact immutable identities", () => {
  const evidence = validateIncumbentProvenance(ids, incumbentEvidence);

  assert.equal(evidence.passed, true);
  assert.equal(evidence.timekeeping.sourceSha, "b".repeat(40));
  assert.equal(evidence.identityWorkforce.sourceSha, null);
  assert.equal(evidence.coreApi.sourceSha, "c".repeat(40));
  assert.equal(evidence.crmPages.sourceSha, null);
  assert.throws(
    () => validateIncumbentProvenance(ids, {
      ...incumbentEvidence,
      coreApi: { ...incumbentEvidence.coreApi, versionId: ids.coreApi.candidate },
    }),
    /INCUMBENT_CONTROL_PLANE_INVALID/,
  );
});

test("candidate source evidence must match the exact release SHA", () => {
  assert.equal(validateSourceEvidence(null), null);
  assert.equal(validateSourceEvidence("b".repeat(40)), "b".repeat(40));
  assert.throws(
    () => validateSourceEvidence("b".repeat(40), config.releaseSha),
    /SOURCE_SHA_MISMATCH/,
  );
  assert.equal(validateSourceEvidence(config.releaseSha, config.releaseSha), config.releaseSha);
});

test("incumbent bundle classification skips only heterogeneous or incomplete releases", () => {
  assert.deepEqual(classifyIncumbentBundle(incumbentEvidence), {
    coherent: false,
    sourceShas: ["b".repeat(40), "c".repeat(40)],
    reason: "heterogeneous-or-incomplete-release-bundle",
  });
  assert.deepEqual(classifyIncumbentBundle(coherentIncumbentEvidence), {
    coherent: true,
    sourceShas: ["b".repeat(40)],
    reason: "coherent-release-bundle",
  });
});

test("heterogeneous incumbent health accepts a safe affinity mismatch without trusting gateway identity", () => {
  const expected = {
    timekeepingSourceSha: "b".repeat(40),
    timekeepingVersionId: ids.timekeeping.incumbent,
  };
  const payload = {
    ok: false,
    ready: false,
    service: "workforce-timekeeping",
    unit: "timekeeping",
    environment: "staging",
    database: true,
    dependencies: {
      module_control: { state: "unavailable" },
      gateway_affinity: { state: "unavailable", reason: "RELEASE_AFFINITY_MISMATCH" },
    },
    versionMetadata: {
      releaseSha: expected.timekeepingSourceSha,
      workerVersionId: expected.timekeepingVersionId,
      gatewayReleaseSha: "d".repeat(40),
      gatewayEnvironment: "staging",
      gatewayVersionId: ids.coreApi.incumbent,
    },
  };
  const headers = new Map([
    ["x-skincos-timekeeping-release-sha", expected.timekeepingSourceSha],
    ["x-skincos-timekeeping-environment", "staging"],
    ["x-skincos-timekeeping-version-id", expected.timekeepingVersionId],
  ]);

  assert.equal(isFailClosedIncumbentHealth({ status: 200, payload, headers, expected }), true);
  assert.equal(isFailClosedIncumbentHealth({
    status: 200,
    payload: { ...payload, ready: true },
    headers,
    expected,
  }), false);
});

class FakeRuntime {
  constructor(failAt = "", candidateSourceSha = config.releaseSha, incumbents = incumbentEvidence) {
    this.calls = [];
    this.moduleStateDetails = new Map();
    this.journeyExpected = new Map();
    this.failAt = failAt;
    this.candidateSourceSha = candidateSourceSha;
    this.incumbents = incumbents;
  }

  maybeFail(call) {
    if (this.failAt === call) throw new Error("sensitive provider detail must not reach the report");
  }

  async attestInitialState() {
    this.calls.push("preflight");
    this.maybeFail("preflight");
    return {
      moduleControl: { state: "maintenance", passed: true },
      surfaces: { passed: true },
      incumbents: this.incumbents,
    };
  }

  async deployWorker(surface, versionId, phase, expectedSha) {
    const call = `worker:${phase}:${surface}`;
    this.calls.push(call);
    this.maybeFail(call);
    const sourceSha = phase === "restoration" ? this.candidateSourceSha : null;
    validateSourceEvidence(sourceSha, expectedSha);
    const phasePrefix = {
      rollback: "9",
      restoration: "a",
      failureCompensation: "b",
    }[phase];
    const surfaceDigit = {
      timekeeping: "1",
      identityWorkforce: "2",
      coreApi: "3",
    }[surface];
    return {
      passed: true,
      worker: ids[surface].worker,
      versionId,
      deploymentId: `${phasePrefix}${surfaceDigit}111111-1111-4111-8111-111111111111`,
      percentage: 100,
      sourceSha,
    };
  }

  async deployPages(sourceDeploymentId, phase, expectedSha) {
    const call = `pages:${phase}`;
    this.calls.push(call);
    this.maybeFail(call);
    const commitHash = phase === "restoration" ? this.candidateSourceSha : null;
    validateSourceEvidence(commitHash, expectedSha);
    return {
      passed: true,
      sourceDeploymentId,
      activeDeploymentId: phase === "rollback"
        ? "91111111-1111-4111-8111-111111111111"
        : phase === "restoration"
          ? "a1111111-1111-4111-8111-111111111111"
          : "b1111111-1111-4111-8111-111111111111",
      url: `https://${phase}.skincos-staging.pages.dev/`,
      commitHash,
    };
  }

  async setModuleState(state, details, phase) {
    const call = `module:${phase}:${state}`;
    this.calls.push(call);
    this.moduleStateDetails.set(phase, { ...details });
    this.maybeFail(call);
    return {
      passed: true,
      state,
      releaseSha: details?.releaseSha || "",
      runId: String(this.calls.length),
    };
  }

  async proveIncumbentCompatibility(_pages, _expected) {
    const call = "incumbent:compatibility";
    this.calls.push(call);
    this.maybeFail(call);
    return {
      passed: true,
      mode: "heterogeneous-fail-closed-health",
      credentialsIncluded: false,
      piiIncluded: false,
    };
  }

  async prepareFixture(label) {
    const call = `fixture:${label}:prepare`;
    this.calls.push(call);
    this.maybeFail(call);
    return { label };
  }

  async proveCandidateAffinity(_pages, expected) {
    const call = this.calls.includes("candidate:affinity")
      ? "candidate:journey-fence"
      : "candidate:affinity";
    this.calls.push(call);
    this.maybeFail(call);
    return {
      passed: true,
      sourceSha: expected.sourceSha,
      gatewayVersionId: expected.coreVersionId,
      timekeepingVersionId: expected.timekeepingVersionId,
    };
  }

  async provisionFixture(handle) {
    const call = `fixture:${handle.label}:provision`;
    this.calls.push(call);
    this.maybeFail(call);
    return { passed: true };
  }

  async runJourney(handle, _url, expected) {
    const call = `fixture:${handle.label}:journey`;
    this.calls.push(call);
    this.journeyExpected.set(handle.label, { ...expected });
    this.maybeFail(call);
    return {
      passed: true,
      roleClass: "CONSULTOR",
      moduleKeys: ["atendimento", "ponto"],
      coreVersionId: expected.coreVersionId,
      timekeepingVersionId: expected.timekeepingVersionId,
      digest: "c".repeat(64),
    };
  }

  async verifyProtectedContract(handle, _url, expected) {
    const call = `fixture:${handle.label}:contract`;
    this.calls.push(call);
    this.maybeFail(call);
    return {
      passed: true,
      contract: "identity-workforce-hmac-v2",
      identityVersionId: expected.identityVersionId,
      digest: "d".repeat(64),
    };
  }

  async teardownFixture(handle) {
    const call = `fixture:${handle.label}:teardown`;
    this.calls.push(call);
    this.maybeFail(call);
    return {
      passed: true,
      coreResidualCount: 0,
      timekeepingResidualCount: 0,
      coreAuditPreserved: true,
      timekeepingAuditPreserved: true,
    };
  }
}

test("drill exercises two fresh fixtures and restores every exact candidate", async () => {
  const runtime = new FakeRuntime();
  const report = await runStagingRollbackDrill(config, runtime);

  assert.equal(report.passed, true);
  assert.equal(report.functionalValidation.implemented, true);
  assert.equal(report.functionalValidation.incumbentJourney.skipped, true);
  assert.equal(report.functionalValidation.incumbentJourney.passed, false);
  assert.equal(report.functionalValidation.incumbentJourney.blocking, true);
  assert.equal(report.functionalValidation.incumbentCompatibility.passed, true);
  assert.equal(report.functionalValidation.incumbentCompatibility.mode, "heterogeneous-fail-closed-health");
  assert.equal(report.teardown.incumbent.skipped, true);
  assert.equal(report.teardown.incumbent.notRequired, true);
  assert.equal(report.functionalValidation.candidateAffinity.passed, true);
  assert.equal(report.functionalValidation.candidateJourney.passed, true);
  assert.equal(report.functionalValidation.protectedCandidateContract.passed, true);
  assert.equal(report.teardown.incumbent.passed, true);
  assert.equal(report.teardown.candidate.passed, true);
  assert.equal(report.recovery.disposition, "candidate-restored-under-maintenance");
  assert.match(report.restoration.surfaces.timekeeping.deploymentId, /^[0-9a-f-]{36}$/);
  assert.match(report.restoration.surfaces.crmPages.activeDeploymentId, /^[0-9a-f-]{36}$/);
  assert.equal(report.credentialsIncluded, false);
  assert.equal(report.piiIncluded, false);
  const serialized = JSON.stringify(report);
  assert.equal(serialized.includes(config.incumbentDispatchNonce), false);
  assert.equal(serialized.includes(config.candidateDispatchNonce), false);
  assert.equal(serialized.includes(config.releaseProbeKey), false);
  assert.deepEqual(runtime.calls, [
    "preflight",
    "worker:rollback:timekeeping",
    "worker:rollback:identityWorkforce",
    "worker:rollback:coreApi",
    "pages:rollback",
    "module:incumbent-active:active",
    "incumbent:compatibility",
    "module:pre-restoration-maintenance:maintenance",
    "worker:restoration:timekeeping",
    "worker:restoration:identityWorkforce",
    "worker:restoration:coreApi",
    "pages:restoration",
    "module:candidate-active:active",
    "candidate:affinity",
    "fixture:candidate:prepare",
    "fixture:candidate:provision",
    "fixture:candidate:contract",
    "candidate:journey-fence",
    "fixture:candidate:journey",
    "fixture:candidate:teardown",
    "module:final-maintenance:maintenance",
  ]);
});

test("a candidate journey failure still restores candidates, validates restoration, and fails closed", async () => {
  const runtime = new FakeRuntime("fixture:candidate:journey");
  const report = await runStagingRollbackDrill(config, runtime);

  assert.equal(report.passed, false);
  assert.equal(report.restoration.passed, true);
  assert.equal(report.teardown.incumbent.skipped, true);
  assert.equal(report.functionalValidation.incumbentCompatibility.passed, true);
  assert.equal(report.teardown.candidate.passed, true);
  assert.equal(report.moduleControl.finalMaintenance.passed, true);
  assert(runtime.calls.includes("worker:restoration:timekeeping"));
  assert(runtime.calls.includes("worker:restoration:identityWorkforce"));
  assert(runtime.calls.includes("worker:restoration:coreApi"));
  assert(runtime.calls.includes("pages:restoration"));
  assert(runtime.calls.includes("fixture:candidate:contract"));
  assert(runtime.calls.includes("fixture:candidate:journey"));
  assert.equal(report.failureCompensation.passed, true);
  assert.equal(report.recovery.passed, true);
  assert.equal(report.recovery.disposition, "incumbents-restored-under-maintenance");
  assert(runtime.calls.includes("worker:failureCompensation:timekeeping"));
  assert(runtime.calls.includes("pages:failureCompensation"));
  assert.equal(runtime.calls.at(-1), "module:post-compensation-maintenance:maintenance");
  assert.equal(JSON.stringify(report).includes("sensitive provider detail"), false);
});

test("a heterogeneous incumbent compatibility smoke failure remains blocking", async () => {
  const runtime = new FakeRuntime("incumbent:compatibility");
  const report = await runStagingRollbackDrill(config, runtime);

  assert.equal(report.passed, false);
  assert.equal(report.functionalValidation.incumbentJourney.skipped, true);
  assert.equal(report.functionalValidation.incumbentJourney.passed, false);
  assert.equal(report.functionalValidation.incumbentCompatibility.passed, false);
  assert.deepEqual(
    report.failures.filter((failure) => failure.phase === "incumbent.compatibility").map((failure) => failure.code),
    ["UNEXPECTED_FAILURE"],
  );
  assert.equal(report.failureCompensation.passed, true);
  assert.equal(report.recovery.passed, true);
});

test("a coherent incumbent bundle receives the authenticated rollback journey", async () => {
  const runtime = new FakeRuntime("", config.releaseSha, coherentIncumbentEvidence);
  const report = await runStagingRollbackDrill(config, runtime);

  assert.equal(report.passed, true);
  assert.equal(report.functionalValidation.incumbentJourney.skipped, undefined);
  assert.equal(report.functionalValidation.incumbentJourney.passed, true);
  assert.equal(report.functionalValidation.incumbentCompatibility.attempted, false);
  assert.equal(report.teardown.incumbent.passed, true);
  assert(runtime.calls.includes("fixture:incumbent:journey"));
  assert.equal(runtime.moduleStateDetails.get("incumbent-active").releaseSha, "b".repeat(40));
  assert.equal(runtime.journeyExpected.get("incumbent").releaseSha, "b".repeat(40));
  assert.equal(runtime.journeyExpected.get("incumbent").sourceSha, "b".repeat(40));
});

test("a restoration failure attempts every remaining compensation and does not open the candidate", async () => {
  const runtime = new FakeRuntime("worker:restoration:identityWorkforce");
  const report = await runStagingRollbackDrill(config, runtime);

  assert.equal(report.passed, false);
  assert.equal(report.restoration.passed, false);
  assert(runtime.calls.includes("worker:restoration:coreApi"));
  assert(runtime.calls.includes("pages:restoration"));
  assert.equal(runtime.calls.includes("module:candidate-active:active"), false);
  assert.equal(runtime.calls.includes("fixture:candidate:prepare"), false);
  assert.equal(report.failureCompensation.passed, true);
  assert.equal(report.recovery.passed, true);
  assert.equal(runtime.calls.at(-1), "module:post-compensation-maintenance:maintenance");
});

test("a candidate source SHA mismatch fails every exact restoration check closed", async () => {
  const runtime = new FakeRuntime("", "d".repeat(40));
  const report = await runStagingRollbackDrill(config, runtime);

  assert.equal(report.passed, false);
  assert.equal(report.restoration.passed, false);
  assert.deepEqual(
    report.failures
      .filter((failure) => failure.phase.startsWith("restoration."))
      .map((failure) => failure.code),
    Array(4).fill("SOURCE_SHA_MISMATCH"),
  );
  assert.equal(runtime.calls.includes("module:candidate-active:active"), false);
  assert.equal(report.failureCompensation.passed, true);
  assert.equal(report.recovery.passed, true);
  assert.equal(runtime.calls.at(-1), "module:post-compensation-maintenance:maintenance");
});

test("failure after every candidate restoration compensates every surface to incumbents under maintenance", async () => {
  const runtime = new FakeRuntime("fixture:candidate:contract");
  const report = await runStagingRollbackDrill(config, runtime);

  assert.equal(report.passed, false);
  assert.equal(report.restoration.passed, true);
  assert.equal(report.failureCompensation.passed, true);
  assert.equal(report.moduleControl.preFailureCompensationMaintenance.passed, true);
  assert.equal(report.moduleControl.postCompensationMaintenance.passed, true);
  assert.equal(report.recovery.passed, true);
  assert.equal(report.recovery.disposition, "incumbents-restored-under-maintenance");
  for (const surface of ["timekeeping", "identityWorkforce", "coreApi"]) {
    assert.equal(report.failureCompensation.surfaces[surface].versionId, ids[surface].incumbent);
    assert.match(report.failureCompensation.surfaces[surface].deploymentId, /^[0-9a-f-]{36}$/);
  }
  assert.equal(
    report.failureCompensation.surfaces.crmPages.sourceDeploymentId,
    ids.crmPages.incumbent,
  );
  assert.equal(runtime.calls.at(-1), "module:post-compensation-maintenance:maintenance");
});

test("the executable and workflow retain no unimplemented hard-stop and require mandatory evidence", () => {
  const script = fs.readFileSync(new URL("./ponto-staging-rollback-drill.mjs", import.meta.url), "utf8");
  const workflow = fs.readFileSync(new URL("../workflows/ponto-staging-rollback-drill.yml", import.meta.url), "utf8");

  assert.doesNotMatch(script, /authenticated-incumbent-rollback-harness-not-implemented|implemented:\s*false/);
  assert.doesNotMatch(script, /after_json LIKE/);
  assert.match(workflow, /actions:\s*read/);
  assert.match(workflow, /checks:\s*write/);
  assert.match(workflow, /playwright install --with-deps chromium/);
  assert.match(workflow, /if-no-files-found:\s*error/);
  assert.match(workflow, /if:\s*always\(\)/);
  assert.match(workflow, /group:\s*ponto-surface-mutation/);
  assert.match(workflow, /TIMEKEEPING_STAGING_WRANGLER_CONFIG/);
  assert.match(script, /TIMEKEEPING_STAGING_WRANGLER_CONFIG/);
  assert.match(script, /latestProductionPagesDeployment/);
  assert.doesNotMatch(workflow, /delegated-capability-broker:|INCUMBENT_DISPATCH_NONCE:|CANDIDATE_DISPATCH_NONCE:/);
  assert.doesNotMatch(workflow, /rollback_(?:incumbent|candidate)_open_lease_token/i);
  const exercise = workflow.slice(
    workflow.indexOf("- name: Exercise exact incumbents"),
    workflow.indexOf("- name: Upload immutable staging rollback"),
  );
  assert.doesNotMatch(exercise, /PONTO_ORCHESTRATOR_CAPABILITY_PRIVATE_KEY/);
  assert.match(script, /delete childEnv\.PONTO_ORCHESTRATOR_CAPABILITY_PRIVATE_KEY/);
  assert.doesNotMatch(
    script.replace(/delete childEnv\.PONTO_ORCHESTRATOR_CAPABILITY_PRIVATE_KEY;/, ""),
    /delegatedCapability|PONTO_ORCHESTRATOR_CAPABILITY_PRIVATE_KEY/,
  );
  assert.match(script, /mutation:\s*"direct-signed-drill"/);
  assert.match(script, /module-control:timekeeping:emergency-latch/);
  assert.match(script, /ponto-module-propagation\.mjs/);
  assert.match(script, /MODULE_CONTROL_PROPAGATION_FAILED/);
  assert.match(script, /value\?\.latched !== false/);
  assert.match(script, /const latchBefore = readEmergencyLatch\(\)/);
  assert.match(script, /const latchAfter = readEmergencyLatch\(\)/);
  assert.doesNotMatch(script, /createCapabilityCheck|capabilityExternalId/);
  assert.match(script, /ponto-release-probe\/v1\./);
  assert.match(script, /"x-skincos-release-probe-sig":\s*signature/);
  assert.match(script, /incumbentCompatibility/);
  assert.match(script, /journeyFence/);
  assert.match(script, /journeyAttempts/);
  assert.match(script, /dependencies\?\.gateway_affinity\?\.state === "healthy"/);
  assert.match(script, /RELEASE_AFFINITY_MISMATCH/);
  assert.match(script, /createHmac\("sha256", idempotencyKey\)[\s\S]*skincos\/ponto\/release-probe\/v1[\s\S]*digest\("base64url"\)/);
  assert.match(workflow, /PONTO_IDEMPOTENCY_KEY:\s*\$\{\{\s*secrets\.PONTO_IDEMPOTENCY_KEY\s*\}\}/);
  assert.doesNotMatch(workflow, /secrets\.PONTO_RELEASE_PROBE_HMAC_KEY/);
});
