import fs from "node:fs";

const CONTRACT = "meta-ads-tracking-v20/staging-synthetic-seed/v2";
const OPERATION = /^meta-ads-staging-seed:[A-Za-z0-9_.:-]{8,140}$/;
const PREVIEW = /^https:\/\/(?:[a-z0-9-]+\.)+workers\.dev$/;
const PREFIX = "/internal/token-vault/v1/meta-ads-publish/config/staging-synthetic-seed";

function safeError(response, payload) {
  const code = String(payload?.error || "");
  return `${response.status} ${/^[a-z0-9_:-]{1,120}$/i.test(code) ? code : "unknown"}`;
}

export function stagingMetaSource(env = process.env) {
  const accessToken = String(env.META_ADS_ACCESS_TOKEN || "");
  const accountId = String(env.META_ADS_ACCOUNT_ID || "").replace(/^act_/, "");
  const pixelId = String(env.META_PIXEL_ID || "");
  const apiVersion = String(env.META_ADS_API_VERSION || "");
  const destinationPageIds = {
    novo_hamburgo: String(env.META_ADS_NOVOHAMBURGO_PAGE_ID || ""),
    barra_shopping_sul: String(env.META_ADS_BARRASHOPPPINGSUL_PAGE_ID || ""),
  };
  if (!accessToken || !/^[0-9]{5,30}$/.test(accountId) || !/^[0-9]{5,30}$/.test(pixelId)
    || !/^v(?:2[5-9]|[3-9][0-9])\.0$/.test(apiVersion)
    || !Object.values(destinationPageIds).every((id) => /^[0-9]{5,30}$/.test(id))
    || destinationPageIds.novo_hamburgo === destinationPageIds.barra_shopping_sul) {
    throw new Error("staging synthetic Meta source custody is unavailable or malformed");
  }
  return { accessToken, accountId, pixelId, apiVersion, destinationPageIds };
}

function candidate(previewUrl, seedFile) {
  const preview = String(previewUrl || "").replace(/\/+$/, "");
  if (!PREVIEW.test(preview)) throw new Error("immutable staging synthetic-seed preview URL is invalid");
  const metadata = fs.statSync(seedFile);
  if (!metadata.isFile() || (metadata.mode & 0o077) !== 0) throw new Error("staging synthetic-seed bearer file is not private");
  const seedToken = fs.readFileSync(seedFile, "utf8").trim();
  if (!/^[A-Za-z0-9_-]{64,}$/.test(seedToken)) throw new Error("staging synthetic-seed bearer is invalid");
  return { preview, seedToken };
}

function operationKey(sourceSha, transactionId) {
  const key = `meta-ads-staging-seed:${String(sourceSha || "").slice(0, 12)}:${transactionId}`;
  if (!OPERATION.test(key) || !/^[0-9a-f]{40}$/.test(String(sourceSha || ""))) {
    throw new Error("staging synthetic-seed operation identity is invalid");
  }
  return key;
}

async function post({ preview, seedToken, endpoint, body, fetchImpl }) {
  const response = await fetchImpl(`${preview}${PREFIX}${endpoint}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${seedToken}`, "content-type": "application/json" },
    body: JSON.stringify(body),
    cache: "no-store",
    redirect: "error",
    signal: AbortSignal.timeout(30_000),
  });
  let payload = null;
  try { payload = await response.json(); } catch {}
  return { response, payload };
}

export async function attestStagingSource({ previewUrl, seedFile, sourceSha, transactionId, env = process.env, fetchImpl = fetch }) {
  const { preview, seedToken } = candidate(previewUrl, seedFile);
  const source = stagingMetaSource(env);
  const key = operationKey(sourceSha, transactionId);
  const { response, payload } = await post({
    preview, seedToken, endpoint: "/attest",
    body: {
      operation_key: key,
      access_token: source.accessToken,
      account_id: source.accountId,
      pixel_id: source.pixelId,
      destination_page_ids: source.destinationPageIds,
      api_version: source.apiVersion,
    }, fetchImpl,
  });
  const allowed = new Set(["ok", "attestation", "operation_key", "contract_version", "requestId"]);
  if (!response.ok || payload?.ok !== true || !Object.keys(payload).every((name) => allowed.has(name))
    || payload.attestation !== "match" || payload.operation_key !== key || payload.contract_version !== CONTRACT
    || typeof payload.requestId !== "string") {
    throw new Error(`staging synthetic-seed source attestation failed: ${safeError(response, payload)}`);
  }
  return key;
}

export async function reconcileStagingSeed({ previewUrl, seedFile, env = process.env, authorize, fetchImpl = fetch }) {
  if (typeof authorize !== "function") throw new Error("lease authorization is required before seed reconciliation");
  const { preview, seedToken } = candidate(previewUrl, seedFile);
  const source = stagingMetaSource(env);
  await authorize();
  const { response, payload } = await post({
    preview, seedToken, endpoint: "/reconcile",
    body: { access_token: source.accessToken, account_id: source.accountId, api_version: source.apiVersion }, fetchImpl,
  });
  const allowed = new Set(["ok", "reconciled", "operation_status", "contract_version", "requestId"]);
  if (!response.ok || payload?.ok !== true || !Object.keys(payload).every((name) => allowed.has(name))
    || !["not_required", "rolled_back"].includes(payload.operation_status)
    || typeof payload.reconciled !== "boolean" || payload.contract_version !== CONTRACT
    || typeof payload.requestId !== "string") {
    throw new Error(`staging synthetic-seed reconciliation failed: ${safeError(response, payload)}`);
  }
  return payload.operation_status;
}

export async function sealStagingSeed({ previewUrl, seedFile, sourceSha, transactionId, env = process.env, authorize, markAttempt, fetchImpl = fetch }) {
  if (typeof authorize !== "function" || typeof markAttempt !== "function") {
    throw new Error("lease and durable attempt journal are required before seed mutation");
  }
  const { preview, seedToken } = candidate(previewUrl, seedFile);
  const source = stagingMetaSource(env);
  const key = operationKey(sourceSha, transactionId);
  await authorize();
  await markAttempt(key);
  const { response, payload } = await post({
    preview, seedToken, endpoint: "",
    body: {
      operation_key: key,
      access_token: source.accessToken,
      account_id: source.accountId,
      pixel_id: source.pixelId,
      destination_page_ids: source.destinationPageIds,
      api_version: source.apiVersion,
    }, fetchImpl,
  });
  const status = String(payload?.seed || "");
  if (!response.ok || payload?.ok !== true || !["sealed", "not_required"].includes(status)
    || payload.operation_status !== status || typeof payload.replayed !== "boolean"
    || payload.operation_key !== key || payload.contract_version !== CONTRACT) {
    throw new Error(`staging synthetic-seed failed: ${safeError(response, payload)}`);
  }
  return { status, operationKey: key };
}

export async function rollbackStagingSeed({ previewUrl, seedFile, operationKey: key, env = process.env, authorize, allowAbsent = false, fetchImpl = fetch }) {
  if (typeof authorize !== "function") throw new Error("lease authorization is required before seed rollback");
  if (!OPERATION.test(String(key || ""))) throw new Error("staging synthetic-seed rollback identity is invalid");
  const { preview, seedToken } = candidate(previewUrl, seedFile);
  const source = stagingMetaSource(env);
  await authorize();
  const { response, payload } = await post({
    preview, seedToken, endpoint: "/rollback",
    body: { operation_key: key, access_token: source.accessToken, account_id: source.accountId, api_version: source.apiVersion }, fetchImpl,
  });
  if (allowAbsent && response.status === 409 && payload?.ok === false
    && payload.error === "meta_ads_publish_staging_seed_operation_not_found") return "not_found";
  if (!response.ok || payload?.ok !== true || payload.rolled_back !== true || payload.operation_status !== "rolled_back"
    || typeof payload.replayed !== "boolean" || payload.operation_key !== key || payload.contract_version !== CONTRACT) {
    throw new Error(`staging synthetic-seed rollback failed: ${safeError(response, payload)}`);
  }
  return "rolled_back";
}
