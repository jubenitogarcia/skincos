import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

import {
  attestDrillState,
  attestRollbackIncumbents,
  attestRemoteCandidate,
  buildCandidateReceipt,
  buildDrillProof,
  preflightTimekeepingWorker,
  validateCanonicalDrillSource,
  validateCandidateInput,
} from "./ponto-core-staging-candidate.mjs";

const sourceSha = "a".repeat(40);
const sourceTree = "b".repeat(40);
const workflow = fs.readFileSync(path.resolve(import.meta.dirname, "../workflows/ponto-core-staging-candidate.yml"), "utf8");
const canonicalWorkflow = fs.readFileSync(path.resolve(import.meta.dirname, "../workflows/deploy-core-workers.yml"), "utf8");
const ids = {
  timekeepingCandidate: "11111111-1111-4111-8111-111111111111",
  timekeepingIncumbent: "11111111-1111-4111-8111-111111111112",
  timekeepingDeployment: "11111111-1111-4111-8111-111111111113",
  timekeepingOtherDeployment: "11111111-1111-4111-8111-111111111114",
  coreCandidate: "22222222-2222-4222-8222-222222222221",
  coreIncumbent: "22222222-2222-4222-8222-222222222222",
  coreDeployment: "22222222-2222-4222-8222-222222222223",
  identityCandidate: "33333333-3333-4333-8333-333333333331",
  identityIncumbent: "33333333-3333-4333-8333-333333333332",
  identityDeployment: "33333333-3333-4333-8333-333333333333",
};

function bashBlocks(source) {
  const lines = source.split(/\r?\n/);
  const blocks = [];
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const marker = line.match(/^(\s*)run: \|\s*$/);
    if (!marker) continue;
    const contentIndent = marker[1].length + 2;
    const block = [];
    for (index += 1; index < lines.length; index += 1) {
      const candidate = lines[index];
      if (candidate.trim() && candidate.match(/^\s*/)[0].length < contentIndent) {
        index -= 1;
        break;
      }
      block.push(candidate.startsWith(" ".repeat(contentIndent)) ? candidate.slice(contentIndent) : candidate);
    }
    blocks.push(block.join("\n"));
  }
  return blocks;
}

function workflowStep(source, name) {
  const start = source.indexOf(`      - name: ${name}`);
  assert.notEqual(start, -1, `missing workflow step: ${name}`);
  const end = source.indexOf("\n      - name:", start + 1);
  return source.slice(start, end === -1 ? undefined : end);
}

function run(id, workflowPath) {
  return {
    runId: id,
    workflowPath,
    event: "workflow_dispatch",
    status: "completed",
    conclusion: "success",
    runAttempt: 1,
    headSha: sourceSha,
    headBranch: "main",
    repository: "jubenitogarcia/skincos",
    headRepository: "jubenitogarcia/skincos",
  };
}

function mutation(surface, runId) {
  return {
    schemaVersion: 1,
    surface,
    stage: "staging",
    sourceSha,
    runId,
    mutationStarted: true,
    mutationCompleted: true,
    rollbackCompleted: false,
    compensationDisposition: "not-run",
    credentialsIncluded: false,
    piiIncluded: false,
  };
}

function input() {
  return {
    schemaVersion: 1,
    source: {
      repository: "jubenitogarcia/skincos",
      sha: sourceSha,
      tree: sourceTree,
      candidateRunId: "901",
    },
    upstream: {
      timekeeping: {
        run: run("101", ".github/workflows/deploy-timekeeping.yml"),
        surface: {
          schemaVersion: 1,
          surface: "timekeeping",
          stage: "staging",
          sourceSha,
          runId: "101",
          candidateVersionId: ids.timekeepingCandidate,
          incumbentVersionId: ids.timekeepingIncumbent,
          candidatePercent: 100,
          incumbentPercent: 0,
          candidateTag: `ponto:timekeeping:${sourceSha}`,
        },
      },
      core: {
        run: run("102", ".github/workflows/deploy-core-workers.yml"),
        surface: {
          schemaVersion: 1,
          surface: "coreApi",
          stage: "staging",
          sourceSha,
          runId: "102",
          candidateVersionId: ids.coreCandidate,
          incumbentVersionId: ids.coreIncumbent,
          deploymentId: ids.coreDeployment,
          candidatePercent: 100,
          incumbentPercent: 0,
          candidateTag: `ponto:coreApi:${sourceSha}`,
          serviceName: "skincos-ponto-core-staging",
          routeIsolated: true,
        },
        mutation: mutation("coreApi", "102"),
      },
      identity: {
        run: run("103", ".github/workflows/deploy-core-workers.yml"),
        surface: {
          schemaVersion: 1,
          surface: "identityWorkforce",
          stage: "staging",
          sourceSha,
          runId: "103",
          candidateVersionId: ids.identityCandidate,
          incumbentVersionId: ids.identityIncumbent,
          deploymentId: ids.identityDeployment,
          candidatePercent: 100,
          incumbentPercent: 0,
          candidateTag: `ponto:identityWorkforce:${sourceSha}`,
          timekeepingVersionId: ids.timekeepingCandidate,
        },
        mutation: mutation("identityWorkforce", "103"),
      },
    },
  };
}

function remote() {
  return {
    schemaVersion: 1,
    core: {
      worker: "skincos-ponto-core-staging",
      activeVersionId: ids.coreCandidate,
      activeDeploymentId: ids.coreDeployment,
      versionMessage: `ponto:coreApi:${sourceSha}`,
      appVersion: sourceSha,
      environment: "staging",
      serviceBinding: "skincos-timekeeping-staging",
      timekeepingVersionId: ids.timekeepingCandidate,
      routeOnly: true,
      versionMetadata: true,
      exposure: {
        workerRouteCount: 0,
        workerRoutes: [],
        customDomainCount: 0,
        customDomains: [],
        workersDevEnabled: false,
        previewUrlsEnabled: false,
      },
    },
    identity: {
      worker: "skincos-insumos-staging",
      activeVersionId: ids.identityCandidate,
      activeDeploymentId: ids.identityDeployment,
      versionMessage: `ponto:identityWorkforce:${sourceSha}`,
      appVersion: sourceSha,
      environment: "staging",
      serviceBinding: "skincos-timekeeping-staging",
      timekeepingVersionId: ids.timekeepingCandidate,
      versionMetadata: true,
      exposure: {
        workerRouteCount: 1,
        workerRoutes: ["api-staging.skincos.com.br/insumos/*"],
        customDomainCount: 0,
        customDomains: [],
        workersDevEnabled: false,
        previewUrlsEnabled: false,
      },
    },
  };
}

function timekeepingRemote() {
  return {
    worker: "skincos-timekeeping-staging",
    activeVersionId: ids.timekeepingCandidate,
    activeDeploymentId: ids.timekeepingDeployment,
    versionMessage: `ponto:timekeeping:${sourceSha}`,
    appVersion: sourceSha,
    environment: "staging",
    serviceBinding: "",
    timekeepingVersionId: "",
    routeOnly: false,
    versionMetadata: true,
    exposure: {
      workerRouteCount: 0,
      workerRoutes: [],
      customDomainCount: 0,
      customDomains: [],
      workersDevEnabled: false,
      previewUrlsEnabled: false,
    },
  };
}

function health() {
  return {
    passed: true,
    version: sourceSha,
    environment: "staging",
    workerVersionId: ids.identityCandidate,
    workerVersionTag: `ponto:identityWorkforce:${sourceSha}`,
  };
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function drillConfig(surface) {
  const isCore = surface === "coreApi";
  return {
    schemaVersion: 1,
    source: {
      repository: "jubenitogarcia/skincos",
      sha: sourceSha,
      tree: sourceTree,
      runId: isCore ? "102" : "103",
      ref: "refs/heads/main",
      releaseSha: sourceSha,
      refTargetSha: sourceSha,
      runAttempt: 1,
    },
    subject: {
      surface,
      candidateVersionId: isCore ? ids.coreCandidate : ids.identityCandidate,
      incumbentVersionId: isCore ? ids.coreIncumbent : ids.identityIncumbent,
      timekeepingVersionId: ids.timekeepingCandidate,
    },
    ...(isCore ? {} : { coreCandidateVersionId: ids.coreCandidate }),
  };
}

function stateFor(surface, phase) {
  if (phase === "composite") {
    return {
      schemaVersion: 1,
      phase,
      core: remote().core,
      identity: remote().identity,
      timekeeping: timekeepingRemote(),
    };
  }
  const subject = surface === "coreApi" ? remote().core : remote().identity;
  if (phase === "incumbent") {
    subject.activeVersionId = surface === "coreApi" ? ids.coreIncumbent : ids.identityIncumbent;
  }
  return { schemaVersion: 1, phase, subject, timekeeping: timekeepingRemote() };
}

function drillProof(surface) {
  return buildDrillProof({
    config: drillConfig(surface),
    before: stateFor(surface, "candidate"),
    rollback: stateFor(surface, "incumbent"),
    restoration: stateFor(surface, "candidate"),
    composite: surface === "identityWorkforce" ? stateFor(surface, "composite") : null,
    readiness: surface === "identityWorkforce" ? health() : { passed: true, mode: "control-plane-only" },
    context: {
      maintenance: { passed: true, state: "maintenance" },
      lease: {
        resource: "global:ponto-workers-writer",
        revalidatedBeforeRollback: true,
        revalidatedBeforeRestore: true,
      },
      recovery: { attempted: false, disposition: "not-required" },
      ...(surface === "identityWorkforce" ? { bindingBefore: stateFor(surface, "composite") } : {}),
      timekeepingPreflight: {
        schemaVersion: 1,
        passed: true,
        configuredPhysicalWorker: "skincos-timekeeping-staging",
        expectedVersionId: ids.timekeepingCandidate,
        expectedTag: `ponto:timekeeping:${sourceSha}`,
        expectedSourceSha: sourceSha,
        observed: {
          state: "exact",
          worker: "skincos-timekeeping-staging",
          activeVersionId: ids.timekeepingCandidate,
          activeDeploymentId: ids.timekeepingDeployment,
        },
        valuesIncluded: false,
        credentialsIncluded: false,
        piiIncluded: false,
      },
    },
  });
}

test("builds only a source-bound, private, same-artifact candidate receipt", () => {
  const receipt = buildCandidateReceipt({ input: input(), coreDrill: drillProof("coreApi"), identityDrill: drillProof("identityWorkforce") });
  assert.equal(receipt.contractId, "skincos/ponto-core-staging-candidate/v1");
  assert.equal(receipt.sourceSha, sourceSha);
  assert.equal(receipt.sourceRef, "refs/heads/main");
  assert.equal(receipt.sourceLogicalBranch, "main");
  assert.equal(receipt.sourceRefTargetSha, sourceSha);
  assert.equal(receipt.core.versionId, ids.coreCandidate);
  assert.equal(receipt.identity.versionId, ids.identityCandidate);
  assert.deepEqual(receipt.coreExposure.workerRoutes, []);
  assert.deepEqual(receipt.identityExposure.workerRoutes, ["api-staging.skincos.com.br/insumos/*"]);
  assert.equal(receipt.rollback.passed, true);
  assert.equal(receipt.timekeeping.versionId, ids.timekeepingCandidate);
  assert.equal(receipt.timekeeping.configuredPhysicalWorker, "skincos-timekeeping-staging");
  assert.equal(receipt.timekeeping.observedPhysicalWorker, "skincos-timekeeping-staging");
  assert.equal(receipt.credentialsIncluded, false);
  assert.equal(receipt.piiIncluded, false);
});

test("accepts only the exact immutable Ponto tag and records it separately from logical main", () => {
  const tag = `skincos/release/ponto/${sourceSha}`;
  const tagged = input();
  for (const child of Object.values(tagged.upstream)) {
    child.run.headBranch = tag;
    child.run.releaseRef = `refs/tags/${tag}`;
    child.run.releaseTagObjectType = "commit";
    child.run.releaseTagTarget = sourceSha;
  }
  assert.doesNotThrow(() => validateCandidateInput(tagged));

  const taggedConfig = drillConfig("coreApi");
  taggedConfig.source.ref = `refs/tags/${tag}`;
  taggedConfig.source.refTargetSha = sourceSha;
  const taggedProof = buildDrillProof({
    config: taggedConfig,
    before: stateFor("coreApi", "candidate"),
    rollback: stateFor("coreApi", "incumbent"),
    restoration: stateFor("coreApi", "candidate"),
    composite: null,
    readiness: { passed: true, mode: "control-plane-only" },
    context: {
      maintenance: { passed: true, state: "maintenance" },
      lease: { resource: "global:ponto-workers-writer", revalidatedBeforeRollback: true, revalidatedBeforeRestore: true },
      recovery: { attempted: false, disposition: "not-required" },
      timekeepingPreflight: {
        schemaVersion: 1,
        passed: true,
        configuredPhysicalWorker: "skincos-timekeeping-staging",
        expectedVersionId: ids.timekeepingCandidate,
        expectedTag: `ponto:timekeeping:${sourceSha}`,
        expectedSourceSha: sourceSha,
        observed: {
          state: "exact",
          worker: "skincos-timekeeping-staging",
          activeVersionId: ids.timekeepingCandidate,
          activeDeploymentId: ids.timekeepingDeployment,
        },
        valuesIncluded: false,
        credentialsIncluded: false,
        piiIncluded: false,
      },
    },
  });
  assert.equal(taggedProof.source.ref, `refs/tags/${tag}`);
  assert.equal(taggedProof.source.logicalBranch, "main");
  assert.equal(taggedProof.producer.refTargetSha, sourceSha);

  const retagProof = (proof) => {
    const retagged = clone(proof);
    retagged.source.ref = `refs/tags/${tag}`;
    retagged.source.logicalBranch = "main";
    retagged.source.refTargetSha = sourceSha;
    retagged.producer.ref = `refs/tags/${tag}`;
    retagged.producer.logicalBranch = "main";
    retagged.producer.refTargetSha = sourceSha;
    return retagged;
  };
  const taggedReceipt = buildCandidateReceipt({
    input: tagged,
    coreDrill: retagProof(drillProof("coreApi")),
    identityDrill: retagProof(drillProof("identityWorkforce")),
  });
  assert.equal(taggedReceipt.sourceRef, `refs/tags/${tag}`);
  assert.equal(taggedReceipt.sourceLogicalBranch, "main");

  const exactTagSource = validateCanonicalDrillSource({
    ref: `refs/tags/${tag}`,
    sha: sourceSha,
    releaseSha: sourceSha,
    refTargetSha: sourceSha,
    runAttempt: 1,
  });
  assert.deepEqual(exactTagSource, {
    ref: `refs/tags/${tag}`,
    logicalBranch: "main",
    refTargetSha: sourceSha,
    runAttempt: 1,
  });

  const mismatchedTag = input();
  mismatchedTag.upstream.core.run.headBranch = tag;
  mismatchedTag.upstream.core.run.releaseRef = `refs/tags/${tag}`;
  mismatchedTag.upstream.core.run.releaseTagObjectType = "commit";
  mismatchedTag.upstream.core.run.releaseTagTarget = "c".repeat(40);
  assert.throws(() => validateCandidateInput(mismatchedTag), /PONTO_CORE_STAGING_CANDIDATE_INVALID:CORE_RUN_TAG/);
  const mixedPhysicalRefs = input();
  mixedPhysicalRefs.upstream.core.run.headBranch = tag;
  mixedPhysicalRefs.upstream.core.run.releaseRef = `refs/tags/${tag}`;
  mixedPhysicalRefs.upstream.core.run.releaseTagObjectType = "commit";
  mixedPhysicalRefs.upstream.core.run.releaseTagTarget = sourceSha;
  assert.throws(() => validateCandidateInput(mixedPhysicalRefs), /PONTO_CORE_STAGING_CANDIDATE_INVALID:UPSTREAM_SOURCE_REF/);
  assert.throws(() => validateCanonicalDrillSource({
    ref: `refs/tags/${tag}`,
    sha: sourceSha,
    releaseSha: sourceSha,
    refTargetSha: "c".repeat(40),
    runAttempt: 1,
  }), /PONTO_CORE_STAGING_CANDIDATE_INVALID:DRILL_SOURCE_TAG/);
});

test("rejects forged child provenance, public exposure, and non-exact canonical drill evidence", () => {
  const forgedRun = input();
  forgedRun.upstream.core.run.workflowPath = ".github/workflows/deploy-crm-pages.yml";
  assert.throws(() => validateCandidateInput(forgedRun), /PONTO_CORE_STAGING_CANDIDATE_INVALID:CORE_RUN_PROVENANCE/);

  const foreignHead = input();
  foreignHead.upstream.identity.run.headRepository = "untrusted/fork";
  assert.throws(() => validateCandidateInput(foreignHead), /PONTO_CORE_STAGING_CANDIDATE_INVALID:IDENTITY_RUN_PROVENANCE/);

  const publicCore = drillProof("identityWorkforce");
  publicCore.restoration.composite.core.exposure.workerRouteCount = 1;
  publicCore.restoration.composite.core.exposure.workerRoutes = ["api-staging.skincos.com.br/*"];
  assert.throws(
    () => buildCandidateReceipt({ input: input(), coreDrill: drillProof("coreApi"), identityDrill: publicCore }),
    /PONTO_CORE_STAGING_CANDIDATE_INVALID:CORE_EXPOSURE/,
  );

  const routableCore = drillProof("identityWorkforce");
  routableCore.restoration.composite.core.routeOnly = false;
  assert.throws(
    () => buildCandidateReceipt({ input: input(), coreDrill: drillProof("coreApi"), identityDrill: routableCore }),
    /PONTO_CORE_STAGING_CANDIDATE_INVALID:CORE_REMOTE_ROUTE_ONLY/,
  );

  const wrongTimekeeping = drillProof("identityWorkforce");
  wrongTimekeeping.restoration.composite.timekeeping.activeVersionId = ids.timekeepingIncumbent;
  assert.throws(
    () => buildCandidateReceipt({ input: input(), coreDrill: drillProof("coreApi"), identityDrill: wrongTimekeeping }),
    /PONTO_CORE_STAGING_CANDIDATE_INVALID:TIMEKEEPING_REMOTE_IDENTITY/,
  );

  const missingMetadata = drillProof("identityWorkforce");
  missingMetadata.restoration.composite.core.versionMetadata = false;
  assert.throws(
    () => buildCandidateReceipt({ input: input(), coreDrill: drillProof("coreApi"), identityDrill: missingMetadata }),
    /PONTO_CORE_STAGING_CANDIDATE_INVALID:CORE_VERSION_METADATA/,
  );

  const incompleteRollback = drillProof("identityWorkforce");
  incompleteRollback.restoration.completed = false;
  assert.throws(
    () => buildCandidateReceipt({ input: input(), coreDrill: drillProof("coreApi"), identityDrill: incompleteRollback }),
    /PONTO_CORE_STAGING_CANDIDATE_INVALID:DRILL_RESTORATION_SHAPE/,
  );

  const unobservedRollback = drillProof("coreApi");
  unobservedRollback.rollback.state.subject.activeVersionId = ids.coreCandidate;
  assert.throws(
    () => buildCandidateReceipt({ input: input(), coreDrill: unobservedRollback, identityDrill: drillProof("identityWorkforce") }),
    /PONTO_CORE_STAGING_CANDIDATE_INVALID:DRILL_INCUMBENT_REMOTE_IDENTITY/,
  );

  const wrongCoreBinding = drillProof("identityWorkforce");
  wrongCoreBinding.target.coreCandidateVersionId = ids.coreIncumbent;
  assert.throws(
    () => buildCandidateReceipt({ input: input(), coreDrill: drillProof("coreApi"), identityDrill: wrongCoreBinding }),
    /PONTO_CORE_STAGING_CANDIDATE_INVALID:DRILL_PROOF_BINDING/,
  );

  const inactiveCoreBeforeIdentityRollback = drillProof("identityWorkforce");
  inactiveCoreBeforeIdentityRollback.bindingBefore.core.activeVersionId = ids.coreIncumbent;
  assert.throws(
    () => buildCandidateReceipt({ input: input(), coreDrill: drillProof("coreApi"), identityDrill: inactiveCoreBeforeIdentityRollback }),
    /PONTO_CORE_STAGING_CANDIDATE_INVALID:CORE_REMOTE_IDENTITY/,
  );

  const changedTimekeepingDeployment = drillProof("identityWorkforce");
  changedTimekeepingDeployment.restoration.composite.timekeeping.activeDeploymentId = ids.timekeepingOtherDeployment;
  assert.throws(
    () => buildCandidateReceipt({ input: input(), coreDrill: drillProof("coreApi"), identityDrill: changedTimekeepingDeployment }),
    /PONTO_CORE_STAGING_CANDIDATE_INVALID:TIMEKEEPING_CONTINUITY/,
  );
});

test("collects a sanitized remote snapshot with exact candidate identities", async () => {
  const accountId = "a".repeat(32);
  const zoneId = "b".repeat(32);
  let coreActive = ids.coreCandidate;
  let identityActive = ids.identityCandidate;
  let timekeepingActive = ids.timekeepingCandidate;
  let timekeepingListed = true;
  const requests = [];
  const payload = (result, resultInfo = null) => ({
    ok: true,
    status: 200,
    async json() { return { success: true, result, result_info: resultInfo }; },
  });
  const fetchImpl = async (request, options = {}) => {
    const url = new URL(request);
    const pathname = url.pathname.replace("/client/v4", "");
    requests.push({ pathname, method: options.method || "GET" });
    if (pathname === `/accounts/${accountId}/workers/scripts`) {
      const scripts = [
        { id: "skincos-ponto-core-staging" },
        { id: "skincos-insumos-staging" },
      ];
      if (timekeepingListed) scripts.push({ id: "skincos-timekeeping-staging" });
      return payload(scripts);
    }
    if (pathname === "/zones") {
      return payload([{ id: zoneId, name: "example", account: { id: accountId } }], { total_count: 1, total_pages: 1 });
    }
    if (pathname === `/zones/${zoneId}/workers/routes`) {
      return payload([{ script: "skincos-insumos-staging", pattern: "api-staging.skincos.com.br/insumos/*" }]);
    }
    if (pathname === `/accounts/${accountId}/workers/domains`) return payload([], { total_count: 0, total_pages: 1 });
    if (pathname.endsWith("/subdomain")) return payload({ enabled: false, previews_enabled: false });
    if (pathname.endsWith("skincos-ponto-core-staging/deployments")) {
      return payload({ deployments: [{ id: ids.coreDeployment, created_on: "2026-09-10T00:00:00Z", versions: [{ version_id: coreActive, percentage: 100 }] }] });
    }
    if (pathname.endsWith("skincos-insumos-staging/deployments")) {
      return payload({ deployments: [{ id: ids.identityDeployment, created_on: "2026-09-10T00:00:00Z", versions: [{ version_id: identityActive, percentage: 100 }] }] });
    }
    if (pathname.endsWith("skincos-timekeeping-staging/deployments")) {
      return payload({ deployments: [{ id: ids.timekeepingDeployment, created_on: "2026-09-10T00:00:00Z", versions: [{ version_id: timekeepingActive, percentage: 100 }] }] });
    }
    if (pathname.endsWith(`/skincos-ponto-core-staging/versions/${coreActive}`)) {
      return payload({ id: coreActive, annotations: { "workers/message": `ponto:coreApi:${sourceSha}` }, resources: { bindings: [
        { name: "APP_VERSION", type: "plain_text", text: sourceSha },
        { name: "ENVIRONMENT", type: "plain_text", text: "staging" },
        { name: "PONTO_ROUTE_ONLY", type: "plain_text", text: "true" },
        { name: "TIMEKEEPING_VERSION_ID", type: "plain_text", text: ids.timekeepingCandidate },
        { name: "CF_VERSION_METADATA", type: "version_metadata" },
        { name: "TIMEKEEPING", type: "service", service: "skincos-timekeeping-staging" },
      ] } });
    }
    if (pathname.endsWith(`/skincos-insumos-staging/versions/${identityActive}`)) {
      return payload({ id: identityActive, annotations: { "workers/message": `ponto:identityWorkforce:${sourceSha}` }, resources: { bindings: [
        { name: "APP_VERSION", type: "plain_text", text: sourceSha },
        { name: "ENVIRONMENT", type: "plain_text", text: "staging" },
        { name: "TIMEKEEPING_VERSION_ID", type: "plain_text", text: ids.timekeepingCandidate },
        { name: "CF_VERSION_METADATA", type: "version_metadata" },
        { name: "WORKFORCE", type: "service", service: "skincos-timekeeping-staging" },
      ] } });
    }
    if (pathname.endsWith(`/skincos-timekeeping-staging/versions/${timekeepingActive}`)) {
      return payload({ id: timekeepingActive, annotations: { "workers/message": `ponto:timekeeping:${sourceSha}` }, resources: { bindings: [
        { name: "APP_VERSION", type: "plain_text", text: sourceSha },
        { name: "ENVIRONMENT", type: "plain_text", text: "staging" },
        { name: "VERSION_METADATA", type: "version_metadata" },
      ] } });
    }
    throw new Error(`unexpected request: ${pathname}`);
  };
  const candidate = validateCandidateInput(input());
  const observed = await attestRemoteCandidate({ candidate, accountId, apiToken: "synthetic-token", fetchImpl });
  assert.equal(observed.core.activeVersionId, ids.coreCandidate);
  assert.equal(observed.identity.activeVersionId, ids.identityCandidate);
  assert.equal(observed.credentialsIncluded, false);
  assert.equal(observed.piiIncluded, false);

  const composite = await attestDrillState({
    config: drillConfig("identityWorkforce"),
    phase: "composite",
    accountId,
    apiToken: "synthetic-token",
    fetchImpl,
  });
  assert.equal(composite.core.activeVersionId, ids.coreCandidate);
  assert.equal(composite.identity.activeVersionId, ids.identityCandidate);
  assert.equal(composite.timekeeping.activeVersionId, ids.timekeepingCandidate);
  assert.equal(composite.timekeeping.versionMessage, `ponto:timekeeping:${sourceSha}`);

  const exactMapping = await preflightTimekeepingWorker({
    config: drillConfig("coreApi"),
    accountId,
    apiToken: "synthetic-token",
    fetchImpl,
  });
  assert.equal(exactMapping.passed, true);
  assert.equal(exactMapping.observed.state, "exact");
  assert.equal(exactMapping.configuredPhysicalWorker, "skincos-timekeeping-staging");

  requests.length = 0;
  timekeepingListed = false;
  const absentMapping = await preflightTimekeepingWorker({
    config: drillConfig("coreApi"),
    accountId,
    apiToken: "synthetic-token",
    fetchImpl,
  });
  assert.equal(absentMapping.passed, false);
  assert.deepEqual(absentMapping.observed, { state: "absent", worker: null });
  assert.deepEqual(requests, [{ pathname: `/accounts/${accountId}/workers/scripts`, method: "GET" }]);

  requests.length = 0;
  timekeepingListed = true;
  timekeepingActive = ids.timekeepingIncumbent;
  const mismatchedMapping = await preflightTimekeepingWorker({
    config: drillConfig("coreApi"),
    accountId,
    apiToken: "synthetic-token",
    fetchImpl,
  });
  assert.equal(mismatchedMapping.passed, false);
  assert.equal(mismatchedMapping.observed.state, "mismatch");
  assert.equal(mismatchedMapping.observed.worker, "skincos-timekeeping-staging");
  assert.ok(requests.every(({ method }) => method === "GET"));
  timekeepingActive = ids.timekeepingCandidate;

  coreActive = ids.coreIncumbent;
  identityActive = ids.identityIncumbent;
  const rollbackState = await attestRollbackIncumbents({ candidate, accountId, apiToken: "synthetic-token", fetchImpl });
  assert.equal(rollbackState.core.activeVersionId, ids.coreIncumbent);
  assert.equal(rollbackState.identity.activeVersionId, ids.identityIncumbent);
  assert.equal(rollbackState.valuesIncluded, false);
});

test("candidate workflow is a main-only, secretless canonical-artifact attester", () => {
  for (const marker of [
    "workflow_dispatch:",
    "[[ \"$GITHUB_REF\" == refs/heads/main ]]",
    "ponto-surface-timekeeping-staging-$RELEASE_SHA",
    "ponto-surface-core-api-staging-$RELEASE_SHA",
    "ponto-surface-identity-workforce-staging-$RELEASE_SHA",
    "ponto-core-staging-rollback-drill-coreApi-$RELEASE_SHA",
    "ponto-core-staging-rollback-drill-identityWorkforce-$RELEASE_SHA",
    "git/ref/tags/$head_branch",
    "releaseTagTarget",
    "Build the Pages-consumable candidate from canonical-only evidence",
    "node .github/scripts/ponto-core-staging-candidate.mjs build-receipt",
  ]) assert.ok(workflow.includes(marker), marker);
  for (const forbidden of [
    "CLOUDFLARE_API_TOKEN",
    "CLOUDFLARE_ACCOUNT_ID",
    "environment: staging",
    "global-coordination",
    "wrangler rollback",
    "wrangler versions deploy",
    "versions upload",
    " d1 migrations ",
    " secret put ",
    "pages deploy",
    "--env production",
    "routes =",
  ]) assert.equal(workflow.includes(forbidden), false, forbidden);
});

test("only the canonical deploy workflow owns optional same-artifact traffic drill commands", () => {
  for (const marker of [
    "same_artifact_rollback_drill:",
    "core_candidate_version_id:",
    "ponto-core-staging-rollback-drill-coreApi-",
    "ponto-core-staging-rollback-drill-identityWorkforce-",
    "Read exact Core and Timekeeping state before the drill",
    "Read exact Identity and Timekeeping state before the drill",
    "Bind exact Core Identity and Timekeeping candidates before the drill",
    "attest-drill-state",
    "preflight-timekeeping-worker",
    "probe-drill-identity",
    "needs: [coordination, promotion]",
  ]) assert.ok(canonicalWorkflow.includes(marker), marker);
  assert.equal(canonicalWorkflow.includes("ponto-core-staging-candidate.yml"), false);
  assert.equal(workflow.includes("same_artifact_rollback_drill"), false);
  assert.ok(
    canonicalWorkflow.indexOf("preflight-timekeeping-worker")
      < canonicalWorkflow.indexOf('inventory/node_modules/.bin/wrangler rollback "$incumbent"'),
  );
  assert.ok(
    canonicalWorkflow.lastIndexOf("preflight-timekeeping-worker")
      < canonicalWorkflow.indexOf('api/node_modules/.bin/wrangler rollback "$incumbent"'),
  );
});

test("canonical drill provenance accepts only the exact release tag and recovery requires a successful lease recheck", () => {
  for (const [guardName, sourceFile] of [
    ["Guard the canonical same-artifact staging Identity rollback drill", "identity-staging-drill/source.json"],
    ["Guard the canonical same-artifact Ponto Core staging rollback drill", "core-staging-drill/source.json"],
  ]) {
    const guard = workflowStep(canonicalWorkflow, guardName);
    assert.match(guard, /\[\[ "\$GITHUB_REF" == refs\/heads\/main \]\]/);
    assert.match(guard, /refs\/tags\/skincos\/release\/ponto\/\$RELEASE_SHA/);
    assert.match(guard, /git ls-remote --refs origin "\$GITHUB_REF"/);
    assert.match(guard, /PONTO_DRILL_SOURCE_REF_TARGET_SHA/);
    assert.match(guard, new RegExp(`assert-drill-source "\\$RUNNER_TEMP/${sourceFile.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}"`));
  }

  const identityRecheck = workflowStep(canonicalWorkflow, "Revalidate the global lease before interrupted Identity drill recovery");
  const identityRestore = workflowStep(canonicalWorkflow, "Restore the exact Identity candidate after an interrupted drill");
  assert.match(identityRecheck, /id: identity_drill_recovery_lease/);
  assert.match(identityRestore, /steps\.identity_drill_recovery_lease\.outcome == 'success'/);
  assert.match(identityRestore, /rollback-started/);

  const coreRecheck = workflowStep(canonicalWorkflow, "Revalidate the global lease before interrupted Ponto Core drill recovery");
  const coreRestore = workflowStep(canonicalWorkflow, "Restore the exact Ponto Core candidate after an interrupted drill");
  assert.match(coreRecheck, /id: core_drill_recovery_lease/);
  assert.match(coreRestore, /steps\.core_drill_recovery_lease\.outcome == 'success'/);
  assert.match(coreRestore, /rollback-started/);
});

test("every embedded workflow Bash block is syntactically valid", () => {
  for (const [name, source] of [["candidate", workflow], ["canonical", canonicalWorkflow]]) {
    const blocks = bashBlocks(source);
    assert.ok(blocks.length > 0, `${name} should contain Bash blocks`);
    for (const block of blocks) {
      const syntax = spawnSync("bash", ["-n"], { input: block, encoding: "utf8" });
      assert.equal(syntax.status, 0, syntax.stderr || `${name} workflow Bash syntax failed`);
    }
  }
});
