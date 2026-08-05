import fs from "node:fs";
import path from "node:path";
import process from "node:process";

const expectedStates = new Set(["disabled", "maintenance", "active", "canary"]);

function arg(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? String(process.argv[index + 1] || "").trim() : "";
}

function fail(message) {
  process.stderr.write(`atendimento health: ${message}\n`);
  process.exitCode = 1;
}

const url = String(process.env.CRM_ATENDIMENTO_HEALTH_URL || arg("--url") || "").trim();
const expectedState = String(process.env.ATENDIMENTO_EXPECTED_STATE || arg("--expected-state") || "").trim().toLowerCase();
const outputPath = String(process.env.ATENDIMENTO_HEALTH_OUTPUT || arg("--output") || "").trim();

if (!url || !expectedStates.has(expectedState)) {
  fail("CRM_ATENDIMENTO_HEALTH_URL and a valid expected state are required");
} else {
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(20_000), headers: { accept: "application/json" } });
    const payload = await response.json();
    const control = payload?.moduleControl || {};
    const expectedReady = expectedState === "active" || expectedState === "canary";
    const expectedStatus = expectedReady ? 200 : 503;
    if (response.status !== expectedStatus) throw new Error(`unexpected HTTP status ${response.status}`);
    if (control.module !== "atendimento") throw new Error("health response is not for Atendimento");
    if (control.state !== expectedState) throw new Error(`module state is ${String(control.state || "missing")}`);
    if (Boolean(control.ready) !== expectedReady) throw new Error("module readiness does not match expected state");
    if (expectedReady && payload.ok !== true) throw new Error("ready health response is not ok");
    if (control.syntheticOnly !== true) throw new Error("runtime is not marked synthetic-only");
    const report = {
      schemaVersion: 1,
      url: new URL(url).origin,
      status: response.status,
      ok: payload.ok === true,
      module: control.module,
      state: control.state,
      ready: control.ready === true,
      syntheticOnly: control.syntheticOnly === true,
      databaseConfigured: payload.databaseConfigured === true,
    };
    if (outputPath) {
      const destination = path.resolve(outputPath);
      fs.mkdirSync(path.dirname(destination), { recursive: true, mode: 0o700 });
      fs.writeFileSync(destination, `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 });
    }
    process.stdout.write(`${JSON.stringify(report)}\n`);
  } catch (error) {
    fail(error?.message || error);
  }
}
