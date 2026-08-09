#!/usr/bin/env node
import crypto from "node:crypto";
import {
  buildIntent,
  canonicalJson,
  CONTRACT_ID,
  lockScopeFor,
  normalizeResourceKey,
} from "../ops/governance/global-coordination-core.mjs";

const COORDINATION_PATH = "/v1/leases";
const REQUEST_SCHEMA_VERSION = 1;
const NONCE_RE = /^[A-Za-z0-9_-]{32,}$/;

export function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

export function hmac(secret, value) {
  if (!String(secret || "").trim()) throw new Error("global coordination custody is unavailable");
  return crypto.createHmac("sha256", String(secret)).update(value).digest("base64url");
}

export function newRequestNonce() {
  return crypto.randomBytes(24).toString("base64url");
}

export function buildLeaseRequest({ operation, resource, owner, intent, idempotencyKey, ttlMs }) {
  const normalized = buildIntent({ operation, resource, owner, intent, idempotencyKey });
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

function envelopeFor({ action, request, proof, authorization, ttlMs, reason, nonce, requestedAt }) {
  if (!NONCE_RE.test(String(nonce || ""))) throw new Error("coordination request nonce is invalid");
  const body = {
    schemaVersion: REQUEST_SCHEMA_VERSION,
    contractId: CONTRACT_ID,
    action,
    requestNonce: nonce,
    requestedAt,
  };
  if (action === "acquire") body.request = request;
  else body.proof = proof;
  if (authorization !== undefined) body.authorization = authorization;
  if (action === "renew") body.ttlMs = ttlMs;
  if (action === "revoke") body.reason = reason;
  return body;
}

export function buildAuthenticatedRequest({
  url = process.env.SKINCOS_GLOBAL_COORDINATOR_URL,
  secret,
  adminSecret,
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
  };
  const headers = {
    accept: "application/json",
    "content-type": "application/json",
    "x-skincos-coordination-nonce": nonce,
    "x-skincos-coordination-requested-at": requestedAt,
    "x-skincos-coordination-request-digest": requestDigest,
    "x-skincos-coordination-request-signature": hmac(secret, canonicalJson(binding)),
  };
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

export function verifyCoordinatorResponse(payload, secret) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) throw new Error("global coordinator response is invalid");
  const { authority, responseSignature, ...unsigned } = payload;
  if (
    !authority
    || authority.contractId !== CONTRACT_ID
    || authority.provider !== "cloudflare"
    || !/^[0-9a-f]{64}$/.test(String(authority.responseDigest || ""))
    || !String(responseSignature || "")
  ) throw new Error("global coordinator response authority is invalid");
  if (sha256(canonicalJson(unsigned)) !== authority.responseDigest) throw new Error("global coordinator response digest mismatch");
  const expected = hmac(secret, canonicalJson({ ...unsigned, authority }));
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
    owner: lease.owner,
  };
}

export async function coordinate({
  url = process.env.SKINCOS_GLOBAL_COORDINATOR_URL,
  secret = process.env.SKINCOS_GLOBAL_COORDINATION_SHARED_SECRET,
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
  const signed = buildAuthenticatedRequest({ url, secret, adminSecret, action, request, proof, authorization, ttlMs, reason, nonce, requestedAt });
  const response = await fetchImpl(signed.endpoint, { method: "POST", headers: signed.headers, body: signed.rawBody });
  const raw = await response.text();
  let payload;
  try { payload = JSON.parse(raw); } catch { throw new Error("global coordinator response JSON is invalid"); }
  if ((response.status >= 200 && response.status < 300) || response.status === 409) {
    const verified = verifyCoordinatorResponse(payload, secret);
    return { ...verified, httpStatus: response.status };
  }
  const error = String(payload?.error || payload?.reason || `HTTP ${response.status}`);
  throw new Error(`global coordinator request failed: ${error}`);
}

export async function acquireGlobalLease({ request, ...options }) {
  return coordinate({ ...options, action: "acquire", request });
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
