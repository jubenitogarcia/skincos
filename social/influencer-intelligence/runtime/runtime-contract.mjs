export const RUNTIME_REGISTRATION_VERSION = 'influencer-intelligence/runtime-registration/v1';
export const INTERNAL_SERVICE_CONTRACT_VERSION = 'influencer-intelligence/api/v1';
export const MCP_TRANSPORT_CONTRACT_VERSION = 'influencer-intelligence/mcp-transport/v1';

export const INFLUENCER_INTELLIGENCE_FLAG = 'INFLUENCER_INTELLIGENCE_ENABLED';
export const INFLUENCER_INTELLIGENCE_RUNTIME_REGISTERED = 'INFLUENCER_INTELLIGENCE_RUNTIME_REGISTERED';
export const INFLUENCER_INTELLIGENCE_GRANT = 'module.influencer-intelligence.access';
export const INTERNAL_SERVICE_PATH = '/internal/influencer-intelligence/v1';
export const MCP_PATH = '/mcp';

export const RUNTIME_LIMITS = Object.freeze({
  maxRequestBytes: 64 * 1024,
  maxResponseBytes: 512 * 1024,
  maxConcurrentRequests: 4,
  maxRequestsPerMinute: 60,
  serviceTimeoutMs: 12_000,
  snapshotTimeoutMs: 30_000,
  maxCreatorsPerRequest: 20,
  maxSnapshotCreators: 25,
  maxMediaPerCreator: 50,
});

export function parseFeatureFlag(value) {
  return ['1', 'true', 'yes', 'on'].includes(String(value ?? '').trim().toLowerCase());
}

export function boundedString(value, { max = 160, pattern = /^[A-Za-z0-9._:-]+$/ } = {}) {
  if (typeof value !== 'string') return null;
  const normalized = value.trim();
  return normalized && normalized.length <= max && pattern.test(normalized) ? normalized : null;
}

export function requestIdFrom(headers, fallback) {
  const candidate = headers?.get?.('x-request-id') ?? headers?.['x-request-id'];
  return boundedString(candidate, { max: 100, pattern: /^[A-Za-z0-9._:-]+$/ }) || fallback;
}

export function safeActorScope(value, fallback = 'internal') {
  return boundedString(value, { max: 160, pattern: /^[A-Za-z0-9._:-]+$/ }) || fallback;
}

export function safeDataScope(value) {
  return boundedString(value, { max: 160, pattern: /^[A-Za-z0-9._:-]+$/ });
}
