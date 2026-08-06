import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const source = fs.readFileSync(
  new URL("../workflows/codex-autonomy-gate.yml", import.meta.url),
  "utf8",
);

test("ready-for-review transitions create the required PR check", () => {
  assert.match(
    source,
    /pull_request:\n\s+types:\s+\[opened, synchronize, reopened, ready_for_review\]/,
  );
});

test("manual autonomy recovery requires an exact ancestor base", () => {
  assert.match(source, /workflow_dispatch:\n\s+inputs:\n\s+base_sha:/);
  assert.match(source, /MANUAL_BASE_SHA: \$\{\{ inputs\.base_sha \}\}/);
  assert.match(source, /Manual governance base_sha must be a full commit SHA/);
  assert.match(source, /git merge-base --is-ancestor \"\$base\" \"\$GITHUB_SHA\"/);
});
