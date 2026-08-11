import {
  assertNoSensitiveFields,
  normalizeProviderId,
  normalizeProviderSnapshot,
} from '../contracts.mjs';
import {
  normalizeProviderCandidate,
  normalizeProviderOperation,
  normalizeProviderRequest,
  normalizeProviderSlug,
  PROVIDER_OPERATIONS,
} from './provider-contracts.mjs';
import {
  ProviderAdapterError,
  ProviderCollectionError,
  ProviderGapError,
} from './profile-provider.mjs';

const operationSet = new Set(PROVIDER_OPERATIONS);

function isRecord(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function camelOperation(operation) {
  return operation.replace(/_([a-z])/g, (_, letter) => letter.toUpperCase());
}

function fieldList(value, label) {
  if (!Array.isArray(value) || value.length === 0 || value.length > 64) {
    throw new ProviderAdapterError(`${label} must be a bounded field list`);
  }
  if (value.some((item) => typeof item !== 'string' || !/^[a-z][a-z0-9_]*$/.test(item))) {
    throw new ProviderAdapterError(`${label} contains an invalid field`);
  }
  return Object.freeze([...new Set(value)]);
}

function mapLegacyProfile(value) {
  if (!isRecord(value)) return value;
  return {
    ...(value.handle !== undefined ? { canonical_handle: value.handle } : {}),
    ...(value.canonicalHandle !== undefined ? { canonical_handle: value.canonicalHandle } : {}),
    ...(value.followersCount !== undefined ? { followers_count: value.followersCount } : {}),
    ...(value.followingCount !== undefined ? { following_count: value.followingCount } : {}),
    ...(value.mediaCount !== undefined ? { media_count: value.mediaCount } : {}),
    ...(value.isPrivate !== undefined ? { is_private: value.isPrivate } : {}),
    ...(value.isVerified !== undefined ? { is_verified: value.isVerified } : {}),
  };
}

function legacyDataForOperation(operation, value, request) {
  const profile = mapLegacyProfile(value);
  if (operation === 'resolve_creator') {
    return {
      resolved: Boolean(profile && (profile.canonical_handle || profile.followers_count !== undefined || profile.media_count !== undefined)),
      canonical_handle: profile?.canonical_handle || request.canonical_handle || null,
      match_type: 'canonical_handle',
    };
  }
  return profile;
}

function transportResult(operation, raw, request, legacy) {
  try {
    assertNoSensitiveFields(raw, 'providerResult');
  } catch {
    throw new ProviderCollectionError('policy_block');
  }
  if (!legacy) return raw;
  if (raw && typeof raw === 'object' && Object.prototype.hasOwnProperty.call(raw, 'data')) {
    return { ...raw, data: legacyDataForOperation(operation, raw.data, request) };
  }
  return legacyDataForOperation(operation, raw, request);
}

function legacySnapshotFromResult(result, request) {
  if (result.status === 'unavailable') {
    throw new ProviderGapError(result.limitations[0] || 'coverage_gap');
  }
  const data = result.data || {};
  let provider;
  try {
    provider = normalizeProviderId(result.provider);
  } catch {
    throw new ProviderCollectionError('invalid_response');
  }
  const observedAt = result.freshness.observed_at || request.observed_at;
  const observations = [
    ['followers_count', data.followers_count],
    ['media_count', data.media_count],
  ].map(([key, value]) => ({
    key,
    unit: 'count',
    value: value === undefined ? null : value,
    evidenceState: value === undefined || value === null ? 'unavailable' : 'observed',
    confidence: value === undefined || value === null ? 0 : 1,
    provenance: {
      provider,
      sourceType: 'profile',
      evidenceState: value === undefined || value === null ? 'unavailable' : 'observed',
      observedAt,
      retrievedAt: result.retrieved_at,
      sourceRef: result.provider_specific_evidence.source_ref,
    },
  }));
  const evidenceState = observations.some(({ evidenceState: state }) => state === 'observed')
    ? 'observed'
    : 'unavailable';
  try {
    return normalizeProviderSnapshot({
      creatorKey: request.creator_key,
      handle: data.canonical_handle || request.canonical_handle,
      provider,
      observedAt,
      evidenceState,
      provenance: {
        provider,
        sourceType: 'profile',
        evidenceState,
        observedAt,
        retrievedAt: result.retrieved_at,
        sourceRef: result.provider_specific_evidence.source_ref,
      },
      observations,
    });
  } catch {
    throw new ProviderCollectionError('invalid_response');
  }
}

/**
 * Builds a provider adapter around injected, already-authorized read
 * transports. This module owns normalization and operation shape only; it
 * never owns credentials, sessions, HTTP clients, scrapers, or write methods.
 */
export function createOperationProvider({
  provider,
  officialFirst,
  sourceRefPrefix,
  adapterVersion,
  fieldsByOperation = {},
  operations = {},
  readProfile,
  readProfileMetrics,
  resolveCreator,
} = {}) {
  let providerId;
  try {
    providerId = normalizeProviderSlug(provider);
  } catch {
    throw new ProviderAdapterError('provider is not supported');
  }
  if (typeof officialFirst !== 'boolean') throw new ProviderAdapterError('officialFirst is required');
  if (typeof sourceRefPrefix !== 'string' || !/^[a-z][a-z0-9-]*$/.test(sourceRefPrefix)) {
    throw new ProviderAdapterError('sourceRefPrefix must be a lowercase slug');
  }
  const normalizedAdapterVersion = adapterVersion || `${providerId}-adapter-v1`;
  if (!/^[a-z][a-z0-9._/-]{0,79}$/.test(normalizedAdapterVersion)) {
    throw new ProviderAdapterError('adapterVersion must be a bounded version');
  }

  const fields = new Map();
  for (const operation of PROVIDER_OPERATIONS) {
    const configured = fieldsByOperation[operation] || fieldsByOperation[camelOperation(operation)] || ['normalized'];
    fields.set(operation, fieldList(configured, `${providerId}.${operation}`));
  }

  const configuredOperations = new Map();
  for (const operation of PROVIDER_OPERATIONS) {
    const named = operations[operation] || operations[camelOperation(operation)];
    const legacy = operation === 'get_profile'
      ? readProfile
      : operation === 'get_profile_metrics'
        ? readProfileMetrics
        : operation === 'resolve_creator'
          ? (resolveCreator || readProfile)
          : undefined;
    if (typeof named === 'function') configuredOperations.set(operation, { fn: named, legacy: false });
    else if (typeof legacy === 'function') configuredOperations.set(operation, { fn: legacy, legacy: true });
  }

  const methods = new Map();
  for (const operation of PROVIDER_OPERATIONS) {
    const configured = configuredOperations.get(operation);
    const method = async (input = {}, context = {}) => {
      const request = isRecord(input) && input.operation === operation
        ? input
        : normalizeProviderRequest(input, operation);
      if (!configured) throw new ProviderGapError('coverage_gap');
      const transportRequest = configured.legacy
        ? Object.freeze({
          handle: request.canonical_handle,
          fields: fields.get(operation),
          mode: 'read-only',
        })
        : Object.freeze({
          ...request,
          requested_fields: request.requested_fields || fields.get(operation) || [],
        });
      let raw;
      try {
        raw = await configured.fn(transportRequest, context);
      } catch (error) {
        if (error instanceof ProviderGapError || error instanceof ProviderCollectionError) throw error;
        throw new ProviderCollectionError('transport_error');
      }
      return normalizeProviderCandidate({
        operation,
        provider: providerId,
        request,
        candidate: transportResult(operation, raw, request, configured.legacy),
        adapterVersion: normalizedAdapterVersion,
        sourceRef: `${sourceRefPrefix}:${operation}:${request.creator_key || 'unresolved'}`,
      });
    };
    methods.set(operation, method);
  }

  const capabilities = Object.freeze([...configuredOperations.keys()]);
  const adapter = {
    id: providerId,
    officialFirst,
    capabilities,
    collect: async (input = {}, context = {}) => {
      const request = normalizeProviderRequest(input, 'get_profile');
      const result = await methods.get('get_profile')(request, context);
      return legacySnapshotFromResult(result, request);
    },
  };
  for (const operation of PROVIDER_OPERATIONS) {
    Object.defineProperty(adapter, operation, {
      configurable: false,
      enumerable: false,
      writable: false,
      value: methods.get(operation),
    });
  }
  return Object.freeze(adapter);
}
