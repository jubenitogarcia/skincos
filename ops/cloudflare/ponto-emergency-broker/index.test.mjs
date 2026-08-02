import assert from "node:assert/strict";
import test from "node:test";
import {
  EMERGENCY_LATCH_KEY,
  MODULE_CONTROL_KEY,
  writeEmergencyControlPlane,
} from "./index.js";

const timestamp = "2026-08-02T13:00:00.000Z";
const latchTimestamp = "2026-08-02T12:59:59.000Z";
const ownership = {
  target: "staging",
  coordinatorRunId: "30747573120",
  emergencyRunId: "30748913619",
};

const storeFixture = (priorControl = null) => {
  const values = new Map(priorControl ? [[MODULE_CONTROL_KEY, priorControl]] : []);
  const writes = [];
  return {
    writes,
    store: {
      async get(key) {
        return values.get(key) ?? null;
      },
      async put(key, value) {
        writes.push(key);
        values.set(key, JSON.parse(value));
      },
    },
  };
};

test("latch-true writes only the exact fail-closed latch key", async () => {
  const { store, writes } = storeFixture();
  const result = await writeEmergencyControlPlane({
    moduleControl: store,
    operation: "latch-true",
    ...ownership,
    changedAt: latchTimestamp,
  });

  assert.deepEqual(writes, [EMERGENCY_LATCH_KEY]);
  assert.equal(result.control, null);
  assert.deepEqual(result.latch, {
    schemaVersion: 1,
    module: "timekeeping",
    target: "staging",
    latched: true,
    changedAt: latchTimestamp,
    changedBy: "skincos-ponto-emergency-broker",
    stopRunId: ownership.coordinatorRunId,
    emergencyRunId: ownership.emergencyRunId,
  });
});

test("maintenance preserves release metadata and adds the exact emergency reference", async () => {
  const priorControl = {
    schemaVersion: 2,
    state: "canary",
    message: "candidate",
    changedAt: "2026-08-02T12:20:00.000Z",
    changedBy: "github-actions[bot]",
    releaseSha: "a".repeat(40),
    versions: { timekeeping: { candidate: "candidate", incumbent: "incumbent" } },
  };
  const { store, writes } = storeFixture(priorControl);
  const result = await writeEmergencyControlPlane({
    moduleControl: store,
    operation: "maintenance",
    ...ownership,
    changedAt: timestamp,
    latchChangedAt: latchTimestamp,
  });

  assert.deepEqual(writes, [MODULE_CONTROL_KEY]);
  assert.equal(result.control.releaseSha, priorControl.releaseSha);
  assert.deepEqual(result.control.versions, priorControl.versions);
  assert.equal(result.control.state, "maintenance");
  assert.equal(result.control.message, "Ponto interrompido por parada de emergência.");
  assert.deepEqual(result.control.emergencyLatchRef, {
    stopRunId: ownership.coordinatorRunId,
    emergencyRunId: ownership.emergencyRunId,
    latchChangedAt: latchTimestamp,
  });
  assert.deepEqual(result.latch, {
    schemaVersion: 1,
    module: "timekeeping",
    target: "staging",
    latched: true,
    changedAt: latchTimestamp,
    changedBy: "skincos-ponto-emergency-broker",
    stopRunId: ownership.coordinatorRunId,
    emergencyRunId: ownership.emergencyRunId,
  });
});

test("maintenance refuses missing regular control and invalid operations", async () => {
  const { store } = storeFixture();
  await assert.rejects(
    writeEmergencyControlPlane({
      moduleControl: store,
      operation: "maintenance",
      ...ownership,
      changedAt: timestamp,
      latchChangedAt: latchTimestamp,
    }),
    /regular module control is unavailable/,
  );
  await assert.rejects(
    writeEmergencyControlPlane({
      moduleControl: store,
      operation: "active",
      ...ownership,
      changedAt: timestamp,
    }),
    /operation is not close-only/,
  );
});
