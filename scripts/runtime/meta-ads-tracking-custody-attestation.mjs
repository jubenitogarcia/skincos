#!/usr/bin/env node
// Root-side verifier for the Meta Ads native custody bridge.  GitHub Actions
// sends an OIDC JWT only over stdin; this program verifies the fixed issuer,
// audience and deployment provenance before issuing a short-lived, root-owned
// approval record.  It deliberately accepts neither a caller-selected JWKS
// URL nor a caller-selected runtime path.
import crypto from "node:crypto";
import fs from "node:fs";
import https from "node:https";
import path from "node:path";
import { pathToFileURL } from "node:url";

export const META_ADS_CUSTODY_OIDC_ISSUER = "https://token.actions.githubusercontent.com";
export const META_ADS_CUSTODY_OIDC_JWKS_URL = "https://token.actions.githubusercontent.com/.well-known/jwks";
// GitHub's `sha` claim identifies the checked-out workflow source.  A
// production promotion may deliberately apply a previously approved immutable
// main ancestor, so it is not necessarily equal to the candidate release.
// Bind that candidate cryptographically through a per-release OIDC audience
// instead.  This prevents a JWT minted for one staged release from approving
// another one without making approved ancestor promotions impossible.
export const META_ADS_CUSTODY_OIDC_AUDIENCE_PREFIX = "skincos-meta-ads-tracking-custody/v1/release";
export const META_ADS_CUSTODY_REPOSITORY = "jubenitogarcia/skincos";
export const META_ADS_CUSTODY_REPOSITORY_ID = "1060913632";
export const META_ADS_CUSTODY_WORKFLOW_REF = "jubenitogarcia/skincos/.github/workflows/deploy-token-vault.yml@refs/heads/main";
export const META_ADS_CUSTODY_APPROVAL_ROOT = "/var/lib/skincos-runtime/global-coordination/meta-ads-tracking-approvals";

const FULL_SHA = /^[0-9a-f]{40}$/;
const POSITIVE_ID = /^[1-9][0-9]{0,19}$/;
const BASE64URL = /^[A-Za-z0-9_-]+$/;
const MAX_TOKEN_BYTES = 24 * 1024;
const MAX_JWKS_BYTES = 64 * 1024;
const CLOCK_SKEW_SECONDS = 60;
const MAX_TOKEN_LIFETIME_SECONDS = 10 * 60;
const APPROVAL_SCHEMA_VERSION = 2;

const error = (code) => Object.assign(new Error(`meta_ads_custody_attestation:${code}`), { code });
const fail = (code) => { throw error(code); };

const isPlainObject = (value) => Boolean(value) && typeof value === "object" && !Array.isArray(value);

const strictText = (value, code, pattern, { min = 1, max = 4096 } = {}) => {
  if (typeof value !== "string" || value.length < min || value.length > max || value.includes("\r") || value.includes("\n")) {
    fail(code);
  }
  if (pattern && !pattern.test(value)) fail(code);
  return value;
};

export const custodyOidcAudience = (releaseSha) => {
  const normalizedRelease = strictText(releaseSha, "release_sha_invalid", FULL_SHA, { max: 40 });
  return `${META_ADS_CUSTODY_OIDC_AUDIENCE_PREFIX}/${normalizedRelease}`;
};

const exactKeys = (value, expected, code) => {
  if (!isPlainObject(value)) fail(code);
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  if (JSON.stringify(actual) !== JSON.stringify(wanted)) fail(code);
  return value;
};

const decimal = (value, code) => {
  const normalized = typeof value === "number"
    ? (Number.isSafeInteger(value) ? String(value) : "")
    : value;
  return strictText(normalized, code, POSITIVE_ID, { max: 20 });
};

const unixTime = (value, code) => {
  if (!Number.isSafeInteger(value) || value < 1 || value > 4_102_444_800) fail(code);
  return value;
};

const nowSeconds = (now = new Date()) => {
  const millis = now instanceof Date ? now.getTime() : new Date(now).getTime();
  if (!Number.isFinite(millis)) fail("clock_invalid");
  return Math.floor(millis / 1000);
};

const base64url = (value, code) => {
  strictText(value, code, BASE64URL, { max: MAX_TOKEN_BYTES });
  try {
    const padding = "=".repeat((4 - (value.length % 4)) % 4);
    return Buffer.from(value.replace(/-/g, "+").replace(/_/g, "/") + padding, "base64");
  } catch {
    fail(code);
  }
};

const base64urlJson = (value, code) => {
  try {
    const parsed = JSON.parse(base64url(value, code).toString("utf8"));
    if (!isPlainObject(parsed)) fail(code);
    return parsed;
  } catch (caught) {
    if (caught?.code) throw caught;
    fail(code);
  }
};

const strictJwt = (token) => {
  strictText(token, "oidc_token_invalid", /^[A-Za-z0-9_.-]+$/, { min: 32, max: MAX_TOKEN_BYTES });
  const parts = token.split(".");
  if (parts.length !== 3 || parts.some((part) => !BASE64URL.test(part))) fail("oidc_token_invalid");
  const header = base64urlJson(parts[0], "oidc_header_invalid");
  const payload = base64urlJson(parts[1], "oidc_claims_invalid");
  if (header.alg !== "RS256") fail("oidc_algorithm_invalid");
  strictText(header.kid, "oidc_key_id_invalid", /^[A-Za-z0-9._:-]+$/, { max: 256 });
  if (typeof header.typ !== "undefined" && header.typ !== "JWT") fail("oidc_header_invalid");
  return { parts, header, payload, signature: base64url(parts[2], "oidc_signature_invalid") };
};

export async function fetchGithubOidcJwks() {
  return new Promise((resolve, reject) => {
    const request = https.request(META_ADS_CUSTODY_OIDC_JWKS_URL, {
      method: "GET",
      headers: { accept: "application/json", "user-agent": "skincos-meta-ads-custody/1" },
      rejectUnauthorized: true,
      timeout: 5_000,
    }, (response) => {
      if (response.statusCode !== 200) {
        response.resume();
        reject(error("oidc_jwks_unavailable"));
        return;
      }
      const chunks = [];
      let size = 0;
      response.on("data", (chunk) => {
        size += chunk.length;
        if (size > MAX_JWKS_BYTES) {
          response.destroy(error("oidc_jwks_invalid"));
          return;
        }
        chunks.push(chunk);
      });
      response.on("error", () => reject(error("oidc_jwks_unavailable")));
      response.on("end", () => {
        try {
          if (size < 16) fail("oidc_jwks_invalid");
          resolve(JSON.parse(Buffer.concat(chunks).toString("utf8")));
        } catch (caught) {
          reject(caught?.code ? caught : error("oidc_jwks_invalid"));
        }
      });
    });
    request.on("timeout", () => request.destroy(error("oidc_jwks_unavailable")));
    request.on("error", () => reject(error("oidc_jwks_unavailable")));
    request.end();
  });
}

const verificationKey = (jwks, header) => {
  if (!isPlainObject(jwks) || !Array.isArray(jwks.keys) || jwks.keys.length < 1 || jwks.keys.length > 32) {
    fail("oidc_jwks_invalid");
  }
  const matches = jwks.keys.filter((candidate) => isPlainObject(candidate) && candidate.kid === header.kid);
  if (matches.length !== 1) fail("oidc_key_unavailable");
  const key = matches[0];
  if (key.kty !== "RSA" || key.alg !== "RS256" || key.use !== "sig") fail("oidc_key_invalid");
  strictText(key.n, "oidc_key_invalid", BASE64URL, { min: 256, max: 2048 });
  strictText(key.e, "oidc_key_invalid", BASE64URL, { min: 2, max: 32 });
  try {
    const publicKey = crypto.createPublicKey({ key: { kty: "RSA", n: key.n, e: key.e }, format: "jwk" });
    if (publicKey.asymmetricKeyType !== "rsa" || Number(publicKey.asymmetricKeyDetails?.modulusLength || 0) < 2048) {
      fail("oidc_key_invalid");
    }
    return publicKey;
  } catch (caught) {
    if (caught?.code) throw caught;
    fail("oidc_key_invalid");
  }
};

const exactAudience = (value, releaseSha) => {
  const expected = custodyOidcAudience(releaseSha);
  if (typeof value === "string") return value === expected;
  return Array.isArray(value) && value.length === 1 && value[0] === expected;
};

const validateClaims = (payload, { releaseSha, runId, runAttempt, now }) => {
  if (!isPlainObject(payload)) fail("oidc_claims_invalid");
  strictText(releaseSha, "release_sha_invalid", FULL_SHA, { max: 40 });
  decimal(runId, "run_identity_invalid");
  if (decimal(runAttempt, "run_identity_invalid") !== "1") fail("workflow_rerun_forbidden");
  if (payload.iss !== META_ADS_CUSTODY_OIDC_ISSUER) fail("oidc_provenance_invalid");
  if (!exactAudience(payload.aud, releaseSha)) fail("oidc_release_binding_invalid");
  if (
    payload.repository !== META_ADS_CUSTODY_REPOSITORY
    || decimal(payload.repository_id, "oidc_provenance_invalid") !== META_ADS_CUSTODY_REPOSITORY_ID
    || payload.ref !== "refs/heads/main"
    || payload.ref_type !== "branch"
    || payload.environment !== "production"
    || payload.event_name !== "workflow_dispatch"
    || payload.runner_environment !== "self-hosted"
    || payload.workflow_ref !== META_ADS_CUSTODY_WORKFLOW_REF
  ) fail("oidc_provenance_invalid");
  const claimRunId = decimal(payload.run_id, "oidc_provenance_invalid");
  const claimAttempt = decimal(payload.run_attempt, "oidc_provenance_invalid");
  if (claimRunId !== runId || claimAttempt !== runAttempt || claimAttempt !== "1") fail("oidc_run_identity_invalid");
  const workflowSha = strictText(payload.workflow_sha, "oidc_provenance_invalid", FULL_SHA, { max: 40 });
  const sourceSha = strictText(payload.sha, "oidc_provenance_invalid", FULL_SHA, { max: 40 });
  const issuedAt = unixTime(payload.iat, "oidc_time_invalid");
  const notBefore = unixTime(payload.nbf, "oidc_time_invalid");
  const expiresAt = unixTime(payload.exp, "oidc_time_invalid");
  if (
    notBefore > now + CLOCK_SKEW_SECONDS
    || issuedAt > now + CLOCK_SKEW_SECONDS
    || expiresAt <= now - CLOCK_SKEW_SECONDS
    || expiresAt <= issuedAt
    || expiresAt - issuedAt > MAX_TOKEN_LIFETIME_SECONDS
  ) fail("oidc_time_invalid");
  return {
    schemaVersion: APPROVAL_SCHEMA_VERSION,
    releaseSha,
    runId,
    runAttempt: Number(runAttempt),
    repository: META_ADS_CUSTODY_REPOSITORY,
    repositoryId: META_ADS_CUSTODY_REPOSITORY_ID,
    workflowRef: META_ADS_CUSTODY_WORKFLOW_REF,
    workflowSha,
    sourceSha,
    audience: custodyOidcAudience(releaseSha),
    issuedAt,
    expiresAt,
  };
};

export async function verifyGithubOidcAttestation({ token, releaseSha, runId, runAttempt, now = new Date(), fetchJwks = fetchGithubOidcJwks }) {
  const jwt = strictJwt(token);
  const signingInput = Buffer.from(`${jwt.parts[0]}.${jwt.parts[1]}`, "ascii");
  const publicKey = verificationKey(await fetchJwks(), jwt.header);
  if (!crypto.verify("RSA-SHA256", signingInput, publicKey, jwt.signature)) fail("oidc_signature_invalid");
  return validateClaims(jwt.payload, { releaseSha, runId, runAttempt, now: nowSeconds(now) });
}

export function assertApprovalDirectory(directory = META_ADS_CUSTODY_APPROVAL_ROOT, { ownerUid = 0, ownerGid = 0, mode = 0o700 } = {}) {
  const resolved = path.resolve(directory);
  let metadata;
  let real;
  try {
    metadata = fs.lstatSync(resolved);
    real = fs.realpathSync(resolved);
  } catch {
    fail("approval_directory_unavailable");
  }
  if (!metadata.isDirectory() || metadata.isSymbolicLink() || real !== resolved || metadata.uid !== ownerUid || metadata.gid !== ownerGid || (metadata.mode & 0o777) !== mode) {
    fail("approval_directory_metadata_invalid");
  }
  return resolved;
}

export function approvalRecordPath({ releaseSha, runId, runAttempt }, { directory = META_ADS_CUSTODY_APPROVAL_ROOT } = {}) {
  strictText(releaseSha, "release_sha_invalid", FULL_SHA, { max: 40 });
  const normalizedRunId = decimal(runId, "run_identity_invalid");
  const normalizedAttempt = decimal(runAttempt, "run_identity_invalid");
  const target = path.resolve(directory, `approval-v2-${releaseSha}-${normalizedRunId}-${normalizedAttempt}.json`);
  if (path.dirname(target) !== path.resolve(directory)) fail("approval_path_invalid");
  return target;
}

const assertOwnedRegular = (file, { ownerUid = 0, ownerGid = 0, mode = 0o600 } = {}) => {
  let metadata;
  let real;
  try {
    metadata = fs.lstatSync(file);
    real = fs.realpathSync(file);
  } catch {
    fail("approval_unavailable");
  }
  if (!metadata.isFile() || metadata.isSymbolicLink() || real !== file || metadata.uid !== ownerUid || metadata.gid !== ownerGid || (metadata.mode & 0o777) !== mode) {
    fail("approval_metadata_invalid");
  }
};

const readOwnedApproval = (file, options) => {
  assertOwnedRegular(file, options);
  let descriptor;
  try {
    descriptor = fs.openSync(file, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0));
    const before = fs.lstatSync(file);
    const opened = fs.fstatSync(descriptor);
    if (
      before.dev !== opened.dev
      || before.ino !== opened.ino
      || !opened.isFile()
      || opened.uid !== options.ownerUid
      || opened.gid !== options.ownerGid
      || (opened.mode & 0o777) !== (options.mode || 0o600)
    ) fail("approval_race_detected");
    return fs.readFileSync(descriptor, "utf8");
  } finally {
    if (descriptor !== undefined) fs.closeSync(descriptor);
  }
};

const validateApprovalRecord = (value, expected, now) => {
  exactKeys(value, [
    "schemaVersion", "releaseSha", "runId", "runAttempt", "repository", "repositoryId", "workflowRef", "workflowSha", "sourceSha", "audience", "issuedAt", "expiresAt",
  ], "approval_record_invalid");
  const releaseSha = strictText(value.releaseSha, "approval_record_invalid", FULL_SHA, { max: 40 });
  const runId = decimal(value.runId, "approval_record_invalid");
  const runAttempt = decimal(value.runAttempt, "approval_record_invalid");
  if (
    value.schemaVersion !== APPROVAL_SCHEMA_VERSION
    || runAttempt !== "1"
    || releaseSha !== strictText(expected.releaseSha, "approval_record_invalid", FULL_SHA, { max: 40 })
    || runId !== decimal(expected.runId, "approval_record_invalid")
    || runAttempt !== decimal(expected.runAttempt, "approval_record_invalid")
    || value.repository !== META_ADS_CUSTODY_REPOSITORY
    || value.repositoryId !== META_ADS_CUSTODY_REPOSITORY_ID
    || value.workflowRef !== META_ADS_CUSTODY_WORKFLOW_REF
  ) fail("approval_record_invalid");
  strictText(value.workflowSha, "approval_record_invalid", FULL_SHA, { max: 40 });
  strictText(value.sourceSha, "approval_record_invalid", FULL_SHA, { max: 40 });
  if (value.audience !== custodyOidcAudience(releaseSha)) fail("approval_record_invalid");
  const issuedAt = unixTime(value.issuedAt, "approval_record_invalid");
  const expiresAt = unixTime(value.expiresAt, "approval_record_invalid");
  if (expiresAt <= issuedAt || expiresAt - issuedAt > MAX_TOKEN_LIFETIME_SECONDS || expiresAt <= now) fail("approval_expired");
  return value;
};

export function writeRuntimeApproval(approval, { directory = META_ADS_CUSTODY_APPROVAL_ROOT, ownerUid = 0, ownerGid = 0, now = new Date() } = {}) {
  const approvedDirectory = assertApprovalDirectory(directory, { ownerUid, ownerGid });
  const record = validateApprovalRecord(approval, approval, nowSeconds(now));
  const destination = approvalRecordPath(record, { directory: approvedDirectory });
  const temporary = path.resolve(approvedDirectory, `.approval-v2-${process.pid}-${crypto.randomBytes(12).toString("hex")}.tmp`);
  if (path.dirname(temporary) !== approvedDirectory) fail("approval_path_invalid");
  let descriptor;
  try {
    descriptor = fs.openSync(temporary, fs.constants.O_CREAT | fs.constants.O_EXCL | fs.constants.O_WRONLY | (fs.constants.O_NOFOLLOW || 0), 0o600);
    fs.writeFileSync(descriptor, `${JSON.stringify(record)}\n`, "utf8");
    fs.fsyncSync(descriptor);
    const metadata = fs.fstatSync(descriptor);
    if (!metadata.isFile() || metadata.uid !== ownerUid || metadata.gid !== ownerGid || (metadata.mode & 0o777) !== 0o600) fail("approval_metadata_invalid");
  } catch (caught) {
    try { fs.unlinkSync(temporary); } catch {}
    throw caught;
  } finally {
    if (descriptor !== undefined) fs.closeSync(descriptor);
  }
  try {
    fs.renameSync(temporary, destination);
    fs.chownSync(destination, ownerUid, ownerGid);
    fs.chmodSync(destination, 0o600);
    assertOwnedRegular(destination, { ownerUid, ownerGid });
    return destination;
  } catch (caught) {
    try { fs.unlinkSync(temporary); } catch {}
    throw caught;
  }
}

export function readRuntimeApproval({ releaseSha, runId, runAttempt, now = new Date(), directory = META_ADS_CUSTODY_APPROVAL_ROOT, ownerUid = 0, ownerGid = 0 }) {
  const normalizedRelease = strictText(releaseSha, "release_sha_invalid", FULL_SHA, { max: 40 });
  const normalizedRunId = decimal(runId, "run_identity_invalid");
  const normalizedAttempt = decimal(runAttempt, "run_identity_invalid");
  if (normalizedAttempt !== "1") fail("workflow_rerun_forbidden");
  const approvedDirectory = assertApprovalDirectory(directory, { ownerUid, ownerGid });
  const file = approvalRecordPath({ releaseSha: normalizedRelease, runId: normalizedRunId, runAttempt: normalizedAttempt }, { directory: approvedDirectory });
  let value;
  try {
    value = JSON.parse(readOwnedApproval(file, { ownerUid, ownerGid }));
  } catch (caught) {
    if (caught?.code) throw caught;
    fail("approval_record_invalid");
  }
  return validateApprovalRecord(value, {
    releaseSha: normalizedRelease,
    runId: normalizedRunId,
    runAttempt: normalizedAttempt,
  }, nowSeconds(now));
}

const readTokenStdin = () => {
  const input = fs.readFileSync(0);
  try {
    if (input.length < 32 || input.length > MAX_TOKEN_BYTES || input.includes(13)) fail("oidc_input_invalid");
    const value = input.toString("utf8");
    if (!value.endsWith("\n") || value.slice(0, -1).includes("\n")) fail("oidc_input_invalid");
    return value.slice(0, -1);
  } finally {
    input.fill(0);
  }
};

const assertEmptyStdin = () => {
  const input = fs.readFileSync(0);
  try {
    if (input.length !== 0) fail("stdin_record_count_invalid");
  } finally {
    input.fill(0);
  }
};

const assertRoot = () => {
  if (typeof process.getuid !== "function" || process.getuid() !== 0) fail("root_required");
};

const emit = (action, approval) => process.stdout.write(`${JSON.stringify({
  ok: true,
  action,
  releaseSha: approval.releaseSha,
  runId: approval.runId,
  runAttempt: approval.runAttempt,
  approval: "valid",
  approvalExpiresAt: approval.expiresAt,
})}\n`);

async function cli() {
  assertRoot();
  const [action, releaseSha, runId, runAttempt, ...extra] = process.argv.slice(2);
  if (extra.length !== 0) fail("arguments_invalid");
  if (action === "attest") {
    const approval = await verifyGithubOidcAttestation({
      token: readTokenStdin(), releaseSha, runId, runAttempt,
    });
    writeRuntimeApproval(approval);
    emit("attest", approval);
    return;
  }
  if (action === "verify") {
    assertEmptyStdin();
    emit("verify", readRuntimeApproval({ releaseSha, runId, runAttempt }));
    return;
  }
  fail("action_invalid");
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  cli().catch((caught) => {
    const code = typeof caught?.code === "string" && /^[a-z0-9_:-]{1,96}$/.test(caught.code)
      ? caught.code
      : "attestation_invalid";
    process.stderr.write(`meta_ads_custody_attestation=${code}\n`);
    process.exit(78);
  });
}
