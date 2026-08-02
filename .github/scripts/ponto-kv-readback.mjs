const API_BASE = "https://api.cloudflare.com/client/v4";
const HEX32 = /^[0-9a-f]{32}$/i;

const requireValue = (value, label) => {
  const normalized = String(value || "").trim();
  if (!normalized) throw new Error(`${label} is required`);
  return normalized;
};

const readbackError = (message, code) => Object.assign(new Error(message), { code });

/**
 * Read a JSON-valued KV record through the account-scoped Cloudflare API.
 * The returned value is kept in memory for custody comparison. Response
 * bodies and credentials are deliberately excluded from errors and logs.
 */
export async function readCloudflareKvJson({
  accountId,
  namespaceId,
  key,
  apiToken,
  fetchImpl = fetch,
}) {
  const account = requireValue(accountId, "Cloudflare account ID").toLowerCase();
  const namespace = requireValue(namespaceId, "Cloudflare KV namespace ID").toLowerCase();
  const recordKey = requireValue(key, "Cloudflare KV key");
  const token = requireValue(apiToken, "Cloudflare API token");
  if (!HEX32.test(account) || !HEX32.test(namespace)) {
    throw new Error("Cloudflare account or KV namespace ID is malformed");
  }

  let response;
  try {
    response = await fetchImpl(
      `${API_BASE}/accounts/${encodeURIComponent(account)}/storage/kv/namespaces/${encodeURIComponent(namespace)}/values/${encodeURIComponent(recordKey)}`,
      {
        method: "GET",
        headers: {
          authorization: `Bearer ${token}`,
          accept: "application/json",
        },
        signal: AbortSignal.timeout(30_000),
      },
    );
  } catch {
    throw readbackError(
      "Cloudflare KV readback request failed",
      "cloudflare-kv-readback-request-failed",
    );
  }
  let raw;
  try {
    raw = await response.text();
  } catch {
    throw readbackError(
      "Cloudflare KV readback body unavailable",
      "cloudflare-kv-readback-body-unavailable",
    );
  }
  if (!response.ok) {
    throw readbackError(
      `Cloudflare KV readback failed (HTTP ${response.status})`,
      `cloudflare-kv-readback-http-${response.status}`,
    );
  }
  let value;
  try {
    value = JSON.parse(raw);
  } catch {
    throw readbackError(
      "Cloudflare KV readback is not valid JSON",
      "cloudflare-kv-readback-invalid-json",
    );
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw readbackError(
      "Cloudflare KV readback JSON shape is invalid",
      "cloudflare-kv-readback-invalid-shape",
    );
  }
  return value;
}
