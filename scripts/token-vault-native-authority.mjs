import { createHash } from "node:crypto";

const PREVIEW = /^https:\/\/(?:[a-z0-9-]+\.)+workers\.dev$/;
const ORIGIN = /^https:\/\/[^/]+$/;
const READY_REVISION = /^[a-f0-9]{64}$/;
const LEGACY_REVISION = /^legacy:[a-f0-9]{64}$/;
const OPERATION = /^[A-Za-z0-9_.:-]{8,160}$/;

function safeError(response, payload) {
  const error = String(payload?.error || "");
  return `${response.status} ${/^[a-z0-9_:-]{1,120}$/i.test(error) ? error : "unknown"}`;
}

function exactOrigin(value, isPreview = false) {
  const base = String(value || "").replace(/\/+$/, "");
  if (!(isPreview ? PREVIEW : ORIGIN).test(base)) throw new Error("Token Vault endpoint identity is invalid");
  return base;
}

function configToken(env) {
  const token = String(env.TOKEN_VAULT_META_ADS_CONFIG_TOKEN || "");
  if (!/^[\x21-\x7e]+$/.test(token)) throw new Error("Token Vault config bearer is unavailable or malformed");
  return token;
}

async function request(base, token, route, { method = "GET", body, fetchImpl = fetch } = {}) {
  const headers = { Authorization: `Bearer ${token}` };
  if (body !== undefined) headers["content-type"] = "application/json";
  const response = await fetchImpl(`${base}/internal/token-vault${route}`, {
    method, headers,
    body: body === undefined ? undefined : JSON.stringify(body),
    cache: "no-store", redirect: "error", signal: AbortSignal.timeout(20_000),
  });
  let payload = null;
  try { payload = await response.json(); } catch {}
  return { response, payload };
}

export function authorityState({ response, payload }) {
  const mode = String(payload?.config_authority_mode || "");
  const revision = String(payload?.config_authority_revision || "").toLowerCase();
  if (response.status === 200 && payload?.ok === true && payload?.ready === true
    && mode === "tracking_ready" && READY_REVISION.test(revision)) return { mode, revision };
  if (response.status === 409 && payload?.ready === false
    && mode === "legacy_bootstrap" && LEGACY_REVISION.test(revision)) return { mode, revision };
  return null;
}

async function waitAuthority({ baseUrl, isPreview, env = process.env, fetchImpl = fetch, now = () => Date.now(), sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)) }) {
  const base = exactOrigin(baseUrl, isPreview);
  const token = configToken(env);
  const deadline = now() + 90_000;
  while (now() < deadline) {
    try {
      const result = await request(base, token, "/v1/meta-ads-publish/config", { fetchImpl });
      const authority = authorityState(result);
      if (authority) return authority;
    } catch {}
    await sleep(3_000);
  }
  throw new Error(isPreview
    ? "immutable Token Vault candidate config bearer did not authenticate before traffic"
    : "Token Vault canonical route did not converge on the candidate config bearer");
}

export async function waitCandidateAuthority({ previewUrl, ...options }) {
  return waitAuthority({ baseUrl: previewUrl, isPreview: true, ...options });
}

export async function waitRouteAuthority({ baseUrl, ...options }) {
  return waitAuthority({ baseUrl, isPreview: false, ...options });
}

function validSummary(summary, target) {
  if (!summary || typeof summary !== "object" || Array.isArray(summary)) return false;
  const allowed = new Set(["destination_count", "website_destination_count", "whatsapp_destination_count", "staging_fixture_count"]);
  if (!Object.keys(summary).every((key) => allowed.has(key))) return false;
  const values = [...allowed].map((key) => summary[key]);
  if (!values.every((value) => Number.isInteger(value) && value >= 0)) return false;
  if (summary.destination_count < 2 || summary.destination_count > 10 || summary.website_destination_count < 1
    || summary.destination_count !== summary.website_destination_count + summary.whatsapp_destination_count) return false;
  return target === "staging" ? summary.staging_fixture_count === 1 : summary.staging_fixture_count === 0;
}

function validUrlTags(value) {
  const raw = String(value ?? "");
  if (!raw || raw !== raw.trim() || raw.length > 1_000 || /[?#\s\u0000-\u001f]/.test(raw)
    || /:\/\//.test(raw) || /%(?![0-9A-Fa-f]{2})/.test(raw)) return false;
  const seen = new Set();
  return raw.split("&").every((pair) => {
    const separator = pair.indexOf("=");
    if (separator <= 0) return false;
    const key = pair.slice(0, separator).toLowerCase();
    const parameterValue = pair.slice(separator + 1);
    if (!/^[A-Za-z0-9][A-Za-z0-9._~-]{0,127}$/.test(key)
      || /(?:token|secret|password|authorization|signature|api_?key)/i.test(key)
      || seen.has(key) || !parameterValue || !/^[A-Za-z0-9._~%{}|:+,\-@!$'()*\/;=]+$/.test(parameterValue)) return false;
    seen.add(key);
    return true;
  });
}

export function parseProtectedManifest(raw, target) {
  if (new TextEncoder().encode(String(raw || "")).length > 150 * 1024) throw new Error("Token Vault bootstrap manifest exceeds the bounded request size");
  let manifest;
  try { manifest = JSON.parse(raw); } catch { throw new Error("Token Vault bootstrap manifest must be protected JSON"); }
  if (!manifest || typeof manifest !== "object" || Array.isArray(manifest)
    || Object.keys(manifest).some((key) => key !== "entries")
    || !Array.isArray(manifest.entries) || manifest.entries.length < 2 || manifest.entries.length > 10) {
    throw new Error("Token Vault bootstrap manifest has an unsafe entry envelope");
  }
  const seen = new Set();
  let fixtureCount = 0;
  for (const entry of manifest.entries) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) throw new Error("Token Vault bootstrap manifest has an unsafe entry");
    const type = String(entry.destination_type || "").trim().toLowerCase();
    const allowed = type === "website"
      ? new Set(["config_token_id", "destination_type", "source_config_token_id", "source_adset_id", "fixture_source_ad_id", "url_tags", "staging_synthetic_fixture"])
      : type === "whatsapp" ? new Set(["config_token_id", "destination_type"]) : null;
    const tokenId = String(entry.config_token_id || "").trim();
    if (!allowed || Object.keys(entry).some((key) => !allowed.has(key))
      || !/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,159}$/.test(tokenId) || seen.has(tokenId)) {
      throw new Error("Token Vault bootstrap manifest has an unsafe entry");
    }
    seen.add(tokenId);
    if (type !== "website") continue;
    const sourceConfigTokenId = String(entry.source_config_token_id || "").trim();
    const sourceAdsetId = String(entry.source_adset_id || "").trim().replace(/^act_/, "");
    if (Boolean(sourceConfigTokenId) === Boolean(sourceAdsetId)
      || (sourceConfigTokenId && !/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,159}$/.test(sourceConfigTokenId))
      || (sourceAdsetId && !/^[0-9]{5,30}$/.test(sourceAdsetId)) || !validUrlTags(entry.url_tags)) {
      throw new Error("Token Vault bootstrap manifest has an unsafe Website entry");
    }
    if (Object.hasOwn(entry, "staging_synthetic_fixture")) {
      if (typeof entry.staging_synthetic_fixture !== "boolean") throw new Error("Token Vault bootstrap manifest has an unsafe Website fixture");
      if (entry.staging_synthetic_fixture) fixtureCount += 1;
    }
    if (Object.hasOwn(entry, "fixture_source_ad_id")
      && !/^[0-9]{5,30}$/.test(String(entry.fixture_source_ad_id || "").trim().replace(/^act_/, ""))) {
      throw new Error("Token Vault bootstrap manifest has an unsafe Website fixture source");
    }
  }
  if ((target === "staging" && fixtureCount !== 1) || (target === "production" && fixtureCount !== 0)) {
    throw new Error("Token Vault bootstrap fixture count is invalid for the selected environment");
  }
  return manifest;
}

export async function planBootstrap({ target, previewUrl, authority, env = process.env, fetchImpl = fetch }) {
  const base = exactOrigin(previewUrl, true);
  const token = configToken(env);
  const rawManifest = String(env.TOKEN_VAULT_META_ADS_BOOTSTRAP_MANIFEST || "");
  if (authority.mode === "tracking_ready") {
    if (rawManifest || !READY_REVISION.test(authority.revision)) throw new Error("tracking-ready candidate must not receive a bootstrap manifest");
    return { strategy: "not_required", revision: authority.revision, manifestSha256: "" };
  }
  if (authority.mode !== "legacy_bootstrap" || !LEGACY_REVISION.test(authority.revision)) {
    throw new Error("candidate legacy authority revision is invalid");
  }
  if (target !== "staging") {
    throw new Error("production requires tracking-ready authority; legacy bootstrap is staging-only");
  }
  if (rawManifest) {
    parseProtectedManifest(rawManifest, target);
    return {
      strategy: "manifest", revision: authority.revision,
      manifestSha256: createHash("sha256").update(rawManifest).digest("hex"),
    };
  }
  const { response, payload } = await request(base, token, "/v1/meta-ads-publish/config/bootstrap/derive-plan", {
    method: "POST", body: { expected_config_authority_revision: authority.revision }, fetchImpl,
  });
  const digest = String(payload?.manifest_sha256 || "").toLowerCase();
  if (!response.ok || payload?.ok !== true || String(payload?.config_authority_revision || "").toLowerCase() !== authority.revision
    || !READY_REVISION.test(digest) || !validSummary(payload.summary, target)) {
    throw new Error(`Token Vault internal bootstrap derivation failed: ${safeError(response, payload)}`);
  }
  return { strategy: "derive", revision: authority.revision, manifestSha256: digest };
}

function requireReady(result, context) {
  const authority = authorityState(result);
  if (!authority || authority.mode !== "tracking_ready") throw new Error(`${context} did not return a ready tracking authority`);
  return authority;
}

export async function applyBootstrap({ target, baseUrl, plan, sourceSha, transactionId, env = process.env, authorize, markAttempt, fetchImpl = fetch }) {
  if (!["staging", "production"].includes(target)) throw new Error("bootstrap target must be staging or production");
  const base = exactOrigin(baseUrl);
  const token = configToken(env);
  const operationKey = `meta-ads-bootstrap:${String(sourceSha || "").slice(0, 12)}:${transactionId}`;
  if (!/^[0-9a-f]{40}$/.test(String(sourceSha || "")) || !OPERATION.test(operationKey)) throw new Error("bootstrap operation identity is invalid");
  if (!["not_required", "manifest", "derive"].includes(plan?.strategy)
    || !(READY_REVISION.test(plan.revision) || LEGACY_REVISION.test(plan.revision))) {
    throw new Error("candidate bootstrap plan is invalid");
  }
  const initial = await request(base, token, "/v1/meta-ads-publish/config", { fetchImpl });
  const state = authorityState(initial);
  if (!state || state.revision !== plan.revision) throw new Error("configuration authority changed after candidate planning");
  if (state.mode === "tracking_ready") {
    if (plan.strategy !== "not_required" || plan.manifestSha256) throw new Error("tracking-ready bootstrap plan changed");
    requireReady(initial, "Token Vault configuration authority readback");
    return { status: "not_required" };
  }
  if (plan.strategy === "not_required" || !READY_REVISION.test(plan.manifestSha256)) throw new Error("legacy bootstrap plan is incomplete");
  if (typeof authorize !== "function" || typeof markAttempt !== "function") throw new Error("lease and durable attempt journal are required before bootstrap mutation");
  const raw = String(env.TOKEN_VAULT_META_ADS_BOOTSTRAP_MANIFEST || "");
  let route;
  let body;
  if (plan.strategy === "manifest") {
    if (createHash("sha256").update(raw).digest("hex") !== plan.manifestSha256) throw new Error("protected bootstrap manifest changed after candidate planning");
    const manifest = parseProtectedManifest(raw, target);
    route = "/v1/meta-ads-publish/config/bootstrap";
    body = { operation_key: operationKey, expected_config_authority_revision: plan.revision, entries: manifest.entries };
  } else {
    if (raw) throw new Error("derived bootstrap plan must not receive a protected manifest");
    route = "/v1/meta-ads-publish/config/bootstrap/derive";
    body = { operation_key: operationKey, expected_config_authority_revision: plan.revision, expected_manifest_sha256: plan.manifestSha256 };
  }
  await authorize();
  await markAttempt(operationKey);
  const result = await request(base, token, route, { method: "POST", body, fetchImpl });
  const revision = String(result.payload?.config_authority_revision || "").toLowerCase();
  if (!result.response.ok || result.payload?.ok !== true || !READY_REVISION.test(revision)) {
    throw new Error(`Token Vault ${plan.strategy} bootstrap failed: ${safeError(result.response, result.payload)}`);
  }
  const after = requireReady(await request(base, token, "/v1/meta-ads-publish/config", { fetchImpl }), "post-bootstrap readback");
  if (after.revision !== revision) throw new Error("post-bootstrap authority revision changed unexpectedly");
  return { status: "applied", operationKey, revision };
}

export async function rollbackBootstrap({ baseUrl, operationKey, revision, env = process.env, authorize, fetchImpl = fetch }) {
  if (!OPERATION.test(String(operationKey || "")) || !READY_REVISION.test(String(revision || ""))) {
    throw new Error("bootstrap rollback identity is invalid");
  }
  if (typeof authorize !== "function") throw new Error("lease authorization is required before bootstrap rollback");
  await authorize();
  const result = await request(exactOrigin(baseUrl), configToken(env), "/v1/meta-ads-publish/config/bootstrap/rollback", {
    method: "POST", body: { operation_key: operationKey, expected_tracking_binding_revision: revision }, fetchImpl,
  });
  if (!result.response.ok || result.payload?.ok !== true || result.payload?.rolled_back !== true
    || result.payload?.operation_status !== "rolled_back") {
    throw new Error(`Token Vault bootstrap rollback failed: ${safeError(result.response, result.payload)}`);
  }
  return "rolled_back";
}

export async function readAuthenticatedHealth({ target, baseUrl, env = process.env, fetchImpl = fetch }) {
  const base = exactOrigin(baseUrl);
  const anonymous = await fetchImpl(`${base}/internal/token-vault/health`, { cache: "no-store", redirect: "error", signal: AbortSignal.timeout(20_000) });
  if (anonymous.status !== 401) throw new Error("Token Vault anonymous health must remain unauthorized");
  const token = configToken(env);
  const health = await request(base, token, "/health", { fetchImpl });
  const checks = health.payload?.checks || {};
  if (!health.response.ok || health.payload?.ok !== true
    || !["apiToken", "n8nApiToken", "analyticsApiToken", "encryptionKey"].every((name) => checks[name] === true)) {
    throw new Error("Token Vault authenticated health readback failed");
  }
  const config = await request(base, token, "/v1/meta-ads-publish/config", { fetchImpl });
  requireReady(config, "Token Vault tracking authority readback");
  if (target === "staging") {
    const fixtures = (config.payload.destinations || []).filter((entry) => entry.tracking_contract?.destination_kind === "website"
      && entry.tracking_contract?.profile_configured && entry.tracking_contract?.url_tags_configured
      && entry.tracking_contract?.staging_synthetic_fixture === true);
    if (config.payload.capabilities?.tracking?.adset_conversion_reconciliation !== true || fixtures.length !== 1) {
      throw new Error("exactly one authorized synthetic Website tracking fixture is required in staging");
    }
  }
  return { ready: true, revision: config.payload.config_authority_revision };
}

export async function exerciseStagingFixture({ baseUrl, sourceSha, transactionId, env = process.env, authorize, markAttempt, fetchImpl = fetch }) {
  if (typeof authorize !== "function" || typeof markAttempt !== "function") {
    throw new Error("lease and durable attempt journal are required before staging fixture exercise");
  }
  const key = `staging-tracking-fixture:${transactionId}-${String(sourceSha || "").slice(0, 12)}`;
  if (!/^[0-9a-f]{40}$/.test(String(sourceSha || "")) || !OPERATION.test(key)) throw new Error("staging fixture operation identity is invalid");
  await authorize();
  await markAttempt(key);
  const result = await request(exactOrigin(baseUrl), configToken(env), "/v1/meta-ads-publish/config/staging-exercise", {
    method: "POST", body: { operation_key: key }, fetchImpl,
  });
  const exercise = result.payload?.exercise || {};
  if (!result.response.ok || result.payload?.ok !== true || exercise.status !== "reconciled_and_rolled_back"
    || exercise.reconciliation !== "reconciled" || exercise.rollback !== "restored" || exercise.fixture_count !== 1) {
    throw new Error(`staging tracking fixture exercise failed: ${safeError(result.response, result.payload)}`);
  }
  return "reconciled_and_rolled_back";
}
