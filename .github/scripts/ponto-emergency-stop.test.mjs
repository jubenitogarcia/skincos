import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  HIGH_RISK_WORKFLOWS,
  isBodylessResponseStatus,
  isInventoryWorkflowState,
  loadCanonicalHighRiskWorkflows,
  isWithinCoordinatorWindow,
  parseCoordinator,
  targetForStage,
} from "./ponto-emergency-stop.mjs";
import { createCapabilityCheck } from "./ponto-orchestrator-lease.mjs";

const repository = "skincos/skincos";
const workflowId = 123;
const sha = "a".repeat(40);
const repositoryId = "42";
const emergencyScript = fileURLToPath(new URL("./ponto-emergency-stop.mjs", import.meta.url));
const stagingPair = crypto.generateKeyPairSync("ed25519");
const productionPair = crypto.generateKeyPairSync("ed25519");
const capabilityPublicKeysJson = JSON.stringify({
  staging: {
    keyId: "staging-emergency-test",
    publicKeyPem: stagingPair.publicKey.export({ type: "spki", format: "pem" }),
  },
  production: {
    keyId: "production-emergency-test",
    publicKeyPem: productionPair.publicKey.export({ type: "spki", format: "pem" }),
  },
});
const stagingPrivateKey = stagingPair.privateKey.export({ type: "pkcs8", format: "pem" });

const run = (stage, overrides = {}) => ({
  id: 456,
  workflow_id: workflowId,
  path: ".github/workflows/ponto-progressive-release.yml",
  event: "workflow_dispatch",
  head_branch: "main",
  head_sha: sha,
  name: `Ponto ${stage} ${sha} orchestrator=456`,
  display_title: `Ponto ${stage} ${sha} orchestrator=456`,
  status: "in_progress",
  conclusion: null,
  created_at: "2026-07-30T00:00:00Z",
  updated_at: "2026-07-30T00:05:00Z",
  repository: { full_name: repository },
  head_repository: { full_name: repository },
  ...overrides,
});

test("emergency child inventory is bounded to coordinator lifecycle timestamps", () => {
  const coordinator = run("staging");
  assert.equal(isWithinCoordinatorWindow({
    created_at: "2026-07-30T00:01:00Z",
    updated_at: "2026-07-30T00:02:00Z",
  }, coordinator), true);
  assert.equal(isWithinCoordinatorWindow({
    created_at: "2026-07-31T00:01:00Z",
    updated_at: "2026-07-31T00:02:00Z",
  }, coordinator), false);
  assert.equal(isWithinCoordinatorWindow({}, coordinator), false);
});

test("emergency target mapping keeps staging isolated from every live stage", () => {
  assert.equal(targetForStage("staging"), "staging");
  for (const stage of ["pilot", "canary", "production", "rollback"]) {
    assert.equal(targetForStage(stage), "production");
  }
});

test("coordinator discovery accepts only exact canonical correlated runs", () => {
  assert.equal(parseCoordinator(run("pilot"), { repository, workflowId, target: "production" })?.runId, "456");
  assert.equal(parseCoordinator(run("staging"), { repository, workflowId, target: "production" }), null);
  assert.equal(parseCoordinator(run("pilot", { head_sha: "b".repeat(40) }), { repository, workflowId, target: "production" }), null);
  assert.equal(parseCoordinator(run("pilot", { path: ".github/workflows/other.yml@refs/heads/main" }), { repository, workflowId, target: "production" }), null);
  assert.equal(parseCoordinator(run("pilot", { display_title: `Ponto pilot ${sha} orchestrator=999` }), { repository, workflowId, target: "production" }), null);
});

test("GitHub cancellation acknowledgements are treated as bodyless success", () => {
  assert.equal(isBodylessResponseStatus(202), true);
  assert.equal(isBodylessResponseStatus(204), true);
  assert.equal(isBodylessResponseStatus(200), false);
});

test("canonical high-risk allowlist covers every Ponto workflow that can hydrate privileged secrets or mutate a surface", async () => {
  assert.deepEqual(
    HIGH_RISK_WORKFLOWS.map(entry => entry.path),
    [
      ".github/workflows/deploy-timekeeping.yml",
      ".github/workflows/deploy-core-workers.yml",
      ".github/workflows/deploy-crm-pages.yml",
      ".github/workflows/module-availability.yml",
      ".github/workflows/cloudflare-workers-sync-ponto-secrets.yml",
      ".github/workflows/cloudflare-pages-sync-ponto.yml",
      ".github/workflows/ponto-core-baseline-publisher.yml",
      ".github/workflows/timekeeping-staging-journey.yml",
      ".github/workflows/ponto-staging-rollback-drill.yml",
      ".github/workflows/ponto-production-baseline.yml",
      ".github/workflows/ponto-production-slo.yml",
    ],
  );
  let nextId = 1000;
  const workflows = await loadCanonicalHighRiskWorkflows({
    repository,
    request: async pathname => {
      const file = decodeURIComponent(pathname.split("/").at(-1));
      const entry = HIGH_RISK_WORKFLOWS.find(candidate => candidate.path.endsWith(`/${file}`));
      return { id: nextId += 1, state: "active", path: entry?.path };
    },
  });
  assert.equal(workflows.size, HIGH_RISK_WORKFLOWS.length);
  assert.deepEqual([...workflows.values()].map(entry => entry.path), HIGH_RISK_WORKFLOWS.map(entry => entry.path));
});

test("emergency inventory accepts exact active and disabled canonical workflow states", async () => {
  for (const state of ["active", "disabled_manually", "disabled_inactivity", "disabled_fork"]) {
    assert.equal(isInventoryWorkflowState(state), true);
  }
  assert.equal(isInventoryWorkflowState("deleted"), false);
  let nextId = 2000;
  const workflows = await loadCanonicalHighRiskWorkflows({
    repository,
    request: async pathname => {
      const file = decodeURIComponent(pathname.split("/").at(-1));
      const entry = HIGH_RISK_WORKFLOWS.find(candidate => candidate.path.endsWith(`/${file}`));
      return {
        id: nextId += 1,
        state: nextId % 2 ? "active" : "disabled_manually",
        path: entry?.path,
      };
    },
  });
  assert.equal(workflows.size, HIGH_RISK_WORKFLOWS.length);
  assert.ok([...workflows.values()].some(entry => entry.state === "disabled_manually"));
});

test("emergency reconciliation and latch reset ignore every uncorrelated canonical run", async () => {
  const emergency = fs.readFileSync(new URL("./ponto-emergency-stop.mjs", import.meta.url), "utf8");
  const idle = fs.readFileSync(new URL("./ponto-assert-idle.mjs", import.meta.url), "utf8");
  assert.match(emergency, /isCorrelatedChild\(run, \{/);
  assert.match(emergency, /const classified = classifyHighRiskRun\(run, \{/);
  assert.match(emergency, /isWithinCoordinatorWindow\(run, coordinator\.live\)/);
  assert.doesNotMatch(idle, /classifyHighRiskRun|loadCanonicalHighRiskWorkflows/);
  assert.match(idle, /parseCoordinator\(run, \{/);
  assert.match(emergency, /highRiskRuns: highRiskRecords/);
});

test("executable emergency path rescans, invalidates a late-issued check, and cancels a disabled canonical child", async () => {
  const rootId = 700;
  const childId = 9001;
  const childWorkflowId = 701;
  const nonce = "c".repeat(32);
  const intentDigest = "d".repeat(64);
  const capability = createCapabilityCheck({
    privateKey: stagingPrivateKey,
    keyId: "staging-emergency-test",
    repositoryId,
    repository,
    parentWorkflowId: rootId,
    parentWorkflowPath: ".github/workflows/ponto-progressive-release.yml",
    parentRunId: "8001",
    issuerWorkflowId: rootId,
    issuerWorkflowPath: ".github/workflows/ponto-progressive-release.yml",
    issuerRunId: "8001",
    childWorkflowId,
    childWorkflowPath: ".github/workflows/deploy-timekeeping.yml",
    childRunId: String(childId),
    leaseKey: "timekeeping",
    stage: "staging",
    target: "staging",
    releaseSha: sha,
    dispatchNonce: nonce,
    intentDigest,
  });
  const check = {
    id: 6001,
    ...capability,
    conclusion: null,
    created_at: "2026-07-30T00:01:00Z",
    updated_at: "2026-07-30T00:02:00Z",
    app: { slug: "github-actions" },
  };
  const child = {
    id: childId,
    workflow_id: childWorkflowId,
    path: ".github/workflows/deploy-timekeeping.yml@refs/heads/main",
    event: "workflow_dispatch",
    head_branch: "main",
    head_sha: sha,
    name: "Deploy Workforce Timekeeping",
    display_title: `Timekeeping staging ${sha} orchestrator=8001 nonce=${nonce}`,
    run_attempt: 1,
    status: "queued",
    conclusion: null,
    created_at: "2026-07-30T00:01:00Z",
    updated_at: "2026-07-30T00:02:00Z",
    repository: { id: Number(repositoryId), full_name: repository },
    head_repository: { id: Number(repositoryId), full_name: repository },
  };
  const unrelated = [
    {
      ...child,
      id: 9101,
      workflow_id: 702,
      path: ".github/workflows/deploy-core-workers.yml@refs/heads/main",
      name: "Deploy Core Workers",
      display_title: `Core api staging ${sha} orchestrator=8001 nonce=${"e".repeat(32)}`,
    },
    {
      ...child,
      id: 9102,
      workflow_id: 8102,
      path: ".github/workflows/deploy-core-workers.yml@refs/heads/main",
      name: "Deploy Core Workers",
      display_title: `Core inventory staging ${sha} unrelated`,
    },
    {
      ...child,
      id: 9103,
      workflow_id: 8103,
      path: ".github/workflows/module-availability.yml@refs/heads/main",
      name: "Set module availability",
      display_title: "Module finance staging maintenance orchestrator=",
    },
    {
      ...child,
      id: 9104,
      workflow_id: 8104,
      path: ".github/workflows/module-availability.yml@refs/heads/main",
      name: "Set module availability",
      display_title: "Module timekeeping staging active orchestrator=",
    },
  ];
  let cancelled = false;
  let unprovenCancelled = false;
  const unexpectedCancellations = [];
  let patched;
  let checkInventoryCalls = 0;
  let childRefreshCalls = 0;
  let nextWorkflowId = childWorkflowId;
  const workflowIds = new Map([["deploy-timekeeping.yml", childWorkflowId]]);
  const server = http.createServer(async (request, response) => {
    response.setHeader("content-type", "application/json");
    const send = (status, value) => {
      response.statusCode = status;
      response.end(value === null ? "" : JSON.stringify(value));
    };
    const workflowMatch = request.url?.match(
      new RegExp(`^/repos/${repository}/actions/workflows/([^/?]+)$`),
    );
    if (workflowMatch) {
      const file = decodeURIComponent(workflowMatch[1]);
      if (file === "ponto-progressive-release.yml") {
        send(200, {
          id: rootId,
          state: "disabled_manually",
          path: ".github/workflows/ponto-progressive-release.yml",
        });
        return;
      }
      const specification = HIGH_RISK_WORKFLOWS.find(entry => entry.path.endsWith(`/${file}`));
      if (specification) {
        if (!workflowIds.has(file)) workflowIds.set(file, nextWorkflowId += 1);
        send(200, {
          id: workflowIds.get(file),
          state: "disabled_manually",
          path: specification.path,
        });
        return;
      }
    }
    const workflowRunsMatch = request.url?.match(
      new RegExp(`^/repos/${repository}/actions/workflows/([0-9]+)/runs\\?`),
    );
    if (workflowRunsMatch) {
      const queriedWorkflowId = Number(workflowRunsMatch[1]);
      if (queriedWorkflowId === rootId) {
        send(200, { workflow_runs: [{
          id: 8001,
          workflow_id: rootId,
          path: ".github/workflows/ponto-progressive-release.yml@refs/heads/main",
          event: "workflow_dispatch",
          head_branch: "main",
          head_sha: sha,
          name: `Ponto staging ${sha} orchestrator=8001`,
          display_title: `Ponto staging ${sha} orchestrator=8001`,
          run_attempt: 1,
          status: "completed",
          conclusion: "cancelled",
          created_at: "2026-07-30T00:00:00Z",
          updated_at: "2026-07-30T00:05:00Z",
          repository: { id: Number(repositoryId), full_name: repository },
          head_repository: { id: Number(repositoryId), full_name: repository },
        }] });
      } else {
        // The server-side workflow + created range excludes arbitrarily many
        // unrelated repository runs before pagination reaches this mock.
        send(200, { workflow_runs: [] });
      }
      return;
    }
    if (request.url?.startsWith(`/repos/${repository}/actions/runs?`)) {
      const status = new URL(request.url, "http://local").searchParams.get("status");
      send(200, {
        workflow_runs: status === "queued"
          ? [
              ...(!cancelled ? [child] : []),
              ...(!unprovenCancelled ? [unrelated[0]] : []),
              ...unrelated.slice(1),
            ]
          : [],
      });
      return;
    }
    if (request.url?.startsWith(`/repos/${repository}/commits/${sha}/check-runs?`)) {
      checkInventoryCalls += 1;
      send(200, { check_runs: checkInventoryCalls < 5 ? [] : [patched || check] });
      return;
    }
    if (request.url === `/repos/${repository}/check-runs/${check.id}` && request.method === "GET") {
      send(200, patched || check);
      return;
    }
    if (request.url === `/repos/${repository}/check-runs/${check.id}` && request.method === "PATCH") {
      let body = "";
      for await (const chunk of request) body += chunk;
      const update = JSON.parse(body);
      patched = { ...check, ...update, output: update.output };
      send(200, patched);
      return;
    }
    if (request.url === `/repos/${repository}/actions/runs/${childId}/cancel`) {
      cancelled = true;
      send(202, null);
      return;
    }
    if (request.url === `/repos/${repository}/actions/runs/9101/cancel`) {
      unprovenCancelled = true;
      send(202, null);
      return;
    }
    const unrelatedCancellation = request.url?.match(
      new RegExp(`^/repos/${repository}/actions/runs/(910[2-4])/(?:cancel|force-cancel)$`),
    );
    if (unrelatedCancellation) {
      unexpectedCancellations.push(unrelatedCancellation[1]);
      send(202, null);
      return;
    }
    if (request.url === `/repos/${repository}/actions/runs/${childId}`) {
      childRefreshCalls += 1;
      const terminal = cancelled && childRefreshCalls >= 2;
      send(200, {
        ...child,
        status: terminal ? "completed" : "queued",
        conclusion: terminal ? "cancelled" : null,
      });
      return;
    }
    if (request.url === `/repos/${repository}/actions/runs/9101`) {
      send(200, {
        ...unrelated[0],
        status: unprovenCancelled ? "completed" : "queued",
        conclusion: unprovenCancelled ? "cancelled" : null,
      });
      return;
    }
    if (request.url === `/repos/${repository}/actions/runs/8001`) {
      send(200, {
        id: 8001,
        workflow_id: rootId,
        path: ".github/workflows/ponto-progressive-release.yml@refs/heads/main",
        event: "workflow_dispatch",
        head_branch: "main",
        head_sha: sha,
        name: `Ponto staging ${sha} orchestrator=8001`,
        display_title: `Ponto staging ${sha} orchestrator=8001`,
        run_attempt: 1,
        status: "completed",
        conclusion: "cancelled",
        created_at: "2026-07-30T00:00:00Z",
        updated_at: "2026-07-30T00:05:00Z",
        repository: { id: Number(repositoryId), full_name: repository },
        head_repository: { id: Number(repositoryId), full_name: repository },
      });
      return;
    }
    send(404, { message: "not found" });
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "ponto-emergency-test-"));
  const reportFile = path.join(directory, "report.json");
  try {
    const address = server.address();
    const result = await new Promise(resolve => execFile(
      process.execPath,
      [emergencyScript],
      {
        env: {
          ...process.env,
          GITHUB_API_URL: `http://127.0.0.1:${address.port}`,
          GITHUB_REPOSITORY: repository,
          GITHUB_REPOSITORY_ID: repositoryId,
          GITHUB_RUN_ID: "9999",
          GH_TOKEN: "test-token",
          PONTO_ORCHESTRATOR_CAPABILITY_PUBLIC_KEYS_JSON: capabilityPublicKeysJson,
          PONTO_EMERGENCY_TARGET: "staging",
          PONTO_EMERGENCY_REPORT: reportFile,
          PONTO_EMERGENCY_TIMEOUT_SECONDS: "300",
          PONTO_EMERGENCY_QUIET_SECONDS: "1",
          PONTO_EMERGENCY_POLL_MS: "10",
        },
      },
      (error, stdout, stderr) => resolve({ error, stdout, stderr }),
    ));
    assert.notEqual(result.error, null);
    assert.match(result.stderr, /reconciliation is incomplete/);
    const report = JSON.parse(fs.readFileSync(reportFile, "utf8"));
    assert.equal(cancelled, true);
    assert.equal(unprovenCancelled, true);
    assert.deepEqual(unexpectedCancellations, []);
    assert.ok(checkInventoryCalls >= 5);
    assert.equal(patched?.status, "completed");
    assert.equal(patched?.conclusion, "cancelled");
    assert.deepEqual(report.highRiskRuns[0].invalidatedCapabilityCheckRunIds, ["6001"]);
    assert.ok(report.highRiskRuns[0].capabilityInventoryScans >= 2);
    assert.equal(report.capabilityInvalidationErrors.length, 0);
    assert.ok(report.ignoredUnprovenRuns.some((item) =>
      item.runId === "9101"
      && item.capabilityAuthorization === "absent"
      && item.cancellationRequested === true));
    assert.ok(report.unresolved.some((item) =>
      item.runId === "9101"
      && item.reason === "child-capability-unproven"));
    assert.equal(report.passed, false);
    assert.ok(report.canonicalHighRiskWorkflows.every(item => item.workflowState === "disabled_manually"));
  } finally {
    await new Promise(resolve => server.close(resolve));
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
