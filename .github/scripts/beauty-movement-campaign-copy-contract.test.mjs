import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import test from "node:test";

const workflow = await readFile(
  new URL("../workflows/beauty-movement-campaign-copy-update.yml", import.meta.url),
  "utf8",
);

test("campaign copy update is production-only, release-bound and narrowly scoped", () => {
  assert.match(workflow, /environment: production/);
  assert.match(workflow, /PRODUCTION_D1_DATABASE: espacofacial-beauty-movement/);
  assert.match(workflow, /BEAUTY_MOVEMENT_PRODUCTION_CAMPAIGN_JSON/);
  assert.match(workflow, /beauty-movement:update-copy/);
  assert.match(workflow, /--dry-run/);
  assert.match(workflow, /--apply --remote/);
  assert.match(workflow, /status !== 'active'/);
  assert.match(workflow, /ends_at_ms/);
  assert.match(workflow, /invite_count/);
  assert.match(workflow, /Release Website production coordination lease/);
  assert.match(workflow, /Remove runner-local private material/);
  assert.doesNotMatch(workflow, /wrangler secret put/);
  assert.doesNotMatch(workflow, /INSERT INTO bm_campaigns/);
  assert.doesNotMatch(workflow, /UPDATE bm_invites/);
});

test("all embedded bash blocks parse before the workflow can mutate production", () => {
  const lines = workflow.split(/\r?\n/);
  let blocks = 0;
  for (let index = 0; index < lines.length; index += 1) {
    if (!/^        run: \|$/.test(lines[index] ?? "")) continue;
    const block = [];
    for (let cursor = index + 1; cursor < lines.length; cursor += 1) {
      const line = lines[cursor] ?? "";
      if (line && !line.startsWith("          ")) break;
      block.push(line.startsWith("          ") ? line.slice(10) : "");
    }
    const script = block.join("\n");
    assert.notEqual(script.trim(), "", `run block ${blocks + 1} is empty`);
    execFileSync("bash", ["-n"], { input: script, encoding: "utf8" });
    blocks += 1;
  }
  assert.ok(blocks >= 7, `expected focused shell gates (found ${blocks})`);
});
