import {
  assertNoSensitiveFields,
  normalizeCanonicalHandle,
  normalizeCreatorKey,
  normalizeProviderId,
  normalizeProviderSnapshot,
} from '../contracts.mjs';

export const PROVIDER_GAP_CODES = Object.freeze([
  'provider_unavailable',
  'permission_gap',
  'coverage_gap',
  'timeout',
]);

export const PROVIDER_COLLECTION_CODES = Object.freeze([
  'transport_error',
  'invalid_response',
  'policy_block',
]);

const providerGapSet = new Set(PROVIDER_GAP_CODES);
const providerCollectionSet = new Set(PROVIDER_COLLECTION_CODES);
const profileProjectionKeys = new Set(['handle', 'followersCount', 'mediaCount']);
const profileMetricDefinitions = Object.freeze([
  { key: 'followers_count', field: 'followersCount' },
  { key: 'media_count', field: 'mediaCount' },
]);

export class ProviderAdapterError extends Error {
  constructor(message) {
    super(message);
    this.name = 'ProviderAdapterError';
  }
}

export class ProviderGapError extends Error {
  constructor(reasonCode) {
    if (!providerGapSet.has(reasonCode)) {
      throw new ProviderAdapterError(`unsupported provider gap code: ${reasonCode}`);
    }
    super(`provider gap: ${reasonCode}`);
    this.name = 'ProviderGapError';
    this.reasonCode = reasonCode;
  }
}

export class ProviderCollectionError extends Error {
  constructor(reasonCode) {
    if (!providerCollectionSet.has(reasonCode)) {
      throw new ProviderAdapterError(`unsupported provider collection code: ${reasonCode}`);
    }
    super(`provider collection failed: ${reasonCode}`);
    this.name = 'ProviderCollectionError';
    this.reasonCode = reasonCode;
  }
}

function isRecord(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function canonicalTimestamp(value, label) {
  if (typeof value !== 'string' || !value.trim()) {
    throw new ProviderAdapterError(`${label} is required`);
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    throw new ProviderAdapterError(`${label} must be an ISO timestamp`);
  }
  return parsed.toISOString();
}

function normalizeCount(value) {
  if (value === undefined || value === null) return null;
  if (!Number.isInteger(value) || value < 0) {
    throw new ProviderCollectionError('invalid_response');
  }
  return value;
}

function normalizeProfileProjection(value) {
  if (!isRecord(value)) throw new ProviderCollectionError('invalid_response');

  try {
    assertNoSensitiveFields(value, 'profileProjection');
  } catch {
    throw new ProviderCollectionError('policy_block');
  }

  if (Object.keys(value).some((key) => !profileProjectionKeys.has(key))) {
    throw new ProviderCollectionError('invalid_response');
  }

  let handle;
  try {
    handle = value.handle === undefined || value.handle === null
      ? undefined
      : normalizeCanonicalHandle(value.handle);
  } catch {
    throw new ProviderCollectionError('invalid_response');
  }

  return {
    handle,
    followersCount: normalizeCount(value.followersCount),
    mediaCount: normalizeCount(value.mediaCount),
  };
}

function makeObservation({ provider, creatorKey, observedAt, retrievedAt, key, value }) {
  const evidenceState = value === null ? 'unavailable' : 'observed';
  const provenance = {
    provider,
    sourceType: 'profile',
    evidenceState,
    observedAt,
    ...(retrievedAt ? { retrievedAt } : {}),
    sourceRef: `${provider}:profile:${creatorKey}`,
  };
  return {
    key,
    unit: 'count',
    value,
    evidenceState,
    confidence: value === null ? 0 : 1,
    provenance,
  };
}

export function createProfileProvider({
  provider,
  officialFirst,
  sourceRefPrefix = provider,
  requestFields,
  readProfile,
} = {}) {
  let providerId;
  try {
    providerId = normalizeProviderId(provider, 'provider');
  } catch {
    throw new ProviderAdapterError('provider is not supported');
  }
  if (typeof readProfile !== 'function') {
    throw new ProviderAdapterError(`${providerId} requires an injected read-only profile transport`);
  }
  if (typeof officialFirst !== 'boolean') {
    throw new ProviderAdapterError(`${providerId} must declare officialFirst`);
  }
  if (typeof sourceRefPrefix !== 'string' || !/^[a-z][a-z0-9-]*$/.test(sourceRefPrefix)) {
    throw new ProviderAdapterError('sourceRefPrefix must be a lowercase slug');
  }
  if (!Array.isArray(requestFields) || requestFields.length === 0
    || requestFields.some((field) => typeof field !== 'string' || !/^[a-z][a-z0-9_]*$/.test(field))) {
    throw new ProviderAdapterError(`${providerId} requestFields must be a non-empty field allowlist`);
  }

  const fields = Object.freeze([...new Set(requestFields)]);

  return Object.freeze({
    id: providerId,
    officialFirst,
    capabilities: Object.freeze(['profile']),
    async collect(input = {}) {
      if (!isRecord(input)) throw new ProviderAdapterError('provider collection input must be an object');
      const creatorKey = normalizeCreatorKey(input.creatorKey);
      const requestedHandle = normalizeCanonicalHandle(input.handle);
      if (!requestedHandle) throw new ProviderAdapterError('provider collection handle is required');
      const observedAt = canonicalTimestamp(input.observedAt, 'observedAt');
      const retrievedAt = input.retrievedAt === undefined
        ? undefined
        : canonicalTimestamp(input.retrievedAt, 'retrievedAt');
      if (retrievedAt && new Date(retrievedAt).getTime() < new Date(observedAt).getTime()) {
        throw new ProviderAdapterError('retrievedAt must not precede observedAt');
      }

      const request = Object.freeze({
        handle: requestedHandle,
        fields,
        mode: 'read-only',
      });
      let projection;
      try {
        projection = await readProfile(request);
      } catch (error) {
        if (error instanceof ProviderGapError || error instanceof ProviderCollectionError) throw error;
        throw new ProviderCollectionError('transport_error');
      }

      const normalizedProjection = normalizeProfileProjection(projection);
      const observations = profileMetricDefinitions.map(({ key, field }) => makeObservation({
        provider: providerId,
        creatorKey,
        observedAt,
        retrievedAt,
        key,
        value: normalizedProjection[field],
      }));
      const evidenceState = observations.some((item) => item.evidenceState === 'observed')
        ? 'observed'
        : 'unavailable';

      try {
        return normalizeProviderSnapshot({
          creatorKey,
          handle: normalizedProjection.handle || requestedHandle,
          provider: providerId,
          observedAt,
          evidenceState,
          provenance: {
            provider: providerId,
            sourceType: 'profile',
            evidenceState,
            observedAt,
            ...(retrievedAt ? { retrievedAt } : {}),
            sourceRef: `${sourceRefPrefix}:profile:${creatorKey}`,
          },
          observations,
        });
      } catch {
        throw new ProviderCollectionError('invalid_response');
      }
    },
  });
}
