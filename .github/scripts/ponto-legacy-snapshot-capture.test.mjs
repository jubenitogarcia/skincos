import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const workflow = fs.readFileSync(new URL("../workflows/ponto-legacy-backfill-capture.yml", import.meta.url), "utf8");

test("legacy snapshot capture is dispatch-only, main-bound, protected, and isolated to the native custody runner", () => {
  assert.match(workflow, /workflow_dispatch:/);
  assert.match(workflow, /github\.repository == 'jubenitogarcia\/skincos'/);
  assert.match(workflow, /github\.ref == 'refs\/heads\/main'/);
  assert.match(workflow, /github\.run_attempt == 1/);
  assert.match(workflow, /runs-on: \[self-hosted, Linux, X64, skincos-native-custody\]/);
  assert.match(workflow, /environment: ponto-legacy-backfill-capture/);
  assert.match(workflow, /git rev-parse origin\/main/);
  assert.match(workflow, /PONTO_LEGACY_CAPTURE_MAIN_ADVANCED/);
});

test("capture signs a bounded one-use authorization and invokes only the exact fixed sudo command", () => {
  for (const marker of [
    "skincos/ponto/legacy-snapshot-custody/v1",
    'operation: "capture"',
    'target: "staging"',
    'purpose: "ponto-legacy-snapshot-capture"',
    'singleUse: true',
    'workflowPath: ".github/workflows/ponto-legacy-backfill-capture.yml"',
    'workflowJob: "capture"',
    'crypto.sign(null, Buffer.from(canonical), key)',
    "sudo -n /usr/local/sbin/skincos-capture-ponto-legacy-snapshot capture",
  ]) assert.ok(workflow.includes(marker), marker);
  assert.doesNotMatch(workflow, /skincos-provision-ponto-jit|systemctl|wrangler|d1 |secret put|deploy|import-ponto-json/);
});

test("capture uploads only a validated sanitized receipt and never the authorization or raw snapshot", () => {
  const uploadStart = workflow.indexOf("      - name: Upload the sanitized capture receipt only");
  assert.ok(uploadStart >= 0, "sanitized receipt upload is missing");
  const upload = workflow.slice(uploadStart);
  assert.match(workflow, /ponto-legacy-snapshot-receipt\.mjs validate/);
  assert.match(upload, /name: ponto-legacy-snapshot-receipt-\$\{\{ inputs\.release_sha \}\}/);
  assert.match(upload, /path: \$\{\{ runner\.temp \}\}\/ponto-legacy-snapshot-receipt\.json/);
  assert.doesNotMatch(workflow, /PONTO_AUDIT_HMAC_KEY|ponto_store\.v2\.json|ponto_audit\.v1\.jsonl/);
  assert.doesNotMatch(upload, /PRIVATE_KEY|AUTHORIZATION_FILE|\.raw\.json/);
});
