import assert from "node:assert/strict";
import test from "node:test";
import { attestEmergencyBroker } from "./ponto-emergency-broker.mjs";
import { createEmergencyBrokerFixture } from "./ponto-emergency-broker-fixture.mjs";

const target = "staging";
const custodyRef = "vault:emergency-close:staging";
const env = {
  PONTO_EMERGENCY_CLOSE_BROKER_URL: "https://close.example.invalid/v1/ponto",
  PONTO_EMERGENCY_CLOSE_BROKER_CREDENTIAL: "dedicated-close-broker-credential",
  PONTO_EMERGENCY_CLOSE_CUSTODY_REF: custodyRef,
  PONTO_EMERGENCY_TARGET: target,
};
const nowMs = Date.parse("2026-07-30T06:00:10.000Z");
const nonce = "CCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCC";
const contract = {
  schemaVersion: 1,
  id: "skincos/ponto/emergency-close/v1",
  mode: "close-only",
  target,
  custodyRef,
  allowedOperations: ["latch-true", "maintenance"],
  deniedOperations: [
    "active",
    "arbitrary-kv-write",
    "canary",
    "delete",
    "disabled",
    "latch-false",
  ],
};
const successfulPayload = {
  schemaVersion: 1,
  contract,
  passed: true,
  credentialsIncluded: false,
  piiIncluded: false,
};

test("broker attestation requires an exact versioned identity and signed response", async () => {
  const fixture = createEmergencyBrokerFixture({ target, custodyRef });
  const result = await attestEmergencyBroker({
    env,
    brokerPolicy: fixture.policy,
    now: () => nowMs,
    nonceFactory: () => nonce,
    fetchImpl: async (url, init) => {
      assert.equal(init.redirect, "manual");
      assert.equal(init.headers["x-skincos-emergency-request-nonce"], nonce);
      return new Response(
        JSON.stringify(fixture.signResponse(successfulPayload, url, init)),
        { status: 200 },
      );
    },
  });
  assert.equal(result.passed, true);
  assert.equal(result.responseKeyId, fixture.policy.responseKeyId);
});

test("broker rejects an environment URL that differs from reviewed policy before sending custody", async () => {
  const fixture = createEmergencyBrokerFixture({ target, custodyRef });
  let called = false;
  await assert.rejects(
    attestEmergencyBroker({
      env: {
        ...env,
        PONTO_EMERGENCY_CLOSE_BROKER_URL: "https://attacker.example/v1/ponto",
      },
      brokerPolicy: fixture.policy,
      fetchImpl: async () => {
        called = true;
        return new Response();
      },
    }),
    /differs from the reviewed target identity/,
  );
  assert.equal(called, false);
});

test("broker rejects unsigned and post-signature-tampered success responses", async () => {
  const fixture = createEmergencyBrokerFixture({ target, custodyRef });
  await assert.rejects(
    attestEmergencyBroker({
      env,
      brokerPolicy: fixture.policy,
      now: () => nowMs,
      nonceFactory: () => nonce,
      fetchImpl: async () => new Response(
        JSON.stringify(successfulPayload),
        { status: 200 },
      ),
    }),
    /response identity is invalid/,
  );
  await assert.rejects(
    attestEmergencyBroker({
      env,
      brokerPolicy: fixture.policy,
      now: () => nowMs,
      nonceFactory: () => nonce,
      fetchImpl: async (url, init) => {
        const signed = fixture.signResponse(successfulPayload, url, init);
        signed.contract = { ...signed.contract, target: "production" };
        return new Response(JSON.stringify(signed), { status: 200 });
      },
    }),
    /response identity is invalid/,
  );
});

test("broker rejects stale, future, binding-swapped, and wrong-key responses", async () => {
  const fixture = createEmergencyBrokerFixture({ target, custodyRef });
  for (const issuedAt of [
    "2026-07-30T05:54:00.000Z",
    "2026-07-30T06:01:00.001Z",
  ]) {
    await assert.rejects(
      attestEmergencyBroker({
        env,
        brokerPolicy: fixture.policy,
        now: () => nowMs,
        nonceFactory: () => nonce,
        fetchImpl: async (url, init) => new Response(JSON.stringify(
          fixture.signResponse(successfulPayload, url, init, { issuedAt }),
        ), { status: 200 }),
      }),
      /response identity is invalid/,
    );
  }
  await assert.rejects(
    attestEmergencyBroker({
      env,
      brokerPolicy: fixture.policy,
      now: () => nowMs,
      nonceFactory: () => nonce,
      fetchImpl: async (url, init) => {
        const signed = fixture.signResponse(successfulPayload, url, init);
        signed.brokerAttestation.requestBinding.requestNonce = "D".repeat(43);
        return new Response(JSON.stringify(signed), { status: 200 });
      },
    }),
    /response identity is invalid/,
  );
  const wrongKey = createEmergencyBrokerFixture({ target, custodyRef });
  await assert.rejects(
    attestEmergencyBroker({
      env,
      brokerPolicy: {
        ...fixture.policy,
        responsePublicKeyPem: wrongKey.policy.responsePublicKeyPem,
      },
      now: () => nowMs,
      nonceFactory: () => nonce,
      fetchImpl: async (url, init) => new Response(JSON.stringify(
        fixture.signResponse(successfulPayload, url, init),
      ), { status: 200 }),
    }),
    /response identity is invalid/,
  );
});

test("committed unresolved broker identity fails closed before network use", async () => {
  let called = false;
  await assert.rejects(
    attestEmergencyBroker({
      env,
      fetchImpl: async () => {
        called = true;
        return new Response();
      },
    }),
    /versioned emergency close broker identity is absent or invalid/,
  );
  assert.equal(called, false);
});
