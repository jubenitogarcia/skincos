import {
  assertNoSensitiveFields,
  normalizeCanonicalHandle,
  normalizeCreatorKey,
  normalizeEvidenceStateValue,
  normalizeProviderId,
  normalizeProvenanceSourceRef,
} from './contracts.mjs';

export const REGISTRY_CONTRACT_VERSION = 'influencer-intelligence-registry/v1';

export const CREATOR_REGISTRY_STATES = Object.freeze([
  'candidate',
  'paused',
  'unavailable',
]);

export const PROVIDER_REGISTRY_STATES = Object.freeze([
  'configured',
  'revoked',
  'unavailable',
]);

const creatorRegistryStateSet = new Set(CREATOR_REGISTRY_STATES);
const providerRegistryStateSet = new Set(PROVIDER_REGISTRY_STATES);

function fail(message) {
  throw new Error(`InfluencerIntelligenceRegistryError: ${message}`);
}

function deepFreeze(value, seen = new Set()) {
  if (!value || typeof value !== 'object' || seen.has(value)) return value;
  seen.add(value);
  for (const child of Object.values(value)) deepFreeze(child, seen);
  return Object.freeze(value);
}

function normalizedString(value, label, { maxLength = 40, required = false } = {}) {
  if (value === undefined || value === null || value === '') {
    if (required) fail(`${label} is required`);
    return null;
  }
  if (typeof value !== 'string') fail(`${label} must be a string`);
  const normalized = value.trim();
  if (!normalized && required) fail(`${label} must not be empty`);
  if (normalized.length > maxLength) fail(`${label} exceeds ${maxLength} characters`);
  return normalized || null;
}

function timestamp(value, label, { required = false } = {}) {
  const normalized = normalizedString(value, label, { maxLength: 40, required });
  if (normalized === null) return null;
  const parsed = new Date(normalized);
  if (Number.isNaN(parsed.getTime())) fail(`${label} must be an ISO timestamp`);
  return parsed.toISOString();
}

function digest(value) {
  const normalized = normalizedString(value, 'providerAccountDigest', { maxLength: 64 });
  if (normalized === null) return null;
  if (!/^[0-9a-f]{64}$/i.test(normalized)) fail('providerAccountDigest must be a SHA-256 hex digest');
  return normalized.toLowerCase();
}

function registryState(value) {
  const normalized = normalizedString(value, 'registryState', { maxLength: 20, required: true }).toLowerCase();
  if (!creatorRegistryStateSet.has(normalized)) fail(`registryState must be one of ${CREATOR_REGISTRY_STATES.join(', ')}`);
  return normalized;
}

function providerState(value) {
  const normalized = normalizedString(value, 'providerState', { maxLength: 20, required: true }).toLowerCase();
  if (!providerRegistryStateSet.has(normalized)) fail(`providerState must be one of ${PROVIDER_REGISTRY_STATES.join(', ')}`);
  return normalized;
}

function normalizeProviderBinding(input) {
  assertNoSensitiveFields(input, 'providerBinding');
  if (!input || typeof input !== 'object' || Array.isArray(input)) fail('providerBinding must be an object');
  if (Object.prototype.hasOwnProperty.call(input, 'providerAccountId')) {
    fail('providerAccountId is not permitted; use providerAccountDigest');
  }
  const provider = normalizeProviderId(input.provider, 'providerBinding.provider');
  const state = providerState(input.providerState || (input.providerAccountDigest ? 'configured' : 'unavailable'));
  const providerAccountDigest = digest(input.providerAccountDigest);
  if (state === 'unavailable' && providerAccountDigest !== null) {
    fail('unavailable provider bindings must not contain a provider account digest');
  }
  if (state !== 'unavailable' && providerAccountDigest === null) {
    fail('configured or revoked provider bindings require a provider account digest');
  }
  const evidenceState = normalizeEvidenceStateValue(
    input.evidenceState || (state === 'unavailable' ? 'unavailable' : 'observed'),
    'providerBinding.evidenceState',
  );
  if (!['observed', 'unavailable'].includes(evidenceState)) {
    fail('provider registry evidenceState must be observed or unavailable');
  }
  if ((state === 'unavailable') !== (evidenceState === 'unavailable')) {
    fail('providerState and evidenceState must agree on availability');
  }
  const lastObservedAt = timestamp(input.lastObservedAt, 'lastObservedAt', { required: evidenceState === 'observed' });
  const lastRetrievedAt = timestamp(input.lastRetrievedAt, 'lastRetrievedAt');
  if (lastRetrievedAt && !lastObservedAt) fail('lastRetrievedAt requires lastObservedAt');
  if (lastRetrievedAt && new Date(lastRetrievedAt).getTime() < new Date(lastObservedAt).getTime()) {
    fail('lastRetrievedAt must not precede lastObservedAt');
  }
  const sourceRef = normalizeProvenanceSourceRef(input.sourceRef, 'providerBinding.sourceRef');
  return {
    provider,
    providerAccountDigest,
    providerState: state,
    evidenceState,
    lastObservedAt,
    lastRetrievedAt,
    sourceRef: sourceRef || null,
  };
}

export function normalizeCreatorRegistryEntry(input) {
  assertNoSensitiveFields(input, 'creatorRegistryEntry');
  if (!input || typeof input !== 'object' || Array.isArray(input)) fail('creatorRegistryEntry must be an object');
  const creatorKey = normalizeCreatorKey(input.creatorKey);
  const canonicalHandle = normalizeCanonicalHandle(input.canonicalHandle);
  const state = registryState(input.registryState || 'candidate');
  if (!Array.isArray(input.providers)) fail('creatorRegistryEntry.providers must be an array');
  const providers = input.providers.map(normalizeProviderBinding).sort((left, right) => left.provider.localeCompare(right.provider));
  const providerIds = providers.map((item) => item.provider);
  if (new Set(providerIds).size !== providerIds.length) fail('creatorRegistryEntry.providers must be unique by provider');
  return deepFreeze({
    contractVersion: REGISTRY_CONTRACT_VERSION,
    creatorKey,
    canonicalHandle: canonicalHandle || null,
    registryState: state,
    providers,
  });
}
