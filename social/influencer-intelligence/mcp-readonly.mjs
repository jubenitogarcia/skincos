/**
 * Authenticated, bounded, read-only MCP adapter for Influencer Intelligence.
 *
 * The transport gateway owns bearer validation. This adapter accepts only the
 * resulting authentication context and delegates to an injected internal read
 * service. It never calls a provider, opens a database, executes shell, or
 * constructs a query. The same gateway conventions used by
 * orb/engine/mcp-readonly-gateway are enforced here so M8 can mount the
 * service without widening this boundary.
 */

import { randomUUID } from 'node:crypto';

import {
  assertNoSensitiveFields,
  normalizeCreatorKey,
  normalizeProviderId,
} from './contracts.mjs';

export const MCP_READONLY_CONTRACT_VERSION = 'influencer-intelligence/mcp/v1';
export const MCP_READONLY_SERVER_VERSION = 'influencer-intelligence-mcp/v1';

export const MCP_READONLY_LIMITS = Object.freeze({
  maxRequestBytes: 64 * 1024,
  maxResponseBytes: 512 * 1024,
  maxPageSize: 50,
  maxCreatorsPerRequest: 20,
  maxWindowDays: 365,
  maxConcurrentRequests: 4,
  timeoutMs: 12_000,
  rateLimitPerMinute: 60,
  maxStringLength: 160,
});

export const MCP_ERROR_CODES = Object.freeze([
  'AUTH_REQUIRED',
  'GRANT_REQUIRED',
  'INVALID_INPUT',
  'INVALID_SERVICE_RESPONSE',
  'NOT_FOUND',
  'UNAVAILABLE',
  'RATE_LIMITED',
  'TOO_MANY_CONCURRENT_REQUESTS',
  'TIMEOUT',
  'AUDIT_UNAVAILABLE',
  'SANITIZATION_FAILED',
  'INTERNAL',
]);

const DATA_CLASSIFICATIONS = new Set(['observed', 'derived', 'inferred', 'unavailable']);
const FRESHNESS_STATES = new Set(['fresh', 'stale', 'unknown']);
const REGISTRY_STATES = new Set(['candidate', 'paused', 'unavailable']);
const SUPPORTED_SOURCE_TYPES = new Set([
  'registry',
  'profile',
  'media',
  'analysis',
  'score',
  'comparison',
  'comments-aggregate',
  'content-features',
  'campaign-fit',
]);
const SAFE_LIMITATION_PATTERN = /^[A-Za-z0-9._:/ -]{1,240}$/;
const SAFE_SEARCH_PATTERN = /^[A-Za-z0-9._@ -]{1,80}$/;
const SAFE_ACTOR_SCOPE_PATTERN = /^[A-Za-z0-9._:-]{1,160}$/;
const SAFE_SOURCE_REF_PATTERN = /^[A-Za-z0-9._:/-]{1,240}$/;
const SENSITIVE_OUTPUT_KEY = /(?:access[_-]?token|refresh[_-]?token|id[_-]?token|authorization|cookie|credential|secret|client.?secret|password|api[_-]?key|session|session.?id|provider.?account|raw.?provider|raw.?payload|raw.?comment|comment.?text|caption|media.?url|image.?url|video.?url|binary|private.?key|email|phone|telephone|cpf|sql|shell|command|prompt|completion)/i;
const SENSITIVE_OUTPUT_TEXT = /(?:bearer\s+[A-Za-z0-9._-]{8,}|(?:access[_-]?token|refresh[_-]?token|api[_-]?key|password|client[_ -]?secret|authorization|cookie)\s*[:=]|[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}|\b\d{3}\.\d{3}\.\d{3}-?\d{2}\b)/i;
const FIXED_ERROR_MESSAGES = Object.freeze({
  AUTH_REQUIRED: 'authentication is required',
  GRANT_REQUIRED: 'the Influencer Intelligence grant is required',
  INVALID_INPUT: 'request arguments are invalid',
  INVALID_SERVICE_RESPONSE: 'the internal service returned an invalid response',
  NOT_FOUND: 'creator was not found',
  UNAVAILABLE: 'the requested analysis is unavailable',
  RATE_LIMITED: 'rate limit exceeded',
  TOO_MANY_CONCURRENT_REQUESTS: 'too many concurrent requests',
  TIMEOUT: 'the read operation timed out',
  AUDIT_UNAVAILABLE: 'audit storage is unavailable',
  SANITIZATION_FAILED: 'response sanitization failed',
  INTERNAL: 'internal read failure',
});

const STORE_METHODS = Object.freeze({
  search_creators: 'searchCreators',
  get_creator_profile: 'getCreatorProfile',
  get_creator_snapshots: 'getCreatorSnapshots',
  get_creator_media: 'getCreatorMedia',
  get_creator_analytics: 'getCreatorAnalytics',
  get_creator_score: 'getCreatorScore',
  compare_creators: 'compareCreators',
});

function isRecord(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function fail(code, message = FIXED_ERROR_MESSAGES[code] || FIXED_ERROR_MESSAGES.INTERNAL) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function assertCondition(condition, code, message) {
  if (!condition) throw fail(code, message);
}

function finiteNumber(value, label, { minimum = 0, maximum = Number.POSITIVE_INFINITY } = {}) {
  assertCondition(typeof value === 'number' && Number.isFinite(value), 'INVALID_SERVICE_RESPONSE', `${label} must be finite`);
  assertCondition(value >= minimum && value <= maximum, 'INVALID_SERVICE_RESPONSE', `${label} is outside its range`);
  return Number(value.toFixed(6));
}

function finiteInteger(value, label, { minimum = 0, maximum = Number.POSITIVE_INFINITY } = {}) {
  assertCondition(Number.isInteger(value), 'INVALID_SERVICE_RESPONSE', `${label} must be an integer`);
  assertCondition(value >= minimum && value <= maximum, 'INVALID_SERVICE_RESPONSE', `${label} is outside its range`);
  return value;
}

function normalizedTimestamp(value, label, code = 'INVALID_SERVICE_RESPONSE') {
  assertCondition(typeof value === 'string' && value.length <= 40, code, `${label} must be an ISO timestamp`);
  const parsed = new Date(value);
  assertCondition(!Number.isNaN(parsed.getTime()), code, `${label} must be an ISO timestamp`);
  return parsed.toISOString();
}

function normalizedString(value, label, { maximum = MCP_READONLY_LIMITS.maxStringLength, pattern = null } = {}) {
  assertCondition(typeof value === 'string', 'INVALID_INPUT', `${label} must be a string`);
  const result = value.trim();
  assertCondition(result.length > 0 && result.length <= maximum, 'INVALID_INPUT', `${label} is invalid`);
  assertCondition(!/[\u0000-\u001f\u007f]/.test(result), 'INVALID_INPUT', `${label} contains a control character`);
  if (pattern) assertCondition(pattern.test(result), 'INVALID_INPUT', `${label} contains unsupported characters`);
  return result;
}

function optionalString(value, label, options = {}) {
  if (value === undefined || value === null || value === '') return undefined;
  return normalizedString(value, label, options);
}

function pageValue(value, label, fallback, maximum) {
  if (value === undefined) return fallback;
  assertCondition(Number.isInteger(value) && value >= 1 && value <= maximum, 'INVALID_INPUT', `${label} is invalid`);
  return value;
}

function normalizeWindow(value) {
  if (value === undefined || value === null) return undefined;
  assertCondition(isRecord(value), 'INVALID_INPUT', 'window must be an object');
  const keys = Object.keys(value);
  assertCondition(keys.every((key) => key === 'start' || key === 'end'), 'INVALID_INPUT', 'window contains unsupported fields');
  assertCondition(typeof value.start === 'string' && typeof value.end === 'string', 'INVALID_INPUT', 'window requires start and end');
  const start = normalizedTimestamp(value.start, 'window.start', 'INVALID_INPUT');
  const end = normalizedTimestamp(value.end, 'window.end', 'INVALID_INPUT');
  const startMs = Date.parse(start);
  const endMs = Date.parse(end);
  assertCondition(endMs > startMs, 'INVALID_INPUT', 'window.end must follow window.start');
  assertCondition(endMs - startMs <= MCP_READONLY_LIMITS.maxWindowDays * 24 * 60 * 60 * 1000, 'INVALID_INPUT', 'window exceeds the maximum duration');
  return { start, end };
}

function normalizeCreatorKeys(value) {
  assertCondition(Array.isArray(value), 'INVALID_INPUT', 'creator_keys must be an array');
  assertCondition(value.length >= 1 && value.length <= MCP_READONLY_LIMITS.maxCreatorsPerRequest, 'INVALID_INPUT', 'creator_keys count is outside the allowed range');
  const keys = value.map((item) => normalizeCreatorKey(item));
  assertCondition(new Set(keys).size === keys.length, 'INVALID_INPUT', 'creator_keys must be unique');
  return keys;
}

function normalizeInput(toolName, input = {}) {
  assertCondition(isRecord(input), 'INVALID_INPUT', 'tool arguments must be an object');
  const allowed = {
    search_creators: new Set(['query', 'provider', 'registry_state', 'page', 'page_size']),
    get_creator_profile: new Set(['creator_key']),
    get_creator_snapshots: new Set(['creator_key', 'window', 'page', 'page_size']),
    get_creator_media: new Set(['creator_key', 'window', 'page', 'page_size']),
    get_creator_analytics: new Set(['creator_key', 'window']),
    get_creator_score: new Set(['creator_key']),
    compare_creators: new Set(['creator_keys', 'window']),
  }[toolName];
  assertCondition(allowed, 'INVALID_INPUT', 'tool is not registered');
  assertCondition(Object.keys(input).every((key) => allowed.has(key)), 'INVALID_INPUT', 'additional tool arguments are not allowed');
  assertNoSensitiveFields(input, `tools.call.${toolName}`);

  if (toolName === 'search_creators') {
    const query = optionalString(input.query, 'query', { maximum: 80, pattern: SAFE_SEARCH_PATTERN });
    const provider = input.provider === undefined ? undefined : normalizeProviderId(input.provider);
    const registryState = input.registry_state === undefined ? undefined : normalizedString(input.registry_state, 'registry_state', { maximum: 32 });
    assertCondition(registryState === undefined || REGISTRY_STATES.has(registryState), 'INVALID_INPUT', 'registry_state is invalid');
    return {
      ...(query ? { query } : {}),
      ...(provider ? { provider } : {}),
      ...(registryState ? { registry_state: registryState } : {}),
      page: pageValue(input.page, 'page', 1, 100000),
      page_size: pageValue(input.page_size, 'page_size', 25, MCP_READONLY_LIMITS.maxPageSize),
    };
  }

  if (toolName === 'compare_creators') {
    const window = normalizeWindow(input.window);
    return { creator_keys: normalizeCreatorKeys(input.creator_keys), ...(window ? { window } : {}) };
  }

  const creatorKey = normalizeCreatorKey(input.creator_key);
  if (toolName === 'get_creator_profile' || toolName === 'get_creator_score') return { creator_key: creatorKey };
  const window = normalizeWindow(input.window);
  if (toolName === 'get_creator_analytics') return { creator_key: creatorKey, ...(window ? { window } : {}) };
  return {
    creator_key: creatorKey,
    ...(window ? { window } : {}),
    page: pageValue(input.page, 'page', 1, 100000),
    page_size: pageValue(input.page_size, 'page_size', 25, MCP_READONLY_LIMITS.maxPageSize),
  };
}

function safeRpcId(value) {
  if (value === undefined || value === null) return null;
  if (Number.isInteger(value) && value >= 0) return value;
  if (typeof value === 'string' && /^[A-Za-z0-9._:-]{1,80}$/.test(value)) return value;
  return null;
}

function validateRpc(rpc) {
  assertCondition(isRecord(rpc), 'INVALID_INPUT', 'JSON-RPC request must be an object');
  assertCondition(rpc.jsonrpc === '2.0', 'INVALID_INPUT', 'JSON-RPC version is unsupported');
  assertCondition(typeof rpc.method === 'string' && /^[A-Za-z0-9_./:-]{1,80}$/.test(rpc.method), 'INVALID_INPUT', 'JSON-RPC method is invalid');
  return safeRpcId(rpc.id);
}

function normalizeAuthContext(context) {
  try {
    assertNoSensitiveFields(context, 'auth_context');
  } catch {
    throw fail('AUTH_REQUIRED');
  }
  assertCondition(isRecord(context) && context.authenticated === true, 'AUTH_REQUIRED');
  const grants = Array.isArray(context.grants) ? context.grants : [];
  const hasGrant = context.grant === 'module.influencer-intelligence.access'
    || grants.includes('module.influencer-intelligence.access');
  assertCondition(hasGrant, 'GRANT_REQUIRED');
  const actorScope = normalizedString(context.actor_scope, 'actor_scope', { maximum: 160, pattern: SAFE_ACTOR_SCOPE_PATTERN });
  const dataScope = context.data_scope === undefined
    ? null
    : normalizedString(context.data_scope, 'data_scope', { maximum: 160, pattern: SAFE_ACTOR_SCOPE_PATTERN });
  return { actor_scope: actorScope, data_scope: dataScope };
}

function createDefaultClock() {
  return () => Date.now();
}

export function createFixedWindowRateLimiter({
  limit = MCP_READONLY_LIMITS.rateLimitPerMinute,
  windowMs = 60_000,
  clock = createDefaultClock(),
  maxKeys = 10_000,
} = {}) {
  assertCondition(Number.isInteger(limit) && limit > 0, 'INVALID_INPUT', 'rate limit must be positive');
  assertCondition(Number.isInteger(windowMs) && windowMs > 0, 'INVALID_INPUT', 'rate window must be positive');
  const windows = new Map();
  return Object.freeze({
    allow(key) {
      const now = clock();
      const normalizedKey = normalizedString(key, 'rate_limit_key', { maximum: 160, pattern: SAFE_ACTOR_SCOPE_PATTERN });
      for (const [entryKey, stamps] of windows) {
        const active = stamps.filter((stamp) => now - stamp < windowMs);
        if (active.length === 0) windows.delete(entryKey);
        else windows.set(entryKey, active);
      }
      const current = windows.get(normalizedKey) || [];
      if (current.length >= limit) return false;
      if (!windows.has(normalizedKey) && windows.size >= maxKeys) {
        const oldest = windows.keys().next().value;
        if (oldest !== undefined) windows.delete(oldest);
      }
      current.push(now);
      windows.set(normalizedKey, current);
      return true;
    },
    reset() {
      windows.clear();
    },
  });
}

function normalizeCoverage(value) {
  assertCondition(isRecord(value), 'INVALID_SERVICE_RESPONSE', 'coverage is required');
  const available = value.available_metrics ?? value.availableMetrics;
  const expected = value.expected_metrics ?? value.expectedMetrics;
  finiteInteger(available, 'coverage.available_metrics');
  finiteInteger(expected, 'coverage.expected_metrics', { minimum: 1 });
  assertCondition(available <= expected, 'INVALID_SERVICE_RESPONSE', 'coverage.available_metrics exceeds expected_metrics');
  const ratio = Number((available / expected).toFixed(6));
  return {
    available_metrics: available,
    expected_metrics: expected,
    ratio,
    score: Number((ratio * 100).toFixed(2)),
  };
}

function assertResponseSize(value) {
  let serialized;
  try { serialized = JSON.stringify(value); } catch { throw fail('SANITIZATION_FAILED'); }
  assertCondition(typeof serialized === 'string', 'SANITIZATION_FAILED', 'response is not serializable');
  const bytes = new TextEncoder().encode(serialized).byteLength;
  assertCondition(bytes <= MCP_READONLY_LIMITS.maxResponseBytes, 'SANITIZATION_FAILED', 'response exceeds the limit');
  return value;
}

function normalizeProvenance(value) {
  assertCondition(Array.isArray(value), 'INVALID_SERVICE_RESPONSE', 'provenance is required');
  assertCondition(value.length <= 32, 'INVALID_SERVICE_RESPONSE', 'provenance is too large');
  return value.map((entry, index) => {
    assertCondition(isRecord(entry), 'INVALID_SERVICE_RESPONSE', `provenance[${index}] is invalid`);
    const provider = entry.provider === null || entry.provider === undefined
      ? null
      : normalizeProviderId(entry.provider, `provenance[${index}].provider`);
    const sourceType = normalizedString(entry.source_type ?? entry.sourceType, `provenance[${index}].source_type`, { maximum: 40 });
    assertCondition(SUPPORTED_SOURCE_TYPES.has(sourceType), 'INVALID_SERVICE_RESPONSE', `provenance[${index}].source_type is invalid`);
    const sourceRef = normalizedString(entry.source_ref ?? entry.sourceRef, `provenance[${index}].source_ref`, { maximum: 240, pattern: SAFE_SOURCE_REF_PATTERN });
    const observedAt = normalizedTimestamp(entry.observed_at ?? entry.observedAt, `provenance[${index}].observed_at`);
    const retrievedAt = normalizedTimestamp(entry.retrieved_at ?? entry.retrievedAt, `provenance[${index}].retrieved_at`);
    assertCondition(Date.parse(retrievedAt) >= Date.parse(observedAt), 'INVALID_SERVICE_RESPONSE', 'retrieved_at cannot precede observed_at');
    const evidenceState = normalizedString(entry.evidence_state ?? entry.evidenceState, `provenance[${index}].evidence_state`, { maximum: 16 });
    assertCondition(DATA_CLASSIFICATIONS.has(evidenceState), 'INVALID_SERVICE_RESPONSE', 'provenance evidence_state is invalid');
    return { provider, source_type: sourceType, source_ref: sourceRef, observed_at: observedAt, retrieved_at: retrievedAt, evidence_state: evidenceState };
  });
}

function normalizeLimitations(value) {
  assertCondition(Array.isArray(value), 'INVALID_SERVICE_RESPONSE', 'limitations are required');
  assertCondition(value.length <= 32, 'INVALID_SERVICE_RESPONSE', 'limitations are too large');
  return value.map((item, index) => normalizedString(item, `limitations[${index}]`, { maximum: 240, pattern: SAFE_LIMITATION_PATTERN }));
}

function normalizeProviders(value) {
  assertCondition(Array.isArray(value), 'INVALID_SERVICE_RESPONSE', 'providers are required');
  assertCondition(value.length <= 8, 'INVALID_SERVICE_RESPONSE', 'providers are too large');
  const providers = value.map((item, index) => normalizeProviderId(item, `providers[${index}]`));
  return [...new Set(providers)].sort();
}

function normalizeDataClassification(value) {
  const state = normalizedString(value, 'data_classification', { maximum: 16 });
  assertCondition(DATA_CLASSIFICATIONS.has(state), 'INVALID_SERVICE_RESPONSE', 'data_classification is invalid');
  return state;
}

function normalizeFreshness(value) {
  const freshness = normalizedString(value, 'freshness', { maximum: 16 });
  assertCondition(FRESHNESS_STATES.has(freshness), 'INVALID_SERVICE_RESPONSE', 'freshness is invalid');
  return freshness;
}

function sanitizeText(value) {
  let text = String(value)
    .replace(/https?:\/\/[^\s"']*(?:[?&](?:signature|sig|token|access_token|x-amz-signature)=[^\s"']*)/gi, '[redacted-signed-url]')
    .replace(/\b(?:bearer\s+|basic\s+|access[_-]?token\s*[=:]\s*|refresh[_-]?token\s*[=:]\s*|api[_-]?key\s*[=:]\s*|password\s*[=:]\s*)[^\s,;"']+/gi, '[redacted-secret]')
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, '[redacted-email]')
    .replace(/\b\d{3}\.?\d{3}\.?\d{3}-?\d{2}\b/g, '[redacted-cpf]');
  return text.length > 800 ? `${text.slice(0, 800)}…[truncated]` : text;
}

function sanitizeValue(value, depth = 0, seen = new Set()) {
  if (depth > 8) return '[truncated-depth]';
  if (typeof value === 'string') return sanitizeText(value);
  if (typeof value === 'number' || typeof value === 'boolean' || value === null) return value;
  if (value === undefined) return null;
  if (typeof value !== 'object') return '[unsupported]';
  if (seen.has(value)) throw fail('SANITIZATION_FAILED');
  seen.add(value);
  try {
    if (Array.isArray(value)) return value.slice(0, 100).map((item) => sanitizeValue(item, depth + 1, seen));
    const output = {};
    for (const [key, child] of Object.entries(value).slice(0, 100)) {
      if (SENSITIVE_OUTPUT_KEY.test(key)) continue;
      const safeKey = sanitizeText(key).replace(/[^A-Za-z0-9_.-]/g, '_').slice(0, 120);
      output[safeKey] = sanitizeValue(child, depth + 1, seen);
    }
    return output;
  } finally {
    seen.delete(value);
  }
}

function assertNoSensitiveOutput(value) {
  let serialized;
  try { serialized = JSON.stringify(value); } catch { throw fail('SANITIZATION_FAILED'); }
  assertCondition(!SENSITIVE_OUTPUT_TEXT.test(serialized), 'SANITIZATION_FAILED');
  return value;
}

function normalizeServiceResult(raw, requestId, clock) {
  assertCondition(isRecord(raw), 'INVALID_SERVICE_RESPONSE');
  assertCondition(Object.prototype.hasOwnProperty.call(raw, 'data'), 'INVALID_SERVICE_RESPONSE');
  const dataClassification = normalizeDataClassification(raw.data_classification ?? raw.dataClassification);
  const freshness = normalizeFreshness(raw.freshness);
  const retrievedAt = normalizedTimestamp(raw.retrieved_at ?? raw.retrievedAt, 'retrieved_at');
  const coverage = normalizeCoverage(raw.coverage);
  const confidenceScore = raw.confidence_score === undefined
    ? Number((finiteNumber(raw.confidence, 'confidence', { maximum: 1 }) * 100).toFixed(2))
    : finiteNumber(raw.confidence_score, 'confidence_score', { maximum: 100 });
  if (dataClassification === 'unavailable') {
    assertCondition(raw.data === null, 'INVALID_SERVICE_RESPONSE', 'unavailable data must be null');
    assertCondition(confidenceScore === 0, 'INVALID_SERVICE_RESPONSE', 'unavailable data must have zero confidence');
    assertCondition((raw.coverage.available_metrics ?? raw.coverage.availableMetrics) === 0, 'INVALID_SERVICE_RESPONSE', 'unavailable data must have zero available metrics');
  } else {
    assertCondition(raw.data !== undefined && raw.data !== null, 'INVALID_SERVICE_RESPONSE', 'available data must be present');
  }
  const providers = normalizeProviders(raw.providers);
  const provenance = normalizeProvenance(raw.provenance);
  const limitations = normalizeLimitations(raw.limitations);
  const errors = raw.errors === undefined ? [] : normalizeLimitations(raw.errors);
  const data = sanitizeValue(raw.data);
  assertNoSensitiveOutput(data);
  const generatedAt = new Date(clock()).toISOString();
  return {
    contract_version: MCP_READONLY_CONTRACT_VERSION,
    request_id: requestId,
    generated_at: generatedAt,
    data_classification: dataClassification,
    freshness,
    retrieved_at: retrievedAt,
    data,
    confidence_score: confidenceScore,
    data_coverage: coverage.score,
    coverage,
    providers,
    provenance,
    limitations,
    errors,
  };
}

function rpcResult(id, result) {
  return { jsonrpc: '2.0', id, result };
}

function rpcError(id, code) {
  const numeric = {
    AUTH_REQUIRED: -32001,
    GRANT_REQUIRED: -32003,
    RATE_LIMITED: -32029,
    TOO_MANY_CONCURRENT_REQUESTS: -32030,
    TIMEOUT: -32012,
    AUDIT_UNAVAILABLE: -32070,
    SANITIZATION_FAILED: -32071,
  }[code] || -32602;
  return { jsonrpc: '2.0', id, error: { code: numeric, message: FIXED_ERROR_MESSAGES[code] || FIXED_ERROR_MESSAGES.INTERNAL, data: { error_code: code } } };
}

function errorCode(error) {
  return MCP_ERROR_CODES.includes(error?.code) ? error.code : 'INTERNAL';
}

function toolDefinitions() {
  return [
    { name: 'search_creators', description: 'Search bounded creator registry projections without contacting a provider.', inputSchema: { type: 'object', properties: { query: { type: 'string', maxLength: 80 }, provider: { type: 'string', enum: ['meta-graph', 'instagrapi'] }, registry_state: { type: 'string', enum: ['candidate', 'paused', 'unavailable'] }, page: { type: 'integer', minimum: 1 }, page_size: { type: 'integer', minimum: 1, maximum: 50 } }, additionalProperties: false } },
    { name: 'get_creator_profile', description: 'Return the latest sanitized creator profile projection.', inputSchema: { type: 'object', properties: { creator_key: { type: 'string', minLength: 1, maxLength: 128 } }, required: ['creator_key'], additionalProperties: false } },
    { name: 'get_creator_snapshots', description: 'Return bounded historical profile snapshots with freshness and provenance.', inputSchema: { type: 'object', properties: { creator_key: { type: 'string', minLength: 1, maxLength: 128 }, window: { type: 'object', properties: { start: { type: 'string', format: 'date-time' }, end: { type: 'string', format: 'date-time' } }, required: ['start', 'end'], additionalProperties: false }, page: { type: 'integer', minimum: 1 }, page_size: { type: 'integer', minimum: 1, maximum: 50 } }, required: ['creator_key'], additionalProperties: false } },
    { name: 'get_creator_media', description: 'Return bounded creator media metrics without media binaries or raw captions.', inputSchema: { type: 'object', properties: { creator_key: { type: 'string', minLength: 1, maxLength: 128 }, window: { type: 'object', properties: { start: { type: 'string', format: 'date-time' }, end: { type: 'string', format: 'date-time' } }, required: ['start', 'end'], additionalProperties: false }, page: { type: 'integer', minimum: 1 }, page_size: { type: 'integer', minimum: 1, maximum: 50 } }, required: ['creator_key'], additionalProperties: false } },
    { name: 'get_creator_analytics', description: 'Return the latest deterministic analytics artifact; never computes a new analysis.', inputSchema: { type: 'object', properties: { creator_key: { type: 'string', minLength: 1, maxLength: 128 }, window: { type: 'object', properties: { start: { type: 'string', format: 'date-time' }, end: { type: 'string', format: 'date-time' } }, required: ['start', 'end'], additionalProperties: false } }, required: ['creator_key'], additionalProperties: false } },
    { name: 'get_creator_score', description: 'Return the latest persisted deterministic Influencer Score artifact.', inputSchema: { type: 'object', properties: { creator_key: { type: 'string', minLength: 1, maxLength: 128 } }, required: ['creator_key'], additionalProperties: false } },
    { name: 'compare_creators', description: 'Return a bounded comparison from existing artifacts without recalculating scores.', inputSchema: { type: 'object', properties: { creator_keys: { type: 'array', minItems: 1, maxItems: 20, items: { type: 'string', minLength: 1, maxLength: 128 } }, window: { type: 'object', properties: { start: { type: 'string', format: 'date-time' }, end: { type: 'string', format: 'date-time' } }, required: ['start', 'end'], additionalProperties: false } }, required: ['creator_keys'], additionalProperties: false } },
  ].map((definition) => Object.freeze(definition));
}

export const MCP_READONLY_TOOLS = Object.freeze(toolDefinitions());

function protocolResult(id, method) {
  if (method === 'initialize') return rpcResult(id, { protocolVersion: '2025-03-26', capabilities: { tools: {} }, serverInfo: { name: MCP_READONLY_SERVER_VERSION, version: MCP_READONLY_SERVER_VERSION } });
  if (method === 'ping') return rpcResult(id, {});
  if (method === 'notifications/initialized') return { jsonrpc: '2.0', id: null, result: {} };
  return null;
}

function requireReadService(readService) {
  assertCondition(isRecord(readService), 'INVALID_INPUT', 'read service is required');
  for (const method of Object.values(STORE_METHODS)) assertCondition(typeof readService[method] === 'function', 'INVALID_INPUT', `read service method ${method} is required`);
}

export function createInfluencerIntelligenceMcpGateway({
  readService,
  audit,
  clock = createDefaultClock(),
  rateLimiter = createFixedWindowRateLimiter({ clock }),
  maxConcurrentRequests = MCP_READONLY_LIMITS.maxConcurrentRequests,
  timeoutMs = MCP_READONLY_LIMITS.timeoutMs,
} = {}) {
  requireReadService(readService);
  assertCondition(typeof audit === 'function', 'INVALID_INPUT', 'audit function is required');
  assertCondition(Number.isInteger(maxConcurrentRequests) && maxConcurrentRequests > 0, 'INVALID_INPUT', 'maxConcurrentRequests is invalid');
  assertCondition(Number.isInteger(timeoutMs) && timeoutMs > 0 && timeoutMs <= MCP_READONLY_LIMITS.timeoutMs, 'INVALID_INPUT', 'timeoutMs is invalid');
  let concurrent = 0;

  async function recordAudit({ requestId, tool, ok, code, context, startedAt }) {
    const event = {
      request_id: requestId,
      tool: tool || 'protocol',
      ok: Boolean(ok),
      error_code: code || null,
      actor_scope: context?.actor_scope || null,
      duration_ms: Math.max(0, clock() - startedAt),
      at: new Date(clock()).toISOString(),
    };
    try {
      await audit(event);
    } catch {
      throw fail('AUDIT_UNAVAILABLE');
    }
  }

  async function invoke(toolName, input, context, requestId, signal) {
    let normalized;
    try {
      normalized = normalizeInput(toolName, input);
    } catch (error) {
      if (error?.code === 'INVALID_INPUT') throw error;
      throw fail('INVALID_INPUT');
    }
    const method = STORE_METHODS[toolName];
    const controller = new AbortController();
    const forwardAbort = () => controller.abort();
    if (signal) signal.addEventListener('abort', forwardAbort, { once: true });
    if (signal?.aborted) controller.abort();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const resultPromise = Promise.resolve().then(() => readService[method](normalized, {
        signal: controller.signal,
        request_id: requestId,
        actor_scope: context.actor_scope,
        data_scope: context.data_scope,
      }));
      const timeoutPromise = new Promise((_, reject) => {
        const onAbort = () => reject(fail('TIMEOUT'));
        if (controller.signal.aborted) onAbort();
        else controller.signal.addEventListener('abort', onAbort, { once: true });
      });
      const raw = await Promise.race([resultPromise, timeoutPromise]);
      try {
        return normalizeServiceResult(raw, requestId, clock);
      } catch (error) {
        if (error?.code === 'INVALID_SERVICE_RESPONSE') throw error;
        throw fail('INVALID_SERVICE_RESPONSE');
      }
    } catch (error) {
      if (error?.code === 'NOT_FOUND' || error?.code === 'UNAVAILABLE') throw fail(error.code);
      if (error?.code === 'TIMEOUT' || controller.signal.aborted) throw fail('TIMEOUT');
      if (error?.code === 'INVALID_INPUT') throw fail('INVALID_INPUT');
      throw fail(error?.code && MCP_ERROR_CODES.includes(error.code) ? error.code : 'INTERNAL');
    } finally {
      clearTimeout(timer);
      if (signal) signal.removeEventListener('abort', forwardAbort);
    }
  }

  async function handleRpc({ rpc, context, requestBytes, signal } = {}) {
    const startedAt = clock();
    const id = safeRpcId(rpc?.id);
    const requestId = id === null ? randomUUID() : id;
    const toolName = typeof rpc?.params?.name === 'string' ? rpc.params.name : null;
    let normalizedContext = null;
    let outcome;
    let outcomeCode = null;
    try {
      assertCondition(requestBytes === undefined || (Number.isInteger(requestBytes) && requestBytes >= 0 && requestBytes <= MCP_READONLY_LIMITS.maxRequestBytes), 'INVALID_INPUT', 'request body exceeds the limit');
      validateRpc(rpc);
      normalizedContext = normalizeAuthContext(context);
      let allowed;
      try { allowed = rateLimiter.allow(normalizedContext.actor_scope); } catch { throw fail('RATE_LIMITED'); }
      assertCondition(allowed, 'RATE_LIMITED');

      const protocol = protocolResult(id, rpc.method);
      if (protocol) {
        outcome = protocol;
      } else if (rpc.method === 'tools/list') {
        outcome = rpcResult(id, { tools: MCP_READONLY_TOOLS });
      } else if (rpc.method === 'tools/call') {
        assertCondition(typeof toolName === 'string' && Object.hasOwn(STORE_METHODS, toolName), 'INVALID_INPUT', 'tool is not registered');
        assertCondition(concurrent < maxConcurrentRequests, 'TOO_MANY_CONCURRENT_REQUESTS');
        concurrent += 1;
        try {
          const data = await invoke(toolName, rpc.params.arguments || {}, normalizedContext, requestId, signal);
          outcome = rpcResult(id, { content: [{ type: 'text', text: JSON.stringify(data) }], structuredContent: data });
        } finally {
          concurrent -= 1;
        }
      } else {
        throw fail('INVALID_INPUT');
      }
      const safe = sanitizeValue(outcome);
      assertNoSensitiveOutput(safe);
      assertResponseSize(safe);
      outcome = safe;
    } catch (error) {
      outcomeCode = errorCode(error);
      outcome = rpcError(id, outcomeCode);
    }

    try {
      await recordAudit({ requestId: id, tool: toolName, ok: outcomeCode === null, code: outcomeCode, context: normalizedContext, startedAt });
    } catch (error) {
      return rpcError(id, errorCode(error));
    }
    return outcome;
  }

  return Object.freeze({
    handleRpc,
    tools: MCP_READONLY_TOOLS,
    limits: MCP_READONLY_LIMITS,
    contractVersion: MCP_READONLY_CONTRACT_VERSION,
  });
}

export const __testing = Object.freeze({
  normalizeInput,
  normalizeServiceResult,
  sanitizeValue,
  assertNoSensitiveOutput,
  assertResponseSize,
  normalizeWindow,
});
