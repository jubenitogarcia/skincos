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

  const existingRun = await env.META_ADS_DB.prepare(`
    SELECT summary_json, status
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

  log(env, 'info', 'ingestion_started', requestMeta);

  try {
    await upsertIngestionRun(env, {
      run_id: safeString(run.run_id || idempotencyKey),
      workflow_name: safeString(run.workflow_name || 'Meta Ads - Performance Report'),
      report_mode: safeString(run.report_mode),
      report_date: safeString(run.report_date),
      requested_at: safeString(run.requested_at || startedAt),
      account_id: safeString(run.account_id),
      metrics_group_key: safeString(run.metrics_group_key),
      idempotency_key: idempotencyKey,
      status: 'started',
      entities_upserted: 0,
      metric_snapshots_inserted: 0,
      audit_rows_inserted: 0,
      raw_payloads_written: 0,
      raw_payload_rows_upserted: 0,
      duplication_rows_upserted: 0,
      warnings_count: 0,
      duplication_count: duplicationReport.length,
      last_error: '',
      request_headers_json: JSON.stringify(redactHeaders(request.headers, env)),
      summary_json: JSON.stringify({ status: 'started' }),
      created_at: startedAt,
      updated_at: startedAt,
    });

    const entityStatements = entities.map((entity) => buildEntityStatement(env, entity));
    const metricStatements = metricSnapshots.map((snapshot) => buildMetricSnapshotStatement(env, snapshot));
    const auditStatements = ingestionAudit.map((audit) => buildIngestionAuditStatement(env, audit));
    const rawPayloadStatements = rawPayloads.map((payload) => buildRawPayloadStatement(env, payload));
    const duplicationStatements = duplicationReport.map((entry) => buildDuplicationStatement(env, entry, run));

    await runStatementsInChunks(env.META_ADS_DB, entityStatements);
    await runStatementsInChunks(env.META_ADS_DB, metricStatements);
    await runStatementsInChunks(env.META_ADS_DB, auditStatements);
    await runStatementsInChunks(env.META_ADS_DB, duplicationStatements);

    const rawPayloadWrite = await persistRawPayloads(env, rawPayloads, requestMeta);
    await runStatementsInChunks(env.META_ADS_DB, rawPayloadStatements);

    const warningsCount = countWarnings(metricSnapshots, ingestionAudit) + rawPayloadWrite.warnings.length;
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

    await upsertIngestionRun(env, {
      run_id: safeString(run.run_id || idempotencyKey),
      workflow_name: safeString(run.workflow_name || 'Meta Ads - Performance Report'),
      report_mode: safeString(run.report_mode),
      report_date: safeString(run.report_date),
      requested_at: safeString(run.requested_at || startedAt),
      account_id: safeString(run.account_id),
      metrics_group_key: safeString(run.metrics_group_key),
      idempotency_key: idempotencyKey,
      status: 'completed',
      entities_upserted: summary.entities_upserted,
      metric_snapshots_inserted: summary.metric_snapshots_inserted,
      audit_rows_inserted: summary.audit_rows_inserted,
      raw_payloads_written: summary.raw_payloads_written,
      raw_payload_rows_upserted: summary.raw_payload_rows_upserted,
      duplication_rows_upserted: summary.duplication_rows_upserted,
      warnings_count: summary.warnings_count,
      duplication_count: summary.duplication_count,
      last_error: '',
      request_headers_json: JSON.stringify(redactHeaders(request.headers, env)),
      summary_json: JSON.stringify(summary),
      created_at: startedAt,
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
      await upsertIngestionRun(env, {
        run_id: safeString(run.run_id || idempotencyKey),
        workflow_name: safeString(run.workflow_name || 'Meta Ads - Performance Report'),
        report_mode: safeString(run.report_mode),
        report_date: safeString(run.report_date),
        requested_at: safeString(run.requested_at || startedAt),
        account_id: safeString(run.account_id),
        metrics_group_key: safeString(run.metrics_group_key),
        idempotency_key: idempotencyKey,
        status: 'failed',
        entities_upserted: 0,
        metric_snapshots_inserted: 0,
        audit_rows_inserted: 0,
        raw_payloads_written: 0,
        raw_payload_rows_upserted: 0,
        duplication_rows_upserted: 0,
        warnings_count: 0,
        duplication_count: duplicationReport.length,
        last_error: message,
        request_headers_json: JSON.stringify(redactHeaders(request.headers, env)),
        summary_json: JSON.stringify({ status: 'failed', error: message }),
        created_at: startedAt,
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
    });
  }
}

function buildContractResponse(env) {
  return {
    ok: true,
    environment: safeString(env.ENVIRONMENT || 'unknown'),
    contract: {
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
    ON CONFLICT(
      metrics_group_key, entity_level, entity_id, report_date, metrics_window, metric_name, dimension_key, dimensions_json
    ) DO UPDATE SET
      snapshot_key = excluded.snapshot_key,
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

  return { written, warnings };
}

async function upsertIngestionRun(env, row) {
  await env.META_ADS_DB.prepare(`
    INSERT INTO ingestion_runs (
      run_id, workflow_name, report_mode, report_date, requested_at, account_id,
      metrics_group_key, idempotency_key, status, entities_upserted, metric_snapshots_inserted,
      audit_rows_inserted, raw_payloads_written, raw_payload_rows_upserted,
      duplication_rows_upserted, warnings_count, duplication_count, last_error,
      request_headers_json, summary_json, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(idempotency_key) DO UPDATE SET
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
