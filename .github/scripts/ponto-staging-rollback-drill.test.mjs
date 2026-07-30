import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import fs from "node:fs";
import test from "node:test";

import {
  loadConfig,
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

const config = {
  releaseSha: "a".repeat(40),
  runId: "12345",
  orchestratorRunId: "67890",
  predecessorRunId: "24680",
  repository: "skincos/skincos",
  rollbackOpenLeases: {
    incumbent: createHmac("sha256", "test-capability-root").update("incumbent").digest("base64url"),
    candidate: createHmac("sha256", "test-capability-root").update("candidate").digest("base64url"),
  },
  releaseProbeKey: createHmac("sha256", "test-capability-root").update("probe").digest("base64url"),
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

test("configuration derives the transient release-probe key and requires distinct delegated opens", () => {
  const idempotencyKey = "staging-idempotency-root-".repeat(2);
  const env = {
    RELEASE_SHA: config.releaseSha,
    GITHUB_RUN_ID: config.runId,
    GITHUB_REPOSITORY: config.repository,
    ORCHESTRATOR_RUN_ID: config.orchestratorRunId,
    ORCHESTRATOR_STAGE: "staging",
    ROLLBACK_INCUMBENT_OPEN_LEASE_TOKEN: config.rollbackOpenLeases.incumbent,
    ROLLBACK_CANDIDATE_OPEN_LEASE_TOKEN: config.rollbackOpenLeases.candidate,
    STAGING_JOURNEY_RUN_ID: config.predecessorRunId,
    CLOUDFLARE_ACCOUNT_ID: "d".repeat(32),
    CLOUDFLARE_API_TOKEN: "cloudflare-token",
    GH_TOKEN: "github-token",
    PONTO_IDEMPOTENCY_KEY: idempotencyKey,
    MODULE_CONTROL_STAGING_KV_ID: "e".repeat(32),
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
  assert.throws(
    () => loadConfig({
      ...env,
      ROLLBACK_CANDIDATE_OPEN_LEASE_TOKEN: env.ROLLBACK_INCUMBENT_OPEN_LEASE_TOKEN,
    }, ["/tmp/report.json"]),
    /MODULE_OPEN_CAPABILITIES_INVALID/,
  );
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

class FakeRuntime {
  constructor(failAt = "", candidateSourceSha = config.releaseSha) {
    this.calls = [];
    this.failAt = failAt;
    this.candidateSourceSha = candidateSourceSha;
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
      incumbents: incumbentEvidence,
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
    this.maybeFail(call);
    return {
      passed: true,
      state,
      releaseSha: details?.releaseSha || "",
      runId: String(this.calls.length),
    };
  }

  async prepareFixture(label) {
    const call = `fixture:${label}:prepare`;
    this.calls.push(call);
    this.maybeFail(call);
    return { label };
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
  assert.equal(report.functionalValidation.incumbentJourney.passed, true);
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
  assert.equal(serialized.includes(config.rollbackOpenLeases.incumbent), false);
  assert.equal(serialized.includes(config.rollbackOpenLeases.candidate), false);
  assert.equal(serialized.includes(config.releaseProbeKey), false);
  assert.deepEqual(runtime.calls, [
    "preflight",
    "worker:rollback:timekeeping",
    "worker:rollback:identityWorkforce",
    "worker:rollback:coreApi",
    "pages:rollback",
    "module:incumbent-active:active",
    "fixture:incumbent:prepare",
    "fixture:incumbent:provision",
    "fixture:incumbent:journey",
    "fixture:incumbent:teardown",
    "module:pre-restoration-maintenance:maintenance",
    "worker:restoration:timekeeping",
    "worker:restoration:identityWorkforce",
    "worker:restoration:coreApi",
    "pages:restoration",
    "module:candidate-active:active",
    "fixture:candidate:prepare",
    "fixture:candidate:provision",
    "fixture:candidate:contract",
    "fixture:candidate:journey",
    "fixture:candidate:teardown",
    "module:final-maintenance:maintenance",
  ]);
});

test("an incumbent journey failure still restores candidates, validates restoration, tears down both fixtures, and fails closed", async () => {
  const runtime = new FakeRuntime("fixture:incumbent:journey");
  const report = await runStagingRollbackDrill(config, runtime);

  assert.equal(report.passed, false);
  assert.equal(report.restoration.passed, true);
  assert.equal(report.teardown.incumbent.passed, true);
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
  assert.match(workflow, /actions:\s*write/);
  assert.match(workflow, /playwright install --with-deps chromium/);
  assert.match(workflow, /if-no-files-found:\s*error/);
  assert.match(workflow, /if:\s*always\(\)/);
  assert.match(workflow, /rollback_incumbent_open_lease_token:[^\n]+required:\s*true/);
  assert.match(workflow, /rollback_candidate_open_lease_token:[^\n]+required:\s*true/);
  assert.match(script, /orchestrator_release_sha:\s*config\.releaseSha/);
  assert.match(script, /orchestrator_lease_key:\s*delegatedCapability\.leaseKey/);
  assert.match(script, /"incumbent-active":\s*\{[\s\S]*leaseKey:\s*"rollback-incumbent-open"/);
  assert.match(script, /"candidate-active":\s*\{[\s\S]*leaseKey:\s*"rollback-candidate-open"/);
  assert.match(script, /ponto-release-probe\/v1\./);
  assert.match(script, /"x-skincos-release-probe-sig":\s*signature/);
  assert.match(script, /createHmac\("sha256", idempotencyKey\)[\s\S]*skincos\/ponto\/release-probe\/v1[\s\S]*digest\("base64url"\)/);
  assert.match(workflow, /PONTO_IDEMPOTENCY_KEY:\s*\$\{\{\s*secrets\.PONTO_IDEMPOTENCY_KEY\s*\}\}/);
  assert.doesNotMatch(workflow, /secrets\.PONTO_RELEASE_PROBE_HMAC_KEY/);
});
