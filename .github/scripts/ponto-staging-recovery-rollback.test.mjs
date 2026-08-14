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
    "timekeeping_owner_recovery_run_id",
    "timekeeping_owner_coordinator_run_id",
    "timekeeping_owner_release_sha",
    "authorization_ref",
  ]) assert.match(workflow, new RegExp(`\\b${input}:`));
  assert.match(workflow, /fresh-close:/);
  assert.match(workflow, /environment: ponto-emergency-staging/);
  assert.match(workflow, /PONTO_FAILED_COORDINATOR_RUN_ID: \$\{\{ inputs\.coordinator_run_id \}\}/);
  assert.match(workflow, /PONTO_EMERGENCY_TRIGGER_RUN_ID: \$\{\{ github\.run_id \}\}/);
  assert.match(workflow, /name: ponto-fresh-recovery-close-staging-\$\{\{ github\.run_id \}\}/);
  assert.match(workflow, /name: Normalize the fresh close with historical child reconciliation/);
  assert.match(workflow, /name: Read back the exact staging module control from Cloudflare KV/);
  assert.match(
    workflow,
    /\["control", "emergency-latch-active"\]\.includes\((?:body\?\.availability\?\.source|availabilitySource)\)/,
  );
  assert.match(workflow, /PONTO_MATERIALIZE_REPORT: \$\{\{ runner\.temp \}\}\/ponto-staging-recovery-rollback\/fresh-close\/materialized-readback\.json/);
  assert.match(workflow, /body\?\.availability\?\.changedAt === expectedAvailabilityChangedAt/);
  assert.match(workflow, /readCloudflareKvJson/);
  assert.match(workflow, /fresh-close\/direct-readback\.json/);
  assert.match(workflow, /const propagationDeadline = Date\.now\(\) \+ 75_000/);
  assert.match(workflow, /while \(Date\.now\(\) <= propagationDeadline\)/);
  assert.match(workflow, /try \{[\s\S]*?const response = await fetch\(process\.env\.PONTO_MODULE_HEALTH_URL/);
  assert.match(workflow, /\} catch \{[\s\S]*?transient health-probe failure consumes this attempt/);
  assert.match(workflow, /let consecutiveValidSamples = 0/);
  assert.match(workflow, /if \(consecutiveValidSamples >= 2\)/);
  assert.match(workflow, /lastValidSampleKey = ""/);
  assert.match(workflow, /Math\.min\(5_000, remainingMs\)/);
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
  assert.match(workflow, /ponto-worker-ownership-recovery\.mjs/);
  assert.match(workflow, /current-worker-ownership\.json/);
  assert.match(workflow, /name: ponto-staging-recovery-rollback-\$\{\{ inputs\.timekeeping_owner_coordinator_run_id \}\}-\$\{\{ inputs\.timekeeping_owner_recovery_run_id \}\}/);
  assert.doesNotMatch(workflow, /watchdog\.head_sha !== releaseSha/);
  assert.match(workflow, /!\/\^\[0-9a-f\]\{40\}/);
  assert.match(workflow, /ponto-automatic-rollback\.mjs/);
  assert.match(workflow, /PONTO_ROLLBACK_CHECK_TOKEN: \$\{\{ github\.token \}\}/);
  assert.match(workflow, /name: Upload immutable staging recovery evidence[\s\S]*?if: always\(\)/);
  assert.doesNotMatch(workflow, /target:\s*production/);
});

test("staging recovery rollback leases its trusted workflow source separately from historical custody", () => {
  for (const name of [
    "Acquire global Ponto recovery lease for staging rollback",
    "Check global Ponto recovery lease immediately before staging materialization",
    "Check global Ponto recovery lease immediately before staging rollback",
  ]) {
    const start = workflow.indexOf(`- name: ${name}`);
    assert.notEqual(start, -1, `missing recovery lease step: ${name}`);
    const end = workflow.indexOf("\n      - name:", start + 1);
    const step = workflow.slice(start, end === -1 ? undefined : end);
    assert.match(step, /source_sha: \$\{\{ github\.sha \}\}/);
    assert.doesNotMatch(step, /source_sha: \$\{\{ inputs\.release_sha \}\}/);
  }
});
