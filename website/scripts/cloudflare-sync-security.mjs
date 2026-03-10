const API = "https://api.cloudflare.com/client/v4";

function env(name, fallback = "") {
  return (process.env[name] ?? fallback).toString().trim();
}

function log(msg) {
  console.log(`[cf-security] ${msg}`);
}

async function cfFetch(path, init = {}) {
  const token = env("CLOUDFLARE_API_TOKEN");
  if (!token) throw new Error("missing CLOUDFLARE_API_TOKEN");

  const res = await fetch(`${API}${path}`, {
    ...init,
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
      ...(init.headers ?? {}),
    },
  });
  const json = await res.json().catch(() => null);
  if (!res.ok || !json || json.success !== true) {
    const msg = (json && (json.errors?.[0]?.message || json.messages?.[0]?.message)) || `HTTP ${res.status}`;
    const err = new Error(`Cloudflare API error: ${msg}`);
    err.cause = json;
    throw err;
  }
  return json.result;
}

async function getZoneIdByName(zoneName) {
  const result = await cfFetch(`/zones?name=${encodeURIComponent(zoneName)}&status=active&page=1&per_page=1`);
  const zone = Array.isArray(result) ? result[0] : null;
  if (!zone?.id) throw new Error(`zone_not_found:${zoneName}`);
  return zone.id;
}

async function tryEnableBotFightMode(zoneId) {
  try {
    const current = await cfFetch(`/zones/${zoneId}/settings/bot_fight_mode`);
    if ((current?.value ?? "").toLowerCase() === "on") {
      log("bot_fight_mode already on");
      return;
    }
    await cfFetch(`/zones/${zoneId}/settings/bot_fight_mode`, {
      method: "PATCH",
      body: JSON.stringify({ value: "on" }),
    });
    log("bot_fight_mode enabled");
  } catch (err) {
    log(`WARN: could not enable bot_fight_mode (${err?.message ?? err})`);
  }
}

async function upsertRateLimitRule(zoneId) {
  const entrypoint = await cfFetch(`/zones/${zoneId}/rulesets/phases/http_ratelimit/entrypoint`);
  const existingRules = Array.isArray(entrypoint?.rules) ? entrypoint.rules : [];

  const REF = "ef_booking_request_rl_v1";
  const preserved = existingRules.filter((r) => r?.ref !== REF);

  // Conservative threshold: only blocks obvious abuse; legit users will never hit this.
  const rule = {
    ref: REF,
    description: "EF: rate limit booking requests (managed by repo)",
    expression: '(http.request.uri.path eq "/api/booking/request" and http.request.method eq "POST")',
    action: "block",
    enabled: true,
    ratelimit: {
      characteristics: ["ip.src"],
      period: 60,
      requests_per_period: 12,
      mitigation_timeout: 600,
    },
  };

  await cfFetch(`/zones/${zoneId}/rulesets/phases/http_ratelimit/entrypoint`, {
    method: "PUT",
    body: JSON.stringify({
      name: entrypoint?.name ?? "default",
      description: entrypoint?.description ?? "",
      rules: [...preserved, rule],
    }),
  });

  log("rate limit rule upserted (http_ratelimit)");
}

async function run() {
  const zoneName = env("CF_ZONE_NAME", "espacofacial.com");
  log(`sync start (zone=${zoneName})`);
  const zoneId = await getZoneIdByName(zoneName);

  await tryEnableBotFightMode(zoneId);
  await upsertRateLimitRule(zoneId);

  log("sync done");
}

run().catch((err) => {
  console.error("[cf-security] FAILED:", err?.message ?? err);
  process.exit(1);
});
