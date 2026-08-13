const MAX_BODY_BYTES = 32 * 1024;
const MAX_ACTIVE_REQUESTS = 8;
const MAX_REQUESTS_PER_MINUTE = 60;
const MAX_GRAPH_ACTIVE_REQUESTS = 8;
const MAX_GRAPH_REQUESTS_PER_MINUTE = 120;
const MAX_GRAPH_RESPONSE_BYTES = 64 * 1024;
const GRAPH_ORIGIN = 'https://graph.facebook.com';
const DEFAULT_GRAPH_VERSION = 'v20.0';
const GRAPH_TIMEOUT_MS = 10_000;

const OPERATIONS = new Set([
  'resolve_creator',
  'get_profile',
  'get_recent_media',
  'get_media_metrics',
  'get_comments_sample',
  'get_profile_metrics',
]);

const OPERATION_LIMITS = Object.freeze({
  resolve_creator: 1,
  get_profile: 1,
  get_recent_media: 50,
  get_media_metrics: 50,
  get_comments_sample: 10,
  get_profile_metrics: 1,
});

const GRAPH_FIELDS = Object.freeze({
  resolve_creator: Object.freeze(['id', 'username']),
  get_profile: Object.freeze(['username', 'followers_count', 'media_count']),
  get_recent_media: Object.freeze(['id', 'media_type', 'media_product_type', 'timestamp', 'permalink']),
  get_media_metrics: Object.freeze(['id', 'like_count', 'comments_count', 'views']),
  get_comments_sample: Object.freeze(['comments']),
  get_profile_metrics: Object.freeze(['username', 'followers_count', 'media_count']),
});

const REQUESTED_FIELDS = Object.freeze({
  resolve_creator: new Set(['username', 'id']),
  get_profile: new Set(['username', 'followers_count', 'media_count']),
  get_recent_media: new Set(['id', 'media_type', 'timestamp', 'media_product_type', 'permalink']),
  get_media_metrics: new Set(['id', 'like_count', 'comments_count', 'views']),
  get_comments_sample: new Set(['comments']),
  get_profile_metrics: new Set(['followers_count', 'media_count', 'insights', 'username']),
});

const FRESHNESS_MAX_AGE = Object.freeze({
  resolve_creator: 86_400,
  get_profile: 3_600,
  get_recent_media: 3_600,
  get_media_metrics: 3_600,
  get_comments_sample: 3_600,
  get_profile_metrics: 3_600,
});

const FALLBACK_CODES = new Set([
  'provider_unavailable',
  'permission_gap',
  'coverage_gap',
  'timeout',
]);

let activeRequests = 0;
const requestTimestamps = [];
let activeGraphRequests = 0;
const graphRequestTimestamps = [];

export class AnalyticsReadonlyError extends Error {
  constructor(code, status = 500) {
    super(code);
    this.name = 'AnalyticsReadonlyError';
    this.code = code;
    this.status = status;
  }
}

class GraphRequestError extends Error {
  constructor(code) {
    super(code);
    this.name = 'GraphRequestError';
    this.code = code;
  }
}

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function safeString(value) {
  return String(value ?? '').trim();
}

function boundedString(value, label, { maxLength = 160, required = true } = {}) {
  if (value === undefined || value === null || value === '') {
    if (required) throw new AnalyticsReadonlyError('invalid_request', 400);
    return undefined;
  }
  if (typeof value !== 'string') throw new AnalyticsReadonlyError('invalid_request', 400);
  const normalized = value.trim();
  if (!normalized || normalized.length > maxLength || /[\u0000-\u001f\u007f]/.test(normalized)) {
    throw new AnalyticsReadonlyError('invalid_request', 400);
  }
  return normalized;
}

function opaque(value, label) {
  const normalized = boundedString(value, label, { maxLength: 160 });
  if (!/^[A-Za-z0-9._:-]+$/.test(normalized)) throw new AnalyticsReadonlyError('invalid_request', 400);
  return normalized;
}

function normalizeHandle(value) {
  const normalized = boundedString(value, 'canonical_handle', { maxLength: 30 });
  const handle = normalized.replace(/^@/, '').toLowerCase();
  if (!/^[a-z0-9._]{1,30}$/.test(handle)) throw new AnalyticsReadonlyError('invalid_request', 400);
  return handle;
}

function isoTimestamp(value, fallback) {
  const source = value === undefined ? fallback : boundedString(value, 'timestamp', { maxLength: 40 });
  const date = new Date(source);
  if (Number.isNaN(date.getTime())) throw new AnalyticsReadonlyError('invalid_request', 400);
  return date.toISOString();
}

function boundedInteger(value, fallback, minimum, maximum) {
  const candidate = value === undefined ? fallback : Number(value);
  if (!Number.isInteger(candidate) || candidate < minimum || candidate > maximum) {
    throw new AnalyticsReadonlyError('invalid_request', 400);
  }
  return candidate;
}

function normalizeWindow(value) {
  if (value === undefined) return undefined;
  if (!isObject(value) || Object.keys(value).some((key) => !['start', 'end'].includes(key))) {
    throw new AnalyticsReadonlyError('invalid_request', 400);
  }
  const start = isoTimestamp(value.start, value.end || new Date().toISOString());
  const end = isoTimestamp(value.end, start);
  if (Date.parse(end) < Date.parse(start) || Date.parse(end) - Date.parse(start) > 365 * 86_400_000) {
    throw new AnalyticsReadonlyError('invalid_request', 400);
  }
  return Object.freeze({ start, end });
}

function normalizeList(value, label, maximum, itemNormalizer) {
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || value.length === 0 || value.length > maximum) {
    throw new AnalyticsReadonlyError('invalid_request', 400);
  }
  const items = value.map((item) => itemNormalizer(item, label));
  if (new Set(items).size !== items.length) throw new AnalyticsReadonlyError('invalid_request', 400);
  return Object.freeze(items);
}

function normalizeInput(body) {
  if (!isObject(body)) throw new AnalyticsReadonlyError('invalid_payload', 400);
  const allowedKeys = new Set([
    'provider',
    'operation',
    'credential_ref',
    'creator_key',
    'canonical_handle',
    'observed_at',
    'retrieved_at',
    'correlation_id',
    'window',
    'limit',
    'media_keys',
    'requested_fields',
    'metric_set',
  ]);
  if (Object.keys(body).some((key) => !allowedKeys.has(key))) {
    throw new AnalyticsReadonlyError('invalid_request', 400);
  }

  const provider = boundedString(body.provider, 'provider', { maxLength: 40 }).toLowerCase();
  const operation = boundedString(body.operation, 'operation', { maxLength: 40 });
  if (provider !== 'meta-graph' || !OPERATIONS.has(operation)) {
    throw new AnalyticsReadonlyError('invalid_request', 400);
  }

  const credentialRef = opaque(body.credential_ref, 'credential_ref');
  const creatorKey = body.creator_key === undefined ? undefined : opaque(body.creator_key, 'creator_key');
  const canonicalHandle = body.canonical_handle === undefined
    ? undefined
    : normalizeHandle(body.canonical_handle);
  if (operation === 'resolve_creator' && !canonicalHandle) {
    throw new AnalyticsReadonlyError('invalid_request', 400);
  }
  if (operation !== 'resolve_creator' && !creatorKey) {
    throw new AnalyticsReadonlyError('invalid_request', 400);
  }

  const now = new Date().toISOString();
  const observedAt = isoTimestamp(body.observed_at, now);
  const requestedRetrievedAt = isoTimestamp(body.retrieved_at, now);
  if (Date.parse(requestedRetrievedAt) < Date.parse(observedAt)) {
    throw new AnalyticsReadonlyError('invalid_request', 400);
  }

  const limit = boundedInteger(
    body.limit,
    Math.min(20, OPERATION_LIMITS[operation]),
    1,
    OPERATION_LIMITS[operation],
  );
  const mediaKeys = normalizeList(body.media_keys, 'media_keys', operation === 'get_comments_sample' ? 10 : 50, (item) => {
    const key = opaque(item, 'media_key');
    if (!/^\d{1,40}$/.test(key)) throw new AnalyticsReadonlyError('coverage_gap', 200);
    return key;
  });
  if ((operation === 'get_media_metrics' || operation === 'get_comments_sample') && !mediaKeys) {
    throw new AnalyticsReadonlyError('coverage_gap', 200);
  }

  const requestedFields = normalizeList(body.requested_fields, 'requested_fields', 64, (item) => {
    const field = boundedString(item, 'requested_field', { maxLength: 80 });
    if (!/^[a-z][a-z0-9_]*$/.test(field) || !REQUESTED_FIELDS[operation].has(field)) {
      throw new AnalyticsReadonlyError('invalid_request', 400);
    }
    return field;
  });
  const metricSet = normalizeList(body.metric_set, 'metric_set', 32, (item) => {
    const metric = boundedString(item, 'metric_set_item', { maxLength: 80 });
    if (!/^[a-z][a-z0-9_]*$/.test(metric)) throw new AnalyticsReadonlyError('invalid_request', 400);
    return metric;
  });
  const correlationId = opaque(
    body.correlation_id === undefined ? `ii:${operation}:${creatorKey || canonicalHandle || 'unresolved'}` : body.correlation_id,
    'correlation_id',
  );
  const window = normalizeWindow(body.window);

  return Object.freeze({
    provider,
    operation,
    credential_ref: credentialRef,
    ...(creatorKey ? { creator_key: creatorKey } : {}),
    ...(canonicalHandle ? { canonical_handle: canonicalHandle } : {}),
    observed_at: observedAt,
    requested_retrieved_at: requestedRetrievedAt,
    correlation_id: correlationId,
    ...(window ? { window } : {}),
    limit,
    ...(mediaKeys ? { media_keys: mediaKeys } : {}),
    ...(requestedFields ? { requested_fields: requestedFields } : {}),
    ...(metricSet ? { metric_set: metricSet } : {}),
  });
}

async function readBoundedJson(request) {
  const contentLength = Number(request.headers.get('content-length') || 0);
  if (Number.isInteger(contentLength) && contentLength > MAX_BODY_BYTES) {
    throw new AnalyticsReadonlyError('request_too_large', 413);
  }
  const text = request.body
    ? await readBoundedText(request.body, MAX_BODY_BYTES, () => new AnalyticsReadonlyError('request_too_large', 413))
    : await request.text();
  try {
    return JSON.parse(text);
  } catch {
    throw new AnalyticsReadonlyError('invalid_payload', 400);
  }
}

async function readBoundedText(body, maximumBytes, onExceeded) {
  const reader = body.getReader();
  const chunks = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      const chunk = value instanceof Uint8Array ? value : new Uint8Array(value);
      total += chunk.byteLength;
      if (total > maximumBytes) {
        await reader.cancel().catch(() => {});
        throw onExceeded();
      }
      chunks.push(chunk);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(bytes);
}

function acquireRequestLease() {
  const now = Date.now();
  while (requestTimestamps[0] !== undefined && requestTimestamps[0] <= now - 60_000) {
    requestTimestamps.shift();
  }
  if (activeRequests >= MAX_ACTIVE_REQUESTS || requestTimestamps.length >= MAX_REQUESTS_PER_MINUTE) {
    throw new GraphRequestError('provider_unavailable');
  }
  activeRequests += 1;
  requestTimestamps.push(now);
  return () => {
    activeRequests = Math.max(0, activeRequests - 1);
  };
}

function acquireGraphRequestLease() {
  const now = Date.now();
  while (graphRequestTimestamps[0] !== undefined && graphRequestTimestamps[0] <= now - 60_000) {
    graphRequestTimestamps.shift();
  }
  if (activeGraphRequests >= MAX_GRAPH_ACTIVE_REQUESTS || graphRequestTimestamps.length >= MAX_GRAPH_REQUESTS_PER_MINUTE) {
    throw new GraphRequestError('rate_limited');
  }
  activeGraphRequests += 1;
  graphRequestTimestamps.push(now);
  return () => {
    activeGraphRequests = Math.max(0, activeGraphRequests - 1);
  };
}

function graphVersion(env) {
  const version = safeString(env.META_GRAPH_VERSION) || DEFAULT_GRAPH_VERSION;
  if (!/^v\d+\.\d+$/.test(version)) throw new AnalyticsReadonlyError('invalid_configuration', 500);
  return version;
}

function graphUrl(version, pathSegments, params = {}) {
  const path = pathSegments.map((segment) => {
    if (segment !== 'comments' && !/^\d{1,40}$/.test(segment)) {
      throw new AnalyticsReadonlyError('coverage_gap', 200);
    }
    return segment;
  }).join('/');
  const url = new URL(`${GRAPH_ORIGIN}/${version}/${path}`);
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined) url.searchParams.set(key, String(value));
  }
  return url;
}

function graphErrorForStatus(status) {
  if (status === 401 || status === 403) return 'permission_gap';
  if (status === 404) return 'coverage_gap';
  if (status === 408 || status === 504) return 'timeout';
  if (status === 429) return 'rate_limited';
  if (status >= 500) return 'provider_unavailable';
  return 'invalid_response';
}

async function fetchGraphJson({ env, token, pathSegments, params, signal, fetchImpl }) {
  const releaseGraphRequest = acquireGraphRequestLease();
  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, GRAPH_TIMEOUT_MS);
  const abortParent = () => controller.abort();
  if (signal) {
    if (signal.aborted) abortParent();
    else signal.addEventListener('abort', abortParent, { once: true });
  }

  try {
    const response = await fetchImpl(graphUrl(graphVersion(env), pathSegments, params), {
      method: 'GET',
      headers: {
        accept: 'application/json',
        authorization: `Bearer ${token}`,
      },
      signal: controller.signal,
    });
    const status = Number(response.status || 200);
    if (status < 200 || status >= 300 || response.ok === false) {
      throw new GraphRequestError(graphErrorForStatus(status));
    }
    let payload;
    try {
      const contentLength = Number(response.headers?.get?.('content-length') || 0);
      if (Number.isInteger(contentLength) && contentLength > MAX_GRAPH_RESPONSE_BYTES) {
        throw new GraphRequestError('invalid_response');
      }
      const text = response.body
        ? await readBoundedText(response.body, MAX_GRAPH_RESPONSE_BYTES, () => new GraphRequestError('invalid_response'))
        : await response.text();
      payload = JSON.parse(text);
    } catch {
      throw new GraphRequestError('invalid_response');
    }
    if (!isObject(payload)) throw new GraphRequestError('invalid_response');
    return payload;
  } catch (error) {
    if (error instanceof GraphRequestError) throw error;
    if (timedOut || controller.signal.aborted || error?.name === 'AbortError') {
      throw new GraphRequestError('timeout');
    }
    throw new GraphRequestError('provider_unavailable');
  } finally {
    clearTimeout(timer);
    if (signal) signal.removeEventListener('abort', abortParent);
    releaseGraphRequest();
  }
}

function parseJsonObject(value) {
  try {
    const parsed = JSON.parse(value || '{}');
    return isObject(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

async function loadCredential(env, credentialRef) {
  if (!env.TOKEN_VAULT_DB) throw new GraphRequestError('provider_unavailable');
  try {
    return await env.TOKEN_VAULT_DB.prepare(
      `SELECT id, provider, unit, external_account_id, token_type, token_ciphertext,
              expires_at, active, metadata_json
         FROM credential_tokens
        WHERE id = ?`,
    ).bind(credentialRef).first();
  } catch {
    throw new GraphRequestError('provider_unavailable');
  }
}

function credentialAllowsAnalytics(row) {
  if (!row || row.provider !== 'instagram' || Number(row.active) !== 1) return false;
  if (!/^\d{1,40}$/.test(safeString(row.external_account_id))) return false;
  if (row.expires_at) {
    const expiresAt = Date.parse(row.expires_at);
    if (Number.isNaN(expiresAt) || expiresAt <= Date.now()) return false;
  }
  const metadata = parseJsonObject(row.metadata_json);
  return Array.isArray(metadata.analytics_scopes)
    && metadata.analytics_scopes.includes('influencer-intelligence');
}

function countValue(value) {
  return Number.isInteger(value) && value >= 0 ? value : undefined;
}

function textValue(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function discoveryRecord(payload) {
  if (isObject(payload.business_discovery)) return payload.business_discovery;
  return payload;
}

function connectionRecord(payload, handle) {
  const profile = handle ? discoveryRecord(payload) : payload;
  return isObject(profile?.media) ? profile.media : undefined;
}

function discoveryField(handle, nestedFields) {
  return `business_discovery.username(${handle}){${nestedFields.join(',')}}`;
}

function profileFields(handle) {
  return handle
    ? discoveryField(handle, ['id', 'username', 'followers_count', 'media_count'])
    : ['username', 'followers_count', 'media_count'].join(',');
}

function mediaFields(handle, limit) {
  const nested = `media.limit(${limit}){${GRAPH_FIELDS.get_recent_media.join(',')}}`;
  return handle ? discoveryField(handle, ['id', 'username', nested]) : nested;
}

function unavailableResult(input, code, fields, retrievedAt = new Date().toISOString(), extraLimitations = []) {
  const limitations = [...new Set([code, ...extraLimitations])].filter((item) => FALLBACK_CODES.has(item) || /^[a-z][a-z0-9_-]{0,79}$/.test(item));
  return {
    status: 'unavailable',
    provider: 'meta-graph',
    operation: input.operation,
    observed_at: input.observed_at,
    retrieved_at: retrievedAt,
    data_classification: 'observed',
    freshness: { max_age_seconds: FRESHNESS_MAX_AGE[input.operation] },
    limitations: limitations.length ? limitations : ['coverage_gap'],
    provider_specific_evidence: {
      adapter_version: 'token-vault-meta-graph-v1',
      source_ref: `meta-graph:${input.operation}`,
      fields,
      endpoint_family: 'instagram-graph-read-only',
      coverage_code: code,
      correlation_id: input.correlation_id,
    },
    data: null,
  };
}

function successResult(input, data, fields, retrievedAt = new Date().toISOString(), limitations = []) {
  return {
    status: 'ok',
    provider: 'meta-graph',
    operation: input.operation,
    observed_at: input.observed_at,
    retrieved_at: retrievedAt,
    data_classification: 'observed',
    freshness: { max_age_seconds: FRESHNESS_MAX_AGE[input.operation] },
    limitations: [...new Set(limitations)],
    provider_specific_evidence: {
      adapter_version: 'token-vault-meta-graph-v1',
      source_ref: `meta-graph:${input.operation}`,
      fields,
      endpoint_family: 'instagram-graph-read-only',
      correlation_id: input.correlation_id,
    },
    data,
  };
}

async function collectOperation({ input, row, token, env, signal, fetchImpl }) {
  const rootId = safeString(row.external_account_id);
  const handle = input.canonical_handle;
  const retrievedAt = new Date().toISOString();

  if (input.operation === 'resolve_creator') {
    const payload = await fetchGraphJson({
      env,
      token,
      pathSegments: [rootId],
      params: { fields: discoveryField(handle, ['id', 'username']) },
      signal,
      fetchImpl,
    });
    const profile = discoveryRecord(payload);
    const resolvedHandle = textValue(profile?.username);
    if (!resolvedHandle || !textValue(profile?.id)) return unavailableResult(input, 'coverage_gap', GRAPH_FIELDS.resolve_creator, retrievedAt);
    return successResult(input, {
      resolved: true,
      canonical_handle: normalizeHandle(resolvedHandle),
      match_type: 'business_discovery',
      confidence: 1,
    }, GRAPH_FIELDS.resolve_creator, retrievedAt);
  }

  if (input.operation === 'get_profile' || input.operation === 'get_profile_metrics') {
    const fields = profileFields(handle);
    const payload = await fetchGraphJson({
      env,
      token,
      pathSegments: [rootId],
      params: { fields },
      signal,
      fetchImpl,
    });
    const profile = discoveryRecord(payload);
    const data = {};
    const canonicalHandle = textValue(profile?.username);
    if (canonicalHandle && input.operation === 'get_profile') {
      data.canonical_handle = normalizeHandle(canonicalHandle);
    }
    for (const [rawKey, outputKey] of [
      ['followers_count', 'followers_count'],
      ['following_count', 'following_count'],
      ['media_count', 'media_count'],
    ]) {
      const count = countValue(profile?.[rawKey]);
      if (count !== undefined) data[outputKey] = count;
    }
    const metricFields = input.operation === 'get_profile_metrics'
      ? ['followers_count', 'media_count']
      : GRAPH_FIELDS.get_profile;
    const hasMetric = ['followers_count', 'following_count', 'media_count']
      .some((key) => data[key] !== undefined);
    if (!hasMetric) return unavailableResult(input, 'coverage_gap', metricFields, retrievedAt);
    return successResult(input, data, metricFields, retrievedAt, input.operation === 'get_profile_metrics'
      ? ['following_count_unavailable', 'engagement_metrics_unavailable']
      : []);
  }

  if (input.operation === 'get_recent_media') {
    const payload = await fetchGraphJson({
      env,
      token,
      pathSegments: [rootId],
      params: { fields: mediaFields(handle, input.limit) },
      signal,
      fetchImpl,
    });
    const connection = connectionRecord(payload, handle);
    if (!connection || !Array.isArray(connection.data)) return unavailableResult(input, 'coverage_gap', GRAPH_FIELDS.get_recent_media, retrievedAt);
    const data = connection.data.slice(0, input.limit).flatMap((item) => {
      if (!isObject(item) || !/^\d{1,40}$/.test(safeString(item.id))) return [];
      const media = {
        media_key: safeString(item.id),
        permalink_ref: `meta-graph:media:${safeString(item.id)}`,
      };
      const mediaKind = safeString(item.media_type || item.media_product_type).toLowerCase();
      if (mediaKind) media.media_kind = mediaKind;
      const publishedAt = textValue(item.timestamp);
      if (publishedAt && !Number.isNaN(Date.parse(publishedAt))) media.published_at = new Date(publishedAt).toISOString();
      return [media];
    });
    if (connection.data.length > 0 && data.length === 0) {
      throw new GraphRequestError('invalid_response');
    }
    return successResult(input, data, GRAPH_FIELDS.get_recent_media, retrievedAt, data.length < connection.data.length ? ['bounded_limit'] : []);
  }

  if (input.operation === 'get_media_metrics') {
    const results = [];
    const failures = [];
    for (let index = 0; index < input.media_keys.length; index += 4) {
      const batch = input.media_keys.slice(index, index + 4);
      const batchResults = await Promise.all(batch.map(async (mediaKey) => {
        try {
          const payload = await fetchGraphJson({
            env,
            token,
            pathSegments: [mediaKey],
            params: { fields: GRAPH_FIELDS.get_media_metrics.join(',') },
            signal,
            fetchImpl,
          });
          const item = { media_key: mediaKey };
          for (const [rawKey, outputKey] of [
            ['like_count', 'likes_count'],
            ['comments_count', 'comments_count'],
            ['views', 'views_count'],
          ]) {
            const count = countValue(payload[rawKey]);
            if (count !== undefined) item[outputKey] = count;
          }
          if (Object.keys(item).length === 1) throw new GraphRequestError('coverage_gap');
          return { item };
        } catch (error) {
          return { error: error instanceof GraphRequestError ? error.code : 'provider_unavailable' };
        }
      }));
      for (const result of batchResults) {
        if (result.item) results.push(result.item);
        else failures.push(result.error);
      }
    }
    const terminalFailure = failures.find((code) => code === 'invalid_response' || code === 'rate_limited');
    if (terminalFailure) {
      throw new GraphRequestError(terminalFailure);
    }
    if (failures.length > 0 && results.length > 0) {
      return successResult(input, results, GRAPH_FIELDS.get_media_metrics, retrievedAt, ['partial_coverage']);
    }
    if (failures.length > 0) {
      const primary = failures.find((code) => FALLBACK_CODES.has(code)) || 'coverage_gap';
      return unavailableResult(input, primary, GRAPH_FIELDS.get_media_metrics, retrievedAt, ['partial_coverage']);
    }
    return successResult(input, results, GRAPH_FIELDS.get_media_metrics, retrievedAt);
  }

  if (input.operation === 'get_comments_sample') {
    let commentCount = 0;
    let sampleSize = 0;
    const failures = [];
    for (let index = 0; index < input.media_keys.length; index += 2) {
      const batch = input.media_keys.slice(index, index + 2);
      const batchResults = await Promise.all(batch.map(async (mediaKey) => {
        try {
          const payload = await fetchGraphJson({
            env,
            token,
            pathSegments: [mediaKey, 'comments'],
            params: { fields: 'id', limit: input.limit },
            signal,
            fetchImpl,
          });
          if (!Array.isArray(payload.data)) throw new GraphRequestError('coverage_gap');
          const values = payload.data.filter((item) => isObject(item) && textValue(item.id));
          if (payload.data.length > 0 && values.length === 0) throw new GraphRequestError('invalid_response');
          const total = countValue(payload.summary?.total_count);
          return { count: total === undefined ? values.length : total, sample: values.length };
        } catch (error) {
          return { error: error instanceof GraphRequestError ? error.code : 'provider_unavailable' };
        }
      }));
      for (const result of batchResults) {
        if (result.error) failures.push(result.error);
        else {
          commentCount += result.count;
          sampleSize += result.sample;
        }
      }
    }
    const terminalFailure = failures.find((code) => code === 'invalid_response' || code === 'rate_limited');
    if (terminalFailure) {
      throw new GraphRequestError(terminalFailure);
    }
    if (failures.length > 0 && (commentCount > 0 || sampleSize > 0)) {
      return successResult(input, [{
        comment_count: commentCount,
        sample_size: sampleSize,
      }], GRAPH_FIELDS.get_comments_sample, retrievedAt, ['partial_coverage', 'raw_comment_text_not_returned']);
    }
    if (failures.length > 0) {
      const primary = failures.find((code) => FALLBACK_CODES.has(code)) || 'coverage_gap';
      return unavailableResult(input, primary, GRAPH_FIELDS.get_comments_sample, retrievedAt, ['partial_coverage', 'raw_comment_text_not_returned']);
    }
    return successResult(input, [{
      comment_count: commentCount,
      sample_size: sampleSize,
    }], GRAPH_FIELDS.get_comments_sample, retrievedAt, ['raw_comment_text_not_returned']);
  }

  throw new AnalyticsReadonlyError('invalid_request', 400);
}

function errorStatus(code) {
  if (code === 'request_too_large') return 413;
  if (code === 'permission_gap') return 403;
  if (code === 'coverage_gap') return 200;
  if (code === 'timeout') return 504;
  if (code === 'provider_unavailable') return 502;
  if (code === 'invalid_response') return 502;
  if (code === 'rate_limited') return 429;
  if (code === 'missing_worker_secret') return 500;
  if (code === 'invalid_configuration') return 500;
  return 400;
}

function responseJson(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
    },
  });
}

async function audit(writeAudit, env, input, row, status, requestId, metadata = {}) {
  if (typeof writeAudit !== 'function') return;
  const credentialRefState = row?.id
    ? 'matched'
    : (input?.credential_ref ? 'unmatched' : 'not_provided');
  await writeAudit(env, {
    // credential_token_audit.token_id is a foreign key. An unresolved,
    // caller-controlled reference must remain auditable without converting a
    // deliberate 403 permission_gap into an internal error.
    tokenId: row?.id || null,
    event: 'analytics.meta_graph.operation',
    provider: 'meta-graph',
    unit: row?.unit,
    tokenType: row?.token_type,
    status,
    requestId,
    metadata: {
      scope: 'influencer-intelligence',
      operation: input?.operation || null,
      correlation_id: input?.correlation_id || null,
      credential_ref_state: credentialRefState,
      endpoint_family: 'instagram-graph-read-only',
      ...(input?.limit !== undefined ? { limit: input.limit } : {}),
      ...metadata,
    },
  });
}

export async function handleAnalyticsReadonlyRequest({ request, env, requestId, decryptToken, writeAudit }) {
  let release;
  let input;
  let row;
  let audited = false;
  try {
    input = normalizeInput(await readBoundedJson(request));
    release = acquireRequestLease();
    row = await loadCredential(env, input.credential_ref);
    if (!credentialAllowsAnalytics(row)) {
      await audit(writeAudit, env, input, row, 'permission_gap', requestId, { code: 'permission_gap' });
      audited = true;
      return responseJson({ ok: false, error: 'permission_gap', requestId }, 403);
    }
    if (typeof decryptToken !== 'function') throw new GraphRequestError('provider_unavailable');
    const fetchImpl = typeof env.ANALYTICS_FETCH === 'function' ? env.ANALYTICS_FETCH : globalThis.fetch;
    if (typeof fetchImpl !== 'function') throw new GraphRequestError('provider_unavailable');
    const token = await decryptToken(row.token_ciphertext, env);
    if (!token || token.length > 4096) throw new GraphRequestError('provider_unavailable');
    const result = await collectOperation({
      input,
      row,
      token,
      env,
      signal: request.signal,
      fetchImpl,
    });
    await audit(writeAudit, env, input, row, result.status === 'ok' ? 'ok' : result.limitations[0], requestId, {
      code: result.status === 'ok' ? null : result.limitations[0],
      fields: result.provider_specific_evidence.fields,
    });
    audited = true;
    return responseJson({
      ok: true,
      contract_version: 'influencer-intelligence/token-vault-analytics/v1',
      result,
      requestId,
    });
  } catch (error) {
    const code = error instanceof AnalyticsReadonlyError || error instanceof GraphRequestError
      ? error.code
      : 'provider_unavailable';
    if (!audited) {
      try {
        await audit(writeAudit, env, input, row, code, requestId, { code });
      } catch {
        return responseJson({ ok: false, error: 'internal_error', requestId }, 500);
      }
    }
    if ((code === 'coverage_gap' || code === 'permission_gap') && input) {
      const result = unavailableResult(input, code, GRAPH_FIELDS[input.operation] || [], new Date().toISOString());
      return responseJson({
        ok: true,
        contract_version: 'influencer-intelligence/token-vault-analytics/v1',
        result,
        requestId,
      });
    }
    return responseJson({ ok: false, error: code, requestId }, errorStatus(code));
  } finally {
    if (release) release();
  }
}
