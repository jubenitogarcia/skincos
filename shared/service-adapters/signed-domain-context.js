const encoder = new TextEncoder();
const decoder = new TextDecoder();

const toBase64Url = (bytes) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
const fromBase64Url = (value) => {
  const normalized = String(value || '').replace(/-/g, '+').replace(/_/g, '/');
  const padded = normalized + '='.repeat((4 - (normalized.length % 4)) % 4);
  return Uint8Array.from(atob(padded), (item) => item.charCodeAt(0));
};
const safeEqual = (left, right) => {
  const a = encoder.encode(left || ''); const b = encoder.encode(right || '');
  if (a.length !== b.length) return false;
  let difference = 0; for (let index = 0; index < a.length; index += 1) difference |= a[index] ^ b[index];
  return difference === 0;
};
async function sign(secret, payload) {
  const key = await crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return toBase64Url(new Uint8Array(await crypto.subtle.sign('HMAC', key, encoder.encode(payload))));
}

/** Stable, short-lived actor handoff for an internal domain service binding. */
export async function createSignedDomainContext({ actor, csrf, requestId }, secret, audience, now = Date.now()) {
  if (!secret || !actor?.username) throw new TypeError('A service identity and authenticated actor are required');
  const payload = toBase64Url(encoder.encode(JSON.stringify({ v: 1, audience, issuedAt: now, actor, csrf: String(csrf || ''), requestId: String(requestId || '') })));
  return { 'x-skincos-domain-context': payload, 'x-skincos-domain-signature': await sign(secret, payload) };
}

export async function verifySignedDomainContext(request, secret, audience, { maxAgeMs = 60_000, now = Date.now() } = {}) {
  const payload = String(request.headers.get('x-skincos-domain-context') || '');
  const received = String(request.headers.get('x-skincos-domain-signature') || '');
  if (!secret || !payload || !received || !safeEqual(await sign(secret, payload), received)) return null;
  try {
    const value = JSON.parse(decoder.decode(fromBase64Url(payload)));
    if (value?.v !== 1 || value?.audience !== audience || !value?.actor?.username || !Number.isFinite(value?.issuedAt) || Math.abs(now - value.issuedAt) > maxAgeMs) return null;
    return { actor: value.actor, csrf: String(value.csrf || ''), requestId: String(value.requestId || '') };
  } catch { return null; }
}
