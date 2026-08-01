import assert from "node:assert/strict";
import test from "node:test";
import {
  attestBrokerFailCloseEvidence,
  normalizeRecoveryEvidence,
} from "./ponto-recovery-evidence.mjs";

const sha = "a".repeat(40);
const coordinatorRunId = "99";
const emergencyRunId = "101";
const target = "production";
const stage = "canary";
const maintenance = {
  schemaVersion: 1,
  target,
  contractId: "skincos/ponto/emergency-close/v1",
  custodyRef: "custody/production/close-only",
  coordinatorRunId,
  emergencyRunId,
  controlChangedAt: "2026-07-30T00:02:00.000Z",
  latchChangedAt: "2026-07-30T00:01:00.000Z",
  state: "maintenance",
  latched: true,
  observations: [1, 2, 3].map((attempt) => ({ attempt, passed: true })),
  passed: true,
  credentialsIncluded: false,
  piiIncluded: false,
};
const propagation = {
  schemaVersion: 1,
  module: "timekeeping",
  environment: target,
  state: "maintenance",
  changedAt: maintenance.latchChangedAt,
  passed: true,
  exactChangedAtObserved: true,
  exactSourceObserved: true,
  matchedSource: "emergency-latch-active",
  credentialsIncluded: false,
  piiIncluded: false,
};

test("ordinary recovery artifact tree normalizes exact child and broker evidence", () => {
  const normalized = normalizeRecoveryEvidence({
    reconciliation: {
      schemaVersion: 1,
      orchestratorRunId: coordinatorRunId,
      orchestratorHeadSha: sha,
      discoveredChildren: 4,
      unresolved: [],
      passed: true,
      credentialsIncluded: false,
      piiIncluded: false,
    },
    maintenance,
    propagation,
    sourceMode: "ordinary",
    coordinatorRunId,
    emergencyRunId,
    releaseSha: sha,
    stage,
    target,
  });
  assert.equal(normalized.childReconciliation.discoveredChildren, 4);
  assert.equal(normalized.brokerFailClose.controlChangedAt, maintenance.controlChangedAt);
});

test("ordinary recovery binds an idempotent control fallback to the live timestamp", () => {
  const observedControlAt = "2026-07-30T00:03:00.000Z";
  const normalized = normalizeRecoveryEvidence({
    reconciliation: {
      schemaVersion: 1,
      orchestratorRunId: coordinatorRunId,
      orchestratorHeadSha: sha,
      discoveredChildren: 0,
      unresolved: [],
      passed: true,
      credentialsIncluded: false,
      piiIncluded: false,
    },
    maintenance,
    propagation: {
      ...propagation,
      changedAt: observedControlAt,
      lastObserved: {
        state: "maintenance",
        changedAt: observedControlAt,
        source: "control",
      },
      matchedSource: "control",
    },
    sourceMode: "ordinary",
    coordinatorRunId,
    emergencyRunId,
    releaseSha: sha,
    stage,
    target,
  });
  assert.equal(normalized.brokerFailClose.controlChangedAt, observedControlAt);
});

test("watchdog evidence normalizes only capability-authorized terminal children", () => {
  const normalized = normalizeRecoveryEvidence({
    reconciliation: {
      schemaVersion: 1,
      target,
      children: [{
        runId: "7",
        status: "completed",
        capabilityState: "consumed",
      }],
      unresolved: [],
      passed: true,
      credentialsIncluded: false,
      piiIncluded: false,
    },
    maintenance,
    propagation,
    sourceMode: "watchdog",
    coordinatorRunId,
    emergencyRunId,
    releaseSha: sha,
    stage,
    target,
  });
  assert.equal(normalized.childReconciliation.discoveredChildren, 1);
});

test("live module-control and latch must match the exact normalized broker close", () => {
  const normalized = normalizeRecoveryEvidence({
    reconciliation: {
      schemaVersion: 1,
      target,
      children: [],
      unresolved: [],
      passed: true,
      credentialsIncluded: false,
      piiIncluded: false,
    },
    maintenance,
    propagation,
    sourceMode: "watchdog",
    coordinatorRunId,
    emergencyRunId,
    releaseSha: sha,
    stage,
    target,
  });
  const attested = attestBrokerFailCloseEvidence({
    evidence: normalized.brokerFailClose,
    moduleControl: {
      schemaVersion: 2,
      state: "maintenance",
      changedAt: maintenance.controlChangedAt,
      emergencyLatchRef: {
        stopRunId: coordinatorRunId,
        emergencyRunId,
        latchChangedAt: maintenance.latchChangedAt,
      },
    },
    emergencyLatch: {
      schemaVersion: 1,
      module: "timekeeping",
      target,
      latched: true,
      changedAt: maintenance.latchChangedAt,
      stopRunId: coordinatorRunId,
      emergencyRunId,
    },
    coordinatorRunId,
    releaseSha: sha,
    stage,
    target,
  });
  assert.equal(attested.passed, true);
  assert.equal(attestBrokerFailCloseEvidence({
    evidence: normalized.brokerFailClose,
    moduleControl: {
      schemaVersion: 2,
      state: "maintenance",
      changedAt: maintenance.controlChangedAt,
      emergencyLatchRef: {
        stopRunId: coordinatorRunId,
        emergencyRunId,
        latchChangedAt: maintenance.latchChangedAt,
      },
    },
    emergencyLatch: {
      schemaVersion: 1,
      module: "timekeeping",
      target,
      latched: true,
      changedAt: maintenance.latchChangedAt,
      stopRunId: "100",
      emergencyRunId,
    },
    coordinatorRunId,
    releaseSha: sha,
    stage,
    target,
  }).passed, false);
});

test("live reset or a control not bound to the exact emergency latch is rejected", () => {
  const normalized = normalizeRecoveryEvidence({
    reconciliation: {
      schemaVersion: 1,
      target,
      children: [],
      unresolved: [],
      passed: true,
      credentialsIncluded: false,
      piiIncluded: false,
    },
    maintenance,
    propagation,
    sourceMode: "watchdog",
    coordinatorRunId,
    emergencyRunId,
    releaseSha: sha,
    stage,
    target,
  });
  const moduleControl = {
    schemaVersion: 2,
    state: "maintenance",
    changedAt: maintenance.controlChangedAt,
    emergencyLatchRef: {
      stopRunId: coordinatorRunId,
      emergencyRunId,
      latchChangedAt: maintenance.latchChangedAt,
    },
  };
  const exactLatch = {
    schemaVersion: 1,
    module: "timekeeping",
    target,
    latched: true,
    changedAt: maintenance.latchChangedAt,
    stopRunId: coordinatorRunId,
    emergencyRunId,
  };
  assert.equal(attestBrokerFailCloseEvidence({
    evidence: normalized.brokerFailClose,
    moduleControl: {
      ...moduleControl,
      emergencyLatchRef: {
        ...moduleControl.emergencyLatchRef,
        emergencyRunId: "102",
      },
    },
    emergencyLatch: exactLatch,
    coordinatorRunId,
    releaseSha: sha,
    stage,
    target,
  }).passed, false);
  assert.equal(attestBrokerFailCloseEvidence({
    evidence: normalized.brokerFailClose,
    moduleControl,
    emergencyLatch: {
      ...exactLatch,
      latched: false,
      changedAt: "2026-07-30T00:03:00.000Z",
    },
    coordinatorRunId,
    releaseSha: sha,
    stage,
    target,
  }).passed, false);
});
