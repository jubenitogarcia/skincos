import { createHash } from 'node:crypto';

import {
  assertNoSensitiveFields,
  normalizeCanonicalHandle,
  normalizeCreatorKey,
} from './contracts.mjs';

/**
 * Runtime-free scheduling is intentional: this module is the bounded internal
 * collection operation. Orb may invoke it, but it does not own a timer,
 * workflow definition, provider transport, credentials, or analytics logic.
 */
export const SNAPSHOT_OPERATION_CONTRACT_VERSION = 'influencer-intelligence/snapshots/v1';
export const SNAPSHOT_OPERATIONS = Object.freeze([
  'snapshot_creator',
  'snapshot_creator_media',
]);
export const DEFAULT_SNAPSHOT_BUCKET_SECONDS = 60 * 60;
export const DEFAULT_MEDIA_LIMIT = 20;
export const MAX_MEDIA_LIMIT = 50;
export const PROFILE_METRIC_FIELDS = Object.freeze([
  'followers_count',
  'following_count',
  'media_count',
]);
export const MEDIA_METRIC_FIELDS = Object.freeze([
  'likes_count',
  'comments_count',
  'shares_count',
  'saves_count',
  'views_count',
  'reach_count',
  'impressions_count',
]);

const MODES = new Set(['dry-run', 'shadow', 'active']);
const SAFE_KEY_PATTERN = /^[A-Za-z0-9._:-]{1,240}$/;
const OPAQUE_KEY_PATTERN = /^[A-Za-z0-9._:-]{1,160}$/;
const PROVIDER_PATTERN = /^[a-z][a-z0-9.-]{0,63}$/;
const VERSION_PATTERN = /^[a-z][a-z0-9._/-]{0,79}$/;
const SOURCE_REF_PATTERN = /^[A-Za-z0-9._:/-]{1,240}$/;

export class SnapshotOperationError extends Error {
  constructor(code, operation, details = {}) {
    super(`Influencer Intelligence snapshot operation failed: ${code}`);
    this.name = 'SnapshotOperationError';
    this.code = code;
    this.operation = operation;
    this.details = details;
  }

  toJSON() {
    return {
      code: this.code,
      operation: this.operation,
      ...(Object.keys(this.details).length > 0 ? { details: this.details } : {}),
    };
  }
}

function fail(code, operation, details = {}) {
  throw new SnapshotOperationError(code, operation, details);
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

function stableSerialize(value) {
  if (value === null) return 'null';
  if (value === undefined) return 'undefined';
  if (typeof value === 'string') return JSON.stringify(value);
  if (typeof value === 'number' || typeof value === 'boolean') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableSerialize).join(',')}]`;
  if (isRecord(value)) {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableSerialize(value[key])}`).join(',')}}`;
  }
  fail('UNSAFE_HASH_INPUT', 'internal');
}

function sha256(value) {
  return createHash('sha256').update(stableSerialize(value), 'utf8').digest('hex');
}

function shortHash(value) {
  return sha256(value).slice(0, 48);
}

function safeKey(value, label, pattern = SAFE_KEY_PATTERN) {
  if (typeof value !== 'string' || !value.trim() || !pattern.test(value.trim())) {
    fail(`${label.toUpperCase()}_INVALID`, 'input');
  }
  return value.trim();
}

function safeProvider(value, label = 'provider') {
  if (typeof value !== 'string' || !PROVIDER_PATTERN.test(value.trim().toLowerCase())) {
    fail(`${label.toUpperCase()}_INVALID`, 'input');
  }
  return value.trim().toLowerCase();
}

function safeVersion(value, label) {
  if (typeof value !== 'string' || !VERSION_PATTERN.test(value.trim().toLowerCase())) {
    fail(`${label.toUpperCase()}_INVALID`, 'input');
  }
  return value.trim().toLowerCase();
}

function safeSourceRef(value, label = 'sourceRef') {
  if (typeof value !== 'string' || !SOURCE_REF_PATTERN.test(value.trim())) {
    fail(`${label.toUpperCase()}_INVALID`, 'internal');
  }
  return value.trim();
}

function operationKey(operation) {
  return String(operation).replace(/_/g, '-');
}

function safeOpaque(value, label) {
  return safeKey(value, label, OPAQUE_KEY_PATTERN);
}

function isoTimestamp(value, label, fallback) {
  const source = value === undefined || value === null ? fallback : value;
  if (typeof source !== 'string' || !source.trim()) fail(`${label.toUpperCase()}_REQUIRED`, 'input');
  const parsed = new Date(source);
  if (Number.isNaN(parsed.getTime())) fail(`${label.toUpperCase()}_INVALID`, 'input');
  return parsed.toISOString();
}

function clockIso(clock) {
  const value = typeof clock === 'function' ? clock() : clock;
  const date = value instanceof Date ? value : new Date(value === undefined ? Date.now() : value);
  if (Number.isNaN(date.getTime())) fail('CLOCK_INVALID', 'internal');
  return date.toISOString();
}

function boundedInteger(value, label, { fallback, minimum, maximum } = {}) {
  const candidate = value === undefined ? fallback : value;
  if (!Number.isInteger(candidate) || candidate < minimum || candidate > maximum) {
    fail(`${label.toUpperCase()}_INVALID`, 'input');
  }
  return candidate;
}

function normalizeMode(value) {
  const mode = value === undefined ? 'shadow' : value;
  if (typeof mode !== 'string' || !MODES.has(mode)) fail('MODE_INVALID', 'input');
  return mode;
}

function normalizeCreator(value) {
  try {
    return normalizeCreatorKey(value);
  } catch {
    fail('CREATOR_KEY_INVALID', 'input');
  }
}

function normalizeIdentity(value) {
  if (value === undefined || value === null || value === '') return null;
  return safeOpaque(value, 'identityKey');
}

function normalizeHandle(value) {
  if (value === undefined || value === null || value === '') return null;
  try {
    return normalizeCanonicalHandle(value) || null;
  } catch {
    fail('CANONICAL_HANDLE_INVALID', 'input');
  }
}

function normalizeMediaKeys(value) {
  if (value === undefined || value === null) return null;
  if (!Array.isArray(value) || value.length < 1 || value.length > MAX_MEDIA_LIMIT) {
    fail('MEDIA_KEYS_INVALID', 'input');
  }
  const normalized = value.map((item) => safeOpaque(item, 'mediaKey'));
  if (new Set(normalized).size !== normalized.length) fail('MEDIA_KEYS_DUPLICATE', 'input');
  return normalized;
}

function normalizeRequest(input, operation, clock) {
  if (!isRecord(input)) fail('REQUEST_INVALID', operation);
  try {
    assertNoSensitiveFields(input, 'snapshotRequest');
  } catch {
    fail('POLICY_BLOCK', operation);
  }
  const creatorKey = normalizeCreator(input.creatorKey ?? input.creator_key);
  const identityKey = normalizeIdentity(input.identityKey ?? input.identity_key);
  if (operation === 'snapshot_creator' && !identityKey) {
    fail('IDENTITY_KEY_REQUIRED', operation);
  }
  const canonicalHandle = normalizeHandle(input.canonicalHandle ?? input.canonical_handle ?? input.handle);
  const now = clockIso(clock);
  const observedAt = isoTimestamp(input.observedAt ?? input.observed_at, 'observedAt', now);
  const retrievedAt = isoTimestamp(input.retrievedAt ?? input.retrieved_at, 'retrievedAt', now);
  if (Date.parse(retrievedAt) < Date.parse(observedAt)) fail('TIMESTAMP_ORDER_INVALID', operation);
  const bucketSeconds = boundedInteger(input.bucketSeconds, 'bucketSeconds', {
    fallback: DEFAULT_SNAPSHOT_BUCKET_SECONDS,
    minimum: 60,
    maximum: 86400,
  });
  const mediaKeys = normalizeMediaKeys(input.mediaKeys ?? input.media_keys);
  const limit = operation === 'snapshot_creator_media'
    ? boundedInteger(input.limit, 'limit', {
      fallback: mediaKeys ? mediaKeys.length : DEFAULT_MEDIA_LIMIT,
      minimum: 1,
      maximum: MAX_MEDIA_LIMIT,
    })
    : 1;
  if (mediaKeys && limit !== mediaKeys.length) fail('LIMIT_MEDIA_KEYS_MISMATCH', operation);
  const mode = normalizeMode(input.mode);
  const retentionPolicyVersion = safeVersion(input.retentionPolicyVersion || 'retention/v1', 'retentionPolicyVersion');
  const correlationId = safeKey(
    input.correlationId || `ii:${operationKey(operation)}:${shortHash({ creatorKey, observedAt })}`,
    'correlationId',
  );
  const bucket = bucketStart(observedAt, bucketSeconds);
  // The replay identity is the logical collection target, not the caller's
  // handle spelling or execution mode. A corrected handle must not trigger a
  // second provider call in the same creator/time bucket, and shadow/active
  // are execution metadata rather than separate historical observations.
  const fingerprint = sha256({
    operation,
    creatorKey,
    bucket,
    bucketSeconds,
    limit,
    mediaKeys: mediaKeys ? [...mediaKeys].sort() : null,
  });
  const idempotencyKey = safeKey(
    input.idempotencyKey || `snapshot:${operationKey(operation)}:${fingerprint.slice(0, 48)}`,
    'idempotencyKey',
  );
  const runKey = safeKey(
    input.runKey || `run:${operationKey(operation)}:${sha256(idempotencyKey).slice(0, 48)}`,
    'runKey',
  );
  return Object.freeze({
    operation,
    creatorKey,
    identityKey,
    canonicalHandle,
    observedAt,
    retrievedAt,
    bucketSeconds,
    bucket,
    mediaKeys,
    limit,
    mode,
    retentionPolicyVersion,
    correlationId,
    requestFingerprint: fingerprint,
    idempotencyKey,
    runKey,
  });
}

function bucketStart(timestamp, bucketSeconds) {
  const seconds = Math.floor(Date.parse(timestamp) / 1000);
  return new Date(Math.floor(seconds / bucketSeconds) * bucketSeconds * 1000).toISOString();
}

function providerRequest(request, operation, overrides = {}) {
  return {
    creator_key: request.creatorKey,
    ...(request.canonicalHandle ? { canonical_handle: request.canonicalHandle } : {}),
    observed_at: request.observedAt,
    retrieved_at: request.retrievedAt,
    correlation_id: request.correlationId,
    limit: request.limit,
    ...(request.mediaKeys ? { media_keys: request.mediaKeys } : {}),
    ...overrides,
  };
}

function ensureDependencies({ router, repository }, operation) {
  if (!router || typeof router.get_profile !== 'function'
    || typeof router.get_recent_media !== 'function'
    || typeof router.get_media_metrics !== 'function') {
    fail('ROUTER_REQUIRED', operation);
  }
  const methods = [
    'createCollectorRun',
    'updateCollectorRun',
    'recordCollectorEvidence',
    'recordProfileSnapshot',
    'upsertMedia',
    'recordMediaSnapshot',
  ];
  if (!repository || methods.some((method) => typeof repository[method] !== 'function')) {
    fail('REPOSITORY_REQUIRED', operation);
  }
}

function resultObservation(result, request) {
  return isoTimestamp(result?.freshness?.observed_at, 'resultObservedAt', request.observedAt);
}

function resultRetrieved(result, request) {
  return isoTimestamp(result?.retrieved_at, 'resultRetrievedAt', request.retrievedAt);
}

function resultProvider(result, fallback = null) {
  if (result?.provider === null || result?.provider === undefined) return fallback;
  return safeProvider(result.provider, 'resultProvider');
}

function resultStatus(result, operation) {
  if (!isRecord(result) || !['ok', 'unavailable'].includes(result.status)) {
    fail('PROVIDER_RESULT_INVALID', operation);
  }
  if (!['observed', 'derived', 'inferred'].includes(result.data_classification)) {
    fail('PROVIDER_CLASSIFICATION_INVALID', operation);
  }
  if (result.status === 'ok' && result.data === null) fail('PROVIDER_DATA_MISSING', operation);
  if (!Array.isArray(result.attempts || [])) fail('PROVIDER_ATTEMPTS_INVALID', operation);
  if (result.status === 'ok' && result.data_classification !== 'observed') {
    fail('NON_OBSERVED_SNAPSHOT_NOT_PERSISTABLE', operation, {
      dataClassification: result.data_classification,
    });
  }
  return result;
}

function resultLimitations(result) {
  return Array.isArray(result?.limitations) ? [...new Set(result.limitations.map((item) => String(item)))] : [];
}

function resultFreshness(result) {
  const freshness = isRecord(result?.freshness) ? result.freshness : {};
  return {
    status: typeof freshness.status === 'string' ? freshness.status : 'unknown',
    observed_at: freshness.observed_at || null,
    retrieved_at: freshness.retrieved_at || result?.retrieved_at || null,
    age_seconds: Number.isInteger(freshness.age_seconds) ? freshness.age_seconds : null,
    max_age_seconds: Number.isInteger(freshness.max_age_seconds) ? freshness.max_age_seconds : null,
  };
}

function metricValue(data, key) {
  const value = data?.[key];
  if (value === undefined || value === null) return null;
  if (!Number.isSafeInteger(value) || value < 0) {
    fail('PROVIDER_METRIC_INVALID', 'snapshot', { metric: key });
  }
  return value;
}

function booleanValue(data, key) {
  const value = data?.[key];
  if (value === undefined || value === null) return null;
  if (typeof value !== 'boolean') fail('PROVIDER_BOOLEAN_INVALID', 'snapshot', { field: key });
  return value;
}

function coverageFor(fields, data) {
  const missing = fields.filter((field) => data?.[field] === undefined || data?.[field] === null);
  return {
    available: fields.length - missing.length,
    expected: fields.length,
    missing,
  };
}

function providerEvidence(result, fallbackProvider, operation) {
  const evidence = isRecord(result?.provider_specific_evidence)
    ? result.provider_specific_evidence
    : {};
  const provider = resultProvider(result, fallbackProvider);
  const sourceRef = evidence.source_ref || `${provider || 'router'}:${operationKey(operation)}:unavailable`;
  return {
    provider,
    adapterVersion: safeVersion(evidence.adapter_version || 'provider-router/v1', 'adapterVersion'),
    sourceRef: safeSourceRef(sourceRef, 'providerSourceRef'),
    ...(evidence.endpoint_family ? { endpointFamily: String(evidence.endpoint_family) } : {}),
    ...(evidence.coverage_code ? { coverageCode: String(evidence.coverage_code) } : {}),
  };
}

function artifactIds(kind, { creatorKey, provider, mediaKey, observedAt, bucketSeconds }) {
  const artifactHash = shortHash({ kind, creatorKey, provider, mediaKey: mediaKey || null, bucket: bucketStart(observedAt, bucketSeconds) });
  return {
    snapshotKey: `${kind}:${artifactHash}`,
    ingestKey: `${kind}:${artifactHash}`,
    evidenceKey: `evidence:${kind}:${artifactHash}`,
  };
}

function failureCode(value) {
  const normalized = String(value || 'coverage_gap').trim().toLowerCase().replace(/_/g, '-');
  return /^[a-z][a-z0-9.-]{0,79}$/.test(normalized) ? normalized : 'provider-failure';
}

function failureItems(result, operation, fallbackProvider = 'meta-graph') {
  const attempts = Array.isArray(result?.attempts) ? result.attempts : [];
  const items = attempts
    .filter((attempt) => attempt && (attempt.status !== 'ok' || attempt.classification))
    .map((attempt) => ({
      operation,
      provider: safeProvider(attempt.provider || fallbackProvider, 'attemptProvider'),
      status: attempt.status || 'gap',
      code: String(attempt.classification || 'coverage_gap'),
      retryCount: Number.isInteger(attempt.retry_count) ? attempt.retry_count : 0,
    }));
  if (items.length > 0) return items;
  if (result?.status === 'unavailable') {
    const provider = resultProvider(result, fallbackProvider) || fallbackProvider;
    return [{
      operation,
      provider: safeProvider(provider, 'attemptProvider'),
      status: 'gap',
      code: resultLimitations(result)[0] || 'coverage_gap',
      retryCount: 0,
    }];
  }
  return [];
}

function publicFailure(item) {
  return Object.freeze({
    operation: item.operation,
    provider: item.provider,
    status: item.status,
    code: item.code,
    retryCount: item.retryCount,
  });
}

async function persistFailureEvidence({ repository, request, runKey, sourceType, operation, result, mediaKey = null }) {
  const failures = failureItems(result, operation);
  const persisted = [];
  const observedAt = resultObservation(result, request);
  const retrievedAt = resultRetrieved(result, request);
  for (const [index, item] of failures.entries()) {
    const ids = artifactIds(`failure-${operationKey(operation)}-${index}`, {
      creatorKey: request.creatorKey,
      provider: item.provider,
      mediaKey,
      observedAt,
      bucketSeconds: request.bucketSeconds,
    });
    const sourceRef = `${item.provider}:${operationKey(operation)}:failure:${shortHash({ runKey, mediaKey, code: item.code, index })}`;
    await repository.recordCollectorEvidence({
      evidenceKey: ids.evidenceKey,
      ingestKey: ids.ingestKey,
      runKey,
      creatorKey: request.creatorKey,
      ...(mediaKey ? { mediaKey } : {}),
      provider: item.provider,
      sourceType,
      evidenceState: 'unavailable',
      observedAt,
      retrievedAt,
      sourceRef,
      gapCode: failureCode(item.code),
      retentionPolicyVersion: request.retentionPolicyVersion,
    });
    persisted.push({ ...item, evidenceKey: ids.evidenceKey, sourceRef });
  }
  return persisted;
}

async function persistObservedEvidence({ repository, request, runKey, sourceType, operation, result, provider, mediaKey = null, data }) {
  const observedAt = resultObservation(result, request);
  const retrievedAt = resultRetrieved(result, request);
  const evidence = providerEvidence(result, provider, operation);
  const ids = artifactIds(sourceType === 'profile' ? 'profile' : 'media', {
    creatorKey: request.creatorKey,
    provider,
    mediaKey,
    observedAt,
    bucketSeconds: request.bucketSeconds,
  });
  await repository.recordCollectorEvidence({
    evidenceKey: ids.evidenceKey,
    ingestKey: ids.ingestKey,
    runKey,
    creatorKey: request.creatorKey,
    ...(mediaKey ? { mediaKey } : {}),
    provider,
    sourceType,
    evidenceState: 'observed',
    observedAt,
    retrievedAt,
    sourceRef: evidence.sourceRef,
    evidenceDigest: sha256({ operation, provider, data, providerEvidence: result.provider_specific_evidence || null }),
    retentionPolicyVersion: request.retentionPolicyVersion,
  });
  return { ...ids, observedAt, retrievedAt, evidence };
}

async function beginRun(repository, request) {
  const startedAt = clockIso(request.clock);
  const result = await repository.createCollectorRun({
    runKey: request.runKey,
    idempotencyKey: request.idempotencyKey,
    provider: null,
    mode: request.mode,
    status: 'running',
    requestFingerprint: request.requestFingerprint,
    correlationId: request.correlationId,
    attemptCount: 1,
    startedAt,
  });
  if (!result?.inserted) {
    return {
      inserted: false,
      status: result?.row?.status || 'in_progress',
      row: result?.row || null,
      startedAt,
    };
  }
  return { inserted: true, status: 'running', row: result.row || null, startedAt };
}

async function finishRun(repository, runKey, status, startedAt, clock, metadata = {}) {
  const now = clockIso(clock);
  const finishedAt = Date.parse(now) >= Date.parse(startedAt) ? now : startedAt;
  await repository.updateCollectorRun({ runKey, status, finishedAt, ...metadata });
  return { status, finishedAt };
}

function collectorRunView(request, run, finalStatus, finishedAt, extra = {}) {
  return {
    contractVersion: SNAPSHOT_OPERATION_CONTRACT_VERSION,
    runKey: request.runKey,
    idempotencyKey: request.idempotencyKey,
    status: finalStatus,
    inserted: run.inserted,
    deduplicated: !run.inserted,
    ...(finishedAt ? { finishedAt } : {}),
    ...extra,
  };
}

function deduplicatedResult(request, run) {
  return deepFreeze({
    contractVersion: SNAPSHOT_OPERATION_CONTRACT_VERSION,
    operation: request.operation,
    status: run.status,
    deduplicated: true,
    collectorRun: collectorRunView(request, run, run.status),
    creatorKey: request.creatorKey,
    coverage: { available: 0, expected: 0, state: 'not_recomputed' },
    failures: [],
    limitations: ['idempotent_replay_not_recomputed'],
  });
}

function structuredError(error, operation) {
  return {
    code: String(error?.code || error?.reasonCode || 'provider_failure'),
    operation,
    ...(error?.provider ? { provider: safeProvider(error.provider, 'errorProvider') } : {}),
    ...(error?.retryable !== undefined ? { retryable: error.retryable === true } : {}),
    ...(error?.fallbackAllowed !== undefined ? { fallbackAllowed: error.fallbackAllowed === true } : {}),
  };
}

function thrownResult(operation, request, error) {
  const failure = structuredError(error, operation);
  const provider = failure.provider || 'meta-graph';
  return {
    status: 'unavailable',
    provider: null,
    data_classification: 'observed',
    retrieved_at: request.retrievedAt,
    freshness: {
      status: 'unknown',
      observed_at: request.observedAt,
      retrieved_at: request.retrievedAt,
      age_seconds: null,
      max_age_seconds: null,
    },
    limitations: [failure.code],
    attempts: [{ provider, status: 'blocked', classification: failure.code, retry_count: 0 }],
    provider_specific_evidence: {
      adapter_version: 'provider-router/v1',
      source_ref: `${provider}:${operationKey(operation)}:failure:${shortHash(failure)}`,
    },
    data: null,
  };
}

async function runProfileSnapshot({ router, repository, request, run }) {
  let result;
  let providerError = null;
  try {
    result = resultStatus(await router.get_profile(providerRequest(request, 'get_profile')), 'snapshot_creator');
  } catch (error) {
    providerError = error;
    result = thrownResult('get_profile', request, error);
  }

  const failures = await persistFailureEvidence({
    repository,
    request,
    runKey: request.runKey,
    sourceType: 'profile',
    operation: 'get_profile',
    result,
  });
  const provider = resultProvider(result);
  const observations = provider ? result.data || {} : {};
  const limitations = resultLimitations(result);
  const observedAt = resultObservation(result, request);
  const retrievedAt = resultRetrieved(result, request);
  const freshness = resultFreshness(result);
  const coverage = coverageFor(PROFILE_METRIC_FIELDS, observations);
  const persistedSnapshots = [];

  if (result.status === 'ok' && provider && !providerError) {
    const evidence = await persistObservedEvidence({
      repository,
      request,
      runKey: request.runKey,
      sourceType: 'profile',
      operation: 'get_profile',
      result,
      provider,
      data: observations,
    });
    const metricState = {
      data_classification: result.data_classification,
      freshness_status: freshness.status,
      freshness_age_seconds: freshness.age_seconds,
      freshness_max_age_seconds: freshness.max_age_seconds,
      coverage_available: coverage.available,
      coverage_expected: coverage.expected,
      missing_metrics: coverage.missing,
      limitations,
    };
    const ids = artifactIds('profile', {
      creatorKey: request.creatorKey,
      provider,
      observedAt,
      bucketSeconds: request.bucketSeconds,
    });
    const persisted = await repository.recordProfileSnapshot({
      snapshotKey: ids.snapshotKey,
      ingestKey: ids.ingestKey,
      creatorKey: request.creatorKey,
      identityKey: request.identityKey,
      evidenceKey: evidence.evidenceKey,
      provider,
      providerAdapterVersion: evidence.evidence.adapterVersion,
      contractVersion: result.contract_version || SNAPSHOT_OPERATION_CONTRACT_VERSION,
      evidenceState: 'observed',
      observedAt,
      retrievedAt,
      sourceRef: evidence.evidence.sourceRef,
      canonicalHandle: observations.canonical_handle ?? request.canonicalHandle,
      followersCount: metricValue(observations, 'followers_count'),
      followingCount: metricValue(observations, 'following_count'),
      mediaCount: metricValue(observations, 'media_count'),
      isPrivate: booleanValue(observations, 'is_private'),
      isVerified: booleanValue(observations, 'is_verified'),
      normalizedMetrics: metricState,
      coverageAvailable: coverage.available,
      coverageExpected: coverage.expected,
      freshnessStatus: freshness.status,
      freshnessAgeSeconds: freshness.age_seconds,
      retentionPolicyVersion: request.retentionPolicyVersion,
    });
    persistedSnapshots.push({
      kind: 'profile',
      provider,
      snapshotKey: ids.snapshotKey,
      ingestKey: ids.ingestKey,
      inserted: Boolean(persisted?.inserted),
    });
  } else {
    for (const failure of failures.length > 0
      ? failures
      : [{ provider: provider || 'meta-graph', code: 'coverage_gap', sourceRef: `${provider || 'meta-graph'}:get-profile:unavailable`, evidenceKey: null }]) {
      const unavailableProvider = safeProvider(failure.provider || 'meta-graph', 'unavailableProvider');
      const ids = artifactIds('profile', {
        creatorKey: request.creatorKey,
        provider: unavailableProvider,
        observedAt,
        bucketSeconds: request.bucketSeconds,
      });
      const evidenceKey = failure.evidenceKey || ids.evidenceKey;
      const persisted = await repository.recordProfileSnapshot({
        snapshotKey: ids.snapshotKey,
        ingestKey: ids.ingestKey,
        creatorKey: request.creatorKey,
        identityKey: request.identityKey,
        evidenceKey,
        provider: unavailableProvider,
        providerAdapterVersion: 'provider-router/v1',
        contractVersion: SNAPSHOT_OPERATION_CONTRACT_VERSION,
        evidenceState: 'unavailable',
        observedAt,
        retrievedAt,
        sourceRef: safeSourceRef(failure.sourceRef || `${unavailableProvider}:get-profile:unavailable`, 'unavailableSourceRef'),
        coverageAvailable: 0,
        coverageExpected: PROFILE_METRIC_FIELDS.length,
        freshnessStatus: freshness.status,
        freshnessAgeSeconds: freshness.age_seconds,
        retentionPolicyVersion: request.retentionPolicyVersion,
      });
      persistedSnapshots.push({
        kind: 'profile',
        provider: unavailableProvider,
        snapshotKey: ids.snapshotKey,
        ingestKey: ids.ingestKey,
        inserted: Boolean(persisted?.inserted),
      });
    }
  }

  const partial = result.status !== 'ok' || coverage.available < coverage.expected
    || limitations.length > 0 || failures.length > 0;
  const status = providerError ? 'failed' : result.status !== 'ok' ? 'unavailable' : partial ? 'partial' : 'completed';
  const finished = await finishRun(repository, request.runKey, status, run.startedAt, request.clock, {
    coverageAvailable: coverage.available,
    coverageExpected: coverage.expected,
    failureCount: failures.length,
    freshnessStatus: freshness.status,
    freshnessAgeSeconds: freshness.age_seconds,
  });
  return deepFreeze({
    contractVersion: SNAPSHOT_OPERATION_CONTRACT_VERSION,
    operation: request.operation,
    status,
    collectorRun: collectorRunView(request, run, status, finished.finishedAt),
    creatorKey: request.creatorKey,
    provider: provider || null,
    evidenceState: result.status === 'ok' && !providerError ? 'observed' : 'unavailable',
    dataClassification: result.data_classification,
    retrievedAt,
    freshness,
    profile: {
      canonicalHandle: observations.canonical_handle ?? request.canonicalHandle,
      followersCount: metricValue(observations, 'followers_count'),
      followingCount: metricValue(observations, 'following_count'),
      mediaCount: metricValue(observations, 'media_count'),
      isPrivate: booleanValue(observations, 'is_private'),
      isVerified: booleanValue(observations, 'is_verified'),
    },
    coverage,
    limitations: [...new Set([...limitations, ...failures.map((item) => failureCode(item.code))])],
    failures: failures.map(publicFailure),
    providerSpecificEvidence: result.provider_specific_evidence || null,
    persistence: { snapshots: persistedSnapshots },
    ...(providerError ? { error: structuredError(providerError, request.operation) } : {}),
  });
}

function mediaKind(value) {
  return new Set(['post', 'reel', 'video', 'short', 'live']).has(value) ? value : 'unknown';
}

function normalizeRecentMedia(result, operation) {
  if (result.status !== 'ok') return [];
  if (!Array.isArray(result.data)) fail('PROVIDER_MEDIA_INVALID', operation);
  const seen = new Map();
  for (const item of result.data) {
    if (!isRecord(item) || typeof item.media_key !== 'string') fail('PROVIDER_MEDIA_INVALID', operation);
    const normalized = {
      mediaKey: safeOpaque(item.media_key, 'mediaKey'),
      mediaKind: mediaKind(item.media_kind),
      publishedAt: item.published_at ? isoTimestamp(item.published_at, 'publishedAt') : null,
    };
    const existing = seen.get(normalized.mediaKey);
    if (existing && stableSerialize(existing) !== stableSerialize(normalized)) {
      fail('PROVIDER_MEDIA_DUPLICATE_CONFLICT', operation);
    }
    seen.set(normalized.mediaKey, normalized);
  }
  return [...seen.values()];
}

function normalizeMetricItems(result, operation) {
  if (result.status !== 'ok') return new Map();
  if (!Array.isArray(result.data)) fail('PROVIDER_METRICS_INVALID', operation);
  const seen = new Map();
  for (const item of result.data) {
    if (!isRecord(item) || typeof item.media_key !== 'string') fail('PROVIDER_METRICS_INVALID', operation);
    const mediaKey = safeOpaque(item.media_key, 'mediaKey');
    const normalized = { mediaKey };
    for (const field of MEDIA_METRIC_FIELDS) normalized[field] = metricValue(item, field);
    const existing = seen.get(mediaKey);
    if (existing && stableSerialize(existing) !== stableSerialize(normalized)) {
      fail('PROVIDER_METRICS_DUPLICATE_CONFLICT', operation);
    }
    seen.set(mediaKey, normalized);
  }
  return seen;
}

function metricCoverageFor(item) {
  return coverageFor(MEDIA_METRIC_FIELDS, item || {});
}

async function persistUnavailableMedia({ repository, request, runKey, provider, mediaKey, observedAt, retrievedAt, sourceRef, gapCode, freshness }) {
  const failureResult = {
    status: 'unavailable',
    provider,
    data_classification: 'observed',
    retrieved_at: retrievedAt,
    freshness: { observed_at: observedAt },
    limitations: [gapCode],
    attempts: [],
    provider_specific_evidence: { adapter_version: 'provider-router/v1', source_ref: sourceRef },
    data: null,
  };
  const evidence = await persistFailureEvidence({
    repository,
    request,
    runKey,
    sourceType: 'media',
    operation: 'get_media_metrics',
    result: { ...failureResult, attempts: [{ provider, status: 'gap', classification: gapCode, retry_count: 0 }] },
    mediaKey,
  });
  const ids = artifactIds('media', {
    creatorKey: request.creatorKey,
    provider,
    mediaKey,
    observedAt,
    bucketSeconds: request.bucketSeconds,
  });
  const persisted = await repository.recordMediaSnapshot({
    snapshotKey: ids.snapshotKey,
    ingestKey: ids.ingestKey,
    mediaKey,
    creatorKey: request.creatorKey,
    evidenceKey: evidence[0]?.evidenceKey || ids.evidenceKey,
    provider,
    providerAdapterVersion: 'provider-router/v1',
    contractVersion: SNAPSHOT_OPERATION_CONTRACT_VERSION,
    evidenceState: 'unavailable',
    observedAt,
    retrievedAt,
    sourceRef: safeSourceRef(sourceRef, 'mediaSourceRef'),
    coverageAvailable: 0,
    coverageExpected: MEDIA_METRIC_FIELDS.length,
    freshnessStatus: freshness.status,
    freshnessAgeSeconds: freshness.age_seconds,
    retentionPolicyVersion: request.retentionPolicyVersion,
  });
  return {
    mediaKey,
    provider,
    evidenceState: 'unavailable',
    metrics: Object.fromEntries(MEDIA_METRIC_FIELDS.map((field) => [field, null])),
    coverage: { available: 0, expected: MEDIA_METRIC_FIELDS.length, missing: [...MEDIA_METRIC_FIELDS] },
    snapshotKey: ids.snapshotKey,
    ingestKey: ids.ingestKey,
    inserted: Boolean(persisted?.inserted),
  };
}

async function runMediaSnapshot({ router, repository, request, run }) {
  let recentResult = null;
  let recentError = null;
  if (!request.mediaKeys) {
    try {
      recentResult = resultStatus(await router.get_recent_media(providerRequest(request, 'get_recent_media')), 'snapshot_creator_media');
    } catch (error) {
      recentError = error;
      recentResult = thrownResult('get_recent_media', request, error);
    }
  }
  const recentFailures = recentResult
    ? await persistFailureEvidence({
      repository,
      request,
      runKey: request.runKey,
      sourceType: 'media',
      operation: 'get_recent_media',
      result: recentResult,
    })
    : [];
  if (recentError || recentResult?.status === 'unavailable') {
    const status = recentError ? 'failed' : 'unavailable';
    const recentFreshness = recentResult ? resultFreshness(recentResult) : {
      status: 'unknown',
      age_seconds: null,
    };
    const finished = await finishRun(repository, request.runKey, status, run.startedAt, request.clock, {
      coverageAvailable: 0,
      coverageExpected: 0,
      failureCount: recentFailures.length,
      freshnessStatus: recentFreshness.status,
      freshnessAgeSeconds: recentFreshness.age_seconds,
    });
    return deepFreeze({
      contractVersion: SNAPSHOT_OPERATION_CONTRACT_VERSION,
      operation: request.operation,
      status,
      collectorRun: collectorRunView(request, run, status, finished.finishedAt),
      creatorKey: request.creatorKey,
      provider: null,
      freshness: recentResult ? resultFreshness(recentResult) : null,
      coverage: { mediaRequested: 0, mediaObserved: 0, metricFieldsAvailable: 0, metricFieldsExpected: 0, state: 'unavailable' },
      media: [],
      failures: recentFailures.map(publicFailure),
      limitations: [...new Set([
        ...(resultLimitations(recentResult)),
        ...recentFailures.map((item) => failureCode(item.code)),
      ])],
      providerSpecificEvidence: recentResult?.provider_specific_evidence || null,
      persistence: { snapshots: [] },
      ...(recentError ? { error: structuredError(recentError, request.operation) } : {}),
    });
  }

  let discovered = normalizeRecentMedia(recentResult || { status: 'ok', data: [] }, request.operation);
  if (request.mediaKeys) {
    const discoveredByKey = new Map(discovered.map((item) => [item.mediaKey, item]));
    discovered = request.mediaKeys.map((mediaKey) => discoveredByKey.get(mediaKey) || ({
      mediaKey,
      mediaKind: 'unknown',
      publishedAt: null,
    }));
  } else {
    discovered = discovered.slice(0, request.limit);
  }
  const selectedKeys = discovered.map((item) => item.mediaKey);
  if (selectedKeys.length === 0) {
    const recentFreshness = recentResult ? resultFreshness(recentResult) : { status: 'unknown', age_seconds: null };
    const finished = await finishRun(repository, request.runKey, 'completed', run.startedAt, request.clock, {
      coverageAvailable: 0,
      coverageExpected: 0,
      failureCount: recentFailures.length,
      freshnessStatus: recentFreshness.status,
      freshnessAgeSeconds: recentFreshness.age_seconds,
    });
    return deepFreeze({
      contractVersion: SNAPSHOT_OPERATION_CONTRACT_VERSION,
      operation: request.operation,
      status: 'completed',
      collectorRun: collectorRunView(request, run, 'completed', finished.finishedAt),
      creatorKey: request.creatorKey,
      provider: recentResult?.provider || null,
      freshness: recentResult ? { recentMedia: resultFreshness(recentResult), mediaMetrics: null } : { recentMedia: null, mediaMetrics: null },
      coverage: { mediaRequested: 0, mediaObserved: 0, metricFieldsAvailable: 0, metricFieldsExpected: 0, state: 'not_applicable' },
      media: [],
      failures: recentFailures.map(publicFailure),
      limitations: recentFailures.map((item) => failureCode(item.code)),
      providerSpecificEvidence: recentResult?.provider_specific_evidence || null,
      persistence: { snapshots: [] },
    });
  }

  let metricsResult;
  let metricsError = null;
  try {
    metricsResult = resultStatus(await router.get_media_metrics(providerRequest(request, 'get_media_metrics', {
      media_keys: selectedKeys,
      limit: selectedKeys.length,
    })), request.operation);
  } catch (error) {
    metricsError = error;
    metricsResult = thrownResult('get_media_metrics', request, error);
  }
  const metricFailures = await persistFailureEvidence({
    repository,
    request,
    runKey: request.runKey,
    sourceType: 'media',
    operation: 'get_media_metrics',
    result: metricsResult,
  });
  const metricsProvider = resultProvider(metricsResult, metricFailures[0]?.provider || recentResult?.provider || 'meta-graph');
  const identityProvider = resultProvider(recentResult, metricsProvider) || metricsProvider;
  const metricsByKey = normalizeMetricItems(metricsResult, request.operation);
  const metricsObservedAt = resultObservation(metricsResult, request);
  const metricsRetrievedAt = resultRetrieved(metricsResult, request);
  const recentEvidence = recentResult ? providerEvidence(recentResult, identityProvider, 'get_recent_media') : null;
  const persistedSnapshots = [];
  const outputMedia = [];
  let metricFieldsAvailable = 0;
  let metricFieldsExpected = selectedKeys.length * MEDIA_METRIC_FIELDS.length;
  let publicationAvailable = 0;

  for (const item of discovered) {
    const mediaKey = item.mediaKey;
    if (item.publishedAt) publicationAvailable += 1;
    await repository.upsertMedia({
      mediaKey,
      creatorKey: request.creatorKey,
      provider: identityProvider,
      providerMediaDigest: sha256({ provider: identityProvider, mediaKey }),
      mediaKind: item.mediaKind,
      publishedAt: item.publishedAt,
      sourceRef: recentEvidence?.sourceRef || `${identityProvider}:media:${shortHash(mediaKey)}`,
    });

    const metricItem = metricsByKey.get(mediaKey);
    const coverage = metricCoverageFor(metricItem);
    metricFieldsAvailable += coverage.available;
    if (!metricItem || coverage.available === 0 || metricsResult.status !== 'ok') {
      const unavailableProvider = metricsProvider || 'meta-graph';
      const unavailable = await persistUnavailableMedia({
        repository,
        request,
        runKey: request.runKey,
        provider: unavailableProvider,
        mediaKey,
        observedAt: metricsObservedAt,
        retrievedAt: metricsRetrievedAt,
        sourceRef: `${unavailableProvider}:get-media-metrics:${shortHash(mediaKey)}:unavailable`,
        gapCode: metricsResult.status === 'ok' ? 'coverage_gap' : (resultLimitations(metricsResult)[0] || metricFailures[0]?.code || 'coverage_gap'),
        freshness: resultFreshness(metricsResult),
      });
      persistedSnapshots.push({ kind: 'media', ...unavailable });
      outputMedia.push({
        mediaKey,
        mediaKind: item.mediaKind,
        publishedAt: item.publishedAt,
        metrics: Object.fromEntries(MEDIA_METRIC_FIELDS.map((field) => [field, null])),
        evidenceState: 'unavailable',
        provider: unavailableProvider,
        freshness: resultFreshness(metricsResult),
        coverage,
      });
      continue;
    }

    const evidence = await persistObservedEvidence({
      repository,
      request,
      runKey: request.runKey,
      sourceType: 'media',
      operation: 'get_media_metrics',
      result: metricsResult,
      provider: metricsProvider,
      mediaKey,
      data: metricItem,
    });
    const ids = artifactIds('media', {
      creatorKey: request.creatorKey,
      provider: metricsProvider,
      mediaKey,
      observedAt: metricsObservedAt,
      bucketSeconds: request.bucketSeconds,
    });
    const persisted = await repository.recordMediaSnapshot({
      snapshotKey: ids.snapshotKey,
      ingestKey: ids.ingestKey,
      mediaKey,
      creatorKey: request.creatorKey,
      evidenceKey: evidence.evidenceKey,
      provider: metricsProvider,
      providerAdapterVersion: evidence.evidence.adapterVersion,
      contractVersion: metricsResult.contract_version || SNAPSHOT_OPERATION_CONTRACT_VERSION,
      evidenceState: 'observed',
      observedAt: metricsObservedAt,
      retrievedAt: metricsRetrievedAt,
      sourceRef: evidence.evidence.sourceRef,
      likesCount: metricItem.likes_count,
      commentsCount: metricItem.comments_count,
      sharesCount: metricItem.shares_count,
      savesCount: metricItem.saves_count,
      viewsCount: metricItem.views_count,
      reachCount: metricItem.reach_count,
      impressionsCount: metricItem.impressions_count,
      normalizedMetrics: {
        freshness_status: resultFreshness(metricsResult).status,
        freshness_age_seconds: resultFreshness(metricsResult).age_seconds,
        freshness_max_age_seconds: resultFreshness(metricsResult).max_age_seconds,
        publication_timestamp: item.publishedAt,
        coverage_available: coverage.available,
        coverage_expected: coverage.expected,
        missing_metrics: coverage.missing,
      },
      coverageAvailable: coverage.available,
      coverageExpected: coverage.expected,
      freshnessStatus: resultFreshness(metricsResult).status,
      freshnessAgeSeconds: resultFreshness(metricsResult).age_seconds,
      retentionPolicyVersion: request.retentionPolicyVersion,
    });
    persistedSnapshots.push({
      kind: 'media',
      mediaKey,
      provider: metricsProvider,
      snapshotKey: ids.snapshotKey,
      ingestKey: ids.ingestKey,
      inserted: Boolean(persisted?.inserted),
    });
    outputMedia.push({
      mediaKey,
      mediaKind: item.mediaKind,
      publishedAt: item.publishedAt,
      metrics: Object.fromEntries(MEDIA_METRIC_FIELDS.map((field) => [field, metricItem[field]])),
      evidenceState: 'observed',
      provider: metricsProvider,
      freshness: resultFreshness(metricsResult),
      coverage,
    });
  }

  const limitations = [
    ...resultLimitations(recentResult),
    ...resultLimitations(metricsResult),
    ...metricFailures.map((item) => failureCode(item.code)),
    ...recentFailures.map((item) => failureCode(item.code)),
  ];
  const partial = metricsError || metricsResult.status !== 'ok'
    || metricFieldsAvailable < metricFieldsExpected
    || publicationAvailable < selectedKeys.length
    || limitations.length > 0;
  const status = metricsError ? 'failed' : partial ? 'partial' : 'completed';
  const metricFreshness = resultFreshness(metricsResult);
  const finished = await finishRun(repository, request.runKey, status, run.startedAt, request.clock, {
    coverageAvailable: metricFieldsAvailable,
    coverageExpected: metricFieldsExpected,
    failureCount: recentFailures.length + metricFailures.length,
    freshnessStatus: metricFreshness.status,
    freshnessAgeSeconds: metricFreshness.age_seconds,
  });
  return deepFreeze({
    contractVersion: SNAPSHOT_OPERATION_CONTRACT_VERSION,
    operation: request.operation,
    status,
    collectorRun: collectorRunView(request, run, status, finished.finishedAt),
    creatorKey: request.creatorKey,
    provider: metricsResult.provider || recentResult?.provider || null,
    evidenceState: metricsResult.status === 'ok' && !metricsError ? 'observed' : 'unavailable',
    dataClassification: metricsResult.data_classification,
    retrievedAt: metricsRetrievedAt,
    freshness: {
      recentMedia: recentResult ? resultFreshness(recentResult) : null,
      mediaMetrics: resultFreshness(metricsResult),
    },
    coverage: {
      mediaRequested: selectedKeys.length,
      mediaObserved: outputMedia.filter((item) => item.evidenceState === 'observed').length,
      metricFieldsAvailable,
      metricFieldsExpected,
      publicationTimestampsAvailable: publicationAvailable,
      publicationTimestampsExpected: selectedKeys.length,
      missingMetricFields: [...new Set(outputMedia.flatMap((item) => item.coverage.missing))],
    },
    media: outputMedia,
    limitations: [...new Set(limitations)],
    failures: [...recentFailures, ...metricFailures].map(publicFailure),
    providerSpecificEvidence: {
      recentMedia: recentResult?.provider_specific_evidence || null,
      mediaMetrics: metricsResult.provider_specific_evidence || null,
    },
    persistence: { snapshots: persistedSnapshots },
    ...(metricsError ? { error: structuredError(metricsError, request.operation) } : {}),
  });
}

export function createSnapshotOperations({ router, repository, clock = () => Date.now() } = {}) {
  ensureDependencies({ router, repository }, 'snapshot_operations');
  if (typeof clock !== 'function' && !(clock instanceof Date) && !Number.isFinite(Number(clock))) {
    fail('CLOCK_INVALID', 'snapshot_operations');
  }

  async function execute(operation, input = {}) {
    if (!SNAPSHOT_OPERATIONS.includes(operation)) fail('OPERATION_UNSUPPORTED', operation);
    const normalized = normalizeRequest(input, operation, clock);
    const request = Object.freeze({ ...normalized, clock });
    const run = await beginRun(repository, request);
    if (!run.inserted) return deduplicatedResult(request, run);
    if (operation === 'snapshot_creator') {
      return runProfileSnapshot({ router, repository, request, run });
    }
    return runMediaSnapshot({ router, repository, request, run });
  }

  return Object.freeze({
    contractVersion: SNAPSHOT_OPERATION_CONTRACT_VERSION,
    snapshot_creator: (input = {}) => execute('snapshot_creator', input),
    snapshot_creator_media: (input = {}) => execute('snapshot_creator_media', input),
  });
}

export const createInfluencerSnapshotOperations = createSnapshotOperations;

export async function snapshot_creator(input, dependencies) {
  return createSnapshotOperations(dependencies).snapshot_creator(input);
}

export async function snapshot_creator_media(input, dependencies) {
  return createSnapshotOperations(dependencies).snapshot_creator_media(input);
}
