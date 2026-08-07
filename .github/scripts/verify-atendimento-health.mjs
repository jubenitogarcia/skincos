import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const expectedStates = new Set(["disabled", "maintenance", "active", "canary"]);

function arg(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? String(process.argv[index + 1] || "").trim() : "";
}

function string(value) {
  return typeof value === "string" ? value.trim() : "";
}

export async function verifyAtendimentoPublicHealth({
  url,
  expectedState,
  fetchImpl = globalThis.fetch,
} = {}) {
  const targetUrl = string(url);
  const state = string(expectedState).toLowerCase();
  if (!targetUrl || !expectedStates.has(state)) {
    throw new Error("CRM_ATENDIMENTO_HEALTH_URL and a valid expected state are required");
  }
  if (typeof fetchImpl !== "function") throw new Error("A fetch implementation is required");

  const response = await fetchImpl(targetUrl, {
    signal: AbortSignal.timeout(20_000),
    headers: { accept: "application/json" },
  });
  const payload = await response.json();
  const control = payload?.control || {};
  const expectedControlReady = state === "active" || state === "canary";

  // Public health is liveness, not readiness: it deliberately stays 200 when
  // the database is unavailable or the module remains in maintenance. The
  // private loopback readiness endpoint owns dependency validation.
  if (response.status !== 200) throw new Error(`unexpected HTTP status ${response.status}`);
  if (payload?.ok !== true) throw new Error("public health response is not ok");
  if (payload?.service !== "crm-atendimento-runtime") throw new Error("health response is not for the isolated Atendimento runtime");
  if (payload?.readOnlyRuntime !== true) throw new Error("health response is not from a read-only runtime");
  if (control.state !== state) throw new Error(`module state is ${String(control.state || "missing")}`);
  if (Boolean(control.ready) !== expectedControlReady) throw new Error("module control readiness does not match expected state");
  if (control.readOnly !== true) throw new Error("runtime is not marked read-only");
  if (control.syntheticOnly !== true) throw new Error("runtime is not marked synthetic-only");

  return {
    schemaVersion: 1,
    url: new URL(targetUrl).origin,
    status: response.status,
    ok: true,
    service: payload.service,
    readOnlyRuntime: true,
    state: control.state,
    ready: control.ready === true,
    readOnly: control.readOnly === true,
    syntheticOnly: control.syntheticOnly === true,
  };
}

export function writeSanitizedHealthReport(outputPath, report) {
  const destination = path.resolve(outputPath);
  fs.mkdirSync(path.dirname(destination), { recursive: true, mode: 0o700 });
  fs.writeFileSync(destination, `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 });
}

async function run() {
  const url = string(process.env.CRM_ATENDIMENTO_HEALTH_URL || arg("--url"));
  const expectedState = string(process.env.ATENDIMENTO_EXPECTED_STATE || arg("--expected-state")).toLowerCase();
  const outputPath = string(process.env.ATENDIMENTO_HEALTH_OUTPUT || arg("--output"));
  try {
    const report = await verifyAtendimentoPublicHealth({ url, expectedState });
    if (outputPath) writeSanitizedHealthReport(outputPath, report);
    process.stdout.write(`${JSON.stringify(report)}\n`);
  } catch (error) {
    process.stderr.write(`atendimento health: ${error?.message || error}\n`);
    process.exitCode = 1;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await run();
