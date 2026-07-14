function safeString(value) {
  return value == null ? '' : String(value).trim();
}

function deepClone(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

function safeBoolean(value) {
  if (typeof value === 'boolean') return value;
  const normalized = safeString(value).toLowerCase();
  return ['true', '1', 'yes', 'sim', 'y'].includes(normalized);
}

function normalizeBaseUrl(value) {
  return safeString(value).replace(/\/+$/, '');
}

function normalizePath(value) {
  const normalized = safeString(value);
  if (!normalized) return '/ingest/meta-ads-performance-report';
  return normalized.startsWith('/') ? normalized : `/${normalized}`;
}

function buildUrl(baseUrl, path) {
  const normalizedBaseUrl = normalizeBaseUrl(baseUrl);
  const normalizedPath = normalizePath(path);
  return normalizedBaseUrl ? `${normalizedBaseUrl}${normalizedPath}` : '';
}

function buildIdempotencyKey(item) {
  const runId = safeString(item.run_context?.run_id);
  const metricsGroupKey = safeString(item.metrics_group_key);
  return [runId, metricsGroupKey].filter(Boolean).join(':');
}

const params = $('Params').first()?.json || {};

return $input.all().map((item) => {
  const json = deepClone(item.json || {});
  const storage = deepClone(json.storage_plan || {});
  const worker = deepClone(storage.worker || {});
  const body = deepClone(worker.body || {});
  const entities = Array.isArray(body.entities) ? body.entities : [];
  const metricSnapshots = Array.isArray(body.metric_snapshots) ? body.metric_snapshots : [];
  const ingestionAudit = Array.isArray(body.ingestion_audit) ? body.ingestion_audit : [];

  const baseUrl = safeString(params.worker_base_url || worker.url);
  const path = safeString(params.worker_persist_path || '/ingest/meta-ads-performance-report');
  const url = buildUrl(baseUrl, path);
  const authHeaderName = safeString(params.worker_auth_header || json.run_context?.storage?.cloudflare_worker_auth_header || 'Authorization') || 'Authorization';
  const authScheme = safeString(params.worker_auth_scheme || json.run_context?.storage?.cloudflare_worker_auth_scheme || 'Bearer') || 'Bearer';
  const persistEnabled = entities.length > 0 && metricSnapshots.length > 0 && ingestionAudit.length > 0;
  const timeoutMs = Number(params.worker_timeout_ms || params.worker_request_timeout_ms || 120000);
  const reasons = [];

  if (!persistEnabled) reasons.push('storage_plan.worker.body sem dados suficientes para persistência.');
  if (!url) reasons.push('META_ADS_REPORT_WORKER_BASE_URL não configurado.');

  const idempotencyKey = buildIdempotencyKey(json);

  return {
    json: {
      ...json,
      persistence_ready: reasons.length === 0,
      persistence_enabled: persistEnabled,
      persistence_error: reasons.join(' '),
      persistence_target_url: url,
      persistence_method: 'POST',
      auth_header_name: authHeaderName,
      auth_scheme: authScheme,
      idempotency_key: idempotencyKey,
      requestHeaders: {
        'Content-Type': 'application/json',
        'Idempotency-Key': idempotencyKey,
        'X-Workflow-Run-Id': safeString(json.run_context?.run_id),
        'X-Metrics-Group-Key': safeString(json.metrics_group_key),
        'X-Workflow-Environment': safeString(params.environment || 'local'),
      },
      requestBody: body,
      requestTimeoutMs: Number.isFinite(timeoutMs) && timeoutMs > 0 ? timeoutMs : 120000,
      retryPolicy: {
        enabled: true,
        maxTries: 3,
        waitBetweenTriesMs: 5000,
        safe: true,
        reason: 'Idempotency-Key obrigatório e upserts no Worker.',
      },
      worker_contract: {
        method: 'POST',
        endpoint: url,
        auth_header_name: authHeaderName,
        auth_scheme: authScheme,
        idempotency_key: idempotencyKey,
      },
    },
  };
});
