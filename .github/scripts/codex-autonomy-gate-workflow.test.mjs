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
  assert.match(source, /push:\n\s+branches:\s+\[main, 'codex\/\*\*'\]/);
});

test("manual autonomy recovery requires an exact ancestor base", () => {
  assert.match(source, /workflow_dispatch:\n\s+inputs:\n\s+base_sha:/);
  assert.match(source, /MANUAL_BASE_SHA: \$\{\{ inputs\.base_sha \}\}/);
  assert.match(source, /Manual governance base_sha must be a full commit SHA/);
  assert.match(source, /git merge-base --is-ancestor \"\$base\" \"\$GITHUB_SHA\"/);
});

test("push recovery classifies rebased branches from their mainline", () => {
  assert.match(source, /git cat-file -e \"\$base\^\{commit\}\" 2>\/dev\/null/);
  assert.match(source, /git fetch --no-tags origin main/);
  assert.match(source, /base=\"\$\(git merge-base \"\$GITHUB_SHA\" origin\/main\)\"/);
});
