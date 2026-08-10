import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

const source = fs.readFileSync(path.join(import.meta.dirname, "index.js"), "utf8");
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
  assert.match(source, /COORDINATION_SHARED_SECRET/);
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
  assert.match(source, /COORDINATION_RECOVERY_KEY_ID/);
  assert.match(source, /COORDINATION_RECOVERY/);
  assert.match(source, /fenceAuthorityEpoch/);
  assert.match(source, /authorityEpoch: result\.authorityEpoch \?\? result\.state\?\.authorityEpoch \?\? nonce\.state\.authorityEpoch/);
  assert.match(source, /authorityEpoch,[\s\S]*?responseDigest/);
});

test("recovery endpoint is separate from the normal lease endpoint and requires the global plane", () => {
  assert.match(source, /url\.pathname === "\/v1\/recovery"/);
  assert.match(source, /recovery fence requires the global plane|coordination recovery requires the global plane/);
  assert.match(source, /isRecovery && coordinationMode !== "global"/);
  assert.match(source, /COORDINATION_RECOVERY_KEY_ID/);
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
