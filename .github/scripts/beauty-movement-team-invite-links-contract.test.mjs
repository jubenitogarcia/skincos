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

test("Velocity-link workflow is bound to the existing production campaign and protected custody", () => {
  assert.match(workflow, /environment: production/);
  assert.match(
    workflow,
    /PRODUCTION_D1_DATABASE: espacofacial-beauty-movement/,
  );
  assert.match(workflow, /BOOKING_D1_DATABASE: espacofacial-booking/);
  assert.match(workflow, /BEAUTY_MOVEMENT_PRODUCTION_INVITES_CSV/);
  assert.match(workflow, /BEAUTY_MOVEMENT_PRODUCTION_EXTRA_INVITES_CSV/);
  assert.match(workflow, /BEAUTY_MOVEMENT_PRODUCTION_VELOCITY_EXTRA_INVITES_CSV/);
  assert.match(workflow, /BEAUTY_MOVEMENT_PRODUCTION_CAMPAIGN_JSON/);
  assert.match(workflow, /BEAUTY_MOVEMENT_TOKEN_HMAC_KEY/);
  assert.match(workflow, /BEAUTY_MOVEMENT_PII_KEY/);
  assert.match(workflow, /expected_base_input_sha256/);
  assert.match(workflow, /expected_extra_input_sha256/);
  assert.match(workflow, /expected_velocity_extra_input_sha256/);
  assert.match(workflow, /group: beauty-movement-team-invite-links-\$\{\{ inputs\.campaign_id \}\}/);
  assert.doesNotMatch(workflow, /BEAUTY_MOVEMENT_ENABLED:true/);
  assert.doesNotMatch(workflow, /wrangler secret put/);
});

test("Velocity append is active-campaign-only, fail-closed and read back before links are handed off", () => {
  assert.match(workflow, /status !== 'active'/);
  assert.match(
    workflow,
    /Confirm the target campaign is active before any D1 write/,
  );
  assert.match(workflow, /beauty-movement:import/);
  assert.match(workflow, /--apply --remote/);
  assert.match(workflow, /Read back all protected overlay invitations from production D1/);
  assert.match(workflow, /beauty-movement-velocity-invite-links\.mjs verify-overlay/);
  assert.match(workflow, /beauty-movement-velocity-short-delivery-/);
  assert.match(workflow, /beauty-movement-velocity-invite-links\.mjs materialize/);
  assert.match(workflow, /beauty-movement-velocity-invite-links\.mjs derive/);
  assert.match(workflow, /Preflight the exact existing commercial invitees receiving the additive Velocity courtesy/);
  assert.match(workflow, /Add the Velocity courtesy without changing existing commercial assignments/);
  assert.match(workflow, /beauty-movement-velocity-invite-links\.mjs verify-promotion/);
  assert.match(workflow, /beauty-movement-velocity-invite-links\.mjs verify-velocity/);
  assert.match(workflow, /!\[213, 257\]\.includes\(inviteCount\)/);
  assert.match(workflow, /Prove the complete overlay before resuming a previously appended run/);
  assert.match(workflow, /Preserve private guarded rollback evidence before production mutation/);
  assert.match(workflow, /PROMOTION_ROLLBACK_SQL/);
  assert.match(workflow, /promotion-rollback\.sql/);
  assert.match(workflow, /invite_count\) !== 257/);
  assert.match(workflow, /if: \$\{\{ always\(\) \}\}/);
  assert.match(workflow, /Remove runner-local private material/);
  assert.match(workflow, /Release Website production coordination lease/);

  const position = (value) => workflow.indexOf(value);
  assert.ok(position("Derive the complete short-link plan") < position("Append only new Velocity invitations"));
  assert.ok(position("Preflight the exact existing commercial invitees") < position("Append only new Velocity invitations"));
  assert.ok(position("Preserve private guarded rollback evidence") < position("Append only new Velocity invitations"));
  assert.ok(position("Add the Velocity courtesy") < position("Apply idempotent short-link mappings"));
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
