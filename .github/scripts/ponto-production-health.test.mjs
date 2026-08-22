import assert from "node:assert/strict";
import test from "node:test";
import { evaluateProductionHealth } from "./ponto-production-health.mjs";

const dependency = (state, reason = "", required = true) => ({ state, reason, required });

const health = (overrides = {}) => ({
  ok: false,
  ready: false,
  availability: { state: "maintenance", source: "control" },
  dependencies: {
    d1: dependency("healthy"),
    module_control: dependency("unavailable", "MODULE_MAINTENANCE"),
    gateway_affinity: dependency("healthy"),
  },
  ...overrides,
});

test("accepts a normal maintenance health response", () => {
  const result = evaluateProductionHealth(200, health());
  assert.deepEqual(result, { passed: true, state: "maintenance", ready: false, gatewayAffinityBridge: false });
});

test("accepts the legacy gateway mismatch only while control is in maintenance", () => {
  const result = evaluateProductionHealth(200, health({
    dependencies: {
      d1: dependency("healthy"),
      module_control: dependency("unavailable", "MODULE_MAINTENANCE"),
      gateway_affinity: dependency("unavailable", "RELEASE_AFFINITY_MISMATCH"),
    },
  }));
  assert.deepEqual(result, { passed: true, state: "maintenance", ready: false, gatewayAffinityBridge: true });
});

test("rejects the gateway mismatch when maintenance is not controlled or another dependency is unhealthy", () => {
  const emergency = evaluateProductionHealth(200, health({
    availability: { state: "maintenance", source: "emergency-latch-active" },
    dependencies: {
      d1: dependency("healthy"),
      module_control: dependency("unavailable", "MODULE_MAINTENANCE"),
      gateway_affinity: dependency("unavailable", "RELEASE_AFFINITY_MISMATCH"),
    },
  }));
  assert.equal(emergency.passed, false);

  const dependencyFailure = evaluateProductionHealth(200, health({
    dependencies: {
      d1: dependency("unavailable", "DATABASE_UNAVAILABLE"),
      module_control: dependency("unavailable", "MODULE_MAINTENANCE"),
      gateway_affinity: dependency("unavailable", "RELEASE_AFFINITY_MISMATCH"),
    },
  }));
  assert.equal(dependencyFailure.passed, false);
});

test("rejects an affinity mismatch outside maintenance", () => {
  const result = evaluateProductionHealth(200, health({
    ok: true,
    ready: true,
    availability: { state: "active", source: "control" },
    dependencies: {
      d1: dependency("healthy"),
      module_control: dependency("healthy", ""),
      gateway_affinity: dependency("unavailable", "RELEASE_AFFINITY_MISMATCH"),
    },
  }));
  assert.equal(result.passed, false);
});
