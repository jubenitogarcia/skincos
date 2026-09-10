import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

import {
  attestRollbackIncumbents,
  attestRemoteCandidate,
  buildCandidateReceipt,
  validateCandidateInput,
} from "./ponto-core-staging-candidate.mjs";

const sourceSha = "a".repeat(40);
const sourceTree = "b".repeat(40);
const workflow = fs.readFileSync(path.resolve(import.meta.dirname, "../workflows/ponto-core-staging-candidate.yml"), "utf8");
const ids = {
  timekeepingCandidate: "11111111-1111-4111-8111-111111111111",
  timekeepingIncumbent: "11111111-1111-4111-8111-111111111112",
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

function run(id, workflowPath) {
  return {
    runId: id,
    workflowPath,
    event: "workflow_dispatch",
    status: "completed",
    conclusion: "success",
    runAttempt: 1,
    headSha: sourceSha,
    headBranch: `skincos/release/ponto/${sourceSha}`,
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

function health() {
  return {
    passed: true,
    version: sourceSha,
    environment: "staging",
    workerVersionId: ids.identityCandidate,
    workerVersionTag: `ponto:identityWorkforce:${sourceSha}`,
  };
}

function rollback() {
  return {
    passed: true,
    valuesIncluded: false,
    credentialsIncluded: false,
    piiIncluded: false,
    core: {
      rolledBackToIncumbent: true,
      restoredCandidate: true,
      incumbentVersionId: ids.coreIncumbent,
      candidateVersionId: ids.coreCandidate,
      incumbentReadback: {
        worker: "skincos-ponto-core-staging",
        activeVersionId: ids.coreIncumbent,
        activeDeploymentId: ids.coreDeployment,
      },
    },
    identity: {
      rolledBackToIncumbent: true,
      restoredCandidate: true,
      incumbentVersionId: ids.identityIncumbent,
      candidateVersionId: ids.identityCandidate,
      incumbentReadback: {
        worker: "skincos-insumos-staging",
        activeVersionId: ids.identityIncumbent,
        activeDeploymentId: ids.identityDeployment,
      },
    },
  };
}

test("builds only a source-bound, private, same-artifact candidate receipt", () => {
  const receipt = buildCandidateReceipt({ input: input(), remote: remote(), identityHealth: health(), rollback: rollback() });
  assert.equal(receipt.contractId, "skincos/ponto-core-staging-candidate/v1");
  assert.equal(receipt.sourceSha, sourceSha);
  assert.equal(receipt.core.versionId, ids.coreCandidate);
  assert.equal(receipt.identity.versionId, ids.identityCandidate);
  assert.deepEqual(receipt.coreExposure.workerRoutes, []);
  assert.deepEqual(receipt.identityExposure.workerRoutes, ["api-staging.skincos.com.br/insumos/*"]);
  assert.equal(receipt.rollback.passed, true);
  assert.equal(receipt.credentialsIncluded, false);
  assert.equal(receipt.piiIncluded, false);
});

test("rejects forged child provenance, public core exposure, and an unexercised rollback", () => {
  const forgedRun = input();
  forgedRun.upstream.core.run.workflowPath = ".github/workflows/deploy-crm-pages.yml";
  assert.throws(() => validateCandidateInput(forgedRun), /PONTO_CORE_STAGING_CANDIDATE_INVALID:CORE_RUN_PROVENANCE/);

  const foreignHead = input();
  foreignHead.upstream.identity.run.headRepository = "untrusted/fork";
  assert.throws(() => validateCandidateInput(foreignHead), /PONTO_CORE_STAGING_CANDIDATE_INVALID:IDENTITY_RUN_PROVENANCE/);

  const publicCore = remote();
  publicCore.core.exposure.workerRouteCount = 1;
  publicCore.core.exposure.workerRoutes = ["api-staging.skincos.com.br/*"];
  assert.throws(
    () => buildCandidateReceipt({ input: input(), remote: publicCore, identityHealth: health(), rollback: rollback() }),
    /PONTO_CORE_STAGING_CANDIDATE_INVALID:CORE_EXPOSURE/,
  );

  const routableCore = remote();
  routableCore.core.routeOnly = false;
  assert.throws(
    () => buildCandidateReceipt({ input: input(), remote: routableCore, identityHealth: health(), rollback: rollback() }),
    /PONTO_CORE_STAGING_CANDIDATE_INVALID:CORE_REMOTE_ROUTE_ONLY/,
  );

  const wrongTimekeeping = remote();
  wrongTimekeeping.identity.timekeepingVersionId = ids.timekeepingIncumbent;
  assert.throws(
    () => buildCandidateReceipt({ input: input(), remote: wrongTimekeeping, identityHealth: health(), rollback: rollback() }),
    /PONTO_CORE_STAGING_CANDIDATE_INVALID:IDENTITY_TIMEKEEPING_AFFINITY/,
  );

  const missingMetadata = remote();
  missingMetadata.core.versionMetadata = false;
  assert.throws(
    () => buildCandidateReceipt({ input: input(), remote: missingMetadata, identityHealth: health(), rollback: rollback() }),
    /PONTO_CORE_STAGING_CANDIDATE_INVALID:CORE_VERSION_METADATA/,
  );

  const incompleteRollback = rollback();
  incompleteRollback.identity.restoredCandidate = false;
  assert.throws(
    () => buildCandidateReceipt({ input: input(), remote: remote(), identityHealth: health(), rollback: incompleteRollback }),
    /PONTO_CORE_STAGING_CANDIDATE_INVALID:IDENTITY_ROLLBACK/,
  );

  const unobservedRollback = rollback();
  unobservedRollback.core.incumbentReadback.activeVersionId = ids.coreCandidate;
  assert.throws(
    () => buildCandidateReceipt({ input: input(), remote: remote(), identityHealth: health(), rollback: unobservedRollback }),
    /PONTO_CORE_STAGING_CANDIDATE_INVALID:CORE_ROLLBACK/,
  );
});

test("collects a sanitized remote snapshot with exact candidate identities", async () => {
  const accountId = "a".repeat(32);
  const zoneId = "b".repeat(32);
  let coreActive = ids.coreCandidate;
  let identityActive = ids.identityCandidate;
  const payload = (result, resultInfo = null) => ({
    ok: true,
    status: 200,
    async json() { return { success: true, result, result_info: resultInfo }; },
  });
  const fetchImpl = async (request) => {
    const url = new URL(request);
    const pathname = url.pathname.replace("/client/v4", "");
    if (pathname === `/accounts/${accountId}/workers/scripts`) {
      return payload([{ id: "skincos-ponto-core-staging" }, { id: "skincos-insumos-staging" }]);
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
    throw new Error(`unexpected request: ${pathname}`);
  };
  const candidate = validateCandidateInput(input());
  const observed = await attestRemoteCandidate({ candidate, accountId, apiToken: "synthetic-token", fetchImpl });
  assert.equal(observed.core.activeVersionId, ids.coreCandidate);
  assert.equal(observed.identity.activeVersionId, ids.identityCandidate);
  assert.equal(observed.credentialsIncluded, false);
  assert.equal(observed.piiIncluded, false);

  coreActive = ids.coreIncumbent;
  identityActive = ids.identityIncumbent;
  const rollbackState = await attestRollbackIncumbents({ candidate, accountId, apiToken: "synthetic-token", fetchImpl });
  assert.equal(rollbackState.core.activeVersionId, ids.coreIncumbent);
  assert.equal(rollbackState.identity.activeVersionId, ids.identityIncumbent);
  assert.equal(rollbackState.valuesIncluded, false);
});

test("workflow is main-only, staging-only, and exercises only already-published artifacts", () => {
  for (const marker of [
    "workflow_dispatch:",
    "[[ \"$GITHUB_REF\" == refs/heads/main ]]",
    "environment: staging",
    "execute_same_artifact_rollback",
    "group: ponto-surface-mutation",
    "resource: global:ponto-workers-writer",
    "ponto-surface-timekeeping-staging-$RELEASE_SHA",
    "ponto-surface-core-api-staging-$RELEASE_SHA",
    "ponto-surface-identity-workforce-staging-$RELEASE_SHA",
    "attest-rollback-incumbents",
    "node --input-type=module - \"$CANDIDATE_ROOT/module-health.json\" <<'NODE'",
    "steps.bind_candidate.outcome == 'success'",
    "payload?.versions || payload?.latest?.versions || active?.versions || []",
  ]) assert.ok(workflow.includes(marker), marker);
  for (const forbidden of [
    "versions upload",
    " d1 migrations ",
    " secret put ",
    "pages deploy",
    "--env production",
    "routes =",
  ]) assert.equal(workflow.includes(forbidden), false, forbidden);
});

test("every embedded workflow Bash block is syntactically valid", () => {
  const blocks = bashBlocks(workflow);
  assert.ok(blocks.length > 0);
  for (const block of blocks) {
    const syntax = spawnSync("bash", ["-n"], { input: block, encoding: "utf8" });
    assert.equal(syntax.status, 0, syntax.stderr || "workflow Bash syntax failed");
  }
});

test("the module-maintenance probe is valid ESM before a mutation can begin", () => {
  const block = bashBlocks(workflow).find((candidate) => candidate.includes("ponto_core_candidate_maintenance"));
  assert.ok(block);
  const marker = "node --input-type=module - \"$CANDIDATE_ROOT/module-health.json\" <<'NODE'\n";
  const start = block.indexOf(marker);
  assert.notEqual(start, -1);
  const source = block.slice(start + marker.length).split("\nNODE\n")[0];
  assert.match(source, /import fs from "node:fs";/);
  assert.doesNotMatch(source, /\brequire\s*\(/);
  const syntax = spawnSync(process.execPath, ["--input-type=module", "--check"], { input: source, encoding: "utf8" });
  assert.equal(syntax.status, 0, syntax.stderr || "module-maintenance probe is not valid ESM");
});
