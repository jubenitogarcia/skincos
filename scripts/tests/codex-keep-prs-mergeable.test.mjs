import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

const root = path.resolve(import.meta.dirname, "../..");
const workflow = fs.readFileSync(
  path.join(root, ".github/workflows/codex-keep-prs-mergeable.yml"),
  "utf8",
);

test("branch maintenance admits only explicitly ready PRs", () => {
  assert.equal((workflow.match(/if \(pr\.draft !== false\) return false;/g) || []).length, 2);
  assert.match(workflow, /Found \$\{candidates\.length\} ready open codex PR\(s\) to evaluate/);
});

test("authority dispatch remains ready-only and strict freshness remains enabled", () => {
  assert.match(workflow, /if \(pr\.draft !== false \|\| !\['clean', 'blocked'\]/);
  assert.match(workflow, /await github\.rest\.pulls\.updateBranch\(\{/);
  assert.match(workflow, /expected_head_sha: headSha \|\| undefined/);
});

test("the scheduler and required-check contract remain unchanged", () => {
  assert.match(workflow, /cron: "\*\/10 \* \* \* \*"/);
  assert.match(workflow, /workflow_dispatch: \{\}/);
  assert.doesNotMatch(workflow, /merge_group/);
  assert.doesNotMatch(workflow, /required_status_checks|branch_protection|ruleset/);
});
