import assert from "node:assert/strict";
import test from "node:test";
import { assertNativeCustody } from "../token-vault-native-lease.mjs";

test("native Token Vault lease refuses absent coordination custody", () => {
  assert.throws(() => assertNativeCustody({}), /HTTPS URL is unavailable/);
  assert.throws(() => assertNativeCustody({ SKINCOS_GLOBAL_COORDINATOR_URL: "https://coordinator.example" }), /custody is unavailable/);
  assert.throws(() => assertNativeCustody({ SKINCOS_GLOBAL_COORDINATOR_URL: "http://coordinator.example" }), /HTTPS URL/);
});

test("native Token Vault lease requires a complete active key pair", () => {
  const url = "https://coordinator.example";
  assert.throws(() => assertNativeCustody({ SKINCOS_GLOBAL_COORDINATOR_URL: url, SKINCOS_GLOBAL_COORDINATION_ACTIVE_KEY: "opaque" }), /incomplete/);
  assert.throws(() => assertNativeCustody({ SKINCOS_GLOBAL_COORDINATOR_URL: url, SKINCOS_GLOBAL_COORDINATION_KEY_ID: "key-2" }), /incomplete/);
  assert.equal(assertNativeCustody({ SKINCOS_GLOBAL_COORDINATOR_URL: url, SKINCOS_GLOBAL_COORDINATION_ACTIVE_KEY: "opaque", SKINCOS_GLOBAL_COORDINATION_KEY_ID: "key-2" }), url);
});

test("native Token Vault lease accepts existing legacy custody without exposing it", () => {
  const url = "https://coordinator.example";
  assert.equal(assertNativeCustody({ SKINCOS_GLOBAL_COORDINATOR_URL: url, SKINCOS_GLOBAL_COORDINATION_SHARED_SECRET: "opaque" }), url);
});
