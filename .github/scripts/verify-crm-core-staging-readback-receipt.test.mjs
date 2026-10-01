import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  CRM_CORE_STAGING_READBACK_CUSTODY_CONTRACT,
  CRM_CORE_STAGING_READBACK_RECEIPT_CONTRACT,
  CRM_CORE_STAGING_READBACK_SIGNATURE_CONTRACT,
  DEFAULT_POLICY_FILE,
  assertCrmCoreStagingReadbackCustodyPolicy,
  canonicalCrmCoreStagingReadbackReceiptJson,
  createCrmCoreStagingReadbackSigningInput,
  publicKeyFingerprint,
  readCrmCoreStagingReadbackCustodyPolicy,
  verifyCrmCoreStagingReadbackReceipt,
} from "./verify-crm-core-staging-readback-receipt.mjs";

const signing = crypto.generateKeyPairSync("ed25519");
const publicJwk = signing.publicKey.export({ format: "jwk" });
const keyId = "crm-core-staging-readback-custody-test-v1";
const checkedInKeyId = "crm-core-staging-readback-20260911-r1";
const checkedInPublicJwk = Object.freeze({
  kty: "OKP",
  crv: "Ed25519",
  x: "RRwndzeF_7fyLiIJim4r_KVxv9Rg1eJP8hfUEpPydNA",
});
const sourceSha = "a".repeat(40);
const artifactRunId = "34567890123";
const readbackRunId = "34567890124";
const artifactDigest = `sha256:${"b".repeat(64)}`;
const script = fileURLToPath(new URL("./verify-crm-core-staging-readback-receipt.mjs", import.meta.url));
const expectedChecks = [
  "artifact-identity",
  "health",
  "readiness",
  "public-health",
  "public-readiness",
  "modules-read-only",
  "projection-route-auth-required",
  "internal-route-rejected",
  "inventory-fallback-rejected",
  "unknown-route-rejected",
  "write-surface-blocked",
  "cors-origin-rejected",
  "backfill-ingestion-disabled",
  "session-requires-verified-identity",
];

function activePolicy() {
  return {
    contract: CRM_CORE_STAGING_READBACK_CUSTODY_CONTRACT,
    state: "active",
    source: {
      repository: "jubenitogarcia/skincos-crm-core",
      repositoryId: "1353934107",
      ref: "refs/heads/main",
    },
    receipt: {
      contract: CRM_CORE_STAGING_READBACK_RECEIPT_CONTRACT,
      signatureContract: CRM_CORE_STAGING_READBACK_SIGNATURE_CONTRACT,
      environment: "staging",
      artifactKind: "bundle-tree-v1",
      origin: "https://skincos-crm-core-staging.skincos.workers.dev",
      workflow: ".github/workflows/crm-staging-artifact-readback.yml",
      checks: [...expectedChecks],
    },
    authority: {
      deploymentAuthorized: false,
      productionAuthorized: false,
      domainChangeAuthorized: false,
    },
    keyRing: {
      activeKeyId: keyId,
      acceptedKeyIds: [keyId],
      publicKeys: { [keyId]: publicJwk },
    },
    prohibitions: [
      "receipt-only",
      "private-key-excluded",
      "pinned-public-key-required",
      "sanitized-cross-repository-input-only",
    ],
  };
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function createReceipt() {
  const statement = {
    contract: CRM_CORE_STAGING_READBACK_RECEIPT_CONTRACT,
    receiptId: `crm-core-staging-readback-${sourceSha}-${artifactRunId}-${readbackRunId}`,
    state: "verified",
    environment: "staging",
    source: {
      repository: "jubenitogarcia/skincos-crm-core",
      repositoryId: "1353934107",
      ref: "refs/heads/main",
      sha: sourceSha,
    },
    artifact: { kind: "bundle-tree-v1", runId: artifactRunId, digest: artifactDigest },
    readback: {
      workflow: ".github/workflows/crm-staging-artifact-readback.yml",
      runId: readbackRunId,
      origin: "https://skincos-crm-core-staging.skincos.workers.dev",
      checks: [...expectedChecks],
    },
    authority: { deploymentAuthorized: false, productionAuthorized: false, domainChangeAuthorized: false },
  };
  const statementDigest = `sha256:${crypto.createHash("sha256").update(canonicalCrmCoreStagingReadbackReceiptJson(statement), "utf8").digest("hex")}`;
  const signature = {
    contract: CRM_CORE_STAGING_READBACK_SIGNATURE_CONTRACT,
    algorithm: "Ed25519",
    keyId,
    publicKeyFingerprint: publicKeyFingerprint(publicJwk),
    signedStatementDigest: statementDigest,
  };
  const value = crypto.sign(
    null,
    Buffer.from(canonicalCrmCoreStagingReadbackReceiptJson(createCrmCoreStagingReadbackSigningInput(statement, signature)), "utf8"),
    signing.privateKey,
  ).toString("base64url");
  return { statement, signature: { ...signature, value } };
}

function verificationOptions(policy = activePolicy()) {
  const receipt = createReceipt();
  return {
    receipt,
    options: {
      policy,
      expectedSourceSha: sourceSha,
      expectedArtifactDigest: artifactDigest,
      expectedArtifactRunId: artifactRunId,
      expectedReadbackDigest: receipt.signature.signedStatementDigest,
      expectedReadbackRunId: readbackRunId,
    },
  };
}

test("accepts the exact Core receipt contract only with a pinned public Ed25519 key and every immutable binding", () => {
  const { receipt, options } = verificationOptions();
  const result = verifyCrmCoreStagingReadbackReceipt(receipt, options);
  assert.deepEqual(result, {
    ok: true,
    contract: CRM_CORE_STAGING_READBACK_RECEIPT_CONTRACT,
    receiptId: receipt.statement.receiptId,
    coreReleaseSha: sourceSha,
    coreArtifactDigest: artifactDigest,
    coreArtifactRunId: artifactRunId,
    coreReadbackDigest: receipt.signature.signedStatementDigest,
    coreReadbackRunId: readbackRunId,
    keyId,
  });
});

test("rejects forged identity, digest, run, authority, key, and signature changes before a custody handoff", () => {
  const mutations = [
    (value) => { value.statement.source.sha = "c".repeat(40); },
    (value) => { value.statement.artifact.digest = `sha256:${"d".repeat(64)}`; },
    (value) => { value.statement.artifact.runId = "9"; },
    (value) => { value.statement.readback.runId = "10"; },
    (value) => { value.statement.authority.productionAuthorized = true; },
    (value) => { value.statement.readback.checks.pop(); },
    (value) => { value.statement.email = "person@example.test"; },
    (value) => { value.signature.keyId = "crm-core-staging-readback-custody-other-v1"; },
    (value) => { value.signature.signedStatementDigest = `sha256:${"e".repeat(64)}`; },
    (value) => { value.signature.value = "A".repeat(86); },
  ];
  for (const mutate of mutations) {
    const { receipt, options } = verificationOptions();
    mutate(receipt);
    assert.throws(
      () => verifyCrmCoreStagingReadbackReceipt(receipt, options),
      /CRM_CORE_STAGING_READBACK_CUSTODY_/,
    );
  }
});

test("rejects a receipt signed by a key that is not pinned by the external custody policy", () => {
  const { receipt, options } = verificationOptions();
  const different = crypto.generateKeyPairSync("ed25519").publicKey.export({ format: "jwk" });
  options.policy.keyRing.publicKeys[keyId] = different;
  assert.throws(
    () => verifyCrmCoreStagingReadbackReceipt(receipt, options),
    /CRM_CORE_STAGING_READBACK_CUSTODY_PUBLIC_KEY_FINGERPRINT_MISMATCH/,
  );
});

test("the checked-in policy pins only the reviewed public Core signer", () => {
  const policy = readCrmCoreStagingReadbackCustodyPolicy(DEFAULT_POLICY_FILE);
  assert.equal(policy.state, "active");
  assert.equal(policy.keyRing.activeKeyId, checkedInKeyId);
  assert.deepEqual(policy.keyRing.acceptedKeyIds, [checkedInKeyId]);
  assert.deepEqual(Object.keys(policy.keyRing.publicKeys), [checkedInKeyId]);
  assert.deepEqual(policy.keyRing.publicKeys[checkedInKeyId].jwk, checkedInPublicJwk);
  assert.equal(Object.hasOwn(policy.keyRing.publicKeys[checkedInKeyId].jwk, "d"), false);
});

test("policy parser refuses accidental private material, unreviewed key IDs, and inconsistent key ring state", () => {
  for (const mutate of [
    (value) => { value.keyRing.publicKeys[keyId] = { ...publicJwk, d: "never" }; value.keyRing.acceptedKeyIds = [keyId]; value.keyRing.activeKeyId = keyId; value.state = "active"; },
    (value) => { value.keyRing.activeKeyId = "crm-core-staging-readback-custody-other-v1"; },
    (value) => { value.prohibitions.push("extra"); },
  ]) {
    const policy = clone(activePolicy());
    mutate(policy);
    assert.throws(() => assertCrmCoreStagingReadbackCustodyPolicy(policy), /CRM_CORE_STAGING_READBACK_CUSTODY_/);
  }
});

test("CLI consumes a receipt file and emits only the bounded verification summary", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "crm-core-staging-readback-receipt-"));
  const receiptFile = path.join(directory, "receipt.json");
  const policyFile = path.join(directory, "policy.json");
  try {
    const { receipt, options } = verificationOptions();
    fs.writeFileSync(receiptFile, JSON.stringify(receipt));
    fs.writeFileSync(policyFile, JSON.stringify(options.policy));
    const command = spawnSync(process.execPath, [
      script,
      "verify",
      "--receipt", receiptFile,
      "--policy", policyFile,
      "--expected-source-sha", sourceSha,
      "--expected-artifact-digest", artifactDigest,
      "--expected-artifact-run-id", artifactRunId,
      "--expected-readback-digest", receipt.signature.signedStatementDigest,
      "--expected-readback-run-id", readbackRunId,
    ], { encoding: "utf8" });
    assert.equal(command.status, 0, command.stderr);
    assert.equal(command.stderr, "");
    assert.equal(command.stdout.includes(directory), false);
    assert.equal(JSON.parse(command.stdout).coreArtifactDigest, artifactDigest);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
