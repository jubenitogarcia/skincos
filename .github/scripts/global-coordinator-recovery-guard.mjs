import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const RECOVERY_PROTOCOL = "epoch-fence-v1";
export const RECOVERY_CONFIRMATION = "RECOVER-KNOWN-COORDINATOR-VERSION";
const FULL_SHA = /^[0-9a-f]{40}$/i;
const VERSION_ID = /^[0-9a-f-]{16,128}$/i;

function text(value) {
  return String(value ?? "").trim();
}

function requireText(value, label) {
  const normalized = text(value);
  if (!normalized) throw new Error(`${label} is required`);
  return normalized;
}

export function loadRecoveryRegistry(registryPath = path.resolve(import.meta.dirname, "../../ops/cloudflare/global-coordinator/recovery-incumbents.json")) {
  const registry = JSON.parse(fs.readFileSync(registryPath, "utf8"));
  if (registry.schemaVersion !== 1 || registry.workerName !== "skincos-global-coordinator") {
    throw new Error("global coordinator recovery registry contract is invalid");
  }
  if (!Array.isArray(registry.knownVersions)) throw new Error("global coordinator recovery registry must declare knownVersions");
  return registry;
}

export function classifyRecoveryProbe({ status, body, error } = {}) {
  if (error) {
    const message = text(error).toLowerCase();
    return message.includes("timeout") ? "timeout" : "unavailable";
  }
  if (Number(status) >= 500) return "server-error";
  if (Number(status) >= 200 && Number(status) < 300) {
    if (body?.ready === true && body?.protocol === RECOVERY_PROTOCOL && body?.contractId === "skincos/global-coordination/v1") {
      return "healthy";
    }
    return "malformed";
  }
  return "ambiguous";
}

export function evaluateRecoveryIntent({
  target,
  ref,
  runAttempt,
  versionId,
  activeVersionId,
  planeState,
  confirmation,
  registry,
}) {
  const failures = [];
  if (text(target) !== "production") failures.push("recovery target must be production");
  if (text(ref) !== "refs/heads/main") failures.push("recovery workflow must run from refs/heads/main");
  if (Number(runAttempt) !== 1) failures.push("recovery replay is forbidden after the first workflow attempt");
  if (text(confirmation) !== RECOVERY_CONFIRMATION) failures.push("recovery confirmation is invalid");
  if (!VERSION_ID.test(text(versionId))) failures.push("recovery version id is invalid");
  if (text(versionId) === text(activeVersionId)) failures.push("recovery version is already active");
  if (!["unavailable", "timeout", "server-error"].includes(text(planeState))) {
    failures.push("normal coordination plane is healthy or ambiguous");
  }
  const candidate = (registry?.knownVersions || []).find((entry) => text(entry.versionId) === text(versionId));
  if (!candidate) {
    failures.push("recovery version is not registered");
  } else {
    if (candidate.environment !== "production") failures.push("registered recovery version is not production");
    if (candidate.protocol !== RECOVERY_PROTOCOL) failures.push("registered recovery version does not support epoch fencing");
    if (candidate.recoveryEligible !== true) failures.push("registered recovery version is not marked recovery eligible");
    if (!FULL_SHA.test(text(candidate.sourceSha))) failures.push("registered recovery source SHA is invalid");
  }
  return {
    allowed: failures.length === 0,
    failures,
    candidate: candidate || null,
    target: requireText(target, "target"),
    versionId: requireText(versionId, "versionId"),
    planeState: requireText(planeState, "planeState"),
  };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = new Map();
  for (let index = 2; index < process.argv.length; index += 2) args.set(process.argv[index], process.argv[index + 1]);
  try {
    const result = evaluateRecoveryIntent({
      target: args.get("--target"),
      ref: args.get("--ref"),
      runAttempt: args.get("--run-attempt"),
      versionId: args.get("--version-id"),
      activeVersionId: args.get("--active-version-id"),
      planeState: args.get("--plane-state"),
      confirmation: args.get("--confirmation"),
      registry: loadRecoveryRegistry(args.get("--registry")),
    });
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    if (!result.allowed) {
      for (const failure of result.failures) process.stderr.write(`recovery guard: ${failure}\n`);
      process.exitCode = 1;
    }
  } catch (error) {
    process.stderr.write(`recovery guard: ${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}
