import { ProviderCollectionError, ProviderGapError } from '../providers/profile-provider.mjs';
import { PROVIDER_OPERATIONS } from '../providers/provider-contracts.mjs';

const TOKEN_VAULT_PATH = '/internal/token-vault/v1/analytics/operations';
const ALLOWED_HOSTS = new Set(['api.skincos.com.br', 'api-staging.skincos.com.br']);
const MAX_REQUEST_BYTES = 32 * 1024;
const DEFAULT_TIMEOUT_MS = 12_000;

function isRecord(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function boundedString(value, label, maxLength = 160) {
  if (typeof value !== 'string' || !value.trim() || value.length > maxLength || /[\u0000-\u001f\u007f]/.test(value)) {
    throw new TypeError(`${label} is invalid`);
  }
  return value.trim();
}

function opaque(value, label) {
  const normalized = boundedString(value, label);
  if (!/^[A-Za-z0-9._:-]+$/.test(normalized)) throw new TypeError(`${label} is invalid`);
  return normalized;
}

function endpointUrl(value) {
  const url = new URL(boundedString(value, 'baseUrl', 240));
  if (url.protocol !== 'https:' || !ALLOWED_HOSTS.has(url.hostname) || url.search || url.hash) {
    throw new TypeError('Token Vault baseUrl is not an approved HTTPS endpoint');
  }
  const pathname = url.pathname.replace(/\/+$/, '');
  const accepted = [
    '/internal/token-vault',
    TOKEN_VAULT_PATH,
  ];
  if (!accepted.includes(pathname)) throw new TypeError('Token Vault baseUrl path is not approved');
  url.pathname = pathname === TOKEN_VAULT_PATH ? pathname : TOKEN_VAULT_PATH;
  return Object.freeze(url);
}

function timeoutValue(value) {
  const timeoutMs = value === undefined ? DEFAULT_TIMEOUT_MS : Number(value);
  if (!Number.isInteger(timeoutMs) || timeoutMs < 100 || timeoutMs > DEFAULT_TIMEOUT_MS) {
    throw new TypeError('timeoutMs is outside the safe bound');
  }
  return timeoutMs;
}

function errorForCode(code) {
  if (code === 'permission_gap' || code === 'coverage_gap') return new ProviderGapError(code);
  if (code === 'invalid_response') return new ProviderCollectionError('invalid_response');
  if (code === 'rate_limited') return new ProviderCollectionError('rate_limited');
  const error = new Error('Token Vault analytics transport unavailable');
  error.code = code === 'timeout' ? 'timeout' : 'provider_unavailable';
  return error;
}

function safeResponseCode(payload) {
  const code = isRecord(payload) && typeof payload.error === 'string' ? payload.error : '';
  return new Set([
    'permission_gap',
    'coverage_gap',
    'provider_unavailable',
    'timeout',
    'invalid_response',
    'rate_limited',
  ]).has(code) ? code : 'provider_unavailable';
}

function requestPayload(request, credentialRef) {
  const body = {
    provider: 'meta-graph',
    operation: request.operation,
    credential_ref: credentialRef,
    ...(request.creator_key ? { creator_key: request.creator_key } : {}),
    ...(request.canonical_handle ? { canonical_handle: request.canonical_handle } : {}),
    observed_at: request.observed_at,
    retrieved_at: request.retrieved_at,
    correlation_id: request.correlation_id,
    limit: request.limit,
    ...(request.window ? { window: request.window } : {}),
    ...(request.media_keys ? { media_keys: request.media_keys } : {}),
    ...(request.requested_fields ? { requested_fields: request.requested_fields } : {}),
    ...(request.metric_set ? { metric_set: request.metric_set } : {}),
  };
  const encoded = JSON.stringify(body);
  if (new TextEncoder().encode(encoded).byteLength > MAX_REQUEST_BYTES) {
    throw new TypeError('Token Vault analytics request is too large');
  }
  return encoded;
}

async function callTokenVault({ endpoint, apiToken, fetchImpl, timeoutMs, credentialRef, request, context }) {
  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);
  const parentSignal = context?.signal;
  const abortParent = () => controller.abort();
  if (parentSignal) {
    if (parentSignal.aborted) abortParent();
    else parentSignal.addEventListener('abort', abortParent, { once: true });
  }

  try {
    const response = await fetchImpl(endpoint, {
      method: 'POST',
      headers: {
        accept: 'application/json',
        'content-type': 'application/json',
        authorization: `Bearer ${apiToken}`,
      },
      body: requestPayload(request, credentialRef),
      signal: controller.signal,
    });
    let payload = null;
    try {
      payload = await response.json();
    } catch {
      throw new ProviderCollectionError('invalid_response');
    }
    if (!response.ok || !isRecord(payload) || payload.ok !== true || !isRecord(payload.result)) {
      throw errorForCode(safeResponseCode(payload));
    }
    return payload.result;
  } catch (error) {
    if (error instanceof ProviderGapError || error instanceof ProviderCollectionError) throw error;
    if (timedOut || controller.signal.aborted || error?.name === 'AbortError') {
      throw errorForCode('timeout');
    }
    throw errorForCode(error?.code || 'provider_unavailable');
  } finally {
    clearTimeout(timer);
    if (parentSignal) parentSignal.removeEventListener('abort', abortParent);
  }
}

/**
 * Creates injected operation functions for the official Meta Graph provider.
 * Token Vault owns the credential; this closure is the only place the
 * analytics API token and credential reference are accepted. Neither is part
 * of the provider request/result contract.
 */
export function createTokenVaultMetaGraphOperations({
  baseUrl,
  apiToken,
  credentialRef,
  fetchImpl = globalThis.fetch,
  timeoutMs,
} = {}) {
  const endpoint = endpointUrl(baseUrl);
  const vaultApiToken = boundedString(apiToken, 'apiToken', 512);
  const vaultCredentialRef = opaque(credentialRef, 'credentialRef');
  const boundedTimeout = timeoutValue(timeoutMs);
  if (typeof fetchImpl !== 'function') throw new TypeError('fetchImpl is required');

  const operations = {};
  for (const operation of PROVIDER_OPERATIONS) {
    operations[operation] = (request, context = {}) => callTokenVault({
      endpoint,
      apiToken: vaultApiToken,
      fetchImpl,
      timeoutMs: boundedTimeout,
      credentialRef: vaultCredentialRef,
      request: { ...request, operation },
      context,
    });
  }
  return Object.freeze(operations);
}
