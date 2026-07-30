import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";

const script = path.resolve(import.meta.dirname, "ponto-wrangler-output.mjs");
const uuid = "11111111-1111-4111-8111-111111111111";

test("extracts only a structured version upload for the exact Worker", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "wrangler-output-"));
  const file = path.join(dir, "output.ndjson");
  fs.writeFileSync(file, [
    JSON.stringify({ type: "wrangler-session", version: 1 }),
    JSON.stringify({ type: "version-upload", version: 1, worker_name: "skincos-timekeeping", version_id: uuid }),
    "",
  ].join("\n"));
  const result = spawnSync(process.execPath, [script, file, "version-upload", "skincos-timekeeping"], { encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
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
