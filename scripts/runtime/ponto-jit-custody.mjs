#!/usr/bin/env node
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { canonicalJitClaims, JIT_CLAIM_FIELDS } from "./ponto-jit-claims.mjs";

export const PONTO_JIT_RUNTIME_DIR = "/etc/skincos/ponto-jit";
export const PONTO_JIT_CREDENTIAL_DIR = "/var/lib/skincos/ponto-jit";
export const PONTO_JIT_RUNNER_USER = "skincos-ponto-jit";
export const PONTO_JIT_MANIFEST_FILE = `${PONTO_JIT_RUNTIME_DIR}/manifest.json`;
export const PONTO_JIT_ATTESTATION_KEY_FILE = `${PONTO_JIT_RUNTIME_DIR}/attestation-private.pem`;
export const PONTO_JIT_DECRYPT_KEY_FILE = `${PONTO_JIT_RUNTIME_DIR}/encryption-private.pem`;

const FILE_NAMES = {
  credentialBundle: "credentials.enc",
  decryptKey: "decrypt.key",
  attestation: "attestation.json",
};
const CREDENTIAL_TEMPORARY_FILE = /^\.(?:credentials\.enc|decrypt\.key|attestation\.json)\.tmp\.[1-9][0-9]*\.[0-9a-f]{24}$/;
const FULL_SHA = /^[0-9a-f]{40}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const POSITIVE_ID = /^[1-9][0-9]{0,19}$/;
const HEX_32 = /^[0-9a-f]{64}$/;
const SAFE_REF = /^[A-Za-z0-9][A-Za-z0-9._:/@-]{0,255}$/;

const fail = (message) => {
  throw new Error(`Ponto JIT custody: ${message}`);
};

const digest = (value) => crypto.createHash("sha256").update(value).digest("hex");

const exactly = (value, keys, label) => {
  if (!value || typeof value !== "object" || Array.isArray(value)) fail(`${label} is invalid`);
  if (JSON.stringify(Object.keys(value).sort()) !== JSON.stringify([...keys].sort())) {
    fail(`${label} fields differ`);
  }
  return value;
};

const text = (value, label, pattern = null, { min = 1, max = 4096 } = {}) => {
  if (typeof value !== "string" || value.length < min || value.length > max || value.includes("\r") || value.includes("\n")) {
    fail(`${label} is invalid`);
  }
  if (pattern && !pattern.test(value)) fail(`${label} is invalid`);
  return value;
};

const normalizedDigest = (value, label) => {
  const normalized = String(value || "").toLowerCase().replace(/^sha256:/, "");
  if (!HEX_32.test(normalized)) fail(`${label} is invalid`);
  return normalized;
};

const keyFingerprint = (key) => digest(
  crypto.createPublicKey(key).export({ type: "spki", format: "der" }),
);

function userIdentity(name) {
  const row = fs.readFileSync("/etc/passwd", "utf8")
    .split("\n")
    .map((line) => line.split(":"))
    .find((fields) => fields[0] === name);
  if (!row || !/^[1-9][0-9]*$/.test(row[2]) || !/^[1-9][0-9]*$/.test(row[3])) {
    fail("target runner account is unavailable");
  }
  return { uid: Number(row[2]), gid: Number(row[3]) };
}

function assertRoot() {
  if (typeof process.getuid !== "function" || process.getuid() !== 0) {
    fail("command requires root");
  }
}

function assertOwnedRegularFile(file, { uid = 0, mode = 0o600 } = {}) {
  const metadata = fs.lstatSync(file);
  const real = fs.realpathSync(file);
  if (
    !metadata.isFile()
    || metadata.isSymbolicLink()
    || real !== path.resolve(file)
    || metadata.uid !== uid
    || (metadata.mode & 0o777) !== mode
  ) fail("private runtime file metadata is invalid");
}

function readOwnedPrivateFile(file) {
  assertOwnedRegularFile(file);
  const descriptor = fs.openSync(file, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0));
  try {
    const before = fs.lstatSync(file);
    const opened = fs.fstatSync(descriptor);
    if (before.dev !== opened.dev || before.ino !== opened.ino || opened.uid !== 0 || (opened.mode & 0o777) !== 0o600) {
      fail("private runtime file changed during read");
    }
    return fs.readFileSync(descriptor);
  } finally {
    fs.closeSync(descriptor);
  }
}

function assertCredentialDirectory(directory, { ownerUid = 0, mode = 0o711 } = {}) {
  const resolved = path.resolve(directory);
  const metadata = fs.lstatSync(resolved);
  const real = fs.realpathSync(resolved);
  if (
    !metadata.isDirectory()
    || metadata.isSymbolicLink()
    || real !== resolved
    || metadata.uid !== ownerUid
    || (metadata.mode & 0o777) !== mode
  ) fail("credential directory ownership, path, or mode is invalid");
  return real;
}

function exactCredentialPath(directory, name) {
  const file = path.resolve(directory, name);
  if (path.dirname(file) !== directory || path.basename(file) !== name) {
    fail("credential path is invalid");
  }
  return file;
}

function isCredentialTemporaryName(name) {
  return CREDENTIAL_TEMPORARY_FILE.test(name);
}

function credentialCleanupNames(directory) {
  const temporary = fs.readdirSync(directory, { encoding: "utf8" })
    .filter(isCredentialTemporaryName);
  return [...Object.values(FILE_NAMES), ...temporary];
}

function clearCredentialFiles(directory) {
  const names = credentialCleanupNames(directory);
  for (const name of names) {
    const file = exactCredentialPath(directory, name);
    try {
      const metadata = fs.lstatSync(file);
      if (!metadata.isFile() && !metadata.isSymbolicLink()) {
        fail("refusing to remove a non-file credential path");
      }
      fs.unlinkSync(file);
    } catch (error) {
      if (error?.code === "ENOENT") continue;
      throw error;
    }
  }
  for (const name of credentialCleanupNames(directory)) {
    try {
      const file = exactCredentialPath(directory, name);
      fs.lstatSync(file);
      fail("credential cleanup did not remove every credential file");
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
    }
  }
}

function writeCredentialFile(directory, name, data, { uid, gid, writerUid = 0 }) {
  const destination = exactCredentialPath(directory, name);
  const temporary = exactCredentialPath(
    directory,
    `.${name}.tmp.${process.pid}.${crypto.randomBytes(12).toString("hex")}`,
  );
  let descriptor = null;
  try {
    descriptor = fs.openSync(
      temporary,
      fs.constants.O_CREAT | fs.constants.O_EXCL | fs.constants.O_WRONLY | (fs.constants.O_NOFOLLOW || 0),
      0o600,
    );
    fs.writeFileSync(descriptor, data);
    fs.fchmodSync(descriptor, 0o600);
    fs.fsyncSync(descriptor);
    const metadata = fs.fstatSync(descriptor);
    if (!metadata.isFile() || metadata.uid !== writerUid || (metadata.mode & 0o777) !== 0o600) {
      fail("credential temporary file metadata is invalid");
    }
  } catch (error) {
    if (descriptor !== null) {
      fs.closeSync(descriptor);
      descriptor = null;
    }
    try { fs.unlinkSync(temporary); } catch {}
    throw error;
  } finally {
    if (descriptor !== null) fs.closeSync(descriptor);
  }
  try {
    fs.renameSync(temporary, destination);
    fs.chownSync(destination, uid, gid);
    fs.chmodSync(destination, 0o600);
    const metadata = fs.lstatSync(destination);
    const real = fs.realpathSync(destination);
    if (
      !metadata.isFile()
      || metadata.isSymbolicLink()
      || real !== destination
      || metadata.uid !== uid
      || (metadata.mode & 0o777) !== 0o600
    ) fail("credential file metadata is invalid after write");
  } catch (error) {
    try { fs.unlinkSync(temporary); } catch {}
    throw error;
  }
}

function readSingleJsonInput() {
  const raw = fs.readFileSync(0);
  try {
    if (raw.length < 3 || raw.length > 65536) fail("stdin contract length is invalid");
    const source = raw.toString("utf8");
    if (!source.endsWith("\n") || source.includes("\r") || source.slice(0, -1).includes("\n")) {
      fail("stdin contract must be exactly one LF-terminated JSON record");
    }
    return JSON.parse(source.slice(0, -1));
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("Ponto JIT custody:")) throw error;
    fail("stdin contract is not valid JSON");
  } finally {
    raw.fill(0);
  }
}

export function validateManifest(value) {
  const manifest = exactly(value, ["schemaVersion", "repository", "runner", "policy"], "manifest");
  if (manifest.schemaVersion !== 1) fail("manifest schema is invalid");
  text(manifest.repository, "manifest repository", /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/, { max: 256 });
  const runner = exactly(manifest.runner, ["id", "name", "user", "labels"], "manifest runner");
  const policy = exactly(manifest.policy, [
    "runnerIsolationRef",
    "networkContextCustodyRef",
    "encryptionPublicKeySha256",
    "jitAttestationKeyId",
    "jitAttestationPublicKeyPem",
    "jitSupervisorCustodyRef",
    "jitCleanupHookCustodyRef",
  ], "manifest policy");
  text(String(runner.id), "manifest runner id", POSITIVE_ID, { max: 20 });
  text(runner.name, "manifest runner name", /^ponto-jit-[a-z0-9][a-z0-9-]{15,63}$/, { max: 80 });
  if (runner.user !== PONTO_JIT_RUNNER_USER) fail("manifest runner user differs");
  if (
    !Array.isArray(runner.labels)
    || JSON.stringify(runner.labels) !== JSON.stringify(["self-hosted", "Linux", "X64", runner.name])
  ) fail("manifest runner labels differ");
  for (const [name, candidate] of Object.entries(policy)) {
    if (name === "jitAttestationPublicKeyPem") continue;
    const pattern = name === "encryptionPublicKeySha256" ? HEX_32 : SAFE_REF;
    text(candidate, `manifest policy ${name}`, pattern, { max: 4096 });
  }
  let publicKey;
  try { publicKey = crypto.createPublicKey(policy.jitAttestationPublicKeyPem); } catch { fail("manifest attestation public key is invalid"); }
  if (publicKey.asymmetricKeyType !== "ed25519") fail("manifest attestation public key is invalid");
  return manifest;
}

function validateMaterializationInput(value, manifest) {
  const input = exactly(value, ["schemaVersion", "credentials", "context"], "materialization input");
  if (input.schemaVersion !== 1) fail("materialization schema is invalid");
  const credentials = exactly(input.credentials, [
    "pilotLogin",
    "pilotPassword",
    "cfAccessClientId",
    "cfAccessClientSecret",
  ], "materialization credentials");
  const context = exactly(input.context, [
    "repositoryId",
    "releaseSha",
    "stage",
    "coordinatorRunId",
    "coordinatorIssuerRunId",
    "coordinatorDispatchNonce",
    "workflowRunId",
    "runAttempt",
    "coreVersionId",
    "timekeepingVersionId",
    "identityVersionId",
    "pagesDeploymentId",
    "preflightArtifactId",
    "preflightArtifactSha256",
  ], "materialization context");
  text(credentials.pilotLogin, "pilot login", /^[^\s@]+@[^\s@]+$/, { max: 512 });
  text(credentials.pilotPassword, "pilot password", null, { min: 12, max: 4096 });
  text(credentials.cfAccessClientId, "Cloudflare Access client id", null, { min: 0, max: 4096 });
  text(credentials.cfAccessClientSecret, "Cloudflare Access client secret", null, { min: 0, max: 4096 });
  if (Boolean(credentials.cfAccessClientId) !== Boolean(credentials.cfAccessClientSecret)) {
    fail("Cloudflare Access credentials are partial");
  }
  text(String(context.repositoryId), "repository id", POSITIVE_ID, { max: 20 });
  text(context.releaseSha, "release SHA", FULL_SHA, { max: 40 });
  text(context.stage, "release stage", /^(pilot|canary|production)$/, { max: 16 });
  text(String(context.coordinatorRunId), "coordinator run id", POSITIVE_ID, { max: 20 });
  text(String(context.coordinatorIssuerRunId), "coordinator issuer run id", POSITIVE_ID, { max: 20 });
  text(context.coordinatorDispatchNonce, "coordinator nonce", /^[0-9a-f]{32}$/, { max: 32 });
  text(String(context.workflowRunId), "workflow run id", POSITIVE_ID, { max: 20 });
  if (context.runAttempt !== 1) fail("workflow run attempt differs");
  for (const field of ["coreVersionId", "timekeepingVersionId", "identityVersionId", "pagesDeploymentId"]) {
    text(context[field], field, UUID, { max: 36 });
  }
  text(String(context.preflightArtifactId), "preflight artifact id", POSITIVE_ID, { max: 20 });
  normalizedDigest(context.preflightArtifactSha256, "preflight artifact digest");
  return { credentials, context };
}

function encryptedCredentialEnvelope(credentials, encryptionPrivateKeyPem) {
  const plaintext = Buffer.from(JSON.stringify(credentials));
  const dataKey = crypto.randomBytes(32);
  const iv = crypto.randomBytes(12);
  let ciphertext = null;
  let encryptedKey = null;
  try {
    const privateKey = crypto.createPrivateKey(encryptionPrivateKeyPem);
    const publicKey = crypto.createPublicKey(privateKey);
    if (
      publicKey.asymmetricKeyType !== "rsa"
      || Number(publicKey.asymmetricKeyDetails?.modulusLength || 0) < 2048
    ) fail("runner encryption key is invalid");
    const cipher = crypto.createCipheriv("aes-256-gcm", dataKey, iv);
    ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
    encryptedKey = crypto.publicEncrypt({
      key: publicKey,
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
    ciphertext?.fill(0);
    encryptedKey?.fill(0);
  }
}

export function materializeJitCredentials({
  manifest,
  attestationPrivateKeyPem,
  encryptionPrivateKeyPem,
  input,
  credentialDirectory = PONTO_JIT_CREDENTIAL_DIR,
  credentialDirectoryOwnerUid = 0,
  credentialDirectoryMode = 0o711,
  targetUid,
  targetGid,
  now = new Date(),
} = {}) {
  const expected = validateManifest(manifest);
  const { credentials, context } = validateMaterializationInput(input, expected);
  if (!Number.isInteger(targetUid) || !Number.isInteger(targetGid) || targetUid < 1 || targetGid < 1) {
    fail("target runner identity is invalid");
  }
  const directory = assertCredentialDirectory(credentialDirectory, {
    ownerUid: credentialDirectoryOwnerUid,
    mode: credentialDirectoryMode,
  });
  const releaseSha = context.releaseSha.toLowerCase();
  const releaseRef = `refs/tags/skincos/release/ponto/${releaseSha}`;
  let attestationPrivateKey;
  let attestationPublicKey;
  let encryptedBundle = null;
  let rawDecryptKey = null;
  let rawAttestation = null;
  try {
    attestationPrivateKey = crypto.createPrivateKey(attestationPrivateKeyPem);
    attestationPublicKey = crypto.createPublicKey(attestationPrivateKey);
    if (
      attestationPublicKey.asymmetricKeyType !== "ed25519"
      || keyFingerprint(attestationPrivateKey) !== keyFingerprint(expected.policy.jitAttestationPublicKeyPem)
    ) fail("attestation key differs from the private manifest");
    const encryptionPrivateKey = crypto.createPrivateKey(encryptionPrivateKeyPem);
    if (
      encryptionPrivateKey.asymmetricKeyType !== "rsa"
      || Number(encryptionPrivateKey.asymmetricKeyDetails?.modulusLength || 0) < 2048
      || keyFingerprint(encryptionPrivateKey) !== expected.policy.encryptionPublicKeySha256
    ) fail("runner encryption key differs from the private manifest");
    encryptedBundle = encryptedCredentialEnvelope(credentials, encryptionPrivateKeyPem);
    rawDecryptKey = Buffer.from(encryptionPrivateKeyPem);
    const issuedAt = now.toISOString();
    const expiresAt = new Date(now.getTime() + 10 * 60 * 1000).toISOString();
    const claims = {
      schemaVersion: 1,
      domain: "skincos/ponto/jit-credential-attestation/v1",
      repositoryId: String(context.repositoryId),
      repository: expected.repository,
      workflowPath: ".github/workflows/ponto-production-slo.yml",
      workflowRef: `${expected.repository}/.github/workflows/ponto-production-slo.yml@${releaseRef}`,
      workflowJob: "consultor-journey",
      ref: releaseRef,
      environment: "production",
      releaseSha,
      stage: context.stage,
      coordinatorRunId: String(context.coordinatorRunId),
      coordinatorIssuerRunId: String(context.coordinatorIssuerRunId),
      coordinatorDispatchNonce: context.coordinatorDispatchNonce,
      workflowRunId: String(context.workflowRunId),
      runAttempt: 1,
      coreVersionId: context.coreVersionId.toLowerCase(),
      timekeepingVersionId: context.timekeepingVersionId.toLowerCase(),
      identityVersionId: context.identityVersionId.toLowerCase(),
      pagesDeploymentId: context.pagesDeploymentId.toLowerCase(),
      preflightArtifactId: String(context.preflightArtifactId),
      preflightArtifactSha256: normalizedDigest(context.preflightArtifactSha256, "preflight artifact digest"),
      runnerId: String(expected.runner.id),
      runnerName: expected.runner.name,
      runnerOs: "Linux",
      runnerArch: "X64",
      runnerIsolationRef: expected.policy.runnerIsolationRef,
      networkContextCustodyRef: expected.policy.networkContextCustodyRef,
      runnerEncryptionPublicKeySha256: expected.policy.encryptionPublicKeySha256,
      credentialBundleSha256: digest(encryptedBundle),
      decryptKeySha256: digest(rawDecryptKey),
      supervisorCustodyRef: expected.policy.jitSupervisorCustodyRef,
      cleanupHookCustodyRef: expected.policy.jitCleanupHookCustodyRef,
      attestationNonce: crypto.randomBytes(16).toString("hex"),
      issuedAt,
      expiresAt,
      singleUse: true,
    };
    if (JSON.stringify(Object.keys(claims).sort()) !== JSON.stringify([...JIT_CLAIM_FIELDS].sort())) {
      fail("generated JIT claims differ");
    }
    const signature = crypto
      .sign(null, Buffer.from(canonicalJitClaims(claims)), attestationPrivateKey)
      .toString("base64url");
    rawAttestation = Buffer.from(`${JSON.stringify({
      claims,
      signature: {
        algorithm: "Ed25519",
        keyId: expected.policy.jitAttestationKeyId,
        valueBase64url: signature,
      },
    })}\n`);
    clearCredentialFiles(directory);
    writeCredentialFile(directory, FILE_NAMES.credentialBundle, encryptedBundle, {
      uid: targetUid,
      gid: targetGid,
      writerUid: credentialDirectoryOwnerUid,
    });
    writeCredentialFile(directory, FILE_NAMES.decryptKey, rawDecryptKey, {
      uid: targetUid,
      gid: targetGid,
      writerUid: credentialDirectoryOwnerUid,
    });
    writeCredentialFile(directory, FILE_NAMES.attestation, rawAttestation, {
      uid: targetUid,
      gid: targetGid,
      writerUid: credentialDirectoryOwnerUid,
    });
    return {
      passed: true,
      runnerId: String(expected.runner.id),
      runnerName: expected.runner.name,
      releaseSha,
      stage: context.stage,
      expiresAt,
      credentialBundleSha256: claims.credentialBundleSha256,
      decryptKeySha256: claims.decryptKeySha256,
      attestationSha256: digest(rawAttestation),
      credentialsIncluded: false,
      piiIncluded: false,
    };
  } catch (error) {
    try { clearCredentialFiles(directory); } catch {}
    throw error;
  } finally {
    encryptedBundle?.fill(0);
    rawDecryptKey?.fill(0);
    rawAttestation?.fill(0);
  }
}

export function cleanupJitCredentials({
  credentialDirectory = PONTO_JIT_CREDENTIAL_DIR,
  credentialDirectoryOwnerUid = 0,
  credentialDirectoryMode = 0o711,
} = {}) {
  const directory = assertCredentialDirectory(credentialDirectory, {
    ownerUid: credentialDirectoryOwnerUid,
    mode: credentialDirectoryMode,
  });
  clearCredentialFiles(directory);
  return { passed: true, filesDeleted: true, credentialsIncluded: false, piiIncluded: false };
}

function expectedRunnerIdentity({ targetUid, targetGid } = {}) {
  if (targetUid === undefined && targetGid === undefined) return userIdentity(PONTO_JIT_RUNNER_USER);
  if (
    !Number.isInteger(targetUid)
    || !Number.isInteger(targetGid)
    || targetUid < 1
    || targetGid < 1
  ) fail("target runner identity is invalid");
  return { uid: targetUid, gid: targetGid };
}

function readExpectedCredentialFile(directory, name, { uid, mode = 0o600 }) {
  const file = exactCredentialPath(directory, name);
  const before = fs.lstatSync(file);
  const real = fs.realpathSync(file);
  if (
    !before.isFile()
    || before.isSymbolicLink()
    || real !== file
    || before.uid !== uid
    || (before.mode & 0o777) !== mode
  ) fail("credential file metadata is invalid");
  const descriptor = fs.openSync(file, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0));
  try {
    const opened = fs.fstatSync(descriptor);
    if (
      before.dev !== opened.dev
      || before.ino !== opened.ino
      || !opened.isFile()
      || opened.uid !== uid
      || (opened.mode & 0o777) !== mode
    ) fail("credential file changed during read");
    return fs.readFileSync(descriptor);
  } finally {
    fs.closeSync(descriptor);
  }
}

function parseAttestationExpiry(raw) {
  try {
    const document = JSON.parse(raw.toString("utf8"));
    const expiresAt = document?.claims?.expiresAt;
    if (typeof expiresAt !== "string" || expiresAt.length !== 24) return null;
    const parsed = new Date(expiresAt);
    if (Number.isNaN(parsed.getTime()) || parsed.toISOString() !== expiresAt) return null;
    return parsed;
  } catch {
    return null;
  } finally {
    raw.fill(0);
  }
}

export function cleanupExpiredJitCredentials({
  credentialDirectory = PONTO_JIT_CREDENTIAL_DIR,
  credentialDirectoryOwnerUid = 0,
  credentialDirectoryMode = 0o711,
  targetUid,
  targetGid,
  now = new Date(),
} = {}) {
  const directory = assertCredentialDirectory(credentialDirectory, {
    ownerUid: credentialDirectoryOwnerUid,
    mode: credentialDirectoryMode,
  });
  if (!(now instanceof Date) || Number.isNaN(now.getTime())) fail("cleanup time is invalid");
  const target = expectedRunnerIdentity({ targetUid, targetGid });
  const temporaryFiles = fs.readdirSync(directory, { encoding: "utf8" })
    .filter(isCredentialTemporaryName);
  const present = [];
  for (const name of Object.values(FILE_NAMES)) {
    try {
      fs.lstatSync(exactCredentialPath(directory, name));
      present.push(name);
    } catch (error) {
      if (error?.code !== "ENOENT") {
        clearCredentialFiles(directory);
        return { passed: true, filesDeleted: true, reason: "invalid", credentialsIncluded: false, piiIncluded: false };
      }
    }
  }
  if (present.length === 0 && temporaryFiles.length === 0) {
    return { passed: true, filesDeleted: false, reason: "empty", credentialsIncluded: false, piiIncluded: false };
  }
  if (present.length !== Object.keys(FILE_NAMES).length || temporaryFiles.length > 0) {
    clearCredentialFiles(directory);
    return { passed: true, filesDeleted: true, reason: "partial", credentialsIncluded: false, piiIncluded: false };
  }
  let attestation = null;
  try {
    for (const name of Object.values(FILE_NAMES)) {
      if (name === FILE_NAMES.attestation) continue;
      const raw = readExpectedCredentialFile(directory, name, { uid: target.uid });
      raw.fill(0);
    }
    attestation = readExpectedCredentialFile(directory, FILE_NAMES.attestation, { uid: target.uid });
    const expiresAt = parseAttestationExpiry(attestation);
    attestation = null;
    if (!expiresAt) {
      clearCredentialFiles(directory);
      return { passed: true, filesDeleted: true, reason: "invalid", credentialsIncluded: false, piiIncluded: false };
    }
    if (expiresAt.getTime() <= now.getTime()) {
      clearCredentialFiles(directory);
      return { passed: true, filesDeleted: true, reason: "expired", credentialsIncluded: false, piiIncluded: false };
    }
    return { passed: true, filesDeleted: false, reason: "valid", credentialsIncluded: false, piiIncluded: false };
  } catch {
    try { clearCredentialFiles(directory); } catch {}
    return { passed: true, filesDeleted: true, reason: "invalid", credentialsIncluded: false, piiIncluded: false };
  } finally {
    attestation?.fill(0);
  }
}

function writeRootPrivateFile(file, data) {
  const directory = path.dirname(file);
  const temporary = path.join(directory, `.${path.basename(file)}.tmp.${process.pid}.${crypto.randomBytes(12).toString("hex")}`);
  const raw = Buffer.isBuffer(data) ? data : Buffer.from(String(data));
  let descriptor = null;
  try {
    descriptor = fs.openSync(temporary, fs.constants.O_CREAT | fs.constants.O_EXCL | fs.constants.O_WRONLY, 0o600);
    fs.writeFileSync(descriptor, raw);
    fs.fchownSync(descriptor, 0, 0);
    fs.fchmodSync(descriptor, 0o600);
    fs.fsyncSync(descriptor);
  } catch (error) {
    if (descriptor !== null) {
      fs.closeSync(descriptor);
      descriptor = null;
    }
    try { fs.unlinkSync(temporary); } catch {}
    throw error;
  } finally {
    if (descriptor !== null) fs.closeSync(descriptor);
    if (!Buffer.isBuffer(data)) raw.fill(0);
  }
  try {
    fs.renameSync(temporary, file);
    assertOwnedRegularFile(file);
  } catch (error) {
    try { fs.unlinkSync(temporary); } catch {}
    throw error;
  }
}

function bootstrapPrivateRuntime(value) {
  const input = exactly(value, ["schemaVersion", "manifest", "attestationPrivateKeyPem", "encryptionPrivateKeyPem"], "bootstrap input");
  if (input.schemaVersion !== 1) fail("bootstrap schema is invalid");
  const manifest = validateManifest(input.manifest);
  if (typeof input.attestationPrivateKeyPem !== "string" || typeof input.encryptionPrivateKeyPem !== "string") {
    fail("bootstrap private key input is invalid");
  }
  const attestationPrivateKey = crypto.createPrivateKey(input.attestationPrivateKeyPem);
  const encryptionPrivateKey = crypto.createPrivateKey(input.encryptionPrivateKeyPem);
  if (
    attestationPrivateKey.asymmetricKeyType !== "ed25519"
    || keyFingerprint(attestationPrivateKey) !== keyFingerprint(manifest.policy.jitAttestationPublicKeyPem)
    || encryptionPrivateKey.asymmetricKeyType !== "rsa"
    || Number(encryptionPrivateKey.asymmetricKeyDetails?.modulusLength || 0) < 2048
    || keyFingerprint(encryptionPrivateKey) !== manifest.policy.encryptionPublicKeySha256
  ) fail("bootstrap private key custody differs from manifest");
  fs.mkdirSync(PONTO_JIT_RUNTIME_DIR, { recursive: true, mode: 0o700 });
  fs.chownSync(PONTO_JIT_RUNTIME_DIR, 0, 0);
  fs.chmodSync(PONTO_JIT_RUNTIME_DIR, 0o700);
  fs.mkdirSync(PONTO_JIT_CREDENTIAL_DIR, { recursive: true, mode: 0o711 });
  fs.chownSync(PONTO_JIT_CREDENTIAL_DIR, 0, 0);
  fs.chmodSync(PONTO_JIT_CREDENTIAL_DIR, 0o711);
  clearCredentialFiles(assertCredentialDirectory(PONTO_JIT_CREDENTIAL_DIR));
  writeRootPrivateFile(PONTO_JIT_MANIFEST_FILE, `${JSON.stringify(manifest)}\n`);
  writeRootPrivateFile(PONTO_JIT_ATTESTATION_KEY_FILE, input.attestationPrivateKeyPem);
  writeRootPrivateFile(PONTO_JIT_DECRYPT_KEY_FILE, input.encryptionPrivateKeyPem);
  return {
    passed: true,
    runnerId: String(manifest.runner.id),
    runnerName: manifest.runner.name,
    encryptionPublicKeySha256: manifest.policy.encryptionPublicKeySha256,
    credentialsIncluded: false,
    piiIncluded: false,
  };
}

function loadRootManifest() {
  const raw = readOwnedPrivateFile(PONTO_JIT_MANIFEST_FILE);
  try { return validateManifest(JSON.parse(raw.toString("utf8"))); } finally { raw.fill(0); }
}

function run(command) {
  assertRoot();
  if (command === "bootstrap") return bootstrapPrivateRuntime(readSingleJsonInput());
  if (command === "cleanup") return cleanupJitCredentials();
  if (command === "cleanup-expired") return cleanupExpiredJitCredentials();
  if (command === "materialize") {
    const manifest = loadRootManifest();
    const attestation = readOwnedPrivateFile(PONTO_JIT_ATTESTATION_KEY_FILE);
    const decrypt = readOwnedPrivateFile(PONTO_JIT_DECRYPT_KEY_FILE);
    try {
      const target = userIdentity(manifest.runner.user);
      return materializeJitCredentials({
        manifest,
        attestationPrivateKeyPem: attestation.toString("utf8"),
        encryptionPrivateKeyPem: decrypt.toString("utf8"),
        input: readSingleJsonInput(),
        targetUid: target.uid,
        targetGid: target.gid,
      });
    } finally {
      attestation.fill(0);
      decrypt.fill(0);
    }
  }
  fail("usage is bootstrap, materialize, cleanup, or cleanup-expired");
}

const invokedDirectly = process.argv[1]
  && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;

if (invokedDirectly) {
  try {
    const result = run(process.argv[2] || "");
    process.stdout.write(`${JSON.stringify(result)}\n`);
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 78;
  }
}
