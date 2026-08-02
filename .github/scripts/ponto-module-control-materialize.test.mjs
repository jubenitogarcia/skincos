import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  materializeBrokerClose,
  writeCloudflareKvJson,
} from "./ponto-module-control-materialize.mjs";

const maintenance = {
  schemaVersion: 1,
  target: "staging",
  contractId: "skincos/ponto/emergency-close/v1",
  coordinatorRunId: "30747573120",
  emergencyRunId: "30750000001",
  controlChangedAt: "2026-08-02T13:10:00.000Z",
  latchChangedAt: "2026-08-02T13:09:59.000Z",
  state: "maintenance",
  latched: true,
  passed: true,
  observations: [{ passed: true }, { passed: true }, { passed: true }],
  credentialsIncluded: false,
  piiIncluded: false,
};

const priorControl = {
  schemaVersion: 2,
  state: "maintenance",
  message: "old state",
  changedAt: "2026-08-02T12:20:00.000Z",
  changedBy: "github-actions[bot]",
  releaseSha: "a".repeat(40),
  versions: { timekeeping: { candidate: "candidate", incumbent: "incumbent" } },
};

const baseEnv = (file) => ({
  CLOUDFLARE_ACCOUNT_ID: "c5dfffe5652dfc8c85b3f29463452ac6",
  PONTO_MODULE_CONTROL_KV_ID: "e69fe06b6abc46eca4f4c00198d078f2",
  CLOUDFLARE_API_TOKEN: "synthetic-token",
  PONTO_MATERIALIZE_TARGET: "staging",
  PONTO_COORDINATOR_RUN_ID: maintenance.coordinatorRunId,
  PONTO_EMERGENCY_RUN_ID: maintenance.emergencyRunId,
  PONTO_MAINTENANCE_FILE: file,
});

const writeMaintenanceFile = () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "ponto-materialize-"));
  const file = path.join(root, "maintenance.json");
  fs.writeFileSync(file, JSON.stringify(maintenance));
  return { root, file };
};

test("materializes only the exact broker close and emits sanitized direct readback", async () => {
  const { root, file } = writeMaintenanceFile();
  const values = new Map([["module-control:timekeeping", priorControl]]);
  const writes = [];
  const readImpl = async ({ key }) => values.get(key) || null;
  const writeImpl = async ({ key, value }) => {
    writes.push(key);
    values.set(key, value);
  };
  const report = await materializeBrokerClose({
    env: { ...baseEnv(file), PONTO_MATERIALIZE_REPORT: path.join(root, "readback.json") },
    readImpl,
    writeImpl,
  });
  assert.deepEqual(writes, [
    "module-control:timekeeping:emergency-latch",
    "module-control:timekeeping",
  ]);
  assert.equal(report.source, "cloudflare-kv-direct");
  assert.equal(report.moduleControl.changedAt, maintenance.controlChangedAt);
  assert.equal(report.emergencyLatch.changedAt, maintenance.latchChangedAt);
  assert.equal(report.credentialsIncluded, false);
  assert.equal(report.piiIncluded, false);
  assert.equal(values.get("module-control:timekeeping").releaseSha, priorControl.releaseSha);
  assert.deepEqual(values.get("module-control:timekeeping").versions, priorControl.versions);
  assert.equal(fs.existsSync(path.join(root, "readback.json")), true);
  assert.equal(JSON.stringify(report).includes("synthetic-token"), false);
});

test("refuses to overwrite a different active emergency owner with a newer timestamp", async () => {
  const { file } = writeMaintenanceFile();
  await assert.rejects(
    materializeBrokerClose({
      env: baseEnv(file),
      readImpl: async ({ key }) => key === "module-control:timekeeping"
        ? priorControl
        : {
          schemaVersion: 1,
          module: "timekeeping",
          target: "staging",
          latched: true,
          changedAt: "2026-08-02T13:11:00.000Z",
          stopRunId: "30747573120",
          emergencyRunId: "30750000000",
        },
      writeImpl: async () => { throw new Error("write should not be reached"); },
    }),
    /owned by a newer emergency close/,
  );
});

test("allows a fresh broker close to supersede an older active latch owner", async () => {
  const { root, file } = writeMaintenanceFile();
  const values = new Map([
    ["module-control:timekeeping", priorControl],
    ["module-control:timekeeping:emergency-latch", {
      schemaVersion: 1,
      module: "timekeeping",
      target: "staging",
      latched: true,
      changedAt: "2026-08-02T13:00:00.000Z",
      stopRunId: "30747573120",
      emergencyRunId: "30750000000",
    }],
  ]);
  const writes = [];
  const report = await materializeBrokerClose({
    env: { ...baseEnv(file), PONTO_MATERIALIZE_REPORT: path.join(root, "readback.json") },
    readImpl: async ({ key }) => values.get(key) || null,
    writeImpl: async ({ key, value }) => {
      writes.push(key);
      values.set(key, value);
    },
  });
  assert.equal(report.emergencyLatch.emergencyRunId, maintenance.emergencyRunId);
  assert.deepEqual(writes, [
    "module-control:timekeeping:emergency-latch",
    "module-control:timekeeping",
  ]);
});

test("rejects broker evidence for a different run or target", async () => {
  const { file } = writeMaintenanceFile();
  const invalid = { ...maintenance, target: "production" };
  fs.writeFileSync(file, JSON.stringify(invalid));
  await assert.rejects(
    materializeBrokerClose({
      env: baseEnv(file),
      readImpl: async () => null,
      writeImpl: async () => {},
    }),
    /not exact and target-bound/,
  );
});

test("refuses to materialize when the regular module control is unavailable", async () => {
  const { file } = writeMaintenanceFile();
  await assert.rejects(
    materializeBrokerClose({
      env: baseEnv(file),
      readImpl: async () => null,
      writeImpl: async () => { throw new Error("write should not be reached"); },
    }),
    /regular module control is unavailable/,
  );
});

test("rejects arbitrary materialization keys in the write helper", async () => {
  const source = fs.readFileSync(new URL("./ponto-module-control-materialize.mjs", import.meta.url), "utf8");
  assert.match(source, /module-control:timekeeping:emergency-latch/);
  assert.match(source, /module-control:timekeeping/);
  assert.doesNotMatch(source, /DELETE/);
});

test("writes the two allowlisted keys through the account-scoped KV API", async () => {
  let call;
  await writeCloudflareKvJson({
    accountId: "c5dfffe5652dfc8c85b3f29463452ac6",
    namespaceId: "e69fe06b6abc46eca4f4c00198d078f2",
    key: "module-control:timekeeping",
    value: { schemaVersion: 2, state: "maintenance" },
    apiToken: "synthetic-token",
    fetchImpl: async (url, init) => {
      call = { url, init };
      return new Response("", { status: 200 });
    },
  });
  assert.match(call.url, /storage\/kv\/namespaces\/e69fe06b6abc46eca4f4c00198d078f2\/values\/module-control%3Atimekeeping$/);
  assert.equal(call.init.method, "PUT");
  assert.equal(call.init.headers.authorization, "Bearer synthetic-token");
  assert.deepEqual(JSON.parse(call.init.body), { schemaVersion: 2, state: "maintenance" });
  await assert.rejects(
    writeCloudflareKvJson({
      accountId: "c5dfffe5652dfc8c85b3f29463452ac6",
      namespaceId: "e69fe06b6abc46eca4f4c00198d078f2",
      key: "module-control:other",
      value: {},
      apiToken: "synthetic-token",
      fetchImpl: async () => new Response("", { status: 200 }),
    }),
    /not allowlisted/,
  );
});
