#!/usr/bin/env node
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

export const PONTO_LEGACY_SNAPSHOT_DOMAIN = "skincos/ponto/legacy-snapshot-custody/v1";
export const PONTO_LEGACY_SNAPSHOT_RUNTIME_DIR = "/etc/skincos/ponto-legacy-snapshot-custody";
export const PONTO_LEGACY_SNAPSHOT_DESTINATION_DIR = "/var/lib/skincos/ponto-legacy-snapshot-custody";
export const PONTO_LEGACY_SNAPSHOT_POLICY_FILE = path.join(
  PONTO_LEGACY_SNAPSHOT_RUNTIME_DIR,
  "policy.json",
);

export const SNAPSHOT_AUTHORIZATION_FIELDS = Object.freeze([
  "schemaVersion",
  "domain",
  "operation",
  "authorizationId",
  "policySha256",
  "repositoryId",
  "repository",
  "workflowPath",
  "githubRef",
  "workflowJob",
  "sourceSha",
  "workflowRunId",
  "runAttempt",
  "target",
  "purpose",
  "issuedAt",
  "expiresAt",
  "singleUse",
]);

export const SNAPSHOT_POLICY_BINDING_FIELDS = Object.freeze([
  "repositoryId",
  "repository",
  "workflowPath",
  "githubRef",
  "workflowJob",
  "target",
  "purpose",
]);

const POLICY_FIELDS = Object.freeze([
  "schemaVersion",
  "domain",
  "authorizationKeyId",
  "authorizationPublicKeyPem",
  "binding",
  "sourceFiles",
]);

const SOURCE_FILE_FIELDS = Object.freeze(["id", "path", "maxBytes"]);
const SIGNATURE_FIELDS = Object.freeze(["algorithm", "keyId", "valueBase64url"]);
const AUTHORIZATION_FIELDS = Object.freeze([...SNAPSHOT_AUTHORIZATION_FIELDS, "signature"]);
const RECEIPT_FIELDS = Object.freeze([
  "schemaVersion",
  "captureId",
  "authorizationId",
  "policySha256",
  "sourceSha",
  "capturedAt",
  "sourceFileCount",
  "artifacts",
  "credentialsIncluded",
  "piiIncluded",
]);
const ARTIFACT_FIELDS = Object.freeze(["id", "sha256", "sizeBytes"]);
const MAX_AUTHORIZATION_BYTES = 64 * 1024;
const MAX_AUTHORIZATION_LIFETIME_MS = 10 * 60 * 1000;
const MAX_SOURCE_BYTES = 1024 * 1024 * 1024;
const FULL_SHA = /^[0-9a-f]{40}$/;
const SHA256 = /^[0-9a-f]{64}$/;
const POSITIVE_ID = /^[1-9][0-9]{0,19}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const REPOSITORY = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;
const WORKFLOW_PATH = /^\.github\/workflows\/[A-Za-z0-9_.-]+\.ya?ml$/;
const GITHUB_REF = /^refs\/(?:heads|tags)\/[A-Za-z0-9][A-Za-z0-9._/@-]{0,240}$/;
const JOB = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$/;
const KEY_ID = /^[a-z][a-z0-9-]{1,63}$/;
const SOURCE_ID = /^[a-z][a-z0-9-]{1,63}$/;
const BASE64URL_SIGNATURE = /^[A-Za-z0-9_-]{86}$/;

const fail = (message) => {
  throw new Error("Ponto legacy snapshot custody: " + message);
};

const digest = (value) => crypto.createHash("sha256").update(value).digest("hex");

const sameFields = (value, fields) => (
  value
  && typeof value === "object"
  && !Array.isArray(value)
  && JSON.stringify(Object.keys(value).sort()) === JSON.stringify([...fields].sort())
);

function exactObject(value, fields, label) {
  if (!sameFields(value, fields)) fail(label + " fields differ");
  return value;
}

function safeText(value, label, pattern = null, { min = 1, max = 4096 } = {}) {
  if (
    typeof value !== "string"
    || value.length < min
    || value.length > max
    || value.includes("\0")
    || value.includes("\r")
    || value.includes("\n")
  ) fail(label + " is invalid");
  if (pattern && !pattern.test(value)) fail(label + " is invalid");
  return value;
}

function publicKeyPem(value, label) {
  if (
    typeof value !== "string"
    || value.length < 64
    || value.length > 8192
    || value.includes("\0")
    || value.includes("\r")
  ) fail(label + " is invalid");
  return value;
}

function exactIsoDate(value, label) {
  safeText(value, label, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/, { max: 24 });
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString() !== value) fail(label + " is invalid");
  return parsed;
}

function lowerDigest(value, label) {
  const normalized = safeText(String(value || "").toLowerCase(), label, SHA256, { max: 64 });
  return normalized;
}

function assertLinux() {
  if (process.platform !== "linux") fail("command requires Linux");
  if (!Number.isInteger(fs.constants.O_NOFOLLOW) || !Number.isInteger(fs.constants.O_NONBLOCK)) {
    fail("native no-follow and non-blocking file support is required");
  }
}

function assertRoot() {
  assertLinux();
  if (typeof process.getuid !== "function" || process.getuid() !== 0) fail("command requires root");
}

function exactChild(parent, name, label) {
  const candidate = path.resolve(parent, name);
  if (path.dirname(candidate) !== parent || path.basename(candidate) !== name) fail(label + " path is invalid");
  return candidate;
}

function assertPrivateDirectory(directory, { uid = 0, mode = 0o700 } = {}) {
  const resolved = path.resolve(directory);
  const metadata = fs.lstatSync(resolved);
  const real = fs.realpathSync(resolved);
  if (
    !metadata.isDirectory()
    || metadata.isSymbolicLink()
    || real !== resolved
    || metadata.uid !== uid
    || (metadata.mode & 0o777) !== mode
  ) fail("private directory ownership, path, or mode is invalid");
  return real;
}

function ensurePrivateDirectory(directory, { uid = 0, gid = 0, mode = 0o700 } = {}) {
  const resolved = path.resolve(directory);
  try {
    fs.mkdirSync(resolved, { recursive: true, mode });
    fs.chownSync(resolved, uid, gid);
    fs.chmodSync(resolved, mode);
  } catch {
    fail("private directory cannot be created");
  }
  return assertPrivateDirectory(resolved, { uid, mode });
}

function assertPrivateRegularFile(file, { uid = 0, mode = 0o600 } = {}) {
  const resolved = path.resolve(file);
  const metadata = fs.lstatSync(resolved);
  const real = fs.realpathSync(resolved);
  if (
    !metadata.isFile()
    || metadata.isSymbolicLink()
    || real !== resolved
    || metadata.uid !== uid
    || (metadata.mode & 0o777) !== mode
  ) fail("private file ownership, path, or mode is invalid");
  return resolved;
}

function writePrivateFile(file, value, { uid = 0, gid = 0, mode = 0o600 } = {}) {
  const directory = assertPrivateDirectory(path.dirname(file), { uid, mode: 0o700 });
  const destination = exactChild(directory, path.basename(file), "private file");
  const temporary = exactChild(
    directory,
    "." + path.basename(file) + ".tmp." + process.pid + "." + crypto.randomBytes(12).toString("hex"),
    "private file",
  );
  const raw = Buffer.isBuffer(value) ? value : Buffer.from(String(value), "utf8");
  let descriptor = null;
  try {
    descriptor = fs.openSync(
      temporary,
      fs.constants.O_CREAT | fs.constants.O_EXCL | fs.constants.O_WRONLY | fs.constants.O_NOFOLLOW,
      mode,
    );
    fs.writeFileSync(descriptor, raw);
    fs.fchownSync(descriptor, uid, gid);
    fs.fchmodSync(descriptor, mode);
    fs.fsyncSync(descriptor);
    const metadata = fs.fstatSync(descriptor);
    if (!metadata.isFile() || metadata.uid !== uid || (metadata.mode & 0o777) !== mode) {
      fail("private file cannot be written");
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
    if (!Buffer.isBuffer(value)) raw.fill(0);
  }
  try {
    fs.renameSync(temporary, destination);
    assertPrivateRegularFile(destination, { uid, mode });
  } catch (error) {
    try { fs.unlinkSync(temporary); } catch {}
    throw error;
  }
}

function readPrivateFile(file, { uid = 0, mode = 0o600 } = {}) {
  const resolved = assertPrivateRegularFile(file, { uid, mode });
  const descriptor = fs.openSync(resolved, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
  try {
    const before = fs.lstatSync(resolved);
    const opened = fs.fstatSync(descriptor);
    if (
      before.dev !== opened.dev
      || before.ino !== opened.ino
      || !opened.isFile()
      || opened.uid !== uid
      || (opened.mode & 0o777) !== mode
    ) fail("private file changed during read");
    return fs.readFileSync(descriptor);
  } finally {
    fs.closeSync(descriptor);
  }
}

function validateBinding(value) {
  const binding = exactObject(value, SNAPSHOT_POLICY_BINDING_FIELDS, "policy binding");
  safeText(binding.repositoryId, "policy repository id", POSITIVE_ID, { max: 20 });
  safeText(binding.repository, "policy repository", REPOSITORY, { max: 256 });
  safeText(binding.workflowPath, "policy workflow path", WORKFLOW_PATH, { max: 256 });
  safeText(binding.githubRef, "policy GitHub ref", GITHUB_REF, { max: 256 });
  safeText(binding.workflowJob, "policy workflow job", JOB, { max: 128 });
  if (binding.target !== "staging") fail("policy target differs");
  if (binding.purpose !== "ponto-legacy-snapshot-capture") fail("policy purpose differs");
  return binding;
}

function validateSourceFile(value) {
  const source = exactObject(value, SOURCE_FILE_FIELDS, "policy source file");
  safeText(source.id, "policy source id", SOURCE_ID, { max: 64 });
  safeText(source.path, "policy source path", null, { max: 4096 });
  if (!path.isAbsolute(source.path) || path.resolve(source.path) !== source.path || source.path.endsWith(path.sep)) {
    fail("policy source path is invalid");
  }
  if (!Number.isSafeInteger(source.maxBytes) || source.maxBytes < 1 || source.maxBytes > MAX_SOURCE_BYTES) {
    fail("policy source size limit is invalid");
  }
  return source;
}

export function validateSnapshotPolicy(value) {
  const policy = exactObject(value, POLICY_FIELDS, "policy");
  if (policy.schemaVersion !== 1) fail("policy schema is invalid");
  if (policy.domain !== PONTO_LEGACY_SNAPSHOT_DOMAIN) fail("policy domain differs");
  safeText(policy.authorizationKeyId, "policy authorization key id", KEY_ID, { max: 64 });
  publicKeyPem(policy.authorizationPublicKeyPem, "policy authorization public key");
  let key;
  try {
    key = crypto.createPublicKey(policy.authorizationPublicKeyPem);
  } catch {
    fail("policy authorization public key is invalid");
  }
  if (key.asymmetricKeyType !== "ed25519") fail("policy authorization public key is invalid");
  validateBinding(policy.binding);
  if (!Array.isArray(policy.sourceFiles) || policy.sourceFiles.length !== 2) {
    fail("policy must bind exactly two source files");
  }
  const identifiers = new Set();
  const paths = new Set();
  for (const source of policy.sourceFiles) {
    validateSourceFile(source);
    if (identifiers.has(source.id) || paths.has(source.path)) fail("policy source files are not unique");
    identifiers.add(source.id);
    paths.add(source.path);
  }
  return policy;
}

export function canonicalSnapshotPolicy(value) {
  const policy = validateSnapshotPolicy(value);
  return JSON.stringify({
    schemaVersion: policy.schemaVersion,
    domain: policy.domain,
    authorizationKeyId: policy.authorizationKeyId,
    authorizationPublicKeyPem: policy.authorizationPublicKeyPem,
    binding: Object.fromEntries(
      SNAPSHOT_POLICY_BINDING_FIELDS.map((field) => [field, policy.binding[field]]),
    ),
    sourceFiles: policy.sourceFiles.map((source) => ({
      id: source.id,
      path: source.path,
      maxBytes: source.maxBytes,
    })),
  });
}

export function snapshotPolicySha256(value) {
  return digest(canonicalSnapshotPolicy(value));
}

export function canonicalSnapshotAuthorization(value) {
  return JSON.stringify(
    Object.fromEntries(SNAPSHOT_AUTHORIZATION_FIELDS.map((field) => [field, value?.[field]])),
  );
}

function validateSignature(value, policy) {
  const signature = exactObject(value, SIGNATURE_FIELDS, "authorization signature");
  if (signature.algorithm !== "Ed25519") fail("authorization signature algorithm differs");
  if (signature.keyId !== policy.authorizationKeyId) fail("authorization signature key differs");
  safeText(signature.valueBase64url, "authorization signature", BASE64URL_SIGNATURE, { max: 86 });
  const raw = Buffer.from(signature.valueBase64url, "base64url");
  try {
    if (raw.length !== 64) fail("authorization signature is invalid");
  } finally {
    raw.fill(0);
  }
  return signature;
}

export function validateSnapshotAuthorization(value, {
  policy,
  now = new Date(),
} = {}) {
  const expected = validateSnapshotPolicy(policy);
  const authorization = exactObject(value, AUTHORIZATION_FIELDS, "authorization");
  if (authorization.schemaVersion !== 1) fail("authorization schema is invalid");
  if (authorization.domain !== PONTO_LEGACY_SNAPSHOT_DOMAIN) fail("authorization domain differs");
  if (authorization.operation !== "capture") fail("authorization operation differs");
  safeText(authorization.authorizationId, "authorization id", UUID, { max: 36 });
  lowerDigest(authorization.policySha256, "authorization policy digest");
  if (authorization.policySha256 !== snapshotPolicySha256(expected)) fail("authorization policy digest differs");
  for (const field of SNAPSHOT_POLICY_BINDING_FIELDS) {
    const pattern = field === "repositoryId"
      ? POSITIVE_ID
      : field === "repository"
        ? REPOSITORY
        : field === "workflowPath"
          ? WORKFLOW_PATH
          : field === "githubRef"
            ? GITHUB_REF
            : field === "workflowJob"
              ? JOB
              : null;
    safeText(authorization[field], "authorization " + field, pattern, { max: 4096 });
    if (authorization[field] !== expected.binding[field]) fail("authorization " + field + " differs");
  }
  safeText(authorization.sourceSha, "authorization source SHA", FULL_SHA, { max: 40 });
  safeText(authorization.workflowRunId, "authorization workflow run id", POSITIVE_ID, { max: 20 });
  if (authorization.runAttempt !== 1) fail("authorization workflow attempt differs");
  const issuedAt = exactIsoDate(authorization.issuedAt, "authorization issued time");
  const expiresAt = exactIsoDate(authorization.expiresAt, "authorization expiry");
  if (
    expiresAt.getTime() <= issuedAt.getTime()
    || expiresAt.getTime() - issuedAt.getTime() > MAX_AUTHORIZATION_LIFETIME_MS
  ) fail("authorization lifetime is invalid");
  if (!(now instanceof Date) || Number.isNaN(now.getTime()) || expiresAt.getTime() <= now.getTime()) {
    fail("authorization is expired");
  }
  if (authorization.singleUse !== true) fail("authorization single-use differs");
  validateSignature(authorization.signature, expected);
  return authorization;
}

export function verifySnapshotAuthorization(value, options = {}) {
  const authorization = validateSnapshotAuthorization(value, options);
  const policy = validateSnapshotPolicy(options.policy);
  const signature = Buffer.from(authorization.signature.valueBase64url, "base64url");
  try {
    const verified = crypto.verify(
      null,
      Buffer.from(canonicalSnapshotAuthorization(authorization), "utf8"),
      crypto.createPublicKey(policy.authorizationPublicKeyPem),
      signature,
    );
    if (!verified) fail("authorization signature is invalid");
    return authorization;
  } finally {
    signature.fill(0);
  }
}

function readSingleJsonInput() {
  const raw = fs.readFileSync(0);
  try {
    if (raw.length < 3 || raw.length > MAX_AUTHORIZATION_BYTES) fail("stdin contract length is invalid");
    const source = raw.toString("utf8");
    if (!source.endsWith("\n") || source.includes("\r") || source.slice(0, -1).includes("\n")) {
      fail("stdin contract must be exactly one LF-terminated JSON record");
    }
    return JSON.parse(source.slice(0, -1));
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("Ponto legacy snapshot custody:")) throw error;
    fail("stdin contract is not valid JSON");
  } finally {
    raw.fill(0);
  }
}

function snapshotLayout(destinationDirectory, { uid = 0, gid = 0 } = {}) {
  const root = ensurePrivateDirectory(destinationDirectory, { uid, gid, mode: 0o700 });
  return {
    root,
    authorizations: ensurePrivateDirectory(exactChild(root, "authorizations", "authorization ledger"), {
      uid,
      gid,
      mode: 0o700,
    }),
    captures: ensurePrivateDirectory(exactChild(root, "captures", "capture destination"), {
      uid,
      gid,
      mode: 0o700,
    }),
  };
}

function consumeAuthorization(layout, authorization, now, { uid = 0, gid = 0 } = {}) {
  const ledger = exactChild(layout.authorizations, authorization.authorizationId + ".json", "authorization ledger");
  const record = Buffer.from(JSON.stringify({
    schemaVersion: 1,
    authorizationId: authorization.authorizationId,
    policySha256: authorization.policySha256,
    consumedAt: now.toISOString(),
  }) + "\n", "utf8");
  let descriptor = null;
  try {
    descriptor = fs.openSync(
      ledger,
      fs.constants.O_CREAT | fs.constants.O_EXCL | fs.constants.O_WRONLY | fs.constants.O_NOFOLLOW,
      0o600,
    );
    fs.writeFileSync(descriptor, record);
    fs.fchownSync(descriptor, uid, gid);
    fs.fchmodSync(descriptor, 0o600);
    fs.fsyncSync(descriptor);
    const metadata = fs.fstatSync(descriptor);
    if (!metadata.isFile() || metadata.uid !== uid || (metadata.mode & 0o777) !== 0o600) {
      fail("authorization ledger cannot be written");
    }
  } catch (error) {
    if (error?.code === "EEXIST") fail("authorization was already consumed");
    throw error;
  } finally {
    if (descriptor !== null) fs.closeSync(descriptor);
    record.fill(0);
  }
}

function createCaptureStage(layout, captureId, { uid = 0, gid = 0 } = {}) {
  const stage = exactChild(
    layout.captures,
    "." + captureId + ".tmp." + process.pid + "." + crypto.randomBytes(12).toString("hex"),
    "capture staging",
  );
  try {
    fs.mkdirSync(stage, { mode: 0o700 });
    fs.chownSync(stage, uid, gid);
    fs.chmodSync(stage, 0o700);
  } catch {
    fail("private capture destination cannot be created");
  }
  return assertPrivateDirectory(stage, { uid, mode: 0o700 });
}

function removeCaptureStage(stage, captures, { uid = 0 } = {}) {
  if (path.dirname(stage) !== captures || !path.basename(stage).startsWith(".")) {
    fail("private capture staging path is invalid");
  }
  try {
    assertPrivateDirectory(stage, { uid, mode: 0o700 });
    fs.rmSync(stage, { recursive: true, force: true });
  } catch {}
}

function captureSourceFile(source, destination, { uid = 0, gid = 0, id, ordinal } = {}) {
  let sourceDescriptor = null;
  let destinationDescriptor = null;
  let buffer = null;
  try {
    try {
      sourceDescriptor = fs.openSync(
        source.path,
        fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK,
      );
    } catch {
      fail("captured source file cannot be opened");
    }
    const opened = fs.fstatSync(sourceDescriptor);
    const sourcePath = fs.lstatSync(source.path);
    if (
      !opened.isFile()
      || sourcePath.isSymbolicLink()
      || !sourcePath.isFile()
      || opened.dev !== sourcePath.dev
      || opened.ino !== sourcePath.ino
      || opened.size < 0
      || opened.size > source.maxBytes
    ) fail("captured source file is invalid");
    destinationDescriptor = fs.openSync(
      destination,
      fs.constants.O_CREAT | fs.constants.O_EXCL | fs.constants.O_WRONLY | fs.constants.O_NOFOLLOW,
      0o600,
    );
    fs.fchownSync(destinationDescriptor, uid, gid);
    fs.fchmodSync(destinationDescriptor, 0o600);
    buffer = Buffer.allocUnsafe(Math.min(64 * 1024, Math.max(1, opened.size)));
    const hasher = crypto.createHash("sha256");
    let copied = 0;
    while (copied < opened.size) {
      const read = fs.readSync(
        sourceDescriptor,
        buffer,
        0,
        Math.min(buffer.length, opened.size - copied),
        null,
      );
      if (read <= 0) fail("captured source file changed during copy");
      let written = 0;
      while (written < read) {
        const result = fs.writeSync(destinationDescriptor, buffer, written, read - written, null);
        if (result <= 0) fail("private capture destination cannot be written");
        written += result;
      }
      hasher.update(buffer.subarray(0, read));
      copied += read;
    }
    const after = fs.fstatSync(sourceDescriptor);
    if (
      after.dev !== opened.dev
      || after.ino !== opened.ino
      || after.size !== opened.size
      || after.mtimeMs !== opened.mtimeMs
      || after.ctimeMs !== opened.ctimeMs
    ) fail("captured source file changed during copy");
    fs.fsyncSync(destinationDescriptor);
    const destinationMetadata = fs.fstatSync(destinationDescriptor);
    if (
      !destinationMetadata.isFile()
      || destinationMetadata.uid !== uid
      || (destinationMetadata.mode & 0o777) !== 0o600
      || destinationMetadata.size !== copied
    ) fail("private capture destination is invalid");
    return {
      id,
      ordinal,
      sha256: hasher.digest("hex"),
      sizeBytes: copied,
    };
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("Ponto legacy snapshot custody:")) throw error;
    fail("captured source file cannot be copied");
  } finally {
    buffer?.fill(0);
    if (destinationDescriptor !== null) fs.closeSync(destinationDescriptor);
    if (sourceDescriptor !== null) fs.closeSync(sourceDescriptor);
  }
}

function canonicalReceipt(value) {
  return JSON.stringify(Object.fromEntries(RECEIPT_FIELDS.map((field) => [field, value[field]])));
}

function buildReceipt({ authorization, artifacts, now }) {
  const receipt = {
    schemaVersion: 1,
    captureId: authorization.authorizationId,
    authorizationId: authorization.authorizationId,
    policySha256: authorization.policySha256,
    sourceSha: authorization.sourceSha,
    capturedAt: now.toISOString(),
    sourceFileCount: 2,
    artifacts: artifacts.map((artifact) => {
      const value = {
        id: artifact.id,
        sha256: artifact.sha256,
        sizeBytes: artifact.sizeBytes,
      };
      exactObject(value, ARTIFACT_FIELDS, "capture artifact");
      return value;
    }),
    credentialsIncluded: false,
    piiIncluded: false,
  };
  const snapshotSha256 = digest(canonicalReceipt(receipt));
  return {
    schemaVersion: 1,
    passed: true,
    captureId: receipt.captureId,
    authorizationId: receipt.authorizationId,
    policySha256: receipt.policySha256,
    sourceSha: receipt.sourceSha,
    capturedAt: receipt.capturedAt,
    sourceFileCount: receipt.sourceFileCount,
    artifacts: receipt.artifacts,
    snapshotSha256,
    credentialsIncluded: false,
    piiIncluded: false,
  };
}

function writeCaptureReceipt(stage, receipt, { uid = 0, gid = 0 } = {}) {
  const privateReceipt = {
    schemaVersion: 1,
    captureId: receipt.captureId,
    authorizationId: receipt.authorizationId,
    policySha256: receipt.policySha256,
    sourceSha: receipt.sourceSha,
    capturedAt: receipt.capturedAt,
    sourceFileCount: receipt.sourceFileCount,
    artifacts: receipt.artifacts,
    snapshotSha256: receipt.snapshotSha256,
    credentialsIncluded: false,
    piiIncluded: false,
  };
  writePrivateFile(
    exactChild(stage, "receipt.json", "capture receipt"),
    JSON.stringify(privateReceipt) + "\n",
    { uid, gid, mode: 0o600 },
  );
}

function finalizeCapture(stage, captures, captureId, { uid = 0 } = {}) {
  const destination = exactChild(captures, captureId, "capture destination");
  try {
    fs.renameSync(stage, destination);
    assertPrivateDirectory(destination, { uid, mode: 0o700 });
    const descriptor = fs.openSync(captures, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
    try { fs.fsyncSync(descriptor); } finally { fs.closeSync(descriptor); }
  } catch {
    fail("private capture destination cannot be finalized");
  }
}

export function captureLegacyPontoSnapshot({
  policy,
  authorization,
  now = new Date(),
  destinationDirectory = PONTO_LEGACY_SNAPSHOT_DESTINATION_DIR,
  destinationUid = 0,
  destinationGid = 0,
} = {}) {
  assertLinux();
  const expected = validateSnapshotPolicy(policy);
  const authorized = verifySnapshotAuthorization(authorization, { policy: expected, now });
  const layout = snapshotLayout(destinationDirectory, { uid: destinationUid, gid: destinationGid });
  consumeAuthorization(layout, authorized, now, { uid: destinationUid, gid: destinationGid });
  const stage = createCaptureStage(layout, authorized.authorizationId, {
    uid: destinationUid,
    gid: destinationGid,
  });
  try {
    const artifacts = expected.sourceFiles.map((source, index) => captureSourceFile(
      source,
      exactChild(stage, "artifact-" + String(index + 1).padStart(2, "0"), "capture artifact"),
      {
        uid: destinationUid,
        gid: destinationGid,
        id: "artifact-" + String(index + 1).padStart(2, "0"),
        ordinal: index + 1,
      },
    ));
    const receipt = buildReceipt({ authorization: authorized, artifacts, now });
    writeCaptureReceipt(stage, receipt, { uid: destinationUid, gid: destinationGid });
    finalizeCapture(stage, layout.captures, authorized.authorizationId, { uid: destinationUid });
    return receipt;
  } catch (error) {
    removeCaptureStage(stage, layout.captures, { uid: destinationUid });
    if (error instanceof Error && error.message.startsWith("Ponto legacy snapshot custody:")) throw error;
    fail("capture failed");
  }
}

function bootstrapPrivateRuntime(value) {
  const input = exactObject(value, ["schemaVersion", "policy"], "bootstrap input");
  if (input.schemaVersion !== 1) fail("bootstrap schema is invalid");
  const policy = validateSnapshotPolicy(input.policy);
  ensurePrivateDirectory(PONTO_LEGACY_SNAPSHOT_RUNTIME_DIR, { uid: 0, gid: 0, mode: 0o700 });
  snapshotLayout(PONTO_LEGACY_SNAPSHOT_DESTINATION_DIR, { uid: 0, gid: 0 });
  writePrivateFile(
    PONTO_LEGACY_SNAPSHOT_POLICY_FILE,
    canonicalSnapshotPolicy(policy) + "\n",
    { uid: 0, gid: 0, mode: 0o600 },
  );
  return {
    passed: true,
    policySha256: snapshotPolicySha256(policy),
    sourceFileCount: 2,
    credentialsIncluded: false,
    piiIncluded: false,
  };
}

function loadPrivatePolicy() {
  const raw = readPrivateFile(PONTO_LEGACY_SNAPSHOT_POLICY_FILE, { uid: 0, mode: 0o600 });
  try {
    return validateSnapshotPolicy(JSON.parse(raw.toString("utf8")));
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("Ponto legacy snapshot custody:")) throw error;
    fail("private policy is invalid");
  } finally {
    raw.fill(0);
  }
}

function run(command) {
  assertRoot();
  if (command === "bootstrap") return bootstrapPrivateRuntime(readSingleJsonInput());
  if (command === "capture") {
    return captureLegacyPontoSnapshot({
      policy: loadPrivatePolicy(),
      authorization: readSingleJsonInput(),
    });
  }
  fail("usage is bootstrap or capture");
}

const invokedDirectly = process.argv[1]
  && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;

if (invokedDirectly) {
  try {
    if (process.argv.length !== 3) fail("usage is bootstrap or capture");
    const result = run(process.argv[2]);
    process.stdout.write(JSON.stringify(result) + "\n");
  } catch (error) {
    process.stderr.write((error instanceof Error ? error.message : String(error)) + "\n");
    process.exitCode = 78;
  }
}
