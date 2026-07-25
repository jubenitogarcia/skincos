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

async function callWorkforce(env, path, payload, requestId) {
  if (!env?.WORKFORCE?.fetch) throw new Error('WORKFORCE_SERVICE_NOT_CONFIGURED');
  const secret = String(env?.IDENTITY_WORKFORCE_HMAC_KEY || '').trim();
  if (!secret) throw new Error('IDENTITY_WORKFORCE_HMAC_KEY_NOT_CONFIGURED');
  const raw = JSON.stringify(payload);
  const bodyHash = await sha256Hex(raw);
  const timestamp = String(Date.now());
  const nonce = crypto.randomUUID();
  const response = await env.WORKFORCE.fetch(`https://workforce${path}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-skincos-service': 'identity',
      'x-skincos-workforce-ts': timestamp,
      'x-skincos-workforce-sig': await sign(secret, `${timestamp}.${bodyHash}`),
      'x-skincos-workforce-nonce': nonce,
      'x-request-id': String(requestId || `identity-onboarding-${payload.onboardingId || 'unknown'}`).slice(0, 180),
    },
    body: raw,
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok || !result?.ok) {
    const error = String(result?.error || `WORKFORCE_SYNC_${response.status}`);
    const failure = new Error(error);
    failure.status = response.status;
    failure.requestId = result?.requestId || requestId || null;
    throw failure;
  }
  return result.data || null;
}

export function syncIdentityWorkforceOnboarding(env, payload, requestId) {
  return callWorkforce(env, '/api/ponto/internal/onboarding', payload, requestId);
}

export function syncIdentityWorkforceStatus(env, payload, requestId) {
  return callWorkforce(env, '/api/ponto/internal/onboarding/status', payload, requestId);
}

