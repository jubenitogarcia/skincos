import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const [rulesetFile, reportFile] = process.argv.slice(2);
const zoneId = String(process.env.CLOUDFLARE_ZONE_ID || "").trim().toLowerCase();
const releaseSha = String(process.env.RELEASE_SHA || "").trim().toLowerCase();
const stage = String(process.env.STAGE || "").trim().toLowerCase();
const expectedRulesetId = String(process.env.PONTO_WAF_RULESET_ID || "").trim().toLowerCase();
const expectedHeaderRuleId = String(process.env.PONTO_WAF_HEADER_RULE_ID || "").trim().toLowerCase();
const expectedContractRuleId = String(process.env.PONTO_WAF_CONTRACT_RULE_ID || "").trim().toLowerCase();
const allowedHosts = ["api.skincos.com.br", "api-staging.skincos.com.br"];
const expectedDescriptions = {
  header: "ponto-release-block-public-version-selection-v1",
  contract: "ponto-release-block-public-workforce-contract-v1",
};
const expectedExpressions = {
  header: '(http.host in {"api.skincos.com.br" "api-staging.skincos.com.br"} and (any(lower(http.request.headers.names[*])[*] eq "cloudflare-workers-version-overrides") or any(lower(http.request.headers.names[*])[*] eq "cloudflare-workers-version-key")))',
  contract: '(http.host in {"api.skincos.com.br" "api-staging.skincos.com.br"} and lower(http.request.uri.path) eq "/insumos/health/workforce-contract")',
};

if (!rulesetFile || !reportFile) throw new Error("ruleset and report paths are required");
if (
  !/^[0-9a-f]{32}$/.test(zoneId)
  || !/^[0-9a-f]{40}$/.test(releaseSha)
  || !["staging", "pilot", "canary", "production"].includes(stage)
  || ![expectedRulesetId, expectedHeaderRuleId, expectedContractRuleId].every(value => /^[0-9a-f]{32}$/.test(value))
) {
  throw new Error("edge guard provenance is invalid");
}

const payload = JSON.parse(fs.readFileSync(rulesetFile, "utf8"));
if (payload?.success !== true || !payload?.result || payload.result.phase !== "http_request_firewall_custom") {
  throw new Error("zone custom WAF entrypoint could not be attested");
}
if (String(payload.result.id || "").toLowerCase() !== expectedRulesetId) {
  throw new Error("zone custom WAF ruleset differs from the pinned ruleset");
}
const rules = Array.isArray(payload.result.rules) ? payload.result.rules : [];
const normalizeExpression = value => String(value || "")
  .trim()
  .toLowerCase()
  .replace(/\s+/g, " ");
const exactRule = (id, description, expression) => {
  const matches = rules.filter(rule => String(rule?.id || "").toLowerCase() === id);
  if (matches.length !== 1) throw new Error(`pinned WAF rule ${id} is absent or duplicated`);
  const rule = matches[0];
  if (
    rule.enabled === false
    || rule.action !== "block"
    || String(rule.description || "").trim() !== description
    || normalizeExpression(rule.expression) !== normalizeExpression(expression)
    || rule.action_parameters
    || rule.ratelimit
  ) {
    throw new Error(`pinned WAF rule ${id} differs from the reviewed unconditional contract`);
  }
  return { id, description, expression: normalizeExpression(rule.expression) };
};
const headerRule = exactRule(expectedHeaderRuleId, expectedDescriptions.header, expectedExpressions.header);
const contractRule = exactRule(expectedContractRuleId, expectedDescriptions.contract, expectedExpressions.contract);

const probes = [];
for (const host of allowedHosts) {
  const negative = await fetch(`https://${host}/health?edge_override_guard_negative=${Date.now()}`, {
    redirect: "manual",
    signal: AbortSignal.timeout(15_000),
    headers: { accept: "application/json", "cache-control": "no-cache" },
  });
  const negativePassed = negative.status >= 200 && negative.status < 400
    && Boolean(negative.headers.get("cf-ray"))
    && String(negative.headers.get("server") || "").toLowerCase() === "cloudflare";
  probes.push({
    host,
    kind: "negative-control",
    status: negative.status,
    cloudflareRayPresent: Boolean(negative.headers.get("cf-ray")),
    passed: negativePassed,
  });
  if (!negativePassed) throw new Error(`negative WAF control did not reach ${host} successfully`);
  for (const header of ["cloudflare-workers-version-overrides", "cloudflare-workers-version-key"]) {
    const response = await fetch(`https://${host}/health?edge_override_guard=${Date.now()}`, {
      redirect: "manual",
      signal: AbortSignal.timeout(15_000),
      headers: {
        accept: "application/json",
        [header]: header.endsWith("overrides")
          ? 'skincos-api="11111111-1111-4111-8111-111111111111"'
          : "11111111-1111-4111-8111-111111111111",
      },
    });
    const passed = response.status === 403
      && Boolean(response.headers.get("cf-ray"))
      && String(response.headers.get("server") || "").toLowerCase() === "cloudflare";
    probes.push({
      host,
      header,
      status: response.status,
      cloudflareRayPresent: Boolean(response.headers.get("cf-ray")),
      passed,
    });
    if (!passed) throw new Error(`direct ${header} was not blocked on ${host}`);
  }
  const response = await fetch(`https://${host}/insumos/health/workforce-contract?edge_guard=${Date.now()}`, {
    redirect: "manual",
    signal: AbortSignal.timeout(15_000),
    headers: {
      accept: "application/json",
      "x-skincos-release-probe": "ponto-v1",
    },
  });
  const passed = response.status === 403
    && Boolean(response.headers.get("cf-ray"))
    && String(response.headers.get("server") || "").toLowerCase() === "cloudflare";
  probes.push({
    host,
    path: "/insumos/health/workforce-contract",
    status: response.status,
    cloudflareRayPresent: Boolean(response.headers.get("cf-ray")),
    passed,
  });
  if (!passed) throw new Error(`direct workforce contract path was not blocked on ${host}`);
}

const ruleIds = [...new Set([headerRule.id, contractRule.id])];
const summary = {
  schemaVersion: 1,
  releaseSha,
  stage,
  zoneId,
  rulesetId: payload.result.id,
  ruleIds,
  ruleDescriptions: [headerRule.description, contractRule.description],
  rulesetVersion: String(payload.result.version || ""),
  ruleAction: "block",
  phase: "http_request_firewall_custom",
  unconditional: true,
  upstreamZoneExemption: false,
  blockedHeaders: ["cloudflare-workers-version-overrides", "cloudflare-workers-version-key"],
  blockedPath: "/insumos/health/workforce-contract",
  hosts: allowedHosts,
  probes,
  passed: probes.every(probe => probe.passed),
  credentialsIncluded: false,
  piiIncluded: false,
};
const report = {
  ...summary,
  digest: crypto.createHash("sha256").update(JSON.stringify(summary)).digest("hex"),
};
fs.mkdirSync(path.dirname(reportFile), { recursive: true });
fs.writeFileSync(reportFile, `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 });
process.stdout.write(`Attested canonical WAF rules ${ruleIds.join(",")} and ${probes.length} unconditional block probes.\n`);
