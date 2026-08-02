import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const workflow = fs.readFileSync(
  new URL("../workflows/ponto-staging-recovery-rollback.yml", import.meta.url),
  "utf8",
);

test("staging recovery rollback is exact, serialized, and environment protected", () => {
  assert.match(workflow, /workflow_dispatch:/);
  for (const input of [
    "release_sha",
    "coordinator_run_id",
    "watchdog_run_id",
    "timekeeping_candidate_version_id",
    "timekeeping_incumbent_version_id",
    "authorization_ref",
  ]) assert.match(workflow, new RegExp(`\\b${input}:`));
  assert.match(workflow, /fresh-close:/);
  assert.match(workflow, /environment: ponto-emergency-staging/);
  assert.match(workflow, /PONTO_FAILED_COORDINATOR_RUN_ID: \$\{\{ inputs\.coordinator_run_id \}\}/);
  assert.match(workflow, /PONTO_EMERGENCY_TRIGGER_RUN_ID: \$\{\{ github\.run_id \}\}/);
  assert.match(workflow, /name: ponto-fresh-recovery-close-staging-\$\{\{ github\.run_id \}\}/);
  assert.match(workflow, /name: Normalize the fresh close with historical child reconciliation/);
  assert.match(workflow, /name: Read back the exact staging module control from Cloudflare KV/);
  assert.match(workflow, /readCloudflareKvJson/);
  assert.match(workflow, /fresh-close\/direct-readback\.json/);
  assert.match(workflow, /mutation\.compensationDisposition === "not-required"/);
  assert.match(workflow, /group: ponto-surface-mutation/);
  assert.match(workflow, /cancel-in-progress: false/);
  const freshClose = workflow.match(/jobs:\n  fresh-close:([\s\S]*?)\n\n  rollback:/)?.[1] || "";
  assert.doesNotMatch(freshClose, /concurrency:/);
  assert.match(workflow, /environment: staging/);
  assert.match(workflow, /\[\[ "\$GITHUB_REF" == refs\/heads\/main \]\]/);
  assert.match(workflow, /git rev-parse origin\/main.*GITHUB_SHA/);
  assert.match(workflow, /actions\/download-artifact@[0-9a-f]{40}/);
  assert.match(workflow, /run-id: \$\{\{ inputs\.watchdog_run_id \}\}/);
  assert.match(workflow, /ponto-automatic-rollback\.mjs/);
  assert.match(workflow, /PONTO_ROLLBACK_CHECK_TOKEN: \$\{\{ github\.token \}\}/);
  assert.match(workflow, /name: Upload immutable staging recovery evidence[\s\S]*?if: always\(\)/);
  assert.doesNotMatch(workflow, /target:\s*production/);
});
