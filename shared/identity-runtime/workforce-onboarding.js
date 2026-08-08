import { sha256Hex } from './crypto.js';

function base64Url(bytes) {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

async function sign(secret, message) {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return base64Url(new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(message))));
}

const RELEASE_SHA_RE = /^[0-9a-f]{40}$/;
const CLOUDFLARE_VERSION_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function identityRelease(env) {
  const releaseSha = String(env?.APP_VERSION || '').trim().toLowerCase();
  const environment = String(env?.ENVIRONMENT || '').trim().toLowerCase();
  const versionId = String(
    environment === 'local'
      ? env?.LOCAL_IDENTITY_VERSION_ID
      : env?.CF_VERSION_METADATA?.id,
  ).trim().toLowerCase();
  if (!RELEASE_SHA_RE.test(releaseSha) || !CLOUDFLARE_VERSION_ID_RE.test(versionId)) {
    throw new Error('IDENTITY_WORKFORCE_RELEASE_IDENTITY_UNAVAILABLE');
  }
  return { releaseSha, versionId };
}

async function signedIdentityHeaders(env, { method, path, bodyHash, requestId }) {
  const secret = String(env?.IDENTITY_WORKFORCE_HMAC_KEY || '').trim();
  if (!secret) throw new Error('IDENTITY_WORKFORCE_HMAC_KEY_NOT_CONFIGURED');
  const { releaseSha, versionId } = identityRelease(env);
  const timestamp = String(Date.now());
  const nonce = crypto.randomUUID();
  const signedPayload = `v2.${timestamp}.${nonce}.${method}.${path}.${bodyHash}.${releaseSha}.${versionId}`;
  return {
    'x-skincos-service': 'identity',
    'x-skincos-workforce-signature-version': '2',
    'x-skincos-workforce-ts': timestamp,
    'x-skincos-workforce-sig': await sign(secret, signedPayload),
    'x-skincos-workforce-nonce': nonce,
    'x-skincos-identity-release-sha': releaseSha,
    'x-skincos-identity-version-id': versionId,
    'x-request-id': String(requestId || 'identity-workforce').slice(0, 180),
  };
}

async function callWorkforce(env, path, payload, requestId) {
  if (!env?.WORKFORCE?.fetch) throw new Error('WORKFORCE_SERVICE_NOT_CONFIGURED');
  const raw = JSON.stringify(payload);
  const bodyHash = await sha256Hex(raw);
  const method = 'POST';
  const signedHeaders = await signedIdentityHeaders(env, {
    method,
    path,
    bodyHash,
    requestId: requestId || `identity-onboarding-${payload.onboardingId || 'unknown'}`,
  });
  const response = await env.WORKFORCE.fetch(`https://workforce${path}`, {
    method,
    headers: {
      'content-type': 'application/json',
      ...signedHeaders,
    },
    body: raw,
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok || !result?.ok) {
    // Workforce may expose a stable dependency code alongside a generic
    // transport error (for example NOT_READY + DATABASE_UNAVAILABLE). Keep
    // the stable code so Identity can classify the failure as retryable.
    const error = String(result?.code || result?.error || `WORKFORCE_SYNC_${response.status}`);
    const failure = new Error(error);
    failure.status = response.status;
    failure.upstreamError = result?.error || null;
    failure.requestId = result?.requestId || requestId || null;
    throw failure;
  }
  return result.data || null;
}

export async function probeIdentityWorkforceContract(env, requestId) {
  if (!env?.WORKFORCE?.fetch) throw new Error('WORKFORCE_SERVICE_NOT_CONFIGURED');
  const path = '/api/ponto/internal/onboarding/contract-probe';
  const method = 'GET';
  const bodyHash = await sha256Hex('');
  const headers = await signedIdentityHeaders(env, { method, path, bodyHash, requestId });
  const identity = identityRelease(env);
  const timekeepingVersionId = String(env?.TIMEKEEPING_VERSION_ID || '').trim().toLowerCase();
  if (!CLOUDFLARE_VERSION_ID_RE.test(timekeepingVersionId)) {
    throw new Error('TIMEKEEPING_RELEASE_IDENTITY_UNAVAILABLE');
  }
  const environment = String(env?.ENVIRONMENT || '').trim().toLowerCase();
  const service = environment === 'staging' ? 'skincos-timekeeping-staging' : 'skincos-timekeeping';
  headers['cloudflare-workers-version-overrides'] = `${service}="${timekeepingVersionId}"`;
  const response = await env.WORKFORCE.fetch(`https://workforce${path}`, { method, headers });
  const result = await response.json().catch(() => ({}));
  if (!response.ok || !result?.ok) {
    const error = String(result?.error || `WORKFORCE_CONTRACT_${response.status}`);
    const failure = new Error(error);
    failure.status = response.status;
    failure.requestId = result?.requestId || requestId || null;
    throw failure;
  }
  const data = result?.data || {};
  if (
    data.contract !== 'identity-workforce-hmac-v2'
    || data.matched !== true
    || String(data.releaseSha || '').trim().toLowerCase() !== identity.releaseSha
    || String(data.identityReleaseSha || '').trim().toLowerCase() !== identity.releaseSha
    || String(data.identityVersionId || '').trim().toLowerCase() !== identity.versionId
    || String(data.timekeepingVersionId || '').trim().toLowerCase() !== timekeepingVersionId
    || String(data.environment || '').trim().toLowerCase() !== environment
  ) {
    throw new Error('WORKFORCE_CONTRACT_AFFINITY_MISMATCH');
  }
  return data;
}

export function syncIdentityWorkforceOnboarding(env, payload, requestId) {
  return callWorkforce(env, '/api/ponto/internal/onboarding', payload, requestId);
}

export function syncIdentityWorkforceStatus(env, payload, requestId) {
  return callWorkforce(env, '/api/ponto/internal/onboarding/status', payload, requestId);
}
