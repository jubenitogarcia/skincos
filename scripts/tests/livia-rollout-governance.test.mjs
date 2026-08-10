import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const root = new URL("../..", import.meta.url);
const read = (relativePath) => fs.readFileSync(new URL(relativePath, root), "utf8");

test("Livia progressive rollout is immutable, lease-protected, and no-publish", () => {
  const controller = read("scripts/runtime/livia-progressive-rollout.sh");
  const setter = read("orb/engine/scripts/livia/set-rollout-mode.js");
  const policy = read("ops/governance/livia-rollout-policy.json");

  assert.match(controller, /native_coordination_init/);
  assert.match(controller, /native_coordination_check/);
  assert.match(controller, /native_coordination_acquire/);
  assert.match(controller, /native_coordination_cleanup/);
  assert.match(controller, /opt\/skincos\/releases\//);
  assert.match(controller, /--apply is required/);
  assert.match(controller, /resultingMode/);
  assert.doesNotMatch(controller, /facebook|instagram|whatsapp|cloudinary|evolution/i);
  assert.match(setter, /pg_advisory_xact_lock/);
  assert.match(setter, /BEGIN/);
  assert.match(setter, /COMMIT/);
  assert.match(setter, /LIVIA_REEL_COVER_MODE/);
  assert.match(setter, /version drifted/);
  assert.match(policy, /"failureMode": "shadow"/);
});
