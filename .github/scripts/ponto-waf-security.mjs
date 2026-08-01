import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const API_BASE = "https://api.cloudflare.com/client/v4";
const HEX32 = /^[0-9a-f]{32}$/;
const SHA = /^[0-9a-f]{40}$/;
const PHASE = "http_request_firewall_custom";
const ZONE_NAME = "skincos.com.br";
const RULESET_DESCRIPTION = "SKINCOS zone custom WAF entrypoint (Ponto contract managed by repo)";
const ALLOWED_RULE_KEYS = new Set([
  "action",
  "action_parameters",
  "categories",
  "description",
  "enabled",
  "exposed_credential_check",
  "expression",
  "id",
  "logging",
  "ratelimit",
  "ref",
]);

export const PONTO_WAF_RULES = Object.freeze([
  Object.freeze({
    ref: "ponto_release_block_public_version_selection_v1",
    description: "ponto-release-block-public-version-selection-v1",
    expression: '(http.host in {"api.skincos.com.br" "api-staging.skincos.com.br"} and (http.request.headers.truncated or has_key(http.request.headers, "cloudflare-workers-version-overrides") or has_key(http.request.headers, "cloudflare-workers-version-key")))',
    action: "block",
    enabled: true,
  }),
  Object.freeze({
    ref: "ponto_release_block_public_workforce_contract_v1",
    description: "ponto-release-block-public-workforce-contract-v1",
    expression: '(http.host in {"api.skincos.com.br" "api-staging.skincos.com.br"} and lower(url_decode(http.request.uri.path, "r")) eq "/insumos/health/workforce-contract")',
    action: "block",
    enabled: true,
  }),
]);

const required = (env, name) => {
  const value = String(env[name] || "").trim();
  if (!value) throw new Error(`missing ${name}`);
  return value;
};

const canonicalize = (value) => {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.keys(value)
      .sort()
      .map((key) => [key, canonicalize(value[key])]),
  );
};

export const stableJson = (value) => JSON.stringify(canonicalize(value));
export const digest = (value) =>
  `sha256:${crypto.createHash("sha256").update(stableJson(value)).digest("hex")}`;
const contentDigest = (snapshot) => digest({
  ...snapshot,
  version: "",
});

const normalizeExpression = (value) =>
  String(value || "").trim().replace(/\s+/g, " ");

const clone = (value) => JSON.parse(JSON.stringify(value));

export function writableRule(rule) {
  if (!rule || typeof rule !== "object" || Array.isArray(rule)) {
    throw new Error("custom WAF rule is not an object");
  }
  const unsupported = Object.keys(rule).filter(
    (key) => !ALLOWED_RULE_KEYS.has(key) && !["last_updated", "version"].includes(key),
  );
  if (unsupported.length) {
    throw new Error(`custom WAF rule has unsupported fields: ${unsupported.sort().join(",")}`);
  }
  const result = {};
  for (const key of ALLOWED_RULE_KEYS) {
    if (rule[key] !== undefined) result[key] = clone(rule[key]);
  }
  if (!String(result.action || "") || !String(result.expression || "")) {
    throw new Error("custom WAF rule is missing action or expression");
  }
  if (result.id !== undefined && !HEX32.test(String(result.id).toLowerCase())) {
    throw new Error("custom WAF rule ID is invalid");
  }
  return result;
}

export function captureSnapshot(entrypoint) {
  if (!entrypoint) {
    return {
      exists: false,
      id: "",
      version: "",
      name: "",
      description: "",
      kind: "",
      phase: PHASE,
      rules: [],
    };
  }
  const id = String(entrypoint.id || "").toLowerCase();
  const version = String(entrypoint.version || "");
  const rules = Array.isArray(entrypoint.rules) ? entrypoint.rules.map(writableRule) : [];
  if (
    !HEX32.test(id)
    || !/^[1-9][0-9]*$/.test(version)
    || entrypoint.kind !== "zone"
    || entrypoint.phase !== PHASE
  ) throw new Error("custom WAF entrypoint identity is invalid");
  return {
    exists: true,
    id,
    version,
    name: String(entrypoint.name || ""),
    description: String(entrypoint.description || ""),
    kind: "zone",
    phase: PHASE,
    rules,
  };
}

const ruleMatchesIdentity = (rule, desired) =>
  String(rule?.ref || "") === desired.ref
  || String(rule?.description || "") === desired.description;

const exactDesiredRule = (rule, desired) => Boolean(
  rule
  && HEX32.test(String(rule.id || "").toLowerCase())
  && rule.ref === desired.ref
  && rule.description === desired.description
  && rule.action === "block"
  && rule.enabled === true
  && normalizeExpression(rule.expression) === normalizeExpression(desired.expression)
  && rule.action_parameters === undefined
  && rule.ratelimit === undefined
);

export function buildDesiredRules(existingRules) {
  if (!Array.isArray(existingRules)) throw new Error("existing WAF rules must be an array");
  const selected = new Map();
  for (const desired of PONTO_WAF_RULES) {
    const matches = existingRules.filter((rule) => ruleMatchesIdentity(rule, desired));
    if (matches.length > 1) {
      throw new Error(`Ponto WAF rule identity is ambiguous: ${desired.ref}`);
    }
    if (matches.length === 1) selected.set(desired.ref, matches[0]);
  }
  const selectedRules = new Set(selected.values());
  const preserved = existingRules.filter((rule) => !selectedRules.has(rule)).map(writableRule);
  const managed = PONTO_WAF_RULES.map((desired) => {
    const result = { ...desired };
    const priorId = String(selected.get(desired.ref)?.id || "").toLowerCase();
    if (priorId) {
      if (!HEX32.test(priorId)) throw new Error(`Ponto WAF prior rule ID is invalid: ${desired.ref}`);
      result.id = priorId;
    }
    return result;
  });
  return [...managed, ...preserved];
}

export function attestContract(entrypoint) {
  const snapshot = captureSnapshot(entrypoint);
  if (!snapshot.exists) throw new Error("custom WAF entrypoint is absent");
  if (snapshot.rules.length < PONTO_WAF_RULES.length) {
    throw new Error("Ponto WAF rules are absent");
  }
  const ids = {};
  for (let index = 0; index < PONTO_WAF_RULES.length; index += 1) {
    const desired = PONTO_WAF_RULES[index];
    const rule = snapshot.rules[index];
    if (!exactDesiredRule(rule, desired)) {
      throw new Error(`Ponto WAF rule is not exact at position ${index}`);
    }
    ids[desired.ref] = String(rule.id).toLowerCase();
  }
  for (const desired of PONTO_WAF_RULES) {
    const matches = snapshot.rules.filter((rule) => ruleMatchesIdentity(rule, desired));
    if (matches.length !== 1) {
      throw new Error(`Ponto WAF rule is absent or duplicated: ${desired.ref}`);
    }
  }
  return {
    rulesetId: snapshot.id,
    rulesetVersion: snapshot.version,
    headerRuleId: ids[PONTO_WAF_RULES[0].ref],
    contractRuleId: ids[PONTO_WAF_RULES[1].ref],
    firstRuleIds: snapshot.rules.slice(0, 2).map((rule) => String(rule.id).toLowerCase()),
  };
}

export function publicSnapshot(snapshot) {
  return {
    exists: snapshot.exists,
    rulesetId: snapshot.id,
    rulesetVersion: snapshot.version,
    phase: snapshot.phase,
    kind: snapshot.kind || null,
    ruleCount: snapshot.rules.length,
    orderedRules: snapshot.rules.map((rule, index) => ({
      position: index,
      id: HEX32.test(String(rule.id || "").toLowerCase()) ? String(rule.id).toLowerCase() : null,
      refDigest: digest(String(rule.ref || "")),
      descriptionDigest: digest(String(rule.description || "")),
      expressionDigest: digest(normalizeExpression(rule.expression)),
      action: String(rule.action || ""),
      enabled: rule.enabled !== false,
    })),
    snapshotDigest: digest(snapshot),
    contentDigest: contentDigest(snapshot),
    credentialsIncluded: false,
    piiIncluded: false,
  };
}

function samePreservedRules(before, after) {
  const priorManaged = new Set();
  for (const desired of PONTO_WAF_RULES) {
    const matches = before.rules.filter((rule) => ruleMatchesIdentity(rule, desired));
    if (matches.length === 1) priorManaged.add(matches[0]);
  }
  const priorPreserved = before.rules.filter((rule) => !priorManaged.has(rule)).map(writableRule);
  const afterPreserved = after.rules.slice(PONTO_WAF_RULES.length).map(writableRule);
  return stableJson(priorPreserved) === stableJson(afterPreserved);
}

function isOwnedDesiredPostimage(before, live) {
  if (!live.exists) return false;
  if (before.exists && live.id !== before.id) return false;
  if (
    live.description !== (before.exists
      ? before.description || RULESET_DESCRIPTION
      : RULESET_DESCRIPTION)
    || !samePreservedRules(before, live)
  ) return false;
  try {
    attestContract({
      id: live.id,
      version: live.version,
      name: live.name,
      description: live.description,
      kind: live.kind,
      phase: live.phase,
      rules: live.rules,
    });
  } catch {
    return false;
  }
  for (let index = 0; index < PONTO_WAF_RULES.length; index += 1) {
    const prior = before.rules.find((rule) =>
      ruleMatchesIdentity(rule, PONTO_WAF_RULES[index]));
    if (
      prior?.id
      && String(live.rules[index]?.id || "").toLowerCase()
        !== String(prior.id).toLowerCase()
    ) return false;
  }
  return true;
}

const responseJson = async (response) => {
  const text = await response.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`Cloudflare returned non-JSON HTTP ${response.status}`);
  }
};

export function createCloudflareClient({ token, fetchImpl = fetch }) {
  if (!token) throw new Error("Cloudflare security token is missing");
  const request = async (pathname, { method = "GET", body, accepted = [] } = {}) => {
    const response = await fetchImpl(`${API_BASE}${pathname}`, {
      method,
      signal: AbortSignal.timeout(30_000),
      headers: {
        accept: "application/json",
        authorization: `Bearer ${token}`,
        ...(body === undefined ? {} : { "content-type": "application/json" }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const envelope = await responseJson(response);
    if (accepted.includes(response.status)) {
      return { status: response.status, result: envelope?.result ?? null };
    }
    if (!response.ok || (response.status !== 204 && envelope?.success !== true)) {
      const code = envelope?.errors?.[0]?.code;
      throw new Error(`Cloudflare ${method} ${pathname} failed with HTTP ${response.status}${code ? ` code ${code}` : ""}`);
    }
    return { status: response.status, result: envelope?.result ?? null };
  };
  return { request };
}

async function readEntrypoint(client, zoneId) {
  const response = await client.request(
    `/zones/${zoneId}/rulesets/phases/${PHASE}/entrypoint`,
    { accepted: [404] },
  );
  return response.status === 404 ? null : response.result;
}

async function verifyCustody(client, accountId) {
  if (!HEX32.test(accountId)) throw new Error("Cloudflare account id for token verification is invalid");
  const token = await client.request(`/accounts/${accountId}/tokens/verify`);
  if (token.result?.status !== "active") throw new Error("Cloudflare security token is not active");
  const expressionDigests = [];
  for (const rule of PONTO_WAF_RULES) {
    await client.request(`/filters/validate-expr?expression=${encodeURIComponent(rule.expression)}`);
    expressionDigests.push(digest(normalizeExpression(rule.expression)));
  }
  return {
    tokenActive: true,
    zoneReadable: true,
    expressionDialectValidated: true,
    expressionDigests,
    zoneName: ZONE_NAME,
    accountId: accountId.toLowerCase(),
  };
}

export async function runPublicProbes({ fetchImpl = fetch, requireBlocks }) {
  const observations = [];
  for (const host of ["api.skincos.com.br", "api-staging.skincos.com.br"]) {
    const nonce = `${Date.now()}-${crypto.randomBytes(4).toString("hex")}`;
    const negative = await fetchImpl(`https://${host}/health?ponto_waf_negative=${nonce}`, {
      redirect: "manual",
      signal: AbortSignal.timeout(15_000),
      headers: { accept: "application/json", "cache-control": "no-cache" },
    });
    const negativePassed = negative.status >= 200 && negative.status < 400
      && Boolean(negative.headers.get("cf-ray"))
      && String(negative.headers.get("server") || "").toLowerCase() === "cloudflare";
    observations.push({
      host,
      kind: "negative-control",
      status: negative.status,
      cloudflareRayPresent: Boolean(negative.headers.get("cf-ray")),
      passed: negativePassed,
    });
    if (!negativePassed) throw new Error(`negative WAF control failed for ${host}`);

    for (const [kind, pathname, headers] of [
      [
        "version-overrides-header",
        "/health",
        { "cloudflare-workers-version-overrides": 'skincos-api="11111111-1111-4111-8111-111111111111"' },
      ],
      [
        "version-key-header",
        "/health",
        { "cloudflare-workers-version-key": "11111111-1111-4111-8111-111111111111" },
      ],
      ["workforce-contract-path", "/insumos/health/workforce-contract", {}],
      ["encoded-workforce-contract-path", "/%69nsumos/health/workforce-contract", {}],
      ["double-encoded-workforce-contract-path", "/%2569nsumos/health/workforce-contract", {}],
      ["case-folded-workforce-contract-path", "/INSUMOS/HEALTH/WORKFORCE-CONTRACT", {}],
    ]) {
      const response = await fetchImpl(`https://${host}${pathname}?ponto_waf_probe=${nonce}`, {
        redirect: "manual",
        signal: AbortSignal.timeout(15_000),
        headers: { accept: "application/json", "cache-control": "no-cache", ...headers },
      });
      const passed = response.status === 403
        && Boolean(response.headers.get("cf-ray"))
        && String(response.headers.get("server") || "").toLowerCase() === "cloudflare";
      observations.push({
        host,
        kind,
        status: response.status,
        cloudflareRayPresent: Boolean(response.headers.get("cf-ray")),
        passed,
      });
      if (requireBlocks && !passed) throw new Error(`${kind} was not blocked for ${host}`);
    }
  }
  return observations;
}

function validateProbePredecessor(report, { zoneId, liveSnapshot }) {
  if (
    report?.schemaVersion !== 1
    || report?.mode !== "probe"
    || report?.passed !== true
    || report?.mutated !== false
    || report?.target?.zoneId !== zoneId
    || report?.target?.zoneName !== ZONE_NAME
    || report?.custody?.tokenActive !== true
    || report?.custody?.zoneReadable !== true
    || report?.custody?.customRulesetReadable !== true
    || report?.preimage?.snapshotDigest !== digest(liveSnapshot)
    || report?.credentialsIncluded !== false
    || report?.piiIncluded !== false
  ) throw new Error("WAF probe predecessor is invalid or live state drifted");
}

async function restoreSnapshot(client, zoneId, before, createdRulesetId) {
  if (!before.exists) {
    if (!HEX32.test(String(createdRulesetId || "").toLowerCase())) {
      throw new Error("created WAF ruleset identity is unavailable for rollback");
    }
    await client.request(`/zones/${zoneId}/rulesets/${createdRulesetId}`, { method: "DELETE" });
  } else {
    await client.request(`/zones/${zoneId}/rulesets/phases/${PHASE}/entrypoint`, {
      method: "PUT",
      body: {
        description: before.description,
        rules: before.rules,
      },
    });
  }
  const restored = captureSnapshot(await readEntrypoint(client, zoneId));
  if (contentDigest(restored) !== contentDigest(before)) {
    throw new Error("automatic WAF rollback did not restore the exact preimage");
  }
  return publicSnapshot(restored);
}

async function compensateApplyFailure(client, zoneId, before, error) {
  let live;
  try {
    live = captureSnapshot(await readEntrypoint(client, zoneId));
  } catch (reconciliationError) {
    const failure = new Error(
      `${String(error?.message || error)}; automatic rollback failed because live WAF state could not be reconciled: ${String(reconciliationError?.message || reconciliationError)}`,
    );
    failure.rollback = {
      attempted: false,
      passed: false,
      disposition: "live-state-unreadable",
    };
    throw failure;
  }

  if (contentDigest(live) === contentDigest(before)) {
    const failure = new Error(
      `${String(error?.message || error)}; live WAF preimage remains exact and no rollback was required`,
    );
    failure.rollback = {
      attempted: false,
      passed: true,
      disposition: "preimage-exact",
      restored: publicSnapshot(live),
    };
    throw failure;
  }
  if (!isOwnedDesiredPostimage(before, live)) {
    const failure = new Error(
      `${String(error?.message || error)}; automatic rollback refused because live WAF drift is not the exact owned desired postimage`,
    );
    failure.rollback = {
      attempted: false,
      passed: false,
      disposition: "ownership-conflict",
      observed: publicSnapshot(live),
    };
    throw failure;
  }

  let rollback;
  try {
    rollback = {
      attempted: true,
      passed: true,
      disposition: "owned-desired-postimage-restored",
      restored: await restoreSnapshot(client, zoneId, before, live.id),
    };
  } catch (rollbackError) {
    rollback = {
      attempted: true,
      passed: false,
      disposition: "owned-desired-postimage-restore-failed",
      error: String(rollbackError?.message || rollbackError),
    };
  }
  const failure = new Error(
    `${String(error?.message || error)}; automatic rollback ${rollback.passed ? "passed" : "failed"}`,
  );
  failure.rollback = rollback;
  throw failure;
}

async function applyContract(client, zoneId, before) {
  try {
    const current = attestContract(before.exists ? {
      id: before.id,
      version: before.version,
      name: before.name,
      description: before.description,
      kind: before.kind,
      phase: before.phase,
      rules: before.rules,
    } : null);
    return {
      mutated: false,
      after: before,
      contract: current,
      rollback: { required: false, reason: "already-exact" },
    };
  } catch {
    // The exact fail-closed contract is not already at positions zero and one.
  }

  const rules = buildDesiredRules(before.rules);
  try {
    if (before.exists) {
      await client.request(
        `/zones/${zoneId}/rulesets/phases/${PHASE}/entrypoint`,
        {
          method: "PUT",
          body: {
            description: before.description || RULESET_DESCRIPTION,
            rules,
          },
        },
      );
    } else {
      await client.request(`/zones/${zoneId}/rulesets`, {
        method: "POST",
        body: {
          name: "default",
          description: RULESET_DESCRIPTION,
          kind: "zone",
          phase: PHASE,
          rules,
        },
      });
    }
    const after = captureSnapshot(await readEntrypoint(client, zoneId));
    const contract = attestContract({
      id: after.id,
      version: after.version,
      name: after.name,
      description: after.description,
      kind: after.kind,
      phase: after.phase,
      rules: after.rules,
    });
    if (!samePreservedRules(before, after)) {
      throw new Error("non-Ponto custom WAF rules changed during atomic reconciliation");
    }
    return {
      mutated: true,
      after,
      contract,
      rollback: before.exists
        ? {
          required: false,
          strategy: "restore-ruleset-version",
          rulesetId: before.id,
          rulesetVersion: before.version,
          preimageDigest: digest(before),
        }
        : {
          required: false,
          strategy: "delete-created-entrypoint",
          rulesetId: after.id,
          preimageDigest: digest(before),
        },
    };
  } catch (error) {
    return compensateApplyFailure(client, zoneId, before, error);
  }
}

export async function execute({
  env = process.env,
  fetchImpl = fetch,
  writeFiles = true,
} = {}) {
  const mode = required(env, "PONTO_WAF_MODE").toLowerCase();
  const zoneId = required(env, "CLOUDFLARE_ZONE_ID").toLowerCase();
  const accountId = required(env, "CLOUDFLARE_ACCOUNT_ID").toLowerCase();
  const token = required(
    env,
    mode === "probe" ? "PONTO_WAF_READ_API_TOKEN" : "PONTO_WAF_WRITE_API_TOKEN",
  );
  if (
    env.CLOUDFLARE_SECURITY_API_TOKEN
    || (mode === "probe" && env.PONTO_WAF_WRITE_API_TOKEN)
    || (mode === "apply" && env.PONTO_WAF_READ_API_TOKEN)
  ) throw new Error("Ponto WAF credential fallback or cross-scope hydration is forbidden");
  const releaseSha = required(env, "GITHUB_SHA").toLowerCase();
  const runId = required(env, "GITHUB_RUN_ID");
  const artifactDir = required(env, "PONTO_WAF_ARTIFACT_DIR");
  if (
    !["probe", "apply"].includes(mode)
    || !HEX32.test(zoneId)
    || !HEX32.test(accountId)
    || !SHA.test(releaseSha)
    || !/^[1-9][0-9]*$/.test(runId)
  ) throw new Error("Ponto WAF execution provenance is invalid");

  const client = createCloudflareClient({ token, fetchImpl });
  let report = {
    schemaVersion: 1,
    mode,
    sourceSha: releaseSha,
    workflowRunId: runId,
    target: { zoneId, zoneName: ZONE_NAME, phase: PHASE },
    mutated: false,
    passed: false,
    credentialsIncluded: false,
    piiIncluded: false,
  };
  let before;
  let after;
  try {
    const custody = await verifyCustody(client, accountId);
    const entrypoint = await readEntrypoint(client, zoneId);
    before = captureSnapshot(entrypoint);
    const preimage = publicSnapshot(before);
    custody.customRulesetReadable = true;
    custody.customRulesetPresent = before.exists;
    report = { ...report, custody, preimage };

    if (mode === "probe") {
      let contract = null;
      try {
        contract = attestContract(entrypoint);
      } catch {
        contract = null;
      }
      const probes = await runPublicProbes({
        fetchImpl,
        requireBlocks: Boolean(contract),
      });
      report = {
        ...report,
        contractPresentAndExact: Boolean(contract),
        contract,
        probes,
        passed: true,
      };
    } else {
      const probeFile = required(env, "PONTO_WAF_PROBE_REPORT");
      const predecessor = JSON.parse(fs.readFileSync(probeFile, "utf8"));
      validateProbePredecessor(predecessor, { zoneId, liveSnapshot: before });
      const applied = await applyContract(client, zoneId, before);
      after = applied.after;
      let probes;
      try {
        probes = await runPublicProbes({ fetchImpl, requireBlocks: true });
      } catch (error) {
        if (applied.mutated) {
          // Public probing occurs after the mutation boundary and can race with
          // a later legitimate WAF edit. Re-read and restore only our exact
          // owned postimage; never overwrite ambiguous live drift.
          return compensateApplyFailure(client, zoneId, before, error);
        }
        throw error;
      }
      report = {
        ...report,
        probePredecessor: {
          workflowRunId: String(predecessor.workflowRunId),
          sourceSha: String(predecessor.sourceSha),
          preimageDigest: predecessor.preimage.snapshotDigest,
        },
        mutated: applied.mutated,
        contractPresentAndExact: true,
        contract: applied.contract,
        preimage,
        postimage: publicSnapshot(after),
        rollback: applied.rollback,
        probes,
        requiredRepositoryVariables: {
          PONTO_WAF_RULESET_ID: applied.contract.rulesetId,
          PONTO_WAF_HEADER_RULE_ID: applied.contract.headerRuleId,
          PONTO_WAF_CONTRACT_RULE_ID: applied.contract.contractRuleId,
          automaticallyWritten: false,
        },
        passed: true,
      };
    }
  } catch (error) {
    report = {
      ...report,
      ...(before ? { preimage: publicSnapshot(before) } : {}),
      ...(after ? { postimage: publicSnapshot(after) } : {}),
      ...(error?.rollback ? { automaticRollback: error.rollback } : {}),
      error: String(error?.message || error),
      passed: false,
    };
  }

  if (writeFiles) {
    fs.mkdirSync(artifactDir, { recursive: true });
    if (report.preimage) {
      fs.writeFileSync(
        path.join(artifactDir, "ponto-waf-preimage.json"),
        `${JSON.stringify(report.preimage, null, 2)}\n`,
        { mode: 0o600 },
      );
    }
    if (report.postimage) {
      fs.writeFileSync(
        path.join(artifactDir, "ponto-waf-postimage.json"),
        `${JSON.stringify(report.postimage, null, 2)}\n`,
        { mode: 0o600 },
      );
    }
    fs.writeFileSync(
      path.join(artifactDir, "ponto-waf-report.json"),
      `${JSON.stringify(report, null, 2)}\n`,
      { mode: 0o600 },
    );
  }
  if (!report.passed) throw new Error(report.error || "Ponto WAF operation failed");
  return report;
}

const invokedAsScript = process.argv[1]
  && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;

if (invokedAsScript) {
  execute()
    .then((report) => {
      process.stdout.write(
        `Ponto WAF ${report.mode} passed for ${report.target.zoneName}; mutated=${report.mutated}.\n`,
      );
    })
    .catch((error) => {
      process.stderr.write(`${String(error?.message || error)}\n`);
      process.exitCode = 1;
    });
}
