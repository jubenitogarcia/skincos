import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { isCorrelatedChild, isTerminalRun, matchesPendingDispatch } from "./ponto-reconcile-children.mjs";

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
  path: ".github/workflows/deploy-crm-pages.yml@refs/heads/main",
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

test("a pending dispatch only resolves to the same workflow at or after its request", () => {
  const pending = {
    workflow: "deploy-crm-pages.yml",
    dispatchRequestedAt: "2026-07-29T12:00:10.000Z",
  };
  assert.equal(matchesPendingDispatch({
    path: ".github/workflows/deploy-crm-pages.yml@refs/heads/main",
    created_at: "2026-07-29T12:00:11.000Z",
  }, pending), true);
  assert.equal(matchesPendingDispatch({
    path: ".github/workflows/deploy-crm-pages.yml@refs/heads/main",
    created_at: "2026-07-29T11:59:00.000Z",
  }, pending), false);
  assert.equal(matchesPendingDispatch({
    path: ".github/workflows/module-availability.yml@refs/heads/main",
    created_at: "2026-07-29T12:00:11.000Z",
  }, pending), false);
});

test("failure recovery reasserts maintenance only after governed children are terminal", () => {
  const workflow = fs.readFileSync(
    new URL("../workflows/ponto-progressive-release.yml", import.meta.url),
    "utf8",
  );
  const reconcile = workflow.indexOf("Cancel and reconcile every governed non-terminal child before rollback");
  const finalMaintenance = workflow.indexOf("Reassert maintenance after every governed child is terminal");
  const liveRollback = workflow.indexOf("Roll back every successfully mutated surface to its attested incumbent");
  assert.ok(reconcile >= 0);
  assert.ok(finalMaintenance > reconcile);
  assert.ok(liveRollback > finalMaintenance);
  assert.match(
    workflow.slice(finalMaintenance, liveRollback),
    /ponto-dispatch-workflow\.mjs module-availability\.yml[\s\S]*runs\/module-abort\.json/,
  );
  const reconciliationStep = workflow.slice(reconcile, finalMaintenance);
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
