import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const DIGEST = /^[0-9a-f]{64}$/;

function receiptRoot() {
  return path.join(os.homedir(), ".local", "state", "skincos", "native-merge-receipts");
}

function receiptPayload(evidence) {
  return {
    schemaVersion: evidence.schemaVersion,
    kind: evidence.kind,
    status: evidence.status,
    repository: evidence.repository,
    pullNumber: evidence.pullNumber,
    candidateRoot: evidence.candidateRoot,
    trustedMainSha: evidence.trustedMainSha,
    baseSha: evidence.baseSha,
    headSha: evidence.headSha,
    closureDigest: evidence.closureDigest,
    changedPathsDigest: evidence.changedPathsDigest,
    classification: {
      classification_status: evidence.classification?.classification_status,
      risk: evidence.classification?.risk,
      surfaces: evidence.classification?.surfaces,
    },
    checks: evidence.checks,
    commands: evidence.commands,
    validatedAt: evidence.validatedAt,
  };
}

export function persistNativeMergeReceipt(evidence) {
  const root = receiptRoot();
  fs.mkdirSync(root, { recursive: true, mode: 0o700 });
  fs.chmodSync(root, 0o700);
  const body = `${JSON.stringify(receiptPayload(evidence), null, 2)}\n`;
  const digest = crypto.createHash("sha256").update(body).digest("hex");
  const receiptPath = path.join(root, `${digest}.json`);
  let descriptor;
  try {
    descriptor = fs.openSync(receiptPath, "wx", 0o400);
    fs.writeFileSync(descriptor, body);
    fs.fsyncSync(descriptor);
  } catch (error) {
    if (error?.code !== "EEXIST") throw error;
  } finally {
    if (descriptor !== undefined) fs.closeSync(descriptor);
  }
  const reference = { receiptPath, receiptDigest: digest };
  assertNativeMergeReceipt({ ...evidence, ...reference });
  return reference;
}

export function assertNativeMergeReceipt(evidence) {
  const root = receiptRoot();
  const digest = String(evidence?.receiptDigest || "");
  if (!DIGEST.test(digest) || evidence?.receiptPath !== path.join(root, `${digest}.json`)) {
    throw new Error("native merge receipt reference is invalid");
  }
  const stats = fs.lstatSync(evidence.receiptPath);
  if (!stats.isFile() || stats.isSymbolicLink() || stats.uid !== process.getuid() || (stats.mode & 0o777) !== 0o400) {
    throw new Error("native merge receipt custody is invalid");
  }
  const actual = crypto.createHash("sha256").update(fs.readFileSync(evidence.receiptPath)).digest("hex");
  if (actual !== digest) throw new Error("native merge receipt digest does not match private record");
  const stored = JSON.parse(fs.readFileSync(evidence.receiptPath, "utf8"));
  if (JSON.stringify(stored) !== JSON.stringify(receiptPayload(evidence))) {
    throw new Error("native merge receipt does not match in-process evidence");
  }
  return { receiptPath: evidence.receiptPath, receiptDigest: digest };
}
