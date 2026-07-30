import assert from "node:assert/strict";
import test from "node:test";
import { matchesDispatchedRun } from "./ponto-dispatch-run-match.mjs";

const expected = {
  workflowId: 77,
  expectedPath: ".github/workflows/module-availability.yml",
  orchestratorHeadSha: "a".repeat(40),
  correlation: "12345",
  dispatchRequestedAt: "2026-07-29T12:00:10.500Z",
};
const current = {
  workflow_id: 77,
  path: ".github/workflows/module-availability.yml",
  head_sha: "a".repeat(40),
  created_at: "2026-07-29T12:00:11.000Z",
  display_title: "Module timekeeping production maintenance orchestrator=12345",
};

test("matches only a run created for the current dispatch", () => {
  assert.equal(matchesDispatchedRun(current, expected), true);
  assert.equal(matchesDispatchedRun({
    ...current,
    created_at: "2026-07-29T11:59:00.000Z",
  }, expected), false);
  assert.equal(matchesDispatchedRun({
    ...current,
    display_title: "Module timekeeping production maintenance orchestrator=54321",
  }, expected), false);
  assert.equal(matchesDispatchedRun({
    ...current,
    path: `${current.path}@refs/heads/main`,
  }, expected), false);
  assert.equal(matchesDispatchedRun({
    ...current,
    path: ".github/workflows/other.yml",
  }, expected), false);
});
