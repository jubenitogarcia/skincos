import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import test from "node:test";

const workflow = await readFile(
  new URL(
    "../workflows/beauty-movement-team-invite-links.yml",
    import.meta.url,
  ),
  "utf8",
);

test("team-link workflow is bound to the existing production campaign and protected custody", () => {
  assert.match(workflow, /environment: production/);
  assert.match(
    workflow,
    /PRODUCTION_D1_DATABASE: espacofacial-beauty-movement/,
  );
  assert.match(workflow, /BOOKING_D1_DATABASE: espacofacial-booking/);
  assert.match(workflow, /BEAUTY_MOVEMENT_PRODUCTION_INVITES_CSV/);
  assert.match(workflow, /BEAUTY_MOVEMENT_PRODUCTION_EXTRA_INVITES_CSV/);
  assert.match(workflow, /BEAUTY_MOVEMENT_PRODUCTION_CAMPAIGN_JSON/);
  assert.match(workflow, /BEAUTY_MOVEMENT_TOKEN_HMAC_KEY/);
  assert.match(workflow, /BEAUTY_MOVEMENT_PII_KEY/);
  assert.match(workflow, /expected_extra_input_sha256/);
  assert.doesNotMatch(workflow, /BEAUTY_MOVEMENT_ENABLED:true/);
  assert.doesNotMatch(workflow, /wrangler secret put/);
});

test("append is active-campaign-only, idempotent and read back before links are handed off", () => {
  assert.match(workflow, /status !== 'active'/);
  assert.match(
    workflow,
    /Confirm the target campaign is active before any D1 write/,
  );
  assert.match(workflow, /beauty-movement:import/);
  assert.match(workflow, /--apply --remote/);
  assert.match(workflow, /Read back all team invitations from production D1/);
  assert.match(workflow, /activeTeamInvites: rows.length/);
  assert.match(workflow, /beauty-movement-team-short-delivery-/);
  assert.match(workflow, /if: \$\{\{ always\(\) \}\}/);
  assert.match(workflow, /Remove runner-local private material/);
  assert.match(workflow, /Release Website production coordination lease/);
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
  assert.ok(blocks >= 10, `expected focused shell gates (found ${blocks})`);
});
