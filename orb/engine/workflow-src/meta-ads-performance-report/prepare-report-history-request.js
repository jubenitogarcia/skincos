function safeString(value) {
  return value == null ? '' : String(value).trim();
}

function deepClone(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

function normalizeBaseUrl(value) {
  return safeString(value).replace(/\/+$/, '');
}

function normalizePath(value, fallback) {
  const normalized = safeString(value);
  const finalValue = normalized || fallback;
  return finalValue.startsWith('/') ? finalValue : `/${finalValue}`;
}

function buildUrl(baseUrl, path) {
  const normalizedBaseUrl = normalizeBaseUrl(baseUrl);
  const normalizedPath = normalizePath(path, '/ingest/meta-ads-performance-report');
  return normalizedBaseUrl ? `${normalizedBaseUrl}${normalizedPath}` : '';
}

function detectPersistenceScope(item, body) {
  const persistenceScope = safeString(item.persistence_scope);
  const category = safeString(item.category || 'all');
  const hasDeliveryAudit = !!item.delivery_history_payload?.delivery_audit ||
    !!body?.delivery_audit ||
    !!item.requestBody?.delivery_audit ||
    !!item.storage_plan?.worker?.body?.delivery_audit;
  const metricsGroupKey = safeString(
    item.metrics_group_key ||
    body?.run?.metrics_group_key ||
    item.requestBody?.run?.metrics_group_key ||
    item.storage_plan?.worker?.body?.run?.metrics_group_key
  );
  const entityKind = safeString(
    body?.entities?.[0]?.entity_kind ||
    item.requestBody?.entities?.[0]?.entity_kind ||
    item.storage_plan?.worker?.body?.entities?.[0]?.entity_kind
  );

  if (
    persistenceScope === 'delivery_history' ||
    hasDeliveryAudit ||
    metricsGroupKey.startsWith('report_delivery:') ||
    metricsGroupKey.startsWith('delivery_history:') ||
    entityKind === 'delivery_history'
  ) {
    return 'delivery_history';
  }

  return 'report_history';
}

function buildIdempotencyKey(scope, item) {
  const reportKey = safeString(item.report_key);
  const deliveryKey = safeString(item.delivery_key);
  const entityToken = safeString(item.delivery_entity?.ad_id || item.delivery_entity?.entity_id || item.delivery_entity?.creative_id);
  const category = safeString(item.category || 'all');
  if (reportKey) return [scope, reportKey].filter(Boolean).join(':');
  if (deliveryKey) return [scope, deliveryKey].filter(Boolean).join(':');
  return [
    scope,
    safeString(item.report_date),
    safeString(item.account_id),
    category,
    entityToken,
  ].filter(Boolean).join(':');
}

const params = $('Meta API Params').first()?.json || {};

return $input.all().map((item) => {
  const json = deepClone(item.json || {});
  const worker = deepClone(json.storage_plan?.worker || {});
  const body = deepClone(worker.body || {});

  const baseUrl = safeString(params.worker_base_url || params.cloudflare_worker_url || worker.url);
  const path = safeString(params.worker_persist_path || '/ingest/meta-ads-performance-report');
  const url = buildUrl(baseUrl, path);
  const authHeaderName = safeString(params.worker_auth_header || 'Authorization') || 'Authorization';
  const authScheme = safeString(params.worker_auth_scheme || 'Bearer') || 'Bearer';
  const workerApiToken = safeString(params.worker_api_token);
  const persistableCount =
    (Array.isArray(body.grouped_snapshots) ? body.grouped_snapshots.length : 0) +
    (Array.isArray(body.subjective_reviews) ? body.subjective_reviews.length : 0) +
    (body.consolidated_report ? 1 : 0) +
    (body.delivery_audit ? 1 : 0);
  const persistEnabled = persistableCount > 0 && body.run && typeof body.run === 'object';
  const timeoutMs = Number(params.worker_timeout_ms || 120000);
  const reasons = [];

  if (!persistEnabled) reasons.push('payload histórico de relatório não contém artefatos persistíveis.');
  if (!url) reasons.push('META_ADS_REPORT_WORKER_BASE_URL não configurado.');
  if (!workerApiToken) reasons.push('META_ADS_REPORT_WORKER_API_TOKEN não configurado.');

  const persistenceScope = detectPersistenceScope(json, body);
  const idempotencyKey = buildIdempotencyKey(persistenceScope, json);

  return {
    json: {
      ...json,
      persistence_scope: persistenceScope,
      persistence_ready: reasons.length === 0,
      persistence_enabled: persistEnabled,
      persistence_error: reasons.join(' '),
      persistence_target_url: url,
      persistence_method: 'POST',
      auth_header_name: authHeaderName,
      auth_scheme: authScheme,
      worker_api_token: workerApiToken,
      persistence_idempotency_key: idempotencyKey,
      requestHeaders: {
        'Content-Type': 'application/json',
        'Idempotency-Key': idempotencyKey,
        'X-Workflow-Environment': safeString(params.environment || 'local'),
        'X-Workflow-Run-Id': safeString(body.run?.run_id),
        'X-Report-Key': safeString(body.run?.report_key),
      },
      requestBody: body,
      requestTimeoutMs: Number.isFinite(timeoutMs) && timeoutMs > 0 ? timeoutMs : 120000,
      retryPolicy: {
        enabled: true,
        maxTries: 3,
        waitBetweenTriesMs: 5000,
        safe: true,
        reason: 'Idempotency-Key obrigatório e upserts via endpoint analítico live compatível.',
      },
    },
  };
});
