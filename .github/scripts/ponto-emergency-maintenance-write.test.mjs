import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createEmergencyBrokerFixture } from "./ponto-emergency-broker-fixture.mjs";
import { writeEmergencyMaintenance } from "./ponto-emergency-maintenance-write.mjs";

const contract = {
  schemaVersion: 1,
  id: "skincos/ponto/emergency-close/v1",
  mode: "close-only",
  target: "production",
  custodyRef: "vault:emergency-close:production",
  allowedOperations: ["latch-true", "maintenance"],
  deniedOperations: ["active", "arbitrary-kv-write", "canary", "delete", "disabled", "latch-false"],
};
const setup = () => ({
  env: {
    PONTO_EMERGENCY_CLOSE_BROKER_URL: "https://close.example.invalid/v1/ponto",
    PONTO_EMERGENCY_CLOSE_BROKER_CREDENTIAL: "dedicated-close-broker-credential",
    PONTO_EMERGENCY_CLOSE_CUSTODY_REF: contract.custodyRef,
    PONTO_EMERGENCY_TARGET: "production",
    PONTO_EMERGENCY_TRIGGER_RUN_ID: "101",
    PONTO_FAILED_COORDINATOR_RUN_ID: "99",
    PONTO_EMERGENCY_MAINTENANCE_REPORT: path.join(
      fs.mkdtempSync(path.join(os.tmpdir(), "ponto-maintenance-")),
      "report.json",
    ),
  },
  response: {
    schemaVersion: 1,
    contract,
    operation: "maintenance",
    target: "production",
    coordinatorRunId: "99",
    emergencyRunId: "101",
    latch: {
      schemaVersion: 1,
      module: "timekeeping",
      target: "production",
      latched: true,
      changedAt: "2026-07-30T05:59:00.000Z",
      stopRunId: "99",
      emergencyRunId: "101",
    },
    control: {
      schemaVersion: 2,
      state: "maintenance",
      changedAt: "2026-07-30T06:00:00.000Z",
      emergencyLatchRef: {
        stopRunId: "99",
        emergencyRunId: "101",
        latchChangedAt: "2026-07-30T05:59:00.000Z",
      },
    },
    observations: [{ passed: true }, { passed: true }, { passed: true }],
    passed: true,
    credentialsIncluded: false,
    piiIncluded: false,
  },
});
const testNow = Date.parse("2026-07-30T06:00:10.000Z");
const testNonce = "BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB";

test("maintenance writer requests only broker-owned maintenance under the exact closed latch", async () => {
  const { env, response } = setup();
  const fixture = createEmergencyBrokerFixture({
    target: "production",
    custodyRef: contract.custodyRef,
  });
  let body;
  const result = await writeEmergencyMaintenance({
    env,
    brokerPolicy: fixture.policy,
    now: () => testNow,
    nonceFactory: () => testNonce,
    fetchImpl: async (url, init) => {
      assert.equal(url, env.PONTO_EMERGENCY_CLOSE_BROKER_URL);
      assert.equal(init.method, "POST");
      body = JSON.parse(init.body);
      return new Response(
        JSON.stringify(fixture.signResponse(response, url, init)),
        { status: 200 },
      );
    },
  });
  assert.equal(body.operation, "maintenance");
  assert.equal(body.requestNonce, testNonce);
  assert.equal(result.passed, true);
  assert.equal(result.state, "maintenance");
  assert.equal(result.latched, true);
  assert.equal(result.observations.length, 3);
});

test("maintenance writer rejects a broker response without the exact closed latch", async () => {
  const { env, response } = setup();
  const fixture = createEmergencyBrokerFixture({
    target: "production",
    custodyRef: contract.custodyRef,
  });
  response.latch.latched = false;
  await assert.rejects(
    writeEmergencyMaintenance({
      env,
      brokerPolicy: fixture.policy,
      now: () => testNow,
      nonceFactory: () => testNonce,
      fetchImpl: async (url, init) => new Response(
        JSON.stringify(fixture.signResponse(response, url, init)),
        { status: 200 },
      ),
    }),
    /response is not exact and target-bound/,
  );
});

test("maintenance writer has no Cloudflare token or arbitrary KV mutation path", () => {
  const source = fs.readFileSync(new URL("./ponto-emergency-maintenance-write.mjs", import.meta.url), "utf8");
  assert.doesNotMatch(source, /CLOUDFLARE|storage\/kv|namespaces|method:\s*"DELETE"|state:\s*"active"/);
  assert.match(source, /operation:\s*"maintenance"/);
});
