import {
  normalizeProviderSnapshot,
  normalizeProviderId,
} from './contracts.mjs';
import {
  isFallbackCode,
  normalizeProviderCandidate,
  normalizeProviderOperation,
  normalizeProviderRequest,
  normalizeProviderSlug,
  PROVIDER_FALLBACK_CODES,
  PROVIDER_OPERATIONS,
  PROVIDER_RETRYABLE_CODES,
  unavailableProviderResult,
} from './providers/provider-contracts.mjs';
import {
  ProviderCollectionError,
  ProviderGapError,
} from './providers/profile-provider.mjs';

export const PROVIDER_ROUTER_CONTRACT_VERSION = 'influencer-intelligence-provider-router/v2';
export const DEFAULT_PROVIDER_ORDER = Object.freeze(['meta-graph', 'instagrapi']);
export const DEFAULT_PROVIDER_TIMEOUT_MS = 12000;
export const DEFAULT_PROVIDER_MAX_ATTEMPTS = 2;
export const DEFAULT_CIRCUIT_FAILURE_THRESHOLD = 3;
export const DEFAULT_CIRCUIT_RESET_MS = 30000;

const CORE_PROVIDER_IDS = new Set(DEFAULT_PROVIDER_ORDER);
const retryableCodeSet = new Set(PROVIDER_RETRYABLE_CODES);
const fallbackCodeSet = new Set(PROVIDER_FALLBACK_CODES);
const terminalProviderCodes = new Set(['policy_block', 'invalid_response', 'unclassified_transport']);

export class ProviderRouterError extends Error {
  constructor(reasonCode, provider = undefined, operation = undefined, details = {}) {
    super(`Influencer Intelligence provider router rejected the request: ${reasonCode}`);
    this.name = 'ProviderRouterError';
    this.code = reasonCode;
    this.reasonCode = reasonCode;
    if (provider !== undefined) this.provider = provider;
    if (operation !== undefined) this.operation = operation;
    this.retryable = details.retryable === true;
    this.fallbackAllowed = details.fallbackAllowed === true;
  }

  toJSON() {
    return {
      code: this.code,
      reason_code: this.reasonCode,
      ...(this.provider !== undefined ? { provider: this.provider } : {}),
      ...(this.operation !== undefined ? { operation: this.operation } : {}),
      retryable: this.retryable,
      fallback_allowed: this.fallbackAllowed,
    };
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

function providerEntries(value) {
  if (value instanceof Map) return [...value.entries()];
  if (isRecord(value)) return Object.entries(value);
  throw new ProviderRouterError('invalid_request');
}

function externalConfig(value) {
  if (value === undefined) return { enabled: false, allowlist: new Set() };
  if (!isRecord(value)) throw new ProviderRouterError('invalid_request');
  const allowlist = value.allowlist || value.providers || [];
  if (!Array.isArray(allowlist)) throw new ProviderRouterError('invalid_request');
  const normalized = new Set();
  for (const item of allowlist) {
    try {
      normalized.add(normalizeProviderSlug(item, 'externalProvider.allowlist'));
    } catch {
      throw new ProviderRouterError('invalid_request');
    }
  }
  return { enabled: value.enabled === true, allowlist: normalized };
}

function normalizeConfiguredProviders(value, configuredExternal) {
  const normalized = new Map();
  for (const [rawId, provider] of providerEntries(value)) {
    let id;
    try {
      id = normalizeProviderSlug(rawId, 'providerRouter.provider');
    } catch {
      throw new ProviderRouterError('unknown_provider');
    }
    if (normalized.has(id) || !isRecord(provider)) {
      throw new ProviderRouterError('invalid_request', id);
    }
    if (!CORE_PROVIDER_IDS.has(id)) {
      if (!configuredExternal.enabled || !configuredExternal.allowlist.has(id) || provider.external !== true) {
        throw new ProviderRouterError('unknown_provider', id);
      }
    }
    if (provider.id !== id) throw new ProviderRouterError('invalid_request', id);
    if (typeof provider.collect !== 'function'
      && !PROVIDER_OPERATIONS.some((operation) => typeof provider[operation] === 'function')) {
      throw new ProviderRouterError('invalid_request', id);
    }
    if (id === 'meta-graph' && provider.officialFirst !== true) {
      throw new ProviderRouterError('official_first_required', id);
    }
    if (id !== 'meta-graph' && provider.officialFirst === true) {
      throw new ProviderRouterError('official_first_required', id);
    }
    normalized.set(id, provider);
  }
  return normalized;
}

function normalizeOrder(value, configuredExternal) {
  if (!Array.isArray(value) || value.length === 0) throw new ProviderRouterError('invalid_request');
  const order = value.map((item) => {
    let id;
    try {
      id = normalizeProviderSlug(item, 'providerRouter.providerOrder');
    } catch {
      throw new ProviderRouterError('unknown_provider');
    }
    if (!CORE_PROVIDER_IDS.has(id)
      && (!configuredExternal.enabled || !configuredExternal.allowlist.has(id))) {
      throw new ProviderRouterError('unknown_provider', id);
    }
    return id;
  });
  if (new Set(order).size !== order.length) throw new ProviderRouterError('invalid_request');
  if (order[0] !== 'meta-graph') throw new ProviderRouterError('official_first_required');
  return order;
}

function clockMs(clock) {
  const value = typeof clock === 'function' ? clock() : clock;
  const result = value instanceof Date ? value.getTime() : Number(value);
  if (!Number.isFinite(result)) throw new ProviderRouterError('invalid_request');
  return result;
}

function classifyError(error) {
  const rawCode = error?.reasonCode || error?.code;
  if (error instanceof ProviderGapError) {
    return {
      code: rawCode,
      retryable: false,
      fallback: fallbackCodeSet.has(rawCode),
    };
  }
  if (rawCode === 'timeout' || error?.name === 'AbortError') {
    return { code: 'timeout', retryable: true, fallback: true };
  }
  if (rawCode === 'transport_error') {
    return { code: 'provider_unavailable', retryable: true, fallback: true };
  }
  if (typeof rawCode === 'string' && fallbackCodeSet.has(rawCode)) {
    return { code: rawCode, retryable: retryableCodeSet.has(rawCode), fallback: true };
  }
  if (typeof rawCode === 'string' && terminalProviderCodes.has(rawCode)) {
    return { code: rawCode, retryable: false, fallback: false };
  }
  return { code: 'unclassified_transport', retryable: false, fallback: false };
}

function defaultSleep(delayMs) {
  return new Promise((resolve) => setTimeout(resolve, Math.max(0, Math.min(delayMs, 1000))));
}

function retryDelay(attempt, baseDelayMs) {
  return Math.min(1000, Math.max(0, baseDelayMs) * (2 ** Math.max(0, attempt - 1)));
}

function boundedInteger(value, fallback, minimum, maximum) {
  const candidate = value === undefined ? fallback : Number(value);
  if (!Number.isInteger(candidate) || candidate < minimum || candidate > maximum) {
    throw new ProviderRouterError('invalid_request');
  }
  return candidate;
}

function createCircuitState() {
  return { failures: 0, openedAt: null, halfOpen: false };
}

function legacyAttempts(attempts) {
  return attempts.map((attempt) => ({
    provider: attempt.provider,
    status: attempt.status === 'ok' ? 'collected' : attempt.status,
    ...(attempt.classification ? { reasonCode: attempt.classification } : {}),
    ...(attempt.retry_count ? { retryCount: attempt.retry_count } : {}),
  }));
}

function legacyObservation(snapshot, key) {
  const observation = Array.isArray(snapshot?.observations)
    ? snapshot.observations.find((item) => item?.key === key)
    : undefined;
  return observation?.value === undefined ? null : observation.value;
}

function legacyCollectionCandidate(providerId, result, request) {
  if (!isRecord(result)) throw new ProviderCollectionError('invalid_response');
  if (result.status === 'unavailable' || result.snapshot === null) {
    return {
      status: 'unavailable',
      limitations: ['coverage_gap'],
    };
  }
  const snapshot = isRecord(result.snapshot) ? result.snapshot : result;
  const sourceRef = snapshot.provenance?.sourceRef || `${providerId}:legacy:${request.creator_key}`;
  return {
    observed_at: snapshot.observedAt || request.observed_at,
    retrieved_at: snapshot.retrievedAt || request.retrieved_at,
    data: {
      canonical_handle: snapshot.handle || request.canonical_handle || null,
      followers_count: legacyObservation(snapshot, 'followers_count'),
      media_count: legacyObservation(snapshot, 'media_count'),
    },
    data_classification: 'observed',
    provider_specific_evidence: {
      adapter_version: `${providerId}-legacy-adapter-v1`,
      source_ref: sourceRef,
      fields: ['followers_count', 'media_count'],
      endpoint_family: 'legacy-read-only-profile',
    },
  };
}

function legacySnapshot(result, request) {
  if (result.status === 'unavailable') return null;
  const provider = result.provider;
  let supportedProvider;
  try {
    supportedProvider = normalizeProviderId(provider);
  } catch {
    throw new ProviderRouterError('invalid_response', provider, 'get_profile');
  }
  const data = result.data || {};
  const observedAt = result.freshness.observed_at || request.observed_at;
  const values = [
    ['followers_count', data.followers_count],
    ['media_count', data.media_count],
  ];
  const observations = values.map(([key, value]) => {
    const available = value !== undefined && value !== null;
    const state = available ? 'observed' : 'unavailable';
    return {
      key,
      unit: 'count',
      value: available ? value : null,
      evidenceState: state,
      confidence: available ? 1 : 0,
      provenance: {
        provider: supportedProvider,
        sourceType: 'profile',
        evidenceState: state,
        observedAt,
        retrievedAt: result.retrieved_at,
        sourceRef: result.provider_specific_evidence.source_ref,
      },
    };
  });
  const evidenceState = observations.some(({ evidenceState: state }) => state === 'observed')
    ? 'observed'
    : 'unavailable';
  try {
    return normalizeProviderSnapshot({
      creatorKey: request.creator_key,
      handle: data.canonical_handle || request.canonical_handle,
      provider: supportedProvider,
      observedAt,
      evidenceState,
      provenance: {
        provider: supportedProvider,
        sourceType: 'profile',
        evidenceState,
        observedAt,
        retrievedAt: result.retrieved_at,
        sourceRef: result.provider_specific_evidence.source_ref,
      },
      observations,
    });
  } catch {
    throw new ProviderRouterError('invalid_response', provider, 'get_profile');
  }
}

export function createProviderRouter({
  providers,
  providerOrder = DEFAULT_PROVIDER_ORDER,
  externalProviderConfig,
  timeoutMs = DEFAULT_PROVIDER_TIMEOUT_MS,
  retryPolicy = {},
  circuitBreaker = {},
  clock = () => Date.now(),
  sleep = defaultSleep,
} = {}) {
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > DEFAULT_PROVIDER_TIMEOUT_MS) {
    throw new ProviderRouterError('invalid_request');
  }
  if (typeof sleep !== 'function') throw new ProviderRouterError('invalid_request');
  if (!isRecord(retryPolicy) || !isRecord(circuitBreaker)) {
    throw new ProviderRouterError('invalid_request');
  }
  const configuredExternal = externalConfig(externalProviderConfig);
  const configuredProviders = normalizeConfiguredProviders(providers, configuredExternal);
  const requestedOrder = normalizeOrder(providerOrder, configuredExternal);
  const activeOrder = requestedOrder.filter((providerId) => configuredProviders.has(providerId));
  if (!activeOrder.includes('meta-graph') || activeOrder[0] !== 'meta-graph') {
    throw new ProviderRouterError('official_first_required');
  }

  const maxAttempts = boundedInteger(retryPolicy.maxAttempts, DEFAULT_PROVIDER_MAX_ATTEMPTS, 1, 3);
  const retryBaseDelayMs = boundedInteger(retryPolicy.baseDelayMs, 25, 0, 1000);
  const failureThreshold = boundedInteger(
    circuitBreaker.failureThreshold,
    DEFAULT_CIRCUIT_FAILURE_THRESHOLD,
    1,
    10,
  );
  const resetAfterMs = boundedInteger(circuitBreaker.resetAfterMs, DEFAULT_CIRCUIT_RESET_MS, 1, 300000);
  const circuitStates = new Map();

  function stateKey(provider, operation) {
    return `${provider}:${operation}`;
  }

  function getState(provider, operation) {
    const key = stateKey(provider, operation);
    if (!circuitStates.has(key)) circuitStates.set(key, createCircuitState());
    return circuitStates.get(key);
  }

  function circuitStatus(provider, operation) {
    const state = getState(provider, operation);
    if (state.openedAt === null) return 'closed';
    const elapsed = clockMs(clock) - state.openedAt;
    if (elapsed >= resetAfterMs) {
      state.halfOpen = true;
      return 'half-open';
    }
    return 'open';
  }

  function recordSuccess(provider, operation) {
    const state = getState(provider, operation);
    state.failures = 0;
    state.openedAt = null;
    state.halfOpen = false;
  }

  function recordFailure(provider, operation, classification) {
    if (!['provider_unavailable', 'timeout', 'retry_exhausted'].includes(classification)) return;
    const state = getState(provider, operation);
    state.failures += 1;
    if (state.failures >= failureThreshold) {
      state.openedAt = clockMs(clock);
      state.halfOpen = false;
    }
  }

  async function callWithTimeout(provider, operation, request, attempt) {
    const handler = provider[operation];
    const legacyCollect = typeof handler !== 'function'
      && operation === 'get_profile'
      && typeof provider.collect === 'function';
    if (typeof handler !== 'function' && !legacyCollect) throw new ProviderGapError('coverage_gap');
    if (legacyCollect && !request.canonical_handle) throw new ProviderGapError('coverage_gap');
    const controller = new AbortController();
    let timer;
    const timeout = new Promise((_, reject) => {
      timer = setTimeout(() => {
        controller.abort();
        const error = new Error('timeout');
        error.code = 'timeout';
        reject(error);
      }, timeoutMs);
    });
    try {
      return await Promise.race([
        Promise.resolve().then(() => legacyCollect
          ? provider.collect({
            creatorKey: request.creator_key,
            handle: request.canonical_handle,
            observedAt: request.observed_at,
            retrievedAt: request.retrieved_at,
          })
          : handler(request, { signal: controller.signal, attempt })),
        timeout,
      ]);
    } finally {
      clearTimeout(timer);
    }
  }

  async function callProvider(providerId, operation, request, attempts) {
    const provider = configuredProviders.get(providerId);
    const status = circuitStatus(providerId, operation);
    if (status === 'open') {
      attempts.push({ provider: providerId, operation, status: 'skipped', classification: 'circuit_open', retry_count: 0 });
      return { kind: 'gap', code: 'circuit_open', retryCount: 0 };
    }
    let retryCount = 0;
    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      try {
        const response = await callWithTimeout(provider, operation, request, attempt);
        const raw = typeof provider[operation] === 'function'
          ? response
          : legacyCollectionCandidate(providerId, response, request);
        const candidate = normalizeProviderCandidate({
          operation,
          provider: providerId,
          request,
          candidate: raw,
          adapterVersion: provider.adapterVersion || `${providerId}-adapter-v1`,
          sourceRef: `${providerId}:${operation}:${request.creator_key || 'unresolved'}`,
        });
        if (candidate.provider !== providerId || candidate.operation !== operation) {
          throw new ProviderCollectionError('invalid_response');
        }
        if (candidate.status === 'unavailable') {
          const limitation = candidate.limitations.find((item) => isFallbackCode(item)) || 'coverage_gap';
          recordFailure(providerId, operation, limitation);
          attempts.push({ provider: providerId, operation, status: 'gap', classification: limitation, retry_count: retryCount });
          return { kind: 'gap', code: limitation, retryCount };
        }
        recordSuccess(providerId, operation);
        attempts.push({ provider: providerId, operation, status: 'ok', retry_count: retryCount });
        return { kind: 'ok', candidate, retryCount };
      } catch (error) {
        const classification = classifyError(error);
        if (classification.retryable && attempt < maxAttempts) {
          retryCount += 1;
          await sleep(retryDelay(attempt, retryBaseDelayMs));
          continue;
        }
        const finalClassification = classification.retryable && retryCount > 0
          ? 'retry_exhausted'
          : classification.code;
        if (classification.fallback) recordFailure(providerId, operation, finalClassification);
        const statusValue = classification.fallback ? 'gap' : 'blocked';
        attempts.push({
          provider: providerId,
          operation,
          status: statusValue,
          classification: finalClassification,
          retry_count: retryCount,
        });
        return { kind: classification.fallback ? 'gap' : 'blocked', code: finalClassification, retryCount };
      }
    }
    throw new ProviderRouterError('unclassified_transport', providerId, operation);
  }

  async function execute(operation, input = {}) {
    let normalizedOperation;
    try {
      normalizedOperation = normalizeProviderOperation(operation);
    } catch {
      throw new ProviderRouterError('invalid_request', undefined, operation);
    }
    let request;
    try {
      request = normalizeProviderRequest(input, normalizedOperation, {
        now: () => new Date(clockMs(clock)).toISOString(),
      });
    } catch (error) {
      throw new ProviderRouterError(error?.reasonCode || 'invalid_request', undefined, normalizedOperation);
    }
    const attempts = [];
    for (const providerId of activeOrder) {
      const outcome = await callProvider(providerId, normalizedOperation, request, attempts);
      if (outcome.kind === 'ok') {
        return deepFreeze({
          contract_version: PROVIDER_ROUTER_CONTRACT_VERSION,
          ...outcome.candidate,
          attempts: Object.freeze(attempts.map((attempt) => ({ ...attempt }))),
        });
      }
      if (outcome.kind === 'blocked') {
        throw new ProviderRouterError(outcome.code, providerId, normalizedOperation, {
          retryable: false,
          fallbackAllowed: false,
        });
      }
    }
    const result = unavailableProviderResult({
      operation: normalizedOperation,
      retrievedAt: request.retrieved_at,
      limitations: attempts.map(({ classification }) => classification).filter(Boolean),
      provider: null,
    });
    return deepFreeze({
      ...result,
      attempts: Object.freeze(attempts.map((attempt) => ({ ...attempt }))),
    });
  }

  async function collect(input = {}) {
    let request;
    try {
      request = normalizeProviderRequest(input, 'get_profile', {
        now: () => new Date(clockMs(clock)).toISOString(),
      });
    } catch (error) {
      throw new ProviderRouterError(error?.reasonCode || 'invalid_request', undefined, 'get_profile');
    }
    const result = await execute('get_profile', request);
    const attempts = legacyAttempts(result.attempts || []);
    if (result.status === 'unavailable') {
      return deepFreeze({
        contractVersion: PROVIDER_ROUTER_CONTRACT_VERSION,
        status: 'unavailable',
        provider: null,
        snapshot: null,
        attempts,
      });
    }
    return deepFreeze({
      contractVersion: PROVIDER_ROUTER_CONTRACT_VERSION,
      status: 'collected',
      provider: result.provider,
      snapshot: legacySnapshot(result, request),
      attempts,
    });
  }

  const router = {
    contractVersion: PROVIDER_ROUTER_CONTRACT_VERSION,
    providerOrder: Object.freeze(activeOrder),
    capabilities: Object.freeze(PROVIDER_OPERATIONS.map((operation) => `read-${operation}`)),
    execute,
    collect,
    getCircuitState: () => deepFreeze(Object.fromEntries(
      [...circuitStates.entries()].map(([key, value]) => [key, { ...value }]),
    )),
  };
  for (const operation of PROVIDER_OPERATIONS) {
    Object.defineProperty(router, operation, {
      configurable: false,
      enumerable: true,
      writable: false,
      value: (input = {}) => execute(operation, input),
    });
  }
  return Object.freeze(router);
}
