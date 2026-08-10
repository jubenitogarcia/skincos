#!/usr/bin/env node
import crypto from "node:crypto";
import {
  buildIntent,
  buildLegacyIntentV1,
  canonicalJson,
  CONTRACT_ID,
  lockScopeFor,
  normalizeResourceKey,
} from "../ops/governance/global-coordination-core.mjs";

const COORDINATION_PATH = "/v1/leases";
const REQUEST_SCHEMA_VERSION = 1;
const NONCE_RE = /^[A-Za-z0-9_-]{32,}$/;
const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,199}$/;
const KEY_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,63}$/;
const LEGACY_KEY_ID = "legacy-v1";
const COORDINATION_PROTOCOL = "epoch-fence-v1";

export function coordinationActiveSecret() {
  const activeKey = String(process.env.SKINCOS_GLOBAL_COORDINATION_ACTIVE_KEY || "").trim();
  const activeKeyId = String(process.env.SKINCOS_GLOBAL_COORDINATION_KEY_ID || "").trim();
  return activeKey && activeKeyId
    ? activeKey
    : process.env.SKINCOS_GLOBAL_COORDINATION_SHARED_SECRET || "";
}

export function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

export function hmac(secret, value) {
  if (!String(secret || "").trim()) throw new Error("global coordination custody is unavailable");
  return crypto.createHmac("sha256", String(secret)).update(value).digest("base64url");
}

export function newRequestNonce() {
  // The coordinator's canonical SAFE_ID deliberately requires an
  // alphanumeric first character. Hex preserves 192 bits of entropy while
  // making every client-generated nonce valid for both current and legacy
  // coordinator implementations.
  return crypto.randomBytes(24).toString("hex");
}

export function buildLeaseRequest({ operation, resource, owner, intent, idempotencyKey, ttlMs }) {
  const normalized = buildIntent({ operation, resource, owner, intent, idempotencyKey });
  return {
    ...normalized,
    ttlMs,
    intentDigest: sha256(canonicalJson(normalized)),
  };
}

// Transitional adapter for a coordinator Worker that predates the explicit
// owner.sessionId digest field. It changes only the request canonicalization;
// the remote coordinator still owns the lease, fencing token, and mutation
// decision. Remove this adapter after every governed plane reports epoch-fence-v1.
export function buildLegacyLeaseRequest({ operation, resource, owner, intent, idempotencyKey, ttlMs }) {
  const normalized = buildLegacyIntentV1({ operation, resource, owner, intent, idempotencyKey });
  return {
    ...normalized,
    ttlMs,
    intentDigest: sha256(canonicalJson(normalized)),
  };
}

function endpointFor(value) {
  let endpoint;
  try {
    endpoint = new URL(String(value || ""));
  } catch {
    throw new Error("global coordinator URL is invalid");
  }
  if (endpoint.protocol !== "https:") throw new Error("global coordinator URL must use HTTPS");
  if (endpoint.pathname === "/" || endpoint.pathname === "") endpoint.pathname = COORDINATION_PATH;
  if (endpoint.pathname !== COORDINATION_PATH) throw new Error("global coordinator URL must target /v1/leases");
  endpoint.search = "";
  endpoint.hash = "";
  return endpoint;
}

function readinessEndpointFor(value) {
  let endpoint;
  try {
    endpoint = new URL(String(value || ""));
  } catch {
    throw new Error("global coordinator URL is invalid");
  }
  if (endpoint.protocol !== "https:") throw new Error("global coordinator URL must use HTTPS");
  endpoint.pathname = "/v1/readyz";
  endpoint.search = "";
  endpoint.hash = "";
  return endpoint;
}

export async function probeCoordinatorProtocol({ url = process.env.SKINCOS_GLOBAL_COORDINATOR_URL, fetchImpl = globalThis.fetch } = {}) {
  if (typeof fetchImpl !== "function") throw new Error("global coordinator readiness probe is unavailable");
  const endpoint = readinessEndpointFor(url);
  const response = await fetchImpl(endpoint, { method: "GET", headers: { accept: "application/json" } });
  if (response.status === 404) {
    return { protocol: "legacy-v1", readiness: "not-supported", httpStatus: 404 };
  }
  const raw = await response.text();
  let payload;
  try { payload = JSON.parse(raw); } catch { throw new Error("global coordinator readiness response JSON is invalid"); }
  if (!response.ok) throw new Error(`global coordinator readiness probe failed closed: HTTP ${response.status}`);
  if (
    payload?.contractId !== CONTRACT_ID
    || payload?.protocol !== COORDINATION_PROTOCOL
    || payload?.ready !== true
    || payload?.coordinationPlane !== "global"
    || !Number.isSafeInteger(payload?.authorityEpoch)
    || payload.authorityEpoch < 1
  ) throw new Error("global coordinator readiness contract is invalid");
  return {
    protocol: COORDINATION_PROTOCOL,
    readiness: "ready",
    authorityEpoch: payload.authorityEpoch,
    httpStatus: response.status,
  };
}

function envelopeFor({ action, request, proof, authorization, ttlMs, reason, nonce, requestedAt }) {
  if (!NONCE_RE.test(String(nonce || ""))) throw new Error("coordination request nonce is invalid");
  const body = {
    schemaVersion: REQUEST_SCHEMA_VERSION,
    contractId: CONTRACT_ID,
    action,
    requestNonce: nonce,
    requestedAt,
  };
  if (["acquire", "gate"].includes(action)) body.request = request;
  else body.proof = proof;
  if (authorization !== undefined) body.authorization = authorization;
  if (action === "renew") body.ttlMs = ttlMs;
  if (action === "revoke") body.reason = reason;
  return body;
}

export function buildAuthenticatedRequest({
  url = process.env.SKINCOS_GLOBAL_COORDINATOR_URL,
  secret = coordinationActiveSecret(),
  adminSecret,
  keyId = process.env.SKINCOS_GLOBAL_COORDINATION_KEY_ID,
  action,
  request,
  proof,
  authorization,
  ttlMs,
  reason,
  nonce = newRequestNonce(),
  requestedAt = new Date().toISOString(),
}) {
  const endpoint = endpointFor(url);
  const body = envelopeFor({ action, request, proof, authorization, ttlMs, reason, nonce, requestedAt });
  const rawBody = canonicalJson(body);
  const requestDigest = sha256(rawBody);
  const binding = {
    schemaVersion: REQUEST_SCHEMA_VERSION,
    contractId: CONTRACT_ID,
    method: "POST",
    path: endpoint.pathname,
    nonce,
    requestedAt,
    requestDigest,
    ...(String(keyId || "").trim() ? { keyId: String(keyId).trim() } : {}),
  };
  const headers = {
    accept: "application/json",
    "content-type": "application/json",
    "x-skincos-coordination-nonce": nonce,
    "x-skincos-coordination-requested-at": requestedAt,
    "x-skincos-coordination-request-digest": requestDigest,
    "x-skincos-coordination-request-signature": hmac(secret, canonicalJson(binding)),
  };
  if (String(keyId || "").trim()) headers["x-skincos-coordination-key-id"] = String(keyId).trim();
  if (action === "revoke") {
    if (!String(adminSecret || "").trim()) throw new Error("global coordination administrative custody is unavailable");
    headers.authorization = `Bearer ${adminSecret}`;
  }
  return {
    endpoint,
    body,
    rawBody,
    requestDigest,
    headers,
  };
}

function responseSecretFor(authority, secretOrOptions) {
  if (typeof secretOrOptions === "string") return secretOrOptions;
  const options = secretOrOptions || {};
  const keyId = String(authority.keyId || options.keyId || "").trim();
  if (keyId && !String(options.keyId || "").trim() && options.secret) return options.secret;
  if (keyId && keyId === String(options.keyId || "").trim()) return options.secret;
  if (keyId && keyId === String(options.previousKeyId || "").trim()) {
    const expiresAt = Date.parse(String(options.previousKeyExpiresAt || ""));
    if (Number.isFinite(expiresAt) && expiresAt <= Date.now()) throw new Error("global coordinator response key grace period expired");
    return options.previousSecret;
  }
  if (!keyId) return options.secret;
  throw new Error("global coordinator response key id is unknown");
}

export function verifyCoordinatorResponse(payload, secretOrOptions) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) throw new Error("global coordinator response is invalid");
  const { authority, responseSignature, ...unsigned } = payload;
  if (
    !authority
    || authority.contractId !== CONTRACT_ID
    || authority.provider !== "cloudflare"
    || !/^[0-9a-f]{64}$/.test(String(authority.responseDigest || ""))
    || !String(responseSignature || "")
  ) throw new Error("global coordinator response authority is invalid");
  if (authority.protocol !== undefined && (
    authority.protocol !== COORDINATION_PROTOCOL
    || !KEY_ID.test(String(authority.keyId || ""))
    || !Number.isSafeInteger(authority.authorityEpoch)
    || authority.authorityEpoch < 1
  )) throw new Error("global coordinator response epoch contract is invalid");
  if (authority.protocol === COORDINATION_PROTOCOL) {
    const expectedKeyId = typeof secretOrOptions === "string"
      ? ""
      : String(secretOrOptions?.keyId || "").trim();
    if (!expectedKeyId && authority.keyId !== LEGACY_KEY_ID) throw new Error("global coordinator response key id is not pinned");
  }
  if (sha256(canonicalJson(unsigned)) !== authority.responseDigest) throw new Error("global coordinator response digest mismatch");
  const expected = hmac(responseSecretFor(authority, secretOrOptions), canonicalJson({ ...unsigned, authority }));
  const actual = Buffer.from(String(responseSignature), "base64url");
  const expectedBytes = Buffer.from(expected, "base64url");
  if (actual.length !== expectedBytes.length || !crypto.timingSafeEqual(actual, expectedBytes)) throw new Error("global coordinator response signature mismatch");
  return unsigned;
}

export function proofForLease(lease) {
  if (!lease || typeof lease !== "object") throw new Error("global coordinator lease is missing");
  return {
    resource: normalizeResourceKey(lease.resource),
    leaseId: String(lease.leaseId || ""),
    fencingToken: lease.fencingToken,
    intentDigest: String(lease.intentDigest || ""),
    ...(lease.authorityEpoch !== undefined ? { authorityEpoch: lease.authorityEpoch } : {}),
    ...(lease.authorityKeyId ? { authorityKeyId: lease.authorityKeyId } : {}),
    owner: lease.owner,
    ...(lease.holder ? { holder: lease.holder } : {}),
  };
}

export function buildRecoveryFenceRequest({
  url,
  recoverySecret,
  recoveryKeyId = "recovery-v1",
  recoveryId,
  expectedAuthorityEpoch,
  reason = "coordinator-recovery",
  nonce = newRequestNonce(),
  requestedAt = new Date().toISOString(),
}) {
  if (!String(recoverySecret || "").trim()) throw new Error("global coordination recovery custody is unavailable");
  const normalizedKeyId = String(recoveryKeyId || "").trim();
  const normalizedRecoveryId = String(recoveryId || "").trim();
  if (!KEY_ID.test(normalizedKeyId)) throw new Error("global coordination recovery key id is invalid");
  if (!SAFE_ID.test(normalizedRecoveryId)) throw new Error("global coordination recovery id is invalid");
  if (!Number.isSafeInteger(expectedAuthorityEpoch) || expectedAuthorityEpoch < 1) {
    throw new Error("global coordination recovery authority epoch is invalid");
  }
  if (!NONCE_RE.test(String(nonce || ""))) throw new Error("coordination request nonce is invalid");
  const endpoint = new URL(String(url || ""));
  if (endpoint.protocol !== "https:") throw new Error("global coordinator URL must use HTTPS");
  endpoint.pathname = "/v1/recovery";
  endpoint.search = "";
  endpoint.hash = "";
  const body = {
    schemaVersion: REQUEST_SCHEMA_VERSION,
    contractId: CONTRACT_ID,
    action: "fence",
    requestNonce: nonce,
    requestedAt,
    request: { recoveryId: normalizedRecoveryId, expectedAuthorityEpoch, reason: String(reason || "") },
  };
  const rawBody = canonicalJson(body);
  const requestDigest = sha256(rawBody);
  const binding = {
    schemaVersion: REQUEST_SCHEMA_VERSION,
    contractId: CONTRACT_ID,
    method: "POST",
    path: endpoint.pathname,
    nonce,
    requestedAt,
    requestDigest,
    keyId: normalizedKeyId,
  };
  return {
    endpoint,
    body,
    rawBody,
    requestDigest,
    headers: {
      accept: "application/json",
      "content-type": "application/json",
      "x-skincos-coordination-nonce": nonce,
      "x-skincos-coordination-requested-at": requestedAt,
      "x-skincos-coordination-request-digest": requestDigest,
      "x-skincos-coordination-recovery-key-id": normalizedKeyId,
      "x-skincos-coordination-request-signature": hmac(recoverySecret, canonicalJson(binding)),
    },
  };
}

export async function coordinate({
  url = process.env.SKINCOS_GLOBAL_COORDINATOR_URL,
  secret = coordinationActiveSecret(),
  keyId = process.env.SKINCOS_GLOBAL_COORDINATION_KEY_ID,
  previousKeyId = process.env.SKINCOS_GLOBAL_COORDINATION_PREVIOUS_KEY_ID,
  previousSecret = process.env.SKINCOS_GLOBAL_COORDINATION_PREVIOUS_KEY,
  previousKeyExpiresAt = process.env.SKINCOS_GLOBAL_COORDINATION_PREVIOUS_KEY_EXPIRES_AT,
  adminSecret = process.env.SKINCOS_GLOBAL_COORDINATION_ADMIN_SECRET,
  fetchImpl = globalThis.fetch,
  action,
  request,
  proof,
  authorization,
  ttlMs,
  reason,
  nonce,
  requestedAt,
}) {
  if (typeof fetchImpl !== "function") throw new Error("global coordinator fetch is unavailable");
  const signed = buildAuthenticatedRequest({ url, secret, adminSecret, keyId, action, request, proof, authorization, ttlMs, reason, nonce, requestedAt });
  const response = await fetchImpl(signed.endpoint, { method: "POST", headers: signed.headers, body: signed.rawBody });
  const raw = await response.text();
  let payload;
  try { payload = JSON.parse(raw); } catch { throw new Error("global coordinator response JSON is invalid"); }
  if ((response.status >= 200 && response.status < 300) || response.status === 409) {
    const verified = verifyCoordinatorResponse(payload, { secret, keyId, previousKeyId, previousSecret, previousKeyExpiresAt });
    return { ...verified, httpStatus: response.status };
  }
  const error = String(payload?.error || payload?.reason || `HTTP ${response.status}`);
  const errorCode = String(payload?.errorCode || "").trim();
  const suffix = errorCode ? ` [${errorCode}]` : "";
  throw new Error(`global coordinator ${action} request failed: ${error}${suffix}`);
}

export async function acquireGlobalLease({ request, ...options }) {
  return coordinate({ ...options, action: "acquire", request });
}

export async function evaluateGlobalGate({ request, ...options }) {
  return coordinate({ ...options, action: "gate", request });
}

export async function checkGlobalLease({ proof, authorization, ...options }) {
  return coordinate({ ...options, action: "check", proof, authorization });
}

export async function renewGlobalLease({ proof, ttlMs, ...options }) {
  return coordinate({ ...options, action: "renew", proof, ttlMs });
}

export async function releaseGlobalLease({ proof, ...options }) {
  return coordinate({ ...options, action: "release", proof });
}

export async function revokeGlobalLease({ proof, reason, ...options }) {
  return coordinate({ ...options, action: "revoke", proof, reason });
}

export function lockScopeForResource(resource) {
  return lockScopeFor(normalizeResourceKey(resource));
}
