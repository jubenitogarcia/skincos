#!/usr/bin/env node
/**
 * Shared, non-secret authorization contract for the CRM native publisher.
 *
 * The GitHub workflow signs one short-lived authorization with an
 * environment-owned Ed25519 key.  The root-owned publisher verifies it
 * against a root-private policy before it reads the candidate archive or
 * changes a service.  This module deliberately contains no filesystem paths
 * selected by a caller and no private key material.
 */
import crypto from "node:crypto";

export const CRM_NATIVE_PUBLISHER_DOMAIN = "skincos/crm-native-publisher/v1";
export const CRM_NATIVE_PUBLISHER_WORKFLOW = ".github/workflows/publish-crm-native-release.yml";
export const CRM_NATIVE_PUBLISHER_SERVICE = "crm.service";
export const CRM_NATIVE_PUBLISHER_TARGET = "production";
export const CRM_NATIVE_PUBLISHER_POLICY_KIND = "skincos-crm-native-publisher-policy";

export const AUTHORIZATION_CLAIM_FIELDS = Object.freeze([
  "schemaVersion",
  "domain",
  "operation",
  "authorizationId",
  "policySha256",
  "repositoryId",
  "repository",
  "workflowPath",
  "workflowJob",
  "githubRef",
  "sourceSha",
  "sourceTree",
  "sourceArchiveSha256",
  "sourceArchiveBytes",
  "dependencyArchiveSha256",
  "dependencyArchiveBytes",
  "dependencyManifestSha256",
  "dependencyManifestBytes",
  "artifactName",
  "sourceArtifactRunId",
  "workflowRunId",
  "runAttempt",
  "target",
  "service",
  "incumbentStateSha256",
  "stagingProofSha256",
  "runtimeAttestationSha256",
  "coordinationProofSha256",
  "coordinationResource",
  "coordinationModule",
  "coordinationLeaseId",
  "coordinationFencingToken",
  "coordinationIntentDigest",
  "issuedAt",
  "expiresAt",
  "singleUse",
]);

const SHA = /^[0-9a-f]{40}$/;
const DIGEST = /^[0-9a-f]{64}$/;
const POSITIVE_ID = /^[1-9][0-9]{0,19}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const KEY_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,63}$/;
const MAX_AUTHORIZATION_TTL_MS = 5 * 60 * 1000;
const MAX_ARCHIVE_BYTES = 1024 * 1024 * 1024;
const MAX_DEPENDENCY_MANIFEST_BYTES = 16 * 1024 * 1024;

export class CrmNativePublisherContractError extends Error {
  constructor(message) {
    super(`CRM native publisher: ${message}`);
    this.name = "CrmNativePublisherContractError";
  }
}

function fail(message) {
  throw new CrmNativePublisherContractError(message);
}

export function canonicalJson(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(",")}}`;
}

export function sha256Hex(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

export function publisherPolicySha256(policy) {
  return sha256Hex(canonicalJson(validatePublisherPolicy(policy)));
}

function isObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function exactObject(value, fields, label) {
  if (!isObject(value)) fail(`${label} must be an object`);
  const keys = Object.keys(value).sort();
  const expected = [...fields].sort();
  if (JSON.stringify(keys) !== JSON.stringify(expected)) fail(`${label} fields differ`);
  return value;
}

function requiredText(value, label, pattern, { max = 4096 } = {}) {
  if (typeof value !== "string" || value.length === 0 || value.length > max || value.includes("\0") || value.includes("\r") || value.includes("\n")) {
    fail(`${label} is invalid`);
  }
  if (pattern && !pattern.test(value)) fail(`${label} is invalid`);
  return value;
}

function requiredPublicKeyPem(value) {
  if (typeof value !== "string" || value.length < 64 || value.length > 8192 || value.includes("\0") || value.includes("\r")) {
    fail("publisher signing public key is invalid");
  }
  return value;
}

function requiredPrivateKeyPem(value) {
  if (typeof value !== "string" || value.length < 64 || value.length > 8192 || value.includes("\0") || value.includes("\r")) {
    fail("publisher signing private key is invalid");
  }
  return value;
}

function sha(value, label) {
  return requiredText(value, label, SHA, { max: 40 });
}

function digest(value, label) {
  return requiredText(value, label, DIGEST, { max: 64 });
}

function positiveId(value, label) {
  return requiredText(String(value), label, POSITIVE_ID, { max: 20 });
}

function strictIso(value, label) {
  const text = requiredText(value, label, null, { max: 24 });
  const parsed = new Date(text);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString() !== text) fail(`${label} is invalid`);
  return parsed;
}

function assertFixedTarget(target) {
  const value = exactObject(target, [
    "name",
    "service",
    "releaseBase",
    "currentLink",
    "previousLink",
    "unitFile",
    "stateRoot",
    "configRoot",
    "logRoot",
    "legacyRuntimeMode",
  ], "publisher target");
  if (
    value.name !== CRM_NATIVE_PUBLISHER_TARGET
    || value.service !== CRM_NATIVE_PUBLISHER_SERVICE
    || value.releaseBase !== "/opt/skincos/releases"
    || value.currentLink !== "/opt/skincos/current/crm-service"
    || value.previousLink !== "/opt/skincos/current/crm-service.previous"
    || value.unitFile !== "/etc/systemd/system/crm.service"
    || value.stateRoot !== "/var/lib/skincos-runtime"
    || value.configRoot !== "/etc/skincos"
    || value.logRoot !== "/var/log/skincos"
    || value.legacyRuntimeMode !== "disabled"
  ) fail("publisher target differs from the fixed CRM production layout");
  return value;
}

export function validatePublisherPolicy(value) {
  const policy = exactObject(value, [
    "schemaVersion",
    "kind",
    "repositoryId",
    "repository",
    "runnerUser",
    "source",
    "stagingProof",
    "runtimeAttestation",
    "coordination",
    "signing",
    "target",
    "maximumArchiveBytes",
    "maximumSourceExtractedBytes",
    "maximumSourceEntries",
    "maximumDependencyArchiveBytes",
    "maximumDependencyExtractedBytes",
    "maximumDependencyEntries",
  ], "publisher policy");
  if (policy.schemaVersion !== 1 || policy.kind !== CRM_NATIVE_PUBLISHER_POLICY_KIND) {
    fail("publisher policy schema is unsupported");
  }
  positiveId(policy.repositoryId, "publisher repository id");
  requiredText(policy.repository, "publisher repository", /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/, { max: 256 });
  if (policy.repository !== "jubenitogarcia/skincos") fail("publisher repository differs");
  if (policy.runnerUser !== "skincos-actions") fail("publisher runner user differs");

  const source = exactObject(policy.source, [
    "sourceSha",
    "sourceTree",
    "sourceArchiveSha256",
    "sourceArchiveBytes",
    "artifactName",
    "artifactRunId",
  ], "publisher source");
  const sourceSha = sha(source.sourceSha, "publisher source SHA");
  sha(source.sourceTree, "publisher source tree");
  digest(source.sourceArchiveSha256, "publisher source archive digest");
  if (!Number.isSafeInteger(source.sourceArchiveBytes) || source.sourceArchiveBytes < 1 || source.sourceArchiveBytes > MAX_ARCHIVE_BYTES) {
    fail("publisher source archive size is invalid");
  }
  if (source.artifactName !== `release-source-${sourceSha}`) fail("publisher artifact name differs");
  positiveId(source.artifactRunId, "publisher artifact run id");

  const stagingProof = exactObject(policy.stagingProof, [
    "sourceSha",
    "sourceArchiveSha256",
    "receiptSha256",
  ], "publisher staging proof");
  if (
    sha(stagingProof.sourceSha, "staging proof source SHA") !== source.sourceSha
    || digest(stagingProof.sourceArchiveSha256, "staging proof source archive digest") !== source.sourceArchiveSha256
  ) fail("publisher staging proof differs from the selected source");
  digest(stagingProof.receiptSha256, "staging proof receipt digest");

  const runtimeAttestation = exactObject(policy.runtimeAttestation, [
    "receiptSha256",
    "mediaRouteMode",
  ], "publisher runtime attestation");
  digest(runtimeAttestation.receiptSha256, "publisher runtime attestation digest");
  if (runtimeAttestation.mediaRouteMode !== "disabled" && runtimeAttestation.mediaRouteMode !== "enabled") {
    fail("publisher media route mode is invalid");
  }

  const coordination = exactObject(policy.coordination, ["resource", "module"], "publisher coordination policy");
  if (coordination.resource !== "release:crm-native" || coordination.module !== "crm-native") {
    fail("publisher coordination policy differs from the fixed CRM release fence");
  }

  const signing = exactObject(policy.signing, ["keyId", "publicKeyPem"], "publisher signing policy");
  requiredText(signing.keyId, "publisher signing key id", KEY_ID, { max: 64 });
  const publicKeyPem = requiredPublicKeyPem(signing.publicKeyPem);
  try {
    const key = crypto.createPublicKey(publicKeyPem);
    if (key.asymmetricKeyType !== "ed25519") fail("publisher signing public key is not Ed25519");
  } catch (error) {
    if (error instanceof CrmNativePublisherContractError) throw error;
    fail("publisher signing public key is invalid");
  }
  assertFixedTarget(policy.target);
  if (!Number.isSafeInteger(policy.maximumArchiveBytes)
    || policy.maximumArchiveBytes < 16 * 1024 * 1024
    || policy.maximumArchiveBytes > MAX_ARCHIVE_BYTES) {
    fail("publisher maximum archive size is invalid");
  }
  if (!Number.isSafeInteger(policy.maximumSourceExtractedBytes)
    || policy.maximumSourceExtractedBytes < 16 * 1024 * 1024
    || policy.maximumSourceExtractedBytes > MAX_ARCHIVE_BYTES) {
    fail("publisher maximum source extracted size is invalid");
  }
  if (!Number.isSafeInteger(policy.maximumSourceEntries)
    || policy.maximumSourceEntries < 100
    || policy.maximumSourceEntries > 500_000) {
    fail("publisher maximum source entry count is invalid");
  }
  if (!Number.isSafeInteger(policy.maximumDependencyArchiveBytes)
    || policy.maximumDependencyArchiveBytes < 1024 * 1024
    || policy.maximumDependencyArchiveBytes > MAX_ARCHIVE_BYTES) {
    fail("publisher maximum dependency archive size is invalid");
  }
  if (!Number.isSafeInteger(policy.maximumDependencyExtractedBytes)
    || policy.maximumDependencyExtractedBytes < 300 * 1024 * 1024
    || policy.maximumDependencyExtractedBytes > MAX_ARCHIVE_BYTES) {
    fail("publisher maximum dependency extracted size is invalid");
  }
  if (!Number.isSafeInteger(policy.maximumDependencyEntries)
    || policy.maximumDependencyEntries < 10_000
    || policy.maximumDependencyEntries > 500_000) {
    fail("publisher maximum dependency entry count is invalid");
  }
  if (source.sourceArchiveBytes > policy.maximumArchiveBytes) {
    fail("publisher source archive exceeds the policy limit");
  }
  return policy;
}

export function canonicalAuthorizationClaims(claims) {
  const value = exactObject(claims, AUTHORIZATION_CLAIM_FIELDS, "publisher authorization claims");
  return canonicalJson(Object.fromEntries(AUTHORIZATION_CLAIM_FIELDS.map((field) => [field, value[field]])));
}

function validateClaims(claims, policy, now) {
  const value = exactObject(claims, AUTHORIZATION_CLAIM_FIELDS, "publisher authorization claims");
  if (
    value.schemaVersion !== 1
    || value.domain !== CRM_NATIVE_PUBLISHER_DOMAIN
    || value.operation !== "publish"
    || value.workflowPath !== CRM_NATIVE_PUBLISHER_WORKFLOW
    || value.workflowJob !== "publish"
    || value.githubRef !== "refs/heads/main"
    || value.target !== CRM_NATIVE_PUBLISHER_TARGET
    || value.service !== CRM_NATIVE_PUBLISHER_SERVICE
    || value.runAttempt !== "1"
    || value.singleUse !== true
  ) fail("publisher authorization claims differ from the fixed operation");
  requiredText(value.authorizationId, "publisher authorization id", UUID, { max: 36 });
  if (digest(value.policySha256, "publisher authorization policy digest") !== publisherPolicySha256(policy)) {
    fail("publisher authorization policy digest differs");
  }
  digest(value.coordinationProofSha256, "publisher authorization coordination proof digest");
  if (
    positiveId(value.repositoryId, "publisher authorization repository id") !== String(policy.repositoryId)
    || requiredText(value.repository, "publisher authorization repository", /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/, { max: 256 }) !== policy.repository
    || sha(value.sourceSha, "publisher authorization source SHA") !== policy.source.sourceSha
    || sha(value.sourceTree, "publisher authorization source tree") !== policy.source.sourceTree
    || digest(value.sourceArchiveSha256, "publisher authorization source archive digest") !== policy.source.sourceArchiveSha256
    || value.sourceArchiveBytes !== policy.source.sourceArchiveBytes
    || value.artifactName !== policy.source.artifactName
    || positiveId(value.sourceArtifactRunId, "publisher authorization source artifact run id") !== String(policy.source.artifactRunId)
    || digest(value.stagingProofSha256, "publisher authorization staging proof digest") !== policy.stagingProof.receiptSha256
    || digest(value.runtimeAttestationSha256, "publisher authorization runtime attestation digest") !== policy.runtimeAttestation.receiptSha256
    || value.coordinationResource !== policy.coordination.resource
    || value.coordinationModule !== policy.coordination.module
    || !UUID.test(requiredText(value.coordinationLeaseId, "publisher authorization coordination lease id", UUID, { max: 36 }))
    || !Number.isSafeInteger(value.coordinationFencingToken)
    || value.coordinationFencingToken < 1
    || !DIGEST.test(requiredText(value.coordinationIntentDigest, "publisher authorization coordination intent digest", DIGEST, { max: 64 }))
  ) fail("publisher authorization does not bind the approved candidate");
  if (!Number.isSafeInteger(value.dependencyArchiveBytes)
    || value.dependencyArchiveBytes < 1
    || value.dependencyArchiveBytes > policy.maximumDependencyArchiveBytes) {
    fail("publisher authorization dependency archive size is invalid");
  }
  digest(value.dependencyArchiveSha256, "publisher authorization dependency archive digest");
  if (!Number.isSafeInteger(value.dependencyManifestBytes)
    || value.dependencyManifestBytes < 2
    || value.dependencyManifestBytes > MAX_DEPENDENCY_MANIFEST_BYTES) {
    fail("publisher authorization dependency manifest size is invalid");
  }
  digest(value.dependencyManifestSha256, "publisher authorization dependency manifest digest");
  positiveId(value.workflowRunId, "publisher authorization workflow run id");
  digest(value.incumbentStateSha256, "publisher authorization incumbent digest");
  const issuedAt = strictIso(value.issuedAt, "publisher authorization issued at");
  const expiresAt = strictIso(value.expiresAt, "publisher authorization expiry");
  if (!(now instanceof Date) || Number.isNaN(now.getTime())) fail("publisher authorization verification time is invalid");
  if (issuedAt.getTime() > now.getTime()
    || expiresAt.getTime() <= now.getTime()
    || expiresAt.getTime() - issuedAt.getTime() > MAX_AUTHORIZATION_TTL_MS) {
    fail("publisher authorization is expired or outside its bounded lifetime");
  }
  return value;
}

function validateCoordinationProof(value, claims) {
  if (!isObject(value)) fail("publisher coordination proof is invalid");
  let canonical;
  try {
    canonical = canonicalJson(value);
  } catch {
    fail("publisher coordination proof is invalid");
  }
  if (canonical.length < 2 || canonical.length > 64 * 1024
    || sha256Hex(canonical) !== claims.coordinationProofSha256) {
    fail("publisher coordination proof differs");
  }
  return value;
}

export function signPublisherAuthorization({ claims, privateKeyPem, keyId, coordinationProof }) {
  requiredPrivateKeyPem(privateKeyPem);
  requiredText(keyId, "publisher signing key id", KEY_ID, { max: 64 });
  let key;
  try {
    key = crypto.createPrivateKey(privateKeyPem);
    if (key.asymmetricKeyType !== "ed25519") fail("publisher signing private key is not Ed25519");
  } catch (error) {
    if (error instanceof CrmNativePublisherContractError) throw error;
    fail("publisher signing private key is invalid");
  }
  const canonical = canonicalAuthorizationClaims(claims);
  const proof = validateCoordinationProof(coordinationProof, claims);
  return {
    schemaVersion: 1,
    claims,
    coordinationProof: proof,
    signature: {
      algorithm: "Ed25519",
      keyId,
      valueBase64url: crypto.sign(null, Buffer.from(canonical), key).toString("base64url"),
    },
  };
}

export function verifyPublisherAuthorization(document, { policy, now = new Date() } = {}) {
  const trustedPolicy = validatePublisherPolicy(policy);
  const value = exactObject(document, ["schemaVersion", "claims", "coordinationProof", "signature"], "publisher authorization");
  if (value.schemaVersion !== 1) fail("publisher authorization schema is unsupported");
  const claims = validateClaims(value.claims, trustedPolicy, now);
  validateCoordinationProof(value.coordinationProof, claims);
  const signature = exactObject(value.signature, ["algorithm", "keyId", "valueBase64url"], "publisher authorization signature");
  if (signature.algorithm !== "Ed25519" || signature.keyId !== trustedPolicy.signing.keyId) {
    fail("publisher authorization signing key differs");
  }
  const signatureBytes = Buffer.from(requiredText(signature.valueBase64url, "publisher authorization signature", /^[A-Za-z0-9_-]{86}$/, { max: 86 }), "base64url");
  if (signatureBytes.length !== 64) fail("publisher authorization signature is invalid");
  let valid = false;
  try {
    valid = crypto.verify(null, Buffer.from(canonicalAuthorizationClaims(claims)), trustedPolicy.signing.publicKeyPem, signatureBytes);
  } catch {
    valid = false;
  } finally {
    signatureBytes.fill(0);
  }
  if (!valid) fail("publisher authorization signature is invalid");
  return claims;
}
