import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import test from "node:test";

const workflow = await readFile(new URL("../workflows/beauty-movement-production-activation.yml", import.meta.url), "utf8");

test("production activation is a distinct, exact-SHA promotion gate", () => {
  assert.match(workflow, /name: Beauty Movement controlled production activation/);
  assert.match(workflow, /target: production/);
  assert.match(workflow, /release_sha:/);
  assert.match(workflow, /staging_run_id:/);
  assert.match(workflow, /uses: \.\/\.github\/workflows\/promotion-gate\.yml/);
  assert.match(workflow, /release_sha: \$\{\{ inputs\.release_sha \}\}/);
  assert.match(workflow, /staging_run_id: \$\{\{ inputs\.staging_run_id \}\}/);
  assert.match(workflow, /ref: \$\{\{ needs\.promotion\.outputs\.source_sha \}\}/);
  assert.match(workflow, /RELEASE_SHA: \$\{\{ needs\.promotion\.outputs\.source_sha \}\}/);
});

test("activation is bound to production resources and keeps the repository default disabled", () => {
  assert.match(workflow, /PRODUCTION_URL: https:\/\/espacofacial\.com/);
  assert.match(workflow, /PRODUCTION_D1_DATABASE: espacofacial-beauty-movement/);
  assert.match(workflow, /PRODUCTION_WORKER_NAME: espacofacial-site/);
  assert.match(workflow, /BEAUTY_MOVEMENT_ENABLED = "false"/);
  assert.match(workflow, /--var 'BEAUTY_MOVEMENT_ENABLED:true'/);
  assert.match(workflow, /--keep-vars/);
  assert.doesNotMatch(workflow, /wrangler secret put/);
  assert.doesNotMatch(workflow, /continue-on-error/);
});

test("private package and remote secret custody are fail-closed without logging values", () => {
  for (const name of [
    "BEAUTY_MOVEMENT_TOKEN_HMAC_KEY",
    "BEAUTY_MOVEMENT_PII_KEY",
    "BEAUTY_MOVEMENT_PRODUCTION_INVITES_CSV",
    "BEAUTY_MOVEMENT_PRODUCTION_CAMPAIGN_JSON",
  ]) {
    assert.match(workflow, new RegExp(name));
  }
  assert.match(workflow, /required production custody is unavailable/);
  assert.match(workflow, /secret list/);
  assert.match(workflow, /production Worker secret is missing/);
  assert.match(workflow, /Private production package materialized in runner-only storage/);
  assert.doesNotMatch(workflow, /echo \"\$\{PRODUCTION_(?:INVITES|CAMPAIGN|REWARDS|PROCEDURES)/);
  assert.doesNotMatch(workflow, /cat \"\$\{PACKAGE_DIR\}\/.*\.csv\"/);
});

test("schema, draft readback, build attestation, browser journey and persisted outcome are required", () => {
  assert.match(workflow, /0004_card_outcomes\.sql/);
  assert.match(workflow, /beauty_movement_production_invite_assignment_schema_invalid/);
  assert.match(workflow, /status !== 'draft'/);
  assert.match(workflow, /beauty_movement_active_readback_invalid/);
  assert.match(workflow, /beauty_movement_active_campaign_already_present/);
  assert.match(workflow, /x-app-build/);
  assert.match(workflow, /beauty_movement_production_build_attestation_failed/);
  assert.match(workflow, /chromium/);
  assert.match(workflow, /revealRequests/);
  assert.match(workflow, /reloadStable/);
  assert.match(workflow, /whatsappRequests/);
  assert.match(workflow, /outcome_protocol_version/);
  assert.match(workflow, /beauty-movement-outcomes-v2/);
  assert.match(workflow, /outcome_snapshot_length/);
});

test("failed or incomplete activation compensates only run-scoped data and restores the attested incumbent", () => {
  assert.match(workflow, /if: \$\{\{ always\(\) \}\}/);
  assert.match(workflow, /synthetic production smoke fixture/);
  assert.match(workflow, /invite_status = 'revoked'/);
  assert.match(workflow, /status = 'disabled'/);
  assert.match(workflow, /incumbentVersion/);
  assert.match(workflow, /wrangler@4\.112\.0 rollback/);
  assert.match(workflow, /production campaign is not inactive after compensation/);
  assert.match(workflow, /Publish redacted activation evidence/);
  assert.match(workflow, /Upload redacted activation evidence/);
});

test("every embedded bash run block parses before the workflow can mutate production", () => {
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
  assert.ok(blocks >= 14, `expected the activation workflow to have focused shell gates (found ${blocks})`);
});
