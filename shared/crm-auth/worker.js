// Shared CRM session boundary. Domains consume the actor; they never issue or
// interpret a second kind of credential.
import { d1GetUserByUsername } from '../../inventory/src/d1Store.js';

const encoder = new TextEncoder();
const decodeBytes = (value) => {
  const padded = `${value}`.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (`${value}`.length % 4)) % 4);
  const raw = atob(padded);
  return Uint8Array.from(raw, (char) => char.charCodeAt(0));
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

export async function resolveCrmActor(request, env) {
  const secret = String(env?.SESSION_SECRET || '').trim();
  const token = cookies(request.headers.get('cookie') || '').session;
  if (!secret || !token) return { actor: null, csrf: null };
  const [payload, received] = String(token).split('.');
  if (!payload || !received || !safeEqual(await signature(secret, payload), received)) return { actor: null, csrf: null };
  try {
    const session = JSON.parse(new TextDecoder().decode(decodeBytes(payload)));
    if (!session?.username || (Number(session.exp) && Date.now() > Number(session.exp))) return { actor: null, csrf: null };
    const user = await d1GetUserByUsername(env, String(session.username));
    if (!user?.ativo) return { actor: null, csrf: null };
    return { actor: { ...user, role: String(user.role || 'CONSULTOR').toUpperCase() }, csrf: String(session.csrf || '') };
  } catch { return { actor: null, csrf: null }; }
}

export function csrfErrorFor(request, csrf) {
  if (!['POST', 'PUT', 'PATCH', 'DELETE'].includes(request.method.toUpperCase())) return null;
  const received = String(request.headers.get('x-csrf-token') || '').trim();
  return csrf && received === csrf ? null : new Response(JSON.stringify({ ok: false, error: 'CSRF_INVALID' }), { status: 403, headers: { 'content-type': 'application/json; charset=utf-8' } });
}
