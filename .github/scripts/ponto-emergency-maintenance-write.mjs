import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import {
  EMERGENCY_BROKER_CONTRACT_ID,
  requestEmergencyClose,
} from "./ponto-emergency-broker.mjs";

const required = (env, name) => {
  const value = String(env[name] || "").trim();
  if (!value) throw new Error(`missing ${name}`);
  return value;
};

export async function writeEmergencyMaintenance({
  env = process.env,
  fetchImpl = fetch,
  brokerPolicy,
  now,
  nonceFactory,
} = {}) {
  const target = required(env, "PONTO_EMERGENCY_TARGET").toLowerCase();
  const triggerRunId = required(env, "PONTO_EMERGENCY_TRIGGER_RUN_ID");
  const coordinatorRunId = required(env, "PONTO_FAILED_COORDINATOR_RUN_ID");
  const reportFile = required(env, "PONTO_EMERGENCY_MAINTENANCE_REPORT");
  const { config, payload } = await requestEmergencyClose({
    operation: "maintenance",
    coordinatorRunId,
    emergencyRunId: triggerRunId,
    env,
    fetchImpl,
    brokerPolicy,
    now,
    nonceFactory,
  });
  const observations = payload.observations.map((item, index) => ({
    attempt: index + 1,
    passed: item.passed === true,
  }));
  const report = {
    schemaVersion: 1,
    target,
    contractId: EMERGENCY_BROKER_CONTRACT_ID,
    custodyRef: config.custodyRef,
    coordinatorRunId,
    emergencyRunId: triggerRunId,
    controlChangedAt: payload.control.changedAt,
    latchChangedAt: payload.latch.changedAt,
    state: "maintenance",
    latched: true,
    observations,
    passed: observations.every((item) => item.passed),
    credentialsIncluded: false,
    piiIncluded: false,
  };
  fs.mkdirSync(path.dirname(reportFile), { recursive: true });
  fs.writeFileSync(reportFile, `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 });
  return report;
}

const invokedPath = process.argv[1] ? pathToFileURL(path.resolve(process.argv[1])).href : "";
if (invokedPath === import.meta.url) {
  await writeEmergencyMaintenance();
  process.stdout.write("Ponto regular control is maintenance under the closed emergency latch.\n");
}
