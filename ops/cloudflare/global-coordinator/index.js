import { DurableObject } from "cloudflare:workers";
import {
  acquireLease,
  authorizeMutation,
  buildIntent,
  buildLegacyIntentV1,
  canonicalJson,
  checkLease,
  consumeNonce,
  emptyState,
  evaluateLeaseAdmission,
  fenceAuthorityEpoch,
  lockScopeFor,
  migratePersistedState,
  releaseLease,
  renewLease,
  revokeLease,
} from "../../governance/global-coordination-core.mjs";

const CONTRACT_ID = "skincos/global-coordination/v1";
const MAX_SKEW_MS = 30_000;
const NONCE_TTL_MS = 15 * 60_000;
const MAX_BODY_BYTES = 64 * 1024;
const COORDINATION_MODES = new Set(["legacy-drain", "global"]);
const LEGACY_KEY_ID = "legacy-v1";
const RECOVERY_PROTOCOL = "epoch-fence-v1";

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
const OBSERVABILITY_FIELDS = new Set([
  "route",
  "action",
  "status",
  "result",
  "reason",
  "coordinationPlane",
  "authorityEpoch",
  "keyId",
  "resourceClass",
  "durationMs",
]);
function logEvent(event, fields = {}) {
  const record = { schemaVersion: 1, contractId: CONTRACT_ID, event, timestamp: new Date().toISOString() };
  for (const [name, value] of Object.entries(fields)) {
    if (OBSERVABILITY_FIELDS.has(name) && (typeof value === "string" || typeof value === "number" || typeof value === "boolean")) record[name] = value;
  }
  try { console.log(JSON.stringify(record)); } catch { /* logging must never change the mutation decision */ }
}

function bindingFor(request, url, nonce, requestedAt, requestDigest, keyId) {
  return {
    schemaVersion: 1,
    contractId: CONTRACT_ID,
    method: request.method,
    path: url.pathname,
    nonce,
    requestedAt,
    requestDigest,
    ...(keyId ? { keyId } : {}),
  };
}

function keyId(value, label = "coordination key id") {
  const normalized = String(value || "").trim();
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,63}$/.test(normalized)) throw new Error(`${label} is invalid`);
  return normalized;
}

function keyRingFor(env, { recovery = false, now = Date.now() } = {}) {
  const prefix = recovery ? "COORDINATION_RECOVERY" : "COORDINATION";
  // The normal client contract keeps COORDINATION_SHARED_SECRET as the
  // canonical active custody value while key IDs provide explicit rotation
  // and fencing semantics. COORDINATION_ACTIVE_KEY is accepted only as a
  // bootstrap alias when the canonical value is absent.
  const activeSecret = String(
    recovery
      ? env[`${prefix}_ACTIVE_KEY`] || env[`${prefix}_SECRET`]
      : env.COORDINATION_SHARED_SECRET || env[`${prefix}_ACTIVE_KEY`],
  ).trim();
  const activeId = String(env[`${prefix}_ACTIVE_KEY_ID`] || (recovery ? env.COORDINATION_RECOVERY_KEY_ID || "recovery-v1" : LEGACY_KEY_ID)).trim();
  if (!activeSecret || !activeId) return null;
  const active = { id: keyId(activeId), secret: activeSecret };
  const previousSecret = String(env[`${prefix}_PREVIOUS_KEY`] || "").trim();
  const previousId = String(env[`${prefix}_PREVIOUS_KEY_ID`] || "").trim();
  const previousExpiresAt = Date.parse(String(env[`${prefix}_PREVIOUS_KEY_EXPIRES_AT`] || ""));
  const previous = previousSecret && previousId && Number.isFinite(previousExpiresAt) && previousExpiresAt > now
    ? { id: keyId(previousId), secret: previousSecret }
    : null;
  return { active, previous, allowLegacyWithoutKeyId: !recovery && active.id === LEGACY_KEY_ID && String(env.COORDINATION_ALLOW_LEGACY_KEY || "true").toLowerCase() === "true" };
}

function keyForRequest(ring, requestedKeyId) {
  if (!ring) return null;
  const normalized = String(requestedKeyId || "").trim();
  if (!normalized) return ring.allowLegacyWithoutKeyId ? ring.active : null;
  const candidateId = keyId(normalized);
  if (candidateId === ring.active.id) return ring.active;
  if (ring.previous?.id === candidateId) return ring.previous;
  return null;
}

async function authenticatedBody(request, env, url, rawBody, { recovery = false } = {}) {
  if (env.COORDINATION_CONTRACT_ID !== CONTRACT_ID) return { custodyUnavailable: true };
  const ring = keyRingFor(env, { recovery });
  if (!ring) return { custodyUnavailable: true };
  const nonce = request.headers.get("x-skincos-coordination-nonce") || "";
  const requestedAt = request.headers.get("x-skincos-coordination-requested-at") || "";
  const requestedMs = Date.parse(requestedAt);
  if (!/^[A-Za-z0-9_-]{32,}$/.test(nonce) || !Number.isFinite(requestedMs) || Math.abs(Date.now() - requestedMs) > MAX_SKEW_MS) throw new Error("coordination request is stale");
  const requestDigest = await sha256(rawBody);
  if (request.headers.get("x-skincos-coordination-request-digest") !== requestDigest) throw new Error("coordination request digest mismatch");
  const requestedKeyId = request.headers.get(recovery ? "x-skincos-coordination-recovery-key-id" : "x-skincos-coordination-key-id");
  const selectedKey = keyForRequest(ring, requestedKeyId);
  if (!selectedKey) throw new Error("coordination key is not active");
  const binding = bindingFor(request, url, nonce, requestedAt, requestDigest, requestedKeyId ? keyId(requestedKeyId) : "");
  const expected = await hmac(selectedKey.secret, canonicalJson(binding));
  if (!timingSafeEqual(expected, request.headers.get("x-skincos-coordination-request-signature") || "")) throw new Error("coordination request signature mismatch");
  let body;
  try { body = JSON.parse(rawBody); } catch { throw new Error("coordination request JSON is invalid"); }
  if (
    !body
    || body.schemaVersion !== 1
    || body.contractId !== CONTRACT_ID
    || body.requestNonce !== nonce
    || body.requestedAt !== requestedAt
     || !(recovery ? body.action === "fence" : ["acquire", "gate", "check", "renew", "release", "revoke"].includes(body.action))
  ) throw new Error("coordination request envelope is invalid");
  if (body.action === "revoke" && request.headers.get("authorization") !== `Bearer ${env.COORDINATION_ADMIN_SECRET || ""}`) throw new Error("coordination revocation authority is unavailable");
  if (recovery && (!body.request?.recoveryId || !body.request?.expectedAuthorityEpoch)) throw new Error("coordination recovery fence intent is invalid");
  return { body, nonce, requestDigest, keyId: selectedKey.id, secret: selectedKey.secret };
}

async function signResponse(payload, { secret, keyId: responseKeyId, authorityEpoch }) {
  const unsigned = { ...payload };
  const responseDigest = await sha256(canonicalJson(unsigned));
  const authority = {
    contractId: CONTRACT_ID,
    provider: "cloudflare",
    protocol: RECOVERY_PROTOCOL,
    keyId: responseKeyId,
    authorityEpoch,
    responseDigest,
  };
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

  readiness() {
    const row = this.ctx.storage.sql.exec("SELECT state_json FROM coordinator_state WHERE id = 1").one();
    const state = migratePersistedState(JSON.parse(row.state_json));
    return { ready: true, authorityEpoch: state.authorityEpoch };
  }

  coordinate(input) {
    const row = this.ctx.storage.sql.exec("SELECT state_json FROM coordinator_state WHERE id = 1").one();
    const current = migratePersistedState(JSON.parse(row.state_json));
    if (input.action === "fence") {
      const recoveryId = String(input.request?.recoveryId || "").trim();
      const existing = recoveryId ? current.recoveryFences?.[recoveryId] : null;
      if (existing) {
        if (existing.requestDigest !== input.intentDigest) return { accepted: false, valid: false, reason: "recovery-id-replayed", authorityEpoch: current.authorityEpoch };
        return {
          accepted: true,
          valid: true,
          idempotent: true,
          authorityEpoch: existing.authorityEpoch,
          previousAuthorityEpoch: existing.previousAuthorityEpoch,
          fencedLeases: existing.fencedLeases,
        };
      }
    }
    const nonce = consumeNonce(current, { nonce: input.nonce, digest: input.requestDigest, now: input.now, ttlMs: NONCE_TTL_MS });
    if (!nonce.accepted) return { accepted: false, valid: false, reason: nonce.reason, authorityEpoch: current.authorityEpoch };
    let result;
    if (input.action === "acquire") result = acquireLease(nonce.state, input.request, { now: input.now, leaseId: input.leaseId, authorityKeyId: input.keyId });
    else if (input.action === "gate") result = evaluateLeaseAdmission(nonce.state, input.request, { now: input.now });
    else if (input.action === "check") {
      result = input.authorization
        ? authorizeMutation(nonce.state, input.request, { now: input.now, ...input.authorization })
        : checkLease(nonce.state, input.request, { now: input.now });
    }
    else if (input.action === "renew") result = renewLease(nonce.state, input.request, { now: input.now, ttlMs: input.ttlMs });
    else if (input.action === "release") result = releaseLease(nonce.state, input.request, { now: input.now });
    else if (input.action === "revoke") result = revokeLease(nonce.state, input.request, { now: input.now, reason: input.reason });
    else if (input.action === "fence") result = fenceAuthorityEpoch(nonce.state, {
      now: input.now,
      expectedEpoch: input.request.expectedAuthorityEpoch,
      recoveryId: input.request.recoveryId,
      requestDigest: input.requestDigest,
      intentDigest: input.intentDigest,
      reason: input.request.reason || "coordinator-recovery",
    });
    else return { accepted: false, valid: false, reason: "coordination-action-invalid", authorityEpoch: current.authorityEpoch };
    this.ctx.storage.sql.exec("UPDATE coordinator_state SET state_json = ? WHERE id = 1", JSON.stringify(result.state));
    const { state: _state, ...publicResult } = result;
    return {
      ...publicResult,
      authorityEpoch: result.authorityEpoch ?? result.state?.authorityEpoch ?? nonce.state.authorityEpoch,
    };
  }
}

export default {
  async fetch(request, env) {
    const startedAt = Date.now();
    const url = new URL(request.url);
    const isReadiness = url.pathname === "/v1/readyz" && request.method === "GET";
    const isRecovery = url.pathname === "/v1/recovery" && request.method === "POST";
    const isLeaseRequest = url.pathname === "/v1/leases" && request.method === "POST";
    const emit = (event, fields = {}) => logEvent(event, { route: url.pathname, durationMs: Date.now() - startedAt, ...fields });
    if (!isReadiness && !isRecovery && !isLeaseRequest) {
      emit("coordination.request_rejected", { status: 404, result: "not_found" });
      return bad("not found", 404);
    }
    if (isReadiness) {
      try {
        if (env.COORDINATION_CONTRACT_ID !== CONTRACT_ID || !keyRingFor(env)) {
          emit("coordination.readiness", { status: 503, result: "custody_unavailable" });
          return bad("coordination authority custody is unavailable", 503);
        }
        const mode = String(env.COORDINATION_PLANE_MODE || "global").trim().toLowerCase();
        if (!COORDINATION_MODES.has(mode)) {
          emit("coordination.readiness", { status: 503, result: "invalid_plane" });
          return bad("coordination plane mode is invalid", 503);
        }
        const planeName = env.COORDINATION_PLANE_NAME || "global";
        const result = await env.GLOBAL_COORDINATOR.getByName(planeName).readiness();
        emit("coordination.readiness", { status: 200, result: "ready", coordinationPlane: mode, authorityEpoch: result.authorityEpoch });
        return jsonResponse({
          schemaVersion: 1,
          contractId: CONTRACT_ID,
          provider: "cloudflare",
          protocol: RECOVERY_PROTOCOL,
          coordinationPlane: mode,
          ...result,
        });
      } catch {
        emit("coordination.readiness", { status: 503, result: "unavailable" });
        return bad("coordination readiness is unavailable", 503);
      }
    }
    const rawBody = await request.text();
    if (new TextEncoder().encode(rawBody).byteLength > MAX_BODY_BYTES) return bad("coordination request is too large", 413);
    let authenticated;
    try {
      authenticated = await authenticatedBody(request, env, url, rawBody, { recovery: isRecovery });
    } catch {
      emit("coordination.request_rejected", { action: isRecovery ? "fence" : "unknown", status: 401, result: "authentication_failed" });
      return bad("coordination request rejected", 401);
    }
    if (authenticated.custodyUnavailable) {
      emit("coordination.request_rejected", { action: isRecovery ? "fence" : "unknown", status: 503, result: "custody_unavailable" });
      return bad(`${isRecovery ? "coordination recovery" : "coordination"} authority custody is unavailable`, 503);
    }
    const { body, nonce, requestDigest } = authenticated;
    let resource;
    try {
      resource = ["acquire", "gate"].includes(body.action) ? body.request?.resource : body.proof?.resource;
      const lockScope = body.action === "fence" ? null : lockScopeFor(resource);
      if (["acquire", "gate"].includes(body.action)) {
        const normalizedIntent = buildIntent(body.request);
        const expectedDigest = await sha256(canonicalJson(normalizedIntent));
        let intentDigestValid = body.request.intentDigest === expectedDigest;
        // During the distributed rollout, already-running v1 clients may not
        // include the newly explicit owner.sessionId field. Accept that exact
        // legacy canonicalization only when the field is absent; a request that
        // includes sessionId must use the new digest.
        if (!intentDigestValid && !body.request.owner?.sessionId) {
          const legacyIntent = buildLegacyIntentV1(body.request);
          const legacyDigest = await sha256(canonicalJson(legacyIntent));
          intentDigestValid = body.request.intentDigest === legacyDigest;
        }
        if (!intentDigestValid) {
          emit("coordination.request_rejected", { action: body.action, status: 403, result: "intent_digest_mismatch" });
          return bad("coordination intent digest mismatch", 403);
        }
      }
      const coordinationMode = String(env.COORDINATION_PLANE_MODE || "global").trim().toLowerCase();
      if (!COORDINATION_MODES.has(coordinationMode)) {
        emit("coordination.request_rejected", { action: body.action, status: 503, result: "invalid_plane" });
        return bad("coordination plane mode is invalid", 503);
      }
      if (isRecovery && coordinationMode !== "global") {
        emit("coordination.request_rejected", { action: body.action, status: 503, result: "recovery_requires_global_plane" });
        return bad("coordination recovery requires the global plane", 503);
      }
      if (coordinationMode === "legacy-drain" && ["acquire", "gate", "renew"].includes(body.action)) {
        emit("coordination.request_rejected", { action: body.action, status: 503, result: "legacy_plane_draining", coordinationPlane: coordinationMode });
        return bad("coordination plane is draining legacy lock scopes", 503);
      }
      // One globally named Durable Object is the coordination plane. The
      // logical lockScope remains part of the lease and fencing proof, while
      // one serialized state machine can arbitrate cross-resource conflicts
      // such as merge:main versus release:<module>.
      const planeName = coordinationMode === "legacy-drain" && !isRecovery
        ? lockScope
        : (env.COORDINATION_PLANE_NAME || "global");
      const stub = env.GLOBAL_COORDINATOR.getByName(planeName);
      const result = stub.coordinate({
         action: body.action,
         nonce,
         requestDigest,
         intentDigest: body.action === "fence" ? await sha256(canonicalJson(body.request)) : undefined,
         keyId: authenticated.keyId,
         now: Date.now(),
        leaseId: crypto.randomUUID(),
         request: ["acquire", "gate", "fence"].includes(body.action) ? body.request : body.proof,
         authorization: body.authorization,
         ttlMs: body.ttlMs,
         reason: body.reason,
       });
      const resolved = await result;
      const passed = body.action === "gate"
        ? resolved.allowed === true
        : resolved.accepted !== false && resolved.valid !== false;
      const payload = await signResponse({
        schemaVersion: 1,
        contractId: CONTRACT_ID,
        passed,
        ...resolved,
      }, { secret: authenticated.secret, keyId: authenticated.keyId, authorityEpoch: resolved.authorityEpoch });
      const status = resolved.allowed === false || resolved.accepted === false || resolved.valid === false ? 409 : 200;
      emit("coordination.request_processed", {
        action: body.action,
        status,
        result: passed ? "allowed" : "denied",
        reason: resolved.reason || "",
        authorityEpoch: resolved.authorityEpoch,
        keyId: authenticated.keyId,
        resourceClass: lockScope || "global",
      });
      return jsonResponse(payload, status);
    } catch {
      emit("coordination.request_failed", { action: body?.action || "unknown", status: 400, result: "processing_error" });
      return bad("coordination request could not be processed", 400);
    }
  },
};
