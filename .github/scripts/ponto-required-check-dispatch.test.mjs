import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import {
  REQUIRED_CHECK_WORKFLOWS,
  ensureRequiredCheckDispatches,
  planRequiredCheckDispatches,
} from "./ponto-required-check-dispatch.mjs";

const repository = "owner/repo";
const releaseSha = "a".repeat(40);
const releaseTag = `skincos/release/ponto/${releaseSha}`;

function run(workflow, overrides = {}) {
  return {
    id: 101,
    workflow_name: workflow,
    event: "workflow_dispatch",
    head_branch: releaseTag,
    head_sha: releaseSha,
    run_attempt: 1,
    status: "completed",
    conclusion: "success",
    repository: { full_name: repository },
    head_repository: { full_name: repository },
    ...overrides,
  };
}

function inputs(runsByWorkflow = {}) {
  return { repository, releaseSha, releaseTag, runsByWorkflow };
}

test("immutable required-check mapping covers the policy exactly once", () => {
  const policy = JSON.parse(fs.readFileSync(new URL("../governance/progressive-release-policy.json", import.meta.url), "utf8"));
  const mappedChecks = REQUIRED_CHECK_WORKFLOWS.flatMap(({ checks }) => checks);
  assert.deepEqual([...mappedChecks].sort(), [...policy.governance.requiredChecks].sort());
  assert.equal(new Set(mappedChecks).size, mappedChecks.length);
});

test("plans one exact immutable workflow dispatch for each missing required check workflow", () => {
  const plan = planRequiredCheckDispatches(inputs());
  assert.deepEqual(plan.map(({ workflow, state }) => ({ workflow, state })), REQUIRED_CHECK_WORKFLOWS.map(({ workflow }) => ({ workflow, state: "dispatch" })));
});

test("reuses exactly one successful or active tag-pinned required-check workflow", () => {
  const plan = planRequiredCheckDispatches(inputs({
    "ci-smoke.yml": [run("ci-smoke.yml")],
    "central-e2e-smoke.yml": [run("central-e2e-smoke.yml", { id: 104 })],
    "lint-format-static.yml": [run("lint-format-static.yml", { id: 102, status: "in_progress", conclusion: null })],
    "security-secrets-audit.yml": [run("security-secrets-audit.yml", { id: 103 })],
  }));
  assert.deepEqual(plan.map(({ workflow, state, runId }) => ({ workflow, state, runId })), [
    { workflow: "ci-smoke.yml", state: "reused-success", runId: "101" },
    { workflow: "central-e2e-smoke.yml", state: "reused-success", runId: "104" },
    { workflow: "lint-format-static.yml", state: "reused-active", runId: "102" },
    { workflow: "security-secrets-audit.yml", state: "reused-success", runId: "103" },
  ]);
});

test("rejects stale, ambiguous, and failed required-check workflow evidence", () => {
  assert.deepEqual(planRequiredCheckDispatches(inputs({
    "ci-smoke.yml": [run("ci-smoke.yml", { head_sha: "b".repeat(40) })],
  })).find(({ workflow }) => workflow === "ci-smoke.yml").state, "dispatch");
  assert.throws(
    () => planRequiredCheckDispatches(inputs({ "ci-smoke.yml": [run("ci-smoke.yml"), run("ci-smoke.yml", { id: 102 })] })),
    /ambiguous/,
  );
  assert.throws(
    () => planRequiredCheckDispatches(inputs({ "ci-smoke.yml": [run("ci-smoke.yml", { conclusion: "failure" })] })),
    /ended failure/,
  );
});

test("dispatches only missing workflows at the exact immutable tag", async () => {
  const requests = [];
  const request = async (pathname, init = {}) => {
    requests.push({ pathname, init });
    if (pathname.includes("/runs?")) {
      const workflow = decodeURIComponent(pathname.split("/actions/workflows/")[1].split("/runs?")[0]);
      return { workflow_runs: workflow === "ci-smoke.yml" ? [run(workflow)] : [] };
    }
    assert.match(pathname, /\/dispatches$/);
    assert.equal(init.method, "POST");
    assert.deepEqual(JSON.parse(init.body), { ref: releaseTag });
    return null;
  };
  const report = await ensureRequiredCheckDispatches({ repository, releaseSha, releaseTag, request });
  assert.deepEqual(report.workflows.map(({ workflow, state }) => ({ workflow, state })), [
    { workflow: "ci-smoke.yml", state: "reused-success" },
    { workflow: "central-e2e-smoke.yml", state: "requested" },
    { workflow: "lint-format-static.yml", state: "requested" },
    { workflow: "security-secrets-audit.yml", state: "requested" },
  ]);
  assert.equal(requests.filter(({ pathname }) => pathname.endsWith("/dispatches")).length, 3);
});

test("reconciles an indeterminate retryable dispatch before issuing a second tag-pinned request", async () => {
  const requests = [];
  let centralDispatches = 0;
  let waits = 0;
  const request = async (pathname, init = {}) => {
    requests.push({ pathname, init });
    if (pathname.includes("/runs?")) {
      const workflow = decodeURIComponent(pathname.split("/actions/workflows/")[1].split("/runs?")[0]);
      if (workflow === "central-e2e-smoke.yml" && centralDispatches === 1) {
        return {
          workflow_runs: [run(workflow, { id: 104, status: "in_progress", conclusion: null })],
        };
      }
      return { workflow_runs: [] };
    }
    if (pathname.includes("central-e2e-smoke.yml/dispatches")) {
      centralDispatches += 1;
      const error = new Error("GitHub API POST returned 500");
      error.status = 500;
      throw error;
    }
    return null;
  };

  const report = await ensureRequiredCheckDispatches({
    repository,
    releaseSha,
    releaseTag,
    request,
    wait: async () => { waits += 1; },
  });
  const central = report.workflows.find(({ workflow }) => workflow === "central-e2e-smoke.yml");
  assert.deepEqual(central, {
    workflow: "central-e2e-smoke.yml",
    checks: ["Central E2E Smoke"],
    state: "reconciled-active",
    runId: "104",
  });
  assert.equal(centralDispatches, 1);
  assert.equal(waits, 1);
  assert.equal(requests.filter(({ pathname }) => pathname.includes("central-e2e-smoke.yml/dispatches")).length, 1);
});

test("retries a retryable dispatch only after reconciling that no tag-pinned run exists", async () => {
  const requests = [];
  let centralDispatches = 0;
  let waits = 0;
  const request = async (pathname, init = {}) => {
    requests.push({ pathname, init });
    if (pathname.includes("/runs?")) return { workflow_runs: [] };
    if (pathname.includes("central-e2e-smoke.yml/dispatches")) {
      centralDispatches += 1;
      if (centralDispatches === 1) {
        const error = new Error("GitHub API POST returned 500");
        error.status = 500;
        throw error;
      }
    }
    return null;
  };

  const report = await ensureRequiredCheckDispatches({
    repository,
    releaseSha,
    releaseTag,
    request,
    wait: async () => { waits += 1; },
  });
  const central = report.workflows.find(({ workflow }) => workflow === "central-e2e-smoke.yml");
  assert.equal(central.state, "requested");
  assert.equal(centralDispatches, 2);
  assert.equal(waits, 1);
  assert.equal(requests.filter(({ pathname }) => pathname.includes("central-e2e-smoke.yml/runs?")).length, 2);
});

test("preview wires immutable required-check dispatch immediately after tag identity creation", () => {
  const workflow = fs.readFileSync(new URL("../workflows/ponto-progressive-release.yml", import.meta.url), "utf8");
  assert.match(
    workflow,
    /Establish immutable Ponto release identity[\s\S]*?Dispatch exact immutable required checks on the release tag[\s\S]*?inputs\.stage == 'preview'[\s\S]*?ponto-required-check-dispatch\.mjs/,
  );
});
