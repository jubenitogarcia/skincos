import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { assertNoActionsTriggeredByMerge, mergeTriggeredActionsEvents } from "../codex-native-actions-audit.mjs";

test("merge trigger audit identifies push, status, deletion and closed PR events", () => {
  assert.deepEqual(mergeTriggeredActionsEvents("on:\n  push:\n    branches: [main]\n  workflow_dispatch:\n"), ["push"]);
  assert.deepEqual(mergeTriggeredActionsEvents("on: [push, workflow_dispatch]\n"), ["push"]);
  assert.deepEqual(mergeTriggeredActionsEvents("on:\n  pull_request_target:\n    types: [opened, closed]\n  status:\n"), ["pull_request_target:closed", "status"]);
  assert.throws(() => mergeTriggeredActionsEvents("on:\n  pull_request: {types: [closed]}\n"), /inline event configuration is ambiguous/);
  assert.throws(() => mergeTriggeredActionsEvents("on:\n  pull_request_target: {types: [closed]}\n"), /inline event configuration is ambiguous/);
  assert.deepEqual(mergeTriggeredActionsEvents("on:\n  check_run:\n"), ["check_run"]);
  assert.deepEqual(mergeTriggeredActionsEvents("on:\n  pull_request:\n    types: [opened, synchronize]\n  schedule:\n    - cron: '0 0 * * *'\n"), []);
  assert.throws(() => mergeTriggeredActionsEvents("name: no trigger\n"), /unavailable/);
});

test("native merge needs exact live Actions readback and refuses active push workflows", async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "native-actions-audit-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.mkdirSync(path.join(root, ".github/workflows"), { recursive: true });
  fs.writeFileSync(path.join(root, ".github/workflows/schedule.yml"), "on:\n  schedule:\n    - cron: '0 0 * * *'\n");
  fs.writeFileSync(path.join(root, ".github/workflows/push.yml"), "on:\n  push:\n    branches: [main]\n");
  const catalog = [
    { state: "active", path: ".github/workflows/schedule.yml" },
    { state: "disabled_manually", path: ".github/workflows/push.yml" },
  ];
  const githubJsonImpl = async (_repo, endpoint) => endpoint === "/actions/permissions"
    ? { enabled: true }
    : { workflows: catalog };
  assert.deepEqual(await assertNoActionsTriggeredByMerge({ repository: "owner/repo", githubJsonImpl, root }), {
    actionsEnabled: true, activeWorkflows: 1,
  });
  catalog[1].state = "active";
  await assert.rejects(assertNoActionsTriggeredByMerge({ repository: "owner/repo", githubJsonImpl, root }), /would start GitHub Actions/);
  catalog[1].state = "disabled_manually";
  assert.deepEqual(await assertNoActionsTriggeredByMerge({ repository: "owner/repo", githubJsonImpl, root, candidateRoot: root }), {
    actionsEnabled: true, activeWorkflows: 1,
  });
  fs.writeFileSync(path.join(root, ".github/workflows/new.yml"), "on:\n  push:\n");
  await assert.rejects(assertNoActionsTriggeredByMerge({ repository: "owner/repo", githubJsonImpl, root, candidateRoot: root, changedPaths: [".github/workflows/new.yml"] }), /candidate merge tree would start/);
  const disabled = await assertNoActionsTriggeredByMerge({ repository: "owner/repo", githubJsonImpl: async () => ({ enabled: false }), root });
  assert.deepEqual(disabled, { actionsEnabled: false, activeWorkflows: 0 });
  await assert.rejects(assertNoActionsTriggeredByMerge({ repository: "owner/repo", githubJsonImpl: async () => ({ enabled: true }), root }), /catalog is unavailable/);
});
