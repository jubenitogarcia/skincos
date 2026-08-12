import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { validateWatchdogContext } from "./ponto-watchdog-context.mjs";

const repository = "owner/repo";
const repositoryId = "42";
const sha = "a".repeat(40);
const workflow = {
  id: 7,
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
const jobs = { total_count: 1, jobs: [{ name: "orchestrate" }] };
const request = async (pathname) => {
  if (pathname.endsWith("ponto-progressive-release.yml")) return workflow;
  if (pathname.endsWith("/jobs?per_page=100")) return jobs;
  return run;
};
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

test("watchdog defers a duplicate failure to an exact active coordinator", async () => {
  const peer = {
    ...run,
    id: 100,
    status: "in_progress",
    conclusion: null,
    name: `Ponto staging ${sha} orchestrator=100`,
    display_title: `Ponto staging ${sha} orchestrator=100`,
  };
  const context = await validateWatchdogContext(input({
    request: async (pathname) => {
      if (pathname.endsWith("ponto-progressive-release.yml")) return workflow;
      if (pathname.endsWith("/jobs?per_page=100")) return jobs;
      if (pathname.includes("/runs?")) return { workflow_runs: [peer] };
      return run;
    },
  }));
  assert.equal(context.requiresClose, false);
  assert.equal(context.activePeerCoordinatorRunId, "100");
  assert.equal(context.activePeerDiscovery, "verified-peer");
});

test("watchdog accepts a closure-compatible main revision for an immutable release", async () => {
  const observedSha = "b".repeat(40);
  const sourceChecks = [];
  const context = await validateWatchdogContext(input({
    event: { workflow_run: { ...event.workflow_run, head_sha: observedSha } },
    request: async (pathname) => {
      if (pathname.endsWith("ponto-progressive-release.yml")) return workflow;
      if (pathname.endsWith("/jobs?per_page=100")) return jobs;
      return { ...run, head_sha: observedSha };
    },
    assertReleaseSource: (releaseSha, currentSha) => {
      sourceChecks.push([releaseSha, currentSha]);
    },
  }));
  assert.equal(context.releaseSha, sha);
  assert.deepEqual(sourceChecks, [[sha, observedSha]]);
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
      request: async (pathname) => {
        if (pathname.endsWith("ponto-progressive-release.yml")) return workflow;
        if (pathname.endsWith("/jobs?per_page=100")) return jobs;
        return replay;
      },
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
      name: `Ponto preview ${sha} orchestrator=99`,
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
      request: async (pathname) => {
        if (pathname.endsWith("ponto-progressive-release.yml")) return workflow;
        if (pathname.endsWith("/jobs?per_page=100")) return jobs;
        return replay;
      },
    }));
    assert.equal(context.stage, "preview");
    assert.equal(context.unauthorizedReplay, true);
    assert.equal(context.target, null);
    assert.equal(context.requiresClose, false);
  }
});

test("watchdog treats first-attempt success as a no-op and rejects provenance drift", async (t) => {
  await t.test("first-attempt success is a no-op", async () => {
    const context = await validateWatchdogContext(input({
      event: {
        workflow_run: {
          ...event.workflow_run,
          conclusion: "success",
        },
      },
      request: async (pathname) => {
        if (pathname.endsWith("ponto-progressive-release.yml")) return workflow;
        if (pathname.endsWith("/jobs?per_page=100")) return jobs;
        return { ...run, conclusion: "success" };
      },
    }));
    assert.equal(context.conclusion, "success");
    assert.equal(context.requiresClose, false);
    assert.equal(context.passed, true);
  });
  await t.test("wrong path", async () => {
    await assert.rejects(validateWatchdogContext(input({
      request: async (pathname) => {
        if (pathname.endsWith("ponto-progressive-release.yml")) return workflow;
        if (pathname.endsWith("/jobs?per_page=100")) return jobs;
        return { ...run, path: ".github/workflows/other.yml@refs/heads/main" };
      },
    })));
  });
  await assert.rejects(validateWatchdogContext(input({ gitRef: "refs/heads/feature" })));
  await assert.rejects(validateWatchdogContext(input({ watchdogRunAttempt: "2" })));
  await assert.rejects(validateWatchdogContext(input({
    event: { workflow_run: { ...event.workflow_run, head_sha: "b".repeat(40) } },
  })));
  await assert.rejects(validateWatchdogContext(input({
    event: { workflow_run: { ...event.workflow_run, run_attempt: 2 } },
  })));
});

test("watchdog does not close a coordinator cancelled before orchestrate started", async () => {
  const context = await validateWatchdogContext(input({
    request: async (pathname) => {
      if (pathname.endsWith("ponto-progressive-release.yml")) return workflow;
      if (pathname.endsWith("/jobs?per_page=100")) return { total_count: 0, jobs: [] };
      return { ...run, conclusion: "cancelled" };
    },
    event: { workflow_run: { ...event.workflow_run, conclusion: "cancelled" } },
  }));
  assert.equal(context.requiresClose, false);
  assert.equal(context.passed, true);
});

test("watchdog preserves fail-close when the coordinator job inventory is ambiguous", async () => {
  const context = await validateWatchdogContext(input({
    request: async (pathname) => {
      if (pathname.endsWith("ponto-progressive-release.yml")) return workflow;
      if (pathname.endsWith("/jobs?per_page=100")) return {};
      return run;
    },
  }));
  assert.equal(context.requiresClose, true);
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
  assert.match(failClose, /timeout-minutes: 30/);
  assert.match(failClose, /wait_timeout_seconds: '960'/);
  assert.match(failClose, /retry_interval_seconds: '10'/);
  assert.match(failClose, /needs\.latch\.result == 'success'/);
  assert.doesNotMatch(failClose, /needs\.reconcile\.result == 'success'/);
  assert.match(latch, /Attempt external overlay propagation before reconciliation/);
  assert.match(latch, /PONTO_MODULE_EXPECTED_SOURCE=emergency-latch-active/);
  assert.match(latch, /pendingPrimaryClose: propagation\.passed !== true/);
  assert.match(failClose, /Prove external fail-close through overlay or exact incumbent control/);
  assert.match(failClose, /PONTO_MODULE_EXPECTED_SOURCE=emergency-latch-active/);
  assert.match(failClose, /PONTO_MODULE_ALTERNATE_EXPECTATION_FILE=/);
  assert.match(failClose, /\(async \(\) => \{/);
  assert.match(failClose, /const probe = new URL\(process\.env\.PONTO_MODULE_HEALTH_URL\)/);
  assert.match(failClose, /watchdog_close_probe/);
  assert.match(failClose, /watchdog fail-close did not observe exact incumbent maintenance control/);
  assert.match(failClose, /\["control", "emergency-latch-active"\]/);
  assert.match(failClose, /availability\.source === "emergency-latch-active"/);
  assert.match(failClose, /if \[\[ -f .*control-fallback-expectation\.json/);
  assert.match(failClose, /state: "maintenance"[\s\S]*source: "control"/);
  assert.match(failClose, /changedAt: availability\.changedAt/);
  assert.doesNotMatch(failClose, /changedAt: maintenance\.controlChangedAt/);
  assert.match(rollback, /needs:\s*\[context, latch, reconcile, fail-close\]/);
  assert.match(rollback, /needs\.reconcile\.result == 'success'/);
  assert.match(rollback, /needs\.fail-close\.result == 'success'/);
});

test("ordinary recovery latches before it waits for a stale coordinator lease", () => {
  const workflowText = fs.readFileSync(
    new URL("../workflows/ponto-progressive-release.yml", import.meta.url),
    "utf8",
  );
  const start = workflowText.indexOf("  recovery-latch:");
  const end = workflowText.indexOf("  recovery-reconcile:");
  const recoveryLatch = workflowText.slice(start, end);
  assert.match(recoveryLatch, /timeout-minutes: 30/);
  assert.ok(
    recoveryLatch.indexOf("Monotonically latch Ponto closed outside the surface mutex")
      < recoveryLatch.indexOf("Acquire global recovery lease"),
  );
  assert.match(recoveryLatch, /wait_timeout_seconds: '960'/);
  assert.match(recoveryLatch, /retry_interval_seconds: '10'/);
});
