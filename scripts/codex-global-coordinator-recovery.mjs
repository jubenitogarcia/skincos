#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  buildRecoveryFenceRequest,
  verifyCoordinatorResponse,
} from "./codex-global-coordination-client.mjs";

const CONTRACT_ID = "skincos/global-coordination/v1";
const PROTOCOL = "epoch-fence-v1";

function argument(name, fallback = "") {
  const index = process.argv.indexOf(name);
  return index === -1 ? fallback : String(process.argv[index + 1] || "").trim();
}

function required(name) {
  const value = argument(name);
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function endpoint(url, suffix) {
  const result = new URL(String(url || ""));
  if (result.protocol !== "https:") throw new Error("coordinator URL must use HTTPS");
  result.pathname = suffix;
  result.search = "";
  result.hash = "";
  return result;
}

async function probe() {
  const url = endpoint(required("--url"), "/v1/readyz");
  const outputFile = required("--output");
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8_000);
  let result;
  try {
    const response = await fetch(url, { signal: controller.signal, headers: { accept: "application/json" } });
    const raw = await response.text();
    let body = null;
    try { body = raw ? JSON.parse(raw) : null; } catch { /* classification below is deliberately fail-closed */ }
    let state = "ambiguous";
    if (response.status >= 500) state = "server-error";
    else if (response.status >= 200 && response.status < 300) {
      state = body?.ready === true && body?.contractId === CONTRACT_ID && body?.protocol === PROTOCOL ? "healthy" : "malformed";
    }
    result = { schemaVersion: 1, state, httpStatus: response.status, protocol: body?.protocol || null, authorityEpoch: Number.isSafeInteger(body?.authorityEpoch) ? body.authorityEpoch : null };
  } catch (error) {
    result = { schemaVersion: 1, state: error?.name === "AbortError" ? "timeout" : "unavailable", httpStatus: null, protocol: null, authorityEpoch: null };
  } finally {
    clearTimeout(timeout);
  }
  fs.writeFileSync(outputFile, `${JSON.stringify(result, null, 2)}\n`, { mode: 0o600 });
  process.stdout.write(`${JSON.stringify(result)}\n`);
  if (!["unavailable", "timeout", "server-error", "healthy", "malformed", "ambiguous"].includes(result.state)) process.exitCode = 1;
}

async function fence() {
  const signed = buildRecoveryFenceRequest({
    url: required("--url"),
    recoverySecret: process.env.SKINCOS_GLOBAL_COORDINATION_RECOVERY_SECRET,
    recoveryKeyId: argument("--recovery-key-id", "recovery-v1"),
    recoveryId: required("--recovery-id"),
    expectedAuthorityEpoch: Number(required("--expected-authority-epoch")),
    reason: argument("--reason", "coordinator-recovery"),
  });
  const response = await fetch(signed.endpoint, { method: "POST", headers: signed.headers, body: signed.rawBody });
  const raw = await response.text();
  let payload;
  try { payload = JSON.parse(raw); } catch { throw new Error("recovery fence response is not JSON"); }
  if (response.status !== 200 && response.status !== 409) throw new Error(`recovery fence failed with HTTP ${response.status}`);
  const verified = verifyCoordinatorResponse(payload, { secret: process.env.SKINCOS_GLOBAL_COORDINATION_RECOVERY_SECRET, keyId: argument("--recovery-key-id", "recovery-v1") });
  if (verified.passed !== true || verified.valid !== true) throw new Error(`recovery fence denied: ${verified.reason || "unknown"}`);
  const output = {
    schemaVersion: 1,
    protocol: PROTOCOL,
    recoveryId: argument("--recovery-id"),
    httpStatus: response.status,
    idempotent: verified.idempotent === true,
    previousAuthorityEpoch: verified.previousAuthorityEpoch,
    authorityEpoch: verified.authorityEpoch,
    fencedLeaseCount: Array.isArray(verified.fencedLeases) ? verified.fencedLeases.length : 0,
  };
  const outputFile = argument("--output");
  if (outputFile) fs.writeFileSync(outputFile, `${JSON.stringify(output, null, 2)}\n`, { mode: 0o600 });
  process.stdout.write(`${JSON.stringify(output)}\n`);
}

async function main() {
  const command = process.argv[2];
  if (command === "probe") return probe();
  if (command === "fence") return fence();
  throw new Error("command must be probe or fence");
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
