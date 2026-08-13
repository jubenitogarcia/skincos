import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  cleanupExpiredJitCredentials,
  cleanupJitCredentials,
  materializeJitCredentials,
} from "../runtime/ponto-jit-custody.mjs";
import { consumeJitCredentials } from "../../.github/scripts/ponto-jit-credential-attestation.mjs";

const root = new URL("../..", import.meta.url);
const read = (relativePath) => fs.readFileSync(new URL(relativePath, root), "utf8");
const sha = "a".repeat(40);
const uuid = "11111111-1111-4111-8111-111111111111";

const fixture = () => {
  const signing = crypto.generateKeyPairSync("ed25519");
  const encryption = crypto.generateKeyPairSync("rsa", { modulusLength: 2048 });
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "ponto-jit-custody-"));
  fs.chmodSync(directory, 0o711);
  const publicFingerprint = crypto.createHash("sha256")
    .update(encryption.publicKey.export({ type: "spki", format: "der" }))
    .digest("hex");
  return {
    directory,
    manifest: {
      schemaVersion: 1,
      repository: "owner/repo",
      runner: {
        id: "456",
        name: "ponto-jit-aaaaaaaaaaaaaaaa",
        user: "skincos-ponto-jit",
        labels: ["self-hosted", "Linux", "X64", "ponto-jit-aaaaaaaaaaaaaaaa"],
      },
      policy: {
        runnerIsolationRef: "vault:v1:runner",
        networkContextCustodyRef: "vault:v1:network",
        encryptionPublicKeySha256: publicFingerprint,
        jitAttestationKeyId: "ponto-jit-attestation-v1",
        jitAttestationPublicKeyPem: signing.publicKey.export({ type: "spki", format: "pem" }),
        jitSupervisorCustodyRef: "vault:v1:supervisor",
        jitCleanupHookCustodyRef: "vault:v1:cleanup",
      },
    },
    attestationPrivateKeyPem: signing.privateKey.export({ type: "pkcs8", format: "pem" }),
    encryptionPrivateKeyPem: encryption.privateKey.export({ type: "pkcs8", format: "pem" }),
    input: {
      schemaVersion: 1,
      credentials: {
        pilotLogin: "pilot@example.test",
        pilotPassword: "synthetic-password-123",
        cfAccessClientId: "",
        cfAccessClientSecret: "",
      },
      context: {
        repositoryId: "123",
        releaseSha: sha,
        stage: "pilot",
        coordinatorRunId: "789",
        coordinatorIssuerRunId: "654",
        coordinatorDispatchNonce: "f".repeat(32),
        workflowRunId: "321",
        runAttempt: 1,
        coreVersionId: uuid,
        timekeepingVersionId: uuid,
        identityVersionId: uuid,
        pagesDeploymentId: uuid,
        preflightArtifactId: "987",
        preflightArtifactSha256: "c".repeat(64),
      },
    },
  };
};

test("root custody materializes only an encrypted one-time bundle", () => {
  const item = fixture();
  try {
    const result = materializeJitCredentials({
      ...item,
      credentialDirectory: item.directory,
      credentialDirectoryOwnerUid: process.getuid(),
      targetUid: process.getuid(),
      targetGid: process.getgid(),
      now: new Date("2026-08-12T00:00:00.000Z"),
    });
    const bundle = fs.readFileSync(path.join(item.directory, "credentials.enc"), "utf8");
    assert.equal(bundle.includes(item.input.credentials.pilotPassword), false);
    assert.match(bundle, /RSA-OAEP-256\+A256GCM/);
    assert.match(result.credentialBundleSha256, /^[0-9a-f]{64}$/);
    assert.match(result.attestationSha256, /^[0-9a-f]{64}$/);
    for (const file of ["credentials.enc", "decrypt.key", "attestation.json"]) {
      const metadata = fs.statSync(path.join(item.directory, file));
      assert.equal(metadata.mode & 0o777, 0o600);
      assert.equal(metadata.uid, process.getuid());
    }
    assert.deepEqual(cleanupJitCredentials({
      credentialDirectory: item.directory,
      credentialDirectoryOwnerUid: process.getuid(),
    }), { passed: true, filesDeleted: true, credentialsIncluded: false, piiIncluded: false });
  } finally {
    fs.rmSync(item.directory, { recursive: true, force: true });
  }
});

test("root expiry cleanup removes expired, interrupted, and invalid JIT materialization", () => {
  const item = fixture();
  const options = {
    credentialDirectory: item.directory,
    credentialDirectoryOwnerUid: process.getuid(),
    targetUid: process.getuid(),
    targetGid: process.getgid(),
  };
  const files = ["credentials.enc", "decrypt.key", "attestation.json"];
  try {
    materializeJitCredentials({
      ...item,
      ...options,
      now: new Date("2026-08-12T00:00:00.000Z"),
    });
    assert.deepEqual(cleanupExpiredJitCredentials({
      ...options,
      now: new Date("2026-08-12T00:09:59.999Z"),
    }), { passed: true, filesDeleted: false, reason: "valid", credentialsIncluded: false, piiIncluded: false });
    assert.deepEqual(cleanupExpiredJitCredentials({
      ...options,
      now: new Date("2026-08-12T00:10:00.000Z"),
    }), { passed: true, filesDeleted: true, reason: "expired", credentialsIncluded: false, piiIncluded: false });
    for (const file of files) assert.equal(fs.existsSync(path.join(item.directory, file)), false);

    const temporary = path.join(item.directory, `.credentials.enc.tmp.123.${"a".repeat(24)}`);
    fs.writeFileSync(temporary, "interrupted", { mode: 0o600 });
    assert.deepEqual(cleanupExpiredJitCredentials({
      ...options,
      now: new Date("2026-08-12T00:10:00.000Z"),
    }), { passed: true, filesDeleted: true, reason: "partial", credentialsIncluded: false, piiIncluded: false });
    assert.equal(fs.existsSync(temporary), false);

    materializeJitCredentials({
      ...item,
      ...options,
      now: new Date("2026-08-12T00:00:00.000Z"),
    });
    fs.writeFileSync(path.join(item.directory, "attestation.json"), "not-json", { mode: 0o600 });
    assert.deepEqual(cleanupExpiredJitCredentials({
      ...options,
      now: new Date("2026-08-12T00:01:00.000Z"),
    }), { passed: true, filesDeleted: true, reason: "invalid", credentialsIncluded: false, piiIncluded: false });
    for (const file of files) assert.equal(fs.existsSync(path.join(item.directory, file)), false);
  } finally {
    fs.rmSync(item.directory, { recursive: true, force: true });
  }
});

test("root materialization and the clinic consumer bind the same encrypted claims", () => {
  const item = fixture();
  const runnerTemp = path.join(item.directory, "runner-temp");
  fs.mkdirSync(runnerTemp, { mode: 0o700 });
  fs.chmodSync(item.directory, 0o700);
  fs.chmodSync(runnerTemp, 0o700);
  const now = new Date("2026-08-12T00:00:00.000Z");
  const releaseRef = `refs/tags/skincos/release/ponto/${sha}`;
  const credentialBundleFile = path.join(item.directory, "credentials.enc");
  const decryptKeyFile = path.join(item.directory, "decrypt.key");
  const attestationFile = path.join(item.directory, "attestation.json");
  const policy = {
    pilotRunner: {
      production: {
        runnerId: item.manifest.runner.id,
        runnerName: item.manifest.runner.name,
        runnerIsolationRef: item.manifest.policy.runnerIsolationRef,
        requiredLabels: item.manifest.runner.labels,
        networkContextCustodyRef: item.manifest.policy.networkContextCustodyRef,
        encryptionPublicKeySha256: item.manifest.policy.encryptionPublicKeySha256,
        jitMode: "ephemeral-pre-job-hook-ed25519-v1",
        jitAttestationKeyId: item.manifest.policy.jitAttestationKeyId,
        jitAttestationPublicKeyPem: item.manifest.policy.jitAttestationPublicKeyPem,
        jitAttestationFilePath: attestationFile,
        jitCredentialBundleFilePath: credentialBundleFile,
        jitDecryptKeyFilePath: decryptKeyFile,
        jitSupervisorCustodyRef: item.manifest.policy.jitSupervisorCustodyRef,
        jitCleanupHookCustodyRef: item.manifest.policy.jitCleanupHookCustodyRef,
      },
    },
  };
  const env = {
    GITHUB_WORKSPACE: path.resolve("."),
    RUNNER_TEMP: runnerTemp,
    GITHUB_REPOSITORY_ID: item.input.context.repositoryId,
    GITHUB_REPOSITORY: item.manifest.repository,
    GITHUB_WORKFLOW_REF: `${item.manifest.repository}/.github/workflows/ponto-production-slo.yml@${releaseRef}`,
    GITHUB_JOB: "consultor-journey",
    GITHUB_REF: releaseRef,
    GITHUB_SHA: sha,
    GITHUB_RUN_ID: item.input.context.workflowRunId,
    GITHUB_RUN_ATTEMPT: "1",
    PONTO_RELEASE_SHA: sha,
    PONTO_RELEASE_STAGE: item.input.context.stage,
    PONTO_ORCHESTRATOR_RUN_ID: item.input.context.coordinatorRunId,
    PONTO_ORCHESTRATOR_ISSUER_RUN_ID: item.input.context.coordinatorIssuerRunId,
    PONTO_ORCHESTRATOR_NONCE: item.input.context.coordinatorDispatchNonce,
    PONTO_EXPECTED_CORE_VERSION_ID: uuid,
    PONTO_EXPECTED_TIMEKEEPING_VERSION_ID: uuid,
    PONTO_EXPECTED_IDENTITY_VERSION_ID: uuid,
    PONTO_EXPECTED_PAGES_DEPLOYMENT_ID: uuid,
    PONTO_SLO_PREFLIGHT_ARTIFACT_ID: item.input.context.preflightArtifactId,
    PONTO_SLO_PREFLIGHT_ARTIFACT_DIGEST: `sha256:${item.input.context.preflightArtifactSha256}`,
    RUNNER_NAME: item.manifest.runner.name,
    RUNNER_OS: "Linux",
    RUNNER_ARCH: "X64",
  };
  try {
    materializeJitCredentials({
      ...item,
      credentialDirectory: item.directory,
      credentialDirectoryOwnerUid: process.getuid(),
      credentialDirectoryMode: 0o700,
      targetUid: process.getuid(),
      targetGid: process.getgid(),
      now,
    });
    const result = consumeJitCredentials({ env, policy, now, directTestMode: true });
    assert.equal(result.pilotLogin, item.input.credentials.pilotLogin);
    assert.equal(result.pilotPassword, item.input.credentials.pilotPassword);
    assert.equal(result.filesDeleted, true);
    assert.equal(fs.existsSync(credentialBundleFile), false);
    assert.equal(fs.existsSync(decryptKeyFile), false);
    assert.equal(fs.existsSync(attestationFile), false);
  } finally {
    fs.rmSync(item.directory, { recursive: true, force: true });
  }
});

test("Ponto JIT runner remains isolated from the native custody runner", () => {
  const installer = read("scripts/runtime/install-ponto-jit-runner.sh");
  const service = read("ops/runtime/units/skincos-ponto-jit-runner.service");
  const beforeJob = read("ops/runtime/github-actions-runner/ponto-jit-before-job.sh");
  const afterJob = read("ops/runtime/github-actions-runner/ponto-jit-after-job.sh");
  const sudoers = read("ops/runtime/github-actions-runner/skincos-native-custody.sudoers");
  const helper = read("scripts/runtime/provision-ponto-jit-custody.sh");
  const cleanupService = read("ops/runtime/units/skincos-ponto-jit-credential-cleanup.service");
  const cleanupTimer = read("ops/runtime/units/skincos-ponto-jit-credential-cleanup.timer");

  assert.match(installer, /service but intentionally does not start it/);
  assert.match(installer, /--name "\$RUNNER_NAME" --labels "\$RUNNER_LABEL"/);
  assert.match(installer, /ACTIONS_RUNNER_HOOK_JOB_STARTED/);
  assert.doesNotMatch(installer, /--ephemeral/);
  assert.match(service, /User=skincos-ponto-jit/);
  assert.match(service, /ProtectSystem=strict/);
  assert.match(service, /ReadWritePaths=\/var\/lib\/skincos\/ponto-jit/);
  assert.match(beforeJob, /GITHUB_WORKFLOW_REF/);
  assert.match(beforeJob, /consultor-journey/);
  assert.match(afterJob, /skincos-provision-ponto-jit cleanup/);
  assert.match(helper, /env -i PATH=\/usr\/bin:\/bin HOME=\/root/);
  assert.match(installer, /skincos-ponto-jit-credential-cleanup\.timer/);
  assert.match(cleanupService, /User=root/);
  assert.match(cleanupService, /cleanup-expired/);
  assert.match(cleanupService, /ReadWritePaths=\/var\/lib\/skincos\/ponto-jit/);
  assert.match(cleanupTimer, /OnUnitInactiveSec=1min/);
  assert.match(cleanupTimer, /Persistent=true/);
  assert.match(sudoers, /skincos-actions ALL=\(root\) NOPASSWD: SKINCOS_PONTO_JIT_CUSTODY/);
  assert.match(sudoers, /skincos-ponto-jit ALL=\(root\) NOPASSWD: \/usr\/local\/sbin\/skincos-provision-ponto-jit cleanup/);
  assert.doesNotMatch(sudoers, /skincos-ponto-jit ALL=.*materialize/);
  assert.doesNotMatch(sudoers, /systemctl|bash|sh -c|\/bin\/sudo/);
});
