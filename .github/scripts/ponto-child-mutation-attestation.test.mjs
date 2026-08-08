import assert from "node:assert/strict";
import test from "node:test";
import { attestTerminalPreMutationGateFailure } from "./ponto-child-mutation-attestation.mjs";

const run = (overrides = {}) => ({
  path: ".github/workflows/deploy-core-workers.yml@refs/heads/main",
  status: "completed",
  conclusion: "failure",
  run_attempt: 1,
  ...overrides,
});

test("attests a terminal coordination-gate failure as pre-mutation", () => {
  const result = attestTerminalPreMutationGateFailure({
    run: run(),
    jobs: [
      { id: 1, name: "coordination / consume", status: "completed", conclusion: "failure" },
      { id: 2, name: "promotion", status: "completed", conclusion: "skipped" },
      { id: 3, name: "deploy", status: "completed", conclusion: "skipped" },
    ],
  });
  assert.deepEqual(result, {
    workflowPath: ".github/workflows/deploy-core-workers.yml",
    coordinationJobId: "1",
    downstreamJobCount: 2,
    reason: "terminal-pre-mutation-gate-failure",
    mutationStarted: false,
  });
});

test("does not attest an ambiguous child with any executed downstream job", () => {
  assert.equal(attestTerminalPreMutationGateFailure({
    run: run(),
    jobs: [
      { id: 1, name: "coordination / consume", status: "completed", conclusion: "failure" },
      { id: 2, name: "deploy", status: "completed", conclusion: "failure" },
    ],
  }), null);
});

test("does not attest a cancelled child, rerun, or non-canonical workflow", () => {
  const jobs = [
    { id: 1, name: "coordination / consume", status: "completed", conclusion: "failure" },
    { id: 2, name: "deploy", status: "completed", conclusion: "skipped" },
  ];
  assert.equal(attestTerminalPreMutationGateFailure({ run: run({ conclusion: "cancelled" }), jobs }), null);
  assert.equal(attestTerminalPreMutationGateFailure({ run: run({ run_attempt: 2 }), jobs }), null);
  assert.equal(attestTerminalPreMutationGateFailure({ run: run({ path: ".github/workflows/module-availability.yml" }), jobs }), null);
});

