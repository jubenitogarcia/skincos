import { csrfErrorFor, toAuthenticatedActor } from '../../shared/identity-contract/index.js';
import { getIdentityUserByUsername } from '../store/d1.js';

const encoder = new TextEncoder();
const decodeBytes = (value) => {
  const normalized = String(value || '');
  const padded = normalized.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (normalized.length % 4)) % 4);
  return Uint8Array.from(atob(padded), (char) => char.charCodeAt(0));
};
const encodeBytes = (bytes) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const cookies = (header = '') => Object.fromEntries(header.split(';').map((part) => part.trim()).filter(Boolean).map((part) => {
  const index = part.indexOf('=');
  return [decodeURIComponent(part.slice(0, index)), decodeURIComponent(part.slice(index + 1))];
}));
async function signature(secret, payload) {
  const key = await crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return encodeBytes(new Uint8Array(await crypto.subtle.sign('HMAC', key, encoder.encode(payload))));
}
function safeEqual(left, right) {
  const a = encoder.encode(left || ''); const b = encoder.encode(right || '');
  if (a.length !== b.length) return false;
  let result = 0; for (let index = 0; index < a.length; index += 1) result |= a[index] ^ b[index];
  return result === 0;
}

export function isCurrentSessionVersion(session, user) {
  const sessionVersion = Number(session?.sv);
  const userVersion = Number(user?.sessionVersion || 0);
  return Number.isSafeInteger(sessionVersion) && Number.isSafeInteger(userVersion) && sessionVersion === userVersion;
}

export async function resolveIdentityActor(request, env) {
  const secret = String(env?.SESSION_SECRET || '').trim();
  const token = cookies(request.headers.get('cookie') || '').session;
  if (!secret || !token) return { actor: null, csrf: null };
  const [payload, received] = String(token).split('.');
  if (!payload || !received || !safeEqual(await signature(secret, payload), received)) return { actor: null, csrf: null };
  let session;
  try {
    session = JSON.parse(new TextDecoder().decode(decodeBytes(payload)));
  } catch { return { actor: null, csrf: null }; }
  if (!session?.username || (Number(session.exp) && Date.now() > Number(session.exp))) return { actor: null, csrf: null };
  try {
    const user = await getIdentityUserByUsername(env, String(session.username));
    if (!user?.ativo || !isCurrentSessionVersion(session, user)) return { actor: null, csrf: null };
    return { actor: toAuthenticatedActor(user), csrf: String(session.csrf || '') };
  } catch { return { actor: null, csrf: null, unavailable: true }; }
}

export { csrfErrorFor };
