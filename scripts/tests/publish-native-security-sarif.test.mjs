import assert from "node:assert/strict";
import crypto from "node:crypto";
import test from "node:test";
import { gunzipSync } from "node:zlib";
import { sarifUploadBody, uploadSarif } from "../publish-native-security-sarif.mjs";

function sample() {
  const stdout = JSON.stringify({ version: "2.1.0", runs: [{ tool: { driver: { name: "Semgrep", rules: [] } }, results: [] }] });
  const receipt = { schemaVersion: 1, kind: "skincos-native-weekly-security-audit", mode: "live-main", sourceSha: "a".repeat(40), status: "failed", startedAt: "2026-09-30T03:17:00Z", scans: [{ label: "semgrep", status: "passed", outputDigest: crypto.createHash("sha256").update(stdout).digest("hex") }] };
  return { stdout, receipt };
}

test("SARIF publication preserves failed audit status and binds canonical source and digest", () => {
  const { receipt, stdout } = sample();
  const body = sarifUploadBody(receipt, stdout);
  assert.equal(receipt.status, "failed");
  assert.equal(body.commit_sha, receipt.sourceSha);
  assert.equal(body.ref, "refs/heads/main");
  assert.equal(JSON.parse(gunzipSync(Buffer.from(body.sarif, "base64"))).version, "2.1.0");
  assert.throws(() => sarifUploadBody({ ...receipt, mode: "rehearsal" }, stdout), /canonical/);
  assert.throws(() => sarifUploadBody(receipt, `${stdout} `), /differs/);
});

test("SARIF accepted is pending until processing readback confirms completion", async () => {
  const { receipt, stdout } = sample();
  const responses = [{ status: 202, json: async () => ({ id: "upload-test" }) }, { status: 200, json: async () => ({ processing_status: "pending" }) }, { status: 200, json: async () => ({ processing_status: "complete" }) }];
  const calls = [];
  const result = await uploadSarif({ token: "synthetic-token", body: sarifUploadBody(receipt, stdout), delay: async () => {}, fetchImpl: async (url, options) => { calls.push({ url, options }); return responses.shift(); } });
  assert.equal(result.status, "published");
  assert.equal(calls.length, 3);
  assert.equal(calls[0].options.redirect, "error");
  assert.equal(calls[0].options.headers.Authorization, "Bearer synthetic-token");
});

test("SARIF rejects API failure and bounded processing timeout without printing response bodies", async () => {
  const { receipt, stdout } = sample();
  const body = sarifUploadBody(receipt, stdout);
  await assert.rejects(uploadSarif({ token: "synthetic", body, fetchImpl: async () => ({ status: 403 }) }), /HTTP 403/);
  let first = true;
  await assert.rejects(uploadSarif({ token: "synthetic", body, attempts: 2, delay: async () => {}, fetchImpl: async () => first ? (first = false, { status: 202, json: async () => ({ id: "test" }) }) : ({ status: 200, json: async () => ({ processing_status: "pending" }) }) }), /bounded deadline/);
});
