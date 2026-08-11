import {
  assertNoSensitiveFields,
  normalizeCanonicalHandle,
  normalizeCreatorKey,
  normalizeProviderId,
  normalizeProviderSnapshot,
} from './contracts.mjs';
import {
  PROVIDER_COLLECTION_CODES,
  ProviderCollectionError,
  ProviderGapError,
} from './providers/profile-provider.mjs';

export const PROVIDER_ROUTER_CONTRACT_VERSION = 'influencer-intelligence-provider-router/v1';
export const DEFAULT_PROVIDER_ORDER = Object.freeze(['meta-graph', 'instagrapi']);

const providerCollectionCodeSet = new Set(PROVIDER_COLLECTION_CODES);

export class ProviderRouterError extends Error {
  constructor(reasonCode, provider = undefined) {
    super(`Influencer Intelligence provider router rejected the request: ${reasonCode}`);
    this.name = 'ProviderRouterError';
    this.reasonCode = reasonCode;
    if (provider) this.provider = provider;
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

function canonicalTimestamp(value, label) {
  if (typeof value !== 'string' || !value.trim()) {
    throw new ProviderRouterError('invalid_request');
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    throw new ProviderRouterError('invalid_request');
  }
  return parsed.toISOString();
}

function normalizeCollectionRequest(input) {
  if (!isRecord(input)) throw new ProviderRouterError('invalid_request');
  try {
    assertNoSensitiveFields(input, 'providerRouter.request');
  } catch {
    throw new ProviderRouterError('policy_block');
  }
  const allowedKeys = new Set(['creatorKey', 'handle', 'observedAt', 'retrievedAt']);
  if (Object.keys(input).some((key) => !allowedKeys.has(key))) {
    throw new ProviderRouterError('invalid_request');
  }
  let creatorKey;
  let handle;
  try {
    creatorKey = normalizeCreatorKey(input.creatorKey);
    handle = normalizeCanonicalHandle(input.handle);
  } catch {
    throw new ProviderRouterError('invalid_request');
  }
  if (!handle) throw new ProviderRouterError('invalid_request');
  const observedAt = canonicalTimestamp(input.observedAt, 'observedAt');
  const retrievedAt = input.retrievedAt === undefined
    ? undefined
    : canonicalTimestamp(input.retrievedAt, 'retrievedAt');
  if (retrievedAt && new Date(retrievedAt).getTime() < new Date(observedAt).getTime()) {
    throw new ProviderRouterError('invalid_request');
  }
  return Object.freeze({
    creatorKey,
    handle,
    observedAt,
    ...(retrievedAt ? { retrievedAt } : {}),
  });
}

function providerEntries(value) {
  if (value instanceof Map) return [...value.entries()];
  if (isRecord(value)) return Object.entries(value);
  throw new ProviderRouterError('invalid_request');
}

function normalizeConfiguredProviders(value) {
  const normalized = new Map();
  for (const [rawId, provider] of providerEntries(value)) {
    let id;
    try {
      id = normalizeProviderId(rawId, 'providerRouter.provider');
    } catch {
      throw new ProviderRouterError('unknown_provider');
    }
    if (normalized.has(id) || !isRecord(provider) || typeof provider.collect !== 'function') {
      throw new ProviderRouterError('invalid_request', id);
    }
    if (provider.id !== id) throw new ProviderRouterError('invalid_request', id);
    if (id === 'meta-graph' && provider.officialFirst !== true) {
      throw new ProviderRouterError('official_first_required', id);
    }
    normalized.set(id, provider);
  }
  return normalized;
}

function normalizeOrder(value) {
  if (!Array.isArray(value) || value.length === 0) throw new ProviderRouterError('invalid_request');
  const order = value.map((item, index) => {
    try {
      return normalizeProviderId(item, `providerRouter.providerOrder[${index}]`);
    } catch {
      throw new ProviderRouterError('unknown_provider');
    }
  });
  if (new Set(order).size !== order.length) throw new ProviderRouterError('invalid_request');
  if (order[0] !== 'meta-graph') throw new ProviderRouterError('official_first_required');
  return order;
}

function terminalReason(error) {
  if (error instanceof ProviderCollectionError && providerCollectionCodeSet.has(error.reasonCode)) {
    return error.reasonCode;
  }
  return 'provider_failed';
}

export function createProviderRouter({ providers, providerOrder = DEFAULT_PROVIDER_ORDER } = {}) {
  const configuredProviders = normalizeConfiguredProviders(providers);
  const requestedOrder = normalizeOrder(providerOrder);
  const activeOrder = requestedOrder.filter((providerId) => configuredProviders.has(providerId));
  if (!activeOrder.includes('meta-graph') || activeOrder[0] !== 'meta-graph') {
    throw new ProviderRouterError('official_first_required');
  }

  return Object.freeze({
    contractVersion: PROVIDER_ROUTER_CONTRACT_VERSION,
    providerOrder: Object.freeze(activeOrder),
    capabilities: Object.freeze(['read-profile']),
    async collect(input) {
      const request = normalizeCollectionRequest(input);
      const attempts = [];
      for (const providerId of activeOrder) {
        const provider = configuredProviders.get(providerId);
        try {
          const candidate = await provider.collect(request);
          let snapshot;
          try {
            snapshot = normalizeProviderSnapshot(candidate);
          } catch {
            throw new ProviderCollectionError('invalid_response');
          }
          if (snapshot.provider !== providerId || snapshot.creatorKey !== request.creatorKey) {
            throw new ProviderCollectionError('invalid_response');
          }
          attempts.push({ provider: providerId, status: 'collected' });
          return deepFreeze({
            contractVersion: PROVIDER_ROUTER_CONTRACT_VERSION,
            status: 'collected',
            provider: providerId,
            snapshot,
            attempts,
          });
        } catch (error) {
          if (error instanceof ProviderGapError) {
            attempts.push({ provider: providerId, status: 'gap', reasonCode: error.reasonCode });
            continue;
          }
          const reasonCode = terminalReason(error);
          attempts.push({ provider: providerId, status: 'blocked', reasonCode });
          throw new ProviderRouterError(reasonCode, providerId);
        }
      }
      return deepFreeze({
        contractVersion: PROVIDER_ROUTER_CONTRACT_VERSION,
        status: 'unavailable',
        provider: null,
        snapshot: null,
        attempts,
      });
    },
  });
}
