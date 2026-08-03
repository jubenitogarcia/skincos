import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";

const script = path.resolve(".github/scripts/ponto-json-output.mjs");

const runParser = (raw) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "ponto-json-output-"));
  const input = path.join(directory, "raw.txt");
  const output = path.join(directory, "parsed.json");
  fs.writeFileSync(input, raw, { mode: 0o600 });
  const result = spawnSync(process.execPath, [script, input, output], { encoding: "utf8" });
  return { directory, output, result };
};

test("extracts JSON after Wrangler progress output", () => {
  const { output, result } = runParser('├ Checking...\n[\n  {"success":true,"results":[{"count":0}]}\n]\n');
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(fs.readFileSync(output, "utf8")), [
    { success: true, results: [{ count: 0 }] },
  ]);
});

test("extracts a nested JSON object after ANSI progress output", () => {
  const { output, result } = runParser('\u001b[2K\u001b[1G├ Checking...\n{"result":{"results":[{"employees":0}]}}\n');
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(fs.readFileSync(output, "utf8")), {
    result: { results: [{ employees: 0 }] },
  });
});

test("prefers the last D1 result after a valid JSON progress document", () => {
  const { output, result } = runParser(
    '{"type":"progress","message":"checking"}\n[{"success":true,"results":[{"employees":1}]}]\n',
  );
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(fs.readFileSync(output, "utf8")), [
    { success: true, results: [{ employees: 1 }] },
  ]);
});

test("recognizes a D1 result array inside an envelope", () => {
  const { output, result } = runParser(
    '{"message":"checking"}\n{"result":[{"results":[{"pin_credentials":1}]}]}\n',
  );
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(fs.readFileSync(output, "utf8")), {
    result: [{ results: [{ pin_credentials: 1 }] }],
  });
});

test("fails closed when no JSON document is present", () => {
  const { result } = runParser("├ Checking...\nrequest failed\n");
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /valid JSON document/);
});
