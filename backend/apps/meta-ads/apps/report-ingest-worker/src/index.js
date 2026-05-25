export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (request.method === 'GET' && url.pathname === '/health') {
      return jsonResponse(200, {
        ok: true,
        environment: String(env.ENVIRONMENT || 'unknown'),
        worker: 'meta-ads-performance-report',
      });
    }

    if (request.method === 'GET' && url.pathname === '/contract/meta-ads-performance-report') {
      return jsonResponse(200, buildContractResponse(env));
    }

    if (request.method === 'GET' && url.pathname === '/inventory/meta-ads-performance-report') {
      return handleInventoryRequest(request, env, url);
    }

    if (request.method === 'GET' && url.pathname === '/report/meta-ads-performance-report') {
      return handleReportRequest(request, env, url);
    }

    if (request.method === 'POST' && url.pathname === '/ingest/meta-ads-performance-report') {
      return handleIngestion(request, env);
    }

    return jsonResponse(404, {
      ok: false,
      error: 'not_found',
      message: 'Endpoint not found.',
    });
  },
};

async function handleInventoryRequest(request, env, url) {
  const requestId = crypto.randomUUID();
  const authResult = await authorizeRequest(request, env);

  if (!authResult.ok) {
    log(env, 'warn', 'inventory_auth_failed', {
      requestId,
      reason: authResult.reason,
    });

    return jsonResponse(authResult.status, {
      ok: false,
      error: 'unauthorized',
      message: authResult.message,
      requestId,
    });
  }

  if (!env.META_ADS_DB) {
    return jsonResponse(500, {
      ok: false,
      error: 'missing_binding',
      message: 'META_ADS_DB binding missing.',
      requestId,
    });
  }

  const accountId = safeString(url.searchParams.get('account_id'));
  const freshnessHours = positiveInteger(url.searchParams.get('freshness_hours'), 168);
  const limit = positiveInteger(url.searchParams.get('limit'), 500);

  if (!accountId) {
    return jsonResponse(400, {
      ok: false,
      error: 'invalid_query',
      message: 'account_id query parameter is required.',
      requestId,
    });
  }

  const freshnessCutoffIso = new Date(Date.now() - freshnessHours * 60 * 60 * 1000).toISOString();

  const rows = await env.META_ADS_DB.prepare(`
    SELECT
      entity_id,
      entity_name,
      account_id,
      campaign_id,
      campaign_name,
      adset_id,
      adset_name,
      ad_id,
      ad_name,
      creative_id,
      creative_name,
      status,
      effective_status,
      configured_status,
      source_json,
      last_seen_at
    FROM entities
    WHERE entity_kind = 'ad'
      AND account_id = ?
      AND last_seen_at >= ?
    ORDER BY last_seen_at DESC
    LIMIT ?
  `).bind(accountId, freshnessCutoffIso, limit).all();

  const items = asArray(rows?.results)
    .map((row) => buildInventoryItem(row))
    .filter(Boolean);

  log(env, 'info', 'inventory_lookup_completed', {
    requestId,
    accountId,
    freshnessHours,
    freshnessCutoffIso,
    count: items.length,
  });

  return jsonResponse(200, {
    ok: true,
    requestId,
    count: items.length,
    inventory: {
      source: 'd1',
      entity_kind: 'ad',
      account_id: accountId,
      freshness_hours: freshnessHours,
      freshness_cutoff_iso: freshnessCutoffIso,
      limit,
    },
    items,
  });
}

async function handleIngestion(request, env) {
  const requestId = crypto.randomUUID();
  const startedAt = new Date().toISOString();
  const authResult = await authorizeRequest(request, env);

  if (!authResult.ok) {
    log(env, 'warn', 'auth_failed', {
      requestId,
      reason: authResult.reason,
    });

    return jsonResponse(authResult.status, {
      ok: false,
      error: 'unauthorized',
      message: authResult.message,
      requestId,
    });
  }

  let body;

  try {
    body = await request.json();
  } catch (error) {
    log(env, 'warn', 'invalid_json', {
      requestId,
      error: String(error?.message || error),
    });

    return jsonResponse(400, {
      ok: false,
      error: 'invalid_json',
      message: 'Request body must be valid JSON.',
      requestId,
    });
  }

  const validation = validateBody(body);
  if (!validation.ok) {
    log(env, 'warn', 'body_validation_failed', {
      requestId,
      issues: validation.issues,
    });

    return jsonResponse(400, {
      ok: false,
      error: 'invalid_body',
      message: 'Invalid ingestion payload.',
      issues: validation.issues,
      requestId,
    });
  }

  if (!env.META_ADS_DB) {
    return jsonResponse(500, {
      ok: false,
      error: 'missing_binding',
      message: 'META_ADS_DB binding missing.',
      requestId,
    });
  }

  const run = body.run || {};
  const entities = asArray(body.entities);
  const metricSnapshots = asArray(body.metric_snapshots);
  const ingestionAudit = asArray(body.ingestion_audit);
  const rawPayloads = asArray(body.raw_payloads);
  const duplicationReport = asArray(body.duplication_report);
  const compatibilityExports = isObject(body.compatibility_exports) ? body.compatibility_exports : {};
  const idempotencyKey = safeString(
    request.headers.get('Idempotency-Key') ||
    `${safeString(run.run_id)}:${safeString(run.metrics_group_key)}`
  );
  const requestHeadersJson = JSON.stringify(redactHeaders(request.headers, env));

  const existingRun = await env.META_ADS_DB.prepare(`
    SELECT
      summary_json,
      status,
      phase,
      last_successful_phase,
      attempt_count,
      created_at,
      updated_at,
      last_request_id
    FROM ingestion_runs
    WHERE idempotency_key = ?
    LIMIT 1
  `).bind(idempotencyKey).first();

  if (existingRun?.status === 'completed' && existingRun.summary_json) {
    const previousSummary = safeJsonParse(existingRun.summary_json, {});

    log(env, 'info', 'idempotent_replay', {
      requestId,
      idempotencyKey,
      runId: safeString(run.run_id),
      metricsGroupKey: safeString(run.metrics_group_key),
    });

    return jsonResponse(200, {
      ok: true,
      idempotentReplay: true,
      requestId,
      results: previousSummary,
    });
  }

  if (
    existingRun?.status === 'in_progress' &&
    !isStaleRun(existingRun.updated_at)
  ) {
    const inProgressSummary = safeJsonParse(existingRun.summary_json, {});

    log(env, 'info', 'idempotent_in_progress', {
      requestId,
      idempotencyKey,
      runId: safeString(run.run_id),
      metricsGroupKey: safeString(run.metrics_group_key),
      phase: safeString(existingRun.phase),
      previousRequestId: safeString(existingRun.last_request_id),
    });

    return jsonResponse(202, {
      ok: true,
      inProgress: true,
      requestId,
      idempotencyKey,
      phase: safeString(existingRun.phase),
      lastSuccessfulPhase: safeString(existingRun.last_successful_phase),
      previousRequestId: safeString(existingRun.last_request_id),
      results: inProgressSummary,
    });
  }

  const requestMeta = {
    requestId,
    runId: safeString(run.run_id),
    reportDate: safeString(run.report_date),
    metricsGroupKey: safeString(run.metrics_group_key),
    idempotencyKey,
    entities: entities.length,
    metricSnapshots: metricSnapshots.length,
    ingestionAudit: ingestionAudit.length,
    rawPayloads: rawPayloads.length,
    duplicationCount: duplicationReport.length,
    compatibilitySummaryRows: asArray(compatibilityExports.summary_rows).length,
    compatibilityBreakdownRows: asArray(compatibilityExports.breakdown_rows).length,
  };
  const createdAt = safeString(existingRun?.created_at || startedAt);
  const attemptCount = Math.max(1, safeInteger(existingRun?.attempt_count) + 1);
  const runRowBase = {
    run_id: safeString(run.run_id || idempotencyKey),
    workflow_name: safeString(run.workflow_name || 'Meta Ads - Performance Report'),
    report_mode: safeString(run.report_mode),
    report_date: safeString(run.report_date),
    requested_at: safeString(run.requested_at || startedAt),
    account_id: safeString(run.account_id),
    metrics_group_key: safeString(run.metrics_group_key),
    idempotency_key: idempotencyKey,
    request_headers_json: requestHeadersJson,
    created_at: createdAt,
  };
  const progress = {
    status: 'in_progress',
    phase: 'accepted',
    last_successful_phase: safeString(existingRun?.last_successful_phase),
    attempt_count: attemptCount,
    last_request_id: requestId,
    entities_upserted: 0,
    metric_snapshots_inserted: 0,
    audit_rows_inserted: 0,
    raw_payloads_written: 0,
    raw_payload_rows_upserted: 0,
    duplication_rows_upserted: 0,
    warnings_count: 0,
    duplication_count: duplicationReport.length,
    last_error: '',
    r2_status: 'not_started',
    d1_status: 'not_started',
    processing_warnings_json: '[]',
    summary_json: JSON.stringify({
      status: 'in_progress',
      phase: 'accepted',
      attempt_count: attemptCount,
    }),
    updated_at: startedAt,
  };

  async function syncRunProgress(overrides = {}) {
    Object.assign(progress, overrides);
    await upsertIngestionRun(env, {
      ...runRowBase,
      ...progress,
    });
  }

  log(env, 'info', 'ingestion_started', requestMeta);

  try {
    await syncRunProgress();

    const entityStatements = entities.map((entity) => buildEntityStatement(env, entity));
    const metricStatements = metricSnapshots.map((snapshot) => buildMetricSnapshotStatement(env, snapshot));
    const auditStatements = ingestionAudit.map((audit) => buildIngestionAuditStatement(env, audit));
    const rawPayloadStatements = rawPayloads.map((payload) => buildRawPayloadStatement(env, payload));
    const duplicationStatements = duplicationReport.map((entry) => buildDuplicationStatement(env, entry, run));

    await syncRunProgress({
      phase: 'raw_payload_sync_started',
      updated_at: new Date().toISOString(),
      summary_json: JSON.stringify({
        status: progress.status,
        phase: 'raw_payload_sync_started',
        attempt_count: progress.attempt_count,
      }),
      r2_status: 'in_progress',
    });

    const rawPayloadWrite = await persistRawPayloads(env, rawPayloads, requestMeta);
    const warningsCount = countWarnings(metricSnapshots, ingestionAudit) + rawPayloadWrite.warnings.length;

    await syncRunProgress({
      phase: rawPayloadWrite.status === 'completed' ? 'raw_payload_sync_completed' : 'raw_payload_sync_partial',
      last_successful_phase: 'raw_payload_sync',
      raw_payloads_written: rawPayloadWrite.written,
      warnings_count: warningsCount,
      r2_status: rawPayloadWrite.status,
      processing_warnings_json: JSON.stringify(rawPayloadWrite.warnings),
      updated_at: new Date().toISOString(),
      summary_json: JSON.stringify({
        status: progress.status,
        phase: rawPayloadWrite.status === 'completed' ? 'raw_payload_sync_completed' : 'raw_payload_sync_partial',
        last_successful_phase: 'raw_payload_sync',
        warnings_count: warningsCount,
        processing_warnings: rawPayloadWrite.warnings,
        attempt_count: progress.attempt_count,
      }),
    });

    await syncRunProgress({
      phase: 'd1_entities_started',
      d1_status: 'in_progress',
      updated_at: new Date().toISOString(),
      summary_json: JSON.stringify({
        status: progress.status,
        phase: 'd1_entities_started',
        last_successful_phase: progress.last_successful_phase,
        warnings_count: progress.warnings_count,
        attempt_count: progress.attempt_count,
      }),
    });
    await runStatementsInChunks(env.META_ADS_DB, entityStatements);
    await syncRunProgress({
      phase: 'd1_entities_completed',
      last_successful_phase: 'd1_entities',
      entities_upserted: entities.length,
      updated_at: new Date().toISOString(),
    });

    await syncRunProgress({
      phase: 'd1_metric_snapshots_started',
      updated_at: new Date().toISOString(),
    });
    await runStatementsInChunks(env.META_ADS_DB, metricStatements);
    await syncRunProgress({
      phase: 'd1_metric_snapshots_completed',
      last_successful_phase: 'd1_metric_snapshots',
      metric_snapshots_inserted: metricSnapshots.length,
      updated_at: new Date().toISOString(),
    });

    await syncRunProgress({
      phase: 'd1_ingestion_audit_started',
      updated_at: new Date().toISOString(),
    });
    await runStatementsInChunks(env.META_ADS_DB, auditStatements);
    await syncRunProgress({
      phase: 'd1_ingestion_audit_completed',
      last_successful_phase: 'd1_ingestion_audit',
      audit_rows_inserted: ingestionAudit.length,
      updated_at: new Date().toISOString(),
    });

    await syncRunProgress({
      phase: 'd1_duplication_audit_started',
      updated_at: new Date().toISOString(),
    });
    await runStatementsInChunks(env.META_ADS_DB, duplicationStatements);
    await syncRunProgress({
      phase: 'd1_duplication_audit_completed',
      last_successful_phase: 'd1_duplication_audit',
      duplication_rows_upserted: duplicationReport.length,
      updated_at: new Date().toISOString(),
    });

    await syncRunProgress({
      phase: 'd1_raw_payload_index_started',
      updated_at: new Date().toISOString(),
    });
    await runStatementsInChunks(env.META_ADS_DB, rawPayloadStatements);
    await syncRunProgress({
      phase: 'd1_raw_payload_index_completed',
      last_successful_phase: 'd1_raw_payload_index',
      raw_payload_rows_upserted: rawPayloads.length,
      d1_status: 'committed',
      updated_at: new Date().toISOString(),
    });

    const summary = {
      entities_upserted: entities.length,
      metric_snapshots_inserted: metricSnapshots.length,
      audit_rows_inserted: ingestionAudit.length,
      raw_payloads_written: rawPayloadWrite.written,
      raw_payload_rows_upserted: rawPayloads.length,
      duplication_rows_upserted: duplicationReport.length,
      warnings_count: warningsCount,
      duplication_count: duplicationReport.length,
      idempotency_key: idempotencyKey,
      request_id: requestId,
      processing_warnings: rawPayloadWrite.warnings,
    };

    await syncRunProgress({
      status: 'completed',
      phase: 'completed',
      last_successful_phase: 'completed',
      entities_upserted: summary.entities_upserted,
      metric_snapshots_inserted: summary.metric_snapshots_inserted,
      audit_rows_inserted: summary.audit_rows_inserted,
      raw_payloads_written: summary.raw_payloads_written,
      raw_payload_rows_upserted: summary.raw_payload_rows_upserted,
      duplication_rows_upserted: summary.duplication_rows_upserted,
      warnings_count: summary.warnings_count,
      duplication_count: summary.duplication_count,
      last_error: '',
      r2_status: rawPayloadWrite.status,
      d1_status: 'completed',
      processing_warnings_json: JSON.stringify(rawPayloadWrite.warnings),
      summary_json: JSON.stringify(summary),
      updated_at: new Date().toISOString(),
    });

    log(env, 'info', 'ingestion_completed', {
      ...requestMeta,
      ...summary,
    });

    return jsonResponse(200, {
      ok: true,
      requestId,
      results: summary,
    });
  } catch (error) {
    const message = String(error?.message || error);

    try {
      await syncRunProgress({
        status: 'failed',
        phase: `${safeString(progress.phase || 'unknown')}_failed`,
        last_error: message,
        summary_json: JSON.stringify({
          status: 'failed',
          error: message,
          phase: progress.phase,
          last_successful_phase: progress.last_successful_phase,
          entities_upserted: progress.entities_upserted,
          metric_snapshots_inserted: progress.metric_snapshots_inserted,
          audit_rows_inserted: progress.audit_rows_inserted,
          raw_payloads_written: progress.raw_payloads_written,
          raw_payload_rows_upserted: progress.raw_payload_rows_upserted,
          duplication_rows_upserted: progress.duplication_rows_upserted,
          warnings_count: progress.warnings_count,
          duplication_count: progress.duplication_count,
          processing_warnings: safeJsonParse(progress.processing_warnings_json, []),
          attempt_count: progress.attempt_count,
        }),
        updated_at: new Date().toISOString(),
      });
    } catch (secondaryError) {
      log(env, 'error', 'ingestion_run_update_failed', {
        requestId,
        error: String(secondaryError?.message || secondaryError),
      });
    }

    log(env, 'error', 'ingestion_failed', {
      ...requestMeta,
      error: message,
    });

    return jsonResponse(500, {
      ok: false,
      error: 'ingestion_failed',
      message,
      requestId,
      phase: safeString(progress.phase),
      lastSuccessfulPhase: safeString(progress.last_successful_phase),
    });
  }
}

const REPORT_WINDOWS = ['last_24h', 'last_7d', 'last_30d'];

const SUMMARY_SCALAR_ALIAS = {
  spend: 'scalar_spend',
  clicks: 'scalar_clicks',
  reach: 'scalar_reach',
  impressions: 'scalar_impressions',
  ctr: 'scalar_ctr',
  cpc: 'scalar_cpc',
  cpm: 'scalar_cpm',
  cpp: 'scalar_cpp',
  frequency: 'scalar_frequency',
  inline_link_clicks: 'scalar_inline_link_clicks',
  inline_link_click_ctr: 'scalar_inline_link_click_ctr',
  cost_per_inline_link_click: 'scalar_cost_per_inline_link_click',
  unique_clicks: 'scalar_unique_clicks',
  unique_inline_link_clicks: 'scalar_unique_inline_link_clicks',
  outbound_clicks: 'scalar_outbound_clicks',
  outbound_clicks_ctr: 'scalar_outbound_clicks_ctr',
  cost_per_outbound_click: 'scalar_cost_per_outbound_click',
  website_ctr: 'scalar_website_ctr',
  social_spend: 'scalar_social_spend',
  instagram_profile_visits: 'scalar_instagram_profile_visits',
  inline_post_engagement: 'scalar_inline_post_engagement',
  cost_per_inline_post_engagement: 'scalar_cost_per_inline_post_engagement',
  quality_ranking: 'scalar_quality_ranking',
  engagement_rate_ranking: 'scalar_engagement_rate_ranking',
  conversion_rate_ranking: 'scalar_conversion_rate_ranking',
};

const ACTION_ALIAS = {
  conversation_started: 'onsite_conversion_messaging_conversation_started_7d',
  total_messaging_connection: 'onsite_conversion_total_messaging_connection',
  first_reply: 'onsite_conversion_messaging_first_reply',
  conversation_replied: 'onsite_conversion_messaging_conversation_replied_7d',
  messaging_depth_2: 'onsite_conversion_messaging_user_depth_2_message_send',
  messaging_depth_3: 'onsite_conversion_messaging_user_depth_3_message_send',
  messaging_depth_5: 'onsite_conversion_messaging_user_depth_5_message_send',
  outbound_clicks: 'outbound_clicks',
  inline_link_clicks: 'link_click',
  post_reaction: 'post_reaction',
  comments: 'comment',
  posts: 'post',
};

const DIMENSION_FIELDS = new Set([
  'age',
  'gender',
  'country',
  'region',
  'dma',
  'impression_device',
  'device_platform',
  'publisher_platform',
  'platform_position',
]);

async function handleReportRequest(request, env, url) {
  const requestId = crypto.randomUUID();
  const authResult = await authorizeRequest(request, env);

  if (!authResult.ok) {
    log(env, 'warn', 'report_auth_failed', {
      requestId,
      reason: authResult.reason,
    });

    return jsonResponse(authResult.status, {
      ok: false,
      error: 'unauthorized',
      message: authResult.message,
      requestId,
    });
  }

  if (!env.META_ADS_DB) {
    return jsonResponse(500, {
      ok: false,
      error: 'missing_binding',
      message: 'META_ADS_DB binding missing.',
      requestId,
    });
  }

  const accountId = safeString(url.searchParams.get('account_id'));
  const reportDate = normalizeReportDate(url.searchParams.get('report_date'));
  const windows = parseReportWindows(url.searchParams.get('windows'));
  const limit = positiveInteger(url.searchParams.get('limit'), 200);
  const include = normalizeInclude(url.searchParams.get('include'));

  if (!accountId) {
    return jsonResponse(400, {
      ok: false,
      error: 'invalid_query',
      message: 'account_id query parameter is required.',
      requestId,
    });
  }

  const latestRuns = await fetchLatestAdRuns(env.META_ADS_DB, accountId, reportDate, limit);
  const effectiveReportDate = safeString(latestRuns[0]?.report_date) || reportDate;
  if (!latestRuns.length) {
    return jsonResponse(200, {
      ok: true,
      requestId,
      metadata: {
        source: 'd1',
        account_id: accountId,
        report_date: reportDate,
        requested_report_date: reportDate,
        windows,
        include,
        runs_count: 0,
        reason: 'no_data_for_filters',
      },
      summary_rows: [],
      breakdown_rows: [],
    });
  }

  const adIds = dedupeStrings(latestRuns.map((row) => row.ad_id));
  const groupKeys = dedupeStrings(latestRuns.map((row) => row.metrics_group_key));
  const adEntityRows = await fetchAdEntities(env.META_ADS_DB, accountId, adIds);
  const metricRows = await fetchMetricSnapshots(env.META_ADS_DB, effectiveReportDate, groupKeys, windows);
  const auditRows = await fetchIngestionAudit(env.META_ADS_DB, effectiveReportDate, groupKeys, windows);

  const adEntityById = new Map(adEntityRows.map((row) => [safeString(row.entity_id), row]));
  const latestByGroup = new Map(latestRuns.map((row) => [safeString(row.metrics_group_key), row]));
  const auditIndex = buildAuditIndex(auditRows);
  const metricIndex = buildMetricIndexes(metricRows);

  const summaryRows = include === 'breakdown'
    ? []
    : buildReportSummaryRows(latestRuns, adEntityById, metricIndex.summary, auditIndex, windows);
  const breakdownRows = include === 'summary'
    ? []
    : buildReportBreakdownRows(metricIndex.breakdown, latestByGroup, adEntityById, auditIndex);

  log(env, 'info', 'report_lookup_completed', {
    requestId,
    accountId,
    reportDate: effectiveReportDate,
    requestedReportDate: reportDate,
    include,
    windows,
    runsCount: latestRuns.length,
    summaryRows: summaryRows.length,
    breakdownRows: breakdownRows.length,
  });

  return jsonResponse(200, {
    ok: true,
    requestId,
    metadata: {
      source: 'd1',
      account_id: accountId,
      report_date: effectiveReportDate,
      requested_report_date: reportDate,
      windows,
      include,
      runs_count: latestRuns.length,
      ad_entities_count: adEntityRows.length,
    },
    summary_rows: summaryRows,
    breakdown_rows: breakdownRows,
  });
}

async function fetchLatestAdRuns(db, accountId, reportDate, limit) {
  const rows = await db.prepare(`
    WITH effective_report AS (
      SELECT MAX(ia.report_date) AS report_date
      FROM ingestion_audit ia
      JOIN entities e
        ON e.entity_kind = 'ad'
       AND e.entity_id = ia.entity_id
      WHERE ia.report_date <= ?
        AND ia.entity_level = 'ad'
        AND e.account_id = ?
    ),
    ranked AS (
      SELECT
        ia.report_date,
        ia.entity_id AS ad_id,
        ia.metrics_group_key,
        ia.requested_at,
        ia.updated_at,
        ia.api_version,
        ia.schedule_mode,
        ROW_NUMBER() OVER (
          PARTITION BY ia.entity_id
          ORDER BY ia.requested_at DESC, ia.updated_at DESC
        ) AS rn
      FROM ingestion_audit ia
      JOIN entities e
        ON e.entity_kind = 'ad'
       AND e.entity_id = ia.entity_id
      WHERE ia.report_date = (SELECT report_date FROM effective_report)
        AND ia.entity_level = 'ad'
        AND e.account_id = ?
    )
    SELECT
      report_date,
      ad_id,
      metrics_group_key,
      requested_at,
      updated_at,
      api_version,
      schedule_mode
    FROM ranked
    WHERE rn = 1
    ORDER BY requested_at DESC
    LIMIT ?
  `).bind(reportDate, accountId, accountId, limit).all();

  return asArray(rows?.results).map((row) => ({
    report_date: safeString(row.report_date),
    ad_id: safeString(row.ad_id),
    metrics_group_key: safeString(row.metrics_group_key),
    requested_at: safeString(row.requested_at),
    updated_at: safeString(row.updated_at),
    api_version: safeString(row.api_version),
    schedule_mode: safeString(row.schedule_mode),
  })).filter((row) => row.ad_id && row.metrics_group_key);
}

async function fetchAdEntities(db, accountId, adIds) {
  if (!adIds.length) return [];

  const placeholders = buildPlaceholders(adIds.length);
  const rows = await db.prepare(`
    SELECT
      entity_id,
      entity_name,
      account_id,
      campaign_id,
      campaign_name,
      adset_id,
      adset_name,
      ad_id,
      ad_name,
      creative_id,
      creative_name,
      page_id,
      instagram_user_id,
      campaign_objective,
      optimization_goal,
      destination_type,
      bid_strategy,
      billing_event,
      buying_type,
      status,
      effective_status,
      configured_status,
      source_json,
      last_seen_at
    FROM entities
    WHERE entity_kind = 'ad'
      AND account_id = ?
      AND entity_id IN (${placeholders})
  `).bind(accountId, ...adIds).all();

  return asArray(rows?.results);
}

async function fetchMetricSnapshots(db, reportDate, groupKeys, windows) {
  if (!groupKeys.length || !windows.length) return [];

  const keyPlaceholders = buildPlaceholders(groupKeys.length);
  const windowPlaceholders = buildPlaceholders(windows.length);

  const rows = await db.prepare(`
    SELECT
      metrics_group_key,
      report_date,
      entity_level,
      entity_id,
      metrics_window,
      metric_name,
      metric_value,
      source_kind,
      source_metric_name,
      dimension_key,
      dimensions_json,
      recorded_at
    FROM metric_snapshots
    WHERE report_date = ?
      AND metrics_group_key IN (${keyPlaceholders})
      AND metrics_window IN (${windowPlaceholders})
      AND entity_level IN ('ad', 'adset', 'campaign')
  `).bind(reportDate, ...groupKeys, ...windows).all();

  return asArray(rows?.results);
}

async function fetchIngestionAudit(db, reportDate, groupKeys, windows) {
  if (!groupKeys.length || !windows.length) return [];

  const keyPlaceholders = buildPlaceholders(groupKeys.length);
  const windowPlaceholders = buildPlaceholders(windows.length);

  const rows = await db.prepare(`
    SELECT
      metrics_group_key,
      entity_level,
      entity_id,
      metrics_window,
      requested_at,
      api_version,
      schedule_mode,
      fetch_status_summary,
      fetch_status_hourly,
      row_count_summary,
      row_count_hourly,
      row_count_breakdown,
      warning_count,
      low_confidence_count,
      processing_notes_json,
      warning_codes_json,
      updated_at
    FROM ingestion_audit
    WHERE report_date = ?
      AND metrics_group_key IN (${keyPlaceholders})
      AND metrics_window IN (${windowPlaceholders})
      AND entity_level IN ('ad', 'adset', 'campaign')
  `).bind(reportDate, ...groupKeys, ...windows).all();

  return asArray(rows?.results);
}

function buildAuditIndex(auditRows) {
  const index = new Map();

  for (const row of auditRows) {
    const key = makeScopeWindowKey(
      row.metrics_group_key,
      row.entity_level,
      row.entity_id,
      row.metrics_window,
    );
    index.set(key, row);
  }

  return index;
}

function buildMetricIndexes(metricRows) {
  const summary = new Map();
  const breakdown = new Map();

  for (const row of metricRows) {
    const metricName = safeString(row.metric_name);
    if (!metricName) continue;

    const scopeKey = makeScopeWindowKey(
      row.metrics_group_key,
      row.entity_level,
      row.entity_id,
      row.metrics_window,
    );

    if (!safeString(row.dimension_key)) {
      if (!summary.has(scopeKey)) summary.set(scopeKey, []);
      summary.get(scopeKey).push(row);
      continue;
    }

    const breakdownKey = [
      scopeKey,
      safeString(row.dimension_key),
      safeString(row.dimensions_json || '{}'),
    ].join('|');

    if (!breakdown.has(breakdownKey)) breakdown.set(breakdownKey, []);
    breakdown.get(breakdownKey).push(row);
  }

  return { summary, breakdown };
}

function buildReportSummaryRows(latestRuns, adEntityById, summaryMetricIndex, auditIndex, windows) {
  const rows = [];

  for (const run of latestRuns) {
    const adEntity = adEntityById.get(run.ad_id);
    if (!adEntity) continue;

    const row = buildSummaryBaseRow(run, adEntity);

    for (const entityLevel of ['ad', 'adset', 'campaign']) {
      const entityId = resolveScopeEntityId(adEntity, entityLevel);
      if (!entityId) continue;

      for (const windowKey of windows) {
        const prefix = `${entityLevel}_${windowKey}_`;
        const scopeWindowKey = makeScopeWindowKey(run.metrics_group_key, entityLevel, entityId, windowKey);
        const metrics = summaryMetricIndex.get(scopeWindowKey) || [];
        const audit = auditIndex.get(scopeWindowKey);

        applyAuditToSummaryRow(row, prefix, audit);

        for (const metric of metrics) {
          applyMetricToSummaryRow(row, prefix, metric);
        }

        synthesizeEngagementFields(row, prefix);
      }
    }

    rows.push(row);
  }

  return rows;
}

function buildSummaryBaseRow(run, adEntity) {
  const source = safeJsonParse(adEntity.source_json, {});

  return {
    report_date: normalizeReportDate(run.requested_at),
    row_type: 'summary',
    sheet_target: 'metrics_summary',
    row_key: [normalizeReportDate(run.requested_at), safeString(adEntity.entity_id), safeString(run.metrics_group_key)].join('|'),
    metrics_group_key: safeString(run.metrics_group_key),
    schedule_mode: safeString(run.schedule_mode || 'manual'),
    report_mode: 'cloudflare_d1',
    requested_at: safeString(run.requested_at),
    account_id: safeString(adEntity.account_id),
    api_version: safeString(run.api_version || source.api_version || 'v24.0'),
    ad_id: safeString(adEntity.ad_id || adEntity.entity_id),
    ad_name: safeString(adEntity.ad_name || adEntity.entity_name),
    adset_id: safeString(adEntity.adset_id),
    adset_name: safeString(adEntity.adset_name),
    campaign_id: safeString(adEntity.campaign_id),
    campaign_name: safeString(adEntity.campaign_name),
    creative_id: safeString(adEntity.creative_id || source.creative_id),
    creative_name: safeString(adEntity.creative_name || source.creative_name),
    page_id: safeString(adEntity.page_id || source.page_id),
    instagram_user_id: safeString(adEntity.instagram_user_id || source.instagram_user_id),
    optimization_goal: safeString(adEntity.optimization_goal || source.optimization_goal),
    destination_type: safeString(adEntity.destination_type || source.destination_type),
    bid_strategy: safeString(adEntity.bid_strategy || source.bid_strategy),
    billing_event: safeString(adEntity.billing_event || source.billing_event),
    buying_type: safeString(adEntity.buying_type || source.buying_type),
    campaign_objective: safeString(adEntity.campaign_objective || source.campaign_objective),
    ad_status: safeString(source.ad_status || adEntity.status),
    ad_effective_status: safeString(source.ad_effective_status || adEntity.effective_status),
    campaign_status: safeString(source.campaign_status),
    campaign_effective_status: safeString(source.campaign_effective_status),
    effective_instagram_media_id: safeString(source.effective_instagram_media_id),
    instagram_permalink_url: safeString(source.instagram_permalink_url),
    effective_object_story_id: safeString(source.effective_object_story_id),
  };
}

function buildReportBreakdownRows(breakdownMetricIndex, latestByGroup, adEntityById, auditIndex) {
  const output = [];

  for (const [breakdownGroupKey, metrics] of breakdownMetricIndex.entries()) {
    const first = metrics[0];
    if (!first) continue;

    const scopeWindowKey = makeScopeWindowKey(
      first.metrics_group_key,
      first.entity_level,
      first.entity_id,
      first.metrics_window,
    );
    const run = latestByGroup.get(safeString(first.metrics_group_key));
    const adEntity = run ? adEntityById.get(run.ad_id) : null;
    if (!run || !adEntity) continue;

    const dimensions = safeJsonParse(first.dimensions_json, {});
    const row = {
      report_date: normalizeReportDate(run.requested_at),
      row_type: 'breakdown',
      sheet_target: 'metrics_breakdowns',
      row_key: [
        normalizeReportDate(run.requested_at),
        safeString(first.metrics_group_key),
        safeString(first.entity_level),
        safeString(first.entity_id),
        safeString(first.metrics_window),
        safeString(first.dimension_key),
      ].join('|'),
      metrics_group_key: safeString(first.metrics_group_key),
      account_id: safeString(adEntity.account_id),
      scope_type: safeString(first.entity_level),
      ad_id: safeString(adEntity.ad_id || adEntity.entity_id),
      adset_id: safeString(adEntity.adset_id),
      campaign_id: safeString(adEntity.campaign_id),
      window: safeString(first.metrics_window),
      breakdown_key: safeString(first.dimension_key),
      row_count: 1,
    };

    applyDimensionsToBreakdownRow(row, dimensions);

    const audit = auditIndex.get(scopeWindowKey);
    applyAuditToBreakdownRow(row, audit);

    for (const metric of metrics) {
      applyMetricToBreakdownRow(row, metric);
    }

    synthesizeBreakdownEngagement(row);
    output.push(row);
  }

  return output;
}

function applyAuditToSummaryRow(row, prefix, audit) {
  row[`${prefix}fetch_status_summary`] = safeString(audit?.fetch_status_summary);
  row[`${prefix}fetch_status_hourly`] = safeString(audit?.fetch_status_hourly);
  row[`${prefix}fetch_error_summary_message`] = '';
  row[`${prefix}fetch_error_summary_code`] = '';
  row[`${prefix}fetch_error_hourly_message`] = '';
  row[`${prefix}fetch_error_hourly_code`] = '';
  row[`${prefix}row_count_summary`] = safeInteger(audit?.row_count_summary);
  row[`${prefix}row_count_hourly`] = safeInteger(audit?.row_count_hourly);
}

function applyMetricToSummaryRow(row, prefix, metric) {
  const metricName = safeString(metric.metric_name);
  if (!metricName) return;

  const value = normalizeMetricValue(metric.metric_value);
  if (value === null) return;

  row[`${prefix}${metricName}`] = value;

  const scalarAlias = SUMMARY_SCALAR_ALIAS[metricName];
  if (scalarAlias) {
    row[`${prefix}${scalarAlias}`] = value;
    row[`${prefix}${scalarAlias}_source`] = safeString(metric.source_kind || 'summary');
  }

  if (metricName === 'conversation_started') {
    row[`${prefix}whatsapp_conversations_started`] = value;
  }
  if (metricName === 'cost_per_conversation_started' && row[`${prefix}avg_cost_per_conversation`] == null) {
    row[`${prefix}avg_cost_per_conversation`] = value;
  }

  applyActionListFields(row, prefix, metricName, value);
}

function applyActionListFields(row, prefix, metricName, value) {
  const directAlias = ACTION_ALIAS[metricName];
  if (directAlias) {
    row[`${prefix}list_actions_${directAlias}`] = value;
    return;
  }

  if (metricName.startsWith('unique_')) {
    const baseMetric = metricName.slice('unique_'.length);
    const alias = ACTION_ALIAS[baseMetric];
    if (alias) row[`${prefix}list_unique_actions_${alias}`] = value;
    return;
  }

  if (metricName.startsWith('cost_per_unique_')) {
    const baseMetric = metricName.slice('cost_per_unique_'.length);
    const alias = ACTION_ALIAS[baseMetric];
    if (alias) row[`${prefix}list_cost_per_unique_action_type_${alias}`] = value;
    return;
  }

  if (metricName.startsWith('cost_per_')) {
    const baseMetric = metricName.slice('cost_per_'.length);
    const alias = ACTION_ALIAS[baseMetric];
    if (alias) row[`${prefix}list_cost_per_action_type_${alias}`] = value;
  }
}

function synthesizeEngagementFields(row, prefix) {
  if (row[`${prefix}engagement_general`] != null) return;

  const postReaction = toNumberOrNull(row[`${prefix}post_reaction`]) || 0;
  const comments = toNumberOrNull(row[`${prefix}comments`]) || 0;
  const posts = toNumberOrNull(row[`${prefix}posts`]) || 0;
  const computed = postReaction + comments + posts;

  if (computed > 0) {
    row[`${prefix}engagement_general`] = computed;
  }
}

function applyDimensionsToBreakdownRow(row, dimensions) {
  for (const [key, rawValue] of Object.entries(isObject(dimensions) ? dimensions : {})) {
    const normalizedKey = safeString(key);
    if (!DIMENSION_FIELDS.has(normalizedKey)) continue;
    const value = safeString(rawValue);
    if (!value) continue;
    row[`dimension_${normalizedKey}`] = value;
  }
}

function applyAuditToBreakdownRow(row, audit) {
  row.metric_fetch_status_summary = safeString(audit?.fetch_status_summary);
  row.metric_fetch_status_hourly = safeString(audit?.fetch_status_hourly);
  row.metric_fetch_error_summary_message = '';
  row.metric_fetch_error_summary_code = '';
  row.metric_fetch_error_hourly_message = '';
  row.metric_fetch_error_hourly_code = '';
  row.metric_row_count_summary = safeInteger(audit?.row_count_summary);
  row.metric_row_count_hourly = safeInteger(audit?.row_count_hourly);
}

function applyMetricToBreakdownRow(row, metric) {
  const metricName = safeString(metric.metric_name);
  if (!metricName) return;

  const value = normalizeMetricValue(metric.metric_value);
  if (value === null) return;

  row[metricName] = value;

  const scalarAlias = SUMMARY_SCALAR_ALIAS[metricName];
  if (scalarAlias) {
    row[`metric_${scalarAlias}`] = value;
  }

  if (metricName === 'conversation_started') {
    row.whatsapp_conversations_started = value;
  }
  if (metricName === 'cost_per_conversation_started' && row.avg_cost_per_conversation == null) {
    row.avg_cost_per_conversation = value;
  }
}

function synthesizeBreakdownEngagement(row) {
  if (row.engagement_general != null) return;

  const postReaction = toNumberOrNull(row.post_reaction) || 0;
  const comments = toNumberOrNull(row.comments) || 0;
  const posts = toNumberOrNull(row.posts) || 0;
  const computed = postReaction + comments + posts;

  if (computed > 0) {
    row.engagement_general = computed;
  }
}

function resolveScopeEntityId(adEntity, scopeType) {
  if (scopeType === 'ad') return safeString(adEntity.ad_id || adEntity.entity_id);
  if (scopeType === 'adset') return safeString(adEntity.adset_id);
  if (scopeType === 'campaign') return safeString(adEntity.campaign_id);
  return '';
}

function normalizeMetricValue(value) {
  const numeric = toNumberOrNull(value);
  return numeric === null ? null : numeric;
}

function toNumberOrNull(value) {
  if (value === null || value === undefined || value === '') return null;
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function normalizeInclude(value) {
  const normalized = safeString(value).toLowerCase();
  if (normalized === 'summary') return 'summary';
  if (normalized === 'breakdown' || normalized === 'breakdowns') return 'breakdown';
  return 'both';
}

function normalizeReportDate(value) {
  const input = safeString(value);
  if (/^\d{4}-\d{2}-\d{2}$/.test(input)) {
    return input;
  }

  if (input) {
    const parsed = new Date(input);
    if (!Number.isNaN(parsed.getTime())) {
      return parsed.toISOString().slice(0, 10);
    }
  }

  const now = new Date();
  now.setUTCDate(now.getUTCDate() - 1);
  return now.toISOString().slice(0, 10);
}

function parseReportWindows(raw) {
  const values = safeString(raw)
    .split(',')
    .map((entry) => safeString(entry))
    .filter(Boolean);

  if (!values.length) return [...REPORT_WINDOWS];

  const unique = dedupeStrings(values.filter((windowKey) => REPORT_WINDOWS.includes(windowKey)));
  return unique.length ? unique : [...REPORT_WINDOWS];
}

function dedupeStrings(values) {
  const seen = new Set();
  const output = [];

  for (const value of values) {
    const normalized = safeString(value);
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    output.push(normalized);
  }

  return output;
}

function makeScopeWindowKey(metricsGroupKey, entityLevel, entityId, windowKey) {
  return [
    safeString(metricsGroupKey),
    safeString(entityLevel),
    safeString(entityId),
    safeString(windowKey),
  ].join('|');
}

function buildPlaceholders(count) {
  return new Array(count).fill('?').join(',');
}

function buildContractResponse(env) {
  return {
    ok: true,
    environment: safeString(env.ENVIRONMENT || 'unknown'),
    contract: {
      report: {
        method: 'GET',
        endpoint: '/report/meta-ads-performance-report',
        query: {
          account_id: 'required',
          report_date: 'optional (YYYY-MM-DD, default yesterday UTC)',
          windows: 'optional (csv: last_24h,last_7d,last_30d)',
          include: 'optional (summary|breakdown|both)',
          limit: 'optional',
        },
        success_response: {
          ok: true,
          summary_rows: 'array',
          breakdown_rows: 'array',
          metadata: 'object',
        },
      },
      inventory: {
        method: 'GET',
        endpoint: '/inventory/meta-ads-performance-report',
        query: {
          account_id: 'required',
          freshness_hours: 'optional',
          limit: 'optional',
        },
        success_response: {
          ok: true,
          count: 'number',
          items: 'array',
        },
      },
      method: 'POST',
      endpoint: '/ingest/meta-ads-performance-report',
      auth: {
        header: safeString(env.WORKER_AUTH_HEADER_NAME || 'Authorization'),
        scheme: safeString(env.WORKER_AUTH_SCHEME || 'Bearer'),
        token_secret: 'WORKER_API_TOKEN',
      },
      required_headers: [
        'Content-Type: application/json',
        'Idempotency-Key',
        safeString(env.WORKER_AUTH_HEADER_NAME || 'Authorization'),
      ],
      required_body_fields: [
        'run',
        'entities',
        'metric_snapshots',
        'ingestion_audit',
        'raw_payloads',
      ],
      optional_body_fields: [
        'compatibility_exports',
        'duplication_report',
      ],
      success_response: {
        ok: true,
        results: {
          entities_upserted: 'number',
          metric_snapshots_inserted: 'number',
          audit_rows_inserted: 'number',
          raw_payloads_written: 'number',
          warnings_count: 'number',
        },
      },
      error_response: {
        ok: false,
        error: 'string',
        message: 'string',
        requestId: 'string',
      },
      in_progress_response: {
        ok: true,
        inProgress: true,
        phase: 'string',
        lastSuccessfulPhase: 'string',
      },
      retries: {
        safe: true,
        reason: 'Idempotency-Key + upserts em D1.',
      },
    },
  };
}

async function authorizeRequest(request, env) {
  if (String(env.REQUIRE_AUTH || 'true') !== 'true') {
    return { ok: true };
  }

  const configuredToken = safeString(env.WORKER_API_TOKEN);
  if (!configuredToken) {
    return {
      ok: false,
      status: 500,
      reason: 'missing_worker_secret',
      message: 'WORKER_API_TOKEN secret is not configured.',
    };
  }

  const headerName = safeString(env.WORKER_AUTH_HEADER_NAME || 'Authorization') || 'Authorization';
  const authHeader = safeString(request.headers.get(headerName));
  const scheme = safeString(env.WORKER_AUTH_SCHEME || 'Bearer') || 'Bearer';

  if (!authHeader) {
    return {
      ok: false,
      status: 401,
      reason: 'missing_auth_header',
      message: `${headerName} header is required.`,
    };
  }

  let token = authHeader;
  if (scheme) {
    const prefix = `${scheme} `;
    if (!authHeader.startsWith(prefix)) {
      return {
        ok: false,
        status: 401,
        reason: 'invalid_auth_scheme',
        message: `${headerName} header must use ${scheme} token.`,
      };
    }

    token = authHeader.slice(prefix.length).trim();
  }

  if (!timingSafeEqual(token, configuredToken)) {
    return {
      ok: false,
      status: 401,
      reason: 'invalid_token',
      message: 'Invalid Worker API token.',
    };
  }

  return { ok: true };
}

function validateBody(body) {
  const issues = [];

  if (!isObject(body)) {
    issues.push('Body must be an object.');
    return { ok: false, issues };
  }

  if (!isObject(body.run)) issues.push('run is required.');
  if (!Array.isArray(body.entities)) issues.push('entities must be an array.');
  if (!Array.isArray(body.metric_snapshots)) issues.push('metric_snapshots must be an array.');
  if (!Array.isArray(body.ingestion_audit)) issues.push('ingestion_audit must be an array.');
  if (!Array.isArray(body.raw_payloads)) issues.push('raw_payloads must be an array.');
  if (body.duplication_report !== undefined && !Array.isArray(body.duplication_report)) {
    issues.push('duplication_report must be an array when provided.');
  }
  if (body.compatibility_exports !== undefined && !isObject(body.compatibility_exports)) {
    issues.push('compatibility_exports must be an object when provided.');
  }

  if (!safeString(body.run?.run_id)) issues.push('run.run_id is required.');
  if (!safeString(body.run?.metrics_group_key)) issues.push('run.metrics_group_key is required.');
  if (!safeString(body.run?.report_date)) issues.push('run.report_date is required.');
  if (!safeString(body.run?.requested_at)) issues.push('run.requested_at is required.');

  return {
    ok: issues.length === 0,
    issues,
  };
}

function buildEntityStatement(env, entity) {
  return env.META_ADS_DB.prepare(`
    INSERT INTO entities (
      entity_key, entity_kind, entity_id, entity_name, account_id, campaign_id, campaign_name,
      adset_id, adset_name, ad_id, ad_name, creative_id, creative_name, page_id,
      instagram_user_id, campaign_objective, optimization_goal, destination_type,
      bid_strategy, billing_event, buying_type, status, effective_status, configured_status,
      source_json, first_seen_at, last_seen_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(entity_kind, entity_id) DO UPDATE SET
      entity_name = excluded.entity_name,
      account_id = excluded.account_id,
      campaign_id = excluded.campaign_id,
      campaign_name = excluded.campaign_name,
      adset_id = excluded.adset_id,
      adset_name = excluded.adset_name,
      ad_id = excluded.ad_id,
      ad_name = excluded.ad_name,
      creative_id = excluded.creative_id,
      creative_name = excluded.creative_name,
      page_id = excluded.page_id,
      instagram_user_id = excluded.instagram_user_id,
      campaign_objective = excluded.campaign_objective,
      optimization_goal = excluded.optimization_goal,
      destination_type = excluded.destination_type,
      bid_strategy = excluded.bid_strategy,
      billing_event = excluded.billing_event,
      buying_type = excluded.buying_type,
      status = excluded.status,
      effective_status = excluded.effective_status,
      configured_status = excluded.configured_status,
      source_json = excluded.source_json,
      last_seen_at = excluded.last_seen_at
  `).bind(
    safeString(entity.entity_key),
    safeString(entity.entity_kind),
    safeString(entity.entity_id),
    nullableString(entity.entity_name),
    nullableString(entity.account_id),
    nullableString(entity.campaign_id),
    nullableString(entity.campaign_name),
    nullableString(entity.adset_id),
    nullableString(entity.adset_name),
    nullableString(entity.ad_id),
    nullableString(entity.ad_name),
    nullableString(entity.creative_id),
    nullableString(entity.creative_name),
    nullableString(entity.page_id),
    nullableString(entity.instagram_user_id),
    nullableString(entity.campaign_objective),
    nullableString(entity.optimization_goal),
    nullableString(entity.destination_type),
    nullableString(entity.bid_strategy),
    nullableString(entity.billing_event),
    nullableString(entity.buying_type),
    nullableString(entity.status),
    nullableString(entity.effective_status),
    nullableString(entity.configured_status),
    JSON.stringify(entity.source_json || {}),
    safeString(entity.first_seen_at || new Date().toISOString()),
    safeString(entity.last_seen_at || new Date().toISOString())
  );
}

function buildMetricSnapshotStatement(env, snapshot) {
  return env.META_ADS_DB.prepare(`
    INSERT INTO metric_snapshots (
      snapshot_key, metrics_group_key, audit_key, report_date, entity_level, entity_id, entity_name,
      metrics_window, metric_name, metric_value, metric_group, analytic_role, value_type, metric_unit,
      source_kind, source_variant, source_field, source_metric_name, account_currency, dimension_key,
      dimensions_json, confidence_status, confidence_score, warning_codes_json, warning_messages_json,
      duplicate_source_kinds_json, is_primary, recorded_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(snapshot_key) DO UPDATE SET
      audit_key = excluded.audit_key,
      entity_name = excluded.entity_name,
      metric_value = excluded.metric_value,
      metric_group = excluded.metric_group,
      analytic_role = excluded.analytic_role,
      value_type = excluded.value_type,
      metric_unit = excluded.metric_unit,
      source_kind = excluded.source_kind,
      source_variant = excluded.source_variant,
      source_field = excluded.source_field,
      source_metric_name = excluded.source_metric_name,
      account_currency = excluded.account_currency,
      confidence_status = excluded.confidence_status,
      confidence_score = excluded.confidence_score,
      warning_codes_json = excluded.warning_codes_json,
      warning_messages_json = excluded.warning_messages_json,
      duplicate_source_kinds_json = excluded.duplicate_source_kinds_json,
      is_primary = excluded.is_primary,
      recorded_at = excluded.recorded_at
  `).bind(
    safeString(snapshot.snapshot_key),
    safeString(snapshot.metrics_group_key),
    safeString(snapshot.audit_key),
    safeString(snapshot.report_date),
    safeString(snapshot.entity_level),
    safeString(snapshot.entity_id),
    nullableString(snapshot.entity_name),
    safeString(snapshot.metrics_window),
    safeString(snapshot.metric_name),
    nullableNumber(snapshot.metric_value),
    safeString(snapshot.metric_group),
    safeString(snapshot.analytic_role),
    safeString(snapshot.value_type),
    nullableString(snapshot.metric_unit),
    safeString(snapshot.source_kind),
    nullableString(snapshot.source_variant),
    nullableString(snapshot.source_field),
    nullableString(snapshot.source_metric_name),
    nullableString(snapshot.account_currency),
    safeString(snapshot.dimension_key || ''),
    safeString(snapshot.dimensions_json || '{}'),
    safeString(snapshot.confidence_status || 'high'),
    safeNumber(snapshot.confidence_score, 1),
    JSON.stringify(asArray(snapshot.warning_codes)),
    JSON.stringify(asArray(snapshot.warning_messages)),
    JSON.stringify(asArray(snapshot.duplicate_source_kinds)),
    snapshot.is_primary ? 1 : 0,
    safeString(snapshot.recorded_at || new Date().toISOString())
  );
}

function buildIngestionAuditStatement(env, audit) {
  return env.META_ADS_DB.prepare(`
    INSERT INTO ingestion_audit (
      audit_key, metrics_group_key, entity_level, entity_id, report_date, metrics_window,
      requested_at, api_version, schedule_mode, fetch_status_summary, fetch_status_hourly,
      fetch_status_breakdown, row_count_summary, row_count_hourly, row_count_breakdown,
      ingestion_status, payload_hashes_json, raw_payload_references_json, processing_notes_json,
      warning_codes_json, warning_count, low_confidence_count, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(audit_key) DO UPDATE SET
      metrics_group_key = excluded.metrics_group_key,
      entity_level = excluded.entity_level,
      entity_id = excluded.entity_id,
      report_date = excluded.report_date,
      metrics_window = excluded.metrics_window,
      requested_at = excluded.requested_at,
      api_version = excluded.api_version,
      schedule_mode = excluded.schedule_mode,
      fetch_status_summary = excluded.fetch_status_summary,
      fetch_status_hourly = excluded.fetch_status_hourly,
      fetch_status_breakdown = excluded.fetch_status_breakdown,
      row_count_summary = excluded.row_count_summary,
      row_count_hourly = excluded.row_count_hourly,
      row_count_breakdown = excluded.row_count_breakdown,
      ingestion_status = excluded.ingestion_status,
      payload_hashes_json = excluded.payload_hashes_json,
      raw_payload_references_json = excluded.raw_payload_references_json,
      processing_notes_json = excluded.processing_notes_json,
      warning_codes_json = excluded.warning_codes_json,
      warning_count = excluded.warning_count,
      low_confidence_count = excluded.low_confidence_count,
      updated_at = excluded.updated_at
  `).bind(
    safeString(audit.audit_key),
    safeString(audit.metrics_group_key),
    safeString(audit.entity_level),
    safeString(audit.entity_id),
    safeString(audit.report_date),
    safeString(audit.metrics_window),
    safeString(audit.requested_at),
    nullableString(audit.api_version),
    nullableString(audit.schedule_mode),
    nullableString(audit.fetch_status_summary),
    nullableString(audit.fetch_status_hourly),
    nullableString(audit.fetch_status_breakdown),
    safeInteger(audit.row_count_summary),
    safeInteger(audit.row_count_hourly),
    safeInteger(audit.row_count_breakdown),
    safeString(audit.ingestion_status),
    safeJsonString(audit.payload_hashes_json, '[]'),
    safeJsonString(audit.raw_payload_references_json, '[]'),
    safeJsonString(audit.processing_notes_json, '[]'),
    safeJsonString(audit.warning_codes_json, '[]'),
    safeInteger(audit.warning_count),
    safeInteger(audit.low_confidence_count),
    safeString(audit.created_at || new Date().toISOString()),
    safeString(audit.updated_at || new Date().toISOString())
  );
}

function buildRawPayloadStatement(env, payload) {
  return env.META_ADS_DB.prepare(`
    INSERT INTO raw_payloads (
      payload_hash, request_key, audit_key, metrics_group_key, raw_payload_reference,
      storage_backend, payload_size_bytes, fetch_status, retrieved_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(payload_hash) DO UPDATE SET
      request_key = excluded.request_key,
      audit_key = excluded.audit_key,
      metrics_group_key = excluded.metrics_group_key,
      raw_payload_reference = excluded.raw_payload_reference,
      storage_backend = excluded.storage_backend,
      payload_size_bytes = excluded.payload_size_bytes,
      fetch_status = excluded.fetch_status,
      retrieved_at = excluded.retrieved_at
  `).bind(
    safeString(payload.payload_hash),
    safeString(payload.request_key),
    safeString(payload.audit_key),
    safeString(payload.metrics_group_key),
    safeString(payload.raw_payload_reference || payload.raw_payload_key || payload.payload_hash),
    safeString(payload.storage_backend || 'r2'),
    safeInteger(payload.payload_size_bytes),
    safeString(payload.fetch_status || 'ok'),
    safeString(payload.retrieved_at || new Date().toISOString())
  );
}

function buildDuplicationStatement(env, duplication, run) {
  const parts = safeString(duplication.selection_key).split('|');
  const duplicationKey = [
    safeString(run.run_id),
    safeString(duplication.selection_key),
    safeString(duplication.metric_name),
  ].join('|');

  return env.META_ADS_DB.prepare(`
    INSERT INTO metric_duplication_audit (
      duplication_key, run_id, metrics_group_key, selection_key, report_date, entity_level,
      entity_id, metrics_window, dimension_key, metric_name, kept_source_kind,
      discarded_source_kinds_json, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(duplication_key) DO UPDATE SET
      kept_source_kind = excluded.kept_source_kind,
      discarded_source_kinds_json = excluded.discarded_source_kinds_json
  `).bind(
    duplicationKey,
    safeString(run.run_id),
    safeString(run.metrics_group_key),
    safeString(duplication.selection_key),
    safeString(run.report_date),
    nullableString(parts[0]),
    nullableString(parts[1]),
    nullableString(parts[2]),
    nullableString(parts[3]),
    safeString(duplication.metric_name),
    safeString(duplication.kept_source_kind),
    JSON.stringify(asArray(duplication.discarded_source_kinds)),
    new Date().toISOString()
  );
}

async function persistRawPayloads(env, rawPayloads, requestMeta) {
  const warnings = [];
  let written = 0;

  if (!rawPayloads.length) {
    return { written, warnings, status: 'skipped' };
  }

  for (const payload of rawPayloads) {
    const reference = safeString(payload.raw_payload_reference || payload.raw_payload_key || payload.payload_hash);
    const body = safeString(payload.raw_payload_body);

    if (!body) {
      warnings.push(`raw_payload_body ausente para ${reference}.`);
      continue;
    }

    if (!env.META_ADS_RAW_PAYLOADS) {
      warnings.push(`binding META_ADS_RAW_PAYLOADS ausente; payload ${reference} não foi enviado ao R2.`);
      continue;
    }

    await env.META_ADS_RAW_PAYLOADS.put(reference, body, {
      httpMetadata: {
        contentType: 'application/json',
      },
    });
    written += 1;
  }

  if (warnings.length) {
    log(env, 'warn', 'raw_payload_partial', {
      ...requestMeta,
      warnings,
    });
  }

  return {
    written,
    warnings,
    status: warnings.length ? 'partial' : 'completed',
  };
}

async function upsertIngestionRun(env, row) {
  await env.META_ADS_DB.prepare(`
    INSERT INTO ingestion_runs (
      run_id, workflow_name, report_mode, report_date, requested_at, account_id,
      metrics_group_key, idempotency_key, status, entities_upserted, metric_snapshots_inserted,
      audit_rows_inserted, raw_payloads_written, raw_payload_rows_upserted,
      duplication_rows_upserted, warnings_count, duplication_count, last_error,
      request_headers_json, summary_json, phase, last_successful_phase, attempt_count,
      last_request_id, r2_status, d1_status, processing_warnings_json, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(idempotency_key) DO UPDATE SET
      run_id = excluded.run_id,
      workflow_name = excluded.workflow_name,
      report_mode = excluded.report_mode,
      report_date = excluded.report_date,
      requested_at = excluded.requested_at,
      account_id = excluded.account_id,
      metrics_group_key = excluded.metrics_group_key,
      status = excluded.status,
      entities_upserted = excluded.entities_upserted,
      metric_snapshots_inserted = excluded.metric_snapshots_inserted,
      audit_rows_inserted = excluded.audit_rows_inserted,
      raw_payloads_written = excluded.raw_payloads_written,
      raw_payload_rows_upserted = excluded.raw_payload_rows_upserted,
      duplication_rows_upserted = excluded.duplication_rows_upserted,
      warnings_count = excluded.warnings_count,
      duplication_count = excluded.duplication_count,
      last_error = excluded.last_error,
      request_headers_json = excluded.request_headers_json,
      summary_json = excluded.summary_json,
      phase = excluded.phase,
      last_successful_phase = excluded.last_successful_phase,
      attempt_count = excluded.attempt_count,
      last_request_id = excluded.last_request_id,
      r2_status = excluded.r2_status,
      d1_status = excluded.d1_status,
      processing_warnings_json = excluded.processing_warnings_json,
      updated_at = excluded.updated_at
  `).bind(
    safeString(row.run_id),
    safeString(row.workflow_name),
    nullableString(row.report_mode),
    nullableString(row.report_date),
    safeString(row.requested_at),
    nullableString(row.account_id),
    nullableString(row.metrics_group_key),
    safeString(row.idempotency_key),
    safeString(row.status),
    safeInteger(row.entities_upserted),
    safeInteger(row.metric_snapshots_inserted),
    safeInteger(row.audit_rows_inserted),
    safeInteger(row.raw_payloads_written),
    safeInteger(row.raw_payload_rows_upserted),
    safeInteger(row.duplication_rows_upserted),
    safeInteger(row.warnings_count),
    safeInteger(row.duplication_count),
    safeString(row.last_error),
    safeJsonString(row.request_headers_json, '{}'),
    safeJsonString(row.summary_json, '{}'),
    safeString(row.phase || 'received'),
    safeString(row.last_successful_phase),
    Math.max(1, safeInteger(row.attempt_count || 1)),
    safeString(row.last_request_id),
    safeString(row.r2_status || 'not_started'),
    safeString(row.d1_status || 'not_started'),
    safeJsonString(row.processing_warnings_json, '[]'),
    safeString(row.created_at || new Date().toISOString()),
    safeString(row.updated_at || new Date().toISOString())
  ).run();
}

async function runStatementsInChunks(db, statements, chunkSize = 50) {
  for (let index = 0; index < statements.length; index += chunkSize) {
    const chunk = statements.slice(index, index + chunkSize);
    if (chunk.length) {
      await db.batch(chunk);
    }
  }
}

function countWarnings(metricSnapshots, ingestionAudit) {
  const metricWarningCount = metricSnapshots.reduce(
    (sum, snapshot) => sum + asArray(snapshot.warning_codes).length,
    0
  );
  const auditWarningCount = ingestionAudit.reduce(
    (sum, audit) => sum + safeInteger(audit.warning_count),
    0
  );
  return metricWarningCount + auditWarningCount;
}

function redactHeaders(headers, env) {
  const output = {};
  const authHeaderName = safeString(env.WORKER_AUTH_HEADER_NAME || 'Authorization').toLowerCase();

  for (const [key, value] of headers.entries()) {
    output[key] = key.toLowerCase() === authHeaderName ? '[redacted]' : value;
  }

  return output;
}

function safeJsonParse(value, fallback) {
  try {
    return JSON.parse(value);
  } catch (error) {
    return fallback;
  }
}

function safeJsonString(value, fallback) {
  if (typeof value === 'string') {
    return value;
  }

  try {
    return JSON.stringify(value ?? JSON.parse(fallback));
  } catch (error) {
    return fallback;
  }
}

function buildInventoryItem(row) {
  const source = safeJsonParse(row.source_json, {});
  const campaign = isObject(source.campaign) ? source.campaign : {};
  const creative = isObject(source.creative) ? source.creative : {};
  const adset = isObject(source.adset) ? source.adset : {};
  const adId = firstIdentifier(source.ad_id, row.ad_id, row.entity_id);
  const adsetId = firstIdentifier(source.adset_id, adset.id, row.adset_id);
  const creativeId = firstIdentifier(source.creative_id, creative.id, row.creative_id);

  if (!adId || !adsetId || !creativeId) {
    return null;
  }

  const inventoryItem = {
    id: adId,
    ad_id: adId,
    ad_name: safeString(source.ad_name || row.ad_name || row.entity_name),
    campaign_id: firstIdentifier(source.campaign_id, campaign.id, row.campaign_id),
    campaign_name: safeString(source.campaign_name || row.campaign_name || campaign.name),
    adset_id: adsetId,
    adset_name: safeString(source.adset_name || row.adset_name || adset.name),
    creative_id: creativeId,
    creative_name: safeString(source.creative_name || row.creative_name || creative.name),
    account_id: firstIdentifier(source.account_id, row.account_id),
    status: safeString(source.ad_status || row.status),
    effective_status: safeString(source.ad_effective_status || row.effective_status),
    configured_status: safeString(source.ad_configured_status || row.configured_status),
    creative: {
      id: creativeId,
      name: safeString(source.creative_name || row.creative_name || creative.name),
    },
    inventory_source: 'd1',
    inventory_last_seen_at: safeString(row.last_seen_at),
    inventory_snapshot: source,
  };

  return inventoryItem.id ? inventoryItem : null;
}

function jsonResponse(status, body) {
  return Response.json(body, { status });
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function isObject(value) {
  return value != null && typeof value === 'object' && !Array.isArray(value);
}

function safeString(value) {
  return value == null ? '' : String(value).trim();
}

function firstIdentifier(...values) {
  for (const value of values) {
    const normalized = safeString(value);
    if (normalized && normalized !== '0') {
      return normalized;
    }
  }

  return '';
}

function nullableString(value) {
  const normalized = safeString(value);
  return normalized || null;
}

function safeNumber(value, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function nullableNumber(value) {
  return value === null || value === undefined || value === '' ? null : safeNumber(value, null);
}

function safeInteger(value) {
  return Math.trunc(safeNumber(value, 0));
}

function positiveInteger(value, fallback) {
  const parsed = Math.trunc(Number(value));
  return parsed > 0 ? parsed : fallback;
}

function isStaleRun(value, thresholdMs = 10 * 60 * 1000) {
  const timestamp = Date.parse(safeString(value));
  if (!Number.isFinite(timestamp)) {
    return true;
  }
  return Date.now() - timestamp > thresholdMs;
}

function timingSafeEqual(left, right) {
  const leftBytes = new TextEncoder().encode(String(left || ''));
  const rightBytes = new TextEncoder().encode(String(right || ''));

  if (leftBytes.length !== rightBytes.length) {
    return false;
  }

  let result = 0;
  for (let index = 0; index < leftBytes.length; index += 1) {
    result |= leftBytes[index] ^ rightBytes[index];
  }

  return result === 0;
}

function log(env, level, message, extra = {}) {
  const configuredLevel = String(env.LOG_LEVEL || 'info').toLowerCase();
  const order = ['debug', 'info', 'warn', 'error'];

  if (order.indexOf(level) < order.indexOf(configuredLevel)) {
    return;
  }

  console.log(JSON.stringify({
    level,
    message,
    environment: String(env.ENVIRONMENT || 'unknown'),
    timestamp: new Date().toISOString(),
    ...extra,
  }));
}
