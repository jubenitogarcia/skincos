/**
 * Stable boundary for Influencer Intelligence evidence and score payloads.
 *
 * This module is deliberately pure: it performs no network, filesystem,
 * database, provider, or scheduling work. Provider adapters and consumers must
 * normalize through this boundary before a payload can be persisted or scored.
 */

export const INFLUENCER_INTELLIGENCE_CONTRACT_VERSION = 'influencer-intelligence/v1';

export const EVIDENCE_STATES = Object.freeze([
  'observed',
  'derived',
  'inferred',
  'unavailable',
]);

export const SUPPORTED_PROVIDER_IDS = Object.freeze([
  'meta-graph',
  'instagrapi',
]);

export const SOURCE_TYPES = Object.freeze([
  'profile',
  'media',
  'comments-aggregate',
  'insights',
  'synthetic',
]);

export const SCORE_KINDS = Object.freeze([
  'influencer',
  'campaign-fit',
  'brand-fit',
  'risk',
]);

const evidenceStateSet = new Set(EVIDENCE_STATES);
const providerSet = new Set(SUPPORTED_PROVIDER_IDS);
const sourceTypeSet = new Set(SOURCE_TYPES);
const scoreKindSet = new Set(SCORE_KINDS);
const forbiddenKeySet = new Set([
  'accesstoken',
  'refreshtoken',
  'idtoken',
  'token',
  'authorization',
  'cookie',
  'cookies',
  'session',
  'sessionid',
  'password',
  'secret',
  'apikey',
  'clientsecret',
  'email',
  'phone',
  'telephone',
  'username',
]);
const sensitiveStringPattern = /(?:^|[?&\s])(?:access[_-]?token|refresh[_-]?token|authorization|cookie|password|secret|api[_-]?key)\s*[:=]/i;
const controlCharacterPattern = /[\u0000-\u001f\u007f]/;

export class InfluencerIntelligenceContractError extends Error {
  constructor(message) {
    super(message);
    this.name = 'InfluencerIntelligenceContractError';
  }
}

function fail(message) {
  throw new InfluencerIntelligenceContractError(message);
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

function normalizedKey(value) {
  return String(value).replace(/[^a-z0-9]/gi, '').toLowerCase();
}

/**
 * Rejects secrets and direct contact identifiers before normalization. This is
 * intentionally stricter than the current incumbent integrations: the new
 * contract is not allowed to become a transport for credentials or raw PII.
 */
export function assertNoSensitiveFields(value, path = 'input', seen = new Set()) {
  if (typeof value === 'string') {
    if (sensitiveStringPattern.test(value)) fail(`${path} contains a credential-like assignment`);
    return;
  }
  if (!value || typeof value !== 'object') return;
  if (seen.has(value)) fail(`${path} contains a circular value`);
  seen.add(value);
  if (Array.isArray(value)) {
    value.forEach((item, index) => assertNoSensitiveFields(item, `${path}[${index}]`, seen));
    seen.delete(value);
    return;
  }
  for (const [key, child] of Object.entries(value)) {
    if (forbiddenKeySet.has(normalizedKey(key))) fail(`${path}.${key} is not permitted in a domain contract`);
    assertNoSensitiveFields(child, `${path}.${key}`, seen);
  }
  seen.delete(value);
}

function assertRecord(value, label) {
  if (!isRecord(value)) fail(`${label} must be an object`);
}

function stringValue(value, label, { maxLength = 160, required = true } = {}) {
  if (value === undefined || value === null || value === '') {
    if (required) fail(`${label} is required`);
    return undefined;
  }
  if (typeof value !== 'string') fail(`${label} must be a string`);
  const normalized = value.trim();
  if (!normalized && required) fail(`${label} must not be empty`);
  if (normalized.length > maxLength) fail(`${label} exceeds ${maxLength} characters`);
  if (controlCharacterPattern.test(normalized)) fail(`${label} contains a control character`);
  if (sensitiveStringPattern.test(normalized)) fail(`${label} contains a credential-like assignment`);
  return normalized;
}

function slugValue(value, label, { maxLength = 64 } = {}) {
  const normalized = stringValue(value, label, { maxLength });
  if (!/^[a-z][a-z0-9._-]*$/.test(normalized)) fail(`${label} must be a lowercase slug`);
  return normalized;
}

function versionValue(value, label) {
  const normalized = stringValue(value, label, { maxLength: 80 });
  if (!/^[a-z][a-z0-9._/-]*$/.test(normalized)) fail(`${label} must be a lowercase version identifier`);
  return normalized;
}

function opaqueId(value, label, { maxLength = 128 } = {}) {
  const normalized = stringValue(value, label, { maxLength });
  if (!/^[A-Za-z0-9._:-]+$/.test(normalized)) fail(`${label} must be an opaque identifier`);
  return normalized;
}

function enumValue(value, label, values, allowed) {
  const normalized = stringValue(value, label, { maxLength: 64 }).toLowerCase();
  if (!allowed.has(normalized)) fail(`${label} must be one of ${values.join(', ')}`);
  return normalized;
}

function unitInterval(value, label) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 1) {
    fail(`${label} must be a finite number between 0 and 1`);
  }
  return Number(value.toFixed(6));
}

function scoreValue(value, label) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 100) {
    fail(`${label} must be a finite number between 0 and 100`);
  }
  return Number(value.toFixed(4));
}

function integerValue(value, label, { minimum = 0 } = {}) {
  if (!Number.isInteger(value) || value < minimum) fail(`${label} must be an integer >= ${minimum}`);
  return value;
}

function timestampValue(value, label) {
  const normalized = stringValue(value, label, { maxLength: 40 });
  const parsed = new Date(normalized);
  if (Number.isNaN(parsed.getTime())) fail(`${label} must be an ISO timestamp`);
  return parsed.toISOString();
}

function safeSourceRef(value, label = 'sourceRef') {
  const normalized = stringValue(value, label, { maxLength: 240, required: false });
  if (normalized === undefined) return undefined;
  if (!/^[A-Za-z0-9._:/-]+$/.test(normalized)) {
    fail(`${label} must be an opaque path without query strings or fragments`);
  }
  return normalized;
}

function safeScalar(value, label) {
  if (value === undefined) return undefined;
  if (value === null || typeof value === 'boolean') return value;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) fail(`${label} must be finite`);
    return Number(value.toFixed(6));
  }
  if (typeof value === 'string') return stringValue(value, label, { maxLength: 160 });
  fail(`${label} must be a scalar; raw provider objects and text payloads are not allowed`);
}

function normalizeHandle(value) {
  const normalized = stringValue(value, 'handle', { maxLength: 30, required: false });
  if (normalized === undefined) return undefined;
  const handle = normalized.replace(/^@/, '').toLowerCase();
  if (!/^[a-z0-9._]{1,30}$/.test(handle)) fail('handle must be a valid Instagram handle');
  return handle;
}

function normalizeProvider(value, label = 'provider') {
  return enumValue(value, label, SUPPORTED_PROVIDER_IDS, providerSet);
}

function normalizeEvidenceState(value, label = 'evidenceState') {
  return enumValue(value, label, EVIDENCE_STATES, evidenceStateSet);
}

export function normalizeProvenance(input) {
  assertNoSensitiveFields(input, 'provenance');
  assertRecord(input, 'provenance');
  const provider = normalizeProvider(input.provider);
  const sourceType = enumValue(input.sourceType, 'sourceType', SOURCE_TYPES, sourceTypeSet);
  const evidenceState = normalizeEvidenceState(input.evidenceState);
  const observedAt = timestampValue(input.observedAt, 'observedAt');
  const retrievedAt = input.retrievedAt === undefined
    ? undefined
    : timestampValue(input.retrievedAt, 'retrievedAt');
  if (retrievedAt && new Date(retrievedAt).getTime() < new Date(observedAt).getTime()) {
    fail('retrievedAt must not precede observedAt');
  }
  const sourceRef = safeSourceRef(input.sourceRef);
  return deepFreeze({
    contractVersion: INFLUENCER_INTELLIGENCE_CONTRACT_VERSION,
    provider,
    sourceType,
    evidenceState,
    observedAt,
    ...(retrievedAt ? { retrievedAt } : {}),
    ...(sourceRef ? { sourceRef } : {}),
  });
}

export function normalizeCoverage(input) {
  assertNoSensitiveFields(input, 'coverage');
  assertRecord(input, 'coverage');
  const availableMetrics = integerValue(input.availableMetrics, 'coverage.availableMetrics');
  const expectedMetrics = integerValue(input.expectedMetrics, 'coverage.expectedMetrics', { minimum: 1 });
  if (availableMetrics > expectedMetrics) fail('coverage.availableMetrics cannot exceed expectedMetrics');
  return deepFreeze({
    availableMetrics,
    expectedMetrics,
    ratio: Number((availableMetrics / expectedMetrics).toFixed(6)),
  });
}

export function normalizeMetricObservation(input) {
  assertNoSensitiveFields(input, 'observation');
  assertRecord(input, 'observation');
  const key = slugValue(input.key, 'observation.key', { maxLength: 80 });
  const unit = slugValue(input.unit, 'observation.unit', { maxLength: 32 });
  const evidenceState = normalizeEvidenceState(input.evidenceState);
  const provenance = normalizeProvenance(input.provenance);
  const hasValue = input.value !== undefined && input.value !== null;
  if (evidenceState === 'unavailable' && hasValue) {
    fail('unavailable observations must not contain a value');
  }
  if (evidenceState !== 'unavailable' && !hasValue) {
    fail(`${key} must contain a value unless it is unavailable`);
  }
  if (provenance.evidenceState !== evidenceState) {
    fail(`${key} evidenceState must match provenance.evidenceState`);
  }
  if (provenance.provider !== normalizeProvider(input.provenance.provider, `${key}.provenance.provider`)) {
    fail(`${key} provider must match provenance.provider`);
  }
  const confidence = evidenceState === 'unavailable'
    ? 0
    : unitInterval(input.confidence === undefined ? (evidenceState === 'observed' ? 1 : 0) : input.confidence, 'observation.confidence');
  return deepFreeze({
    contractVersion: INFLUENCER_INTELLIGENCE_CONTRACT_VERSION,
    key,
    unit,
    value: evidenceState === 'unavailable' ? null : safeScalar(input.value, `observation.${key}.value`),
    evidenceState,
    confidence,
    provenance,
  });
}

export function normalizeProviderSnapshot(input) {
  assertNoSensitiveFields(input, 'providerSnapshot');
  assertRecord(input, 'providerSnapshot');
  const provider = normalizeProvider(input.provider, 'providerSnapshot.provider');
  const creatorKey = opaqueId(input.creatorKey, 'providerSnapshot.creatorKey');
  const handle = normalizeHandle(input.handle);
  const observedAt = timestampValue(input.observedAt, 'providerSnapshot.observedAt');
  const evidenceState = normalizeEvidenceState(input.evidenceState, 'providerSnapshot.evidenceState');
  if (!Array.isArray(input.observations)) fail('providerSnapshot.observations must be an array');
  const observations = input.observations.map(normalizeMetricObservation);
  for (const observation of observations) {
    if (observation.provenance.provider !== provider) fail('all snapshot observations must use the snapshot provider');
    if (observation.provenance.observedAt !== observedAt) fail('all snapshot observations must use the snapshot observedAt');
  }
  const provenance = normalizeProvenance({
    ...input.provenance,
    provider,
    sourceType: input.provenance?.sourceType || 'profile',
    evidenceState,
    observedAt,
  });
  return deepFreeze({
    contractVersion: INFLUENCER_INTELLIGENCE_CONTRACT_VERSION,
    creatorKey,
    ...(handle ? { handle } : {}),
    provider,
    observedAt,
    evidenceState,
    observations,
    provenance,
  });
}

function normalizeEvidenceRefs(value) {
  if (!Array.isArray(value)) fail('signal.evidenceRefs must be an array');
  if (value.length > 8) fail('signal.evidenceRefs may contain at most 8 references');
  const refs = value.map((item, index) => safeSourceRef(item, `signal.evidenceRefs[${index}]`));
  if (new Set(refs).size !== refs.length) fail('signal.evidenceRefs must be unique');
  return refs;
}

export function normalizeStructuredSignal(input) {
  assertNoSensitiveFields(input, 'signal');
  assertRecord(input, 'signal');
  const key = slugValue(input.key, 'signal.key', { maxLength: 80 });
  const evidenceState = normalizeEvidenceState(input.evidenceState, 'signal.evidenceState');
  const evidenceRefs = normalizeEvidenceRefs(input.evidenceRefs || []);
  if (evidenceState !== 'unavailable' && evidenceRefs.length === 0) {
    fail(`${key} must cite at least one evidence reference`);
  }
  const modelVersion = stringValue(input.modelVersion, 'signal.modelVersion', { maxLength: 80, required: false });
  if (evidenceState === 'inferred' && !modelVersion) fail(`${key} inferred signals require modelVersion`);
  const value = evidenceState === 'unavailable' ? null : safeScalar(input.value, `signal.${key}.value`);
  if (evidenceState !== 'unavailable' && value === undefined) fail(`${key} must contain a value unless it is unavailable`);
  return deepFreeze({
    key,
    value,
    evidenceState,
    confidence: evidenceState === 'unavailable' ? 0 : unitInterval(input.confidence, `signal.${key}.confidence`),
    evidenceRefs,
    ...(modelVersion ? { modelVersion } : {}),
  });
}

function normalizeProviders(value, evidenceState) {
  if (!Array.isArray(value)) fail('providers must be an array');
  const providers = [...new Set(value.map((item, index) => normalizeProvider(item, `providers[${index}]`)))].sort();
  if (evidenceState !== 'unavailable' && providers.length === 0) fail('available scores require at least one provider');
  return providers;
}

export function normalizeScoreEnvelope(input) {
  assertNoSensitiveFields(input, 'score');
  assertRecord(input, 'score');
  const scoreKind = enumValue(input.scoreKind, 'scoreKind', SCORE_KINDS, scoreKindSet);
  const evidenceState = normalizeEvidenceState(input.evidenceState, 'score.evidenceState');
  const algorithmVersion = versionValue(input.algorithmVersion, 'algorithmVersion');
  const timestamp = timestampValue(input.timestamp, 'score.timestamp');
  const coverage = normalizeCoverage(input.coverage);
  const providers = normalizeProviders(input.providers, evidenceState);
  if (!Array.isArray(input.provenance)) fail('score.provenance must be an array');
  const provenance = input.provenance.map(normalizeProvenance).sort((left, right) => (
    `${left.provider}:${left.sourceType}:${left.observedAt}:${left.sourceRef || ''}`
      .localeCompare(`${right.provider}:${right.sourceType}:${right.observedAt}:${right.sourceRef || ''}`)
  ));
  if (evidenceState !== 'unavailable' && provenance.length === 0) fail('available scores require provenance');
  for (const item of provenance) {
    if (!providers.includes(item.provider)) fail('score provenance provider must be listed in providers');
  }
  const signals = (input.signals || []).map(normalizeStructuredSignal).sort((left, right) => left.key.localeCompare(right.key));
  if (signals.length > 32) fail('score.signals may contain at most 32 signals');
  const score = evidenceState === 'unavailable' ? null : scoreValue(input.score, 'score.score');
  const confidence = evidenceState === 'unavailable' ? 0 : unitInterval(input.confidence, 'score.confidence');
  return deepFreeze({
    contractVersion: INFLUENCER_INTELLIGENCE_CONTRACT_VERSION,
    scoreKind,
    score,
    confidence,
    coverage,
    evidenceState,
    providers,
    provenance,
    algorithmVersion,
    timestamp,
    signals,
  });
}
