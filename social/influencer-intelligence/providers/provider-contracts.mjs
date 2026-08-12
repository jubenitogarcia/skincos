import {
  assertNoSensitiveFields,
  normalizeCanonicalHandle,
  normalizeCreatorKey,
} from '../contracts.mjs';

/**
 * Provider operations are deliberately transport-neutral. An adapter may use
 * Meta Graph, the existing social/instagram read path, or a future approved
 * provider, but the router only sees these normalized operation names.
 */
export const PROVIDER_OPERATIONS = Object.freeze([
  'resolve_creator',
  'get_profile',
  'get_recent_media',
  'get_media_metrics',
  'get_comments_sample',
  'get_profile_metrics',
]);

export const DATA_CLASSIFICATIONS = Object.freeze(['observed', 'derived', 'inferred']);

export const FRESHNESS_STATUSES = Object.freeze(['fresh', 'stale', 'unknown']);

export const PROVIDER_FALLBACK_CODES = Object.freeze([
  'provider_unavailable',
  'permission_gap',
  'coverage_gap',
  'timeout',
  'circuit_open',
  'retry_exhausted',
]);

export const PROVIDER_RETRYABLE_CODES = Object.freeze([
  'provider_unavailable',
  'transport_error',
  'timeout',
  'rate_limited',
]);

export const PROVIDER_TERMINAL_CODES = Object.freeze([
  'policy_block',
  'invalid_response',
  'unclassified_transport',
]);

export const PROVIDER_OPERATION_CONTRACT_VERSION =
  'influencer-intelligence/provider-operation/v1.1';

const operationSet = new Set(PROVIDER_OPERATIONS);
const classificationSet = new Set(DATA_CLASSIFICATIONS);
const freshnessSet = new Set(FRESHNESS_STATUSES);
const fallbackCodeSet = new Set(PROVIDER_FALLBACK_CODES);
const slugPattern = /^[a-z][a-z0-9._-]{0,79}$/;
const opaquePattern = /^[A-Za-z0-9._:-]{1,160}$/;
const sourceRefPattern = /^[A-Za-z0-9._:/-]{1,240}$/;
const COUNT_KEYS = new Set([
  'followers_count',
  'following_count',
  'media_count',
  'likes_count',
  'comments_count',
  'shares_count',
  'saves_count',
  'views_count',
  'reach_count',
  'impressions_count',
  'comment_count',
  'sample_size',
]);

const OPERATION_LIMITS = Object.freeze({
  resolve_creator: 1,
  get_profile: 1,
  get_recent_media: 50,
  get_media_metrics: 50,
  get_comments_sample: 100,
  get_profile_metrics: 1,
});

const OPERATION_DATA_KEYS = Object.freeze({
  resolve_creator: new Set(['resolved', 'canonical_handle', 'match_type', 'confidence']),
  get_profile: new Set([
    'canonical_handle',
    'followers_count',
    'following_count',
    'media_count',
    'is_private',
    'is_verified',
  ]),
  get_recent_media: new Set(['media_key', 'media_kind', 'published_at', 'permalink_ref']),
  get_media_metrics: new Set([
    'media_key',
    'likes_count',
    'comments_count',
    'shares_count',
    'saves_count',
    'views_count',
    'reach_count',
    'impressions_count',
    'engagement_rate',
  ]),
  get_comments_sample: new Set([
    'topic_key',
    'language_code',
    'sentiment_label',
    'safety_label',
    'comment_count',
    'sample_size',
    'spam_ratio',
    'sentiment_score',
    'model_version',
  ]),
  get_profile_metrics: new Set([
    'followers_count',
    'following_count',
    'media_count',
    'engagement_rate',
    'average_likes',
    'average_comments',
    'posting_frequency',
  ]),
});

export class ProviderContractError extends Error {
  constructor(code, message = code) {
    super(message);
    this.name = 'ProviderContractError';
    this.code = code;
    this.reasonCode = code;
  }
}

function isRecord(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function deepFreeze(value, seen = new Set()) {
  if (!value || typeof value !== 'object' || seen.has(value)) return value;
  seen.add(value);
  for (const child of Object.values(value)) deepFreeze(child, seen);
  return Object.freeze(value);
}

function fail(code, message = code) {
  throw new ProviderContractError(code, message);
}

function protect(value, label) {
  try {
    assertNoSensitiveFields(value, label);
  } catch {
    fail('policy_block');
  }
}

function normalizedString(value, label, { maxLength = 160, required = true } = {}) {
  if (value === undefined || value === null || value === '') {
    if (required) fail('invalid_request', `${label} is required`);
    return undefined;
  }
  if (typeof value !== 'string') fail('invalid_request', `${label} must be a string`);
  const result = value.trim();
  if (!result && required) fail('invalid_request', `${label} must not be empty`);
  if (result.length > maxLength || /[\u0000-\u001f\u007f]/.test(result)) {
    fail('invalid_request', `${label} is not bounded`);
  }
  return result || undefined;
}

function slug(value, label, { maxLength = 80 } = {}) {
  const result = normalizedString(value, label, { maxLength });
  if (!slugPattern.test(result)) fail('invalid_request', `${label} must be a lowercase slug`);
  return result;
}

function opaque(value, label) {
  const result = normalizedString(value, label, { maxLength: 160 });
  if (!opaquePattern.test(result)) fail('invalid_request', `${label} must be opaque`);
  return result;
}

function timestamp(value, label, fallback) {
  const source = value === undefined ? fallback : value;
  const result = normalizedString(source, label, { maxLength: 40 });
  const parsed = new Date(result);
  if (Number.isNaN(parsed.getTime())) fail('invalid_request', `${label} must be an ISO timestamp`);
  return parsed.toISOString();
}

function alias(input, snake, camel) {
  if (input[snake] !== undefined && input[camel] !== undefined && input[snake] !== input[camel]) {
    fail('invalid_request', `${snake} and ${camel} disagree`);
  }
  return input[snake] !== undefined ? input[snake] : input[camel];
}

function normalizeWindow(value) {
  if (value === undefined) return undefined;
  if (!isRecord(value)) fail('invalid_request', 'window must be an object');
  protect(value, 'providerRequest.window');
  const start = alias(value, 'start', 'windowStart');
  const end = alias(value, 'end', 'windowEnd');
  if (start === undefined && end === undefined) fail('invalid_request', 'window is empty');
  const normalizedStart = timestamp(start, 'window.start', end || new Date().toISOString());
  const normalizedEnd = timestamp(end, 'window.end', normalizedStart);
  const startMs = Date.parse(normalizedStart);
  const endMs = Date.parse(normalizedEnd);
  if (endMs < startMs || endMs - startMs > 365 * 24 * 60 * 60 * 1000) {
    fail('invalid_request', 'window must be ordered and at most 365 days');
  }
  return Object.freeze({ start: normalizedStart, end: normalizedEnd });
}

function normalizeList(value, label, { maxItems, itemNormalizer }) {
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || value.length > maxItems) fail('invalid_request', `${label} is not bounded`);
  const items = value.map((item, index) => itemNormalizer(item, `${label}[${index}]`));
  if (new Set(items).size !== items.length) fail('invalid_request', `${label} must be unique`);
  return Object.freeze(items);
}

function nowIso(now) {
  const value = typeof now === 'function' ? now() : now;
  const date = value instanceof Date ? value : new Date(value === undefined ? Date.now() : value);
  if (Number.isNaN(date.getTime())) fail('invalid_request', 'clock returned an invalid timestamp');
  return date.toISOString();
}

export function normalizeProviderOperation(value) {
  if (typeof value !== 'string' || !operationSet.has(value)) {
    fail('invalid_request', 'unsupported provider operation');
  }
  return value;
}

export function normalizeProviderSlug(value, label = 'provider') {
  return slug(value, label);
}

export function normalizeProviderRequest(input, operation, { now = Date.now } = {}) {
  if (!isRecord(input)) fail('invalid_request', 'provider request must be an object');
  protect(input, 'providerRequest');
  const normalizedOperation = normalizeProviderOperation(operation);
  if (input.operation !== undefined && normalizeProviderOperation(input.operation) !== normalizedOperation) {
    fail('operation_mismatch', 'request operation does not match the invoked operation');
  }
  const allowed = new Set([
    'operation',
    'creatorKey',
    'creator_key',
    'handle',
    'canonicalHandle',
    'canonical_handle',
    'observedAt',
    'observed_at',
    'retrievedAt',
    'retrieved_at',
    'correlationId',
    'correlation_id',
    'window',
    'limit',
    'mediaKeys',
    'media_keys',
    'metricSet',
    'metric_set',
    'requestedFields',
    'requested_fields',
  ]);
  if (Object.keys(input).some((key) => !allowed.has(key))) {
    fail('invalid_request', 'provider request contains an unsupported field');
  }

  const creatorKeyValue = alias(input, 'creator_key', 'creatorKey');
  const handleValue = input.canonical_handle ?? input.canonicalHandle ?? input.handle;
  let creatorKey;
  let handle;
  try {
    creatorKey = creatorKeyValue === undefined ? undefined : normalizeCreatorKey(creatorKeyValue);
    handle = handleValue === undefined ? undefined : normalizeCanonicalHandle(handleValue);
  } catch {
    fail('invalid_request', 'creator identity is invalid');
  }
  if (normalizedOperation === 'resolve_creator' && !handle) {
    fail('invalid_request', 'resolve_creator requires a canonical handle');
  }
  if (normalizedOperation !== 'resolve_creator' && !creatorKey) {
    fail('invalid_request', `${normalizedOperation} requires creator_key`);
  }

  const observedAt = timestamp(alias(input, 'observed_at', 'observedAt'), 'observed_at', nowIso(now));
  const retrievedAt = timestamp(alias(input, 'retrieved_at', 'retrievedAt'), 'retrieved_at', nowIso(now));
  if (Date.parse(retrievedAt) < Date.parse(observedAt)) {
    fail('invalid_request', 'retrieved_at must not precede observed_at');
  }

  const rawLimit = input.limit === undefined ? Math.min(20, OPERATION_LIMITS[normalizedOperation]) : input.limit;
  if (!Number.isInteger(rawLimit) || rawLimit < 1 || rawLimit > OPERATION_LIMITS[normalizedOperation]) {
    fail('invalid_request', 'limit is outside the operation bound');
  }
  const correlationId = normalizedString(
    alias(input, 'correlation_id', 'correlationId'),
    'correlation_id',
    { maxLength: 160, required: false },
  ) || `ii:${normalizedOperation}:${creatorKey || handle}`;
  const mediaKeys = normalizeList(
    alias(input, 'media_keys', 'mediaKeys'),
    'media_keys',
    { maxItems: OPERATION_LIMITS.get_media_metrics, itemNormalizer: opaque },
  );
  const metricSet = normalizeList(
    alias(input, 'metric_set', 'metricSet'),
    'metric_set',
    { maxItems: 32, itemNormalizer: slug },
  );
  const requestedFields = normalizeList(
    alias(input, 'requested_fields', 'requestedFields'),
    'requested_fields',
    { maxItems: 64, itemNormalizer: slug },
  );
  if (normalizedOperation === 'get_media_metrics' && (!mediaKeys || mediaKeys.length === 0)) {
    fail('invalid_request', 'get_media_metrics requires media_keys');
  }

  const window = normalizeWindow(input.window);

  return deepFreeze({
    operation: normalizedOperation,
    ...(creatorKey ? { creator_key: creatorKey } : {}),
    ...(handle ? { canonical_handle: handle } : {}),
    observed_at: observedAt,
    retrieved_at: retrievedAt,
    correlation_id: correlationId,
    ...(window ? { window } : {}),
    limit: rawLimit,
    ...(mediaKeys ? { media_keys: mediaKeys } : {}),
    ...(metricSet ? { metric_set: metricSet } : {}),
    ...(requestedFields ? { requested_fields: requestedFields } : {}),
  });
}

function camelToSnake(value) {
  return value.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`);
}

function unwrapData(operation, value) {
  if (!isRecord(value)) return value;
  const wrapper = {
    resolve_creator: 'creator',
    get_profile: 'profile',
    get_recent_media: 'media',
    get_media_metrics: 'metrics',
    get_comments_sample: 'samples',
    get_profile_metrics: 'metrics',
  }[operation];
  if (wrapper && value[wrapper] !== undefined) return value[wrapper];
  return value;
}

function scalar(value, key) {
  if (value === null) return null;
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) fail('invalid_response', `${key} must be finite`);
    if (COUNT_KEYS.has(key) && (!Number.isInteger(value) || value < 0)) {
      fail('invalid_response', `${key} must be a non-negative integer`);
    }
    if (key === 'confidence' && (value < 0 || value > 1)) fail('invalid_response', `${key} is outside a safe range`);
    if (key.endsWith('_ratio') && (value < 0 || value > 1)) fail('invalid_response', `${key} is outside a safe range`);
    if (key === 'sentiment_score' && (value < -1 || value > 1)) fail('invalid_response', `${key} is outside a safe range`);
    if (key.endsWith('_rate') && (value < 0 || value > 100)) fail('invalid_response', `${key} is outside a safe range`);
    return Number(value.toFixed(6));
  }
  if (typeof value === 'string') {
    if (value.length > 240 || /[\u0000-\u001f\u007f]/.test(value)) fail('invalid_response');
    return value.trim();
  }
  fail('invalid_response', `${key} must be scalar`);
}

function normalizeDataObject(operation, value) {
  const raw = unwrapData(operation, value);
  const allowed = OPERATION_DATA_KEYS[operation];
  if (!isRecord(raw)) fail('invalid_response', `${operation} data must be an object`);
  const result = {};
  for (const [rawKey, rawValue] of Object.entries(raw)) {
    const key = camelToSnake(rawKey);
    if (!allowed.has(key)) fail('invalid_response', `${operation} returned an unsupported field`);
    if (result[key] !== undefined) fail('invalid_response', `${operation} returned duplicate fields`);
    if (key === 'canonical_handle') {
      try {
        result[key] = rawValue === null ? null : normalizeCanonicalHandle(rawValue);
      } catch {
        fail('invalid_response', 'canonical_handle is invalid');
      }
    } else if (key === 'media_key') {
      result[key] = rawValue === null ? null : opaque(rawValue, 'media_key');
    } else if (key === 'permalink_ref') {
      const ref = normalizedString(rawValue, 'permalink_ref', { maxLength: 240 });
      if (!sourceRefPattern.test(ref)) fail('policy_block', 'permalink_ref must be opaque');
      result[key] = ref;
    } else if (key === 'published_at') {
      result[key] = rawValue === null ? null : timestamp(rawValue, 'published_at');
    } else if (key === 'topic_key' || key === 'match_type' || key === 'language_code' || key === 'sentiment_label' || key === 'safety_label' || key === 'model_version' || key === 'media_kind') {
      result[key] = rawValue === null ? null : slug(rawValue, key);
    } else if (key === 'resolved' || key === 'is_private' || key === 'is_verified') {
      if (rawValue !== null && typeof rawValue !== 'boolean') fail('invalid_response', `${key} must be boolean`);
      result[key] = rawValue;
    } else {
      result[key] = scalar(rawValue, key);
    }
  }
  return deepFreeze(result);
}

function normalizeData(operation, value) {
  const raw = unwrapData(operation, value);
  const collectionOperations = new Set(['get_recent_media', 'get_media_metrics', 'get_comments_sample']);
  if (!collectionOperations.has(operation)) return normalizeDataObject(operation, raw);
  const items = Array.isArray(raw)
    ? raw
    : isRecord(raw) && Array.isArray(raw.items)
      ? raw.items
      : isRecord(raw) && Array.isArray(raw.media)
        ? raw.media
        : isRecord(raw) && Array.isArray(raw.metrics)
          ? raw.metrics
          : isRecord(raw) && Array.isArray(raw.samples)
            ? raw.samples
            : null;
  if (!items || items.length > OPERATION_LIMITS[operation]) fail('invalid_response', `${operation} data must be a bounded array`);
  return deepFreeze(items.map((item) => normalizeDataObject(operation, item)));
}

function normalizeLimitations(value, status) {
  if (value === undefined) return status === 'unavailable' ? Object.freeze(['coverage_gap']) : Object.freeze([]);
  if (!Array.isArray(value) || value.length > 16) fail('invalid_response', 'limitations must be bounded');
  const values = value.map((item) => slug(item, 'limitation', { maxLength: 80 }));
  if (status === 'unavailable' && values.length === 0) values.push('coverage_gap');
  return Object.freeze([...new Set(values)]);
}

function normalizeEvidence(value, { provider, operation, request, adapterVersion, sourceRef }) {
  const input = value === undefined ? {} : value;
  if (!isRecord(input)) fail('invalid_response', 'provider_specific_evidence must be an object');
  protect(input, 'providerSpecificEvidence');
  const allowed = new Set([
    'adapter_version',
    'adapterVersion',
    'source_ref',
    'sourceRef',
    'fields',
    'observed_fields',
    'endpoint_family',
    'coverage_code',
    'model_version',
    'modelVersion',
    'provider',
    'operation',
    'correlation_id',
  ]);
  if (Object.keys(input).some((key) => !allowed.has(key))) fail('policy_block', 'provider-specific evidence is not bounded');
  if (input.provider !== undefined && input.provider !== provider) {
    fail('invalid_response', 'provider-specific evidence provider mismatch');
  }
  if (input.operation !== undefined && input.operation !== operation) {
    fail('invalid_response', 'provider-specific evidence operation mismatch');
  }
  if (input.correlation_id !== undefined && input.correlation_id !== request.correlation_id) {
    fail('invalid_response', 'provider-specific evidence correlation mismatch');
  }
  const evidence = {
    adapter_version: slug(input.adapter_version ?? input.adapterVersion ?? adapterVersion, 'adapter_version'),
    source_ref: input.source_ref ?? input.sourceRef ?? sourceRef,
  };
  if (!sourceRefPattern.test(evidence.source_ref)) fail('policy_block', 'source_ref is not opaque');
  const fields = input.fields || input.observed_fields;
  if (fields !== undefined) {
    evidence.fields = normalizeList(fields, 'provider_specific_evidence.fields', { maxItems: 64, itemNormalizer: slug });
  }
  if (input.endpoint_family !== undefined) evidence.endpoint_family = slug(input.endpoint_family, 'endpoint_family');
  if (input.coverage_code !== undefined) evidence.coverage_code = slug(input.coverage_code, 'coverage_code');
  const modelVersion = input.model_version ?? input.modelVersion;
  if (modelVersion !== undefined) {
    let normalizedModelVersion;
    try {
      normalizedModelVersion = normalizedString(modelVersion, 'provider_specific_evidence.model_version', { maxLength: 80 });
    } catch {
      fail('invalid_response', 'provider model version is malformed');
    }
    if (!/^[a-z][a-z0-9._/-]{0,79}$/.test(normalizedModelVersion)) fail('invalid_response', 'provider model version is invalid');
    evidence.model_version = normalizedModelVersion;
  }
  evidence.provider = provider;
  evidence.operation = operation;
  evidence.correlation_id = request.correlation_id;
  return deepFreeze(evidence);
}

function normalizeFreshness(value, observedAt, retrievedAt) {
  const raw = value === undefined ? {} : value;
  if (!isRecord(raw)) fail('invalid_response', 'freshness must be an object');
  protect(raw, 'freshness');
  const maxAge = raw.max_age_seconds ?? raw.maxAgeSeconds ?? 86400;
  if (!Number.isInteger(maxAge) || maxAge < 0 || maxAge > 315360000) fail('invalid_response', 'freshness max age is invalid');
  const age = observedAt ? Math.max(0, Math.floor((Date.parse(retrievedAt) - Date.parse(observedAt)) / 1000)) : null;
  const status = age === null ? 'unknown' : age <= maxAge ? 'fresh' : 'stale';
  if (!freshnessSet.has(status)) fail('invalid_response');
  return deepFreeze({
    status,
    observed_at: observedAt || null,
    retrieved_at: retrievedAt,
    age_seconds: age,
    max_age_seconds: maxAge,
  });
}

export function normalizeProviderCandidate({
  operation,
  provider,
  request,
  candidate,
  adapterVersion = 'provider-adapter/v1',
  sourceRef,
} = {}) {
  const normalizedOperation = normalizeProviderOperation(operation);
  const normalizedProvider = normalizeProviderSlug(provider);
  if (!isRecord(candidate)) fail('invalid_response', 'provider candidate must be an object');
  protect(candidate, 'providerCandidate');
  if (candidate.contract_version !== undefined && candidate.contract_version !== PROVIDER_OPERATION_CONTRACT_VERSION) {
    fail('invalid_response', 'provider contract version is unsupported');
  }
  if (candidate.operation !== undefined && candidate.operation !== normalizedOperation) {
    fail('invalid_response', 'provider candidate operation mismatch');
  }
  if (candidate.provider !== undefined && candidate.provider !== normalizedProvider) {
    fail('invalid_response', 'provider candidate provider mismatch');
  }
  const dataEnvelope = Object.prototype.hasOwnProperty.call(candidate, 'data');
  const rawData = dataEnvelope ? candidate.data : candidate;
  const requestedStatus = candidate.status;
  if (requestedStatus !== undefined && requestedStatus !== 'ok' && requestedStatus !== 'unavailable') {
    fail('invalid_response', 'provider status is invalid');
  }
  const status = requestedStatus || (rawData === null ? 'unavailable' : 'ok');
  const observedAt = timestamp(
    candidate.observed_at ?? candidate.observedAt ?? candidate.freshness?.observed_at,
    'observed_at',
    request.observed_at,
  );
  const retrievedAt = timestamp(
    candidate.retrieved_at ?? candidate.retrievedAt ?? candidate.freshness?.retrieved_at,
    'retrieved_at',
    request.retrieved_at,
  );
  if (Date.parse(retrievedAt) < Date.parse(observedAt)) fail('invalid_response', 'provider timestamps are reversed');
  const dataClassification = candidate.data_classification ?? candidate.dataClassification ?? 'observed';
  if (!classificationSet.has(dataClassification)) fail('invalid_response', 'data_classification is invalid');
  const data = status === 'unavailable' ? null : normalizeData(normalizedOperation, rawData);
  const limitations = normalizeLimitations(candidate.limitations, status);
  const evidence = normalizeEvidence(
    candidate.provider_specific_evidence ?? candidate.providerSpecificEvidence,
    {
      provider: normalizedProvider,
      operation: normalizedOperation,
      request,
      adapterVersion,
      sourceRef: sourceRef || `${normalizedProvider}:${normalizedOperation}:${request.creator_key || 'unresolved'}`,
    },
  );
  if (dataClassification === 'inferred' && !evidence.model_version) {
    fail('invalid_response', 'inferred provider data requires model version evidence');
  }
  return deepFreeze({
    contract_version: PROVIDER_OPERATION_CONTRACT_VERSION,
    operation: normalizedOperation,
    status,
    provider: normalizedProvider,
    retrieved_at: retrievedAt,
    data_classification: dataClassification,
    freshness: normalizeFreshness(candidate.freshness, observedAt, retrievedAt),
    limitations,
    provider_specific_evidence: evidence,
    data,
  });
}

export function unavailableProviderResult({ operation, retrievedAt, limitations = [], provider = null } = {}) {
  const normalizedOperation = normalizeProviderOperation(operation);
  const normalizedRetrievedAt = timestamp(retrievedAt, 'retrieved_at', new Date().toISOString());
  const safeLimitations = normalizeLimitations(limitations, 'unavailable');
  return deepFreeze({
    contract_version: PROVIDER_OPERATION_CONTRACT_VERSION,
    operation: normalizedOperation,
    status: 'unavailable',
    provider: provider === null ? null : normalizeProviderSlug(provider),
    retrieved_at: normalizedRetrievedAt,
    data_classification: 'observed',
    freshness: normalizeFreshness(undefined, undefined, normalizedRetrievedAt),
    limitations: safeLimitations,
    provider_specific_evidence: deepFreeze({
      adapter_version: 'provider-router/v1',
      source_ref: `router:${normalizedOperation}:unavailable`,
      operation: normalizedOperation,
    }),
    data: null,
  });
}

export function isFallbackCode(value) {
  return fallbackCodeSet.has(value);
}
