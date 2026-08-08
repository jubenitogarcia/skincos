import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const workflow = fs.readFileSync(
  new URL("../workflows/ponto-staging-core-provenance-recovery.yml", import.meta.url),
  "utf8",
);

test("Core provenance recovery is staging-only, exact, and fail-closed", () => {
  assert.match(workflow, /workflow_dispatch:/);
  for (const input of ["release_sha", "coordinator_run_id", "authorization_ref"]) {
    assert.match(workflow, new RegExp(`\\b${input}:`));
  }
  assert.match(workflow, /group: ponto-surface-mutation/);
  assert.match(workflow, /cancel-in-progress: false/);
  assert.match(workflow, /permissions:\n  actions: read\n  contents: read/);
  assert.match(workflow, /fresh-close:[\s\S]*?environment: ponto-emergency-staging/);
  assert.match(workflow, /rollback:[\s\S]*?environment: staging/);
  assert.match(workflow, /git merge-base --is-ancestor "\$RELEASE_SHA" origin\/main/);
  assert.match(workflow, /run\.path !== "\.github\/workflows\/ponto-progressive-release\.yml"/);
  assert.match(workflow, /run\.display_title !== `Ponto staging \$\{sha\} orchestrator=\$\{process\.env\.COORDINATOR_RUN_ID\}`/);
  assert.match(workflow, /findBySuffix\(path\.join\("surfaces", "core", "surface\.json"\)\)/);
  assert.doesNotMatch(workflow, /const surface = read\("surface\.json"\)/);
  assert.match(workflow, /mutation\.mutationStarted !== true/);
  assert.match(workflow, /mutation\.mutationCompleted !== true/);
  assert.match(workflow, /mutation\.rollbackCompleted !== false/);
  assert.match(workflow, /mutation\.compensationDisposition !== "not-run"/);
  assert.match(workflow, /ponto-cloudflare-resource-identity\.mjs/);
  assert.match(workflow, /ponto-module-control-materialize\.mjs/);
  assert.match(workflow, /ponto-automatic-rollback\.mjs/);
  assert.match(workflow, /activeVersions\[0\]\?\.percentage !== 100/);
  assert.match(workflow, /body\?\.availability\?\.state !== "maintenance"/);
  assert.match(workflow, /name: Upload immutable Core provenance recovery evidence[\s\S]*?if: always\(\)/);
  assert.doesNotMatch(workflow, /target:\s*production/);
});
