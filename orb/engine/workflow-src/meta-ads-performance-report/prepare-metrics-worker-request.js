function safeString(value) {
  return value == null ? '' : String(value).trim();
}

function deepClone(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
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

function stableStringify(value) {
  if (Array.isArray(value)) {
    return '[' + value.map((entry) => stableStringify(entry)).join(',') + ']';
  }

  if (value && typeof value === 'object') {
    return '{' + Object.keys(value).sort().map((key) => JSON.stringify(key) + ':' + stableStringify(value[key])).join(',') + '}';
  }

  return JSON.stringify(value ?? null);
}

function hashString(value) {
  const input = safeString(value) || 'empty';
  let hash = 2166136261;

  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash +=
      (hash << 1) +
      (hash << 4) +
      (hash << 7) +
      (hash << 8) +
      (hash << 24);
  }

  return (hash >>> 0).toString(16).padStart(8, '0');
}

function buildIdempotencyKey(item) {
  const reportDate = safeString(item.report_date);
  const metricsGroupKey = safeString(item.metrics_group_key);
  const body = item.storage_plan?.worker?.body || item.requestBody || {};
  const fingerprint = hashString(stableStringify({
    report_date: reportDate,
    metrics_group_key: metricsGroupKey,
    entity_keys: (Array.isArray(body.entities) ? body.entities : []).map((entry) => safeString(entry.entity_key)).sort(),
    raw_payload_hashes: (Array.isArray(body.raw_payloads) ? body.raw_payloads : []).map((entry) => safeString(entry.payload_hash)).sort(),
    metric_snapshot_count: Array.isArray(body.metric_snapshots) ? body.metric_snapshots.length : 0,
    audit_keys: (Array.isArray(body.ingestion_audit) ? body.ingestion_audit : []).map((entry) => safeString(entry.audit_key)).sort(),
  }));
  return ['metrics_history', reportDate, metricsGroupKey, fingerprint].filter(Boolean).join(':');
}

const params = $('Meta API Params').first()?.json || {};

return $input.all().map((item) => {
  const json = deepClone(item.json || {});
  const worker = deepClone(json.storage_plan?.worker || {});
  const body = deepClone(worker.body || {});
  const entities = Array.isArray(body.entities) ? body.entities : [];
  const metricSnapshots = Array.isArray(body.metric_snapshots) ? body.metric_snapshots : [];
  const ingestionAudit = Array.isArray(body.ingestion_audit) ? body.ingestion_audit : [];

  const baseUrl = safeString(params.worker_base_url || params.cloudflare_worker_url || worker.url);
  const path = safeString(params.worker_persist_path || '/ingest/meta-ads-performance-report');
  const url = buildUrl(baseUrl, path);
  const authHeaderName = safeString(params.worker_auth_header || 'Authorization') || 'Authorization';
  const authScheme = safeString(params.worker_auth_scheme || 'Bearer') || 'Bearer';
  const workerApiToken = safeString(params.worker_api_token);
  const persistEnabled = entities.length > 0 && metricSnapshots.length > 0 && ingestionAudit.length > 0;
  const timeoutMs = Number(params.worker_timeout_ms || 120000);
  const reasons = [];

  if (!persistEnabled) reasons.push('payload analítico incompleto para persistência de métricas.');
  if (!url) reasons.push('META_ADS_REPORT_WORKER_BASE_URL não configurado.');
  if (!workerApiToken) reasons.push('META_ADS_REPORT_WORKER_API_TOKEN não configurado.');

  const idempotencyKey = buildIdempotencyKey(json);

  return {
    json: {
      ...json,
      persistence_scope: 'metrics_history',
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
        reason: 'Idempotency-Key obrigatório e upserts analíticos no Worker.',
      },
    },
    binary: item.binary || {},
  };
});
