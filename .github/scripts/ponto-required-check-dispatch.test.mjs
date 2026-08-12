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

test("plans one exact immutable workflow dispatch for each missing required check workflow", () => {
  const plan = planRequiredCheckDispatches(inputs());
  assert.deepEqual(plan.map(({ workflow, state }) => ({ workflow, state })), REQUIRED_CHECK_WORKFLOWS.map(({ workflow }) => ({ workflow, state: "dispatch" })));
});

test("reuses exactly one successful or active tag-pinned required-check workflow", () => {
  const plan = planRequiredCheckDispatches(inputs({
    "ci-smoke.yml": [run("ci-smoke.yml")],
    "lint-format-static.yml": [run("lint-format-static.yml", { id: 102, status: "in_progress", conclusion: null })],
    "security-secrets-audit.yml": [run("security-secrets-audit.yml", { id: 103 })],
  }));
  assert.deepEqual(plan.map(({ workflow, state, runId }) => ({ workflow, state, runId })), [
    { workflow: "ci-smoke.yml", state: "reused-success", runId: "101" },
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
    { workflow: "lint-format-static.yml", state: "requested" },
    { workflow: "security-secrets-audit.yml", state: "requested" },
  ]);
  assert.equal(requests.filter(({ pathname }) => pathname.endsWith("/dispatches")).length, 2);
});

test("preview wires immutable required-check dispatch immediately after tag identity creation", () => {
  const workflow = fs.readFileSync(new URL("../workflows/ponto-progressive-release.yml", import.meta.url), "utf8");
  assert.match(
    workflow,
    /Establish immutable Ponto release identity[\s\S]*?Dispatch exact immutable required checks on the release tag[\s\S]*?inputs\.stage == 'preview'[\s\S]*?ponto-required-check-dispatch\.mjs/,
  );
});
