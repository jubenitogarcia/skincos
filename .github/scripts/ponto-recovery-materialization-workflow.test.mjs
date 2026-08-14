import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const read = (relative) => fs.readFileSync(new URL(relative, import.meta.url), "utf8");
const recovery = read("../workflows/ponto-staging-recovery-rollback.yml");
const coordinator = read("../workflows/ponto-progressive-release.yml");
const watchdog = read("../workflows/ponto-release-watchdog.yml");
const emergencyClose = read("../workflows/ponto-emergency-close.yml");

test("staging recovery materializes the broker close before direct custody readback", () => {
  const resourceIdentity = recovery.indexOf("ponto-cloudflare-resource-identity.mjs");
  const materialize = recovery.indexOf("ponto-module-control-materialize.mjs");
  const directReadback = recovery.indexOf("Read back the exact staging module control from Cloudflare KV");
  assert.ok(resourceIdentity >= 0);
  assert.ok(materialize >= 0);
  assert.ok(materialize > resourceIdentity);
  assert.ok(directReadback > materialize);
  assert.match(recovery, /PONTO_MODULE_CONTROL_KV_ID: \$\{\{ vars\.PONTO_MODULE_CONTROL_STAGING_KV_ID \}\}/);
  assert.match(recovery, /PONTO_MATERIALIZE_TARGET: staging/);
});

test("ordinary coordinator and watchdog recovery normalize the direct KV custody", () => {
  for (const workflow of [coordinator, watchdog]) {
    const resourceIdentity = workflow.indexOf("ponto-cloudflare-resource-identity.mjs");
    assert.match(workflow, /ponto-module-control-materialize\.mjs/);
    assert.ok(resourceIdentity >= 0);
    assert.ok(workflow.indexOf("ponto-module-control-materialize.mjs") > resourceIdentity);
    assert.match(workflow, /ponto-module-control-direct-readback\.json/);
    assert.match(workflow, /ponto-recovery-evidence\.mjs[\s\S]*ponto-module-control-direct-readback\.json/);
  }
  assert.match(coordinator, /\["control", "emergency-latch-active"\]\.includes\(availability\?\.source\)/);
});

test("all materialization jobs remain behind the non-cancelling surface mutex", () => {
  assert.match(recovery, /concurrency:\s+group: ponto-surface-mutation[\s\S]*?cancel-in-progress: false/);
  assert.match(coordinator, /recovery-rollback:[\s\S]*?group: ponto-surface-mutation[\s\S]*?cancel-in-progress: false/);
  assert.match(watchdog, /rollback:[\s\S]*?group: ponto-surface-mutation[\s\S]*?cancel-in-progress: false/);
});

test("manual emergency close materializes under the surface mutex and proves live control", () => {
  assert.match(emergencyClose, /materialize:\n[\s\S]*?group: ponto-surface-mutation/);
  assert.match(emergencyClose, /materialize:\n[\s\S]*?ponto-module-control-materialize\.mjs/);
  assert.match(emergencyClose, /materialize:\n[\s\S]*?ponto-cloudflare-resource-identity\.mjs[\s\S]*?ponto-module-control-materialize\.mjs/);
  assert.match(emergencyClose, /materialize:\n[\s\S]*?environment: \$\{\{ inputs\.target \}\}/);
  assert.match(emergencyClose, /materialize:\n[\s\S]*?live control reflects the materialized close/);
  assert.match(emergencyClose, /\["control", "emergency-latch-active"\]\.includes\(availability\?\.source\)/);
  assert.match(emergencyClose, /for \(let attempt = 0; attempt < 12; attempt \+= 1\)/);
  assert.match(emergencyClose, /close:\n[\s\S]*?group: ponto-emergency-latch-\$\{\{ inputs\.target \}\}/);
});

test("manual emergency re-attestation accepts a still-visible monotonic latch without weakening direct custody", () => {
  assert.match(
    emergencyClose,
    /if \(availability\.source === "emergency-latch-active"\) \{[\s\S]*?changedAt: availability\.changedAt[\s\S]*?fs\.rmSync\(process\.argv\[4\], \{ force: true \}\)/,
  );
  assert.match(emergencyClose, /if \[\[ -f "\$directory\/control-fallback-expectation\.json" \]\]; then/);
  assert.match(emergencyClose, /const validAvailabilityChangedAt = Number\.isFinite\(Date\.parse\(String\(availability\?\.changedAt \|\| ""\)\)\);/);
  assert.match(emergencyClose, /const exactControlChangedAt = availability\?\.source === "control"/);
  assert.match(emergencyClose, /&& validAvailabilityChangedAt\s*&& exactControlChangedAt/);
});
