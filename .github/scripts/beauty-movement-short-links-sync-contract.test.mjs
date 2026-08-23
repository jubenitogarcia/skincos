import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const workflow = await readFile(
  new URL("../workflows/beauty-movement-short-links-sync.yml", import.meta.url),
  "utf8",
);

test("short-link readbacks use command mode so SELECT rows are returned", () => {
  assert.ok(workflow.includes('conflict_sql="$(<"${SHORT_CONFLICTS}")"'));
  assert.match(workflow, /--command "\$\{conflict_sql\}" .*--json > "\$\{D1_CONFLICT_READBACK\}"/);
  assert.ok(workflow.includes('readback_sql="$(<"${SHORT_READBACK}")"'));
  assert.match(workflow, /--command "\$\{readback_sql\}" .*--json > "\$\{D1_FINAL_READBACK\}"/);
  assert.doesNotMatch(
    workflow,
    /d1 execute .*--file "\$\{SHORT_CONFLICTS\}"|d1 execute .*--file "\$\{SHORT_READBACK\}"/s,
  );
  assert.match(workflow, /d1 execute .*--file "\$\{SHORT_SQL\}" .*--json/);
});
