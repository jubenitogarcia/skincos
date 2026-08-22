import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import test from "node:test";

const workflow = await readFile(new URL("../workflows/beauty-movement-delivery-export.yml", import.meta.url), "utf8");
const script = await readFile(new URL("../../website/scripts/beauty-movement-delivery-export.ts", import.meta.url), "utf8");

test("delivery export is an explicit production-environment dispatch", () => {
  assert.match(workflow, /name: Beauty Movement private delivery export/);
  assert.match(workflow, /workflow_dispatch:/);
  assert.match(workflow, /environment: production/);
  assert.match(workflow, /release_sha:/);
  assert.match(workflow, /campaign_id:/);
  assert.match(workflow, /campaign_ends_at:/);
  assert.match(workflow, /expected_input_sha256:/);
  assert.match(workflow, /ref: \$\{\{ github\.sha \}\}/);
  assert.match(workflow, /WORKFLOW_SHA: \$\{\{ github\.sha \}\}/);
  assert.match(workflow, /git diff --quiet "\$\{RELEASE_SHA\}" -- website\/src\/lib\/beautyMovementImport\.ts/);
});

test("export derives from protected custody and does not mutate D1 or deploy", () => {
  for (const name of [
    "BEAUTY_MOVEMENT_TOKEN_HMAC_KEY",
    "BEAUTY_MOVEMENT_PII_KEY",
    "PRODUCTION_INVITES_CSV",
    "PRODUCTION_CAMPAIGN_JSON",
  ]) assert.match(workflow, new RegExp(name));
  assert.match(workflow, /beauty-movement:export-delivery/);
  assert.match(workflow, /d1 execute .*--remote/);
  assert.match(workflow, /SELECT status, ends_at_ms/);
  assert.doesNotMatch(workflow, /--apply/);
  assert.doesNotMatch(workflow, /d1 migrations apply/);
  assert.doesNotMatch(workflow, /wrangler deploy/);
  assert.match(workflow, /x-app-build/);
  assert.match(workflow, /active_invite_count/);
  assert.match(workflow, /actions\/upload-artifact/);
  assert.match(workflow, /retention-days: 1/);
  assert.match(workflow, /delivery\.csv/);
  assert.match(workflow, /export-summary\.json/);
});

test("script stdout is aggregate-only and the output is private", () => {
  assert.match(script, /flag: "wx"/);
  assert.match(script, /mode: "delivery_export"/);
  assert.match(script, /inputSha256/);
  assert.match(script, /outputSha256/);
  assert.match(script, /outputBytes/);
  assert.doesNotMatch(script, /console\.log\([^\n]*(inviteUrl|whatsapp|tokenHmacKey|deliveryRows)/i);
  assert.doesNotMatch(script, /console\.log\([^\n]*\bname\b/i);
});

test("all embedded workflow shell blocks parse", () => {
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
    execFileSync("bash", ["-n"], { input: block.join("\n"), encoding: "utf8" });
    blocks += 1;
  }
  assert.equal(blocks, 6);
});
