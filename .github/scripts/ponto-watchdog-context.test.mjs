import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { validateWatchdogContext } from "./ponto-watchdog-context.mjs";

const repository = "owner/repo";
const repositoryId = "42";
const sha = "a".repeat(40);
const workflow = {
  id: 7,
  name: "Ponto progressive release",
  state: "active",
  path: ".github/workflows/ponto-progressive-release.yml",
};
const run = {
  id: 99,
  workflow_id: 7,
  path: ".github/workflows/ponto-progressive-release.yml",
  status: "completed",
  conclusion: "failure",
  event: "workflow_dispatch",
  head_branch: "main",
  head_sha: sha,
  name: `Ponto staging ${sha} orchestrator=99`,
  display_title: `Ponto staging ${sha} orchestrator=99`,
  run_attempt: 1,
  repository: { full_name: repository, id: 42 },
  head_repository: { full_name: repository, id: 42 },
};
const event = {
  workflow_run: {
    id: 99,
    workflow_id: 7,
    path: run.path,
    head_sha: sha,
    run_attempt: 1,
    conclusion: "failure",
  },
};
const request = async (pathname) => pathname.endsWith("ponto-progressive-release.yml") ? workflow : run;
const input = (overrides = {}) => ({
  event,
  repository,
  repositoryId,
  token: "token",
  workflowRef: `${repository}/.github/workflows/ponto-release-watchdog.yml@refs/heads/main`,
  gitRef: "refs/heads/main",
  watchdogRunAttempt: "1",
  request,
  ...overrides,
});

test("watchdog accepts only an exact failed first-attempt coordinator from main", async () => {
  const context = await validateWatchdogContext(input());
  assert.equal(context.stage, "staging");
  assert.equal(context.target, "staging");
  assert.equal(context.requiresClose, true);
  assert.equal(context.releaseSha, sha);
});

test("watchdog accepts GitHub REST run-name metadata while pinning the static workflow name", async () => {
  const context = await validateWatchdogContext(input());
  assert.equal(run.name, run.display_title);
  assert.equal(context.requiresClose, true);
  await assert.rejects(validateWatchdogContext(input({
    request: async (pathname) => pathname.endsWith("ponto-progressive-release.yml")
      ? { ...workflow, name: "Renamed or substituted workflow" }
      : run,
  })), /failed coordinator provenance is invalid/);
});

test("watchdog closes both successful and failed unauthorized reruns", async () => {
  for (const conclusion of ["success", "failure"]) {
    const replay = { ...run, run_attempt: 2, conclusion };
    const context = await validateWatchdogContext(input({
      event: {
        workflow_run: {
          ...event.workflow_run,
          run_attempt: 2,
          conclusion,
        },
      },
      request: async (pathname) => pathname.endsWith("ponto-progressive-release.yml")
        ? workflow
        : replay,
    }));
    assert.equal(context.unauthorizedReplay, true);
    assert.equal(context.runAttempt, 2);
    assert.equal(context.requiresClose, true);
  }
});

test("watchdog audits a preview rerun without assigning a live target or closing production", async () => {
  for (const conclusion of ["success", "failure"]) {
    const replay = {
      ...run,
      run_attempt: 2,
      conclusion,
      display_title: `Ponto preview ${sha} orchestrator=99`,
    };
    const context = await validateWatchdogContext(input({
      event: {
        workflow_run: {
          ...event.workflow_run,
          run_attempt: 2,
          conclusion,
        },
      },
      request: async (pathname) => pathname.endsWith("ponto-progressive-release.yml")
        ? workflow
        : replay,
    }));
    assert.equal(context.stage, "preview");
    assert.equal(context.unauthorizedReplay, true);
    assert.equal(context.target, null);
    assert.equal(context.requiresClose, false);
  }
});

test("watchdog rejects first-attempt success, non-main source, and event/API drift", async (t) => {
  for (const [name, value] of [
    ["success", { ...run, conclusion: "success" }],
    ["wrong path", { ...run, path: ".github/workflows/other.yml" }],
  ]) {
    await t.test(name, async () => {
      await assert.rejects(validateWatchdogContext(input({
        request: async (pathname) => pathname.endsWith("ponto-progressive-release.yml") ? workflow : value,
      })));
    });
  }
  await assert.rejects(validateWatchdogContext(input({ gitRef: "refs/heads/feature" })));
  await assert.rejects(validateWatchdogContext(input({ watchdogRunAttempt: "2" })));
  await assert.rejects(validateWatchdogContext(input({
    event: { workflow_run: { ...event.workflow_run, head_sha: "b".repeat(40) } },
  })));
  await assert.rejects(validateWatchdogContext(input({
    event: { workflow_run: { ...event.workflow_run, run_attempt: 2 } },
  })));
});

test("watchdog workflow skips a successful first-attempt coordinator before provenance validation", () => {
  const workflowText = fs.readFileSync(
    new URL("../workflows/ponto-release-watchdog.yml", import.meta.url),
    "utf8",
  );
  const contextJob = workflowText.slice(
    workflowText.indexOf("  context:"),
    workflowText.indexOf("  latch:"),
  );
  assert.match(contextJob, /github\.run_attempt == 1/);
  assert.match(contextJob, /github\.event\.workflow_run\.run_attempt > 1/);
  for (const conclusion of ["failure", "cancelled", "timed_out"]) {
    assert.match(
      contextJob,
      new RegExp(`github\\.event\\.workflow_run\\.conclusion == '${conclusion}'`),
    );
  }
  assert.doesNotMatch(
    contextJob,
    /github\.event\.workflow_run\.conclusion == 'success'/,
  );
});

test("watchdog never rolls back after failed child reconciliation", () => {
  const workflowText = fs.readFileSync(
    new URL("../workflows/ponto-release-watchdog.yml", import.meta.url),
    "utf8",
  );
  const failClose = workflowText.slice(
    workflowText.indexOf("  fail-close:"),
    workflowText.indexOf("  rollback:"),
  );
  const rollback = workflowText.slice(workflowText.indexOf("  rollback:"));
  const latch = workflowText.slice(
    workflowText.indexOf("  latch:"),
    workflowText.indexOf("  reconcile:"),
  );
  assert.match(failClose, /needs:\s*\[context, latch, reconcile\]/);
  assert.match(failClose, /needs\.latch\.result == 'success'/);
  assert.doesNotMatch(failClose, /needs\.reconcile\.result == 'success'/);
  assert.match(latch, /Attempt external overlay propagation before reconciliation/);
  assert.match(latch, /PONTO_MODULE_EXPECTED_SOURCE=emergency-latch-active/);
  assert.match(latch, /pendingPrimaryClose: propagation\.passed !== true/);
  assert.match(failClose, /Prove external fail-close through overlay or exact incumbent control/);
  assert.match(failClose, /PONTO_MODULE_EXPECTED_SOURCE=emergency-latch-active/);
  assert.match(failClose, /PONTO_MODULE_ALTERNATE_EXPECTATION_FILE=/);
  assert.match(failClose, /state: "maintenance"[\s\S]*source: "control"/);
  assert.match(rollback, /needs:\s*\[context, latch, reconcile, fail-close\]/);
  assert.match(rollback, /needs\.reconcile\.result == 'success'/);
  assert.match(rollback, /needs\.fail-close\.result == 'success'/);
});
