import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { parseCurrentWorkerVersionId } from "./deploy-worker.mjs";
import {
  buildBeautyMovementReleaseValidationMarker,
  parseWranglerJson,
} from "./beauty-movement-production-release-smoke.mjs";

const SHA_PATTERN = /^[0-9a-f]{40}$/;
const VERSION_PATTERN = /^[0-9a-f-]{36}$/i;
const RELEASE_OWNER_PATTERN = /^bm-[0-9]{1,30}-[0-9]{1,6}$/;
const CAMPAIGN_ID_PATTERN = /^[a-z0-9][a-z0-9_-]{2,79}$/;
const PRODUCTION_URL = "https://espacofacial.com";
const PRODUCTION_DATABASE = "espacofacial-beauty-movement";
const WRANGLER_VERSION = "4.112.0";

function fail(code, details = {}) {
  const safeDetails = Object.fromEntries(Object.entries(details).filter(([, value]) => (
    typeof value === "boolean"
    || typeof value === "number"
    || (typeof value === "string" && value.length < 100)
  )));
  throw new Error(`${code}:${JSON.stringify(safeDetails)}`);
}

function parseArgs(argv) {
  const values = new Map();
  for (let index = 0; index < argv.length; index += 2) {
    const key = argv[index];
    const value = argv[index + 1];
    if (!key?.startsWith("--") || !value) fail("beauty_movement_reconcile_args_invalid");
    values.set(key.slice(2), value);
  }
  const options = Object.fromEntries(values);
  for (const required of [
    "base-url",
    "database",
    "config",
    "release-sha",
    "incumbent-manifest",
    "candidate-manifest",
    "trigger-run-id",
    "trigger-run-attempt",
    "conclusion",
    "evidence-file",
  ]) {
    if (!options[required]) fail("beauty_movement_reconcile_args_missing");
  }
  const baseUrl = new URL(options["base-url"]);
  if (baseUrl.origin !== PRODUCTION_URL || baseUrl.pathname !== "/") {
    fail("beauty_movement_reconcile_production_url_invalid");
  }
  if (options.database !== PRODUCTION_DATABASE) fail("beauty_movement_reconcile_database_invalid");
  if (!SHA_PATTERN.test(options["release-sha"])) fail("beauty_movement_reconcile_sha_invalid");
  if (!new Set(["success", "failure", "cancelled", "timed_out"]).has(options.conclusion)) {
    fail("beauty_movement_reconcile_conclusion_invalid");
  }
  if (!/^\d+$/.test(options["trigger-run-id"]) || !/^\d+$/.test(options["trigger-run-attempt"])) {
    fail("beauty_movement_reconcile_run_identity_invalid");
  }
  const config = path.resolve(options.config);
  const incumbentManifest = path.resolve(options["incumbent-manifest"]);
  const candidateManifest = path.resolve(options["candidate-manifest"]);
  const evidenceFile = path.resolve(options["evidence-file"]);
  if (!fs.existsSync(config)) fail("beauty_movement_reconcile_config_missing");
  if (process.env.GITHUB_ACTIONS === "true") {
    const runnerTemp = path.resolve(process.env.RUNNER_TEMP ?? "");
    const prefix = `${runnerTemp}${path.sep}`;
    if (
      !runnerTemp
      || !incumbentManifest.startsWith(prefix)
      || !candidateManifest.startsWith(prefix)
      || !evidenceFile.startsWith(prefix)
    ) {
      fail("beauty_movement_reconcile_private_path_invalid");
    }
  }
  return {
    baseUrl: baseUrl.origin,
    database: options.database,
    config,
    releaseSha: options["release-sha"],
    incumbentManifest,
    candidateManifest,
    triggerRunId: options["trigger-run-id"],
    triggerRunAttempt: options["trigger-run-attempt"],
    conclusion: options.conclusion,
    evidenceFile,
  };
}

function runChild(command, args) {
  const result = spawnSync(command, args, {
    cwd: process.cwd(),
    env: process.env,
    encoding: "utf8",
    maxBuffer: 16 * 1024 * 1024,
    stdio: ["ignore", "pipe", "pipe"],
  });
  if (result.error || result.status !== 0) {
    fail("beauty_movement_reconcile_child_failed", {
      command,
      status: result.status ?? -1,
      stderrLines: String(result.stderr ?? "").split(/\r?\n/).filter(Boolean).length,
    });
  }
  return String(result.stdout ?? "");
}

function d1Command(options, sql) {
  return runChild("npx", [
    "--yes",
    `wrangler@${WRANGLER_VERSION}`,
    "d1",
    "execute",
    options.database,
    "--remote",
    "--config",
    options.config,
    "--command",
    sql,
    "--json",
  ]);
}

function rowsFromD1(output) {
  const payload = parseWranglerJson(output);
  const first = Array.isArray(payload) ? payload[0] : null;
  if (!first?.success || !Array.isArray(first.results)) fail("beauty_movement_reconcile_d1_invalid");
  return first.results;
}

export function buildBeautyMovementSyntheticCampaignId(runId, runAttempt) {
  const value = `bm-prod-release-smoke-${runId}-${runAttempt}`.toLowerCase();
  if (!CAMPAIGN_ID_PATTERN.test(value)) fail("beauty_movement_reconcile_campaign_id_invalid");
  return value;
}

export function buildBeautyMovementReleaseOwner(runId, runAttempt) {
  const value = `bm-${runId}-${runAttempt}`;
  if (!RELEASE_OWNER_PATTERN.test(value)) fail("beauty_movement_reconcile_release_owner_invalid");
  return value;
}

export function readBeautyMovementReleaseCheckpoint(filePath, expectedReleaseSha, expectedReleaseOwner) {
  if (!fs.existsSync(filePath)) return null;
  let checkpoint;
  try {
    checkpoint = JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    fail("beauty_movement_reconcile_checkpoint_invalid");
  }
  const candidateValid = checkpoint.phase === "prepared"
    ? checkpoint.candidateVersionId === null
    : checkpoint.phase === "candidate" && VERSION_PATTERN.test(checkpoint.candidateVersionId ?? "");
  if (
    checkpoint.version !== 1
    || checkpoint.releaseSha !== expectedReleaseSha
    || !SHA_PATTERN.test(checkpoint.releaseSha ?? "")
    || checkpoint.releaseOwner !== expectedReleaseOwner
    || !RELEASE_OWNER_PATTERN.test(checkpoint.releaseOwner ?? "")
    || !VERSION_PATTERN.test(checkpoint.previousVersionId ?? "")
    || !SHA_PATTERN.test(checkpoint.previousBuildSha ?? "")
    || !Number.isInteger(checkpoint.beautyMovementActiveCampaignCount)
    || checkpoint.beautyMovementActiveCampaignCount < 0
    || !candidateValid
  ) {
    fail("beauty_movement_reconcile_checkpoint_invalid");
  }
  return checkpoint;
}

export function decideBeautyMovementRollback({
  conclusion,
  checkpoint,
  currentVersionId,
  currentBuildSha,
  currentReleaseOwner,
}) {
  if (conclusion === "success") return { action: "none", reason: "validated_release" };
  if (currentVersionId === checkpoint.previousVersionId && currentBuildSha === checkpoint.previousBuildSha) {
    return { action: "none", reason: "already_previous" };
  }
  if (checkpoint.candidateVersionId) {
    if (currentVersionId === checkpoint.candidateVersionId && currentBuildSha === checkpoint.releaseSha) {
      if (currentReleaseOwner !== checkpoint.releaseOwner) {
        fail("beauty_movement_reconcile_candidate_owner_mismatch");
      }
      return { action: "rollback", candidateVersionId: currentVersionId };
    }
    if (currentVersionId !== checkpoint.candidateVersionId && currentBuildSha === checkpoint.releaseSha) {
      if (currentReleaseOwner !== checkpoint.releaseOwner) {
        return { action: "none", reason: "superseded_same_sha" };
      }
      fail("beauty_movement_reconcile_candidate_identity_split");
    }
    if (currentVersionId !== checkpoint.candidateVersionId && currentBuildSha !== checkpoint.releaseSha) {
      return { action: "none", reason: "superseded" };
    }
    fail("beauty_movement_reconcile_candidate_identity_split");
  }
  if (currentVersionId !== checkpoint.previousVersionId && currentBuildSha === checkpoint.releaseSha) {
    if (currentReleaseOwner !== checkpoint.releaseOwner) {
      return { action: "none", reason: "superseded_same_sha" };
    }
    return { action: "rollback", candidateVersionId: currentVersionId, inferred: true };
  }
  if (currentBuildSha !== checkpoint.releaseSha) return { action: "none", reason: "superseded" };
  fail("beauty_movement_reconcile_candidate_identity_unproven");
}

export function resolveBeautyMovementReleaseConclusion({
  conclusion,
  durableValidation,
  validationReadFailed,
}) {
  if (conclusion === "success" || durableValidation) return "success";
  // A failed D1 read is an indeterminate validation state. It must never be
  // converted into permission to roll back a potentially validated release.
  if (validationReadFailed) return null;
  return conclusion;
}

function activeCampaignCount(options) {
  const rows = rowsFromD1(d1Command(
    options,
    "SELECT COUNT(*) AS active_count FROM bm_campaigns WHERE status = 'active' AND ends_at_ms > CAST(strftime('%s','now') AS INTEGER) * 1000;",
  ));
  const count = Number(rows[0]?.active_count);
  if (!Number.isInteger(count) || count < 0) fail("beauty_movement_reconcile_active_count_invalid");
  return count;
}

async function cleanupFixture(options, campaignId, expectedActiveCount) {
  let lastError = null;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      d1Command(
        options,
        `UPDATE bm_invites SET invite_status = 'revoked', updated_at_ms = CAST(strftime('%s','now') AS INTEGER) * 1000 WHERE campaign_id = '${campaignId}'; UPDATE bm_campaigns SET status = 'disabled', updated_at_ms = CAST(strftime('%s','now') AS INTEGER) * 1000 WHERE id = '${campaignId}' AND status IN ('draft','active');`,
      );
      const rows = rowsFromD1(d1Command(
        options,
        `SELECT c.status, (SELECT COUNT(*) FROM bm_invites i WHERE i.campaign_id = c.id) AS invite_count, (SELECT COUNT(*) FROM bm_invites i WHERE i.campaign_id = c.id AND i.invite_status = 'revoked') AS revoked_count FROM bm_campaigns c WHERE c.id = '${campaignId}';`,
      ));
      const row = rows[0] ?? null;
      if (row && (
        row.status !== "disabled"
        || Number(row.invite_count) < 0
        || Number(row.invite_count) > 4
        || Number(row.revoked_count) !== Number(row.invite_count)
      )) {
        fail("beauty_movement_reconcile_cleanup_invalid");
      }
      const activeCount = activeCampaignCount(options);
      if (activeCount !== expectedActiveCount) {
        fail("beauty_movement_reconcile_active_campaign_drift", { activeCount, expectedActiveCount });
      }
      return { fixture: row ? "disabled_and_revoked" : "absent", activeCount };
    } catch (error) {
      lastError = error;
      if (attempt < 3) await new Promise((resolve) => setTimeout(resolve, attempt * 2_000));
    }
  }
  throw lastError ?? new Error("beauty_movement_reconcile_cleanup_failed");
}

async function hasDurableValidation(options, campaignId, releaseOwner) {
  const expected = buildBeautyMovementReleaseValidationMarker(options.releaseSha, releaseOwner);
  let lastError = null;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      const rows = rowsFromD1(d1Command(
        options,
        `SELECT status, description FROM bm_campaigns WHERE id = '${campaignId}';`,
      ));
      if (rows.length > 1) fail("beauty_movement_reconcile_validation_marker_ambiguous");
      return rows[0]?.description === expected;
    } catch (error) {
      lastError = error;
      if (attempt < 3) await new Promise((resolve) => setTimeout(resolve, attempt * 2_000));
    }
  }
  throw lastError ?? new Error("beauty_movement_reconcile_validation_marker_unavailable");
}

function currentVersionId(options) {
  return parseCurrentWorkerVersionId(runChild("npx", [
    "--yes",
    `wrangler@${WRANGLER_VERSION}`,
    "deployments",
    "list",
    "--config",
    options.config,
  ]));
}

function releaseOwnerForVersion(options, versionId) {
  const payload = parseWranglerJson(runChild("npx", [
    "--yes",
    `wrangler@${WRANGLER_VERSION}`,
    "versions",
    "view",
    versionId,
    "--config",
    options.config,
    "--json",
  ]));
  if (!payload || Array.isArray(payload) || payload.id !== versionId) {
    fail("beauty_movement_reconcile_version_metadata_invalid");
  }
  const releaseOwner = payload.annotations?.["workers/tag"];
  return RELEASE_OWNER_PATTERN.test(releaseOwner ?? "") ? releaseOwner : null;
}

async function liveBuildSha(baseUrl) {
  const response = await fetch(`${baseUrl}/beleza-em-movimento`, {
    redirect: "manual",
    headers: { "cache-control": "no-cache" },
  });
  const build = response.headers.get("x-app-build")?.trim() ?? "";
  if (response.status !== 200 || !SHA_PATTERN.test(build)) {
    fail("beauty_movement_reconcile_live_build_unattested", { status: response.status });
  }
  return build;
}

async function observeRelease(options) {
  const versionId = currentVersionId(options);
  return {
    versionId,
    buildSha: await liveBuildSha(options.baseUrl),
    releaseOwner: releaseOwnerForVersion(options, versionId),
  };
}

async function rollbackIfOwned(options, checkpoint) {
  if (options.conclusion === "success") return { action: "none", reason: "validated_release" };
  let observed = null;
  let decision = null;
  for (let attempt = 1; attempt <= 6; attempt += 1) {
    observed = await observeRelease(options);
    try {
      decision = decideBeautyMovementRollback({
        conclusion: options.conclusion,
        checkpoint,
        currentVersionId: observed.versionId,
        currentBuildSha: observed.buildSha,
        currentReleaseOwner: observed.releaseOwner,
      });
      break;
    } catch (error) {
      if (attempt === 6) throw error;
      await new Promise((resolve) => setTimeout(resolve, 5_000));
    }
  }
  if (decision.action !== "rollback") return { ...decision, observed };
  if (observed.versionId !== decision.candidateVersionId) {
    fail("beauty_movement_reconcile_rollback_guard_failed");
  }
  runChild("npx", [
    "--yes",
    `wrangler@${WRANGLER_VERSION}`,
    "rollback",
    checkpoint.previousVersionId,
    "--config",
    options.config,
    "--yes",
    "--message",
    `auto-reconcile Beauty Movement release ${options.releaseSha}`,
  ]);
  for (let attempt = 1; attempt <= 12; attempt += 1) {
    const restored = await observeRelease(options);
    if (restored.versionId === checkpoint.previousVersionId && restored.buildSha === checkpoint.previousBuildSha) {
      return { action: "rolled_back", candidateVersionId: decision.candidateVersionId, restored: true };
    }
    if (attempt < 12) await new Promise((resolve) => setTimeout(resolve, 5_000));
  }
  fail("beauty_movement_reconcile_rollback_unattested");
}

async function run() {
  const options = parseArgs(process.argv.slice(2));
  for (const required of ["CLOUDFLARE_API_TOKEN", "CLOUDFLARE_ACCOUNT_ID"]) {
    if (!process.env[required]) fail("beauty_movement_reconcile_custody_missing");
  }
  const releaseOwner = buildBeautyMovementReleaseOwner(options.triggerRunId, options.triggerRunAttempt);
  const incumbent = readBeautyMovementReleaseCheckpoint(
    options.incumbentManifest,
    options.releaseSha,
    releaseOwner,
  );
  const candidate = readBeautyMovementReleaseCheckpoint(
    options.candidateManifest,
    options.releaseSha,
    releaseOwner,
  );
  const checkpoint = candidate ?? incumbent;
  if (!checkpoint) fail("beauty_movement_reconcile_checkpoint_missing");
  const campaignId = buildBeautyMovementSyntheticCampaignId(options.triggerRunId, options.triggerRunAttempt);
  let durableValidation = false;
  let validationError = null;
  try {
    durableValidation = await hasDurableValidation(options, campaignId, releaseOwner);
  } catch (error) {
    validationError = error;
  }
  const effectiveConclusion = resolveBeautyMovementReleaseConclusion({
    conclusion: options.conclusion,
    durableValidation,
    validationReadFailed: Boolean(validationError),
  });
  let cleanup = null;
  let rollback = null;
  let cleanupError = null;
  let rollbackError = null;
  try {
    cleanup = await cleanupFixture(options, campaignId, checkpoint.beautyMovementActiveCampaignCount);
  } catch (error) {
    cleanupError = error;
  }
  if (effectiveConclusion === null) {
    rollback = { action: "none", reason: "validation_unattested" };
  } else {
    // Cleanup failure does not suppress an otherwise attested rollback. A
    // validation-marker read failure is handled separately above and always
    // fails closed without mutating the current Worker release.
    try {
      rollback = await rollbackIfOwned({ ...options, conclusion: effectiveConclusion }, checkpoint);
    } catch (error) {
      rollbackError = error;
    }
  }
  fs.mkdirSync(path.dirname(options.evidenceFile), { recursive: true, mode: 0o700 });
  fs.writeFileSync(options.evidenceFile, `${JSON.stringify({
    schemaVersion: 1,
    releaseSha: options.releaseSha,
    releaseOwner,
    triggerRunId: options.triggerRunId,
    triggerRunAttempt: options.triggerRunAttempt,
    conclusion: options.conclusion,
    effectiveConclusion,
    durableValidation,
    checkpointPhase: checkpoint.phase,
    fixture: cleanup?.fixture ?? "unattested",
    activeCampaignCountPreserved: cleanup?.activeCount ?? null,
    rollback: rollback ?? { action: "unattested" },
    cleanupFailed: Boolean(cleanupError),
    rollbackFailed: Boolean(rollbackError),
    validationReadFailed: Boolean(validationError),
    containsCredentials: false,
    containsPersonalData: false,
  }, null, 2)}\n`, { encoding: "utf8", mode: 0o600, flag: "wx" });
  if (validationError || cleanupError || rollbackError) {
    fail("beauty_movement_reconcile_incomplete", {
      validationReadFailed: Boolean(validationError),
      cleanupFailed: Boolean(cleanupError),
      rollbackFailed: Boolean(rollbackError),
    });
  }
  console.log("Beauty Movement production reconciliation completed without retaining fixture credentials or personal data.");
}

const directExecution = process.argv[1]
  && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));
if (directExecution) {
  run().catch((error) => {
    console.error(error instanceof Error ? error.message : "beauty_movement_reconcile_failed");
    process.exitCode = 1;
  });
}
