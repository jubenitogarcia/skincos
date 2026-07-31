import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import {
  isBodylessResponseStatus,
  isCorrelatedChild,
  isJournalAuthorizedRun,
  isTerminalRun,
  matchesPendingDispatch,
  readGitHubResponse,
} from "./ponto-reconcile-children.mjs";

const context = {
  repository: "jubenitogarcia/skincos",
  orchestratorRunId: "12345",
  orchestratorHeadSha: "a".repeat(40),
};
const child = {
  id: 67890,
  event: "workflow_dispatch",
  head_branch: "main",
  head_sha: "a".repeat(40),
  repository: { full_name: context.repository },
  display_title: "CRM Pages staging " + "a".repeat(40) + " orchestrator=12345",
  path: ".github/workflows/deploy-crm-pages.yml",
  status: "in_progress",
};

test("matches only the exact governed child correlation and immutable head", () => {
  assert.equal(isCorrelatedChild(child, context), true);
  assert.equal(isCorrelatedChild({ ...child, id: 12345 }, context), false);
  assert.equal(isCorrelatedChild({ ...child, head_sha: "b".repeat(40) }, context), false);
  assert.equal(isCorrelatedChild({ ...child, display_title: "orchestrator=123450" }, context), false);
  assert.equal(isCorrelatedChild({ ...child, repository: { full_name: "other/repo" } }, context), false);
});

test("only completed Actions runs are terminal", () => {
  assert.equal(isTerminalRun({ status: "completed", conclusion: "cancelled" }), true);
  assert.equal(isTerminalRun({ status: "in_progress", conclusion: null }), false);
  assert.equal(isTerminalRun({ status: "queued", conclusion: null }), false);
});

test("GitHub cancellation acknowledgements are treated as bodyless success", () => {
  for (const status of [202, 204]) {
    assert.equal(isBodylessResponseStatus(status), true);
    assert.equal(readGitHubResponse({
      status,
      json() {
        assert.fail(`response.json() must not be called for HTTP ${status}`);
      },
    }), null);
  }
  assert.equal(isBodylessResponseStatus(200), false);
});

test("a pending dispatch only resolves to the same workflow at or after its request", () => {
  const pending = {
    workflow: "deploy-crm-pages.yml",
    orchestratorRunId: "12345",
    dispatchNonce: "1".repeat(32),
    dispatchRequestedAt: "2026-07-29T12:00:10.000Z",
  };
  assert.equal(matchesPendingDispatch({
    path: ".github/workflows/deploy-crm-pages.yml@refs/heads/main",
    display_title: `CRM Pages staging ${"a".repeat(40)} orchestrator=12345 nonce=${"1".repeat(32)}`,
    created_at: "2026-07-29T12:00:11.000Z",
  }, pending), true);
  assert.equal(matchesPendingDispatch({
    path: ".github/workflows/deploy-crm-pages.yml@refs/heads/main",
    display_title: `CRM Pages staging ${"a".repeat(40)} orchestrator=12345 nonce=${"1".repeat(32)}`,
    created_at: "2026-07-29T11:59:00.000Z",
  }, pending), false);
  assert.equal(matchesPendingDispatch({
    path: ".github/workflows/module-availability.yml@refs/heads/main",
    display_title: `Module timekeeping staging active orchestrator=12345 nonce=${"1".repeat(32)}`,
    created_at: "2026-07-29T12:00:11.000Z",
  }, pending), false);
});

test("ordinary recovery requires an exact journal run ID or nonce-bound pending dispatch", () => {
  const generalCore = {
    id: 70001,
    workflow_id: 501,
    path: ".github/workflows/deploy-core-workers.yml@refs/heads/main",
    display_title: `Core api staging ${context.orchestratorHeadSha} orchestrator=12345 nonce=${"9".repeat(32)}`,
    created_at: "2026-07-29T12:00:11.000Z",
  };
  const exactJournal = {
    workflow: "deploy-core-workers.yml",
    workflowId: 501,
    workflowPath: ".github/workflows/deploy-core-workers.yml",
    runId: "70002",
    status: "in_progress",
  };
  assert.equal(isJournalAuthorizedRun(generalCore, [exactJournal]), false);
  assert.equal(isJournalAuthorizedRun(
    { ...generalCore, id: 70002 },
    [exactJournal],
  ), true);
  const pending = {
    ...exactJournal,
    runId: "",
    status: "dispatch-requested",
    orchestratorRunId: "12345",
    dispatchNonce: "8".repeat(32),
    dispatchRequestedAt: "2026-07-29T12:00:10.000Z",
  };
  assert.equal(isJournalAuthorizedRun(generalCore, [pending]), false);
  assert.equal(isJournalAuthorizedRun({
    ...generalCore,
    display_title: `Core api staging ${context.orchestratorHeadSha} orchestrator=12345 nonce=${"8".repeat(32)}`,
  }, [pending]), true);
});

test("failure recovery latches before reconciliation and mutexes maintenance plus exact rollback", () => {
  const workflow = fs.readFileSync(
    new URL("../workflows/ponto-progressive-release.yml", import.meta.url),
    "utf8",
  );
  const latch = workflow.indexOf("  recovery-latch:");
  const reconcile = workflow.indexOf("  recovery-reconcile:");
  const close = workflow.indexOf("  recovery-close:");
  const rollback = workflow.indexOf("  recovery-rollback:");
  assert.ok(latch >= 0);
  assert.ok(reconcile > latch);
  assert.ok(close > reconcile);
  assert.ok(rollback > close);
  const latchJob = workflow.slice(latch, reconcile);
  const reconciliationJob = workflow.slice(reconcile, close);
  const closeJob = workflow.slice(close, rollback);
  const rollbackJob = workflow.slice(rollback);
  assert.match(latchJob, /ponto-emergency-latch-write\.mjs/);
  assert.match(latchJob, /Attempt external overlay propagation before reconciliation/);
  assert.match(latchJob, /PONTO_MODULE_EXPECTED_SOURCE=emergency-latch-active/);
  assert.match(latchJob, /pendingPrimaryClose: propagation\.passed !== true/);
  assert.doesNotMatch(latchJob, /concurrency:\s*\n\s*group:\s*ponto-surface-mutation/);
  assert.match(reconciliationJob, /Cancel and reconcile children without waiting on the surface mutex/);
  assert.doesNotMatch(reconciliationJob, /concurrency:\s*\n\s*group:\s*ponto-surface-mutation/);
  assert.match(closeJob, /concurrency:\s*\n\s*group:\s*ponto-surface-mutation[\s\S]*ponto-emergency-maintenance-write\.mjs/);
  assert.match(closeJob, /Prove external fail-close through overlay or exact incumbent control/);
  assert.match(closeJob, /PONTO_MODULE_EXPECTED_SOURCE=emergency-latch-active/);
  assert.match(closeJob, /PONTO_MODULE_ALTERNATE_EXPECTATION_FILE=/);
  assert.match(closeJob, /state: "maintenance"[\s\S]*source: "control"/);
  assert.match(rollbackJob, /needs:\s*\[orchestrate, recovery-reconcile, recovery-close\]/);
  assert.match(rollbackJob, /needs\.recovery-reconcile\.result == 'success'/);
  assert.match(rollbackJob, /concurrency:\s*\n\s*group:\s*ponto-surface-mutation[\s\S]*ponto-automatic-rollback\.mjs/);
  const reconciliationStep = reconciliationJob;
  assert.doesNotMatch(reconciliationStep, /continue-on-error:\s*true/);
  assert.match(reconciliationStep, /PONTO_RECONCILIATION_TIMEOUT_SECONDS:\s*"600"/);
});

test("coordinator reserves a bounded recovery budget inside the GitHub job limit", () => {
  const workflow = fs.readFileSync(
    new URL("../workflows/ponto-progressive-release.yml", import.meta.url),
    "utf8",
  );
  assert.match(workflow, /timeout-minutes:\s*360/);
  assert.match(workflow, /PONTO_RECONCILIATION_TIMEOUT_SECONDS:\s*"600"/);
});

test("ordered predecessor provenance is exact and replay resistant before artifact download", () => {
  const workflow = fs.readFileSync(
    new URL("../workflows/ponto-progressive-release.yml", import.meta.url),
    "utf8",
  );
  const provenance = workflow.slice(
    workflow.indexOf("Verify immutable source and ordered predecessor provenance"),
    workflow.indexOf("Refuse a latched Ponto emergency stop before issuing capabilities"),
  );
  const download = provenance.indexOf("gh run download");
  for (const contract of [
    /workflow\?\.state !== "active"/,
    /workflow\?\.path !== "\.github\/workflows\/ponto-progressive-release\.yml"/,
    /String\(run\?\.id \|\| ""\) !== process\.env\.PREDECESSOR_RUN_ID/,
    /(?:run\.path !== `\$\{workflow\.path\}@refs\/heads\/main`|!\[workflow\.path, `\$\{workflow\.path\}@refs\/heads\/main`\]\.includes\(run\.path\))/,
    /run\.run_attempt !== 1/,
    /run\.head_sha \|\| ""\)\.toLowerCase\(\) !== process\.env\.RELEASE_SHA/,
    /run\.display_title !== expectedTitle/,
  ]) {
    const match = provenance.search(contract);
    assert.ok(match >= 0 && match < download, `missing pre-download predecessor contract ${contract}`);
  }
});
