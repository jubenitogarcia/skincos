import assert from "node:assert/strict";
import test from "node:test";
import { buildWorkerRollbackArgs } from "./ponto-automatic-rollback-command.mjs";

test("automatic Worker rollback is explicitly non-interactive and exact", () => {
  const args = buildWorkerRollbackArgs({
    incumbentVersionId: "11111111-1111-4111-8111-111111111111",
    workerName: "skincos-timekeeping",
    releaseSha: "a".repeat(40),
    orchestratorRunId: "12345",
  });
  assert.deepEqual(args, [
    "--yes",
    "wrangler@4.112.0",
    "rollback",
    "11111111-1111-4111-8111-111111111111",
    "--name",
    "skincos-timekeeping",
    "--message",
    `ponto:auto-abort:${"a".repeat(40)}:orchestrator-12345`,
    "--yes",
  ]);
});
