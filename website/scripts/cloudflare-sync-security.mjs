const API = "https://api.cloudflare.com/client/v4";
const CHECK_MODE = process.argv.includes("--check");
const RATE_LIMIT_REF = "ef_booking_request_rl_v1";
const DESIRED_RULE = {
  ref: RATE_LIMIT_REF,
  description: "EF: rate limit booking requests (managed by repo)",
  expression: '(http.request.uri.path eq "/api/booking/request" and http.request.method eq "POST")',
  action: "block",
  enabled: true,
  ratelimit: {
    // This zone only supports a 10-second period; 2/10s preserves the prior 12/minute rate.
    characteristics: ["cf.colo.id", "ip.src"],
    period: 10,
    requests_per_period: 2,
    mitigation_timeout: 600,
  },
};

function env(name, fallback = "") {
  return (process.env[name] ?? fallback).toString().trim();
}

function log(msg) {
  console.log(`[cf-security] ${msg}`);
}

function isUnsupportedBotFightModeError(err) {
  const message = String(err?.message ?? "").toLowerCase();
  return message.includes("undefined zone setting: bot_fight_mode");
}

function isMissingRateLimitEntrypointError(err) {
  const message = String(err?.message ?? "").toLowerCase();
  return message.includes("could not find entrypoint ruleset in the http_ratelimit phase");
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
  let current;
  try {
    current = await cfFetch(`/zones/${zoneId}/settings/bot_fight_mode`);
  } catch (err) {
    if (isUnsupportedBotFightModeError(err)) {
      log("bot_fight_mode unsupported for this zone; skipping");
      return;
    }
    throw err;
  }
  const currentValue = (current?.value ?? "").toLowerCase();
  if (CHECK_MODE) {
    if (currentValue !== "on") {
      throw new Error("bot_fight_mode_not_on");
    }
    log("check: bot_fight_mode is on");
    return;
  }

  if (currentValue === "on") {
    log("bot_fight_mode already on");
    return;
  }

  try {
    await cfFetch(`/zones/${zoneId}/settings/bot_fight_mode`, {
      method: "PATCH",
      body: JSON.stringify({ value: "on" }),
    });
  } catch (err) {
    if (isUnsupportedBotFightModeError(err)) {
      log("bot_fight_mode unsupported for this zone; skipping");
      return;
    }
    throw err;
  }
  log("bot_fight_mode enabled");
}

function sameRateLimitConfig(rule) {
  if (!rule) return false;
  const rl = rule.ratelimit ?? {};
  return (
    rule.ref === DESIRED_RULE.ref &&
    rule.action === DESIRED_RULE.action &&
    rule.enabled === DESIRED_RULE.enabled &&
    rule.expression === DESIRED_RULE.expression &&
    rl.period === DESIRED_RULE.ratelimit.period &&
    rl.requests_per_period === DESIRED_RULE.ratelimit.requests_per_period &&
    rl.mitigation_timeout === DESIRED_RULE.ratelimit.mitigation_timeout &&
    JSON.stringify(rl.characteristics ?? []) === JSON.stringify(DESIRED_RULE.ratelimit.characteristics)
  );
}

async function assertRateLimitRule(zoneId) {
  let entrypoint;
  try {
    entrypoint = await cfFetch(`/zones/${zoneId}/rulesets/phases/http_ratelimit/entrypoint`);
  } catch (err) {
    if (isMissingRateLimitEntrypointError(err)) {
      throw new Error("rate_limit_rule_drift_detected");
    }
    throw err;
  }
  const existingRules = Array.isArray(entrypoint?.rules) ? entrypoint.rules : [];
  const matched = existingRules.find((rule) => rule?.ref === RATE_LIMIT_REF);
  if (!sameRateLimitConfig(matched)) {
    throw new Error("rate_limit_rule_drift_detected");
  }
  log("check: rate limit rule matches desired config");
}

async function upsertRateLimitRule(zoneId) {
  let entrypoint;
  try {
    entrypoint = await cfFetch(`/zones/${zoneId}/rulesets/phases/http_ratelimit/entrypoint`);
  } catch (err) {
    if (!isMissingRateLimitEntrypointError(err)) {
      throw err;
    }
  }

  if (!entrypoint) {
    await cfFetch(`/zones/${zoneId}/rulesets`, {
      method: "POST",
      body: JSON.stringify({
        name: "default",
        description: "EF: zone-level rate limiting ruleset (managed by repo)",
        kind: "zone",
        phase: "http_ratelimit",
        rules: [DESIRED_RULE],
      }),
    });
    log("rate limit entrypoint created (http_ratelimit)");
    return;
  }

  const existingRules = Array.isArray(entrypoint?.rules) ? entrypoint.rules : [];
  const preserved = existingRules.filter((r) => r?.ref !== RATE_LIMIT_REF);

  await cfFetch(`/zones/${zoneId}/rulesets/phases/http_ratelimit/entrypoint`, {
    method: "PUT",
    body: JSON.stringify({
      name: entrypoint?.name ?? "default",
      description: entrypoint?.description ?? "",
      rules: [...preserved, DESIRED_RULE],
    }),
  });

  log("rate limit rule upserted (http_ratelimit)");
}

async function run() {
  const zoneName = env("CF_ZONE_NAME", "espacofacial.com");
  log(`${CHECK_MODE ? "check" : "sync"} start (zone=${zoneName})`);
  const zoneId = await getZoneIdByName(zoneName);

  if (CHECK_MODE) {
    await tryEnableBotFightMode(zoneId);
    await assertRateLimitRule(zoneId);
    log("check done");
    return;
  }

  await tryEnableBotFightMode(zoneId);
  await upsertRateLimitRule(zoneId);
  await assertRateLimitRule(zoneId);

  log("sync done");
}

run().catch((err) => {
  console.error("[cf-security] FAILED:", err?.message ?? err);
  process.exit(1);
});
