import { spawnSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { readSyntheticInvites } from "./beauty-movement-context-isolation-smoke.mjs";

const INVITE_REF_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{2,119}$/;
const RELEASE_SHA_PATTERN = /^[0-9a-f]{40}$/;
const CAMPAIGN_ID_PATTERN = /^[a-z0-9][a-z0-9_-]{2,79}$/;
const RELEASE_OWNER_PATTERN = /^bm-[0-9]{1,30}-[0-9]{1,6}$/;
const PRODUCTION_URL = "https://espacofacial.com";
const PRODUCTION_DATABASE = "espacofacial-beauty-movement";
const WRANGLER_VERSION = "4.112.0";
const ROUTE_ATTESTATION_ATTEMPTS = 6;
const ROUTE_ATTESTATION_DELAY_MS = 5_000;

function fail(code, details = {}) {
  const safe = Object.fromEntries(
    Object.entries(details).filter(([, value]) => (
      typeof value === "number"
      || typeof value === "boolean"
      || (typeof value === "string" && value.length < 100 && !value.includes("#c="))
    )),
  );
  throw new Error(`${code}:${JSON.stringify(safe)}`);
}

function parseArgs(argv) {
  const values = new Map();
  for (let index = 0; index < argv.length; index += 2) {
    const key = argv[index];
    const value = argv[index + 1];
    if (!key?.startsWith("--") || !value) fail("beauty_movement_release_smoke_args_invalid");
    values.set(key.slice(2), value);
  }
  const baseUrl = values.get("base-url");
  const database = values.get("database");
  const config = values.get("config");
  const releaseSha = values.get("release-sha");
  const privateRoot = values.get("private-root");
  const evidenceFile = values.get("evidence-file");
  if (!baseUrl || !database || !config || !releaseSha || !privateRoot || !evidenceFile) {
    fail("beauty_movement_release_smoke_args_missing");
  }
  const parsedBase = new URL(baseUrl);
  if (parsedBase.origin !== PRODUCTION_URL || parsedBase.pathname !== "/") {
    fail("beauty_movement_release_smoke_production_url_invalid");
  }
  if (database !== PRODUCTION_DATABASE) fail("beauty_movement_release_smoke_database_invalid");
  if (!RELEASE_SHA_PATTERN.test(releaseSha)) fail("beauty_movement_release_smoke_sha_invalid");
  const resolvedPrivateRoot = path.resolve(privateRoot);
  const resolvedEvidenceFile = path.resolve(evidenceFile);
  const resolvedConfig = path.resolve(config);
  if (!fs.existsSync(resolvedConfig)) fail("beauty_movement_release_smoke_config_missing");
  if (process.env.GITHUB_ACTIONS === "true") {
    const runnerTemp = path.resolve(process.env.RUNNER_TEMP ?? "");
    const prefix = `${runnerTemp}${path.sep}`;
    if (!runnerTemp || !resolvedPrivateRoot.startsWith(prefix) || !resolvedEvidenceFile.startsWith(prefix)) {
      fail("beauty_movement_release_smoke_private_path_invalid");
    }
  }
  return {
    baseUrl: parsedBase.origin,
    database,
    config: resolvedConfig,
    releaseSha,
    privateRoot: resolvedPrivateRoot,
    evidenceFile: resolvedEvidenceFile,
  };
}

function runChild(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd ?? process.cwd(),
    env: options.env ?? process.env,
    encoding: "utf8",
    maxBuffer: 16 * 1024 * 1024,
    stdio: ["ignore", "pipe", "pipe"],
  });
  if (result.error || result.status !== 0) {
    fail("beauty_movement_release_smoke_child_failed", {
      command,
      status: result.status ?? -1,
      stderrLines: String(result.stderr ?? "").split(/\r?\n/).filter(Boolean).length,
    });
  }
  return String(result.stdout ?? "");
}

function extractJsonValue(output) {
  for (let start = 0; start < output.length; start += 1) {
    const opening = output[start];
    if (opening !== "[" && opening !== "{") continue;
    const stack = [];
    let inString = false;
    let escaped = false;
    for (let index = start; index < output.length; index += 1) {
      const character = output[index];
      if (inString) {
        if (escaped) escaped = false;
        else if (character === "\\") escaped = true;
        else if (character === '"') inString = false;
        continue;
      }
      if (character === '"') {
        inString = true;
        continue;
      }
      if (character === "[" || character === "{") {
        stack.push(character);
        continue;
      }
      if (character !== "]" && character !== "}") continue;
      const expected = character === "]" ? "[" : "{";
      if (stack.at(-1) !== expected) break;
      stack.pop();
      if (stack.length !== 0) continue;
      try {
        return JSON.parse(output.slice(start, index + 1));
      } catch {
        break;
      }
    }
  }
  fail("beauty_movement_release_smoke_json_invalid");
}

export function parseWranglerJson(output) {
  const normalized = output
    .replace(/\u001B\[[0-?]*[ -/]*[@-~]/g, "")
    .replace(/^\uFEFF/, "")
    .trim();
  try {
    return JSON.parse(normalized);
  } catch {
    return extractJsonValue(normalized);
  }
}

function rowsFromD1(output) {
  const payload = parseWranglerJson(output);
  const first = Array.isArray(payload) ? payload[0] : null;
  if (!first?.success || !Array.isArray(first.results)) fail("beauty_movement_release_smoke_d1_result_invalid");
  return first.results;
}

function mutationCountFromD1(output) {
  const payload = parseWranglerJson(output);
  const first = Array.isArray(payload) ? payload[0] : null;
  if (!first?.success) fail("beauty_movement_release_smoke_d1_mutation_invalid");
  return Number(first.meta?.changes ?? 0);
}

function d1Command({ database, config }, sql) {
  return runChild("npx", [
    "--yes",
    `wrangler@${WRANGLER_VERSION}`,
    "d1",
    "execute",
    database,
    "--remote",
    "--config",
    config,
    "--command",
    sql,
    "--json",
  ]);
}

function activeCampaignCount(options) {
  const rows = rowsFromD1(d1Command(
    options,
    "SELECT COUNT(*) AS active_count FROM bm_campaigns WHERE status = 'active' AND ends_at_ms > CAST(strftime('%s','now') AS INTEGER) * 1000;",
  ));
  const count = Number(rows[0]?.active_count);
  if (!Number.isInteger(count) || count < 0) fail("beauty_movement_release_smoke_active_count_invalid");
  return count;
}

function writePrivate(filePath, value) {
  fs.writeFileSync(filePath, value, { encoding: "utf8", mode: 0o600, flag: "wx" });
}

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

export function extractStaticAssetPaths(html) {
  return [...new Set(html.match(/\/_next\/static\/[^"'<>\\\s]+/g) ?? [])].sort();
}

async function attestRouteOnce(baseUrl, route, releaseSha) {
  const response = await fetch(`${baseUrl}${route}`, {
    redirect: "manual",
    headers: { "cache-control": "no-cache" },
  });
  const html = await response.text();
  const cacheControl = response.headers.get("cache-control") ?? "";
  if (
    response.status !== 200
    || response.headers.get("x-app-build") !== releaseSha
    || !/no-store/i.test(cacheControl)
    || !/Beleza em Movimento|Beleza que se move/i.test(html)
  ) {
    fail("beauty_movement_release_smoke_route_attestation_failed", {
      alias: route === "/BelezaEmMovimento",
      status: response.status,
      buildMatches: response.headers.get("x-app-build") === releaseSha,
      noStore: /no-store/i.test(cacheControl),
    });
  }
  const assets = extractStaticAssetPaths(html);
  if (assets.length < 2) fail("beauty_movement_release_smoke_assets_missing", { count: assets.length });
  const hashes = [];
  for (const asset of assets) {
    const assetResponse = await fetch(`${baseUrl}${asset}`, { redirect: "manual" });
    if (assetResponse.status !== 200) fail("beauty_movement_release_smoke_asset_unavailable", { status: assetResponse.status });
    hashes.push(sha256(Buffer.from(await assetResponse.arrayBuffer())));
  }
  return { route, assetCount: hashes.length, assetSetHash: sha256(hashes.sort().join("|")) };
}

async function attestRoute(baseUrl, route, releaseSha) {
  let lastError = null;
  for (let attempt = 1; attempt <= ROUTE_ATTESTATION_ATTEMPTS; attempt += 1) {
    try {
      return await attestRouteOnce(baseUrl, route, releaseSha);
    } catch (error) {
      lastError = error;
      if (attempt < ROUTE_ATTESTATION_ATTEMPTS) {
        await new Promise((resolve) => setTimeout(resolve, ROUTE_ATTESTATION_DELAY_MS));
      }
    }
  }
  throw lastError ?? new Error("beauty_movement_release_smoke_route_attestation_failed");
}

function safeFailureCode(error) {
  const code = error instanceof Error ? error.message.split(":", 1)[0] : "";
  return /^[a-z0-9_]{3,100}$/.test(code) ? code : "beauty_movement_release_smoke_unknown_failure";
}

function syntheticCampaignId() {
  const runId = process.env.GITHUB_RUN_ID ?? "local";
  const attempt = process.env.GITHUB_RUN_ATTEMPT ?? "1";
  const value = `bm-prod-release-smoke-${runId}-${attempt}`.toLowerCase();
  if (!CAMPAIGN_ID_PATTERN.test(value)) fail("beauty_movement_release_smoke_campaign_id_invalid");
  return value;
}

function syntheticReleaseOwner() {
  const value = `bm-${process.env.GITHUB_RUN_ID ?? "0"}-${process.env.GITHUB_RUN_ATTEMPT ?? "1"}`;
  if (!RELEASE_OWNER_PATTERN.test(value)) fail("beauty_movement_release_smoke_owner_invalid");
  return value;
}

export function buildBeautyMovementReleaseValidationMarker(releaseSha, releaseOwner) {
  if (!RELEASE_SHA_PATTERN.test(releaseSha ?? "") || !RELEASE_OWNER_PATTERN.test(releaseOwner ?? "")) {
    fail("beauty_movement_release_smoke_validation_marker_invalid");
  }
  return `bm-release-validated:${releaseSha}:${releaseOwner}`;
}

function prepareFixture(privateRoot, campaignId) {
  const fixtureDirectory = path.join(privateRoot, "fixture");
  const deliveryDirectory = path.join(privateRoot, "delivery");
  fs.mkdirSync(fixtureDirectory, { recursive: true, mode: 0o700 });
  fs.mkdirSync(deliveryDirectory, { recursive: true, mode: 0o700 });
  const now = Date.now();
  const endsAt = new Date(now + 24 * 60 * 60 * 1000).toISOString();
  writePrivate(path.join(fixtureDirectory, "invites.csv"), [
    "NOME,TELEFONE,PRÊMIO",
    "Beauty Movement Smoke Primary,5511999990000,Preenchimento",
    "Beauty Movement Isolation A,5511999990001,Preenchimento",
    "Beauty Movement Isolation B,5511999990002,Preenchimento",
    "Beauty Movement Isolation Expired,5511999990003,Preenchimento",
    "",
  ].join("\n"));
  writePrivate(path.join(fixtureDirectory, "campaign.json"), `${JSON.stringify({
    title: "Beauty Movement production release smoke",
    description: "Fixture sintética privada; não é campanha pública.",
    invitationTitle: "Convite sintético",
    invitationText: "Validação controlada do release.",
    partnerName: "Synthetic QA",
    whatsappMessageCourtesy: "Synthetic QA courtesy",
    whatsappMessageCommercial: "Synthetic QA commercial",
    whatsappLabel: "Falar com a equipe",
    conditionsLabel: "Condições",
    conditionsText: "Fixture sintética temporária.",
    velocityBenefitLabel: "Benefício sintético",
    velocityBenefitText: "Nenhuma comunicação externa.",
    startsAt: new Date(now - 60_000).toISOString(),
  }, null, 2)}\n`);
  return { campaignId, fixtureDirectory, deliveryDirectory, endsAt };
}

function importFixture(options, fixture) {
  const env = {
    ...process.env,
    BEAUTY_MOVEMENT_PRIVATE_RUNTIME_ROOT: options.privateRoot,
    GITHUB_ACTIONS: "true",
  };
  runChild("npm", [
    "run",
    "--silent",
    "beauty-movement:import",
    "--",
    "--apply",
    "--remote",
    "--input",
    path.join(fixture.fixtureDirectory, "invites.csv"),
    "--campaign",
    fixture.campaignId,
    "--confirm-campaign",
    fixture.campaignId,
    "--campaign-ends-at",
    fixture.endsAt,
    "--campaign-config",
    path.join(fixture.fixtureDirectory, "campaign.json"),
    "--database",
    options.database,
    "--config",
    options.config,
    "--out-dir",
    fixture.deliveryDirectory,
  ], { env });
}

function activateFixture(options, fixture) {
  const sql = `UPDATE bm_campaigns SET status = 'active', updated_at_ms = CAST(strftime('%s','now') AS INTEGER) * 1000 WHERE id = '${fixture.campaignId}' AND status = 'draft';`;
  if (mutationCountFromD1(d1Command(options, sql)) !== 1) fail("beauty_movement_release_smoke_activation_failed");
  const invites = readSyntheticInvites(fixture.deliveryDirectory);
  const expiredRef = invites.expired.inviteRef;
  if (!INVITE_REF_PATTERN.test(expiredRef)) fail("beauty_movement_release_smoke_expired_ref_invalid");
  const expirySql = `UPDATE bm_invites SET expires_at_ms = CAST(strftime('%s','now') AS INTEGER) * 1000 - 60000, updated_at_ms = CAST(strftime('%s','now') AS INTEGER) * 1000 WHERE campaign_id = '${fixture.campaignId}' AND external_ref = '${expiredRef}' AND invite_status = 'active';`;
  if (mutationCountFromD1(d1Command(options, expirySql)) !== 1) fail("beauty_movement_release_smoke_expiry_failed");
}

function runBrowserSmokes(options, fixture) {
  const contextEvidence = path.join(options.privateRoot, "context-isolation.json");
  const primaryEvidence = path.join(options.privateRoot, "primary-journey.json");
  runChild("node", [
    "scripts/beauty-movement-context-isolation-smoke.mjs",
    "--base-url",
    options.baseUrl,
    "--delivery-directory",
    fixture.deliveryDirectory,
    "--evidence-file",
    contextEvidence,
  ]);
  runChild("node", [
    "scripts/beauty-movement-primary-journey-smoke.mjs",
    "--base-url",
    options.baseUrl,
    "--delivery-directory",
    fixture.deliveryDirectory,
    "--evidence-file",
    primaryEvidence,
  ]);
  return {
    context: JSON.parse(fs.readFileSync(contextEvidence, "utf8")),
    primary: JSON.parse(fs.readFileSync(primaryEvidence, "utf8")),
  };
}

function validateReadback(options, fixture, browserEvidence) {
  const refs = [
    browserEvidence.context.inviteRefs?.a,
    browserEvidence.context.inviteRefs?.b,
    browserEvidence.context.inviteRefs?.expired,
    browserEvidence.primary.inviteRef,
  ];
  if (!refs.every((value) => INVITE_REF_PATTERN.test(value ?? "")) || new Set(refs).size !== 4) {
    fail("beauty_movement_release_smoke_refs_invalid");
  }
  const quotedRefs = refs.map((value) => `'${value}'`).join(",");
  const sql = `SELECT i.external_ref, i.invite_status, i.confirmed_at_ms, i.expires_at_ms, i.outcome_key, i.outcome_protocol_version, i.outcome_resolved_at_ms, i.assigned_outcome_key, i.assignment_protocol_version, length(i.outcome_snapshot_json) AS outcome_snapshot_length, length(i.planned_card_selections_json) AS planned_card_selections_length, (SELECT COUNT(*) FROM bm_card_reveals r WHERE r.invite_id = i.id) AS reveal_count FROM bm_invites i WHERE i.campaign_id = '${fixture.campaignId}' AND i.external_ref IN (${quotedRefs}) ORDER BY i.external_ref;`;
  const rows = rowsFromD1(d1Command(options, sql));
  const byRef = new Map(rows.map((row) => [row.external_ref, row]));
  const rowA = byRef.get(refs[0]);
  const rowB = byRef.get(refs[1]);
  const expired = byRef.get(refs[2]);
  const primary = byRef.get(refs[3]);
  if (
    rows.length !== 4
    || !rowA || !rowB || !expired || !primary
    || Number(rowA.reveal_count) !== 2
    || Number(rowB.reveal_count) !== 1
    || Number(expired.reveal_count) !== 0
    || Number(expired.expires_at_ms) >= Date.now()
    || rowA.confirmed_at_ms !== null
    || rowB.confirmed_at_ms !== null
    || Number(primary.reveal_count) !== 3
    || primary.confirmed_at_ms === null
    || !primary.outcome_key
    || primary.outcome_key !== primary.assigned_outcome_key
    || primary.outcome_protocol_version !== "beauty-movement-outcomes-v2"
    || primary.assignment_protocol_version !== "beauty-movement-invite-assignments-v1"
    || Number(primary.outcome_resolved_at_ms) <= 0
    || Number(primary.outcome_snapshot_length) <= 0
    || Number(primary.planned_card_selections_length) <= 0
  ) {
    fail("beauty_movement_release_smoke_readback_invalid", { rowCount: rows.length });
  }
  if (
    browserEvidence.context.browser !== true
    || browserEvidence.context.crossContextAuthorizationRejected !== true
    || browserEvidence.context.simultaneousReloadStable !== true
    || browserEvidence.context.rawTokensPersistedInEvidence !== false
    || browserEvidence.primary.browser !== true
    || browserEvidence.primary.whatsappCtaPresent !== true
    || browserEvidence.primary.rawTokensPersistedInEvidence !== false
  ) {
    fail("beauty_movement_release_smoke_browser_evidence_invalid");
  }
}

function persistDurableValidation(options, fixture) {
  const marker = buildBeautyMovementReleaseValidationMarker(options.releaseSha, syntheticReleaseOwner());
  const sql = `UPDATE bm_campaigns SET description = '${marker}', updated_at_ms = CAST(strftime('%s','now') AS INTEGER) * 1000 WHERE id = '${fixture.campaignId}' AND status = 'active';`;
  if (mutationCountFromD1(d1Command(options, sql)) !== 1) {
    fail("beauty_movement_release_smoke_validation_marker_write_failed");
  }
}

async function cleanupFixture(options, fixture, baselineActiveCount) {
  if (!fixture) return;
  let lastError = null;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      const sql = `UPDATE bm_invites SET invite_status = 'revoked', updated_at_ms = CAST(strftime('%s','now') AS INTEGER) * 1000 WHERE campaign_id = '${fixture.campaignId}'; UPDATE bm_campaigns SET status = 'disabled', updated_at_ms = CAST(strftime('%s','now') AS INTEGER) * 1000 WHERE id = '${fixture.campaignId}' AND status IN ('draft','active');`;
      d1Command(options, sql);
      const rows = rowsFromD1(d1Command(
        options,
        `SELECT c.status, (SELECT COUNT(*) FROM bm_invites i WHERE i.campaign_id = c.id) AS invite_count, (SELECT COUNT(*) FROM bm_invites i WHERE i.campaign_id = c.id AND i.invite_status = 'revoked') AS revoked_count FROM bm_campaigns c WHERE c.id = '${fixture.campaignId}';`,
      ));
      const row = rows[0];
      if (!row && baselineActiveCount !== null && activeCampaignCount(options) === baselineActiveCount) return;
      if (
        !row
        || row.status !== "disabled"
        || Number(row.invite_count) < 1
        || Number(row.invite_count) > 4
        || Number(row.revoked_count) !== Number(row.invite_count)
        || (baselineActiveCount !== null && activeCampaignCount(options) !== baselineActiveCount)
      ) {
        fail("beauty_movement_release_smoke_cleanup_readback_invalid");
      }
      return;
    } catch (error) {
      lastError = error;
      if (attempt < 3) await new Promise((resolve) => setTimeout(resolve, attempt * 2_000));
    }
  }
  throw lastError ?? new Error("beauty_movement_release_smoke_cleanup_failed");
}

async function run() {
  const options = parseArgs(process.argv.slice(2));
  for (const required of [
    "CLOUDFLARE_API_TOKEN",
    "CLOUDFLARE_ACCOUNT_ID",
    "BEAUTY_MOVEMENT_TOKEN_HMAC_KEY",
    "BEAUTY_MOVEMENT_PII_KEY",
  ]) {
    if (!process.env[required]) fail("beauty_movement_release_smoke_custody_missing");
  }
  fs.mkdirSync(options.privateRoot, { recursive: true, mode: 0o700 });
  fs.mkdirSync(path.dirname(options.evidenceFile), { recursive: true, mode: 0o700 });

  let fixture = null;
  let baselineActiveCount = null;
  let primaryError = null;
  let cleanupError = null;
  let finalEvidence = null;
  let stage = "route_attestation";
  try {
    const [canonical, alias] = await Promise.all([
      attestRoute(options.baseUrl, "/beleza-em-movimento", options.releaseSha),
      attestRoute(options.baseUrl, "/BelezaEmMovimento", options.releaseSha),
    ]);
    stage = "active_campaign_baseline";
    baselineActiveCount = activeCampaignCount(options);
    if (baselineActiveCount < 1) fail("beauty_movement_release_smoke_active_campaign_missing");

    stage = "fixture_prepare";
    fixture = prepareFixture(options.privateRoot, syntheticCampaignId());
    stage = "fixture_import";
    importFixture(options, fixture);
    stage = "fixture_activation";
    activateFixture(options, fixture);
    if (activeCampaignCount(options) !== baselineActiveCount + 1) {
      fail("beauty_movement_release_smoke_fixture_scope_invalid");
    }
    stage = "browser_journeys";
    const browserEvidence = runBrowserSmokes(options, fixture);
    stage = "database_readback";
    validateReadback(options, fixture, browserEvidence);
    stage = "durable_validation";
    persistDurableValidation(options, fixture);

    finalEvidence = {
      version: 1,
      releaseSha: options.releaseSha,
      result: "passed",
      routes: {
        canonical: {
          status: 200,
          build: true,
          noStore: true,
          assets: canonical.assetCount,
          assetSetHash: canonical.assetSetHash,
        },
        alias: {
          status: 200,
          build: true,
          noStore: true,
          assets: alias.assetCount,
          assetSetHash: alias.assetSetHash,
        },
        assetsHealthy: true,
      },
      preexistingActiveCampaignsPreserved: baselineActiveCount,
      syntheticInviteCount: 4,
      contextIsolationMatrix: "passed",
      primaryJourney: "passed",
      twoPagesSameBrowserContext: true,
      privateBrowserContext: true,
      backForwardAndReload: true,
      crossContextAuthorizationRejected: true,
      outcomePersisted: true,
      whatsappCtaPresentWithoutOutboundRequest: true,
      rawTokensPersistedInEvidence: false,
      syntheticFixtureRevoked: true,
      durableValidationRecorded: true,
    };
  } catch (error) {
    primaryError = error;
  } finally {
    try {
      await cleanupFixture(options, fixture, baselineActiveCount);
    } catch (error) {
      cleanupError = error;
    }
  }

  if (primaryError || cleanupError) {
    const failedStage = primaryError ? stage : "fixture_cleanup";
    const failureCode = safeFailureCode(primaryError ?? cleanupError);
    const failureEvidence = {
      schemaVersion: 1,
      releaseSha: options.releaseSha,
      result: "failed",
      failedStage,
      failureCode,
      syntheticFixtureCreated: Boolean(fixture),
      syntheticFixtureRevoked: !cleanupError,
      cleanupFailed: Boolean(cleanupError),
      containsCredentials: false,
      containsPersonalData: false,
    };
    fs.writeFileSync(options.evidenceFile, `${JSON.stringify(failureEvidence, null, 2)}\n`, {
      encoding: "utf8",
      mode: 0o600,
      flag: "wx",
    });
    fail("beauty_movement_release_smoke_failed", {
      journeyFailed: Boolean(primaryError),
      cleanupFailed: Boolean(cleanupError),
      failedStage,
      failureCode,
    });
  }
  fs.writeFileSync(options.evidenceFile, `${JSON.stringify(finalEvidence, null, 2)}\n`, {
    encoding: "utf8",
    mode: 0o600,
    flag: "wx",
  });
  console.log("Beauty Movement production release isolation smoke passed; synthetic fixture was revoked.");
}

const isDirectExecution = process.argv[1]
  && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));
if (isDirectExecution) {
  run().catch((error) => {
    const message = error instanceof Error ? error.message : "beauty_movement_release_smoke_failed";
    console.error(
      message
        .replace(/#c=[A-Za-z0-9_-]+/g, "#c=[redacted]")
        .replace(/[A-Za-z0-9_-]{40,180}/g, "[opaque]"),
    );
    process.exitCode = 1;
  });
}
