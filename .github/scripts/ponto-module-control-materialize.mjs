import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { readCloudflareKvJson } from "./ponto-kv-readback.mjs";

const API_BASE = "https://api.cloudflare.com/client/v4";
const HEX32 = /^[0-9a-f]{32}$/i;
const RUN_ID = /^[1-9][0-9]*$/;
const TARGETS = new Set(["staging", "production"]);
const CONTROL_KEY = "module-control:timekeeping";
const LATCH_KEY = "module-control:timekeeping:emergency-latch";
const READBACK_ATTEMPTS = 12;
const READBACK_DELAY_MS = 5_000;
const BROKER_CHANGED_BY = "skincos-ponto-emergency-broker";

const required = (value, label) => {
  const normalized = String(value || "").trim();
  if (!normalized) throw new Error(`${label} is required`);
  return normalized;
};

const validDate = (value) => Number.isFinite(Date.parse(String(value || "")));

export const writeCloudflareKvJson = async ({
  accountId,
  namespaceId,
  key,
  value,
  apiToken,
  fetchImpl = fetch,
}) => {
  const account = required(accountId, "Cloudflare account ID").toLowerCase();
  const namespace = required(namespaceId, "Cloudflare KV namespace ID").toLowerCase();
  const recordKey = required(key, "Cloudflare KV key");
  const token = required(apiToken, "Cloudflare API token");
  if (!HEX32.test(account) || !HEX32.test(namespace)) {
    throw new Error("Cloudflare account or KV namespace ID is malformed");
  }
  if (![CONTROL_KEY, LATCH_KEY].includes(recordKey)) {
    throw new Error("Ponto materialization key is not allowlisted");
  }

  let response;
  try {
    response = await fetchImpl(
      `${API_BASE}/accounts/${encodeURIComponent(account)}/storage/kv/namespaces/${encodeURIComponent(namespace)}/values/${encodeURIComponent(recordKey)}`,
      {
        method: "PUT",
        headers: {
          authorization: `Bearer ${token}`,
          "content-type": "application/json",
        },
        body: JSON.stringify(value),
        signal: AbortSignal.timeout(30_000),
      },
    );
  } catch {
    throw new Error("Cloudflare KV materialization request failed");
  }
  if (!response.ok) {
    throw new Error(`Cloudflare KV materialization failed (HTTP ${response.status})`);
  }
};

const readMaintenance = (file) => {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    throw new Error("broker maintenance evidence is unavailable or invalid JSON");
  }
};

const exactPayloads = ({ maintenance, priorControl, target, coordinatorRunId, emergencyRunId }) => {
  if (
    maintenance?.schemaVersion !== 1
    || maintenance?.target !== target
    || maintenance?.contractId !== "skincos/ponto/emergency-close/v1"
    || maintenance?.coordinatorRunId !== coordinatorRunId
    || maintenance?.emergencyRunId !== emergencyRunId
    || maintenance?.state !== "maintenance"
    || maintenance?.latched !== true
    || maintenance?.passed !== true
    || maintenance?.credentialsIncluded !== false
    || maintenance?.piiIncluded !== false
    || !validDate(maintenance?.controlChangedAt)
    || !validDate(maintenance?.latchChangedAt)
  ) throw new Error("broker maintenance evidence is not exact and target-bound");
  if (!priorControl || typeof priorControl !== "object" || Array.isArray(priorControl) || priorControl.schemaVersion !== 2) {
    throw new Error("regular module control is unavailable");
  }

  return {
    control: {
      ...priorControl,
      schemaVersion: 2,
      state: "maintenance",
      message: "Ponto interrompido por parada de emergência.",
      changedAt: maintenance.controlChangedAt,
      changedBy: BROKER_CHANGED_BY,
      emergencyLatchRef: {
        stopRunId: coordinatorRunId,
        emergencyRunId,
        latchChangedAt: maintenance.latchChangedAt,
      },
    },
    latch: {
      schemaVersion: 1,
      module: "timekeeping",
      target,
      latched: true,
      changedAt: maintenance.latchChangedAt,
      changedBy: BROKER_CHANGED_BY,
      stopRunId: coordinatorRunId,
      emergencyRunId,
    },
  };
};

const isSameOwner = (value, coordinatorRunId, emergencyRunId) =>
  value?.latched === true
  && value?.stopRunId === coordinatorRunId
  && value?.emergencyRunId === emergencyRunId;

const assertLatchOwnership = ({ priorLatch, expectedLatch }) => {
  if (priorLatch?.latched !== true || isSameOwner(priorLatch, expectedLatch.stopRunId, expectedLatch.emergencyRunId)) return;
  if (
    priorLatch?.target !== expectedLatch.target
    || !validDate(priorLatch?.changedAt)
    || Date.parse(priorLatch.changedAt) >= Date.parse(expectedLatch.changedAt)
  ) throw new Error("Ponto module-control latch is owned by a newer emergency close");
};

const assertReadback = ({ control, latch, expectedControl, expectedLatch, target }) => {
  if (
    control?.schemaVersion !== 2
    || control?.state !== "maintenance"
    || control?.changedAt !== expectedControl.changedAt
    || control?.emergencyLatchRef?.stopRunId !== expectedControl.emergencyLatchRef.stopRunId
    || control?.emergencyLatchRef?.emergencyRunId !== expectedControl.emergencyLatchRef.emergencyRunId
    || control?.emergencyLatchRef?.latchChangedAt !== expectedControl.emergencyLatchRef.latchChangedAt
    || latch?.schemaVersion !== 1
    || latch?.module !== "timekeeping"
    || latch?.target !== target
    || latch?.latched !== true
    || latch?.changedAt !== expectedLatch.changedAt
    || latch?.stopRunId !== expectedLatch.stopRunId
    || latch?.emergencyRunId !== expectedLatch.emergencyRunId
  ) throw new Error("materialized Ponto module-control readback differs from the exact broker close");
};

const readOrMissing = async (params, readImpl) => {
  try {
    return await readImpl(params);
  } catch (error) {
    if (error?.code === "cloudflare-kv-readback-http-404") return null;
    throw error;
  }
};

const readMaterializedWithRetry = async ({
  readControl,
  readLatch,
  expectedControl,
  expectedLatch,
  target,
}) => {
  let lastError;
  for (let attempt = 0; attempt < READBACK_ATTEMPTS; attempt += 1) {
    try {
      const [readbackLatch, readbackControl] = await Promise.all([
        readLatch(),
        readControl(),
      ]);
      assertReadback({
        control: readbackControl,
        latch: readbackLatch,
        expectedControl,
        expectedLatch,
        target,
      });
      return { readbackControl, readbackLatch };
    } catch (error) {
      lastError = error;
      if (attempt === READBACK_ATTEMPTS - 1) throw lastError;
      await new Promise((resolve) => setTimeout(resolve, READBACK_DELAY_MS));
    }
  }
  throw lastError;
};

export async function materializeBrokerClose({
  env = process.env,
  fetchImpl = fetch,
  readImpl = readCloudflareKvJson,
  writeImpl = writeCloudflareKvJson,
} = {}) {
  const accountId = required(env.CLOUDFLARE_ACCOUNT_ID, "Cloudflare account ID");
  const namespaceId = required(env.PONTO_MODULE_CONTROL_KV_ID, "Ponto module-control KV ID");
  const apiToken = required(env.CLOUDFLARE_API_TOKEN, "Cloudflare API token");
  const target = required(env.PONTO_MATERIALIZE_TARGET, "Ponto materialization target").toLowerCase();
  const coordinatorRunId = required(env.PONTO_COORDINATOR_RUN_ID, "Ponto coordinator run ID");
  const emergencyRunId = required(env.PONTO_EMERGENCY_RUN_ID, "Ponto emergency run ID");
  const maintenanceFile = required(env.PONTO_MAINTENANCE_FILE, "Ponto maintenance evidence file");
  if (!TARGETS.has(target) || !RUN_ID.test(coordinatorRunId) || !RUN_ID.test(emergencyRunId)) {
    throw new Error("Ponto materialization identity is invalid");
  }
  if (!HEX32.test(namespaceId)) throw new Error("Ponto module-control KV ID is malformed");

  const readParams = (key) => ({ accountId, namespaceId, key, apiToken, fetchImpl });
  const writeParams = (key, value) => ({ accountId, namespaceId, key, value, apiToken, fetchImpl });
  const maintenance = readMaintenance(maintenanceFile);
  const priorControl = await readOrMissing(readParams(CONTROL_KEY), readImpl);
  const priorLatch = await readOrMissing(readParams(LATCH_KEY), readImpl);
  const { control, latch } = exactPayloads({
    maintenance,
    priorControl,
    target,
    coordinatorRunId,
    emergencyRunId,
  });
  assertLatchOwnership({ priorLatch, expectedLatch: latch });

  await writeImpl(writeParams(LATCH_KEY, latch));
  await writeImpl(writeParams(CONTROL_KEY, control));
  const { readbackControl, readbackLatch } = await readMaterializedWithRetry({
    readControl: () => readImpl(readParams(CONTROL_KEY)),
    readLatch: () => readImpl(readParams(LATCH_KEY)),
    expectedControl: control,
    expectedLatch: latch,
    target,
  });

  const report = {
    schemaVersion: 1,
    source: "cloudflare-kv-direct",
    target,
    moduleControl: {
      schemaVersion: readbackControl.schemaVersion,
      state: readbackControl.state,
      changedAt: readbackControl.changedAt,
      emergencyLatchRef: {
        stopRunId: readbackControl.emergencyLatchRef.stopRunId,
        emergencyRunId: readbackControl.emergencyLatchRef.emergencyRunId,
        latchChangedAt: readbackControl.emergencyLatchRef.latchChangedAt,
      },
    },
    emergencyLatch: {
      schemaVersion: readbackLatch.schemaVersion,
      module: readbackLatch.module,
      target: readbackLatch.target,
      latched: readbackLatch.latched,
      changedAt: readbackLatch.changedAt,
      stopRunId: readbackLatch.stopRunId,
      emergencyRunId: readbackLatch.emergencyRunId,
    },
    credentialsIncluded: false,
    piiIncluded: false,
  };
  const reportFile = String(env.PONTO_MATERIALIZE_REPORT || "").trim();
  if (reportFile) {
    fs.mkdirSync(path.dirname(reportFile), { recursive: true });
    fs.writeFileSync(reportFile, `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 });
  }
  return report;
}

const invokedPath = process.argv[1] ? pathToFileURL(path.resolve(process.argv[1])).href : "";
if (invokedPath === import.meta.url) {
  await materializeBrokerClose();
  process.stdout.write("Exact Ponto broker close materialized in module-control KV.\n");
}
