import fs from "node:fs";
import path from "node:path";
import { performance } from "node:perf_hooks";

const expectationFile = String(process.env.PONTO_MODULE_EXPECTATION_FILE || "");
const reportFile = String(process.env.PONTO_MODULE_PROPAGATION_REPORT || "");
const healthUrl = new URL(String(process.env.PONTO_MODULE_HEALTH_URL || ""));
const timeoutMs = Number(process.env.PONTO_MODULE_PROPAGATION_TIMEOUT_MS || 150_000);
const cadenceMs = Number(process.env.PONTO_MODULE_PROPAGATION_CADENCE_MS || 5_000);
const requiredConsecutive = Number(process.env.PONTO_MODULE_PROPAGATION_CONSECUTIVE || 2);
const allowedOrigins = new Set([
  "https://api.skincos.com.br",
  "https://api-staging.skincos.com.br",
]);

if (!expectationFile || !reportFile) throw new Error("module propagation expectation and report paths are required");
if (!allowedOrigins.has(healthUrl.origin) || healthUrl.pathname !== "/api/ponto/health" || healthUrl.search || healthUrl.hash) {
  throw new Error("module propagation health URL is not an approved Ponto endpoint");
}
if (!Number.isFinite(timeoutMs) || timeoutMs < 65_000 || timeoutMs > 300_000) throw new Error("module propagation timeout must be 65..300 seconds");
if (!Number.isFinite(cadenceMs) || cadenceMs < 1_000 || cadenceMs > 15_000) throw new Error("module propagation cadence must be 1..15 seconds");
if (!Number.isInteger(requiredConsecutive) || requiredConsecutive < 2 || requiredConsecutive > 5) throw new Error("module propagation consecutive sample count must be 2..5");

const expectation = JSON.parse(fs.readFileSync(expectationFile, "utf8"));
if (!["active", "canary", "maintenance", "disabled"].includes(expectation.state)) throw new Error("invalid expected module state");
if (!Number.isFinite(Date.parse(expectation.changedAt))) throw new Error("invalid expected changedAt");
if (["active", "canary"].includes(expectation.state) && !/^[0-9a-f]{40}$/.test(String(expectation.releaseSha || ""))) {
  throw new Error("active/canary propagation requires an exact release SHA");
}

const accessHeaders = {};
if (process.env.CF_ACCESS_CLIENT_ID || process.env.CF_ACCESS_CLIENT_SECRET) {
  if (!process.env.CF_ACCESS_CLIENT_ID || !process.env.CF_ACCESS_CLIENT_SECRET) throw new Error("partial Cloudflare Access credential");
  accessHeaders["CF-Access-Client-Id"] = process.env.CF_ACCESS_CLIENT_ID;
  accessHeaders["CF-Access-Client-Secret"] = process.env.CF_ACCESS_CLIENT_SECRET;
}

const started = performance.now();
let attempts = 0;
let consecutive = 0;
let lastStatus = 0;
let lastObserved = null;
let legacyMaintenanceStateOnly = false;
while (performance.now() - started <= timeoutMs) {
  attempts += 1;
  const probe = new URL(healthUrl);
  probe.searchParams.set("module_propagation_probe", `${Date.now()}-${attempts}`);
  try {
    const response = await fetch(probe, {
      redirect: "manual",
      headers: { accept: "application/json", "cache-control": "no-cache", ...accessHeaders },
    });
    lastStatus = response.status;
    const json = await response.json().catch(() => null);
    const availability = json?.availability || null;
    lastObserved = availability && typeof availability === "object" ? {
      state: String(availability.state || ""),
      changedAt: String(availability.changedAt || ""),
      releaseSha: String(availability.releaseSha || ""),
    } : null;
    const stateOnlyMaintenance = expectation.state === "maintenance"
      && lastObserved?.state === "maintenance"
      && !lastObserved?.changedAt;
    const exact = response.status === 200
      && lastObserved?.state === expectation.state
      && (lastObserved?.changedAt === expectation.changedAt || stateOnlyMaintenance)
      && (!["active", "canary"].includes(expectation.state) || lastObserved.releaseSha === expectation.releaseSha);
    legacyMaintenanceStateOnly = exact && stateOnlyMaintenance;
    consecutive = exact ? consecutive + 1 : 0;
    if (consecutive >= requiredConsecutive) break;
  } catch {
    lastStatus = 0;
    lastObserved = null;
    consecutive = 0;
  }
  await new Promise((resolve) => setTimeout(resolve, cadenceMs));
}

const elapsedMs = Math.round(performance.now() - started);
const passed = consecutive >= requiredConsecutive;
const report = {
  schemaVersion: 1,
  module: "timekeeping",
  environment: healthUrl.hostname.includes("staging") ? "staging" : "production",
  state: expectation.state,
  changedAt: expectation.changedAt,
  releaseSha: ["active", "canary"].includes(expectation.state) ? expectation.releaseSha : "",
  passed,
  attempts,
  consecutiveSamples: consecutive,
  requiredConsecutiveSamples: requiredConsecutive,
  elapsedMs,
  rtoLimitMs: timeoutMs,
  observation: `${healthUrl.origin}${healthUrl.pathname}`,
  lastStatus,
  lastObserved,
  exactChangedAtObserved: lastObserved?.changedAt === expectation.changedAt,
  legacyMaintenanceStateOnly,
  credentialsIncluded: false,
  piiIncluded: false,
};
fs.mkdirSync(path.dirname(reportFile), { recursive: true });
fs.writeFileSync(reportFile, `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 });
if (!passed) throw new Error(`module-control propagation was not externally observed within ${timeoutMs} ms`);
process.stdout.write(`Observed ${expectation.state} at ${expectation.changedAt} after ${elapsedMs} ms.\n`);
