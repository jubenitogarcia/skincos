import { createHmac, timingSafeEqual } from 'node:crypto';

import {
  INFLUENCER_INTELLIGENCE_GRANT,
  safeActorScope,
  safeDataScope,
} from './runtime-contract.mjs';

export const CRM_SIGNATURE_VERSION = '2';
export const SERVICE_AUTH_HEADER = 'x-influencer-intelligence-service-token';
export const GRANT_HEADER = 'x-influencer-intelligence-grant';
export const CALLER_HEADER = 'x-influencer-intelligence-caller';

const CRM_SKEW_MS = 90_000;
const SAFE_CALLERS = new Set(['mcp-readonly', 'orb-scheduler']);

function header(headers, name) {
  return headers?.get?.(name) ?? headers?.[name] ?? null;
}

function base64Url(buffer) {
  return Buffer.from(buffer).toString('base64url');
}

function secret(value) {
  const normalized = String(value ?? '').trim();
  return normalized.length >= 16 ? normalized : null;
}

export function crmSignaturePayload({ timestamp, actorScope, method, path, search = '', grant = INFLUENCER_INTELLIGENCE_GRANT }) {
  return [CRM_SIGNATURE_VERSION, timestamp, actorScope, String(method).toUpperCase(), path, search, grant].join('.');
}

export function signCrmRequest(key, input) {
  const normalizedKey = secret(key);
  if (!normalizedKey) return null;
  return base64Url(createHmac('sha256', normalizedKey).update(crmSignaturePayload(input), 'utf8').digest());
}

function safeEquals(left, right) {
  const a = Buffer.from(String(left ?? ''));
  const b = Buffer.from(String(right ?? ''));
  return a.length === b.length && timingSafeEqual(a, b);
}

export function verifyCrmRequest(request, { key, now = Date.now(), skewMs = CRM_SKEW_MS } = {}) {
  const actorScope = header(request.headers, 'x-crm-actor-scope');
  const actorRole = header(request.headers, 'x-crm-actor-role');
  const timestamp = header(request.headers, 'x-crm-ts');
  const version = header(request.headers, 'x-crm-signature-version');
  const signature = header(request.headers, 'x-crm-signature');
  const grant = header(request.headers, 'x-crm-grant');
  if (!actorScope || !timestamp || !signature || version !== CRM_SIGNATURE_VERSION || grant !== INFLUENCER_INTELLIGENCE_GRANT) return null;
  if (!/^[a-f0-9]{64}$/.test(actorScope) || !/^\d{13}$/.test(timestamp)) return null;
  const timestampMs = Number(timestamp);
  if (!Number.isSafeInteger(timestampMs) || Math.abs(now - timestampMs) > skewMs) return null;
  const url = new URL(request.url);
  const expected = signCrmRequest(key, {
    timestamp,
    actorScope,
    method: request.method,
    path: url.pathname,
    search: url.search,
    grant,
  });
  if (!expected || !safeEquals(expected, signature)) return null;
  return {
    authenticated: true,
    grants: [INFLUENCER_INTELLIGENCE_GRANT],
    actor_scope: actorScope,
    actor_role: typeof actorRole === 'string' ? actorRole.slice(0, 80) : null,
    data_scope: safeDataScope(header(request.headers, 'x-crm-data-scope')),
    caller: 'crm',
  };
}

export function verifyServiceRequest(request, { token, caller, allowCallers = SAFE_CALLERS } = {}) {
  const configured = secret(token);
  const supplied = header(request.headers, SERVICE_AUTH_HEADER);
  const suppliedCaller = header(request.headers, CALLER_HEADER);
  const grant = header(request.headers, GRANT_HEADER);
  if (!configured || !supplied || !safeEquals(configured, supplied)) return null;
  if (grant !== INFLUENCER_INTELLIGENCE_GRANT) return null;
  const effectiveCaller = caller || suppliedCaller;
  if (!effectiveCaller || !allowCallers.has(effectiveCaller) || (caller && suppliedCaller && caller !== suppliedCaller)) return null;
  return {
    authenticated: true,
    grants: [INFLUENCER_INTELLIGENCE_GRANT],
    actor_scope: safeActorScope(header(request.headers, 'x-influencer-intelligence-actor-scope'), effectiveCaller),
    data_scope: safeDataScope(header(request.headers, 'x-influencer-intelligence-data-scope')),
    caller: effectiveCaller,
  };
}

export function verifyMcpBearer(request, token) {
  const authorization = header(request.headers, 'authorization');
  const supplied = authorization?.match(/^Bearer\s+(.+)$/i)?.[1]?.trim();
  const configured = secret(token);
  return Boolean(configured && supplied && safeEquals(configured, supplied));
}

export const __testing = Object.freeze({
  safeEquals,
  secret,
  CRM_SKEW_MS,
});
