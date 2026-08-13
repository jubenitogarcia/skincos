import { randomUUID } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { createInfluencerIntelligenceProviderRouter } from './provider-runtime.mjs';

const STAGING_TOKEN_VAULT_BASE_URL = 'https://api-staging.skincos.com.br/internal/token-vault';
const META_PROVIDER = 'meta-graph';
const SHADOW_TIMEOUT_MS = 12_000;

function boundedText(value, label, { maxLength = 160 } = {}) {
  if (typeof value !== 'string' || !value.trim() || value.length > maxLength || /[\u0000-\u001f\u007f]/.test(value)) {
    throw new TypeError(`${label} is invalid`);
  }
  return value.trim();
}

function normalizeHandle(value) {
  const handle = boundedText(value, 'canonicalHandle', { maxLength: 31 }).replace(/^@/, '').toLowerCase();
  if (!/^[a-z0-9._]{1,30}$/.test(handle)) throw new TypeError('canonicalHandle is invalid');
  return handle;
}

function normalizedTimestamp(value) {
  const date = value === undefined ? new Date() : new Date(value);
  if (Number.isNaN(date.getTime())) throw new TypeError('now is invalid');
  return date.toISOString();
}

function arrayOfText(value) {
  return Array.isArray(value) ? value.filter((entry) => typeof entry === 'string') : [];
}

function summarizeAttempt(value) {
  return {
    provider: typeof value?.provider === 'string' ? value.provider : null,
    status: typeof value?.status === 'string' ? value.status : 'unknown',
    ...(typeof value?.classification === 'string' ? { classification: value.classification } : {}),
    ...(Number.isInteger(value?.retry_count) ? { retry_count: value.retry_count } : {}),
  };
}

/**
 * Produces operational evidence only. It intentionally omits creator identity,
 * credential references, creator keys, raw source references and every observed
 * metric value.
 */
export function redactProviderResult(result) {
  const evidence = result?.provider_specific_evidence || {};
  const freshness = result?.freshness || {};
  return Object.freeze({
    operation: typeof result?.operation === 'string' ? result.operation : 'unknown',
    status: typeof result?.status === 'string' ? result.status : 'unavailable',
    provider: typeof result?.provider === 'string' ? result.provider : null,
    data_classification: typeof result?.data_classification === 'string'
      ? result.data_classification
      : 'unavailable',
    freshness: Object.freeze({
      ...(Number.isInteger(freshness.max_age_seconds) ? { max_age_seconds: freshness.max_age_seconds } : {}),
    }),
    limitations: Object.freeze(arrayOfText(result?.limitations)),
    provider_specific_evidence: Object.freeze({
      ...(typeof evidence.adapter_version === 'string' ? { adapter_version: evidence.adapter_version } : {}),
      ...(typeof evidence.endpoint_family === 'string' ? { endpoint_family: evidence.endpoint_family } : {}),
      fields: Object.freeze(arrayOfText(evidence.fields)),
      ...(typeof evidence.correlation_id === 'string' ? { correlation_id: evidence.correlation_id } : {}),
    }),
    attempts: Object.freeze((Array.isArray(result?.attempts) ? result.attempts : []).map(summarizeAttempt)),
  });
}

function assertMetaOnlyRouter(router) {
  if (!router || typeof router.resolve_creator !== 'function' || typeof router.get_profile !== 'function') {
    throw new TypeError('router must implement the Meta read-only operations');
  }
  const providerOrder = Array.isArray(router.providerOrder) ? router.providerOrder : [];
  if (providerOrder.length !== 1 || providerOrder[0] !== META_PROVIDER) {
    throw new TypeError('shadow router must contain only the Meta official provider');
  }
}

function recordedTransportAttempts(operations) {
  return operations.reduce((total, operation) => total + operation.attempts.reduce((attempts, attempt) => {
    if (attempt.provider !== META_PROVIDER || attempt.status === 'skipped') return attempts;
    return attempts + Math.max(1, Number.isInteger(attempt.retry_count) ? attempt.retry_count + 1 : 1);
  }, 0), 0);
}

/**
 * Runs the smallest permitted real transport journey: resolution followed by a
 * profile request only when resolution succeeds. The temporary creator key is
 * an internal request key, never a claimed Meta identifier and never persisted.
 */
export async function runStagingShadowRouter({
  router,
  canonicalHandle,
  correlationId = `ii-shadow-${randomUUID()}`,
  now,
} = {}) {
  assertMetaOnlyRouter(router);
  const handle = normalizeHandle(canonicalHandle);
  const timestamp = normalizedTimestamp(now);
  const correlation = boundedText(correlationId, 'correlationId', { maxLength: 160 });
  const requestBase = Object.freeze({
    observed_at: timestamp,
    retrieved_at: timestamp,
    correlation_id: correlation,
    limit: 1,
  });

  const resolved = await router.resolve_creator({
    ...requestBase,
    canonical_handle: handle,
  });
  const operations = [redactProviderResult(resolved)];
  if (resolved?.status !== 'ok' || resolved?.data?.resolved !== true) {
    return Object.freeze({
      contract_version: 'influencer-intelligence/staging-shadow-router/v1',
      status: 'unavailable',
      provider_order: Object.freeze([...router.providerOrder]),
      correlation_id: correlation,
      operation_count: 1,
      recorded_transport_attempts: recordedTransportAttempts(operations),
      operations: Object.freeze(operations),
    });
  }

  const resolvedHandle = normalizeHandle(resolved.data.canonical_handle || handle);
  const profile = await router.get_profile({
    ...requestBase,
    creator_key: `shadow:${resolvedHandle}`,
    canonical_handle: resolvedHandle,
  });
  operations.push(redactProviderResult(profile));
  return Object.freeze({
    contract_version: 'influencer-intelligence/staging-shadow-router/v1',
    status: profile?.status === 'ok' ? 'ok' : 'unavailable',
    provider_order: Object.freeze([...router.providerOrder]),
    correlation_id: correlation,
    operation_count: 2,
    recorded_transport_attempts: recordedTransportAttempts(operations),
    operations: Object.freeze(operations),
  });
}

export async function runStagingShadowRouterFromEnvironment(environment = process.env) {
  const router = createInfluencerIntelligenceProviderRouter({
    tokenVaultBaseUrl: STAGING_TOKEN_VAULT_BASE_URL,
    tokenVaultApiToken: boundedText(environment.TOKEN_VAULT_ANALYTICS_API_TOKEN, 'TOKEN_VAULT_ANALYTICS_API_TOKEN', { maxLength: 512 }),
    tokenVaultCredentialRef: boundedText(environment.INFLUENCER_INTELLIGENCE_SHADOW_CREDENTIAL_REF, 'INFLUENCER_INTELLIGENCE_SHADOW_CREDENTIAL_REF'),
    timeoutMs: SHADOW_TIMEOUT_MS,
    retryPolicy: Object.freeze({ maxAttempts: 2, baseDelayMs: 25 }),
  });
  return runStagingShadowRouter({
    router,
    canonicalHandle: environment.INFLUENCER_INTELLIGENCE_SHADOW_CREATOR_HANDLE,
  });
}

const invokedDirectly = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (invokedDirectly) {
  try {
    const result = await runStagingShadowRouterFromEnvironment();
    process.stdout.write(`${JSON.stringify(result)}\n`);
  } catch (error) {
    const code = typeof error?.code === 'string' ? error.code : 'shadow_router_error';
    process.stdout.write(`${JSON.stringify({
      contract_version: 'influencer-intelligence/staging-shadow-router/v1',
      status: 'error',
      error: code,
    })}\n`);
    process.exitCode = 1;
  }
}
