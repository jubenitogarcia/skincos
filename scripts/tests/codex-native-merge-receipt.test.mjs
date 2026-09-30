import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { assertNativeMergeReceipt, persistNativeMergeReceipt } from "../codex-native-merge-receipt.mjs";

test("private native merge receipt is content addressed and tamper evident", (t) => {
  if (process.platform !== "linux") return t.skip("native receipt custody is Linux only");
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "skincos-receipt-home-"));
  const previous = process.env.HOME;
  process.env.HOME = home;
  t.after(() => {
    if (previous === undefined) delete process.env.HOME;
    else process.env.HOME = previous;
    fs.rmSync(home, { recursive: true, force: true });
  });
  const evidence = {
    schemaVersion: 1, kind: "skincos-native-merge-gate", status: "passed",
    repository: "owner/repo", pullNumber: "12", candidateRoot: "/private/candidate",
    trustedMainSha: "a".repeat(40), baseSha: "a".repeat(40), headSha: "b".repeat(40),
    closureDigest: "c".repeat(64), changedPathsDigest: "d".repeat(64),
    classification: { classification_status: "ok", risk: "low", surfaces: ["documentation"] },
    checks: ["diff-check", "static-parse"],
    commands: [{ label: "diff-check", executable: "git", args: ["diff", "--check"], result: "passed" }],
    validatedAt: "2026-09-30T00:00:00.000Z",
  };
  const reference = persistNativeMergeReceipt(evidence);
  assert.deepEqual(assertNativeMergeReceipt({ ...evidence, ...reference }), reference);
  assert.deepEqual(persistNativeMergeReceipt(evidence), reference);
  assert.equal(fs.statSync(reference.receiptPath).mode & 0o777, 0o400);
  fs.chmodSync(reference.receiptPath, 0o600);
  fs.appendFileSync(reference.receiptPath, "\n");
  fs.chmodSync(reference.receiptPath, 0o400);
  assert.throws(() => assertNativeMergeReceipt({ ...evidence, ...reference }), /digest does not match/);
});
