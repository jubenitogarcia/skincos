import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const workflow = fs.readFileSync(new URL("../workflows/ponto-legacy-absence-attestation.yml", import.meta.url), "utf8");

test("legacy absence attestation is dispatch-only, main-bound, protected, and isolated to the native custody runner", () => {
  assert.match(workflow, /workflow_dispatch:/);
  assert.match(workflow, /github\.repository == 'jubenitogarcia\/skincos'/);
  assert.match(workflow, /github\.ref == 'refs\/heads\/main'/);
  assert.match(workflow, /github\.run_attempt == 1/);
  assert.match(workflow, /runs-on: \[self-hosted, Linux, X64, skincos-native-custody\]/);
  assert.match(workflow, /environment: ponto-legacy-absence-attestation/);
  assert.match(workflow, /git rev-parse origin\/main/);
  assert.match(workflow, /PONTO_LEGACY_ABSENCE_MAIN_ADVANCED/);
});

test("absence workflow signs a bounded one-use authorization and invokes only the literal sudo action", () => {
  for (const marker of [
    "skincos/ponto/legacy-absence-attestation/v1",
    'operation: "attest-absence"',
    'target: "production"',
    'purpose: "ponto-legacy-absence-attestation"',
    'singleUse: true',
    'workflowPath: ".github/workflows/ponto-legacy-absence-attestation.yml"',
    'workflowJob: "attest"',
    'crypto.sign(null, Buffer.from(canonical), key)',
    "sudo -n /usr/local/sbin/skincos-attest-ponto-legacy-absence attest-absence",
  ]) assert.ok(workflow.includes(marker), marker);
  assert.doesNotMatch(workflow, /skincos-capture-ponto-legacy-snapshot|skincos-provision-ponto-jit|systemctl|wrangler|d1 |secret put|deploy|import-ponto-json/);
});

test("absence workflow uploads only a validated sanitized receipt and never the authorization or raw observation", () => {
  const uploadStart = workflow.indexOf("      - name: Upload the sanitized absence receipt only");
  assert.ok(uploadStart >= 0, "sanitized absence receipt upload is missing");
  const upload = workflow.slice(uploadStart);
  assert.match(workflow, /ponto-legacy-absence-receipt\.mjs validate/);
  assert.match(upload, /name: ponto-legacy-absence-receipt-\$\{\{ inputs\.release_sha \}\}/);
  assert.match(upload, /path: \$\{\{ runner\.temp \}\}\/ponto-legacy-absence-receipt\.json/);
  assert.doesNotMatch(workflow, /PONTO_AUDIT_HMAC_KEY|ponto_store\.v2\.json|ponto_audit\.v1\.jsonl/);
  assert.doesNotMatch(upload, /PRIVATE_KEY|AUTHORIZATION_FILE|\.raw\.json/);
});
