import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  ABSENCE_AUTHORIZATION_FIELDS,
  PONTO_LEGACY_ABSENCE_DOMAIN,
  absencePolicySha256,
  attestLegacyPontoAbsence,
  canonicalAbsenceAuthorization,
  validateAbsencePolicy,
  verifyAbsenceAuthorization,
} from "../runtime/ponto-legacy-snapshot-custody.mjs";
import { validateLegacyAbsenceReceipt } from "../../.github/scripts/ponto-legacy-absence-receipt.mjs";

const root = new URL("../..", import.meta.url);
const read = (relative) => fs.readFileSync(new URL(relative, root), "utf8");
const attestationId = "11111111-1111-4111-8111-111111111111";
const sourceSha = "a".repeat(40);
const now = new Date("2026-09-10T12:00:00.000Z");
const canExercisePrivateLedger = process.platform === "linux"
  && typeof process.getuid === "function"
  && typeof process.getgid === "function";

const sha256 = (file) => crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");

function fixture() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "ponto-legacy-absence-attestation-"));
  const varDirectory = path.join(directory, "runtime", "var");
  const stateDirectory = path.join(varDirectory, "core");
  // Keep the fixture on the same fixed native-release layout enforced by the
  // root helper. A generic temporary "release" directory must never satisfy
  // the production policy contract.
  const releaseDirectory = path.join(directory, "release", "crm-service");
  const entrypoint = path.join(releaseDirectory, "scripts", "crm", "run-api-linux.sh");
  const artifact = path.join(releaseDirectory, "crm", "api", "server", "pontoRoutes.js");
  const metadata = path.join(releaseDirectory, ".skincos-crm-native-release.json");
  const ledger = path.join(directory, "private-ledger");
  fs.mkdirSync(stateDirectory, { recursive: true, mode: 0o700 });
  fs.mkdirSync(path.dirname(entrypoint), { recursive: true, mode: 0o700 });
  fs.mkdirSync(path.dirname(artifact), { recursive: true, mode: 0o700 });
  fs.writeFileSync(entrypoint, "#!/usr/bin/env bash\nexec node server.js\n", { mode: 0o600 });
  fs.writeFileSync(artifact, "export const legacyPontoWritesEnabled = false;\n", { mode: 0o600 });
  fs.writeFileSync(metadata, JSON.stringify({
    schemaVersion: 1,
    kind: "skincos-crm-native-release",
    target: "production",
    releaseSha: sourceSha,
  }) + "\n", { mode: 0o600 });
  fs.mkdirSync(ledger, { mode: 0o700 });
  const signing = crypto.generateKeyPairSync("ed25519");
  const receiptSigning = crypto.generateKeyPairSync("ed25519");
  const policy = {
    schemaVersion: 1,
    domain: PONTO_LEGACY_ABSENCE_DOMAIN,
    authorizationKeyId: "ponto-legacy-absence-v1",
    authorizationPublicKeyPem: signing.publicKey.export({ type: "spki", format: "pem" }),
    binding: {
      repositoryId: "123",
      repository: "owner/repository",
      workflowPath: ".github/workflows/ponto-legacy-absence-attestation.yml",
      githubRef: "refs/heads/main",
      workflowJob: "attest",
      target: "production",
      purpose: "ponto-legacy-absence-attestation",
    },
    receiptSigning: {
      keyId: "ponto-legacy-absence-receipt-v1",
      publicKeyPem: receiptSigning.publicKey.export({ type: "spki", format: "pem" }),
    },
    legacyStateDirectory: stateDirectory,
    service: {
      unit: "crm.service",
      runtimeMode: "disabled",
      releaseRootPath: releaseDirectory,
      releaseSourceSha: sourceSha,
      releaseMetadataPath: metadata,
      releaseMetadataSha256: sha256(metadata),
      entrypointPath: entrypoint,
      entrypointSha256: sha256(entrypoint),
      releaseArtifactPath: artifact,
      releaseArtifactSha256: sha256(artifact),
    },
  };
  return {
    directory,
    varDirectory,
    stateDirectory,
    releaseDirectory,
    entrypoint,
    artifact,
    metadata,
    ledger,
    signing,
    receiptSigning,
    policy,
  };
}

function authorization(policy, signing, changes = {}) {
  const value = {
    schemaVersion: 1,
    domain: PONTO_LEGACY_ABSENCE_DOMAIN,
    operation: "attest-absence",
    authorizationId: attestationId,
    policySha256: absencePolicySha256(policy),
    repositoryId: policy.binding.repositoryId,
    repository: policy.binding.repository,
    workflowPath: policy.binding.workflowPath,
    githubRef: policy.binding.githubRef,
    workflowJob: policy.binding.workflowJob,
    sourceSha,
    workflowRunId: "456",
    runAttempt: 1,
    target: "production",
    purpose: "ponto-legacy-absence-attestation",
    issuedAt: "2026-09-10T11:59:00.000Z",
    expiresAt: "2026-09-10T12:05:00.000Z",
    singleUse: true,
    ...changes,
  };
  return {
    ...value,
    signature: {
      algorithm: "Ed25519",
      keyId: policy.authorizationKeyId,
      valueBase64url: crypto.sign(
        null,
        Buffer.from(canonicalAbsenceAuthorization(value), "utf8"),
        signing.privateKey,
      ).toString("base64url"),
    },
  };
}

function observedService(policy) {
  return {
    unit: policy.service.unit,
    pid: 1234,
    runtimeMode: "disabled",
    varDir: path.dirname(policy.legacyStateDirectory),
    nativeReleaseRoot: policy.service.releaseRootPath,
    nativeDeploymentTarget: "production",
    workingDirectory: path.join(policy.service.releaseRootPath, "crm", "api"),
    executable: "/usr/bin/node",
    command: ["/usr/bin/node", "server.js"],
    processStartTime: "123456",
    cgroupSha256: "c".repeat(64),
    entrypointSha256: policy.service.entrypointSha256,
    artifactSha256: policy.service.releaseArtifactSha256,
    metadataSha256: policy.service.releaseMetadataSha256,
  };
}

function receiptValidationOptions(item) {
  return {
    expectedReceiptSigningKeyId: item.policy.receiptSigning.keyId,
    expectedReceiptSigningPublicKeyPem: item.policy.receiptSigning.publicKeyPem,
    expectedSourceSha: sourceSha,
    expectedPolicySha256: absencePolicySha256(item.policy),
    expectedWorkflowRunId: "456",
    expectedRunAttempt: 1,
  };
}

test("absence authorization canonicalization has an explicit fixed claim order", () => {
  const values = Object.fromEntries(ABSENCE_AUTHORIZATION_FIELDS.map((field, index) => [
    field,
    String(index),
  ]));
  const canonical = canonicalAbsenceAuthorization(values);
  assert.equal(
    canonical,
    JSON.stringify(Object.fromEntries(ABSENCE_AUTHORIZATION_FIELDS.map((field) => [field, values[field]]))),
  );
  assert.equal(canonical.includes("signature"), false);
});

test("absence policy and signature fail closed on mode, service, workflow, or signed-claim drift", () => {
  const item = fixture();
  try {
    const signed = authorization(item.policy, item.signing);
    assert.equal(verifyAbsenceAuthorization(signed, { policy: item.policy, now }).authorizationId, attestationId);
    assert.throws(
      () => verifyAbsenceAuthorization({ ...signed, sourceSha: "b".repeat(40) }, { policy: item.policy, now }),
      /absence authorization release source differs/,
    );
    const invalidMode = structuredClone(item.policy);
    invalidMode.service.runtimeMode = "read-only";
    assert.throws(() => validateAbsencePolicy(invalidMode), /runtime mode differs/);
    const invalidUnit = structuredClone(item.policy);
    invalidUnit.service.unit = "other.service";
    assert.throws(() => validateAbsencePolicy(invalidUnit), /service unit differs/);
    const invalidDirectory = structuredClone(item.policy);
    invalidDirectory.legacyStateDirectory = path.join(item.directory, "runtime", "other");
    assert.throws(() => validateAbsencePolicy(invalidDirectory), /state directory is invalid/);
  } finally {
    fs.rmSync(item.directory, { recursive: true, force: true });
  }
});

test("attests exactly the fixed absent pair once with mode, PID, and release hashes but no paths or content", {
  skip: !canExercisePrivateLedger,
}, () => {
  const item = fixture();
  try {
    const signed = authorization(item.policy, item.signing);
    const result = attestLegacyPontoAbsence({
      policy: item.policy,
      authorization: signed,
      now,
      ledgerDirectory: item.ledger,
      ledgerUid: process.getuid(),
      ledgerGid: process.getgid(),
      inspectService: observedService,
      receiptSigningPrivateKeyPem: item.receiptSigning.privateKey.export({ type: "pkcs8", format: "pem" }),
    });
    assert.equal(result.passed, true);
    assert.equal(result.attestationId, attestationId);
    assert.equal(result.service.pid, 1234);
    assert.equal(result.service.runtimeMode, "disabled");
    assert.deepEqual(result.absences.map((entry) => entry.id), ["ponto-store-v2", "ponto-audit-v1"]);
    assert.match(result.release.entrypointSha256, /^[0-9a-f]{64}$/);
    assert.match(result.release.artifactSha256, /^[0-9a-f]{64}$/);
    assert.deepEqual(validateLegacyAbsenceReceipt(result, receiptValidationOptions(item)), result);
    const serialized = JSON.stringify(result);
    assert.equal(serialized.includes(item.stateDirectory), false);
    assert.equal(serialized.includes(item.entrypoint), false);
    assert.equal(serialized.includes(item.artifact), false);
    assert.throws(
      () => attestLegacyPontoAbsence({
        policy: item.policy,
        authorization: signed,
        now,
        ledgerDirectory: item.ledger,
        ledgerUid: process.getuid(),
        ledgerGid: process.getgid(),
        inspectService: observedService,
        receiptSigningPrivateKeyPem: item.receiptSigning.privateKey.export({ type: "pkcs8", format: "pem" }),
      }),
      /authorization was already consumed/,
    );
  } finally {
    fs.rmSync(item.directory, { recursive: true, force: true });
  }
});

test("uses lstat ENOENT only for both fixed names and rejects a present file, symlink, or missing state directory", {
  skip: !canExercisePrivateLedger,
}, () => {
  const present = fixture();
  const symlinked = fixture();
  const missingDirectory = fixture();
  try {
    fs.writeFileSync(path.join(present.stateDirectory, "ponto_store.v2.json"), "{}\n", { mode: 0o600 });
    const consumedOnFailure = authorization(present.policy, present.signing);
    assert.throws(
      () => attestLegacyPontoAbsence({
        policy: present.policy,
        authorization: consumedOnFailure,
        now,
        ledgerDirectory: present.ledger,
        ledgerUid: process.getuid(),
        ledgerGid: process.getgid(),
        inspectService: observedService,
        receiptSigningPrivateKeyPem: present.receiptSigning.privateKey.export({ type: "pkcs8", format: "pem" }),
      }),
      /absence source file exists/,
    );
    fs.rmSync(path.join(present.stateDirectory, "ponto_store.v2.json"));
    assert.throws(
      () => attestLegacyPontoAbsence({
        policy: present.policy,
        authorization: consumedOnFailure,
        now,
        ledgerDirectory: present.ledger,
        ledgerUid: process.getuid(),
        ledgerGid: process.getgid(),
        inspectService: observedService,
        receiptSigningPrivateKeyPem: present.receiptSigning.privateKey.export({ type: "pkcs8", format: "pem" }),
      }),
      /authorization was already consumed/,
    );
    fs.symlinkSync(symlinked.entrypoint, path.join(symlinked.stateDirectory, "ponto_audit.v1.jsonl"));
    assert.throws(
      () => attestLegacyPontoAbsence({
        policy: symlinked.policy,
        authorization: authorization(symlinked.policy, symlinked.signing),
        now,
        ledgerDirectory: symlinked.ledger,
        ledgerUid: process.getuid(),
        ledgerGid: process.getgid(),
        inspectService: observedService,
        receiptSigningPrivateKeyPem: symlinked.receiptSigning.privateKey.export({ type: "pkcs8", format: "pem" }),
      }),
      /absence source file exists/,
    );
    fs.rmSync(missingDirectory.stateDirectory, { recursive: true, force: true });
    assert.throws(
      () => attestLegacyPontoAbsence({
        policy: missingDirectory.policy,
        authorization: authorization(missingDirectory.policy, missingDirectory.signing),
        now,
        ledgerDirectory: missingDirectory.ledger,
        ledgerUid: process.getuid(),
        ledgerGid: process.getgid(),
        inspectService: observedService,
        receiptSigningPrivateKeyPem: missingDirectory.receiptSigning.privateKey.export({ type: "pkcs8", format: "pem" }),
      }),
      /absence state directory cannot be inspected/,
    );
  } finally {
    fs.rmSync(present.directory, { recursive: true, force: true });
    fs.rmSync(symlinked.directory, { recursive: true, force: true });
    fs.rmSync(missingDirectory.directory, { recursive: true, force: true });
  }
});

test("fails closed when the observed native process identity changes during the absence decision", {
  skip: !canExercisePrivateLedger,
}, () => {
  const item = fixture();
  let observed = 0;
  try {
    assert.throws(
      () => attestLegacyPontoAbsence({
        policy: item.policy,
        authorization: authorization(item.policy, item.signing),
        now,
        ledgerDirectory: item.ledger,
        ledgerUid: process.getuid(),
        ledgerGid: process.getgid(),
        inspectService: (policy) => ({
          ...observedService(policy),
          processStartTime: String(123456 + observed++),
        }),
        receiptSigningPrivateKeyPem: item.receiptSigning.privateKey.export({ type: "pkcs8", format: "pem" }),
      }),
      /observed service or legacy Ponto state changed during absence attestation/,
    );
  } finally {
    fs.rmSync(item.directory, { recursive: true, force: true });
  }
});

test("separate wrapper, installer, and sudoers expose only the literal absence action to the runner", () => {
  const helper = read("scripts/runtime/ponto-legacy-snapshot-custody.mjs");
  const wrapper = read("scripts/runtime/provision-ponto-legacy-absence-attestation.sh");
  const installer = read("scripts/runtime/install-ponto-legacy-snapshot-custody.sh");
  const sudoers = read("ops/runtime/github-actions-runner/skincos-native-custody.sudoers");
  const runnerUnit = read("ops/runtime/units/skincos-native-custody-runner.service");
  const runnerReadme = read("ops/runtime/github-actions-runner/README.md");
  assert.match(helper, /fs\.lstatSync\(file\)/);
  assert.match(helper, /PONTO_LEGACY_RUNTIME_MODE=/);
  assert.match(helper, /processStartTime/);
  assert.match(helper, /cgroupSha256/);
  assert.match(helper, /receiptSignature/);
  assert.match(helper, /attest-absence/);
  assert.match(helper, /PONTO_LEGACY_ABSENCE_LEDGER_DIR/);
  assert.doesNotMatch(wrapper, /--source|--destination|--service|--mode|"\$@"/);
  assert.match(wrapper, /bootstrap-absence\|attest-absence/);
  assert.match(wrapper, /^#!\/bin\/bash/m);
  assert.match(wrapper, /\/usr\/bin\/timeout --signal=KILL 120s/);
  assert.match(installer, /SKINCOS_PONTO_LEGACY_ABSENCE_ATTESTATION/);
  assert.match(installer, /assert_root_owned_immutable_source_tree/);
  assert.match(sudoers, /skincos-attest-ponto-legacy-absence attest-absence/);
  assert.doesNotMatch(sudoers, /skincos-attest-ponto-legacy-absence bootstrap-absence/);
  assert.match(runnerUnit, /^ProtectSystem=strict$/m);
  assert.match(runnerUnit, /^ReadWritePaths=\/etc\/skincos\/ponto-legacy-absence-attestation$/m);
  assert.match(runnerUnit, /^ReadWritePaths=\/var\/lib\/skincos\/ponto-legacy-absence-attestation$/m);
  assert.match(runnerReadme, /systemctl daemon-reload/);
  assert.match(runnerReadme, /skincos-native-custody-runner\.service/);
  assert.match(runnerReadme, /does not\s+restart `crm\.service`/);
});
