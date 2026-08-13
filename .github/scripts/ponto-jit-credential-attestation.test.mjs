import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  canonicalJitClaims,
  cleanupJitFiles,
  consumeJitCredentials,
} from "./ponto-jit-credential-attestation.mjs";
import { releaseRefFor } from "./ponto-release-identity.mjs";

const signingKeys = crypto.generateKeyPairSync("ed25519");
const runnerKeys = crypto.generateKeyPairSync("rsa", { modulusLength: 2048 });
const runnerPrivatePem = runnerKeys.privateKey.export({ type: "pkcs8", format: "pem" });
const runnerFingerprint = crypto.createHash("sha256")
  .update(runnerKeys.publicKey.export({ type: "spki", format: "der" }))
  .digest("hex");
const sha = "a".repeat(40);
const releaseRef = releaseRefFor("ponto", sha);
const uuid = "11111111-1111-4111-8111-111111111111";
const artifactDigest = "c".repeat(64);

const encryptCredentials = (credentials) => {
  const plaintext = Buffer.from(JSON.stringify(credentials));
  const dataKey = crypto.randomBytes(32);
  const iv = crypto.randomBytes(12);
  try {
    const cipher = crypto.createCipheriv("aes-256-gcm", dataKey, iv);
    const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
    const encryptedKey = crypto.publicEncrypt({
      key: runnerKeys.publicKey,
      oaepHash: "sha256",
      padding: crypto.constants.RSA_PKCS1_OAEP_PADDING,
    }, dataKey);
    return Buffer.from(`${JSON.stringify({
      schemaVersion: 1,
      algorithm: "RSA-OAEP-256+A256GCM",
      encryptedKeyBase64url: encryptedKey.toString("base64url"),
      ivBase64url: iv.toString("base64url"),
      ciphertextBase64url: ciphertext.toString("base64url"),
      tagBase64url: cipher.getAuthTag().toString("base64url"),
    })}\n`);
  } finally {
    plaintext.fill(0);
    dataKey.fill(0);
    iv.fill(0);
  }
};

const fixture = (overrides = {}) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "ponto-jit-test-"));
  const directory = path.join(root, "sealed");
  const runnerTemp = path.join(root, "runner-temp");
  fs.mkdirSync(directory, { mode: 0o700 });
  fs.mkdirSync(runnerTemp, { mode: 0o700 });
  fs.chmodSync(directory, 0o700);
  const credentialBundleFile = path.join(directory, "credentials.json");
  const decryptKeyFile = path.join(directory, "decrypt-key.pem");
  const attestationFile = path.join(directory, "attestation.json");
  const credentials = {
    cfAccessClientId: "",
    cfAccessClientSecret: "",
    pilotLogin: "pilot@example.test",
    pilotPassword: "synthetic-password-123",
  };
  const rawBundle = encryptCredentials(credentials);
  const rawDecryptKey = Buffer.from(runnerPrivatePem);
  fs.writeFileSync(credentialBundleFile, rawBundle, { mode: 0o600 });
  fs.writeFileSync(decryptKeyFile, rawDecryptKey, { mode: 0o600 });
  fs.chmodSync(credentialBundleFile, 0o600);
  fs.chmodSync(decryptKeyFile, 0o600);
  const now = new Date("2026-07-30T12:00:00.000Z");
  const runnerPolicy = {
    runnerId: "987",
    runnerName: "clinic-runner-1",
    runnerIsolationRef: "jit-isolation-v1",
    requiredLabels: ["self-hosted", "Linux", "X64", "ponto-pilot"],
    networkContextCustodyRef: "network-ref-v1",
    encryptionPublicKeySha256: runnerFingerprint,
    jitMode: "ephemeral-pre-job-hook-ed25519-v1",
    jitAttestationKeyId: "clinic-jit-v1",
    jitAttestationPublicKeyPem: signingKeys.publicKey.export({ type: "spki", format: "pem" }),
    jitAttestationFilePath: attestationFile,
    jitCredentialBundleFilePath: credentialBundleFile,
    jitDecryptKeyFilePath: decryptKeyFile,
    jitSupervisorCustodyRef: "supervisor-custody-v1",
    jitCleanupHookCustodyRef: "cleanup-hook-custody-v1",
  };
  const policy = {
    pilotRunner: {
      production: runnerPolicy,
    },
  };
  const env = {
    GITHUB_WORKSPACE: path.resolve("."),
    RUNNER_TEMP: runnerTemp,
    GITHUB_REPOSITORY_ID: "12345",
    GITHUB_REPOSITORY: "owner/repo",
    GITHUB_WORKFLOW_REF: `owner/repo/.github/workflows/ponto-production-slo.yml@${releaseRef}`,
    GITHUB_JOB: "consultor-journey",
    GITHUB_REF: releaseRef,
    GITHUB_SHA: sha,
    GITHUB_RUN_ID: "456",
    GITHUB_RUN_ATTEMPT: "1",
    PONTO_RELEASE_SHA: sha,
    PONTO_RELEASE_STAGE: "pilot",
    PONTO_ORCHESTRATOR_RUN_ID: "789",
    PONTO_ORCHESTRATOR_ISSUER_RUN_ID: "654",
    PONTO_ORCHESTRATOR_NONCE: "f".repeat(32),
    PONTO_EXPECTED_CORE_VERSION_ID: uuid,
    PONTO_EXPECTED_TIMEKEEPING_VERSION_ID: uuid,
    PONTO_EXPECTED_IDENTITY_VERSION_ID: uuid,
    PONTO_EXPECTED_PAGES_DEPLOYMENT_ID: uuid,
    PONTO_SLO_PREFLIGHT_ARTIFACT_ID: "321",
    PONTO_SLO_PREFLIGHT_ARTIFACT_DIGEST: `sha256:${artifactDigest}`,
    RUNNER_NAME: "clinic-runner-1",
    RUNNER_OS: "Linux",
    RUNNER_ARCH: "X64",
  };
  const claims = {
    schemaVersion: 1,
    domain: "skincos/ponto/jit-credential-attestation/v1",
    repositoryId: "12345",
    repository: "owner/repo",
    workflowPath: ".github/workflows/ponto-production-slo.yml",
    workflowRef: env.GITHUB_WORKFLOW_REF,
    workflowJob: "consultor-journey",
    ref: releaseRef,
    environment: "production",
    releaseSha: sha,
    stage: "pilot",
    coordinatorRunId: "789",
    coordinatorIssuerRunId: "654",
    coordinatorDispatchNonce: "f".repeat(32),
    workflowRunId: "456",
    runAttempt: 1,
    coreVersionId: uuid,
    timekeepingVersionId: uuid,
    identityVersionId: uuid,
    pagesDeploymentId: uuid,
    preflightArtifactId: "321",
    preflightArtifactSha256: artifactDigest,
    runnerId: "987",
    runnerName: "clinic-runner-1",
    runnerOs: "Linux",
    runnerArch: "X64",
    runnerIsolationRef: "jit-isolation-v1",
    networkContextCustodyRef: "network-ref-v1",
    runnerEncryptionPublicKeySha256: runnerFingerprint,
    credentialBundleSha256: crypto.createHash("sha256").update(rawBundle).digest("hex"),
    decryptKeySha256: crypto.createHash("sha256").update(rawDecryptKey).digest("hex"),
    supervisorCustodyRef: "supervisor-custody-v1",
    cleanupHookCustodyRef: "cleanup-hook-custody-v1",
    attestationNonce: "d".repeat(32),
    issuedAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + 5 * 60 * 1000).toISOString(),
    singleUse: true,
  };
  Object.assign(claims, overrides.claims || {});
  const signature = crypto
    .sign(null, Buffer.from(canonicalJitClaims(claims)), signingKeys.privateKey)
    .toString("base64url");
  fs.writeFileSync(attestationFile, `${JSON.stringify({
    claims,
    signature: { algorithm: "Ed25519", keyId: "clinic-jit-v1", valueBase64url: signature },
  })}\n`, { mode: 0o600 });
  fs.chmodSync(attestationFile, 0o600);
  return {
    root,
    directory,
    runnerTemp,
    credentialBundleFile,
    decryptKeyFile,
    attestationFile,
    env: { ...env, ...(overrides.env || {}) },
    policy,
    now,
  };
};

test("consumes an exact signed JIT bundle and decrypt-key file, then deletes every hook file", () => {
  const item = fixture();
  try {
    const encrypted = fs.readFileSync(item.credentialBundleFile, "utf8");
    assert.equal(encrypted.includes("synthetic-password-123"), false);
    assert.match(encrypted, /RSA-OAEP-256\+A256GCM/);
    const result = consumeJitCredentials({ ...item, directTestMode: true });
    assert.equal(result.pilotLogin, "pilot@example.test");
    assert.equal(result.runnerEncryptionPrivateKeyPem, runnerPrivatePem);
    assert.match(result.attestationDigest, /^[0-9a-f]{64}$/);
    assert.match(result.credentialBundleDigest, /^[0-9a-f]{64}$/);
    assert.match(result.decryptKeyDigest, /^[0-9a-f]{64}$/);
    assert.match(result.clinicRunnerAttestationDigest, /^[0-9a-f]{64}$/);
    assert.equal(result.filesDeleted, true);
    assert.equal(fs.existsSync(item.credentialBundleFile), false);
    assert.equal(fs.existsSync(item.decryptKeyFile), false);
    assert.equal(fs.existsSync(item.attestationFile), false);
  } finally {
    fs.rmSync(item.root, { recursive: true, force: true });
  }
});

test("rejects global runner secrets and claim swaps while still deleting all JIT files", () => {
  for (const overrides of [
    { env: { PONTO_PILOT_LOGIN: "forbidden@example.test" } },
    { env: { PONTO_IDEMPOTENCY_KEY: "forbidden-root-on-runner" } },
    { claims: { workflowRunId: "999" } },
    { claims: { coordinatorDispatchNonce: "0".repeat(32) } },
    { claims: { workflowRef: `owner/repo/.github/workflows/other.yml@${releaseRef}` } },
    { claims: { preflightArtifactSha256: "e".repeat(64) } },
    { claims: { runnerName: "copied-label-runner" } },
  ]) {
    const item = fixture(overrides);
    try {
      assert.throws(
        () => consumeJitCredentials({ ...item, directTestMode: true }),
        /runner secret environment is forbidden|claims differ/,
      );
      assert.equal(fs.existsSync(item.credentialBundleFile), false);
      assert.equal(fs.existsSync(item.decryptKeyFile), false);
      assert.equal(fs.existsSync(item.attestationFile), false);
    } finally {
      fs.rmSync(item.root, { recursive: true, force: true });
    }
  }
});

test("fails closed on policy nulls and insecure file or directory modes", () => {
  const nullPolicy = fixture();
  try {
    nullPolicy.policy.pilotRunner.production.jitDecryptKeyFilePath = null;
    assert.throws(
      () => consumeJitCredentials({ ...nullPolicy, directTestMode: true }),
      /policy remains fail-closed/,
    );
  } finally {
    fs.rmSync(nullPolicy.root, { recursive: true, force: true });
  }

  const badDirectory = fixture();
  try {
    fs.chmodSync(badDirectory.directory, 0o755);
    assert.throws(
      () => consumeJitCredentials({ ...badDirectory, directTestMode: true }),
      /directory ownership, path, or mode is invalid/,
    );
  } finally {
    fs.rmSync(badDirectory.root, { recursive: true, force: true });
  }

  const badFile = fixture();
  try {
    fs.chmodSync(badFile.decryptKeyFile, 0o644);
    assert.throws(
      () => consumeJitCredentials({ ...badFile, directTestMode: true }),
      /artifact ownership, path, or mode is invalid/,
    );
  } finally {
    fs.rmSync(badFile.root, { recursive: true, force: true });
  }

  const symlinkSwap = fixture();
  try {
    fs.rmSync(symlinkSwap.decryptKeyFile);
    fs.symlinkSync(symlinkSwap.credentialBundleFile, symlinkSwap.decryptKeyFile);
    assert.throws(
      () => consumeJitCredentials({ ...symlinkSwap, directTestMode: true }),
      /artifact ownership, path, or mode is invalid/,
    );
    assert.equal(fs.existsSync(symlinkSwap.credentialBundleFile), false);
    assert.throws(
      () => fs.lstatSync(symlinkSwap.decryptKeyFile),
      (error) => error?.code === "ENOENT",
    );
    assert.equal(fs.existsSync(symlinkSwap.attestationFile), false);
  } finally {
    fs.rmSync(symlinkSwap.root, { recursive: true, force: true });
  }
});

test("idempotent cleanup removes an unconsumed one-shot bundle without reading it", () => {
  const item = fixture();
  try {
    assert.deepEqual(cleanupJitFiles({
      ...item,
      directTestMode: true,
      env: { ...item.env, PONTO_IDEMPOTENCY_KEY: "polluted-host-must-not-block-cleanup" },
    }), { filesDeleted: true });
    assert.deepEqual(cleanupJitFiles({ ...item, directTestMode: true }), { filesDeleted: true });
    assert.equal(fs.existsSync(item.credentialBundleFile), false);
    assert.equal(fs.existsSync(item.decryptKeyFile), false);
    assert.equal(fs.existsSync(item.attestationFile), false);
  } finally {
    fs.rmSync(item.root, { recursive: true, force: true });
  }
});
