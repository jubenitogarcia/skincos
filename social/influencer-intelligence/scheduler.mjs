import { createHash } from 'node:crypto';

import {
  normalizeCanonicalHandle,
  normalizeCreatorKey,
  normalizeProviderId,
  SUPPORTED_PROVIDER_IDS,
} from './contracts.mjs';

/**
 * Pure contract for Orb's bounded snapshot orchestration.
 *
 * Orb may select, dispatch, and record a result. It must not contain provider
 * transport, credentials, analytics, scoring, or arbitrary query logic. The
 * internal service owns the snapshot operation and reuses the same
 * idempotency key for safe transient retries.
 */
export const SCHEDULER_CONTRACT_VERSION = 'influencer-intelligence/scheduler/v1';
export const SCHEDULER_WORKFLOW_VERSION = 'influencer-intelligence-snapshot-workflow/v1';
export const SNAPSHOT_SERVICE_PATH = '/internal/influencer-intelligence/v1/snapshots';
export const SNAPSHOT_OPERATIONS = Object.freeze([
  'snapshot_creator',
  'snapshot_creator_media',
]);
export const RETRYABLE_FAILURE_CLASSES = Object.freeze([
  'timeout',
  'rate_limited',
  'upstream_5xx',
  'network_transient',
]);
export const DEFAULT_SCHEDULER_CONFIG = Object.freeze({
  enabled: false,
  mode: 'shadow',
  intervalHours: 6,
  maxCreatorsPerRun: 25,
  concurrency: 1,
  maxAttempts: 2,
  timeoutMs: 30_000,
  mediaLimit: 20,
  bucketSeconds: 3_600,
});

const MODES = new Set(['dry-run', 'shadow', 'active']);
const FAILURE_CLASSES = new Set(RETRYABLE_FAILURE_CLASSES);
const SAFE_STATUS_CODES = new Set([408, 429, 500, 502, 503, 504]);

export class SnapshotSchedulerError extends Error {
  constructor(code, details = {}) {
    super(`Influencer Intelligence scheduler failed: ${code}`);
    this.name = 'SnapshotSchedulerError';
    this.code = code;
    this.details = details;
  }

  toJSON() {
    return {
      code: this.code,
      ...(Object.keys(this.details).length > 0 ? { details: this.details } : {}),
    };
  }
}

function fail(code, details = {}) {
  throw new SnapshotSchedulerError(code, details);
}

function isRecord(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function boundedInteger(value, label, { fallback, minimum, maximum }) {
  const candidate = value === undefined ? fallback : value;
  if (!Number.isInteger(candidate) || candidate < minimum || candidate > maximum) {
    fail(`${label.toUpperCase()}_INVALID`, { minimum, maximum });
  }
  return candidate;
}

function isoTimestamp(value, label, fallback = new Date()) {
  const source = value === undefined || value === null ? fallback : value;
  const date = source instanceof Date ? source : new Date(source);
  if (Number.isNaN(date.getTime())) fail(`${label.toUpperCase()}_INVALID`);
  return date.toISOString();
}

function stableSerialize(value) {
  if (value === null) return 'null';
  if (value === undefined) return 'undefined';
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(stableSerialize).join(',')}]`;
  if (isRecord(value)) {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableSerialize(value[key])}`).join(',')}}`;
  }
  fail('UNSAFE_HASH_INPUT');
}

function hash(value) {
  return createHash('sha256').update(stableSerialize(value), 'utf8').digest('hex');
}

function bucketStart(timestamp, bucketSeconds) {
  const seconds = Math.floor(Date.parse(timestamp) / 1000);
  return new Date(Math.floor(seconds / bucketSeconds) * bucketSeconds * 1000).toISOString();
}

function creatorKey(value) {
  try {
    return normalizeCreatorKey(value);
  } catch {
    fail('CREATOR_KEY_INVALID');
  }
}

function identityKey(value) {
  if (typeof value !== 'string' || !/^[A-Za-z0-9._:-]{1,160}$/.test(value.trim())) {
    fail('IDENTITY_KEY_INVALID');
  }
  return value.trim();
}

function providerId(value) {
  try {
    const normalized = normalizeProviderId(value);
    if (!SUPPORTED_PROVIDER_IDS.includes(normalized)) fail('PROVIDER_NOT_ALLOWED');
    return normalized;
  } catch (error) {
    if (error instanceof SnapshotSchedulerError) throw error;
    fail('PROVIDER_INVALID');
  }
}

function normalizeMode(value) {
  const mode = value === undefined ? DEFAULT_SCHEDULER_CONFIG.mode : value;
  if (typeof mode !== 'string' || !MODES.has(mode)) fail('MODE_INVALID');
  return mode;
}

export function normalizeSchedulerConfig(input = {}) {
  if (!isRecord(input)) fail('CONFIG_INVALID');
  const config = {
    enabled: input.enabled === undefined ? DEFAULT_SCHEDULER_CONFIG.enabled : input.enabled,
    mode: normalizeMode(input.mode),
    intervalHours: boundedInteger(input.intervalHours, 'intervalHours', {
      fallback: DEFAULT_SCHEDULER_CONFIG.intervalHours,
      minimum: 6,
      maximum: 168,
    }),
    maxCreatorsPerRun: boundedInteger(input.maxCreatorsPerRun, 'maxCreatorsPerRun', {
      fallback: DEFAULT_SCHEDULER_CONFIG.maxCreatorsPerRun,
      minimum: 1,
      maximum: 100,
    }),
    concurrency: boundedInteger(input.concurrency, 'concurrency', {
      fallback: DEFAULT_SCHEDULER_CONFIG.concurrency,
      minimum: 1,
      maximum: 4,
    }),
    maxAttempts: boundedInteger(input.maxAttempts, 'maxAttempts', {
      fallback: DEFAULT_SCHEDULER_CONFIG.maxAttempts,
      minimum: 1,
      maximum: 3,
    }),
    timeoutMs: boundedInteger(input.timeoutMs, 'timeoutMs', {
      fallback: DEFAULT_SCHEDULER_CONFIG.timeoutMs,
      minimum: 1_000,
      maximum: 120_000,
    }),
    mediaLimit: boundedInteger(input.mediaLimit, 'mediaLimit', {
      fallback: DEFAULT_SCHEDULER_CONFIG.mediaLimit,
      minimum: 1,
      maximum: 50,
    }),
    bucketSeconds: boundedInteger(input.bucketSeconds, 'bucketSeconds', {
      fallback: DEFAULT_SCHEDULER_CONFIG.bucketSeconds,
      minimum: 900,
      maximum: 86_400,
    }),
  };
  if (typeof config.enabled !== 'boolean') fail('ENABLED_INVALID');
  return Object.freeze(config);
}

function skip(reason, row = {}) {
  return {
    reason,
    creatorKey: typeof row.creator_key === 'string' ? row.creator_key : null,
  };
}

/**
 * Selects only explicitly opted-in, observed identities. Missing or malformed
 * rows are skipped and surfaced; they are never converted into a job.
 */
export function selectActiveCreators(rows, { config = DEFAULT_SCHEDULER_CONFIG } = {}) {
  const normalizedConfig = normalizeSchedulerConfig(config);
  if (!Array.isArray(rows)) fail('CREATOR_ROWS_INVALID');
  if (!normalizedConfig.enabled) {
    return Object.freeze({
      contractVersion: SCHEDULER_CONTRACT_VERSION,
      status: 'disabled',
      reason: 'feature_flag_off',
      selected: Object.freeze([]),
      skipped: Object.freeze([]),
    });
  }

  const selected = [];
  const skipped = [];
  const seen = new Set();
  for (const row of rows) {
    if (!isRecord(row)) {
      skipped.push(skip('row_invalid'));
      continue;
    }
    if (row.monitoring_enabled !== true) {
      skipped.push(skip('monitoring_not_enabled', row));
      continue;
    }
    if (row.identity_state !== 'active' || row.evidence_state !== 'observed') {
      skipped.push(skip('identity_not_observed_active', row));
      continue;
    }
    let normalizedCreator;
    let normalizedIdentity;
    let normalizedProvider;
    try {
      normalizedCreator = creatorKey(row.creator_key ?? row.creatorKey);
      normalizedIdentity = identityKey(row.identity_key ?? row.identityKey);
      normalizedProvider = providerId(row.provider);
    } catch {
      skipped.push(skip('identity_row_invalid', row));
      continue;
    }
    if (seen.has(normalizedCreator)) {
      skipped.push({ reason: 'duplicate_creator', creatorKey: normalizedCreator });
      continue;
    }
    seen.add(normalizedCreator);
    const handleValue = row.canonical_handle ?? row.canonicalHandle;
    let canonicalHandle = null;
    if (handleValue !== undefined && handleValue !== null && handleValue !== '') {
      try {
        canonicalHandle = normalizeCanonicalHandle(handleValue) || null;
      } catch {
        skipped.push({ reason: 'canonical_handle_invalid', creatorKey: normalizedCreator });
        continue;
      }
    }
    selected.push(Object.freeze({
      creatorKey: normalizedCreator,
      identityKey: normalizedIdentity,
      provider: normalizedProvider,
      ...(canonicalHandle ? { canonicalHandle } : {}),
    }));
    if (selected.length >= normalizedConfig.maxCreatorsPerRun) break;
  }
  return Object.freeze({
    contractVersion: SCHEDULER_CONTRACT_VERSION,
    status: 'ready',
    reason: null,
    selected: Object.freeze(selected),
    skipped: Object.freeze(skipped),
  });
}

function requestKeys(operation, creator, bucket) {
  const fingerprint = hash({ operation, creatorKey: creator.creatorKey, bucket });
  return {
    idempotencyKey: `ii:${operation.replace(/_/g, '-')}:${fingerprint.slice(0, 48)}`,
    runKey: `ii:run:${operation.replace(/_/g, '-')}:${fingerprint.slice(0, 48)}`,
  };
}

/**
 * Produces two service jobs per selected creator. The same IDs are reused on a
 * replay, so a timeout cannot create a second historical observation.
 */
export function buildSnapshotJobs(selection, {
  config = DEFAULT_SCHEDULER_CONFIG,
  now,
} = {}) {
  const normalizedConfig = normalizeSchedulerConfig(config);
  if (!isRecord(selection) || !Array.isArray(selection.selected)) fail('SELECTION_INVALID');
  const requestedAt = isoTimestamp(now, 'requestedAt');
  const bucket = bucketStart(requestedAt, normalizedConfig.bucketSeconds);
  const schedulerRunKey = `ii:scheduler:${hash({ bucket, mode: normalizedConfig.mode }).slice(0, 48)}`;
  if (!normalizedConfig.enabled) {
    return Object.freeze({
      contractVersion: SCHEDULER_CONTRACT_VERSION,
      schedulerRunKey,
      status: 'disabled',
      bucket,
      jobs: Object.freeze([]),
    });
  }

  const jobs = [];
  for (const creator of selection.selected) {
    for (const operation of SNAPSHOT_OPERATIONS) {
      const keys = requestKeys(operation, creator, bucket);
      jobs.push(Object.freeze({
        contractVersion: SCHEDULER_CONTRACT_VERSION,
        workflowVersion: SCHEDULER_WORKFLOW_VERSION,
        schedulerRunKey,
        operation,
        creatorKey: creator.creatorKey,
        identityKey: creator.identityKey,
        ...(creator.canonicalHandle ? { canonicalHandle: creator.canonicalHandle } : {}),
        mode: normalizedConfig.mode,
        bucketSeconds: normalizedConfig.bucketSeconds,
        limit: operation === 'snapshot_creator_media' ? normalizedConfig.mediaLimit : 1,
        timeoutMs: normalizedConfig.timeoutMs,
        maxAttempts: normalizedConfig.maxAttempts,
        idempotencyKey: keys.idempotencyKey,
        runKey: keys.runKey,
        internalService: {
          method: 'POST',
          path: SNAPSHOT_SERVICE_PATH,
          providerTransport: false,
          credentialSource: 'service-runtime-token-vault',
        },
        retryPolicy: {
          maxAttempts: normalizedConfig.maxAttempts,
          sameIdempotencyKey: true,
          retryableClasses: [...RETRYABLE_FAILURE_CLASSES],
        },
      }));
    }
  }
  return Object.freeze({
    contractVersion: SCHEDULER_CONTRACT_VERSION,
    schedulerRunKey,
    status: 'ready',
    bucket,
    jobs: Object.freeze(jobs),
  });
}

function normalizedFailureClass(value) {
  return String(value || '').trim().toLowerCase().replace(/[-\s]+/g, '_');
}

export function classifySnapshotFailure(input = {}) {
  if (!isRecord(input)) fail('FAILURE_INVALID');
  const statusCode = Number(input.statusCode ?? input.status_code ?? 0);
  const explicit = normalizedFailureClass(input.classification ?? input.failure_class);
  const code = normalizedFailureClass(input.code ?? input.reasonCode ?? input.reason_code);
  const alias = (value) => {
    if (FAILURE_CLASSES.has(value)) return value;
    if (/timeout|deadline_exceeded|timed_out/.test(value)) return 'timeout';
    if (/rate[_-]?limit|throttl/.test(value)) return 'rate_limited';
    if (/5xx|upstream[_-]?error|bad_gateway|service_unavailable/.test(value)) return 'upstream_5xx';
    if (/network|econnreset|eai_again|connection_reset/.test(value)) return 'network_transient';
    return null;
  };
  const classification = alias(explicit)
    || alias(code)
    || (SAFE_STATUS_CODES.has(statusCode)
      ? statusCode === 408 ? 'timeout' : statusCode === 429 ? 'rate_limited' : 'upstream_5xx'
      : 'permanent');
  const attempt = boundedInteger(input.attempt, 'attempt', { fallback: 1, minimum: 1, maximum: 100 });
  const maxAttempts = boundedInteger(input.maxAttempts, 'maxAttempts', { fallback: DEFAULT_SCHEDULER_CONFIG.maxAttempts, minimum: 1, maximum: 3 });
  return Object.freeze({
    classification,
    retryable: FAILURE_CLASSES.has(classification) && attempt < maxAttempts,
    attempt,
    maxAttempts,
    sameIdempotencyKey: FAILURE_CLASSES.has(classification),
  });
}

function safeStatus(value) {
  const status = String(value || '').trim().toLowerCase();
  return ['completed', 'partial', 'unavailable', 'failed', 'skipped'].includes(status) ? status : 'failed';
}

function safeCoverage(value) {
  if (!isRecord(value)) return { state: 'unavailable', available: null, expected: null, ratio: null };
  const available = value.available ?? value.availableMetrics ?? null;
  const expected = value.expected ?? value.expectedMetrics ?? null;
  const ratio = value.ratio === undefined || value.ratio === null ? null : Number(value.ratio);
  if (available !== null && (!Number.isInteger(available) || available < 0)) return { state: 'unavailable', available: null, expected: null, ratio: null };
  if (expected !== null && (!Number.isInteger(expected) || expected < 0)) return { state: 'unavailable', available: null, expected: null, ratio: null };
  if (ratio !== null && (!Number.isFinite(ratio) || ratio < 0 || ratio > 1)) return { state: 'unavailable', available: null, expected: null, ratio: null };
  return {
    state: value.state || (available === null || expected === null ? 'unavailable' : 'available'),
    available,
    expected,
    ratio,
  };
}

function safeFreshness(value) {
  if (!isRecord(value)) return { status: 'unknown', observedAt: null, retrievedAt: null, ageSeconds: null };
  return {
    status: ['fresh', 'stale', 'unknown'].includes(value.status) ? value.status : 'unknown',
    observedAt: value.observedAt ?? value.observed_at ?? null,
    retrievedAt: value.retrievedAt ?? value.retrieved_at ?? null,
    ageSeconds: Number.isInteger(value.ageSeconds ?? value.age_seconds) ? (value.ageSeconds ?? value.age_seconds) : null,
  };
}

function safeFailures(value) {
  if (!Array.isArray(value)) return [];
  return value.slice(0, 50).map((failure) => ({
    code: safeCode(failure?.code || failure?.reasonCode, 'provider_failure'),
    classification: safeCode(failure?.classification, 'permanent'),
    retryable: failure?.retryable === true,
  }));
}

function safeCode(value, fallback) {
  const normalized = String(value || '').trim().toLowerCase().replace(/[^a-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80);
  return normalized || fallback;
}

/**
 * Reduces the internal service response to a bounded workflow receipt. No
 * provider payload, metric, credential, or raw error is copied into the log.
 */
export function normalizeSnapshotResult(result, job) {
  if (!isRecord(result) || !isRecord(job)) fail('RESULT_INVALID');
  const status = safeStatus(result.status ?? result.collectorRun?.status);
  const failures = safeFailures(result.failures ?? result.collectorRun?.failures);
  return Object.freeze({
    contractVersion: SCHEDULER_CONTRACT_VERSION,
    operation: job.operation,
    creatorKey: job.creatorKey,
    schedulerRunKey: job.schedulerRunKey,
    idempotencyKey: job.idempotencyKey,
    runKey: job.runKey,
    status,
    collectorRunStatus: String(result.collectorRun?.status || status).slice(0, 32),
    coverage: safeCoverage(result.coverage ?? result.collectorRun?.coverage),
    freshness: safeFreshness(result.freshness ?? result.collectorRun?.freshness),
    failures,
    failureCount: failures.length,
    deduplicated: result.deduplicated === true,
    limitations: Array.isArray(result.limitations) ? result.limitations.map((item) => safeCode(item, 'limitation')).slice(0, 20) : [],
  });
}

export function buildResultRegistrationEvent(job, result, { attempt = 1 } = {}) {
  const normalizedResult = normalizeSnapshotResult(result, job);
  const retry = classifySnapshotFailure({
    classification: normalizedResult.failures[0]?.classification,
    attempt,
    maxAttempts: job.maxAttempts,
  });
  return Object.freeze({
    eventVersion: 'influencer-intelligence/snapshot-result/v1',
    eventType: 'snapshot_result_registered',
    eventId: `ii:result:${hash({ idempotencyKey: job.idempotencyKey, status: normalizedResult.status }).slice(0, 48)}`,
    idempotencyKey: `${job.idempotencyKey}:result`,
    schedulerRunKey: job.schedulerRunKey,
    operation: job.operation,
    creatorKey: job.creatorKey,
    attempt,
    status: normalizedResult.status,
    coverage: normalizedResult.coverage,
    freshness: normalizedResult.freshness,
    failureCount: normalizedResult.failureCount,
    retry: {
      classification: retry.classification,
      retryable: normalizedResult.status === 'failed' && retry.retryable,
      sameIdempotencyKey: retry.sameIdempotencyKey,
    },
  });
}
