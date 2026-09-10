import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  PONTO_LEGACY_SNAPSHOT_DOMAIN,
  SNAPSHOT_AUTHORIZATION_FIELDS,
  canonicalSnapshotAuthorization,
  captureLegacyPontoSnapshot,
  snapshotPolicySha256,
  validateSnapshotPolicy,
  verifySnapshotAuthorization,
} from "../runtime/ponto-legacy-snapshot-custody.mjs";
import { validateLegacySnapshotReceipt } from "../../.github/scripts/ponto-legacy-snapshot-receipt.mjs";

const root = new URL("../..", import.meta.url);
const read = (relative) => fs.readFileSync(new URL(relative, root), "utf8");
const captureId = "11111111-1111-4111-8111-111111111111";
const sourceSha = "a".repeat(40);
const now = new Date("2026-09-10T12:00:00.000Z");
const canExercisePrivateCapture = process.platform === "linux"
  && typeof process.getuid === "function"
  && typeof process.getgid === "function";

function stableStringify(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(",")}}`;
}

function writeValidLegacyPontoPair(storeFile, auditFile) {
  const payload = {
    v: 1,
    id: "22222222-2222-4222-8222-222222222222",
    type: "PUNCH_CREATED",
    at: "2026-09-10T11:58:00.000Z",
    actor: { kind: "synthetic", id: "operator" },
    data: { synthetic: true },
    prevHash: null,
  };
  const hash = crypto.createHash("sha256").update(`\n${stableStringify(payload)}`).digest("hex");
  fs.writeFileSync(storeFile, JSON.stringify({
    version: 2,
    employees: [{ id: "employee-1", name: "Pilot", loginEmail: "pilot@example.test" }],
    devices: [],
    records: [],
    audit: { lastHash: hash },
  }) + "\n", { mode: 0o600 });
  fs.writeFileSync(auditFile, JSON.stringify({ ...payload, hash, hmac: null }) + "\n", { mode: 0o600 });
}

function fixture() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "ponto-legacy-snapshot-custody-"));
  const sourceOne = path.join(directory, "ponto_store.v2.json");
  const sourceTwo = path.join(directory, "ponto_audit.v1.jsonl");
  const destination = path.join(directory, "private-captures");
  const signing = crypto.generateKeyPairSync("ed25519");
  writeValidLegacyPontoPair(sourceOne, sourceTwo);
  fs.mkdirSync(destination, { mode: 0o700 });
  const policy = {
    schemaVersion: 1,
    domain: PONTO_LEGACY_SNAPSHOT_DOMAIN,
    authorizationKeyId: "ponto-legacy-snapshot-v1",
    authorizationPublicKeyPem: signing.publicKey.export({ type: "spki", format: "pem" }),
    binding: {
      repositoryId: "123",
      repository: "owner/repository",
      workflowPath: ".github/workflows/ponto-legacy-snapshot.yml",
      githubRef: "refs/heads/main",
      workflowJob: "capture-legacy-snapshot",
      target: "staging",
      purpose: "ponto-legacy-snapshot-capture",
    },
    sourceFiles: [
      { id: "ponto-store-v2", path: sourceOne, maxBytes: 64 * 1024 },
      { id: "ponto-audit-v1", path: sourceTwo, maxBytes: 64 * 1024 },
    ],
  };
  return { directory, sourceOne, sourceTwo, destination, signing, policy };
}

function authorization(policy, signing, changes = {}) {
  const value = {
    schemaVersion: 1,
    domain: PONTO_LEGACY_SNAPSHOT_DOMAIN,
    operation: "capture",
    authorizationId: captureId,
    policySha256: snapshotPolicySha256(policy),
    repositoryId: policy.binding.repositoryId,
    repository: policy.binding.repository,
    workflowPath: policy.binding.workflowPath,
    githubRef: policy.binding.githubRef,
    workflowJob: policy.binding.workflowJob,
    sourceSha,
    workflowRunId: "456",
    runAttempt: 1,
    target: "staging",
    purpose: "ponto-legacy-snapshot-capture",
    issuedAt: "2026-09-10T11:59:00.000Z",
    expiresAt: "2026-09-10T12:05:00.000Z",
    singleUse: true,
    ...changes,
  };
  const signature = crypto.sign(
    null,
    Buffer.from(canonicalSnapshotAuthorization(value), "utf8"),
    signing.privateKey,
  ).toString("base64url");
  return {
    ...value,
    signature: {
      algorithm: "Ed25519",
      keyId: policy.authorizationKeyId,
      valueBase64url: signature,
    },
  };
}

test("authorization canonicalization has an explicit fixed claim order", () => {
  const values = Object.fromEntries(SNAPSHOT_AUTHORIZATION_FIELDS.map((field, index) => [
    field,
    String(index),
  ]));
  const canonical = canonicalSnapshotAuthorization(values);
  assert.equal(
    canonical,
    JSON.stringify(Object.fromEntries(SNAPSHOT_AUTHORIZATION_FIELDS.map((field) => [field, values[field]]))),
  );
  assert.equal(canonical.includes("signature"), false);
});

test("strict signed authorization binds the governed staging workflow identity", () => {
  const item = fixture();
  try {
    const signed = authorization(item.policy, item.signing);
    assert.equal(
      verifySnapshotAuthorization(signed, { policy: item.policy, now }).authorizationId,
      captureId,
    );

    const modifiedSource = { ...signed, sourceSha: "b".repeat(40) };
    assert.throws(
      () => verifySnapshotAuthorization(modifiedSource, { policy: item.policy, now }),
      /authorization signature is invalid/,
    );
    const wrongJob = authorization(item.policy, item.signing, { workflowJob: "different-job" });
    assert.throws(
      () => verifySnapshotAuthorization(wrongJob, { policy: item.policy, now }),
      /authorization workflowJob differs/,
    );
    const expired = authorization(item.policy, item.signing, {
      issuedAt: "2026-09-10T11:40:00.000Z",
      expiresAt: "2026-09-10T11:45:00.000Z",
    });
    assert.throws(
      () => verifySnapshotAuthorization(expired, { policy: item.policy, now }),
      /authorization is expired/,
    );
  } finally {
    fs.rmSync(item.directory, { recursive: true, force: true });
  }
});

test("policy is fail-closed unless it contains exactly two distinct fixed source files", () => {
  const item = fixture();
  try {
    const one = structuredClone(item.policy);
    one.sourceFiles.pop();
    assert.throws(() => validateSnapshotPolicy(one), /exactly two source files/);

    const duplicate = structuredClone(item.policy);
    duplicate.sourceFiles[1].id = duplicate.sourceFiles[0].id;
    assert.throws(() => validateSnapshotPolicy(duplicate), /not unique/);

    const traversal = structuredClone(item.policy);
    traversal.sourceFiles[1].path = "/tmp/../untrusted";
    assert.throws(() => validateSnapshotPolicy(traversal), /source path is invalid/);

    const swapped = structuredClone(item.policy);
    [swapped.sourceFiles[0], swapped.sourceFiles[1]] = [swapped.sourceFiles[1], swapped.sourceFiles[0]];
    assert.throws(() => validateSnapshotPolicy(swapped), /fixed legacy Ponto pair/);

    const renamed = structuredClone(item.policy);
    renamed.sourceFiles[0].path = path.join(item.directory, "not-ponto-store.json");
    assert.throws(() => validateSnapshotPolicy(renamed), /fixed legacy Ponto pair/);
  } finally {
    fs.rmSync(item.directory, { recursive: true, force: true });
  }
});

test("captures exactly two files once to a root-private destination and returns no PII", {
  skip: !canExercisePrivateCapture,
}, () => {
  const item = fixture();
  try {
    const signed = authorization(item.policy, item.signing);
    const result = captureLegacyPontoSnapshot({
      policy: item.policy,
      authorization: signed,
      now,
      destinationDirectory: item.destination,
      destinationUid: process.getuid(),
      destinationGid: process.getgid(),
    });
    assert.equal(result.schemaVersion, 1);
    assert.equal(result.passed, true);
    assert.equal(result.captureId, captureId);
    assert.equal(result.authorizationId, captureId);
    assert.equal(result.sourceFileCount, 2);
    assert.deepEqual(
      result.artifacts.map((artifact) => artifact.id),
      ["ponto-store-v2", "ponto-audit-v1"],
    );
    assert.equal(result.credentialsIncluded, false);
    assert.equal(result.piiIncluded, false);
    assert.match(result.snapshotSha256, /^[0-9a-f]{64}$/);
    assert.deepEqual(validateLegacySnapshotReceipt(result), result);
    assert.deepEqual(
      fs.readFileSync(path.join(item.destination, "captures", captureId, "ponto_store.v2.json")),
      fs.readFileSync(item.sourceOne),
    );
    assert.deepEqual(
      fs.readFileSync(path.join(item.destination, "captures", captureId, "ponto_audit.v1.jsonl")),
      fs.readFileSync(item.sourceTwo),
    );
    const receipt = JSON.stringify(result);
    assert.equal(receipt.includes("pilot@example.test"), false);
    assert.equal(receipt.includes(item.sourceOne), false);
    assert.equal(receipt.includes(item.sourceTwo), false);
    assert.throws(
      () => captureLegacyPontoSnapshot({
        policy: item.policy,
        authorization: signed,
        now,
        destinationDirectory: item.destination,
        destinationUid: process.getuid(),
        destinationGid: process.getgid(),
      }),
      /already consumed/,
    );
  } finally {
    fs.rmSync(item.directory, { recursive: true, force: true });
  }
});

test("refuses malformed V2 state and leaves no finalized private capture", {
  skip: !canExercisePrivateCapture,
}, () => {
  const item = fixture();
  try {
    fs.writeFileSync(item.sourceOne, JSON.stringify({ version: 1 }) + "\n", { mode: 0o600 });
    assert.throws(
      () => captureLegacyPontoSnapshot({
        policy: item.policy,
        authorization: authorization(item.policy, item.signing),
        now,
        destinationDirectory: item.destination,
        destinationUid: process.getuid(),
        destinationGid: process.getgid(),
      }),
      /snapshot pair is not coherent/,
    );
    assert.equal(fs.existsSync(path.join(item.destination, "captures", captureId)), false);
  } finally {
    fs.rmSync(item.directory, { recursive: true, force: true });
  }
});

test("refuses a broken audit chain or a tail that diverges from the V2 audit pointer", {
  skip: !canExercisePrivateCapture,
}, () => {
  const malformed = fixture();
  const divergent = fixture();
  try {
    fs.writeFileSync(malformed.sourceTwo, "{not-json}\n", { mode: 0o600 });
    assert.throws(
      () => captureLegacyPontoSnapshot({
        policy: malformed.policy,
        authorization: authorization(malformed.policy, malformed.signing),
        now,
        destinationDirectory: malformed.destination,
        destinationUid: process.getuid(),
        destinationGid: process.getgid(),
      }),
      /snapshot pair is not coherent/,
    );

    const snapshot = JSON.parse(fs.readFileSync(divergent.sourceOne, "utf8"));
    snapshot.audit.lastHash = "f".repeat(64);
    fs.writeFileSync(divergent.sourceOne, JSON.stringify(snapshot) + "\n", { mode: 0o600 });
    assert.throws(
      () => captureLegacyPontoSnapshot({
        policy: divergent.policy,
        authorization: authorization(divergent.policy, divergent.signing),
        now,
        destinationDirectory: divergent.destination,
        destinationUid: process.getuid(),
        destinationGid: process.getgid(),
      }),
      /snapshot pair is not coherent/,
    );
  } finally {
    fs.rmSync(malformed.directory, { recursive: true, force: true });
    fs.rmSync(divergent.directory, { recursive: true, force: true });
  }
});

test("refuses a symlinked source and does not materialize a capture directory", {
  skip: !canExercisePrivateCapture,
}, () => {
  const item = fixture();
  try {
    fs.rmSync(item.sourceTwo);
    fs.symlinkSync(item.sourceOne, item.sourceTwo);
    const signed = authorization(item.policy, item.signing);
    assert.throws(
      () => captureLegacyPontoSnapshot({
        policy: item.policy,
        authorization: signed,
        now,
        destinationDirectory: item.destination,
        destinationUid: process.getuid(),
        destinationGid: process.getgid(),
      }),
      /captured source file/,
    );
    assert.equal(fs.existsSync(path.join(item.destination, "captures", captureId)), false);
  } finally {
    fs.rmSync(item.directory, { recursive: true, force: true });
  }
});

test("fixed helper wrapper and installer expose no generic path or service surface", () => {
  const helper = read("scripts/runtime/ponto-legacy-snapshot-custody.mjs");
  const wrapper = read("scripts/runtime/provision-ponto-legacy-snapshot-custody.sh");
  const installer = read("scripts/runtime/install-ponto-legacy-snapshot-custody.sh");
  assert.match(helper, /policy must bind exactly two source files/);
  assert.match(helper, /O_NOFOLLOW/);
  assert.match(helper, /O_NONBLOCK/);
  assert.match(helper, /authorization was already consumed/);
  assert.match(helper, /ponto-store-v2/);
  assert.match(helper, /ponto_audit\.v1\.jsonl/);
  assert.match(helper, /SNAPSHOT_PAIR_CAPTURE_ATTEMPTS = 3/);
  assert.match(helper, /stableStringify/);
  assert.match(helper, /credentialsIncluded: false/);
  assert.match(helper, /piiIncluded: false/);
  assert.doesNotMatch(wrapper, /--source|--destination|"\$@"/);
  assert.match(wrapper, /bootstrap\|capture/);
  assert.doesNotMatch(installer, /systemctl|cloudflare/i);
  assert.match(installer, /visudo -cf "\$SUDOERS_FILE"/);
  assert.match(installer, /id -nG "\$RUNNER_USER"/);
  assert.match(installer, /SKINCOS_PONTO_LEGACY_SNAPSHOT_CUSTODY/);
  assert.match(installer, /service_changes=false cloud_changes=false/);
});
