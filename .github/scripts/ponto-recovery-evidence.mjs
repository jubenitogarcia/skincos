import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const SHA = /^[0-9a-f]{40}$/;
const RUN_ID = /^[1-9][0-9]*$/;
const TARGETS = new Set(["staging", "production"]);
const STAGES = new Set(["staging", "pilot", "canary", "production"]);

const readJson = (file) => JSON.parse(fs.readFileSync(file, "utf8"));
const validDate = (value) => Number.isFinite(Date.parse(String(value || "")));
const targetForStage = (stage) => stage === "staging" ? "staging" : "production";

export function normalizeRecoveryEvidence({
  reconciliation,
  maintenance,
  propagation,
  sourceMode,
  coordinatorRunId,
  emergencyRunId,
  releaseSha,
  stage,
  target,
}) {
  if (
    !["ordinary", "watchdog"].includes(sourceMode)
    || !RUN_ID.test(String(coordinatorRunId || ""))
    || !RUN_ID.test(String(emergencyRunId || ""))
    || !SHA.test(String(releaseSha || "").toLowerCase())
    || !STAGES.has(stage)
    || !TARGETS.has(target)
    || targetForStage(stage) !== target
  ) throw new Error("recovery evidence identity is invalid");

  const reconciliationCommon = reconciliation?.schemaVersion === 1
    && reconciliation?.passed === true
    && Array.isArray(reconciliation?.unresolved)
    && reconciliation.unresolved.length === 0
    && reconciliation?.credentialsIncluded === false
    && reconciliation?.piiIncluded === false;
  const reconciliationValid = sourceMode === "ordinary"
    ? reconciliationCommon
      && String(reconciliation.orchestratorRunId || "") === coordinatorRunId
      && String(reconciliation.orchestratorHeadSha || "").toLowerCase() === releaseSha
    : reconciliationCommon
      && reconciliation?.target === target
      && Array.isArray(reconciliation?.children)
      && reconciliation.children.every((run) =>
        run?.status === "completed"
        && ["issued", "consumed", "invalidated", "invalidated-before-cancel"].includes(
          String(run?.capabilityState || run?.capabilityAuthorization || ""),
        ));
  if (!reconciliationValid) {
    throw new Error("child reconciliation evidence is invalid");
  }

  if (
    maintenance?.schemaVersion !== 1
    || maintenance?.target !== target
    || maintenance?.contractId !== "skincos/ponto/emergency-close/v1"
    || maintenance?.coordinatorRunId !== coordinatorRunId
    || maintenance?.emergencyRunId !== emergencyRunId
    || maintenance?.state !== "maintenance"
    || maintenance?.latched !== true
    || !validDate(maintenance?.controlChangedAt)
    || !validDate(maintenance?.latchChangedAt)
    || maintenance?.passed !== true
    || !Array.isArray(maintenance?.observations)
    || maintenance.observations.length < 3
    || maintenance.observations.some((item) => item?.passed !== true)
    || maintenance?.credentialsIncluded !== false
    || maintenance?.piiIncluded !== false
  ) throw new Error("broker maintenance evidence is invalid");

  // An idempotent broker maintenance call can return the timestamp it saw
  // before the live control read. For the control fallback, the externally
  // observed timestamp is the exact value that the rollback attestation must
  // bind to; the latch path still uses the broker latch timestamp.
  const exactPropagationChangedAt = propagation?.matchedSource === "control"
    ? String(propagation.changedAt || "")
    : maintenance.latchChangedAt;
  const exactControlChangedAt = propagation?.matchedSource === "control"
    ? exactPropagationChangedAt
    : maintenance.controlChangedAt;
  if (
    propagation?.schemaVersion !== 1
    || propagation?.module !== "timekeeping"
    || propagation?.environment !== target
    || propagation?.state !== "maintenance"
    || propagation?.changedAt !== exactPropagationChangedAt
    || propagation?.passed !== true
    || propagation?.exactChangedAtObserved !== true
    || propagation?.exactSourceObserved !== true
    || !["control", "emergency-latch-active"].includes(propagation?.matchedSource)
    || propagation?.credentialsIncluded !== false
    || propagation?.piiIncluded !== false
  ) throw new Error("broker fail-close propagation evidence is invalid");

  return {
    childReconciliation: {
      schemaVersion: 1,
      sourceMode,
      orchestratorRunId: coordinatorRunId,
      orchestratorHeadSha: releaseSha,
      target,
      discoveredChildren: sourceMode === "ordinary"
        ? Number(reconciliation.discoveredChildren || 0)
        : reconciliation.children.length,
      unresolved: [],
      passed: true,
      credentialsIncluded: false,
      piiIncluded: false,
    },
    brokerFailClose: {
      schemaVersion: 1,
      sourceMode,
      contractId: maintenance.contractId,
      stage,
      target,
      releaseSha,
      coordinatorRunId,
      emergencyRunId,
      custodyRef: String(maintenance.custodyRef || ""),
      state: "maintenance",
      latched: true,
      controlChangedAt: exactControlChangedAt,
      latchChangedAt: maintenance.latchChangedAt,
      emergencyLatchRef: {
        stopRunId: coordinatorRunId,
        emergencyRunId,
        latchChangedAt: maintenance.latchChangedAt,
      },
      propagation: {
        passed: true,
        matchedSource: propagation.matchedSource,
        changedAt: propagation.changedAt,
        exactChangedAtObserved: true,
        exactSourceObserved: true,
      },
      passed: true,
      credentialsIncluded: false,
      piiIncluded: false,
    },
  };
}

export function attestBrokerFailCloseEvidence({
  evidence,
  moduleControl,
  emergencyLatch,
  coordinatorRunId,
  releaseSha,
  stage,
  target,
}) {
  const passed = evidence?.schemaVersion === 1
    && evidence?.contractId === "skincos/ponto/emergency-close/v1"
    && evidence?.coordinatorRunId === coordinatorRunId
    && RUN_ID.test(String(evidence?.emergencyRunId || ""))
    && evidence?.releaseSha === releaseSha
    && evidence?.stage === stage
    && evidence?.target === target
    && evidence?.state === "maintenance"
    && evidence?.latched === true
    && validDate(evidence?.controlChangedAt)
    && validDate(evidence?.latchChangedAt)
    && evidence?.emergencyLatchRef?.stopRunId === coordinatorRunId
    && evidence?.emergencyLatchRef?.emergencyRunId === evidence?.emergencyRunId
    && evidence?.emergencyLatchRef?.latchChangedAt === evidence?.latchChangedAt
    && evidence?.propagation?.passed === true
    && evidence?.passed === true
    && evidence?.credentialsIncluded === false
    && evidence?.piiIncluded === false
    && moduleControl?.schemaVersion === 2
    && moduleControl?.state === "maintenance"
    && moduleControl?.changedAt === evidence.controlChangedAt
    && moduleControl?.emergencyLatchRef?.stopRunId === coordinatorRunId
    && moduleControl?.emergencyLatchRef?.emergencyRunId === evidence?.emergencyRunId
    && moduleControl?.emergencyLatchRef?.latchChangedAt === evidence?.latchChangedAt
    && emergencyLatch?.schemaVersion === 1
    && emergencyLatch?.module === "timekeeping"
    && emergencyLatch?.target === target
    && emergencyLatch?.latched === true
    && emergencyLatch?.changedAt === evidence.latchChangedAt
    && emergencyLatch?.stopRunId === coordinatorRunId
    && emergencyLatch?.emergencyRunId === evidence.emergencyRunId;
  return {
    passed,
    emergencyRunId: passed ? evidence.emergencyRunId : "",
    state: passed ? "maintenance" : "unresolved",
    controlChangedAt: passed ? evidence.controlChangedAt : "",
    latchChangedAt: passed ? evidence.latchChangedAt : "",
  };
}

const invokedPath = process.argv[1] ? pathToFileURL(path.resolve(process.argv[1])).href : "";
if (invokedPath === import.meta.url) {
  const [reconciliationFile, maintenanceFile, propagationFile, outputRoot] =
    process.argv.slice(2);
  if (!reconciliationFile || !maintenanceFile || !propagationFile || !outputRoot) {
    throw new Error(
      "usage: ponto-recovery-evidence.mjs <reconciliation> <maintenance> <propagation> <output-root>",
    );
  }
  const normalized = normalizeRecoveryEvidence({
    reconciliation: readJson(reconciliationFile),
    maintenance: readJson(maintenanceFile),
    propagation: readJson(propagationFile),
    sourceMode: String(process.env.PONTO_RECOVERY_SOURCE_MODE || ""),
    coordinatorRunId: String(process.env.PONTO_COORDINATOR_RUN_ID || ""),
    emergencyRunId: String(process.env.PONTO_EMERGENCY_RUN_ID || ""),
    releaseSha: String(process.env.RELEASE_SHA || "").toLowerCase(),
    stage: String(process.env.STAGE || ""),
    target: String(process.env.PONTO_RECOVERY_TARGET || ""),
  });
  const directory = path.join(outputRoot, "automatic-rollback");
  fs.mkdirSync(directory, { recursive: true });
  fs.writeFileSync(
    path.join(directory, "ponto-child-reconciliation.json"),
    `${JSON.stringify(normalized.childReconciliation, null, 2)}\n`,
    { mode: 0o600 },
  );
  fs.writeFileSync(
    path.join(directory, "ponto-broker-fail-close.json"),
    `${JSON.stringify(normalized.brokerFailClose, null, 2)}\n`,
    { mode: 0o600 },
  );
  process.stdout.write("Canonical recovery evidence normalized.\n");
}
