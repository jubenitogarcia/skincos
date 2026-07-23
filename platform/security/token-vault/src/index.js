var __defProp = Object.defineProperty;
var __name = (target, value) => __defProp(target, "name", { value, configurable: true });

// src/meta-ads-publish.js
var __name2 = /* @__PURE__ */ __name((target, value) => {
  try {
    Object.defineProperty(target, "name", { value, configurable: true });
  } catch {
  }
  return target;
}, "__name");
var PREFIX = "/v1/meta-ads-publish";
var GRAPH_ORIGIN = "https://graph.facebook.com";
var GRAPH_VIDEO_ORIGIN = "https://graph-video.facebook.com";
var LOCK_TTL_MS = 30 * 60 * 1e3;
var GRAPH_TIMEOUT_MS = 60 * 1e3;
var MAX_RETRY_WINDOW_MS = 5 * 60 * 1e3;
var MAX_GRAPH_ATTEMPTS = 3;
var MAX_AD_PAGES = 20;
var MAX_ADS = 2e3;
var CREATIVE_READ_FIELDS = Object.freeze([
  "id",
  "name",
  "object_story_spec",
  "asset_feed_spec",
  "degrees_of_freedom_spec",
  "creative_sourcing_spec"
]);
var ADSET_PLACEMENT_FIELDS = [
  "id",
  "targeting{publisher_platforms,facebook_positions,instagram_positions,audience_network_positions,whatsapp_positions,effective_publisher_platforms,effective_facebook_positions,effective_instagram_positions,effective_audience_network_positions,effective_whatsapp_positions}"
].join(",");
var MAX_IMAGE_UPLOAD_BYTES = 10 * 1024 * 1024;
var MAX_VIDEO_BYTES = 90 * 1024 * 1024;
var MAX_VIDEO_CHUNK_BYTES = 16 * 1024 * 1024;
var MAX_MULTIPART_REQUEST_BYTES = MAX_VIDEO_CHUNK_BYTES + 1024 * 1024;
var MAX_BATCH_JOBS = 50;
var MAX_LANDING_REDIRECTS = 5;
var WHATSAPP_HOSTS = /* @__PURE__ */ new Set(["wa.me", "api.whatsapp.com"]);
var ALLOWED_CREATIVE_FEATURES = /* @__PURE__ */ new Set([
  "add_text_overlay",
  "image_touchups",
  "music_generation",
  "pac_relaxation",
  "text_optimizations",
  "inline_comment",
  "enhance_cta",
  "image_brightness_and_contrast",
  "reveal_details_over_time",
  "show_destination_blurbs",
  "image_animation",
  "site_extensions",
  "adapt_to_placement",
  "video_filtering",
  "video_highlights",
  "video_auto_crop",
  "video_uncrop"
]);
var FORBIDDEN_CREATIVE_FEATURES = /* @__PURE__ */ new Set([
  "image_template",
  "media_type_automation",
  "show_summary",
  "audio",
  "standard_enhancements"
]);
var REQUIRED_CREATIVE_FEATURES = Object.freeze([
  "text_optimizations",
  "inline_comment",
  "enhance_cta"
]);
var TERMINAL_RUN_STATES = /* @__PURE__ */ new Set(["completed", "failed", "rolled_back"]);
var ALLOWED_ACTIONS = /* @__PURE__ */ new Set([
  "list_ads",
  "upload_image",
  "start_video_upload",
  "transfer_video_chunk",
  "finish_video_upload",
  "get_video_status",
  "create_creative",
  "get_creative",
  "get_ad",
  "stage_batch",
  "activate_batch",
  "rollback_batch",
  "archive_batch"
]);
var AD_INVENTORY_FIELDS = [
  "id",
  "name",
  "status",
  "effective_status",
  "created_time",
  "updated_time",
  "adset_id",
  "campaign_id",
  "creative{id,name,object_story_spec,asset_feed_spec}",
  "adset{id,name,campaign_id}",
  "campaign{id,name}"
].join(",");
var AD_STATE_FIELDS = [
  "id",
  "name",
  "status",
  "effective_status",
  "created_time",
  "updated_time",
  "adset_id",
  "campaign_id",
  "creative{id,name}"
].join(",");
function isMetaAdsPublishPath(pathname) {
  return pathname === PREFIX || pathname.startsWith(`${PREFIX}/`);
}
__name(isMetaAdsPublishPath, "isMetaAdsPublishPath");
__name2(isMetaAdsPublishPath, "isMetaAdsPublishPath");
async function handleMetaAdsPublishRequest(input) {
  const { request, env, requestId, pathname, decryptToken: decryptToken2, writeAudit: writeAudit2 } = input;
  if (request.method === "GET" && pathname === `${PREFIX}/config`) {
    return getConfig(env, requestId);
  }
  if (request.method === "POST" && pathname === `${PREFIX}/inventory`) {
    return getInventory({ request, env, requestId, decryptToken: decryptToken2, writeAudit: writeAudit2 });
  }
  if (request.method === "POST" && pathname === `${PREFIX}/runs`) {
    return createOrResumeRun(request, env, requestId);
  }
  const runMatch = pathname.match(/^\/v1\/meta-ads-publish\/runs\/([^/]+)$/);
  if (request.method === "GET" && runMatch) {
    return getRun(decodeURIComponent(runMatch[1]), env, requestId);
  }
  if (request.method === "PATCH" && runMatch) {
    return updateRun(decodeURIComponent(runMatch[1]), request, env, requestId);
  }
  const heartbeatMatch = pathname.match(/^\/v1\/meta-ads-publish\/runs\/([^/]+)\/heartbeat$/);
  if (request.method === "POST" && heartbeatMatch) {
    return heartbeatRun(decodeURIComponent(heartbeatMatch[1]), env, requestId);
  }
  const eventMatch = pathname.match(/^\/v1\/meta-ads-publish\/runs\/([^/]+)\/events$/);
  if (request.method === "POST" && eventMatch) {
    return claimEvent(decodeURIComponent(eventMatch[1]), request, env, requestId);
  }
  const operationMatch = pathname.match(/^\/v1\/meta-ads-publish\/runs\/([^/]+)\/operations$/);
  if (request.method === "POST" && operationMatch) {
    return executeOperation({
      runId: decodeURIComponent(operationMatch[1]),
      request,
      env,
      requestId,
      decryptToken: decryptToken2,
      writeAudit: writeAudit2
    });
  }
  return response({ ok: false, error: "meta_ads_publish_not_found", requestId }, 404);
}
__name(handleMetaAdsPublishRequest, "handleMetaAdsPublishRequest");
__name2(handleMetaAdsPublishRequest, "handleMetaAdsPublishRequest");
async function getInventory({ request, env, requestId, decryptToken: decryptToken2, writeAudit: writeAudit2 }) {
  const body = await readObject(request);
  try {
    const context = {
      env,
      runId: "inventory",
      operationKey: `inventory:${clean(body.account_id)}`,
      decryptToken: decryptToken2,
      attempts: 0,
      rateUsage: {},
      traceId: ""
    };
    const result = await listAds(body, context);
    const placementChecks = [];
    const seenAdsets = /* @__PURE__ */ new Set();
    for (const entry of safeArray(body.adsets)) {
      const adsetId = normalizeNumericId(entry && entry.adset_id, "adset_id");
      if (seenAdsets.has(adsetId)) continue;
      seenAdsets.add(adsetId);
      placementChecks.push({
        adset_id: adsetId,
        destination_group: clean(entry && entry.destination_group),
        targeting: await readAdsetPlacements(body, adsetId, context)
      });
    }
    await writeAudit2(env, {
      event: "meta_ads_publish.inventory",
      status: "ok",
      requestId,
      metadata: {
        token_id: clean(body.token_id),
        account_id: clean(body.account_id),
        item_count: result.item_count,
        page_count: result.page_count
      }
    });
    return response({ ok: true, ...result, placement_checks: placementChecks, rate_usage: context.rateUsage, requestId });
  } catch (error) {
    const normalized = normalizeFailure(error);
    await writeAudit2(env, {
      event: "meta_ads_publish.inventory",
      status: "failed",
      requestId,
      metadata: {
        token_id: clean(body.token_id),
        account_id: clean(body.account_id),
        error_class: normalized.classification,
        code: normalized.code,
        subcode: normalized.error_subcode,
        fbtrace_id: normalized.fbtrace_id
      }
    });
    return response({ ok: false, error: "meta_inventory_failed", detail: normalized, requestId }, normalized.http_status || 502);
  }
}
__name(getInventory, "getInventory");
__name2(getInventory, "getInventory");
async function getConfig(env, requestId) {
  const rows = await dbAll(
    env,
    `SELECT id, unit, external_account_id, token_type, expires_at, active,
            metadata_json, updated_at
       FROM credential_tokens
      WHERE provider = 'facebook' AND active = 1
      ORDER BY unit, external_account_id`
  );
  const destinations = [];
  const landingPageInvalid = [];
  for (const row of rows) {
    const metadata = parseObject(row.metadata_json);
    const config = asObject(metadata.meta_ads_publish);
    if (!Object.keys(config).length) {
      continue;
    }
    const allowedLinkHosts = normalizeHosts(config.allowed_link_hosts);
    const destinationType = normalizeMetaPublishDestinationType(config.destination_type);
    const whatsappDestination = normalizeWhatsAppDestinationUrl(config.whatsapp_destination_url || config.whatsapp_destination);
    const destinationErrors = [];
    if (destinationType === "INVALID") {
      destinationErrors.push({ error: "destination_type_invalid" });
    }
    if (destinationType === "WHATSAPP" && whatsappDestination.error) {
      destinationErrors.push({ error: whatsappDestination.error });
    }
    const landingDefinition = normalizeLandingPageMap(config.landing_pages_by_creative_group, allowedLinkHosts);
    const landingPageValidation = await validateLandingPagesOnline(landingDefinition.pages, allowedLinkHosts, env);
    const landingErrors = [...destinationErrors, ...landingDefinition.errors, ...landingPageValidation.errors];
    if (!Object.keys(landingDefinition.pages).length) landingErrors.push({ error: "landing_pages_by_creative_group_required" });
    if (landingErrors.length) {
      landingPageInvalid.push({
        token_id: clean(row.id),
        destination_group: clean(config.destination_group),
        errors: landingErrors
      });
    }
    destinations.push({
      token_id: clean(row.id),
      unit: clean(row.unit),
      external_account_id: clean(row.external_account_id),
      expires_at: nullable(row.expires_at),
      updated_at: nullable(row.updated_at),
      row_number: config.row_number ?? "",
      destination_group: clean(config.destination_group),
      api_version: normalizeApiVersion(config.api_version || "v25.0"),
      account_id: normalizeNumericId(config.account_id, "account_id"),
      campaign_id: normalizeNumericId(config.campaign_id, "campaign_id"),
      adset_id: normalizeNumericId(config.adset_id, "adset_id"),
      page_id: normalizeNumericId(config.page_id, "page_id"),
      instagram_user_id: normalizeNumericId(config.instagram_user_id, "instagram_user_id"),
      campaign_objective: clean(config.campaign_objective),
      optimization_goal: clean(config.optimization_goal),
      destination_type: destinationType === "INVALID" ? clean(config.destination_type).toUpperCase() : destinationType,
      whatsapp_destination_url: whatsappDestination.url,
      allowed_link_hosts: allowedLinkHosts,
      landing_pages_by_creative_group: landingDefinition.pages,
      landing_page_validation: {
        ok: landingErrors.length === 0,
        results: landingPageValidation.results
      },
      freshness_window_days: clampInteger(config.freshness_window_days, 7, 1, 90)
    });
  }
  const required = [
    "token_id",
    "destination_group",
    "api_version",
    "account_id",
    "campaign_id",
    "adset_id",
    "page_id",
    "instagram_user_id"
  ];
  const invalid = destinations.map((item) => ({
    token_id: item.token_id,
    missing: required.filter((key) => !clean(item[key]))
  })).filter((item) => item.missing.length);
  invalid.push(...landingPageInvalid);
  const configRevision = await sha256(stableStringify(destinations));
  return response({
    ok: invalid.length === 0 && destinations.length >= 2,
    ready: invalid.length === 0 && destinations.length >= 2,
    count: destinations.length,
    config_revision: configRevision,
    destinations,
    invalid,
    secrets_exposed: false,
    requestId
  }, invalid.length || destinations.length < 2 ? 409 : 200);
}
__name(getConfig, "getConfig");
__name2(getConfig, "getConfig");
async function createOrResumeRun(request, env, requestId) {
  const body = await readObject(request);
  const configRevision = requireHash(body.config_revision, "config_revision");
  const files = normalizeFiles(body.files);
  if (!files.length) return response({ ok: false, error: "files_required", requestId }, 400);
  const batchFingerprint = body.batch_fingerprint ? requireHash(body.batch_fingerprint, "batch_fingerprint") : await sha256(stableStringify({ configRevision, files }));
  const requestHash = await sha256(stableStringify({ batchFingerprint, configRevision, files }));
  const existing = await dbFirst(
    env,
    `SELECT * FROM meta_ads_publish_runs WHERE batch_fingerprint = ?`,
    batchFingerprint
  );
  if (existing) {
    if (clean(existing.request_hash) !== requestHash) {
      return response({ ok: false, error: "batch_fingerprint_conflict", requestId }, 409);
    }
    // Replays must refresh their run-level locks.  A failed browser/manual
    // execution can stop before it reaches the terminal PATCH, and returning
    // the journal row without reacquiring its locks leaves a false success
    // path for a later retry.
    if (!TERMINAL_RUN_STATES.has(clean(existing.status))) {
      const runId2 = clean(existing.id);
      const resourceKeys = [`batch:${batchFingerprint}`, ...files.map((file) => `drive:${file.id}`)];
      try {
        await reclaimRecoverableRunLocks(env, runId2, resourceKeys);
        await acquireLocks(env, runId2, `run:${runId2}`, resourceKeys);
      } catch (error) {
        return response({ ok: false, error: clean(error.message) || "resource_locked", requestId }, 409);
      }
    }
    return response({ ok: true, replayed: true, run: serializeRun(existing), requestId });
  }
  const now = nowIso();
  const runId = `map_${batchFingerprint.slice(0, 24)}`;
  const expiresAt = new Date(Date.now() + LOCK_TTL_MS).toISOString();
  await dbRun(
    env,
    `INSERT INTO meta_ads_publish_runs (
      id, batch_fingerprint, request_hash, workflow_execution_id, config_revision,
      status, files_json, heartbeat_at, lock_expires_at, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, 'acquired', ?, ?, ?, ?, ?)`,
    runId,
    batchFingerprint,
    requestHash,
    nullable(body.workflow_execution_id),
    configRevision,
    JSON.stringify(files),
    now,
    expiresAt,
    now,
    now
  );
  const resourceKeys = [`batch:${batchFingerprint}`, ...files.map((file) => `drive:${file.id}`)];
  try {
    await reclaimRecoverableRunLocks(env, runId, resourceKeys);
    await acquireLocks(env, runId, `run:${runId}`, resourceKeys);
  } catch (error) {
    // Do not leave a run row or a partially-acquired batch lock behind when a
    // different run legitimately owns one of the files.
    await releaseRunLocks(env, runId);
    await dbRun(env, `DELETE FROM meta_ads_publish_runs WHERE id = ?`, runId);
    return response({ ok: false, error: clean(error.message) || "resource_locked", requestId }, 409);
  }
  const created = await loadRun(env, runId);
  return response({ ok: true, replayed: false, run: serializeRun(created), requestId }, 201);
}
__name(createOrResumeRun, "createOrResumeRun");
__name2(createOrResumeRun, "createOrResumeRun");
async function getRun(runId, env, requestId) {
  const run = await loadRun(env, runId);
  if (!run) return response({ ok: false, error: "run_not_found", requestId }, 404);
  const jobs = await dbAll(
    env,
    `SELECT id, operation_key, destination_group, creative_group_key, action,
            resource_key, status, previous_state_json, result_json, error_json,
            created_at, updated_at
       FROM meta_ads_publish_jobs WHERE run_id = ? ORDER BY created_at, id`,
    runId
  );
  const operations = await dbAll(
    env,
    `SELECT operation_key, action, status, attempt_count, result_json, error_json,
            meta_trace_id, rate_usage_json, created_at, updated_at
       FROM meta_ads_publish_operations WHERE run_id = ? ORDER BY created_at, id`,
    runId
  );
  return response({
    ok: true,
    run: serializeRun(run),
    jobs: jobs.map(serializeJob),
    operations: operations.map(serializeOperation),
    requestId
  });
}
__name(getRun, "getRun");
__name2(getRun, "getRun");
async function updateRun(runId, request, env, requestId) {
  const run = await loadRun(env, runId);
  if (!run) return response({ ok: false, error: "run_not_found", requestId }, 404);
  const body = await readObject(request);
  const allowedStatuses = /* @__PURE__ */ new Set([
    "processing",
    "creatives_ready",
    "staged",
    "meta_completed_drive_pending",
    "completed",
    "failed",
    "rolled_back",
    "reconciliation_required"
  ]);
  const status = clean(body.status);
  if (!allowedStatuses.has(status)) {
    return response({ ok: false, error: "invalid_run_status", requestId }, 400);
  }
  const now = nowIso();
  await dbRun(
    env,
    `UPDATE meta_ads_publish_runs
        SET status = ?, summary_json = ?, error_json = ?, heartbeat_at = ?,
            lock_expires_at = ?, updated_at = ?
      WHERE id = ?`,
    status,
    limitedJson(body.summary),
    limitedJson(body.error),
    now,
    new Date(Date.now() + LOCK_TTL_MS).toISOString(),
    now,
    runId
  );
  if (TERMINAL_RUN_STATES.has(status)) await releaseRunLocks(env, runId);
  return getRun(runId, env, requestId);
}
__name(updateRun, "updateRun");
__name2(updateRun, "updateRun");
async function heartbeatRun(runId, env, requestId) {
  const run = await loadRun(env, runId);
  if (!run) return response({ ok: false, error: "run_not_found", requestId }, 404);
  if (TERMINAL_RUN_STATES.has(clean(run.status))) {
    return response({ ok: false, error: "run_already_terminal", requestId }, 409);
  }
  const now = nowIso();
  const expiresAt = new Date(Date.now() + LOCK_TTL_MS).toISOString();
  await dbRun(
    env,
    `UPDATE meta_ads_publish_runs SET heartbeat_at = ?, lock_expires_at = ?, updated_at = ? WHERE id = ?`,
    now,
    expiresAt,
    now,
    runId
  );
  await dbRun(
    env,
    `UPDATE meta_ads_publish_locks SET heartbeat_at = ?, expires_at = ?, updated_at = ? WHERE run_id = ?`,
    now,
    expiresAt,
    now,
    runId
  );
  return response({ ok: true, run_id: runId, heartbeat_at: now, lock_expires_at: expiresAt, requestId });
}
__name(heartbeatRun, "heartbeatRun");
__name2(heartbeatRun, "heartbeatRun");
async function claimEvent(runId, request, env, requestId) {
  const run = await loadRun(env, runId);
  if (!run) return response({ ok: false, error: "run_not_found", requestId }, 404);
  const body = await readObject(request);
  const eventKey = requireKey(body.event_key, "event_key");
  const existing = await dbFirst(
    env,
    `SELECT id, status, payload_json, created_at, updated_at
       FROM meta_ads_publish_events WHERE run_id = ? AND event_key = ?`,
    runId,
    eventKey
  );
  if (existing) {
    return response({ ok: true, claimed: false, replayed: true, event: serializeEvent(existing), requestId });
  }
  const now = nowIso();
  const id = crypto.randomUUID();
  await dbRun(
    env,
    `INSERT INTO meta_ads_publish_events (id, run_id, event_key, status, payload_json, created_at, updated_at)
     VALUES (?, ?, ?, 'claimed', ?, ?, ?)`,
    id,
    runId,
    eventKey,
    limitedJson(body.payload),
    now,
    now
  );
  return response({
    ok: true,
    claimed: true,
    replayed: false,
    event: { id, event_key: eventKey, status: "claimed", payload: asObject(body.payload) },
    requestId
  }, 201);
}
__name(claimEvent, "claimEvent");
__name2(claimEvent, "claimEvent");
async function executeOperation(context) {
  const { runId, request, env, requestId, decryptToken: decryptToken2, writeAudit: writeAudit2 } = context;
  const run = await loadRun(env, runId);
  if (!run) return response({ ok: false, error: "run_not_found", requestId }, 404);
  const parsed = await readOperationRequest(request);
  if (parsed.error) return response({ ok: false, error: parsed.error, requestId }, parsed.status || 400);
  const body = parsed.body;
  const action = clean(body.action);
  if (!ALLOWED_ACTIONS.has(action)) return response({ ok: false, error: "invalid_action", requestId }, 400);
  const operationKey = requireKey(body.operation_key, "operation_key");
  const requestHash = await sha256(stableStringify(operationHashInput(body, parsed.file)));
  if (body.request_hash && clean(body.request_hash) !== requestHash) {
    return response({ ok: false, error: "request_hash_mismatch", request_hash: requestHash, requestId }, 400);
  }
  const existing = await dbFirst(
    env,
    `SELECT * FROM meta_ads_publish_operations WHERE operation_key = ?`,
    operationKey
  );
  // A terminal run must never accept a new mutation, but an exact replay of a
  // completed operation is safe and is required for n8n recovery after the
  // finalization response was persisted before the workflow itself stopped.
  // Check the stored operation before the terminal guard so this remains a
  // read-only idempotent response, never a reopening of the run.
  if (TERMINAL_RUN_STATES.has(clean(run.status))) {
    if (existing && clean(existing.request_hash) === requestHash && clean(existing.status) === "completed") {
      return response({
        ok: true,
        replayed: true,
        semantic_replay: false,
        terminal_run_replay: true,
        operation: serializeOperation(existing),
        requestId
      });
    }
    return response({ ok: false, error: "run_already_terminal", status: run.status, requestId }, 409);
  }
  if (existing) {
    if (clean(existing.request_hash) !== requestHash) {
      if (
        clean(existing.status) === "completed" &&
        ["transfer_video_chunk", "finish_video_upload"].includes(action) &&
        clean(body.semantic_replay_video_id)
      ) {
        const startCandidates = await dbAll(
          env,
          `SELECT * FROM meta_ads_publish_operations
            WHERE run_id = ? AND action = 'start_video_upload' AND status = 'completed'
            ORDER BY created_at, id`,
          runId
        );
        const reusableStart = selectReusableVideoStartOperation(
          run,
          {
            source_file_id: body.source_file_id,
            resume_video_id: body.semantic_replay_video_id,
            upload_session_id: body.upload_session_id
          },
          startCandidates
        );
        if (reusableStart) {
          return response({ ok: true, replayed: true, semantic_replay: true, operation: serializeOperation(existing), requestId });
        }
      }
      return response({ ok: false, error: "operation_key_conflict", requestId }, 409);
    }
    if (clean(existing.status) === "completed") {
      const semanticStartReplay = action === "start_video_upload" && Boolean(
        selectReusableVideoStartOperation(run, body, [existing])
      );
      return response({
        ok: true,
        replayed: true,
        semantic_replay: semanticStartReplay,
        operation: serializeOperation(existing),
        requestId
      });
    }
    if (clean(existing.status) === "in_progress") {
      return response({ ok: false, error: "operation_in_progress", operation: serializeOperation(existing), requestId }, 409);
    }
  }
  if (!existing && action === "start_video_upload" && clean(body.resume_video_id)) {
    const candidates = await dbAll(
      env,
      `SELECT * FROM meta_ads_publish_operations
        WHERE run_id = ? AND action = 'start_video_upload' AND status = 'completed'
        ORDER BY created_at, id`,
      runId
    );
    const reusable = selectReusableVideoStartOperation(run, body, candidates);
    if (reusable) {
      return response({ ok: true, replayed: true, semantic_replay: true, operation: serializeOperation(reusable), requestId });
    }
  }
  const resources = deriveResourceKeys(action, body);
  try {
    await acquireLocks(env, runId, operationKey, resources);
  } catch (error) {
    return response({ ok: false, error: clean(error.message) || "resource_locked", requestId }, 409);
  }
  const now = nowIso();
  const operationId = existing?.id || crypto.randomUUID();
  if (existing) {
    await dbRun(
      env,
      `UPDATE meta_ads_publish_operations
          SET status = 'in_progress', error_json = '{}', updated_at = ?
        WHERE id = ?`,
      now,
      operationId
    );
  } else {
    await dbRun(
      env,
      `INSERT INTO meta_ads_publish_operations (
        id, run_id, operation_key, request_hash, action, status, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, 'in_progress', ?, ?)`,
      operationId,
      runId,
      operationKey,
      requestHash,
      action,
      now,
      now
    );
  }
  try {
    const graphContext = {
      env,
      runId,
      operationKey,
      decryptToken: decryptToken2,
      file: parsed.file,
      attempts: 0,
      rateUsage: {},
      traceId: ""
    };
    const result = await performOperation(action, body, graphContext);
    const completedAt = nowIso();
    await dbRun(
      env,
      `UPDATE meta_ads_publish_operations
          SET status = 'completed', attempt_count = ?, result_json = ?, error_json = '{}',
              meta_trace_id = ?, rate_usage_json = ?, updated_at = ?
        WHERE id = ?`,
      graphContext.attempts,
      limitedJson(result),
      nullable(graphContext.traceId),
      limitedJson(graphContext.rateUsage),
      completedAt,
      operationId
    );
    await releaseOperationLocks(env, runId, operationKey);
    await writeAudit2(env, {
      event: `meta_ads_publish.${action}`,
      status: "ok",
      requestId,
      metadata: { run_id: runId, operation_key: operationKey, attempts: graphContext.attempts }
    });
    const saved = await dbFirst(env, `SELECT * FROM meta_ads_publish_operations WHERE id = ?`, operationId);
    return response({ ok: true, replayed: false, operation: serializeOperation(saved), requestId });
  } catch (error) {
    const normalized = normalizeFailure(error);
    const status = normalized.ambiguous ? "reconciliation_required" : "failed";
    await dbRun(
      env,
      `UPDATE meta_ads_publish_operations
          SET status = ?, attempt_count = attempt_count + 1, error_json = ?,
              meta_trace_id = ?, updated_at = ?
        WHERE id = ?`,
      status,
      limitedJson(normalized),
      nullable(normalized.fbtrace_id),
      nowIso(),
      operationId
    );
    if (normalized.ambiguous) {
      await dbRun(
        env,
        `UPDATE meta_ads_publish_runs SET status = 'reconciliation_required', error_json = ?, updated_at = ? WHERE id = ?`,
        limitedJson(normalized),
        nowIso(),
        runId
      );
    }
    await releaseOperationLocks(env, runId, operationKey);
    await writeAudit2(env, {
      event: `meta_ads_publish.${action}`,
      status,
      requestId,
      metadata: {
        run_id: runId,
        operation_key: operationKey,
        error_class: normalized.classification,
        code: normalized.code,
        subcode: normalized.error_subcode,
        fbtrace_id: normalized.fbtrace_id
      }
    });
    return response({ ok: false, error: "meta_operation_failed", detail: normalized, requestId }, normalized.http_status || 502);
  }
}
__name(executeOperation, "executeOperation");
__name2(executeOperation, "executeOperation");
async function performOperation(action, body, context) {
  if (action === "list_ads") return listAds(body, context);
  if (action === "upload_image") return uploadImage(body, context);
  if (action === "start_video_upload") return startVideoUpload(body, context);
  if (action === "transfer_video_chunk") return transferVideoChunk(body, context);
  if (action === "finish_video_upload") return finishVideoUpload(body, context);
  if (action === "get_video_status") return getVideoStatus(body, context);
  if (action === "create_creative") return createCreative(body, context);
  if (action === "get_creative") return getCreative(body, context);
  if (action === "get_ad") return getAd(body, context);
  if (action === "stage_batch") return stageBatch(body, context);
  if (action === "activate_batch") return activateBatch(body, context);
  if (action === "rollback_batch") return rollbackBatch(body, context);
  if (action === "archive_batch") return archiveBatch(body, context);
  throw failure("invalid_action", { classification: "permanent", http_status: 400 });
}
__name(performOperation, "performOperation");
__name2(performOperation, "performOperation");
async function listAds(body, context) {
  const auth = await resolveGraphAuth(body, context);
  let url = graphUrl(auth.apiVersion, `act_${auth.accountId}/ads`, {
    fields: AD_INVENTORY_FIELDS,
    limit: "500"
  });
  const ads = [];
  let pages = 0;
  while (url) {
    pages += 1;
    if (pages > MAX_AD_PAGES) throw failure("ad_inventory_page_limit", { classification: "permanent", http_status: 409 });
    const result = await graphRequest(url, { method: "GET" }, auth, context);
    ads.push(...safeArray(result.body.data));
    if (ads.length > MAX_ADS) throw failure("ad_inventory_item_limit", { classification: "permanent", http_status: 409 });
    url = validatePagingUrl(result.body?.paging?.next, auth.apiVersion);
  }
  return { data: ads, page_count: pages, item_count: ads.length, truncated: false };
}
__name(listAds, "listAds");
__name2(listAds, "listAds");
async function readAdsetPlacements(body, adsetId, context) {
  const auth = await resolveGraphAuth(body, context);
  const result = await graphRequest(
    graphUrl(auth.apiVersion, adsetId, { fields: ADSET_PLACEMENT_FIELDS }),
    { method: "GET" },
    auth,
    context
  );
  return sanitizeGraphValue(result.body && result.body.targeting);
}
__name(readAdsetPlacements, "readAdsetPlacements");
__name2(readAdsetPlacements, "readAdsetPlacements");
async function uploadImage(body, context) {
  const auth = await resolveGraphAuth(body, context);
  if (!(context.file instanceof Blob)) throw failure("image_file_required", { classification: "permanent", http_status: 400 });
  if (context.file.size <= 0 || context.file.size > MAX_IMAGE_UPLOAD_BYTES) {
    throw failure("image_size_invalid", { classification: "permanent", http_status: 413 });
  }
  const form = new FormData();
  form.append("filename", context.file, clean(body.file_name) || "creative-image.jpg");
  const result = await graphRequest(
    graphUrl(auth.apiVersion, `act_${auth.accountId}/adimages`),
    { method: "POST", body: form },
    auth,
    context
  );
  return sanitizeGraphValue(result.body);
}
__name(uploadImage, "uploadImage");
__name2(uploadImage, "uploadImage");
async function startVideoUpload(body, context) {
  const auth = await resolveGraphAuth(body, context);
  const fileSize = normalizeVideoFileSize(body.file_size);
  const form = new FormData();
  form.append("upload_phase", "start");
  form.append("file_size", String(fileSize));
  const result = await graphRequest(
    graphVideoUrl(auth.apiVersion, `act_${auth.accountId}/advideos`),
    { method: "POST", body: form },
    auth,
    context
  );
  return normalizeVideoUploadResponse(result.body, "start");
}
__name(startVideoUpload, "startVideoUpload");
__name2(startVideoUpload, "startVideoUpload");
async function transferVideoChunk(body, context) {
  const auth = await resolveGraphAuth(body, context);
  if (!(context.file instanceof Blob)) throw failure("video_chunk_required", { classification: "permanent", http_status: 400 });
  if (context.file.size <= 0 || context.file.size > MAX_VIDEO_CHUNK_BYTES) {
    throw failure("video_chunk_size_invalid", { classification: "permanent", http_status: 413 });
  }
  const uploadSessionId = normalizeUploadSessionId(body.upload_session_id);
  const startOffset = normalizeVideoOffset(body.start_offset, "start_offset");
  const expectedEndOffset = startOffset + context.file.size;
  if (expectedEndOffset > MAX_VIDEO_BYTES) throw failure("video_offset_invalid", { classification: "permanent", http_status: 400 });
  const form = new FormData();
  form.append("upload_phase", "transfer");
  form.append("upload_session_id", uploadSessionId);
  form.append("start_offset", String(startOffset));
  form.append("video_file_chunk", context.file, clean(body.file_name) || `video-${startOffset}.part`);
  const result = await graphRequest(
    graphVideoUrl(auth.apiVersion, `act_${auth.accountId}/advideos`),
    { method: "POST", body: form },
    auth,
    context
  );
  const normalized = normalizeVideoUploadResponse(result.body, "transfer");
  const returnedStart = normalizeVideoOffset(normalized.start_offset, "returned_start_offset");
  const returnedEnd = normalizeVideoOffset(normalized.end_offset, "returned_end_offset");
  if (returnedStart < startOffset || returnedStart > expectedEndOffset || returnedEnd < returnedStart || returnedEnd > MAX_VIDEO_BYTES) {
    throw failure("video_offsets_invalid", { classification: "permanent", http_status: 502 });
  }
  return normalized;
}
__name(transferVideoChunk, "transferVideoChunk");
__name2(transferVideoChunk, "transferVideoChunk");
async function finishVideoUpload(body, context) {
  const auth = await resolveGraphAuth(body, context);
  const uploadSessionId = normalizeUploadSessionId(body.upload_session_id);
  const form = new FormData();
  form.append("upload_phase", "finish");
  form.append("upload_session_id", uploadSessionId);
  const title = clean(body.title);
  if (title) form.append("title", title.slice(0, 255));
  const result = await graphRequest(
    graphVideoUrl(auth.apiVersion, `act_${auth.accountId}/advideos`),
    { method: "POST", body: form },
    auth,
    context
  );
  return normalizeVideoUploadResponse(result.body, "finish");
}
__name(finishVideoUpload, "finishVideoUpload");
__name2(finishVideoUpload, "finishVideoUpload");
async function getVideoStatus(body, context) {
  const auth = await resolveGraphAuth(body, context);
  const videoId = normalizeNumericId(body.object_id || body.video_id, "video_id");
  const result = await graphRequest(
    graphUrl(auth.apiVersion, videoId, { fields: "id,status,thumbnails" }),
    { method: "GET" },
    auth,
    context
  );
  const value = sanitizeGraphValue(result.body);
  const videoStatus = clean(value?.status?.video_status || value?.status?.status || value?.video_status).toLowerCase();
  return { ...value, video_status: videoStatus, ready: videoStatus === "ready" };
}
__name(getVideoStatus, "getVideoStatus");
__name2(getVideoStatus, "getVideoStatus");
function normalizeVideoFileSize(value) {
  const size = Number(value);
  if (!Number.isSafeInteger(size) || size <= 0 || size > MAX_VIDEO_BYTES) {
    throw failure("video_size_invalid", { classification: "permanent", http_status: 413 });
  }
  return size;
}
__name(normalizeVideoFileSize, "normalizeVideoFileSize");
__name2(normalizeVideoFileSize, "normalizeVideoFileSize");
function normalizeUploadSessionId(value) {
  const id = clean(value);
  if (!/^\d{5,100}$/.test(id)) throw failure("upload_session_id_invalid");
  return id;
}
__name(normalizeUploadSessionId, "normalizeUploadSessionId");
__name2(normalizeUploadSessionId, "normalizeUploadSessionId");
function normalizeVideoOffset(value, label) {
  const offset = Number(value);
  if (!Number.isSafeInteger(offset) || offset < 0 || offset > MAX_VIDEO_BYTES) throw failure(`${label}_invalid`);
  return offset;
}
__name(normalizeVideoOffset, "normalizeVideoOffset");
__name2(normalizeVideoOffset, "normalizeVideoOffset");
function normalizeVideoUploadResponse(value, phase) {
  const result = sanitizeGraphValue(asObject(value));
  if (phase === "start") {
    normalizeUploadSessionId(result.upload_session_id);
    normalizeNumericId(result.video_id, "video_id");
    normalizeVideoOffset(result.start_offset, "start_offset");
    normalizeVideoOffset(result.end_offset, "end_offset");
  } else if (phase === "transfer") {
    normalizeVideoOffset(result.start_offset, "start_offset");
    normalizeVideoOffset(result.end_offset, "end_offset");
  } else if (result.success !== true && clean(result.success) !== "true") {
    throw failure("video_finish_not_confirmed", { classification: "permanent", http_status: 502 });
  }
  return result;
}
__name(normalizeVideoUploadResponse, "normalizeVideoUploadResponse");
__name2(normalizeVideoUploadResponse, "normalizeVideoUploadResponse");
async function createCreative(body, context) {
  const auth = await resolveGraphAuth(body, context);
  const payload = validateCreativePayload(body.payload, context.operationKey);
  try {
    const result = await graphRequest(
      graphUrl(auth.apiVersion, `act_${auth.accountId}/adcreatives`),
      jsonRequest("POST", payload),
      auth,
      context
    );
    return sanitizeGraphValue(result.body);
  } catch (error) {
    if (!normalizeFailure(error).ambiguous) throw error;
    const reconciled = await findCreativeByOperationName(auth, payload.name, context);
    if (reconciled) return { ...reconciled, reconciled_after_ambiguous_response: true };
    throw error;
  }
}
__name(createCreative, "createCreative");
__name2(createCreative, "createCreative");
async function getCreative(body, context) {
  const auth = await resolveGraphAuth(body, context);
  const creativeId = normalizeNumericId(body.object_id, "object_id");
  const fields = CREATIVE_READ_FIELDS.join(",");
  const result = await graphRequest(graphUrl(auth.apiVersion, creativeId, { fields }), { method: "GET" }, auth, context);
  return sanitizeGraphValue(result.body);
}
__name(getCreative, "getCreative");
__name2(getCreative, "getCreative");
async function getAd(body, context) {
  const auth = await resolveGraphAuth(body, context);
  const adId = normalizeNumericId(body.object_id, "object_id");
  return readAd(auth, adId, context);
}
__name(getAd, "getAd");
__name2(getAd, "getAd");
async function stageBatch(body, context) {
  const jobs = validateBatchJobs(body.jobs);
  const staged = [];
  try {
    for (const job of jobs) {
      const auth = await resolveGraphAuth(job, context);
      const payload = validateAdPayload(job.ad_payload, job.action);
      const desiredStatus = clean(job.desired_status || payload.status || "ACTIVE").toUpperCase();
      if (!["ACTIVE", "PAUSED"].includes(desiredStatus)) {
        throw failure("ad_desired_status_invalid", { classification: "permanent", http_status: 400 });
      }
      payload.status = desiredStatus;
      if (job.action === "replace_existing") {
        const adId = normalizeNumericId(job.target_ad_id, "target_ad_id");
        const previous = await readAd(auth, adId, context);
        const result = await updateAdWithReconciliation(auth, adId, payload, context);
        const record = buildStagedRecord(job, adId, previous, result, false);
        staged.push(record);
        await upsertJob(context.env, context.runId, record, "staged");
      } else {
        const result = await createAdWithReconciliation(auth, payload, context);
        const adId = normalizeNumericId(result.id, "created_ad_id");
        const record = buildStagedRecord(job, adId, {}, result, true);
        staged.push(record);
        await upsertJob(context.env, context.runId, record, "staged");
      }
    }
  } catch (error) {
    const rollback = await compensateStaged(staged, context);
    const normalized = normalizeFailure(error);
    normalized.compensation = rollback;
    normalized.ambiguous = normalized.ambiguous || rollback.reconciliation_required;
    throw Object.assign(new Error(normalized.message || "stage_batch_failed"), normalized);
  }
  await setRunState(context.env, context.runId, "staged", { jobs: staged.map(stripJobForSummary) });
  return { status: "staged", job_count: staged.length, jobs: staged };
}
__name(stageBatch, "stageBatch");
__name2(stageBatch, "stageBatch");
async function activateBatch(body, context) {
  const staged = await loadStagedOperation(body.stage_operation_key, context);
  const activated = [];
  try {
    for (const record of staged.jobs) {
      const auth = await resolveGraphAuth(record, context);
      const desiredStatus = clean(record.desired_status || "ACTIVE").toUpperCase();
      if (!["ACTIVE", "PAUSED"].includes(desiredStatus)) {
        throw failure("ad_desired_status_invalid", { classification: "permanent", http_status: 400 });
      }
      const result = await updateAdWithReconciliation(auth, record.ad_id, { status: desiredStatus }, context);
      activated.push({ ...record, activation_result: sanitizeGraphValue(result) });
      await updateJobStatus(context.env, record.operation_key, desiredStatus === "ACTIVE" ? "active" : "paused", { ad_id: record.ad_id });
    }
  } catch (error) {
    const rollback = await compensateStaged(staged.jobs, context);
    const normalized = normalizeFailure(error);
    normalized.compensation = rollback;
    normalized.ambiguous = normalized.ambiguous || rollback.reconciliation_required;
    throw Object.assign(new Error(normalized.message || "activate_batch_failed"), normalized);
  }
  await setRunState(context.env, context.runId, "meta_completed_drive_pending", {
    jobs: activated.map(stripJobForSummary)
  });
  return { status: "meta_completed_drive_pending", job_count: activated.length, jobs: activated };
}
__name(activateBatch, "activateBatch");
__name2(activateBatch, "activateBatch");
async function rollbackBatch(body, context) {
  const staged = await loadStagedOperation(body.stage_operation_key, context);
  const rollback = await compensateStaged(staged.jobs, context);
  const status = rollback.reconciliation_required ? "reconciliation_required" : "rolled_back";
  await setRunState(context.env, context.runId, status, rollback);
  if (rollback.reconciliation_required) {
    throw failure("rollback_reconciliation_required", {
      classification: "ambiguous",
      ambiguous: true,
      http_status: 502,
      compensation: rollback
    });
  }
  return { status, ...rollback };
}
__name(rollbackBatch, "rollbackBatch");
__name2(rollbackBatch, "rollbackBatch");
async function archiveBatch(body, context) {
  const staged = await loadStagedOperation(body.stage_operation_key, context);
  const records = safeArray(staged.jobs);
  if (records.some((record) => record.created_new !== true)) {
    throw failure("archive_batch_requires_created_ads", { classification: "permanent", http_status: 409 });
  }
  const results = [];
  let reconciliationRequired = false;
  for (const record of [...records].reverse()) {
    try {
      const auth = await resolveGraphAuth(record, context);
      await updateAdWithReconciliation(auth, record.ad_id, { status: "ARCHIVED" }, context);
      await updateJobStatus(context.env, record.operation_key, "archived", { ad_id: record.ad_id });
      results.push({ ad_id: record.ad_id, action: "archive_created", ok: true });
    } catch (error) {
      reconciliationRequired = true;
      const normalized = normalizeFailure(error);
      await updateJobStatus(context.env, record.operation_key, "reconciliation_required", normalized);
      results.push({ ad_id: record.ad_id, action: "archive_created", ok: false, error: normalized });
    }
  }
  const status = reconciliationRequired ? "reconciliation_required" : "calibration_archived";
  await setRunState(context.env, context.runId, status, { reconciliation_required: reconciliationRequired, results });
  if (reconciliationRequired) {
    throw failure("archive_reconciliation_required", { classification: "ambiguous", ambiguous: true, http_status: 502, results });
  }
  return { status, reconciliation_required: false, results };
}
__name(archiveBatch, "archiveBatch");
__name2(archiveBatch, "archiveBatch");
async function loadStagedOperation(operationKey, context) {
  const key = requireKey(operationKey, "stage_operation_key");
  const row = await dbFirst(
    context.env,
    `SELECT result_json, status, action FROM meta_ads_publish_operations
      WHERE run_id = ? AND operation_key = ?`,
    context.runId,
    key
  );
  if (!row || clean(row.status) !== "completed" || clean(row.action) !== "stage_batch") {
    throw failure("staged_operation_not_found", { classification: "permanent", http_status: 409 });
  }
  const result = parseObject(row.result_json);
  if (!safeArray(result.jobs).length) throw failure("staged_jobs_missing", { classification: "permanent", http_status: 409 });
  return result;
}
__name(loadStagedOperation, "loadStagedOperation");
__name2(loadStagedOperation, "loadStagedOperation");
async function compensateStaged(records, context) {
  const results = [];
  let reconciliationRequired = false;
  for (const record of [...records].reverse()) {
    try {
      const auth = await resolveGraphAuth(record, context);
      if (record.created_new) {
        await updateAdWithReconciliation(auth, record.ad_id, { status: "PAUSED" }, context);
        results.push({ ad_id: record.ad_id, action: "pause_created", ok: true });
      } else {
        const payload = previousStatePayload(record.previous_state);
        await updateAdWithReconciliation(auth, record.ad_id, payload, context);
        results.push({ ad_id: record.ad_id, action: "restore_existing", ok: true });
      }
      await updateJobStatus(context.env, record.operation_key, "rolled_back", { ad_id: record.ad_id });
    } catch (error) {
      reconciliationRequired = true;
      const normalized = normalizeFailure(error);
      results.push({
        ad_id: record.ad_id,
        action: record.created_new ? "pause_created" : "restore_existing",
        ok: false,
        error: normalized
      });
      await updateJobStatus(context.env, record.operation_key, "reconciliation_required", normalized);
    }
  }
  return { reconciliation_required: reconciliationRequired, results };
}
__name(compensateStaged, "compensateStaged");
__name2(compensateStaged, "compensateStaged");
async function resolveGraphAuth(body, context) {
  const tokenId = clean(body.token_id);
  if (!tokenId) throw failure("token_id_required", { classification: "permanent", http_status: 400 });
  const row = await dbFirst(
    context.env,
    `SELECT id, provider, active, token_ciphertext, metadata_json
       FROM credential_tokens WHERE id = ?`,
    tokenId
  );
  if (!row || row.provider !== "facebook" || Number(row.active) !== 1) {
    throw failure("facebook_token_not_available", { classification: "auth", http_status: 401 });
  }
  const metadata = parseObject(row.metadata_json);
  const config = asObject(metadata.meta_ads_publish);
  const accountId = normalizeNumericId(body.account_id || config.account_id, "account_id");
  const configuredAccount = normalizeNumericId(config.account_id, "configured_account_id");
  if (accountId !== configuredAccount) {
    throw failure("account_not_authorized_for_token", { classification: "auth", http_status: 403 });
  }
  const apiVersion = normalizeApiVersion(body.api_version || config.api_version || "v25.0");
  const accessToken = await context.decryptToken(row.token_ciphertext, context.env);
  const appSecretProof = clean(context.env.META_APP_SECRET) ? await hmacSha256(clean(context.env.META_APP_SECRET), accessToken) : "";
  return { tokenId, accountId, apiVersion, accessToken, appSecretProof };
}
__name(resolveGraphAuth, "resolveGraphAuth");
__name2(resolveGraphAuth, "resolveGraphAuth");
async function graphRequest(url, init, auth, context) {
  let lastFailure;
  const started = Date.now();
  for (let attempt = 1; attempt <= MAX_GRAPH_ATTEMPTS; attempt += 1) {
    context.attempts += 1;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), GRAPH_TIMEOUT_MS);
    try {
      const target = appendAppSecretProof(url, auth.appSecretProof);
      const headers = new Headers(init.headers || {});
      headers.set("Authorization", `Bearer ${auth.accessToken}`);
      const graphFetch = context.env.META_GRAPH_FETCH || fetch;
      const graphResponse = await graphFetch(target, { ...init, headers, signal: controller.signal });
      const body = await parseGraphBody(graphResponse);
      const rateUsage = extractRateUsage(graphResponse.headers);
      context.rateUsage = mergeRateUsage(context.rateUsage, rateUsage);
      context.traceId = clean(body?.error?.fbtrace_id || context.traceId);
      const maxUsage = maxRateUsage(rateUsage);
      if (maxUsage >= 95 && graphResponse.ok) {
        context.rateUsage.pause_recommended = true;
      } else if (maxUsage >= 80) {
        context.rateUsage.warning = true;
      }
      if (graphResponse.ok && !body?.error) return { body, status: graphResponse.status, headers: graphResponse.headers };
      const normalized = normalizeMetaError(body, graphResponse.status, graphResponse.headers);
      lastFailure = normalized;
      if (!normalized.retryable || attempt === MAX_GRAPH_ATTEMPTS) throw Object.assign(new Error(normalized.message), normalized);
      const delay = retryDelayMs(attempt, graphResponse.headers, started);
      if (delay <= 0) throw Object.assign(new Error(normalized.message), normalized);
      await (context.env.META_GRAPH_SLEEP || sleep)(delay);
    } catch (error) {
      const normalized = normalizeFailure(error);
      lastFailure = normalized;
      if (!normalized.retryable || attempt === MAX_GRAPH_ATTEMPTS) throw Object.assign(new Error(normalized.message), normalized);
      const delay = retryDelayMs(attempt, null, started);
      if (delay <= 0) throw Object.assign(new Error(normalized.message), normalized);
      await (context.env.META_GRAPH_SLEEP || sleep)(delay);
    } finally {
      clearTimeout(timeout);
    }
  }
  throw Object.assign(new Error(lastFailure?.message || "meta_graph_failed"), lastFailure || {});
}
__name(graphRequest, "graphRequest");
__name2(graphRequest, "graphRequest");
async function readAd(auth, adId, context) {
  const result = await graphRequest(
    graphUrl(auth.apiVersion, adId, { fields: AD_STATE_FIELDS }),
    { method: "GET" },
    auth,
    context
  );
  return sanitizeGraphValue(result.body);
}
__name(readAd, "readAd");
__name2(readAd, "readAd");
async function updateAdWithReconciliation(auth, adId, payload, context) {
  try {
    const result = await graphRequest(graphUrl(auth.apiVersion, adId), jsonRequest("POST", payload), auth, context);
    return sanitizeGraphValue(result.body);
  } catch (error) {
    if (!normalizeFailure(error).ambiguous) throw error;
    const current = await readAd(auth, adId, context);
    if (adStateMatches(current, payload)) return { success: true, id: adId, reconciled_after_ambiguous_response: true };
    throw error;
  }
}
__name(updateAdWithReconciliation, "updateAdWithReconciliation");
__name2(updateAdWithReconciliation, "updateAdWithReconciliation");
async function createAdWithReconciliation(auth, payload, context) {
  try {
    const result = await graphRequest(
      graphUrl(auth.apiVersion, `act_${auth.accountId}/ads`),
      jsonRequest("POST", payload),
      auth,
      context
    );
    return sanitizeGraphValue(result.body);
  } catch (error) {
    if (!normalizeFailure(error).ambiguous) throw error;
    const found = await findAdByPayload(auth, payload, context);
    if (found) return { id: found.id, success: true, reconciled_after_ambiguous_response: true };
    throw error;
  }
}
__name(createAdWithReconciliation, "createAdWithReconciliation");
__name2(createAdWithReconciliation, "createAdWithReconciliation");
async function findCreativeByOperationName(auth, name, context) {
  const result = await graphRequest(
    graphUrl(auth.apiVersion, `act_${auth.accountId}/adcreatives`, { fields: "id,name", limit: "100" }),
    { method: "GET" },
    auth,
    context
  );
  const matches = safeArray(result.body.data).filter((entry) => clean(entry.name) === clean(name));
  return matches.length === 1 ? sanitizeGraphValue(matches[0]) : null;
}
__name(findCreativeByOperationName, "findCreativeByOperationName");
__name2(findCreativeByOperationName, "findCreativeByOperationName");
async function findAdByPayload(auth, payload, context) {
  const result = await graphRequest(
    graphUrl(auth.apiVersion, `act_${auth.accountId}/ads`, { fields: AD_STATE_FIELDS, limit: "100" }),
    { method: "GET" },
    auth,
    context
  );
  const creativeId = clean(payload?.creative?.creative_id);
  const matches = safeArray(result.body.data).filter((entry) => clean(entry.name) === clean(payload.name) && clean(entry.adset_id) === clean(payload.adset_id) && clean(entry.creative?.id) === creativeId);
  return matches.length === 1 ? matches[0] : null;
}
__name(findAdByPayload, "findAdByPayload");
__name2(findAdByPayload, "findAdByPayload");
function validateCreativePayload(value, operationKey) {
  const payload = sanitizeGraphValue(asObject(value));
  const story = asObject(payload.object_story_spec);
  const videoData = asObject(story.video_data);
  const isVideoOnly = Boolean(clean(videoData.video_id));
  if (!payload.object_story_spec) {
    throw failure("flexible_creative_required", { classification: "permanent", http_status: 400 });
  }
  if (isVideoOnly) {
    if (Object.keys(asObject(payload.asset_feed_spec)).length) {
      throw failure("video_single_asset_feed_forbidden", { classification: "permanent", http_status: 400 });
    }
    normalizeNumericId(videoData.video_id, "video_id");
    if (!/^[A-Za-z0-9_-]{16,200}$/.test(clean(videoData.image_hash))) throw failure("video_thumbnail_hash_invalid");
    const cta = asObject(videoData.call_to_action);
    const ctaType = clean(cta.type).toUpperCase();
    if (!["LEARN_MORE", "WHATSAPP_MESSAGE", "BOOK_NOW"].includes(ctaType)) {
      throw failure("creative_cta_invalid", { classification: "permanent", http_status: 400 });
    }
    const primaryUrl2 = clean(asObject(cta.value).link);
    let primaryParsed2;
    try {
      primaryParsed2 = new URL(primaryUrl2);
    } catch {
      primaryParsed2 = null;
    }
    if (!primaryParsed2 || primaryParsed2.protocol !== "https:" || primaryParsed2.username || primaryParsed2.password) {
      throw failure("creative_landing_page_invalid", { classification: "permanent", http_status: 400 });
    }
    if (ctaType === "WHATSAPP_MESSAGE" && !isWhatsAppHostname(primaryParsed2.hostname)) throw failure("creative_whatsapp_destination_required");
    if (ctaType !== "WHATSAPP_MESSAGE" && isWhatsAppHostname(primaryParsed2.hostname)) throw failure("creative_whatsapp_destination_forbidden");
    if (Object.keys(asObject(payload.degrees_of_freedom_spec)).length || Object.keys(asObject(payload.creative_sourcing_spec)).length) {
      throw failure("video_single_asset_feed_extras_forbidden", { classification: "permanent", http_status: 400 });
    }
    const marker2 = `[sk:${shortKey(operationKey)}]`;
    const name2 = clean(payload.name) || "Meta Ads Publish Video Creative";
    payload.name = name2.includes(marker2) ? name2 : `${name2} ${marker2}`.slice(0, 255);
    delete payload.access_token;
    return payload;
  }
  if (!payload.asset_feed_spec) {
    throw failure("flexible_creative_required", { classification: "permanent", http_status: 400 });
  }
  const feed = asObject(payload.asset_feed_spec);
  const images = safeArray(feed.images);
  const videos = safeArray(feed.videos);
  const isAssetFeedVideoOnly = images.length === 0 && videos.length === 1;
  if ((!isAssetFeedVideoOnly && images.length < 3) || safeArray(feed.bodies).length !== 5 || safeArray(feed.titles).length !== 5) {
    throw failure("creative_quality_gate_failed", { classification: "permanent", http_status: 400 });
  }
  if (safeArray(feed.descriptions).length !== 5) {
    throw failure("creative_description_count_invalid", { classification: "permanent", http_status: 400 });
  }
  if (videos.length > 1) throw failure("creative_video_count_invalid", { classification: "permanent", http_status: 400 });
  if (videos.length === 1) {
    const video = asObject(videos[0]);
    normalizeNumericId(video.video_id, "video_id");
    if (!/^[A-Za-z0-9_-]{16,200}$/.test(clean(video.thumbnail_hash))) throw failure("video_thumbnail_hash_invalid");
    const formats = safeArray(feed.ad_formats).map(clean).filter(Boolean);
    const requiredFormat = isAssetFeedVideoOnly ? "SINGLE_VIDEO" : "AUTOMATIC_FORMAT";
    if (formats.length !== 1 || formats[0] !== requiredFormat) {
      throw failure(isAssetFeedVideoOnly ? "video_only_feed_requires_single_video_format" : "mixed_video_feed_requires_automatic_format");
    }
  }
  if (payload.video_id || asObject(payload.object_story_spec).video_id) throw failure("root_video_id_forbidden");
  const imageLabels = new Set(safeArray(feed.images).flatMap((asset) => safeArray(asset?.adlabels).map((label) => clean(label?.name))).filter(Boolean));
  const videoLabels = new Set(videos.flatMap((asset) => safeArray(asset?.adlabels).map((label) => clean(label?.name))).filter(Boolean));
  const bodyLabels = new Set(safeArray(feed.bodies).flatMap((asset) => safeArray(asset?.adlabels).map((label) => clean(label?.name))).filter(Boolean));
  const titleLabels = new Set(safeArray(feed.titles).flatMap((asset) => safeArray(asset?.adlabels).map((label) => clean(label?.name))).filter(Boolean));
  const descriptionLabels = new Set(safeArray(feed.descriptions).flatMap((asset) => safeArray(asset?.adlabels).map((label) => clean(label?.name))).filter(Boolean));
  const customizationRules = safeArray(feed.asset_customization_rules);
  const videoRules = [];
  const ruleMetadata = [];
  const placementClaims = /* @__PURE__ */ new Set();
  const usedDescriptionLabels = /* @__PURE__ */ new Set();
  for (const [index, rule] of customizationRules.entries()) {
    const imageLabel = clean(rule?.image_label?.name);
    const videoLabel = clean(rule?.video_label?.name);
    const bodyLabel = clean(rule?.body_label?.name);
    const titleLabel = clean(rule?.title_label?.name);
    const descriptionLabel = clean(rule?.description_label?.name);
    if (!imageLabel && !videoLabel) throw failure(`creative_rule_media_label_missing:${index}`);
    if (imageLabel && !imageLabels.has(imageLabel)) throw failure(`creative_rule_image_label_invalid:${index}`);
    if (videoLabel) {
      if (imageLabel) throw failure(`creative_mixed_video_rule_image_label_forbidden:${index}`);
      if (!videoLabels.has(videoLabel)) throw failure(`creative_rule_video_label_invalid:${index}`);
      videoRules.push({ index, videoLabel });
    }
    if (!descriptionLabel && !isAssetFeedVideoOnly) throw failure(`creative_rule_description_label_invalid:${index}`);
    if (descriptionLabel && !descriptionLabels.has(descriptionLabel)) throw failure(`creative_rule_description_label_invalid:${index}`);
    // Video-only placement customization uses two non-overlapping rules with
    // a distinct text label per scope. Unlabelled copy would apply all five
    // variants to one rule, which Graph rejects (subcode 1885878).
    if (descriptionLabel && usedDescriptionLabels.has(descriptionLabel) && !isAssetFeedVideoOnly) throw failure(`creative_rule_description_label_reused:${index}`);
    if (descriptionLabel) usedDescriptionLabels.add(descriptionLabel);
    const spec = asObject(rule?.customization_spec);
    ruleMetadata.push({ index, imageLabel, videoLabel, bodyLabel, titleLabel, descriptionLabel, spec });
    for (const publisher of safeArray(spec.publisher_platforms).map(clean).filter(Boolean)) {
      const positions = publisher === "facebook"
        ? safeArray(spec.facebook_positions)
        : publisher === "instagram"
          ? safeArray(spec.instagram_positions)
          : publisher === "audience_network"
            ? safeArray(spec.audience_network_positions)
            : publisher === "whatsapp"
              ? safeArray(spec.whatsapp_positions)
              : ["*"];
      for (const position of positions.length ? positions : ["*"]) {
        const claim = `${publisher}:${clean(position)}:${imageLabel}:${videoLabel}`;
        if (placementClaims.has(claim)) throw failure(`creative_rule_overlap:${index}`);
        placementClaims.add(claim);
      }
    }
  }
  if (videos.length === 1) {
    const equal = (actual, expected) => {
      const values = safeArray(actual).map(clean).filter(Boolean);
      return values.length === expected.length && expected.every((value) => values.includes(value));
    };
    const contains = (actual, expected) => expected.every((value) => safeArray(actual).map(clean).includes(value));
    if (isAssetFeedVideoOnly) {
      const hasOneUniqueLabel = (assets, labels) => safeArray(assets).length === 5 && labels.size === 5 && safeArray(assets).every((asset) => {
        const labels = safeArray(asset?.adlabels).map((label) => clean(label?.name)).filter(Boolean);
        return labels.length === 1;
      });
      if (videoLabels.size !== 1 || !videoLabels.has("vertical_video") || videoRules.length !== 2 || ruleMetadata.length !== 2) {
        throw failure("creative_video_only_rule_invalid");
      }
      if (!hasOneUniqueLabel(feed.bodies, bodyLabels)) {
        throw failure("creative_video_only_body_labels_invalid");
      }
      if (!hasOneUniqueLabel(feed.titles, titleLabels)) {
        throw failure("creative_video_only_title_labels_invalid");
      }
      if (!hasOneUniqueLabel(feed.descriptions, descriptionLabels)) {
        throw failure("creative_video_only_description_labels_invalid");
      }
      const labelsValid = ruleMetadata.every((videoRule) => videoRule.videoLabel === "vertical_video" && !videoRule.imageLabel && bodyLabels.has(videoRule.bodyLabel) && titleLabels.has(videoRule.titleLabel) && descriptionLabels.has(videoRule.descriptionLabel));
      if (!labelsValid) {
        throw failure("creative_video_only_rule_labels_invalid");
      }
      const mainRule = ruleMetadata.find((entry) => equal(asObject(entry.spec).publisher_platforms, ["facebook", "instagram", "audience_network", "whatsapp"]));
      const rewardedRule = ruleMetadata.find((entry) => equal(asObject(entry.spec).publisher_platforms, ["audience_network"]) && equal(asObject(entry.spec).audience_network_positions, ["rewarded_video"]));
      const mainSpec = asObject(mainRule?.spec);
      const rewardedSpec = asObject(rewardedRule?.spec);
      if (clean(mainRule?.bodyLabel) === clean(rewardedRule?.bodyLabel) || clean(mainRule?.titleLabel) === clean(rewardedRule?.titleLabel) || clean(mainRule?.descriptionLabel) === clean(rewardedRule?.descriptionLabel)) {
        throw failure("creative_video_only_rule_text_label_reused");
      }
      if (!mainRule || !rewardedRule || !equal(mainSpec.facebook_positions, ["feed", "instream_video", "story", "search", "facebook_reels", "facebook_reels_overlay", "notification"]) || !equal(mainSpec.instagram_positions, ["stream", "story", "reels"]) || !equal(mainSpec.audience_network_positions, ["classic"]) || !equal(mainSpec.whatsapp_positions, ["status"]) || safeArray(rewardedSpec.facebook_positions).length || safeArray(rewardedSpec.instagram_positions).length || safeArray(rewardedSpec.whatsapp_positions).length) {
        throw failure("creative_video_only_placement_scope_invalid");
      }
    } else {
      if (videoRules.length !== 1 || videoRules[0].videoLabel !== [...videoLabels][0]) {
        throw failure("creative_video_rule_invalid");
      }
      const videoRule = ruleMetadata.find((entry) => entry.videoLabel === videoRules[0].videoLabel);
      const videoSpec = asObject(videoRule?.spec);
      if (!equal(videoSpec.publisher_platforms, ["audience_network"]) || !equal(videoSpec.audience_network_positions, ["rewarded_video"]) || safeArray(videoSpec.facebook_positions).length || safeArray(videoSpec.instagram_positions).length || safeArray(videoSpec.whatsapp_positions).length) {
        throw failure("creative_mixed_video_rule_must_be_rewarded_video_only");
      }
      const staticVertical = ruleMetadata.find((entry) => entry.imageLabel === "vertical_image" && !entry.videoLabel);
      const staticSpec = asObject(staticVertical?.spec);
      if (!staticVertical || !contains(staticSpec.publisher_platforms, ["facebook", "instagram", "audience_network", "whatsapp"]) || !contains(staticSpec.facebook_positions, ["instream_video", "story", "facebook_reels"]) || !contains(staticSpec.instagram_positions, ["story", "reels"]) || !contains(staticSpec.audience_network_positions, ["classic"]) || !contains(staticSpec.whatsapp_positions, ["status"])) {
        throw failure("creative_mixed_static_vertical_rule_invalid");
      }
    }
  }
  if (!isAssetFeedVideoOnly && usedDescriptionLabels.size !== safeArray(feed.asset_customization_rules).length) {
    throw failure("creative_description_rule_count_invalid");
  }
  const ctas = safeArray(feed.call_to_action_types).map((entry) => clean(entry).toUpperCase());
  if (ctas.length !== 1 || !["LEARN_MORE", "WHATSAPP_MESSAGE", "BOOK_NOW"].includes(ctas[0])) {
    throw failure("creative_cta_invalid", { classification: "permanent", http_status: 400 });
  }
  const primaryUrl = clean(safeArray(feed.link_urls)[0]?.website_url);
  const sourceUrl = clean(asObject(payload.creative_sourcing_spec).source_url);
  let primaryParsed;
  try {
    primaryParsed = new URL(primaryUrl);
  } catch {
    primaryParsed = null;
  }
  if (!primaryParsed || primaryParsed.protocol !== "https:" || primaryParsed.username || primaryParsed.password) {
    throw failure("creative_landing_page_invalid", { classification: "permanent", http_status: 400 });
  }
  if (ctas[0] === "WHATSAPP_MESSAGE" && !isWhatsAppHostname(primaryParsed.hostname)) throw failure("creative_whatsapp_destination_required");
  if (ctas[0] !== "WHATSAPP_MESSAGE" && isWhatsAppHostname(primaryParsed.hostname)) throw failure("creative_whatsapp_destination_forbidden");
  if (sourceUrl && sourceUrl !== primaryUrl) throw failure("creative_source_url_mismatch");
  const freedom = asObject(payload.degrees_of_freedom_spec);
  if (Object.prototype.hasOwnProperty.call(freedom, "standard_enhancements")) {
    throw failure("standard_enhancements_forbidden", { classification: "permanent", http_status: 400 });
  }
  const features = asObject(freedom.creative_features_spec);
  for (const [feature, details] of Object.entries(features)) {
    if (!ALLOWED_CREATIVE_FEATURES.has(feature) || FORBIDDEN_CREATIVE_FEATURES.has(feature)) {
      throw failure(`creative_feature_forbidden:${feature}`, { classification: "permanent", http_status: 400 });
    }
    if (clean(details && details.enroll_status).toUpperCase() !== "OPT_IN") {
      throw failure(`creative_feature_not_opted_in:${feature}`, { classification: "permanent", http_status: 400 });
    }
  }
  for (const feature of REQUIRED_CREATIVE_FEATURES) {
    if (!Object.prototype.hasOwnProperty.call(features, feature)) {
      throw failure(`creative_feature_required:${feature}`, { classification: "permanent", http_status: 400 });
    }
  }
  const siteLinks = safeArray(asObject(payload.creative_sourcing_spec).site_links_spec);
  if (Boolean(features.site_extensions) !== (siteLinks.length >= 2 && siteLinks.length <= 4)) {
    throw failure("creative_site_extensions_mismatch", { classification: "permanent", http_status: 400 });
  }
  const marker = `[sk:${shortKey(operationKey)}]`;
  const name = clean(payload.name) || "Meta Ads Publish Creative";
  payload.name = name.includes(marker) ? name : `${name} ${marker}`.slice(0, 255);
  delete payload.access_token;
  return payload;
}
__name(validateCreativePayload, "validateCreativePayload");
__name2(validateCreativePayload, "validateCreativePayload");
function validateAdPayload(value, action) {
  const payload = sanitizeGraphValue(asObject(value));
  if (!clean(payload.name) || !clean(payload?.creative?.creative_id)) {
    throw failure("ad_payload_incomplete", { classification: "permanent", http_status: 400 });
  }
  if (action === "create_new" && !clean(payload.adset_id)) {
    throw failure("adset_id_required_for_create", { classification: "permanent", http_status: 400 });
  }
  const status = clean(payload.status || "ACTIVE").toUpperCase();
  if (!["ACTIVE", "PAUSED"].includes(status)) {
    throw failure("ad_status_invalid", { classification: "permanent", http_status: 400 });
  }
  payload.status = status;
  delete payload.access_token;
  return payload;
}
__name(validateAdPayload, "validateAdPayload");
__name2(validateAdPayload, "validateAdPayload");
function validateBatchJobs(value) {
  const jobs = safeArray(value);
  if (!jobs.length || jobs.length > MAX_BATCH_JOBS) {
    throw failure("batch_job_count_invalid", { classification: "permanent", http_status: 400 });
  }
  const targets = /* @__PURE__ */ new Set();
  return jobs.map((raw, index) => {
    const job = asObject(raw);
    const action = clean(job.action);
    if (!["create_new", "replace_existing"].includes(action)) {
      throw failure(`job_${index}_action_invalid`, { classification: "permanent", http_status: 400 });
    }
    const operationKey = requireKey(job.operation_key, `jobs[${index}].operation_key`);
    const resourceKey = action === "replace_existing" ? `ad:${normalizeNumericId(job.target_ad_id, "target_ad_id")}` : `adset:${normalizeNumericId(job.ad_payload?.adset_id, "adset_id")}:name:${batchTargetNameKey(job.ad_payload?.name)}`;
    if (targets.has(resourceKey)) {
      throw failure(`duplicate_batch_target:${resourceKey}`, { classification: "permanent", http_status: 409 });
    }
    targets.add(resourceKey);
    return {
      ...sanitizeGraphValue(job),
      action,
      operation_key: operationKey,
      resource_key: resourceKey,
      destination_group: clean(job.destination_group),
      creative_group_key: clean(job.creative_group_key)
    };
  });
}
__name(validateBatchJobs, "validateBatchJobs");
__name2(validateBatchJobs, "validateBatchJobs");
function buildStagedRecord(job, adId, previousState, result, createdNew) {
  return {
    operation_key: job.operation_key,
    token_id: job.token_id,
    api_version: job.api_version,
    account_id: job.account_id,
    destination_group: job.destination_group,
    creative_group_key: job.creative_group_key,
    creative_id: clean(job.creative_id || job.ad_payload?.creative?.creative_id),
    desired_status: clean(job.desired_status || job.ad_payload?.status || "ACTIVE").toUpperCase(),
    action: job.action,
    resource_key: job.resource_key,
    ad_id: adId,
    created_new: createdNew,
    files: safeArray(job.files).map((file) => ({
      id: clean(file && file.id),
      name: clean(file && file.name),
      ratio: clean(file && file.ratio)
    })).filter((file) => file.id),
    previous_state: sanitizeGraphValue(previousState),
    stage_result: sanitizeGraphValue(result)
  };
}
__name(buildStagedRecord, "buildStagedRecord");
__name2(buildStagedRecord, "buildStagedRecord");
function previousStatePayload(previous) {
  const state = asObject(previous);
  const payload = {
    name: clean(state.name),
    status: clean(state.status),
    creative: clean(state.creative?.id) ? { creative_id: clean(state.creative.id) } : void 0,
    adset_id: clean(state.adset_id) || void 0
  };
  return removeEmpty(payload);
}
__name(previousStatePayload, "previousStatePayload");
__name2(previousStatePayload, "previousStatePayload");
function adStateMatches(current, intended) {
  const state = asObject(current);
  const payload = asObject(intended);
  if (payload.name && clean(state.name) !== clean(payload.name)) return false;
  if (payload.status && clean(state.status) !== clean(payload.status)) return false;
  if (payload.adset_id && clean(state.adset_id) !== clean(payload.adset_id)) return false;
  if (payload.creative?.creative_id && clean(state.creative?.id) !== clean(payload.creative.creative_id)) return false;
  return true;
}
__name(adStateMatches, "adStateMatches");
__name2(adStateMatches, "adStateMatches");
async function upsertJob(env, runId, record, status) {
  const now = nowIso();
  const requestHash = await sha256(stableStringify(record));
  await dbRun(
    env,
    `INSERT INTO meta_ads_publish_jobs (
      id, run_id, operation_key, request_hash, destination_group, creative_group_key,
      action, resource_key, status, previous_state_json, result_json, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(operation_key) DO UPDATE SET
      status = excluded.status,
      previous_state_json = excluded.previous_state_json,
      result_json = excluded.result_json,
      updated_at = excluded.updated_at`,
    crypto.randomUUID(),
    runId,
    record.operation_key,
    requestHash,
    record.destination_group,
    record.creative_group_key,
    record.action,
    record.resource_key,
    status,
    limitedJson(record.previous_state),
    limitedJson(record),
    now,
    now
  );
}
__name(upsertJob, "upsertJob");
__name2(upsertJob, "upsertJob");
async function updateJobStatus(env, operationKey, status, result) {
  await dbRun(
    env,
    `UPDATE meta_ads_publish_jobs SET status = ?, result_json = ?, updated_at = ? WHERE operation_key = ?`,
    status,
    limitedJson(result),
    nowIso(),
    operationKey
  );
}
__name(updateJobStatus, "updateJobStatus");
__name2(updateJobStatus, "updateJobStatus");
async function setRunState(env, runId, status, summary) {
  await dbRun(
    env,
    `UPDATE meta_ads_publish_runs SET status = ?, summary_json = ?, updated_at = ? WHERE id = ?`,
    status,
    limitedJson(summary),
    nowIso(),
    runId
  );
}
__name(setRunState, "setRunState");
__name2(setRunState, "setRunState");
async function acquireLocks(env, runId, operationKey, resourceKeys) {
  const keys = [...new Set(safeArray(resourceKeys).map(clean).filter(Boolean))].sort();
  const now = nowIso();
  const expiresAt = new Date(Date.now() + LOCK_TTL_MS).toISOString();
  for (const resourceKey of keys) {
    const current = await dbFirst(
      env,
      `SELECT resource_key, run_id, operation_key, expires_at FROM meta_ads_publish_locks WHERE resource_key = ?`,
      resourceKey
    );
    if (current && clean(current.run_id) !== runId && Date.parse(current.expires_at) > Date.now()) {
      throw new Error(`resource_locked:${resourceKey}`);
    }
    await dbRun(
      env,
      `INSERT INTO meta_ads_publish_locks (
        resource_key, run_id, operation_key, heartbeat_at, expires_at, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(resource_key) DO UPDATE SET
        run_id = excluded.run_id,
        operation_key = excluded.operation_key,
        heartbeat_at = excluded.heartbeat_at,
        expires_at = excluded.expires_at,
        updated_at = excluded.updated_at
      WHERE meta_ads_publish_locks.expires_at <= ? OR meta_ads_publish_locks.run_id = ?`,
      resourceKey,
      runId,
      operationKey,
      now,
      expiresAt,
      now,
      now,
      now,
      runId
    );
    const acquired = await dbFirst(
      env,
      `SELECT run_id, operation_key FROM meta_ads_publish_locks WHERE resource_key = ?`,
      resourceKey
    );
    if (!acquired || clean(acquired.run_id) !== runId) throw new Error(`resource_locked:${resourceKey}`);
  }
}
__name(acquireLocks, "acquireLocks");
__name2(acquireLocks, "acquireLocks");
async function releaseOperationLocks(env, runId, operationKey) {
  await dbRun(
    env,
    `DELETE FROM meta_ads_publish_locks
      WHERE run_id = ? AND operation_key = ? AND resource_key NOT LIKE 'batch:%' AND resource_key NOT LIKE 'drive:%'`,
    runId,
    operationKey
  );
}
__name(releaseOperationLocks, "releaseOperationLocks");
__name2(releaseOperationLocks, "releaseOperationLocks");
async function releaseRunLocks(env, runId) {
  await dbRun(env, `DELETE FROM meta_ads_publish_locks WHERE run_id = ?`, runId);
}
__name(releaseRunLocks, "releaseRunLocks");
__name2(releaseRunLocks, "releaseRunLocks");
async function reclaimRecoverableRunLocks(env, requestedRunId, resourceKeys) {
  const owners = /* @__PURE__ */ new Set();
  for (const resourceKey of [...new Set(safeArray(resourceKeys).map(clean).filter(Boolean))]) {
    const current = await dbFirst(
      env,
      `SELECT resource_key, run_id, expires_at FROM meta_ads_publish_locks WHERE resource_key = ?`,
      resourceKey
    );
    if (current && clean(current.run_id) !== requestedRunId && Date.parse(current.expires_at) > Date.now()) owners.add(clean(current.run_id));
  }
  for (const ownerRunId of owners) {
    const owner = await loadRun(env, ownerRunId);
    if (!owner) continue;
    if (TERMINAL_RUN_STATES.has(clean(owner.status))) {
      await releaseRunLocks(env, ownerRunId);
      continue;
    }
    const operations = await dbAll(
      env,
      `SELECT action, status FROM meta_ads_publish_operations WHERE run_id = ?`,
      ownerRunId
    );
    const hasFailedOperation = operations.some((operation) => clean(operation.status) === "failed");
    const hasInFlightOperation = operations.some((operation) => clean(operation.status) === "in_progress");
    const hasCompletedMutation = operations.some((operation) => clean(operation.status) === "completed" && ["create_creative", "stage_batch", "activate_batch"].includes(clean(operation.action)));
    // Only reclaim a stale run when its Graph operation failed conclusively and
    // it did not create/stage/activate anything.  This preserves idempotency
    // and never steals an active or reconciliation-required publication.
    if (!hasFailedOperation || hasInFlightOperation || hasCompletedMutation) continue;
    await dbRun(
      env,
      `UPDATE meta_ads_publish_runs SET status = 'failed', error_json = ?, updated_at = ? WHERE id = ?`,
      limitedJson({ reason: "superseded_after_failed_operation", superseded_by: requestedRunId }),
      nowIso(),
      ownerRunId
    );
    await releaseRunLocks(env, ownerRunId);
  }
}
__name(reclaimRecoverableRunLocks, "reclaimRecoverableRunLocks");
__name2(reclaimRecoverableRunLocks, "reclaimRecoverableRunLocks");
function deriveResourceKeys(action, body) {
  if (action === "stage_batch") {
    return validateBatchJobs(body.jobs).map((job) => job.resource_key);
  }
  if (["activate_batch", "rollback_batch", "archive_batch"].includes(action)) return [`run:${clean(body.stage_operation_key)}`];
  if (action === "create_creative") return [`creative:${clean(body.account_id)}:${shortKey(body.operation_key)}`];
  if (action === "upload_image") return [`image:${clean(body.account_id)}:${shortKey(body.operation_key)}`];
  if (["start_video_upload", "transfer_video_chunk", "finish_video_upload", "get_video_status"].includes(action)) {
    const videoKey = clean(body.video_id || body.object_id || body.upload_session_id || body.source_file_id || body.operation_key);
    return [`video:${clean(body.account_id)}:${shortKey(videoKey)}`];
  }
  return [];
}
__name(deriveResourceKeys, "deriveResourceKeys");
__name2(deriveResourceKeys, "deriveResourceKeys");
function normalizeMetaError(body, status, headers) {
  const error = asObject(body?.error);
  const code = Number(error.code || 0);
  const subcode = Number(error.error_subcode || 0);
  // Meta can return code 100 for both invalid payloads and temporary
  // infrastructure failures.  Subcode 1487390 is explicitly the latter
  // ("try again later"), so it must retain the normal bounded retry path.
  const knownTransientSubcode = subcode === 1487390;
  const transient = knownTransientSubcode || error.is_transient === true || status === 408 || status === 429 || status >= 500;
  const auth = [190, 102, 10, 200].includes(code) || status === 401 || status === 403;
  const permanent = auth || code === 100 && !transient || !transient && status >= 400 && status < 500;
  return {
    message: redactText(error.error_user_msg || error.message || `Meta Graph HTTP ${status}`),
    classification: auth ? "auth" : permanent ? "permanent" : transient ? "transient" : "unknown",
    retryable: transient && !permanent,
    ambiguous: false,
    http_status: status,
    code,
    error_subcode: subcode,
    fbtrace_id: clean(error.fbtrace_id),
    retry_after_seconds: retryAfterSeconds(headers)
  };
}
__name(normalizeMetaError, "normalizeMetaError");
__name2(normalizeMetaError, "normalizeMetaError");
function normalizeFailure(error) {
  if (error && typeof error === "object" && error.classification) {
    return {
      message: redactText(error.message || "meta_operation_failed"),
      classification: clean(error.classification),
      retryable: Boolean(error.retryable),
      ambiguous: Boolean(error.ambiguous),
      http_status: Number(error.http_status || 502),
      code: Number(error.code || 0),
      error_subcode: Number(error.error_subcode || 0),
      fbtrace_id: clean(error.fbtrace_id),
      compensation: error.compensation
    };
  }
  const name = clean(error?.name);
  const aborted = name === "AbortError";
  return {
    message: aborted ? "meta_graph_timeout" : redactText(error?.message || "meta_graph_network_error"),
    classification: "transient",
    retryable: true,
    ambiguous: true,
    http_status: 502,
    code: 0,
    error_subcode: 0,
    fbtrace_id: ""
  };
}
__name(normalizeFailure, "normalizeFailure");
__name2(normalizeFailure, "normalizeFailure");
function failure(message, extra = {}) {
  return Object.assign(new Error(message), {
    classification: "permanent",
    retryable: false,
    ambiguous: false,
    http_status: 400,
    ...extra
  });
}
__name(failure, "failure");
__name2(failure, "failure");
function retryDelayMs(attempt, headers, startedAt) {
  const elapsed = Date.now() - startedAt;
  const remaining = MAX_RETRY_WINDOW_MS - elapsed;
  if (remaining <= 0) return 0;
  const retryAfter = retryAfterSeconds(headers) * 1e3;
  const backoff = Math.min(3e4, 2 ** (attempt - 1) * 1e3 + Math.floor(Math.random() * 500));
  return Math.min(remaining, retryAfter || backoff);
}
__name(retryDelayMs, "retryDelayMs");
__name2(retryDelayMs, "retryDelayMs");
function retryAfterSeconds(headers) {
  const value = Number(headers?.get?.("retry-after") || 0);
  return Number.isFinite(value) && value > 0 ? Math.min(value, 300) : 0;
}
__name(retryAfterSeconds, "retryAfterSeconds");
__name2(retryAfterSeconds, "retryAfterSeconds");
function extractRateUsage(headers) {
  const out = {};
  for (const name of ["x-business-use-case-usage", "x-ad-account-usage", "x-app-usage"]) {
    const raw = clean(headers?.get?.(name));
    if (!raw) continue;
    try {
      out[name] = JSON.parse(raw);
    } catch {
      out[name] = { unparsed: true };
    }
  }
  return out;
}
__name(extractRateUsage, "extractRateUsage");
__name2(extractRateUsage, "extractRateUsage");
function maxRateUsage(value) {
  let max = 0;
  if (Array.isArray(value)) {
    for (const item of value) max = Math.max(max, maxRateUsage(item));
  } else if (value && typeof value === "object") {
    for (const [key, item] of Object.entries(value)) {
      if (["call_count", "total_cputime", "total_time"].includes(key) && Number.isFinite(Number(item))) {
        max = Math.max(max, Number(item));
      } else {
        max = Math.max(max, maxRateUsage(item));
      }
    }
  }
  return max;
}
__name(maxRateUsage, "maxRateUsage");
__name2(maxRateUsage, "maxRateUsage");
function mergeRateUsage(left, right) {
  return { ...asObject(left), ...asObject(right) };
}
__name(mergeRateUsage, "mergeRateUsage");
__name2(mergeRateUsage, "mergeRateUsage");
function graphUrl(apiVersion, path, query = {}) {
  const version = normalizeApiVersion(apiVersion);
  const cleanPath = clean(path).replace(/^\/+/, "");
  if (!cleanPath || /[^A-Za-z0-9_/-]/.test(cleanPath)) throw failure("invalid_graph_path");
  const url = new URL(`${GRAPH_ORIGIN}/${version}/${cleanPath}`);
  for (const [key, value] of Object.entries(query)) {
    if (value !== void 0 && value !== null && value !== "") url.searchParams.set(key, String(value));
  }
  return url.toString();
}
__name(graphUrl, "graphUrl");
__name2(graphUrl, "graphUrl");
function graphVideoUrl(apiVersion, path) {
  const version = normalizeApiVersion(apiVersion);
  const cleanPath = clean(path).replace(/^\/+/, "");
  if (!cleanPath || /[^A-Za-z0-9_/-]/.test(cleanPath)) throw failure("invalid_graph_video_path");
  return `${GRAPH_VIDEO_ORIGIN}/${version}/${cleanPath}`;
}
__name(graphVideoUrl, "graphVideoUrl");
__name2(graphVideoUrl, "graphVideoUrl");
function validatePagingUrl(value, apiVersion) {
  const raw = clean(value);
  if (!raw) return "";
  const url = new URL(raw);
  if (url.origin !== GRAPH_ORIGIN || !url.pathname.startsWith(`/${normalizeApiVersion(apiVersion)}/`)) {
    throw failure("invalid_meta_paging_url", { classification: "permanent", http_status: 502 });
  }
  url.searchParams.delete("access_token");
  return url.toString();
}
__name(validatePagingUrl, "validatePagingUrl");
__name2(validatePagingUrl, "validatePagingUrl");
function appendAppSecretProof(value, proof) {
  if (!proof) return value;
  const url = new URL(value);
  url.searchParams.set("appsecret_proof", proof);
  return url.toString();
}
__name(appendAppSecretProof, "appendAppSecretProof");
__name2(appendAppSecretProof, "appendAppSecretProof");
function jsonRequest(method, body) {
  return {
    method,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(removeEmpty(sanitizeGraphValue(body)))
  };
}
__name(jsonRequest, "jsonRequest");
__name2(jsonRequest, "jsonRequest");
async function parseGraphBody(graphResponse) {
  const text2 = await graphResponse.text();
  if (!text2) return {};
  try {
    return JSON.parse(text2);
  } catch {
    return { raw_response: redactText(text2.slice(0, 1e3)) };
  }
}
__name(parseGraphBody, "parseGraphBody");
__name2(parseGraphBody, "parseGraphBody");
function normalizeApiVersion(value) {
  const version = clean(value || "v25.0");
  if (!/^v(?:2[5-9]|[3-9][0-9])\.0$/.test(version)) throw failure("unsupported_api_version");
  return version;
}
__name(normalizeApiVersion, "normalizeApiVersion");
__name2(normalizeApiVersion, "normalizeApiVersion");
function normalizeNumericId(value, label) {
  const id = clean(value).replace(/^act_/, "");
  if (!/^\d{5,30}$/.test(id)) throw failure(`${label}_invalid`);
  return id;
}
__name(normalizeNumericId, "normalizeNumericId");
__name2(normalizeNumericId, "normalizeNumericId");
function normalizeHosts(value) {
  return [...new Set(safeArray(value).map((entry) => clean(entry).toLowerCase()).filter((entry) => /^[a-z0-9.-]+$/.test(entry)))];
}
__name(normalizeHosts, "normalizeHosts");
__name2(normalizeHosts, "normalizeHosts");
function isAllowedHostname(hostname, allowedHosts) {
  const normalized = clean(hostname).replace(/\.$/, "").toLowerCase();
  return normalizeHosts(allowedHosts).some((host) => normalized === host || normalized.endsWith(`.${host}`));
}
__name(isAllowedHostname, "isAllowedHostname");
__name2(isAllowedHostname, "isAllowedHostname");
function isWhatsAppHostname(hostname) {
  const normalized = clean(hostname).replace(/\.$/, "").toLowerCase();
  return WHATSAPP_HOSTS.has(normalized) || normalized.endsWith(".whatsapp.com");
}
__name(isWhatsAppHostname, "isWhatsAppHostname");
__name2(isWhatsAppHostname, "isWhatsAppHostname");
function normalizeMetaPublishDestinationType(value) {
  const normalized = clean(value).toUpperCase();
  if (!normalized) return "";
  if (/WHATSAPP|MESSAG/.test(normalized)) return "WHATSAPP";
  if (/WEBSITE|WEB|SITE/.test(normalized)) return "WEBSITE";
  return "INVALID";
}
__name(normalizeMetaPublishDestinationType, "normalizeMetaPublishDestinationType");
__name2(normalizeMetaPublishDestinationType, "normalizeMetaPublishDestinationType");
function normalizeWhatsAppDestinationUrl(value) {
  const raw = clean(value);
  if (!raw) return { url: "", error: "whatsapp_destination_url_required" };
  try {
    const url = new URL(raw);
    if (url.protocol !== "https:" || url.username || url.password || !isWhatsAppHostname(url.hostname)) {
      return { url: "", error: "whatsapp_destination_url_invalid" };
    }
    url.hash = "";
    return { url: url.toString(), error: "" };
  } catch {
    return { url: "", error: "whatsapp_destination_url_invalid" };
  }
}
__name(normalizeWhatsAppDestinationUrl, "normalizeWhatsAppDestinationUrl");
__name2(normalizeWhatsAppDestinationUrl, "normalizeWhatsAppDestinationUrl");
function parseLandingUrl(value, allowedHosts) {
  try {
    const url = new URL(clean(value));
    if (isWhatsAppHostname(url.hostname)) {
      return { ok: false, error: "landing_page_whatsapp_forbidden", hostname: url.hostname };
    }
    if (url.protocol !== "https:" || url.username || url.password || !isAllowedHostname(url.hostname, allowedHosts)) {
      return { ok: false, error: "landing_page_invalid_or_not_allowed", hostname: clean(url.hostname) || "invalid" };
    }
    url.hash = "";
    return { ok: true, url: url.toString(), hostname: url.hostname };
  } catch {
    return { ok: false, error: "landing_page_url_invalid", hostname: "invalid" };
  }
}
__name(parseLandingUrl, "parseLandingUrl");
__name2(parseLandingUrl, "parseLandingUrl");
function normalizeLandingPageMap(value, allowedHosts) {
  const pages = {};
  const errors = [];
  const seen = /* @__PURE__ */ new Set();
  for (const [rawKey, rawUrl] of Object.entries(asObject(value))) {
    const key = clean(rawKey);
    const normalizedKey = key.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
    if (!key || key.length > 200 || !normalizedKey || seen.has(normalizedKey)) {
      errors.push({ key: key.slice(0, 200), error: seen.has(normalizedKey) ? "landing_page_key_duplicate" : "landing_page_key_invalid" });
      continue;
    }
    seen.add(normalizedKey);
    const parsed = parseLandingUrl(rawUrl, allowedHosts);
    if (!parsed.ok) {
      errors.push({ key, error: parsed.error, hostname: parsed.hostname });
      continue;
    }
    pages[key] = parsed.url;
  }
  return { pages, errors };
}
__name(normalizeLandingPageMap, "normalizeLandingPageMap");
__name2(normalizeLandingPageMap, "normalizeLandingPageMap");
async function validateLandingPagesOnline(pages, allowedHosts, env) {
  const results = {};
  const errors = [];
  for (const [key, configuredUrl] of Object.entries(asObject(pages))) {
    let currentUrl = configuredUrl;
    let redirectCount = 0;
    let completed = false;
    try {
      while (redirectCount <= MAX_LANDING_REDIRECTS) {
        const parsed = parseLandingUrl(currentUrl, allowedHosts);
        if (!parsed.ok) {
          errors.push({ key, error: parsed.error, hostname: parsed.hostname });
          break;
        }
        const landingFetch = env.LANDING_PAGE_FETCH || fetch;
        const pageResponse = await landingFetch(parsed.url, {
          method: "GET",
          redirect: "manual",
          headers: { "User-Agent": "Skincos-Meta-Ads-Preflight/1.0", Range: "bytes=0-0" }
        });
        const location = clean(pageResponse.headers.get("location"));
        if (pageResponse.status >= 300 && pageResponse.status < 400 && location) {
          if (pageResponse.body && typeof pageResponse.body.cancel === "function") await pageResponse.body.cancel();
          redirectCount += 1;
          if (redirectCount > MAX_LANDING_REDIRECTS) {
            errors.push({ key, error: "landing_page_redirect_limit_exceeded" });
            break;
          }
          currentUrl = new URL(location, parsed.url).toString();
          continue;
        }
        if (pageResponse.body && typeof pageResponse.body.cancel === "function") await pageResponse.body.cancel();
        if (pageResponse.status < 200 || pageResponse.status >= 400) {
          errors.push({ key, error: "landing_page_http_error", status: pageResponse.status });
          break;
        }
        results[key] = {
          ok: true,
          final_url: parsed.url,
          final_hostname: parsed.hostname,
          redirect_count: redirectCount,
          status: pageResponse.status
        };
        completed = true;
        break;
      }
      if (!completed && !errors.some((entry) => entry.key === key)) {
        errors.push({ key, error: "landing_page_validation_incomplete" });
      }
    } catch (error) {
      errors.push({ key, error: "landing_page_fetch_failed", detail: redactText(error && error.message) });
    }
  }
  return { results, errors };
}
__name(validateLandingPagesOnline, "validateLandingPagesOnline");
__name2(validateLandingPagesOnline, "validateLandingPagesOnline");
function normalizeFiles(value) {
  const files = safeArray(value);
  if (files.length > 300) throw failure("too_many_files", { http_status: 413 });
  const seen = /* @__PURE__ */ new Set();
  return files.map((entry) => {
    const file = asObject(entry);
    const id = clean(file.id);
    const name = clean(file.name);
    if (!id || !name || seen.has(id)) throw failure("invalid_or_duplicate_file");
    seen.add(id);
    return {
      id,
      name,
      md5_checksum: clean(file.md5_checksum || file.md5Checksum),
      modified_time: clean(file.modified_time || file.modifiedTime),
      size: clean(file.size)
    };
  }).sort((a, b) => a.id.localeCompare(b.id));
}
__name(normalizeFiles, "normalizeFiles");
__name2(normalizeFiles, "normalizeFiles");
async function readOperationRequest(request) {
  const contentLength = Number(request.headers.get("content-length") || 0);
  if (contentLength > MAX_MULTIPART_REQUEST_BYTES) return { error: "request_too_large", status: 413 };
  const contentType = clean(request.headers.get("content-type")).toLowerCase();
  if (contentType.includes("multipart/form-data")) {
    try {
      const form = await request.formData();
      const body = JSON.parse(clean(form.get("request")) || "{}");
      const file = form.get("file");
      return { body: asObject(body), file: file instanceof Blob ? file : null };
    } catch {
      return { error: "invalid_multipart_payload", status: 400 };
    }
  }
  return { body: await readObject(request), file: null };
}
__name(readOperationRequest, "readOperationRequest");
__name2(readOperationRequest, "readOperationRequest");
function operationHashInput(body, file) {
  const copy = sanitizeGraphValue({ ...body });
  delete copy.request_hash;
  if (clean(copy.action) === "start_video_upload") {
    // The normalized MP4 can contain encoder metadata that changes its byte
    // checksum or size without changing the source creative. Idempotency is
    // anchored to the Drive source fingerprint and normalization contract.
    delete copy.file_size;
    delete copy.file_checksum;
    delete copy.resume_video_id;
  }
  if (["transfer_video_chunk", "finish_video_upload"].includes(clean(copy.action))) {
    delete copy.semantic_replay_video_id;
  }
  return {
    ...copy,
    file: file instanceof Blob ? { size: file.size, type: file.type, name: file.name || "" } : null
  };
}
__name(operationHashInput, "operationHashInput");
__name2(operationHashInput, "operationHashInput");
function selectReusableVideoStartOperation(run, body, operations) {
  const requestedVideoId = clean(body.resume_video_id);
  const sourceFileId = clean(body.source_file_id);
  if (!/^\d{5,30}$/.test(requestedVideoId) || !sourceFileId) return null;
  if (!deriveRunFiles(run).some((file) => clean(file.id) === sourceFileId)) return null;
  const matches = safeArray(operations).filter((operation) => {
    if (clean(operation.run_id) && clean(operation.run_id) !== clean(run.id)) return false;
    if (clean(operation.action) !== "start_video_upload" || clean(operation.status) !== "completed") return false;
    const result = parseObject(operation.result_json);
    const sessionId = clean(result.upload_session_id);
    const requestedSessionId = clean(body.upload_session_id);
    return clean(result.video_id) === requestedVideoId && /^\d{5,100}$/.test(sessionId) &&
      (!requestedSessionId || sessionId === requestedSessionId);
  });
  return matches.length === 1 ? matches[0] : null;
}
__name(selectReusableVideoStartOperation, "selectReusableVideoStartOperation");
__name2(selectReusableVideoStartOperation, "selectReusableVideoStartOperation");
function deriveRunFiles(row) {
  return parseArray(row.files_json);
}
__name(deriveRunFiles, "deriveRunFiles");
__name2(deriveRunFiles, "deriveRunFiles");
function serializeRun(row) {
  return {
    id: row.id,
    batch_fingerprint: row.batch_fingerprint,
    workflow_execution_id: row.workflow_execution_id,
    config_revision: row.config_revision,
    status: row.status,
    files: deriveRunFiles(row),
    summary: parseObject(row.summary_json),
    error: parseObject(row.error_json),
    heartbeat_at: row.heartbeat_at,
    lock_expires_at: row.lock_expires_at,
    created_at: row.created_at,
    updated_at: row.updated_at
  };
}
__name(serializeRun, "serializeRun");
__name2(serializeRun, "serializeRun");
function serializeJob(row) {
  return {
    id: row.id,
    operation_key: row.operation_key,
    destination_group: row.destination_group,
    creative_group_key: row.creative_group_key,
    action: row.action,
    resource_key: row.resource_key,
    status: row.status,
    previous_state: parseObject(row.previous_state_json),
    result: parseObject(row.result_json),
    error: parseObject(row.error_json),
    created_at: row.created_at,
    updated_at: row.updated_at
  };
}
__name(serializeJob, "serializeJob");
__name2(serializeJob, "serializeJob");
function serializeOperation(row) {
  return {
    operation_key: row.operation_key,
    action: row.action,
    status: row.status,
    attempt_count: Number(row.attempt_count || 0),
    result: parseObject(row.result_json),
    error: parseObject(row.error_json),
    fbtrace_id: nullable(row.meta_trace_id),
    rate_usage: parseObject(row.rate_usage_json),
    created_at: row.created_at,
    updated_at: row.updated_at
  };
}
__name(serializeOperation, "serializeOperation");
__name2(serializeOperation, "serializeOperation");
function serializeEvent(row) {
  return {
    id: row.id,
    status: row.status,
    payload: parseObject(row.payload_json),
    created_at: row.created_at,
    updated_at: row.updated_at
  };
}
__name(serializeEvent, "serializeEvent");
__name2(serializeEvent, "serializeEvent");
function stripJobForSummary(record) {
  return {
    operation_key: record.operation_key,
    destination_group: record.destination_group,
    creative_group_key: record.creative_group_key,
    action: record.action,
    ad_id: record.ad_id,
    creative_id: record.creative_id,
    created_new: record.created_new,
    desired_status: record.desired_status,
    files: safeArray(record.files)
  };
}
__name(stripJobForSummary, "stripJobForSummary");
__name2(stripJobForSummary, "stripJobForSummary");
function sanitizeGraphValue(value) {
  if (Array.isArray(value)) return value.map(sanitizeGraphValue);
  if (!value || typeof value !== "object") return value;
  const out = {};
  for (const [key, item] of Object.entries(value)) {
    if (/^(access_token|token|fbToken|authorization)$/i.test(key)) continue;
    out[key] = sanitizeGraphValue(item);
  }
  return out;
}
__name(sanitizeGraphValue, "sanitizeGraphValue");
__name2(sanitizeGraphValue, "sanitizeGraphValue");
function removeEmpty(value) {
  if (Array.isArray(value)) return value.map(removeEmpty).filter((item) => item !== void 0 && item !== null && item !== "");
  if (!value || typeof value !== "object") return value;
  const out = {};
  for (const [key, item] of Object.entries(value)) {
    const cleaned = removeEmpty(item);
    if (cleaned === void 0 || cleaned === null || cleaned === "") continue;
    if (Array.isArray(cleaned) && cleaned.length === 0) continue;
    if (cleaned && typeof cleaned === "object" && !Array.isArray(cleaned) && Object.keys(cleaned).length === 0) continue;
    out[key] = cleaned;
  }
  return out;
}
__name(removeEmpty, "removeEmpty");
__name2(removeEmpty, "removeEmpty");
async function loadRun(env, runId) {
  return dbFirst(env, `SELECT * FROM meta_ads_publish_runs WHERE id = ?`, runId);
}
__name(loadRun, "loadRun");
__name2(loadRun, "loadRun");
async function dbFirst(env, sql, ...values) {
  return env.TOKEN_VAULT_DB.prepare(sql).bind(...values).first();
}
__name(dbFirst, "dbFirst");
__name2(dbFirst, "dbFirst");
async function dbAll(env, sql, ...values) {
  const result = await env.TOKEN_VAULT_DB.prepare(sql).bind(...values).all();
  return result.results || [];
}
__name(dbAll, "dbAll");
__name2(dbAll, "dbAll");
async function dbRun(env, sql, ...values) {
  return env.TOKEN_VAULT_DB.prepare(sql).bind(...values).run();
}
__name(dbRun, "dbRun");
__name2(dbRun, "dbRun");
async function readObject(request) {
  try {
    return asObject(await request.json());
  } catch {
    return {};
  }
}
__name(readObject, "readObject");
__name2(readObject, "readObject");
function response(data, status = 200) {
  return new Response(JSON.stringify(sanitizeGraphValue(data)), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store"
    }
  });
}
__name(response, "response");
__name2(response, "response");
async function sha256(value) {
  const bytes = new TextEncoder().encode(String(value));
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}
__name(sha256, "sha256");
__name2(sha256, "sha256");
async function hmacSha256(secret, value) {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(value));
  return [...new Uint8Array(signature)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}
__name(hmacSha256, "hmacSha256");
__name2(hmacSha256, "hmacSha256");
function stableStringify(value) {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}
__name(stableStringify, "stableStringify");
__name2(stableStringify, "stableStringify");
function limitedJson(value) {
  const serialized = JSON.stringify(sanitizeGraphValue(value || {}));
  if (serialized.length > 1e6) throw failure("journal_payload_too_large", { http_status: 413 });
  return serialized;
}
__name(limitedJson, "limitedJson");
__name2(limitedJson, "limitedJson");
function parseObject(value) {
  try {
    return asObject(typeof value === "string" ? JSON.parse(value || "{}") : value);
  } catch {
    return {};
  }
}
__name(parseObject, "parseObject");
__name2(parseObject, "parseObject");
function parseArray(value) {
  try {
    const parsed = typeof value === "string" ? JSON.parse(value || "[]") : value;
    return safeArray(parsed);
  } catch {
    return [];
  }
}
__name(parseArray, "parseArray");
__name2(parseArray, "parseArray");
function asObject(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}
__name(asObject, "asObject");
__name2(asObject, "asObject");
function safeArray(value) {
  return Array.isArray(value) ? value : [];
}
__name(safeArray, "safeArray");
__name2(safeArray, "safeArray");
function clean(value) {
  return String(value ?? "").trim();
}
__name(clean, "clean");
__name2(clean, "clean");
function nullable(value) {
  return clean(value) || null;
}
__name(nullable, "nullable");
__name2(nullable, "nullable");
function requireHash(value, label) {
  const hash = clean(value).toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(hash)) throw failure(`${label}_invalid`);
  return hash;
}
__name(requireHash, "requireHash");
__name2(requireHash, "requireHash");
function requireKey(value, label) {
  const key = clean(value);
  if (!/^[A-Za-z0-9_.:-]{8,200}$/.test(key)) throw failure(`${label}_invalid`);
  return key;
}
__name(requireKey, "requireKey");
__name2(requireKey, "requireKey");
function shortKey(value) {
  const text2 = clean(value).replace(/[^A-Za-z0-9]/g, "").toLowerCase();
  return text2.slice(0, 12) || "unknown";
}
__name(shortKey, "shortKey");
__name2(shortKey, "shortKey");
function batchTargetNameKey(value) {
  const text2 = clean(value).replace(/[^A-Za-z0-9]/g, "").toLowerCase();
  return text2.slice(0, 180) || "unknown";
}
__name(batchTargetNameKey, "batchTargetNameKey");
__name2(batchTargetNameKey, "batchTargetNameKey");
function clampInteger(value, fallback, min, max) {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  return Number.isFinite(parsed) ? Math.max(min, Math.min(max, parsed)) : fallback;
}
__name(clampInteger, "clampInteger");
__name2(clampInteger, "clampInteger");
function nowIso() {
  return (/* @__PURE__ */ new Date()).toISOString();
}
__name(nowIso, "nowIso");
__name2(nowIso, "nowIso");
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
__name(sleep, "sleep");
__name2(sleep, "sleep");
function redactText(value) {
  return clean(value).replace(/Bearer\s+[A-Za-z0-9._-]+/gi, "Bearer [REDACTED]").replace(/[A-Za-z0-9_-]{80,}/g, "[REDACTED]").slice(0, 1e3);
}
__name(redactText, "redactText");
__name2(redactText, "redactText");
var __test = Object.freeze({
  allowedActions: ALLOWED_ACTIONS,
  acquireLocks,
  createOrResumeRun,
  creativeReadFields: CREATIVE_READ_FIELDS,
  adsetPlacementFields: ADSET_PLACEMENT_FIELDS,
  maxRateUsage,
  normalizeApiVersion,
  normalizeMetaError,
  normalizeLandingPageMap,
  normalizeUploadSessionId,
  normalizeVideoFileSize,
  normalizeVideoOffset,
  normalizeVideoUploadResponse,
  operationHashInput,
  selectReusableVideoStartOperation,
  parseLandingUrl,
  previousStatePayload,
  sanitizeGraphValue,
  stageBatch,
  stableStringify,
  validateAdPayload,
  validateBatchJobs,
  validateCreativePayload,
  validateLandingPagesOnline,
  validatePagingUrl,
  graphVideoUrl,
  updateAdWithReconciliation
});

// src/social-publish.js
var __name3 = /* @__PURE__ */ __name((target, value) => {
  try {
    Object.defineProperty(target, "name", { value, configurable: true });
  } catch {
  }
  return target;
}, "__name");
var PLATFORM_HOSTS = {
  facebook: /* @__PURE__ */ new Set(["graph.facebook.com", "rupload.facebook.com"]),
  instagram: /* @__PURE__ */ new Set(["graph.instagram.com"]),
  threads: /* @__PURE__ */ new Set(["graph.threads.net"])
};
var ALLOWED_METHODS = /* @__PURE__ */ new Set(["GET", "POST", "HEAD"]);
var FORBIDDEN_KEYS = /^(access_token|token|fbToken|igToken|thToken|authorization|secret)$/i;
async function handleSocialPublishOperation({ request, env, requestId, decryptToken: decryptToken2, writeAudit: writeAudit2 }) {
  const body = await readJson(request);
  const platform = text(body?.platform).toLowerCase();
  const unit = normalizeUnit(body?.unit);
  const operation = text(body?.operation || body?.step || body?.phase).toLowerCase();
  const method = text(body?.method || body?.request?.method || "POST").toUpperCase();
  const target = text(body?.url || body?.request?.url);
  if (!PLATFORM_HOSTS[platform]) return response2({ ok: false, error: "invalid_platform", requestId }, 400);
  if (!unit) return response2({ ok: false, error: "invalid_unit", requestId }, 400);
  if (!operation || !/^[a-z0-9_:-]{1,80}$/.test(operation)) {
    return response2({ ok: false, error: "invalid_operation", requestId }, 400);
  }
  if (!ALLOWED_METHODS.has(method)) return response2({ ok: false, error: "method_not_allowed", requestId }, 405);
  let url;
  try {
    url = new URL(target);
  } catch {
    return response2({ ok: false, error: "invalid_target_url", requestId }, 400);
  }
  if (url.protocol !== "https:" || !PLATFORM_HOSTS[platform].has(url.hostname.toLowerCase()) || !allowedPath(platform, url)) {
    return response2({ ok: false, error: "target_not_allowed", requestId }, 403);
  }
  const credential = await resolveCredential(env, platform, unit);
  if (!credential) return response2({ ok: false, error: "credential_not_found", platform, unit, requestId }, 404);
  const accessToken = await decryptToken2(credential.token_ciphertext, env);
  const query = sanitizeObject(body?.query || body?.params || body?.request?.query);
  for (const [key, value] of Object.entries(query)) {
    if (value !== void 0 && value !== null) url.searchParams.set(key, String(value));
  }
  url.searchParams.delete("access_token");
  const headers = new Headers(sanitizeObject(body?.headers || body?.requestHeaders || body?.request?.headers));
  headers.delete("authorization");
  let payload = sanitizeObject(body?.body || body?.jsonRequest || body?.requestBody || body?.request?.body);
  if (url.hostname.toLowerCase() === "rupload.facebook.com") {
    headers.set("Authorization", `OAuth ${accessToken}`);
  } else if (method === "GET" || method === "HEAD") {
    url.searchParams.set("access_token", accessToken);
  } else {
    payload = { ...payload, access_token: accessToken };
    headers.set("content-type", "application/json");
  }
  const upstream = await fetch(url.toString(), {
    method,
    headers,
    body: ["GET", "HEAD"].includes(method) ? void 0 : JSON.stringify(payload)
  });
  const raw = await upstream.text();
  let upstreamBody;
  try {
    upstreamBody = JSON.parse(raw);
  } catch {
    upstreamBody = raw ? { text: raw.slice(0, 4e3) } : {};
  }
  const cleanBody = sanitizeValue(upstreamBody);
  await writeAudit2(env, {
    tokenId: credential.id,
    event: "social.operation",
    provider: platform,
    unit: credential.unit,
    tokenType: credential.token_type,
    status: upstream.ok ? "ok" : "error",
    requestId,
    metadata: {
      operation,
      method,
      host: url.hostname,
      path: url.pathname,
      upstream_status: upstream.status
    }
  });
  const envelope = isObject(cleanBody) ? cleanBody : { data: cleanBody };
  return response2({
    ...envelope,
    _gateway: {
      ok: upstream.ok,
      operation,
      platform,
      unit,
      upstream_status: upstream.status,
      requestId
    }
  }, upstream.ok ? 200 : upstream.status);
}
__name(handleSocialPublishOperation, "handleSocialPublishOperation");
__name3(handleSocialPublishOperation, "handleSocialPublishOperation");
function allowedPath(platform, url) {
  const path = url.pathname;
  if (url.hostname.toLowerCase() === "rupload.facebook.com") return /^\/video-upload\//.test(path);
  if (platform === "threads") return /^\/v1\.0\/(?:me|\d+)(?:\/(?:threads|threads_publish))?$/.test(path);
  if (platform === "instagram") return /^\/v25\.0\/\d+(?:\/(?:media|media_publish))?$/.test(path);
  return /^\/v25\.0\/\d+(?:\/(?:feed|photos|videos|video_reels))?$/.test(path);
}
__name(allowedPath, "allowedPath");
__name3(allowedPath, "allowedPath");
async function resolveCredential(env, provider, unit) {
  const rows = (await env.TOKEN_VAULT_DB.prepare(
    `SELECT id, provider, unit, external_account_id, token_type, token_ciphertext, metadata_json
       FROM credential_tokens
      WHERE provider = ? AND active = 1
      ORDER BY updated_at DESC`
  ).bind(provider).all()).results || [];
  const matching = rows.filter((row) => normalizeUnit(row.unit || parseMetadata(row.metadata_json)?.legacy_columns?.Unit) === unit);
  if (provider !== "facebook") return matching[0] || null;
  return matching.find((row) => {
    const metadata = parseMetadata(row.metadata_json);
    return metadata.purpose !== "meta_ads_publish" && !metadata.meta_ads_publish;
  }) || matching[0] || null;
}
__name(resolveCredential, "resolveCredential");
__name3(resolveCredential, "resolveCredential");
function sanitizeObject(value) {
  const cleaned = sanitizeValue(value);
  return isObject(cleaned) ? cleaned : {};
}
__name(sanitizeObject, "sanitizeObject");
__name3(sanitizeObject, "sanitizeObject");
function sanitizeValue(value) {
  if (Array.isArray(value)) return value.map(sanitizeValue);
  if (!isObject(value)) return value;
  const out = {};
  for (const [key, entry] of Object.entries(value)) {
    if (FORBIDDEN_KEYS.test(key)) continue;
    out[key] = sanitizeValue(entry);
  }
  return out;
}
__name(sanitizeValue, "sanitizeValue");
__name3(sanitizeValue, "sanitizeValue");
function normalizeUnit(value) {
  const compact = text(value).toLowerCase().replace(/[\s_-]+/g, "");
  if (compact === "bss" || compact === "barrashoppingsul") return "bss";
  if (compact === "nh" || compact === "novohamburgo") return "nh";
  return "";
}
__name(normalizeUnit, "normalizeUnit");
__name3(normalizeUnit, "normalizeUnit");
function parseMetadata(value) {
  try {
    return JSON.parse(value || "{}");
  } catch {
    return {};
  }
}
__name(parseMetadata, "parseMetadata");
__name3(parseMetadata, "parseMetadata");
async function readJson(request) {
  try {
    return await request.json();
  } catch {
    return null;
  }
}
__name(readJson, "readJson");
__name3(readJson, "readJson");
function response2(body, status) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" }
  });
}
__name(response2, "response2");
__name3(response2, "response");
function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
__name(isObject, "isObject");
__name3(isObject, "isObject");
function text(value) {
  return String(value ?? "").trim();
}
__name(text, "text");
__name3(text, "text");

// src/index.js
var __name4 = /* @__PURE__ */ __name((target, value) => {
  try {
    Object.defineProperty(target, "name", { value, configurable: true });
  } catch {
  }
  return target;
}, "__name");
var TOKEN_PREFIX = "/internal/token-vault";
var JSON_HEADERS = {
  "content-type": "application/json; charset=utf-8",
  "cache-control": "no-store"
};
var PROVIDERS = /* @__PURE__ */ new Set(["threads", "instagram", "facebook"]);
var index_default = {
  async fetch(request, env, ctx) {
    return handleRequest(request, env, ctx);
  }
};
async function handleRequest(request, env) {
  const requestId = request.headers.get("cf-ray") || crypto.randomUUID();
  const url = new URL(request.url);
  const pathname = normalizePath(url.pathname);
  try {
    const auth = authorizeRequest(request, env);
    if (!auth.ok) {
      return json({ ok: false, error: auth.reason, requestId }, { status: auth.status });
    }
    if (request.method === "GET" && pathname === "/health") {
      return health(env, requestId);
    }
    if (isMetaAdsPublishPath(pathname)) {
      return await handleMetaAdsPublishRequest({
        request,
        env,
        requestId,
        pathname,
        decryptToken,
        writeAudit
      });
    }
    if (request.method === "GET" && pathname === "/v1/token-metadata") {
      return listTokenMetadata(url, env, requestId);
    }
    if (request.method === "POST" && pathname === "/v1/token-maintenance/refresh") {
      return refreshToken(request, env, requestId);
    }
    if (request.method === "POST" && pathname === "/v1/social-publish/operations") {
      return handleSocialPublishOperation({ request, env, requestId, decryptToken, writeAudit });
    }
    if (request.method === "GET" && pathname === "/v1/tokens") {
      if (auth.role !== "admin") return adminOnly(requestId);
      return listTokens(url, env, requestId);
    }
    if (request.method === "POST" && pathname === "/v1/tokens") {
      if (auth.role !== "admin") return adminOnly(requestId);
      return createToken(request, env, requestId);
    }
    const patchMatch = pathname.match(/^\/v1\/tokens\/([^/]+)$/);
    if (request.method === "PATCH" && patchMatch) {
      if (auth.role !== "admin") return adminOnly(requestId);
      return patchToken(decodeURIComponent(patchMatch[1]), request, env, requestId);
    }
    if (request.method === "GET" && pathname === "/contract") {
      return contract(requestId);
    }
    return json({ ok: false, error: "not_found", requestId }, { status: 404 });
  } catch (error) {
    return json(
      { ok: false, error: "internal_error", message: safeErrorMessage(error), requestId },
      { status: 500 }
    );
  }
}
__name(handleRequest, "handleRequest");
__name4(handleRequest, "handleRequest");
function adminOnly(requestId) {
  return json({ ok: false, error: "admin_credential_required", requestId }, { status: 403 });
}
__name(adminOnly, "adminOnly");
__name4(adminOnly, "adminOnly");
function normalizePath(pathname) {
  if (pathname === TOKEN_PREFIX) return "/";
  if (pathname.startsWith(`${TOKEN_PREFIX}/`)) return pathname.slice(TOKEN_PREFIX.length);
  return pathname;
}
__name(normalizePath, "normalizePath");
__name4(normalizePath, "normalizePath");
async function health(env, requestId) {
  const checks = {
    d1: Boolean(env.TOKEN_VAULT_DB),
    apiToken: Boolean(safeString(env.TOKEN_VAULT_API_TOKEN)),
    encryptionKey: Boolean(safeString(env.TOKEN_VAULT_ENCRYPTION_KEY))
  };
  if (checks.d1) {
    await env.TOKEN_VAULT_DB.prepare("SELECT 1 AS ok").first();
  }
  const ok = Object.values(checks).every(Boolean);
  return json({
    ok,
    service: "skincos-token-vault",
    environment: safeString(env.ENVIRONMENT) || "unknown",
    checks,
    requestId
  }, { status: ok ? 200 : 500 });
}
__name(health, "health");
__name4(health, "health");
async function listTokens(url, env, requestId) {
  const provider = safeString(url.searchParams.get("provider")).toLowerCase();
  if (provider && !PROVIDERS.has(provider)) {
    return json({ ok: false, error: "invalid_provider", requestId }, { status: 400 });
  }
  const activeParam = safeString(url.searchParams.get("active")).toLowerCase();
  const activeOnly = activeParam === "" ? true : !["false", "0", "no"].includes(activeParam);
  const limit = clampInteger2(url.searchParams.get("limit"), 200, 1, 1e3);
  const clauses = [];
  const binds = [];
  if (provider) {
    clauses.push("provider = ?");
    binds.push(provider);
  }
  if (activeOnly) {
    clauses.push("active = 1");
  }
  const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
  const rows = (await env.TOKEN_VAULT_DB.prepare(
    `SELECT id, provider, unit, external_account_id, token_type, token_ciphertext,
            expires_at, last_refreshed_at, active, metadata_json, created_at, updated_at
       FROM credential_tokens
       ${where}
       ORDER BY provider, unit, external_account_id
       LIMIT ?`
  ).bind(...binds, limit).all()).results || [];
  const items = [];
  for (const row of rows) {
    items.push(await serializeToken(row, env));
  }
  await writeAudit(env, {
    event: "tokens.list",
    status: "ok",
    requestId,
    metadata: { provider: provider || null, activeOnly, count: items.length }
  });
  return json({ ok: true, count: items.length, items, requestId });
}
__name(listTokens, "listTokens");
__name4(listTokens, "listTokens");
async function listTokenMetadata(url, env, requestId) {
  const provider = safeString(url.searchParams.get("provider")).toLowerCase();
  if (provider && !PROVIDERS.has(provider)) {
    return json({ ok: false, error: "invalid_provider", requestId }, { status: 400 });
  }
  const activeParam = safeString(url.searchParams.get("active")).toLowerCase();
  const activeOnly = activeParam === "" ? true : !["false", "0", "no"].includes(activeParam);
  const limit = clampInteger2(url.searchParams.get("limit"), 200, 1, 1e3);
  const clauses = [];
  const binds = [];
  if (provider) {
    clauses.push("provider = ?");
    binds.push(provider);
  }
  if (activeOnly) clauses.push("active = 1");
  const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
  const rows = (await env.TOKEN_VAULT_DB.prepare(
    `SELECT id, provider, unit, external_account_id, token_type,
            expires_at, last_refreshed_at, active, metadata_json, created_at, updated_at
       FROM credential_tokens
       ${where}
       ORDER BY provider, unit, external_account_id
       LIMIT ?`
  ).bind(...binds, limit).all()).results || [];
  const items = rows.map((row) => ({
    id: row.id,
    token_id: row.id,
    provider: row.provider,
    unit: row.unit,
    external_account_id: row.external_account_id,
    token_type: row.token_type,
    expires_at: row.expires_at,
    last_refreshed_at: row.last_refreshed_at,
    active: Boolean(row.active),
    metadata: parseJsonObject(row.metadata_json),
    created_at: row.created_at,
    updated_at: row.updated_at
  }));
  await writeAudit(env, {
    event: "tokens.metadata.list",
    status: "ok",
    requestId,
    metadata: { provider: provider || null, activeOnly, count: items.length }
  });
  return json({ ok: true, count: items.length, items, requestId });
}
__name(listTokenMetadata, "listTokenMetadata");
__name4(listTokenMetadata, "listTokenMetadata");
async function refreshToken(request, env, requestId) {
  const body = await readJson2(request);
  const tokenId = safeString(body?.token_id || body?.id);
  if (!tokenId) return json({ ok: false, error: "token_id_required", requestId }, { status: 400 });
  const existing = await env.TOKEN_VAULT_DB.prepare(
    `SELECT id, provider, unit, external_account_id, token_type, token_ciphertext,
            expires_at, metadata_json
       FROM credential_tokens
      WHERE id = ? AND active = 1`
  ).bind(tokenId).first();
  if (!existing) return json({ ok: false, error: "token_not_found", requestId }, { status: 404 });
  if (!["threads", "instagram"].includes(existing.provider)) {
    return json({ ok: false, error: "provider_refresh_not_supported", provider: existing.provider, requestId }, { status: 409 });
  }
  const currentToken = await decryptToken(existing.token_ciphertext, env);
  const refreshUrl = new URL(existing.provider === "threads" ? "https://graph.threads.net/refresh_access_token" : "https://graph.instagram.com/refresh_access_token");
  refreshUrl.searchParams.set("grant_type", existing.provider === "threads" ? "th_refresh_token" : "ig_refresh_token");
  refreshUrl.searchParams.set("access_token", currentToken);
  const upstream = await fetch(refreshUrl.toString(), { method: "GET" });
  const upstreamBody = await upstream.json().catch(() => ({}));
  const nextToken = safeString(upstreamBody.access_token);
  if (!upstream.ok || !nextToken) {
    await writeAudit(env, {
      tokenId,
      event: "tokens.refresh",
      provider: existing.provider,
      unit: existing.unit,
      tokenType: existing.token_type,
      status: "error",
      requestId,
      metadata: { upstream_status: upstream.status }
    });
    return json({ ok: false, error: "provider_refresh_failed", provider: existing.provider, upstream_status: upstream.status, requestId }, { status: 502 });
  }
  const now = (/* @__PURE__ */ new Date()).toISOString();
  const expiresIn = Number(upstreamBody.expires_in);
  const expiresAt = Number.isFinite(expiresIn) ? new Date(Date.now() + expiresIn * 1e3).toISOString() : existing.expires_at;
  const metadata = { ...parseJsonObject(existing.metadata_json), last_refresh_source: "token-vault-worker" };
  await env.TOKEN_VAULT_DB.prepare(
    `UPDATE credential_tokens
        SET token_ciphertext = ?, expires_at = ?, last_refreshed_at = ?,
            metadata_json = ?, updated_at = ?
      WHERE id = ?`
  ).bind(await encryptToken(nextToken, env), expiresAt, now, JSON.stringify(metadata), now, tokenId).run();
  await writeAudit(env, {
    tokenId,
    event: "tokens.refresh",
    provider: existing.provider,
    unit: existing.unit,
    tokenType: existing.token_type,
    status: "ok",
    requestId,
    metadata: { expires_at: expiresAt }
  });
  return json({
    ok: true,
    item: {
      token_id: tokenId,
      provider: existing.provider,
      unit: existing.unit,
      external_account_id: existing.external_account_id,
      expires_at: expiresAt,
      last_refreshed_at: now
    },
    requestId
  });
}
__name(refreshToken, "refreshToken");
__name4(refreshToken, "refreshToken");
async function patchToken(id, request, env, requestId) {
  const body = await readJson2(request);
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return json({ ok: false, error: "invalid_payload", requestId }, { status: 400 });
  }
  const token = safeString(body.token || body.access_token);
  if (!token) {
    return json({ ok: false, error: "token_required", requestId }, { status: 400 });
  }
  const existing = await env.TOKEN_VAULT_DB.prepare(
    `SELECT id, provider, unit, external_account_id, token_type, metadata_json
       FROM credential_tokens
      WHERE id = ?`
  ).bind(id).first();
  if (!existing) {
    await writeAudit(env, {
      tokenId: id,
      event: "tokens.patch",
      status: "not_found",
      requestId
    });
    return json({ ok: false, error: "token_not_found", requestId }, { status: 404 });
  }
  const encrypted = await encryptToken(token, env);
  const now = (/* @__PURE__ */ new Date()).toISOString();
  const expiresAt = normalizeNullableString(body.expires_at || body.expiresAt);
  const incomingMetadata = isObject2(body.metadata) ? body.metadata : {};
  const previousMetadata = parseJsonObject(existing.metadata_json);
  const metadata = {
    ...previousMetadata,
    ...incomingMetadata,
    last_refresh_source: safeString(body.source) || "n8n-token-manager"
  };
  await env.TOKEN_VAULT_DB.prepare(
    `UPDATE credential_tokens
        SET token_ciphertext = ?,
            expires_at = COALESCE(?, expires_at),
            last_refreshed_at = ?,
            metadata_json = ?,
            updated_at = ?
      WHERE id = ?`
  ).bind(encrypted, expiresAt, now, JSON.stringify(metadata), now, id).run();
  await writeAudit(env, {
    tokenId: id,
    event: "tokens.patch",
    provider: existing.provider,
    unit: existing.unit,
    tokenType: existing.token_type,
    status: "ok",
    requestId,
    metadata: {
      external_account_id: existing.external_account_id,
      expires_at: expiresAt,
      token_length: token.length
    }
  });
  return json({
    ok: true,
    item: {
      id,
      provider: existing.provider,
      unit: existing.unit,
      external_account_id: existing.external_account_id,
      token_type: existing.token_type,
      last_refreshed_at: now
    },
    requestId
  });
}
__name(patchToken, "patchToken");
__name4(patchToken, "patchToken");
async function createToken(request, env, requestId) {
  const body = await readJson2(request);
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return json({ ok: false, error: "invalid_payload", requestId }, { status: 400 });
  }
  const provider = safeString(body.provider).toLowerCase();
  if (!PROVIDERS.has(provider)) {
    return json({ ok: false, error: "invalid_provider", requestId }, { status: 400 });
  }
  const externalAccountId = safeString(body.external_account_id || body.externalAccountId);
  const token = safeString(body.token || body.access_token);
  if (!externalAccountId) {
    return json({ ok: false, error: "external_account_id_required", requestId }, { status: 400 });
  }
  if (!token) {
    return json({ ok: false, error: "token_required", requestId }, { status: 400 });
  }
  const id = safeString(body.id) || `${provider}_${externalAccountId}`;
  const tokenType = safeString(body.token_type || body.tokenType) || "long_lived_access_token";
  const unit = normalizeNullableString(body.unit);
  const metadata = isObject2(body.metadata) ? body.metadata : {};
  const now = (/* @__PURE__ */ new Date()).toISOString();
  const encrypted = await encryptToken(token, env);
  await env.TOKEN_VAULT_DB.prepare(
    `INSERT INTO credential_tokens (
      id, provider, unit, external_account_id, token_type, token_ciphertext,
      expires_at, last_refreshed_at, active, metadata_json, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(provider, external_account_id, token_type) DO UPDATE SET
      unit = excluded.unit,
      token_ciphertext = excluded.token_ciphertext,
      expires_at = excluded.expires_at,
      active = excluded.active,
      metadata_json = excluded.metadata_json,
      updated_at = excluded.updated_at`
  ).bind(
    id,
    provider,
    unit,
    externalAccountId,
    tokenType,
    encrypted,
    normalizeNullableString(body.expires_at || body.expiresAt),
    normalizeNullableString(body.last_refreshed_at || body.lastRefreshedAt),
    body.active === false ? 0 : 1,
    JSON.stringify(metadata),
    now,
    now
  ).run();
  await writeAudit(env, {
    tokenId: id,
    event: "tokens.create",
    provider,
    unit,
    tokenType,
    status: "ok",
    requestId,
    metadata: {
      external_account_id: externalAccountId,
      token_length: token.length,
      imported: Boolean(body.imported)
    }
  });
  return json({
    ok: true,
    item: {
      id,
      provider,
      unit,
      external_account_id: externalAccountId,
      token_type: tokenType
    },
    requestId
  }, { status: 201 });
}
__name(createToken, "createToken");
__name4(createToken, "createToken");
async function serializeToken(row, env) {
  const token = await decryptToken(row.token_ciphertext, env);
  const metadata = parseJsonObject(row.metadata_json);
  const base = {
    id: row.id,
    provider: row.provider,
    unit: row.unit,
    external_account_id: row.external_account_id,
    token_type: row.token_type,
    token,
    expires_at: row.expires_at,
    last_refreshed_at: row.last_refreshed_at,
    active: Boolean(row.active),
    metadata,
    created_at: row.created_at,
    updated_at: row.updated_at
  };
  if (row.provider === "threads") {
    base.thId = row.external_account_id;
    base.thToken = token;
  }
  if (row.provider === "instagram") {
    base.igId = row.external_account_id;
    base.igToken = token;
  }
  if (row.provider === "facebook") {
    base.fbId = row.external_account_id;
    base.fbToken = token;
  }
  return base;
}
__name(serializeToken, "serializeToken");
__name4(serializeToken, "serializeToken");
function authorizeRequest(request, env) {
  if (safeString(env.REQUIRE_AUTH || "true") !== "true") return { ok: true };
  const adminToken = safeString(env.TOKEN_VAULT_API_TOKEN);
  const operationalToken = safeString(env.TOKEN_VAULT_N8N_API_TOKEN);
  if (!adminToken && !operationalToken) return { ok: false, status: 500, reason: "missing_worker_secret" };
  const headerName = safeString(env.WORKER_AUTH_HEADER_NAME || "Authorization") || "Authorization";
  const scheme = safeString(env.WORKER_AUTH_SCHEME || "Bearer") || "Bearer";
  const authHeader = safeString(request.headers.get(headerName));
  if (!authHeader) return { ok: false, status: 401, reason: "missing_auth_header" };
  if (adminToken && constantTimeEqual(authHeader, `${scheme} ${adminToken}`.trim())) {
    return { ok: true, role: "admin" };
  }
  if (operationalToken && constantTimeEqual(authHeader, `${scheme} ${operationalToken}`.trim())) {
    return { ok: true, role: "operational" };
  }
  return { ok: false, status: 401, reason: "invalid_auth_header" };
}
__name(authorizeRequest, "authorizeRequest");
__name4(authorizeRequest, "authorizeRequest");
async function encryptToken(token, env) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encoded = new TextEncoder().encode(token);
  const key = await getEncryptionKey(env);
  const ciphertext = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, encoded);
  return `v1:${base64Encode(iv)}:${base64Encode(new Uint8Array(ciphertext))}`;
}
__name(encryptToken, "encryptToken");
__name4(encryptToken, "encryptToken");
async function decryptToken(value, env) {
  const parts = safeString(value).split(":");
  if (parts.length !== 3 || parts[0] !== "v1") {
    throw new Error("unsupported_ciphertext");
  }
  const iv = base64Decode(parts[1]);
  const ciphertext = base64Decode(parts[2]);
  const key = await getEncryptionKey(env);
  const plaintext = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, ciphertext);
  return new TextDecoder().decode(plaintext);
}
__name(decryptToken, "decryptToken");
__name4(decryptToken, "decryptToken");
async function getEncryptionKey(env) {
  const secret = safeString(env.TOKEN_VAULT_ENCRYPTION_KEY);
  if (secret.length < 32) throw new Error("TOKEN_VAULT_ENCRYPTION_KEY must be configured");
  const raw = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(secret));
  return crypto.subtle.importKey("raw", raw, "AES-GCM", false, ["encrypt", "decrypt"]);
}
__name(getEncryptionKey, "getEncryptionKey");
__name4(getEncryptionKey, "getEncryptionKey");
async function writeAudit(env, input) {
  if (!env.TOKEN_VAULT_DB) return;
  await env.TOKEN_VAULT_DB.prepare(
    `INSERT INTO credential_token_audit (
      id, token_id, event, provider, unit, token_type, status, request_id, metadata_json
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(
    crypto.randomUUID(),
    normalizeNullableString(input.tokenId),
    safeString(input.event),
    normalizeNullableString(input.provider),
    normalizeNullableString(input.unit),
    normalizeNullableString(input.tokenType),
    safeString(input.status || "ok"),
    normalizeNullableString(input.requestId),
    JSON.stringify(input.metadata || {})
  ).run();
}
__name(writeAudit, "writeAudit");
__name4(writeAudit, "writeAudit");
function contract(requestId) {
  return json({
    ok: true,
    service: "skincos-token-vault",
    endpoints: {
      health: "GET /internal/token-vault/health",
      tokenMetadata: "GET /internal/token-vault/v1/token-metadata?provider=threads|instagram|facebook&active=true",
      tokenRefresh: "POST /internal/token-vault/v1/token-maintenance/refresh",
      socialPublish: "POST /internal/token-vault/v1/social-publish/operations",
      listTokens: "GET /internal/token-vault/v1/tokens?provider=threads|instagram|facebook&active=true",
      createToken: "POST /internal/token-vault/v1/tokens",
      updateToken: "PATCH /internal/token-vault/v1/tokens/:id",
      metaAdsPublishConfig: "GET /internal/token-vault/v1/meta-ads-publish/config",
      metaAdsPublishInventory: "POST /internal/token-vault/v1/meta-ads-publish/inventory",
      metaAdsPublishRuns: "POST /internal/token-vault/v1/meta-ads-publish/runs",
      metaAdsPublishRun: "GET|PATCH /internal/token-vault/v1/meta-ads-publish/runs/:id",
      metaAdsPublishHeartbeat: "POST /internal/token-vault/v1/meta-ads-publish/runs/:id/heartbeat",
      metaAdsPublishOperations: "POST /internal/token-vault/v1/meta-ads-publish/runs/:id/operations",
      metaAdsPublishEvents: "POST /internal/token-vault/v1/meta-ads-publish/runs/:id/events"
    },
    auth: {
      header: "Authorization",
      scheme: "Bearer",
      admin_secret: "TOKEN_VAULT_API_TOKEN",
      operational_secret: "TOKEN_VAULT_N8N_API_TOKEN"
    },
    storage: {
      d1_binding: "TOKEN_VAULT_DB",
      encryption_secret: "TOKEN_VAULT_ENCRYPTION_KEY"
    },
    requestId
  });
}
__name(contract, "contract");
__name4(contract, "contract");
async function readJson2(request) {
  try {
    return await request.json();
  } catch {
    return null;
  }
}
__name(readJson2, "readJson2");
__name4(readJson2, "readJson");
function json(data, init = {}) {
  return new Response(JSON.stringify(data), {
    ...init,
    headers: { ...JSON_HEADERS, ...init.headers || {} }
  });
}
__name(json, "json");
__name4(json, "json");
function safeString(value) {
  return String(value ?? "").trim();
}
__name(safeString, "safeString");
__name4(safeString, "safeString");
function normalizeNullableString(value) {
  const normalized = safeString(value);
  return normalized || null;
}
__name(normalizeNullableString, "normalizeNullableString");
__name4(normalizeNullableString, "normalizeNullableString");
function isObject2(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
__name(isObject2, "isObject2");
__name4(isObject2, "isObject");
function parseJsonObject(value) {
  try {
    const parsed = JSON.parse(value || "{}");
    return isObject2(parsed) ? parsed : {};
  } catch {
    return {};
  }
}
__name(parseJsonObject, "parseJsonObject");
__name4(parseJsonObject, "parseJsonObject");
function clampInteger2(value, fallback, min, max) {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, parsed));
}
__name(clampInteger2, "clampInteger2");
__name4(clampInteger2, "clampInteger");
function constantTimeEqual(a, b) {
  const left = safeString(a);
  const right = safeString(b);
  if (left.length !== right.length) return false;
  let diff = 0;
  for (let index = 0; index < left.length; index += 1) {
    diff |= left.charCodeAt(index) ^ right.charCodeAt(index);
  }
  return diff === 0;
}
__name(constantTimeEqual, "constantTimeEqual");
__name4(constantTimeEqual, "constantTimeEqual");
function base64Encode(bytes) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}
__name(base64Encode, "base64Encode");
__name4(base64Encode, "base64Encode");
function base64Decode(value) {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}
__name(base64Decode, "base64Decode");
__name4(base64Decode, "base64Decode");
function safeErrorMessage(error) {
  const message = error instanceof Error ? error.message : String(error);
  if (/token|secret|cipher|auth/i.test(message)) return "secure_operation_failed";
  return message;
}
__name(safeErrorMessage, "safeErrorMessage");
__name4(safeErrorMessage, "safeErrorMessage");
export {
  index_default as default,
  handleRequest,
  __test
};
//# sourceMappingURL=index.js.map
