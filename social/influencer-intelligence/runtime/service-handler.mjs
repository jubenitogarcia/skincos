import { randomUUID } from 'node:crypto';

import {
  verifyCrmRequest,
  verifyServiceRequest,
} from './auth.mjs';
import {
  INFLUENCER_INTELLIGENCE_FLAG,
  INFLUENCER_INTELLIGENCE_GRANT,
  INFLUENCER_INTELLIGENCE_RUNTIME_REGISTERED,
  INTERNAL_SERVICE_CONTRACT_VERSION,
  INTERNAL_SERVICE_PATH,
  RUNTIME_LIMITS,
  parseFeatureFlag,
  requestIdFrom,
  safeActorScope,
} from './runtime-contract.mjs';

const CREATOR_KEY = /^[A-Za-z0-9._:-]{1,128}$/;
const SAFE_QUERY = /^[A-Za-z0-9._@ -]{0,80}$/;
const SENSITIVE_KEY = /(?:access[_-]?token|refresh[_-]?token|authorization|cookie|credential|secret|password|api[_-]?key|session|provider.?account|raw.?payload|raw.?comment|caption|media.?url|binary|sql|shell|command|prompt|completion)/i;
const SENSITIVE_TEXT = /(?:bearer\s+[A-Za-z0-9._-]{8,}|(?:access[_-]?token|refresh[_-]?token|api[_-]?key|password|authorization|cookie)\s*[:=])/i;

function error(code) {
  const value = new Error(code);
  value.code = code;
  return value;
}

function json(status, body, requestId) {
  const text = JSON.stringify(body);
  if (new TextEncoder().encode(text).byteLength > RUNTIME_LIMITS.maxResponseBytes) {
    return new Response(JSON.stringify({ ok: false, error: 'RESPONSE_TOO_LARGE', request_id: requestId }), { status: 502, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'x-request-id': requestId } });
  }
  return new Response(text, { status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'x-request-id': requestId } });
}

function registered(config) {
  if (typeof config?.registered === 'function') return config.registered() === true;
  if (config?.registered !== undefined) return config.registered === true;
  if (config?.env && Object.hasOwn(config.env, INFLUENCER_INTELLIGENCE_RUNTIME_REGISTERED)) return parseFeatureFlag(config.env[INFLUENCER_INTELLIGENCE_RUNTIME_REGISTERED]);
  return true;
}

function flag(config) {
  if (!registered(config)) return false;
  if (typeof config?.enabled === 'function') return config.enabled() === true;
  if (config?.enabled !== undefined) return config.enabled === true;
  return parseFeatureFlag(config?.env?.[INFLUENCER_INTELLIGENCE_FLAG]);
}

function safeRequestId(request) {
  return requestIdFrom(request.headers, randomUUID());
}

function sanitize(value, depth = 0) {
  if (depth > 8) return '[truncated-depth]';
  if (typeof value === 'string') return SENSITIVE_TEXT.test(value) ? '[redacted]' : value.slice(0, 800);
  if (value === null || typeof value === 'number' || typeof value === 'boolean') return value;
  if (Array.isArray(value)) return value.slice(0, 100).map((item) => sanitize(item, depth + 1));
  if (!value || typeof value !== 'object') return null;
  const output = {};
  for (const [key, child] of Object.entries(value).slice(0, 100)) {
    if (SENSITIVE_KEY.test(key)) continue;
    output[key.slice(0, 120)] = sanitize(child, depth + 1);
  }
  return output;
}

async function readJson(request) {
  const declared = Number(request.headers.get('content-length') || 0);
  if (Number.isFinite(declared) && declared > RUNTIME_LIMITS.maxRequestBytes) throw error('REQUEST_TOO_LARGE');
  const bytes = new Uint8Array(await request.arrayBuffer());
  if (bytes.byteLength > RUNTIME_LIMITS.maxRequestBytes) throw error('REQUEST_TOO_LARGE');
  if (!bytes.byteLength) return null;
  try { return JSON.parse(new TextDecoder().decode(bytes)); } catch { throw error('INVALID_INPUT'); }
}

function recordKeys(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? Object.keys(value) : [];
}

function boundedCreatorKey(value) {
  if (typeof value !== 'string' || !CREATOR_KEY.test(value.trim())) throw error('INVALID_INPUT');
  return value.trim();
}

function parseSearch(url) {
  const allowed = new Set(['query', 'provider', 'registry_state', 'page', 'page_size', 'limit']);
  for (const key of url.searchParams.keys()) if (!allowed.has(key)) throw error('INVALID_INPUT');
  if (url.searchParams.has('page_size') && url.searchParams.has('limit')) throw error('INVALID_INPUT');
  const query = url.searchParams.get('query') || '';
  if (!SAFE_QUERY.test(query)) throw error('INVALID_INPUT');
  const page = Number(url.searchParams.get('page') || 1);
  const pageSize = Number(url.searchParams.get('page_size') || url.searchParams.get('limit') || 25);
  if (!Number.isSafeInteger(page) || page < 1 || page > 100_000 || !Number.isSafeInteger(pageSize) || pageSize < 1 || pageSize > 50) throw error('INVALID_INPUT');
  const provider = url.searchParams.get('provider');
  const registryState = url.searchParams.get('registry_state');
  if (provider && !['meta-graph', 'instagrapi'].includes(provider)) throw error('INVALID_INPUT');
  if (registryState && !['candidate', 'paused', 'unavailable'].includes(registryState)) throw error('INVALID_INPUT');
  return { ...(query ? { query } : {}), ...(provider ? { provider } : {}), ...(registryState ? { registry_state: registryState } : {}), page, page_size: pageSize };
}

function parseCreatorKeys(value) {
  if (!Array.isArray(value) || value.length < 1 || value.length > RUNTIME_LIMITS.maxCreatorsPerRequest) throw error('INVALID_INPUT');
  const keys = value.map(boundedCreatorKey);
  if (new Set(keys).size !== keys.length) throw error('INVALID_INPUT');
  return keys;
}

function parseRegistryBody(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body) || recordKeys(body).length !== 1 || typeof body.handle !== 'string' || !/^@?[A-Za-z0-9._]{1,30}$/.test(body.handle.trim())) throw error('INVALID_INPUT');
  return { handle: body.handle.trim() };
}

function parseQueryBody(body, path) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw error('INVALID_INPUT');
  if (path === '/compare') {
    if (recordKeys(body).length !== 1 || !Object.hasOwn(body, 'creatorKeys')) throw error('INVALID_INPUT');
    return { creator_keys: parseCreatorKeys(body.creatorKeys) };
  }
  if (path === '/campaign-fit') {
    const keys = recordKeys(body);
    if (keys.some((key) => !['campaignKey', 'campaignVersion', 'creatorKeys'].includes(key)) || typeof body.campaignKey !== 'string' || !CREATOR_KEY.test(body.campaignKey)) throw error('INVALID_INPUT');
    const version = body.campaignVersion === undefined ? 1 : body.campaignVersion;
    if (!Number.isSafeInteger(version) || version < 1 || version > 100_000) throw error('INVALID_INPUT');
    return { campaign_key: body.campaignKey, campaign_version: version, ...(body.creatorKeys === undefined ? {} : { creator_keys: parseCreatorKeys(body.creatorKeys) }), page: 1, page_size: 20 };
  }
  throw error('INVALID_INPUT');
}

function parseSnapshotRequest(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw error('INVALID_INPUT');
  const allowed = new Set(['contract_version', 'workflow_version', 'mode', 'max_creators', 'max_concurrency', 'timeout_ms', 'retry_policy', 'service_path', 'requested_at', 'creators']);
  if (recordKeys(body).some((key) => !allowed.has(key))) throw error('INVALID_INPUT');
  if (body.contract_version !== 'influencer-intelligence/scheduler/v1' || body.workflow_version !== 'influencer-intelligence-snapshot-workflow/v1' || body.mode !== 'shadow' || body.service_path !== `${INTERNAL_SERVICE_PATH}/snapshots`) throw error('INVALID_INPUT');
  if (body.requested_at !== undefined && (typeof body.requested_at !== 'string' || Number.isNaN(new Date(body.requested_at).getTime()))) throw error('INVALID_INPUT');
  if (!Number.isSafeInteger(body.max_creators) || body.max_creators < 1 || body.max_creators > RUNTIME_LIMITS.maxSnapshotCreators || body.max_concurrency !== 1 || !Number.isSafeInteger(body.timeout_ms) || body.timeout_ms < 1_000 || body.timeout_ms > RUNTIME_LIMITS.snapshotTimeoutMs) throw error('INVALID_INPUT');
  if (!body.retry_policy || body.retry_policy.max_attempts !== 2 || body.retry_policy.same_idempotency_key !== true || !Array.isArray(body.retry_policy.retryable_classes) || body.retry_policy.retryable_classes.some((item) => !['timeout', 'rate_limited', 'upstream_5xx', 'network_transient'].includes(item))) throw error('INVALID_INPUT');
  if (!Array.isArray(body.creators) || body.creators.length > RUNTIME_LIMITS.maxSnapshotCreators) throw error('INVALID_INPUT');
  const creators = body.creators.map((creator) => {
    if (!creator || typeof creator !== 'object' || Array.isArray(creator)) throw error('INVALID_INPUT');
    let canonicalHandle = null;
    if (creator.canonical_handle !== null && creator.canonical_handle !== undefined && creator.canonical_handle !== '') {
      if (typeof creator.canonical_handle !== 'string' || !/^@?[A-Za-z0-9._]{1,30}$/.test(creator.canonical_handle)) throw error('INVALID_INPUT');
      canonicalHandle = creator.canonical_handle.replace(/^@/, '').toLowerCase();
    }
    const normalized = {
      creator_key: boundedCreatorKey(creator.creator_key),
      identity_key: typeof creator.identity_key === 'string' && /^[A-Za-z0-9._:-]{1,160}$/.test(creator.identity_key) ? creator.identity_key : null,
      canonical_handle: canonicalHandle,
      provider: creator.provider,
      operations: creator.operations,
      bucket_seconds: creator.bucket_seconds,
      media_limit: creator.media_limit,
      idempotency_keys: creator.idempotency_keys && typeof creator.idempotency_keys === 'object' && !Array.isArray(creator.idempotency_keys) ? creator.idempotency_keys : {},
    };
    if (!normalized.identity_key || !['meta-graph', 'instagrapi'].includes(normalized.provider) || !Array.isArray(normalized.operations) || normalized.operations.length !== 2 || normalized.operations.some((operation) => !['snapshot_creator', 'snapshot_creator_media'].includes(operation)) || normalized.bucket_seconds !== 3600 || !Number.isSafeInteger(normalized.media_limit) || normalized.media_limit < 1 || normalized.media_limit > RUNTIME_LIMITS.maxMediaPerCreator || Object.keys(normalized.idempotency_keys).some((operation) => !['snapshot_creator', 'snapshot_creator_media'].includes(operation) || typeof normalized.idempotency_keys[operation] !== 'string' || !/^[A-Za-z0-9._:-]{1,240}$/.test(normalized.idempotency_keys[operation]))) throw error('INVALID_INPUT');
    return normalized;
  });
  return { ...body, creators };
}

function route(url) {
  if (url.pathname === `${INTERNAL_SERVICE_PATH}/health` || url.pathname === '/health') return { name: 'health' };
  if (!url.pathname.startsWith(INTERNAL_SERVICE_PATH)) return null;
  const suffix = url.pathname.slice(INTERNAL_SERVICE_PATH.length) || '/';
  if (suffix === '/creators') return { name: 'creators' };
  if (suffix === '/compare') return { name: 'compare' };
  if (suffix === '/campaign-fit') return { name: 'campaign-fit' };
  if (suffix === '/snapshots') return { name: 'snapshot-batch' };
  const match = suffix.match(/^\/creators\/([^/]{1,256})\/(profile|snapshots|media|analysis|dashboard|score|coverage)$/);
  if (match) {
    let creatorKey;
    try { creatorKey = decodeURIComponent(match[1]); } catch { return null; }
    if (CREATOR_KEY.test(creatorKey)) return { name: match[2], creatorKey };
  }
  return null;
}

function operationFor(routeValue, method) {
  if (routeValue.name === 'health') return 'health';
  if (routeValue.name === 'creators') return method === 'POST' ? 'register_creator' : 'search_creators';
  if (routeValue.name === 'snapshot-batch') return 'snapshot_batch';
  return routeValue.name;
}

function parseHistoryQuery(url) {
  const allowed = new Set(['window_start', 'window_end', 'page', 'page_size']);
  for (const key of url.searchParams.keys()) if (!allowed.has(key)) throw error('INVALID_INPUT');
  const page = Number(url.searchParams.get('page') || 1);
  const pageSize = Number(url.searchParams.get('page_size') || 25);
  if (!Number.isSafeInteger(page) || page < 1 || page > 100_000 || !Number.isSafeInteger(pageSize) || pageSize < 1 || pageSize > 50) throw error('INVALID_INPUT');
  const start = url.searchParams.get('window_start');
  const end = url.searchParams.get('window_end');
  if ((start && !end) || (!start && end)) throw error('INVALID_INPUT');
  let window;
  if (start && end) {
    const startDate = new Date(start);
    const endDate = new Date(end);
    if (Number.isNaN(startDate.getTime()) || Number.isNaN(endDate.getTime()) || endDate <= startDate || endDate.getTime() - startDate.getTime() > 365 * 24 * 60 * 60 * 1000) throw error('INVALID_INPUT');
    window = { start: startDate.toISOString(), end: endDate.toISOString() };
  }
  return { ...(window ? { window } : {}), page, page_size: pageSize };
}

function responseEnvelope(raw, requestId, clock) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw) || !Object.hasOwn(raw, 'data')) throw error('INVALID_SERVICE_RESPONSE');
  const output = sanitize({
    ...raw,
    contract_version: INTERNAL_SERVICE_CONTRACT_VERSION,
    request_id: requestId,
    generated_at: new Date(clock()).toISOString(),
  });
  return output;
}

function codeFor(errorValue) {
  return ['INVALID_INPUT', 'NOT_FOUND', 'UNAVAILABLE', 'TIMEOUT', 'RATE_LIMITED', 'TOO_MANY_CONCURRENT_REQUESTS', 'AUDIT_UNAVAILABLE', 'REQUEST_TOO_LARGE', 'INVALID_SERVICE_RESPONSE'].includes(errorValue?.code)
    ? errorValue.code
    : 'INTERNAL';
}

function statusFor(code) {
  return { INVALID_INPUT: 400, AUTH_REQUIRED: 401, GRANT_REQUIRED: 403, NOT_FOUND: 404, RATE_LIMITED: 429, TOO_MANY_CONCURRENT_REQUESTS: 429, REQUEST_TOO_LARGE: 413, TIMEOUT: 504, UNAVAILABLE: 503, AUDIT_UNAVAILABLE: 503, INVALID_SERVICE_RESPONSE: 502, INTERNAL: 500 }[code] || 500;
}

function rateLimiter(clock = () => Date.now()) {
  const windows = new Map();
  return { allow(key) {
    const now = clock();
    const values = (windows.get(key) || []).filter((stamp) => now - stamp < 60_000);
    if (values.length >= RUNTIME_LIMITS.maxRequestsPerMinute) { windows.set(key, values); return false; }
    values.push(now); windows.set(key, values); return true;
  } };
}

export function createInfluencerIntelligenceServiceHandler({
  readService,
  getReadService,
  registerCreator,
  getRegistryWriter,
  snapshotOperations,
  getSnapshotOperations,
  audit,
  clock = () => Date.now(),
  config = {},
  rateLimiter: suppliedRateLimiter,
  maxConcurrentRequests = RUNTIME_LIMITS.maxConcurrentRequests,
  timeoutMs = RUNTIME_LIMITS.serviceTimeoutMs,
} = {}) {
  if (typeof audit !== 'function') throw new TypeError('audit function is required');
  if (!Number.isInteger(maxConcurrentRequests) || maxConcurrentRequests < 1 || maxConcurrentRequests > RUNTIME_LIMITS.maxConcurrentRequests) throw new TypeError('maxConcurrentRequests is invalid');
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > RUNTIME_LIMITS.serviceTimeoutMs) throw new TypeError('timeoutMs is invalid');
  const limiter = suppliedRateLimiter || rateLimiter(clock);
  let concurrent = 0;

  async function dependency(direct, factory) {
    if (direct) return direct;
    if (typeof factory === 'function') return factory();
    return null;
  }

  async function invoke(fn, input, requestId, context) {
    if (typeof fn !== 'function') throw error('UNAVAILABLE');
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const result = Promise.resolve().then(() => fn(input, { signal: controller.signal, request_id: requestId, actor_scope: context.actor_scope, data_scope: context.data_scope }));
      const timeout = new Promise((_, reject) => {
        const onAbort = () => reject(error('TIMEOUT'));
        controller.signal.addEventListener('abort', onAbort, { once: true });
      });
      return await Promise.race([result, timeout]);
    } finally {
      clearTimeout(timer);
    }
  }

  async function handle(request) {
    const requestId = safeRequestId(request);
    const url = new URL(request.url);
    const routeValue = route(url);
    if (!routeValue) return json(404, { ok: false, error: 'NOT_FOUND', request_id: requestId }, requestId);
    if (routeValue.name === 'health') {
      return json(200, { ok: true, registered: registered(config), enabled: flag(config), flag: INFLUENCER_INTELLIGENCE_FLAG, grant: INFLUENCER_INTELLIGENCE_GRANT, runtime_version: 'influencer-intelligence/runtime-registration/v1' }, requestId);
    }
    if (!flag(config)) return json(404, { ok: false, error: 'NOT_FOUND', request_id: requestId }, requestId);
    const method = request.method.toUpperCase();
    const operation = operationFor(routeValue, method);
    const isSnapshot = routeValue.name === 'snapshot-batch';
    const isReadTransport = request.headers.get('x-influencer-intelligence-caller') === 'mcp-readonly';
    const context = isSnapshot
      ? verifyServiceRequest(request, { token: config.serviceToken, caller: 'orb-scheduler' })
      : verifyCrmRequest(request, { key: config.crmHmacKey, now: clock() }) || (isReadTransport ? verifyServiceRequest(request, { token: config.serviceToken, caller: 'mcp-readonly' }) : null);
    if (!context) return json(401, { ok: false, error: 'AUTH_REQUIRED', request_id: requestId }, requestId);
    if (!context.grants?.includes(INFLUENCER_INTELLIGENCE_GRANT)) return json(403, { ok: false, error: 'GRANT_REQUIRED', request_id: requestId }, requestId);
    if (!limiter.allow(safeActorScope(context.actor_scope))) return json(429, { ok: false, error: 'RATE_LIMITED', request_id: requestId }, requestId);
    if (concurrent >= maxConcurrentRequests) return json(429, { ok: false, error: 'TOO_MANY_CONCURRENT_REQUESTS', request_id: requestId }, requestId);
    if (isSnapshot && (method !== 'POST' || context.caller !== 'orb-scheduler')) return json(403, { ok: false, error: 'GRANT_REQUIRED', request_id: requestId }, requestId);
    if (!isSnapshot && routeValue.name === 'creators' && !['GET', 'POST'].includes(method)) return json(405, { ok: false, error: 'INVALID_INPUT', request_id: requestId }, requestId);
    if (!isSnapshot && routeValue.name !== 'creators' && ((routeValue.name === 'compare' || routeValue.name === 'campaign-fit') ? method !== 'POST' : method !== 'GET')) return json(405, { ok: false, error: 'INVALID_INPUT', request_id: requestId }, requestId);

    const startedAt = clock();
    let code = null;
    let status = 200;
    let body;
    concurrent += 1;
    try {
      let result;
      if (routeValue.name === 'creators' && method === 'GET') {
        const service = await dependency(readService, getReadService);
        result = await invoke(service?.searchCreators, parseSearch(url), requestId, context);
      } else if (routeValue.name === 'creators' && method === 'POST') {
        const input = parseRegistryBody(await readJson(request));
        const writer = await dependency(registerCreator, getRegistryWriter);
        result = await invoke(writer?.registerCreator || writer, input, requestId, context);
      } else if (['profile', 'snapshots', 'media', 'analysis', 'dashboard', 'score'].includes(routeValue.name)) {
        if (routeValue.name === 'dashboard' && context.caller !== 'crm') throw error('NOT_FOUND');
        const service = await dependency(readService, getReadService);
        const input = ['snapshots', 'media'].includes(routeValue.name) ? parseHistoryQuery(url) : {};
        input.creator_key = boundedCreatorKey(routeValue.creatorKey);
        const methodName = { profile: 'getCreatorProfile', snapshots: 'getCreatorSnapshots', media: 'getCreatorMedia', analysis: 'getCreatorAnalytics', dashboard: 'getCreatorDashboard', score: 'getCreatorScore' }[routeValue.name];
        result = await invoke(service?.[methodName], input, requestId, context);
      } else if (routeValue.name === 'coverage') {
        const service = await dependency(readService, getReadService);
        const profile = await invoke(service?.getCreatorProfile, { creator_key: boundedCreatorKey(routeValue.creatorKey) }, requestId, context);
        result = profile?.data === null ? profile : { ...profile, data: { creator_key: routeValue.creatorKey, data_quality: { coverage: profile.coverage, freshness: profile.freshness, providers: profile.providers, limitations: profile.limitations } } };
      } else if (routeValue.name === 'compare' || routeValue.name === 'campaign-fit') {
        const service = await dependency(readService, getReadService);
        const bodyInput = parseQueryBody(await readJson(request), `/${routeValue.name}`);
        result = await invoke(routeValue.name === 'compare' ? service?.compareCreators : service?.getCampaignFit, bodyInput, requestId, context);
      } else if (routeValue.name === 'snapshot-batch') {
        const snapshotInput = parseSnapshotRequest(await readJson(request));
        const operation = await dependency(snapshotOperations, getSnapshotOperations);
        if (!operation) throw error('UNAVAILABLE');
        result = await invoke(operation.run || operation.execute || operation, snapshotInput, requestId, context);
      } else {
        throw error('NOT_FOUND');
      }
      body = responseEnvelope(result, requestId, clock);
    } catch (caught) {
      code = codeFor(caught);
      status = statusFor(code);
      body = { ok: false, error: code, request_id: requestId };
    } finally {
      concurrent = Math.max(0, concurrent - 1);
    }

    try {
      await audit({ request_id: requestId, operation, caller: context.caller, actor_scope: context.actor_scope, grant: true, ok: code === null, error_code: code, status: code || 'ok', duration_ms: clock() - startedAt, at: new Date(clock()).toISOString() });
    } catch {
      return json(503, { ok: false, error: 'AUDIT_UNAVAILABLE', request_id: requestId }, requestId);
    }
    return json(status, body, requestId);
  }

  return Object.freeze({ handle });
}

export const __testing = Object.freeze({
  readJson,
  parseSearch,
  parseCreatorKeys,
  parseSnapshotRequest,
  sanitize,
  route,
  statusFor,
});
