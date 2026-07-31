const CONTRACT_ID = "skincos/ponto/emergency-close/v1";
const ALLOWED = ["latch-true", "maintenance"];
const DENIED = ["active", "arbitrary-kv-write", "canary", "delete", "disabled", "latch-false"];
const MAX_SKEW_MS = 30_000;
const NONCE_TTL_MS = 15 * 60_000;
const MUTEX_TTL_MS = 60_000;

const json = (value) => JSON.stringify(value, Object.keys(value || {}).sort());
const canonicalize = (value) => {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonicalize(value[key])]));
  }
  return value;
};
const canonicalJson = (value) => JSON.stringify(canonicalize(value));
const encoder = new TextEncoder();
const hex = (bytes) => [...new Uint8Array(bytes)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
const sha256 = async (value) => hex(await crypto.subtle.digest("SHA-256", encoder.encode(value)));
const b64url = (bytes) => btoa(String.fromCharCode(...new Uint8Array(bytes))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
const timingSafeEqual = (left, right) => {
  if (left.length !== right.length) return false;
  let result = 0;
  for (let index = 0; index < left.length; index += 1) result |= left.charCodeAt(index) ^ right.charCodeAt(index);
  return result === 0;
};
const base64urlToBytes = (value) => Uint8Array.from(atob(value.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((value.length + 3) % 4)), (character) => character.charCodeAt(0));
const hmac = async (secret, value) => {
  const key = await crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return b64url(await crypto.subtle.sign("HMAC", key, encoder.encode(value)));
};
const responseSign = async (pem, value) => {
  const body = pem.replace(/-----BEGIN PRIVATE KEY-----|-----END PRIVATE KEY-----|\s/g, "");
  const bytes = Uint8Array.from(atob(body), (character) => character.charCodeAt(0));
  const key = await crypto.subtle.importKey("pkcs8", bytes, { name: "Ed25519" }, false, ["sign"]);
  return b64url(await crypto.subtle.sign("Ed25519", key, encoder.encode(value)));
};
const bad = (message, status = 401) => new Response(JSON.stringify({ passed: false, error: message }), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });
const ok = (payload) => new Response(JSON.stringify(payload), { status: 200, headers: { "content-type": "application/json", "cache-control": "no-store" } });
const runId = (value) => /^[1-9][0-9]*$/.test(String(value || ""));

async function reserveNonce(env, nonce, requestedAt, digest) {
  const expiresAt = new Date(Date.parse(requestedAt) + NONCE_TTL_MS).toISOString();
  const result = await env.DB.batch([
    env.DB.prepare("INSERT OR IGNORE INTO broker_nonces (nonce, requested_at, request_digest, expires_at) VALUES (?, ?, ?, ?)").bind(nonce, requestedAt, digest, expiresAt),
    env.DB.prepare("SELECT changes() AS accepted"),
  ]);
  return Number(result?.[1]?.results?.[0]?.accepted || 0) === 1;
}

async function acquireMutex(env, holder, now) {
  const expiresAt = new Date(now + MUTEX_TTL_MS).toISOString();
  const result = await env.DB.batch([
    env.DB.prepare("INSERT INTO broker_mutex (name, holder, expires_at) VALUES ('global', ?, ?) ON CONFLICT(name) DO UPDATE SET holder = excluded.holder, expires_at = excluded.expires_at WHERE broker_mutex.expires_at <= ?").bind(holder, expiresAt, new Date(now).toISOString()),
    env.DB.prepare("SELECT changes() AS acquired"),
  ]);
  return Number(result?.[1]?.results?.[0]?.acquired || 0) === 1;
}

async function releaseMutex(env, holder) {
  await env.DB.prepare("DELETE FROM broker_mutex WHERE name = 'global' AND holder = ?").bind(holder).run();
}

async function attest(env, request, binding, body) {
  const issuedAt = new Date().toISOString();
  const contract = { schemaVersion: 1, id: CONTRACT_ID, mode: "close-only", target: env.TARGET, custodyRef: env.CUSTODY_REF, allowedOperations: ALLOWED, deniedOperations: DENIED };
  const unsigned = {
    schemaVersion: 1,
    id: CONTRACT_ID,
    mode: "close-only",
    target: env.TARGET,
    custodyRef: env.CUSTODY_REF,
    contract,
    passed: true,
    credentialsIncluded: false,
    piiIncluded: false,
  };
  const attestation = {
    schemaVersion: 1,
    contractId: CONTRACT_ID,
    keyId: env.RESPONSE_KEY_ID,
    issuedAt,
    requestBinding: binding,
    responseDigest: await sha256(canonicalJson(unsigned)),
  };
  attestation.signature = await responseSign(env.RESPONSE_PRIVATE_KEY_PEM, canonicalJson(attestation));
  return ok({ ...unsigned, brokerAttestation: attestation });
}

async function handle(request, env) {
  if (!env.DB || !env.BROKER_CREDENTIAL || !env.RESPONSE_PRIVATE_KEY_PEM || !env.TARGET || !env.CUSTODY_REF || !env.RESPONSE_KEY_ID) return bad("broker custody unavailable", 503);
  if (new URL(request.url).pathname !== "/close") return bad("not found", 404);
  if (!["GET", "POST"].includes(request.method)) return bad("method not allowed", 405);
  const nonce = request.headers.get("x-skincos-emergency-request-nonce") || "";
  const requestedAt = request.headers.get("x-skincos-emergency-requested-at") || "";
  const requestedMs = Date.parse(requestedAt);
  if (!/^[A-Za-z0-9_-]{32,}$/.test(nonce) || !Number.isFinite(requestedMs) || Math.abs(Date.now() - requestedMs) > MAX_SKEW_MS) return bad("stale request", 401);
  if (request.headers.get("authorization") !== `Bearer ${env.BROKER_CREDENTIAL}` || request.headers.get("x-skincos-emergency-contract") !== CONTRACT_ID || request.headers.get("x-skincos-emergency-custody-ref") !== env.CUSTODY_REF || request.headers.get("x-skincos-emergency-target") !== env.TARGET || request.headers.get("x-skincos-emergency-response-key-id") !== env.RESPONSE_KEY_ID) return bad("request identity mismatch", 401);
  const rawBody = await request.text();
  const digest = await sha256(rawBody);
  if (request.headers.get("x-skincos-emergency-request-digest") !== digest) return bad("request digest mismatch", 401);
  const binding = { schemaVersion: 1, contractId: CONTRACT_ID, method: request.method, url: request.url, target: env.TARGET, custodyRef: env.CUSTODY_REF, responseKeyId: env.RESPONSE_KEY_ID, requestNonce: nonce, requestedAt, requestDigest: digest };
  const expected = await hmac(env.BROKER_CREDENTIAL, canonicalJson(binding));
  if (!timingSafeEqual(expected, request.headers.get("x-skincos-emergency-request-signature") || "")) return bad("request signature mismatch", 401);
  if (!(await reserveNonce(env, nonce, requestedAt, digest))) return bad("request nonce already used", 409);
  if (request.method === "GET") return attest(env, request, binding);
  let payload;
  try { payload = JSON.parse(rawBody); } catch { return bad("invalid JSON", 400); }
  if (payload?.requestNonce !== nonce || payload?.requestedAt !== requestedAt || payload?.schemaVersion !== 1 || payload?.target !== env.TARGET || !ALLOWED.includes(payload?.operation) || !runId(payload?.coordinatorRunId) || !runId(payload?.emergencyRunId)) return bad("operation is not close-only", 403);
  if (!(await acquireMutex(env, nonce, Date.now()))) return bad("emergency mutex busy", 409);
  try {
    const current = await env.DB.prepare("SELECT latched, changed_at, stop_run_id, emergency_run_id FROM broker_state WHERE id = 'timekeeping'").first();
    const now = new Date().toISOString();
    // A close-only re-attestation may transfer the recorded owner while the
    // latch is already closed. This never opens the module: it only refreshes
    // the broker-backed evidence so a later protected reset can reference the
    // current emergency run. Maintenance remains owner-bound below.
    if (
      current?.latched === 1
      && payload.operation !== "latch-true"
      && (current.stop_run_id !== payload.coordinatorRunId || current.emergency_run_id !== payload.emergencyRunId)
    ) return bad("emergency latch already owned", 409);
    if (payload.operation === "latch-true") {
      await env.DB.prepare("UPDATE broker_state SET latched = 1, changed_at = ?, stop_run_id = ?, emergency_run_id = ? WHERE id = 'timekeeping'").bind(now, payload.coordinatorRunId, payload.emergencyRunId).run();
    } else {
      if (current?.latched !== 1) return bad("maintenance requires closed latch", 409);
      await env.DB.prepare("UPDATE broker_state SET control_state = 'maintenance', control_changed_at = ? WHERE id = 'timekeeping'").bind(now).run();
    }
    const state = await env.DB.prepare("SELECT latched, changed_at, stop_run_id, emergency_run_id, control_state, control_changed_at FROM broker_state WHERE id = 'timekeeping'").first();
    const response = {
      schemaVersion: 1,
      id: CONTRACT_ID,
      mode: "close-only",
      target: env.TARGET,
      custodyRef: env.CUSTODY_REF,
      contract: { schemaVersion: 1, id: CONTRACT_ID, mode: "close-only", target: env.TARGET, custodyRef: env.CUSTODY_REF, allowedOperations: ALLOWED, deniedOperations: DENIED },
      passed: true,
      credentialsIncluded: false,
      piiIncluded: false,
      operation: payload.operation,
      coordinatorRunId: payload.coordinatorRunId,
      emergencyRunId: payload.emergencyRunId,
      latch: { schemaVersion: 1, module: "timekeeping", target: env.TARGET, latched: state.latched === 1, changedAt: state.changed_at, stopRunId: state.stop_run_id, emergencyRunId: state.emergency_run_id },
      observations: [{ name: "broker", passed: true }, { name: "nonce", passed: true }, { name: "mutex", passed: true }],
    };
    if (payload.operation === "maintenance") response.control = { schemaVersion: 2, state: state.control_state, changedAt: state.control_changed_at, emergencyLatchRef: { stopRunId: state.stop_run_id, emergencyRunId: state.emergency_run_id, latchChangedAt: state.changed_at } };
    const unsigned = { ...response };
    const attestation = { schemaVersion: 1, contractId: CONTRACT_ID, keyId: env.RESPONSE_KEY_ID, issuedAt: now, requestBinding: binding, responseDigest: await sha256(canonicalJson(unsigned)) };
    attestation.signature = await responseSign(env.RESPONSE_PRIVATE_KEY_PEM, canonicalJson(attestation));
    return ok({ ...response, brokerAttestation: attestation });
  } finally {
    await releaseMutex(env, nonce);
  }
}

export default { fetch: handle };
