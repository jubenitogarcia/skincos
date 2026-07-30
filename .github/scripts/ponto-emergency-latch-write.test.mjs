import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  canonicalJson,
  createEmergencyBrokerFixture,
} from "./ponto-emergency-broker-fixture.mjs";
import { writeEmergencyLatch } from "./ponto-emergency-latch-write.mjs";

const contract = {
  schemaVersion: 1,
  id: "skincos/ponto/emergency-close/v1",
  mode: "close-only",
  target: "staging",
  custodyRef: "vault:emergency-close:staging",
  allowedOperations: ["latch-true", "maintenance"],
  deniedOperations: ["active", "arbitrary-kv-write", "canary", "delete", "disabled", "latch-false"],
};
const baseEnv = (reportFile) => ({
  PONTO_EMERGENCY_CLOSE_BROKER_URL: "https://close.example.invalid/v1/ponto",
  PONTO_EMERGENCY_CLOSE_BROKER_CREDENTIAL: "dedicated-close-broker-credential",
  PONTO_EMERGENCY_CLOSE_CUSTODY_REF: contract.custodyRef,
  PONTO_EMERGENCY_TARGET: "staging",
  PONTO_EMERGENCY_TRIGGER_RUN_ID: "101",
  PONTO_FAILED_COORDINATOR_RUN_ID: "99",
  PONTO_EMERGENCY_LATCH_REPORT: reportFile,
});
const testNow = Date.parse("2026-07-30T06:00:10.000Z");
const testNonce = "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";

test("emergency latch writer uses only the exact target-bound close-only broker", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "ponto-latch-"));
  const reportFile = path.join(root, "report.json");
  const fixture = createEmergencyBrokerFixture({
    target: "staging",
    custodyRef: contract.custodyRef,
  });
  let requestBody;
  const fetchImpl = async (url, init) => {
    assert.equal(url, "https://close.example.invalid/v1/ponto");
    assert.equal(init.method, "POST");
    assert.equal(init.headers.authorization, "Bearer dedicated-close-broker-credential");
    requestBody = JSON.parse(init.body);
    const expectedRequestSignature = createHmac(
      "sha256",
      "dedicated-close-broker-credential",
    ).update(canonicalJson({
      schemaVersion: 1,
      contractId: "skincos/ponto/emergency-close/v1",
      method: "POST",
      url,
      target: "staging",
      custodyRef: contract.custodyRef,
      responseKeyId: fixture.policy.responseKeyId,
      requestNonce: testNonce,
      requestedAt: "2026-07-30T06:00:10.000Z",
      requestDigest: init.headers["x-skincos-emergency-request-digest"],
    })).digest("base64url");
    assert.equal(
      init.headers["x-skincos-emergency-request-signature"],
      expectedRequestSignature,
    );
    const payload = {
      schemaVersion: 1,
      contract,
      operation: "latch-true",
      target: "staging",
      coordinatorRunId: "99",
      emergencyRunId: "101",
      latch: {
        schemaVersion: 1,
        module: "timekeeping",
        target: "staging",
        latched: true,
        changedAt: "2026-07-30T06:00:00.000Z",
        stopRunId: "99",
        emergencyRunId: "101",
      },
      observations: [{ passed: true }, { passed: true }, { passed: true }],
      passed: true,
      credentialsIncluded: false,
      piiIncluded: false,
    };
    return new Response(
      JSON.stringify(fixture.signResponse(payload, url, init)),
      { status: 200 },
    );
  };
  const result = await writeEmergencyLatch({
    env: baseEnv(reportFile),
    fetchImpl,
    brokerPolicy: fixture.policy,
    now: () => testNow,
    nonceFactory: () => testNonce,
  });
  assert.deepEqual(requestBody, {
    schemaVersion: 1,
    operation: "latch-true",
    target: "staging",
    coordinatorRunId: "99",
    emergencyRunId: "101",
    requestNonce: testNonce,
    requestedAt: "2026-07-30T06:00:10.000Z",
  });
  assert.equal(result.passed, true);
  assert.equal(result.observations.length, 3);
  assert.equal(result.latched, true);
  assert.equal(JSON.stringify(result).includes("dedicated-close-broker-credential"), false);
  assert.equal(JSON.stringify(result).includes("close.example.invalid"), false);
});

test("emergency latch writer rejects a cross-target or overbroad broker contract", async () => {
  for (const mutatedContract of [
    { ...contract, target: "production" },
    { ...contract, allowedOperations: [...contract.allowedOperations, "latch-false"] },
  ]) {
    const fixture = createEmergencyBrokerFixture({
      target: "staging",
      custodyRef: contract.custodyRef,
    });
    await assert.rejects(
      writeEmergencyLatch({
        env: baseEnv(path.join(os.tmpdir(), "ponto-invalid-latch.json")),
        brokerPolicy: fixture.policy,
        now: () => testNow,
        nonceFactory: () => testNonce,
        fetchImpl: async (url, init) => {
          const payload = {
            contract: mutatedContract,
            passed: true,
            credentialsIncluded: false,
            piiIncluded: false,
          };
          return new Response(
            JSON.stringify(fixture.signResponse(payload, url, init)),
            { status: 200 },
          );
        },
      }),
      /broker contract is invalid/,
    );
  }
});

test("emergency latch writer has no Cloudflare token, arbitrary KV, false, or delete path", () => {
  const source = fs.readFileSync(new URL("./ponto-emergency-latch-write.mjs", import.meta.url), "utf8");
  assert.doesNotMatch(source, /CLOUDFLARE|storage\/kv|namespaces|latched:\s*false|method:\s*"DELETE"/);
  assert.match(source, /operation:\s*"latch-true"/);
});
