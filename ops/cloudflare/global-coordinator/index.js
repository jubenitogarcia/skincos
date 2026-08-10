import { DurableObject } from "cloudflare:workers";
import {
  acquireLease,
  authorizeMutation,
  buildIntent,
  canonicalJson,
  checkLease,
  consumeNonce,
  emptyState,
  lockScopeFor,
  releaseLease,
  renewLease,
  revokeLease,
} from "../../governance/global-coordination-core.mjs";

const CONTRACT_ID = "skincos/global-coordination/v1";
const MAX_SKEW_MS = 30_000;
const NONCE_TTL_MS = 15 * 60_000;
const MAX_BODY_BYTES = 64 * 1024;

const encoder = new TextEncoder();
const b64url = (bytes) => btoa(String.fromCharCode(...new Uint8Array(bytes)))
  .replaceAll("+", "-")
  .replaceAll("/", "_")
  .replace(/=+$/g, "");
const hex = (bytes) => [...new Uint8Array(bytes)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
const sha256 = async (value) => hex(await crypto.subtle.digest("SHA-256", encoder.encode(value)));
const hmac = async (secret, value) => {
  const key = await crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return b64url(await crypto.subtle.sign("HMAC", key, encoder.encode(value)));
};
const timingSafeEqual = (left, right) => {
  if (left.length !== right.length) return false;
  let result = 0;
  for (let index = 0; index < left.length; index += 1) result |= left.charCodeAt(index) ^ right.charCodeAt(index);
  return result === 0;
};
const jsonResponse = (payload, status = 200, headers = {}) => new Response(JSON.stringify(payload), {
  status,
  headers: { "content-type": "application/json", "cache-control": "no-store", ...headers },
});
const bad = (message, status = 401) => jsonResponse({ schemaVersion: 1, contractId: CONTRACT_ID, passed: false, error: message }, status);

function bindingFor(request, url, nonce, requestedAt, requestDigest) {
  return {
    schemaVersion: 1,
    contractId: CONTRACT_ID,
    method: request.method,
    path: url.pathname,
    nonce,
    requestedAt,
    requestDigest,
  };
}

async function authenticatedBody(request, env, url, rawBody) {
  if (!env.COORDINATION_SHARED_SECRET || env.COORDINATION_CONTRACT_ID !== CONTRACT_ID) return { custodyUnavailable: true };
  const nonce = request.headers.get("x-skincos-coordination-nonce") || "";
  const requestedAt = request.headers.get("x-skincos-coordination-requested-at") || "";
  const requestedMs = Date.parse(requestedAt);
  if (!/^[A-Za-z0-9_-]{32,}$/.test(nonce) || !Number.isFinite(requestedMs) || Math.abs(Date.now() - requestedMs) > MAX_SKEW_MS) throw new Error("coordination request is stale");
  const requestDigest = await sha256(rawBody);
  if (request.headers.get("x-skincos-coordination-request-digest") !== requestDigest) throw new Error("coordination request digest mismatch");
  const binding = bindingFor(request, url, nonce, requestedAt, requestDigest);
  const expected = await hmac(env.COORDINATION_SHARED_SECRET, canonicalJson(binding));
  if (!timingSafeEqual(expected, request.headers.get("x-skincos-coordination-request-signature") || "")) throw new Error("coordination request signature mismatch");
  let body;
  try { body = JSON.parse(rawBody); } catch { throw new Error("coordination request JSON is invalid"); }
  if (
    !body
    || body.schemaVersion !== 1
    || body.contractId !== CONTRACT_ID
    || body.requestNonce !== nonce
    || body.requestedAt !== requestedAt
    || !["acquire", "check", "renew", "release", "revoke"].includes(body.action)
  ) throw new Error("coordination request envelope is invalid");
  if (body.action === "revoke" && request.headers.get("authorization") !== `Bearer ${env.COORDINATION_ADMIN_SECRET || ""}`) throw new Error("coordination revocation authority is unavailable");
  return { body, nonce, requestDigest };
}

async function signResponse(payload, secret) {
  const unsigned = { ...payload };
  const responseDigest = await sha256(canonicalJson(unsigned));
  const authority = { contractId: CONTRACT_ID, provider: "cloudflare", responseDigest };
  return {
    ...unsigned,
    authority,
    responseSignature: await hmac(secret, canonicalJson({ ...unsigned, authority })),
  };
}

export class GlobalCoordinator extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.ctx.blockConcurrencyWhile(async () => {
      this.ctx.storage.sql.exec("CREATE TABLE IF NOT EXISTS coordinator_state (id INTEGER PRIMARY KEY CHECK (id = 1), state_json TEXT NOT NULL)");
      const existing = this.ctx.storage.sql.exec("SELECT id FROM coordinator_state WHERE id = 1").toArray();
      if (!existing.length) this.ctx.storage.sql.exec("INSERT INTO coordinator_state (id, state_json) VALUES (1, ?)", JSON.stringify(emptyState()));
    });
  }

  coordinate(input) {
    const row = this.ctx.storage.sql.exec("SELECT state_json FROM coordinator_state WHERE id = 1").one();
    const current = JSON.parse(row.state_json);
    const nonce = consumeNonce(current, { nonce: input.nonce, digest: input.requestDigest, now: input.now, ttlMs: NONCE_TTL_MS });
    if (!nonce.accepted) return { accepted: false, valid: false, reason: nonce.reason };
    let result;
    if (input.action === "acquire") result = acquireLease(nonce.state, input.request, { now: input.now, leaseId: input.leaseId });
    else if (input.action === "check") {
      result = input.authorization
        ? authorizeMutation(nonce.state, input.request, { now: input.now, ...input.authorization })
        : checkLease(nonce.state, input.request, { now: input.now });
    }
    else if (input.action === "renew") result = renewLease(nonce.state, input.request, { now: input.now, ttlMs: input.ttlMs });
    else if (input.action === "release") result = releaseLease(nonce.state, input.request, { now: input.now });
    else if (input.action === "revoke") result = revokeLease(nonce.state, input.request, { now: input.now, reason: input.reason });
    else return { accepted: false, valid: false, reason: "coordination-action-invalid" };
    this.ctx.storage.sql.exec("UPDATE coordinator_state SET state_json = ? WHERE id = 1", JSON.stringify(result.state));
    const { state: _state, ...publicResult } = result;
    return publicResult;
  }
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname !== "/v1/leases" || request.method !== "POST") return bad("not found", 404);
    const rawBody = await request.text();
    if (new TextEncoder().encode(rawBody).byteLength > MAX_BODY_BYTES) return bad("coordination request is too large", 413);
    let authenticated;
    try {
      authenticated = await authenticatedBody(request, env, url, rawBody);
    } catch {
      return bad("coordination request rejected", 401);
    }
    if (authenticated.custodyUnavailable) return bad("coordination authority custody is unavailable", 503);
    const { body, nonce, requestDigest } = authenticated;
    let resource;
    try {
      resource = body.action === "revoke" ? body.proof?.resource : body.action === "acquire" ? body.request?.resource : body.proof?.resource;
      const scope = lockScopeFor(resource);
      if (body.action === "acquire") {
        const normalizedIntent = buildIntent(body.request);
        const expectedDigest = await sha256(canonicalJson(normalizedIntent));
        if (body.request.intentDigest !== expectedDigest) return bad("coordination intent digest mismatch", 403);
      }
      const stub = env.GLOBAL_COORDINATOR.getByName(scope);
      const result = stub.coordinate({
        action: body.action,
        nonce,
        requestDigest,
        now: Date.now(),
        leaseId: crypto.randomUUID(),
        request: body.action === "acquire" ? body.request : undefined,
        ...(body.action !== "acquire" ? { request: body.proof } : {}),
        authorization: body.authorization,
        ttlMs: body.ttlMs,
        reason: body.reason,
      });
      const resolved = await result;
      const payload = await signResponse({ schemaVersion: 1, contractId: CONTRACT_ID, passed: resolved.accepted !== false && resolved.valid !== false, ...resolved }, env.COORDINATION_SHARED_SECRET);
      const status = resolved.accepted === false && resolved.reason === "resource-lease-held" ? 409 : resolved.valid === false ? 409 : resolved.accepted === false ? 409 : 200;
      return jsonResponse(payload, status);
    } catch {
      return bad("coordination request could not be processed", 400);
    }
  },
};
