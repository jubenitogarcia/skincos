import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SHA = /^[0-9a-f]{40}$/;
const SHA256 = /^[0-9a-f]{64}$/;
const CUSTODY_REF = /^vault:v1:[A-Za-z0-9_-]{43}$/;
const TARGETS = new Set(["staging", "production"]);
const FINGERPRINT_PREFIX = Buffer.from("skincos/ponto/root-commitment/v1\0", "utf8");
const KEY_COMMITMENT_PREFIX = Buffer.from("skincos/ponto/attestation-key-version/v1\0", "utf8");
const ROOT_KEYS = [
  "algorithm",
  "attestationKeyCommitment",
  "attestationKeyId",
  "credentialsIncluded",
  "distinctFromStaging",
  "distinctWithinTarget",
  "idempotencyCustodyRef",
  "idempotencyDigest",
  "piiIncluded",
  "profileCustodyRef",
  "profileDigest",
  "releaseSha",
  "schemaVersion",
  "target",
];
const PROVENANCE_KEYS = [
  "artifactDigest",
  "artifactId",
  "artifactName",
  "attestationSha256",
  "coordinatorRunId",
  "repository",
  "workflowPath",
  "workflowRunId",
];

function requireRoot(value, name) {
  const text = String(value || "");
  if (
    Buffer.byteLength(text, "utf8") < 32
    || text !== text.trim()
    || /[\r\n\0]/.test(text)
  ) {
    throw new Error(`${name} must contain at least 32 UTF-8 bytes and no surrounding/control whitespace`);
  }
  return Buffer.from(text, "utf8");
}

function sameBuffer(left, right) {
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}

export function rootFingerprint(value, attestationKey) {
  const root = requireRoot(value, "root");
  const key = requireRoot(attestationKey, "PONTO_ROOT_ATTESTATION_KEY_SHARED");
  return crypto.createHmac("sha256", key).update(FINGERPRINT_PREFIX).update(root).digest("hex");
}

export function attestationKeyCommitment(attestationKey) {
  const key = requireRoot(attestationKey, "PONTO_ROOT_ATTESTATION_KEY_SHARED");
  return crypto.createHmac("sha256", key).update(KEY_COMMITMENT_PREFIX).digest("hex");
}

export function rootCustodyPayloadDigest(attestation) {
  if (!attestation || typeof attestation !== "object" || Array.isArray(attestation)) {
    throw new Error("root custody attestation must be an object");
  }
  const expectedKeys = attestation.provenance === undefined
    ? ROOT_KEYS
    : [...ROOT_KEYS, "provenance"].sort();
  if (Object.keys(attestation).sort().join(",") !== expectedKeys.join(",")) {
    throw new Error("root custody attestation contains unknown or missing fields");
  }
  const payload = { ...attestation };
  delete payload.provenance;
  return crypto.createHash("sha256")
    .update(`${JSON.stringify(payload, null, 2)}\n`)
    .digest("hex");
}

export function validateRootCustody(attestation, {
  target,
  releaseSha,
  requireStagingSeparation = target === "production",
  requireProvenance = false,
  repository,
} = {}) {
  if (!attestation || typeof attestation !== "object" || Array.isArray(attestation)) {
    throw new Error("root custody attestation must be an object");
  }
  const expectedKeys = attestation.provenance === undefined
    ? ROOT_KEYS
    : [...ROOT_KEYS, "provenance"].sort();
  if (Object.keys(attestation).sort().join(",") !== expectedKeys.join(",")) {
    throw new Error("root custody attestation contains unknown or missing fields");
  }
  if (attestation.schemaVersion !== 1) throw new Error("root custody schemaVersion is invalid");
  if (!TARGETS.has(attestation.target) || (target && attestation.target !== target)) {
    throw new Error("root custody target differs");
  }
  if (!SHA.test(String(attestation.releaseSha || "")) || (releaseSha && attestation.releaseSha !== releaseSha)) {
    throw new Error("root custody release SHA differs");
  }
  for (const name of ["profileDigest", "idempotencyDigest", "attestationKeyCommitment"]) {
    if (!SHA256.test(String(attestation[name] || ""))) throw new Error(`${name} is invalid`);
  }
  for (const name of ["profileCustodyRef", "idempotencyCustodyRef", "attestationKeyId"]) {
    if (!CUSTODY_REF.test(String(attestation[name] || ""))) throw new Error(`${name} is invalid`);
  }
  if (
    attestation.profileDigest === attestation.idempotencyDigest
    || attestation.profileCustodyRef === attestation.idempotencyCustodyRef
    || attestation.distinctWithinTarget !== true
    || attestation.credentialsIncluded !== false
    || attestation.piiIncluded !== false
    || attestation.algorithm !== "hmac-sha256-v2"
  ) {
    throw new Error("root custody separation contract is invalid");
  }
  if (requireStagingSeparation && attestation.distinctFromStaging !== true) {
    throw new Error("production roots are not attested distinct from staging");
  }
  if (attestation.target === "staging" && attestation.distinctFromStaging !== null) {
    throw new Error("staging root custody cannot claim a cross-environment comparison");
  }
  if (requireProvenance || attestation.provenance !== undefined) {
    const provenance = attestation.provenance;
    if (!provenance || typeof provenance !== "object" || Array.isArray(provenance)) {
      throw new Error("root custody durable provenance is absent");
    }
    if (
      Object.keys(provenance).sort().join(",") !== PROVENANCE_KEYS.join(",")
      || !/^[0-9]+$/.test(String(provenance.workflowRunId || ""))
      || !/^[0-9]+$/.test(String(provenance.coordinatorRunId || ""))
      || !/^[0-9]+$/.test(String(provenance.artifactId || ""))
      || !SHA256.test(String(provenance.artifactDigest || ""))
      || !SHA256.test(String(provenance.attestationSha256 || ""))
      || provenance.attestationSha256 !== rootCustodyPayloadDigest(attestation)
      || provenance.workflowPath !== ".github/workflows/cloudflare-workers-sync-ponto-secrets.yml"
      || provenance.artifactName !== `ponto-root-custody-${attestation.target}-${attestation.releaseSha}`
      || typeof provenance.repository !== "string"
      || !provenance.repository.includes("/")
      || (repository && provenance.repository !== repository)
    ) {
      throw new Error("root custody durable provenance is invalid");
    }
  }
  return attestation;
}

export function createRootCustody({
  target,
  releaseSha,
  profileRoot,
  idempotencyRoot,
  attestationKey,
  profileCustodyRef,
  idempotencyCustodyRef,
  attestationKeyId,
  stagingAttestation = null,
}) {
  if (!TARGETS.has(target)) throw new Error("target must be staging or production");
  if (!SHA.test(String(releaseSha || ""))) throw new Error("releaseSha must be a full lowercase SHA");
  const profile = requireRoot(profileRoot, "PONTO_PROFILE_DATA_KEY");
  const idempotency = requireRoot(idempotencyRoot, "PONTO_IDEMPOTENCY_KEY");
  const auditKey = requireRoot(attestationKey, "PONTO_ROOT_ATTESTATION_KEY_SHARED");
  for (const [name, value] of Object.entries({
    profileCustodyRef,
    idempotencyCustodyRef,
    attestationKeyId,
  })) {
    if (!CUSTODY_REF.test(String(value || ""))) throw new Error(`${name} must be an opaque approved vault reference`);
  }
  if (profileCustodyRef === idempotencyCustodyRef) {
    throw new Error("application roots require different approved vault references");
  }
  if (sameBuffer(profile, idempotency)) {
    throw new Error("profile and idempotency roots must be distinct and non-reused");
  }
  if (sameBuffer(profile, auditKey) || sameBuffer(idempotency, auditKey)) {
    throw new Error("root attestation key must be distinct from application roots");
  }
  const currentDigests = [
    crypto.createHmac("sha256", auditKey).update(FINGERPRINT_PREFIX).update(profile).digest("hex"),
    crypto.createHmac("sha256", auditKey).update(FINGERPRINT_PREFIX).update(idempotency).digest("hex"),
  ];
  const currentKeyCommitment = attestationKeyCommitment(auditKey);
  let distinctFromStaging = null;
  if (target === "production") {
    const prior = validateRootCustody(stagingAttestation, {
      target: "staging",
      releaseSha,
      requireStagingSeparation: false,
    });
    const priorDigests = new Set([prior.profileDigest, prior.idempotencyDigest]);
    if (currentDigests.some(digest => priorDigests.has(digest))) {
      throw new Error("production roots must be distinct and non-reused across staging");
    }
    const priorRefs = new Set([prior.profileCustodyRef, prior.idempotencyCustodyRef]);
    if (
      [profileCustodyRef, idempotencyCustodyRef].some(reference => priorRefs.has(reference))
      || prior.attestationKeyId !== attestationKeyId
      || prior.attestationKeyCommitment !== currentKeyCommitment
    ) {
      throw new Error("production custody references must be distinct and use the exact same shared attestation key version");
    }
    distinctFromStaging = true;
  }
  return validateRootCustody({
    schemaVersion: 1,
    target,
    releaseSha,
    profileDigest: currentDigests[0],
    idempotencyDigest: currentDigests[1],
    attestationKeyCommitment: currentKeyCommitment,
    profileCustodyRef,
    idempotencyCustodyRef,
    attestationKeyId,
    distinctWithinTarget: true,
    distinctFromStaging,
    algorithm: "hmac-sha256-v2",
    credentialsIncluded: false,
    piiIncluded: false,
  }, { target, releaseSha });
}

const isMain = process.argv[1]
  && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));
if (isMain) {
  const [mode, target, releaseSha, outputFile, stagingFile] = process.argv.slice(2);
  if (mode === "write") {
    const stagingAttestation = stagingFile
      ? JSON.parse(fs.readFileSync(stagingFile, "utf8"))
      : null;
    const attestation = createRootCustody({
      target,
      releaseSha,
      profileRoot: process.env.PONTO_PROFILE_DATA_KEY,
      idempotencyRoot: process.env.PONTO_IDEMPOTENCY_KEY,
      attestationKey: process.env.PONTO_ROOT_ATTESTATION_KEY_SHARED,
      profileCustodyRef: process.env.PONTO_PROFILE_DATA_KEY_CUSTODY_REF,
      idempotencyCustodyRef: process.env.PONTO_IDEMPOTENCY_KEY_CUSTODY_REF,
      attestationKeyId: process.env.PONTO_ROOT_ATTESTATION_KEY_ID,
      stagingAttestation,
    });
    fs.mkdirSync(path.dirname(outputFile), { recursive: true });
    fs.writeFileSync(outputFile, `${JSON.stringify(attestation, null, 2)}\n`, { mode: 0o600 });
    process.stdout.write(`Ponto root custody attested for ${target}; values were not printed\n`);
  } else if (mode === "verify") {
    validateRootCustody(JSON.parse(fs.readFileSync(outputFile, "utf8")), { target, releaseSha });
    process.stdout.write(`Ponto root custody verified for ${target}\n`);
  } else {
    throw new Error("usage: ponto-root-custody.mjs <write|verify> <target> <release_sha> <file> [staging_file]");
  }
}
