import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { keyCandidatesForRequest, keyRingFor } from "./key-ring.mjs";

const source = fs.readFileSync(path.join(import.meta.dirname, "index.js"), "utf8");
const keyRingSource = fs.readFileSync(path.join(import.meta.dirname, "key-ring.mjs"), "utf8");
const config = fs.readFileSync(path.join(import.meta.dirname, "wrangler.toml"), "utf8");
const stagingConfig = config.match(/\[env\.staging\.vars\][\s\S]*?(?=\n\[|$)/)?.[0] ?? "";

test("Cloudflare adapter uses one globally serialized SQLite Durable Object coordination plane", () => {
  assert.match(source, /class GlobalCoordinator extends DurableObject/);
  assert.match(source, /blockConcurrencyWhile/);
  assert.match(source, /storage\.sql\.exec/);
  assert.match(source, /env\.COORDINATION_PLANE_NAME \|\| "global"/);
  assert.match(source, /COORDINATION_PLANE_MODE/);
  assert.match(source, /coordinationMode === "legacy-drain"/);
  assert.match(source, /getByName\(planeName\)/);
  assert.match(source, /evaluateLeaseAdmission/);
  assert.match(config, /new_sqlite_classes = \["GlobalCoordinator"\]/);
  assert.match(config, /COORDINATION_PLANE_NAME = "global"/);
  assert.match(stagingConfig, /COORDINATION_PLANE_MODE = "global"/);
});

test("remote custody is mandatory and the adapter has no local fallback", () => {
  assert.match(keyRingSource, /COORDINATION_SHARED_SECRET/);
  assert.match(source, /coordination authority custody is unavailable/);
  assert.match(source, /return bad\("coordination authority custody is unavailable", 503\)/);
  assert.match(source, /coordination request rejected/);
  assert.match(source, /coordination request could not be processed/);
  assert.doesNotMatch(source, /in-memory fallback|local fallback|allowWithout/);
  assert.match(source, /authorizeMutation/);
  assert.match(source, /input\.authorization/);
});

test("revocation uses separate administrative custody", () => {
  assert.match(source, /COORDINATION_ADMIN_SECRET/);
  assert.match(source, /body\.action === "revoke"/);
  assert.match(source, /coordination revocation authority is unavailable/);
});

test("authority epoch and recovery custody are part of the signed contract", () => {
  assert.match(source, /authorityEpoch: state\.authorityEpoch/);
  assert.match(source, /RECOVERY_PROTOCOL = "epoch-fence-v1"/);
  assert.match(keyRingSource, /COORDINATION_RECOVERY_KEY_ID/);
  assert.match(keyRingSource, /COORDINATION_RECOVERY/);
  assert.match(source, /fenceAuthorityEpoch/);
  assert.match(source, /authorityEpoch: result\.authorityEpoch \?\? result\.state\?\.authorityEpoch \?\? nonce\.state\.authorityEpoch/);
  assert.match(source, /authorityEpoch,[\s\S]*?responseDigest/);
});

test("key rotation prefers the explicit active key and inherits only a pinned expiring legacy overlap", () => {
  const now = Date.parse("2026-08-10T15:00:00Z");
  const ring = keyRingFor({
    COORDINATION_CONTRACT_ID: "skincos/global-coordination/v1",
    COORDINATION_SHARED_SECRET: "old-secret",
    COORDINATION_ACTIVE_KEY: "new-secret",
    COORDINATION_ACTIVE_KEY_ID: "active-v2",
    COORDINATION_PREVIOUS_KEY_ID: "legacy-v1",
    COORDINATION_PREVIOUS_KEY_EXPIRES_AT: "2026-08-10T16:00:00Z",
    COORDINATION_ALLOW_LEGACY_KEY: "true",
  }, { now });
  assert.equal(ring.active.id, "active-v2");
  assert.equal(ring.active.secret, "new-secret");
  assert.deepEqual(ring.previous, { id: "legacy-v1", secret: "old-secret", expiresAt: Date.parse("2026-08-10T16:00:00Z") });
  assert.deepEqual(keyCandidatesForRequest(ring, "active-v2"), [ring.active]);
  assert.deepEqual(keyCandidatesForRequest(ring, "legacy-v1"), [ring.previous]);
  assert.deepEqual(keyCandidatesForRequest(ring, ""), [ring.active, ring.previous]);
});

test("expired or ambiguous previous key configuration fails closed and recovery never accepts an unpinned key", () => {
  const now = Date.parse("2026-08-10T17:00:00Z");
  const expired = keyRingFor({
    COORDINATION_SHARED_SECRET: "old-secret",
    COORDINATION_ACTIVE_KEY: "new-secret",
    COORDINATION_ACTIVE_KEY_ID: "active-v2",
    COORDINATION_PREVIOUS_KEY_ID: "legacy-v1",
    COORDINATION_PREVIOUS_KEY_EXPIRES_AT: "2026-08-10T16:00:00Z",
  }, { now });
  assert.equal(expired.previous, null);
  assert.deepEqual(keyCandidatesForRequest(expired, "legacy-v1"), []);
  assert.deepEqual(keyCandidatesForRequest(expired, ""), []);

  const recovery = keyRingFor({
    COORDINATION_RECOVERY_ACTIVE_KEY: "recovery-secret",
    COORDINATION_RECOVERY_ACTIVE_KEY_ID: "recovery-v2",
    COORDINATION_ALLOW_LEGACY_KEY: "true",
  }, { recovery: true, now });
  assert.deepEqual(keyCandidatesForRequest(recovery, ""), []);
  assert.deepEqual(keyCandidatesForRequest(recovery, "recovery-v2"), [recovery.active]);

  assert.equal(keyRingFor({
    COORDINATION_SHARED_SECRET: "old-secret",
    COORDINATION_ACTIVE_KEY: "new-secret",
    COORDINATION_ACTIVE_KEY_ID: "legacy-v1",
  }, { now }), null);
});

test("recovery endpoint is separate from the normal lease endpoint and requires the global plane", () => {
  assert.match(source, /url\.pathname === "\/v1\/recovery"/);
  assert.match(source, /recovery fence requires the global plane|coordination recovery requires the global plane/);
  assert.match(source, /isRecovery && coordinationMode !== "global"/);
  assert.match(keyRingSource, /COORDINATION_RECOVERY_KEY_ID/);
});

test("coordinator observability is structured and excludes request custody", () => {
  assert.match(source, /function logEvent\(event, fields = \{\}\)/);
  assert.match(source, /coordination\.readiness/);
  assert.match(source, /coordination\.request_processed/);
  assert.match(source, /coordination\.request_rejected/);
  assert.match(source, /coordination\.request_failed/);
  assert.match(source, /OBSERVABILITY_FIELDS/);
  assert.doesNotMatch(source, /console\.log\(JSON\.stringify\(rawBody/);
  assert.doesNotMatch(source, /console\.log\(JSON\.stringify\(.*secret/);
});
