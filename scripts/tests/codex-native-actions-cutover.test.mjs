import assert from "node:assert/strict";
import test from "node:test";
import { classifyWorkflow } from "../codex-native-actions-cutover.mjs";

const classify = (path, names, state = "active", error = null) => classifyWorkflow({
  path, state, error, events: names?.map((name) => ({ name, block: "" })),
});

test("cutover selects only known event-only workflows", () => {
  const path = ".github/workflows/ci-smoke.yml";
  assert.equal(classify(path, ["push", "pull_request", "workflow_dispatch"]), "event-only");
  assert.equal(classify(path, ["push", "schedule"]), "mixed-duty");
  assert.equal(classify(path, ["push", "workflow_run"]), "mixed-duty");
  assert.equal(classify(path, ["schedule", "workflow_dispatch"]), "preserve");
  assert.equal(classify(path, null, "active", "unavailable source"), "unclassified");
  assert.equal(classify(path, ["push"], "disabled_manually"), "inactive");
});

test("cutover protects merge authority even with only PR target events", () => {
  assert.equal(classify(".github/workflows/global-merge-authority.yml", ["pull_request_target"]), "safety-gate");
  assert.equal(classify(".github/workflows/skincos-integration-gate.yml", ["pull_request_target"]), "safety-gate");
});
