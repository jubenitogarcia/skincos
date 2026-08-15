import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";

const script = path.resolve(import.meta.dirname, "ponto-wrangler-output.mjs");
const uuid = "11111111-1111-4111-8111-111111111111";

test("accepts a top-level production version upload without a repeated Wrangler environment", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "wrangler-output-"));
  const file = path.join(dir, "output.ndjson");
  fs.writeFileSync(file, [
    JSON.stringify({ type: "wrangler-session", version: 1 }),
    JSON.stringify({ type: "version-upload", version: 1, worker_name: "skincos-timekeeping", version_id: uuid }),
    "",
  ].join("\n"));
  const result = spawnSync(process.execPath, [script, file, "version-upload", "skincos-timekeeping"], {
    encoding: "utf8",
    env: { ...process.env, PONTO_EXPECTED_WRANGLER_ENV: "production" },
  });
  assert.equal(result.status, 0, result.stderr);
});

test("rejects a staging version upload without its Wrangler environment", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "wrangler-output-"));
  const file = path.join(dir, "output.ndjson");
  fs.writeFileSync(file, [
    JSON.stringify({ type: "version-upload", version: 1, worker_name: "skincos-timekeeping-staging", version_id: uuid }),
    "",
  ].join("\n"));
  const result = spawnSync(process.execPath, [script, file, "version-upload", "skincos-timekeeping-staging"], {
    encoding: "utf8",
    env: { ...process.env, PONTO_EXPECTED_WRANGLER_ENV: "staging" },
  });
  assert.notEqual(result.status, 0);
});

test("accepts version deploy output without a repeated Wrangler environment", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "wrangler-output-"));
  const file = path.join(dir, "output.ndjson");
  fs.writeFileSync(file, [
    JSON.stringify({
      type: "version-deploy",
      version: 1,
      worker_name: "skincos-timekeeping-staging",
      deployment_id: "22222222-2222-4222-8222-222222222222",
    }),
    "",
  ].join("\n"));
  const result = spawnSync(process.execPath, [script, file, "version-deploy", "skincos-timekeeping-staging"], {
    encoding: "utf8",
    env: { ...process.env, PONTO_EXPECTED_WRANGLER_ENV: "staging" },
  });
  assert.equal(result.status, 0, result.stderr);
});

test("rejects an explicit version deploy environment mismatch", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "wrangler-output-"));
  const file = path.join(dir, "output.ndjson");
  fs.writeFileSync(file, [
    JSON.stringify({
      type: "version-deploy",
      version: 1,
      worker_name: "skincos-timekeeping-staging",
      deployment_id: "22222222-2222-4222-8222-222222222222",
      environment: "production",
    }),
    "",
  ].join("\n"));
  const result = spawnSync(process.execPath, [script, file, "version-deploy", "skincos-timekeeping-staging"], {
    encoding: "utf8",
    env: { ...process.env, PONTO_EXPECTED_WRANGLER_ENV: "staging" },
  });
  assert.notEqual(result.status, 0);
});

test("rejects a different target or command-failed record", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "wrangler-output-"));
  const file = path.join(dir, "output.ndjson");
  fs.writeFileSync(file, [
    JSON.stringify({ type: "version-upload", worker_name: "other-worker", version_id: uuid }),
    JSON.stringify({ type: "command-failed", code: "TEST" }),
    "",
  ].join("\n"));
  const result = spawnSync(process.execPath, [script, file, "version-upload", "skincos-timekeeping"], { encoding: "utf8" });
  assert.notEqual(result.status, 0);
});
